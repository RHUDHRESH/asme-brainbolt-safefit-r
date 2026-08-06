"""Stage 3: Dual-engine Battery Suitability Scoring (MAUT + TOPSIS)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as cfg


def compute_battery_suitability_score(batteries: pd.DataFrame) -> pd.DataFrame:
    """Compute MAUT BSS and TOPSIS T_score for all packs."""
    out = compute_maut_score(batteries)
    out = compute_topsis_score(out)
    return out


def maut_terms(soh, t, r_int, dv):
    """MAUT sub-scores and BSS for scalars or arrays.

    Extracted so the real-time layer can re-score a pack whose SoH and R_int
    have moved during the day without restating the formula.
    """
    soh = np.asarray(soh, dtype=float)
    t = np.asarray(t, dtype=float)
    r_int = np.asarray(r_int, dtype=float)
    dv = np.asarray(dv, dtype=float)

    s_soh = soh
    s_t = 100.0 * np.maximum(0.0, 1.0 - np.abs(t - cfg.MAUT_T_REF) / cfg.MAUT_T_SPAN)
    s_ir = 100.0 * np.maximum(
        0.0, 1.0 - (r_int - cfg.MAUT_IR_OFFSET) / cfg.MAUT_IR_SPAN
    )
    s_imb = 100.0 * np.maximum(
        0.0, 1.0 - (dv - cfg.MAUT_DV_OFFSET) / cfg.MAUT_DV_SPAN
    )
    bss = (
        cfg.W_SOH * s_soh
        + cfg.W_TEMP * s_t
        + cfg.W_IR * s_ir
        + cfg.W_IMB * s_imb
    )
    return s_soh, s_t, s_ir, s_imb, bss


def compute_maut_score(batteries: pd.DataFrame) -> pd.DataFrame:
    """
    BSS = 0.40 S_SoH + 0.15 S_T + 0.25 S_IR + 0.20 S_Imb

    S_SoH = SoH
    S_T   = 100 · max(0, 1 − |T−25|/25)
    S_IR  = 100 · max(0, 1 − (R_int−10)/140)
    S_Imb = 100 · max(0, 1 − (ΔV−5)/95)
    """
    out = batteries.copy()
    s_soh, s_t, s_ir, s_imb, bss = maut_terms(
        out["SoH"].to_numpy(dtype=float),
        out["T"].to_numpy(dtype=float),
        out["R_int_mOhm"].to_numpy(dtype=float),
        out["dV_cell_mV"].to_numpy(dtype=float),
    )

    out["S_SoH"] = s_soh
    out["S_T"] = s_t
    out["S_IR"] = s_ir
    out["S_Imb"] = s_imb
    out["BSS"] = bss.astype(float)
    return out


def compute_topsis_score(batteries: pd.DataFrame) -> pd.DataFrame:
    """
    TOPSIS on attrs [SoC, SoH, R_int, ΔV] with weights [0.35, 0.30, 0.20, 0.15].
    Benefit: SoC, SoH. Cost: R_int, ΔV. Relative closeness × 100 → T_score.
    Quarantined packs receive NaN T_score.
    """
    out = batteries.copy()
    t_score = np.full(len(out), np.nan, dtype=float)

    eligible_mask = out["status"] != cfg.STATUS_QUARANTINE
    if not eligible_mask.any():
        out["T_score"] = t_score
        return out

    idx = np.flatnonzero(eligible_mask.to_numpy())
    x = np.column_stack(
        [
            out.loc[eligible_mask, "SoC"].to_numpy(float),
            out.loc[eligible_mask, "SoH"].to_numpy(float),
            out.loc[eligible_mask, "R_int_mOhm"].to_numpy(float),
            out.loc[eligible_mask, "dV_cell_mV"].to_numpy(float),
        ]
    )

    denom = np.sqrt((x**2).sum(axis=0))
    denom = np.where(denom < 1e-12, 1.0, denom)
    r = x / denom
    w = np.asarray(cfg.TOPSIS_WEIGHTS, dtype=float)
    v = r * w

    # Ideal / anti-ideal: max SoC/SoH, min R_int/ΔV
    benefit = np.array([True, True, False, False])
    a_pos = np.where(benefit, v.max(axis=0), v.min(axis=0))
    a_neg = np.where(benefit, v.min(axis=0), v.max(axis=0))

    d_pos = np.sqrt(((v - a_pos) ** 2).sum(axis=1))
    d_neg = np.sqrt(((v - a_neg) ** 2).sum(axis=1))
    closeness = d_neg / np.maximum(d_pos + d_neg, 1e-12)
    t_score[idx] = closeness * 100.0

    out["T_score"] = t_score
    return out

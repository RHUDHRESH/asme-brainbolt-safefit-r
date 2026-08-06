"""Diagnostic visualizations for BSS dispatch."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from . import config as cfg


def generate_diagnostic_plots(
    batteries: pd.DataFrame,
    proposed: pd.DataFrame,
    hsf: pd.DataFrame,
    comparison: dict,
    path: Path | None = None,
) -> Path:
    path = path or cfg.PLOT_PNG
    path.parent.mkdir(parents=True, exist_ok=True)

    fig, axes = plt.subplots(2, 2, figsize=(12, 9))
    fig.suptitle(
        "BSS 5-Stage Dispatch — Dual Scoring & Policy Comparison", fontsize=13
    )

    _plot_maut_vs_topsis(axes[0, 0], batteries)
    _plot_allocation_by_priority(axes[0, 1], proposed, hsf)
    _plot_metric_bars(axes[1, 0], comparison)
    _plot_quarantine_breakdown(axes[1, 1], batteries)

    fig.tight_layout(rect=[0, 0, 1, 0.96])
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path


def _plot_maut_vs_topsis(ax, batteries: pd.DataFrame) -> None:
    usable = batteries[batteries["status"] != cfg.STATUS_QUARANTINE].dropna(
        subset=["BSS", "T_score"]
    )
    if usable.empty:
        ax.text(0.5, 0.5, "No eligible packs", ha="center", va="center")
        ax.set_axis_off()
        return

    safe = usable[usable["status"] == cfg.STATUS_SAFE]
    degraded = usable[usable["status"] == cfg.STATUS_DEGRADED]
    if not safe.empty:
        ax.scatter(
            safe["BSS"],
            safe["T_score"],
            alpha=0.65,
            s=28,
            label="Safe",
            color="#2E7D32",
        )
    if not degraded.empty:
        ax.scatter(
            degraded["BSS"],
            degraded["T_score"],
            alpha=0.65,
            s=28,
            label="Degraded",
            color="#F9A825",
        )
    ax.set_xlabel("MAUT BSS")
    ax.set_ylabel("TOPSIS T_score")
    ax.set_title("Dual-Engine Scores (MAUT vs TOPSIS)")
    ax.legend(frameon=False)


def _plot_allocation_by_priority(ax, proposed: pd.DataFrame, hsf: pd.DataFrame) -> None:
    order = ["Critical", "High", "Medium", "Low"]
    x = np.arange(len(order))
    width = 0.35

    def rates(df: pd.DataFrame) -> list[float]:
        out = []
        for p in order:
            subset = df[df["priority"] == p]
            if subset.empty:
                out.append(0.0)
            else:
                out.append(100.0 * subset["served"].mean())
        return out

    ax.bar(x - width / 2, rates(proposed), width, label="Proposed", color="#1565C0")
    ax.bar(x + width / 2, rates(hsf), width, label="HSF", color="#90A4AE")
    ax.set_xticks(x)
    ax.set_xticklabels(order)
    ax.set_ylim(0, 110)
    ax.set_ylabel("Served (%)")
    ax.set_title("Allocation Rate by Priority")
    ax.legend(frameon=False)


def _plot_metric_bars(ax, comparison: dict) -> None:
    labels = ["Service %", "Crit/High %", "Unsafe=0?", "Avg SoH", "Avg BSS"]
    prop = comparison["Proposed"]
    hsf = comparison["HSF"]

    prop_vals = [
        prop["service_rate_pct"],
        prop["high_critical_served_pct"],
        100.0 if prop["unsafe_allocations"] == 0 else 0.0,
        prop["avg_soh_allocated"],
        prop["avg_bss_allocated"],
    ]
    hsf_vals = [
        hsf["service_rate_pct"],
        hsf["high_critical_served_pct"],
        100.0 if hsf["unsafe_allocations"] == 0 else 0.0,
        hsf["avg_soh_allocated"],
        hsf["avg_bss_allocated"],
    ]

    x = np.arange(len(labels))
    width = 0.35
    ax.bar(x - width / 2, prop_vals, width, label="Proposed", color="#1565C0")
    ax.bar(x + width / 2, hsf_vals, width, label="HSF", color="#90A4AE")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=15, ha="right")
    ax.set_title("HSF vs Proposed Metrics")
    ax.set_ylabel("Value")
    ax.legend(frameon=False)


def _plot_quarantine_breakdown(ax, batteries: pd.DataFrame) -> None:
    q = batteries[batteries["status"] == cfg.STATUS_QUARANTINE]
    if q.empty:
        status_counts = batteries["status"].value_counts()
        ax.pie(status_counts.values, labels=status_counts.index, autopct="%1.0f%%")
        ax.set_title("Fleet Status Mix")
        return

    reasons = q["quarantine_reason"].value_counts()
    ax.barh(reasons.index.astype(str), reasons.values, color="#C62828")
    ax.set_xlabel("Count")
    ax.set_title("Quarantined Packs by Trigger")

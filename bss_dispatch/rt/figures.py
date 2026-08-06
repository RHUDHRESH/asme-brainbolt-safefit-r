"""Figure generation for the v2 method.

Rendered dark to match the product's Dark Industrial surface. The categorical
palette is the validated five-slot dark set (lightness band, chroma floor,
adjacent-pair CVD separation, normal-vision floor and 3:1 contrast all pass
against the #12161C chart surface); health classes use the reserved status
palette and always carry a text label, never colour alone.

No dual-axis charts anywhere: where two units share a timeline they get
stacked panels on a shared x-axis instead.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle  # noqa: E402

from . import config_rt as rt  # noqa: E402
from . import degradation as deg  # noqa: E402
from . import market  # noqa: E402

# ----------------------------------------------------------------- theme --
SURFACE = "#12161C"
PAGE = "#0A0D11"
INK = "#FFFFFF"
INK2 = "#C3C2B7"
MUTED = "#898781"
GRID = "#2C2C2A"
AXIS = "#383835"

POLICY_COLOR = {
    "hsf": "#3987e5",
    "greedy": "#d95926",
    "v1_online": "#199e70",
    "market": "#c98500",
    "full": "#d55181",
}
POLICY_ORDER = ("hsf", "greedy", "v1_online", "market", "full")
POLICY_LABEL = {
    "hsf": "HSF baseline",
    "greedy": "Health-greedy",
    "v1_online": "v1 online",
    "market": "+ Market/degradation",
    "full": "FULL (proposed)",
}
# Axis categories need to be narrow or they collide across panels.
POLICY_SHORT = {
    "hsf": "HSF",
    "greedy": "Greedy",
    "v1_online": "v1 online",
    "market": "+Market",
    "full": "FULL",
}

STATUS_COLOR = {"safe": "#0ca30c", "degraded": "#fab219", "unsafe": "#d03b3b"}
SEQ_BLUE = ("#256abf", "#3987e5", "#86b6ef")

STATE_COLOR = {
    "READY": "#3987e5",
    "CHARGING": "#c98500",
    "WAITING_BAY": "#199e70",
    "IN_SERVICE": "#d55181",
    "QUARANTINE": "#d03b3b",
}


def _style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": PAGE,
            "savefig.facecolor": PAGE,
            "axes.facecolor": SURFACE,
            "axes.edgecolor": AXIS,
            "axes.labelcolor": INK2,
            "axes.titlecolor": INK,
            "axes.titlesize": 13,
            "axes.titleweight": "bold",
            "axes.labelsize": 10.5,
            "axes.grid": True,
            "axes.axisbelow": True,
            "grid.color": GRID,
            "grid.linewidth": 0.7,
            "xtick.color": MUTED,
            "ytick.color": MUTED,
            "xtick.labelsize": 9.5,
            "ytick.labelsize": 9.5,
            "text.color": INK,
            "legend.frameon": False,
            "legend.fontsize": 9.5,
            "legend.labelcolor": INK2,
            "font.family": "DejaVu Sans",
            "figure.dpi": 200,
        }
    )


def _tidy(ax, xlabel: str = "", ylabel: str = "", title: str = "") -> None:
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(AXIS)
        ax.spines[side].set_linewidth(0.8)
    if xlabel:
        ax.set_xlabel(xlabel)
    if ylabel:
        ax.set_ylabel(ylabel)
    if title:
        ax.set_title(title, loc="left", pad=10)


def _save(fig, name: str) -> Path:
    rt.ensure_dirs()
    path = rt.FIGURE_DIR / name
    fig.savefig(path, bbox_inches="tight", pad_inches=0.28)
    plt.close(fig)
    return path


def _clock_ticks(ax, n_slots: int) -> None:
    step = rt.SLOTS_PER_HOUR * 2
    ticks = list(range(0, n_slots + 1, step))
    ax.set_xticks(ticks)
    ax.set_xticklabels([rt.slot_to_clock(t) for t in ticks])


# ------------------------------------------------------- 1 · architecture --
def fig_architecture() -> Path:
    """The five-layer stack and which paper supplies each layer."""
    _style()
    fig, ax = plt.subplots(figsize=(12, 6.4))
    ax.set_facecolor(PAGE)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 6.2)
    ax.axis("off")

    layers = [
        ("L0", "Health core  (v1, unchanged)",
         "integrity pre-screen -> 3-tier safety gate -> MAUT + TOPSIS suitability",
         "Problem statement, tasks 1-2", "#3987e5"),
        ("L1", "Battery state transitions",
         "READY / CHARGING / WAITING_BAY / IN_SERVICE / QUARANTINE, closed-loop circulation",
         "Sarker 2015 (T-PWRS) · Yang 2014 (Energy)", "#199e70"),
        ("L2", "Charging rate <-> degradation",
         "C-rate menu, super-linear stress + Arrhenius fade, monetised against replacement",
         "Wu 2018 (T-VT)", "#c98500"),
        ("L3", "Electricity-market operation",
         "ToU energy price, demand charge on peak kW, transformer cap, DR curtailment",
         "Sarker 2015 · Gong 2023 (IJEPES)", "#d95926"),
        ("L4", "Demand uncertainty + inventory",
         "scenario bank -> critical-fractile reserve -> newsvendor shadow price of readiness",
         "Sarker 2015 · Cui 2023 (Energy, review)", "#d55181"),
    ]

    y = 5.25
    for tag, title, body, cite, colour in layers:
        box = FancyBboxPatch(
            (0.35, y - 0.42), 9.3, 0.86,
            boxstyle="round,pad=0.02,rounding_size=0.06",
            facecolor=SURFACE, edgecolor=colour, linewidth=1.6,
        )
        ax.add_patch(box)
        ax.add_patch(Rectangle((0.35, y - 0.42), 0.09, 0.86, facecolor=colour, edgecolor="none"))
        ax.text(0.62, y + 0.17, tag, color=colour, fontsize=11, fontweight="bold", va="center")
        ax.text(1.30, y + 0.17, title, color=INK, fontsize=12, fontweight="bold", va="center")
        # Citation shares the title row: the body line runs full width and the
        # two would otherwise collide on the longer layers.
        ax.text(9.45, y + 0.17, cite, color=MUTED, fontsize=8.6, va="center",
                ha="right", style="italic")
        ax.text(1.30, y - 0.16, body, color=INK2, fontsize=9.4, va="center")
        y -= 1.02

    ax.text(
        0.35, 0.18,
        "Every layer is additive: L0 is byte-identical to the validated v1 core, and each layer above it "
        "changes one term of the objective or one constraint.",
        color=MUTED, fontsize=9.2,
    )
    ax.set_title(
        "Method architecture — five layers, each traceable to a Tier-S source",
        loc="left", pad=16, fontsize=14,
    )
    return _save(fig, "f1_architecture.png")


# ------------------------------------------------------ 2 · state machine --
def fig_state_occupancy(run) -> Path:
    """Where every pack in the fleet is, slot by slot."""
    _style()
    traces = run.traces
    slots = [t.slot for t in traces]
    series = {
        "READY": [t.ready for t in traces],
        "CHARGING": [t.charging for t in traces],
        "WAITING_BAY": [t.waiting for t in traces],
        "IN_SERVICE": [t.in_service for t in traces],
        "QUARANTINE": [t.quarantine for t in traces],
    }

    fig, (ax, ax2) = plt.subplots(
        2, 1, figsize=(12, 6.9), sharex=True,
        gridspec_kw={"height_ratios": [2.7, 1.2], "hspace": 0.15},
    )

    ax.stackplot(
        slots, *series.values(),
        labels=list(series),
        colors=[STATE_COLOR[k] for k in series],
        edgecolor=SURFACE, linewidth=0.6,
    )
    _tidy(ax, ylabel="packs")
    ax.legend(loc="lower left", bbox_to_anchor=(0, 1.005), ncols=5)
    ax.set_ylim(0, sum(v[0] for v in series.values()) * 1.02)

    queue = [t.queue_len for t in traces]
    ax2.fill_between(slots, queue, color="#3987e5", alpha=0.18)
    ax2.plot(slots, queue, color="#3987e5", linewidth=2.0, label="riders waiting")
    ax2.bar(slots, [t.n_swaps for t in traces], color="#d55181", width=0.85,
            label="swaps executed")
    defect = [t.n_defections for t in traces]
    if sum(defect):
        ax2.bar(slots, [-d for d in defect], color=STATUS_COLOR["unsafe"], width=0.85,
                label="riders lost (wait exceeded)")
    _tidy(ax2, xlabel="station clock", ylabel="riders")
    ax2.legend(loc="upper right", ncols=3)
    _clock_ticks(ax2, len(slots))

    fig.suptitle(
        "Battery state occupancy — pack count is conserved every slot",
        color=INK, fontsize=13.5, fontweight="bold", x=0.008, ha="left", y=1.05,
    )
    return _save(fig, "f2_state_occupancy.png")


# ----------------------------------------------------- 3 · degradation ----
def fig_degradation(nominal_runs: dict) -> Path:
    """The Wu-2018 trade-off as a model, as a realised choice, and as damage."""
    _style()
    fig, axes = plt.subplots(
        1, 3, figsize=(14.6, 4.7), gridspec_kw={"wspace": 0.34}
    )

    # (a) the model
    ax = axes[0]
    c_grid = np.linspace(0.05, 2.0, 120)
    for colour, temp in zip(SEQ_BLUE, (25, 35, 45)):
        fade = [
            deg.cycle_fade_pct(c, temp, hours=1.0 / c, soh_pct=100.0) for c in c_grid
        ]
        line, = ax.plot(c_grid, np.array(fade) * 1000, color=colour, linewidth=2.2)
        ax.annotate(
            f"{temp} °C", xy=(2.0, np.array(fade)[-1] * 1000),
            xytext=(-4, 4), textcoords="offset points",
            color=colour, fontsize=9.5, fontweight="bold", ha="right",
        )
    ax.axvline(rt.C_RATE_REF, color=MUTED, linewidth=1.0, linestyle=(0, (4, 3)))
    ax.text(rt.C_RATE_REF + 0.06, 4, "reference\n0.5C", color=MUTED, fontsize=8.6, va="bottom")
    _tidy(ax, "charging C-rate", "fade per full cycle  (10⁻³ %SoH)",
          "Fade is super-linear\nin C-rate")

    # (b) realised C-rate choice
    ax = axes[1]
    pairs = [("v1_online", "uncontrolled"), ("market", "MILP-scheduled")]
    bins = np.array([c for c in rt.C_RATE_MENU if c > 0])
    width = 0.36
    for k, (key, label) in enumerate(pairs):
        hist = np.array(nominal_runs[key].fleet["c_rate_histogram"], dtype=float)
        share = 100.0 * hist / max(hist.sum(), 1)
        ax.bar(
            np.arange(len(bins)) + (k - 0.5) * width, share, width * 0.9,
            color=POLICY_COLOR[key], label=label, edgecolor=SURFACE, linewidth=1.2,
        )
    ax.set_xticks(np.arange(len(bins)))
    ax.set_xticklabels([f"{b:g}C" for b in bins])
    _tidy(ax, "C-rate selected", "share of bay-slots  (%)",
          "The optimiser buys width,\nnot speed")
    ax.legend(loc="upper center", ncols=1, bbox_to_anchor=(0.62, 1.0))

    # (c) resulting damage
    ax = axes[2]
    keys = [k for k in POLICY_ORDER if k in nominal_runs]
    vals = [nominal_runs[k].fleet["soh_lost_total_pct"] for k in keys]
    bars = ax.barh(
        [POLICY_SHORT[k] for k in keys], vals,
        color=[POLICY_COLOR[k] for k in keys], height=0.62,
        edgecolor=SURFACE, linewidth=1.2,
    )
    for bar, val in zip(bars, vals):
        ax.text(val + max(vals) * 0.02, bar.get_y() + bar.get_height() / 2,
                f"{val:.2f}", va="center", color=INK2, fontsize=9.5)
    ax.invert_yaxis()
    ax.set_xlim(0, max(vals) * 1.20)
    _tidy(ax, "fleet SoH lost  (percentage points)", "",
          "Same 50 swaps,\nless damage")
    return _save(fig, "f3_degradation.png")


# ---------------------------------------------------------- 4 · market ----
def fig_market(nominal_runs: dict) -> Path:
    """Load shape against the tariff, on a shared clock and separate panels."""
    _style()
    fig, (ax, ax2) = plt.subplots(
        2, 1, figsize=(12, 6.2), sharex=True,
        gridspec_kw={"height_ratios": [2.4, 1], "hspace": 0.14},
    )

    for key in ("v1_online", "market"):
        load = [t.load_kw for t in nominal_runs[key].traces]
        ax.plot(range(len(load)), load, color=POLICY_COLOR[key],
                linewidth=2.0, label=f"{POLICY_LABEL[key]}  ·  peak {max(load):.1f} kW")

    cap = nominal_runs["market"].market["grid_cap_kw"]
    ax.axhline(cap, color=STATUS_COLOR["unsafe"], linewidth=1.4, linestyle=(0, (5, 3)))
    ax.text(1, cap + 1.6, f"transformer cap {cap:.0f} kW",
            color=STATUS_COLOR["unsafe"], fontsize=9)
    ax.set_ylim(0, cap * 1.30)
    _tidy(ax, ylabel="station load  (kW)",
          title="The station is cap-bound, not price-bound")
    ax.legend(loc="upper right", bbox_to_anchor=(1.0, 0.93))

    # State plainly what the tariff lever did and did not buy on this dataset.
    p_v1 = nominal_runs["v1_online"].market["avg_price_paid_inr_per_kwh"]
    p_mk = nominal_runs["market"].market["avg_price_paid_inr_per_kwh"]
    ax.text(
        0.30, 0.30,
        f"Realised energy price:  uncontrolled ₹{p_v1:.2f}/kWh   ·   MILP ₹{p_mk:.2f}/kWh\n"
        "The backlog must clear inside the ₹7.20 morning block, and the cheap ₹6.30\n"
        "window falls after the demand peak — so there is no arbitrage to take here.\n"
        "The market layer's realised gain on this dataset is C-rate composition (Fig 3).",
        transform=ax.transAxes, color=INK2, fontsize=9.2, va="top",
        bbox=dict(boxstyle="round,pad=0.5", facecolor=PAGE, edgecolor=AXIS, linewidth=0.8),
    )

    prices = [market.price_at_slot(s) for s in range(rt.N_SLOTS)]
    ax2.step(range(len(prices)), prices, where="post", color="#86b6ef", linewidth=1.8)
    ax2.fill_between(range(len(prices)), prices, step="post", color="#86b6ef", alpha=0.16)
    _tidy(ax2, xlabel="station clock", ylabel="tariff  (₹/kWh)")
    ax2.set_ylim(0, max(prices) * 1.25)
    peak_lo = int((9.0 - rt.SIM_START_HOUR) * rt.SLOTS_PER_HOUR)
    peak_hi = int((12.0 - rt.SIM_START_HOUR) * rt.SLOTS_PER_HOUR)
    ax2.axvspan(peak_lo, peak_hi, color=STATUS_COLOR["degraded"], alpha=0.10)
    ax2.text((peak_lo + peak_hi) / 2, max(prices) * 1.03, "morning peak",
             color=STATUS_COLOR["degraded"], fontsize=8.8, ha="center")
    _clock_ticks(ax2, len(prices))
    return _save(fig, "f4_market.png")


# ----------------------------------------------------- 5 · uncertainty ----
def fig_uncertainty(stress_run, bank, oracle) -> Path:
    """The scenario fan, the reserve it implies, and the price it puts on stock."""
    _style()
    fig, (ax, ax2) = plt.subplots(
        2, 1, figsize=(12, 6.4), sharex=True,
        gridspec_kw={"height_ratios": [2, 1.15], "hspace": 0.14},
    )

    window = oracle.window_slots
    slots = np.arange(rt.N_SLOTS)
    q10, q50, q90, q95 = [], [], [], []
    for s in slots:
        d = bank.window_premium(int(s), window)
        q10.append(np.quantile(d, 0.10))
        q50.append(np.quantile(d, 0.50))
        q90.append(np.quantile(d, 0.90))
        q95.append(np.quantile(d, 0.95))

    ax.fill_between(slots, q10, q90, color="#3987e5", alpha=0.20,
                    label="premium demand, 10–90th pct")
    ax.plot(slots, q50, color="#3987e5", linewidth=1.8, label="median")
    ax.plot(slots, q95, color="#86b6ef", linewidth=1.6, linestyle=(0, (4, 3)),
            label=f"{rt.SERVICE_LEVEL:.0%} service level")

    traces = stress_run.traces
    ax.plot([t.slot for t in traces], [t.reserve for t in traces],
            color="#d55181", linewidth=2.2, label="reserve held back")
    ax.plot([t.slot for t in traces], [t.premium_available for t in traces],
            color="#199e70", linewidth=1.6, label="premium-ready packs on shelf")
    _tidy(ax, ylabel="packs",
          title=f"Scenario bank ({bank.n_scenarios} futures) sets the reserve, "
                f"{rt.RESERVE_LOOKAHEAD_MIN} min look-ahead")
    ax.legend(loc="upper right", ncols=2)

    shadow = [t.shadow_price for t in traces]
    ax2.fill_between([t.slot for t in traces], shadow, color="#d55181", alpha=0.22)
    ax2.plot([t.slot for t in traces], shadow, color="#d55181", linewidth=1.8)
    ax2.axhline(rt.VOLL_INR["High"], color=MUTED, linewidth=1.0, linestyle=(0, (4, 3)))
    ax2.text(1, rt.VOLL_INR["High"] * 0.86,
             f"value of lost premium service  ₹{rt.VOLL_INR['High']:.0f}",
             color=MUTED, fontsize=8.8)
    _tidy(ax2, xlabel="station clock", ylabel="shadow price  (₹/pack)")
    ax2.set_ylim(0, rt.VOLL_INR["High"] * 1.12)
    _clock_ticks(ax2, len(traces))
    return _save(fig, "f5_uncertainty.png")


# -------------------------------------------------------- 6 · ablation ----
def fig_ablation(stress: dict) -> Path:
    """What each literature component is worth, one at a time."""
    _style()
    pol = stress["policies"]
    keys = [k for k in POLICY_ORDER if k in pol]
    fig, axes = plt.subplots(
        1, 3, figsize=(14.6, 4.8), sharey=True, gridspec_kw={"wspace": 0.12}
    )

    def _hbar(ax, values, title, xlabel, fmt="{:.1f}"):
        bars = ax.barh(
            [POLICY_SHORT[k] for k in keys], values,
            color=[POLICY_COLOR[k] for k in keys], height=0.62,
            edgecolor=SURFACE, linewidth=1.2,
        )
        lo, top = min(0.0, min(values)), max(max(values), 1e-6)
        span = max(top - lo, 1e-6)
        for bar, val in zip(bars, values):
            # negative bars grow left, so their label goes left too
            offset = span * 0.025 if val >= 0 else -span * 0.025
            ax.text(val + offset, bar.get_y() + bar.get_height() / 2,
                    fmt.format(val), va="center",
                    ha="left" if val >= 0 else "right",
                    color=INK2, fontsize=9.5)
        ax.invert_yaxis()
        ax.set_xlim(lo - span * 0.20, top + span * 0.22)
        _tidy(ax, xlabel, "", title)

    _hbar(axes[0], [pol[k]["premium_service_rate_pct"] for k in keys],
          "Critical + High served", "% of premium requests")
    _hbar(axes[1], [pol[k]["unsafe_allocations"] for k in keys],
          "Quarantined packs dispatched", "count  (task 3: must be 0)", fmt="{:.0f}")
    _hbar(axes[2], [pol[k]["economic_surplus_inr"] for k in keys],
          "Economic surplus", "₹ per operating day", fmt="₹{:,.0f}")

    axes[1].axvline(0, color=STATUS_COLOR["safe"], linewidth=1.8)
    fig.suptitle(
        f"Ablation — stress regime: {stress['n_requests']} requests on "
        f"{stress['station']['resident_packs']} packs / {stress['station']['n_bays']} bays / "
        f"{stress['station']['grid_cap_kw']:.0f} kW",
        color=INK, fontsize=13.5, fontweight="bold", x=0.008, ha="left", y=1.06,
    )
    return _save(fig, "f6_ablation.png")


# ----------------------------------------------------- 7 · monte carlo ----
def fig_monte_carlo(mc: dict) -> Path:
    """Distribution, not a single lucky day."""
    _style()
    raw = mc["_raw"]
    keys = [k for k in POLICY_ORDER if k in raw and raw[k]]
    fig, (ax, ax2) = plt.subplots(
        1, 2, figsize=(14.0, 5.0), gridspec_kw={"wspace": 0.22}
    )

    data = [[row["premium_unserved"] for row in raw[k]] for k in keys]
    parts = ax.violinplot(data, showextrema=False, widths=0.78)
    for body, k in zip(parts["bodies"], keys):
        body.set_facecolor(POLICY_COLOR[k])
        body.set_alpha(0.30)
        body.set_edgecolor(POLICY_COLOR[k])
        body.set_linewidth(1.4)
    for i, (k, vals) in enumerate(zip(keys, data), start=1):
        jitter = np.random.default_rng(7).normal(0, 0.045, len(vals))
        ax.scatter(np.full(len(vals), i) + jitter, vals, s=13,
                   color=POLICY_COLOR[k], alpha=0.75, edgecolor="none", zorder=3)
        cv = mc["policies"][k]["premium_unserved_cvar95"]
        ax.hlines(cv, i - 0.34, i + 0.34, color=INK, linewidth=1.8, zorder=4)
        ax.text(i + 0.38, cv, f"CVaR₉₅ {cv:.0f}", color=INK2, fontsize=8.8, va="center")
    ax.set_xticks(range(1, len(keys) + 1))
    ax.set_xticklabels([POLICY_SHORT[k] for k in keys])
    ax.set_xlim(0.4, len(keys) + 0.9)
    _tidy(ax, "", "premium requests unserved",
          f"Shortfall across {mc['n_replications']} demand futures")

    means = [mc["policies"][k]["premium_service_mean"] for k in keys]
    stds = [mc["policies"][k]["premium_service_std"] for k in keys]
    ax2.errorbar(
        range(len(keys)), means, yerr=stds, fmt="o", markersize=9,
        capsize=6, elinewidth=1.6, capthick=1.6,
        color=INK2, ecolor=INK2, zorder=2,
    )
    for i, k in enumerate(keys):
        ax2.scatter([i], [means[i]], s=110, color=POLICY_COLOR[k], zorder=3,
                    edgecolor=SURFACE, linewidth=1.4)
        ax2.text(i + 0.12, means[i], f"{means[i]:.1f}%", color=INK2, fontsize=9.2, va="center")
    ax2.set_xticks(range(len(keys)))
    ax2.set_xticklabels([POLICY_SHORT[k] for k in keys])
    ax2.set_xlim(-0.45, len(keys) - 0.15)
    _tidy(ax2, "", "premium service rate  (%)", "Mean ± 1 s.d., same futures")
    return _save(fig, "f7_monte_carlo.png")


# --------------------------------------------------------- 8 · safety ----
def fig_safety_breakeven(stress: dict, nominal: dict) -> Path:
    """The baseline's apparent economic win, priced."""
    _style()
    pol_s = stress["policies"]
    fig, ax = plt.subplots(figsize=(11.2, 5.0))

    hsf = pol_s["hsf"]
    full = pol_s["full"]
    gap = hsf["economic_surplus_inr"] - full["economic_surplus_inr"]
    unsafe = hsf["unsafe_allocations"]
    breakeven = gap / unsafe if unsafe else float("inf")

    costs = np.linspace(0, max(breakeven * 2.4, 100), 200)
    hsf_adj = hsf["economic_surplus_inr"] - costs * unsafe
    full_adj = np.full_like(costs, full["economic_surplus_inr"])

    ax.plot(costs, hsf_adj, color=POLICY_COLOR["hsf"], linewidth=2.4,
            label=f"HSF baseline  ({unsafe:.0f} quarantined handovers)")
    ax.plot(costs, full_adj, color=POLICY_COLOR["full"], linewidth=2.4,
            label="FULL (proposed)  ·  0 quarantined handovers")
    ax.fill_between(costs, hsf_adj, full_adj, where=hsf_adj >= full_adj,
                    color=POLICY_COLOR["hsf"], alpha=0.12)
    ax.fill_between(costs, hsf_adj, full_adj, where=hsf_adj < full_adj,
                    color=POLICY_COLOR["full"], alpha=0.12)
    ax.axvline(breakeven, color=INK, linewidth=1.4, linestyle=(0, (5, 3)))
    lo, hi = ax.get_ylim()
    ax.annotate(
        f"break-even  ₹{breakeven:,.0f}\nper unsafe handover",
        xy=(breakeven, full["economic_surplus_inr"]),
        xytext=(breakeven + (costs[-1] - breakeven) * 0.10, lo + (hi - lo) * 0.62),
        color=INK, fontsize=10.5, fontweight="bold",
        bbox=dict(boxstyle="round,pad=0.45", facecolor=PAGE, edgecolor=AXIS, linewidth=0.8),
        arrowprops=dict(arrowstyle="-", color=MUTED, linewidth=1.0),
    )
    ax.axhline(0, color=AXIS, linewidth=1.0)

    _tidy(ax, "assumed cost of dispatching one quarantined pack  (₹)",
          "safety-adjusted surplus  (₹/day)",
          "The baseline is only ahead while an unsafe handover is nearly free")
    ax.legend(loc="lower left")
    return _save(fig, "f8_safety_breakeven.png")


# --------------------------------------------------------------- driver ---
def generate_all(study: dict) -> dict[str, Path]:
    """Render every figure from a completed `experiments.run_all` result."""
    from . import uncertainty as unc

    rt.ensure_dirs()
    nominal_runs = study["nominal"]["_runs"]
    stress_runs = study["stress"]["_runs"]

    # Rebuild the exact bank the stress runs were driven by: same profile, same
    # multiplier, same seed, so the fan drawn is the fan the policy consulted.
    profile = unc.fit_demand_profile(study["vehicles"])
    bank = unc.build_scenario_bank(
        profile,
        n_scenarios=rt.N_SCENARIOS,
        demand_multiplier=rt.STRESS_DEMAND_MULTIPLIER,
    )
    oracle = unc.ReserveOracle(bank=bank)

    return {
        "architecture": fig_architecture(),
        # Stress run: the regime where the queue and the state machine are both
        # under load, so one figure carries both dynamics honestly.
        "state_occupancy": fig_state_occupancy(stress_runs["full"]),
        "degradation": fig_degradation(nominal_runs),
        "market": fig_market(nominal_runs),
        "uncertainty": fig_uncertainty(stress_runs["full"], bank, oracle),
        "ablation": fig_ablation(study["payload"]["ablation"]["stress"]),
        "monte_carlo": fig_monte_carlo(study["monte_carlo"]),
        "safety": fig_safety_breakeven(
            study["payload"]["ablation"]["stress"],
            study["payload"]["ablation"]["nominal"],
        ),
    }

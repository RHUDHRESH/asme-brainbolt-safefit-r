"use client";

/**
 * Head-to-head — the comparison the problem statement actually poses.
 *
 * Not two arbitrary packs: the two packs the two policies chose for the SAME
 * request. Opens on the most damaging divergence in the run, states the
 * physical consequence in watts at that vehicle's own peak current, and has a
 * blindfold mode that renders the decision the way Highest-SoC-First sees it —
 * charge only — before revealing what that view was hiding.
 */

import { useMemo, useState } from "react";

import { useSolverConfig } from "@/components/params/solver-config-context";
import {
  HealthBadge,
  ImbalanceSparkline,
  IrCard,
  PriorityChip,
  SocPill,
  SohRadial,
  ThermoCard,
} from "@/components/params/param-primitives";
import { ZoneSection } from "@/components/dashboard/zone-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HEALTH_VAR, healthTone, priorityColor } from "@/lib/design-tokens";
import { PARAMS } from "@/lib/explain";
import {
  buildDuels,
  corrPhrase,
  corrStrength,
  summarise,
  type Duel,
} from "@/lib/duel";
import type { AssignmentRow, FleetBattery } from "@/lib/metrics";
import { cn } from "@/lib/utils";

const PROPOSED_TONE = "var(--health-safe)";
const HSF_TONE = "var(--health-degraded)";

export function HeadToHead({
  proposed,
  hsf,
  fleet,
  className,
}: {
  proposed: AssignmentRow[];
  hsf: AssignmentRow[];
  fleet: FleetBattery[];
  className?: string;
}) {
  const cfg = useSolverConfig();
  const [selected, setSelected] = useState<string | null>(null);
  const [blindfold, setBlindfold] = useState(false);

  const duels = useMemo(
    () => (cfg ? buildDuels(proposed, hsf, cfg) : []),
    [cfg, hsf, proposed]
  );
  const stats = useMemo(() => summarise(duels, fleet), [duels, fleet]);

  if (!cfg || duels.length === 0) return null;

  // Opens on the worst decision in the run, not an arbitrary pair.
  const duel = duels.find((d) => d.vehicleId === selected) ?? duels[0];

  return (
    <div className={cn("space-y-6", className)} data-screen="head-to-head">
      <ZoneSection
        title="Head-to-head"
        description="One request at a time: the pack the proposed method chose, against the pack Highest-SoC-First chose for that same request."
      >
        <TheCase stats={stats} />
      </ZoneSection>

      <ZoneSection
        title={`${duel.vehicleId} — ${duel.hsfUnsafe ? "HSF handed over a blocked pack" : duel.hsfDegraded ? "HSF handed over a degraded pack" : "same request, different pack"}`}
        description="Both policies saw the identical fleet at the identical moment."
        actions={
          <Button
            type="button"
            size="sm"
            variant={blindfold ? "default" : "outline"}
            onClick={() => setBlindfold((b) => !b)}
            style={
              blindfold
                ? { background: HSF_TONE, borderColor: HSF_TONE, color: "#000" }
                : undefined
            }
          >
            {blindfold ? "Reveal what SoC hides" : "See it as HSF does"}
          </Button>
        }
      >
        <Duelboard duel={duel} blindfold={blindfold} />
      </ZoneSection>

      <ZoneSection
        title="Divergence ladder"
        description="Every request where the two policies disagreed, ranked by how much the baseline's choice costs. Pick one to load it above."
      >
        <Ladder duels={duels} activeId={duel.vehicleId} onPick={setSelected} />
      </ZoneSection>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   The statistical case — why HSF fails, stated from this fleet
   ══════════════════════════════════════════════════════════════ */

function TheCase({ stats }: { stats: ReturnType<typeof summarise> }) {
  const rSoc = stats.corrSocSoH;
  const rHealth = stats.corrSohRint;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      {/* Correlation argument */}
      <Card className="glass-panel border-0" style={{ "--tone": HSF_TONE } as React.CSSProperties}>
        <CardHeader className="relative pb-2">
          <CardTitle className="text-base">
            The baseline ranks on a variable that carries no health signal
          </CardTitle>
          <CardDescription>
            Correlations measured across this fleet, not assumed.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative space-y-3">
          <CorrBar
            label="Charge vs state of health"
            expr="SoC ↔ SoH"
            r={rSoc}
            verdict="what HSF sorts on"
          />
          <CorrBar
            label="Charge vs internal resistance"
            expr="SoC ↔ R_int"
            r={stats.corrSocRint}
            verdict="what HSF sorts on"
          />
          <CorrBar
            label="State of health vs internal resistance"
            expr="SoH ↔ R_int"
            r={rHealth}
            verdict="what the suitability score uses"
            good
          />
          <p className="rounded-sm bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed">
            On this fleet, knowing a pack&apos;s charge tells you{" "}
            <span className="font-medium text-foreground">
              {corrPhrase(rSoc)}
            </span>{" "}
            about its health — a full pack is neither more nor less likely to be
            a healthy one. The health parameters, by contrast, track each other
            closely enough that one predicts{" "}
            <span className="font-medium text-foreground">
              {corrPhrase(rHealth)}
            </span>{" "}
            about the other. The baseline is not choosing badly on purpose: it
            is sorting on the one column that, with respect to safety, is close
            to noise.
          </p>
        </CardContent>
      </Card>

      {/* Consequence tally */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          value={String(stats.hsfUnsafe)}
          unit={`/ ${stats.total}`}
          label="Requests HSF gave a blocked pack"
          tone={stats.hsfUnsafe > 0 ? HEALTH_VAR.unsafe : HEALTH_VAR.safe}
          note="Verification rule 1 violations"
        />
        <Stat
          value={Math.round(stats.totalExtraWatts).toLocaleString()}
          unit="W"
          label="Extra I²R heat across the run"
          tone={HSF_TONE}
          note="at each tier's peak discharge current"
        />
        <Stat
          value={`+${stats.avgSohDelta.toFixed(1)}`}
          unit="pp"
          label="Mean SoH advantage per request"
          tone={HEALTH_VAR.safe}
          note="proposed minus baseline"
        />
        <Stat
          value={String(stats.diverged)}
          unit={`/ ${stats.total}`}
          label="Requests where the picks differed"
          tone="var(--accent)"
          note="identical inputs, different outcome"
        />
      </div>
    </div>
  );
}

function CorrBar({
  label,
  expr,
  r,
  verdict,
  good = false,
}: {
  label: string;
  expr: string;
  r: number | null;
  verdict: string;
  good?: boolean;
}) {
  const mag = r == null ? 0 : Math.abs(r);
  const tone = good ? HEALTH_VAR.safe : mag < 0.2 ? HEALTH_VAR.unsafe : HSF_TONE;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate">
          {label}
          <span data-numeric className="ml-1.5 text-muted-foreground">
            {expr}
          </span>
        </span>
        <span data-numeric className="shrink-0 font-semibold" style={{ color: tone }}>
          r = {r == null ? "—" : (r >= 0 ? "+" : "") + r.toFixed(2)}
        </span>
      </div>
      {/* |r| on a 0–1 track: how much signal the variable actually carries */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary ring-1 ring-inset ring-border">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${mag * 100}%`, background: tone }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        |r| = {mag.toFixed(2)} · {corrStrength(r)} · {verdict}
      </p>
    </div>
  );
}

function Stat({
  value,
  unit,
  label,
  tone,
  note,
}: {
  value: string;
  unit?: string;
  label: string;
  tone: string;
  note: string;
}) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: `color-mix(in srgb, ${tone} 38%, transparent)` }}
    >
      <p data-numeric className="text-2xl font-semibold leading-none" style={{ color: tone }}>
        {value}
        {unit ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>
        ) : null}
      </p>
      <p className="mt-1.5 text-[11px] font-medium leading-tight">{label}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{note}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   The duel
   ══════════════════════════════════════════════════════════════ */

function Duelboard({ duel, blindfold }: { duel: Duel; blindfold: boolean }) {
  const p = duel.proposed;
  const h = duel.hsf;

  return (
    <div className="space-y-4">
      {/* Request context */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-secondary/40 px-4 py-2.5">
        <span data-numeric className="text-sm font-semibold">
          {duel.vehicleId}
        </span>
        <PriorityChip priority={duel.priority} size="sm" />
        <span className="text-[11px] text-muted-foreground">
          {[
            duel.vehicleType,
            duel.loadCategory,
            duel.rangeKm != null ? `${duel.rangeKm} km` : null,
            duel.minSoC != null ? `min SoC ${duel.minSoC.toFixed(0)}%` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span data-numeric className="ml-auto text-[11px] text-muted-foreground">
          peak draw <span className="text-foreground">{duel.peakI} A</span>
        </span>
      </div>

      {/* Blindfold banner */}
      <div
        className="flash-in rounded-lg border px-4 py-3"
        style={{
          borderColor: blindfold
            ? `color-mix(in srgb, ${HSF_TONE} 45%, transparent)`
            : `color-mix(in srgb, ${HEALTH_VAR.unsafe} 45%, transparent)`,
          background: blindfold
            ? `color-mix(in srgb, ${HSF_TONE} 9%, transparent)`
            : `color-mix(in srgb, ${HEALTH_VAR.unsafe} 9%, transparent)`,
        }}
      >
        {blindfold ? (
          <p className="text-xs leading-relaxed">
            <span className="font-semibold" style={{ color: HSF_TONE }}>
              Ranking on charge alone.
            </span>{" "}
            {h.battery_id} shows{" "}
            <span data-numeric className="font-semibold">
              {h.SoC?.toFixed(1)}%
            </span>{" "}
            against {p.battery_id}&apos;s{" "}
            <span data-numeric className="font-semibold">
              {p.SoC?.toFixed(1)}%
            </span>
            . On this one column the baseline&apos;s pick is the obvious winner —
            and this is the entire basis of its decision.
          </p>
        ) : (
          <p className="text-xs leading-relaxed">
            <span className="font-semibold" style={{ color: HEALTH_VAR.unsafe }}>
              What that column hid.
            </span>{" "}
            {h.battery_id} is{" "}
            <span className="font-semibold">{h.status}</span> —{" "}
            <span data-numeric>{h.SoH?.toFixed(1)}%</span> state of health and{" "}
            <span data-numeric>{h.R_int_mOhm?.toFixed(1)} mΩ</span> internal
            resistance against {p.battery_id}&apos;s{" "}
            <span data-numeric>{p.SoH?.toFixed(1)}%</span> and{" "}
            <span data-numeric>{p.R_int_mOhm?.toFixed(1)} mΩ</span>.
            {duel.hsfUnsafe
              ? " The safety gate had already blocked it; the baseline has no gate to consult."
              : ""}
          </p>
        )}
      </div>

      {/* Two packs */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PackColumn
          title="Proposed method"
          row={p}
          tone={PROPOSED_TONE}
          blindfold={blindfold}
          watts={duel.wattsProposed}
          peakI={duel.peakI}
          minSoC={duel.minSoC}
        />
        <PackColumn
          title="Highest-SoC-First"
          row={h}
          tone={HSF_TONE}
          blindfold={blindfold}
          watts={duel.wattsHsf}
          peakI={duel.peakI}
          minSoC={duel.minSoC}
          loser
        />
      </div>

      {/* Consequence */}
      {!blindfold ? (
        <ConsequenceStrip duel={duel} />
      ) : null}
    </div>
  );
}

function PackColumn({
  title,
  row,
  tone,
  blindfold,
  watts,
  peakI,
  minSoC,
  loser = false,
}: {
  title: string;
  row: AssignmentRow;
  tone: string;
  blindfold: boolean;
  watts: number;
  peakI: number;
  minSoC: number | null;
  loser?: boolean;
}) {
  const status = healthTone(row.status);
  const blocked = status === "unsafe";

  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        blocked && !blindfold && "hazard-stripes"
      )}
      style={
        {
          "--tone": tone,
          borderColor: `color-mix(in srgb, ${tone} 40%, transparent)`,
        } as React.CSSProperties
      }
    >
      <CardHeader className={cn("gap-2 pb-3", blocked && !blindfold && "pt-5")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: tone }}
          >
            {title}
          </span>
          {!blindfold ? <HealthBadge status={row.status} size="sm" /> : null}
        </div>
        <div className="flex items-baseline gap-2">
          <span data-numeric className="text-xl font-semibold">
            {row.battery_id}
          </span>
          {!blindfold && row.BSS != null ? (
            <span data-numeric className="text-[11px] text-muted-foreground">
              BSS {row.BSS.toFixed(1)}
            </span>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* SoC is always visible — it is the only thing HSF reads */}
        <div
          className={cn(
            "rounded-md p-2 transition-all",
            blindfold && "ring-1"
          )}
          style={
            blindfold
              ? {
                  background: `color-mix(in srgb, ${tone} 10%, transparent)`,
                  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 45%, transparent)`,
                }
              : undefined
          }
        >
          {blindfold ? (
            <div className="space-y-1.5 py-2 text-center">
              <span
                data-numeric
                className="block text-5xl font-semibold leading-none"
                style={{ color: tone }}
              >
                {row.SoC?.toFixed(1)}
                <span className="text-lg">%</span>
              </span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                state of charge — the only input
              </span>
            </div>
          ) : (
            <SocPill value={row.SoC} min={minSoC} />
          )}
        </div>

        {/* Health parameters — obscured in blindfold mode */}
        <div
          className={cn(
            "grid gap-3 transition-all duration-500 sm:grid-cols-2",
            blindfold && "pointer-events-none select-none opacity-25 blur-[5px]"
          )}
          aria-hidden={blindfold}
        >
          <div className="flex items-center gap-3">
            <SohRadial value={row.SoH} size={64} />
            <span className="text-[10px] leading-tight text-muted-foreground">
              cycles{" "}
              <span data-numeric className="text-foreground">
                {row.cycle_count ?? "—"}
              </span>
              <br />
              age{" "}
              <span data-numeric className="text-foreground">
                {row.age_years != null ? `${row.age_years.toFixed(1)} yr` : "—"}
              </span>
            </span>
          </div>
          <ThermoCard now={row.T} peak24h={row.T_24h_max} />
          <IrCard value={row.R_int_mOhm} />
          <ImbalanceSparkline
            value={row.dV_cell_mV}
            packId={row.battery_id ?? undefined}
            showCaption={false}
            height={30}
          />
        </div>

        {/* Heat readout */}
        {!blindfold ? (
          <div
            className="flex items-baseline justify-between gap-2 rounded-md px-3 py-2"
            style={{ background: `color-mix(in srgb, ${tone} 10%, transparent)` }}
          >
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              I²R at {peakI} A
            </span>
            <span data-numeric className="text-lg font-semibold" style={{ color: tone }}>
              {watts.toFixed(0)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">W</span>
            </span>
          </div>
        ) : null}

        {blindfold && loser ? (
          <p
            className="rounded-sm px-2 py-1.5 text-center text-[11px] font-medium"
            style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }}
          >
            ▲ baseline picks this one
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Per-parameter tug-of-war plus the physical bottom line. */
function ConsequenceStrip({ duel }: { duel: Duel }) {
  const p = duel.proposed;
  const h = duel.hsf;

  const rows = [
    {
      param: PARAMS.SoH,
      pv: p.SoH,
      hv: h.SoH,
      delta: duel.sohDelta,
      betterIsHigher: true,
    },
    {
      param: PARAMS.R_int,
      pv: p.R_int_mOhm,
      hv: h.R_int_mOhm,
      delta: (h.R_int_mOhm ?? 0) - (p.R_int_mOhm ?? 0),
      betterIsHigher: false,
    },
    {
      param: PARAMS.dV,
      pv: p.dV_cell_mV,
      hv: h.dV_cell_mV,
      delta: (h.dV_cell_mV ?? 0) - (p.dV_cell_mV ?? 0),
      betterIsHigher: false,
    },
    {
      param: PARAMS.SoC,
      pv: p.SoC,
      hv: h.SoC,
      delta: duel.socDelta,
      betterIsHigher: true,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-4">
        <p className="mb-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Parameter by parameter — bar leans to the better pack
        </p>
        <ul className="space-y-2.5">
          {rows.map((r) => {
            // Normalised lean, capped so one big gap doesn't flatten the rest.
            const scale =
              r.param.key === "SoH" || r.param.key === "SoC"
                ? 40
                : r.param.key === "R_int"
                  ? 60
                  : 60;
            const lean = Math.max(-1, Math.min(1, (r.delta ?? 0) / scale));
            const proposedWins = lean > 0;
            const tone = proposedWins ? PROPOSED_TONE : HSF_TONE;
            const magnitude = Math.abs(lean) * 50;
            return (
              <li key={r.param.key} className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2">
                <span data-numeric className="text-right text-[11px] tabular-nums">
                  {r.pv == null ? "—" : r.pv.toFixed(1)}
                </span>
                <span className="relative block h-5">
                  <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-secondary ring-1 ring-inset ring-border" />
                  <span
                    className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-all duration-700"
                    style={{
                      left: proposedWins ? "50%" : `${50 - magnitude}%`,
                      width: `${magnitude}%`,
                      background: tone,
                    }}
                  />
                  <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
                  <span
                    data-numeric
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap text-[9px]"
                    style={{ color: tone }}
                  >
                    {r.param.symbol}
                  </span>
                </span>
                <span data-numeric className="text-[11px] tabular-nums">
                  {r.hv == null ? "—" : r.hv.toFixed(1)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex justify-between text-[10px]">
          <span style={{ color: PROPOSED_TONE }}>← proposed better</span>
          <span style={{ color: HSF_TONE }}>baseline better →</span>
        </div>
      </div>

      {/* Bottom line */}
      <div
        className="rounded-lg border px-4 py-3"
        style={{
          borderColor: `color-mix(in srgb, ${HEALTH_VAR.unsafe} 40%, transparent)`,
          background: `color-mix(in srgb, ${HEALTH_VAR.unsafe} 7%, transparent)`,
        }}
      >
        <p className="text-xs leading-relaxed">
          <span className="font-semibold">Bottom line. </span>
          The baseline traded{" "}
          <span data-numeric className="font-semibold" style={{ color: PROPOSED_TONE }}>
            {Math.abs(duel.sohDelta).toFixed(1)} pp
          </span>{" "}
          of state of health for{" "}
          <span data-numeric className="font-semibold" style={{ color: HSF_TONE }}>
            {Math.abs(duel.socDelta).toFixed(1)} pp
          </span>{" "}
          of charge
          {duel.deltaWatts > 0.5 ? (
            <>
              , and its pack dissipates{" "}
              <span data-numeric className="font-semibold" style={{ color: HEALTH_VAR.unsafe }}>
                {duel.deltaWatts.toFixed(0)} W
              </span>{" "}
              more inside the cells at this vehicle&apos;s {duel.peakI} A peak —{" "}
              <span data-numeric>
                {(
                  (duel.wattsHsf / Math.max(duel.wattsProposed, 0.001) - 1) *
                  100
                ).toFixed(0)}
                %
              </span>{" "}
              more waste heat, on a {duel.loadCategory?.toLowerCase() ?? "duty"}{" "}
              load
              {duel.rangeKm != null ? ` over ${duel.rangeKm} km` : ""}
            </>
          ) : null}
          .
          {duel.hsfUnsafe
            ? " That pack was quarantined by the safety gate, so this allocation also breaks verification rule 1."
            : duel.hsfDegraded
              ? " That pack is Degraded, which the proposed method bars from this priority tier."
              : ""}
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Divergence ladder
   ══════════════════════════════════════════════════════════════ */

function Ladder({
  duels,
  activeId,
  onPick,
}: {
  duels: Duel[];
  activeId: string;
  onPick: (id: string) => void;
}) {
  const maxW = Math.max(...duels.map((d) => Math.abs(d.deltaWatts)), 1);

  return (
    <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-border">
      <ul className="divide-y divide-border">
        {duels.map((d) => {
          const active = d.vehicleId === activeId;
          const tone = d.hsfUnsafe
            ? HEALTH_VAR.unsafe
            : d.hsfDegraded
              ? HEALTH_VAR.degraded
              : "var(--muted-foreground)";
          return (
            <li key={d.vehicleId}>
              <button
                type="button"
                onClick={() => onPick(d.vehicleId)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "grid w-full grid-cols-[5.5rem_auto_1fr_auto] items-center gap-3 px-3 py-2 text-left transition-colors",
                  active ? "bg-secondary" : "hover:bg-secondary/50"
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span data-numeric className="truncate text-[11px] font-semibold">
                    {d.vehicleId}
                  </span>
                  <span
                    className="text-[9px] uppercase tracking-wider"
                    style={{ color: priorityColor(d.priority) }}
                  >
                    {d.priority}
                  </span>
                </span>

                <span className="flex items-center gap-1.5 text-[10px]">
                  <span data-numeric style={{ color: PROPOSED_TONE }}>
                    {d.proposed.battery_id}
                  </span>
                  <span className="text-muted-foreground">vs</span>
                  <span data-numeric style={{ color: tone }}>
                    {d.hsf.battery_id}
                  </span>
                  {d.hsfUnsafe ? (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[8px] font-semibold"
                      style={{
                        background: `color-mix(in srgb, ${HEALTH_VAR.unsafe} 18%, transparent)`,
                        color: HEALTH_VAR.unsafe,
                      }}
                    >
                      BLOCKED
                    </span>
                  ) : null}
                </span>

                <span className="relative block h-2 overflow-hidden rounded-full bg-secondary">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                    style={{
                      width: `${(Math.max(0, d.deltaWatts) / maxW) * 100}%`,
                      background: tone,
                    }}
                  />
                </span>

                {/* Sign is explicit: a negative delta means the baseline's
                    pack actually runs cooler on this pairing. */}
                <span
                  data-numeric
                  className="w-16 shrink-0 text-right text-[11px] font-semibold"
                  style={{
                    color: d.deltaWatts > 0.5 ? tone : "var(--muted-foreground)",
                  }}
                >
                  {d.deltaWatts >= 0 ? "+" : "−"}
                  {Math.abs(d.deltaWatts).toFixed(0)} W
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

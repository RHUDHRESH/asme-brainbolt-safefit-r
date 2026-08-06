/**
 * Proves the compliance block can fail.
 *
 * Runs the same verifier the Overview screen uses against real payload rows:
 * the Proposed policy must pass all five rules, and the HSF baseline — which
 * genuinely hands out quarantined packs — must fail rule 1. Rules 2-4 are also
 * exercised against hand-built violations.
 *
 *   node --experimental-strip-types web/src/lib/verification.test.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { verifyAssignments, countRequiredOutputs } from "./verification.ts";

const payload = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, "../../../outputs/run_result.json"),
    "utf-8"
  )
);

let failures = 0;
function expect(name: string, actual: unknown, wanted: unknown) {
  const ok = String(actual) === String(wanted);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  (got ${actual}, want ${wanted})`);
}

const meta = {
  source: "upload",
  batteriesFile: payload.batteries_file ?? "b.csv",
  vehiclesFile: payload.vehicles_file ?? "v.csv",
  hasConfig: Boolean(payload.config),
};

console.log("\nProposed policy — should satisfy every rule");
const proposed = verifyAssignments(payload.assignments.Proposed, meta);
expect("rules passed", proposed.filter((r) => r.pass).length, 5);
proposed.forEach((r) => console.log(`      ${r.pass ? "ok " : "RED"} ${r.id}. ${r.evidence}`));

console.log("\nHSF baseline — rule 1 must go red");
const hsf = verifyAssignments(payload.assignments.HSF, meta);
expect("rule 1 fails", hsf[0].pass, false);
expect("rule 1 counts the violations", hsf[0].evidence.startsWith("12 unsafe"), true);
expect("rules 2 and 3 still hold", hsf[1].pass && hsf[2].pass, true);

console.log("\nInjected violations — each rule must catch its own");
const clean = payload.assignments.Proposed;

const dupPack = clean.map((r: Record<string, unknown>, i: number) =>
  i === 1 ? { ...r, battery_id: clean[0].battery_id } : r
);
expect("duplicate pack caught", verifyAssignments(dupPack, meta)[1].pass, false);

const dupVehicle = clean.map((r: Record<string, unknown>, i: number) =>
  i === 1 ? { ...r, vehicle_id: clean[0].vehicle_id } : r
);
expect("duplicate vehicle caught", verifyAssignments(dupVehicle, meta)[2].pass, false);

const socBreach = clean.map((r: Record<string, unknown>, i: number) =>
  i === 0 ? { ...r, SoC: 1, min_SoC: 99 } : r
);
expect("SoC breach caught", verifyAssignments(socBreach, meta)[3].pass, false);

expect(
  "unverifiable provenance caught",
  verifyAssignments(clean, { source: "csv" })[4].pass,
  false
);

console.log("\nRequired outputs");
expect(
  "6 of 6 present",
  countRequiredOutputs(payload.comparison.Proposed).present,
  6
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

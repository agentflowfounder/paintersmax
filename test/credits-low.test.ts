import test from "node:test";
import assert from "node:assert/strict";
import { lowBalance } from "../src/credits.ts";

const g = (credits: number, on: string, expiresOn: string) => ({ id: on, credits, on, expiresOn, source: "allowance" as const, note: "" });

test("low balance shows at 20% or less of recent credits", () => {
  const grants = [g(400, "2026-11-01", "2027-01-30")];
  assert.equal(lowBalance(grants, 81, "2026-11-16").low, false);
  assert.equal(lowBalance(grants, 80, "2026-11-16").low, true);
  assert.equal(lowBalance(grants, 0, "2026-11-16").low, true);
  assert.equal(lowBalance(grants, 80, "2026-11-16").threshold, 80);
});
test("no credits ever: only an empty balance is low", () => {
  assert.equal(lowBalance([], 0, "2026-11-16").low, true);
  assert.equal(lowBalance([], 5, "2026-11-16").low, false);
});
test("old expired grants do not count toward the reference", () => {
  const grants = [g(1000, "2026-01-01", "2026-03-01"), g(100, "2026-11-10", "2027-02-01")];
  assert.equal(lowBalance(grants, 21, "2026-11-16").low, false);
  assert.equal(lowBalance(grants, 20, "2026-11-16").low, true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFindings, priceIssue, allowanceNote, withPrices } from "../src/photoanalysis.ts";

const raw = { summary: "Ceiling stain", issues: [{ title: "Water stain", severity: "high", what: "x", fix: "y", hours: 2.3, materials: [{ item: "Primer", costLow: 30, costHigh: 20 }] }, { title: "" }, "bad"] };

test("clean keeps valid issues and fixes ranges", () => {
  const f = cleanFindings(raw);
  assert.equal(f.issues.length, 1);
  assert.equal(f.issues[0].hours, 2.25);
  assert.equal(f.issues[0].materials[0].costHigh, 30);
  assert.deepEqual(cleanFindings(null), { summary: "", issues: [] });
});
test("prices come from the painter's rate, by code", () => {
  const i = cleanFindings(raw).issues[0];
  assert.equal(priceIssue(i, {}), null);
  const p = priceIssue(i, { hourlyRate: 60, markupPct: 20, overheadPct: 10 })!;
  assert.equal(p.costLowCents, 2.25 * 60 * 100 + 3000);
  assert.ok(p.chargeLowCents > p.costLowCents);
  assert.equal(p.chargeLowCents % 500, 0);
  assert.equal(withPrices(cleanFindings(raw), { hourlyRate: 60 }).issues[0].price !== null, true);
});
test("allowance note offers an upgrade from 80%", () => {
  assert.equal(allowanceNote(5, 10, "starter").upgrade, false);
  const n = allowanceNote(8, 10, "starter");
  assert.equal(n.upgrade, true);
  assert.ok(n.message.includes("2 photo analyses left"));
  assert.equal(allowanceNote(10, 10, "pro").upgrade, false);
});

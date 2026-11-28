import test from "node:test";
import assert from "node:assert/strict";
import { CITY_SELECT_MAX, TRADES, sanitizeProfile } from "../src/profile.ts";

test("every plan can pick every service and many cities, with a hard ceiling on cities", () => {
  const all = sanitizeProfile({ trades: [...TRADES, "nonsense"] }, "free");
  assert.equal(all.trades.length, TRADES.length);
  for (const t of ["accent_walls", "decorative_painting", "decorative_texture", "parking_lot_striping", "glow_paint"]) assert.ok(all.trades.includes(t as any), t);
  const many = sanitizeProfile({ cities: Array.from({ length: 80 }, (_, i) => `City${i}, TX`) }, "free");
  assert.equal(many.cities.length, CITY_SELECT_MAX);
});

test("business facts keep only known choices", () => {
  const p = sanitizeProfile({ business: { type: "llc", yearsIn: "7", monthlyGoal: "$20,000", jobsGoal: 12, leadSources: ["google", "bogus", "google"], payMethods: ["zelle", "gold"], accounting: "quickbooks", payFrequency: "weekly" } }, "starter");
  assert.equal(p.business.type, "llc");
  assert.equal(p.business.yearsIn, 7);
  assert.equal(p.business.monthlyGoal, undefined, "a dollar sign is not a number here, the page sends plain digits");
  assert.equal(p.business.jobsGoal, 12);
  assert.deepEqual(p.business.leadSources, ["google"]);
  assert.deepEqual(p.business.payMethods, ["zelle"]);
  const bad = sanitizeProfile({ business: { type: "weird", payFrequency: "daily", accounting: "x" } }, "starter");
  assert.equal(bad.business.type, undefined);
  assert.equal(bad.business.payFrequency, undefined);
  assert.equal(bad.business.accounting, undefined);
});

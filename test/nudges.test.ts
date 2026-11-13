import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNudges } from "../src/nudges.ts";

const base = { tradesWithoutPrices: [], staleDraftEstimates: 0, cityDraftPages: 0, commercialBidUnused: false };
const now = Date.parse("2026-11-13T00:00:00Z");

test("no facts, no nudges", () => assert.deepEqual(buildNudges(base, {}, now), []));
test("at most two, in priority order", () => {
  const n = buildNudges({ tradesWithoutPrices: ["power washing"], staleDraftEstimates: 2, cityDraftPages: 1, commercialBidUnused: true }, {}, now);
  assert.equal(n.length, 2);
  assert.equal(n[0].key, "draft_estimates");
  assert.equal(n[1].key, "missing_prices");
  assert.ok(n[0].text.includes("2 saved estimates") && n[0].text.includes("have not"));
});
test("a snoozed nudge is skipped until the date passes", () => {
  const f = { ...base, staleDraftEstimates: 1, cityDraftPages: 1 };
  const s = { draft_estimates: "2026-11-20T00:00:00Z" };
  assert.deepEqual(buildNudges(f, s, now).map((x) => x.key), ["city_drafts"]);
  assert.deepEqual(buildNudges(f, s, Date.parse("2026-11-21T00:00:00Z")).map((x) => x.key), ["draft_estimates", "city_drafts"]);
});

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

test("warranty ending nudge", async () => {
  const { buildNudges } = await import("../src/nudges.ts");
  const base = { tradesWithoutPrices: [], staleDraftEstimates: 0, cityDraftPages: 0, commercialBidUnused: false };
  assert.equal(buildNudges({ ...base, warrantiesEnding: 0 }, {}).length, 0);
  const n = buildNudges({ ...base, warrantiesEnding: 2 }, {});
  assert.equal(n[0].key, "warranty_ending");
  assert.ok(n[0].text.startsWith("2 warranties end"));
});

test("storage and download reminders", () => {
  const b = { tradesWithoutPrices: [], staleDraftEstimates: 0, cityDraftPages: 0, commercialBidUnused: false };
  assert.equal(buildNudges({ ...b, plan: "free", storagePercent: 79, daysSinceDownload: 10, month: 6 }, {}).length, 0);
  const hi = buildNudges({ ...b, plan: "free", storagePercent: 85, month: 6 }, {});
  assert.equal(hi[0].key, "storage_high");
  assert.ok(hi[0].text.includes("85%"));
  assert.equal(buildNudges({ ...b, plan: "free", daysSinceDownload: 91, month: 6 }, [] as any)[0].key, "download_records");
  assert.equal(buildNudges({ ...b, plan: "free", daysSinceDownload: 89, month: 6 }, {}).length, 0);
  assert.equal(buildNudges({ ...b, plan: "basic", daysSinceDownload: 200, month: 6 }, {}).length, 0); // yearly
  assert.equal(buildNudges({ ...b, plan: "starter", daysSinceDownload: 190, month: 6 }, {})[0].key, "download_records");
  assert.equal(buildNudges({ ...b, plan: "pro", daysSinceDownload: 31, month: 6 }, {})[0].key, "download_records");
  const tax = buildNudges({ ...b, plan: "basic", daysSinceDownload: 5, month: 2, downloadedThisTaxYear: false }, {});
  assert.equal(tax[0].key, "tax_season");
  assert.equal(buildNudges({ ...b, plan: "basic", month: 2, downloadedThisTaxYear: true }, {}).length, 0);
  assert.equal(buildNudges({ ...b, plan: "pro", storagePercent: 90, daysSinceDownload: 40, month: 6 }, {}).length, 2); // limited to two
});

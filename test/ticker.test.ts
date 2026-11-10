import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildItems, formatStat, sanitizeTickerConfig, STATS } from "../src/ticker.ts";

const def = (k: string) => STATS.find((s) => s.key === k)!;

describe("ticker", () => {
  it("is off by default and drops unknown stats", () => {
    const c = sanitizeTickerConfig({ stats: ["leads_total", "evil", 5, "leads_total"], minValue: -3 });
    assert.equal(c.enabled, false);
    assert.deepEqual(c.stats, ["leads_total"]);
    assert.equal(c.minValue, 0);
  });
  it("enabled only when exactly true", () => {
    assert.equal(sanitizeTickerConfig({ enabled: "yes" }).enabled, false);
    assert.equal(sanitizeTickerConfig({ enabled: true }).enabled, true);
  });
  it("formats counts and dollars", () => {
    assert.equal(formatStat(def("leads_total"), 1234), "1,234");
    assert.equal(formatStat(def("work_won_cents"), 62_800_00), "$62,800");
    assert.equal(formatStat(def("work_won_cents"), 25_000_000_00 / 10), "$2.5M");
    assert.equal(formatStat(def("work_won_cents"), 1_500_000), "$15,000");
  });
  it("hides zero stats and stats under the minimum, never invents values", () => {
    const cfg = { enabled: true, stats: ["leads_total", "companies_total", "work_won_cents", "jobs_total"], minValue: 5 };
    const items = buildItems(cfg, { leads_total: 12, companies_total: 3, work_won_cents: 0 });
    assert.deepEqual(items.map((i) => i.key), ["leads_total"]);
  });
  it("every stat has a unique key", () => {
    assert.equal(new Set(STATS.map((s) => s.key)).size, STATS.length);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS, LEVEL_FILLS, MASTER_UPLIFT, levelsFor, catalogItem, catalogItems, catalogKeyFor, catalogKeys, EXAMPLES, labelsFor, parseMarkets, priceFor, rangeFor, roundPrice, sanityNote, seedData, shortUnit } from "../src/ratecatalog.ts";
import { draftLines } from "../src/estimate.ts";
import { sanitizeRateData } from "../src/profile.ts";

test("every price list has items and low is not above high", () => {
  assert.deepEqual(catalogKeys().sort(), ["builder", "cabinets", "commercial", "decks_fences", "epoxy_floors", "exterior", "interior", "power_washing"]);
  for (const k of catalogKeys()) {
    assert.ok(catalogItems(k).length > 0, k);
    for (const it of catalogItems(k)) {
      assert.ok(it.low > 0 && it.low <= it.high, it.id);
      assert.match(it.id, /^[A-Za-z0-9_]{1,40}$/, it.id);
    }
  }
});

test("Value is the low rate, Premium the high rate, Standard the average", () => {
  const door = catalogItems("cabinets").find((i) => i.label === "Standard Cabinet Door")!;
  assert.equal(priceFor(door, 0), 100);
  assert.equal(priceFor(door, 1), 145); // (100 + 185) / 2 = 142.5 rounds to the nearest $5
  assert.equal(priceFor(door, 2), 185);
});

test("market multiplier scales the price and rounding stays quotable", () => {
  const door = catalogItems("cabinets").find((i) => i.label === "Standard Cabinet Door")!;
  assert.equal(priceFor(door, 1, 1.15), 165);
  assert.equal(roundPrice(0.1234), 0.1);
  assert.equal(roundPrice(2.337), 2.35);
  assert.equal(roundPrice(37.4), 37);
  assert.equal(roundPrice(1234), 1235);
  assert.deepEqual(rangeFor({ low: 100, high: 200 }, 1.1), [110, 220]);
});

test("seed data covers every item with a positive number", () => {
  const d = seedData("interior", 1, 1);
  assert.equal(Object.keys(d).length, catalogItems("interior").length);
  assert.ok(Object.values(d).every((v) => v > 0));
  assert.deepEqual(sanitizeRateData({ ...d, position: 1, tier: 1 }), { ...d, position: 1, tier: 1 });
});

test("sanity notes flag unusual prices only", () => {
  const it = { low: 100, high: 200 };
  assert.equal(sanityNote(50, it), "below");
  assert.equal(sanityNote(150, it), null);
  assert.equal(sanityNote(300, it), "above");
  assert.equal(sanityNote(0, it), null);
  assert.equal(sanityNote(110, it, 1.15), null);
});

test("builder cards use the builder list, trades without a list return null", () => {
  assert.equal(catalogKeyFor("interior", "builder"), "builder");
  assert.equal(catalogKeyFor("cabinets", "retail"), "cabinets");
  assert.equal(catalogKeyFor("drywall", "retail"), null);
  assert.equal(catalogKeyFor("new_construction", "retail"), null);
});

test("market levels fall back to defaults and clamp", () => {
  assert.deepEqual(parseMarkets(undefined), { high: 1.15, average: 1, low: 0.88 });
  assert.deepEqual(parseMarkets({ high: 3, average: "1.05", low: 0.2 }), { high: 1.15, average: 1.05, low: 0.88 });
  assert.deepEqual(parseMarkets("not json"), { high: 1.15, average: 1, low: 0.88 });
});

test("units are short and readable", () => {
  assert.equal(shortUnit("Per Door"), "door");
  assert.equal(shortUnit("Per Linear Ft"), "ft");
  assert.equal(shortUnit("Flat Fee"), "flat");
});

test("catalog rate cards become estimate lines from typed quantities", () => {
  const data = { ...seedData("cabinets", 0, 1), position: 0, tier: 1 };
  const door = catalogItems("cabinets").find((i) => i.label === "Standard Cabinet Door")!;
  const lines = draftLines("catalog", data, { [door.id]: 20 }, "cabinets");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, "Standard Cabinet Door");
  assert.equal(lines[0].unit, "door");
  assert.equal(lines[0].unitCents, 10000);
  assert.deepEqual(draftLines("catalog", data, { position: 2 }, "cabinets"), []);
});

test("labels come back only for catalog ids", () => {
  const door = catalogItems("cabinets")[0];
  assert.deepEqual(labelsFor({ [door.id]: 100, position: 1, small: 5 }), { [door.id]: { label: door.label, unit: "door" } });
});

test("every example matches a real item in its list", () => {
  for (const [key, ex] of Object.entries(EXAMPLES)) {
    for (const [match] of ex.parts) {
      assert.ok(catalogItems(key).some((i) => i.label.startsWith(match) || i.label.includes(match)), `${key}: ${match}`);
    }
  }
  assert.ok(catalogItem(catalogItems("interior")[0].id));
});

import { buildSections, renderRateCardHtml } from "../src/ratecardpdf.ts";

test("printable rate card lists priced catalog items and the older fill-in cards, escapes text, and honors the brand line", () => {
  const door = catalogItems("cabinets").find((i) => i.label === "Standard Cabinet Door")!;
  const sections = buildSections(
    [
      { trade: "cabinets", audience: "retail", method: "catalog", data: { [door.id]: 145, position: 1 } },
      { trade: "interior", audience: "retail", method: "room_size", data: { small: 100 } },
      { trade: "interior", audience: "builder", method: "catalog", data: { bd_nothing: 5 } },
    ],
    "retail",
  );
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, "Cabinet painting");
  assert.equal(sections[0].level, "standard");
  assert.equal(sections[0].groups[0].rows.length, 1);
  assert.equal(sections[1].title, "Interior painting");
  assert.equal(sections[1].groups[0].rows[0].label.startsWith("Small room"), true);
  const base = { company: { name: "A <b>&</b> Co" }, title: "Rate card", date: "2026-11-12" };
  const on = renderRateCardHtml({ ...base, preparedWith: true }, sections);
  const off = renderRateCardHtml({ ...base, preparedWith: false }, sections);
  assert.ok(on.includes("Prepared with PaintersMax"));
  assert.ok(!off.includes("Prepared with PaintersMax"));
  assert.ok(on.includes("A &lt;b&gt;&amp;&lt;/b&gt; Co"));
  assert.ok(on.includes("$145"));
  assert.ok(renderRateCardHtml({ ...base, preparedWith: true }, []).includes("No prices yet."));
});

test("older fill-in cards print ranges and percentages, and empty cards print nothing", () => {
  const sections = buildSections(
    [
      { trade: "drywall", audience: "retail", method: "sqft_floor", data: { low: 2, high: 3.5, minimum: 150 } },
      { trade: "interior", audience: "retail", method: "room_size", data: { small: "120", high_ceiling_pct: 15 } },
      { trade: "fencing", audience: "retail", method: "per_linear_ft", data: {} },
    ],
    "retail",
  );
  assert.equal(sections.length, 2);
  const dry = sections.find((s) => s.title === "Drywall repair")!;
  assert.equal(dry.groups[0].rows[0].priceTo, 3.5);
  assert.equal(dry.groups[0].rows[1].label, "Minimum job");
  const room = sections.find((s) => s.title === "Interior painting")!;
  assert.equal(room.groups[0].rows.find((r) => r.pct)?.price, 15);
  const html = renderRateCardHtml({ company: { name: "Co" }, title: "Rate card", date: "2026-11-13", preparedWith: false }, sections);
  assert.ok(html.includes("$2 to $3.50"));
  assert.ok(html.includes("15%"));
});

test("master level is above premium, which is above standard, which is above value", () => {
  for (const key of catalogKeys()) {
    for (const it of catalogItems(key)) {
      const p = [0, 1, 2, 3].map((n) => priceFor(it, n as 0 | 1 | 2 | 3, 1));
      assert.ok(p[0] <= p[1] && p[1] <= p[2] && p[2] <= p[3], `${key} ${it.id} ${p.join(",")}`);
      assert.equal(p[3], roundPrice(it.high * MASTER_UPLIFT));
    }
  }
});

test("every service names its pricing levels, and power washing has three", () => {
  for (const key of catalogKeys()) {
    const l = levelsFor(key);
    assert.equal(l.names.length, l.help.length);
    assert.ok(l.names.length === 3 || l.names.length === 4);
  }
  assert.deepEqual(LEVELS.power_washing.names, ["Value", "Residential", "Commercial"]);
  assert.equal(levelsFor("interior").names[3], "Master");
});

test("starting numbers for the form-based services rise with each level", () => {
  for (const [trade, f] of Object.entries(LEVEL_FILLS)) {
    for (const [field, nums] of Object.entries(f.fields)) {
      assert.equal(nums.length, 4, `${trade} ${field}`);
      for (let i = 1; i < 4; i++) assert.ok(nums[i] > nums[i - 1], `${trade} ${field} rises`);
    }
    for (let i = 0; i < 4; i++) assert.ok(!f.fields.low || f.fields.low[i] <= f.fields.high[i]);
  }
});

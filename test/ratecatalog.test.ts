import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogItem, catalogItems, catalogKeyFor, catalogKeys, EXAMPLES, labelsFor, parseMarkets, priceFor, rangeFor, roundPrice, sanityNote, seedData, shortUnit } from "../src/ratecatalog.ts";
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

test("printable rate card lists only priced catalog items, escapes text, and honors the brand line", () => {
  const door = catalogItems("cabinets").find((i) => i.label === "Standard Cabinet Door")!;
  const sections = buildSections(
    [
      { trade: "cabinets", audience: "retail", method: "catalog", data: { [door.id]: 145, position: 1 } },
      { trade: "interior", audience: "retail", method: "room_size", data: { small: 100 } },
      { trade: "interior", audience: "builder", method: "catalog", data: { bd_nothing: 5 } },
    ],
    "retail",
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "Cabinet painting");
  assert.equal(sections[0].level, "standard");
  assert.equal(sections[0].groups[0].rows.length, 1);
  const base = { company: { name: "A <b>&</b> Co" }, title: "Rate card", date: "2026-11-12" };
  const on = renderRateCardHtml({ ...base, preparedWith: true }, sections);
  const off = renderRateCardHtml({ ...base, preparedWith: false }, sections);
  assert.ok(on.includes("Prepared with PaintersMax"));
  assert.ok(!off.includes("Prepared with PaintersMax"));
  assert.ok(on.includes("A &lt;b&gt;&amp;&lt;/b&gt; Co"));
  assert.ok(on.includes("$145"));
  assert.ok(renderRateCardHtml({ ...base, preparedWith: true }, []).includes("No prices yet."));
});

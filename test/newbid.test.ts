import test from "node:test";
import assert from "node:assert/strict";
import { cleanBid, cleanToolPrefs, formatPhone, layoutsFor, parseQuickPrice, serviceFor, SERVICES } from "../src/services.ts";
import { partsFromComponents, splitOneLine } from "../src/address.ts";
import { cleanNote } from "../src/fieldnotes.ts";

test("every service the painter can pick has its own bid screen", () => {
  for (const t of ["interior", "exterior", "commercial", "new_construction", "power_washing", "drywall", "cabinets", "decks_fences", "fencing", "remodeling", "epoxy_floors", "industrial"]) {
    const s = serviceFor(t);
    assert.equal(s.trade, t);
    assert.ok(s.picks.length >= 5 && s.tools.length >= 3, t);
    assert.equal(new Set(s.tools.map((x) => x.id)).size, s.tools.length, `${t} tool ids are unique`);
  }
  assert.equal(serviceFor("drywall").label, "Drywall install and repair");
  assert.equal(serviceFor("nonsense").trade, "interior");
});

test("the painter's tool choices are kept per service, and unknown ones dropped", () => {
  const prefs = cleanToolPrefs({ interior: { colors: false, bogus: true }, nope: { x: true }, exterior: "no" });
  assert.deepEqual(prefs, { interior: { colors: false } });
  const L = layoutsFor(prefs);
  assert.equal(L.find((s) => s.trade === "interior")!.tools.find((t) => t.id === "colors")!.on, false);
  assert.equal(L.find((s) => s.trade === "exterior")!.tools.find((t) => t.id === "weather")!.on, true);
  assert.equal(SERVICES.find((s) => s.trade === "interior")!.tools.find((t) => t.id === "colors")!.on, true, "defaults stay untouched");
});

test("a bid keeps only picks and tools that belong to its service", () => {
  assert.deepEqual(cleanBid({ picks: ["Walls", "Walls", "Siding", 3], tools: ["colors", "weather"] }, "interior"), { picks: ["Walls"], tools: ["colors"] });
  assert.deepEqual(cleanBid(null, "exterior"), { picks: [], tools: [] });
});

test("phone numbers are shown the US way", () => {
  assert.equal(formatPhone("2145550123"), "(214) 555-0123");
  assert.equal(formatPhone("1-214-555-0123"), "(214) 555-0123");
  assert.equal(formatPhone("+52 55 1234 5678"), "+52 55 1234 5678");
  assert.equal(formatPhone(""), "");
});

test("a quick price answer is checked before it is shown", () => {
  assert.deepEqual(parseQuickPrice({ low: 1800, high: 2400, reason: "Three rooms, two coats.", steps: ["Measure", 4, ""] }), { lowCents: 180000, highCents: 240000, reason: "Three rooms, two coats.", steps: ["Measure"] });
  assert.equal(parseQuickPrice({ low: 2400, high: 1800 }), null);
  assert.equal(parseQuickPrice({ low: 0, high: 100 }), null);
  assert.equal(parseQuickPrice("nope"), null);
});

test("an address from the lookup fills street, city, state and ZIP", () => {
  const p = partsFromComponents([
    { types: ["street_number"], longText: "123" },
    { types: ["route"], longText: "Main Street" },
    { types: ["subpremise"], longText: "4B" },
    { types: ["locality", "political"], longText: "Dallas" },
    { types: ["administrative_area_level_1"], longText: "Texas", shortText: "TX" },
    { types: ["postal_code"], longText: "75201" },
  ]);
  assert.deepEqual(p, { address: "123 Main Street #4B", city: "Dallas", state: "TX", zip: "75201" });
  assert.deepEqual(splitOneLine("123 Main St, Dallas, TX 75201"), { address: "123 Main St", city: "Dallas", state: "TX", zip: "75201" });
  assert.deepEqual(splitOneLine("9 Oak Ln, Tyler tx 75701-1234"), { address: "9 Oak Ln", city: "Tyler", state: "TX", zip: "75701" });
  assert.equal(splitOneLine("123 Main St"), null);
});

test("a note keeps its photos", () => {
  const n = cleanNote({ text: "Hall ceiling stain", photos: [5, "6", 5, -1, 2.5] }, "2026-11-24T00:00:00.000Z")!;
  assert.deepEqual(n.photos, [5, 6]);
  assert.equal(cleanNote({ text: "No photos" }, "2026-11-24T00:00:00.000Z")!.photos, undefined);
});

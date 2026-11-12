import { test } from "node:test";
import assert from "node:assert/strict";
import { cityKey, citySlug, miles, parseGeocode, parseTigerPlaces, parseAcs, censusRows, parseCbp, isStale } from "../src/cities.ts";

test("keys and slugs", () => {
  assert.equal(cityKey("Plano", "TX"), "tx-plano");
  assert.equal(citySlug("Fort Worth", "TX"), "fort-worth-tx");
});
test("miles is roughly right", () => {
  const d = miles(32.7767, -96.797, 33.0198, -96.6989); // Dallas to Plano
  assert.ok(d > 15 && d < 22);
  assert.equal(Math.round(miles(1, 1, 1, 1)), 0);
});
test("parseGeocode reads a city and ZIP", () => {
  const j = { status: "OK", results: [{ geometry: { location: { lat: 33.01, lng: -96.7 } }, address_components: [
    { long_name: "Plano", short_name: "Plano", types: ["locality"] },
    { long_name: "Texas", short_name: "TX", types: ["administrative_area_level_1"] },
    { long_name: "75024", short_name: "75024", types: ["postal_code"] }] }] };
  const c = parseGeocode(j)!;
  assert.equal(c.key, "tx-plano");
  assert.equal(c.zip, "75024");
  assert.equal(parseGeocode({ status: "ZERO_RESULTS", results: [] }), null);
});
test("parseTigerPlaces skips bad rows", () => {
  const out = parseTigerPlaces({ features: [
    { attributes: { BASENAME: "Allen", STATE: "48", PLACE: "01924", CENTLAT: "33.1", CENTLON: "-96.67", POP100: 104627 } },
    { attributes: { BASENAME: "", STATE: "48" } }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].key, "tx-allen");
  assert.equal(out[0].placeFips, "01924");
});
test("parseAcs and null values", () => {
  const rows = [["B01003_001E", "B11001_001E", "B25001_001E", "B25003_002E", "B25003_003E", "B25077_001E", "B25035_001E", "B19013_001E", "state"],
    ["290000", "110000", "115000", "70000", "40000", "450000", "1998", "-666666666", "48"]];
  assert.equal(censusRows(rows).length, 1);
  const f = parseAcs(rows)!;
  assert.equal(f.population, 290000);
  assert.equal(f.medianYearBuilt, 1998);
  assert.equal(f.medianHouseholdIncome, null); // Census sentinel must not become a fact
  assert.equal(parseAcs([]), null);
});
test("parseCbp", () => {
  assert.deepEqual(parseCbp([{ ESTAB: "1200" }], "Retail stores"), { label: "Retail stores", establishments: 1200 });
  assert.equal(parseCbp([], "x"), null);
});
test("isStale", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  assert.equal(isStale(null, 365, now), true);
  assert.equal(isStale("2026-10-01T00:00:00Z", 365, now), false);
  assert.equal(isStale("2025-01-01T00:00:00Z", 365, now), true);
});

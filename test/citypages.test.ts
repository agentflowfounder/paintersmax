import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCityPage, publishBlocker, factLines, renderCityPage, parseWeather, defaultPage } from "../src/citypages.ts";

const ctx = (over: any = {}) => ({
  company: { slug: "rivera", name: "Rivera <Painting>", settings: { brandColor: "#112233" }, phone: "(214) 555-0100" },
  city: { key: "tx-plano", name: "Plano", state: "TX", lat: 33, lng: -96.7 },
  data: cleanCityPage({ headline: "Painters in Plano", intro: "Hello", local: "x".repeat(50), faq: [{ q: "Q?", a: "A." }] }),
  facts: null, construction: null, weather: null, browserKey: null, canonical: "https://rivera.example/areas/plano-tx", noindex: false, others: [], ...over,
});

test("publish needs a headline and a real local detail", () => {
  assert.ok(publishBlocker(cleanCityPage({ headline: "H", local: "short" })));
  assert.ok(publishBlocker(cleanCityPage({ local: "x".repeat(60) })));
  assert.equal(publishBlocker(cleanCityPage({ headline: "H", local: "x".repeat(60) })), null);
});
test("clean drops bad photo links and caps lists", () => {
  const d = cleanCityPage({ gallery: [{ url: "javascript:alert(1)" }, { url: "https://ok.example/a.jpg", caption: "c" }], services: Array(30).fill("a") });
  assert.equal(d.gallery.length, 1);
  assert.equal(d.services.length, 12);
});
test("facts leave out what is missing", () => {
  assert.deepEqual(factLines(null, null, "Plano"), []);
  const l = factLines({ population: 290000, households: null, housingUnits: null, ownerOccupied: null, renterOccupied: null, medianHomeValue: null, medianYearBuilt: 1998, medianHouseholdIncome: null, businesses: [], source: "" }, { buildings: 1200, year: 2025 }, "Plano");
  assert.equal(l.length, 3);
  assert.ok(l[0].includes("290,000"));
});
test("page escapes text, includes canonical and JSON-LD, omits map without key", () => {
  const h = renderCityPage(ctx());
  assert.ok(h.includes("Rivera &lt;Painting&gt;"));
  assert.ok(!h.includes("Rivera <Painting>"));
  assert.ok(h.includes('rel="canonical" href="https://rivera.example/areas/plano-tx"'));
  assert.ok(h.includes("FAQPage") && h.includes("HousePainter"));
  assert.ok(!h.includes("maps/embed"));
  assert.ok(!h.includes("noindex"));
});
test("map and weather show when available; preview is noindex", () => {
  const h = renderCityPage(ctx({ browserKey: "KEY", weather: { temp: 71.6, unit: "F", text: "Sunny" }, noindex: true }));
  assert.ok(h.includes("maps/embed/v1/search") && h.includes("Sherwin-Williams") && h.includes("Ace Hardware"));
  assert.ok(h.includes("72&deg;F"));
  assert.ok(h.includes('name="robots" content="noindex"') || h.includes('content="noindex"'));
});
test("weather parser and defaults", () => {
  assert.deepEqual(parseWeather({ temperature: { degrees: 20, unit: "CELSIUS" }, weatherCondition: { description: { text: "Clear" } } }), { temp: 20, unit: "C", text: "Clear" });
  assert.equal(parseWeather({}), null);
  assert.deepEqual(defaultPage("Plano", "TX", ["interior", "bogus"]).services, ["Interior painting"]);
});

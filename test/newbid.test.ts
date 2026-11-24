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

test("paid plans use Gemini voice typing, the Free plan and a missing key use the phone's speech", async () => {
  const { chooseEngine } = await import("../src/voicesession.ts");
  assert.equal(chooseEngine("basic", true), "gemini");
  assert.equal(chooseEngine("pro", true), "gemini");
  assert.equal(chooseEngine("free", true), "device");
  assert.equal(chooseEngine("basic", false), "device");
});

test("an archived job leaves every list and shows only in Archived", async () => {
  const { bucketFor } = await import("../src/pipeline.ts");
  assert.equal(bucketFor({ stage: "lead", today: "2026-11-24", archived: true }), "archived");
  assert.equal(bucketFor({ stage: "lost", today: "2026-11-24", archived: true }), "archived");
  assert.equal(bucketFor({ stage: "lead", today: "2026-11-24" }), "new");
});

test("Ask conversations get a topic and a short title", async () => {
  const { topicOf, titleOf } = await import("../src/askhistory.ts");
  assert.equal(topicOf("What primer covers water stains?"), "products");
  assert.equal(topicOf("How do I send an estimate in PaintersMax?"), "platform");
  assert.equal(topicOf("How do I answer a customer who says my price is too high?"), "pricing");
  assert.equal(topicOf("hello there"), "general");
  assert.equal(titleOf("  How do I ask for a deposit politely?  "), "How do I ask for a deposit politely");
  assert.ok(titleOf("x ".repeat(100)).length <= 60);
  assert.equal(titleOf(""), "Conversation");
});

test("the painter's word list fixes whole words only and keeps the painter's own pairs clean", async () => {
  const { applyWords, cleanWords, DEFAULT_WORDS } = await import("../src/wordlist.ts");
  assert.equal(applyWords("Hang sheet rock and Sherman Williams paint", DEFAULT_WORDS), "Hang Sheetrock and Sherwin-Williams paint");
  assert.equal(applyWords("the estimated bed is ready", DEFAULT_WORDS), "the estimate bid is ready");
  assert.equal(applyWords("dry walls", [["dry wall", "drywall"]]), "dry walls", "does not change part of a longer word");
  assert.deepEqual(cleanWords([["Sheet Rock", "Sheetrock"], ["sheet rock", "x"], ["", "y"], ["same", "Same"], "bad"]), [["sheet rock", "Sheetrock"]]);
});

test("a paused job leaves the open list until its wake-up day", async () => {
  const { bucketFor } = await import("../src/pipeline.ts");
  assert.equal(bucketFor({ stage: "bid", today: "2026-11-24", pausedUntil: "2026-12-01" }), "paused");
  assert.equal(bucketFor({ stage: "bid", today: "2026-12-01", pausedUntil: "2026-12-01" }), "estimates");
  assert.equal(bucketFor({ stage: "closed", today: "2026-11-24", pausedUntil: "2026-12-01" }), "paid");
});

test("a job report shows profit, timeline gaps and missing records plainly", async () => {
  const { buildReport, daysBetween } = await import("../src/jobreport.ts");
  assert.equal(daysBetween("2026-11-01", "2026-11-04"), 3);
  assert.equal(daysBetween("2026-11-04", "2026-11-01"), null);
  assert.equal(daysBetween("", "2026-11-01"), null);
  const base = {
    priceCents: 400000, changeCents: 20000, collectedCents: 420000, categories: [{ category: "Materials", cents: 80000 }, { category: "Fuel", cents: 5000 }], payCents: 150000,
    minutes: 3000, estimatedMinutes: 2400, workers: [{ name: "Luis", minutes: 3000 }],
    dates: { lead: "2026-11-01", estimate: "2026-11-02", signed: "2026-11-12", start: "2026-11-15", end: "2026-11-17", invoice: "2026-11-18", paid: "2026-12-05", warranty: "2026-12-05" },
    have: { photos: 4, notes: 3, signedEstimate: true, contract: true, expenses: 2, hours: true, invoice: true, warranty: false, signoff: true },
    avg: { marginPct: 40, priceCents: 350000, jobs: 5 },
  };
  const r = buildReport(base);
  assert.equal(r.money.totalCents, 420000);
  assert.equal(r.money.costCents, 235000);
  assert.equal(r.money.profitCents, 185000);
  assert.equal(r.money.marginPct, 44.0);
  assert.equal(r.days.estimateToSigned, 10);
  assert.equal(r.days.workDays, 3);
  assert.equal(r.days.invoiceToPaid, 17);
  assert.equal(r.hours.overPct, 25);
  assert.equal(r.recordsDone, 8);
  assert.ok(r.insights.some((x) => x.includes("above your average")));
  assert.ok(r.insights.some((x) => x.includes("took 10 days to sign")));
  const none = buildReport({ ...base, categories: [], payCents: 0, minutes: 0, estimatedMinutes: null, workers: [], avg: { marginPct: null, priceCents: null, jobs: 0 } });
  assert.equal(none.money.profitCents, null, "no costs recorded is not shown as 100% profit");
  assert.ok(none.insights[0].includes("profit cannot be shown"));
});

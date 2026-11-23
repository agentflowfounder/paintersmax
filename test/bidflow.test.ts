import test from "node:test";
import assert from "node:assert/strict";
import { bucketFor } from "../src/pipeline.ts";
import { addNote, cleanColors, cleanNote, cleanRequest, notesForPrompt, readNotes, tagNote } from "../src/fieldnotes.ts";
import { computeTotals, guessSection, optionalTotals, renderEstimateHtml, sanitizeEstimate } from "../src/estimate.ts";
import { receiptText } from "../src/payments.ts";
import { outsideServices } from "../src/exceptions.ts";

const today = "2026-11-23";

test("the pipeline puts each stage in the painter's tabs", () => {
  assert.equal(bucketFor({ stage: "lead", today }), "new");
  assert.equal(bucketFor({ stage: "bid", today }), "estimates");
  assert.equal(bucketFor({ stage: "contract", today }), "jobs");
  assert.equal(bucketFor({ stage: "scheduled", today }), "jobs");
  assert.equal(bucketFor({ stage: "in_progress", today }), "jobs");
  assert.equal(bucketFor({ stage: "in_progress", accepted: true, today }), "completed");
  assert.equal(bucketFor({ stage: "punch", today }), "completed");
  assert.equal(bucketFor({ stage: "invoiced", today }), "invoice");
  assert.equal(bucketFor({ stage: "closed", today }), "paid");
  assert.equal(bucketFor({ stage: "closed", warrantyEnd: "2027-11-23", today }), "warranty");
  assert.equal(bucketFor({ stage: "closed", warrantyEnd: "2026-11-22", today }), "paid");
  assert.equal(bucketFor({ stage: "closed", warrantyEnd: "garbage", today }), "paid");
  assert.equal(bucketFor({ stage: "lost", today }), "lost");
  assert.equal(bucketFor({ stage: "something_new", today }), "new");
});

test("field notes are sorted into groups from their words, in English and Spanish", () => {
  assert.equal(tagNote("Water stain on the bedroom ceiling, needs primer"), "prep");
  assert.equal(tagNote("Customer wants a satin finish in the kitchen"), "wishes");
  assert.equal(tagNote("Need to move the furniture, parking on the street"), "site");
  assert.equal(tagNote("House built 1965, test for lead paint. Need a 28 ft ladder"), "safety");
  assert.equal(tagNote("Called and left a message about Tuesday"), "call");
  assert.equal(tagNote("Hay manchas de humedad en el techo"), "prep");
  assert.equal(tagNote("La clienta quiere colores claros"), "wishes");
  assert.equal(tagNote("Nice people"), "general");
});

test("a note keeps its offline id and time, and a retry is not added twice", () => {
  const now = "2026-11-23T15:00:00.000Z";
  const n = cleanNote({ id: "abc123", at: "2026-11-23T14:00:00.000Z", text: "  Peeling paint on the north wall  " }, now)!;
  assert.equal(n.text, "Peeling paint on the north wall");
  assert.equal(n.tag, "prep");
  assert.equal(n.at, "2026-11-23T14:00:00.000Z");
  let list = addNote([], n);
  list = addNote(list, n);
  assert.equal(list.length, 1);
  assert.equal(cleanNote({ text: "   " }, now), null);
  // A time far in the future is replaced by now; an unknown tag is worked out from the words.
  const f = cleanNote({ at: "2030-01-01T00:00:00Z", text: "Customer wants navy shutters", tag: "nonsense" }, now)!;
  assert.equal(f.at, now);
  assert.equal(f.tag, "wishes");
  assert.deepEqual(readNotes([{ broken: true }, n]), [n]);
  assert.match(notesForPrompt(list), /Surface prep:\n- Peeling paint/);
});

test("colors and the customer's request are cleaned", () => {
  assert.deepEqual(cleanColors([{ where: "Living room walls", brand: "SW", code: "7008", name: "Alabaster", hex: "#F0EDE4" }, { where: "" }, "x"]), [
    { where: "Living room walls", brand: "SW", code: "7008", name: "Alabaster", hex: "#F0EDE4" },
  ]);
  assert.equal(cleanColors([{ where: "Trim", hex: "red" }])[0].hex, "");
  const r = cleanRequest({ details: "Repaint 3 bedrooms", preferredDate: "2026-12-05", preferredTime: "Morning" }, "website");
  assert.deepEqual(r, { description: "Repaint 3 bedrooms", preferredDate: "2026-12-05", preferredTime: "morning", source: "website" });
  assert.equal(cleanRequest({ preferredDate: "next week", preferredTime: "<b>" }).preferredDate, "");
});

const est = () =>
  sanitizeEstimate({
    lines: [
      { description: "Paint 3 bedrooms", qty: 3, unit: "room", unitPrice: 400 },
      { description: "Patch and texture drywall", qty: 1, unit: "ea", unitPrice: 250, section: "drywall" },
      { description: "Paint 8 doors", qty: 8, unit: "door", unitPrice: 50, section: "trim" },
    ],
    optionalSections: ["trim", "bogus", "trim"],
    revisionLabel: "Revision 2",
    colors: [{ where: "Bedrooms", brand: "SW", code: "7008", name: "Alabaster" }],
    includeTerms: true,
  });

test("optional sections are priced on their own and left out of the total", () => {
  const e = est();
  assert.deepEqual(e.optionalSections, ["trim"]);
  assert.equal(e.lines[0].section, undefined); // paint is the default, so it is not stored
  const t = computeTotals(e);
  assert.equal(t.subtotalCents, 120000 + 25000);
  assert.deepEqual(optionalTotals(e), [{ section: "trim", cents: 40000 }]);
  // Without optional sections everything counts.
  assert.equal(computeTotals({ ...e, optionalSections: [] }).subtotalCents, 185000);
});

test("the estimate prints sections, the revision words, colors and the contract terms", () => {
  const e = est();
  const html = renderEstimateHtml(
    { company: { name: "Acme Painting" }, customer: { name: "Maria Lopez" }, jobTitle: "Bedrooms", date: "2026-11-23", terms: [{ title: "Payment", body: "Deposit due at signing." }] },
    e,
    computeTotals(e),
  );
  assert.match(html, /Drywall installation, repair and texture/);
  assert.match(html, /Trim, doors and cabinets <span class="opt">Optional<\/span>/);
  assert.match(html, /<span class="rev">Revision 2<\/span>/);
  assert.match(html, /Alabaster/);
  assert.match(html, /Contract terms/);
  assert.match(html, /1\. Payment/);
  // The painter can clear the revision words and turn the terms off.
  const plain = renderEstimateHtml({ company: { name: "Acme" }, customer: { name: "M" }, jobTitle: "B", date: "2026-11-23", terms: [{ title: "Payment", body: "x" }] }, { ...e, revisionLabel: "", includeTerms: false, optionalSections: [], lines: [e.lines[0]] }, computeTotals(e));
  assert.doesNotMatch(plain, /class="rev"/);
  assert.doesNotMatch(plain, /Contract terms/);
  assert.doesNotMatch(plain, /class="sec"/);
});

test("lines get a section from their words", () => {
  assert.equal(guessSection("Drywall patch and texture"), "drywall");
  assert.equal(guessSection("Paint baseboards and trim"), "trim");
  assert.equal(guessSection("Kitchen cabinets, 20 doors"), "trim");
  assert.equal(guessSection("Walls, 2 coats"), "paint");
});

test("a payment receipt shows the amount, method and balance, never a full number", () => {
  const r = receiptText({ id: "p1", on: "2026-11-23", cents: 50000, method: "check", ref: "1042", kind: "deposit", note: "", at: "" }, { company: "Acme Painting", customer: "Maria Lopez", jobTitle: "Bedrooms", paidCents: 50000, totalCents: 160000, language: "en" });
  assert.equal(r.subject, "Payment receipt from Acme Painting");
  assert.match(r.body, /Hi Maria,/);
  assert.match(r.body, /We received your payment \(deposit\)/);
  assert.match(r.body, /Paid by: check #1042/);
  assert.match(r.body, /Balance: \$1,100\.00/);
  const es = receiptText({ id: "p1", on: "2026-11-23", cents: 50000, method: "zelle", ref: "", kind: "other", note: "", at: "" }, { company: "Acme", customer: "Maria", jobTitle: "B", paidCents: 50000, totalCents: 0, language: "es" });
  assert.match(es.body, /Recibimos su pago\./);
  assert.doesNotMatch(es.body, /Saldo/);
});

test("the admin sees what painters were asked for but do not list", () => {
  assert.equal(outsideServices([], "2026-10-24"), null);
  const item = outsideServices([{ trade: "power_washing", on: "2026-11-20" }, { trade: "power_washing", on: "2026-11-21" }, { trade: "drywall", on: "2026-11-01" }, { trade: "epoxy_floors", on: "2026-09-01" }], "2026-10-24")!;
  assert.equal(item.kind, "demand");
  assert.match(item.detail, /power washing 2, drywall 1/);
  assert.doesNotMatch(item.detail, /epoxy/);
});

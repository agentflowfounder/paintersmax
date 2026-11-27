import test from "node:test";
import assert from "node:assert/strict";
import { computeTotals, guessSection, renderEstimateHtml, sanitizeEstimate, sectionChoices, tradeSections } from "../src/estimate.ts";
import { cleanBrand } from "../src/brandprint.ts";
import { cleanDraftAI } from "../src/jobbrief.ts";

const ctx = { company: { name: "Tyler Painters", phone: "(903) 555-0100", email: "hi@example.com" }, customer: { name: "Magnus hotel" }, jobTitle: "Power washing", date: "2026-11-26" };

test("a discount typed with a comma or a dollar sign is read, not dropped", () => {
  const e = sanitizeEstimate({ lines: [{ description: "Wash", qty: 1, unit: "flat", unitPrice: "$3,780" }], discount: "2,000" });
  assert.equal(e.discountCents, 200000);
  assert.equal(e.lines[0].unitCents, 378000);
  assert.equal(computeTotals(e, {}).totalCents, 178000);
});

test("each service offers its own types of work, always ending with Other", () => {
  assert.deepEqual(tradeSections("power_washing"), ["cold_water", "hot_water", "chemicals", "paint", "other"]);
  assert.ok(!tradeSections("power_washing").includes("drywall"), "no drywall or trim on a power wash");
  assert.ok(!tradeSections("power_washing").includes("trim"));
  assert.deepEqual(tradeSections("interior"), ["paint", "drywall", "trim", "other"]);
  for (const t of ["interior", "exterior", "power_washing", "fencing", "epoxy_floors", "cabinets", "decks_fences", "drywall", "commercial"]) assert.equal(tradeSections(t).at(-1), "other");
  assert.equal(sectionChoices("power_washing")[0].label, "Cold water wash");
});

test("a line is placed in a type that fits its words and its service", () => {
  assert.equal(guessSection("Hot water wash of the walkways", "power_washing"), "hot_water");
  assert.equal(guessSection("Degreaser treatment for oil stains", "power_washing"), "chemicals");
  assert.equal(guessSection("Pressure wash breezeways and stairwells", "power_washing"), "cold_water");
  assert.equal(guessSection("Tape and mud the ceiling", "interior"), "drywall");
  assert.equal(guessSection("Hang the gate", "fencing"), "fence");
  // a word that belongs to another service falls back to something this service offers
  assert.equal(guessSection("Paint the baseboards", "power_washing"), "other");
  assert.equal(guessSection("Walls and ceilings", ""), "paint");
});

test("the AI can only pick a type this service offers", () => {
  const raw = { extraLines: [{ description: "Hot water rinse", qty: 1, unit: "flat", section: "hot_water" }, { description: "Patch drywall", qty: 1, unit: "ea", section: "drywall" }] };
  const out = cleanDraftAI(raw, [], tradeSections("power_washing"));
  assert.equal(out.extraLines[0].section, "hot_water");
  assert.equal(out.extraLines[1].section, "", "drywall is not offered for a power wash, so the code decides");
});

test("every estimate has a place for the customer to sign, with or without contract terms", () => {
  const e = sanitizeEstimate({ lines: [{ description: "Wash", qty: 1, unit: "flat", unitPrice: 100 }] });
  const html = renderEstimateHtml(ctx, e, computeTotals(e, {}));
  assert.match(html, /Customer approval/);
  assert.match(html, /I accept the work and the price/);
  assert.doesNotMatch(html, /Contract terms/);
  const es = sanitizeEstimate({ lines: [{ description: "Lavar", qty: 1, unit: "flat", unitPrice: 100 }], language: "es" });
  assert.match(renderEstimateHtml(ctx, es, computeTotals(es, {})), /Aprobación del cliente/);
});

test("the estimate prints the headings for the service, not painting headings on a power wash", () => {
  const e = sanitizeEstimate({ lines: [{ description: "Wash", qty: 1, unit: "flat", unitPrice: 100, section: "cold_water" }, { description: "Treat", qty: 1, unit: "flat", unitPrice: 50, section: "chemicals" }] });
  const html = renderEstimateHtml(ctx, e, computeTotals(e, {}));
  assert.match(html, /Cold water pressure washing/);
  assert.match(html, /Cleaning chemicals and treatments/);
  assert.doesNotMatch(html, /Surface prep, priming and painting/);
});

test("letterhead styles change the header and keep every value safe", () => {
  const e = sanitizeEstimate({ lines: [{ description: "Wash", qty: 1, unit: "flat", unitPrice: 100 }] });
  const t = computeTotals(e, {});
  const band = renderEstimateHtml({ ...ctx, brandColor: "#0F1B2D", letterhead: { style: "band", extra: ["Serving Tyler since 2008"], footer: "Thank you <b>" } }, e, t);
  assert.match(band, /class="band"/);
  assert.match(band, /Serving Tyler since 2008/);
  assert.match(band, /Thank you &lt;b&gt;/, "footer text is escaped");
  const center = renderEstimateHtml({ ...ctx, letterhead: { style: "center" } }, e, t);
  assert.match(center, /text-align:center/);
  const img = renderEstimateHtml({ ...ctx, letterhead: { style: "image", headerImage: "data:image/png;base64,AAAA" } }, e, t);
  assert.match(img, /<img src="data:image\/png;base64,AAAA"/);
  const evil = renderEstimateHtml({ ...ctx, letterhead: { style: "image", headerImage: 'javascript:alert(1)"' } }, e, t);
  assert.doesNotMatch(evil, /javascript:/, "only a picture data URL is ever printed");
  const plain = renderEstimateHtml(ctx, e, t);
  assert.match(plain, /class="head"/, "without a letterhead the estimate keeps its usual look");
});

test("the brand kit keeps the letterhead choices and drops bad ones", () => {
  const b = cleanBrand({ company: "Tyler Painters", letterhead: { on: true, style: "band", headerFileId: "12", footer: "Thanks", extra: "Line one\nLine two\nLine three\nLine four" } });
  assert.equal(b.letterhead.on, true);
  assert.equal(b.letterhead.style, "band");
  assert.equal(b.letterhead.headerFileId, 12);
  assert.deepEqual(b.letterhead.extra, ["Line one", "Line two", "Line three"]);
  const d = cleanBrand({ company: "x", letterhead: { style: "weird", headerFileId: -4 } });
  assert.equal(d.letterhead.on, false, "off until the painter turns it on");
  assert.equal(d.letterhead.style, "classic");
  assert.equal(d.letterhead.headerFileId, 0);
});

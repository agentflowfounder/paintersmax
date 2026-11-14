import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanBrand } from "../src/brandprint.ts";
import { FLYER_DESIGNS, HANGER_DESIGNS, renderFlyer, renderHangers } from "../src/brandflyer.ts";

const base = { company: "Rivera Painting", phone: "(214) 555-0100", color: "#5FA052", services: ["Interior painting", "Exterior painting"], area: "Plano, Frisco" };
const FALLBACK = "https://rivera-painting.paintersmax.app";

test("every flier design has a headline, the phone number, a QR code and nothing undefined", () => {
  for (const d of FLYER_DESIGNS) {
    const html = renderFlyer(cleanBrand(base), { design: d.id, fallbackUrl: FALLBACK });
    assert.ok(html.includes("(214) 555-0100"), d.id);
    assert.ok(html.includes("QR code"), d.id);
    assert.ok(html.includes("<h1"), d.id);
    assert.ok(!html.includes("undefined") && !html.includes("[object"), d.id);
    assert.ok(html.includes("Interior painting"), d.id);
  }
});

test("blank fields use a plain starting line, and an offer or license appears only when entered", () => {
  const plain = renderFlyer(cleanBrand(base), { design: "bold", fallbackUrl: FALLBACK });
  assert.ok(plain.includes("Give your home a fresh new look"));
  assert.ok(!plain.includes('class="offer"') && !/Lic\.|Insured|Good to know/i.test(plain));
  const full = renderFlyer(cleanBrand({ ...base, license: "99", insured: true, flyer: { headline: "Spring special", offer: "10% off for neighbors", points: ["Same crew"] } }), { design: "bold", fallbackUrl: FALLBACK });
  assert.ok(full.includes("Spring special") && full.includes("10% off for neighbors") && full.includes("Lic. #99") && full.includes("Insured") && full.includes("Same crew"));
});

test("the neighborhood flier mentions the street only when one is given", () => {
  const a = renderFlyer(cleanBrand({ ...base, flyer: { street: "Maple Street" } }), { design: "neighborhood", fallbackUrl: FALLBACK });
  assert.ok(a.includes("We are painting on Maple Street right now"));
  const b = renderFlyer(cleanBrand(base), { design: "neighborhood", fallbackUrl: FALLBACK });
  assert.ok(b.includes("We are working nearby right now") && !b.includes("Maple"));
});

test("estimates are called free only when the painter says so", () => {
  const no = renderFlyer(cleanBrand({ ...base, freeEstimates: false }), { design: "bold", fallbackUrl: FALLBACK }) + renderHangers(cleanBrand({ ...base, freeEstimates: false }), { design: "missed", mode: "print", fallbackUrl: FALLBACK });
  assert.ok(!/free estimate/i.test(no));
  assert.ok(no.includes("Request an estimate"));
});

test("a flier prints on one Letter page and long text is escaped", () => {
  const html = renderFlyer(cleanBrand({ ...base, company: "<b>Hi</b>", flyer: { headline: "<script>x</script>" } }), { design: "clean", mode: "print", fallbackUrl: FALLBACK });
  assert.ok(html.includes("size:8.5in 11in"));
  assert.ok(!html.includes("<script>x") && !html.includes("<b>Hi"));
  assert.ok(html.includes("window.print()"));
  assert.ok(!renderFlyer(cleanBrand(base), { design: "clean", fallbackUrl: FALLBACK }).includes("window.print()"));
});

test("door hangers: preview shows one front and one back, print is two landscape pages of three", () => {
  const prev = renderHangers(cleanBrand(base), { design: "neighbors", fallbackUrl: FALLBACK });
  assert.equal((prev.match(/class="hg( back)?"/g) ?? []).length, 2);
  const print = renderHangers(cleanBrand(base), { design: "estimate", mode: "print", fallbackUrl: FALLBACK });
  assert.equal((print.match(/class="sheet"/g) ?? []).length, 2);
  assert.equal((print.match(/class="hg( back)?"/g) ?? []).length, 6);
  assert.ok(print.includes("size:11in 8.5in") && print.includes("dashed"));
  assert.ok(!renderHangers(cleanBrand(base), { design: "estimate", mode: "print", guides: false, fallbackUrl: FALLBACK }).includes("outline:.4pt dashed"));
});

test("every hanger design works, the hole is never covered by text, and unknown designs fall back", () => {
  for (const d of HANGER_DESIGNS) {
    const html = renderHangers(cleanBrand(base), { design: d.id, fallbackUrl: FALLBACK });
    assert.ok(html.includes('class="hole"') && !html.includes("undefined"), d.id);
  }
  assert.ok(renderHangers(cleanBrand(base), { design: "nope", fallbackUrl: FALLBACK }).includes("We are painting in your neighborhood"));
});

test("Spanish pieces use Spanish words", () => {
  const es = cleanBrand({ ...base, language: "es" });
  assert.ok(renderFlyer(es, { design: "bold", fallbackUrl: FALLBACK }).includes("Dele a su casa un aspecto nuevo"));
  assert.ok(renderHangers(es, { design: "missed", fallbackUrl: FALLBACK }).includes("Lamentamos no encontrarle"));
});

test("flyer words are trimmed and limited", () => {
  const b = cleanBrand({ flyer: { headline: "h".repeat(200), points: ["a", "b", "c", "d", "e", "f"], street: "s".repeat(100) } });
  assert.equal(b.flyer.headline.length, 70);
  assert.equal(b.flyer.points.length, 4);
  assert.equal(b.flyer.street.length, 60);
  assert.deepEqual(cleanBrand(null).flyer, { headline: "", sub: "", offer: "", points: [], street: "" });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_DESIGNS, accentOnDark, cleanBrand, contrast, onColor, readableOnWhite, renderCards, trustLine, INK } from "../src/brandprint.ts";

const base = { company: "Rivera Painting", person: "Ana Rivera", phone: "(214) 555-0100", color: "#5FA052" };
const FALLBACK = "https://rivera-painting.paintersmax.app";

test("cleanBrand keeps only valid, size-limited values", () => {
  const b = cleanBrand({ ...base, color: "red", logoUrl: "http://x.com/a.png", qrUrl: "javascript:alert(1)", services: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], insured: "yes", title: "T".repeat(100) });
  assert.equal(b.color, "#E8A33D");
  assert.equal(b.logoUrl, "");
  assert.equal(b.qrUrl, "");
  assert.equal(b.services.length, 8);
  assert.equal(b.insured, false); // only a real true counts
  assert.equal(b.title.length, 40);
  assert.equal(cleanBrand({ services: "one\ntwo, three" }).services.length, 3);
  assert.equal(cleanBrand({ logoUrl: "https://example.com/logo.png" }).logoUrl, "https://example.com/logo.png");
  assert.equal(cleanBrand(null).language, "en");
  assert.equal(cleanBrand({ language: "es" }).language, "es");
});

test("text stays readable on any brand color", () => {
  assert.equal(onColor("#FFD60A"), INK); // yellow needs dark text
  assert.equal(onColor("#1B3A6B"), "#ffffff"); // navy needs white text
  for (const c of ["#FFD60A", "#E8A33D", "#5FA052", "#00FFFF", "#FFFFFF"]) assert.ok(contrast(readableOnWhite(c), "#ffffff") >= 4.5, c);
  assert.equal(accentOnDark("#1B3A6B"), "#ffffff"); // would vanish on navy
  assert.equal(accentOnDark("#E8A33D"), "#E8A33D");
});

test("license and Insured print only when the painter gave them", () => {
  assert.equal(trustLine(cleanBrand(base)), "");
  assert.equal(trustLine(cleanBrand({ ...base, license: "12345" })), "Lic. #12345");
  assert.equal(trustLine(cleanBrand({ ...base, license: "#12345", insured: true })), "Lic. #12345 · Insured");
  assert.equal(trustLine(cleanBrand({ ...base, insured: true, language: "es" })), "Asegurado");
  for (const d of CARD_DESIGNS) {
    const html = renderCards(cleanBrand(base), { design: d.id, fallbackUrl: FALLBACK });
    assert.ok(!/Insured|Lic\./.test(html), `${d.id} claims something it should not`);
  }
});

test("every design draws a front, a back and a QR code, and nothing says undefined", () => {
  for (const d of CARD_DESIGNS) {
    const html = renderCards(cleanBrand({ ...base, tagline: "Honest prices", services: ["Interior painting"] }), { design: d.id, mode: "preview", fallbackUrl: FALLBACK });
    assert.equal((html.match(/class="card"/g) ?? []).length, 2, d.id);
    assert.ok(html.includes("<svg") && html.includes("QR code"), d.id);
    assert.ok(!html.includes("undefined") && !html.includes("[object"), d.id);
    assert.ok(html.includes("Ana Rivera"), d.id);
  }
});

test("a name with HTML is escaped, and an unknown design falls back to classic", () => {
  const html = renderCards(cleanBrand({ ...base, company: "<script>alert(1)</script>", person: '"><img src=x onerror=1>' }), { design: "nope", fallbackUrl: FALLBACK });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('class="band"')); // classic's side band
});

test("sheet mode is two Letter pages of 10, bleed mode is two 3.75 x 2.25 pages", () => {
  const b = cleanBrand(base);
  const sheet = renderCards(b, { mode: "sheet", fallbackUrl: FALLBACK });
  assert.equal((sheet.match(/class="card"/g) ?? []).length, 20);
  assert.equal((sheet.match(/class="sheet"/g) ?? []).length, 2);
  assert.ok(sheet.includes("size:8.5in 11in") && sheet.includes("dashed"));
  assert.ok(!renderCards(b, { mode: "sheet", guides: false, fallbackUrl: FALLBACK }).includes("dashed"));
  const bleed = renderCards(b, { mode: "bleed", fallbackUrl: FALLBACK });
  assert.equal((bleed.match(/class="card"/g) ?? []).length, 2);
  assert.ok(bleed.includes("size:3.75in 2.25in"));
});

test("the QR code uses the painter's address, else the fallback", () => {
  const a = renderCards(cleanBrand({ ...base, qrUrl: "https://a.example.com/x" }), { mode: "preview", fallbackUrl: FALLBACK });
  const b = renderCards(cleanBrand(base), { mode: "preview", fallbackUrl: FALLBACK });
  const c = renderCards(cleanBrand({ ...base, qrUrl: "https://a.example.com/x" }), { mode: "preview", fallbackUrl: "https://zzz.example.com" });
  const svg = (h: string) => h.match(/<svg[^>]*aria-label="QR code".*?<\/svg>/s)![0];
  assert.notEqual(svg(a), svg(b));
  assert.equal(svg(a), svg(c));
});

test("Free estimates is claimed only when the painter says they give them", () => {
  const yes = renderCards(cleanBrand(base), { design: "bold", fallbackUrl: FALLBACK });
  assert.ok(yes.includes("Free estimates"));
  const no = renderCards(cleanBrand({ ...base, freeEstimates: false }), { design: "bold", fallbackUrl: FALLBACK });
  assert.ok(!no.includes("Free estimates") && !no.includes("free estimate") && no.includes("Request an estimate"));
  assert.equal(cleanBrand({}).freeEstimates, true);
});

test("Spanish pieces use Spanish words", () => {
  const html = renderCards(cleanBrand({ ...base, language: "es" }), { design: "classic", mode: "sheet", fallbackUrl: FALLBACK });
  assert.ok(html.includes("Escanee para un presupuesto gratis"));
  assert.ok(html.includes("Imprimir o guardar como PDF"));
});

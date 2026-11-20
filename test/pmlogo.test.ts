import { test } from "node:test";
import assert from "node:assert/strict";
await import("../public/pmlogo.js");
const L = (globalThis as any).PMLOGO;

test("logo: every concept in every shape draws a valid-looking svg with the slogan", () => {
  for (const concept of L.CONCEPTS) for (const shape of L.SHAPES) {
    const svg = L.lockup({ concept, shape });
    assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ 120"/);
    assert.ok(svg.includes("PaintersMax") && svg.includes("Bid it. Book it. Bank it."));
    assert.equal((svg.match(/<svg/g) || []).length, 1);
    assert.equal(svg.includes("NaN"), false, `${concept} ${shape}`);
    const i = L.icon({ concept, shape }, 64);
    assert.match(i, /viewBox="0 0 100 100" width="64"/);
  }
});

test("logo: bad colors and options fall back; slogan can be off; mono is one color", () => {
  const o = L.opts({ concept: "x", shape: "hexagon", primary: "red", accent: "#zzzzzz" });
  assert.deepEqual([o.concept, o.shape, o.primary, o.accent], ["box", "square", "#1f3a5f", "#e8833a"]);
  assert.equal(L.lockup({ slogan: false }).includes("Bank it"), false);
  const mono = L.lockup({ concept: "paint", mono: true });
  assert.equal(/#1f3a5f|#e8833a/i.test(mono), false);
});

test("logo: a client name and tagline fit, are cleaned, and widen the logo", () => {
  const short = L.lockup({ name: "Rivera Painting", sloganText: "Quality since 1998", slogan: true });
  assert.ok(short.includes("Rivera Painting") && short.includes("Quality since 1998"));
  const bad = L.lockup({ name: '<b>"Evil" & Co</b>' });
  assert.equal(/<b>|&Co/.test(bad), false);
  const w = (svg: string) => Number(svg.match(/viewBox="0 0 (\d+)/)![1]);
  assert.ok(w(L.lockup({ name: "A Very Long Painting Company Name LLC" })) > w(L.lockup({ name: "Max" })));
  assert.equal(L.opts({ name: "" }).name, "PaintersMax");
});

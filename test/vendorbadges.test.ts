import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KINDS } from "../src/vendors.ts";

const css = readFileSync(new URL("../public/pm-badges.css", import.meta.url), "utf8");
const cls = (kind: string) => "pmv-" + kind.replace(/_/g, "-");

test("every vendor kind has its own animated badge", () => {
  for (const kind of Object.keys(KINDS)) {
    const c = cls(kind);
    assert.ok(css.includes(`.pmv.${c}{--pmv-m:`), `${c} has an icon`);
    assert.ok(css.includes(`@keyframes pmv-${kind.replace(/_/g, "-")}-a{`), `${c} plays once`);
    assert.ok(css.includes(`@keyframes pmv-${kind.replace(/_/g, "-")}-b{`), `${c} replays on hover`);
  }
});

test("badges follow the motion rules: transform and opacity only, reduced motion respected", () => {
  const frames = css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})+\}/g) ?? [];
  assert.ok(frames.length >= 12);
  for (const f of frames) {
    const props = [...f.matchAll(/[{;]\s*([a-z-]+)\s*:/g)].map((m) => m[1]);
    for (const p of props) assert.ok(p === "transform" || p === "opacity", `${f.slice(0, 40)} animates ${p}`);
  }
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.pmv::before,\.pmv::after\{animation:none!important\}/);
});

test("badges use only Scheme 1 colors, never store logos or outside images", () => {
  const hexes = new Set((css.replace(/data:image[^"]+/g, "").match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((h) => h.toUpperCase()));
  for (const h of hexes) assert.ok(["#0B0B0B", "#333533", "#F2ECDD", "#F5CB5C", "#CD9C20"].includes(h), `${h} is not a Scheme 1 color`);
  assert.doesNotMatch(css, /url\((?!"data:image\/svg\+xml,)/, "no outside images");
});

test("the shared app stylesheet loads the badges and the Vendors page uses them", () => {
  const cc = readFileSync(new URL("../public/colorcode.css", import.meta.url), "utf8");
  assert.ok(cc.startsWith('@import url("/pm-badges.css");'));
  const vendors = readFileSync(new URL("../public/vendors.html", import.meta.url), "utf8");
  assert.ok(vendors.includes("pmv pmv-tile") && vendors.includes("pmv-host"));
  assert.doesNotMatch(vendors, /class="badge"/);
  const guide = readFileSync(new URL("../public/vendor-badges.html", import.meta.url), "utf8");
  for (const kind of Object.keys(KINDS)) assert.ok(guide.includes(cls(kind)), `guide shows ${cls(kind)}`);
});

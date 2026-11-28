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

import { badgeHtml, findStore, siteUsesBadges, STORES, storesStripHtml, withBadges } from "../src/storebadges.ts";
import { richText } from "../src/siterender.ts";
import { cleanSite } from "../src/sitecore.ts";
import { cleanEntry, letterFor, readPermBook } from "../src/logoperm.ts";

test("every store we show has a vendor kind and a badge in the stylesheet", () => {
  for (const st of STORES) {
    assert.ok(st.kind in KINDS, `${st.kind} is a vendor kind`);
    assert.equal(KINDS[st.kind], st.name);
    assert.ok(css.includes(`.pmv.pmv-${st.slug}{`), `${st.slug} has a badge`);
  }
  for (const k of ["kelly_moore", "dunn_edwards", "valspar", "behr"]) assert.ok(k in KINDS);
});

test("[store:...] tokens become badges and nothing a painter types becomes HTML", () => {
  assert.equal(withBadges("Buy at [store:home-depot]."), 'Buy at <span class="pmv pmv-home-depot">Home Depot</span>.');
  assert.match(richText("We use [store:Lowe's] and [store:behr]"), /pmv-lowes">Lowe&#39;s<.*pmv-behr">Behr</);
  const evil = richText("[store:<img src=x onerror=alert(1)>]");
  assert.doesNotMatch(evil, /<img/);
  assert.match(richText("[store:Joe's Paint Supply]"), /pmv-other">Joe&#39;s Paint Supply</);
  assert.equal(findStore("Sherwin Williams")?.slug, "sherwin-williams");
  assert.equal(badgeHtml("Unknown <b>"), '<span class="pmv pmv-other">Unknown &lt;b&gt;</span>');
});

test("the Where I buy strip lists stores, notes there is no endorsement, and is empty with no stores", () => {
  const h = storesStripHtml(["Home Depot", "Joe's Paint"], "", "en");
  assert.match(h, /Where we buy our paint/);
  assert.match(h, /do not sponsor or endorse us/);
  assert.match(h, /pmv-home-depot/);
  assert.match(storesStripHtml(["Behr"], "", "es"), /Dónde compramos/);
  assert.equal(storesStripHtml([], "", "en"), "");
  assert.equal(storesStripHtml(["  "], "", "en"), "");
});

test("sites that use badges load the badge stylesheet", () => {
  assert.equal(siteUsesBadges([{ blocks: [{ type: "stores" }] }]), true);
  assert.equal(siteUsesBadges([{ blocks: [{ type: "text", body: "hi [store:ppg]" } as any] }]), true);
  assert.equal(siteUsesBadges([{ blocks: [{ type: "tabs", tabs: [{ body: "[store:behr]" }] } as any] }]), true);
  assert.equal(siteUsesBadges([{ blocks: [{ type: "text", body: "plain" } as any] }]), false);
});

test("the permission letter names the store, asks in writing and does not claim anything", () => {
  const l = letterFor("Valspar");
  assert.match(l, /Valspar Marketing Team/);
  assert.match(l, /in writing/);
  assert.doesNotMatch(l, /\{\{STORE\}\}/);
  assert.match(l, /not legal advice/i);
  const book = readPermBook({ behr: { status: "approved", sentOn: "2026-12-01", note: "Reply saved" }, valspar: { status: "bogus", sentOn: "12/1/2026" } });
  assert.equal(book.behr.status, "approved");
  assert.equal(book.valspar.status, "not_asked");
  assert.equal(book.valspar.sentOn, "");
  assert.equal(book["home-depot"].status, "not_asked");
  assert.equal(cleanEntry({ status: "sent", sentOn: "2026-12-01", note: "x".repeat(900) }).note.length, 500);
});

import { DOOR_LIMITS } from "../src/sitecore.ts";
test("a Where I buy section keeps only store names, capped, and never HTML", () => {
  const r = cleanSite({ pages: [{ kind: "home", nav: "Home", blocks: [{ type: "stores", heading: "Mine", stores: ["Home Depot", "Home Depot", "<script>x</script>", "", ...Array.from({ length: 20 }, (_, i) => `Store ${i}`)] }] }] }, DOOR_LIMITS.launch, "launch");
  assert.ok(r.ok);
  if (!r.ok) return;
  const b: any = r.site.pages.find((p) => p.kind === "home")!.blocks.find((x) => x.type === "stores");
  assert.equal(b.stores.length, 12);
  assert.equal(b.stores.filter((n: string) => n === "Home Depot").length, 1);
  assert.equal(b.heading, "Mine");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { configOf, latestVersion, TEMPLATE_IDS } from "../templates/configs.ts";
import { DOOR_LIMITS, cleanSite, firstDraft, pathOf, type Site } from "../src/sitecore.ts";
import { BLOCKS, blockState, visibleToVisitors } from "../src/siteblocks.ts";
import { canPublishWith, entries, mayChoose, pickerList, readRegistry, renderWithTemplate } from "../src/sitetemplates.ts";
import { cleanTheme, resolveSections, SITE_SCHEMA, tokenCss, upgradeSite } from "../src/sitetheme.ts";

const draft = (lang: "en" | "es" = "en"): Site => {
  const s = firstDraft({ name: "Rivera Painting", phone: "(903) 555-0100", email: "hi@rivera.example", city: "Tyler", state: "TX", trades: ["interior", "exterior"], cities: ["Tyler, TX", "Longview, TX"], insured: true, warrantyMonths: 24, lang }, DOOR_LIMITS.launch);
  s.photos = [{ id: "aaaaaaaaaaaa", alt: "Kitchen cabinets after", w: 1200, h: 900, bytes: 1000, at: "2026-11-16" }, { id: "bbbbbbbbbbbb", alt: "Kitchen cabinets before", w: 1200, h: 900, bytes: 1000, at: "2026-11-16" }];
  return s;
};
const draw = (site: Site, o: { path?: string; door?: "free" | "launch" | "grow" | "signature"; preview?: boolean; uiLang?: "en" | "es"; reg?: any; tpl?: string; mapsKey?: string } = {}) => {
  const page = site.pages.find((p) => pathOf(p) === (o.path ?? "/"))!;
  return renderWithTemplate({
    site, page, company: { id: 7, slug: "rivera", name: "Rivera Painting" }, origin: "https://rivera.paintersmax.app", link: (p) => p, quoteHref: "/quote",
    photoSrc: (id) => `/site-photo/7/${id}`, cityPages: [{ name: "Tyler", state: "TX", href: "/areas/tyler-tx" }], preview: o.preview, reviews: [],
  }, { reg: o.reg ?? {}, door: o.door ?? "launch", balance: 50, uiLang: o.uiLang, langHref: "/?lang=es", mapsKey: o.mapsKey ?? "", templateOverride: o.tpl });
};

test("library: every template has a config, a version and the required sections", () => {
  for (const id of TEMPLATE_IDS) {
    const c = configOf(id)!;
    assert.ok(c && latestVersion(id) === c.version, id);
    if (c.legacy) continue;
    const keys = c.sections.map((s) => s.key);
    for (const k of ["hero", "content", "business_info", "services", "cities", "instant_quote", "color_studio", "gallery_ba", "maps", "chat_helper", "estimate_request", "review_request"]) assert.ok(keys.includes(k), `${id} needs ${k}`);
    // Every phrase exists in both languages.
    assert.deepEqual(Object.keys(c.i18n.es).sort(), Object.keys(c.i18n.en).sort(), `${id} i18n`);
    assert.equal(c.imageProvider.ready, false);
    assert.equal(c.imageProvider.endpoint, "/api/site/image-ai");
    // Placeholder contact only.
    assert.match(c.contact.phone, /555-01\d\d/);
    assert.match(c.contact.email, /\.example$/);
  }
});

test("library: default door split and admin overrides", () => {
  const reg = readRegistry({});
  const e = entries(reg);
  assert.deepEqual(e.find((t) => t.id === "dfw-pro-painters")!.doors, ["launch", "grow", "signature"]);
  assert.deepEqual(e.find((t) => t.id === "bold")!.doors, ["signature"]);
  assert.ok(!canPublishWith(reg, "dfw-pro-painters", "free"));
  assert.ok(canPublishWith(reg, "dfw-pro-painters", "launch"));
  assert.ok(!canPublishWith(reg, "bold", "grow"));
  // Free may choose any template that is on (to preview); Launch may not choose a Signature one.
  assert.ok(mayChoose(reg, "bold", "free", "classic"));
  assert.ok(!mayChoose(reg, "bold", "launch", "classic"));
  assert.equal(pickerList(reg, "launch", "classic").find((t) => t.id === "bold")!.state, "locked");
  // Admin turns a template off: hidden from new choices, kept for the client already using it.
  const off = readRegistry({ "dfw-pro-painters": { enabled: false }, junk: { enabled: true } });
  assert.equal(Object.keys(off).length, 1);
  assert.ok(!pickerList(off, "launch", "classic").some((t) => t.id === "dfw-pro-painters"));
  assert.ok(pickerList(off, "launch", "dfw-pro-painters").some((t) => t.id === "dfw-pro-painters" && t.current));
  assert.ok(!mayChoose(off, "dfw-pro-painters", "grow", "classic"));
  assert.ok(mayChoose(off, "dfw-pro-painters", "grow", "dfw-pro-painters"));
  // Admin changes the doors; an unknown version is ignored.
  const r2 = readRegistry({ bold: { doors: ["grow", "signature", "free", "x"], version: "9.9.9" } });
  assert.deepEqual(r2.bold.doors, ["grow", "signature"]);
  assert.equal(r2.bold.version, undefined);
  assert.ok(canPublishWith(r2, "bold", "grow"));
});

test("blocks: the feature ladder (door, credits, coming soon)", () => {
  assert.equal(blockState("instant_quote", "launch", 0).state, "on");
  assert.equal(blockState("instant_quote", "free", 0).state, "on"); // Free previews like Launch
  assert.deepEqual(blockState("weather", "launch", 10), { state: "upgrade", door: "grow" });
  assert.equal(blockState("weather", "grow", 10).state, "soon");
  assert.equal(blockState("color_studio_ai", "grow", 10).state, "soon");
  assert.ok(BLOCKS.color_studio_ai.creditCost > 0);
  assert.equal(BLOCKS.color_studio.creditCost, 0);
  assert.ok(!visibleToVisitors(blockState("voice_chat", "signature", 999)));
});

test("theme: only allowed values survive a save", () => {
  const cfg = configOf("dfw-pro-painters")!;
  const t = cleanTheme({
    tokens: { "c-accent": "#123ABC", "c-nope": "#000000", "c-bg": "red;}body{display:none" },
    fonts: { display: "Marcellus", body: "Comic Sans" },
    sections: [{ key: "maps", on: false, order: 5 }, { key: "content", on: false }, { key: "hack", on: true }],
    menu: [{ label: "Home", path: "/" }, { label: "Bad", path: "javascript:alert(1)" }, { label: "Call", path: "tel:+19035550100" }],
    slots: { "HOME-HERO-1": "aaaaaaaaaaaa", "HOME-HERO-2": "notmine00000", "NOPE": "aaaaaaaaaaaa" },
    pairs: [{ before: "bbbbbbbbbbbb", after: "aaaaaaaaaaaa", caption: "Kitchen" }, { before: "aaaaaaaaaaaa", after: "aaaaaaaaaaaa" }],
    legal: { privacy: "https://rivera.example/privacy", terms: "http://insecure.example" },
    texts: { "en:ctaTitle": "Book your spring repaint", "en:nope": "x", "fr:ctaTitle": "x" },
    heroWord: "Rivera<script>",
  }, cfg, new Set(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]));
  assert.deepEqual(t.tokens, { "c-accent": "#123abc" });
  assert.deepEqual(t.fonts, { display: "Marcellus" });
  assert.deepEqual(t.sections.map((s) => [s.key, s.on]), [["maps", false], ["content", true]]); // required stays on
  assert.deepEqual(t.menu.map((m) => m.path), ["/", "tel:+19035550100"]);
  assert.deepEqual(t.slots, { "HOME-HERO-1": "aaaaaaaaaaaa" });
  assert.equal(t.pairs.length, 1);
  assert.deepEqual(t.legal, { privacy: "https://rivera.example/privacy", terms: "" });
  assert.deepEqual(t.texts, { "en:ctaTitle": "Book your spring repaint" });
  assert.equal(t.heroWord, "Riverascrip"); // cut to 12, then only letters
  assert.match(tokenCss(cfg, t), /--c-accent:#123abc/);
  assert.match(tokenCss(cfg, t), /--f-display:"Marcellus"/);
  assert.equal(resolveSections(cfg, t).find((s) => s.key === "maps")!.on, false);
});

test("schema: an old v1 site upgrades and keeps its content", () => {
  const old = { v: 1, template: "classic", lang: "en", pages: [{ kind: "home", nav: "Home", headline: "Hi" }], photos: [], business: {} };
  const up = upgradeSite(old);
  assert.equal(up.sv, SITE_SCHEMA);
  assert.deepEqual(up.themes, {});
  const r = cleanSite(old, DOOR_LIMITS.launch, "launch");
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.site.sv, SITE_SCHEMA);
    assert.equal(r.site.template, "classic");
    assert.equal(r.site.pages.find((p) => p.kind === "home")!.headline, "Hi");
  }
  // Themes for unknown templates are dropped; switching templates keeps both themes.
  const s = draft();
  const r2 = cleanSite({ ...s, template: "classic", themes: { "dfw-pro-painters": { tokens: { "c-accent": "#111111" } }, ghost: {} } }, DOOR_LIMITS.launch, "launch");
  assert.ok(r2.ok && r2.site.themes["dfw-pro-painters"].tokens["c-accent"] === "#111111" && !("ghost" in r2.site.themes));
  assert.equal(firstDraft({ name: "X", trades: [], cities: [], lang: "en" }, DOOR_LIMITS.launch).template, "dfw-pro-painters");
});

test("render: Sunset draws every page with the required pieces, escaped", () => {
  const s = draft();
  s.pages[0].headline = 'House painting <script>alert(1)</script> in Tyler';
  for (const p of s.pages) {
    const html = draw(s, { path: pathOf(p) });
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /href="tel:\(?\+?9035550100|href="tel:9035550100"/, `tap to call on ${pathOf(p)}`);
    assert.match(html, /data-lead/, `quote form on ${pathOf(p)}`);
    assert.match(html, /hreflang="es"/);
    assert.match(html, /\/templates\/dfw-pro-painters\/1\.0\.0\/site\.css/);
    assert.ok(!html.includes("<script>alert(1)"));
  }
  const home = draw(s);
  assert.match(home, /"@type":"HousePainter"/);
  for (const id of ["quote", "color-studio", "cities", "map"]) assert.match(home, new RegExp(`id="${id}"`), id);
  assert.match(home, /Website by PaintersMax/);
  // Visitors never see painter-only cards or the AI prompt labels.
  assert.ok(!home.includes("pm-gate") && !home.includes("pm-ph-label") && !home.includes("Create with AI"));
  // The painter's preview shows them, and noindex.
  const pv = draw(s, { preview: true });
  assert.match(pv, /pm-gate/);
  assert.match(pv, /Create with AI/);
  assert.match(pv, /noindex/);
  // Maps key arrives from the Worker only.
  assert.match(draw(s, { mapsKey: "TESTKEY" }), /"mapsKey":"TESTKEY"/);
});

test("render: Spanish toggle switches the template's words", () => {
  const s = draft();
  const es = draw(s, { uiLang: "es" });
  assert.match(es, /<html lang="es">/);
  assert.match(es, /Presupuesto gratis/);
  assert.match(es, /Estudio de color/);
});

test("render: config swap (colors, fonts, order, toggles, words, photos) still draws", () => {
  const s = draft();
  s.themes["dfw-pro-painters"] = cleanTheme({
    tokens: { "c-accent": "#0055aa", "c-bg": "#ffffff" }, fonts: { display: "Playfair Display", body: "DM Sans" },
    sections: [{ key: "color_studio", on: false, order: 1 }, { key: "maps", on: true, order: 2 }, { key: "cities", on: false, order: 3 }],
    texts: { "en:ctaTitle": "Spring openings are filling up" }, heroWord: "Rivera",
    slots: { "HOME-HERO-1": "aaaaaaaaaaaa" }, pairs: [{ before: "bbbbbbbbbbbb", after: "aaaaaaaaaaaa", caption: "Kitchen" }],
    menu: [{ label: "Start", path: "/" }, { label: "Call us", path: "tel:+19035550100" }],
  }, configOf("dfw-pro-painters"), new Set(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]));
  const html = draw(s);
  assert.match(html, /--c-accent:#0055aa/);
  assert.match(html, /family=Playfair\+Display/);
  assert.ok(!html.includes('id="color-studio"'));
  assert.ok(!html.includes('id="cities"'));
  assert.ok(html.indexOf('id="map"') < html.indexOf('id="quote"'), "maps moved above the quote");
  assert.match(html, /Spring openings are filling up/);
  assert.match(html, />Rivera</);
  assert.match(html, /\/site-photo\/7\/aaaaaaaaaaaa/);
  assert.match(html, /id="before-after"/);
  assert.match(html, />Call us</);
  // The same site drawn with the old look still works (switching never loses content).
  const classic = draw({ ...s, template: "classic" });
  assert.match(classic, /Rivera Painting/);
  // Admin "preview as" with another template.
  assert.match(draw({ ...s, template: "classic" }, { tpl: "dfw-pro-painters" }), /dfw-pro-painters\/1\.0\.0/);
});

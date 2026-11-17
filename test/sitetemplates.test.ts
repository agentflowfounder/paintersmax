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
  assert.deepEqual(e.find((t) => t.id === "sunset-sand")!.doors, ["launch", "grow", "signature"]);
  assert.deepEqual(e.find((t) => t.id === "bold")!.doors, ["signature"]);
  assert.ok(!canPublishWith(reg, "sunset-sand", "free"));
  assert.ok(canPublishWith(reg, "sunset-sand", "launch"));
  assert.ok(!canPublishWith(reg, "bold", "grow"));
  // Free may choose any template that is on (to preview); Launch may not choose a Signature one.
  assert.ok(mayChoose(reg, "bold", "free", "classic"));
  assert.ok(!mayChoose(reg, "bold", "launch", "classic"));
  assert.equal(pickerList(reg, "launch", "classic").find((t) => t.id === "bold")!.state, "locked");
  // Admin turns a template off: hidden from new choices, kept for the client already using it.
  const off = readRegistry({ "sunset-sand": { enabled: false }, junk: { enabled: true } });
  assert.equal(Object.keys(off).length, 1);
  assert.ok(!pickerList(off, "launch", "classic").some((t) => t.id === "sunset-sand"));
  assert.ok(pickerList(off, "launch", "sunset-sand").some((t) => t.id === "sunset-sand" && t.current));
  assert.ok(!mayChoose(off, "sunset-sand", "grow", "classic"));
  assert.ok(mayChoose(off, "sunset-sand", "grow", "sunset-sand"));
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
  const cfg = configOf("sunset-sand")!;
  const t = cleanTheme({
    tokens: { "c-accent": "#123ABC", "c-nope": "#000000", "c-bg": "red;}body{display:none" },
    fonts: { display: "Marcellus", body: "Comic Sans" },
    sections: [{ key: "maps", on: false, order: 5 }, { key: "content", on: false }, { key: "hack", on: true }],
    menu: [{ label: "Home", path: "/" }, { label: "Bad", path: "javascript:alert(1)" }, { label: "Call", path: "tel:+19035550100" }],
    slots: { "HOME-HERO": "aaaaaaaaaaaa", "HERO-CARD": "notmine00000", "NOPE": "aaaaaaaaaaaa" },
    pairs: [{ before: "bbbbbbbbbbbb", after: "aaaaaaaaaaaa", caption: "Kitchen" }, { before: "aaaaaaaaaaaa", after: "aaaaaaaaaaaa" }],
    legal: { privacy: "https://rivera.example/privacy", terms: "http://insecure.example" },
    texts: { "en:ctaTitle": "Book your spring repaint", "en:nope": "x", "fr:ctaTitle": "x" },
    heroWord: "Rivera<script>",
  }, cfg, new Set(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]));
  assert.deepEqual(t.tokens, { "c-accent": "#123abc" });
  assert.deepEqual(t.fonts, { display: "Marcellus" });
  assert.deepEqual(t.sections.map((s) => [s.key, s.on]), [["maps", false], ["content", true]]); // required stays on
  assert.deepEqual(t.menu.map((m) => m.path), ["/", "tel:+19035550100"]);
  assert.deepEqual(t.slots, { "HOME-HERO": "aaaaaaaaaaaa" });
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
  const r2 = cleanSite({ ...s, template: "classic", themes: { "sunset-sand": { tokens: { "c-accent": "#111111" } }, ghost: {} } }, DOOR_LIMITS.launch, "launch");
  assert.ok(r2.ok && r2.site.themes["sunset-sand"].tokens["c-accent"] === "#111111" && !("ghost" in r2.site.themes));
  assert.equal(firstDraft({ name: "X", trades: [], cities: [], lang: "en" }, DOOR_LIMITS.launch).template, "sunset-sand");
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
    assert.match(html, /\/templates\/sunset-sand\/1\.0\.0\/site\.css/);
    assert.ok(!html.includes("<script>alert(1)"));
  }
  const home = draw(s);
  assert.match(home, /"@type":"HousePainter"/);
  for (const id of ["quote", "color-studio", "cities", "map"]) assert.match(home, new RegExp(`id="${id}"`), id);
  assert.match(home, /Website by PaintersMax/);
  // Phase 4 audit fixes: absolute hreflang pair, a tab icon, no h4 jump in the footer.
  assert.match(home, /<link rel="alternate" hreflang="en" href="https:\/\/rivera\.paintersmax\.app\/">/);
  assert.match(home, /<link rel="alternate" hreflang="es" href="https:\/\/rivera\.paintersmax\.app\/\?lang=es">/);
  assert.match(home, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.ok(!home.includes("<h4"));
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
  s.themes["sunset-sand"] = cleanTheme({
    tokens: { "c-accent": "#0055aa", "c-bg": "#ffffff" }, fonts: { display: "Playfair Display", body: "DM Sans" },
    sections: [{ key: "color_studio", on: false, order: 1 }, { key: "maps", on: true, order: 2 }, { key: "cities", on: false, order: 3 }],
    texts: { "en:ctaTitle": "Spring openings are filling up" }, heroWord: "Rivera",
    slots: { "HOME-HERO": "aaaaaaaaaaaa" }, pairs: [{ before: "bbbbbbbbbbbb", after: "aaaaaaaaaaaa", caption: "Kitchen" }],
    menu: [{ label: "Start", path: "/" }, { label: "Call us", path: "tel:+19035550100" }],
  }, configOf("sunset-sand"), new Set(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]));
  const html = draw(s);
  assert.match(html, /--c-accent:#0055aa/);
  assert.match(html, /family=Playfair\+Display/);
  assert.ok(!html.includes('id="color-studio"'));
  assert.ok(!html.includes('id="cities"'));
  assert.ok(html.indexOf('id="map"') < html.indexOf('id="quote"'), "maps moved above the quote");
  assert.match(html, /Spring openings are filling up/);
  assert.match(html, /\/site-photo\/7\/aaaaaaaaaaaa/);
  assert.match(html, /id="work"/);
  assert.match(html, />Call us</);
  // The same site drawn with the old look still works (switching never loses content).
  const classic = draw({ ...s, template: "classic" });
  assert.match(classic, /Rivera Painting/);
  // Admin "preview as" with another template.
  assert.match(draw({ ...s, template: "classic" }, { tpl: "sunset-sand" }), /sunset-sand\/1\.0\.0/);
});

test("render: Sunset Sand draws every page, three hero words with the city, hero card and Spanish", () => {
  const s = draft();
  s.template = "sunset-sand";
  for (const p of s.pages) {
    const html = draw(s, { path: pathOf(p), tpl: "sunset-sand" });
    assert.match(html, /\/templates\/sunset-sand\/1\.0\.0\/site\.css/, pathOf(p));
    assert.match(html, /href="tel:9035550100"/, `tap to call on ${pathOf(p)}`);
    assert.match(html, /data-lead/, `quote form on ${pathOf(p)}`);
    assert.ok(!html.includes("<h4"));
  }
  const home = draw(s, { tpl: "sunset-sand" });
  assert.match(home, /<span>Fresh Coat<\/span>.*<span>Colors You Love<\/span>.*<span>Tyler<\/span>/s);
  for (const id of ["story", "services", "cities", "process", "quote", "color-studio", "map"]) assert.match(home, new RegExp(`id="${id}"`), id);
  assert.match(home, /<details name="steps" open>/);
  // Visitors see the default hero photo in the card, and never the painter's "Create Video" hint or photo labels.
  assert.match(home, /class="hero-card"/);
  assert.ok(!home.includes("Create Video in dashboard") && !home.includes("pm-ph-label") && !home.includes("pm-gate"));
  assert.match(draw(s, { tpl: "sunset-sand", preview: true }), /Create Video in dashboard/);
  // A painter's video link (YouTube or Vimeo only) turns the card into a link.
  s.themes["sunset-sand"] = { ...(s.themes["sunset-sand"] ?? {}), texts: { "en:heroVideoUrl": "https://youtu.be/abc123" } } as any;
  assert.match(draw(s, { tpl: "sunset-sand" }), /<a class="hero-card" href="https:\/\/youtu\.be\/abc123"/);
  s.themes["sunset-sand"].texts = { "en:heroVideoUrl": "javascript:alert(1)" };
  assert.ok(!draw(s, { tpl: "sunset-sand" }).includes("javascript:"));
  const es = draw(s, { tpl: "sunset-sand", uiLang: "es" });
  assert.match(es, /<html lang="es">/);
  assert.match(es, /Pintura Nueva/);
  assert.match(es, /Cuatro pasos sencillos/);
});

test("pairs: service, city, year and size are cleaned, old pairs get empty details, and Sunset Sand shows the project row", () => {
  const s = draft();
  const th = cleanTheme({ pairs: [
    { before: "bbbbbbbbbbbb", after: "aaaaaaaaaaaa", caption: "Oak Street kitchen", service: "Cabinet painting", city: "Tyler", year: "2026", size: "2,400 sq ft" },
    { before: "aaaaaaaaaaaa", after: "bbbbbbbbbbbb", caption: "Hall", service: "Interior painting", year: "26<script>" },
  ] }, configOf("sunset-sand")!, new Set(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]));
  assert.equal(th.pairs[0].year, "2026");
  assert.equal(th.pairs[1].year, "");
  assert.equal(th.pairs[1].city, "");
  // A schema 2 site upgrades with empty details on every saved pair.
  const old = { v: 1, sv: 2, template: "sunset-sand", lang: "en", pages: [], photos: [], business: {}, themes: { "sunset-sand": { pairs: [{ before: "a", after: "b", caption: "c" }] } } };
  const up = upgradeSite(old);
  assert.equal(up.sv, SITE_SCHEMA);
  assert.deepEqual(up.themes["sunset-sand"].pairs[0], { service: "", city: "", year: "", size: "", before: "a", after: "b", caption: "c" });
  // The work band: tabs by service, a strip, and the details row, all escaped.
  s.template = "sunset-sand";
  s.themes["sunset-sand"] = { ...th, pairs: th.pairs.map((p, i) => (i === 0 ? { ...p, caption: "Oak <b>Street</b>" } : p)) } as any;
  const html = draw(s, { tpl: "sunset-sand" });
  assert.match(html, /<dl class="work-meta">.*Cabinet painting.*Tyler.*2026.*2,400 sq ft/s);
  assert.match(html, /class="wt" data-f="Interior painting"/);
  assert.match(html, /class="wthumb"/);
  assert.ok(!html.includes("<b>Street</b>"));
  // Pairs also draw as plain sliders when previewing with this template.
  s.template = "sunset-sand";
  s.themes["sunset-sand"] = th as any;
  assert.match(draw(s, { tpl: "sunset-sand" }), /class="pm-ba/);
});

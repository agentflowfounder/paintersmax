import { test } from "node:test";
import assert from "node:assert/strict";
import { configOf, TEMPLATE_IDS, TEMPLATE_VERSIONS } from "../templates/configs.ts";
import { DOOR_LIMITS, firstDraft, pathOf, type Site } from "../src/sitecore.ts";
import { canPublishWith, entries, readRegistry, renderWithTemplate } from "../src/sitetemplates.ts";
import { cleanPack, readPack, registerPacks } from "../src/sitepacks.ts";

const paid = { format: "paintersmax-template-pack", id: "warm-oak", name: "Warm Oak", tier: "basic", base: "sunset-sand", description: { en: "Warm oak and cream.", es: "Roble y crema." }, tokens: { "c-brand": "#8A5A2B" }, fonts: { display: "Marcellus" } };
const free = { format: "paintersmax-template-pack", id: "harbor-free", name: "Harbor", tier: "free", base: "classic", description: { en: "Blue header." }, palette: { dark: "#12263f", bg: "#f5f6f8", accent: "#e0953a" } };

const site = (): Site => firstDraft({ name: "Rivera Painting", phone: "(903) 555-0100", email: "hi@rivera.example", city: "Tyler", state: "TX", trades: ["interior"], cities: ["Tyler, TX"], insured: true, warrantyMonths: 24, lang: "en" }, DOOR_LIMITS.free);
const draw = (s: Site, door: any, tpl: string, path = "/", reg: any = {}) =>
  renderWithTemplate({ site: s, page: s.pages.find((p) => pathOf(p) === path)!, company: { id: 7, slug: "rivera", name: "Rivera Painting" }, origin: "https://rivera.paintersmax.app", link: (p) => p, quoteHref: "/quote", photoSrc: (id) => `/p/${id}`, cityPages: [], reviews: [] }, { reg, door, balance: 5, langHref: "/", templateOverride: tpl });

test("packs: a good pack is cleaned, a bad one is refused with a reason", () => {
  const ok = cleanPack(paid, "a@b.example", "2026-11-17");
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.pack.tokens["c-brand"], "#8a5a2b");
    // What is stored reads back the same (this is the path every request takes).
    const back = readPack(JSON.parse(JSON.stringify(ok.pack)));
    assert.equal(back?.id, "warm-oak");
    assert.equal(back?.addedOn, "2026-11-17");
    assert.equal(back?.addedBy, "a@b.example");
  }
  assert.equal(readPack({ id: "x" }), null);
  for (const [bad, why] of [
    [{ ...paid, format: "x" }, /format/], [{ ...paid, id: "Bad Id" }, /id/], [{ ...paid, id: "classic" }, /built-in/], [{ ...paid, tier: "gold" }, /tier/],
    [{ ...paid, base: "evil" }, /base/], [{ ...paid, tokens: { "c-brand": "red" } }, /color/], [{ ...paid, tokens: { "javascript": "#000000" } }, /Unknown/],
    [{ ...paid, fonts: { display: "Comic Sans" } }, /font/], [{ ...paid, tier: "free" }, /Free templates/], [{ ...free, tier: "basic" }, /Paid tiers/],
    [{ ...free, palette: { dark: "url(x)" } }, /palette/], [{ ...paid, description: { en: "" } }, /description/],
  ] as const) {
    const r = cleanPack(bad);
    assert.ok(!r.ok && why.test(r.error), JSON.stringify(bad).slice(0, 60));
  }
  assert.ok(!cleanPack("{not json").ok);
  assert.ok(!cleanPack("x".repeat(30000)).ok);
});

test("packs: registered packs join the tier lists, draw with their base layout, and delete cleanly", () => {
  const p = cleanPack(paid, "", "2026-11-17"), f = cleanPack(free, "", "2026-11-17");
  assert.ok(p.ok && f.ok);
  registerPacks([(p as any).pack, (f as any).pack]);
  try {
    assert.ok(TEMPLATE_IDS.includes("warm-oak") && TEMPLATE_IDS.includes("harbor-free"));
    const reg = readRegistry({});
    const e = entries(reg);
    assert.deepEqual(e.find((t) => t.id === "warm-oak")!.doors, ["launch", "grow", "signature"]);
    assert.deepEqual(e.find((t) => t.id === "harbor-free")!.doors, ["free", "launch", "grow", "signature"]);
    assert.ok(e.find((t) => t.id === "warm-oak")!.pack);
    assert.ok(canPublishWith(reg, "harbor-free", "free"));
    assert.ok(!canPublishWith(reg, "warm-oak", "free"));
    // The pack's colors and fonts are its defaults; the layout is the base layout.
    assert.equal(configOf("warm-oak")!.tokens.find((t) => t.key === "c-brand")!.default, "#8a5a2b");
    assert.ok(draw(site(), "launch", "warm-oak").includes("#8a5a2b") || draw(site(), "launch", "warm-oak").includes("Marcellus"));
    // A free pack draws as one page with the pack's colors.
    const html = draw(site(), "free", "harbor-free");
    assert.ok(html.includes("#12263f") && html.includes("#f5f6f8") && html.includes('class="panel"'));
  } finally {
    registerPacks([]);
  }
  assert.ok(!TEMPLATE_IDS.includes("warm-oak") && !TEMPLATE_VERSIONS["warm-oak"]);
  // A site that used a deleted pack is drawn with Classic and nothing throws.
  const s = site();
  s.template = "warm-oak";
  assert.ok(draw(s, "launch", "").includes("<html"));
});

test("free tier: Classic and Bold draw one page with five working tabs; paid doors keep separate pages", () => {
  const s = site();
  const onePage = draw(s, "free", "classic", "/");
  const panels = onePage.match(/class="panel"/g) ?? [];
  assert.ok(panels.length >= 5, "a panel for each page");
  for (const nav of s.pages.filter((p) => p.kind !== "service").map((p) => p.nav)) assert.ok(onePage.includes(`>${nav}</a>`), nav);
  assert.ok(onePage.includes('data-p="') && onePage.includes("history.pushState"));
  // Exactly one panel is visible on each address, and the address picks it.
  const onServices = draw(s, "free", "classic", "/services");
  assert.equal((onServices.match(/class="panel"[^>]*>/g) ?? []).filter((x) => !/ hidden/.test(x)).length, 1);
  assert.ok(/id="p-[^"]+" data-path="\/services"[^>]*>/.test(onServices) && !/data-path="\/services"[^>]*hidden/.test(onServices));
  // Bold differs from Classic, and a paid door gets the usual multi-page layout.
  assert.notEqual(draw(s, "free", "bold"), onePage);
  assert.ok(!draw(s, "launch", "classic").includes('class="panel"'));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  blankPage, cleanSite, DOOR_LIMITS, doorFor, firstDraft, healthFlags, limitsFor, nextDoor, pageForPath, pathOf, publishBlockers, readDoorRecord, seoChecks, upgradeCents, usageOf,
} from "../src/sitecore.ts";
import { renderSitePage, siteSitemap, structuredData } from "../src/siterender.ts";
import { bumpRoute, cleanListing, dirCityKey, dirCitySlug, isDuplicate, keyFromCitySlug, parseImport, pickMember, readMember } from "../src/dircore.ts";
import { addDays, cleanSubmission, linkDays, readReview, reviewsHtml, shortName } from "../src/reviews.ts";

const draft = (lang: "en" | "es" = "en") =>
  firstDraft({ name: "Rivera Painting", phone: "903-555-0100", city: "Tyler", state: "TX", trades: ["interior", "exterior", "cabinets", "drywall"], cities: ["Tyler, TX", "Longview, TX"], insured: true, warrantyMonths: 24, lang }, DOOR_LIMITS.launch);

test("doors: the approved page, service and photo limits", () => {
  assert.deepEqual(DOOR_LIMITS.launch, { pages: 5, services: 3, photos: 30 });
  assert.deepEqual(DOOR_LIMITS.grow, { pages: 10, services: 6, photos: 75 });
  assert.deepEqual(DOOR_LIMITS.signature, { pages: 15, services: 10, photos: 150 });
  assert.equal(doorFor("starter", {}), "launch");
  assert.equal(doorFor("pro", {}), "signature");
  assert.equal(doorFor("free", { door: "grow" }), "grow");
  assert.equal(nextDoor("launch"), "grow");
  assert.equal(nextDoor("signature"), null);
  assert.equal(upgradeCents("launch", "grow"), 10000);
  assert.equal(upgradeCents("free", "launch"), 29900);
});

test("admin override raises limits and never lowers them", () => {
  const rec = readDoorRecord({ door: "launch", override: { pages: 8, services: 1, photos: "x" }, note: "Trade group" });
  assert.deepEqual(limitsFor("launch", rec), { pages: 8, services: 3, photos: 30 });
  assert.deepEqual(readDoorRecord("not json"), {});
});

test("first draft: 5 core pages plus one page per service, within the door", () => {
  const s = draft();
  const u = usageOf(s);
  assert.equal(u.pages, 5);
  assert.equal(u.services, 3); // 4 trades, Local Pro allows 3
  assert.equal(s.pages[0].kind, "home");
  assert.ok(s.pages[0].seoTitle.length <= 60);
  assert.match(s.pages[0].blocks.map((b) => (b.type === "text" ? b.body : "")).join(" "), /Insured/);
  assert.ok(s.pages.some((p) => p.blocks.some((b) => b.type === "reviews")));
  // Starter text the painter must write stops the publish.
  assert.ok(publishBlockers(s).some((b) => b.includes("bracketed")));
});

test("Spanish first draft", () => {
  const s = draft("es");
  assert.equal(s.lang, "es");
  assert.equal(s.pages[0].nav, "Inicio");
  assert.match(s.pages.find((p) => p.kind === "service")!.headline, /Pintura de interiores en Tyler, TX/);
});

test("cleanSite: limits are enforced and core pages always exist once", () => {
  const s = draft();
  const extra = { ...s, pages: [...s.pages, blankPage("custom", "Financing")] };
  const r = cleanSite(extra, DOOR_LIMITS.launch, "launch");
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.over, "pages");
  const g = cleanSite(extra, DOOR_LIMITS.grow, "grow");
  assert.ok(g.ok);
  // Duplicate home pages are dropped; a missing core page comes back.
  const odd = cleanSite({ pages: [{ kind: "home", nav: "A" }, { kind: "home", nav: "B" }] }, DOOR_LIMITS.launch, "launch");
  assert.ok(odd.ok && odd.site.pages.filter((p) => p.kind === "home").length === 1 && odd.site.pages.length === 5);
  // Photo ids must come from the site's photo list.
  const ph = cleanSite({ ...s, photos: [{ id: "abcdef123456", alt: "Kitchen" }], pages: [{ kind: "gallery", blocks: [{ type: "photos", photos: ["abcdef123456", "nothere12345"] }] }] }, DOOR_LIMITS.launch, "launch");
  assert.ok(ph.ok);
  const blk = ph.ok ? ph.site.pages.find((p) => p.kind === "gallery")!.blocks[0] : null;
  assert.deepEqual(blk && blk.type === "photos" ? blk.photos : null, ["abcdef123456"]);
  // Any known template may sit in a draft (the door is checked at publish); an unknown one becomes classic.
  assert.equal(cleanSite({ template: "bold" }, DOOR_LIMITS.launch, "launch").ok && (cleanSite({ template: "bold" }, DOOR_LIMITS.launch, "launch") as any).site.template, "bold");
  assert.equal((cleanSite({ template: "nope" }, DOOR_LIMITS.launch, "launch") as any).site.template, "classic");
  // A Search Console tag pasted whole keeps only the code.
  const gsc = cleanSite({ gscToken: '<meta name="google-site-verification" content="AbC_123-xyz987" />' }, DOOR_LIMITS.launch, "launch");
  assert.equal(gsc.ok && gsc.site.gscToken, "AbC_123-xyz987");
});

test("paths: each page has its own address", () => {
  const s = draft();
  const svc = s.pages.find((p) => p.kind === "service")!;
  assert.equal(pathOf(s.pages[0]), "/");
  assert.equal(pathOf(svc), `/services/${svc.slug}`);
  assert.equal(pageForPath(s, "/about/")?.kind, "about");
  assert.equal(pathOf(blankPage("custom", "Financing")), "/info/financing");
  assert.equal(pageForPath(s, "/nothing"), null);
});

test("SEO checks flag short text, missing descriptions and duplicate titles", () => {
  const s = draft();
  const about = s.pages.find((p) => p.kind === "about")!;
  const c = seoChecks(s, about);
  assert.ok(c.some((x) => !x.ok && x.text.includes("bracketed")));
  s.pages[1].seoTitle = s.pages[0].seoTitle;
  assert.ok(seoChecks(s, s.pages[0]).some((x) => !x.ok && x.text.includes("same title")));
});

test("health flags for the admin list", () => {
  assert.deepEqual(healthFlags(null, null, "2026-11-15"), ["No site yet"]);
  const s = draft();
  assert.deepEqual(healthFlags(s, "2026-08-01T00:00:00Z", "2026-11-15"), ["No publish in 60 days", "No photos"]);
});

test("rendered page: escaped text, Google business markup, tabs, no preview banner when live", () => {
  const s = draft();
  s.pages[0].headline = `<script>alert(1)</script>`;
  const html = renderSitePage({ site: s, page: s.pages[0], company: { id: 7, slug: "rivera", name: "Rivera & Sons" }, origin: "https://rivera.com", link: (p) => p, quoteHref: "/quote", photoSrc: (id) => `/site-photo/7/${id}`, cityPages: [], reviews: [{ id: "1", name: "Ana P.", rating: 5, text: "Great <b>job</b>", at: "2026-11-01T00:00:00Z", reply: { text: "Thanks", icon: "heart", at: "" } }] });
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes('"@type":"HousePainter"'));
  assert.ok(html.includes('<link rel="canonical" href="https://rivera.com/">'));
  assert.ok(!html.includes("noindex"));
  assert.ok(html.includes("Great &lt;b&gt;job&lt;/b&gt;"));
  assert.ok(html.includes("❤"));
  const svc = s.pages.find((p) => p.kind === "service")!;
  const sh = renderSitePage({ site: s, page: svc, company: { id: 7, slug: "rivera", name: "Rivera" }, origin: "https://rivera.com", link: (p) => p, quoteHref: "/quote", photoSrc: (id) => id, cityPages: [], preview: true });
  assert.ok(sh.includes('role="tablist"'));
  assert.ok(sh.includes("noindex"));
  const ld = structuredData({ site: s, page: svc, company: { id: 7, slug: "r", name: "R" }, origin: "https://r.com", link: (p) => p, quoteHref: "", photoSrc: (i) => i, cityPages: [] });
  assert.ok(JSON.stringify(ld).includes("BreadcrumbList"));
});

test("sitemap lists every site page and the city pages", () => {
  const s = draft();
  const xml = siteSitemap("https://rivera.com", s, [{ slug: "tyler-tx", updated: "2026-11-10 00:00:00" }], "2026-11-14T00:00:00Z");
  assert.equal((xml.match(/<url>/g) ?? []).length, 9);
  assert.ok(xml.includes("https://rivera.com/areas/tyler-tx"));
});

test("directory: city addresses, listings, import and duplicates", () => {
  assert.equal(dirCityKey("Sulphur Springs", "TX"), "tx-sulphur-springs");
  assert.equal(dirCitySlug("Sulphur Springs", "TX"), "sulphur-springs-tx");
  assert.equal(keyFromCitySlug("sulphur-springs-tx"), "tx-sulphur-springs");
  assert.equal(keyFromCitySlug("tyler"), null);
  assert.equal(cleanListing({ name: "X", city: "Tyler", state: "TX" }), null);
  const l = cleanListing({ name: "Rivera Painting", city: "Tyler", state: "tx", phone: "(903) 555-0100", website: "riverapainting.com", services: ["interior", "bogus"] })!;
  assert.equal(l.website, "https://riverapainting.com");
  assert.deepEqual(l.services, ["interior"]);
  const imp = parseImport('name,city,state,phone,website\n"Smith, Jones Painting",Tyler,TX,903-555-0101,\nBad line\nOak Painters\tLongview\tTX\t903 555 0102\t');
  assert.equal(imp.listings.length, 2);
  assert.equal(imp.listings[0].name, "Smith, Jones Painting");
  assert.equal(imp.skipped, 1);
  assert.ok(isDuplicate(l, { cityKey: "tx-tyler", phone: "903.555.0100", name: "Other" }));
  assert.ok(isDuplicate(l, { cityKey: "tx-tyler", phone: "", name: "Rivera Painting LLC" }));
  assert.ok(!isDuplicate(l, { cityKey: "tx-longview", phone: "903.555.0100", name: "Rivera Painting" }));
});

test("lead routing: fewest leads today first, daily cap, then the pool", () => {
  const m = [{ id: 1 }, { id: 2, cap: 1 }];
  const st = new Map([[1, { day: "2026-11-15", count: 2, last: "2026-11-15T10:00:00Z" }]]);
  assert.equal(pickMember(m, st, "2026-11-15")?.id, 2);
  st.set(2, bumpRoute(undefined, "2026-11-15", "2026-11-15T11:00:00Z"));
  assert.equal(pickMember(m, st, "2026-11-15")?.id, 1); // 2 is at its cap
  st.set(1, { day: "2026-11-15", count: 5, last: "x" });
  assert.equal(pickMember(m, st, "2026-11-15"), null); // everyone full: market pool
  assert.equal(pickMember(m, st, "2026-11-16")?.id, 2); // a new day resets the counts; then whoever waited longest
  assert.deepEqual(readMember({ founding: true, cap: 999, optOut: "yes" }), { founding: true });
});

test("reviews: link length, names, submissions and safe output", () => {
  assert.equal(linkDays(undefined), 45);
  assert.equal(linkDays(3), 45);
  assert.equal(linkDays(30), 30);
  assert.equal(addDays("2026-11-15", 45), "2026-12-30");
  assert.equal(shortName("Ana Maria Perez"), "Ana P.");
  assert.equal(shortName(""), "Customer");
  assert.equal(cleanSubmission({ rating: 6, text: "Great job overall", consent: true }).ok, false);
  assert.equal(cleanSubmission({ rating: 4, text: "ok", consent: true }).ok, false);
  assert.equal(cleanSubmission({ rating: 4, text: "Great job overall", consent: false }).ok, false);
  const ok = cleanSubmission({ rating: "5", text: "Great job overall", name: "Ana Perez", consent: true });
  assert.ok(ok.ok && ok.name === "Ana P." && ok.rating === 5);
  const r = readReview({ id: "abc123def0", rating: 9, text: "x", status: "weird", reply: { text: "", icon: "heart" } })!;
  assert.equal(r.rating, 5);
  assert.equal(r.status, "pending");
  assert.equal(r.reply?.icon, "heart");
  assert.equal(reviewsHtml([], "Co", "en", "Reviews"), "");
  assert.ok(reviewsHtml([{ id: "1", name: "<i>A</i>", rating: 3, text: "t", at: "2026-11-01" }], "Co", "es", "Reseñas").includes("&lt;i&gt;A&lt;/i&gt;"));
});

test("Spanish strings for the new screens load and translate", () => {
  const docEl: any = { nodeType: 1, nodeName: "HTML", firstChild: null, hasAttribute: () => false, getAttribute: () => null, lang: "en" };
  const ctx: any = {
    confirm: () => true, alert: () => {}, MutationObserver: class { observe() {} }, fetch: () => Promise.resolve({}), location: { reload() {} },
    document: { currentScript: { hasAttribute: () => false }, documentElement: docEl, addEventListener() {}, getElementById: () => null },
    localStorage: { getItem: () => "es", setItem() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../public/i18n.js", import.meta.url), "utf8"), ctx);
  vm.runInContext(readFileSync(new URL("../public/i18n-site.js", import.meta.url), "utf8"), ctx);
  const T = ctx.pmT as (s: string) => string;
  assert.equal(T("Save draft"), "Guardar borrador");
  assert.equal(T("Your Local Pro site can have 5 pages."), "Su sitio Local Pro puede tener 5 páginas.");
  assert.equal(T("At least 150 words of real text (now 12)"), "Al menos 150 palabras de texto real (ahora 12)");
  // Every T('...') string in the new pages has a Spanish version.
  for (const f of ["../public/site.html", "../public/sites-admin.html", "../public/templates-admin.html"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const m of src.matchAll(/T\('((?:[^'\\]|\\.)*)'\)/g)) {
      const s = m[1].replace(/\\'/g, "'");
      assert.ok(T(s) !== s || /^(Contractor|Local Pro|Commercial|Google Search Console|exterior|interior|Search Console)$/.test(s), `missing Spanish: ${s}`);
    }
  }
});

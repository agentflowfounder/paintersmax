import { escapeHtml as e } from "../../src/settings.ts";
import { reviewsHtml } from "../../src/reviews.ts";
import { pathOf, type Block, type Page } from "../../src/sitecore.ts";
import { richText, structuredData } from "../../src/siterender.ts";
import { fontsHref, resolveFonts, resolveSections, tokenCss } from "../../src/sitetheme.ts";
import {
  beforeAfter, businessInfo, chatHelper, cityList, colorStudio, colorStudioAi, estimateRequest, ic, instantQuote, leadForm, map, pagePhoto, photo,
  reviewsBlock, sectionHead, slotDef, soonOnly, t, tel,
} from "../_shared/blocks.ts";
import type { ThemeRenderCtx } from "../_shared/ctx.ts";
import { sprite } from "../_shared/icons.ts";

/**
 * Template 2, "Sunset Sand" (sunset-sand), drawn from the painter's Site document.
 * Markup follows the classes in /templates/sunset-sand/1.0.0/site.css. The platform blocks come from _shared.
 */

type X = ThemeRenderCtx;
const num = (n: number) => String(n).padStart(2, "0");
const clean = (s: string) => s.replace(/\[[^\]]*\]/g, "").trim();

/** The painter's own wording for a phrase, with {city} filled in. */
function words(x: X, key: string): string {
  const city = x.site.business.city || x.company.name;
  return t(x, key).replace(/\{city\}/g, city);
}

/** Only a YouTube or Vimeo address may become the hero video link. */
function videoUrl(x: X): string {
  const v = (x.theme.texts[`${x.uiLang}:heroVideoUrl`] ?? x.theme.texts["en:heroVideoUrl"] ?? "").trim();
  return /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\/[^\s"'<>]+$/i.test(v) ? v : "";
}

function header(x: X, nav: { label: string; href: string; on: boolean }[]) {
  const c = x.company;
  const b = x.site.business;
  const logo = x.theme.logo ? x.site.photos.find((p) => p.id === x.theme.logo) : null;
  const mark = logo ? `<img class="pm-logo-img" src="${e(x.photoSrc(logo.id))}" alt="" width="36" height="36">` : c.logoUrl ? `<img class="pm-logo-img" src="${e(c.logoUrl)}" alt="" width="36" height="36">` : "";
  const links = nav.map((n) => `<a href="${e(n.href)}"${n.on ? ' aria-current="page"' : ""}>${e(n.label)}</a>`).join("");
  const dl = nav.map((n) => `<a class="dl" href="${e(n.href)}">${e(n.label)}</a>`).join("");
  return `<a class="skip" href="#main-content">${e(t(x, "skip"))}</a>
<header class="hdr"><div class="wrap">
<a class="logo" href="${e(x.link("/"))}" aria-label="${e(c.name)}">${mark}<span>${e(c.name)}</span></a>
<nav class="nav" aria-label="${e(t(x, "menu"))}">${links}</nav>
<span class="pm-hdr-r"><a class="pm-lang" href="${e(x.langHref)}" hreflang="${e(t(x, "langCode"))}" lang="${e(t(x, "langCode"))}">${e(t(x, "lang"))}</a><a class="inquire" href="${e(x.quoteHref)}">${e(t(x, "inquire"))} ${ic("arrow-up-right")}</a></span>
<button class="menu-btn" type="button" data-open-menu aria-controls="drawer" aria-expanded="false" aria-label="${e(t(x, "openMenu"))}">${ic("menu")}</button>
</div></header>
<div class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="${e(t(x, "menu"))}">
<div class="drawer-head"><span class="logo">${e(c.name)}</span><button class="circle-btn" type="button" data-close-menu aria-label="${e(t(x, "closeMenu"))}">${ic("close")}</button></div>
${dl}<a class="dl" href="${e(x.langHref)}" lang="${e(t(x, "langCode"))}">${e(t(x, "lang"))}</a>${b.phone ? `<a class="btn" href="tel:${e(tel(b.phone))}">${ic("phone")} ${e(t(x, "call"))} ${e(b.phone)}</a>` : ""}</div>`;
}

function heroCard(x: X): string {
  const url = videoUrl(x);
  const img = photo(x, x.theme.slots["HERO-CARD"] ?? pagePhoto(x, x.site.pages.find((q) => q.kind === "home")?.id ?? "", 1), slotDef(x, "HERO-CARD"), { cls: "card-img" });
  if (url) return `<a class="hero-card" href="${e(url)}" target="_blank" rel="noopener">${img}<span class="card-cap">${ic("arrow-up-right")} ${e(t(x, "heroVideo"))}</span></a>`;
  // No video yet: the default photo. Only the painter, in preview, is told how to add one.
  return `<div class="hero-card">${img}<span class="card-cap">${e(t(x, "heroCard"))}</span>${x.preview ? `<span class="pm-gate-tag card-note">${e(t(x, "heroVideoSoon"))}</span>` : ""}</div>`;
}

function hero(x: X, p: Page) {
  const b = x.site.business;
  const isHome = p.kind === "home";
  const slot = isHome ? "HOME-HERO" : "PAGE-HERO";
  const bg = photo(x, x.theme.slots[slot] ?? pagePhoto(x, p.id), slotDef(x, slot), { cls: "hero-bg", eager: true });
  const text = clean(p.intro.split(/\n{2,}/)[0]).slice(0, 220);
  const call = b.phone ? `<a class="btn ghost" href="tel:${e(tel(b.phone))}">${ic("phone")} ${e(b.phone)}</a>` : "";
  if (!isHome) {
    return `<section class="hero short">${bg}<div class="hero-shade"></div><div class="wrap hero-in"><h1 class="hero-title">${e(p.headline || p.nav)}</h1>${text ? `<p class="hero-text">${e(text)}</p>` : ""}<div class="btns"><a class="btn solid" href="${e(x.quoteHref)}">${e(t(x, "quote"))} ${ic("arrow-up-right")}</a>${call}</div></div></section>`;
  }
  const w = [words(x, "hero1"), words(x, "hero2"), words(x, "hero3")];
  const work = x.site.pages.find((q) => q.kind === "gallery");
  return `<section class="hero">${bg}<div class="hero-shade"></div><span class="hline l1" aria-hidden="true"></span><span class="hline l2" aria-hidden="true"></span>
<div class="wrap hero-in"><h1 class="hero-words" aria-label="${e(w.join(" // "))}"><span>${e(w[0])}</span><i aria-hidden="true">//</i><span>${e(w[1])}</span><i aria-hidden="true">//</i><span>${e(w[2])}</span></h1>
<div class="hero-grid"><span class="hero-label">/ ${e(t(x, "heroLabel"))} /</span>
<div class="hero-mid"><p class="hero-sub">${e(t(x, "heroSub"))}</p>${text ? `<p class="hero-text">${e(text)}</p>` : ""}<div class="btns"><a class="btn solid" href="${e(x.quoteHref)}">${e(t(x, "quote"))} ${ic("arrow-up-right")}</a>${call}</div>
<a class="ulink" href="${work ? e(x.link(pathOf(work))) : "#work"}">${e(t(x, "heroLink"))}</a></div>${heroCard(x)}</div></div></section>`;
}

function statement(x: X, p: Page) {
  const about = x.site.pages.find((q) => q.kind === "about");
  const text = clean((p.kind === "about" ? p.intro : about?.intro) ?? "");
  const pic = (slot: string, n: number, cls: string) => `<div class="st-pic ${cls}">${photo(x, x.theme.slots[slot] ?? (about ? pagePhoto(x, about.id, n) : null), slotDef(x, slot))}</div>`;
  return `<section class="statement" id="story"><div class="wrap st-grid">${pic("STORY-1", 0, "p1")}${pic("STORY-2", 1, "p2")}${pic("STORY-3", 2, "p3")}${pic("STORY-4", 3, "p4")}
<div class="st-text reveal"><span class="eyebrow">${e(t(x, "stEyebrow"))}</span><p class="st-big">${e(t(x, "stTitle"))} <span>${e(t(x, "stTitleFade"))}</span></p>${text ? `<p class="small">${e(text.slice(0, 320))}</p>` : ""}${p.kind !== "about" && about ? `<a class="ulink" href="${e(x.link(pathOf(about)))}">${e(t(x, "stLink"))}</a>` : ""}</div></div></section>`;
}

function servicesList(x: X, p: Page) {
  const list = x.site.pages.filter((q) => q.kind === "service");
  if (!list.length) return "";
  const items = list.map((s, i) => `<li><button type="button" class="svc-b" data-svc="${i}" aria-pressed="${i === 0}">${e(s.nav)}</button></li>`).join("");
  const panels = list.map((s, i) => `<div class="svc-panel${i === 0 ? " on" : ""}" data-panel="${i}"${i ? " hidden" : ""}><div class="svc-photo">${photo(x, pagePhoto(x, s.id) ?? x.theme.slots["SERVICE-PHOTO"], slotDef(x, "SERVICE-PHOTO"))}</div><div class="svc-copy"><p>${e(clean(s.intro).slice(0, 200))}</p><a class="ulink" href="${e(x.link(pathOf(s)))}">${e(t(x, "servicesLink"))}</a></div></div>`).join("");
  return `<section class="services" id="services" data-swap><div class="wrap"><div class="two"><span class="eyebrow">/ ${e(t(x, "services"))} /</span><h2>${e(t(x, "servicesTitle"))}</h2></div>
<div class="svc-grid"><ul class="svc-list">${items}</ul><div class="svc-detail">${panels}</div></div></div></section>`;
}

function citiesRows(x: X) {
  const list = cityList(x).slice(0, 10);
  if (!list.length) return "";
  const mapLink = (n: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n)}`;
  return `<section class="cities-sec" id="cities"><div class="wrap cities-grid"><div class="cities-pic">${photo(x, x.theme.slots["CITIES-PHOTO"], slotDef(x, "CITIES-PHOTO"))}</div>
<div><div class="two"><span class="eyebrow">${e(t(x, "citiesEyebrow"))}</span><h2>${e(t(x, "citiesTitle"))}</h2><p class="lead">${e(t(x, "citiesText"))}</p></div>
<ol class="rows">${list.map((c, i) => `<li><a href="${e(c.href || mapLink(c.name))}"${c.href ? "" : ' target="_blank" rel="noopener"'}><span class="no">/ ${num(i + 1)} /</span><span class="nm">${e(c.name)}</span>${ic("arrow-up-right")}</a></li>`).join("")}</ol></div></div></section>`;
}

function work(x: X) {
  const inner = beforeAfter(x);
  if (!inner) return "";
  return `<div class="work dark" id="work"><div class="work-feat">${photo(x, x.theme.slots["WORK-FEATURE"], slotDef(x, "WORK-FEATURE"))}</div>${inner}</div>`;
}

function process(x: X) {
  const steps = [1, 2, 3, 4].map((n) => ({ n, h: t(x, `pr${n}`), b: t(x, `pr${n}Text`) }));
  return `<section class="process" id="process"><div class="wrap proc-grid"><div><div class="two"><span class="eyebrow">/ ${e(t(x, "prEyebrow"))} /</span><h2>${e(t(x, "prTitle"))}</h2></div>
<div class="acc">${steps.map((s) => `<details name="steps"${s.n === 1 ? " open" : ""}><summary><span class="no">[${num(s.n)}]</span><span class="nm">${e(s.h)}</span>${ic("plus")}</summary><p>${e(s.b)}</p></details>`).join("")}</div></div>
<div class="proc-pic">${photo(x, x.theme.slots["PROCESS-PHOTO"], slotDef(x, "PROCESS-PHOTO"))}</div></div></section>`;
}

function contentBlock(x: X, b: Block, i: number): string {
  const band = i % 2 === 1 ? " band" : "";
  if (b.type === "text") {
    if (!b.body && !b.heading) return "";
    return `<section class="pm-text${band}"><div class="wrap split top"><div class="reveal">${b.heading ? `<h2>${e(b.heading)}</h2>` : ""}</div><div class="pm-rich reveal d1">${richText(b.body)}</div></div></section>`;
  }
  if (b.type === "photos") {
    const list = b.photos.map((id) => x.site.photos.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!list.length) return "";
    return `<section class="${band.trim()}"><div class="wrap">${b.heading ? `<div class="sec-head"><h2>${e(b.heading)}</h2></div>` : ""}<div class="masonry">${list.map((p) => `<figure class="reveal">${photo(x, p.id, undefined)}${p.alt ? `<figcaption>${e(p.alt)}</figcaption>` : ""}</figure>`).join("")}</div></div></section>`;
  }
  if (b.type === "tabs") {
    if (!b.tabs.length) return "";
    const uid = `tb${e(b.id)}`;
    return `<section class="${band.trim()}"><div class="wrap">${b.heading ? `<div class="sec-head"><h2>${e(b.heading)}</h2></div>` : ""}<div class="tabs" data-tabs><div class="tablist" role="tablist">${b.tabs.map((tb, n) => `<button class="tab" role="tab" id="${uid}-t${n}" aria-controls="${uid}-p${n}" data-hash="${e(tb.id)}">${e(tb.label)}</button>`).join("")}</div><div class="panels">${b.tabs.map((tb, n) => `<div class="tabpanel pm-rich" role="tabpanel" id="${uid}-p${n}" aria-labelledby="${uid}-t${n}" tabindex="0">${richText(tb.body)}</div>`).join("")}</div></div></div></section>`;
  }
  if (b.type === "cta") {
    const phone = x.site.business.phone;
    const btn = b.action === "call" && phone ? `<a class="btn solid" href="tel:${e(tel(phone))}">${ic("phone")} ${e(t(x, "call"))} ${e(phone)}</a>` : `<a class="btn solid" href="${e(x.quoteHref)}">${e(t(x, "getQuote"))} ${ic("arrow-up-right")}</a>`;
    return `<section><div class="wrap"><div class="cta-in reveal"><div>${b.heading ? `<h2>${e(b.heading)}</h2>` : ""}${b.body ? `<p>${e(b.body)}</p>` : ""}</div><div class="btns">${btn}</div></div></div></section>`;
  }
  if (b.type === "reviews") {
    const list = x.reviews ?? [];
    if (!list.length) return "";
    return `<section class="band pm-reviews"><div class="wrap">${b.heading ? `<div class="sec-head"><h2>${e(b.heading)}</h2></div>` : ""}${reviewsHtml(list, x.company.name, x.site.lang, "")}</div></section>`;
  }
  return "";
}

function servicesGrid(x: X) {
  const list = x.site.pages.filter((q) => q.kind === "service");
  if (!list.length) return "";
  return `<section><div class="wrap"><div class="pm-cards">${list.map((s) => `<a class="pm-card reveal" href="${e(x.link(pathOf(s)))}">${photo(x, pagePhoto(x, s.id), slotDef(x, "SERVICE-PHOTO"))}<b>${e(s.nav)}</b><span>${e(clean(s.intro).slice(0, 150))}</span></a>`).join("")}</div></div></section>`;
}

function closing(x: X) {
  const b = x.site.business;
  return `<section class="closing dark"><div class="closing-bg">${photo(x, x.theme.slots["CTA-BAND"], slotDef(x, "CTA-BAND"))}</div><div class="wrap closing-in reveal"><h2>${e(t(x, "ctaTitle"))}</h2><p>${e(t(x, "ctaText"))}</p>
<div class="closing-links">${b.phone ? `<a class="ulink" href="tel:${e(tel(b.phone))}">${e(b.phone)}</a>` : ""}${b.email ? `<a class="ulink" href="mailto:${e(b.email)}">${e(b.email)}</a>` : ""}</div><a class="btn solid" href="${e(x.quoteHref)}">${e(t(x, "getQuote"))} ${ic("arrow-up-right")}</a></div></section>`;
}

function footer(x: X, nav: { label: string; href: string }[]) {
  const b = x.site.business;
  const c = x.company;
  const social = x.site.social ?? [];
  const legal = x.theme.legal;
  const addr = [b.address, [b.city, b.state].filter(Boolean).join(", "), b.zip].filter(Boolean).join(" ");
  return `<footer class="ftr"><div class="wrap"><div class="ftr-grid"><div><h2>${e(t(x, "footerTitle"))}</h2>${leadForm(x, "website-footer", { compact: true, cls: "ftr-form" })}</div>
<div class="ftr-cols"><div><h3 class="ftr-h">${e(t(x, "pages"))}</h3><ul>${nav.map((n) => `<li><a href="${e(n.href)}">${e(n.label)}</a></li>`).join("")}</ul></div>
<div><h3 class="ftr-h">${e(t(x, "studio"))}</h3><ul>${addr ? `<li><span>${e(addr)}</span></li>` : ""}${b.hours ? `<li><span>${e(b.hours)}</span></li>` : ""}${b.license ? `<li><span>${e(t(x, "license"))} ${e(b.license)}</span></li>` : ""}${x.insuredProof ? `<li><a href="${e(x.insuredProof)}" rel="noopener">${e(t(x, "insured"))}: ${e(t(x, "proof"))}</a></li>` : ""}</ul></div>
<div><h3 class="ftr-h">${e(t(x, "contact"))}</h3><ul>${b.phone ? `<li><a href="tel:${e(tel(b.phone))}">${e(b.phone)}</a></li>` : ""}${b.email ? `<li><a href="mailto:${e(b.email)}">${e(b.email)}</a></li>` : ""}${social.map((s) => `<li><a href="${e(s.url)}" rel="noopener me" target="_blank">${e(s.kind[0].toUpperCase() + s.kind.slice(1))}</a></li>`).join("")}</ul></div></div></div>
<div class="ftr-word" aria-hidden="true" data-t="${e(c.name)}"></div>
<div class="ftr-base"><span>© ${new Date().getUTCFullYear()} ${e(c.name)}. ${e(t(x, "rights"))}</span>${x.founding ? ` <span class="pm-badge">${e(t(x, "founding"))}</span>` : ""}
<span class="pm-legal">${legal.privacy ? `<a href="${e(legal.privacy)}">${e(t(x, "privacy"))}</a>` : ""}${legal.terms ? `<a href="${e(legal.terms)}">${e(t(x, "terms"))}</a>` : ""}<a href="${e(x.langHref)}" lang="${e(t(x, "langCode"))}">${e(t(x, "lang"))}</a><a href="https://paintersmax.app/" rel="noopener">${e(t(x, "by"))}</a></span>${x.site.footer ? `<span>${e(x.site.footer)}</span>` : ""}</div></div></footer>
<nav class="callbar" aria-label="${e(t(x, "contact"))}">${b.phone ? `<a class="call" href="tel:${e(tel(b.phone))}">${ic("phone")} ${e(t(x, "callNow"))}</a>` : ""}<a class="quote" href="${e(x.quoteHref)}">${ic("mail")} ${e(t(x, "quote"))}</a></nav>`;
}

/** A full address for a link inside the site (hreflang must be absolute). */
function absUrl(origin: string, href: string): string {
  return /^https?:\/\//.test(href) ? href : origin.replace(/\/$/, "") + (href.startsWith("/") ? href : "/" + href);
}

/** A small icon for the browser tab when the painter has no logo: their first letter on the brand color. */
function favicon(color: string, name: string): string {
  const c = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#1c1a17";
  const l = (name.trim()[0] || "P").toUpperCase().replace(/[^A-Z0-9]/, "P");
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${c}"/><text x="16" y="23" font-family="Georgia,serif" font-size="20" fill="#fff" text-anchor="middle">${l}</text></svg>`);
}

export function render(x: X): string {
  const { site, page: p, company: c, cfg } = x;
  const title = p.seoTitle || `${p.headline || p.nav} | ${c.name}`;
  const desc = p.seoDesc || clean(p.intro).slice(0, 155);
  const canonical = x.origin.replace(/\/$/, "") + pathOf(p);
  const menu = x.theme.menu.length
    ? x.theme.menu.map((m) => ({ label: m.label, href: m.path.startsWith("/") ? x.link(m.path) : m.path, on: m.path === pathOf(p) }))
    : site.pages.filter((q) => q.kind !== "service").map((q) => ({ label: q.nav, href: x.link(pathOf(q)), on: q.id === p.id }));
  const sections = resolveSections(cfg, x.theme).filter((s) => s.on && s.pages.includes(p.kind));
  const hasReviewsBlock = p.blocks.some((b) => b.type === "reviews");
  const parts: string[] = [];
  for (const s of sections) {
    switch (s.key) {
      case "hero": parts.push(hero(x, p), '<div id="main-content"></div>'); break;
      case "statement": parts.push(statement(x, p)); break;
      case "services": parts.push(p.kind === "services" ? servicesGrid(x) : servicesList(x, p)); break;
      case "content": p.blocks.forEach((b, i) => parts.push(contentBlock(x, b, i))); break;
      case "cities": parts.push(citiesRows(x)); break;
      case "gallery_ba": parts.push(work(x)); break;
      case "process": parts.push(process(x)); break;
      case "instant_quote": parts.push(instantQuote(x)); break;
      case "color_studio": parts.push(colorStudio(x)); break;
      case "color_studio_ai": parts.push(colorStudioAi(x)); break;
      case "review_request": if (!hasReviewsBlock) parts.push(reviewsBlock(x, (h) => reviewsHtml(x.reviews ?? [], c.name, site.lang, h))); break;
      case "business_info": parts.push(businessInfo(x)); break;
      case "maps": parts.push(map(x, t(x, "mapTitle"))); break;
      case "weather": parts.push(soonOnly(x, "weather")); break;
      case "chat_helper": parts.push(chatHelper(x)); break;
      case "voice_chat": parts.push(soonOnly(x, "voice_chat")); break;
      case "estimate_request": parts.push(estimateRequest(x)); break;
      case "cta": parts.push(closing(x)); break;
    }
  }
  const body = parts.join("\n");
  const ld = structuredData(x);
  const fonts = resolveFonts(cfg, x.theme);
  const fh = fontsHref([fonts.display, fonts.body]);
  const ogPhoto = x.theme.slots[cfg.seo.ogImageSlot ?? ""] ?? pagePhoto(x, p.id) ?? site.photos[0]?.id;
  const usedIcons = new Set<string>(["plus", "check", "arrow-up-right", "arrow-left", "arrow-right", "phone", "mail", "menu", "close", "house", "clock", "pin", "shield", "quote", "sparkle", "roller"]);
  const cfgJs = JSON.stringify({ mapsKey: x.mapsKey, mapQuery: [site.business.city, site.business.state].filter(Boolean).join(", "), lang: x.uiLang }).replace(/</g, "\\u003c");
  const brand = x.theme.tokens["c-brand"] ?? cfg.tokens.find((k) => k.key === "c-brand")?.default ?? "#1c1a17";
  return `<!doctype html><html lang="${x.uiLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title><meta name="description" content="${e(desc)}"><link rel="canonical" href="${e(canonical)}">
${x.preview ? '<meta name="robots" content="noindex">' : ""}${p.kind === "home" && site.gscToken ? `<meta name="google-site-verification" content="${e(site.gscToken)}">` : ""}
${x.preview ? "" : `<link rel="alternate" hreflang="${x.uiLang}" href="${e(canonical)}"><link rel="alternate" hreflang="${e(t(x, "langCode"))}" href="${e(absUrl(x.origin, x.langHref))}">`}
<link rel="icon" href="${e((x.theme.logo && site.photos.some((q) => q.id === x.theme.logo) ? x.photoSrc(x.theme.logo) : "") || x.company.logoUrl || favicon(brand, x.company.name))}">
<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${e(canonical)}">${ogPhoto ? `<meta property="og:image" content="${e(x.origin.replace(/\/$/, "") + x.photoSrc(ogPhoto))}">` : ""}
<meta name="theme-color" content="${e(brand)}">
${fh ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${e(fh)}">` : ""}
<link rel="stylesheet" href="${e(x.assetBase)}site.css"><link rel="stylesheet" href="${e(x.platformBase)}blocks.css">
<style>${tokenCss(cfg, x.theme)}</style>
${ld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head><body id="top">${sprite(usedIcons)}
${x.preview ? `<div class="pm-preview-bar">${e(x.uiLang === "es" ? "Vista previa. Este es su borrador; los visitantes ven el sitio publicado." : "Preview. This is your draft; visitors see the published site.")}</div>` : ""}
${header(x, menu)}
<main>${body}</main>
${footer(x, menu)}
<script>window.PM_SITE=${cfgJs}</script><script src="${e(x.assetBase)}site.js" defer></script><script src="${e(x.platformBase)}blocks.js" defer></script></body></html>`;
}

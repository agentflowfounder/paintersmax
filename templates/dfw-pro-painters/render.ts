import { escapeHtml as e } from "../../src/settings.ts";
import { reviewsHtml } from "../../src/reviews.ts";
import { pathOf, type Block, type Page } from "../../src/sitecore.ts";
import { richText, structuredData } from "../../src/siterender.ts";
import { fontsHref, resolveFonts, resolveSections, tokenCss } from "../../src/sitetheme.ts";
import {
  beforeAfter, businessInfo, chatHelper, cities, colorStudio, colorStudioAi, estimateRequest, ic, instantQuote, leadForm, map, pagePhoto, photo,
  reviewsBlock, sectionHead, slotDef, soonOnly, t, tel,
} from "../_shared/blocks.ts";
import type { ThemeRenderCtx } from "../_shared/ctx.ts";
import { sprite } from "../_shared/icons.ts";

/**
 * Template 1, "Sunset" (dfw-pro-painters), drawn from the painter's Site document.
 * Markup follows the classes in /templates/dfw-pro-painters/1.0.0/site.css.
 */

type X = ThemeRenderCtx;

function ring(x: X, text: string, label: string, href: string, id: string) {
  const rep = `${text} · `.repeat(3);
  return `<a class="badge-btn" href="${e(href)}" aria-label="${e(label)}"><svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><defs><path id="${id}" d="M60,60 m-52,0 a52,52 0 1,1 104,0 a52,52 0 1,1 -104,0"/></defs><text><textPath href="#${id}" textLength="326" lengthAdjust="spacing">${e(rep)}</textPath></text></svg><span>${ic("arrow-up-right")}${e(label)}</span></a>`;
}

function header(x: X, nav: { label: string; href: string; on: boolean }[]) {
  const c = x.company;
  const b = x.site.business;
  const logoId = x.theme.logo;
  const logo = logoId ? x.site.photos.find((p) => p.id === logoId) : null;
  const mark = logo ? `<img class="pm-logo-img" src="${e(x.photoSrc(logo.id))}" alt="" width="40" height="40">` : c.logoUrl ? `<img class="pm-logo-img" src="${e(c.logoUrl)}" alt="" width="40" height="40">` : `<span class="logo-mark">${ic("roller")}</span>`;
  const sub = [b.city, b.state].filter(Boolean).join(", ");
  const links = nav.map((n) => `<a href="${e(n.href)}"${n.on ? ' aria-current="page"' : ""}>${e(n.label)}</a>`).join("");
  const dl = nav.map((n) => `<a class="dl" href="${e(n.href)}">${e(n.label)} ${ic("arrow-up-right")}</a>`).join("");
  return `<a class="skip" href="#main-content">${e(t(x, "skip"))}</a>
<header class="hdr"><div class="wrap">
<a class="logo" href="${e(x.link("/"))}" aria-label="${e(c.name)}">${mark}<span>${e(c.name)}${sub ? `<small>${e(sub)}</small>` : ""}</span></a>
<nav class="nav" aria-label="${e(t(x, "menu"))}">${links}</nav>
<span class="pm-hdr-r"><a class="pm-lang" href="${e(x.langHref)}" hreflang="${e(t(x, "langCode"))}" lang="${e(t(x, "langCode"))}">${e(t(x, "lang"))}</a><a class="btn hdr-cta" href="${e(x.quoteHref)}">${e(t(x, "getQuote"))}</a></span>
<button class="menu-btn" type="button" data-open-menu aria-controls="drawer" aria-expanded="false" aria-label="${e(t(x, "openMenu"))}">${ic("menu")}</button>
</div></header>
<div class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="${e(t(x, "menu"))}">
<div class="drawer-head"><span class="logo">${mark}${e(c.name)}</span><button class="circle-btn" type="button" data-close-menu aria-label="${e(t(x, "closeMenu"))}">${ic("close")}</button></div>
${dl}<a class="dl" href="${e(x.langHref)}" lang="${e(t(x, "langCode"))}">${e(t(x, "lang"))}</a>${b.phone ? `<a class="btn btn-light" href="tel:${e(tel(b.phone))}">${ic("phone")} ${e(t(x, "call"))} ${e(b.phone)}</a>` : ""}</div>`;
}

function hero(x: X, p: Page) {
  const b = x.site.business;
  const services = x.site.pages.filter((q) => q.kind === "service");
  const isHome = p.kind === "home";
  const word = (x.theme.heroWord || t(x, "heroWord")).slice(0, 12);
  type Slide = { eyebrow: string; title: string; text: string; photo: string | null; slot: string; href: string };
  const slides: Slide[] = [{ eyebrow: [b.city, b.state].filter(Boolean).join(", ") || x.company.name, title: p.headline || p.nav, text: p.intro.split(/\n{2,}/)[0].replace(/\[[^\]]*\]/g, "").trim().slice(0, 220), photo: x.theme.slots[isHome ? "HOME-HERO-1" : "PAGE-HERO"] ?? pagePhoto(x, p.id), slot: isHome ? "HOME-HERO-1" : "PAGE-HERO", href: x.quoteHref }];
  if (isHome) {
    services.slice(0, 3).forEach((s, i) => slides.push({ eyebrow: s.nav, title: s.headline || s.nav, text: s.intro.slice(0, 200), photo: x.theme.slots[`HOME-HERO-${i + 2}`] ?? pagePhoto(x, s.id), slot: `HOME-HERO-${i + 2}`, href: x.link(pathOf(s)) }));
  }
  const n = slides.length;
  const out = [`<section class="hero${isHome ? "" : " short"}"${n > 1 ? " data-hero" : ""} aria-roledescription="carousel" aria-label="${e(x.company.name)}">`, `<div class="hero-word" aria-hidden="true">${e(word)}</div><div class="slides">`];
  slides.forEach((s, i) => {
    const tag = i === 0 ? "h1" : "p";
    out.push(`<div class="slide${i === 0 ? " is-active" : ""}" role="group" aria-roledescription="slide" aria-label="${i + 1} / ${n}"${i ? ' aria-hidden="true"' : ""}>`
      + photo(x, s.photo, slotDef(x, s.slot), { cls: "pm-bg", eager: i === 0 })
      + `<div class="slide-copy"><span class="eyebrow">${e(s.eyebrow)}</span><${tag}${i ? ' class="h1"' : ""}>${e(s.title)}</${tag}>${s.text ? `<p>${e(s.text)}</p>` : ""}`
      + `<div class="btns"><a class="btn btn-light" href="${e(i === 0 ? x.quoteHref : s.href)}">${e(i === 0 ? t(x, "quote") : s.eyebrow)} ${ic("arrow-up-right")}</a>`
      + (b.phone ? `<a class="btn btn-ghost" href="tel:${e(tel(b.phone))}">${ic("phone")} ${e(b.phone)}</a>` : "") + `</div></div></div>`);
  });
  out.push("</div>");
  if (n > 1) {
    out.push(`<div class="hero-ctrl"><div class="wrap"><div class="dots">${slides.map((_, i) => `<button class="dot" type="button" aria-label="${e(t(x, "slide"))} ${i + 1}"${i === 0 ? ' aria-current="true"' : ""}><span></span></button>`).join("")}</div>`
      + `<div class="count"><b>01</b> / ${String(n).padStart(2, "0")}</div><div class="arrows"><button class="circle-btn" type="button" data-prev aria-label="${e(t(x, "prev"))}">${ic("arrow-left")}</button><button class="circle-btn" type="button" data-next aria-label="${e(t(x, "next"))}">${ic("arrow-right")}</button></div></div></div>`);
  }
  out.push(ring(x, t(x, "quote"), t(x, "getQuote"), x.quoteHref, "ring-hero"), "</section>");
  return out.join("");
}

function services(x: X) {
  const list = x.site.pages.filter((q) => q.kind === "service");
  if (!list.length) return "";
  const tiles = list.map((s) => `<div class="tile">${photo(x, pagePhoto(x, s.id) ?? x.theme.slots["SERVICE-TILE"], slotDef(x, "SERVICE-TILE"))}<a class="tile-label" href="${e(x.link(pathOf(s)))}">${e(s.nav)} ${ic("arrow-up-right")}</a></div>`).join("");
  return `<section data-rail-wrap id="services"><div class="wrap rail-sec"><div class="reveal"><h2>${e(t(x, "servicesTitle"))}</h2><p class="lead" style="font-size:.9rem">${e(t(x, "servicesSub"))}</p>
<div class="rail-ctl"><button class="circle-btn" type="button" data-rail="prev" aria-label="${e(t(x, "prev"))}">${ic("arrow-left")}</button><button class="circle-btn solid" type="button" data-rail="next" aria-label="${e(t(x, "next"))}">${ic("arrow-right")}</button></div></div>
<div class="rail reveal d1">${tiles}</div></div></section>`;
}

function intro(x: X, p: Page) {
  const about = x.site.pages.find((q) => q.kind === "about");
  const text = ((p.kind === "about" ? p.intro : about?.intro) ?? "").replace(/\[[^\]]*\]/g, "").trim();
  if (!text && !x.preview) return "";
  const ringText = [x.company.name, [x.site.business.city, x.site.business.state].filter(Boolean).join(" ")].filter(Boolean).join(" · ").toUpperCase();
  const img = (slot: string, n: number, cls = "") => photo(x, x.theme.slots[slot] ?? (about ? pagePhoto(x, about.id, n) : null), slotDef(x, slot), { cls });
  return `<section class="intro"><div class="wrap"><div class="reveal">
<div class="ring-wrap" aria-hidden="true"><svg viewBox="0 0 120 120"><defs><path id="ring-intro" d="M60,60 m-50,0 a50,50 0 1,1 100,0 a50,50 0 1,1 -100,0"/></defs><text><textPath href="#ring-intro" textLength="314" lengthAdjust="spacing">${e(`${ringText} · `)}</textPath></text></svg></div>
<h2>${e(t(x, "introTitle"))}<br><em>${e(t(x, "introTitle2"))}</em></h2></div><div class="vline" aria-hidden="true"></div>
<p class="small reveal">${e(text.slice(0, 420))}</p>
<div class="trio"><div class="reveal img-in">${img("HOME-INTRO-1", 0)}</div>
<div class="mid reveal d1 img-in">${img("HOME-INTRO-2", 1, "round")}${p.kind !== "about" && about ? `<a class="circle-btn solid" style="position:absolute;right:8%;bottom:6%;z-index:3" href="${e(x.link(pathOf(about)))}" aria-label="${e(t(x, "ourStory"))}">${ic("arrow-up-right")}</a>` : ""}</div>
<div class="reveal d2 img-in">${img("HOME-INTRO-3", 2)}</div></div></div></section>`;
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
    const btn = b.action === "call" && phone ? `<a class="btn btn-light" href="tel:${e(tel(phone))}">${ic("phone")} ${e(t(x, "call"))} ${e(phone)}</a>` : `<a class="btn btn-light" href="${e(x.quoteHref)}">${e(t(x, "getQuote"))} ${ic("arrow-up-right")}</a>`;
    return `<section><div class="wrap"><div class="cta reveal"><div>${b.heading ? `<h2>${e(b.heading)}</h2>` : ""}${b.body ? `<p style="margin:.8rem 0 0;opacity:.92">${e(b.body)}</p>` : ""}</div><div class="btns">${btn}</div></div></div></section>`;
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
  return `<section><div class="wrap"><div class="pm-cards">${list.map((s) => `<a class="pm-card reveal" href="${e(x.link(pathOf(s)))}">${photo(x, pagePhoto(x, s.id), slotDef(x, "SERVICE-TILE"))}<b>${e(s.nav)}</b><span>${e((s.intro || "").slice(0, 150))}</span></a>`).join("")}</div></div></section>`;
}

function closing(x: X) {
  const phone = x.site.business.phone;
  return `<section><div class="wrap"><div class="cta reveal"><div><span class="eyebrow">${e(t(x, "erEyebrow"))}</span><h2>${e(t(x, "ctaTitle"))}</h2><p style="margin:.8rem 0 0;opacity:.92">${e(t(x, "ctaText"))}</p></div>
<div class="btns"><a class="btn btn-light" href="${e(x.quoteHref)}">${e(t(x, "getQuote"))} ${ic("arrow-up-right")}</a>${phone ? `<a class="btn btn-ghost" href="tel:${e(tel(phone))}">${ic("phone")} ${e(phone)}</a>` : ""}</div></div></div></section>`;
}

function footer(x: X, nav: { label: string; href: string }[]) {
  const b = x.site.business;
  const c = x.company;
  const svc = x.site.pages.filter((q) => q.kind === "service");
  const social = x.site.social ?? [];
  const legal = x.theme.legal;
  const words = c.name.split(/\s+/);
  const half = Math.ceil(words.length / 2);
  return `<footer class="ftr"><div class="wrap"><div class="ftr-grid"><div><h2>${e(t(x, "footerTitle"))}</h2>${leadForm(x, "website-footer", { compact: true, cls: "ftr-form" })}</div>
<div class="ftr-cols"><div><h4>${e(t(x, "pages"))}</h4><ul>${nav.map((n) => `<li><a href="${e(n.href)}">${e(n.label)}</a></li>`).join("")}</ul></div>
${svc.length ? `<div><h4>${e(t(x, "services"))}</h4><ul>${svc.map((s) => `<li><a href="${e(x.link(pathOf(s)))}">${e(s.nav)}</a></li>`).join("")}</ul></div>` : ""}
<div><h4>${e(t(x, "contact"))}</h4><ul>${b.phone ? `<li><a href="tel:${e(tel(b.phone))}">${ic("phone")} ${e(b.phone)}</a></li>` : ""}${b.email ? `<li><a href="mailto:${e(b.email)}">${ic("mail")} ${e(b.email)}</a></li>` : ""}
${b.address || b.city ? `<li><span>${ic("house")} ${e([b.address, [b.city, b.state].filter(Boolean).join(", "), b.zip].filter(Boolean).join(" "))}</span></li>` : ""}${b.hours ? `<li><span>${ic("clock")} ${e(b.hours)}</span></li>` : ""}
${b.license ? `<li><span>${ic("shield")} ${e(t(x, "license"))} ${e(b.license)}</span></li>` : ""}${x.insuredProof ? `<li><a href="${e(x.insuredProof)}" rel="noopener">${ic("shield")} ${e(t(x, "insured"))}: ${e(t(x, "proof"))}</a></li>` : ""}</ul>
${social.length ? `<div class="pm-social">${social.map((s) => `<a href="${e(s.url)}" rel="noopener me" target="_blank">${e(s.kind[0].toUpperCase() + s.kind.slice(1))}</a>`).join("")}</div>` : ""}</div></div></div>
<div class="ftr-base"><div><span>© ${new Date().getUTCFullYear()} ${e(c.name)}. ${e(t(x, "rights"))}</span>${x.founding ? ` <span class="pm-badge">${e(t(x, "founding"))}</span>` : ""}<br>
<span class="pm-legal">${legal.privacy ? `<a href="${e(legal.privacy)}">${e(t(x, "privacy"))}</a>` : ""}${legal.terms ? `<a href="${e(legal.terms)}">${e(t(x, "terms"))}</a>` : ""}<a href="${e(x.langHref)}" lang="${e(t(x, "langCode"))}">${e(t(x, "lang"))}</a><a href="https://paintersmax.app/" rel="noopener">${e(t(x, "by"))}</a></span>${x.site.footer ? `<br><span>${e(x.site.footer)}</span>` : ""}</div>
<div class="ftr-logo">${e(words.slice(0, half).join(" "))}<br>${e(words.slice(half).join(" "))}${b.city ? `<small>${e(b.city.toUpperCase())}</small>` : ""}</div></div></div></footer>
<nav class="callbar" aria-label="${e(t(x, "contact"))}">${b.phone ? `<a class="call" href="tel:${e(tel(b.phone))}">${ic("phone")} ${e(t(x, "callNow"))}</a>` : ""}<a class="quote" href="${e(x.quoteHref)}">${ic("mail")} ${e(t(x, "quote"))}</a></nav>`;
}

export function render(x: X): string {
  const { site, page: p, company: c, cfg } = x;
  const title = p.seoTitle || `${p.headline || p.nav} | ${c.name}`;
  const desc = p.seoDesc || p.intro.replace(/\[[^\]]*\]/g, "").slice(0, 155);
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
      case "services": parts.push(p.kind === "services" ? servicesGrid(x) : services(x)); break;
      case "intro": parts.push(intro(x, p)); break;
      case "content": p.blocks.forEach((b, i) => parts.push(contentBlock(x, b, i))); break;
      case "gallery_ba": parts.push(beforeAfter(x)); break;
      case "instant_quote": parts.push(instantQuote(x)); break;
      case "color_studio": parts.push(colorStudio(x)); break;
      case "color_studio_ai": parts.push(colorStudioAi(x)); break;
      case "business_info": parts.push(businessInfo(x)); break;
      case "cities": parts.push(cities(x)); break;
      case "maps": parts.push(map(x, t(x, "mapTitle"))); break;
      case "weather": parts.push(soonOnly(x, "weather")); break;
      case "review_request": if (!hasReviewsBlock) parts.push(reviewsBlock(x, (h) => reviewsHtml(x.reviews ?? [], c.name, site.lang, h))); break;
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
  const usedIcons = new Set<string>(["arrow-up-right", "arrow-left", "arrow-right", "phone", "mail", "menu", "close", "roller", "house", "clock", "pin", "shield", "quote", "sparkle"]);
  const cfgJs = JSON.stringify({ mapsKey: x.mapsKey, mapQuery: [site.business.city, site.business.state].filter(Boolean).join(", "), lang: x.uiLang }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="${x.uiLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title><meta name="description" content="${e(desc)}"><link rel="canonical" href="${e(canonical)}">
${x.preview ? '<meta name="robots" content="noindex">' : ""}${p.kind === "home" && site.gscToken ? `<meta name="google-site-verification" content="${e(site.gscToken)}">` : ""}
<link rel="alternate" hreflang="${e(t(x, "langCode"))}" href="${e(x.langHref)}">
<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${e(canonical)}">${ogPhoto ? `<meta property="og:image" content="${e(x.origin.replace(/\/$/, "") + x.photoSrc(ogPhoto))}">` : ""}
<meta name="theme-color" content="${e(x.theme.tokens["c-brand"] ?? cfg.tokens.find((k) => k.key === "c-brand")?.default ?? "#2a1a10")}">
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

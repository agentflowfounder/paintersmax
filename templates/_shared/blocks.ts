import { escapeHtml as e } from "../../src/settings.ts";
import { blockCardText, blockState, visibleToVisitors, type BlockKey } from "../../src/siteblocks.ts";
import type { ImageSlotDef, Lang } from "../../src/sitetheme.ts";
import type { ThemeRenderCtx } from "./ctx.ts";

/**
 * Platform blocks drawn the same way in every template. They take their look from the template's color tokens
 * (--c-*), fonts (--f-*) and radius (--r-*), and from /templates/_platform/<v>/blocks.css.
 */

export const tel = (p: string) => p.replace(/[^0-9+]/g, "");
export const ic = (name: string, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const t = (x: ThemeRenderCtx, key: string) => x.theme.texts[`${x.uiLang}:${key}`] ?? x.cfg.i18n[x.uiLang][key] ?? x.cfg.i18n.en[key] ?? key;

/** Whether a block shows, and the painter-only card when it does not. Visitors never see the card. */
export function gate(x: ThemeRenderCtx, key: BlockKey): { show: boolean; card: string } {
  const s = blockState(key, x.door, x.balance);
  if (visibleToVisitors(s)) return { show: true, card: "" };
  if (!x.preview) return { show: false, card: "" };
  const c = blockCardText(key, s, x.uiLang);
  if (!c) return { show: false, card: "" };
  return {
    show: false,
    card: `<section class="pm-gate-sec"><div class="wrap"><div class="pm-gate" data-state="${s.state}"><span class="pm-gate-tag">${e(x.uiLang === "es" ? "Solo usted ve esto" : "Only you see this")}</span><h3>${e(c.title)}</h3><p>${e(c.body)}</p>${c.action ? `<a class="btn btn-dark" href="${e(c.href)}" target="_top">${e(c.action)}</a>` : ""}</div></div></section>`,
  };
}

/** The crop centre the painter chose for a photo space, as an inline style (empty when centred). */
const focusStyle = (x: ThemeRenderCtx, slot: ImageSlotDef | undefined) => {
  const f = slot ? x.theme.focus?.[slot.slot] : undefined;
  return f ? ` style="object-position:${f.x}% ${f.y}%"` : "";
};

/** A photo from the site, or a labeled placeholder. Painters see the slot name, size and AI prompt; visitors see a soft color field. */
export function photo(x: ThemeRenderCtx, id: string | null | undefined, slot: ImageSlotDef | undefined, o: { cls?: string; eager?: boolean; sizes?: string } = {}): string {
  const p = id ? x.site.photos.find((q) => q.id === id) : undefined;
  if (p) {
    return `<img class="${o.cls ?? ""}" src="${e(x.photoSrc(p.id))}" alt="${e(p.alt || `${x.company.name} painting project`)}"${focusStyle(x, slot)}${p.w && p.h ? ` width="${p.w}" height="${p.h}"` : ""}${o.eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"${o.sizes ? ` sizes="${e(o.sizes)}"` : ""}>`;
  }
  const alt = slot ? slot.alt[x.uiLang] : "";
  const dflt = slot ? x.defaults?.[slot.slot] : undefined;
  if (dflt && slot) {
    return `<img class="${o.cls ?? ""}" src="${e(dflt)}" alt="${e(alt)}"${focusStyle(x, slot)} width="${slot.w}" height="${slot.h}"${o.eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" data-template-photo="${e(slot.slot)}">`;
  }
  if (!x.preview || !slot) return `<div class="pm-ph ${o.cls ?? ""}" role="img" aria-label="${e(alt || t(x, "photoSoon"))}"></div>`;
  const ai = x.cfg.imageProvider;
  return `<div class="pm-ph pm-ph-label ${o.cls ?? ""}" role="img" aria-label="${e(`Photo space ${slot.slot}: ${alt}`)}" data-slot="${e(slot.slot)}">`
    + `<span class="pm-ph-tag"><b>${e(slot.slot)}</b><i>${slot.w} × ${slot.h}</i><i>${e(slot.ratio)}</i><i>WebP</i></span>`
    + `<span class="pm-ph-alt">${e(alt)}</span>`
    + `<span class="pm-ph-ai"><button type="button" disabled title="${e(x.uiLang === "es" ? "Muy pronto: use créditos de IA para crear esta foto" : "Coming soon: use AI credits to make this photo")}" data-image-ai="${e(ai.endpoint)}">${ic("sparkle")} ${e(x.uiLang === "es" ? "Crear con IA" : "Create with AI")}</button><small>${e(x.uiLang === "es" ? "Suba su propia foto en el editor" : "Add your own photo in the editor")}</small></span></div>`;
}

export const slotDef = (x: ThemeRenderCtx, slot: string) => x.cfg.imageSlots.find((s) => s.slot === slot);

/** The first photo the painter put on a page (photos blocks), if any. */
export function pagePhoto(x: ThemeRenderCtx, pageId: string, n = 0): string | null {
  const pg = x.site.pages.find((p) => p.id === pageId);
  const ids = (pg?.blocks ?? []).flatMap((b) => (b.type === "photos" ? b.photos : []));
  return ids[n] ?? null;
}

export function sectionHead(eyebrow: string, title: string, sub = "", cls = "") {
  return `<div class="sec-head ${cls}"><span class="eyebrow">${e(eyebrow)}</span><h2>${e(title)}</h2>${sub ? `<p class="lead">${e(sub)}</p>` : ""}</div>`;
}

// ------------------------------------------------------------------ instant quote

export function instantQuote(x: ThemeRenderCtx): string {
  const g = gate(x, "instant_quote");
  if (!g.show) return g.card;
  return `<section class="band pm-iq" id="quote"><div class="wrap"><div class="split top"><div>${sectionHead(t(x, "iqEyebrow"), t(x, "iqTitle"), t(x, "iqText"))}</div>
<div><details class="pm-iq-box"><summary class="btn btn-dark">${e(t(x, "iqOpen"))} ${ic("arrow-up-right")}</summary>
<iframe title="${e(t(x, "iqTitle"))}" loading="lazy" data-src="${e(x.quoteHref)}" width="100%" height="760"></iframe></details>
${x.site.business.phone ? `<p class="pm-iq-call"><a href="tel:${e(tel(x.site.business.phone))}">${ic("phone")} ${e(x.site.business.phone)}</a></p>` : ""}</div></div></div></section>`;
}

// ------------------------------------------------------------------ Color Studio (sample room, no AI)

/** Generic paint-like colors (our own names, not any brand's). */
export const STUDIO_COLORS: { hex: string; en: string; es: string }[] = [
  { hex: "#efe6d6", en: "Warm linen", es: "Lino cálido" }, { hex: "#e4dccd", en: "Soft greige", es: "Greige suave" },
  { hex: "#d9c7a7", en: "Wheat", es: "Trigo" }, { hex: "#c9a27e", en: "Clay", es: "Arcilla" },
  { hex: "#b7c4b0", en: "Sage", es: "Salvia" }, { hex: "#7f8f78", en: "Olive leaf", es: "Hoja de olivo" },
  { hex: "#9fb3c2", en: "Harbor blue", es: "Azul puerto" }, { hex: "#3f5566", en: "Deep slate", es: "Pizarra" },
  { hex: "#c98b6b", en: "Terracotta", es: "Terracota" }, { hex: "#8a5a44", en: "Saddle", es: "Cuero" },
  { hex: "#f4f1ea", en: "Clean white", es: "Blanco limpio" }, { hex: "#2f2a26", en: "Charcoal", es: "Carbón" },
];

export function colorStudio(x: ThemeRenderCtx): string {
  const g = gate(x, "color_studio");
  if (!g.show) return g.card;
  const L: Lang = x.uiLang;
  const first = STUDIO_COLORS[0];
  return `<section class="pm-cs" id="color-studio"><div class="wrap"><div class="split top"><div>${sectionHead(t(x, "csEyebrow"), t(x, "csTitle"), t(x, "csText"))}
<div class="pm-sw" role="radiogroup" aria-label="${e(t(x, "csEyebrow"))}">${STUDIO_COLORS.map((c, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-hex="${c.hex}" style="--sw:${c.hex}"><span></span>${e(c[L])}</button>`).join("")}</div>
<p class="pm-cs-note">${e(t(x, "csNote"))}</p></div>
<figure class="pm-room" style="--wall:${first.hex}" aria-label="${e(t(x, "csTitle"))}"><svg viewBox="0 0 640 420" role="img" aria-hidden="true">
<rect class="wall" x="0" y="0" width="640" height="300"/><rect class="wall2" x="460" y="0" width="180" height="300"/>
<rect x="0" y="300" width="640" height="120" fill="#b08a62"/><rect x="0" y="292" width="640" height="10" fill="#f4efe6"/>
<rect x="90" y="60" width="150" height="120" rx="4" fill="#f4efe6"/><rect x="100" y="70" width="130" height="100" fill="#cfdde6"/><path d="M165 70v100M100 120h130" stroke="#f4efe6" stroke-width="5"/>
<rect x="250" y="210" width="220" height="70" rx="18" fill="#efe9df"/><rect x="262" y="180" width="196" height="48" rx="16" fill="#e6dfd3"/><rect x="262" y="272" width="10" height="26" fill="#5b4636"/><rect x="448" y="272" width="10" height="26" fill="#5b4636"/>
<circle cx="540" cy="150" r="34" fill="#f4efe6" opacity=".9"/><rect x="532" y="186" width="16" height="104" fill="#5b4636"/><ellipse cx="540" cy="292" rx="40" ry="8" fill="#5b4636" opacity=".5"/>
<path d="M300 120h120v60H300z" fill="#f4efe6"/><path d="M308 128h104v44H308z" fill="#c8b59d"/></svg>
<figcaption><span data-cs-name>${e(first[L])}</span> <code data-cs-hex>${first.hex}</code></figcaption></figure></div></div></section>`;
}

export function colorStudioAi(x: ThemeRenderCtx): string {
  const g = gate(x, "color_studio_ai");
  // Not built yet, so only the painter sees a "coming soon" or upgrade card.
  return g.show ? "" : g.card;
}

// ------------------------------------------------------------------ before and after

/** One draggable before and after slider. */
export function baFigure(x: ThemeRenderCtx, before: string | null, after: string | null, caption: string): string {
  return `<figure class="pm-ba reveal" style="--pos:50%"><div class="pm-ba-frame">
<div class="pm-ba-after">${photo(x, after, slotDef(x, "BA-AFTER"))}</div>
<div class="pm-ba-before">${photo(x, before, slotDef(x, "BA-BEFORE"))}</div>
<span class="pm-ba-line" aria-hidden="true"><span>${ic("arrow-left")}${ic("arrow-right")}</span></span>
<span class="pm-ba-tag b">${e(t(x, "before"))}</span><span class="pm-ba-tag a">${e(t(x, "after"))}</span>
<input type="range" min="0" max="100" value="50" aria-label="${e(`${t(x, "before")} / ${t(x, "after")}`)}"></div>${caption ? `<figcaption>${e(caption)}</figcaption>` : ""}</figure>`;
}

export function beforeAfter(x: ThemeRenderCtx): string {
  const g = gate(x, "gallery_ba");
  if (!g.show) return g.card;
  const pairs = x.theme.pairs;
  if (!pairs.length && !x.preview) return "";
  const one = (b: string | null, a: string | null, cap: string, _i: number) => baFigure(x, b, a, cap);
  const list = pairs.length ? pairs.slice(0, 6).map((p, i) => one(p.before, p.after, p.caption, i)) : [one(null, null, "", 0)];
  return `<section id="before-after"><div class="wrap">${sectionHead(t(x, "baEyebrow"), t(x, "baTitle"), t(x, "baHint"))}<div class="pm-ba-grid">${list.join("")}</div></div></section>`;
}

// ------------------------------------------------------------------ business info, cities, map

export function businessInfo(x: ThemeRenderCtx): string {
  const g = gate(x, "business_info");
  if (!g.show) return g.card;
  const b = x.site.business;
  const card = (icon: string, label: string, value: string, href = "") =>
    value ? `<${href ? `a href="${e(href)}"` : "div"} class="ccard"><span class="ic-box">${ic(icon)}</span><span><small>${e(label)}</small>${e(value)}</span></${href ? "a" : "div"}>` : "";
  const addr = [b.address, [b.city, b.state].filter(Boolean).join(", "), b.zip].filter(Boolean).join(" ");
  const social = (x.site as any).social as { kind: string; url: string }[] | undefined;
  return `<section id="business"><div class="wrap"><div class="split top"><div>${sectionHead(t(x, "contact"), t(x, "bizTitle"))}</div><div class="contact-cards">
${card("phone", t(x, "phone"), b.phone, b.phone ? `tel:${tel(b.phone)}` : "")}${card("mail", t(x, "email"), b.email, b.email ? `mailto:${b.email}` : "")}
${card("house", t(x, "address"), addr)}${card("clock", t(x, "hours"), b.hours)}${card("pin", t(x, "area"), b.serviceArea)}${card("shield", t(x, "license"), b.license)}
${social?.length ? `<div class="pm-social"><small>${e(t(x, "follow"))}</small>${social.map((s) => `<a href="${e(s.url)}" rel="noopener me" target="_blank">${e(s.kind[0].toUpperCase() + s.kind.slice(1))}</a>`).join("")}</div>` : ""}
</div></div></div></section>`;
}

/** Cities from the painter's published city pages, then the service area text. */
export function cityList(x: ThemeRenderCtx): { name: string; href: string }[] {
  const out = x.cityPages.map((c) => ({ name: `${c.name}, ${c.state}`, href: c.href }));
  for (const a of x.site.business.serviceArea.split(/[;\n]|,\s*(?=[A-Z][a-z])/).map((s) => s.trim()).filter((s) => s.length > 1)) {
    if (!out.some((o) => o.name.toLowerCase().startsWith(a.toLowerCase().split(",")[0]))) out.push({ name: a, href: "" });
  }
  return out.slice(0, 30);
}

export function cities(x: ThemeRenderCtx): string {
  const g = gate(x, "cities");
  if (!g.show) return g.card;
  const list = cityList(x);
  if (!list.length) return "";
  const mapLink = (n: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n)}`;
  return `<section class="band pm-cities" id="cities"><div class="wrap">${sectionHead(t(x, "citiesEyebrow"), t(x, "citiesTitle"))}
<div class="pm-city-grid">${list.map((c) => `<a class="pm-city reveal" href="${e(c.href || mapLink(c.name))}"${c.href ? "" : ' target="_blank" rel="noopener"'}>${ic("pin")}<span>${e(c.name)}</span>${ic("arrow-up-right")}</a>`).join("")}</div></div></section>`;
}

export function mapQuery(x: ThemeRenderCtx): string {
  const b = x.site.business;
  return [b.address, b.city, b.state].filter(Boolean).join(", ") || cityList(x)[0]?.name || "";
}

export function map(x: ThemeRenderCtx, title: string): string {
  const g = gate(x, "maps");
  if (!g.show) return g.card;
  const q = mapQuery(x);
  if (!q) return "";
  const b = x.site.business;
  const pins = [[30, 38, ""], [52, 52, "main"], [68, 30, ""], [78, 66, ""], [20, 70, ""], [45, 24, ""], [62, 78, ""]] as const;
  const chips = cityList(x).slice(0, 12).map((c) => `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.name)}" target="_blank" rel="noopener" data-q="${e(c.name)}">${ic("pin")} ${e(c.name)}</a>`).join("");
  return `<section id="map"><div class="wrap"><div class="map-sec"><div class="reveal"><span class="eyebrow">${e(t(x, "citiesEyebrow"))}</span><h2>${e(title)}</h2>
${chips ? `<div class="city-chips">${chips}</div>` : ""}
<div class="addr">${b.address || b.city ? `<span>${ic("house")} ${e([b.address, [b.city, b.state].filter(Boolean).join(", ")].filter(Boolean).join(", "))}</span>` : ""}${b.phone ? `<a href="tel:${e(tel(b.phone))}">${ic("phone")} ${e(b.phone)}</a>` : ""}${b.hours ? `<span>${ic("clock")} ${e(b.hours)}</span>` : ""}</div>
<p style="margin-top:1.2rem"><a class="btn btn-dark" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}" target="_blank" rel="noopener">${e(t(x, "directions"))} ${ic("arrow-up-right")}</a></p></div>
<div class="map-box reveal d1" data-map data-query="${e(q)}"><div class="map-fallback" role="img" aria-label="${e(`${t(x, "mapNote")}: ${q}`)}"><div class="river"></div>${pins.map(([l, tp, c]) => `<span class="pin ${c}" style="left:${l}%;top:${tp}%">${ic("pin")}</span>`).join("")}</div>
<div class="map-note"><span>${e(q)}</span><a class="btn btn-dark" style="min-height:38px;padding:.6em 1.1em" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}" target="_blank" rel="noopener">${e(t(x, "openMaps"))}</a></div></div>
</div></div></section>`;
}

// ------------------------------------------------------------------ forms (leads go to the painter's inbox)

export function leadForm(x: ThemeRenderCtx, source: string, o: { compact?: boolean; cls?: string } = {}): string {
  const f = (name: string, label: string, type = "text", ac = "", req = false) => `<label>${e(label)}<input name="${name}" type="${type}"${ac ? ` autocomplete="${ac}"` : ""}${req ? " required" : ""}></label>`;
  return `<form class="pm-form ${o.cls ?? ""}" data-lead data-source="${e(source)}" data-company="${e(x.company.slug)}" data-endpoint="${e(x.leadEndpoint)}"${x.preview ? " data-preview" : ""} novalidate>
<div class="row two">${f("first", t(x, "firstName"), "text", "given-name", true)}${f("last", t(x, "lastName"), "text", "family-name")}</div>
<div class="row two">${f("email", t(x, "emailField"), "email", "email", true)}${f("phone", t(x, "phoneField"), "tel", "tel")}</div>
${o.compact ? "" : `<div class="row two">${f("zip", t(x, "zip"), "text", "postal-code")}<span></span></div><label>${e(t(x, "details"))}<textarea name="details" rows="3" maxlength="1500"></textarea></label>`}
<input class="pm-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<label class="consent"><input type="checkbox" name="consent" required> ${e(t(x, "consent"))}</label>
<button class="btn btn-dark" type="submit">${e(t(x, "submit"))} ${ic("arrow-up-right")}</button>
<p class="pm-form-msg" role="status" tabindex="-1" data-ok="${e(t(x, "sent"))}" data-err="${e(t(x, "formErr"))}"></p></form>`;
}

export function estimateRequest(x: ThemeRenderCtx): string {
  const g = gate(x, "estimate_request");
  if (!g.show) return g.card;
  return `<section class="band" id="estimate"><div class="wrap"><div class="split top"><div>${sectionHead(t(x, "erEyebrow"), t(x, "erTitle"))}</div>${leadForm(x, "website-estimate")}</div></div></section>`;
}

export function chatHelper(x: ThemeRenderCtx): string {
  const g = gate(x, "chat_helper");
  if (!g.show) return g.card;
  return `<section class="pm-chat-sec"><div class="wrap"><div class="pm-chat"><div><span class="eyebrow">${ic("quote")} ${e(t(x, "chatTitle"))}</span><p>${e(t(x, "chatText"))}</p></div>
<form class="pm-form pm-chat-form" data-lead data-source="website-question" data-company="${e(x.company.slug)}" data-endpoint="${e(x.leadEndpoint)}"${x.preview ? " data-preview" : ""} novalidate>
<label class="pm-sr" for="chat-q">${e(t(x, "chatPlaceholder"))}</label><textarea id="chat-q" name="details" rows="2" maxlength="1500" placeholder="${e(t(x, "chatPlaceholder"))}" required></textarea>
<div class="row two"><label>${e(t(x, "firstName"))}<input name="first" autocomplete="given-name" required></label><label>${e(t(x, "emailField"))}<input name="email" type="email" autocomplete="email" required></label></div>
<input class="pm-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><input type="hidden" name="consent" value="on">
<button class="btn btn-dark" type="submit">${e(t(x, "chatSend"))} ${ic("arrow-up-right")}</button><p class="pm-form-msg" role="status" tabindex="-1" data-ok="${e(t(x, "sent"))}" data-err="${e(t(x, "formErr"))}"></p></form></div></div></section>`;
}

export function reviewsBlock(x: ThemeRenderCtx, reviewsHtml: (heading: string) => string): string {
  const g = gate(x, "review_request");
  if (!g.show) return g.card;
  const list = x.reviews ?? [];
  const gbp = x.site.business.gbpUrl;
  if (!list.length && !gbp && !x.preview) return "";
  return `<section class="band pm-reviews" id="reviews"><div class="wrap">${sectionHead(t(x, "reviewsEyebrow"), t(x, "reviewsTitle"))}${list.length ? reviewsHtml("") : ""}
<p class="pm-rev-ask">${e(t(x, "reviewsAsk"))}</p>${gbp ? `<p><a class="btn btn-dark" href="${e(gbp)}" target="_blank" rel="noopener">${e(t(x, "reviewsGoogle"))} ${ic("arrow-up-right")}</a></p>` : ""}</div></section>`;
}

/** Gated-only blocks (not built yet): the painter sees a card, visitors see nothing. */
export const soonOnly = (x: ThemeRenderCtx, key: BlockKey) => {
  const g = gate(x, key);
  return g.show ? "" : g.card;
};

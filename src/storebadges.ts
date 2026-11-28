import { escapeHtml as e } from "./settings.ts";

/**
 * Store badges on painters' websites (our own animated badges from /pm-badges.css, never store logos).
 *
 * Two ways a painter uses them, both safe because nothing the painter types is ever HTML:
 *  - In any text box: the token [store:home-depot] (or [store:Home Depot]) becomes the Home Depot badge.
 *    A name we have no badge for, like [store:Joe's Paint Supply], becomes the generic badge with that name.
 *  - The "Where I buy" section: a strip of the stores the painter picked.
 */

export interface StoreDef { slug: string; kind: string; name: string }
/** `kind` is the Vendors page key (src/vendors.ts KINDS); `slug` is the CSS class suffix. */
export const STORES: StoreDef[] = [
  { slug: "sherwin-williams", kind: "sherwin_williams", name: "Sherwin-Williams" },
  { slug: "home-depot", kind: "home_depot", name: "Home Depot" },
  { slug: "lowes", kind: "lowes", name: "Lowe's" },
  { slug: "benjamin-moore", kind: "benjamin_moore", name: "Benjamin Moore" },
  { slug: "ppg", kind: "ppg", name: "PPG" },
  { slug: "kelly-moore", kind: "kelly_moore", name: "Kelly-Moore" },
  { slug: "dunn-edwards", kind: "dunn_edwards", name: "Dunn-Edwards" },
  { slug: "valspar", kind: "valspar", name: "Valspar" },
  { slug: "behr", kind: "behr", name: "Behr" },
];
export const STORE_CAP = 12;
export const STORE_NAME_MAX = 40;

const norm = (s: string) => s.toLowerCase().replace(/&#39;|&amp;/g, "").replace(/[^a-z0-9]/g, "");
const BY_NORM = new Map<string, StoreDef>();
for (const s of STORES) { BY_NORM.set(norm(s.slug), s); BY_NORM.set(norm(s.name), s); }

/** The store a painter typed or picked, when we have a badge for it. */
export const findStore = (text: string): StoreDef | undefined => BY_NORM.get(norm(text));

/** One badge. `name` is raw text (escaped here). */
export function badgeHtml(name: string): string {
  const st = findStore(name);
  return `<span class="pmv pmv-${st ? st.slug : "other"}">${e(st ? st.name : name)}</span>`;
}

/** Turns [store:...] tokens in already-escaped text into badges. Captured text is already escaped, so it goes in as is. */
export function withBadges(escaped: string): string {
  return escaped.replace(/\[store:([^\]\n]{1,60})\]/gi, (_m, raw: string) => {
    const st = findStore(raw);
    if (st) return `<span class="pmv pmv-${st.slug}">${e(st.name)}</span>`;
    const name = raw.trim().slice(0, STORE_NAME_MAX);
    return name ? `<span class="pmv pmv-other">${name}</span>` : "";
  });
}

const L = {
  en: { head: "Where we buy our paint", note: "Store names are shown only to say where we shop. These stores do not sponsor or endorse us." },
  es: { head: "Dónde compramos nuestra pintura", note: "Los nombres de las tiendas solo indican dónde compramos. Estas tiendas no nos patrocinan ni nos respaldan." },
};

/** The "Where I buy" strip. Empty when no store was picked. */
export function storesStripHtml(stores: string[], heading: string, lang: "en" | "es"): string {
  const list = stores.filter((s) => s.trim()).slice(0, STORE_CAP);
  if (!list.length) return "";
  const t = L[lang];
  return `<div class="pm-stores"><h2>${e(heading || t.head)}</h2><div class="pm-stores-row">${list.map(badgeHtml).join("")}</div><p class="pm-stores-note">${e(t.note)}</p></div>`;
}

/** Does this site show any badge? Then its pages load /pm-badges.css. */
export function siteUsesBadges(pages: { blocks: { type: string }[] }[], extraText = ""): boolean {
  if (/\[store:/i.test(extraText)) return true;
  return pages.some((p) => p.blocks.some((b: any) => b.type === "stores" || /\[store:/i.test(String(b.body ?? "")) || (Array.isArray(b.tabs) && b.tabs.some((t: any) => /\[store:/i.test(String(t.body ?? ""))))));
}

export const BADGES_LINK = `<link rel="stylesheet" href="/pm-badges.css">`;

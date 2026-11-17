/**
 * Website templates: the shapes every template shares, and the cleaning of a painter's theme choices.
 *
 * A template is a theme inside the page editor. The painter's words, pages and photos live in the Site document
 * and never depend on the template, so switching templates never loses content. What the painter changes about
 * the look (colors, fonts, which sections show and in what order, menu, logo, photos in the template's photo
 * spaces) is kept per template in `site.themes[templateId]`, so switching back brings those choices back too.
 *
 * No database or network code here (easy to test).
 */

export type Door = "free" | "launch" | "grow" | "signature";
export type PageKind = "home" | "services" | "gallery" | "about" | "contact" | "service" | "custom";
export type Lang = "en" | "es";
export type Txt = { en: string; es: string };

/** free: every door, one page with tabs on Free. basic: Launch and up. standard: Grow and up. premium: Signature. Free may preview every template but publishes only the free ones. */
export type TemplateClass = "free" | "basic" | "standard" | "premium";
export const CLASS_DOORS: Record<TemplateClass, Door[]> = {
  free: ["free", "launch", "grow", "signature"],
  basic: ["launch", "grow", "signature"],
  standard: ["grow", "signature"],
  premium: ["signature"],
};

/** What kind of control the editor shows for a field the painter may change. */
export type EditType = "color" | "font" | "image" | "text" | "toggle" | "order" | "menu" | "logo";

export interface TokenDef { key: string; label: Txt; type: "color"; default: string; editable: true }
export interface FontDef { key: "display" | "body"; label: Txt; default: string; editable: true }

/** A section a template can draw. Platform blocks (quote, Color Studio...) are sections whose key is a block key. */
export interface SectionDef {
  key: string;
  label: Txt;
  pages: PageKind[];
  enabled: boolean;
  order: number;
  /** Required sections can move but never turn off (the painter's own page content, the quote). */
  required?: boolean;
  editableFields: EditType[];
}

export interface ImageSlotDef {
  slot: string;
  section: string;
  w: number;
  h: number;
  ratio: string;
  alt: Txt;
  /** The prompt for an AI-made placeholder (the in-house image tool will use it; nothing calls it yet). */
  prompt: string;
  /** Four scene prompts for the same space (the first is `prompt`). The editor rotates through them. */
  prompts?: string[];
}

/** Where AI images will come from. Rogelio's in-house fal.ai tool plugs in here when it is built. */
export interface ImageProvider {
  kind: "none" | "inhouse";
  endpoint: string; // "/api/site/image-ai"
  ready: boolean; // false until the tool exists; the editor shows the button disabled
  creditFeature: string | null; // the AI-credit feature it will charge, once priced
}

export interface TemplateConfig {
  /** Shape of this config file. Bump when fields are added; old configs still load. */
  configVersion: 1;
  id: string;
  name: string;
  version: string; // semver of this template's look; assets live under /templates/<id>/<version>/
  class: TemplateClass;
  description: Txt;
  inspiration: string;
  license: string;
  legacy?: boolean; // the first two looks, drawn by siterender.ts
  tokens: TokenDef[];
  fonts: FontDef[];
  pages: PageKind[];
  sections: SectionDef[];
  /** Platform blocks this template draws (see siteblocks.ts). */
  blocks: string[];
  i18n: { en: Record<string, string>; es: Record<string, string> };
  imageSlots: ImageSlotDef[];
  imageProvider: ImageProvider;
  seo: { schemaType: "HousePainter"; ogImageSlot: string | null };
  /** Placeholder contact info used only in the template's own sample preview. */
  contact: { name: string; phone: string; email: string; address: string; city: string; state: string; hours: string };
  mapsMode: "worker-key" | "drawn-only";
  /** Set for an uploaded template pack: the built-in layout it re-skins, and its colors for the classic and bold layouts. */
  pack?: { base: string; palette: { dark?: string; bg?: string; accent?: string } };
}

/** Fonts a painter may pick: Google Fonts families we have checked look right and load fast. */
export const FONT_CHOICES: { family: string; kind: "serif" | "sans"; weights: string }[] = [
  { family: "Instrument Serif", kind: "serif", weights: "ital@0;1" },
  { family: "Marcellus", kind: "serif", weights: "" },
  { family: "Cormorant Garamond", kind: "serif", weights: "wght@400;500;600" },
  { family: "Newsreader", kind: "serif", weights: "wght@400;500;600" },
  { family: "Playfair Display", kind: "serif", weights: "wght@400;600" },
  { family: "Lora", kind: "serif", weights: "wght@400;600" },
  { family: "Inter", kind: "sans", weights: "wght@400;500;600;700" },
  { family: "DM Sans", kind: "sans", weights: "wght@400;500;700" },
  { family: "Manrope", kind: "sans", weights: "wght@400;500;700" },
  { family: "Work Sans", kind: "sans", weights: "wght@400;500;600" },
  { family: "Jost", kind: "sans", weights: "wght@400;500;600" },
];
export const isFont = (f: unknown): f is string => typeof f === "string" && FONT_CHOICES.some((x) => x.family === f);

/** One Google Fonts stylesheet address for the fonts a page uses. */
export function fontsHref(families: string[]): string {
  const fams = Array.from(new Set(families)).map((f) => FONT_CHOICES.find((x) => x.family === f)).filter((x): x is (typeof FONT_CHOICES)[number] => !!x);
  if (!fams.length) return "";
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f.family.replace(/ /g, "+")}${f.weights ? `:${f.weights}` : ""}`).join("&")}&display=swap`;
}

// ------------------------------------------------------------------ the painter's choices for one template

export interface ThemeSection { key: string; on: boolean; order: number }
export interface MenuItem { label: string; path: string }
/** One before and after pair. service, city, year and size are optional details shown by templates that have a project row (Sunset Sand). */
export interface BeforeAfter { before: string; after: string; caption: string; service: string; city: string; year: string; size: string }

export interface Theme {
  tokens: Record<string, string>; // token key -> #rrggbb (only the ones changed from the template default)
  fonts: { display?: string; body?: string };
  sections: ThemeSection[]; // only sections the painter changed
  menu: MenuItem[]; // empty: the menu follows the pages
  logo: string; // a photo id from site.photos, or ""
  slots: Record<string, string>; // image slot -> photo id
  pairs: BeforeAfter[]; // before and after photo pairs for the gallery block
  legal: { privacy: string; terms: string }; // the painter's own policy pages (we never write legal text)
  texts: Record<string, string>; // "<lang>:<i18n key>" -> the painter's wording for a template phrase
  /** Where each photo space is cropped: the centre of the visible part, in percent (50,50 is the middle). */
  focus: Record<string, { x: number; y: number }>;
  /** Counts template picks; the editor uses it to rotate the AI prompt examples. */
  pv: number;
  heroWord: string; // the big soft word in the hero (templates that have one)
}

export const emptyTheme = (): Theme => ({ tokens: {}, fonts: {}, sections: [], menu: [], logo: "", slots: {}, pairs: [], legal: { privacy: "", terms: "" }, texts: {}, focus: {}, pv: 0, heroWord: "" });

export const SOCIAL_KINDS = ["facebook", "instagram", "google", "yelp", "nextdoor", "youtube", "tiktok", "linkedin", "x"] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];
export interface SocialLink { kind: SocialKind; url: string }

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, n) : "");
const HEX = /^#[0-9a-f]{6}$/i;
const httpsUrl = (v: unknown) => {
  const s = str(v, 300);
  return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : "";
};

/**
 * Keeps only values the template allows: colors are #rrggbb for the template's own tokens, fonts from the list,
 * sections the template knows, photos the site owns. Unknown keys are dropped, so a bad save cannot break a page.
 */
export function cleanTheme(raw: any, cfg: TemplateConfig | null, photoIds: Set<string>): Theme {
  const t = emptyTheme();
  if (!raw || typeof raw !== "object") return t;
  const tokenKeys = new Set(cfg?.tokens.map((x) => x.key) ?? []);
  for (const [k, v] of Object.entries(raw.tokens ?? {})) if (tokenKeys.has(k) && typeof v === "string" && HEX.test(v)) t.tokens[k] = v.toLowerCase();
  if (isFont(raw.fonts?.display)) t.fonts.display = raw.fonts.display;
  if (isFont(raw.fonts?.body)) t.fonts.body = raw.fonts.body;
  const secDefs = new Map((cfg?.sections ?? []).map((s) => [s.key, s]));
  const seen = new Set<string>();
  for (const s of Array.isArray(raw.sections) ? raw.sections.slice(0, 60) : []) {
    const key = str(s?.key, 40);
    const def = secDefs.get(key);
    if (!def || seen.has(key)) continue;
    seen.add(key);
    const order = Number(s?.order);
    t.sections.push({ key, on: def.required ? true : s?.on !== false, order: Number.isFinite(order) ? Math.max(0, Math.min(999, Math.round(order))) : def.order });
  }
  for (const m of Array.isArray(raw.menu) ? raw.menu.slice(0, 10) : []) {
    const label = str(m?.label, 30);
    const path = str(m?.path, 120);
    // Pages of this site ("/about"), a phone link, or an https link. Nothing else (no javascript: links).
    if (label && (/^\/[a-z0-9/_-]*$/i.test(path) || /^tel:\+?[0-9]{7,15}$/.test(path) || /^https:\/\/[^\s"'<>]+$/.test(path))) t.menu.push({ label, path });
  }
  if (typeof raw.logo === "string" && photoIds.has(raw.logo)) t.logo = raw.logo;
  const slotKeys = new Set(cfg?.imageSlots.map((s) => s.slot) ?? []);
  for (const [k, v] of Object.entries(raw.slots ?? {})) if (slotKeys.has(k) && typeof v === "string" && photoIds.has(v)) t.slots[k] = v;
  for (const [k, v] of Object.entries(raw.focus ?? {})) {
    const x = Number((v as any)?.x), y = Number((v as any)?.y);
    if (slotKeys.has(k) && Number.isFinite(x) && Number.isFinite(y)) {
      const fx = Math.max(0, Math.min(100, Math.round(x))), fy = Math.max(0, Math.min(100, Math.round(y)));
      if (fx !== 50 || fy !== 50) t.focus[k] = { x: fx, y: fy };
    }
  }
  for (const p of Array.isArray(raw.pairs) ? raw.pairs.slice(0, 24) : []) {
    if (typeof p?.before === "string" && typeof p?.after === "string" && photoIds.has(p.before) && photoIds.has(p.after) && p.before !== p.after) {
      t.pairs.push({ before: p.before, after: p.after, caption: str(p?.caption, 120), service: str(p?.service, 40), city: str(p?.city, 40), year: /^\d{4}$/.test(str(p?.year, 4)) ? str(p.year, 4) : "", size: str(p?.size, 30) });
    }
  }
  t.legal = { privacy: httpsUrl(raw.legal?.privacy) || (/^\/info\/[a-z0-9-]{1,60}$/.test(str(raw.legal?.privacy, 80)) ? str(raw.legal.privacy, 80) : ""), terms: httpsUrl(raw.legal?.terms) || (/^\/info\/[a-z0-9-]{1,60}$/.test(str(raw.legal?.terms, 80)) ? str(raw.legal.terms, 80) : "") };
  const keys = cfg ? new Set(Object.keys(cfg.i18n.en)) : new Set<string>();
  for (const [k, v] of Object.entries(raw.texts ?? {}).slice(0, 80)) {
    const m = /^(en|es):([A-Za-z0-9]{1,30})$/.exec(k);
    const val = str(v, 200);
    if (m && keys.has(m[2]) && val) t.texts[k] = val;
  }
  t.pv = Number.isInteger(raw.pv) ? Math.max(0, Math.min(9999, raw.pv)) : 0;
  t.heroWord = str(raw.heroWord, 12).replace(/[^\p{L}\p{N} &'-]/gu, "");
  return t;
}

export function cleanSocial(raw: unknown): SocialLink[] {
  const out: SocialLink[] = [];
  for (const s of Array.isArray(raw) ? raw.slice(0, 12) : []) {
    const kind = (SOCIAL_KINDS as readonly string[]).includes((s as any)?.kind) ? ((s as any).kind as SocialKind) : null;
    const url = httpsUrl((s as any)?.url);
    if (kind && url && !out.some((o) => o.kind === kind)) out.push({ kind, url });
  }
  return out;
}

// ------------------------------------------------------------------ resolving a theme for drawing

export interface ResolvedSection { key: string; label: Txt; on: boolean; order: number; required: boolean; pages: PageKind[] }

/** Template defaults with the painter's changes on top, sorted by order. */
export function resolveSections(cfg: TemplateConfig, theme: Theme): ResolvedSection[] {
  const mine = new Map(theme.sections.map((s) => [s.key, s]));
  return cfg.sections
    .map((d) => {
      const m = mine.get(d.key);
      return { key: d.key, label: d.label, on: d.required ? true : m ? m.on : d.enabled, order: m ? m.order : d.order, required: !!d.required, pages: d.pages };
    })
    .sort((a, b) => a.order - b.order);
}

export function resolveTokens(cfg: TemplateConfig, theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of cfg.tokens) out[t.key] = theme.tokens[t.key] ?? t.default;
  return out;
}

export function resolveFonts(cfg: TemplateConfig, theme: Theme): { display: string; body: string } {
  const d = cfg.fonts.find((f) => f.key === "display")?.default ?? "Instrument Serif";
  const b = cfg.fonts.find((f) => f.key === "body")?.default ?? "Inter";
  return { display: theme.fonts.display ?? d, body: theme.fonts.body ?? b };
}

/** The :root block that overrides a template's tokens. Values are checked hex colors and listed font names only. */
export function tokenCss(cfg: TemplateConfig, theme: Theme): string {
  const tk = resolveTokens(cfg, theme);
  const f = resolveFonts(cfg, theme);
  const fam = (name: string) => `"${name}",${FONT_CHOICES.find((x) => x.family === name)?.kind === "sans" ? "system-ui,-apple-system,sans-serif" : "Georgia,serif"}`;
  return `:root{${Object.entries(tk).map(([k, v]) => `--${k}:${v}`).join(";")};--f-display:${fam(f.display)};--f-body:${fam(f.body)}}`;
}

// ------------------------------------------------------------------ schema versions

/**
 * Site document versions. Each step upgrades a saved site one version, so a site saved long ago still opens.
 *  1: the first website builder (one template field, no theme).
 *  2: per-template themes, social links.
 *  3: before and after pairs gain service, city, year and size (all optional).
 * To add a feature later: add a step here, raise SITE_SCHEMA, and give new fields a safe default.
 */
export const SITE_SCHEMA = 3;
const STEPS: Record<number, (s: any) => any> = {
  1: (s) => ({ ...s, sv: 2, themes: s.themes && typeof s.themes === "object" ? s.themes : {}, social: Array.isArray(s.social) ? s.social : [] }),
  2: (s) => {
    const themes: Record<string, any> = {};
    for (const [k, th] of Object.entries(s.themes && typeof s.themes === "object" ? s.themes : {}) as [string, any][]) {
      themes[k] = th && Array.isArray(th.pairs) ? { ...th, pairs: th.pairs.map((p: any) => ({ service: "", city: "", year: "", size: "", ...p })) } : th;
    }
    return { ...s, sv: 3, themes };
  },
};
export function upgradeSite(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  let s = { ...raw };
  let v = Number.isInteger(s.sv) && s.sv > 0 ? s.sv : 1;
  while (v < SITE_SCHEMA && STEPS[v]) {
    s = STEPS[v](s);
    v = s.sv;
  }
  return s;
}

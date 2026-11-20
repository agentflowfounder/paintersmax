import { configOf, latestVersion, TEMPLATE_IDS, TEMPLATE_VERSIONS } from "../templates/configs.ts";
import { RENDERERS } from "../templates/renderers.ts";
import type { ThemeRenderCtx } from "../templates/_shared/ctx.ts";
import { renderSitePage, type RenderCtx } from "./siterender.ts";
import { CLASS_DOORS, cleanTheme, emptyTheme, type Door, type Lang, type TemplateConfig, type Theme } from "./sitetheme.ts";

/**
 * The template library: which templates exist (templates/configs.ts) plus admin's choices for each one, kept in
 * app_settings under REGISTRY_KEY (no database change):
 *   enabled   off = hidden from the picker for new choices. Sites already using it keep working (never deleted).
 *   doors     which paid doors may publish with it (default from its class: basic = Launch+, standard = Grow+,
 *             premium = Signature). Free previews every enabled template and never publishes.
 *   name, thumb (R2 key), sort, note
 *   version   pinned version (a rollback). Empty = newest.
 * Every change is written to the admin audit log by the API (sitetemplatesapi.ts).
 */

export const REGISTRY_KEY = "sitetpl:registry";
const DOORS: Door[] = ["free", "launch", "grow", "signature"];
/** Slots that never get a stock default: the painter's own before and after work must be real. */
export const NO_DEFAULT_SLOTS = ["BA-BEFORE", "BA-AFTER"];

const PAID: Door[] = ["launch", "grow", "signature"];
/** The doors a template may list: Free is allowed only for free-class templates (checked in readRegistry). */
const ALL_DOORS: Door[] = ["free", "launch", "grow", "signature"];

export interface TemplateOverride {
  enabled?: boolean;
  doors?: Door[];
  name?: string;
  thumb?: string;
  /** Admin's default photos: slot name -> R2 key. Shown to visitors until the painter adds their own. */
  slotImages?: Record<string, string>;
  sort?: number;
  version?: string;
  note?: string;
  updatedOn?: string; // YYYY-MM-DD
  updatedBy?: string;
}
export type Registry = Record<string, TemplateOverride>;

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function readRegistry(raw: unknown): Registry {
  let j: any = raw;
  try {
    if (typeof raw === "string") j = JSON.parse(raw);
  } catch {
    return {};
  }
  const out: Registry = {};
  if (!j || typeof j !== "object") return out;
  for (const id of TEMPLATE_IDS) {
    const o = j[id];
    if (!o || typeof o !== "object") continue;
    const r: TemplateOverride = {};
    if (typeof o.enabled === "boolean") r.enabled = o.enabled;
    if (Array.isArray(o.doors)) r.doors = ALL_DOORS.filter((d) => o.doors.includes(d) && (d !== "free" || !!configOf(id)?.class && configOf(id)!.class === "free"));
    if (s(o.name, 40)) r.name = s(o.name, 40);
    if (/^site-templates\/[a-z0-9-]{1,40}\/[a-z0-9]{6,40}\.(webp|png|jpg)$/.test(s(o.thumb, 120))) r.thumb = s(o.thumb, 120);
    if (o.slotImages && typeof o.slotImages === "object") {
      const m: Record<string, string> = {};
      for (const [slot, key] of Object.entries(o.slotImages)) {
        if (/^[A-Z0-9-]{2,30}$/.test(slot) && typeof key === "string" && new RegExp(`^site-templates/${id}/slots/${slot}-[a-z0-9]{6,20}\\.(webp|png|jpg)$`).test(key) && !NO_DEFAULT_SLOTS.includes(slot)) m[slot] = key;
      }
      if (Object.keys(m).length) r.slotImages = m;
    }
    if (Number.isInteger(o.sort)) r.sort = Math.max(0, Math.min(999, o.sort));
    if (typeof o.version === "string" && TEMPLATE_VERSIONS[id][o.version]) r.version = o.version;
    if (s(o.note, 200)) r.note = s(o.note, 200);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s(o.updatedOn, 10))) r.updatedOn = s(o.updatedOn, 10);
    if (s(o.updatedBy, 200)) r.updatedBy = s(o.updatedBy, 200);
    out[id] = r;
  }
  return out;
}

export interface TemplateEntry {
  id: string;
  slug: string;
  name: string;
  class: TemplateConfig["class"];
  version: string; // the version sites draw with now
  latest: string;
  versions: string[];
  doors: Door[]; // doors that may publish with it (Free only for free-class templates)
  enabled: boolean;
  thumb: string | null; // R2 key
  sort: number;
  description: { en: string; es: string };
  inspiration: string;
  license: string;
  legacy: boolean;
  pack: boolean; // an uploaded template pack (admin can delete it)
  note: string;
  updatedOn: string | null;
}

const DEFAULT_SORT: Record<string, number> = { "sunset-sand": 10, classic: 80, bold: 90 };

export function entries(reg: Registry): TemplateEntry[] {
  return TEMPLATE_IDS.map((id) => {
    const o = reg[id] ?? {};
    const latest = latestVersion(id)!;
    const version = o.version ?? latest;
    const cfg = configOf(id, version)!;
    return {
      id, slug: id, name: o.name ?? cfg.name, class: cfg.class, version, latest, versions: Object.keys(TEMPLATE_VERSIONS[id]),
      doors: o.doors ?? CLASS_DOORS[cfg.class], enabled: o.enabled ?? true, thumb: o.thumb ?? null, sort: o.sort ?? DEFAULT_SORT[id] ?? 50,
      description: cfg.description, inspiration: cfg.inspiration, license: cfg.license, legacy: !!cfg.legacy, pack: !!cfg.pack, note: o.note ?? "", updatedOn: o.updatedOn ?? null,
    };
  }).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export const entryOf = (reg: Registry, id: string) => entries(reg).find((t) => t.id === id) ?? null;

/** A door publishes with the templates whose door list includes it. Free publishes only free-class templates (Classic and Bold, and uploaded free templates). */
export const canPublishWith = (reg: Registry, id: string, door: Door) => !!entryOf(reg, id)?.doors.includes(door);

/**
 * What the picker shows a painter for each template:
 *  use     they may choose it (and publish with it, on a paid door)
 *  preview Free: they may choose it to see their draft in it (Free never publishes)
 *  locked  a higher door is needed; they may look at the sample but not choose it
 * Disabled templates are left out, except the one the painter already uses.
 */
export function pickerList(reg: Registry, door: Door, current: string) {
  return entries(reg)
    .filter((t) => t.enabled || t.id === current)
    .map((t) => {
      const lowest = ALL_DOORS.find((d) => t.doors.includes(d)) ?? "signature";
      const state: "use" | "preview" | "locked" = t.doors.includes(door) ? "use" : door === "free" ? "preview" : "locked";
      return { id: t.id, name: t.name, class: t.class, description: t.description, thumb: t.thumb ? `/site-template-thumb/${t.id}` : null, state, lowestDoor: lowest, current: t.id === current, legacy: t.legacy };
    });
}

/** Whether a painter may set their draft to this template right now. */
export function mayChoose(reg: Registry, id: string, door: Door, current: string): boolean {
  if (id === current) return true;
  const t = entryOf(reg, id);
  if (!t || !t.enabled) return false;
  return door === "free" || t.doors.includes(door); // Free may look at any enabled template; it publishes only free ones
}

// ------------------------------------------------------------------ drawing a page

export interface ThemeOpts {
  reg: Registry;
  door: Door;
  balance: number | null;
  uiLang?: Lang;
  langHref: string;
  mapsKey?: string;
  /** Draw with this template instead of the site's (admin "preview as" and the picker's sample view). */
  templateOverride?: string;
}

export function themeFor(site: { themes?: Record<string, unknown>; photos: { id: string }[] }, id: string, cfg: TemplateConfig | null): Theme {
  const raw = site.themes?.[id];
  return raw ? cleanTheme(raw, cfg, new Set(site.photos.map((p) => p.id))) : emptyTheme();
}

/** The HTML of one page, drawn with the site's template (or the override). Unknown or legacy templates use siterender.ts. */
export function renderWithTemplate(base: RenderCtx, o: ThemeOpts): string {
  const id = o.templateOverride && TEMPLATE_VERSIONS[o.templateOverride] ? o.templateOverride : base.site.template;
  const version = o.reg[id]?.version ?? latestVersion(id);
  const cfg = configOf(id, version);
  const baseCfg = cfg?.pack ? configOf(cfg.pack.base) : cfg;
  const draw = cfg ? RENDERERS[`${cfg.id}@${cfg.version}`] ?? (baseCfg ? RENDERERS[`${baseCfg.id}@${baseCfg.version}`] : undefined) : undefined;
  if (!cfg || cfg.legacy || !draw) return renderSitePage({ ...base, onePage: o.door === "free", look: cfg?.pack ? { bold: cfg.pack.base === "bold", ...cfg.pack.palette } : undefined, site: { ...base.site, template: cfg?.legacy ? id : "classic" } });
  const ctx: ThemeRenderCtx = {
    ...base,
    cfg,
    theme: themeFor(base.site, id, cfg),
    uiLang: o.uiLang ?? base.site.lang,
    langHref: o.langHref,
    door: o.door,
    balance: o.balance,
    mapsKey: cfg.mapsMode === "worker-key" ? (o.mapsKey ?? "") : "",
    assetBase: `/templates/${baseCfg!.id}/${baseCfg!.version}/`,
    platformBase: "/templates/_platform/1.0.0/",
    leadEndpoint: "/api/lead",
    defaults: Object.fromEntries(Object.keys(o.reg[id]?.slotImages ?? {}).map((slot) => [slot, `/site-template-image/${id}/${slot}`])),
  };
  return draw(ctx);
}

/** The visitor's language choice: ?lang=en|es, else the site's own. */
export function uiLangOf(url: URL, siteLang: Lang): Lang {
  const q = url.searchParams.get("lang");
  return q === "es" || q === "en" ? q : siteLang;
}

export { DOORS };

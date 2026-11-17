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
const PAID: Door[] = ["launch", "grow", "signature"];

export interface TemplateOverride {
  enabled?: boolean;
  doors?: Door[];
  name?: string;
  thumb?: string;
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
    if (Array.isArray(o.doors)) r.doors = PAID.filter((d) => o.doors.includes(d));
    if (s(o.name, 40)) r.name = s(o.name, 40);
    if (/^site-templates\/[a-z0-9-]{1,40}\/[a-z0-9]{6,40}\.(webp|png|jpg)$/.test(s(o.thumb, 120))) r.thumb = s(o.thumb, 120);
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
  doors: Door[]; // paid doors that may publish with it
  enabled: boolean;
  thumb: string | null; // R2 key
  sort: number;
  description: { en: string; es: string };
  inspiration: string;
  license: string;
  legacy: boolean;
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
      description: cfg.description, inspiration: cfg.inspiration, license: cfg.license, legacy: !!cfg.legacy, note: o.note ?? "", updatedOn: o.updatedOn ?? null,
    };
  }).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export const entryOf = (reg: Registry, id: string) => entries(reg).find((t) => t.id === id) ?? null;

/** Paid doors publish with templates whose door list includes them. Free never publishes. */
export const canPublishWith = (reg: Registry, id: string, door: Door) => door !== "free" && !!entryOf(reg, id)?.doors.includes(door);

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
      const lowest = PAID.find((d) => t.doors.includes(d)) ?? "signature";
      const state: "use" | "preview" | "locked" = door === "free" ? "preview" : t.doors.includes(door) ? "use" : "locked";
      return { id: t.id, name: t.name, class: t.class, description: t.description, thumb: t.thumb ? `/site-template-thumb/${t.id}` : null, state, lowestDoor: lowest, current: t.id === current, legacy: t.legacy };
    });
}

/** Whether a painter may set their draft to this template right now. */
export function mayChoose(reg: Registry, id: string, door: Door, current: string): boolean {
  if (id === current) return true;
  const t = entryOf(reg, id);
  if (!t || !t.enabled) return false;
  return door === "free" || t.doors.includes(door);
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
  const draw = cfg ? RENDERERS[`${cfg.id}@${cfg.version}`] : undefined;
  if (!cfg || cfg.legacy || !draw) return renderSitePage({ ...base, site: { ...base.site, template: cfg?.legacy ? id : "classic" } });
  const ctx: ThemeRenderCtx = {
    ...base,
    cfg,
    theme: themeFor(base.site, id, cfg),
    uiLang: o.uiLang ?? base.site.lang,
    langHref: o.langHref,
    door: o.door,
    balance: o.balance,
    mapsKey: cfg.mapsMode === "worker-key" ? (o.mapsKey ?? "") : "",
    assetBase: `/templates/${cfg.id}/${cfg.version}/`,
    platformBase: "/templates/_platform/1.0.0/",
    leadEndpoint: "/api/lead",
  };
  return draw(ctx);
}

/** The visitor's language choice: ?lang=en|es, else the site's own. */
export function uiLangOf(url: URL, siteLang: Lang): Lang {
  const q = url.searchParams.get("lang");
  return q === "es" || q === "en" ? q : siteLang;
}

export { DOORS };

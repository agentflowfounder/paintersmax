import { cleanSite, DOOR_LIMITS, DOOR_NAMES, firstDraft, limitsFor, publishBlockers, readDoorRecord, type Door } from "./sitecore.ts";
import { DOOR_PLAN } from "./sitecore.ts";
import type { Env } from "./types.ts";

/**
 * Tier demo sites (Rogelio approved 2026-11-22): a Local Pro example and a Contractor example, built on the Sunset Sand
 * template, so a painter can see what each door gives. dfwpainters.pro is the Commercial example (it is a demo site).
 * An admin builds them with one button (Admin > Websites). They are ordinary tenant sites on demo-* addresses, so the
 * normal renderer, templates and limits apply. The demo companies are left out of client counts (see isDemoSlug).
 */
export const DEMO_PREFIX = "demo-";
export const isDemoSlug = (slug: string) => slug.startsWith(DEMO_PREFIX);
export const TIER_DEMOS: { slug: string; door: Door; name: string; city: string; cities: string[] }[] = [
  { slug: "demo-local-pro", door: "launch", name: "Sample Local Pro Painting", city: "Tyler", cities: ["Tyler, TX", "Whitehouse, TX"] },
  { slug: "demo-contractor", door: "grow", name: "Sample Contractor Painting", city: "Tyler", cities: ["Tyler, TX", "Longview, TX", "Lindale, TX", "Whitehouse, TX", "Bullard, TX", "Flint, TX"] },
];
const FILL = "Family-owned and focused on clean lines, clear prices and a finished job you can be proud of. This is a sample site that shows what this door includes.";

/** Replaces every [placeholder] the first draft leaves for the painter, so the demo can be published. */
export function fillPlaceholders<T>(v: T): T {
  if (typeof v === "string") return v.replace(/\[[^\]]*\]/g, FILL) as unknown as T;
  if (Array.isArray(v)) return v.map(fillPlaceholders) as unknown as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fillPlaceholders(x)])) as T;
  return v;
}

/** Builds (or rebuilds) one demo and publishes it. Returns the slug and any problem. */
export async function buildTierDemo(env: Env, d: (typeof TIER_DEMOS)[number], publishedAt: string): Promise<{ slug: string; ok: boolean; error?: string }> {
  const rec = readDoorRecord({ door: d.door, note: "Tier demo site (not a client)" });
  const limits = limitsFor(d.door, rec);
  const draft = fillPlaceholders(firstDraft({ name: d.name, phone: "(903) 555-0100", email: "demo@paintersmax.app", city: d.city, state: "TX", trades: ["interior", "exterior", "cabinets", "commercial"], cities: d.cities, warrantyMonths: 24, insured: true, lang: "en" }, limits));
  draft.template = "sunset-sand";
  const r = cleanSite(draft, limits, d.door);
  if (!r.ok) return { slug: d.slug, ok: false, error: r.error };
  const blockers = publishBlockers(r.site);
  if (blockers.length) return { slug: d.slug, ok: false, error: blockers[0] };
  await env.DB.prepare("INSERT INTO companies (slug, name, plan) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET name = excluded.name, plan = excluded.plan").bind(d.slug, d.name, DOOR_PLAN[d.door]).run();
  const co = await env.DB.prepare("SELECT id FROM companies WHERE slug = ?").bind(d.slug).first<{ id: number }>();
  if (!co) return { slug: d.slug, ok: false, error: "Could not create the demo company." };
  const up = "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')";
  await env.DB.batch([
    env.DB.prepare(up).bind(`sitedoor:${co.id}`, JSON.stringify(rec)),
    env.DB.prepare(up).bind(`site:${co.id}`, JSON.stringify(r.site)),
    env.DB.prepare(up).bind(`sitelive:${co.id}`, JSON.stringify({ site: r.site, publishedAt })),
  ]);
  return { slug: d.slug, ok: true };
}

export const tierDemoLabel = (d: (typeof TIER_DEMOS)[number]) => `${DOOR_NAMES[d.door]} example (${DOOR_LIMITS[d.door].pages} pages)`;

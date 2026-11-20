import { adminActor, can, logAudit } from "./adminroles.ts";
import { blobsWithPrefix, writeBlob } from "./kv.ts";
import { todayLocal } from "./dates.ts";
import { configOf, TEMPLATE_IDS, TEMPLATE_VERSIONS } from "../templates/configs.ts";
import { isFont, type TemplateClass, type TemplateConfig } from "./sitetheme.ts";
import type { Env } from "./types.ts";

/**
 * Uploaded template packs (admin adds and deletes them for any tier).
 *
 * A pack is data, never code: a small JSON file that re-skins one of the built-in layouts with its own name, tier,
 * colors, fonts and words. Nothing a pack contains is ever run, so an upload cannot break or attack a client site.
 * A brand-new layout (new sections, new design) still needs code in templates/; the pack format is the safe way
 * to add more looks to a tier without a deploy.
 *
 * Pack file (JSON, at most 20 KB):
 *   { "format": "paintersmax-template-pack", "id": "warm-oak", "name": "Warm Oak", "tier": "free|basic|standard|premium",
 *     "base": "sunset-sand" | "classic" | "bold",
 *     "description": { "en": "...", "es": "..." }, "inspiration": "...", "license": "...",
 *     "tokens": { "c-brand": "#8a5a2b", ... },          // base sunset-sand only: colors that replace the defaults
 *     "fonts": { "display": "Marcellus", "body": "Inter" }, // base sunset-sand only: fonts from the platform list
 *     "palette": { "dark": "#10202f", "bg": "#f6f3ee", "accent": "#e8a33d" } } // base classic or bold only
 *   tier "free": base must be classic or bold (the one-page-with-tabs layouts). Other tiers: base sunset-sand.
 *
 * Stored as app_settings `sitepack:<id>`. No database change. Deleting a pack never deletes a client's site: a site
 * that used it is drawn with Classic until the client picks again (the content is untouched).
 */

export const PACK_PREFIX = "sitepack:";
export const MAX_PACKS = 40;
export const MAX_PACK_BYTES = 20_000;
export const BUILTIN_IDS = Object.freeze(["classic", "bold", "sunset-sand"]);
const BASES = ["sunset-sand", "classic", "bold"] as const;
const TIERS: TemplateClass[] = ["free", "basic", "standard", "premium"];

export interface Pack {
  id: string;
  name: string;
  tier: TemplateClass;
  base: (typeof BASES)[number];
  description: { en: string; es: string };
  inspiration: string;
  license: string;
  tokens: Record<string, string>;
  fonts: { display?: string; body?: string };
  palette: { dark?: string; bg?: string; accent?: string };
  addedOn: string;
  addedBy: string;
}

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : "");
const slugOk = (v: string) => /^[a-z0-9][a-z0-9-]{2,39}$/.test(v);

/** Cleans an uploaded pack. Returns the pack or the first reason it was refused. Nothing in it is ever executed. */
export function cleanPack(raw: unknown, who = "", today = todayLocal()): { ok: true; pack: Pack } | { ok: false; error: string } {
  let j: any = raw;
  if (typeof raw === "string") {
    if (raw.length > MAX_PACK_BYTES) return { ok: false, error: "The pack file is too large (20 KB at most)." };
    try {
      j = JSON.parse(raw);
    } catch {
      return { ok: false, error: "This is not a valid JSON file." };
    }
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, error: "The pack file must be a JSON object." };
  if (j.format !== "paintersmax-template-pack") return { ok: false, error: 'The file must say "format": "paintersmax-template-pack".' };
  const id = s(j.id, 40).toLowerCase();
  if (!slugOk(id)) return { ok: false, error: "The id must be a slug of 3 to 40 letters, numbers or dashes." };
  if (BUILTIN_IDS.includes(id)) return { ok: false, error: "That id belongs to a built-in template. Choose another." };
  const name = s(j.name, 40);
  if (!name) return { ok: false, error: "The pack needs a name." };
  const tier = TIERS.find((t) => t === j.tier);
  if (!tier) return { ok: false, error: 'The tier must be "free", "basic", "standard" or "premium".' };
  const base = BASES.find((b) => b === j.base);
  if (!base) return { ok: false, error: 'The base layout must be "sunset-sand", "classic" or "bold".' };
  if (tier === "free" && base === "sunset-sand") return { ok: false, error: "Free templates use the one-page layouts: base must be classic or bold." };
  if (tier !== "free" && base !== "sunset-sand") return { ok: false, error: "Paid tiers use the sunset-sand layout. Classic and bold are the free one-page layouts." };
  const description = { en: s(j.description?.en, 200), es: s(j.description?.es, 200) };
  if (!description.en) return { ok: false, error: "The pack needs an English description." };
  if (!description.es) description.es = description.en;
  const tokens: Record<string, string> = {};
  if (j.tokens && typeof j.tokens === "object") {
    const allowed = new Set((configOf("sunset-sand")?.tokens ?? []).map((t) => t.key));
    for (const [k, v] of Object.entries(j.tokens)) {
      if (!allowed.has(k)) return { ok: false, error: `Unknown color "${k}" for this layout.` };
      const h = hex(v);
      if (!h) return { ok: false, error: `The color "${k}" must look like #a1b2c3.` };
      tokens[k] = h;
    }
  }
  const fonts: Pack["fonts"] = {};
  for (const k of ["display", "body"] as const) {
    const f = j.fonts?.[k];
    if (f == null || f === "") continue;
    if (!isFont(f)) return { ok: false, error: `The font "${String(f).slice(0, 40)}" is not on the platform font list.` };
    fonts[k] = f;
  }
  const palette: Pack["palette"] = {};
  for (const k of ["dark", "bg", "accent"] as const) {
    const v = j.palette?.[k];
    if (v == null || v === "") continue;
    const h = hex(v);
    if (!h) return { ok: false, error: `The palette color "${k}" must look like #a1b2c3.` };
    palette[k] = h;
  }
  if (base === "sunset-sand" && Object.keys(palette).length) return { ok: false, error: "Palette is for classic and bold. Use tokens for sunset-sand." };
  if (base !== "sunset-sand" && (Object.keys(tokens).length || Object.keys(fonts).length)) return { ok: false, error: "Tokens and fonts are for sunset-sand. Use palette for classic and bold." };
  return { ok: true, pack: { id, name, tier, base, description, inspiration: s(j.inspiration, 200) || "Uploaded by PaintersMax admin (original work).", license: s(j.license, 200) || "Original. Fonts under the SIL Open Font License.", tokens, fonts, palette, addedOn: /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : todayLocal(), addedBy: s(who, 200) } };
}

/** Reads a stored blob; anything that does not pass cleaning is dropped. */
export function readPack(raw: unknown): Pack | null {
  const o: any = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!o || typeof o !== "object") return null;
  const r = cleanPack({ ...o, format: "paintersmax-template-pack" }, "", "0000-00-00");
  if (!r.ok) return null;
  return { ...r.pack, addedOn: /^\d{4}-\d{2}-\d{2}$/.test(s(o?.addedOn, 10)) ? s(o.addedOn, 10) : "", addedBy: s(o?.addedBy, 200) };
}

/** The template config a pack stands for: its base layout's config with the pack's name, tier, colors and fonts. */
export function packConfig(p: Pack): TemplateConfig | null {
  const base = configOf(p.base);
  if (!base) return null;
  const tokens = base.tokens.map((t) => (p.tokens[t.key] ? { ...t, default: p.tokens[t.key] } : t));
  const fonts = base.fonts.map((f) => (p.fonts[f.key] ? { ...f, default: p.fonts[f.key]! } : f));
  return { ...base, id: p.id, name: p.name, class: p.tier, version: "1.0.0", description: p.description, inspiration: p.inspiration, license: p.license, tokens, fonts, pack: { base: p.base, palette: p.palette } };
}

let registered: string[] = [];
/** Puts the packs into the live template tables (the same ones the built-in templates use). Removes packs that were deleted. */
export function registerPacks(list: Pack[]): void {
  for (const id of registered) {
    delete TEMPLATE_VERSIONS[id];
    const i = TEMPLATE_IDS.indexOf(id);
    if (i >= 0) TEMPLATE_IDS.splice(i, 1);
  }
  registered = [];
  for (const p of list) {
    if (BUILTIN_IDS.includes(p.id)) continue;
    const cfg = packConfig(p);
    if (!cfg) continue;
    TEMPLATE_VERSIONS[p.id] = { "1.0.0": cfg };
    TEMPLATE_IDS.push(p.id);
    registered.push(p.id);
  }
}

let loadedAt = 0;
let cache: Pack[] = [];
/** Loads the packs (cached for 30 seconds in each Worker) and registers them. Safe to call on every request. */
export async function refreshPacks(env: Env, force = false): Promise<Pack[]> {
  if (!force && Date.now() - loadedAt < 30_000) return cache;
  const rows = await blobsWithPrefix(env, PACK_PREFIX, MAX_PACKS + 10).catch(() => []);
  cache = rows.map((r) => readPack(r.value)).filter((p): p is Pack => !!p).slice(0, MAX_PACKS);
  registerPacks(cache);
  loadedAt = Date.now();
  return cache;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * GET  /api/site/templates/packs          the uploaded packs, plus the pack format help
 * POST /api/site/templates/packs {action:"add", pack: <object or JSON text>}   upload (replaces a pack with the same id)
 *                                {action:"delete", id}                          delete one pack
 * Seeing needs the "sites" area; changing needs "sites" change. Every change goes to the audit log.
 */
export async function handleTemplatePacks(request: Request, env: Env): Promise<Response> {
  const actor = await adminActor(env, request);
  if (!actor || !can(actor.role, "sites", "see")) return json({ error: "Not found." }, 404);
  if (request.method === "GET") return json({ packs: await refreshPacks(env, true), max: MAX_PACKS, canChange: can(actor.role, "sites", "change") });
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  if (!can(actor.role, "sites", "change")) return json({ error: "Your role can look but not change templates." }, 403);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (b?.action === "add") {
    const packs = await refreshPacks(env, true);
    const r = cleanPack(b.pack, actor.email);
    if (!r.ok) return json({ error: r.error }, 400);
    if (!packs.some((p) => p.id === r.pack.id) && packs.length >= MAX_PACKS) return json({ error: `You can keep ${MAX_PACKS} uploaded templates. Delete one first.` }, 400);
    await writeBlob(env, PACK_PREFIX + r.pack.id, r.pack);
    await logAudit(env, actor, "template_pack_add", { detail: { id: r.pack.id, tier: r.pack.tier, base: r.pack.base } });
    return json({ ok: true, pack: r.pack, packs: await refreshPacks(env, true) });
  }
  if (b?.action === "delete") {
    const id = s(b.id, 40);
    const packs = await refreshPacks(env, true);
    if (!packs.some((p) => p.id === id)) return json({ error: "Pack not found." }, 404);
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(PACK_PREFIX + id).run();
    await logAudit(env, actor, "template_pack_delete", { detail: { id } });
    return json({ ok: true, packs: await refreshPacks(env, true) });
  }
  return json({ error: "Unknown action." }, 400);
}

import { adminActor, can, logAudit, type AdminActor } from "./adminroles.ts";
import { todayLocal } from "./dates.ts";
import { blobsWithPrefix, readBlob, updateBlob, writeBlob } from "./kv.ts";
import { listLandings, setLandingMedia } from "./landing.ts";
import type { Env } from "./types.ts";

/**
 * The AI sandbox: a private admin workshop where the owner and staff make images, videos and music for PaintersMax
 * marketing with any fal.ai model. It spends the PaintersMax fal.ai balance (the FAL_KEY secret), never client credits.
 *
 * Rules (brief 2026-11-17):
 *  - OFF until the owner turns it on. The owner sets a per-run, a daily and a monthly dollar limit (app_settings sandbox:settings).
 *  - The model list, each model's settings and its price are read from fal at run time (nothing is hard-coded).
 *  - The price is shown before a run. A run above the per-run limit, or past the daily or monthly limit, is refused.
 *    When fal bills in a unit we cannot predict (GPU or compute seconds), the run counts as the full per-run limit.
 *  - Every run goes through fal's queue: submit, then the page polls. Results are copied to R2 under sandbox/<yyyy-mm>/<id>
 *    with a JSON note (prompt, model, cost, who). Library rows live in app_settings (sandbox:item:<id>).
 *  - Nothing is ever published by itself: an item becomes public only when someone presses "Use in landing page" or "Make public",
 *    and public pages label it as made with AI.
 *  - Items are kept 90 days (owner can change it), favorites and public items forever.
 *  - Every run, setting change, publish and delete is written to the audit log.
 */

export const SB_SETTINGS = "sandbox:settings";
const JOB = (id: string) => `sandbox:job:${id}`;
const ITEM = (id: string) => `sandbox:item:${id}`;
const SPEND = "sandbox:spend"; // usage_counters feature; count is in mills (1/1000 of a dollar); period YYYY-MM-DD or YYYY-MM

export type Kind = "image" | "video" | "i2v" | "audio";
export const KINDS: Kind[] = ["image", "video", "i2v", "audio"];
export const CATEGORY: Record<Kind, string> = { image: "text-to-image", video: "text-to-video", i2v: "image-to-video", audio: "text-to-audio" };
export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as string[]).includes(v);

/* ---------------------------------------------------------------- settings */

export interface SbSettings {
  enabled: boolean;
  perRunUsd: number;
  dailyUsd: number;
  monthlyUsd: number;
  keepDays: number;
}
export const DEFAULT_SB: SbSettings = { enabled: false, perRunUsd: 2, dailyUsd: 5, monthlyUsd: 50, keepDays: 90 };
const money = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n)) * 100) / 100 : def;
};
export function cleanSettings(raw: any): SbSettings {
  const o = raw && typeof raw === "object" ? raw : {};
  const keep = Math.round(Number(o.keepDays));
  return {
    enabled: o.enabled === true,
    perRunUsd: money(o.perRunUsd, 0.01, 100, DEFAULT_SB.perRunUsd),
    dailyUsd: money(o.dailyUsd, 0, 1000, DEFAULT_SB.dailyUsd),
    monthlyUsd: money(o.monthlyUsd, 0, 10000, DEFAULT_SB.monthlyUsd),
    keepDays: Number.isFinite(keep) ? Math.max(7, Math.min(3650, keep)) : DEFAULT_SB.keepDays,
  };
}
export const loadSettings = (env: Env) => readBlob(env, SB_SETTINGS, cleanSettings);

/* ---------------------------------------------------------------- models, fields and prices */

/** Any fal model id: owner/app/optional/path. No dots-only parts, no query strings. */
export const MODEL_RE = /^[a-z0-9][a-z0-9_-]{0,40}\/[a-z0-9][a-z0-9_.-]{0,80}(\/[a-z0-9][a-z0-9_.-]{0,60}){0,4}$/;
export const isModelId = (v: unknown): v is string => typeof v === "string" && MODEL_RE.test(v) && !v.includes("..");

export interface Field {
  name: string;
  type: "enum" | "number" | "integer" | "boolean" | "text" | "image";
  options?: string[];
  numeric?: boolean; // the enum's values are numbers
  min?: number;
  max?: number;
  def?: unknown;
  label: string;
  hint: string;
}

// Fields the sandbox fills itself, or that should never be set from the page.
const SKIP = new Set(["prompt", "sync_mode", "webhook_url", "webhook", "enable_safety_checker", "safety_tolerance", "seed", "auto_fix", "num_inference_steps", "guidance_scale", "enable_prompt_expansion", "loras", "embeddings", "controlnets", "ip_adapters", "mask_url", "mask_image_url"]);
// The settings people look for first.
const ORDER = ["aspect_ratio", "image_size", "duration", "resolution", "num_images", "generate_audio", "negative_prompt"];

function resolve(o: any, schema: any, depth = 0): any {
  if (!schema || depth > 6) return schema;
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").pop();
    return resolve(o, o?.components?.schemas?.[name], depth + 1);
  }
  return schema;
}

/** The input schema of a model, from its OpenAPI document (the POST body of the model's own path). */
export function inputSchema(openapi: any): any {
  const paths = openapi?.paths && typeof openapi.paths === "object" ? openapi.paths : {};
  for (const [p, v] of Object.entries<any>(paths)) {
    if (p.includes("/requests/")) continue;
    const s = v?.post?.requestBody?.content?.["application/json"]?.schema;
    if (s) return resolve(openapi, s);
  }
  const schemas = openapi?.components?.schemas ?? {};
  const k = Object.keys(schemas).find((n) => /Input$/.test(n));
  return k ? schemas[k] : null;
}

/** The settings a model takes, simplified for the page (enums, numbers, switches, image inputs, short text). */
export function fieldsFrom(openapi: any): { fields: Field[]; required: string[] } {
  const sch = inputSchema(openapi);
  const props = sch?.properties && typeof sch.properties === "object" ? sch.properties : {};
  const required: string[] = Array.isArray(sch?.required) ? sch.required.filter((x: unknown) => typeof x === "string") : [];
  const out: Field[] = [];
  for (const [name, raw] of Object.entries<any>(props)) {
    if (SKIP.has(name) || !/^[a-z][a-z0-9_]{0,40}$/.test(name)) continue;
    let p = resolve(openapi, raw);
    const variants: any[] = Array.isArray(p?.anyOf) ? p.anyOf.map((x: any) => resolve(openapi, x)) : [p];
    const enumV = variants.find((x) => Array.isArray(x?.enum));
    const label = String(raw?.title ?? p?.title ?? name.replace(/_/g, " ")).slice(0, 40);
    const hint = String(raw?.description ?? p?.description ?? "").replace(/\s+/g, " ").slice(0, 160);
    const def = raw?.default ?? p?.default;
    if (/(^|_)image_urls?$/.test(name) || /^(start|first|end|last)_(frame|image)(_url)?$/.test(name) || name === "image") {
      out.push({ name, type: "image", label, hint, def: undefined });
      continue;
    }
    if (enumV) {
      const options = enumV.enum.filter((x: unknown) => typeof x === "string" || typeof x === "number").map(String).slice(0, 40);
      const numeric = enumV.enum.every((x: unknown) => typeof x === "number");
      if (options.length) out.push({ name, type: "enum", options, numeric, label, hint, def: def == null ? undefined : String(def) });
      continue;
    }
    const t = variants.map((x) => x?.type).find((x) => x && x !== "null");
    if (t === "boolean") out.push({ name, type: "boolean", label, hint, def: typeof def === "boolean" ? def : undefined });
    else if (t === "integer" || t === "number") {
      const pick = variants.find((x) => x?.type === t) ?? {};
      out.push({ name, type: t, label, hint, def: typeof def === "number" ? def : undefined, min: typeof pick.minimum === "number" ? pick.minimum : undefined, max: typeof pick.maximum === "number" ? pick.maximum : undefined });
    } else if (t === "string" && (name.includes("negative") || name.includes("style") || name.includes("lyrics") || name === "text")) {
      out.push({ name, type: "text", label, hint, def: typeof def === "string" ? def.slice(0, 200) : undefined });
    }
  }
  out.sort((a, b) => (ORDER.indexOf(a.name) + 1 || 99) - (ORDER.indexOf(b.name) + 1 || 99));
  return { fields: out.slice(0, 16), required };
}

export interface Price {
  unitPrice: number;
  unit: string;
  currency: string;
}

const FAL_API = "https://api.fal.ai/v1";
const falHeaders = (env: Env) => ({ authorization: `Key ${env.FAL_KEY}`, accept: "application/json" });

/** A small cache in front of fal's catalog and price lists (Cloudflare's cache; does nothing where it is not available). */
async function cachedJson(url: string, ttl: number, load: () => Promise<Response>): Promise<any | null> {
  const c = typeof caches !== "undefined" ? (caches as any).default : null;
  const key = new Request(`https://sandbox-cache.internal/${encodeURIComponent(url)}`);
  if (c) {
    const hit = await c.match(key).catch(() => null);
    if (hit) return hit.json().catch(() => null);
  }
  const r = await load().catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  if (j && c) await c.put(key, new Response(JSON.stringify(j), { headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` } })).catch(() => {});
  return j;
}

export async function pricesFor(env: Env, ids: string[], f: typeof fetch = fetch): Promise<Record<string, Price>> {
  const list = [...new Set(ids.filter(isModelId))].slice(0, 50);
  if (!list.length || !env.FAL_KEY) return {};
  const url = `${FAL_API}/models/pricing?endpoint_id=${list.map(encodeURIComponent).join(",")}`;
  const j = await cachedJson(url, 600, () => f(url, { headers: falHeaders(env) }));
  const out: Record<string, Price> = {};
  for (const p of Array.isArray(j?.prices) ? j.prices : []) {
    const n = Number(p?.unit_price);
    if (typeof p?.endpoint_id === "string" && Number.isFinite(n) && n >= 0) out[p.endpoint_id] = { unitPrice: n, unit: String(p.unit ?? "").slice(0, 40), currency: String(p.currency ?? "USD").slice(0, 3) };
  }
  return out;
}

export interface ModelRow {
  id: string;
  name: string;
  category: string;
  thumb: string;
  price?: Price;
}

function rowOf(m: any): ModelRow | null {
  const id = m?.endpoint_id;
  if (!isModelId(id)) return null;
  const md = m?.metadata ?? {};
  const thumb = typeof md.thumbnail_url === "string" && /^https:\/\//.test(md.thumbnail_url) ? md.thumbnail_url : "";
  return { id, name: String(md.display_name ?? id).slice(0, 80), category: String(md.category ?? "").slice(0, 40), thumb };
}

/** The models fal lists for a kind (searchable), with their prices. */
export async function listModels(env: Env, kind: Kind, q: string, f: typeof fetch = fetch): Promise<ModelRow[]> {
  const qs = new URLSearchParams({ category: CATEGORY[kind], status: "active", limit: "40" });
  if (q) qs.set("q", q.slice(0, 60));
  const url = `${FAL_API}/models?${qs}`;
  const j = await cachedJson(url, 6 * 3600, () => f(url, { headers: env.FAL_KEY ? falHeaders(env) : { accept: "application/json" } }));
  let rows = (Array.isArray(j?.models) ? j.models : []).map(rowOf).filter((r: ModelRow | null): r is ModelRow => !!r);
  if (kind === "audio" && !q) {
    // Music and voice-over live in two categories.
    const url2 = `${FAL_API}/models?${new URLSearchParams({ category: "text-to-speech", status: "active", limit: "20" })}`;
    const j2 = await cachedJson(url2, 6 * 3600, () => f(url2, { headers: env.FAL_KEY ? falHeaders(env) : { accept: "application/json" } }));
    rows = rows.concat((Array.isArray(j2?.models) ? j2.models : []).map(rowOf).filter((r: ModelRow | null): r is ModelRow => !!r));
  }
  const prices = await pricesFor(env, rows.map((r: ModelRow) => r.id), f);
  return rows.map((r: ModelRow) => ({ ...r, price: prices[r.id] }));
}

export interface ModelInfo extends ModelRow {
  fields: Field[];
  required: string[];
}

export async function modelInfo(env: Env, id: string, f: typeof fetch = fetch): Promise<ModelInfo | null> {
  if (!isModelId(id)) return null;
  const url = `${FAL_API}/models?endpoint_id=${encodeURIComponent(id)}&expand=openapi-3.0`;
  const j = await cachedJson(url, 6 * 3600, () => f(url, { headers: env.FAL_KEY ? falHeaders(env) : { accept: "application/json" } }));
  const m = Array.isArray(j?.models) ? j.models.find((x: any) => x?.endpoint_id === id) : null;
  const row = m ? rowOf(m) : null;
  if (!row) return null;
  const { fields, required } = fieldsFrom(m.openapi);
  const price = (await pricesFor(env, [id], f))[id];
  return { ...row, price, fields, required };
}

/* ---------------------------------------------------------------- prompt, input and price */

// Words that point at other brands or real people. The sandbox makes PaintersMax's own media only.
const BLOCK = [
  /\b(sherwin[- ]?williams|benjamin moore|behr|valspar|ppg|home depot|lowe'?s|menards|nike|apple logo|coca[- ]?cola|disney|marvel)\b/i,
  /\b(celebrity|famous (person|actor|singer)|lookalike|look[- ]alike|deepfake|in the likeness of)\b/i,
];
export const SAFETY_TAIL = "No text, no letters, no logos, no watermarks, no brand names, no recognizable real people.";

export function checkPrompt(raw: unknown): { ok: true; prompt: string } | { ok: false; error: string } {
  const p = typeof raw === "string" ? raw.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000) : "";
  if (p.length < 4) return { ok: false, error: "Write a prompt (at least a few words)." };
  for (const re of BLOCK) if (re.test(p)) return { ok: false, error: "Keep other brands and real people out of the prompt. The sandbox makes PaintersMax's own media only." };
  return { ok: true, prompt: p };
}

export const finalPrompt = (p: string, helper: boolean, kind: Kind) => (helper && kind !== "audio" ? `${p} ${SAFETY_TAIL}` : p);

const isHttps = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length > 1000) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

/** Builds the model input from the page's values, keeping only known fields with allowed values. */
export function buildInput(fields: Field[], values: any, prompt: string): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const v = values && typeof values === "object" ? values : {};
  const input: Record<string, unknown> = { prompt };
  for (const fd of fields) {
    const x = v[fd.name];
    if (x === undefined || x === null || x === "") continue;
    if (fd.type === "enum") {
      if (!fd.options!.includes(String(x))) return { ok: false, error: `${fd.label}: pick one of the choices.` };
      input[fd.name] = fd.numeric ? Number(x) : String(x); // a number enum stays a number
    } else if (fd.type === "boolean") input[fd.name] = x === true || x === "true";
    else if (fd.type === "number" || fd.type === "integer") {
      let n = Number(x);
      if (!Number.isFinite(n)) return { ok: false, error: `${fd.label}: enter a number.` };
      if (fd.type === "integer") n = Math.round(n);
      if ((fd.min != null && n < fd.min) || (fd.max != null && n > fd.max)) return { ok: false, error: `${fd.label}: keep it between ${fd.min ?? "-"} and ${fd.max ?? "-"}.` };
      input[fd.name] = n;
    } else if (fd.type === "text") input[fd.name] = String(x).replace(/[\u0000-\u001f]+/g, " ").slice(0, 500);
    else if (fd.type === "image") {
      const list = Array.isArray(x) ? x : [x];
      if (!list.length || list.length > 4 || !list.every(isHttps)) return { ok: false, error: `${fd.label}: use an image from the library or an https link.` };
      input[fd.name] = fd.name.endsWith("_urls") ? list : list[0];
    }
  }
  if (typeof input.num_images === "number") input.num_images = Math.max(1, Math.min(4, input.num_images));
  return { ok: true, input };
}

export function missingRequired(required: string[], input: Record<string, unknown>): string[] {
  return required.filter((r) => input[r] === undefined || input[r] === "");
}

export interface Estimate {
  usd: number; // what is counted against the limits
  rate: string; // "0.08 USD per image"
  qty: number;
  rough: boolean; // true when fal bills in a unit we cannot predict; the run then counts as the full per-run limit
  note: string;
}

const secondsOf = (v: unknown): number | null => {
  const m = String(v ?? "").match(/^(\d+(?:\.\d+)?)\s*s?$/);
  return m ? Number(m[1]) : null;
};

/** Estimated cost of a run. Unknown units count as the full per-run limit, so the daily cap still holds. */
export function estimate(price: Price | undefined, input: Record<string, unknown>, perRunUsd: number): Estimate {
  if (!price) return { usd: perRunUsd, rate: "unknown", qty: 1, rough: true, note: "fal gave no price for this model. The run counts as your full per-run limit." };
  const u = price.unit.toLowerCase();
  const n = typeof input.num_images === "number" ? input.num_images : 1;
  const rate = `${price.unitPrice} ${price.currency} per ${price.unit.replace(/s$/, "")}`;
  let qty: number;
  let rough = false;
  let note = "";
  if (/compute|gpu|minute|hour/.test(u)) {
    return { usd: perRunUsd, rate, qty: 1, rough: true, note: "fal bills this model by machine time, which is not known in advance. The run counts as your full per-run limit." };
  } else if (u.includes("megapixel")) {
    qty = n; // about one megapixel per image at normal sizes
    note = "About 1 megapixel per image. Larger sizes cost more.";
  } else if (u.includes("image")) qty = n;
  else if (u.includes("second")) {
    const s = secondsOf(input.duration);
    qty = s ?? 5;
    if (s == null) note = "Length not set; counted as 5 seconds.";
  } else if (u.includes("video")) qty = 1;
  else if (u.includes("1000 char") || u.includes("character")) {
    const chars = String(input.prompt ?? "").length + String(input.text ?? "").length;
    qty = u.includes("1000") ? Math.max(1, Math.ceil(chars / 1000)) : chars;
  } else {
    qty = 1;
    rough = true;
    note = "Unfamiliar billing unit; counted as one unit.";
  }
  if (/1080|4k|2k|high/i.test(String(input.resolution ?? ""))) note = (note + " Higher resolution may cost more than the base rate.").trim();
  const usd = Math.round(price.unitPrice * qty * 1000) / 1000;
  return { usd, rate, qty, rough, note };
}

/* ---------------------------------------------------------------- spending limits */

async function masterId(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT id FROM companies WHERE slug = 'paintersmax-master'").first<{ id: number }>();
  if (!r) throw new Error("PaintersMax master company is missing");
  return r.id;
}
const mills = (usd: number) => Math.max(1, Math.round(usd * 1000));
export const periods = (now = Date.now()) => {
  const day = todayLocal(now);
  return { day, month: day.slice(0, 7) };
};

export async function spent(env: Env, now = Date.now()): Promise<{ todayUsd: number; monthUsd: number }> {
  const id = await masterId(env);
  const { day, month } = periods(now);
  const rows = await env.DB.prepare("SELECT period, count FROM usage_counters WHERE company_id = ? AND feature = ? AND period IN (?, ?)").bind(id, SPEND, day, month).all<{ period: string; count: number }>();
  let t = 0;
  let m = 0;
  for (const r of rows.results ?? []) {
    if (r.period === day) t = r.count;
    if (r.period === month) m = r.count;
  }
  return { todayUsd: t / 1000, monthUsd: m / 1000 };
}

async function bump(env: Env, id: number, period: string, add: number, cap: number): Promise<boolean> {
  if (add > cap) return false;
  const row = await env.DB.prepare(
    `INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, ?, ?, ?)
     ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + excluded.count WHERE count + excluded.count <= ? RETURNING count`,
  )
    .bind(id, SPEND, period, add, cap)
    .first<{ count: number }>();
  return !!row;
}

/** Reserves the cost against today and this month, or says which limit stops it. */
export async function reserve(env: Env, s: SbSettings, usd: number, now = Date.now()): Promise<{ ok: true; mills: number; day: string; month: string } | { ok: false; error: string }> {
  const id = await masterId(env);
  const { day, month } = periods(now);
  const m = mills(usd);
  if (!(await bump(env, id, day, m, Math.round(s.dailyUsd * 1000)))) return { ok: false, error: `This run would pass today's limit of $${s.dailyUsd.toFixed(2)}.` };
  if (!(await bump(env, id, month, m, Math.round(s.monthlyUsd * 1000)))) {
    await refund(env, m, day, "");
    return { ok: false, error: `This run would pass this month's limit of $${s.monthlyUsd.toFixed(2)}.` };
  }
  return { ok: true, mills: m, day, month };
}

export async function refund(env: Env, m: number, day: string, month: string): Promise<void> {
  const id = await masterId(env);
  for (const p of [day, month].filter(Boolean)) {
    await env.DB.prepare("UPDATE usage_counters SET count = MAX(count - ?, 0) WHERE company_id = ? AND feature = ? AND period = ?").bind(m, id, SPEND, p).run();
  }
}

/* ---------------------------------------------------------------- jobs and library */

export interface Job {
  id: string;
  model: string;
  kind: Kind;
  prompt: string;
  statusUrl: string;
  responseUrl: string;
  mills: number;
  rough: boolean;
  day: string;
  month: string;
  by: string;
  at: string;
  state: "queued" | "running" | "saving" | "done" | "failed";
  position?: number;
  error?: string;
  items: string[];
  tries: number;
  savingSince?: string;
}

export interface Item {
  id: string;
  type: "image" | "video" | "audio";
  mime: string;
  r2: string;
  bytes: number;
  model: string;
  kind: Kind;
  prompt: string;
  usd: number;
  rough: boolean;
  by: string;
  at: string;
  fav: boolean;
  public: boolean;
  key: string; // secret part of the private link (also how fal fetches a library image for image-to-video)
  jobId: string;
}

const QUEUE_RE = /^https:\/\/queue\.fal\.run\/[A-Za-z0-9._~/-]{3,300}$/;
export const isQueueUrl = (v: unknown): v is string => typeof v === "string" && QUEUE_RE.test(v) && !v.includes("..");
export const isFalMedia = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && /(^|\.)fal\.(media|run|ai)$/.test(u.hostname);
  } catch {
    return false;
  }
};

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/aac": "aac", "audio/mp4": "m4a" };
const BY_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", m4a: "audio/mp4" };
export const mediaType = (mime: string): Item["type"] | null => (mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : null);

/** Every media file in a fal result (images[], image, video, audio, audio_file...), at most 4. */
export function mediaIn(result: any): { url: string; mime: string }[] {
  const out: { url: string; mime: string }[] = [];
  const seen = new Set<string>();
  const visit = (v: any, depth: number) => {
    if (!v || depth > 3 || out.length >= 4) return;
    if (Array.isArray(v)) return v.slice(0, 8).forEach((x) => visit(x, depth + 1));
    if (typeof v !== "object") return;
    if (typeof v.url === "string" && isFalMedia(v.url) && !seen.has(v.url)) {
      const ext = (new URL(v.url).pathname.split(".").pop() ?? "").toLowerCase();
      const mime = String(v.content_type ?? "").split(";")[0] || BY_EXT[ext] || "";
      if (EXT[mime] || BY_EXT[ext]) {
        seen.add(v.url);
        out.push({ url: v.url, mime: EXT[mime] ? mime : BY_EXT[ext] });
      }
      return;
    }
    for (const k of Object.keys(v).slice(0, 30)) if (k !== "timings" && k !== "prompt") visit(v[k], depth + 1);
  };
  visit(result, 0);
  return out;
}

export function cleanItem(raw: any): Item | null {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || typeof raw.r2 !== "string") return null;
  return {
    id: raw.id,
    type: raw.type === "video" || raw.type === "audio" ? raw.type : "image",
    mime: String(raw.mime ?? ""),
    r2: raw.r2,
    bytes: Number(raw.bytes) || 0,
    model: String(raw.model ?? ""),
    kind: isKind(raw.kind) ? raw.kind : "image",
    prompt: String(raw.prompt ?? "").slice(0, 2000),
    usd: Number(raw.usd) || 0,
    rough: raw.rough === true,
    by: String(raw.by ?? ""),
    at: String(raw.at ?? ""),
    fav: raw.fav === true,
    public: raw.public === true,
    key: typeof raw.key === "string" ? raw.key : "",
    jobId: String(raw.jobId ?? ""),
  };
}
export const readItem = (env: Env, id: string) => (/^[a-z0-9]{6,40}$/.test(id) ? readBlob(env, ITEM(id), cleanItem) : Promise.resolve(null));
const cleanJob = (raw: any): Job | null => (raw && typeof raw === "object" && typeof raw.id === "string" ? (raw as Job) : null);
const readJob = (env: Env, id: string) => (/^[a-z0-9]{6,40}$/.test(id) ? readBlob(env, JOB(id), cleanJob) : Promise.resolve(null));

export async function listItems(env: Env): Promise<Item[]> {
  const rows = await blobsWithPrefix(env, "sandbox:item:", 2000);
  return rows.map((r) => cleanItem(r.value)).filter((x): x is Item => !!x).sort((a, b) => b.at.localeCompare(a.at));
}

const newId = () => `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
const secret = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

/** Copies one fal media file into R2 and writes its library row. */
async function saveMedia(env: Env, job: Job, m: { url: string; mime: string }, usd: number, f: typeof fetch): Promise<string> {
  const r = await f(m.url);
  if (!r.ok || !r.body) throw new Error(`media fetch ${r.status}`);
  const type = (r.headers.get("content-type") ?? "").split(";")[0];
  const mime = EXT[type] ? type : m.mime;
  const kind = mediaType(mime);
  if (!kind) throw new Error("not media");
  const len = Number(r.headers.get("content-length") ?? "");
  const id = newId();
  const r2 = `sandbox/${job.month}/${id}.${EXT[mime]}`;
  let bytes: number;
  if (Number.isFinite(len) && len > 0) {
    if (len > 300 * 1024 * 1024) throw new Error("too large");
    await env.FILES!.put(r2, r.body, { httpMetadata: { contentType: mime } });
    bytes = len;
  } else {
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 80 * 1024 * 1024) throw new Error("too large");
    await env.FILES!.put(r2, buf, { httpMetadata: { contentType: mime } });
    bytes = buf.byteLength;
  }
  const item: Item = { id, type: kind, mime, r2, bytes, model: job.model, kind: job.kind, prompt: job.prompt, usd, rough: job.rough, by: job.by, at: new Date().toISOString(), fav: false, public: false, key: secret(), jobId: job.id };
  const note = { id, model: item.model, kind: item.kind, prompt: item.prompt, costUsd: usd, estimated: true, rough: item.rough, by: item.by, at: item.at, source: "fal.ai", aiMade: true };
  await env.FILES!.put(`sandbox/${job.month}/${id}.json`, JSON.stringify(note, null, 2), { httpMetadata: { contentType: "application/json" } });
  await writeBlob(env, ITEM(id), item);
  return id;
}

/** Checks a job with fal and, once done, saves the results. Safe to call from several tabs at once. */
export async function pollJob(env: Env, id: string, f: typeof fetch = fetch): Promise<Job | null> {
  let job = await readJob(env, id);
  if (!job || job.state === "done" || job.state === "failed") return job;
  const stale = job.state === "saving" && job.savingSince && Date.now() - Date.parse(job.savingSince) > 3 * 60 * 1000;
  if (job.state === "saving" && !stale) return job;
  const auth = { authorization: `Key ${env.FAL_KEY}` };
  const sr = await f(`${job.statusUrl}`, { headers: auth }).catch(() => null);
  if (!sr) return job;
  const st: any = await sr.json().catch(() => ({}));
  if (sr.status === 404 || (sr.ok && st.status === "COMPLETED" && st.error)) return finish(env, job, { state: "failed", error: String(st.error || "fal lost this job.").slice(0, 300) }, true);
  if (!sr.ok && sr.status !== 202) return job;
  if (st.status === "IN_QUEUE" || st.status === "IN_PROGRESS") {
    const next: Job = { ...job, state: st.status === "IN_QUEUE" ? "queued" : "running", position: Number.isInteger(st.queue_position) ? st.queue_position : undefined };
    if (next.state !== job.state || next.position !== job.position) await writeBlob(env, JOB(id), next);
    return next;
  }
  if (st.status !== "COMPLETED") return job;
  // Claim the save so two polls never save twice.
  const claimed = await updateBlob(env, JOB(id), cleanJob, (cur) => {
    if (!cur) return { error: "gone" };
    const curStale = cur.state === "saving" && cur.savingSince && Date.now() - Date.parse(cur.savingSince) > 3 * 60 * 1000;
    if (cur.state === "done" || cur.state === "failed" || (cur.state === "saving" && !curStale)) return { error: "taken" };
    return { value: { ...cur, state: "saving" as const, savingSince: new Date().toISOString() } };
  });
  if (!claimed.ok) return readJob(env, id);
  job = claimed.value!;
  const rr = await f(job.responseUrl, { headers: auth }).catch(() => null);
  const res: any = rr ? await rr.json().catch(() => null) : null;
  if (!rr || !rr.ok) {
    const msg = String(res?.detail?.[0]?.msg ?? res?.detail ?? res?.error ?? `fal answered ${rr?.status ?? "nothing"}`).slice(0, 300);
    // A 4xx from the result means fal rejected the input: nothing was made, so the money comes back.
    if (rr && rr.status >= 400 && rr.status < 500) return finish(env, job, { state: "failed", error: msg }, true);
    return finish(env, job, { state: "running", tries: job.tries + 1 }, false);
  }
  const media = mediaIn(res);
  if (!media.length) return finish(env, job, { state: "failed", error: "fal finished but sent no image, video or sound." }, false);
  try {
    const usdEach = job.mills / 1000 / media.length;
    const ids: string[] = [];
    for (const m of media) ids.push(await saveMedia(env, job, m, Math.round(usdEach * 1000) / 1000, f));
    return finish(env, job, { state: "done", items: ids }, false);
  } catch (err) {
    console.error("sandbox save failed", String(err));
    if (job.tries >= 3) return finish(env, job, { state: "failed", error: "Made, but it could not be saved. Try again later." }, false);
    return finish(env, job, { state: "running", tries: job.tries + 1 }, false);
  }
}

async function finish(env: Env, job: Job, patch: Partial<Job>, giveBack: boolean): Promise<Job> {
  const next: Job = { ...job, ...patch, savingSince: undefined };
  await writeBlob(env, JOB(job.id), next);
  if (giveBack && job.mills) await refund(env, job.mills, job.day, job.month);
  return next;
}

/* ---------------------------------------------------------------- starter prompts */

export const TEMPLATES: { id: string; title: string; kind: Kind; ratio: string; duration?: string; prompt: string }[] = [
  { id: "before-after", title: "Before and after wall", kind: "image", ratio: "16:9", prompt: "Split view of the same living room wall: the left half has faded, scuffed beige paint, the right half is freshly painted deep navy with a crisp clean line between them. Natural daylight, realistic interior photography, wide shot." },
  { id: "painter-at-work", title: "Painter at work (no faces)", kind: "image", ratio: "4:5", prompt: "Over-the-shoulder view of a house painter rolling warm white paint onto a living room wall, seen from behind so the face is not visible, drop cloth and blue tape, bright room, realistic photo." },
  { id: "color-reveal", title: "Color wall reveal (video)", kind: "video", ratio: "9:16", duration: "5", prompt: "Slow camera push toward a bedroom wall while painter's tape is peeled away to reveal a sharp sage-green accent wall, soft morning light, realistic, smooth motion." },
  { id: "mockup", title: "App mock-up on a phone", kind: "image", ratio: "16:9", prompt: "A modern smartphone lying on a clean wooden workbench next to a paint can and a brush. The phone screen shows a simple, blank app screen in navy and orange. Shallow depth of field, product photography." },
  { id: "promo-10s", title: "10-second vertical promo", kind: "video", ratio: "9:16", duration: "10", prompt: "Vertical promo clip: a freshly painted Texas home exterior at golden hour, the camera glides along clean white trim, then a close-up of a roller finishing a wall in one smooth stroke. Upbeat, bright, realistic." },
  { id: "thumbnail", title: "Help video thumbnail", kind: "image", ratio: "16:9", prompt: "Clean bright background with a laptop and a paint roller on the right side, large empty space on the left for a title to be added later, navy and orange accents, soft even light." },
  { id: "music", title: "Background music for a promo", kind: "audio", ratio: "", duration: "30", prompt: "Upbeat, friendly acoustic background music for a 30-second home improvement promo. Warm guitar and light percussion, no vocals." },
];

/* ---------------------------------------------------------------- HTTP */

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const notFound = () => json({ error: "Not found." }, 404);

async function gate(env: Env, request: Request, what: "see" | "change"): Promise<AdminActor | Response> {
  const a = await adminActor(env, request);
  if (!a || !can(a.role, "content", "see")) return notFound();
  if (what === "change" && !can(a.role, "content", "change")) return json({ error: "Your role can look but not make or change sandbox media." }, 403);
  return a;
}

/** GET: settings, money spent, starter prompts, open jobs. POST {settings}: owner saves limits and the on/off switch. */
export async function handleSandbox(request: Request, env: Env): Promise<Response> {
  const a = await gate(env, request, "see");
  if (a instanceof Response) return a;
  if (request.method === "GET") {
    const [settings, money, jobs] = await Promise.all([loadSettings(env), spent(env), blobsWithPrefix(env, "sandbox:job:", 300)]);
    const open = jobs.map((r) => cleanJob(r.value)).filter((j): j is Job => !!j && j.state !== "done" && j.state !== "failed" && Date.now() - Date.parse(j.at) < 6 * 3600 * 1000);
    return json({ settings, spent: money, falOn: !!env.FAL_KEY, filesOn: !!env.FILES, canChange: can(a.role, "content", "change"), isOwner: a.role === "owner", templates: TEMPLATES, jobs: open.map(publicJob), safetyTail: SAFETY_TAIL });
  }
  if (request.method !== "POST") return notFound();
  if (a.role !== "owner") return json({ error: "Only the owner can change the sandbox limits." }, 403);
  const b: any = await request.json().catch(() => null);
  const s = cleanSettings(b?.settings);
  await writeBlob(env, SB_SETTINGS, s);
  await logAudit(env, a, "sandbox.settings", { detail: s });
  return json({ ok: true, settings: s });
}

/** GET ?kind=&q= : models fal lists for that kind, with prices. */
export async function handleSandboxModels(request: Request, env: Env): Promise<Response> {
  const a = await gate(env, request, "see");
  if (a instanceof Response) return a;
  const u = new URL(request.url);
  const kind = u.searchParams.get("kind");
  if (!isKind(kind)) return json({ error: "Pick image, video, image to video or audio." }, 400);
  const q = (u.searchParams.get("q") ?? "").replace(/[^\w .-]/g, "").trim();
  return json({ models: await listModels(env, kind, q) });
}

/** GET ?id= : one model's settings and price. */
export async function handleSandboxModel(request: Request, env: Env): Promise<Response> {
  const a = await gate(env, request, "see");
  if (a instanceof Response) return a;
  const info = await modelInfo(env, new URL(request.url).searchParams.get("id") ?? "");
  return info ? json({ model: info }) : json({ error: "fal does not list that model (check the id)." }, 404);
}

const publicJob = (j: Job) => ({ id: j.id, model: j.model, kind: j.kind, prompt: j.prompt, state: j.state, position: j.position, error: j.error, items: j.items, at: j.at, by: j.by, usd: j.mills / 1000, rough: j.rough });

/** POST {model, kind, prompt, values, helper, quote?, confirmRough?}: a price check (quote) or a real run. */
export async function handleSandboxRun(request: Request, env: Env, f: typeof fetch = fetch): Promise<Response> {
  const a = await gate(env, request, "change");
  if (a instanceof Response) return a;
  if (request.method !== "POST") return notFound();
  const b: any = await request.json().catch(() => null);
  const s = await loadSettings(env);
  if (!env.FAL_KEY) return json({ error: "The fal.ai key (FAL_KEY) is not set in Cloudflare." }, 400);
  if (!isKind(b?.kind)) return json({ error: "Pick what to make." }, 400);
  const info = await modelInfo(env, b?.model, f);
  if (!info) return json({ error: "fal does not list that model (check the id)." }, 400);
  const pc = checkPrompt(b?.prompt);
  if (!pc.ok) return json({ error: pc.error }, 400);
  const built = buildInput(info.fields, b?.values, finalPrompt(pc.prompt, b?.helper !== false, b.kind));
  if (!built.ok) return json({ error: built.error }, 400);
  const miss = missingRequired(info.required, built.input);
  if (miss.length) return json({ error: `This model needs: ${miss.join(", ")}.` }, 400);
  const est = estimate(info.price, built.input, s.perRunUsd);
  const money = await spent(env);
  const over = est.usd > s.perRunUsd + 1e-9 ? `About $${est.usd.toFixed(3)} is above your per-run limit of $${s.perRunUsd.toFixed(2)}.` : "";
  if (b?.quote) return json({ estimate: est, spent: money, settings: s, blocked: over || (!s.enabled ? "The sandbox is off. The owner turns it on in Limits." : ""), input: built.input });
  if (!s.enabled) return json({ error: "The sandbox is off. The owner turns it on in Limits." }, 400);
  if (!env.FILES) return json({ error: "File storage (R2) is not connected." }, 400);
  if (over) return json({ error: over }, 400);
  if (est.rough && b?.confirmRough !== true) return json({ error: "Confirm the rough price first.", needConfirm: true, estimate: est }, 400);
  const held = await reserve(env, s, est.usd);
  if (!held.ok) return json({ error: held.error }, 400);
  let sub: any = null;
  try {
    const r = await f(`https://queue.fal.run/${info.id}`, { method: "POST", headers: { authorization: `Key ${env.FAL_KEY}`, "content-type": "application/json" }, body: JSON.stringify(built.input) });
    sub = await r.json().catch(() => null);
    if (!r.ok) {
      await refund(env, held.mills, held.day, held.month);
      const detail = Array.isArray(sub?.detail) ? sub.detail.map((d: any) => d?.msg).filter(Boolean).join("; ") : sub?.detail;
      return json({ error: `fal refused the run: ${String(detail || r.status).slice(0, 200)}` }, 400);
    }
  } catch {
    await refund(env, held.mills, held.day, held.month);
    return json({ error: "Could not reach fal.ai. Nothing was charged." }, 502);
  }
  if (!isQueueUrl(sub?.status_url) || !isQueueUrl(sub?.response_url)) {
    await refund(env, held.mills, held.day, held.month);
    return json({ error: "fal sent an unexpected answer. Nothing was counted." }, 502);
  }
  const job: Job = { id: newId(), model: info.id, kind: b.kind, prompt: pc.prompt, statusUrl: sub.status_url, responseUrl: sub.response_url, mills: held.mills, rough: est.rough, day: held.day, month: held.month, by: a.email, at: new Date().toISOString(), state: "queued", items: [], tries: 0 };
  await writeBlob(env, JOB(job.id), job);
  await logAudit(env, a, "sandbox.run", { detail: { job: job.id, model: info.id, kind: b.kind, usd: est.usd, rough: est.rough } });
  return json({ ok: true, job: publicJob(job), spent: await spent(env) });
}

/** GET ?id= : checks a job (and saves its results once fal is done). */
export async function handleSandboxJob(request: Request, env: Env, f: typeof fetch = fetch): Promise<Response> {
  const a = await gate(env, request, "see");
  if (a instanceof Response) return a;
  const job = await pollJob(env, new URL(request.url).searchParams.get("id") ?? "", f);
  return job ? json({ job: publicJob(job) }) : notFound();
}

const itemView = (i: Item) => ({ ...i, key: undefined, r2: undefined, src: `/api/admin/sandbox/file?id=${i.id}`, privateLink: `/media/ai/${i.id}?k=${i.key}`, publicLink: i.public ? `/media/ai/${i.id}` : "" });

/** GET: the library. */
export async function handleSandboxLibrary(request: Request, env: Env): Promise<Response> {
  const a = await gate(env, request, "see");
  if (a instanceof Response) return a;
  return json({ items: (await listItems(env)).map(itemView), isOwner: a.role === "owner", canChange: can(a.role, "content", "change") });
}

/** POST {id, fav} | {id, public} | {id, useIn: slug} | {id, remove: true} (owner). */
export async function handleSandboxItem(request: Request, env: Env): Promise<Response> {
  const a = await gate(env, request, "change");
  if (a instanceof Response) return a;
  if (request.method !== "POST") return notFound();
  const b: any = await request.json().catch(() => null);
  const id = typeof b?.id === "string" ? b.id : "";
  const item = await readItem(env, id);
  if (!item) return json({ error: "That item is gone." }, 404);
  if (typeof b.useIn === "string" && item.type === "audio") return json({ error: "Landing pages show images and videos only." }, 400);
  if (b.remove) {
    if (a.role !== "owner") return json({ error: "Only the owner can delete sandbox media." }, 403);
    for (const l of (await listLandings(env)).filter((x) => x.media === item.id)) await setLandingMedia(env, l.slug, null);
    await removeItem(env, item);
    await logAudit(env, a, "sandbox.delete", { detail: { id, model: item.model } });
    return json({ ok: true });
  }
  const usedBy = (await listLandings(env)).filter((l) => l.media === item.id);
  if (b.public === false && usedBy.length) return json({ error: `Landing page "${usedBy[0].name}" shows this. Take it off that page first.` }, 400);
  if (typeof b.useIn === "string" && !(await setLandingMedia(env, b.useIn, item))) return json({ error: "That landing page was not found." }, 404);
  const r = await updateBlob(env, ITEM(id), cleanItem, (cur) => {
    if (!cur) return { error: "That item is gone." };
    const next = { ...cur };
    if (typeof b.fav === "boolean") next.fav = b.fav;
    if (typeof b.public === "boolean") next.public = b.public;
    if (typeof b.useIn === "string") next.public = true; // the person chose to show it on a page
    return { value: next };
  });
  if (!r.ok) return json({ error: r.error }, 400);
  if (typeof b.useIn === "string") await logAudit(env, a, "sandbox.use_in_landing", { detail: { id, slug: b.useIn } });
  else if (typeof b.public === "boolean") await logAudit(env, a, b.public ? "sandbox.publish" : "sandbox.unpublish", { detail: { id } });
  return json({ ok: true, item: itemView(r.value!) });
}

async function removeItem(env: Env, item: Item) {
  if (env.FILES) {
    await env.FILES.delete(item.r2).catch(() => {});
    await env.FILES.delete(item.r2.replace(/\.[a-z0-9]+$/, ".json")).catch(() => {});
  }
  await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(ITEM(item.id)).run();
}

/** Streams a file from R2, with byte ranges so videos can be scrubbed. */
async function serve(env: Env, request: Request, item: Item, cache: string, download: boolean): Promise<Response> {
  if (!env.FILES) return new Response("Not found.", { status: 404 });
  const range = request.headers.get("range");
  const m = range?.match(/^bytes=(\d+)-(\d*)$/);
  const headers = new Headers({ "content-type": item.mime, "cache-control": cache, "accept-ranges": "bytes", "x-robots-tag": "noindex", "x-ai-generated": "true" });
  if (download) headers.set("content-disposition", `attachment; filename="paintersmax-ai-${item.id}.${item.r2.split(".").pop()}"`);
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : undefined;
    if (end != null && end < start) return new Response("Bad range.", { status: 416 });
    const obj = await env.FILES.get(item.r2, { range: end != null ? { offset: start, length: end - start + 1 } : { offset: start } });
    if (!obj) return new Response("Not found.", { status: 404 });
    const total = obj.size;
    const last = end != null ? Math.min(end, total - 1) : total - 1;
    headers.set("content-range", `bytes ${start}-${last}/${total}`);
    headers.set("content-length", String(last - start + 1));
    return new Response((obj as any).body, { status: 206, headers });
  }
  const obj = await env.FILES.get(item.r2);
  if (!obj) return new Response("Not found.", { status: 404 });
  headers.set("content-length", String(obj.size));
  return new Response((obj as any).body, { headers });
}

/** GET ?id=&dl=1 : the file, for admins. */
export async function handleSandboxFile(request: Request, env: Env): Promise<Response> {
  const a = await gate(env, request, "see");
  if (a instanceof Response) return a;
  const u = new URL(request.url);
  const item = await readItem(env, u.searchParams.get("id") ?? "");
  return item ? serve(env, request, item, "private, max-age=300", u.searchParams.get("dl") === "1") : notFound();
}

/** GET /media/ai/<id>: public only once someone made it public; ?k=<secret> opens a private item (used by fal for image-to-video). */
export async function handlePublicMedia(request: Request, env: Env): Promise<Response> {
  const u = new URL(request.url);
  const id = u.pathname.replace(/^\/media\/ai\//, "").replace(/\.[a-z0-9]+$/, "");
  const item = await readItem(env, id);
  const k = u.searchParams.get("k") ?? "";
  const keyOk = !!item?.key && k.length === item.key.length && k === item.key;
  if (!item || (!item.public && !keyOk)) return new Response("Not found.", { status: 404, headers: { "content-type": "text/plain" } });
  return serve(env, request, item, item.public && !k ? "public, max-age=86400" : "private, no-store", false);
}

/* ---------------------------------------------------------------- daily clean-up */

export function expired(item: Item, keepDays: number, now = Date.now()): boolean {
  if (item.fav || item.public) return false;
  const t = Date.parse(item.at);
  return Number.isFinite(t) && now - t > keepDays * 86400 * 1000;
}

/** Deletes library items past the keep window (never favorites or public ones) and old job notes. */
export async function sandboxCleanup(env: Env, now = Date.now()): Promise<number> {
  const s = await loadSettings(env);
  let n = 0;
  for (const it of await listItems(env)) {
    if (n >= 200) break;
    if (expired(it, s.keepDays, now)) {
      await removeItem(env, it);
      n++;
    }
  }
  const jobs = await blobsWithPrefix(env, "sandbox:job:", 2000);
  for (const r of jobs) {
    const j = cleanJob(r.value);
    if (j && now - Date.parse(j.at) > 7 * 86400 * 1000) await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(r.key).run();
  }
  return n;
}

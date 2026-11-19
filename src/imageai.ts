/**
 * The website image tool (fal.ai). A painter picks a photo space, and the tool makes a picture for it from the
 * template's own prompt. Rules (Rogelio, 2026-11-16 and 17):
 *  - The tool is OFF until admin turns it on (settings below). The fal.ai key is the Cloudflare secret FAL_KEY.
 *  - It costs AI credits: a draft (cheap model) 1, a quality image 3 (CREDIT_COST). A failed call gives the credits back.
 *  - A client may make at most `dailyCap` images a day (default 10).
 *  - The prompt comes from the template (never free text), plus a short optional note. No people are asked for.
 *  - Results are saved as site photos marked `ai`, and never described as the client's own work.
 *  - Before and after photo spaces are never made with AI.
 */
import type { ImageSlotDef } from "./sitetheme.ts";
import type { Env } from "./types.ts";

export const IMAGE_AI_KEY = "imageai:settings";
export const NO_AI_SLOTS = ["BA-BEFORE", "BA-AFTER"];

export interface ImageAiSettings {
  enabled: boolean;
  dailyCap: number;
  draftModel: string;
  qualityModel: string;
}
export const DEFAULT_IMAGE_AI: ImageAiSettings = { enabled: false, dailyCap: 10, draftModel: "fal-ai/flux/schnell", qualityModel: "fal-ai/nano-banana-2" };

const MODEL_RE = /^fal-ai\/[a-z0-9][a-z0-9./-]{1,60}$/;

export function readImageAiSettings(raw: unknown): ImageAiSettings {
  let j: any = raw;
  try {
    if (typeof raw === "string") j = JSON.parse(raw);
  } catch {
    j = null;
  }
  const o = j && typeof j === "object" ? j : {};
  const cap = Number(o.dailyCap);
  return {
    enabled: o.enabled === true,
    dailyCap: Number.isInteger(cap) ? Math.max(1, Math.min(100, cap)) : DEFAULT_IMAGE_AI.dailyCap,
    draftModel: MODEL_RE.test(String(o.draftModel ?? "")) ? String(o.draftModel) : DEFAULT_IMAGE_AI.draftModel,
    qualityModel: MODEL_RE.test(String(o.qualityModel ?? "")) ? String(o.qualityModel) : DEFAULT_IMAGE_AI.qualityModel,
  };
}

export async function loadImageAiSettings(env: Env): Promise<ImageAiSettings> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(IMAGE_AI_KEY).first<{ value: string }>();
  return readImageAiSettings(row?.value);
}

export async function saveImageAiSettings(env: Env, s: ImageAiSettings) {
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(IMAGE_AI_KEY, JSON.stringify(s)).run();
}

/** The prompt for a photo space: the template's own prompt (one of its four), plus a short optional note. */
export function promptFor(sl: ImageSlotDef, variant: number, note: unknown): string {
  const arr = sl.prompts?.length ? sl.prompts : [sl.prompt];
  const base = arr[((Math.floor(variant) % arr.length) + arr.length) % arr.length];
  const n = typeof note === "string" ? note.replace(/[\r\n<>]/g, " ").trim().slice(0, 100) : "";
  return n ? `${base} Extra detail: ${n}.` : base;
}

const RATIOS = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"];

/** The input for the model. The cheap draft model takes pixel sizes; the quality model takes a ratio. */
export function modelInput(model: string, sl: ImageSlotDef, prompt: string): Record<string, unknown> {
  if (model.includes("flux")) {
    const k = 1024 / Math.max(sl.w, sl.h);
    const r16 = (v: number) => Math.max(256, Math.min(1536, Math.round((v * k) / 16) * 16));
    return { prompt, image_size: { width: r16(sl.w), height: r16(sl.h) }, num_images: 1, output_format: "jpeg", enable_safety_checker: true };
  }
  return { prompt, aspect_ratio: RATIOS.includes(sl.ratio) ? sl.ratio : "auto", num_images: 1, output_format: "jpeg" };
}

export interface FalResult { bytes: ArrayBuffer; type: string; w: number; h: number }

/** One call to fal.ai (synchronous endpoint). Returns null on any failure so the caller can refund. */
export async function callFal(env: Env, model: string, input: Record<string, unknown>, f: typeof fetch = fetch): Promise<FalResult | null> {
  if (!env.FAL_KEY) return null;
  try {
    const r = await f(`https://fal.run/${model}`, { method: "POST", headers: { authorization: `Key ${env.FAL_KEY}`, "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const im = j?.images?.[0];
    const u = typeof im?.url === "string" ? new URL(im.url) : null;
    // Only fal's own media hosts; the address comes from their answer, so check it before fetching.
    if (!u || u.protocol !== "https:" || !/(^|\.)fal\.(media|run|ai)$/.test(u.hostname)) return null;
    const img = await f(u.toString());
    if (!img.ok) return null;
    const type = (img.headers.get("content-type") ?? "").split(";")[0];
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return null;
    const bytes = await img.arrayBuffer();
    if (bytes.byteLength < 1000 || bytes.byteLength > 8 * 1024 * 1024) return null;
    return { bytes, type, w: Math.round(Number(im.width) || 0), h: Math.round(Number(im.height) || 0) };
  } catch {
    return null;
  }
}

/** Adds one to today's count for this client if it stays within the cap. Returns false when the cap is reached. */
export async function bumpDaily(env: Env, companyId: number, cap: number, day: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, 'site_image:day', ?, 1)
     ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + 1 WHERE count + 1 <= ? RETURNING count`,
  ).bind(companyId, day, cap).first<{ count: number }>();
  return !!row;
}

export async function unbumpDaily(env: Env, companyId: number, day: string) {
  await env.DB.prepare("UPDATE usage_counters SET count = MAX(count - 1, 0) WHERE company_id = ? AND feature = 'site_image:day' AND period = ?").bind(companyId, day).run();
}

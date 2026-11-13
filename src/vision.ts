import type { Env } from "./types.ts";

/**
 * One photo plus a question, answered by whichever AI provider works. Gemini goes first (cheapest), then OpenAI, then Anthropic.
 * Receipt reading and photo analysis both use this, so one provider having a bad day (quota, overload, a model that
 * refuses a setting) no longer breaks the feature. When every provider fails, `why` lists the status codes so the
 * problem can be found without guessing. Status codes and short provider messages only: never keys, never the photo.
 */

export type VisionProvider = "gemini" | "openai" | "anthropic";
export interface VisionIn {
  system: string;
  user: string;
  mime: string;
  data: string; // base64
  maxTokens?: number;
}
export type VisionOut = { ok: true; text: string; provider: VisionProvider; tried: string[] } | { ok: false; why: string; tried: string[] };

const hasKey = (env: Env, p: VisionProvider) => !!(p === "gemini" ? env.GEMINI_API_KEY : p === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY);

/** Short, safe description of a failed provider reply (status plus the first words of its message). */
async function failure(p: string, r: Response): Promise<string> {
  let msg = "";
  try {
    const j = (await r.json()) as any;
    msg = String(j?.error?.message ?? j?.error ?? "").replace(/\s+/g, " ").slice(0, 120);
  } catch {
    msg = "";
  }
  console.error("vision provider failed", p, r.status, msg);
  return `${p} ${r.status}${msg ? ` (${msg})` : ""}`;
}

async function viaGemini(env: Env, i: VisionIn, json: boolean): Promise<{ text: string } | { fail: string }> {
  const model = env.MODEL_GEMINI ?? "gemini-2.5-flash";
  const call = (thinkingOff: boolean) =>
    fetch(`${env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: i.system }] },
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: i.mime, data: i.data } }, { text: i.user }] }],
        generationConfig: { ...(json ? { responseMimeType: "application/json" } : {}), maxOutputTokens: i.maxTokens ?? 1200, ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      }),
    });
  let r = await call(true);
  // Some Gemini models refuse "thinking off". Try again without that setting before giving up.
  if (r.status === 400) r = await call(false);
  if (!r.ok) return { fail: await failure("gemini", r) };
  const j = (await r.json()) as any;
  const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  return text.trim() ? { text } : { fail: `gemini empty (${j.candidates?.[0]?.finishReason ?? j.promptFeedback?.blockReason ?? "no text"})` };
}

async function viaOpenAI(env: Env, i: VisionIn, json: boolean): Promise<{ text: string } | { fail: string }> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.MODEL_OPENAI ?? "gpt-4.1-mini",
      max_tokens: i.maxTokens ?? 1200,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: i.system },
        { role: "user", content: [{ type: "text", text: i.user }, { type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }] },
      ],
    }),
  });
  if (!r.ok) return { fail: await failure("openai", r) };
  const j = (await r.json()) as any;
  const text = j.choices?.[0]?.message?.content ?? "";
  return String(text).trim() ? { text } : { fail: "openai empty" };
}

async function viaAnthropic(env: Env, i: VisionIn): Promise<{ text: string } | { fail: string }> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: env.MODEL_ANTHROPIC ?? "claude-sonnet-5-5",
      max_tokens: i.maxTokens ?? 1200,
      system: i.system,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } }, { type: "text", text: i.user }] }],
    }),
  });
  if (!r.ok) return { fail: await failure("anthropic", r) };
  const j = (await r.json()) as any;
  const text = j.content?.map((b: any) => b.text ?? "").join("") ?? "";
  return text.trim() ? { text } : { fail: "anthropic empty" };
}

/** Asks about one photo. `json: true` asks for a JSON reply. */
export async function visionAsk(env: Env, i: VisionIn, opts: { json?: boolean; prefer?: VisionProvider[] } = {}): Promise<VisionOut> {
  const tried: string[] = [];
  const json = opts.json !== false;
  for (const p of opts.prefer ?? (["gemini", "openai", "anthropic"] as VisionProvider[])) {
    if (!hasKey(env, p)) continue;
    try {
      const out = p === "gemini" ? await viaGemini(env, i, json) : p === "openai" ? await viaOpenAI(env, i, json) : await viaAnthropic(env, i);
      if ("text" in out) return { ok: true, text: out.text, provider: p, tried };
      tried.push(out.fail);
    } catch (err) {
      console.error("vision provider threw", p, String(err));
      tried.push(`${p} error`);
    }
  }
  return { ok: false, why: tried.length ? tried.join("; ") : "no AI key is set", tried };
}

/** Pulls the first JSON object out of a model reply, even when it is wrapped in code fences or chatter. */
export function parseJsonLoose(text: string): any | null {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through
  }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** A friendly line for the painter, from the technical reasons. Never blames the painter. */
export function friendlyVisionError(why: string, what: string): string {
  if (/no AI key/.test(why)) return `${what} is not switched on yet. Please tell support.`;
  if (/ 429/.test(why)) return `${what} is busy right now (the AI service is rate limiting us). Please try again in a minute.`;
  if (/ 40[13]/.test(why)) return `${what} could not sign in to the AI service. Please tell support.`;
  return `${what} did not work this time. Please try again in a minute.`;
}

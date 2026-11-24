import { getSessionUser } from "./auth.ts";
import { askSystem, buildJobContext } from "./assistant.ts";
import { consume, effectivePlan, refund } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Voice typing engine for the mic screen.
 *  POST /api/voice/session -> { engine: "gemini", token, model, expiresAt }  or  { engine: "device", reason }
 * Paid plans (the free trial counts as Basic) use Gemini Transcribe Live: the browser talks to Google with a one-use token that
 * this Worker mints, so the Gemini key never reaches a phone. The Free plan, a missing key, a failed token, or a client who has
 * run out of AI credits all answer "device": the phone's built-in speech, which costs nothing.
 * One voice session counts as one assistant use (monthly amount first, then credits), and is refunded if the token fails.
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const DEFAULT_TRANSCRIBE_MODEL = "gemini-3.5-transcribe-live";

/** Free plan and missing key use the phone's speech; everything else may use Gemini. */
export function chooseEngine(plan: string, hasKey: boolean): "gemini" | "device" {
  return hasKey && plan !== "free" ? "gemini" : "device";
}

/**
 * Live voice chat for Ask (Gemini Live). The model name is a setting because Google renames live models often.
 * GUESS until tested with the real key: set GEMINI_LIVE_MODEL in Cloudflare if Google lists a different name.
 */
export const DEFAULT_LIVE_MODEL = "gemini-3.8-flash-live";
/** Longest live conversation, in minutes. Keeps the cost of one session small (about $0.02 a minute at list price). */
export const LIVE_MAX_MINUTES = 5;
/** Live voice counts as this many assistant uses, because audio both ways costs more than a typed answer. */
export const LIVE_USES = 3;

async function mintToken(env: Env, body: Record<string, unknown>): Promise<string | null> {
  const now = Date.now();
  const res = await fetch(`${env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com"}/v1alpha/auth_tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
    body: JSON.stringify({ uses: 1, expireTime: new Date(now + (LIVE_MAX_MINUTES + 1) * 60 * 1000).toISOString(), newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(), ...body }),
  });
  const j = (await res.json().catch(() => null)) as { name?: string } | null;
  if (!res.ok || !j?.name) {
    console.error("live token failed", res.status);
    return null;
  }
  return j.name;
}

/** POST /api/voice/session {mode:"chat", page, jobId, language} -> { engine: "live", token, model, system?, maxMinutes } or { engine: "none", reason } */
async function liveChat(request: Request, env: Env, user: { companyId: number }, company: { id: number; plan: string; createdAt?: string }, b: any): Promise<Response> {
  if (chooseEngine(effectivePlan(company), !!env.GEMINI_API_KEY) === "device") return json({ engine: "none", reason: "plan" });
  for (let i = 0; i < LIVE_USES; i++) {
    const used = await consume(env, company, "ai_assistant");
    if (!used.allowed) {
      for (let k = 0; k < i; k++) await refund(env, company, "ai_assistant");
      return json({ engine: "none", reason: used.reason === "kill_switch" ? "paused" : "credits" });
    }
  }
  const jobId = Number(b?.jobId);
  const context = Number.isInteger(jobId) && jobId > 0 ? await buildJobContext(env, user.companyId, jobId) : null;
  const language = b?.language === "es" ? "es" : "en";
  const page = typeof b?.page === "string" ? b.page.slice(0, 60) : "/";
  const system = (await askSystem(env, { context, history: [], question: typeof b?.topic === "string" ? b.topic.slice(0, 200) : "", language, page, companyId: company.id })) +
    "\n\nThis is a live voice conversation. Speak in short, natural sentences, one idea at a time. Never read out web addresses or long lists.";
  const model = (env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL).replace(/^models\//, "");
  const setup = { model: `models/${model}`, generationConfig: { responseModalities: ["AUDIO"] }, systemInstruction: { parts: [{ text: system }] }, inputAudioTranscription: {}, outputAudioTranscription: {} };
  // First try a token locked to our model and instructions, so a browser cannot change them. If Google refuses that form,
  // fall back to a plain one-use token and let the browser send the same setup.
  let token = await mintToken(env, { bidiGenerateContentSetup: setup });
  let locked = !!token;
  if (!token) token = await mintToken(env, {});
  if (!token) {
    for (let i = 0; i < LIVE_USES; i++) await refund(env, company, "ai_assistant");
    return json({ engine: "none", reason: "error" });
  }
  return json({ engine: "live", token, model, setup: locked ? { model: setup.model } : setup, maxMinutes: LIVE_MAX_MINUTES });
}

export async function handleVoiceSession(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const company = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt?: string }>();
  if (!company) return json({ error: "Not found." }, 404);
  let b: any = null;
  try {
    b = await request.clone().json();
  } catch {
    b = null;
  }
  if (b?.mode === "chat") return liveChat(request, env, user, company, b);
  if (chooseEngine(effectivePlan(company), !!env.GEMINI_API_KEY) === "device") return json({ engine: "device", reason: "plan" });
  const used = await consume(env, company, "ai_assistant");
  if (!used.allowed) return json({ engine: "device", reason: used.reason === "kill_switch" ? "paused" : "credits" });
  const model = (env.GEMINI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL).replace(/^models\//, "");
  try {
    const now = Date.now();
    const expire = new Date(now + 30 * 60 * 1000).toISOString();
    const res = await fetch(`${env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com"}/v1alpha/auth_tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
      body: JSON.stringify({ uses: 1, expireTime: expire, newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString() }),
    });
    const j = (await res.json().catch(() => null)) as { name?: string } | null;
    if (!res.ok || !j?.name) throw new Error(`token ${res.status}`);
    return json({ engine: "gemini", token: j.name, model, expiresAt: expire });
  } catch (err) {
    console.error("voice token failed", String(err));
    await refund(env, company, "ai_assistant");
    return json({ engine: "device", reason: "error" });
  }
}

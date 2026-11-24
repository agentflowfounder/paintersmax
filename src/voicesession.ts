import { getSessionUser } from "./auth.ts";
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

export async function handleVoiceSession(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const company = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt?: string }>();
  if (!company) return json({ error: "Not found." }, 404);
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

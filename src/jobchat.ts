import { getSessionUser } from "./auth.ts";
import { buildJobContext, completeEx, sanitizeHistory, SYSTEM_PROMPT, type Provider } from "./assistant.ts";
import { consume, refund, usageSummary, type Feature } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Job chat: one saved thread per job, visible only to the painter who owns the job (never to customers, never in the portal).
 * Each question picks "quick" (the fast model) or "detailed" (a stronger model that answers with a step-by-step plan).
 * Detailed answers have their own, smaller monthly allowance because they cost more. Keys stay on our server.
 * The thread is kept in app_settings (jobchat:<company>:<job>), newest 60 messages.
 */

export type Mode = "quick" | "detailed" | "deep";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  mode: Mode;
  at: string;
}

export const MAX_MESSAGES = 60;

export const DETAILED_PROMPT = [
  "The painter asked for a DETAILED answer. Explain the reasoning, compare the sensible options, and say which you would pick and why. Keep it practical and organized with short headings. Numbers are typical values the painter must verify.",
].join(" ");

export const DEEP_PROMPT = [
  "The painter asked for a DEEP step-by-step answer. Reply as a numbered, step-by-step plan:",
  "1) most likely cause or the key question to settle first, 2) what to check or test before starting, 3) tools and materials, 4) the steps in order,",
  "5) safety notes that apply, 6) how to confirm the fix worked and what to tell the customer.",
  "Be specific and practical. If it depends on something you cannot see, say what it depends on. Numbers are typical values the painter must verify.",
].join(" ");

const key = (companyId: number, jobId: number) => `jobchat:${companyId}:${jobId}`;

export const trimThread = (msgs: ChatMsg[]) => msgs.slice(-MAX_MESSAGES);

export function readThread(raw: string | null | undefined): ChatMsg[] {
  try {
    const j = raw ? JSON.parse(raw) : [];
    return Array.isArray(j)
      ? j
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map((m) => ({ role: m.role, content: String(m.content).slice(0, 6000), mode: m.mode === "detailed" ? "detailed" : m.mode === "deep" ? "deep" : "quick", at: String(m.at ?? "") }) as ChatMsg)
      : [];
  } catch {
    return [];
  }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function load(env: Env, companyId: number, jobId: number): Promise<ChatMsg[]> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key(companyId, jobId)).first<{ value: string }>();
  return readThread(r?.value);
}
async function save(env: Env, companyId: number, jobId: number, msgs: ChatMsg[]) {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key(companyId, jobId), JSON.stringify(trimThread(msgs))).run();
}

/** GET /api/jobchat?jobId=  |  POST {jobId, message, mode, language} or {jobId, action:"clear"} */
export async function handleJobChat(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const u = new URL(request.url);
  let b: any = {};
  if (request.method === "POST") {
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
  } else if (request.method !== "GET") return json({ error: "Not found." }, 404);
  const jobId = Number(request.method === "GET" ? u.searchParams.get("jobId") : b?.jobId);
  if (!Number.isInteger(jobId)) return json({ error: "Job not found." }, 404);
  const job = await env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").bind(jobId, user.companyId).first();
  if (!job) return json({ error: "Job not found." }, 404);
  const company = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt?: string }>();
  if (!company) return json({ error: "Not found." }, 404);

  const limits = async () => {
    const s = await usageSummary(env, company);
    const pick = (f: Feature) => s.features.find((x) => x.feature === f);
    return { quick: pick("ai_assistant"), detailed: pick("ai_detailed"), deep: pick("ai_deep") };
  };

  if (request.method === "GET") return json({ messages: await load(env, user.companyId, jobId), limits: await limits() });

  if (b?.action === "clear") {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(key(user.companyId, jobId)).run();
    return json({ ok: true, messages: [] });
  }
  const question = typeof b?.message === "string" ? b.message.trim().slice(0, 2000) : "";
  if (!question) return json({ error: "Type a question first." }, 400);
  const mode: Mode = b?.mode === "detailed" ? "detailed" : b?.mode === "deep" ? "deep" : "quick";
  const feature: Feature = mode === "deep" ? "ai_deep" : mode === "detailed" ? "ai_detailed" : "ai_assistant";
  const used = await consume(env, company, feature);
  if (!used.allowed) {
    const msg = used.reason === "kill_switch" ? "The assistant is paused right now. Try again soon."
      : used.reason === "not_in_plan" ? (mode === "quick" ? "The assistant is not included in your plan." : "Detailed and deep answers are on the Starter plan and up.")
      : mode === "quick" ? "You have used this month's quick answers." : `You have used this month's ${mode} answers. Quick answers still work.`;
    return json({ error: msg, code: used.reason }, 429);
  }
  const context = await buildJobContext(env, user.companyId, jobId);
  const thread = await load(env, user.companyId, jobId);
  const es = b?.language === "es";
  const base = es ? `${SYSTEM_PROMPT}\n\nAlways answer in Spanish, even if the question is in English.` : SYSTEM_PROMPT;
  const system = `${base}${mode === "detailed" ? `\n\n${DETAILED_PROMPT}` : mode === "deep" ? `\n\n${DEEP_PROMPT}` : ""}${context ? `\n\n<job_data>\n${context}\n</job_data>` : ""}`;
  const prefer: Provider[] = mode === "deep" ? ["anthropic", "openai", "gemini"] : mode === "detailed" ? ["openai", "gemini", "anthropic"] : ["gemini", "openai", "anthropic"];
  const out = await completeEx(env, system, [...sanitizeHistory(thread.map((m) => ({ role: m.role, content: m.content }))), { role: "user", content: question }], { prefer, maxTokens: mode === "deep" ? 2000 : mode === "detailed" ? 1400 : 900 });
  if (!out) {
    await refund(env, company, feature);
    return json({ error: "The assistant could not answer right now. Please try again in a minute." }, 503);
  }
  const now = new Date().toISOString();
  thread.push({ role: "user", content: question, mode, at: now }, { role: "assistant", content: out.text.slice(0, 6000), mode, at: now });
  await save(env, user.companyId, jobId, thread);
  return json({ reply: out.text, mode, messages: trimThread(thread), limits: await limits() });
}

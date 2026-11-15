import { getSessionUser } from "./auth.ts";
import { sendLeadEmail } from "./email.ts";
import { blobsWithPrefix, str, updateBlob } from "./kv.ts";
import type { Env } from "./types.ts";

/**
 * Feedback box: a painter tells us about a bug, an idea or a question from their dashboard, and admin replies in the same thread.
 * One app_settings row per thread: fb:<companyId>:<threadId>. Admin lists all of them; a painter sees only their company's.
 */

export type FbKind = "bug" | "idea" | "question" | "other";
export const FB_KINDS: FbKind[] = ["bug", "idea", "question", "other"];
export type FbStatus = "new" | "answered" | "waiting" | "closed";

export interface FbMessage {
  from: "client" | "admin";
  by: string;
  at: string;
  text: string;
}
export interface FbThread {
  id: string;
  companyId: number;
  kind: FbKind;
  page: string;
  status: FbStatus; // new: nobody answered; answered: admin replied; waiting: client wrote again; closed
  messages: FbMessage[];
  createdAt: string;
  updatedAt: string;
  clientUnread: boolean;
}

const MAX_TEXT = 2000;
const MAX_MESSAGES = 40;
const PER_DAY = 10;
export const fbKey = (c: number, id: string) => `fb:${c}:${id}`;

export function readThread(raw: unknown): FbThread | null {
  const r = raw as any;
  if (!r || typeof r.id !== "string" || !/^[a-z0-9]{6,30}$/.test(r.id) || !Number.isInteger(r.companyId)) return null;
  const messages: FbMessage[] = Array.isArray(r.messages)
    ? r.messages.filter((m: any) => (m?.from === "client" || m?.from === "admin") && str(m?.text, MAX_TEXT)).map((m: any) => ({ from: m.from, by: str(m.by, 200), at: str(m.at, 30), text: str(m.text, MAX_TEXT) }))
    : [];
  if (!messages.length) return null;
  return {
    id: r.id,
    companyId: r.companyId,
    kind: FB_KINDS.includes(r.kind) ? r.kind : "other",
    page: str(r.page, 120),
    status: r.status === "answered" || r.status === "waiting" || r.status === "closed" ? r.status : "new",
    messages: messages.slice(-MAX_MESSAGES),
    createdAt: str(r.createdAt, 30),
    updatedAt: str(r.updatedAt, 30),
    clientUnread: r.clientUnread === true,
  };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function companyThreads(env: Env, c: number): Promise<FbThread[]> {
  const rows = await blobsWithPrefix(env, `fb:${c}:`, 500);
  return rows.map((r) => readThread(r.value)).filter((t): t is FbThread => !!t).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** What a painter sees: their threads, newest first. The page path is kept so we know where a bug happened. */
const forClient = (t: FbThread) => ({ id: t.id, kind: t.kind, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, unread: t.clientUnread, messages: t.messages.map((m) => ({ from: m.from, at: m.at, text: m.text })) });

/**
 * /api/feedback (signed in)
 *  GET              this company's threads (?unread=1 returns only the count of threads with a new reply)
 *  POST send        {kind, text, page}  starts a thread
 *  POST reply       {id, text}          adds to a thread (reopens it)
 *  POST read        {id}                marks admin replies as read
 */
export async function handleFeedback(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  if (request.method === "GET") {
    const list = await companyThreads(env, c);
    if (new URL(request.url).searchParams.get("unread") === "1") return json({ unread: list.filter((t) => t.clientUnread).length });
    return json({ threads: list.map(forClient) });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const now = new Date().toISOString();
  if (b?.action === "send") {
    const text = str(b.text, MAX_TEXT);
    if (text.length < 3) return json({ error: "Write a few words so we know what happened." }, 400);
    const day = now.slice(0, 10);
    const room = await env.DB.prepare(
      `INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, 'feedback:sent', ?, 1)
       ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + 1 WHERE count + 1 <= ? RETURNING count`,
    )
      .bind(c, day, PER_DAY)
      .first();
    if (!room) return json({ error: "Thanks for all the feedback today. Please send more tomorrow." }, 429);
    const id = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const t: FbThread = { id, companyId: c, kind: FB_KINDS.includes(b.kind) ? b.kind : "other", page: str(b.page, 120), status: "new", messages: [{ from: "client", by: user.email, at: now, text }], createdAt: now, updatedAt: now, clientUnread: false };
    await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind(fbKey(c, id), JSON.stringify(t)).run();
    await sendLeadEmail(env, env.NOTIFY_EMAIL, `New PaintersMax feedback (${t.kind}) from ${user.companyName}`, `${user.companyName} sent ${t.kind} feedback${t.page ? ` from ${t.page}` : ""}:\n\n${text}\n\nReply in Admin, Feedback tab: https://paintersmax.app/admin#feedback`).catch(() => {});
    return json({ ok: true, thread: forClient(t) });
  }
  if (b?.action === "reply" || b?.action === "read") {
    const id = str(b.id, 30);
    if (!/^[a-z0-9]{6,30}$/.test(id)) return json({ error: "Not found." }, 404);
    const text = str(b.text, MAX_TEXT);
    if (b.action === "reply" && text.length < 1) return json({ error: "Write your reply." }, 400);
    const r = await updateBlob(env, fbKey(c, id), readThread, (t) => {
      if (!t || t.companyId !== c) return { error: "Not found." };
      if (b.action === "read") return { value: { ...t, clientUnread: false } };
      if (t.messages.length >= MAX_MESSAGES) return { error: "This conversation is full. Start a new one." };
      return { value: { ...t, status: "waiting" as const, clientUnread: false, updatedAt: now, messages: [...t.messages, { from: "client" as const, by: user.email, at: now, text }] } };
    });
    if (!r.ok) return json({ error: r.error }, r.error === "Not found." ? 404 : 400);
    return json({ ok: true, thread: forClient(r.value!) });
  }
  return json({ error: "Unknown action." }, 400);
}

// ---------------------------------------------------------------- admin side

export async function adminFeedbackList(env: Env, status: string | null) {
  const rows = await blobsWithPrefix(env, "fb:", 5000);
  const threads = rows.map((r) => readThread(r.value)).filter((t): t is FbThread => !!t);
  const names = new Map<number, string>();
  const ids = [...new Set(threads.map((t) => t.companyId))];
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const res = await env.DB.prepare(`SELECT id, name FROM companies WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).all<{ id: number; name: string }>();
    for (const c of res.results ?? []) names.set(c.id, c.name);
  }
  const counts = { new: 0, waiting: 0, answered: 0, closed: 0 };
  for (const t of threads) counts[t.status]++;
  const open = status === "open" ? threads.filter((t) => t.status === "new" || t.status === "waiting") : status && status !== "all" ? threads.filter((t) => t.status === status) : threads;
  open.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { counts, threads: open.slice(0, 300).map((t) => ({ ...t, companyName: names.get(t.companyId) ?? `#${t.companyId}` })) };
}

/** Admin replies (the client gets an email that a reply is waiting) or changes the status. */
export async function adminFeedbackAct(env: Env, b: any, by: string): Promise<{ ok: true; thread: FbThread } | { ok: false; error: string }> {
  const c = Number(b?.companyId);
  const id = str(b?.id, 30);
  if (!Number.isInteger(c) || !/^[a-z0-9]{6,30}$/.test(id)) return { ok: false, error: "Not found." };
  const now = new Date().toISOString();
  const text = str(b?.text, MAX_TEXT);
  const status: FbStatus | null = b?.status === "closed" || b?.status === "answered" || b?.status === "new" || b?.status === "waiting" ? b.status : null;
  if (!text && !status) return { ok: false, error: "Write a reply or choose a status." };
  const r = await updateBlob(env, fbKey(c, id), readThread, (t) => {
    if (!t) return { error: "Not found." };
    if (text && t.messages.length >= MAX_MESSAGES) return { error: "This conversation is full." };
    const messages = text ? [...t.messages, { from: "admin" as const, by, at: now, text }] : t.messages;
    return { value: { ...t, messages, status: status ?? (text ? "answered" : t.status), clientUnread: text ? true : t.clientUnread, updatedAt: now } };
  });
  if (!r.ok) return r;
  const thread = r.value!;
  if (text) {
    const owner = await env.DB.prepare("SELECT email FROM users WHERE company_id = ? ORDER BY id LIMIT 1").bind(c).first<{ email: string }>();
    await sendLeadEmail(env, owner?.email, "PaintersMax answered your feedback", `Thank you for your feedback. We wrote back:\n\n${text}\n\nSee the whole conversation and reply: https://paintersmax.app/feedback\n\n(Respuesta a sus comentarios en PaintersMax: abra el enlace para verla.)`).catch(() => {});
  }
  return { ok: true, thread };
}

export async function feedbackForCompany(env: Env, c: number) {
  return (await companyThreads(env, c)).slice(0, 20);
}


import { getSessionUser } from "./auth.ts";
import { addNote, cleanNote, readNotes } from "./fieldnotes.ts";
import type { Env } from "./types.ts";

/**
 * Ask history: conversations kept per company, filed by job and by topic, with stars, archive, delete, save-to-job.
 *  GET  /api/askchats?scope=recent|jobs|topics|starred|archived&q=&topic=&jobId=   -> { chats: [...] }
 *  GET  /api/askchats?saved=1                                                       -> { saved: [starred answers] }
 *  GET  /api/askchats?id=                                                           -> { chat, messages }
 *  POST /api/askchats {action: star|archive|rename|delete|starMsg|saveToJob, ...}
 * Every call is checked against the signed-in company. If the tables are not there yet, Ask keeps working without history.
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const TOPICS = ["pricing", "products", "customers", "business", "platform", "general"] as const;
export type Topic = (typeof TOPICS)[number];

const RULES: Array<[Topic, RegExp]> = [
  ["platform", /\b(paintersmax|button|screen|page|app|login|sign in|invoice template|how do i (start|send|add|open|find)|estimate setup|dashboard|credits?)\b/i],
  ["pricing", /\b(price|pricing|cost|charge|quote|bid|estimate|per (square )?foot|markup|margin|labor rate|hourly|deposit)\b/i],
  ["products", /\b(primer|paint|sheen|satin|gloss|caulk|stain|sealer|brush|roller|sprayer|spackle|drywall|texture|sherwin|behr|benjamin|kilz|coat|wood|deck|cabinet)\b/i],
  ["customers", /\b(customer|client|complain|review|follow[- ]?up|polite|message|email|text|call|negotiat|too high|refund|warranty)\b/i],
  ["business", /\b(tax|insurance|license|hire|crew|employee|1099|market|ads|website|google|profit|schedule|growth|season)\b/i],
];

/** A topic from the words of the first question. */
export function topicOf(text: string): Topic {
  for (const [t, re] of RULES) if (re.test(text)) return t;
  return "general";
}

/** A short title from the first question. */
export function titleOf(text: string): string {
  const t = String(text || "").replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "");
  if (!t) return "Conversation";
  return t.length <= 60 ? t : t.slice(0, 57).replace(/\s+\S*$/, "") + "...";
}

/** Saves one question and its answer. Returns the conversation id, or null when history is not available. */
export async function recordTurn(env: Env, user: { companyId: number; userId: number }, i: { conversationId?: unknown; jobId?: number | null; question: string; reply: string }): Promise<{ id: number; assistantId: number } | null> {
  try {
    let id = Number(i.conversationId);
    if (Number.isInteger(id) && id > 0) {
      const ok = await env.DB.prepare("SELECT id FROM ask_conversations WHERE id = ? AND company_id = ?").bind(id, user.companyId).first();
      if (!ok) id = 0;
    } else id = 0;
    if (!id) {
      const r = await env.DB.prepare("INSERT INTO ask_conversations (company_id, user_id, job_id, title, topic) VALUES (?, ?, ?, ?, ?)")
        .bind(user.companyId, user.userId, i.jobId ?? null, titleOf(i.question), topicOf(i.question)).run();
      id = Number(r.meta.last_row_id);
    }
    const res = await env.DB.batch([
      env.DB.prepare("INSERT INTO ask_messages (conversation_id, company_id, role, content) VALUES (?, ?, 'user', ?)").bind(id, user.companyId, i.question.slice(0, 4000)),
      env.DB.prepare("INSERT INTO ask_messages (conversation_id, company_id, role, content) VALUES (?, ?, 'assistant', ?)").bind(id, user.companyId, i.reply.slice(0, 8000)),
      env.DB.prepare("UPDATE ask_conversations SET updated_at = datetime('now'), archived = 0 WHERE id = ?").bind(id),
    ]);
    return { id, assistantId: Number(res[1].meta.last_row_id) };
  } catch (err) {
    console.error("ask history not saved", String(err));
    return null;
  }
}

export async function handleAskChats(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  const url = new URL(request.url);
  try {
    if (request.method === "GET") {
      const id = Number(url.searchParams.get("id"));
      if (Number.isInteger(id) && id > 0) {
        const chat = await env.DB.prepare("SELECT id, title, topic, job_id AS jobId, starred, archived, updated_at AS updatedAt FROM ask_conversations WHERE id = ? AND company_id = ?").bind(id, c).first();
        if (!chat) return json({ error: "Not found." }, 404);
        const m = await env.DB.prepare("SELECT id, role, content, starred, created_at AS at FROM ask_messages WHERE conversation_id = ? AND company_id = ? ORDER BY id").bind(id, c).all();
        return json({ chat, messages: m.results });
      }
      if (url.searchParams.get("saved")) {
        const r = await env.DB.prepare(
          `SELECT m.id, m.content, m.created_at AS at, m.conversation_id AS chatId, k.title AS chatTitle,
                  (SELECT q.content FROM ask_messages q WHERE q.conversation_id = m.conversation_id AND q.role = 'user' AND q.id < m.id ORDER BY q.id DESC LIMIT 1) AS question
             FROM ask_messages m JOIN ask_conversations k ON k.id = m.conversation_id
            WHERE m.company_id = ? AND m.starred = 1 ORDER BY m.id DESC LIMIT 100`,
        ).bind(c).all();
        return json({ saved: r.results });
      }
      const scope = url.searchParams.get("scope") || "recent";
      const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
      const topic = (TOPICS as readonly string[]).includes(url.searchParams.get("topic") || "") ? url.searchParams.get("topic")! : "";
      const jobId = Number(url.searchParams.get("jobId"));
      const where = ["k.company_id = ?"];
      const binds: unknown[] = [c];
      where.push(scope === "archived" ? "k.archived = 1" : "k.archived = 0");
      if (scope === "starred") where.push("k.starred = 1");
      if (scope === "jobs") where.push("k.job_id IS NOT NULL");
      if (topic) { where.push("k.topic = ?"); binds.push(topic); }
      if (Number.isInteger(jobId) && jobId > 0) { where.push("k.job_id = ?"); binds.push(jobId); }
      if (q) {
        const like = `%${q.replace(/[%_]/g, " ")}%`;
        where.push("(k.title LIKE ? OR j.title LIKE ? OR EXISTS (SELECT 1 FROM ask_messages x WHERE x.conversation_id = k.id AND x.content LIKE ?))");
        binds.push(like, like, like);
      }
      const r = await env.DB.prepare(
        `SELECT k.id, k.title, k.topic, k.job_id AS jobId, j.title AS jobTitle, k.starred, k.archived, k.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM ask_messages x WHERE x.conversation_id = k.id) AS count
           FROM ask_conversations k LEFT JOIN jobs j ON j.id = k.job_id AND j.company_id = k.company_id
          WHERE ${where.join(" AND ")} ORDER BY k.updated_at DESC LIMIT 100`,
      ).bind(...binds).all();
      return json({ chats: r.results });
    }
    if (request.method !== "POST") return json({ error: "Not found." }, 404);
    const b: any = await request.json().catch(() => null);
    const id = Number(b?.id);
    if (b?.action === "starMsg") {
      const mid = Number(b.messageId);
      await env.DB.prepare("UPDATE ask_messages SET starred = ? WHERE id = ? AND company_id = ? AND role = 'assistant'").bind(b.on === false ? 0 : 1, mid, c).run();
      return json({ ok: true });
    }
    if (b?.action === "saveToJob") {
      const mid = Number(b.messageId), jobId = Number(b.jobId);
      const m = await env.DB.prepare("SELECT content FROM ask_messages WHERE id = ? AND company_id = ? AND role = 'assistant'").bind(mid, c).first<{ content: string }>();
      const job = await env.DB.prepare("SELECT json_extract(data,'$.fieldNotes') AS notes FROM jobs WHERE id = ? AND company_id = ?").bind(jobId, c).first<{ notes: string | null }>();
      if (!m || !job) return json({ error: "Not found." }, 404);
      let list = readNotes(job.notes ? JSON.parse(job.notes) : []);
      const note = cleanNote({ text: "From Ask: " + m.content, tag: "general" }, new Date().toISOString());
      if (!note) return json({ error: "Nothing to save." }, 400);
      list = addNote(list, note);
      await env.DB.prepare("UPDATE jobs SET data = json_set(COALESCE(data, '{}'), '$.fieldNotes', json(?)), updated_at = datetime('now') WHERE id = ? AND company_id = ?").bind(JSON.stringify(list), jobId, c).run();
      return json({ ok: true });
    }
    if (!Number.isInteger(id) || id < 1) return json({ error: "Not found." }, 404);
    const own = await env.DB.prepare("SELECT id FROM ask_conversations WHERE id = ? AND company_id = ?").bind(id, c).first();
    if (!own) return json({ error: "Not found." }, 404);
    if (b.action === "star") await env.DB.prepare("UPDATE ask_conversations SET starred = ? WHERE id = ?").bind(b.on === false ? 0 : 1, id).run();
    else if (b.action === "archive") await env.DB.prepare("UPDATE ask_conversations SET archived = ? WHERE id = ?").bind(b.on === false ? 0 : 1, id).run();
    else if (b.action === "rename") await env.DB.prepare("UPDATE ask_conversations SET title = ? WHERE id = ?").bind(titleOf(String(b.title || "")), id).run();
    else if (b.action === "delete") await env.DB.batch([env.DB.prepare("DELETE FROM ask_messages WHERE conversation_id = ?").bind(id), env.DB.prepare("DELETE FROM ask_conversations WHERE id = ?").bind(id)]);
    else return json({ error: "Unknown action." }, 400);
    return json({ ok: true });
  } catch (err) {
    console.error("askchats failed", String(err));
    return json({ error: "History is not ready yet." }, 503);
  }
}

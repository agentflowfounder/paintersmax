import { getSessionUser } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import type { Env } from "./types.ts";

/**
 * Lost leads stay in the database with a reason, so the painter (and later the Pro analysis) can see why jobs were not won.
 * The reason is kept in the job's own data (jobs.data.lost). Nothing here is shown to customers.
 */
export const LOST_REASONS = ["price", "timing", "no_reply", "chose_other", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_LABELS: Record<LostReason, string> = { price: "Price", timing: "Timing", no_reply: "No reply", chose_other: "Chose someone else", other: "Other" };

export const isLostReason = (v: unknown): v is LostReason => typeof v === "string" && (LOST_REASONS as readonly string[]).includes(v);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** POST /api/joblost {jobId, action:"lost", reason, note?} or {jobId, action:"reopen"} */
export async function handleJobLost(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const jobId = Number(b?.jobId);
  const job = Number.isInteger(jobId) ? await env.DB.prepare("SELECT id, stage, data FROM jobs WHERE id = ? AND company_id = ?").bind(jobId, user.companyId).first<{ id: number; stage: string; data: string }>() : null;
  if (!job) return json({ error: "Job not found." }, 404);
  let data: any = {};
  try {
    data = JSON.parse(job.data || "{}");
  } catch {
    data = {};
  }
  if (b?.action === "lost") {
    if (!isLostReason(b.reason)) return json({ error: "Choose why it was lost." }, 400);
    if (job.stage === "closed") return json({ error: "A finished job cannot be marked lost." }, 400);
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
    data.lost = { reason: b.reason, note, at: new Date().toISOString(), from: job.stage };
    await env.DB.prepare("UPDATE jobs SET stage = 'lost', data = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(data), jobId).run();
    await addJobEvent(env, user.companyId, jobId, "stage", `Marked lost: ${LOST_LABELS[b.reason as LostReason]}${note ? ` (${note})` : ""}.`);
    return json({ ok: true });
  }
  if (b?.action === "reopen") {
    if (job.stage !== "lost") return json({ error: "This job is not marked lost." }, 400);
    const back = typeof data?.lost?.from === "string" && data.lost.from !== "lost" ? data.lost.from : "lead";
    delete data.lost;
    await env.DB.prepare("UPDATE jobs SET stage = ?, data = ?, updated_at = datetime('now') WHERE id = ?").bind(back, JSON.stringify(data), jobId).run();
    await addJobEvent(env, user.companyId, jobId, "stage", "Reopened after being marked lost.");
    return json({ ok: true, stage: back });
  }
  return json({ error: "Unknown action." }, 400);
}

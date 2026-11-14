import { getSessionUser } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import { loadCrew, notifyCrew } from "./calfeed.ts";
import { bookedVisits } from "./visit.ts";
import { noticePlan, type StartNoticeState } from "./startnotice.ts";
import type { Env } from "./types.ts";

/**
 * Calendar and crew schedule. Dates live inside the job's own data (jobs.data.schedule), so no database change is needed.
 * A job has one block of days, an optional start time, the crew assigned, and a short note.
 */

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export interface Schedule extends StartNoticeState {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, same as start for a one-day job
  startTime: string; // HH:MM or ""
  crew: string[];
  notes: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Cleans a schedule from the browser. Returns the schedule or a plain-language error. */
export function cleanSchedule(input: any): { schedule?: Schedule; error?: string } {
  if (!validDate(input?.start)) return { error: "Pick a valid start date." };
  const end = input?.end === undefined || input?.end === "" || input?.end === null ? input.start : input.end;
  if (!validDate(end)) return { error: "Pick a valid end date." };
  if (end < input.start) return { error: "The end date cannot be before the start date." };
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${input.start}T00:00:00Z`)) / 86400000;
  if (days > 120) return { error: "A job block can be at most 120 days." };
  const time = typeof input?.startTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime) ? input.startTime : "";
  const crew: string[] = [];
  for (const c of Array.isArray(input?.crew) ? input.crew : []) {
    const n = typeof c === "string" ? c.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    if (n && !crew.some((x) => x.toLowerCase() === n.toLowerCase())) crew.push(n);
    if (crew.length >= 10) break;
  }
  const notes = typeof input?.notes === "string" ? input.notes.trim().slice(0, 500) : "";
  const startNotice = input?.startNotice === true;
  return { schedule: { start: input.start, end, startTime: time, crew, notes, ...(startNotice ? { startNotice: true, noticeLang: input?.noticeLang === "es" ? ("es" as const) : ("en" as const) } : {}) } };
}

export const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && b.start <= a.end;

/** Crew members already booked on another job during these days. */
export function findConflicts(target: { jobId: number; start: string; end: string; crew: string[] }, others: { jobId: number; title: string; start: string; end: string; crew: string[] }[]): { crew: string; jobId: number; title: string }[] {
  const out: { crew: string; jobId: number; title: string }[] = [];
  for (const o of others) {
    if (o.jobId === target.jobId || !overlaps(target, o)) continue;
    for (const c of target.crew) if (o.crew.some((x) => x.toLowerCase() === c.toLowerCase())) out.push({ crew: c, jobId: o.jobId, title: o.title });
  }
  return out;
}

const parse = (s: string | null | undefined) => {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

export async function scheduledJobs(env: Env, companyId: number) {
  const { results } = await env.DB.prepare(
    `SELECT j.id, j.title, j.stage, j.data, cu.name AS customer, cu.email, p.address, p.city
       FROM jobs j JOIN customers cu ON cu.id = j.customer_id LEFT JOIN properties p ON p.id = j.property_id
      WHERE j.company_id = ? AND json_extract(j.data, '$.schedule.start') IS NOT NULL AND j.stage NOT IN ('lost')
      ORDER BY json_extract(j.data, '$.schedule.start') LIMIT 500`,
  ).bind(companyId).all<any>();
  return (results ?? []).map((r) => {
    const s = parse(r.data).schedule ?? {};
    return { jobId: r.id as number, title: r.title as string, stage: r.stage as string, customer: r.customer as string, address: [r.address, r.city].filter(Boolean).join(", "), start: s.start as string, end: (s.end ?? s.start) as string, startTime: (s.startTime ?? "") as string, crew: (Array.isArray(s.crew) ? s.crew : []) as string[], notes: (s.notes ?? "") as string, email: (r.email ?? "") as string, startNotice: s.startNotice === true, noticeLang: (s.noticeLang === "es" ? "es" : "en") as "en" | "es", noticed: (s.noticed ?? "") as string, noticedAt: (s.noticedAt ?? "") as string };
  });
}

/**
 * GET /api/schedule: scheduled jobs, plus approved jobs that still need a date.
 * POST {jobId, start, end, startTime, crew[], notes} saves the dates; {jobId, clear:true} removes them.
 */
export async function handleSchedule(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);

  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const jobId = Number(b?.jobId);
    const job = Number.isInteger(jobId) ? await env.DB.prepare("SELECT j.id, j.title, j.stage, j.data, cu.email FROM jobs j JOIN customers cu ON cu.id = j.customer_id WHERE j.id = ? AND j.company_id = ?").bind(jobId, user.companyId).first<any>() : null;
    if (!job) return json({ error: "Job not found." }, 404);
    const data = parse(job.data);
    if (b?.clear === true) {
      delete data.schedule;
      await env.DB.prepare("UPDATE jobs SET data = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(data), jobId).run();
      await addJobEvent(env, user.companyId, jobId, "note", "Removed from the calendar.");
      return json({ ok: true });
    }
    const c = cleanSchedule(b);
    if (!c.schedule) return json({ error: c.error }, 400);
    if (c.schedule.startNotice && !job.email) return json({ error: "This customer has no email address. Add one in Edit details, or untick the \"We start tomorrow\" box." }, 400);
    // Keep the record of a notice that already went out, as long as the start date did not change.
    const old = data.schedule;
    if (c.schedule.startNotice && old?.start === c.schedule.start && old?.noticed === c.schedule.start) {
      c.schedule.noticed = old.noticed;
      if (old.noticedAt) c.schedule.noticedAt = old.noticedAt;
    }
    data.schedule = c.schedule;
    // A contract that gets a date becomes "scheduled". Anything further along keeps its stage.
    const stage = job.stage === "contract" || job.stage === "bid" ? "scheduled" : job.stage;
    await env.DB.prepare("UPDATE jobs SET data = ?, stage = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(data), stage, jobId).run();
    await addJobEvent(env, user.companyId, jobId, "note", `Scheduled ${c.schedule.start}${c.schedule.end !== c.schedule.start ? " to " + c.schedule.end : ""}${c.schedule.crew.length ? ", crew: " + c.schedule.crew.join(", ") : ""}.`);
    const all = await scheduledJobs(env, user.companyId);
    const conflicts = findConflicts({ jobId, start: c.schedule.start, end: c.schedule.end, crew: c.schedule.crew }, all);
    let notified: { emailed: string[]; noEmail: string[]; failed: string[] } | undefined;
    if (b?.notify === true && c.schedule.crew.length) {
      const me = await env.DB.prepare("SELECT co.name, co.notify_email FROM companies co WHERE co.id = ?").bind(user.companyId).first<{ name: string; notify_email: string | null }>();
      const job2 = all.find((x) => x.jobId === jobId);
      if (me && job2) notified = await notifyCrew(env, { name: me.name, replyTo: me.notify_email || user.email }, job2, await loadCrew(env, user.companyId));
      if (notified?.emailed.length) await addJobEvent(env, user.companyId, jobId, "note", `Schedule emailed to crew: ${notified.emailed.join(", ")}.`);
    }
    return json({ ok: true, conflicts, notified, notice: noticePlan(c.schedule, Date.now()) });
  }

  const scheduled = await scheduledJobs(env, user.companyId);
  const { results } = await env.DB.prepare(
    `SELECT j.id, j.title, j.stage, cu.name AS customer, cu.email FROM jobs j JOIN customers cu ON cu.id = j.customer_id
      WHERE j.company_id = ? AND j.stage IN ('contract','scheduled','in_progress') AND json_extract(j.data, '$.schedule.start') IS NULL
      ORDER BY j.updated_at DESC LIMIT 50`,
  ).bind(user.companyId).all<any>();
  const crew = [...new Set(scheduled.flatMap((s) => s.crew))].sort((a, b) => a.localeCompare(b));
  return json({ jobs: scheduled, visits: await bookedVisits(env, user.companyId).catch(() => []), needsDate: (results ?? []).map((r) => ({ jobId: r.id, title: r.title, stage: r.stage, customer: r.customer, email: r.email ?? "" })), crew });
}

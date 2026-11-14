import { getSessionUser } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import { fold } from "./calfeed.ts";
import { addDaysIso, friendlyDate, friendlyTime, isIsoDate, todayLocal } from "./dates.ts";
import { sendCustomerEmail } from "./email.ts";
import type { Env } from "./types.ts";

/**
 * Site visit: a walk-through appointment booked on a lead. It is stored inside the job's own data (jobs.data.visit), so it needs no
 * database change, and it is not a job stage, so nothing else about how jobs move changes.
 * The customer is emailed only when the painter ticks the box: a confirmation with a calendar file when the visit is booked or
 * changed, one friendly reminder the day before, and a short note if it is cancelled.
 */

export interface Visit {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM or ""
  notes: string; // private, for the painter; never emailed
  notify: boolean; // the painter chose to email the customer a confirmation and a reminder
  lang: "en" | "es";
  status: "booked" | "done" | "cancelled";
  confirmedAt?: string; // when the confirmation email went out
  reminded?: string; // the visit date a reminder was already handled for
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const parse = (s: unknown) => {
  try {
    return typeof s === "string" && s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

/** Cleans a visit from the browser. Returns the visit or a plain-language error. */
export function cleanVisit(input: any, today: string): { visit?: Omit<Visit, "status" | "confirmedAt" | "reminded">; error?: string } {
  if (!isIsoDate(input?.date)) return { error: "Pick a date for the visit." };
  if (input.date < today) return { error: "Pick today or a day ahead." };
  const time = typeof input?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : "";
  const notes = typeof input?.notes === "string" ? input.notes.trim().slice(0, 500) : "";
  return { visit: { date: input.date, time, notes, notify: input?.notify === true, lang: input?.lang === "es" ? "es" : "en" } };
}

/** "Tue, Nov 17 at 10:00 AM" (or just the date when no time was set). */
export function visitWhen(v: Pick<Visit, "date" | "time" | "lang">): string {
  const d = friendlyDate(v.date, v.lang);
  const t = friendlyTime(v.time);
  return t ? `${d} ${v.lang === "es" ? "a las" : "at"} ${t}` : d;
}

export type VisitMail = "confirm" | "update" | "reminder" | "cancel";

/** The four customer emails. They state only the date, time and address the painter set, never anything private. */
export function visitEmail(kind: VisitMail, o: { es: boolean; customer: string; company: string; when: string; address: string }): { subject: string; body: string } {
  const first = o.customer.split(/\s+/)[0] || o.customer;
  const where = o.address ? (o.es ? `\nDirección: ${o.address}` : `\nAddress: ${o.address}`) : "";
  if (o.es) {
    const map: Record<VisitMail, { subject: string; body: string }> = {
      confirm: { subject: `Su visita con ${o.company}: ${o.when}`, body: `Hola ${first},\n\nConfirmamos su visita con ${o.company}:\n\nCuándo: ${o.when}${where}\n\nAdjuntamos un archivo de calendario para agregarla a su calendario. Si esa hora ya no le funciona, responda a este correo y la cambiamos.\n\n${o.company}` },
      update: { subject: `Cambio en su visita con ${o.company}: ${o.when}`, body: `Hola ${first},\n\nSu visita con ${o.company} cambió. La nueva fecha es:\n\nCuándo: ${o.when}${where}\n\nAdjuntamos un archivo de calendario actualizado. Si esa hora no le funciona, responda a este correo.\n\n${o.company}` },
      reminder: { subject: `Recordatorio: su visita con ${o.company} es mañana`, body: `Hola ${first},\n\nUn recordatorio amable de su visita con ${o.company} mañana:\n\nCuándo: ${o.when}${where}\n\nSi necesita cambiarla, responda a este correo.\n\n${o.company}` },
      cancel: { subject: `Su visita con ${o.company} fue cancelada`, body: `Hola ${first},\n\nSu visita con ${o.company} (${o.when}) fue cancelada. Responda a este correo si quiere elegir otra fecha.\n\n${o.company}` },
    };
    return map[kind];
  }
  const map: Record<VisitMail, { subject: string; body: string }> = {
    confirm: { subject: `Your visit with ${o.company}: ${o.when}`, body: `Hi ${first},\n\nThis confirms your visit with ${o.company}:\n\nWhen: ${o.when}${where}\n\nA calendar file is attached so you can add it to your calendar. If that time no longer works, reply to this email and we will change it.\n\n${o.company}` },
    update: { subject: `Your visit with ${o.company} has changed: ${o.when}`, body: `Hi ${first},\n\nYour visit with ${o.company} has changed. The new time is:\n\nWhen: ${o.when}${where}\n\nAn updated calendar file is attached. If that time does not work, reply to this email.\n\n${o.company}` },
    reminder: { subject: `Reminder: your visit with ${o.company} is tomorrow`, body: `Hi ${first},\n\nA friendly reminder about your visit with ${o.company} tomorrow:\n\nWhen: ${o.when}${where}\n\nIf you need to change it, reply to this email.\n\n${o.company}` },
    cancel: { subject: `Your visit with ${o.company} was cancelled`, body: `Hi ${first},\n\nYour visit with ${o.company} (${o.when}) was cancelled. Reply to this email if you would like to pick another time.\n\n${o.company}` },
  };
  return map[kind];
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** A one-event calendar file for the visit. The same UID is reused so a changed or cancelled visit replaces the first one. */
export function visitIcs(o: { jobId: number; company: string; address: string; date: string; time: string; cancel?: boolean; now?: Date }): string {
  const now = o.now ?? new Date();
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PaintersMax//Visit//EN", "CALSCALE:GREGORIAN", `METHOD:${o.cancel ? "CANCEL" : "PUBLISH"}`, "BEGIN:VEVENT", `UID:visit-${o.jobId}@paintersmax.app`, `DTSTAMP:${stamp(now)}`, `SEQUENCE:${Math.floor(now.getTime() / 60000)}`];
  if (o.time) L.push(`DTSTART:${o.date.replace(/-/g, "")}T${o.time.replace(":", "")}00`, "DURATION:PT1H");
  else L.push(`DTSTART;VALUE=DATE:${o.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDaysIso(o.date, 1).replace(/-/g, "")}`);
  L.push(`SUMMARY:${esc(`Site visit - ${o.company}`)}`);
  if (o.address) L.push(`LOCATION:${esc(o.address)}`);
  L.push(`STATUS:${o.cancel ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT", "END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

const b64 = (s: string) => {
  let bin = "";
  for (const x of new TextEncoder().encode(s)) bin += String.fromCharCode(x);
  return btoa(bin);
};

/** All the visits that are still booked, for the calendar and Home. */
export async function bookedVisits(env: Env, companyId: number) {
  const { results } = await env.DB.prepare(
    `SELECT j.id, j.title, j.stage, j.data, cu.name AS customer, p.address, p.city
       FROM jobs j JOIN customers cu ON cu.id = j.customer_id LEFT JOIN properties p ON p.id = j.property_id
      WHERE j.company_id = ? AND json_extract(j.data, '$.visit.status') = 'booked' AND j.stage NOT IN ('lost') ORDER BY json_extract(j.data, '$.visit.date') LIMIT 200`,
  ).bind(companyId).all<any>();
  return (results ?? []).map((r) => {
    const v = parse(r.data).visit as Visit;
    return { jobId: r.id as number, title: r.title as string, customer: r.customer as string, address: [r.address, r.city].filter(Boolean).join(", "), date: v.date, time: v.time ?? "", notes: v.notes ?? "" };
  });
}

/**
 * POST /api/visit  {jobId, action}
 *  book   {date, time?, notes?, notify?, lang?}  books or changes the visit; emails the confirmation when notify is on
 *  done   marks the visit as done
 *  cancel cancels it; if the customer was emailed a confirmation they are told it is cancelled
 */
export async function handleVisit(request: Request, env: Env): Promise<Response> {
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
  const job = Number.isInteger(jobId)
    ? await env.DB.prepare(
        `SELECT j.id, j.title, j.stage, j.data, cu.name AS customer, cu.email, p.address, p.city, p.zip, co.name AS company, co.notify_email
           FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id LEFT JOIN properties p ON p.id = j.property_id
          WHERE j.id = ? AND j.company_id = ?`,
      ).bind(jobId, user.companyId).first<any>()
    : null;
  if (!job) return json({ error: "Job not found." }, 404);
  const data = parse(job.data);
  const old: Visit | undefined = data.visit && typeof data.visit === "object" && isIsoDate(data.visit.date) ? data.visit : undefined;
  const address = [job.address, job.city, job.zip].filter(Boolean).join(", ");
  const save = (v: Visit) => env.DB.prepare("UPDATE jobs SET data = json_set(COALESCE(data, '{}'), '$.visit', json(?)), updated_at = datetime('now') WHERE id = ? AND company_id = ?").bind(JSON.stringify(v), jobId, user.companyId).run();
  const mail = async (kind: VisitMail, v: Visit, cancel = false) => {
    const es = v.lang === "es";
    const t = visitEmail(kind, { es, customer: job.customer ?? "", company: job.company, when: visitWhen(v), address });
    const ics = visitIcs({ jobId, company: job.company, address, date: v.date, time: v.time, cancel });
    return sendCustomerEmail(env, job.email, job.company, job.notify_email || user.email, t.subject, t.body, kind === "reminder" ? undefined : [{ filename: "visit.ics", content: b64(ics) }]);
  };

  if (b.action === "book") {
    if (job.stage === "lost" || job.stage === "closed") return json({ error: "This job is closed, so a visit cannot be booked." }, 400);
    const today = todayLocal();
    const c = cleanVisit(b, today);
    if (!c.visit) return json({ error: c.error }, 400);
    const v: Visit = { ...c.visit, status: "booked" };
    const changed = !old || old.status !== "booked" || old.date !== v.date || old.time !== v.time;
    if (v.notify && !job.email) return json({ error: "This customer has no email address. Add one in Edit details, or untick the email box." }, 400);
    let emailed: "sent" | "skipped" | "none" = "none";
    // One day ahead or less: the confirmation is the reminder, so no second email goes out. Otherwise one goes out the day before.
    v.reminded = v.date <= addDaysIso(today, 1) ? v.date : undefined;
    if (!changed && old) {
      v.confirmedAt = old.confirmedAt;
      v.reminded = old.reminded ?? v.reminded;
    }
    if (v.notify && (changed || !old?.confirmedAt)) {
      emailed = await mail(old && old.status === "booked" && old.confirmedAt ? "update" : "confirm", v);
      if (emailed === "sent") v.confirmedAt = new Date().toISOString();
    }
    await save(v);
    if (changed) await addJobEvent(env, user.companyId, jobId, "note", `Site visit ${old && old.status === "booked" ? "changed to" : "booked for"} ${visitWhen({ ...v, lang: "en" })}.${emailed === "sent" ? " The customer was emailed a confirmation." : ""}`);
    return json({ ok: true, visit: v, emailed });
  }

  if (!old) return json({ error: "There is no visit on this job." }, 404);
  if (b.action === "done") {
    await save({ ...old, status: "done" });
    await addJobEvent(env, user.companyId, jobId, "note", "Site visit done.");
    return json({ ok: true });
  }
  if (b.action === "cancel") {
    let emailed: "sent" | "skipped" | "none" = "none";
    if (old.status === "booked" && old.notify && old.confirmedAt && job.email) emailed = await mail("cancel", old, true);
    await save({ ...old, status: "cancelled" });
    await addJobEvent(env, user.companyId, jobId, "note", `Site visit cancelled (${visitWhen({ ...old, lang: "en" })}).${emailed === "sent" ? " The customer was emailed." : ""}`);
    return json({ ok: true, emailed });
  }
  return json({ error: "Unknown action." }, 400);
}

/**
 * Scheduled job (every few minutes): the day-before reminder for visits the painter chose to email about. It goes out once, between
 * 8 AM and 8 PM, and only while the visit is still booked. Cheap when there is nothing to send.
 */
export async function sendVisitReminders(env: Env, now: number = Date.now()): Promise<number> {
  if (!env.RESEND_API_KEY) return 0;
  const hour = new Date(now - 6 * 3600 * 1000).getUTCHours();
  if (hour < 8 || hour >= 20) return 0;
  const tomorrow = addDaysIso(todayLocal(now), 1);
  const rows = await env.DB.prepare(
    `SELECT j.id, j.company_id, j.data, cu.name AS customer, cu.email, p.address, p.city, p.zip, co.name AS company, co.notify_email
       FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id LEFT JOIN properties p ON p.id = j.property_id
      WHERE json_extract(j.data, '$.visit.date') = ? AND json_extract(j.data, '$.visit.status') = 'booked' AND json_extract(j.data, '$.visit.notify') = 1
        AND COALESCE(json_extract(j.data, '$.visit.reminded'), '') != ? AND cu.email IS NOT NULL LIMIT 100`,
  ).bind(tomorrow, tomorrow).all<any>();
  let n = 0;
  for (const r of rows.results ?? []) {
    const v = parse(r.data).visit as Visit;
    const t = visitEmail("reminder", { es: v.lang === "es", customer: r.customer ?? "", company: r.company, when: visitWhen(v), address: [r.address, r.city, r.zip].filter(Boolean).join(", ") });
    const res = await sendCustomerEmail(env, r.email, r.company, r.notify_email, t.subject, t.body);
    if (res !== "sent") continue;
    await env.DB.prepare("UPDATE jobs SET data = json_set(COALESCE(data, '{}'), '$.visit.reminded', ?) WHERE id = ?").bind(tomorrow, r.id).run();
    await addJobEvent(env, r.company_id, r.id, "note", "Visit reminder emailed to the customer.");
    n++;
  }
  return n;
}

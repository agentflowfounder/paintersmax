import { addJobEvent } from "./crm.ts";
import { addDaysIso, friendlyDate, friendlyTime, isIsoDate, todayLocal } from "./dates.ts";
import { sendCustomerEmail } from "./email.ts";
import type { Env } from "./types.ts";

/**
 * "We start tomorrow" notice. When the painter puts a job on the calendar and leaves the box ticked, the customer gets one short
 * email about 24 hours before the start day. The choice and what was sent live inside the job's schedule (jobs.data.schedule), so
 * no database change is needed. Nothing private (crew notes, prices) is ever in the email.
 */

export interface StartNoticeState {
  startNotice?: boolean; // the painter chose to email the customer
  noticeLang?: "en" | "es";
  noticed?: string; // the start date a notice was already sent for
  noticedAt?: string; // ISO time it went out
}

/** The minute of the day (US local) the notice goes out the day before: the start time, but never before 8:00 AM or after 7:00 PM. */
export function noticeMinute(startTime: string | null | undefined): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime ?? "");
  const wanted = m ? Number(m[1]) * 60 + Number(m[2]) : 8 * 60;
  return Math.min(19 * 60, Math.max(8 * 60, wanted));
}

/** True when the notice for this schedule should be sent now: it is the day before the start, inside the 8 AM to 8 PM window, and not sent yet. */
export function noticeIsDue(s: { start?: string; startTime?: string } & StartNoticeState, now: number): boolean {
  if (s.startNotice !== true || !s.start || !isIsoDate(s.start)) return false;
  if (s.noticed === s.start) return false;
  const local = new Date(now - 6 * 3600 * 1000);
  if (addDaysIso(todayLocal(now), 1) !== s.start) return false;
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minute >= noticeMinute(s.startTime) && minute < 20 * 60;
}

/** What the painter is told when they save: where the notice stands. "" when no notice was asked for. */
export function noticePlan(s: { start: string; startTime?: string } & StartNoticeState, now: number): "none" | "queued" | "soon" | "sent" {
  if (s.startNotice !== true) return "none";
  if (s.noticed === s.start) return "sent";
  const today = todayLocal(now);
  if (s.start <= today) return "soon";
  if (s.start === addDaysIso(today, 1)) {
    const hour = new Date(now - 6 * 3600 * 1000).getUTCHours();
    return hour >= 20 ? "soon" : "queued";
  }
  return "queued";
}

/** The customer email. It names only the day, the time, the address and a few plain tips. */
export function startNoticeEmail(o: { es: boolean; customer: string; company: string; title: string; start: string; end: string; startTime: string; address: string }): { subject: string; body: string } {
  const first = o.customer.split(/\s+/)[0] || o.customer;
  const lang = o.es ? "es" : "en";
  const day = friendlyDate(o.start, lang);
  const t = friendlyTime(o.startTime);
  const when = t ? `${day} ${o.es ? "a las" : "at"} ${t}` : day;
  const through = o.end && o.end > o.start ? friendlyDate(o.end, lang) : "";
  if (o.es) {
    return {
      subject: `Mañana empezamos: ${o.company}`,
      body:
        `Hola ${first},\n\nUn aviso amable de ${o.company}: mañana empezamos su proyecto "${o.title}".\n\nCuándo: ${when}` +
        (o.address ? `\nDirección: ${o.address}` : "") +
        (through ? `\nNuestro plan actual es trabajar hasta el ${through}.` : "") +
        `\n\nPara que el día salga bien:\n- Asegúrese de que podamos entrar a la hora de inicio (portones, garaje o puertas).\n- Si puede, mueva objetos pequeños de valor o frágiles fuera de las áreas que vamos a pintar.\n- Mantenga a los niños y a las mascotas lejos del área de trabajo.\n- Díganos dónde prefiere que estacionemos.\n\nSi algo cambió y mañana ya no le funciona, responda a este correo lo antes posible.\n\n${o.company}`,
    };
  }
  return {
    subject: `We start tomorrow: ${o.company}`,
    body:
      `Hi ${first},\n\nA friendly heads-up from ${o.company}: we start your project "${o.title}" tomorrow.\n\nWhen: ${when}` +
      (o.address ? `\nAddress: ${o.address}` : "") +
      (through ? `\nOur current plan is to work through ${through}.` : "") +
      `\n\nTo help the day go smoothly:\n- Please make sure we can get in by the start time (gates, garage or doors).\n- If you can, move small valuables and fragile items out of the areas we will paint.\n- Keep children and pets away from the work area.\n- Tell us where you would like us to park.\n\nIf anything has changed and tomorrow no longer works, reply to this email as soon as you can.\n\n${o.company}`,
  };
}

const parse = (s: unknown) => {
  try {
    return typeof s === "string" && s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

/** Cron: emails each customer whose job starts tomorrow and whose painter left the notice on. Each notice goes out once per start date. */
export async function sendStartNotices(env: Env, now: number = Date.now()): Promise<number> {
  if (!env.RESEND_API_KEY) return 0;
  const hour = new Date(now - 6 * 3600 * 1000).getUTCHours();
  if (hour < 8 || hour >= 20) return 0;
  const tomorrow = addDaysIso(todayLocal(now), 1);
  const rows = await env.DB.prepare(
    `SELECT j.id, j.company_id, j.title, j.data, cu.name AS customer, cu.email, p.address, p.city, p.zip, co.name AS company, co.notify_email
       FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id LEFT JOIN properties p ON p.id = j.property_id
      WHERE json_extract(j.data, '$.schedule.start') = ? AND json_extract(j.data, '$.schedule.startNotice') = 1
        AND COALESCE(json_extract(j.data, '$.schedule.noticed'), '') != ? AND j.stage IN ('contract', 'scheduled') AND cu.email IS NOT NULL AND cu.email != '' LIMIT 200`,
  ).bind(tomorrow, tomorrow).all<any>();
  let n = 0;
  for (const r of rows.results ?? []) {
    const s = parse(r.data).schedule ?? {};
    if (!noticeIsDue(s, now)) continue;
    const t = startNoticeEmail({ es: s.noticeLang === "es", customer: r.customer ?? "", company: r.company, title: r.title, start: s.start, end: s.end ?? s.start, startTime: s.startTime ?? "", address: [r.address, r.city, r.zip].filter(Boolean).join(", ") });
    const res = await sendCustomerEmail(env, r.email, r.company, r.notify_email, t.subject, t.body);
    if (res !== "sent") continue;
    await env.DB.prepare("UPDATE jobs SET data = json_set(json_set(COALESCE(data, '{}'), '$.schedule.noticed', ?), '$.schedule.noticedAt', ?) WHERE id = ?").bind(tomorrow, new Date(now).toISOString(), r.id).run();
    await addJobEvent(env, r.company_id, r.id, "note", "The customer was emailed the \"We start tomorrow\" notice.");
    n++;
  }
  return n;
}

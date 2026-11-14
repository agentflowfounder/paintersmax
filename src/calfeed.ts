import { getSessionUser, randomToken, sha256Hex } from "./auth.ts";
import { sendCustomerEmail } from "./email.ts";
import type { Env } from "./types.ts";

/**
 * Calendar feed (subscribe from Google Calendar, Apple Calendar or Outlook) and crew contacts for schedule emails.
 * Settings live in app_settings so no database change is needed.
 */

const PUBLIC_BASE = "https://paintersmax.app";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export interface SchedJob { jobId: number; title: string; customer: string; address: string; start: string; end: string; startTime: string; crew: string[]; notes: string; stage?: string; /** A site visit rather than the job itself: its own UID and a one-hour length. */ visit?: boolean }

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Folds a content line to 75 characters, as the calendar format requires. */
export function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}
const ymd = (iso: string) => iso.replace(/-/g, "");
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function eventLines(j: SchedJob, now = new Date(), link = `${PUBLIC_BASE}/jobs?id=${j.jobId}`): string[] {
  const timed = j.startTime && j.start === j.end;
  const desc = [j.crew.length ? `Crew: ${j.crew.join(", ")}` : "", j.notes, `Job: ${link}`].filter(Boolean).join("\n");
  const L = ["BEGIN:VEVENT", `UID:${j.visit ? "visit" : "job"}-${j.jobId}@paintersmax.app`, `DTSTAMP:${stamp(now)}`];
  if (timed) {
    L.push(`DTSTART:${ymd(j.start)}T${j.startTime.replace(":", "")}00`, j.visit ? "DURATION:PT1H" : "DURATION:PT8H");
  } else {
    L.push(`DTSTART;VALUE=DATE:${ymd(j.start)}`, `DTEND;VALUE=DATE:${ymd(plusDays(j.end, 1))}`);
  }
  L.push(`SUMMARY:${esc(j.visit ? `Site visit${j.customer ? " - " + j.customer : ""}` : `${j.startTime && !timed ? j.startTime + " " : ""}${j.title}${j.customer ? " - " + j.customer : ""}`)}`);
  if (j.address) L.push(`LOCATION:${esc(j.address)}`);
  L.push(`DESCRIPTION:${esc(desc)}`, "STATUS:CONFIRMED", "END:VEVENT");
  return L;
}

/** A full calendar (VCALENDAR) as text with CRLF line endings. */
export function buildIcs(name: string, jobs: SchedJob[], now = new Date()): string {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PaintersMax//Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const j of jobs) L.push(...eventLines(j, now));
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

const getSetting = async (env: Env, key: string) => (await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
const putSetting = (env: Env, key: string, value: string) =>
  env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, value).run();

async function feedToken(env: Env, companyId: number, reset: boolean): Promise<string> {
  let token = await getSetting(env, `cal_token:${companyId}`);
  if (token && reset) {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(`cal_tok:${await sha256Hex(token)}`).run();
    token = null;
  }
  if (!token) {
    token = randomToken();
    await putSetting(env, `cal_token:${companyId}`, token);
    await putSetting(env, `cal_tok:${await sha256Hex(token)}`, String(companyId));
  }
  return token;
}

export interface CrewMember { name: string; email: string; phone: string; lang: "en" | "es" }

/** One crew member per line: Name, email, phone, es (the last part is optional and makes their emails Spanish). */
export function parseCrew(text: unknown): CrewMember[] {
  const out: CrewMember[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/).slice(0, 60)) {
    const parts = raw.split(",").map((p) => p.trim());
    const name = (parts[0] ?? "").replace(/\s+/g, " ").slice(0, 40);
    if (!name || out.some((m) => m.name.toLowerCase() === name.toLowerCase())) continue;
    const email = parts.find((p) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p))?.toLowerCase().slice(0, 200) ?? "";
    const phone = parts.slice(1).find((p) => /^[+()\d][\d\s().-]{6,}$/.test(p))?.slice(0, 30) ?? "";
    const lang = parts.slice(1).some((p) => /^(es|spanish|español)$/i.test(p)) ? "es" : "en";
    out.push({ name, email, phone, lang });
    if (out.length >= 30) break;
  }
  return out;
}
export const crewToText = (m: CrewMember[]) => m.map((c) => [c.name, c.email, c.phone, c.lang === "es" ? "es" : ""].filter((x, i) => i === 0 || x).join(", ")).join("\n");

export async function loadCrew(env: Env, companyId: number): Promise<CrewMember[]> {
  try {
    const v = await getSetting(env, `crew:${companyId}`);
    return v ? (JSON.parse(v) as CrewMember[]) : [];
  } catch {
    return [];
  }
}

/** GET returns the feed link and crew contacts. POST {action:"feed_reset"} makes a new feed link; POST {crew:"text"} saves crew contacts. */
export async function handleCalSettings(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    if (b?.action === "feed_reset") await feedToken(env, user.companyId, true);
    if (typeof b?.crew === "string") await putSetting(env, `crew:${user.companyId}`, JSON.stringify(parseCrew(b.crew)));
  }
  const token = await feedToken(env, user.companyId, false);
  const crew = await loadCrew(env, user.companyId);
  return json({ feedUrl: `${PUBLIC_BASE}/cal/${token}.ics`, crew: crewToText(crew), crewCount: crew.length });
}

/** Public: GET /cal/<token>.ics */
export async function handleFeed(request: Request, env: Env, scheduled: (companyId: number) => Promise<SchedJob[]>): Promise<Response> {
  const m = new URL(request.url).pathname.match(/^\/cal\/([a-f0-9]{64})\.ics$/);
  if (!m || request.method !== "GET") return new Response("Not found.", { status: 404 });
  const cid = await getSetting(env, `cal_tok:${await sha256Hex(m[1])}`);
  if (!cid) return new Response("Not found.", { status: 404 });
  const co = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(Number(cid)).first<{ name: string }>();
  if (!co) return new Response("Not found.", { status: 404 });
  const jobs = (await scheduled(Number(cid))).filter((j) => j.stage !== "closed" || j.end >= plusDays(new Date().toISOString().slice(0, 10), -60));
  return new Response(buildIcs(`${co.name} jobs`, jobs), { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300", "x-robots-tag": "noindex" } });
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin);
};

/** Emails the schedule to each assigned crew member who has an email address. Returns who was emailed and who has no email on file. */
export async function notifyCrew(env: Env, company: { name: string; replyTo: string | null }, job: SchedJob, roster: CrewMember[]): Promise<{ emailed: string[]; noEmail: string[]; failed: string[] }> {
  const res = { emailed: [] as string[], noEmail: [] as string[], failed: [] as string[] };
  const first = (job.customer || "").split(/\s+/)[0] ?? "";
  for (const name of job.crew) {
    const m = roster.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!m?.email) {
      res.noEmail.push(name);
      continue;
    }
    const es = m.lang === "es";
    const when = job.start === job.end ? job.start : `${job.start} - ${job.end}`;
    const body = es
      ? `Hola ${m.name},\n\nTrabajo: ${job.title}${first ? " (cliente: " + first + ")" : ""}\nFecha: ${when}${job.startTime ? " a las " + job.startTime : ""}\nDirección: ${job.address || "por confirmar"}\nEquipo: ${job.crew.join(", ")}\n${job.notes ? "Notas: " + job.notes + "\n" : ""}\nSe adjunta un archivo de calendario para agregarlo a su teléfono.\n\n${company.name}`
      : `Hi ${m.name},\n\nJob: ${job.title}${first ? " (customer: " + first + ")" : ""}\nDate: ${when}${job.startTime ? " at " + job.startTime : ""}\nAddress: ${job.address || "to be confirmed"}\nCrew: ${job.crew.join(", ")}\n${job.notes ? "Notes: " + job.notes + "\n" : ""}\nA calendar file is attached so you can add it to your phone.\n\n${company.name}`;
    const r = await sendCustomerEmail(env, m.email, company.name, company.replyTo, es ? `Su horario: ${job.title} - ${when}` : `Your schedule: ${job.title} - ${when}`, body, [{ filename: "job.ics", content: b64(buildIcs(`${company.name} jobs`, [job])) }]);
    (r === "sent" ? res.emailed : res.failed).push(name);
  }
  return res;
}

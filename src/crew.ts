import { getSessionUser } from "./auth.ts";
import { companyPlan } from "./files.ts";
import { todayLocal } from "./dates.ts";
import { DEFAULT_1099_CENTS, isDate, loadSettings, toCsv } from "./records.ts";
import { MAX_APPROVALS, MAX_REWORK, approvalKey, overtimeMinutes, overtimeWeeks, readApprovals, readRework, reworkKey, timeApprKey, usesApprovals, weekStart } from "./timesheet.ts";
import type { Env } from "./types.ts";

export { weekStart };

/**
 * Crew and hours: employees and 1099 contractors, weekly time sheets, payments, totals per job, week, month and year,
 * the year-end 1099 list, and a printable profile. Basic and Pro only; lower plans get a teaser.
 * We never store Social Security or tax ID numbers: only a "W-9 on file" file. Records for your accountant, not tax advice.
 */

const txt = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const UNITS = ["hour", "day", "job"] as const;
export type PayUnit = (typeof UNITS)[number];

export interface WorkerIn {
  name: string;
  kind: "employee" | "contractor";
  position: string;
  payCents: number;
  payUnit: PayUnit;
  startedOn: string | null;
  phone: string;
  email: string;
  notes: string;
}
export function cleanWorker(i: any): WorkerIn | { error: string } {
  const name = txt(i?.name, 80);
  if (!name) return { error: "Type the worker's name." };
  const pay = Math.round(Number(i?.payCents));
  return {
    name,
    kind: i?.kind === "contractor" ? "contractor" : "employee",
    position: txt(i?.position, 60),
    payCents: Number.isFinite(pay) && pay >= 0 && pay < 100_000_000 ? pay : 0,
    payUnit: (UNITS as readonly string[]).includes(i?.payUnit) ? i.payUnit : "hour",
    startedOn: isDate(i?.startedOn) ? i.startedOn : null,
    phone: txt(i?.phone, 30),
    email: txt(i?.email, 120),
    notes: txt(i?.notes, 1000),
  };
}

const hm = (s: unknown): number | null => {
  const m = typeof s === "string" ? s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/) : null;
  return m ? +m[1] * 60 + +m[2] : null;
};
export interface TimeIn {
  workerId: number;
  jobId: number | null;
  workDate: string;
  clockIn: string | null;
  clockOut: string | null;
  minutes: number;
  note: string;
}
/** Minutes come from clock in and clock out when both are given, otherwise from the hours typed in. */
export function cleanTime(i: any): TimeIn | { error: string } {
  if (!isDate(i?.workDate)) return { error: "Choose the date." };
  const a = hm(i?.clockIn);
  const b = hm(i?.clockOut);
  let minutes = 0;
  if (a !== null && b !== null) {
    if (b <= a) return { error: "Clock out must be after clock in on the same day." };
    minutes = b - a - Math.max(0, Math.round(Number(i?.breakMinutes) || 0));
    if (minutes <= 0) return { error: "The break is longer than the time worked." };
  } else {
    const h = Number(i?.hours);
    if (!Number.isFinite(h) || h <= 0 || h > 24) return { error: "Enter clock in and out, or the hours worked." };
    minutes = Math.round(h * 60);
  }
  return { workerId: Number(i?.workerId), jobId: Number(i?.jobId) > 0 ? Number(i.jobId) : null, workDate: i.workDate, clockIn: a !== null && b !== null ? i.clockIn : null, clockOut: a !== null && b !== null ? i.clockOut : null, minutes, note: txt(i?.note, 200) };
}

export interface Entry {
  jobId: number | null;
  workDate: string;
  minutes: number;
}
export const hoursOf = (min: number) => Math.round((min / 60) * 100) / 100;

/** How a worker was paid. Kept next to the payment so the accountant can see cash, checks and apps apart. */
export const PAY_METHODS = ["cash", "check", "direct_deposit", "zelle", "cash_app", "venmo", "paypal", "other"] as const;
export const cleanMethod = (v: unknown) => ((PAY_METHODS as readonly string[]).includes(v as string) ? (v as string) : "other");

/** Time off and attendance: days a worker was sick, on vacation, off for a holiday, absent, or late. */
export const ABSENCE_KINDS = ["sick", "vacation", "holiday", "absent", "late", "other"] as const;
export interface Absence {
  id: number;
  workerId: number;
  date: string;
  kind: string;
  hours: number; // paid hours for the day, optional
  note: string;
}
export function cleanAbsence(i: any): Omit<Absence, "id"> | { error: string } {
  if (!isDate(i?.date)) return { error: "Choose the date." };
  const workerId = Number(i?.workerId);
  if (!Number.isInteger(workerId) || workerId <= 0) return { error: "Choose a worker." };
  const kind = (ABSENCE_KINDS as readonly string[]).includes(i?.kind) ? i.kind : "other";
  const h = Number(i?.hours);
  return { workerId, date: i.date, kind, hours: Number.isFinite(h) && h > 0 && h <= 24 ? Math.round(h * 4) / 4 : 0, note: txt(i?.note, 200) };
}
/** Days per worker and kind, so the owner can see who calls in sick or misses days. */
export function absenceSummary(list: Pick<Absence, "workerId" | "kind" | "date">[]): Record<number, Record<string, number> & { last: string }> {
  const out: Record<number, Record<string, number> & { last: string }> = {};
  for (const a of list) {
    const o = (out[a.workerId] ??= { last: "" } as any);
    o[a.kind] = (o[a.kind] ?? 0) + 1;
    if (a.kind === "sick" || a.kind === "absent" || a.kind === "late") if (a.date > o.last) o.last = a.date;
  }
  return out;
}
const friendlyDate = (d: unknown) => {
  const t = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00Z") : null;
  return t && !isNaN(t.getTime()) ? t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : String(d ?? "");
};

/** What the worker earned by the pay rate, worked out in code. Per hour: hours. Per day: days worked. Per job: jobs worked. */
export function estimatePayCents(unit: PayUnit, payCents: number, entries: Entry[]): number {
  if (unit === "hour") return Math.round((entries.reduce((s, e) => s + e.minutes, 0) / 60) * payCents);
  if (unit === "day") return new Set(entries.map((e) => e.workDate)).size * payCents;
  return new Set(entries.filter((e) => e.jobId).map((e) => e.jobId)).size * payCents;
}

export function rollups(entries: Entry[]) {
  const add = (m: Record<string, number>, k: string, v: number) => (m[k] = (m[k] ?? 0) + v);
  const byWeek: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  const byJob: Record<string, number> = {};
  let total = 0;
  for (const e of entries) {
    total += e.minutes;
    add(byWeek, weekStart(e.workDate), e.minutes);
    add(byMonth, e.workDate.slice(0, 7), e.minutes);
    add(byJob, e.jobId ? String(e.jobId) : "none", e.minutes);
  }
  const h = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, hoursOf(v)]));
  return { totalHours: hoursOf(total), byWeek: h(byWeek), byMonth: h(byMonth), byJob: h(byJob) };
}

/** Contractors paid at least the threshold in the year. Employees get a W-2, so they are not on this list. */
export function list1099(workers: { id: number; name: string; kind: string; w9: boolean }[], payments: { workerId: number; amountCents: number }[], thresholdCents: number) {
  const tot: Record<number, number> = {};
  for (const p of payments) tot[p.workerId] = (tot[p.workerId] ?? 0) + p.amountCents;
  return workers
    .filter((w) => w.kind === "contractor")
    .map((w) => ({ id: w.id, name: w.name, w9: w.w9, paidCents: tot[w.id] ?? 0, crossed: (tot[w.id] ?? 0) >= thresholdCents && thresholdCents >= 0 && (tot[w.id] ?? 0) > 0 }))
    .sort((a, b) => b.paidCents - a.paidCents);
}

const yearOf = (v: string | null) => (v && /^\d{4}$/.test(v) ? v : String(new Date().getUTCFullYear()));

function b64(buf: ArrayBuffer) {
  let s = "";
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function renderProfile(d: { company: string; year: string; w: any; timeOff?: string; photoDataUrl?: string | null; months: [string, number][]; jobs: [string, number][]; payments: { paidOn: string; amountCents: number; note: string; jobTitle: string | null; method?: string; ref?: string }[]; paidCents: number; estimatedCents: number; hours: number }): string {
  const w = d.w;
  const unit = w.payUnit === "hour" ? "per hour" : w.payUnit === "day" ? "per day" : "per job";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(w.name)} - profile</title>
<style>body{font-family:Inter,system-ui,sans-serif;color:#0F1B2D;margin:0;background:#F7F5F1}main{max-width:760px;margin:0 auto;padding:18px 16px 50px}.sheet{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:22px}h1{font-family:Newsreader,Georgia,serif;font-weight:500;margin:0 0 4px}h3{margin:18px 0 6px}table{width:100%;border-collapse:collapse}th,td{padding:6px 4px;border-bottom:1px solid #eee;font-size:14px;text-align:left}td.r,th.r{text-align:right}.top{display:flex;gap:16px;align-items:center;flex-wrap:wrap}img{width:96px;height:96px;object-fit:cover;border-radius:50%}.muted{color:#4A5568;font-size:13px}button{padding:9px 14px;border:0;border-radius:8px;background:#E8A33D;font-weight:700;cursor:pointer}@media print{body{background:#fff}.noprint{display:none}.sheet{border:0;padding:0}}</style></head><body><main><div class="sheet">
<div class="top">${d.photoDataUrl ? `<img src="${d.photoDataUrl}" alt="">` : ""}<div><h1>${esc(w.name)}</h1><div class="muted">${esc(d.company)} &middot; ${w.kind === "contractor" ? "1099 contractor" : "Employee"}${w.position ? " &middot; " + esc(w.position) : ""}</div></div></div>
<table style="margin-top:12px"><tbody><tr><td>Start date</td><td>${esc(w.startedOn ? friendlyDate(w.startedOn) : "")}</td></tr><tr><td>Pay rate</td><td>${w.payCents ? money(w.payCents) + " " + unit : ""}</td></tr><tr><td>Phone</td><td>${esc(w.phone ?? "")}</td></tr><tr><td>Email</td><td>${esc(w.email ?? "")}</td></tr>${w.kind === "contractor" ? `<tr><td>W-9</td><td>${w.w9FileId ? "On file" : "Not on file"}</td></tr>` : ""}<tr><td>Notes</td><td>${esc(w.notes ?? "").replace(/\n/g, "<br>")}</td></tr></tbody></table>
<h3>${esc(d.year)} hours: ${d.hours}</h3>
${d.months.length ? `<table><thead><tr><th>Month</th><th class="r">Hours</th></tr></thead><tbody>${d.months.map(([m, h]) => `<tr><td>${esc(m)}</td><td class="r">${h}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No hours recorded.</p>'}
${d.jobs.length ? `<h3>Hours by job</h3><table><tbody>${d.jobs.map(([j, h]) => `<tr><td>${esc(j)}</td><td class="r">${h}</td></tr>`).join("")}</tbody></table>` : ""}
${d.timeOff ? `<h3>Time off and attendance in ${esc(d.year)}</h3><p>Days: ${esc(d.timeOff)}</p>` : ""}<h3>Pay in ${esc(d.year)}</h3><p>Worked out from the pay rate: <b>${money(d.estimatedCents)}</b> &middot; Payments recorded: <b>${money(d.paidCents)}</b></p>
${d.payments.length ? `<table><thead><tr><th>Paid on</th><th>Job</th><th>Note</th><th class="r">Amount</th></tr></thead><tbody>${d.payments.map((p) => `<tr><td>${esc(friendlyDate(p.paidOn))}</td><td>${esc(p.jobTitle ?? "")}</td><td>${esc([p.method ? String(p.method).replace(/_/g, " ") : "", p.ref, p.note].filter(Boolean).join(" - "))}</td><td class="r">${money(p.amountCents)}</td></tr>`).join("")}</tbody></table>` : ""}
<p class="muted" style="margin-top:18px">Records for your accountant, not tax advice. No Social Security or tax ID number is stored here.</p>
<p class="noprint"><button onclick="window.print()">Print or save as PDF</button></p></div></main></body></html>`;
}

// Payment methods and time-off days live in app_settings (no database change needed). Both are small lists per company.
const payKey = (c: number) => `crewpay:${c}`;
const absKey = (c: number) => `crewabs:${c}`;
async function loadBlob<T>(env: Env, key: string, fallback: T): Promise<T> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  try {
    return r ? (JSON.parse(r.value) as T) : fallback;
  } catch {
    return fallback;
  }
}
async function saveBlob(env: Env, key: string, v: unknown) {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, JSON.stringify(v)).run();
}
type PayMeta = Record<string, { method: string; ref: string }>;
type AbsBlob = { next: number; list: Absence[] };

/**
 * /api/crew   (Basic and Pro; other plans get {locked:true})
 *  GET                         workers with year totals
 *  GET ?report=1&year=         per worker rollups, estimated pay, payments, 1099 list
 *  GET ?timesheet=<workerId>&week=YYYY-MM-DD   that week's entries
 *  GET ?profile=<workerId>&year=   printable profile
 *  GET ?export=hours|payments|1099&year=       CSV
 *  GET ?export=hours|payments|1099|attendance&year=
 *  POST {action: saveWorker | removeWorker | addTime | deleteTime | setRework | approveWeek | unapproveWeek | addPayment | deletePayment | addAbsence | deleteAbsence}
 */
export async function handleCrew(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  const plan = await companyPlan(env, c);
  if (plan !== "basic" && plan !== "pro") return json({ locked: true, plan, message: "Crew pay, time sheets and the 1099 list are in Basic and Pro." });
  const u = new URL(request.url);
  const jobOwned = async (id: number | null) => id === null || !!(await env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").bind(id, c).first());
  const workerOwned = async (id: number) => (Number.isInteger(id) && id > 0 ? await env.DB.prepare("SELECT id FROM workers WHERE id = ? AND company_id = ?").bind(id, c).first() : null);

  if (request.method === "GET") {
    const year = yearOf(u.searchParams.get("year"));
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const workers = ((await env.DB.prepare("SELECT id, name, kind, position, pay_cents AS payCents, pay_unit AS payUnit, started_on AS startedOn, phone, email, notes, w9_file_id AS w9FileId, photo_file_id AS photoFileId, active FROM workers WHERE company_id = ? ORDER BY active DESC, name").bind(c).all<any>()).results ?? []) as any[];
    const jobs = ((await env.DB.prepare("SELECT j.id, j.title, cu.name AS customer FROM jobs j JOIN customers cu ON cu.id = j.customer_id WHERE j.company_id = ? ORDER BY j.id DESC LIMIT 300").bind(c).all<any>()).results ?? []) as any[];
    const jobTitle = (id: number | string) => jobs.find((j) => String(j.id) === String(id))?.title ?? (id === "none" ? "No job" : `Job ${id}`);
    const entriesOf = async (wid: number | null) => ((await env.DB.prepare(`SELECT id, worker_id AS workerId, job_id AS jobId, work_date AS workDate, minutes FROM time_entries WHERE company_id = ? AND work_date BETWEEN ? AND ?${wid ? " AND worker_id = ?" : ""}`).bind(...(wid ? [c, from, to, wid] : [c, from, to])).all<any>()).results ?? []) as (Entry & { workerId: number; id: number })[];
    const payments = ((await env.DB.prepare("SELECT p.id, p.worker_id AS workerId, p.job_id AS jobId, j.title AS jobTitle, p.paid_on AS paidOn, p.amount_cents AS amountCents, p.note FROM worker_payments p LEFT JOIN jobs j ON j.id = p.job_id WHERE p.company_id = ? AND p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on DESC, p.id DESC").bind(c, from, to).all<any>()).results ?? []) as any[];
    const settings = await loadSettings(env, c);
    const meta = await loadBlob<PayMeta>(env, payKey(c), {});
    const absAll = (await loadBlob<AbsBlob>(env, absKey(c), { next: 1, list: [] })).list;
    const absYear = absAll.filter((a) => a.date >= from && a.date <= to).sort((a, b) => (a.date < b.date ? 1 : -1));
    const approvals = readApprovals(await loadBlob<unknown>(env, timeApprKey(c), {}));
    const reworkIds = new Set(readRework(await loadBlob<unknown>(env, reworkKey(c), {})));
    for (const p of payments) {
      p.method = meta[String(p.id)]?.method ?? "";
      p.ref = meta[String(p.id)]?.ref ?? "";
    }

    const ex = u.searchParams.get("export");
    if (ex) {
      const head = { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="paintersmax-crew-${ex}-${year}.csv"`, "cache-control": "no-store" };
      const name = (id: number) => workers.find((w) => w.id === id)?.name ?? "";
      if (ex === "hours") {
        const rows = ((await env.DB.prepare("SELECT id, worker_id, job_id, work_date, clock_in, clock_out, minutes, note FROM time_entries WHERE company_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date, worker_id").bind(c, from, to).all<any>()).results ?? []) as any[];
        return new Response(toCsv([["Date", "Worker", "Job", "Clock in", "Clock out", "Hours", "Callback or rework", "Week approved", "Note"], ...rows.map((r) => [r.work_date, name(r.worker_id), r.job_id ? jobTitle(r.job_id) : "", r.clock_in, r.clock_out, hoursOf(r.minutes), reworkIds.has(r.id) ? "Yes" : "", approvals[approvalKey(r.worker_id, weekStart(r.work_date))]?.on ?? "", r.note])]), { headers: head });
      }
      if (ex === "payments") return new Response(toCsv([["Paid on", "Worker", "Type", "Job", "Amount", "Paid by", "Check number or reference", "Note"], ...payments.map((p) => [p.paidOn, name(p.workerId), workers.find((w) => w.id === p.workerId)?.kind ?? "", p.jobTitle ?? "", (p.amountCents / 100).toFixed(2), p.method ? p.method.replace(/_/g, " ") : "", p.ref, p.note])]), { headers: head });
      if (ex === "attendance") return new Response(toCsv([["Date", "Worker", "Type", "Paid hours", "Note"], ...[...absYear].reverse().map((a) => [a.date, name(a.workerId), a.kind, a.hours || "", a.note])]), { headers: head });
      if (ex === "1099") {
        const l = list1099(workers.map((w) => ({ id: w.id, name: w.name, kind: w.kind, w9: !!w.w9FileId })), payments, settings.threshold1099Cents);
        return new Response(toCsv([["Contractor", "Paid in year", "At or over threshold", "W-9 on file", `Threshold used: ${(settings.threshold1099Cents / 100).toFixed(2)} (confirm with your accountant or IRS.gov)`], ...l.map((x) => [x.name, (x.paidCents / 100).toFixed(2), x.crossed ? "Yes" : "No", x.w9 ? "Yes" : "No", ""])]), { headers: head });
      }
      return json({ error: "Unknown export." }, 400);
    }

    const pid = Number(u.searchParams.get("profile"));
    if (u.searchParams.has("profile")) {
      const w = workers.find((x) => x.id === pid);
      if (!w) return new Response("Not found.", { status: 404 });
      const ents = await entriesOf(pid);
      const r = rollups(ents);
      const co = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(c).first<{ name: string }>();
      let photo: string | null = null;
      if (w.photoFileId && env.FILES) {
        const f = await env.DB.prepare("SELECT r2_key AS k, mime FROM job_files WHERE id = ? AND company_id = ?").bind(w.photoFileId, c).first<{ k: string; mime: string }>();
        const obj = f ? await env.FILES.get(f.k) : null;
        if (f && obj && /^image\/(jpeg|png|webp)$/.test(f.mime)) photo = `data:${f.mime};base64,${b64(await obj.arrayBuffer())}`;
      }
      const mine = payments.filter((p) => p.workerId === pid);
      const off = absenceSummary(absYear.filter((a) => a.workerId === pid))[pid] ?? { last: "" };
      return new Response(renderProfile({ company: co?.name ?? "", year, w, photoDataUrl: photo, timeOff: ABSENCE_KINDS.filter((k) => off[k]).map((k) => `${k}: ${off[k]}`).join(", "), months: Object.entries(r.byMonth).sort() as [string, number][], jobs: Object.entries(r.byJob).map(([k, v]) => [jobTitle(k), v] as [string, number]), payments: mine, paidCents: mine.reduce((s, p) => s + p.amountCents, 0), estimatedCents: estimatePayCents(w.payUnit, w.payCents, ents), hours: r.totalHours }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }

    const wk = Number(u.searchParams.get("timesheet"));
    if (u.searchParams.has("timesheet")) {
      const day = isDate(u.searchParams.get("week")) ? weekStart(u.searchParams.get("week")!) : weekStart(new Date().toISOString().slice(0, 10));
      const end = new Date(day + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + 6);
      const rows = ((await env.DB.prepare("SELECT id, job_id AS jobId, work_date AS workDate, clock_in AS clockIn, clock_out AS clockOut, minutes, note FROM time_entries WHERE company_id = ? AND worker_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date, id").bind(c, wk, day, end.toISOString().slice(0, 10)).all<any>()).results ?? []) as any[];
      const endDay = end.toISOString().slice(0, 10);
      const totalMin = rows.reduce((s, r) => s + r.minutes, 0);
      const kind = workers.find((w) => w.id === wk)?.kind ?? "employee";
      const ap = approvals[approvalKey(wk, day)];
      return json({
        week: day,
        kind,
        entries: rows.map((r) => ({ ...r, hours: hoursOf(r.minutes), jobTitle: r.jobId ? jobTitle(r.jobId) : null, rework: reworkIds.has(r.id) })),
        absences: absAll.filter((a) => a.workerId === wk && a.date >= day && a.date <= endDay).sort((a, b) => (a.date < b.date ? -1 : 1)),
        totalHours: hoursOf(totalMin),
        overtimeHours: hoursOf(overtimeMinutes(totalMin, kind)),
        reworkHours: hoursOf(rows.filter((r) => reworkIds.has(r.id)).reduce((s, r) => s + r.minutes, 0)),
        approved: ap ? { on: ap.on, hours: hoursOf(ap.minutes) } : null,
        canApprove: day <= todayLocal() && totalMin > 0,
        usesApprovals: usesApprovals(approvals),
      });
    }

    const allEntries = await entriesOf(null);
    const per = workers.map((w) => {
      const ents = allEntries.filter((e) => e.workerId === w.id);
      const r = rollups(ents);
      const paid = payments.filter((p) => p.workerId === w.id).reduce((s, p) => s + p.amountCents, 0);
      const reworkHours = hoursOf(ents.filter((e) => reworkIds.has(e.id)).reduce((s, e) => s + e.minutes, 0));
      return { ...w, hours: r.totalHours, overtimeWeeks: overtimeWeeks(ents, w.kind).length, reworkHours, byWeek: r.byWeek, byMonth: r.byMonth, byJob: Object.fromEntries(Object.entries(r.byJob).map(([k, v]) => [jobTitle(k), v])), estimatedCents: estimatePayCents(w.payUnit, w.payCents, ents), paidCents: paid };
    });
    const list = list1099(workers.map((w) => ({ id: w.id, name: w.name, kind: w.kind, w9: !!w.w9FileId })), payments, settings.threshold1099Cents);
    return json({ year, workers: per, jobs, payments, list1099: list, threshold1099Cents: settings.threshold1099Cents || DEFAULT_1099_CENTS, plan, absences: absYear, absenceSummary: absenceSummary(absYear), payMethods: PAY_METHODS, absenceKinds: ABSENCE_KINDS, today: new Date().toISOString().slice(0, 10) });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  if (b?.action === "saveWorker") {
    const w = cleanWorker(b);
    if ("error" in w) return json({ error: w.error }, 400);
    if (b.id) {
      if (!(await workerOwned(Number(b.id)))) return json({ error: "Not found." }, 404);
      await env.DB.prepare("UPDATE workers SET name = ?, kind = ?, position = ?, pay_cents = ?, pay_unit = ?, started_on = ?, phone = ?, email = ?, notes = ?, active = ? WHERE id = ? AND company_id = ?").bind(w.name, w.kind, w.position, w.payCents, w.payUnit, w.startedOn, w.phone, w.email, w.notes, b.active === false ? 0 : 1, Number(b.id), c).run();
      return json({ ok: true, id: Number(b.id) });
    }
    const r = await env.DB.prepare("INSERT INTO workers (company_id, name, kind, position, pay_cents, pay_unit, started_on, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(c, w.name, w.kind, w.position, w.payCents, w.payUnit, w.startedOn, w.phone, w.email, w.notes).run();
    return json({ ok: true, id: Number(r.meta.last_row_id) });
  }
  if (b?.action === "removeWorker") {
    // Hours and pay records stay for your accountant: the worker is only hidden from the active list.
    await env.DB.prepare("UPDATE workers SET active = 0 WHERE id = ? AND company_id = ?").bind(Number(b.id), c).run();
    return json({ ok: true });
  }
  if (b?.action === "addTime") {
    const t = cleanTime(b);
    if ("error" in t) return json({ error: t.error }, 400);
    if (!(await workerOwned(t.workerId))) return json({ error: "Worker not found." }, 404);
    if (!(await jobOwned(t.jobId))) return json({ error: "Job not found." }, 404);
    const appr = readApprovals(await loadBlob<unknown>(env, timeApprKey(c), {}));
    if (appr[approvalKey(t.workerId, weekStart(t.workDate))]) return json({ error: "That week is approved. Unapprove it to change the hours." }, 400);
    const r = await env.DB.prepare("INSERT INTO time_entries (company_id, worker_id, job_id, work_date, clock_in, clock_out, minutes, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(c, t.workerId, t.jobId, t.workDate, t.clockIn, t.clockOut, t.minutes, t.note || null).run();
    const id = Number(r.meta.last_row_id);
    if (b.rework === true) {
      const ids = readRework(await loadBlob<unknown>(env, reworkKey(c), {}));
      if (ids.length < MAX_REWORK) await saveBlob(env, reworkKey(c), { ids: [...ids, id] });
    }
    return json({ ok: true, id });
  }
  if (b?.action === "deleteTime") {
    const id = Number(b.id);
    const row = await env.DB.prepare("SELECT worker_id AS w, work_date AS d FROM time_entries WHERE id = ? AND company_id = ?").bind(id, c).first<{ w: number; d: string }>();
    if (!row) return json({ ok: true });
    const appr = readApprovals(await loadBlob<unknown>(env, timeApprKey(c), {}));
    if (appr[approvalKey(row.w, weekStart(row.d))]) return json({ error: "That week is approved. Unapprove it to change the hours." }, 400);
    await env.DB.prepare("DELETE FROM time_entries WHERE id = ? AND company_id = ?").bind(id, c).run();
    const ids = readRework(await loadBlob<unknown>(env, reworkKey(c), {}));
    if (ids.includes(id)) await saveBlob(env, reworkKey(c), { ids: ids.filter((x) => x !== id) });
    return json({ ok: true });
  }
  if (b?.action === "setRework") {
    // A label only (this time was a callback or fixing earlier work), so it is allowed even in an approved week.
    const id = Number(b.id);
    const row = await env.DB.prepare("SELECT id FROM time_entries WHERE id = ? AND company_id = ?").bind(id, c).first();
    if (!row) return json({ error: "Not found." }, 404);
    const ids = readRework(await loadBlob<unknown>(env, reworkKey(c), {}));
    const next = b.rework === true ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((x) => x !== id);
    if (next.length > MAX_REWORK) return json({ error: "Too many callback records. Download your hours, then ask support to archive old years." }, 400);
    await saveBlob(env, reworkKey(c), { ids: next });
    return json({ ok: true, rework: next.includes(id) });
  }
  if (b?.action === "approveWeek" || b?.action === "unapproveWeek") {
    const wid = Number(b.workerId);
    if (!(await workerOwned(wid))) return json({ error: "Worker not found." }, 404);
    if (!isDate(b.week)) return json({ error: "Choose the week." }, 400);
    const wkd = weekStart(b.week);
    const appr = readApprovals(await loadBlob<unknown>(env, timeApprKey(c), {}));
    const key = approvalKey(wid, wkd);
    if (b.action === "unapproveWeek") {
      delete appr[key];
      await saveBlob(env, timeApprKey(c), appr);
      return json({ ok: true });
    }
    if (wkd > todayLocal()) return json({ error: "That week has not started yet." }, 400);
    const end = new Date(wkd + "T00:00:00Z");
    end.setUTCDate(end.getUTCDate() + 6);
    const sum = await env.DB.prepare("SELECT COALESCE(SUM(minutes), 0) AS m FROM time_entries WHERE company_id = ? AND worker_id = ? AND work_date BETWEEN ? AND ?").bind(c, wid, wkd, end.toISOString().slice(0, 10)).first<{ m: number }>();
    if (!sum?.m) return json({ error: "There are no hours that week to approve." }, 400);
    if (!appr[key] && Object.keys(appr).length >= MAX_APPROVALS) return json({ error: "Too many approved weeks. Download your hours, then ask support to archive old years." }, 400);
    appr[key] = { on: todayLocal(), minutes: sum.m };
    await saveBlob(env, timeApprKey(c), appr);
    return json({ ok: true, approved: { on: appr[key].on, hours: hoursOf(sum.m) } });
  }
  if (b?.action === "addPayment") {
    const cents = Math.round(Number(b.amountCents));
    if (!Number.isFinite(cents) || cents <= 0 || cents > 1_000_000_000) return json({ error: "Enter an amount greater than zero." }, 400);
    if (!isDate(b.paidOn)) return json({ error: "Choose the date." }, 400);
    if (!(await workerOwned(Number(b.workerId)))) return json({ error: "Worker not found." }, 404);
    const jobId = Number(b.jobId) > 0 ? Number(b.jobId) : null;
    if (!(await jobOwned(jobId))) return json({ error: "Job not found." }, 404);
    const r = await env.DB.prepare("INSERT INTO worker_payments (company_id, worker_id, job_id, paid_on, amount_cents, note) VALUES (?, ?, ?, ?, ?, ?)").bind(c, Number(b.workerId), jobId, b.paidOn, cents, txt(b.note, 200) || null).run();
    const id = Number(r.meta.last_row_id);
    const m = await loadBlob<PayMeta>(env, payKey(c), {});
    m[String(id)] = { method: cleanMethod(b.method), ref: txt(b.ref, 40) };
    await saveBlob(env, payKey(c), m);
    return json({ ok: true, id });
  }
  if (b?.action === "deletePayment") {
    await env.DB.prepare("DELETE FROM worker_payments WHERE id = ? AND company_id = ?").bind(Number(b.id), c).run();
    const m = await loadBlob<PayMeta>(env, payKey(c), {});
    if (m[String(Number(b.id))]) {
      delete m[String(Number(b.id))];
      await saveBlob(env, payKey(c), m);
    }
    return json({ ok: true });
  }
  if (b?.action === "addAbsence") {
    const a = cleanAbsence(b);
    if ("error" in a) return json({ error: a.error }, 400);
    if (!(await workerOwned(a.workerId))) return json({ error: "Worker not found." }, 404);
    const blob = await loadBlob<AbsBlob>(env, absKey(c), { next: 1, list: [] });
    if (blob.list.some((x) => x.workerId === a.workerId && x.date === a.date && x.kind === a.kind)) return json({ error: "That day is already recorded for this worker." }, 400);
    if (blob.list.length >= 4000) return json({ error: "Too many time-off records. Download them, then ask support to archive old years." }, 400);
    const id = blob.next;
    blob.list.push({ id, ...a });
    blob.next = id + 1;
    await saveBlob(env, absKey(c), blob);
    return json({ ok: true, id });
  }
  if (b?.action === "deleteAbsence") {
    const blob = await loadBlob<AbsBlob>(env, absKey(c), { next: 1, list: [] });
    blob.list = blob.list.filter((x) => x.id !== Number(b.id));
    await saveBlob(env, absKey(c), blob);
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}


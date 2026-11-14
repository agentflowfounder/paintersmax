import { addDaysIso, friendlyDate, friendlyTime, todayLocal } from "./dates.ts";
import { sendLeadEmail } from "./email.ts";
import { getSessionUser } from "./auth.ts";
import { readPayments } from "./payments.ts";
import { effectivePlan, type Plan } from "./usage.ts";
import { bookedVisits } from "./visit.ts";
import type { Env } from "./types.ts";

/**
 * Owner reminders ("notices"): one list of rules that all read the same facts and return the same kind of line.
 * Home shows the lines. A digest email sends the owner the new ones, at most once a day, at the hour they chose.
 *
 * Everything here is plain code on the painter's own records. No AI, so a reminder can never invent an amount or a date.
 * Customers are never contacted from here. Nothing in this file is tax or legal advice.
 *
 * Phase 1 covers money and leads. Other Home lines (insurance, vehicles, crew, account) are registered here too, so the
 * owner switches and the admin switches work for every line, but they are still produced where they always were.
 */

export type Group = "money" | "leads" | "jobs" | "crew" | "insurance" | "vehicles" | "account";
export const GROUP_LABELS: Record<Group, string> = {
  money: "Money coming in",
  leads: "Leads and selling",
  jobs: "Jobs in progress",
  crew: "Crew and time sheets",
  insurance: "Insurance",
  vehicles: "Vehicles",
  account: "Your PaintersMax account",
};

export interface Rule {
  id: string;
  group: Group;
  label: string; // plain words, shown on the Reminders page and in /admin
  digest: boolean; // may go in the digest email (Home always shows it)
  always?: boolean; // shown on every plan, never counted against the free plan's short list
}

/** Every reminder line the app can show. Adding a rule = one entry here plus the code that produces its line. */
export const RULES: Rule[] = [
  { id: "invoice_unpaid", group: "money", label: "Invoice sent and not paid (day 7, 14, 30, 60)", digest: true },
  { id: "estimate_followup", group: "money", label: "Estimate sent with no answer (day 3, 7, 14)", digest: true },
  { id: "deposit_missing", group: "money", label: "Customer signed but the deposit is not recorded", digest: true },
  { id: "change_order_waiting", group: "money", label: "Change order waiting on the customer", digest: true },
  { id: "lead_new", group: "leads", label: "New lead not answered", digest: true },
  { id: "visit_soon", group: "leads", label: "Site visit today or tomorrow", digest: true },
  { id: "visit_stale", group: "leads", label: "Site visit passed and still marked as booked", digest: false },
  { id: "visit_no_estimate", group: "leads", label: "Visit done but no estimate sent yet", digest: true },
  { id: "past_customer", group: "leads", label: "Past customer check-in, about a year after the job", digest: true },
  { id: "calendar_gap", group: "leads", label: "Few jobs booked in the next 3 weeks", digest: true },
  { id: "signature", group: "jobs", label: "Customer opened a document but has not signed, or the link expires soon", digest: false },
  { id: "signoff", group: "jobs", label: "Customer sign-off waiting, or a note from the customer", digest: false },
  { id: "start_due", group: "jobs", label: "Start date reached and the job is not started", digest: false },
  { id: "timesheet", group: "crew", label: "Time sheets: overtime, an empty week, waiting for approval", digest: false },
  { id: "insurance", group: "insurance", label: "Your insurance policy: missing, expiring, or a job that may not be covered", digest: false, always: true },
  { id: "vehicle", group: "vehicles", label: "Vehicle service, insurance, registration and loan dates", digest: false, always: true },
  { id: "billing", group: "account", label: "Free trial ending or a failed PaintersMax payment", digest: false, always: true },
  { id: "setup", group: "account", label: "Finish setting up your prices", digest: false, always: true },
  { id: "credits", group: "account", label: "AI credits running out", digest: false, always: true },
  { id: "nudge", group: "account", label: "Tips for using PaintersMax", digest: false, always: true },
];
const RULE = new Map(RULES.map((r) => [r.id, r]));
/** Rules whose lines come from evaluate() below, so they can go in the email. The other groups join in later phases. */
export const inEmailEngine = (r: Rule) => r.group === "money" || r.group === "leads";
/** The Home "type" tags used before the registry existed, mapped to their rule. */
export const TYPE_RULE: Record<string, string> = { signature: "signature", signoff: "signoff", start: "start_due", timesheet: "timesheet", insurance: "insurance", vehicle: "vehicle", billing: "billing", setup: "setup", credits: "credits", nudge: "nudge" };

export interface Line {
  rule: string;
  type: string; // the tag Home shows (lead, estimate, invoice, visit ...)
  text: string;
  es: string;
  jobId?: number;
  link?: string;
  urgency: number; // higher first
  key: string; // what the digest remembers, so the same step is emailed once
}

// ---------- The facts the rules read ----------
export interface Facts {
  today: string;
  leads: { jobId: number; customer: string; title: string; days: number }[];
  estimates: { jobId: number; customer: string; title: string; days: number }[];
  invoices: { jobId: number; customer: string; title: string; days: number }[];
  signedNoDeposit: { jobId: number; customer: string; title: string; days: number; depositCents: number }[];
  changeOrders: { jobId: number; customer: string; title: string; days: number; number: number }[];
  visits: { jobId: number; customer: string; address: string; date: string; time: string }[];
  visitsDone: { jobId: number; customer: string; title: string; days: number }[];
  anniversaries: { jobId: number; customer: string; title: string }[];
  bookedNext21: number;
  openEstimates: number;
}

const step = (days: number, steps: number[]) => steps.filter((s) => days >= s).pop() ?? steps[0];
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const mondayOf = (d: string) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};

/** Turns the facts into lines. Pure: the same facts always give the same lines. */
export function evaluate(f: Facts): Line[] {
  const out: Line[] = [];
  for (const r of f.invoices) {
    const who = `${r.customer}, ${r.title}`;
    const s = step(r.days, [7, 14, 30, 60]);
    const text = s >= 60 ? `Invoice sent ${r.days} days ago and still not paid: ${who}. Decide whether to keep chasing it or write it off with your accountant.` : s >= 30 ? `Invoice sent ${r.days} days ago and still not paid: ${who}. Call the customer today.` : `Invoice sent ${r.days} days ago and not marked paid: ${who}`;
    const es = s >= 60 ? `Factura enviada hace ${r.days} días y todavía sin pagar: ${who}. Decida si sigue cobrándola o la da por perdida con su contador.` : s >= 30 ? `Factura enviada hace ${r.days} días y todavía sin pagar: ${who}. Llame al cliente hoy.` : `Factura enviada hace ${r.days} días y no marcada como pagada: ${who}`;
    out.push({ rule: "invoice_unpaid", type: "invoice", jobId: r.jobId, text, es, urgency: 80 + Math.min(r.days, 60) / 6, key: `invoice_unpaid:${r.jobId}:${s}` });
  }
  for (const r of f.leads) {
    const who = `${r.customer}, ${r.title}`;
    out.push({ rule: "lead_new", type: "lead", jobId: r.jobId, text: `New lead waiting ${r.days} day${r.days === 1 ? "" : "s"}: ${who}`, es: `Cliente potencial esperando ${r.days} ${plural(r.days, "día", "días")}: ${who}`, urgency: 90, key: `lead_new:${r.jobId}:${step(r.days, [1, 3, 7])}` });
  }
  for (const r of f.signedNoDeposit) {
    const who = `${r.customer}, ${r.title}`;
    out.push({ rule: "deposit_missing", type: "deposit", jobId: r.jobId, text: `Signed ${r.days} days ago and the ${usd(r.depositCents)} deposit is not recorded yet: ${who}. Collect it, or record it on the job if it came in.`, es: `Firmado hace ${r.days} días y el depósito de ${usd(r.depositCents)} todavía no está registrado: ${who}. Cóbrelo, o regístrelo en el trabajo si ya llegó.`, urgency: 78, key: `deposit_missing:${r.jobId}` });
  }
  for (const r of f.estimates) {
    const who = `${r.customer}, ${r.title}`;
    out.push({ rule: "estimate_followup", type: "estimate", jobId: r.jobId, text: `Estimate sent ${r.days} days ago, no answer yet: ${who}`, es: `Presupuesto enviado hace ${r.days} días, sin respuesta todavía: ${who}`, urgency: 70, key: `estimate_followup:${r.jobId}:${step(r.days, [3, 7, 14])}` });
  }
  for (const r of f.changeOrders) {
    const who = `${r.customer}, ${r.title}`;
    out.push({ rule: "change_order_waiting", type: "change", jobId: r.jobId, text: `Change order CO-${r.number} was sent ${r.days} days ago and the customer has not answered: ${who}. Get a yes before the crew does the extra work.`, es: `La orden de cambio CO-${r.number} se envió hace ${r.days} días y el cliente no ha respondido: ${who}. Consiga el sí antes de que la cuadrilla haga el trabajo extra.`, urgency: 60, key: `change_order_waiting:${r.jobId}:${r.number}` });
  }
  for (const v of f.visits) {
    const at = friendlyTime(v.time) ? ` at ${friendlyTime(v.time)}` : "";
    const atEs = friendlyTime(v.time) ? ` a las ${friendlyTime(v.time)}` : "";
    const who = `${v.customer}${v.address ? ", " + v.address : ""}`;
    if (v.date === f.today) out.push({ rule: "visit_soon", type: "visit", jobId: v.jobId, text: `Site visit today${at}: ${who}`, es: `Visita al sitio hoy${atEs}: ${who}`, urgency: 100, key: `visit_soon:${v.jobId}:${v.date}:0` });
    else if (v.date === addDaysIso(f.today, 1)) out.push({ rule: "visit_soon", type: "visit", jobId: v.jobId, text: `Site visit tomorrow${at}: ${who}`, es: `Visita al sitio mañana${atEs}: ${who}`, urgency: 85, key: `visit_soon:${v.jobId}:${v.date}:1` });
    else if (v.date < f.today) out.push({ rule: "visit_stale", type: "visit", jobId: v.jobId, text: `The site visit on ${friendlyDate(v.date)} is still marked as booked. Open the job and mark it done, or book a new time: ${v.customer}`, es: `La visita al sitio del ${friendlyDate(v.date, "es")} sigue marcada como reservada. Abra el trabajo y márquela como hecha, o reserve otra hora: ${v.customer}`, urgency: 40, key: `visit_stale:${v.jobId}:${v.date}` });
  }
  for (const r of f.visitsDone) {
    const who = `${r.customer}, ${r.title}`;
    out.push({ rule: "visit_no_estimate", type: "estimate", jobId: r.jobId, text: `You visited ${r.days} days ago and no estimate is sent yet: ${who}. Send it while the visit is fresh.`, es: `Usted visitó hace ${r.days} días y todavía no se envía el presupuesto: ${who}. Envíelo mientras la visita está fresca.`, urgency: 65, key: `visit_no_estimate:${r.jobId}` });
  }
  for (const r of f.anniversaries) {
    out.push({ rule: "past_customer", type: "lead", jobId: r.jobId, text: `It is almost a year since you finished ${r.title} for ${r.customer}. A friendly check-in can bring repeat work and referrals.`, es: `Ya casi pasa un año desde que terminó ${r.title} para ${r.customer}. Un saludo amable puede traer más trabajo y recomendaciones.`, urgency: 20, key: `past_customer:${r.jobId}` });
  }
  if (f.bookedNext21 < 2 && f.openEstimates > 0) {
    const n = f.openEstimates;
    out.push({ rule: "calendar_gap", type: "lead", link: "/jobs", text: `Your calendar is light for the next 3 weeks, and ${n} estimate${n === 1 ? " is" : "s are"} still waiting for an answer. This is a good week to follow up.`, es: `Su calendario está ligero para las próximas 3 semanas, y ${n} ${plural(n, "presupuesto sigue", "presupuestos siguen")} esperando respuesta. Es una buena semana para dar seguimiento.`, urgency: 30, key: `calendar_gap:${mondayOf(f.today)}` });
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

const daysSince = (ts: unknown, now: number): number => {
  const s = String(ts ?? "");
  const t = Date.parse(/T/.test(s) ? s : s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : 0;
};

/** One pass over the company's records. The rules never run their own queries. */
export async function loadFacts(env: Env, c: number, now: number = Date.now()): Promise<Facts> {
  const today = todayLocal(now);
  const all = async <T>(sql: string, ...b: unknown[]): Promise<T[]> => ((await env.DB.prepare(sql).bind(...b).all<T>().catch(() => ({ results: [] as T[] }))).results ?? []) as T[];
  const [leads, estimates, invoices, signed, cos, visits, done, anniv, booked, openEst] = await Promise.all([
    all<any>(`SELECT j.id, j.title, cu.name AS customer, CAST((julianday('now') - julianday(j.created_at)) AS INTEGER) AS days FROM jobs j JOIN customers cu ON cu.id = j.customer_id
              WHERE j.company_id = ? AND j.stage = 'lead' AND j.created_at < datetime('now','-1 day') ORDER BY j.created_at LIMIT 8`, c),
    all<any>(`SELECT j.id, j.title, cu.name AS customer, CAST((julianday('now') - julianday(d.updated_at)) AS INTEGER) AS days FROM documents d JOIN jobs j ON j.id = d.job_id JOIN customers cu ON cu.id = j.customer_id
              WHERE d.company_id = ? AND d.kind = 'estimate' AND d.status = 'sent' AND d.updated_at < datetime('now','-3 days') AND j.stage IN ('lead','bid') ORDER BY d.updated_at LIMIT 8`, c),
    all<any>(`SELECT j.id, j.title, cu.name AS customer, CAST((julianday('now') - julianday(d.updated_at)) AS INTEGER) AS days FROM documents d JOIN jobs j ON j.id = d.job_id JOIN customers cu ON cu.id = j.customer_id
              WHERE d.company_id = ? AND d.kind = 'invoice' AND d.status = 'sent' AND d.updated_at < datetime('now','-7 days') ORDER BY d.updated_at LIMIT 8`, c),
    all<any>(`SELECT j.id, j.title, cu.name AS customer, MAX(s.signed_at) AS signedAt,
                     (SELECT json_extract(d.body,'$.totals.depositCents') FROM documents d WHERE d.job_id = j.id AND d.kind = 'estimate' ORDER BY d.id DESC LIMIT 1) AS dep
                FROM signature_requests s JOIN jobs j ON j.id = s.job_id JOIN customers cu ON cu.id = j.customer_id
               WHERE s.company_id = ? AND s.status = 'signed' AND j.stage IN ('contract','scheduled') GROUP BY j.id ORDER BY signedAt LIMIT 15`, c),
    all<any>(`SELECT w.job_id AS id, w.number, w.sent_at AS sentAt, j.title, cu.name AS customer FROM work_orders w JOIN jobs j ON j.id = w.job_id JOIN customers cu ON cu.id = j.customer_id
               WHERE w.company_id = ? AND w.kind = 'change_order' AND w.status = 'sent' AND j.stage NOT IN ('lost','closed') ORDER BY w.sent_at LIMIT 10`, c),
    bookedVisits(env, c).catch(() => []),
    all<any>(`SELECT j.id, j.title, cu.name AS customer, json_extract(j.data,'$.visit.date') AS date FROM jobs j JOIN customers cu ON cu.id = j.customer_id
               WHERE j.company_id = ? AND j.stage = 'lead' AND json_extract(j.data,'$.visit.status') = 'done' AND json_extract(j.data,'$.visit.date') <= ? ORDER BY date LIMIT 8`, c, addDaysIso(today, -2)),
    all<any>(`SELECT j.id, j.title, cu.name AS customer FROM jobs j JOIN customers cu ON cu.id = j.customer_id
               WHERE j.company_id = ? AND j.stage = 'closed' AND j.updated_at BETWEEN datetime('now','-342 days') AND datetime('now','-335 days') ORDER BY j.updated_at LIMIT 5`, c),
    all<any>(`SELECT COUNT(*) AS n FROM jobs WHERE company_id = ? AND stage IN ('contract','scheduled','in_progress') AND json_extract(data,'$.schedule.start') BETWEEN ? AND ?`, c, today, addDaysIso(today, 21)),
    all<any>(`SELECT COUNT(*) AS n FROM documents d JOIN jobs j ON j.id = d.job_id WHERE d.company_id = ? AND d.kind = 'estimate' AND d.status = 'sent' AND j.stage IN ('lead','bid')`, c),
  ]);
  // Deposit check: signed at least 2 days ago, the estimate asked for a deposit, and no payment is recorded on the job.
  const cand = signed.filter((r) => Number(r.dep) > 0 && daysSince(r.signedAt, now) >= 2);
  let paidJobs = new Set<number>();
  if (cand.length) {
    const keys = cand.map((r) => `jobpay:${c}:${r.id}`);
    const rows = await all<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => "?").join(",")})`, ...keys);
    paidJobs = new Set(rows.filter((r) => readPayments(r.value).length > 0).map((r) => Number(r.key.split(":")[2])));
  }
  const row = (r: any) => ({ jobId: Number(r.id), customer: String(r.customer ?? ""), title: String(r.title ?? ""), days: Number(r.days) || 0 });
  return {
    today,
    leads: leads.map(row),
    estimates: estimates.map(row),
    invoices: invoices.map(row),
    signedNoDeposit: cand.filter((r) => !paidJobs.has(Number(r.id))).map((r) => ({ ...row(r), days: daysSince(r.signedAt, now), depositCents: Math.round(Number(r.dep)) })),
    changeOrders: cos.map((r) => ({ ...row(r), days: daysSince(r.sentAt, now), number: Number(r.number) })).filter((r) => r.days >= 2),
    visits: (visits as any[]).slice(0, 20).map((v) => ({ jobId: v.jobId, customer: v.customer, address: v.address, date: v.date, time: v.time })),
    visitsDone: done.map((r) => ({ ...row(r), days: Math.max(2, Math.round((Date.parse(today) - Date.parse(String(r.date))) / 86400000) || 2) })),
    anniversaries: anniv.map((r) => ({ jobId: Number(r.id), customer: String(r.customer ?? ""), title: String(r.title ?? "") })),
    bookedNext21: Number(booked[0]?.n) || 0,
    openEstimates: Number(openEst[0]?.n) || 0,
  };
}

// ---------- Settings: the owner's, and the admin's switches ----------
export const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"] as const;
export interface OwnerSettings {
  digest: boolean;
  hour: number; // 0-23, the owner's local hour
  tz: string;
  groupsOff: Group[];
  lastDigest: string; // the local day the digest step last ran
  sent: Record<string, string>; // line key -> day it was emailed
}
export const DEFAULT_SETTINGS: OwnerSettings = { digest: true, hour: 7, tz: "America/Chicago", groupsOff: [], lastDigest: "", sent: {} };
const OFFABLE: Group[] = ["money", "leads", "jobs", "crew", "vehicles"]; // insurance and account lines cannot be switched off

export function readSettings(raw: unknown): OwnerSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const hour = Math.round(Number(r.hour));
  const sent: Record<string, string> = {};
  if (r.sent && typeof r.sent === "object") for (const [k, v] of Object.entries(r.sent)) if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && k.length <= 80) sent[k] = v;
  return {
    digest: r.digest !== false,
    hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_SETTINGS.hour,
    tz: (ZONES as readonly string[]).includes(r.tz) ? r.tz : DEFAULT_SETTINGS.tz,
    groupsOff: Array.isArray(r.groupsOff) ? OFFABLE.filter((g) => r.groupsOff.includes(g)) : [],
    lastDigest: typeof r.lastDigest === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.lastDigest) ? r.lastDigest : "",
    sent,
  };
}

/** Admin switches, one per rule and place. "all" turns the line on for every plan, "off" turns it off for everyone. */
export type Switch = "default" | "off" | "all";
export type AdminSwitches = Record<string, { home: Switch; digest: Switch }>;
export const ADMIN_KEY = "noticeadmin";
const sw = (v: unknown): Switch => (v === "off" || v === "all" ? v : "default");
export function readAdmin(raw: unknown): AdminSwitches {
  const out: AdminSwitches = {};
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  for (const rule of RULES) {
    const home = sw(r[rule.id]?.home);
    const digest = sw(r[rule.id]?.digest);
    if (home !== "default" || digest !== "default") out[rule.id] = { home, digest };
  }
  return out;
}

const getBlob = async (env: Env, key: string): Promise<unknown> => {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>().catch(() => null);
  try {
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
};
const putBlob = (env: Env, key: string, v: unknown) => env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, JSON.stringify(v)).run();
export const settingsKey = (c: number) => `notices:${c}`;
export const loadSettings = async (env: Env, c: number) => readSettings(await getBlob(env, settingsKey(c)));
export const loadAdmin = async (env: Env) => readAdmin(await getBlob(env, ADMIN_KEY));

// ---------- Who sees what ----------
export const FREE_HOME_LINES = 3;

/**
 * Home list for a plan. Paid plans (and the trial) see every line. The free plan sees the lines that are always on
 * (insurance, vehicles, account), any line the admin turned on for all plans, the first few of the rest, and a count of what is hidden.
 * `ruleOf` gives the rule id of a line. Lines with no rule are always kept.
 */
export function gateHome<T>(lines: T[], ruleOf: (l: T) => string | undefined, plan: Plan, admin: AdminSwitches, owner: Pick<OwnerSettings, "groupsOff">): { lines: T[]; hidden: number } {
  const kept: T[] = [];
  let free = 0;
  let hidden = 0;
  for (const l of lines) {
    const rule = RULE.get(ruleOf(l) ?? "");
    if (!rule) {
      kept.push(l);
      continue;
    }
    const s = admin[rule.id]?.home ?? "default";
    if (s === "off") continue;
    if (owner.groupsOff.includes(rule.group)) continue;
    if (plan !== "free" || rule.always || s === "all") kept.push(l);
    else if (free < FREE_HOME_LINES) {
      free++;
      kept.push(l);
    } else hidden++;
  }
  return { lines: kept, hidden };
}

export type DigestMode = "none" | "weekly" | "daily";
/** Free: no digest. Starter: one on Monday. Basic and Pro (and the trial): daily, only when something is new. */
export const digestMode = (plan: Plan): DigestMode => (plan === "free" ? "none" : plan === "starter" ? "weekly" : "daily");

/** The lines that go in today's email. Daily: only steps not emailed before. Weekly: everything open, on Monday. */
export function digestLines(lines: Line[], o: { plan: Plan; admin: AdminSwitches; settings: OwnerSettings; monday: boolean }): Line[] {
  const mode = digestMode(o.plan);
  return lines.filter((l) => {
    const rule = RULE.get(l.rule);
    if (!rule) return false;
    const s = o.admin[rule.id]?.digest ?? "default";
    if (s === "off" || o.settings.groupsOff.includes(rule.group)) return false;
    if (!rule.digest && s !== "all") return false; // Home-only by default; the admin can still put it in the email
    const fresh = !o.settings.sent[l.key];
    if (s === "all") return fresh; // the admin turned this line on for every plan: daily, new steps only
    if (mode === "daily") return fresh;
    if (mode === "weekly") return o.monday;
    return false;
  });
}

export const DIGEST_MAX = 5;
const hh = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

export function digestEmail(o: { company: string; lines: Line[]; openTotal: number; es: boolean; hour: number; origin?: string }): { subject: string; text: string } {
  const base = o.origin ?? "https://paintersmax.app";
  const top = o.lines.slice(0, DIGEST_MAX);
  const more = Math.max(0, o.openTotal - top.length);
  const n = top.length;
  const list = top.map((l, i) => `${i + 1}. ${o.es ? l.es : l.text}\n   ${base}${l.jobId ? `/jobs?id=${l.jobId}` : l.link ?? "/dashboard"}`).join("\n\n");
  if (o.es) {
    return {
      subject: `Hoy en ${o.company}: ${n} ${plural(n, "cosa", "cosas")} por revisar`,
      text: `Buenos días. Esto es lo que necesita su atención hoy en ${o.company}.\n\n${list}\n\n${more ? `Tiene ${more} ${plural(more, "recordatorio más", "recordatorios más")} en su pantalla de Inicio: ${base}/dashboard\n\n` : ""}Recibe este correo a las ${hh(o.hour)} solo los días en que hay algo nuevo. Cambie la hora o apáguelo aquí: ${base}/reminders`,
    };
  }
  return {
    subject: `Today at ${o.company}: ${n} thing${n === 1 ? "" : "s"} to look at`,
    text: `Good morning. Here is what needs you today at ${o.company}.\n\n${list}\n\n${more ? `You have ${more} more reminder${more === 1 ? "" : "s"} on your Home screen: ${base}/dashboard\n\n` : ""}You get this email at ${hh(o.hour)} only on days when something is new. Change the time or turn it off here: ${base}/reminders`,
  };
}

/** The owner's local hour, day and weekday, from the time zone they chose. */
export function localClock(now: number, tz: string): { hour: number; date: string; monday: boolean } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour) % 24, date: `${p.year}-${p.month}-${p.day}`, monday: p.weekday === "Mon" };
}

const pruneSent = (sent: Record<string, string>, today: string) => Object.fromEntries(Object.entries(sent).filter(([, d]) => d >= addDaysIso(today, -120)));

/**
 * Run from the 5-minute check. For each company whose local time is inside its digest hour and that has not had today's
 * step yet: work out the lines, email the new ones (if any), and remember what was sent. Returns how many emails went out.
 */
export async function sendOwnerDigests(env: Env, now: number = Date.now()): Promise<number> {
  if (!env.RESEND_API_KEY) return 0;
  const rows = ((await env.DB.prepare(
    `SELECT co.id, co.name, co.plan, co.created_at AS createdAt, co.notify_email AS notify,
            (SELECT email FROM users WHERE company_id = co.id ORDER BY id LIMIT 1) AS owner,
            (SELECT value FROM app_settings WHERE key = 'notices:' || co.id) AS settings,
            (SELECT json_extract(data,'$.language.ui') FROM company_profiles WHERE company_id = co.id) AS lang
       FROM companies co`,
  ).all<any>()).results ?? []) as any[];
  const admin = await loadAdmin(env);
  const anyAll = Object.values(admin).some((s) => s.digest === "all");
  let sentCount = 0;
  for (const r of rows) {
    let parsed: unknown = null;
    try {
      parsed = r.settings ? JSON.parse(r.settings) : null;
    } catch {
      parsed = null;
    }
    const settings = readSettings(parsed);
    const plan = effectivePlan({ plan: r.plan, createdAt: r.createdAt }, now);
    if (!settings.digest || (digestMode(plan) === "none" && !anyAll)) continue;
    const clock = localClock(now, settings.tz);
    if (clock.hour !== settings.hour || settings.lastDigest === clock.date) continue;
    const to = r.notify || r.owner;
    const all = evaluate(await loadFacts(env, r.id, now));
    const lines = to ? digestLines(all, { plan, admin, settings, monday: clock.monday }) : [];
    let ok = true;
    if (lines.length) {
      const open = all.filter((l) => (admin[l.rule]?.home ?? "default") !== "off").length;
      const mail = digestEmail({ company: r.name, lines, openTotal: open, es: r.lang === "es", hour: settings.hour });
      ok = (await sendLeadEmail(env, to, mail.subject, mail.text)) === "sent";
      if (ok) sentCount++;
    }
    if (!ok) continue; // the email failed: try again at the next check
    const sent = pruneSent(settings.sent, clock.date);
    for (const l of lines.slice(0, DIGEST_MAX)) sent[l.key] = clock.date;
    await putBlob(env, settingsKey(r.id), { ...settings, lastDigest: clock.date, sent });
  }
  return sentCount;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * /api/notices (signed in)
 *  GET   the owner's settings, what their plan gets, the groups, and what today's email would say
 *  POST  {digest, hour, tz, groupsOff}
 */
export async function handleNotices(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  const co = await env.DB.prepare("SELECT name, plan, created_at AS createdAt, notify_email AS notify FROM companies WHERE id = ?").bind(c).first<{ name: string; plan: string; createdAt: string; notify: string | null }>();
  if (!co) return json({ error: "Not found." }, 404);
  const settings = await loadSettings(env, c);
  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const next = readSettings({ ...settings, digest: b?.digest !== false, hour: b?.hour, tz: b?.tz, groupsOff: b?.groupsOff });
    await putBlob(env, settingsKey(c), next);
    return json({ ok: true });
  }
  if (request.method !== "GET") return json({ error: "Not found." }, 404);
  const plan = effectivePlan(co);
  const admin = await loadAdmin(env);
  const all = evaluate(await loadFacts(env, c));
  const clock = localClock(Date.now(), settings.tz);
  const forced = Object.values(admin).some((s) => s.digest === "all");
  const preview = digestLines(all, { plan, admin, settings: { ...settings, sent: {} }, monday: true }).slice(0, DIGEST_MAX);
  return json({
    plan,
    mode: digestMode(plan) === "none" && forced ? "daily" : digestMode(plan),
    email: co.notify || user.email,
    settings: { digest: settings.digest, hour: settings.hour, tz: settings.tz, groupsOff: settings.groupsOff },
    zones: ZONES,
    localTime: clock,
    groups: (Object.keys(GROUP_LABELS) as Group[]).map((g) => ({
      id: g,
      label: GROUP_LABELS[g],
      canTurnOff: OFFABLE.includes(g),
      rules: RULES.filter((r) => r.group === g && (admin[r.id]?.home ?? "default") !== "off").map((r) => ({ label: r.label, digest: inEmailEngine(r) && (admin[r.id]?.digest === "all" || (r.digest && admin[r.id]?.digest !== "off")) })),
    })),
    preview: preview.map((l) => ({ text: l.text, es: l.es, jobId: l.jobId, link: l.link })),
  });
}

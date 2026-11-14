import { getSessionUser } from "./auth.ts";
import { todayLocal } from "./dates.ts";
import { contractTotal, loadPayments, readPayments, sumPaid } from "./payments.ts";
import { loadSettings } from "./records.ts";
import type { Env } from "./types.ts";

/**
 * Business pulse: one screen that shows money in and out, profit, what customers owe, and a few costs, with an up or down arrow
 * against last month. Everything is plain math on records the painter already keeps (payments on jobs, expenses, crew payments,
 * mileage). No bank connection and no AI. It is "records for your accountant", not tax advice, and it is on a cash basis: money
 * counts on the day it was recorded as received or spent.
 */

export interface Dated {
  on: string; // YYYY-MM-DD
  cents: number;
}
export interface PulseInput {
  payments: Dated[];
  expenses: (Dated & { category: string })[];
  crewPay: Dated[];
  trips: { on: string; miles: number }[];
  mileageRateCents: number | null;
}
export interface MonthRow {
  m: string; // YYYY-MM
  moneyInCents: number;
  expensesCents: number;
  crewPayCents: number;
  moneyOutCents: number;
  profitCents: number;
  materialsCents: number;
  vehicleCents: number;
  miles: number;
  mileageValueCents: number | null;
}

/** The last n month keys, oldest first, ending with the month that holds `today`. */
export function monthKeys(today: string, n = 6): string[] {
  const [y, mo] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(Date.UTC(y, mo - 1 - i, 1));
    out.push(t.toISOString().slice(0, 7));
  }
  return out;
}

const VEHICLE_CATEGORIES = ["Fuel", "Vehicle"];

/** One row per month. With `throughDay`, only counts days 1..throughDay of every month (so "last month so far" is fair). */
export function buildMonths(input: PulseInput, months: string[], throughDay = 31): MonthRow[] {
  const rows = new Map<string, MonthRow>(months.map((m) => [m, { m, moneyInCents: 0, expensesCents: 0, crewPayCents: 0, moneyOutCents: 0, profitCents: 0, materialsCents: 0, vehicleCents: 0, miles: 0, mileageValueCents: null }]));
  const slot = (d: string) => (Number(d.slice(8, 10)) <= throughDay ? rows.get(d.slice(0, 7)) : undefined);
  for (const p of input.payments) {
    const r = slot(p.on);
    if (r) r.moneyInCents += p.cents;
  }
  for (const e of input.expenses) {
    const r = slot(e.on);
    if (!r) continue;
    r.expensesCents += e.cents;
    if (e.category === "Materials") r.materialsCents += e.cents;
    if (VEHICLE_CATEGORIES.includes(e.category)) r.vehicleCents += e.cents;
  }
  for (const c of input.crewPay) {
    const r = slot(c.on);
    if (r) r.crewPayCents += c.cents;
  }
  for (const t of input.trips) {
    const r = slot(t.on);
    if (r) r.miles += t.miles;
  }
  for (const r of rows.values()) {
    r.moneyOutCents = r.expensesCents + r.crewPayCents;
    r.profitCents = r.moneyInCents - r.moneyOutCents;
    r.miles = Math.round(r.miles * 10) / 10;
    r.mileageValueCents = input.mileageRateCents ? Math.round(r.miles * input.mileageRateCents) : null;
  }
  return months.map((m) => rows.get(m)!);
}

export interface Trend {
  dir: "up" | "down" | "same" | "new" | "none";
  pct: number | null; // whole percent, null when last month was zero
  good: boolean | null; // true = a good direction for the painter, false = worth a look, null = neutral
}

/** Compares this month with last. `upIsGood` is true for money in and profit, false for costs. */
export function trend(cur: number, prev: number, upIsGood: boolean | null): Trend {
  if (cur === 0 && prev === 0) return { dir: "none", pct: null, good: null };
  if (prev === 0) return { dir: "new", pct: null, good: upIsGood === null ? null : upIsGood };
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return { dir: "same", pct: 0, good: null };
  const up = cur > prev;
  // A swing from gain to loss (or back) has no sensible percent, so only the direction is shown.
  const flipped = cur !== 0 && prev !== 0 && cur < 0 !== prev < 0;
  return { dir: up ? "up" : "down", pct: flipped ? null : Math.abs(pct), good: upIsGood === null ? null : up === upIsGood };
}

const usd = (c: number) => `${c < 0 ? "-" : ""}$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;

/** One plain sentence for the top of the page. Words only; every number comes from the rows. */
export function pulseHeadline(cur: MonthRow, prevToDate: MonthRow, es = false): string {
  if (cur.moneyInCents === 0 && cur.moneyOutCents === 0) return es ? "Todavía no hay nada registrado este mes. Registre un pago de un cliente en un trabajo o agregue un gasto y esta página se llena." : "Nothing recorded yet this month. Record a customer payment on a job or add an expense and this page fills in.";
  const diff = cur.moneyInCents - prevToDate.moneyInCents;
  const has = prevToDate.moneyInCents !== 0;
  if (es) {
    const cmp = !has ? "" : diff === 0 ? ", igual que el mes pasado a esta fecha" : `, ${usd(Math.abs(diff))} ${diff > 0 ? "más" : "menos"} que el mes pasado a esta fecha`;
    const left = cur.profitCents >= 0 ? `Eso deja unos ${usd(cur.profitCents)} antes de su propio pago y de impuestos.` : `Hasta ahora sale ${usd(-cur.profitCents)} más de lo que entra.`;
    return `En lo que va del mes usted recibió ${usd(cur.moneyInCents)}${cmp}. Lo que salió es ${usd(cur.moneyOutCents)}. ${left}`;
  }
  const cmp = !has ? "" : diff === 0 ? ", the same as last month so far" : `, ${usd(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than last month at this point`;
  const left = cur.profitCents >= 0 ? `That leaves about ${usd(cur.profitCents)} before your own pay and taxes.` : `That is ${usd(-cur.profitCents)} more going out than coming in so far.`;
  return `So far this month you took in ${usd(cur.moneyInCents)}${cmp}. Money out is ${usd(cur.moneyOutCents)}. ${left}`;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** All customer payments recorded on any job (kept in app_settings, one blob per job). */
async function loadAllPayments(env: Env, c: number, since: string): Promise<Dated[]> {
  const { results } = await env.DB.prepare("SELECT value FROM app_settings WHERE key LIKE ? LIMIT 3000").bind(`jobpay:${c}:%`).all<{ value: string }>();
  const out: Dated[] = [];
  for (const r of results ?? []) for (const p of readPayments(r.value)) if (p.on >= since) out.push({ on: p.on, cents: p.cents });
  return out;
}

/**
 * GET /api/pulse
 * Returns this month, last month (the same days, so the arrows are fair), a 6-month table, what customers owe, and jobs in progress.
 */
export async function handlePulse(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "GET") return json({ error: "Not found." }, 404);
  const c = user.companyId;
  const today = todayLocal();
  const months = monthKeys(today, 6);
  const since = `${months[0]}-01`;
  const q = async <T>(sql: string, ...args: unknown[]): Promise<T[]> => ((await env.DB.prepare(sql).bind(...args).all<T>().catch(() => ({ results: [] as T[] }))).results ?? []) as T[];

  const [payments, expenses, crew, trips, settingsRow, prog, sentInv] = await Promise.all([
    loadAllPayments(env, c, since),
    q<{ d: string; category: string; cents: number }>("SELECT spent_on AS d, category, SUM(amount_cents) AS cents FROM expenses WHERE company_id = ? AND spent_on >= ? GROUP BY spent_on, category", c, since),
    q<{ d: string; cents: number }>("SELECT paid_on AS d, SUM(amount_cents) AS cents FROM worker_payments WHERE company_id = ? AND paid_on >= ? GROUP BY paid_on", c, since),
    q<{ d: string; miles: number }>("SELECT trip_on AS d, SUM(miles) AS miles FROM mileage_trips WHERE company_id = ? AND trip_on >= ? GROUP BY trip_on", c, since),
    loadSettings(env, c).catch(() => null),
    env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE company_id = ? AND stage = 'in_progress'").bind(c).first<{ n: number }>().catch(() => null),
    q<{ id: number; title: string; customer: string; sentOn: string }>(
      `SELECT j.id, j.title, cu.name AS customer, d.updated_at AS sentOn
         FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN documents d ON d.job_id = j.id AND d.kind = 'invoice' AND d.status = 'sent'
        WHERE j.company_id = ? AND j.stage NOT IN ('lost') ORDER BY d.updated_at LIMIT 100`,
      c,
    ),
  ]);
  const rate = settingsRow?.mileageRateCents && settingsRow.mileageRateCents > 0 ? settingsRow.mileageRateCents : null;
  const input: PulseInput = {
    payments,
    expenses: expenses.map((e) => ({ on: e.d, category: e.category, cents: e.cents })),
    crewPay: crew.map((x) => ({ on: x.d, cents: x.cents })),
    trips: trips.map((x) => ({ on: x.d, miles: x.miles })),
    mileageRateCents: rate,
  };
  const table = buildMonths(input, months);
  const dayNow = Number(today.slice(8, 10));
  const cur = table[table.length - 1];
  const prevFull = table[table.length - 2];
  const prevToDate = buildMonths(input, [prevFull.m], dayNow)[0];

  // What customers still owe on invoices that were sent: the job total minus the payments recorded.
  let owedCents = 0;
  const owedJobs: { jobId: number; title: string; customer: string; cents: number; days: number }[] = [];
  for (const r of sentInv) {
    const t = await contractTotal(env, c, r.id);
    const paid = sumPaid(await loadPayments(env, c, r.id));
    const bal = Math.max(0, t.totalCents - paid);
    if (bal <= 0) continue;
    owedCents += bal;
    const sent = String(r.sentOn ?? "").slice(0, 10);
    owedJobs.push({ jobId: r.id, title: r.title, customer: r.customer, cents: bal, days: sent ? Math.max(0, Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(sent + "T00:00:00Z")) / 86400000)) : 0 });
  }
  owedJobs.sort((a, b) => b.days - a.days);

  const t = (a: number, b: number, good: boolean | null) => trend(a, b, good);
  return json({
    asOf: today,
    month: cur.m,
    dayOfMonth: dayNow,
    headline: pulseHeadline(cur, prevToDate, new URL(request.url).searchParams.get("lang") === "es"),
    mileageRateSet: rate !== null,
    cur,
    prevToDate,
    trends: {
      moneyIn: t(cur.moneyInCents, prevToDate.moneyInCents, true),
      moneyOut: t(cur.moneyOutCents, prevToDate.moneyOutCents, false),
      profit: t(cur.profitCents, prevToDate.profitCents, true),
      crewPay: t(cur.crewPayCents, prevToDate.crewPayCents, false),
      materials: t(cur.materialsCents, prevToDate.materialsCents, false),
      vehicle: t(cur.vehicleCents, prevToDate.vehicleCents, false),
      mileage: t(cur.mileageValueCents ?? Math.round(cur.miles), prevToDate.mileageValueCents ?? Math.round(prevToDate.miles), null),
    },
    months: table.slice().reverse(), // newest first
    owed: { cents: owedCents, count: owedJobs.length, jobs: owedJobs.slice(0, 5) },
    inProgress: prog?.n ?? 0,
  });
}

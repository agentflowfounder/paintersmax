import { getSessionUser } from "./auth.ts";
import { companyPlan } from "./files.ts";
import { cleanWo, woTotalCents } from "./workorders.ts";
import type { Env } from "./types.ts";

/**
 * Year and job analysis from the painter's own records (Basic: a basic report, Pro: the full report, others: a teaser).
 * Every number is plain math on stored data; no AI is involved. Records for your accountant, not tax advice.
 */

export interface JobFacts {
  id: number;
  trade: string;
  stage: string;
  city: string;
  createdAt: string; // YYYY-MM-DD
  lostReason: string;
  startOn: string; // schedule start, "" when none
  endOn: string;
  won: boolean;
  soldCents: number; // signed estimate total
  changeCents: number; // approved change orders
  expenseCents: number;
  materialsCents: number;
  payCents: number; // payments to crew tied to the job
  minutes: number;
  workers: number;
  miles: number;
}

export const WON_STAGES = ["contract", "scheduled", "in_progress", "punch", "invoiced", "closed"];
export const seasonOf = (month: number) => (month === 12 || month <= 2 ? "Winter" : month <= 5 ? "Spring" : month <= 8 ? "Summer" : "Fall");

const add = (m: Record<string, number>, k: string, v: number) => (m[k] = (m[k] ?? 0) + v);
const rev = (j: JobFacts) => (j.won ? j.soldCents + j.changeCents : 0);

export interface Analysis {
  funnel: { jobs: number; won: number; lost: number; open: number; winRatePct: number | null };
  lostReasons: Record<string, number>;
  salesByYear: Record<string, number>;
  salesByMonth: Record<string, number>;
  salesBySeason: Record<string, number>;
  salesByCity: Record<string, number>;
  totals: { revenueCents: number; expenseCents: number; payCents: number; miles: number; materialsCents: number; materialsPctOfRevenue: number | null };
  profit: { byTrade: Record<string, { revenueCents: number; costCents: number; profitCents: number; marginPct: number | null; jobs: number }>; topJobs: { id: number; profitCents: number; marginPct: number | null }[]; bottomJobs: { id: number; profitCents: number; marginPct: number | null }[] };
  productivity: { revenuePerHourCents: number | null; byCrewSize: Record<string, { jobs: number; revenuePerHourCents: number }> };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : null);

export function buildAnalysis(jobs: JobFacts[]): Analysis {
  const won = jobs.filter((j) => j.won);
  const lost = jobs.filter((j) => !j.won && j.stage === "lost");
  const lostReasons: Record<string, number> = {};
  for (const j of lost) add(lostReasons, j.lostReason || "other", 1);
  const salesByYear: Record<string, number> = {};
  const salesByMonth: Record<string, number> = {};
  const salesBySeason: Record<string, number> = {};
  const salesByCity: Record<string, number> = {};
  const byTrade: Analysis["profit"]["byTrade"] = {};
  const perJob: { id: number; profitCents: number; marginPct: number | null }[] = [];
  let revenue = 0, expense = 0, pay = 0, miles = 0, materials = 0, hoursMin = 0, revWithHours = 0;
  const crew: Record<string, { jobs: number; rev: number; min: number }> = {};
  for (const j of won) {
    const r = rev(j);
    revenue += r;
    expense += j.expenseCents;
    pay += j.payCents;
    miles += j.miles;
    materials += j.materialsCents;
    const d = j.startOn || j.createdAt;
    add(salesByYear, d.slice(0, 4), r);
    add(salesByMonth, d.slice(0, 7), r);
    add(salesBySeason, seasonOf(Number(d.slice(5, 7))), r);
    add(salesByCity, j.city || "Unknown", r);
    const cost = j.expenseCents + j.payCents;
    const t = (byTrade[j.trade] ??= { revenueCents: 0, costCents: 0, profitCents: 0, marginPct: null, jobs: 0 });
    t.revenueCents += r;
    t.costCents += cost;
    t.jobs += 1;
    if (r > 0 && (j.expenseCents > 0 || j.payCents > 0)) perJob.push({ id: j.id, profitCents: r - cost, marginPct: pct(r - cost, r) });
    if (j.minutes > 0 && r > 0) {
      hoursMin += j.minutes;
      revWithHours += r;
      const k = j.workers <= 1 ? "1" : j.workers === 2 ? "2" : j.workers <= 4 ? "3-4" : "5+";
      const c = (crew[k] ??= { jobs: 0, rev: 0, min: 0 });
      c.jobs += 1;
      c.rev += r;
      c.min += j.minutes;
    }
  }
  for (const t of Object.values(byTrade)) {
    t.profitCents = t.revenueCents - t.costCents;
    t.marginPct = pct(t.profitCents, t.revenueCents);
  }
  perJob.sort((a, b) => b.profitCents - a.profitCents);
  return {
    funnel: { jobs: jobs.length, won: won.length, lost: lost.length, open: jobs.length - won.length - lost.length, winRatePct: pct(won.length, won.length + lost.length) },
    lostReasons,
    salesByYear, salesByMonth, salesBySeason, salesByCity,
    totals: { revenueCents: revenue, expenseCents: expense, payCents: pay, miles: Math.round(miles * 10) / 10, materialsCents: materials, materialsPctOfRevenue: pct(materials, revenue) },
    profit: { byTrade, topJobs: perJob.slice(0, 3), bottomJobs: perJob.length > 3 ? perJob.slice(-3).reverse() : [] },
    productivity: { revenuePerHourCents: hoursMin > 0 ? Math.round(revWithHours / (hoursMin / 60)) : null, byCrewSize: Object.fromEntries(Object.entries(crew).map(([k, v]) => [k, { jobs: v.jobs, revenuePerHourCents: Math.round(v.rev / (v.min / 60)) }])) },
  };
}

export interface Suggestion {
  key: string;
  title: string;
  why: string;
  /** Where the painter can start recording it today, or null when the app does not capture it yet. */
  link: string | null;
}
/** "Data we suggest collecting next": only what is missing or thin in this painter's own records. */
export function suggestions(jobs: JobFacts[]): Suggestion[] {
  const won = jobs.filter((j) => j.won);
  const out: Suggestion[] = [];
  const share = (f: (j: JobFacts) => boolean) => (won.length ? won.filter(f).length / won.length : 0);
  if (won.length && share((j) => !!j.startOn && !!j.endOn) < 0.6) out.push({ key: "dates", title: "Job start and end dates", why: "With dates on every job you can see how long each type of work really takes, and how busy each season is.", link: "/calendar" });
  if (won.length && share((j) => j.minutes > 0) < 0.6) out.push({ key: "hours", title: "Crew hours on every job", why: "Hours let us show revenue per labor hour and which crew size finishes best.", link: "/crew" });
  if (won.length && share((j) => j.expenseCents > 0) < 0.6) out.push({ key: "expenses", title: "Materials and fuel on every job", why: "Without costs we cannot show profit per job or per service.", link: "/records" });
  if (won.length && share((j) => j.miles > 0) < 0.3) out.push({ key: "miles", title: "Mileage per job", why: "Mileage totals help your accountant and show which far-away jobs are worth it.", link: "/records" });
  out.push({ key: "estimate_vs_actual", title: "Hours estimated vs actual", why: "Comparing your estimate to the real hours is the fastest way to price better.", link: null });
  out.push({ key: "sqft", title: "Square footage actually painted", why: "Lets us show your real cost per square foot by service.", link: null });
  out.push({ key: "source", title: "Where each lead came from", why: "Shows which source brings the jobs you win, so you spend your marketing where it pays.", link: null });
  out.push({ key: "brand", title: "Paint brand and gallons used", why: "Shows how much paint your jobs really use compared with your estimates.", link: null });
  out.push({ key: "rework", title: "Rework and callback hours", why: "Shows the hidden cost of jobs that needed a second visit.", link: null });
  return out.slice(0, 6);
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const parse = (s: string | null | undefined): any => {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

export async function loadJobFacts(env: Env, c: number): Promise<JobFacts[]> {
  const rows = ((await env.DB.prepare(
    `SELECT j.id, j.trade, j.stage, substr(j.created_at,1,10) AS createdAt, json_extract(j.data,'$.lost.reason') AS lostReason,
            COALESCE(json_extract(j.data,'$.schedule.start'),'') AS startOn, COALESCE(json_extract(j.data,'$.schedule.end'),'') AS endOn, COALESCE(p.city,'') AS city,
            (SELECT status FROM documents d WHERE d.job_id = j.id AND d.kind = 'estimate' ORDER BY d.id DESC LIMIT 1) AS estStatus,
            (SELECT body FROM documents d WHERE d.job_id = j.id AND d.kind = 'estimate' ORDER BY d.id DESC LIMIT 1) AS estBody,
            COALESCE((SELECT SUM(amount_cents) FROM expenses e WHERE e.job_id = j.id),0) AS expenseCents,
            COALESCE((SELECT SUM(amount_cents) FROM expenses e WHERE e.job_id = j.id AND e.category = 'Materials'),0) AS materialsCents,
            COALESCE((SELECT SUM(amount_cents) FROM worker_payments w WHERE w.job_id = j.id),0) AS payCents,
            COALESCE((SELECT SUM(minutes) FROM time_entries t WHERE t.job_id = j.id),0) AS minutes,
            (SELECT COUNT(DISTINCT worker_id) FROM time_entries t WHERE t.job_id = j.id) AS workers,
            COALESCE((SELECT SUM(miles) FROM mileage_trips m WHERE m.job_id = j.id),0) AS miles
       FROM jobs j LEFT JOIN properties p ON p.id = j.property_id WHERE j.company_id = ? ORDER BY j.id LIMIT 3000`,
  ).bind(c).all<any>()).results ?? []) as any[];
  const cos = ((await env.DB.prepare("SELECT job_id, body FROM work_orders WHERE company_id = ? AND kind = 'change_order' AND status = 'approved'").bind(c).all<any>()).results ?? []) as any[];
  const coBy: Record<number, number> = {};
  for (const o of cos) coBy[o.job_id] = (coBy[o.job_id] ?? 0) + woTotalCents(cleanWo(parse(o.body)).lines);
  return rows.map((r) => ({
    id: r.id, trade: r.trade, stage: r.stage, city: r.city, createdAt: r.createdAt, lostReason: r.lostReason ?? "", startOn: r.startOn, endOn: r.endOn,
    won: r.estStatus === "signed" || WON_STAGES.includes(r.stage),
    soldCents: Number(parse(r.estBody)?.totals?.totalCents) || 0, changeCents: coBy[r.id] ?? 0,
    expenseCents: r.expenseCents, materialsCents: r.materialsCents, payCents: r.payCents, minutes: r.minutes, workers: r.workers ?? 0, miles: r.miles,
  }));
}

/** GET /api/analysis  ->  {level: teaser|basic|full, ...}. */
export async function handleAnalysis(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const plan = await companyPlan(env, user.companyId);
  if (plan !== "basic" && plan !== "pro") return json({ level: "teaser", plan });
  const jobs = await loadJobFacts(env, user.companyId);
  const a = buildAnalysis(jobs);
  if (plan === "basic") {
    return json({ level: "basic", plan, funnel: a.funnel, lostReasons: a.lostReasons, salesByYear: a.salesByYear, salesByMonth: a.salesByMonth, totals: { revenueCents: a.totals.revenueCents, expenseCents: a.totals.expenseCents, miles: a.totals.miles }, suggestions: suggestions(jobs).slice(0, 3) });
  }
  return json({ level: "full", plan, ...a, suggestions: suggestions(jobs) });
}

import { getSessionUser } from "./auth.ts";
import { loadJobFacts, WON_STAGES } from "./analysis.ts";
import { cleanWo, woTotalCents } from "./workorders.ts";
import type { Env } from "./types.ts";

/**
 * Job results: what one job earned, where the money went, how long each step took, and which records exist.
 *  GET /api/jobreport?id=<job>  -> JobReport
 * Plain math on the painter's own records (no AI). A record that is missing shows as missing, never as zero profit.
 * Records for your accountant, not tax advice.
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const parse = (s: unknown): any => {
  try {
    return typeof s === "string" && s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

export interface ReportInput {
  priceCents: number;
  changeCents: number;
  collectedCents: number;
  categories: { category: string; cents: number }[];
  payCents: number;
  minutes: number;
  estimatedMinutes: number | null;
  workers: { name: string; minutes: number }[];
  dates: { lead: string; estimate: string; signed: string; start: string; end: string; invoice: string; paid: string; warranty: string };
  have: { photos: number; notes: number; signedEstimate: boolean; contract: boolean; expenses: number; hours: boolean; invoice: boolean; warranty: boolean; signoff: boolean };
  avg: { marginPct: number | null; priceCents: number | null; jobs: number };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : null);
/** Whole days from one YYYY-MM-DD to another, or null when either is missing or the order is wrong. */
export const daysBetween = (a: string, b: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const d = Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  return d >= 0 ? d : null;
};
const money = (c: number) => (c < 0 ? "-" : "") + "$" + Math.round(Math.abs(c) / 100).toLocaleString("en-US");

export function buildReport(i: ReportInput) {
  const total = i.priceCents + i.changeCents;
  const materials = i.categories.filter((c) => c.category === "Materials").reduce((s, c) => s + c.cents, 0);
  const expenses = i.categories.reduce((s, c) => s + c.cents, 0);
  const otherExpenses = expenses - materials;
  const cost = expenses + i.payCents;
  const hasCosts = cost > 0;
  const profit = total - cost;
  const margin = hasCosts && total > 0 ? pct(profit, total) : null;
  const d = i.dates;
  const days = {
    leadToEstimate: daysBetween(d.lead, d.estimate),
    estimateToSigned: daysBetween(d.estimate, d.signed),
    signedToStart: daysBetween(d.signed, d.start),
    workDays: d.start && d.end ? (daysBetween(d.start, d.end) ?? 0) + 1 : null,
    endToInvoice: daysBetween(d.end, d.invoice),
    invoiceToPaid: daysBetween(d.invoice, d.paid),
    leadToPaid: daysBetween(d.lead, d.paid),
  };
  const hoursActual = i.minutes / 60;
  const perHour = i.minutes > 0 && total > 0 ? Math.round(total / hoursActual) : null;
  const overPct = i.estimatedMinutes && i.minutes > 0 ? Math.round((100 * (i.minutes - i.estimatedMinutes)) / i.estimatedMinutes) : null;

  const insights: string[] = [];
  if (!hasCosts) insights.push("No expenses or crew pay are recorded for this job yet, so profit cannot be shown. Add receipts and crew hours in Records.");
  else if (margin !== null) {
    let s = `After materials and crew pay you kept ${margin}% of the price (${money(profit)}).`;
    if (i.avg.marginPct !== null && i.avg.jobs >= 2) {
      const diff = Math.round((margin - i.avg.marginPct) * 10) / 10;
      s += diff === 0 ? ` That matches your average of ${i.avg.marginPct}%.` : ` That is ${Math.abs(diff)} points ${diff > 0 ? "above" : "below"} your average of ${i.avg.marginPct}%.`;
    }
    insights.push(s);
  }
  const matPct = pct(materials, total);
  if (matPct !== null && matPct > 30) insights.push(`Materials were ${matPct}% of the price. Check the materials line in your next estimate.`);
  if (perHour !== null) insights.push(`You earned ${money(perHour * 100)} for each labor hour.`);
  if (overPct !== null && overPct > 15) insights.push(`The work took ${overPct}% more hours than the estimate. Raise your hours for this kind of job.`);
  else if (overPct !== null && overPct < -15) insights.push(`The work took ${Math.abs(overPct)}% fewer hours than the estimate. You may be pricing this work too high or too slow.`);
  if (i.minutes === 0 && total > 0 && i.payCents > 0) insights.push("Crew hours are missing, so labor per hour cannot be shown.");
  if (i.changeCents > 0) insights.push(`Change orders added ${money(i.changeCents)} (${pct(i.changeCents, i.priceCents) ?? 0}% of the original price).`);
  if (days.estimateToSigned !== null && days.estimateToSigned > 7) insights.push(`The customer took ${days.estimateToSigned} days to sign. A follow-up on day 3 may help.`);
  if (days.invoiceToPaid !== null && days.invoiceToPaid > 14) insights.push(`Payment took ${days.invoiceToPaid} days after the invoice.`);

  const records = [
    { key: "photos", label: "Photos", have: i.have.photos > 0, detail: i.have.photos ? `${i.have.photos} saved` : "None yet" },
    { key: "notes", label: "Site visit notes", have: i.have.notes > 0, detail: i.have.notes ? `${i.have.notes} notes` : "None yet" },
    { key: "estimate", label: "Signed estimate", have: i.have.signedEstimate, detail: i.have.signedEstimate ? "Signed" : "Not signed" },
    { key: "contract", label: "Contract", have: i.have.contract, detail: i.have.contract ? "Saved" : "Not made" },
    { key: "expenses", label: "Receipts and expenses", have: i.have.expenses > 0, detail: i.have.expenses ? `${i.have.expenses} recorded` : "None yet" },
    { key: "hours", label: "Crew hours", have: i.have.hours, detail: i.have.hours ? `${Math.round(hoursActual * 10) / 10} hours` : "None yet" },
    { key: "signoff", label: "Customer sign-off", have: i.have.signoff, detail: i.have.signoff ? "Accepted" : "Not yet" },
    { key: "invoice", label: "Invoice", have: i.have.invoice, detail: i.have.invoice ? "Made" : "Not made" },
    { key: "warranty", label: "Warranty certificate", have: i.have.warranty, detail: i.have.warranty ? "Made" : "Not made" },
  ];
  return {
    money: { priceCents: i.priceCents, changeCents: i.changeCents, totalCents: total, collectedCents: i.collectedCents, balanceCents: Math.max(0, total - i.collectedCents), materialsCents: materials, otherExpenseCents: otherExpenses, payCents: i.payCents, costCents: cost, profitCents: hasCosts ? profit : null, marginPct: margin, categories: i.categories },
    hours: { actualMinutes: i.minutes, estimatedMinutes: i.estimatedMinutes, overPct, revenuePerHourCents: perHour ? perHour * 100 : null, workers: i.workers },
    timeline: [
      { key: "lead", label: "Lead came in", date: d.lead },
      { key: "estimate", label: "Estimate made", date: d.estimate },
      { key: "signed", label: "Customer signed", date: d.signed },
      { key: "start", label: "Work started", date: d.start },
      { key: "end", label: "Work finished", date: d.end },
      { key: "invoice", label: "Invoice made", date: d.invoice },
      { key: "paid", label: "Paid in full", date: d.paid },
    ],
    days,
    compare: i.avg,
    records,
    recordsDone: records.filter((r) => r.have).length,
    insights: insights.slice(0, 6),
  };
}

export async function handleJobReport(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return json({ error: "Not found." }, 404);
  const job = await env.DB.prepare(
    `SELECT j.id, j.title, j.stage, j.trade, substr(j.created_at,1,10) AS leadOn, json_extract(j.data,'$.schedule.start') AS startOn, json_extract(j.data,'$.schedule.end') AS endOn,
            json_extract(j.data,'$.fieldNotes') AS notes, json_extract(j.data,'$.signoff.acceptedAt') AS accepted
       FROM jobs j WHERE j.id = ? AND j.company_id = ?`,
  ).bind(id, c).first<any>();
  if (!job) return json({ error: "Not found." }, 404);
  const [est, signed, inv, cos, exp, pay, time, files, docs, cert] = await Promise.all([
    env.DB.prepare("SELECT substr(created_at,1,10) AS at, status, body FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' AND status != 'superseded' ORDER BY id DESC LIMIT 1").bind(id, c).first<any>(),
    env.DB.prepare("SELECT substr(MIN(signed_at),1,10) AS at FROM signature_requests WHERE job_id = ? AND company_id = ? AND status = 'signed'").bind(id, c).first<any>(),
    env.DB.prepare("SELECT substr(created_at,1,10) AS at, substr(updated_at,1,10) AS upd, status, body FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'invoice' AND status != 'superseded' ORDER BY id DESC LIMIT 1").bind(id, c).first<any>(),
    env.DB.prepare("SELECT body FROM work_orders WHERE company_id = ? AND job_id = ? AND kind = 'change_order' AND status = 'approved'").bind(c, id).all<any>(),
    env.DB.prepare("SELECT category, SUM(amount_cents) AS cents, COUNT(*) AS n FROM expenses WHERE company_id = ? AND job_id = ? GROUP BY category ORDER BY cents DESC").bind(c, id).all<any>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM worker_payments WHERE company_id = ? AND job_id = ?").bind(c, id).first<any>(),
    env.DB.prepare("SELECT w.name AS name, SUM(t.minutes) AS minutes FROM time_entries t JOIN workers w ON w.id = t.worker_id WHERE t.company_id = ? AND t.job_id = ? GROUP BY t.worker_id ORDER BY minutes DESC").bind(c, id).all<any>(),
    env.DB.prepare("SELECT kind, COUNT(*) AS n FROM job_files WHERE company_id = ? AND job_id = ? GROUP BY kind").bind(c, id).all<any>(),
    env.DB.prepare("SELECT kind FROM documents WHERE job_id = ? AND company_id = ? AND status != 'superseded' GROUP BY kind").bind(id, c).all<any>(),
    env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`cert:${c}:${id}`).first<any>(),
  ]);
  const eb = parse(est?.body);
  const lines: any[] = Array.isArray(eb?.estimate?.lines) ? eb.estimate.lines : Array.isArray(eb?.lines) ? eb.lines : [];
  const estMin = lines.filter((l) => /^(h|hr|hrs|hour|hours)$/i.test(String(l?.unit ?? ""))).reduce((s, l) => s + (Number(l.qty) || 0) * 60, 0);
  const price = Number(eb?.totals?.totalCents ?? eb?.estimate?.totals?.totalCents) || 0;
  const change = ((cos.results ?? []) as any[]).reduce((s, o) => s + woTotalCents(cleanWo(parse(o.body)).lines), 0);
  const ib = parse(inv?.body);
  const collected = Number(ib?.paidCents) || 0;
  const cats = ((exp.results ?? []) as any[]).map((r) => ({ category: String(r.category), cents: Number(r.cents) || 0 }));
  const expN = ((exp.results ?? []) as any[]).reduce((s, r) => s + (Number(r.n) || 0), 0);
  const workers = ((time.results ?? []) as any[]).map((r) => ({ name: String(r.name), minutes: Number(r.minutes) || 0 }));
  const minutes = workers.reduce((s, w) => s + w.minutes, 0);
  const fileN = (k: string) => Number(((files.results ?? []) as any[]).find((f) => f.kind === k)?.n) || 0;
  const kinds = new Set(((docs.results ?? []) as any[]).map((d) => d.kind));
  const certV = parse(cert?.value);
  const sold = !!signed?.at || WON_STAGES.includes(job.stage);
  // How this job compares with the painter's other won jobs.
  const facts = (await loadJobFacts(env, c)).filter((f) => f.won && f.id !== id && f.soldCents + f.changeCents > 0 && f.expenseCents + f.payCents > 0);
  const margins = facts.map((f) => (f.soldCents + f.changeCents - f.expenseCents - f.payCents) / (f.soldCents + f.changeCents));
  const avgMargin = margins.length ? Math.round((1000 * margins.reduce((s, m) => s + m, 0)) / margins.length) / 10 : null;
  const avgPrice = facts.length ? Math.round(facts.reduce((s, f) => s + f.soldCents + f.changeCents, 0) / facts.length) : null;
  const notes = Array.isArray(parse(job.notes)) ? parse(job.notes).length : 0;
  const input: ReportInput = {
    priceCents: price, changeCents: change, collectedCents: collected, categories: cats, payCents: Number(pay?.cents) || 0, minutes, estimatedMinutes: estMin > 0 ? Math.round(estMin) : null, workers,
    dates: { lead: job.leadOn ?? "", estimate: est?.at ?? "", signed: signed?.at ?? "", start: job.startOn ?? "", end: job.endOn ?? "", invoice: inv?.at ?? "", paid: inv && /paid/i.test(String(inv.status)) ? inv.upd ?? "" : "", warranty: certV?.startOn ?? "" },
    have: { photos: fileN("photo"), notes, signedEstimate: sold, contract: kinds.has("contract"), expenses: expN, hours: minutes > 0, invoice: !!inv, warranty: !!cert, signoff: !!job.accepted },
    avg: { marginPct: avgMargin, priceCents: avgPrice, jobs: facts.length },
  };
  return json({ job: { id: job.id, title: job.title, stage: job.stage, trade: job.trade }, ...buildReport(input) });
}

import { getSessionUser } from "./auth.ts";
import { coverageFor, sanitizeSummary } from "./insurance.ts";
import { pastDueKey } from "./stripe.ts";
import { trialDaysLeft } from "./usage.ts";
import { buildProgress } from "./progress.ts";
import { buildNudges, SNOOZE_DAYS } from "./nudges.ts";
import { addDaysIso, friendlyDate, friendlyTime, todayLocal } from "./dates.ts";
import { bookedVisits } from "./visit.ts";
import { dueWords, nextDue } from "./duedates.ts";
import { loadVehicles, tripsSince, vehicleAlerts } from "./vehicles.ts";
import { readApprovals, timeApprKey, timesheetNudges } from "./timesheet.ts";
import { creditView } from "./credits.ts";
import { effectivePlan, monthKey, normalizePlan } from "./usage.ts";
import { storageLimitFor, storageUsed } from "./files.ts";
import type { Env } from "./types.ts";

/** GET /api/home: real numbers for the painter's Home screen. Nothing is estimated. All counts come from this company's own records. */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const EST_TOTAL = "json_extract(d.body,'$.totals.totalCents')";

export function parsePolicyDate(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export async function handleHome(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  if (request.method === "POST") {
    // Turn off the "finish setup" reminder. Only this one switch can be changed here.
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    if (typeof body?.snooze === "string" && /^[a-z_]{3,30}$/.test(body.snooze)) {
      const key = `nudge:${c}`;
      const cur = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
      let m: Record<string, string> = {};
      try {
        m = cur ? JSON.parse(cur.value) : {};
      } catch {
        m = {};
      }
      m[body.snooze] = new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString();
      await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, JSON.stringify(m)).run();
      return json({ ok: true });
    }
    if (body?.dismiss !== "setup") return json({ error: "Not found." }, 404);
    const row = await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(c).first<{ data: string }>();
    let data: any = {};
    try {
      data = row ? JSON.parse(row.data) : {};
    } catch {
      data = {};
    }
    data.setup = { ...(data.setup ?? {}), noResume: true };
    await env.DB.prepare(
      `INSERT INTO company_profiles (company_id, data, setup_step, completed, updated_at) VALUES (?, ?, 'start', 0, datetime('now'))
       ON CONFLICT(company_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    ).bind(c, JSON.stringify(data)).run();
    return json({ ok: true });
  }
  if (request.method !== "GET") return json({ error: "Not found." }, 404);
  const one = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<any>()) ?? {};

  const [paid, open, leads, progress, signedWeek, booked, attLeads, attEst, attOpened, attExpiring, attInvoice, events, policy] = await Promise.all([
    one(`SELECT COALESCE(SUM(${EST_TOTAL}),0) AS cents, COUNT(*) AS n FROM documents d JOIN jobs j ON j.id = d.job_id
          WHERE d.company_id = ? AND d.kind = 'estimate' AND j.stage = 'closed' AND strftime('%Y-%m', j.updated_at) = strftime('%Y-%m','now')`, c),
    one(`SELECT COALESCE(SUM(${EST_TOTAL}),0) AS cents, COUNT(*) AS n FROM documents d JOIN jobs j ON j.id = d.job_id
          WHERE d.company_id = ? AND d.kind = 'estimate' AND d.status = 'sent' AND j.stage IN ('lead','bid','contract')`, c),
    one(`SELECT COUNT(*) AS n, SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS week FROM jobs WHERE company_id = ? AND stage = 'lead'`, c),
    one(`SELECT COUNT(*) AS n FROM jobs WHERE company_id = ? AND stage IN ('scheduled','in_progress','punch')`, c),
    one(`SELECT COUNT(*) AS n FROM signature_requests WHERE company_id = ? AND status = 'signed' AND signed_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')`, c).catch(() => ({ n: 0 })),
    one(`SELECT COALESCE(SUM(${EST_TOTAL}),0) AS cents, COUNT(*) AS n FROM documents d JOIN jobs j ON j.id = d.job_id
          WHERE d.company_id = ? AND d.kind = 'estimate' AND d.status = 'signed' AND j.stage != 'closed'`, c),
    env.DB.prepare(`SELECT j.id, j.title, cu.name AS customer, CAST((julianday('now') - julianday(j.created_at)) AS INTEGER) AS days FROM jobs j JOIN customers cu ON cu.id = j.customer_id
                    WHERE j.company_id = ? AND j.stage = 'lead' AND j.created_at < datetime('now','-1 day') ORDER BY j.created_at LIMIT 5`).bind(c).all(),
    env.DB.prepare(`SELECT j.id, j.title, cu.name AS customer, CAST((julianday('now') - julianday(d.updated_at)) AS INTEGER) AS days FROM documents d JOIN jobs j ON j.id = d.job_id JOIN customers cu ON cu.id = j.customer_id
                    WHERE d.company_id = ? AND d.kind = 'estimate' AND d.status = 'sent' AND d.updated_at < datetime('now','-3 days') AND j.stage IN ('lead','bid') ORDER BY d.updated_at LIMIT 5`).bind(c).all(),
    env.DB.prepare(`SELECT j.id, j.title, s.signer_name, s.kind FROM signature_requests s JOIN jobs j ON j.id = s.job_id
                    WHERE s.company_id = ? AND s.status = 'pending' AND s.viewed_at IS NOT NULL AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY s.id DESC LIMIT 5`).bind(c).all().catch(() => ({ results: [] })),
    env.DB.prepare(`SELECT j.id, j.title, s.signer_name, s.kind, s.expires_at FROM signature_requests s JOIN jobs j ON j.id = s.job_id
                    WHERE s.company_id = ? AND s.status = 'pending' AND s.expires_at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ','now') AND strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 days') LIMIT 5`).bind(c).all().catch(() => ({ results: [] })),
    env.DB.prepare(`SELECT j.id, j.title, cu.name AS customer, CAST((julianday('now') - julianday(d.updated_at)) AS INTEGER) AS days FROM documents d JOIN jobs j ON j.id = d.job_id JOIN customers cu ON cu.id = j.customer_id
                    WHERE d.company_id = ? AND d.kind = 'invoice' AND d.status = 'sent' AND d.updated_at < datetime('now','-7 days') ORDER BY d.updated_at LIMIT 5`).bind(c).all(),
    env.DB.prepare(`SELECT e.kind, e.text, e.created_at AS at, j.id AS jobId, j.title FROM job_events e JOIN jobs j ON j.id = e.job_id WHERE e.company_id = ? ORDER BY e.id DESC LIMIT 12`).bind(c).all(),
    env.DB.prepare("SELECT summary FROM insurance_policies WHERE company_id = ?").bind(c).first<{ summary: string }>().catch(() => null),
  ]);

  const attention: { type: string; text: string; jobId?: number; link?: string; dismiss?: string; snooze?: string }[] = [];
  for (const r of attLeads.results as any[]) attention.push({ type: "lead", jobId: r.id, text: `New lead waiting ${r.days} day${r.days === 1 ? "" : "s"}: ${r.customer}, ${r.title}` });
  for (const r of attEst.results as any[]) attention.push({ type: "estimate", jobId: r.id, text: `Estimate sent ${r.days} days ago, no answer yet: ${r.customer}, ${r.title}` });
  for (const r of attOpened.results as any[]) attention.push({ type: "signature", jobId: r.id, text: `${r.signer_name} opened the ${r.kind} but has not signed: ${r.title}` });
  for (const r of attExpiring.results as any[]) attention.push({ type: "signature", jobId: r.id, text: `The signing link for ${r.signer_name} expires soon: ${r.title}` });
  for (const r of attInvoice.results as any[]) attention.push({ type: "invoice", jobId: r.id, text: `Invoice sent ${r.days} days ago and not marked paid: ${r.customer}, ${r.title}` });
  // Site visits: today, tomorrow, and any that passed without being marked done.
  const todayD = todayLocal();
  for (const v of (await bookedVisits(env, c).catch(() => [])).slice(0, 20)) {
    const at = friendlyTime(v.time) ? ` at ${friendlyTime(v.time)}` : "";
    const who = `${v.customer}${v.address ? ", " + v.address : ""}`;
    if (v.date === todayD) attention.push({ type: "visit", jobId: v.jobId, text: `Site visit today${at}: ${who}` });
    else if (v.date === addDaysIso(todayD, 1)) attention.push({ type: "visit", jobId: v.jobId, text: `Site visit tomorrow${at}: ${who}` });
    else if (v.date < todayD) attention.push({ type: "visit", jobId: v.jobId, text: `The site visit on ${friendlyDate(v.date)} is still marked as booked. Open the job and mark it done, or book a new time: ${v.customer}` });
  }
  // Finished-work sign-off: a customer note that needs an answer, or a request that has waited a few days.
  const soRows = ((await env.DB.prepare(`SELECT j.id, cu.name AS customer, j.title, json_extract(j.data,'$.signoff.concern.text') AS concern, json_extract(j.data,'$.signoff.requestedAt') AS asked
                    FROM jobs j JOIN customers cu ON cu.id = j.customer_id
                    WHERE j.company_id = ? AND json_extract(j.data,'$.signoff.requested') = 1 AND json_extract(j.data,'$.signoff.acceptedAt') IS NULL LIMIT 10`).bind(c).all().catch(() => ({ results: [] }))).results ?? []) as any[];
  for (const r of soRows) {
    if (r.concern) attention.push({ type: "signoff", jobId: r.id, text: `${r.customer} sent a note about the finished work: ${r.title}. Open the job to read it.` });
    else if (r.asked && Date.now() - Date.parse(r.asked) > 3 * 86400000) attention.push({ type: "signoff", jobId: r.id, text: `Waiting for ${r.customer} to accept the finished work: ${r.title}. A friendly call or text often helps.` });
  }
  // A scheduled job whose start date has come: offer the Start the job button.
  const dueStart = ((await env.DB.prepare(`SELECT j.id, j.title, cu.name AS customer, json_extract(j.data,'$.schedule.start') AS start FROM jobs j JOIN customers cu ON cu.id = j.customer_id
                    WHERE j.company_id = ? AND j.stage IN ('contract','scheduled') AND json_extract(j.data,'$.schedule.start') <= ? ORDER BY start LIMIT 5`).bind(c, todayLocal()).all().catch(() => ({ results: [] }))).results ?? []) as any[];
  for (const r of dueStart) attention.push({ type: "start", jobId: r.id, text: `The start date (${friendlyDate(String(r.start))}) is here: ${r.customer}, ${r.title}. Open the job and tap Start the job when the crew begins.` });
  if (policy) {
    try {
      const exp = parsePolicyDate(JSON.parse(policy.summary).expires);
      if (exp !== null) {
        const days = Math.floor((exp - Date.now()) / 86400000);
        if (days < 0) attention.unshift({ type: "insurance", link: "/insurance", text: `Your insurance policy expired ${-days} days ago. Update it on the Insurance page.` });
        else if (days <= 30) attention.unshift({ type: "insurance", link: "/insurance", text: `Your insurance policy expires in ${days} days.` });
      }
    } catch {
      /* ignore unreadable summary */
    }
  }
  // Suggested due dates: one next step per open job, soonest first. Only what is late or due in the next week.
  const dueRows = ((await env.DB.prepare(
    `SELECT j.id, j.title, j.stage, j.created_at AS createdAt, j.updated_at AS updatedAt, j.data, cu.name AS customer,
            (SELECT d.status FROM documents d WHERE d.job_id = j.id AND d.kind = 'estimate' ORDER BY d.id DESC LIMIT 1) AS estStatus,
            (SELECT d.updated_at FROM documents d WHERE d.job_id = j.id AND d.kind = 'estimate' ORDER BY d.id DESC LIMIT 1) AS estUpdatedAt,
            (SELECT s.signed_at FROM signature_requests s WHERE s.job_id = j.id AND s.status = 'signed' ORDER BY s.id DESC LIMIT 1) AS signedAt,
            (SELECT d.status FROM documents d WHERE d.job_id = j.id AND d.kind = 'invoice' AND d.status != 'superseded' ORDER BY d.id DESC LIMIT 1) AS invStatus,
            (SELECT d.updated_at FROM documents d WHERE d.job_id = j.id AND d.kind = 'invoice' AND d.status != 'superseded' ORDER BY d.id DESC LIMIT 1) AS invUpdatedAt
       FROM jobs j JOIN customers cu ON cu.id = j.customer_id WHERE j.company_id = ? AND j.stage NOT IN ('lost','closed') ORDER BY j.updated_at DESC LIMIT 150`,
  ).bind(c).all().catch(() => ({ results: [] }))).results ?? []) as any[];
  const upcoming: { jobId: number; step: string; who: string; when: string; late: boolean; due: string }[] = [];
  for (const r of dueRows) {
    let data: any = {};
    try {
      data = r.data ? JSON.parse(r.data) : {};
    } catch {
      data = {};
    }
    const d = nextDue({ stage: r.stage, createdAt: r.createdAt, updatedAt: r.updatedAt, estStatus: r.estStatus, estUpdatedAt: r.estUpdatedAt, signedAt: r.signedAt, invStatus: r.invStatus, invUpdatedAt: r.invUpdatedAt, scheduleStart: data.schedule?.start ?? null, scheduleEnd: data.schedule?.end ?? null, visitDate: data.visit?.status === "booked" ? data.visit.date : null });
    if (!d) continue;
    const w = dueWords(d.due, todayLocal());
    if (!w.late && d.due > addDaysIso(todayLocal(), 7)) continue;
    upcoming.push({ jobId: r.id, step: d.step, who: `${r.customer}, ${r.title}`, when: w.when, late: w.late, due: d.due });
  }
  upcoming.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));

  // Vehicles: services due, insurance, registration, inspection and loan payment dates.
  try {
    const vs = await loadVehicles(env, c);
    if (vs.length) {
      const main = vs.find((v) => v.main && v.odometer !== null);
      const trips = main ? await tripsSince(env, c, main.odometerOn) : [];
      const alerts = vehicleAlerts(vs, trips, todayLocal());
      for (const a of alerts.filter((x) => x.urgent)) attention.push({ type: "vehicle", link: "/vehicles", text: a.text });
      for (const a of alerts.filter((x) => !x.urgent).slice(0, 3)) attention.push({ type: "vehicle", link: "/vehicles", text: a.text });
    }
  } catch {
    /* vehicles are optional */
  }
  // Time sheet reminders (Basic and Pro, the plans that have the crew pages): overtime, an empty week, and weeks waiting for approval.
  try {
    const co0 = await env.DB.prepare("SELECT plan, created_at AS createdAt FROM companies WHERE id = ?").bind(c).first<{ plan: string; createdAt: string }>();
    const pl = co0 ? effectivePlan({ plan: co0.plan, createdAt: co0.createdAt }) : "free";
    if (pl === "basic" || pl === "pro") {
      const today0 = todayLocal();
      const since = addDaysIso(today0, -56);
      const ws = ((await env.DB.prepare("SELECT id, name, kind, active FROM workers WHERE company_id = ?").bind(c).all<any>()).results ?? []) as any[];
      if (ws.some((w) => w.active)) {
        const rows = ((await env.DB.prepare("SELECT worker_id AS workerId, work_date AS workDate, minutes FROM time_entries WHERE company_id = ? AND work_date >= ?").bind(c, since).all<any>()).results ?? []) as any[];
        const apRow = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(timeApprKey(c)).first<{ value: string }>();
        let ap: unknown = {};
        try {
          ap = apRow ? JSON.parse(apRow.value) : {};
        } catch {
          ap = {};
        }
        for (const text of timesheetNudges({ today: today0, workers: ws.map((w) => ({ id: w.id, name: w.name, kind: w.kind, active: !!w.active })), rows, approvals: readApprovals(ap) })) attention.push({ type: "timesheet", link: "/crew", text });
      }
    }
  } catch {
    /* the time sheet reminders are optional */
  }
  const prof = await env.DB.prepare("SELECT data, setup_step, completed FROM company_profiles WHERE company_id = ?").bind(c).first<{ data: string; setup_step: string; completed: number }>().catch(() => null);
  let noResume = false;
  try {
    noResume = prof ? JSON.parse(prof.data)?.setup?.noResume === true : false;
  } catch {
    /* ignore unreadable profile */
  }
  if (!noResume && prof?.completed !== 1) attention.push({ type: "setup", link: "/app", dismiss: "setup", text: "Finish setting up your estimating prices so estimates fill in for you. It takes a few minutes and you can stop any time." });
  const pastDue = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(pastDueKey(c)).first<{ value: string }>().catch(() => null);
  const co = await env.DB.prepare("SELECT plan, created_at AS createdAt FROM companies WHERE id = ?").bind(c).first<{ plan: string; createdAt: string }>().catch(() => null);
  const trial = co ? trialDaysLeft(co) : 0;
  if (trial > 0) attention.unshift({ type: "billing", link: "/dashboard#billing", text: `Your free trial has ${trial} day${trial === 1 ? "" : "s"} left. You have extra AI use until it ends. Choose a plan to keep it.` });
  if (pastDue) attention.unshift({ type: "billing", link: "/dashboard#billing", text: "Your last PaintersMax payment did not go through. Update your card so your plan stays active." });
  if (!policy) {
    attention.push({
      type: "insurance",
      link: "/insurance",
      text: "No insurance policy on file. Add yours so PaintersMax can tell you if each job is covered. If you do not have coverage yet, the Insurance guide explains how it helps you win jobs and how to get it.",
    });
  } else {
    try {
      const summary = sanitizeSummary(JSON.parse(policy.summary));
      const open = await env.DB.prepare("SELECT trade FROM jobs WHERE company_id = ? AND stage IN ('lead','bid','contract','scheduled','in_progress','punch')").bind(c).all<{ trade: string }>();
      const n = open.results.filter((j) => {
        const cv = coverageFor(summary, j.trade);
        return cv && cv.status !== "likely_covered";
      }).length;
      if (n) attention.push({ type: "insurance", link: "/jobs", text: `${n} open job${n === 1 ? "" : "s"} may not be covered by your policy. Check the insurance note on each job before you bid or start.` });
    } catch {
      /* ignore unreadable summary */
    }
  }

  let pdata: any = {};
  try {
    pdata = prof ? JSON.parse(prof.data) : {};
  } catch {
    pdata = {};
  }
  const cset = await env.DB.prepare("SELECT settings FROM companies WHERE id = ?").bind(c).first<{ settings: string }>().catch(() => null);
  let logo = false;
  try {
    logo = !!JSON.parse(cset?.settings || "{}")?.logoUrl;
  } catch {
    logo = false;
  }
  const [rc, cp, lc, es] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM rate_cards WHERE company_id = ?", c).catch(() => ({ n: 0 })),
    one("SELECT COUNT(*) AS n FROM city_pages WHERE company_id = ? AND published = 1", c).catch(() => ({ n: 0 })),
    one("SELECT COUNT(*) AS n FROM jobs WHERE company_id = ?", c).catch(() => ({ n: 0 })),
    one("SELECT COUNT(*) AS n FROM documents WHERE company_id = ? AND kind = 'estimate' AND status IN ('sent','signed','paid')", c).catch(() => ({ n: 0 })),
  ]);
  const co2 = pdata.company ?? {};
  const progress2 = buildProgress({
    companyInfo: !!(co2.legalName && co2.phone && co2.email),
    services: Array.isArray(pdata.trades) ? pdata.trades.length : 0,
    cities: Array.isArray(pdata.cities) ? pdata.cities.length : 0,
    rateCards: rc.n ?? 0,
    insurance: !!policy,
    brand: logo,
    cityPagePublished: cp.n ?? 0,
    leads: lc.n ?? 0,
    estimatesSent: es.n ?? 0,
  });

  // Gentle nudges: at most two, each from a real fact, each snoozable.
  const cardTrades = new Set(((await env.DB.prepare("SELECT DISTINCT trade FROM rate_cards WHERE company_id = ? AND audience = 'retail'").bind(c).all<{ trade: string }>().catch(() => ({ results: [] }))).results ?? []).map((r) => r.trade));
  const chosen: string[] = Array.isArray(pdata.trades) ? pdata.trades : [];
  const LBL: Record<string, string> = { interior: "interior painting", exterior: "exterior painting", commercial: "commercial work", power_washing: "power washing", cabinets: "cabinet painting", decks_fences: "deck and fence staining", epoxy_floors: "epoxy floors" };
  const [staleDr, cityDr, commUsed, snz] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM documents d JOIN jobs j ON j.id = d.job_id WHERE d.company_id = ? AND d.kind = 'estimate' AND d.status = 'draft' AND d.updated_at < datetime('now','-2 days') AND j.stage IN ('lead','bid')", c).catch(() => ({ n: 0 })),
    one("SELECT COUNT(*) AS n FROM city_pages WHERE company_id = ? AND published = 0", c).catch(() => ({ n: 0 })),
    one("SELECT COUNT(*) AS n FROM jobs j WHERE j.company_id = ? AND j.trade = 'commercial' AND EXISTS (SELECT 1 FROM documents d WHERE d.job_id = j.id AND d.kind = 'estimate')", c).catch(() => ({ n: 0 })),
    env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`nudge:${c}`).first<{ value: string }>().catch(() => null),
  ]);
  let snoozed: Record<string, string> = {};
  try {
    snoozed = snz ? JSON.parse(snz.value) : {};
  } catch {
    snoozed = {};
  }
  const plan2 = co ? effectivePlan({ plan: co.plan, createdAt: co.createdAt }) : "free";
  // AI credits: a paid painter hears when a monthly amount ran out (and a credit pack would help), or when credits are nearly gone.
  try {
    const hidden = snoozed.credits && Date.parse(snoozed.credits) > Date.now();
    if (co && normalizePlan(co.plan) !== "free" && !hidden) {
      const view = await creditView(env, c, todayLocal());
      const full = await env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM usage_counters WHERE company_id = ? AND period = ? AND feature LIKE '%:full'").bind(c, monthKey()).first<{ n: number }>();
      const n = full?.n ?? 0;
      if (n > 0 && view.balance === 0) attention.push({ type: "credits", link: "/credits", snooze: "credits", text: `${n} AI request${n === 1 ? "" : "s"} could not run this month because a monthly amount ran out. Add AI credits so they keep working.` });
      else if (view.balance > 0 && view.balance <= 5) attention.push({ type: "credits", link: "/credits", snooze: "credits", text: `Your AI credits are almost gone: ${view.balance} left.` });
    }
  } catch {
    /* credits are optional */
  }
  const lastDl = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`lastdl:${c}`).first<{ value: string }>().catch(() => null);
  const baseDate = Date.parse((lastDl?.value ?? co?.createdAt ?? "").replace(" ", "T") + "Z");
  const daysSince = Number.isFinite(baseDate) ? Math.floor((Date.now() - baseDate) / 86400000) : 0;
  const stored = await storageUsed(env, c).catch(() => 0);
  const nowD = new Date();
  const warrEnd = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE ? AND json_extract(value,'$.status') = 'sent' AND json_extract(value,'$.endOn') BETWEEN date('now') AND date('now','+60 days')").bind(`cert:${c}:%`).first<{ n: number }>().catch(() => ({ n: 0 }));
  const nudges = buildNudges({
    warrantiesEnding: warrEnd?.n ?? 0,
    plan: plan2,
    storagePercent: Math.round((100 * stored) / storageLimitFor(plan2 as any)),
    daysSinceDownload: daysSince,
    month: nowD.getUTCMonth() + 1,
    downloadedThisTaxYear: !!lastDl && Date.parse(lastDl.value.replace(" ", "T") + "Z") >= Date.UTC(nowD.getUTCFullYear(), 0, 1),
    tradesWithoutPrices: chosen.filter((t) => LBL[t] && !cardTrades.has(t)).map((t) => LBL[t]),
    staleDraftEstimates: staleDr.n ?? 0,
    cityDraftPages: cityDr.n ?? 0,
    commercialBidUnused: !!co && effectivePlan({ plan: co.plan, createdAt: co.createdAt }) === "basic" && chosen.includes("commercial") && (commUsed.n ?? 0) === 0,
  }, snoozed);
  for (const n of nudges) attention.push({ type: "nudge", link: n.link, text: n.text, snooze: n.key });

  return json({
    progress: progress2,
    stats: {
      paidMonthCents: paid.cents ?? 0,
      paidMonthJobs: paid.n ?? 0,
      waitingCents: open.cents ?? 0,
      waitingCount: open.n ?? 0,
      newLeads: leads.n ?? 0,
      newLeadsWeek: leads.week ?? 0,
      inProgress: progress.n ?? 0,
      signedWeek: signedWeek.n ?? 0,
      bookedCents: booked.cents ?? 0,
      bookedCount: booked.n ?? 0,
    },
    attention,
    upcoming: upcoming.slice(0, 8),
    upcomingMore: Math.max(0, upcoming.length - 8),
    activity: events.results,
  });
}

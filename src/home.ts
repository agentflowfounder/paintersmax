import { getSessionUser } from "./auth.ts";
import { coverageFor, sanitizeSummary } from "./insurance.ts";
import { pastDueKey } from "./stripe.ts";
import { trialDaysLeft } from "./usage.ts";
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

  const attention: { type: string; text: string; jobId?: number; link?: string; dismiss?: string }[] = [];
  for (const r of attLeads.results as any[]) attention.push({ type: "lead", jobId: r.id, text: `New lead waiting ${r.days} day${r.days === 1 ? "" : "s"}: ${r.customer}, ${r.title}` });
  for (const r of attEst.results as any[]) attention.push({ type: "estimate", jobId: r.id, text: `Estimate sent ${r.days} days ago, no answer yet: ${r.customer}, ${r.title}` });
  for (const r of attOpened.results as any[]) attention.push({ type: "signature", jobId: r.id, text: `${r.signer_name} opened the ${r.kind} but has not signed: ${r.title}` });
  for (const r of attExpiring.results as any[]) attention.push({ type: "signature", jobId: r.id, text: `The signing link for ${r.signer_name} expires soon: ${r.title}` });
  for (const r of attInvoice.results as any[]) attention.push({ type: "invoice", jobId: r.id, text: `Invoice sent ${r.days} days ago and not marked paid: ${r.customer}, ${r.title}` });
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

  return json({
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
    activity: events.results,
  });
}

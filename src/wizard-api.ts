import { coiLink, coverageFor, loadSummary } from "./insurance.ts";
import { getSessionUser } from "./auth.ts";
import { isTrade, METHODS, PROFILE_CAPS, sanitizeProfile, sanitizeRateData } from "./profile.ts";
import { consume, normalizePlan, refund } from "./usage.ts";
import { ask, buildJobContext, completeEx, draftCoverNote, sanitizeHistory } from "./assistant.ts";
import type { Env } from "./types.ts";
import { labelsFor } from "./ratecatalog.ts";
import { commercialBlockedMessage, loadCommercialStatus } from "./commercial.ts";
import { computeTotals, draftLines, milestoneAmounts, quantityOptions, renderEstimateHtml, sanitizeEstimate, scheduleIsValid } from "./estimate.ts";
import { defaultClauses, renderContractHtml, sanitizeContract } from "./contract.ts";
import { loadHowToPay, loadPayments, sumPaid } from "./payments.ts";
import { cleanBrief, cleanDraftAI, draftPrompt, DRAFT_SYSTEM, JOB_TYPES, type Brief } from "./jobbrief.ts";
import { parseJsonLoose } from "./vision.ts";
import { todayLocal } from "./dates.ts";
import { jobChangeOrders } from "./workorders.ts";
import { CUSTOMER_KINDS, docTitle, invoiceChecks, isListKind, renderInvoiceHtml, renderListDocHtml, sanitizeInvoice, sanitizeListDoc, starterDoc, type DocContext } from "./jobdocs.ts";
import { addJobEvent } from "./crm.ts";
import { sendCustomerEmail } from "./email.ts";
import { portalNote } from "./portal.ts";
import { readSettings } from "./settings.ts";
import { documentAttachment, htmlToPdf } from "./pdf.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const parse = (s: string | null | undefined) => {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

/** Business profile and rate cards for the signed-in painter. */
export async function handleProfile(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const company = await env.DB.prepare("SELECT id, name, plan FROM companies WHERE id = ?")
    .bind(user.companyId)
    .first<{ id: number; name: string; plan: string }>();
  if (!company) return json({ error: "Not found." }, 404);

  if (request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const profile = sanitizeProfile(body?.profile, company.plan);
    const step = typeof body?.setupStep === "string" ? body.setupStep.replace(/[^a-z_]/g, "").slice(0, 30) || "start" : "start";
    await env.DB.prepare(
      `INSERT INTO company_profiles (company_id, data, setup_step, completed, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(company_id) DO UPDATE SET data = excluded.data, setup_step = excluded.setup_step,
         completed = excluded.completed, updated_at = datetime('now')`,
    )
      .bind(company.id, JSON.stringify(profile), step, body?.completed === true ? 1 : 0)
      .run();
    return json({ ok: true });
  }

  const row = await env.DB.prepare("SELECT data, setup_step, completed FROM company_profiles WHERE company_id = ?")
    .bind(company.id)
    .first<{ data: string; setup_step: string; completed: number }>();
  const cards = await env.DB.prepare("SELECT trade, audience, method, data FROM rate_cards WHERE company_id = ?")
    .bind(company.id)
    .all<{ trade: string; audience: string; method: string; data: string }>();
  const plan = normalizePlan(company.plan);
  return json({
    company: company.name,
    plan,
    caps: PROFILE_CAPS[plan],
    profile: parse(row?.data),
    setupStep: row?.setup_step ?? "start",
    completed: row?.completed === 1,
    rateCards: cards.results.map((c) => ({ trade: c.trade, audience: c.audience, method: c.method, data: parse(c.data) })),
  });
}

/** Saves one rate card (one trade, retail or builder). */
export async function handleRateCard(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (!isTrade(body?.trade)) return json({ error: "Unknown trade." }, 400);
  if (!(METHODS as readonly string[]).includes(String(body?.method))) return json({ error: "Unknown pricing method." }, 400);
  const audience = body?.audience === "builder" ? "builder" : "retail";
  const company = await env.DB.prepare("SELECT plan FROM companies WHERE id = ?").bind(user.companyId).first<{ plan: string }>();
  // Builder rate cards are for Basic and Pro only.
  if (audience === "builder" && ["free", "starter"].includes(normalizePlan(company?.plan))) {
    return json({ error: "Builder rate cards are available on the Basic and Pro plans." }, 403);
  }
  const data = sanitizeRateData(body?.data) ?? {};
  if (body.method === "catalog") {
    // The painter had typed prices in the older form: keep a copy so nothing is lost when the price list replaces them.
    const old = await env.DB.prepare("SELECT method, data FROM rate_cards WHERE company_id = ? AND trade = ? AND audience = ?").bind(user.companyId, body.trade, audience).first<{ method: string; data: string }>();
    if (old && old.method !== "catalog" && old.data && old.data !== "{}") {
      await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(`ratecard_backup:${user.companyId}:${body.trade}:${audience}`, JSON.stringify({ method: old.method, data: old.data, savedAt: new Date().toISOString() }))
        .run();
    }
  }
  await env.DB.prepare(
    `INSERT INTO rate_cards (company_id, trade, audience, method, data, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(company_id, trade, audience) DO UPDATE SET method = excluded.method, data = excluded.data, updated_at = datetime('now')`,
  )
    .bind(user.companyId, body.trade, audience, body.method, JSON.stringify(data))
    .run();
  return json({ ok: true });
}

// ---------- Jobs and estimates ----------


const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
const toBase64 = (s: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};
const text = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** GET /api/jobs lists the painter's jobs. POST /api/jobs creates a customer and job by hand. */
export async function handleJobs(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);

  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const name = text(b?.name, 120);
    const title = text(b?.title, 120);
    if (!name || !title) return json({ error: "Customer name and job title are required." }, 400);
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(b?.email, 200)) ? text(b.email, 200).toLowerCase() : null;
    const trade = isTrade(b?.trade) ? b.trade : "interior";
    let customerId: number | null = null;
    if (email) {
      const c = await env.DB.prepare("SELECT id FROM customers WHERE company_id = ? AND lower(email) = ? ORDER BY id LIMIT 1").bind(user.companyId, email).first<{ id: number }>();
      customerId = c?.id ?? null;
    }
    if (!customerId) {
      const ins = await env.DB.prepare("INSERT INTO customers (company_id, name, email, phone) VALUES (?, ?, ?, ?)")
        .bind(user.companyId, name, email, text(b?.phone, 40) || null)
        .run();
      customerId = Number(ins.meta.last_row_id);
    }
    const address = text(b?.address, 160);
    let propertyId: number | null = null;
    if (address) {
      const p = await env.DB.prepare("INSERT INTO properties (company_id, customer_id, address, city, zip) VALUES (?, ?, ?, ?, ?)")
        .bind(user.companyId, customerId, address, text(b?.city, 60) || null, text(b?.zip, 10) || null)
        .run();
      propertyId = Number(p.meta.last_row_id);
    }
    const job = await env.DB.prepare("INSERT INTO jobs (company_id, customer_id, property_id, title, trade, stage) VALUES (?, ?, ?, ?, ?, 'lead')")
      .bind(user.companyId, customerId, propertyId, title, trade)
      .run();
    const jobId = Number(job.meta.last_row_id);
    await addJobEvent(env, user.companyId, jobId, "note", "Job added by hand.");
    return json({ ok: true, jobId });
  }

  const rows = await env.DB.prepare(
    `SELECT j.id, j.title, j.trade, j.stage, j.updated_at AS updatedAt, c.name AS customer,
            EXISTS (SELECT 1 FROM signature_requests s WHERE s.job_id = j.id AND s.status = 'signed') AS signed,
            EXISTS (SELECT 1 FROM signature_requests s WHERE s.job_id = j.id AND s.status = 'pending' AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS awaiting
       FROM jobs j JOIN customers c ON c.id = j.customer_id
      WHERE j.company_id = ? ORDER BY j.updated_at DESC LIMIT 200`,
  )
    .bind(user.companyId)
    .all();
  const pol = await loadSummary(env, user.companyId);
  return json({ jobs: (rows.results as any[]).map((r) => ({ ...r, coverage: coverageFor(pol, r.trade)?.status ?? null })) });
}

/** GET /api/job?id= returns one job with its customer, property, rate card, saved estimate and timeline. */
export async function handleJob(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const jid = Number(b?.jobId);
    const cur = Number.isInteger(jid)
      ? await env.DB.prepare(
          `SELECT j.id, j.title, j.trade, j.stage, j.customer_id AS customerId, j.property_id AS propertyId, c.name, c.email, c.phone, p.address, p.city, p.zip
             FROM jobs j JOIN customers c ON c.id = j.customer_id LEFT JOIN properties p ON p.id = j.property_id WHERE j.id = ? AND j.company_id = ?`,
        ).bind(jid, user.companyId).first<any>()
      : null;
    if (!cur) return json({ error: "Job not found." }, 404);

    if (b.action === "brief") {
      const brief = cleanBrief(b.brief);
      const def = JOB_TYPES.find((t) => t.id === brief.type)!;
      await env.DB.prepare("UPDATE jobs SET data = json_set(COALESCE(data, '{}'), '$.brief', json(?)), updated_at = datetime('now') WHERE id = ? AND company_id = ?").bind(JSON.stringify(brief), jid, user.companyId).run();
      if (def.trade && def.trade !== cur.trade && isTrade(def.trade)) {
        await env.DB.prepare("UPDATE jobs SET trade = ? WHERE id = ? AND company_id = ?").bind(def.trade, jid, user.companyId).run();
        await addJobEvent(env, user.companyId, jid, "note", `Job type set to ${def.label}.`);
      }
      return json({ ok: true, brief });
    }

    if (b.action === "start") {
      // Starting the job moves it to "In progress", which also opens the change-order box on the job page.
      if (cur.stage === "in_progress") return json({ ok: true, already: true });
      if (cur.stage !== "contract" && cur.stage !== "scheduled") return json({ error: "A job can be started once the estimate is approved and it is on the schedule. Check where this job is in its steps." }, 400);
      await env.DB.prepare("UPDATE jobs SET stage = 'in_progress', data = json_set(COALESCE(data, '{}'), '$.startedOn', ?), updated_at = datetime('now') WHERE id = ? AND company_id = ?").bind(todayLocal(), jid, user.companyId).run();
      await addJobEvent(env, user.companyId, jid, "stage", "Job started. It is now in progress.");
      return json({ ok: true });
    }

    if (b.action === "update") {
      const name = b.name === undefined ? cur.name : text(b.name, 120);
      const title = b.title === undefined ? cur.title : text(b.title, 120);
      if (!name) return json({ error: "The customer needs a name." }, 400);
      if (!title) return json({ error: "The job needs a short title." }, 400);
      let email: string | null = cur.email ?? null;
      if (b.email !== undefined) {
        const e = text(b.email, 200).toLowerCase();
        if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return json({ error: "That email address does not look right. Check it and try again." }, 400);
        email = e || null;
      }
      const phone = b.phone === undefined ? cur.phone ?? null : text(b.phone, 40) || null;
      const address = b.address === undefined ? cur.address ?? "" : text(b.address, 160);
      const city = b.city === undefined ? cur.city ?? "" : text(b.city, 60);
      const zip = b.zip === undefined ? cur.zip ?? "" : text(b.zip, 10);
      const changed: string[] = [];
      if (name !== cur.name) changed.push("customer name");
      if (title !== cur.title) changed.push("job title");
      if (email !== (cur.email ?? null)) changed.push("email");
      if (phone !== (cur.phone ?? null)) changed.push("phone");
      if (address !== (cur.address ?? "") || city !== (cur.city ?? "") || zip !== (cur.zip ?? "")) changed.push("address");
      await env.DB.prepare("UPDATE customers SET name = ?, email = ?, phone = ? WHERE id = ? AND company_id = ?").bind(name, email, phone, cur.customerId, user.companyId).run();
      await env.DB.prepare("UPDATE jobs SET title = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?").bind(title, jid, user.companyId).run();
      if (cur.propertyId) {
        await env.DB.prepare("UPDATE properties SET address = ?, city = ?, zip = ? WHERE id = ? AND company_id = ?").bind(address, city || null, zip || null, cur.propertyId, user.companyId).run();
      } else if (address) {
        const p = await env.DB.prepare("INSERT INTO properties (company_id, customer_id, address, city, zip) VALUES (?, ?, ?, ?, ?)").bind(user.companyId, cur.customerId, address, city || null, zip || null).run();
        await env.DB.prepare("UPDATE jobs SET property_id = ? WHERE id = ? AND company_id = ?").bind(Number(p.meta.last_row_id), jid, user.companyId).run();
      }
      if (changed.length) await addJobEvent(env, user.companyId, jid, "note", `Details changed: ${changed.join(", ")}.`);
      return json({ ok: true, changed });
    }
    return json({ error: "Unknown action." }, 400);
  }
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Not found." }, 404);
  const job = await env.DB.prepare(
    `SELECT j.id, j.title, j.trade, j.stage, j.property_id AS propertyId, j.customer_id AS customerId,
            c.name AS customerName, c.email AS customerEmail, c.phone AS customerPhone,
            p.address, p.city, p.zip, json_extract(j.data,'$.lost') AS lost, json_extract(j.data,'$.brief') AS brief, json_extract(j.data,'$.schedule') AS schedule, json_extract(j.data,'$.startedOn') AS startedOn, json_extract(j.data,'$.visit') AS visit
       FROM jobs j JOIN customers c ON c.id = j.customer_id LEFT JOIN properties p ON p.id = j.property_id
      WHERE j.id = ? AND j.company_id = ?`,
  )
    .bind(id, user.companyId)
    .first<any>();
  if (!job) return json({ error: "Not found." }, 404);
  const [card, doc, events, contractDoc, extraDocs] = await Promise.all([
    env.DB.prepare("SELECT method, data FROM rate_cards WHERE company_id = ? AND trade = ? AND audience = 'retail'").bind(user.companyId, job.trade).first<{ method: string; data: string }>(),
    env.DB.prepare("SELECT id, status, body, language FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' ORDER BY id DESC LIMIT 1").bind(id, user.companyId).first<{ id: number; status: string; body: string; language: string }>(),
    env.DB.prepare("SELECT kind, text, created_at AS at FROM job_events WHERE job_id = ? AND company_id = ? ORDER BY id DESC LIMIT 30").bind(id, user.companyId).all(),
    env.DB.prepare("SELECT id, status, body FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'contract' ORDER BY id DESC LIMIT 1").bind(id, user.companyId).first<{ id: number; status: string; body: string }>(),
    env.DB.prepare(
      `SELECT d.kind, d.id, d.status, d.body FROM documents d
        WHERE d.job_id = ? AND d.company_id = ? AND d.kind IN ('materials','schedule','instructions','punch','warranty','invoice')
          AND d.id = (SELECT MAX(id) FROM documents WHERE job_id = d.job_id AND kind = d.kind)`,
    ).bind(id, user.companyId).all(),
  ]);
  return json({
    job: { ...job, brief: undefined, schedule: undefined, startedOn: undefined, visit: undefined },
    visit: parse(job.visit) && typeof parse(job.visit) === "object" && parse(job.visit).date ? parse(job.visit) : null,
    schedule: parse(job.schedule) && typeof parse(job.schedule) === "object" && parse(job.schedule).start ? parse(job.schedule) : null,
    startedOn: job.startedOn ?? null,
    brief: parse(job.brief) && typeof parse(job.brief) === "object" && parse(job.brief).type ? cleanBrief(parse(job.brief), parse(job.brief).updatedAt ?? "") : null,
    jobTypes: JOB_TYPES,
    rateCard: card ? { method: card.method, data: parse(card.data), labels: labelsFor(parse(card.data)) } : null,
    estimate: doc ? { id: doc.id, status: doc.status, ...parse(doc.body) } : null,
    contract: contractDoc ? { id: contractDoc.id, status: contractDoc.status, ...parse(contractDoc.body) } : null,
    docs: Object.fromEntries(
      (extraDocs.results as any[]).map((d) => [d.kind, { id: d.id, status: d.status, ...parse(d.body) }]),
    ),
    crewLanguage: parse((await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(user.companyId).first<{ data: string }>())?.data)?.language?.crewDocs === "es" ? "es" : "en",
    events: events.results,
    changeOrders: await jobChangeOrders(env, user.companyId, id).then((r) => ({ approvedCents: r.totalCents, pending: r.pending })),
    coverage: coverageFor(await loadSummary(env, user.companyId), job.trade),
    commercial: job.trade === "commercial" ? await loadCommercialStatus(env, user.companyId, job.id) : null,
  });
}

/**
 * POST /api/estimate with an "action":
 *  draft  - fills editable lines from the painter's rate card and the quantities typed in (nothing is saved)
 *  save   - stores the estimate as a draft document and moves the job to the bid stage
 *  send   - emails the saved estimate to the customer as an attachment and marks it sent
 */
export async function handleEstimate(request: Request, env: Env): Promise<Response> {
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
    ? await env.DB.prepare("SELECT id, trade, title, customer_id AS customerId, property_id AS propertyId FROM jobs WHERE id = ? AND company_id = ?").bind(jobId, user.companyId).first<any>()
    : null;
  if (!job) return json({ error: "Job not found." }, 404);

  const profileRow = await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(user.companyId).first<{ data: string }>();
  const profile = parse(profileRow?.data);

  if (b.action === "draft") {
    const card = await env.DB.prepare("SELECT method, data FROM rate_cards WHERE company_id = ? AND trade = ? AND audience = 'retail'").bind(user.companyId, job.trade).first<{ method: string; data: string }>();
    if (!card) return json({ error: "Set up your prices for this trade first (Wizard, step 3)." }, 400);
    const qty: Record<string, number> = {};
    for (const [k, v] of Object.entries(b.quantities ?? {})) if (/^[A-Za-z0-9_]{1,40}$/.test(k) && Number.isFinite(Number(v))) qty[k] = Math.max(0, Math.min(1_000_000, Number(v)));
    const lines = draftLines(card.method, parse(card.data), qty, job.trade).map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, unitPrice: l.unitCents / 100 }));
    return json({ lines });
  }

  if (b.action === "aiDraft") {
    const jobRow = await env.DB.prepare("SELECT json_extract(j.data,'$.brief') AS brief, p.city AS city FROM jobs j LEFT JOIN properties p ON p.id = j.property_id WHERE j.id = ? AND j.company_id = ?").bind(job.id, user.companyId).first<{ brief: string | null; city: string | null }>();
    const stored = parse(jobRow?.brief);
    const brief: Brief = cleanBrief(stored?.type ? stored : b.brief, new Date().toISOString());
    const hasContent = !!brief.details || Object.keys(brief.answers).length > 0;
    if (!hasContent) return json({ error: "Tell me a little about the job first: tap the answers that fit, or type or speak a few notes." }, 400);
    const company = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt?: string }>();
    if (!company) return json({ error: "Not found." }, 404);
    const used = await consume(env, company, "estimate_draft");
    if (!used.allowed) {
      const msg = used.reason === "kill_switch" ? "The estimate helper is paused right now. You can still build the estimate by hand below." : used.reason === "not_in_plan" ? "The estimate helper is not included in your plan. You can still build the estimate by hand below." : "You have used this month's estimate drafts. You can still build the estimate by hand below, and your allowance starts over next month.";
      return json({ error: msg, code: used.reason }, 429);
    }
    const card = await env.DB.prepare("SELECT method, data FROM rate_cards WHERE company_id = ? AND trade = ? AND audience = 'retail'").bind(user.companyId, job.trade).first<{ method: string; data: string }>();
    const cardData = card ? parse(card.data) : {};
    const options = card && card.method !== "lump_sum" ? quantityOptions(card.method, cardData) : [];
    const finds = ((await env.DB.prepare("SELECT data FROM job_photo_findings WHERE job_id = ? AND company_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 6").bind(job.id, user.companyId).all<{ data: string }>().catch(() => ({ results: [] as { data: string }[] }))).results ?? []).flatMap((f) => (parse(f.data).issues ?? []).slice(0, 4).map((i: any) => `${String(i?.title ?? "").slice(0, 70)}: ${String(i?.fix ?? "").slice(0, 120)}`));
    const out = await completeEx(env, DRAFT_SYSTEM, [{ role: "user", content: draftPrompt(brief, options, jobRow?.city ?? "", finds, b.language === "es" ? "es" : "en") }], { prefer: ["gemini", "openai", "anthropic"], maxTokens: 2200 });
    const parsed = out ? parseJsonLoose(out.text) : null;
    if (!parsed) {
      await refund(env, company, "estimate_draft");
      return json({ error: "The estimate helper could not answer this time. Please try again in a minute, or build the estimate by hand below." }, 503);
    }
    const ai = cleanDraftAI(parsed, options);
    // The code prices the quantities from the painter's own list. The AI never sets a price.
    const priced = card ? draftLines(card.method, cardData, ai.quantities, job.trade).map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, unitPrice: l.unitCents / 100 })) : [];
    const extra = ai.extraLines.map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, unitPrice: 0, needsPrice: true }));
    return json({ scope: ai.scope, lines: [...priced, ...extra], pricedCount: priced.length, needsPriceCount: extra.length, inclusions: ai.inclusions, exclusions: ai.exclusions, assumptions: ai.assumptions, questions: ai.questions, hasPriceList: !!card });
  }

  const est = sanitizeEstimate(b?.estimate);
  if ((b.action === "save" || b.action === "send") && job.trade === "commercial") {
    const cs = await loadCommercialStatus(env, user.companyId, job.id);
    if (!cs.allowed) return json({ error: commercialBlockedMessage(cs), upgrade: true }, 403);
  }
  if ((b.action === "save" || b.action === "send") && !scheduleIsValid(est.schedule)) return json({ error: "The payment percentages must add up to 100." }, 400);
  const totals = computeTotals(est, { minimumJobCents: Math.round((profile?.labor?.minimumJob ?? 0) * 100), depositPct: profile?.labor?.depositPct });

  if (b.action === "save" || b.action === "send") {
    if (!est.lines.length) return json({ error: "Add at least one priced line." }, 400);
    const body = JSON.stringify({ estimate: est, totals });
    const existing = await env.DB.prepare("SELECT id FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' ORDER BY id DESC LIMIT 1").bind(job.id, user.companyId).first<{ id: number }>();
    let docId: number;
    if (existing) {
      docId = existing.id;
      await env.DB.prepare("UPDATE documents SET body = ?, language = ?, title = ?, updated_at = datetime('now') WHERE id = ?").bind(body, est.language, `Estimate: ${job.title}`.slice(0, 160), docId).run();
    } else {
      const ins = await env.DB.prepare("INSERT INTO documents (company_id, job_id, kind, language, status, title, body) VALUES (?, ?, 'estimate', ?, 'draft', ?, ?)")
        .bind(user.companyId, job.id, est.language, `Estimate: ${job.title}`.slice(0, 160), body)
        .run();
      docId = Number(ins.meta.last_row_id);
    }
    await env.DB.prepare("UPDATE jobs SET stage = CASE WHEN stage IN ('lead','bid') THEN 'bid' ELSE stage END, updated_at = datetime('now') WHERE id = ?").bind(job.id).run();
    await addJobEvent(env, user.companyId, job.id, "note", `Estimate saved: $${(totals.totalCents / 100).toFixed(2)}.`);

    if (b.action === "send") {
      const cust = await env.DB.prepare("SELECT name, email FROM customers WHERE id = ? AND company_id = ?").bind(job.customerId, user.companyId).first<{ name: string; email: string | null }>();
      if (!cust?.email) return json({ error: "This customer has no email address.", docId }, 400);
      const page = await renderForJob(env, user.companyId, job.id, est, totals);
      if (!page) return json({ error: "Not found." }, 404);
      const result = await sendCustomerEmail(
        env,
        cust.email,
        user.companyName,
        profile?.company?.email || user.email,
        est.language === "es" ? `Su presupuesto de ${user.companyName}` : `Your estimate from ${user.companyName}`,
        (est.language === "es"
          ? `Hola ${cust.name},\n\nAdjunto su presupuesto. Ábralo en su navegador y use Imprimir para guardarlo como PDF. Responda a este correo con cualquier pregunta.\n\n${user.companyName}`
          : `Hi ${cust.name},\n\nYour estimate is attached. Open it in your browser and use Print to save it as a PDF. Reply to this email with any questions.\n\n${user.companyName}`) + (await portalNote(env, user.companyId, job.id, est.language === "es")),
        [await documentAttachment(env, "estimate", page)],
      );
      if (result !== "sent") return json({ error: "The email could not be sent. Your estimate is saved.", docId }, 502);
      await env.DB.prepare("UPDATE documents SET status = 'sent', updated_at = datetime('now') WHERE id = ?").bind(docId).run();
      await addJobEvent(env, user.companyId, job.id, "note", `Estimate emailed to ${cust.email}.`);
    }
    return json({ ok: true, docId, totals });
  }
  return json({ error: "Unknown action." }, 400);
}

async function loadJobRow(env: Env, companyId: number, jobId: number) {
  const row = await env.DB.prepare(
    `SELECT j.title, co.name AS company, co.settings, cu.name AS customerName, cu.email AS customerEmail, cu.phone AS customerPhone,
            p.address, p.city, p.zip, cp.data AS profile
       FROM jobs j JOIN companies co ON co.id = j.company_id JOIN customers cu ON cu.id = j.customer_id
       LEFT JOIN properties p ON p.id = j.property_id LEFT JOIN company_profiles cp ON cp.company_id = j.company_id
      WHERE j.id = ? AND j.company_id = ?`,
  )
    .bind(jobId, companyId)
    .first<any>();
  if (!row) return null;
  const profile = parse(row.profile);
  const c = profile.company ?? {};
  return {
    row,
    profile,
    settings: readSettings(row.settings),
    company: { name: row.company as string, phone: c.phone, email: c.email, address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(", "), license: c.license, website: c.website },
    property: [row.address, row.city, row.zip].filter(Boolean).join(", "),
  };
}

const PUBLIC_BASE = "https://paintersmax.app";

async function renderForJob(env: Env, companyId: number, jobId: number, est: ReturnType<typeof sanitizeEstimate>, totals: ReturnType<typeof computeTotals>): Promise<string | null> {
  const j = await loadJobRow(env, companyId, jobId);
  if (!j) return null;
  const ins = j.profile.insurance ?? {};
  return renderEstimateHtml(
    {
      company: j.company,
      brandColor: j.settings.brandColor,
      logoUrl: j.settings.logoUrl,
      insuranceLine: ins.shareSummary ? [ins.carrier, ins.coverage].filter(Boolean).join(", ") : undefined,
      insuranceUrl: ins.shareSummary ? (await coiLink(env, companyId, PUBLIC_BASE)) ?? undefined : undefined,
      warrantyMonths: j.profile.warranty?.laborMonths,
      customer: { name: j.row.customerName, email: j.row.customerEmail, phone: j.row.customerPhone },
      property: j.property,
      jobTitle: j.row.title,
      date: new Date().toISOString().slice(0, 10),
    },
    est,
    totals,
  );
}

/** Rebuilds the estimate from the stored document (money is stored in cents). */
function storedEstimate(stored: any) {
  const e = stored?.estimate ?? {};
  return sanitizeEstimate({ ...e, lines: (e.lines ?? []).map((l: any) => ({ ...l, unitPrice: (l.unitCents ?? 0) / 100 })), discount: (e.discountCents ?? 0) / 100 });
}

async function renderContractForJob(env: Env, companyId: number, jobId: number, contract: ReturnType<typeof sanitizeContract>, stored: any): Promise<string | null> {
  const j = await loadJobRow(env, companyId, jobId);
  if (!j) return null;
  const est = storedEstimate(stored);
  return renderContractHtml(
    { company: j.company, brandColor: j.settings.brandColor, customerName: j.row.customerName, jobTitle: j.row.title, date: new Date().toISOString().slice(0, 10) },
    contract,
    est,
    stored.totals ?? computeTotals(est),
  );
}

/**
 * POST /api/contract with an "action":
 *  draft  - builds editable starting clauses from the saved estimate and the business profile (nothing is saved)
 *  save   - stores the contract as a draft document and moves the job to the contract stage
 *  send   - emails the saved contract to the customer as an attachment and marks it sent
 *  signed - records that both sides signed and moves the job to scheduled
 */
export async function handleContract(request: Request, env: Env): Promise<Response> {
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
  if (!Number.isInteger(jobId)) return json({ error: "Job not found." }, 404);
  const j = await loadJobRow(env, user.companyId, jobId);
  if (!j) return json({ error: "Job not found." }, 404);
  const estDoc = await env.DB.prepare("SELECT body FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' ORDER BY id DESC LIMIT 1").bind(jobId, user.companyId).first<{ body: string }>();
  if (!estDoc) return json({ error: "Save the estimate first. The contract uses its price and scope." }, 400);
  const stored = parse(estDoc.body);
  const est = storedEstimate(stored);
  const lang = b?.language === "es" ? "es" : "en";

  if (b.action === "draft") {
    const t = stored.totals ?? computeTotals(est);
    const startDate = text(b?.startDate, 40);
    const endDate = text(b?.endDate, 40);
    const clauses = defaultClauses({ company: j.company.name, customer: j.row.customerName, property: j.property, scope: est.scope, totals: t, startDate, endDate, profile: j.profile, estimate: est }, lang);
    return json({ clauses, language: lang });
  }

  const existing = await env.DB.prepare("SELECT id FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'contract' ORDER BY id DESC LIMIT 1").bind(jobId, user.companyId).first<{ id: number }>();

  if (b.action === "signed") {
    if (!existing) return json({ error: "Save the contract first." }, 400);
    await env.DB.prepare("UPDATE documents SET status = 'signed', updated_at = datetime('now') WHERE id = ?").bind(existing.id).run();
    await env.DB.prepare("UPDATE jobs SET stage = 'scheduled', updated_at = datetime('now') WHERE id = ? AND stage IN ('lead','bid','contract')").bind(jobId).run();
    await addJobEvent(env, user.companyId, jobId, "stage", "Contract signed by both sides.");
    return json({ ok: true });
  }

  if (b.action === "save" || b.action === "send") {
    const contract = sanitizeContract(b?.contract);
    if (!contract.clauses.length) return json({ error: "The contract has no clauses." }, 400);
    const body = JSON.stringify({ contract });
    let docId: number;
    if (existing) {
      docId = existing.id;
      await env.DB.prepare("UPDATE documents SET body = ?, language = ?, status = CASE WHEN status = 'signed' THEN 'draft' ELSE status END, updated_at = datetime('now') WHERE id = ?").bind(body, contract.language, docId).run();
    } else {
      const ins = await env.DB.prepare("INSERT INTO documents (company_id, job_id, kind, language, status, title, body) VALUES (?, ?, 'contract', ?, 'draft', ?, ?)")
        .bind(user.companyId, jobId, contract.language, `Contract: ${j.row.title}`.slice(0, 160), body)
        .run();
      docId = Number(ins.meta.last_row_id);
    }
    await env.DB.prepare("UPDATE jobs SET stage = CASE WHEN stage IN ('lead','bid') THEN 'contract' ELSE stage END, updated_at = datetime('now') WHERE id = ?").bind(jobId).run();
    await addJobEvent(env, user.companyId, jobId, "note", "Contract saved.");

    if (b.action === "send") {
      if (!j.row.customerEmail) return json({ error: "This customer has no email address.", docId }, 400);
      const page = await renderContractForJob(env, user.companyId, jobId, contract, stored);
      if (!page) return json({ error: "Not found." }, 404);
      const result = await sendCustomerEmail(
        env,
        j.row.customerEmail,
        user.companyName,
        j.company.email || user.email,
        contract.language === "es" ? `Su contrato de ${user.companyName}` : `Your work agreement from ${user.companyName}`,
        (contract.language === "es"
          ? `Hola ${j.row.customerName},\n\nAdjunto su contrato. Léalo, imprímalo, fírmelo y devuélvanoslo, o responda a este correo con cualquier pregunta.\n\n${user.companyName}`
          : `Hi ${j.row.customerName},\n\nYour work agreement is attached. Please read it, print it, sign it and send it back to us, or reply to this email with any questions.\n\n${user.companyName}`) + (await portalNote(env, user.companyId, jobId, contract.language === "es")),
        [await documentAttachment(env, "contract", page)],
      );
      if (result !== "sent") return json({ error: "The email could not be sent. Your contract is saved.", docId }, 502);
      await env.DB.prepare("UPDATE documents SET status = 'sent', updated_at = datetime('now') WHERE id = ?").bind(docId).run();
      await addJobEvent(env, user.companyId, jobId, "note", `Contract emailed to ${j.row.customerEmail}.`);
    }
    return json({ ok: true, docId });
  }
  return json({ error: "Unknown action." }, 400);
}

/** Renders a saved estimate, contract or job document as a full page. Used by the printout and by e-signature. */
export async function renderDocPage(env: Env, companyId: number, id: number): Promise<{ page: string; jobId: number; kind: string; language: string; title: string } | null> {
  const doc = await env.DB.prepare("SELECT job_id, kind, body, language, title FROM documents WHERE id = ? AND company_id = ? AND kind IN ('estimate','contract','materials','schedule','instructions','punch','warranty','invoice')").bind(id, companyId).first<{ job_id: number; kind: string; body: string; language: string; title: string }>();
  if (!doc) return null;
  const stored = parse(doc.body);
  let page: string | null;
  if (doc.kind === "contract") {
    const estDoc = await env.DB.prepare("SELECT body FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' ORDER BY id DESC LIMIT 1").bind(doc.job_id, companyId).first<{ body: string }>();
    page = estDoc ? await renderContractForJob(env, companyId, doc.job_id, sanitizeContract(stored.contract), parse(estDoc.body)) : null;
  } else if (isListKind(doc.kind) || doc.kind === "invoice") {
    page = await renderExtraDoc(env, companyId, doc.job_id, doc.kind, stored);
  } else {
    // Use the totals saved with the document so the printout always matches what was sent.
    const est = storedEstimate(stored);
    page = await renderForJob(env, companyId, doc.job_id, est, stored.totals ?? computeTotals(est));
  }
  return page ? { page, jobId: doc.job_id, kind: doc.kind, language: doc.language, title: doc.title } : null;
}

/** GET /api/doc?id= shows a saved estimate or contract as a printable page. Only the painter who owns it can open it. */
export async function handleDoc(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return html("<p>Not signed in. <a href='/login'>Sign in</a></p>", 401);
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return html("<p>Not found.</p>", 404);
  const r = await renderDocPage(env, user.companyId, id);
  if (!r) return html("<p>Not found.</p>", 404);
  if (new URL(request.url).searchParams.get("format") === "pdf") {
    const pdf = await htmlToPdf(env, r.page);
    if (pdf) return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${r.kind}.pdf"`, "cache-control": "no-store", "x-robots-tag": "noindex" } });
  }
  return html(r.page);
}

async function renderExtraDoc(env: Env, companyId: number, jobId: number, kind: string, stored: any): Promise<string | null> {
  const j = await loadJobRow(env, companyId, jobId);
  if (!j) return null;
  const ctx: DocContext = {
    company: j.company,
    brandColor: j.settings.brandColor,
    customerName: j.row.customerName,
    property: j.property,
    jobTitle: j.row.title,
    date: new Date().toISOString().slice(0, 10),
  };
  if (isListKind(kind)) return renderListDocHtml(kind, ctx, sanitizeListDoc(stored.doc));
  if (kind === "invoice") {
    const estDoc = await env.DB.prepare("SELECT body FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' ORDER BY id DESC LIMIT 1").bind(jobId, companyId).first<{ body: string }>();
    if (!estDoc) return null;
    const st = parse(estDoc.body);
    const est = storedEstimate(st);
    return renderInvoiceHtml(ctx, sanitizeInvoice({ ...stored.invoice, paid: (stored.invoice?.paidCents ?? 0) / 100 }), est, st.totals ?? computeTotals(est));
  }
  return null;
}

/**
 * POST /api/jobdoc for materials, schedule, instructions, punch, warranty and invoice. "action":
 *  draft - a starting document built from the trade and the business profile (nothing is saved)
 *  save  - stores it as a draft document and moves the job along
 *  send  - emails it to the customer (schedule, warranty and invoice only; the others are for the crew)
 *  paid  - invoice only: marks it paid and closes the job
 */
export async function handleJobDoc(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const kind = String(b?.kind);
  if (!isListKind(kind) && kind !== "invoice") return json({ error: "Unknown document." }, 400);
  const jobId = Number(b?.jobId);
  const j = Number.isInteger(jobId) ? await loadJobRow(env, user.companyId, jobId) : null;
  if (!j) return json({ error: "Job not found." }, 404);
  const jobMeta = await env.DB.prepare("SELECT trade FROM jobs WHERE id = ?").bind(jobId).first<{ trade: string }>();
  const lang = b?.language === "es" ? "es" : "en";
  const estDoc = await env.DB.prepare("SELECT body FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' ORDER BY id DESC LIMIT 1").bind(jobId, user.companyId).first<{ body: string }>();
  const stored = parse(estDoc?.body);
  if (kind === "invoice" && !estDoc) return json({ error: "Save the estimate first. The invoice uses its price." }, 400);

  if (b.action === "draft") {
    if (kind === "invoice") {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE company_id = ? AND kind = 'invoice'").bind(user.companyId).first<{ n: number }>();
      const sched = storedEstimate(stored).schedule;
      const amounts = milestoneAmounts(stored.totals?.totalCents ?? 0, sched);
      const ledger = await loadPayments(env, user.companyId, jobId);
      // What the customer actually paid (the payments you recorded) wins. With none recorded, a plain deposit-then-balance estimate assumes the deposit.
      const paid = ledger.length ? sumPaid(ledger) / 100 : sched.length ? 0 : (stored.totals?.depositCents ?? 0) / 100;
      const signed = await env.DB.prepare("SELECT 1 AS ok FROM signature_requests WHERE job_id = ? AND company_id = ? AND kind IN ('estimate','contract') AND status = 'signed' LIMIT 1").bind(jobId, user.companyId).first();
      const co = await jobChangeOrders(env, user.companyId, jobId);
      const punch = await env.DB.prepare("SELECT 1 AS ok FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'punch' LIMIT 1").bind(jobId, user.companyId).first();
      const total = (stored.totals?.totalCents ?? 0) + co.totalCents;
      // With a payment schedule the first invoice bills the first payment. Change orders ride along on the final payment, so they only add to the first bill when it is also the last.
      const firstBill = sched.length ? (amounts[0] ?? total) + (sched.length === 1 ? co.totalCents : 0) : total;
      const checks = invoiceChecks({ estimateSigned: !!signed, customerEmail: j.row.customerEmail, approvedChangeCents: co.totalCents, billedChangeCents: co.totalCents, pendingChangeOrders: co.pending, hasPunchList: !!punch, totalCents: total, paidCents: Math.round(paid * 100), billCents: firstBill });
      return json({
        invoice: { number: String(1001 + (n?.n ?? 0)), dueDate: j.profile.labor?.paymentTerms ?? "", paid, notes: "", extras: co.lines, howToPay: await loadHowToPay(env, user.companyId), language: lang, milestone: sched.length ? 0 : null },
        milestones: sched.map((m, i) => ({ label: m.label, pct: m.pct, amountCents: amounts[i] })),
        checks,
      });
    }
    const doc = starterDoc(kind, { trade: jobMeta?.trade ?? "interior", profile: j.profile, company: j.company.name, customer: j.row.customerName, startDate: text(b?.startDate, 10), completionDate: text(b?.completionDate, 40) }, lang);
    return json({ doc });
  }

  if (b.action === "note") {
    if (kind !== "invoice") return json({ error: "Unknown action." }, 400);
    const company = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt?: string }>();
    if (!company) return json({ error: "Not found." }, 404);
    const used = await consume(env, company, "ai_invoice");
    if (!used.allowed) {
      const msg = used.reason === "kill_switch" ? "The writing helper is paused right now. Try again soon." : used.reason === "not_in_plan" ? "The invoice writing helper is not included in your plan." : "You have used this month's invoice notes. Upgrade your plan for more.";
      return json({ error: msg, code: used.reason }, 429);
    }
    const note = await draftCoverNote(env, { company: user.companyName, customerFirst: String(j.row.customerName ?? "").split(/\s+/)[0] ?? "", title: j.row.title, trade: jobMeta?.trade ?? "", scope: String(stored.estimate?.scope ?? "") }, lang);
    if (!note) {
      await refund(env, company, "ai_invoice");
      return json({ error: "The writing helper could not answer. Write your own note or try again." }, 503);
    }
    return json({ note });
  }

  const existing = await env.DB.prepare("SELECT id, status, body FROM documents WHERE job_id = ? AND company_id = ? AND kind = ? ORDER BY id DESC LIMIT 1").bind(jobId, user.companyId, kind).first<{ id: number; status: string; body: string }>();

  if (b.action === "paid") {
    if (kind !== "invoice" || !existing) return json({ error: "Save the invoice first." }, 400);
    await env.DB.prepare("UPDATE documents SET status = 'paid', updated_at = datetime('now') WHERE id = ?").bind(existing.id).run();
    await env.DB.prepare("UPDATE jobs SET stage = 'closed', updated_at = datetime('now') WHERE id = ?").bind(jobId).run();
    await addJobEvent(env, user.companyId, jobId, "stage", "Invoice paid. Job closed.");
    return json({ ok: true });
  }

  if (b.action === "save" || b.action === "send") {
    let body: string;
    let language: string;
    if (kind === "invoice") {
      const inv = sanitizeInvoice(b?.invoice);
      body = JSON.stringify({ invoice: inv });
      language = inv.language;
    } else {
      const d = sanitizeListDoc(b?.doc);
      if (!d.items.length) return json({ error: "The document has no items." }, 400);
      body = JSON.stringify({ doc: d });
      language = d.language;
    }
    const title = `${docTitle(kind, language === "es" ? "es" : "en")}: ${j.row.title}`.slice(0, 160);
    let docId: number;
    // A sent or paid invoice is a record the customer already has, so it is locked. A change creates a corrected invoice and keeps the original.
    const locked = kind === "invoice" && !!existing && (existing.status === "sent" || existing.status === "paid");
    if (locked && b.corrected !== true && b.action !== "send") return json({ error: "This invoice was already sent, so it is locked. To change something, choose Create corrected invoice. The original stays on record.", code: "invoice_locked" }, 409);
    const resend = locked && b.corrected !== true && b.action === "send";
    if (resend && existing) {
      // Sending it again changes nothing: the stored invoice goes out as it is.
      docId = existing.id;
      body = existing.body;
    } else if (locked && existing) {
      const oldNo = String(parse(existing.body)?.invoice?.number ?? "");
      const inv2 = sanitizeInvoice(b?.invoice);
      if (oldNo && inv2.number === oldNo) inv2.number = `${oldNo}-A`;
      body = JSON.stringify({ invoice: inv2 });
      await env.DB.prepare("UPDATE documents SET status = 'superseded', updated_at = datetime('now') WHERE id = ?").bind(existing.id).run();
      const ins = await env.DB.prepare("INSERT INTO documents (company_id, job_id, kind, language, status, title, body) VALUES (?, ?, 'invoice', ?, 'draft', ?, ?)").bind(user.companyId, jobId, inv2.language, title, body).run();
      docId = Number(ins.meta.last_row_id);
      await addJobEvent(env, user.companyId, jobId, "note", `Corrected invoice ${inv2.number} created. The original${oldNo ? ` (${oldNo})` : ""} is kept on record.`);
    } else if (existing) {
      docId = existing.id;
      await env.DB.prepare("UPDATE documents SET body = ?, language = ?, title = ?, status = CASE WHEN status = 'paid' THEN 'paid' ELSE 'draft' END, updated_at = datetime('now') WHERE id = ?").bind(body, language, title, docId).run();
    } else {
      const ins = await env.DB.prepare("INSERT INTO documents (company_id, job_id, kind, language, status, title, body) VALUES (?, ?, ?, ?, 'draft', ?, ?)").bind(user.companyId, jobId, kind, language, title, body).run();
      docId = Number(ins.meta.last_row_id);
    }
    if (kind === "punch") await env.DB.prepare("UPDATE jobs SET stage = 'punch', updated_at = datetime('now') WHERE id = ? AND stage IN ('scheduled','in_progress')").bind(jobId).run();
    if (kind === "invoice") await env.DB.prepare("UPDATE jobs SET stage = 'invoiced', updated_at = datetime('now') WHERE id = ? AND stage NOT IN ('closed','lost')").bind(jobId).run();
    if (!resend) await addJobEvent(env, user.companyId, jobId, "note", `${docTitle(kind, "en")} saved.`);

    if (b.action === "send") {
      if (!CUSTOMER_KINDS.includes(kind)) return json({ error: "This document is for your crew. Print it instead.", docId }, 400);
      if (!j.row.customerEmail) return json({ error: "This customer has no email address.", docId }, 400);
      const page = await renderExtraDoc(env, user.companyId, jobId, kind, parse(body));
      if (!page) return json({ error: "Not found." }, 404);
      const es = language === "es";
      const label = docTitle(kind, es ? "es" : "en");
      const result = await sendCustomerEmail(
        env,
        j.row.customerEmail,
        user.companyName,
        j.company.email || user.email,
        `${label} - ${user.companyName}`,
        (es
          ? `Hola ${j.row.customerName},\n\nAdjunto: ${label}. Ábralo en su navegador y use Imprimir para guardarlo como PDF.\n\n${user.companyName}`
          : `Hi ${j.row.customerName},\n\nAttached: ${label}. Open it in your browser and use Print to save it as a PDF.\n\n${user.companyName}`) + (await portalNote(env, user.companyId, jobId, es)),
        [await documentAttachment(env, kind, page)],
      );
      if (result !== "sent") return json({ error: "The email could not be sent. Your document is saved.", docId }, 502);
      await env.DB.prepare("UPDATE documents SET status = CASE WHEN status = 'paid' THEN 'paid' ELSE 'sent' END, updated_at = datetime('now') WHERE id = ?").bind(docId).run();
      await addJobEvent(env, user.companyId, jobId, "note", `${label} emailed to ${j.row.customerEmail}.`);
    }
    return json({ ok: true, docId });
  }
  return json({ error: "Unknown action." }, 400);
}

/**
 * POST /api/assistant: the painter asks a question, optionally about one job.
 * The job's saved data is added as context (without street address, email or phone). Counts against the plan's monthly allowance.
 */
export async function handleAssistant(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const question = text(b?.message, 2000);
  if (!question) return json({ error: "Type a question first." }, 400);
  let context: string | null = null;
  if (b?.jobId !== undefined && b?.jobId !== null) {
    const jobId = Number(b.jobId);
    context = Number.isInteger(jobId) ? await buildJobContext(env, user.companyId, jobId) : null;
    if (!context) return json({ error: "Job not found." }, 404);
  }
  const company = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt?: string }>();
  if (!company) return json({ error: "Not found." }, 404);
  const used = await consume(env, company, "ai_assistant");
  if (!used.allowed) {
    const msg = used.reason === "kill_switch" ? "The assistant is paused right now. Try again soon." : used.reason === "not_in_plan" ? "The assistant is not included in your plan." : "You have used this month's assistant questions. Upgrade your plan for more.";
    return json({ error: msg, code: used.reason }, 429);
  }
  const reply = await ask(env, context, sanitizeHistory(b?.history), question, b?.language === "es" ? "es" : "en");
  if (!reply) {
    await refund(env, company, "ai_assistant");
    return json({ error: "The assistant could not answer right now. Please try again in a minute." }, 503);
  }
  return json({ reply, used: used.used, limit: used.limit });
}

/** POST /api/jobnote adds a note to a job's history. The painter can save an assistant answer this way. */
export async function handleJobNote(request: Request, env: Env): Promise<Response> {
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
  const note = text(b?.text, 2000);
  if (!Number.isInteger(jobId) || !note) return json({ error: "A note needs text." }, 400);
  const job = await env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").bind(jobId, user.companyId).first();
  if (!job) return json({ error: "Job not found." }, 404);
  await addJobEvent(env, user.companyId, jobId, "note", note);
  await env.DB.prepare("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?").bind(jobId).run();
  return json({ ok: true });
}

/** The painter's app language (English or Spanish), kept in their business profile so it follows them to any device. */
export async function handleLang(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const prof = await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(user.companyId).first<{ data: string }>();
  let data: any = {};
  try {
    data = prof ? JSON.parse(prof.data) : {};
  } catch {
    data = {};
  }
  if (request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const lang = body?.lang === "es" ? "es" : "en";
    data.language = { ...(data.language ?? {}), ui: lang };
    await env.DB.prepare(
      `INSERT INTO company_profiles (company_id, data, setup_step, completed, updated_at) VALUES (?, ?, 'start', 0, datetime('now'))
       ON CONFLICT(company_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    ).bind(user.companyId, JSON.stringify(data)).run();
    return json({ ok: true, lang });
  }
  return json({ lang: data?.language?.ui === "es" ? "es" : "en" });
}

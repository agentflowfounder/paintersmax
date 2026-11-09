import { getSessionUser } from "./auth.ts";
import { isTrade, METHODS, PROFILE_CAPS, sanitizeProfile, sanitizeRateData } from "./profile.ts";
import { normalizePlan } from "./usage.ts";
import type { Env } from "./types.ts";
import { computeTotals, draftLines, renderEstimateHtml, sanitizeEstimate } from "./estimate.ts";
import { addJobEvent } from "./crm.ts";
import { sendCustomerEmail } from "./email.ts";
import { readSettings } from "./settings.ts";

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
    await addJobEvent(env, user.companyId, jobId, "note", "Job created in the Wizard.");
    return json({ ok: true, jobId });
  }

  const rows = await env.DB.prepare(
    `SELECT j.id, j.title, j.trade, j.stage, j.updated_at AS updatedAt, c.name AS customer
       FROM jobs j JOIN customers c ON c.id = j.customer_id
      WHERE j.company_id = ? ORDER BY j.updated_at DESC LIMIT 200`,
  )
    .bind(user.companyId)
    .all();
  return json({ jobs: rows.results });
}

/** GET /api/job?id= returns one job with its customer, property, rate card, saved estimate and timeline. */
export async function handleJob(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Not found." }, 404);
  const job = await env.DB.prepare(
    `SELECT j.id, j.title, j.trade, j.stage, j.property_id AS propertyId, j.customer_id AS customerId,
            c.name AS customerName, c.email AS customerEmail, c.phone AS customerPhone,
            p.address, p.city, p.zip
       FROM jobs j JOIN customers c ON c.id = j.customer_id LEFT JOIN properties p ON p.id = j.property_id
      WHERE j.id = ? AND j.company_id = ?`,
  )
    .bind(id, user.companyId)
    .first<any>();
  if (!job) return json({ error: "Not found." }, 404);
  const [card, doc, events] = await Promise.all([
    env.DB.prepare("SELECT method, data FROM rate_cards WHERE company_id = ? AND trade = ? AND audience = 'retail'").bind(user.companyId, job.trade).first<{ method: string; data: string }>(),
    env.DB.prepare("SELECT id, status, body, language FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' ORDER BY id DESC LIMIT 1").bind(id, user.companyId).first<{ id: number; status: string; body: string; language: string }>(),
    env.DB.prepare("SELECT kind, text, created_at AS at FROM job_events WHERE job_id = ? AND company_id = ? ORDER BY id DESC LIMIT 30").bind(id, user.companyId).all(),
  ]);
  return json({
    job,
    rateCard: card ? { method: card.method, data: parse(card.data) } : null,
    estimate: doc ? { id: doc.id, status: doc.status, ...parse(doc.body) } : null,
    events: events.results,
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

  const est = sanitizeEstimate(b?.estimate);
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
        est.language === "es"
          ? `Hola ${cust.name},\n\nAdjunto su presupuesto. Ábralo en su navegador y use Imprimir para guardarlo como PDF. Responda a este correo con cualquier pregunta.\n\n${user.companyName}`
          : `Hi ${cust.name},\n\nYour estimate is attached. Open it in your browser and use Print to save it as a PDF. Reply to this email with any questions.\n\n${user.companyName}`,
        [{ filename: "estimate.html", content: toBase64(page) }],
      );
      if (result !== "sent") return json({ error: "The email could not be sent. Your estimate is saved.", docId }, 502);
      await env.DB.prepare("UPDATE documents SET status = 'sent', updated_at = datetime('now') WHERE id = ?").bind(docId).run();
      await addJobEvent(env, user.companyId, job.id, "note", `Estimate emailed to ${cust.email}.`);
    }
    return json({ ok: true, docId, totals });
  }
  return json({ error: "Unknown action." }, 400);
}

async function renderForJob(env: Env, companyId: number, jobId: number, est: ReturnType<typeof sanitizeEstimate>, totals: ReturnType<typeof computeTotals>): Promise<string | null> {
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
  const s = readSettings(row.settings);
  const c = profile.company ?? {};
  const ins = profile.insurance ?? {};
  return renderEstimateHtml(
    {
      company: { name: row.company, phone: c.phone, email: c.email, address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(", "), license: c.license, website: c.website },
      brandColor: s.brandColor,
      logoUrl: s.logoUrl,
      insuranceLine: ins.shareSummary ? [ins.carrier, ins.coverage].filter(Boolean).join(", ") : undefined,
      warrantyMonths: profile.warranty?.laborMonths,
      customer: { name: row.customerName, email: row.customerEmail, phone: row.customerPhone },
      property: [row.address, row.city, row.zip].filter(Boolean).join(", "),
      jobTitle: row.title,
      date: new Date().toISOString().slice(0, 10),
    },
    est,
    totals,
  );
}

/** GET /api/doc?id= shows a saved estimate as a printable page. Only the painter who owns it can open it. */
export async function handleDoc(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return html("<p>Not signed in. <a href='/login'>Sign in</a></p>", 401);
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return html("<p>Not found.</p>", 404);
  const doc = await env.DB.prepare("SELECT job_id, body FROM documents WHERE id = ? AND company_id = ? AND kind = 'estimate'").bind(id, user.companyId).first<{ job_id: number; body: string }>();
  if (!doc) return html("<p>Not found.</p>", 404);
  const stored = parse(doc.body);
  const est = sanitizeEstimate({ ...stored.estimate, lines: (stored.estimate?.lines ?? []).map((l: any) => ({ ...l, unitPrice: (l.unitCents ?? 0) / 100 })), discount: (stored.estimate?.discountCents ?? 0) / 100 });
  // Use the totals saved with the document so the printout always matches what was sent.
  const page = await renderForJob(env, user.companyId, doc.job_id, est, stored.totals ?? computeTotals(est));
  if (!page) return html("<p>Not found.</p>", 404);
  return html(page);
}

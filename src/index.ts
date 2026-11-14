import { coverageLine } from "./insurance.ts";
import { geminiModel } from "./gemini.ts";
import { handleHome } from "./home.ts";
import { coiLink, handleInsurance, handlePublicInsurance, sendInsuranceReminders, showsCustomers } from "./insurance.ts";
import { handlePublicTicker } from "./ticker.ts";
import { handleEsign, handleSign } from "./esign.ts";
import { writeSummary } from "./ai.ts";
import { ownerBriefText, writeBrief } from "./brief.ts";
import { addJobEvent, ensureCustomerAndJob, tradeFor } from "./crm.ts";
import { handleAdmin } from "./admin.ts";
import { handleAuthConfig, handleGoogleCallback, handleGoogleStart } from "./google.ts";
import { handleBilling, handleCheckout, handleStripeWebhook } from "./stripe.ts";
import { handleAssistant, handleContract, handleDoc, handleJobDoc, handleJobNote, handleEstimate, handleJob, handleJobs, handleLang, handleProfile, handleRateCard } from "./wizard-api.ts";
import { endSession, getSessionUser, requestLoginLink, verifyLoginLink } from "./auth.ts";
import { sendCustomerEmail, sendLeadEmail } from "./email.ts";
import { priceRange } from "./pricing.ts";
import { readSettings, renderQuotePage, sanitize, tenantFromHost } from "./settings.ts";
import { handleImport } from "./import.ts";
import { handleSchedule, scheduledJobs } from "./schedule.ts";
import { handleCalSettings, handleFeed } from "./calfeed.ts";
import { slugForHost } from "./domains.ts";
import { handleCatalog } from "./ratecatalog.ts";
import { handleCities, refreshStaleCities } from "./cities.ts";
import { handleWorkOrders, handleWoPublic } from "./workorders.ts";
import { handleJobPay } from "./payments.ts";
import { handleRecords } from "./records.ts";
import { handleCrew } from "./crew.ts";
import { handleAnalysis } from "./analysis.ts";
import { handleJobFile } from "./jobfile.ts";
import { handleLessons } from "./lessons.ts";
import { handleCertPublic, handleWarranty } from "./warranty.ts";
import { handlePhotoAnalysis } from "./photoanalysis.ts";
import { handleHelp } from "./helplib.ts";
import { handleBrand } from "./brand.ts";
import { visionAsk } from "./vision.ts";
import { handleFiles } from "./files.ts";
import { handleJobLost } from "./joblost.ts";
import { handleJobChat } from "./jobchat.ts";
import { handleEstimatePreview } from "./estimate-preview.ts";
import { handleCityPage, handleCityPagesApi, citySitemap } from "./citypages.ts";
import { handleMaterials, loadMaterials, renderPublicMaterials } from "./materials.ts";
import { handleRateCardDoc } from "./ratecardpdf.ts";
import { handleRateSheetPage, handleRateSheets } from "./ratesheets.ts";
import { handlePortalManage, handlePortalPage, portalNote, renderLookupPage, handleProjectLookup } from "./portal.ts";
import { sendInvoiceReminders } from "./reminders.ts";
import { bookedVisits, handleVisit, sendVisitReminders } from "./visit.ts";
import { sendStartNotices } from "./startnotice.ts";
import { handlePulse } from "./pulse.ts";
import { handleSignoff } from "./signoff.ts";
import { consume, isFeature, refund, usageSummary } from "./usage.ts";
import type { Env } from "./types.ts";
import { parsePhotos, parseQuoteRequest } from "./validate.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function handleQuote(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  // Honeypot: real people never fill this hidden field.
  if (body && typeof body.website === "string" && body.website.length > 0) return json({ ok: true });

  const parsed = parseQuoteRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const q = parsed.value;

  const company = await env.DB.prepare("SELECT id, name, notify_email, plan, settings, created_at AS createdAt FROM companies WHERE slug = ?")
    .bind(q.companySlug)
    .first<{ id: number; name: string; notify_email: string | null; plan: string; settings: string; createdAt?: string }>();
  if (!company) return json({ error: "Unknown company." }, 404);

  const { lowCents, highCents } = priceRange(q.jobType, q.sqft, readSettings(company.settings).rates);
  const { provider, summary } = await writeSummary(env, q, lowCents, highCents);

  // Photo brief: metered under ai_estimate. If the plan is used up or the AI fails, the normal quote still goes out.
  let brief: Awaited<ReturnType<typeof writeBrief>> = null;
  if (q.photos?.length) {
    const use = await consume(env, company, "ai_estimate");
    if (use.allowed) {
      brief = await writeBrief(env, q, lowCents, highCents);
      if (!brief) await refund(env, company, "ai_estimate");
    }
  }

  const lead = await env.DB.prepare("INSERT INTO leads (company_id, name, email, phone, zip) VALUES (?, ?, ?, ?, ?)")
    .bind(company.id, q.name, q.email, q.phone ?? null, q.zip ?? null)
    .run();
  const leadId = lead.meta.last_row_id;
  await env.DB.prepare(
    "INSERT INTO quotes (company_id, lead_id, job_type, sqft, details, low_cents, high_cents, provider, summary, brief, photo_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(company.id, leadId, q.jobType, q.sqft, q.details ?? null, lowCents, highCents, provider, summary, brief ? JSON.stringify(brief.brief) : null, q.photos?.length ?? 0)
    .run();

  // The lead becomes a customer and a job file the painter can work from.
  const fileIds = await ensureCustomerAndJob(env, {
    companyId: company.id,
    leadId: Number(leadId),
    name: q.name,
    email: q.email,
    phone: q.phone,
    zip: q.zip,
    title: `${q.jobType.replace(/_/g, " ")} painting, ${q.sqft} sq ft`,
    trade: tradeFor(q.jobType),
    firstEvent: `Instant quote: ${q.jobType}, ${q.sqft} sq ft. Range shown $${Math.round(lowCents / 100)} to $${Math.round(highCents / 100)}. Customer notes: ${q.details ?? "none"}`,
  });
  if (fileIds && brief) await addJobEvent(env, company.id, fileIds.jobId, "photo_brief", ownerBriefText(brief.brief, lowCents, highCents));

  const covQuote = await coverageLine(env, company.id, tradeFor(q.jobType));
  ctx.waitUntil(
    sendLeadEmail(
      env,
      company.notify_email,
      `New quote lead for ${company.name}: ${q.name}`,
      [
        `Name: ${q.name}`,
        `Email: ${q.email}`,
        `Phone: ${q.phone ?? "n/a"}`,
        `ZIP: ${q.zip ?? "n/a"}`,
        `Job: ${q.jobType}, ${q.sqft} sq ft`,
        `Range shown: $${Math.round(lowCents / 100)} to $${Math.round(highCents / 100)}`,
        `Notes: ${q.details ?? "none"}`,
        `Photos: ${q.photos?.length ?? 0}`,
        ...(covQuote ? [covQuote] : []),
        ...(brief ? ["", ownerBriefText(brief.brief, lowCents, highCents)] : q.photos?.length ? ["", "(Photos attached. The AI brief was not generated, so review them by hand.)"] : []),
      ].join("\n"),
      q.photos?.map((p, i) => ({ filename: `customer-photo-${i + 1}.${p.mime.split("/")[1] === "jpeg" ? "jpg" : p.mime.split("/")[1]}`, content: p.data })),
    ),
  );

  // Confirmation to the customer (replies go to the company).
  const portalTxt = await portalNote(env, company.id, fileIds?.jobId, false);
  const lowD = Math.round(lowCents / 100).toLocaleString("en-US");
  const highD = Math.round(highCents / 100).toLocaleString("en-US");
  ctx.waitUntil(
    sendCustomerEmail(
      env,
      q.email,
      company.name,
      company.notify_email || env.NOTIFY_EMAIL,
      `Your painting estimate from ${company.name}`,
      [
        `Hi ${q.name.split(" ")[0]},`,
        "",
        `Thanks for requesting an estimate from ${company.name}.`,
        "",
        `Your ballpark range for ${q.jobType.replace(/_/g, " ")} (${q.sqft} sq ft): $${lowD} to $${highD}.`,
        "",
        summary,
        ...(brief ? ["", "What we saw in your photos:", brief.brief.projectSummary] : []),
        "",
        "This is a ballpark only. We will follow up to confirm details and give you a firm written quote.",
        "You can reply to this email with questions or photos.",
        "",
        company.name,
      ].join("\n") + portalTxt,
    ),
  );

  return json({ ok: true, lowCents, highCents, summary });
}

/** Adds a note (for example from the website chat) to the newest lead with this email, and alerts the owner. */
async function handleLeadNote(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const email = str(body?.email, 200).toLowerCase();
  const note = str(body?.note, 1500);
  if (!note || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Email and note are required." }, 400);
  const company = await env.DB.prepare("SELECT id, name, notify_email FROM companies WHERE slug = ?")
    .bind(str(body?.companySlug, 60) || "dfw-painters")
    .first<{ id: number; name: string; notify_email: string | null }>();
  if (!company) return json({ error: "Unknown company." }, 404);
  const lead = await env.DB.prepare(
    "SELECT id, name, phone, notes, job_id FROM leads WHERE company_id = ? AND lower(email) = ? ORDER BY id DESC LIMIT 1",
  )
    .bind(company.id, email)
    .first<{ id: number; name: string; phone: string | null; notes: string | null; job_id: number | null }>();
  if (!lead) return json({ error: "No matching lead." }, 404);
  if (lead.job_id) await addJobEvent(env, company.id, lead.job_id, "chat", note);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const merged = `${lead.notes ? lead.notes + "\n\n" : ""}[Chat ${stamp} UTC] ${note}`.slice(0, 6000);
  // Saved now, emailed later: the scheduled digest sends ONE email after the chat has been quiet for a while.
  await env.DB.prepare("UPDATE leads SET notes = ?, notes_updated_at = datetime('now') WHERE id = ?").bind(merged, lead.id).run();
  return json({ ok: true });
}

async function handleLead(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = str(body?.name, 120);
  const email = str(body?.email, 200);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Name and a valid email are required." }, 400);
  const company = await env.DB.prepare("SELECT id, name, notify_email FROM companies WHERE slug = ?")
    .bind(str(body?.companySlug, 60) || "dfw-painters")
    .first<{ id: number; name: string; notify_email: string | null }>();
  if (!company) return json({ error: "Unknown company." }, 404);
  const source = str(body?.source, 60) || "website";
  const leadIns = await env.DB.prepare("INSERT INTO leads (company_id, name, email, phone, zip, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(company.id, name, email, str(body?.phone, 40) || null, str(body?.zip, 10) || null, source, str(body?.details, 2000) || null)
    .run();
  const detailsText = str(body?.details, 2000);
  await ensureCustomerAndJob(env, {
    companyId: company.id,
    leadId: Number(leadIns.meta.last_row_id),
    name,
    email,
    phone: str(body?.phone, 40) || null,
    zip: str(body?.zip, 10) || null,
    title: detailsText.slice(0, 80) || `Request from ${name}`,
    trade: tradeFor(detailsText.match(/Service:\s*([^.]*)/i)?.[1] ?? detailsText),
    firstEvent: `${source}: ${detailsText || "(no details)"}`,
  });
  // The contact form emails the owner itself; other sources (like the chat) are alerted here.
  if (ctx && source !== "website-contact-form") {
    const covChat = await coverageLine(env, company.id, tradeFor(detailsText.match(/Service:\s*([^.]*)/i)?.[1] ?? detailsText));
    ctx.waitUntil(
      sendLeadEmail(
        env,
        company.notify_email,
        `New ${source} lead for ${company.name}: ${name}`,
        [`Name: ${name}`, `Email: ${email}`, `Phone: ${str(body?.phone, 40) || "n/a"}`, `ZIP: ${str(body?.zip, 10) || "n/a"}`, "", str(body?.details, 2000), covChat].join("\n"),
      ),
    );
  }
  return json({ ok: true });
}

/** Client websites call this (server to server) before running a metered AI feature. */
async function handleConsume(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get("x-site-token") ?? "";
  if (!env.SITE_TOKEN) return json({ error: "Not configured." }, 503);
  if (token.length !== env.SITE_TOKEN.length || token !== env.SITE_TOKEN) return json({ error: "Forbidden." }, 403);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (!isFeature(body?.feature)) return json({ error: "Unknown feature." }, 400);
  const company = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE slug = ?")
    .bind(typeof body?.companySlug === "string" ? body.companySlug.slice(0, 60) : "")
    .first<{ id: number; plan: string; createdAt?: string }>();
  if (!company) return json({ error: "Unknown company." }, 404);
  const visitor = typeof body?.visitor === "string" && body.visitor ? body.visitor.slice(0, 64) : undefined;
  if (body.refund === true) {
    await refund(env, company, body.feature, visitor);
    return json({ ok: true });
  }
  const result = await consume(env, company, body.feature, visitor);
  return json(result, result.allowed ? 200 : 429);
}

/** Photo analysis for forms that have no price tool (for example a website's contact form). Token-gated, metered. */
async function handleBrief(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get("x-site-token") ?? "";
  if (!env.SITE_TOKEN) return json({ error: "Not configured." }, 503);
  if (token.length !== env.SITE_TOKEN.length || token !== env.SITE_TOKEN) return json({ error: "Forbidden." }, 403);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const photos = parsePhotos(body?.photos);
  if (!photos.length) return json({ error: "No usable photos." }, 400);
  const company = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE slug = ?")
    .bind(str(body?.companySlug, 60))
    .first<{ id: number; plan: string; createdAt?: string }>();
  if (!company) return json({ error: "Unknown company." }, 404);
  const visitor = str(body?.visitor, 64) || undefined;
  const use = await consume(env, company, "ai_estimate", visitor);
  if (!use.allowed) return json({ error: "limit", reason: use.reason }, 429);
  const service = str(body?.service, 100);
  const jobType = service.toLowerCase().includes("exterior") ? "exterior" : "interior";
  const out = await writeBrief(env, {
    name: "",
    email: "",
    jobType,
    sqft: 0,
    zip: str(body?.zip, 10),
    details: `${service}. ${str(body?.details, 1500)}`,
    photos,
    companySlug: str(body?.companySlug, 60),
  });
  if (!out) {
    await refund(env, company, "ai_estimate", visitor);
    return json({ error: "ai_unavailable" }, 502);
  }
  return json({ ok: true, provider: out.provider, text: ownerBriefText(out.brief), summary: out.brief.projectSummary });
}

/** Minutes of quiet after the last chat note before the owner gets the conversation summary. */
const CHAT_QUIET_MINUTES = 10;

/** Runs every few minutes (see wrangler.jsonc triggers). Sends one chat summary email per finished conversation. */
async function sendChatDigests(env: Env): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT l.id, l.name, l.email, l.phone, l.zip, l.notes, c.name AS company, c.notify_email AS notifyEmail
       FROM leads l JOIN companies c ON c.id = l.company_id
      WHERE l.notes_updated_at IS NOT NULL
        AND (l.notes_emailed_at IS NULL OR l.notes_emailed_at < l.notes_updated_at)
        AND l.notes_updated_at < datetime('now', ?)
      LIMIT 25`,
  )
    .bind(`-${CHAT_QUIET_MINUTES} minutes`)
    .all<{ id: number; name: string; email: string; phone: string | null; zip: string | null; notes: string | null; company: string; notifyEmail: string | null }>();
  let sent = 0;
  for (const r of rows.results) {
    const result = await sendLeadEmail(
      env,
      r.notifyEmail,
      `Chat summary: ${r.name}`,
      [
        `${r.name} finished a chat with the website assistant.`,
        `Email: ${r.email}`,
        `Phone: ${r.phone ?? "n/a"}`,
        `ZIP: ${r.zip ?? "n/a"}`,
        "",
        "WHAT WE LEARNED (saved by the assistant during the chat)",
        r.notes ?? "(no notes)",
      ].join("\n"),
    );
    // Mark as emailed only when it really went out, so a failed send is retried on the next run.
    if (result === "sent" || !env.RESEND_API_KEY) {
      await env.DB.prepare("UPDATE leads SET notes_emailed_at = datetime('now') WHERE id = ?").bind(r.id).run();
      sent++;
    }
  }
  return sent;
}

/** Public quote page for one company: /q/their-slug. Works as a link and inside an iframe. */
/**
 * The address the visitor sees. A client's own Worker forwards /areas/* here and sends X-Forwarded-Host with their domain,
 * so the page names their domain as canonical. Only a plain hostname is accepted.
 */
function visitorOrigin(request: Request): string {
  const fwd = (request.headers.get("x-forwarded-host") ?? "").toLowerCase().trim();
  if (/^[a-z0-9]([a-z0-9.-]{0,120}[a-z0-9])?\.[a-z]{2,}$/.test(fwd)) return `https://${fwd}`;
  return new URL(request.url).origin;
}

async function handleQuotePage(request: Request, env: Env, slug: string): Promise<Response> {
  const c = await env.DB.prepare("SELECT id, slug, name, settings FROM companies WHERE slug = ?")
    .bind(slug)
    .first<{ id: number; slug: string; name: string; settings: string }>();
  if (!c) return new Response("Not found.", { status: 404 });
  const tpl = await env.ASSETS.fetch(new URL("/q-template.html", request.url));
  // Optional "Insured" badge, only when the painter chose to show their coverage and has a valid proof page.
  const proof = (await showsCustomers(env, c.id)) ? await coiLink(env, c.id, new URL(request.url).origin) : null;
  const html = renderQuotePage(await tpl.text(), c, readSettings(c.settings), proof);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
}

/** Signed-in owner reads and updates their company's settings. */
async function handleSettings(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const row = await env.DB.prepare("SELECT slug, name, notify_email, settings FROM companies WHERE id = ?")
    .bind(user.companyId)
    .first<{ slug: string; name: string; notify_email: string | null; settings: string }>();
  if (!row) return json({ error: "Not found." }, 404);
  if (request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
    const email = typeof body?.notifyEmail === "string" ? body.notifyEmail.trim().slice(0, 200) : "";
    if (!name) return json({ error: "Company name is required." }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid notification email." }, 400);
    const settings = sanitize(body?.settings);
    await env.DB.prepare("UPDATE companies SET name = ?, notify_email = ?, settings = ? WHERE id = ?")
      .bind(name, email || null, JSON.stringify(settings), user.companyId)
      .run();
    return json({ ok: true });
  }
  return json({ slug: row.slug, name: row.name, notifyEmail: row.notify_email, settings: readSettings(row.settings) });
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sendChatDigests(env).catch((err) => console.error("chat digest failed", String(err))));
    ctx.waitUntil(sendInvoiceReminders(env).catch((err) => console.error("invoice reminders failed", String(err))));
    ctx.waitUntil(sendVisitReminders(env).catch((err) => console.error("visit reminders failed", String(err))));
    ctx.waitUntil(sendStartNotices(env).catch((err) => console.error("start notices failed", String(err))));
    ctx.waitUntil(sendInsuranceReminders(env).catch((err) => console.error("insurance reminders failed", String(err))));
    ctx.waitUntil(refreshStaleCities(env).catch((err) => console.error("city refresh failed", String(err))));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return friendly404(request, env, await handle(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;

/**
 * A browser that lands on a plain-text "Not found." (an old customer link, a mistyped address) sees the friendly
 * public/404.html instead. API calls, calendar feeds and downloads keep their plain or JSON answers.
 */
async function friendly404(request: Request, env: Env, res: Response): Promise<Response> {
  if (res.status !== 404 || request.method !== "GET") return res;
  if (!(res.headers.get("content-type") ?? "").startsWith("text/plain")) return res;
  if (!(request.headers.get("accept") ?? "").includes("text/html")) return res;
  try {
    const page = await env.ASSETS.fetch(new URL("/404", request.url));
    if (page.ok) return new Response(page.body, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch {
    // fall through to the plain answer
  }
  return res;
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname, hostname } = new URL(request.url);
    // A client's own address: rivera-painting.paintersmax.app shows their quote page. Owners sign in on the main site.
    // A client's own domain (managed in Cloudflare and mapped to a company in the admin page) behaves like their subdomain.
    const tenant = tenantFromHost(hostname) ?? (await slugForHost(env, hostname).catch(() => null));
    if (tenant) {
      const ao = pathname.match(/^\/areas\/([a-z0-9-]{3,70})\/?$/);
      if (ao) return handleCityPage(request, env, tenant, ao[1], visitorOrigin(request));
      if (pathname === "/check-project") {
        const co = await env.DB.prepare("SELECT name, settings FROM companies WHERE slug = ?").bind(tenant).first<{ name: string; settings: string }>();
        return co ? new Response(renderLookupPage(co.name, readSettings(co.settings).brandColor), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }) : new Response("Not found.", { status: 404 });
      }
      if (pathname === "/api/portal/lookup") return handleProjectLookup(request, env, tenant);
      if (pathname === "/sitemap.xml" || pathname === "/sitemap-areas.xml") return citySitemap(env, tenant, visitorOrigin(request));
      if (pathname === "/" || pathname === "/quote") return handleQuotePage(request, env, tenant);
      if (["/login", "/dashboard", "/app", "/jobs", "/insurance", "/materials", "/admin", "/start"].includes(pathname)) {
        return Response.redirect(`https://paintersmax.app${pathname}`, 302);
      }
    }
    if (pathname === "/api/health") {
      // ?probe=1 (signed in only): one tiny photo question per AI provider, so a failing key, quota or model name shows up here.
      if (new URL(request.url).searchParams.get("probe") === "1") {
        if (!(await getSessionUser(env, request))) return json({ error: "Sign in first, then open this address again." }, 401);
        const px = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        const result: Record<string, string> = {};
        for (const p of ["gemini", "openai", "anthropic"] as const) {
          const out = await visionAsk(env, { system: "Reply with the single word OK.", user: "Reply OK.", mime: "image/png", data: px, maxTokens: 20 }, { json: false, prefer: [p] });
          result[p] = out.ok ? "works" : out.why;
        }
        return json({ ok: true, models: { gemini: geminiModel(env), openai: env.MODEL_OPENAI ?? "gpt-4.1-mini", anthropic: env.MODEL_ANTHROPIC ?? "claude-sonnet-5-5" }, photoQuestion: result });
      }
      return json({
        ok: true,
        providers: {
          gemini: !!env.GEMINI_API_KEY,
          openai: !!env.OPENAI_API_KEY,
          anthropic: !!env.ANTHROPIC_API_KEY,
          resend: !!env.RESEND_API_KEY,
        },
      });
    }
    if (pathname === "/api/quote") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      try {
        return await handleQuote(request, env, ctx);
      } catch (err) {
        console.error("quote failed", String(err));
        return json({ error: "Something went wrong. Please try again." }, 500);
      }
    }
    if (pathname === "/api/lead" && request.method === "POST") {
      try {
        return await handleLead(request, env, ctx);
      } catch (err) {
        console.error("lead failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/lead/note" && request.method === "POST") {
      try {
        return await handleLeadNote(request, env, ctx);
      } catch (err) {
        console.error("lead note failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/auth/request" && request.method === "POST") {
      let body: any = {};
      try {
        body = await request.json();
      } catch {}
      try {
        await requestLoginLink(env, new URL(request.url).origin, body?.email);
      } catch (err) {
        console.error("login link failed", String(err));
      }
      return json({ ok: true }); // same answer whether or not the email exists
    }
    if (pathname === "/api/auth/config") return handleAuthConfig(env);
    if (pathname === "/api/auth/google") {
      try {
        return await handleGoogleStart(request, env);
      } catch (err) {
        console.error("google start failed", String(err));
        return Response.redirect(new URL("/login?error=google_failed", request.url).toString(), 302);
      }
    }
    if (pathname === "/api/auth/google/callback") {
      try {
        return await handleGoogleCallback(request, env);
      } catch (err) {
        console.error("google callback failed", String(err));
        return Response.redirect(new URL("/login?error=google_failed", request.url).toString(), 302);
      }
    }
    if (pathname === "/api/auth/verify") {
      const result = await verifyLoginLink(env, new URL(request.url).searchParams.get("token"));
      if (!result) return new Response("This sign-in link is invalid or expired. Please request a new one.", { status: 400 });
      return new Response(null, { status: 302, headers: { location: "/dashboard", "set-cookie": result.cookie } });
    }
    if (pathname === "/api/auth/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", "set-cookie": await endSession(env, request) },
      });
    }
    if (pathname === "/api/me") {
      const user = await getSessionUser(env, request);
      return user ? json({ email: user.email, company: user.companyName }) : json({ error: "Not signed in." }, 401);
    }
    if (pathname === "/api/usage/consume" && request.method === "POST") {
      try {
        return await handleConsume(request, env);
      } catch (err) {
        console.error("consume failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    // The Wizard lives at app.<domain>: its home page is the wizard app.
    if (pathname === "/" && new URL(request.url).hostname.startsWith("app.")) {
      return env.ASSETS.fetch(new URL("/app", request.url));
    }
    if (pathname === "/api/profile") {
      try {
        return await handleProfile(request, env);
      } catch (err) {
        console.error("profile failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/lang") {
      try {
        return await handleLang(request, env);
      } catch (err) {
        console.error("lang failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/portal") {
      try {
        return await handlePortalManage(request, env);
      } catch (err) {
        console.error("portal manage failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname.startsWith("/portal/")) {
      try {
        return await handlePortalPage(request, env);
      } catch (err) {
        console.error("portal page failed", String(err));
        return new Response("Something went wrong.", { status: 500 });
      }
    }
    if (pathname.startsWith("/rates/")) {
      try {
        return await handleRateSheetPage(request, env, pathname);
      } catch (err) {
        console.error("rate sheet page failed", String(err));
        return new Response("Something went wrong.", { status: 500 });
      }
    }
    if (pathname === "/api/calsettings") {
      try {
        return await handleCalSettings(request, env);
      } catch (err) {
        console.error("calsettings failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname.startsWith("/cal/")) {
      try {
        return await handleFeed(request, env, async (id) => [...(await scheduledJobs(env, id)), ...(await bookedVisits(env, id).catch(() => [])).map((v) => ({ jobId: v.jobId, title: v.title, customer: v.customer, address: v.address, start: v.date, end: v.date, startTime: v.time, crew: [] as string[], notes: v.notes, visit: true }))]);
      } catch (err) {
        console.error("calendar feed failed", String(err));
        return new Response("Something went wrong.", { status: 500 });
      }
    }
    if (pathname === "/api/pulse") {
      try {
        return await handlePulse(request, env);
      } catch (err) {
        console.error("pulse failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/signoff") {
      try {
        return await handleSignoff(request, env);
      } catch (err) {
        console.error("signoff failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/visit") {
      try {
        return await handleVisit(request, env);
      } catch (err) {
        console.error("visit failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/schedule") {
      try {
        return await handleSchedule(request, env);
      } catch (err) {
        console.error("schedule failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/import/customers") {
      try {
        return await handleImport(request, env);
      } catch (err) {
        console.error("import failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/ratecard/doc") {
      try {
        return await handleRateCardDoc(request, env);
      } catch (err) {
        console.error("ratecard doc failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/ratesheets") {
      try {
        return await handleRateSheets(request, env);
      } catch (err) {
        console.error("ratesheets failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/materials") {
      try {
        return await handleMaterials(request, env);
      } catch (err) {
        console.error("materials failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/painting-materials" && request.method === "GET") {
      return new Response(renderPublicMaterials(await loadMaterials(env)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
    }
    const am = pathname.match(/^\/areas\/([a-z0-9-]{1,40})\/([a-z0-9-]{3,70})\/?$/);
    if (am) return handleCityPage(request, env, am[1], am[2], `https://${am[1]}.paintersmax.app`);
    if (pathname === "/api/citypages") {
      try {
        return await handleCityPagesApi(request, env);
      } catch (err) {
        console.error("citypages failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/estimate-preview") {
      try {
        return await handleEstimatePreview(request, env);
      } catch (err) {
        console.error("estimate preview failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/cities") {
      try {
        return await handleCities(request, env);
      } catch (err) {
        console.error("cities failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/catalog") {
      try {
        return await handleCatalog(request, env);
      } catch (err) {
        console.error("catalog failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/ratecard") {
      try {
        return await handleRateCard(request, env);
      } catch (err) {
        console.error("ratecard failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/jobs") {
      try {
        return await handleJobs(request, env);
      } catch (err) {
        console.error("handleJobs failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/job") {
      try {
        return await handleJob(request, env);
      } catch (err) {
        console.error("handleJob failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/estimate") {
      try {
        return await handleEstimate(request, env);
      } catch (err) {
        console.error("handleEstimate failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/contract") {
      try {
        return await handleContract(request, env);
      } catch (err) {
        console.error("handleContract failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/jobdoc") {
      try {
        return await handleJobDoc(request, env);
      } catch (err) {
        console.error("handleJobDoc failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname.startsWith("/wo/")) return handleWoPublic(request, env);
    if (pathname.startsWith("/cert/")) return handleCertPublic(request, env);
    if (pathname === "/api/warranty") {
      try {
        return await handleWarranty(request, env);
      } catch (err) {
        console.error("warranty failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/analysis") {
      try {
        return await handleAnalysis(request, env);
      } catch (err) {
        console.error("analysis failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/jobfile") {
      try {
        return await handleJobFile(request, env);
      } catch (err) {
        console.error("jobfile failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/lessons") {
      try {
        return await handleLessons(request, env);
      } catch (err) {
        console.error("lessons failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/crew") {
      try {
        return await handleCrew(request, env);
      } catch (err) {
        console.error("crew failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/records") {
      try {
        return await handleRecords(request, env);
      } catch (err) {
        console.error("records failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/jobpay") {
      try {
        return await handleJobPay(request, env);
      } catch (err) {
        console.error("jobpay failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/workorders") {
      try {
        return await handleWorkOrders(request, env);
      } catch (err) {
        console.error("workorders failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/brand") {
      try {
        return await handleBrand(request, env);
      } catch (err) {
        console.error("brand failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/help") {
      try {
        return await handleHelp(request, env);
      } catch (err) {
        console.error("help failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/photoanalysis") {
      try {
        return await handlePhotoAnalysis(request, env);
      } catch (err) {
        console.error("photoanalysis failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/files") {
      try {
        return await handleFiles(request, env);
      } catch (err) {
        console.error("files failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/joblost") {
      try {
        return await handleJobLost(request, env);
      } catch (err) {
        console.error("joblost failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/jobchat") {
      try {
        return await handleJobChat(request, env);
      } catch (err) {
        console.error("jobchat failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/assistant") {
      try {
        return await handleAssistant(request, env);
      } catch (err) {
        console.error("handleAssistant failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/jobnote") {
      try {
        return await handleJobNote(request, env);
      } catch (err) {
        console.error("handleJobNote failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/checkout") {
      try {
        return await handleCheckout(request, env);
      } catch (err) {
        console.error("handleCheckout failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/stripe/webhook") {
      try {
        return await handleStripeWebhook(request, env);
      } catch (err) {
        console.error("handleStripeWebhook failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/billing") {
      try {
        return await handleBilling(request, env);
      } catch (err) {
        console.error("handleBilling failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/admin") {
      try {
        return await handleAdmin(request, env);
      } catch (err) {
        console.error("handleAdmin failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/home") {
      try {
        return await handleHome(request, env);
      } catch (err) {
        console.error("handleHome failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/insurance/public" || pathname === "/api/insurance/public/file") {
      try {
        return await handlePublicInsurance(request, env);
      } catch (err) {
        console.error("handlePublicInsurance failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname.startsWith("/coi/") && request.method === "GET") return env.ASSETS.fetch(new URL("/coi", request.url));
    if (pathname === "/api/insurance") {
      try {
        return await handleInsurance(request, env);
      } catch (err) {
        console.error("handleInsurance failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/ticker" && request.method === "GET") {
      try {
        return await handlePublicTicker(env);
      } catch (err) {
        console.error("ticker failed", String(err));
        return json({ enabled: false });
      }
    }
    if (pathname === "/api/esign" || pathname === "/api/esign/record") {
      try {
        return await handleEsign(request, env);
      } catch (err) {
        console.error("handleEsign failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/sign/view" || pathname === "/api/sign/submit") {
      try {
        return await handleSign(request, env);
      } catch (err) {
        console.error("handleSign failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname.startsWith("/sign/") && request.method === "GET") {
      return env.ASSETS.fetch(new URL("/sign", request.url));
    }
    if (pathname === "/api/doc") {
      try {
        return await handleDoc(request, env);
      } catch (err) {
        console.error("handleDoc failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/quote") return Response.redirect(new URL("/q/dfw-painters", request.url).toString(), 302);
    if (pathname.startsWith("/q/") && request.method === "GET") {
      return await handleQuotePage(request, env, decodeURIComponent(pathname.slice(3)).slice(0, 60));
    }
    if (pathname === "/api/settings") {
      try {
        return await handleSettings(request, env);
      } catch (err) {
        console.error("settings failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/brief" && request.method === "POST") {
      try {
        return await handleBrief(request, env);
      } catch (err) {
        console.error("brief failed", String(err));
        return json({ error: "Something went wrong." }, 500);
      }
    }
    if (pathname === "/api/usage") {
      const user = await getSessionUser(env, request);
      if (!user) return json({ error: "Not signed in." }, 401);
      const c = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt?: string }>();
      return c ? json(await usageSummary(env, c)) : json({ error: "Not found." }, 404);
    }
    if (pathname === "/api/leads") {
      const user = await getSessionUser(env, request);
      if (!user) return json({ error: "Not signed in." }, 401);
      const rows = await env.DB.prepare(
        `SELECT l.id, l.name, l.email, l.phone, l.zip, l.status, l.source, l.notes, l.created_at AS createdAt,
                q.job_type AS jobType, q.sqft, q.low_cents AS lowCents, q.high_cents AS highCents, q.provider
           FROM leads l LEFT JOIN quotes q ON q.lead_id = l.id
          WHERE l.company_id = ? ORDER BY l.id DESC LIMIT 200`,
      )
        .bind(user.companyId)
        .all();
      return json({ company: user.companyName, leads: rows.results });
    }
    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
}


import { writeSummary } from "./ai.ts";
import { endSession, getSessionUser, requestLoginLink, verifyLoginLink } from "./auth.ts";
import { sendCustomerEmail, sendLeadEmail } from "./email.ts";
import { priceRange } from "./pricing.ts";
import type { Env } from "./types.ts";
import { parseQuoteRequest } from "./validate.ts";

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

  const company = await env.DB.prepare("SELECT id, name, notify_email FROM companies WHERE slug = ?")
    .bind(q.companySlug)
    .first<{ id: number; name: string; notify_email: string | null }>();
  if (!company) return json({ error: "Unknown company." }, 404);

  const { lowCents, highCents } = priceRange(q.jobType, q.sqft);
  const { provider, summary } = await writeSummary(env, q, lowCents, highCents);

  const lead = await env.DB.prepare("INSERT INTO leads (company_id, name, email, phone, zip) VALUES (?, ?, ?, ?, ?)")
    .bind(company.id, q.name, q.email, q.phone ?? null, q.zip ?? null)
    .run();
  const leadId = lead.meta.last_row_id;
  await env.DB.prepare(
    "INSERT INTO quotes (company_id, lead_id, job_type, sqft, details, low_cents, high_cents, provider, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(company.id, leadId, q.jobType, q.sqft, q.details ?? null, lowCents, highCents, provider, summary)
    .run();

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
      ].join("\n"),
    ),
  );

  // Confirmation to the customer (replies go to the company).
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
        "",
        "This is a ballpark only. We will follow up to confirm details and give you a firm written quote.",
        "You can reply to this email with questions or photos.",
        "",
        company.name,
      ].join("\n"),
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
    "SELECT id, name, phone, notes FROM leads WHERE company_id = ? AND lower(email) = ? ORDER BY id DESC LIMIT 1",
  )
    .bind(company.id, email)
    .first<{ id: number; name: string; phone: string | null; notes: string | null }>();
  if (!lead) return json({ error: "No matching lead." }, 404);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const merged = `${lead.notes ? lead.notes + "\n\n" : ""}[Chat ${stamp} UTC] ${note}`.slice(0, 6000);
  await env.DB.prepare("UPDATE leads SET notes = ? WHERE id = ?").bind(merged, lead.id).run();
  ctx.waitUntil(
    sendLeadEmail(
      env,
      company.notify_email,
      `Chat update from ${lead.name}`,
      [`Name: ${lead.name}`, `Email: ${email}`, `Phone: ${lead.phone ?? "n/a"}`, "", note].join("\n"),
    ),
  );
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
  await env.DB.prepare("INSERT INTO leads (company_id, name, email, phone, zip, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(company.id, name, email, str(body?.phone, 40) || null, str(body?.zip, 10) || null, source, str(body?.details, 2000) || null)
    .run();
  // The contact form emails the owner itself; other sources (like the chat) are alerted here.
  if (ctx && source !== "website-contact-form") {
    ctx.waitUntil(
      sendLeadEmail(
        env,
        company.notify_email,
        `New ${source} lead for ${company.name}: ${name}`,
        [`Name: ${name}`, `Email: ${email}`, `Phone: ${str(body?.phone, 40) || "n/a"}`, `ZIP: ${str(body?.zip, 10) || "n/a"}`, "", str(body?.details, 2000)].join("\n"),
      ),
    );
  }
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health") {
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
  },
} satisfies ExportedHandler<Env>;

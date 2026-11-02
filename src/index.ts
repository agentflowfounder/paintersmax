import { writeSummary } from "./ai.ts";
import { sendLeadEmail } from "./email.ts";
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

  return json({ ok: true, lowCents, highCents, summary });
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
    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

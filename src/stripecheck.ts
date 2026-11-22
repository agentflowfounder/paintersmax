import { adminActor, can } from "./adminroles.ts";
import type { Env } from "./types.ts";

/**
 * Admin > Subscriptions: the Stripe self-check card. One look tells whether payments can work before a painter
 * finds out: test or live keys, the webhook secret, the webhook address and events Stripe sends, the last event
 * we received, and the last failed payment. Read only; it never charges or changes anything in Stripe.
 */

/** The events the webhook in stripe.ts acts on. Stripe must send all of them. */
export const NEEDED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;
/** The addresses the app answers webhooks on (index.ts). */
export const WEBHOOK_PATHS = ["/api/stripe/webhook", "/api/stripe-webhook"];

export type KeyMode = "live" | "test" | "missing" | "unknown";
export function keyMode(key: string | undefined): KeyMode {
  if (!key) return "missing";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return "unknown";
}

export interface EndpointCheck { url: string; status: string; ours: boolean; missing: string[] }
/** Compares one Stripe webhook endpoint with what the app needs. "*" (all events) covers everything. */
export function checkEndpoint(ep: { url?: unknown; status?: unknown; enabled_events?: unknown }, host: string): EndpointCheck {
  const url = typeof ep.url === "string" ? ep.url : "";
  let ours = false;
  try {
    const u = new URL(url);
    ours = u.hostname === host && WEBHOOK_PATHS.includes(u.pathname);
  } catch {}
  const ev = Array.isArray(ep.enabled_events) ? ep.enabled_events.map(String) : [];
  const missing = ev.includes("*") ? [] : NEEDED_EVENTS.filter((e) => !ev.includes(e));
  return { url, status: typeof ep.status === "string" ? ep.status : "", ours, missing };
}

/** Plain-language problems, worst first. Empty = all good. */
export function stripeProblems(o: { mode: KeyMode; webhookSecret: boolean; endpoints: EndpointCheck[] | null; lastEventAt: string | null }): string[] {
  const p: string[] = [];
  if (o.mode === "missing") p.push("No Stripe secret key in Cloudflare (STRIPE_SECRET_KEY). Nobody can pay.");
  if (o.mode === "unknown") p.push("The Stripe key does not look like a secret key (sk_live_ or sk_test_).");
  if (!o.webhookSecret) p.push("No webhook signing secret in Cloudflare (STRIPE_WEBHOOK_SECRET). Payments would not add credits or doors.");
  if (o.endpoints) {
    const ours = o.endpoints.filter((e) => e.ours);
    if (!ours.length) p.push("Stripe has no webhook pointing to this site. Add one in Stripe: Developers, Webhooks.");
    for (const e of ours) {
      if (e.status && e.status !== "enabled") p.push(`The Stripe webhook ${e.url} is ${e.status}.`);
      if (e.missing.length) p.push(`The Stripe webhook ${e.url} is missing these events: ${e.missing.join(", ")}.`);
    }
  }
  if (!o.lastEventAt && o.mode !== "missing") p.push("No Stripe event has reached the site yet. Send a test event from Stripe to check.");
  return p;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function listEndpoints(env: Env): Promise<{ ok: true; data: any[] } | { ok: false; why: string }> {
  try {
    const r = await fetch("https://api.stripe.com/v1/webhook_endpoints?limit=20", { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) return { ok: false, why: `Stripe said ${r.status}${j?.error?.message ? `: ${String(j.error.message).slice(0, 160)}` : ""}` };
    return { ok: true, data: Array.isArray(j?.data) ? j.data : [] };
  } catch (err) {
    return { ok: false, why: String(err).slice(0, 160) };
  }
}

/** GET /api/admin/stripe-check (admins who can see Subscriptions). */
export async function handleStripeCheck(request: Request, env: Env): Promise<Response> {
  const actor = await adminActor(env, request);
  if (!actor) return json({ error: "Not found." }, 404);
  if (!can(actor.role, "subscriptions", "see")) return json({ error: "Your role cannot see this." }, 403);
  const mode = keyMode(env.STRIPE_SECRET_KEY);
  const last = await env.DB.prepare("SELECT type, created_at AS at FROM stripe_events ORDER BY created_at DESC LIMIT 1").first<{ type: string; at: string }>().catch(() => null);
  const week = await env.DB.prepare("SELECT COUNT(*) AS n FROM stripe_events WHERE created_at > datetime('now', '-7 days')").first<{ n: number }>().catch(() => null);
  const failed = await env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'past_due:%' ORDER BY value DESC LIMIT 1").first<{ key: string; value: string }>().catch(() => null);
  const pastDue = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'past_due:%'").first<{ n: number }>().catch(() => null);
  let endpoints: EndpointCheck[] | null = null;
  let endpointError: string | null = null;
  if (mode === "live" || mode === "test") {
    const l = await listEndpoints(env);
    if (l.ok) endpoints = l.data.map((e) => checkEndpoint(e, new URL(request.url).hostname));
    else endpointError = l.why; // a restricted key may not read webhooks; the rest of the card still helps
  }
  const lastEventAt = last?.at ?? null;
  return json({
    mode,
    webhookSecret: !!env.STRIPE_WEBHOOK_SECRET,
    endpoints,
    endpointError,
    needed: NEEDED_EVENTS,
    lastEvent: last ? { type: last.type, at: last.at } : null,
    eventsThisWeek: week?.n ?? 0,
    lastFailedPayment: failed ? { companyId: Number(failed.key.slice(9)), at: failed.value } : null,
    pastDueNow: pastDue?.n ?? 0,
    problems: stripeProblems({ mode, webhookSecret: !!env.STRIPE_WEBHOOK_SECRET, endpoints, lastEventAt }),
  });
}

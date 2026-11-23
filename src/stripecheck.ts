import { adminActor, can, logAudit } from "./adminroles.ts";
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

/** What the launch checklist needs from Stripe: are the webhooks right, and when did the last event arrive. */
export async function stripeFacts(env: Env, host: string): Promise<{ endpointsOk: boolean | null; lastEventAt: string | null }> {
  const mode = keyMode(env.STRIPE_SECRET_KEY);
  const last = await env.DB.prepare("SELECT created_at AS at FROM stripe_events ORDER BY created_at DESC LIMIT 1").first<{ at: string }>().catch(() => null);
  let endpointsOk: boolean | null = null;
  if (mode === "live" || mode === "test") {
    const l = await listEndpoints(env);
    if (l.ok) endpointsOk = l.data.map((e) => checkEndpoint(e, host)).some((e) => e.ours && !e.missing.length && (!e.status || e.status === "enabled"));
  }
  return { endpointsOk, lastEventAt: last?.at ?? null };
}

/** One step of the Test Stripe button. */
export interface TestStep { ok: boolean; text: string }
export interface SelfTestIo {
  /** Calls Stripe (POST, form body). */
  post: (path: string, form: Record<string, string>) => Promise<any>;
  /** Calls Stripe (DELETE). */
  del: (path: string) => Promise<void>;
  /** Events that reached this site since the test began. */
  eventsSince: (since: string) => Promise<{ type: string; at: string }[]>;
  sleep: (ms: number) => Promise<void>;
  now: () => string; // "YYYY-MM-DD HH:MM:SS" in UTC, the format stripe_events.created_at uses
}

/**
 * The Test Stripe button. Test mode only (never live: it would charge a real card). It makes a throwaway customer with
 * a test card and a $1 test subscription, so Stripe itself sends real events to the webhook; then it waits up to
 * `waitMs` for an event to reach this site, and deletes the throwaway customer (which cancels the subscription).
 * This proves the whole path: Stripe, the webhook address, the signing secret and the handler.
 */
export async function runSelfTest(io: SelfTestIo, mode: KeyMode, waitMs = 14000): Promise<{ ok: boolean; steps: TestStep[]; events: string[] }> {
  const steps: TestStep[] = [];
  if (mode !== "test") return { ok: false, steps: [{ ok: false, text: mode === "live" ? "The test is off while live keys are in, because it would use a real card. Use a real purchase of the cheapest door instead." : "There is no Stripe key to test with." }], events: [] };
  let customer = "";
  try {
    const since = io.now();
    const c = await io.post("customers", { email: "stripe-selftest@paintersmax.app", name: "PaintersMax self-test (safe to delete)", "metadata[purpose]": "paintersmax self-test" });
    customer = c.id;
    await io.post("payment_methods/pm_card_visa/attach", { customer });
    await io.post(`customers/${customer}`, { "invoice_settings[default_payment_method]": "pm_card_visa" });
    const product = await io.post("products", { name: "PaintersMax self-test (safe to delete)" });
    await io.post("subscriptions", { customer, "items[0][price_data][currency]": "usd", "items[0][price_data][product]": product.id, "items[0][price_data][unit_amount]": "100", "items[0][price_data][recurring][interval]": "month", "metadata[purpose]": "paintersmax self-test" });
    steps.push({ ok: true, text: "Made a test customer and a $1 test payment in Stripe (test mode, no real money)." });
    let got: { type: string; at: string }[] = [];
    for (let waited = 0; waited <= waitMs && !got.length; waited += 1500) {
      got = await io.eventsSince(since);
      if (!got.length) await io.sleep(1500);
    }
    const types = [...new Set(got.map((e) => e.type))];
    steps.push(got.length
      ? { ok: true, text: `Stripe's event reached this site and was accepted: ${types.join(", ")}.` }
      : { ok: false, text: "No event reached this site in 14 seconds. In Stripe > Developers > Webhooks > your destination > Event deliveries, a 400 means the signing secret in Cloudflare (STRIPE_WEBHOOK_SECRET) is not this destination's; a 404 means the URL is wrong; nothing listed means the destination is not listening to your account's events." });
    return { ok: got.length > 0, steps, events: types };
  } catch (err) {
    steps.push({ ok: false, text: `Stripe refused a step: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` });
    return { ok: false, steps, events: [] };
  } finally {
    if (customer) {
      try {
        await io.del(`customers/${customer}`);
        steps.push({ ok: true, text: "Removed the test customer (its test subscription is cancelled)." });
      } catch (err) {
        steps.push({ ok: false, text: "Could not remove the test customer. Delete it in Stripe: Customers, search \"self-test\"." });
      }
    }
  }
}

/** GET /api/admin/stripe-check (admins who can see Subscriptions). POST {action:"test"} runs the Test Stripe button. */
export async function handleStripeCheck(request: Request, env: Env): Promise<Response> {
  const actor = await adminActor(env, request);
  if (!actor) return json({ error: "Not found." }, 404);
  if (!can(actor.role, "subscriptions", "see")) return json({ error: "Your role cannot see this." }, 403);
  if (request.method === "POST") {
    if (!can(actor.role, "subscriptions", "change")) return json({ error: "Your role cannot run this." }, 403);
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    if (b?.action !== "test") return json({ error: "Unknown action." }, 400);
    const auth = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
    const io: SelfTestIo = {
      post: async (path, form) => {
        const r = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: { ...auth, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
        const j = (await r.json().catch(() => ({}))) as any;
        if (!r.ok) throw new Error(`${path}: ${j?.error?.message ?? r.status}`);
        return j;
      },
      del: async (path) => {
        const r = await fetch(`https://api.stripe.com/v1/${path}`, { method: "DELETE", headers: auth });
        if (!r.ok) throw new Error(String(r.status));
      },
      eventsSince: async (since) => ((await env.DB.prepare("SELECT type, created_at AS at FROM stripe_events WHERE created_at >= ? ORDER BY created_at LIMIT 20").bind(since).all<{ type: string; at: string }>()).results ?? []),
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      now: () => new Date().toISOString().slice(0, 19).replace("T", " "),
    };
    const res = await runSelfTest(io, keyMode(env.STRIPE_SECRET_KEY));
    await logAudit(env, actor, "stripe_selftest", { detail: res.ok ? `ok: ${res.events.join(", ")}` : "failed" }).catch(() => {});
    return json(res);
  }
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

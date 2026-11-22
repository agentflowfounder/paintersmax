import { provisionClient } from "./admin.ts";
import { requestLoginLink } from "./auth.ts";
import { todayLocal } from "./dates.ts";
import { visitorKey } from "./guard.ts";
import { updateBlob, writeBlob } from "./kv.ts";
import { sanitizeProfile } from "./profile.ts";
import { seedSamples } from "./samples.ts";
import { cleanSlug, cleanTag, creditCheckout } from "./landing.ts";
import { upgradeCheckoutForm } from "./sitebuilder.ts";
import { doorCharge, loadStarter, pickPromo } from "./starter.ts";
import { stripeApi } from "./stripe.ts";
import { isPaidDoor, type PaidDoor } from "./subscriptions.ts";
import { dailyCap } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * POST /api/start/free: the public "Start free" sign-up (no card). It opens a Free account, adds the welcome credits
 * (starter campaign settings and daily ceiling, see starter.ts) and emails a sign-in link.
 * When the visitor picked a paid door, the answer also carries a Stripe checkout for that door, with the running
 * promotion (or the code they typed) applied. Paying is optional: the Free account is already open either way.
 *
 * The Early Access Agreement tick is checked and recorded before this runs (requireAgreement in index.ts).
 * A filled hidden "website" field (a form robot) gets the same friendly answer and nothing is created.
 */

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Old landing pages pass the old plan names; they map to the doors (Starter = Local Pro, Basic = Contractor, Pro = Commercial). */
export function doorFromInput(v: unknown): PaidDoor | null {
  const m: Record<string, PaidDoor> = { starter: "launch", basic: "grow", pro: "signature" };
  if (typeof v !== "string") return null;
  const d = m[v] ?? v;
  return isPaidDoor(d) ? d : null;
}

/** The answers to "How did you hear about us?" (the page sends one of these; anything else is stored as "other"). */
export const HEARD = ["google", "facebook", "youtube", "friend", "painter", "truck", "supplier", "other"] as const;
/** "Tyler, TX" becomes city Tyler and state TX; with no state the whole text is the city. */
export function splitCity(v: string): { city: string; state: string } {
  const m = /^(.*?),\s*([A-Za-z]{2})$/.exec(v.trim());
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : { city: v.trim(), state: "" };
}
export interface SignupInput { heard: string; name: string; email: string; city: string; phone: string; lang: "en" | "es"; door: PaidDoor | null; code: string; lp: string; src: string; robot: boolean }
export function readSignup(b: any): SignupInput | { error: string } {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const name = s(b?.name, 100);
  const email = s(b?.email, 200).toLowerCase();
  if (!name) return { error: "Enter your company name." };
  if (!EMAIL.test(email)) return { error: "Enter a valid email address." };
  const city = s(b?.city, 80);
  const phone = s(b?.phone, 30).replace(/[^0-9+()\-. ]/g, "");
  // City and phone are required: they qualify the account and fill in the setup wizard.
  if (!city) return { error: "Enter your city." };
  if (phone.replace(/\D/g, "").length < 10) return { error: "Enter a phone number with 10 digits." };
  return {
    heard: (HEARD as readonly string[]).includes(s(b?.heard, 20)) ? s(b?.heard, 20) : s(b?.heard, 20) ? "other" : "",
    name, email, city, phone,
    lang: b?.lang === "es" ? "es" : "en", door: doorFromInput(b?.door), code: s(b?.code, 24), lp: cleanSlug(b?.lp), src: cleanTag(b?.src), robot: !!s(b?.website, 200),
  };
}

export async function handleFreeSignup(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const i = readSignup(b);
  if ("error" in i) return json({ error: i.error }, 400);
  const origin = new URL(request.url).origin;
  const done = { ok: true, sent: true, email: i.email };
  if (i.robot) return json(done);

  const settings = await loadStarter(env);
  const master = await env.DB.prepare("SELECT id FROM companies WHERE slug = 'paintersmax-master'").first<{ id: number }>();
  if (master && !(await dailyCap(env, master.id, `signup:v:${await visitorKey(request, b?.browserId)}`, settings.perVisitorDaily))) {
    return json({ error: "This device has opened the most free accounts allowed today. Write to support@paintersmax.app if you need another." }, 429);
  }

  const r = await provisionClient(env, origin, { name: i.name, email: i.email, plan: "free" }, { capped: true, sendLink: false });
  if (!r.ok) return json({ error: r.error }, 400);
  if (!r.created) {
    // The email already has an account: send a fresh sign-in link and give the same answer (it never says who has an account).
    await requestLoginLink(env, origin, i.email, { lang: i.lang }).catch((err) => console.error("signup link failed", String(err)));
    return json(done);
  }
  const today = todayLocal();
  // Where the sign-up came from, for the campaign report (no database change: signup:<companyId>).
  await writeBlob(env, `signup:${r.companyId}`, { on: today, lp: i.lp, src: i.src, door: i.door ?? "free", city: i.city, phone: i.phone, lang: i.lang, heard: i.heard }).catch(() => {});
  if (i.heard) await updateBlob(env, "heardstats", (raw: any) => ({ counts: raw && typeof raw.counts === "object" && raw.counts ? (raw.counts as Record<string, number>) : {} }), (cur) => ({ value: { counts: { ...cur.counts, [i.heard]: (Number(cur.counts[i.heard]) || 0) + 1 } } })).catch(() => {});
  // Fill in the setup wizard: the painter should not type their company, phone and city again.
  const where = splitCity(i.city);
  const prof = sanitizeProfile({ company: { legalName: i.name, phone: i.phone, email: i.email, city: where.city, state: where.state }, language: { ui: i.lang, crewDocs: i.lang } }, "free");
  await env.DB.prepare("INSERT INTO company_profiles (company_id, data, setup_step, completed, updated_at) VALUES (?, ?, 'start', 0, datetime('now')) ON CONFLICT(company_id) DO NOTHING").bind(r.companyId, JSON.stringify(prof)).run().catch((err) => console.error("signup profile failed", String(err)));
  await seedSamples(env, r.companyId, i.lang).catch((err) => console.error("signup samples failed", String(err)));
  await creditCheckout(env, request).catch(() => {});
  // The welcome email carries the first sign-in link, in the language picked on the form.
  await requestLoginLink(env, origin, i.email, { lang: i.lang, welcome: { company: i.name, credits: r.welcome?.status === "granted" ? r.welcome.credits : 0 } }).catch((err) => console.error("welcome link failed", String(err)));

  const welcome = r.welcome ? { credits: r.welcome.credits, status: r.welcome.status, expiresOn: r.welcome.expiresOn } : null;
  if (!i.door || !env.STRIPE_SECRET_KEY) return json({ ...done, welcome, door: i.door, checkout: null });
  const pick = await pickPromo(env, i.door, i.code, today);
  const charge = doorCharge("free", i.door, pick.promo, today);
  try {
    const s = await stripeApi(env, "checkout/sessions", upgradeCheckoutForm(origin, { companyId: r.companyId, email: i.email, from: "free", to: i.door, cents: charge.cents, promoCode: charge.promoApplied ? pick.promo!.code : "", successPath: "/start?paid=1" }));
    return json({ ...done, welcome, door: i.door, checkout: s.url ?? null, codeNote: pick.error ?? null });
  } catch (err) {
    console.error("signup checkout failed", String(err));
    return json({ ...done, welcome, door: i.door, checkout: null });
  }
}

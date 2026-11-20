import { CREDIT_COST, DOOR_CREDITS, grantCredits, grantDoorCredits } from "./credits.ts";
import { addDaysIso } from "./dates.ts";
import { readBlob, updateBlob, writeBlob } from "./kv.ts";
import { loadPromos, normCode, promoPrice, redeemPromo, type Promo } from "./promos.ts";
import { upgradeCents, type Door } from "./sitecore.ts";
import { readSub, subKey, type PaidDoor, type SubRecord } from "./subscriptions.ts";
import type { Env } from "./types.ts";
import type { Feature } from "./usage.ts";

/**
 * The starter campaign: "Start free: your own quote page and tools, plus 250 AI credits" (Do List thread 3, 2026-11-20).
 *
 *  - Every new account gets welcome credits once. The amount and how long they last are admin settings (default
 *    250 credits for 60 days, Rogelio 2026-11-15), so they can be tuned by season without a code change.
 *  - Public free sign-ups count against a daily ceiling (default 150 accounts a day). Over the ceiling the account is
 *    still opened at once; only the welcome credits wait, and the next morning run adds them. A launch-day surge can
 *    therefore never cost more AI than the ceiling allows. Accounts made by hand in admin are never held.
 *  - A promotion marked "applies by itself" (Booked by Spring) is used at a paid door's checkout without a code.
 *
 * Everything lives in app_settings (no database change): "starter" (settings), "starterheld" (the waiting list).
 * Daily counts are usage_counters rows under the PaintersMax company: "starter:welcome" per day.
 */

export interface StarterSettings {
  on: boolean; // false = new accounts get no welcome credits
  welcomeCredits: number;
  welcomeDays: number;
  dailyCap: number; // public sign-ups that get welcome credits the same day
  perVisitorDaily: number; // free sign-ups one visitor (network address + browser) may make in a day
}
export const STARTER_KEY = "starter";
export const HELD_KEY = "starterheld";
export const STARTER_DEFAULTS: StarterSettings = { on: true, welcomeCredits: 250, welcomeDays: 60, dailyCap: 150, perVisitorDaily: 3 };
const MAX_HELD = 5000;

const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
export function readStarter(raw: unknown): StarterSettings {
  const r = (raw ?? {}) as any;
  const d = STARTER_DEFAULTS;
  return {
    on: r.on !== false,
    welcomeCredits: clampInt(r.welcomeCredits, 0, 1500, d.welcomeCredits),
    welcomeDays: clampInt(r.welcomeDays, 7, 365, d.welcomeDays),
    dailyCap: clampInt(r.dailyCap, 1, 5000, d.dailyCap),
    perVisitorDaily: clampInt(r.perVisitorDaily, 1, 20, d.perVisitorDaily),
  };
}
export const loadStarter = (env: Env) => readBlob(env, STARTER_KEY, readStarter);
export async function saveStarter(env: Env, input: unknown) {
  const next = readStarter(input);
  return updateBlob(env, STARTER_KEY, readStarter, () => ({ value: next }));
}

/**
 * What one credit costs us, by tool, from provider prices checked 2026-11-20 (Gemini 3.8 Flash $0.75 in / $3.75 out per
 * million tokens until 2026-12-31, then double; Claude Haiku 5.5 $0.10 / $0.50; Gemini image $0.067 a 1K image;
 * fal.ai nano-banana-2 $0.08, flux schnell about $0.003). Rough sizes: a text help about 3,000 tokens in and 1,000 out,
 * a photo read about 3,500 in and 1,500 out. Shown on the admin card so the ceiling has a dollar meaning; the real
 * numbers come from the AI cost log (aiprices) once entered. A credit sells for about 10 cents.
 */
export const STARTER_COSTS = {
  checkedOn: "2026-11-20",
  perUseCents: { text: 0.6, textAfterJan: 1.2, textHaiku: 0.08, photo: 0.8, photoAfterJan: 1.6, colorPreview: 6.7, siteImage: 8, siteImageDraft: 0.3 },
  /** Worst case for one free account: every welcome credit spent on color previews (the costliest tool open to Free). */
  worstCentsPerCredit: 2.3,
  /** A normal first month (the sample below) at today's prices. */
  typicalCentsPerAccount: 60,
};

/* ---------- what credits buy ---------- */

export interface MenuRow { feature: Feature; en: string; es: string; cost: number; uses: number }
/** The tools a free account can use with credits, in the order a new painter meets them. */
const MENU: { feature: Feature; en: string; es: string }[] = [
  { feature: "estimate_draft", en: "Estimate drafts", es: "Borradores de presupuesto" },
  { feature: "quote_helper", en: "Quote helper answers", es: "Respuestas del ayudante de cotización" },
  { feature: "ai_assistant", en: "Job assistant questions", es: "Preguntas al asistente de trabajos" },
  { feature: "photo_analysis", en: "Job photo reads", es: "Lecturas de fotos del trabajo" },
  { feature: "color_repaint", en: "Color previews on a customer's photo", es: "Vistas de color en la foto del cliente" },
  { feature: "site_write", en: "Website writing help", es: "Ayuda para escribir su sitio web" },
  { feature: "logo_design", en: "Logo designs", es: "Diseños de logo" },
];
/** A busy first month for a free account, used to show what is left over. */
export const SAMPLE_MONTH: { feature: Feature; times: number }[] = [
  { feature: "estimate_draft", times: 10 },
  { feature: "quote_helper", times: 10 },
  { feature: "photo_analysis", times: 10 },
  { feature: "color_repaint", times: 5 },
  { feature: "site_write", times: 6 },
  { feature: "logo_design", times: 4 },
];

/**
 * One job from the first call to the last invoice, in the order a painter works it. The counts are the planning
 * assumption shown to new sign-ups (a draft to audit before the 2026-12-01 launch). Punch lists and warranties are
 * free tools and use no credits.
 */
export const JOB_CYCLE: { feature: Feature; times: number; en: string; es: string }[] = [
  { feature: "estimate_draft", times: 1, en: "Estimate draft", es: "Borrador de presupuesto" },
  { feature: "quote_helper", times: 1, en: "Quote helper wording", es: "Redacción con el ayudante de cotización" },
  { feature: "ai_assistant", times: 3, en: "Job assistant questions (prep, paint, coats)", es: "Preguntas al asistente de trabajos (preparación, pintura, manos)" },
  { feature: "photo_analysis", times: 2, en: "Job photo and blueprint reads", es: "Lecturas de fotos y planos del trabajo" },
  { feature: "ai_invoice", times: 2, en: "Customer emails and invoice notes", es: "Correos al cliente y notas de factura" },
];
/** Busy times of the painter's year, in credits, so a new account sees what the busiest weeks take. */
export const SEASONS: { id: string; en: string; es: string; items: { feature: Feature; times: number }[] }[] = [
  { id: "spring", en: "Spring and summer exterior rush", es: "Temporada fuerte de exteriores (primavera y verano)", items: [{ feature: "estimate_draft", times: 30 }, { feature: "photo_analysis", times: 25 }, { feature: "color_repaint", times: 10 }] },
  { id: "tax", en: "Tax time, quarterly estimates and year-end", es: "Época de impuestos, pagos trimestrales y cierre de año", items: [{ feature: "receipt_read", times: 40 }, { feature: "bank_read", times: 6 }, { feature: "vehicle_read", times: 4 }] },
  { id: "winter", en: "Slow winter weeks: website, logo and follow-ups", es: "Semanas lentas de invierno: sitio web, logo y seguimientos", items: [{ feature: "site_write", times: 10 }, { feature: "logo_design", times: 4 }, { feature: "ai_invoice", times: 10 }] },
];

export function creditCycle(credits: number, days: number) {
  const c = Math.max(0, Math.floor(credits));
  const steps = JOB_CYCLE.map((j) => ({ ...j, cost: CREDIT_COST[j.feature] * j.times }));
  const perJob = steps.reduce((n, x) => n + x.cost, 0);
  const jobs = perJob ? Math.floor(c / perJob) : 0;
  const months = Math.max(1, days / 30);
  const seasons = SEASONS.map((x) => ({ id: x.id, en: x.en, es: x.es, credits: x.items.reduce((n, i) => n + CREDIT_COST[i.feature] * i.times, 0), items: x.items }));
  return { steps, perJob, jobs, jobsPerMonth: Math.max(0, Math.floor(jobs / months)), seasons };
}

export function creditMenu(credits: number, days = 60): { rows: MenuRow[]; sample: { credits: number; left: number; items: { feature: Feature; times: number; cost: number }[] }; cycle: ReturnType<typeof creditCycle> } {
  const c = Math.max(0, Math.floor(credits));
  const rows = MENU.map((m) => ({ ...m, cost: CREDIT_COST[m.feature], uses: Math.floor(c / CREDIT_COST[m.feature]) }));
  const items = SAMPLE_MONTH.map((s) => ({ ...s, cost: CREDIT_COST[s.feature] * s.times }));
  const used = items.reduce((n, i) => n + i.cost, 0);
  return { rows, sample: { credits: used, left: Math.max(0, c - used), items }, cycle: creditCycle(c, days) };
}

/**
 * Free credits (welcome, sign-up, promotion) that run out within `days`, for the Home reminder. Paid credits are left out:
 * top-ups do not expire during early access and allowances roll over on their own.
 */
export function expiringSoon(rows: { source: string; left: number; expired: boolean; expiresOn: string }[], today: string, days = 7): { credits: number; on: string } | null {
  const until = addDaysIso(today, days);
  const soon = rows.filter((r) => ["welcome", "door", "promo", "reward"].includes(r.source) && !r.expired && r.left > 0 && r.expiresOn <= until);
  if (!soon.length) return null;
  return { credits: soon.reduce((n, r) => n + r.left, 0), on: soon.reduce((m, r) => (r.expiresOn < m ? r.expiresOn : m), soon[0].expiresOn) };
}

/* ---------- welcome credits ---------- */

async function masterId(env: Env): Promise<number | null> {
  const r = await env.DB.prepare("SELECT id FROM companies WHERE slug = 'paintersmax-master'").first<{ id: number }>();
  return r?.id ?? null;
}
const WELCOME_FEATURE = "starter:welcome";

/** Counts one welcome grant for `day`, unless the day is full. True when there was room. */
async function takeDaySlot(env: Env, master: number, day: string, cap: number): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + 1 WHERE count + 1 <= ? RETURNING count`,
  )
    .bind(master, WELCOME_FEATURE, day, cap)
    .first<{ count: number }>();
  return !!r;
}

export interface HeldEntry { companyId: number; on: string }
export function readHeld(raw: unknown): HeldEntry[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: HeldEntry[] = [];
  for (const h of list) {
    const c = Number(h?.companyId);
    if (Number.isInteger(c) && c > 0 && typeof h?.on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.on) && !out.some((x) => x.companyId === c)) out.push({ companyId: c, on: h.on });
  }
  return out.slice(0, MAX_HELD);
}

const welcomeId = (c: number) => `welcome:${c}`;
const giveWelcome = (env: Env, c: number, s: StarterSettings, today: string) =>
  grantCredits(env, c, { id: welcomeId(c), credits: s.welcomeCredits, source: "welcome", note: "Welcome credits", days: s.welcomeDays }, today);

/**
 * Welcome credits for a new company. `capped` is true for public sign-ups: they count against the daily ceiling, and
 * over it the company waits on the held list for the next morning run. Returns what happened, for the sign-up answer.
 */
export async function grantWelcome(env: Env, c: number, today: string, o: { capped: boolean }): Promise<{ status: "granted" | "held" | "off"; credits: number; expiresOn: string }> {
  const s = await loadStarter(env);
  if (!s.on || s.welcomeCredits < 1) return { status: "off", credits: 0, expiresOn: "" };
  const expiresOn = addDaysIso(today, s.welcomeDays);
  if (o.capped) {
    const master = await masterId(env);
    if (master && !(await takeDaySlot(env, master, today, s.dailyCap))) {
      await updateBlob(env, HELD_KEY, readHeld, (cur) => ({ value: cur.some((h) => h.companyId === c) || cur.length >= MAX_HELD ? cur : [...cur, { companyId: c, on: today }] }));
      return { status: "held", credits: s.welcomeCredits, expiresOn: "" };
    }
  }
  await giveWelcome(env, c, s, today);
  return { status: "granted", credits: s.welcomeCredits, expiresOn };
}

/** The morning run: adds held welcome credits, oldest first, up to today's ceiling. Returns how many were added. */
export async function releaseHeldWelcome(env: Env, today: string): Promise<number> {
  const s = await loadStarter(env);
  const held = await readBlob(env, HELD_KEY, readHeld);
  if (!held.length || !s.on) return 0;
  const master = await masterId(env);
  const done: number[] = [];
  for (const h of held) {
    if (master && !(await takeDaySlot(env, master, today, s.dailyCap))) break;
    await giveWelcome(env, h.companyId, s, today).catch((err) => console.error("held welcome failed", String(err)));
    done.push(h.companyId);
  }
  if (done.length) await updateBlob(env, HELD_KEY, readHeld, (cur) => ({ value: cur.filter((h) => !done.includes(h.companyId)) }));
  return done.length;
}

/** For the admin card: today's count, the held list size and the last 14 days. */
export async function starterStats(env: Env, today: string) {
  const master = await masterId(env);
  const days = Array.from({ length: 14 }, (_, i) => addDaysIso(today, -i));
  const counts = new Map<string, number>();
  if (master) {
    const rows = await env.DB.prepare(`SELECT period, count FROM usage_counters WHERE company_id = ? AND feature = ? AND period >= ?`).bind(master, WELCOME_FEATURE, days[days.length - 1]).all<{ period: string; count: number }>();
    for (const r of rows.results ?? []) counts.set(r.period, r.count);
  }
  const held = await readBlob(env, HELD_KEY, readHeld);
  return { today: counts.get(today) ?? 0, held: held.length, byDay: days.map((d) => ({ day: d, count: counts.get(d) ?? 0 })) };
}

/* ---------- promotions that apply by themselves ---------- */

/** The running promotion that applies to a door's sign-up without a code (the first one, by end date). */
export function autoPromoFor(list: Promo[], door: PaidDoor, today: string): Promo | null {
  return list.filter((p) => p.auto && promoPrice(door, "signup", p, today).applied).sort((a, b) => a.endsOn.localeCompare(b.endsOn))[0] ?? null;
}

/** GET /api/starter: what a visitor sees on the sign-up page (no sign-in). */
export async function handleStarterPublic(env: Env, today: string): Promise<Response> {
  const [s, promos] = await Promise.all([loadStarter(env), loadPromos(env)]);
  const credits = s.on ? s.welcomeCredits : 0;
  const doors = (["launch", "grow", "signature"] as PaidDoor[]).map((d) => {
    const promo = autoPromoFor(promos, d, today);
    const price = promoPrice(d, "signup", promo, today);
    return { door: d, cents: price.cents, listCents: price.listCents, credits: promo && promo.bonusCredits > 0 ? promo.bonusCredits : DOOR_CREDITS, promo: promo ? { name: promo.name, endsOn: promo.endsOn, founding: promo.founding } : null };
  });
  return new Response(JSON.stringify({ welcome: { credits, days: s.welcomeDays }, menu: creditMenu(credits, s.welcomeDays), doorMenu: creditMenu(DOOR_CREDITS, 90), doors }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
}

/* ---------- paying for a door ---------- */

/**
 * What a door costs at checkout. From Free it is a sign-up: the list price, or the floor when a promotion applies
 * (Booked by Spring and others; promoPrice never goes under the floor). Between paid doors it stays the difference
 * of the floors, as before.
 */
export function doorCharge(from: Door, to: PaidDoor, promo: Promo | null, today: string): { cents: number; listCents: number; promoApplied: boolean } {
  if (from === "free") {
    const p = promoPrice(to, "signup", promo, today);
    return { cents: p.cents, listCents: p.listCents, promoApplied: p.applied };
  }
  const cents = upgradeCents(from, to);
  return { cents, listCents: cents, promoApplied: false };
}

/**
 * The promotion for a checkout: the code the painter typed (when it applies), else the running promotion that applies
 * by itself. The code is only checked here; it is counted (redeemed) when Stripe reports the payment.
 */
export async function pickPromo(env: Env, door: PaidDoor, rawCode: unknown, today: string): Promise<{ promo: Promo | null; error?: string }> {
  const list = await loadPromos(env);
  const code = normCode(rawCode);
  if (code) {
    const p = list.find((x) => x.code === code) ?? null;
    if (!p) return { promo: autoPromoFor(list, door, today), error: "That code was not found." };
    const price = promoPrice(door, "signup", p, today);
    if (!price.applied) return { promo: autoPromoFor(list, door, today), error: price.why ?? "That code does not apply." };
    return { promo: p };
  }
  return { promo: autoPromoFor(list, door, today) };
}

/**
 * After a paid door: counts the promotion use, adds the door's credits (the promotion's credits instead, never both),
 * starts the paid year when none is recorded, and gives the Founding badge when the promotion carries it.
 * Safe to run twice for the same payment (grant ids and the existing year record keep it from adding twice).
 */
export async function afterDoorPaid(env: Env, c: number, i: { door: PaidDoor; paymentId: string; promoCode: string; paidCents: number }, today: string): Promise<{ credits: number; promo: string; founding: boolean }> {
  let promo: Promo | null = null;
  if (i.promoCode) {
    // Count the use once per payment: a repeated webhook must not use up a limited code twice.
    const claimKey = `promopaid:${String(i.paymentId).slice(0, 120)}`;
    const claimed = await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, '\"\"', datetime('now')) ON CONFLICT(key) DO NOTHING RETURNING key").bind(claimKey).first();
    if (!claimed) {
      const seen = await readBlob(env, claimKey, (raw) => (typeof raw === "string" ? raw : ""));
      promo = seen ? ((await loadPromos(env)).find((p) => p.code === seen) ?? null) : null;
    } else {
      const r = await redeemPromo(env, i.promoCode, i.door, "signup", today);
      if (r.ok) {
        promo = r.promo;
        await writeBlob(env, claimKey, r.promo.code);
      } else console.error("promo not redeemed", i.promoCode, r.error);
    }
  }
  const credits = promo && promo.bonusCredits > 0 ? promo.bonusCredits : DOOR_CREDITS;
  await grantDoorCredits(env, c, { door: i.door, paymentId: i.paymentId, promo: promo && promo.bonusCredits > 0 ? { code: promo.code, credits: promo.bonusCredits } : null }, today);
  const founding = !!promo?.founding;
  // The paid year starts at sign-up (approved 2026-11-14). An admin-entered record is never replaced.
  await updateBlob(env, subKey(c), readSub, (cur) => {
    if (cur) return { value: founding && !cur.founding ? { ...cur, founding: true } : cur };
    const rec: SubRecord = { startedOn: today, renewsOn: addDaysIso(today, 365), status: "active", cancelledOn: "", paidCents: Math.max(0, Math.round(i.paidCents)), renewalCents: 0, promoCode: promo?.code ?? "", founding, outreach: "none", outreachNote: "", outreachOn: "" };
    return { value: rec };
  });
  if (founding) {
    const key = `dirm:${c}`;
    const cur = await readBlob(env, key, (raw) => (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}));
    await writeBlob(env, key, { ...cur, founding: true });
  }
  return { credits, promo: promo?.code ?? "", founding };
}

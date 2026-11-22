import { addDaysIso } from "./dates.ts";
import type { Env } from "./types.ts";
import type { Feature } from "./usage.ts";

/**
 * AI credits: extra AI uses a painter can add when a monthly allowance runs out.
 *
 *  - A credit is used only AFTER a feature's monthly amount for the plan is used up, or when the plan has no amount for that feature.
 *    Credits work on every plan, the free one included (decided 2026-11-14): a painter who adds credits decides how to spend them.
 *  - Heavier uses cost more than one credit (a photo render costs more than a chat question).
 *  - Credits come in grants. How long a grant lasts depends on where it came from (see EXPIRY_DAYS):
 *      allowance  the monthly credits of a $19 / $39 / $79 allowance; unused ones roll over for two months
 *      topup      credits bought one at a time ($5 to $100); they last 12 months from the day they are bought
 *      welcome    the credits every new company starts with (250, 60 days)
 *      door       the first payment of a paid door (500, 90 days), unless the purchase carried a promotion
 *      promo      a promotion's credits (Booked by Spring and others, 90 days); they REPLACE door credits, never add to them
 *      reward     credits earned (finishing setup, referrals, first-lead promise), 180 days
 *      admin      added by hand in /admin
 *  - The credits that run out soonest are used first (rules approved by Rogelio 2026-11-15). Credits that run out of time
 *    are written off, never used.
 *  - Free credits (welcome, door, promo, reward) are capped at 1,500 in an account's first 90 days, so a mistake in a
 *    promotion can never hand out thousands. Paid credits (allowance, top-up) and admin grants are never capped.
 *
 * Storage needs no database change: the grant list is a small blob in app_settings, and one counter in usage_counters
 * ("credit:spent") holds how many credits have been used in total. Spending is a compare-and-swap on that counter, so two
 * calls at the same moment can never spend the same credit.
 */

export const CREDIT_EXPIRY_DAYS = 90;

export type GrantSource = "pack" | "admin" | "allowance" | "topup" | "welcome" | "door" | "promo" | "reward";
const SOURCES: GrantSource[] = ["pack", "admin", "allowance", "topup", "welcome", "door", "promo", "reward"];
/** How many days a grant can be used, by where it came from. Top-ups last 12 months (Rogelio, 2026-11-22), which limits unused balances. */
/** Every new company, free or paid, starts with these credits once (Rogelio, 2026-11-15: 250 for 60 days). */
export const WELCOME_CREDITS = 250;
export const WELCOME_EXPIRY_DAYS = 60;
/** The first payment of a paid door adds these, unless the purchase carried a promotion with credits. */
export const DOOR_CREDITS = 500;
/** Free credits an account can receive in its first 90 days, all kinds together. */
export const FREE_CREDIT_CAP = 1500;
export const FREE_CAP_DAYS = 90;
const FREE_SOURCES: GrantSource[] = ["welcome", "door", "promo", "reward"];
export const EXPIRY_DAYS: Record<GrantSource, number> = { pack: 90, admin: 90, allowance: 90, topup: 365, welcome: WELCOME_EXPIRY_DAYS, door: 90, promo: 90, reward: 180 };

/** A monthly allowance: a Stripe subscription that adds credits every month. Prices approved 2026-11-14. */
export interface Allowance { id: string; priceCents: number; credits: number }
export const ALLOWANCES: Allowance[] = [
  { id: "a19", priceCents: 1900, credits: 150 },
  { id: "a39", priceCents: 3900, credits: 400 },
  { id: "a79", priceCents: 7900, credits: 1000 },
];
export const allowanceById = (id: unknown) => ALLOWANCES.find((a) => a.id === id) ?? null;
/** The allowance that a paid amount belongs to (used when Stripe reports a renewal). */
export const allowanceByPrice = (cents: unknown) => ALLOWANCES.find((a) => a.priceCents === Number(cents)) ?? null;

/** A top-up: one payment, credits added once. Bigger top-ups get a slightly better rate (approved 2026-11-14). */
export interface TopUp { id: string; priceCents: number; credits: number }
export const TOPUPS: TopUp[] = [
  { id: "t5", priceCents: 500, credits: 50 },
  { id: "t10", priceCents: 1000, credits: 100 },
  { id: "t20", priceCents: 2000, credits: 220 },
  { id: "t50", priceCents: 5000, credits: 600 },
  { id: "t100", priceCents: 10000, credits: 1300 },
];
export const topUpById = (id: unknown) => TOPUPS.find((t) => t.id === id) ?? null;

/**
 * Credits per use. ASSUMPTION until the real cost per use is known from the usage log: one for everyday questions and reads,
 * more for photo work and renders. Every feature must have a number here (the compiler checks).
 */
export const CREDIT_COST: Record<Feature, number> = {
  ai_quote: 1, ai_estimate: 1, ai_invoice: 1, photo_tag: 1, smart_select: 1, hd_render: 5, ai_assistant: 1, insurance_scan: 2,
  ai_detailed: 2, photo_analysis: 2, ai_deep: 3, receipt_read: 1, bank_read: 2, quote_helper: 1, estimate_draft: 1, help_chat: 1, vehicle_read: 1,
  color_repaint: 3, site_write: 1, site_image: 3, site_image_draft: 1, logo_design: 1,
};

export interface Grant {
  id: string;
  credits: number;
  on: string; // YYYY-MM-DD added
  expiresOn: string; // YYYY-MM-DD, the last day the credits can be used
  source: GrantSource;
  note: string;
}

const MAX_GRANTS = 200;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Clean the stored list so a bad blob never breaks a feature. Sorted by the day the credits run out, soonest first,
 * which is the order they are used in. Grants that have already run out always sort before live ones, so credits written
 * off earlier stay written off.
 */
export function readGrants(raw: unknown): Grant[] {
  const list = Array.isArray((raw as any)?.grants) ? (raw as any).grants : [];
  const out: Grant[] = [];
  for (const g of list) {
    const credits = Math.round(Number(g?.credits));
    if (typeof g?.id !== "string" || !g.id || g.id.length > 80 || !Number.isFinite(credits) || credits < 1 || credits > 100000 || !isDate(g.on) || !isDate(g.expiresOn)) continue;
    out.push({ id: g.id, credits, on: g.on, expiresOn: g.expiresOn, source: SOURCES.includes(g.source) ? g.source : "pack", note: typeof g.note === "string" ? g.note.slice(0, 100) : "" });
  }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return out.map((g, i) => ({ g, i })).sort((a, b) => cmp(a.g.expiresOn, b.g.expiresOn) || cmp(a.g.on, b.g.on) || a.i - b.i).map((x) => x.g);
}

/**
 * Where the credits stand. `spent` is the total used so far, taken from the grant that runs out soonest first.
 * `writeOff` is what is left on grants that have run out of time: it has to be added to `spent` before anything new is used,
 * so a new use is never counted against credits that can no longer be used.
 */
export function ledger(grants: Grant[], spent: number, today: string) {
  let s = Math.max(0, Math.round(spent));
  let balance = 0;
  let writeOff = 0;
  const rows = grants.map((g) => {
    const used = Math.min(g.credits, s);
    s -= used;
    const left = g.credits - used;
    const expired = g.expiresOn < today;
    if (expired) writeOff += left;
    else balance += left;
    return { ...g, left, expired };
  });
  const next = rows.find((r) => !r.expired && r.left > 0) ?? null;
  return { balance, writeOff, rows, nextExpiry: next ? { on: next.expiresOn, credits: next.left } : null };
}

export const creditsKey = (c: number) => `aicred:${c}`;

async function loadGrants(env: Env, c: number): Promise<Grant[]> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(creditsKey(c)).first<{ value: string }>();
  try {
    return readGrants(r ? JSON.parse(r.value) : null);
  } catch {
    return [];
  }
}
async function readSpent(env: Env, c: number): Promise<number> {
  const r = await env.DB.prepare("SELECT count FROM usage_counters WHERE company_id = ? AND feature = 'credit:spent' AND period = 'pack'").bind(c).first<{ count: number }>();
  return r?.count ?? 0;
}
/** Moves the spent total from `from` to `to`, but only if nobody else changed it in between. */
async function casSpent(env: Env, c: number, from: number, to: number): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, 'credit:spent', 'pack', ?)
     ON CONFLICT(company_id, feature, period) DO UPDATE SET count = ? WHERE count = ? RETURNING count`,
  )
    .bind(c, to, to, from)
    .first();
  return !!r;
}

/** Credits that can be used today, and when the next ones run out. Read only. */
export async function creditView(env: Env, c: number, today: string) {
  const grants = await loadGrants(env, c);
  if (!grants.length) return { balance: 0, nextExpiry: null as { on: string; credits: number } | null, grants: [] as ReturnType<typeof ledger>["rows"] };
  const l = ledger(grants, await readSpent(env, c), today);
  return { balance: l.balance, nextExpiry: l.nextExpiry, grants: l.rows };
}

/** Uses `cost` credits if there are enough. Never goes below zero, even if two requests arrive together. */
export async function spendCredits(env: Env, c: number, cost: number, today: string): Promise<{ ok: boolean; balance: number }> {
  const grants = await loadGrants(env, c);
  if (!grants.length) return { ok: false, balance: 0 };
  for (let i = 0; i < 10; i++) {
    const s = await readSpent(env, c);
    const l = ledger(grants, s, today);
    if (l.writeOff > 0) {
      await casSpent(env, c, s, s + l.writeOff);
      continue;
    }
    if (l.balance < cost) return { ok: false, balance: l.balance };
    if (await casSpent(env, c, s, s + cost)) return { ok: true, balance: l.balance - cost };
  }
  return { ok: false, balance: 0 };
}

/** Gives credits back after an AI call failed. */
export async function refundCredits(env: Env, c: number, cost: number) {
  await env.DB.prepare("UPDATE usage_counters SET count = MAX(count - ?, 0) WHERE company_id = ? AND feature = 'credit:spent' AND period = 'pack'").bind(cost, c).run();
}

/**
 * How many more free credits an account may receive today. The first 90 days start on the day of its first grant
 * (the welcome credits at sign-up). After those 90 days the cap no longer applies.
 */
export function freeRoom(grants: Grant[], today: string): number {
  if (!grants.length) return FREE_CREDIT_CAP;
  const first = grants.reduce((m, g) => (g.on < m ? g.on : m), grants[0].on);
  if (today > addDaysIso(first, FREE_CAP_DAYS)) return Number.MAX_SAFE_INTEGER;
  const given = grants.filter((g) => FREE_SOURCES.includes(g.source)).reduce((n, g) => n + g.credits, 0);
  return Math.max(0, FREE_CREDIT_CAP - given);
}

/**
 * The credits for a paid door's first payment. A purchase that carried a promotion with credits gets the promotion's
 * credits INSTEAD of the 500 door credits, never both (one promotion per purchase). `paymentId` keeps a payment that is
 * reported twice from adding credits twice; the door grant id is per company and door, so a door adds credits only once.
 */
export async function grantDoorCredits(env: Env, c: number, i: { door: string; paymentId: string; promo?: { code: string; credits: number } | null }, today: string) {
  const door = String(i.door).slice(0, 20);
  const promoCredits = Math.round(Number(i.promo?.credits ?? 0));
  if (i.promo && promoCredits > 0) {
    return grantCredits(env, c, { id: `promo:${door}:${c}`, credits: promoCredits, source: "promo", note: `Promotion ${String(i.promo.code).slice(0, 40)}` }, today);
  }
  return grantCredits(env, c, { id: `door:${door}:${c}`, credits: DOOR_CREDITS, source: "door", note: `Door credits (${door})` }, today);
}

/** Adds a grant. The same grant id is never added twice (a payment can be reported more than once). */
export async function grantCredits(env: Env, c: number, i: { id: string; credits: number; source: GrantSource; note?: string; days?: number }, today: string): Promise<{ ok: boolean; added: boolean; error?: string }> {
  const credits = Math.round(Number(i.credits));
  if (!Number.isFinite(credits) || credits < 1 || credits > 100000) return { ok: false, added: false, error: "Enter a number of credits between 1 and 100,000." };
  const grants = await loadGrants(env, c);
  if (grants.some((g) => g.id === i.id)) return { ok: true, added: false };
  if (grants.length >= MAX_GRANTS) return { ok: false, added: false, error: "Too many credit records on this account." };
  let amount = credits;
  if (FREE_SOURCES.includes(i.source)) {
    amount = Math.min(credits, freeRoom(grants, today));
    if (amount < 1) return { ok: true, added: false, error: "This account already received the most free credits allowed in its first 90 days." };
  }
  grants.push({ id: i.id.slice(0, 80), credits: amount, on: today, expiresOn: addDaysIso(today, i.days && i.days > 0 ? Math.min(3650, Math.round(i.days)) : EXPIRY_DAYS[i.source] ?? CREDIT_EXPIRY_DAYS), source: i.source, note: (i.note ?? "").slice(0, 100) });
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(creditsKey(c), JSON.stringify({ grants })).run();
  return { ok: true, added: true };
}

/** Where a company's monthly allowance stands. Kept in app_settings (no migration): allow:<companyId>. */
export interface AllowanceRecord {
  allowanceId: string;
  subscriptionId: string;
  status: "active" | "past_due" | "ended";
  since: string; // YYYY-MM-DD
  lastGrantOn: string | null;
}
export const allowanceKey = (c: number) => `allow:${c}`;
/** Maps a Stripe subscription to the company, so a renewal can find its owner: allowsub:<subscriptionId>. */
export const allowanceSubKey = (subscriptionId: string) => `allowsub:${subscriptionId}`;

export function readAllowanceRecord(raw: unknown): AllowanceRecord | null {
  const r = raw as any;
  if (!r || typeof r.allowanceId !== "string" || typeof r.subscriptionId !== "string" || !allowanceById(r.allowanceId)) return null;
  const status = r.status === "past_due" || r.status === "ended" ? r.status : "active";
  return { allowanceId: r.allowanceId, subscriptionId: r.subscriptionId.slice(0, 80), status, since: isDate(r.since) ? r.since : "", lastGrantOn: isDate(r.lastGrantOn) ? r.lastGrantOn : null };
}
export async function loadAllowance(env: Env, c: number): Promise<AllowanceRecord | null> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(allowanceKey(c)).first<{ value: string }>();
  try {
    return readAllowanceRecord(r ? JSON.parse(r.value) : null);
  } catch {
    return null;
  }
}
export async function saveAllowance(env: Env, c: number, rec: AllowanceRecord): Promise<void> {
  const up = "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')";
  await env.DB.batch([env.DB.prepare(up).bind(allowanceKey(c), JSON.stringify(rec)), env.DB.prepare(up).bind(allowanceSubKey(rec.subscriptionId), String(c))]);
}
/** The company that owns a Stripe allowance subscription, or null. */
export async function companyOfAllowanceSub(env: Env, subscriptionId: string): Promise<number | null> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(allowanceSubKey(subscriptionId)).first<{ value: string }>();
  const n = r ? Number(r.value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

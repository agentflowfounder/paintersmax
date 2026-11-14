import { addDaysIso } from "./dates.ts";
import type { Env } from "./types.ts";
import type { Feature } from "./usage.ts";

/**
 * AI credits: extra AI uses a painter can add when a monthly allowance runs out.
 *
 *  - A credit is used only AFTER a feature's monthly allowance for the plan is used up, and only for features the plan already has.
 *  - Heavier uses cost more than one credit (a photo render costs more than a chat question).
 *  - Credits come in grants (a pack bought through Stripe, or added by us) and last CREDIT_EXPIRY_DAYS from the day they were added.
 *  - Oldest credits are used first. Credits that run out of time are written off, never used.
 *  - Free companies cannot use credits (they are kept, paused, if a plan ends).
 *
 * Storage needs no database change: the grant list is a small blob in app_settings, and one counter in usage_counters
 * ("credit:spent") holds how many credits have been used in total. Spending is a compare-and-swap on that counter, so two
 * calls at the same moment can never spend the same credit.
 */

export const CREDIT_EXPIRY_DAYS = 90;

/**
 * Credits per use. ASSUMPTION until the real cost per use is known from the usage log: one for everyday questions and reads,
 * more for photo work and renders. Every feature must have a number here (the compiler checks).
 */
export const CREDIT_COST: Record<Feature, number> = {
  ai_quote: 1, ai_estimate: 1, ai_invoice: 1, photo_tag: 1, smart_select: 1, hd_render: 5, ai_assistant: 1, insurance_scan: 2,
  ai_detailed: 2, photo_analysis: 2, ai_deep: 3, receipt_read: 1, bank_read: 2, quote_helper: 1, estimate_draft: 1, help_chat: 1, vehicle_read: 1,
  color_repaint: 3,
};

/** Packs a painter can buy. The price stays null (not for sale) until the owner decides it; set a number of cents to open sales. */
export interface CreditPack {
  id: string;
  credits: number;
  priceCents: number | null;
}
export const CREDIT_PACKS: CreditPack[] = [{ id: "25", credits: 25, priceCents: null }];

export interface Grant {
  id: string;
  credits: number;
  on: string; // YYYY-MM-DD added
  expiresOn: string; // YYYY-MM-DD, the last day the credits can be used
  source: "pack" | "admin";
  note: string;
}

const MAX_GRANTS = 200;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Clean the stored list so a bad blob never breaks a feature. Oldest first. */
export function readGrants(raw: unknown): Grant[] {
  const list = Array.isArray((raw as any)?.grants) ? (raw as any).grants : [];
  const out: Grant[] = [];
  for (const g of list) {
    const credits = Math.round(Number(g?.credits));
    if (typeof g?.id !== "string" || !g.id || g.id.length > 80 || !Number.isFinite(credits) || credits < 1 || credits > 100000 || !isDate(g.on) || !isDate(g.expiresOn)) continue;
    out.push({ id: g.id, credits, on: g.on, expiresOn: g.expiresOn, source: g.source === "admin" ? "admin" : "pack", note: typeof g.note === "string" ? g.note.slice(0, 100) : "" });
  }
  return out.map((g, i) => ({ g, i })).sort((a, b) => (a.g.on < b.g.on ? -1 : a.g.on > b.g.on ? 1 : a.i - b.i)).map((x) => x.g);
}

/**
 * Where the credits stand. `spent` is the total used so far, taken from the oldest grant first.
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

/** Adds a grant. The same grant id is never added twice (a payment can be reported more than once). */
export async function grantCredits(env: Env, c: number, i: { id: string; credits: number; source: "pack" | "admin"; note?: string }, today: string): Promise<{ ok: boolean; added: boolean; error?: string }> {
  const credits = Math.round(Number(i.credits));
  if (!Number.isFinite(credits) || credits < 1 || credits > 100000) return { ok: false, added: false, error: "Enter a number of credits between 1 and 100,000." };
  const grants = await loadGrants(env, c);
  if (grants.some((g) => g.id === i.id)) return { ok: true, added: false };
  if (grants.length >= MAX_GRANTS) return { ok: false, added: false, error: "Too many credit records on this account." };
  grants.push({ id: i.id.slice(0, 80), credits, on: today, expiresOn: addDaysIso(today, CREDIT_EXPIRY_DAYS), source: i.source, note: (i.note ?? "").slice(0, 100) });
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(creditsKey(c), JSON.stringify({ grants })).run();
  return { ok: true, added: true };
}

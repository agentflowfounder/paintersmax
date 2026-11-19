import { isDate, readBlob, str, updateBlob } from "./kv.ts";
import { DOOR_PRICES, isPaidDoor, PAID_DOORS, type PaidDoor } from "./subscriptions.ts";
import type { Env } from "./types.ts";

/**
 * Promo codes. Rules from the business model doc (section 2), approved 2026-11-14:
 *  - Every promotion has a name, a reason and an end date. A permanent discount is a price, not a promotion.
 *  - Only one promotion applies at a time, and the result never goes below the floor. promoPrice() enforces this, so a code
 *    set up by mistake (or a 100% discount) still cannot take a sale under $299.
 *  - Uses are counted atomically, so a code with 50 uses cannot be used 51 times even if two people pay at the same moment.
 *
 * Stored as one list in app_settings ("promos"); use counts in usage_counters (company 0, feature promo:<CODE>).
 */

export type PromoKind = "floor" | "percent" | "amount";
export type PromoFor = "signup" | "renewal" | "both";
export const CHANNELS = ["season", "founding", "referral", "store", "event", "ad", "winback", "upgrade", "trade_group", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Promo {
  code: string;
  name: string;
  reason: string;
  doors: PaidDoor[];
  appliesTo: PromoFor;
  kind: PromoKind;
  value: number; // percent (1-100) or dollars off, ignored for "floor"
  bonusCredits: number;
  founding: boolean; // gives the Founding badge
  startsOn: string;
  endsOn: string;
  maxUses: number; // 0 = no limit
  channel: Channel;
  active: boolean;
  createdBy: string;
  createdOn: string;
}

export const PROMOS_KEY = "promos";
const MAX_PROMOS = 300;

export const normCode = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase().replace(/\s+/g, "") : "");
export const isCode = (c: string) => /^[A-Z0-9][A-Z0-9-]{2,23}$/.test(c);

export function readPromo(p: any): Promo | null {
  const code = normCode(p?.code);
  if (!isCode(code) || !isDate(p?.startsOn) || !isDate(p?.endsOn)) return null;
  const doors = Array.isArray(p?.doors) ? (p.doors as unknown[]).filter(isPaidDoor) : [];
  const n = (v: unknown, max: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) && x >= 0 ? Math.min(x, max) : 0;
  };
  return {
    code,
    name: str(p.name, 80),
    reason: str(p.reason, 200),
    doors: doors.length ? [...new Set(doors)] : [...PAID_DOORS],
    appliesTo: p.appliesTo === "renewal" || p.appliesTo === "both" ? p.appliesTo : "signup",
    kind: p.kind === "percent" || p.kind === "amount" ? p.kind : "floor",
    value: n(p.value, p.kind === "percent" ? 100 : 10000),
    bonusCredits: n(p.bonusCredits, 5000),
    founding: p.founding === true,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    maxUses: n(p.maxUses, 100000),
    channel: (CHANNELS as readonly string[]).includes(p.channel) ? p.channel : "other",
    active: p.active !== false,
    createdBy: str(p.createdBy, 200),
    createdOn: isDate(p.createdOn) ? p.createdOn : "",
  };
}
export function readPromos(raw: unknown): Promo[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Promo[] = [];
  for (const p of list) {
    const r = readPromo(p);
    if (r && !out.some((x) => x.code === r.code)) out.push(r);
  }
  return out.slice(0, MAX_PROMOS);
}
export const loadPromos = (env: Env) => readBlob(env, PROMOS_KEY, readPromos);

/** Checks a new or edited promotion. `maxBonus` is the role's limit on bonus credits. */
export function validatePromo(input: any, o: { maxBonus: number; today: string; by: string }): { promo: Promo } | { error: string } {
  const code = normCode(input?.code);
  if (!isCode(code)) return { error: "Code must be 3 to 24 letters, numbers or dashes." };
  if (!str(input?.name, 80)) return { error: "Give the promotion a name." };
  if (!str(input?.reason, 200)) return { error: "Say why the promotion exists (season, event, ad, referral)." };
  if (!isDate(input?.startsOn) || !isDate(input?.endsOn)) return { error: "Start and end dates are required (YYYY-MM-DD). Every promotion ends." };
  if (input.endsOn < input.startsOn) return { error: "The end date is before the start date." };
  if (input.kind === "percent" && !(Number(input.value) >= 1 && Number(input.value) <= 100)) return { error: "A percent off must be between 1 and 100." };
  if (input.kind === "amount" && !(Number(input.value) >= 1)) return { error: "Enter the dollars off." };
  const bonus = Math.round(Number(input?.bonusCredits) || 0);
  if (bonus < 0 || bonus > o.maxBonus) return { error: o.maxBonus ? `Bonus credits can be 0 to ${o.maxBonus} for your role.` : "Your role cannot add bonus credits." };
  const promo = readPromo({ ...input, code, bonusCredits: bonus, createdBy: o.by, createdOn: o.today });
  return promo ? { promo } : { error: "Check the promotion fields." };
}

/**
 * The price a door costs with a promotion. Never below the floor, never above the list price.
 * Without a promotion (or with one that does not apply) the list price is charged.
 */
export function promoPrice(door: PaidDoor, kind: "signup" | "renewal", promo: Promo | null, today: string): { cents: number; listCents: number; floorCents: number; applied: boolean; why?: string } {
  const p = DOOR_PRICES[door];
  const listCents = kind === "signup" ? p.signupList : p.renewalList;
  const floorCents = kind === "signup" ? p.signupFloor : p.renewalFloor;
  const why = !promo ? "none" : !promo.active ? "This code is turned off." : today < promo.startsOn ? "This code has not started yet." : today > promo.endsOn ? "This code has ended." : !promo.doors.includes(door) ? "This code is not for that door." : promo.appliesTo !== "both" && promo.appliesTo !== kind ? (kind === "signup" ? "This code is for renewals." : "This code is for sign-ups.") : "";
  if (why) return { cents: listCents, listCents, floorCents, applied: false, ...(promo ? { why } : {}) };
  const raw = promo!.kind === "floor" ? floorCents : promo!.kind === "percent" ? Math.round(listCents * (1 - promo!.value / 100)) : listCents - promo!.value * 100;
  return { cents: Math.min(listCents, Math.max(floorCents, raw)), listCents, floorCents, applied: true };
}

const useFeature = (code: string) => `promo:${code}`;

export async function promoUses(env: Env): Promise<Map<string, number>> {
  const rows = await env.DB.prepare("SELECT feature, count FROM usage_counters WHERE company_id = 0 AND period = 'all' AND feature LIKE 'promo:%'").all<{ feature: string; count: number }>();
  return new Map((rows.results ?? []).map((r) => [r.feature.slice(6), r.count]));
}

/**
 * Uses a code once, for the checkout to call after payment. Returns the promotion when the use was counted,
 * or why not. Counting is a single statement, so the limit holds under load.
 */
export async function redeemPromo(env: Env, rawCode: unknown, door: PaidDoor, kind: "signup" | "renewal", today: string): Promise<{ ok: true; promo: Promo; cents: number } | { ok: false; error: string }> {
  const code = normCode(rawCode);
  const promo = (await loadPromos(env)).find((p) => p.code === code) ?? null;
  if (!promo) return { ok: false, error: "That code was not found." };
  const price = promoPrice(door, kind, promo, today);
  if (!price.applied) return { ok: false, error: price.why ?? "That code does not apply." };
  const limit = promo.maxUses || 1_000_000_000;
  const r = await env.DB.prepare(
    `INSERT INTO usage_counters (company_id, feature, period, count) VALUES (0, ?, 'all', 1)
     ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + 1 WHERE count + 1 <= ? RETURNING count`,
  )
    .bind(useFeature(code), limit)
    .first<{ count: number }>();
  if (!r) return { ok: false, error: "This code has been used the most times allowed." };
  return { ok: true, promo, cents: price.cents };
}

export async function savePromo(env: Env, promo: Promo, isNew: boolean) {
  return updateBlob(env, PROMOS_KEY, readPromos, (list) => {
    const i = list.findIndex((p) => p.code === promo.code);
    if (isNew && i >= 0) return { error: "That code already exists." };
    if (!isNew && i < 0) return { error: "Promotion not found." };
    if (isNew && list.length >= MAX_PROMOS) return { error: "Too many promotions. Turn off or delete old ones first." };
    const next = [...list];
    if (i >= 0) next[i] = { ...promo, createdBy: list[i].createdBy, createdOn: list[i].createdOn };
    else next.push(promo);
    return { value: next };
  });
}

export async function setPromoActive(env: Env, code: string, active: boolean) {
  return updateBlob(env, PROMOS_KEY, readPromos, (list) => {
    const i = list.findIndex((p) => p.code === code);
    if (i < 0) return { error: "Promotion not found." };
    const next = [...list];
    next[i] = { ...next[i], active };
    return { value: next };
  });
}

import { addDaysIso } from "./dates.ts";
import { blobsWithPrefix, isDate, readBlob, str, updateBlob } from "./kv.ts";
import type { Env } from "./types.ts";

/**
 * The four doors and each client's yearly website subscription, as admin sees it.
 *
 * Prices approved 2026-11-14 (see project memory paintersmax-pricing-history). The floor is what we agreed; the list price
 * is what someone with no promotion pays. Promotions land on the floor and never under it (promos.ts).
 *
 * The door itself lives in sitedoor:<companyId> (shared with the website builder): {door, override?}. When it is not set,
 * the door follows companies.plan (starter = launch, basic = grow, pro = signature, anything else = free).
 * The rest of the subscription (renewal date, status, what was paid, outreach) lives in sub:<companyId>.
 *
 * Missed renewal (Rogelio's rule): no cutoff. The site, free tools and directory listing stay. Admin gets a flag the day after
 * the renewal date so someone reaches out with help, not a bill.
 */

export type Door = "free" | "launch" | "grow" | "signature";
export const DOORS: Door[] = ["free", "launch", "grow", "signature"];
export type PaidDoor = Exclude<Door, "free">;
export const PAID_DOORS: PaidDoor[] = ["launch", "grow", "signature"];
export const isDoor = (v: unknown): v is Door => typeof v === "string" && (DOORS as string[]).includes(v);
export const isPaidDoor = (v: unknown): v is PaidDoor => typeof v === "string" && (PAID_DOORS as string[]).includes(v);

export interface DoorPrices {
  signupFloor: number;
  signupList: number;
  renewalFloor: number;
  renewalList: number;
}
/** Cents. */
export const DOOR_PRICES: Record<PaidDoor, DoorPrices> = {
  launch: { signupFloor: 29900, signupList: 39900, renewalFloor: 19900, renewalList: 24900 },
  grow: { signupFloor: 39900, signupList: 54900, renewalFloor: 24900, renewalList: 32900 },
  signature: { signupFloor: 49900, signupList: 69900, renewalFloor: 29900, renewalList: 39900 },
};
export const DOOR_LABELS: Record<Door, string> = { free: "Free", launch: "Local Pro", grow: "Contractor", signature: "Commercial" };

/** Refunds: full within 14 days, less $20 for the domain (approved 2026-11-14). */
export const REFUND_DAYS = 14;
export const REFUND_DOMAIN_CENTS = 2000;
/** The Founding painters offer is capped at 100. */
export const FOUNDING_CAP = 100;

export const doorKey = (c: number) => `sitedoor:${c}`;
export const subKey = (c: number) => `sub:${c}`;

export function doorFromPlan(plan: unknown): Door {
  return plan === "starter" ? "launch" : plan === "basic" ? "grow" : plan === "pro" ? "signature" : "free";
}
export function readDoor(raw: unknown, plan: unknown): Door {
  const d = (raw as any)?.door;
  return isDoor(d) ? d : doorFromPlan(plan);
}

export type SubStatus = "active" | "cancelled" | "refunded";
export type Outreach = "none" | "todo" | "contacted" | "won_back" | "declined";
export const OUTREACH: Outreach[] = ["none", "todo", "contacted", "won_back", "declined"];

export interface SubRecord {
  startedOn: string; // YYYY-MM-DD the paid year started (sign-up)
  renewsOn: string; // YYYY-MM-DD the next yearly renewal is due
  status: SubStatus;
  cancelledOn: string; // YYYY-MM-DD, or ""
  paidCents: number; // what the client paid for the current year
  renewalCents: number; // what the next renewal will charge (0 = the door's renewal floor)
  promoCode: string;
  founding: boolean;
  outreach: Outreach;
  outreachNote: string;
  outreachOn: string;
}

export function readSub(raw: unknown): SubRecord | null {
  const r = raw as any;
  if (!r || !isDate(r.startedOn) || !isDate(r.renewsOn)) return null;
  const cents = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : 0;
  };
  return {
    startedOn: r.startedOn,
    renewsOn: r.renewsOn,
    status: r.status === "cancelled" || r.status === "refunded" ? r.status : "active",
    cancelledOn: isDate(r.cancelledOn) ? r.cancelledOn : "",
    paidCents: cents(r.paidCents),
    renewalCents: cents(r.renewalCents),
    promoCode: str(r.promoCode, 24).toUpperCase(),
    founding: r.founding === true,
    outreach: OUTREACH.includes(r.outreach) ? r.outreach : "none",
    outreachNote: str(r.outreachNote, 300),
    outreachOn: isDate(r.outreachOn) ? r.outreachOn : "",
  };
}

export type SubState = "free" | "paid" | "due_60" | "due_30" | "missed" | "cancelled" | "refunded";

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** Where a client stands today. */
export function subState(door: Door, sub: SubRecord | null, today: string): { state: SubState; daysToRenewal: number | null; refundUntil: string | null; refundCents: number } {
  if (!sub || door === "free") return { state: sub?.status === "cancelled" ? "cancelled" : sub?.status === "refunded" ? "refunded" : "free", daysToRenewal: null, refundUntil: null, refundCents: 0 };
  if (sub.status !== "active") return { state: sub.status, daysToRenewal: null, refundUntil: null, refundCents: 0 };
  const left = days(today, sub.renewsOn);
  const refundUntil = addDaysIso(sub.startedOn, REFUND_DAYS);
  const inWindow = today <= refundUntil;
  const refundCents = inWindow ? Math.max(0, sub.paidCents - REFUND_DOMAIN_CENTS) : 0;
  const state: SubState = left < 0 ? "missed" : left <= 30 ? "due_30" : left <= 60 ? "due_60" : "paid";
  return { state, daysToRenewal: left, refundUntil: inWindow ? refundUntil : null, refundCents };
}

/** The renewal price for a record: what was set, or the door's floor. */
export function renewalCentsFor(door: Door, sub: SubRecord | null): number {
  if (!isPaidDoor(door)) return 0;
  return sub?.renewalCents || DOOR_PRICES[door].renewalFloor;
}

export async function loadDoor(env: Env, c: number, plan: unknown): Promise<Door> {
  return readBlob(env, doorKey(c), (raw) => readDoor(raw, plan));
}
export async function loadSub(env: Env, c: number): Promise<SubRecord | null> {
  return readBlob(env, subKey(c), readSub);
}

/** Changes the door, keeping anything else the website builder stores in the same blob (like its limit override). */
export async function setDoor(env: Env, c: number, door: Door) {
  return updateBlob(env, doorKey(c), (raw) => (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}), (cur) => ({ value: { ...cur, door } }));
}

/** Admin edits of a subscription. Only known fields change. */
export function applySubEdit(cur: SubRecord | null, b: any, today: string): { value: SubRecord } | { error: string } {
  const base: SubRecord = cur ?? { startedOn: today, renewsOn: addDaysIso(today, 365), status: "active", cancelledOn: "", paidCents: 0, renewalCents: 0, promoCode: "", founding: false, outreach: "none", outreachNote: "", outreachOn: "" };
  const next = { ...base };
  if (b.startedOn !== undefined) {
    if (!isDate(b.startedOn)) return { error: "Start date must be YYYY-MM-DD." };
    next.startedOn = b.startedOn;
  }
  if (b.renewsOn !== undefined) {
    if (!isDate(b.renewsOn)) return { error: "Renewal date must be YYYY-MM-DD." };
    next.renewsOn = b.renewsOn;
  }
  if (next.renewsOn <= next.startedOn) return { error: "The renewal date must be after the start date." };
  if (b.status !== undefined) {
    if (b.status !== "active" && b.status !== "cancelled" && b.status !== "refunded") return { error: "Unknown status." };
    if (b.status !== "active" && next.status === "active") next.cancelledOn = today;
    if (b.status === "active") next.cancelledOn = "";
    next.status = b.status;
  }
  const money = (v: unknown, label: string): number | string => {
    const n = Math.round(Number(v) * 100);
    return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : `${label} must be a dollar amount.`;
  };
  if (b.paid !== undefined) {
    const n = money(b.paid, "Paid");
    if (typeof n === "string") return { error: n };
    next.paidCents = n;
  }
  if (b.renewal !== undefined) {
    const n = b.renewal === "" ? 0 : money(b.renewal, "Renewal");
    if (typeof n === "string") return { error: n };
    next.renewalCents = n;
  }
  if (b.promoCode !== undefined) next.promoCode = str(b.promoCode, 24).toUpperCase();
  if (b.founding !== undefined) next.founding = b.founding === true;
  return { value: next };
}

/** Marks the renewal as paid: the next renewal moves one year on and any outreach flag clears. */
export function applyRenewed(cur: SubRecord | null, paidCents: number): { value: SubRecord } | { error: string } {
  if (!cur) return { error: "This client has no paid year yet. Set the subscription first." };
  const next = addDaysIso(cur.renewsOn, 365);
  return { value: { ...cur, startedOn: cur.renewsOn, renewsOn: next, status: "active", cancelledOn: "", paidCents, outreach: "none", outreachNote: "", outreachOn: "" } };
}

export function applyOutreach(cur: SubRecord | null, b: any, today: string): { value: SubRecord } | { error: string } {
  if (!cur) return { error: "This client has no subscription yet." };
  if (!OUTREACH.includes(b.outreach)) return { error: "Choose an outreach status." };
  return { value: { ...cur, outreach: b.outreach, outreachNote: b.note !== undefined ? str(b.note, 300) : cur.outreachNote, outreachOn: today } };
}

export interface SubRow {
  companyId: number;
  name: string;
  slug: string;
  email: string;
  door: Door;
  state: SubState;
  startedOn: string;
  renewsOn: string;
  daysToRenewal: number | null;
  renewalCents: number;
  paidCents: number;
  refundUntil: string | null;
  refundCents: number;
  founding: boolean;
  promoCode: string;
  outreach: Outreach;
  outreachNote: string;
  outreachOn: string;
}

/** Every client's door and subscription, for the Subscriptions tab and the client list. */
export async function allSubs(env: Env, today: string): Promise<SubRow[]> {
  const cos = await env.DB.prepare(
    "SELECT c.id, c.name, c.slug, c.plan, (SELECT email FROM users WHERE company_id = c.id ORDER BY id LIMIT 1) AS email FROM companies c WHERE c.slug NOT LIKE 'demo-%' ORDER BY c.id",
  ).all<{ id: number; name: string; slug: string; plan: string; email: string | null }>();
  const doors = new Map((await blobsWithPrefix(env, "sitedoor:", 10000)).map((r) => [Number(r.key.slice(9)), r.value]));
  const subs = new Map((await blobsWithPrefix(env, "sub:", 10000)).map((r) => [Number(r.key.slice(4)), readSub(r.value)]));
  return (cos.results ?? []).map((c) => {
    const door = readDoor(doors.get(c.id), c.plan);
    const sub = subs.get(c.id) ?? null;
    const st = subState(door, sub, today);
    return {
      companyId: c.id, name: c.name, slug: c.slug, email: c.email ?? "", door, state: st.state,
      startedOn: sub?.startedOn ?? "", renewsOn: sub?.renewsOn ?? "", daysToRenewal: st.daysToRenewal, renewalCents: renewalCentsFor(door, sub), paidCents: sub?.paidCents ?? 0,
      refundUntil: st.refundUntil, refundCents: st.refundCents, founding: !!sub?.founding, promoCode: sub?.promoCode ?? "",
      outreach: sub?.outreach ?? "none", outreachNote: sub?.outreachNote ?? "", outreachOn: sub?.outreachOn ?? "",
    };
  });
}

/** Totals for the top of the Subscriptions tab. */
export function subTotals(rows: SubRow[], today: string) {
  const month = today.slice(0, 7);
  const byDoor: Record<Door, number> = { free: 0, launch: 0, grow: 0, signature: 0 };
  let paidThisMonth = 0, renewals60 = 0, renewals60Cents = 0, missed = 0, refundWindow = 0, founding = 0;
  for (const r of rows) {
    byDoor[r.door]++;
    if (r.startedOn.startsWith(month) && r.state !== "refunded") paidThisMonth += r.paidCents;
    if (r.state === "due_30" || r.state === "due_60") {
      renewals60++;
      renewals60Cents += r.renewalCents;
    }
    if (r.state === "missed") missed++;
    if (r.refundUntil) refundWindow++;
    if (r.founding) founding++;
  }
  return { byDoor, paidThisMonth, renewals60, renewals60Cents, missed, refundWindow, founding, foundingLeft: Math.max(0, FOUNDING_CAP - founding) };
}

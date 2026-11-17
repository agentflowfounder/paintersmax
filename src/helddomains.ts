import { addDaysIso } from "./dates.ts";
import { cleanHost } from "./domains.ts";
import { isDate, readBlob, str, updateBlob } from "./kv.ts";
import type { Env } from "./types.ts";

/**
 * The domains we buy and hold for clients (business model doc section 13, approved 2026-11-14).
 *  - The domain stays ours by default. The client may ask for a transfer any time before it expires; registrars block a
 *    transfer for 60 days after registration.
 *  - Admin gets a notice 60, 30 and 7 days before each held domain expires: Renew, Release (let it expire) or Reuse.
 *  - Reuse after 30 days: client cancelled or refunded, 30 days passed, no transfer asked. Only generic names
 *    ("longviewpainters.com") can go to the reuse pool, never one with the old client's business name.
 * This file only keeps the records and works out the queue. Buying, renewing and DNS stay in the registrar (Cloudflare).
 * Stored in app_settings "helddomains".
 */

export type DomainStatus = "active" | "transfer_requested" | "transferred" | "released" | "pool";
export const DOMAIN_STATUSES: DomainStatus[] = ["active", "transfer_requested", "transferred", "released", "pool"];
export interface HeldDomain {
  name: string;
  registrar: string;
  boughtOn: string;
  expiresOn: string;
  autoRenew: boolean;
  companyId: number | null;
  kind: "generic" | "branded";
  status: DomainStatus;
  costCents: number;
  note: string;
}

export const HELD_KEY = "helddomains";
export const TRANSFER_LOCK_DAYS = 60;
export const REUSE_AFTER_DAYS = 30;

export function readHeld(raw: unknown): HeldDomain[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: HeldDomain[] = [];
  for (const d of list) {
    const name = cleanHost(d?.name);
    if (!name || !isDate(d?.boughtOn) || !isDate(d?.expiresOn) || out.some((x) => x.name === name)) continue;
    const cents = Math.round(Number(d?.costCents));
    out.push({
      name,
      registrar: str(d.registrar, 40) || "Cloudflare",
      boughtOn: d.boughtOn,
      expiresOn: d.expiresOn,
      autoRenew: d.autoRenew !== false,
      companyId: Number.isInteger(d.companyId) && d.companyId > 0 ? d.companyId : null,
      kind: d.kind === "branded" ? "branded" : "generic",
      status: DOMAIN_STATUSES.includes(d.status) ? d.status : "active",
      costCents: Number.isFinite(cents) && cents >= 0 && cents < 1_000_000 ? cents : 0,
      note: str(d.note, 300),
    });
  }
  return out.slice(0, 5000);
}
export const loadHeld = (env: Env) => readBlob(env, HELD_KEY, readHeld);

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export type QueueReason = "expires_60" | "expires_30" | "expires_7" | "expired" | "reuse_ready" | "transfer_requested";

/** What needs a decision today, for one domain. `clientEnded` is the date the client cancelled or was refunded, if they did. */
export function domainQueue(d: HeldDomain, today: string, clientEnded: string | null) {
  const left = days(today, d.expiresOn);
  const transferFrom = addDaysIso(d.boughtOn, TRANSFER_LOCK_DAYS);
  const reuseFrom = clientEnded ? addDaysIso(clientEnded, REUSE_AFTER_DAYS) : null;
  const live = d.status === "active" || d.status === "transfer_requested";
  let reason: QueueReason | null = null;
  if (d.status === "transfer_requested") reason = "transfer_requested";
  else if (live && left < 0) reason = "expired";
  else if (live && left <= 7) reason = "expires_7";
  else if (live && left <= 30) reason = "expires_30";
  else if (live && left <= 60) reason = "expires_60";
  // Reuse is only offered for generic names, after the 30 days, when the client did not ask for the domain.
  if (!reason && d.status === "active" && d.kind === "generic" && reuseFrom && today >= reuseFrom) reason = "reuse_ready";
  return { reason, daysLeft: left, transferFrom, canTransfer: today >= transferFrom, reuseFrom, reusable: d.kind === "generic" };
}

export async function saveHeld(env: Env, b: any) {
  return updateBlob(env, HELD_KEY, readHeld, (list) => {
    const name = cleanHost(b?.name);
    if (!name) return { error: "Enter a valid domain, like longviewpainters.com." };
    if (!isDate(b?.boughtOn) || !isDate(b?.expiresOn)) return { error: "Bought and expiry dates are required (YYYY-MM-DD)." };
    if (b.expiresOn <= b.boughtOn) return { error: "The expiry date must be after the date it was bought." };
    if (b.kind !== "generic" && b.kind !== "branded") return { error: "Mark the domain generic or branded. A branded name has the client's business name in it and is never reused." };
    const i = list.findIndex((d) => d.name === name);
    if (b.isNew && i >= 0) return { error: "That domain is already on the list." };
    const costCents = b.cost === undefined || b.cost === "" ? list[i]?.costCents ?? 0 : Math.round(Number(b.cost) * 100);
    const companyId = b.companyId === "" || b.companyId == null ? null : Number(b.companyId);
    const d = readHeld([{ ...(list[i] ?? {}), ...b, name, costCents, companyId }])[0];
    if (!d) return { error: "Check the domain fields." };
    if (d.status === "pool" && d.kind === "branded") return { error: "A branded domain cannot go to the reuse pool." };
    const next = [...list];
    if (i >= 0) next[i] = d;
    else next.push(d);
    return { value: next, result: d };
  });
}

/** Renew (new expiry date after renewing at the registrar), release, transfer, pool or back to active. */
export async function decideHeld(env: Env, b: any) {
  return updateBlob(env, HELD_KEY, readHeld, (list) => {
    const name = cleanHost(b?.name);
    const i = name ? list.findIndex((d) => d.name === name) : -1;
    if (i < 0) return { error: "Domain not found." };
    const d = { ...list[i] };
    switch (b?.decision) {
      case "renew":
        if (!isDate(b.expiresOn) || b.expiresOn <= d.expiresOn) return { error: "Enter the new expiry date from the registrar (later than the current one)." };
        d.expiresOn = b.expiresOn;
        if (d.status !== "transfer_requested") d.status = "active";
        break;
      case "release":
        d.status = "released";
        d.autoRenew = false;
        break;
      case "transfer_requested":
      case "transferred":
        d.status = b.decision;
        if (b.decision === "transferred") d.autoRenew = false;
        break;
      case "pool":
        if (d.kind !== "generic") return { error: "A branded domain cannot go to the reuse pool." };
        d.status = "pool";
        d.companyId = null;
        break;
      case "active":
        d.status = "active";
        break;
      default:
        return { error: "Unknown decision." };
    }
    const next = [...list];
    next[i] = d;
    return { value: next, result: d };
  });
}

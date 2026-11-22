import { DOOR_LIMITS, DOOR_NAMES, nextDoor, upgradeCents, type Door } from "./sitecore.ts";
import { PROFILE_CAPS } from "./profile.ts";

/**
 * Pay-as-you-grow (Rogelio, 2026-11-22): a painter who started on Local Pro can reach Contractor, and a Contractor can
 * reach Commercial, a little at a time instead of in one jump. The way up is cut into 5 equal steps. Each step costs a
 * fifth of the price gap between the two doors and adds a fifth of the room gap (pages, service pages, photos and
 * cities). Everything paid counts toward the next door, so the five steps add up to exactly the one-time upgrade price.
 * When the fifth step is paid (or the one-time upgrade is bought for what is left) the door moves up and the steps reset.
 *
 * Stored inside the door blob (sitedoor:<companyId>) as `grow`, so there is no database change.
 * Free has no steps: its first paid door is the sign-up price.
 */

export const GROW_STEPS = 5;

export interface GrowRec { to: Door; steps: number; paidCents: number }
export interface Room { pages: number; services: number; photos: number; cities: number }

/** Cities each door covers (the profile caps of the plan that goes with the door). */
export const DOOR_CITIES: Record<Door, number> = {
  free: PROFILE_CAPS.free.cities,
  launch: PROFILE_CAPS.starter.cities,
  grow: PROFILE_CAPS.basic.cities,
  signature: PROFILE_CAPS.pro.cities,
};
const roomOf = (d: Door): Room => ({ ...DOOR_LIMITS[d], cities: DOOR_CITIES[d] });

/** Doors that can be grown into: Local Pro to Contractor, Contractor to Commercial. */
export const canGrowFrom = (d: Door) => d === "launch" || d === "grow";

export function readGrow(raw: unknown): GrowRec | null {
  const r = raw as any;
  if (!r || typeof r !== "object") return null;
  const to = r.to;
  if (to !== "grow" && to !== "signature") return null;
  const steps = Math.round(Number(r.steps));
  const paid = Math.round(Number(r.paidCents));
  if (!Number.isInteger(steps) || steps < 1 || steps >= GROW_STEPS) return null;
  return { to, steps, paidCents: Number.isFinite(paid) && paid >= 0 && paid <= 1_000_000 ? paid : 0 };
}

/** The progress that counts for this door: only steps toward the door right above it. */
export const activeGrow = (door: Door, grow: GrowRec | null | undefined): GrowRec | null => (grow && canGrowFrom(door) && grow.to === nextDoor(door) ? grow : null);

/** The room gained after `k` steps (0 to 5) from `from` toward the door above. */
export function extraRoom(from: Door, k: number): Room {
  const to = nextDoor(from);
  if (!to || !canGrowFrom(from) || k <= 0) return { pages: 0, services: 0, photos: 0, cities: 0 };
  const a = roomOf(from), b = roomOf(to);
  const n = Math.min(GROW_STEPS, Math.round(k));
  const at = (x: number, y: number) => Math.floor(((y - x) * n) / GROW_STEPS);
  return { pages: at(a.pages, b.pages), services: at(a.services, b.services), photos: at(a.photos, b.photos), cities: at(a.cities, b.cities) };
}

/** The price of step `k` (1 to 5). The five prices add up to exactly the upgrade price. */
export function stepCents(from: Door, k: number): number {
  const to = nextDoor(from);
  if (!to || !canGrowFrom(from) || k < 1 || k > GROW_STEPS) return 0;
  const total = upgradeCents(from, to);
  return Math.round((total * k) / GROW_STEPS) - Math.round((total * (k - 1)) / GROW_STEPS);
}

/** The price of the next `n` steps after the `done` already paid. */
export function stepsCents(from: Door, done: number, n: number): number {
  let sum = 0;
  for (let k = done + 1; k <= Math.min(GROW_STEPS, done + n); k++) sum += stepCents(from, k);
  return sum;
}

export interface GrowthOffer {
  to: Door;
  toName: string;
  done: number;
  total: number;
  paidCents: number;
  /** What the one-time upgrade costs now (the full gap less what was already paid in steps). */
  upgradeLeftCents: number;
  /** The next step: its price and the room it adds on top of what the painter has now. */
  next: { step: number; cents: number; adds: Room };
  /** Room gained so far, and the whole gap. */
  gained: Room;
  gap: Room;
}

/** What a painter on `door` can buy next; null when there is nothing to grow into. */
export function growthOffer(door: Door, grow: GrowRec | null | undefined): GrowthOffer | null {
  const to = nextDoor(door);
  if (!to || !canGrowFrom(door) || to === "free") return null;
  const g = activeGrow(door, grow);
  const done = g?.steps ?? 0;
  const paid = g?.paidCents ?? 0;
  const before = extraRoom(door, done), after = extraRoom(door, done + 1);
  const total = upgradeCents(door, to);
  return {
    to, toName: DOOR_NAMES[to], done, total, paidCents: paid,
    upgradeLeftCents: Math.max(100, total - paid),
    next: { step: done + 1, cents: stepCents(door, done + 1), adds: { pages: after.pages - before.pages, services: after.services - before.services, photos: after.photos - before.photos, cities: after.cities - before.cities } },
    gained: before,
    gap: extraRoom(door, GROW_STEPS),
  };
}

/** The new progress after `n` more steps were paid for `paid` cents. `upgrade` is true when the door should now move up. */
export function advance(door: Door, grow: GrowRec | null | undefined, n: number, paid: number): { grow: GrowRec | null; upgrade: boolean } {
  const to = nextDoor(door);
  if (!to || !canGrowFrom(door)) return { grow: null, upgrade: false };
  const g = activeGrow(door, grow);
  const steps = (g?.steps ?? 0) + Math.max(0, Math.round(n));
  const paidCents = (g?.paidCents ?? 0) + Math.max(0, Math.round(paid));
  if (steps >= GROW_STEPS || paidCents >= upgradeCents(door, to)) return { grow: null, upgrade: true };
  return { grow: { to, steps, paidCents }, upgrade: false };
}

import { PLACES_DAILY_DEFAULT } from "./address.ts";
import { COMMERCIAL_LIMIT } from "./commercial.ts";
import { STORAGE_LIMIT, MAX_FILE_BYTES, CUSTOMER_MAX_FILES } from "./files.ts";
import { PROFILE_CAPS } from "./profile.ts";
import { PLAN_LIMITS, type Plan } from "./usage.ts";
import { VEHICLE_LIMIT } from "./vehicles.ts";
import type { Env } from "./types.ts";

/**
 * Admin > Plan limits (2026-11-28, Rogelio: "KEEP" on every limit). Read-only: shows each limit per plan,
 * what it protects, and today's and this month's Google address lookups against the daily allowance.
 * Changing a number is a code change in the files above, not a setting, so this page only reports.
 */

const GB = 1024 ** 3;
const gb = (n: number) => (n >= GB ? `${n / GB} GB` : `${Math.round(n / 1024 / 1024)} MB`);

export interface LimitRow { name: string; free: string; starter: string; basic: string; pro: string; protects: string; safeguard: string }

export async function planLimitsView(env: Env, today: string) {
  const dailyPlacesLimit = Number(env.PLACES_DAILY_LIMIT) > 0 ? Number(env.PLACES_DAILY_LIMIT) : PLACES_DAILY_DEFAULT;
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const day = await env.DB.prepare("SELECT COALESCE(SUM(count),0) AS total, COALESCE(MAX(count),0) AS peak, COUNT(*) AS companies FROM usage_counters WHERE feature = 'places' AND period = ?").bind(today).first<{ total: number; peak: number; companies: number }>();
  const month = await env.DB.prepare("SELECT COALESCE(SUM(count),0) AS total FROM usage_counters WHERE feature = 'places' AND period >= ?").bind(from).first<{ total: number }>();
  const four = (f: (p: Plan) => string): [string, string, string, string] => [f("free"), f("starter"), f("basic"), f("pro")];
  const row = (name: string, v: [string, string, string, string], protects: string, safeguard: string): LimitRow => ({ name, free: v[0], starter: v[1], basic: v[2], pro: v[3], protects, safeguard });
  const rows: LimitRow[] = [
    row("Vehicles", four((p) => String(VEHICLE_LIMIT[p])), "Storage and clutter", "Plan count enforced when adding"),
    row("Published city pages", four((p) => String(PROFILE_CAPS[p].cities)), "Page writing cost", "Publish follows the plan"),
    row("File storage", four((p) => gb(STORAGE_LIMIT[p])), "Cloud storage cost", "Quota; warning at 80% on Home"),
    row("Commercial bids", four((p) => (Number.isFinite(COMMERCIAL_LIMIT[p]) ? String(COMMERCIAL_LIMIT[p]) : "unlimited")), "AI estimate cost", "Plan count"),
    row("AI estimates a month", four((p) => String(PLAN_LIMITS[p].ai_estimate)), "AI cost", "Monthly ceiling plus credits"),
    row("AI quotes a month", four((p) => String(PLAN_LIMITS[p].ai_quote)), "AI cost", "Monthly ceiling plus credits"),
    row("Google address lookups a day", four((p) => (p === "free" ? "off (our city list)" : `${dailyPlacesLimit} per company`)), "Google Places cost", "Daily allowance per company"),
    row("Single file size", four(() => `${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`), "Upload size", "Photos shrunk automatically"),
    row("Customer photo uploads per job", four(() => String(CUSTOMER_MAX_FILES)), "Abuse of the customer link", "Count cap"),
  ];
  return {
    rows,
    places: { limit: dailyPlacesLimit, today: { total: day?.total ?? 0, peak: day?.peak ?? 0, companies: day?.companies ?? 0 }, last30: month?.total ?? 0 },
    aiAlert: "The daily AI spend limit (AI health) warns at 50%, 80% and 100%. It does not pause AI. AI_KILL_SWITCH=1 is the only stop.",
    today,
  };
}

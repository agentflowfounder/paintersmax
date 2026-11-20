import { readBlob, str, updateBlob } from "./kv.ts";
import type { Env } from "./types.ts";
import type { Feature } from "./usage.ts";

/**
 * Credit envelopes and the AI model per client (business model doc section 10, approved 2026-11-14).
 *
 * Credits stay one pool (credits.ts). Envelopes steer it: each group of tools can have a monthly cap on the credits it may use.
 * A tool whose envelope is empty waits; nothing is lost, and admin (or the painter, once unlocked) can move credits between
 * envelopes. A group with no cap uses the pool freely. Monthly amounts that come with the plan are never affected: envelopes
 * only count credits.
 *
 * Admin also picks which text model answers a client's everyday text tools first (Gemini or Claude Haiku), overriding the
 * platform default set on the Settings tab. Photos keep their own models.
 *
 * Stored in app_settings envl:<companyId>. Credits used per envelope this month: usage_counters credit:env:<group>.
 */

export type Group = "website" | "estimates" | "assistant" | "automation" | "marketing";
export const GROUPS: Group[] = ["website", "estimates", "assistant", "automation", "marketing"];
export const GROUP_LABELS: Record<Group, string> = {
  website: "Website and color",
  estimates: "Photo analysis and estimates",
  assistant: "Job assistant and deep answers",
  automation: "Automation (invoices, receipts, reads)",
  marketing: "Marketing (posts, emails, images)",
};

/** Every metered feature belongs to one envelope (the compiler checks a new feature gets one). */
export const FEATURE_GROUP: Record<Feature, Group> = {
  ai_quote: "website", smart_select: "website", hd_render: "website", color_repaint: "website", site_write: "website", site_image: "website", site_image_draft: "website", logo_design: "website",
  photo_tag: "estimates", photo_analysis: "estimates", ai_estimate: "estimates", estimate_draft: "estimates", quote_helper: "estimates",
  ai_assistant: "assistant", ai_detailed: "assistant", ai_deep: "assistant", help_chat: "assistant",
  ai_invoice: "automation", receipt_read: "automation", bank_read: "automation", vehicle_read: "automation", insurance_scan: "automation",
};

export type TextModel = "default" | "gemini" | "haiku";

export interface Envelopes {
  enabled: boolean;
  painterCanEdit: boolean;
  caps: Partial<Record<Group, number>>; // credits a month; missing = no cap
  textModel: TextModel;
  setBy: string;
  setOn: string;
}

export const envKey = (c: number) => `envl:${c}`;
const EMPTY: Envelopes = { enabled: false, painterCanEdit: false, caps: {}, textModel: "default", setBy: "", setOn: "" };

export function readEnvelopes(raw: unknown): Envelopes {
  const r = raw as any;
  if (!r || typeof r !== "object") return { ...EMPTY, caps: {} };
  const caps: Partial<Record<Group, number>> = {};
  for (const g of GROUPS) {
    const v = r.caps?.[g];
    if (v === null || v === undefined || v === "") continue;
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 0 && n <= 100000) caps[g] = n;
  }
  return {
    enabled: r.enabled === true,
    painterCanEdit: r.painterCanEdit === true,
    caps,
    textModel: r.textModel === "gemini" || r.textModel === "haiku" ? r.textModel : "default",
    setBy: str(r.setBy, 200),
    setOn: str(r.setOn, 10),
  };
}
export const loadEnvelopes = (env: Env, c: number) => readBlob(env, envKey(c), readEnvelopes);

export async function saveEnvelopes(env: Env, c: number, b: any, by: string, today: string) {
  return updateBlob(env, envKey(c), readEnvelopes, (cur) => {
    const next = readEnvelopes({ ...cur, ...pick(b), setBy: by, setOn: today });
    return { value: next };
  });
}
function pick(b: any) {
  const o: any = {};
  if (b?.enabled !== undefined) o.enabled = b.enabled === true;
  if (b?.painterCanEdit !== undefined) o.painterCanEdit = b.painterCanEdit === true;
  if (b?.caps !== undefined) o.caps = b.caps;
  if (b?.textModel !== undefined) o.textModel = b.textModel;
  return o;
}

/** The text model a client's tools ask first, or null to use the platform default. Cached a minute per instance. */
const modelCache = new Map<number, { at: number; v: TextModel }>();
export async function clientTextModel(env: Env, c: number, now = Date.now()): Promise<"gemini" | "haiku" | null> {
  const hit = modelCache.get(c);
  let v: TextModel;
  if (hit && now - hit.at < 60_000) v = hit.v;
  else {
    try {
      v = (await loadEnvelopes(env, c)).textModel;
    } catch {
      v = "default";
    }
    if (modelCache.size > 500) modelCache.clear();
    modelCache.set(c, { at: now, v });
  }
  return v === "default" ? null : v;
}
export const forgetClientModel = (c: number) => modelCache.delete(c);

const counterFeature = (g: Group) => `credit:env:${g}`;

/**
 * Reserves `cost` credits from the feature's envelope for this month. True when allowed (no envelope, no cap, or room left).
 * Call releaseEnvelope with the same numbers if the credits could not be spent after all.
 */
export async function reserveEnvelope(env: Env, c: number, feature: Feature, cost: number, month: string): Promise<boolean> {
  const e = await loadEnvelopes(env, c);
  if (!e.enabled) return true;
  const g = FEATURE_GROUP[feature];
  const cap = e.caps[g];
  if (cap === undefined) return true;
  if (cost > cap) return false;
  const r = await env.DB.prepare(
    `INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, ?, ?, ?)
     ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + ? WHERE count + ? <= ? RETURNING count`,
  )
    .bind(c, counterFeature(g), month, cost, cost, cost, cap)
    .first();
  return !!r;
}
export async function releaseEnvelope(env: Env, c: number, feature: Feature, cost: number, month: string) {
  await env.DB.prepare("UPDATE usage_counters SET count = MAX(count - ?, 0) WHERE company_id = ? AND feature = ? AND period = ?").bind(cost, c, counterFeature(FEATURE_GROUP[feature]), month).run();
}

/** Credits used from each envelope this month. */
export async function envelopeUse(env: Env, c: number, month: string): Promise<Record<Group, number>> {
  const rows = await env.DB.prepare("SELECT feature, count FROM usage_counters WHERE company_id = ? AND period = ? AND feature LIKE 'credit:env:%'").bind(c, month).all<{ feature: string; count: number }>();
  const out = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  for (const r of rows.results ?? []) {
    const g = r.feature.slice(11) as Group;
    if (GROUPS.includes(g)) out[g] = r.count;
  }
  return out;
}

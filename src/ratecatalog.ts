import { getSessionUser } from "./auth.ts";
import { CATALOG_ROWS } from "./ratecatalog-data.ts";
import type { Env } from "./types.ts";

/**
 * The starting price list painters pick from. Source: Rogelio's rate card workbook.
 * Value = the Low rate, Premium = the High rate, Standard = the average of the two.
 * These are starting ranges for the painter to review, NOT market statistics or guarantees.
 */

export interface CatalogItem {
  id: string;
  group: string;
  label: string;
  unit: string; // as written in the workbook, for example "Per Door"
  short: string; // for estimate lines, for example "door"
  low: number;
  high: number;
  note: string;
}

export const POSITIONS = ["value", "standard", "premium"] as const;
export type Position = 0 | 1 | 2;
export const MARKET_TIERS = ["high", "average", "low"] as const; // index stored in a rate card as `tier`
export type Markets = Record<(typeof MARKET_TIERS)[number], number>;

/** Starting guesses, editable by the owner in /admin. Not data about any real market. */
export const DEFAULT_MARKETS: Markets = { high: 1.15, average: 1, low: 0.88 };

export function shortUnit(unit: string): string {
  const u = unit.replace(/^per\s+/i, "").trim().toLowerCase();
  if (u === "flat fee") return "flat";
  if (u === "linear ft") return "ft";
  return u || "ea";
}

const CATALOG: Record<string, CatalogItem[]> = {};
const BY_ID = new Map<string, CatalogItem>();
for (const [key, rows] of Object.entries(CATALOG_ROWS)) {
  CATALOG[key] = rows.map(([id, group, label, unit, low, high, note]) => {
    const item = { id, group, label, unit, short: shortUnit(unit), low, high, note };
    BY_ID.set(id, item);
    return item;
  });
}

export const catalogKeys = () => Object.keys(CATALOG);
export const catalogItems = (key: string): CatalogItem[] => CATALOG[key] ?? [];
export const catalogItem = (id: string): CatalogItem | undefined => BY_ID.get(id);

/** Which price list a trade uses. Builder cards use the builder list; trades without a list keep the older fill-in form. */
export function catalogKeyFor(trade: string, audience: string): string | null {
  if (audience === "builder") return "builder";
  return trade !== "builder" && CATALOG[trade] ? trade : null;
}

/** Rounds to a price a painter would actually quote. */
export function roundPrice(v: number): number {
  if (v >= 100) return Math.round(v / 5) * 5;
  if (v >= 10) return Math.round(v);
  return Math.round(v * 20) / 20;
}

export function priceFor(item: Pick<CatalogItem, "low" | "high">, position: Position, mult = 1): number {
  const base = position === 0 ? item.low : position === 2 ? item.high : (item.low + item.high) / 2;
  return roundPrice(base * mult);
}

export const rangeFor = (item: Pick<CatalogItem, "low" | "high">, mult = 1): [number, number] => [roundPrice(item.low * mult), roundPrice(item.high * mult)];

/** Plain-code check. Returns a note key when a price looks unusual for the chosen market, never blocks saving. */
export function sanityNote(price: number, item: Pick<CatalogItem, "low" | "high">, mult = 1): "below" | "above" | null {
  if (!(price > 0)) return null;
  if (price < item.low * mult * 0.75) return "below";
  if (price > item.high * mult * 1.25) return "above";
  return null;
}

/** The numbers to store in a rate card for a position and market multiplier. */
export function seedData(key: string, position: Position, mult = 1): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of catalogItems(key)) out[it.id] = priceFor(it, position, mult);
  return out;
}

export function parseMarkets(raw: unknown): Markets {
  const out = { ...DEFAULT_MARKETS };
  let j: any = raw;
  if (typeof raw === "string") {
    try {
      j = JSON.parse(raw);
    } catch {
      j = null;
    }
  }
  for (const t of MARKET_TIERS) {
    const n = Number(j?.[t]);
    if (Number.isFinite(n) && n >= 0.5 && n <= 2) out[t] = Math.round(n * 100) / 100;
  }
  return out;
}

const MARKETS_KEY = "market_tiers";
export async function loadMarkets(env: Env): Promise<Markets> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(MARKETS_KEY).first<{ value: string }>().catch(() => null);
  return parseMarkets(row?.value);
}
export async function saveMarkets(env: Env, input: unknown): Promise<Markets> {
  const m = parseMarkets(input);
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(MARKETS_KEY, JSON.stringify(m)).run();
  return m;
}

/** Example jobs shown under the prices ("what this rate means"). Matched by label so edits to the list do not break them. */
export const EXAMPLES: Record<string, { text: string; parts: [string, number][] }> = {
  interior: { text: "a 12 x 12 bedroom, full scope", parts: [["Standard Bedroom", 1]] },
  exterior: { text: "1,800 sq ft of fiber cement siding plus one entry door", parts: [["Fiber Cement", 1800], ["Exterior Entry Doors", 1]] },
  commercial: { text: "5,000 sq ft of retail strip center walls", parts: [["Retail Strip Centers", 5000]] },
  power_washing: { text: "soft washing a 2,000 sq ft house", parts: [["House Soft Wash", 2000]] },
  cabinets: { text: "20 cabinet doors and 8 drawer fronts", parts: [["Standard Cabinet Door", 20], ["Drawer Front", 8]] },
  decks_fences: { text: "a 300 sq ft deck and 150 ft of fence, one side", parts: [["Wood Decks", 300], ["Fences (1 Side", 150]] },
  epoxy_floors: { text: "a 400 sq ft garage floor with solid-color epoxy", parts: [["100% Solids", 400]] },
  builder: { text: "a 2,400 sq ft production home, interior and exterior", parts: [["Production / Tract", 2400]] },
};

export function publicCatalog() {
  return Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v]));
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** GET /api/catalog: the starting price lists, market multipliers and example jobs. Signed-in owners only. */
export async function handleCatalog(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "GET") return json({ error: "Not found." }, 404);
  return json({ catalog: publicCatalog(), markets: await loadMarkets(env), examples: EXAMPLES, positions: POSITIONS });
}

/** Labels and units for the catalog ids present in a rate card, for the quantity form on a job. */
export function labelsFor(data: Record<string, unknown>): Record<string, { label: string; unit: string }> {
  const out: Record<string, { label: string; unit: string }> = {};
  for (const k of Object.keys(data ?? {})) {
    const it = BY_ID.get(k);
    if (it) out[k] = { label: it.label, unit: it.short };
  }
  return out;
}

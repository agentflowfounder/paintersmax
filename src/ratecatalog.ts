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

export const POSITIONS = ["value", "standard", "premium", "master"] as const;
export type Position = 0 | 1 | 2 | 3;
/** Master pricing starts this far above the Premium (High) rate. A starting guess the painter can change item by item. */
export const MASTER_UPLIFT = 1.25;

/** The pricing levels each service offers, with plain words about who each level is for. Power washing has three. */
export const LEVELS: Record<string, { names: string[]; help: string[] }> = {
  default: {
    names: ["Value", "Standard", "Premium", "Master"],
    help: [
      "Win jobs on price. A fit if you are building reviews, or your area is price-sensitive.",
      "A fair rate for a solid local painter with steady work and good reviews. Most painters start here.",
      "For a higher-end finish, careful prep, a tidy crew and strong reviews.",
      "Master painter pricing: the best finish in town, detailed prep, fine craftsmanship and a strong reputation. Customers pay for the person who does it right.",
    ],
  },
  interior: { names: ["Value", "Standard", "Premium", "Master"], help: ["Win jobs on price. A fit if you are newer, building reviews, or your area is price-sensitive.", "A fair rate for a solid local painter with steady work and good reviews. Most painters start here.", "Careful prep, clean lines, a tidy crew and strong reviews.", "Master painter pricing: flawless walls, fine trim work, full protection of the home and a reputation customers recommend."] },
  exterior: { names: ["Value", "Standard", "Premium", "Master"], help: ["Basic wash and prep, standard paint, quick turnaround.", "Good prep, scraping and caulking, two coats of quality paint.", "Thorough prep, premium paint and careful detail work on trim and wood repair.", "Master craftsmanship: complete prep, top paints, wood repair, a clean site and a long warranty."] },
  commercial: { names: ["Value", "Standard", "Premium", "Master"], help: ["Competitive bids on easy jobs: open spaces, standard colors, no night work.", "A typical commercial bid with insurance, a schedule and a fair margin.", "Larger or busier properties, tight schedules, documentation and reporting.", "Top-tier commercial contractor: after-hours work, bonding, prevailing wage and premium coating systems."] },
  power_washing: { names: ["Value", "Residential", "Commercial"], help: ["Basic washing for small or easy jobs. The lowest market prices.", "Typical home work: houses, driveways, patios and decks.", "Larger surfaces, strict schedules and the equipment and insurance business properties require."] },
  cabinets: { names: ["Value", "Standard", "Premium", "Master"], help: ["Brush and roll finish with basic cleaning and sanding.", "Sprayed finish with good cleaning, sanding and primer.", "Factory-smooth sprayed finish with full prep and doors and drawers finished off the box.", "Furniture-grade finish, hardware, full protection of the kitchen and a strong warranty."] },
  decks_fences: { names: ["Value", "Standard", "Premium", "Master"], help: ["Wash and one coat of stain or paint.", "Wash, sand the rough spots and two coats.", "Full prep, board repair and a premium stain.", "Restoration quality: stripping, brightening, repairs and a premium sealed finish."] },
  epoxy_floors: { names: ["Value", "Standard", "Premium", "Master"], help: ["Thin single-coat floor coating with basic grinding.", "Ground concrete with a full-solids epoxy system.", "A full flake or metallic system with a UV-stable topcoat.", "Custom decorative floors, moisture control and the strongest warranty."] },
  builder: { names: ["Value", "Standard", "Premium", "Master"], help: ["Production-builder volume: the lowest price per home and a fast schedule.", "Semi-custom builders and mid-size volume.", "Higher-end builders who expect a finer finish and more detail.", "Custom home builders: the top finish, the closest supervision and the strongest warranty."] },
  drywall: { names: ["Value", "Standard", "Premium", "Master"], help: ["Quick patches and basic finishing.", "Clean patching, taping and sanding ready for paint.", "Smooth finishes, texture matching and tight control of dust.", "Invisible repairs, level 5 finishing and complete protection of the home."] },
  fencing: { names: ["Value", "Standard", "Premium", "Master"], help: ["Basic pickets and posts, simple styles.", "Solid privacy fence with treated lumber.", "Better lumber, stronger posts and cleaner detail.", "Custom designs, premium materials and a long warranty."] },
  remodeling: { names: ["Value", "Standard", "Premium", "Master"], help: ["Cosmetic updates and simple repairs.", "Typical room refresh with solid materials.", "Higher-grade materials and careful finish carpentry.", "Custom work, top materials and a master craftsman's detail."] },
  industrial: { names: ["Value", "Standard", "Premium", "Master"], help: ["Basic coatings and light prep.", "A standard industrial coating system with proper prep.", "High-performance systems and detailed surface prep.", "Specialty systems, documented prep and inspection, with the strongest warranty."] },
};
export const levelsFor = (key: string) => LEVELS[key] ?? LEVELS.default;

/**
 * Starting numbers for services that have no item list yet (they use a simple per-square-foot or per-foot form).
 * One number per level, in the order of the level names. Starting guesses for the painter to review, not market data.
 */
export const LEVEL_FILLS: Record<string, { method: string; fields: Record<string, number[]> }> = {
  drywall: { method: "sqft_floor", fields: { low: [2, 2.5, 3.25, 4.25], high: [2.75, 3.5, 4.5, 6], minimum: [125, 175, 250, 350] } },
  fencing: { method: "per_linear_ft", fields: { low: [18, 25, 35, 50], high: [28, 40, 55, 80], gate_each: [250, 350, 500, 750], removal_per_ft: [3, 4, 6, 8], stain_per_ft: [2, 3, 4.5, 6] } },
  remodeling: { method: "sqft_floor", fields: { low: [35, 50, 80, 120], high: [60, 90, 140, 220], minimum: [1500, 2500, 4000, 6000] } },
  industrial: { method: "sqft_floor", fields: { low: [2.5, 4, 6, 9], high: [4.5, 7, 10, 15], minimum: [800, 1200, 1800, 2500] } },
};
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
  const base = position === 0 ? item.low : position === 2 ? item.high : position === 3 ? item.high * MASTER_UPLIFT : (item.low + item.high) / 2;
  return roundPrice(base * mult);
}

export const rangeFor = (item: Pick<CatalogItem, "low" | "high">, mult = 1): [number, number] => [roundPrice(item.low * mult), roundPrice(item.high * mult)];

/** Plain-code check. Returns a note key when a price looks unusual for the chosen market, never blocks saving. */
export function sanityNote(price: number, item: Pick<CatalogItem, "low" | "high">, mult = 1): "below" | "above" | null {
  if (!(price > 0)) return null;
  if (price < item.low * mult * 0.75) return "below";
  if (price > item.high * mult * MASTER_UPLIFT * 1.15) return "above";
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
  return json({ catalog: publicCatalog(), markets: await loadMarkets(env), examples: EXAMPLES, positions: POSITIONS, levels: LEVELS, levelFills: LEVEL_FILLS, masterUplift: MASTER_UPLIFT });
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

import { getSessionUser } from "./auth.ts";
import { computeTotals, draftLines, type EstimateLine, type Totals } from "./estimate.ts";
import { catalogItems, catalogKeyFor, EXAMPLES } from "./ratecatalog.ts";
import type { Env } from "./types.ts";

/**
 * "What your estimate will look like": a SAMPLE job priced with the painter's own saved prices, using the same line and total
 * code real estimates use. The sample customer and sizes are made up for illustration and are labeled that way.
 * Nothing is saved or sent.
 */

export interface PreviewJob {
  trade: string;
  title: string;
  text: string; // what the sample job is
  lines: (EstimateLine & { totalCents: number })[];
  totals: Totals;
}

/** Quantities for the sample job, keyed by catalog item id. Returns null when a price in the example is missing. */
export function exampleQty(key: string, data: Record<string, any>): Record<string, number> | null {
  const ex = EXAMPLES[key];
  if (!ex) return null;
  const items = catalogItems(key);
  const qty: Record<string, number> = {};
  for (const [match, q] of ex.parts) {
    const it = items.find((i) => i.label.startsWith(match) || i.label.includes(match));
    if (!it || !(Number(data?.[it.id]) > 0)) return null;
    qty[it.id] = q;
  }
  return qty;
}

export function buildPreview(trade: string, audience: string, data: Record<string, any>, labor: { minimumJob?: number; depositPct?: number }, title: string): PreviewJob | null {
  const key = catalogKeyFor(trade, audience);
  if (!key) return null;
  const qty = exampleQty(key, data);
  if (!qty) return null;
  const lines = draftLines("catalog", data, qty, trade);
  if (!lines.length) return null;
  const totals = computeTotals({ lines, taxPct: 0, discountCents: 0 }, { minimumJobCents: Math.round((labor.minimumJob ?? 0) * 100), depositPct: labor.depositPct });
  return { trade: audience === "builder" ? "builder" : trade, title, text: EXAMPLES[key].text, lines: lines.map((l) => ({ ...l, totalCents: Math.round(l.qty * l.unitCents) })), totals };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const TITLES: Record<string, string> = {
  interior: "Interior painting", exterior: "Exterior painting", commercial: "Commercial painting", power_washing: "Power washing",
  cabinets: "Cabinet painting", decks_fences: "Deck and fence staining", epoxy_floors: "Epoxy floors",
};

/** GET /api/estimate-preview: one sample estimate for each service that has a saved price list. */
export async function handleEstimatePreview(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "GET") return json({ error: "Not found." }, 404);
  const prof = await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(user.companyId).first<{ data: string }>();
  let profile: any = {};
  try {
    profile = prof ? JSON.parse(prof.data) : {};
  } catch {
    profile = {};
  }
  const rows = (await env.DB.prepare("SELECT trade, audience, method, data FROM rate_cards WHERE company_id = ?").bind(user.companyId).all<{ trade: string; audience: string; method: string; data: string }>()).results ?? [];
  const previews: PreviewJob[] = [];
  for (const r of rows) {
    if (r.method !== "catalog") continue;
    let d: any = {};
    try {
      d = JSON.parse(r.data);
    } catch {
      d = {};
    }
    const title = r.audience === "builder" ? "New construction (builders)" : TITLES[r.trade] ?? r.trade;
    const p = buildPreview(r.trade, r.audience, d, profile.labor ?? {}, title);
    if (p) previews.push(p);
  }
  return json({ company: profile.company?.legalName ?? "", previews: previews.slice(0, 4) });
}

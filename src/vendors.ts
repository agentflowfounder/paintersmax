import { getSessionUser } from "./auth.ts";
import { readBlob, updateBlob } from "./kv.ts";
import { consume, refund } from "./usage.ts";
import { friendlyVisionError, parseJsonLoose, visionAsk } from "./vision.ts";
import type { Env } from "./types.ts";

/**
 * Vendors and price lists.
 *  GET  /api/vendors                       -> { vendors, tips, prefs }
 *  GET  /api/vendors?id=                   -> { vendor, prices }
 *  GET  /api/vendors?find=<words>&owner=mine|customer  -> { prices } for the estimate's "Use a vendor price"
 *  POST /api/vendors {action: save|delete|addPrice|deletePrice|readSheet|savePrices|prefs|setDeal|confirmPrice|addLog|deleteLog}
 *
 * A price sheet (PDF or photo) is read by AI into lines the painter checks before saving. The file itself is not kept.
 * Reading a sheet uses one "document read" from the receipt-reading allowance.
 * Only the last 4 characters of a store account number are kept, never bank, routing or card numbers.
 * Vendor names are shown as our own badges (see /vendor-badges). Store logos are trademarks and are not used without permission.
 *
 * Prices are REFERENCES, not facts (Rogelio, 2026-11-28): stores and reps change prices and give different deals, so every number
 * here is a suggestion until the painter confirms it, and PaintersMax never says what a store will charge. Each price shows how
 * old it is, can carry a deal note with an end date, and is marked "check again" when old or when its deal has ended.
 * Deals and rep notes live in app_settings (no database change): vdeal:<company> and vlog:<company>.
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const txt = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export const FRESH_DAYS = 30;
export const OLD_DAYS = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/** What a painter notes about one price: who gave it, what the deal is, when it ends, and when they last confirmed it. */
export interface Deal { rep: string; deal: string; expiresOn: string; confirmedOn: string }
export type DealBook = Record<string, Deal>;
export function cleanDeal(i: any): Deal {
  return { rep: txt(i?.rep, 80), deal: txt(i?.deal, 200), expiresOn: DATE.test(txt(i?.expiresOn, 10)) ? txt(i?.expiresOn, 10) : "", confirmedOn: DATE.test(txt(i?.confirmedOn, 10)) ? txt(i?.confirmedOn, 10) : "" };
}
export function readDeals(raw: unknown): DealBook {
  const out: DealBook = {};
  if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 5000)) if (/^\d+$/.test(k)) { const d = cleanDeal(v); if (d.rep || d.deal || d.expiresOn || d.confirmedOn) out[k] = d; }
  return out;
}

export type FreshState = "fresh" | "aging" | "old" | "expired";
export interface Fresh { checkedOn: string; ageDays: number; state: FreshState }
/**
 * How much to trust a saved price. The date it was last checked is the newest of: the date on the price sheet, the day it was added,
 * and the day the painter pressed "Still good". Up to 30 days is fresh, up to 60 aging, older is old, and a deal past its end date is expired.
 */
export function priceFresh(p: { effectiveOn?: string; createdAt?: string }, deal: Deal | undefined, now = today()): Fresh {
  const dates = [deal?.confirmedOn, p.effectiveOn, (p.createdAt ?? "").slice(0, 10)].filter((d): d is string => !!d && DATE.test(d));
  const checkedOn = dates.sort().pop() ?? "";
  const ageDays = checkedOn ? Math.max(0, dayNum(now) - dayNum(checkedOn)) : 9999;
  const state: FreshState = deal?.expiresOn && deal.expiresOn < now ? "expired" : ageDays <= FRESH_DAYS ? "fresh" : ageDays <= OLD_DAYS ? "aging" : "old";
  return { checkedOn, ageDays, state };
}

/** A rep or deal note kept per vendor, newest last. */
export interface LogEntry { id: string; at: string; text: string }
export type LogBook = Record<string, LogEntry[]>;
export function readLog(raw: unknown): LogBook {
  const out: LogBook = {};
  if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (!/^\d+$/.test(k) || !Array.isArray(v)) continue;
    const list = v.map((e: any) => ({ id: txt(e?.id, 20), at: DATE.test(txt(e?.at, 10)) ? txt(e.at, 10) : "", text: txt(e?.text, 500) })).filter((e) => e.id && e.text).slice(-60);
    if (list.length) out[k] = list;
  }
  return out;
}
const dealsKey = (c: number) => `vdeal:${c}`;
const logKey = (c: number) => `vlog:${c}`;

export const KINDS: Record<string, string> = { sherwin_williams: "Sherwin-Williams", home_depot: "Home Depot", lowes: "Lowe's", benjamin_moore: "Benjamin Moore", ppg: "PPG", kelly_moore: "Kelly-Moore", dunn_edwards: "Dunn-Edwards", valspar: "Valspar", behr: "Behr", other: "Other" };

/** Plain tips for getting better material prices, shown on the Vendors page and in job reports. */
export const TIPS = [
  "Ask your local Sherwin-Williams store manager or rep for a Pro account and volume pricing. Bring your monthly gallon count.",
  "Compare the same products on Home Depot Pro and Lowe's Pro price lists, and ask each store to match.",
  "On big jobs, ask for a price lock for the length of the job, in writing.",
  "Buy in 5-gallon pails when a color covers more than about 8 gallons.",
  "Ask about rebates, loyalty points and free delivery for job sites.",
  "Upload each new price sheet here so your estimates use your real prices.",
];

export interface VendorIn { name: string; kind: string; owner: "mine" | "customer"; customerName: string; accountLast4: string; repName: string; repPhone: string; repEmail: string; discountPct: number; notes: string }

export function cleanVendor(i: any): VendorIn | { error: string } {
  const kind = Object.prototype.hasOwnProperty.call(KINDS, i?.kind) ? i.kind : "other";
  const name = txt(i?.name, 80) || (kind !== "other" ? KINDS[kind] : "");
  if (!name) return { error: "Give the vendor a name." };
  const acct = String(i?.accountLast4 ?? "").replace(/[^A-Za-z0-9]/g, "");
  const d = Number(i?.discountPct);
  return {
    name, kind, owner: i?.owner === "customer" ? "customer" : "mine", customerName: txt(i?.customerName, 120),
    accountLast4: acct.slice(-4), repName: txt(i?.repName, 80), repPhone: txt(i?.repPhone, 30), repEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt(i?.repEmail, 120)) ? txt(i?.repEmail, 120) : "",
    discountPct: Number.isFinite(d) && d >= 0 && d <= 90 ? Math.round(d * 10) / 10 : 0, notes: txt(i?.notes, 800),
  };
}

export interface PriceIn { product: string; size: string; sku: string; priceCents: number; effectiveOn: string }
export function cleanPrice(i: any): PriceIn | null {
  const product = txt(i?.product, 120);
  const dollars = typeof i?.price === "string" ? Number(i.price.replace(/[$,\s]/g, "")) : Number(i?.price ?? (Number(i?.priceCents) / 100));
  const cents = Math.round(dollars * 100);
  if (!product || !Number.isFinite(cents) || cents <= 0 || cents > 10_000_000) return null;
  const eff = txt(i?.effectiveOn, 10);
  return { product, size: txt(i?.size, 30), sku: txt(i?.sku, 40), priceCents: cents, effectiveOn: /^\d{4}-\d{2}-\d{2}$/.test(eff) ? eff : "" };
}

const BUSINESS = /\b(llc|l\.l\.c|inc|corp|corporation|company|co\.|ltd|lp|llp|pllc|department|dept|county|city of|state of|isd|school|college|university|authority|district|builders?|construction|contractors?|general contractor|properties|property management|management|realty|apartments|hoa|association|church|hospital|clinic|federal|government|agency|commission|housing)\b/i;

/**
 * When to offer the customer's price list. Only when the customer looks like a business, a builder or a public agency,
 * or the job is commercial, and the painter has not turned the question off. Returns why, or null to stay quiet.
 */
export function shouldAskPriceList(i: { customerName: string; trade: string; optOut: boolean; customerVendors: number }): string | null {
  if (i.optOut) return null;
  if (i.customerVendors > 0) return "You have saved price lists for customers before.";
  if (/commercial|new_construction/i.test(i.trade)) return "This is commercial work. Big customers often have their own paint store account.";
  if (BUSINESS.test(i.customerName)) return "This customer looks like a business, builder or public agency. They may have their own account with Sherwin-Williams, Benjamin Moore or PPG.";
  return null;
}

const SHEET_PROMPT = [
  "You read a paint store price sheet or quote for a painting contractor.",
  "Return JSON only: {\"vendor\": string, \"effectiveOn\": \"YYYY-MM-DD\" or \"\", \"lines\": [{\"product\": string, \"size\": string, \"sku\": string, \"price\": number}]}.",
  "One line per product and size. price is the contractor's price in US dollars for one unit, as a number. Skip lines with no price.",
  "Copy product names as written. Do not invent products or prices. Up to 150 lines.",
].join("\n");

async function prefs(env: Env, c: number): Promise<{ optOut: boolean }> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`vendorprefs:${c}`).first<{ value: string }>().catch(() => null);
  try {
    return { optOut: !!JSON.parse(r?.value ?? "{}").optOut };
  } catch {
    return { optOut: false };
  }
}

export async function handleVendors(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  const u = new URL(request.url);
  if (request.method === "GET") {
    const id = Number(u.searchParams.get("id"));
    const find = txt(u.searchParams.get("find"), 60);
    const job = Number(u.searchParams.get("job"));
    if (Number.isInteger(job) && job > 0) {
      const j = await env.DB.prepare("SELECT j.trade, cu.name FROM jobs j JOIN customers cu ON cu.id = j.customer_id WHERE j.id = ? AND j.company_id = ?").bind(job, c).first<{ trade: string; name: string }>();
      if (!j) return json({ error: "Not found." }, 404);
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM vendors WHERE company_id = ? AND owner = 'customer'").bind(c).first<{ n: number }>();
      const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM vendors WHERE company_id = ? AND owner = 'mine'").bind(c).first<{ n: number }>();
      return json({ ask: shouldAskPriceList({ customerName: j.name ?? "", trade: j.trade ?? "", optOut: (await prefs(env, c)).optOut, customerVendors: Number(n?.n) || 0 }), myVendors: Number(mine?.n) || 0 });
    }
    if (find) {
      const owner = u.searchParams.get("owner") === "customer" ? "customer" : "mine";
      const words = find.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
      const where = words.map(() => "lower(p.product) LIKE ?").join(" AND ");
      const rows = await env.DB.prepare(`SELECT p.id, p.product, p.size, p.sku, p.price_cents AS priceCents, p.effective_on AS effectiveOn, p.created_at AS createdAt, v.name AS vendor, v.discount_pct AS discountPct, v.customer_name AS customerName FROM vendor_prices p JOIN vendors v ON v.id = p.vendor_id WHERE p.company_id = ? AND v.owner = ? ${where ? "AND " + where : ""} ORDER BY p.price_cents LIMIT 20`)
        .bind(c, owner, ...words.map((w) => `%${w}%`)).all<any>();
      const deals = await readBlob(env, dealsKey(c), readDeals);
      return json({ prices: (rows.results ?? []).map((x) => ({ ...x, deal: deals[String(x.id)] ?? null, ...priceFresh(x, deals[String(x.id)]) })) });
    }
    if (Number.isInteger(id) && id > 0) {
      const v = await env.DB.prepare("SELECT * FROM vendors WHERE id = ? AND company_id = ?").bind(id, c).first();
      if (!v) return json({ error: "Not found." }, 404);
      const p = await env.DB.prepare("SELECT id, product, size, sku, price_cents AS priceCents, effective_on AS effectiveOn, created_at AS createdAt, source FROM vendor_prices WHERE vendor_id = ? AND company_id = ? ORDER BY product LIMIT 1000").bind(id, c).all<any>();
      const deals = await readBlob(env, dealsKey(c), readDeals);
      const log = (await readBlob(env, logKey(c), readLog))[String(id)] ?? [];
      return json({ vendor: v, prices: (p.results ?? []).map((x) => ({ ...x, deal: deals[String(x.id)] ?? null, ...priceFresh(x, deals[String(x.id)]) })), log, rule: { freshDays: FRESH_DAYS, oldDays: OLD_DAYS } });
    }
    const list = await env.DB.prepare("SELECT v.*, (SELECT COUNT(*) FROM vendor_prices p WHERE p.vendor_id = v.id) AS priceCount, (SELECT MAX(effective_on) FROM vendor_prices p WHERE p.vendor_id = v.id) AS latest FROM vendors v WHERE v.company_id = ? ORDER BY v.owner, v.name").bind(c).all<any>();
    // How many prices in each vendor need another look (old, or a deal that ended).
    const rows = await env.DB.prepare("SELECT id, vendor_id AS vendorId, effective_on AS effectiveOn, created_at AS createdAt FROM vendor_prices WHERE company_id = ? LIMIT 5000").bind(c).all<any>();
    const deals = await readBlob(env, dealsKey(c), readDeals);
    const need = new Map<number, number>();
    for (const r of rows.results ?? []) if (priceFresh(r, deals[String(r.id)]).state !== "fresh") need.set(r.vendorId, (need.get(r.vendorId) ?? 0) + 1);
    return json({ vendors: (list.results ?? []).map((v) => ({ ...v, needCheck: need.get(v.id) ?? 0 })), kinds: KINDS, tips: TIPS, prefs: await prefs(env, c), rule: { freshDays: FRESH_DAYS, oldDays: OLD_DAYS } });
  }
  let b: any;
  try { b = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
  const owned = async (id: unknown) => (Number.isInteger(Number(id)) ? !!(await env.DB.prepare("SELECT id FROM vendors WHERE id = ? AND company_id = ?").bind(Number(id), c).first()) : false);
  switch (b?.action) {
    case "save": {
      const v = cleanVendor(b.vendor);
      if ("error" in v) return json(v, 400);
      if (b.id) {
        if (!(await owned(b.id))) return json({ error: "Not found." }, 404);
        await env.DB.prepare("UPDATE vendors SET name=?, kind=?, owner=?, customer_name=?, account_last4=?, rep_name=?, rep_phone=?, rep_email=?, discount_pct=?, notes=?, updated_at=datetime('now') WHERE id=? AND company_id=?")
          .bind(v.name, v.kind, v.owner, v.customerName, v.accountLast4, v.repName, v.repPhone, v.repEmail, v.discountPct, v.notes, Number(b.id), c).run();
        return json({ ok: true, id: Number(b.id) });
      }
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM vendors WHERE company_id = ?").bind(c).first<{ n: number }>();
      if ((Number(n?.n) || 0) >= 60) return json({ error: "You can keep up to 60 vendors." }, 400);
      const r = await env.DB.prepare("INSERT INTO vendors (company_id, name, kind, owner, customer_name, account_last4, rep_name, rep_phone, rep_email, discount_pct, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id")
        .bind(c, v.name, v.kind, v.owner, v.customerName, v.accountLast4, v.repName, v.repPhone, v.repEmail, v.discountPct, v.notes).first<{ id: number }>();
      return json({ ok: true, id: r?.id });
    }
    case "delete": {
      if (!(await owned(b.id))) return json({ error: "Not found." }, 404);
      const ids = ((await env.DB.prepare("SELECT id FROM vendor_prices WHERE vendor_id = ? AND company_id = ?").bind(Number(b.id), c).all<{ id: number }>()).results ?? []).map((x) => String(x.id));
      await env.DB.batch([env.DB.prepare("DELETE FROM vendor_prices WHERE vendor_id = ? AND company_id = ?").bind(Number(b.id), c), env.DB.prepare("DELETE FROM vendors WHERE id = ? AND company_id = ?").bind(Number(b.id), c)]);
      await updateBlob(env, dealsKey(c), readDeals, (cur) => { const next = { ...cur }; for (const i of ids) delete next[i]; return { value: next }; });
      await updateBlob(env, logKey(c), readLog, (cur) => { const next = { ...cur }; delete next[String(Number(b.id))]; return { value: next }; });
      return json({ ok: true });
    }
    case "addPrice":
    case "savePrices": {
      if (!(await owned(b.vendorId))) return json({ error: "Not found." }, 404);
      const raw = b.action === "addPrice" ? [b.price] : Array.isArray(b.lines) ? b.lines.slice(0, 1000) : [];
      const lines = raw.map(cleanPrice).filter(Boolean) as PriceIn[];
      if (!lines.length) return json({ error: "Add a product and a price." }, 400);
      const src = b.action === "addPrice" ? "manual" : "sheet";
      const stmts = [];
      if (b.replace === true) stmts.push(env.DB.prepare("DELETE FROM vendor_prices WHERE vendor_id = ? AND company_id = ? AND source = 'sheet'").bind(Number(b.vendorId), c));
      for (const l of lines) stmts.push(env.DB.prepare("INSERT INTO vendor_prices (company_id, vendor_id, product, size, sku, price_cents, effective_on, source) VALUES (?,?,?,?,?,?,?,?)").bind(c, Number(b.vendorId), l.product, l.size, l.sku, l.priceCents, l.effectiveOn, src));
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      return json({ ok: true, added: lines.length });
    }
    case "deletePrice": {
      await env.DB.prepare("DELETE FROM vendor_prices WHERE id = ? AND company_id = ?").bind(Number(b.id), c).run();
      await updateBlob(env, dealsKey(c), readDeals, (cur) => { const next = { ...cur }; delete next[String(Number(b.id))]; return { value: next }; });
      return json({ ok: true });
    }
    case "setDeal": {
      // Who gave this price, what the deal is and when it ends. Saving it does not change the price.
      const row = await env.DB.prepare("SELECT id FROM vendor_prices WHERE id = ? AND company_id = ?").bind(Number(b.priceId), c).first();
      if (!row) return json({ error: "Not found." }, 404);
      const d = cleanDeal(b.deal);
      const r = await updateBlob(env, dealsKey(c), readDeals, (cur) => { const next = { ...cur }; const old = next[String(Number(b.priceId))]; next[String(Number(b.priceId))] = { ...d, confirmedOn: old?.confirmedOn ?? "" }; return { value: readDeals(next) }; });
      return r.ok ? json({ ok: true }) : json({ error: r.error }, 409);
    }
    case "confirmPrice": {
      // "Still good": the painter checked this price with the store today.
      const ids = b.all === true
        ? ((await env.DB.prepare("SELECT id FROM vendor_prices WHERE vendor_id = ? AND company_id = ?").bind(Number(b.vendorId), c).all<{ id: number }>()).results ?? []).map((x) => String(x.id))
        : ((await env.DB.prepare("SELECT id FROM vendor_prices WHERE id = ? AND company_id = ?").bind(Number(b.priceId), c).first<{ id: number }>()) ? [String(Number(b.priceId))] : []);
      if (!ids.length) return json({ error: "Not found." }, 404);
      const now = today();
      const r = await updateBlob(env, dealsKey(c), readDeals, (cur) => { const next = { ...cur }; for (const i of ids) next[i] = { ...(next[i] ?? { rep: "", deal: "", expiresOn: "" }), confirmedOn: now }; return { value: readDeals(next) }; });
      return r.ok ? json({ ok: true, confirmed: ids.length }) : json({ error: r.error }, 409);
    }
    case "addLog": {
      if (!(await owned(b.vendorId))) return json({ error: "Not found." }, 404);
      const text = txt(b.text, 500);
      if (!text) return json({ error: "Write the note." }, 400);
      const key = String(Number(b.vendorId));
      const r = await updateBlob(env, logKey(c), readLog, (cur) => ({ value: { ...cur, [key]: [...(cur[key] ?? []), { id: Date.now().toString(36), at: today(), text }].slice(-60) } }));
      return r.ok ? json({ ok: true, log: r.value[key] ?? [] }) : json({ error: r.error }, 409);
    }
    case "deleteLog": {
      if (!(await owned(b.vendorId))) return json({ error: "Not found." }, 404);
      const key = String(Number(b.vendorId));
      const r = await updateBlob(env, logKey(c), readLog, (cur) => ({ value: { ...cur, [key]: (cur[key] ?? []).filter((e) => e.id !== String(b.id)) } }));
      return r.ok ? json({ ok: true, log: r.value[key] ?? [] }) : json({ error: r.error }, 409);
    }
    case "readSheet": {
      const mime = txt(b.mime, 40);
      const data = typeof b.data === "string" ? b.data : "";
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(mime) || !data) return json({ error: "Choose a PDF or a photo of the price sheet." }, 400);
      if (data.length > 5_500_000) return json({ error: "That file is too large. Use a file under 4 MB, or one page at a time." }, 400);
      const co = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(c).first<{ id: number; plan: string; createdAt?: string }>();
      const used = await consume(env, co!, "receipt_read");
      if (!used.allowed) return json({ error: "You have used this month's document reads. You can still type prices in.", code: used.reason }, 429);
      const out = await visionAsk(env, { system: SHEET_PROMPT, user: "Read this price sheet.", mime, data, maxTokens: 6000 });
      if (!out.ok) {
        await refund(env, co!, "receipt_read");
        return json({ error: `${friendlyVisionError(out.why, "Reading price sheets")} You can type prices in instead.` }, 502);
      }
      const j = parseJsonLoose(out.text) ?? {};
      const lines = (Array.isArray(j.lines) ? j.lines : []).map((l: any) => cleanPrice({ ...l, effectiveOn: j.effectiveOn })).filter(Boolean).slice(0, 150);
      if (!lines.length) {
        await refund(env, co!, "receipt_read");
        return json({ error: "I could not find prices on that sheet. Try a clearer photo, or type the prices in." }, 422);
      }
      return json({ vendor: txt(j.vendor, 80), effectiveOn: /^\d{4}-\d{2}-\d{2}$/.test(String(j.effectiveOn)) ? j.effectiveOn : "", lines });
    }
    case "prefs": {
      await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(`vendorprefs:${c}`, JSON.stringify({ optOut: b.optOut === true })).run();
      return json({ ok: true });
    }
  }
  return json({ error: "Unknown action." }, 400);
}

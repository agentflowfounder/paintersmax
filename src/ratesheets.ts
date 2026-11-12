import { getSessionUser, randomToken, sha256Hex } from "./auth.ts";
import { htmlToPdf } from "./pdf.ts";
import { catalogItems, roundPrice } from "./ratecatalog.ts";
import { loadRateDocParts, renderRateCardHtml, todayText, type RateSection } from "./ratecardpdf.ts";
import { normalizePlan, type Plan } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Builder rate sheets: one private, editable copy of the painter's builder rates per builder (or general contractor).
 * Some builders want more detail than others, so each sheet has its own price adjustment, hidden lines, overrides, detail level and sections.
 * Stored in app_settings (no migration): rsheet:<companyId>:<id> holds the sheet; rsheet_tok:<hash of token> points back to it.
 * Basic plans get 1 sheet, Pro unlimited. The link is random and can be replaced; only a hash is used to look it up.
 */

export const SHEET_LIMIT: Record<Plan, number> = { free: 0, starter: 0, basic: 1, pro: Number.POSITIVE_INFINITY };
export const DETAILS = ["summary", "standard", "detailed"] as const;
export type Detail = (typeof DETAILS)[number];

export interface Sheet {
  id: string;
  token: string;
  name: string;
  detail: Detail;
  adjustPct: number;
  overrides: Record<string, number>;
  hidden: string[];
  sections: { terms: boolean; insurance: boolean; warranty: boolean };
  terms: string;
  note: string;
  validDays: number;
  preparedWith: "default" | "off";
  createdAt: string;
}

const PUBLIC_BASE = "https://paintersmax.app";
const sheetKey = (co: number, id: string) => `rsheet:${co}:${id}`;
const tokKey = (hash: string) => `rsheet_tok:${hash}`;

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const builderIds = () => new Set(catalogItems("builder").map((i) => i.id));

/** Keeps only valid, size-limited values. Unknown keys are dropped. */
export function cleanSheet(input: any, base?: Partial<Sheet>): Omit<Sheet, "id" | "token" | "createdAt"> {
  const ids = builderIds();
  const adj = Number(input?.adjustPct);
  const days = Math.round(Number(input?.validDays));
  const overrides: Record<string, number> = {};
  if (input?.overrides && typeof input.overrides === "object") {
    for (const [k, v] of Object.entries(input.overrides as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (ids.has(k) && Number.isFinite(n) && n > 0 && n <= 1_000_000) overrides[k] = n;
    }
  }
  const hidden = Array.isArray(input?.hidden) ? Array.from(new Set(input.hidden.filter((k: unknown) => typeof k === "string" && ids.has(k)))).slice(0, 100) as string[] : [];
  const sec = input?.sections ?? {};
  return {
    name: str(input?.name, 80) || base?.name || "Builder",
    detail: (DETAILS as readonly string[]).includes(input?.detail) ? input.detail : base?.detail ?? "standard",
    adjustPct: Number.isFinite(adj) ? Math.max(-30, Math.min(30, Math.round(adj * 10) / 10)) : base?.adjustPct ?? 0,
    overrides,
    hidden,
    sections: { terms: sec.terms !== false, insurance: sec.insurance === true, warranty: sec.warranty === true },
    terms: str(input?.terms, 1500),
    note: str(input?.note, 1000),
    validDays: Number.isFinite(days) && days >= 1 && days <= 365 ? days : base?.validDays ?? 30,
    preparedWith: input?.preparedWith === "off" ? "off" : "default",
  };
}

/** What this builder sees: the builder card's prices with the sheet's adjustment, overrides and hidden lines applied. */
export function sheetSections(cardData: Record<string, any>, sheet: Pick<Sheet, "adjustPct" | "overrides" | "hidden" | "detail">): RateSection[] {
  const groups: RateSection["groups"] = [];
  for (const it of catalogItems("builder")) {
    if (sheet.hidden.includes(it.id)) continue;
    const base = cardData?.[it.id];
    const price = sheet.overrides[it.id] ?? (typeof base === "number" && base > 0 ? roundPrice(base * (1 + sheet.adjustPct / 100)) : 0);
    if (!(price > 0)) continue;
    let g = groups.find((x) => x.name === it.group);
    if (!g) groups.push((g = { name: it.group, rows: [] }));
    g.rows.push({ label: it.label, unit: it.unit, price, note: sheet.detail === "detailed" ? it.note : "" });
  }
  return groups.length ? [{ title: "Builder rates", groups }] : [];
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  return (await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
}
async function putSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, value).run();
}
const parse = (s: string | null): any => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

export async function listSheets(env: Env, companyId: number): Promise<Sheet[]> {
  const { results } = await env.DB.prepare("SELECT value FROM app_settings WHERE key LIKE ? ORDER BY key").bind(`rsheet:${companyId}:%`).all<{ value: string }>();
  return (results ?? []).map((r) => parse(r.value)).filter((s): s is Sheet => !!s?.id);
}

const link = (token: string) => `${PUBLIC_BASE}/rates/${token}`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** GET lists sheets. POST {action: save|delete|reset}. Painter only. */
export async function handleRateSheets(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const co = await env.DB.prepare("SELECT plan FROM companies WHERE id = ?").bind(user.companyId).first<{ plan: string }>();
  const plan = normalizePlan(co?.plan);
  const limit = SHEET_LIMIT[plan];

  if (request.method === "GET") {
    const sheets = await listSheets(env, user.companyId);
    const card = await env.DB.prepare("SELECT data FROM rate_cards WHERE company_id = ? AND audience = 'builder' AND method = 'catalog'").bind(user.companyId).first<{ data: string }>();
    return json({
      plan,
      limit: Number.isFinite(limit) ? limit : null,
      hasBuilderCard: !!card,
      base: parse(card?.data ?? null) ?? {},
      items: catalogItems("builder"),
      sheets: sheets.map((s) => ({ ...s, link: link(s.token), token: undefined })),
    });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const id = typeof b?.id === "string" && /^[a-f0-9]{10}$/.test(b.id) ? b.id : "";

  if (b?.action === "save") {
    if (limit === 0) return json({ error: "Builder rate sheets are on the Basic and Pro plans." }, 403);
    const sheets = await listSheets(env, user.companyId);
    const existing = id ? sheets.find((s) => s.id === id) : undefined;
    if (id && !existing) return json({ error: "Sheet not found." }, 404);
    if (!existing && sheets.length >= limit) return json({ error: `Your plan includes ${limit} builder rate sheet${limit === 1 ? "" : "s"}. Pro has unlimited.` }, 403);
    const clean = cleanSheet(b.sheet, existing);
    if (existing) {
      const next: Sheet = { ...existing, ...clean };
      await putSetting(env, sheetKey(user.companyId, existing.id), JSON.stringify(next));
      return json({ ok: true, id: existing.id });
    }
    const newId = randomToken().slice(0, 10);
    const token = randomToken();
    const sheet: Sheet = { ...clean, id: newId, token, createdAt: new Date().toISOString() };
    await putSetting(env, sheetKey(user.companyId, newId), JSON.stringify(sheet));
    await putSetting(env, tokKey(await sha256Hex(token)), `${user.companyId}:${newId}`);
    return json({ ok: true, id: newId });
  }
  const existing = id ? (await listSheets(env, user.companyId)).find((s) => s.id === id) : undefined;
  if (!existing) return json({ error: "Sheet not found." }, 404);
  if (b?.action === "delete") {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(tokKey(await sha256Hex(existing.token))).run();
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(sheetKey(user.companyId, existing.id)).run();
    return json({ ok: true });
  }
  if (b?.action === "reset") {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(tokKey(await sha256Hex(existing.token))).run();
    const token = randomToken();
    await putSetting(env, sheetKey(user.companyId, existing.id), JSON.stringify({ ...existing, token }));
    await putSetting(env, tokKey(await sha256Hex(token)), `${user.companyId}:${existing.id}`);
    return json({ ok: true, link: link(token) });
  }
  return json({ error: "Unknown action." }, 400);
}

const notFound = () =>
  new Response("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Link not valid</title><body style='font:16px system-ui;padding:40px;max-width:520px;margin:auto'><h1>This link is not valid</h1><p>It may have been replaced. Please ask the contractor for a new link.</p>", { status: 404, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", "cache-control": "no-store" } });

/** GET /rates/<token> shows the sheet; /rates/<token>.pdf gives a PDF when PDF rendering is available. Public, unlisted, noindex. */
export async function handleRateSheetPage(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method !== "GET") return new Response("Not found", { status: 404 });
  const m = /^\/rates\/([A-Za-z0-9]{20,100})(\.pdf)?$/.exec(pathname);
  if (!m) return notFound();
  const ref = await getSetting(env, tokKey(await sha256Hex(m[1])));
  const [coStr, id] = (ref ?? "").split(":");
  const companyId = Number(coStr);
  if (!Number.isInteger(companyId) || !id) return notFound();
  const sheet = parse(await getSetting(env, sheetKey(companyId, id))) as Sheet | null;
  if (!sheet || sheet.token !== m[1]) return notFound();
  const parts = await loadRateDocParts(env, companyId, "builder");
  if (!parts) return notFound();
  const card = parts.cards.find((c) => c.audience === "builder" && c.method === "catalog");
  const sections = sheetSections(card?.data ?? {}, sheet);
  const ins = parts.profile.insurance ?? {};
  const blocks: { title: string; text: string }[] = [];
  if (sheet.terms && sheet.sections.terms) blocks.push({ title: "Terms", text: sheet.terms });
  if (sheet.sections.insurance && ins.shareSummary) blocks.push({ title: "Insurance", text: [ins.carrier, ins.coverage].filter(Boolean).join(", ") || "Insured. Proof available on request." });
  if (sheet.sections.warranty && parts.profile.warranty?.laborMonths) blocks.push({ title: "Warranty", text: `${parts.profile.warranty.laborMonths} months on labor.` });
  const html = renderRateCardHtml(
    {
      ...parts.ctx,
      preparedWith: sheet.preparedWith === "off" ? false : parts.ctx.preparedWith,
      title: `Rates for ${sheet.name}`,
      subtitle: `Valid for ${sheet.validDays} days from this date`,
      date: todayText(),
      intro: sheet.note || undefined,
      blocks,
    },
    sections,
  );
  const headers = { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };
  if (m[2]) {
    const pdf = await htmlToPdf(env, html);
    if (pdf) return new Response(pdf, { headers: { ...headers, "content-type": "application/pdf", "content-disposition": 'inline; filename="rates.pdf"' } });
  }
  return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

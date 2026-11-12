import { getSessionUser } from "./auth.ts";
import { htmlToPdf } from "./pdf.ts";
import { catalogItems, catalogKeyFor, POSITIONS } from "./ratecatalog.ts";
import { escapeHtml, readSettings } from "./settings.ts";
import type { Env } from "./types.ts";

/** A printable rate card: the painter's own price list with their logo. Used for the painter's PDF now and builder sheets next. */

export interface RateRow {
  label: string;
  unit: string;
  price: number;
  note: string;
}
export interface RateSection {
  title: string;
  level?: string;
  groups: { name: string; rows: RateRow[] }[];
}

const TRADE_TITLES: Record<string, string> = {
  interior: "Interior painting",
  exterior: "Exterior painting",
  commercial: "Commercial",
  power_washing: "Power washing",
  cabinets: "Cabinet painting",
  decks_fences: "Decks, patios and fence staining",
  epoxy_floors: "Epoxy floors",
  builder: "Builder rates",
};

export interface CardRow {
  trade: string;
  audience: string;
  method: string;
  data: Record<string, any>;
}

/** Turns saved rate cards into printable sections. Only catalog cards, and only items the painter priced. */
export function buildSections(cards: CardRow[], audience: "retail" | "builder"): RateSection[] {
  const out: RateSection[] = [];
  for (const c of cards) {
    if (c.audience !== audience || c.method !== "catalog") continue;
    const key = catalogKeyFor(c.trade, c.audience);
    if (!key) continue;
    const groups: RateSection["groups"] = [];
    for (const it of catalogItems(key)) {
      const price = c.data?.[it.id];
      if (typeof price !== "number" || !(price > 0)) continue;
      let g = groups.find((x) => x.name === it.group);
      if (!g) groups.push((g = { name: it.group, rows: [] }));
      g.rows.push({ label: it.label, unit: it.unit, price, note: it.note });
    }
    if (!groups.length) continue;
    const pos = typeof c.data?.position === "number" ? POSITIONS[c.data.position] : undefined;
    out.push({ title: TRADE_TITLES[key] ?? key, level: pos, groups });
  }
  return out;
}

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export interface RateDocContext {
  company: { name: string; phone?: string; email?: string; address?: string; license?: string; website?: string };
  brandColor?: string;
  logoUrl?: string;
  title: string; // for example "Rate card" or "Rates for ABC Homes"
  subtitle?: string;
  date: string;
  preparedWith: boolean;
  intro?: string;
  footerNote?: string;
  blocks?: { title: string; text: string }[];
}

export function renderRateCardHtml(ctx: RateDocContext, sections: RateSection[]): string {
  const x = escapeHtml;
  const color = /^#[0-9a-fA-F]{6}$/.test(ctx.brandColor ?? "") ? ctx.brandColor! : "#1F3A5F";
  const logo = ctx.logoUrl && /^https:\/\/[^\s"'<>]+$/.test(ctx.logoUrl) ? `<img src="${x(ctx.logoUrl)}" alt="" style="max-height:56px;max-width:180px">` : "";
  const contact = [ctx.company.phone, ctx.company.email, ctx.company.address, ctx.company.website].filter(Boolean).map((v) => x(String(v))).join(" &middot; ");
  const body = sections
    .map(
      (s) => `<h2>${x(s.title)}</h2>` +
        s.groups
          .map(
            (g) => `<table><thead><tr><th>${x(g.name)}</th><th class="r">Unit</th><th class="r">Price</th></tr></thead><tbody>${g.rows
              .map((r) => `<tr><td>${x(r.label)}${r.note ? `<div class="n">${x(r.note)}</div>` : ""}</td><td class="r">${x(r.unit)}</td><td class="r">${fmt(r.price)}</td></tr>`)
              .join("")}</tbody></table>`,
          )
          .join(""),
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${x(ctx.title)} - ${x(ctx.company.name)}</title>
<style>
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1c;margin:0;background:#f4f4f2}
.page{max-width:780px;margin:0 auto;background:#fff;padding:40px 44px}
h1{margin:0;font-size:28px;color:${color}}h2{margin:26px 0 0;font-size:19px;color:${color}}
.head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:3px solid ${color};padding-bottom:14px}
.muted{color:#666;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:10px;page-break-inside:auto}tr{page-break-inside:avoid}
th{background:${color};color:#fff;text-align:left;padding:7px 8px;font-size:12.5px}
td{padding:7px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top}.r{text-align:right;white-space:nowrap}
.n{color:#666;font-size:12px;margin-top:2px}
.foot{margin-top:28px;color:#555;font-size:12.5px}
.bar{max-width:780px;margin:14px auto;text-align:right}.bar button{padding:10px 18px;font-size:15px;border:0;border-radius:8px;background:${color};color:#fff;cursor:pointer}
@media print{body{background:#fff}.page{padding:0;max-width:none}.bar{display:none}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<div class="page">
<div class="head"><div>${logo}<h1>${x(ctx.title)}</h1><div class="muted">${x(ctx.company.name)}${contact ? "<br>" + contact : ""}${ctx.company.license ? `<br>License: ${x(ctx.company.license)}` : ""}</div></div>
<div class="muted" style="text-align:right">${x(ctx.date)}${ctx.subtitle ? `<br>${x(ctx.subtitle)}` : ""}</div></div>
${ctx.intro ? `<p>${x(ctx.intro)}</p>` : ""}
${body || "<p>No prices yet.</p>"}
${(ctx.blocks ?? []).map((b) => `<h2>${x(b.title)}</h2><p style="white-space:pre-wrap">${x(b.text)}</p>`).join("")}
<div class="foot">${x(ctx.footerNote ?? "Prices are estimates and are subject to site inspection and changes in scope.")}${ctx.preparedWith ? "<br>Prepared with PaintersMax." : ""}</div>
</div></body></html>`;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const parse = (s: unknown): any => {
  try {
    return typeof s === "string" ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

/** Everything a rate card document needs for one company. */
export async function loadRateDocParts(env: Env, companyId: number, audience: "retail" | "builder") {
  const co = await env.DB.prepare("SELECT name, settings FROM companies WHERE id = ?").bind(companyId).first<{ name: string; settings: string | null }>();
  if (!co) return null;
  const prof = parse((await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(companyId).first<{ data: string }>())?.data);
  const rows = await env.DB.prepare("SELECT trade, audience, method, data FROM rate_cards WHERE company_id = ?").bind(companyId).all<{ trade: string; audience: string; method: string; data: string }>();
  const cards: CardRow[] = rows.results.map((r) => ({ trade: r.trade, audience: r.audience, method: r.method, data: parse(r.data) }));
  const s = readSettings(co.settings);
  const c = prof.company ?? {};
  return {
    cards,
    profile: prof,
    sections: buildSections(cards, audience),
    ctx: {
      company: { name: co.name, phone: c.phone, email: c.email, address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(", "), license: c.license, website: c.website },
      brandColor: s.brandColor,
      logoUrl: s.logoUrl,
      preparedWith: prof.ratecard?.hidePreparedWith !== true,
    },
  };
}

export const todayText = () => new Date().toISOString().slice(0, 10);

/** GET /api/ratecard/doc?audience=retail|builder&format=pdf|html : the painter's own rate card. */
export async function handleRateCardDoc(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "GET") return json({ error: "Not found." }, 404);
  const u = new URL(request.url);
  const audience = u.searchParams.get("audience") === "builder" ? "builder" : "retail";
  const parts = await loadRateDocParts(env, user.companyId, audience);
  if (!parts) return json({ error: "Not found." }, 404);
  if (!parts.sections.length) return json({ error: "Set your prices first, then download your rate card." }, 400);
  const html = renderRateCardHtml({ ...parts.ctx, title: audience === "builder" ? "Builder rate card" : "Rate card", date: todayText() }, parts.sections);
  if (u.searchParams.get("format") !== "html") {
    const pdf = await htmlToPdf(env, html);
    if (pdf) return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="rate-card.pdf"', "cache-control": "no-store", "x-robots-tag": "noindex" } });
  }
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}


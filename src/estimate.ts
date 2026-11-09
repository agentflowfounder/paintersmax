import { escapeHtml } from "./settings.ts";

/** One priced row on an estimate. Money is kept in whole cents so totals never drift. */
export interface EstimateLine {
  description: string;
  qty: number;
  unit: string;
  unitCents: number;
}

export interface EstimateInput {
  lines: EstimateLine[];
  scope: string;
  notes: string;
  taxPct: number;
  discountCents: number;
  validDays: number;
  language: "en" | "es";
}

export interface Totals {
  subtotalCents: number;
  minimumTopUpCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const num = (v: unknown, min: number, max: number, fallback = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Keeps only valid, size-limited values from the browser. */
export function sanitizeEstimate(input: any): EstimateInput {
  const rawLines = Array.isArray(input?.lines) ? input.lines.slice(0, 80) : [];
  const lines: EstimateLine[] = [];
  for (const l of rawLines) {
    const description = str(l?.description, 200);
    if (!description) continue;
    lines.push({
      description,
      qty: Math.round(num(l?.qty, 0, 1_000_000, 1) * 100) / 100,
      unit: str(l?.unit, 20) || "ea",
      unitCents: Math.round(num(l?.unitPrice, 0, 10_000_000, 0) * 100),
    });
  }
  return {
    lines,
    scope: str(input?.scope, 3000),
    notes: str(input?.notes, 3000),
    taxPct: num(input?.taxPct, 0, 30, 0),
    discountCents: Math.round(num(input?.discount, 0, 10_000_000, 0) * 100),
    validDays: Math.round(num(input?.validDays, 1, 365, 30)),
    language: input?.language === "es" ? "es" : "en",
  };
}

/** Totals in cents. The minimum job tops the subtotal up; tax applies after the discount; deposit is a share of the total. */
export function computeTotals(
  e: Pick<EstimateInput, "lines" | "taxPct" | "discountCents">,
  opts: { minimumJobCents?: number; depositPct?: number } = {},
): Totals {
  const lineTotal = (l: EstimateLine) => Math.round(l.qty * l.unitCents);
  const subtotalCents = e.lines.reduce((s, l) => s + lineTotal(l), 0);
  const minimumTopUpCents = e.lines.length && opts.minimumJobCents && subtotalCents < opts.minimumJobCents ? opts.minimumJobCents - subtotalCents : 0;
  const base = subtotalCents + minimumTopUpCents;
  const discountCents = Math.min(e.discountCents, base);
  const taxable = base - discountCents;
  const taxCents = Math.round((taxable * e.taxPct) / 100);
  const totalCents = taxable + taxCents;
  const depositCents = opts.depositPct ? Math.round((totalCents * Math.min(100, Math.max(0, opts.depositPct))) / 100) : 0;
  return { subtotalCents, minimumTopUpCents, discountCents, taxCents, totalCents, depositCents };
}

const LABELS: Record<string, string> = {
  small: "Small room",
  medium: "Medium room",
  large: "Large room",
  custom_min: "Custom room",
  ceiling: "Ceiling",
  trim: "Trim and baseboards",
  door_each: "Door",
  accent_wall: "Accent wall",
  repairs_hourly: "Repairs (per hour)",
  base_1_story: "Exterior, 1-story house",
  base_2_story: "Exterior, 2-story house",
  base_3_story: "Exterior, 3-story house",
  door: "Door",
  shutter: "Shutter",
  window: "Window",
  garage_door: "Garage door",
  power_washing: "Power washing",
  wood_repair_hourly: "Wood repair (per hour)",
  color_change: "Extra color",
  gate_each: "Gate",
  removal_per_ft: "Old fence removal",
  stain_per_ft: "Staining or painting",
  mobilization: "Mobilization",
  lift_daily: "Lift or scaffold (per day)",
  hourly: "Labor (per hour)",
};

const UNITS: Record<string, string> = {
  repairs_hourly: "hr",
  wood_repair_hourly: "hr",
  hourly: "hr",
  lift_daily: "day",
  removal_per_ft: "ft",
  stain_per_ft: "ft",
};

/** Percent surcharges are applied by hand on the estimate, so they never become lines. */
const isPct = (k: string) => k.endsWith("_pct");

/**
 * Turns a painter's rate card plus the quantities for this job into editable draft lines.
 * The painter always reviews and changes the draft; nothing here is sent to a customer by itself.
 */
export function draftLines(method: string, data: Record<string, any>, qty: Record<string, number>, trade = ""): EstimateLine[] {
  const out: EstimateLine[] = [];
  const price = (k: string) => (typeof data?.[k] === "number" ? data[k] : 0);
  const add = (description: string, q: number, unit: string, dollars: number) => {
    if (q > 0 && dollars >= 0) out.push({ description, qty: q, unit, unitCents: Math.round(dollars * 100) });
  };
  const q = (k: string) => (Number.isFinite(qty?.[k]) && qty[k] > 0 ? qty[k] : 0);

  if (method === "sqft_floor" || method === "sqft_wall") {
    const mid = price("low") && price("high") ? (price("low") + price("high")) / 2 : price("low") || price("high");
    add(method === "sqft_wall" ? "Painting, per sq ft of wall" : "Painting, per sq ft of floor area", q("sqft"), "sq ft", mid);
  } else if (method === "per_linear_ft") {
    const mid = price("low") && price("high") ? (price("low") + price("high")) / 2 : price("low") || price("high");
    add(trade === "fencing" ? "Fence, installed" : "Work, per linear ft", q("linear_ft"), "ft", mid);
  } else if (method === "lump_sum") {
    // A bid: the painter types the total (cost plus markup) as one line.
    if (q("cost") > 0) add("Project total", 1, "lump sum", q("cost") * (1 + price("markup_pct") / 100));
  }
  for (const k of Object.keys(data ?? {})) {
    if (isPct(k) || !LABELS[k] || !(k in qty)) continue;
    add(LABELS[k], q(k), UNITS[k] ?? "ea", price(k));
  }
  return out;
}

const T = {
  en: { estimate: "Estimate", prepared: "Prepared for", property: "Property", date: "Date", valid: "Valid for", days: "days", scope: "Scope of work", desc: "Description", qty: "Qty", unit: "Unit price", amount: "Amount", subtotal: "Subtotal", minimum: "Minimum job adjustment", discount: "Discount", tax: "Tax", total: "Total", deposit: "Deposit to schedule", notes: "Notes", license: "License", insurance: "Insurance", warranty: "Warranty", accept: "To accept, reply to the email or call us.", months: "months of labor", draft: "ESTIMATE ONLY. Final price may change if the scope changes." },
  es: { estimate: "Presupuesto", prepared: "Preparado para", property: "Propiedad", date: "Fecha", valid: "Válido por", days: "días", scope: "Alcance del trabajo", desc: "Descripción", qty: "Cant.", unit: "Precio unitario", amount: "Importe", subtotal: "Subtotal", minimum: "Ajuste por trabajo mínimo", discount: "Descuento", tax: "Impuesto", total: "Total", deposit: "Depósito para programar", notes: "Notas", license: "Licencia", insurance: "Seguro", warranty: "Garantía", accept: "Para aceptar, responda al correo o llámenos.", months: "meses de garantía en mano de obra", draft: "SOLO PRESUPUESTO. El precio final puede cambiar si cambia el alcance." },
};

export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface EstimateDocContext {
  company: { name: string; phone?: string; email?: string; address?: string; license?: string; website?: string };
  brandColor?: string;
  logoUrl?: string;
  insuranceLine?: string;
  warrantyMonths?: number;
  customer: { name: string; email?: string | null; phone?: string | null };
  property?: string;
  jobTitle: string;
  date: string;
}

/** A clean, printable page. The browser's Print dialog saves it as a PDF. Every value is escaped. */
export function renderEstimateHtml(ctx: EstimateDocContext, e: EstimateInput, t: Totals): string {
  const x = escapeHtml;
  const L = T[e.language];
  const color = /^#[0-9a-fA-F]{6}$/.test(ctx.brandColor ?? "") ? ctx.brandColor! : "#1F3A5F";
  const logo = ctx.logoUrl && /^https:\/\/[^\s"'<>]+$/.test(ctx.logoUrl) ? `<img src="${x(ctx.logoUrl)}" alt="" style="max-height:56px;max-width:180px">` : "";
  const rows = e.lines
    .map(
      (l) =>
        `<tr><td>${x(l.description)}</td><td class="r">${x(String(l.qty))} ${x(l.unit)}</td><td class="r">${money(l.unitCents)}</td><td class="r">${money(Math.round(l.qty * l.unitCents))}</td></tr>`,
    )
    .join("");
  const sum = (label: string, cents: number, strong = false) =>
    cents ? `<tr class="${strong ? "tot" : ""}"><td colspan="3" class="r">${x(label)}</td><td class="r">${money(cents)}</td></tr>` : "";
  const contact = [ctx.company.phone, ctx.company.email, ctx.company.address, ctx.company.website].filter(Boolean).map((v) => x(String(v))).join(" &middot; ");
  return `<!doctype html><html lang="${e.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${x(L.estimate)} - ${x(ctx.company.name)}</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1c;margin:0;background:#f4f4f2}
.page{max-width:780px;margin:0 auto;background:#fff;padding:40px 44px}
h1{margin:0;font-size:28px;color:${color}}
.head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:3px solid ${color};padding-bottom:14px}
.muted{color:#666;font-size:13px}
.grid{display:flex;gap:30px;margin:18px 0;flex-wrap:wrap}.grid>div{flex:1;min-width:200px}
table{width:100%;border-collapse:collapse;margin-top:10px}th{background:${color};color:#fff;text-align:left;padding:8px;font-size:13px}
td{padding:8px;border-bottom:1px solid #e5e5e5;vertical-align:top}.r{text-align:right;white-space:nowrap}
.tot td{font-weight:700;font-size:17px;border-top:2px solid ${color}}
.box{background:#f7f7f5;border-radius:8px;padding:12px 14px;margin-top:16px;white-space:pre-wrap}
.bar{max-width:780px;margin:14px auto;text-align:right}.bar button{padding:10px 18px;font-size:15px;border:0;border-radius:8px;background:${color};color:#fff;cursor:pointer}
@media print{body{background:#fff}.page{padding:0;max-width:none}.bar{display:none}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<div class="page">
<div class="head"><div>${logo}<h1>${x(L.estimate)}</h1><div class="muted">${x(ctx.company.name)}${contact ? "<br>" + contact : ""}${ctx.company.license ? `<br>${x(L.license)}: ${x(ctx.company.license)}` : ""}</div></div>
<div class="muted" style="text-align:right">${x(L.date)}: ${x(ctx.date)}<br>${x(L.valid)} ${e.validDays} ${x(L.days)}</div></div>
<div class="grid"><div><b>${x(L.prepared)}</b><br>${x(ctx.customer.name)}${ctx.customer.email ? "<br>" + x(ctx.customer.email) : ""}${ctx.customer.phone ? "<br>" + x(ctx.customer.phone) : ""}</div>
<div><b>${x(L.property)}</b><br>${x(ctx.property || "-")}<br><span class="muted">${x(ctx.jobTitle)}</span></div></div>
${e.scope ? `<b>${x(L.scope)}</b><div class="box">${x(e.scope)}</div>` : ""}
<table><thead><tr><th>${x(L.desc)}</th><th class="r">${x(L.qty)}</th><th class="r">${x(L.unit)}</th><th class="r">${x(L.amount)}</th></tr></thead><tbody>${rows}
${sum(L.subtotal, t.subtotalCents)}${sum(L.minimum, t.minimumTopUpCents)}${t.discountCents ? `<tr><td colspan="3" class="r">${x(L.discount)}</td><td class="r">-${money(t.discountCents)}</td></tr>` : ""}${sum(`${L.tax} (${e.taxPct}%)`, t.taxCents)}
${sum(L.total, t.totalCents, true)}${t.depositCents ? `<tr><td colspan="3" class="r">${x(L.deposit)}</td><td class="r">${money(t.depositCents)}</td></tr>` : ""}</tbody></table>
${e.notes ? `<b style="display:block;margin-top:16px">${x(L.notes)}</b><div class="box">${x(e.notes)}</div>` : ""}
<p class="muted" style="margin-top:20px">${ctx.insuranceLine ? `${x(L.insurance)}: ${x(ctx.insuranceLine)}<br>` : ""}${ctx.warrantyMonths ? `${x(L.warranty)}: ${ctx.warrantyMonths} ${x(L.months)}<br>` : ""}${x(L.accept)}<br>${x(L.draft)}</p>
</div></body></html>`;
}

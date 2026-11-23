import { escapeHtml } from "./settings.ts";

/** One priced row on an estimate. Money is kept in whole cents so totals never drift. */
export interface EstimateLine {
  description: string;
  qty: number;
  unit: string;
  unitCents: number;
  /** Which part of the job the line belongs to. Lines are printed in sections with their own subtotal. */
  section?: Section;
}

/** Estimate sections, printed in this order. "paint" is the default for a line without one. */
export const SECTIONS = ["drywall", "paint", "trim", "other"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_NAMES: Record<"en" | "es", Record<Section, string>> = {
  en: { drywall: "Drywall installation, repair and texture", paint: "Surface prep, priming and painting", trim: "Trim, doors and cabinets", other: "Other work" },
  es: { drywall: "Instalación, reparación y textura de tablaroca", paint: "Preparación, imprimación y pintura", trim: "Molduras, puertas y gabinetes", other: "Otros trabajos" },
};
const isSection = (v: unknown): v is Section => typeof v === "string" && (SECTIONS as readonly string[]).includes(v);

export interface EstimateInput {
  lines: EstimateLine[];
  scope: string;
  notes: string;
  taxPct: number;
  discountCents: number;
  validDays: number;
  language: "en" | "es";
  /** One short statement per entry. Printed on the estimate and carried into the contract. */
  inclusions: string[];
  exclusions: string[];
  assumptions: string[];
  allowances: string[];
  options: string[];
  /** Payment by milestone, for example 30 / 30 / 30 / 10. Empty means "deposit, then balance". */
  schedule: Milestone[];
  /** The painter's private cost build-up for a lump-sum bid. Never printed for the customer. */
  costBuild: { items: { label: string; amount: number }[]; markupPct: number };
  /** Sections the customer may add or leave out (an add-on bid). Printed with their own price, not counted in the total. */
  optionalSections?: Section[];
  /** Revision count (1 = first version) and the words printed beside the title. The painter can change or clear the words. */
  revision?: number;
  revisionLabel?: string;
  /** Print the contract terms on the estimate so one signature covers both. */
  includeTerms?: boolean;
  /** Colors chosen with the customer, printed on the estimate. */
  colors?: { where: string; brand: string; code: string; name: string }[];
}

export interface Milestone {
  label: string;
  pct: number;
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
      ...(isSection(l?.section) && l.section !== "paint" ? { section: l.section } : {}),
    });
  }
  const list = (v: unknown): string[] => {
    const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : [];
    return raw.map((x) => str(x, 300)).filter(Boolean).slice(0, 30);
  };
  const schedule: Milestone[] = [];
  for (const m of Array.isArray(input?.schedule) ? input.schedule.slice(0, 12) : []) {
    const label = str(m?.label, 100);
    if (label) schedule.push({ label, pct: Math.round(num(m?.pct, 0, 100, 0) * 100) / 100 });
  }
  const items: { label: string; amount: number }[] = [];
  for (const c of Array.isArray(input?.costBuild?.items) ? input.costBuild.items.slice(0, 40) : []) {
    const label = str(c?.label, 100);
    if (label) items.push({ label, amount: Math.round(num(c?.amount, 0, 100_000_000, 0) * 100) / 100 });
  }
  return {
    lines,
    scope: str(input?.scope, 3000),
    notes: str(input?.notes, 3000),
    taxPct: num(input?.taxPct, 0, 30, 0),
    discountCents: Math.round(num(input?.discount, 0, 10_000_000, 0) * 100),
    validDays: Math.round(num(input?.validDays, 1, 365, 30)),
    language: input?.language === "es" ? "es" : "en",
    inclusions: list(input?.inclusions),
    exclusions: list(input?.exclusions),
    assumptions: list(input?.assumptions),
    allowances: list(input?.allowances),
    options: list(input?.options),
    schedule,
    costBuild: { items, markupPct: num(input?.costBuild?.markupPct, 0, 500, 0) },
    optionalSections: (Array.isArray(input?.optionalSections) ? input.optionalSections : []).filter(isSection).filter((v: Section, i: number, a: Section[]) => a.indexOf(v) === i),
    revision: Math.round(num(input?.revision, 1, 999, 1)),
    revisionLabel: str(input?.revisionLabel, 40),
    includeTerms: input?.includeTerms === true,
    colors: (Array.isArray(input?.colors) ? input.colors.slice(0, 30) : [])
      .map((c: any) => ({ where: str(c?.where, 80), brand: str(c?.brand, 40), code: str(c?.code, 30), name: str(c?.name, 60) }))
      .filter((c: { where: string; code: string; name: string }) => c.where || c.code || c.name),
  };
}

/** A sensible section for a line from its words, for lines the painter or the helper did not place. */
export function guessSection(description: string): Section {
  const d = description.toLowerCase();
  if (/drywall|sheetrock|texture|tape and mud|mud and tape|tablaroca|textura/.test(d)) return "drywall";
  if (/\btrim\b|baseboard|door|cabinet|crown|casing|molding|moulding|shutter|moldura|puerta|gabinete|z[oó]calo/.test(d)) return "trim";
  return "paint";
}

export const sectionOf = (l: EstimateLine): Section => l.section ?? "paint";
/** True when the line is in a section the customer may leave out. */
export const isOptionalLine = (l: EstimateLine, optional: Section[] | undefined) => !!optional?.length && optional.includes(sectionOf(l));
/** Each optional section with its own price (before tax), in print order. */
export function optionalTotals(e: Pick<EstimateInput, "lines" | "optionalSections">): { section: Section; cents: number }[] {
  return SECTIONS.filter((s) => e.optionalSections?.includes(s))
    .map((section) => ({ section, cents: e.lines.filter((l) => sectionOf(l) === section).reduce((t, l) => t + Math.round(l.qty * l.unitCents), 0) }))
    .filter((x) => x.cents > 0);
}

/** Milestone percentages must add up to 100 (or there is no schedule at all). */
export const scheduleIsValid = (schedule: Milestone[]) => !schedule.length || Math.abs(schedule.reduce((s, m) => s + m.pct, 0) - 100) < 0.01;

/** Dollar amount of each milestone in cents. The last one absorbs rounding so the amounts always add up to the total. */
export function milestoneAmounts(totalCents: number, schedule: Milestone[]): number[] {
  const out = schedule.map((m) => Math.round((totalCents * m.pct) / 100));
  if (out.length) out[out.length - 1] += totalCents - out.reduce((s, v) => s + v, 0);
  return out;
}

/** Totals in cents. The minimum job tops the subtotal up; tax applies after the discount; deposit is a share of the total. */
export function computeTotals(
  e: Pick<EstimateInput, "lines" | "taxPct" | "discountCents"> & { schedule?: Milestone[]; optionalSections?: Section[] },
  opts: { minimumJobCents?: number; depositPct?: number } = {},
): Totals {
  const lineTotal = (l: EstimateLine) => Math.round(l.qty * l.unitCents);
  // Optional (add-on) sections are priced on their own and never counted in the total until the painter makes them part of the job.
  const subtotalCents = e.lines.filter((l) => !isOptionalLine(l, e.optionalSections)).reduce((s, l) => s + lineTotal(l), 0);
  const minimumTopUpCents = e.lines.length && opts.minimumJobCents && subtotalCents < opts.minimumJobCents ? opts.minimumJobCents - subtotalCents : 0;
  const base = subtotalCents + minimumTopUpCents;
  const discountCents = Math.min(e.discountCents, base);
  const taxable = base - discountCents;
  const taxCents = Math.round((taxable * e.taxPct) / 100);
  const totalCents = taxable + taxCents;
  // With a milestone schedule, the first payment is the deposit.
  const first = e.schedule?.length ? milestoneAmounts(totalCents, e.schedule)[0] : null;
  const depositCents = first !== null ? first : opts.depositPct ? Math.round((totalCents * Math.min(100, Math.max(0, opts.depositPct))) / 100) : 0;
  return { subtotalCents, minimumTopUpCents, discountCents, taxCents, totalCents, depositCents };
}

import { catalogItem } from "./ratecatalog.ts";

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

/** The quantities a painter can enter for a price list: the base measure, then every priced item. Used to tell the AI which keys exist. */
export function quantityOptions(method: string, data: Record<string, any>): { key: string; label: string; unit: string }[] {
  const out: { key: string; label: string; unit: string }[] = [];
  if (method === "sqft_floor") out.push({ key: "sqft", label: "Square feet of floor area", unit: "sq ft" });
  else if (method === "sqft_wall") out.push({ key: "sqft", label: "Square feet of wall", unit: "sq ft" });
  else if (method === "per_linear_ft") out.push({ key: "linear_ft", label: "Linear feet", unit: "ft" });
  for (const k of Object.keys(data ?? {})) {
    if (k.endsWith("_pct") || typeof data[k] !== "number" || !(data[k] > 0)) continue;
    const item = LABELS[k] ? undefined : catalogItem(k);
    const label = LABELS[k] ?? item?.label;
    if (!label) continue;
    out.push({ key: k, label, unit: UNITS[k] ?? item?.short ?? "ea" });
  }
  return out.slice(0, 80);
}

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
    if (isPct(k) || !(k in qty)) continue;
    const item = LABELS[k] ? undefined : catalogItem(k);
    const label = LABELS[k] ?? item?.label;
    if (!label) continue;
    add(label, q(k), UNITS[k] ?? item?.short ?? "ea", price(k));
  }
  return out;
}

const T = {
  en: { estimate: "Estimate", prepared: "Prepared for", property: "Property", date: "Date", valid: "Valid for", days: "days", scope: "Scope of work", desc: "Description", qty: "Qty", unit: "Unit price", amount: "Amount", subtotal: "Subtotal", minimum: "Minimum job adjustment", discount: "Discount", tax: "Tax", total: "Total", deposit: "Deposit to schedule", notes: "Notes", license: "License", insurance: "Insurance", proof: "View proof of insurance", warranty: "Warranty", accept: "To accept, reply to the email or call us.", incl: "Included", excl: "Not included", assume: "Assumptions", allow: "Allowances (adjusted to actual cost)", opts: "Options, priced on request", pay: "Payment schedule", milestone: "Milestone", percent: "%", acceptedBy: "Accepted by the owner", nameTitle: "Name and title", signature: "Signature", on: "Date", months: "months of labor", draft: "ESTIMATE ONLY. Final price may change if the scope changes.", optional: "Optional", optionalSum: "Optional add-on, not in the total", sectionSum: "Section subtotal", optionalNote: "Optional add-ons are priced on their own and are not in the total. Tell us which ones you want and we will add them.", colors: "Colors", terms: "Contract terms", termsNote: "Signing this estimate also accepts these terms." },
  es: { estimate: "Presupuesto", prepared: "Preparado para", property: "Propiedad", date: "Fecha", valid: "Válido por", days: "días", scope: "Alcance del trabajo", desc: "Descripción", qty: "Cant.", unit: "Precio unitario", amount: "Importe", subtotal: "Subtotal", minimum: "Ajuste por trabajo mínimo", discount: "Descuento", tax: "Impuesto", total: "Total", deposit: "Depósito para programar", notes: "Notas", license: "Licencia", insurance: "Seguro", proof: "Ver comprobante de seguro", warranty: "Garantía", accept: "Para aceptar, responda al correo o llámenos.", incl: "Incluido", excl: "No incluido", assume: "Supuestos", allow: "Asignaciones (se ajustan al costo real)", opts: "Opciones, precio a solicitud", pay: "Calendario de pagos", milestone: "Hito", percent: "%", acceptedBy: "Aceptado por el propietario", nameTitle: "Nombre y cargo", signature: "Firma", on: "Fecha", months: "meses de garantía en mano de obra", draft: "SOLO PRESUPUESTO. El precio final puede cambiar si cambia el alcance.", optional: "Opcional", optionalSum: "Adicional opcional, no incluido en el total", sectionSum: "Subtotal de la sección", optionalNote: "Los adicionales opcionales tienen su propio precio y no están en el total. Díganos cuáles quiere y los agregamos.", colors: "Colores", terms: "Términos del contrato", termsNote: "Al firmar este presupuesto también acepta estos términos." },
};

export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface EstimateDocContext {
  company: { name: string; phone?: string; email?: string; address?: string; license?: string; website?: string };
  brandColor?: string;
  logoUrl?: string;
  insuranceLine?: string;
  insuranceUrl?: string; // link to the painter's proof-of-insurance page, when they chose to show it
  warrantyMonths?: number;
  customer: { name: string; email?: string | null; phone?: string | null };
  property?: string;
  jobTitle: string;
  date: string;
  /** Contract clauses, printed when the estimate says includeTerms. */
  terms?: { title: string; body: string }[];
}

/** A clean, printable page. The browser's Print dialog saves it as a PDF. Every value is escaped. */
export function renderEstimateHtml(ctx: EstimateDocContext, e: EstimateInput, t: Totals): string {
  const x = escapeHtml;
  const L = T[e.language];
  const color = /^#[0-9a-fA-F]{6}$/.test(ctx.brandColor ?? "") ? ctx.brandColor! : "#1F3A5F";
  const logo = ctx.logoUrl && /^https:\/\/[^\s"'<>]+$/.test(ctx.logoUrl) ? `<img src="${x(ctx.logoUrl)}" alt="" style="max-height:56px;max-width:180px">` : "";
  const row = (l: EstimateLine) =>
    `<tr><td>${x(l.description)}</td><td class="r">${x(String(l.qty))} ${x(l.unit)}</td><td class="r">${money(l.unitCents)}</td><td class="r">${money(Math.round(l.qty * l.unitCents))}</td></tr>`;
  // One section (the usual case) prints as a plain list. Several sections print with a heading and a subtotal each; optional ones say so.
  const used = SECTIONS.filter((sec) => e.lines.some((l) => sectionOf(l) === sec));
  const rows =
    used.length <= 1 && !e.optionalSections?.length
      ? e.lines.map(row).join("")
      : used
          .map((sec) => {
            const ls = e.lines.filter((l) => sectionOf(l) === sec);
            const opt = e.optionalSections?.includes(sec);
            const sub = ls.reduce((t, l) => t + Math.round(l.qty * l.unitCents), 0);
            return `<tr class="sec"><td colspan="4">${x(SECTION_NAMES[e.language][sec])}${opt ? ` <span class="opt">${x(L.optional)}</span>` : ""}</td></tr>${ls.map(row).join("")}<tr class="secsum"><td colspan="3" class="r">${x(opt ? L.optionalSum : L.sectionSum)}</td><td class="r">${money(sub)}</td></tr>`;
          })
          .join("");
  const rev = e.revisionLabel ? ` <span class="rev">${x(e.revisionLabel)}</span>` : "";
  const colors = e.colors?.length
    ? `<b style="display:block;margin-top:16px">${x(L.colors)}</b><table><tbody>${e.colors.map((c) => `<tr><td>${x(c.where || "-")}</td><td>${x([c.brand, c.code].filter(Boolean).join(" "))}</td><td>${x(c.name)}</td></tr>`).join("")}</tbody></table>`
    : "";
  const terms = e.includeTerms && ctx.terms?.length
    ? `<div style="margin-top:24px;break-before:auto"><b style="display:block;font-size:17px;color:${color}">${x(L.terms)}</b><p class="muted">${x(L.termsNote)}</p>${ctx.terms.map((c, n) => `<p style="margin:10px 0 0"><b>${n + 1}. ${x(c.title)}</b><br><span style="white-space:pre-wrap">${x(c.body)}</span></p>`).join("")}</div>`
    : "";
  const sum = (label: string, cents: number, strong = false) =>
    cents ? `<tr class="${strong ? "tot" : ""}"><td colspan="3" class="r">${x(label)}</td><td class="r">${money(cents)}</td></tr>` : "";
  const contact = [ctx.company.phone, ctx.company.email, ctx.company.address, ctx.company.website].filter(Boolean).map((v) => x(String(v))).join(" &middot; ");
  const bullets = (title: string, items: string[]) => (items.length ? `<b style="display:block;margin-top:16px">${x(title)}</b><ul>${items.map((i) => `<li>${x(i)}</li>`).join("")}</ul>` : "");
  const amounts = milestoneAmounts(t.totalCents, e.schedule);
  const scheduleTable = e.schedule.length
    ? `<b style="display:block;margin-top:16px">${x(L.pay)}</b><table><thead><tr><th>${x(L.milestone)}</th><th class="r">${x(L.percent)}</th><th class="r">${x(L.amount)}</th></tr></thead><tbody>${e.schedule.map((m, n) => `<tr><td>${n + 1}. ${x(m.label)}</td><td class="r">${x(String(m.pct))}%</td><td class="r">${money(amounts[n])}</td></tr>`).join("")}</tbody></table>`
    : "";
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
tr.sec td{font-weight:700;background:#f4f4f2;border-bottom:2px solid ${color}}tr.secsum td{color:#555;font-size:14px}.opt{font-weight:600;font-size:12px;background:#fff3d6;color:#8a5a00;border-radius:99px;padding:2px 8px;margin-left:6px}
.rev{font-size:14px;font-weight:600;color:#555;vertical-align:middle;margin-left:8px}
.box{background:#f7f7f5;border-radius:8px;padding:12px 14px;margin-top:16px;white-space:pre-wrap}
.line{border-bottom:1px solid #333;height:22px;margin-top:22px}
ul{padding-left:20px;margin:4px 0}
.bar{max-width:780px;margin:14px auto;text-align:right}.bar button{padding:10px 18px;font-size:15px;border:0;border-radius:8px;background:${color};color:#fff;cursor:pointer}
@media print{body{background:#fff}.page{padding:0;max-width:none}.bar{display:none}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<div class="page">
<div class="head"><div>${logo}<h1>${x(L.estimate)}${rev}</h1><div class="muted">${x(ctx.company.name)}${contact ? "<br>" + contact : ""}${ctx.company.license ? `<br>${x(L.license)}: ${x(ctx.company.license)}` : ""}</div></div>
<div class="muted" style="text-align:right">${x(L.date)}: ${x(ctx.date)}<br>${x(L.valid)} ${e.validDays} ${x(L.days)}</div></div>
<div class="grid"><div><b>${x(L.prepared)}</b><br>${x(ctx.customer.name)}${ctx.customer.email ? "<br>" + x(ctx.customer.email) : ""}${ctx.customer.phone ? "<br>" + x(ctx.customer.phone) : ""}</div>
<div><b>${x(L.property)}</b><br>${x(ctx.property || "-")}<br><span class="muted">${x(ctx.jobTitle)}</span></div></div>
${e.scope ? `<b>${x(L.scope)}</b><div class="box">${x(e.scope)}</div>` : ""}
<table><thead><tr><th>${x(L.desc)}</th><th class="r">${x(L.qty)}</th><th class="r">${x(L.unit)}</th><th class="r">${x(L.amount)}</th></tr></thead><tbody>${rows}
${sum(L.subtotal, t.subtotalCents)}${sum(L.minimum, t.minimumTopUpCents)}${t.discountCents ? `<tr><td colspan="3" class="r">${x(L.discount)}</td><td class="r">-${money(t.discountCents)}</td></tr>` : ""}${sum(`${L.tax} (${e.taxPct}%)`, t.taxCents)}
${sum(L.total, t.totalCents, true)}${t.depositCents ? `<tr><td colspan="3" class="r">${x(L.deposit)}</td><td class="r">${money(t.depositCents)}</td></tr>` : ""}</tbody></table>
${optionalTotals(e).length ? `<p class="muted">${x(L.optionalNote)}</p>` : ""}${colors}
${bullets(L.incl, e.inclusions)}${bullets(L.excl, e.exclusions)}${bullets(L.assume, e.assumptions)}${bullets(L.allow, e.allowances)}${bullets(L.opts, e.options)}${scheduleTable}
${e.notes ? `<b style="display:block;margin-top:16px">${x(L.notes)}</b><div class="box">${x(e.notes)}</div>` : ""}
${terms}
${e.schedule.length || terms ? `<div style="margin-top:26px;break-inside:avoid"><b>${x(L.acceptedBy)}</b><div style="display:flex;gap:24px;flex-wrap:wrap"><div style="flex:2;min-width:200px"><div class="line"></div><small>${x(L.nameTitle)}</small></div><div style="flex:2;min-width:200px"><div class="line"></div><small>${x(L.signature)}</small></div><div style="flex:1;min-width:120px"><div class="line"></div><small>${x(L.on)}</small></div></div></div>` : ""}
<p class="muted" style="margin-top:20px">${ctx.insuranceLine || ctx.insuranceUrl ? `${x(L.insurance)}: ${x(ctx.insuranceLine ?? "")}${ctx.insuranceUrl ? ` <a href="${x(ctx.insuranceUrl)}">${x(L.proof)}</a>` : ""}<br>` : ""}${ctx.warrantyMonths ? `${x(L.warranty)}: ${ctx.warrantyMonths} ${x(L.months)}<br>` : ""}${x(L.accept)}<br>${x(L.draft)}</p>
</div></body></html>`;
}

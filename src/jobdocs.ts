import { escapeHtml } from "./settings.ts";
import { milestoneAmounts, money, type EstimateInput, type Totals } from "./estimate.ts";

/** Documents that are simple lists. Invoices are separate because they carry money. */
export const LIST_KINDS = ["materials", "schedule", "instructions", "punch", "warranty"] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export const isListKind = (v: unknown): v is ListKind => typeof v === "string" && (LIST_KINDS as readonly string[]).includes(v);

/** Which of these the painter can email straight to the customer. The rest are for the crew. */
export const CUSTOMER_KINDS: readonly string[] = ["schedule", "warranty", "invoice"];

export type ItemGroup = "material" | "rental" | "tool" | "safety";
export const ITEM_GROUPS: ItemGroup[] = ["material", "rental", "tool", "safety"];

export interface Item {
  text: string;
  detail: string;
  qty: number;
  unit: string;
  /** Only the materials list uses groups: things to buy, rent, own and wear. */
  group: ItemGroup;
}
export interface ListDoc {
  language: "en" | "es";
  intro: string;
  items: Item[];
  footer: string;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function sanitizeListDoc(input: any): ListDoc {
  const items: Item[] = [];
  for (const i of Array.isArray(input?.items) ? input.items.slice(0, 120) : []) {
    const text = str(i?.text, 300);
    if (!text) continue;
    const q = Number(i?.qty);
    items.push({ text, detail: str(i?.detail, 300), qty: Number.isFinite(q) && q >= 0 && q <= 1_000_000 ? Math.round(q * 100) / 100 : 0, unit: str(i?.unit, 20), group: (ITEM_GROUPS as string[]).includes(i?.group) ? i.group : "material" });
  }
  return { language: input?.language === "es" ? "es" : "en", intro: str(input?.intro, 2000), items, footer: str(input?.footer, 2000) };
}

type Group = "paint" | "fencing" | "remodel";
export const groupFor = (trade: string): Group => (trade === "fencing" || trade === "decks_fences" ? "fencing" : trade === "remodeling" ? "remodel" : "paint");

type Pair = [string, string]; // [en, es]
const MATERIALS: Record<Group, Array<[string, string, string]>> = {
  // [en, es, unit]
  paint: [["Primer", "Imprimante", "gal"], ["Finish paint", "Pintura de acabado", "gal"], ["Ceiling paint", "Pintura de techo", "gal"], ["Painter's tape", "Cinta de pintor", "rolls"], ["Drop cloths", "Lonas", "ea"], ["Plastic sheeting", "Plástico protector", "rolls"], ["Caulk", "Sellador", "tubes"], ["Patching compound", "Masilla", "tubs"], ["Sandpaper", "Lija", "pk"], ["Roller covers", "Rodillos", "ea"], ["Brushes", "Brochas", "ea"], ["Tray liners", "Forros de bandeja", "ea"]],
  fencing: [["Posts", "Postes", "ea"], ["Rails", "Travesaños", "ea"], ["Pickets", "Tablas", "ea"], ["Concrete mix", "Concreto", "bags"], ["Gravel", "Grava", "bags"], ["Galvanized screws or nails", "Tornillos o clavos galvanizados", "box"], ["Post caps", "Tapas de poste", "ea"], ["Gate hardware", "Herrajes de puerta", "sets"], ["Stain or sealer", "Tinte o sellador", "gal"], ["String line and stakes", "Cuerda y estacas", "set"]],
  remodel: [["Lumber", "Madera", "pcs"], ["Drywall sheets", "Paneles de yeso", "ea"], ["Joint compound", "Compuesto para juntas", "bucket"], ["Screws and fasteners", "Tornillos y sujetadores", "box"], ["Trim", "Molduras", "ft"], ["Adhesive", "Adhesivo", "tubes"], ["Paint and primer", "Pintura e imprimante", "gal"], ["Disposal bags", "Bolsas de desecho", "ea"]],
};

/** Tools to own or bring, rentals to reserve, and protective gear. Quantities stay blank for the painter to fill in. */
const EXTRAS: Record<Group, Array<[ItemGroup, string, string, string]>> = {
  paint: [
    ["tool", "Ladders and extension poles", "Escaleras y extensiones", "set"], ["tool", "Roller frames and paint trays", "Marcos de rodillo y bandejas", "set"], ["tool", "Putty knives and scrapers", "Espátulas y raspadores", "set"],
    ["rental", "Airless sprayer (if spraying)", "Pulverizador airless (si se rocía)", "day"], ["rental", "Scaffold or lift (if needed)", "Andamio o elevador (si se necesita)", "day"],
    ["safety", "Respirator, safety glasses and gloves", "Respirador, lentes y guantes", "per person"], ["safety", "Lead-safe supplies for homes built before 1978", "Insumos seguros contra plomo para casas anteriores a 1978", "kit"],
  ],
  fencing: [
    ["tool", "Impact drivers and spare batteries", "Atornilladores de impacto y baterías de repuesto", "ea"], ["tool", "Levels (4 ft, 2 ft, post level)", "Niveles (4 pies, 2 pies, de poste)", "set"], ["tool", "Tape measures and mason's line", "Cintas métricas y cuerda de albañil", "set"],
    ["tool", "Marking paint and wire flags", "Pintura de marcar y banderas de alambre", "set"], ["tool", "Shovels, post-hole diggers and digging bar", "Palas, cavahoyos y barra", "set"], ["tool", "Circular saws and spare blades", "Sierras circulares y discos de repuesto", "ea"],
    ["tool", "Wheelbarrows, hoses and buckets", "Carretillas, mangueras y cubetas", "set"], ["tool", "Extension cords and a GFCI", "Cables de extensión y GFCI", "set"], ["tool", "Cones, caution tape and jobsite signs", "Conos, cinta de precaución y letreros", "set"],
    ["rental", "Gas auger (2-man) and bits", "Barrena de gasolina (2 personas) y brocas", "unit-day"], ["rental", "Concrete mixer", "Mezcladora de concreto", "wk"], ["rental", "Dumpster", "Contenedor de basura", "ea"],
    ["rental", "Rotary laser level with tripod", "Nivel láser rotativo con trípode", "day"], ["rental", "Chainsaw or pole saw (if clearing)", "Motosierra o podadora de altura (si se despeja)", "day"],
    ["safety", "Hard hats, glasses, hearing protection, gloves and boots", "Cascos, lentes, protección auditiva, guantes y botas", "per person"], ["safety", "High-visibility vests", "Chalecos de alta visibilidad", "per person"], ["safety", "First-aid kit, water and sunscreen", "Botiquín, agua y protector solar", "set"],
  ],
  remodel: [
    ["tool", "Hand and power tools for the trade", "Herramientas manuales y eléctricas del oficio", "set"], ["tool", "Levels, squares and tape measures", "Niveles, escuadras y cintas métricas", "set"],
    ["rental", "Dumpster", "Contenedor de basura", "ea"], ["safety", "Hard hats, glasses, hearing protection, gloves and boots", "Cascos, lentes, protección auditiva, guantes y botas", "per person"], ["safety", "Dust masks or respirators", "Mascarillas o respiradores", "per person"],
  ],
};

const STEPS: Record<Group, Pair[]> = {
  paint: [
    ["Walk the job with the customer and note anything to protect.", "Recorra el trabajo con el cliente y anote lo que hay que proteger."],
    ["Move or cover furniture and floors. Tape off trim, windows and fixtures.", "Mueva o cubra muebles y pisos. Ponga cinta en molduras, ventanas y accesorios."],
    ["Fill holes and cracks, sand smooth, caulk gaps, and spot-prime repairs.", "Rellene huecos y grietas, lije, selle las uniones y aplique imprimante en las reparaciones."],
    ["Cut in edges first, then roll the walls. Keep a wet edge.", "Pinte primero los bordes y luego ruede las paredes. Mantenga el borde húmedo."],
    ["Let the first coat dry fully, then apply the second coat.", "Deje secar bien la primera mano y luego aplique la segunda."],
    ["Paint trim, doors and ceilings last. Pull tape while the paint is slightly tacky.", "Pinte molduras, puertas y techos al final. Quite la cinta cuando la pintura esté apenas pegajosa."],
    ["Touch up, clean the work area, and put everything back.", "Retoque, limpie el área de trabajo y vuelva a poner todo en su lugar."],
    ["Walk through with the customer and fill in the punch list.", "Recorra con el cliente y complete la lista de pendientes."],
  ],
  fencing: [
    ["Confirm the fence line with the customer and mark it with stakes and string.", "Confirme la línea de la cerca con el cliente y márquela con estacas y cuerda."],
    ["Call 811 to have underground utilities marked before any digging.", "Llame al 811 para que marquen los servicios subterráneos antes de excavar."],
    ["Dig post holes to the planned depth and spacing.", "Excave los hoyos de los postes a la profundidad y separación planeadas."],
    ["Set posts plumb in concrete. Let it cure before loading the posts.", "Coloque los postes a plomo en concreto. Deje fraguar antes de cargarlos."],
    ["Fasten the rails, checking level and spacing at every post.", "Fije los travesaños, revisando nivel y separación en cada poste."],
    ["Install pickets with an even gap. Hang and adjust the gates.", "Instale las tablas con separación pareja. Cuelgue y ajuste las puertas."],
    ["Stain or seal if included. Clean up and haul away debris.", "Aplique tinte o sellador si está incluido. Limpie y retire los escombros."],
    ["Walk through with the customer and fill in the punch list.", "Recorra con el cliente y complete la lista de pendientes."],
  ],
  remodel: [
    ["Walk the job with the customer and confirm the scope.", "Recorra el trabajo con el cliente y confirme el alcance."],
    ["Protect floors, furniture and nearby rooms.", "Proteja pisos, muebles y cuartos cercanos."],
    ["Complete demolition and haul away debris.", "Termine la demolición y retire los escombros."],
    ["Do the build work in order: framing, drywall, trim.", "Haga la obra en orden: estructura, paneles de yeso, molduras."],
    ["Prime and paint all new surfaces.", "Aplique imprimante y pintura a todas las superficies nuevas."],
    ["Clean up and put everything back.", "Limpie y vuelva a poner todo en su lugar."],
    ["Walk through with the customer and fill in the punch list.", "Recorra con el cliente y complete la lista de pendientes."],
  ],
};

const PUNCH: Record<Group, Pair[]> = {
  paint: [["Walls: even coverage, no drips or roller marks", "Paredes: cobertura pareja, sin goteos ni marcas de rodillo"], ["Edges and corners are clean and straight", "Bordes y esquinas limpios y rectos"], ["Trim, doors and baseboards finished", "Molduras, puertas y zócalos terminados"], ["Ceilings finished", "Techos terminados"], ["No paint on floors, glass or fixtures", "Sin pintura en pisos, vidrios ni accesorios"], ["Touch-ups done", "Retoques terminados"], ["Furniture back in place and the area is clean", "Muebles en su lugar y el área limpia"], ["Leftover paint labeled and left with the customer", "Pintura sobrante etiquetada y entregada al cliente"]],
  fencing: [["Posts are plumb and solid", "Postes a plomo y firmes"], ["Fence line is straight and at the agreed height", "La línea de la cerca es recta y de la altura acordada"], ["Pickets are even and fastened", "Tablas parejas y fijas"], ["Gates swing, latch and lock properly", "Las puertas abren, cierran y traban bien"], ["Stain or sealer is even (if included)", "Tinte o sellador parejo (si está incluido)"], ["Debris removed and the area is clean", "Escombros retirados y el área limpia"]],
  remodel: [["Work matches the agreed scope", "El trabajo coincide con el alcance acordado"], ["Surfaces are smooth and painted", "Superficies lisas y pintadas"], ["Trim and fittings are tight and level", "Molduras y accesorios firmes y a nivel"], ["Debris removed and the area is clean", "Escombros retirados y el área limpia"]],
};

const SCHEDULE: Record<Group, Pair[]> = {
  paint: [["Prep and protect the work area", "Preparar y proteger el área de trabajo"], ["Patch, sand, caulk and prime", "Reparar, lijar, sellar e imprimar"], ["First coat", "Primera mano"], ["Second coat and trim", "Segunda mano y molduras"], ["Touch-ups, cleanup and walkthrough", "Retoques, limpieza y recorrido final"]],
  fencing: [["Mark the line, call 811, dig post holes", "Marcar la línea, llamar al 811, excavar hoyos"], ["Set posts in concrete", "Colocar postes en concreto"], ["Hang rails", "Colocar travesaños"], ["Install pickets and gates", "Instalar tablas y puertas"], ["Stain or seal, cleanup and walkthrough", "Teñir o sellar, limpieza y recorrido final"]],
  remodel: [["Protect and demolition", "Proteger y demoler"], ["Build work", "Obra"], ["Finish work and paint", "Acabados y pintura"], ["Cleanup and walkthrough", "Limpieza y recorrido final"]],
};

/** Working days from a start date, skipping Sundays. Returns "Mon, Nov 17" style text. */
export function workDates(startIso: string, count: number): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startIso);
  if (!m) return Array(count).fill("");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const out: string[] = [];
  while (out.length < count) {
    if (d.getUTCDay() !== 0) out.push(d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface StarterContext {
  trade: string;
  profile: any;
  company: string;
  customer: string;
  startDate?: string;
  completionDate?: string;
}

/** Starting point for each document. The painter edits everything. */
export function starterDoc(kind: ListKind, c: StarterContext, lang: "en" | "es"): ListDoc {
  const g = groupFor(c.trade);
  const i = lang === "es" ? 1 : 0;
  const mk = (text: string, detail = "", qty = 0, unit = "", group: ItemGroup = "material"): Item => ({ text, detail, qty, unit, group });
  const p = c.profile ?? {};
  if (kind === "materials") {
    const brands: string[] = Array.isArray(p.materials?.brands) ? p.materials.brands : [];
    return {
      language: lang,
      intro: brands.length ? (lang === "es" ? `Marcas preferidas: ${brands.join(", ")}.` : `Preferred brands: ${brands.join(", ")}.`) : "",
      items: [...MATERIALS[g].map(([en, es, unit]) => mk(i ? es : en, "", 0, unit)), ...EXTRAS[g].map(([grp, en, es, unit]) => mk(i ? es : en, "", 0, unit, grp))],
      footer: "",
    };
  }
  if (kind === "instructions") return { language: lang, intro: lang === "es" ? "Instrucciones para el equipo, paso a paso." : "Step-by-step instructions for the crew.", items: STEPS[g].map((s) => mk(s[i])), footer: "" };
  if (kind === "punch") return { language: lang, intro: lang === "es" ? "Marque cada punto con el cliente durante el recorrido final." : "Check each item with the customer during the final walkthrough.", items: PUNCH[g].map((s) => mk(s[i])), footer: "" };
  if (kind === "schedule") {
    const rows = SCHEDULE[g];
    const dates = workDates(c.startDate ?? "", rows.length);
    return { language: lang, intro: lang === "es" ? "Los días pueden cambiar por clima o cambios al trabajo. Le avisaremos." : "Dates can move with weather or changes to the work. We will tell you.", items: rows.map((s, n) => mk(s[i], dates[n])), footer: "" };
  }
  // warranty
  const w = p.warranty ?? {};
  const months = typeof w.laborMonths === "number" && w.laborMonths > 0 ? w.laborMonths : 12;
  const contact = [p.company?.phone, p.company?.email].filter(Boolean).join(" / ");
  const when = c.completionDate || "";
  if (lang === "es") {
    return {
      language: "es",
      intro: `Gracias por elegir ${c.company}. Esta carta confirma la garantía de su trabajo${when ? ` terminado el ${when}` : ""}.`,
      items: [
        mk(w.text || `Garantía de mano de obra: ${months} meses desde la fecha de terminación. Si la pintura que aplicamos se pela o se ampolla por nuestra mano de obra, la arreglamos sin costo.`),
        mk("Garantía del fabricante: los productos que usamos tienen la garantía del fabricante de la pintura."),
        mk("Guarde sus recibos y la información de la pintura que le entregamos. Los necesitará para cualquier reclamo."),
        mk(w.exclusions ? `No cubre: ${w.exclusions}` : "No cubre: daños por accidentes, agua o problemas estructurales, desgaste normal, ni superficies que recomendamos no pintar."),
        mk(`Para hacer un reclamo, contáctenos${contact ? ": " + contact : ""}.`),
      ],
      footer: "",
    };
  }
  return {
    language: "en",
    intro: `Thank you for choosing ${c.company}. This letter confirms the warranty on your work${when ? `, finished on ${when}` : ""}.`,
    items: [
      mk(w.text || `Labor warranty: ${months} months from the completion date. If paint we applied peels or blisters because of our workmanship, we will fix it at no charge.`),
      mk("Manufacturer warranty: the products we used carry the paint maker's own product warranty."),
      mk("Please keep your receipts and the paint information we gave you. You will need them for any claim."),
      mk(w.exclusions ? `Not covered: ${w.exclusions}` : "Not covered: damage from accidents, water or structural problems, normal wear, or surfaces we advised against painting."),
      mk(`To make a claim, contact us${contact ? ": " + contact : ""}.`),
    ],
    footer: "",
  };
}

const TITLES: Record<string, Record<"en" | "es", string>> = {
  materials: { en: "Materials List", es: "Lista de Materiales" },
  schedule: { en: "Job Schedule", es: "Calendario del Trabajo" },
  instructions: { en: "Crew Instructions", es: "Instrucciones para el Equipo" },
  punch: { en: "Punch List", es: "Lista de Pendientes" },
  warranty: { en: "Warranty Letter", es: "Carta de Garantía" },
  invoice: { en: "Invoice", es: "Factura" },
};
export const docTitle = (kind: string, lang: "en" | "es") => TITLES[kind]?.[lang] ?? kind;

export interface DocContext {
  company: { name: string; phone?: string; email?: string; address?: string };
  brandColor?: string;
  customerName: string;
  property?: string;
  jobTitle: string;
  date: string;
}

const SHELL_CSS = (color: string) => `
body{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1c;margin:0;background:#f4f4f2}
.page{max-width:780px;margin:0 auto;background:#fff;padding:40px 44px}
h1{margin:0;font-size:28px;color:${color}}
.head{border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:14px}.muted{color:#666;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:8px}th{background:${color};color:#fff;text-align:left;padding:8px;font-size:13px}
td{padding:9px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top}.r{text-align:right;white-space:nowrap}
.tot td{font-weight:700;border-top:2px solid ${color}}
ol,ul{padding-left:22px}li{margin:8px 0}.box{display:inline-block;width:16px;height:16px;border:2px solid #333;border-radius:3px;vertical-align:middle;margin-right:8px}
.line{border-bottom:1px solid #333;height:22px;margin-top:22px}
.bar{max-width:780px;margin:14px auto;text-align:right}.bar button{padding:10px 18px;font-size:15px;border:0;border-radius:8px;background:${color};color:#fff;cursor:pointer}
@media print{body{background:#fff}.page{padding:0;max-width:none}.bar{display:none}.sigs{break-inside:avoid}}`;

const colorOf = (c?: string) => (/^#[0-9a-fA-F]{6}$/.test(c ?? "") ? c! : "#1F3A5F");

function shell(ctx: DocContext, lang: "en" | "es", title: string, body: string): string {
  const x = escapeHtml;
  const contact = [ctx.company.phone, ctx.company.email, ctx.company.address].filter(Boolean).map((v) => x(String(v))).join(" &middot; ");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${x(title)} - ${x(ctx.company.name)}</title><style>${SHELL_CSS(colorOf(ctx.brandColor))}</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<div class="page"><div class="head"><h1>${x(title)}</h1><div class="muted">${x(ctx.company.name)}${contact ? "<br>" + contact : ""}<br>${x(ctx.customerName)}${ctx.property ? " &middot; " + x(ctx.property) : ""} &middot; ${x(ctx.jobTitle)} &middot; ${x(ctx.date)}</div></div>${body}</div></body></html>`;
}

/** Printable list document. Every value is escaped. */
export function renderListDocHtml(kind: ListKind, ctx: DocContext, d: ListDoc): string {
  const x = escapeHtml;
  const es = d.language === "es";
  const intro = d.intro ? `<p>${x(d.intro)}</p>` : "";
  let body = "";
  if (kind === "materials") {
    const heads: Record<ItemGroup, [string, string]> = { material: ["Materials to buy", "Materiales por comprar"], rental: ["Rentals to reserve", "Alquileres por reservar"], tool: ["Tools to own or bring", "Herramientas propias o por llevar"], safety: ["Safety gear and supplies", "Equipo de seguridad"] };
    body = ITEM_GROUPS.map((g) => {
      const rows = d.items.filter((i) => i.group === g);
      if (!rows.length) return "";
      return `<h3 style="margin:18px 0 0">${x(heads[g][es ? 1 : 0])}</h3><table><thead><tr><th>${es ? "Artículo" : "Item"}</th><th class="r">${es ? "Cant." : "Qty"}</th><th>${es ? "Notas" : "Notes"}</th></tr></thead><tbody>${rows
        .map((i) => `<tr><td>${x(i.text)}</td><td class="r">${i.qty ? x(String(i.qty)) + " " + x(i.unit) : x(i.unit) || "&nbsp;"}</td><td>${x(i.detail)}</td></tr>`)
        .join("")}</tbody></table>`;
    }).join("");
  } else if (kind === "schedule") {
    body = `<table><thead><tr><th>${es ? "Día" : "When"}</th><th>${es ? "Trabajo" : "Work"}</th></tr></thead><tbody>${d.items.map((i, n) => `<tr><td style="white-space:nowrap">${x(i.detail || (es ? "Día " : "Day ") + (n + 1))}</td><td>${x(i.text)}</td></tr>`).join("")}</tbody></table>`;
  } else if (kind === "instructions") {
    body = `<ol>${d.items.map((i) => `<li>${x(i.text)}${i.detail ? `<br><span class="muted">${x(i.detail)}</span>` : ""}</li>`).join("")}</ol>`;
  } else if (kind === "punch") {
    body = `<table><thead><tr><th>${es ? "Punto" : "Item"}</th><th>${es ? "Notas" : "Notes"}</th></tr></thead><tbody>${d.items.map((i) => `<tr><td><span class="box"></span>${x(i.text)}</td><td>${x(i.detail) || "&nbsp;"}</td></tr>`).join("")}</tbody></table>
<div class="sigs" style="margin-top:28px;display:flex;gap:30px;flex-wrap:wrap"><div style="flex:1;min-width:220px"><div class="line"></div><small>${es ? "Firma del cliente" : "Customer signature"}</small></div><div style="flex:1;min-width:140px"><div class="line"></div><small>${es ? "Fecha" : "Date"}</small></div></div>`;
  } else {
    body = `<ul>${d.items.map((i) => `<li>${x(i.text)}</li>`).join("")}</ul><div class="sigs" style="margin-top:30px"><div class="line" style="max-width:300px"></div><small>${x(ctx.company.name)}</small></div>`;
  }
  return shell(ctx, d.language, docTitle(kind, d.language), intro + body + (d.footer ? `<p class="muted">${x(d.footer)}</p>` : ""));
}

export interface InvoiceInput {
  number: string;
  dueDate: string;
  paidCents: number;
  notes: string;
  language: "en" | "es";
  /** Which payment on the estimate's milestone schedule this invoice bills (0 = first). Null bills the whole job. */
  milestone: number | null;
}

export function sanitizeInvoice(input: any): InvoiceInput {
  const paid = Number(input?.paid);
  return {
    number: str(input?.number, 30),
    dueDate: str(input?.dueDate, 40),
    paidCents: Number.isFinite(paid) && paid >= 0 && paid <= 10_000_000 ? Math.round(paid * 100) : 0,
    notes: str(input?.notes, 2000),
    language: input?.language === "es" ? "es" : "en",
    milestone: Number.isInteger(Number(input?.milestone)) && input?.milestone !== null && input?.milestone !== "" && Number(input.milestone) >= 0 && Number(input.milestone) < 12 ? Number(input.milestone) : null,
  };
}

/** Printable invoice: the agreed price, what was already paid, and the balance due. */
export function renderInvoiceHtml(ctx: DocContext, inv: InvoiceInput, est: EstimateInput, t: Totals): string {
  const x = escapeHtml;
  const es = inv.language === "es";
  const amounts = milestoneAmounts(t.totalCents, est.schedule);
  const ms = inv.milestone !== null && inv.milestone < est.schedule.length ? inv.milestone : null;
  const balance = ms !== null ? amounts[ms] : Math.max(0, t.totalCents - inv.paidCents);
  const rows = est.lines
    .map((l) => `<tr><td>${x(l.description)}</td><td class="r">${x(String(l.qty))} ${x(l.unit)}</td><td class="r">${money(l.unitCents)}</td><td class="r">${money(Math.round(l.qty * l.unitCents))}</td></tr>`)
    .join("");
  const signed = (c: number) => (c < 0 ? `-${money(-c)}` : money(c));
  const sum = (label: string, cents: number, cls = "") => `<tr class="${cls}"><td colspan="3" class="r">${x(label)}</td><td class="r">${signed(cents)}</td></tr>`;
  const meta = `<p class="muted">${inv.number ? `${es ? "Factura n.º" : "Invoice no."} ${x(inv.number)} &middot; ` : ""}${inv.dueDate ? `${es ? "Vence" : "Due"}: ${x(inv.dueDate)}` : ""}</p>`;
  if (ms !== null) {
    const m = est.schedule[ms];
    const remaining = Math.max(0, t.totalCents - inv.paidCents - amounts[ms]);
    const msBody = `${meta}<table><thead><tr><th>${es ? "Descripción" : "Description"}</th><th class="r">${es ? "Importe" : "Amount"}</th></tr></thead><tbody>
<tr><td>${es ? "Pago" : "Payment"} ${ms + 1} ${es ? "de" : "of"} ${est.schedule.length}: ${x(m.label)} (${x(String(m.pct))}%)</td><td class="r">${money(amounts[ms])}</td></tr>
<tr><td class="r">${es ? "Precio total del contrato" : "Contract total"}</td><td class="r">${money(t.totalCents)}</td></tr>
<tr><td class="r">${es ? "Pagado hasta ahora" : "Paid to date"}</td><td class="r">${money(inv.paidCents)}</td></tr>
<tr><td class="r">${es ? "Restante después de este pago" : "Remaining after this payment"}</td><td class="r">${money(remaining)}</td></tr>
<tr class="tot"><td class="r">${es ? "Importe a pagar ahora" : "Amount due now"}</td><td class="r">${money(amounts[ms])}</td></tr></tbody></table>${inv.notes ? `<p style="white-space:pre-wrap">${x(inv.notes)}</p>` : ""}<p class="muted">${es ? "Gracias por su preferencia." : "Thank you for your business."}</p>`;
    return shell(ctx, inv.language, docTitle("invoice", inv.language), msBody);
  }
  const body = `${meta}<table><thead><tr><th>${es ? "Descripción" : "Description"}</th><th class="r">${es ? "Cant." : "Qty"}</th><th class="r">${es ? "Precio unitario" : "Unit price"}</th><th class="r">${es ? "Importe" : "Amount"}</th></tr></thead><tbody>${rows}
${t.discountCents ? sum(es ? "Descuento" : "Discount", -t.discountCents) : ""}${t.taxCents ? sum(es ? "Impuesto" : "Tax", t.taxCents) : ""}${sum(es ? "Total" : "Total", t.totalCents)}${inv.paidCents ? sum(es ? "Pagado" : "Already paid", -inv.paidCents) : ""}${sum(es ? "Saldo a pagar" : "Balance due", balance, "tot")}</tbody></table>${inv.notes ? `<p style="white-space:pre-wrap">${x(inv.notes)}</p>` : ""}<p class="muted">${es ? "Gracias por su preferencia." : "Thank you for your business."}</p>`;
  return shell(ctx, inv.language, docTitle("invoice", inv.language), body);
}

export interface InvoiceCheckInput {
  estimateSigned: boolean;
  customerEmail: string | null | undefined;
  changeOrders: number;
  hasPunchList: boolean;
  totalCents: number;
  paidCents: number;
  /** Amount this invoice bills, in cents (whole job or one milestone). */
  billCents: number;
}

/** Plain-language things to look at before sending an invoice. They never block; the painter decides. Money is checked in code, never by AI. */
export function invoiceChecks(i: InvoiceCheckInput): string[] {
  const out: string[] = [];
  if (!i.estimateSigned) out.push("The estimate has not been signed by the customer.");
  if (!i.customerEmail) out.push("This customer has no email address, so you can only print the invoice.");
  if (i.changeOrders > 0) out.push(`${i.changeOrders} change order${i.changeOrders === 1 ? " was" : "s were"} logged on this job. Add any extra cost to the invoice notes or estimate, because the price below comes only from the saved estimate.`);
  if (!i.hasPunchList) out.push("No punch list was saved. A completed punch list helps if the customer questions the work.");
  if (i.totalCents <= 0) out.push("The estimate total is zero.");
  if (i.paidCents > i.totalCents) out.push("The amount already paid is more than the total.");
  else if (i.billCents - i.paidCents <= 0 && i.totalCents > 0) out.push("The balance due is zero or less.");
  return out;
}

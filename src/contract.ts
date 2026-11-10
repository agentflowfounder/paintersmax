import { escapeHtml } from "./settings.ts";
import { milestoneAmounts, money, type EstimateInput, type Totals } from "./estimate.ts";

export interface Clause {
  title: string;
  body: string;
}

export interface ContractInput {
  startDate: string;
  endDate: string;
  clauses: Clause[];
  language: "en" | "es";
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Keeps only valid, size-limited values from the browser. */
export function sanitizeContract(input: any): ContractInput {
  const clauses: Clause[] = [];
  for (const c of Array.isArray(input?.clauses) ? input.clauses.slice(0, 20) : []) {
    const title = str(c?.title, 100);
    const body = str(c?.body, 3000);
    if (title && body) clauses.push({ title, body });
  }
  return {
    startDate: str(input?.startDate, 40),
    endDate: str(input?.endDate, 40),
    clauses,
    language: input?.language === "es" ? "es" : "en",
  };
}

export interface ClauseContext {
  company: string;
  customer: string;
  property: string;
  scope: string;
  totals: Totals;
  startDate: string;
  endDate: string;
  profile: any;
  /** The saved estimate: its payment schedule, inclusions, exclusions and assumptions flow into the contract. */
  estimate?: EstimateInput;
}

/**
 * The starting contract: plain-English clauses filled from the estimate and the painter's profile.
 * The painter can edit every clause. It is a template, not legal advice, and is shown with an attorney-review notice.
 */
export function defaultClauses(c: ClauseContext, lang: "en" | "es"): Clause[] {
  const p = c.profile ?? {};
  const w = p.warranty ?? {};
  const months = typeof w.laborMonths === "number" && w.laborMonths > 0 ? w.laborMonths : 12;
  const brands: string[] = Array.isArray(p.materials?.brands) ? p.materials.brands : [];
  const ins = p.insurance ?? {};
  const terms = p.labor?.paymentTerms;
  const t = c.totals;
  const dep = t.depositCents ? money(t.depositCents) : null;
  const when = (en: string, es: string) => (lang === "es" ? es : en);
  const est = c.estimate;
  const priceBody = () => {
    if (est?.schedule.length) {
      const amounts = milestoneAmounts(t.totalCents, est.schedule);
      const rows = est.schedule.map((m, n) => `${n + 1}. ${m.label}: ${money(amounts[n])} (${m.pct}%)`).join("\n");
      return when(
        `The total price is ${money(t.totalCents)}. Payments are due as follows:\n${rows}\n${terms ? "Each invoice is due " + terms + "." : ""}`.trim(),
        `El precio total es ${money(t.totalCents)}. Los pagos vencen así:\n${rows}\n${terms ? "Cada factura vence " + terms + "." : ""}`.trim(),
      );
    }
    return when(
      `The total price is ${money(t.totalCents)}${dep ? `. A deposit of ${dep} is due before work is scheduled` : ""}. The balance is due ${terms || "when the work is finished"}.`,
      `El precio total es ${money(t.totalCents)}${dep ? `. Se requiere un depósito de ${dep} antes de programar el trabajo` : ""}. El saldo vence ${terms || "al terminar el trabajo"}.`,
    );
  };
  const listClause = (en: string, es: string, items: string[] | undefined): Clause[] =>
    items?.length ? [{ title: when(en, es), body: items.map((i) => `- ${i}`).join("\n") }] : [];

  const out: Clause[] = [
    {
      title: when("The parties and the property", "Las partes y la propiedad"),
      body: when(
        `This agreement is between ${c.company} ("Contractor") and ${c.customer} ("Customer") for work at ${c.property || "the property named in the estimate"}.`,
        `Este contrato es entre ${c.company} ("Contratista") y ${c.customer} ("Cliente") para el trabajo en ${c.property || "la propiedad indicada en el presupuesto"}.`,
      ),
    },
    {
      title: when("Scope of work", "Alcance del trabajo"),
      body: c.scope ||
        when("The work is described by the line items in the price table below.", "El trabajo se describe en las partidas de la tabla de precios de abajo."),
    },
    {
      title: when("Price and payment", "Precio y pago"),
      body: priceBody(),
    },
    ...listClause("What is included", "Qué está incluido", est?.inclusions),
    ...listClause("What is not included", "Qué no está incluido", est?.exclusions),
    ...listClause("Assumptions", "Supuestos", est?.assumptions),
    ...listClause("Allowances", "Asignaciones", est?.allowances),
    {
      title: when("Schedule", "Calendario"),
      body: when(
        `Work is expected to start ${c.startDate || "on a date we agree together"} and finish ${c.endDate || "within a reasonable time after it starts"}. Weather, color changes, hidden damage and delays outside our control can move these dates. We will tell you as soon as we know.`,
        `Se espera que el trabajo comience ${c.startDate || "en una fecha que acordemos juntos"} y termine ${c.endDate || "en un plazo razonable después de comenzar"}. El clima, cambios de color, daños ocultos y retrasos fuera de nuestro control pueden mover estas fechas. Le avisaremos en cuanto lo sepamos.`,
      ),
    },
    {
      title: when("Changes to the work", "Cambios al trabajo"),
      body: when(
        "Any change to the work must be agreed in writing before it is done. A change can change the price and the schedule.",
        "Cualquier cambio al trabajo debe acordarse por escrito antes de hacerse. Un cambio puede modificar el precio y el calendario.",
      ),
    },
    {
      title: when("What we need from the Customer", "Lo que necesitamos del Cliente"),
      body: when(
        "Please give us access to the work areas, water and power. Move or let us cover fragile and valuable items. Keep pets away from the work area. Tell us about any hazards we should know about. Choose your colors before the start date.",
        "Por favor denos acceso a las áreas de trabajo, agua y electricidad. Mueva los objetos frágiles y valiosos o permítanos cubrirlos. Mantenga a las mascotas lejos del área de trabajo. Avísenos de cualquier peligro que debamos conocer. Elija sus colores antes de la fecha de inicio.",
      ),
    },
    {
      title: when("Hidden problems", "Problemas ocultos"),
      body: when(
        "If we find hidden damage such as rot, mold or water damage, we will stop and tell you before going on. Homes built before 1978 may contain lead paint, and federal rules apply to disturbing it. Extra work for hidden problems is priced separately and needs your written approval.",
        "Si encontramos daños ocultos como madera podrida, moho o daño por agua, nos detendremos y le avisaremos antes de continuar. Las casas construidas antes de 1978 pueden tener pintura con plomo, y se aplican reglas federales al alterarla. El trabajo extra por problemas ocultos se cotiza aparte y necesita su aprobación por escrito.",
      ),
    },
  ];
  if (brands.length) {
    out.push({
      title: when("Materials", "Materiales"),
      body: when(
        `We plan to use products from: ${brands.join(", ")}. Colors and finishes are as chosen by the Customer.`,
        `Planeamos usar productos de: ${brands.join(", ")}. Los colores y acabados son los elegidos por el Cliente.`,
      ),
    });
  }
  out.push({
    title: when("Warranty", "Garantía"),
    body:
      w.text ||
      when(
        `We stand behind our labor for ${months} months from the day the work is finished. If paint we applied peels or blisters because of our workmanship, we will fix it at no charge. The paint maker's own product warranty also applies. Please keep your receipts and the paint information we give you. ${w.exclusions ? "Not covered: " + w.exclusions : "Not covered: damage from accidents, water or structural problems, normal wear, or surfaces we advised against painting."}`,
        `Respaldamos nuestra mano de obra por ${months} meses desde el día en que termina el trabajo. Si la pintura que aplicamos se pela o se ampolla por nuestra mano de obra, la arreglaremos sin costo. También aplica la garantía del fabricante de la pintura. Por favor guarde sus recibos y la información de la pintura que le damos. ${w.exclusions ? "No cubre: " + w.exclusions : "No cubre: daños por accidentes, problemas de agua o estructurales, desgaste normal, o superficies que recomendamos no pintar."}`,
      ),
  });
  const license = p.company?.license;
  const insText = ins.shareSummary ? [ins.carrier, ins.coverage].filter(Boolean).join(", ") : "";
  if (license || insText) {
    out.push({
      title: when("License and insurance", "Licencia y seguro"),
      body: [license ? when(`License: ${license}.`, `Licencia: ${license}.`) : "", insText ? when(`Insurance: ${insText}.`, `Seguro: ${insText}.`) : ""].filter(Boolean).join(" "),
    });
  }
  out.push(
    {
      title: when("If you need to cancel", "Si necesita cancelar"),
      body: when(
        "Tell us in writing before work starts. We will refund the deposit minus the cost of materials already ordered and the scheduling time already reserved.",
        "Avísenos por escrito antes de que empiece el trabajo. Le devolveremos el depósito menos el costo de los materiales ya pedidos y el tiempo de programación ya reservado.",
      ),
    },
    {
      title: when("If something is not right", "Si algo no está bien"),
      body: when(
        "Call us first. We will make a good-faith effort to fix any covered problem within a reasonable time.",
        "Llámenos primero. Haremos un esfuerzo de buena fe para arreglar cualquier problema cubierto en un plazo razonable.",
      ),
    },
    {
      title: when("Whole agreement", "Acuerdo completo"),
      body: when(
        "This contract and the estimate are the whole agreement. Changes must be in writing and signed by both of us.",
        "Este contrato y el presupuesto son el acuerdo completo. Los cambios deben ser por escrito y firmados por ambos.",
      ),
    },
  );
  return out;
}

const T = {
  en: { title: "Work Agreement", date: "Date", price: "Price", desc: "Description", qty: "Qty", unit: "Unit price", amount: "Amount", total: "Total", deposit: "Deposit", sig: "Signatures", contractor: "Contractor", customer: "Customer", name: "Printed name", signature: "Signature", on: "Date" },
  es: { title: "Contrato de Trabajo", date: "Fecha", price: "Precio", desc: "Descripción", qty: "Cant.", unit: "Precio unitario", amount: "Importe", total: "Total", deposit: "Depósito", sig: "Firmas", contractor: "Contratista", customer: "Cliente", name: "Nombre", signature: "Firma", on: "Fecha" },
};

export interface ContractDocContext {
  company: { name: string; phone?: string; email?: string; address?: string };
  brandColor?: string;
  customerName: string;
  jobTitle: string;
  date: string;
}

/** Printable contract with the price table and two signature blocks. Every value is escaped. */
export function renderContractHtml(ctx: ContractDocContext, c: ContractInput, est: EstimateInput, t: Totals): string {
  const x = escapeHtml;
  const L = T[c.language];
  const color = /^#[0-9a-fA-F]{6}$/.test(ctx.brandColor ?? "") ? ctx.brandColor! : "#1F3A5F";
  const rows = est.lines
    .map((l) => `<tr><td>${x(l.description)}</td><td class="r">${x(String(l.qty))} ${x(l.unit)}</td><td class="r">${money(l.unitCents)}</td><td class="r">${money(Math.round(l.qty * l.unitCents))}</td></tr>`)
    .join("");
  const clauses = c.clauses.map((cl, i) => `<h3>${i + 1}. ${x(cl.title)}</h3><p>${x(cl.body)}</p>`).join("");
  const contact = [ctx.company.phone, ctx.company.email, ctx.company.address].filter(Boolean).map((v) => x(String(v))).join(" &middot; ");
  const sig = (who: string, name: string) =>
    `<div class="sig"><b>${x(who)}</b><br><br><div class="line"></div><small>${x(L.signature)}</small><br><br><div class="line"><span>${x(name)}</span></div><small>${x(L.name)}</small><br><br><div class="line"></div><small>${x(L.on)}</small></div>`;
  return `<!doctype html><html lang="${c.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${x(L.title)} - ${x(ctx.company.name)}</title>
<style>
body{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1c;margin:0;background:#f4f4f2}
.page{max-width:780px;margin:0 auto;background:#fff;padding:40px 44px}
h1{margin:0;font-size:28px;color:${color}}h3{margin:18px 0 2px;font-size:15px;color:${color}}p{margin:2px 0;white-space:pre-wrap}
.head{border-bottom:3px solid ${color};padding-bottom:12px}.muted{color:#666;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:8px}th{background:${color};color:#fff;text-align:left;padding:8px;font-size:13px}
td{padding:8px;border-bottom:1px solid #e5e5e5}.r{text-align:right;white-space:nowrap}.tot td{font-weight:700;border-top:2px solid ${color}}
.sigs{display:flex;gap:40px;margin-top:30px;flex-wrap:wrap}.sig{flex:1;min-width:240px}.line{border-bottom:1px solid #333;height:22px;position:relative}.line span{position:absolute;bottom:2px}
.bar{max-width:780px;margin:14px auto;text-align:right}.bar button{padding:10px 18px;font-size:15px;border:0;border-radius:8px;background:${color};color:#fff;cursor:pointer}
@media print{body{background:#fff}.page{padding:0;max-width:none}.bar{display:none}h3{break-after:avoid}.sigs{break-inside:avoid}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<div class="page"><div class="head"><h1>${x(L.title)}</h1><div class="muted">${x(ctx.company.name)}${contact ? "<br>" + contact : ""}<br>${x(L.date)}: ${x(ctx.date)} &middot; ${x(ctx.customerName)} &middot; ${x(ctx.jobTitle)}</div></div>
${clauses}
<h3>${x(L.price)}</h3><table><thead><tr><th>${x(L.desc)}</th><th class="r">${x(L.qty)}</th><th class="r">${x(L.unit)}</th><th class="r">${x(L.amount)}</th></tr></thead><tbody>${rows}
<tr class="tot"><td colspan="3" class="r">${x(L.total)}</td><td class="r">${money(t.totalCents)}</td></tr>${t.depositCents ? `<tr><td colspan="3" class="r">${x(L.deposit)}</td><td class="r">${money(t.depositCents)}</td></tr>` : ""}</tbody></table>
<h3>${x(L.sig)}</h3><div class="sigs">${sig(L.contractor, ctx.company.name)}${sig(L.customer, ctx.customerName)}</div></div></body></html>`;
}

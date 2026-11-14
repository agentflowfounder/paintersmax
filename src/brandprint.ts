import { qrSvg } from "./qr.ts";

/**
 * Brand kit: printable business cards, fliers and door hangers, plus email templates (see brandemail.ts).
 * Everything is plain HTML the painter prints or saves as a PDF from the browser. No outside service is used, and nothing
 * is claimed that the painter did not type or tick (a license number or "insured" only shows when they entered it).
 */

export interface Brand {
  company: string;
  person: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  license: string;
  tagline: string;
  color: string;
  logoUrl: string;
  /** Where the QR code sends people, usually the painter's quote page. */
  qrUrl: string;
  services: string[];
  area: string;
  /** The painter ticked "we carry insurance". Never assumed. */
  insured: boolean;
  /** Link to their Google review page, used in the thank-you email. */
  reviewUrl: string;
  language: "en" | "es";
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n) : "");
export const HEX = /^#[0-9a-fA-F]{6}$/;
const httpsOrEmpty = (v: unknown, n: number) => {
  const s = str(v, n);
  return /^https:\/\/[^\s"'<>]{3,}$/.test(s) ? s : "";
};

/** Keeps only valid, size-limited values. */
export function cleanBrand(i: any): Brand {
  const services = (Array.isArray(i?.services) ? i.services : typeof i?.services === "string" ? i.services.split(/[\n,]/) : [])
    .map((s: unknown) => str(s, 40))
    .filter(Boolean)
    .slice(0, 8);
  return {
    company: str(i?.company, 80),
    person: str(i?.person, 60),
    title: str(i?.title, 40),
    phone: str(i?.phone, 30),
    email: str(i?.email, 80),
    website: str(i?.website, 80),
    license: str(i?.license, 40),
    tagline: str(i?.tagline, 90),
    color: HEX.test(String(i?.color ?? "")) ? String(i.color) : "#E8A33D",
    logoUrl: httpsOrEmpty(i?.logoUrl, 300),
    qrUrl: httpsOrEmpty(i?.qrUrl, 150),
    services,
    area: str(i?.area, 100),
    insured: i?.insured === true,
    reviewUrl: httpsOrEmpty(i?.reviewUrl, 300),
    language: i?.language === "es" ? "es" : "en",
  };
}

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// ---- color helpers ----
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const toHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
export const INK = "#0F1B2D";
/** Text color that reads on the brand color. */
export const onColor = (c: string) => (contrast(c, "#ffffff") >= contrast(c, INK) ? "#ffffff" : INK);
/** The brand color for use on the dark navy card: if it would nearly vanish there, white is used instead. */
export const accentOnDark = (c: string) => (contrast(c, INK) >= 3 ? c : "#ffffff");
/** The brand color, darkened as much as needed so it reads on white. */
export function readableOnWhite(c: string): string {
  let cur = rgb(c);
  for (let i = 0; i < 12 && contrast(toHex(cur), "#ffffff") < 4.5; i++) cur = [cur[0] * 0.88, cur[1] * 0.88, cur[2] * 0.88];
  return toHex(cur);
}

// ---- words ----
const WORDS = {
  en: { free: "Free estimates", scan: "Scan for a free estimate", lic: "Lic.", insured: "Insured", licIns: "Licensed and insured", call: "Call", serving: "Serving",
    print: "Print or save as PDF",
    sheetHint: "Page 1 has the fronts, page 2 the backs. For two-sided printing, flip on the long edge. Print at 100% (Actual size), not Fit to page.",
    bleedHint: "Two pages: front, then back, each 3.75 x 2.25 in with a 1/8 in bleed. Send this PDF to an online print shop and choose standard 3.5 x 2 in cards.",
    front: "FRONT", back: "BACK" },
  es: { free: "Presupuestos gratis", scan: "Escanee para un presupuesto gratis", lic: "Lic.", insured: "Asegurado", licIns: "Con licencia y asegurado", call: "Llame", serving: "Servimos a",
    print: "Imprimir o guardar como PDF",
    sheetHint: "La página 1 tiene los frentes y la página 2 los reversos. Para imprimir por ambos lados, voltee por el lado largo. Imprima al 100% (Tamaño real), no \"Ajustar a la página\".",
    bleedHint: "Dos páginas: frente y reverso, cada una de 3.75 x 2.25 pulgadas con 1/8 de pulgada de sangrado. Envíe este PDF a una imprenta en línea y elija tarjetas estándar de 3.5 x 2 pulgadas.",
    front: "FRENTE", back: "REVERSO" },
};
export const wordsFor = (b: Brand) => WORDS[b.language];

export function trustLine(b: Brand): string {
  const w = wordsFor(b);
  const lic = b.license ? `${w.lic} #${b.license.replace(/^#/, "")}` : "";
  return [lic, b.insured ? w.insured : ""].filter(Boolean).join(" · ");
}

const ICON = {
  phone: '<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>',
  mail: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7.2L4.5 7v.2L12 12.4 19.5 7.2V7z"/>',
  web: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 9h-3a15.7 15.7 0 0 0-1.2-5.5A8 8 0 0 1 18.9 11zM12 4c.8 1 1.7 3.2 2 7h-4c.3-3.8 1.2-6 2-7zM9.3 5.5A15.7 15.7 0 0 0 8.1 11h-3a8 8 0 0 1 4.2-5.5zM5.1 13h3a15.7 15.7 0 0 0 1.2 5.5A8 8 0 0 1 5.1 13zM12 20c-.8-1-1.7-3.2-2-7h4c-.3 3.8-1.2 6-2 7zm2.7-1.5a15.7 15.7 0 0 0 1.2-5.5h3a8 8 0 0 1-4.2 5.5z"/>',
};
const icon = (name: keyof typeof ICON, color: string) => `<svg class="ic" viewBox="0 0 24 24" width="10" height="10" fill="${color}" aria-hidden="true">${ICON[name]}</svg>`;

export const qrFor = (b: Brand, fallbackUrl: string): string => qrSvg(b.qrUrl || fallbackUrl, { color: INK, background: "#ffffff" }) ?? "";

// ---- business cards ----

export const CARD_DESIGNS = [
  { id: "classic", label: "Classic" },
  { id: "bold", label: "Bold" },
  { id: "clean", label: "Clean" },
  { id: "dark", label: "Dark" },
] as const;
export type CardDesign = (typeof CARD_DESIGNS)[number]["id"];

interface Ctx {
  b: Brand;
  c: string; // brand color
  cInk: string; // brand color that reads on white
  onC: string; // text color that reads on the brand color
  ac: string; // brand color that reads on dark navy
  qr: string;
  w: ReturnType<typeof wordsFor>;
}
interface Face {
  html: string;
  bg: string;
  /** Background for the print-shop page when the design has a band that must run into the bleed. */
  bleedBg?: string;
}

const logoOrName = (ctx: Ctx, cls: string) => (ctx.b.logoUrl ? `<img class="${cls}" src="${esc(ctx.b.logoUrl)}" alt="${esc(ctx.b.company)}">` : `<div class="${cls} word">${esc(ctx.b.company)}</div>`);
const who = (b: Brand) => b.person || b.company;
function contacts(ctx: Ctx, color: string, iconColor: string): string {
  const { b } = ctx;
  const rows: string[] = [];
  if (b.phone) rows.push(`<div>${icon("phone", iconColor)}<span>${esc(b.phone)}</span></div>`);
  if (b.email) rows.push(`<div>${icon("mail", iconColor)}<span>${esc(b.email)}</span></div>`);
  if (b.website) rows.push(`<div>${icon("web", iconColor)}<span>${esc(b.website)}</span></div>`);
  return `<div class="ct" style="color:${color}">${rows.join("")}</div>`;
}
const qrBox = (ctx: Ctx, size: string) => `<div class="qr" style="width:${size};height:${size}">${ctx.qr}</div>`;
const servicesLine = (b: Brand) => (b.services.length ? b.services.slice(0, 3).map(esc).join(" · ") : "");

const FACES: Record<CardDesign, { front: (x: Ctx) => Face; back: (x: Ctx) => Face }> = {
  classic: {
    front: (x) => ({
      bg: "#ffffff",
      bleedBg: `linear-gradient(90deg, ${x.c} 0.325in, #ffffff 0.325in)`,
      html: `<div class="band" style="background:${x.c}"></div><div class="a-main"><div class="a-top"><div><div class="nm">${esc(who(x.b))}</div>${x.b.title ? `<div class="tt" style="color:${x.cInk}">${esc(x.b.title)}</div>` : ""}</div>${x.b.person ? logoOrName(x, "lg") : ""}</div>${contacts(x, INK, x.cInk)}<div class="ft">${esc(trustLine(x.b))}</div></div>`,
    }),
    back: (x) => ({
      bg: x.c,
      html: `<div class="c-back" style="color:${x.onC}"><div class="bn">${esc(x.b.company)}</div>${x.b.tagline ? `<div class="tg">${esc(x.b.tagline)}</div>` : ""}<div class="qrrow">${qrBox(x, "0.82in")}<div class="qt">${esc(x.w.scan)}</div></div><div class="sv">${esc(servicesLine(x.b))}</div></div>`,
    }),
  },
  bold: {
    front: (x) => ({
      bg: x.c,
      html: `<div class="b-front" style="color:${x.onC}"><div class="nm big">${esc(who(x.b))}</div>${x.b.title ? `<div class="tt">${esc(x.b.title)}</div>` : ""}<div class="b-co">${esc(x.b.person ? x.b.company : x.w.free)}</div>${contacts(x, x.onC, x.onC)}<div class="ft">${esc(trustLine(x.b))}</div></div>`,
    }),
    back: (x) => ({
      bg: "#ffffff",
      html: `<div class="b-back">${qrBox(x, "1.2in")}<div class="b-side"><div class="bn" style="color:${x.cInk}">${esc(x.w.free)}</div><div class="sv2">${(x.b.services.length ? x.b.services.slice(0, 5) : [x.b.tagline]).filter(Boolean).map((s) => `<div><i style="background:${x.c}"></i>${esc(s)}</div>`).join("")}</div>${x.b.logoUrl ? `<img class="lg" src="${esc(x.b.logoUrl)}" alt="">` : `<div class="word" style="color:${INK}">${esc(x.b.company)}</div>`}</div></div>`,
    }),
  },
  clean: {
    front: (x) => ({
      bg: "#ffffff",
      html: `<div class="l-front"><div class="l-top">${logoOrName(x, "lg")}</div><div class="rule" style="background:${x.c}"></div><div class="nm c">${esc(who(x.b))}</div>${x.b.title ? `<div class="tt c" style="color:${x.cInk}">${esc(x.b.title)}</div>` : ""}<div class="l-ct">${[x.b.phone, x.b.email, x.b.website].filter(Boolean).map(esc).join("  ·  ")}</div><div class="ft c">${esc(trustLine(x.b))}</div></div>`,
    }),
    back: (x) => ({
      bg: "#ffffff",
      html: `<div class="l-back">${qrBox(x, "0.95in")}<div class="qt c">${esc(x.w.scan)}</div><div class="rule" style="background:${x.c}"></div><div class="sv c">${esc(x.b.tagline || servicesLine(x.b))}</div></div>`,
    }),
  },
  dark: {
    front: (x) => ({
      bg: INK,
      html: `<div class="d-front"><div class="d-top">${x.b.logoUrl ? `<img class="lg inv" src="${esc(x.b.logoUrl)}" alt="">` : `<div class="word" style="color:${x.ac}">${esc(x.b.company)}</div>`}</div><div class="nm" style="color:#fff">${esc(who(x.b))}</div>${x.b.title ? `<div class="tt" style="color:${x.ac}">${esc(x.b.title)}</div>` : ""}${contacts(x, "#ffffffd9", x.ac)}<div class="ft" style="color:#ffffff99">${esc(trustLine(x.b))}</div></div>`,
    }),
    back: (x) => ({
      bg: INK,
      html: `<div class="d-back"><div class="bn" style="color:${x.ac}">${esc(x.b.company)}</div>${x.b.tagline ? `<div class="tg" style="color:#fff">${esc(x.b.tagline)}</div>` : ""}<div class="qrrow">${qrBox(x, "0.82in")}<div class="qt" style="color:#fff">${esc(x.w.scan)}</div></div><div class="sv" style="color:#ffffffb3">${esc(servicesLine(x.b))}</div></div>`,
    }),
  },
};

const CARD_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,"Helvetica Neue",Arial,sans-serif;color:${INK};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.card{width:3.5in;height:2in;position:relative;overflow:hidden;flex:none}
.card>*{position:relative}
.nm{font-family:Georgia,"Times New Roman",serif;font-weight:700;font-size:14pt;line-height:1.1}
.nm.big{font-size:17pt}.nm.c{font-size:13pt;text-align:center}
.tt{font-size:6.5pt;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-top:3px}.tt.c{text-align:center}
.ct{font-size:7.6pt;line-height:1.55}.ct div{display:flex;gap:6px;align-items:center;white-space:nowrap}.ic{flex:none}
.ft{font-size:6pt;letter-spacing:.04em;opacity:.8}.ft.c{text-align:center}
.word{font-family:Georgia,serif;font-weight:700;font-size:9pt;line-height:1.1}
.lg{max-height:.5in;max-width:1.05in;object-fit:contain}.lg.inv{background:#fff;border-radius:3px;padding:2px}
.qr{background:#fff;border-radius:4px;flex:none}.qr svg{display:block;width:100%;height:100%}
.qt{font-size:6.5pt;line-height:1.3;font-weight:600}.qt.c{text-align:center;margin-top:3px}
.bn{font-family:Georgia,serif;font-weight:700;font-size:12pt;line-height:1.1}.tg{font-size:7.4pt;line-height:1.3;opacity:.92;margin-top:3px}
.sv{font-size:6.2pt;letter-spacing:.05em;opacity:.85}.sv.c{text-align:center;margin-top:6px}
.qrrow{display:flex;align-items:center;gap:9px}
/* classic */
.band{position:absolute!important;left:0;top:0;bottom:0;width:.2in}
.a-main{position:absolute!important;inset:0;padding:.16in .18in .12in .36in;display:flex;flex-direction:column;justify-content:space-between}
.a-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.c-back{position:absolute!important;inset:0;padding:.18in .22in;display:flex;flex-direction:column;justify-content:space-between}
/* bold */
.b-front{position:absolute!important;inset:0;padding:.2in .22in .14in;display:flex;flex-direction:column;justify-content:space-between}
.b-front .nm{margin-bottom:0}.b-co{font-size:8pt;font-weight:600;opacity:.95;margin-top:-4px}
.b-back{position:absolute!important;inset:0;padding:.2in .22in;display:flex;align-items:center;gap:.2in}
.b-side{display:flex;flex-direction:column;gap:6px;min-width:0}.sv2{font-size:7.4pt;line-height:1.5}.sv2 div{display:flex;align-items:center;gap:6px}.sv2 i{display:inline-block;width:5px;height:5px;border-radius:50%;flex:none}
.b-side .lg{max-height:.32in}
/* clean */
.l-front{position:absolute!important;inset:0;padding:.14in .2in;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.l-top{height:.4in;display:flex;align-items:center;justify-content:center;margin-bottom:5px}
.rule{height:1.5px;width:.6in;margin:5px auto}
.l-ct{font-size:7.2pt;text-align:center;margin-top:7px;color:#334155}
.l-front .ft{margin-top:4px}
.l-back{position:absolute!important;inset:0;padding:.14in .2in;display:flex;flex-direction:column;align-items:center;justify-content:center}
/* dark */
.d-front{position:absolute!important;inset:0;padding:.17in .2in .12in;display:flex;flex-direction:column;justify-content:space-between}
.d-top{display:flex;justify-content:flex-end}.d-front .nm{margin-top:-6px}
.d-back{position:absolute!important;inset:0;padding:.18in .22in;display:flex;flex-direction:column;justify-content:space-between}
`;

export type CardMode = "preview" | "sheet" | "bleed";
export interface CardOptions {
  design?: string;
  mode?: CardMode;
  /** Light cut lines on plain paper. */
  guides?: boolean;
  /** Address to encode if the painter did not set one. */
  fallbackUrl: string;
}
const pickDesign = (d: unknown): CardDesign => (CARD_DESIGNS.some((x) => x.id === d) ? (d as CardDesign) : "classic");

export function cardFaces(b: Brand, design: unknown, fallbackUrl: string): { front: Face; back: Face; design: CardDesign } {
  const id = pickDesign(design);
  const ctx: Ctx = { b, c: b.color, cInk: readableOnWhite(b.color), onC: onColor(b.color), ac: accentOnDark(b.color), qr: qrFor(b, fallbackUrl), w: wordsFor(b) };
  return { design: id, front: FACES[id].front(ctx), back: FACES[id].back(ctx) };
}

const cardEl = (f: Face) => `<div class="card" style="background:${f.bg}">${f.html}</div>`;

/** A full printable page: "preview" shows one front and back on screen; "sheet" is a Letter page of 10 for each side; "bleed" is one card per page with a 1/8 inch bleed for a print shop. */
export function renderCards(b: Brand, o: CardOptions): string {
  const { front, back } = cardFaces(b, o.design, o.fallbackUrl);
  const mode: CardMode = o.mode === "sheet" || o.mode === "bleed" ? o.mode : "preview";
  const title = esc(`${b.company || "Business"} business cards`);
  let page = "";
  let css = CARD_CSS;
  if (mode === "preview") {
    css += `body{background:#eceae4;padding:14px 0;display:flex;flex-direction:column;align-items:center;gap:14px}.card{box-shadow:0 2px 10px rgba(15,27,45,.25);border-radius:3px}.cap{font:600 11px Inter,Arial,sans-serif;color:#4A5568;margin-bottom:-8px}`;
    page = `<div class="cap">${esc(wordsFor(b).front)}</div>${cardEl(front)}<div class="cap">${esc(wordsFor(b).back)}</div>${cardEl(back)}`;
  } else if (mode === "sheet") {
    const guide = o.guides !== false;
    css += `@page{size:8.5in 11in;margin:0}.sheet{width:8.5in;height:11in;padding:.5in .75in;display:grid;grid-template-columns:repeat(2,3.5in);grid-auto-rows:2in;page-break-after:always;break-after:page}.sheet .card{${guide ? "outline:.4pt dashed #9aa4b2;outline-offset:0" : ""}}
.noprint{padding:10px;background:#0F1B2D;color:#fff;font:14px Inter,Arial,sans-serif;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.noprint button{padding:9px 14px;border:0;border-radius:8px;background:#E8A33D;font-weight:700;cursor:pointer}
@media print{.noprint{display:none}}@media screen{body{background:#eceae4}.sheet{background:#fff;margin:12px auto;box-shadow:0 2px 10px rgba(15,27,45,.2)}}`;
    const grid = (f: Face) => `<div class="sheet">${Array.from({ length: 10 }, () => cardEl(f)).join("")}</div>`;
    page = `<div class="noprint"><button onclick="window.print()">${esc(wordsFor(b).print)}</button><span>${esc(wordsFor(b).sheetHint)}</span></div>${grid(front)}${grid(back)}`;
  } else {
    css += `@page{size:3.75in 2.25in;margin:0}.pg{width:3.75in;height:2.25in;display:flex;align-items:center;justify-content:center;page-break-after:always;break-after:page}.noprint{padding:10px;background:#0F1B2D;color:#fff;font:14px Inter,Arial,sans-serif;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.noprint button{padding:9px 14px;border:0;border-radius:8px;background:#E8A33D;font-weight:700;cursor:pointer}
@media print{.noprint{display:none}}@media screen{body{background:#eceae4}.pg{margin:12px auto;box-shadow:0 2px 10px rgba(15,27,45,.2)}}`;
    page = `<div class="noprint"><button onclick="window.print()">${esc(wordsFor(b).print)}</button><span>${esc(wordsFor(b).bleedHint)}</span></div><div class="pg" style="background:${front.bleedBg ?? front.bg}">${cardEl(front)}</div><div class="pg" style="background:${back.bleedBg ?? back.bg}">${cardEl(back)}</div>`;
  }
  return `<!doctype html><html lang="${b.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>${css}</style></head><body>${page}</body></html>`;
}

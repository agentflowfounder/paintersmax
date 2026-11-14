import { INK, accentOnDark, esc, onColor, qrFor, readableOnWhite, trustLine, wordsFor, type Brand } from "./brandprint.ts";

/**
 * Fliers (Letter, portrait) and door hangers (3.5 x 8.5 in, three to a landscape Letter page).
 * Words come from the painter. Blank fields get a plain starting line, and an offer, a license or "Insured" only prints if they entered it.
 */

export const FLYER_DESIGNS = [
  { id: "bold", label: "Bold" },
  { id: "clean", label: "Clean" },
  { id: "neighborhood", label: "In your neighborhood" },
] as const;
export type FlyerDesign = (typeof FLYER_DESIGNS)[number]["id"];

export const HANGER_DESIGNS = [
  { id: "neighbors", label: "We are painting nearby" },
  { id: "missed", label: "Sorry we missed you" },
  { id: "estimate", label: "Free estimate" },
] as const;
export type HangerDesign = (typeof HANGER_DESIGNS)[number]["id"];

const pick = <T extends { id: string }>(list: readonly T[], id: unknown): T["id"] => (list.some((x) => x.id === id) ? (id as T["id"]) : list[0].id);

interface Words {
  headline: string;
  sub: string;
  cta: string;
  offer: string;
  points: string[];
  services: string[];
  area: string;
}

const L = {
  en: {
    bold: "Give your home a fresh new look",
    clean: "Quality painting for your home",
    nearby: "We are painting in your neighborhood",
    missed: "Sorry we missed you!",
    est: "Let us give you an estimate",
    subNearby: (street: string) => (street ? `We are painting on ${street} right now. Ask us for an estimate while we are in the area.` : "We are working nearby right now. Ask us for an estimate while we are in the area."),
    subMissed: "We stopped by to talk about painting your home. Call or scan the code and we will come to you.",
    cta: (free: boolean) => (free ? "Call or scan for a free estimate" : "Call or scan to request an estimate"),
    whatWeDo: "What we do",
    serving: "Serving",
    why: "Good to know",
  },
  es: {
    bold: "Dele a su casa un aspecto nuevo",
    clean: "Pintura de calidad para su hogar",
    nearby: "Estamos pintando en su vecindario",
    missed: "¡Lamentamos no encontrarle!",
    est: "Permítanos darle un presupuesto",
    subNearby: (street: string) => (street ? `Estamos pintando en ${street} ahora mismo. Pídanos un presupuesto mientras estamos en la zona.` : "Estamos trabajando cerca ahora mismo. Pídanos un presupuesto mientras estamos en la zona."),
    subMissed: "Pasamos a hablar sobre pintar su casa. Llame o escanee el código y vamos a su casa.",
    cta: (free: boolean) => (free ? "Llame o escanee para un presupuesto gratis" : "Llame o escanee para solicitar un presupuesto"),
    whatWeDo: "Lo que hacemos",
    serving: "Servimos a",
    why: "Es bueno saber",
  },
};

function flyerWords(b: Brand, design: string): Words {
  const t = L[b.language];
  const f = b.flyer;
  const services = b.services.length ? b.services : [];
  const headline = f.headline || (design === "neighborhood" || design === "neighbors" ? t.nearby : design === "missed" ? t.missed : design === "estimate" ? t.est : design === "clean" ? t.clean : t.bold);
  const sub = f.sub || (design === "neighborhood" || design === "neighbors" ? t.subNearby(f.street) : design === "missed" ? t.subMissed : services.slice(0, 3).join(" · "));
  return { headline, sub, cta: t.cta(b.freeEstimates), offer: f.offer, points: f.points, services, area: b.area };
}

/** Long headlines get a smaller size so they never push the page past its edge. */
const hsize = (text: string, big: number, mid: number, small: number) => (text.length > 48 ? small : text.length > 30 ? mid : big);

const phoneLine = (b: Brand) => (b.phone ? esc(b.phone) : "");
const reach = (b: Brand) => [b.website, b.email].filter(Boolean).map(esc).join("  &middot;  ");

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,"Helvetica Neue",Arial,sans-serif;color:${INK};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.serif{font-family:Georgia,"Times New Roman",serif}
.qr{background:#fff;flex:none}.qr svg{display:block;width:100%;height:100%}
.lgimg{max-height:.7in;max-width:2.4in;object-fit:contain}
.toolbar{padding:10px;background:#0F1B2D;color:#fff;font:14px Inter,Arial,sans-serif;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.toolbar button{padding:9px 14px;border:0;border-radius:8px;background:#E8A33D;font-weight:700;cursor:pointer}
@media print{.toolbar{display:none}}
@media screen{body{background:#eceae4}}
`;

const wrapDoc = (b: Brand, title: string, css: string, body: string) =>
  `<!doctype html><html lang="${b.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;

const brandName = (b: Brand, color: string) =>
  b.logoUrl ? `<img class="lgimg" src="${esc(b.logoUrl)}" alt="${esc(b.company)}">` : `<div class="serif" style="font-size:20pt;font-weight:700;color:${color}">${esc(b.company)}</div>`;

// ---------------------------------------------------------------- fliers

export type PageMode = "preview" | "print";

function flyerPage(b: Brand, design: FlyerDesign, qr: string): string {
  const w = flyerWords(b, design);
  const c = b.color;
  const onC = onColor(c);
  const cInk = readableOnWhite(c);
  const t = L[b.language];
  const wd = wordsFor(b);
  const trust = trustLine(b);
  const list = (items: string[], dot: string) => items.map((s) => `<li><i style="background:${dot}"></i>${esc(s)}</li>`).join("");
  const offerBox = w.offer ? `<div class="offer" style="border-color:${cInk};color:${INK}">${esc(w.offer)}</div>` : "";
  const contact = `<div class="cta2" style="color:${cInk}">${esc(w.cta)}</div><div class="ph" style="color:${INK}">${phoneLine(b)}</div><div class="rc">${reach(b)}</div>`;
  const qrBlock = `<div class="qrcol"><div class="qr" style="width:1.7in;height:1.7in;border-radius:6px;border:1px solid #d5dbe3">${qr}</div><div class="qc">${esc(wd.scan)}</div></div>`;
  const barParts = [wd.free, trust, w.area ? `${t.serving} ${w.area}` : ""].filter(Boolean);
  const hasPoints = w.points.length > 0;
  const two = !hasPoints && w.services.length > 4 ? "two" : "";
  const shown = w.services.slice(0, hasPoints ? 6 : 8);
  const dense = hasPoints || w.offer || shown.length > 6 ? " dense" : "";
  if (design === "clean") {
    return `<div class="page cl${dense}"><div class="top">${brandName(b, cInk)}</div><div class="rule" style="background:${c}"></div><h1 class="serif" style="font-size:${hsize(w.headline, 42, 36, 31)}pt">${esc(w.headline)}</h1>${w.sub ? `<p class="sub">${esc(w.sub)}</p>` : ""}<div class="cols"><div><h3 style="color:${cInk}">${esc(t.whatWeDo)}</h3><ul class="${two}">${list(shown, c)}</ul></div>${w.points.length ? `<div><h3 style="color:${cInk}">${esc(t.why)}</h3><ul>${list(w.points, c)}</ul></div>` : ""}</div>${offerBox}<div class="foot"><div>${contact}</div>${qrBlock}</div><div class="bar">${esc(barParts.join("   ·   "))}</div></div>`;
  }
  // bold and neighborhood share a layout; neighborhood swaps the words
  return `<div class="page bd${dense}"><div class="band" style="background:${c};color:${onC}"><div class="bn">${b.logoUrl ? `<span class="chipimg"><img class="lgimg" src="${esc(b.logoUrl)}" alt="${esc(b.company)}"></span>` : `<span class="serif">${esc(b.company)}</span>`}</div><h1 class="serif" style="font-size:${hsize(w.headline, 46, 40, 33)}pt">${esc(w.headline)}</h1>${w.sub ? `<p class="sub">${esc(w.sub)}</p>` : ""}</div><div class="body"><div class="cols"><div><h3 style="color:${cInk}">${esc(t.whatWeDo)}</h3><ul class="${two}">${list(shown, c)}</ul></div>${w.points.length ? `<div><h3 style="color:${cInk}">${esc(t.why)}</h3><ul>${list(w.points, c)}</ul></div>` : ""}</div>${offerBox}</div><div class="foot"><div>${contact}</div>${qrBlock}</div><div class="bar">${esc(barParts.join("   ·   "))}</div></div>`;
}

const FLYER_CSS = `
.page{width:8.5in;height:11in;position:relative;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.page h1{line-height:1.05}.page ul{list-style:none}.page li{display:flex;align-items:center;gap:12px;font-size:17pt;line-height:1.3;margin:0 0 9px;break-inside:avoid}.page li i{width:12px;height:12px;border-radius:50%;flex:none}.page ul.two{columns:2;column-gap:.4in}.dense li{font-size:14.5pt;margin:0 0 5px}.dense .offer{font-size:16pt;padding:.14in .2in;margin-top:.2in}
.page h3{font-size:11pt;letter-spacing:.14em;text-transform:uppercase;margin:0 0 10px}
.cols{display:flex;gap:.5in}.cols>div{flex:1;min-width:0}
.offer{border:3px dashed;border-radius:10px;padding:.18in .25in;font:700 19pt/1.2 Georgia,serif;text-align:center;margin-top:.28in}
.foot{display:flex;justify-content:space-between;align-items:flex-end;gap:.3in}
.ph{font:700 34pt/1.05 Georgia,serif}.rc{font-size:13pt;margin-top:6px;color:#334155}.cta2{font:700 15pt Inter,Arial,sans-serif;margin-bottom:6px}
.bar{background:#0F1B2D;color:#fff;padding:.2in .6in;text-align:center;font:600 12pt Inter,Arial,sans-serif;letter-spacing:.02em}
.qrcol{text-align:center;width:1.9in}.qc{font-size:10pt;font-weight:600;margin-top:6px;line-height:1.25}
.bd .band{padding:.55in .6in .5in}.bd .bn{font-size:17pt;font-weight:700;margin-bottom:.35in;display:flex}.bd .chipimg{background:#fff;border-radius:8px;padding:6px 12px;display:inline-block}
.bd .sub{font-size:16pt;margin-top:.2in;line-height:1.35;max-width:6.4in;opacity:.95}
.bd .body{padding:.35in .6in 0;flex:1;display:flex;flex-direction:column;justify-content:center}.bd .foot{padding:.25in .6in .35in}
.cl{padding:.6in .7in .6in}.cl .top{display:flex;justify-content:center;margin-bottom:.2in}.cl .rule{height:4px;width:1.4in;margin:0 auto .35in}
.cl h1{text-align:center}.cl .sub{text-align:center;font-size:15pt;color:#334155;margin:.2in auto .4in;max-width:6in;line-height:1.4}
.cl .cols{flex:1;align-items:center}.cl .foot{border-top:2px solid #e5e1d8;padding-top:.3in;margin-bottom:.25in}.cl{padding-bottom:0}.cl .bar{margin:0 -.7in}
`;

export interface PrintOptions {
  design?: string;
  mode?: PageMode;
  fallbackUrl: string;
}

export function renderFlyer(b: Brand, o: PrintOptions): string {
  const design = pick(FLYER_DESIGNS, o.design) as FlyerDesign;
  const mode: PageMode = o.mode === "print" ? "print" : "preview";
  const page = flyerPage(b, design, qrFor(b, o.fallbackUrl));
  let css = FLYER_CSS;
  let body = page;
  if (mode === "print") {
    css += `@page{size:8.5in 11in;margin:0}@media screen{.page{margin:12px auto;box-shadow:0 2px 10px rgba(15,27,45,.2)}}`;
    body = `<div class="toolbar"><button onclick="window.print()">${esc(wordsFor(b).print)}</button><span>Letter size, one page. Print at 100% (Actual size), not Fit to page.</span></div>${page}`;
  }
  return wrapDoc(b, `${b.company} flier`, css, body);
}

// ---------------------------------------------------------------- door hangers

function hangerFront(b: Brand, design: HangerDesign): string {
  const w = flyerWords(b, design);
  const c = b.color;
  const onC = onColor(c);
  const wd = wordsFor(b);
  return `<div class="hg"><div class="hole"></div><div class="hd" style="background:${c};color:${onC}"><div class="hn serif">${esc(b.company)}</div><h1 class="serif" style="font-size:${hsize(w.headline, 27, 23, 18)}pt">${esc(w.headline)}</h1></div><div class="hb">${w.sub ? `<p class="hs">${esc(w.sub)}</p>` : ""}${w.offer ? `<div class="ho" style="border-color:${readableOnWhite(c)}">${esc(w.offer)}</div>` : ""}</div><div class="hf"><div class="hcta" style="color:${readableOnWhite(c)}">${esc(w.cta)}</div><div class="hph serif">${phoneLine(b)}</div><div class="hr">${reach(b)}</div></div><div class="hbar" style="background:${c}"></div></div>`;
}
function hangerBack(b: Brand, design: HangerDesign, qr: string): string {
  const w = flyerWords(b, design);
  const c = b.color;
  const cInk = readableOnWhite(c);
  const t = L[b.language];
  const wd = wordsFor(b);
  const trust = trustLine(b);
  const items = [...w.points, ...w.services].slice(0, 5);
  return `<div class="hg back"><div class="hole"></div><div class="hdb" style="background:${c}"></div><div class="hb2"><div class="hn2 serif" style="color:${cInk}">${esc(b.company)}</div>${b.tagline ? `<div class="tg">${esc(b.tagline)}</div>` : ""}${items.length ? `<ul>${items.map((x) => `<li><i style="background:${c}"></i>${esc(x)}</li>`).join("")}</ul>` : ""}</div><div class="hf2"><div class="qr" style="width:1.8in;height:1.8in;border:1px solid #d5dbe3;border-radius:6px;margin:0 auto">${qr}</div><div class="qc">${esc(wd.scan)}</div><div class="hph2 serif">${phoneLine(b)}</div>${trust ? `<div class="tr">${esc(trust)}</div>` : ""}${w.area ? `<div class="tr">${esc(t.serving)} ${esc(w.area)}</div>` : ""}</div><div class="hbar" style="background:${c}"></div></div>`;
}

const HANGER_CSS = `
.hg{width:3.5in;height:8.5in;position:relative;overflow:hidden;background:#fff;flex:none;display:flex;flex-direction:column}
.hole{position:absolute;left:50%;top:.55in;width:1.25in;height:1.25in;margin-left:-.625in;border-radius:50%;border:1px dashed #9aa4b2;background:#fff;z-index:3}
.hd{padding:2in .3in .3in;display:flex;flex-direction:column;gap:.1in;flex:none}
.hn{font-size:11pt;font-weight:700;opacity:.95}.hd h1{line-height:1.05}
.hb{padding:.25in .3in 0;flex:1;display:flex;flex-direction:column;justify-content:center;gap:.2in}.hs{font-size:12.5pt;line-height:1.4;color:#1e293b}
.ho{border:2.5px dashed;border-radius:8px;padding:.12in .15in;font:700 14pt/1.2 Georgia,serif;text-align:center}
.hf{padding:.15in .3in .2in;text-align:center;flex:none}.hcta{font:700 12pt Inter,Arial,sans-serif;margin-bottom:5px}
.hph{font-size:26pt;font-weight:700;line-height:1.1}.hr{font-size:9.5pt;color:#334155;margin-top:4px;word-break:break-word}
.hbar{height:.4in;flex:none}
.back .hdb{height:.5in;flex:none}.hb2{padding:1.35in .3in 0;text-align:center;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center}
.hn2{font-size:18pt;font-weight:700;margin-bottom:.06in;line-height:1.1}.tg{font-size:10.5pt;color:#4A5568;margin-bottom:.15in;line-height:1.3}
.hb2 ul{list-style:none;text-align:left}.hb2 li{display:flex;align-items:center;gap:9px;font-size:12.5pt;line-height:1.5}.hb2 li i{width:8px;height:8px;border-radius:50%;flex:none}
.hf2{padding:.1in .3in .2in;text-align:center;flex:none}.hph2{font-size:22pt;font-weight:700;margin-top:.1in}
.qc{font-size:10pt;font-weight:600;margin-top:6px;line-height:1.25}.tr{font-size:9.5pt;color:#4A5568;margin-top:3px}
`;

export function renderHangers(b: Brand, o: PrintOptions & { guides?: boolean }): string {
  const design = pick(HANGER_DESIGNS, o.design) as HangerDesign;
  const mode: PageMode = o.mode === "print" ? "print" : "preview";
  const qr = qrFor(b, o.fallbackUrl);
  const front = hangerFront(b, design);
  const back = hangerBack(b, design, qr);
  let css = HANGER_CSS;
  let body = "";
  if (mode === "preview") {
    css += `body{padding:14px 0;display:flex;gap:18px;justify-content:center;align-items:flex-start}.hg{box-shadow:0 2px 10px rgba(15,27,45,.25)}`;
    body = `<div>${front}</div><div>${back}</div>`;
  } else {
    const guide = o.guides !== false;
    css += `@page{size:11in 8.5in;margin:0}.sheet{width:11in;height:8.5in;display:flex;justify-content:center;gap:0;padding:0 .25in;page-break-after:always;break-after:page;align-items:center}.sheet .hg{${guide ? "outline:.4pt dashed #9aa4b2" : ""}}@media screen{.sheet{background:#fff;margin:12px auto;box-shadow:0 2px 10px rgba(15,27,45,.2)}}`;
    const sheet = (h: string) => `<div class="sheet">${h.repeat(3)}</div>`;
    body = `<div class="toolbar"><button onclick="window.print()">${esc(wordsFor(b).print)}</button><span>Page 1 has the fronts, page 2 the backs (landscape Letter, three hangers per page). Cut out the dashed hole (or punch it with a 1 1/4 in hole punch). For two-sided printing, flip on the short edge. Print at 100% (Actual size).</span></div>${sheet(front)}${sheet(back)}`;
  }
  return wrapDoc(b, `${b.company} door hangers`, css, body);
}

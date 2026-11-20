import { escapeHtml as e } from "./settings.ts";
import { reviewsHtml, type PublicReview } from "./reviews.ts";
import { pathOf, type Block, type Page, type Site } from "./sitecore.ts";

/**
 * Turns a painter's site document into fast, plain HTML: no frameworks, one small inline script for tabs,
 * images lazy-loaded with their sizes set, and the business marked up for Google (schema.org HousePainter).
 */

export interface RenderCtx {
  site: Site;
  page: Page;
  company: { id: number; slug: string; name: string; brandColor?: string; logoUrl?: string };
  origin: string; // https://their-domain.com (canonical base)
  /** Address for a link inside the site. Live: the path itself. Preview: a preview address. */
  link: (path: string) => string;
  quoteHref: string;
  photoSrc: (id: string) => string;
  cityPages: { name: string; state: string; href: string }[];
  insuredProof?: string | null;
  preview?: boolean;
  founding?: boolean;
  reviews?: PublicReview[];
  /** Free door: the whole site is drawn as one page, the menu items are tabs that swap panels (each still has its own address). */
  onePage?: boolean;
  /** Uploaded template pack (classic or bold layouts): dark header and text color, page background, fallback accent. */
  look?: { bold?: boolean; dark?: string; bg?: string; accent?: string };
}

const L = {
  en: { quote: "Free estimate", call: "Call", menu: "Menu", services: "Services", serve: "We also serve", by: "Website by PaintersMax", insured: "Insured", proof: "View proof of insurance", license: "License", hours: "Hours", area: "Service area", reviews: "See our reviews on Google", preview: "Preview. This is your draft; visitors see the published site.", home: "Home", estimate: "Get your free estimate", estimateSub: "Tell us about the job and see a price range in seconds." },
  es: { quote: "Presupuesto gratis", call: "Llamar", menu: "Menú", services: "Servicios", serve: "También servimos", by: "Sitio web por PaintersMax", insured: "Asegurados", proof: "Ver comprobante de seguro", license: "Licencia", hours: "Horario", area: "Área de servicio", reviews: "Vea nuestras reseñas en Google", preview: "Vista previa. Este es su borrador; los visitantes ven el sitio publicado.", home: "Inicio", estimate: "Pida su presupuesto gratis", estimateSub: "Cuéntenos del trabajo y vea un rango de precio en segundos." },
};

/** Paragraphs, and lines starting with "- " as a bulleted list. Everything escaped. */
export function richText(t: string): string {
  return t
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${e(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
      return `<p>${lines.map((l) => e(l)).join("<br>")}</p>`;
    })
    .join("");
}

const tel = (p: string) => p.replace(/[^0-9+]/g, "");

function blockHtml(b: Block, x: RenderCtx, T: (typeof L)["en"]): string {
  const h = b.heading ? `<h2>${e(b.heading)}</h2>` : "";
  if (b.type === "text") return b.body || b.heading ? `<section class="blk">${h}${richText(b.body)}</section>` : "";
  if (b.type === "photos") {
    const list = b.photos.map((id) => x.site.photos.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!list.length) return "";
    return `<section class="blk">${h}<div class="gal">${list.map((p) => `<figure><img loading="lazy" decoding="async" src="${e(x.photoSrc(p.id))}" alt="${e(p.alt || `${x.company.name} painting project`)}"${p.w && p.h ? ` width="${p.w}" height="${p.h}"` : ""}>${p.alt ? `<figcaption>${e(p.alt)}</figcaption>` : ""}</figure>`).join("")}</div></section>`;
  }
  if (b.type === "tabs") {
    if (!b.tabs.length) return "";
    // Every tab's text is in the page (search engines read it all); the script only shows one at a time.
    return `<section class="blk tabs-blk">${h}<div class="tabs" role="tablist">${b.tabs.map((t, i) => `<button type="button" role="tab" id="tb-${e(b.id)}-${i}" aria-controls="tp-${e(b.id)}-${i}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ""}>${e(t.label)}</button>`).join("")}</div>${b.tabs.map((t, i) => `<div class="tp" role="tabpanel" id="tp-${e(b.id)}-${i}" aria-labelledby="tb-${e(b.id)}-${i}"${i ? " hidden" : ""}>${richText(t.body)}</div>`).join("")}</section>`;
  }
  if (b.type === "video") {
    if (!x.site.media?.on) return "";
    return `<section class="blk">${h}<div class="vid vid-${b.orient}"><iframe src="https://www.youtube-nocookie.com/embed/${b.yt}?rel=0&modestbranding=1&playsinline=1" title="${e(b.heading || x.company.name)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${b.caption ? `<p>${e(b.caption)}</p>` : ""}</section>`;
  }
  if (b.type === "weather") return "";
  if (b.type === "reviews") return reviewsHtml(x.reviews ?? [], x.company.name, x.site.lang, b.heading);
  const phone = x.site.business.phone;
  const btn = b.action === "call" && phone ? `<a class="btn" href="tel:${e(tel(phone))}">${e(T.call)} ${e(phone)}</a>` : `<a class="btn" href="${e(x.quoteHref)}">${e(T.quote)}</a>`;
  return `<section class="blk cta">${h}${b.body ? `<p>${e(b.body)}</p>` : ""}${btn}</section>`;
}

export function structuredData(x: RenderCtx): object[] {
  const b = x.site.business;
  const url = x.origin.replace(/\/$/, "") + "/";
  const biz: any = { "@context": "https://schema.org", "@type": "HousePainter", name: x.company.name, url };
  if (b.phone) biz.telephone = b.phone;
  if (b.email) biz.email = b.email;
  if (b.city || b.address) biz.address = { "@type": "PostalAddress", ...(b.address ? { streetAddress: b.address } : {}), ...(b.city ? { addressLocality: b.city } : {}), ...(b.state ? { addressRegion: b.state } : {}), ...(b.zip ? { postalCode: b.zip } : {}), addressCountry: "US" };
  const areas = b.serviceArea.split(/[;\n]|,\s*(?=[A-Z][a-z])/).map((a) => a.trim()).filter((a) => a.length > 1).slice(0, 20);
  if (areas.length) biz.areaServed = areas.map((a) => ({ "@type": "Place", name: a }));
  if (x.company.logoUrl) biz.logo = biz.image = x.company.logoUrl;
  if (b.gbpUrl) biz.sameAs = [b.gbpUrl];
  if (/^(Mo|Tu|We|Th|Fr|Sa|Su)/.test(b.hours)) biz.openingHours = b.hours;
  const services = x.site.pages.filter((p) => p.kind === "service");
  if (services.length) biz.makesOffer = services.map((p) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: p.nav, url: url.replace(/\/$/, "") + pathOf(p) } }));
  const out: object[] = [];
  if (x.page.kind === "home") out.push(biz);
  else {
    out.push({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: x.company.name, item: url }, { "@type": "ListItem", position: 2, name: x.page.nav, item: url.replace(/\/$/, "") + pathOf(x.page) }] });
    if (x.page.kind === "service") out.push({ "@context": "https://schema.org", "@type": "Service", name: x.page.nav, serviceType: x.page.nav, provider: { "@type": "HousePainter", name: x.company.name, url }, ...(areas.length ? { areaServed: areas.map((a) => ({ "@type": "Place", name: a })) } : {}) });
  }
  return out;
}

export function renderSitePage(x: RenderCtx): string {
  const { site, page: p, company: c } = x;
  const T = L[site.lang];
  const b = site.business;
  const look = x.look ?? {};
  const color = /^#[0-9a-f]{6}$/i.test(c.brandColor ?? "") ? c.brandColor! : look.accent ?? "#E8A33D";
  const DK = look.dark ?? "#0F1B2D";
  const BG = look.bg ?? "#F7F5F1";
  const bold = site.template === "bold" || !!look.bold;
  const title = p.seoTitle || `${p.headline || p.nav} | ${c.name}`;
  const desc = p.seoDesc || p.intro.slice(0, 155);
  const canonical = x.origin.replace(/\/$/, "") + pathOf(p);
  const navPages = site.pages.filter((q) => q.kind !== "service");
  const services = site.pages.filter((q) => q.kind === "service");
  const phone = b.phone ? `<a class="ph" href="tel:${e(tel(b.phone))}">${e(b.phone)}</a>` : "";
  const sections = (q: Page) => {
    const servicesList = q.kind === "services" && services.length
      ? `<section class="blk"><div class="cards">${services.map((s) => `<a class="card" href="${e(x.link(pathOf(s)))}" data-p="${e(s.id)}"><b>${e(s.nav)}</b><span>${e((s.intro || "").slice(0, 140))}</span></a>`).join("")}</div></section>`
      : "";
    const contact = q.kind === "contact"
      ? `<section class="blk"><div class="contact">${b.phone ? `<p><b>${e(T.call)}:</b> <a href="tel:${e(tel(b.phone))}">${e(b.phone)}</a></p>` : ""}${b.email ? `<p><b>Email:</b> <a href="mailto:${e(b.email)}">${e(b.email)}</a></p>` : ""}${b.address || b.city ? `<p>${e([b.address, [b.city, b.state].filter(Boolean).join(", "), b.zip].filter(Boolean).join(" "))}</p>` : ""}${b.hours ? `<p><b>${e(T.hours)}:</b> ${e(b.hours)}</p>` : ""}${b.serviceArea ? `<p><b>${e(T.area)}:</b> ${e(b.serviceArea)}</p>` : ""}</div>
<h2>${e(T.estimate)}</h2><p class="muted">${e(T.estimateSub)}</p><iframe title="${e(T.estimate)}" loading="lazy" src="https://paintersmax.app/q/${e(encodeURIComponent(c.slug))}" width="100%" height="760" style="border:1px solid rgba(15,27,45,.1);border-radius:10px;background:#fff"></iframe></section>`
      : "";
    return `<div class="hero"><div class="wrap"><h1>${e(q.headline || q.nav)}</h1>${q.intro ? richText(q.intro) : ""}${q.kind === "home" ? `<a class="btn" href="${e(x.quoteHref)}">${e(T.quote)}</a>` : ""}</div></div>
<main><div class="wrap">
${servicesList}
${q.blocks.map((bl) => blockHtml(bl, x, T)).join("\n")}
${contact}
</div></main>`;
  };
  const onePage = !!x.onePage;
  const body = onePage
    ? site.pages.map((q) => `<div class="panel" id="p-${e(q.id)}" data-path="${e(x.link(pathOf(q)))}" data-title="${e(q.seoTitle || `${q.headline || q.nav} | ${c.name}`)}"${q.id === p.id ? "" : " hidden"}>${sections(q)}</div>`).join("\n")
    : sections(p);
  const ld = structuredData(x);
  return `<!doctype html><html lang="${site.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title><meta name="description" content="${e(desc)}">
<link rel="canonical" href="${e(canonical)}">${x.preview ? '<meta name="robots" content="noindex">' : ""}
${p.kind === "home" && site.gscToken ? `<meta name="google-site-verification" content="${e(site.gscToken)}">` : ""}
<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${e(canonical)}">
${site.photos[0] ? `<meta property="og:image" content="${e(x.origin.replace(/\/$/, "") + x.photoSrc((p.blocks.find((q) => q.type === "photos" && q.photos.length) as any)?.photos?.[0] ?? site.photos[0].id))}">` : ""}
<meta name="theme-color" content="${DK}">
${ld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
<style>
*{box-sizing:border-box}body{font-family:Inter,system-ui,-apple-system,sans-serif;background:${bold ? "#fff" : BG};color:${DK};margin:0;line-height:1.6}
a{color:inherit}.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
header{background:${DK};color:#fff}header .wrap{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 16px}
header .logo{font-family:Newsreader,Georgia,serif;font-size:21px;font-weight:600;text-decoration:none}header img{max-height:44px;max-width:170px;display:block}
nav.m{display:flex;flex-wrap:wrap;gap:2px}nav.m a{color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:8px 10px;border-radius:8px}nav.m a.on,nav.m a:hover{background:rgba(255,255,255,.14)}
.ph{color:${e(color)};font-weight:700;text-decoration:none}.btn{display:inline-block;background:${e(color)};color:${DK};font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px;margin-top:6px}
.hero{background:${bold ? `linear-gradient(135deg,${DK},#22385a)` : "#fff"};color:${bold ? "#fff" : DK};border-bottom:1px solid rgba(15,27,45,.08)}.hero .wrap{padding:${bold ? "56px" : "36px"} 16px}
h1{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:${bold ? "46px" : "38px"};line-height:1.12;margin:0 0 12px}h2{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:27px;margin:0 0 10px}
.hero p{font-size:18px;max-width:720px;margin:0 0 14px}main .wrap{padding:8px 16px 40px}.blk{margin:30px 0}.muted{color:#4A5568}
.vid{position:relative;aspect-ratio:16/9;max-width:860px;border-radius:10px;overflow:hidden;background:#000}.vid-tall{aspect-ratio:9/16;max-width:360px}.vid iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.gal figure{margin:0}.gal img{width:100%;height:200px;object-fit:cover;border-radius:10px;display:block;background:#e9e6df}.gal figcaption{font-size:13px;color:#4A5568;margin-top:4px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.tabs button{font:inherit;font-weight:600;padding:9px 15px;border-radius:20px;border:1px solid #cfd5dc;background:#fff;cursor:pointer}.tabs button[aria-selected=true]{background:${DK};color:#fff;border-color:${DK}}
.tp{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:4px 18px}
.cta{background:${bold ? DK : "#fff"};color:${bold ? "#fff" : DK};border:1px solid rgba(15,27,45,.1);border-radius:12px;padding:22px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.card{display:block;background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:16px;text-decoration:none}.card b{display:block;font-size:18px;margin-bottom:4px}.card span{color:#4A5568;font-size:14px}
.contact p{margin:6px 0}.rev{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:14px 18px;margin:0 0 10px}.rev p{margin:6px 0}.stars{color:${e(color)};font-size:19px;letter-spacing:2px}.sr{position:absolute;left:-9999px}.rr{background:${BG};border-radius:8px;padding:8px 12px;font-size:15px}.ic{font-size:18px}
footer{background:${DK};color:#cfd5dc;font-size:14px}footer .wrap{padding:26px 16px}footer a{color:${e(color)}}footer .sv a{margin-right:10px}
.pv{background:#fff3cd;color:#5c4400;text-align:center;padding:8px 12px;font-size:14px;font-weight:600}
.badge{display:inline-block;background:${e(color)};color:${DK};font-size:12px;font-weight:700;padding:2px 10px;border-radius:12px;margin-left:6px}
@media(max-width:640px){h1{font-size:31px}.hero .wrap{padding:26px 16px}nav.m{width:100%;overflow-x:auto;flex-wrap:nowrap}}
</style></head><body>
${x.preview ? `<div class="pv">${e(T.preview)}</div>` : ""}
<header><div class="wrap"><a class="logo" href="${e(x.link("/"))}"${site.pages[0] ? ` data-p="${e(site.pages[0].id)}"` : ""}>${c.logoUrl ? `<img src="${e(c.logoUrl)}" alt="${e(c.name)}">` : e(c.name)}</a>${phone}
<nav class="m" aria-label="${e(T.menu)}">${navPages.map((q) => `<a href="${e(x.link(pathOf(q)))}" data-p="${e(q.id)}"${q.id === p.id ? ' class="on" aria-current="page"' : ""}>${e(q.nav)}</a>`).join("")}<a href="${e(x.quoteHref)}">${e(T.quote)}</a></nav></div></header>
${body}
<footer><div class="wrap"><b>${e(c.name)}</b>${x.founding ? `<span class="badge">Founding painter</span>` : ""}${b.license ? ` &middot; ${e(T.license)} ${e(b.license)}` : ""}${x.insuredProof ? ` &middot; ${e(T.insured)} (<a href="${e(x.insuredProof)}" rel="noopener">${e(T.proof)}</a>)` : ""}
${phone ? `<p>${phone}${b.email ? ` &middot; <a href="mailto:${e(b.email)}">${e(b.email)}</a>` : ""}</p>` : ""}
${services.length ? `<p class="sv"><b>${e(T.services)}:</b> ${services.map((s) => `<a href="${e(x.link(pathOf(s)))}" data-p="${e(s.id)}">${e(s.nav)}</a>`).join("")}</p>` : ""}
${x.cityPages.length ? `<p class="sv"><b>${e(T.serve)}:</b> ${x.cityPages.map((cp) => `<a href="${e(cp.href)}">${e(cp.name)}, ${e(cp.state)}</a>`).join("")}</p>` : ""}
${b.gbpUrl ? `<p><a href="${e(b.gbpUrl)}" rel="noopener">${e(T.reviews)}</a></p>` : ""}
${site.footer ? `<p>${e(site.footer)}</p>` : ""}
<p><a href="https://paintersmax.app/">${e(T.by)}</a></p></div></footer>
<script>document.querySelectorAll('.tabs-blk').forEach(function(s){var bs=s.querySelectorAll('[role=tab]'),ps=s.querySelectorAll('[role=tabpanel]');bs.forEach(function(b,i){b.onclick=function(){bs.forEach(function(x,j){x.setAttribute('aria-selected',j===i);x.tabIndex=j===i?0:-1;ps[j].hidden=j!==i})}})})</script>
${onePage ? ONE_PAGE_JS : ""}
</body></html>`;
}

/** One page, five tabs: tapping a menu item or an inside link swaps the panel and updates the address (every address also works on its own). */
const ONE_PAGE_JS = `<script>(function(){var P=document.querySelectorAll('.panel'),N=document.querySelectorAll('nav.m a[data-p]');function go(id,push){var hit=null;P.forEach(function(x){var on=x.id==='p-'+id;x.hidden=!on;if(on)hit=x});if(!hit)return false;N.forEach(function(a){var on=a.getAttribute('data-p')===id;a.classList.toggle('on',on);if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});document.title=hit.getAttribute('data-title');if(push)history.pushState({id:id},'',hit.getAttribute('data-path'));window.scrollTo(0,0);return true}document.addEventListener('click',function(ev){var a=ev.target.closest&&ev.target.closest('a[data-p]');if(!a||ev.metaKey||ev.ctrlKey||ev.shiftKey)return;if(go(a.getAttribute('data-p'),true))ev.preventDefault()});window.addEventListener('popstate',function(){var m=location.pathname+location.search,f=null;P.forEach(function(x){if(x.getAttribute('data-path')===m)f=x.id.slice(2)});go(f||(P[0]&&P[0].id.slice(2)),false)})})()</script>`;

/** robots.txt for a painter's own address. */
export const siteRobots = (origin: string) => `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin.replace(/\/$/, "")}/sitemap.xml\n`;

/** sitemap.xml with every page of the published site plus the published city pages. */
export function siteSitemap(origin: string, site: Site | null, cityPages: { slug: string; updated: string }[], lastmod: string): string {
  const base = origin.replace(/\/$/, "");
  const urls: string[] = [];
  if (site) for (const p of site.pages) urls.push(`<url><loc>${e(base + pathOf(p))}</loc><lastmod>${e(lastmod.slice(0, 10))}</lastmod></url>`);
  else urls.push(`<url><loc>${e(base)}/</loc></url>`);
  for (const c of cityPages) urls.push(`<url><loc>${e(base)}/areas/${e(c.slug)}</loc><lastmod>${e(c.updated.slice(0, 10))}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
}

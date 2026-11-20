import { configOf, TEMPLATE_IDS } from "../templates/configs.ts";
import { cleanSocial, cleanTheme, SITE_SCHEMA, upgradeSite, type SocialLink, type Theme } from "./sitetheme.ts";
import type { Plan } from "./usage.ts";
import { cleanOrient, parseYouTube, type Orient } from "./ytcore.ts";

/**
 * Website builder: the rules and the data shape, with no database or network code (so it is easy to test).
 *
 * Every painter's website is one JSON document. The painter edits a draft; Publish copies the draft to the live copy.
 * The door (Free, Launch, Grow, Signature) decides how many pages, service pages and photos the site may have.
 * Home, Services, Gallery, About and Contact come with every door and count as the first 5 pages.
 * Tabs live inside a page and never count as pages, so they are the way to add content without hitting the limit.
 */

export type Door = "free" | "launch" | "grow" | "signature";
export const DOORS: Door[] = ["free", "launch", "grow", "signature"];
export const DOOR_NAMES: Record<Door, string> = { free: "Free", launch: "Launch", grow: "Grow", signature: "Signature" };

export interface Limits { pages: number; services: number; photos: number }

/** Pages include the 5 core pages. Free builds a full Launch-size draft and publishes it as one page with five tabs on a free template. */
export const DOOR_LIMITS: Record<Door, Limits> = {
  free: { pages: 5, services: 3, photos: 30 },
  launch: { pages: 5, services: 3, photos: 30 },
  grow: { pages: 10, services: 6, photos: 75 },
  signature: { pages: 15, services: 10, photos: 150 },
};
/** Every door may publish. Free publishes only a free-class template (checked with the template list). */
export const canPublish = (_door: Door) => true;

/** The floor prices (what a promotion lands on). The upgrade notice charges the difference between two floors. */
export const DOOR_FLOOR_CENTS: Record<Door, number> = { free: 0, launch: 29900, grow: 39900, signature: 49900 };
/** List prices approved 2026-11-14 (shown crossed out next to the floor on the sign-up page). */
export const DOOR_LIST_CENTS: Record<Door, number> = { free: 0, launch: 39900, grow: 54900, signature: 69900 };

/** Until the four doors have their own column, a door follows the AI plan: Starter = Launch, Basic = Grow, Pro = Signature. */
export const PLAN_DOOR: Record<Plan, Door> = { free: "free", starter: "launch", basic: "grow", pro: "signature" };
export const DOOR_PLAN: Record<Door, Plan> = { free: "free", launch: "starter", grow: "basic", signature: "pro" };

export const isDoor = (v: unknown): v is Door => typeof v === "string" && (DOORS as string[]).includes(v);
export const nextDoor = (d: Door): Door | null => (d === "signature" ? null : DOORS[DOORS.indexOf(d) + 1]);
export const upgradeCents = (from: Door, to: Door) => Math.max(0, DOOR_FLOOR_CENTS[to] - DOOR_FLOOR_CENTS[from]);

/** Templates live in the template library (templates/configs.ts, src/sitetemplates.ts). Any known template may be
 * saved in a draft (Free previews them all); the door check happens when the painter publishes. */
/** New sites start with the newest basic template. */
export const DEFAULT_TEMPLATE = "sunset-sand";
export const isTemplateId = (t: string) => TEMPLATE_IDS.includes(t);

/** A door plus any limits admin set by hand (for a trade group deal or a founder). Override never lowers a door. */
export interface DoorRecord { door?: Door; override?: Partial<Limits>; note?: string }

export function readDoorRecord(raw: unknown): DoorRecord {
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!j || typeof j !== "object") return {};
    const out: DoorRecord = {};
    if (isDoor((j as any).door)) out.door = (j as any).door;
    const o = (j as any).override;
    if (o && typeof o === "object") {
      const ov: Partial<Limits> = {};
      for (const k of ["pages", "services", "photos"] as const) {
        const n = Number(o[k]);
        if (Number.isInteger(n) && n > 0 && n <= 500) ov[k] = n;
      }
      if (Object.keys(ov).length) out.override = ov;
    }
    if (typeof (j as any).note === "string" && (j as any).note.trim()) out.note = (j as any).note.trim().slice(0, 120);
    return out;
  } catch {
    return {};
  }
}

export function doorFor(plan: Plan, rec: DoorRecord): Door {
  return rec.door ?? PLAN_DOOR[plan];
}

export function limitsFor(door: Door, rec: DoorRecord): Limits {
  const base = DOOR_LIMITS[door];
  const o = rec.override ?? {};
  return { pages: Math.max(base.pages, o.pages ?? 0), services: Math.max(base.services, o.services ?? 0), photos: Math.max(base.photos, o.photos ?? 0) };
}

// ------------------------------------------------------------------ the site document

export type PageKind = "home" | "services" | "gallery" | "about" | "contact" | "service" | "custom";
export const CORE_KINDS: PageKind[] = ["home", "services", "gallery", "about", "contact"];
/** Photo spaces a new page shows. The site total is the real limit. */
export const DEFAULT_PHOTOS: Record<PageKind, number> = { home: 6, gallery: 6, service: 3, services: 3, about: 3, contact: 1, custom: 3 };

export interface Tab { id: string; label: string; body: string }
export type Block =
  | { id: string; type: "text"; heading: string; body: string }
  | { id: string; type: "photos"; heading: string; photos: string[] }
  | { id: string; type: "tabs"; heading: string; tabs: Tab[] }
  | { id: string; type: "cta"; heading: string; body: string; action: "quote" | "call" }
  | { id: string; type: "reviews"; heading: string }
  | { id: string; type: "video"; heading: string; yt: string; orient: Orient; kind: VideoKind; caption: string }
  | { id: string; type: "weather"; heading: string; place: string };

/** What a video is for. Only changes the label the editor and the page use; any kind can be wide or tall. */
export type VideoKind = "intro" | "testimonial" | "message" | "how";
export const VIDEO_KINDS: VideoKind[] = ["intro", "testimonial", "message", "how"];
/** The painter's video switch. Off hides every video on the public site (the videos stay saved). */
export interface Media { on: boolean; heroYt: string; heroOrient: Orient }
export const cleanMedia = (raw: any): Media => {
  const p = parseYouTube(raw?.heroYt);
  return { on: raw?.on === true, heroYt: p?.id ?? "", heroOrient: p?.short ? "tall" : cleanOrient(raw?.heroOrient) };
};

export interface Page {
  id: string;
  kind: PageKind;
  slug: string; // "" for home; core pages have fixed slugs
  nav: string; // the menu label
  seoTitle: string;
  seoDesc: string;
  headline: string;
  intro: string;
  trade?: string; // service pages: which trade it sells
  blocks: Block[];
}

export interface PhotoMeta { id: string; alt: string; w: number; h: number; bytes: number; at: string; /** Made by the AI image tool (never shown as the painter's own work). */ ai?: boolean }

export interface Site {
  v: 1;
  sv: number; // schema version (sitetheme.ts SITE_SCHEMA); older saved sites are upgraded on read
  template: string;
  themes: Record<string, Theme>; // the painter's look choices, per template (switching keeps them)
  social: SocialLink[];
  lang: "en" | "es";
  pages: Page[];
  photos: PhotoMeta[]; // every uploaded photo (the site total)
  media?: Media; // videos on or off, and the hero video
  business: { phone: string; email: string; address: string; city: string; state: string; zip: string; hours: string; serviceArea: string; license: string; gbpUrl: string };
  gscToken: string; // Google Search Console verification code
  footer: string;
  updatedAt: string;
}

export const CORE_SLUGS: Record<string, string> = { home: "", services: "services", gallery: "gallery", about: "about", contact: "contact" };
export const CORE_NAV: Record<string, string> = { home: "Home", services: "Services", gallery: "Gallery", about: "About", contact: "Contact" };

const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, n) : "");
export const slugify = (v: string) =>
  v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
const idOf = (v: unknown, fallback: string) => (typeof v === "string" && /^[a-z0-9_-]{1,40}$/i.test(v) ? v : fallback);
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export const BLOCK_CAP = 12;
/** A site shows weather for at most this many places. */
export const MAX_WEATHER_PLACES = 2;
export const TAB_CAP = 8;
export const TEXT_MAX = 6000;

function cleanBlock(b: any, photoIds: Set<string>): Block | null {
  const id = idOf(b?.id, newId());
  const heading = s(b?.heading, 120);
  switch (b?.type) {
    case "text":
      return { id, type: "text", heading, body: s(b?.body, TEXT_MAX) };
    case "photos": {
      const list = Array.isArray(b?.photos) ? b.photos.filter((p: unknown) => typeof p === "string" && photoIds.has(p)) : [];
      return { id, type: "photos", heading, photos: Array.from(new Set(list as string[])).slice(0, 60) };
    }
    case "tabs": {
      const tabs = (Array.isArray(b?.tabs) ? b.tabs : []).slice(0, TAB_CAP).map((t: any, i: number) => ({ id: idOf(t?.id, `t${i}`), label: s(t?.label, 40) || `Tab ${i + 1}`, body: s(t?.body, TEXT_MAX) }));
      return { id, type: "tabs", heading, tabs };
    }
    case "cta":
      return { id, type: "cta", heading, body: s(b?.body, 400), action: b?.action === "call" ? "call" : "quote" };
    case "reviews":
      return { id, type: "reviews", heading };
    case "video": {
      const p = parseYouTube(b?.yt);
      if (!p) return null;
      return { id, type: "video", heading, yt: p.id, orient: p.short ? "tall" : cleanOrient(b?.orient), kind: VIDEO_KINDS.includes(b?.kind) ? b.kind : "intro", caption: s(b?.caption, 200) };
    }
    case "weather":
      return { id, type: "weather", heading, place: s(b?.place, 80) };
    default:
      return null;
  }
}

export type CleanResult = { ok: true; site: Site } | { ok: false; error: string; over?: "pages" | "services" | "photos" };

/**
 * Keeps only valid, bounded values and checks the door limits. Core pages always exist exactly once.
 * Anything going onto a public page passes through here.
 */
export function cleanSite(rawInput: any, limits: Limits, door: Door, now = new Date().toISOString()): CleanResult {
  const input = upgradeSite(rawInput);
  const photos: PhotoMeta[] = (Array.isArray(input?.photos) ? input.photos : [])
    .filter((p: any) => typeof p?.id === "string" && /^[a-f0-9]{12,32}$/.test(p.id))
    .map((p: any) => ({ id: p.id, alt: s(p.alt, 160), w: Math.max(0, Math.round(Number(p.w) || 0)), h: Math.max(0, Math.round(Number(p.h) || 0)), bytes: Math.max(0, Math.round(Number(p.bytes) || 0)), at: s(p.at, 30), ...(p.ai === true ? { ai: true } : {}) }));
  const photoIds = new Set(photos.map((p) => p.id));

  const seenSlugs = new Set<string>();
  const seenCore = new Set<string>();
  const pages: Page[] = [];
  for (const raw of Array.isArray(input?.pages) ? input.pages.slice(0, 60) : []) {
    const kind: PageKind = ["home", "services", "gallery", "about", "contact", "service", "custom"].includes(raw?.kind) ? raw.kind : "custom";
    if (CORE_KINDS.includes(kind)) {
      if (seenCore.has(kind)) continue;
      seenCore.add(kind);
    }
    const nav = s(raw?.nav, 30) || CORE_NAV[kind] || "Page";
    let slug = CORE_KINDS.includes(kind) ? CORE_SLUGS[kind] : slugify(s(raw?.slug, 60) || nav) || "page";
    if (!CORE_KINDS.includes(kind)) {
      let n = 2;
      const base = slug;
      while (seenSlugs.has(`${kind}:${slug}`)) slug = `${base}-${n++}`;
    }
    seenSlugs.add(`${kind}:${slug}`);
    const blocks = (Array.isArray(raw?.blocks) ? raw.blocks.slice(0, BLOCK_CAP) : []).map((b: any) => cleanBlock(b, photoIds)).filter((b: Block | null): b is Block => !!b);
    pages.push({
      id: idOf(raw?.id, newId()),
      kind,
      slug,
      nav,
      seoTitle: s(raw?.seoTitle, 70),
      seoDesc: s(raw?.seoDesc, 170),
      headline: s(raw?.headline, 120),
      intro: s(raw?.intro, 1500),
      ...(kind === "service" ? { trade: s(raw?.trade, 30) } : {}),
      blocks,
    });
  }
  for (const k of CORE_KINDS) {
    if (!seenCore.has(k)) pages.push({ id: newId(), kind: k, slug: CORE_SLUGS[k], nav: CORE_NAV[k], seoTitle: "", seoDesc: "", headline: "", intro: "", blocks: [] });
  }
  // A site shows weather for at most 2 places. Later ones are dropped, so the limit holds however the page was edited.
  let weatherLeft = door === "grow" || door === "signature" ? MAX_WEATHER_PLACES : 0; // weather comes with the Grow door and up
  for (const pg of pages) pg.blocks = pg.blocks.filter((bl) => bl.type !== "weather" || (bl.place && weatherLeft-- > 0));
  // Home first, then the order the painter chose.
  pages.sort((a, b) => (a.kind === "home" ? -1 : b.kind === "home" ? 1 : 0));

  const u = usageOf({ pages, photos } as Site);
  if (u.pages > limits.pages) return { ok: false, error: `Your ${DOOR_NAMES[door]} site can have ${limits.pages} pages.`, over: "pages" };
  if (u.services > limits.services) return { ok: false, error: `Your ${DOOR_NAMES[door]} site can have ${limits.services} service pages.`, over: "services" };
  if (photos.length > limits.photos) return { ok: false, error: `Your ${DOOR_NAMES[door]} site can have ${limits.photos} photos.`, over: "photos" };

  const b = input?.business ?? {};
  const gbp = s(b.gbpUrl, 300);
  const token = s(input?.gscToken, 120);
  const template = isTemplateId(s(input?.template, 40)) ? s(input?.template, 40) : "classic";
  const themes: Record<string, Theme> = {};
  for (const [id, raw] of Object.entries(input?.themes && typeof input.themes === "object" ? input.themes : {})) {
    if (isTemplateId(id)) themes[id] = cleanTheme(raw, configOf(id), photoIds);
  }
  return {
    ok: true,
    site: {
      v: 1,
      sv: SITE_SCHEMA,
      template,
      themes,
      social: cleanSocial(input?.social),
      lang: input?.lang === "es" ? "es" : "en",
      pages,
      photos,
      media: cleanMedia(input?.media),
      business: {
        phone: s(b.phone, 30), email: /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s(b.email, 200)) ? s(b.email, 200) : "",
        address: s(b.address, 160), city: s(b.city, 60), state: s(b.state, 2).toUpperCase(), zip: s(b.zip, 10), hours: s(b.hours, 120),
        serviceArea: s(b.serviceArea, 300), license: s(b.license, 60),
        gbpUrl: /^https:\/\/[^\s"'<>]+$/.test(gbp) ? gbp : "",
      },
      // A Search Console code looks like letters, digits, - and _. Pasting the whole meta tag also works.
      gscToken: (token.match(/content=["']([A-Za-z0-9_-]{10,100})["']/)?.[1] ?? (/^[A-Za-z0-9_-]{10,100}$/.test(token) ? token : "")),
      footer: s(input?.footer, 300),
      updatedAt: now,
    },
  };
}

export function usageOf(site: Pick<Site, "pages" | "photos">) {
  return {
    pages: site.pages.filter((p) => p.kind !== "service").length,
    services: site.pages.filter((p) => p.kind === "service").length,
    photos: site.photos.length,
  };
}

/** The address of a page on the painter's site. */
export function pathOf(p: Pick<Page, "kind" | "slug">): string {
  if (p.kind === "home") return "/";
  if (p.kind === "service") return `/services/${p.slug}`;
  if (p.kind === "custom") return `/info/${p.slug}`;
  return `/${p.slug}`;
}

/** Finds the page for an address on the painter's site, or null. */
export function pageForPath(site: Site, path: string): Page | null {
  const p = path.replace(/\/+$/, "") || "/";
  return site.pages.find((x) => pathOf(x) === p) ?? null;
}

// ------------------------------------------------------------------ the first draft

export const TRADE_NAMES: Record<string, { en: string; es: string }> = {
  interior: { en: "Interior painting", es: "Pintura de interiores" },
  exterior: { en: "Exterior painting", es: "Pintura de exteriores" },
  commercial: { en: "Commercial painting", es: "Pintura comercial" },
  new_construction: { en: "New construction painting", es: "Pintura de obra nueva" },
  power_washing: { en: "Power washing", es: "Lavado a presión" },
  drywall: { en: "Drywall repair", es: "Reparación de paneles de yeso" },
  cabinets: { en: "Cabinet painting", es: "Pintura de gabinetes" },
  decks_fences: { en: "Deck and fence staining", es: "Tinte de terrazas y cercas" },
  fencing: { en: "Fence installation", es: "Instalación de cercas" },
  remodeling: { en: "Remodeling", es: "Remodelación" },
  epoxy_floors: { en: "Epoxy floors", es: "Pisos epóxicos" },
  industrial: { en: "Industrial coatings", es: "Recubrimientos industriales" },
};

/** Plain words about what each service covers. Facts about the work, never claims about the painter. */
const TRADE_SCOPE: Record<string, { en: string; es: string }> = {
  interior: { en: "Walls, ceilings, trim, doors and baseboards. We protect floors and furniture, repair small holes and cracks, and clean up every day.", es: "Paredes, techos, molduras, puertas y zócalos. Protegemos pisos y muebles, reparamos hoyos y grietas pequeñas y limpiamos cada día." },
  exterior: { en: "Siding, trim, fascia, soffits, doors and shutters. Surfaces are cleaned, scraped and primed where needed before the paint goes on.", es: "Revestimiento, molduras, fascia, plafones, puertas y contraventanas. Las superficies se limpian, se raspan y se les aplica imprimador donde hace falta antes de pintar." },
  commercial: { en: "Offices, stores, rental units and common areas, scheduled around your business hours.", es: "Oficinas, tiendas, unidades de renta y áreas comunes, programado según el horario de su negocio." },
  new_construction: { en: "Primer and finish coats for new homes and additions, coordinated with the builder's schedule.", es: "Imprimador y capas finales para casas nuevas y ampliaciones, coordinado con el calendario del constructor." },
  power_washing: { en: "Siding, driveways, decks and fences cleaned before painting or on their own.", es: "Revestimiento, entradas, terrazas y cercas lavadas antes de pintar o por separado." },
  drywall: { en: "Holes, cracks, water spots and texture matching, finished and ready for paint.", es: "Hoyos, grietas, manchas de agua y textura igualada, terminados y listos para pintar." },
  cabinets: { en: "Kitchen and bath cabinets cleaned, sanded, primed and finished with a hard, smooth coat.", es: "Gabinetes de cocina y baño limpiados, lijados, con imprimador y terminados con una capa dura y lisa." },
  decks_fences: { en: "Decks and fences cleaned and stained or sealed to protect the wood.", es: "Terrazas y cercas limpiadas y teñidas o selladas para proteger la madera." },
  fencing: { en: "New fences and repairs, built and finished.", es: "Cercas nuevas y reparaciones, construidas y terminadas." },
  remodeling: { en: "Small remodels and repairs that go with the painting job.", es: "Remodelaciones pequeñas y reparaciones que acompañan el trabajo de pintura." },
  epoxy_floors: { en: "Garage and shop floors prepared and coated with epoxy.", es: "Pisos de garaje y taller preparados y cubiertos con epóxico." },
  industrial: { en: "Coatings for metal, tanks, warehouses and plants.", es: "Recubrimientos para metal, tanques, bodegas y plantas." },
};

/** Text the painter must replace before publishing. The publish check looks for the square brackets. */
export const PLACEHOLDER_RE = /\[[^\]]{3,}\]/;

export interface DraftInput {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  license?: string;
  trades: string[];
  cities: string[]; // "Tyler, TX"
  warrantyMonths?: number;
  insured?: boolean;
  lang: "en" | "es";
}

/**
 * Writes the first draft of every page from the painter's own answers (no AI, no cost).
 * Anything only the painter knows is left in [square brackets] and blocks publishing until it is filled in.
 */
export function firstDraft(d: DraftInput, limits: Limits): Site {
  const es = d.lang === "es";
  const place = d.city && d.state ? `${d.city}, ${d.state}` : d.cities[0] ?? "";
  const area = d.cities.length ? d.cities.slice(0, 8).join(", ") : place;
  const trades = (d.trades.length ? d.trades : ["interior", "exterior"]).filter((t) => TRADE_NAMES[t]).slice(0, limits.services);
  const tn = (t: string) => TRADE_NAMES[t]?.[es ? "es" : "en"] ?? t;
  const inPlace = place ? (es ? ` en ${place}` : ` in ${place}`) : "";
  const facts: string[] = [];
  if (d.insured) facts.push(es ? "Asegurados, con comprobante disponible." : "Insured, with proof available.");
  if (d.warrantyMonths) facts.push(es ? `Garantía de mano de obra de ${d.warrantyMonths} meses.` : `${d.warrantyMonths}-month labor warranty.`);
  if (d.license) facts.push(es ? `Licencia ${d.license}.` : `License ${d.license}.`);
  facts.push(es ? "Presupuesto por escrito antes de empezar." : "A written estimate before any work starts.");

  const cta = (id: string): Block => ({ id, type: "cta", heading: es ? "Pida un presupuesto gratis" : "Get a free estimate", body: es ? "Cuéntenos del trabajo y vea un rango de precio en segundos." : "Tell us about the job and see a price range in seconds.", action: "quote" });
  const page = (kind: PageKind, p: Partial<Page>): Page => ({
    id: newId(), kind, slug: CORE_SLUGS[kind] ?? slugify(p.nav ?? "page"), nav: CORE_NAV[kind] ?? "Page", seoTitle: "", seoDesc: "", headline: "", intro: "", blocks: [], ...p,
  });
  const nav = (en: string, esp: string) => (es ? esp : en);

  const pages: Page[] = [
    page("home", {
      nav: nav("Home", "Inicio"),
      seoTitle: `${d.name} | ${es ? "Pintores" : "Painters"}${inPlace}`.slice(0, 60),
      seoDesc: `${d.name}: ${trades.map(tn).join(", ").toLowerCase()}${inPlace}. ${es ? "Presupuesto gratis en línea." : "Free estimate online."}`.slice(0, 160),
      headline: `${es ? "Pintura de casas" : "House painting"}${inPlace}`,
      intro: es
        ? `${d.name} pinta casas y negocios${area ? ` en ${area}` : ""}. [Escriba en una o dos frases qué hace diferente su trabajo.]`
        : `${d.name} paints homes and businesses${area ? ` in ${area}` : ""}. [Write one or two sentences about what makes your work different.]`,
      blocks: [
        { id: "b1", type: "text", heading: es ? "Por qué nos eligen" : "Why homeowners choose us", body: facts.map((f) => `- ${f}`).join("\n") },
        { id: "b2", type: "photos", heading: es ? "Trabajos recientes" : "Recent work", photos: [] },
        { id: "b3", type: "text", heading: es ? "Nuestros servicios" : "Our services", body: trades.map((t) => `- ${tn(t)}`).join("\n") },
        { id: "b5", type: "reviews", heading: es ? "Lo que dicen nuestros clientes" : "What our customers say" },
        cta("b4"),
      ],
    }),
    page("services", {
      nav: nav("Services", "Servicios"),
      seoTitle: `${es ? "Servicios de pintura" : "Painting services"}${inPlace} | ${d.name}`.slice(0, 60),
      seoDesc: `${es ? "Lo que hacemos" : "What we do"}: ${trades.map(tn).join(", ").toLowerCase()}${inPlace}.`.slice(0, 160),
      headline: es ? "Servicios de pintura" : "Painting services",
      intro: es ? "Elija un servicio para ver qué incluye y cómo trabajamos." : "Pick a service to see what is included and how we work.",
      blocks: [cta("b1")],
    }),
    page("gallery", {
      nav: nav("Gallery", "Galería"),
      seoTitle: `${es ? "Galería de trabajos" : "Project gallery"} | ${d.name}`.slice(0, 60),
      seoDesc: `${es ? "Fotos de trabajos reales de" : "Photos of real projects by"} ${d.name}${inPlace}.`.slice(0, 160),
      headline: es ? "Nuestro trabajo" : "Our work",
      intro: es ? "Fotos de trabajos reales, tomadas por nuestro equipo." : "Photos of real jobs, taken by our crew.",
      blocks: [{ id: "b1", type: "photos", heading: "", photos: [] }],
    }),
    page("about", {
      nav: nav("About", "Nosotros"),
      seoTitle: `${es ? "Sobre" : "About"} ${d.name}`.slice(0, 60),
      seoDesc: `${es ? "Conozca a" : "Meet"} ${d.name}${inPlace}.`.slice(0, 160),
      headline: `${es ? "Sobre" : "About"} ${d.name}`,
      intro: es ? "[Cuente su historia: quién es, cuándo empezó y cómo trabaja.]" : "[Tell your story: who you are, when you started and how you work.]",
      blocks: [{ id: "b1", type: "photos", heading: es ? "Nuestro equipo" : "Our team", photos: [] }],
    }),
    page("contact", {
      nav: nav("Contact", "Contacto"),
      seoTitle: `${es ? "Contacto y presupuesto gratis" : "Contact and free estimate"} | ${d.name}`.slice(0, 60),
      seoDesc: `${es ? "Llame o pida un presupuesto gratis a" : "Call or get a free estimate from"} ${d.name}${inPlace}.`.slice(0, 160),
      headline: es ? "Hablemos de su proyecto" : "Let's talk about your project",
      intro: es ? "Llame, escriba o pida un presupuesto en línea. Respondemos lo antes posible." : "Call, email or ask for an estimate online. We answer as soon as we can.",
      blocks: [cta("b1")],
    }),
  ];
  for (const t of trades) {
    const name = tn(t);
    pages.push(page("service", {
      slug: slugify(TRADE_NAMES[t]?.en ?? t),
      nav: name,
      trade: t,
      seoTitle: `${name}${inPlace} | ${d.name}`.slice(0, 60),
      seoDesc: `${name}${inPlace} ${es ? "por" : "by"} ${d.name}. ${TRADE_SCOPE[t]?.[es ? "es" : "en"] ?? ""}`.slice(0, 160),
      headline: `${name}${inPlace}`,
      intro: TRADE_SCOPE[t]?.[es ? "es" : "en"] ?? "",
      blocks: [
        { id: "b1", type: "photos", heading: es ? "Trabajos de este servicio" : "Jobs like this", photos: [] },
        {
          id: "b2", type: "tabs", heading: es ? "Lo que debe saber" : "What to know",
          tabs: [
            { id: "t1", label: es ? "Qué incluye" : "What is included", body: TRADE_SCOPE[t]?.[es ? "es" : "en"] ?? "" },
            { id: "t2", label: es ? "Cómo trabajamos" : "How it works", body: es ? "1. Presupuesto gratis.\n2. Fecha de inicio por escrito.\n3. Trabajo terminado y revisado con usted." : "1. Free estimate.\n2. A start date in writing.\n3. Finished work, walked through with you." },
            { id: "t3", label: es ? "Preguntas" : "FAQ", body: es ? "[Escriba una pregunta que le hacen sus clientes y su respuesta.]" : "[Write a question your customers ask and your answer.]" },
          ],
        },
        cta("b3"),
      ],
    }));
  }
  return {
    v: 1,
    sv: SITE_SCHEMA,
    template: DEFAULT_TEMPLATE,
    themes: {},
    social: [],
    lang: d.lang,
    pages,
    photos: [],
    business: { phone: d.phone ?? "", email: d.email ?? "", address: d.address ?? "", city: d.city ?? "", state: (d.state ?? "").toUpperCase().slice(0, 2), zip: d.zip ?? "", hours: "", serviceArea: area, license: d.license ?? "", gbpUrl: "" },
    gscToken: "",
    footer: "",
    updatedAt: new Date().toISOString(),
  };
}

/** A blank page of a kind the painter adds with Add page or Add service. */
export function blankPage(kind: "custom" | "service", label: string, trade?: string, lang: "en" | "es" = "en"): Page {
  const es = lang === "es";
  const nav = label.trim().slice(0, 30) || (kind === "service" ? (es ? "Servicio nuevo" : "New service") : (es ? "Página nueva" : "New page"));
  return {
    id: newId(), kind, slug: slugify(nav) || "page", nav, seoTitle: "", seoDesc: "", headline: nav, intro: "",
    ...(kind === "service" ? { trade: trade ?? "" } : {}),
    blocks: [
      { id: "b1", type: "text", heading: "", body: es ? "[Escriba el contenido de esta página.]" : "[Write what this page is about.]" },
      { id: "b2", type: "photos", heading: "", photos: [] },
    ],
  };
}

// ------------------------------------------------------------------ SEO and publish checks

export interface Check { ok: boolean; level: "must" | "should"; text: string }

export const words = (t: string) => (t.match(/[\p{L}\p{N}']+/gu) ?? []).length;
export function pageText(p: Page): string {
  return [p.headline, p.intro, ...p.blocks.map((b) => (b.type === "text" ? `${b.heading}\n${b.body}` : b.type === "tabs" ? b.tabs.map((t) => `${t.label}\n${t.body}`).join("\n") : b.type === "cta" ? `${b.heading}\n${b.body}` : b.type === "reviews" ? "" : b.heading))].join("\n");
}

/** Google's own basics, per page: a clear title and description, one topic, real text, described photos. */
export function seoChecks(site: Site, p: Page): Check[] {
  const out: Check[] = [];
  const t = p.seoTitle.trim();
  const d = p.seoDesc.trim();
  out.push({ ok: t.length >= 15 && t.length <= 60, level: "should", text: "Page title is 15 to 60 characters" });
  out.push({ ok: d.length >= 70 && d.length <= 160, level: "should", text: "Description is 70 to 160 characters" });
  out.push({ ok: !!p.headline.trim(), level: "must", text: "The page has a headline" });
  const dupe = site.pages.some((o) => o.id !== p.id && o.seoTitle.trim() && o.seoTitle.trim().toLowerCase() === t.toLowerCase());
  out.push({ ok: !dupe, level: "should", text: "No other page uses the same title" });
  const n = words(pageText(p));
  const need = p.kind === "home" || p.kind === "service" ? 150 : p.kind === "contact" || p.kind === "gallery" ? 0 : 80;
  if (need) out.push({ ok: n >= need, level: "should", text: `At least ${need} words of real text (now ${n})` });
  const used = new Set(p.blocks.flatMap((b) => (b.type === "photos" ? b.photos : [])));
  const missingAlt = site.photos.filter((ph) => used.has(ph.id) && ph.alt.trim().length < 5).length;
  out.push({ ok: missingAlt === 0, level: "should", text: missingAlt ? `${missingAlt} photo(s) need a description` : "Every photo has a description" });
  if (p.kind === "home" || p.kind === "gallery") out.push({ ok: used.size > 0, level: "should", text: "Shows your own photos" });
  out.push({ ok: !PLACEHOLDER_RE.test(pageText(p)), level: "must", text: "No [bracketed] starter text left" });
  return out;
}

/** What stops a publish: the must-fix items, plus a phone number so customers can call. */
export function publishBlockers(site: Site): string[] {
  const out: string[] = [];
  if (!site.business.phone.trim()) out.push("Add a phone number under Business details.");
  for (const p of site.pages) {
    for (const c of seoChecks(site, p)) if (!c.ok && c.level === "must") out.push(`${p.nav}: ${c.text}.`);
  }
  return out;
}

/** Health flags for the admin site list. These are the painters most likely to leave. */
export function healthFlags(site: Site | null, publishedAt: string | null, today: string): string[] {
  const f: string[] = [];
  if (!site) return ["No site yet"];
  if (!publishedAt) f.push("Never published");
  else if (Date.parse(today) - Date.parse(publishedAt.slice(0, 10)) > 60 * 86400000) f.push("No publish in 60 days");
  if (!site.photos.length) f.push("No photos");
  if (!site.business.phone) f.push("No phone");
  return f;
}

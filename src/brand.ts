import { computeTotals, renderEstimateHtml, sanitizeEstimate, type Letterhead } from "./estimate.ts";
import { getSessionUser } from "./auth.ts";
import { listDomains } from "./domains.ts";
import { readSettings } from "./settings.ts";
import { CARD_DESIGNS, cleanBrand, renderCards, type Brand } from "./brandprint.ts";
import { FLYER_DESIGNS, HANGER_DESIGNS, renderFlyer, renderHangers } from "./brandflyer.ts";
import { EMAIL_TEMPLATES, cleanFields, emailHtml, emailText } from "./brandemail.ts";
import type { Env } from "./types.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const parse = (s: string | null | undefined): any => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const key = (c: number) => `brand:${c}`;
async function getSetting(env: Env, k: string) {
  return (await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(k).first<{ value: string }>())?.value ?? null;
}
async function putSetting(env: Env, k: string, v: string) {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(k, v).run();
}

export const TRADE_LABELS: Record<string, string> = {
  interior: "Interior painting",
  exterior: "Exterior painting",
  commercial: "Commercial painting",
  new_construction: "New construction painting",
  power_washing: "Power washing",
  drywall: "Drywall repair",
  cabinets: "Cabinet painting",
  decks_fences: "Deck and fence staining",
  fencing: "Fencing",
  remodeling: "Remodeling",
  epoxy_floors: "Epoxy floors",
  industrial: "Industrial coatings",
  accent_walls: "Accent walls",
  decorative_painting: "Decorative painting",
  decorative_texture: "Decorative texture",
  parking_lot_striping: "Parking lot striping",
  glow_paint: "Glow-in-the-dark paint",
};

/** What the brand form starts with, taken from the painter's own setup. Nothing here is saved until they press Save. */
export async function suggestBrand(env: Env, companyId: number): Promise<{ brand: Brand; hasInsurance: boolean; quoteUrl: string }> {
  const co = await env.DB.prepare("SELECT slug, name, settings FROM companies WHERE id = ?").bind(companyId).first<{ slug: string; name: string; settings: string | null }>();
  const prof = parse((await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(companyId).first<{ data: string }>())?.data) ?? {};
  const s = readSettings(co?.settings);
  const c = prof.company ?? {};
  const host = co ? (await listDomains(env)).find((d) => d.slug === co.slug && !d.host.startsWith("www."))?.host : undefined;
  const quoteUrl = co ? (host ? `https://${host}` : `https://${co.slug}.paintersmax.app`) : "https://paintersmax.app";
  const trades: string[] = Array.isArray(prof.trades) ? prof.trades : [];
  const cities: string[] = Array.isArray(prof.cities) ? prof.cities : [];
  return {
    quoteUrl,
    hasInsurance: !!prof.insurance?.carrier,
    brand: cleanBrand({
      company: co?.name ?? "",
      person: "",
      title: "Owner",
      phone: c.phone,
      email: c.email,
      website: (host ?? (co ? `${co.slug}.paintersmax.app` : "")).replace(/^www\./, ""),
      license: c.license,
      tagline: s.tagline,
      color: s.brandColor,
      logoUrl: s.logoUrl,
      qrUrl: quoteUrl,
      services: trades.map((t) => TRADE_LABELS[t]).filter(Boolean),
      area: cities.slice(0, 4).join(", "),
      insured: false,
      freeEstimates: true,
      language: prof.language?.ui === "es" ? "es" : "en",
    }),
  };
}

/** The saved brand kit, or what it would start with when nothing is saved yet. The language is the customer's, not the painter's screen. */
export async function brandFor(env: Env, companyId: number, language?: "en" | "es"): Promise<Brand> {
  const saved = parse(await getSetting(env, key(companyId)));
  const brand = saved ? cleanBrand(saved) : (await suggestBrand(env, companyId)).brand;
  return language ? { ...brand, language } : brand;
}

/**
 * /api/brand
 *  GET                               the saved brand (or null), what it would start with, and the design lists
 *  POST {action:"save", brand}       save the brand
 *  POST {action:"render", kind:"cards", design, mode, guides, brand}   printable HTML for the preview and the print window
 *  POST {action:"render", kind:"email", template, fields:{name,project,offer}, brand, subject?, text?}   subject, plain text and formatted HTML
 */
export async function handleBrand(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  if (request.method === "GET") {
    const saved = parse(await getSetting(env, key(c)));
    const sug = await suggestBrand(env, c);
    return json({ brand: saved ? cleanBrand(saved) : null, suggested: sug.brand, hasInsurance: sug.hasInsurance, quoteUrl: sug.quoteUrl, cardDesigns: CARD_DESIGNS, emailTemplates: EMAIL_TEMPLATES, flyerDesigns: FLYER_DESIGNS, hangerDesigns: HANGER_DESIGNS });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (b?.action === "save") {
    const brand = cleanBrand(b.brand);
    if (!brand.company) return json({ error: "Add your company name first." }, 400);
    await putSetting(env, key(c), JSON.stringify(brand));
    return json({ ok: true, brand });
  }
  if (b?.action === "render") {
    const brand = cleanBrand(b.brand);
    if (!brand.company) return json({ error: "Add your company name first." }, 400);
    const fallbackUrl = (await suggestBrand(env, c)).quoteUrl;
    if (b.kind === "letterhead") return json({ html: await letterheadPreview(env, c, brand) });
    if (b.kind === "cards") return json({ html: renderCards(brand, { design: b.design, mode: b.mode, guides: b.guides !== false, fallbackUrl }) });
    if (b.kind === "flyer") return json({ html: renderFlyer(brand, { design: b.design, mode: b.mode, fallbackUrl }) });
    if (b.kind === "hanger") return json({ html: renderHangers(brand, { design: b.design, mode: b.mode, guides: b.guides !== false, fallbackUrl }) });
    if (b.kind === "email") {
      const made = emailText(brand, b.template, cleanFields(b.fields));
      // The painter may have edited the message; the formatted copy follows what they wrote.
      const subject = typeof b.subject === "string" && b.subject.trim() ? b.subject.trim().slice(0, 200) : made.subject;
      const text = typeof b.text === "string" && b.text.trim() ? b.text.slice(0, 6000) : made.text;
      return json({ subject, text, html: emailHtml(brand, subject, text) });
    }
    return json({ error: "Unknown kind." }, 400);
  }
  return json({ error: "Unknown action." }, 400);
}

/**
 * The painter's letterhead for estimates, or undefined when they have not turned it on.
 * The header picture is read from their file cabinet and embedded, so the PDF and the emailed page show it without any sign-in.
 */
export async function letterheadFor(env: Env, companyId: number): Promise<{ letterhead: Letterhead; color: string; logoUrl: string } | undefined> {
  const saved = parse(await getSetting(env, key(companyId)));
  if (!saved) return undefined;
  const brand = cleanBrand(saved);
  if (!brand.letterhead.on) return undefined;
  const headerImage = brand.letterhead.style === "image" ? await headerDataUri(env, companyId, brand.letterhead.headerFileId) : "";
  return { letterhead: { style: brand.letterhead.style, headerImage, footer: brand.letterhead.footer, extra: brand.letterhead.extra }, color: brand.color, logoUrl: brand.logoUrl };
}

/** A picture from the painter's file cabinet as a data: URL, or "" when it is missing, too large or not a picture. */
export async function headerDataUri(env: Env, companyId: number, fileId: number): Promise<string> {
  if (!fileId || !env.FILES) return "";
  const row = await env.DB.prepare("SELECT r2_key, mime, bytes FROM job_files WHERE id = ? AND company_id = ? AND kind = 'marketing'").bind(fileId, companyId).first<{ r2_key: string; mime: string; bytes: number }>();
  if (!row?.r2_key || !/^image\/(png|jpeg|webp)$/.test(row.mime) || row.bytes > 1_200_000) return "";
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return "";
  const buf = new Uint8Array(await obj.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${row.mime};base64,${btoa(bin)}`;
}

/** A sample estimate on the painter's letterhead, for the preview in Brand kit. */
export async function letterheadPreview(env: Env, companyId: number, brand: Brand): Promise<string> {
  const lines = [
    { description: "Wash and rinse the exterior walls", qty: 1, unit: "flat", unitCents: 45000, section: "cold_water" as const },
    { description: "Paint two coats on the front door", qty: 1, unit: "each", unitCents: 18000 },
  ];
  const est = sanitizeEstimate({ lines: lines.map((l) => ({ ...l, unitPrice: l.unitCents / 100 })), scope: "This is a sample so you can see your letterhead. Your real estimates fill this in for you.", inclusions: ["Cleanup every day"], validDays: 30 });
  const totals = computeTotals(est, {});
  const headerImage = brand.letterhead.style === "image" ? await headerDataUri(env, companyId, brand.letterhead.headerFileId) : "";
  return renderEstimateHtml(
    {
      company: { name: brand.company, phone: brand.phone, email: brand.email, website: brand.website, license: brand.license },
      brandColor: brand.color,
      logoUrl: brand.logoUrl,
      letterhead: { style: brand.letterhead.style, headerImage, footer: brand.letterhead.footer, extra: brand.letterhead.extra },
      customer: { name: "Sample Customer", email: "customer@example.com" },
      property: "123 Main St, Your City",
      jobTitle: "Sample job",
      date: new Date().toISOString().slice(0, 10),
    },
    est,
    totals,
  );
}

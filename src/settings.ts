import type { JobType } from "./types.ts";

/** Per-company options stored as JSON in companies.settings. Everything is optional. */
export interface CompanySettings {
  brandColor?: string; // "#RRGGBB"
  logoUrl?: string; // https URL
  tagline?: string;
  /** Price per sq ft: [low, high] for each job type. Missing types use the platform defaults. */
  rates?: Partial<Record<JobType, [number, number]>>;
}

const JOB_TYPES: JobType[] = ["interior", "exterior", "both", "commercial", "multifamily"];

/** Reads stored JSON safely. Bad or missing data gives an empty object. */
export function readSettings(raw: unknown): CompanySettings {
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    return j && typeof j === "object" ? sanitize(j) : {};
  } catch {
    return {};
  }
}

/** Keeps only valid values, so nothing unexpected is ever stored or shown on a public page. */
export function sanitize(input: any): CompanySettings {
  const out: CompanySettings = {};
  if (typeof input?.brandColor === "string" && /^#[0-9a-fA-F]{6}$/.test(input.brandColor)) out.brandColor = input.brandColor;
  if (typeof input?.logoUrl === "string" && /^https:\/\/[^\s"'<>]{3,300}$/.test(input.logoUrl)) out.logoUrl = input.logoUrl;
  if (typeof input?.tagline === "string" && input.tagline.trim()) out.tagline = input.tagline.trim().slice(0, 140);
  if (input?.rates && typeof input.rates === "object") {
    const rates: NonNullable<CompanySettings["rates"]> = {};
    for (const t of JOB_TYPES) {
      const r = input.rates[t];
      if (Array.isArray(r) && r.length === 2) {
        const lo = Number(r[0]);
        const hi = Number(r[1]);
        if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0.25 && hi <= 50 && lo <= hi) rates[t] = [lo, hi];
      }
    }
    if (Object.keys(rates).length) out.rates = rates;
  }
  return out;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Fills the public quote page template for one company. */
export function renderQuotePage(template: string, c: { slug: string; name: string }, s: CompanySettings, proofUrl?: string | null): string {
  const e = escapeHtml;
  const logo = s.logoUrl ? `<img class="logo" src="${e(s.logoUrl)}" alt="${e(c.name)}">` : "";
  return template
    .replaceAll("{{NAME}}", e(c.name))
    .replaceAll("{{SLUG}}", e(c.slug))
    .replaceAll("{{COLOR}}", s.brandColor ?? "#E8A33D")
    .replaceAll("{{LOGO}}", logo)
    .replaceAll("{{INSURED}}", proofUrl ? `<p class="insured">&#10003; Insured &middot; <a href="${e(proofUrl)}" target="_blank" rel="noopener">View proof of insurance</a></p>` : "")
    .replaceAll("{{TAGLINE}}", e(s.tagline ?? "Tell us about the job and see a price range in seconds. Add photos for a more accurate estimate."));
}

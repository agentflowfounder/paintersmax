import { normalizePlan, type Plan } from "./usage.ts";

/** Trades a painter can sell. "fencing" and "remodeling" are here so Tyler Painters can use the wizard for non-painting work. */
export const TRADES = [
  "interior",
  "exterior",
  "commercial",
  "new_construction",
  "power_washing",
  "drywall",
  "cabinets",
  "decks_fences",
  "fencing",
  "remodeling",
  "epoxy_floors",
  "industrial",
] as const;
export type Trade = (typeof TRADES)[number];

/** How many trades and cities each plan can list in the business profile. */
export const PROFILE_CAPS: Record<Plan, { services: number; cities: number }> = {
  free: { services: 1, cities: 1 },
  starter: { services: 2, cities: 2 },
  basic: { services: 5, cities: 6 },
  pro: { services: 15, cities: 25 },
};

export const METHODS = ["room_size", "sqft_floor", "sqft_wall", "items", "line_items", "lump_sum", "per_linear_ft"] as const;

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export interface Profile {
  company: { legalName?: string; phone?: string; email?: string; address?: string; city?: string; state?: string; zip?: string; license?: string; website?: string };
  trades: Trade[];
  cities: string[];
  insurance: { carrier?: string; coverage?: string; expires?: string; shareSummary?: boolean };
  labor: { crewSize?: number; hourlyRate?: number; helperRate?: number; markupPct?: number; overheadPct?: number; minimumJob?: number; depositPct?: number; paymentTerms?: string };
  warranty: { laborMonths?: number; text?: string; exclusions?: string };
  materials: { brands?: string[]; notes?: string };
  language: { ui?: "en" | "es"; crewDocs?: "en" | "es" };
}

/** Keeps only valid, size-limited values. Anything unexpected is dropped, never stored. */
export function sanitizeProfile(input: any, plan: string): Profile {
  const caps = PROFILE_CAPS[normalizePlan(plan)];
  const c = input?.company ?? {};
  const ins = input?.insurance ?? {};
  const l = input?.labor ?? {};
  const w = input?.warranty ?? {};
  const m = input?.materials ?? {};
  const lang = input?.language ?? {};
  const trades = Array.isArray(input?.trades)
    ? Array.from(new Set(input.trades.filter((t: unknown): t is Trade => (TRADES as readonly string[]).includes(String(t))))).slice(0, caps.services) as Trade[]
    : [];
  const cities = Array.isArray(input?.cities)
    ? Array.from(new Set(input.cities.map((x: unknown) => str(x, 60)).filter(Boolean))).slice(0, caps.cities) as string[]
    : [];
  const out: Profile = {
    company: {
      legalName: str(c.legalName, 120) || undefined,
      phone: str(c.phone, 40) || undefined,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(c.email, 200)) ? str(c.email, 200) : undefined,
      address: str(c.address, 160) || undefined,
      city: str(c.city, 60) || undefined,
      state: str(c.state, 40) || undefined,
      zip: str(c.zip, 10) || undefined,
      license: str(c.license, 80) || undefined,
      website: /^https:\/\/[^\s"'<>]{3,200}$/.test(str(c.website, 200)) ? str(c.website, 200) : undefined,
    },
    trades,
    cities,
    insurance: {
      carrier: str(ins.carrier, 120) || undefined,
      coverage: str(ins.coverage, 200) || undefined,
      expires: /^\d{4}-\d{2}-\d{2}$/.test(str(ins.expires, 10)) ? str(ins.expires, 10) : undefined,
      shareSummary: ins.shareSummary === true,
    },
    labor: {
      crewSize: num(l.crewSize, 1, 200),
      hourlyRate: num(l.hourlyRate, 0, 1000),
      helperRate: num(l.helperRate, 0, 1000),
      markupPct: num(l.markupPct, 0, 300),
      overheadPct: num(l.overheadPct, 0, 300),
      minimumJob: num(l.minimumJob, 0, 100000),
      depositPct: num(l.depositPct, 0, 100),
      paymentTerms: str(l.paymentTerms, 300) || undefined,
    },
    warranty: {
      laborMonths: num(w.laborMonths, 0, 240),
      text: str(w.text, 2000) || undefined,
      exclusions: str(w.exclusions, 2000) || undefined,
    },
    materials: {
      brands: Array.isArray(m.brands) ? m.brands.map((x: unknown) => str(x, 60)).filter(Boolean).slice(0, 30) : undefined,
      notes: str(m.notes, 1000) || undefined,
    },
    language: {
      ui: lang.ui === "es" ? "es" : "en",
      crewDocs: lang.crewDocs === "es" ? "es" : "en",
    },
  };
  return out;
}

/**
 * Rate card numbers: nested objects of numbers (up to 3 levels), keys limited to letters, digits and underscores.
 * Works for every pricing method without a separate validator per method. Text values are dropped.
 */
export function sanitizeRateData(input: unknown, depth = 0): any {
  if (depth > 3 || input === null || typeof input !== "object") return undefined;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k) || ++count > 60) continue;
    if (typeof v === "object" && v !== null) {
      const nested = sanitizeRateData(v, depth + 1);
      if (nested && Object.keys(nested).length) out[k] = nested;
    } else {
      const n = num(v, 0, 10_000_000);
      if (n !== undefined) out[k] = n;
    }
  }
  return out;
}

export function isTrade(v: unknown): v is Trade {
  return typeof v === "string" && (TRADES as readonly string[]).includes(v);
}

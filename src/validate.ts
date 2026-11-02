import type { JobType, QuoteRequest } from "./types.ts";

const JOB_TYPES: JobType[] = ["interior", "exterior", "both", "commercial", "multifamily"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns a clean request, or an error message. Trims and caps every field. */
export function parseQuoteRequest(body: any): { ok: true; value: QuoteRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = str(body.name, 120);
  const email = str(body.email, 200);
  const sqft = Number(body.sqft);
  const jobType = str(body.jobType, 20) as JobType;
  if (!name) return { ok: false, error: "Please enter your name." };
  if (!EMAIL.test(email)) return { ok: false, error: "Please enter a valid email." };
  if (!JOB_TYPES.includes(jobType)) return { ok: false, error: "Please choose a job type." };
  if (!Number.isFinite(sqft) || sqft < 100 || sqft > 500000) {
    return { ok: false, error: "Square feet must be between 100 and 500,000." };
  }
  const photoUrls = Array.isArray(body.photoUrls)
    ? body.photoUrls.filter((u: unknown) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 5)
    : [];
  return {
    ok: true,
    value: {
      name,
      email,
      phone: str(body.phone, 40) || undefined,
      zip: str(body.zip, 10) || undefined,
      jobType,
      sqft: Math.round(sqft),
      details: str(body.details, 2000) || undefined,
      photoUrls,
      companySlug: str(body.companySlug, 60) || "dfw-painters",
    },
  };
}

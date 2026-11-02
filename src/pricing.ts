import type { JobType } from "./types.ts";

// Placeholder $/sq ft ranges. Later each company can override these in companies.settings.
const RATES: Record<JobType, [number, number]> = {
  interior: [2.0, 3.5],
  exterior: [1.75, 4.0],
  both: [3.25, 6.5],
  commercial: [1.5, 3.5],
  multifamily: [1.25, 3.0],
};

/** Deterministic price range in cents. The AI writes the explanation but never sets the numbers. */
export function priceRange(jobType: JobType, sqft: number): { lowCents: number; highCents: number } {
  const [lo, hi] = RATES[jobType];
  const round = (n: number) => Math.round(n / 50) * 50 * 100; // nearest $50
  return { lowCents: round(lo * sqft), highCents: round(hi * sqft) };
}

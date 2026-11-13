/**
 * Gentle nudges on Home: at most two quiet reminders, each from a fact in the painter's own records.
 * Each can be snoozed for a week. Pure logic so it can be tested.
 */
export interface NudgeFacts {
  tradesWithoutPrices: string[]; // services chosen that have no saved prices
  staleDraftEstimates: number; // estimates saved but not sent for 2+ days
  cityDraftPages: number; // city pages saved but not published
  commercialBidUnused: boolean; // Basic plan, offers commercial, free commercial bid not used yet
}
export interface Nudge {
  key: string;
  text: string;
  link: string;
}

export const SNOOZE_DAYS = 7;
export const MAX_NUDGES = 2;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildNudges(f: NudgeFacts, snoozed: Record<string, string>, now = Date.now()): Nudge[] {
  const all: Nudge[] = [];
  if (f.staleDraftEstimates > 0) {
    all.push({ key: "draft_estimates", link: "/jobs", text: `You have ${f.staleDraftEstimates} saved ${plural(f.staleDraftEstimates, "estimate", "estimates")} that ${plural(f.staleDraftEstimates, "has", "have")} not been sent yet. A quick look might be all they need.` });
  }
  if (f.tradesWithoutPrices.length > 0) {
    all.push({ key: "missing_prices", link: "/app", text: `You offer ${f.tradesWithoutPrices.join(", ")} but have not set ${plural(f.tradesWithoutPrices.length, "its prices", "their prices")} yet. Estimates fill in faster once you do.` });
  }
  if (f.commercialBidUnused) {
    all.push({ key: "commercial_bid", link: "/jobs", text: "Your free commercial bid is still waiting. You can build one from any commercial job." });
  }
  if (f.cityDraftPages > 0) {
    all.push({ key: "city_drafts", link: "/citypages", text: `${f.cityDraftPages} city ${plural(f.cityDraftPages, "page is", "pages are")} saved as ${plural(f.cityDraftPages, "a draft", "drafts")}. Add a local detail and publish when you are ready.` });
  }
  return all
    .filter((n) => {
      const until = Date.parse(snoozed[n.key] ?? "");
      return !(Number.isFinite(until) && until > now);
    })
    .slice(0, MAX_NUDGES);
}

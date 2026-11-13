/**
 * Gentle nudges on Home: at most two quiet reminders, each from a fact in the painter's own records.
 * Each can be snoozed for a week. Pure logic so it can be tested.
 */
export interface NudgeFacts {
  tradesWithoutPrices: string[]; // services chosen that have no saved prices
  staleDraftEstimates: number; // estimates saved but not sent for 2+ days
  cityDraftPages: number; // city pages saved but not published
  commercialBidUnused: boolean; // Basic plan, offers commercial, free commercial bid not used yet
  warrantiesEnding?: number; // sent warranty certificates that end within 60 days
  plan?: string; // free | starter | basic | pro
  storagePercent?: number; // 0-100+ of the plan's photo and file storage
  daysSinceDownload?: number; // days since the last records download, or since sign-up if never
  month?: number; // 1-12, for the tax-season reminder
  downloadedThisTaxYear?: boolean; // a download since January 1
}
export interface Nudge {
  key: string;
  text: string;
  link: string;
}

export const SNOOZE_DAYS = 7;
/** How often each plan is reminded to download its records and free up space. */
export const DOWNLOAD_REMINDER_DAYS: Record<string, number> = { free: 90, starter: 182, basic: 365, pro: 30 };
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
  if ((f.warrantiesEnding ?? 0) > 0) {
    all.push({ key: "warranty_ending", link: "/jobs", text: `${f.warrantiesEnding} ${plural(f.warrantiesEnding ?? 0, "warranty ends", "warranties end")} within 60 days. A friendly check-in call is a good way to earn a review or a repeat job.` });
  }
  if ((f.storagePercent ?? 0) >= 80) {
    all.unshift({ key: "storage_high", link: "/jobs", text: `You are using ${Math.round(f.storagePercent!)}% of your photo and file storage. Open a finished job, download its file, and free up space. Nothing is removed unless you say so.` });
  }
  const cadence = DOWNLOAD_REMINDER_DAYS[f.plan ?? "free"] ?? 90;
  if (f.month !== undefined && f.month >= 1 && f.month <= 4 && f.downloadedThisTaxYear === false) {
    all.push({ key: "tax_season", link: "/records", text: "Tax season: download your year-end records (expenses, mileage, crew hours and the 1099 list) for your accountant." });
  } else if ((f.daysSinceDownload ?? 0) >= cadence) {
    all.push({ key: "download_records", link: "/records", text: f.plan === "pro" ? "Your monthly records summary is ready to download. Your data stays safe here, and a copy on your computer is a good habit." : "It has been a while since you downloaded your records. Download them and free up storage. Your data stays safe here either way." });
  }
  return all
    .filter((n) => {
      const until = Date.parse(snoozed[n.key] ?? "");
      return !(Number.isFinite(until) && until > now);
    })
    .slice(0, MAX_NUDGES);
}

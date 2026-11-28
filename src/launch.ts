import { LAST_BACKUP_KEY } from "./backup.ts";
import { readBlob, updateBlob } from "./kv.ts";
import { SAMPLES_KEY, readSamplesSetting } from "./samples.ts";
import { loadStarter } from "./starter.ts";
import { keyMode, NEEDED_EVENTS } from "./stripecheck.ts";
import { TIER_DEMO_SIG_KEY } from "./tierdemos.ts";
import type { Env } from "./types.ts";

/**
 * Admin > Launch checklist (Rogelio, 2026-11-23). Everything to do before and on launch day, in one list.
 * Items the app can check itself show a green check by themselves; the rest the owner ticks by hand (saved in
 * app_settings "launchlist", no database change). Nothing here changes Stripe or sends anything.
 */
export const LAUNCH_KEY = "launchlist";
export interface LaunchItem { id: string; group: "Money" | "Safety" | "Content" | "Customers"; label: string; how: string; auto: boolean; done: boolean; note?: string }

/** The hand-ticked items: id, group, label, how. */
export const MANUAL_ITEMS: { id: string; group: LaunchItem["group"]; label: string; how: string }[] = [
  { id: "live_purchase", group: "Money", label: "One real purchase made and refunded on the live site", how: "After the live keys are in, buy the cheapest door with a real card on /start, check Admin > Subscriptions shows it, then refund it in Stripe." },
  { id: "live_webhook_test", group: "Money", label: "Live webhook test passed", how: "In live mode, Stripe > Developers > Webhooks > your destination > Event deliveries shows 200 for the purchase above." },
  { id: "limits_checked", group: "Money", label: "Plan limits and Google lookups checked", how: "Admin > Plan limits: confirm the limits per plan and today's Google address lookups look right, then tick this." },
  { id: "two_factor", group: "Safety", label: "Admin sign-in switched to an authenticator app with recovery codes", how: "Ask for the authenticator build, then give owner and staff 7 days to switch." },
  { id: "preview_builds_off", group: "Safety", label: "Cloudflare \"Builds for Preview branches\" is OFF", how: "Cloudflare > paintersmax-site > Settings > Builds. Previews build against the live database." },
  { id: "wildcard_dns", group: "Safety", label: "Wildcard DNS and route work (client sites open at their own address)", how: "Open demo-local-pro.paintersmax.app. It should show the example site." },
  { id: "help_reviewed", group: "Content", label: "All help pages reviewed and updated", how: "Admin > Help guide. Features changed since they were written." },
  { id: "pricing_pages", group: "Content", label: "Pricing and tier pages show Local Pro, Contractor and Commercial", how: "Open /pricing and the Website upgrade window and read every price once." },
  { id: "broadcast_address", group: "Customers", label: "Real business address in the broadcast email footer", how: "Replace the placeholder Dallas address after your Texas LLC is registered." },
  { id: "broadcast_on", group: "Customers", label: "Broadcast emails switched on", how: "Marketing > Broadcasts > Email settings." },
  { id: "preview_tested", group: "Safety", label: "You tried the estimate flow on the preview link and it works", how: "Open the preview from the latest pull request, make a bid, create an estimate, save a version, download the PDF." },
  { id: "print_partners", group: "Content", label: "Print partner research read, and affiliate wording approved by you", how: "Read the print partner research. No page may name a partner or promise a price until you approve the wording." },
  { id: "campaign_dates", group: "Customers", label: "Christmas campaign and Applies-by-itself are set", how: "Admin > Starter campaign and Promotions." },
];

export const readTicks = (raw: unknown): Record<string, boolean> => {
  const t = ((raw as any)?.done ?? {}) as Record<string, unknown>;
  const ids = new Set(MANUAL_ITEMS.map((m) => m.id));
  return Object.fromEntries(Object.keys(t).filter((k) => ids.has(k) && t[k] === true).map((k) => [k, true]));
};

/** The checks the app can make from what it already knows. Pure, so it can be tested. */
export function autoItems(f: { keyMode: string; webhookSecret: boolean; endpointsOk: boolean | null; lastEventAt: string | null; backupOn: string; today: string; demosBuilt: boolean; samplesOn: boolean; welcomeOn: boolean; emailOn?: boolean; aiOn?: boolean; filesOn?: boolean; stripeKeyIsLiveNote?: string }): LaunchItem[] {
  const days = f.backupOn ? Math.round((Date.parse(f.today) - Date.parse(f.backupOn)) / 86400000) : null;
  const it = (id: string, group: LaunchItem["group"], label: string, how: string, done: boolean, note?: string): LaunchItem => ({ id, group, label, how, auto: true, done, note });
  return [
    it("live_key", "Money", "Live Stripe secret key is in Cloudflare", "Stripe > Developers > API keys (live mode) > Secret key. Cloudflare > paintersmax-site > Settings > Variables and Secrets > STRIPE_SECRET_KEY.", f.keyMode === "live", f.keyMode === "test" ? "Still test keys." : f.keyMode === "missing" ? "No key set." : undefined),
    it("webhook_secret", "Money", "Webhook signing secret is set", "Copy the whsec_ value of the live destination into STRIPE_WEBHOOK_SECRET.", f.webhookSecret),
    it("webhook_events", "Money", `Stripe sends all ${NEEDED_EVENTS.length} events to this site`, "Live destination URL https://paintersmax.app/api/stripe/webhook with: " + NEEDED_EVENTS.join(", ") + ".", f.endpointsOk === true, f.endpointsOk === null ? "Could not read the Stripe webhooks (restricted key?)." : undefined),
    it("event_received", "Money", "A Stripe event has reached the site", "Use the Test Stripe button in Subscriptions (test mode) or a real purchase.", !!f.lastEventAt),
    it("backup", "Safety", "A database backup was downloaded in the last 7 days", "Admin > Team and audit log > Download backup (owner only).", days !== null && days <= 7, days === null ? "No backup yet." : `Last backup ${days} days ago.`),
    it("demos", "Content", "Tier example sites are built", "Admin > Websites > Build tier example sites.", f.demosBuilt),
    it("samples", "Content", "Sample content for new accounts is on", "Admin > Settings > Sample content for new accounts.", f.samplesOn),
    ...(f.emailOn === undefined ? [] : [it("email_key", "Customers", "Email service key is set (estimates, invoices and reminders can send)", "Cloudflare > paintersmax-site > Settings > Variables and Secrets > RESEND_API_KEY.", f.emailOn)]),
    ...(f.aiOn === undefined ? [] : [it("ai_key", "Content", "AI key is set (estimate help, Ask and Talk can answer)", "Cloudflare > paintersmax-site > Settings > Variables and Secrets > GEMINI_API_KEY.", f.aiOn)]),
    ...(f.filesOn === undefined ? [] : [it("files_bucket", "Safety", "File storage is connected (photos, My files, letterheads)", "Cloudflare > R2 bucket paintersmax-files must be bound as FILES on the Worker.", f.filesOn)]),
    it("welcome", "Customers", "Welcome credits are on", "Admin > Starter campaign.", f.welcomeOn),
  ];
}

export async function launchChecklist(env: Env, today: string, stripe: { endpointsOk: boolean | null; lastEventAt: string | null }): Promise<{ items: LaunchItem[]; done: number; total: number }> {
  const [ticks, backup, demos, samples, starter] = await Promise.all([
    readBlob(env, LAUNCH_KEY, readTicks),
    readBlob(env, LAST_BACKUP_KEY, (raw: any) => (typeof raw?.on === "string" ? raw.on : "")),
    readBlob(env, TIER_DEMO_SIG_KEY, (raw: any) => typeof raw?.sig === "string"),
    readBlob(env, SAMPLES_KEY, readSamplesSetting),
    loadStarter(env),
  ]);
  const auto = autoItems({ keyMode: keyMode(env.STRIPE_SECRET_KEY), webhookSecret: !!env.STRIPE_WEBHOOK_SECRET, endpointsOk: stripe.endpointsOk, lastEventAt: stripe.lastEventAt, backupOn: backup, today, demosBuilt: demos, samplesOn: samples.on, welcomeOn: starter.on, emailOn: !!env.RESEND_API_KEY, aiOn: !!env.GEMINI_API_KEY, filesOn: !!env.FILES });
  const manual: LaunchItem[] = MANUAL_ITEMS.map((m) => ({ ...m, auto: false, done: !!ticks[m.id] }));
  const items = [...auto, ...manual];
  return { items, done: items.filter((i) => i.done).length, total: items.length };
}

export async function tickLaunch(env: Env, id: string, done: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!MANUAL_ITEMS.some((m) => m.id === id)) return { ok: false, error: "That item is checked by the app, not by hand." };
  const r = await updateBlob<{ done: Record<string, boolean> }>(env, LAUNCH_KEY, (raw) => ({ done: readTicks(raw) }), (cur) => {
    const next = { ...cur.done };
    if (done) next[id] = true;
    else delete next[id];
    return { value: { done: next } };
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

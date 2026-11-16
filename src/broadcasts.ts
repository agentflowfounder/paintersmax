import { getSessionUser } from "./auth.ts";
import { todayLocal } from "./dates.ts";
import { sendLeadEmail } from "./email.ts";
import { blobsWithPrefix, isDate, newId, readBlob, str, updateBlob, writeBlob } from "./kv.ts";
import { allSubs, isDoor, loadDoor, loadSub, subState, type Door, type SubRow } from "./subscriptions.ts";
import type { Env } from "./types.ts";

/**
 * Broadcasts: one message from PaintersMax to a group of clients, as a notice on their dashboard, an email, or both.
 *
 * Nothing leaves the building by accident:
 *  - A draft reaches nobody. "Send test" emails only the admin who clicks it.
 *  - Real emails stay blocked until the owner switches emails on in the broadcast settings.
 *  - Sending needs the owner role and the recipient count typed back as a confirmation.
 *  - Clients flagged "do not contact", clients who unsubscribed, and cancelled or refunded clients never get an email.
 *  - Sending runs in small batches and records who was handled, so a second click never sends twice.
 *
 * Every email ends with the footer Rogelio approved (2026-11-16), which includes the mailing address. {business} becomes the client's business name and
 * {unsubscribe} becomes that client's own one-click unsubscribe link.
 *
 * Stored in app_settings: bc:<id> (the broadcast), bcs:<id> (who was handled), bcsettings (footer and the email switch),
 * bcun:<companyId> (that client's unsubscribe token and whether they opted out).
 */

export const SITE = "https://paintersmax.app";
/** Rogelio's wording (approved 2026-11-16) plus the mailing address he gave. He will replace the address once the LLC is registered. */
export const DEFAULT_FOOTER = "You are receiving this message because {business} has a PaintersMax account. Click here to unsubscribe: {unsubscribe}\n\nPaintersMax, Dallas, TX 75201";

export const WHO = ["all", "free", "paid", "due", "missed"] as const;
export type Who = (typeof WHO)[number];
export const WHO_LABELS: Record<Who, string> = {
  all: "Everyone with an account",
  free: "Free accounts",
  paid: "Paid clients (Launch, Grow, Signature)",
  due: "Renewal due in the next 60 days",
  missed: "Missed renewal",
};

export interface Broadcast {
  id: string;
  title: string; // for the team only
  subject: string;
  subjectEs: string;
  body: string;
  bodyEs: string;
  who: Who;
  doors: Door[]; // empty = every door
  email: boolean;
  banner: boolean;
  bannerUntil: string; // YYYY-MM-DD, the last day the dashboard notice shows
  status: "draft" | "sending" | "sent";
  createdBy: string;
  createdOn: string;
  sentBy: string;
  sentOn: string;
  audienceAtSend: number;
  confirmedCount: number;
}

export interface Progress {
  claimed: number[]; // companies being or already handled
  emailed: number[];
  failed: number[];
}

export interface BroadcastSettings {
  footer: string;
  emailsOn: boolean;
  setBy: string;
  setOn: string;
}

const MAX_BROADCASTS = 200;
export const BATCH = 20;
const GAP_MS = 600; // the email service allows about two a second
export const bcKey = (id: string) => `bc:${id}`;
const progressKey = (id: string) => `bcs:${id}`;
export const SETTINGS_KEY = "bcsettings";
const unKey = (c: number) => `bcun:${c}`;

export function readBroadcast(raw: unknown): Broadcast | null {
  const r = raw as any;
  const id = str(r?.id, 24);
  if (!/^[a-z0-9]{6,24}$/.test(id)) return null;
  return {
    id,
    title: str(r.title, 100),
    subject: str(r.subject, 120),
    subjectEs: str(r.subjectEs, 120),
    body: str(r.body, 4000),
    bodyEs: str(r.bodyEs, 4000),
    who: (WHO as readonly string[]).includes(r.who) ? r.who : "all",
    doors: Array.isArray(r.doors) ? [...new Set((r.doors as unknown[]).filter(isDoor))] : [],
    email: r.email === true,
    banner: r.banner === true,
    bannerUntil: isDate(r.bannerUntil) ? r.bannerUntil : "",
    status: r.status === "sent" || r.status === "sending" ? r.status : "draft",
    createdBy: str(r.createdBy, 200),
    createdOn: isDate(r.createdOn) ? r.createdOn : "",
    sentBy: str(r.sentBy, 200),
    sentOn: str(r.sentOn, 30),
    audienceAtSend: Number.isInteger(r.audienceAtSend) ? r.audienceAtSend : 0,
    confirmedCount: Number.isInteger(r.confirmedCount) ? r.confirmedCount : 0,
  };
}

const ids = (v: unknown): number[] => (Array.isArray(v) ? [...new Set((v as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);
export const readProgress = (raw: unknown): Progress => ({ claimed: ids((raw as any)?.claimed), emailed: ids((raw as any)?.emailed), failed: ids((raw as any)?.failed) });
export const readSettings = (raw: unknown): BroadcastSettings => ({
  footer: str((raw as any)?.footer, 1500) || DEFAULT_FOOTER,
  emailsOn: (raw as any)?.emailsOn === true,
  setBy: str((raw as any)?.setBy, 200),
  setOn: str((raw as any)?.setOn, 30),
});

export const loadSettings = (env: Env) => readBlob(env, SETTINGS_KEY, readSettings);
export const loadProgress = (env: Env, id: string) => readBlob(env, progressKey(id), readProgress);
export async function loadBroadcasts(env: Env): Promise<Broadcast[]> {
  const rows = await blobsWithPrefix(env, "bc:", 1000);
  return rows.map((r) => readBroadcast(r.value)).filter((b): b is Broadcast => !!b).sort((a, b) => (a.createdOn < b.createdOn ? 1 : a.createdOn > b.createdOn ? -1 : a.id < b.id ? 1 : -1));
}

/** Can real emails go out right now, and if not, why. */
export function emailBlocker(s: BroadcastSettings): string {
  if (!s.emailsOn) return "Broadcast emails are switched off in the broadcast settings.";
  if (!s.footer.includes("{unsubscribe}")) return "The email footer must contain {unsubscribe}, where each client's unsubscribe link goes.";
  return "";
}

// ---------------------------------------------------------------- unsubscribe

export interface Unsub {
  token: string;
  optedOut: boolean;
  on: string;
}
const readUnsub = (raw: unknown): Unsub => ({ token: /^[a-f0-9]{32}$/.test(str((raw as any)?.token, 40)) ? (raw as any).token : "", optedOut: (raw as any)?.optedOut === true, on: str((raw as any)?.on, 30) });
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A client's own unsubscribe token, made the first time it is needed and kept after that. */
export async function unsubToken(env: Env, companyId: number): Promise<string> {
  const r = await updateBlob(env, unKey(companyId), readUnsub, (cur) => (cur.token ? { value: cur } : { value: { ...cur, token: randomToken() } }));
  return r.ok ? r.value.token : "";
}
export const unsubLink = (companyId: number, token: string) => `${SITE}/unsubscribe?c=${companyId}&t=${token}`;

async function optedOutIds(env: Env): Promise<Set<number>> {
  const out = new Set<number>();
  for (const r of await blobsWithPrefix(env, "bcun:", 10000)) if ((r.value as any)?.optedOut === true) out.add(Number(r.key.slice(5)));
  return out;
}

/** Looks up a link. Returns the business name for a valid link, so the page can say whose account it is. */
export async function unsubLookup(env: Env, c: unknown, t: unknown): Promise<{ name: string; optedOut: boolean } | null> {
  const id = Number(c);
  const token = str(t, 40);
  if (!Number.isInteger(id) || id < 1 || !/^[a-f0-9]{32}$/.test(token)) return null;
  const u = await readBlob(env, unKey(id), readUnsub);
  if (!u.token || u.token !== token) return null;
  const co = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(id).first<{ name: string }>();
  return co ? { name: co.name, optedOut: u.optedOut } : null;
}

/** Opts the client out (or back in) of broadcast emails. They still get service emails such as receipts and replies. */
export async function unsubSet(env: Env, c: unknown, t: unknown, out: boolean): Promise<{ ok: true; name: string } | { ok: false }> {
  const found = await unsubLookup(env, c, t);
  if (!found) return { ok: false };
  await updateBlob(env, unKey(Number(c)), readUnsub, (cur) => ({ value: { ...cur, optedOut: out, on: new Date().toISOString() } }));
  return { ok: true, name: found.name };
}

// ---------------------------------------------------------------- who is in the audience

/** Whether one client (by door and subscription state) is in an audience. Cancelled and refunded clients never are. */
export function inAudience(b: Pick<Broadcast, "who" | "doors">, door: Door, state: string): boolean {
  if (state === "cancelled" || state === "refunded") return false;
  if (b.doors.length && !b.doors.includes(door)) return false;
  switch (b.who) {
    case "free": return door === "free";
    case "paid": return door !== "free";
    case "due": return state === "due_60" || state === "due_30";
    case "missed": return state === "missed";
    default: return true;
  }
}

async function noContact(env: Env): Promise<Set<number>> {
  const out = new Set<number>();
  for (const r of await blobsWithPrefix(env, "admnote:", 10000)) {
    if (Array.isArray((r.value as any)?.flags) && (r.value as any).flags.includes("do_not_contact")) out.add(Number(r.key.slice(8)));
  }
  return out;
}

/** The clients a broadcast email would reach: one per company (the first login), with an email, never the PaintersMax company itself. */
export async function audienceRows(env: Env, b: Pick<Broadcast, "who" | "doors">, today: string) {
  const [subs, blocked, unsub] = await Promise.all([allSubs(env, today), noContact(env), optedOutIds(env)]);
  const inside = subs.filter((s) => s.slug !== "paintersmax-master" && inAudience(b, s.door, s.state));
  const rows = inside.filter((s) => s.email && !blocked.has(s.companyId) && !unsub.has(s.companyId));
  return {
    rows,
    inside: inside.length,
    skippedNoContact: inside.filter((s) => blocked.has(s.companyId)).length,
    skippedUnsubscribed: inside.filter((s) => unsub.has(s.companyId)).length,
    skippedNoEmail: inside.filter((s) => !s.email).length,
  };
}

// ---------------------------------------------------------------- drafts

export async function saveBroadcast(env: Env, b: any, by: string, today: string) {
  const id = str(b?.id, 24);
  const list = await loadBroadcasts(env);
  const cur = id ? list.find((x) => x.id === id) : undefined;
  if (id && !cur) return { ok: false as const, error: "Broadcast not found." };
  if (cur && cur.status !== "draft") return { ok: false as const, error: "A broadcast that was sent cannot be changed." };
  if (!cur && list.length >= MAX_BROADCASTS) return { ok: false as const, error: "Too many broadcasts. Delete old drafts." };
  const next = readBroadcast({
    ...(cur ?? { id: newId().slice(0, 12), createdBy: by, createdOn: today }),
    title: b.title, subject: b.subject, subjectEs: b.subjectEs, body: b.body, bodyEs: b.bodyEs, who: b.who, doors: b.doors, email: b.email === true, banner: b.banner === true, bannerUntil: b.bannerUntil,
  });
  if (!next || !next.title) return { ok: false as const, error: "Give the broadcast a name for the team." };
  if (!next.email && !next.banner) return { ok: false as const, error: "Choose email, a dashboard notice, or both." };
  if (!next.subject || !next.body) return { ok: false as const, error: "Write the subject and the message in English." };
  if (next.banner && !next.bannerUntil) return { ok: false as const, error: "Choose the last day the dashboard notice shows (YYYY-MM-DD)." };
  if (next.banner && next.bannerUntil < today) return { ok: false as const, error: "The last day cannot be in the past." };
  await writeBlob(env, bcKey(next.id), next);
  return { ok: true as const, broadcast: next };
}

export async function deleteBroadcast(env: Env, id: unknown) {
  const key = bcKey(str(id, 24));
  const cur = readBroadcast(await readBlob(env, key, (r) => r));
  if (!cur) return { ok: false as const, error: "Broadcast not found." };
  if (cur.status !== "draft") return { ok: false as const, error: "A broadcast that was sent is kept for the record." };
  await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(key).run();
  return { ok: true as const, broadcast: cur };
}

export async function saveSettings(env: Env, b: any, by: string, today: string) {
  const r = await updateBlob(env, SETTINGS_KEY, readSettings, (cur) => {
    const footer = b?.footer !== undefined ? str(b.footer, 1500) : cur.footer;
    const emailsOn = b?.emailsOn === undefined ? cur.emailsOn : b.emailsOn === true;
    if (!footer.includes("{unsubscribe}")) return { error: "The footer must contain {unsubscribe}, where each client's unsubscribe link goes." };
    return { value: { footer, emailsOn, setBy: by, setOn: today } };
  });
  return r.ok ? { ok: true as const, settings: r.value } : { ok: false as const, error: r.error };
}

// ---------------------------------------------------------------- email text

/** The footer for one client: their business name and their own unsubscribe link. */
export const fillFooter = (footer: string, business: string, link: string) => footer.replaceAll("{business}", business).replaceAll("{unsubscribe}", link);

/** English first, then Spanish when it is written, then the footer. */
export function emailText(b: Pick<Broadcast, "body" | "bodyEs">, footer: string): string {
  return [b.body, b.bodyEs, footer ? `--\n${footer}` : ""].filter(Boolean).join("\n\n");
}
export const emailSubject = (b: Pick<Broadcast, "subject" | "subjectEs">) => (b.subjectEs ? `${b.subject} / ${b.subjectEs}` : b.subject);

/** Sends the broadcast to the admin only, so they can see it before anyone else does. Works before emails are switched on. */
export async function sendTest(env: Env, b: any, to: string) {
  const bc = readBroadcast(await readBlob(env, bcKey(str(b?.id, 24)), (r) => r));
  if (!bc) return { ok: false as const, error: "Broadcast not found." };
  const s = await loadSettings(env);
  const footer = fillFooter(s.footer, "Your Business Name", `${SITE}/unsubscribe (a test: your real link is different for each client)`);
  const res = await sendLeadEmail(env, to, `[TEST] ${emailSubject(bc)}`, emailText(bc, footer));
  return res === "sent" ? { ok: true as const } : { ok: false as const, error: "The test email was not sent (the email service is not set up in this environment)." };
}

// ---------------------------------------------------------------- sending

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends the next batch. The first call needs `confirm` equal to the number of clients the broadcast reaches;
 * it fixes the audience count and publishes the dashboard notice. Later calls carry on until nobody is left.
 */
export async function sendBatch(env: Env, b: any, by: string, today: string): Promise<{ ok: true; broadcast: Broadcast; remaining: number; sentNow: number } | { ok: false; error: string }> {
  const id = str(b?.id, 24);
  const bc = readBroadcast(await readBlob(env, bcKey(id), (r) => r));
  if (!bc) return { ok: false, error: "Broadcast not found." };
  if (bc.status === "sent") return { ok: false, error: "This broadcast was already sent." };
  const settings = await loadSettings(env);
  if (bc.email) {
    const why = emailBlocker(settings);
    if (why) return { ok: false, error: why };
  }
  if (bc.banner && bc.bannerUntil < today) return { ok: false, error: "The last day of the dashboard notice is in the past. Change it first." };
  const { rows } = await audienceRows(env, bc, today);
  if (bc.status === "draft") {
    if (Number(b?.confirm) !== rows.length) return { ok: false, error: `Type ${rows.length}, the number of clients this reaches, to confirm.` };
    if (!rows.length) return { ok: false, error: "Nobody is in this audience." };
    await writeBlob(env, bcKey(id), { ...bc, status: "sending", sentBy: by, sentOn: new Date().toISOString(), audienceAtSend: rows.length, confirmedCount: Number(b.confirm) });
  } else if (bc.sentBy && bc.sentBy !== by) {
    return { ok: false, error: `${bc.sentBy} started this send. They can finish it.` };
  }
  const cur = readBroadcast(await readBlob(env, bcKey(id), (r) => r)) ?? bc;
  let mine: SubRow[] = [];
  if (cur.email) {
    // Claim the next batch before sending, so two clicks at once cannot email anyone twice.
    const claim = await updateBlob(env, progressKey(id), readProgress, (p) => {
      mine = rows.filter((r) => !p.claimed.includes(r.companyId)).slice(0, BATCH);
      return { value: { ...p, claimed: [...p.claimed, ...mine.map((r) => r.companyId)] } };
    });
    if (!claim.ok) return { ok: false, error: claim.error };
    const sent: number[] = [];
    const failed: number[] = [];
    for (const r of mine) {
      const token = await unsubToken(env, r.companyId);
      if (!token) {
        failed.push(r.companyId); // never send an email that has no working unsubscribe link
        continue;
      }
      const footer = fillFooter(settings.footer, r.name, unsubLink(r.companyId, token));
      const res = await sendLeadEmail(env, r.email, emailSubject(cur), emailText(cur, footer)).catch(() => "skipped" as const);
      (res === "sent" ? sent : failed).push(r.companyId);
      await sleep(GAP_MS);
    }
    await updateBlob(env, progressKey(id), readProgress, (p) => ({ value: { ...p, emailed: [...new Set([...p.emailed, ...sent])], failed: [...new Set([...p.failed, ...failed])] } }));
  }
  const p = await loadProgress(env, id);
  const remaining = cur.email ? rows.filter((r) => !p.claimed.includes(r.companyId)).length : 0;
  if (remaining === 0) await writeBlob(env, bcKey(id), { ...cur, status: "sent" });
  const done = readBroadcast(await readBlob(env, bcKey(id), (r) => r)) ?? cur;
  return { ok: true, broadcast: done, remaining, sentNow: mine.length };
}

export async function progressView(env: Env, id: string) {
  const p = await loadProgress(env, id);
  return { emailed: p.emailed.length, failed: p.failed.length };
}

// ---------------------------------------------------------------- the dashboard notice

/** Notices a signed-in company should see today: sent broadcasts with a notice that has not ended and whose audience includes the company. */
export async function bannersFor(env: Env, companyId: number, plan: unknown, today: string) {
  const live = (await loadBroadcasts(env)).filter((b) => b.banner && b.status !== "draft" && b.bannerUntil >= today);
  if (!live.length) return [];
  const door = await loadDoor(env, companyId, plan);
  const sub = await loadSub(env, companyId);
  const state = subState(door, sub, today).state;
  return live.filter((b) => inAudience(b, door, state)).slice(0, 3).map((b) => ({ id: b.id, subject: b.subject, subjectEs: b.subjectEs, body: b.body, bodyEs: b.bodyEs }));
}

// ---------------------------------------------------------------- client-facing routes

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * GET  /api/broadcasts                   (signed in) the dashboard notices for this client
 * GET  /api/unsubscribe?c=<id>&t=<token> (public) whose account the link is for, and whether it is already unsubscribed
 * POST /api/unsubscribe {c, t, undo?}    (public) unsubscribes (or, with undo, subscribes again). A link opened by a mail scanner
 *                                        only does a GET, so it never unsubscribes anyone by itself.
 */
export async function handleBroadcastsApi(request: Request, env: Env, pathname: string): Promise<Response> {
  if (pathname === "/api/broadcasts") {
    const user = await getSessionUser(env, request);
    if (!user) return json({ error: "Not signed in." }, 401);
    const co = await env.DB.prepare("SELECT plan FROM companies WHERE id = ?").bind(user.companyId).first<{ plan: string }>();
    return json({ banners: await bannersFor(env, user.companyId, co?.plan, todayLocal()) });
  }
  if (request.method === "GET") {
    const u = new URL(request.url);
    const f = await unsubLookup(env, u.searchParams.get("c"), u.searchParams.get("t"));
    return f ? json(f) : json({ error: "This link is not valid." }, 404);
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const r = await unsubSet(env, b?.c, b?.t, b?.undo !== true);
  return r.ok ? json({ ok: true, name: r.name, optedOut: b?.undo !== true }) : json({ error: "This link is not valid." }, 404);
}

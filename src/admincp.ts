import { can, listAudit, PERMS, ROLE_LIMITS, setTeamRole, teamView, type AdminActor, type Area } from "./adminroles.ts";
import { CREDIT_COST, creditView, grantCredits } from "./credits.ts";
import { FEATURE_LABELS } from "./creditsapi.ts";
import { listDomains } from "./domains.ts";
import { envelopeUse, forgetClientModel, FEATURE_GROUP, GROUP_LABELS, GROUPS, loadEnvelopes, saveEnvelopes } from "./envelopes.ts";
import { adminFeedbackAct, adminFeedbackList, feedbackForCompany, saveQuick } from "./feedback.ts";
import { decideHeld, domainQueue, loadHeld, saveHeld } from "./helddomains.ts";
import { blobsWithPrefix, readBlob, str, updateBlob } from "./kv.ts";
import { CHANNELS, loadPromos, normCode, promoPrice, promoUses, savePromo, setPromoActive, validatePromo } from "./promos.ts";
import { addLesson, contactCounts, contactsCsv, importContacts, loadContacts, loadMarkets, OUTREACH_STATUSES, saveContact, saveMarket } from "./research.ts";
import {
  allSubs, applyOutreach, applyRenewed, applySubEdit, DOOR_LABELS, DOOR_PRICES, DOORS, isDoor, loadDoor, loadSub, PAID_DOORS, readSub, renewalCentsFor, setDoor, subKey, subState, subTotals,
} from "./subscriptions.ts";
import { creditMenu, firstWeeksReport, loadStarter, saveStarter, signupsThisWeek, STARTER_COSTS, STARTER_DEFAULTS, starterStats } from "./starter.ts";
import { FEATURES, monthKey, usageSummary, type Feature } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * The new areas of the admin control panel (blueprint stage 1, approved 2026-11-14): client page, subscriptions,
 * promotions, credits and envelopes, marketing research, feedback inbox, held domains and the team.
 * admin.ts checks who is signed in, checks the role for each action, and writes the audit log.
 */

export const FLAGS = ["needs_help", "at_risk", "vip", "trade_group", "do_not_contact"] as const;
export type Flag = (typeof FLAGS)[number];
interface ClientNotes {
  notes: { at: string; by: string; text: string }[];
  flags: Flag[];
}
const notesKey = (c: number) => `admnote:${c}`;
function readNotes(raw: unknown): ClientNotes {
  const r = raw as any;
  return {
    notes: Array.isArray(r?.notes) ? r.notes.filter((n: any) => str(n?.text, 1000)).map((n: any) => ({ at: str(n.at, 30), by: str(n.by, 200), text: str(n.text, 1000) })).slice(-100) : [],
    flags: Array.isArray(r?.flags) ? [...new Set((r.flags as unknown[]).filter((f): f is Flag => (FLAGS as readonly string[]).includes(f as string)))] : [],
  };
}

const companyExists = async (env: Env, id: unknown) => {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  return env.DB.prepare("SELECT id, slug, name, plan, created_at AS createdAt, stripe_customer_id AS customerId, stripe_subscription_id AS subscriptionId FROM companies WHERE id = ?")
    .bind(n)
    .first<{ id: number; slug: string; name: string; plan: string; createdAt: string; customerId: string | null; subscriptionId: string | null }>();
};

/** Everything about one client on one page. */
export async function clientPage(env: Env, actor: AdminActor, id: unknown, today: string) {
  const co = await companyExists(env, id);
  if (!co) return null;
  const c = co.id;
  const [users, counts, door, sub, credits, usage, envl, envUse, notes, held, connected, fb, timeline] = await Promise.all([
    env.DB.prepare("SELECT email, role, created_at AS createdAt, (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = users.id) AS lastSignIn FROM users WHERE company_id = ? ORDER BY id").bind(c).all(),
    env.DB.prepare("SELECT (SELECT COUNT(*) FROM leads WHERE company_id = ?) AS leads, (SELECT COUNT(*) FROM jobs WHERE company_id = ?) AS jobs, (SELECT COUNT(*) FROM jobs WHERE company_id = ? AND created_at > datetime('now','-30 days')) AS jobs30, (SELECT COUNT(*) FROM leads WHERE company_id = ? AND created_at > datetime('now','-30 days')) AS leads30").bind(c, c, c, c).first(),
    loadDoor(env, c, co.plan),
    loadSub(env, c),
    creditView(env, c, today),
    usageSummary(env, { id: c, plan: co.plan, createdAt: co.createdAt }),
    loadEnvelopes(env, c),
    envelopeUse(env, c, monthKey()),
    readBlob(env, notesKey(c), readNotes),
    loadHeld(env),
    listDomains(env),
    can(actor.role, "feedback", "see") ? feedbackForCompany(env, c) : Promise.resolve([]),
    listAudit(env, { companyId: c, limit: 50 }),
  ]);
  const st = subState(door, sub, today);
  return {
    phone: (await companyPhones(env)).get(c) ?? "",
    company: { id: c, slug: co.slug, name: co.name, plan: co.plan, createdAt: co.createdAt, stripeCustomer: !!co.customerId, stripeSubscription: !!co.subscriptionId },
    users: users.results,
    counts,
    door,
    subscription: sub ? { ...sub, ...st, renewalCents: renewalCentsFor(door, sub) } : null,
    state: st.state,
    credits: { balance: credits.balance, nextExpiry: credits.nextExpiry, grants: credits.grants.slice(-30).reverse() },
    usage: usage.features.filter((f) => f.used || f.creditUses || f.missed).map((f) => ({ ...f, label: FEATURE_LABELS[f.feature as Feature], credits: f.creditUses * CREDIT_COST[f.feature as Feature], group: FEATURE_GROUP[f.feature as Feature] })),
    period: usage.period,
    envelopes: { ...envl, used: envUse },
    notes: notes.notes.slice().reverse(),
    flags: notes.flags,
    domains: held.filter((d) => d.companyId === c).map((d) => ({ ...d, ...domainQueue(d, today, sub && sub.status !== "active" ? sub.cancelledOn : null) })),
    connected: connected.filter((d) => d.slug === co.slug).map((d) => d.host),
    feedback: fb.map((t) => ({ id: t.id, kind: t.kind, status: t.status, updatedAt: t.updatedAt, first: t.messages[0]?.text.slice(0, 160) ?? "" })),
    timeline: can(actor.role, "security", "see") || can(actor.role, "clients", "see") ? timeline : [],
  };
}

/** The client list with door, state and flags, for the Clients tab. */
/** Each painter's phone: the number in their business profile, or the one they gave at sign-up. */
export async function companyPhones(env: Env): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const b of await blobsWithPrefix(env, "signup:", 10000)) {
    const ph = (b.value as any)?.phone;
    if (typeof ph === "string" && ph) out.set(Number(b.key.slice(7)), ph);
  }
  const rows = await env.DB.prepare("SELECT company_id AS id, json_extract(data, '$.company.phone') AS phone FROM company_profiles").all<{ id: number; phone: string | null }>();
  for (const r of rows.results ?? []) if (r.phone) out.set(r.id, r.phone);
  return out;
}

export async function clientList(env: Env, today: string) {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.slug, c.name, c.plan, c.created_at AS createdAt,
            (SELECT GROUP_CONCAT(email, ', ') FROM users WHERE company_id = c.id) AS owners,
            (SELECT COUNT(*) FROM jobs WHERE company_id = c.id) AS jobs,
            (SELECT COUNT(*) FROM leads WHERE company_id = c.id) AS leads,
            (SELECT MAX(s.created_at) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.company_id = c.id) AS lastSignIn
       FROM companies c ORDER BY c.id`,
  ).all<any>();
  const phones = await companyPhones(env);
  const subs = new Map((await allSubs(env, today)).map((s) => [s.companyId, s]));
  const flags = new Map((await blobsWithPrefix(env, "admnote:", 10000)).map((r) => [Number(r.key.slice(8)), readNotes(r.value).flags]));
  return (rows.results ?? []).map((r) => ({ ...r, phone: phones.get(r.id) ?? "", door: subs.get(r.id)?.door ?? "free", state: subs.get(r.id)?.state ?? "free", renewsOn: subs.get(r.id)?.renewsOn ?? "", flags: flags.get(r.id) ?? [] }));
}

/** Credit use across every client for one month: by tool, by envelope, the top clients and what was granted. */
export async function creditsOverview(env: Env, month: string) {
  const m = /^\d{4}-\d{2}$/.test(month) ? month : monthKey();
  const rows = await env.DB.prepare("SELECT company_id AS c, feature, count FROM usage_counters WHERE period = ? AND company_id > 0 AND feature NOT LIKE '%:v:%'").bind(m).all<{ c: number; feature: string; count: number }>();
  const tools = new Map<Feature, { uses: number; creditUses: number; credits: number; missed: number; blocked: number; clients: Set<number> }>();
  const byClient = new Map<number, number>();
  for (const f of FEATURES) tools.set(f, { uses: 0, creditUses: 0, credits: 0, missed: 0, blocked: 0, clients: new Set() });
  for (const r of rows.results ?? []) {
    const [f, suffix] = r.feature.split(":") as [Feature, string | undefined];
    const t = tools.get(f);
    if (!t) continue;
    if (!suffix) {
      t.uses += r.count;
      if (r.count) t.clients.add(r.c);
    } else if (suffix === "credit") {
      t.creditUses += r.count;
      t.credits += r.count * CREDIT_COST[f];
      byClient.set(r.c, (byClient.get(r.c) ?? 0) + r.count * CREDIT_COST[f]);
    } else if (suffix === "missed") t.missed += r.count;
    else if (suffix === "envelope") t.blocked += r.count;
  }
  const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const names = new Map<number, string>();
  if (top.length) {
    const res = await env.DB.prepare(`SELECT id, name FROM companies WHERE id IN (${top.map(() => "?").join(",")})`).bind(...top.map((t) => t[0])).all<{ id: number; name: string }>();
    for (const c of res.results ?? []) names.set(c.id, c.name);
  }
  const granted: Record<string, number> = {};
  for (const r of await blobsWithPrefix(env, "aicred:", 10000)) {
    for (const g of ((r.value as any)?.grants ?? []) as any[]) if (typeof g?.on === "string" && g.on.startsWith(m)) granted[g.source ?? "pack"] = (granted[g.source ?? "pack"] ?? 0) + (Number(g.credits) || 0);
  }
  const groups = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<string, number>;
  for (const [f, t] of tools) groups[FEATURE_GROUP[f]] += t.credits;
  return {
    month: m,
    tools: [...tools.entries()].map(([f, t]) => ({ feature: f, label: FEATURE_LABELS[f], group: FEATURE_GROUP[f], cost: CREDIT_COST[f], uses: t.uses, creditUses: t.creditUses, credits: t.credits, missed: t.missed, blocked: t.blocked, clients: t.clients.size })),
    groups: GROUPS.map((g) => ({ id: g, label: GROUP_LABELS[g], credits: groups[g] })),
    top: top.map(([c, n]) => ({ companyId: c, name: names.get(c) ?? `#${c}`, credits: n })),
    granted,
  };
}

/** Admin-facing GET views. Returns null when the query is not one of these. */
export async function adminView(env: Env, actor: AdminActor, url: URL, today: string): Promise<{ area: Area; data: unknown } | { area: Area; csv: string; filename: string } | null> {
  const q = url.searchParams;
  if (q.get("me") === "1") return { area: "clients", data: { email: actor.email, role: actor.role, see: PERMS[actor.role].see, change: PERMS[actor.role].change, limits: ROLE_LIMITS[actor.role] } };
  if (q.has("client")) return { area: "clients", data: await clientPage(env, actor, q.get("client"), today) };
  if (q.get("signups") === "1") return { area: "clients", data: await signupsThisWeek(env, today) };
  if (q.get("clients") === "1") return { area: "clients", data: { clients: await clientList(env, today), flags: FLAGS, doors: DOORS } };
  if (q.get("subs") === "1") {
    const rows = await allSubs(env, today);
    return { area: "subscriptions", data: { rows, totals: subTotals(rows, today), prices: DOOR_PRICES, doors: DOORS, labels: DOOR_LABELS } };
  }
  if (q.get("promos") === "1") {
    const [list, uses] = await Promise.all([loadPromos(env), promoUses(env)]);
    return {
      area: "promos",
      data: {
        promos: list.map((p) => ({ ...p, uses: uses.get(p.code) ?? 0, live: p.active && today >= p.startsOn && today <= p.endsOn, prices: Object.fromEntries(PAID_DOORS.map((d) => [d, { signup: promoPrice(d, "signup", p, today).cents, renewal: promoPrice(d, "renewal", p, today).cents }])) })),
        channels: CHANNELS,
        prices: DOOR_PRICES,
      },
    };
  }
  if (q.get("credits") === "1") return { area: "credits", data: await creditsOverview(env, q.get("month") ?? "") };
  if (q.get("starter") === "1") {
    const [settings, stats, firstWeeks] = await Promise.all([loadStarter(env), starterStats(env, today), firstWeeksReport(env, today)]);
    return { area: "credits", data: { settings, defaults: STARTER_DEFAULTS, stats, firstWeeks, menu: creditMenu(settings.welcomeCredits), costs: STARTER_COSTS } };
  }
  if (q.get("research") === "1") {
    const markets = await loadMarkets(env);
    const withCounts = await Promise.all(markets.map(async (m) => ({ ...m, counts: contactCounts(await loadContacts(env, m.id)) })));
    return { area: "research", data: { markets: withCounts, statuses: OUTREACH_STATUSES } };
  }
  if (q.has("contacts")) {
    const id = str(q.get("contacts"), 24);
    const list = await loadContacts(env, id);
    if (q.get("csv") === "1") return { area: "research", csv: contactsCsv(list), filename: `contacts-${id}-${today}.csv` };
    return { area: "research", data: { contacts: list, counts: contactCounts(list) } };
  }
  if (q.get("feedback") === "1") return { area: "feedback", data: await adminFeedbackList(env, q.get("status"), { assignee: q.get("assignee") ?? "", kind: q.get("kind") ?? "" }) };
  if (q.get("held") === "1") {
    const [held, subs] = await Promise.all([loadHeld(env), allSubs(env, today)]);
    const ended = new Map<number, string>();
    for (const r of await blobsWithPrefix(env, "sub:", 10000)) {
      const s = readSub(r.value);
      if (s && s.status !== "active" && s.cancelledOn) ended.set(Number(r.key.slice(4)), s.cancelledOn);
    }
    const names = new Map(subs.map((s) => [s.companyId, s.name]));
    return {
      area: "domains",
      data: { domains: held.map((d) => ({ ...d, client: d.companyId ? names.get(d.companyId) ?? `#${d.companyId}` : "", ...domainQueue(d, today, d.companyId ? ended.get(d.companyId) ?? null : null) })), clients: subs.map((s) => ({ id: s.companyId, name: s.name })) },
    };
  }
  if (q.get("team") === "1") return { area: "security", data: { team: await teamView(env) } };
  if (q.get("audit") === "1") {
    const company = Number(q.get("company"));
    return { area: "security", data: { entries: await listAudit(env, { companyId: Number.isInteger(company) && company > 0 ? company : undefined, by: q.get("by") ?? undefined, before: q.get("before") ?? undefined }) } };
  }
  return null;
}

type ActResult = { ok: true; data?: Record<string, unknown>; companyId?: number | null; detail?: unknown } | { ok: false; error: string; status?: number };

/** The area each new action belongs to. admin.ts checks the role can change it before calling adminAct. */
export const ACT_AREAS: Record<string, Area> = {
  client_note: "clients", client_flags: "clients",
  door_set: "subscriptions", sub_set: "subscriptions", sub_renewed: "subscriptions", sub_outreach: "subscriptions",
  promo_save: "promos", promo_active: "promos",
  envelopes_set: "credits", bundle_apply: "credits", starter_set: "credits",
  market_save: "research", market_lesson: "research", contact_save: "research", contacts_import: "research",
  feedback_reply: "feedback",
  quickreply_save: "feedback",
  held_save: "domains", held_decide: "domains",
  team_set: "security",
};

export async function adminAct(env: Env, actor: AdminActor, b: any, today: string): Promise<ActResult> {
  const fail = (error: string, status = 400): ActResult => ({ ok: false, error, status });
  switch (b?.action) {
    case "client_note": {
      const co = await companyExists(env, b.companyId);
      if (!co) return fail("Client not found.", 404);
      const text = str(b.text, 1000);
      if (!text) return fail("Write the note.");
      const r = await updateBlob(env, notesKey(co.id), readNotes, (cur) => ({ value: { ...cur, notes: [...cur.notes, { at: new Date().toISOString(), by: actor.email, text }].slice(-100) } }));
      return r.ok ? { ok: true, companyId: co.id, detail: text.slice(0, 120) } : fail(r.error);
    }
    case "client_flags": {
      const co = await companyExists(env, b.companyId);
      if (!co) return fail("Client not found.", 404);
      const flags = readNotes({ flags: b.flags }).flags;
      const r = await updateBlob(env, notesKey(co.id), readNotes, (cur) => ({ value: { ...cur, flags } }));
      return r.ok ? { ok: true, companyId: co.id, detail: flags.join(",") || "none" } : fail(r.error);
    }
    case "door_set": {
      const co = await companyExists(env, b.companyId);
      if (!co) return fail("Client not found.", 404);
      if (!isDoor(b.door)) return fail("Choose a door.");
      const before = await loadDoor(env, co.id, co.plan);
      const r = await setDoor(env, co.id, b.door);
      return r.ok ? { ok: true, companyId: co.id, detail: `${before} -> ${b.door}` } : fail(r.error);
    }
    case "sub_set":
    case "sub_renewed":
    case "sub_outreach": {
      const co = await companyExists(env, b.companyId);
      if (!co) return fail("Client not found.", 404);
      const door = await loadDoor(env, co.id, co.plan);
      const paidCents = Math.round(Number(b.paid) * 100);
      if (b.action === "sub_renewed" && !(Number.isFinite(paidCents) && paidCents >= 0 && paidCents <= 1_000_000)) return fail("Enter what the client paid for the renewal.");
      const r = await updateBlob(env, subKey(co.id), readSub, (cur) =>
        b.action === "sub_set" ? applySubEdit(cur, b, today) : b.action === "sub_renewed" ? applyRenewed(cur, paidCents) : applyOutreach(cur, b, today),
      );
      if (!r.ok) return fail(r.error);
      const s = r.value!;
      return { ok: true, companyId: co.id, data: { subscription: { ...s, ...subState(door, s, today) } }, detail: b.action === "sub_outreach" ? `${s.outreach}${s.outreachNote ? `: ${s.outreachNote.slice(0, 80)}` : ""}` : `${s.status}, renews ${s.renewsOn}, paid ${(s.paidCents / 100).toFixed(2)}` };
    }
    case "promo_save": {
      const v = validatePromo(b.promo, { maxBonus: ROLE_LIMITS[actor.role].maxPromoBonus, today, by: actor.email });
      if ("error" in v) return fail(v.error);
      const r = await savePromo(env, v.promo, b.isNew === true);
      return r.ok ? { ok: true, detail: `${v.promo.code} ${v.promo.kind} ${v.promo.value} ${v.promo.startsOn}..${v.promo.endsOn} bonus ${v.promo.bonusCredits}` } : fail(r.error);
    }
    case "promo_active": {
      const code = normCode(b.code);
      const r = await setPromoActive(env, code, b.active === true);
      return r.ok ? { ok: true, detail: `${code} ${b.active === true ? "on" : "off"}` } : fail(r.error, 404);
    }
    case "envelopes_set": {
      const co = await companyExists(env, b.companyId);
      if (!co) return fail("Client not found.", 404);
      const r = await saveEnvelopes(env, co.id, b, actor.email, today);
      if (!r.ok) return fail(r.error);
      forgetClientModel(co.id);
      return { ok: true, companyId: co.id, data: { envelopes: r.value }, detail: { enabled: r.value.enabled, painter: r.value.painterCanEdit, caps: r.value.caps, model: r.value.textModel } };
    }
    case "starter_set": {
      const r = await saveStarter(env, b.settings);
      if (!r.ok) return fail(r.error);
      const v = await loadStarter(env);
      return { ok: true, data: { settings: v }, detail: `on ${v.on} welcome ${v.welcomeCredits}/${v.welcomeDays}d cap ${v.dailyCap}/day visitor ${v.perVisitorDaily}` };
    }
    case "bundle_apply": {
      // Grant a bundle of credits and, if given, point them at envelopes in one step.
      const co = await companyExists(env, b.companyId);
      if (!co) return fail("Client not found.", 404);
      const credits = Math.round(Number(b.credits));
      const max = ROLE_LIMITS[actor.role].maxGrantCredits;
      if (!Number.isFinite(credits) || credits < 1) return fail("Enter how many credits to add.");
      if (credits > max) return fail(max ? `Your role can add up to ${max} credits at a time.` : "Your role cannot add credits.");
      const note = str(b.note, 100);
      const g = await grantCredits(env, co.id, { id: `admin:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`, credits, source: "admin", note }, today);
      if (!g.ok) return fail(g.error ?? "Could not add credits.");
      if (b.caps && typeof b.caps === "object") {
        const r = await saveEnvelopes(env, co.id, { enabled: true, caps: b.caps, ...(b.textModel ? { textModel: b.textModel } : {}) }, actor.email, today);
        if (!r.ok) return fail(`Credits were added, but the envelopes were not saved: ${r.error}`);
        forgetClientModel(co.id);
      }
      return { ok: true, companyId: co.id, detail: `${credits} credits${note ? ` (${note})` : ""}${b.caps ? ` caps ${JSON.stringify(b.caps)}` : ""}` };
    }
    case "market_save": {
      const r = await saveMarket(env, b.market ?? {}, today);
      return r.ok ? { ok: true, data: { market: r.result }, detail: r.result?.name } : fail(r.error);
    }
    case "market_lesson": {
      const r = await addLesson(env, str(b.marketId, 24), b.text, actor.email, today);
      return r.ok ? { ok: true, detail: str(b.text, 120) } : fail(r.error);
    }
    case "contact_save": {
      const r = await saveContact(env, str(b.marketId, 24), b.contact ?? {}, actor.email, today);
      return r.ok ? { ok: true, data: { contact: r.result }, detail: `${r.result?.company}: ${r.result?.status}` } : fail(r.error);
    }
    case "contacts_import": {
      const r = await importContacts(env, str(b.marketId, 24), b.csv);
      return r.ok ? { ok: true, data: r.result as Record<string, unknown>, detail: r.result } : fail(r.error);
    }
    case "feedback_reply": {
      const r = await adminFeedbackAct(env, b, actor.email);
      const did = [b.text ? "replied" : "", b.note ? "noted" : "", typeof b.assignee === "string" ? `assigned ${r.ok ? r.thread.assignee || "nobody" : ""}` : ""].filter(Boolean).join(", ");
      return r.ok ? { ok: true, companyId: r.thread.companyId, data: { thread: r.thread }, detail: `${b.id} ${r.thread.status}${did ? ` ${did}` : ""}` } : fail(r.error);
    }
    case "quickreply_save": {
      const r = await saveQuick(env, b);
      return r.ok ? { ok: true, detail: b.remove === true ? `deleted quick reply ${str(b.id, 20)}` : `quick reply ${r.result?.title}` } : fail(r.error);
    }
    case "held_save": {
      const r = await saveHeld(env, b.domain ?? {});
      return r.ok ? { ok: true, companyId: r.result?.companyId ?? null, detail: `${r.result?.name} ${r.result?.status} expires ${r.result?.expiresOn}` } : fail(r.error);
    }
    case "held_decide": {
      const r = await decideHeld(env, b);
      return r.ok ? { ok: true, companyId: r.result?.companyId ?? null, detail: `${r.result?.name} ${b.decision}${b.expiresOn ? ` to ${b.expiresOn}` : ""}` } : fail(r.error);
    }
    case "team_set": {
      if (actor.role !== "owner") return fail("Only the owner can change the team.", 403);
      const r = await setTeamRole(env, actor, b.email, b.role, today);
      return r.ok ? { ok: true, data: { created: r.created }, detail: `${str(b.email, 200).toLowerCase()} -> ${b.role}` } : fail(r.error);
    }
  }
  return fail("Unknown action.");
}


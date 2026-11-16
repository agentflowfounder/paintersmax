import { isDate, newId, readBlob, str, updateBlob } from "./kv.ts";
import type { Env } from "./types.ts";

/**
 * Marketing research: the region-by-region cycle (business model doc, 500 members section).
 * A market is a region (North and East Texas first) with its cities, a status and a lessons log.
 * Each market has a contact list of painting companies with an outreach status and an owner, so an employee can run
 * region five the way Rogelio ran region one.
 *
 * Only public business details belong here (business name, business phone, public email, website, review count).
 * Stored in app_settings: research:markets, and research:c:<marketId> per market.
 */

export type MarketStatus = "planned" | "active" | "done";
export interface Market {
  id: string;
  name: string;
  state: string;
  cities: string[];
  status: MarketStatus;
  notes: string;
  lessons: { on: string; by: string; text: string }[];
  createdOn: string;
  /** Market pack fields. Fill only from a named real source; leave empty when unknown (never estimate). */
  painterCount: number | null; // painting companies in the metro
  source: string; // where painterCount came from (agency, table, year, link)
  gatheringPlaces: string[]; // where painters gather: paint store counters, supply houses, trade groups, online groups
  channels: string[]; // legal lead channels to work in this market
  priority: number | null; // 1 = work first
}

export const OUTREACH_STATUSES = ["new", "called", "texted", "emailed", "visited", "no_answer", "free", "paid", "declined"] as const;
export type ContactStatus = (typeof OUTREACH_STATUSES)[number];
export type Lang = "en" | "es" | "both" | "";
export type SuggestedDoor = "launch" | "grow" | "signature";

export interface Contact {
  id: string;
  company: string;
  person: string;
  phone: string;
  email: string;
  website: string;
  city: string;
  reviews: number | null;
  lang: Lang;
  door: SuggestedDoor;
  status: ContactStatus;
  owner: string;
  lastOn: string;
  note: string;
  code: string; // the promo or channel code used with this painter
}

export const MARKETS_KEY = "research:markets";
export const contactsKey = (marketId: string) => `research:c:${marketId}`;
const MAX_MARKETS = 60;
export const MAX_CONTACTS = 3000;

/** No site and few reviews: Launch buyers. Fifty reviews or more: Grow or Signature. */
export function suggestDoor(website: string, reviews: number | null): SuggestedDoor {
  if ((reviews ?? 0) >= 150) return "signature";
  if ((reviews ?? 0) >= 50) return "grow";
  return website ? "grow" : "launch";
}

function wholeOrNull(v: unknown, max: number, min = 0): number | null {
  if (v === "" || v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : null;
}
/** A list from an array, or from text with one item per line. */
function lines(v: unknown): string[] {
  const list = typeof v === "string" ? v.split(/\n/) : Array.isArray(v) ? v : [];
  return list.map((x: unknown) => str(x, 160)).filter(Boolean).slice(0, 40);
}

export function readMarkets(raw: unknown): Market[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Market[] = [];
  for (const m of list) {
    const id = str(m?.id, 24);
    if (!/^[a-z0-9]{4,24}$/.test(id) || !str(m?.name, 80)) continue;
    out.push({
      id,
      name: str(m.name, 80),
      state: str(m.state, 2).toUpperCase(),
      cities: Array.isArray(m.cities) ? m.cities.map((c: unknown) => str(c, 60)).filter(Boolean).slice(0, 80) : [],
      status: m.status === "active" || m.status === "done" ? m.status : "planned",
      notes: str(m.notes, 2000),
      lessons: Array.isArray(m.lessons) ? m.lessons.filter((l: any) => isDate(l?.on) && str(l?.text, 1000)).map((l: any) => ({ on: l.on, by: str(l.by, 200), text: str(l.text, 1000) })).slice(-200) : [],
      createdOn: isDate(m.createdOn) ? m.createdOn : "",
      painterCount: wholeOrNull(m.painterCount, 1000000),
      source: str(m.source, 500),
      gatheringPlaces: lines(m.gatheringPlaces),
      channels: lines(m.channels),
      priority: wholeOrNull(m.priority, 99, 1),
    });
  }
  return out.slice(0, MAX_MARKETS);
}

const digits = (s: string) => s.replace(/[^\d+]/g, "").slice(0, 16);
export function readContact(c: any): Contact | null {
  const company = str(c?.company, 120);
  if (!company) return null;
  const reviewsN = c?.reviews === "" || c?.reviews == null ? null : Math.round(Number(c.reviews));
  const reviews = reviewsN !== null && Number.isFinite(reviewsN) && reviewsN >= 0 ? Math.min(reviewsN, 100000) : null;
  const website = str(c?.website, 200);
  const email = str(c?.email, 200).toLowerCase();
  return {
    id: /^[a-z0-9]{4,24}$/.test(String(c?.id ?? "")) ? c.id : newId(),
    company,
    person: str(c?.person, 80),
    phone: digits(str(c?.phone, 40)),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    website,
    city: str(c?.city, 60),
    reviews,
    lang: c?.lang === "en" || c?.lang === "es" || c?.lang === "both" ? c.lang : "",
    door: c?.door === "launch" || c?.door === "grow" || c?.door === "signature" ? c.door : suggestDoor(website, reviews),
    status: (OUTREACH_STATUSES as readonly string[]).includes(c?.status) ? c.status : "new",
    owner: str(c?.owner, 200).toLowerCase(),
    lastOn: isDate(c?.lastOn) ? c.lastOn : "",
    note: str(c?.note, 500),
    code: str(c?.code, 24).toUpperCase(),
  };
}
export function readContacts(raw: unknown): Contact[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Contact[] = [];
  const ids = new Set<string>();
  for (const c of list) {
    const r = readContact(c);
    if (r && !ids.has(r.id)) {
      ids.add(r.id);
      out.push(r);
    }
  }
  return out.slice(0, MAX_CONTACTS);
}

export const loadMarkets = (env: Env) => readBlob(env, MARKETS_KEY, readMarkets);
export const loadContacts = (env: Env, marketId: string) => readBlob(env, contactsKey(marketId), readContacts);

export async function saveMarket(env: Env, b: any, today: string) {
  return updateBlob(env, MARKETS_KEY, readMarkets, (list) => {
    const id = str(b?.id, 24);
    const i = id ? list.findIndex((m) => m.id === id) : -1;
    if (id && i < 0) return { error: "Market not found." };
    if (!str(b?.name, 80)) return { error: "Give the market a name." };
    if (i < 0 && list.length >= MAX_MARKETS) return { error: "Too many markets." };
    const cities = typeof b?.cities === "string" ? b.cities.split(/[,\n]/) : Array.isArray(b?.cities) ? b.cities : [];
    const base = i >= 0 ? list[i] : { id: newId().slice(0, 12), lessons: [], createdOn: today };
    const m = readMarkets([{ ...base, name: b.name, state: b.state, cities, status: b.status, notes: b.notes, painterCount: b.painterCount, source: b.source, gatheringPlaces: b.gatheringPlaces, channels: b.channels, priority: b.priority }])[0];
    if (!m) return { error: "Check the market fields." };
    const next = [...list];
    if (i >= 0) next[i] = m;
    else next.push(m);
    return { value: next, result: m };
  });
}

export async function addLesson(env: Env, marketId: string, text: unknown, by: string, today: string) {
  return updateBlob(env, MARKETS_KEY, readMarkets, (list) => {
    const i = list.findIndex((m) => m.id === marketId);
    if (i < 0) return { error: "Market not found." };
    const t = str(text, 1000);
    if (!t) return { error: "Write the lesson." };
    const next = [...list];
    next[i] = { ...next[i], lessons: [...next[i].lessons, { on: today, by, text: t }].slice(-200) };
    return { value: next };
  });
}

/** Adds or edits one contact. A status change stamps today's date and the person who made it. */
export async function saveContact(env: Env, marketId: string, b: any, by: string, today: string) {
  if (!(await loadMarkets(env)).some((m) => m.id === marketId)) return { ok: false as const, error: "Market not found." };
  return updateBlob(env, contactsKey(marketId), readContacts, (list) => {
    const id = str(b?.id, 24);
    const i = id ? list.findIndex((c) => c.id === id) : -1;
    if (id && i < 0) return { error: "Contact not found." };
    if (i < 0 && list.length >= MAX_CONTACTS) return { error: `A market holds up to ${MAX_CONTACTS} contacts.` };
    const prev = i >= 0 ? list[i] : null;
    const merged = { ...(prev ?? {}), ...b, id: prev?.id };
    // A changed website or review count updates the suggestion unless someone picked a door by hand.
    if (b?.door === undefined || b?.door === "") delete merged.door;
    const c = readContact(merged);
    if (!c) return { error: "Enter the company name." };
    if (!prev || prev.status !== c.status) {
      c.lastOn = today;
      if (!c.owner) c.owner = by.toLowerCase();
    }
    const next = [...list];
    if (i >= 0) next[i] = c;
    else next.push(c);
    return { value: next, result: c };
  });
}

// ---------------------------------------------------------------- CSV in and out

/** Splits CSV text into rows (quoted fields, commas and new lines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (ch === '"') q = false;
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else f += ch;
  }
  row.push(f);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const HEADERS: Record<string, keyof Contact> = {
  company: "company", business: "company", name: "company", "company name": "company", "business name": "company",
  contact: "person", person: "person", owner: "person", phone: "phone", "phone number": "phone", email: "email",
  website: "website", site: "website", url: "website", city: "city", reviews: "reviews", "review count": "reviews",
  language: "lang", lang: "lang", note: "note", notes: "note", status: "status", code: "code",
};

/** Contacts from a CSV with a header row. Rows without a company name are skipped; duplicates (same phone or same name and city) are skipped. */
export function contactsFromCsv(text: string, existing: Contact[]): { add: Contact[]; skipped: number } {
  const rows = parseCsv(text.slice(0, 1_000_000));
  if (rows.length < 2) return { add: [], skipped: 0 };
  const map = rows[0].map((h) => HEADERS[h.trim().toLowerCase()] ?? null);
  const seen = new Set(existing.flatMap((c) => [c.phone ? `p:${c.phone}` : "", `n:${c.company.toLowerCase()}|${c.city.toLowerCase()}`]).filter(Boolean));
  const add: Contact[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const o: any = {};
    map.forEach((k, i) => {
      if (k) o[k] = (r[i] ?? "").trim();
    });
    if (o.lang) o.lang = /es|span/i.test(o.lang) && /en|eng/i.test(o.lang) ? "both" : /es|span/i.test(o.lang) ? "es" : "en";
    if (o.status) o.status = String(o.status).toLowerCase().replace(/\s+/g, "_");
    const c = readContact(o);
    if (!c) { skipped++; continue; }
    const keys = [c.phone ? `p:${c.phone}` : "", `n:${c.company.toLowerCase()}|${c.city.toLowerCase()}`].filter(Boolean);
    if (keys.some((k) => seen.has(k))) { skipped++; continue; }
    keys.forEach((k) => seen.add(k));
    add.push(c);
  }
  return { add, skipped };
}

export async function importContacts(env: Env, marketId: string, csv: unknown) {
  if (!(await loadMarkets(env)).some((m) => m.id === marketId)) return { ok: false as const, error: "Market not found." };
  const text = typeof csv === "string" ? csv : "";
  if (!text.trim()) return { ok: false as const, error: "Paste the CSV text, with a header row." };
  return updateBlob(env, contactsKey(marketId), readContacts, (list) => {
    const { add, skipped } = contactsFromCsv(text, list);
    if (list.length + add.length > MAX_CONTACTS) return { error: `A market holds up to ${MAX_CONTACTS} contacts. This file would make ${list.length + add.length}.` };
    return { value: [...list, ...add], result: { added: add.length, skipped } };
  });
}

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // A leading = + - @ could run as a formula in a spreadsheet: prefix it.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function contactsCsv(list: Contact[]): string {
  const head = ["company", "contact", "phone", "email", "website", "city", "reviews", "language", "suggested door", "status", "owner", "last contact", "code", "note"];
  const lines = list.map((c) => [c.company, c.person, c.phone, c.email, c.website, c.city, c.reviews ?? "", c.lang, c.door, c.status, c.owner, c.lastOn, c.code, c.note].map(cell).join(","));
  return [head.join(","), ...lines].join("\n");
}

export function contactCounts(list: Contact[]): Record<ContactStatus, number> & { total: number } {
  const out = Object.fromEntries(OUTREACH_STATUSES.map((s) => [s, 0])) as Record<ContactStatus, number>;
  for (const c of list) out[c.status]++;
  return { ...out, total: list.length };
}

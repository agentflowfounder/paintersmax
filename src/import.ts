import { getSessionUser } from "./auth.ts";
import type { Env } from "./types.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_ROWS = 2000;
export const COMMIT_CHUNK = 200;

/** Reads CSV text (quotes, doubled quotes, CRLF, BOM; comma, semicolon or tab separated) into rows of cells. */
export function parseCsv(input: string): string[][] {
  let text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const delim = (Object.keys(counts) as string[]).sort((a, b) => counts[b] - counts[a])[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

type Field = "name" | "first" | "last" | "company" | "email" | "phone" | "address" | "city" | "state" | "zip" | "notes";
const ALIASES: Record<Field, string[]> = {
  name: ["name", "fullname", "customername", "customer", "contactname", "contact", "displayname"],
  first: ["firstname", "first", "givenname", "fname"],
  last: ["lastname", "last", "surname", "familyname", "lname"],
  company: ["company", "companyname", "business", "businessname", "organization"],
  email: ["email", "emailaddress", "mail", "primaryemail"],
  phone: ["phone", "phonenumber", "mobile", "mobilephone", "cell", "cellphone", "telephone", "tel", "primaryphone"],
  address: ["address", "street", "streetaddress", "address1", "addressline1", "billingaddress", "serviceaddress"],
  city: ["city", "town"],
  state: ["state", "province", "region", "st"],
  zip: ["zip", "zipcode", "postalcode", "postcode"],
  notes: ["notes", "note", "comments", "comment", "memo", "description"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function mapHeaders(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const f of Object.keys(ALIASES) as Field[]) {
      if (out[f] === undefined && ALIASES[f].includes(n)) out[f] = i;
    }
  });
  return out;
}

export interface ImportRow {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  company: boolean;
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, n) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const phoneDigits = (p: string) => p.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");

/** Cleans one row. Returns the row, or a plain-language reason it cannot be imported. */
export function cleanRow(raw: Record<string, unknown>): { row?: ImportRow; reason?: string } {
  let name = clip(raw.name, 120);
  const company = clip(raw.company, 120);
  const email = clip(raw.email, 200).toLowerCase();
  const phone = clip(raw.phone, 40);
  const isCompany = !name && !!company;
  if (isCompany) name = company;
  if (!name) return { reason: "No name" };
  if (email && !EMAIL_RE.test(email)) return { reason: "Email looks wrong" };
  if (phone && phoneDigits(phone).length < 7) return { reason: "Phone looks wrong" };
  return {
    row: {
      name,
      email,
      phone,
      address: clip(raw.address, 200),
      city: clip(raw.city, 80),
      state: clip(raw.state, 40),
      zip: clip(raw.zip, 20),
      notes: clip(raw.notes, 1000),
      company: isCompany,
    },
  };
}

export interface Analysis {
  rows: ImportRow[];
  skipped: { line: number; reason: string }[];
  duplicates: number;
  columns: string[];
  error?: string;
}

/** Reads a CSV and sorts rows into importable, duplicate (already a customer or repeated in the file) and skipped. */
export function analyze(csv: string, existingEmails: Set<string>, existingPhones: Set<string>): Analysis {
  const empty: Analysis = { rows: [], skipped: [], duplicates: 0, columns: [] };
  const table = parseCsv(csv);
  if (table.length < 2) return { ...empty, error: "The file needs a header row and at least one customer." };
  const map = mapHeaders(table[0]);
  const hasName = map.name !== undefined || map.first !== undefined || map.last !== undefined || map.company !== undefined;
  if (!hasName) return { ...empty, error: "I could not find a name column. Add a header such as Name, or First Name and Last Name." };
  const columns = (Object.keys(map) as Field[]).sort();
  const body = table.slice(1);
  if (body.length > MAX_ROWS) return { ...empty, columns, error: `The file has more than ${MAX_ROWS} customers. Split it into smaller files.` };
  const seenE = new Set(existingEmails);
  const seenP = new Set(existingPhones);
  const out: Analysis = { rows: [], skipped: [], duplicates: 0, columns };
  body.forEach((cells, idx) => {
    const get = (f: Field) => (map[f] === undefined ? "" : (cells[map[f]!] ?? ""));
    let name = get("name").trim();
    if (!name) name = [get("first").trim(), get("last").trim()].filter(Boolean).join(" ");
    const r = cleanRow({ name, company: get("company"), email: get("email"), phone: get("phone"), address: get("address"), city: get("city"), state: get("state"), zip: get("zip"), notes: get("notes") });
    if (!r.row) {
      out.skipped.push({ line: idx + 2, reason: r.reason! });
      return;
    }
    const pd = phoneDigits(r.row.phone);
    if ((r.row.email && seenE.has(r.row.email)) || (!r.row.email && pd && seenP.has(pd))) {
      out.duplicates++;
      return;
    }
    if (r.row.email) seenE.add(r.row.email);
    if (pd) seenP.add(pd);
    out.rows.push(r.row);
  });
  return out;
}

async function existing(env: Env, companyId: number) {
  const { results } = await env.DB.prepare("SELECT email, phone FROM customers WHERE company_id = ?").bind(companyId).all<{ email: string | null; phone: string | null }>();
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const r of results ?? []) {
    if (r.email) emails.add(r.email.toLowerCase());
    const d = phoneDigits(r.phone ?? "");
    if (d) phones.add(d);
  }
  return { emails, phones };
}

/** POST {csv} previews the file. POST {rows} (at most 200) saves them. Customers only: no jobs, no emails are sent. */
export async function handleImport(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let body: any;
  try {
    const raw = await request.text();
    if (raw.length > MAX_CSV_BYTES * 1.4) return json({ error: "That file is too large (1 MB limit)." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const have = await existing(env, user.companyId);
  if (typeof body?.csv === "string") {
    if (body.csv.length > MAX_CSV_BYTES) return json({ error: "That file is too large (1 MB limit)." }, 413);
    const a = analyze(body.csv, have.emails, have.phones);
    if (a.error) return json({ error: a.error }, 400);
    return json({ ok: true, columns: a.columns, rows: a.rows, skipped: a.skipped.slice(0, 50), skippedCount: a.skipped.length, duplicates: a.duplicates, chunk: COMMIT_CHUNK });
  }
  if (Array.isArray(body?.rows)) {
    if (body.rows.length > COMMIT_CHUNK) return json({ error: `Send at most ${COMMIT_CHUNK} customers at a time.` }, 400);
    let added = 0;
    let duplicates = 0;
    let skipped = 0;
    for (const raw of body.rows) {
      const r = cleanRow(raw ?? {});
      if (!r.row) {
        skipped++;
        continue;
      }
      const c = r.row;
      const pd = phoneDigits(c.phone);
      if ((c.email && have.emails.has(c.email)) || (!c.email && pd && have.phones.has(pd))) {
        duplicates++;
        continue;
      }
      const ins = await env.DB.prepare("INSERT INTO customers (company_id, name, email, phone, kind, notes) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(user.companyId, c.name, c.email || null, c.phone || null, c.company ? "company" : "person", c.notes ? c.notes : null)
        .first<{ id: number }>();
      if (!ins) {
        skipped++;
        continue;
      }
      if (c.address || c.city || c.zip) {
        await env.DB.prepare("INSERT INTO properties (company_id, customer_id, label, address, city, state, zip) VALUES (?, ?, 'Imported address', ?, ?, ?, ?)")
          .bind(user.companyId, ins.id, c.address || null, c.city || null, c.state || null, c.zip || null)
          .run();
      }
      if (c.email) have.emails.add(c.email);
      if (pd) have.phones.add(pd);
      added++;
    }
    return json({ ok: true, added, duplicates, skipped });
  }
  return json({ error: "Send a CSV file." }, 400);
}

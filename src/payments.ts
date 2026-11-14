import { getSessionUser } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import { woTotalCents, cleanWo } from "./workorders.ts";
import type { Env } from "./types.ts";

/**
 * What the customer has paid on a job: a simple record the painter keeps ("records for your accountant, not tax advice").
 * Every way people really pay is here (cash, check, Zelle, CashApp, Venmo, PayPal, bank deposit, card taken outside the app).
 * Money is added up in code. We NEVER store bank, routing or card numbers: a reference is a check number or the last four digits,
 * and anything that looks like a full account or card number is refused. The painter's own "How to pay me" note is free text
 * that they control and that prints on invoices.
 * Stored in app_settings (jobpay:<company>:<job>, howtopay:<company>) so it works without a database change.
 */

export const CUSTOMER_PAY_METHODS = ["cash", "check", "zelle", "cash_app", "venmo", "paypal", "bank_deposit", "card_outside", "other"] as const;
export const PAY_KINDS = ["deposit", "progress", "final", "other"] as const;
export const MAX_PAYMENTS = 60;

export interface Payment {
  id: string;
  on: string; // YYYY-MM-DD
  cents: number;
  method: string;
  ref: string; // a check number or last four digits, never a full account number
  kind: string;
  note: string;
  at: string;
}

const isIso = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

/**
 * True when text holds a run of digits that long (spaces and dashes ignored). A reference is a check number or last four digits,
 * so 9 or more digits there is a routing or account number. Free-text notes and the "How to pay me" box allow a phone number
 * (a Zelle number is normal), so they only refuse 12 or more digits, which is a card or account number.
 */
export const looksLikeAccountNumber = (s: string, minDigits = 9) => new RegExp(`\\d{${minDigits},}`).test(s.replace(/[\s-]/g, ""));

export function cleanPayment(raw: any, today: string): Payment | { error: string } {
  const dollars = Number(typeof raw?.amount === "string" ? raw.amount.replace(/[$,\s]/g, "") : raw?.amount);
  if (!Number.isFinite(dollars) || dollars <= 0) return { error: "Type the amount the customer paid." };
  if (dollars > 1_000_000) return { error: "That amount looks too large. Check it and try again." };
  const on = isIso(raw?.on) ? raw.on : today;
  const ref = typeof raw?.ref === "string" ? raw.ref.trim().slice(0, 40) : "";
  const note = typeof raw?.note === "string" ? raw.note.trim().slice(0, 300) : "";
  if (looksLikeAccountNumber(ref) || looksLikeAccountNumber(note, 12)) return { error: "That looks like a bank or card number. PaintersMax never stores those. For a check, type just the check number; for a card, just the last four digits." };
  const method = (CUSTOMER_PAY_METHODS as readonly string[]).includes(raw?.method) ? raw.method : "other";
  const kind = (PAY_KINDS as readonly string[]).includes(raw?.kind) ? raw.kind : "other";
  const id = typeof raw?.id === "string" && /^[a-z0-9]{6,20}$/.test(raw.id) ? raw.id : Math.random().toString(36).slice(2, 10);
  return { id, on, cents: Math.round(dollars * 100), method, ref, kind, note, at: new Date().toISOString() };
}

export function readPayments(raw: string | null | undefined): Payment[] {
  try {
    const j = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(j)) return [];
    return j
      .filter((p) => p && isIso(p.on) && Number.isInteger(p.cents) && p.cents > 0)
      .slice(0, MAX_PAYMENTS)
      .map((p) => ({
        id: String(p.id ?? "").slice(0, 20) || Math.random().toString(36).slice(2, 10),
        on: p.on,
        cents: p.cents,
        method: (CUSTOMER_PAY_METHODS as readonly string[]).includes(p.method) ? p.method : "other",
        ref: String(p.ref ?? "").slice(0, 40),
        kind: (PAY_KINDS as readonly string[]).includes(p.kind) ? p.kind : "other",
        note: String(p.note ?? "").slice(0, 300),
        at: String(p.at ?? ""),
      }));
  } catch {
    return [];
  }
}

export const sumPaid = (list: Payment[]) => list.reduce((s, p) => s + p.cents, 0);

/** One plain line for the job timeline, e.g. "Payment received: $500.00 by check #1042 (deposit)". */
export function paymentLine(p: Payment): string {
  const label: Record<string, string> = { cash: "cash", check: "check", zelle: "Zelle", cash_app: "CashApp", venmo: "Venmo", paypal: "PayPal", bank_deposit: "bank deposit", card_outside: "card (taken outside the app)", other: "other" };
  return `Payment received: $${(p.cents / 100).toFixed(2)} by ${label[p.method] ?? p.method}${p.ref ? ` ${/^\d+$/.test(p.ref) && p.method === "check" ? "#" : ""}${p.ref}` : ""}${p.kind === "deposit" ? " (deposit)" : p.kind === "final" ? " (final payment)" : ""}`;
}

const payKey = (c: number, j: number) => `jobpay:${c}:${j}`;
const howKey = (c: number) => `howtopay:${c}`;

async function getBlob(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
async function putBlob(env: Env, key: string, value: string) {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, value).run();
}

export const loadPayments = async (env: Env, c: number, j: number) => readPayments(await getBlob(env, payKey(c, j)));
export const loadHowToPay = async (env: Env, c: number) => (await getBlob(env, howKey(c))) ?? "";

/** What the customer owes in total: the estimate plus approved change orders. The signed estimate itself is never changed. */
export async function contractTotal(env: Env, c: number, jobId: number): Promise<{ estimateCents: number; changeOrderCents: number; totalCents: number; depositCents: number; signed: boolean }> {
  const doc = await env.DB.prepare("SELECT body FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' ORDER BY id DESC LIMIT 1").bind(jobId, c).first<{ body: string }>();
  let est = 0;
  let dep = 0;
  try {
    const b = doc ? JSON.parse(doc.body) : {};
    est = Math.max(0, Math.round(Number(b?.totals?.totalCents) || 0));
    dep = Math.max(0, Math.round(Number(b?.totals?.depositCents) || 0));
  } catch {
    // no usable estimate yet
  }
  const wos = ((await env.DB.prepare("SELECT body FROM work_orders WHERE job_id = ? AND company_id = ? AND kind = 'change_order' AND status = 'approved'").bind(jobId, c).all<{ body: string }>().catch(() => ({ results: [] as { body: string }[] }))).results ?? []) as { body: string }[];
  let co = 0;
  for (const w of wos) {
    try {
      co += woTotalCents(cleanWo(JSON.parse(w.body)).lines);
    } catch {
      // skip an unreadable change order
    }
  }
  const sig = await env.DB.prepare("SELECT 1 AS x FROM signature_requests WHERE job_id = ? AND company_id = ? AND kind = 'estimate' AND status = 'signed' LIMIT 1").bind(jobId, c).first().catch(() => null);
  return { estimateCents: est, changeOrderCents: co, totalCents: est + co, depositCents: dep, signed: !!sig };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * Painter API  /api/jobpay
 *  GET ?jobId=      payments, what is owed, what is paid, the balance, and the saved "How to pay me" note
 *  POST {action:"add", jobId, amount, on?, method, ref?, kind?, note?}
 *  POST {action:"update", jobId, id, ...same fields}
 *  POST {action:"delete", jobId, id}
 *  POST {action:"saveHowToPay", text}
 */
export async function handleJobPay(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  const today = new Date().toISOString().slice(0, 10);
  let b: any = {};
  if (request.method === "POST") {
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
  } else if (request.method !== "GET") return json({ error: "Not found." }, 404);

  if (b?.action === "saveHowToPay") {
    const text = typeof b.text === "string" ? b.text.trim().slice(0, 600) : "";
    if (looksLikeAccountNumber(text, 12)) return json({ error: "That has a very long number in it, like a card or bank account number. Please take it out. PaintersMax never stores those. A phone number for Zelle is fine." }, 400);
    await putBlob(env, howKey(c), text);
    return json({ ok: true, howToPay: text });
  }

  const jobId = Number(request.method === "GET" ? new URL(request.url).searchParams.get("jobId") : b?.jobId);
  if (!Number.isInteger(jobId)) return json({ error: "Job not found." }, 404);
  const job = await env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").bind(jobId, c).first();
  if (!job) return json({ error: "Job not found." }, 404);

  let list = await loadPayments(env, c, jobId);
  if (request.method === "POST") {
    if (b?.action === "add") {
      if (list.length >= MAX_PAYMENTS) return json({ error: "That job has a lot of payments already. Contact support if you need more." }, 400);
      const p = cleanPayment({ ...b, id: undefined, kind: b.kind ?? (list.length === 0 ? "deposit" : "other") }, today);
      if ("error" in p) return json({ error: p.error }, 400);
      list.push(p);
      await putBlob(env, payKey(c, jobId), JSON.stringify(list));
      await addJobEvent(env, c, jobId, "payment", paymentLine(p));
    } else if (b?.action === "update") {
      const old = list.find((x) => x.id === b.id);
      if (!old) return json({ error: "Payment not found." }, 404);
      const p = cleanPayment({ ...b, id: old.id }, today);
      if ("error" in p) return json({ error: p.error }, 400);
      list = list.map((x) => (x.id === old.id ? { ...p, at: old.at } : x));
      await putBlob(env, payKey(c, jobId), JSON.stringify(list));
      await addJobEvent(env, c, jobId, "payment", `Payment changed: ${paymentLine(p).replace("Payment received: ", "")}`);
    } else if (b?.action === "delete") {
      const old = list.find((x) => x.id === b.id);
      if (!old) return json({ error: "Payment not found." }, 404);
      list = list.filter((x) => x.id !== old.id);
      await putBlob(env, payKey(c, jobId), JSON.stringify(list));
      await addJobEvent(env, c, jobId, "payment", `Payment removed: $${(old.cents / 100).toFixed(2)} on ${old.on}`);
    } else return json({ error: "Not found." }, 404);
  }
  list.sort((a, z) => (a.on < z.on ? -1 : a.on > z.on ? 1 : a.at < z.at ? -1 : 1));
  const t = await contractTotal(env, c, jobId);
  const paid = sumPaid(list);
  return json({
    payments: list,
    methods: CUSTOMER_PAY_METHODS,
    today,
    totalCents: t.totalCents,
    estimateCents: t.estimateCents,
    changeOrderCents: t.changeOrderCents,
    depositCents: t.depositCents,
    signed: t.signed,
    paidCents: paid,
    balanceCents: Math.max(0, t.totalCents - paid),
    overpaidCents: Math.max(0, paid - t.totalCents),
    paidInFull: t.totalCents > 0 && paid >= t.totalCents,
    howToPay: await loadHowToPay(env, c),
  });
}

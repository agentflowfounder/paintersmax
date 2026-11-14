import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS, DIGEST_MAX, FREE_HOME_LINES, RULES, TYPE_RULE, digestEmail, digestLines, digestMode, evaluate, gateHome, inEmailEngine, localClock, readAdmin, readSettings, sendOwnerDigests, type Facts, type Line } from "../src/notices.ts";

const facts = (over: Partial<Facts> = {}): Facts => ({ today: "2026-11-17", leads: [], estimates: [], invoices: [], signedNoDeposit: [], changeOrders: [], visits: [], visitsDone: [], anniversaries: [], bookedNext21: 5, openEstimates: 0, ...over });
const row = (jobId: number, days: number) => ({ jobId, customer: "Ana Ruiz", title: "Kitchen repaint", days });

test("every rule has a group and a plain label, and ids are unique", () => {
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  for (const r of RULES) assert.ok(r.label.length > 5 && r.group, r.id);
  for (const id of Object.values(TYPE_RULE)) assert.ok(RULES.some((r) => r.id === id), id);
  // Insurance stays on every plan, so the free plan never hides a risk.
  assert.equal(RULES.find((r) => r.id === "insurance")?.always, true);
});

test("an unpaid invoice gets firmer wording at 30 and 60 days, and a new key at each step", () => {
  const at = (days: number) => evaluate(facts({ invoices: [row(4, days)] }))[0];
  assert.equal(at(8).text, "Invoice sent 8 days ago and not marked paid: Ana Ruiz, Kitchen repaint");
  assert.match(at(31).text, /still not paid.*Call the customer today\.$/);
  assert.match(at(61).text, /with your accountant\.$/);
  assert.deepEqual([8, 15, 31, 61].map((d) => at(d).key), ["invoice_unpaid:4:7", "invoice_unpaid:4:14", "invoice_unpaid:4:30", "invoice_unpaid:4:60"]);
  assert.equal(at(9).key, at(13).key); // the same step is the same key, so it is emailed once
  assert.match(at(31).es, /Llame al cliente hoy/);
});

test("lines keep the wording Home already used, each has Spanish, and the most urgent come first", () => {
  const lines = evaluate(facts({
    leads: [row(1, 1)],
    estimates: [row(2, 4)],
    invoices: [row(3, 9)],
    signedNoDeposit: [{ ...row(5, 3), depositCents: 120000 }],
    changeOrders: [{ ...row(6, 2), number: 3 }],
    visits: [{ jobId: 7, customer: "Luis", address: "12 Oak St, Plano", date: "2026-11-17", time: "10:00" }, { jobId: 8, customer: "Mia", address: "", date: "2026-11-18", time: "" }, { jobId: 9, customer: "Sam", address: "", date: "2026-11-10", time: "" }],
    visitsDone: [row(10, 3)],
    anniversaries: [{ jobId: 11, customer: "Joe", title: "Exterior" }],
  }));
  const text = (rule: string) => lines.filter((l) => l.rule === rule).map((l) => l.text);
  assert.deepEqual(text("lead_new"), ["New lead waiting 1 day: Ana Ruiz, Kitchen repaint"]);
  assert.deepEqual(text("estimate_followup"), ["Estimate sent 4 days ago, no answer yet: Ana Ruiz, Kitchen repaint"]);
  assert.match(text("deposit_missing")[0], /\$1,200 deposit is not recorded/);
  assert.match(text("change_order_waiting")[0], /^Change order CO-3 /);
  assert.deepEqual(text("visit_soon"), ["Site visit today at 10:00 AM: Luis, 12 Oak St, Plano", "Site visit tomorrow: Mia"]);
  assert.equal(text("visit_stale").length, 1);
  assert.equal(text("visit_no_estimate").length, 1);
  assert.equal(text("past_customer").length, 1);
  assert.equal(lines[0].rule, "visit_soon"); // today's visit is on top
  assert.equal(lines[lines.length - 1].rule, "past_customer");
  for (const l of lines) assert.ok(l.es && l.es !== l.text && l.key.startsWith(l.rule + ":"), l.rule);
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i - 1].urgency >= lines[i].urgency);
});

test("a light calendar is only mentioned when there are estimates to chase", () => {
  assert.equal(evaluate(facts({ bookedNext21: 0, openEstimates: 0 })).length, 0);
  const l = evaluate(facts({ bookedNext21: 1, openEstimates: 2 }));
  assert.equal(l.length, 1);
  assert.match(l[0].text, /2 estimates are still waiting/);
  assert.equal(l[0].key, "calendar_gap:2026-11-16"); // once a week (the Monday)
  assert.equal(evaluate(facts({ bookedNext21: 2, openEstimates: 2 })).length, 0);
});

const home = [
  { type: "billing" }, { type: "insurance" },
  { type: "lead", rule: "lead_new" }, { type: "invoice", rule: "invoice_unpaid" }, { type: "estimate", rule: "estimate_followup" }, { type: "estimate", rule: "estimate_followup" }, { type: "deposit", rule: "deposit_missing" },
  { type: "vehicle" }, { type: "something_else" },
];
const ruleOf = (a: { type: string; rule?: string }) => a.rule ?? TYPE_RULE[a.type];

test("Home: paid plans see everything; the free plan sees 3 lines, the always-on lines, and a count of the rest", () => {
  for (const plan of ["starter", "basic", "pro"] as const) assert.deepEqual(gateHome(home, ruleOf, plan, {}, { groupsOff: [] }), { lines: home, hidden: 0 });
  const free = gateHome(home, ruleOf, "free", {}, { groupsOff: [] });
  assert.equal(free.hidden, 2);
  assert.equal(free.lines.filter((l) => l.rule).length, FREE_HOME_LINES);
  for (const t of ["billing", "insurance", "vehicle", "something_else"]) assert.ok(free.lines.some((l) => l.type === t), t);
});

test("Home: the admin can turn a reminder on for all plans or off for everyone, and the owner can hide a group", () => {
  const all = gateHome(home, ruleOf, "free", readAdmin({ deposit_missing: { home: "all" }, estimate_followup: { home: "all" } }), { groupsOff: [] });
  assert.equal(all.hidden, 0);
  assert.equal(all.lines.length, home.length);
  const off = gateHome(home, ruleOf, "pro", readAdmin({ invoice_unpaid: { home: "off" }, insurance: { home: "off" } }), { groupsOff: [] });
  assert.ok(!off.lines.some((l) => l.type === "invoice" || l.type === "insurance"));
  const owner = gateHome(home, ruleOf, "pro", {}, { groupsOff: ["money"] });
  assert.deepEqual(owner.lines.map((l) => l.type), ["billing", "insurance", "lead", "vehicle", "something_else"]);
});

const L = (rule: string, key: string): Line => ({ rule, type: "x", text: `text ${key}`, es: `texto ${key}`, urgency: 1, key, jobId: 1 });
const set = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over });

test("digest: free gets none, Starter gets Monday, Basic and Pro get only what is new", () => {
  assert.deepEqual([digestMode("free"), digestMode("starter"), digestMode("basic"), digestMode("pro")], ["none", "weekly", "daily", "daily"]);
  const lines = [L("invoice_unpaid", "a"), L("lead_new", "b"), L("visit_stale", "c")];
  const run = (plan: any, o: { monday?: boolean; sent?: Record<string, string>; admin?: any; groupsOff?: any } = {}) =>
    digestLines(lines, { plan, admin: readAdmin(o.admin ?? {}), settings: set({ sent: o.sent ?? {}, groupsOff: o.groupsOff ?? [] }), monday: !!o.monday }).map((l) => l.key);
  assert.deepEqual(run("free", { monday: true }), []);
  assert.deepEqual(run("starter"), []);
  assert.deepEqual(run("starter", { monday: true, sent: { a: "2026-11-09" } }), ["a", "b"]); // the weekly email lists everything open
  assert.deepEqual(run("basic"), ["a", "b"]); // visit_stale is Home only
  assert.deepEqual(run("pro", { sent: { a: "2026-11-16" } }), ["b"]);
  assert.deepEqual(run("pro", { groupsOff: ["money"] }), ["b"]);
  // Admin switches: on for all plans (daily, new only), off for everyone, and a Home-only line put in the email.
  assert.deepEqual(run("free", { admin: { invoice_unpaid: { digest: "all" } } }), ["a"]);
  assert.deepEqual(run("free", { admin: { invoice_unpaid: { digest: "all" } }, sent: { a: "2026-11-16" } }), []);
  assert.deepEqual(run("pro", { admin: { lead_new: { digest: "off" } } }), ["a"]);
  assert.deepEqual(run("pro", { admin: { visit_stale: { digest: "all" } } }), ["a", "b", "c"]);
});

test("only the money and leads rules can be switched into the email for now", () => {
  assert.deepEqual([...new Set(RULES.filter(inEmailEngine).map((r) => r.group))], ["money", "leads"]);
});

test("the email lists at most five things, says how many more are on Home, and comes in Spanish", () => {
  const lines = Array.from({ length: 7 }, (_, i) => L("invoice_unpaid", `k${i}`));
  const en = digestEmail({ company: "Tyler Painters", lines, openTotal: 9, es: false, hour: 7 });
  assert.equal(en.subject, `Today at Tyler Painters: ${DIGEST_MAX} things to look at`);
  assert.equal((en.text.match(/^\d\. /gm) ?? []).length, DIGEST_MAX);
  assert.match(en.text, /You have 4 more reminders on your Home screen/);
  assert.match(en.text, /https:\/\/paintersmax\.app\/jobs\?id=1/);
  assert.match(en.text, /at 7:00 AM only on days when something is new/);
  assert.match(en.text, /paintersmax\.app\/reminders/);
  const one = digestEmail({ company: "Tyler Painters", lines: lines.slice(0, 1), openTotal: 1, es: true, hour: 18 });
  assert.equal(one.subject, "Hoy en Tyler Painters: 1 cosa por revisar");
  assert.match(one.text, /texto k0/);
  assert.match(one.text, /6:00 PM/);
  assert.doesNotMatch(one.text, /recordatorios? más/);
});

test("the owner's clock follows their time zone, with daylight time", () => {
  assert.deepEqual(localClock(Date.UTC(2026, 10, 16, 13, 5), "America/Chicago"), { hour: 7, date: "2026-11-16", monday: true });
  assert.deepEqual(localClock(Date.UTC(2026, 10, 16, 13, 5), "America/Los_Angeles"), { hour: 5, date: "2026-11-16", monday: true });
  assert.deepEqual(localClock(Date.UTC(2026, 6, 7, 12, 30), "America/Chicago"), { hour: 7, date: "2026-07-07", monday: false }); // summer: UTC-5
  assert.deepEqual(localClock(Date.UTC(2026, 10, 17, 3, 0), "America/New_York"), { hour: 22, date: "2026-11-16", monday: true });
});

test("settings are cleaned: a bad hour, zone or group falls back, and insurance cannot be switched off", () => {
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  const s = readSettings({ digest: false, hour: 99, tz: "Mars/Olympus", groupsOff: ["money", "insurance", "account", "nope"], lastDigest: "yesterday", sent: { a: "2026-11-01", b: 5 } });
  assert.deepEqual(s, { digest: false, hour: 7, tz: "America/Chicago", groupsOff: ["money"], lastDigest: "", sent: { a: "2026-11-01" } });
  assert.equal(readSettings({ hour: 18, tz: "America/Denver" }).hour, 18);
  assert.deepEqual(readAdmin({ lead_new: { home: "all", digest: "bogus" }, made_up: { home: "all" } }), { lead_new: { home: "all", digest: "default" } });
});

// ---------- The 5-minute check, on a real SQLite database ----------
function realEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT, plan TEXT, created_at TEXT, notify_email TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, company_id INTEGER, email TEXT);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE company_profiles (company_id INTEGER PRIMARY KEY, data TEXT);
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, address TEXT, city TEXT);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY, company_id INTEGER, customer_id INTEGER, property_id INTEGER, title TEXT, stage TEXT, data TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE documents (id INTEGER PRIMARY KEY, company_id INTEGER, job_id INTEGER, kind TEXT, status TEXT, body TEXT DEFAULT '{}', updated_at TEXT);
    CREATE TABLE signature_requests (id INTEGER PRIMARY KEY, company_id INTEGER, job_id INTEGER, status TEXT, signed_at TEXT);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, company_id INTEGER, job_id INTEGER, number INTEGER, kind TEXT, status TEXT, sent_at TEXT);
  `);
  // Like D1: nothing runs (or fails) until first/run/all is called.
  const DB = {
    prepare(sql: string) {
      const make = (a: any[]) => ({
        async first() { return (db.prepare(sql).get(...a) as any) ?? null; },
        async run() { db.prepare(sql).run(...a); return { meta: { changes: 1 } }; },
        async all() { return { results: db.prepare(sql).all(...a) }; },
      });
      return { bind: (...a: any[]) => make(a), ...make([]) };
    },
  };
  return { env: { DB, RESEND_API_KEY: "test" } as any, db };
}

test("the morning email goes out once at the owner's hour, only with new steps, and respects plans and the admin switch", async () => {
  const { env, db } = realEnv();
  db.exec(`
    INSERT INTO companies VALUES (1, 'Tyler Painters', 'basic', '2026-01-01 00:00:00', 'owner@example.com'), (2, 'Free Painters', 'free', '2026-01-01 00:00:00', NULL), (3, 'Late Riser', 'pro', '2026-01-01 00:00:00', 'late@example.com');
    INSERT INTO users VALUES (1, 1, 'tyler@example.com'), (2, 2, 'free@example.com'), (3, 3, 'late@example.com');
    INSERT INTO company_profiles VALUES (3, '{"language":{"ui":"es"}}');
    INSERT INTO app_settings VALUES ('notices:3', '{"hour":9}', NULL);
    INSERT INTO customers VALUES (1, 'Ana Ruiz');
    INSERT INTO jobs (id, company_id, customer_id, title, stage) VALUES (10, 1, 1, 'Kitchen repaint', 'punch'), (20, 2, 1, 'Fence', 'punch'), (30, 3, 1, 'Cabinets', 'punch');
    INSERT INTO documents (company_id, job_id, kind, status, updated_at) VALUES (1, 10, 'invoice', 'sent', datetime('now','-10 days')), (2, 20, 'invoice', 'sent', datetime('now','-10 days')), (3, 30, 'invoice', 'sent', datetime('now','-10 days'));
  `);
  const mails: { to: string; subject: string; text: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    const b = JSON.parse(init.body);
    mails.push({ to: [].concat(b.to)[0], subject: b.subject, text: b.text });
    return new Response("{}", { status: 200 });
  }) as any;
  try {
    const at = (day: number, hour: number, min = 5) => Date.UTC(2026, 10, day, hour, min);
    assert.equal(await sendOwnerDigests(env, at(17, 12)), 0); // 6 AM in Texas: too early
    assert.equal(await sendOwnerDigests(env, at(17, 13)), 1); // 7 AM: the Basic company gets it, the free one does not
    assert.equal(mails[0].to, "owner@example.com");
    assert.equal(mails[0].subject, "Today at Tyler Painters: 1 thing to look at");
    assert.match(mails[0].text, /Invoice sent 10 days ago and not marked paid: Ana Ruiz, Kitchen repaint/);
    assert.equal(await sendOwnerDigests(env, at(17, 13, 10)), 0); // the next check, same hour: nothing more
    assert.equal(await sendOwnerDigests(env, at(17, 15)), 1); // 9 AM: the owner who chose 9, in Spanish
    assert.equal(mails[1].to, "late@example.com");
    assert.match(mails[1].subject, /^Hoy en Late Riser/);
    assert.equal(await sendOwnerDigests(env, at(18, 13)), 0); // next morning, nothing new: no email
    db.exec("UPDATE documents SET updated_at = datetime('now','-15 days') WHERE company_id = 1");
    assert.equal(await sendOwnerDigests(env, at(19, 13)), 1); // the invoice reached day 14: it comes back once
    assert.match(mails[2].text, /Invoice sent 15 days ago/);
    assert.equal(await sendOwnerDigests(env, at(20, 13)), 0);
    // The admin turns the unpaid-invoice email on for every plan: the free company now gets it.
    db.prepare("INSERT INTO app_settings VALUES ('noticeadmin', ?, NULL)").run(JSON.stringify({ invoice_unpaid: { digest: "all" } }));
    assert.equal(await sendOwnerDigests(env, at(21, 13)), 1);
    assert.equal(mails[3].to, "free@example.com");
    // The owner turns the email off.
    db.exec("UPDATE documents SET updated_at = datetime('now','-31 days') WHERE company_id = 1");
    const cur = JSON.parse((db.prepare("SELECT value FROM app_settings WHERE key = 'notices:1'").get() as any).value);
    db.prepare("UPDATE app_settings SET value = ? WHERE key = 'notices:1'").run(JSON.stringify({ ...cur, digest: false }));
    assert.equal(await sendOwnerDigests(env, at(22, 13)), 0);
    assert.equal(mails.length, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a failed email is tried again at the next check, and nothing is marked as sent", async () => {
  const { env, db } = realEnv();
  db.exec(`
    INSERT INTO companies VALUES (1, 'Tyler Painters', 'pro', '2026-01-01 00:00:00', 'owner@example.com');
    INSERT INTO customers VALUES (1, 'Ana Ruiz');
    INSERT INTO jobs (id, company_id, customer_id, title, stage) VALUES (10, 1, 1, 'Kitchen repaint', 'lead');
    UPDATE jobs SET created_at = datetime('now','-2 days');
  `);
  const realFetch = globalThis.fetch;
  let ok = false;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}", { status: ok ? 200 : 500 }); }) as any;
  try {
    assert.equal(await sendOwnerDigests(env, Date.UTC(2026, 10, 17, 13, 5)), 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key = 'notices:1'").get()!.n, 0);
    ok = true;
    assert.equal(await sendOwnerDigests(env, Date.UTC(2026, 10, 17, 13, 10)), 1);
    assert.equal(calls, 2);
    assert.ok(JSON.parse((db.prepare("SELECT value FROM app_settings WHERE key = 'notices:1'").get() as any).value).sent["lead_new:10:1"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { creditView } from "../src/credits.ts";
import { addDaysIso } from "../src/dates.ts";
import { doorFromInput, readSignup, splitCity } from "../src/freesignup.ts";
import { readPromo } from "../src/promos.ts";
import { afterDoorPaid, autoPromoFor, creditMenu, doorCharge, expiringSoon, grantWelcome, readStarter, releaseHeldWelcome, saveStarter, STARTER_DEFAULTS, starterStats } from "../src/starter.ts";

function realEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE usage_counters (company_id INTEGER NOT NULL, feature TEXT NOT NULL, period TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, feature, period));");
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);");
  db.exec("CREATE TABLE companies (id INTEGER PRIMARY KEY, slug TEXT);");
  db.exec("INSERT INTO companies (id, slug) VALUES (1, 'paintersmax-master')");
  const DB = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      const run = (a: any[]) => ({
        async first() { return (st.get(...a) as any) ?? null; },
        async run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; },
        async all() { return { results: st.all(...a) }; },
      });
      return { bind: (...a: any[]) => run(a), ...run([]) };
    },
    async batch(list: any[]) { for (const x of list) await x.run(); return []; },
  };
  return { env: { DB } as any, db };
}
const blob = (db: DatabaseSync, key: string) => { const r = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as any; return r ? JSON.parse(r.value) : null; };
const T = "2026-11-25";

test("settings: defaults are 250 credits for 60 days, 150 a day; bad values are clamped", () => {
  assert.deepEqual(readStarter(null), STARTER_DEFAULTS);
  assert.equal(STARTER_DEFAULTS.welcomeCredits, 250);
  assert.equal(STARTER_DEFAULTS.welcomeDays, 60);
  const s = readStarter({ welcomeCredits: 99999, welcomeDays: 1, dailyCap: -5, perVisitorDaily: "x", on: false });
  assert.deepEqual(s, { on: false, welcomeCredits: 1500, welcomeDays: 7, dailyCap: 1, perVisitorDaily: 3, day3Email: false });
});

test("credit menu: 250 credits, what each tool gives, and a busy first month leaves most of them", () => {
  const m = creditMenu(250);
  const by = Object.fromEntries(m.rows.map((r) => [r.feature, r.uses]));
  assert.equal(by.estimate_draft, 250);
  assert.equal(by.photo_analysis, 125);
  assert.equal(by.color_repaint, 83);
  assert.equal(m.sample.credits, 65);
  assert.equal(m.sample.left, 185);
  assert.equal(creditMenu(0).sample.left, 0);
  const cy = creditMenu(250, 60).cycle;
  assert.equal(cy.perJob, 11);
  assert.equal(cy.jobs, 22);
  assert.equal(cy.jobsPerMonth, 11);
  assert.equal(cy.seasons.length, 3);
});

test("welcome credits use the admin settings", async () => {
  const { env } = realEnv();
  await saveStarter(env, { welcomeCredits: 100, welcomeDays: 30 });
  const r = await grantWelcome(env, 7, T, { capped: false });
  assert.equal(r.status, "granted");
  const v = await creditView(env, 7, T);
  assert.equal(v.balance, 100);
  assert.equal(v.grants[0].expiresOn, addDaysIso(T, 30));
  // Turned off: no credits.
  await saveStarter(env, { on: false });
  assert.equal((await grantWelcome(env, 8, T, { capped: false })).status, "off");
  assert.equal((await creditView(env, 8, T)).balance, 0);
});

test("daily ceiling: public sign-ups over it wait, the morning run adds them, and hand-made accounts never wait", async () => {
  const { env } = realEnv();
  await saveStarter(env, { dailyCap: 2 });
  assert.equal((await grantWelcome(env, 10, T, { capped: true })).status, "granted");
  assert.equal((await grantWelcome(env, 11, T, { capped: true })).status, "granted");
  assert.equal((await grantWelcome(env, 12, T, { capped: true })).status, "held");
  assert.equal((await grantWelcome(env, 13, T, { capped: true })).status, "held");
  assert.equal((await grantWelcome(env, 14, T, { capped: false })).status, "granted");
  assert.equal((await creditView(env, 12, T)).balance, 0);
  let st = await starterStats(env, T);
  assert.equal(st.today, 2);
  assert.equal(st.held, 2);
  const next = addDaysIso(T, 1);
  assert.equal(await releaseHeldWelcome(env, next), 2);
  assert.equal((await creditView(env, 12, next)).balance, 250);
  assert.equal((await creditView(env, 13, next)).balance, 250);
  assert.equal(await releaseHeldWelcome(env, next), 0);
  st = await starterStats(env, next);
  assert.equal(st.held, 0);
  assert.equal(st.today, 2, "released grants count against the new day");
});

const promo = (over: any = {}) => readPromo({ code: "BOOKEDBYSPRING", name: "Booked by Spring", reason: "Holiday", kind: "floor", appliesTo: "signup", startsOn: "2026-11-25", endsOn: "2027-01-06", bonusCredits: 1000, founding: true, auto: true, ...over })!;

test("door price: list price from Free, floor while a promotion that applies by itself runs, floors' difference between paid doors", () => {
  assert.equal(doorCharge("free", "launch", null, T).cents, 39900);
  const p = promo();
  assert.equal(autoPromoFor([p], "launch", T)?.code, "BOOKEDBYSPRING");
  assert.equal(autoPromoFor([p], "launch", "2026-11-24"), null, "not before it starts");
  assert.equal(autoPromoFor([promo({ auto: false })], "launch", T), null, "a code-only promotion is not applied by itself");
  assert.equal(doorCharge("free", "launch", p, T).cents, 29900);
  assert.equal(doorCharge("free", "grow", p, T).cents, 39900);
  assert.equal(doorCharge("free", "signature", p, T).cents, 49900);
  assert.equal(doorCharge("launch", "grow", p, T).cents, 10000);
});

test("after a paid door: promotion credits replace door credits, the year starts, the Founding badge is set, and a repeat changes nothing", async () => {
  const { env, db } = realEnv();
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('promos', ?)").run(JSON.stringify([promo({ maxUses: 1 })]));
  await grantWelcome(env, 20, T, { capped: false });
  const a = await afterDoorPaid(env, 20, { door: "launch", paymentId: "cs_1", promoCode: "BOOKEDBYSPRING", paidCents: 29900 }, T);
  assert.deepEqual(a, { credits: 1000, promo: "BOOKEDBYSPRING", founding: true });
  assert.equal((await creditView(env, 20, T)).balance, 1250);
  const sub = blob(db, "sub:20");
  assert.equal(sub.startedOn, T);
  assert.equal(sub.renewsOn, addDaysIso(T, 365));
  assert.equal(sub.paidCents, 29900);
  assert.equal(sub.founding, true);
  assert.equal(blob(db, "dirm:20").founding, true);
  // Stripe sends the same payment again.
  const again = await afterDoorPaid(env, 20, { door: "launch", paymentId: "cs_1", promoCode: "BOOKEDBYSPRING", paidCents: 29900 }, T);
  assert.equal(again.credits, 1000);
  assert.equal((await creditView(env, 20, T)).balance, 1250);
  // The code had one use: the next painter gets the normal 500 door credits and no badge.
  const b = await afterDoorPaid(env, 21, { door: "launch", paymentId: "cs_2", promoCode: "BOOKEDBYSPRING", paidCents: 29900 }, T);
  assert.deepEqual(b, { credits: 500, promo: "", founding: false });
  assert.equal((await creditView(env, 21, T)).balance, 500);
});

test("an admin-entered paid year is never replaced", async () => {
  const { env, db } = realEnv();
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('sub:30', ?)").run(JSON.stringify({ startedOn: "2026-11-01", renewsOn: "2027-11-01", paidCents: 39900 }));
  await afterDoorPaid(env, 30, { door: "grow", paymentId: "cs_3", promoCode: "", paidCents: 54900 }, T);
  assert.equal(blob(db, "sub:30").startedOn, "2026-11-01");
  assert.equal((await creditView(env, 30, T)).balance, 500);
});

test("free credits running out within a week are found for the Home reminder; paid ones are not", () => {
  const rows = [
    { source: "welcome", left: 40, expired: false, expiresOn: "2026-11-28" },
    { source: "topup", left: 50, expired: false, expiresOn: "2026-11-27" },
    { source: "door", left: 10, expired: false, expiresOn: "2026-12-30" },
    { source: "welcome", left: 5, expired: true, expiresOn: "2026-11-20" },
  ];
  assert.deepEqual(expiringSoon(rows, T), { credits: 40, on: "2026-11-28" });
  assert.equal(expiringSoon(rows.slice(1), T), null);
});

test("sign-up form: old plan names map to doors, and bad input is refused", () => {
  assert.equal(doorFromInput("starter"), "launch");
  assert.equal(doorFromInput("pro"), "signature");
  assert.equal(doorFromInput("grow"), "grow");
  assert.equal(doorFromInput("free"), null);
  assert.equal(doorFromInput(""), null);
  assert.deepEqual(readSignup({ name: "", email: "a@b.co" }), { error: "Enter your company name." });
  assert.deepEqual(readSignup({ name: "Rose City", email: "nope" }), { error: "Enter a valid email address." });
  const r = readSignup({ name: " Rose City Painters ", email: "Owner@Example.com", city: "Tyler, TX", phone: "(903) 555-0142", door: "basic", lang: "es", website: "", lp: "Booked Spring", src: "Facebook Group" }) as any;
  assert.equal(r.name, "Rose City Painters");
  assert.equal(r.email, "owner@example.com");
  assert.equal(r.door, "grow");
  assert.equal(r.lang, "es");
  assert.equal(r.lp, "booked-spring");
  assert.equal(r.src, "facebook-group");
  assert.equal(r.robot, false);
  assert.equal((readSignup({ name: "x", email: "a@b.co", city: "Tyler", phone: "9035550142", website: "spam.com" }) as any).robot, true);
  assert.deepEqual(readSignup({ name: "x", email: "a@b.co", phone: "9035550142" }), { error: "Enter your city." });
  assert.deepEqual(readSignup({ name: "x", email: "a@b.co", city: "Tyler", phone: "555-1212" }), { error: "Enter a phone number with 10 digits." });
});

test("door checkout form carries the charged amount and the promotion code for the webhook", async () => {
  const { upgradeCheckoutForm } = await import("../src/sitebuilder.ts");
  const f = upgradeCheckoutForm("https://paintersmax.app", { companyId: 5, email: "a@b.co", from: "free", to: "launch", cents: 29900, promoCode: "BOOKEDBYSPRING", successPath: "/start?paid=1" });
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "29900");
  assert.equal(f.get("metadata[promo]"), "BOOKEDBYSPRING");
  assert.equal(f.get("metadata[kind]"), "site_upgrade");
  assert.equal(f.get("success_url"), "https://paintersmax.app/start?paid=1");
  const g = upgradeCheckoutForm("https://paintersmax.app", { companyId: 5, email: "a@b.co", from: "launch", to: "grow" });
  assert.equal(g.get("line_items[0][price_data][unit_amount]"), "10000");
  assert.equal(g.get("metadata[promo]"), null);
});

test("sign-up: where they heard, and city split for the wizard", () => {
  assert.deepEqual(splitCity("Tyler, TX"), { city: "Tyler", state: "TX" });
  assert.deepEqual(splitCity("Longview"), { city: "Longview", state: "" });
  const base = { name: "x", email: "a@b.co", city: "Tyler", phone: "9035550142" };
  assert.equal((readSignup({ ...base, heard: "google" }) as any).heard, "google");
  assert.equal((readSignup({ ...base, heard: "a billboard" }) as any).heard, "other");
  assert.equal((readSignup({ ...base }) as any).heard, "");
});

test("sign-ups this week: tally by source, tier and how they heard", async () => {
  const { tallySignups } = await import("../src/starter.ts");
  const rows = [
    { companyId: 1, on: "2026-11-20", src: "facebook", lp: "", door: "free", heard: "google" },
    { companyId: 2, on: "2026-11-20", src: "", lp: "spring", door: "grow", heard: "" },
    { companyId: 3, on: "2026-11-18", src: "facebook", lp: "", door: "free", heard: "friend" },
    { companyId: 4, on: "2026-11-01", src: "old", lp: "", door: "free", heard: "" },
  ];
  const t = tallySignups(rows, "2026-11-20", 7);
  assert.equal(t.total, 3);
  assert.deepEqual(t.bySource[0], { name: "facebook", count: 2 });
  assert.deepEqual(t.byDoor.find((x) => x.name === "grow"), { name: "grow", count: 1 });
  assert.equal(t.byHeard.find((x) => x.name === "not answered")?.count, 1);
  assert.equal(t.perDay.length, 7);
  assert.equal(t.perDay[6].count, 2);
  assert.equal(t.latest[0].companyId >= 1, true);
});

test("day-3 email: due list, wording and off by default", async () => {
  const { day3Due, day3Email } = await import("../src/day3email.ts");
  assert.equal(STARTER_DEFAULTS.day3Email, false);
  assert.equal(readStarter({ day3Email: true }).day3Email, true);
  const rows = [{ companyId: 1, on: "2026-11-17" }, { companyId: 2, on: "2026-11-19" }, { companyId: 3, on: "2026-11-10" }, { companyId: 4, on: "2026-11-16" }];
  assert.deepEqual(day3Due(rows, new Set([4]), "2026-11-20"), [1]);
  const en = day3Email({ es: false, company: "Rose City", credits: 250, expiresOn: "2027-01-19", hasJob: false });
  assert.equal(en.subject, "Try your first estimate draft");
  assert.match(en.body, /250 welcome credits/);
  assert.match(en.body, /no tips/);
  assert.equal(day3Email({ es: true, company: "Rose City", credits: 200, expiresOn: "", hasJob: true }).subject, "Siguiente paso: lea una foto del trabajo");
});

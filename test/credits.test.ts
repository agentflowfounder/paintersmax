import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ALLOWANCES, CREDIT_COST, CREDIT_EXPIRY_DAYS, EXPIRY_DAYS, TOPUPS, WELCOME_CREDITS, allowanceByPrice, creditView, grantCredits, ledger, readAllowanceRecord, readGrants, refundCredits, spendCredits } from "../src/credits.ts";
import { FEATURES, PLAN_LIMITS, consume, monthKey, refund } from "../src/usage.ts";

/** A real SQLite database shaped like D1 (first/run/all), so the compare-and-swap really runs. */
function realEnv(extra: Record<string, unknown> = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE usage_counters (company_id INTEGER NOT NULL, feature TEXT NOT NULL, period TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, feature, period));");
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);");
  const DB = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      return {
        bind(...a: any[]) {
          return {
            async first() { return (st.get(...a) as any) ?? null; },
            async run() { st.run(...a); return { meta: { changes: 1 } }; },
            async all() { return { results: st.all(...a) }; },
          };
        },
      };
    },
  };
  return { env: { DB, ...extra } as any, db };
}
const day = (n: number) => new Date(Date.UTC(2026, 10, 14 + n)).toISOString().slice(0, 10); // 2026-11-14 plus n days
const todayLocal = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);

test("every feature has a credit cost, and a heavier job costs more", () => {
  for (const f of FEATURES) assert.ok(CREDIT_COST[f] >= 1, f);
  assert.ok(CREDIT_COST.hd_render > CREDIT_COST.help_chat);
});

test("allowances and top-ups are the approved prices, and bigger top-ups get a slightly better rate", () => {
  assert.deepEqual(ALLOWANCES.map((a) => [a.priceCents, a.credits]), [[1900, 150], [3900, 400], [7900, 1000]]);
  assert.deepEqual(TOPUPS.map((t) => [t.priceCents, t.credits]), [[500, 50], [1000, 100], [2000, 220], [5000, 600], [10000, 1300]]);
  const rate = TOPUPS.map((t) => t.credits / (t.priceCents / 100));
  for (let i = 1; i < rate.length; i++) assert.ok(rate[i] >= rate[i - 1], "rate never gets worse");
  assert.equal(WELCOME_CREDITS, 1000);
  assert.equal(allowanceByPrice(3900)?.id, "a39");
  assert.equal(allowanceByPrice(1234), null);
  // Allowance credits roll over for two months; top-ups do not expire during early access.
  assert.equal(EXPIRY_DAYS.allowance, 90);
  assert.ok(EXPIRY_DAYS.topup >= 3650);
});

test("readAllowanceRecord keeps only a well-formed record", () => {
  assert.equal(readAllowanceRecord(null), null);
  assert.equal(readAllowanceRecord({ allowanceId: "nope", subscriptionId: "sub_1" }), null);
  assert.deepEqual(readAllowanceRecord({ allowanceId: "a19", subscriptionId: "sub_1", status: "weird", since: "2026-11-14", lastGrantOn: "bad" }), { allowanceId: "a19", subscriptionId: "sub_1", status: "active", since: "2026-11-14", lastGrantOn: null });
});

test("ledger: oldest credits are used first, and expired credits are never counted", () => {
  const g = (id: string, credits: number, on: string, expiresOn: string) => ({ id, credits, on, expiresOn, source: "pack" as const, note: "" });
  const grants = [g("a", 25, "2026-08-01", "2026-10-30"), g("b", 25, "2026-10-01", "2026-12-30")];
  const l = ledger(grants, 10, "2026-11-14");
  assert.equal(l.writeOff, 15); // 15 of the first pack ran out of time
  assert.equal(l.balance, 25);
  assert.deepEqual(l.nextExpiry, { on: "2026-12-30", credits: 25 });
  // After the write-off is recorded (spent goes up by 15), a new use comes out of the second pack.
  const after = ledger(grants, 10 + 15 + 3, "2026-11-14");
  assert.equal(after.writeOff, 0);
  assert.equal(after.balance, 22);
  assert.equal(ledger([], 5, "2026-11-14").balance, 0);
});

test("readGrants drops bad rows and keeps oldest first", () => {
  const out = readGrants({ grants: [{ id: "b", credits: 5, on: "2026-11-02", expiresOn: "2027-01-31", source: "topup" }, { id: "a", credits: "10", on: "2026-11-01", expiresOn: "2027-01-30", source: "admin" }, { id: "", credits: 5, on: "2026-11-01", expiresOn: "2027-01-30" }, { id: "c", credits: 0, on: "2026-11-01", expiresOn: "2027-01-30" }, { id: "d", credits: 5, on: "bad", expiresOn: "2027-01-30" }] });
  assert.deepEqual(out.map((g) => g.id), ["a", "b"]);
  assert.equal(out[0].source, "admin");
  assert.deepEqual(readGrants(null), []);
});

test("grant, spend, refund: the balance never goes below zero and a payment counts once", async () => {
  const { env } = realEnv();
  const t = day(0);
  assert.deepEqual(await grantCredits(env, 7, { id: "stripe:cs_1", credits: 5, source: "pack" }, t), { ok: true, added: true });
  assert.deepEqual(await grantCredits(env, 7, { id: "stripe:cs_1", credits: 5, source: "pack" }, t), { ok: true, added: false }); // same payment reported twice
  assert.equal((await grantCredits(env, 7, { id: "x", credits: 0, source: "admin" }, t)).ok, false);
  assert.equal((await creditView(env, 7, t)).balance, 5);
  assert.deepEqual(await spendCredits(env, 7, 3, t), { ok: true, balance: 2 });
  assert.deepEqual(await spendCredits(env, 7, 3, t), { ok: false, balance: 2 }); // not enough for a 3
  assert.deepEqual(await spendCredits(env, 7, 2, t), { ok: true, balance: 0 });
  assert.equal((await spendCredits(env, 7, 1, t)).ok, false);
  await refundCredits(env, 7, 2);
  assert.equal((await creditView(env, 7, t)).balance, 2);
  assert.equal((await spendCredits(env, 99, 1, t)).ok, false); // another company has none
});

test("two uses at the same moment never spend the same credit", async () => {
  const { env } = realEnv();
  const t = day(0);
  await grantCredits(env, 1, { id: "g", credits: 5, source: "admin" }, t);
  const results = await Promise.all(Array.from({ length: 8 }, () => spendCredits(env, 1, 1, t)));
  assert.equal(results.filter((r) => r.ok).length, 5);
  assert.equal((await creditView(env, 1, t)).balance, 0);
});

test("credits run out of time after the expiry days, and the lost ones are never spent", async () => {
  const { env } = realEnv();
  await grantCredits(env, 1, { id: "old", credits: 10, source: "pack" }, day(0));
  await grantCredits(env, 1, { id: "new", credits: 10, source: "pack" }, day(60));
  assert.equal((await creditView(env, 1, day(CREDIT_EXPIRY_DAYS))).balance, 20); // the last day still counts
  assert.equal((await creditView(env, 1, day(CREDIT_EXPIRY_DAYS + 1))).balance, 10); // the first pack ended
  assert.deepEqual(await spendCredits(env, 1, 4, day(CREDIT_EXPIRY_DAYS + 1)), { ok: true, balance: 6 }); // comes out of the second pack
  assert.equal((await creditView(env, 1, day(CREDIT_EXPIRY_DAYS + 1))).balance, 6);
  assert.equal((await spendCredits(env, 1, 7, day(CREDIT_EXPIRY_DAYS + 1))).ok, false);
});

test("consume: a plan keeps going on credits after the monthly amount, and credits also open what the plan does not include", async () => {
  const { env } = realEnv();
  const co = { id: 5, plan: "starter" };
  const limit = PLAN_LIMITS.starter.help_chat;
  for (let i = 0; i < limit; i++) assert.equal((await consume(env, co, "help_chat")).allowed, true);
  assert.equal((await consume(env, co, "help_chat") as any).reason, "monthly_limit"); // no credits yet
  await grantCredits(env, 5, { id: "g", credits: 3, source: "admin" }, todayLocal());
  const a = await consume(env, co, "help_chat");
  assert.equal(a.allowed, true);
  assert.equal((a as any).credit, CREDIT_COST.help_chat);
  assert.equal((await creditView(env, 5, todayLocal())).balance, 3 - CREDIT_COST.help_chat);
  // Starter has no HD renders: without enough credits the answer is not_in_plan; with credits the render runs (decided 2026-11-14).
  assert.equal((await consume(env, co, "hd_render") as any).reason, "not_in_plan"); // 2 credits left, a render costs 5
  await grantCredits(env, 5, { id: "g2", credits: 10, source: "topup" }, todayLocal());
  const r = await consume(env, co, "hd_render");
  assert.equal(r.allowed, true);
  assert.equal((r as any).credit, CREDIT_COST.hd_render);
  // The credit use is counted separately from the monthly count.
  const used = env.DB.prepare("SELECT count FROM usage_counters WHERE company_id = 5 AND feature = 'help_chat:credit' AND period = ?").bind(monthKey());
  assert.equal((await used.first()).count, 1);
});

test("consume: a free plan spends credits too, and without credits it still stops at the monthly amount", async () => {
  const { env } = realEnv();
  const co = { id: 6, plan: "free" };
  for (let i = 0; i < PLAN_LIMITS.free.help_chat; i++) await consume(env, co, "help_chat");
  assert.equal((await consume(env, co, "help_chat") as any).reason, "monthly_limit");
  await grantCredits(env, 6, { id: "g", credits: 50, source: "topup" }, todayLocal());
  assert.equal((await consume(env, co, "help_chat")).allowed, true);
  assert.equal((await creditView(env, 6, todayLocal())).balance, 50 - CREDIT_COST.help_chat);
});

test("refund gives credits back when the failed call was paid for with credits, and the month's count otherwise", async () => {
  const { env } = realEnv();
  const co = { id: 8, plan: "starter" };
  await grantCredits(env, 8, { id: "g", credits: 10, source: "admin" }, todayLocal());
  // One normal use failed: the monthly count goes back down.
  await consume(env, co, "receipt_read");
  await refund(env, co, "receipt_read");
  const cnt = async (f: string) => ((await env.DB.prepare("SELECT count FROM usage_counters WHERE company_id = 8 AND feature = ? AND period = ?").bind(f, monthKey()).first())?.count ?? 0);
  assert.equal(await cnt("receipt_read"), 0);
  assert.equal((await creditView(env, 8, todayLocal())).balance, 10);
  // Use up the month, then a credit use fails: the credits come back and the month stays at its limit.
  for (let i = 0; i < PLAN_LIMITS.starter.receipt_read; i++) await consume(env, co, "receipt_read");
  const paid = await consume(env, co, "receipt_read");
  assert.equal((paid as any).credit, CREDIT_COST.receipt_read);
  assert.equal((await creditView(env, 8, todayLocal())).balance, 10 - CREDIT_COST.receipt_read);
  await refund(env, co, "receipt_read");
  assert.equal((await creditView(env, 8, todayLocal())).balance, 10);
  assert.equal(await cnt("receipt_read"), PLAN_LIMITS.starter.receipt_read);
  assert.equal(await cnt("receipt_read:credit"), 0);
});

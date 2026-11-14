import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CREDIT_COST, CREDIT_EXPIRY_DAYS, CREDIT_PACKS, creditView, grantCredits, ledger, readGrants, refundCredits, spendCredits } from "../src/credits.ts";
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
  assert.equal(CREDIT_PACKS[0].credits, 25);
  assert.equal(CREDIT_PACKS[0].priceCents, null); // not for sale until the owner sets a price
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
  const out = readGrants({ grants: [{ id: "b", credits: 5, on: "2026-11-02", expiresOn: "2027-01-31" }, { id: "a", credits: "10", on: "2026-11-01", expiresOn: "2027-01-30", source: "admin" }, { id: "", credits: 5, on: "2026-11-01", expiresOn: "2027-01-30" }, { id: "c", credits: 0, on: "2026-11-01", expiresOn: "2027-01-30" }, { id: "d", credits: 5, on: "bad", expiresOn: "2027-01-30" }] });
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

test("consume: a paid plan keeps going on credits after the monthly allowance, but only for what the plan includes", async () => {
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
  // Starter has no HD renders, and credits do not unlock them.
  assert.equal((await consume(env, co, "hd_render") as any).reason, "not_in_plan");
  // The credit use is counted separately from the monthly count.
  const used = env.DB.prepare("SELECT count FROM usage_counters WHERE company_id = 5 AND feature = 'help_chat:credit' AND period = ?").bind(monthKey());
  assert.equal((await used.first()).count, 1);
});

test("consume: a free plan never spends credits, even if some were added", async () => {
  const { env } = realEnv();
  await grantCredits(env, 6, { id: "g", credits: 50, source: "admin" }, todayLocal());
  const co = { id: 6, plan: "free" };
  for (let i = 0; i < PLAN_LIMITS.free.help_chat; i++) await consume(env, co, "help_chat");
  assert.equal((await consume(env, co, "help_chat") as any).reason, "monthly_limit");
  assert.equal((await creditView(env, 6, todayLocal())).balance, 50);
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

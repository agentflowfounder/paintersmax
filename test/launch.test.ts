import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { autoItems, launchChecklist, MANUAL_ITEMS, readTicks, tickLaunch } from "../src/launch.ts";
import { runSelfTest, type SelfTestIo } from "../src/stripecheck.ts";

function env(extra: Record<string, unknown> = {}) {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init", "0004_usage", "0010_app_settings"]) db.exec(readFileSync(new URL(`../migrations/${f}.sql`, import.meta.url), "utf8"));
  const wrap = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => wrap(sql, a),
    run: async () => { const r = db.prepare(sql).run(...(args as any[])); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    first: async () => (db.prepare(sql).get(...(args as any[])) as any) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) as any[] }),
  });
  return { DB: { prepare: (s: string) => wrap(s), batch: async (l: any[]) => { for (const x of l) await x.run(); return []; } }, db, ...extra } as any;
}

const facts = { keyMode: "test", webhookSecret: true, endpointsOk: true, lastEventAt: "2026-11-22 23:30:54", backupOn: "", today: "2026-11-23", demosBuilt: true, samplesOn: true, welcomeOn: true };

test("auto items: test keys are not ready for launch, live keys are; backups go stale after 7 days", () => {
  const get = (f: typeof facts, id: string) => autoItems(f).find((i) => i.id === id)!;
  assert.equal(get(facts, "live_key").done, false);
  assert.equal(get({ ...facts, keyMode: "live" }, "live_key").done, true);
  assert.equal(get(facts, "backup").done, false);
  assert.equal(get({ ...facts, backupOn: "2026-11-20" }, "backup").done, true);
  assert.equal(get({ ...facts, backupOn: "2026-11-01" }, "backup").done, false);
  assert.equal(get({ ...facts, endpointsOk: null }, "webhook_events").done, false);
  assert.equal(get({ ...facts, lastEventAt: null }, "event_received").done, false);
});

test("checklist counts auto and hand-ticked items, and only known manual items can be ticked", async () => {
  const e = env({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" });
  e.db.exec("INSERT INTO app_settings (key, value) VALUES ('tierdemos:sig', '{\"sig\":\"x\"}')");
  const a = await launchChecklist(e, "2026-11-23", { endpointsOk: true, lastEventAt: "2026-11-22 23:30:54" });
  assert.equal(a.total, 8 + MANUAL_ITEMS.length);
  assert.equal(a.items.find((i) => i.id === "demos")!.done, true);
  assert.deepEqual(await tickLaunch(e, "two_factor", true), { ok: true });
  assert.equal((await tickLaunch(e, "live_key", true)).ok, false);
  const b = await launchChecklist(e, "2026-11-23", { endpointsOk: true, lastEventAt: null });
  assert.equal(b.items.find((i) => i.id === "two_factor")!.done, true);
  await tickLaunch(e, "two_factor", false);
  assert.deepEqual(readTicks({ done: { two_factor: true, bogus: true, help_reviewed: false } }), { two_factor: true });
});

function io(over: Partial<SelfTestIo> = {}) {
  const calls: string[] = [];
  const base: SelfTestIo = {
    post: async (path) => { calls.push("POST " + path); return { id: path.startsWith("customers") ? "cus_1" : "prod_1" }; },
    del: async (path) => { calls.push("DELETE " + path); },
    eventsSince: async () => [{ type: "invoice.paid", at: "2026-11-23 00:00:01" }],
    sleep: async () => {},
    now: () => "2026-11-23 00:00:00",
  };
  return { io: { ...base, ...over }, calls };
}

test("Test Stripe: passes when an event arrives, and always removes the test customer", async () => {
  const { io: i, calls } = io();
  const r = await runSelfTest(i, "test");
  assert.equal(r.ok, true);
  assert.deepEqual(r.events, ["invoice.paid"]);
  assert.ok(calls.includes("DELETE customers/cus_1"));
});

test("Test Stripe: explains the failure when no event arrives, and still cleans up", async () => {
  const { io: i, calls } = io({ eventsSince: async () => [] });
  const r = await runSelfTest(i, "test", 3000);
  assert.equal(r.ok, false);
  assert.match(r.steps.find((s) => !s.ok)!.text, /signing secret/);
  assert.ok(calls.includes("DELETE customers/cus_1"));
});

test("Test Stripe: never runs with live keys or no key, and reports a Stripe refusal", async () => {
  const { io: i, calls } = io();
  assert.equal((await runSelfTest(i, "live")).ok, false);
  assert.equal((await runSelfTest(i, "missing")).ok, false);
  assert.equal(calls.length, 0);
  const bad = io({ post: async () => { throw new Error("boom"); } });
  const r = await runSelfTest(bad.io, "test");
  assert.equal(r.ok, false);
  assert.match(r.steps[0].text, /boom/);
});

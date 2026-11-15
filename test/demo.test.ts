import test from "node:test";
import assert from "node:assert/strict";
import { checkCaps, computeQuote, DEMO_LIMITS, handleDemo, memoryStore, quoteParts } from "../src/demo.ts";

const post = (path: string, body: unknown, headers: Record<string, string> = { "cf-connecting-ip": "203.0.113.7" }) =>
  new Request(`https://paintersmax.app/api/demo/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("a quote is arithmetic on the starting price list and adds up", () => {
  const q = computeQuote("interior", { bedrooms: 2, living: 1 });
  assert.ok(q.ok);
  if (!q.ok) return;
  assert.equal(q.lines.length, 2);
  assert.equal(q.low, 2 * 650 + 950);
  assert.equal(q.high, 2 * 1150 + 1800);
  assert.equal(q.likely, Math.round((q.low + q.high) / 2 / 5) * 5, "likely sits in the middle, rounded like the price list");
  assert.ok(q.low < q.likely && q.likely < q.high);
});

test("a quote needs something to price and rejects unknown kinds", () => {
  assert.equal(computeQuote("interior", {}).ok, false);
  assert.equal(computeQuote("spaceship", { bedrooms: 3 }).ok, false);
  assert.equal(quoteParts("nope", {}), null);
});

test("quote inputs are clamped so nobody can price a million doors", () => {
  const parts = quoteParts("cabinets", { doors: 9999, drawers: -5 });
  assert.deepEqual(parts, [{ id: "cb_standard_cabinet_door", qty: 80 }]);
  assert.deepEqual(quoteParts("exterior", { siding: "unknown", wallSqft: "abc", entryDoors: 2 }), [{ id: "ex_exterior_entry_doors", qty: 2 }]);
});

test("limits: per visit, then per address, then site-wide, each with its own scope", async () => {
  const store = memoryStore();
  const caps = { visit: 2, ip: 5, site: 100 };
  const keys = { visit: "v1", ip: "ip1" };
  assert.equal(await checkCaps(store, "chat", keys, caps, "2026-12-01"), null);
  assert.equal(await checkCaps(store, "chat", keys, caps, "2026-12-01"), null);
  assert.equal(await checkCaps(store, "chat", keys, caps, "2026-12-01"), "visit", "third message in one visit is stopped");
  // A fresh browser id on the same address still shares the address allowance.
  assert.equal(await checkCaps(store, "chat", { visit: "v2", ip: "ip1" }, caps, "2026-12-01"), null);
  assert.equal(await checkCaps(store, "chat", { visit: "v2", ip: "ip1" }, caps, "2026-12-01"), null);
  assert.equal(await checkCaps(store, "chat", { visit: "v3", ip: "ip1" }, caps, "2026-12-01"), "ip");
  // The site-wide cap stops everyone once it is used up.
  const tiny = { visit: 9, ip: 9, site: 2 };
  const s2 = memoryStore();
  assert.equal(await checkCaps(s2, "color", { visit: "a", ip: "x" }, tiny, "2026-12-01"), null);
  assert.equal(await checkCaps(s2, "color", { visit: "b", ip: "y" }, tiny, "2026-12-01"), null);
  assert.equal(await checkCaps(s2, "color", { visit: "c", ip: "z" }, tiny, "2026-12-01"), "site");
  // A new day starts fresh.
  assert.equal(await checkCaps(s2, "color", { visit: "c", ip: "z" }, tiny, "2026-12-02"), null);
});

test("the chat stops with a friendly limit answer before any AI is called", async () => {
  const store = memoryStore();
  const env: any = {}; // no AI keys: if the limit let it through, the answer would be a 503, not a 429
  let last: Response | undefined;
  for (let i = 0; i <= DEMO_LIMITS.chatPerVisit; i++) last = await handleDemo(post("chat", { browserId: "tab-1", message: "hi" }), env, store);
  assert.equal(last!.status, 429);
  const j: any = await last!.json();
  assert.equal(j.limited, true);
  assert.equal(j.scope, "visit");
});

test("quote, chat and color reject bad requests without spending a try", async () => {
  const store = memoryStore();
  const env: any = {};
  assert.equal((await handleDemo(post("chat", { browserId: "t", message: "   " }), env, store)).status, 400);
  assert.equal(store.counts.size, 0, "an empty message costs nothing");
  assert.equal((await handleDemo(post("color", { browserId: "t", hex: "#123456", image: "nope", surface: "walls" }), env, store)).status, 400);
  assert.equal(store.counts.size, 0);
  assert.equal((await handleDemo(post("quote", { kind: "cabinets", doors: 10, drawers: 4 }), env, store)).status, 200);
  assert.equal((await handleDemo(new Request("https://paintersmax.app/api/demo/chat"), env, store)).status, 404);
});

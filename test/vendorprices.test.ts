import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanDeal, FRESH_DAYS, OLD_DAYS, priceFresh, readDeals, readLog } from "../src/vendors.ts";

const NOW = "2026-11-28";

test("a price is fresh for 30 days, aging to 60, then old", () => {
  assert.equal(FRESH_DAYS, 30);
  assert.equal(OLD_DAYS, 60);
  const at = (d: string) => priceFresh({ createdAt: `${d} 10:00:00` }, undefined, NOW);
  assert.deepEqual(at("2026-11-28"), { checkedOn: "2026-11-28", ageDays: 0, state: "fresh" });
  assert.equal(at("2026-10-29").state, "fresh"); // 30 days
  assert.equal(at("2026-10-28").state, "aging"); // 31 days
  assert.equal(at("2026-09-29").state, "aging"); // 60 days
  assert.equal(at("2026-09-28").state, "old"); // 61 days
});

test("the date on the price sheet counts, and the newest date wins", () => {
  const f = priceFresh({ effectiveOn: "2026-11-20", createdAt: "2026-08-01 09:00:00" }, undefined, NOW);
  assert.equal(f.checkedOn, "2026-11-20");
  assert.equal(f.state, "fresh");
  // an old sheet date loses to a newer day it was added
  assert.equal(priceFresh({ effectiveOn: "2026-01-01", createdAt: "2026-11-27 09:00:00" }, undefined, NOW).checkedOn, "2026-11-27");
});

test("Still good resets the age, and a deal past its end date is expired", () => {
  const old = { createdAt: "2026-06-01 09:00:00" };
  assert.equal(priceFresh(old, undefined, NOW).state, "old");
  assert.equal(priceFresh(old, cleanDeal({ confirmedOn: "2026-11-25" }), NOW).state, "fresh");
  const ended = cleanDeal({ deal: "volume pricing", expiresOn: "2026-11-27", confirmedOn: NOW });
  assert.equal(priceFresh({ createdAt: `${NOW} 08:00:00` }, ended, NOW).state, "expired");
  const ends = cleanDeal({ expiresOn: NOW });
  assert.equal(priceFresh({ createdAt: `${NOW} 08:00:00` }, ends, NOW).state, "fresh"); // good through the end date
});

test("deal notes keep only valid dates and short text, and never anything else", () => {
  const d = cleanDeal({ rep: "  Mike  ", deal: "x".repeat(500), expiresOn: "12/31/2026", confirmedOn: "2026-11-25", bank: "123456789" });
  assert.equal(d.rep, "Mike");
  assert.equal(d.deal.length, 200);
  assert.equal(d.expiresOn, "");
  assert.equal(d.confirmedOn, "2026-11-25");
  assert.deepEqual(Object.keys(d).sort(), ["confirmedOn", "deal", "expiresOn", "rep"]);
  const book = readDeals({ "12": { rep: "A" }, nope: { rep: "B" }, "13": {} });
  assert.deepEqual(Object.keys(book), ["12"]);
});

test("rep notes are kept per vendor, newest 60, with short text", () => {
  const raw = { "5": Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, at: "2026-11-28", text: "y".repeat(900) })), "x": [{ id: "a", text: "b" }] };
  const log = readLog(raw);
  assert.deepEqual(Object.keys(log), ["5"]);
  assert.equal(log["5"].length, 60);
  assert.equal(log["5"][59].id, "n79");
  assert.equal(log["5"][0].text.length, 500);
});

test("the Vendors page says prices are suggestions and the estimate warns about old prices", () => {
  const page = readFileSync(new URL("../public/vendors.html", import.meta.url), "utf8");
  assert.match(page, /not store quotes/);
  assert.match(page, /data-good=/);
  assert.match(page, /Rep and deal notes/);
  const jobs = readFileSync(new URL("../public/jobs.html", import.meta.url), "utf8");
  assert.match(jobs, /Check it with the store before you rely on it/);
  assert.doesNotMatch(page, /will charge|guarantee/i);
});

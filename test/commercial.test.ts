import { test } from "node:test";
import assert from "node:assert/strict";
import { commercialBlockedMessage, commercialStatus } from "../src/commercial.ts";

test("Free and Starter cannot start a commercial bid", () => {
  assert.equal(commercialStatus("free", 0, false).allowed, false);
  assert.equal(commercialStatus("starter", 0, false).allowed, false);
  assert.match(commercialBlockedMessage(commercialStatus("free", 0, false)), /Basic and Pro/);
});

test("Basic gets one try, then must upgrade; the job with the estimate stays editable", () => {
  assert.equal(commercialStatus("basic", 0, false).allowed, true);
  assert.equal(commercialStatus("basic", 1, false).allowed, false);
  assert.equal(commercialStatus("basic", 1, true).allowed, true);
  assert.match(commercialBlockedMessage(commercialStatus("basic", 1, false)), /Pro includes unlimited/);
});

test("Pro is unlimited", () => {
  const s = commercialStatus("pro", 50, false);
  assert.equal(s.allowed, true);
  assert.equal(s.limit, null);
});

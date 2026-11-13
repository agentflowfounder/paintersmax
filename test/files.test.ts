import { test } from "node:test";
import assert from "node:assert/strict";
import { storageNotice, STORAGE_LIMIT, extFor, cleanName } from "../src/files.ts";

test("storage notice levels", () => {
  const L = STORAGE_LIMIT.starter;
  assert.equal(storageNotice(0, L, "starter").level, "ok");
  assert.equal(storageNotice(0, L, "starter").message, null);
  const w = storageNotice(Math.round(L * 0.8), L, "starter");
  assert.equal(w.level, "warn");
  assert.ok(w.upgrade && w.message!.includes("80%"));
  assert.equal(storageNotice(Math.round(L * 0.96), L, "starter").level, "high");
  const f = storageNotice(L, L, "free");
  assert.equal(f.level, "full");
  assert.ok(f.message!.includes("paused"));
  assert.equal(storageNotice(L, STORAGE_LIMIT.pro, "pro").upgrade, false);
});
test("storage grows with the plan and file names are cleaned", () => {
  assert.ok(STORAGE_LIMIT.free < STORAGE_LIMIT.starter && STORAGE_LIMIT.starter < STORAGE_LIMIT.basic && STORAGE_LIMIT.basic < STORAGE_LIMIT.pro);
  assert.equal(extFor("image/jpeg"), "jpg");
  assert.equal(extFor("text/html"), null);
  assert.equal(cleanName("../../a b<c>.jpg"), ".._.._a b_c_.jpg");
});

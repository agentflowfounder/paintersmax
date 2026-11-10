import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/admin.ts";

test("slugify makes safe, short URL names", () => {
  assert.equal(slugify("Tyler Painters"), "tyler-painters");
  assert.equal(slugify("  José's  Pintura & Más!! "), "jose-s-pintura-mas");
  assert.equal(slugify("***"), "client");
  assert.ok(slugify("x".repeat(200)).length <= 40);
});

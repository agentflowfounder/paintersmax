import test from "node:test";
import assert from "node:assert/strict";
import { cleanHost, isPlatformHost } from "../src/domains.ts";

test("cleanHost accepts real domains and rejects ours and junk", () => {
  assert.equal(cleanHost("Rivera-Painting.com"), "rivera-painting.com");
  assert.equal(cleanHost("https://www.rivera-painting.com/about"), "www.rivera-painting.com");
  assert.equal(cleanHost("rivera.paintersmax.app"), null);
  assert.equal(cleanHost("paintersmax.app"), null);
  assert.equal(cleanHost("x.workers.dev"), null);
  assert.equal(cleanHost("localhost"), null);
  assert.equal(cleanHost("no_underscore.com"), null);
  assert.equal(cleanHost("a b.com"), null);
  assert.equal(cleanHost(42), null);
  assert.equal(isPlatformHost("www.paintersmax.app"), true);
  assert.equal(isPlatformHost("paintersmax.app.evil.com"), false);
});

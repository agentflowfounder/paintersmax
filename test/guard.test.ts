import test from "node:test";
import assert from "node:assert/strict";
import { crossSiteWrite, visitorKey } from "../src/guard.ts";

const req = (headers: Record<string, string> = {}, method = "POST", url = "https://paintersmax.app/api/lead") => new Request(url, { method, headers });

test("visitor key is bound to the network address: a new browser id from the same address shares the cap", async () => {
  const a = await visitorKey(req({ "cf-connecting-ip": "203.0.113.5", "user-agent": "x" }), "id-1");
  const b = await visitorKey(req({ "cf-connecting-ip": "203.0.113.5", "user-agent": "x" }), "id-2");
  const c = await visitorKey(req({ "cf-connecting-ip": "203.0.113.9", "user-agent": "x" }), "id-1");
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b, "two browser ids behind one address stay apart");
  assert.notEqual(a, c, "the same browser id from another address is another visitor");
  assert.equal(a, await visitorKey(req({ "cf-connecting-ip": "203.0.113.5", "user-agent": "x" }), "id-1"), "stable");
  // Without a browser id the user agent stands in, still bound to the address.
  assert.equal(await visitorKey(req({ "cf-connecting-ip": "1.1.1.1", "user-agent": "ua" })), await visitorKey(req({ "cf-connecting-ip": "1.1.1.1", "user-agent": "ua" }), ""));
  assert.equal(await visitorKey(req({ "cf-connecting-ip": "1.1.1.1" }), { not: "a string" } as any), await visitorKey(req({ "cf-connecting-ip": "1.1.1.1" })));
});

test("cross-site writes are blocked only for signed-in browsers", () => {
  // No session cookie: public forms from client sites and custom domains keep working.
  assert.equal(crossSiteWrite(req({ origin: "https://rivera-painting.paintersmax.app", "sec-fetch-site": "same-site" }), false), false);
  // Signed in, same origin: fine.
  assert.equal(crossSiteWrite(req({ origin: "https://paintersmax.app", "sec-fetch-site": "same-origin" }), true), false);
  assert.equal(crossSiteWrite(req({}), true), false, "old browsers that send neither header are allowed (SameSite=Lax still protects them)");
  assert.equal(crossSiteWrite(req({ "sec-fetch-site": "none" }), true), false, "typed in the address bar");
  // Signed in, from a sibling subdomain or another site: blocked.
  assert.equal(crossSiteWrite(req({ "sec-fetch-site": "same-site" }), true), true);
  assert.equal(crossSiteWrite(req({ "sec-fetch-site": "cross-site" }), true), true);
  assert.equal(crossSiteWrite(req({ origin: "https://evil.example" }), true), true);
  assert.equal(crossSiteWrite(req({ origin: "https://rivera-painting.paintersmax.app" }), true), true);
  // Reads are never blocked.
  assert.equal(crossSiteWrite(req({ origin: "https://evil.example" }, "GET"), true), false);
});

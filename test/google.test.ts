import test from "node:test";
import assert from "node:assert/strict";
import { readIdToken } from "../src/google.ts";

const jwt = (claims: object) => `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

test("readIdToken reads email, verified flag, audience and issuer", () => {
  const c = readIdToken(jwt({ email: "Tyler@Gmail.com", email_verified: true, aud: "cid", iss: "https://accounts.google.com" }))!;
  assert.equal(c.email, "tyler@gmail.com");
  assert.equal(c.emailVerified, true);
  assert.equal(c.aud, "cid");
});

test("readIdToken copes with junk", () => {
  assert.equal(readIdToken(undefined), null);
  assert.equal(readIdToken("nodots"), null);
  assert.equal(readIdToken("a.@@@.c"), null);
  assert.equal(readIdToken(jwt({ email: "x@y.z" }))!.emailVerified, false);
});

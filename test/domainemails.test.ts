import test from "node:test";
import assert from "node:assert/strict";
import { dueStep, fieldsFor, firstEmail, readDmSettings, reminderEmail } from "../src/domainemails.ts";

const none = { first: "", reminder: "" };

test("nothing before day 1, first email on day 1, reminder on day 25", () => {
  assert.equal(dueStep("2026-12-01", "2026-12-01", none), null);
  assert.equal(dueStep("2026-12-01", "2026-12-02", none), "first");
  assert.equal(dueStep("2026-12-01", "2026-12-02", { first: "2026-12-02", reminder: "" }), null);
  assert.equal(dueStep("2026-12-01", "2026-12-25", { first: "2026-12-02", reminder: "" }), null);
  assert.equal(dueStep("2026-12-01", "2026-12-26", { first: "2026-12-02", reminder: "" }), "reminder");
  assert.equal(dueStep("2026-12-01", "2026-12-26", { first: "2026-12-02", reminder: "2026-12-26" }), null);
});
test("a missed day 1 is skipped once day 25 has come, and nothing goes after the reuse date", () => {
  assert.equal(dueStep("2026-12-01", "2026-12-26", none), "reminder");
  assert.equal(dueStep("2026-12-01", "2026-12-31", { first: "", reminder: "2026-12-26" }), null);
  assert.equal(dueStep("2026-12-01", "2026-12-31", none), null);
});
test("emails fill every merge field and sign with the employee name", () => {
  const s = readDmSettings({ signer: "Ana Lopez" });
  const f = fieldsFor({ business: "Lone Star Painting", domain: "lonestarpainting.com", cancelledOn: "2026-12-01", expiresOn: "2027-06-01", settings: s });
  const a = firstEmail(f), b = reminderEmail(f);
  assert.equal(a.subject, "Your website lonestarpainting.com is on hold for you");
  assert.match(a.text, /starting 2026-12-31/);
  assert.match(a.text, /online until 2027-06-01/);
  assert.match(a.text, /Ana Lopez\nPaintersMax$/);
  assert.match(b.subject, /ready to use again on 2026-12-31/);
  assert.match(b.text, /AI credits/);
  assert.doesNotMatch(a.text + b.text, /\{\w+\}/);
});
test("no signer falls back to the team", () => {
  const f = fieldsFor({ business: "B", domain: "b.com", cancelledOn: "2026-12-01", expiresOn: "2027-06-01", settings: readDmSettings({}) });
  assert.match(firstEmail(f).text, /The PaintersMax team$/);
});

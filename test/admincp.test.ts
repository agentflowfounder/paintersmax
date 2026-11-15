import test from "node:test";
import assert from "node:assert/strict";
import { can, PERMS, roleFor, readTeam, ROLE_LIMITS, auditDetail } from "../src/adminroles.ts";
import { promoPrice, readPromo, validatePromo } from "../src/promos.ts";
import { applyRenewed, applySubEdit, doorFromPlan, readDoor, readSub, subState, subTotals, type SubRow } from "../src/subscriptions.ts";
import { domainQueue, readHeld } from "../src/helddomains.ts";
import { contactsCsv, contactsFromCsv, parseCsv, readContact, suggestDoor } from "../src/research.ts";
import { FEATURE_GROUP, readEnvelopes } from "../src/envelopes.ts";
import { readThread } from "../src/feedback.ts";
import { FEATURES } from "../src/usage.ts";

const today = "2026-11-20";
const promo = (o: any = {}) => readPromo({ code: "BOOKEDBYSPRING", name: "Booked by Spring", reason: "Holiday", startsOn: "2026-11-25", endsOn: "2027-01-06", kind: "floor", ...o })!;

test("roles: owner sees and changes everything, read only changes nothing", () => {
  assert.ok(can("owner", "security", "change"));
  assert.equal(PERMS.readonly.change.length, 0);
  assert.ok(!can("readonly", "security", "see"));
  assert.ok(can("sales", "promos", "change") && !can("sales", "credits", "change"));
  assert.ok(can("support", "credits", "change") && !can("support", "subscriptions", "see"));
  assert.equal(ROLE_LIMITS.support.maxGrantCredits, 200);
  assert.equal(ROLE_LIMITS.sales.maxPromoBonus, 500);
});

test("roles: a master owner login with no team entry is the owner; staff need a role; removed has none", () => {
  const team = readTeam([{ email: "Ana@X.com", role: "support" }, { email: "old@x.com", role: "removed" }, { email: "ana@x.com", role: "owner" }]);
  assert.equal(team.length, 2); // duplicate email dropped
  assert.equal(roleFor({ email: "boss@x.com", loginRole: "owner" }, team), "owner");
  assert.equal(roleFor({ email: "ana@x.com", loginRole: "staff" }, team), "support");
  assert.equal(roleFor({ email: "old@x.com", loginRole: "owner" }, team), null);
  assert.equal(roleFor({ email: "new@x.com", loginRole: "staff" }, team), null);
});

test("audit detail is short and on one line", () => {
  assert.equal(auditDetail("a\n\n b"), "a b");
  assert.ok(auditDetail("x".repeat(1000)).length <= 400);
  assert.equal(auditDetail({ a: 1 }), '{"a":1}');
});

test("promotions never go under the floor and never over the list price", () => {
  const d = "2026-12-01";
  assert.equal(promoPrice("launch", "signup", promo(), d).cents, 29900);
  assert.equal(promoPrice("grow", "signup", promo({ kind: "percent", value: 100 }), d).cents, 39900); // 100% off still lands on the floor
  assert.equal(promoPrice("signature", "signup", promo({ kind: "amount", value: 50 }), d).cents, 64900);
  assert.equal(promoPrice("launch", "signup", promo({ kind: "amount", value: 5000 }), d).cents, 29900);
  assert.equal(promoPrice("launch", "renewal", promo({ appliesTo: "both" }), d).cents, 19900);
  assert.equal(promoPrice("launch", "signup", null, d).cents, 39900); // no code: list price
});

test("a code outside its dates, turned off, for another door or for renewals does not apply", () => {
  assert.equal(promoPrice("launch", "signup", promo(), "2026-11-24").applied, false);
  assert.equal(promoPrice("launch", "signup", promo(), "2027-01-07").applied, false);
  assert.equal(promoPrice("launch", "signup", promo({ active: false }), "2026-12-01").applied, false);
  assert.equal(promoPrice("grow", "signup", promo({ doors: ["launch"] }), "2026-12-01").applied, false);
  assert.equal(promoPrice("launch", "signup", promo({ appliesTo: "renewal" }), "2026-12-01").why, "This code is for renewals.");
});

test("promotion checks: end date required, bonus credits within the role limit", () => {
  const base = { code: "spring-26", name: "Spring", reason: "Season", startsOn: "2027-03-01", endsOn: "2027-03-31", kind: "floor", bonusCredits: 250 };
  assert.ok("promo" in validatePromo(base, { maxBonus: 500, today, by: "a@x.com" }));
  assert.equal((validatePromo(base, { maxBonus: 500, today, by: "a" }) as any).promo.code, "SPRING-26");
  assert.ok("error" in validatePromo({ ...base, endsOn: "" }, { maxBonus: 500, today, by: "a" }));
  assert.ok("error" in validatePromo({ ...base, endsOn: "2027-02-01" }, { maxBonus: 500, today, by: "a" }));
  assert.ok("error" in validatePromo({ ...base, bonusCredits: 600 }, { maxBonus: 500, today, by: "a" }));
  assert.ok("error" in validatePromo({ ...base, bonusCredits: 10 }, { maxBonus: 0, today, by: "a" }));
  assert.ok("error" in validatePromo({ ...base, code: "a b" }, { maxBonus: 0, today, by: "a" }));
});

test("doors: follow the plan until set", () => {
  assert.equal(doorFromPlan("starter"), "launch");
  assert.equal(doorFromPlan("pro"), "signature");
  assert.equal(readDoor(null, "basic"), "grow");
  assert.equal(readDoor({ door: "launch", override: { pages: 9 } }, "pro"), "launch");
});

test("subscriptions: renewal states, missed renewal the day after, refund window", () => {
  const s = applySubEdit(null, { startedOn: "2026-11-10", renewsOn: "2027-11-10", paid: 299 }, today) as any;
  assert.equal(s.value.paidCents, 29900);
  const st = subState("launch", s.value, today);
  assert.equal(st.state, "paid");
  assert.equal(st.refundUntil, "2026-11-24");
  assert.equal(st.refundCents, 27900); // less $20 for the domain
  assert.equal(subState("launch", s.value, "2027-10-01").state, "due_60");
  assert.equal(subState("launch", s.value, "2027-11-01").state, "due_30");
  assert.equal(subState("launch", s.value, "2027-11-10").state, "due_30");
  assert.equal(subState("launch", s.value, "2027-11-11").state, "missed");
  assert.equal(subState("launch", s.value, "2026-11-25").refundUntil, null);
});

test("subscriptions: bad dates are refused; renewal moves a year and clears outreach", () => {
  assert.ok("error" in applySubEdit(null, { startedOn: "2026-11-10", renewsOn: "2026-11-01" }, today));
  assert.ok("error" in applySubEdit(null, { startedOn: "11/10/2026" }, today));
  const cur = readSub({ startedOn: "2025-11-10", renewsOn: "2026-11-10", outreach: "contacted", outreachNote: "called" })!;
  const r = applyRenewed(cur, 19900) as any;
  assert.equal(r.value.renewsOn, "2027-11-10");
  assert.equal(r.value.startedOn, "2026-11-10");
  assert.equal(r.value.outreach, "none");
  const c = applySubEdit(cur, { status: "cancelled" }, today) as any;
  assert.equal(c.value.cancelledOn, today);
  assert.equal(subState("grow", c.value, today).state, "cancelled");
});

test("subscription totals count doors, missed renewals and Founding painters", () => {
  const row = (o: Partial<SubRow>): SubRow => ({ companyId: 1, name: "", slug: "", email: "", door: "launch", state: "paid", startedOn: "2026-11-02", renewsOn: "", daysToRenewal: 300, renewalCents: 19900, paidCents: 29900, refundUntil: null, refundCents: 0, founding: false, promoCode: "", outreach: "none", outreachNote: "", outreachOn: "", ...o });
  const t = subTotals([row({ founding: true }), row({ state: "missed", door: "grow", startedOn: "2025-11-01" }), row({ state: "due_30", renewalCents: 24900, door: "grow" }), row({ door: "free", state: "free", paidCents: 0 })], today);
  assert.equal(t.byDoor.grow, 2);
  assert.equal(t.missed, 1);
  assert.equal(t.renewals60Cents, 24900);
  assert.equal(t.founding, 1);
  assert.equal(t.foundingLeft, 99);
  assert.equal(t.paidThisMonth, 29900 * 2);
});

test("held domains: decision queue, transfer lock and reuse only for generic names after 30 days", () => {
  const [g] = readHeld([{ name: "longviewpainters.com", boughtOn: "2026-11-01", expiresOn: "2027-11-01", kind: "generic" }]);
  const [b] = readHeld([{ name: "riverapainting.com", boughtOn: "2026-11-01", expiresOn: "2027-11-01", kind: "branded" }]);
  assert.equal(domainQueue(g, today, null).reason, null);
  assert.equal(domainQueue(g, today, null).canTransfer, false);
  assert.equal(domainQueue(g, "2027-01-01", null).canTransfer, true);
  assert.equal(domainQueue(g, "2027-09-10", null).reason, "expires_60");
  assert.equal(domainQueue(g, "2027-10-30", null).reason, "expires_7");
  assert.equal(domainQueue(g, "2027-11-02", null).reason, "expired");
  assert.equal(domainQueue(g, "2026-12-15", "2026-12-01").reason, null);
  assert.equal(domainQueue(g, "2026-12-31", "2026-12-01").reason, "reuse_ready");
  assert.equal(domainQueue(b, "2026-12-31", "2026-12-01").reason, null);
  assert.equal(readHeld([{ name: "paintersmax.app", boughtOn: "2026-01-01", expiresOn: "2027-01-01" }]).length, 0);
});

test("research: CSV import skips duplicates, suggests a door and exports safely", () => {
  assert.deepEqual(parseCsv('a,"b, c"\n"say ""hi""",d\n'), [["a", "b, c"], ['say "hi"', "d"]]);
  const existing = [readContact({ company: "Tyler Pro Painting", phone: "(903) 555-0100", city: "Tyler" })!];
  const r = contactsFromCsv("Company,Phone,City,Reviews,Website,Language\nTyler Pro Painting,903-555-0100,Tyler,4,,\nLongview Paint Co,903 555 0101,Longview,72,longviewpaint.com,Spanish\n,123,Nowhere,,,\nLongview Paint Co,903-555-0101,Longview,,,", existing);
  assert.equal(r.add.length, 1);
  assert.equal(r.skipped, 3);
  assert.equal(r.add[0].door, "grow");
  assert.equal(r.add[0].lang, "es");
  assert.equal(r.add[0].phone, "9035550101");
  assert.equal(suggestDoor("", 3), "launch");
  assert.equal(suggestDoor("", 200), "signature");
  const csv = contactsCsv([readContact({ company: "=HYPERLINK(1)", note: 'a "b"' })!]);
  assert.ok(csv.includes("'=HYPERLINK(1)"));
  assert.ok(csv.includes('"a ""b"""'));
});

test("envelopes: every tool belongs to one, caps are cleaned, model defaults to the platform", () => {
  for (const f of FEATURES) assert.ok(FEATURE_GROUP[f], f);
  const e = readEnvelopes({ enabled: true, caps: { website: "200", assistant: -1, estimates: "", automation: 50 }, textModel: "gpt" });
  assert.deepEqual(e.caps, { website: 200, automation: 50 });
  assert.equal(e.textModel, "default");
  assert.equal(readEnvelopes(null).enabled, false);
});

test("feedback threads are cleaned and need a message", () => {
  assert.equal(readThread({ id: "abc123", companyId: 3, messages: [] }), null);
  const t = readThread({ id: "abc123", companyId: 3, kind: "nope", status: "x", messages: [{ from: "client", text: " Broken " }, { from: "hacker", text: "x" }] })!;
  assert.equal(t.kind, "other");
  assert.equal(t.status, "new");
  assert.equal(t.messages.length, 1);
  assert.equal(t.messages[0].text, "Broken");
});

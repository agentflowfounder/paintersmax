import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTime, cleanWorker, estimatePayCents, hoursOf, list1099, renderProfile, rollups, weekStart } from "../src/crew.ts";

test("worker input", () => {
  assert.ok("error" in (cleanWorker({ name: " " }) as any));
  const w: any = cleanWorker({ name: " Luis ", kind: "contractor", payCents: 2500.4, payUnit: "day", startedOn: "2026-03-01", phone: "214" });
  assert.equal(w.name, "Luis");
  assert.equal(w.kind, "contractor");
  assert.equal(w.payCents, 2500);
  assert.equal(w.payUnit, "day");
  assert.equal((cleanWorker({ name: "A", payUnit: "week", startedOn: "soon" }) as any).payUnit, "hour");
  assert.equal((cleanWorker({ name: "A", startedOn: "soon" }) as any).startedOn, null);
});
test("time from clock in and out, with break", () => {
  const t: any = cleanTime({ workerId: 1, workDate: "2026-11-09", clockIn: "07:30", clockOut: "16:00", breakMinutes: 30 });
  assert.equal(t.minutes, 480);
  assert.equal(t.clockIn, "07:30");
  assert.ok("error" in (cleanTime({ workDate: "2026-11-09", clockIn: "16:00", clockOut: "07:30" }) as any));
  assert.equal((cleanTime({ workDate: "2026-11-09", hours: 6.5 }) as any).minutes, 390);
  assert.ok("error" in (cleanTime({ workDate: "2026-11-09", hours: 30 }) as any));
  assert.ok("error" in (cleanTime({ workDate: "bad", hours: 2 }) as any));
});
test("week starts on Monday", () => {
  assert.equal(weekStart("2026-11-09"), "2026-11-09"); // Monday
  assert.equal(weekStart("2026-11-15"), "2026-11-09"); // Sunday
  assert.equal(weekStart("2026-11-16"), "2026-11-16");
});
test("rollups per week, month, job", () => {
  const r = rollups([{ jobId: 1, workDate: "2026-11-09", minutes: 480 }, { jobId: 2, workDate: "2026-11-10", minutes: 240 }, { jobId: 1, workDate: "2026-12-01", minutes: 60 }, { jobId: null, workDate: "2026-12-01", minutes: 30 }]);
  assert.equal(r.totalHours, 13.5);
  assert.equal(r.byWeek["2026-11-09"], 12);
  assert.equal(r.byMonth["2026-12"], 1.5);
  assert.equal(r.byJob["1"], 9);
  assert.equal(r.byJob.none, 0.5);
  assert.equal(hoursOf(100), 1.67);
});
test("pay estimate by hour, day and job", () => {
  const e = [{ jobId: 1, workDate: "2026-11-09", minutes: 240 }, { jobId: 1, workDate: "2026-11-09", minutes: 240 }, { jobId: 2, workDate: "2026-11-10", minutes: 120 }];
  assert.equal(estimatePayCents("hour", 2000, e), 20000);
  assert.equal(estimatePayCents("day", 15000, e), 30000);
  assert.equal(estimatePayCents("job", 50000, e), 100000);
});
test("1099 list only has contractors at or over the threshold", () => {
  const ws = [{ id: 1, name: "Emp", kind: "employee", w9: false }, { id: 2, name: "Sub A", kind: "contractor", w9: true }, { id: 3, name: "Sub B", kind: "contractor", w9: false }];
  const l = list1099(ws, [{ workerId: 1, amountCents: 900000 }, { workerId: 2, amountCents: 150000 }, { workerId: 2, amountCents: 50000 }, { workerId: 3, amountCents: 199999 }], 200000);
  assert.deepEqual(l.map((x) => [x.name, x.crossed]), [["Sub A", true], ["Sub B", false]]);
  assert.equal(l[0].w9, true);
});
test("profile escapes text and has no tax id fields", () => {
  const h = renderProfile({ company: "Co", year: "2026", w: { name: "<b>Ana</b>", kind: "employee", payCents: 2000, payUnit: "hour", notes: "x" }, months: [["2026-11", 10]], jobs: [], payments: [], paidCents: 0, estimatedCents: 20000, hours: 10 });
  assert.ok(!h.includes("<b>Ana</b>"));
  assert.ok(h.includes("&lt;b&gt;Ana"));
  assert.ok(h.includes("$200.00"));
  assert.ok(!/SSN|social security number:/i.test(h.replace("No Social Security or tax ID number is stored here.", "")));
});

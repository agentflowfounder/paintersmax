import test from "node:test";
import assert from "node:assert/strict";
import { approvalKey, overtimeMinutes, overtimeWeeks, readApprovals, readRework, timesheetNudges, usesApprovals, weekStart } from "../src/timesheet.ts";
import { weekStart as crewWeekStart } from "../src/crew.ts";

// 2026-11-09 is a Monday. 2026-11-13 Friday, 14 Saturday, 15 Sunday, 16 Monday.
const W = [
  { id: 1, name: "Luis", kind: "employee", active: true },
  { id: 2, name: "Ana", kind: "contractor", active: true },
];
const day = (d: string, workerId: number, hours: number) => ({ workerId, workDate: d, minutes: Math.round(hours * 60) });

test("weekStart is shared with the crew page and starts on Monday", () => {
  assert.equal(weekStart("2026-11-15"), "2026-11-09");
  assert.equal(crewWeekStart("2026-11-16"), "2026-11-16");
});

test("overtime is only flagged for employees, and only over 40 hours", () => {
  assert.equal(overtimeMinutes(40 * 60, "employee"), 0);
  assert.equal(overtimeMinutes(44.5 * 60, "employee"), 270);
  assert.equal(overtimeMinutes(60 * 60, "contractor"), 0);
  const rows = [
    { workDate: "2026-11-09", minutes: 9 * 60 }, { workDate: "2026-11-10", minutes: 9 * 60 }, { workDate: "2026-11-11", minutes: 9 * 60 },
    { workDate: "2026-11-12", minutes: 9 * 60 }, { workDate: "2026-11-13", minutes: 9 * 60 }, // 45 hours
    { workDate: "2026-11-16", minutes: 8 * 60 }, // next week, fine
  ];
  assert.deepEqual(overtimeWeeks(rows, "employee"), [{ week: "2026-11-09", hours: 45, overHours: 5 }]);
  assert.deepEqual(overtimeWeeks(rows, "contractor"), []);
});

test("stored approvals and rework ids are cleaned, so a bad blob never breaks the page", () => {
  assert.deepEqual(readApprovals(null), {});
  assert.deepEqual(readApprovals({ "1:2026-11-09": { on: "2026-11-16", minutes: 2400 }, junk: { on: "x", minutes: 1 }, "2:2026-11-09": { on: "bad", minutes: 5 } }), { "1:2026-11-09": { on: "2026-11-16", minutes: 2400 } });
  assert.deepEqual(readRework({ ids: [3, "4", 3, -1, "x", 0] }), [3, 4]);
  assert.deepEqual(readRework(undefined), []);
  assert.equal(usesApprovals({}), false);
  assert.equal(usesApprovals({ [approvalKey(1, "2026-11-09")]: { on: "2026-11-16", minutes: 60 } }), true);
});

test("Home reminder: an employee over 40 hours this week", () => {
  // Mon 9 .. Fri 13 at 9 hours each = 45 hours
  const real = ["09", "10", "11", "12", "13"].map((d) => day(`2026-11-${d}`, 1, 9));
  const out = timesheetNudges({ today: "2026-11-13", workers: W, rows: real, approvals: {} });
  assert.equal(out.length, 1);
  assert.match(out[0], /^Luis has 45 hours this week\. Employees over 40 hours in a week may be owed overtime, so tell your accountant\.$/);
  // The contractor is never flagged, even at 60 hours.
  const c = ["09", "10", "11", "12", "13"].map((d) => day(`2026-11-${d}`, 2, 12));
  assert.deepEqual(timesheetNudges({ today: "2026-11-13", workers: W, rows: c, approvals: {} }), []);
});

test("Home reminder: last week's overtime is hidden once that week is approved", () => {
  const rows = ["09", "10", "11", "12", "13"].map((d) => day(`2026-11-${d}`, 1, 9));
  const nudge = (approvals: any) => timesheetNudges({ today: "2026-11-17", workers: W, rows, approvals });
  assert.match(nudge({})[0], /Luis had 45 hours last week/);
  assert.equal(nudge({ [approvalKey(1, "2026-11-09")]: { on: "2026-11-16", minutes: 2700 } }).filter((t) => /overtime/.test(t)).length, 0);
});

test("Home reminder: an empty time sheet only Friday through Monday, and only if the company uses time sheets", () => {
  // Hours were recorded two weeks ago, none this week.
  const past = [day("2026-11-02", 1, 8)];
  const n = (today: string, rows = past) => timesheetNudges({ today, workers: W, rows, approvals: {} });
  assert.equal(n("2026-11-11").length, 0); // Wednesday: too early to nag
  assert.equal(n("2026-11-12").length, 0); // Thursday
  assert.match(n("2026-11-13")[0], /^Nothing is on the time sheet for this week yet\./); // Friday
  assert.equal(n("2026-11-14").length, 1); // Saturday
  assert.equal(n("2026-11-15").length, 1); // Sunday
  assert.match(n("2026-11-16")[0], /for last week yet/); // Monday looks back at the week that ended
  assert.equal(n("2026-11-13", []).length, 0); // never used time sheets: stay quiet
  assert.equal(n("2026-11-13", [...past, day("2026-11-10", 1, 8)]).length, 0); // this week has hours
  assert.equal(timesheetNudges({ today: "2026-11-13", workers: [{ ...W[0], active: false }], rows: past, approvals: {} }).length, 0); // nobody active
});

test("Home reminder: waiting for approval only shows for companies that approve weeks", () => {
  const rows = [day("2026-11-02", 1, 8), day("2026-11-03", 2, 8), day("2026-11-10", 1, 8), day("2026-11-11", 2, 8)];
  const none = timesheetNudges({ today: "2026-11-17", workers: W, rows, approvals: {} });
  assert.equal(none.filter((t) => /approval/.test(t)).length, 0); // the company never approves: no nag
  const oneDone = { [approvalKey(1, "2026-11-02")]: { on: "2026-11-09", minutes: 480 }, [approvalKey(1, "2026-11-09")]: { on: "2026-11-16", minutes: 480 } };
  const out = timesheetNudges({ today: "2026-11-17", workers: W, rows, approvals: oneDone }).filter((t) => /approval/.test(t));
  assert.deepEqual(out, ["Time sheets waiting for your approval: Ana."]);
  const all = { ...oneDone, [approvalKey(2, "2026-11-02")]: { on: "2026-11-09", minutes: 480 }, [approvalKey(2, "2026-11-09")]: { on: "2026-11-16", minutes: 480 } };
  assert.equal(timesheetNudges({ today: "2026-11-17", workers: W, rows, approvals: all }).filter((t) => /approval/.test(t)).length, 0);
  // This week is not finished, so it is never "waiting".
  const thisWeek = [day("2026-11-17", 1, 8)];
  assert.equal(timesheetNudges({ today: "2026-11-18", workers: W, rows: thisWeek, approvals: oneDone }).filter((t) => /approval/.test(t)).length, 0);
});

test("a long list of names is shortened", () => {
  const ws = ["A", "B", "C", "D", "E"].map((name, i) => ({ id: i + 1, name, kind: "employee", active: true }));
  const rows = ws.map((w) => day("2026-11-10", w.id, 8));
  const ap = { [approvalKey(99, "2026-11-02")]: { on: "2026-11-09", minutes: 60 } };
  const out = timesheetNudges({ today: "2026-11-17", workers: ws, rows, approvals: ap }).filter((t) => /approval/.test(t));
  assert.deepEqual(out, ["Time sheets waiting for your approval: A, B, C and 2 more."]);
});

import { addDaysIso } from "./dates.ts";

/**
 * Time sheet extras: an overtime flag, week approval, a "callback or rework" tick, and the Home reminders for them.
 * All plain math on the hours the painter already records. Nothing is sent to anyone, and nothing here is payroll or tax advice:
 * it is a records aid ("tell your accountant").
 */

/** Monday of the week that holds this date (YYYY-MM-DD). */
export function weekStart(d: string): string {
  const t = new Date(d + "T00:00:00Z");
  const back = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
}

/** Employees can be owed overtime after 40 hours in a week. Contractors set their own hours, so no flag for them. */
export const OVERTIME_AFTER_MINUTES = 40 * 60;

export function overtimeMinutes(totalMinutes: number, kind: string): number {
  return kind === "employee" ? Math.max(0, totalMinutes - OVERTIME_AFTER_MINUTES) : 0;
}

export interface TimeRow {
  workDate: string;
  minutes: number;
}
/** Weeks (Monday dates, oldest first) in which an employee passed 40 hours, with the hours over. */
export function overtimeWeeks(rows: TimeRow[], kind: string): { week: string; hours: number; overHours: number }[] {
  if (kind !== "employee") return [];
  const by: Record<string, number> = {};
  for (const r of rows) by[weekStart(r.workDate)] = (by[weekStart(r.workDate)] ?? 0) + r.minutes;
  return Object.entries(by)
    .filter(([, m]) => m > OVERTIME_AFTER_MINUTES)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, m]) => ({ week, hours: Math.round((m / 60) * 100) / 100, overHours: Math.round(((m - OVERTIME_AFTER_MINUTES) / 60) * 100) / 100 }));
}

// ---- Approvals: one entry per worker and week. Once approved, the hours in that week are locked until it is unapproved. ----
export interface Approval {
  on: string; // YYYY-MM-DD the owner approved
  minutes: number; // total minutes at the time
}
export type ApprovalBlob = Record<string, Approval>;
export const approvalKey = (workerId: number, week: string) => `${workerId}:${week}`;
export const timeApprKey = (c: number) => `timeappr:${c}`;
export const reworkKey = (c: number) => `timerw:${c}`;
export const MAX_APPROVALS = 6000;
export const MAX_REWORK = 5000;
export const usesApprovals = (a: ApprovalBlob) => Object.keys(a).length > 0;

/** Clean the stored approvals so a bad blob never breaks the page. */
export function readApprovals(raw: unknown): ApprovalBlob {
  const out: ApprovalBlob = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (/^\d+:\d{4}-\d{2}-\d{2}$/.test(k) && v && /^\d{4}-\d{2}-\d{2}$/.test(String(v.on)) && Number.isFinite(Number(v.minutes))) out[k] = { on: String(v.on), minutes: Math.max(0, Math.round(Number(v.minutes))) };
  }
  return out;
}
export function readRework(raw: unknown): number[] {
  const ids = Array.isArray((raw as any)?.ids) ? (raw as any).ids : [];
  return [...new Set(ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))] as number[];
}

// ---- Home reminders ----
export interface NudgeWorker {
  id: number;
  name: string;
  kind: string;
  active: boolean;
}
export interface NudgeRow extends TimeRow {
  workerId: number;
}
const names = (list: string[]) => (list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} and ${list.length - 3} more`);
const hrs = (m: number) => `${Math.round((m / 60) * 10) / 10}`;

/**
 * Plain sentences for the Home screen. Three kinds, each kept quiet unless it applies:
 *  - an employee is over 40 hours this week or last week (and last week is not approved yet)
 *  - on Friday through Monday, nothing is on the time sheet for the week, but the company has been using time sheets
 *  - the company uses approvals and a finished week still waits for approval
 */
export function timesheetNudges(o: { today: string; workers: NudgeWorker[]; rows: NudgeRow[]; approvals: ApprovalBlob }): string[] {
  const out: string[] = [];
  const active = o.workers.filter((w) => w.active);
  if (!active.length) return out;
  const thisWk = weekStart(o.today);
  const lastWk = addDaysIso(thisWk, -7);
  const mins = new Map<string, number>();
  const weeksWithAny = new Set<string>();
  for (const r of o.rows) {
    const wk = weekStart(r.workDate);
    mins.set(approvalKey(r.workerId, wk), (mins.get(approvalKey(r.workerId, wk)) ?? 0) + r.minutes);
    weeksWithAny.add(wk);
  }
  const approved = (wid: number, wk: string) => !!o.approvals[approvalKey(wid, wk)];

  // 1. Overtime
  const over: string[] = [];
  for (const w of active.filter((x) => x.kind === "employee")) {
    const cur = mins.get(approvalKey(w.id, thisWk)) ?? 0;
    const prev = mins.get(approvalKey(w.id, lastWk)) ?? 0;
    if (cur > OVERTIME_AFTER_MINUTES) over.push(`${w.name} has ${hrs(cur)} hours this week`);
    else if (prev > OVERTIME_AFTER_MINUTES && !approved(w.id, lastWk)) over.push(`${w.name} had ${hrs(prev)} hours last week`);
  }
  if (over.length) out.push(`${over.join(". ")}. Employees over 40 hours in a week may be owed overtime, so tell your accountant.`);

  // 2. An empty time sheet, Friday through Monday, but only for companies that have been using it
  const dow = new Date(o.today + "T00:00:00Z").getUTCDay(); // 0 Sunday .. 6 Saturday
  if (dow === 5 || dow === 6 || dow === 0 || dow === 1) {
    const target = dow === 1 ? lastWk : thisWk;
    let usedBefore = false;
    for (let i = 1; i <= 6 && !usedBefore; i++) if (weeksWithAny.has(addDaysIso(target, -7 * i))) usedBefore = true;
    if (usedBefore && !weeksWithAny.has(target)) out.push(`Nothing is on the time sheet for ${dow === 1 ? "last week" : "this week"} yet. Add the hours so crew pay and job costs stay right.`);
  }

  // 3. Finished weeks waiting for approval (only if the company approves weeks at all)
  if (usesApprovals(o.approvals)) {
    const waiting: string[] = [];
    for (const w of active) {
      for (let i = 1; i <= 3; i++) {
        const wk = addDaysIso(thisWk, -7 * i);
        if ((mins.get(approvalKey(w.id, wk)) ?? 0) > 0 && !approved(w.id, wk)) {
          waiting.push(w.name);
          break;
        }
      }
    }
    if (waiting.length) out.push(`Time sheets waiting for your approval: ${names(waiting)}.`);
  }
  return out;
}

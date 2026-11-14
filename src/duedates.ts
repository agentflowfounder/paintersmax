import { addDaysIso, daysBetween, friendlyDate, isIsoDate, localDateOf } from "./dates.ts";

/**
 * Suggested due dates. Every open job gets at most one "next step" with a date, worked out in code from where the job is, so Home can
 * say "Follow up Thursday". They are suggestions only: nothing is emailed or put on a calendar, and no date is saved.
 */

export interface DueFacts {
  stage: string;
  createdAt: string; // database timestamps
  updatedAt: string;
  estStatus?: string | null;
  estUpdatedAt?: string | null;
  signedAt?: string | null;
  invStatus?: string | null;
  invUpdatedAt?: string | null;
  scheduleStart?: string | null; // YYYY-MM-DD
  scheduleEnd?: string | null;
  visitDate?: string | null; // only a visit that is still booked
}
export interface Due {
  step: string;
  due: string; // YYYY-MM-DD
}

/** The next step for a job and the day it is due, or null when there is nothing to suggest. */
export function nextDue(f: DueFacts): Due | null {
  const d = pick(f);
  return d && isIsoDate(d.due) ? d : null;
}

function pick(f: DueFacts): Due | null {
  // A day after a timestamp; "" when neither timestamp can be read, which nextDue turns into "nothing to suggest".
  const after = (ts: string | null | undefined, fallback: string, days: number): string => {
    const base = localDateOf(ts) || localDateOf(fallback);
    return base ? addDaysIso(base, days) : "";
  };
  switch (f.stage) {
    case "lead":
      if (f.visitDate && isIsoDate(f.visitDate)) return { step: "Site visit", due: f.visitDate };
      if (f.estStatus) return { step: "Finish and send the estimate", due: after(f.estUpdatedAt, f.updatedAt, 2) };
      return { step: "Reply to the new lead", due: after(f.createdAt, f.createdAt, 1) };
    case "bid":
      if (f.estStatus === "sent") return { step: "Follow up on the estimate", due: after(f.estUpdatedAt, f.updatedAt, 3) };
      if (f.estStatus === "signed") return { step: "Build and send the contract", due: after(f.signedAt || f.estUpdatedAt, f.updatedAt, 1) };
      return { step: "Send the estimate", due: after(f.estUpdatedAt, f.updatedAt, 2) };
    case "contract":
      return { step: "Put the job on the calendar", due: after(f.signedAt, f.updatedAt, 2) };
    case "scheduled":
      if (f.scheduleStart && isIsoDate(f.scheduleStart)) return { step: "Start the job", due: f.scheduleStart };
      return { step: "Put the job on the calendar", due: after(f.updatedAt, f.updatedAt, 2) };
    case "in_progress":
      if (f.scheduleEnd && isIsoDate(f.scheduleEnd)) return { step: "Finish the work", due: f.scheduleEnd };
      return null;
    case "punch":
      return { step: "Build and send the invoice", due: after(f.updatedAt, f.updatedAt, 1) };
    case "invoiced":
      if (f.invStatus === "paid") return null;
      if (f.invStatus === "sent") return { step: "Follow up on payment", due: after(f.invUpdatedAt, f.updatedAt, 7) };
      return { step: "Send the invoice", due: after(f.invUpdatedAt, f.updatedAt, 1) };
    default:
      return null;
  }
}

/** "today", "tomorrow", "Thursday" (within the week) or "Tue, Nov 24"; late ones say how long ago. */
export function dueWords(due: string, today: string): { when: string; late: boolean } {
  const d = daysBetween(today, due);
  if (d < 0) return { when: d === -1 ? "was due yesterday" : `was due ${friendlyDate(due)}`, late: true };
  if (d === 0) return { when: "today", late: false };
  if (d === 1) return { when: "tomorrow", late: false };
  if (d < 7) return { when: new Date(`${due}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }), late: false };
  return { when: friendlyDate(due), late: false };
}

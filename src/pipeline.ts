/**
 * The Jobs pipeline the painter sees on the phone: New Bids > Estimates > Jobs > Jobs Completed > Invoice > Paid > Warranty (and Lost).
 * Worked out in code from the stage that is already stored, so no database change is needed.
 */

export const BUCKETS = ["new", "estimates", "jobs", "completed", "invoice", "paid", "warranty", "lost", "archived"] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface BucketFacts {
  stage: string;
  /** The customer accepted the finished work on their portal. */
  accepted?: boolean;
  /** Last day of the labor warranty (YYYY-MM-DD), when a certificate exists. */
  warrantyEnd?: string | null;
  /** Today as YYYY-MM-DD (US time). */
  today: string;
  /** The painter archived the job: it leaves every other list until restored. */
  archived?: boolean;
}

export function bucketFor(f: BucketFacts): Bucket {
  if (f.archived) return "archived";
  switch (f.stage) {
    case "lead":
      return "new";
    case "bid":
      return "estimates";
    case "contract":
    case "scheduled":
    case "in_progress":
      return f.accepted ? "completed" : "jobs";
    case "punch":
      return "completed";
    case "invoiced":
      return "invoice";
    case "closed":
      return f.warrantyEnd && /^\d{4}-\d{2}-\d{2}$/.test(f.warrantyEnd) && f.warrantyEnd >= f.today ? "warranty" : "paid";
    case "lost":
      return "lost";
    default:
      return "new";
  }
}

/**
 * QuickBooks import files, built to Intuit's published formats. Records for your accountant, not tax advice.
 *
 * QuickBooks Online: a 3-column CSV (Date, Description, Amount) for Banking > Upload transactions. Payments are negative.
 *   Intuit asks for one date format, no zero amounts, and no weekday text in the Date column.
 *   (https://quickbooks.intuit.com/learn-support/en-us/banking/import-bank-transactions-using-excel-csv-files/00/261910)
 * QuickBooks Desktop: an IIF file. Tab-separated, header rows start with "!", each transaction is one TRNS line, one or more
 *   SPL lines that add up to the opposite of the TRNS amount, and an ENDTRNS line. Dates are M/D/YYYY.
 *   (https://quickbooks.intuit.com/learn-support/en-us/manage-lists/iif-overview-import-kit-sample-files-and-headers/00/201577)
 */
import { toCsv } from "./records.ts";

export interface QbExpense {
  spentOn: string; // YYYY-MM-DD
  vendor: string;
  category: string;
  amountCents: number;
  jobTitle: string | null;
  note: string;
}

const mdy = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${m}/${day}/${y}`;
};
const usDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
};
const dollars = (c: number) => (c / 100).toFixed(2);

/** Text that is safe in an IIF cell: no tabs, line breaks or quotes, and no colon (QuickBooks reads a colon as a sub-account). */
export function iifText(v: string, max: number): string {
  return String(v ?? "").replace(/[\t\r\n"]+/g, " ").replace(/:/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Description for the bank-upload CSV: vendor, category and job. Keeps digits out where it can, as Intuit advises. */
export function qboDescription(e: QbExpense): string {
  return [e.vendor || "Expense", e.category, e.jobTitle ? `Job: ${e.jobTitle}` : ""].filter(Boolean).join(" | ").replace(/\s+/g, " ").slice(0, 90);
}

export function qboCsv(expenses: QbExpense[]): string {
  const rows = expenses.filter((e) => e.amountCents > 0).map((e) => [usDate(e.spentOn), qboDescription(e), `-${dollars(e.amountCents)}`]);
  return toCsv([["Date", "Description", "Amount"], ...rows]);
}

export interface IifOptions {
  /** The bank or credit card account in QuickBooks that paid for these. It must already exist. */
  payAccount: string;
  payType: "check" | "card";
  /** Optional category -> QuickBooks expense account name. Missing categories use their own name. */
  accountMap?: Record<string, string>;
}

export function iifFile(expenses: QbExpense[], o: IifOptions): string {
  const pay = iifText(o.payAccount, 60) || (o.payType === "card" ? "Credit Card" : "Checking");
  const type = o.payType === "card" ? "CREDIT CARD" : "CHECK";
  const head = ["!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO", "!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO", "!ENDTRNS"];
  const out: string[] = [...head];
  for (const e of expenses) {
    if (e.amountCents <= 0) continue;
    const exp = iifText(o.accountMap?.[e.category] ?? e.category, 60) || "Ask My Accountant";
    const name = iifText(e.vendor, 41);
    const memo = iifText([e.jobTitle ? `Job: ${e.jobTitle}` : "", e.note].filter(Boolean).join(" - "), 100);
    const d = mdy(e.spentOn);
    out.push(`TRNS\t\t${type}\t${d}\t${pay}\t${name}\t-${dollars(e.amountCents)}\t\t${memo}`);
    out.push(`SPL\t\t${type}\t${d}\t${exp}\t${name}\t${dollars(e.amountCents)}\t\t${memo}`);
    out.push("ENDTRNS");
  }
  return out.join("\r\n") + "\r\n";
}

/** The expense accounts an IIF file refers to, so the painter can create them first. */
export function iifAccounts(expenses: QbExpense[], accountMap?: Record<string, string>): string[] {
  return Array.from(new Set(expenses.filter((e) => e.amountCents > 0).map((e) => iifText(accountMap?.[e.category] ?? e.category, 60)))).filter(Boolean).sort();
}

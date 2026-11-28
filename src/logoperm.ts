import { STORES } from "./storebadges.ts";

/**
 * Store logo permissions (Rogelio, 2026-11-28). Until a store gives us written permission, PaintersMax shows that store
 * with our own badge, never its logo. This keeps the request letter and a simple record of who we asked, when, and what they said.
 * Stored as one JSON setting (no database change). Never put passwords, keys or account numbers in the note.
 */
export const LOGOPERM_KEY = "logoperm";
export const PERM_STATUSES = ["not_asked", "sent", "approved", "declined"] as const;
export type PermStatus = (typeof PERM_STATUSES)[number];
export interface PermEntry { status: PermStatus; sentOn: string; note: string }
export type PermBook = Record<string, PermEntry>;

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanEntry(raw: unknown): PermEntry {
  const r = raw as any;
  return { status: (PERM_STATUSES as readonly string[]).includes(r?.status) ? r.status : "not_asked", sentOn: DATE.test(s(r?.sentOn, 10)) ? s(r.sentOn, 10) : "", note: s(r?.note, 500) };
}
export function readPermBook(raw: unknown): PermBook {
  const out: PermBook = {};
  for (const st of STORES) out[st.slug] = cleanEntry((raw as any)?.[st.slug]);
  return out;
}

/** Plain request letter. A draft for the owner (and an attorney, when one is hired) to review before anything is sent. Not legal advice. */
export const LETTER_TEMPLATE = `Subject: Request for permission to show the {{STORE}} logo on painter websites

Hello {{STORE}} Marketing Team,

My name is [Your name], and I run PaintersMax (paintersmax.app), a business app and website builder for small painting companies.

Many of our painters buy their paint from {{STORE}}. We would like to show your company's name and logo on their PaintersMax websites and in the app, in a small "Where we buy our paint" section, so homeowners can see the brands these painters trust.

Right now we show {{STORE}} only as plain text in our own design, and we do not use your logo. We will not use it unless you tell us in writing that we may.

Could you please let us know, in writing:
1. Whether we may use the {{STORE}} logo in this way.
2. Which logo files you would like us to use, and where to download them.
3. Any brand guidelines, size or spacing rules, and wording you require.
4. Anything we must not do, and who we should contact with questions.

We will follow whatever you tell us, and we will remove the logo promptly if you ask. We are not asking for any sponsorship, partnership or endorsement.

Thank you for your time.

[Your name]
PaintersMax
[Phone]
[Email]
[Mailing address]

(Draft for review before sending. Not legal advice.)`;

export const letterFor = (storeName: string) => LETTER_TEMPLATE.replace(/\{\{STORE\}\}/g, storeName);

export const permView = (book: PermBook) => ({
  stores: STORES.map((st) => ({ slug: st.slug, name: st.name, ...book[st.slug] })),
  statuses: PERM_STATUSES,
  letter: LETTER_TEMPLATE,
});

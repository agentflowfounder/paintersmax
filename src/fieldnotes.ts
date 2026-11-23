/**
 * Field notes: short notes a painter types or speaks at the site. Each one is sorted into a group in code (free, instant, works the
 * same every time), so the project summary can show prep, customer wishes and site limits apart. Stored in jobs.data.fieldNotes.
 */

export const NOTE_TAGS = ["prep", "wishes", "site", "safety", "call", "general"] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

export interface FieldNote {
  id: string;
  at: string; // ISO time it was written (on the phone, so offline notes keep their own time)
  text: string;
  tag: NoteTag;
}

export const MAX_NOTES = 200;
export const MAX_NOTE_LEN = 2000;

// English and Spanish words that point to each group. Checked in this order, so "safety" wins over "site" for "ladder on a steep roof".
const WORDS: [NoteTag, RegExp][] = [
  ["safety", /\b(lead paint|pre-?1978|asbestos|ladder|scaffold|harness|fall|respirator|mask|ventilat\w*|fumes?|mold|mould|electrical|wires?|wasp|bees?|dog|escalera|andamio|arn[eé]s|plomo|moho|avispas?|perro|seguridad)\b/i],
  ["call", /\b(called|call back|voicemail|left a message|texted|spoke with|talked to|llam[eé]|le llam[eé]|mensaje de voz|habl[eé] con)\b/i],
  ["prep", /\b(prep|primer|prime|sand\w*|scrape|scraping|patch\w*|caulk\w*|crack\w*|peel\w*|stain(s|ed)?|water damage|drywall|holes?|nail pops?|power ?wash\w*|pressure ?wash\w*|mildew|rot\w*|repair\w*|lijar|raspar|resanar|masilla|grietas?|pelad\w*|manchas?|humedad|imprimaci[oó]n|sellador|reparar|reparaci[oó]n|podrid\w*)\b/i],
  ["wishes", /\b(wants?|would like|prefers?|likes?|asked for|asks for|customer (wants|asked)|colou?rs?|sheen|finish|eggshell|satin|semi-?gloss|flat|matte|accent|budget|before (thanksgiving|christmas|the holidays)|deadline|quiere|prefiere|le gusta|pidi[oó]|colores?|brillo|acabado|presupuesto)\b/i],
  ["site", /\b(furniture|move|parking|gate|access|stairs?|high ceilings?|vaulted|two-?story|2-?story|second floor|pets?|kids|children|occupied|hours|hoa|neighbors?|tight|narrow|landscap\w*|plants?|bushes|muebles|estacionamiento|port[oó]n|acceso|escaleras|techo alto|segundo piso|mascotas|ni[nñ]os|vecinos|plantas)\b/i],
];

/** Picks the group for a note from its words. "general" when nothing matches. */
export function tagNote(text: string): NoteTag {
  for (const [tag, re] of WORDS) if (re.test(text)) return tag;
  return "general";
}

const isTag = (v: unknown): v is NoteTag => typeof v === "string" && (NOTE_TAGS as readonly string[]).includes(v);

/** Cleans one note from the browser. A missing or unknown tag is worked out from the words. */
export function cleanNote(i: any, nowIso: string): FieldNote | null {
  const text = typeof i?.text === "string" ? i.text.replace(/\s+\n/g, "\n").trim().slice(0, MAX_NOTE_LEN) : "";
  if (!text) return null;
  const id = typeof i?.id === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(i.id) ? i.id : `n${Date.parse(nowIso).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const at = typeof i?.at === "string" && !Number.isNaN(Date.parse(i.at)) && Date.parse(i.at) <= Date.parse(nowIso) + 5 * 60_000 ? new Date(i.at).toISOString() : nowIso;
  return { id, at, text, tag: isTag(i?.tag) ? i.tag : tagNote(text) };
}

/** Reads the stored list, dropping anything broken. */
export function readNotes(raw: unknown): FieldNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n) => n && typeof n.text === "string" && typeof n.id === "string" && isTag(n.tag) && typeof n.at === "string").slice(-MAX_NOTES);
}

/** Adds a note, keeping the list in time order. A note with an id that is already there is not added twice (offline retries). */
export function addNote(list: FieldNote[], n: FieldNote): FieldNote[] {
  if (list.some((x) => x.id === n.id)) return list;
  return [...list, n].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_NOTES);
}

/** Notes as plain text for the AI estimate helper, grouped, newest last. */
export function notesForPrompt(list: FieldNote[]): string {
  const name: Record<NoteTag, string> = { prep: "Surface prep", wishes: "Customer wishes", site: "Site limits", safety: "Safety", call: "Calls", general: "Other notes" };
  return NOTE_TAGS.map((t) => {
    const g = list.filter((n) => n.tag === t);
    return g.length ? `${name[t]}:\n${g.map((n) => `- ${n.text.slice(0, 400)}`).join("\n")}` : "";
  })
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

/** Colors chosen with the customer. Our own words only: the painter types the brand and code. */
export interface ColorPick {
  where: string;
  brand: string;
  code: string;
  name: string;
  hex: string;
}
export function cleanColors(raw: unknown): ColorPick[] {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 30)
    .map((c: any) => ({ where: s(c?.where, 80), brand: s(c?.brand, 40), code: s(c?.code, 30), name: s(c?.name, 60), hex: /^#[0-9a-fA-F]{6}$/.test(s(c?.hex, 7)) ? s(c?.hex, 7) : "" }))
    .filter((c) => c.where || c.code || c.name);
}

/** A customer's request from the quote form or the New bid form. */
export interface BidRequest {
  description: string;
  preferredDate: string; // YYYY-MM-DD or ""
  preferredTime: string; // "morning" | "afternoon" | "evening" | "" or HH:MM
  source: string;
}
export function cleanRequest(raw: any, source = ""): BidRequest {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const d = s(raw?.preferredDate, 10);
  const t = s(raw?.preferredTime, 20).toLowerCase();
  return {
    description: s(raw?.description ?? raw?.details, 2000),
    preferredDate: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "",
    preferredTime: ["morning", "afternoon", "evening"].includes(t) || /^\d{2}:\d{2}$/.test(t) ? t : "",
    source: s(raw?.source, 40) || source,
  };
}

/** A follow-up the painter set after sending a bid ("Customer wants to think" or "Follow up on a date"). */
export interface FollowUp {
  due: string; // YYYY-MM-DD
  reason: "thinking" | "date";
  setOn: string; // YYYY-MM-DD
  sentAt?: string;
}

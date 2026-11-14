/**
 * Small date helpers. Dates are stored as YYYY-MM-DD text and shown with a friendly format.
 * There is no per-company time zone yet, so "today" is the US date six hours behind UTC. That keeps "today" right from
 * Eastern to Pacific time for the whole working day; it can be one hour early late at night on the West Coast.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const todayLocal = (now: number = Date.now()) => new Date(now - 6 * 3600 * 1000).toISOString().slice(0, 10);

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Mon, Nov 17" or "lun, 17 nov." for a stored date. Falls back to the text as given. */
export function friendlyDate(iso: string, lang: "en" | "es" = "en"): string {
  if (!isIsoDate(iso)) return String(iso ?? "");
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "10:00 AM" for a stored HH:MM. */
export function friendlyTime(hhmm: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

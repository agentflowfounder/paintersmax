/**
 * PainterSelect directory (painterselect.com): the rules, with no database or network code so they are easy to test.
 *
 * Open listings, exclusive benefits:
 * - Every painting company we know of gets a basic listing (name, city, phone, website). No lead form, and a line
 *   that says the painter has not claimed it, plus a Claim button that opens a free PaintersMax account.
 * - Members (any paid door) get the benefits: profile with photos, the instant quote, insurance and Founding badges,
 *   a spot at the top of the city, and the leads from the city page sent to them first.
 */

export const DIR_HOST = "painterselect.com";
export const isDirHost = (h: string) => h === DIR_HOST || h === `www.${DIR_HOST}`;

/** The first market: North and East Texas. Members' own cities are added to this list automatically. */
export const SEED_CITIES: [string, string][] = [
  ["Dallas", "TX"], ["Fort Worth", "TX"], ["Plano", "TX"], ["Frisco", "TX"], ["McKinney", "TX"], ["Allen", "TX"], ["Garland", "TX"], ["Mesquite", "TX"],
  ["Richardson", "TX"], ["Irving", "TX"], ["Arlington", "TX"], ["Denton", "TX"], ["Lewisville", "TX"], ["Carrollton", "TX"], ["Rockwall", "TX"], ["Rowlett", "TX"],
  ["Wylie", "TX"], ["Forney", "TX"], ["Terrell", "TX"], ["Waxahachie", "TX"], ["Sherman", "TX"], ["Denison", "TX"], ["Greenville", "TX"], ["Paris", "TX"],
  ["Sulphur Springs", "TX"], ["Mount Pleasant", "TX"], ["Texarkana", "TX"], ["Tyler", "TX"], ["Longview", "TX"], ["Marshall", "TX"], ["Kilgore", "TX"],
  ["Henderson", "TX"], ["Jacksonville", "TX"], ["Athens", "TX"], ["Palestine", "TX"], ["Corsicana", "TX"], ["Canton", "TX"], ["Mineola", "TX"],
  ["Gilmer", "TX"], ["Nacogdoches", "TX"], ["Lufkin", "TX"],
];

export const DIR_SERVICES = ["interior", "exterior", "cabinets", "commercial"] as const;
export type DirService = (typeof DIR_SERVICES)[number];
export const isDirService = (v: unknown): v is DirService => typeof v === "string" && (DIR_SERVICES as readonly string[]).includes(v);

const slug = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Same shapes as cities.ts: key "tx-tyler", address part "tyler-tx". */
export const dirCityKey = (name: string, state: string) => `${state.toLowerCase()}-${slug(name)}`;
export const dirCitySlug = (name: string, state: string) => `${slug(name)}-${state.toLowerCase()}`;
/** "tyler-tx" -> "tx-tyler". Null for anything that is not a city address. */
export function keyFromCitySlug(s: string): string | null {
  const m = s.match(/^([a-z0-9-]{2,60})-([a-z]{2})$/);
  return m ? `${m[2]}-${m[1]}` : null;
}

export interface Listing {
  id: string;
  name: string;
  city: string;
  state: string;
  cityKey: string;
  phone: string;
  website: string;
  services: DirService[];
  source: string;
  addedAt: string;
  claim?: { companyId: number; email: string; status: "pending" | "approved" | "rejected"; at: string };
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Keeps only valid values. Public business data only: name, city, phone, website. */
export function cleanListing(input: any, now = new Date().toISOString()): Listing | null {
  const name = str(input?.name, 100);
  const city = str(input?.city, 60);
  const state = str(input?.state, 2).toUpperCase();
  if (name.length < 2 || city.length < 2 || !/^[A-Z]{2}$/.test(state)) return null;
  let website = str(input?.website, 200);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && !/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"'<>]*)?$/i.test(website)) website = "";
  const phone = str(input?.phone, 30).replace(/[^0-9+()\-. ]/g, "");
  const services = (Array.isArray(input?.services) ? input.services : []).filter(isDirService);
  const out: Listing = {
    id: typeof input?.id === "string" && /^[a-f0-9]{10}$/.test(input.id) ? input.id : crypto.randomUUID().replace(/-/g, "").slice(0, 10),
    name, city, state, cityKey: dirCityKey(city, state), phone, website, services: Array.from(new Set(services)) as DirService[],
    source: str(input?.source, 60) || "admin", addedAt: str(input?.addedAt, 30) || now,
  };
  const c = input?.claim;
  if (c && Number.isInteger(c.companyId) && ["pending", "approved", "rejected"].includes(c.status)) out.claim = { companyId: c.companyId, email: str(c.email, 200), status: c.status, at: str(c.at, 30) };
  return out;
}

/** One listing per line: name, city, state, phone, website. A header line or blank lines are skipped. */
export function parseImport(text: string, source = "import"): { listings: Listing[]; skipped: number } {
  const listings: Listing[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/).slice(0, 2000)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.includes("\t") ? line.split("\t") : splitCsv(line);
    if (/^name$/i.test(cells[0]?.trim() ?? "")) continue;
    const l = cleanListing({ name: cells[0], city: cells[1], state: cells[2], phone: cells[3], website: cells[4], source });
    if (l) listings.push(l);
    else skipped++;
  }
  return { listings, skipped };
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Same business twice: same city and the same phone digits, or the same name. */
export function isDuplicate(a: Pick<Listing, "cityKey" | "phone" | "name">, b: Pick<Listing, "cityKey" | "phone" | "name">): boolean {
  if (a.cityKey !== b.cityKey) return false;
  const d = (p: string) => p.replace(/\D/g, "").slice(-10);
  if (d(a.phone).length === 10 && d(a.phone) === d(b.phone)) return true;
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(llc|inc|co|company|painting|painters?)$/g, "");
  return n(a.name) === n(b.name);
}

export interface MemberSettings { optOut?: boolean; founding?: boolean; cap?: number }
export const DEFAULT_DAILY_CAP = 5;

export function readMember(raw: unknown): MemberSettings {
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    const out: MemberSettings = {};
    if (j?.optOut === true) out.optOut = true;
    if (j?.founding === true) out.founding = true;
    const c = Number(j?.cap);
    if (Number.isInteger(c) && c >= 0 && c <= 100) out.cap = c;
    return out;
  } catch {
    return {};
  }
}

export interface RouteState { day: string; count: number; last: string }

/**
 * Picks the member who gets a lead: members who cover the city (and the service, when one is asked), under their
 * daily cap, fewest leads today first, then whoever waited longest. Null sends the lead to the market pool.
 * Response speed and rating join the order once reviews are connected.
 */
export function pickMember<T extends { id: number; cap?: number }>(members: T[], state: Map<number, RouteState>, today: string): T | null {
  const open = members.filter((m) => {
    const s = state.get(m.id);
    const used = s && s.day === today ? s.count : 0;
    return used < (m.cap ?? DEFAULT_DAILY_CAP);
  });
  if (!open.length) return null;
  open.sort((a, b) => {
    const sa = state.get(a.id), sb = state.get(b.id);
    const ca = sa && sa.day === today ? sa.count : 0, cb = sb && sb.day === today ? sb.count : 0;
    if (ca !== cb) return ca - cb;
    return (sa?.last ?? "").localeCompare(sb?.last ?? "");
  });
  return open[0];
}

export function bumpRoute(s: RouteState | undefined, today: string, now: string): RouteState {
  return { day: today, count: s && s.day === today ? s.count + 1 : 1, last: now };
}

import { CREDIT_COST } from "./credits.ts";
import type { Door, Lang, Txt } from "./sitetheme.ts";
import type { Feature } from "./usage.ts";

/**
 * Platform blocks: the PaintersMax features a template places on a painter's website.
 *
 * The feature ladder: a template never changes when a client upgrades. Upgrading only turns on more of what a
 * block can do. Each block says the lowest door that gets it (`minDoor`) and what it costs in AI credits when a
 * visitor uses it (`creditCost`, 0 for blocks that never call AI).
 *
 * Adding a feature later = add a block here (with `ready: false` until its endpoint exists), add its section to the
 * templates that should show it, and raise the template version. Existing sites keep working: a block a site has
 * never seen starts with its template default (on or off).
 *
 * Who sees what:
 *  - Visitors see a block only when it is on for the painter's door and ready. Visitors never see upgrade cards.
 *  - The painter's preview also shows locked blocks as a friendly upgrade card, AI blocks with too few credits as a
 *    top-up card, and blocks still being built as "coming soon".
 */

export type BlockKey =
  | "business_info" | "services" | "cities" | "instant_quote" | "color_studio" | "color_studio_ai" | "gallery_ba"
  | "maps" | "chat_helper" | "estimate_request" | "review_request" | "weather" | "voice_chat" | "image_ai";

export interface BlockDef {
  key: BlockKey;
  name: Txt;
  what: Txt; // one line for the painter
  minDoor: Door;
  feature: Feature | null; // the AI-credit feature it charges, when it uses AI
  creditCost: number; // credits per use (0 = no AI)
  ready: boolean; // false until the platform side exists
}

const DOOR_RANK: Record<Door, number> = { free: 0, launch: 1, grow: 2, signature: 3 };
const cost = (f: Feature | null) => (f ? CREDIT_COST[f] : 0);

export const BLOCKS: Record<BlockKey, BlockDef> = {
  business_info: { key: "business_info", name: { en: "Business info", es: "Datos del negocio" }, what: { en: "Name, phone, email, license, hours, area and social links.", es: "Nombre, teléfono, correo, licencia, horario, área y redes." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  services: { key: "services", name: { en: "Services", es: "Servicios" }, what: { en: "Your service pages as cards.", es: "Sus páginas de servicio como tarjetas." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  cities: { key: "cities", name: { en: "Cities served", es: "Ciudades" }, what: { en: "One block per city, linking to your city pages.", es: "Un bloque por ciudad, con enlace a sus páginas de ciudad." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  instant_quote: { key: "instant_quote", name: { en: "Instant quote", es: "Presupuesto al instante" }, what: { en: "Visitors see a price range in seconds. Leads go to your inbox.", es: "Los visitantes ven un rango de precio en segundos. Los contactos llegan a su bandeja." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  color_studio: { key: "color_studio", name: { en: "Color Studio", es: "Estudio de color" }, what: { en: "Visitors try paint colors on a sample room. No credits used.", es: "Los visitantes prueban colores en un cuarto de muestra. No usa créditos." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  color_studio_ai: { key: "color_studio_ai", name: { en: "Color Studio on their own photo", es: "Estudio de color con su propia foto" }, what: { en: "Visitors upload a photo of their wall and see a new color on it.", es: "Los visitantes suben una foto de su pared y ven el color nuevo." }, minDoor: "grow", feature: "color_repaint", creditCost: cost("color_repaint"), ready: false },
  gallery_ba: { key: "gallery_ba", name: { en: "Before and after", es: "Antes y después" }, what: { en: "Drag a slider to compare before and after photos.", es: "Deslice para comparar fotos de antes y después." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  maps: { key: "maps", name: { en: "Google Maps", es: "Google Maps" }, what: { en: "A live map of your area (a drawn map until the key is set).", es: "Un mapa de su área (un mapa dibujado hasta que haya llave)." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  chat_helper: { key: "chat_helper", name: { en: "Chat helper", es: "Ayudante de chat" }, what: { en: "Visitors ask a question; it reaches you as a lead. AI answers come later.", es: "Los visitantes hacen una pregunta y le llega como contacto. Las respuestas con IA vienen después." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  estimate_request: { key: "estimate_request", name: { en: "Estimate request form", es: "Formulario de presupuesto" }, what: { en: "Name, contact and job details, sent to your leads.", es: "Nombre, contacto y detalles del trabajo, enviados a sus contactos." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  review_request: { key: "review_request", name: { en: "Reviews and review requests", es: "Reseñas y solicitudes de reseña" }, what: { en: "Shows reviews you approved and points customers to Google.", es: "Muestra reseñas aprobadas y lleva a los clientes a Google." }, minDoor: "launch", feature: null, creditCost: 0, ready: true },
  weather: { key: "weather", name: { en: "Painting weather", es: "Clima para pintar" }, what: { en: "This week's painting days for your city, from Google weather.", es: "Los días buenos para pintar esta semana en su ciudad, del clima de Google." }, minDoor: "grow", feature: null, creditCost: 0, ready: true },
  voice_chat: { key: "voice_chat", name: { en: "Live voice AI", es: "Voz con IA en vivo" }, what: { en: "Visitors talk to an AI helper that books estimates.", es: "Los visitantes hablan con una IA que agenda presupuestos." }, minDoor: "grow", feature: null, creditCost: 0, ready: false },
  image_ai: { key: "image_ai", name: { en: "Create with AI", es: "Crear con IA" }, what: { en: "Make or edit photos for your site with AI credits.", es: "Cree o edite fotos de su sitio con créditos de IA." }, minDoor: "launch", feature: null, creditCost: 0, ready: false },
};

export const isBlockKey = (k: unknown): k is BlockKey => typeof k === "string" && k in BLOCKS;

export type BlockState =
  | { state: "on" }
  | { state: "upgrade"; door: Door } // the painter's door is too low
  | { state: "topup"; need: number; balance: number } // uses credits and the balance is below one use
  | { state: "soon" }; // not built yet

/**
 * What a block does for this painter. Free drafts preview like Local Pro (Free never publishes).
 * `balance` is the painter's AI credits; pass null when unknown (treated as enough, the endpoint checks again).
 */
export function blockState(key: BlockKey, door: Door, balance: number | null): BlockState {
  const def = BLOCKS[key];
  const d: Door = door === "free" ? "launch" : door;
  if (DOOR_RANK[d] < DOOR_RANK[def.minDoor]) return { state: "upgrade", door: def.minDoor };
  if (!def.ready) return { state: "soon" };
  if (def.creditCost > 0 && balance != null && balance < def.creditCost) return { state: "topup", need: def.creditCost, balance };
  return { state: "on" };
}

/** Visitors see only blocks that work. */
export const visibleToVisitors = (s: BlockState) => s.state === "on";

/** The small card a painter sees in preview instead of a block that is not on. */
export function blockCardText(key: BlockKey, s: BlockState, lang: Lang): { title: string; body: string; action: string; href: string } | null {
  const def = BLOCKS[key];
  const es = lang === "es";
  const doorName = (d: Door) => ({ free: "Free", launch: "Local Pro", grow: "Contractor", signature: "Commercial" })[d];
  if (s.state === "upgrade") return { title: def.name[lang], body: es ? `${def.what.es} Viene con la puerta ${doorName(s.door)}.` : `${def.what.en} Comes with the ${doorName(s.door)} door.`, action: es ? "Ver mejoras" : "See upgrades", href: "/site?upgrade=1" };
  if (s.state === "topup") return { title: def.name[lang], body: es ? `Usa ${s.need} créditos de IA por uso. Le quedan ${s.balance}.` : `Uses ${s.need} AI credits per use. You have ${s.balance}.`, action: es ? "Agregar créditos" : "Add credits", href: "/credits" };
  if (s.state === "soon") return { title: def.name[lang], body: es ? `${def.what.es} Muy pronto.` : `${def.what.en} Coming soon.`, action: "", href: "" };
  return null;
}

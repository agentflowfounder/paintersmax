/**
 * One list of every feature, in English and Spanish, with where it lives and when it appears.
 * Rogelio (2026-11-28): "they cannot be placed for all to see; they need to be placed when they are needed."
 * The menu, Home and help pages should read from this list, so nothing is shown twice or missed.
 * where: "page" (own screen), "tab" (a tab on an existing page), "card" (add-on card that appears when its trigger happens).
 */
export interface FeatureEntry {
  key: string;
  en: string;
  es: string;
  where: "page" | "tab" | "card";
  home: string; // the page or card it appears on
  trigger: string; // when it is shown, in plain words
  plan: "all" | "paid";
  live: boolean; // false = built but switched off until its switch is on
}

export const FEATURES: FeatureEntry[] = [
  { key: "texts", en: "Customer texts", es: "Mensajes a clientes", where: "tab", home: "Customer card on the job page", trigger: "Shows once a customer has a phone number", plan: "all", live: false },
  { key: "text_booked", en: "Booked text", es: "Mensaje de cita confirmada", where: "card", home: "Job page, after a visit is booked", trigger: "A visit date is set", plan: "all", live: false },
  { key: "text_crew", en: "Crew on the way text", es: "Mensaje de equipo en camino", where: "card", home: "Job page, on the visit day", trigger: "The crew is marked on the way", plan: "all", live: false },
  { key: "text_done", en: "Job done text", es: "Mensaje de trabajo terminado", where: "card", home: "Job page, at sign-off", trigger: "The job is marked finished", plan: "all", live: false },
  { key: "crew", en: "Crew", es: "Equipo", where: "page", home: "Menu, More", trigger: "Shows once a crew member is added", plan: "all", live: true },
  { key: "scorecard", en: "Crew scorecard", es: "Calificación del equipo", where: "tab", home: "Crew page", trigger: "Shows after a job is finished", plan: "all", live: true },
  { key: "emergency", en: "Emergency card", es: "Tarjeta de emergencia", where: "card", home: "Crew day card", trigger: "Shows on a crew day card", plan: "all", live: true },
  { key: "plan_limits", en: "Plan limits", es: "Límites del plan", where: "tab", home: "Admin", trigger: "Admin only", plan: "all", live: true },
];

export const featuresAt = (where: FeatureEntry["where"]) => FEATURES.filter((f) => f.where === where);

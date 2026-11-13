/**
 * Getting-started progress for the Home screen: a ring (how many steps are done) and ONE next best step.
 * Pure logic so it can be tested. Every step is true or false from the painter's own records; nothing is estimated.
 */
export interface ProgressFacts {
  companyInfo: boolean; // name, phone and email saved
  services: number;
  cities: number;
  rateCards: number;
  insurance: boolean;
  brand: boolean; // logo set
  cityPagePublished: number;
  leads: number;
  estimatesSent: number;
}

export interface ProgressStep {
  key: string;
  label: string;
  why: string;
  link: string;
  cta: string;
  done: boolean;
}

export interface Progress {
  done: number;
  total: number;
  percent: number;
  steps: ProgressStep[];
  next: ProgressStep | null;
}

export function buildProgress(f: ProgressFacts): Progress {
  const steps: ProgressStep[] = [
    { key: "company", label: "Add your company info", why: "It goes on every estimate and contract, so you only type it once.", link: "/app", cta: "Add company info", done: f.companyInfo },
    { key: "services", label: "Choose your services", why: "Your price list and quote page follow the work you actually do.", link: "/app", cta: "Choose services", done: f.services > 0 },
    { key: "cities", label: "Pick the cities you serve", why: "Each city can get its own page on your website.", link: "/app", cta: "Pick cities", done: f.cities > 0 },
    { key: "prices", label: "Set your prices", why: "Estimates fill in for you from your price list. You can change any number.", link: "/app", cta: "Set prices", done: f.rateCards > 0 },
    { key: "insurance", label: "Add your insurance", why: "We can tell you if each job looks covered, and you can show customers proof.", link: "/insurance", cta: "Add insurance", done: f.insurance },
    { key: "brand", label: "Add your logo", why: "Your quote page, customer portal and city pages will look like one company.", link: "/dashboard#sf", cta: "Add logo", done: f.brand },
    { key: "cityPage", label: "Publish your first city page", why: "A real page for each city you serve helps local customers find you.", link: "/citypages", cta: "Write a city page", done: f.cities === 0 || f.cityPagePublished > 0 },
    { key: "lead", label: "Get your first lead", why: "Share your quote link on your website, Google profile and social pages.", link: "/dashboard#lnk", cta: "Get my quote link", done: f.leads > 0 },
    { key: "estimate", label: "Send your first estimate", why: "Open a job, build the estimate, and send it for e-signature.", link: "/jobs", cta: "Open jobs", done: f.estimatesSent > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, percent: Math.round((done / steps.length) * 100), steps, next: steps.find((s) => !s.done) ?? null };
}

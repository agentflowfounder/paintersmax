export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  // Secrets (set in Cloudflare: Settings -> Variables and Secrets). All optional: missing = demo mode.
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  RESEND_API_KEY?: string;
  // Plain variables (wrangler.jsonc "vars")
  NOTIFY_EMAIL?: string;
  FROM_EMAIL?: string;
  MODEL_ANTHROPIC?: string;
  MODEL_OPENAI?: string;
  MODEL_GEMINI?: string;
  SITE_TOKEN?: string; // shared secret that client websites send to /api/usage/consume
  AI_KILL_SWITCH?: string; // set to "1" to stop all metered AI features at once
  DEV_LOG_LINKS?: string; // local development only
}

export type JobType = "interior" | "exterior" | "both" | "commercial" | "multifamily";
export type Provider = "gemini" | "openai" | "anthropic";

export interface QuoteRequest {
  name: string;
  email: string;
  phone?: string;
  zip?: string;
  jobType: JobType;
  sqft: number;
  details?: string;
  photoUrls?: string[];
  companySlug: string;
}

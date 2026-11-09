import type { Env } from "./types.ts";

/** Maps the quote form's job type to the wizard's trade names. */
export function tradeFor(jobType: string | undefined): string {
  const j = (jobType ?? "").toLowerCase();
  if (j === "exterior") return "exterior";
  if (j === "commercial" || j === "multifamily") return "commercial";
  if (j.includes("exterior")) return "exterior";
  if (j.includes("commercial")) return "commercial";
  if (j.includes("power") || j.includes("pressure")) return "power_washing";
  if (j.includes("drywall") || j.includes("repair")) return "drywall";
  if (j.includes("cabinet")) return "cabinets";
  if (j.includes("fence")) return "fencing";
  return "interior";
}

export interface LeadInput {
  companyId: number;
  leadId: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  zip?: string | null;
  title: string;
  trade: string;
  /** First entry on the job timeline (what the customer asked for). */
  firstEvent?: string;
}

/**
 * Every new lead becomes (or joins) a customer and gets its own job file.
 * A returning customer (same email) keeps one record with many jobs. Never throws: lead capture must not break.
 */
export async function ensureCustomerAndJob(env: Env, i: LeadInput): Promise<{ customerId: number; jobId: number } | null> {
  try {
    const email = i.email ? i.email.trim().toLowerCase() : null;
    let customerId: number | null = null;
    if (email) {
      const c = await env.DB.prepare("SELECT id FROM customers WHERE company_id = ? AND lower(email) = ? ORDER BY id LIMIT 1")
        .bind(i.companyId, email)
        .first<{ id: number }>();
      customerId = c?.id ?? null;
    }
    if (!customerId) {
      const ins = await env.DB.prepare("INSERT INTO customers (company_id, name, email, phone) VALUES (?, ?, ?, ?)")
        .bind(i.companyId, i.name, email, i.phone ?? null)
        .run();
      customerId = Number(ins.meta.last_row_id);
    } else if (i.phone) {
      await env.DB.prepare("UPDATE customers SET phone = COALESCE(phone, ?) WHERE id = ?").bind(i.phone, customerId).run();
    }

    let propertyId: number | null = null;
    if (i.zip) {
      const p = await env.DB.prepare("SELECT id FROM properties WHERE customer_id = ? AND zip = ? ORDER BY id LIMIT 1")
        .bind(customerId, i.zip)
        .first<{ id: number }>();
      if (p) propertyId = p.id;
      else {
        const insP = await env.DB.prepare("INSERT INTO properties (company_id, customer_id, label, zip) VALUES (?, ?, ?, ?)")
          .bind(i.companyId, customerId, `Property ${i.zip}`, i.zip)
          .run();
        propertyId = Number(insP.meta.last_row_id);
      }
    }

    const j = await env.DB.prepare("INSERT INTO jobs (company_id, customer_id, property_id, lead_id, title, trade) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(i.companyId, customerId, propertyId, i.leadId, i.title.slice(0, 120), i.trade)
      .run();
    const jobId = Number(j.meta.last_row_id);
    await env.DB.prepare("UPDATE leads SET customer_id = ?, job_id = ? WHERE id = ?").bind(customerId, jobId, i.leadId).run();
    if (i.firstEvent) await addJobEvent(env, i.companyId, jobId, "lead", i.firstEvent);
    return { customerId, jobId };
  } catch (err) {
    console.error("ensureCustomerAndJob failed", String(err));
    return null;
  }
}

/** Adds one line to a job's timeline. Never throws. */
export async function addJobEvent(env: Env, companyId: number, jobId: number, kind: string, text: string): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO job_events (company_id, job_id, kind, text) VALUES (?, ?, ?, ?)")
      .bind(companyId, jobId, kind, text.slice(0, 6000))
      .run();
    await env.DB.prepare("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?").bind(jobId).run();
  } catch (err) {
    console.error("addJobEvent failed", String(err));
  }
}

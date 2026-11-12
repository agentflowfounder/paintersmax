import { ADMIN_COMPANY_SLUG } from "./admin.ts";
import { getSessionUser, randomToken } from "./auth.ts";
import { DEFAULT_MATERIALS, type Material, type MaterialLink } from "./materials-default.ts";
import { escapeHtml } from "./settings.ts";
import type { Env } from "./types.ts";

/**
 * The materials and tools list. Owner edits it in /admin (add, delete, photo URL, how-to, links).
 * Stored as one JSON value in app_settings (no migration). The public page lists it for everyone;
 * the affiliate disclosure shows only when at least one link is marked affiliate.
 */

const KEY = "materials_catalog";
const MAX_ITEMS = 300;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s"'<>]{4,500}$/.test(v.trim()) ? v.trim() : "");

export function cleanMaterial(input: any, id?: string): Material | null {
  const name = str(input?.name, 120);
  if (!name) return null;
  const links: MaterialLink[] = [];
  if (Array.isArray(input?.links)) {
    for (const l of input.links.slice(0, 6)) {
      const url = httpsUrl(l?.url);
      if (url) links.push({ label: str(l?.label, 40) || "Buy", url, affiliate: l?.affiliate === true });
    }
  }
  return {
    id: id ?? (typeof input?.id === "string" && /^[a-z0-9_]{1,60}$/.test(input.id) ? input.id : randomToken().slice(0, 12)),
    group: str(input?.group, 60) || "Other",
    name,
    why: str(input?.why, 400),
    how: str(input?.how, 1200),
    photo: httpsUrl(input?.photo),
    need: input?.need === "recommended" ? "recommended" : "essential",
    q: str(input?.q, 120) || name,
    links,
  };
}

export const hasAffiliate = (items: Material[]) => items.some((m) => m.links.some((l) => l.affiliate));

export async function loadMaterials(env: Env): Promise<Material[]> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(KEY).first<{ value: string }>().catch(() => null);
  if (!row) return structuredClone(DEFAULT_MATERIALS);
  try {
    const arr = JSON.parse(row.value);
    return Array.isArray(arr) ? arr.map((m: any) => cleanMaterial(m, m?.id)).filter((m): m is Material => !!m) : structuredClone(DEFAULT_MATERIALS);
  } catch {
    return structuredClone(DEFAULT_MATERIALS);
  }
}
async function saveMaterials(env: Env, items: Material[]) {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(KEY, JSON.stringify(items.slice(0, MAX_ITEMS))).run();
}

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...extra } });

/** GET /api/materials: the list (public, short cache). POST (owner admin only): {action: save|delete|reset}. */
export async function handleMaterials(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const items = await loadMaterials(env);
    return json({ items, affiliate: hasAffiliate(items) }, 200, { "cache-control": "public, max-age=60" });
  }
  const user = await getSessionUser(env, request);
  const me = user ? await env.DB.prepare("SELECT slug FROM companies WHERE id = ?").bind(user.companyId).first<{ slug: string }>() : null;
  if (!user || me?.slug !== ADMIN_COMPANY_SLUG) return json({ error: "Not found." }, 404);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const items = await loadMaterials(env);
  if (b?.action === "reset") {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(KEY).run();
    return json({ ok: true });
  }
  if (b?.action === "delete") {
    await saveMaterials(env, items.filter((m) => m.id !== b.id));
    return json({ ok: true });
  }
  if (b?.action === "save") {
    const idx = items.findIndex((m) => m.id === b?.item?.id);
    const clean = cleanMaterial(b.item, idx >= 0 ? items[idx].id : undefined);
    if (!clean) return json({ error: "Give the item a name." }, 400);
    if (idx >= 0) items[idx] = clean;
    else if (items.length >= MAX_ITEMS) return json({ error: "The list is full." }, 400);
    else items.push(clean);
    await saveMaterials(env, items);
    return json({ ok: true, id: clean.id });
  }
  return json({ error: "Unknown action." }, 400);
}

/** Public, search-friendly page at /painting-materials. */
export function renderPublicMaterials(items: Material[]): string {
  const x = escapeHtml;
  const groups: { g: string; list: Material[] }[] = [];
  for (const m of items) {
    let g = groups.find((y) => y.g === m.group);
    if (!g) groups.push((g = { g: m.group, list: [] }));
    g.list.push(m);
  }
  const aff = hasAffiliate(items);
  const itemLink = (m: Material) => {
    const l = m.links[0];
    return l
      ? `<a class="go" href="${x(l.url)}" target="_blank" rel="${l.affiliate ? "sponsored " : ""}noopener">${x(l.label)}</a>`
      : `<a class="go" href="https://www.google.com/search?tbm=shop&q=${encodeURIComponent(m.q)}" target="_blank" rel="noopener">Compare prices</a>`;
  };
  const body = groups
    .map(
      (g) => `<h2>${x(g.g)}</h2>` + g.list.map((m) => `<div class="it">${m.photo ? `<img src="${x(m.photo)}" alt="${x(m.name)}" loading="lazy">` : ""}<div><h3>${x(m.name)} <span class="tag">${m.need === "essential" ? "Essential" : "Nice to have"}</span></h3><p>${x(m.why)}</p>${m.how ? `<p><b>How to use it:</b> ${x(m.how)}</p>` : ""}${itemLink(m)}</div></div>`).join(""),
    )
    .join("");
  const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", name: "Painting materials and tools checklist", itemListElement: items.slice(0, 100).map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.name })) }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painting Materials and Tools Checklist for Painters | PaintersMax</title>
<meta name="description" content="A practical checklist of the brushes, rollers, sprayers, prep supplies, safety gear and ladders a painting crew needs, with what each is for and how to use it.">
<link rel="canonical" href="https://paintersmax.app/painting-materials">
<meta property="og:title" content="Painting Materials and Tools Checklist"><meta property="og:type" content="website"><meta property="og:url" content="https://paintersmax.app/painting-materials">
<script type="application/ld+json">${ld}</script>
<style>*{box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#F7F5F1;color:#0F1B2D;margin:0;line-height:1.5}header{background:#0F1B2D;color:#fff;padding:14px 16px}header a{color:#E8A33D;text-decoration:none;font-family:Newsreader,Georgia,serif;font-size:19px}
main{max-width:820px;margin:0 auto;padding:16px 16px 60px}h1{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:32px;margin:10px 0}h2{font-family:Newsreader,Georgia,serif;font-weight:500;margin:28px 0 6px}h3{font-size:16px;margin:0 0 4px}
.it{display:flex;gap:14px;background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:14px;margin:0 0 10px}.it img{width:96px;height:96px;object-fit:cover;border-radius:8px;flex:none}.it p{margin:4px 0;font-size:14px;color:#2d3748}
.tag{font-size:11px;border-radius:99px;padding:2px 8px;font-weight:600;background:#e6f4ea;color:#0a7a3d;white-space:nowrap}
a.go{display:inline-block;margin-top:6px;font-size:13px;font-weight:700;color:#0F1B2D;background:#E8A33D;border-radius:8px;padding:8px 12px;text-decoration:none}
.disc{font-size:13px;color:#4A5568;margin-top:24px;padding-top:12px;border-top:1px solid #ddd}.cta{background:#0F1B2D;color:#fff;border-radius:10px;padding:16px;margin:28px 0}.cta a{color:#E8A33D}</style></head><body>
<header><a href="/">PaintersMax</a></header><main>
<h1>Painting materials and tools checklist</h1>
<p>A general starting list for a painting crew. Add or skip items to fit the work you do. This is not a requirement or professional advice.</p>
${body}
${aff ? `<div class="disc">Disclosure: some links on this page are affiliate links. If you buy through them, PaintersMax may earn a small commission at no extra cost to you. It never changes your price.</div>` : ""}
<div class="cta"><b>Run your painting business faster.</b><br>PaintersMax gives painters a website, quote tool, estimates, contracts and invoices. <a href="/start">See plans</a></div>
</main></body></html>`;
}

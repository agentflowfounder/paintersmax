// Builds the version 2 public pages (new design, 2026-11-16) into public/.
// Run: node tools/build-site-v2.mjs
// Phase 1: /styleguide and /home-v2 (both noindex). The live pages from tools/build-site.mjs stay untouched
// until Rogelio approves the swap.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (name, html) => writeFileSync(join(root, "public", name), html);

const NAV = [
  ["/features", "Features"],
  ["/how-it-works", "How it works"],
  ["/pricing", "Pricing"],
  ["/color-studio", "Color Studio"],
  ["/faq", "FAQ"],
];

// Media slots: placeholders until Rogelio supplies the real file. Also written to public/media-slots.json.
export const SLOTS = [
  { id: "VIDEO-1", page: "/", section: "Hero", kind: "video loop, 8 s", size: "1920x1080 and 1080x1350 phone crop", status: "placeholder (photo poster)",
    prompt: "Slow dolly past a painter cutting a clean line along white trim in a bright Texas living room, late morning sun, natural colors, no faces in focus, no logos, calm and steady, seamless loop." },
  { id: "SHORT-1", page: "/", section: "Product window", kind: "screen clip, 6 s", size: "1600x1000", status: "waiting for Rogelio",
    prompt: "Screen recording: a new estimate is built from a room photo, the total appears, then 'Send to customer' is tapped. Sample data only." },
  { id: "SHORT-2", page: "/", section: "Color Studio preview", kind: "screen clip, 6 s", size: "1200x900", status: "waiting for Rogelio",
    prompt: "A house exterior photo changes from beige to a deep navy body with white trim, slider moves left to right." },
  { id: "SHORT-3", page: "/", section: "Tools grid", kind: "screen clip, 6 s", size: "1200x900", status: "waiting for Rogelio",
    prompt: "A job card moves from Booked to In progress to Paid on the schedule board." },
  { id: "PHOTO-1", page: "/", section: "Built by a painter", kind: "photo", size: "1200x1500", status: "waiting for Rogelio",
    prompt: "Rogelio on a job site or with his truck, natural light, no customer property details visible." },
  { id: "OG-1", page: "all", section: "Social share image", kind: "image", size: "1200x630", status: "waiting",
    prompt: "PaintersMax wordmark and 'Bid it. Book it. Bank it.' on navy with one job photo." },
];

const LOGO = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#141C33"/><path d="M7 21.5c3.2-1.1 5.6-3.9 8.4-7.6 2-2.6 4.6-5 9.6-6.4-1.8 4.4-4 7.5-6.8 9.8-3 2.4-6.7 3.8-11.2 4.2z" fill="#E3963A"/><circle cx="9" cy="24.5" r="1.6" fill="#F4EFE6"/></svg>`;

function page({ file, title, desc, path, body, noindex = true, headerMode = "dark" }) {
  const nav = NAV.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join("");
  const html = `<!DOCTYPE html>
<html lang="en" class="no-js">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ""}
<link rel="canonical" href="https://paintersmax.app${path}">
<meta name="theme-color" content="#141C33">
<meta property="og:type" content="website">
<meta property="og:site_name" content="PaintersMax">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="https://paintersmax.app/img/home-exterior-1400.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/fraunces-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site-v2.css">
<style>[data-until][hidden]{display:none!important}</style>
<script src="/i18n.js"></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<header class="site-header ${headerMode}">
  <div class="wrap bar">
    <a class="logo" href="/" aria-label="PaintersMax home">${LOGO}<span>PaintersMax</span></a>
    <nav aria-label="Main"><ul class="nav">${nav}</ul></nav>
    <div class="head-actions">
      <a class="login" href="/login">Log in</a>
      <a class="btn btn-light btn-small" href="/start">Start free</a>
      <button class="menu-btn" type="button" aria-label="Open menu" aria-controls="mobile-menu" aria-expanded="false"><span></span></button>
    </div>
  </div>
</header>

<div class="mobile-menu" id="mobile-menu" aria-hidden="true" role="dialog" aria-label="Menu">
  <div class="top"><a class="logo" href="/">${LOGO}<span>PaintersMax</span></a><button class="menu-btn" style="display:inline-flex;color:#fff" type="button" id="menu-close" aria-label="Close menu">&times;</button></div>
  <ul>${nav}<li><a href="/login">Log in</a></li></ul>
  <a class="btn btn-primary" href="/start">Start free <span class="arr">&rarr;</span></a>
</div>

<main id="main">
${body}
</main>

<footer class="section dark on-dark" style="padding:48px 0">
  <div class="wrap" style="display:flex;flex-wrap:wrap;gap:16px 32px;justify-content:space-between;align-items:center">
    <a class="logo" href="/">${LOGO}<span>PaintersMax</span></a>
    <p class="small" style="color:rgba(255,255,255,.7)">The painter's business in a box. A product of AgentFlow LLC. <a href="mailto:support@paintersmax.app">support@paintersmax.app</a></p>
  </div>
</footer>

<script src="/site-v2.js" defer></script>
</body>
</html>
`;
  out(file, html);
}

const slotTag = (s) => `<details class="slot-tag"><summary>${s.id}: ${s.section.toLowerCase()} video slot</summary><p class="small" style="max-width:320px;margin-top:6px;color:var(--slate)">${s.prompt}</p></details>`;

// ---------- Home, version 2 (Phase 1: hero only) ----------
const hero = `
<section class="hero on-dark" aria-labelledby="hero-title">
  <div class="hero-media" aria-hidden="true">
    <picture>
      <source type="image/webp" srcset="/img/interior-crew-800.webp 800w, /img/interior-crew-1400.webp 1400w" sizes="100vw">
      <img src="/img/interior-crew-1400.webp" width="1400" height="1050" alt="" fetchpriority="high">
    </picture>
  </div>
  ${slotTag(SLOTS[0])}
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="kicker">The painter's business in a box</span>
      <h1 class="h1 balance" id="hero-title">Bid it. Book it. <em>Bank it.</em></h1>
      <p class="lead">Quotes from a photo, a schedule your crew can follow, and invoices that get paid. Built by a painter, in English and Spanish.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="/start">Start free <span class="arr">&rarr;</span></a>
        <a class="btn btn-light" href="/contact#walkthrough">Book a walkthrough</a>
      </div>
      <ul class="hero-notes">
        <li>Free account, no card</li>
        <li>Website included on paid plans</li>
        <li data-from="2026-11-25" data-until="2027-01-06">Booked by Spring: Launch for $299</li>
      </ul>
    </div>
    <div class="ask" aria-label="Sample conversation with BP, the PaintersMax helper">
      <div class="ask-head">
        <div class="ask-who"><span class="ask-avatar">BP</span><span>Ask BP</span></div>
        <span class="ask-live">Sample chat</span>
      </div>
      <div class="ask-log notranslate" id="ask-log" aria-live="off"></div>
      <div class="ask-foot">
        <span class="small">Prices come from your own rates.</span>
        <a href="/instant-quote">Try BP live &rarr;</a>
      </div>
    </div>
  </div>
</section>
<section class="section">
  <div class="wrap" style="display:grid;gap:12px;max-width:760px">
    <span class="kicker">Preview</span>
    <h2 class="h2">The rest of the home page comes in <em>Phase 2.</em></h2>
    <p class="body">Product window, what it replaces, how it works, tools, Color Studio, your website, Spanish, pricing, built by a painter, FAQ and the walkthrough form.</p>
  </div>
</section>`;

page({ file: "home-v2.html", title: "PaintersMax | The painter's business in a box", desc: "Quotes from a photo, a schedule your crew can follow, and invoices that get paid. Built by a painter, in English and Spanish.", path: "/", body: hero });

// ---------- Style guide ----------
const sw = (name, v, dark) => `<div class="swatch"><i style="background:${v}${dark ? "" : ";border-bottom:1px solid var(--line-soft)"}"></i><div><b>${name}</b><br><code>${v}</code></div></div>`;
const guide = `
<section class="section" style="padding-top:120px">
  <div class="wrap" style="display:grid;gap:56px">
    <div style="display:grid;gap:12px;max-width:760px">
      <span class="kicker">Style guide, version 2</span>
      <h1 class="h1">PaintersMax <em>design system</em></h1>
      <p class="lead">Colors, type, buttons, cards and form fields for the new public pages. Not shown to search engines.</p>
    </div>

    <div style="display:grid;gap:16px">
      <h2 class="h3">Colors</h2>
      <div class="grid g4">
        ${sw("Navy", "#141C33", 1)}${sw("Navy 2", "#1D2843", 1)}${sw("Ink", "#1B2235", 1)}${sw("Slate", "#4C5468", 1)}
        ${sw("Cream", "#F4EFE6")}${sw("Cream 2", "#EDE6D9")}${sw("Card", "#FAF7F1")}${sw("White", "#FFFFFF")}
        ${sw("Orange", "#E3963A", 1)}${sw("Orange dark", "#C9802A", 1)}${sw("Rust", "#B5652A", 1)}${sw("Muted", "#6E7588", 1)}
      </div>
      <h3 class="h4" style="margin-top:12px">Work step colors (proposed)</h3>
      <div class="grid g4">
        <div class="card stage" style="--c:var(--stage-quote)"><p class="h4"><span class="dot"></span>Quote</p><p class="small">#E3963A</p></div>
        <div class="card stage" style="--c:var(--stage-book)"><p class="h4"><span class="dot"></span>Book</p><p class="small">#4F6A9A</p></div>
        <div class="card stage" style="--c:var(--stage-paint)"><p class="h4"><span class="dot"></span>Paint</p><p class="small">#5E7F63</p></div>
        <div class="card stage" style="--c:var(--stage-paid)"><p class="h4"><span class="dot"></span>Get paid</p><p class="small">#B5652A</p></div>
      </div>
    </div>

    <div style="display:grid;gap:16px">
      <h2 class="h3">Type</h2>
      <div class="card" style="display:grid;gap:18px">
        <p class="small">Headings: Fraunces. Body: Inter. Both self-hosted.</p>
        <p class="h1">Bid it. Book it. <em>Bank it.</em></p>
        <p class="h2">Every job, from first call to <em>paid.</em></p>
        <p class="h3">Quotes from a photo</p>
        <p class="h4">Job File</p>
        <p class="lead">Lead text: quotes from a photo, a schedule your crew can follow, and invoices that get paid.</p>
        <p class="body">Body text: PaintersMax keeps your customers, estimates, jobs and payments in one place, on your phone.</p>
        <span class="kicker">Kicker label</span>
      </div>
    </div>

    <div style="display:grid;gap:16px">
      <h2 class="h3">Buttons</h2>
      <div class="card" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
        <a class="btn btn-primary" href="#">Start free <span class="arr">&rarr;</span></a>
        <a class="btn btn-outline" href="#">Book a walkthrough</a>
        <a class="btn btn-primary btn-small" href="#">Small</a>
      </div>
      <div class="card on-dark" style="background:var(--navy);display:flex;flex-wrap:wrap;gap:12px">
        <a class="btn btn-primary" href="#">Start free <span class="arr">&rarr;</span></a>
        <a class="btn btn-light" href="#">Book a walkthrough</a>
      </div>
    </div>

    <div style="display:grid;gap:16px">
      <h2 class="h3">Form fields</h2>
      <div class="card grid g2">
        <div class="field"><label for="sg-name">Your name</label><input id="sg-name" autocomplete="name"></div>
        <div class="field bad"><label for="sg-email">Email</label><input id="sg-email" type="email" value="rogelio@"><span class="err">Please enter a full email address.</span></div>
      </div>
    </div>

    <div style="display:grid;gap:16px">
      <h2 class="h3">Media slots</h2>
      <p class="body">Placeholders stay until the real video, clip or photo arrives.</p>
      <div class="grid g2">
        ${SLOTS.map((s) => `<div class="ph" style="min-height:220px"><div class="ph-in"><b>${s.id} &middot; ${s.kind}</b><p><strong>${s.section}</strong>, ${s.size}</p><p>Prompt: ${s.prompt}</p></div></div>`).join("")}
      </div>
    </div>
  </div>
</section>`;

page({ file: "styleguide.html", title: "Style guide | PaintersMax", desc: "PaintersMax design system, version 2.", path: "/styleguide", body: guide, headerMode: "solid" });

writeFileSync(join(root, "public", "media-slots.json"), JSON.stringify({ updated: "2026-11-16", slots: SLOTS }, null, 2) + "\n");
console.log("built home-v2.html, styleguide.html, media-slots.json");

// Builds the public marketing pages into public/. Run: node tools/build-site.mjs
// The pages share one header, footer and stylesheet (public/site.css). Edit the copy here, then run this again.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (name, html) => writeFileSync(join(root, "public", name), html);

const NAV = [
  ["/features", "Features"],
  ["/instant-quote", "Instant quote"],
  ["/color-studio", "Color Studio"],
  ["/pricing", "Pricing"],
  ["/how-it-works", "How it works"],
  ["/why-paintersmax", "Why us"],
];

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500;1,9..144,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;

const OFFER_JS = `<script>
(function () {
  var today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
  var force = /[?&]offer=1\\b/.test(location.search);
  var on = false;
  document.querySelectorAll('[data-until]').forEach(function (el) {
    var live = force || (today >= el.getAttribute('data-from') && today <= el.getAttribute('data-until'));
    el.hidden = !live;
    if (live) on = true;
  });
  document.querySelectorAll('[data-promo]').forEach(function (el) { el.textContent = on ? el.getAttribute('data-promo') : el.getAttribute('data-list'); });
})();
</script>`;

function page({ file, title, desc, path, active, body, script = "", noindex = false, ld = "", demo = true }) {
  const nav = NAV.map(([h, l]) => `<li><a href="${h}"${active === h ? ' aria-current="page"' : ""}>${l}</a></li>`).join("");
  const mnav = NAV.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join("");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${desc}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="https://paintersmax.app${path}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="https://paintersmax.app/img/home-exterior-1400.jpg">
<meta property="og:type" content="website">
${FONTS}
<link rel="stylesheet" href="/site.css">
<style>[data-until][hidden]{display:none!important}</style>
${ld}
</head>
<body>

<div class="offer" data-from="2026-11-25" data-until="2027-01-06">
  <div class="wrap">
    <span><b>Booked by Spring.</b> November 25 to January 6: Launch for $299, 1,000 AI credits and a Founding member badge.</span>
    <a href="/pricing">See the offer</a>
  </div>
</div>

<header>
  <div class="wrap nav-row">
    <a class="brand" href="/" aria-label="PaintersMax home"><b>PaintersMax</b><span>Bid it. Book it. Bank it.</span></a>
    <nav aria-label="Main"><ul>${nav}</ul></nav>
    <div class="nav-actions">
      <a class="signin" href="/login">Sign in</a>
      <a class="btn btn-orange arrow" href="/pricing">Get started</a>
      <details class="mnav"><summary>Menu</summary><ul>${mnav}<li><a href="/login">Sign in</a></li></ul></details>
    </div>
  </div>
</header>

<main>
${body}
</main>

<footer>
  <div class="wrap">
    <div class="foot-grid">
      <div><span class="brand"><b>PaintersMax</b></span><p>The painter's business in a box. A product of AgentFlow LLC. Built by a painter, for painters.</p></div>
      <div><h4>Product</h4><ul><li><a href="/features">Features</a></li><li><a href="/pricing">Pricing</a></li><li><a href="/how-it-works">How it works</a></li><li><a href="/why-paintersmax">Why PaintersMax</a></li></ul></div>
      <div><h4>Try it</h4><ul><li><a href="/instant-quote">Instant quote</a></li><li><a href="/color-studio">Color Studio</a></li><li><a href="/painting-materials">Painting materials list</a></li><li><a href="/insurance-for-painters">Painter's insurance guide</a></li></ul></div>
      <div><h4>Account</h4><ul><li><a href="/start">Get started</a></li><li><a href="/login">Sign in</a></li><li><a href="mailto:support@paintersmax.app">support@paintersmax.app</a></li><li><a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/early-access-agreement">Early access</a></li></ul></div>
    </div>
    <div class="foot-bottom">
      <span>&copy; 2026 AgentFlow LLC. All rights reserved.</span>
      <span>Bid it &middot; Book it &middot; Bank it</span>
    </div>
  </div>
</footer>

${OFFER_JS}
${script}
${demo ? '<script src="/demo.js" defer></script>' : ""}
</body>
</html>
`;
  out(file, html);
}

// ---------- shared pieces ----------

const plans = `
<div class="plans">
  <div class="plan">
    <h3>Free</h3>
    <div class="for">Try it. No card, no clock.</div>
    <div class="price"><b>$0</b></div>
    <div class="promo-note"></div>
    <div class="renew">Free for as long as you like</div>
    <ul>
      <li>Your own quote page</li>
      <li>Estimates, contracts and invoices</li>
      <li>A listing in the painter directory</li>
      <li>250 welcome AI credits</li>
      <li>Top up AI credits from $5</li>
    </ul>
    <a class="btn btn-line arrow" href="/start">Start free</a>
  </div>
  <div class="plan dark">
    <span class="tag">Most popular</span>
    <h3>Launch</h3>
    <div class="for">Solo painters and small crews</div>
    <div class="price"><b data-promo="$299" data-list="$399">$399</b><s data-from="2026-11-25" data-until="2027-01-06">$399</s><span>for year one</span></div>
    <div class="promo-note" data-from="2026-11-25" data-until="2027-01-06">$299 with Booked by Spring</div>
    <div class="renew">Then $199 a year</div>
    <ul>
      <li>Your own website address, registered for you</li>
      <li>A 5-page website with 3 services, hosted</li>
      <li>Instant quote and AI chat on your site</li>
      <li>500 AI credits at sign-up</li>
      <li>Everything in Free</li>
    </ul>
    <a class="btn btn-orange arrow" href="/start">Get Launch</a>
  </div>
  <div class="plan">
    <h3>Grow</h3>
    <div class="for">Busy crews</div>
    <div class="price"><b data-promo="$399" data-list="$549">$549</b><s data-from="2026-11-25" data-until="2027-01-06">$549</s><span>for year one</span></div>
    <div class="promo-note" data-from="2026-11-25" data-until="2027-01-06">$399 with Booked by Spring</div>
    <div class="renew">Then $249 a year</div>
    <ul>
      <li>More pages and more services on your site</li>
      <li>Pro AI credits for photos, quotes and chat</li>
      <li>Pick a monthly AI allowance that fits how busy you are</li>
      <li>Everything in Launch</li>
    </ul>
    <a class="btn btn-line arrow" href="/start">Get Grow</a>
  </div>
  <div class="plan">
    <h3>Signature</h3>
    <div class="for">Companies that want to stand out</div>
    <div class="price"><b data-promo="$499" data-list="$699">$699</b><s data-from="2026-11-25" data-until="2027-01-06">$699</s><span>for year one</span></div>
    <div class="promo-note" data-from="2026-11-25" data-until="2027-01-06">$499 with Booked by Spring</div>
    <div class="renew">Then $299 a year</div>
    <ul>
      <li>Custom premium website templates</li>
      <li>The most pages and services</li>
      <li>Everything in Grow</li>
    </ul>
    <a class="btn btn-line arrow" href="/start">Get Signature</a>
  </div>
</div>`;

const faq = `
<div class="faq">
  <details><summary>Is there a setup fee?</summary><p>No. The price on the plan is the price you pay. There is no separate setup fee and no monthly bill. You pay once a year, and the first year includes setting up your website address and your site.</p></details>
  <details><summary>Is Free really free?</summary><p>Yes. You can use the free tools for as long as you like with no card. You also get 250 welcome AI credits to try the AI tools. They expire after 60 days. After that, you can keep using the free tools or add credits whenever you want.</p></details>
  <details><summary>What happens after the first year?</summary><p>Launch renews at $199 a year, Grow at $249 and Signature at $299. You can cancel any time before the renewal date from your dashboard or by emailing billing@paintersmax.app. If a renewal is missed, your website, your directory listing and the free tools stay on. Only the paid extras stop.</p></details>
  <details><summary>Can I get my money back?</summary><p>Yes. If you cancel within 14 days of your first payment, we refund it in full, less $20 for the website address we registered for you.</p></details>
  <details><summary>What are AI credits?</summary><p>Credits pay for the heavier AI jobs, like reading a photo, making a color preview or helping with a quote. Every account gets 250 welcome credits. Paid sign-ups get 500 more (1,000 during Booked by Spring). If you want more, you can add a monthly allowance ($19 for 150 credits, $39 for 400, $79 for 1,000, and unused credits roll over for two months) or a one-time top-up from $5 to $100. The credits that expire soonest are used first, and if an AI try fails, the credits come back.</p></details>
  <details><summary>Will you contact my customers?</summary><p>No. PaintersMax only emails your customers when you choose to send something. AI drafts never go out until you send them.</p></details>
  <details><summary>Who owns the website address?</summary><p>We register it for you and keep it renewed while your plan is active. If you ever leave, you can ask to transfer it to you until it expires.</p></details>
  <details><summary>Does it work in Spanish?</summary><p>Yes. The app and the crew documents work in English and Spanish. Our chat helper, Maistro, answers in Spanish too.</p></details>
</div>`;

const startFree = `<a class="btn btn-orange arrow" href="/start">Start free</a>`;

// ---------- home ----------

page({
  file: "home-preview.html",
  path: "/",
  active: "",
  noindex: true,
  title: "PaintersMax | The painter's business in a box",
  desc: "PaintersMax gives painting contractors a website that brings leads, estimates your customer signs on their phone, invoices by milestone and job records, in English and Spanish. Built by a painter.",
  ld: `<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"PaintersMax","applicationCategory":"BusinessApplication","operatingSystem":"Web","description":"Website, leads, estimates, e-signed contracts, milestone invoices and job records for painting contractors, in English and Spanish.","offers":[{"@type":"Offer","name":"Free","price":"0","priceCurrency":"USD"},{"@type":"Offer","name":"Launch","price":"399","priceCurrency":"USD"},{"@type":"Offer","name":"Grow","price":"549","priceCurrency":"USD"},{"@type":"Offer","name":"Signature","price":"699","priceCurrency":"USD"}],"publisher":{"@type":"Organization","name":"AgentFlow LLC","email":"support@paintersmax.app"}}</script>`,
  body: `
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <h1>Bid it. Book it. <em>Bank it.</em></h1>
      <p class="lead">You're great with a brush. The paperwork is what eats your evenings. PaintersMax takes care of it: a website that brings in leads, estimates your customers sign on their phone, invoices that go out on time, and every job's records in one place. In English and Spanish.</p>
      <div class="hero-ctas">
        ${startFree}
        <a class="btn btn-line" href="/instant-quote">Try an instant quote</a>
      </div>
      <div class="stats">
        <div><b>$0</b><span>to start. No card needed</span></div>
        <div><b>EN/ES</b><span>for your crew and your customers</span></div>
        <div><b>1 price</b><span>a year. No setup fee, no monthly bill</span></div>
      </div>
    </div>
    <div class="hero-art">
      <img src="/img/painter-ladder-800.webp" srcset="/img/painter-ladder-800.webp 800w, /img/painter-ladder-1400.webp 1152w" sizes="(max-width: 900px) 100vw, 46vw" width="1152" height="1536" alt="A painter on a ladder rolling fresh paint onto house siding">
    </div>
  </div>
</section>

<section class="block tight">
  <div class="wrap">
    <div class="head-row">
      <h2>Don't take our word for it. <em>Try it right now.</em></h2>
      <p>These two tools are the same ones your customers would use on your website. No sign-up needed.</p>
    </div>
    <div class="grid2">
      <div class="card"><h3>Instant quote</h3><p>Tell it a few things about a job and get a real price range in seconds. That's what a homeowner sees on your site at 9 at night, when you're not answering the phone.</p><a class="btn btn-orange arrow" href="/instant-quote">Get a quote</a></div>
      <div class="card"><h3>Color Studio</h3><p>Pick a color and watch a room or a house change. Your customers can see what they're buying before they say yes. The AI pictures are labeled previews.</p><a class="btn btn-line arrow" href="/color-studio">Try the colors</a></div>
    </div>
  </div>
</section>

<section class="block" id="features">
  <div class="wrap">
    <div class="head-row">
      <h2>From the first call to the <em>final check.</em></h2>
      <p>Everything a job needs, in the order a job happens. Every crew document comes in English and Spanish.</p>
    </div>
    <div class="docs">
      <div class="doc"><small>01</small><h3>Priced estimates</h3><p>What's included, what's not and when you get paid, on every line. Your customer knows exactly what they're buying.</p></div>
      <div class="doc"><small>02</small><h3>Contracts</h3><p>Made from your estimate and signed on your customer's phone. You both get the signed copy.</p></div>
      <div class="doc"><small>03</small><h3>Invoices</h3><p>Deposit, progress payments and the final check, each one a clean document.</p></div>
      <div class="doc"><small>04</small><h3>Materials and tools lists</h3><p>Everything the job needs, written down before the truck leaves the yard.</p></div>
      <div class="doc"><small>05</small><h3>Crew schedule</h3><p>Who's where on which day, with the instructions to start without calling you.</p></div>
      <div class="doc"><small>06</small><h3>Punch list and warranty letter</h3><p>Close the job properly and hand over a warranty letter your customer keeps.</p></div>
    </div>
    <div class="docs-foot">
      <span><b>Plus a helper that knows each job</b> and answers in plain words.</span>
      <a class="arrow" href="/features">See every feature</a>
    </div>
  </div>
</section>

<section class="block steps-sec" id="how">
  <div class="wrap">
    <div class="head">
      <span class="kicker">How it works</span>
      <h2>Four steps, and you can stop and <em>come back anytime.</em></h2>
    </div>
    <div class="steps">
      <div class="step"><i>01</i><h3>Start free</h3><p>Make your account. No card.</p></div>
      <div class="step"><i>02</i><h3>Set your prices</h3><p>Seven short steps. Pick a starting level, then change any number.</p></div>
      <div class="step"><i>03</i><h3>Share your quote page</h3><p>Leads land in your account and your email.</p></div>
      <div class="step"><i>04</i><h3>Send, sign, get paid</h3><p>Estimate, contract and invoices, all from the same job.</p></div>
    </div>
    <p style="margin-top:28px"><a class="btn btn-line arrow" href="/how-it-works">See the whole walk-through</a></p>
  </div>
</section>

<section class="block" id="pricing">
  <div class="wrap">
    <div class="head-row">
      <div>
        <span class="kicker">Straight-up pricing</span>
        <h2 style="margin-top:18px">One price a year. <em>That's it.</em></h2>
      </div>
      <p>No setup fee. No monthly bill. Start free and move up only when you want a website or more AI help.</p>
    </div>
    ${plans}
    <p class="fine"><span data-from="2026-11-25" data-until="2027-01-06">Booked by Spring runs November 25, 2026 to January 6, 2027 and gives 1,000 AI credits instead of 500. </span>Full refund within 14 days of your first payment, less $20 for the website address we registered. Miss a renewal? Your website and the free tools stay on. <a href="/pricing" style="text-decoration:underline">Every detail on the pricing page.</a></p>
  </div>
</section>

<section class="founder" id="why">
  <div class="wrap founder-grid">
    <div>
      <span class="kicker light">Why PaintersMax</span>
      <h2>Built by a painter. Not a software <em>company.</em></h2>
    </div>
    <div>
      <p>Most contractor software was built by people who never dealt with homeowners, crews and change orders. PaintersMax is built around the real job, from the first quote to the last payment, in the language your crew speaks.</p>
      <ul><li>Website</li><li>Estimates</li><li>Contracts</li><li>Invoices</li><li>Job records</li></ul>
      <p style="margin-top:18px"><a href="/why-paintersmax" style="text-decoration:underline">Read how we think about it</a></p>
    </div>
  </div>
</section>

<section class="final">
  <img src="/img/home-exterior-1400.webp" srcset="/img/home-exterior-800.webp 800w, /img/home-exterior-1400.webp 1400w" sizes="100vw" width="1400" height="788" loading="lazy" alt="">
  <div class="wrap">
    <span class="kicker">Ready when you are</span>
    <h2>Get organized and start winning more jobs.</h2>
    <div class="ctas">
      ${startFree}
      <a class="btn btn-line light" href="/login">Sign in</a>
    </div>
  </div>
</section>`,
});

// ---------- features ----------

const feat = (h, items) => `<div class="card"><h3>${h}</h3><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`;
page({
  file: "features.html",
  path: "/features",
  active: "/features",
  title: "Features | PaintersMax",
  desc: "Everything a painting contractor needs in one place: instant quotes, estimates, e-signed contracts, milestone invoices, crew schedules, job records, reminders and color previews. English and Spanish.",
  body: `
<section class="page-hero"><div class="wrap">
  <span class="kicker">Features</span>
  <h1>Everything a job needs, <em>in the order a job happens.</em></h1>
  <p class="lead">No giant manual. Here's what's inside, grouped by what you're trying to get done.</p>
  <div class="hero-ctas">${startFree}<a class="btn btn-line" href="/pricing">See pricing</a></div>
</div></section>
<section class="block tight"><div class="wrap">
  <div class="grid3">
    ${feat("Get found and get leads", ["A quote page and contact form that work on any phone", "Instant quote and AI chat on your website (Launch and up)", "A listing in the painter directory", "Customer reviews, only from customers who paid"])}
    ${feat("Win the job", ["Estimates with what's included and not included", "Your own rate card: pick Value, Standard, Premium or Master, then change any number", "Photo help for tricky jobs", "Color previews on your customer's own photo"])}
    ${feat("Sign and schedule", ["Contracts your customer signs on their phone", "Site visits, calendar and crew assignments", "Work orders and change orders for extra work", "Materials and tools lists"])}
    ${feat("Get paid", ["Invoices by milestone: deposit, progress, final", "Friendly payment reminders you can turn on", "Customer sign-off and a warranty letter", "A morning email with what needs you today"])}
    ${feat("Stay organized and covered", ["Job records in one place", "Insurance helper and certificates of insurance", "Crew time sheets and records for your accountant", "Reminders for expiring insurance and open items"])}
    ${feat("Built for your whole team", ["English and Spanish for you, your crew and your customers", "A help chat that answers from the guide", "A materials list page painters can share", "Clear AI limits so nobody runs up your bill"])}
  </div>
  <div class="callout" style="margin-top:34px"><b>A note on tax and legal stuff.</b> Records and reports are made for you to hand to your accountant. They're not tax or legal advice. Have your own attorney look at the contract you use.</div>
</div></section>
<section class="block"><div class="wrap grid2">
  <div class="card"><h3>See the AI at work</h3><p>The quickest way to understand it is to use it. The instant quote and the Color Studio are open to everyone.</p><a class="btn btn-orange arrow" href="/instant-quote">Instant quote</a> <a class="btn btn-line arrow" href="/color-studio">Color Studio</a></div>
  <div class="card"><h3>Free guides for painters</h3><p>A painting materials list you can use today, and a plain-words guide to painter's insurance.</p><a class="btn btn-line arrow" href="/painting-materials">Materials list</a> <a class="btn btn-line arrow" href="/insurance-for-painters">Insurance guide</a></div>
</div></section>`,
});

// ---------- pricing ----------

page({
  file: "pricing.html",
  path: "/pricing",
  active: "/pricing",
  title: "Pricing | PaintersMax",
  desc: "PaintersMax is free to start. Launch, Grow and Signature are one price a year with your website included. No setup fee and no monthly bill.",
  script: "",
  body: `
<section class="page-hero"><div class="wrap">
  <span class="kicker">Pricing</span>
  <h1>Here's the deal, <em>in plain words.</em></h1>
  <p class="lead">Start free. If you want us to build your website, pick a plan. You pay once a year. There's no setup fee and no monthly bill, and the price you see is the price you pay.</p>
</div></section>
<section class="block tight"><div class="wrap">
  ${plans}
  <div class="callout" style="margin-top:34px"><b data-from="2026-11-25" data-until="2027-01-06">Booked by Spring, November 25 to January 6: </b><span data-from="2026-11-25" data-until="2027-01-06">the first-year prices above drop to $299, $399 and $499, you get 1,000 AI credits instead of 500, and a Founding member badge. </span>Renewal prices stay the same: $199, $249 and $299 a year.</div>
</div></section>
<section class="block"><div class="wrap">
  <div class="head"><h2>What's in each plan</h2></div>
  <div class="tablewrap"><table class="compare">
    <thead><tr><th></th><th>Free</th><th>Launch</th><th>Grow</th><th>Signature</th></tr></thead>
    <tbody>
      <tr><td>First year</td><td>$0</td><td>$399 ($299 holiday)</td><td>$549 ($399 holiday)</td><td>$699 ($499 holiday)</td></tr>
      <tr><td>Renews at</td><td>Free</td><td>$199 a year</td><td>$249 a year</td><td>$299 a year</td></tr>
      <tr><td>Estimates, contracts, invoices</td><td>Yes</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>Painter directory listing</td><td>Yes</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>Website address registered for you</td><td>&ndash;</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>Hosted website</td><td>&ndash;</td><td>5 pages, 3 services</td><td>More pages and services</td><td>Most pages and services</td></tr>
      <tr><td>Instant quote and AI chat on your site</td><td>&ndash;</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>Custom premium templates</td><td>&ndash;</td><td>&ndash;</td><td>&ndash;</td><td>Yes</td></tr>
      <tr><td>Pro AI credits and monthly allowance choice</td><td>&ndash;</td><td>&ndash;</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>AI credits at sign-up</td><td>250 (expire in 60 days)</td><td>250 + 500</td><td>250 + 500</td><td>250 + 500</td></tr>
    </tbody>
  </table></div>
  <p class="fine">During Booked by Spring the 500 sign-up credits become 1,000. Sign-up credits expire after 90 days. Top-up credits you buy don't expire during early access.</p>
</div></section>
<section class="block"><div class="wrap">
  <div class="head"><h2>AI credits, only when you want them</h2></div>
  <div class="grid3">
    <div class="card"><h3>Welcome credits</h3><p>Every account starts with 250 credits to try the AI tools.</p></div>
    <div class="card"><h3>Monthly allowance</h3><p>$19 for 150 credits, $39 for 400, or $79 for 1,000 a month. Unused credits roll over for two months. Stop any time.</p></div>
    <div class="card"><h3>One-time top-up</h3><p>$5, $10, $20, $50 or $100, on any plan, Free included. Bigger top-ups get a better rate.</p></div>
  </div>
</div></section>
<section class="block"><div class="wrap"><div class="head"><h2>Questions we hear a lot</h2></div>${faq}</div></section>
<section class="final">
  <img src="/img/home-exterior-1400.webp" srcset="/img/home-exterior-800.webp 800w, /img/home-exterior-1400.webp 1400w" sizes="100vw" width="1400" height="788" loading="lazy" alt="">
  <div class="wrap"><span class="kicker">Not sure yet?</span><h2>Start free. Move up when you're ready.</h2><div class="ctas">${startFree}<a class="btn btn-line light" href="mailto:support@paintersmax.app">Email us a question</a></div></div>
</section>`,
});

// ---------- how it works ----------

page({
  file: "how-it-works.html",
  path: "/how-it-works",
  active: "/how-it-works",
  title: "How it works | PaintersMax",
  desc: "From sign-up to your first estimate: set up your business once, share your quote page, then send estimates, get contracts signed and invoice by milestone.",
  body: `
<section class="page-hero"><div class="wrap">
  <span class="kicker">How it works</span>
  <h1>Set it up once. <em>Use it on every job.</em></h1>
  <p class="lead">Here's the whole thing, start to finish, in the order you'll do it.</p>
</div></section>
<section class="block tight"><div class="wrap prose">
  <h2>1. Start free</h2>
  <p>Make your account with your email. There's no password to remember. We email you a sign-in link, or you can sign in with Google. No card needed.</p>
  <h2>2. Set up your business (seven short steps)</h2>
  <p>Your company info, the services you offer, the cities you serve, your prices, your labor and money settings, your warranty and insurance, and a quick review. Everything saves as you go, so you can stop and come back.</p>
  <p>For prices, you pick a starting level for each service: Value, Standard, Premium or Master. Then you change any number to match your own costs. The starting prices are ranges to review, not promises.</p>
  <h2>3. Share your quote page</h2>
  <p>Your quote page and chat take a customer's details and photos at any hour. The lead lands in your account and your email, so it's waiting for you in the morning.</p>
  <h2>4. Make the estimate</h2>
  <p>Open the job, tell it about the work (type it, or tap the mic and talk), add photos, and tap Create estimate. The AI drafts the scope and works out quantities. Your own price list sets the prices. You check it, change anything you want, and preview what your customer will see.</p>
  <h2>5. Get it signed</h2>
  <p>Send the estimate or contract by email. Your customer signs on their phone from a private link, and you both get the signed copy.</p>
  <h2>6. Run the job</h2>
  <p>Put it on the calendar, assign the crew, and print the materials list and instructions in English or Spanish. If the customer wants extra work, make a change order so the price stays right.</p>
  <h2>7. Get paid</h2>
  <p>Invoice by milestone: deposit, progress and final. Turn on friendly reminders if you like. When the work is done, ask the customer to accept it and send a warranty letter.</p>
  <div class="callout">Nothing goes to your customers until you send it. AI drafts are drafts: read them, fix them, then send.</div>
  <p>${startFree} <a class="btn btn-line" href="/instant-quote">Try an instant quote first</a></p>
</div></section>`,
});

// ---------- why ----------

page({
  file: "why-paintersmax.html",
  path: "/why-paintersmax",
  active: "/why-paintersmax",
  title: "Why PaintersMax | Built by a painter",
  desc: "Why PaintersMax exists, and the promises we make: no made-up reviews, labeled AI previews, your data is yours, and we never contact your customers without your say-so.",
  body: `
<section class="page-hero"><div class="wrap">
  <span class="kicker">Why PaintersMax</span>
  <h1>Built by a painter. <em>Not a software company.</em></h1>
  <p class="lead">Most contractor software was made by people who never had to chase a deposit, explain a change order or find out the crew showed up without the right color.</p>
</div></section>
<section class="block tight"><div class="wrap prose">
  <p>PaintersMax is built around how a job really goes: the phone call, the walkthrough, the estimate, the signature, the crew, the extra closet the customer adds on day two, and the final check. It's made to be fast on a phone, in English and in Spanish, because that's how crews really work.</p>
  <h2>What we promise</h2>
  <ul>
    <li><b>We don't make things up.</b> No invented reviews, no fake numbers, no pretend before-and-after photos. AI pictures are always labeled previews, and a preview isn't a paint match.</li>
    <li><b>We never contact your customers on our own.</b> They hear from you, when you choose to send something.</li>
    <li><b>Your data is yours.</b> You can download your records any time your account is open.</li>
    <li><b>AI that can't run away with your bill.</b> Every AI tool has limits per visit, per day and per plan, and we can switch any tool off at once. See it in action on the <a href="/color-studio">Color Studio</a>.</li>
    <li><b>Honest about the legal stuff.</b> Records are for your accountant, not tax advice. Contracts are templates for you and your attorney to shape. Insurance notes are general information.</li>
  </ul>
  <h2>Who's behind it</h2>
  <p>PaintersMax is a product of AgentFlow LLC. Questions, ideas or something broken? Write to <a href="mailto:support@paintersmax.app">support@paintersmax.app</a>. A person reads it.</p>
  <p>${startFree}</p>
</div></section>`,
});

// ---------- instant quote ----------

page({
  file: "instant-quote.html",
  path: "/instant-quote",
  active: "/instant-quote",
  title: "Instant painting quote | PaintersMax",
  desc: "Try the instant quote that PaintersMax puts on a painter's website: pick a kind of job, answer a few questions and see a price range in seconds.",
  script: `<script>
(function () {
  var forms = {
    interior: [['bedrooms','Bedrooms (12 x 12)',2],['living','Living or family rooms',1],['suites','Primary suites with bath',0],['foyers','Two-story foyers or stairwells',0],['doors','Interior doors and frames',0]],
    exterior: [['siding','Surface','select:wood=Wood or fiber cement siding|vinyl=Vinyl or aluminum siding|stucco=Stucco|brick=Brick'],['wallSqft','Wall area (square feet)',1800],['entryDoors','Entry doors',1],['garageDoors','Garage doors',1],['shutters','Pairs of shutters',0]],
    cabinets: [['doors','Cabinet doors',20],['drawers','Drawer fronts',8]],
    deck: [['deckSqft','Deck area (square feet)',300],['railingFt','Railing (linear feet)',0],['fenceFt','Fence, one side (linear feet)',150]],
    wash: [['houseSqft','House floor area (square feet)',2000],['flatSqft','Driveway, walks and patio (square feet)',0]]
  };
  var tabs = document.getElementById('tabs'), fields = document.getElementById('fields'), form = document.getElementById('qf'), res = document.getElementById('res'), kind = 'interior';
  var names = { interior: 'Inside the house', exterior: 'Outside the house', cabinets: 'Cabinets', deck: 'Deck and fence', wash: 'Pressure washing' };
  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }
  function draw() {
    fields.innerHTML = '';
    forms[kind].forEach(function (f) {
      var id = 'f_' + f[0], lab = document.createElement('label');
      lab.htmlFor = id; lab.textContent = f[1];
      var el;
      if (String(f[2]).indexOf('select:') === 0) {
        el = document.createElement('select');
        f[2].slice(7).split('|').forEach(function (o) { var p = o.split('='); var op = document.createElement('option'); op.value = p[0]; op.textContent = p[1]; el.appendChild(op); });
      } else { el = document.createElement('input'); el.type = 'number'; el.min = '0'; el.inputMode = 'numeric'; el.value = f[2]; }
      el.id = id; el.name = f[0];
      fields.appendChild(lab); fields.appendChild(el);
    });
  }
  Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) {
    b.onclick = function () { kind = b.dataset.k; Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); }); draw(); };
  });
  draw();
  form.onsubmit = function (e) {
    e.preventDefault();
    var body = { kind: kind };
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name) body[el.name] = el.value; });
    res.innerHTML = '<p class="sub">Working it out...</p>';
    fetch('/api/demo/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (o) {
        if (o.j && o.j.limited) { res.innerHTML = window.pmDemo ? window.pmDemo.limitCard('ip') : 'Too many tries today.'; return; }
        if (!o.r.ok) { res.innerHTML = '<div class="err">' + (o.j.error || 'Something went wrong.') + '</div>'; return; }
        var q = o.j, h = '<h3>' + names[kind] + '</h3><div class="range">' + money(q.low) + ' to ' + money(q.high) + '</div><div class="sub">Most jobs like this land near ' + money(q.likely) + '.</div><ul>';
        q.lines.forEach(function (l) { h += '<li><span>' + l.label + ' &times; ' + l.qty + '</span><span>' + money(l.low) + ' to ' + money(l.high) + '</span></li>'; });
        h += '</ul><p class="fine2">This is a ballpark from sample starting prices. A real painter on PaintersMax uses their own prices, then confirms after seeing the job.</p><button type="button" class="btn btn-orange arrow" id="more">What happens next?</button>';
        res.innerHTML = h;
        document.getElementById('more').onclick = function () {
          var intro = 'Nice. That ' + money(q.low) + ' to ' + money(q.high) + ' range is what your customer would see in a few seconds on your website. Want to see what happens next?';
          if (window.pmDemo) window.pmDemo.open(window.pmDemo.lang() === 'es' ? 'Listo. Ese rango de ' + money(q.low) + ' a ' + money(q.high) + ' es lo que vería tu cliente en segundos en tu sitio. ¿Quieres ver qué sigue?' : intro);
        };
        if (window.pmDemo && !window.__pmOpened) { window.__pmOpened = true; setTimeout(function () { window.pmDemo.open(window.pmDemo.lang() === 'es' ? 'Tu cotización está lista. Pregúntame lo que quieras sobre cómo funciona.' : 'Your quote is ready. Ask me anything about how this works for a painter.'); }, 900); }
      })
      .catch(function () { res.innerHTML = '<div class="err">Something went wrong. Please try again.</div>'; });
  };
})();
</script>`,
  body: `
<section class="page-hero"><div class="wrap">
  <span class="kicker">Instant quote</span>
  <h1>A price range in seconds, <em>even at 9 at night.</em></h1>
  <p class="lead">This is the quote tool that goes on a painter's website. Pick a kind of job, answer a few questions and see what a homeowner would see. These are sample prices, so don't plan a budget around them.</p>
</div></section>
<section class="block tight"><div class="wrap qgrid">
  <div>
    <div class="tabs" id="tabs" role="tablist" aria-label="Kind of job">
      <button type="button" role="tab" data-k="interior" aria-selected="true">Inside</button>
      <button type="button" role="tab" data-k="exterior" aria-selected="false">Outside</button>
      <button type="button" role="tab" data-k="cabinets" aria-selected="false">Cabinets</button>
      <button type="button" role="tab" data-k="deck" aria-selected="false">Deck and fence</button>
      <button type="button" role="tab" data-k="wash" aria-selected="false">Pressure washing</button>
    </div>
    <form class="qform card" id="qf"><div id="fields"></div><button type="submit" class="btn btn-orange arrow">Get my quote</button></form>
  </div>
  <div class="qresult" id="res" aria-live="polite"><h3>Your quote shows up here</h3><p class="sub">Fill in the form and tap Get my quote. After that, BP, our chat helper, will pop up to answer questions.</p></div>
</div></section>
<section class="block"><div class="wrap grid2">
  <div class="card"><h3>On your own website</h3><p>On a PaintersMax site, this tool uses your prices and sends you the lead, with the customer's details and photos, as soon as they finish.</p><a class="btn btn-line arrow" href="/pricing">See the plans</a></div>
  <div class="card"><h3>Want to see the AI do more?</h3><p>The Color Studio lets you change a room's color with one tap.</p><a class="btn btn-orange arrow" href="/color-studio">Try the Color Studio</a></div>
</div></section>`,
});

// ---------- color studio ----------

page({
  file: "color-studio.html",
  path: "/color-studio",
  active: "/color-studio",
  title: "Color Studio: see a color before you paint | PaintersMax",
  desc: "Try the PaintersMax Color Studio: pick a color and watch a room or a house change. AI pictures are labeled previews, so test a sample first.",
  script: `<script>
(function () {
  var SW = [['Soft white','#F4F1EA'],['Warm white','#EFE7D8'],['Cream','#EADFC4'],['Light greige','#D8D0C2'],['Greige','#BDB3A3'],['Warm beige','#CDB99C'],['Light gray','#D5D7D6'],['Medium gray','#A3A7A8'],['Charcoal','#4A4D50'],['Soft black','#2B2B2D'],['Pale blue','#C9DAE4'],['Slate blue','#6F879A'],['Navy','#263A53'],['Sage green','#A9B59B'],['Olive green','#6F7550'],['Forest green','#33483A'],['Butter yellow','#EFD98F'],['Terracotta','#B9694A'],['Barn red','#7C2D26'],['Chocolate brown','#4E382C']];
  var SAMPLES = { interior: '/img/interior-crew-800.webp', exterior: '/img/home-exterior-800.webp' };
  var SURF = [['walls','Interior walls'],['ceiling','Ceiling'],['trim','Trim'],['cabinets','Cabinets'],['doors','Doors'],['front_door','Front door'],['siding','Exterior siding'],['ext_trim','Exterior trim'],['garage','Garage door'],['fence','Fence']];
  var stage = document.getElementById('stage'), img = document.getElementById('img'), badge = document.getElementById('badge'), wait = document.getElementById('wait'), err = document.getElementById('err'), sw = document.getElementById('sw');
  var mode = 'interior', own = null, busy = false, hex = '', original = SAMPLES.interior;
  var surf = document.getElementById('surf');
  SURF.forEach(function (s) { var o = document.createElement('option'); o.value = s[0]; o.textContent = s[1]; surf.appendChild(o); });
  SW.forEach(function (s) { var b = document.createElement('button'); b.type = 'button'; b.style.background = s[1]; b.title = s[0]; b.setAttribute('aria-label', s[0]); b.setAttribute('aria-pressed', 'false'); b.onclick = function () { choose(b, s[1]); }; sw.appendChild(b); });
  function pressed(el) { Array.prototype.forEach.call(el.parentNode.children, function (x) { x.setAttribute('aria-pressed', x === el ? 'true' : 'false'); }); }
  Array.prototype.forEach.call(document.querySelectorAll('[data-s]'), function (b) { b.onclick = function () { mode = b.dataset.s; own = null; original = SAMPLES[mode]; img.src = original; badge.textContent = 'Original photo'; hex = ''; sw.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); err.textContent = ''; document.getElementById('ownrow').hidden = true; pressed(b); removeCard(); }; });
  function removeCard() { var c = stage.querySelector('.limitcard'); if (c) c.remove(); }
  function choose(b, h) { pressed(b); hex = h; run(); }
  function setBusy(on) { busy = on; wait.classList.toggle('on', on); }
  function run() {
    if (busy || !hex) return;
    err.textContent = ''; removeCard();
    var body = { browserId: window.pmDemo ? window.pmDemo.bid() : '', hex: hex };
    if (mode === 'own') { if (!own) { err.textContent = 'Choose a photo first.'; return; } body.image = own; body.surface = surf.value; } else { body.sample = mode; }
    setBusy(true);
    fetch('/api/demo/color', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (o) {
        if (o.j && o.j.limited) { var d = document.createElement('div'); d.innerHTML = window.pmDemo ? window.pmDemo.limitCard(o.j.scope) : ''; if (d.firstChild) stage.appendChild(d.firstChild); return; }
        if (!o.r.ok) { err.textContent = o.j.error || 'Something went wrong.'; return; }
        img.src = o.j.image; badge.textContent = 'AI preview, not a paint match';
      })
      .catch(function () { err.textContent = 'Something went wrong. Please try again.'; })
      .then(function () { setBusy(false); });
  }
  document.getElementById('ownbtn').onclick = function () { document.getElementById('file').click(); };
  document.getElementById('file').onchange = function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var im = new Image();
      im.onload = function () {
        var s = Math.min(1, 1100 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        own = c.toDataURL('image/jpeg', 0.85); mode = 'own'; img.src = own; badge.textContent = 'Your photo'; hex = '';
        sw.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        document.getElementById('ownrow').hidden = false; removeCard();
        Array.prototype.forEach.call(document.querySelectorAll('[data-s]'), function (x) { x.setAttribute('aria-pressed', 'false'); });
      };
      im.onerror = function () { err.textContent = 'That file did not open as a photo.'; };
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
  };
})();
</script>`,
  body: `
<section class="page-hero"><div class="wrap">
  <span class="kicker">Color Studio</span>
  <h1>See the color <em>before the first coat.</em></h1>
  <p class="lead">Pick a sample room or house, tap a color and watch it change. Painters use this to help customers say yes. You get a few free tries here, so make them count.</p>
</div></section>
<section class="block tight"><div class="wrap cs-grid">
  <div>
    <div class="cs-stage" id="stage">
      <img id="img" src="/img/interior-crew-800.webp" alt="Sample photo to repaint" width="800" height="600">
      <div class="cs-badge" id="badge">Original photo</div>
      <div class="cs-wait" id="wait" role="status">Mixing your color... this takes about 20 seconds.</div>
    </div>
    <div class="err" id="err" role="alert"></div>
    <p class="cs-note">AI pictures are previews, not a paint match. Screens and light change how a color looks, so test a sample on the wall and check the color with the paint store.</p>
  </div>
  <div class="card">
    <h3>1. Pick a photo</h3>
    <div class="pick">
      <button type="button" data-s="interior" aria-pressed="true">Sample room</button>
      <button type="button" data-s="exterior" aria-pressed="false">Sample house</button>
      <button type="button" class="linkbtn" id="ownbtn">Use my photo</button>
    </div>
    <input type="file" id="file" accept="image/jpeg,image/png,image/webp" hidden>
    <div id="ownrow" hidden><label for="surf" style="font-size:13px;font-weight:600">What should we paint?</label><select id="surf" style="width:100%;padding:11px;border:1.5px solid var(--line);font:inherit;margin-top:6px"></select><p class="cs-note">Your photo is sent to the AI to make the preview and is not saved.</p></div>
    <h3 style="margin-top:18px">2. Tap a color</h3>
    <div class="swatches" id="sw"></div>
    <p class="cs-note">Sample photos with our colors are quick and don't use up your tries once they've been made. A try is used each time the AI paints something new, and you get a few per visit.</p>
    <a class="btn btn-line arrow" href="/pricing" style="margin-top:10px">Put this on my website</a>
  </div>
</div></section>`,
});

// ---------- early access agreement ----------

function md(src) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
  const lines = src.split("\n");
  let html = "";
  let list = false;
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^- /.test(l)) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(l.slice(2))}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    if (/^# /.test(l)) html += `<h1>${inline(l.slice(2))}</h1>`;
    else if (/^## /.test(l)) html += `<h2>${inline(l.slice(3))}</h2>`;
    else if (l === "---" || l === "") continue;
    else html += `<p>${inline(l)}</p>`;
  }
  if (list) html += "</ul>";
  return html;
}
const agreement = md(readFileSync(join(root, "tools", "early-access-agreement.md"), "utf8"));
page({
  file: "early-access-agreement.html",
  path: "/early-access-agreement",
  active: "",
  demo: false,
  title: "Early Access Agreement | PaintersMax",
  desc: "The PaintersMax Early Access Agreement, version 2, November 15, 2026.",
  body: `<section class="block"><div class="wrap prose">${agreement.replace("<h1>", '<h1 style="font-size:clamp(34px,5vw,52px);margin-bottom:18px">')}<p><a href="/terms">Terms of Service</a> &middot; <a href="/privacy">Privacy Policy</a> &middot; <a href="/start">Back to sign-up</a></p></div></section>`,
});

console.log("built");

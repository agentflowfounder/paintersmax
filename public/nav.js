/* PaintersMax app navigation: ONE list of pages in 7 groups, shown the same way on every app page.
 * Blueprint 2026-11-28 (Rogelio: "organize what we have built, keep the client in mind").
 * Phone: a bar along the bottom (Home, Jobs, Calendar, Records, Menu). Menu opens the groups as a sheet.
 * Computer: the same four on a top bar, and Menu opens the groups side by side.
 * Add or rename a page here and every page changes. Pages keep their own tabs underneath.
 * Included at the end of <body> on each app page: <script src="/nav.js"></script>
 */
(function () {
  var T = window.pmT || function (s) { return s; };
  // The four pages a painter opens every day. They stay on the bar.
  var BAR = [['/dashboard', 'Home', 'home'], ['/jobs', 'Jobs', 'jobs'], ['/calendar', 'Calendar', 'cal'], ['/records', 'Records', 'money']];
  // Every page has exactly one home. [path, label, also-highlight-on paths]
  var GROUPS = [
    { name: 'Home', hint: 'Leads, signatures and what needs you today', links: [['/dashboard', 'Home']] },
    { name: 'Work', hint: 'Jobs, crew and trucks', links: [['/jobs', 'Jobs'], ['/calendar', 'Calendar'], ['/reminders', 'Reminders'], ['/crew', 'Crew'], ['/vehicles', 'Trucks and vehicles']] },
    { name: 'Estimates and prices', hint: 'Your prices, rate sheets and paint costs', links: [['/app', 'My prices'], ['/builders', 'Builder rates'], ['/materials', 'Materials and tools'], ['/vendors', 'Paint stores and prices']] },
    { name: 'Money', hint: 'Expenses, mileage and how the business is doing', links: [['/records', 'Records'], ['/pulse', 'Business health', ['/analysis']]] },
    { name: 'Marketing', hint: 'Get found and win more work', links: [['/site', 'My website', ['/device-preview']], ['/citypages', 'City pages'], ['/brand', 'Brand kit and campaigns'], ['/import', 'Import customers']] },
    { name: 'Studio', hint: 'AI tools for colors, logos and pictures', links: [['/ai-studio', 'AI Studio'], ['/colors', 'Color preview'], ['/logo-studio', 'Logo studio']] },
    { name: 'My business', hint: 'Your profile, insurance and plan', links: [['/dashboard#settings', 'Business profile'], ['/insurance', 'Insurance', ['/insurance-guide']], ['/grow', 'Grow your business'], ['/credits', 'Plan and AI credits']] },
  ];
  var HELP = [['/help', 'Help'], ['/lessons', 'Lessons'], ['/feedback', 'Feedback']];
  var ICON = {
    home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
    jobs: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5h6v2"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    money: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>'; };

  function go() {
    if (document.getElementById('pm_nav')) return;
    var header = document.querySelector('header');
    if (!header) return;
    // The old per-page link lists go away; the page name and any buttons (like Sign out) stay.
    [].forEach.call(header.querySelectorAll('a[href^="/"]'), function (a) { a.remove(); });
    var path = location.pathname.replace(/\/$/, '') || '/';
    if (path === '/index.html') path = '/';
    var here = function (l) { var p = l[0].split('#')[0]; if (l[0].indexOf('#') > 0) return false; return path === p || (l[2] || []).indexOf(path) >= 0; };
    var groupOn = function (g) { return g.links.some(here); };
    var st = document.createElement('style');
    st.textContent =
      '#pm_nav{background:#16263d;display:flex;align-items:center;gap:2px;padding:4px 10px;z-index:30;font-family:Inter,system-ui,sans-serif;position:sticky;top:0}' +
      '#pm_nav a,#pm_nav button{all:unset;box-sizing:border-box;cursor:pointer;color:#fff;font-size:14px;font-weight:600;padding:9px 12px;border-radius:8px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}' +
      '#pm_nav a:hover,#pm_nav button:hover{background:rgba(255,255,255,.12)}#pm_nav a.on,#pm_nav button.on{background:#E8A33D;color:#0F1B2D}' +
      '#pm_nav a:focus-visible,#pm_nav button:focus-visible,#pm_sheet a:focus-visible,#pm_sheet button:focus-visible{outline:2px solid #E8A33D;outline-offset:1px}' +
      '#pm_mb{margin-left:auto}' +
      '#pm_sheet{display:none;position:fixed;inset:0;z-index:950;background:rgba(15,27,45,.45);font-family:Inter,system-ui,sans-serif}#pm_sheet.open{display:block}' +
      '#pm_panel{background:#FBFAF7;color:#0F1B2D;margin:56px auto 0;max-width:1080px;border-radius:14px;box-shadow:0 12px 40px rgba(15,27,45,.35);padding:16px 18px 18px;max-height:calc(100vh - 80px);overflow:auto}' +
      '#pm_top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}#pm_top b{font-size:18px}' +
      '#pm_x{all:unset;cursor:pointer;font-size:15px;font-weight:700;padding:8px 12px;border-radius:8px;background:#eee9de}' +
      '#pm_groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}' +
      '.pmg{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:12px;padding:10px 10px 8px}.pmg.on{border-color:#E8A33D;box-shadow:0 0 0 2px rgba(232,163,61,.35)}' +
      '.pmg h3{margin:2px 4px 0;font-size:15px}.pmg p{margin:2px 4px 6px;font-size:12.5px;color:#5b6473}' +
      '.pmg a{display:block;color:#0F1B2D;text-decoration:none;font-size:15px;font-weight:600;padding:10px 8px;border-radius:8px}.pmg a:hover{background:#f1efe9}.pmg a.on{background:#E8A33D}' +
      '#pm_help{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(15,27,45,.1)}#pm_help a{color:#0F1B2D;font-size:14px;font-weight:600;padding:8px 12px;border-radius:999px;background:#eee9de;text-decoration:none}#pm_help a.on{background:#E8A33D}' +
      '@media(max-width:700px){' +
      '#pm_nav{position:fixed;top:auto;bottom:0;left:0;right:0;padding:4px 4px calc(4px + env(safe-area-inset-bottom));justify-content:space-around;box-shadow:0 -4px 16px rgba(15,27,45,.2)}' +
      '#pm_nav a,#pm_nav button{flex:1;flex-direction:column;gap:2px;font-size:11.5px;padding:6px 2px;justify-content:center;text-align:center}#pm_mb{margin-left:0}' +
      'body{padding-bottom:calc(70px + env(safe-area-inset-bottom))!important}' +
      '#pm_ask{bottom:calc(78px + env(safe-area-inset-bottom))!important}' +
      '#pm_panel{margin:0;position:absolute;left:0;right:0;bottom:0;border-radius:16px 16px 0 0;max-height:88vh;padding:14px 14px calc(18px + env(safe-area-inset-bottom))}' +
      '#pm_groups{grid-template-columns:1fr;gap:10px}}';
    document.head.appendChild(st);

    var a = function (l, cls) { var on = here(l); return '<a href="' + l[0] + '"' + (on || cls ? ' class="' + (on ? 'on' : '') + '"' : '') + (on ? ' aria-current="page"' : '') + '>' + T(l[1]) + '</a>'; };
    var nav = document.createElement('nav');
    nav.id = 'pm_nav';
    nav.setAttribute('aria-label', T('Main menu'));
    var barOn = BAR.some(function (b) { return here(b); });
    nav.innerHTML = BAR.map(function (b) { var on = here(b); return '<a href="' + b[0] + '"' + (on ? ' class="on" aria-current="page"' : '') + '>' + svg(b[2]) + '<span>' + T(b[1]) + '</span></a>'; }).join('') +
      '<button type="button" id="pm_mb" aria-haspopup="dialog" aria-expanded="false" aria-controls="pm_sheet"' + (barOn ? '' : ' class="on"') + '>' + svg('menu') + '<span>' + T('Menu') + '</span></button>';
    header.parentNode.insertBefore(nav, header.nextSibling);

    var sheet = document.createElement('div');
    sheet.id = 'pm_sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', T('Menu'));
    sheet.innerHTML = '<div id="pm_panel"><div id="pm_top"><b>' + T('Menu') + '</b><button type="button" id="pm_x">' + T('Close') + '</button></div><div id="pm_groups">' +
      GROUPS.map(function (g) { return '<section class="pmg' + (groupOn(g) ? ' on' : '') + '"><h3>' + T(g.name) + '</h3><p>' + T(g.hint) + '</p>' + g.links.map(function (l) { return a(l); }).join('') + '</section>'; }).join('') +
      '</div><div id="pm_help" aria-label="' + T('Help corner') + '">' + HELP.map(function (l) { return a(l); }).join('') + '</div></div>';
    document.body.appendChild(sheet);

    // The browser tab icon, the voice recorder and the Ask button come with the menu, so every app page has them.
    if (!document.querySelector('link[rel~="icon"]')) { var ic = document.createElement('link'); ic.rel = 'icon'; ic.type = 'image/svg+xml'; ic.href = '/favicon.svg'; document.head.appendChild(ic); }
    ['/voice.js', '/livevoice.js', '/ask.js', '/logo-apply.js'].forEach(function (src) {
      if (document.querySelector('script[src="' + src + '"]')) return;
      var sc = document.createElement('script'); sc.src = src; sc.async = false; document.body.appendChild(sc);
    });
    // Admin logins get an Admin link in the Help corner (everyone else never sees it).
    fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) {
      if (u && u.admin) { var m = document.getElementById('pm_help'); if (m) m.insertAdjacentHTML('beforeend', a(['/admin', 'Admin'])); }
      // Pages that open fully on Contractor and Commercial get a small plan tag for Free and Local Pro. They stay open to read about.
      if (u && (u.plan === 'free' || u.plan === 'starter')) {
        [].forEach.call(document.querySelectorAll('#pm_sheet a[href="/lessons"]'), function (el) { el.insertAdjacentHTML('beforeend', ' <span class="pmtag">' + T('Contractor') + '</span>'); });
      }
    }).catch(function () {});

    var btn = document.getElementById('pm_mb');
    var open = function () { sheet.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); var f = sheet.querySelector('.pmg.on a.on') || sheet.querySelector('#pm_x'); if (f) f.focus(); };
    var close = function () { sheet.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', function () { if (sheet.classList.contains('open')) close(); else open(); });
    document.getElementById('pm_x').addEventListener('click', close);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); if (e.target.closest && e.target.closest('a')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();

/* PaintersMax app navigation: ONE list of pages, shown the same way on every app page.
 * Add or rename a page here and every page changes. Pages keep their own tabs underneath.
 * Included at the end of <body> on each app page: <script src="/nav.js"></script>
 */
(function () {
  var T = window.pmT || function (s) { return s; };
  var MAIN = [
    ['/dashboard', 'Home'], ['/jobs', 'Jobs'], ['/calendar', 'Calendar'], ['/crew', 'Crew'],
    ['/records', 'Records'], ['/analysis', 'Analysis'], ['/lessons', 'Lessons'],
  ];
  var MORE = [
    ['/pulse', 'Business pulse'], ['/reminders', 'Reminders'], ['/vehicles', 'Vehicles'], ['/colors', 'Color preview'], ['/credits', 'AI use and credits'], ['/app', 'Estimating Setup'], ['/builders', 'Builder rates'], ['/citypages', 'City pages'], ['/import', 'Import customers'],
    ['/materials', 'Materials'], ['/insurance', 'Insurance'], ['/insurance-guide', 'Insurance guide'], ['/brand', 'Brand kit'], ['/help', 'Help'],
  ];
  function go() {
    if (document.getElementById('pm_nav')) return;
    var header = document.querySelector('header');
    if (!header) return;
    // The old per-page link lists go away; the page name and any buttons (like Sign out) stay.
    [].forEach.call(header.querySelectorAll('a[href^="/"]'), function (a) { a.remove(); });
    var path = location.pathname.replace(/\/$/, '') || '/';
    if (path === '/index.html') path = '/';
    var here = function (h) { return path === h; };
    var st = document.createElement('style');
    st.textContent = '#pm_nav{background:#16263d;display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:4px 10px;z-index:30;font-family:Inter,system-ui,sans-serif}' +
      '#pm_nav a,#pm_nav button.pmn{all:unset;box-sizing:border-box;cursor:pointer;color:#fff;font-size:14px;font-weight:600;padding:9px 11px;border-radius:8px;white-space:nowrap}' +
      '#pm_nav a:hover,#pm_nav button.pmn:hover{background:rgba(255,255,255,.12)}#pm_nav a.on{background:#E8A33D;color:#0F1B2D}' +
      '#pm_nav a:focus-visible,#pm_nav button.pmn:focus-visible{outline:2px solid #E8A33D;outline-offset:1px}' +
      '#pm_more{position:relative}#pm_menu{display:none;position:absolute;right:0;top:100%;background:#fff;border:1px solid rgba(15,27,45,.15);border-radius:10px;box-shadow:0 8px 24px rgba(15,27,45,.2);min-width:210px;padding:6px;z-index:40}' +
      '#pm_menu.open{display:block}#pm_menu a{display:block;color:#0F1B2D;padding:10px 12px}#pm_menu a:hover{background:#f1efe9}#pm_menu a.on{background:#E8A33D}' +
      '@media(min-width:701px){#pm_nav{position:sticky;top:0}}@media(max-width:700px){#pm_nav{padding:4px 6px}#pm_nav a,#pm_nav button.pmn{padding:8px 9px;font-size:13px}#pm_more{margin-left:auto}}';
    document.head.appendChild(st);
    var nav = document.createElement('nav');
    nav.id = 'pm_nav';
    nav.setAttribute('aria-label', T('Main menu'));
    var link = function (p) { return '<a href="' + p[0] + '"' + (here(p[0]) ? ' class="on" aria-current="page"' : '') + '>' + T(p[1]) + '</a>'; };
    var moreOn = MORE.some(function (p) { return here(p[0]); });
    nav.innerHTML = MAIN.map(link).join('') +
      '<span id="pm_more"><button type="button" class="pmn" id="pm_mb" aria-haspopup="true" aria-expanded="false"' + (moreOn ? ' style="background:#E8A33D;color:#0F1B2D"' : '') + '>' + T('More') + ' &#9662;</button><div id="pm_menu" role="menu">' + MORE.map(link).join('') + '</div></span>';
    header.parentNode.insertBefore(nav, header.nextSibling);
    var btn = document.getElementById('pm_mb'), menu = document.getElementById('pm_menu');
    var close = function () { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', function (e) { e.stopPropagation(); var o = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', String(o)); });
    document.addEventListener('click', function (e) { if (!menu.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();

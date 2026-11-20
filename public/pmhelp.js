/* Help icons (?) for forms. PMHELP.register({key:{t:'what it does',s:'Section name',g:'guide-anchor'}}),
 * PMHELP.icon(key) returns the button HTML, PMHELP.attach(el,key) adds one after an element.
 * Hover or tap the (?) for the description and a "How to use <section>" link to /marketing-guide#<anchor>. */
(function () {
  var D = {}, pop = null, pinned = null, base = '/marketing-guide';
  var css = document.createElement('style');
  css.textContent = '.pmq{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:6px;border-radius:50%;background:#e4e9f0;color:#0F1B2D;font:700 12px/1 system-ui,sans-serif;cursor:help;vertical-align:middle;flex:none}.pmq:hover,.pmq:focus-visible{background:#E8A33D}.pmq:focus-visible{outline:2px solid #0F1B2D;outline-offset:1px}' +
    '#pmq_pop{position:absolute;z-index:1000;max-width:320px;background:#fff;color:#0F1B2D;border:1px solid #cfd5dc;border-radius:10px;box-shadow:0 8px 28px rgba(15,27,45,.22);padding:12px 14px;font:14px/1.45 system-ui,sans-serif;display:none}#pmq_pop b{display:block;margin-bottom:4px}#pmq_pop p{margin:0 0 8px}#pmq_pop a{color:#0a58ca;font-weight:600}';
  document.head.appendChild(css);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function show(btn, pin) {
    var d = D[btn.getAttribute('data-q')];
    if (!d) return;
    if (!pop) { pop = document.createElement('div'); pop.id = 'pmq_pop'; pop.setAttribute('role', 'tooltip'); document.body.appendChild(pop); }
    pop.innerHTML = '<p>' + esc(d.t) + '</p>' + (d.g ? '<a href="' + esc((d.u || base) + '#' + d.g) + '" target="_blank" rel="noopener">How to use ' + esc(d.s || 'this section') + '</a>' : '');
    pop.style.display = 'block';
    var r = btn.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(window.scrollX + r.left - 10, window.scrollX + document.documentElement.clientWidth - w - 8)) + 'px';
    pinned = pin ? btn : null;
  }
  function hide() { if (pop) pop.style.display = 'none'; pinned = null; }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.pmq');
    if (b) { e.preventDefault(); e.stopPropagation(); if (pinned === b) hide(); else show(b, true); return; }
    if (pop && !pop.contains(e.target)) hide();
  });
  document.addEventListener('mouseover', function (e) { var b = e.target.closest && e.target.closest('.pmq'); if (b && !pinned) show(b, false); });
  document.addEventListener('mouseout', function (e) { var b = e.target.closest && e.target.closest('.pmq'); if (b && !pinned && !(e.relatedTarget && pop && pop.contains(e.relatedTarget))) hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  window.PMHELP = {
    register: function (d) { for (var k in d) D[k] = d[k]; },
    has: function (k) { return !!D[k]; },
    icon: function (k) { return D[k] ? '<button type="button" class="pmq" data-q="' + esc(k) + '" aria-label="Help: ' + esc(D[k].s || k) + '">?</button>' : ''; },
    attach: function (el, k) { if (!D[k] || el.querySelector('.pmq')) return; var s = document.createElement('span'); s.innerHTML = PMHELP.icon(k); el.appendChild(s.firstChild); }
  };
})();

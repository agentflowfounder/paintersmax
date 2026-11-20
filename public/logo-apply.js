/* Puts the company's chosen logo into the browser tab (and the PaintersMax pages' tab for the public site).
 * Add before </body>: <script src="/logo-apply.js"></script> for signed-in pages, or add data-public for public pages. */
(function () {
  var me = document.currentScript;
  var url = me && me.hasAttribute('data-public') ? '/api/logos/public' : '/api/logos/active';
  fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.logo) return;
    var l = document.querySelector('link[rel~="icon"]');
    if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); }
    l.type = 'image/png'; l.href = j.logo.icon;
    var bar = document.getElementById('pm_nav');
    if (bar && !document.getElementById('pm_logo')) {
      var im = document.createElement('img'); im.id = 'pm_logo'; im.src = j.logo.icon; im.alt = j.logo.name || '';
      im.style.cssText = 'width:26px;height:26px;border-radius:5px;margin:0 6px 0 2px;object-fit:contain;background:#fff';
      bar.insertBefore(im, bar.firstChild);
    }
  }).catch(function () {});
})();

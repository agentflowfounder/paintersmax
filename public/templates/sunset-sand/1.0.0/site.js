(function () {
  var D = document, R = D.documentElement;
  R.classList.add('js');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cfg = window.PM_SITE || {};

  // Header turns solid after a little scroll; the phone bar appears
  var hdr = D.querySelector('.hdr'), bar = D.querySelector('.callbar');
  function onScroll() {
    if (hdr) hdr.classList.toggle('solid', window.scrollY > 40);
    if (bar) bar.classList.toggle('show', window.scrollY > 320);
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Phone menu
  var drawer = D.getElementById('drawer'), openBtn = D.querySelector('[data-open-menu]'), closeBtn = D.querySelector('[data-close-menu]');
  function setMenu(open) {
    drawer.classList.toggle('open', open);
    openBtn.setAttribute('aria-expanded', open);
    D.body.style.overflow = open ? 'hidden' : '';
    (open ? closeBtn : openBtn).focus();
  }
  if (drawer && openBtn) {
    openBtn.addEventListener('click', function () { setMenu(true); });
    closeBtn.addEventListener('click', function () { setMenu(false); });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.classList.contains('open')) setMenu(false); });
  }

  // Services: tap or hover a service to swap the photo and text
  D.querySelectorAll('[data-swap]').forEach(function (box) {
    var btns = [].slice.call(box.querySelectorAll('[data-svc]')), panels = [].slice.call(box.querySelectorAll('[data-panel]'));
    function show(n) {
      btns.forEach(function (b, k) { b.setAttribute('aria-pressed', k === n); });
      panels.forEach(function (p, k) { p.hidden = k !== n; p.classList.toggle('on', k === n); });
    }
    btns.forEach(function (b, k) {
      b.addEventListener('click', function () { show(k); });
      b.addEventListener('mouseenter', function () { if (window.matchMedia('(hover:hover)').matches) show(k); });
      b.addEventListener('focus', function () { show(k); });
    });
  });

  // Tabs (arrow keys, Home, End)
  D.querySelectorAll('[data-tabs]').forEach(function (t) {
    var tabs = [].slice.call(t.querySelectorAll('[role=tab]')), panels = [].slice.call(t.querySelectorAll('[role=tabpanel]'));
    function show(n, focus) {
      tabs.forEach(function (b, k) { b.setAttribute('aria-selected', k === n); b.tabIndex = k === n ? 0 : -1; panels[k].hidden = k !== n; });
      if (focus) tabs[n].focus();
    }
    tabs.forEach(function (b, k) {
      b.addEventListener('click', function () { show(k); });
      b.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (k + 1) % tabs.length;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (k - 1 + tabs.length) % tabs.length;
        if (e.key === 'Home') n = 0; if (e.key === 'End') n = tabs.length - 1;
        if (n !== null) { e.preventDefault(); show(n, true); }
      });
    });
    var h = location.hash.slice(1), start = 0;
    tabs.forEach(function (b, k) { if (b.dataset.hash === h) start = k; });
    show(start);
  });
  window.addEventListener('hashchange', function () {
    var b = D.querySelector('[role=tab][data-hash="' + location.hash.slice(1) + '"]'); if (b) b.click();
  });

  // Reviews: one at a time with a counter and arrows
  D.querySelectorAll('.revs').forEach(function (rv) {
    var items = rv.querySelectorAll('.rev'); if (items.length < 2) return;
    var ctl = D.createElement('div'); ctl.className = 'rev-ctl';
    var lang = cfg.lang === 'es';
    ctl.innerHTML = '<button class="circle-btn" type="button" aria-label="' + (lang ? 'Anterior' : 'Previous') + '">&larr;</button><span aria-live="polite">01 / ' + String(items.length).padStart(2, '0') + '</span><button class="circle-btn" type="button" aria-label="' + (lang ? 'Siguiente' : 'Next') + '">&rarr;</button>';
    rv.parentNode.insertBefore(ctl, rv.nextSibling);
    var i = 0, label = ctl.querySelector('span'), b = ctl.querySelectorAll('button');
    function go(n) { i = (n + items.length) % items.length; rv.scrollTo({ left: items[i].offsetLeft - rv.offsetLeft, behavior: reduce ? 'auto' : 'smooth' }); label.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(items.length).padStart(2, '0'); }
    b[0].addEventListener('click', function () { go(i - 1); });
    b[1].addEventListener('click', function () { go(i + 1); });
  });

  // Selected work: filter by service, pick a project from the strip
  D.querySelectorAll('[data-work]').forEach(function (w) {
    var thumbs = [].slice.call(w.querySelectorAll('.wthumb')), panels = [].slice.call(w.querySelectorAll('[data-panel-p]')), tabs = [].slice.call(w.querySelectorAll('.wt'));
    if (!panels.length) return;
    function pick(n) {
      thumbs.forEach(function (b, k) { b.setAttribute('aria-pressed', k === n); });
      panels.forEach(function (p, k) { p.hidden = k !== n; });
    }
    thumbs.forEach(function (b, k) { b.addEventListener('click', function () { pick(k); }); });
    tabs.forEach(function (tb) {
      tb.addEventListener('click', function () {
        var f = tb.dataset.f, first = -1;
        tabs.forEach(function (x) { x.setAttribute('aria-pressed', x === tb); });
        thumbs.forEach(function (b, k) { var show = !f || b.dataset.service === f; b.hidden = !show; if (show && first < 0) first = k; });
        if (first >= 0) pick(first);
      });
    });
  });

  // Scroll reveal
  var els = D.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  } else { els.forEach(function (el) { el.classList.add('in'); }); }

  // Google Maps embed (browser key from the Worker; falls back to the drawn map)
  D.querySelectorAll('[data-map]').forEach(function (box) {
    var q = box.dataset.query || cfg.mapQuery || '';
    var fb = box.querySelector('.map-fallback'), note = box.querySelector('.map-note');
    function src(query) { return 'https://www.google.com/maps/embed/v1/place?key=' + encodeURIComponent(cfg.mapsKey) + '&q=' + encodeURIComponent(query) + '&zoom=11'; }
    var frame = null;
    if (cfg.mapsKey) {
      frame = D.createElement('iframe'); frame.loading = 'lazy'; frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.title = 'Map of ' + q; frame.src = src(q); box.insertBefore(frame, box.firstChild);
      if (fb) fb.hidden = true; if (note) note.hidden = true;
    }
    var sec = box.closest('section') || D;
    sec.querySelectorAll('.city-chips a').forEach(function (a) {
      a.addEventListener('click', function (e) {
        sec.querySelectorAll('.city-chips a').forEach(function (x) { x.removeAttribute('aria-current'); });
        a.setAttribute('aria-current', 'true');
        if (frame) { e.preventDefault(); frame.src = src(a.dataset.q); }
      });
    });
  });
})();

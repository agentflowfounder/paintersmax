(function () {
  var D = document, R = D.documentElement;
  R.classList.add('js');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cfg = window.PM_SITE || {};

  // Header turns solid after scroll
  var hdr = D.querySelector('.hdr');
  function onScroll() {
    if (hdr) hdr.classList.toggle('solid', window.scrollY > 40);
    var bar = D.querySelector('.callbar');
    if (bar) bar.classList.toggle('show', window.scrollY > 320);
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Mobile menu
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

  // Hero slider (4 slides)
  D.querySelectorAll('[data-hero]').forEach(function (hero) {
    var slides = hero.querySelectorAll('.slide'), dots = hero.querySelectorAll('.dot'), count = hero.querySelector('.count b');
    var i = 0, timer = null, ms = 6500;
    hero.style.setProperty('--slide-ms', ms + 'ms');
    function go(n) {
      slides[i].classList.remove('is-active'); slides[i].setAttribute('aria-hidden', 'true'); dots[i].removeAttribute('aria-current');
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('is-active'); slides[i].removeAttribute('aria-hidden'); dots[i].setAttribute('aria-current', 'true');
      if (count) count.textContent = String(i + 1).padStart(2, '0');
      restart();
    }
    function restart() { clearTimeout(timer); if (reduce || hero.classList.contains('paused')) return; timer = setTimeout(function () { go(i + 1); }, ms); }
    if (reduce) hero.classList.add('static');
    dots.forEach(function (d, n) { d.addEventListener('click', function () { go(n); }); });
    hero.querySelector('[data-prev]').addEventListener('click', function () { go(i - 1); });
    hero.querySelector('[data-next]').addEventListener('click', function () { go(i + 1); });
    function pause(p) { hero.classList.toggle('paused', p); if (p) clearTimeout(timer); else restart(); }
    hero.addEventListener('mouseenter', function () { pause(true); });
    hero.addEventListener('mouseleave', function () { pause(false); });
    hero.addEventListener('focusin', function () { pause(true); });
    hero.addEventListener('focusout', function () { pause(false); });
    var x0 = null;
    hero.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1); });
    restart();
  });

  // Tabs (arrow keys, Home, End)
  D.querySelectorAll('[data-tabs]').forEach(function (t, tn) {
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
  // Links like painting.html#cabinets open the matching tab
  window.addEventListener('hashchange', function () {
    var b = D.querySelector('[role=tab][data-hash="' + location.hash.slice(1) + '"]'); if (b) b.click();
  });

  // Rail arrows
  D.querySelectorAll('[data-rail-wrap]').forEach(function (w) {
    var rail = w.querySelector('.rail, .reviews-rail');
    w.querySelectorAll('[data-rail]').forEach(function (b) {
      b.addEventListener('click', function () { rail.scrollBy({ left: (b.dataset.rail === 'next' ? 1 : -1) * 280, behavior: reduce ? 'auto' : 'smooth' }); });
    });
  });

  // Scroll reveal
  var els = D.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  } else { els.forEach(function (el) { el.classList.add('in'); }); }

  // Count-up numbers
  D.querySelectorAll('.num').forEach(function (n) {
    var to = parseFloat(n.dataset.to), suf = n.dataset.suffix || '', pad = parseInt(n.dataset.pad || '0', 10);
    function fmt(v) { var s = String(Math.round(v)); while (s.length < pad) s = '0' + s; return s + suf; }
    n.textContent = fmt(to);
    if (reduce || !('IntersectionObserver' in window)) return;
    var o = new IntersectionObserver(function (en) {
      if (!en[0].isIntersecting) return; o.disconnect();
      var t0 = null; (function step(t) { if (!t0) t0 = t; var p = Math.min((t - t0) / 1400, 1); n.textContent = fmt(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(performance.now());
    }); o.observe(n);
  });

  // Copy Gemini prompt
  D.querySelectorAll('.ph-copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.parentNode.querySelector('.ph-prompt').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { var o = b.textContent; b.textContent = 'Copied'; setTimeout(function () { b.textContent = o; }, 1400); }, function () {});
    });
  });

  // Gallery chips
  var chips = D.querySelectorAll('[data-filter]');
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      var f = c.dataset.filter; chips.forEach(function (x) { x.setAttribute('aria-pressed', x === c); });
      D.querySelectorAll('.masonry figure').forEach(function (fig) { fig.hidden = !(f === 'all' || fig.dataset.cat === f); });
    });
  });

  // Project finder (selects)
  var finder = D.querySelector('[data-finder]');
  if (finder) {
    var sels = finder.querySelectorAll('select'), cards = finder.querySelectorAll('.prop'), empty = finder.querySelector('.empty');
    function apply() {
      var shown = 0;
      cards.forEach(function (c) {
        var ok = true; sels.forEach(function (s) { if (s.value && c.dataset[s.name] !== s.value) ok = false; });
        c.hidden = !ok; if (ok) shown++;
      });
      empty.classList.toggle('show', shown === 0);
    }
    sels.forEach(function (s) { s.addEventListener('change', apply); });
  }

  // Google Maps embed (needs a browser key restricted to your domain; falls back to the drawn map)
  D.querySelectorAll('[data-map]').forEach(function (box) {
    var q = box.dataset.query || cfg.mapQuery || 'Dallas, TX';
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

  // Video button
  D.querySelectorAll('[data-video]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (cfg.videoUrl) window.open(cfg.videoUrl, '_blank', 'noopener');
      else { var n = b.parentNode.querySelector('.vnote'); if (n) n.textContent = 'Add your video link in assets/config.js (videoUrl).'; }
    });
  });

  // Demo forms: nothing leaves the page
  D.querySelectorAll('[data-demo-form]').forEach(function (f) {
    f.addEventListener('submit', function (e) { e.preventDefault(); f.classList.add('sent'); var ok = f.querySelector('.form-ok, .ok'); if (ok) ok.focus(); });
  });

  var y = D.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
})();

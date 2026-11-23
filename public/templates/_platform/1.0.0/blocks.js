/* PaintersMax platform blocks: quote frame, Color Studio, before/after, lead forms. No libraries. */
(function () {
  var D = document;
  // Instant quote: the frame loads only when opened (keeps the page fast).
  D.querySelectorAll('.pm-iq-box').forEach(function (d) {
    d.addEventListener('toggle', function () { var f = d.querySelector('iframe[data-src]'); if (d.open && f && !f.src) f.src = f.dataset.src; });
  });
  // Color Studio: tap a swatch, the sample room's walls change.
  D.querySelectorAll('.pm-cs').forEach(function (s) {
    var room = s.querySelector('.pm-room'), nm = s.querySelector('[data-cs-name]'), hx = s.querySelector('[data-cs-hex]');
    var bs = [].slice.call(s.querySelectorAll('.pm-sw button'));
    function pick(b, focus) {
      bs.forEach(function (x) { x.setAttribute('aria-checked', x === b); x.tabIndex = x === b ? 0 : -1; });
      room.style.setProperty('--wall', b.dataset.hex); nm.textContent = b.textContent.trim(); hx.textContent = b.dataset.hex;
      if (focus) b.focus();
    }
    bs.forEach(function (b, i) {
      b.tabIndex = i ? -1 : 0;
      b.addEventListener('click', function () { pick(b); });
      b.addEventListener('keydown', function (e) {
        var n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : null;
        if (n !== null) { e.preventDefault(); pick(bs[(n + bs.length) % bs.length], true); }
      });
    });
  });
  // Before and after slider (the range input keeps it usable by keyboard and screen readers).
  D.querySelectorAll('.pm-ba').forEach(function (f) {
    var r = f.querySelector('input[type=range]');
    if (r) r.addEventListener('input', function () { f.style.setProperty('--pos', r.value + '%'); });
  });
  // Lead forms: sent to the painter's leads. Previews never send.
  D.querySelectorAll('form[data-lead]').forEach(function (f) {
    var msg = f.querySelector('.pm-form-msg');
    function say(t, ok) { if (!msg) return; msg.textContent = t; msg.className = 'pm-form-msg ' + (ok ? 'ok' : 'bad'); msg.focus(); }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };
      var name = (v('first') + ' ' + v('last')).trim(), email = v('email');
      var consent = f.elements.consent; var agreed = !consent || consent.type === 'hidden' || consent.checked;
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !agreed) { say(msg ? msg.dataset.err : 'Please check the form.', false); return; }
      if (v('website')) { f.reset(); say(msg.dataset.ok, true); return; }
      if (f.hasAttribute('data-preview')) { say((document.documentElement.lang === 'es' ? 'Vista previa: no se envió. ' : 'Preview: nothing was sent. ') + msg.dataset.ok, true); return; }
      var btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
      fetch(f.dataset.endpoint || '/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companySlug: f.dataset.company, name: name, email: email, phone: v('phone'), zip: v('zip'), details: v('details'), preferredDate: v('preferredDate'), preferredTime: v('preferredTime'), source: f.dataset.source || 'website' }) })
        .then(function (r) { if (!r.ok) throw 0; f.reset(); say(msg.dataset.ok, true); })
        .catch(function () { say(msg.dataset.err, false); })
        .then(function () { if (btn) btn.disabled = false; });
    });
  });
})();
/* Videos (tap to play, loads YouTube only on tap) and painting weather (loads when seen). */
(function () {
  var D = document;
  D.querySelectorAll('.pm-video[data-yt]').forEach(function (v) {
    var b = v.querySelector('.pm-video-play');
    if (!b) return;
    b.addEventListener('click', function () {
      var f = D.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + v.dataset.yt + '?rel=0&modestbranding=1&playsinline=1&autoplay=1';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true; f.title = b.getAttribute('aria-label') || 'Video';
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      v.innerHTML = ''; v.appendChild(f);
    });
  });
  function dayName(iso, lang) { var d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short' }); }
  function draw(box, f) {
    var lang = box.dataset.lang || 'en', out = box.querySelector('.pm-wx-days');
    out.innerHTML = '';
    f.days.forEach(function (d) {
      var li = D.createElement('div'); li.className = 'pm-wx-day ' + (d.good ? 'good' : 'poor');
      var why = d.good ? box.dataset.good : (lang === 'es' ? d.whyEs : d.why) || box.dataset.poor;
      li.innerHTML = '<b></b><span class="t"></span><span class="s"></span><em></em>';
      li.children[0].textContent = dayName(d.date, lang);
      li.children[1].textContent = d.hiF + '° / ' + d.loF + '°';
      li.children[2].textContent = d.rain + '% ' + box.dataset.rain + ' · ' + d.windMph + ' mph ' + box.dataset.wind;
      li.children[3].textContent = why;
      out.appendChild(li);
    });
  }
  function load(box) {
    fetch('/api/weather?place=' + encodeURIComponent(box.dataset.weather)).then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (f) { draw(box, f); }).catch(function () { box.hidden = true; });
  }
  var boxes = [].slice.call(D.querySelectorAll('.pm-wx[data-weather]'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }); }, { rootMargin: '200px' });
    boxes.forEach(function (b) { io.observe(b); });
  } else boxes.forEach(load);
})();

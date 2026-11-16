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
      fetch(f.dataset.endpoint || '/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companySlug: f.dataset.company, name: name, email: email, phone: v('phone'), zip: v('zip'), details: v('details'), source: f.dataset.source || 'website' }) })
        .then(function (r) { if (!r.ok) throw 0; f.reset(); say(msg.dataset.ok, true); })
        .catch(function () { say(msg.dataset.err, false); })
        .then(function () { if (btn) btn.disabled = false; });
    });
  });
})();

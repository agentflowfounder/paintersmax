/* PaintersMax public site, version 2: header, menu, reveals, hero video and the Ask BP demo chat.
 * Plain JavaScript, no libraries. Loops run only while on screen; reduced motion shows the final state. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  root.classList.remove('no-js');
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var es = window.PM_LANG === 'es';
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function whileVisible(el, on, off, threshold) {
    if (!el || !('IntersectionObserver' in window)) { if (el) on(); return; }
    var shown = false;
    new IntersectionObserver(function (es) {
      var e = es[0];
      if (e.isIntersecting && !shown) { shown = true; on(); }
      else if (!e.isIntersecting && shown) { shown = false; if (off) off(); }
    }, { threshold: threshold || 0.25 }).observe(el);
  }

  /* ---------- Offer window (Central time); ?offer=1 previews it ---------- */
  var today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
  var force = /[?&]offer=1\b/.test(location.search), offerOn = false;
  $$('[data-until]').forEach(function (el) {
    var live = force || (today >= el.getAttribute('data-from') && today <= el.getAttribute('data-until'));
    el.hidden = !live; if (live) offerOn = true;
  });
  $$('[data-promo]').forEach(function (el) { el.textContent = offerOn ? el.getAttribute('data-promo') : el.getAttribute('data-list'); });

  /* ---------- Header: solid after the hero, hides on scroll down, returns on scroll up ---------- */
  var header = $('.site-header');
  if (header) {
    var hero = $('.hero'), lastY = window.scrollY;
    var onScroll = function () {
      var y = window.scrollY, limit = hero ? hero.offsetHeight - 80 : 40;
      header.classList.toggle('solid', y > limit || !hero);
      header.classList.toggle('dark', !!hero && y <= limit);
      header.classList.toggle('scrolled', y > 10);
      if (y > 240 && y > lastY + 4 && !doc.body.classList.contains('menu-open')) header.classList.add('hide');
      if (y < lastY - 4 || y <= 240) header.classList.remove('hide');
      lastY = y;
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Mobile menu ---------- */
  var menu = $('#mobile-menu'), openBtn = $('.menu-btn'), closeBtn = $('#menu-close');
  function setMenu(open) {
    if (!menu) return;
    menu.classList.toggle('open', open);
    menu.setAttribute('aria-hidden', String(!open));
    openBtn && openBtn.setAttribute('aria-expanded', String(open));
    doc.body.classList.toggle('menu-open', open);
    doc.body.style.overflow = open ? 'hidden' : '';
    if (open) { var f = $('a, button', menu); f && f.focus(); } else if (openBtn) openBtn.focus();
  }
  openBtn && openBtn.addEventListener('click', function () { setMenu(true); });
  closeBtn && closeBtn.addEventListener('click', function () { setMenu(false); });
  menu && menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu && menu.classList.contains('open')) setMenu(false); });

  /* ---------- Reveal on scroll ---------- */
  if ('IntersectionObserver' in window && !reduced) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach(function (el) { io.observe(el); });
  } else $$('.reveal').forEach(function (el) { el.classList.add('in'); });

  /* ---------- Hero video: plays only while the hero is on screen ---------- */
  var vid = $('.hero-media video');
  if (vid) {
    if (reduced) { vid.removeAttribute('autoplay'); vid.pause(); }
    else whileVisible(vid, function () { var p = vid.play(); if (p && p.catch) p.catch(function () {}); }, function () { vid.pause(); }, 0.1);
  }

  /* ---------- Ask BP: a scripted sample conversation that plays by itself ---------- */
  var log = $('#ask-log');
  if (!log) return;
  var EN = [
    { who: 'me', text: 'Price for a 12x14 bedroom? Walls and ceiling, two coats, trim and one door. Customer is in Tyler.' },
    { who: 'bp', text: 'Here is a draft from your rates:', est: [['Walls, 2 coats', '$585'], ['Ceiling', '$210'], ['Trim and 1 door', '$165'], ['Materials', '$120'], ['Total', '$1,080']] },
    { who: 'bp', text: 'Send it with a Color Studio link so they can try colors first?', chips: ['Send to customer', 'Adjust price'] },
    { who: 'me', text: 'Send it.' },
    { who: 'bp', text: 'Sent. I will nudge you if they have not opened it in 2 days.' }
  ];
  var ES = [
    { who: 'me', text: '¿Precio para una recámara de 12x14? Paredes y techo, dos manos, molduras y una puerta. El cliente está en Tyler.' },
    { who: 'bp', text: 'Aquí tiene un borrador con sus tarifas:', est: [['Paredes, 2 manos', '$585'], ['Techo', '$210'], ['Molduras y 1 puerta', '$165'], ['Materiales', '$120'], ['Total', '$1,080']] },
    { who: 'bp', text: '¿Lo envío con un enlace de Color Studio para que prueben colores primero?', chips: ['Enviar al cliente', 'Ajustar precio'] },
    { who: 'me', text: 'Envíalo.' },
    { who: 'bp', text: 'Enviado. Le aviso si no lo han abierto en 2 días.' }
  ];
  var script = es ? ES : EN, run = 0, playing = false;
  var av = $('.ask-avatar'); if (av && es) av.textContent = 'M';

  function bubble(step) {
    var m = doc.createElement('div');
    m.className = 'msg ' + step.who;
    return m;
  }
  function extras(m, step) {
    if (step.est) {
      var e = doc.createElement('div'); e.className = 'est';
      step.est.forEach(function (row, i) {
        var d = doc.createElement('div'); if (i === step.est.length - 1) d.className = 'tot';
        var a = doc.createElement('span'); a.textContent = row[0];
        var b = doc.createElement('span'); b.textContent = row[1];
        d.appendChild(a); d.appendChild(b); e.appendChild(d);
      });
      m.appendChild(e);
    }
    if (step.chips) {
      var c = doc.createElement('div'); c.className = 'chips'; c.style.marginTop = '8px';
      step.chips.forEach(function (t, i) { var s = doc.createElement('span'); s.className = 'chip' + (i ? '' : ' go'); s.textContent = t; c.appendChild(s); });
      m.appendChild(c);
    }
  }
  function showAll() {
    log.textContent = '';
    script.forEach(function (step) { var m = bubble(step); m.textContent = step.text; extras(m, step); m.classList.add('in'); log.appendChild(m); });
  }
  async function play(id) {
    log.textContent = '';
    for (var i = 0; i < script.length; i++) {
      if (id !== run) return;
      var step = script[i];
      if (step.who === 'bp') {
        var t = doc.createElement('div'); t.className = 'msg bp in typing'; t.setAttribute('aria-hidden', 'true');
        t.innerHTML = '<i></i><i></i><i></i>'; log.appendChild(t);
        await wait(900); if (id !== run) return; t.remove();
      }
      var m = bubble(step); log.appendChild(m);
      requestAnimationFrame(function () { m.classList.add('in'); });
      if (step.who === 'me') {
        var caret = doc.createElement('span'); caret.className = 'caret';
        var txt = doc.createTextNode(''); m.appendChild(txt); m.appendChild(caret);
        for (var k = 1; k <= step.text.length; k++) { if (id !== run) return; txt.data = step.text.slice(0, k); await wait(32); }
        caret.remove();
      } else { m.textContent = step.text; extras(m, step); }
      await wait(i === script.length - 1 ? 4200 : 1500);
    }
    if (id === run && playing) play(id);
  }
  if (reduced) showAll();
  else whileVisible($('.ask'), function () { playing = true; run++; play(run); }, function () { playing = false; run++; }, 0.3);
})();

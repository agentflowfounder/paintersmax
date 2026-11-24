/* PaintersMax Ask: the round Ask button on every app page.
 * Opens a chat that answers how-to questions about PaintersMax, painting and business questions, and just talks.
 * Talk mode: tap the mic, speak, and the answer is read out loud; then it listens again, like a phone call.
 * On a job page it also knows that job (never the customer's email, phone or street address).
 */
(function () {
  if (window.pmAsk || document.getElementById('pm_ask')) return;
  var T = function (s) { return window.pmT ? window.pmT(s) : s; };
  var es = function () { return window.PM_LANG === 'es'; };
  var css = document.createElement('style');
  css.textContent =
    '#pm_ask{position:fixed;right:16px;bottom:max(16px,env(safe-area-inset-bottom));z-index:900;font:700 17px Inter,system-ui,sans-serif;border:0;border-radius:999px;padding:14px 22px;background:#E8A33D;color:#0F1B2D;box-shadow:0 6px 18px rgba(15,27,45,.28);cursor:pointer}' +
    '#pm_askp{position:fixed;z-index:1500;right:12px;bottom:12px;width:min(420px,calc(100vw - 24px));height:min(640px,calc(100vh - 24px));background:#fff;color:#0F1B2D;border-radius:16px;box-shadow:0 18px 48px rgba(15,27,45,.35);display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif}' +
    '#pm_askp.open{display:flex}@media(max-width:600px){#pm_askp{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}}' +
    '#pm_askp .ah{background:#0F1B2D;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}#pm_askp .ah b{flex:1;font:500 19px Newsreader,Georgia,serif}' +
    '#pm_askp .ah button{all:unset;cursor:pointer;color:#fff;font-size:26px;line-height:1;padding:2px 6px}' +
    '#pm_askp .al{flex:1;overflow:auto;padding:12px;background:#F7F5F1}' +
    '#pm_askp .b{max-width:88%;padding:10px 12px;border-radius:12px;margin:6px 0;white-space:pre-wrap;font-size:15px;line-height:1.45}' +
    '#pm_askp .b.u{margin-left:auto;background:#0F1B2D;color:#fff}#pm_askp .b.a{background:#fff;border:1px solid rgba(15,27,45,.1)}' +
    '#pm_askp .sg{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}#pm_askp .sg button{font:inherit;font-size:13px;border:1px solid rgba(15,27,45,.18);background:#fff;border-radius:999px;padding:7px 11px;cursor:pointer}' +
    '#pm_askp .af{border-top:1px solid rgba(15,27,45,.1);padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff}' +
    '#pm_askp textarea{flex:1;font:inherit;font-size:16px;border:1px solid #cfd5dc;border-radius:10px;padding:10px;resize:none;max-height:120px}' +
    '#pm_askp .af button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:11px 13px;cursor:pointer}#pm_askp .snd{background:#E8A33D;color:#0F1B2D}#pm_askp .mc{background:#eceae4;color:#0F1B2D;display:inline-flex}' +
    '#pm_askp .tm{display:flex;align-items:center;gap:8px;font-size:13px;color:#c9d3e0}#pm_askp .tm input{width:auto;margin:0}' +
    '#pm_askp .ft{font-size:12px;color:#4A5568;padding:0 12px 8px;background:#fff}';
  document.head.appendChild(css);
  var hist = [], busy = false, talk = false;
  try { hist = JSON.parse(sessionStorage.getItem('pm_ask_hist') || '[]') || []; } catch (e) { hist = []; }
  var SUG_EN = ['How do I start a new bid?', 'How do I send an estimate?', 'What primer covers water stains?', 'How do I ask for a deposit politely?'];
  var SUG_ES = ['¿Cómo empiezo una oferta nueva?', '¿Cómo envío un presupuesto?', '¿Qué primer cubre manchas de agua?', '¿Cómo pido un depósito con cortesía?'];
  var fab = document.createElement('button');
  fab.id = 'pm_ask'; fab.type = 'button'; fab.textContent = T('Ask'); fab.setAttribute('aria-label', T('Ask the assistant'));
  var p = document.createElement('div');
  p.id = 'pm_askp'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', T('Ask the assistant'));
  p.innerHTML = '<div class="ah"><b>' + T('Ask anything') + '</b><label class="tm"><input type="checkbox" id="pm_talk"> ' + T('Read answers aloud') + '</label><button type="button" id="pm_askx" aria-label="' + T('Close') + '">&times;</button></div>' +
    '<div class="al" id="pm_askl" aria-live="polite"></div>' +
    '<div class="af"><button type="button" class="mc" id="pm_askm" aria-label="' + T('Talk') + '">' + (window.pmVoice ? window.pmVoice.MIC : '&#127908;') + '</button><textarea id="pm_aski" rows="1" placeholder="' + T('Type your question') + '"></textarea><button type="button" class="snd" id="pm_asks">' + T('Send') + '</button></div>' +
    '<div class="ft">' + T('Answers are suggestions. Check numbers and safety rules before you rely on them. Each question uses one of your monthly assistant questions.') + '</div>';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(i) { return document.getElementById(i); }
  function draw(extra) {
    var l = $('pm_askl'); if (!l) return;
    var sug = es() ? SUG_ES : SUG_EN;
    l.innerHTML = (hist.length ? '' : '<div class="b a">' + esc(T('Hi! Ask me how to do something in PaintersMax, a painting question, or just talk. You can type or tap the mic.')) + '</div><div class="sg">' + sug.map(function (q) { return '<button type="button" data-askq="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>') +
      hist.map(function (m) { return '<div class="b ' + (m.role === 'user' ? 'u' : 'a') + '">' + esc(m.content) + '</div>'; }).join('') + (extra || '');
    l.scrollTop = l.scrollHeight;
  }
  function save() { try { sessionStorage.setItem('pm_ask_hist', JSON.stringify(hist.slice(-16))); } catch (e) {} }
  function speak(text) {
    if (!talk || !window.speechSynthesis) return Promise.resolve();
    return new Promise(function (res) {
      try {
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text.slice(0, 1200)); u.lang = es() ? 'es-US' : 'en-US'; u.rate = 1.02;
        u.onend = res; u.onerror = res; speechSynthesis.speak(u);
      } catch (e) { res(); }
    });
  }
  function jobId() { try { return window.J && window.J.job && window.J.job.id ? window.J.job.id : null; } catch (e) { return null; } }
  function send(q) {
    q = String(q || '').trim(); if (!q || busy) return;
    busy = true; var prior = hist.slice(-8);
    hist.push({ role: 'user', content: q }); $('pm_aski').value = ''; draw('<div class="b a">' + esc(T('Thinking...')) + '</div>');
    fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ mode: 'ask', message: q, history: prior, page: location.pathname, jobId: jobId(), language: es() ? 'es' : 'en' }) })
      .then(function (r) { if (r.status === 401) { location.href = '/login'; throw 0; } return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); })
      .then(function (j) { hist.push({ role: 'assistant', content: j.reply }); save(); draw(); return speak(j.reply).then(function () { if (talk && $('pm_askp').classList.contains('open')) mic(); }); })
      .catch(function (e) { hist.pop(); $('pm_aski').value = q; draw(e ? '<div class="b a">' + esc(T(e.message)) + '</div>' : ''); })
      .then(function () { busy = false; });
  }
  function mic() {
    if (!window.pmVoice) return;
    window.pmVoice.listen({ title: 'Ask out loud', sub: 'Say your question. Tap Done when you finish, and I will answer.', onDone: function (t) { send(t); } });
  }
  function open() { p.classList.add('open'); fab.style.display = 'none'; draw(); setTimeout(function () { var i = $('pm_aski'); if (i && window.innerWidth > 600) i.focus(); }, 50); }
  function close() { p.classList.remove('open'); fab.style.display = ''; try { speechSynthesis.cancel(); } catch (e) {} }
  function start() {
    document.body.appendChild(fab); document.body.appendChild(p);
    fab.onclick = open; $('pm_askx').onclick = close;
    $('pm_asks').onclick = function () { send($('pm_aski').value); };
    $('pm_askm').onclick = mic;
    $('pm_aski').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(this.value); } });
    $('pm_talk').onchange = function () { talk = this.checked; if (!talk) try { speechSynthesis.cancel(); } catch (e) {} };
    $('pm_askl').addEventListener('click', function (e) { var q = e.target.getAttribute && e.target.getAttribute('data-askq'); if (q) send(q); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && p.classList.contains('open')) close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.pmAsk = { open: open, send: send };
})();

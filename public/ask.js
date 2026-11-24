/* PaintersMax Ask: the round Ask button on every app page.
 * Opens a chat that answers how-to questions about PaintersMax, painting and business questions, and just talks.
 * Talk mode: tap the mic, speak, and the answer is read out loud; then it listens again, like a phone call.
 * On a job page it also knows that job (never the customer's email, phone or street address).
 * History: every conversation is kept. Find it by job, topic or words; star the best answers; add one to the job; download it.
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
    '#pm_askp .ah{background:#0F1B2D;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}#pm_askp .ah b{flex:1;font:500 19px Newsreader,Georgia,serif;min-width:90px}' +
    '#pm_askp .ah button{all:unset;cursor:pointer;color:#fff;font-size:26px;line-height:1;padding:2px 6px}#pm_askp .ah button.hb{font:600 13px Inter,system-ui,sans-serif;border:1px solid rgba(255,255,255,.35);border-radius:99px;padding:7px 11px}' +
    '#pm_askp .al{flex:1;overflow:auto;padding:12px;background:#F7F5F1}' +
    '#pm_askp .b{max-width:88%;padding:10px 12px;border-radius:12px;margin:6px 0;white-space:pre-wrap;font-size:15px;line-height:1.45}' +
    '#pm_askp .b.u{margin-left:auto;background:#0F1B2D;color:#fff}#pm_askp .b.a{background:#fff;border:1px solid rgba(15,27,45,.1)}' +
    '#pm_askp .bt{display:flex;flex-wrap:wrap;gap:6px;margin:-2px 0 8px}#pm_askp .bt button,#pm_askp .hr button{font:600 12px Inter,system-ui,sans-serif;border:1px solid rgba(15,27,45,.18);background:#fff;border-radius:99px;padding:6px 10px;cursor:pointer;color:#0F1B2D}#pm_askp .bt button.on{background:#fff3d6;border-color:#e8c26a;color:#8a5a00}' +
    '#pm_askp .sg{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}#pm_askp .sg button{font:inherit;font-size:13px;border:1px solid rgba(15,27,45,.18);background:#fff;border-radius:999px;padding:7px 11px;cursor:pointer}' +
    '#pm_askp .af{border-top:1px solid rgba(15,27,45,.1);padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff}' +
    '#pm_askp textarea{flex:1;font:inherit;font-size:16px;border:1px solid #cfd5dc;border-radius:10px;padding:10px;resize:none;max-height:120px}' +
    '#pm_askp .af button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:11px 13px;cursor:pointer}#pm_askp .snd{background:#E8A33D;color:#0F1B2D}#pm_askp .mc{background:#eceae4;color:#0F1B2D;display:inline-flex}' +
    '#pm_askp .tm{display:flex;align-items:center;gap:8px;font-size:13px;color:#c9d3e0}#pm_askp .tm input{width:auto;margin:0}' +
    '#pm_askp .ft{font-size:12px;color:#4A5568;padding:0 12px 8px;background:#fff}' +
    '#pm_askp .tabs{display:flex;gap:6px;overflow-x:auto;margin:0 0 8px}#pm_askp .tabs button{flex:none;font:600 13px Inter,system-ui,sans-serif;border:1px solid #cfd5dc;background:#fff;border-radius:99px;padding:8px 12px;cursor:pointer;color:#0F1B2D}#pm_askp .tabs button.on{background:#0F1B2D;color:#fff;border-color:#0F1B2D}' +
    '#pm_askp .hs{width:100%;box-sizing:border-box;font:inherit;font-size:15px;border:1px solid #cfd5dc;border-radius:10px;padding:10px;margin:0 0 8px}' +
    '#pm_askp .hr{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:10px 12px;margin:0 0 8px}#pm_askp .hr .t{font-weight:700;cursor:pointer;display:block;text-align:left;background:none;border:0;padding:0;font:700 15px Inter,system-ui,sans-serif;color:#0F1B2D}' +
    '#pm_askp .hr small,#pm_askp .hg{color:#4A5568;font-size:12px}#pm_askp .hg{font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px}#pm_askp .hr .ra{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}' +
    '#pm_askp .tg{display:inline-block;font-size:11px;font-weight:700;border-radius:99px;padding:2px 8px;background:#eaf2fd;color:#1f4f8a;margin-right:4px}';
  document.head.appendChild(css);
  var hist = [], busy = false, talk = false, view = 'chat', tab = 'recent', q = '', convId = null, saved = [];
  try { hist = JSON.parse(sessionStorage.getItem('pm_ask_hist') || '[]') || []; convId = Number(sessionStorage.getItem('pm_ask_conv')) || null; } catch (e) { hist = []; }
  var SUG_EN = ['How do I start a new bid?', 'How do I send an estimate?', 'What primer covers water stains?', 'How do I ask for a deposit politely?'];
  var SUG_ES = ['¿Cómo empiezo una oferta nueva?', '¿Cómo envío un presupuesto?', '¿Qué primer cubre manchas de agua?', '¿Cómo pido un depósito con cortesía?'];
  var TOPICS = { pricing: 'Pricing', products: 'Products and paint', customers: 'Customers', business: 'Business', platform: 'Using PaintersMax', general: 'General' };
  var fab = document.createElement('button');
  fab.id = 'pm_ask'; fab.type = 'button'; fab.textContent = T('Ask'); fab.setAttribute('aria-label', T('Ask the assistant'));
  var p = document.createElement('div');
  p.id = 'pm_askp'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', T('Ask the assistant'));
  p.innerHTML = '<div class="ah"><b>' + T('Ask anything') + '</b><button type="button" class="hb" id="pm_ask_hist">' + T('History') + '</button><button type="button" class="hb" id="pm_ask_new">' + T('New chat') + '</button><button type="button" class="hb" id="pm_ask_dl">' + T('Download') + '</button><button type="button" class="hb" id="pm_ask_live" title="' + T('Talk with the assistant out loud, like a phone call') + '">' + T('Talk live') + '</button><label class="tm"><input type="checkbox" id="pm_talk"> ' + T('Read answers aloud') + '</label><button type="button" id="pm_askx" aria-label="' + T('Close') + '">&times;</button></div>' +
    '<div class="al" id="pm_askl" aria-live="polite"></div>' +
    '<div class="af" id="pm_askf"><button type="button" class="mc" id="pm_askm" aria-label="' + T('Talk') + '">' + (window.pmVoice ? window.pmVoice.MIC : '&#127908;') + '</button><textarea id="pm_aski" rows="1" placeholder="' + T('Type your question') + '"></textarea><button type="button" class="snd" id="pm_asks">' + T('Send') + '</button></div>' +
    '<div class="ft">' + T('Answers are suggestions. Check numbers and safety rules before you rely on them. Each question uses one of your monthly assistant questions.') + '</div>';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(i) { return document.getElementById(i); }
  function jobId() { try { return window.J && window.J.job && window.J.job.id ? window.J.job.id : null; } catch (e) { return null; } }
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) } : { credentials: 'same-origin' })
      .then(function (r) { if (r.status === 401) { location.href = '/login'; throw 0; } return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); });
  }
  function bubble(m, i) {
    var h = '<div class="b ' + (m.role === 'user' ? 'u' : 'a') + '">' + esc(m.content) + '</div>';
    if (m.role !== 'user') {
      h += '<div class="bt">' + (m.id ? '<button type="button" data-star="' + m.id + '" class="' + (m.starred ? 'on' : '') + '">' + (m.starred ? '&#9733; ' + esc(T('Saved')) : '&#9734; ' + esc(T('Save answer'))) + '</button>' : '') +
        (m.id && jobId() ? '<button type="button" data-tojob="' + m.id + '">' + esc(T('Add to this job')) + '</button>' : '') +
        '<button type="button" data-copy="' + i + '">' + esc(T('Copy')) + '</button></div>';
    }
    return h;
  }
  function draw(extra) {
    var l = $('pm_askl'); if (!l) return;
    if (view === 'hist') { $('pm_askf').style.display = 'none'; return drawHist(); }
    $('pm_askf').style.display = '';
    var sug = es() ? SUG_ES : SUG_EN;
    l.innerHTML = (hist.length ? '' : '<div class="b a">' + esc(T('Hi! Ask me how to do something in PaintersMax, a painting question, or just talk. You can type or tap the mic.')) + '</div><div class="sg">' + sug.map(function (x) { return '<button type="button" data-askq="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>') +
      hist.map(bubble).join('') + (extra || '');
    l.scrollTop = l.scrollHeight;
  }
  function save() { try { sessionStorage.setItem('pm_ask_hist', JSON.stringify(hist.slice(-16))); sessionStorage.setItem('pm_ask_conv', convId || ''); } catch (e) {} }
  // ---- History screen ----
  var TABS = [['recent', 'Recent'], ['jobs', 'By job'], ['topics', 'By topic'], ['saved', 'Saved answers'], ['starred', 'Starred'], ['archived', 'Archived']];
  function drawHist(rows) {
    var l = $('pm_askl');
    var head = '<div class="tabs">' + TABS.map(function (t) { return '<button type="button" data-htab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + esc(T(t[1])) + '</button>'; }).join('') + '</div>' +
      (tab === 'saved' ? '' : '<input class="hs" id="pm_hq" type="search" placeholder="' + esc(T('Search your chats')) + '" value="' + esc(q) + '">');
    if (!rows) { l.innerHTML = head + '<div class="b a">' + esc(T('Loading...')) + '</div>'; var s = $('pm_hq'); wire(); return load(); }
    l.innerHTML = head + rows; wire();
  }
  function wire() { var s = $('pm_hq'); if (s && !s.dataset.w) { s.dataset.w = '1'; var t; s.addEventListener('input', function () { q = s.value; clearTimeout(t); t = setTimeout(function () { load(); }, 300); }); } }
  function rowHtml(c) {
    return '<div class="hr"><button type="button" class="t" data-open="' + c.id + '">' + esc(c.title) + '</button><small><span class="tg">' + esc(T(TOPICS[c.topic] || 'General')) + '</span>' + (c.jobTitle ? esc(c.jobTitle) + ' &middot; ' : '') + esc((c.updatedAt || '').slice(0, 10)) + ' &middot; ' + Math.round(c.count / 2) + ' ' + esc(T(Math.round(c.count / 2) === 1 ? 'question' : 'questions')) + '</small>' +
      '<div class="ra"><button type="button" data-cstar="' + c.id + '" data-on="' + (c.starred ? 0 : 1) + '">' + (c.starred ? '&#9733; ' + esc(T('Starred')) : '&#9734; ' + esc(T('Star'))) + '</button><button type="button" data-carch="' + c.id + '" data-on="' + (c.archived ? 0 : 1) + '">' + esc(c.archived ? T('Restore') : T('Archive')) + '</button><button type="button" data-cdel="' + c.id + '">' + esc(T('Delete')) + '</button></div></div>';
  }
  function load() {
    var url = tab === 'saved' ? '/api/askchats?saved=1' : '/api/askchats?scope=' + (tab === 'topics' ? 'recent' : tab) + (q ? '&q=' + encodeURIComponent(q) : '');
    api(url).then(function (j) {
      var out = '';
      if (tab === 'saved') {
        saved = j.saved || [];
        out = saved.length ? saved.map(function (m) { return '<div class="hr"><b>' + esc(m.question || m.chatTitle) + '</b><div style="white-space:pre-wrap;font-size:14px;margin-top:6px">' + esc(m.content) + '</div><div class="ra"><button type="button" data-open="' + m.chatId + '">' + esc(T('Open chat')) + '</button><button type="button" data-unsave="' + m.id + '">' + esc(T('Remove')) + '</button></div></div>'; }).join('') : '<div class="b a">' + esc(T('Star an answer with Save answer and it shows up here, like your own handbook.')) + '</div>';
      } else {
        var chats = j.chats || [];
        if (!chats.length) out = '<div class="b a">' + esc(T('No conversations here yet.')) + '</div>';
        else if (tab === 'jobs') { var g = {}; chats.forEach(function (c) { if (c.jobId) (g[c.jobTitle || ('Job ' + c.jobId)] = g[c.jobTitle || ('Job ' + c.jobId)] || []).push(c); }); out = Object.keys(g).map(function (k) { return '<div class="hg">' + esc(k) + '</div>' + g[k].map(rowHtml).join(''); }).join('') || '<div class="b a">' + esc(T('Chats you open on a job are filed under that job.')) + '</div>'; }
        else if (tab === 'topics') { out = Object.keys(TOPICS).map(function (k) { var a = chats.filter(function (c) { return c.topic === k; }); return a.length ? '<div class="hg">' + esc(T(TOPICS[k])) + '</div>' + a.map(rowHtml).join('') : ''; }).join(''); }
        else out = chats.map(rowHtml).join('');
      }
      drawHist(out);
    }).catch(function (e) { drawHist('<div class="b a">' + esc(T(e && e.message ? e.message : 'History is not ready yet.')) + '</div>'); });
  }
  function openChat(id) {
    api('/api/askchats?id=' + id).then(function (j) {
      hist = (j.messages || []).map(function (m) { return { role: m.role, content: m.content, id: m.role === 'assistant' ? m.id : undefined, starred: !!m.starred }; });
      convId = j.chat.id; save(); view = 'chat'; draw();
    }).catch(function (e) { if (e) alert(T(e.message)); });
  }
  function download() {
    if (!hist.length) return;
    var txt = 'PaintersMax Ask\n' + new Date().toISOString().slice(0, 10) + '\n\n' + hist.map(function (m) { return (m.role === 'user' ? 'You: ' : 'Assistant: ') + m.content; }).join('\n\n') + '\n';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = 'ask-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
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
  function send(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    if (view === 'hist') { view = 'chat'; }
    busy = true; var prior = hist.slice(-8).map(function (m) { return { role: m.role, content: m.content }; });
    hist.push({ role: 'user', content: text }); $('pm_aski').value = ''; draw('<div class="b a">' + esc(T('Thinking...')) + '</div>');
    stream({ mode: 'ask', stream: true, message: text, history: prior, page: location.pathname, jobId: jobId(), language: es() ? 'es' : 'en', conversationId: convId })
      .then(function (j) { if (j.conversationId) convId = j.conversationId; hist.push({ role: 'assistant', content: j.reply, id: j.messageId || undefined }); save(); draw(); return speak(j.reply).then(function () { if (talk && $('pm_askp').classList.contains('open')) mic(); }); })
      .catch(function (e) { hist.pop(); $('pm_aski').value = text; draw(e ? '<div class="b a">' + esc(T(e.message)) + '</div>' : ''); })
      .then(function () { busy = false; });
  }
  // Word-by-word answers: shows each piece as it arrives, then resolves with the final {reply, conversationId, messageId}.
  function stream(body) {
    return fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      if (!r.ok || ct.indexOf('event-stream') < 0 || !r.body || !r.body.getReader) {
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.error) throw new Error(j.error || 'Something went wrong.'); return j; });
      }
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '', so = '', fin = null;
      function show() { draw('<div class="b a">' + esc(so).replace(/\n/g, '<br>') + '</div>'); }
      function take(block) {
        block.split('\n').forEach(function (line) {
          if (line.indexOf('data:') !== 0) return;
          var o; try { o = JSON.parse(line.slice(5)); } catch (e) { return; }
          if (o.t) { so += o.t; show(); }
          if (o.error) throw new Error(o.error);
          if (o.done) fin = o;
        });
      }
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) { if (buf) take(buf); if (!fin) throw new Error('The answer was cut off. Please try again.'); return fin; }
          buf += dec.decode(x.value, { stream: true });
          var parts = buf.split('\n\n'); buf = parts.pop();
          parts.forEach(take);
          return fin ? fin : pump();
        });
      }
      return pump();
    });
  }
  function mic() {
    if (!window.pmVoice) return;
    window.pmVoice.listen({ title: 'Ask out loud', sub: 'Say your question. Tap Done when you finish, and I will answer.', onDone: function (t) { send(t); } });
  }
  function open() { p.classList.add('open'); fab.style.display = 'none'; draw(); setTimeout(function () { var i = $('pm_aski'); if (i && view === 'chat' && window.innerWidth > 600) i.focus(); }, 50); }
  function close() { p.classList.remove('open'); fab.style.display = ''; try { speechSynthesis.cancel(); } catch (e) {} }
  function start() {
    document.body.appendChild(fab); document.body.appendChild(p);
    fab.onclick = open; $('pm_askx').onclick = close;
    $('pm_asks').onclick = function () { send($('pm_aski').value); };
    $('pm_askm').onclick = mic;
    $('pm_ask_hist').onclick = function () { view = view === 'hist' ? 'chat' : 'hist'; draw(); };
    $('pm_ask_new').onclick = function () { hist = []; convId = null; view = 'chat'; save(); draw(); };
    $('pm_ask_dl').onclick = download;
    $('pm_ask_live').onclick = function () {
      if (!window.pmLive) { alert(T('Live voice is still loading. Try again in a second.')); return; }
      try { speechSynthesis.cancel(); } catch (e) {}
      window.pmLive.open({ page: location.pathname, jobId: jobId(), language: es() ? 'es' : 'en', onEnd: function (tr) {
        if (!tr || !tr.length) return;
        tr.forEach(function (l) { hist.push({ role: l.who === 'you' ? 'user' : 'assistant', content: l.text }); });
        save(); view = 'chat'; draw();
      } });
    };
    $('pm_aski').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(this.value); } });
    $('pm_talk').onchange = function () { talk = this.checked; if (!talk) try { speechSynthesis.cancel(); } catch (e) {} };
    $('pm_askl').addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button') : e.target; if (!t || !t.getAttribute) return;
      var d = function (k) { return t.getAttribute('data-' + k); };
      if (d('askq')) return send(d('askq'));
      if (d('htab')) { tab = d('htab'); q = ''; return drawHist(); }
      if (d('open')) return openChat(d('open'));
      if (d('cstar')) return api('/api/askchats', { action: 'star', id: Number(d('cstar')), on: d('on') === '1' }).then(load);
      if (d('carch')) return api('/api/askchats', { action: 'archive', id: Number(d('carch')), on: d('on') === '1' }).then(load);
      if (d('cdel')) { if (confirm(T('Delete this conversation for good?'))) api('/api/askchats', { action: 'delete', id: Number(d('cdel')) }).then(function () { if (convId === Number(d('cdel'))) { hist = []; convId = null; save(); } load(); }); return; }
      if (d('unsave')) return api('/api/askchats', { action: 'starMsg', messageId: Number(d('unsave')), on: false }).then(load);
      if (d('star')) { var m = hist.filter(function (x) { return String(x.id) === d('star'); })[0]; var on = !(m && m.starred); return api('/api/askchats', { action: 'starMsg', messageId: Number(d('star')), on: on }).then(function () { if (m) m.starred = on; save(); draw(); }); }
      if (d('tojob')) return api('/api/askchats', { action: 'saveToJob', messageId: Number(d('tojob')), jobId: jobId() }).then(function () { t.textContent = T('Added to the job notes'); t.disabled = true; if (window.noteRefresh) try { window.noteRefresh(); } catch (e) {} }).catch(function (x) { if (x) alert(T(x.message)); });
      if (d('copy')) { try { navigator.clipboard.writeText(hist[Number(d('copy'))].content); t.textContent = T('Copied'); } catch (e) {} }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && p.classList.contains('open')) close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.pmAsk = { open: open, send: send };
})();

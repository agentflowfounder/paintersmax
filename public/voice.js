/* PaintersMax voice typing: one recorder for every mic button.
 * pmVoice.listen({ title, lang, onDone(text) }) opens a large screen that shows the words as they are spoken.
 * If nobody speaks for a while it beeps and asks the painter to keep going; after about 40 quiet seconds it stops by itself.
 * Any textarea or input with data-voice gets a mic button under it: the words go into that box.
 * Works in Chrome, Edge and Safari (they turn speech into text). Other browsers see a short note instead.
 */
(function () {
  if (window.pmVoice) return;
  var T = function (s) { return window.pmT ? window.pmT(s) : s; };
  var R = window.SpeechRecognition || window.webkitSpeechRecognition;
  var es = function () { return window.PM_LANG === 'es' || document.documentElement.lang === 'es'; };
  var css = document.createElement('style');
  css.textContent =
    '#pmv{position:fixed;inset:0;z-index:2000;background:rgba(15,27,45,.96);color:#fff;display:flex;flex-direction:column;padding:max(18px,env(safe-area-inset-top)) 18px max(18px,env(safe-area-inset-bottom));font-family:Inter,system-ui,sans-serif}' +
    '#pmv h2{margin:0;font:500 22px Newsreader,Georgia,serif}#pmv .pmv-sub{color:#c9d3e0;font-size:14px;margin:4px 0 12px}' +
    '#pmv .pmv-txt{flex:1;overflow:auto;background:#fff;color:#0F1B2D;border-radius:14px;padding:16px;font-size:22px;line-height:1.45;white-space:pre-wrap}' +
    '#pmv .pmv-txt i{color:#8a94a3;font-style:normal}#pmv .pmv-txt .pmv-ph{color:#8a94a3;font-size:18px}' +
    '#pmv .pmv-row{display:flex;gap:10px;align-items:center;margin-top:14px}' +
    '#pmv .pmv-dot{width:16px;height:16px;border-radius:50%;background:#e5484d;box-shadow:0 0 0 0 rgba(229,72,77,.7);animation:pmvp 1.4s infinite;flex:none}' +
    '#pmv.quiet .pmv-dot{background:#E8A33D;animation:none}#pmv.off .pmv-dot{background:#8a94a3;animation:none}' +
    '@keyframes pmvp{0%{box-shadow:0 0 0 0 rgba(229,72,77,.7)}70%{box-shadow:0 0 0 14px rgba(229,72,77,0)}100%{box-shadow:0 0 0 0 rgba(229,72,77,0)}}' +
    '#pmv .pmv-st{flex:1;font-size:15px}#pmv .pmv-tm{font-variant-numeric:tabular-nums;color:#c9d3e0}' +
    '#pmv .pmv-warn{background:#fff3d6;color:#5a3b00;border-radius:10px;padding:10px 12px;margin-top:10px;font-size:15px;display:none}#pmv.quiet .pmv-warn{display:block}' +
    '#pmv button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:16px 18px;cursor:pointer;font-size:18px}' +
    '#pmv .pmv-stop{background:#E8A33D;color:#0F1B2D;flex:1}#pmv .pmv-cancel{background:rgba(255,255,255,.14);color:#fff}' +
    '.pmv-mic{display:inline-flex;align-items:center;gap:6px;font:inherit;font-weight:700;font-size:14px;border:0;border-radius:8px;padding:8px 12px;margin-top:6px;background:#eceae4;color:#0F1B2D;cursor:pointer}.pmv-mic svg{flex:none}';
  document.head.appendChild(css);
  var MIC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v4"/></svg>';
  var actx = null;
  function beep() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22].forEach(function (d, i) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = i ? 880 : 660; o.connect(g); g.connect(actx.destination);
        var t = actx.currentTime + d; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.start(t); o.stop(t + 0.2);
      });
    } catch (e) { /* no sound is fine */ }
    try { navigator.vibrate && navigator.vibrate([120, 80, 120]); } catch (e) {}
  }
  function errText(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed') return T('The microphone is blocked. Allow it for this site in your browser settings, then try again.');
    if (code === 'audio-capture') return T('No microphone was found. Plug one in or check your sound settings.');
    if (code === 'network') return T('Voice typing needs an internet connection. Check your signal and try again.');
    return '';
  }
  var cur = null;
  function listen(o) {
    o = o || {};
    if (cur) cur.finish(false);
    var box = document.createElement('div');
    box.id = 'pmv'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', T(o.title || 'Voice note'));
    box.innerHTML = '<h2>' + T(o.title || 'Talk now') + '</h2><div class="pmv-sub">' + T(o.sub || 'Speak naturally. Your words show up below as you talk. Tap Done when you finish.') + '</div>' +
      '<div class="pmv-txt" aria-live="polite"><span class="pmv-ph">' + T('Listening...') + '</span></div>' +
      '<div class="pmv-warn">' + T('I cannot hear you. Keep talking, or tap Done if you are finished.') + '</div>' +
      '<div class="pmv-row"><span class="pmv-dot"></span><span class="pmv-st">' + T('Listening') + '</span><span class="pmv-tm">0:00</span></div>' +
      '<div class="pmv-row"><button type="button" class="pmv-cancel">' + T('Cancel') + '</button><button type="button" class="pmv-stop">' + T('Done') + '</button></div>';
    document.body.appendChild(box);
    var txt = box.querySelector('.pmv-txt'), st = box.querySelector('.pmv-st'), tm = box.querySelector('.pmv-tm');
    var finals = [], interim = '', want = true, rec = null, started = Date.now(), lastHeard = Date.now(), nudges = 0, quick = 0, t0 = 0, g = '', gstop = null;
    var draw = function () {
      var f = (finals.join(' ') + ' ' + g).trim();
      txt.innerHTML = f || interim ? esc(f) + (interim ? ' <i>' + esc(interim) + '</i>' : '') : '<span class="pmv-ph">' + T('Listening...') + '</span>';
      txt.scrollTop = txt.scrollHeight;
    };
    var timer = setInterval(function () {
      var s = Math.floor((Date.now() - started) / 1000); tm.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
      var quiet = Date.now() - lastHeard;
      if (want && quiet > 9000 * (nudges + 1)) {
        nudges++; box.classList.add('quiet'); beep();
        if (nudges >= 4) finish(true);
      }
    }, 500);
    function finish(keep) {
      if (!want && !box.parentNode) return;
      want = false; clearInterval(timer);
      try { rec && rec.stop(); } catch (e) {}
      if (gstop) gstop();
      if (box.parentNode) box.parentNode.removeChild(box);
      document.removeEventListener('keydown', onKey);
      cur = null;
      var text = (finals.join(' ') + ' ' + g + (interim ? ' ' + interim : '')).replace(/\s+/g, ' ').trim();
      if (keep && text && o.onDone) o.onDone(text);
      if (o.onClose) o.onClose(keep ? text : '');
    }
    function onKey(e) { if (e.key === 'Escape') finish(false); }
    document.addEventListener('keydown', onKey);
    box.querySelector('.pmv-stop').onclick = function () { finish(true); };
    box.querySelector('.pmv-cancel').onclick = function () { finish(false); };
    cur = { finish: finish };
    if (!R) {
      box.classList.add('off'); st.textContent = T('Voice typing does not work in this browser.');
      txt.innerHTML = '<span class="pmv-ph">' + T('Use Chrome, Edge or Safari, or tap the mic on your phone keyboard and talk into the box instead.') + '</span>';
      clearInterval(timer); return cur;
    }
    var begin = function () {
      if (!want) return;
      var r = new R(); rec = r;
      r.lang = (typeof o.lang === 'function' ? o.lang() : o.lang) || (es() ? 'es-US' : 'en-US');
      r.continuous = true; r.interimResults = true; t0 = Date.now();
      r.onresult = function (ev) {
        interim = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var x = (ev.results[i][0].transcript || '').trim();
          if (!x) continue;
          if (ev.results[i].isFinal) finals.push(x); else interim += (interim ? ' ' : '') + x;
        }
        lastHeard = Date.now(); nudges = 0; quick = 0; box.classList.remove('quiet'); st.textContent = T('Listening'); draw();
      };
      r.onerror = function (ev) {
        var m = errText(ev.error);
        if (m) { want = false; box.classList.add('off'); st.textContent = m; clearInterval(timer); }
      };
      r.onend = function () {
        // Speech services stop after a pause; start again so long notes keep going.
        if (interim) { finals.push(interim); interim = ''; draw(); }
        if (!want) return;
        if (Date.now() - t0 < 1000 && ++quick >= 5) { want = false; box.classList.add('off'); st.textContent = T('Voice typing stopped. Tap Done to keep what you said.'); clearInterval(timer); return; }
        setTimeout(begin, 200);
      };
      try { r.start(); } catch (e) { setTimeout(begin, 400); }
    };
    // Paid plans: Gemini Transcribe Live through a one-use token from our server. Anything that goes wrong falls back to the phone's own speech.
    function startGemini(info) {
      var ws = null, stream = null, ac = null, node = null, src = null, ready = false, heard = false, dead = false;
      function fallback() {
        if (dead) return; dead = true; gstop();
        if (want) { st.textContent = T('Listening'); begin(); }
      }
      gstop = function () {
        gstop = function () {};
        try { node && node.disconnect(); src && src.disconnect(); } catch (e) {}
        try { ac && ac.close(); } catch (e) {}
        try { stream && stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        try { ws && ws.close(); } catch (e) {}
      };
      var guard = setTimeout(function () { if (!heard && !dead) fallback(); }, 8000);
      try {
        ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=' + encodeURIComponent(info.token));
      } catch (e) { clearTimeout(guard); return fallback(); }
      ws.onopen = function () {
        ws.send(JSON.stringify({ setup: { model: 'models/' + info.model, generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: {} } }));
      };
      ws.onerror = function () { clearTimeout(guard); fallback(); };
      ws.onclose = function () { clearTimeout(guard); if (!dead && want) fallback(); };
      ws.onmessage = function (ev) {
        Promise.resolve(typeof ev.data === 'string' ? ev.data : ev.data.text()).then(function (raw) {
          var m; try { m = JSON.parse(raw); } catch (e) { return; }
          if (m.setupComplete && !ready) { ready = true; capture(); return; }
          var sc = m.serverContent; if (!sc) return;
          var add = (sc.inputTranscription && sc.inputTranscription.text) || '';
          if (!add && sc.modelTurn && sc.modelTurn.parts) add = sc.modelTurn.parts.map(function (x) { return x.text || ''; }).join('');
          if (!add) return;
          heard = true; g += add; lastHeard = Date.now(); nudges = 0; box.classList.remove('quiet'); st.textContent = T('Listening'); draw();
        });
      };
      function capture() {
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s2) {
          if (dead || !want) { s2.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = s2;
          ac = new (window.AudioContext || window.webkitAudioContext)();
          src = ac.createMediaStreamSource(stream);
          node = ac.createScriptProcessor(4096, 1, 1);
          var ratio = ac.sampleRate / 16000;
          node.onaudioprocess = function (e) {
            if (!ws || ws.readyState !== 1) return;
            var inp = e.inputBuffer.getChannelData(0), n = Math.floor(inp.length / ratio), pcm = new Int16Array(n);
            for (var i = 0; i < n; i++) { var v = Math.max(-1, Math.min(1, inp[Math.floor(i * ratio)])); pcm[i] = v < 0 ? v * 32768 : v * 32767; }
            var bin = '', u8 = new Uint8Array(pcm.buffer);
            for (var j = 0; j < u8.length; j++) bin += String.fromCharCode(u8[j]);
            ws.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(bin), mimeType: 'audio/pcm;rate=16000' } } }));
          };
          src.connect(node); node.connect(ac.destination);
        }).catch(function (err) {
          clearTimeout(guard); dead = true; gstop();
          if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) { want = false; box.classList.add('off'); st.textContent = errText('not-allowed'); clearInterval(timer); }
          else if (want) begin();
        });
      }
    }
    if (o.engine === 'device') begin();
    else fetch('/api/voice/session', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { engine: 'device' }; })
      .catch(function () { return { engine: 'device' }; })
      .then(function (info) { if (!want) return; if (info && info.engine === 'gemini' && info.token && window.WebSocket && navigator.mediaDevices) startGemini(info); else begin(); });
    return cur;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // A mic under each box marked data-voice.
  function attach(el) {
    if (!el || el.dataset.voiceOn) return;
    el.dataset.voiceOn = '1';
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pmv-mic'; b.innerHTML = MIC + '<span>' + T('Talk') + '</span>';
    b.setAttribute('aria-label', T('Talk instead of typing'));
    b.onclick = function () {
      listen({ title: el.getAttribute('data-voice') || 'Talk now', onDone: function (t) { el.value = ((el.value ? el.value.replace(/\s+$/, '') + ' ' : '') + t).trim(); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } });
    };
    el.insertAdjacentElement('afterend', b);
  }
  function scan(root) { [].forEach.call((root || document).querySelectorAll('[data-voice]'), attach); }
  var mo = new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) if (ms[i].addedNodes.length) { scan(document); break; } });
  function start() { scan(document); mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.pmVoice = { listen: listen, attach: attach, supported: !!R, MIC: MIC };
})();

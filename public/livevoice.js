/* PaintersMax live voice chat (Gemini Live), opened from the Ask panel's "Talk live" button.
 * Paid plans only. The server mints a one-use token, so the Gemini key never reaches the phone.
 * Mic audio goes up as 16 kHz PCM; the answer comes back as 24 kHz PCM and plays as it arrives.
 * Speaking while the assistant talks interrupts it, like a phone call. A session ends after a few minutes to keep cost small.
 * window.pmLive.open({page, jobId, language, onEnd(transcript)})
 */
(function () {
  if (window.pmLive) return;
  var T = function (s) { return window.pmT ? window.pmT(s) : s; };
  var css = document.createElement('style');
  css.textContent = '#pm_live{position:fixed;inset:0;z-index:2000;background:rgba(15,27,45,.92);color:#fff;display:none;flex-direction:column;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,sans-serif;text-align:center}' +
    '#pm_live.open{display:flex}#pm_live .orb{width:150px;height:150px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffd38a,#E8A33D 60%,#a86a12);margin:20px auto;transition:transform .12s}' +
    '#pm_live.talking .orb{animation:pmpulse 1s infinite}@keyframes pmpulse{50%{transform:scale(1.08)}}@media (prefers-reduced-motion:reduce){#pm_live.talking .orb{animation:none}}' +
    '#pm_live .st{font-size:18px;font-weight:700;min-height:26px}#pm_live .tx{max-width:560px;width:100%;max-height:34vh;overflow:auto;text-align:left;background:rgba(255,255,255,.08);border-radius:12px;padding:10px 12px;margin:14px 0;font-size:15px;line-height:1.45}' +
    '#pm_live .tx p{margin:4px 0}#pm_live .tx b{color:#E8A33D}#pm_live .bt{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}' +
    '#pm_live button{font:700 17px Inter,system-ui,sans-serif;border:0;border-radius:999px;padding:14px 24px;min-height:48px;cursor:pointer}#pm_live .end{background:#b42318;color:#fff}#pm_live .mute{background:#eceae4;color:#0F1B2D}#pm_live small{color:#c9d3e0}';
  document.head.appendChild(css);
  var box = document.createElement('div'); box.id = 'pm_live'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', T('Live voice'));
  box.innerHTML = '<div class="st" id="pm_lv_st"></div><div class="orb" aria-hidden="true"></div><div class="tx" id="pm_lv_tx" aria-live="polite"></div>' +
    '<div class="bt"><button type="button" class="mute" id="pm_lv_mute">' + T('Mute me') + '</button><button type="button" class="end" id="pm_lv_end">' + T('End call') + '</button></div><small id="pm_lv_ft"></small>';
  var ws = null, ac = null, src = null, node = null, stream = null, playAt = 0, playing = [], muted = false, lines = [], opts = null, endTimer = null, tick = null, startedAt = 0, ended = true, curUser = '', curBot = '';
  function $(i) { return document.getElementById(i); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function status(t) { var s = $('pm_lv_st'); if (s) s.textContent = T(t); }
  function drawTx() {
    var x = $('pm_lv_tx'); if (!x) return;
    var all = lines.concat(curUser ? [{ who: 'you', text: curUser }] : []).concat(curBot ? [{ who: 'bot', text: curBot }] : []);
    x.innerHTML = all.map(function (l) { return '<p><b>' + (l.who === 'you' ? T('You') : T('Assistant')) + ':</b> ' + esc(l.text) + '</p>'; }).join('') || '<p>' + esc(T('Say hello, then ask your question.')) + '</p>';
    x.scrollTop = x.scrollHeight;
  }
  function flushTurn() { if (curUser.trim()) lines.push({ who: 'you', text: curUser.trim() }); if (curBot.trim()) lines.push({ who: 'bot', text: curBot.trim() }); curUser = ''; curBot = ''; }
  function stopPlayback() { playing.forEach(function (s) { try { s.stop(); } catch (e) {} }); playing = []; playAt = 0; box.classList.remove('talking'); }
  function play(b64) {
    if (!ac) return;
    var bin = atob(b64), n = bin.length >> 1, f = new Float32Array(n);
    for (var i = 0; i < n; i++) { var v = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)); if (v >= 32768) v -= 65536; f[i] = v / 32768; }
    var buf = ac.createBuffer(1, n, 24000); buf.getChannelData(0).set(f);
    var s = ac.createBufferSource(); s.buffer = buf; s.connect(ac.destination);
    var at = Math.max(ac.currentTime + 0.03, playAt); s.start(at); playAt = at + buf.duration;
    playing.push(s); box.classList.add('talking');
    s.onended = function () { playing = playing.filter(function (x) { return x !== s; }); if (!playing.length) box.classList.remove('talking'); };
  }
  function end(why) {
    if (ended) return; ended = true;
    clearTimeout(endTimer); clearInterval(tick);
    stopPlayback();
    try { node && node.disconnect(); src && src.disconnect(); } catch (e) {}
    try { stream && stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { ws && ws.close(); } catch (e) {}
    try { ac && ac.close(); } catch (e) {}
    ws = ac = src = node = stream = null;
    flushTurn();
    box.classList.remove('open');
    var cb = opts && opts.onEnd; var tr = lines.slice();
    if (cb) try { cb(tr, why || ''); } catch (e) {}
  }
  function startMic() {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (s) {
      if (ended) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; src = ac.createMediaStreamSource(s); node = ac.createScriptProcessor(4096, 1, 1);
      var ratio = ac.sampleRate / 16000;
      node.onaudioprocess = function (e) {
        if (!ws || ws.readyState !== 1 || muted) return;
        var inp = e.inputBuffer.getChannelData(0), n = Math.floor(inp.length / ratio), pcm = new Int16Array(n);
        for (var i = 0; i < n; i++) { var v = Math.max(-1, Math.min(1, inp[Math.floor(i * ratio)])); pcm[i] = v < 0 ? v * 32768 : v * 32767; }
        var bin = '', u8 = new Uint8Array(pcm.buffer);
        for (var j = 0; j < u8.length; j++) bin += String.fromCharCode(u8[j]);
        ws.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(bin), mimeType: 'audio/pcm;rate=16000' } } }));
      };
      // A silent gain node keeps the processor running without playing the mic back.
      var g = ac.createGain(); g.gain.value = 0; src.connect(node); node.connect(g); g.connect(ac.destination);
      status('Listening. Talk any time.');
    });
  }
  function open(o) {
    if (!ended) return; opts = o || {}; ended = false; lines = []; curUser = ''; curBot = ''; muted = false;
    document.body.appendChild(box); box.classList.add('open'); $('pm_lv_mute').textContent = T('Mute me'); drawTx(); status('Connecting...');
    $('pm_lv_ft').textContent = '';
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
    if (!ac || !window.WebSocket || !navigator.mediaDevices) { status('Live voice does not work on this browser. Use the mic button instead.'); setTimeout(function () { end('unsupported'); }, 2500); return; }
    fetch('/api/voice/session', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'chat', page: opts.page || location.pathname, jobId: opts.jobId || null, language: opts.language || 'en' }) })
      .then(function (r) { return r.json(); })
      .then(function (info) {
        if (ended) return;
        if (!info || info.engine !== 'live') {
          var why = info && info.reason === 'plan' ? 'Live voice is part of the Local Pro, Contractor and Commercial plans. You can still use the mic button.' : info && info.reason === 'credits' ? 'You are out of assistant uses this month. Add credits to talk live, or type your question.' : 'Live voice is not available right now. Please type or use the mic button.';
          status(why); setTimeout(function () { end(info && info.reason || 'error'); }, 3500); return;
        }
        var max = (info.maxMinutes || 5) * 60000; startedAt = Date.now();
        endTimer = setTimeout(function () { status('Time is up for this call.'); setTimeout(function () { end('time'); }, 1200); }, max);
        tick = setInterval(function () { var left = Math.max(0, Math.round((max - (Date.now() - startedAt)) / 1000)); $('pm_lv_ft').textContent = T('Time left') + ': ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); }, 1000);
        ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=' + encodeURIComponent(info.token));
        ws.onopen = function () { ws.send(JSON.stringify({ setup: info.setup })); };
        ws.onerror = function () { status('The connection dropped.'); };
        ws.onclose = function () { if (!ended) { status('The call ended.'); setTimeout(function () { end('closed'); }, 1200); } };
        ws.onmessage = function (ev) {
          Promise.resolve(typeof ev.data === 'string' ? ev.data : ev.data.text()).then(function (raw) {
            var m; try { m = JSON.parse(raw); } catch (e) { return; }
            if (m.setupComplete) { if (ac.state === 'suspended') ac.resume(); startMic().catch(function () { status('Allow the microphone to talk live.'); setTimeout(function () { end('mic'); }, 2500); }); return; }
            var sc = m.serverContent; if (!sc) return;
            if (sc.interrupted) { stopPlayback(); }
            if (sc.inputTranscription && sc.inputTranscription.text) { if (curBot) flushTurn(); curUser += sc.inputTranscription.text; }
            if (sc.outputTranscription && sc.outputTranscription.text) curBot += sc.outputTranscription.text;
            (sc.modelTurn && sc.modelTurn.parts || []).forEach(function (pt) { var d = pt.inlineData || pt.inline_data; if (d && d.data) play(d.data); });
            if (sc.turnComplete) flushTurn();
            drawTx();
          });
        };
      })
      .catch(function () { status('Live voice is not available right now.'); setTimeout(function () { end('error'); }, 2500); });
  }
  box.addEventListener('click', function (e) {
    var t = e.target;
    if (t.id === 'pm_lv_end') end('user');
    if (t.id === 'pm_lv_mute') { muted = !muted; t.textContent = T(muted ? 'Unmute me' : 'Mute me'); status(muted ? 'You are muted.' : 'Listening. Talk any time.'); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ended) end('user'); });
  window.pmLive = { open: open, end: end };
})();

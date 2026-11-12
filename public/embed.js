/* PaintersMax embed: adds a "Get a free quote" button (or an inline form) to any website.
   <script src="https://paintersmax.app/embed.js" data-company="your-slug" async></script>
   Optional: data-label="Text on the button", data-color="#E8A33D", data-inline="#element-id" (shows the form inside that element instead of a button). */
(function () {
  var s = document.currentScript || document.querySelector('script[src*="embed.js"][data-company]');
  if (!s) return;
  var slug = String(s.getAttribute('data-company') || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,58}$/.test(slug)) return;
  var base = 'https://paintersmax.app/q/' + slug;
  var color = /^#[0-9a-fA-F]{3,8}$/.test(s.getAttribute('data-color') || '') ? s.getAttribute('data-color') : '#E8A33D';
  function frame(h) {
    var f = document.createElement('iframe');
    f.src = base; f.title = 'Free estimate'; f.loading = 'lazy';
    f.style.cssText = 'width:100%;max-width:560px;height:' + h + ';border:0;background:#fff';
    return f;
  }
  var inlineSel = s.getAttribute('data-inline');
  if (inlineSel) {
    var host = null;
    try { host = document.querySelector(inlineSel); } catch (e) {}
    if (host) host.appendChild(frame('900px'));
    return;
  }
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = s.getAttribute('data-label') || 'Get a free quote';
  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;border:0;border-radius:999px;padding:14px 20px;font:700 16px system-ui,sans-serif;color:#0F1B2D;background:' + color + ';box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer';
  var back = null;
  function close() { if (back) { back.remove(); back = null; document.removeEventListener('keydown', esc); } }
  function esc(e) { if (e.key === 'Escape') close(); }
  btn.onclick = function () {
    if (back) return;
    back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;z-index:2147483001;background:rgba(15,27,45,.6);display:flex;align-items:center;justify-content:center;padding:12px';
    var box = document.createElement('div');
    box.style.cssText = 'position:relative;width:100%;max-width:560px;height:92vh;background:#fff;border-radius:12px;overflow:hidden';
    var x = document.createElement('button');
    x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.style.cssText = 'position:absolute;top:6px;right:10px;z-index:1;border:0;background:#0F1B2D;color:#fff;width:34px;height:34px;border-radius:50%;font-size:22px;line-height:1;cursor:pointer';
    x.onclick = close;
    var f = frame('100%'); f.style.maxWidth = 'none';
    box.appendChild(x); box.appendChild(f); back.appendChild(box);
    back.onclick = function (e) { if (e.target === back) close(); };
    document.body.appendChild(back);
    document.addEventListener('keydown', esc);
  };
  document.body.appendChild(btn);
})();

/* Help videos: any element like <div data-help="welcome"></div> becomes a "Watch a short help video" button
 * when the admin has set a video for that spot (Marketing studio > Help videos). No video set = nothing shows.
 * The player opens in a dialog and loads YouTube only when opened. */
(function () {
  var spots = [].slice.call(document.querySelectorAll('[data-help]'));
  if (!spots.length) return;
  var es = window.PM_LANG === 'es';
  fetch('/api/help-videos', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.videos) return;
    spots.forEach(function (el) {
      var v = j.videos[el.getAttribute('data-help')];
      if (!v) return;
      var title = (es ? v.title.es : v.title.en) || v.title.en || v.title.es || (es ? 'Ver video de ayuda' : 'Watch a short help video');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'help-video-btn'; b.textContent = '▶ ' + title;
      b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;border:1px solid #cfd5dc;background:#fff;border-radius:20px;padding:6px 12px;font:600 13px system-ui,sans-serif;cursor:pointer;color:#0F1B2D';
      b.onclick = function () {
        var d = document.createElement('dialog');
        d.style.cssText = 'border:0;padding:0;border-radius:12px;max-width:min(92vw,' + (v.orient === 'tall' ? '380px' : '860px') + ');width:100%;overflow:hidden';
        d.innerHTML = '<div style="position:relative;aspect-ratio:' + (v.orient === 'tall' ? '9/16' : '16/9') + ';background:#000"><iframe src="https://www.youtube-nocookie.com/embed/' + v.yt + '?rel=0&modestbranding=1&playsinline=1&autoplay=1" title="" allow="autoplay;encrypted-media;picture-in-picture;fullscreen" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div><div style="padding:8px;text-align:right"><button type="button" style="padding:7px 14px;border-radius:8px;border:0;background:#eceae4;font:600 13px system-ui,sans-serif;cursor:pointer">' + (es ? 'Cerrar' : 'Close') + '</button></div>';
        d.querySelector('button').onclick = function () { d.close(); };
        d.addEventListener('close', function () { d.remove(); });
        document.body.appendChild(d); d.showModal();
      };
      el.appendChild(b);
    });
  }).catch(function () {});
})();

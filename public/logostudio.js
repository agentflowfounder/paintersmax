/* Logo studio, shared by /logo-studio (painters) and /marketing-admin (PaintersMax itself).
 * Needs /pmlogo.js and /pmhelp.js. Mount: PMLogoStudio.mount(element, { admin: false, msg: function (text, ok) {} }).
 * Saves up to 4 logo sets through /api/logos, lets you pick one to use everywhere, and converts uploaded logos to PNG. */
(function () {
  var CN = { box: 'Box with phone (business in a box)', cycle: 'Bid it, Book it, Bank it cycle', paint: 'Paint roller', pm: 'PM letters' };
  var DEF_ADMIN = { concept: 'box', shape: 'square', primary: '#1f3a5f', accent: '#e8833a', ink: '#ffffff', text: '#1f3a5f', slogan: true, sloganText: 'Bid it. Book it. Bank it.', name: 'PaintersMax' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var Q = function (k) { return window.PMHELP ? PMHELP.icon(k) : ''; };

  function mount(root, o) {
    o = o || {};
    var say = o.msg || function () {};
    var S = null, E = null, editing = '', dark = false, upload = null, busy = false;
    var def = function () {
      if (o.admin) return Object.assign({}, DEF_ADMIN);
      var c = S && S.brandColor ? S.brandColor : '#1f3a5f';
      return { concept: 'box', shape: 'square', primary: c, accent: '#e8833a', ink: '#ffffff', text: c, slogan: false, sloganText: '', name: (S && S.company) || 'My Painting Co' };
    };

    function api(body) {
      var fd = new FormData();
      for (var k in body) if (body[k] != null) fd.append(k, body[k]);
      return fetch('/api/logos', { method: 'POST', body: fd }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Something went wrong.'); e.reason = j.reason; throw e; } return j; }); });
    }
    function load() {
      return fetch('/api/logos').then(function (r) { if (r.status === 401) { location.href = '/login'; throw 0; } return r.json(); }).then(function (j) {
        S = j;
        if (!E) E = def();
        draw();
      });
    }
    function svgToPng(svg, w, h) {
      return new Promise(function (res, rej) {
        var img = new Image();
        img.onload = function () { var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not make the picture.')); }, 'image/png'); };
        img.onerror = function () { rej(new Error('Could not draw the logo.')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    }
    var dims = function (svg) { var m = svg.match(/viewBox="0 0 (\d+) (\d+)"/); return { w: +m[1], h: +m[2] }; };
    function fullPng(d) { var svg = PMLOGO.lockup(d), x = dims(svg); return svgToPng(svg, 1600, Math.round(1600 * x.h / x.w)); }
    function iconPng(d) { return svgToPng(PMLOGO.icon(d, 512), 512, 512); }
    function dl(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); }

    /* ---- upload converter: any common image -> clean PNGs (no hidden data), full + square icon ---- */
    function readImage(file) {
      return new Promise(function (res, rej) {
        if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) return rej(new Error('Use a PNG, JPG, WebP, GIF or SVG file.'));
        if (file.size > 8 * 1024 * 1024) return rej(new Error('That file is over 8 MB. Choose a smaller one.'));
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); if (!img.naturalWidth) return rej(new Error('This image has no size. Try exporting it again.')); res(img); };
        img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('We could not open that file.')); };
        img.src = url;
      });
    }
    function process(img, opt) {
      var iw = img.naturalWidth || 600, ih = img.naturalHeight || 600, sc = Math.min(1, 1600 / Math.max(iw, ih));
      var w = Math.max(1, Math.round(iw * sc)), h = Math.max(1, Math.round(ih * sc));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
      if (opt.whiteOut) { var d = g.getImageData(0, 0, w, h), p = d.data; for (var i = 0; i < p.length; i += 4) if (p[i] > 242 && p[i + 1] > 242 && p[i + 2] > 242) p[i + 3] = 0; g.putImageData(d, 0, 0); }
      // trim empty (transparent) margins so the logo fills its box
      var dd = g.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (dd[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
      var tw = x1 - x0 + 1, th = y1 - y0 + 1, pad = Math.round(Math.max(tw, th) * 0.04);
      var f = document.createElement('canvas'); f.width = tw + pad * 2; f.height = th + pad * 2;
      f.getContext('2d').drawImage(c, x0, y0, tw, th, pad, pad, tw, th);
      var ic = document.createElement('canvas'); ic.width = ic.height = 512; var ig = ic.getContext('2d'), s2 = Math.min(440 / f.width, 440 / f.height);
      ig.drawImage(f, (512 - f.width * s2) / 2, (512 - f.height * s2) / 2, f.width * s2, f.height * s2);
      return Promise.all([new Promise(function (r) { f.toBlob(r, 'image/png'); }), new Promise(function (r) { ic.toBlob(r, 'image/png'); })]).then(function (b) { return { full: b[0], icon: b[1], fc: f }; });
    }

    /* ---- screen ---- */
    var sec = function (id, title, help, open, body) { return '<details class="lsx" id="ls_' + id + '"' + (open ? ' open' : '') + '><summary><span>' + title + '</span>' + Q(help) + '</summary><div class="lsb">' + body + '</div></details>'; };
    function draw() {
      var sets = S.sets, empty = S.max - sets.length;
      var slots = sets.map(function (s) {
        var on = S.activeId === s.id;
        return '<div class="lset' + (on ? ' on' : '') + '" data-id="' + s.id + '"><img src="' + esc(s.full) + '" alt="' + esc(s.name) + '" loading="lazy"><div class="lrow"><b>' + esc(s.name) + '</b>' + (on ? '<span class="pill live">In use</span>' : '') + '</div><div class="lrow"><span class="lmut">' + (s.kind === 'upload' ? 'Uploaded' : 'Designed') + '</span></div>' +
          '<div class="lrow"><button class="btn" data-a="use"' + (on ? ' disabled' : '') + '>' + (on ? 'Using this one' : 'Use this logo') + '</button>' + (s.kind === 'studio' && s.design ? '<button class="btn sec" data-a="edit">Edit</button>' : '') + '<button class="btn sec" data-a="del">Delete</button></div></div>';
      }).join('') + Array(Math.max(0, empty)).fill('<div class="lset empty"><div class="lmut">Empty slot</div></div>').join('');
      var cost = S.freeLeft > 0 ? S.freeLeft + ' free design save' + (S.freeLeft === 1 ? '' : 's') + ' left. After that, each design save costs ' + S.cost + ' AI credit.' : 'Your free design saves are used. Each design save costs ' + S.cost + ' AI credit.';
      if (o.admin) cost = 'PaintersMax saves are always free.';
      var concepts = PMLOGO.CONCEPTS.map(function (c) { return '<button type="button" class="cc" data-c="' + c + '" aria-pressed="' + (E.concept === c) + '">' + PMLOGO.icon(Object.assign({}, E, { concept: c }), 90) + '<div>' + esc(CN[c]) + '</div></button>'; }).join('');
      var shapes = PMLOGO.SHAPES.map(function (s) { return '<button type="button" class="btn ' + (E.shape === s ? '' : 'sec') + '" data-s="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</button>'; }).join('');
      var design =
        '<p class="lmut">' + esc(editing ? 'Editing a saved logo. Saving replaces it.' : 'A new logo. Saving puts it in an empty slot.') + ' ' + esc(cost) + '</p>' +
        '<h4>1. Concept ' + Q('ls_concept') + '</h4><div class="concepts">' + concepts + '</div>' +
        '<h4>2. Shape ' + Q('ls_shape') + '</h4><div class="lrow">' + shapes + '</div>' +
        '<h4>3. Colors and words ' + Q('ls_colors') + '</h4><div class="lrow">' +
        '<label>Shape <input type="color" data-k="primary" value="' + E.primary + '"></label><label>Accent <input type="color" data-k="accent" value="' + E.accent + '"></label><label>Symbol <input type="color" data-k="ink" value="' + E.ink + '"></label><label>Name <input type="color" data-k="text" value="' + E.text + '"></label></div>' +
        '<div class="lrow"><label>Company name ' + Q('ls_name') + '<br><input data-k="name" maxlength="40" value="' + esc(E.name) + '" style="width:230px"> <small class="ctr" data-for="name"></small></label>' +
        '<label>Tagline ' + Q('ls_tagline') + '<br><input data-k="sloganText" maxlength="50" value="' + esc(E.sloganText) + '" placeholder="e.g. Quality since 1998" style="width:230px"> <small class="ctr" data-for="sloganText"></small></label>' +
        '<label><input type="checkbox" id="ls_sl"' + (E.slogan ? ' checked' : '') + '> Show tagline</label><label><input type="checkbox" id="ls_dk"' + (dark ? ' checked' : '') + '> Preview on dark</label></div>' +
        '<div class="lrow" style="justify-content:flex-end;margin:10px 0"><label style="margin-right:auto">Name this logo ' + Q('ls_setname') + '<br><input id="ls_setname" maxlength="40" value="' + esc(E._setName || '') + '" placeholder="e.g. Blue box" style="width:200px"> <small class="ctr" data-for="ls_setname"></small></label>' +
        '<button class="btn sec" id="ls_reset">Reset to default</button><button class="btn" id="ls_save"' + (busy ? ' disabled' : '') + '>Save this design</button></div>' +
        '<h4>Preview</h4><div id="ls_big" class="big' + (dark ? ' dark' : '') + '">' + PMLOGO.lockup(E) + '</div>';
      var up =
        '<p class="lmut">Already have a logo? Upload it here. We convert it for you: clean PNG, extra empty space trimmed, a square version for the browser tab, and nothing hidden left inside the file. Uploading is free.</p>' +
        '<input type="file" id="ls_file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"> ' + Q('ls_upload') +
        '<div id="ls_upbox"></div>';
      var files =
        '<p class="lmut">Download the logo you are designing as files. ' + Q('ls_files') + '</p><div class="lrow"><button class="btn" id="d_svg">Full logo (SVG)</button><button class="btn" id="d_png">Full logo (PNG)</button><button class="btn" id="d_icon">Icon (PNG 512)</button><button class="btn" id="d_fav">Browser tab icon (PNG 64)</button><button class="btn sec" id="d_mono">One color for print (SVG)</button></div>';
      var applied = S.activeId ? 'The logo marked <b>In use</b> shows on your documents, estimates, emails, customer portal, city pages, the browser tab and your website header. Pick another logo and everything updates by itself.' : 'No logo is in use yet. Save a logo, then press <b>Use this logo</b>.';
      root.innerHTML = '<style>.lsx{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;margin:0 0 12px}.lsx>summary{cursor:pointer;font:500 20px Newsreader,Georgia,serif;padding:12px 16px;list-style:none;display:flex;align-items:center;gap:4px}.lsx>summary::-webkit-details-marker{display:none}.lsx>summary:before{content:"\\25B8";font-size:14px;margin-right:6px;transition:transform .15s}.lsx[open]>summary:before{transform:rotate(90deg)}.lsb{padding:0 16px 16px}' +
        '.lset{border:2px solid #dcd6cc;border-radius:10px;padding:8px;background:#fff;display:grid;gap:6px;align-content:start}.lset.on{border-color:#0a7a3d;background:#f3fbf6}.lset.empty{border-style:dashed;place-items:center;min-height:140px}.lset img{width:100%;aspect-ratio:3/1;object-fit:contain;background:#fff;border-radius:6px}.lrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.lmut{color:#4A5568;font-size:14px}' +
        '.sets{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}.big{background:#fff;border:1px dashed #cfd5dc;border-radius:10px;padding:18px;text-align:center}.big.dark{background:#0F1B2D}.big svg{max-width:100%;height:auto}' +
        '.concepts{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}.cc{border:2px solid #dcd6cc;border-radius:10px;padding:8px;background:#fff;cursor:pointer;text-align:center;font:inherit}.cc[aria-pressed=true]{border-color:#E8A33D;background:#fff8ec}.cc svg{max-width:100%;height:auto}.ctr{color:#6b7380}' +
        '.lsb input:not([type=color]):not([type=checkbox]):not([type=file]){padding:8px;border:1px solid #cfd5dc;border-radius:8px;font:inherit}.lsb label{font-size:13px;font-weight:600}.lsb h4{margin:14px 0 6px}</style>' +
        sec('saved', 'Your saved logos (' + sets.length + ' of ' + S.max + ')', 'ls_saved', true,
          '<p class="lmut">' + applied + '</p><div class="sets">' + slots + '</div><div class="lrow" style="margin-top:10px">' + (sets.length === 0 ? '<button class="btn" id="ls_starter"' + (busy ? ' disabled' : '') + '>Create my 4 starter logos (free)</button>' : '') + (sets.length ? '<button class="btn sec" id="ls_clear">Remove all saved logos</button>' : '') + '</div><div id="ls_conf"></div>') +
        sec('design', 'Design a logo', 'ls_design', true, design) +
        sec('upload', 'Upload your own logo', 'ls_upload_h', false, up) +
        sec('files', 'Download files', 'ls_files_h', false, files) +
        sec('where', 'Where your logo is used', 'ls_where', false, '<ul class="lmut"><li><b>Documents and emails:</b> estimates, invoices, work orders, flyers, business cards and emails use the logo in use.</li><li><b>Customer portal and city pages:</b> the same logo.</li><li><b>Website:</b> every website template shows it in the header and as the browser tab icon, unless you picked a different photo as your website logo in the website editor. Changing templates keeps your logo.</li><li><b>Dashboard:</b> the browser tab icon and the top bar.</li></ul>');
      wire();
      counters();
    }
    function counters() {
      root.querySelectorAll('input[maxlength]:not([type=color])').forEach(function (i) {
        var span = root.querySelector('.ctr[data-for="' + (i.dataset.k || i.id) + '"]');
        if (!span) return;
        var up = function () { span.textContent = i.value.length + ' / ' + i.maxLength; };
        i.addEventListener('input', up); up();
      });
    }
    function redraw() { var open = {}; root.querySelectorAll('details.lsx').forEach(function (d) { open[d.id] = d.open; }); draw(); root.querySelectorAll('details.lsx').forEach(function (d) { if (d.id in open) d.open = open[d.id]; }); }
    function preview() { var b = root.querySelector('#ls_big'); if (b) b.innerHTML = PMLOGO.lockup(E); }
    function flow(fn) {
      if (busy) return; busy = true;
      return Promise.resolve().then(fn).catch(function (e) { if (e) say(e.message + (e.reason === 'no_credits' ? '' : ''), false); }).then(function () { busy = false; return load(); });
    }
    function saveDesign(d, name, setId) {
      return Promise.all([fullPng(d), iconPng(d)]).then(function (p) {
        return api({ action: 'save', kind: 'studio', name: name, setId: setId || '', design: JSON.stringify(d), full: new File([p[0]], 'full.png', { type: 'image/png' }), icon: new File([p[1]], 'icon.png', { type: 'image/png' }) });
      });
    }
    function wire() {
      root.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { E.concept = b.dataset.c; redraw(); }; });
      root.querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { E.shape = b.dataset.s; redraw(); }; });
      root.querySelectorAll('[data-k]').forEach(function (i) { i.oninput = function () { E[i.dataset.k] = i.value; preview(); }; });
      var sl = root.querySelector('#ls_sl'); sl.onchange = function () { E.slogan = sl.checked; preview(); };
      var dk = root.querySelector('#ls_dk'); dk.onchange = function () { dark = dk.checked; root.querySelector('#ls_big').className = 'big' + (dark ? ' dark' : ''); };
      var sn = root.querySelector('#ls_setname'); sn.oninput = function () { E._setName = sn.value; };
      root.querySelector('#ls_reset').onclick = function () { E = def(); editing = ''; say('Back to the default design.', true); redraw(); };
      root.querySelector('#ls_save').onclick = function () {
        var name = (E._setName || '').trim() || CN[E.concept].split(' (')[0];
        if (!editing && S.sets.length >= S.max) return say('You can save ' + S.max + ' logos. Delete one to make room.', false);
        flow(function () { var d = Object.assign({}, E); delete d._setName; return saveDesign(d, name, editing).then(function (r) { editing = r.id; say(r.charged ? 'Saved. That used ' + S.cost + ' AI credit.' : 'Saved.', true); }); });
      };
      var st = root.querySelector('#ls_starter');
      if (st) st.onclick = function () {
        flow(function () {
          var seq = PMLOGO.CONCEPTS.slice(0, S.max - S.sets.length), done = 0;
          return seq.reduce(function (p, c) { return p.then(function () { var d = Object.assign({}, def(), { concept: c }); return saveDesign(d, CN[c].split(' (')[0], '').then(function () { done++; }); }); }, Promise.resolve())
            .then(function () { say('Created ' + done + ' starter logos. Pick one and press Use this logo.', true); })
            .catch(function (e) { say((done ? 'Created ' + done + '. ' : '') + e.message, false); });
        });
      };
      var cl = root.querySelector('#ls_clear');
      if (cl) cl.onclick = function () {
        var box = root.querySelector('#ls_conf'); box.innerHTML = '<div class="lrow" style="margin-top:8px"><b style="color:#b42318">Remove all saved logos? Your free design saves stay used.</b><button class="btn" id="ls_yes">Yes, remove</button><button class="btn sec" id="ls_no">Cancel</button></div>';
        box.querySelector('#ls_no').onclick = function () { box.innerHTML = ''; };
        box.querySelector('#ls_yes').onclick = function () { flow(function () { return api({ action: 'clear' }).then(function () { editing = ''; say('All saved logos removed.', true); }); }); };
      };
      root.querySelectorAll('.lset[data-id]').forEach(function (card) {
        var id = card.dataset.id, s = S.sets.filter(function (x) { return x.id === id; })[0];
        card.querySelectorAll('[data-a]').forEach(function (b) {
          b.onclick = function () {
            var a = b.dataset.a;
            if (a === 'use') flow(function () { return api({ action: 'activate', setId: id }).then(function () { say('Now in use everywhere. The browser tab icon updates the next time a page loads.', true); }); });
            if (a === 'edit') { E = Object.assign(def(), s.design, { _setName: s.name }); if (!E.name) E.name = def().name; editing = id; redraw(); var d = root.querySelector('#ls_design'); d.open = true; d.scrollIntoView({ behavior: 'smooth' }); }
            if (a === 'del') flow(function () { return api({ action: 'delete', setId: id }).then(function () { if (editing === id) editing = ''; say('Deleted.', true); }); });
          };
        });
      });
      var dsvg = function () { return PMLOGO.lockup(E); };
      root.querySelector('#d_svg').onclick = function () { dl('logo.svg', new Blob([dsvg()], { type: 'image/svg+xml' })); };
      root.querySelector('#d_mono').onclick = function () { dl('logo-one-color.svg', new Blob([PMLOGO.lockup(Object.assign({}, E, { mono: true }))], { type: 'image/svg+xml' })); };
      root.querySelector('#d_png').onclick = function () { fullPng(E).then(function (b) { dl('logo.png', b); }); };
      root.querySelector('#d_icon').onclick = function () { iconPng(E).then(function (b) { dl('logo-icon-512.png', b); }); };
      root.querySelector('#d_fav').onclick = function () { svgToPng(PMLOGO.icon(E, 64), 64, 64).then(function (b) { dl('favicon-64.png', b); }); };
      var f = root.querySelector('#ls_file');
      f.onchange = function () {
        var file = f.files[0], box = root.querySelector('#ls_upbox'); if (!file) return;
        box.innerHTML = '<p class="lmut">Reading your file...</p>';
        readImage(file).then(function (img) {
          upload = { img: img, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), whiteOut: false };
          var show = function () {
            process(upload.img, upload).then(function (r) {
              upload.r = r;
              box.innerHTML = '<div class="lrow" style="margin:10px 0"><div><div class="lmut">Full logo</div><img id="up_full" style="max-width:260px;max-height:120px;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px;border:1px solid #cfd5dc"></div><div><div class="lmut">Square icon (browser tab)</div><img id="up_icon" style="width:96px;height:96px;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px;border:1px solid #cfd5dc"></div></div>' +
                '<label><input type="checkbox" id="up_white"' + (upload.whiteOut ? ' checked' : '') + '> Remove a white background ' + Q('ls_white') + '</label><div class="lrow"><label>Name this logo<br><input id="up_name" maxlength="40" value="' + esc(upload.name) + '"> <small class="ctr" data-for="up_name"></small></label><button class="btn" id="up_save"' + (S.sets.length >= S.max ? ' disabled title="All 4 slots are full. Delete one first."' : '') + '>Save uploaded logo (free)</button></div>';
              box.querySelector('#up_full').src = URL.createObjectURL(r.full); box.querySelector('#up_icon').src = URL.createObjectURL(r.icon);
              box.querySelector('#up_white').onchange = function (e) { upload.whiteOut = e.target.checked; show(); };
              var nm = box.querySelector('#up_name'); nm.oninput = function () { upload.name = nm.value; }; var span = box.querySelector('.ctr'); var u = function () { span.textContent = nm.value.length + ' / 40'; }; nm.addEventListener('input', u); u();
              box.querySelector('#up_save').onclick = function () {
                if (upload.r.full.size > 1500000 || upload.r.icon.size > 1500000) return say('The converted file is still too large. Try a simpler or smaller logo.', false);
                flow(function () { return api({ action: 'save', kind: 'upload', name: upload.name || 'My logo', full: new File([upload.r.full], 'full.png', { type: 'image/png' }), icon: new File([upload.r.icon], 'icon.png', { type: 'image/png' }) }).then(function () { box.innerHTML = ''; say('Saved. Press Use this logo to apply it.', true); }); });
              };
            }).catch(function (e) { box.innerHTML = ''; say(e.message, false); });
          };
          show();
        }).catch(function (e) { box.innerHTML = ''; say(e.message, false); });
      };
    }
    load().catch(function (e) { if (e) say(e.message, false); });
  }
  window.PMLogoStudio = { mount: mount };
})();

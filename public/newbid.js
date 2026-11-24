/* New bid screen (phone first). Loaded by /jobs before its main script; uses its helpers ($, esc, api, msg, J, noteAdd, shrinkImg).
 *  /jobs?new=1        customer information and the service
 *  /jobs?id=N&bid=1   the bid itself: describe the job by voice or typing, notes with photos, quick price, full estimate
 *  /jobs?services=1   every service's layout, with the suggested tools the painter can turn on or off
 */
let NBS = null; // service layouts
async function nbServices() { if (!NBS) NBS = (await api('/api/bidtools')).services; return NBS; }
const nbSvc = (t) => (NBS || []).find((s) => s.trade === t) || (NBS || [])[0];
const tt = (s) => (window.pmT ? window.pmT(s) : s);

// (214) 555-0123 as the painter types.
function phoneFmt(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length < 4) return d.length ? '(' + d : '';
  if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t && t.dataset && t.dataset.phone !== undefined) {
    const end = t.selectionStart === t.value.length;
    t.value = phoneFmt(t.value);
    if (end) t.setSelectionRange(t.value.length, t.value.length);
  }
});

// ---- Customer fields (shared by the New bid page and the bid screen) ----
function custFields(c) {
  c = c || {};
  return `<label for="n_name">Customer name</label><input id="n_name" autocomplete="off" value="${esc(c.name || '')}" placeholder="Example: Maria Lopez"><div id="n_found" class="sug" role="listbox" aria-label="Customers you already have"></div>
  <div class="row"><div><label for="n_phone">Phone</label><input id="n_phone" type="tel" inputmode="tel" data-phone value="${esc(phoneFmt(c.phone || '') || c.phone || '')}" placeholder="(214) 555-0123"></div><div><label for="n_email">Email</label><input id="n_email" type="email" inputmode="email" autocomplete="off" value="${esc(c.email || '')}" placeholder="maria@email.com"></div></div>
  <label for="n_addr">Job address</label><input id="n_addr" autocomplete="off" value="${esc(c.address || '')}" placeholder="Start typing: 123 Main St"><div id="n_sug" class="sug" role="listbox" aria-label="Address suggestions"></div>
  <div class="row3"><div><label for="n_city">City</label><input id="n_city" list="n_cities" value="${esc(c.city || '')}" placeholder="Dallas"></div><div><label for="n_state">State</label><input id="n_state" maxlength="2" value="${esc(c.state || '')}" placeholder="TX" style="text-transform:uppercase"></div><div><label for="n_zip">ZIP</label><input id="n_zip" inputmode="numeric" maxlength="10" value="${esc(c.zip || '')}" placeholder="75201"></div></div>
  <datalist id="n_cities">${(window.PM_CITIES || []).slice(0, 400).map((x) => `<option value="${esc(String(x).split(',')[0])}">`).join('')}</datalist>`;
}
const custVal = () => ({ name: $('n_name').value.trim(), phone: $('n_phone').value.trim(), email: $('n_email').value.trim(), address: $('n_addr').value.trim(), city: $('n_city').value.trim(), state: $('n_state').value.trim().toUpperCase(), zip: $('n_zip').value.trim() });
const custLine = (c) => [c.name, c.phone, [c.address, c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(' · ');

// Address lookup: Google suggestions when the key is set, otherwise a typed one-line address is split into the fields.
let addrTok = '', addrT = 0, addrOn = null;
const newTok = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
function splitLine(v) {
  const m = /^\s*(.+?),\s*([^,]+?),?\s+([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?\s*$/.exec(v || '');
  return m ? { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] } : null;
}
function fillAddr(p) { if (!p) return; if (p.address) $('n_addr').value = p.address; if (p.city) $('n_city').value = p.city; if (p.state) $('n_state').value = p.state; if (p.zip) $('n_zip').value = p.zip; $('n_sug').innerHTML = ''; }
document.addEventListener('input', (e) => {
  if (e.target.id === 'n_addr') {
    const v = e.target.value;
    const one = splitLine(v);
    if (one) { fillAddr(one); return; }
    clearTimeout(addrT);
    if (addrOn === false || v.trim().length < 4) { $('n_sug').innerHTML = ''; return; }
    addrT = setTimeout(async () => {
      if (!addrTok) addrTok = newTok();
      try {
        const r = await api('/api/address?s=' + encodeURIComponent(addrTok) + '&q=' + encodeURIComponent(v));
        addrOn = r.configured !== false;
        $('n_sug').innerHTML = (r.suggestions || []).map((s) => `<button type="button" role="option" data-place="${esc(s.id)}">${esc(s.text)}</button>`).join('');
      } catch (x) { /* lookup is a helper only */ }
    }, 300);
  } else if (e.target.id === 'n_name') {
    clearTimeout(addrT);
    const v = e.target.value.trim();
    if (v.length < 2 || !$('n_found')) { if ($('n_found')) $('n_found').innerHTML = ''; return; }
    addrT = setTimeout(async () => {
      try {
        const r = await api('/api/jobs?find=' + encodeURIComponent(v));
        window.NB_FOUND = r.customers || [];
        $('n_found').innerHTML = NB_FOUND.length ? `<small class="muted">${esc(tt('Already a customer? Tap to fill in their details.'))}</small>` + NB_FOUND.map((c, i) => `<button type="button" role="option" data-found="${i}">${esc(custLine(c))}</button>`).join('') : '';
      } catch (x) {}
    }, 300);
  }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-place],[data-found]');
  if (!b) return;
  if (b.dataset.found !== undefined) {
    const c = (window.NB_FOUND || [])[+b.dataset.found];
    if (c) { $('n_name').value = c.name || ''; $('n_phone').value = phoneFmt(c.phone || '') || c.phone || ''; $('n_email').value = c.email || ''; fillAddr(c); $('n_found').innerHTML = ''; }
    return;
  }
  try { const p = await api('/api/address?s=' + encodeURIComponent(addrTok) + '&place=' + encodeURIComponent(b.dataset.place)); addrTok = ''; fillAddr(p); } catch (x) { if (x) msg(x.message); }
});

// ---- Screen 1: New bid (customer and service) ----
async function newBid() {
  await nbServices();
  const ok = window.SpeechRecognition || window.webkitSpeechRecognition;
  $('view').innerHTML = `<p class="crumb"><a href="/jobs">&larr; Jobs</a></p>
  <h2>New bid</h2>
  <p class="lead">Start with the customer. Put in what you know now, and add the rest later. Customers who asked through your website are already waiting in your Jobs list.</p>
  <details class="acc" id="nb_cust" open><summary><span class="at">Enter the customer's information</span><span class="asub" id="nb_csum">Name, phone, email and job address</span></summary><div class="accin">
   ${custFields({})}
   <div class="btns"><button class="btn" id="nb_custok">Done</button></div></div></details>
  <label for="n_trade" style="margin-top:18px">What kind of work is it?</label>
  <select id="n_trade" class="bigsel"><option value="">Choose a service...</option>${NBS.map((s) => `<option value="${s.trade}">${esc(s.label)}</option>`).join('')}</select>
  <div class="btns" style="margin-top:16px"><button class="btn big" id="nb_go">Next: describe the job</button></div>
  <small class="muted" style="display:block;margin-top:8px">${ok ? 'On the next screen you can talk about the job and take photos.' : 'On the next screen you can type about the job and take photos.'}</small>`;
  const cust = $('nb_cust');
  $('nb_custok').onclick = () => {
    const c = custVal();
    if (!c.name) { msg('Add the customer name first.'); $('n_name').focus(); return; }
    msg(''); cust.open = false; $('nb_csum').textContent = custLine(c); $('n_trade').focus();
  };
  $('nb_go').onclick = async () => {
    const c = custVal(), trade = $('n_trade').value;
    if (!c.name) { cust.open = true; msg('Add the customer name first.'); $('n_name').focus(); return; }
    if (!trade) { msg('Choose the kind of work.'); $('n_trade').focus(); return; }
    const btn = $('nb_go'); btn.disabled = true; msg('');
    try {
      const r = await api('/api/jobs', { ...c, trade, title: `${nbSvc(trade).label} for ${c.name}`.slice(0, 120) });
      try { localStorage.setItem('pm_jobtab', 'open'); } catch (x) {}
      location.href = '/jobs?id=' + r.jobId + '&bid=1';
    } catch (x) { if (x) msg(x.message); btn.disabled = false; }
  };
  $('n_name').focus();
}

// ---- Screen 2: the bid ----
let NBQ = null; // last quick price
async function bidScreen(id) {
  await nbServices();
  const d = await api('/api/job?id=' + id);
  J = d; window.J = d;
  const j = d.job, L = d.layout || nbSvc(j.trade), bid = d.bid || { picks: [], tools: [] };
  const c = { name: j.customerName, phone: j.customerPhone, email: j.customerEmail, address: j.address, city: j.city, state: j.state, zip: j.zip };
  const reqText = d.request && d.request.description;
  $('view').innerHTML = `<p class="crumb"><a href="/jobs">&larr; Jobs</a> &middot; <a href="/jobs?id=${j.id}">Full job page</a></p>
  <div class="svch"><h2 id="nb_title">${esc(L.label)}</h2><button class="mini" id="nb_svcch">Change</button></div>
  <div id="nb_svcbox" style="display:none"><select id="nb_trade">${NBS.map((s) => `<option value="${s.trade}" ${s.trade === j.trade ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div>
  <details class="acc" id="nb_cust"><summary><span class="at">${esc(j.customerName)}</span><span class="asub">${esc(custLine({ ...c, name: '' }) || 'Tap to add phone, email and address')}</span></summary><div class="accin">
   ${custFields(c)}<div class="btns"><button class="btn" id="nb_custsave">Save</button></div></div></details>
  ${reqText ? `<div class="coach"><b>${esc(tt('What the customer asked for'))}</b><br>${esc(reqText)}</div>` : ''}
  <div class="card nbbox">
   <label for="nb_txt" style="margin-top:0">Describe the job</label>
   <textarea id="nb_txt" rows="6" placeholder="${esc(L.describe)}"></textarea>
   <div class="nbbtns"><button type="button" class="btn bigmic" id="nb_mic">${window.pmVoice ? pmVoice.MIC : ''}<span>Tap to talk</span></button><button type="button" class="btn sec" id="nb_add">Save as a note</button></div>
   <small class="muted">Talk like you would to your crew: the rooms, what needs fixing, colors, and anything special. Each time you tap Talk, a new note starts, so you can do one room at a time.</small>
  </div>
  <div class="card"><b>What does the work cover?</b><small class="muted" style="display:block">Tap all that fit. It helps the price and the estimate.</small>
   <div class="picks" id="nb_picks">${L.picks.map((p) => `<button type="button" class="pk ${bid.picks.includes(p) ? 'on' : ''}" data-pick="${esc(p)}" aria-pressed="${bid.picks.includes(p)}">${esc(tt(p))}</button>`).join('')}</div></div>
  <h3>Notes and photos</h3><div id="nb_notes"></div>
  <div class="card nbprice">
   <button class="btn big" id="nb_quick">Get a quick price</button>
   <small class="muted" style="display:block;margin-top:6px">A ballpark range from your notes and photos in a few seconds, to tell the customer on the spot. Uses one assistant question.</small>
   <div id="nb_qout"></div>
   <hr>
   <button class="btn big dark" id="nb_full">Write the full estimate</button>
   <small class="muted" style="display:block;margin-top:6px">Writes the scope and the lines from everything above, priced from your own price list. You check every price before anything goes to the customer.</small>
  </div>
  <div class="btns"><a class="btn sec" href="/jobs?id=${j.id}">Save and open the full job</a></div>
  <p class="muted" style="font-size:13px;margin-top:14px"><a href="/jobs?services=1#${esc(j.trade)}">Choose the suggested tools for each service</a></p>`;
  const nbsave = async (patch) => { try { const r = await api('/api/job', { action: 'bid', jobId: j.id, bid: { ...bid, ...patch } }); Object.assign(bid, r.bid); J.bid = r.bid; } catch (x) { if (x) msg(x.message); } };
  $('nb_picks').onclick = (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const p = b.dataset.pick, on = !bid.picks.includes(p);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    nbsave({ picks: on ? bid.picks.concat([p]) : bid.picks.filter((x) => x !== p) });
  };
  $('nb_svcch').onclick = () => { const b = $('nb_svcbox'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; };
  $('nb_trade').onchange = async (e) => {
    try { await api('/api/job', { action: 'update', jobId: j.id, trade: e.target.value }); await bidScreen(j.id); toast('Service changed'); } catch (x) { if (x) msg(x.message); }
  };
  $('nb_custsave').onclick = async () => {
    const v = custVal();
    try { await api('/api/job', { action: 'update', jobId: j.id, ...v }); await bidScreen(j.id); toast('Customer saved'); } catch (x) { if (x) msg(x.message); }
  };
  $('nb_add').onclick = () => { const t = $('nb_txt'); if (!t.value.trim()) { t.focus(); return; } noteAdd(t.value); t.value = ''; };
  $('nb_mic').onclick = () => {
    const t = $('nb_txt');
    if (!window.pmVoice) { t.focus(); return; }
    pmVoice.listen({ title: 'Describe the job', sub: 'Talk about the job. Your words show up as you speak. Tap Done when you finish, and it saves as a note.', onDone: (x) => { const typed = t.value.trim(); t.value = ''; noteAdd((typed ? typed + ' ' : '') + x); } });
  };
  $('nb_quick').onclick = quickPrice;
  $('nb_full').onclick = () => { location.href = '/jobs?id=' + j.id + '&draft=1'; };
  nbNotesDraw();
  if (typeof nqFlush === 'function') nqFlush();
  if (NBQ && NBQ.jobId === j.id) qpDraw(NBQ);
}
function nbNotesDraw() {
  const b = $('nb_notes'); if (!b || !J) return;
  const mine = (typeof nq === 'function' ? nq() : []).filter((n) => n.jobId === J.job.id);
  const all = (J.fieldNotes || []).concat(mine.filter((p) => !(J.fieldNotes || []).some((x) => x.id === p.id)).map((p) => ({ ...p, tag: 'pending' })));
  if (!all.length) { b.innerHTML = '<div class="card"><small class="muted">No notes yet. Tap Talk above, or type and tap Save as a note.</small></div>'; return; }
  b.innerHTML = all.slice().reverse().map((n) => `<div class="card nbnote"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="ntag ${n.tag}">${esc(tt(n.tag === 'pending' ? 'Waiting for signal' : NTAG[n.tag] || n.tag))}</span><small class="muted">${esc(new Date(n.at).toLocaleString(window.PM_LANG === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</small></div>
   <div style="margin:6px 0;white-space:pre-wrap">${esc(n.text)}</div>
   ${(n.photos || []).length ? `<div class="nbph">${n.photos.map((f) => `<a href="/api/files?id=${f}" target="_blank" rel="noopener"><img src="/api/files?id=${f}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
   ${n.tag === 'pending' ? '' : `<div class="btns" style="margin-top:6px"><label class="btn sec cam"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="4"/></svg><span>Take a photo</span><input type="file" accept="image/*" capture="environment" data-nphoto="${esc(n.id)}" style="display:none"></label><label class="btn sec cam"><span>From the gallery</span><input type="file" accept="image/*" multiple data-nphoto="${esc(n.id)}" style="display:none"></label><button class="mini" data-fndel="${esc(n.id)}">Delete</button></div>`}</div>`).join('');
}
document.addEventListener('change', async (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.nphoto || !J) return;
  const files = [...t.files]; t.value = '';
  for (const f of files.slice(0, 12)) {
    try {
      msg('Adding photo...', true);
      const bl = await shrinkImg(f), fd = new FormData(); fd.append('file', bl); fd.append('jobId', J.job.id); fd.append('kind', 'photo');
      const r = await fetch('/api/files', { method: 'POST', body: fd }); const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg(j.error || 'Could not add the photo.'); break; }
      const n = await api('/api/job', { action: 'notePhoto', jobId: J.job.id, id: t.dataset.nphoto, fileId: j.id });
      J.fieldNotes = n.notes; nbNotesDraw();
    } catch (x) { msg('Could not add the photo.'); break; }
  }
  msg('');
});
async function quickPrice() {
  const b = $('nb_quick'); if (!b || !J) return;
  if (typeof nqFlush === 'function') await nqFlush();
  b.disabled = true; b.textContent = tt('Working out a price...'); msg('');
  try { const r = await api('/api/estimate', { action: 'quickPrice', jobId: J.job.id }); NBQ = { ...r, jobId: J.job.id }; qpDraw(NBQ); }
  catch (x) { if (x) msg(x.message); }
  b.disabled = false; b.textContent = tt('Get a quick price again');
}
function qpDraw(r) {
  const o = $('nb_qout'); if (!o || !J) return;
  const L = J.layout || nbSvc(J.job.trade), bid = J.bid || { tools: [] };
  const on = (t) => (bid.tools && bid.tools.length ? bid.tools.includes(t.id) : t.on);
  const m = (c) => '$' + Math.round(c / 100).toLocaleString('en-US');
  o.innerHTML = `<div class="qp"><div class="qpr">${m(r.lowCents)} <span>to</span> ${m(r.highCents)}</div>
   ${r.reason ? `<p style="margin:6px 0">${esc(r.reason)}</p>` : ''}
   <small class="muted">${r.hasPriceList ? 'Based on your own prices.' : 'You have no prices for this service yet, so this uses typical prices for your area.'} A ballpark only: the full estimate is what the customer signs.</small>
   ${(r.steps || []).length ? `<b style="display:block;margin-top:10px">To firm up the price</b><ul>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
   <b style="display:block;margin-top:10px">Next steps for this bid</b><small class="muted" style="display:block">Tick what you want. Ticked steps show on the job page and go into the full estimate.</small>
   ${L.tools.map((t) => `<label class="tool"><input type="checkbox" data-tool="${esc(t.id)}" ${on(t) ? 'checked' : ''}><span><b>${esc(tt(t.label))}</b><br><small class="muted">${esc(tt(t.hint))}</small></span></label>`).join('')}
   ${window.pmThumbs && r.ai ? '<div>' + window.pmThumbs(r.ai) + '</div>' : ''}</div>`;
}
document.addEventListener('change', async (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.tool || !J) return;
  const L = J.layout || nbSvc(J.job.trade), bid = J.bid || { picks: [], tools: [] };
  const cur = bid.tools && bid.tools.length ? bid.tools.slice() : L.tools.filter((x) => x.on).map((x) => x.id);
  const next = t.checked ? [...new Set(cur.concat([t.dataset.tool]))] : cur.filter((x) => x !== t.dataset.tool);
  try { const r = await api('/api/job', { action: 'bid', jobId: J.job.id, bid: { picks: bid.picks || [], tools: next } }); J.bid = r.bid; } catch (x) { if (x) msg(x.message); }
});

// ---- Screen 3: service layouts, with each suggested tool on or off ----
async function servicesPage() {
  const { services } = await api('/api/bidtools'); NBS = services;
  $('view').innerHTML = `<p class="crumb"><a href="/jobs">&larr; Jobs</a></p><h2>Your bid screens</h2>
  <p class="lead">Each service has its own bid screen. Here is what each one shows. Turn a suggested tool on or off, and new bids for that service start that way. You can still tick any tool on a single bid.</p>
  ${services.map((s) => `<details class="acc" id="${esc(s.trade)}"><summary><span class="at">${esc(tt(s.label))}</span><span class="asub">${s.tools.filter((t) => t.on).length} ${esc(tt('of'))} ${s.tools.length} ${esc(tt('tools on'))}</span></summary><div class="accin">
   <b>Describe the job box</b><p class="muted" style="margin:4px 0 10px">${esc(s.describe)}</p>
   <b>Quick picks</b><div class="picks" style="margin:6px 0 10px">${s.picks.map((p) => `<span class="pk">${esc(tt(p))}</span>`).join('')}</div>
   <b>Suggested tools</b>${s.tools.map((t) => `<label class="tool"><input type="checkbox" data-svctool="${esc(s.trade)}|${esc(t.id)}" ${t.on ? 'checked' : ''}><span><b>${esc(tt(t.label))}</b><br><small class="muted">${esc(tt(t.hint))}</small></span></label>`).join('')}
  </div></details>`).join('')}`;
  wordCard();
  const h = (location.hash || '').slice(1), el = h && document.getElementById(h);
  if (el) { el.open = true; el.scrollIntoView({ block: 'start' }); }
}
// The painter's word list: fixes for trade words the phone mishears when dictating.
async function wordCard() {
  let w; try { w = await api('/api/wordlist'); } catch (e) { return; }
  const box = document.createElement('div'); box.className = 'card'; box.id = 'wordcard'; box.style.marginTop = '16px';
  const rows = (w.custom || []).map((p) => p.join(' = '));
  box.innerHTML = `<b>${esc(tt('My word list'))}</b><p class="muted" style="margin:4px 0 8px">${esc(tt('Phones mishear trade words. Add what the phone writes and what you mean, one per line, like: sheet rock = Sheetrock. It fixes your voice notes as you finish talking.'))}</p>
   <textarea id="wl_t" rows="5" placeholder="sheet rock = Sheetrock">${esc(rows.join('\n'))}</textarea>
   <div class="btns"><button class="btn sec" id="wl_save" type="button">${esc(tt('Save my word list'))}</button></div>
   <small class="muted">${esc(tt('Already fixed for you:'))} ${esc((w.defaults || []).map((p) => p[0] + ' = ' + p[1]).join(' · '))}</small>`;
  $('view').appendChild(box);
  $('wl_save').onclick = async () => {
    const custom = $('wl_t').value.split(/\n/).map((l) => l.split('=').map((x) => x.trim())).filter((p) => p.length >= 2 && p[0] && p[1]);
    try { const r = await api('/api/wordlist', { custom }); $('wl_t').value = r.custom.map((p) => p.join(' = ')).join('\n'); toast('Saved'); } catch (x) { if (x) msg(x.message); }
  };
}
document.addEventListener('change', async (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.svctool) return;
  const [trade, tool] = t.dataset.svctool.split('|');
  try { const r = await api('/api/bidtools', { trade, tool, on: t.checked }); NBS = r.services; toast('Saved'); } catch (x) { if (x) msg(x.message); t.checked = !t.checked; }
});

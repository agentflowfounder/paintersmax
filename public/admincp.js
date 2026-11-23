/* PaintersMax admin control panel: tabs by role, client page, subscriptions, credits and envelopes, promotions,
 * marketing research, feedback inbox, held domains, team and audit log. Uses esc, $, msg and api from admin.html.
 * Every change is checked on the server for the signed-in person's role and written to the audit log. */
(function () {
  'use strict';
  var T = window.pmT || function (s) { return s; };
  var ME = null, CACHE = {};
  var TABS = [
    ['clients', 'Clients', 'clients'], ['subs', 'Subscriptions', 'subscriptions'], ['credits', 'Credits', 'credits'], ['starter', 'Starter campaign', 'credits'], ['aihealth', 'AI health', 'credits'], ['promos', 'Promotions', 'promos'],
    ['research', 'Research', 'research'], ['feedback', 'Feedback', 'feedback'], ['domains', 'Domains', 'domains'], ['sites', 'Websites', 'sites'],
    ['content', 'Help guide', 'content'], ['launch', 'Launch checklist', 'settings'], ['settings', 'Settings', 'settings'], ['security', 'Team and audit log', 'security'],
  ];
  var DOOR = { free: 'Free', launch: 'Local Pro', grow: 'Contractor', signature: 'Commercial' };
  var doorName = function (k) { return k === 'free' ? esc(T('Free')) : '<span translate="no">' + esc(DOOR[k] || k) + '</span>'; };
  var doorOpts = function (cur) { return Object.keys(DOOR).map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + (k === 'free' ? '' : ' translate="no"') + '>' + esc(k === 'free' ? T('Free') : DOOR[k]) + '</option>'; }).join(''); };
  var STATE = { free: 'Free', paid: 'Paid', due_60: 'Renews in 60 days', due_30: 'Renews in 30 days', missed: 'Missed renewal', cancelled: 'Cancelled', refunded: 'Refunded' };
  var STATE_PILL = { missed: 'red', due_30: 'gold', due_60: 'gold', paid: 'green', cancelled: '', refunded: '', free: '' };
  var OUTREACH = { none: 'No outreach yet', todo: 'To contact', contacted: 'Contacted', won_back: 'Won back', declined: 'Declined' };
  var FLAG = { needs_help: 'Needs help', at_risk: 'At risk', vip: 'VIP', trade_group: 'Trade group', do_not_contact: 'Do not contact' };
  var GROUP = { website: 'Website and color', estimates: 'Photo analysis and estimates', assistant: 'Job assistant and deep answers', automation: 'Automation (invoices, receipts, reads)', marketing: 'Marketing (posts, emails, images)' };
  var CONTACT = { new: 'New', called: 'Called', texted: 'Texted', emailed: 'Emailed', visited: 'Visited', no_answer: 'No answer', free: 'Free account', paid: 'Paid', declined: 'Declined' };
  var CHANNEL = { season: 'Season offer', founding: 'Founding painters', referral: 'Referral', store: 'Paint store card', event: 'Event or meeting', ad: 'Ad campaign', winback: 'Win-back', upgrade: 'Upgrade credit', trade_group: 'Trade group', other: 'Other' };
  var KIND = { floor: 'Land on the floor price', percent: 'Percent off the list price', amount: 'Dollars off the list price' };
  var QUEUE = { expires_60: 'Expires within 60 days', expires_30: 'Expires within 30 days', expires_7: 'Expires within 7 days', expired: 'Expired', reuse_ready: 'Ready to reuse', transfer_requested: 'Transfer asked' };
  var DSTATUS = { active: 'Active', transfer_requested: 'Transfer asked', transferred: 'Transferred', released: 'Released', pool: 'Reuse pool' };
  var FBKIND = { bug: 'Bug', idea: 'Idea', question: 'Question', support: 'Support', other: 'Other' };
  var FBSTATUS = { new: 'New', waiting: 'Client wrote again', answered: 'Answered', closed: 'Closed' };

  var canSee = function (a) { return !!ME && ME.see.indexOf(a) >= 0; };
  var canChange = function (a) { return !!ME && ME.change.indexOf(a) >= 0; };
  var money = function (c) { c = Number(c) || 0; return '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100)); };
  var d = function (s) { return s ? (window.pmDate ? window.pmDate(String(s).slice(0, 10)) : String(s).slice(0, 10)) : ''; };
  var opts = function (map, cur) { return Object.keys(map).map(function (k) { return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); };
  var pill = function (txt, cls) { return '<span class="pill ' + (cls || '') + '">' + esc(txt) + '</span>'; };
  var post = function (b) { return api('/api/admin', b); };
  var ok = function (t) { msg(T(t), true); };
  var bad = function (x) { if (x) msg(x.message || String(x)); };
  var dis = function (area) { return canChange(area) ? '' : ' disabled'; };

  // ------------------------------------------------------------- tabs and routing
  function drawTabs(cur) {
    $('tabs').innerHTML = TABS.filter(function (t) { return canSee(t[2]); }).map(function (t) {
      var href = t[0] === 'sites' ? '/sites-admin' : '#' + t[0];
      return '<a href="' + href + '"' + (t[0] === cur ? ' class="on" aria-current="page"' : '') + '>' + esc(T(t[1])) + '</a>';
    }).join('');
  }
  function route() {
    var h = (location.hash || '').slice(1) || 'clients';
    var parts = h.split('/');
    var tab = parts[0];
    if (tab === 'client') tab = 'client';
    var allowedTab = TABS.filter(function (t) { return t[0] === tab && canSee(t[2]); })[0];
    if (tab !== 'client' && !allowedTab) tab = TABS.filter(function (t) { return canSee(t[2]) && t[0] !== 'sites'; })[0][0];
    drawTabs(tab === 'client' ? 'clients' : tab);
    [].forEach.call(document.querySelectorAll('section.area'), function (s) { s.classList.toggle('on', s.getAttribute('data-area') === tab); });
    msg('');
    var f = LOAD[tab];
    if (f) f(parts[1]);
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------- clients
  // A tap-to-call link: digits only in the link, the number as typed on screen.
  function telLink(ph) { var dg = String(ph || '').replace(/[^0-9+]/g, ''); return dg.replace(/\D/g, '').length >= 7 ? '<a class="lk" href="tel:' + esc(dg) + '">&#9742; ' + esc(T('Call this painter')) + '</a> <small>' + esc(ph) + '</small>' : ''; }
  function signupsCard() {
    api('/api/admin?signups=1').then(function (v) {
      var list = function (a, f) { return a.length ? a.map(function (x) { return '<tr><td>' + esc(f ? f(x.name) : x.name) + '</td><td>' + x.count + '</td></tr>'; }).join('') : '<tr><td><small>None yet.</small></td><td></td></tr>'; };
      var DN = { free: 'Free', launch: 'Local Pro', grow: 'Contractor', signature: 'Commercial' };
      $('su_box').innerHTML = '<div class="card"><h3>Sign-ups this week</h3><div class="tiles"><div class="tile"><b>' + v.total + '</b><span>New accounts, last 7 days</span></div>' +
        v.perDay.map(function (x) { return '<div class="tile"><b>' + x.count + '</b><span>' + esc(x.day.slice(5)) + '</span></div>'; }).join('') + '</div>' +
        '<div class="g3"><div><h4>By source</h4><table class="t"><tbody>' + list(v.bySource) + '</tbody></table></div><div><h4>By tier picked</h4><table class="t"><tbody>' + list(v.byDoor, function (n) { return DN[n] || n; }) + '</tbody></table></div><div><h4>How they heard</h4><table class="t"><tbody>' + list(v.byHeard) + '</tbody></table></div></div>' +
        (v.latest.length ? '<h4>Newest</h4><table class="t"><tbody>' + v.latest.map(function (r) {
          var m = r.msg || {}, tx = encodeURIComponent(m.body || '');
          return '<tr><td><a class="lk" href="#client/' + r.companyId + '">' + esc(r.name || ('#' + r.companyId)) + '</a><br><small>' + esc(r.city || '') + ' &middot; ' + esc(r.on.slice(5)) + '</small></td><td>' +
            (r.email ? '<a class="lk" href="mailto:' + esc(r.email) + '?subject=' + encodeURIComponent(m.subject || '') + '&body=' + tx + '">' + esc(T('Reply by email')) + '</a> ' : '') +
            (r.phone ? '<a class="lk" href="sms:' + esc(String(r.phone).replace(/[^0-9+]/g, '')) + '?&body=' + tx + '">' + esc(T('Reply by text')) + '</a> ' + telLink(r.phone) : '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '') + '</div>';
    }).catch(function () { $('su_box').textContent = ''; });
  }
  function clientsLoad() {
    signupsCard();
    api('/api/admin?clients=1').then(function (v) {
      CACHE.clients = v.clients;
      $('cl_box').innerHTML = '<div class="g4"><div><label>Search</label><input id="cl_q" placeholder="Name, email or slug"></div>' +
        '<div><label>Door</label><select id="cl_door"><option value="">All</option>' + doorOpts('') + '</select></div>' +
        '<div><label>Status</label><select id="cl_state"><option value="">All</option>' + opts(STATE) + '</select></div>' +
        '<div><label>Flag</label><select id="cl_flag"><option value="">All</option>' + opts(FLAG) + '</select></div></div><div id="cl_list" class="scroll" style="margin-top:12px"></div>';
      ['cl_q', 'cl_door', 'cl_state', 'cl_flag'].forEach(function (id) { $(id).addEventListener('input', clientsDraw); });
      clientsDraw();
    }).catch(function (x) { $('cl_box').textContent = x ? x.message : ''; });
  }
  function clientsDraw() {
    var q = $('cl_q').value.trim().toLowerCase(), door = $('cl_door').value, st = $('cl_state').value, fl = $('cl_flag').value;
    var rows = CACHE.clients.filter(function (c) {
      return (!q || (c.name + ' ' + (c.owners || '') + ' ' + c.slug).toLowerCase().indexOf(q) >= 0) && (!door || c.door === door) && (!st || c.state === st) && (!fl || c.flags.indexOf(fl) >= 0);
    });
    $('cl_list').innerHTML = '<small><b>' + rows.length + '</b> <span>of</span> <b>' + CACHE.clients.length + '</b> <span>clients</span></small>' +
      '<table class="t"><thead><tr><th>Client</th><th>Door</th><th>Status</th><th>Renews</th><th>Jobs</th><th>Leads</th><th>Last sign-in</th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr><td><a class="lk" href="#client/' + c.id + '">' + esc(c.name) + '</a><br><small>' + esc(c.owners || T('no login yet')) + '</small>' + (c.phone ? '<br>' + telLink(c.phone) : '') + '<br>' + c.flags.map(function (f) { return pill(T(FLAG[f]), f === 'at_risk' || f === 'do_not_contact' ? 'red' : 'gold'); }).join('') + '</td>' +
          '<td>' + doorName(c.door) + '</td><td>' + pill(T(STATE[c.state]), STATE_PILL[c.state]) + '</td><td>' + esc(d(c.renewsOn)) + '</td><td>' + c.jobs + '</td><td>' + c.leads + '</td><td>' + esc(d(c.lastSignIn)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ------------------------------------------------------------- one client
  function clientLoad(id) {
    $('cp_box').innerHTML = T('Loading...');
    api('/api/admin?client=' + encodeURIComponent(id)).then(function (v) { CACHE.client = v; clientDraw(v); }).catch(function (x) { $('cp_box').textContent = x ? x.message : ''; });
  }
  function clientDraw(v) {
    var c = v.company, s = v.subscription, e = v.envelopes;
    var h = '<p><a class="lk" href="#clients">&larr; <span>All clients</span></a></p><h2>' + esc(c.name) + '</h2><p><small>' + esc(c.slug) + ' &middot; <span>Joined</span> ' + esc(d(c.createdAt)) + ' &middot; <span>Client number</span> ' + c.id + '</small>' + (v.phone ? '<br>' + telLink(v.phone) : '') + '</p>';
    // Summary
    h += '<div class="tiles"><div class="tile"><b>' + doorName(v.door) + '</b><span>Door</span></div><div class="tile"><b>' + esc(T(STATE[v.state])) + '</b><span>Status</span></div>' +
      '<div class="tile"><b>' + v.credits.balance + '</b><span>Credits left</span></div><div class="tile"><b>' + (v.counts.leads || 0) + '</b><span>Leads</span></div><div class="tile"><b>' + (v.counts.jobs || 0) + '</b><span>Jobs</span></div></div>';
    // Door and plan
    h += '<div class="card"><h3>Door and plan</h3><div class="g2"><div><label>Door (what the website includes)</label><select id="cp_door"' + dis('subscriptions') + '>' + doorOpts(v.door) + '</select></div>' +
      '<div><label>App plan (sets the monthly AI amounts)</label><select data-id="' + c.id + '"' + dis('subscriptions') + '>' + ['free', 'starter', 'basic', 'pro'].map(function (p) { return '<option value="' + p + '"' + (p === c.plan ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></div></div>' +
      '<small><span>Stripe customer</span>: ' + (c.stripeCustomer ? T('yes') : T('no')) + ' &middot; <span>Stripe subscription</span>: ' + (c.stripeSubscription ? T('yes') : T('no')) + '</small></div>';
    // Subscription
    h += '<div class="card"><h3>Yearly subscription</h3>' + (s ? '<p>' + pill(T(STATE[v.state]), STATE_PILL[v.state]) + (s.daysToRenewal !== null && s.daysToRenewal !== undefined ? ' <small><span>Days to renewal</span>: <b>' + s.daysToRenewal + '</b></small>' : '') + (s.refundUntil ? ' ' + pill(T('In the refund window until') + ' ' + d(s.refundUntil), 'gold') + ' <small><span>Refund would be</span> ' + money(s.refundCents) + '</small>' : '') + (s.founding ? ' ' + pill(T('Founding painter'), 'gold') : '') + '</p>' : '<p><small>No paid year recorded yet. Fill this in when the client pays for a door.</small></p>') +
      '<div class="g3"><div><label>Paid year started</label><input id="sb_start" type="date" value="' + esc(s ? s.startedOn : '') + '"></div><div><label>Renewal due</label><input id="sb_renew" type="date" value="' + esc(s ? s.renewsOn : '') + '"></div>' +
      '<div><label>Status</label><select id="sb_status">' + opts({ active: 'Active', cancelled: 'Cancelled', refunded: 'Refunded' }, s ? s.status : 'active') + '</select></div>' +
      '<div><label>Paid for this year ($)</label><input id="sb_paid" inputmode="decimal" value="' + (s ? (s.paidCents / 100) : '') + '"></div><div><label>Next renewal ($, blank = the door\'s floor)</label><input id="sb_renewal" inputmode="decimal" value="' + (s && s.renewalCents ? s.renewalCents / 100 : '') + '" placeholder="' + (s ? s.renewalCents / 100 : '') + '"></div>' +
      '<div><label>Promo code used</label><input id="sb_code" value="' + esc(s ? s.promoCode : '') + '"></div></div><label class="chk"><input type="checkbox" id="sb_found"' + (s && s.founding ? ' checked' : '') + '> <span>Founding painter (badge, floor price for life on renewals)</span></label>' +
      '<div><button class="btn" id="sb_save"' + dis('subscriptions') + '>Save subscription</button></div>' +
      (s ? '<div class="g2" style="margin-top:12px"><div><label>Renewal paid: amount ($)</label><input id="sb_rpaid" inputmode="decimal" value="' + s.renewalCents / 100 + '"></div><div style="align-self:end"><button class="btn" id="sb_renewed"' + dis('subscriptions') + '>Mark the renewal paid</button></div></div>' +
        '<h3 style="margin-top:16px">Outreach</h3><small>A missed renewal never shuts the site off. Reach out with help, a win-back offer (floor price plus credits) or a lead pack for their city.</small>' +
        '<div class="g2"><div><label>Outreach status</label><select id="sb_out"' + (canChange('subscriptions') || canChange('research') ? '' : ' disabled') + '>' + opts(OUTREACH, s.outreach) + '</select></div><div><label>Note</label><input id="sb_onote" maxlength="300" value="' + esc(s.outreachNote) + '"></div></div>' +
        (s.outreachOn ? '<small><span>Last outreach update</span> ' + esc(d(s.outreachOn)) + '</small>' : '') + '<div><button class="btn" id="sb_osave"' + (canChange('subscriptions') || canChange('research') ? '' : ' disabled') + '>Save outreach</button></div>' : '') + '</div>';
    // Credits and envelopes
    h += '<div class="card"><h3>AI credits</h3><p><b>' + v.credits.balance + '</b> <span>credits left</span>' + (v.credits.nextExpiry ? ' &middot; <b>' + v.credits.nextExpiry.credits + '</b> <span>run out on</span> ' + esc(d(v.credits.nextExpiry.on)) : '') + '</p>' +
      '<div class="scroll"><table class="t"><thead><tr><th>Added</th><th>Source</th><th>Credits</th><th>Left</th><th>Ends</th><th>Note</th></tr></thead><tbody>' + v.credits.grants.map(function (g) { return '<tr><td>' + esc(d(g.on)) + '</td><td>' + esc(T(g.source)) + '</td><td>' + g.credits + '</td><td>' + g.left + '</td><td>' + esc(d(g.expiresOn)) + (g.expired ? ' ' + pill(T('ended'), '') : '') + '</td><td>' + esc(g.note) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<h3 style="margin-top:16px">Apply a credit bundle</h3><small>Adds admin credits (they last 90 days). Optionally point them at envelopes so the client spends them where they want, for example more on the color studio and less on the job assistant.</small>' +
      '<div class="g3"><div><label>Credits</label><input id="bd_n" inputmode="numeric" placeholder="250"></div><div><label>Note</label><input id="bd_note" maxlength="100" placeholder="Holiday bundle"></div><div style="align-self:end"><label class="chk"><input type="checkbox" id="bd_caps"> <span>Also set the envelopes below</span></label></div></div>' +
      '<div><button class="btn" id="bd_go"' + dis('credits') + '>Apply the bundle</button></div>' +
      '<h3 style="margin-top:16px">Envelopes and AI model</h3><small>Envelopes are monthly caps on the credits each group of tools may use. A blank box means no cap. The monthly amounts that come with the plan are not affected.</small>' +
      '<div><label class="chk"><input type="checkbox" id="ev_on"' + (e.enabled ? ' checked' : '') + '> <span>Use envelopes for this client</span></label><label class="chk"><input type="checkbox" id="ev_pt"' + (e.painterCanEdit ? ' checked' : '') + '> <span>Let the painter change them (Pro feature)</span></label></div>' +
      '<div class="scroll"><table class="t"><thead><tr><th>Group</th><th>Monthly cap (credits)</th><th>Used this month</th></tr></thead><tbody>' + Object.keys(GROUP).map(function (g) {
        return '<tr><td>' + esc(T(GROUP[g])) + '</td><td><input data-cap="' + g + '" inputmode="numeric" style="max-width:120px" value="' + (e.caps[g] !== undefined ? e.caps[g] : '') + '"></td><td>' + (e.used[g] || 0) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="g2"><div><label>Text model for this client\'s everyday tools</label><select id="ev_model">' + opts({ 'default': 'Platform default (Settings tab)', gemini: 'Gemini', haiku: 'Claude Haiku' }, e.textModel) + '</select></div></div>' +
      (e.setBy ? '<small><span>Last changed by</span> ' + esc(e.setBy) + ' <span>on</span> ' + esc(d(e.setOn)) + '</small>' : '') + '<div><button class="btn" id="ev_save"' + dis('credits') + '>Save envelopes and model</button></div></div>';
    // Usage
    h += '<div class="card"><h3>AI use this month</h3>' + (v.usage.length ? '<div class="scroll"><table class="t"><thead><tr><th>Tool</th><th>Used</th><th>Monthly amount</th><th>Paid with credits</th><th>Credits</th><th>Turned away</th></tr></thead><tbody>' + v.usage.map(function (u) { return '<tr><td>' + esc(T(u.label)) + '</td><td>' + u.used + '</td><td>' + u.limit + '</td><td>' + u.creditUses + '</td><td>' + u.credits + '</td><td>' + u.missed + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<small>No AI use this month yet.</small>') + '</div>';
    // People, domains, feedback
    h += '<div class="card"><h3>Logins</h3><table class="t"><thead><tr><th>Email</th><th>Role</th><th>Last sign-in</th></tr></thead><tbody>' + v.users.map(function (u) { return '<tr><td>' + esc(u.email) + '</td><td>' + esc(u.role) + '</td><td>' + esc(d(u.lastSignIn)) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h3 style="margin-top:16px">Domains</h3>' + (v.domains.length || v.connected.length ? v.domains.map(function (x) { return '<div><b>' + esc(x.name) + '</b> ' + pill(T(DSTATUS[x.status])) + (x.reason ? pill(T(QUEUE[x.reason]), 'gold') : '') + ' <small><span>expires</span> ' + esc(d(x.expiresOn)) + '</small></div>'; }).join('') + v.connected.map(function (hst) { return '<div><small>Connected to the site:</small> ' + esc(hst) + '</div>'; }).join('') : '<small>No domains for this client.</small>') +
      (canSee('feedback') ? '<h3 style="margin-top:16px">Feedback</h3>' + (v.feedback.length ? v.feedback.map(function (f) { return '<div>' + pill(T(FBKIND[f.kind])) + pill(T(FBSTATUS[f.status]), f.status === 'new' || f.status === 'waiting' ? 'gold' : '') + ' ' + esc(f.first) + ' <small>' + esc(d(f.updatedAt)) + '</small></div>'; }).join('') + '<p><a class="lk" href="#feedback">Open the feedback inbox</a></p>' : '<small>No feedback from this client.</small>') : '') + '</div>';
    // Notes, flags and timeline
    h += '<div class="card"><h3>Notes and flags</h3><div>' + Object.keys(FLAG).map(function (f) { return '<label class="chk"><input type="checkbox" data-flag="' + f + '"' + (v.flags.indexOf(f) >= 0 ? ' checked' : '') + dis('clients') + '> <span>' + esc(T(FLAG[f])) + '</span></label>'; }).join('') + '</div>' +
      '<label>Add a note (only admins see notes)</label><textarea id="nt_text" rows="2" maxlength="1000"></textarea><div><button class="btn" id="nt_add"' + dis('clients') + '>Add note</button></div>' +
      v.notes.map(function (n) { return '<div class="msgs"><div><small>' + esc(d(n.at)) + ' &middot; ' + esc(n.by) + '</small>\n' + esc(n.text) + '</div></div>'; }).join('') +
      '<h3 style="margin-top:16px">What admins changed</h3>' + (v.timeline.length ? auditTable(v.timeline) : '<small>Nothing yet.</small>') + '</div>';
    $('cp_box').innerHTML = h;
    var cid = c.id;
    $('cp_door').onchange = function () { post({ action: 'door_set', companyId: cid, door: this.value }).then(function () { ok('Door changed.'); clientLoad(cid); }).catch(bad); };
    $('sb_save').onclick = function () {
      post({ action: 'sub_set', companyId: cid, startedOn: $('sb_start').value, renewsOn: $('sb_renew').value, status: $('sb_status').value, paid: $('sb_paid').value || 0, renewal: $('sb_renewal').value, promoCode: $('sb_code').value, founding: $('sb_found').checked })
        .then(function () { ok('Subscription saved.'); clientLoad(cid); }).catch(bad);
    };
    if ($('sb_renewed')) $('sb_renewed').onclick = function () { if (!confirm(T('Mark the renewal paid? The next renewal moves one year later.'))) return; post({ action: 'sub_renewed', companyId: cid, paid: $('sb_rpaid').value }).then(function () { ok('Renewal recorded.'); clientLoad(cid); }).catch(bad); };
    if ($('sb_osave')) $('sb_osave').onclick = function () { post({ action: 'sub_outreach', companyId: cid, outreach: $('sb_out').value, note: $('sb_onote').value }).then(function () { ok('Outreach saved.'); clientLoad(cid); }).catch(bad); };
    var caps = function () { var o = {}; [].forEach.call(document.querySelectorAll('[data-cap]'), function (i) { if (i.value.trim() !== '') o[i.getAttribute('data-cap')] = Number(i.value); }); return o; };
    $('bd_go').onclick = function () {
      var b = { action: 'bundle_apply', companyId: cid, credits: Number($('bd_n').value), note: $('bd_note').value };
      if ($('bd_caps').checked) { b.caps = caps(); b.textModel = $('ev_model').value; }
      post(b).then(function () { ok('Bundle applied.'); clientLoad(cid); }).catch(bad);
    };
    $('ev_save').onclick = function () { post({ action: 'envelopes_set', companyId: cid, enabled: $('ev_on').checked, painterCanEdit: $('ev_pt').checked, caps: caps(), textModel: $('ev_model').value }).then(function () { ok('Envelopes saved.'); clientLoad(cid); }).catch(bad); };
    [].forEach.call(document.querySelectorAll('[data-flag]'), function (i) {
      i.onchange = function () { var fl = [].filter.call(document.querySelectorAll('[data-flag]'), function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-flag'); }); post({ action: 'client_flags', companyId: cid, flags: fl }).then(function () { ok('Flags saved.'); }).catch(bad); };
    });
    $('nt_add').onclick = function () { post({ action: 'client_note', companyId: cid, text: $('nt_text').value }).then(function () { ok('Note added.'); clientLoad(cid); }).catch(bad); };
  }

  // ------------------------------------------------------------- subscriptions
  function subsLoad() {
    api('/api/admin?subs=1').then(function (v) {
      var t = v.totals, rows = v.rows;
      var paid = rows.filter(function (r) { return r.door !== 'free'; });
      var list = function (title, rs, extra) {
        return '<div class="card"><h3>' + esc(T(title)) + ' <small>(' + rs.length + ')</small></h3>' + (rs.length ? '<div class="scroll"><table class="t"><thead><tr><th>Client</th><th>Door</th><th>Renewal due</th><th>Renewal</th>' + (extra ? '<th>Outreach</th>' : '<th>Status</th>') + '</tr></thead><tbody>' + rs.map(function (r) {
          return '<tr><td><a class="lk" href="#client/' + r.companyId + '">' + esc(r.name) + '</a><br><small>' + esc(r.email) + '</small>' + (r.founding ? ' ' + pill(T('Founding painter'), 'gold') : '') + '</td><td>' + doorName(r.door) + '</td><td>' + esc(d(r.renewsOn)) + (r.daysToRenewal !== null ? '<br><small><b>' + r.daysToRenewal + '</b> <span>days</span></small>' : '') + '</td><td>' + money(r.renewalCents) + '</td>' +
            (extra ? '<td><select data-out="' + r.companyId + '"' + (canChange('subscriptions') || canChange('research') ? '' : ' disabled') + '>' + opts(OUTREACH, r.outreach) + '</select>' + (r.outreachNote ? '<br><small>' + esc(r.outreachNote) + '</small>' : '') + '</td>' : '<td>' + pill(T(STATE[r.state]), STATE_PILL[r.state]) + (r.refundUntil ? '<br><small><span>Refund window until</span> ' + esc(d(r.refundUntil)) + '</small>' : '') + '</td>') + '</tr>';
        }).join('') + '</tbody></table></div>' : '<small>None.</small>') + '</div>';
      };
      var h = '<div class="tiles"><div class="tile"><b>' + money(t.paidThisMonth) + '</b><span>Paid this month</span></div><div class="tile"><b>' + t.renewals60 + '</b><span>Renewals in the next 60 days</span></div><div class="tile"><b>' + money(t.renewals60Cents) + '</b><span>Renewal money ahead (60 days)</span></div>' +
        '<div class="tile"><b>' + t.missed + '</b><span>Missed renewals</span></div><div class="tile"><b>' + t.refundWindow + '</b><span>In the 14-day refund window</span></div><div class="tile"><b>' + t.founding + ' / 100</b><span>Founding painters</span></div></div>' +
        '<div class="tiles">' + Object.keys(DOOR).map(function (k) { return '<div class="tile"><b>' + t.byDoor[k] + '</b><span>' + doorName(k) + '</span></div>'; }).join('') + '</div>' +
        list('Missed renewals: reach out with help, not a bill', rows.filter(function (r) { return r.state === 'missed'; }), true) +
        list('Renewals due in 30 days', rows.filter(function (r) { return r.state === 'due_30'; })) +
        list('Renewals due in 31 to 60 days', rows.filter(function (r) { return r.state === 'due_60'; })) +
        list('In the refund window', rows.filter(function (r) { return !!r.refundUntil; })) +
        list('All paid doors', paid) +
        '<div class="card"><h3>Prices</h3><small>Promotions land on the floor and never under it. The list price is what someone with no promotion pays.</small><table class="t"><thead><tr><th>Door</th><th>Sign-up floor</th><th>Sign-up list</th><th>Renewal floor</th><th>Renewal list</th></tr></thead><tbody>' +
        Object.keys(v.prices).map(function (k) { var p = v.prices[k]; return '<tr><td>' + doorName(k) + '</td><td>' + money(p.signupFloor) + '</td><td>' + money(p.signupList) + '</td><td>' + money(p.renewalFloor) + '</td><td>' + money(p.renewalList) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      $('sb_box').innerHTML = h;
      [].forEach.call(document.querySelectorAll('[data-out]'), function (s) { s.onchange = function () { post({ action: 'sub_outreach', companyId: Number(s.getAttribute('data-out')), outreach: s.value }).then(function () { ok('Outreach saved.'); }).catch(bad); }; });
    }).catch(function (x) { $('sb_box').textContent = x ? x.message : ''; });
  }

  // ------------------------------------------------------------- credits
  function creditsLoad() {
    var m = (CACHE.month || new Date().toISOString().slice(0, 7));
    api('/api/admin?credits=1&month=' + m).then(function (v) {
      CACHE.month = v.month;
      var used = v.tools.filter(function (t) { return t.uses || t.creditUses || t.missed || t.blocked; });
      $('cu_box').innerHTML = '<div class="card"><label>Month</label><input id="cu_m" type="month" value="' + esc(v.month) + '" style="max-width:200px">' +
        '<div class="tiles" style="margin-top:12px">' + v.groups.map(function (g) { return '<div class="tile"><b>' + g.credits + '</b><span>' + esc(T(g.label)) + '</span></div>'; }).join('') + '</div>' +
        '<h3>Use by tool</h3>' + (used.length ? '<div class="scroll"><table class="t"><thead><tr><th>Tool</th><th>Credits per use</th><th>Uses in the plan amount</th><th>Uses paid with credits</th><th>Credits</th><th>Turned away</th><th>Stopped by an envelope</th><th>Clients</th></tr></thead><tbody>' +
          used.map(function (t) { return '<tr><td>' + esc(T(t.label)) + '<br><small>' + esc(T(GROUP[t.group])) + '</small></td><td>' + t.cost + '</td><td>' + t.uses + '</td><td>' + t.creditUses + '</td><td>' + t.credits + '</td><td>' + t.missed + '</td><td>' + t.blocked + '</td><td>' + t.clients + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<small>No AI use in this month.</small>') +
        '<h3>Clients who used the most credits</h3>' + (v.top.length ? '<table class="t"><tbody>' + v.top.map(function (c) { return '<tr><td><a class="lk" href="#client/' + c.companyId + '">' + esc(c.name) + '</a></td><td>' + c.credits + '</td></tr>'; }).join('') + '</tbody></table>' : '<small>None yet.</small>') +
        '<h3>Credits added this month, by source</h3>' + (Object.keys(v.granted).length ? '<table class="t"><tbody>' + Object.keys(v.granted).map(function (k) { return '<tr><td>' + esc(T(k)) + '</td><td>' + v.granted[k] + '</td></tr>'; }).join('') + '</tbody></table>' : '<small>None.</small>') +
        '<p><small>Real AI cost per client and per tool needs the provider cost log, which comes in stage 2.</small></p></div>';
      $('cu_m').onchange = function () { CACHE.month = this.value; creditsLoad(); };
    }).catch(function (x) { $('cu_box').textContent = x ? x.message : ''; });
  }

  // ------------------------------------------------------------- starter campaign (free sign-ups and welcome credits)
  function starterLoad() {
    var box = $('st_box');
    api('/api/admin?starter=1').then(function (v) {
      var s = v.settings, c = v.costs, worst = Math.round(s.dailyCap * s.welcomeCredits * c.worstCentsPerCredit), typical = Math.round(s.dailyCap * c.typicalCentsPerAccount);
      box.innerHTML = '<div class="card"><h3>Starter campaign: free sign-ups and welcome credits</h3><small>Every new account gets the welcome credits once. Public sign-ups over the daily ceiling still open at once; their credits wait and are added the next morning (6 AM). Accounts you create here are never held.</small>' +
        '<div class="tiles" style="margin-top:12px"><div class="tile"><b>' + v.stats.today + ' / ' + s.dailyCap + '</b><span>Welcome grants today</span></div><div class="tile"><b>' + v.stats.held + '</b><span>Waiting for tomorrow</span></div><div class="tile"><b>' + v.stats.byDay.reduce(function (n, x) { return n + x.count; }, 0) + '</b><span>Last 14 days</span></div></div>' +
        '<h4>First two weeks: real credit use</h4>' + (v.firstWeeks.accounts ? '<p><small>' + v.firstWeeks.accounts + ' <span>accounts opened in the last 14 days</span>, ' + v.firstWeeks.withJobs + ' <span>started a job</span>, ' + v.firstWeeks.jobs + ' <span>jobs</span>, ' + v.firstWeeks.creditsUsed + ' <span>credits used</span>. <b>' + (v.firstWeeks.perJob === null ? esc(T('No jobs yet')) : v.firstWeeks.perJob + ' ' + esc(T('credits per job')) + ' (' + esc(T('plan')) + ': ' + v.firstWeeks.planPerJob + ', ' + esc(T(v.firstWeeks.verdict)) + ')') + '</b></small></p>' + (v.firstWeeks.creditsByTool.length ? '<table class="t"><tbody>' + v.firstWeeks.creditsByTool.map(function (t) { return '<tr><td>' + esc(t.feature) + '</td><td>' + t.credits + '</td></tr>'; }).join('') + '</tbody></table>' : '') : '<small>No new accounts yet.</small>') +
        '<h4>How new painters heard about us</h4>' + (Object.keys(v.stats.heard || {}).length ? '<table class="t"><tbody>' + Object.keys(v.stats.heard).sort(function (a, b) { return v.stats.heard[b] - v.stats.heard[a]; }).map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + v.stats.heard[k] + '</td></tr>'; }).join('') + '</tbody></table>' : '<small>No answers yet.</small>') +
        '<div class="row"><div><label>Welcome credits</label><input id="st_n" inputmode="numeric" value="' + s.welcomeCredits + '"></div><div><label>They last (days)</label><input id="st_d" inputmode="numeric" value="' + s.welcomeDays + '"></div><div><label>Daily ceiling (accounts)</label><input id="st_cap" inputmode="numeric" value="' + s.dailyCap + '"></div><div><label>Sign-ups per device a day</label><input id="st_v" inputmode="numeric" value="' + s.perVisitorDaily + '"></div><div><label>Founders with no-expiry credits</label><input id="st_f" inputmode="numeric" value="' + s.founders + '"></div></div>' +
        '<label class="chk"><input type="checkbox" id="st_on"' + (s.on ? ' checked' : '') + '> <span>Give welcome credits to new accounts</span></label>' +
        '<label class="chk"><input type="checkbox" id="st_ws"' + (s.weeklySummary ? ' checked' : '') + '> <span>Email me the sign-ups summary every Monday at 8 AM Texas time</span></label>' +
        '<label class="chk"><input type="checkbox" id="st_d3"' + (s.day3Email ? ' checked' : '') + '> <span>Send the day-3 email ("Try your first estimate draft") at 9 AM Texas time</span></label>' +
        '<p><small><span>At today\'s AI prices (checked</span> ' + esc(c.checkedOn) + '<span>), a full day at the ceiling costs about</span> <b>' + money(typical) + '</b> <span>in a normal week and at most</span> <b>' + money(worst) + '</b> <span>if every credit went to color previews. Text costs double on 2027-01-01 when the Gemini Flash price changes.</span></small></p>' +
        '<p><small><span>Defaults:</span> ' + v.defaults.welcomeCredits + ' <span>credits</span>, ' + v.defaults.welcomeDays + ' <span>days</span>, ' + v.defaults.dailyCap + ' <span>a day</span>.</small></p>' +
        '<div><button class="btn" id="st_save"' + dis('credits') + '>Save starter settings</button></div></div>';
      $('st_save').onclick = function () {
        post({ action: 'starter_set', settings: { on: $('st_on').checked, welcomeCredits: Number($('st_n').value), welcomeDays: Number($('st_d').value), dailyCap: Number($('st_cap').value), perVisitorDaily: Number($('st_v').value), founders: Number($('st_f').value), day3Email: $('st_d3').checked, weeklySummary: $('st_ws').checked } }).then(function () { ok('Saved.'); starterLoad(); }).catch(bad);
      };
    }).catch(function (x) { box.textContent = x ? x.message : ''; });
  }

  // ------------------------------------------------------------- AI health and model scorecard
  var secs = function (ms) { return (ms / 1000).toFixed(1) + 's'; };
  function aiHealthLoad() {
    var box = $('ah_box');
    var cents = function (c) { return c === null || c === undefined ? 'n/a' : '$' + (c / 100).toFixed(c >= 100 ? 2 : 3); };
    var WHY = { wrong: 'not correct', unclear: 'unclear', too_long: 'too long', too_short: 'too short', other: 'other' };
    var table = function (rows) {
      if (!rows.length) return '<p><small>' + esc(T('No AI calls recorded in this period yet.')) + '</small></p>';
      return '<div class="scroll"><table class="t"><thead><tr><th>Tool</th><th>Model</th><th>Calls</th><th>Errors</th><th>Avg time</th><th>Cost</th><th>Per call</th><th>&#128077;</th><th>&#128078;</th><th>Rated up</th><th>Why down</th><th>Your score</th><th>Blind wins</th></tr></thead><tbody>' + rows.map(function (r) {
        return '<tr><td>' + esc(r.tool) + '</td><td>' + esc(r.model) + '</td><td>' + r.calls + '</td><td>' + (r.calls - r.ok) + ' (' + r.errorPct + '%)</td><td>' + secs(r.avgMs) + '</td><td>' + cents(r.costCents) + '</td><td>' + cents(r.costPerCallCents) + '</td><td>' + r.up + '</td><td>' + r.down + '</td><td>' + (r.thumbsUpPct === null ? '-' : r.thumbsUpPct + '%') + '</td><td><small>' + Object.keys(r.reasons).map(function (k) { return esc(WHY[k] || k) + ' ' + r.reasons[k]; }).join(', ') + '</small></td><td>' + (r.quality === null ? '-' : r.quality + ' / 5 (' + r.qn + ')') + '</td><td>' + r.wins + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    };
    api('/api/admin?aihealth=1').then(function (v) {
      var t = v.today;
      box.innerHTML = '<div class="card"><h3>Today</h3><div class="tiles">' +
        '<div class="tile"><b>' + t.calls + '</b><span>AI calls today</span></div>' +
        '<div class="tile"><b>' + t.errors + '</b><span>Failed calls</span></div>' +
        '<div class="tile"><b>' + cents(t.costCents) + (t.unpriced ? '+' : '') + '</b><span>Estimated AI spend' + (t.unpriced ? ' (some models have no price on file)' : '') + '</span></div>' +
        '<div class="tile"><b>' + (t.killSwitch ? 'ON' : 'Off') + '</b><span>AI kill switch' + (t.killSwitch ? ': AI is paused for everyone' : '') + '</span></div></div>' +
        (t.slow.length ? '<p><small><b>Slow today (over 8 seconds on average):</b> ' + esc(t.slow.join(', ')) + '</small></p>' : '<p><small>Nothing slow today.</small></p>') +
        '<p><small>Costs are estimates from the prices on file and the size of each request. Your provider dashboards are the real bill. Set the spending alerts there too.</small></p></div>' +
        '<div class="card"><h3>Daily AI spend alert</h3><p><small>Email me at 50%, 80% and 100% of this estimated daily spend. It only warns; it does not pause the AI.</small></p><div class="row"><div><label>Daily limit (dollars)</label><input id="ah_lim" inputmode="decimal" value="' + (v.alert.dailyCents / 100) + '"></div><div><button class="btn" id="ah_lim_save">Save limit</button></div></div></div>' +
        '<div class="card" id="bl_card"></div>' +
        '<div class="card"><h3>Model scorecard: last 7 days</h3>' + table(v.week) + '</div>' +
        '<div class="card"><h3>Model scorecard: last 30 days</h3>' + table(v.month) + '<p><small>A model becomes the default for a tool only after about 30 rated answers and a cost check.</small></p></div>';
      $('ah_lim_save').onclick = function () { post({ action: 'ai_alert_set', dailyDollars: Number($('ah_lim').value) }).then(function () { ok('Saved.'); }).catch(bad); };
      blindDraw(v);
    }).catch(function (x) { box.textContent = x ? x.message : ''; });
  }

  // Blind side-by-side test: the same question to every model with a key, answers shown as A, B, C without names, you score each 1 to 5.
  function blindDraw(v) {
    var c = $('bl_card'), open = v.blindOpen[0];
    var head = '<h3>Blind model test</h3><p><small>Type one real question. Every model with a key answers; you see the answers as A, B, C without names and give each a score from 1 (poor) to 5 (great). The names appear after you save. Scores feed the scorecard below.</small></p>';
    if (open) {
      c.innerHTML = head + '<p><b>' + esc(open.question) + '</b> <small>(' + esc(open.tool) + ')</small></p>' + open.answers.map(function (a) {
        return '<div class="card" style="margin:8px 0"><b>' + esc(a.label) + '</b><div style="white-space:pre-wrap;margin:6px 0">' + esc(a.text) + '</div><label>Score <select data-bs="' + esc(a.label) + '"><option value="">Choose</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label></div>';
      }).join('') + '<div id="bl_out"></div><button class="btn" id="bl_save">Save scores and reveal models</button>';
      $('bl_save').onclick = function () {
        var scores = {}, all = true;
        [].forEach.call(c.querySelectorAll('[data-bs]'), function (e) { if (!e.value) all = false; scores[e.getAttribute('data-bs')] = Number(e.value); });
        if (!all) { bad({ message: 'Give every answer a score.' }); return; }
        post({ action: 'blind_pick', id: open.id, scores: scores }).then(function (r) {
          $('bl_out').innerHTML = '<table class="t"><tbody>' + r.reveal.map(function (x) { return '<tr><td>' + esc(x.label) + '</td><td>' + esc(x.model) + '</td><td>' + secs(x.ms) + '</td><td>' + x.score + ' / 5</td></tr>'; }).join('') + '</tbody></table><p><small>Saved to the scorecard.</small></p>';
          ok('Saved.');
        }).catch(bad);
      };
      return;
    }
    c.innerHTML = head + '<div class="row"><div><label>Question</label><input id="bl_q" maxlength="500" placeholder="For example: How many gallons for a 12x14 bedroom, walls and ceiling?"></div><div><label>Counts toward</label><select id="bl_t">' + v.blindTools.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div></div><button class="btn" id="bl_go">Ask all models</button>';
    $('bl_go').onclick = function () { $('bl_go').disabled = true; post({ action: 'blind_run', question: $('bl_q').value, tool: $('bl_t').value }).then(function () { aiHealthLoad(); }).catch(function (x) { $('bl_go').disabled = false; bad(x); }); };
  }

  // ------------------------------------------------------------- promotions
  var PEDIT = null;
  function promosLoad() {
    api('/api/admin?promos=1').then(function (v) {
      CACHE.promos = v.promos;
      var lim = ME.limits.maxPromoBonus;
      $('pr_box').innerHTML = '<div class="card"><h3 id="pf_title">New promotion</h3><small>Every promotion has a name, a reason and an end date. Only one code applies to a sale, and the price never goes under the floor.</small>' +
        '<div class="g3"><div><label>Code</label><input id="pf_code" maxlength="24" placeholder="BOOKEDBYSPRING" style="text-transform:uppercase"></div><div><label>Name</label><input id="pf_name" maxlength="80" placeholder="Booked by Spring"></div><div><label>Channel</label><select id="pf_ch">' + opts(CHANNEL, 'season') + '</select></div></div>' +
        '<label>Reason</label><input id="pf_reason" maxlength="200" placeholder="Holiday sign-up offer">' +
        '<div class="g3"><div><label>Price</label><select id="pf_kind">' + opts(KIND, 'floor') + '</select></div><div><label>Percent or dollars off</label><input id="pf_val" inputmode="decimal" placeholder="0"></div><div><label>For</label><select id="pf_for">' + opts({ signup: 'Sign-ups', renewal: 'Renewals', both: 'Sign-ups and renewals' }, 'signup') + '</select></div>' +
        '<div><label>Starts</label><input id="pf_start" type="date"></div><div><label>Ends</label><input id="pf_end" type="date"></div><div><label>Most uses (0 = no limit)</label><input id="pf_max" inputmode="numeric" value="0"></div>' +
        '<div><label>Bonus credits' + (lim ? ' (up to ' + lim + ')' : '') + '</label><input id="pf_bonus" inputmode="numeric" value="0"' + (lim ? '' : ' disabled') + '></div></div>' +
        '<div><label>Doors</label>' + ['launch', 'grow', 'signature'].map(function (k) { return '<label class="chk"><input type="checkbox" data-pd="' + k + '" checked> <span>' + doorName(k) + '</span></label>'; }).join('') + '<label class="chk"><input type="checkbox" id="pf_found"> <span>Gives the Founding badge</span></label><label class="chk"><input type="checkbox" id="pf_auto"> <span>Applies by itself at checkout (no code needed)</span></label><label class="chk"><input type="checkbox" id="pf_on" checked> <span>On</span></label></div>' +
        '<div><button class="btn" id="pf_save"' + dis('promos') + '>Save promotion</button> <button class="btn gray" id="pf_new">New</button></div></div>' +
        '<div class="card"><h3>Promotions</h3>' + (v.promos.length ? '<div class="scroll"><table class="t"><thead><tr><th>Code</th><th>Dates</th><th>Price with the code</th><th>Uses</th><th></th></tr></thead><tbody>' + v.promos.map(function (p) {
          return '<tr><td><b>' + esc(p.code) + '</b> ' + (p.live ? pill(T('live'), 'green') : p.active ? pill(T('not in its dates'), '') : pill(T('off'), 'red')) + '<br>' + esc(p.name) + '<br><small>' + esc(T(CHANNEL[p.channel])) + ' &middot; ' + esc(p.reason) + '</small></td>' +
            '<td>' + esc(d(p.startsOn)) + '<br>' + esc(d(p.endsOn)) + '</td><td><small>' + Object.keys(p.prices).filter(function (k) { return p.doors.indexOf(k) >= 0; }).map(function (k) { return doorName(k) + ': ' + (p.appliesTo !== 'renewal' ? money(p.prices[k].signup) : '') + (p.appliesTo === 'both' ? ' / ' : '') + (p.appliesTo !== 'signup' ? money(p.prices[k].renewal) : ''); }).join('<br>') + (p.bonusCredits ? '<br>+ <b>' + p.bonusCredits + '</b> <span>credits</span>' : '') + (p.founding ? '<br>' + esc(T('Founding painter')) : '') + (p.auto ? '<br>' + esc(T('Applies by itself')) : '') + '</small></td>' +
            '<td>' + p.uses + (p.maxUses ? ' / ' + p.maxUses : '') + '</td><td><button class="btn sm gray" data-pe="' + esc(p.code) + '">Edit</button> <button class="btn sm ' + (p.active ? 'red' : '') + '" data-pa="' + esc(p.code) + '" data-on="' + (p.active ? '0' : '1') + '"' + dis('promos') + '>' + (p.active ? 'Turn off' : 'Turn on') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<small>No promotions yet.</small>') + '<p><small>The sign-up and renewal checkout will read these codes when the yearly doors go on sale.</small></p></div>';
      var fill = function (p) {
        PEDIT = p ? p.code : null;
        $('pf_title').textContent = T(p ? 'Edit promotion' : 'New promotion');
        $('pf_code').value = p ? p.code : ''; $('pf_code').disabled = !!p; $('pf_name').value = p ? p.name : ''; $('pf_reason').value = p ? p.reason : ''; $('pf_ch').value = p ? p.channel : 'season';
        $('pf_kind').value = p ? p.kind : 'floor'; $('pf_val').value = p ? p.value : ''; $('pf_for').value = p ? p.appliesTo : 'signup'; $('pf_start').value = p ? p.startsOn : ''; $('pf_end').value = p ? p.endsOn : '';
        $('pf_max').value = p ? p.maxUses : 0; $('pf_bonus').value = p ? p.bonusCredits : 0; $('pf_found').checked = !!(p && p.founding); $('pf_auto').checked = !!(p && p.auto); $('pf_on').checked = p ? p.active : true;
        [].forEach.call(document.querySelectorAll('[data-pd]'), function (i) { i.checked = !p || p.doors.indexOf(i.getAttribute('data-pd')) >= 0; });
      };
      $('pf_new').onclick = function () { fill(null); };
      if (!v.promos.some(function (p) { return p.code === 'BOOKEDBYSPRING'; })) {
        var bs = document.createElement('div'); bs.className = 'card'; bs.innerHTML = '<h3>Booked by Spring is not set up yet</h3><small>One click creates it: floor price on every door, 1,000 bonus credits, the Founding badge, applies by itself at checkout, 2026-11-25 to 2027-01-06. You can edit or turn it off afterward.</small><div><button class="btn" id="pf_bbs"' + dis('promos') + '>Create Booked by Spring</button></div>';
        $('pr_box').insertBefore(bs, $('pr_box').firstChild);
        $('pf_bbs').onclick = function () {
          post({ action: 'promo_save', isNew: true, promo: { code: 'BOOKEDBYSPRING', name: 'Booked by Spring', reason: 'Holiday sign-up offer: floor price and 1,000 credits', channel: 'season', kind: 'floor', value: 0, appliesTo: 'signup', startsOn: '2026-11-25', endsOn: '2027-01-06', maxUses: 0, bonusCredits: Math.min(1000, lim || 0), founding: true, auto: true, active: true, doors: ['launch', 'grow', 'signature'] } })
            .then(function () { ok('Promotion saved.'); promosLoad(); }).catch(bad);
        };
      }
      $('pf_save').onclick = function () {
        var doors = [].filter.call(document.querySelectorAll('[data-pd]'), function (i) { return i.checked; }).map(function (i) { return i.getAttribute('data-pd'); });
        post({ action: 'promo_save', isNew: !PEDIT, promo: { code: $('pf_code').value, name: $('pf_name').value, reason: $('pf_reason').value, channel: $('pf_ch').value, kind: $('pf_kind').value, value: Number($('pf_val').value) || 0, appliesTo: $('pf_for').value, startsOn: $('pf_start').value, endsOn: $('pf_end').value, maxUses: Number($('pf_max').value) || 0, bonusCredits: Number($('pf_bonus').value) || 0, founding: $('pf_found').checked, auto: $('pf_auto').checked, active: $('pf_on').checked, doors: doors } })
          .then(function () { ok('Promotion saved.'); PEDIT = null; promosLoad(); }).catch(bad);
      };
      [].forEach.call(document.querySelectorAll('[data-pe]'), function (b) { b.onclick = function () { fill(CACHE.promos.filter(function (p) { return p.code === b.getAttribute('data-pe'); })[0]); window.scrollTo(0, 0); }; });
      [].forEach.call(document.querySelectorAll('[data-pa]'), function (b) { b.onclick = function () { post({ action: 'promo_active', code: b.getAttribute('data-pa'), active: b.getAttribute('data-on') === '1' }).then(function () { ok('Saved.'); promosLoad(); }).catch(bad); }; });
    }).catch(function (x) { $('pr_box').textContent = x ? x.message : ''; });
  }

  // ------------------------------------------------------------- research
  function researchLoad(marketId) {
    api('/api/admin?research=1').then(function (v) {
      CACHE.markets = v.markets;
      var cur = marketId ? v.markets.filter(function (m) { return m.id === marketId; })[0] : null;
      var h = '<div class="card"><h3>Markets</h3><small>One market per region. Work the contact list in order: claims, paint store counters, builders, trade groups, content, then ads. Write what you learn in the lessons log so the next region goes faster.</small>' +
        (v.markets.length ? '<div class="scroll"><table class="t"><thead><tr><th>Market</th><th>Priority</th><th>Painting companies</th><th>Status</th><th>Contacts</th><th>Free accounts</th><th>Paid</th><th></th></tr></thead><tbody>' + v.markets.map(function (m) {
          return '<tr><td><b>' + esc(m.name) + '</b> <small>' + esc(m.state) + '</small><br><small>' + esc(m.cities.slice(0, 8).join(', ')) + (m.cities.length > 8 ? '...' : '') + '</small></td><td>' + (m.priority == null ? '' : m.priority) + '</td><td>' + (m.painterCount == null ? '' : m.painterCount) + '</td><td>' + esc(T(m.status === 'active' ? 'Active' : m.status === 'done' ? 'Done' : 'Planned')) + '</td><td>' + m.counts.total + '</td><td>' + m.counts.free + '</td><td>' + m.counts.paid + '</td><td><a class="btn sm" href="#research/' + esc(m.id) + '">Open</a></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p><small>No markets yet. Start with North and East Texas.</small></p>') +
        '<h3 style="margin-top:14px">' + esc(T(cur ? 'Edit this market' : 'Add a market')) + '</h3><div class="g3"><div><label>Name</label><input id="mk2_name" maxlength="80" value="' + esc(cur ? cur.name : '') + '" placeholder="North and East Texas"></div><div><label>State</label><input id="mk2_state" maxlength="2" value="' + esc(cur ? cur.state : 'TX') + '"></div><div><label>Status</label><select id="mk2_status">' + opts({ planned: 'Planned', active: 'Active', done: 'Done' }, cur ? cur.status : 'planned') + '</select></div></div>' +
        '<label>Cities (comma separated)</label><textarea id="mk2_cities" rows="2">' + esc(cur ? cur.cities.join(', ') : '') + '</textarea><label>Notes (message, channels, budget, targets)</label><textarea id="mk2_notes" rows="3">' + esc(cur ? cur.notes : '') + '</textarea>' +
        '<div class="g3"><div><label>Priority (1 = work first)</label><input id="mk2_prio" type="number" min="1" max="99" value="' + esc(cur && cur.priority != null ? cur.priority : '') + '"></div><div><label>Painting companies (count)</label><input id="mk2_count" type="number" min="0" value="' + esc(cur && cur.painterCount != null ? cur.painterCount : '') + '"></div><div><label>Source of the count</label><input id="mk2_source" maxlength="500" value="' + esc(cur ? cur.source : '') + '" placeholder="Agency, table, year, link"></div></div>' +
        '<small>Leave the count empty when there is no real source for it.</small>' +
        '<label>Where painters gather (one per line)</label><textarea id="mk2_gather" rows="3">' + esc(cur ? cur.gatheringPlaces.join('\n') : '') + '</textarea><label>Lead channels (one per line)</label><textarea id="mk2_channels" rows="3">' + esc(cur ? cur.channels.join('\n') : '') + '</textarea>' +
        '<div><button class="btn" id="mk2_save"' + dis('research') + '>Save market</button>' + (cur ? ' <a class="btn gray" href="#research">Back to all markets</a>' : '') + '</div></div>';
      if (cur) h += '<div id="ct_box" class="card">Loading...</div><div class="card"><h3>Lessons log</h3>' + (cur.lessons.length ? cur.lessons.slice().reverse().map(function (l) { return '<div class="msgs"><div><small>' + esc(d(l.on)) + ' &middot; ' + esc(l.by) + '</small>\n' + esc(l.text) + '</div></div>'; }).join('') : '<small>No lessons yet.</small>') +
        '<label>Add a lesson</label><textarea id="ls_text" rows="2" maxlength="1000"></textarea><div><button class="btn" id="ls_add"' + dis('research') + '>Add lesson</button></div></div>';
      $('rs_box').innerHTML = h;
      $('mk2_save').onclick = function () { post({ action: 'market_save', market: { id: cur ? cur.id : undefined, name: $('mk2_name').value, state: $('mk2_state').value, status: $('mk2_status').value, cities: $('mk2_cities').value, notes: $('mk2_notes').value, priority: $('mk2_prio').value, painterCount: $('mk2_count').value, source: $('mk2_source').value, gatheringPlaces: $('mk2_gather').value, channels: $('mk2_channels').value } }).then(function (r) { ok('Market saved.'); location.hash = '#research/' + r.market.id; researchLoad(r.market.id); }).catch(bad); };
      if (cur) {
        $('ls_add').onclick = function () { post({ action: 'market_lesson', marketId: cur.id, text: $('ls_text').value }).then(function () { ok('Lesson added.'); researchLoad(cur.id); }).catch(bad); };
        contactsLoad(cur.id);
      }
    }).catch(function (x) { $('rs_box').textContent = x ? x.message : ''; });
  }
  function contactsLoad(mid) {
    api('/api/admin?contacts=' + encodeURIComponent(mid)).then(function (v) {
      CACHE.contacts = v.contacts;
      var c = v.counts;
      $('ct_box').innerHTML = '<h3>Painting companies in this market</h3><div class="tiles">' + Object.keys(CONTACT).map(function (k) { return '<div class="tile"><b>' + (c[k] || 0) + '</b><span>' + esc(T(CONTACT[k])) + '</span></div>'; }).join('') + '</div>' +
        '<div class="g3"><div><label>Search</label><input id="ct_q" placeholder="Company, city or phone"></div><div><label>Status</label><select id="ct_st"><option value="">All</option>' + opts(CONTACT) + '</select></div><div style="align-self:end"><a class="btn gray" href="/api/admin?contacts=' + encodeURIComponent(mid) + '&csv=1">Download CSV</a></div></div>' +
        '<div id="ct_list" class="scroll" style="margin-top:10px"></div>' +
        '<h3 style="margin-top:14px">Add a company</h3><small>Public business details only: business name, business phone, public email, website and review count.</small><div class="g4"><div><label>Company</label><input id="cn_company"></div><div><label>Contact name</label><input id="cn_person"></div><div><label>Phone</label><input id="cn_phone" inputmode="tel"></div><div><label>Email</label><input id="cn_email" type="email"></div>' +
        '<div><label>Website</label><input id="cn_web"></div><div><label>City</label><input id="cn_city"></div><div><label>Google reviews</label><input id="cn_rev" inputmode="numeric"></div><div><label>Language</label><select id="cn_lang">' + opts({ '': 'Not known', en: 'English', es: 'Spanish', both: 'Both' }, '') + '</select></div></div>' +
        '<div><button class="btn" id="cn_add"' + dis('research') + '>Add company</button></div>' +
        '<h3 style="margin-top:14px">Import a CSV</h3><small>Paste CSV text with a header row. Known columns: company, contact, phone, email, website, city, reviews, language, status, code, note. Companies already on the list (same phone, or same name and city) are skipped.</small><textarea id="ci_csv" rows="4" placeholder="company,phone,city,reviews"></textarea><div><button class="btn" id="ci_go"' + dis('research') + '>Import</button></div>';
      $('ct_q').oninput = $('ct_st').onchange = contactsDraw;
      contactsDraw();
      $('cn_add').onclick = function () { post({ action: 'contact_save', marketId: mid, contact: { company: $('cn_company').value, person: $('cn_person').value, phone: $('cn_phone').value, email: $('cn_email').value, website: $('cn_web').value, city: $('cn_city').value, reviews: $('cn_rev').value, lang: $('cn_lang').value } }).then(function () { ok('Company added.'); contactsLoad(mid); }).catch(bad); };
      $('ci_go').onclick = function () { post({ action: 'contacts_import', marketId: mid, csv: $('ci_csv').value }).then(function (r) { msg(T('Imported') + ': ' + r.added + ' · ' + T('skipped') + ': ' + r.skipped, true); contactsLoad(mid); }).catch(bad); };
      CACHE.mid = mid;
    }).catch(function (x) { $('ct_box').textContent = x ? x.message : ''; });
  }
  function contactsDraw() {
    var q = $('ct_q').value.trim().toLowerCase(), st = $('ct_st').value;
    var rows = CACHE.contacts.filter(function (c) { return (!st || c.status === st) && (!q || (c.company + ' ' + c.city + ' ' + c.phone + ' ' + c.person).toLowerCase().indexOf(q) >= 0); }).slice(0, 300);
    $('ct_list').innerHTML = '<table class="t"><thead><tr><th>Company</th><th>Reach</th><th>Suggested door</th><th>Status</th><th>Note</th></tr></thead><tbody>' + rows.map(function (c) {
      return '<tr><td><b>' + esc(c.company) + '</b>' + (c.person ? '<br>' + esc(c.person) : '') + '<br><small>' + esc(c.city) + (c.reviews !== null ? ' &middot; ' + c.reviews + ' ' + esc(T('reviews')) : '') + (c.lang ? ' &middot; ' + esc(c.lang.toUpperCase()) : '') + '</small></td>' +
        '<td><small>' + (c.phone ? '<a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a><br>' : '') + (c.email ? esc(c.email) + '<br>' : '') + (c.website ? esc(c.website) : '') + '</small></td><td>' + doorName(c.door) + '</td>' +
        '<td><select data-cs="' + esc(c.id) + '"' + dis('research') + '>' + opts(CONTACT, c.status) + '</select><br><small>' + esc(c.owner) + (c.lastOn ? ' &middot; ' + esc(d(c.lastOn)) : '') + '</small></td><td><input data-cn="' + esc(c.id) + '" maxlength="500" value="' + esc(c.note) + '"' + dis('research') + '></td></tr>';
    }).join('') + '</tbody></table>' + (rows.length === 300 ? '<small>Showing the first 300. Search to narrow the list.</small>' : '');
    var save = function (id, patch) { post({ action: 'contact_save', marketId: CACHE.mid, contact: Object.assign({ id: id }, patch) }).then(function (r) { ok('Saved.'); CACHE.contacts = CACHE.contacts.map(function (c) { return c.id === id ? r.contact : c; }); }).catch(bad); };
    [].forEach.call(document.querySelectorAll('[data-cs]'), function (s) { s.onchange = function () { save(s.getAttribute('data-cs'), { status: s.value }); }; });
    [].forEach.call(document.querySelectorAll('[data-cn]'), function (i) { i.onchange = function () { save(i.getAttribute('data-cn'), { note: i.value }); }; });
  }

  // ------------------------------------------------------------- feedback
  function feedbackLoad() {
    var st = CACHE.fbStatus || 'open', kd = CACHE.fbKind || '', as = CACHE.fbAssignee || '';
    api('/api/admin?feedback=1&status=' + st + '&kind=' + kd + '&assignee=' + encodeURIComponent(as)).then(function (v) {
      var c = v.counts, staffOpts = function (sel) { return '<option value=""' + (sel ? '' : ' selected') + '>' + esc(T('Nobody')) + '</option>' + v.staff.map(function (e) { return '<option' + (e === sel ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join(''); };
      var asOpts = '<option value="">' + esc(T('Everyone')) + '</option><option value="none"' + (as === 'none' ? ' selected' : '') + '>' + esc(T('Nobody has it')) + '</option>' + v.staff.map(function (e) { return '<option' + (e === as ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('');
      var quickOpts = '<option value="">' + esc(T('Insert a quick reply...')) + '</option>' + v.quick.map(function (q) { return '<option value="' + esc(q.id) + '">' + esc(q.title) + '</option>'; }).join('');
      $('fb_box').innerHTML = '<div class="tiles"><div class="tile"><b>' + c.new + '</b><span>New</span></div><div class="tile"><b>' + c.waiting + '</b><span>Client wrote again</span></div><div class="tile"><b>' + c.late + '</b><span>Waiting too long</span></div><div class="tile"><b>' + c.unassigned + '</b><span>Nobody has it</span></div><div class="tile"><b>' + c.support + '</b><span>Support requests waiting</span></div><div class="tile"><b>' + c.answered + '</b><span>Answered</span></div><div class="tile"><b>' + c.closed + '</b><span>Closed</span></div></div>' +
        '<div class="card"><div class="g3"><div><label>Show</label><select id="fb_st">' + opts({ open: 'Waiting for us', all: 'All', new: 'New', answered: 'Answered', closed: 'Closed' }, st) + '</select></div><div><label>Kind</label><select id="fb_kd">' + opts({ '': 'All kinds', support: 'Support', bug: 'Bug', idea: 'Idea', question: 'Question', other: 'Other' }, kd) + '</select></div><div><label>Handled by</label><select id="fb_as">' + asOpts + '</select></div></div>' +
        (v.threads.length ? v.threads.map(function (t) {
          return '<div style="border-top:1px solid #eee;margin-top:12px;padding-top:10px"><div>' + pill(T(FBKIND[t.kind]), t.kind === 'support' ? 'gold' : '') + pill(T(FBSTATUS[t.status]), t.status === 'new' || t.status === 'waiting' ? 'gold' : '') + (t.waitingDays >= v.lateDays ? pill(t.waitingDays + ' ' + T('days waiting'), 'gold') : '') + ' <a class="lk" href="#client/' + t.companyId + '">' + esc(t.companyName) + '</a> <small>' + esc(d(t.updatedAt)) + (t.page ? ' &middot; ' + esc(t.page) : '') + '</small></div>' +
            '<div class="msgs">' + t.messages.map(function (m) { return '<div class="' + (m.from === 'admin' ? 'a' : '') + '"><small>' + esc(m.by) + ' &middot; ' + esc(d(m.at)) + '</small>\n' + esc(m.text) + '</div>'; }).join('') + '</div>' +
            (t.internalNotes.length ? '<div class="msgs" style="background:#fff8e6">' + t.internalNotes.map(function (n) { return '<div><small>' + esc(T('Staff note')) + ' &middot; ' + esc(n.by) + ' &middot; ' + esc(d(n.at)) + '</small>\n' + esc(n.text) + '</div>'; }).join('') + '</div>' : '') +
            '<label>' + esc(T('Handled by')) + '</label><select data-fba="' + esc(t.id) + '" data-c="' + t.companyId + '"' + dis('feedback') + '>' + staffOpts(t.assignee) + '</select>' +
            '<select data-fbq="' + esc(t.id) + '" style="margin-top:6px">' + quickOpts + '</select>' +
            '<textarea rows="2" maxlength="2000" data-fbt="' + esc(t.id) + '" placeholder="' + esc(T('Write a reply. The client gets an email that you answered.')) + '"></textarea>' +
            '<div><button class="btn sm" data-fbr="' + esc(t.id) + '" data-c="' + t.companyId + '"' + dis('feedback') + '>Send reply</button> <button class="btn sm gray" data-fbc="' + esc(t.id) + '" data-c="' + t.companyId + '" data-s="' + (t.status === 'closed' ? 'answered' : 'closed') + '"' + dis('feedback') + '>' + (t.status === 'closed' ? 'Reopen' : 'Close') + '</button></div>' +
            '<input maxlength="1000" data-fbn="' + esc(t.id) + '" placeholder="' + esc(T('Staff note (the client never sees it)')) + '" style="margin-top:6px"> <button class="btn sm gray" data-fbnb="' + esc(t.id) + '" data-c="' + t.companyId + '"' + dis('feedback') + '>Add note</button></div>';
        }).join('') : '<p><small>Nothing here.</small></p>') + '</div>' +
        '<div class="card"><h3>Quick replies</h3><small>Saved answers for questions you get often. Pick one in a ticket to fill the reply box, then change it if you need to.</small>' +
        (v.quick.length ? v.quick.map(function (q) { return '<div style="border-top:1px solid #eee;margin-top:8px;padding-top:6px"><b>' + esc(q.title) + '</b> <button class="btn sm gray" data-qd="' + esc(q.id) + '"' + dis('feedback') + '>Delete</button><br><small>' + esc(q.text) + '</small></div>'; }).join('') : '') +
        '<label>Title</label><input id="qr_title" maxlength="60"><label>Reply text</label><textarea id="qr_text" rows="3" maxlength="2000"></textarea><button class="btn sm" id="qr_add"' + dis('feedback') + '>Save quick reply</button></div>';
      CACHE.quick = v.quick;
      $('fb_st').onchange = function () { CACHE.fbStatus = this.value; feedbackLoad(); };
      $('fb_kd').onchange = function () { CACHE.fbKind = this.value; feedbackLoad(); };
      $('fb_as').onchange = function () { CACHE.fbAssignee = this.value; feedbackLoad(); };
      var cid = function (b) { return Number(b.getAttribute('data-c')); };
      [].forEach.call(document.querySelectorAll('[data-fbr]'), function (b) {
        b.onclick = function () { var id = b.getAttribute('data-fbr'); var ta = document.querySelector('[data-fbt="' + id + '"]'); post({ action: 'feedback_reply', id: id, companyId: cid(b), text: ta.value }).then(function () { ok('Reply sent.'); feedbackLoad(); }).catch(bad); };
      });
      [].forEach.call(document.querySelectorAll('[data-fbc]'), function (b) {
        b.onclick = function () { post({ action: 'feedback_reply', id: b.getAttribute('data-fbc'), companyId: cid(b), status: b.getAttribute('data-s') }).then(function () { ok('Saved.'); feedbackLoad(); }).catch(bad); };
      });
      [].forEach.call(document.querySelectorAll('[data-fba]'), function (sel) {
        sel.onchange = function () { post({ action: 'feedback_reply', id: sel.getAttribute('data-fba'), companyId: cid(sel), assignee: sel.value }).then(function () { ok('Saved.'); feedbackLoad(); }).catch(bad); };
      });
      [].forEach.call(document.querySelectorAll('[data-fbq]'), function (sel) {
        sel.onchange = function () { var q = CACHE.quick.filter(function (x) { return x.id === sel.value; })[0]; var ta = document.querySelector('[data-fbt="' + sel.getAttribute('data-fbq') + '"]'); if (q) ta.value = q.text; };
      });
      [].forEach.call(document.querySelectorAll('[data-fbnb]'), function (b) {
        b.onclick = function () { var id = b.getAttribute('data-fbnb'); var inp = document.querySelector('[data-fbn="' + id + '"]'); post({ action: 'feedback_reply', id: id, companyId: cid(b), note: inp.value }).then(function () { ok('Note added.'); feedbackLoad(); }).catch(bad); };
      });
      [].forEach.call(document.querySelectorAll('[data-qd]'), function (b) {
        b.onclick = function () { post({ action: 'quickreply_save', id: b.getAttribute('data-qd'), remove: true }).then(function () { ok('Deleted.'); feedbackLoad(); }).catch(bad); };
      });
      $('qr_add').onclick = function () { post({ action: 'quickreply_save', title: $('qr_title').value, text: $('qr_text').value }).then(function () { ok('Quick reply saved.'); feedbackLoad(); }).catch(bad); };
    }).catch(function (x) { $('fb_box').textContent = x ? x.message : ''; });
  }

  // ------------------------------------------------------------- held domains
  function heldLoad() {
    api('/api/admin?held=1').then(function (v) {
      CACHE.held = v.domains;
      var queue = v.domains.filter(function (x) { return x.reason; });
      var row = function (x) {
        return '<tr><td><b>' + esc(x.name) + '</b> ' + pill(T(x.kind === 'branded' ? 'Branded' : 'Generic')) + '<br><small>' + esc(x.registrar) + (x.client ? ' &middot; <a class="lk" href="#client/' + x.companyId + '">' + esc(x.client) + '</a>' : '') + '</small></td>' +
          '<td>' + esc(d(x.expiresOn)) + '<br><small><b>' + x.daysLeft + '</b> <span>days</span>' + (x.autoRenew ? '' : ' &middot; ' + esc(T('auto-renew off'))) + '</small></td><td>' + pill(T(DSTATUS[x.status])) + (x.reason ? pill(T(QUEUE[x.reason]), x.reason === 'expired' || x.reason === 'expires_7' ? 'red' : 'gold') : '') +
          '<br><small>' + (x.canTransfer ? esc(T('Can transfer')) : esc(T('Transfer lock until')) + ' ' + esc(d(x.transferFrom))) + (x.reuseFrom ? ' &middot; ' + esc(T('Reuse from')) + ' ' + esc(d(x.reuseFrom)) : '') + '</small></td>' +
          '<td><button class="btn sm" data-hr="' + esc(x.name) + '"' + dis('domains') + '>Renewed</button> <button class="btn sm gray" data-hd="' + esc(x.name) + '" data-dec="release"' + dis('domains') + '>Release</button>' + (x.kind === 'generic' ? ' <button class="btn sm gray" data-hd="' + esc(x.name) + '" data-dec="pool"' + dis('domains') + '>Reuse pool</button>' : '') +
          ' <button class="btn sm gray" data-hd="' + esc(x.name) + '" data-dec="' + (x.status === 'transfer_requested' ? 'transferred' : 'transfer_requested') + '"' + dis('domains') + '>' + (x.status === 'transfer_requested' ? 'Transferred' : 'Transfer asked') + '</button> <button class="btn sm gray" data-he="' + esc(x.name) + '">Edit</button></td></tr>';
      };
      var table = function (rs) { return rs.length ? '<div class="scroll"><table class="t"><thead><tr><th>Domain</th><th>Expires</th><th>Status</th><th>Decide</th></tr></thead><tbody>' + rs.map(row).join('') + '</tbody></table></div>' : '<small>None.</small>'; };
      $('hd_box').innerHTML = '<div class="card"><h3>Needs a decision</h3><small>Renew, release (let it expire) or reuse. A domain is reusable only if it is generic, the client cancelled or was refunded at least 30 days ago, and they did not ask for a transfer.</small>' + table(queue) + '</div>' +
        '<div class="card"><h3>All held domains</h3>' + table(v.domains) + '</div>' +
        '<div class="card"><h3 id="hf_title">Add a domain we bought</h3><div class="g3"><div><label>Domain</label><input id="hf_name" placeholder="longviewpainters.com"></div><div><label>Registrar</label><input id="hf_reg" value="Cloudflare"></div><div><label>Client</label><select id="hf_c"><option value="">None (our own or the reuse pool)</option>' + v.clients.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Bought on</label><input id="hf_bought" type="date"></div><div><label>Expires on</label><input id="hf_exp" type="date"></div><div><label>Yearly cost ($)</label><input id="hf_cost" inputmode="decimal" placeholder="12"></div>' +
        '<div><label>Name type</label><select id="hf_kind">' + opts({ generic: 'Generic (no business name in it)', branded: 'Branded (has the client\'s business name)' }, 'generic') + '</select></div><div><label>Note</label><input id="hf_note" maxlength="300"></div><div style="align-self:end"><label class="chk"><input type="checkbox" id="hf_auto" checked> <span>Auto-renew is on at the registrar</span></label></div></div>' +
        '<div><button class="btn" id="hf_save"' + dis('domains') + '>Save domain</button> <button class="btn gray" id="hf_new">New</button></div></div>';
      var HNEW = true;
      var fill = function (x) {
        HNEW = !x; $('hf_title').textContent = T(x ? 'Edit domain' : 'Add a domain we bought');
        $('hf_name').value = x ? x.name : ''; $('hf_name').disabled = !!x; $('hf_reg').value = x ? x.registrar : 'Cloudflare'; $('hf_c').value = x && x.companyId ? String(x.companyId) : '';
        $('hf_bought').value = x ? x.boughtOn : ''; $('hf_exp').value = x ? x.expiresOn : ''; $('hf_cost').value = x ? x.costCents / 100 : ''; $('hf_kind').value = x ? x.kind : 'generic'; $('hf_note').value = x ? x.note : ''; $('hf_auto').checked = x ? x.autoRenew : true;
      };
      $('hf_new').onclick = function () { fill(null); };
      $('hf_save').onclick = function () { post({ action: 'held_save', domain: { isNew: HNEW, name: $('hf_name').value, registrar: $('hf_reg').value, companyId: $('hf_c').value ? Number($('hf_c').value) : '', boughtOn: $('hf_bought').value, expiresOn: $('hf_exp').value, cost: $('hf_cost').value, kind: $('hf_kind').value, note: $('hf_note').value, autoRenew: $('hf_auto').checked } }).then(function () { ok('Domain saved.'); heldLoad(); }).catch(bad); };
      [].forEach.call(document.querySelectorAll('[data-he]'), function (b) { b.onclick = function () { fill(CACHE.held.filter(function (x) { return x.name === b.getAttribute('data-he'); })[0]); $('hf_title').scrollIntoView(); }; });
      [].forEach.call(document.querySelectorAll('[data-hd]'), function (b) { b.onclick = function () { post({ action: 'held_decide', name: b.getAttribute('data-hd'), decision: b.getAttribute('data-dec') }).then(function () { ok('Saved.'); heldLoad(); }).catch(bad); }; });
      [].forEach.call(document.querySelectorAll('[data-hr]'), function (b) {
        b.onclick = function () { var exp = prompt(T('New expiry date from the registrar (YYYY-MM-DD)')); if (!exp) return; post({ action: 'held_decide', name: b.getAttribute('data-hr'), decision: 'renew', expiresOn: exp.trim() }).then(function () { ok('Saved.'); heldLoad(); }).catch(bad); };
      });
    }).catch(function (x) { $('hd_box').textContent = x ? x.message : ''; });
    if (typeof dmLoad === 'function') dmLoad();
  }

  // ------------------------------------------------------------- team and audit
  function auditTable(entries) {
    return '<div class="scroll"><table class="t"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Client</th><th>Details</th></tr></thead><tbody>' + entries.map(function (e) {
      return '<tr><td><small>' + esc(String(e.at).replace('T', ' ').slice(0, 16)) + '</small></td><td><small>' + esc(e.by) + '<br>' + esc(T(e.role)) + '</small></td><td>' + esc(e.action) + '</td><td>' + (e.companyId ? '<a class="lk" href="#client/' + e.companyId + '">#' + e.companyId + '</a>' : '') + '</td><td><small>' + esc(e.detail) + '</small></td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  var ROLES = { owner: 'Owner', support: 'Support', sales: 'Sales', billing: 'Billing', readonly: 'Read only' };
  function securityLoad() {
    api('/api/admin?team=1').then(function (v) {
      $('tm_box').innerHTML = '<div class="card"><small>Owner: everything. Support: clients, sites, credits (up to 200 at a time), feedback and the help guide. Sales: promotions (bonus credits up to 500) and marketing research. Billing: subscriptions, renewals and domains. Read only: sees, changes nothing. Everyone signs in with their own email; a changed role takes effect at their next sign-in.</small>' +
        '<div class="scroll"><table class="t"><thead><tr><th>Email</th><th>Role</th><th>Added</th><th>Last sign-in</th></tr></thead><tbody>' + v.team.map(function (m) {
          return '<tr><td>' + esc(m.email) + (m.email === ME.email ? ' <small>(' + esc(T('you')) + ')</small>' : '') + '</td><td>' + (m.email === ME.email ? esc(T(ROLES[m.role] || m.role)) : '<select data-tr="' + esc(m.email) + '">' + opts(Object.assign({}, ROLES, { removed: 'No access' }), m.role) + '</select>') + '</td><td>' + esc(d(m.addedOn)) + '</td><td>' + esc(d(m.lastSignIn)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<h3 style="margin-top:14px">Add a team member</h3><div class="g3"><div><label>Email</label><input id="tm_email" type="email"></div><div><label>Role</label><select id="tm_role">' + opts(ROLES, 'support') + '</select></div><div style="align-self:end"><button class="btn" id="tm_add" style="margin:0">Add and send a sign-in link</button></div></div>' +
        '<small>Use a work email that is not a painter\'s client login. Two-step sign-in for admins comes in stage 2.</small></div>';
      if (ME && ME.role === 'owner') $('tm_box').insertAdjacentHTML('beforeend', '<div class="card" style="margin-top:14px"><h3>' + esc(T('Database backup')) + '</h3><p><small>' + esc(T('Downloads a copy of all client data as one file. Sign-in tables are left out. Do this before launch and every week after. Keep the file somewhere private, it holds client names and emails.')) + '</small></p><a class="btn" href="/api/admin?backup=1" download>' + esc(T('Download backup now')) + '</a></div>');
      $('tm_add').onclick = function () {
        var email = $('tm_email').value;
        post({ action: 'team_set', email: email, role: $('tm_role').value }).then(function () { return fetch('/api/auth/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email }) }); }).then(function () { ok('Team member added. A sign-in link was sent.'); securityLoad(); }).catch(bad);
      };
      [].forEach.call(document.querySelectorAll('[data-tr]'), function (s) {
        s.onchange = function () { if (s.value === 'removed' && !confirm(T('Remove admin access for this person? They are signed out now.'))) { securityLoad(); return; } post({ action: 'team_set', email: s.getAttribute('data-tr'), role: s.value }).then(function () { ok('Role saved.'); securityLoad(); }).catch(bad); };
      });
    }).catch(function (x) { $('tm_box').textContent = x ? x.message : ''; });
    CACHE.audit = [];
    $('au_box').innerHTML = '<div class="card"><div class="g3"><div><label>Who (email)</label><input id="au_by"></div><div><label>Client number</label><input id="au_c" inputmode="numeric"></div><div style="align-self:end"><button class="btn" id="au_go" style="margin:0">Filter</button></div></div><div id="au_list" style="margin-top:10px"></div><button class="btn gray" id="au_more">Load more</button><p><small>The audit log cannot be edited or deleted.</small></p></div>';
    var more = function (reset) {
      var last = !reset && CACHE.audit.length ? CACHE.audit[CACHE.audit.length - 1].at : '';
      var u = '/api/admin?audit=1' + ($('au_by').value.trim() ? '&by=' + encodeURIComponent($('au_by').value.trim()) : '') + ($('au_c').value.trim() ? '&company=' + encodeURIComponent($('au_c').value.trim()) : '') + (last ? '&before=' + encodeURIComponent(last) : '');
      api(u).then(function (v) { CACHE.audit = (reset ? [] : CACHE.audit).concat(v.entries); $('au_list').innerHTML = CACHE.audit.length ? auditTable(CACHE.audit) : '<small>Nothing yet.</small>'; $('au_more').style.display = v.entries.length < 100 ? 'none' : ''; }).catch(bad);
    };
    $('au_go').onclick = function () { more(true); };
    $('au_more').onclick = function () { more(false); };
    more(true);
  }

  // Needs attention: AI failures, failed payments, stuck sites.
  function exceptionsLoad() {
    var box = $('ex_box'); if (!box) return;
    api('/api/admin?exceptions=1').then(function (v) {
      box.innerHTML = v.items.length ? v.items.map(function (i) {
        return '<div style="border-top:1px solid #eee;padding:8px 0">' + pill(i.severity === 'high' ? 'Act now' : 'Look soon', i.severity === 'high' ? 'red' : 'gold') + ' <b>' + esc(i.title) + '</b><div><small>' + esc(i.detail) + '</small>' + (i.companyId ? ' <a href="#client/' + i.companyId + '">Open client</a>' : '') + '</div></div>';
      }).join('') : '<p style="margin:0">Nothing needs attention right now. No failing AI tools, missed payments or stuck websites.</p>';
    }).catch(function (x) { box.textContent = x ? x.message : ''; });
  }
  function samplesLoad() {
    var box = $('sm_box'); if (!box) return;
    api('/api/admin?samples=1').then(function (v) {
      box.innerHTML = '<label class="sw"><input type="checkbox" id="sm_on" ' + (v.on ? 'checked' : '') + '> Add a sample customer, job, estimate and employee to every new account</label>' + '<div class="row"><div><label>Sample customer name</label><input id="sm_c" maxlength="100" value="' + esc(v.text.customer) + '" placeholder="Sample Customer (Maria Garcia)"></div><div><label>Sample job title</label><input id="sm_j" maxlength="100" value="' + esc(v.text.job) + '" placeholder="Sample: Living room and hallway repaint"></div><div><label>Sample employee</label><input id="sm_w" maxlength="100" value="' + esc(v.text.worker) + '" placeholder="Sample Painter (Alex)"></div></div><label>Note on the sample customer</label><input id="sm_n" maxlength="300" value="' + esc(v.text.note) + '"><p><small>Leave a box empty to keep the built-in text. Names always keep the word Sample. Spanish accounts keep the built-in Spanish samples. Changes apply to accounts created after you save.</small></p>' + '<p><small>Sample rows are marked "Sample" and each painter can clear them with one button on their dashboard. Turning this off only affects accounts created after you save.</small></p><div><button class="btn" id="sm_save"' + dis('settings') + '>Save</button></div>';
      $('sm_save').onclick = function () { post({ action: 'samples_set', on: $('sm_on').checked, text: { customer: $('sm_c').value, job: $('sm_j').value, worker: $('sm_w').value, note: $('sm_n').value } }).then(function () { ok('Saved.'); }).catch(bad); };
    }).catch(function (x) { box.textContent = x ? x.message : ''; });
  }

  // Launch checklist: items the app can check show a green tick by themselves; the rest the owner ticks.
  function launchLoad() {
    var box = $('lc_box'); if (!box) return;
    api('/api/admin?launch=1').then(function (v) {
      var groups = ['Money', 'Safety', 'Content', 'Customers'];
      box.innerHTML = '<p style="margin:0 0 8px"><b>' + v.done + ' of ' + v.total + ' ready</b> for launch day (December 1).</p><div style="height:8px;background:#eee;border-radius:6px;overflow:hidden;margin-bottom:10px"><div style="height:8px;width:' + Math.round(100 * v.done / v.total) + '%;background:#2f855a"></div></div>' +
        groups.map(function (g) {
          return '<h3 style="margin:14px 0 4px">' + esc(g) + '</h3>' + v.items.filter(function (i) { return i.group === g; }).map(function (i) {
            return '<div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid #eee"><div style="flex:0 0 24px">' + (i.auto ? '<span class="' + (i.done ? 'ok' : 'bad') + '" style="font-size:18px" aria-label="' + (i.done ? 'ready' : 'not ready') + '">' + (i.done ? '&#10003;' : '&#9675;') + '</span>' : '<input type="checkbox" data-lc="' + esc(i.id) + '"' + (i.done ? ' checked' : '') + dis('settings') + '>') + '</div><div style="min-width:0"><b>' + esc(i.label) + '</b>' + (i.auto ? ' <small>(checked by the app)</small>' : '') + (i.note ? ' <small class="bad">' + esc(i.note) + '</small>' : '') + '<div><small>' + esc(i.how) + '</small></div></div></div>';
          }).join('');
        }).join('');
      box.onchange = function (e) { var id = e.target && e.target.dataset && e.target.dataset.lc; if (!id) return; post({ action: 'launch_tick', id: id, done: e.target.checked }).then(function () { launchLoad(); }).catch(function (x) { bad(x); launchLoad(); }); };
    }).catch(function (x) { box.textContent = x ? x.message : ''; });
  }

  var LOAD = {
    clients: function () { clientsLoad(); exceptionsLoad(); if (typeof load === 'function') load(); },
    client: clientLoad,
    subs: subsLoad,
    credits: function () { creditsLoad(); if (typeof load === 'function') load(); },
    starter: starterLoad,
    aihealth: aiHealthLoad,
    promos: promosLoad,
    research: researchLoad,
    feedback: feedbackLoad,
    domains: function () { heldLoad(); if (typeof load === 'function') load(); },
    content: function () { if (typeof hLoad === 'function') hLoad(); },
    launch: launchLoad,
    settings: function () { samplesLoad(); ['tkLoad', 'mkLoad', 'mLoad', 'ntLoad', 'amLoad'].forEach(function (f) { if (typeof window[f] === 'function') window[f](); }); },
    security: securityLoad,
  };

  // The old plan switch and add-client buttons in admin.html refresh the new client views too.
  document.addEventListener('change', function (e) { if (e.target.dataset && e.target.dataset.id && CACHE.client) setTimeout(function () { clientLoad(CACHE.client.company.id); }, 400); });

  api('/api/admin?me=1').then(function (me) {
    ME = me;
    $('me_role').textContent = T(ROLES[me.role] || me.role);
    window.addEventListener('hashchange', route);
    route();
  }).catch(function (x) {
    var main = document.querySelector('main');
    if (!(x && x.message === 'Not found.')) { main.innerHTML = '<div class="card">' + esc(x ? x.message : '') + '</div>'; return; }
    main.innerHTML = '<div class="card"><h3>' + esc(T('You do not have access to this page.')) + '</h3><p id="na_who"></p></div>';
    fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) {
      $('na_who').innerHTML = u ? esc(T('You are signed in as')) + ' <b>' + esc(u.email) + '</b> (' + esc(u.company || '') + '). ' + esc(T('The admin pages open only with the PaintersMax owner login, or a team login the owner added. Sign out, then sign in with that email.')) + ' <a href="/login">' + esc(T('Sign in')) + '</a>' : esc(T('Sign in first, then open this address again.')) + ' <a href="/login">' + esc(T('Sign in')) + '</a>';
    }).catch(function () {});
  });
})();

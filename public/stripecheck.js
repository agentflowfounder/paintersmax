/* Admin > Subscriptions: the Stripe self-check card (GET /api/admin/stripe-check). Read only. */
(function () {
  var box = document.getElementById('sk_box');
  if (!box) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var when = function (iso) { if (!iso) return 'never'; var d = new Date(String(iso).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z')); return isNaN(d) ? esc(iso) : d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  var MODES = { live: 'Live keys (real money)', test: 'Test keys (no real money)', missing: 'No key set', unknown: 'Key not recognized' };
  function row(label, value, good) { return '<div style="display:flex;gap:10px;padding:6px 0;border-top:1px solid #eee"><span style="flex:0 0 130px;color:#4A5568">' + label + '</span><span style="min-width:0;overflow-wrap:anywhere" class="' + (good === true ? 'ok' : good === false ? 'bad' : '') + '">' + value + '</span></div>'; }
  function load() {
    box.textContent = 'Checking Stripe...';
    fetch('/api/admin/stripe-check').then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not check Stripe.'); return j; }); }).then(function (v) {
      var h = '';
      h += v.problems.length
        ? '<div class="bad" style="font-weight:700;margin-bottom:6px">' + v.problems.length + ' thing' + (v.problems.length > 1 ? 's' : '') + ' to fix</div><ul style="margin:0 0 10px 18px;padding:0">' + v.problems.map(function (p) { return '<li class="bad">' + esc(p) + '</li>'; }).join('') + '</ul>'
        : '<div class="ok" style="font-weight:700;margin-bottom:6px">Stripe looks ready.</div>';
      h += row('Keys', esc(MODES[v.mode] || v.mode), v.mode === 'live' || v.mode === 'test');
      h += row('Webhook secret', v.webhookSecret ? 'Set' : 'Missing', v.webhookSecret);
      if (v.endpoints) h += row('Stripe webhooks', v.endpoints.length ? v.endpoints.map(function (e) { return esc(e.url) + (e.ours ? '' : ' <small>(not this site)</small>') + (e.ours && !e.missing.length ? ' <span class="ok">all events</span>' : ''); }).join('<br>') : 'None', v.endpoints.some(function (e) { return e.ours && !e.missing.length; }));
      else if (v.endpointError) h += row('Stripe webhooks', 'Could not read: ' + esc(v.endpointError));
      h += row('Last event received', v.lastEvent ? esc(v.lastEvent.type) + ', ' + when(v.lastEvent.at) : 'none yet', v.lastEvent ? true : null);
      h += row('Events this week', String(v.eventsThisWeek));
      h += row('Last failed payment', v.lastFailedPayment ? 'Client #' + esc(v.lastFailedPayment.companyId) + ', ' + when(v.lastFailedPayment.at) + ' (' + v.pastDueNow + ' past due now)' : 'none', v.lastFailedPayment ? false : true);
      h += '<div style="margin-top:8px"><small>Events Stripe must send: ' + v.needed.map(esc).join(', ') + '.</small> <button type="button" id="sk_again" style="margin-left:6px">Check again</button></div>';
      box.innerHTML = h;
      document.getElementById('sk_again').onclick = load;
    }).catch(function (e) { box.textContent = e.message; });
  }
  load();
})();

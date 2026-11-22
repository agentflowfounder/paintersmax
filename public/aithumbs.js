/* Thumbs up / down for an AI answer. pmThumbs(ai) returns HTML for the buttons, where ai is { tool, model } from the server.
   Clicks are handled here, so any page that loads this file can show the buttons. The vote goes to /api/ai/feedback. */
(function () {
  var T = function (s) { return typeof window.pmT === 'function' ? window.pmT(s) : s; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var WHY = [['wrong', 'Not correct'], ['unclear', 'Unclear'], ['too_long', 'Too long'], ['too_short', 'Too short'], ['other', 'Other']];
  function look(ai) {
    return '<span class="pmth" data-tool="' + esc(ai.tool) + '" data-model="' + esc(ai.model) + '"><small>' + esc(T('Was this helpful?')) + '</small> ' +
      '<button type="button" class="mini" data-pmr="up" aria-label="' + esc(T('Good answer')) + '">&#128077;</button> ' +
      '<button type="button" class="mini" data-pmr="down" aria-label="' + esc(T('Bad answer')) + '">&#128078;</button></span>';
  }
  window.pmThumbs = function (ai) { return ai && ai.tool && ai.model ? look(ai) : ''; };
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-pmr],[data-pmw]') : null;
    if (!b) return;
    var box = b.closest('.pmth');
    if (!box) return;
    var send = function (rating, reason) {
      box.innerHTML = '<small>' + esc(T('Thanks for the feedback.')) + '</small>';
      try { fetch('/api/ai/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: box.getAttribute('data-tool'), model: box.getAttribute('data-model'), rating: rating, reason: reason }) }).catch(function () {}); } catch (x) {}
    };
    if (b.getAttribute('data-pmr') === 'up') send('up');
    else if (b.getAttribute('data-pmr') === 'down') box.innerHTML = '<small>' + esc(T('What was wrong?')) + '</small> ' + WHY.map(function (w) { return '<button type="button" class="mini" data-pmw="' + w[0] + '">' + esc(T(w[1])) + '</button>'; }).join(' ');
    else send('down', b.getAttribute('data-pmw'));
  });
})();

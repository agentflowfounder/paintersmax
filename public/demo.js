/* PaintersMax public demo: chat with BP (Maistro in Spanish) and the friendly limit card. Nothing here is stored on a server. */
(function () {
  'use strict';
  var TRIES = 6; // the server decides; this only drives the small counter
  var T = {
    en: {
      name: 'BP', sub: 'Your business partner', open: 'Ask BP', close: 'Close', ph: 'Ask me anything', send: 'Send',
      hello: "Hi, I'm BP, your business partner. Ask me anything about PaintersMax, or try one of these.",
      chips: ['How much does it cost?', 'What can PaintersMax do?', 'Is it in Spanish?'],
      quote: 'Get an instant quote', color: 'Try the Color Studio', left: 'Questions left this visit: ',
      wait: 'BP is typing...', err: 'Something went wrong. Please try again.', long: 'Please keep it under 400 characters.',
      lt: "You've used your free tries for now",
      lead_visit: "That's the limit for this visit.", lead_ip: "This internet connection has used up today's tries.", lead_site: "Today's demo tries for everyone are used up. They start over tomorrow.",
      body: "This is a live example of what your website visitors would see if someone used up too many AI tries. The AI stops for that visitor, and your website and your credits stay safe. Here is how we look out for you:",
      b1: 'Every visitor gets a small number of tries per visit, a daily limit per internet connection, and the whole site has a daily cap. Nobody can run up your AI bill.',
      b2: 'Each AI tool has its own monthly allowance and credits on your plan, and PaintersMax can switch any AI tool off at once if something looks wrong.',
      b3: 'Photos are never saved. AI pictures are labeled previews. Nothing goes to your customers unless you send it.',
      b4: 'We tell you when your credits are running low, so a busy week never takes you by surprise.',
      end: 'Come back tomorrow to keep playing, or see the plans and try the real thing with your own prices.', cta: 'See the plans'
    },
    es: {
      name: 'Maistro', sub: 'Tu socio de negocio', open: 'Pregunta a Maistro', close: 'Cerrar', ph: 'Pregunta lo que quieras', send: 'Enviar',
      hello: 'Hola, soy Maistro, tu socio de negocio. Pregúntame lo que quieras sobre PaintersMax, o prueba una de estas.',
      chips: ['¿Cuánto cuesta?', '¿Qué puede hacer PaintersMax?', '¿Funciona en español?'],
      quote: 'Cotización instantánea', color: 'Probar Color Studio', left: 'Preguntas que quedan en esta visita: ',
      wait: 'Maistro está escribiendo...', err: 'Algo salió mal. Inténtalo de nuevo.', long: 'Por favor, usa menos de 400 caracteres.',
      lt: 'Ya usaste tus pruebas gratis por ahora',
      lead_visit: 'Ese es el límite de esta visita.', lead_ip: 'Esta conexión de internet ya usó las pruebas de hoy.', lead_site: 'Las pruebas de la demo de hoy se acabaron para todos. Empiezan de nuevo mañana.',
      body: 'Este es un ejemplo en vivo de lo que verían los visitantes de tu sitio web si alguien usara demasiadas pruebas de IA. La IA se detiene para ese visitante, y tu sitio y tus créditos quedan a salvo. Así te cuidamos:',
      b1: 'Cada visitante tiene pocas pruebas por visita, un límite diario por conexión de internet, y todo el sitio tiene un tope diario. Nadie puede subir tu cuenta de IA.',
      b2: 'Cada herramienta de IA tiene su propia cantidad mensual y créditos en tu plan, y PaintersMax puede apagar cualquier herramienta de IA al instante si algo se ve mal.',
      b3: 'Las fotos nunca se guardan. Las imágenes de IA son vistas previas marcadas. Nada llega a tus clientes si tú no lo envías.',
      b4: 'Te avisamos cuando tus créditos se están acabando, para que una semana ocupada no te sorprenda.',
      end: 'Vuelve mañana para seguir probando, o mira los planes y prueba lo real con tus propios precios.', cta: 'Ver los planes'
    }
  };
  var lang = 'en';
  try { lang = localStorage.getItem('pm_lang') === 'es' ? 'es' : 'en'; } catch (e) {}
  var bid = '';
  try { bid = sessionStorage.getItem('pm_bid') || ''; if (!bid) { bid = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('pm_bid', bid); } } catch (e) { bid = Math.random().toString(36).slice(2); }
  var history = [], left = TRIES, panel, body, input, count, fab, busy = false;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function t() { return T[lang]; }

  function limitCard(scope) {
    var x = t();
    var lead = x['lead_' + scope] || x.lead_visit;
    return '<div class="limitcard" role="status"><h4>' + esc(x.lt) + '</h4><p><b>' + esc(lead) + '</b></p><p style="margin-top:8px">' + esc(x.body) + '</p><ul><li>' + esc(x.b1) + '</li><li>' + esc(x.b2) + '</li><li>' + esc(x.b3) + '</li><li>' + esc(x.b4) + '</li></ul><p>' + esc(x.end) + '</p><a class="btn btn-orange arrow" href="/pricing">' + esc(x.cta) + '</a></div>';
  }

  function add(cls, html) {
    var d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    return d;
  }
  function chips(list, links) {
    var wrap = document.createElement('div');
    wrap.className = 'pm-chips';
    list.forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = q;
      b.onclick = function () { wrap.remove(); ask(q); };
      wrap.appendChild(b);
    });
    (links || []).forEach(function (l) {
      var a = document.createElement('a');
      a.href = l[1]; a.textContent = l[0];
      wrap.appendChild(a);
    });
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }
  function setCount() { count.textContent = t().left + Math.max(left, 0); }

  function ask(q) {
    if (busy) return;
    q = (q || '').trim();
    if (!q) return;
    if (q.length > 400) { add('pm-msg bot', esc(t().long)); return; }
    busy = true;
    add('pm-msg me', esc(q));
    var wait = add('pm-msg bot', esc(t().wait));
    fetch('/api/demo/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ browserId: bid, lang: lang, history: history.slice(-6), message: q }) })
      .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (o) {
        wait.remove();
        if (o.j && o.j.limited) { left = 0; setCount(); add('', limitCard(o.j.scope)); return; }
        if (!o.r.ok) { add('pm-msg bot', esc((o.j && o.j.error) || t().err)); return; }
        history.push({ role: 'user', content: q }, { role: 'assistant', content: o.j.reply });
        left -= 1; setCount();
        add('pm-msg bot', esc(o.j.reply));
      })
      .catch(function () { wait.remove(); add('pm-msg bot', esc(t().err)); })
      .then(function () { busy = false; });
  }

  function build() {
    fab = document.createElement('button');
    fab.className = 'pm-fab'; fab.type = 'button';
    fab.innerHTML = '<i></i><span></span>';
    fab.onclick = function () { open(); };
    panel = document.createElement('div');
    panel.className = 'pm-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Chat');
    panel.innerHTML = '<div class="pm-head"><div><b></b><small></small></div><div><button type="button" data-l>ES</button><button type="button" data-x></button></div></div><div class="pm-body"></div><div class="pm-count"></div><form class="pm-form"><input maxlength="400" autocomplete="off"><button type="submit"></button></form>';
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    body = panel.querySelector('.pm-body'); input = panel.querySelector('input'); count = panel.querySelector('.pm-count');
    panel.querySelector('form').onsubmit = function (e) { e.preventDefault(); var v = input.value; input.value = ''; ask(v); };
    panel.querySelector('[data-x]').onclick = function () { panel.classList.remove('on'); fab.style.display = 'flex'; };
    panel.querySelector('[data-l]').onclick = function () {
      lang = lang === 'en' ? 'es' : 'en';
      try { localStorage.setItem('pm_lang', lang); } catch (e) {}
      paint(); body.innerHTML = ''; greet();
    };
    paint();
  }
  function paint() {
    var x = t();
    fab.querySelector('span').textContent = x.open;
    panel.querySelector('b').textContent = x.name;
    panel.querySelector('small').textContent = x.sub;
    panel.querySelector('[data-x]').textContent = x.close;
    panel.querySelector('[data-l]').textContent = lang === 'en' ? 'ES' : 'EN';
    input.placeholder = x.ph;
    panel.querySelector('.pm-form button').textContent = x.send;
    setCount();
  }
  function greet(extra) {
    var x = t();
    if (extra) add('pm-msg bot', esc(extra));
    add('pm-msg bot', esc(x.hello));
    chips(x.chips, [[x.quote, '/instant-quote'], [x.color, '/color-studio']]);
  }
  function open(intro) {
    panel.classList.add('on'); fab.style.display = 'none';
    if (!body.children.length) greet(intro);
    else if (intro) add('pm-msg bot', esc(intro));
    setTimeout(function () { input.focus(); }, 50);
  }

  window.pmDemo = { open: open, limitCard: limitCard, lang: function () { return lang; }, bid: function () { return bid; }, t: t, esc: esc };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();

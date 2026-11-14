/* PaintersMax app language switch (English / Spanish).
 * How it works: pages are written in English. In Spanish mode this file swaps each piece of visible text for its
 * Spanish version from the dictionary below, including text that pages add later (lists, messages, pop-ups).
 * Text that is not in the dictionary (names, addresses, AI answers) is left as is.
 * The choice is kept in this browser (localStorage pm_lang) and saved to the painter's profile (/api/lang).
 * First pass translation: have a native speaker review it. To add a string, add it to D (exact text) or P (pattern). */
(function () {
  'use strict';
  var KEY = 'pm_lang', lang = 'en', D = {}, P = [];
  try { lang = localStorage.getItem(KEY) === 'es' ? 'es' : 'en'; } catch (e) {}
  var me = document.currentScript, isApp = !!(me && me.hasAttribute('data-app'));
  window.PM_LANG = lang;

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
  function t(s) {
    if (lang !== 'es' || typeof s !== 'string') return s;
    var k = norm(s);
    if (!k) return s;
    var m = s.match(/^([\s\u00b7\u2022]*)([\s\S]*?)(\s*)$/);
    var r = tr(norm(m[2]));
    return r === null ? s : m[1] + r + m[3];
  }
  function tr(k) {
    var v = D[k];
    if (v !== undefined) return v;
    for (var i = 0; i < P.length; i++) {
      var g = P[i][0].exec(k);
      if (g) { var out = P[i][1].apply(null, g); if (out !== null && out !== undefined) return out; }
    }
    // Several sentences in one piece of text: translate the ones we know.
    var parts = k.replace(/([.?!])\s+/g, '$1\u0001').split('\u0001');
    if (parts.length > 1 && parts.length < 8) {
      var hit = false, res = parts.map(function (p) { var r = tr(p); if (r === null) return p; hit = true; return r; });
      if (hit) return res.join(' ');
    }
    return null;
  }
  // Translate a piece of text for use inside a pattern rule (falls back to the original).
  function x(s) { var r = tr(norm(s)); return r === null ? s : r; }
  window.pmT = t;

  // ---- Shared helpers for every app page: friendly dates and the little "?" help bubbles ----
  // Dates are stored as YYYY-MM-DD (so they sort and export cleanly) and shown the way people read them.
  // pmDate('2026-11-13') -> "Fri, Nov 13, 2026"    pmDate('2026-11-09', 'long') -> "November 9, 2026"    pmDate('2026-11-09', 'month') -> "November 2026"
  window.pmDate = function (s, mode) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return s == null ? '' : String(s);
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (isNaN(d.getTime())) return String(s);
    var o = mode === 'long' ? { month: 'long', day: 'numeric', year: 'numeric' } : mode === 'month' ? { month: 'long', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
    o.timeZone = 'UTC';
    try { return new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', o).format(d); } catch (e) { return String(s); }
  };
  // pmHelp('Plain words explaining the box') -> a "?" button that opens the explanation right under it.
  window.pmHelp = function (text) {
    return '<button type="button" class="pmq" aria-label="Help" data-pmq="' + String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '">?</button>';
  };
  (function () {
    if (typeof document.createElement !== 'function') return;
    var st = document.createElement('style');
    st.textContent = '.pmq{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#E8A33D;color:#0F1B2D;font:700 12px/1 system-ui,sans-serif;margin-left:6px;vertical-align:middle}' +
      '.pmq:focus-visible{outline:2px solid #0F1B2D;outline-offset:2px}.pmqbox{display:block;background:#fff8e6;border:1px solid #f0d9a0;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:13px;line-height:1.45;color:#0F1B2D;font-weight:400;white-space:pre-line}';
    (document.head || document.documentElement).appendChild(st);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.pmq') : null;
      if (!b) return;
      var nx = b.nextElementSibling;
      if (nx && nx.className === 'pmqbox') { nx.remove(); return; }
      var box = document.createElement('span');
      box.className = 'pmqbox';
      box.textContent = b.getAttribute('data-pmq');
      b.parentNode.insertBefore(box, b.nextSibling);
    });
  })();

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var done = new WeakMap(); // text node or element -> what we wrote, so our own edits are not translated twice

  function skipped(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SKIP[e.nodeName] || e.getAttribute('translate') === 'no' || e.classList.contains('notranslate') || e.isContentEditable) return true;
    }
    return false;
  }
  function doText(n) {
    if (done.get(n) === n.nodeValue) return;
    if (n.parentNode && skipped(n.parentNode)) return;
    var out = t(n.nodeValue);
    if (out !== n.nodeValue) { n.nodeValue = out; }
    done.set(n, n.nodeValue);
  }
  function doAttr(el, a) {
    var v = el.getAttribute(a);
    if (!v) return;
    var key = '_' + a, rec = done.get(el) || {};
    if (rec[key] === v) return;
    var out = t(v);
    if (out !== v) el.setAttribute(a, out);
    rec[key] = out; done.set(el, rec);
  }
  function doEl(el) {
    if (el.nodeType !== 1 || el.nodeName === 'SCRIPT' || el.nodeName === 'STYLE') return;
    for (var i = 0; i < ATTRS.length; i++) if (el.hasAttribute(ATTRS[i])) doAttr(el, ATTRS[i]);
    if (el.nodeName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) {
      var nv = t(el.value); if (nv !== el.value) el.value = nv;
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doEl(root);
    if (SKIP[root.nodeName]) return;
    for (var c = root.firstChild; c; c = c.nextSibling) walk(c);
  }

  var obs = null;
  function start() {
    if (obs || lang !== 'es') return;
    walk(document.documentElement);
    obs = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]); }
        else if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttr(m.target, m.attributeName);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // Pop-ups use the same dictionary.
  var _c = window.confirm, _a = window.alert;
  window.confirm = function (m) { return _c.call(window, t(String(m))); };
  window.alert = function (m) { return _a.call(window, t(String(m))); };

  function setLang(l, noReload) {
    l = l === 'es' ? 'es' : 'en';
    try { localStorage.setItem(KEY, l); } catch (e) {}
    var save = isApp ? fetch('/api/lang', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: l }), keepalive: true }).catch(function () {}) : Promise.resolve();
    if (l === lang || noReload) return;
    save.then(function () { location.reload(); });
  }
  window.pmSetLang = setLang;

  // The EN | ES switch: in the page header when there is one, otherwise a small corner control.
  function mount() {
    if (document.getElementById('pm_lang')) return;
    var st = document.createElement('style');
    st.textContent = '#pm_lang{display:inline-flex;border:1px solid currentColor;border-radius:999px;overflow:hidden;margin-left:12px;vertical-align:middle;font:600 12px/1 system-ui,sans-serif}' +
      '#pm_lang button{all:unset;cursor:pointer;padding:6px 10px;opacity:.7}#pm_lang button[aria-pressed=true]{background:#E8A33D;color:#0F1B2D;opacity:1}' +
      '#pm_lang.fixed{position:fixed;top:10px;right:10px;z-index:50;background:#fff;color:#0F1B2D}';
    document.head.appendChild(st);
    var box = document.createElement('span');
    box.id = 'pm_lang'; box.className = 'notranslate'; box.setAttribute('translate', 'no');
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', lang === 'es' ? 'Idioma' : 'Language');
    box.innerHTML = '<button type="button" data-l="en" aria-pressed="' + (lang === 'en') + '" title="English">EN</button><button type="button" data-l="es" aria-pressed="' + (lang === 'es') + '" title="Español">ES</button>';
    box.onclick = function (e) { var b = e.target.closest('button'); if (b) setLang(b.getAttribute('data-l')); };
    var h = document.querySelector('header > div:last-child');
    if (h) h.appendChild(box); else { box.className += ' fixed'; document.body.appendChild(box); }
  }

  // A new browser has no saved choice: ask the account.
  function sync() {
    var has = null; try { has = localStorage.getItem(KEY); } catch (e) {}
    if (!isApp || has) return;
    fetch('/api/lang').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      try { localStorage.setItem(KEY, j.lang); } catch (e) {}
      if (j.lang === 'es') location.reload();
    }).catch(function () {});
  }

  window.pmI18n = {
    add: function (d, p) { for (var k in d) D[k] = d[k]; if (p) P = P.concat(p); }, x: x, start: start, dict: D,
  };
  document.addEventListener('DOMContentLoaded', function () { mount(); sync(); });
  if (lang === 'es') document.documentElement.lang = 'es';

  /* ---- Part 1: navigation, sign in, plans, Home and settings ---- */
  pmI18n.add({
    // navigation and common
    'PaintersMax': 'PaintersMax', 'Home': 'Inicio', 'Jobs': 'Trabajos', 'Materials': 'Materiales', 'Insurance': 'Seguro',
    'Estimating Setup': 'Configuración de presupuestos', 'Settings and leads': 'Ajustes y clientes potenciales',
    'Estimating Setup →': 'Configuración de presupuestos →', 'Jobs →': 'Trabajos →', 'Materials →': 'Materiales →', 'Insurance →': 'Seguro →',
    'Sign out': 'Cerrar sesión', 'Sign in': 'Iniciar sesión', 'Loading...': 'Cargando...', 'Save': 'Guardar', 'Cancel': 'Cancelar', 'Remove': 'Quitar',
    'Back': 'Atrás', 'Open': 'Abrir', 'Saved.': 'Guardado.', 'Could not save.': 'No se pudo guardar.', 'Could not load.': 'No se pudo cargar.',
    'Something went wrong.': 'Algo salió mal.', 'Not found': 'No encontrado', 'Name': 'Nombre', 'Phone': 'Teléfono', 'Email': 'Correo electrónico',
    'Price': 'Precio', 'Total': 'Total', 'Status': 'Estado', 'Date': 'Fecha', 'Notes': 'Notas', 'Link': 'Enlace', 'Contact': 'Contacto', 'Description': 'Descripción',
    'Language': 'Idioma', 'English': 'English', 'Español': 'Español', 'Spanish': 'Español', 'Help': 'Ayuda', 'Ready': 'Listo', 'none yet': 'ninguno todavía',
    // sign in
    'Sign in - PaintersMax': 'Iniciar sesión - PaintersMax', 'Sign in with Google': 'Iniciar sesión con Google', 'or use an email link': 'o use un enlace por correo',
    'Email me a link': 'Enviarme un enlace', "Enter your email and we'll send you a one-click sign-in link.": 'Escriba su correo y le enviaremos un enlace para entrar con un clic.',
    'If that email has an account, a sign-in link is on its way. It works for 15 minutes.': 'Si ese correo tiene una cuenta, le va a llegar un enlace para entrar. Funciona por 15 minutos.',
    'Google sign-in did not work. Please try again, or use an email link.': 'No funcionó el inicio de sesión con Google. Intente de nuevo o use un enlace por correo.',
    'Google sign-in is not available yet. Use an email link.': 'El inicio de sesión con Google todavía no está disponible. Use un enlace por correo.',
    'Google sign-in was cancelled.': 'Se canceló el inicio de sesión con Google.',
    'That Google account is not linked to a PaintersMax account. Use the email you signed up with, or contact us.': 'Esa cuenta de Google no está vinculada a una cuenta de PaintersMax. Use el correo con el que se registró o contáctenos.',
    // plans (start page)
    'Start with PaintersMax': 'Comience con PaintersMax', 'Starter': 'Starter', 'Basic': 'Basic', 'Pro': 'Pro', 'Company name': 'Nombre de la empresa', 'Your email': 'Su correo electrónico',
    'Pick a plan, pay securely, and sign in. A one-time setup fee of $499 applies to every plan.': 'Elija un plan, pague de forma segura e inicie sesión. Se aplica una cuota de instalación única de $499 a cada plan.',
    'Continue to secure payment': 'Continuar al pago seguro', 'Quotes, estimates and contracts in one place': 'Cotizaciones, presupuestos y contratos en un solo lugar',
    'Estimates, contracts, invoices': 'Presupuestos, contratos y facturas', 'Builder rate cards': 'Tarifas para constructores',
    'Up to 2 services and 2 cities': 'Hasta 2 servicios y 2 ciudades', 'Up to 5 services and 6 cities': 'Hasta 5 servicios y 6 ciudades', 'Up to 15 services and 25 cities': 'Hasta 15 servicios y 25 ciudades',
    'Job assistant: 60 questions a month': 'Asistente de trabajos: 60 preguntas al mes', 'Job assistant: 300 questions a month': 'Asistente de trabajos: 300 preguntas al mes', 'Job assistant: 1,500 questions a month': 'Asistente de trabajos: 1,500 preguntas al mes',
    "You will pay on Stripe's secure page. After payment, a sign-in link is emailed to you. You can cancel anytime.": 'Pagará en la página segura de Stripe. Después del pago, le enviaremos por correo un enlace para iniciar sesión. Puede cancelar en cualquier momento.',
    // Home
    'Home - PaintersMax': 'Inicio - PaintersMax', 'Needs your attention': 'Requiere su atención', 'Recent activity': 'Actividad reciente',
    'Nothing urgent. You are caught up.': 'Nada urgente. Está al día.', 'No activity yet. Create a job to get started.': 'Todavía no hay actividad. Cree un trabajo para empezar.',
    'Jobs in progress': 'Trabajos en curso', 'Signed in the last 7 days': 'Firmados en los últimos 7 días',
    'Lead': 'Cliente potencial', 'Estimate': 'Presupuesto', 'Signature': 'Firma', 'Invoice': 'Factura',
    'create your first job →': 'cree su primer trabajo →', 'Next step:': 'Siguiente paso:',
    'Set your prices in Estimating Setup': 'Configure sus precios en Configuración de presupuestos', 'set your prices in Estimating Setup →': 'configure sus precios en Configuración de presupuestos →',
    'Get started': 'Cómo empezar', 'Fill in your settings below': 'Complete sus ajustes abajo', 'Open Jobs': 'Abrir trabajos',
    // Signatures log
    'Signatures': 'Firmas', 'Awaiting signature': 'Esperando firma', 'Signed': 'Firmado', '✓ Signed': '✓ Firmado', 'Opened by customer': 'Abierto por el cliente', 'Expired': 'Vencido', 'Sent': 'Enviado',
    'Typical time to sign': 'Tiempo típico para firmar', 'under 1 hr': 'menos de 1 h', 'Customer': 'Cliente', 'Document': 'Documento', 'Job': 'Trabajo', 'PDF': 'PDF',
    'Could not load signatures.': 'No se pudieron cargar las firmas.', 'Contract': 'Contrato',
    // Leads
    'Leads': 'Clientes potenciales', 'No leads yet. Share your quote page link above.': 'Todavía no hay clientes potenciales. Comparta el enlace de su página de cotización de arriba.',
    // Quote page / settings
    'Your quote page': 'Su página de cotización', 'Share your quote page link': 'Comparta el enlace de su página de cotización', 'Embed code': 'Código para insertar',
    'Share this link, or paste the embed code into any website.': 'Comparta este enlace o pegue el código en cualquier sitio web.',
    'on your website, Facebook or business card.': 'en su sitio web, Facebook o tarjeta de presentación.', '(at the top of this page) on your website, Facebook or business card.': '(en la parte de arriba de esta página) en su sitio web, Facebook o tarjeta de presentación.',
    'Settings': 'Ajustes', 'Send lead emails to': 'Enviar correos de clientes potenciales a', 'New quote requests and chat leads are emailed here.': 'Aquí le llegan por correo las nuevas solicitudes de cotización y los clientes del chat.',
    'Brand color': 'Color de la marca', 'Used for buttons and highlights on your quote page. Pick a ready-made scheme, or choose your own color.': 'Se usa para los botones y detalles de su página de cotización. Elija un esquema listo o escoja su propio color.',
    'Navy and gold': 'Azul marino y dorado', 'Forest green': 'Verde bosque', 'Classic red': 'Rojo clásico', 'Ocean blue': 'Azul océano', 'Charcoal and orange': 'Carbón y naranja', 'Warm earth': 'Tierra cálida',
    'Or pick your own:': 'O escoja el suyo:', 'Use the default': 'Usar el predeterminado', 'Using the default gold': 'Usando el dorado predeterminado', 'Logo web address': 'Dirección web del logo',
    'Short message above the form': 'Mensaje corto arriba del formulario', 'One sentence customers see before they ask for a quote. Say only things that are true for your business.': 'Una frase que ven los clientes antes de pedir una cotización. Diga solo cosas que sean ciertas para su negocio.',
    'Example: Get a free painting estimate in about a minute. We will follow up within one business day.': 'Ejemplo: Reciba un presupuesto gratis de pintura en un minuto. Le responderemos en un día hábil.',
    'Example: Rivera Painting & Remodeling': 'Ejemplo: Rivera Pintura y Remodelación', 'Example: https://yourcompany.com/logo.png': 'Ejemplo: https://sucompañia.com/logo.png', 'Example: you@yourcompany.com': 'Ejemplo: usted@sucompañia.com',
    'Instant quote prices (per square foot)': 'Precios de cotización instantánea (por pie cuadrado)', 'Save settings': 'Guardar ajustes',
    'Interior painting': 'Pintura interior', 'Exterior painting': 'Pintura exterior', 'Interior + exterior': 'Interior + exterior', 'Commercial painting': 'Pintura comercial', 'Apartments and multifamily': 'Apartamentos y multifamiliares',
    'Lowest $': 'Más bajo $', 'Highest $': 'Más alto $', 'Example: 1.50': 'Ejemplo: 1.50', 'Example: 3.50': 'Ejemplo: 3.50', 'Leave both empty to use local standard rates.': 'Deje ambos vacíos para usar las tarifas estándar de su zona.',
    'Free estimate': 'Presupuesto gratis', 'and press Save. This controls how your quote page looks.': 'y presione Guardar. Esto controla cómo se ve su página de cotización.',
    'These ranges power the instant quotes your customers see on your quote page. Open a type of work and enter your lowest and highest price per square foot. Leave it blank and PaintersMax uses local standard rates. Your detailed prices for written estimates and contracts are set separately in':
      'Estos rangos alimentan las cotizaciones instantáneas que ven sus clientes en su página de cotización. Abra un tipo de trabajo e ingrese su precio más bajo y más alto por pie cuadrado. Si lo deja en blanco, PaintersMax usa las tarifas estándar de su zona. Sus precios detallados para presupuestos y contratos escritos se configuran por separado en',
    'How much do you charge for interior painting? Enter your lowest and highest price per square foot, for example 1.50 and 3.50.': '¿Cuánto cobra por pintura interior? Ingrese su precio más bajo y más alto por pie cuadrado, por ejemplo 1.50 y 3.50.',
    'How much do you charge to paint the outside of a home? Enter your lowest and highest price per square foot.': '¿Cuánto cobra por pintar el exterior de una casa? Ingrese su precio más bajo y más alto por pie cuadrado.',
    'How much do you charge when a customer wants the inside and outside done together? Enter your lowest and highest price per square foot.': '¿Cuánto cobra cuando el cliente quiere el interior y el exterior juntos? Ingrese su precio más bajo y más alto por pie cuadrado.',
    'How much do you charge for offices, shops and other commercial spaces? Enter your lowest and highest price per square foot.': '¿Cuánto cobra por oficinas, tiendas y otros espacios comerciales? Ingrese su precio más bajo y más alto por pie cuadrado.',
    'How much do you charge for apartment units and multifamily buildings? Enter your lowest and highest price per square foot.': '¿Cuánto cobra por unidades de apartamentos y edificios multifamiliares? Ingrese su precio más bajo y más alto por pie cuadrado.',
    'App language': 'Idioma de la aplicación', 'Show every page in English or Spanish. This is saved to your account.': 'Muestre todas las páginas en inglés o en español. Se guarda en su cuenta.',
  }, [
    // Home numbers and server messages
    [/^Jobs paid this month \((\d+)\)$/, function (a, n) { return 'Trabajos pagados este mes (' + n + ')'; }],
    [/^Booked work, signed and not finished \((\d+)\)$/, function (a, n) { return 'Trabajo contratado, firmado y sin terminar (' + n + ')'; }],
    [/^Estimates waiting on customers \((\d+)\)$/, function (a, n) { return 'Presupuestos esperando respuesta de clientes (' + n + ')'; }],
    [/^New leads to follow up \((\d+) this week\)$/, function (a, n) { return 'Clientes potenciales nuevos por atender (' + n + ' esta semana)'; }],
    [/^New lead waiting (\d+) days?: (.+)$/, function (a, n, r) { return 'Cliente potencial esperando ' + n + (n === '1' ? ' día' : ' días') + ': ' + r; }],
    [/^Estimate sent (\d+) days ago, no answer yet: (.+)$/, function (a, n, r) { return 'Presupuesto enviado hace ' + n + ' días, sin respuesta todavía: ' + r; }],
    [/^(.+) opened the (estimate|contract) but has not signed: (.+)$/, function (a, who, k, j) { return who + ' abrió el ' + (k === 'contract' ? 'contrato' : 'presupuesto') + ' pero no ha firmado: ' + j; }],
    [/^The signing link for (.+) expires soon: (.+)$/, function (a, who, j) { return 'El enlace de firma para ' + who + ' vence pronto: ' + j; }],
    [/^Invoice sent (\d+) days ago and not marked paid: (.+)$/, function (a, n, r) { return 'Factura enviada hace ' + n + ' días y no marcada como pagada: ' + r; }],
    [/^Your insurance policy expired (\d+) days ago\. Update it on the Insurance page\.$/, function (a, n) { return 'Su póliza de seguro venció hace ' + n + ' días. Actualícela en la página de Seguro.'; }],
    [/^Your insurance policy expires in (\d+) days\.$/, function (a, n) { return 'Su póliza de seguro vence en ' + n + ' días.'; }],
    // activity log texts written by the server
    [/^Job added by hand\.$/, function () { return 'Trabajo agregado a mano.'; }],
    [/^Estimate saved: (\$[\d,.]+)\.$/, function (a, m) { return 'Presupuesto guardado: ' + m + '.'; }],
    [/^Estimate emailed to (.+)\.$/, function (a, e) { return 'Presupuesto enviado por correo a ' + e + '.'; }],
    [/^Contract emailed to (.+)\.$/, function (a, e) { return 'Contrato enviado por correo a ' + e + '.'; }],
    [/^Contract saved\.$/, function () { return 'Contrato guardado.'; }],
    [/^Contract signed by both sides\.$/, function () { return 'Contrato firmado por ambas partes.'; }],
    [/^Invoice paid\. Job closed\.$/, function () { return 'Factura pagada. Trabajo cerrado.'; }],
    [/^(Estimate|Contract) signed online by (.+)\.$/, function (a, k, n) { return (k === 'Contract' ? 'Contrato' : 'Presupuesto') + ' firmado en línea por ' + n + '.'; }],
    [/^Sent the (estimate|contract) for signature to (.+?)( \(email not sent; copy the link\))?\.$/, function (a, k, e, no) { return 'Se envió el ' + (k === 'contract' ? 'contrato' : 'presupuesto') + ' para firma a ' + e + (no ? ' (no se envió el correo; copie el enlace)' : '') + '.'; }],
    [/^(.+) (saved|emailed to .+)\.$/, function (a, doc, rest) { var d = x(doc); if (d === doc) return null; return d + (rest === 'saved' ? ' guardado.' : ' enviado por correo a ' + rest.slice(11) + '.'); }],
  ]);

  /* ---- Part 2: insurance page ---- */
  pmI18n.add({
    'Insurance - PaintersMax': 'Seguro - PaintersMax', 'Know what your insurance covers': 'Conozca qué cubre su seguro', 'Upload your policy': 'Suba su póliza', 'Read my policy': 'Leer mi póliza',
    'A PDF or a clear photo of your policy, up to 5 MB. The declarations page, the list of exclusions and any endorsements give the best results.': 'Un PDF o una foto clara de su póliza, de hasta 5 MB. La página de declaraciones, la lista de exclusiones y los endosos dan los mejores resultados.',
    'Your file is sent to our AI provider to be read. We keep only the summary and the text it read, in your account, and not the original file. You can delete it any time. Reading takes up to a minute.': 'Su archivo se envía a nuestro proveedor de IA para que lo lea. Solo guardamos el resumen y el texto que leyó, en su cuenta, y no el archivo original. Puede borrarlo cuando quiera. La lectura tarda hasta un minuto.',
    'Keep a copy of the original file in my account, so I can open it on a job site or show it to a customer.': 'Guardar una copia del archivo original en mi cuenta, para abrirla en la obra o mostrársela a un cliente.',
    'Keeping a copy of the original file is not turned on yet. We will still read it and save the summary.': 'Guardar una copia del archivo original todavía no está activado. Igual lo leeremos y guardaremos el resumen.',
    'Choose a file first.': 'Primero elija un archivo.', 'Could not read that file.': 'No se pudo leer ese archivo.', 'No summary was produced.': 'No se produjo ningún resumen.',
    'Reading your policy. This can take up to a minute...': 'Leyendo su póliza. Puede tardar hasta un minuto...', 'Done. Review the summary below.': 'Listo. Revise el resumen de abajo.',
    'That file is over 5 MB. Upload just the declarations page and the exclusions pages.': 'Ese archivo pesa más de 5 MB. Suba solo la página de declaraciones y las páginas de exclusiones.',
    'That file is over 5 MB. Upload just the declarations and exclusions pages.': 'Ese archivo pesa más de 5 MB. Suba solo las páginas de declaraciones y exclusiones.',
    'Your policy summary': 'Resumen de su póliza', 'Carrier': 'Aseguradora', 'Insured': 'Asegurado', 'Effective': 'Vigente desde', 'Expires': 'Vence', ', expires': ', vence', 'Policy ends in': 'La póliza termina en',
    'Types': 'Tipos', 'Limits': 'Límites', 'Deductibles': 'Deducibles', 'Notable endorsements': 'Endosos importantes', 'File:': 'Archivo:', 'Preview': 'Vista previa',
    'What it appears to cover': 'Lo que parece cubrir', 'What it does not cover, or limits': 'Lo que no cubre, o límites', 'Which jobs can I take on?': '¿Qué trabajos puedo aceptar?',
    'Likely covered': 'Probablemente cubierto', 'Likely not covered': 'Probablemente no cubierto', 'Check with your agent': 'Consulte con su agente', 'This policy looks expired.': 'Esta póliza parece vencida.',
    'How to get covered for more': 'Cómo obtener más cobertura', 'Questions to ask your insurance agent': 'Preguntas para su agente de seguros', 'General information only.': 'Solo información general.',
    'Ask about your policy': 'Pregunte sobre su póliza', 'Your question': 'Su pregunta', 'Ask': 'Preguntar',
    "Example: Am I covered if a ladder falls on a customer's car? Do I need more coverage to paint a 3-story building?": 'Ejemplo: ¿Estoy cubierto si una escalera cae sobre el carro de un cliente? ¿Necesito más cobertura para pintar un edificio de 3 pisos?',
    'Am I covered for exterior work above two stories?': '¿Estoy cubierto para trabajo exterior arriba de dos pisos?', 'Does my policy cover my subcontractors?': '¿Mi póliza cubre a mis subcontratistas?',
    'Do I need more coverage for commercial jobs?': '¿Necesito más cobertura para trabajos comerciales?', 'How do I add coverage for lead paint work?': '¿Cómo agrego cobertura para trabajos con pintura con plomo?', 'What does my policy not cover?': '¿Qué no cubre mi póliza?',
    'Upload a different policy (replaces this summary)': 'Subir otra póliza (reemplaza este resumen)', 'Delete my policy summary and saved file': 'Borrar el resumen de mi póliza y el archivo guardado',
    'Delete your saved policy summary and text?': '¿Borrar el resumen y el texto guardados de su póliza?',
    'Your insurance tools': 'Sus herramientas de seguro', 'Open my policy file': 'Abrir el archivo de mi póliza', 'Your saved copy, ready to show on a job site.': 'Su copia guardada, lista para mostrar en la obra.',
    'Your original file was not kept. Upload it again with "Keep a copy" checked to save it here.': 'No se guardó su archivo original. Súbalo otra vez con "Guardar una copia" marcado para conservarlo aquí.',
    'Saving the original file is not turned on yet.': 'Guardar el archivo original todavía no está activado.',
    'Use my carrier and expiry date in my profile': 'Usar mi aseguradora y fecha de vencimiento en mi perfil', 'Saved to your profile:': 'Guardado en su perfil:', 'no carrier found': 'no se encontró aseguradora',
    'Email me 30 days and 7 days before my policy expires, and on the day it ends': 'Enviarme un correo 30 días y 7 días antes de que venza mi póliza, y el día en que termine',
    'Proof of insurance page for customers': 'Página de comprobante de seguro para clientes', 'Turn on my customer link': 'Activar mi enlace para clientes', 'Let customers also open my original policy file': 'Permitir que los clientes también abran el archivo original de mi póliza',
    'A simple page you can send or show a customer: your company, carrier, dates and limits. It is a summary you prepared, not an official certificate. Send an official certificate from your agent when a customer or building requires one.': 'Una página sencilla que puede enviar o mostrar a un cliente: su empresa, aseguradora, fechas y límites. Es un resumen preparado por usted, no un certificado oficial. Pida un certificado oficial a su agente cuando un cliente o un edificio lo exija.',
    'Anyone with this link can see the page. Turn it off to stop sharing.': 'Cualquier persona con este enlace puede ver la página. Apáguelo para dejar de compartir.', 'Copy link': 'Copiar enlace', 'Link copied.': 'Enlace copiado.',
    'Sharing is off.': 'Compartir está apagado.', 'Sharing is on. Turn it off and on again to get a new link.': 'Compartir está activado. Apáguelo y vuélvalo a encender para obtener un enlace nuevo.',
    // job page insurance banner
    'Insured: appears covered': 'Asegurado: parece cubierto', 'Insurance: may not cover': 'Seguro: puede no cubrir', 'Check your insurance': 'Revise su seguro', 'Policy expired': 'Póliza vencida',
    'Want to know if your insurance covers each job?': '¿Quiere saber si su seguro cubre cada trabajo?', 'and PaintersMax will check every lead and job for you.': 'y PaintersMax revisará cada cliente potencial y trabajo por usted.', 'Open your policy': 'Abra su póliza',
    'This is general information from your saved policy summary, not insurance advice. Confirm with your agent before a big job.': 'Esta es información general del resumen de su póliza guardado, no asesoría de seguros. Confirme con su agente antes de un trabajo grande.',
    'Your policy appears to cover this type of work.': 'Su póliza parece cubrir este tipo de trabajo.',
    'Check with your agent: your policy does not clearly cover this type of work.': 'Consulte con su agente: su póliza no cubre claramente este tipo de trabajo.',
    'Heads up: your policy appears NOT to cover this type of work.': 'Atención: su póliza parece NO cubrir este tipo de trabajo.',
    'Your insurance policy has expired. This job would not be covered until it is renewed.': 'Su póliza de seguro venció. Este trabajo no estaría cubierto hasta que la renueve.',
    'Your policy summary does not mention this kind of work.': 'El resumen de su póliza no menciona este tipo de trabajo.',
  }, [
    [/^The policy on file ended (.+)\.$/, function (a, d) { return 'La póliza registrada terminó el ' + d + '.'; }],
  ]);

  /* ---- Part 3: jobs ---- */
  pmI18n.add({
    'PaintersMax Jobs': 'Trabajos de PaintersMax', '← All jobs': '← Todos los trabajos', 'Create job': 'Crear trabajo', '+ Add a job you won yourself': '+ Agregar un trabajo que ganó usted',
    'Use this for work that did not come through your quote page, like a referral or a repeat customer.': 'Use esto para trabajos que no llegaron por su página de cotización, como una recomendación o un cliente que repite.',
    'No jobs yet. New leads from your quote form and chat appear here automatically, or add one with the button above.': 'Todavía no hay trabajos. Los clientes nuevos de su formulario de cotización y del chat aparecen aquí automáticamente, o agregue uno con el botón de arriba.',
    'New leads': 'Clientes potenciales nuevos', 'Customers who asked for a quote. Build an estimate to bid on them.': 'Clientes que pidieron una cotización. Prepare un presupuesto para ofertar.',
    'Waiting on the customer': 'Esperando al cliente', 'Estimates and contracts you sent. Waiting for the customer to approve or sign.': 'Presupuestos y contratos que envió. Esperando que el cliente apruebe o firme.',
    'Estimate approved': 'Presupuesto aprobado', 'The customer signed the estimate. Build and send the contract next.': 'El cliente firmó el presupuesto. Prepare y envíe el contrato ahora.',
    'In progress': 'En curso', 'Approved jobs that are scheduled or underway.': 'Trabajos aprobados que están programados o en marcha.', 'Closed': 'Cerrados', 'Finished and invoiced jobs.': 'Trabajos terminados y facturados.',
    'Lost': 'Perdido', 'Scheduled': 'Programado', 'Invoiced': 'Facturado', 'Punch list': 'Lista de pendientes', 'Waiting for signature': 'Esperando firma', 'Cancelled': 'Cancelado', 'Nothing yet.': 'Nada todavía.',
    'Job title': 'Título del trabajo', 'Example: Repaint 3 bedrooms': 'Ejemplo: Repintar 3 recámaras', 'Customer name': 'Nombre del cliente', 'Example: Maria Lopez': 'Ejemplo: María López', 'Example: maria@email.com': 'Ejemplo: maria@correo.com',
    'Example: 214-555-0123': 'Ejemplo: 214-555-0123', 'Job address (optional)': 'Dirección del trabajo (opcional)', 'Example: 123 Main St': 'Ejemplo: 123 Main St', 'City': 'Ciudad', 'Example: Dallas': 'Ejemplo: Dallas', 'Zip': 'Código postal', 'Example: 75201': 'Ejemplo: 75201',
    // steps
    '1. Measurements and quantities': '1. Medidas y cantidades', '2. Estimate': '2. Presupuesto', '3. Contract': '3. Contrato', '8. Invoice': '8. Factura', 'Type of work': 'Tipo de trabajo', 'Fill lines from my prices': 'Llenar líneas con mis precios',
    '(step 3), or add lines by hand below.': '(paso 3), o agregue líneas a mano abajo.', 'You have not set prices for this type of work yet.': 'Todavía no ha configurado precios para este tipo de trabajo.', 'Open Estimating Setup': 'Abrir Configuración de presupuestos',
    'Your minimum job and deposit are applied when you save.': 'Su trabajo mínimo y su depósito se aplican al guardar.', 'Add your costs first.': 'Primero agregue sus costos.',
    'Qty': 'Cant.', 'Unit': 'Unidad', 'Price ($)': 'Precio ($)', '+ Add a line': '+ Agregar una línea', '+ Add a cost': '+ Agregar un costo', '+ Add a milestone': '+ Agregar un hito', 'No lines yet. Fill them from your prices above, or add a line by hand.': 'Todavía no hay líneas. Llénelas con sus precios de arriba o agregue una línea a mano.',
    'Scope of work (what the customer gets)': 'Alcance del trabajo (lo que recibe el cliente)', 'Sales tax (%)': 'Impuesto sobre ventas (%)', 'Discount ($)': 'Descuento ($)', 'Valid for (days)': 'Válido por (días)', 'Save estimate': 'Guardar presupuesto',
    'Email this estimate to': 'Enviar este presupuesto por correo a', 'Email this contract to': 'Enviar este contrato por correo a', 'Email this invoice to': 'Enviar esta factura por correo a', 'Email this to': 'Enviar esto por correo a', 'Email to customer': 'Enviar por correo al cliente',
    'Included': 'Incluido', 'Not included': 'No incluido', 'Assumptions': 'Supuestos', 'Allowances (adjusted to actual cost)': 'Asignaciones (se ajustan al costo real)', 'Options, priced on request': 'Opciones, precio a solicitud',
    'What is included and not included': 'Qué está incluido y qué no', 'One item per line. These print on the estimate. The included, not included and assumptions lists also carry into the contract.': 'Un punto por línea. Se imprimen en el presupuesto. Las listas de incluido, no incluido y supuestos también pasan al contrato.',
    'Payment schedule': 'Calendario de pagos', 'Leave empty to use your deposit and final payment. Or split the price into milestones that add up to 100%.': 'Déjelo vacío para usar su depósito y su pago final. O divida el precio en hitos que sumen 100%.',
    'Deposit at signing': 'Depósito al firmar', 'Final payment on completion': 'Pago final al terminar', 'Final payment after punch list': 'Pago final después de la lista de pendientes', 'Posts set and rails installed': 'Postes colocados y barandales instalados', 'Work substantially complete': 'Trabajo casi terminado',
    'Example: on completion, or Dec 1': 'Ejemplo: al terminar, o 1 de dic.', 'Estimate emailed.': 'Presupuesto enviado por correo.',
    'Save the estimate first. The contract uses its price and scope.': 'Primero guarde el presupuesto. El contrato usa su precio y alcance.', 'Save the estimate first. The invoice uses its price.': 'Primero guarde el presupuesto. La factura usa su precio.',
    'Build contract from my estimate': 'Crear contrato a partir de mi presupuesto', 'Rebuild from my estimate (replaces edits)': 'Recrear a partir de mi presupuesto (reemplaza los cambios)', 'Save contract': 'Guardar contrato', 'Contract saved.': 'Contrato guardado.', 'Contract emailed.': 'Contrato enviado por correo.',
    'Start date': 'Fecha de inicio', 'Finish date': 'Fecha de terminación', 'Completion date': 'Fecha de terminación', 'Example: Monday, Nov 17': 'Ejemplo: lunes 17 de nov.', 'Example: Friday, Nov 21': 'Ejemplo: viernes 21 de nov.', 'Example: Nov 21, 2026': 'Ejemplo: 21 de nov. de 2026',
    'Have an attorney in your state review it before you use it with customers. Spanish text should be checked by a native speaker.': 'Pida a un abogado de su estado que lo revise antes de usarlo con clientes. El texto en español debe ser revisado por un hablante nativo.', 'Template, not legal advice.': 'Plantilla, no asesoría legal.',
    'Built. Edit anything you like.': 'Listo. Edite lo que quiera.', 'This replaces what is on screen with a fresh draft. Continue?': 'Esto reemplaza lo que está en pantalla con un borrador nuevo. ¿Continuar?', 'This replaces the invoice on screen. Continue?': 'Esto reemplaza la factura en pantalla. ¿Continuar?',
    // signatures
    'Send for e-signature': 'Enviar para firma electrónica', 'Send for signature to which email? (leave as is for the customer)': '¿A qué correo enviar para firma? (déjelo así para enviarlo al cliente)',
    'The customer gets a private link, signs on their phone, and you both get the signed copy by email. Save any changes first.': 'El cliente recibe un enlace privado, firma en su teléfono, y ambos reciben la copia firmada por correo. Guarde primero cualquier cambio.',
    'Cancel this signature request? The link stops working.': '¿Cancelar esta solicitud de firma? El enlace dejará de funcionar.', 'Open signed copy': 'Abrir copia firmada', 'Mark as signed': 'Marcar como firmado',
    'Mark this contract as signed by both sides?': '¿Marcar este contrato como firmado por ambas partes?', 'Marked as signed. The job moves to Scheduled.': 'Marcado como firmado. El trabajo pasa a Programado.',
    // docs
    'Download PDF': 'Descargar PDF', 'View / print': 'Ver / imprimir', 'Crew instructions': 'Instrucciones para el equipo', 'Materials list': 'Lista de materiales', 'Warranty letter': 'Carta de garantía', 'Schedule': 'Calendario', 'No schedule': 'Sin calendario',
    'Step-by-step instructions for your crew, in English or Spanish.': 'Instrucciones paso a paso para su equipo, en inglés o en español.', 'The final walkthrough checklist. The customer signs at the bottom.': 'La lista de la inspección final. El cliente firma al final.',
    'Give this to the customer when the job is finished.': 'Entregue esto al cliente cuando termine el trabajo.', 'What to buy for this job. Fill in the quantities, then print it for the supply store.': 'Qué comprar para este trabajo. Anote las cantidades y luego imprímalo para la tienda de materiales.',
    'Intro': 'Introducción', 'Tools': 'Herramientas', 'Buy': 'Comprar', 'Rent': 'Rentar', 'Notes for the customer': 'Notas para el cliente', 'Not saved yet': 'Todavía no se ha guardado',
    'Emailed.': 'Enviado por correo.', 'Invoice emailed.': 'Factura enviada por correo.', 'Invoice saved.': 'Factura guardada.', 'Invoice number': 'Número de factura', 'Due': 'Vence', 'Already paid ($)': 'Ya pagado ($)', 'Which payment is this invoice for?': '¿A qué pago corresponde esta factura?',
    'The whole job': 'El trabajo completo', 'Notes (how to pay, thank you)': 'Notas (cómo pagar, agradecimiento)', 'Uses the price from your saved estimate. Enter what the customer already paid, such as the deposit.': 'Usa el precio de su presupuesto guardado. Ingrese lo que el cliente ya pagó, como el depósito.',
    'Mark as paid': 'Marcar como pagada', 'Mark this invoice as paid? The job will close.': '¿Marcar esta factura como pagada? El trabajo se cerrará.', 'Paid. Job closed.': 'Pagada. Trabajo cerrado.', 'Job history': 'Historial del trabajo',
    // cost build-up
    'Cost build-up for a lump-sum bid': 'Desglose de costos para una oferta de precio global', 'Private to you. Add your costs and your markup for overhead, contingency and profit, then use the result as the project total line.': 'Privado para usted. Agregue sus costos y su margen para gastos generales, imprevistos y ganancia, y luego use el resultado como la línea de total del proyecto.',
    'Costs': 'Costos', 'Markup for overhead, contingency and profit (%)': 'Margen para gastos generales, imprevistos y ganancia (%)', 'Use as project total line': 'Usar como línea de total del proyecto', 'Project total': 'Total del proyecto', 'Added a Project total line.': 'Se agregó una línea de Total del proyecto.', 'Discount -': 'Descuento -',
    'Save to job notes': 'Guardar en las notas del trabajo',
    // assistant
    'Job assistant': 'Asistente de trabajos', 'Browse common questions by topic': 'Vea preguntas comunes por tema', 'Mic': 'Micrófono', 'Speak your question': 'Diga su pregunta',
    'Each question uses one of your monthly assistant questions.': 'Cada pregunta usa una de sus preguntas mensuales del asistente.', 'Answers are suggestions: check numbers and safety rules before you rely on them.': 'Las respuestas son sugerencias: verifique los números y las normas de seguridad antes de confiar en ellas.',
    'On a job, the assistant sees the estimate, documents and notes, but never the customer email, phone or street address.': 'En un trabajo, el asistente ve el presupuesto, los documentos y las notas, pero nunca el correo, el teléfono ni la dirección del cliente.',
    'Example: What primer should I use over water stains on a ceiling? Type your question, or tap the Mic button and speak it. Ask about bidding, safety, stains, coatings or equipment.': 'Ejemplo: ¿Qué imprimador debo usar sobre manchas de agua en un techo? Escriba su pregunta o toque el botón de micrófono y dígala. Pregunte sobre ofertas, seguridad, manchas, recubrimientos o equipo.',
    'Bidding and pricing': 'Ofertas y precios', 'Prep, stains and repairs': 'Preparación, manchas y reparaciones', 'Coatings and finishes': 'Recubrimientos y acabados', 'Spraying and equipment': 'Rociado y equipo', 'Safety': 'Seguridad', 'Customers and business': 'Clientes y negocio',
    'How do I price a ceiling in a small bathroom?': '¿Cómo cotizo un techo en un baño pequeño?', 'How do I bid a repaint by the square foot?': '¿Cómo cotizo un repintado por pie cuadrado?', 'How much should I charge to paint kitchen cabinets?': '¿Cuánto debo cobrar por pintar gabinetes de cocina?',
    'What markup should I add for overhead and profit?': '¿Qué margen debo agregar para gastos generales y ganancia?', 'What primer do I use over water stains on a ceiling?': '¿Qué imprimador uso sobre manchas de agua en un techo?', 'How do I remove mildew before painting?': '¿Cómo quito el moho antes de pintar?',
    'How do I cover smoke or nicotine stains?': '¿Cómo cubro manchas de humo o nicotina?', 'How do I fix peeling paint on an exterior wall?': '¿Cómo arreglo pintura que se pela en una pared exterior?', 'When should I use oil-based instead of water-based paint?': '¿Cuándo debo usar pintura de aceite en vez de pintura a base de agua?',
    'What is the difference between epoxy, lacquer and varnish?': '¿Cuál es la diferencia entre epoxi, laca y barniz?', 'How long should I wait between coats?': '¿Cuánto debo esperar entre capas?', 'Which sheen should I use in kitchens, baths and trim?': '¿Qué brillo debo usar en cocinas, baños y molduras?',
    'How do I clean an airless sprayer?': '¿Cómo limpio una pistola airless?', 'Why does my sprayer spit or leave tails?': '¿Por qué mi pistola escupe o deja colas?', 'What tip size should I use for latex on walls?': '¿Qué tamaño de boquilla debo usar para látex en paredes?',
    'How do I store a sprayer for the winter?': '¿Cómo guardo una pistola para el invierno?', 'What do I do about lead paint in a home built before 1978?': '¿Qué hago con la pintura con plomo en una casa construida antes de 1978?', 'What respirator do I need for spraying oil-based paint?': '¿Qué respirador necesito para rociar pintura de aceite?',
    'How do I stay safe on ladders and scaffolds?': '¿Cómo me mantengo seguro en escaleras y andamios?', 'How do I handle and dispose of leftover paint and rags?': '¿Cómo manejo y desecho la pintura sobrante y los trapos?', 'Write a short message asking a customer to approve my estimate': 'Escribe un mensaje corto pidiendo a un cliente que apruebe mi presupuesto',
    'How do I handle a change order in the middle of a job?': '¿Cómo manejo una orden de cambio a mitad de un trabajo?', 'How do I ask for a deposit politely?': '¿Cómo pido un depósito con cortesía?', 'How do I answer a customer who says my price is too high?': '¿Cómo respondo a un cliente que dice que mi precio es muy alto?',
    'What is left to do on this job?': '¿Qué falta por hacer en este trabajo?', 'How much paint will I need?': '¿Cuánta pintura voy a necesitar?', 'What should I watch out for?': '¿Qué debo vigilar?', 'What primer do I use over stains?': '¿Qué imprimador uso sobre manchas?', 'Write a short message to the customer about the schedule': 'Escribe un mensaje corto al cliente sobre el calendario',
    // measurements
    'Small rooms': 'Cuartos pequeños', 'Medium rooms': 'Cuartos medianos', 'Large rooms': 'Cuartos grandes', 'Custom rooms': 'Cuartos personalizados', 'Ceilings': 'Techos', 'Rooms with trim': 'Cuartos con molduras', 'Doors': 'Puertas', 'Accent walls': 'Paredes de acento', 'Repair hours': 'Horas de reparación',
    '1-story house (1 = yes)': 'Casa de 1 piso (1 = sí)', '2-story house (1 = yes)': 'Casa de 2 pisos (1 = sí)', '3-story house (1 = yes)': 'Casa de 3 pisos (1 = sí)', 'Shutters': 'Contraventanas', 'Windows': 'Ventanas', 'Garage doors': 'Puertas de garaje', 'Power washing (1 = yes)': 'Lavado a presión (1 = sí)',
    'Wood repair hours': 'Horas de reparación de madera', 'Extra colors': 'Colores adicionales', 'Gates': 'Portones', 'Old fence to remove (ft)': 'Cerca vieja por quitar (pies)', 'Staining or painting (ft)': 'Teñido o pintura (pies)', 'Mobilization (1 = yes)': 'Movilización (1 = sí)', 'Lift days': 'Días de elevador', 'Labor hours': 'Horas de trabajo',
    'Square feet of floor area': 'Pies cuadrados de área de piso', 'Square feet of wall': 'Pies cuadrados de pared', 'Linear feet': 'Pies lineales', 'Your cost for the whole job ($)': 'Su costo por el trabajo completo ($)', 'lump sum': 'precio global',
    'Interior': 'Interior', 'Exterior': 'Exterior', 'Commercial': 'Comercial', 'New construction': 'Construcción nueva', 'Power washing': 'Lavado a presión', 'Drywall repair': 'Reparación de tablaroca', 'Cabinet painting': 'Pintura de gabinetes', 'Decks and fences': 'Terrazas y cercas',
    'Fence installation': 'Instalación de cercas', 'Remodeling': 'Remodelación', 'Epoxy floors': 'Pisos de epoxi', 'Industrial': 'Industrial', 'Using your': 'Usando su',
  }, [
    [/^Email this (estimate|contract|invoice) to (.+)$/, function (a, w, e) { return 'Enviar este ' + (w === 'estimate' ? 'presupuesto' : w === 'contract' ? 'contrato' : 'factura') + ' por correo a ' + e; }],
    [/^Status: (.+)$/, function (a, s) { return 'Estado: ' + x(s); }],
    [/^Price (\$[\d,.]+)$/, function (a, p) { return 'Precio ' + p; }],
  ]);

  /* ---- Part 4: Estimating Setup ---- */
  pmI18n.add({
    'PaintersMax Estimating Setup': 'Configuración de presupuestos de PaintersMax',
    'Set your prices once. PaintersMax uses them for every estimate and you can adjust any job. Tap the ? for measuring help.': 'Configure sus precios una sola vez. PaintersMax los usa en cada presupuesto y usted puede ajustarlos en cada trabajo. Toque el ? para ayuda con las medidas.',
    'Your company': 'Su empresa', 'Used for estimates, contracts and invoices.': 'Se usa en presupuestos, contratos y facturas.', 'License number (if you have one)': 'Número de licencia (si tiene)', 'Website (https://...)': 'Sitio web (https://...)', 'Address': 'Dirección', 'State': 'Estado', 'ZIP': 'Código postal',
    'Cities you serve (separate with commas)': 'Ciudades que atiende (sepárelas con comas)', 'Services': 'Servicios', 'Labor and money': 'Mano de obra y dinero', 'Labor and Money': 'Mano de obra y dinero',
    'Crew size': 'Tamaño del equipo', 'Labor per hour ($)': 'Mano de obra por hora ($)', 'Your hourly rate ($)': 'Su tarifa por hora ($)', 'Helper hourly rate ($)': 'Tarifa por hora del ayudante ($)', 'Minimum job ($)': 'Trabajo mínimo ($)', 'Material markup (%)': 'Margen en materiales (%)', 'Overhead (%)': 'Gastos generales (%)',
    'Deposit (% of the job)': 'Depósito (% del trabajo)', 'Payment terms': 'Condiciones de pago', 'Markup on cost (%)': 'Margen sobre el costo (%)',
    'How you price': 'Cómo cotiza', 'How do you price this?': '¿Cómo cotiza esto?', 'By square foot of floor area': 'Por pie cuadrado de área de piso', 'By paintable wall area': 'Por área de pared pintable', 'By room size (small, medium, large, custom)': 'Por tamaño de cuarto (pequeño, mediano, grande, personalizado)',
    'By line item': 'Por partida', 'Per square foot': 'Por pie cuadrado', 'Per linear foot': 'Por pie lineal', 'Per sq ft of paintable surface': 'Por pie cuadrado de superficie pintable', 'Lump-sum bid (markup on cost)': 'Oferta de precio global (margen sobre el costo)', 'Base price by stories, plus add-ons': 'Precio base por pisos, más extras',
    'Low price per sq ft ($)': 'Precio bajo por pie cuadrado ($)', 'High price per sq ft ($)': 'Precio alto por pie cuadrado ($)', 'Low price per linear ft ($)': 'Precio bajo por pie lineal ($)', 'High price per linear ft ($)': 'Precio alto por pie lineal ($)',
    'Small room price ($)': 'Precio de cuarto pequeño ($)', 'Medium room price ($)': 'Precio de cuarto mediano ($)', 'Large room price ($)': 'Precio de cuarto grande ($)', 'Custom room minimum ($)': 'Mínimo de cuarto personalizado ($)',
    'Add-on: ceiling ($)': 'Extra: techo ($)', 'Add-on: trim and baseboards ($)': 'Extra: molduras y zoclos ($)', 'Add-on: each door ($)': 'Extra: cada puerta ($)', 'Add-on: accent wall ($)': 'Extra: pared de acento ($)', 'Each door ($)': 'Cada puerta ($)', 'Each shutter ($)': 'Cada contraventana ($)', 'Each window ($)': 'Cada ventana ($)', 'Garage door ($)': 'Puerta de garaje ($)',
    'Each extra color ($)': 'Cada color adicional ($)', 'Each gate ($)': 'Cada portón ($)', 'Repairs per hour ($)': 'Reparaciones por hora ($)', 'Wood repair per hour ($)': 'Reparación de madera por hora ($)', 'Power washing, whole house ($)': 'Lavado a presión, casa completa ($)', 'Old fence removal per ft ($)': 'Quitar cerca vieja por pie ($)',
    'Staining or painting per ft ($)': 'Teñido o pintura por pie ($)', 'Mobilization ($)': 'Movilización ($)', 'Lift or scaffold per day ($)': 'Elevador o andamio por día ($)', 'Typical 1-story house ($)': 'Casa típica de 1 piso ($)', 'Typical 2-story house ($)': 'Casa típica de 2 pisos ($)', 'Typical 3-story house ($)': 'Casa típica de 3 pisos ($)',
    'Extra coat surcharge (%)': 'Recargo por capa extra (%)', 'High ceiling surcharge (%)': 'Recargo por techo alto (%)', 'Night or weekend surcharge (%)': 'Recargo por noche o fin de semana (%)',
    'Power washing is always its own line on the estimate.': 'El lavado a presión siempre es una línea aparte en el presupuesto.', 'Builder rates': 'Tarifas para constructores', 'Builder rate cards are on the Basic and Pro plans.': 'Las tarifas para constructores están en los planes Basic y Pro.',
    'Builder rates are the lower per-house or per-sq-ft prices you give a home builder or contractor who keeps you busy all year. Customers never see them.': 'Las tarifas para constructores son los precios más bajos por casa o por pie cuadrado que da a un constructor o contratista que le da trabajo todo el año. Los clientes nunca las ven.',
    'Floor area: length x width of each room, added together. Example: a 12 ft x 15 ft bedroom is 180 sq ft. Most repaints are quoted from the whole home floor area.': 'Área de piso: largo x ancho de cada cuarto, sumados. Ejemplo: una recámara de 12 pies x 15 pies son 180 pies cuadrados. La mayoría de los repintados se cotizan por el área de piso de toda la casa.',
    'Paintable wall area: add up the length of every wall, multiply by the height, then subtract about 20 sq ft for each door and 15 sq ft for each window. Example: 4 walls totaling 54 ft x 8 ft = 432 sq ft, minus 1 door and 1 window = about 397 sq ft.': 'Área de pared pintable: sume el largo de todas las paredes, multiplíquelo por la altura y reste unos 20 pies cuadrados por cada puerta y 15 por cada ventana. Ejemplo: 4 paredes que suman 54 pies x 8 pies = 432 pies cuadrados, menos 1 puerta y 1 ventana = unos 397 pies cuadrados.',
    'Linear feet: the total length of the fence or trim run. Walk it with a measuring wheel, or measure it on a satellite map. Add a foot or two per gate or corner.': 'Pies lineales: el largo total de la cerca o de la moldura. Camínelo con una rueda de medir o mídalo en un mapa satelital. Agregue uno o dos pies por cada portón o esquina.',
    'Small: closets, hallways, half baths. Medium: bedrooms, dining rooms, offices. Large: kitchens, living rooms, primary bedroom or bath, garage. Custom: anything else, priced on the job.': 'Pequeño: clósets, pasillos, medios baños. Mediano: recámaras, comedores, oficinas. Grande: cocinas, salas, recámara o baño principal, garaje. Personalizado: cualquier otra cosa, cotizada en el trabajo.',
    'Exterior prices vary a lot. A simple method: a base price for a typical 1, 2 or 3 story house, then add-ons for doors, shutters, windows and repairs. You can adjust on every job.': 'Los precios exteriores varían mucho. Un método sencillo: un precio base para una casa típica de 1, 2 o 3 pisos, y luego extras por puertas, contraventanas, ventanas y reparaciones. Puede ajustarlo en cada trabajo.',
    'Interior painting ': 'Pintura interior ', 'Decks and fence staining': 'Teñido de terrazas y cercas', 'New construction (builders)': 'Construcción nueva (constructores)', 'Industrial coatings': 'Recubrimientos industriales',
    // extras step
    'Warranty, insurance and materials': 'Garantía, seguro y materiales', 'Labor warranty (months)': 'Garantía de mano de obra (meses)', "Warranty details (we add the paint maker's warranty and the customer-keeps-receipts note for you)": 'Detalles de la garantía (nosotros agregamos la garantía del fabricante de la pintura y la nota de que el cliente guarde los recibos)',
    'Exclusions': 'Exclusiones', 'Insurance': 'Seguro', ' Enter only what is true.': ' Anote solo lo que sea cierto.', 'Enter only what is true.': 'Anote solo lo que sea cierto.', 'Have a copy of your policy?': '¿Tiene una copia de su póliza?',
    'Upload it and our AI will explain in plain words what it covers, what it does not, which jobs you can take on, and how to get covered for more. Then you can ask it questions.': 'Súbala y nuestra IA le explicará con palabras sencillas qué cubre, qué no cubre, qué trabajos puede aceptar y cómo obtener más cobertura. Después puede hacerle preguntas.',
    'Open the insurance page': 'Abrir la página de seguro', 'PDF or photo, up to 5 MB. Your file is sent to our AI provider to be read. We keep only the summary and the text it read, not the original file, and you can delete it any time. General information only, not insurance advice.': 'PDF o foto, de hasta 5 MB. Su archivo se envía a nuestro proveedor de IA para que lo lea. Solo guardamos el resumen y el texto que leyó, no el archivo original, y puede borrarlo cuando quiera. Solo información general, no asesoría de seguros.',
    'Carrier': 'Aseguradora', 'Coverage summary': 'Resumen de cobertura', 'Customers may see a summary of my coverage': 'Los clientes pueden ver un resumen de mi cobertura', 'Paint brands you use': 'Marcas de pintura que usa', 'Other products or notes': 'Otros productos o notas',
    'Crew documents (materials, schedule, instructions, punch list)': 'Documentos para el equipo (materiales, calendario, instrucciones, lista de pendientes)', 'Save and continue': 'Guardar y continuar',
    'Saved. Your business profile is complete.': 'Guardado. El perfil de su negocio está completo.', 'Here is what we saved. You can change any of it later.': 'Esto es lo que guardamos. Puede cambiar cualquier cosa después.', 'What happens next': 'Qué sigue', 'What you do, and where': 'Qué hace usted, y dónde',
    'We save this once and use it on every estimate and contract.': 'Esto se guarda una vez y se usa en cada presupuesto y contrato.', '(company name missing)': '(falta el nombre de la empresa)', 'Cities:': 'Ciudades:', 'Warranty:': 'Garantía:', 'Labor warranty': 'Garantía de mano de obra', 'Labor: crew of': 'Mano de obra: equipo de',
    "Your estimates, contracts, material lists and schedules will use these settings. Estimate and contract documents are the next steps we are building.": 'Sus presupuestos, contratos, listas de materiales y calendarios usarán estos ajustes.',
    'Upload just the declarations and exclusions pages.': 'Suba solo las páginas de declaraciones y exclusiones.',
    'Your plan (': 'Su plan (', 'Your plan includes up to': 'Su plan incluye hasta', 'services and': 'servicios y', ') includes up to': ') incluye hasta',
    'App language (the pages you use every day)': 'Idioma de la aplicación (las páginas que usa todos los días)',
  }, [
    [/^(\d+) services? and (\d+) cit(?:y|ies)$/, function (a, s, c) { return s + (s === '1' ? ' servicio' : ' servicios') + ' y ' + c + (c === '1' ? ' ciudad' : ' ciudades'); }],
    [/^Your plan \((.+)\) includes up to (\d+) services? and (\d+) cit(?:y|ies)\.?$/, function (a, p, s, c) { return 'Su plan (' + p + ') incluye hasta ' + s + ' servicios y ' + c + ' ciudades.'; }],
  ]);

  /* ---- Part 5: Materials page ---- */
  pmI18n.add({
    'Materials and tools - PaintersMax': 'Materiales y herramientas - PaintersMax', 'Recommended materials and tools': 'Materiales y herramientas recomendados',
    'A starter list for a painting crew. Check off what you already own, and the rest becomes your shopping list. Tap': 'Una lista inicial para un equipo de pintura. Marque lo que ya tiene y el resto se convierte en su lista de compras. Toque',
    'to see current online prices for an item.': 'para ver los precios actuales en línea de un artículo.', 'Compare prices': 'Comparar precios', 'Show only what I still need': 'Mostrar solo lo que todavía necesito', 'Print my shopping list': 'Imprimir mi lista de compras', 'You have everything on the list.': 'Ya tiene todo lo de la lista.',
    'Your checkmarks are saved on this device. This list is a general starting point, not a requirement. Add or skip items to fit the work you do.': 'Sus marcas se guardan en este dispositivo. Esta lista es un punto de partida general, no un requisito. Agregue u omita artículos según el trabajo que haga.',
    'Disclosure: some links on this page are affiliate links. If you buy through them, PaintersMax may earn a small commission at no extra cost to you. It never changes your price.': 'Aviso: algunos enlaces de esta página son de afiliados. Si compra a través de ellos, PaintersMax puede ganar una pequeña comisión sin costo adicional para usted. Nunca cambia su precio.',
    'Brushes and rollers': 'Brochas y rodillos', 'Masking and protection': 'Enmascarado y protección', 'Prep and repair': 'Preparación y reparación', 'Spray equipment': 'Equipo de rociado', 'Ladders and access': 'Escaleras y acceso', 'Cleanup and daily use': 'Limpieza y uso diario',
    '2.5 in angled sash brush, synthetic': 'Brocha angular de 2.5 pulgadas, sintética', '3 in flat wall brush': 'Brocha plana de 3 pulgadas para paredes', 'Natural bristle brush for oil-based paint': 'Brocha de cerda natural para pintura de aceite', '4 in mini roller kit with covers': 'Juego de minirrodillo de 4 pulgadas con fundas',
    '9 in roller frame, heavy duty': 'Armazón de rodillo de 9 pulgadas, uso rudo', 'Roller covers, 3/8 in nap': 'Fundas de rodillo, felpa de 3/8 pulgada', 'Roller covers, 3/4 in nap': 'Fundas de rodillo, felpa de 3/4 pulgada', 'Extension pole, 4 to 8 ft': 'Extensión de 4 a 8 pies', 'Paint pail liners and 5 gal bucket grid': 'Forros para charola y rejilla para cubeta de 5 galones',
    'Roller and brush spinner and comb': 'Centrifugadora y peine para rodillos y brochas', 'Painters tape, 1.5 in, multi-surface': 'Cinta para pintores, 1.5 pulgadas, multisuperficie', 'Painters tape, 2 in': 'Cinta para pintores, 2 pulgadas', 'Plastic sheeting and masking film': 'Plástico y película de enmascarar', 'Hand masker with paper': 'Enmascarador manual con papel',
    'Canvas drop cloths, 9x12 ft': 'Lonas protectoras de lona, 9x12 pies', 'Rosin or floor protection paper': 'Papel de resina o de protección de pisos', 'Wire brush and scraper for exterior': 'Cepillo de alambre y raspador para exteriores', 'Putty knives, 1.5 in and 3 in': 'Espátulas de 1.5 y 3 pulgadas', '6 in and 10 in drywall taping knives': 'Llanas de tablaroca de 6 y 10 pulgadas',
    'Lightweight spackle': 'Masilla ligera', 'Joint compound': 'Compuesto para juntas', 'Wood filler': 'Relleno para madera', 'Painter caulk, paintable': 'Sellador para pintores, pintable', 'Caulk gun, dripless': 'Pistola para sellador, sin goteo', 'Sanding sponges, assorted grit': 'Esponjas de lija, granos surtidos', 'Pole sander and 120/150 grit sheets': 'Lijadora con extensión y hojas de grano 120/150',
    'Stain-blocking primer': 'Imprimador bloqueador de manchas', 'Bonding primer for slick surfaces': 'Imprimador de adherencia para superficies lisas', 'TSP substitute or degreaser': 'Sustituto de TSP o desengrasante', 'TSP substitute cleaner paint prep': 'Sustituto de TSP, limpiador para preparar pintura', 'Mildew remover': 'Removedor de moho',
    'Airless sprayer (about 0.5 to 0.8 gpm)': 'Pistola airless (de unos 0.5 a 0.8 gpm)', 'Spray tips and tip guard set': 'Juego de boquillas y protector de boquilla', 'Extra airless hose, 50 ft': 'Manguera airless adicional, 50 pies', 'Airless pump cleaner and storage fluid': 'Limpiador y líquido de almacenamiento para bomba airless',
    '28 ft fiberglass extension ladder': 'Escalera de extensión de fibra de vidrio de 28 pies', '24 to 28 ft extension ladder': 'Escalera de extensión de 24 a 28 pies', '6 ft fiberglass step ladder': 'Escalera de tijera de fibra de vidrio de 6 pies', 'Ladder levelers and stand-off': 'Niveladores y separador para escalera', 'Pump jack or scaffold (rent when needed)': 'Gato de bomba o andamio (rentar cuando se necesite)',
    '5 gallon bucket with lid': 'Cubeta de 5 galones con tapa', 'Five gallon buckets with lids': 'Cubetas de cinco galones con tapa', 'Paint can opener and pour spouts': 'Abridor de latas y piquetes de vertido', 'Paint stirrer sticks and mixing paddle': 'Palitos para mezclar y paleta mezcladora', 'Rags and shop towels': 'Trapos y toallas de taller', 'Heavy contractor trash bags': 'Bolsas de basura de uso rudo para contratistas',
    'Nitrile gloves': 'Guantes de nitrilo', 'Safety glasses': 'Lentes de seguridad', 'Respirator with organic vapor and P100 cartridges': 'Respirador con cartuchos de vapor orgánico y P100', 'Hearing protection for spraying': 'Protección auditiva para rociar', 'Knee pads': 'Rodilleras', 'First aid kit and eye wash': 'Botiquín de primeros auxilios y lavaojos', 'Lead test swabs and lead-safe supplies': 'Hisopos de prueba de plomo y materiales seguros contra el plomo',
    'Airless pumps are loud over a full day.': 'Las bombas airless son ruidosas durante todo el día.', 'Baseboards and floors. Your knees will thank you.': 'Zoclos y pisos. Sus rodillas se lo agradecerán.', 'Ceilings and high walls without a ladder.': 'Techos y paredes altas sin escalera.', 'Clean lines on trim and edges. Use delicate-surface tape where needed.': 'Líneas limpias en molduras y bordes. Use cinta para superficies delicadas donde haga falta.',
    'Clean pours and fewer spills.': 'Vertidos limpios y menos derrames.', 'Cleaning grease and grime off walls before painting.': 'Quitar grasa y mugre de las paredes antes de pintar.', 'Cover furniture, floors and windows. Pre-taped film speeds masking.': 'Cubra muebles, pisos y ventanas. La película con cinta ya puesta agiliza el enmascarado.', 'Cutting in edges and trim with latex paint.': 'Cortar bordes y molduras con pintura de látex.',
    'Debris and used masking. Keep sites clean.': 'Escombros y material de enmascarado usado. Mantenga limpios los sitios.', 'Doors, cabinets and trim for a smooth finish.': 'Puertas, gabinetes y molduras para un acabado liso.', 'Extends the life of brushes and covers.': 'Alarga la vida de brochas y fundas.', 'Exterior walls up to two stories. Follow the height rating and set it at the right angle.': 'Paredes exteriores de hasta dos pisos. Respete la altura máxima indicada y colóquela en el ángulo correcto.',
    'Fast color changes and cleanup. The grid replaces a tray on big jobs.': 'Cambios de color y limpieza rápidos. La rejilla reemplaza la charola en trabajos grandes.', 'Fast coverage on exteriors, new construction and large rooms. A big time saver.': 'Cobertura rápida en exteriores, construcción nueva y cuartos grandes. Ahorra mucho tiempo.', 'Fast masking around windows and trim before spraying.': 'Enmascarado rápido alrededor de ventanas y molduras antes de rociar.',
    'Filling holes and light scraping.': 'Rellenar agujeros y raspar ligeramente.', 'Floors that people walk on. Plastic is slippery and can slip.': 'Pisos por donde camina la gente. El plástico es resbaloso y se puede deslizar.', 'Gaps at trim and baseboards for a crisp finish.': 'Huecos en molduras y zoclos para un acabado nítido.', 'Glossy trim, tile, laminate and cabinets.': 'Molduras brillantes, azulejo, laminado y gabinetes.',
    'Homes built before 1978 need lead-safe practices. Check EPA rules for your work.': 'Las casas construidas antes de 1978 requieren prácticas seguras contra el plomo. Revise las reglas de la EPA para su trabajo.', 'Interior work. Fiberglass is the safe choice near electrical.': 'Trabajo interior. La fibra de vidrio es la opción segura cerca de la electricidad.', 'Keeps solvents and primers off your skin.': 'Mantiene los solventes e imprimadores fuera de su piel.',
    'Keeps the pump alive between jobs and over winter.': 'Mantiene viva la bomba entre trabajos y durante el invierno.', 'Larger areas and corners where a roller does not reach.': 'Áreas grandes y esquinas donde no llega el rodillo.', 'Larger drywall repairs and skim coats.': 'Reparaciones grandes de tablaroca y capas delgadas de acabado.', 'Long exterior walls and tall work. Rent first before buying.': 'Paredes exteriores largas y trabajo en altura. Rente antes de comprar.',
    'Loose paint, rust and flaking surfaces before priming.': 'Pintura suelta, óxido y superficies descascaradas antes de imprimar.', 'Mildew on exteriors and bathrooms. Always follow the label and ventilate.': 'Moho en exteriores y baños. Siga siempre la etiqueta y ventile.', 'Mixing paint evenly. A drill paddle saves time on five-gallon pails.': 'Mezclar la pintura de forma pareja. Una paleta para taladro ahorra tiempo en cubetas de cinco galones.',
    'Mixing, cleaning and hauling. Lids keep leftovers fresh.': 'Mezclar, limpiar y cargar. Las tapas conservan lo que sobra.', 'Oil-based and stain products. Synthetic brushes can go limp in them.': 'Productos de aceite y tintes. Las brochas sintéticas se pueden aflojar con ellos.', 'Oil-based paint, sprays, and sanding dust. Get fitted and replace cartridges on schedule.': 'Pintura de aceite, rociados y polvo de lijado. Hágase ajustar el respirador y cambie los cartuchos a tiempo.',
    'Overhead rolling and sanding.': 'Rodillo y lijado sobre la cabeza.', 'Protects finished floors on bigger jobs.': 'Protege los pisos terminados en trabajos grandes.', 'Quick hand sanding of walls and trim.': 'Lijado manual rápido de paredes y molduras.', 'Reach the whole house without moving the machine.': 'Alcance toda la casa sin mover la máquina.',
    'Required on many commercial sites and just smart on every job.': 'Obligatorio en muchos sitios comerciales y simplemente inteligente en cada trabajo.', 'Rot repair and nail holes in exterior wood and trim.': 'Reparación de madera podrida y agujeros de clavos en madera y molduras exteriores.', 'Safer footing on uneven ground and keeps the ladder off gutters.': 'Apoyo más seguro en terreno disparejo y mantiene la escalera lejos de los canalones.',
    'Scrape, open cans, clean rollers and push in glazing.': 'Raspar, abrir latas, limpiar rodillos y colocar masilla de vidrio.', 'Skim coats and larger patches.': 'Capas delgadas de acabado y parches grandes.', 'Small nail holes and dings. Dries fast and sands easy.': 'Agujeros pequeños de clavos y abolladuras. Seca rápido y se lija fácil.', 'Smooth walls and ceilings. Buy in multi-packs.': 'Paredes y techos lisos. Compre en paquetes múltiples.',
    'Smooth, controlled caulk lines.': 'Líneas de sellador lisas y controladas.', 'Smoothing walls and ceilings after patching.': 'Alisar paredes y techos después de parchar.', 'Textured drywall, stucco and rough surfaces.': 'Tablaroca texturizada, estuco y superficies rugosas.', 'The basic wall roller. Get a sturdy frame with a threaded handle.': 'El rodillo básico para paredes. Consiga un armazón resistente con mango roscado.',
    'Tips wear out. Keep 515, 517 and 519 sizes on hand for common latex work.': 'Las boquillas se desgastan. Tenga a la mano los tamaños 515, 517 y 519 para el trabajo común con látex.', 'Water stains, smoke and tannin bleed. Test a small area first.': 'Manchas de agua, humo y sangrado de taninos. Pruebe primero en un área pequeña.', 'Wider masking for baseboards and windows.': 'Enmascarado más ancho para zoclos y ventanas.',
    'Wiping drips. Dispose of oily rags in a metal container with water, never in a pile.': 'Limpiar goteos. Deseche los trapos aceitosos en un recipiente metálico con agua, nunca en un montón.', 'Textured drywall, stucco and rough surfaces. ': 'Tablaroca texturizada, estuco y superficies rugosas.',
  }, []);

  /* ---- Part 6: second pass (things found by walking every page in Spanish) ---- */
  pmI18n.add({
    'Company name': 'Nombre de la empresa', 'Shown on your quote page and on every document you send.': 'Se muestra en su página de cotización y en cada documento que envía.',
    '. This is your detailed rate card for written estimates and contracts.': '. Esta es su lista de precios detallada para presupuestos y contratos escritos.', 'to build estimates, contracts and invoices, and to send them out for signature.': 'para preparar presupuestos, contratos y facturas, y enviarlos para firma.',
    'then': 'luego', 'Paste the web address of your logo image (starts with https and ends in .png or .jpg). Logo upload is coming soon. Leave empty for now if you do not have one online.': 'Pegue la dirección web de la imagen de su logo (empieza con https y termina en .png o .jpg). Pronto se podrá subir el logo. Déjelo vacío por ahora si no tiene uno en línea.',
    'local standard rates': 'tarifas estándar de su zona',
    // statuses
    'draft': 'borrador', 'sent': 'enviado', 'signed': 'firmado', 'pending': 'pendiente', 'void': 'cancelado', 'paid': 'pagado', 'accepted': 'aceptado', 'expired': 'vencido', 'new': 'nuevo',
    // app summary page
    'Services: none yet': 'Servicios: ninguno todavía', 'Cities: none yet': 'Ciudades: ninguna todavía', 'Pricing set for: none yet': 'Precios configurados para: ninguno todavía', 'Warranty: 12 months labor': 'Garantía: 12 meses de mano de obra', 'Finish setup': 'Terminar configuración',
    // insurance
    'This is not insurance or legal advice, and an AI can misread a document. Your insurance company decides what is covered. Before a big job, or if you ever need to file a claim, confirm with your agent in writing.': 'Esto no es asesoría de seguros ni legal, y una IA puede leer mal un documento. Su compañía de seguros decide qué está cubierto. Antes de un trabajo grande, o si alguna vez necesita presentar un reclamo, confírmelo por escrito con su agente.',
    'Answers come from your policy text.': 'Las respuestas salen del texto de su póliza.', 'Only a little of the document could be read, so some answers may say they could not find it.': 'Solo se pudo leer una parte pequeña del documento, así que algunas respuestas pueden decir que no lo encontraron.',
    // materials
    'Essential': 'Esencial', 'Recommended': 'Recomendado', '5-in-1 painters tool': 'Herramienta 5 en 1 para pintores', 'Scrape, open cans, clean rollers and push in glazing.': 'Raspar, abrir latas, limpiar rodillos y colocar masilla de vidrio.',
    // jobs
    'Ask any painting or business question': 'Haga cualquier pregunta de pintura o de negocio', 'Ask about this job, or any painting question': 'Pregunte sobre este trabajo o cualquier pregunta de pintura', 'Build it': 'Crear', 'Build invoice': 'Crear factura', 'Rebuild (replaces edits)': 'Recrear (reemplaza los cambios)',
    'Day-by-day plan. Pick the start date and the days fill in (Sundays skipped). You can email it to the customer.': 'Plan día por día. Elija la fecha de inicio y los días se llenan solos (se omiten los domingos). Puede enviarlo por correo al cliente.',
    'Done.': 'Listo.', 'Saved': 'Guardado', 'Open': 'Abrir', 'Edit': 'Editar', 'Delete': 'Borrar', 'Add': 'Agregar', 'Yes': 'Sí', 'No': 'No',
  }, [
    [/^(\d+)\. (.+)$/, function (a, n, r) { var t = x(r); return t === r ? null : n + '. ' + t; }],
    [/^I have (.+)$/, function (a, r) { return 'Tengo ' + x(r); }],
    [/^\(?(\d+) of (\d+) owned\)?$/, function (a, n, m) { return /^\(/.test(a) ? '(' + n + ' de ' + m + ' que ya tengo)' : n + ' de ' + m + ' que ya tengo'; }],
    [/^File: (.+)$/, function (a, f) { return 'Archivo: ' + f; }],
    [/^(Costs|Subtotal|Total|Tax|Deposit|Discount|Minimum job adjustment) (-?\$[\d,.]+)$/, function (a, w, m) { return { Costs: 'Costos', Subtotal: 'Subtotal', Total: 'Total', Tax: 'Impuesto', Deposit: 'Depósito', Discount: 'Descuento', 'Minimum job adjustment': 'Ajuste por trabajo mínimo' }[w] + ' ' + m; }],
    [/^(\$[\d,.]+) to (\$[\d,.]+) per sq ft$/, function (a, lo, hi) { return lo + ' a ' + hi + ' por pie cuadrado'; }],
    [/^Your color: (#[0-9A-Fa-f]{3,8})$/, function (a, c) { return 'Su color: ' + c; }],
    [/^Labor: crew of (.+), (.+)\/hr, deposit (.+)$/, function (a, c, h, d) { return 'Mano de obra: equipo de ' + c + ', ' + h + '/h, depósito ' + d; }],
    [/^Services: (.+)$/, function (a, s) { return 'Servicios: ' + s.split(', ').map(x).join(', '); }],
    [/^Your plan \((.+)\) includes up to$/, function (a, p) { return 'Su plan (' + p + ') incluye hasta'; }],
    [/^(.+) \(builder rates\)$/, function (a, r) { var t = x(r); return t === r ? null : t + ' (tarifas para constructores)'; }],
    [/^Cities: (.+)$/, function (a, s) { return 'Ciudades: ' + s; }],
    [/^Pricing set for: (.+)$/, function (a, s) { return 'Precios configurados para: ' + s; }],
    [/^Warranty: (\d+) months labor$/, function (a, n) { return 'Garantía: ' + n + ' meses de mano de obra'; }],
    [/^(.+) Leave both empty to use local standard rates\.$/, function (a, r) { return x(r) + ' Deje ambos vacíos para usar las tarifas estándar de su zona.'; }],
  ]);

  /* ---- Part 7: insurance protection features (proof to customers, claim help, nudges) ---- */
  pmI18n.add({
    'Insurance guide': 'Guía de seguros', 'Insurance guide →': 'Guía de seguros →', 'Read the insurance guide': 'Lea la guía de seguros', 'Read the insurance guide.': 'Lea la guía de seguros.', 'Preview': 'Vista previa',
    'No insurance yet?': '¿Todavía no tiene seguro?', 'Customers often ask for proof before they hire, so you may win more jobs with coverage.': 'Los clientes suelen pedir un comprobante antes de contratar, así que con cobertura puede ganar más trabajos.',
    'Protect this job': 'Proteja este trabajo', 'before, during and after the work': 'antes, durante y después del trabajo', 'Email my proof of insurance to the customer': 'Enviar mi comprobante de seguro al cliente por correo',
    'Something happened? Get claim help': '¿Pasó algo? Pida ayuda con el reclamo',
    'To email proof of insurance, add your policy and turn on your customer link on the Insurance page, and make sure this customer has an email address.': 'Para enviar el comprobante de seguro, agregue su póliza y active su enlace para clientes en la página de Seguro, y confirme que este cliente tenga un correo electrónico.',
    'If something goes wrong': 'Si algo sale mal', 'If anyone is hurt, call 911 first.': 'Si alguien está lesionado, llame primero al 911.', 'Make the area safe and stop work near the problem.': 'Haga seguro el área y pare el trabajo cerca del problema.',
    'Take photos and video of everything before anything is moved or cleaned up.': 'Tome fotos y video de todo antes de mover o limpiar algo.', 'Write down the name and phone number of everyone involved and any witnesses.': 'Anote el nombre y teléfono de todos los involucrados y de los testigos.',
    'Do not admit fault, promise to pay or sign anything. Say you will report it to your insurance.': 'No admita culpa, no prometa pagar ni firme nada. Diga que lo va a reportar a su seguro.', 'Call your insurance agent or carrier as soon as you can. Many policies require quick notice.': 'Llame a su agente o aseguradora lo antes posible. Muchas pólizas exigen aviso rápido.',
    'Keep every receipt, message and quote. Do not throw away damaged items.': 'Guarde todos los recibos, mensajes y cotizaciones. No tire los objetos dañados.',
    'Date it happened': 'Fecha en que ocurrió', 'Was anyone hurt?': '¿Alguien resultó lesionado?', 'What happened?': '¿Qué pasó?', "Damage to the customer's property?": '¿Daños a la propiedad del cliente?', 'Others involved or witnesses': 'Otras personas involucradas o testigos',
    "Example: A ladder slipped and scratched the customer's car in the driveway.": 'Ejemplo: Una escalera se resbaló y rayó el carro del cliente en la entrada.', 'Example: Scratch on the driver side door. Photos taken.': 'Ejemplo: Rayón en la puerta del conductor. Ya tomé fotos.', 'Example: Crew member Luis, neighbor next door.': 'Ejemplo: El ayudante Luis y el vecino de al lado.',
    'Save to job history and build my claim sheet': 'Guardar en el historial del trabajo y preparar mi hoja de reclamo', 'Claim information sheet (copy it into an email to your agent)': 'Hoja de información del reclamo (cópiela en un correo a su agente)', 'Copy': 'Copiar',
    'General information only, not legal or insurance advice. Your insurance company decides what is covered.': 'Solo información general, no asesoría legal ni de seguros. Su compañía de seguros decide qué está cubierto.',
    'Proof of insurance emailed to the customer.': 'Comprobante de seguro enviado por correo al cliente.', 'Describe what happened first.': 'Primero describa qué pasó.', 'Saved to the job history. Your claim sheet is ready below. Call or email your insurance agent now.': 'Guardado en el historial del trabajo. Su hoja de reclamo está lista abajo. Llame o escriba a su agente de seguros ahora.',
    'Copied.': 'Copiado.', 'Press Ctrl+C or Command+C to copy.': 'Presione Ctrl+C o Comando+C para copiar.',
    'Show that I am insured on my estimates and my quote page': 'Mostrar que tengo seguro en mis presupuestos y en mi página de cotización',
    'Customers see "Insured" and a link to your proof page, which can help you win more jobs.': 'Los clientes ven "Asegurado" y un enlace a su página de comprobante, lo que puede ayudarle a ganar más trabajos.', 'It only shows while your customer link is on and your policy has not expired.': 'Solo se muestra mientras su enlace para clientes esté activado y su póliza no haya vencido.',
    'Leave it off if you do not have coverage.': 'Déjelo apagado si no tiene cobertura.', 'On any job you can also email your proof to the customer before you start.': 'En cualquier trabajo también puede enviar su comprobante por correo al cliente antes de empezar.',
    'Customers will see that you are insured.': 'Los clientes verán que usted tiene seguro.', 'Your coverage is hidden from customers.': 'Su cobertura está oculta para los clientes.', 'Sharing is on. Turn it off and on again to get a link you can also email from a job.': 'Compartir está activado. Apáguelo y vuélvalo a encender para obtener un enlace que también puede enviar por correo desde un trabajo.',
    'Turn on your customer link on the Insurance page first. It is also off when your policy has expired.': 'Primero active su enlace para clientes en la página de Seguro. También se apaga cuando su póliza vence.',
    'Email is not set up yet, so nothing was sent. Copy your link from the Insurance page and send it yourself.': 'El correo todavía no está configurado, así que no se envió nada. Copie su enlace de la página de Seguro y envíelo usted.',
    'This customer has no email address.': 'Este cliente no tiene correo electrónico.', 'Job not found.': 'Trabajo no encontrado.',
    'No insurance policy on file. Add yours so PaintersMax can tell you if each job is covered. If you do not have coverage yet, the Insurance guide explains how it helps you win jobs and how to get it.': 'No hay una póliza de seguro registrada. Agregue la suya para que PaintersMax le diga si cada trabajo está cubierto. Si todavía no tiene cobertura, la Guía de seguros explica cómo le ayuda a ganar trabajos y cómo conseguirla.',
    'Billing': 'Facturación', 'Plan and billing': 'Plan y facturación', "Update your card, see invoices or cancel on Stripe's secure page.": 'Actualice su tarjeta, vea facturas o cancele en la página segura de Stripe.', 'Manage my plan and card': 'Administrar mi plan y tarjeta', 'Billing is not available yet.': 'La facturación todavía no está disponible.',
    'Your last PaintersMax payment did not go through. Update your card so your plan stays active.': 'Su último pago de PaintersMax no se procesó. Actualice su tarjeta para que su plan siga activo.',
  }, [
    [/^(\d+) open jobs? may not be covered by your policy\. Check the insurance note on each job before you bid or start\.$/, function (a, n) { return n + (n === '1' ? ' trabajo abierto puede no estar cubierto' : ' trabajos abiertos pueden no estar cubiertos') + ' por su póliza. Revise la nota de seguro de cada trabajo antes de hacer la oferta o empezar.'; }],
    [/^Sent proof of insurance to (.+)\.$/, function (a, e) { return 'Comprobante de seguro enviado a ' + e + '.'; }],
    [/^Incident report \((.+?)\): ([\s\S]+)$/, function (a, d, r) { return 'Reporte de incidente (' + d + '): ' + r; }],
  ]);

  /* ---- Part 8: CSV customer import ---- */
  pmI18n.add({
    'Import customers': 'Importar clientes', 'Import customers from a spreadsheet': 'Importar clientes desde una hoja de cálculo',
    'Save your old customer list as a': 'Guarde su lista de clientes como un archivo', 'Reading your file...': 'Leyendo su archivo...',
    'customers ready to import': 'clientes listos para importar', 'already here or repeated': 'ya existen o están repetidos', 'skipped': 'omitidos', 'Row': 'Fila',
    'No name': 'Sin nombre', 'Email looks wrong': 'El correo parece incorrecto', 'Phone looks wrong': 'El teléfono parece incorrecto',
    'Showing the first 8.': 'Se muestran los primeros 8.', 'Import': 'Importar', 'customers': 'clientes', 'Imported': 'Importados', 'Go to Jobs': 'Ir a Trabajos', 'Importing...': 'Importando...', 'saved so far': 'guardados hasta ahora',
    'That file is too large (1 MB limit).': 'Ese archivo es demasiado grande (límite de 1 MB).',
    'The file needs a header row and at least one customer.': 'El archivo necesita una fila de encabezados y al menos un cliente.',
    'Check before you send': 'Revise antes de enviar', 'No problems found. Review the amounts, then save and send.': 'No se encontraron problemas. Revise los montos, luego guarde y envíe.',
    'Job complete: build invoice': 'Trabajo terminado: crear factura',
    'The estimate has not been signed by the customer.': 'El cliente no ha firmado el presupuesto.',
    'This customer has no email address, so you can only print the invoice.': 'Este cliente no tiene correo electrónico, así que solo puede imprimir la factura.',
    'No punch list was saved. A completed punch list helps if the customer questions the work.': 'No se guardó una lista de pendientes. Una lista terminada ayuda si el cliente cuestiona el trabajo.',
    'The estimate total is zero.': 'El total del presupuesto es cero.', 'The amount already paid is more than the total.': 'El monto ya pagado es mayor que el total.', 'The balance due is zero or less.': 'El saldo pendiente es cero o menos.',
    'Write a thank-you note': 'Escribir una nota de agradecimiento', 'The note never includes amounts. You can edit it before you save.': 'La nota nunca incluye montos. Puede editarla antes de guardar.', 'Note added. Review it, then save.': 'Nota agregada. Revísela y luego guarde.',
    'The writing helper is paused right now. Try again soon.': 'El asistente de redacción está en pausa. Intente de nuevo pronto.', 'The invoice writing helper is not included in your plan.': 'El asistente de redacción de facturas no está incluido en su plan.', "You have used this month's invoice notes. Upgrade your plan for more.": 'Ya usó las notas de factura de este mes. Mejore su plan para obtener más.', 'The writing helper could not answer. Write your own note or try again.': 'El asistente no pudo responder. Escriba su propia nota o intente de nuevo.',
    'Email the customer a friendly reminder if this is still unpaid after 7 and 14 days': 'Enviar al cliente un recordatorio amable si sigue sin pagar a los 7 y 14 días', 'The reminder names the invoice but never states an amount. It stops when you mark the invoice paid.': 'El recordatorio menciona la factura pero nunca indica un monto. Se detiene cuando marca la factura como pagada.',
    'Customer portal': 'Portal del cliente', 'One private link where your customer sees what you have sent them: estimate, contract, signature status, schedule, invoice and proof of insurance. Drafts are never shown.': 'Un enlace privado donde su cliente ve lo que usted le ha enviado: presupuesto, contrato, estado de la firma, calendario, factura y comprobante de seguro. Los borradores nunca se muestran.',
    'Show link': 'Mostrar enlace', 'Email link to customer': 'Enviar enlace al cliente', 'Make a new link': 'Crear un enlace nuevo', 'Making a new link turns the old one off.': 'Crear un enlace nuevo desactiva el anterior.', 'Open the customer view': 'Abrir la vista del cliente', 'The old link will stop working. Continue?': 'El enlace anterior dejará de funcionar. ¿Continuar?', 'Link emailed to the customer.': 'Enlace enviado al cliente.',
    'Email is not set up yet, so nothing was sent. Copy the link and send it yourself.': 'El correo todavía no está configurado, así que no se envió nada. Copie el enlace y envíelo usted.',
    'Calendar': 'Calendario', 'Calendar and crew schedule': 'Calendario y horario del equipo', 'Needs a date': 'Necesita fecha', 'Jobs with a contract or already scheduled, but no dates yet.': 'Trabajos con contrato o ya programados, pero sin fechas todavía.', 'Nothing waiting.': 'Nada pendiente.',
    'Set dates': 'Poner fechas', 'Start date': 'Fecha de inicio', 'End date': 'Fecha de fin', 'Start time': 'Hora de inicio', 'Crew (names, separated by commas)': 'Equipo (nombres, separados por comas)', 'Notes for the crew': 'Notas para el equipo',
    'Save': 'Guardar', 'Saved.': 'Guardado.', 'Remove from calendar': 'Quitar del calendario', 'Open the job': 'Abrir el trabajo', 'Remove this job from the calendar?': '¿Quitar este trabajo del calendario?', 'is also booked on': 'también está asignado a', 'Saved, but check this:': 'Guardado, pero revise esto:', 'Today': 'Hoy',
    'Sun': 'Dom', 'Mon': 'Lun', 'Tue': 'Mar', 'Wed': 'Mié', 'Thu': 'Jue', 'Fri': 'Vie', 'Sat': 'Sáb',
    'Pick a valid start date.': 'Elija una fecha de inicio válida.', 'Pick a valid end date.': 'Elija una fecha de fin válida.', 'The end date cannot be before the start date.': 'La fecha de fin no puede ser anterior a la de inicio.', 'A job block can be at most 120 days.': 'Un trabajo puede durar como máximo 120 días.',
    'Crew contacts': 'Contactos del equipo', 'Save crew contacts': 'Guardar contactos del equipo', 'Crew contacts saved.': 'Contactos del equipo guardados.', 'Email the crew this schedule': 'Enviar este horario al equipo por correo', 'Emailed:': 'Enviado a:', 'No email on file for:': 'Sin correo registrado para:', 'Could not email:': 'No se pudo enviar a:',
    'Google Calendar feed': 'Calendario para Google Calendar', 'Copy link': 'Copiar enlace', 'New link ready. Add it to your calendar again.': 'Enlace nuevo listo. Agréguelo de nuevo a su calendario.',
    'Name': 'Nombre', 'Email': 'Correo', 'Phone': 'Teléfono', 'Address': 'Dirección',
  });

  /* ---- Part 9: setup flow redesign ---- */
  pmI18n.add({
    'Your company info': 'Datos de su empresa', 'Services you offer': 'Servicios que ofrece', 'Cities you serve': 'Ciudades que atiende', 'Your prices': 'Sus precios', 'Labor and money': 'Mano de obra y dinero', 'Warranty and insurance': 'Garantía y seguro', 'Review': 'Revisión',
    'Save and go to dashboard': 'Guardar e ir al panel', 'What services do you offer?': '¿Qué servicios ofrece?',
    'Choose the work you do.': 'Elija el trabajo que hace.', 'Services': 'Servicios',
    'Pick your services first.': 'Primero elija sus servicios.', 'Choose services': 'Elegir servicios',
    'Cities you serve (separate with commas)': 'Ciudades que atiende (separadas por comas)',
    'Here is what we saved. Tap Edit to change any part. You can come back to any step later.': 'Esto es lo que guardamos. Toque Editar para cambiar cualquier parte. Puede volver a cualquier paso después.',
    'Edit': 'Editar', 'You are set up.': 'Todo listo.', 'Your business profile is saved. Opening your dashboard...': 'Su perfil de negocio está guardado. Abriendo su panel...',
    'What happens next': 'Qué sigue',
    'When you finish, you go to your dashboard. Your prices fill in your estimates, and you can build your first job from Jobs.': 'Al terminar, va a su panel. Sus precios llenan sus presupuestos y puede crear su primer trabajo desde Trabajos.',
    'Do not remind me': 'No me lo recuerde', 'Setup': 'Configuración',
    'Finish setting up your estimating prices so estimates fill in for you. It takes a few minutes and you can stop any time.': 'Termine de configurar sus precios para que los presupuestos se llenen solos. Toma unos minutos y puede parar cuando quiera.',
  }, [
    [/^(\d+) of (\d+) steps done\. Tap any step to jump to it\. Everything saves when you move\.$/, function (a, n, t) { return n + ' de ' + t + ' pasos listos. Toque cualquier paso para ir a él. Todo se guarda al moverse.'; }],
    [/^Your plan \((\w+)\) includes up to (\d+) services\. You can change this any time\.$/, function (a, pl, n) { return 'Su plan (' + pl + ') incluye hasta ' + n + ' servicios. Puede cambiarlo cuando quiera.'; }],
    [/^Your plan \((\w+)\) includes up to (\d+) cities\. These show on your quote page and help us set rates for your market\.$/, function (a, pl, n) { return 'Su plan (' + pl + ') incluye hasta ' + n + ' ciudades. Se muestran en su página de cotización y nos ayudan a fijar precios para su mercado.'; }],
  ]);

  /* ---- Part 10: rate card redesign ---- */
  pmI18n.add({
    'Your prices': 'Sus precios', 'Your market': 'Su mercado',
    'Your rate card is your price list. We fill in starting rates for you, so you can keep them or change any number. PaintersMax uses them for every estimate, and you can adjust any job.': 'Su tarifario es su lista de precios. Llenamos tarifas iniciales por usted: puede conservarlas o cambiar cualquier número. PaintersMax las usa en cada presupuesto y puede ajustar cada trabajo.',
    'Prices follow what customers in your area pay. Pick the one that sounds most like where you work. You can change it any time.': 'Los precios siguen lo que pagan los clientes en su zona. Elija la que más se parezca a donde trabaja. Puede cambiarla cuando quiera.',
    'High-cost market': 'Mercado de costo alto', 'Average market': 'Mercado promedio', 'Lower-cost or rural market': 'Mercado de costo bajo o rural',
    'Large metro areas and places where homes, labor and living costs are high.': 'Áreas metropolitanas grandes y lugares donde las casas, la mano de obra y el costo de vida son altos.',
    'Mid-size cities and suburbs where costs are typical.': 'Ciudades medianas y suburbios con costos típicos.',
    'Small towns and rural areas where customers expect lower prices.': 'Pueblos pequeños y zonas rurales donde los clientes esperan precios más bajos.',
    'Starting rates are PaintersMax benchmark ranges, not guarantees. Adjust them to your own costs and quality of work.': 'Las tarifas iniciales son rangos de referencia de PaintersMax, no garantías. Ajústelas a sus costos y a la calidad de su trabajo.',
    'Where do you want to price? Standard is already filled in for you.': '¿Dónde quiere fijar sus precios? Estándar ya está llenado por usted.',
    'Value': 'Económico', 'Standard': 'Estándar', 'Premium': 'Premium',
    'Win jobs on price. A fit if you are building reviews, or your area is price-sensitive.': 'Gane trabajos por precio. Sirve si está formando reseñas o si su zona es sensible al precio.',
    'A fair rate for a solid local painter. Most painters start here.': 'Una tarifa justa para un pintor local sólido. La mayoría empieza aquí.',
    'For a higher-end finish, careful prep, a tidy crew and strong reviews.': 'Para un acabado superior, preparación cuidadosa, equipo ordenado y buenas reseñas.',
    'How this rate is built': 'Cómo se arma esta tarifa',
    'More information: how to set your prices': 'Más información: cómo fijar sus precios',
    'Switch to the new price list with starting rates': 'Cambiar a la nueva lista de precios con tarifas iniciales',
    'Your rate card': 'Su tarifario', 'Download a branded copy of your rates to share with customers or builders.': 'Descargue una copia de sus tarifas con su marca para compartir con clientes o constructores.',
    'Download my rate card (PDF)': 'Descargar mi tarifario (PDF)', 'Uses your logo from Settings. Prices are saved when you tap Download.': 'Usa su logotipo de Configuración. Los precios se guardan al tocar Descargar.',
    'Add "Prepared with PaintersMax" at the bottom': 'Agregar "Preparado con PaintersMax" al pie',
    'Close': 'Cerrar', 'not offered': 'no ofrecido',
    'How to choose your prices': 'Cómo elegir sus precios', 'What a rate card is': 'Qué es un tarifario', 'Pick your level': 'Elija su nivel', 'What goes into a price': 'Qué incluye un precio', 'Not sure? Keep Standard.': '¿No está seguro? Deje Estándar.',
    'A painter rate card is a standardized pricing reference used by painting contractors to calculate consistent, repeatable estimates or present transparent service tiers. It breaks down labor, production speeds, materials, and standard unit pricing.': 'Un tarifario de pintor es una referencia de precios estandarizada que usan los contratistas de pintura para calcular presupuestos consistentes y repetibles o presentar niveles de servicio transparentes. Desglosa la mano de obra, las velocidades de producción, los materiales y los precios unitarios estándar.',
    'Prices follow what customers in your area pay. A large coastal city usually costs more than a small town. We start you from the market you choose, and you can change any number.': 'Los precios siguen lo que pagan los clientes en su zona. Una ciudad grande de la costa suele costar más que un pueblo pequeño. Empezamos con el mercado que elija y puede cambiar cualquier número.',
    'Then watch your first few estimates. If nearly everyone says yes, you may be too low. If very few do, check whether you are too high. You can change any number at any time.': 'Luego observe sus primeros presupuestos. Si casi todos dicen que sí, quizá esté muy bajo. Si muy pocos aceptan, revise si está muy alto. Puede cambiar cualquier número en cualquier momento.',
    'These starting ranges come from the PaintersMax rate card guide. They are a starting point, not market data or a guarantee.': 'Estos rangos iniciales vienen de la guía de tarifarios de PaintersMax. Son un punto de partida, no datos de mercado ni una garantía.',
    'Value:': 'Económico:', 'Standard:': 'Estándar:', 'Premium:': 'Premium:',
    ' you are newer to the trade, still building reviews, or your area is very price-sensitive.': ' es nuevo en el oficio, todavía forma reseñas, o su zona es muy sensible al precio.',
    ' you are an established painter with steady work and good reviews. Most painters start here.': ' es un pintor establecido con trabajo constante y buenas reseñas. La mayoría empieza aquí.',
    ' you are known for a high-quality finish, careful prep, a tidy crew and reliable scheduling, usually in a higher-cost area.': ' es conocido por un acabado de alta calidad, preparación cuidadosa, equipo ordenado y calendario confiable, normalmente en una zona de costo alto.',
    'Loaded labor rate:': 'Tarifa de mano de obra completa:', 'Production rates:': 'Tasas de producción:', 'Materials and waste:': 'Materiales y desperdicio:', 'Overhead and markup:': 'Gastos generales y margen:',
    ' what an hour of labor really costs you, including taxes, insurance and benefits.': ' lo que realmente le cuesta una hora de trabajo, con impuestos, seguro y prestaciones.',
    ' what an hour of labor really costs you with taxes, insurance and benefits.': ' lo que realmente le cuesta una hora de trabajo con impuestos, seguro y prestaciones.',
    ' how much a crew finishes per hour, such as square feet or doors.': ' cuánto termina un equipo por hora, como pies cuadrados o puertas.',
    ' how much a crew finishes per hour.': ' cuánto termina un equipo por hora.',
    ' paint, primer and supplies, plus a little extra for waste.': ' pintura, imprimador y suministros, más un poco extra por desperdicio.',
    ' paint, primer and supplies, plus waste.': ' pintura, imprimador y suministros, más desperdicio.',
    ' your truck, tools, insurance and office time, plus profit.': ' su camión, herramientas, seguro y tiempo de oficina, más ganancia.',
    ' truck, tools, insurance, office time and profit.': ' camión, herramientas, seguro, tiempo de oficina y ganancia.',
    'This is below the usual range for your market. Is that on purpose?': 'Esto está por debajo del rango habitual de su mercado. ¿Es a propósito?',
    'This is above the usual range for your market. Is that on purpose?': 'Esto está por encima del rango habitual de su mercado. ¿Es a propósito?',
    'Example only:': 'Solo un ejemplo:',
    'Typical range for your market:': 'Rango típico para su mercado:',
    'Interior painting': 'Pintura interior', 'Exterior painting': 'Pintura exterior', 'Cabinet painting': 'Pintura de gabinetes', 'Power washing': 'Lavado a presión', 'Epoxy floors': 'Pisos epóxicos', 'Builder rates': 'Tarifas para constructores',
    'Decks and fence staining': 'Teñido de terrazas y cercas',
    'Repainting rooms, walls, ceilings, trim and doors inside homes. Pick the items you do and set a price for each.': 'Repintar cuartos, paredes, techos, molduras y puertas dentro de casas. Elija lo que hace y ponga un precio a cada uno.',
    'Painting house exteriors: siding, stucco, brick, trim, doors and garage doors, plus the prep that goes with them.': 'Pintura de exteriores: revestimiento, estuco, ladrillo, molduras, puertas y puertas de garaje, más la preparación que requieren.',
    'Pressure and soft washing for houses, concrete, decks, roofs and commercial areas.': 'Lavado a presión y lavado suave de casas, concreto, terrazas, techos y áreas comerciales.',
    'Spraying or brushing kitchen and bath cabinets, priced by the door, drawer, panel or linear foot.': 'Pintura con pistola o brocha de gabinetes de cocina y baño, con precio por puerta, cajón, panel o pie lineal.',
    'Staining and sealing decks, fences, pergolas, pavilions, gazebos and concrete patios.': 'Teñido y sellado de terrazas, cercas, pérgolas, pabellones, cenadores y patios de concreto.',
    'Garage, basement and commercial floor coatings: epoxy, flake, metallic and polyaspartic systems with their prep.': 'Recubrimientos de pisos de garaje, sótano y comerciales: sistemas epóxicos, de hojuelas, metálicos y de poliaspártico con su preparación.',
    'Painting commercial buildings such as warehouses, retail centers and apartments. Most contractors need insurance to bid commercial work, and commercial bids are on the Basic (one free try) and Pro plans.': 'Pintura de edificios comerciales como bodegas, centros comerciales y apartamentos. La mayoría de los contratistas necesita seguro para ofertar trabajo comercial, y las ofertas comerciales están en los planes Basic (una prueba gratis) y Pro.',
  });

  /* ---- Part 11: builder rate sheets ---- */
  pmI18n.add({
    'Builder rate sheets': 'Hojas de tarifas para constructores', 'Builder rates': 'Tarifas para constructores',
    'Give each home builder their own rate sheet. Every sheet starts from your builder rates and can have its own discount, its own prices, fewer or more details, and its own private link. Builders only see what you put on their sheet.': 'Dé a cada constructor su propia hoja de tarifas. Cada hoja parte de sus tarifas para constructores y puede tener su propio descuento, sus propios precios, más o menos detalles y su propio enlace privado. Los constructores solo ven lo que usted ponga en su hoja.',
    'Share your builder rates': 'Comparta sus tarifas para constructores', 'Open builder rate sheets': 'Abrir hojas de tarifas para constructores',
    'Builder or company name': 'Nombre del constructor o empresa', 'How much detail does this builder want?': '¿Cuánto detalle quiere este constructor?',
    'Summary: prices only': 'Resumen: solo precios', 'Standard: prices and units': 'Estándar: precios y unidades', 'Detailed: adds scope notes, terms, insurance and warranty': 'Detallado: agrega notas de alcance, términos, seguro y garantía',
    'Discount or increase for this builder (%)': 'Descuento o aumento para este constructor (%)', 'Prices valid for (days)': 'Precios válidos por (días)',
    'Note at the top (optional)': 'Nota al inicio (opcional)', 'Also show': 'Mostrar también',
    'Terms for this builder (payment schedule, change orders, schedule)': 'Términos para este constructor (calendario de pagos, órdenes de cambio, calendario)',
    'Change or hide individual lines': 'Cambiar u ocultar líneas individuales', 'Create sheet': 'Crear hoja', 'Save changes': 'Guardar cambios', 'Open PDF': 'Abrir PDF', 'Preview': 'Vista previa', 'Make a new link': 'Crear un enlace nuevo', 'Delete': 'Eliminar', 'New builder sheet': 'Nueva hoja para constructor',
    'My labor warranty': 'Mi garantía de mano de obra',
    'Builder rate sheets are on the Basic and Pro plans.': 'Las hojas de tarifas para constructores están en los planes Basic y Pro.',
    'Set your builder rates first.': 'Primero fije sus tarifas para constructores.',
  });

  /* ---- Part 12: commercial trial ---- */
  pmI18n.add({
    'Commercial bids are on the Basic and Pro plans.': 'Las ofertas comerciales están en los planes Basic y Pro.',
    'Try your first commercial bid on us.': 'Pruebe su primera oferta comercial por nuestra cuenta.',
    'You have used your free commercial bid.': 'Ya usó su oferta comercial gratis.',
    'Pro includes unlimited commercial bids.': 'Pro incluye ofertas comerciales ilimitadas.',
    'Most contractors also need insurance to bid commercial work.': 'La mayoría de los contratistas también necesita seguro para ofertar trabajo comercial.',
    'See plans': 'Ver planes',
  });

  pmI18n.add({
    'Start with your company name. It appears on every estimate and contract.': 'Empiece con el nombre de su empresa. Aparece en cada presupuesto y contrato.',
    'Add a phone and email. Customers reply to them and they show in your customer portal.': 'Agregue un teléfono y un correo. Los clientes responden ahí y aparecen en su portal de clientes.',
    'Add a phone number so customers can reach you quickly from an estimate.': 'Agregue un teléfono para que los clientes puedan llamarle rápido desde un presupuesto.',
    'Add an email. Customer replies to estimates go here.': 'Agregue un correo. Las respuestas de los clientes a los presupuestos llegan aquí.',
    'Looks good. You only type this once and we use it everywhere.': 'Se ve bien. Solo lo escribe una vez y lo usamos en todas partes.',
    'Choose the work you do. You can change this any time.': 'Elija el trabajo que hace. Puede cambiarlo en cualquier momento.',
    'Exterior jobs usually start with washing the surface, so power washing is a natural one to add.': 'Los trabajos exteriores suelen empezar lavando la superficie, así que lavado a presión es una opción natural.',
    'Each service gets its own price list on the Your prices step.': 'Cada servicio tiene su propia lista de precios en el paso Sus precios.',
    'Pick the cities you work in. Each one can get its own page on your website.': 'Elija las ciudades donde trabaja. Cada una puede tener su propia página en su sitio web.',
    'Pick Value, Standard or Premium above to fill in starting prices. You can change every number.': 'Elija Valor, Estándar o Premium arriba para llenar precios iniciales. Puede cambiar cada número.',
    'Every item has a price. Check the example under each list to see what a real job comes to.': 'Cada artículo tiene precio. Vea el ejemplo bajo cada lista para saber cuánto cuesta un trabajo real.',
    'Use your loaded rate: wages plus taxes, insurance and benefits, not just what you pay the painter.': 'Use su tarifa completa: sueldo más impuestos, seguro y beneficios, no solo lo que le paga al pintor.',
    'Your hourly rate and deposit help the assistant and your estimates. You can edit any estimate before it goes out.': 'Su tarifa por hora y su depósito ayudan al asistente y a sus presupuestos. Puede editar cualquier presupuesto antes de enviarlo.',
    'Good. Every number here can still be changed on a single job.': 'Bien. Cada número aquí se puede cambiar en un trabajo individual.',
    'Insurance is optional here, but customers and builders often ask for proof. You can add it later on the Insurance page.': 'El seguro es opcional aquí, pero los clientes y constructores suelen pedir comprobante. Puede agregarlo después en la página Seguro.',
    'Good. Upload the policy on the Insurance page so we can check whether each job looks covered.': 'Bien. Suba la póliza en la página Seguro para revisar si cada trabajo parece cubierto.',
    'Last look. You can come back to any step later.': 'Última revisión. Puede volver a cualquier paso después.',
    'Not now': 'Ahora no',
  });

  pmI18n.add({
    'Detailed step-by-step': 'Detallado, paso a paso',
    'Only you can see this chat.': 'Solo usted puede ver este chat.',
    'Clear this chat': 'Borrar este chat',
    'Did you lose this job?': '¿Perdió este trabajo?',
    'Why?': '¿Por qué?',
    'Choose a reason': 'Elija un motivo',
    'Price': 'Precio',
    'Timing': 'Tiempo',
    'No reply': 'Sin respuesta',
    'Chose someone else': 'Eligió a otro',
    'Other': 'Otro',
    'Mark as lost': 'Marcar como perdido',
    'Lost lead': 'Cliente perdido',
    'Reopen this job': 'Reabrir este trabajo',
    'The job stays in your records. You can reopen it later.': 'El trabajo queda en sus registros. Puede reabrirlo después.',
    'Lost jobs stay in your records so you can see why you did not win them.': 'Los trabajos perdidos quedan en sus registros para que vea por qué no los ganó.',
    'Example: They went with a cheaper bid': 'Ejemplo: Eligieron una oferta más barata',
  });

  pmI18n.add({
    'What your estimate will look like': 'Cómo se verá su presupuesto',
    'A sample job priced with the prices you just saved. The job and sizes are made up for this preview. Nothing is sent to anyone.': 'Un trabajo de ejemplo con los precios que acaba de guardar. El trabajo y las medidas son inventados para esta vista previa. No se envía nada a nadie.',
    'Your estimate preview': 'Vista previa de su presupuesto',
    'Save your prices on the Your prices step and a sample estimate shows up here.': 'Guarde sus precios en el paso Sus precios y aquí aparecerá un presupuesto de ejemplo.',
    'Minimum job adjustment': 'Ajuste por trabajo mínimo',
    'Deposit to schedule': 'Depósito para programar',
  });

  pmI18n.add({
    'City pages': 'Páginas de ciudades',
    'Each city gets its own page on your website. After you finish setup, write them on': 'Cada ciudad tiene su propia página en su sitio web. Al terminar la configuración, escríbalas en',
    'Add a city': 'Agregar una ciudad',
    'Add a city or ZIP code': 'Agregar una ciudad o código postal',
    'Add': 'Agregar',
    'Pro: you can pick cities by ZIP code.': 'Pro: puede elegir ciudades por código postal.',
    'ZIP code selection is on the Pro plan.': 'La selección por código postal está en el plan Pro.',
    'No nearby cities found yet. Add your company address first, or type a city above.': 'Aún no hay ciudades cercanas. Agregue primero la dirección de su empresa, o escriba una ciudad arriba.',
  });

  pmI18n.add({}, [
    [/^(\d+) of (\d+) cities chosen$/, function (a, n, m) { return n + ' de ' + m + ' ciudades elegidas'; }],
    [/^Up to (\d+) miles from your address\.$/, function (a, n) { return 'Hasta ' + n + ' millas de su dirección.'; }],
  ]);

  pmI18n.add({}, [
    [/^Your free trial has (\d+) days? left\. You have extra AI use until it ends\. Choose a plan to keep it\.$/, function (a, n) { return 'Su prueba gratis tiene ' + n + (n === '1' ? ' día' : ' días') + ' restantes. Tiene más uso de IA hasta que termine. Elija un plan para conservarlo.'; }],
  ]);

  pmI18n.add({
    'Work orders and change orders': 'Órdenes de trabajo y de cambio',
    'New work order': 'Nueva orden de trabajo', 'New change order': 'Nueva orden de cambio',
    'Email to customer': 'Enviar por correo al cliente', 'Get link': 'Obtener enlace', 'Copy link': 'Copiar enlace', 'Email again': 'Enviar de nuevo',
    'Edit': 'Editar', 'View': 'Ver', 'Print': 'Imprimir', 'Close': 'Cerrar', 'Save': 'Guardar',
    'Title': 'Título', 'Why is this needed?': '¿Por qué es necesario?', 'What will be done': 'Qué se hará', 'Extra days': 'Días adicionales',
    '+ Add a line': '+ Agregar una línea', 'Customer language': 'Idioma del cliente', 'Price each ($)': 'Precio c/u ($)',
    'None yet.': 'Todavía ninguna.',
    'A change order is for extra work after the estimate was approved. Your customer approves it on a private page, or you can print it. Approved change orders add to the job total.': 'Una orden de cambio es para trabajo extra después de aprobar el presupuesto. Su cliente la aprueba en una página privada, o puede imprimirla. Las órdenes de cambio aprobadas se suman al total del trabajo.',
  });

  pmI18n.add({
    'Expenses, mileage and records': 'Gastos, millas y registros', 'Records for your accountant, not tax advice. Download them any time.': 'Registros para su contador, no es asesoría fiscal. Descárguelos cuando quiera.',
    'Expenses': 'Gastos', 'Mileage': 'Millas', 'Import from bank or card': 'Importar del banco o tarjeta', 'Download': 'Descargar', 'Year': 'Año',
    'General (not tied to a job)': 'General (sin trabajo)', 'General': 'General', 'Expenses this year': 'Gastos este año', 'Miles driven': 'Millas recorridas', 'Value at your rate': 'Valor a su tarifa', 'Set your mileage rate in Settings': 'Ponga su tarifa por milla en Configuración', 'By category': 'Por categoría',
    'Quick add': 'Agregar rápido', 'Amount ($)': 'Monto ($)', 'Date': 'Fecha', 'Vendor': 'Proveedor', 'Category': 'Categoría', 'Job': 'Trabajo', 'Note (optional)': 'Nota (opcional)', 'Save expense': 'Guardar gasto', 'Add receipt photo': 'Agregar foto del recibo', 'Receipt photo added.': 'Foto del recibo agregada.',
    'Read this receipt for me': 'Leer este recibo por mí', 'Reading...': 'Leyendo...', 'reads left this month': 'lecturas restantes este mes', 'Not in your plan': 'No está en su plan', 'Check what was read, fix anything wrong, then save.': 'Revise lo leído, corrija lo que esté mal y guarde.',
    'After the first time, a vendor fills in its own category. Photos are shrunk on your phone before upload.': 'Después de la primera vez, el proveedor llena su categoría solo. Las fotos se reducen en su teléfono antes de subirlas.',
    'Amount': 'Monto', 'Receipt': 'Recibo', 'No expenses for this year yet.': 'Todavía no hay gastos este año.', 'Delete this expense?': '¿Borrar este gasto?', 'Delete this trip?': '¿Borrar este viaje?',
    'Saved.': 'Guardado.', 'Saved. This vendor will fill its category next time.': 'Guardado. Este proveedor llenará su categoría la próxima vez.',
    'Add a trip': 'Agregar un viaje', 'Miles': 'Millas', 'Save trip': 'Guardar viaje', 'Value': 'Valor', 'No trips for this year yet.': 'Todavía no hay viajes este año.',
    'Set your mileage rate in Settings to see the value of each trip. The IRS rate changes every year, so check the current rate.': 'Ponga su tarifa por milla en Configuración para ver el valor de cada viaje. La tarifa del IRS cambia cada año, revise la actual.',
    'expenses found': 'gastos encontrados', 'credits or unreadable rows skipped': 'créditos o filas ilegibles omitidos', 'Uncheck any that are not business expenses. Duplicates are unchecked for you.': 'Desmarque los que no sean gastos del negocio. Los duplicados ya vienen desmarcados.', 'already saved': 'ya guardado',
    'Put all of these on one job (optional)': 'Poner todos en un trabajo (opcional)', 'Add the checked expenses': 'Agregar los gastos marcados', 'Cancel': 'Cancelar', 'expenses added.': 'gastos agregados.',
    'Import a month of expenses': 'Importar un mes de gastos', 'Download your bank or credit card transactions as a CSV file, then choose it here. Nothing is saved until you check the list. No AI is used, so it costs nothing.': 'Descargue las transacciones de su banco o tarjeta como archivo CSV y elíjalo aquí. No se guarda nada hasta que revise la lista. No usa IA, así que no cuesta nada.',
    'Download your records': 'Descargar sus registros', 'Spreadsheet files (CSV) that open in Excel or Google Sheets and that your accountant can use. Records only, not tax advice.': 'Archivos de hoja de cálculo (CSV) que abren en Excel o Google Sheets y que su contador puede usar. Solo registros, no es asesoría fiscal.',
    'Expenses (CSV)': 'Gastos (CSV)', 'Mileage (CSV)': 'Millas (CSV)', 'Invoices (CSV)': 'Facturas (CSV)', 'Your data stays safe here. We still suggest downloading at least once a year, at tax time.': 'Sus datos están seguros aquí. Aun así le sugerimos descargarlos al menos una vez al año, en época de impuestos.',
    'Mileage rate': 'Tarifa por milla', 'Cents per mile. The IRS rate changes every year, so we do not fill it in. Check the current rate at IRS.gov or ask your accountant.': 'Centavos por milla. La tarifa del IRS cambia cada año, por eso no la llenamos. Revise la actual en IRS.gov o pregunte a su contador.', 'Cents per mile': 'Centavos por milla',
    '1099 reporting threshold ($)': 'Umbral para reportar 1099 ($)', 'The 1099 amount changes by law (it is $2,000 for payments after Dec 31, 2025). Confirm with your accountant or IRS.gov.': 'El monto del 1099 cambia por ley ($2,000 para pagos después del 31 de dic. de 2025). Confirme con su contador o IRS.gov.', 'Save settings': 'Guardar ajustes',
    'Your own categories': 'Sus propias categorías', 'Example: Dumpster rental': 'Ejemplo: Renta de contenedor', 'Add category': 'Agregar categoría', 'Saved vendor rules': 'Reglas guardadas de proveedores', 'When you save an expense, its vendor remembers the category. Remove a rule here if it is wrong.': 'Al guardar un gasto, el proveedor recuerda la categoría. Quite aquí una regla si está mal.', 'Remove': 'Quitar',
    'Expenses and mileage for this job': 'Gastos y millas de este trabajo', 'Add an expense or trip': 'Agregar un gasto o viaje', 'All records': 'Todos los registros', 'Records': 'Registros',
  });

  pmI18n.add({
    'Crew, hours and pay records': 'Equipo, horas y registros de pago', 'Crew': 'Equipo', 'Time sheet': 'Hoja de horas', 'Payments': 'Pagos', 'Reports and 1099': 'Reportes y 1099',
    'Records for your accountant, not tax advice. We do not store Social Security or tax ID numbers. Pay records are visible only to the owner login.': 'Registros para su contador, no es asesoría fiscal. No guardamos números de Seguro Social ni de identificación fiscal. Los registros de pago solo los ve el dueño.',
    'Crew pay and 1099 tracking': 'Pagos del equipo y control de 1099', 'See Basic and Pro plans': 'Ver planes Basic y Pro',
    'Keep every worker in one place: photo, position, start date and pay rate, a weekly time sheet, hours and pay per job, week, month and year, and a year-end list of contractors who need a 1099.': 'Tenga a cada trabajador en un solo lugar: foto, puesto, fecha de inicio y tarifa, hoja de horas semanal, horas y pago por trabajo, semana, mes y año, y una lista de fin de año de contratistas que necesitan 1099.',
    'Printable employee profile for your paper records': 'Perfil imprimible del empleado para sus archivos en papel', 'W-9 file on record, no tax ID numbers stored': 'Archivo W-9 guardado, sin números de identificación fiscal', 'CSV downloads for your accountant': 'Descargas CSV para su contador',
    'Example: Luis, painter, $22 per hour, 38.5 hours this week on the Smith job.': 'Ejemplo: Luis, pintor, $22 por hora, 38.5 horas esta semana en el trabajo Smith.',
    'No job': 'Sin trabajo', 'Employee': 'Empleado', '1099 contractor': 'Contratista 1099', 'removed': 'retirado', 'hrs': 'hrs', 'per hour': 'por hora', 'per day': 'por día', 'per job': 'por trabajo',
    'Name': 'Nombre', 'Pay rate': 'Tarifa de pago', 'No workers yet. Add your first one below.': 'Todavía no hay trabajadores. Agregue el primero abajo.', 'Add a worker': 'Agregar un trabajador', 'Edit worker': 'Editar trabajador', 'New worker': 'Nuevo trabajador',
    'Type': 'Tipo', 'Position': 'Puesto', 'Pay ($)': 'Pago ($)', 'Paid by': 'Se paga por', 'Start date': 'Fecha de inicio', 'Phone': 'Teléfono', 'Notes': 'Notas', 'Add or change photo': 'Agregar o cambiar foto', 'Upload W-9': 'Subir W-9', 'W-9 on file': 'W-9 archivado', 'No W-9 on file': 'Sin W-9 archivado', 'Delete file': 'Borrar archivo', 'Delete photo': 'Borrar foto',
    'Print the profile, then delete files here if you want to free up storage. The hours and pay records stay.': 'Imprima el perfil y luego borre los archivos aquí si quiere liberar espacio. Los registros de horas y pagos se quedan.', 'Save first, then you can add a photo and W-9.': 'Guarde primero y luego podrá agregar foto y W-9.',
    'Save worker': 'Guardar trabajador', 'Remove from active crew': 'Quitar del equipo activo', 'Remove this worker from the active crew? Their hours and pay records stay.': '¿Quitar a este trabajador del equipo activo? Sus registros de horas y pagos se quedan.', 'Profile': 'Perfil',
    'Add a worker first.': 'Agregue un trabajador primero.', 'Worker': 'Trabajador', 'Week of': 'Semana del', 'In': 'Entrada', 'Out': 'Salida', 'Hours': 'Horas', 'No hours this week.': 'No hay horas esta semana.', 'Add hours': 'Agregar horas', 'Clock in': 'Hora de entrada', 'Clock out': 'Hora de salida', 'Break (minutes)': 'Descanso (minutos)', 'or Hours': 'o Horas', 'Save hours': 'Guardar horas', 'Delete these hours?': '¿Borrar estas horas?',
    'Record a payment': 'Registrar un pago', 'Record what you actually paid. For contractors, this is what the 1099 list adds up.': 'Registre lo que realmente pagó. Para contratistas, esto es lo que suma la lista de 1099.', 'Save payment': 'Guardar pago', 'No payments recorded this year.': 'No hay pagos registrados este año.', 'Delete this payment?': '¿Borrar este pago?',
    'Hours and pay': 'Horas y pagos', 'Worked out from rate': 'Calculado por tarifa', 'Paid': 'Pagado', 'By month': 'Por mes', 'By job': 'Por trabajo', 'Nothing recorded yet.': 'Todavía no hay nada registrado.', '1099 contractors': 'Contratistas 1099', 'Contractor': 'Contratista', 'Needs a 1099': 'Necesita 1099', 'Under the threshold': 'Debajo del umbral', 'No W-9': 'Sin W-9', 'No contractors yet.': 'Todavía no hay contratistas.',
    'A contractor paid at least the reporting threshold in a year needs a Form 1099-NEC from you by January 31. The threshold is': 'A un contratista al que pagó al menos el umbral en un año hay que darle un Formulario 1099-NEC antes del 31 de enero. El umbral es', '(change it in': '(cámbielo en', 'Records, Settings': 'Registros, Configuración', 'Employees get a W-2, so they are not listed. Confirm with your accountant or IRS.gov.': 'Los empleados reciben un W-2, por eso no aparecen. Confirme con su contador o IRS.gov.',
    'Hours (CSV)': 'Horas (CSV)', 'Payments (CSV)': 'Pagos (CSV)', '1099 list (CSV)': 'Lista 1099 (CSV)', 'Uploading...': 'Subiendo...', 'Delete this file? This cannot be undone.': '¿Borrar este archivo? No se puede deshacer.',
  });

  pmI18n.add({
    'Warranty certificate': 'Certificado de garantía', 'Create warranty certificate': 'Crear certificado de garantía', 'This job is finished.': 'Este trabajo está terminado.', 'Give your customer a warranty certificate?': '¿Darle un certificado de garantía a su cliente?',
    'A certificate is never sent automatically. It starts with your usual labor warranty and job details. You review it first.': 'Un certificado nunca se envía automáticamente. Empieza con su garantía de mano de obra habitual y los datos del trabajo. Usted lo revisa primero.',
    'Design': 'Diseño', 'Labor warranty (months)': 'Garantía de mano de obra (meses)', 'Work finished on': 'Trabajo terminado el', 'Language': 'Idioma',
    'What the warranty covers (leave blank for the standard sentence)': 'Qué cubre la garantía (deje en blanco para la frase estándar)', 'Not covered (optional)': 'No cubre (opcional)', 'Use this design as my default': 'Usar este diseño como mi predeterminado',
    'Preview and print': 'Vista previa e imprimir', 'Save, then use Preview to see how the design looks. Records only: check the wording with your attorney if you want it to be a formal legal warranty.': 'Guarde y use la vista previa para ver el diseño. Solo es un registro: revise el texto con su abogado si quiere una garantía legal formal.',
    'You will get a reminder on Home before it ends.': 'Recibirá un recordatorio en Inicio antes de que termine.',
  });

  pmI18n.add({
    'Lessons learned': 'Lecciones aprendidas', 'Lessons': 'Lecciones', 'Draft lessons from this job': 'Redactar lecciones de este trabajo', 'Write one myself': 'Escribir una yo mismo', 'Approve and save': 'Aprobar y guardar', 'What you learned': 'Lo que aprendió', 'Tags (comma separated)': 'Etiquetas (separadas por coma)', 'Nothing saved for this job yet.': 'Todavía no hay nada guardado para este trabajo.',
    "The draft comes from this job's notes, issues, change orders and chat. You edit it before anything is saved. Your library is private to your company.": 'El borrador sale de las notas, problemas, órdenes de cambio y chat de este trabajo. Usted lo edita antes de guardar nada. Su biblioteca es privada de su empresa.',
    'Build your own playbook: after each job, save what you learned. The job assistant reads it, so future answers fit how you work. Included in Basic and Pro.': 'Construya su propio manual: después de cada trabajo, guarde lo que aprendió. El asistente lo lee, así sus respuestas encajan con su forma de trabajar. Incluido en Basic y Pro.',
    'Photo attached.': 'Foto adjunta.', 'Ask': 'Preguntar', 'Photo': 'Foto',
  });

  pmI18n.add({
    'Crew hours and 1099 list': 'Horas del equipo y lista 1099',
    'Files built to the formats QuickBooks publishes. Try a small file first, or make a backup of your company file. We cannot test inside your QuickBooks.': 'Archivos hechos con los formatos que publica QuickBooks. Pruebe primero con un archivo pequeño o haga una copia de seguridad de su archivo de empresa. No podemos probar dentro de su QuickBooks.',
    'Banking, then Upload transactions. Pick the bank or card account that paid. The file has Date, Description and Amount, with payments as negative amounts. The description shows vendor, category and job, so you can assign them in QuickBooks. If the same charges also come in from your bank feed, they may show twice: upload only the ones that are not in your feed.': 'Banca, luego Subir transacciones. Elija la cuenta bancaria o tarjeta que pagó. El archivo tiene Fecha, Descripción y Monto, con los pagos como montos negativos. La descripción muestra proveedor, categoría y trabajo para que los asigne en QuickBooks. Si los mismos cargos también llegan de su conexión bancaria, pueden aparecer dos veces: suba solo los que no estén en su conexión.',
    'QuickBooks Online file (CSV)': 'Archivo para QuickBooks Online (CSV)', 'QuickBooks Desktop file (IIF)': 'Archivo para QuickBooks Desktop (IIF)',
    'File menu, Utilities, Import, IIF Files. First create these expense accounts in QuickBooks, or it may create them as the wrong type:': 'Menú Archivo, Utilidades, Importar, Archivos IIF. Primero cree estas cuentas de gastos en QuickBooks, o podría crearlas con el tipo equivocado:',
    'Intuit does not provide support for IIF files, so check the imported entries.': 'Intuit no da soporte para archivos IIF, así que revise las entradas importadas.',
    'Account that paid (must exist in QuickBooks)': 'Cuenta que pagó (debe existir en QuickBooks)', 'That account is a': 'Esa cuenta es', 'Bank account (checks)': 'Cuenta bancaria (cheques)', 'Credit card': 'Tarjeta de crédito', 'Save account': 'Guardar cuenta',
  });

  pmI18n.add({
    'Job file download': 'Descarga del archivo del trabajo', 'Download job file (ZIP)': 'Descargar archivo del trabajo (ZIP)', 'Free up storage': 'Liberar espacio',
    'One ZIP with everything about this job, organized by section: a summary page, your photos and receipts, documents, work and change orders, crew hours, expenses, mileage, warranty, lessons and your private chat.': 'Un ZIP con todo sobre este trabajo, organizado por sección: una página de resumen, sus fotos y recibos, documentos, órdenes de trabajo y de cambio, horas del equipo, gastos, millas, garantía, lecciones y su chat privado.',
    'I downloaded the ZIP and it opens': 'Descargué el ZIP y abre bien', "Remove this job's photos and files from storage": 'Quitar las fotos y archivos de este trabajo del almacenamiento',
    'Year-end package (ZIP)': 'Paquete de fin de año (ZIP)', 'One download for your accountant: expenses, mileage, invoices, crew hours, payments, the 1099 list and both QuickBooks files.': 'Una descarga para su contador: gastos, millas, facturas, horas del equipo, pagos, la lista 1099 y ambos archivos de QuickBooks.',
  });

  pmI18n.add({
    'How your business is doing': 'Cómo va su negocio', 'Worked out from your own jobs, costs and hours. Plain math, no guessing. Records for your accountant, not tax advice.': 'Calculado con sus propios trabajos, costos y horas. Matemática simple, sin adivinar. Registros para su contador, no es asesoría fiscal.',
    'Jobs won': 'Trabajos ganados', 'of': 'de', 'jobs': 'trabajos', 'Win rate': 'Tasa de éxito', 'won vs lost': 'ganados vs perdidos', 'Sales from won jobs': 'Ventas de trabajos ganados', 'Recorded expenses': 'Gastos registrados', 'Miles driven': 'Millas recorridas',
    'Sales by year': 'Ventas por año', 'Sales by month': 'Ventas por mes', 'Sales by season': 'Ventas por temporada', 'Sales by city': 'Ventas por ciudad', 'Why jobs were lost': 'Por qué se perdieron trabajos', 'Nothing yet.': 'Todavía nada.',
    'Spring': 'Primavera', 'Summer': 'Verano', 'Fall': 'Otoño', 'Winter': 'Invierno', 'Unknown': 'Desconocida',
    'Profit by service': 'Ganancia por servicio', 'Sales minus the expenses and crew payments you recorded on each job. Only as complete as your records.': 'Ventas menos los gastos y pagos al equipo que registró en cada trabajo. Solo es tan completo como sus registros.',
    'Service': 'Servicio', 'Jobs': 'Trabajos', 'Sales': 'Ventas', 'Costs': 'Costos', 'Profit': 'Ganancia', 'Margin': 'Margen', 'Most profitable jobs': 'Trabajos más rentables', 'Least profitable jobs': 'Trabajos menos rentables',
    'Crew productivity': 'Productividad del equipo', 'Record crew hours on your jobs to see sales per labor hour.': 'Registre las horas del equipo en sus trabajos para ver ventas por hora de trabajo.', 'Sales per labor hour': 'Ventas por hora de trabajo', 'workers': 'trabajadores',
    'Materials and mileage': 'Materiales y millas', 'Materials': 'Materiales', 'of sales': 'de las ventas', 'Crew payments on jobs': 'Pagos al equipo en trabajos',
    'Data we suggest collecting next': 'Datos que le sugerimos recopilar', 'The more complete your records, the more these reports can tell you.': 'Mientras más completos sus registros, más le dicen estos reportes.', 'Start here': 'Empiece aquí',
    'Job start and end dates': 'Fechas de inicio y fin del trabajo', 'Crew hours on every job': 'Horas del equipo en cada trabajo', 'Materials and fuel on every job': 'Materiales y combustible en cada trabajo', 'Mileage per job': 'Millas por trabajo',
    'Hours estimated vs actual': 'Horas estimadas vs reales', 'Square footage actually painted': 'Pies cuadrados realmente pintados', 'Where each lead came from': 'De dónde vino cada cliente', 'Paint brand and gallons used': 'Marca de pintura y galones usados', 'Rework and callback hours': 'Horas de retrabajo y regresos',
    'Included in Pro.': 'Incluido en Pro.', 'See plans': 'Ver planes', 'Sample numbers': 'Números de ejemplo', 'See what your jobs really earn': 'Vea cuánto ganan realmente sus trabajos',
    'Basic shows your win rate, sales by month and why you lose jobs. Pro adds profit per job and per service, sales by season and city, crew productivity, mileage and materials use.': 'Basic muestra su tasa de éxito, ventas por mes y por qué pierde trabajos. Pro agrega ganancia por trabajo y por servicio, ventas por temporada y ciudad, productividad del equipo, millas y uso de materiales.',
    'Profit per job and per service': 'Ganancia por trabajo y por servicio', 'Sales by season and city': 'Ventas por temporada y ciudad', 'Crew productivity, mileage and materials use': 'Productividad del equipo, millas y uso de materiales', 'Could not load the report.': 'No se pudo cargar el reporte.', 'Analysis': 'Análisis',
  });

  pmI18n.add({
    "Add your per-mile rate in Settings to see what these miles are worth": "Agregue su tarifa por milla en Ajustes para ver cuánto valen estas millas",
    "Your receipt photo": "La foto de su recibo",
    "We read the receipt for you and fill in the boxes. You can fix anything before saving.": "Leemos el recibo por usted y llenamos las casillas. Puede corregir lo que sea antes de guardar.",
    "Add the photo to keep it with this expense, then type the details below.": "Agregue la foto para guardarla con este gasto y luego escriba los detalles abajo.",
    "Edit this expense": "Editar este gasto",
    "Add an expense": "Agregar un gasto",
    "Fastest way: take a photo of the receipt.": "La forma más rápida: tome una foto del recibo.",
    "Categories are the labels on expenses, like Materials or Fuel. Your accountant uses them to sort your costs. Add your own (like Dumpster rental) in the Settings tab and they show up in this list.": "Las categorías son las etiquetas de los gastos, como Materiales o Combustible. Su contador las usa para ordenar sus costos. Agregue las suyas (como Alquiler de contenedor) en la pestaña Ajustes y aparecerán en esta lista.",
    "The job stays selected after you save, so you can add the next receipt for the same job. After the first time, a vendor fills in its own category.": "El trabajo sigue seleccionado después de guardar, para que pueda agregar el siguiente recibo del mismo trabajo. Después de la primera vez, cada proveedor llena su propia categoría.",
    "Uploading your photo...": "Subiendo su foto...",
    "Could not upload that photo. Please try again.": "No se pudo subir esa foto. Inténtelo de nuevo.",
    "Photo added. Reading receipts is not in your plan, so type the details below.": "Foto agregada. La lectura de recibos no está en su plan, así que escriba los detalles abajo.",
    "Photo added. You used this month's receipt reads, so type the details below.": "Foto agregada. Ya usó las lecturas de recibos de este mes, así que escriba los detalles abajo.",
    "Reading your receipt...": "Leyendo su recibo...",
    "Done. Check the boxes below, fix anything that looks wrong, then save.": "Listo. Revise las casillas de abajo, corrija lo que se vea mal y luego guarde.",
    "Try reading again": "Intentar leer otra vez",
    "miles": "millas",
    "worth about": "valen cerca de",
    "Your total shows here as you type.": "Su total aparece aquí mientras escribe.",
    "Edit this trip": "Editar este viaje",
    "Track your miles on this job": "Registre sus millas en este trabajo",
    "Pick the job, tell us how far you drove, and you are done. Not sure of the distance? Check your phone's map once, then use \"same drive on several days\" so you never have to type it every day.": "Elija el trabajo, díganos cuánto manejó y listo. ¿No sabe la distancia? Revise el mapa de su teléfono una vez y use \"el mismo recorrido varios días\" para no escribirlo todos los días.",
    "Tip: if you tell us what your accountant uses per mile, we will show what each trip is worth. You can log miles without it.": "Consejo: si nos dice cuánto usa su contador por milla, le mostraremos cuánto vale cada viaje. Puede registrar millas sin eso.",
    "Open Settings": "Abrir Ajustes",
    "Which job was the drive for?": "¿Para qué trabajo fue el recorrido?",
    "I know the miles": "Sé las millas",
    "Use my odometer": "Usar mi odómetro",
    "Odometer when you started": "Odómetro al salir",
    "Odometer when you finished": "Odómetro al terminar",
    "Miles for one day (there and back)": "Millas de un día (ida y vuelta)",
    "Same drive on how many days?": "¿El mismo recorrido cuántos días?",
    "If you drive the same route every day of a job, type the miles for ONE day, then how many days you drove it. We multiply for you. Example: 18 miles, 5 days = 90 miles.": "Si maneja la misma ruta todos los días de un trabajo, escriba las millas de UN día y luego cuántos días la manejó. Nosotros multiplicamos. Ejemplo: 18 millas, 5 días = 90 millas.",
    "Your trips": "Sus viajes",
    "Add a whole month of expenses at once": "Agregar un mes completo de gastos de una vez",
    "If you pay for paint, fuel and supplies with a business debit card, credit card or bank account, your bank already keeps a list of every purchase. Instead of typing each one, download that list from your bank's website and add it here. You look over the list first, and nothing is saved until you say so.": "Si paga la pintura, el combustible y los suministros con una tarjeta de débito, tarjeta de crédito o cuenta bancaria del negocio, su banco ya guarda una lista de cada compra. En vez de escribirlas una por una, descargue esa lista del sitio web de su banco y agréguela aquí. Usted revisa la lista primero y no se guarda nada hasta que usted lo diga.",
    "How to get the file": "Cómo obtener el archivo",
    "Sign in to your bank or card website.": "Entre al sitio web de su banco o tarjeta.",
    "Open your account and look for Transactions or Statements.": "Abra su cuenta y busque Transacciones o Estados de cuenta.",
    "Find Download or Export and choose CSV. Some banks call it Excel or spreadsheet. One month at a time works best.": "Busque Descargar o Exportar y elija CSV. Algunos bancos lo llaman Excel u hoja de cálculo. Un mes a la vez funciona mejor.",
    "Choose that file below.": "Elija ese archivo abajo.",
    "Works with: CSV files. PDF statements and photos cannot be read yet. We do not keep the file or your account number, only the expenses you check.": "Funciona con: archivos CSV. Los estados de cuenta en PDF y las fotos todavía no se pueden leer. No guardamos el archivo ni su número de cuenta, solo los gastos que usted marque.",
    "What should the file look like?": "¿Cómo debe verse el archivo?",
    "Open it in Excel or Google Sheets. It needs a row of headings that includes a date, a description (or merchant), and an amount (or debit). Extra columns are fine.": "Ábralo en Excel o Google Sheets. Necesita una fila de encabezados con una fecha, una descripción (o comercio) y un monto (o débito). Las columnas extra no hay problema.",
    "These are spreadsheet files (CSV). They open in Excel or Google Sheets, and your accountant can use them. Records only, not tax advice.": "Estos son archivos de hoja de cálculo (CSV). Se abren en Excel o Google Sheets y su contador puede usarlos. Solo registros, no asesoría de impuestos.",
    "The easiest one. A single download for your accountant with all of the above, plus QuickBooks files if they use it.": "La más fácil. Una sola descarga para su contador con todo lo anterior, más archivos de QuickBooks si los usa.",
    "Do you use QuickBooks?": "¿Usa QuickBooks?",
    "QuickBooks is accounting software. Think of it as a checkbook on a computer. Some accountants use it to keep a business's books.": "QuickBooks es un programa de contabilidad. Piense en él como una chequera en la computadora. Algunos contadores lo usan para llevar los libros de un negocio.",
    "Do not use QuickBooks? You can skip this whole box. The Year-end package above has everything your accountant needs.": "¿No usa QuickBooks? Puede saltarse todo este cuadro. El paquete de fin de año de arriba tiene todo lo que su contador necesita.",
    "If you or your accountant do use it, these files drop your PaintersMax expenses into QuickBooks so nobody has to type them twice. There are two kinds of QuickBooks. QuickBooks Online is the one you open in a web browser. QuickBooks Desktop is a program installed on a computer. Not sure which you have? Ask your accountant, or skip this.": "Si usted o su contador lo usan, estos archivos pasan sus gastos de PaintersMax a QuickBooks para que nadie tenga que escribirlos dos veces. Hay dos tipos de QuickBooks. QuickBooks Online es el que se abre en un navegador web. QuickBooks Desktop es un programa instalado en una computadora. ¿No sabe cuál tiene? Pregunte a su contador o sáltese esto.",
    "Download the file below.": "Descargue el archivo de abajo.",
    "In QuickBooks Online, find Banking (or Transactions) and then Upload transactions.": "En QuickBooks Online, busque Banca (o Transacciones) y luego Cargar transacciones.",
    "Choose the bank or card account the money came out of.": "Elija la cuenta bancaria o tarjeta de donde salió el dinero.",
    "When it asks, match the columns: Date, Description and Amount.": "Cuando se lo pida, relacione las columnas: Fecha, Descripción y Monto.",
    "Look the list over, then accept it.": "Revise la lista y luego acéptela.",
    "If your bank is already connected to QuickBooks, these purchases may show up twice. Only upload the ones that are not already there.": "Si su banco ya está conectado a QuickBooks, estas compras pueden aparecer dos veces. Suba solo las que todavía no estén.",
    "Make a backup copy of your company file first, just to be safe.": "Haga primero una copia de seguridad de su archivo de la empresa, por seguridad.",
    "In QuickBooks, create these expense accounts (the names must match):": "En QuickBooks, cree estas cuentas de gastos (los nombres deben coincidir):",
    "Tell us the name of the account the money came out of, exactly as it is spelled in QuickBooks, and what kind it is:": "Díganos el nombre de la cuenta de donde salió el dinero, tal como está escrito en QuickBooks, y de qué tipo es:",
    "Name of that account (for example Business Checking)": "Nombre de esa cuenta (por ejemplo Cuenta de cheques del negocio)",
    "What kind of account is it?": "¿Qué tipo de cuenta es?",
    "In QuickBooks, open the File menu, then Utilities, then Import, then IIF Files, and choose the file.": "En QuickBooks, abra el menú Archivo, luego Utilidades, luego Importar, luego Archivos IIF, y elija el archivo.",
    "These files follow the formats Intuit (the maker of QuickBooks) publishes, but we cannot test inside your copy of QuickBooks. Try a small month first, and check the entries.": "Estos archivos siguen los formatos que publica Intuit (el fabricante de QuickBooks), pero no podemos probarlos dentro de su copia de QuickBooks. Pruebe primero con un mes pequeño y revise las entradas.",
    "This is how many cents the government lets a business count for each mile driven. We multiply your miles by it to show what your driving is worth. It helps your accountant, and we never file anything. The number changes most years, so we leave it blank on purpose. If it is blank, nothing breaks: we just do not show the dollar value.": "Esta es la cantidad de centavos que el gobierno permite a un negocio contar por cada milla manejada. Multiplicamos sus millas por este número para mostrar cuánto vale su manejo. Ayuda a su contador y nosotros nunca presentamos nada. El número cambia casi todos los años, por eso lo dejamos en blanco a propósito. Si está en blanco, nada se rompe: solo no mostramos el valor en dólares.",
    "Not sure what to type? Ask your accountant, or look up the current \"standard mileage rate\" for business on IRS.gov. Type it in cents: 70 means 70 cents a mile.": "¿No sabe qué escribir? Pregunte a su contador o busque la \"tarifa estándar por milla\" actual para negocios en IRS.gov. Escríbala en centavos: 70 significa 70 centavos por milla.",
    "Look it up on IRS.gov": "Búsquela en IRS.gov",
    "1099 reporting amount ($)": "Monto para reportar 1099 ($)",
    "If you pay a subcontractor this much or more in a year, the IRS may want a 1099 form from you. We use this number to flag who is over it. The amount changes by law, so check with your accountant.": "Si paga a un subcontratista esta cantidad o más en un año, el IRS puede pedirle un formulario 1099. Usamos este número para marcar quién lo pasa. El monto cambia por ley, así que confírmelo con su contador.",
    "Categories are the labels on expenses, like Materials, Fuel or Tools. Add your own here. They show up in the Category list when you add an expense (Expenses tab).": "Las categorías son las etiquetas de los gastos, como Materiales, Combustible o Herramientas. Agregue las suyas aquí. Aparecen en la lista de Categoría cuando agrega un gasto (pestaña Gastos).",
    "Add a label that fits your business. It will appear in the Category list on the Expenses tab.": "Agregue una etiqueta que le sirva a su negocio. Aparecerá en la lista de Categoría en la pestaña Gastos.",
    "Vendor memory": "Memoria de proveedores",
    "The first time you save an expense from a store, like Home Depot, as Materials, we remember it. Next time you type Home Depot, the category fills in by itself. If one is wrong, remove it here and it will learn again.": "La primera vez que guarda un gasto de una tienda, como Home Depot, como Materiales, lo recordamos. La próxima vez que escriba Home Depot, la categoría se llena sola. Si alguna está mal, quítela aquí y volverá a aprender.",
    "Stores we have learned. The first time you save an expense from a store, we remember its category. Next time it fills in by itself. Remove one if it is wrong.": "Tiendas que hemos aprendido. La primera vez que guarda un gasto de una tienda, recordamos su categoría. La próxima vez se llena sola. Quite una si está mal.",
    "That is a PDF statement. PDFs cannot be read yet. On your bank's website, look for Download or Export and choose CSV (it may be called Excel or spreadsheet), then choose that file here.": "Ese es un estado de cuenta en PDF. Los PDF todavía no se pueden leer. En el sitio web de su banco busque Descargar o Exportar y elija CSV (puede llamarse Excel u hoja de cálculo), y luego elija ese archivo aquí.",
    "Changes saved.": "Cambios guardados.",
    "Saved. This vendor will fill its category next time. The job is still selected, so you can add the next one.": "Guardado. Este proveedor llenará su categoría la próxima vez. El trabajo sigue seleccionado para que agregue el siguiente.",
    "Saved. The job is still selected, so you can add the next one.": "Guardado. El trabajo sigue seleccionado para que agregue el siguiente.",
    "odometer": "odómetro",
    "to": "a",
    "days": "días",
    "Saved. The job is still selected, so you can add another trip.": "Guardado. El trabajo sigue seleccionado para que agregue otro viaje.",
    "No W-9 yet": "Todavía sin W-9",
    "Add it": "Agregarlo",
    "Record time off or an absence": "Registrar tiempo libre o una ausencia",
    "Use this for a sick day, vacation, a holiday, a day someone did not show up, or a late arrival. It does not add work hours. It lets you see, at the end of the year, how often each person was out.": "Úselo para un día de enfermedad, vacaciones, un día feriado, un día que alguien no se presentó o una llegada tarde. No suma horas de trabajo. Le deja ver, al final del año, cuántas veces faltó cada persona.",
    "What happened": "Qué pasó",
    "Paid hours (optional)": "Horas pagadas (opcional)",
    "Save time off": "Guardar tiempo libre",
    "This is for the worker chosen at the top of this tab.": "Esto es para el trabajador elegido arriba en esta pestaña.",
    "How the money reached them: cash, check, a payment app, or the bank. Your accountant likes to see this, especially for cash.": "Cómo les llegó el dinero: efectivo, cheque, una aplicación de pagos o el banco. A su contador le gusta ver esto, sobre todo en efectivo.",
    "Check number or reference (optional)": "Número de cheque o referencia (opcional)",
    "Nothing is here yet because no hours or payments are recorded for": "Todavía no hay nada porque no hay horas ni pagos registrados para",
    "Add hours on the Time sheet tab and payments on the Payments tab, and this fills in by itself.": "Agregue horas en la pestaña Hoja de horas y pagos en la pestaña Pagos, y esto se llena solo.",
    "Go to Time sheet": "Ir a la hoja de horas",
    "Go to Payments": "Ir a Pagos",
    "Under the amount": "Debajo del monto",
    "This week": "Esta semana",
    "This month": "Este mes",
    "This year": "Este año",
    "Hours times the pay rate you entered for the worker. It is an estimate to compare with what you really paid.": "Horas por la tarifa de pago que puso para el trabajador. Es un cálculo para comparar con lo que realmente pagó.",
    "No workers yet.": "Todavía no hay trabajadores.",
    "Hours by month": "Horas por mes",
    "Time off and attendance": "Tiempo libre y asistencia",
    "How many days each person was sick, on vacation, off for a holiday, absent, or late. Record them on the Time sheet tab.": "Cuántos días cada persona estuvo enferma, de vacaciones, libre por un feriado, ausente o llegó tarde. Regístrelos en la pestaña Hoja de horas.",
    "Sick": "Enfermo",
    "Vacation": "Vacaciones",
    "Holiday": "Feriado",
    "Absent": "Ausente",
    "Late": "Tarde",
    "Last sick, absent or late": "Última vez enfermo, ausente o tarde",
    "Every day recorded": "Todos los días registrados",
    "No time off recorded yet.": "Todavía no hay tiempo libre registrado.",
    "Time off (CSV)": "Tiempo libre (CSV)",
    "1099 contractors and W-9 forms": "Contratistas 1099 y formularios W-9",
    "What is this? (plain words)": "¿Qué es esto? (en palabras sencillas)",
    "A contractor is someone who works for you but is not your employee, like a painter you pay by the job. Before you pay a contractor, ask for a W-9. It is a one-page IRS form where they give their legal name, address and tax number. Keep it in your records. If you pay a contractor the reporting amount or more in a year, the IRS may want a 1099-NEC form from you by January 31. Your accountant or tax software files it.": "Un contratista es alguien que trabaja para usted pero no es su empleado, como un pintor al que le paga por trabajo. Antes de pagarle, pídale un W-9. Es un formulario de una página del IRS donde da su nombre legal, dirección y número de impuestos. Guárdelo en sus registros. Si le paga a un contratista el monto de reporte o más en un año, el IRS puede pedirle un formulario 1099-NEC antes del 31 de enero. Su contador o su programa de impuestos lo presenta.",
    "PaintersMax keeps a scan or photo of the W-9 and adds up what you paid. We do not store tax numbers. Employees are different: they get a W-2, and payroll taxes are handled by you, a payroll service or your accountant. Confirm everything with your accountant or IRS.gov.": "PaintersMax guarda un escaneo o foto del W-9 y suma lo que usted pagó. No guardamos números de impuestos. Los empleados son distintos: reciben un W-2 y los impuestos de nómina los maneja usted, un servicio de nómina o su contador. Confirme todo con su contador o en IRS.gov.",
    "Get a blank W-9 from IRS.gov": "Obtener un W-9 en blanco en IRS.gov",
    "The reporting amount is": "El monto de reporte es",
    "Change it in Records, Settings": "Cámbielo en Registros, Ajustes",
    "No contractors yet. Add a worker and choose 1099 contractor as the type.": "Todavía no hay contratistas. Agregue un trabajador y elija contratista 1099 como tipo.",
    "Delete this record?": "¿Eliminar este registro?",
    "Main menu": "Menú principal",
    "More": "Más",
    "Cash": "Efectivo",
    "Check": "Cheque",
    "Direct deposit or bank transfer": "Depósito directo o transferencia bancaria",
    "Zelle": "Zelle",
    "Cash App": "Cash App",
    "Venmo": "Venmo",
    "PayPal": "PayPal",
    "Absent (did not show up)": "Ausente (no se presentó)",
    "Other time off": "Otro tiempo libre",
    "Jan": "ene",
    "Feb": "feb",
    "Mar": "mar",
    "Apr": "abr",
    "May": "may",
    "Jun": "jun",
    "Jul": "jul",
    "Aug": "ago",
    "Sep": "sep",
    "Oct": "oct",
    "Nov": "nov",
    "Dec": "dic",
  });

  /* ---- Part 11: round 2 (job page for phones, payments, Quote helper, bank PDF, 404) ---- */
  pmI18n.add({
    "Power wash": "Lavado a presión",
    "Wood stain": "Teñido de madera",
    "Something else": "Otra cosa",
    "Rooms, ceilings, trim, doors, cabinets": "Cuartos, techos, molduras, puertas, gabinetes",
    "What is being painted?": "¿Qué se va a pintar?",
    "Living room": "Sala",
    "Kitchen": "Cocina",
    "Bedrooms": "Recámaras",
    "Bathrooms": "Baños",
    "Hallways and stairs": "Pasillos y escaleras",
    "Trim and baseboards": "Molduras y zoclos",
    "Cabinets": "Gabinetes",
    "Whole house": "Toda la casa",
    "About how many rooms?": "¿Cuántos cuartos, más o menos?",
    "What shape are the walls in?": "¿En qué estado están las paredes?",
    "Good": "Buen estado",
    "Needs light repair (nail holes, small cracks)": "Necesita reparación ligera (agujeros de clavos, grietas pequeñas)",
    "Needs heavy repair (big holes, texture, water damage)": "Necesita reparación fuerte (agujeros grandes, textura, daño por agua)",
    "How tall are the ceilings?": "¿Qué altura tienen los techos?",
    "Standard (8 ft)": "Estándar (8 pies)",
    "9 to 10 ft": "9 a 10 pies",
    "Vaulted or over 10 ft": "Abovedados o de más de 10 pies",
    "What about furniture?": "¿Y los muebles?",
    "Empty": "Vacío",
    "Customer moves it": "El cliente los mueve",
    "We move and cover it": "Nosotros los movemos y cubrimos",
    "Who buys the paint?": "¿Quién compra la pintura?",
    "We supply it": "Nosotros la ponemos",
    "Customer supplies it": "El cliente la pone",
    "How many colors?": "¿Cuántos colores?",
    "3 or more": "3 o más",
    "Not decided yet": "Todavía no se decide",
    "Was the home built before 1978?": "¿La casa se construyó antes de 1978?",
    "Homes built before 1978 may have lead paint. Lead-safe rules can apply before you sand or scrape.": "Las casas construidas antes de 1978 pueden tener pintura con plomo. Pueden aplicar reglas de trabajo seguro con plomo antes de lijar o raspar.",
    "Not sure": "No estoy seguro",
    "Siding, trim, doors, fascia, shutters": "Revestimiento, molduras, puertas, tablas de alero, contraventanas",
    "Siding or walls": "Revestimiento o paredes",
    "Trim": "Molduras",
    "Garage door": "Puerta del garaje",
    "Fascia and soffits": "Tablas de alero y sofitos",
    "Shutters": "Contraventanas",
    "Windows": "Ventanas",
    "Fence": "Cerca",
    "Deck": "Terraza",
    "How many stories?": "¿Cuántos pisos?",
    "What is the surface?": "¿Cuál es la superficie?",
    "Wood": "Madera",
    "Stucco": "Estuco",
    "Brick": "Ladrillo",
    "Vinyl or aluminum": "Vinilo o aluminio",
    "Fiber cement (Hardie)": "Fibrocemento (Hardie)",
    "A mix": "Una mezcla",
    "What shape is the old paint in?": "¿En qué estado está la pintura vieja?",
    "Chalking or fading": "Calcinada o desteñida",
    "Peeling or cracking": "Descascarada o agrietada",
    "Bare wood or rot in places": "Madera al descubierto o podrida en partes",
    "What prep is needed?": "¿Qué preparación se necesita?",
    "Pressure wash": "Lavado a presión",
    "Scrape and sand": "Raspar y lijar",
    "Caulk": "Sellar con masilla",
    "Prime bare spots": "Imprimar zonas sin pintura",
    "Replace rotten wood": "Reemplazar madera podrida",
    "House size in square feet (if you know)": "Tamaño de la casa en pies cuadrados (si lo sabe)",
    "House, driveway, patio, deck, fence": "Casa, entrada de autos, patio, terraza, cerca",
    "What is being washed?": "¿Qué se va a lavar?",
    "House siding": "Revestimiento de la casa",
    "Driveway": "Entrada de autos",
    "Sidewalk": "Banqueta",
    "Patio": "Patio",
    "Roof": "Tejado",
    "Pool deck": "Terraza de alberca",
    "About how many square feet in all?": "¿Cuántos pies cuadrados en total, más o menos?",
    "How many stories (house washing)?": "¿Cuántos pisos (lavado de casa)?",
    "Not a house": "No es una casa",
    "How much mildew or algae?": "¿Cuánto moho o alga hay?",
    "None": "Nada",
    "Some": "Algo",
    "Heavy": "Mucho",
    "Wash only, or wash and seal?": "¿Solo lavar, o lavar y sellar?",
    "Wash only": "Solo lavar",
    "Wash and seal": "Lavar y sellar",
    "Water on site?": "¿Hay agua en el lugar?",
    "Yes, customer's spigot": "Sí, la llave del cliente",
    "No, we bring water": "No, traemos agua",
    "Offices, stores, apartments, warehouses": "Oficinas, tiendas, apartamentos, bodegas",
    "What kind of building?": "¿Qué tipo de edificio?",
    "Office": "Oficina",
    "Retail or restaurant": "Tienda o restaurante",
    "Apartments or HOA": "Apartamentos o HOA",
    "Warehouse": "Bodega",
    "School or church": "Escuela o iglesia",
    "What is the scope?": "¿Cuál es el alcance?",
    "Interior walls": "Paredes interiores",
    "Doors and frames": "Puertas y marcos",
    "Metal and rails": "Metal y barandales",
    "Floors": "Pisos",
    "Parking lot striping": "Rayado de estacionamiento",
    "Approximate square feet": "Pies cuadrados aproximados",
    "When can we work?": "¿Cuándo podemos trabajar?",
    "Normal hours": "Horario normal",
    "After hours or nights": "Fuera de horario o de noche",
    "Weekends only": "Solo fines de semana",
    "Is the space occupied?": "¿El espacio está ocupado?",
    "Occupied": "Ocupado",
    "Vacant": "Desocupado",
    "Lift or scaffold needed?": "¿Se necesita elevador o andamio?",
    "Scissor lift": "Elevador de tijera",
    "Boom lift or scaffold": "Elevador de brazo o andamio",
    "Paperwork they asked for": "Documentos que pidieron",
    "Certificate of insurance": "Certificado de seguro",
    "Bond": "Fianza",
    "Prevailing wage": "Salario prevaleciente",
    "Background checks": "Verificación de antecedentes",
    "Decks, fences, doors, pergolas, log homes": "Terrazas, cercas, puertas, pérgolas, casas de troncos",
    "What is being stained?": "¿Qué se va a teñir?",
    "Front door": "Puerta principal",
    "Pergola": "Pérgola",
    "Log home": "Casa de troncos",
    "Furniture": "Muebles",
    "About how many square feet (or feet of fence)?": "¿Cuántos pies cuadrados (o pies de cerca), más o menos?",
    "What shape is the wood in?": "¿En qué estado está la madera?",
    "New wood": "Madera nueva",
    "Stained before, still good": "Ya teñida, todavía en buen estado",
    "Gray or weathered": "Gris o desgastada por el clima",
    "Peeling old finish": "Acabado viejo descascarado",
    "Type of stain": "Tipo de tinte",
    "Clear or transparent": "Transparente",
    "Semi-transparent": "Semitransparente",
    "Solid": "Sólido",
    "Strip old finish": "Quitar el acabado viejo",
    "Sand": "Lijar",
    "Wash and brighten": "Lavar y aclarar",
    "Repair boards": "Reparar tablas",
    "How many coats?": "¿Cuántas manos?",
    "An odd job that does not fit the others": "Un trabajo raro que no encaja con los demás",
    "What is the job?": "¿Cuál es el trabajo?",
    "Describe it in your own words. Example: Repaint a metal staircase and handrail.": "Descríbalo con sus propias palabras. Ejemplo: Volver a pintar una escalera de metal y su pasamanos.",
    "About how long will it take?": "¿Cuánto tiempo tomará, más o menos?",
    "Under a day": "Menos de un día",
    "1 to 2 days": "1 a 2 días",
    "3 to 5 days": "3 a 5 días",
    "More than a week": "Más de una semana",
    "Special materials or products?": "¿Materiales o productos especiales?",
    "Special equipment or access?": "¿Equipo o acceso especial?",
    "Lift, scaffold, rope access, sprayer.": "Elevador, andamio, acceso con cuerdas, pistola de rociado.",
    "Tap what fits.": "Toque lo que corresponda.",
    "Skip anything you do not know.": "Omita lo que no sepa.",
    "Choose...": "Elija...",
    "Rooms, ceilings, trim, doors, cabinets.": "Cuartos, techos, molduras, puertas, gabinetes.",
    "Siding, trim, doors, fascia, shutters.": "Revestimiento, molduras, puertas, tablas de alero, contraventanas.",
    "House, driveway, patio, deck, fence.": "Casa, entrada de autos, patio, terraza, cerca.",
    "Offices, stores, apartments, warehouses.": "Oficinas, tiendas, apartamentos, bodegas.",
    "Decks, fences, doors, pergolas, log homes.": "Terrazas, cercas, puertas, pérgolas, casas de troncos.",
    "An odd job that does not fit the others.": "Un trabajo raro que no encaja con los demás.",
    "Edit details": "Editar datos",
    "Call": "Llamar",
    "Text": "Mensaje",
    "Map": "Mapa",
    "Next:": "Siguiente:",
    "Fix a name, number or address any time. Changes are saved to the job history.": "Corrija un nombre, número o dirección cuando quiera. Los cambios quedan en el historial del trabajo.",
    "Street address": "Dirección de la calle",
    "No contact details yet. Tap Edit details to add them.": "Todavía no hay datos de contacto. Toque Editar datos para agregarlos.",
    "1. Tell me about the job": "1. Cuénteme del trabajo",
    "What kind of job is it?": "¿Qué tipo de trabajo es?",
    "Tell me about it. Type it, or tap the mic and talk.": "Cuénteme. Escríbalo, o toque el micrófono y hable.",
    "Example: Two bedrooms and the hall. Walls are in good shape. Customer wants it done before Thanksgiving.": "Ejemplo: Dos recámaras y el pasillo. Las paredes están en buen estado. El cliente lo quiere terminado antes de Acción de Gracias.",
    "Speak your notes": "Diga sus notas",
    "This is a new lead. Tell me about the job below, then tap Create estimate.": "Este es un cliente potencial nuevo. Cuénteme del trabajo abajo y luego toque Crear presupuesto.",
    "Contract stage. Record the deposit when it arrives, then add the job to the calendar.": "Etapa de contrato. Registre el depósito cuando llegue y luego agregue el trabajo al calendario.",
    "Scheduled. Record the deposit if you have not, and make crew instructions and a materials list.": "Programado. Registre el depósito si no lo ha hecho, y prepare las instrucciones para el equipo y la lista de materiales.",
    "Final walkthrough. Finish the punch list, then build the invoice.": "Revisión final. Termine la lista de pendientes y luego cree la factura.",
    "Invoice sent. Record payments as they come in. When it is paid the job closes, and you can send the warranty.": "Factura enviada. Registre los pagos conforme lleguen. Cuando se pague, el trabajo se cierra y puede enviar la garantía.",
    "This job is done. Send the warranty certificate and save what you learned.": "Este trabajo está terminado. Envíe el certificado de garantía y guarde lo que aprendió.",
    "Photos and files": "Fotos y archivos",
    "Storage": "Almacenamiento",
    "Take or add photos": "Tomar o agregar fotos",
    "Tap a photo's": "Toque el botón",
    "Analyze": "Analizar",
    "button to have the AI look for possible issues. Receipts go in": "de una foto para que la IA busque posibles problemas. Los recibos van en",
    ", where they are read and filed as expenses.": ", donde se leen y se archivan como gastos.",
    "photo": "foto",
    "Analyze photo": "Analizar foto",
    "removed from storage": "quitado del almacenamiento",
    "No photos or files yet.": "Todavía no hay fotos ni archivos.",
    "Photos are shrunk on your phone before upload to save space. Your customer can also add photos from their portal link. You can download a photo any time.": "Las fotos se reducen en su teléfono antes de subirlas para ahorrar espacio. Su cliente también puede agregar fotos desde su enlace del portal. Puede descargar una foto cuando quiera.",
    "Approved findings": "Hallazgos aprobados",
    "high": "alto",
    "medium": "medio",
    "low": "bajo",
    "How to fix:": "Cómo arreglarlo:",
    "Labor:": "Mano de obra:",
    "Materials:": "Materiales:",
    "Add your hourly rate in Estimating Setup to see a suggested charge.": "Agregue su tarifa por hora en Configuración de presupuestos para ver un cobro sugerido.",
    "Possible issues to check, not a diagnosis. Prices are rough: check them before you quote.": "Posibles problemas por revisar, no es un diagnóstico. Los precios son aproximados: revíselos antes de cotizar.",
    "Make a work order from this": "Crear una orden de trabajo con esto",
    "What should I know about the photos?": "¿Qué debo saber de las fotos?",
    "Example: Water stain on the bedroom ceiling. Peeling paint on the north wall.": "Ejemplo: Mancha de agua en el techo de la recámara. Pintura descascarada en la pared norte.",
    "Create estimate": "Crear presupuesto",
    "I write the scope and work out the quantities from what you told me. Your own price list sets the prices, and you can change anything before it goes out.": "Yo escribo el alcance y calculo las cantidades con lo que me contó. Su propia lista de precios fija los precios, y usted puede cambiar lo que quiera antes de enviarlo.",
    "Tap Create estimate above and I will write this for you, or type your own.": "Toque Crear presupuesto arriba y yo lo escribo por usted, o escriba el suyo.",
    "Measurements and quantities (optional)": "Medidas y cantidades (opcional)",
    "Recalculate estimate and save": "Recalcular presupuesto y guardar",
    "Send estimate to customer": "Enviar presupuesto al cliente",
    "Get a second opinion on my price": "Pedir una segunda opinión sobre mi precio",
    "More estimate options (what is included, payment schedule, discount, tax)": "Más opciones del presupuesto (qué incluye, calendario de pagos, descuento, impuesto)",
    "Add an email address in Edit details above to send it from here.": "Agregue un correo electrónico en Editar datos arriba para enviarlo desde aquí.",
    "Ask for help (Job assistant and Quote helper)": "Pedir ayuda (Asistente de trabajos y Ayudante de cotizaciones)",
    "Photo questions, step-by-step plans, a second opinion on your price": "Preguntas con fotos, planes paso a paso, una segunda opinión sobre su precio",
    "Quick answer": "Respuesta rápida",
    "Quote helper": "Ayudante de cotizaciones",
    "Detailed": "Detallada",
    "Deep step-by-step": "Paso a paso a fondo",
    "My own price for this job, the steps, and a check against your prices": "Mi propio precio para este trabajo, los pasos y una comparación con sus precios",
    "More explanation and options": "Más explicación y opciones",
    "A long step-by-step plan for tough problems": "Un plan largo paso a paso para problemas difíciles",
    "Take or attach a photo to ask about": "Tome o adjunte una foto para preguntar",
    "Ask the assistant": "Preguntar al asistente",
    "It is saved on this job.": "Queda guardado en este trabajo.",
    "Quote helper answers use your monthly Quote helper allowance (it builds its own price, so it is a good second opinion on your estimate).": "Las respuestas del Ayudante de cotizaciones usan su cupo mensual de ese ayudante (arma su propio precio, así que es una buena segunda opinión sobre su presupuesto).",
    "Detailed step-by-step answers use your monthly detailed answers.": "Las respuestas detalladas paso a paso usan sus respuestas detalladas del mes.",
    "On a job, the assistant sees the estimate, documents and notes, but never the customer email, phone or street address.": "En un trabajo, el asistente ve el presupuesto, los documentos y las notas, pero nunca el correo, el teléfono ni la dirección del cliente.",
    "After the customer says yes": "Después de que el cliente dice que sí",
    "Deposit, contract, schedule, crew, and changes the customer asks for.": "Depósito, contrato, calendario, equipo y los cambios que pide el cliente.",
    "Deposit and payments": "Depósito y pagos",
    "Customer portal link": "Enlace del portal del cliente",
    "When the work is done": "Cuando termina el trabajo",
    "Final walkthrough, invoice, and the warranty after the invoice is paid.": "Revisión final, factura y la garantía después de pagar la factura.",
    "Warranty": "Garantía",
    "Best after the invoice is paid": "Mejor después de pagar la factura",
    "Keep on record": "Para sus registros",
    "Insurance and protecting this job": "Seguro y cómo proteger este trabajo",
    "Lost this job?": "¿Perdió este trabajo?",
    "Why did you lose it?": "¿Por qué lo perdió?",
    "Not started": "Sin empezar",
    "Saved as a draft": "Guardado como borrador",
    "Sent to the customer": "Enviado al cliente",
    "Paid in full": "Pagado completo",
    "Nothing paid yet": "Todavía no hay pagos",
    "Signed": "Firmado",
    "Approved": "Aprobado",
    "Job total": "Total del trabajo",
    "Balance due": "Saldo pendiente",
    "Deposit": "Depósito",
    "Progress payment": "Pago de avance",
    "Final payment": "Pago final",
    "Payment": "Pago",
    "Bank deposit (ACH or wire)": "Depósito bancario (ACH o transferencia)",
    "Card (taken outside PaintersMax)": "Tarjeta (cobrada fuera de PaintersMax)",
    "Date it was paid": "Fecha en que se pagó",
    "How did they pay?": "¿Cómo pagaron?",
    "What was it for?": "¿Para qué fue?",
    "Check number, or last 4 digits": "Número de cheque, o últimos 4 dígitos",
    "(optional)": "(opcional)",
    "Note": "Nota",
    "Please never type a full bank or card number here. PaintersMax does not store them.": "Por favor nunca escriba aquí un número completo de cuenta o de tarjeta. PaintersMax no los guarda.",
    "How to pay me": "Cómo pagarme",
    "(prints on your invoices)": "(se imprime en sus facturas)",
    "Tell customers how to pay you. Example: \"Zelle to 555-123-4567. CashApp $TylerPainters. Checks payable to Tyler Painters, 123 Main St.\" You decide what goes here. PaintersMax never asks for or stores bank account numbers.": "Dígales a sus clientes cómo pagarle. Ejemplo: \"Zelle al 555-123-4567. CashApp $TylerPainters. Cheques a nombre de Tyler Painters, 123 Main St.\" Usted decide qué escribir aquí. PaintersMax nunca pide ni guarda números de cuenta bancaria.",
    "Save an estimate to see what is owed.": "Guarde un presupuesto para ver lo que se debe.",
    "+ Record a payment": "+ Registrar un pago",
    "Nothing paid yet. When the customer pays you, record it here so your balance stays right.": "Todavía no hay pagos. Cuando el cliente le pague, regístrelo aquí para que su saldo sea correcto.",
    "When the customer says yes, your deposit is": "Cuando el cliente diga que sí, su depósito es",
    "The customer signed. your deposit is": "El cliente firmó. Su depósito es",
    ". When it arrives, record it here and I will keep track. Then add the job to the": ". Cuando llegue, regístrelo aquí y yo llevo la cuenta. Luego agregue el trabajo al",
    "Example: 1042": "Ejemplo: 1042",
    "Example: paid at the door": "Ejemplo: pagó en la puerta",
    "Example: Repair and repaint rotted fascia": "Ejemplo: Reparar y volver a pintar la tabla de alero podrida",
    "Example: Zelle to 555-123-4567. Checks payable to Tyler Painters.": "Ejemplo: Zelle al 555-123-4567. Cheques a nombre de Tyler Painters.",
    "Example: damage from floods, abuse or normal wear": "Ejemplo: daños por inundaciones, abuso o desgaste normal",
    "Uses the price from your saved estimate. The amount already paid comes from the payments you recorded above.": "Usa el precio de su presupuesto guardado. El monto ya pagado sale de los pagos que registró arriba.",
    "Notes (thank you, anything else)": "Notas (agradecimiento, cualquier otra cosa)",
    "(prints on the invoice, saved for next time)": "(se imprime en la factura y se guarda para la próxima vez)",
    "Type how you like to be paid. Never put a bank account number here unless you choose to.": "Escriba cómo le gusta que le paguen. Nunca ponga aquí un número de cuenta bancaria a menos que usted lo decida.",
    "This invoice is locked.": "Esta factura está bloqueada.",
    "The customer already has it, so it stays exactly as sent.": "El cliente ya la tiene, así que queda exactamente como se envió.",
    "You can view it or email it again.": "Puede verla o enviarla otra vez por correo.",
    "To change something, tap": "Para cambiar algo, toque",
    "Create corrected invoice": "Crear factura corregida",
    ". The original stays on record.": ". El original queda en sus registros.",
    "Warranty letter": "Carta de garantía",
    "Classic": "Clásico",
    "Modern": "Moderno",
    "Badge": "Insignia",
    "Ends": "Termina",
    "· sent to the customer.": "· enviado al cliente.",
    "· draft.": "· borrador.",
    "Expenses, mileage and receipts for this job are kept in": "Los gastos, millas y recibos de este trabajo se guardan en",
    ". Your full job file (photos and documents in one download) is in Records, under Download.": ". El archivo completo del trabajo (fotos y documentos en una descarga) está en Registros, en Descargar.",
    "note": "nota",
    "payment": "pago",
    "warranty": "garantía",
    "change_order": "orden de cambio",
    "issue": "problema",
    "stage": "etapa",
    "Reopened after being marked lost.": "Reabierto después de marcarse como perdido.",
    "Here is what I did": "Esto es lo que hice",
    "and your next estimates will price themselves.": "y sus próximos presupuestos se calcularán solos.",
    "Not sure about the total? Tap \"Get a second opinion on my price\". The Quote helper builds its own price without your price list, then compares the two and coaches you if you have been bidding too low or too high.": "¿No está seguro del total? Toque \"Pedir una segunda opinión sobre mi precio\". El Ayudante de cotizaciones arma su propio precio sin su lista de precios, compara los dos y le da consejos si ha estado cotizando muy bajo o muy alto.",
    "Check the information": "Revise la información",
    "Send this estimate": "Enviar este presupuesto",
    "Send this contract": "Enviar este contrato",
    "Send this invoice": "Enviar esta factura",
    "Take a quick look. This is what the customer will see, and it is hard to take back once it goes out.": "Échele un vistazo. Esto es lo que verá el cliente, y es difícil deshacerlo una vez que sale.",
    "(none)": "(ninguno)",
    "Estimate total": "Total del presupuesto",
    "Looks right, send it": "Está bien, enviar",
    "Fix something": "Corregir algo",
    "Built from your saved estimate": "Creado a partir de su presupuesto guardado",
    "Document": "Documento",
    "(next number)": "(siguiente número)",
    "Amount already paid": "Monto ya pagado",
    "Add to Google Calendar": "Agregar a Google Calendar",
    "to": "a",
    "Pick a start date.": "Elija una fecha de inicio.",
    "Crew hours (CSV)": "Horas del equipo (CSV)",
    "Crew payments (CSV)": "Pagos al equipo (CSV)",
    "Download one job's file": "Descargar el archivo de un trabajo",
    "A single ZIP with everything about one job: photos, receipts, documents, change orders, crew hours, expenses, mileage, warranty and your private chat.": "Un solo ZIP con todo sobre un trabajo: fotos, recibos, documentos, órdenes de cambio, horas del equipo, gastos, millas, garantía y su chat privado.",
    "Which job?": "¿Cuál trabajo?",
    "Download this job (ZIP)": "Descargar este trabajo (ZIP)",
    "No jobs yet.": "Todavía no hay trabajos.",
    "Your files stay safe here, and you can download them any time.": "Sus archivos están seguros aquí, y puede descargarlos cuando quiera.",
    "We could not find that page": "No encontramos esa página",
    "It may have moved, or the link may be old or mistyped. No harm done. Pick up where you left off:": "Puede que se haya movido, o que el enlace sea viejo o tenga un error. No pasa nada. Siga donde se quedó:",
    "Go to Home": "Ir a Inicio",
    "PaintersMax website": "Sitio web de PaintersMax",
    "Got here from a link your painter sent you? It may have expired. Ask them to send you a new one.": "¿Llegó aquí por un enlace que le mandó su pintor? Puede que haya vencido. Pídale que le mande uno nuevo.",
    "If you pay for paint, fuel and supplies with a business debit card, credit card or bank account, your bank already keeps a list of every purchase. Instead of typing each one, give us that list and we turn it into expenses. You look over the list first, and nothing is saved until you say so.": "Si paga la pintura, el combustible y los materiales con una tarjeta de débito o crédito del negocio o con una cuenta bancaria, su banco ya guarda una lista de cada compra. En lugar de escribirlas una por una, denos esa lista y la convertimos en gastos. Usted revisa la lista primero, y no se guarda nada hasta que usted lo diga.",
    "Pick whichever is easiest for you": "Elija lo que le resulte más fácil",
    "A spreadsheet file (best).": "Un archivo de hoja de cálculo (lo mejor).",
    "On your bank or card website, open your account and look for Transactions or Activity, then Download or Export. Choose CSV (some banks call it Excel or spreadsheet). One month at a time works best.": "En el sitio de su banco o tarjeta, abra su cuenta y busque Transacciones o Actividad, y luego Descargar o Exportar. Elija CSV (algunos bancos le dicen Excel u hoja de cálculo). Un mes a la vez funciona mejor.",
    "A QFX, OFX or QBO file.": "Un archivo QFX, OFX o QBO.",
    "The same Download page often offers these (they are the Quicken and QuickBooks kinds). We read them too.": "La misma página de descarga muchas veces los ofrece (son los tipos de Quicken y QuickBooks). Nosotros también los leemos.",
    "No download button? Use your statement.": "¿No hay botón de descarga? Use su estado de cuenta.",
    "Choose the PDF statement your bank sends every month, or a screenshot of your transaction list from your phone. Our AI reader pulls out the purchases for you.": "Elija el estado de cuenta en PDF que su banco le manda cada mes, o una captura de pantalla de su lista de transacciones en el teléfono. Nuestro lector de IA saca las compras por usted.",
    "We do not keep the file or your account number, only the expenses you check. A PDF or screenshot is sent to our AI reader to read and is not saved.": "No guardamos el archivo ni su número de cuenta, solo los gastos que usted confirme. Un PDF o una captura se envía a nuestro lector de IA para leerse y no se guarda.",
    "I cannot find the download button. Is that normal?": "No encuentro el botón de descarga. ¿Es normal?",
    "Yes, it is common. Most banks and card companies let you download your transactions, but the button is in a different place at each one, and a few small banks and credit unions only offer PDF statements. PDFs are made for printing, which is why a downloaded list works best, but our AI reader can handle a PDF when there is no other way.": "Sí, es común. La mayoría de los bancos y compañías de tarjetas permiten descargar las transacciones, pero el botón está en un lugar distinto en cada uno, y algunos bancos pequeños y cooperativas de crédito solo ofrecen estados de cuenta en PDF. Los PDF están hechos para imprimirse, por eso una lista descargada funciona mejor, pero nuestro lector de IA puede leer un PDF cuando no hay otra forma.",
    "If you cannot find it, call or message your bank and ask: \"How do I export my transactions to a CSV or Excel file?\" They answer this all day. Then come back here.": "Si no lo encuentra, llame o escriba a su banco y pregunte: \"¿Cómo exporto mis transacciones a un archivo CSV o de Excel?\" Lo responden todo el día. Luego regrese aquí.",
    "What should a spreadsheet file look like?": "¿Cómo debe verse un archivo de hoja de cálculo?"
  }, [
    [/^\((\d+) statement reads? left this month\)$/, function (a, n) { return '(' + n + (n === '1' ? ' lectura de estado de cuenta restante' : ' lecturas de estado de cuenta restantes') + ' este mes)'; }],
    [/^No address yet · (.+)$/, function (a, t) { return 'Sin dirección todavía · ' + x(t); }],
    [/^You started an estimate\. Review it, then send it to (.+)\.$/, function (a, n) { return 'Empezó un presupuesto. Revíselo y luego envíeselo a ' + n + '.'; }],
    [/^Estimate sent\. Waiting for (.+) to approve it\. A friendly call or text often helps\.$/, function (a, n) { return 'Presupuesto enviado. Esperando que ' + n + ' lo apruebe. Una llamada o un mensaje amable muchas veces ayuda.'; }],
    [/^Your estimate is saved\. Send it to (.+) when it looks right\.$/, function (a, n) { return 'Su presupuesto está guardado. Envíeselo a ' + n + ' cuando esté bien.'; }],
    [/^Work in progress\. If (.+) asks for something extra, make a change order so the price stays right\.$/, function (a, n) { return 'Trabajo en curso. Si ' + n + ' pide algo extra, haga una orden de cambio para que el precio siga correcto.'; }],
    [/^(\d+)% used$/, function (a, n) { return n + '% usado'; }],
    [/^(\d+) photo analys[ei]s left this month \((\d+) of (\d+) used\)\.$/, function (a, n, u, t) { return 'Quedan ' + n + ' análisis de fotos este mes (se usaron ' + u + ' de ' + t + ').'; }],
    [/^about ([\d.]+) hr( ·)?$/, function (a, h, d) { return 'unas ' + h + ' h' + (d || ''); }],
    [/^Using your (.+) prices\. Enter how many of each, and I will fill the lines from your price list\. Leave blank for none\.$/, function (a, t) { return 'Usando sus precios de ' + x(t) + '. Anote cuántos de cada uno y yo lleno las líneas con su lista de precios. Déjelo en blanco si no hay.'; }],
    [/^(\$[\d,]+\.\d\d) · (draft|sent|signed|approved|declined)$/, function (a, m, s) { return m + ' · ' + ({ draft: 'borrador', sent: 'enviado', signed: 'firmado', approved: 'aprobado', declined: 'rechazado' })[s]; }],
    [/^(\$[\d,]+\.\d\d) paid, (\$[\d,]+\.\d\d) to go$/, function (a, p, b) { return p + ' pagado, faltan ' + b; }],
    [/^\(estimate (\$[\d,]+\.\d\d) plus approved changes (\$[\d,]+\.\d\d)\)$/, function (a, e, c) { return '(presupuesto ' + e + ' más cambios aprobados ' + c + ')'; }],
    [/^\((\$[\d,]+\.\d\d) more than the total\. Check the amounts\.\)$/, function (a, m) { return '(' + m + ' más que el total. Revise los montos.)'; }],
    [/^Record the (\$[\d,]+\.\d\d) deposit$/, function (a, m) { return 'Registrar el depósito de ' + m; }],
    [/^(.*\d{4}) · (Cash|Check|Zelle|CashApp|Venmo|PayPal|Bank deposit \(ACH or wire\)|Card \(taken outside PaintersMax\)|Other)( · .*)?$/, function (a, d, m, r) { return d + ' · ' + x(m) + (r || ''); }],
    [/^Subtotal (\$[\d,]+\.\d\d)$/, function (a, m) { return 'Subtotal ' + m; }],
    [/^Total (\$[\d,]+\.\d\d)$/, function (a, m) { return 'Total ' + m; }],
    [/^Discount -(\$[\d,]+\.\d\d)$/, function (a, m) { return 'Descuento -' + m; }],
    [/^Tax (\$[\d,]+\.\d\d)$/, function (a, m) { return 'Impuesto ' + m; }],
    [/^I priced (\d+) items? from your own price list, as a starting point only\. Check the quantities and change any price that does not fit this job, then tap Create final estimate\.$/, function (a, n) { return 'Puse precio a ' + n + (n === '1' ? ' partida' : ' partidas') + ' con su propia lista de precios, solo como punto de partida. Revise las cantidades y cambie cualquier precio que no encaje con este trabajo, y luego toque Crear presupuesto final.'; }],
    [/^(\d+) lines? needs? your price \(marked in orange\)\. I never guess your prices\.$/, function (a, n) { return (n === '1' ? '1 línea necesita' : n + ' líneas necesitan') + ' su precio (marcada en naranja). Yo nunca adivino sus precios.'; }],
    [/^I made these assumptions\. Please confirm them: (.*)\.$/, function (a, t) { return 'Hice estas suposiciones. Por favor confírmelas: ' + t + '.'; }],
    [/^Good questions to ask (.+) before you send:$/, function (a, n) { return 'Buenas preguntas para hacerle a ' + n + ' antes de enviar:'; }],
    [/^Email this to (.+)$/, function (a, n) { return 'Enviar esto por correo a ' + n; }],
    [/^Job type set to (.+)\.$/, function (a, t) { return 'Tipo de trabajo cambiado a ' + x(t) + '.'; }],
    [/^Details changed: (.+)\.$/, function (a, l) { var m = { 'customer name': 'nombre del cliente', 'job title': 'título del trabajo', 'email': 'correo', 'phone': 'teléfono', 'address': 'dirección' }; return 'Datos cambiados: ' + l.split(', ').map(function (k) { return m[k] || k; }).join(', ') + '.'; }],
    [/^Payment received: (\$[\d,]+\.\d\d) by (.+)$/, function (a, m, r) { return 'Pago recibido: ' + m + ' por ' + r.replace(/\bcheck\b/, 'cheque').replace(/\bcash\b/, 'efectivo').replace(/\(deposit\)/, '(depósito)').replace(/\(progress\)/, '(avance)').replace(/\(final\)/, '(final)'); }],
    [/^Marked lost: (.+)\.$/, function (a, t) { var m = { 'Price': 'Precio', 'Timing': 'Tiempo', 'No reply': 'Sin respuesta', 'Chose someone else': 'Eligió a otro', 'Other': 'Otro' }; var h = t.match(/^([^(]+?)( \(.*\))?$/); return 'Marcado como perdido: ' + (m[h[1]] || h[1]) + (h[2] || '') + '.'; }],
    [/^Warranty certificate sent to the customer\. Ends (\S+)\.$/, function (a, d) { return 'Certificado de garantía enviado al cliente. Termina el ' + (window.pmDate ? window.pmDate(d) : d) + '.'; }],
    [/^Warranty certificate drafted \((\d+) months?\)\.$/, function (a, n) { return 'Certificado de garantía preparado (' + n + ' meses).'; }],
    [/^(\d+) change orders? (?:was|were) logged on this job\. Add any extra cost to the invoice notes or estimate, because the price below comes only from the saved estimate\.$/, function (a, n) { return (n === '1' ? 'Se registró 1 orden de cambio' : 'Se registraron ' + n + ' órdenes de cambio') + ' en este trabajo. Agregue cualquier costo extra a las notas de la factura o al presupuesto, porque el precio de abajo viene solo del presupuesto guardado.'; }],
  ]);

  /* ---- Part 11b: job history lines and small leftovers ---- */
  pmI18n.add({
    "added to this job.": "agregadas a este trabajo.",
    "(Your prices), or add lines by hand.": "(Sus precios), o agregue líneas a mano.",
    "Job created in the Wizard.": "Trabajo creado en el Asistente.",
  }, [
    [/^Approved change orders: (\$[\d,]+\.\d\d)$/, function (a, m) { return 'Órdenes de cambio aprobadas: ' + m; }],
    [/^Open my library \((\d+)\)$/, function (a, n) { return 'Abrir mi biblioteca (' + n + ')'; }],
    [/^Photo findings approved: (.*)$/, function (a, t) { return 'Hallazgos de fotos aprobados: ' + t; }],
    [/^(WO|CO)-(\d+) (drafted|sent to the customer|approved by .+|declined by .+): (.*)$/, function (a, k, n, st, t) { var w = k === 'WO' ? 'Orden de trabajo' : 'Orden de cambio'; var e = st === 'drafted' ? 'preparada' : st === 'sent to the customer' ? 'enviada al cliente' : st.indexOf('approved by ') === 0 ? 'aprobada por ' + st.slice(12) : 'rechazada por ' + st.slice(12); return w + ' ' + k + '-' + n + ' ' + e + ': ' + t; }],
  ]);

  /* ---- Part 12: pricing levels, Review page, final estimate steps, photo reading, builder price list ---- */
  pmI18n.add({
    "Master": "Maestro", "Residential": "Residencial",
    "Master:": "Maestro:",
    " the top of the market. You are the painter people ask for by name: flawless prep and finish, fine craftsmanship, full protection of the home and a strong reputation. Master starts about a quarter above Premium, and you can change every number.": " lo más alto del mercado. Usted es el pintor que la gente pide por nombre: preparación y acabado impecables, artesanía fina, protección total de la casa y una gran reputación. Maestro empieza como una cuarta parte por encima de Premium, y usted puede cambiar cada número.",
    "Each service explains its own levels in plain words under the buttons. Power washing has three levels instead of four: Value, Residential and Commercial.": "Cada servicio explica sus propios niveles en palabras sencillas debajo de los botones. El lavado a presión tiene tres niveles en lugar de cuatro: Económico, Residencial y Comercial.",
    "We moved this card to the new itemized price list. The prices you typed before are saved safely, so nothing was lost.": "Movimos esta tarjeta a la nueva lista de precios detallada. Los precios que escribió antes están guardados, así que no se perdió nada.",
    "Pick a level above (Value, Standard, Premium or Master) to fill in starting prices. You can change every number.": "Elija un nivel arriba (Económico, Estándar, Premium o Maestro) para llenar los precios iniciales. Puede cambiar cada número.",
    /* level help lines */
    "Win jobs on price. A fit if you are newer, building reviews, or your area is price-sensitive.": "Gane trabajos por precio. Sirve si es nuevo, está formando reseñas o su zona es sensible al precio.",
    "A fair rate for a solid local painter with steady work and good reviews. Most painters start here.": "Una tarifa justa para un pintor local sólido con trabajo constante y buenas reseñas. La mayoría de los pintores empieza aquí.",
    "Careful prep, clean lines, a tidy crew and strong reviews.": "Preparación cuidadosa, líneas limpias, una cuadrilla ordenada y buenas reseñas.",
    "Master painter pricing: flawless walls, fine trim work, full protection of the home and a reputation customers recommend.": "Precios de pintor maestro: paredes impecables, molduras bien terminadas, protección total de la casa y una reputación que los clientes recomiendan.",
    "Basic wash and prep, standard paint, quick turnaround.": "Lavado y preparación básicos, pintura estándar, entrega rápida.",
    "Good prep, scraping and caulking, two coats of quality paint.": "Buena preparación, raspado y sellado, dos manos de pintura de calidad.",
    "Thorough prep, premium paint and careful detail work on trim and wood repair.": "Preparación a fondo, pintura premium y cuidado en los detalles de molduras y reparación de madera.",
    "Master craftsmanship: complete prep, top paints, wood repair, a clean site and a long warranty.": "Trabajo de maestro: preparación completa, las mejores pinturas, reparación de madera, obra limpia y una garantía larga.",
    "Competitive bids on easy jobs: open spaces, standard colors, no night work.": "Ofertas competitivas en trabajos fáciles: espacios abiertos, colores estándar, sin trabajo nocturno.",
    "A typical commercial bid with insurance, a schedule and a fair margin.": "Una oferta comercial típica con seguro, calendario y un margen justo.",
    "Larger or busier properties, tight schedules, documentation and reporting.": "Propiedades más grandes o con más movimiento, calendarios ajustados, documentación e informes.",
    "Top-tier commercial contractor: after-hours work, bonding, prevailing wage and premium coating systems.": "Contratista comercial de primer nivel: trabajo fuera de horario, fianza, salario vigente y sistemas de recubrimiento premium.",
    "Basic washing for small or easy jobs. The lowest market prices.": "Lavado básico para trabajos pequeños o fáciles. Los precios más bajos del mercado.",
    "Typical home work: houses, driveways, patios and decks.": "Trabajo típico de casas: casas, entradas de auto, patios y terrazas.",
    "Larger surfaces, strict schedules and the equipment and insurance business properties require.": "Superficies más grandes, calendarios estrictos y el equipo y seguro que exigen los negocios.",
    "Brush and roll finish with basic cleaning and sanding.": "Acabado a brocha y rodillo con limpieza y lijado básicos.",
    "Sprayed finish with good cleaning, sanding and primer.": "Acabado con pistola, con buena limpieza, lijado e imprimación.",
    "Factory-smooth sprayed finish with full prep and doors and drawers finished off the box.": "Acabado liso como de fábrica con pistola, preparación completa y puertas y cajones terminados fuera del gabinete.",
    "Furniture-grade finish, hardware, full protection of the kitchen and a strong warranty.": "Acabado de calidad de mueble fino, herrajes, protección total de la cocina y una garantía sólida.",
    "Wash and one coat of stain or paint.": "Lavado y una mano de tinte o pintura.",
    "Wash, sand the rough spots and two coats.": "Lavado, lijado de las partes ásperas y dos manos.",
    "Full prep, board repair and a premium stain.": "Preparación completa, reparación de tablas y un tinte premium.",
    "Restoration quality: stripping, brightening, repairs and a premium sealed finish.": "Calidad de restauración: decapado, aclarado, reparaciones y un acabado sellado premium.",
    "Thin single-coat floor coating with basic grinding.": "Recubrimiento delgado de una sola mano con pulido básico.",
    "Ground concrete with a full-solids epoxy system.": "Concreto pulido con un sistema epóxico de sólidos completos.",
    "A full flake or metallic system with a UV-stable topcoat.": "Un sistema completo de hojuelas o metálico con capa final estable a los rayos UV.",
    "Custom decorative floors, moisture control and the strongest warranty.": "Pisos decorativos a medida, control de humedad y la garantía más fuerte.",
    "Production-builder volume: the lowest price per home and a fast schedule.": "Volumen de constructor de producción: el precio más bajo por casa y un calendario rápido.",
    "Semi-custom builders and mid-size volume.": "Constructores semipersonalizados y volumen mediano.",
    "Higher-end builders who expect a finer finish and more detail.": "Constructores de gama alta que esperan un acabado más fino y más detalle.",
    "Custom home builders: the top finish, the closest supervision and the strongest warranty.": "Constructores de casas a medida: el mejor acabado, la supervisión más cercana y la garantía más fuerte.",
    "Quick patches and basic finishing.": "Parches rápidos y acabado básico.",
    "Clean patching, taping and sanding ready for paint.": "Parcheo limpio, cinta y lijado listos para pintar.",
    "Smooth finishes, texture matching and tight control of dust.": "Acabados lisos, textura igualada y control estricto del polvo.",
    "Invisible repairs, level 5 finishing and complete protection of the home.": "Reparaciones invisibles, acabado nivel 5 y protección completa de la casa.",
    "Basic pickets and posts, simple styles.": "Postes y tablas básicos, estilos sencillos.",
    "Solid privacy fence with treated lumber.": "Cerca de privacidad sólida con madera tratada.",
    "Better lumber, stronger posts and cleaner detail.": "Mejor madera, postes más fuertes y detalles más limpios.",
    "Custom designs, premium materials and a long warranty.": "Diseños a medida, materiales premium y una garantía larga.",
    "Cosmetic updates and simple repairs.": "Mejoras cosméticas y reparaciones sencillas.",
    "Typical room refresh with solid materials.": "Renovación típica de una habitación con materiales sólidos.",
    "Higher-grade materials and careful finish carpentry.": "Materiales de mayor calidad y carpintería de acabado cuidadosa.",
    "Custom work, top materials and a master craftsman's detail.": "Trabajo a medida, los mejores materiales y el detalle de un maestro artesano.",
    "Basic coatings and light prep.": "Recubrimientos básicos y preparación ligera.",
    "A standard industrial coating system with proper prep.": "Un sistema de recubrimiento industrial estándar con la preparación adecuada.",
    "High-performance systems and detailed surface prep.": "Sistemas de alto rendimiento y preparación detallada de superficies.",
    "Specialty systems, documented prep and inspection, with the strongest warranty.": "Sistemas especiales, preparación e inspección documentadas, con la garantía más fuerte.",
    /* Review page */
    "Everything you set up, on one page. Tap any box to change it. You can come back any time.": "Todo lo que configuró, en una sola página. Toque cualquier recuadro para cambiarlo. Puede volver en cualquier momento.",
    "Your services": "Sus servicios", "Labor, money and warranty": "Mano de obra, dinero y garantía", "Rate cards and sheets": "Tarifarios y hojas de tarifas",
    "Your rate card": "Su tarifario", "A branded PDF of your prices to share.": "Un PDF con su marca con sus precios para compartir.",
    "A private price sheet for each home builder.": "Una hoja de precios privada para cada constructor.",
    "On the Basic and Pro plans.": "En los planes Basic y Pro.",
    "Crew": "Cuadrilla", "Hourly rate": "Tarifa por hora", "Deposit": "Depósito", "Labor warranty": "Garantía de mano de obra",
    "Not set. Tap to add.": "Sin definir. Toque para agregar.",
    "Add your company name": "Agregue el nombre de su empresa", "No phone or email yet": "Aún no hay teléfono ni correo",
    "Choose your services": "Elija sus servicios", "Nothing yet": "Nada todavía", "Prices not set": "Precios sin definir", "Your own prices": "Sus propios precios",
    "Your setup is saved. Tap the button below to go to your dashboard, or go straight to": "Su configuración está guardada. Toque el botón de abajo para ir a su panel, o vaya directo a",
    "to build your first estimate.": "para armar su primer presupuesto.",
    "Save and go to dashboard": "Guardar e ir al panel",
    "Download": "Descargar", "Open": "Abrir",
    /* final estimate steps */
    "Create the final estimate": "Cree el presupuesto final",
    "Adds up your lines and saves the customer's copy. You can come back and update it.": "Suma sus líneas y guarda la copia del cliente. Puede volver y actualizarlo.",
    "Create final estimate": "Crear presupuesto final", "Update final estimate": "Actualizar presupuesto final",
    "Check it, then send it": "Revíselo y luego envíelo",
    "Create the final estimate first. Then you can preview it and send it.": "Primero cree el presupuesto final. Luego podrá verlo y enviarlo.",
    "Add an email address in Edit details above to send it from here, or download the PDF.": "Agregue un correo en Editar datos arriba para enviarlo desde aquí, o descargue el PDF.",
    "Sent. If you change anything, update the estimate and send it again.": "Enviado. Si cambia algo, actualice el presupuesto y envíelo otra vez.",
    "Preview customer's copy": "Ver la copia del cliente",
    /* photo reading */
    "Before the AI looks": "Antes de que la IA mire",
    "What should it look at closely? Tick any that matter. The AI checks the whole photo either way, but this helps it notice windows, doors and trim, not only walls.": "¿Qué debe revisar con más cuidado? Marque lo que importe. La IA revisa toda la foto de todos modos, pero esto le ayuda a notar ventanas, puertas y molduras, no solo paredes.",
    "walls": "paredes", "ceiling": "techo", "trim and baseboards": "molduras y zócalos", "windows": "ventanas", "doors": "puertas", "floors": "pisos", "cabinets": "gabinetes", "siding and outside": "revestimiento y exterior", "fixtures and outlets": "luminarias y enchufes",
    "What should I know about this photo? (optional)": "¿Qué debo saber de esta foto? (opcional)",
    "Example: guest bedroom, the window leaked last spring.": "Ejemplo: cuarto de visitas, la ventana tuvo una filtración la primavera pasada.",
    "Analyze this photo": "Analizar esta foto", "Analyze again": "Analizar otra vez",
    "Tip: photos from different angles (each wall, the windows, the doors, the ceiling) give the best results. Photos that look alike get similar answers.": "Consejo: las fotos desde distintos ángulos (cada pared, las ventanas, las puertas, el techo) dan los mejores resultados. Las fotos parecidas reciben respuestas parecidas.",
    "✓ AI has read this photo": "✓ La IA ya leyó esta foto",
    "What the AI saw in this photo:": "Lo que la IA vio en esta foto:",
    /* builder rate sheets */
    "Start with your builder price list": "Empiece con su lista de precios para constructores",
    "A builder rate sheet is a private price list for a home builder or general contractor who sends you steady work. These prices are usually lower than what a homeowner pays, because you get the work all year.": "Una hoja de tarifas para constructores es una lista de precios privada para un constructor o contratista general que le da trabajo constante. Estos precios suelen ser más bajos que lo que paga un propietario, porque usted recibe trabajo todo el año.",
    "Step 1.": "Paso 1.", "Step 2.": "Paso 2.",
    " Tap the button to create your builder price list. We fill in starting prices for production, semi-custom and custom builders, and you can change any number later in": " Toque el botón para crear su lista de precios para constructores. Llenamos precios iniciales para constructores de producción, semipersonalizados y a medida, y puede cambiar cualquier número después en",
    " Make a sheet for each builder, with its own discount, its own link and a PDF you can send.": " Haga una hoja para cada constructor, con su propio descuento, su propio enlace y un PDF que puede enviar.",
    "Create my builder price list": "Crear mi lista de precios para constructores",
    "Your builder price list is ready. Make your first sheet below.": "Su lista de precios para constructores está lista. Haga su primera hoja abajo.",
    "Want to change the starting prices?": "¿Quiere cambiar los precios iniciales?",
    " and edit Builder rates on the Your prices step.": " y edite las tarifas para constructores en el paso Sus precios.",
  }, [
    [/^Where do you want to price\? (.+) is already filled in for you\.$/, function (a, n) { var m = { 'Value': 'Económico', 'Standard': 'Estándar', 'Premium': 'Premium', 'Master': 'Maestro', 'Residential': 'Residencial', 'Commercial': 'Comercial' }; return '¿Dónde quiere fijar sus precios? ' + (m[n] || n) + ' ya está llenado por usted.'; }],
    [/^(Value|Standard|Premium|Master|Residential|Commercial) pricing$/, function (a, n) { var m = { 'Value': 'Económico', 'Standard': 'Estándar', 'Premium': 'Premium', 'Master': 'Maestro', 'Residential': 'Residencial', 'Commercial': 'Comercial' }; return 'Precios ' + m[n]; }],
    [/^(\d+) (?:person|people)$/, function (a, n) { return n + (n === '1' ? ' persona' : ' personas'); }],
    [/^\$([\d,.]+) an hour$/, function (a, n) { return '$' + n + ' por hora'; }],
    [/^(\d+(?:\.\d+)?)% up front$/, function (a, n) { return n + '% por adelantado'; }],
    [/^(\d+) months$/, function (a, n) { return n + ' meses'; }],
    [/^Preview it the way (.+) will see it, then send it\.$/, function (a, n) { return 'Véalo como lo verá ' + n + ' y luego envíelo.'; }],
    [/^Send estimate to (.+)$/, function (a, n) { return 'Enviar presupuesto a ' + n; }],
    [/^Final estimate ready\. Total (\$[\d,]+\.\d\d)\. Preview it, then send it\.$/, function (a, m) { return 'Presupuesto final listo. Total ' + m + '. Véalo y luego envíelo.'; }],
  ]);

  /* ---- Part 13: Help page and guide ---- */
  pmI18n.add({
    "Help": "Ayuda", "Help - PaintersMax": "Ayuda - PaintersMax",
    "How can I help?": "¿Cómo puedo ayudarle?",
    "Ask a question in your own words, or browse the guide below. Answers come from the PaintersMax guide, so they match what you see on your screen.": "Haga una pregunta con sus propias palabras o explore la guía de abajo. Las respuestas salen de la guía de PaintersMax, así que coinciden con lo que ve en su pantalla.",
    "Ask": "Preguntar",
    "Example: How do I send an estimate to a customer?": "Ejemplo: ¿Cómo envío un presupuesto a un cliente?",
    "Your question": "Su pregunta",
    "How do I send an estimate to a customer?": "¿Cómo envío un presupuesto a un cliente?",
    "How do I change my prices?": "¿Cómo cambio mis precios?",
    "How do I add a crew member?": "¿Cómo agrego a un miembro del equipo?",
    "How do I download my records for my accountant?": "¿Cómo descargo mis registros para mi contador?",
    "If the guide does not cover your question, we save only the question, never your name or company, so we can add an answer. Nothing is added to the guide until the PaintersMax team reviews it.": "Si la guía no cubre su pregunta, guardamos solo la pregunta, nunca su nombre ni su empresa, para poder agregar una respuesta. Nada se agrega a la guía hasta que el equipo de PaintersMax lo revise.",
    "Browse the guide": "Explorar la guía",
    "Search the guide (free, no AI)": "Buscar en la guía (gratis, sin IA)",
    "Search the guide": "Buscar en la guía",
    "articles": "artículos",
    "Help questions this month": "Preguntas de ayuda este mes",
    "Browsing the guide is always free.": "Explorar la guía siempre es gratis.",
    "Looking through the guide...": "Buscando en la guía...",
    "From the guide": "De la guía",
    "That question is not in the guide yet. We saved it (without your name) so we can add an answer.": "Esa pregunta todavía no está en la guía. La guardamos (sin su nombre) para poder agregar una respuesta.",
    "Nothing matched. Try different words, or ask the question above.": "No hubo resultados. Pruebe otras palabras o haga la pregunta arriba.",
    "Back to the guide": "Volver a la guía",
    "Translated by AI from the English guide.": "Traducido por IA de la guía en inglés.",
    "Getting started": "Primeros pasos",
    "Prices and rate cards": "Precios y tarifas",
    "Jobs and estimates": "Trabajos y presupuestos",
    "Scheduling and finishing a job": "Programar y terminar un trabajo",
    "Invoices, payments and records": "Facturas, pagos y registros",
    "Insurance, cities and your account": "Seguro, ciudades y su cuenta",
    "Open Calendar": "Abrir Calendario", "Open City pages": "Abrir Páginas de ciudades", "Open Crew": "Abrir Equipo",
    "Open Estimating Setup": "Abrir Configuración de presupuestos", "Open Insurance": "Abrir Seguro", "Open Jobs": "Abrir Trabajos",
    "Open Records": "Abrir Registros", "Open Your prices": "Abrir Sus precios", "Open builder rate sheets": "Abrir tarifas para constructores",
    "Open the sign-in page": "Abrir la página de inicio de sesión",
    "Type your question first.": "Escriba primero su pregunta.",
    "Help chat is paused right now. Try again soon, or browse the guide.": "El chat de ayuda está en pausa. Intente de nuevo pronto o explore la guía.",
    "You have used this month's help questions. You can still browse the guide.": "Usó las preguntas de ayuda de este mes. Todavía puede explorar la guía.",
    "The help assistant could not answer right now. Nothing was used from your allowance. Try the guide below.": "El asistente de ayuda no pudo responder ahora. No se usó nada de su cupo. Pruebe la guía de abajo.",
    "Article not found.": "No se encontró el artículo.",
  }, []);

  /* ---- Part 14: Brand kit ---- */
  pmI18n.add({
    "Brand kit": "Kit de marca", "Brand kit - PaintersMax": "Kit de marca - PaintersMax",
    "Open Brand kit": "Abrir Kit de marca",
    "Your brand kit": "Su kit de marca",
    "Print-ready business cards, fliers and door hangers, and emails you can send, all filled in with your details. Nothing is claimed that you do not type or tick yourself.": "Tarjetas de presentación, volantes y colgadores de puerta listos para imprimir, y correos que puede enviar, todo llenado con sus datos. No se afirma nada que usted no escriba o marque.",
    "Your details (tap to change)": "Sus datos (toque para cambiar)",
    "Company name": "Nombre de la empresa", "Your name (on the card)": "Su nombre (en la tarjeta)", "Your title": "Su cargo",
    "Phone": "Teléfono", "Website": "Sitio web",
    "License number (leave empty if none)": "Número de licencia (déjelo vacío si no tiene)",
    "Tagline (one short line)": "Lema (una línea corta)", "Brand color": "Color de la marca",
    "Logo web address (optional)": "Dirección web del logotipo (opcional)",
    "A link to your logo image. Without one, your company name is printed instead.": "Un enlace a la imagen de su logotipo. Sin uno, se imprime el nombre de su empresa.",
    "Where the QR code goes": "A dónde lleva el código QR",
    "Starts as your quote page, so people can ask for an estimate by scanning.": "Empieza con su página de presupuestos, para que la gente pida un presupuesto al escanear.",
    "Language on printed pieces": "Idioma de las piezas impresas",
    "What you offer (one per line, up to 8)": "Lo que ofrece (uno por línea, hasta 8)",
    "Where you work": "Dónde trabaja",
    "We carry business insurance (prints \"Insured\")": "Tenemos seguro de negocio (imprime \"Asegurado\")",
    "We give free estimates (prints \"Free estimates\")": "Damos presupuestos gratis (imprime \"Presupuestos gratis\")",
    "You have an insurance policy on file. Tick the box above to show \"Insured\" on your printed pieces.": "Tiene una póliza de seguro registrada. Marque la casilla de arriba para mostrar \"Asegurado\" en sus piezas impresas.",
    "Your Google review link (optional, used in the thank-you email)": "Su enlace de reseñas de Google (opcional, se usa en el correo de agradecimiento)",
    "Save my details": "Guardar mis datos",
    "Business cards": "Tarjetas de presentación",
    "Pick a look. The back has a QR code that opens your quote page.": "Elija un estilo. El reverso tiene un código QR que abre su página de presupuestos.",
    "Classic": "Clásico", "Bold": "Atrevido", "Clean": "Limpio", "Dark": "Oscuro",
    "Business card preview": "Vista previa de la tarjeta",
    "Sheet of 10 (print at home or at a copy shop)": "Hoja de 10 (imprima en casa o en una copistería)",
    "Print-shop file (one card per page, with bleed)": "Archivo para imprenta (una tarjeta por página, con sangrado)",
    "Show light cut lines": "Mostrar líneas de corte suaves",
    "Open to print or save as PDF": "Abrir para imprimir o guardar como PDF",
    "Tip: perforated card stock such as Avery 5371 (10 cards per sheet) fits the sheet exactly. Turn cut lines off for it. Print at 100%, not \"Fit to page\".": "Consejo: el cartón perforado como Avery 5371 (10 tarjetas por hoja) encaja exacto con la hoja. Apague las líneas de corte. Imprima al 100%, no \"Ajustar a la página\".",
    "Saved.": "Guardado.",
    "Add your company name first.": "Primero agregue el nombre de su empresa.",
    "Your browser blocked the new window. Allow pop-ups for this site and try again.": "Su navegador bloqueó la ventana nueva. Permita las ventanas emergentes de este sitio e intente de nuevo.",
  }, []);

  pmI18n.add({
    "Emails": "Correos",
    "Pick a message, fill in the customer's first name, then copy it into your own email app. It goes out from your own address. PaintersMax does not send these.": "Elija un mensaje, escriba el nombre del cliente y cópielo en su propia app de correo. Sale desde su propia dirección. PaintersMax no envía estos correos.",
    "Estimate follow-up": "Seguimiento de presupuesto", "Thank you and review request": "Agradecimiento y petición de reseña", "Checking in with a past customer": "Saludo a un cliente anterior",
    "Customer's first name": "Nombre del cliente", "The project": "El proyecto", "Example: your kitchen cabinets": "Ejemplo: los gabinetes de su cocina",
    "An extra line (optional)": "Una línea extra (opcional)",
    "Example: Book before March 15 and ask about our spring schedule.": "Ejemplo: Reserve antes del 15 de marzo y pregunte por nuestra agenda de primavera.",
    "Subject": "Asunto", "Message (you can edit it)": "Mensaje (puede editarlo)",
    "Changing the name, project or extra line writes a fresh message and replaces your edits.": "Cambiar el nombre, el proyecto o la línea extra escribe un mensaje nuevo y reemplaza sus ediciones.",
    "Copy formatted email": "Copiar correo con formato", "Copy plain text": "Copiar texto sin formato", "Copy subject": "Copiar asunto", "Open in my email app": "Abrir en mi app de correo",
    "Formatted preview": "Vista previa con formato", "Email preview": "Vista previa del correo",
    "Copied. Paste it into your email.": "Copiado. Péguelo en su correo.", "Subject copied.": "Asunto copiado.",
    "Copied with your colors and layout. Paste it into your email.": "Copiado con sus colores y diseño. Péguelo en su correo.",
    "Your browser would not copy. Use Copy plain text instead.": "Su navegador no pudo copiar. Use Copiar texto sin formato.",
    "Your browser would not copy. Select the text and copy it yourself.": "Su navegador no pudo copiar. Seleccione el texto y cópielo usted.",
  }, []);

  pmI18n.add({
    "Heritage": "Tradicional", "Minimal": "Minimalista",
    "Fliers": "Volantes", "Door hangers": "Colgadores de puerta",
    "Your words": "Sus palabras",
    "Leave any box empty and a plain starting line is used. An offer only prints if you type one.": "Deje vacía cualquier casilla y se usa una línea sencilla de inicio. Una oferta solo se imprime si usted la escribe.",
    "Headline": "Titular", "Example: Give your home a fresh new look": "Ejemplo: Dele a su casa un aspecto nuevo",
    "Line under the headline": "Línea debajo del titular", "Example: Interior and exterior painting": "Ejemplo: Pintura interior y exterior",
    "Offer (optional)": "Oferta (opcional)", "Example: 10% off for neighbors this month": "Ejemplo: 10% de descuento para vecinos este mes",
    "Good to know (one per line, up to 4, optional)": "Es bueno saber (uno por línea, hasta 4, opcional)", "Example: Same crew from start to finish": "Ejemplo: El mismo equipo de principio a fin",
    "Street where you are working now (for the neighborhood pieces)": "Calle donde está trabajando ahora (para las piezas de vecindario)", "Example: Maple Street": "Ejemplo: Calle Maple",
    "One Letter-size page. Pick a look and check the preview.": "Una página tamaño Carta. Elija un estilo y revise la vista previa.",
    "Flier preview": "Vista previa del volante", "Door hanger preview": "Vista previa del colgador",
    "3.5 x 8.5 in. Three fit on one landscape Letter page.": "3.5 x 8.5 pulgadas. Caben tres en una página Carta horizontal.",
    "In your neighborhood": "En su vecindario",
    "We are painting nearby": "Estamos pintando cerca", "Sorry we missed you": "Lamentamos no encontrarle", "Free estimate": "Presupuesto gratis",
  }, []);

  /* ---- Part 15: Job workflow (change orders on the invoice, Start the job, site visits, sign-off, due dates) ---- */
  pmI18n.add({
    "Start the job": "Iniciar el trabajo", "Start": "Inicio", "Visit": "Visita", "Sign-off": "Aceptación",
    "Job started. It is now in progress.": "Trabajo iniciado. Ahora está en progreso.",
    "A job can be started once the estimate is approved and it is on the schedule. Check where this job is in its steps.": "Un trabajo se puede iniciar cuando el presupuesto está aprobado y está en el calendario. Revise en qué paso va este trabajo.",
    "Contract stage. Record the deposit when it arrives, then add the job to the calendar. If the crew is already working, tap Start the job.": "Etapa de contrato. Registre el depósito cuando llegue y luego agregue el trabajo al calendario. Si el equipo ya está trabajando, toque Iniciar el trabajo.",
    "Scheduled. Record the deposit if you have not, and make crew instructions and a materials list. When the crew begins, tap Start the job.": "Programado. Registre el depósito si aún no lo hizo y prepare las instrucciones para el equipo y la lista de materiales. Cuando el equipo comience, toque Iniciar el trabajo.",
    "Approved change orders on this invoice": "Órdenes de cambio aprobadas en esta factura",
    "None yet. Approved change orders land here as separate lines when you build the invoice, and you can edit them.": "Todavía ninguna. Las órdenes de cambio aprobadas aparecen aquí como líneas separadas cuando arma la factura, y puede editarlas.",
    "With a payment schedule, change orders are billed with the final payment.": "Con un calendario de pagos, las órdenes de cambio se cobran con el pago final.",
    "What": "Qué", "Price ($)": "Precio ($)",
    "Change orders on this invoice": "Órdenes de cambio en esta factura", "Approved change orders on the job": "Órdenes de cambio aprobadas en el trabajo", "Change orders waiting for the customer": "Órdenes de cambio esperando al cliente",
  }, [
    [/^The start date \((.+?)\) is here\. Tap Start the job when the crew begins\.$/, function (a, d) { return 'Llegó la fecha de inicio (' + d + '). Toque Iniciar el trabajo cuando el equipo comience.'; }],
    [/^Scheduled for (.+?)\. Record the deposit if you have not, and make crew instructions and a materials list\. When the crew begins, tap Start the job\.( .+)?$/, function (a, d, sfx) {
      var tail = '';
      var m = sfx && (/^ (.+?) was emailed the "We start tomorrow" notice\.$/.exec(sfx) || null);
      var w = sfx && (/^ (.+?) will be emailed a "We start tomorrow" notice the day before\.$/.exec(sfx) || null);
      if (m) tail = ' Se envió a ' + m[1] + ' el aviso "Mañana empezamos".';
      else if (w) tail = ' Se enviará a ' + w[1] + ' un aviso "Mañana empezamos" el día anterior.';
      return 'Programado para el ' + d + '. Registre el depósito si aún no lo hizo y prepare las instrucciones para el equipo y la lista de materiales. Cuando el equipo comience, toque Iniciar el trabajo.' + tail;
    }],
    [/^Change orders total (\$[\d,]+\.\d\d)\.$/, function (a, m) { return 'Total de órdenes de cambio ' + m + '.'; }],
    [/^(\$[\d,]+\.\d\d) \(not all are on this invoice\)$/, function (a, m) { return m + ' (no todas están en esta factura)'; }],
    [/^(\d+) change orders? (?:is|are) still waiting for the customer's answer\. (?:It is|They are) not on this invoice unless the customer approves\.$/, function (a, n) { return n === '1' ? '1 orden de cambio sigue esperando la respuesta del cliente. No está en esta factura a menos que el cliente la apruebe.' : n + ' órdenes de cambio siguen esperando la respuesta del cliente. No están en esta factura a menos que el cliente las apruebe.'; }],
    [/^Approved change orders \((\$[\d,]+\.\d\d)\) are not on this invoice\. Tap the build button again to add them, or add the lines yourself\.$/, function (a, m) { return 'Las órdenes de cambio aprobadas (' + m + ') no están en esta factura. Toque el botón de armar otra vez para agregarlas, o agregue las líneas usted mismo.'; }],
    [/^The change orders on this invoice \((\$[\d,]+\.\d\d)\) do not match the approved change orders on the job \((\$[\d,]+\.\d\d)\)\. Check the lines before you send\.$/, function (a, m, n) { return 'Las órdenes de cambio de esta factura (' + m + ') no coinciden con las aprobadas en el trabajo (' + n + '). Revise las líneas antes de enviar.'; }],
    [/^The start date \((.+?)\) is here: (.+)\. Open the job and tap Start the job when the crew begins\.$/, function (a, d, rest) { return 'Llegó la fecha de inicio (' + d + '): ' + rest + '. Abra el trabajo y toque Iniciar el trabajo cuando el equipo comience.'; }],
  ]);

  /* ---- Part 15b: Site visits ---- */
  pmI18n.add({
    "Site visit": "Visita al sitio", "Optional": "Opcional", "Time (optional)": "Hora (opcional)", "Date": "Fecha",
    "Notes for me (private, never emailed)": "Notas para mí (privadas, nunca se envían por correo)",
    "Example: Bring a ladder and the color deck. Dog in the back yard.": "Ejemplo: Llevar una escalera y el muestrario de colores. Hay un perro en el patio.",
    "Customer email language": "Idioma del correo al cliente",
    "Book the visit": "Agendar la visita", "Save visit": "Guardar visita", "Mark visit done": "Marcar visita como hecha", "Cancel visit": "Cancelar visita",
    "Done": "Hecha", "Cancelled": "Cancelada",
    "The email names only the date, time and address. Your notes are never included.": "El correo solo menciona la fecha, la hora y la dirección. Sus notas nunca se incluyen.",
    "Add an email address in Edit details first.": "Primero agregue un correo electrónico en Editar detalles.",
    "The customer was emailed a confirmation and gets a reminder the day before.": "Se le envió al cliente una confirmación por correo y recibirá un recordatorio el día antes.",
    "The customer email has not gone out yet. Tap Save visit to send it.": "El correo al cliente todavía no se ha enviado. Toque Guardar visita para enviarlo.",
    "The customer is not emailed about this visit.": "No se le envía correo al cliente sobre esta visita.",
    "Booking a walk-through puts it on your calendar. You can also email the customer a confirmation and a friendly reminder the day before. Nothing is emailed unless you tick the box.": "Agendar un recorrido lo pone en su calendario. También puede enviar al cliente una confirmación y un recordatorio amable el día antes. No se envía nada por correo a menos que marque la casilla.",
    "Pick a date for the visit.": "Elija una fecha para la visita.", "Pick today or a day ahead.": "Elija hoy o un día futuro.",
    "This customer has no email address. Add one in Edit details, or untick the email box.": "Este cliente no tiene correo electrónico. Agregue uno en Editar detalles, o desmarque la casilla del correo.",
    "This job is closed, so a visit cannot be booked.": "Este trabajo está cerrado, así que no se puede agendar una visita.",
    "There is no visit on this job.": "Este trabajo no tiene una visita.",
    "Visit saved. The customer was emailed a confirmation.": "Visita guardada. Se envió una confirmación al cliente.",
    "Visit saved, but the email could not be sent. Check the customer email address.": "Visita guardada, pero no se pudo enviar el correo. Revise el correo electrónico del cliente.",
    "Visit saved.": "Visita guardada.", "Visit marked done. Next, tap Create estimate.": "Visita marcada como hecha. Luego, toque Crear presupuesto.", "Visit cancelled.": "Visita cancelada.",
    "Email the visit confirmation": "Enviar la confirmación de la visita", "Visit": "Visita", "Reminder": "Recordatorio",
    "Emailed the day before": "Se envía por correo el día antes", "None needed (the visit is soon)": "No hace falta (la visita es pronto)",
    "This is a new lead. If you want to see the place first, book a site visit. Otherwise tell me about the job below, then tap Create estimate.": "Este es un cliente potencial nuevo. Si quiere ver el lugar primero, agende una visita. Si no, cuénteme del trabajo abajo y toque Crear presupuesto.",
    "Site visit done.": "Visita al sitio hecha.", "Visit reminder emailed to the customer.": "Recordatorio de visita enviado al cliente.",
  }, [
    [/^Booked: (.+)$/, function (a, w) { return 'Agendada: ' + w; }],
    [/^Email (.+?) a confirmation with a calendar file, and a reminder the day before$/, function (a, n) { return 'Enviar a ' + n + ' una confirmación con un archivo de calendario y un recordatorio el día antes'; }],
    [/^Visit done$/, function () { return 'Visita hecha'; }],
    [/^The visit on (.+?) was cancelled\. You can book a new one\.$/, function (a, d) { return 'La visita del ' + d + ' fue cancelada. Puede agendar una nueva.'; }],
    [/^Visit (.+?)\. Take photos and notes, then tap Create estimate\.$/, function (a, w) { return 'Visita ' + w + '. Tome fotos y notas, y luego toque Crear presupuesto.'; }],
    [/^The visit on (.+?) is still marked as booked\. Open Site visit and tap Mark visit done once you have been there\.$/, function (a, d) { return 'La visita del ' + d + ' sigue marcada como agendada. Abra Visita al sitio y toque Marcar visita como hecha cuando haya ido.'; }],
    [/^Site visit today( at [^:]+:[^:]+)?: (.+)$/, function (a, t, w) { return 'Visita al sitio hoy' + (t ? t.replace(' at ', ' a las ') : '') + ': ' + w; }],
    [/^Site visit tomorrow( at [^:]+:[^:]+)?: (.+)$/, function (a, t, w) { return 'Visita al sitio mañana' + (t ? t.replace(' at ', ' a las ') : '') + ': ' + w; }],
    [/^The site visit on (.+?) is still marked as booked\. Open the job and mark it done, or book a new time: (.+)$/, function (a, d, c) { return 'La visita del ' + d + ' sigue marcada como agendada. Abra el trabajo y márquela como hecha, o agende otra hora: ' + c; }],
  ]);

  /* ---- Part 15c: Finished-work sign-off and review request ---- */
  pmI18n.add({
    "Customer sign-off and review request": "Aceptación del cliente y solicitud de reseña", "Accepted": "Aceptado", "Waiting": "En espera",
    "Email the link again": "Enviar el enlace otra vez", "Take back the request": "Retirar la solicitud",
    "Review request": "Solicitud de reseña",
    "A short thank-you email that asks for a review. You read it first, and nothing is sent until you tap Send.": "Un correo breve de agradecimiento que pide una reseña. Usted lo lee primero y no se envía nada hasta que toque Enviar.",
    "Write the review request": "Escribir la solicitud de reseña", "Write another review request": "Escribir otra solicitud de reseña",
    "Nothing is sent unless this is ticked.": "No se envía nada a menos que esté marcada.",
    "Add an email address in Edit details to send it by email. You can still share the Customer portal link.": "Agregue un correo electrónico en Editar detalles para enviarlo. Aun así puede compartir el enlace del portal del cliente.",
    "The warranty certificate will start from that day.": "El certificado de garantía empezará desde ese día.",
    "Asked. The customer was emailed the link.": "Solicitado. Se envió el enlace al cliente por correo.",
    "Asked, but the email could not be sent. Share the Customer portal link instead.": "Solicitado, pero no se pudo enviar el correo. Comparta el enlace del portal del cliente.",
    "Asked. The customer will see the button on their private page.": "Solicitado. El cliente verá el botón en su página privada.",
    "Request taken back.": "Solicitud retirada.", "Review request emailed.": "Solicitud de reseña enviada.",
    "Your Google review link is not saved yet, so this email asks for a review without a link.": "Su enlace de reseñas de Google todavía no está guardado, así que este correo pide una reseña sin enlace.",
    "Add it in Brand kit": "Agréguelo en el Kit de marca", " first if you want the link in the email.": " primero si quiere el enlace en el correo.",
    "Subject": "Asunto", "Email (edit anything you like)": "Correo (edite lo que quiera)",
    "Email the finished-work link": "Enviar el enlace del trabajo terminado", "What they receive": "Lo que reciben",
    "A link to their private page, with a button to accept the finished work": "Un enlace a su página privada, con un botón para aceptar el trabajo terminado",
    "Send the review request": "Enviar la solicitud de reseña",
    "The customer already accepted the finished work.": "El cliente ya aceptó el trabajo terminado.",
    "The customer already accepted, so this cannot be withdrawn.": "El cliente ya aceptó, así que no se puede retirar.",
    "This job was marked lost.": "Este trabajo se marcó como perdido.",
    "The email needs a subject and some text.": "El correo necesita un asunto y algo de texto.",
    "The email could not be sent. Check the customer email address and try again.": "No se pudo enviar el correo. Revise el correo del cliente e inténtelo de nuevo.",
    "This customer has no email address. Add one in Edit details first.": "Este cliente no tiene correo electrónico. Primero agregue uno en Editar detalles.",
    "Asked the customer to accept the finished work.": "Se pidió al cliente aceptar el trabajo terminado.",
    "Took back the request to accept the finished work.": "Se retiró la solicitud de aceptar el trabajo terminado.",
    "Review request emailed to the customer.": "Solicitud de reseña enviada al cliente.",
    "Final walkthrough. Finish the punch list, then build the invoice.": "Recorrido final. Termine la lista de pendientes y luego arme la factura.",
  }, [
    [/^Accepted by (.+?) on (.+)\.$/, function (a, n, d) { return 'Aceptado por ' + n + ' el ' + d + '.'; }],
    [/^Waiting for (.+?) to accept the finished work\.$/, function (a, n) { return 'Esperando que ' + n + ' acepte el trabajo terminado.'; }],
    [/^Asked (.+?)\. The link was emailed to them\.$/, function (a, d) { return 'Solicitado el ' + d + '. Se les envió el enlace por correo.'; }],
    [/^Asked (.+?)\. Not emailed yet\.$/, function (a, d) { return 'Solicitado el ' + d + '. Todavía no se envió por correo.'; }],
    [/^(.+?) sent a note:$/, function (a, n) { return n + ' envió una nota:'; }],
    [/^Optional\. At the final walkthrough you can ask (.+?) to confirm the finished work on their private page\. It saves their name and the date, and the warranty starts from that day\.$/, function (a, n) { return 'Opcional. En el recorrido final puede pedirle a ' + n + ' que confirme el trabajo terminado en su página privada. Se guarda su nombre y la fecha, y la garantía empieza desde ese día.'; }],
    [/^Email (.+?) the link$/, function (a, n) { return 'Enviar el enlace a ' + n; }],
    [/^Ask (.+?) to accept the finished work$/, function (a, n) { return 'Pedir a ' + n + ' que acepte el trabajo terminado'; }],
    [/^Review request sent (.+)\.$/, function (a, d) { return 'Solicitud de reseña enviada el ' + d + '.'; }],
    [/^Send to (.+)$/, function (a, n) { return 'Enviar a ' + n; }],
    [/^It goes to (.+?) and replies come to you\.$/, function (a, e) { return 'Va a ' + e + ' y las respuestas llegan a usted.'; }],
    [/^(.+?) sent a note about the finished work: (.+?)\. Open the job to read it\.$/, function (a, n, j) { return n + ' envió una nota sobre el trabajo terminado: ' + j + '. Abra el trabajo para leerla.'; }],
    [/^Waiting for (.+?) to accept the finished work: (.+?)\. A friendly call or text often helps\.$/, function (a, n, j) { return 'Esperando que ' + n + ' acepte el trabajo terminado: ' + j + '. Una llamada o mensaje amable suele ayudar.'; }],
    [/^The customer accepted the finished work on (.+?), so the start date is filled in from that day\.$/, function (a, d) { return 'El cliente aceptó el trabajo terminado el ' + d + ', así que la fecha de inicio se llenó desde ese día.'; }],
    [/^Final walkthrough\. Finish the punch list, then build the invoice\. You can also ask (.+?) to accept the finished work under Customer sign-off\.$/, function (a, n) { return 'Recorrido final. Termine la lista de pendientes y luego arme la factura. También puede pedirle a ' + n + ' que acepte el trabajo terminado en Aceptación del cliente.'; }],
  ]);

  /* ---- Part 16: Business pulse ---- */
  pmI18n.add({
    "Business pulse": "Pulso del negocio", "See your business pulse: money in, money out and profit": "Vea el pulso de su negocio: dinero que entra, dinero que sale y ganancia",
    "Money in and out this month, compared with the same days last month. It uses the payments, expenses and crew pay you record, so there is no bank connection. These are records for your accountant, not tax advice.": "El dinero que entra y sale este mes, comparado con los mismos días del mes pasado. Usa los pagos, gastos y pagos al equipo que usted registra, así que no hay conexión con el banco. Son registros para su contador, no asesoría fiscal.",
    "Customers who still owe you": "Clientes que todavía le deben", "Last 6 months": "Últimos 6 meses", "Month": "Mes",
    "Money in": "Dinero que entró", "Money out": "Dinero que salió",
    "Money in this month": "Dinero que entró este mes", "Money out this month": "Dinero que salió este mes",
    "Profit so far (in minus out)": "Ganancia hasta ahora (entrada menos salida)", "Owed to you (invoices sent)": "Le deben (facturas enviadas)",
    "Crew pay": "Pago al equipo", "Fuel and vehicle costs": "Combustible y costos del vehículo",
    "Miles driven": "Millas recorridas", "Deduction value": "Valor de deducción",
    "Set your mileage rate in Records to see the value.": "Fije su tarifa por milla en Registros para ver el valor.",
    "New this month": "Nuevo este mes", "Up from last month so far": "Subió frente al mes pasado hasta ahora", "Down from last month so far": "Bajó frente al mes pasado hasta ahora", "Same as last month so far": "Igual que el mes pasado hasta ahora",
    "invoice sent today": "factura enviada hoy",
    "Nobody owes you on a sent invoice right now.": "Nadie le debe por una factura enviada en este momento.",
    "Money in is the payments you record on each job, on the day they arrived. Money out is your expenses plus payments to your crew, on the day you spent them. Profit here is money in minus money out, before your own pay and taxes. Mileage value is a deduction amount for your accountant, so it is not counted as money out.": "El dinero que entra son los pagos que usted registra en cada trabajo, el día en que llegaron. El dinero que sale son sus gastos más los pagos a su equipo, el día en que los gastó. La ganancia aquí es lo que entró menos lo que salió, antes de su propio pago y de impuestos. El valor de las millas es un monto de deducción para su contador, así que no se cuenta como dinero que salió.",
    "Record a payment on a job": "Registrar un pago en un trabajo", "Add an expense or a trip": "Agregar un gasto o un viaje", "Record crew pay": "Registrar pago al equipo",
  }, [
    [/^(Up|Down) (\d+)% from last month so far$/, function (a, d, n) { return (d === 'Up' ? 'Subió ' : 'Bajó ') + n + '% frente al mes pasado hasta ahora'; }],
    [/^invoice sent (\d+) days ago$/, function (a, n) { return 'factura enviada hace ' + n + ' días'; }],
    [/^\+(\d+) more$/, function (a, n) { return '+' + n + ' más'; }],
  ]);

  /* ---- Part 16b: Calendar day and week views ---- */
  pmI18n.add({
    "Day": "Día", "Week": "Semana", "All crew": "Todo el equipo", "No crew assigned.": "Sin equipo asignado.",
    "Nothing scheduled this day.": "No hay nada programado este día.", "Edit dates and crew": "Editar fechas y equipo",
  });

  /* ---- Part 17: Vehicles ---- */
  (function () {
    var SV = { 'Oil change': 'Cambio de aceite', 'Tire rotation': 'Rotación de llantas', 'Brake check': 'Revisión de frenos' };
    var sv = function (n) { return SV[n] || n; };
    var when = function (w) {
      var m;
      if (w === 'today') return 'hoy';
      if (w === 'tomorrow') return 'mañana';
      if ((m = /^in (\d+) days$/.exec(w))) return 'en ' + m[1] + ' días';
      if ((m = /^(\d+) days? ago$/.exec(w))) return 'hace ' + m[1] + (m[1] === '1' ? ' día' : ' días');
      return w;
    };
    var W = '(today|tomorrow|in \\d+ days|\\d+ days? ago)';
    pmI18n.add({
      "Vehicles": "Vehículos", "Vehicle": "Vehículo",
      "Keep your work vehicles in one place: odometer, insurance, registration, loan details for your own records, and a service log with reminders. Never type a bank, loan or card number here. Reminders show on Home.": "Tenga sus vehículos de trabajo en un solo lugar: odómetro, seguro, registro, datos del préstamo para sus propios registros y un historial de servicio con recordatorios. Nunca escriba aquí un número de banco, préstamo o tarjeta. Los recordatorios aparecen en Inicio.",
      "No vehicles yet. Add your work truck or van to get service and insurance reminders.": "Todavía no hay vehículos. Agregue su camioneta o van de trabajo para recibir recordatorios de servicio y de seguro.",
      "Add a vehicle": "Agregar un vehículo", "Add vehicle": "Agregar vehículo", "Save vehicle": "Guardar vehículo", "Remove vehicle": "Quitar vehículo",
      "Remove this vehicle and its history?": "¿Quitar este vehículo y su historial?", "Main": "Principal",
      "Service reminders": "Recordatorios de servicio", "Add the odometer reading so mileage reminders can work.": "Agregue la lectura del odómetro para que funcionen los recordatorios por millas.",
      "Add a service": "Agregar un servicio", "Service history": "Historial de servicio", "Details": "Detalles",
      "Log it": "Registrar", "Odometer": "Odómetro", "Cost ($)": "Costo ($)", "Note": "Nota",
      "Also add the cost as an expense (Vehicle)": "Agregar también el costo como gasto (Vehículo)", "Save service": "Guardar servicio",
      "Service name": "Nombre del servicio", "Every how many miles": "Cada cuántas millas", "Every how many months": "Cada cuántos meses",
      "These are typical starting numbers. Your owner manual and your own habits come first.": "Estos son números típicos para empezar. El manual de su vehículo y sus propios hábitos van primero.",
      "Remove service": "Quitar servicio", "Remove this service?": "¿Quitar este servicio?",
      "Name (like Work truck)": "Nombre (como Camioneta de trabajo)", "Year": "Año", "Make": "Marca", "Model": "Modelo", "Odometer (miles)": "Odómetro (millas)",
      "Read from a photo": "Leer de una foto", "Read insurance card from a photo": "Leer la tarjeta del seguro de una foto",
      "This is my main vehicle. Trips I log in Records count toward its odometer.": "Este es mi vehículo principal. Los viajes que registro en Registros cuentan para su odómetro.",
      "Insurance": "Seguro", "Company": "Compañía", "Policy number": "Número de póliza", "Coverage ends": "La cobertura termina",
      "Registration due": "Vencimiento del registro", "Inspection due": "Vencimiento de la inspección",
      "Loan (for your own records)": "Préstamo (para sus propios registros)",
      "Type only the lender, the payment and the balance. Never type an account, routing or card number. PaintersMax does not store those.": "Escriba solo el prestamista, el pago y el saldo. Nunca escriba un número de cuenta, de ruta o de tarjeta. PaintersMax no los guarda.",
      "Lender": "Prestamista", "Monthly payment ($)": "Pago mensual ($)", "Balance ($)": "Saldo ($)", "Payment due on day of month (1 to 31)": "Pago vence el día del mes (1 a 31)", "Notes": "Notas",
      "On track": "Al día", "Due now": "Toca ahora", "Needs setup": "Falta configurar", "Not logged yet": "Todavía no registrado",
      "Oil change": "Cambio de aceite", "Tire rotation": "Rotación de llantas", "Brake check": "Revisión de frenos",
      "Reading the photo...": "Leyendo la foto...", "Could not read the odometer. Type it in instead.": "No se pudo leer el odómetro. Escríbalo.",
      "Read from the photo. Check it, then save.": "Leído de la foto. Revíselo y luego guarde.", "Service saved.": "Servicio guardado.",
      "Give the vehicle a name, like Work truck.": "Póngale un nombre al vehículo, como Camioneta de trabajo.",
      "That has a long number in it, like a bank, loan or card number. PaintersMax never stores those. Take it out and save again.": "Tiene un número largo, como de banco, préstamo o tarjeta. PaintersMax nunca los guarda. Quítelo y guarde de nuevo.",
      "Give the service a name, like Oil change.": "Póngale un nombre al servicio, como Cambio de aceite.",
      "Set how often: every so many miles, every so many months, or both.": "Indique cada cuánto: cada tantas millas, cada tantos meses, o ambos.",
      "That is plenty of services for one vehicle.": "Son suficientes servicios para un vehículo.", "Choose which service you did.": "Elija qué servicio hizo.",
      "That date is in the future.": "Esa fecha es en el futuro.", "Vehicle not found.": "No se encontró el vehículo.",
      "Choose odometer or insurance card.": "Elija odómetro o tarjeta del seguro.", "Choose a photo (JPEG, PNG or WebP) that is not too large.": "Elija una foto (JPEG, PNG o WebP) que no sea muy grande.",
      "Photo reading is paused right now. Type it in instead.": "La lectura de fotos está en pausa ahora. Escríbalo.",
      "You have used this month's photo reads. You can still type it in, or upgrade for more.": "Ya usó las lecturas de fotos de este mes. Aún puede escribirlo, o mejorar su plan para tener más.",
    }, [
      [/^Your plan includes (\d+) vehicles?\. Upgrade for more\.$/, function (a, n) { return 'Su plan incluye ' + n + (n === '1' ? ' vehículo' : ' vehículos') + '. Mejore su plan para tener más.'; }],
      [/^(.+?) is due on (.+?)\.(?: It is ([\d,]+) miles past\.)?$/, function (a, s, v, m) { return sv(s) + ' vence en ' + v + '.' + (m ? ' Lleva ' + m + ' millas de retraso.' : ''); }],
      [/^(.+?) is coming up on (.+?)(?:, in about ([\d,]+) miles|, by (\d{4}-\d{2}-\d{2}))?\.$/, function (a, s, v, m, d) { return sv(s) + ' se acerca en ' + v + (m ? ', en unas ' + m + ' millas' : d ? ', para el ' + d : '') + '.'; }],
      [new RegExp('^Insurance on (.+?) (?:ends|ended) ' + W + '\\.$'), function (a, v, w) { return 'El seguro de ' + v + (/ago$/.test(w) ? ' terminó ' : ' termina ') + when(w) + '.'; }],
      [new RegExp('^Registration for (.+?) (?:is due|was due) ' + W + '\\.$'), function (a, v, w) { return 'El registro de ' + v + (/ago$/.test(w) ? ' venció ' : ' vence ') + when(w) + '.'; }],
      [new RegExp('^Inspection for (.+?) (?:is due|was due) ' + W + '\\.$'), function (a, v, w) { return 'La inspección de ' + v + (/ago$/.test(w) ? ' venció ' : ' vence ') + when(w) + '.'; }],
      [new RegExp('^The loan payment for (.+?) is due ' + W + '\\.$'), function (a, v, w) { return 'El pago del préstamo de ' + v + ' vence ' + when(w) + '.'; }],
    ]);
  })();

  /* ---- Part 15e: "We start tomorrow" notice ---- */
  pmI18n.add({
    "Notice language": "Idioma del aviso",
    "The notice was already emailed.": "El aviso ya se envió por correo.",
    "Add an email address in Edit details to send the customer a \"We start tomorrow\" notice.": "Agregue un correo electrónico en Editar detalles para enviar al cliente un aviso \"Mañana empezamos\".",
    "The customer will be emailed the \"We start tomorrow\" notice the day before.": "Se enviará al cliente el aviso \"Mañana empezamos\" el día anterior.",
    "It is too late for the day-before notice, so none will be sent. A quick call or text works.": "Es muy tarde para el aviso del día anterior, así que no se enviará. Una llamada o mensaje rápido sirve.",
    "This customer has no email address. Add one in Edit details, or untick the \"We start tomorrow\" box.": "Este cliente no tiene correo electrónico. Agregue uno en Editar detalles, o desmarque la casilla \"Mañana empezamos\".",
    "The customer was emailed the \"We start tomorrow\" notice.": "Se envió al cliente el aviso \"Mañana empezamos\".",
  }, [
    [/^Email (.+?) a "We start tomorrow" notice about 24 hours before the start day \((.+)\)$/, function (a, n, e) { return 'Enviar a ' + n + ' un aviso "Mañana empezamos" unas 24 horas antes del día de inicio (' + e + ')'; }],
  ]);

  /* ---- Part 15d: Coming up on Home (suggested due dates) ---- */
  (function () {
    var DOW = { Sun: 'dom', Mon: 'lun', Tue: 'mar', Wed: 'mié', Thu: 'jue', Fri: 'vie', Sat: 'sáb' };
    var MON = { Jan: 'ene', Feb: 'feb', Mar: 'mar', Apr: 'abr', May: 'may', Jun: 'jun', Jul: 'jul', Aug: 'ago', Sep: 'sep', Oct: 'oct', Nov: 'nov', Dec: 'dic' };
    var DATE = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})$/;
    function dEs(s) { var m = DATE.exec(s); return m ? DOW[m[1]] + ', ' + m[3] + ' ' + MON[m[2]] + '.' : s; }
    pmI18n.add({
      "Coming up": "Próximamente",
      "Reply to the new lead": "Responder al cliente potencial nuevo", "Follow up on the estimate": "Dar seguimiento al presupuesto",
      "Send the estimate": "Enviar el presupuesto", "Finish and send the estimate": "Terminar y enviar el presupuesto",
      "Build and send the contract": "Armar y enviar el contrato", "Put the job on the calendar": "Poner el trabajo en el calendario",
      "Finish the work": "Terminar el trabajo", "Build and send the invoice": "Armar y enviar la factura",
      "Follow up on payment": "Dar seguimiento al pago", "Send the invoice": "Enviar la factura",
      "today": "hoy", "tomorrow": "mañana", "was due yesterday": "venció ayer",
      "Monday": "el lunes", "Tuesday": "el martes", "Wednesday": "el miércoles", "Thursday": "el jueves", "Friday": "el viernes", "Saturday": "el sábado", "Sunday": "el domingo",
      "Suggested dates, worked out from where each job is. Nothing is sent to anyone.": "Fechas sugeridas, calculadas según el punto en que está cada trabajo. No se envía nada a nadie.",
    }, [
      [DATE, function (a) { return dEs(a); }],
      [/^was due (.+)$/, function (a, d) { return 'venció el ' + dEs(d); }],
      [/^\+(\d+) more on your jobs list$/, function (a, n) { return '+' + n + ' más en su lista de trabajos'; }],
    ]);
  })();

  /* ---- Part 18: Time sheet extras (overtime, approval, callback tick, Home reminders) ---- */
  pmI18n.add({
    "Time sheet": "Hoja de horas",
    "hours over 40 this week.": "horas sobre 40 esta semana.",
    "Employees over 40 hours in a week may be owed overtime. Tell your accountant.": "Los empleados con más de 40 horas en una semana pueden tener derecho a horas extra. Avise a su contador.",
    "Approved": "Aprobada",
    "The hours are locked.": "Las horas están bloqueadas.",
    "Unapprove": "Quitar aprobación",
    "Approve this week": "Aprobar esta semana",
    "Approving says you checked these hours. It locks them so they cannot be changed by mistake. You can unapprove any time. It is optional.": "Aprobar significa que usted revisó estas horas. Las bloquea para que no se cambien por error. Puede quitar la aprobación cuando quiera. Es opcional.",
    "hours this week were callbacks or rework.": "horas de esta semana fueron regresos o retrabajo.",
    "Callback or rework": "Regreso o retrabajo",
    "Callback": "Regreso",
    "Locked": "Bloqueada",
    "week over 40 hours": "semana con más de 40 horas",
    "weeks over 40 hours": "semanas con más de 40 horas",
    "callback or rework hours": "horas de regreso o retrabajo",
    "This was a callback or rework (fixing earlier work)": "Fue un regreso o retrabajo (arreglar trabajo anterior)",
    "Tick this when the crew went back to fix something on a job that was already done. It adds no money anywhere. It lets you see, later, how many hours went to redoing work.": "Marque esto cuando la cuadrilla regresó a arreglar algo en un trabajo ya terminado. No suma dinero en ningún lado. Le permite ver, más adelante, cuántas horas se fueron en rehacer trabajo.",
    "Unapprove this week? You will be able to change the hours again.": "¿Quitar la aprobación de esta semana? Podrá cambiar las horas otra vez.",
    "That week is approved. Unapprove it to change the hours.": "Esa semana está aprobada. Quite la aprobación para cambiar las horas.",
    "There are no hours that week to approve.": "No hay horas esa semana para aprobar.",
    "That week has not started yet.": "Esa semana todavía no empieza.",
    "Choose the week.": "Elija la semana.",
  }, [
    [/^(.+?) has ([\d.]+) hours this week$/, function (a, n, h) { return n + ' tiene ' + h + ' horas esta semana'; }],
    [/^(.+?) had ([\d.]+) hours last week$/, function (a, n, h) { return n + ' tuvo ' + h + ' horas la semana pasada'; }],
    [/^(.+)\. Employees over 40 hours in a week may be owed overtime, so tell your accountant\.$/, function (a, list) {
      var parts = list.split('. ').map(function (p) { return pmI18n.x(p); });
      return parts.join('. ') + '. Los empleados con más de 40 horas en una semana pueden tener derecho a horas extra, avise a su contador.';
    }],
    [/^Nothing is on the time sheet for (last week|this week) yet\. Add the hours so crew pay and job costs stay right\.$/, function (a, w) { return 'Todavía no hay nada en la hoja de horas de ' + (w === 'last week' ? 'la semana pasada' : 'esta semana') + '. Agregue las horas para que el pago de la cuadrilla y los costos del trabajo salgan bien.'; }],
    [/^Time sheets waiting for your approval: (.+?)\.$/, function (a, list) { return 'Hojas de horas esperando su aprobación: ' + list.replace(/ and (\d+) more$/, ' y $1 más') + '.'; }],
  ]);

  pmI18n.start();
})();

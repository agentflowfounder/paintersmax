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

  pmI18n.start();
})();

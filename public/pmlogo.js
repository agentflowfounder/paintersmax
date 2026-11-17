/* PaintersMax logo studio engine: four concepts x three shapes, drawn as plain SVG (no fonts needed for the icon).
 * Used by /marketing-admin and by tests. Every color is an option so the admin can restyle it. */
(function (root) {
  var CONCEPTS = ['box', 'cycle', 'paint', 'pm'];
  var SHAPES = ['round', 'square', 'triangle'];
  var SLOGAN = 'Bid it. Book it. Bank it.';
  var NAME = 'PaintersMax';
  var DEFAULTS = { concept: 'box', shape: 'square', primary: '#1f3a5f', accent: '#e8833a', ink: '#ffffff', text: '#1f3a5f', slogan: true };

  function hex(c, d) { return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : d; }
  function n(v) { return Math.round(v * 100) / 100; }

  // The container shape fills a 100 x 100 box.
  function shapePath(shape) {
    if (shape === 'round') return '<circle cx="50" cy="50" r="48"/>';
    if (shape === 'triangle') return '<path d="M50 4 L97 91 L3 91 Z" stroke-linejoin="round" stroke-width="6" stroke="PRIMARY"/>';
    return '<rect x="2" y="2" width="96" height="96" rx="14"/>';
  }
  // Where the glyph sits (center, scale) so it stays inside the shape.
  function glyphBox(shape) {
    if (shape === 'triangle') return { cx: 50, cy: 66, s: 0.52 };
    if (shape === 'round') return { cx: 50, cy: 50, s: 0.7 };
    return { cx: 50, cy: 50, s: 0.74 };
  }

  function polar(cx, cy, r, deg) { var a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  // Three-arrow cycle (Bid it, Book it, Bank it): three arcs each ending in an arrowhead.
  function cycle(ink) {
    var out = '', r = 30;
    for (var k = 0; k < 3; k++) {
      var a0 = k * 120 + 12, a1 = k * 120 + 96;
      var p0 = polar(50, 50, r, a0), p1 = polar(50, 50, r, a1);
      out += '<path d="M' + n(p0[0]) + ' ' + n(p0[1]) + ' A' + r + ' ' + r + ' 0 0 1 ' + n(p1[0]) + ' ' + n(p1[1]) + '" fill="none" stroke="' + ink + '" stroke-width="9" stroke-linecap="round"/>';
      // arrowhead pointing along the arc direction at p1
      var t = polar(50, 50, r, a1 + 14), l = polar(50, 50, r + 11, a1 - 2), rr = polar(50, 50, r - 11, a1 - 2);
      out += '<path d="M' + n(t[0]) + ' ' + n(t[1]) + ' L' + n(l[0]) + ' ' + n(l[1]) + ' L' + n(rr[0]) + ' ' + n(rr[1]) + ' Z" fill="' + ink + '"/>';
    }
    return out;
  }
  function glyph(concept, ink, accent) {
    if (concept === 'cycle') return cycle(ink);
    if (concept === 'paint') {
      // roller: roll, arm, handle
      return '<rect x="18" y="22" width="56" height="22" rx="8" fill="' + ink + '"/><rect x="74" y="28" width="10" height="10" rx="3" fill="' + accent + '"/>' +
        '<path d="M84 33 H88 V54 H50 V64" fill="none" stroke="' + ink + '" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/><rect x="43" y="62" width="14" height="24" rx="5" fill="' + accent + '"/>';
    }
    if (concept === 'pm') {
      // letters drawn as strokes so they look the same everywhere
      return '<path d="M20 74 V26 H40 A13 13 0 0 1 40 52 H20" fill="none" stroke="' + ink + '" stroke-width="9" stroke-linejoin="round"/>' +
        '<path d="M52 74 V26 L67 54 L82 26 V74" fill="none" stroke="' + accent + '" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    // box: a phone handset with two call waves (the business in a box: one tap and the phone rings)
    return '<path d="M24 30 C24 26 27 22 31 22 H38 C41 22 43 24 44 27 L46 35 C46.5 37.5 45.8 39.5 44 41 L40 44 C44 52 49 57 57 61 L60 57 C61.5 55.2 63.5 54.5 66 55 L74 57 C77 58 79 60 79 63 V70 C79 74 76 77 72 77 C45 77 24 56 24 30 Z" fill="' + ink + '"/>' +
      '<path d="M58 28 A16 16 0 0 1 72 42" fill="none" stroke="' + accent + '" stroke-width="6" stroke-linecap="round"/><path d="M58 14 A30 30 0 0 1 86 42" fill="none" stroke="' + accent + '" stroke-width="6" stroke-linecap="round"/>';
  }

  function opts(o) {
    o = o || {};
    return {
      concept: CONCEPTS.indexOf(o.concept) >= 0 ? o.concept : DEFAULTS.concept,
      shape: SHAPES.indexOf(o.shape) >= 0 ? o.shape : DEFAULTS.shape,
      primary: hex(o.primary, DEFAULTS.primary), accent: hex(o.accent, DEFAULTS.accent), ink: hex(o.ink, DEFAULTS.ink), text: hex(o.text, DEFAULTS.text),
      slogan: o.slogan !== false, mono: !!o.mono
    };
  }

  /** The symbol alone, 100 x 100 (favicon, app icon, social avatar). */
  function iconInner(o) {
    var c = opts(o), g = glyphBox(c.shape);
    var primary = c.mono ? '#000000' : c.primary, ink = c.mono ? '#ffffff' : c.ink, accent = c.mono ? '#ffffff' : c.accent;
    var body = shapePath(c.shape).replace(/PRIMARY/g, primary);
    return '<g fill="' + primary + '">' + body + '</g>' +
      '<g transform="translate(' + g.cx + ' ' + g.cy + ') scale(' + g.s + ') translate(-50 -50)">' + glyph(c.concept, ink, accent) + '</g>';
  }
  function icon(o, size) {
    size = size || 512;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="' + size + '" height="' + size + '" role="img" aria-label="' + NAME + '">' + iconInner(o) + '</svg>';
  }
  /** Icon plus the name and, when on, the slogan. */
  function lockup(o) {
    var c = opts(o), text = c.mono ? '#000000' : c.text, w = c.slogan ? 470 : 400, h = 120;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + NAME + '">' +
      '<g transform="translate(10 10) scale(1)">' + iconInner(o) + '</g>' +
      '<text x="128" y="' + (c.slogan ? 66 : 74) + '" font-family="Arial Black, Helvetica, Arial, sans-serif" font-weight="900" font-size="46" fill="' + text + '">' + NAME + '</text>' +
      (c.slogan ? '<text x="130" y="96" font-family="Helvetica, Arial, sans-serif" font-weight="600" font-size="19" letter-spacing="1.5" fill="' + (c.mono ? '#000000' : c.accent) + '">' + SLOGAN + '</text>' : '') +
      '</svg>';
  }
  var api = { CONCEPTS: CONCEPTS, SHAPES: SHAPES, SLOGAN: SLOGAN, NAME: NAME, DEFAULTS: DEFAULTS, opts: opts, icon: icon, lockup: lockup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PMLOGO = api;
})(typeof window !== 'undefined' ? window : globalThis);

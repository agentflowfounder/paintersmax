/* PaintersMax icons: small hand-built SVGs (about 0.5 KB each), drawn inline so they cost no extra downloads.
   window.pmIcon(name, size) returns an <svg> string. Colors: navy ink, amber accent, cream fill, water blue. */
(function () {
  var I = "#0F1B2D", A = "#E8A33D", T = "#FDF1D8", W = "#DCEBFA", B = "#3B8BD4";
  var P = {
    interior:
      '<path d="M6 22 20 8l14 14" /><path d="M8 20v21h24V20" fill="' + T + '"/><path d="M5 22 20 7l15 15"/>' +
      '<rect x="12" y="25" width="7" height="7" rx="1" fill="' + W + '"/><path d="M15.5 25v7M12 28.5h7"/>' +
      '<rect x="22" y="30" width="7" height="11" rx="1" fill="' + A + '"/>' +
      '<rect x="27" y="11" width="16" height="9" rx="2.5" fill="' + A + '"/><path d="M43 15.5h2.5v7.5H36v4.5"/><rect x="34" y="27" width="4" height="12" rx="1.6" fill="' + T + '"/>',
    exterior:
      '<path d="M34 12V6h5v12" fill="' + T + '"/><path d="M9 18v23h30V18" fill="' + T + '"/><path d="M4 20 24 5l20 15z" fill="' + A + '"/>' +
      '<path d="M9 29h30"/><rect x="13" y="22" width="6" height="5" rx="1" fill="' + W + '"/><rect x="29" y="22" width="6" height="5" rx="1" fill="' + W + '"/>' +
      '<rect x="13" y="32" width="6" height="6" rx="1" fill="' + W + '"/><rect x="29" y="32" width="6" height="6" rx="1" fill="' + W + '"/>' +
      '<rect x="21.5" y="31" width="5" height="10" rx="1" fill="' + A + '"/><path d="M3 41h42"/>',
    commercial:
      '<rect x="10" y="7" width="20" height="34" rx="1.5" fill="' + T + '"/><rect x="30" y="19" width="12" height="22" rx="1.5" fill="' + T + '"/>' +
      '<g fill="' + W + '"><rect x="14" y="11" width="4" height="4"/><rect x="22" y="11" width="4" height="4"/><rect x="14" y="19" width="4" height="4"/><rect x="22" y="19" width="4" height="4"/><rect x="14" y="27" width="4" height="4"/><rect x="22" y="27" width="4" height="4"/><rect x="34" y="23" width="4" height="4"/><rect x="34" y="31" width="4" height="4"/></g>' +
      '<rect x="17" y="33" width="7" height="8" fill="' + A + '"/><path d="M4 41h40"/>',
    new_construction:
      '<rect x="31" y="25" width="9" height="16" fill="' + T + '"/><path d="M4 25 24 7l20 18"/><path d="M8 25h32M8 41h32"/>' +
      '<path d="M11 25v16M18 25v16M25 25v16M32 25v16M39 25v16"/><path d="M11 41 25 27" stroke="' + A + '" stroke-width="2.4"/><path d="M24 8v17"/>',
    power_washing:
      '<path d="M9 28c-5 1-6 9-1 12" /><rect x="7" y="17" width="17" height="9" rx="4" fill="' + T + '"/><path d="M11 26l2 12h6l-2-12" fill="' + T + '"/><path d="M17 26l-2.5 5"/>' +
      '<rect x="24" y="19.5" width="12" height="4.5" rx="2" fill="' + A + '"/><path d="M36 17.5v9"/>' +
      '<g stroke="' + B + '"><path d="M39 22h6M39 17.5l5-3M39 26.5l5 3"/></g><g fill="' + B + '" stroke="none"><circle cx="43" cy="10" r="1.7"/><circle cx="46" cy="22" r="1.4"/><circle cx="42" cy="34" r="1.7"/></g>',
    drywall:
      '<rect x="6" y="7" width="24" height="34" rx="1.5" fill="' + T + '"/><path d="M6 13h24"/><g fill="' + I + '" stroke="none"><circle cx="10" cy="10" r="1"/><circle cx="26" cy="10" r="1"/></g>' +
      '<path d="M11 21h14M11 26h9" stroke="' + A + '" stroke-width="2.4"/>' +
      '<g transform="rotate(-28 33 34)"><rect x="22" y="30" width="16" height="8" rx="1.5" fill="' + A + '"/><path d="M38 34h4"/><rect x="40" y="31.8" width="7" height="4.4" rx="2.2" fill="' + I + '"/></g>',
    cabinets:
      '<rect x="5" y="6" width="38" height="15" rx="1.5" fill="' + T + '"/><path d="M17.7 6v15M30.3 6v15"/><rect x="3" y="24" width="42" height="4" rx="1" fill="' + A + '"/>' +
      '<rect x="5" y="28" width="38" height="14" rx="1.5" fill="' + T + '"/><path d="M17.7 28v14M30.3 28v14"/>' +
      '<g fill="' + I + '" stroke="none"><circle cx="15" cy="17" r="1.1"/><circle cx="20.4" cy="17" r="1.1"/><circle cx="27.6" cy="17" r="1.1"/><circle cx="33" cy="17" r="1.1"/><circle cx="15" cy="32" r="1.1"/><circle cx="21" cy="32" r="1.1"/><circle cx="27" cy="32" r="1.1"/><circle cx="33" cy="32" r="1.1"/></g>',
    decks_fences:
      '<rect x="5" y="9" width="5" height="26" rx="1" fill="' + T + '"/><rect x="38" y="9" width="5" height="26" rx="1" fill="' + T + '"/><rect x="5" y="9" width="38" height="4" rx="1.5" fill="' + A + '"/>' +
      '<path d="M15 13v14M21 13v14M27 13v14M33 13v14"/><rect x="2" y="28" width="44" height="6" rx="1.5" fill="' + T + '"/><path d="M13 28v6M24 28v6M35 28v6"/>' +
      '<path d="M8 34v8M40 34v8M18 34v8M30 34v8"/>',
    fencing:
      '<path d="M7 41V16l3.5-5L14 16v25z" fill="' + T + '"/><path d="M16 41V16l3.5-5L23 16v25z" fill="' + T + '"/><path d="M25 41V16l3.5-5L32 16v25z" fill="' + T + '"/><path d="M34 41V16l3.5-5L41 16v25z" fill="' + T + '"/>' +
      '<path d="M3 22h42M3 33h42" stroke="' + A + '" stroke-width="3"/><path d="M2 41h44"/>',
    remodeling:
      '<g transform="rotate(45 24 24)"><rect x="19" y="4" width="10" height="40" rx="1.5" fill="' + T + '"/><path d="M19 11h4M19 17h3M19 23h4M19 29h3M19 35h4"/></g>' +
      '<g transform="rotate(-45 24 24)"><rect x="21.2" y="14" width="5.6" height="30" rx="2.4" fill="' + A + '"/><path d="M12 6c0-2 2-3 4-3h12c3 0 5 1 5 3v6c0 1.5-1 2.5-2.5 2.5h-17C12.5 14.5 12 13.5 12 12z" fill="' + I + '" stroke="' + I + '"/></g>',
    epoxy_floors:
      '<path d="M13 23h22l10 19H3z" fill="' + T + '"/><path d="M24 23v19M18.5 23 13 42M29.5 23 35 42M7 32h34M5 37h38"/>' +
      '<path d="M12 4c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z" fill="' + A + '"/><path d="M36 6v10M31 11h10M32.5 7.5l7 7M39.5 7.5l-7 7" stroke="' + B + '" stroke-width="1.6"/>',
    industrial:
      '<rect x="7" y="5" width="6" height="16" fill="' + T + '"/><path d="M5 41V22l12-8v8l12-8v8l12-8v27z" fill="' + T + '"/>' +
      '<g fill="' + W + '"><rect x="9" y="27" width="6" height="5"/><rect x="21" y="27" width="6" height="5"/><rect x="33" y="27" width="6" height="5"/></g><rect x="19" y="34" width="9" height="7" fill="' + A + '"/>' +
      '<path d="M10 2c2-1 3.5 0 3.5 1.5" stroke="' + B + '"/><path d="M3 41h42"/>',
    brush:
      '<g transform="rotate(40 24 24)"><rect x="20.5" y="3" width="7" height="17" rx="3.5" fill="' + T + '"/><rect x="19" y="20" width="10" height="7" rx="1.5" fill="' + A + '"/>' +
      '<path d="M19 27h10v8c0 5-2.500 8-5 9-2.500-1-5-4-5-9z" fill="' + T + '"/><path d="M21.500 35c0 3 1 5 2.500 6 1.500-1 2.500-3 2.500-6z" fill="' + A + '" stroke="none"/></g>',
    roller:
      '<rect x="5" y="6" width="32" height="12" rx="3.5" fill="' + A + '"/><path d="M37 12h5v12H21v6"/><rect x="18" y="30" width="6" height="13" rx="2.4" fill="' + T + '"/>',
    shield:
      '<path d="M24 5 8 11v12c0 10 7 16 16 20 9-4 16-10 16-20V11z" fill="' + T + '"/><path d="M16.5 24l5.5 5.5 10-11" stroke="' + A + '" stroke-width="3.2"/>',
    pin:
      '<path d="M24 44S10 31 10 20a14 14 0 0 1 28 0c0 11-14 24-14 24z" fill="' + T + '"/><circle cx="24" cy="20" r="5.5" fill="' + A + '"/>',
    crew:
      '<circle cx="17" cy="15" r="6" fill="' + T + '"/><path d="M5 40c0-8 5-13 12-13s12 5 12 13z" fill="' + T + '"/><circle cx="33" cy="17" r="5" fill="' + A + '"/><path d="M31 28c8-1 13 4 13 12H33" />',
    dollar:
      '<circle cx="24" cy="24" r="18" fill="' + T + '"/><path d="M30 18c-1-3-3.500-4-6-4-3.500 0-6 2-6 4.800s2.500 4 6 5 6 2.200 6 5.200-2.500 5-6 5c-3 0-5.500-1.200-6.500-4M24 9.500v29" stroke="' + I + '"/>',
    doc:
      '<path d="M11 5h18l9 9v29H11z" fill="' + T + '"/><path d="M29 5v9h9"/><path d="M17 24h14M17 30h14M17 36h8" stroke="' + A + '" stroke-width="2.4"/>',
    check:
      '<circle cx="24" cy="24" r="18" fill="' + T + '"/><path d="M15 25l7 7 12-14" stroke="#0a7a3d" stroke-width="3.4"/>'
  };
  P.builder = P.new_construction;
  P.custom = P.brush;
  window.pmIcon = function (name, size) {
    var s = size || 48, body = P[name] || P.brush;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" fill="none" stroke="' + I +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  };
  window.pmIconNames = Object.keys(P);
})();

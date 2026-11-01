// Nations icons: simple glyphs for every unit, building and space project, on a 24x24 grid.
// Each icon is a list of [pathData, how]: 'f' fill, 's' stroke, 'c' a cut-out stroked in the background colour.
// draw() paints one on a canvas; svg() returns inline SVG markup for the panels.
(function (root) {
'use strict';
// a horse head; x, y = top-left corner, k = scale (natural size 14 x 19)
const horse = (x, y, k) => {
  const P = (a, b) => `${+(x + a * k).toFixed(2)} ${+(y + b * k).toFixed(2)}`;
  return `M${P(1, 19)}C${P(2, 15)} ${P(4, 13)} ${P(4, 11)}L${P(1, 10)}C${P(0, 9.5)} ${P(-0.3, 8)} ${P(0.5, 7)}L${P(4, 3)}L${P(6, 1.8)}L${P(7, 0)}L${P(8.5, 2.4)}C${P(11.5, 3.5)} ${P(13.5, 6)} ${P(13.5, 10)}L${P(14, 19)}Z`;
};
const circle = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
// radiation trefoil blades
const trefoil = () => [90, 210, 330].map(a => {
  const pt = (r, d) => { const t = (a + d - 180) * Math.PI / 180; return `${(12 + r * Math.cos(t)).toFixed(2)} ${(12 + r * Math.sin(t)).toFixed(2)}`; };
  return `M${pt(3, -30)}L${pt(9.5, -30)}A9.5 9.5 0 0 1 ${pt(9.5, 30)}L${pt(3, 30)}A3 3 0 0 0 ${pt(3, -30)}z`;
}).join('');
const star = (cx, cy, R, r) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i & 1 ? r : R; d += (i ? 'L' : 'M') + (cx + q * Math.cos(a)).toFixed(2) + ' ' + (cy + q * Math.sin(a)).toFixed(2); } return d + 'z'; };
const leaf = (y, s) => `M12 ${y}c${-3 * s} 0 ${-4.5 * s} -2 ${-4.5 * s} -4.2c${2.6 * s} 0 ${4.5 * s} 1.6 ${4.5 * s} 4.2z`;
const rocket = [['M12 2c3 2.5 4 6.5 3.5 12h-7C8 8.5 9 4.5 12 2z', 'f'], ['M8.6 10.5l-3.2 5 3.4.4zM15.4 10.5l3.2 5-3.4.4z', 'f'], ['M10.3 15.5h3.4L12 21.5z', 'f'], [circle(12, 8, 1.4), 'c']];

const ICONS = {
  // ── units ──
  settler:     [['M6 21.5V3', 's'], ['M6.5 3.5h11.5l-2.6 4.2 2.6 4.3H6.5z', 'f'], ['M3 21.5h7', 's']],
  scout:       [['M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z', 's'], [circle(12, 12, 3.2), 'f']],
  warrior:     [['M3.5 20.5l6-6', 's'], ['M8.2 13.2l8.6-9.1c1.4-1.5 3.6-1.4 4.6-.3s1.1 3.2-.4 4.6l-9.1 8.6c-1.2 1.1-2.6 1.2-3.5.3s-.8-2.4-.2-4.1z', 'f'], ['M14.5 6.5l.8.8M17.5 9.5l.8.8M17 4.5l.8.8', 'c']],
  archer:      [['M6 3c8.5 0 15 6.5 15 15', 's'], ['M6 3l15 15', 's'], ['M3 21L16.5 7.5', 's'], ['M17.5 6.5l-4.5.6 3.9 3.9z', 'f']],
  spearman:    [['M3.5 20.5L15 9', 's'], ['M13 7.5l8.5-5-5 8.5z', 'f'], ['M11 9.5l3.5 3.5', 's']],
  horseman:    [[horse(5, 2.5, 1), 'f'], [circle(9.6, 7.3, 0.9), 'c']],
  swordsman:   [['M4 20L19.5 4.5', 's'], ['M6.2 13l4.8 4.8', 's'], ['M19.5 4.5l1-2-2 1', 's']],
  catapult:    [['M2.5 18h17', 's'], [circle(6, 19, 2), 'f'], [circle(16, 19, 2), 'f'], ['M8 18l3.5-6.5 3.5 6.5', 's'], ['M10 17L18 7.5', 's'], [circle(19, 6, 2.4), 'f']],
  crossbowman: [['M3 10.5c3-4.5 15-4.5 18 0', 's'], ['M12 6.5V21', 's'], ['M3 10.5l9 4 9-4', 's'], ['M9.5 18.5h5', 's']],
  pikeman:     [['M11 22V7', 's'], ['M11 1.5l-2.8 5.5h5.6z', 'f'], ['M11.5 8.5c3.5 0 6.5 2.2 6.5 6-2.3-1.3-4.2-1.6-6.5-1.6z', 'f']],
  knight:      [['M5.5 21.5V13a6.5 6.5 0 0 1 13 0v8.5z', 'f'], ['M8 13.5h8', 'c'], ['M12 13.5v5.5', 'c'], ['M12 6.5C12 3.5 14.5 1.8 19 2', 's']],
  musketman:   [['M7.5 13.8L21.5 7', 's'], ['M8.5 13.2L3 16l1.6 3.8 6.3-3.6z', 'f'], [circle(21, 4, 1.6), 's']],
  bombard:     [['M3 15.5l12.5-7 2.7 4.6-12.5 7z', 'f'], [circle(19.5, 9.5, 2.3), 's'], [circle(9, 17.5, 3.2), 's']],
  cavalry:     [[horse(2, 4, 0.9), 'f'], [circle(6.1, 8.5, 0.8), 'c'], ['M21.5 2c-.5 6-2 11-5 16', 's'], ['M14.8 15.5l4.4 1.8', 's']],
  gatling:     [['M2.5 8.5h13M2.5 12h13M2.5 15.5h13', 's'], ['M16 7v10', 's'], ['M16 12h5', 's'], ['M9 15.5l-3 6M10 15.5l3 6', 's']],
  rifleman:    [['M7 14L22 6.5', 's'], ['M8 13.4l-5.5 2.8 1.6 3.8 6.3-3.6z', 'f'], ['M19 8l3.5-3.5-1.2 4z', 'f'], ['M13 11l.8 2', 's']],
  fieldart:    [['M2.5 14.5L21 7', 's'], [circle(9, 16.5, 3.8), 's'], ['M9 12.7v7.6M5.2 16.5h7.6', 's'], ['M9 16.5l-6.5 5', 's']],
  infantry:    [['M3.5 15c0-5.5 3.7-9 8.5-9s8.5 3.5 8.5 9z', 'f'], ['M1.5 15h21', 's'], ['M7 15.5c0 3.2 2.2 5.5 5 5.5s5-2.3 5-5.5', 's']],
  machinegun:  [['M2.5 8.5h13.5v3.5H2.5z', 'f'], ['M16 10.2h5.5', 's'], ['M9.5 12l-4.2 9M9.5 12l4.2 9M9.5 12v9', 's'], ['M5 12c0 3-1.3 4.6-3 5', 's']],
  tank:        [['M4.5 14h15a2.75 2.75 0 0 1 0 5.5h-15a2.75 2.75 0 0 1 0-5.5z', 'f'], [circle(5.5, 16.75, 1), 'c'], [circle(10, 16.75, 1), 'c'], [circle(14.5, 16.75, 1), 'c'], [circle(19, 16.75, 1), 'c'], ['M6.5 13V9.5h8.5V13z', 'f'], ['M15 11h7', 's']],
  rocketart:   rocket,
  mech:        [['M2.5 15.5v-4l3.5-3.5h10l5.5 4v3.5z', 'f'], [circle(6.5, 17.5, 2.4), 'f'], [circle(12, 17.5, 2.4), 'f'], [circle(17.5, 17.5, 2.4), 'f'], ['M7 11.5h3M12.5 11.5h3', 'c']],
  armor:       [['M2.5 14.5h19l-2.5 5H5z', 'f'], ['M6.5 13.5l2-4.5h7.5l2 4.5z', 'f'], ['M16 11h7', 's'], ['M5 17h14', 'c']],
  nuke:        [[trefoil(), 'f'], [circle(12, 12, 1.8), 'f']],
  // ── buildings ──
  monument:    [['M10 20.5l.9-14.5L12 3l1.1 3 .9 14.5z', 'f'], ['M6.5 21h11', 's']],
  granary:     [['M12 21.5V5', 's'], [leaf(19, 1), 'f'], [leaf(19, -1), 'f'], [leaf(14, 1), 'f'], [leaf(14, -1), 'f'], [leaf(9, 1), 'f'], [leaf(9, -1), 'f'], ['M12 6.2c-1.4-1-1.4-3.2 0-4.6 1.4 1.4 1.4 3.6 0 4.6z', 'f']],
  walls:       [['M2.5 21V8h3.5v3h3.5V8h5v3H18V8h3.5v13z', 'f'], ['M10 21v-4a2 2 0 0 1 4 0v4', 'c']],
  barracks:    [['M12 2.5l8 3v6.5c0 5-3.6 8.2-8 9.5-4.4-1.3-8-4.5-8-9.5V5.5z', 'f'], ['M8.2 8.5l7.6 7.6M15.8 8.5l-7.6 7.6', 'c']],
  library:     [['M12 6.2C10 4.6 7 4 2.5 4v14c4.5 0 7.5.6 9.5 2.2 2-1.6 5-2.2 9.5-2.2V4C17 4 14 4.6 12 6.2z', 'f'], ['M12 6.5v13', 'c']],
  market:      [['M2.5 9.5l2.2-5.5h14.6l2.2 5.5z', 'f'], ['M4.5 10v10.5h15V10', 's'], ['M9.5 20.5V15h5v5.5', 's']],
  aqueduct:    [['M1.5 5.5h21v3.5h-21z', 'f'], ['M3 21v-6a3 3 0 0 1 6 0v6M9 21v-6a3 3 0 0 1 6 0v6M15 21v-6a3 3 0 0 1 6 0v6', 's'], ['M3 9v12M21 9v12', 's']],
  workshop:    [['M10 11l9.5 9.5', 's'], ['M2.5 8.5l6-6 4.5 4.5-6 6z', 'f'], ['M14 3.5l3 3', 's']],
  castle:      [['M6 21.5V8H4.5V3h3v2.2h2.5V3h4v2.2h2.5V3h3v5H18v13.5z', 'f'], ['M10 21.5v-4a2 2 0 0 1 4 0v4', 'c'], ['M12 10v2.5', 'c']],
  university:  [['M12 4L1.5 9.2 12 14.4l10.5-5.2z', 'f'], ['M6 11.5v5c3.3 2.6 8.7 2.6 12 0v-5', 's'], ['M21 9.5v6', 's']],
  bank:        [['M12 2L2 8h20z', 'f'], ['M5 10.5v7.5M9.7 10.5v7.5M14.3 10.5v7.5M19 10.5v7.5', 's'], ['M2 20.5h20', 's']],
  observatory: [['M4 20.5V13a8 8 0 0 1 16 0v7.5z', 'f'], ['M12.5 12.5L17 6', 'c'], ['M2 21h20', 's']],
  fortress:    [[star(12, 12.5, 10, 5), 'f'], [circle(12, 12.5, 2.2), 'c']],
  factory:     [['M2 21.5v-10l5-3v3l5-3v3l5-3V2.5h4.5v19z', 'f'], ['M5.5 16h2M10 16h2M14.5 16h2', 'c']],
  hospital:    [['M9 3h6v6h6v6h-6v6H9v-6H3V9h6z', 'f']],
  powerplant:  [['M13.5 1.5L4 14h7l-1.5 8.5L20 10h-7.2z', 'f']],
  lab:         [['M10 3v6.2L4 19.5c-.6 1 .1 2 1.2 2h13.6c1.1 0 1.8-1 1.2-2L14 9.2V3z', 'f'], ['M7.2 15.5h9.6', 'c'], ['M8 3h8', 's']],
  spaceport:   rocket.concat([['M3 22h18', 's']]),
  // ── space projects ──
  satellite:   [['M9.5 9.5h5v5h-5z', 'f'], ['M1.5 9h6v6h-6zM16.5 9h6v6h-6z', 'f'], ['M7.5 12h9', 's'], ['M12 9.5V5.5', 's'], [circle(12, 4.5, 1.4), 'f']],
  moon:        [['M15 2.5a9.5 9.5 0 1 0 6.5 13.5A7.5 7.5 0 0 1 15 2.5z', 'f']],
  mars:        [[circle(12, 12, 6.2), 'f'], ['M1.5 13.5c0-2.2 4.7-4 10.5-4s10.5 1.8 10.5 4-4.7 4-10.5 4S1.5 15.7 1.5 13.5z', 's'], ['M7 11h3M13 14h4', 'c']],
  // ── orders ──
  explore:     [[circle(12, 12, 9.5), 's'], ['M15.8 8.2l-2 5.6-5.6 2 2-5.6z', 'f']],
};

const cache = {};
// Paint icon k centred on (x, y), size px across, in colour col, cut-outs in cut
function draw(ctx, k, x, y, size, col, cut) {
  const I = ICONS[k]; if (!I) return;
  if (!cache[k]) cache[k] = I.map(([d, how]) => [new Path2D(d), how]);
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 24, size / 24);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.2;
  for (const [p, how] of cache[k]) {
    if (how === 'f') { ctx.fillStyle = col; ctx.fill(p); }
    else { ctx.strokeStyle = how === 'c' ? cut : col; ctx.lineWidth = how === 'c' ? 1.7 : 2.2; ctx.stroke(p); }
  }
  ctx.restore();
}
// Inline SVG; colours come from CSS currentColor and --cut
function svg(k, cls) {
  const I = ICONS[k]; if (!I) return '';
  return `<svg class="${cls || 'ico'}" viewBox="0 0 24 24" aria-hidden="true">` + I.map(([d, how]) => how === 'f'
    ? `<path d="${d}" fill="currentColor"/>`
    : `<path d="${d}" fill="none" stroke="${how === 'c' ? 'var(--cut,#14223f)' : 'currentColor'}" stroke-width="${how === 'c' ? 1.7 : 2.2}" stroke-linecap="round" stroke-linejoin="round"/>`).join('') + '</svg>';
}
root.NationsIcons = { ICONS, draw, svg };
})(typeof window !== 'undefined' ? window : globalThis);

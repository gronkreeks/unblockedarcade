// Leader portraits, drawn as SVG from each leader's look in frontier-leaders.js.
// Copied from frontier.html so other games (Nations) can draw the same faces.
(function (root) {
'use strict';
const { LEADERS } = root.FrontierLeaders;
const rgb = (c, a) => a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f).toString(16).padStart(2, '0')).join('');
}
const leaf = (x, y, rot, c) => `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3.6" ry="1.6" transform="rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${c}" stroke="${shade(c, -0.35)}" stroke-width=".5"/>`;
const HATS = {
  laurel: k => {
    let s = '';
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (1.04 + 0.42 * i / 6), x = 50 + Math.cos(a) * 18, y = 41 + Math.sin(a) * 18, r = a * 180 / Math.PI + 90;
      s += leaf(x, y, r, '#6a9a3a') + leaf(100 - x, y, -r, '#6a9a3a');
    }
    return s;
  },
  crown: k => `<path d="M34.5 31 L34.5 19 L40 25 L45 16 L50 23.5 L55 16 L60 25 L65.5 19 L65.5 31 Z" fill="${k.hatC}" stroke="${shade(k.hatC, -0.35)}" stroke-width=".8"/>
    <rect x="34.5" y="27.5" width="31" height="3.5" fill="${shade(k.hatC, -0.2)}"/><circle cx="42" cy="29.2" r="1.3" fill="#c23b22"/><circle cx="50" cy="29.2" r="1.5" fill="#2a6fd4"/><circle cx="58" cy="29.2" r="1.3" fill="#c23b22"/>
    <circle cx="45" cy="16" r="1.4" fill="${shade(k.hatC, 0.4)}"/><circle cx="55" cy="16" r="1.4" fill="${shade(k.hatC, 0.4)}"/>`,
  tiara: k => `<path d="M36 31 Q50 21 64 31 L62 32 Q50 25 38 32 Z" fill="${k.hatC}" stroke="${shade(k.hatC, -0.35)}" stroke-width=".6"/>
    <path d="M47 26 L50 19 L53 26 Z" fill="${k.hatC}"/><circle cx="50" cy="25.5" r="1.7" fill="#2a8fd4"/><circle cx="43" cy="27.6" r="1" fill="#c23b22"/><circle cx="57" cy="27.6" r="1" fill="#c23b22"/>`,
  crenel: k => `<path d="M35 31 L35 17 L40 17 L40 21 L45 21 L45 14 L55 14 L55 21 L60 21 L60 17 L65 17 L65 31 Z" fill="${k.hatC}" stroke="${shade(k.hatC, -0.35)}" stroke-width=".8"/>
    <rect x="35" y="26" width="30" height="2.5" fill="${shade(k.hatC, -0.25)}"/>`,
  nemes: k => {
    let s = `<path d="M31 38 Q31 21 50 20 Q69 21 69 38 L73 67 L62 63 L64 41 Q50 35 36 41 L38 63 L27 67 Z" fill="${k.hatC}"/>`;
    for (const y of [26, 31, 36]) s += `<path d="M${32 + (y - 26) * 0.1} ${y} Q50 ${y - 6} ${68 - (y - 26) * 0.1} ${y}" stroke="${k.hatC2}" stroke-width="1.8" fill="none"/>`;
    for (const y of [46, 53, 60]) s += `<path d="M28.5 ${y + 3} L37.5 ${y}" stroke="${k.hatC2}" stroke-width="1.8"/><path d="M71.5 ${y + 3} L62.5 ${y}" stroke="${k.hatC2}" stroke-width="1.8"/>`;
    return s + `<path d="M48.5 31 Q50 24 51.5 31 Z" fill="#d4a72c" stroke="#7a5a1a" stroke-width=".5"/>`;
  },
  fur: k => `<path d="M39 28 Q50 4 61 28 Z" fill="${k.hatC2}"/><circle cx="50" cy="8" r="2" fill="${shade(k.hatC2, 0.3)}"/>
    <path d="M31 35 Q50 25 69 35 L69 28 Q50 19 31 28 Z" fill="${k.hatC}" stroke="${shade(k.hatC, -0.3)}" stroke-width=".8"/>`,
  bicorne: k => `<path d="M17 33 Q50 0 83 33 Q50 24 17 33 Z" fill="${k.hatC}" stroke="#000" stroke-width=".6"/>
    <path d="M22 31.5 Q50 22 78 31.5" stroke="#d4a72c" stroke-width="1" fill="none"/>
    <circle cx="50" cy="22" r="4" fill="#2b3d7a"/><circle cx="50" cy="22" r="2.6" fill="#fff"/><circle cx="50" cy="22" r="1.3" fill="${k.hatC2}"/>`,
  tophat: k => `<rect x="36" y="5" width="28" height="23" fill="${k.hatC}"/><rect x="36" y="22" width="28" height="3.5" fill="#3a3a3a"/>
    <path d="M27 28 Q50 33 73 28 L73 31 Q50 36 27 31 Z" fill="${k.hatC}"/>`,
  feathers: k => {
    let s = '';
    for (let i = -4; i <= 4; i++) s += `<ellipse cx="50" cy="12" rx="3.6" ry="13" transform="rotate(${i * 15} 50 32)" fill="${i % 2 ? k.hatC2 : k.hatC}" stroke="${shade(k.hatC, -0.4)}" stroke-width=".5"/>`;
    return s + `<rect x="34" y="27.5" width="32" height="5.5" rx="2" fill="#d4a72c" stroke="#7a5a1a" stroke-width=".6"/><circle cx="50" cy="30.2" r="1.8" fill="#1f9a8a"/>`;
  },
  mian: k => {
    let s = `<path d="M38 31 L39 19 L61 19 L62 31 Z" fill="${k.hatC}"/><rect x="26" y="15" width="48" height="4.5" fill="${k.hatC}" stroke="${k.hatC2}" stroke-width=".7"/>`;
    for (let x = 28; x <= 72; x += 4.4) s += `<line x1="${x}" y1="19.5" x2="${x}" y2="31" stroke="${k.hatC2}" stroke-width=".5"/><circle cx="${x}" cy="25" r="1" fill="${k.hatC2}"/><circle cx="${x}" cy="30" r="1" fill="#c23b22"/>`;
    return s;
  },
  kabuto: k => `<path d="M50 20 L37 3 L41 3 L50 15 L59 3 L63 3 Z" fill="${k.hatC2}"/>
    <path d="M31.5 35 Q31 14 50 13.5 Q69 14 68.5 35 Q50 30 31.5 35 Z" fill="${k.hatC}"/>
    <path d="M32 30 L20 27 L22 44 L33 41 Z M68 30 L80 27 L78 44 L67 41 Z" fill="${shade(k.hatC, 0.15)}" stroke="${k.hatC2}" stroke-width=".8"/>
    <path d="M32 31.5 Q50 26.5 68 31.5" stroke="${k.hatC2}" stroke-width="1" fill="none"/><circle cx="50" cy="23" r="2.2" fill="${k.hatC2}"/>`,
  greek: k => `<path d="M29 22 Q46 -3 73 15 L69 20 Q50 7 33 25 Z" fill="${k.hatC2}"/>
    <path d="M33 35 Q33 16 50 15 Q67 16 67 35 Q50 29 33 35 Z" fill="${k.hatC}" stroke="${shade(k.hatC, -0.35)}" stroke-width=".8"/>`,
  turban: k => `<path d="M30 37 Q28 14 50 13 Q72 14 70 37 Q50 30 30 37 Z" fill="${k.hatC}"/>
    <path d="M31 30 Q50 18 69 30 M31 24 Q50 14 68 25" stroke="${shade(k.hatC, -0.15)}" stroke-width="1.2" fill="none"/>
    <circle cx="50" cy="24" r="3" fill="${k.hatC2}" stroke="#d4a72c" stroke-width="1"/><path d="M50 21 Q53 11 57 8 Q54 15 51.5 21.5 Z" fill="${k.hatC2}"/>`,
  viking: k => `<path d="M32 37 Q32 17 50 16 Q68 17 68 37 Z" fill="${k.hatC}"/><rect x="32" y="33" width="36" height="4" fill="${shade(k.hatC, -0.3)}"/>
    <path d="M50 16 L50 33" stroke="${shade(k.hatC, -0.3)}" stroke-width="2"/><rect x="48.4" y="35" width="3.2" height="12" rx="1" fill="${k.hatC}"/>`,
  inca: k => {
    let s = `<ellipse cx="48" cy="20" rx="1.8" ry="7" transform="rotate(-6 48 27)" fill="#fff"/><ellipse cx="52" cy="20" rx="1.8" ry="7" transform="rotate(6 52 27)" fill="#151515"/>
      <rect x="33.5" y="27" width="33" height="6" rx="2" fill="${k.hatC2}"/>`;
    for (let x = 36; x < 66; x += 4) s += `<rect x="${x}" y="28.5" width="2" height="3" fill="${k.hatC}"/>`;
    for (let x = 44; x <= 56; x += 1.5) s += `<line x1="${x}" y1="33" x2="${x}" y2="38" stroke="${k.hatC}" stroke-width="1.1"/>`;
    return s;
  },
  korean: k => `<ellipse cx="41" cy="16" rx="4.5" ry="2.3" transform="rotate(-40 41 16)" fill="${k.hatC}"/><ellipse cx="59" cy="16" rx="4.5" ry="2.3" transform="rotate(40 59 16)" fill="${k.hatC}"/>
    <path d="M42 24 Q50 9 58 24 Z" fill="${k.hatC}"/><path d="M35 33 Q35 20 50 19 Q65 20 65 33 Z" fill="${k.hatC}"/>`,
  headband: k => `<ellipse cx="38" cy="26" rx="3" ry="4.5" transform="rotate(-30 38 30)" fill="${k.hatC2}"/><ellipse cx="62" cy="26" rx="3" ry="4.5" transform="rotate(30 62 30)" fill="${k.hatC2}"/>
    <rect x="33.5" y="28" width="33" height="5.5" rx="2.5" fill="${k.hatC}"/><circle cx="39" cy="30.7" r="1" fill="#3a2a1a"/><circle cx="46" cy="30" r="1" fill="#3a2a1a"/><circle cx="54" cy="31" r="1" fill="#3a2a1a"/><circle cx="61" cy="30.4" r="1" fill="#3a2a1a"/>`,
  cap: k => `<path d="M34 34 Q32 10 50 9 Q68 10 66 34 Z" fill="${k.hatC}"/><rect x="34" y="30" width="32" height="4.5" fill="${k.hatC2}"/>`,
  scarf: k => `<path d="M32 38 Q31 19 50 18 Q69 19 68 38 Q60 30 50 30 Q40 30 32 38 Z" fill="${k.hatC}"/>
    <path d="M66 30 Q74 36 72 48 L67 46 Q68 38 64 33 Z" fill="${k.hatC}"/><circle cx="50" cy="24" r="2.2" fill="${k.hatC2}"/>`,
  corno: k => `<path d="M34 34 Q33 17 48 14 Q58 11 63 18 Q66 24 66 34 Z" fill="${k.hatC}" stroke="${shade(k.hatC, -0.35)}" stroke-width=".8"/>
    <path d="M32 31 Q50 27 68 31 L68 35 Q50 31 32 35 Z" fill="${k.hatC2}"/><circle cx="50" cy="24" r="1.8" fill="#c23b22"/>`,
};
const HAIR = {
  short: c => `<path d="M34.3 41 Q33.5 23.5 50 22.5 Q66.5 23.5 65.7 41 Q63 31 50 30 Q37 31 34.3 41 Z" fill="${c}"/>`,
  long: c => `<path d="M34.3 41 Q33.5 23.5 50 22.5 Q66.5 23.5 65.7 41 Q63 31 50 30 Q37 31 34.3 41 Z" fill="${c}"/><path d="M34.3 40 Q32.5 52 34.5 61 L37.5 58 Q36.5 48 37.5 37 Z M65.7 40 Q67.5 52 65.5 61 L62.5 58 Q63.5 48 62.5 37 Z" fill="${c}"/>`,
  bun: c => `<path d="M34.3 41 Q33.5 24 50 23 Q66.5 24 65.7 41 Q62 30 50 29.5 Q38 30 34.3 41 Z" fill="${c}"/>`,
  curly: c => [[36, 37], [38, 30.5], [43.5, 26], [50, 24.5], [56.5, 26], [62, 30.5], [64, 37]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.2" fill="${c}"/>`).join(''),
  bald: c => `<path d="M34.5 46 Q34.5 37 37.5 35.5 L38.5 47 Z M65.5 46 Q65.5 37 62.5 35.5 L61.5 47 Z" fill="${c}"/>`,
};
const BEARD = {
  full: c => `<path d="M34.8 45 Q35 63 50 67 Q65 63 65.2 45 Q62.5 56.5 56 57 Q50 54.8 44 57 Q37.5 56.5 34.8 45 Z" fill="${c}"/>` + BEARD.mustache(c),
  long: c => `<path d="M34.8 45 Q34 68 50 80 Q66 68 65.2 45 Q62.5 56.5 56 57 Q50 54.8 44 57 Q37.5 56.5 34.8 45 Z" fill="${c}"/>` + BEARD.mustache(c),
  goatee: c => `<path d="M45.5 57.5 Q50 67.5 54.5 57.5 Q50 59.5 45.5 57.5 Z" fill="${c}"/>` + BEARD.mustache(c),
  mustache: c => `<path d="M42.5 54.5 Q46.5 51.3 50 53.3 Q53.5 51.3 57.5 54.5 Q53.5 55.2 50 54.8 Q46.5 55.2 42.5 54.5 Z" fill="${c}"/>`,
  chinstrap: c => `<path d="M34.8 45 Q36 63 50 66.5 Q64 63 65.2 45 L63 45 Q62 59.5 50 62 Q38 59.5 37 45 Z" fill="${c}"/>`,
};
let svgSeq = 0;
function portraitSVG(li, col) {
  const k = LEADERS[li].look, id = 'pg' + (svgSeq++), sd = shade(k.skin, -0.2), hairC = k.hairC || '#222';
  const bg = col || [70, 90, 130];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="${id}" cx="50%" cy="38%" r="70%">
    <stop offset="0" stop-color="${rgb(bg.map(v => Math.min(255, v * 1.15 + 20)))}"/><stop offset="1" stop-color="${rgb(bg.map(v => v * 0.3 | 0))}"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#${id})"/>`;
  if (k.hair === 'long') s += `<path d="M31 40 Q28 70 33 84 L67 84 Q72 70 69 40 Z" fill="${shade(hairC, -0.15)}"/>`;
  if (k.hair === 'bun' && k.hat !== 'crown') s += `<circle cx="50" cy="22" r="8" fill="${hairC}"/>`;
  s += `<path d="M6 101 Q8 77 31 71.5 Q50 66 69 71.5 Q92 77 94 101 Z" fill="${k.robe}"/>
    <path d="M20 101 Q22 82 31 76 M80 101 Q78 82 69 76" stroke="${shade(k.robe, -0.25)}" stroke-width="1.5" fill="none"/>
    <path d="M37 70 L50 86 L63 70" stroke="${k.robe2}" stroke-width="4.5" fill="none" stroke-linejoin="round"/>
    <rect x="43" y="55" width="14" height="17" rx="5" fill="${sd}"/>
    <ellipse cx="34.5" cy="45.5" rx="3" ry="4.5" fill="${k.skin}"/><ellipse cx="65.5" cy="45.5" rx="3" ry="4.5" fill="${k.skin}"/>
    <ellipse cx="50" cy="43" rx="15.5" ry="18.5" fill="${k.skin}"/>`;
  if (HAIR[k.hair] && !(k.hat && ['nemes', 'kabuto', 'turban', 'viking', 'cap', 'greek'].includes(k.hat) && k.hair !== 'long')) s += HAIR[k.hair](hairC);
  const brow = k.hair === 'bald' ? hairC : shade(hairC, -0.1);
  s += `<path d="M40.5 39.3 Q44 37.6 47.5 39.1 M52.5 39.1 Q56 37.6 59.5 39.3" stroke="${brow}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="44" cy="43.8" rx="1.9" ry="1.5" fill="#1b1b1b"/><ellipse cx="56" cy="43.8" rx="1.9" ry="1.5" fill="#1b1b1b"/>
    <circle cx="44.6" cy="43.3" r=".5" fill="#fff"/><circle cx="56.6" cy="43.3" r=".5" fill="#fff"/>
    <path d="M50 44 Q48.4 49.8 47.8 50.8 Q50 52.4 52.2 50.8" stroke="${sd}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
  if (k.beard && BEARD[k.beard]) s += BEARD[k.beard](k.beardC || hairC);
  s += `<path d="M45.5 56.5 Q50 58.4 54.5 56.5" stroke="#7a3b2e" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  if (k.glasses) s += `<g stroke="#2a2a2a" stroke-width="1.1" fill="rgba(255,255,255,0.12)"><circle cx="44" cy="44" r="4.2"/><circle cx="56" cy="44" r="4.2"/></g><path d="M48.2 43.6 Q50 42.6 51.8 43.6" stroke="#2a2a2a" stroke-width="1" fill="none"/>`;
  if (k.hat && HATS[k.hat]) s += HATS[k.hat](k);
  return s + '</svg>';
}
root.LeaderPortraits = { portraitSVG, shade };
})(window);
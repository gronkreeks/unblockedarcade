// Ranked ladder shared by Chess, Frontier, Volley, Timberfall and Boxing (singleplayer, against bots).
// Bronze → Silver → Gold → Platinum → Diamond → Champion. Win the number of matches a game asks for
// in your rank to move up; each rank's bots are tougher. Losses never knock you down a rank.
// Each game keeps its own ladder in this browser (localStorage 'ranked-<game>').
// Placements: your first 5 ranked matches in a game test you against ascending bots. Match 1 is the
// Platinum bot; each win sends you up a rank for the next match, each loss down one. Win all 5 and you
// start at Champion; otherwise you start at the hardest bot you beat (Diamond at most), or Bronze.
// Above Champion is Challenger: the top 3 on each game's online leaderboard (see Challenger below).
//   const RK = Ranked.create('volley', { wins: [2, 3, 3, 4, 5] });
//   RK.tier → 0..5 (your rank) · RK.botTier → the bot to play next (differs during placements)
//   RK.card() → HTML · RK.begin() when a ranked match starts · RK.matchLabel → e.g. "Placement 2/5 · Diamond bot"
//   RK.record(won, stats) → result · RK.resultHTML(result) → HTML
(function () {
  'use strict';
  const TIERS = [
    { id: 'bronze',   name: 'Bronze',   a: '#e0a26a', b: '#8a4f1f' },
    { id: 'silver',   name: 'Silver',   a: '#eef2f7', b: '#7d8896' },
    { id: 'gold',     name: 'Gold',     a: '#ffe27a', b: '#b8860b' },
    { id: 'platinum', name: 'Platinum', a: '#a8fff3', b: '#1f8f86' },
    { id: 'diamond',  name: 'Diamond',  a: '#bcd9ff', b: '#3463d6' },
    { id: 'champion', name: 'Champion', a: '#ffb3e0', b: '#7b2fd6' },
  ];
  const TOP = TIERS.length - 1;
  // A mod menu (cheat userscript) leaves these behind. Ranked results aren't saved while one is running.
  const modded = () => { try { return !!(window.EduMod || window.EduModBind || window.EduModActive) || Object.keys(window).some(k => /^__edu/i.test(k)); } catch (e) { return false; } };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Rank emblems (original designs). Each rank has its own silhouette and gets more elaborate as you
  // climb: plain shield → finned shield → laurel crest → winged crest with a gem → cut diamond with
  // crystal shards → crowned, winged crest on a starburst. Metal gradient, a focal piece, a top shine,
  // and a dark outline so they read at any size and on any background.
  const EM = [
    { m1: '#ffd2a6', m2: '#c77a3a', m3: '#7a4119', ink: '#3b1d08' },              // bronze
    { m1: '#ffffff', m2: '#c3ccd8', m3: '#6e7a8a', ink: '#2a323d' },              // silver
    { m1: '#fff3b0', m2: '#f2c230', m3: '#a86f00', ink: '#4a3000' },              // gold
    { m1: '#e6fffb', m2: '#7fe3d6', m3: '#1d8a80', ink: '#073a36', g1: '#ffffff', g2: '#3fd6c6', g3: '#0f7a71' },   // platinum
    { m1: '#eef6ff', m2: '#8fb8ff', m3: '#2f5bd6', ink: '#0d2463', g1: '#ffffff', g2: '#9cc8ff', g3: '#3466e8' },   // diamond
    { m1: '#fff3c4', m2: '#ffc93a', m3: '#c27a00', ink: '#2c0b4d', g1: '#fff0fb', g2: '#ff7ccc', g3: '#8a2fd6', s1: '#c05cff', s2: '#5a1aa8' }, // champion
    { m1: '#fff6d8', m2: '#ffcf4a', m3: '#b86b00', ink: '#3a0610', g1: '#ffe3e3', g2: '#ff3b4f', g3: '#8a0018', s1: '#ffd36b', s2: '#ff5a1f', r1: '#ff4a5e', r2: '#7a0016' }, // challenger
  ];
  function emblem(tier, size) {
    const c = EM[tier], u = 'rk' + tier + '_' + (Math.random() * 1e9 | 0);
    const lin = (id, a, b, cc, x2, y2) => `<linearGradient id="${u}${id}" x1="0" y1="0" x2="${x2 || 0}" y2="${y2 == null ? 1 : y2}"><stop offset="0" stop-color="${a}"/><stop offset="0.5" stop-color="${b}"/><stop offset="1" stop-color="${cc}"/></linearGradient>`;
    const M = `url(#${u}m)`, D = `url(#${u}d)`, G = `url(#${u}g)`;
    const defs = lin('m', c.m1, c.m2, c.m3) + lin('d', c.m3, c.m2, c.m3, 1, 1) + (c.g1 ? lin('g', c.g1, c.g2, c.g3, 1, 1) : '') +
      (c.s1 ? lin('s', c.s1, c.s2, c.s2) : '') + (c.r1 ? lin('r', c.r1, c.r1, c.r2) : '');
    const ink = c.ink, line = `stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"`;
    const mirror = s => `${s}<g transform="translate(64 0) scale(-1 1)">${s}</g>`;
    const shield = (d, inner) => `<path d="${d}" fill="${M}" ${line}/>` + (inner ? `<path d="${inner}" fill="${D}" opacity="0.55"/>` : '');
    const SH = 'M32 7 L50 13 V29 C50 41 42 50 32 56 C22 50 14 41 14 29 V13 Z';
    const SH_IN = 'M32 12.5 L45 17 V29 C45 38 39.5 45 32 49.5 C24.5 45 19 38 19 29 V17 Z';
    const shine = '<path d="M17 14.6 L32 9.6 V19 C25 20.5 20 22.5 17 25 Z" fill="#fff" opacity="0.28"/>';
    const chev = y => `<path d="M23 ${y} L32 ${y + 6} L41 ${y} V${y + 5.5} L32 ${y + 11.5} L23 ${y + 5.5} Z" fill="${c.m1}" ${line} stroke-width="1.6"/>`;
    const star = (cx, cy, r, fill, sw) => {
      let p = '';
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; p += (k ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(2) + ' ' + (cy + rr * Math.sin(a)).toFixed(2); }
      return `<path d="${p}Z" fill="${fill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    };
    const gem = (cx, cy, w, h) => `<path d="M${cx} ${cy - h} L${cx + w} ${cy - h * 0.15} L${cx} ${cy + h} L${cx - w} ${cy - h * 0.15} Z" fill="${G}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M${cx - w} ${cy - h * 0.15} H${cx + w} M${cx} ${cy - h} L${cx - w * 0.4} ${cy - h * 0.15} L${cx} ${cy + h} L${cx + w * 0.4} ${cy - h * 0.15} Z" fill="none" stroke="${ink}" stroke-width="0.8" opacity="0.55"/>
      <path d="M${cx} ${cy - h} L${cx - w * 0.4} ${cy - h * 0.15} L${cx - w} ${cy - h * 0.15} Z" fill="#fff" opacity="0.55"/>`;
    const wing = (o) => mirror(`<path d="M${17 + o} 24 C10 18 4 18 1.5 23 C6 23.5 8.5 25 10.5 27 C5 27.5 2.5 31 2 35 C6.5 33 9.5 33 12.5 34 C8 36.5 6.5 40 7 44 C11 40.5 14.5 39.5 ${18 + o} 39.5 Z" fill="${M}" ${line} stroke-width="1.8"/>`);
    let body = '';
    switch (tier) {
      case 0:   // Bronze: plain shield, one chevron
        body = shield(SH, SH_IN) + chev(27) + shine +
          [[20.5, 17.5], [43.5, 17.5], [32, 46]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7" fill="${c.m1}" stroke="${ink}" stroke-width="1"/>`).join(''); break;
      case 1:   // Silver: shield with side fins, two chevrons and a spark on top
        body = mirror(`<path d="M15 16 L5 11 L8 24 L14 30 Z" fill="${M}" ${line} stroke-width="1.8"/>`) +
          shield(SH, SH_IN) + chev(22) + chev(31) + shine + star(32, 7.5, 5, c.m1, 1.4); break;
      case 2: { // Gold: laurel wreath around a shield with a star
        // Leaves along an arc round the left side (mirrored for the right), each turned to follow the curve
        let leaves = '';
        for (const deg of [112, 136, 160, 184, 208]) {
          const a = deg * Math.PI / 180, x = (32 + 25 * Math.cos(a)).toFixed(2), y = (33 + 25 * Math.sin(a)).toFixed(2);
          leaves += `<ellipse cx="${x}" cy="${y}" rx="3.2" ry="7" transform="rotate(${deg} ${x} ${y})" fill="${M}" stroke="${ink}" stroke-width="1.4"/>`;
        }
        body = mirror(leaves) + shield(SH, SH_IN) + star(32, 31, 10, c.m1, 1.7) + shine; break;
      }
      case 3:   // Platinum: angular crest with wings and a cut gem
        body = wing(0) + shield('M32 5 L50 13 V33 L32 58 L14 33 V13 Z', 'M32 10.5 L45 16.5 V32 L32 51 L19 32 V16.5 Z') +
          gem(32, 31, 9, 13) + '<path d="M16.6 14.8 L32 8 V18 L16.6 25 Z" fill="#fff" opacity="0.28"/>'; break;
      case 4:   // Diamond: a cut diamond with crystal shards
        body = mirror(`<path d="M15 24 L3 15 L8 30 Z" fill="${G}" ${line} stroke-width="1.6"/><path d="M17 33 L5 38 L19 41 Z" fill="${G}" ${line} stroke-width="1.6"/>`) +
          `<path d="M13 23 L22 10 H42 L51 23 L32 58 Z" fill="${G}" ${line}/>
          <path d="M22 10 L27 23 L32 10 L37 23 L42 10 M13 23 H51 M27 23 L32 58 L37 23" fill="none" stroke="${ink}" stroke-width="1.1" opacity="0.6"/>
          <path d="M22 10 L27 23 H13 Z M32 10 L27 23 H37 Z" fill="#fff" opacity="0.5"/><path d="M13 23 H27 L32 58 Z" fill="#fff" opacity="0.18"/>` +
          star(46, 9, 4.5, '#fff', 1); break;
      case 5: { // Champion: starburst, wings, crowned crest with a gem
        // A 12-point starburst behind everything, with long and short rays
        let rays = '';
        for (let k = 0; k < 24; k++) { const a = -Math.PI / 2 + k * Math.PI / 12, r = k % 2 ? 15 : (k % 4 ? 26 : 31); rays += (k ? 'L' : 'M') + (32 + r * Math.cos(a)).toFixed(2) + ' ' + (33 + r * Math.sin(a)).toFixed(2); }
        body = `<path d="${rays}Z" fill="${G}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>` + wing(2) +
          `<path d="M32 17 L46 22.5 V35 C46 44 40 50 32 55 C24 50 18 44 18 35 V22.5 Z" fill="url(#${u}s)" ${line}/>` +
          gem(32, 35, 7.5, 11) +
          `<path d="M20 20 L21.5 7 L27 12.5 L32 3 L37 12.5 L42.5 7 L44 20 Z" fill="${M}" ${line} stroke-width="1.8"/>
          <circle cx="21.5" cy="7" r="2" fill="${c.g2}" stroke="${ink}" stroke-width="1"/><circle cx="32" cy="3.4" r="2.2" fill="${c.g2}" stroke="${ink}" stroke-width="1"/><circle cx="42.5" cy="7" r="2" fill="${c.g2}" stroke="${ink}" stroke-width="1"/>
          <path d="M21 16 H43" stroke="${ink}" stroke-width="1.2" opacity="0.5"/>`;
        break;
      }
      case 6: { // Challenger: a ring of flames, crossed swords, a ruby crest with a gold star, and a tall crown
        let fl = '';
        const n = 14, step = Math.PI * 2 / n, P = (r, a) => (32 + r * Math.cos(a)).toFixed(2) + ' ' + (34 + r * Math.sin(a)).toFixed(2);
        for (let k = 0; k < n; k++) {
          const a0 = -Math.PI / 2 + k * step, tip = a0 + step * 0.62, rr = k % 2 ? 27 : 31;
          fl += (k ? '' : 'M' + P(19, a0)) + ` Q${P(rr - 4, a0 + step * 0.1)} ${P(rr, tip)} Q${P(rr - 9, tip + step * 0.12)} ${P(19, a0 + step)}`;
        }
        const sword = rot => `<g transform="rotate(${rot} 32 34)"><path d="M30.6 6 L32 2.5 L33.4 6 V40 H30.6 Z" fill="${M}" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round"/>
          <rect x="25.5" y="40" width="13" height="3" rx="1.2" fill="${M}" stroke="${ink}" stroke-width="1.2"/><rect x="30.8" y="43" width="2.4" height="8" fill="${c.g3}" stroke="${ink}" stroke-width="1"/><circle cx="32" cy="52.5" r="2" fill="${M}" stroke="${ink}" stroke-width="1"/></g>`;
        body = `<path d="${fl} Z" fill="url(#${u}s)" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round"/>` +
          sword(-42) + sword(42) +
          `<path d="M32 17.5 L47 23 V35 C47 44.5 40.5 50.5 32 55.5 C23.5 50.5 17 44.5 17 35 V23 Z" fill="url(#${u}r)" ${line}/>
          <path d="M32 21 L43.6 25.4 V35 C43.6 42.6 38.6 47.6 32 51.6 C25.4 47.6 20.4 42.6 20.4 35 V25.4 Z" fill="none" stroke="${c.m2}" stroke-width="1.5"/>` +
          star(32, 36, 9.5, M, 1.5) + `<circle cx="32" cy="36.4" r="3" fill="${G}" stroke="${ink}" stroke-width="1"/>` +
          `<path d="M17.5 21 L18.5 7 L24 12 L27.5 3.5 L32 9.5 L36.5 3.5 L40 12 L45.5 7 L46.5 21 Z" fill="${M}" ${line} stroke-width="1.8"/>
          <circle cx="18.5" cy="7" r="1.9" fill="${c.g2}" stroke="${ink}" stroke-width="1"/><circle cx="27.5" cy="3.8" r="1.9" fill="${c.g2}" stroke="${ink}" stroke-width="1"/>
          <circle cx="36.5" cy="3.8" r="1.9" fill="${c.g2}" stroke="${ink}" stroke-width="1"/><circle cx="45.5" cy="7" r="1.9" fill="${c.g2}" stroke="${ink}" stroke-width="1"/>
          <path d="M18.4 17.5 H45.6" stroke="${ink}" stroke-width="1.2" opacity="0.5"/><path d="M19 9 L24 12 L22 18 H19 Z" fill="#fff" opacity="0.3"/>` +
          star(9, 12, 3.2, '#fff', 0.8) + star(55, 56, 2.6, '#fff', 0.8);
        break;
      }
    }
    return `<svg class="rk-emblem" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs>${defs}</defs>${body}</svg>`;
  }

  const CSS = `
  .rk-card { display: flex; align-items: center; gap: 0.9rem; text-align: left; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.14); border-radius: 14px; padding: 0.8rem 1rem; color: #fff; }
  .rk-card .rk-emblem { flex: none; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4)); }
  .rk-info { min-width: 0; flex: 1; }
  .rk-name { font-weight: 900; font-size: 1.15rem; letter-spacing: 2px; text-transform: uppercase; line-height: 1.1; }
  .rk-sub { font-size: 0.78rem; font-weight: 600; opacity: 0.8; margin-top: 0.2rem; line-height: 1.4; }
  .rk-pips { display: flex; gap: 5px; margin-top: 0.45rem; flex-wrap: wrap; }
  .rk-pips i { width: 22px; height: 7px; border-radius: 4px; background: rgba(255,255,255,0.18); }
  .rk-pips i.on { background: var(--rk-a, #ffe27a); box-shadow: 0 0 6px var(--rk-a, #ffe27a); }
  .rk-ladder { display: flex; gap: 4px; margin-top: 0.5rem; align-items: center; }
  .rk-ladder .rk-emblem { opacity: 0.35; }
  .rk-ladder .rk-emblem.done, .rk-ladder .rk-emblem.cur { opacity: 1; }
  .rk-res { text-align: center; color: #fff; }
  .rk-res .rk-big { font-weight: 900; font-size: 1.05rem; letter-spacing: 2px; text-transform: uppercase; margin-top: 0.3rem; }
  .rk-res .rk-up { animation: rk-pop 0.7s cubic-bezier(.2,1.6,.4,1) both; }
  .rk-res .rk-line { font-size: 0.82rem; font-weight: 600; opacity: 0.85; margin-top: 0.25rem; }
  .rk-res .rk-pips { justify-content: center; }
  @keyframes rk-pop { from { transform: scale(0.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .rk-res .rk-up { animation: none; } }
  .rk-pl { display: flex; gap: 6px; margin-top: 0.45rem; }
  .rk-res .rk-pl { justify-content: center; }
  .rk-pl i { width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,0.14); border: 1.5px solid rgba(255,255,255,0.3); }
  .rk-pl i.w { background: #2ecc71; border-color: #a8f0c4; box-shadow: 0 0 6px rgba(46,204,113,0.7); }
  .rk-pl i.l { background: #e74c3c; border-color: #ffb3a8; }
  .rk-test { position: relative; flex: none; }
  .rk-test .rk-emblem { filter: grayscale(0.55) brightness(0.8) drop-shadow(0 3px 6px rgba(0,0,0,0.4)); }
  .rk-test b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; font-weight: 900; color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.8); }
  .rk-placing .rk-name { color: #fff; }
  .chl-line { margin-top: 0.35rem; }
  .chl-btn { display: inline-flex; align-items: center; gap: 0.35rem; margin-top: 0.45rem; padding: 0.3rem 0.7rem 0.3rem 0.45rem; border-radius: 999px; border: 1px solid rgba(255,155,94,0.55);
    background: linear-gradient(135deg, rgba(196,20,43,0.55), rgba(255,155,94,0.3)); color: #fff; font: inherit; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.5px; cursor: pointer; }
  .chl-btn:hover { filter: brightness(1.15); }
  .chl-btn:focus-visible { outline: 2px solid #ffcf4a; outline-offset: 2px; }
  .chl-res { margin-top: 0.7rem; padding-top: 0.6rem; border-top: 1px solid rgba(255,255,255,0.14); }
  .chl-ov { position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(5,4,12,0.72); backdrop-filter: blur(4px);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #fff; }
  .chl-box { width: min(520px, 100%); max-height: min(720px, 100%); display: flex; flex-direction: column; background: linear-gradient(170deg, #2a0d18, #140a1f 55%, #0d0a18);
    border: 1px solid rgba(255,155,94,0.4); border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(196,20,43,0.25); overflow: hidden; }
  .chl-head { display: flex; align-items: center; gap: 0.7rem; padding: 0.9rem 1rem 0.6rem; }
  .chl-head > div { flex: 1; min-width: 0; }
  .chl-title { font-weight: 900; font-size: 1.3rem; letter-spacing: 3px; text-transform: uppercase; color: #ff9b5e; text-shadow: 0 0 14px rgba(255,90,31,0.5); }
  .chl-tag { font-size: 0.78rem; font-weight: 600; opacity: 0.75; }
  .chl-x { width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.06); color: #fff; font-size: 1rem; cursor: pointer; }
  .chl-tabs { display: flex; gap: 0.3rem; padding: 0 1rem; overflow-x: auto; scrollbar-width: none; }
  .chl-tabs button { flex: none; padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.8);
    font: inherit; font-size: 0.8rem; font-weight: 800; cursor: pointer; }
  .chl-tabs button.on { background: linear-gradient(135deg, #c4142b, #ff7a3d); border-color: transparent; color: #fff; }
  .chl-how { padding: 0.65rem 1rem 0.4rem; font-size: 0.78rem; line-height: 1.45; opacity: 0.8; }
  .chl-how a { color: #ffcf4a; font-weight: 800; }
  .chl-list { flex: 1; min-height: 120px; overflow-y: auto; padding: 0.2rem 0.6rem 0.6rem; }
  .chl-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.55rem; border-radius: 10px; }
  .chl-row:nth-child(odd) { background: rgba(255,255,255,0.03); }
  .chl-row.top { background: linear-gradient(90deg, rgba(196,20,43,0.32), rgba(255,155,94,0.08)); }
  .chl-row.me { outline: 1.5px solid #ffcf4a; }
  .chl-rank { flex: none; width: 52px; display: flex; align-items: center; gap: 0.25rem; font-weight: 900; font-variant-numeric: tabular-nums; }
  .chl-rank b { min-width: 1.4em; text-align: right; }
  .chl-row:not(.top) .chl-rank b { margin-left: 30px; opacity: 0.7; }
  .chl-who { flex: 1; min-width: 0; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chl-who i { font-style: normal; color: #ffcf4a; font-weight: 700; }
  .chl-who small { display: block; font-size: 0.72rem; font-weight: 600; opacity: 0.65; }
  .chl-score { flex: none; font-weight: 900; font-size: 1.05rem; font-variant-numeric: tabular-nums; color: #ffcf4a; }
  .chl-empty, .chl-foot, .chl-gap { text-align: center; padding: 1rem; font-size: 0.85rem; opacity: 0.75; }
  .chl-gap { padding: 0.1rem; }
  .chl-foot { padding: 0.6rem; font-size: 0.72rem; }
  .chl-name { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.5rem; padding: 0.7rem 1rem 0.9rem; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.75rem; font-weight: 700; }
  .chl-name label { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; min-width: 160px; opacity: 0.9; }
  .chl-name input { padding: 0.45rem 0.6rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.35); color: #fff; font: inherit; font-size: 0.9rem; }
  .chl-name button { padding: 0.5rem 1rem; border-radius: 8px; border: 0; background: #ff7a3d; color: #1a0508; font: inherit; font-weight: 900; cursor: pointer; }
  .chl-msg { flex-basis: 100%; min-height: 1em; opacity: 0.8; }`;
  function injectCSS() {
    if (document.getElementById('rk-css')) return;
    const s = document.createElement('style'); s.id = 'rk-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ──────────── Challenger ────────────
  // The rank above Champion. Champions keep playing the Champion bot; each ranked win at Champion posts
  // a score to the server (server/challenger.js), which times the match itself. The top 3 on each
  // game's leaderboard are that game's Challengers. Your Challenger status is cached in this browser.
  const CHALLENGER = 6;
  const CR = { id: 'challenger', name: 'Challenger', a: '#ff9b5e', b: '#c4142b' };
  const CR_GAMES = {
    chess:      { name: 'Chess',      href: 'chess.html',      how: 'Fewer moves and a faster checkmate score more.',
                  stat: s => `${s.moves} move${s.moves === 1 ? '' : 's'}` },
    volley:     { name: 'Volley',     href: 'volley.html',     how: 'Win fast and by a big points margin. Dropping a round costs points.',
                  stat: s => `${s.pf}–${s.pa} points` },
    boxing:     { name: 'Boxing',     href: 'boxing.html',     how: 'Win fast and deal more damage than you take. Dropping a round costs points.',
                  stat: s => `${s.dealt}–${s.taken} damage` },
    timberfall: { name: 'Timberfall', href: 'timberfall.html', how: 'Be the last one standing, fast. Every kill and bit of damage adds points.',
                  stat: s => `${s.kills} kill${s.kills === 1 ? '' : 's'}` },
    frontier:   { name: 'Frontier',   href: 'frontier.html',   how: 'Conquer the world fast. Every nation you knock out adds points.',
                  stat: s => `${s.kills} knocked out` },
  };
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  function serverBase() {
    let p = null;
    try { p = new URLSearchParams(location.search).get('server'); } catch (e) { }
    const ws = p && /^(wss:\/\/|ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/.test(p) ? p : 'wss://api.eduarcade.online';
    return ws.replace(/^ws/, 'http').replace(/\/+$/, '');
  }
  async function api(path, body) {
    const r = await fetch(serverBase() + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({ error: 'The leaderboard server didn\'t answer.' }));
    if (!r.ok || j.error) throw new Error(j.error || 'The leaderboard server didn\'t answer.');
    return j;
  }
  // Your player key stays secret in this browser; the board only ever sees a hash of it (your id).
  function playerKey() {
    let k = lsGet('edu-player-key');
    if (!k || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
      const a = new Uint8Array(18); crypto.getRandomValues(a);
      k = btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      lsSet('edu-player-key', k); lsSet('edu-player-id', '');
    }
    return k;
  }
  async function playerId() {
    const have = lsGet('edu-player-id');
    if (have && /^[0-9a-f]{16}$/.test(have)) return have;
    try {
      const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('eduarcade-cr|' + playerKey()));
      const id = [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      lsSet('edu-player-id', id);
      return id;
    } catch (e) { return ''; }
  }
  const crName = () => lsGet('edu-cr-name') || lsGet('edu-chat-name') || '';
  const crStatus = game => { try { return JSON.parse(lsGet('cr-status-' + game) || 'null'); } catch (e) { return null; } };
  const listeners = new Set();
  function setStatus(game, you) {
    const old = crStatus(game);
    const st = you ? { rank: you.rank, score: you.score, challenger: !!you.challenger, at: Date.now() } : null;
    if (st && old && old.challenger && !st.challenger) st.lost = Date.now();
    else if (st && old && old.lost && !st.challenger) st.lost = old.lost;
    lsSet('cr-status-' + game, JSON.stringify(st));
    for (const f of listeners) try { f(game, st); } catch (e) { }
  }
  const fmtT = t => { const m = Math.floor(t / 60), s = t - m * 60; return m ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}s`; };
  const fmtN = n => Math.round(n).toLocaleString('en-US');
  // Refresh your status for every game (at most once a minute)
  let lastSync = 0, syncing = null;
  function syncAll(force) {
    if (syncing) return syncing;
    if (!force && Date.now() - lastSync < 60000) return Promise.resolve();
    lastSync = Date.now();
    syncing = playerId().then(me => api('/cr/boards?me=' + me)).then(j => {
      for (const g of Object.keys(CR_GAMES)) if (j.boards[g]) setStatus(g, j.boards[g].you);
      return j;
    }).catch(() => null).finally(() => { syncing = null; });
    return syncing;
  }

  function create(game, opts) {
    const need = (opts && opts.wins) || [2, 3, 3, 4, 5];
    const key = 'ranked-' + game;
    let st = { tier: 0, wins: 0, w: 0, l: 0, champ: 0 };
    try { Object.assign(st, JSON.parse(localStorage.getItem(key) || '{}')); } catch (e) { }
    st.tier = Math.max(0, Math.min(TOP, st.tier | 0)); st.wins = Math.max(0, st.wins | 0);
    // Placements for anyone who hasn't played ranked in this game yet (players from before keep their rank)
    if (!st.placed && !st.pl) { if (st.w + st.l > 0) st.placed = true; else st.pl = newPlacement(); }
    const save = () => { try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) { } };
    const needNow = () => st.tier >= TOP ? 0 : need[st.tier];
    const hasCR = !!CR_GAMES[game];
    let run = null;           // Promise of the server's run token for the Champion match being played
    const crResults = {};     // finished Challenger posts, by result id

    const placing = () => !!st.pl;
    function plDots(res) {
      let h = '';
      for (let i = 0; i < PLACEMENTS; i++) h += `<i class="${res[i] === 1 ? 'w' : res[i] === 0 ? 'l' : ''}" title="Placement ${i + 1}${res[i] === 1 ? ': win' : res[i] === 0 ? ': loss' : ''}"></i>`;
      return `<div class="rk-pl">${h}</div>`;
    }
    function pips(have, of) {
      let h = '';
      for (let i = 0; i < of; i++) h += `<i class="${i < have ? 'on' : ''}"></i>`;
      return `<div class="rk-pips">${h}</div>`;
    }
    function progressText() {
      if (placing()) return `Placement match ${st.pl.n + 1} of ${PLACEMENTS}: you'll play the ${TIERS[st.pl.lv].name} bot`;
      if (st.tier >= TOP) return `Top of the ladder · ${st.champ} Champion win${st.champ === 1 ? '' : 's'}`;
      const left = needNow() - st.wins;
      return `Win ${left} more to reach ${TIERS[st.tier + 1].name}`;
    }
    function crLine() {
      if (!hasCR || st.tier < TOP) return '';
      const s = crStatus(game);
      let t;
      if (s && s.challenger) t = `<b style="color:${CR.a}">Challenger #${s.rank}</b> · best score ${fmtN(s.score)}`;
      else if (s) t = `Leaderboard #${s.rank} · best score ${fmtN(s.score)}. ${s.lost ? 'You were pushed out of the top 3. ' : ''}Reach the top 3 to become a Challenger.`;
      else t = 'Every win against the Champion bot posts a Challenger score. The top 3 players become Challengers.';
      return `<div class="rk-sub chl-line">${t}</div><button type="button" class="chl-btn" data-cr-open="${game}">${emblem(CHALLENGER, 18)}Challenger leaderboard</button>`;
    }
    let lastExtra = '', listening = false;
    const self = {
      TIERS,
      get tier() { return st.tier; },
      get tierName() { return placing() ? 'Placements' : TIERS[st.tier].name; },
      // The bot to play next: during placements, the one you're being tested against
      get botTier() { return placing() ? st.pl.lv : st.tier; },
      get placing() { return placing(); },
      get matchLabel() { return placing() ? `Placement ${st.pl.n + 1}/${PLACEMENTS} · ${TIERS[st.pl.lv].name} bot` : TIERS[st.tier].name; },
      get state() { return { ...st, need: needNow() }; },
      // True while you hold Challenger in this game (one of the top 3 on its leaderboard)
      get challenger() { const s = hasCR && st.tier >= TOP && crStatus(game); return !!(s && s.challenger); },
      get rankName() { return placing() ? 'Placements' : self.challenger ? CR.name : TIERS[st.tier].name; },
      emblem: (t, size) => emblem(t == null ? (self.challenger ? CHALLENGER : self.botTier) : t, size || 40),
      // Card for the menu: emblem, rank, progress, and the whole ladder
      card(extra) {
        injectCSS();
        lastExtra = extra || '';
        if (placing()) {
          const p = st.pl;
          let lad = '';
          for (let i = 0; i <= TOP; i++) lad += emblem(i, 20).replace('class="rk-emblem"', `class="rk-emblem ${i === p.lv ? 'cur' : ''}"`);
          return `<div class="rk-card rk-placing" data-rk-game="${game}" style="--rk-a:${TIERS[p.lv].a}"><div class="rk-test">${emblem(p.lv, 56)}<b>?</b></div><div class="rk-info">
            <div class="rk-name">Placements</div>
            <div class="rk-sub">${esc(progressText())}.${extra ? '<br>' + extra : ''}</div>
            ${plDots(p.res)}
            <div class="rk-sub">${p.n ? '' : 'Your first 5 ranked matches find your starting rank. '}Win and the next bot is a rank tougher, lose and it's a rank easier. <b>Win all 5 to start at Champion.</b></div>
            <div class="rk-ladder" title="The bot you'll play next is lit">${lad}</div></div></div>`;
        }
        const isCR = self.challenger, t = isCR ? CR : TIERS[st.tier];
        let ladder = '';
        for (let i = 0; i <= TOP; i++) ladder += emblem(i, 20).replace('class="rk-emblem"', `class="rk-emblem ${i < st.tier ? 'done' : i === st.tier ? 'cur' : ''}"`);
        if (hasCR) ladder += emblem(CHALLENGER, 20).replace('class="rk-emblem"', `class="rk-emblem ${isCR ? 'cur' : ''}"`);
        if (hasCR && st.tier >= TOP) {
          if (!listening) { listening = true; listeners.add(g => { if (g === game) refreshCards(); }); }
          syncAll();
        }
        return `<div class="rk-card" data-rk-game="${game}" style="--rk-a:${t.a}">${emblem(isCR ? CHALLENGER : st.tier, 56)}<div class="rk-info">
          <div class="rk-name" style="color:${t.a}">${t.name}</div>
          <div class="rk-sub">${esc(progressText())}${extra ? '<br>' + extra : ''}</div>
          ${st.tier < TOP ? pips(st.wins, needNow()) : ''}${crLine()}
          <div class="rk-ladder" title="Bronze, Silver, Gold, Platinum, Diamond, Champion${hasCR ? ', Challenger (top 3)' : ''}">${ladder}</div>
          <div class="rk-sub">Record: ${st.w} W · ${st.l} L</div></div></div>`;
      },
      // Call when a ranked match starts. At Champion it asks the server to start timing a Challenger run.
      begin() {
        run = null;
        if (!hasCR || st.tier < TOP || modded()) return;
        run = api('/cr/start', { game }).then(j => j.run).catch(() => null);
      },
      // stats: what this game scores Challenger runs on (see CR_GAMES / server/challenger.js)
      record(won, stats) {
        const myRun = run; run = null;
        if (modded()) return { blocked: true, won, to: st.tier, wins: st.wins, need: needNow() };
        if (placing()) return recordPlacement(won);
        const before = st.tier;
        if (won) {
          st.w++;
          if (st.tier >= TOP) st.champ++;
          else if (++st.wins >= need[st.tier]) { st.tier++; st.wins = 0; }
        } else st.l++;
        save();
        const r = { won, promoted: st.tier > before, from: before, to: st.tier, wins: st.wins, need: needNow() };
        if (won && myRun && before >= TOP) {
          r.crId = 'cr' + (Math.random() * 1e9 | 0);
          myRun.then(tok => {
            if (!tok) throw new Error('Couldn\'t reach the leaderboard when this match started, so it wasn\'t timed.');
            return api('/cr/finish', { run: tok, key: playerKey(), name: crName(), stats: stats || {} });
          }).then(j => {
            const was = crStatus(game);
            setStatus(game, j.board.you);
            crResults[r.crId] = crResultHTML(j, was);
          }, e => { crResults[r.crId] = `<div class="rk-line">${esc(e.message)}</div>`; }).then(() => {
            const el = document.getElementById(r.crId);
            if (el) el.innerHTML = crResults[r.crId];
            refreshCards();
          });
        }
        return r;
      },
      resultHTML(r) {
        injectCSS();
        const t = TIERS[r.to];
        if (r.pl) return placementHTML(r);
        if (r.blocked) return `<div class="rk-res">${emblem(r.to, 40)}<div class="rk-line">A mod menu is running on this page, so this ranked result wasn't saved.</div></div>`;
        if (r.promoted) {
          return `<div class="rk-res" style="--rk-a:${t.a}"><div class="rk-up">${emblem(r.to, 64)}</div>
            <div class="rk-big" style="color:${t.a}">Promoted to ${t.name}!</div>
            <div class="rk-line">${r.to >= TOP ? (hasCR ? 'You reached Champion. Now every win posts a Challenger score: the top 3 players become Challengers.' : 'You reached the top of the ladder.') : `The bots get tougher. Win ${r.need} to reach ${TIERS[r.to + 1].name}.`}</div></div>`;
        }
        const line = r.to >= TOP
          ? (r.won ? `Champion win! ${st.champ} so far.` : 'Champion bots are the toughest there are. Go again!')
          : (r.won ? `Ranked win: ${r.wins} of ${r.need} in ${t.name}.` : `No ranked progress lost. Still ${r.wins} of ${r.need} in ${t.name}.`);
        const cr = r.crId ? `<div class="chl-res" id="${r.crId}">${crResults[r.crId] || '<div class="rk-line">Posting your Challenger score…</div>'}</div>` : '';
        return `<div class="rk-res" style="--rk-a:${t.a}">${emblem(r.to, 40)}<div class="rk-line">${esc(line)}</div>${r.to < TOP ? pips(r.wins, r.need) : ''}${cr}</div>`;
      },
      reset() { st = { tier: 0, wins: 0, w: 0, l: 0, champ: 0, pl: newPlacement() }; save(); },
    };
    function recordPlacement(won) {
      const p = st.pl, played = p.lv;
      if (won) { st.w++; p.best = Math.max(p.best, played); } else st.l++;
      p.res.push(won ? 1 : 0); p.n++;
      p.lv = Math.max(0, Math.min(TOP, played + (won ? 1 : -1)));
      const r = { won, pl: { played, n: p.n, res: p.res.slice(), next: p.lv, done: p.n >= PLACEMENTS }, promoted: false, from: 0, to: 0, wins: 0, need: need[0] };
      if (r.pl.done) {
        // Champion only for a perfect 5; otherwise the hardest bot you beat, at most Diamond
        const allWon = p.res.every(x => x === 1);
        st.tier = allWon ? TOP : p.best < 0 ? 0 : Math.min(p.best, TOP - 1);
        st.wins = 0; st.placed = true; delete st.pl;
        Object.assign(r, { promoted: st.tier > 0, to: st.tier, need: needNow(), allWon });
      }
      save();
      return r;
    }
    function placementHTML(r) {
      const p = r.pl, played = TIERS[p.played];
      if (!p.done) {
        const nx = TIERS[p.next];
        return `<div class="rk-res" style="--rk-a:${played.a}">${emblem(p.played, 40)}
          <div class="rk-big" style="color:${r.won ? '#7fe0a8' : '#ff9a8a'}">Placement ${p.n}/${PLACEMENTS}: ${r.won ? 'Win!' : 'Loss'}</div>
          <div class="rk-line">${r.won ? `You beat the ${played.name} bot.` : `The ${played.name} bot won this one.`} Next up: the <b style="color:${nx.a}">${nx.name}</b> bot.</div>
          ${plDots(p.res)}</div>`;
      }
      const t = TIERS[r.to];
      const line = r.allWon
        ? (hasCR ? '5 straight wins: straight to Champion! Every win from now on posts a Challenger score.' : '5 straight wins: straight to Champion!')
        : r.to > 0 ? `You beat the ${t.name} bot. Win ${r.need} to reach ${TIERS[r.to + 1].name}.` : `You start at Bronze. Win ${r.need} to reach Silver.`;
      return `<div class="rk-res" style="--rk-a:${t.a}"><div class="rk-up">${emblem(r.to, 64)}</div>
        <div class="rk-big" style="color:${t.a}">Placed in ${t.name}!</div>
        <div class="rk-line">${line}</div>${plDots(p.res)}</div>`;
    }
    function crResultHTML(j, was) {
      const g = CR_GAMES[game], you = j.board.you;
      const head = j.challenger
        ? (was && was.challenger ? `Still a Challenger: #${j.rank}` : `You're a Challenger! #${j.rank}`)
        : `Leaderboard #${j.rank} of ${j.board.players}`;
      const best = j.improved ? (was ? 'New personal best!' : 'Your first Challenger score!') : `Your best is still ${fmtN(j.best)}.`;
      const toTop = !j.challenger && j.board.board[TOP_CR - 1] ? ` Beat ${fmtN(j.board.board[TOP_CR - 1].score)} to reach the top 3.` : '';
      return `<div class="${j.challenger ? 'rk-up' : ''}">${j.challenger ? emblem(CHALLENGER, j.challenger && !(was && was.challenger) ? 64 : 40) : ''}</div>
        <div class="rk-big" style="color:${CR.a}">${esc(head)}</div>
        <div class="rk-line">Score <b>${fmtN(j.score)}</b> · ${fmtT(j.t)} · ${esc(g.stat(j.stats))}. ${best}${toTop}</div>
        <button type="button" class="chl-btn" data-cr-open="${game}">${emblem(CHALLENGER, 18)}Leaderboard</button>`;
    }
    function refreshCards() {
      for (const el of document.querySelectorAll(`.rk-card[data-rk-game="${game}"]`)) {
        const tmp = document.createElement('div'); tmp.innerHTML = self.card(lastExtra);
        el.replaceWith(tmp.firstElementChild);
      }
    }
    return self;
  }
  const TOP_CR = 3;
  const PLACEMENTS = 5, PLACE_START = 3;   // 5 placement matches, the first against the Platinum bot
  const newPlacement = () => ({ n: 0, res: [], lv: PLACE_START, best: -1 });

  // Leaderboard window: one tab per game, the top 25 there, your row, and your leaderboard name.
  let boardEl = null;
  async function openBoard(game) {
    injectCSS();
    if (!CR_GAMES[game]) game = 'chess';
    if (!boardEl) {
      boardEl = document.createElement('div'); boardEl.className = 'chl-ov';
      boardEl.innerHTML = `<div class="chl-box" role="dialog" aria-modal="true" aria-label="Challenger leaderboard">
        <div class="chl-head">${emblem(CHALLENGER, 44)}<div><div class="chl-title">Challenger</div><div class="chl-tag">The top 3 Champions in each game</div></div>
        <button type="button" class="chl-x" aria-label="Close">✕</button></div>
        <div class="chl-tabs">${Object.entries(CR_GAMES).map(([g, x]) => `<button type="button" data-g="${g}">${x.name}</button>`).join('')}</div>
        <div class="chl-how"></div><div class="chl-list"></div>
        <form class="chl-name"><label>Your leaderboard name <input maxlength="16" autocomplete="off" spellcheck="false" placeholder="2–16 characters"></label><button type="submit">Save</button><span class="chl-msg"></span></form>
      </div>`;
      const close = () => { boardEl.remove(); };
      boardEl.addEventListener('pointerdown', e => { if (e.target === boardEl) close(); });
      boardEl.querySelector('.chl-x').onclick = close;
      for (const ev of ['keydown', 'keyup', 'keypress']) boardEl.addEventListener(ev, e => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Escape') close(); });
      boardEl.querySelector('.chl-tabs').onclick = e => { const b = e.target.closest('button'); if (b) showGame(b.dataset.g); };
      boardEl.querySelector('.chl-name').onsubmit = async e => {
        e.preventDefault();
        const inp = boardEl.querySelector('.chl-name input'), msg = boardEl.querySelector('.chl-msg'), name = inp.value.replace(/\s+/g, ' ').trim();
        if (name.length < 2) { msg.textContent = 'Names need 2 to 16 characters.'; return; }
        lsSet('edu-cr-name', name); msg.textContent = 'Saving…';
        try { await api('/cr/name', { key: playerKey(), name }); msg.textContent = 'Saved.'; showGame(boardEl.dataset.g); }
        catch (err) { msg.textContent = err.message; }
      };
    }
    boardEl.querySelector('.chl-name input').value = crName();
    boardEl.querySelector('.chl-msg').textContent = '';
    document.body.appendChild(boardEl);
    showGame(game);
  }
  async function showGame(game) {
    const el = boardEl, g = CR_GAMES[game];
    el.dataset.g = game;
    for (const b of el.querySelectorAll('.chl-tabs button')) b.classList.toggle('on', b.dataset.g === game);
    el.querySelector('.chl-how').innerHTML = `${esc(g.how)} Only wins against the Champion bot count, timed by the server. <a href="${g.href}">Play ${esc(g.name)}</a>`;
    const list = el.querySelector('.chl-list');
    list.innerHTML = '<div class="chl-empty">Loading…</div>';
    try {
      const me = await playerId(), j = await api(`/cr/board?game=${game}&me=${me}`);
      if (el.dataset.g !== game) return;
      setStatus(game, j.you);
      const row = r => `<div class="chl-row${r.challenger ? ' top' : ''}${j.you && r.id === j.you.id ? ' me' : ''}">
        <span class="chl-rank">${r.challenger ? emblem(CHALLENGER, 26) : ''}<b>${r.rank}</b></span>
        <span class="chl-who">${esc(r.name)}${j.you && r.id === j.you.id ? ' <i>(you)</i>' : ''}<small>${fmtT(r.t)} · ${esc(g.stat(r.stats))}</small></span>
        <span class="chl-score">${fmtN(r.score)}</span></div>`;
      let h = j.board.map(row).join('');
      if (!j.board.length) h = `<div class="chl-empty">No Challenger scores yet. Reach Champion in ${esc(g.name)} and win to be the first.</div>`;
      if (j.you && !j.board.some(r => r.id === j.you.id)) h += '<div class="chl-gap">⋯</div>' + row(j.you);
      list.innerHTML = h + (j.players ? `<div class="chl-foot">${j.players} player${j.players === 1 ? '' : 's'} on this board</div>` : '');
    } catch (e) {
      if (el.dataset.g === game) list.innerHTML = `<div class="chl-empty">${esc(e.message)}</div>`;
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-cr-open]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    openBoard(b.dataset.crOpen);
  }, true);

  // Bot settings for each rank, blended from a game's easy / normal / hard tables.
  // at: where each rank sits (0 = easy, 1 = normal, 2 = hard, above 2 = tougher than hard).
  // Numbers are blended (and pushed past hard for Champion, kept within 0..1 for chances);
  // true/false settings take the nearest level at or below.
  function blendLevels(easy, normal, hard, at) {
    const lv = [easy, normal, hard];
    return (at || [0, 0.55, 1.1, 1.6, 2, 2.45]).map(x => {
      const out = {};
      for (const k of Object.keys(hard)) {
        const v = lv.map(l => l[k]);
        if (typeof v[2] !== 'number') { out[k] = v[Math.min(2, Math.floor(x))]; continue; }
        let r;
        if (x <= 1) r = v[0] + (v[1] - v[0]) * x;
        else if (x <= 2) r = v[1] + (v[2] - v[1]) * (x - 1);
        else r = v[2] + (v[2] - v[1]) * (x - 2);
        const unit = v.every(n => n >= 0 && n <= 1);
        if (unit) r = Math.max(0, Math.min(1, r));
        else if (v.every(n => n > 0)) r = Math.max(Math.min(...v) * 0.35, r);
        if (v.every(n => Number.isInteger(n)) && !unit) r = Math.round(r);
        out[k] = r;
      }
      return out;
    });
  }

  window.Ranked = Object.freeze({ create, TIERS: Object.freeze(TIERS.map(t => Object.freeze(t))), emblem, blendLevels, modded,
    CHALLENGER, CR: Object.freeze({ ...CR }), CR_GAMES, crStatus, syncAll, openBoard, onStatus: f => listeners.add(f) });
})();

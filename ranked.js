// Ranked ladder shared by Frontier, Volley, Timberfall and Boxing (singleplayer, against bots).
// Bronze → Silver → Gold → Platinum → Diamond → Champion. Win the number of matches a game asks for
// in your rank to move up; each rank's bots are tougher. Losses never knock you down a rank.
// Each game keeps its own ladder in this browser (localStorage 'ranked-<game>').
//   const RK = Ranked.create('volley', { wins: [2, 3, 3, 4, 5] });
//   RK.tier → 0..5 · RK.card() → HTML · RK.record(won) → result · RK.resultHTML(result) → HTML
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
  ];
  function emblem(tier, size) {
    const c = EM[tier], u = 'rk' + tier + '_' + (Math.random() * 1e9 | 0);
    const lin = (id, a, b, cc, x2, y2) => `<linearGradient id="${u}${id}" x1="0" y1="0" x2="${x2 || 0}" y2="${y2 == null ? 1 : y2}"><stop offset="0" stop-color="${a}"/><stop offset="0.5" stop-color="${b}"/><stop offset="1" stop-color="${cc}"/></linearGradient>`;
    const M = `url(#${u}m)`, D = `url(#${u}d)`, G = `url(#${u}g)`;
    const defs = lin('m', c.m1, c.m2, c.m3) + lin('d', c.m3, c.m2, c.m3, 1, 1) + (c.g1 ? lin('g', c.g1, c.g2, c.g3, 1, 1) : '') +
      (c.s1 ? lin('s', c.s1, c.s2, c.s2) : '');
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
  @media (prefers-reduced-motion: reduce) { .rk-res .rk-up { animation: none; } }`;
  function injectCSS() {
    if (document.getElementById('rk-css')) return;
    const s = document.createElement('style'); s.id = 'rk-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function create(game, opts) {
    const need = (opts && opts.wins) || [2, 3, 3, 4, 5];
    const key = 'ranked-' + game;
    let st = { tier: 0, wins: 0, w: 0, l: 0, champ: 0 };
    try { Object.assign(st, JSON.parse(localStorage.getItem(key) || '{}')); } catch (e) { }
    st.tier = Math.max(0, Math.min(TOP, st.tier | 0)); st.wins = Math.max(0, st.wins | 0);
    const save = () => { try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) { } };
    const needNow = () => st.tier >= TOP ? 0 : need[st.tier];

    function pips(have, of) {
      let h = '';
      for (let i = 0; i < of; i++) h += `<i class="${i < have ? 'on' : ''}"></i>`;
      return `<div class="rk-pips">${h}</div>`;
    }
    function progressText() {
      if (st.tier >= TOP) return `Top of the ladder · ${st.champ} Champion win${st.champ === 1 ? '' : 's'}`;
      const left = needNow() - st.wins;
      return `Win ${left} more to reach ${TIERS[st.tier + 1].name}`;
    }
    return {
      TIERS,
      get tier() { return st.tier; },
      get tierName() { return TIERS[st.tier].name; },
      get state() { return { ...st, need: needNow() }; },
      emblem: (t, size) => emblem(t == null ? st.tier : t, size || 40),
      // Card for the menu: emblem, rank, progress, and the whole ladder
      card(extra) {
        injectCSS();
        const t = TIERS[st.tier];
        let ladder = '';
        for (let i = 0; i <= TOP; i++) ladder += emblem(i, 20).replace('class="rk-emblem"', `class="rk-emblem ${i < st.tier ? 'done' : i === st.tier ? 'cur' : ''}"`);
        return `<div class="rk-card" style="--rk-a:${t.a}">${emblem(st.tier, 56)}<div class="rk-info">
          <div class="rk-name" style="color:${t.a}">${t.name}</div>
          <div class="rk-sub">${esc(progressText())}${extra ? '<br>' + extra : ''}</div>
          ${st.tier < TOP ? pips(st.wins, needNow()) : ''}
          <div class="rk-ladder" title="Bronze, Silver, Gold, Platinum, Diamond, Champion">${ladder}</div>
          <div class="rk-sub">Record: ${st.w} W · ${st.l} L</div></div></div>`;
      },
      record(won) {
        if (modded()) return { blocked: true, won, to: st.tier, wins: st.wins, need: needNow() };
        const before = st.tier;
        if (won) {
          st.w++;
          if (st.tier >= TOP) st.champ++;
          else if (++st.wins >= need[st.tier]) { st.tier++; st.wins = 0; }
        } else st.l++;
        save();
        return { won, promoted: st.tier > before, from: before, to: st.tier, wins: st.wins, need: needNow() };
      },
      resultHTML(r) {
        injectCSS();
        const t = TIERS[r.to];
        if (r.blocked) return `<div class="rk-res">${emblem(r.to, 40)}<div class="rk-line">A mod menu is running on this page, so this ranked result wasn't saved.</div></div>`;
        if (r.promoted) {
          return `<div class="rk-res" style="--rk-a:${t.a}"><div class="rk-up">${emblem(r.to, 64)}</div>
            <div class="rk-big" style="color:${t.a}">Promoted to ${t.name}!</div>
            <div class="rk-line">${r.to >= TOP ? 'You reached the top of the ladder.' : `The bots get tougher. Win ${r.need} to reach ${TIERS[r.to + 1].name}.`}</div></div>`;
        }
        const line = r.to >= TOP
          ? (r.won ? `Champion win! ${st.champ} so far.` : 'Champion bots are the toughest there are. Go again!')
          : (r.won ? `Ranked win: ${r.wins} of ${r.need} in ${t.name}.` : `No ranked progress lost. Still ${r.wins} of ${r.need} in ${t.name}.`);
        return `<div class="rk-res" style="--rk-a:${t.a}">${emblem(r.to, 40)}<div class="rk-line">${esc(line)}</div>${r.to < TOP ? pips(r.wins, r.need) : ''}</div>`;
      },
      reset() { st = { tier: 0, wins: 0, w: 0, l: 0, champ: 0 }; save(); },
    };
  }

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

  window.Ranked = Object.freeze({ create, TIERS: Object.freeze(TIERS.map(t => Object.freeze(t))), emblem, blendLevels, modded });
})();

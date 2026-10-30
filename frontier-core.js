// Frontier game rules, shared by the browser (singleplayer + multiplayer view) and the
// Node multiplayer server. Troop growth, troop cap, attack loss/speed and building costs
// follow OpenFront's open-source engine (packages/engine & engine-lib), scaled for a smaller map.
// Nations are led by historical leaders (frontier-leaders.js) whose personality drives the AI and
// whose opinion of each player drives diplomacy: alliances, trades, joint wars and peace.
// Real-world maps come from frontier-maps.js.
(function (root) {
'use strict';
const inNode = typeof module !== 'undefined' && module.exports;
const Maps = inNode ? require('./frontier-maps.js') : root.FrontierMaps;
const { LEADERS, STYLES } = inNode ? require('./frontier-leaders.js') : root.FrontierLeaders;

// ════════════════ Utilities ════════════════
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const within = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function fmt(n) {
  n = Math.max(0, Math.floor(n));
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return '' + n;
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hsl2rgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
// Map generation only uses + - * / floor and sqrt, which are exact in IEEE-754, so the same
// seed builds the same map in every browser and in Node.
function makeNoise(rng) {
  const g = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) g[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
    const a = g[x0 + y0], b = g[x1 + y0], c = g[x0 + y1], d = g[x1 + y1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(n, x, y, oct) {
  let s = 0, a = 1, t = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += n(x * f + i * 17.3, y * f + i * 9.1) * a; t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}

// ════════════════ Rules ════════════════
const TICK_MS = 100;
const SPAWN_TICKS = 100;          // 10 s to pick a spawn
const IMMUNITY_TICKS = 300;       // 30 s of no player-vs-player attacks
const ALLIANCE_TICKS = 3000;      // alliances last 5 minutes
const WIN_SHARE = 1;              // own every land tile to win
const CITY_TROOPS = 250000;
// OpenFront maps have roughly 10x more land tiles. Each tile here stands in for several
// OpenFront tiles so troop density, and so the attacker/defender balance, stays similar.
const TILE_SCALE = 4;
const FRONT_SLOWDOWN = Math.sqrt(TILE_SCALE);   // fronts advance in tiles, so scale by the side length
const DEFENSE_RANGE = 10;
const SAM_RANGE = 24;
const MAX_BOATS = 3;
const BOAT_SPEED = 0.6;           // transport ships, tiles per tick
const WARSHIP_SPEED = 1.1;        // warships sailing to an ordered spot
const CANNON_RANGE = 12;          // warships shoot enemy ships this close
const CRUISER_RANGE = 14;         // cruisers shell enemy buildings and coast this close
const NUKE = { atom: { inner: 7, outer: 12 }, hydrogen: { inner: 16, outer: 26 } };
// terrainAttackBase() in OpenFront
const TERR = [null, { mag: 80, cost: 16.5, name: 'Plains' }, { mag: 100, cost: 20, name: 'Highland' }, { mag: 120, cost: 25, name: 'Mountains' }];
const MAP_SIZES = { small: [320, 200], medium: [440, 272], large: [560, 344] };
const MAP_NAMES = { continents: 'Continents', pangaea: 'Pangaea', archipelago: 'Archipelago', twin: 'Twin Continents', inland: 'Inland Sea', earth: 'Earth', europe: 'Europe' };
const MAP_KINDS = Object.keys(MAP_NAMES);
// Real maps keep their own shape and get about as many tiles as a generated map of that size.
function mapDims(map, size) {
  const [w, h] = MAP_SIZES[size] || MAP_SIZES.medium, real = Maps.MAPS[map];
  if (!real) return [w, h];
  const aspect = real.w / real.h, W = Math.min(real.w, Math.round(Math.sqrt(w * h * aspect)));
  return [W, Math.round(W / aspect)];
}

// Diplomacy
const WAR_TICKS = 3000;           // declared wars last 5 minutes unless peace is made
const PEACE_MIN_TICKS = 600;      // a war must run for a minute before peace talks
const OFFER_TICKS = 200;          // offers to players expire after 20 s
const TROOP_GOLD = 1;             // how much gold one troop is worth in trades
const NEUTRAL_TRAITS = { aggr: 0.5, expand: 0.5, loyal: 0.5, nuke: 0, naval: 0.5, econ: 0.5, defense: 0.5, generous: 0.5, grudge: 0.5 };
// Leader abilities change the rules through modifiers (frontier-leaders.js lists what each means).
// Multipliers default to 1; the ADDED ones are summed and default to 0.
const MOD_DEFAULTS = {
  growth: 1, cap: 1, cityCap: 1, gold: 1, civGold: 1, factoryGold: 1, tradeGold: 1, tradeFreq: 1, peaceGold: 1, warGrowth: 1,
  atk: 1, atkBots: 1, atkNeutral: 1, atkPlains: 1, atkHills: 1, vsBigger: 1, vsWeaker: 1, revenge: 1, speed: 1,
  def: 1, defHills: 1, defBigger: 1, boatSpeed: 1, boatPower: 1, coastDef: 1, favorGain: 1,
  warshipHp: 1, warshipDmg: 1, warshipSpeed: 1, buildTime: 1, defRange: 1, defStr: 1,
  siloReload: 1, allianceTime: 1, giftTroops: 1,
  c_city: 1, c_port: 1, c_factory: 1, c_defense: 1, c_silo: 1, c_sam: 1, c_warship: 1, c_cruiser: 1, c_atom: 1, c_hydrogen: 1,
  boats: 0, plunder: 0, allyGrowth: 0, allyGold: 0, traitorFree: 0, opinion: 0, killTroops: 0, killPower: 0,
  coastGold: 0, hillCap: 0, cityGold: 0, cityDef: 0, piracy: 0, spawnRadius: 0, tribeAlly: 0, votes: 0, freePort: 0, treatyGold: 0,
};
const ADDED_MODS = new Set(['boats', 'plunder', 'allyGrowth', 'allyGold', 'traitorFree', 'opinion', 'killTroops', 'killPower',
  'coastGold', 'hillCap', 'cityGold', 'cityDef', 'piracy', 'spawnRadius', 'tribeAlly', 'votes', 'freePort', 'treatyGold']);
function mergeMods(m, extra) {
  if (extra) for (const k in extra) m[k] = ADDED_MODS.has(k) ? m[k] + extra[k] : m[k] * extra[k];
  return m;
}
const MAX_NATIONS = 48;
// World's Fair resolutions. dur: how long one lasts once passed (default FAIR_TICKS).
const RESOLUTIONS = {
  nonprolif: { name: 'Nuclear Non-Proliferation', desc: 'No one may build missile silos or launch nuclear weapons.' },
  atomic: { name: 'Atomic Age', desc: 'Missile silos and nuclear weapons cost 40% less.' },
  freetrade: { name: 'Free Trade Agreement', desc: 'Trade ships earn 50% more gold.' },
  workers: { name: "Workers' Charter", desc: 'Port and factory workers earn 30% more gold.' },
  ceasefire: { name: 'Global Ceasefire', desc: 'Every war ends, and no one may declare war for 3 minutes.', dur: 1800 },
  sanctions: { name: 'Sanctions', desc: 'The largest nation earns 30% less gold.', target: true },
};
const FAIR_VOTE_TICKS = 300;      // 30 s to vote
const FAIR_TICKS = 6000;          // resolutions last 10 minutes
const FAIR_GAP = 3000;            // at least 5 minutes between sessions
function roman(n) {
  let s = '';
  for (const [v, r] of [[40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (n >= v) { s += r; n -= v; }
  return s;
}
// The k-th nation with the same name (from 0): India, India II, ... India XL
const numbered = (name, k) => k ? name + ' ' + roman(k + 1) : name;
const ATTITUDES = [[6, 'Friendly'], [-3, 'Neutral'], [-9, 'Unfriendly'], [-Infinity, 'Hostile']];
const attitude = v => ATTITUDES.find(a => v >= a[0])[1];

// AI nations. Hard plays like the old Easy; Impossible like the old Medium plus nukes and factories.
// powerCd: how much slower AI nations recharge their leader's power than players do.
const DIFF = {
  easy:       { start: 7500,  grow: 0.75, thr: 0.75, ratio: 0.15, acc: 0.85, defense: false, nukes: false, factories: false, every: 18, aggr: 0.4,  powerCd: 5 },
  medium:     { start: 10000, grow: 0.82, thr: 0.7,  ratio: 0.18, acc: 0.8,  defense: false, nukes: false, factories: false, every: 16, aggr: 0.48, powerCd: 4 },
  hard:       { start: 12500, grow: 0.9,  thr: 0.65, ratio: 0.2,  acc: 0.75, defense: false, nukes: false, factories: false, every: 14, aggr: 0.55, powerCd: 2.5 },
  impossible: { start: 18750, grow: 0.95, thr: 0.55, ratio: 0.25, acc: 0.55, defense: true,  nukes: true,  factories: true,  every: 10, aggr: 0.8,  powerCd: 1.6 },
};
// Population is split between troops (fight and defend) and civilians (earn gold).
// Civilians only earn gold while working in a port or factory, and each has limited jobs.
const WORKER_GOLD = 0.006;         // gold per working civilian per tick
const PORT_JOBS = 15000, FACTORY_JOBS = 25000;
const PORT_GOLD = 60;              // gold per finished port per tick, on top of its trade ships
const FACTORY_GOLD = 250;          // gold per finished factory per tick, on top of its workers
const SHARE_SHIFT = 0.005;         // share of population that can switch role each tick
const DEFAULT_SHARE = 0.8;         // humans start with 80% troops
const TRAITOR_TICKS = 1200;        // breaking an alliance weakens your troops by 20% for 2 minutes
const TRUCE_TICKS = 1200;          // computer nations keep a peace treaty for at least 2 minutes

const BUILD = {
  city:     { name: 'City',      key: '1', time: 50,  tip: '+250K troop cap' },
  port:     { name: 'Port',      key: '2', time: 50,  tip: 'Trade ships earn gold. +600 gold/s and 15K jobs for civilians. Must be on the coast.' },
  factory:  { name: 'Factory',   key: '3', time: 60,  tip: '+2.5K gold/s and 25K jobs for civilians' },
  defense:  { name: 'Defense',   key: '4', time: 40,  tip: 'Land within 10 tiles is 5× harder to take' },
  silo:     { name: 'Silo',      key: '5', time: 100, tip: 'Launches nukes' },
  sam:      { name: 'SAM',       key: '6', time: 80,  tip: 'Shoots down nukes aimed within 24 tiles' },
  warship:  { name: 'Warship',   key: '7', time: 0,   tip: 'Click water near your port. Its cannon sinks enemy boats and trade ships in range. Click it, then click water, to move it.' },
  cruiser:  { name: 'Cruiser',   key: '8', time: 0,   tip: 'Click water near your port. Shells enemy ports, buildings and coast in range. Click it, then click water, to move it.' },
  atom:     { name: 'Atom Bomb', key: '9', time: 0,   tip: 'Small blast. Needs a ready silo.' },
  hydrogen: { name: 'H-Bomb',    key: '0', time: 0,   tip: 'Huge blast. Needs a ready silo.' },
};
const BUILD_ORDER = ['city', 'port', 'factory', 'defense', 'silo', 'sam', 'warship', 'cruiser', 'atom', 'hydrogen'];
const SHIP_KINDS = ['transport', 'trade', 'warship', 'cruiser'];
// Index order is sent over the network, so new types go at the end
const STRUCT_TYPES = ['city', 'port', 'defense', 'silo', 'sam', 'factory'];

const SYL = ['ka', 'ro', 'th', 'ul', 'mi', 'zan', 'ok', 'ra', 'en', 'dor', 'vi', 'ash', 'ur', 'tek', 'mo', 'lia', 'gar', 'is', 'bo', 'nu'];
// Bright, well-separated colours for human players (the first is the singleplayer colour).
const HUMAN_COLORS = [[30, 96, 255], [255, 64, 129], [0, 200, 140], [255, 152, 0], [156, 39, 176], [0, 188, 212], [205, 220, 57], [233, 30, 99],
  [63, 81, 181], [255, 87, 34], [76, 175, 80], [121, 85, 72], [96, 125, 139], [255, 235, 59], [0, 150, 136], [103, 58, 183]];

// ════════════════ Real-map terrain ════════════════
const maskCache = {};
// Mountain ranges as segments with a bounding box, so each tile only measures nearby ridges.
const RANGE_SEGS = Maps.RANGES.map(r => {
  const str = r[0], wid = r[1] * 1.4, pts = r.slice(2), segs = [];   // a bit wider than the ridge, for foothills
  for (let i = 0; i + 3 < pts.length; i += 2) segs.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
  const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
  return { str, wid, segs, x0: Math.min(...xs) - wid, x1: Math.max(...xs) + wid, y0: Math.min(...ys) - wid, y1: Math.max(...ys) + wid };
});
function rangeHeight(lon, lat) {
  let best = 0;
  for (const r of RANGE_SEGS) {
    if (lon < r.x0 || lon > r.x1 || lat < r.y0 || lat > r.y1) continue;
    let d = Infinity;
    for (let i = 0; i < r.segs.length; i += 4) {
      const ax = r.segs[i], ay = r.segs[i + 1], dx = r.segs[i + 2] - ax, dy = r.segs[i + 3] - ay;
      const u = within(((lon - ax) * dx + (lat - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      const px = ax + u * dx - lon, py = ay + u * dy - lat;
      d = Math.min(d, Math.sqrt(px * px + py * py));
    }
    best = Math.max(best, r.str * (1 - d / r.wid));
  }
  return best;
}

// ════════════════ Game ════════════════
// opt: { cfg: {map, size, diff, nations, bots, seed}, humans: [{name}], spawnTicks, allowStartNow,
//        mirror: bool, players (mirror only), track: bool (server: record changes for delta()),
//        hooks: { tile(t), event(pid, html, cls, extra), effect(e), end(winnerId) } }
function createGame(opt) {
  const hooks = Object.assign({ tile() {}, event() {}, effect() {}, end() {} }, opt.hooks || {});
  const mirror = !!opt.mirror, track = !!opt.track;
  const cfg = opt.cfg, D = DIFF[cfg.diff] || DIFF.medium;
  const rand = mulberry32((cfg.seed ^ 0x9e3779b9) >>> 0);

  let W = 0, H = 0, N = 0;
  let terrain, owner, baseCol, landBody, landSizes, waterBody, waterSizes, coastal, falloutUntil, structAt, distT, landTotal = 1;
  let players = [null], attacks = [], ships = [], nukes = [], structs = [];
  let tick = 0, state = 'spawn', spawnLeft = opt.spawnTicks || SPAWN_TICKS, immunityUntil = spawnLeft + IMMUNITY_TICKS;
  let ended = false, winner = 0;
  let falloutList = [], tradePaths = new Map();
  const pendingReq = new Map();   // "from:to" -> expiry tick
  const askCooldown = new Map();  // "from:to" -> tick when `from` may ask again
  const offers = new Map();       // id -> trade, joint war or peace offer waiting for a player's answer
  let shipSeq = 1, structVer = 1, allyVer = 1, warVer = 1, offerSeq = 1;
  let moodDirty = false;          // diplomacy changed a grudge or goodwill: send them to clients right away
  let tileBuf = [], falloutBuf = [], fxBuf = [];
  let stampArr, stampId = 0, bfsPrev, bfsMark, bfsQ, bfsStamp = 0;
  const NB = new Int32Array(4);

  function ev(pid, html, cls, extra) { hooks.event(pid, html, cls || 'info', extra || null); }
  function fx(e) { if (track) fxBuf.push(e); hooks.effect(e); }

  function nb4(t, buf) {
    let c = 0; const x = t % W;
    if (x > 0) buf[c++] = t - 1;
    if (x < W - 1) buf[c++] = t + 1;
    if (t >= W) buf[c++] = t - W;
    if (t < N - W) buf[c++] = t + W;
    return c;
  }

  // ──────────── Map ────────────
  function genMap() {
    [W, H] = mapDims(cfg.map, cfg.size); N = W * H;
    const rng = mulberry32(cfg.seed >>> 0);
    const n1 = makeNoise(rng), n2 = makeNoise(rng), n3 = makeNoise(rng);
    const real = Maps.MAPS[cfg.map];
    const h = new Float32Array(N), e = new Float32Array(N);
    let sea, pHigh, pMount;
    terrain = new Uint8Array(N);
    if (real) {
      realLand(real, h, e, n1, n3);
      sea = 0.5; pHigh = 0.34; pMount = 0.72;
      for (let t = 0; t < N; t++) if (h[t] > sea) terrain[t] = e[t] < pHigh ? 1 : e[t] < pMount ? 2 : 3;
      carveStraits(real);
    } else {
      const freq = cfg.map === 'archipelago' ? 9 : cfg.map === 'pangaea' ? 3.4 : 4.4;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const t = y * W + x, nx = x / W * freq, ny = y / W * freq;
        let v = fbm(n1, nx, ny, 5);
        if (cfg.map === 'continents') v = v * 0.75 + fbm(n2, nx * 0.3 + 7, ny * 0.3 + 3, 2) * 0.45;
        if (cfg.map === 'pangaea') {
          const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
          v = v * 0.55 + (1 - Math.sqrt(dx * dx + dy * dy)) * 0.5;
        }
        if (cfg.map === 'twin') {
          // Two big continents facing each other across an ocean
          const blob = (cx, cy) => { const dx = (x / W - cx) / 0.24, dy = (y / H - cy) / 0.4; return 1 - Math.sqrt(dx * dx + dy * dy); };
          v = v * 0.8 + fbm(n2, nx * 0.5 + 3, ny * 0.5 + 9, 3) * 0.25 + Math.max(blob(0.26, 0.47), blob(0.74, 0.53)) * 0.3;
          v -= Math.max(0, 1 - Math.abs(x / W - 0.5) / 0.07) * 0.45;   // keep an ocean between them
        }
        if (cfg.map === 'inland') {
          // A ring of land around a central sea, joined to the ocean by a winding strait in the west
          const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2, d = Math.sqrt(dx * dx + dy * dy);
          v = v * 0.65 + (0.5 - Math.abs(d - 0.56) * 1.7) * 0.45;
          const sy = Math.abs(dy + (fbm(n2, x / W * 6, 0.5, 2) - 0.5) * 0.35);
          if (dx < 0 && sy < 0.06) v -= 0.45 * (1 - sy / 0.06) + 0.1;
        }
        const ex = Math.min(x, W - 1 - x) / W, ey = Math.min(y, H - 1 - y) / H;
        const edge = Math.min(ex / 0.07, ey / 0.1, 1);
        v -= (1 - edge) * 0.5;
        h[t] = v;
        e[t] = (1 - Math.abs(fbm(n3, nx * 1.6, ny * 1.6, 4) * 2 - 1));
      }
      const waterFrac = { continents: 0.52, pangaea: 0.46, archipelago: 0.64, twin: 0.55, inland: 0.5 }[cfg.map] || 0.52;
      const sorted = Float32Array.from(h).sort();
      sea = sorted[Math.floor(N * waterFrac)];
      const landE = [];
      for (let t = 0; t < N; t++) if (h[t] > sea) { e[t] = (h[t] - sea) * 2 + e[t] * 0.35; landE.push(e[t]); }
      landE.sort((a, b) => a - b);
      pHigh = landE[Math.floor(landE.length * 0.58)] || 0; pMount = landE[Math.floor(landE.length * 0.86)] || 0;
      for (let t = 0; t < N; t++) if (h[t] > sea) terrain[t] = e[t] < pHigh ? 1 : e[t] < pMount ? 2 : 3;
    }

    // Remove specks of land and puddles
    let lb = labelBodies(t => terrain[t] !== 0);
    for (let t = 0; t < N; t++) if (terrain[t] && lb.sizes[lb.id[t]] < 12) terrain[t] = 0;
    let wb = labelBodies(t => terrain[t] === 0);
    for (let t = 0; t < N; t++) if (!terrain[t] && wb.sizes[wb.id[t]] < 8) terrain[t] = 1;
    lb = labelBodies(t => terrain[t] !== 0);
    wb = labelBodies(t => terrain[t] === 0);
    landBody = lb.id; landSizes = lb.sizes; waterBody = wb.id; waterSizes = wb.sizes;

    coastal = new Uint8Array(N);
    landTotal = 0;
    const coastDist = new Uint8Array(N).fill(255);
    const q = new Int32Array(N); let qh = 0, qt = 0;
    for (let t = 0; t < N; t++) {
      if (!terrain[t]) continue;
      landTotal++;
      const c = nb4(t, NB);
      for (let i = 0; i < c; i++) if (!terrain[NB[i]]) { coastal[t] = 1; break; }
      coastDist[t] = 0; q[qt++] = t;
    }
    while (qh < qt) {
      const t = q[qh++], d = coastDist[t];
      if (d >= 14) continue;
      const c = nb4(t, NB);
      for (let i = 0; i < c; i++) { const n = NB[i]; if (coastDist[n] === 255) { coastDist[n] = d + 1; q[qt++] = n; } }
    }

    baseCol = new Uint8ClampedArray(N * 3);
    for (let t = 0; t < N; t++) {
      let c;
      const j = (rng() - 0.5) * 6;
      if (!terrain[t]) {
        const d = Math.min(coastDist[t], 14) / 14;
        c = [62 - 38 * d, 118 - 64 * d, 168 - 72 * d];
      } else {
        const lv = within((e[t] - (terrain[t] === 1 ? 0 : terrain[t] === 2 ? pHigh : pMount)) / 0.25, 0, 1);
        if (terrain[t] === 1) c = [112 + 30 * lv, 158 + 18 * lv, 80 + 12 * lv];
        else if (terrain[t] === 2) c = [178 + 18 * lv, 162 + 16 * lv, 112 + 16 * lv];
        else c = [138 + 100 * lv, 132 + 103 * lv, 124 + 110 * lv];
        if (coastal[t]) c = [c[0] * 0.5 + 214 * 0.5, c[1] * 0.5 + 200 * 0.5, c[2] * 0.5 + 150 * 0.5];
      }
      baseCol[t * 3] = c[0] + j; baseCol[t * 3 + 1] = c[1] + j; baseCol[t * 3 + 2] = c[2] + j;
    }

    owner = new Uint16Array(N);
    falloutUntil = new Uint32Array(N);
    structAt = new Int32Array(N).fill(-1);
    distT = new Uint16Array(N);
    stampArr = new Uint32Array(N);
    bfsPrev = new Int32Array(N); bfsMark = new Uint32Array(N); bfsQ = new Int32Array(N);
  }
  // Real maps: land from the baked mask (box-averaged down to the map size, with a little noise
  // so coasts aren't stair-stepped), height from the mountain ranges plus some rolling hills.
  function realLand(m, h, e, n1, n3) {
    const mask = maskCache[cfg.map] || (maskCache[cfg.map] = Maps.decodeMask(m));
    for (let y = 0; y < H; y++) {
      const sy0 = Math.floor(y * m.h / H), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * m.h / H));
      const lat = m.lat[0] - (y + 0.5) / H * (m.lat[0] - m.lat[1]);
      for (let x = 0; x < W; x++) {
        const sx0 = Math.floor(x * m.w / W), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * m.w / W));
        let land = 0;
        for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) land += mask[sy * m.w + sx];
        const t = y * W + x, lon = m.lon[0] + (x + 0.5) / W * (m.lon[1] - m.lon[0]);
        h[t] = land / ((sy1 - sy0) * (sx1 - sx0)) + (n1(x * 0.35, y * 0.35) - 0.5) * 0.25;
        e[t] = rangeHeight(lon, lat) * 1.15 + (1 - Math.abs(fbm(n3, x * 0.05, y * 0.05, 3) * 2 - 1)) * 0.36;
      }
    }
  }
  function lonLatTile(m, lon, lat) {
    const x = Math.floor((lon - m.lon[0]) / (m.lon[1] - m.lon[0]) * W), y = Math.floor((m.lat[0] - lat) / (m.lat[0] - m.lat[1]) * H);
    return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
  }
  function carveStraits(m) {
    for (const s of Maps.STRAITS) {
      let px = -1, py = -1;
      for (let i = 0; i + 3 < s.length; i += 2) {
        const ax = (s[i] - m.lon[0]) / (m.lon[1] - m.lon[0]) * W, ay = (m.lat[0] - s[i + 1]) / (m.lat[0] - m.lat[1]) * H;
        const bx = (s[i + 2] - m.lon[0]) / (m.lon[1] - m.lon[0]) * W, by = (m.lat[0] - s[i + 3]) / (m.lat[0] - m.lat[1]) * H;
        const steps = Math.ceil(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) * 4) + 1;
        for (let k = 0; k <= steps; k++) {
          const x = Math.floor(ax + (bx - ax) * k / steps), y = Math.floor(ay + (by - ay) * k / steps);
          if (x < 0 || y < 0 || x >= W || y >= H) { px = -1; continue; }
          terrain[y * W + x] = 0;
          // Keep the channel connected through edges, not just corners, so boats can follow it
          if (px >= 0 && px !== x && py !== y) terrain[y * W + px] = 0;
          px = x; py = y;
        }
      }
    }
  }
  function labelBodies(pred) {
    const id = new Int32Array(N).fill(-1), sizes = [], st = new Int32Array(N), buf = new Int32Array(4);
    for (let s = 0; s < N; s++) {
      if (id[s] !== -1 || !pred(s)) continue;
      const k = sizes.length; let sp = 0, c = 0;
      st[sp++] = s; id[s] = k;
      while (sp) {
        const t = st[--sp]; c++;
        const m = nb4(t, buf);
        for (let i = 0; i < m; i++) { const n = buf[i]; if (id[n] === -1 && pred(n)) { id[n] = k; st[sp++] = n; } }
      }
      sizes.push(c);
    }
    return { id, sizes };
  }

  // ──────────── Tiles & ownership ────────────
  function isBorderTile(t) {
    const o = owner[t], x = t % W;
    return (x > 0 && owner[t - 1] !== o) || (x < W - 1 && owner[t + 1] !== o) ||
      (t >= W && owner[t - W] !== o) || (t < N - W && owner[t + W] !== o);
  }
  function refreshTile(t) {
    if (!terrain[t]) return;
    const o = owner[t];
    if (o) { const p = players[o]; if (isBorderTile(t)) p.border.add(t); else p.border.delete(t); }
    hooks.tile(t);
  }
  function setOwner(t, o) {
    const old = owner[t];
    if (old === o) return;
    if (old) { const op = players[old]; op.tiles--; op.terr[terrain[t]]--; op.coast -= coastal[t]; op.border.delete(t); }
    owner[t] = o;
    if (o) { const np = players[o]; np.tiles++; np.terr[terrain[t]]++; np.coast += coastal[t]; }
    if (track) tileBuf.push(t, o);
    refreshTile(t);
    const x = t % W;
    if (x > 0) refreshTile(t - 1);
    if (x < W - 1) refreshTile(t + 1);
    if (t >= W) refreshTile(t - W);
    if (t < N - W) refreshTile(t + W);
    if (mirror) return;
    const si = structAt[t];
    if (si >= 0) {
      const s = structs[si];
      if (!o || s.type === 'defense') destroyStruct(s);
      else { s.owner = o; structVer++; }
    }
  }

  // Distance-to-border pass: used for name label placement and finding interior tiles.
  function computeLabels() {
    for (let t = 0; t < N; t++) {
      const o = owner[t];
      if (!o) { distT[t] = 0; continue; }
      if (isBorderTile(t)) { distT[t] = 1; continue; }
      const x = t % W;
      distT[t] = Math.min(x > 0 ? distT[t - 1] : 0, t >= W ? distT[t - W] : 0) + 1;
    }
    for (let t = N - 1; t >= 0; t--) {
      if (!owner[t] || distT[t] <= 1) continue;
      const x = t % W;
      const m = Math.min(x < W - 1 ? distT[t + 1] : 0, t < N - W ? distT[t + W] : 0) + 1;
      if (m < distT[t]) distT[t] = m;
    }
    for (const p of players) if (p) { p.best = 0; p.bestT = -1; p.minX = W; p.maxX = 0; p.minY = H; p.maxY = 0; }
    for (let t = 0; t < N; t++) {
      const o = owner[t]; if (!o) continue;
      const p = players[o], x = t % W, y = (t / W) | 0;
      if (distT[t] > p.best) { p.best = distT[t]; p.bestT = t; }
      if (x < p.minX) p.minX = x; if (x > p.maxX) p.maxX = x;
      if (y < p.minY) p.minY = y; if (y > p.maxY) p.maxY = y;
    }
    for (const p of players) {
      if (!p || p.bestT < 0) continue;
      const d = p.best;
      p.lx = p.bestT % W + 0.5; p.ly = ((p.bestT / W) | 0) + 0.5;
      p.lfs = Math.min(d * 0.75, (2 * d * 0.9) / (Math.max(4, p.name.length) * 0.62));
    }
  }
  function findTile(p, pred, tries = 160) {
    if (p.maxX < p.minX) return -1;
    const w = p.maxX - p.minX + 1, hh = p.maxY - p.minY + 1;
    for (let i = 0; i < tries; i++) {
      const t = (p.minY + (rand() * hh | 0)) * W + p.minX + (rand() * w | 0);
      if (owner[t] === p.id && pred(t)) return t;
    }
    return -1;
  }

  // ──────────── Players ────────────
  function makePlayer(name, type, color, id, leader) {
    const p = {
      id: id || players.length, name, type, color,
      leader: LEADERS[leader] ? leader : -1,
      troops: type === 'bot' ? 10000 : type === 'nation' ? D.start : 25000,
      gold: 0, tiles: 0, border: new Set(), alive: true, spawned: false,
      civs: 0, share: type === 'human' ? DEFAULT_SHARE : 1, factories: 0, ports: 0,
      allies: new Map(), traitorUntil: 0, hate: new Map(), cityLevels: 0,
      wars: new Map(),     // enemy id -> { until, start }
      favor: new Map(),    // goodwill from gifts and fair trades
      peaceAt: new Map(),  // id -> tick a peace treaty was signed (computer nations honour it for a while)
      kills: 0,
      m: null,             // rule modifiers from the leader's bonus and active power
      terr: [0, 0, 0, 0],  // tiles owned of each terrain
      coast: 0,            // coastal tiles owned
      powerReady: 0, powerUntil: 0, powerOn: false, freeNukes: 0,
      nukes: 0,            // bombs launched (reveals a hidden agenda)
      lx: 0, ly: 0, lfs: 0, best: 0, bestT: -1, minX: W, maxX: 0, minY: H, maxY: 0,
      aiPhase: (rand() * 20) | 0, lastHitBy: 0,
    };
    refreshMods(p);
    players[p.id] = p;
    return p;
  }
  // Rebuild p.m from the leader's bonus plus their power while it is active
  function refreshMods(p) {
    const L = leaderOf(p);
    p.powerOn = !!L && p.powerUntil > tick;
    p.m = mergeMods(mergeMods({ ...MOD_DEFAULTS }, L && L.bonus.mods), p.powerOn && L.power.mods);
  }
  function traitsOf(p) { return p && p.leader >= 0 ? LEADERS[p.leader].t : NEUTRAL_TRAITS; }
  function leaderOf(p) { return p && p.leader >= 0 ? LEADERS[p.leader] : null; }
  // "Gandhi (India)" for diplomatic messages
  function who(p) { const L = leaderOf(p); return L && p.type === 'nation' ? `<b>${esc(L.name)}</b> (${esc(p.name)})` : `<b>${esc(p.name)}</b>`; }
  function botName() {
    const n = SYL[rand() * SYL.length | 0] + SYL[rand() * SYL.length | 0] + (rand() < 0.5 ? SYL[rand() * SYL.length | 0] : '');
    return n[0].toUpperCase() + n.slice(1);
  }
  function maxTroops(p) {
    // troopCap() in OpenFront: 2 * (tiles^0.6 * 1000 + 50000) + cities
    let m = 2 * (Math.pow(p.tiles * TILE_SCALE, 0.6) * 1000 + 50000) + p.cityLevels * CITY_TROOPS * p.m.cityCap + (p.terr[2] + p.terr[3]) * p.m.hillCap;
    if (p.type === 'bot') m /= 3;
    return m * p.m.cap;
  }
  // Growth of the whole population (troops + civilians), capped by maxTroops()
  function popRate(p) {
    // troopIncreaseRate() in OpenFront
    const max = maxTroops(p), pop = p.troops + (p.civs || 0);
    let add = (10 + Math.pow(Math.max(0, pop), 0.73) / 4) * (1 - pop / max);
    if (p.type === 'bot') add *= 0.5;
    if (p.type === 'nation') add *= D.grow;
    add *= p.m.growth * (1 + p.m.allyGrowth * p.allies.size);
    if (p.m.warGrowth !== 1 && underFire(p)) add *= p.m.warGrowth;
    return add;
  }
  const underFire = p => p.wars.size > 0 || attacks.some(a => a.target === p.id && players[a.p].type !== 'bot');
  function troopRate(p) { return popRate(p) * (p.share == null ? 1 : p.share); }
  // Base income from land: small, so most gold comes from ports and factories
  function landGold(p) {
    const g = ((p.type === 'bot' ? 50 : 100) + 2 * Math.sqrt(p.tiles)) * p.m.gold;
    return p.m.peaceGold !== 1 && !p.wars.size && !attacks.some(a => a.p === p.id && a.target && players[a.target].type !== 'bot') ? g * p.m.peaceGold : g;
  }
  const jobsOf = p => p.ports * PORT_JOBS + p.factories * FACTORY_JOBS;
  const workersOf = p => Math.min(p.civs || 0, jobsOf(p));
  const workerGold = p => workersOf(p) * WORKER_GOLD * p.m.civGold * (resActive('workers') ? 1.3 : 1);
  function goldRate(p) {
    let g = landGold(p) + workerGold(p) + p.factories * FACTORY_GOLD * p.m.factoryGold + p.ports * PORT_GOLD
      + p.coast * p.m.coastGold + p.cityLevels * p.m.cityGold;
    if (p.m.allyGold) for (const [id] of p.allies) if (players[id].alive) g += landGold(players[id]) * p.m.allyGold;
    return resActive('sanctions', p.id) ? g * 0.7 : g;
  }
  function growPopulation(p) {
    const add = popRate(p);
    p.troops = Math.max(0, p.troops + add * p.share);
    p.civs = Math.max(0, p.civs + add * (1 - p.share));
    // People switch between troops and civilians gradually towards the chosen split
    const pop = p.troops + p.civs;
    if (pop > 0) {
      const d = pop * p.share - p.troops, step = Math.sign(d) * Math.min(Math.abs(d), pop * SHARE_SHIFT);
      p.troops = Math.max(0, p.troops + step);
      p.civs = Math.max(0, p.civs - step);
    }
  }
  function allied(a, b) { return a !== b && a > 0 && b > 0 && !!players[a] && players[a].allies.has(b); }
  function addHate(p, towards, v) { if (p && p.type !== 'human') p.hate.set(towards, (p.hate.get(towards) || 0) + v); }
  const isHuman = p => p && p.type === 'human';

  function neighbors(p) {
    const res = { neutral: 0, players: new Map(), coastal: 0 };
    const buf = new Int32Array(4);
    for (const t of p.border) {
      if (coastal[t]) res.coastal++;
      const c = nb4(t, buf);
      for (let i = 0; i < c; i++) {
        const n = buf[i];
        if (!terrain[n]) continue;
        const o = owner[n];
        if (o === p.id) continue;
        if (!o) res.neutral++;
        else res.players.set(o, (res.players.get(o) || 0) + 1);
      }
    }
    return res;
  }
  // Does p touch land owned by `target` (0 = unclaimed) on the given landmass (-1 = any)?
  function touches(p, target, body) {
    const buf = new Int32Array(4);
    for (const t of p.border) {
      if (body >= 0 && landBody[t] !== body) continue;
      const c = nb4(t, buf);
      for (let i = 0; i < c; i++) { const n = buf[i]; if (terrain[n] && owner[n] === target) return true; }
    }
    return false;
  }

  // ──────────── Attacks ────────────
  function startAttack(p, target, troops, fromBoat) {
    if (!p.alive || troops < 1) return false;
    if (target && (allied(p.id, target) || target === p.id)) return false;
    if (target && tick < immunityUntil) return false;
    if (target && needsWar(p, target)) return false;
    if (target) refreshWar(p, players[target]);
    if (!fromBoat) p.troops -= troops;
    if (target) {
      const q = players[target];
      // Opposing attacks cancel each other out first.
      const opp = attacks.find(a => a.p === target && a.target === p.id);
      if (opp) {
        const m = Math.min(opp.troops, troops);
        opp.troops -= m; troops -= m;
        if (opp.troops <= 0) removeAttack(opp, false);
      }
      addHate(q, p.id, 1);
      if (isHuman(q)) {
        const known = attacks.some(a => a.p === p.id && a.target === target);
        if (!known) ev(q.id, `<b>${esc(p.name)}</b> is attacking you with ${fmt(troops)} troops!`, 'bad');
      }
    }
    if (troops <= 0) return true;
    const ex = attacks.find(a => a.p === p.id && a.target === target);
    if (ex) ex.troops += troops;
    else attacks.push({ p: p.id, target, troops });
    return true;
  }
  function removeAttack(a, refund) {
    const i = attacks.indexOf(a);
    if (i >= 0) attacks.splice(i, 1);
    if (refund && players[a.p].alive) players[a.p].troops += a.troops * refund;
  }
  function hasDefensePost(t, o) {
    const m = players[o].m, x = t % W, y = (t / W) | 0, R = DEFENSE_RANGE * m.defRange, R2 = R * R;
    for (const s of structs) {
      if (!s.alive || s.owner !== o || s.doneAt > tick || !(s.type === 'defense' || (m.cityDef && s.type === 'city'))) continue;
      const dx = s.x - x, dy = s.y - y;
      if (dx * dx + dy * dy <= R2) return true;
    }
    return false;
  }
  function stepAttack(a) {
    const P = players[a.p], tid = a.target, T = tid ? players[tid] : null;
    if (!P.alive || (T && !T.alive) || (tid && allied(a.p, tid))) { removeAttack(a, 1); return; }
    stampId++;
    const cand = [], buf = new Int32Array(4);
    for (const t of P.border) {
      const c = nb4(t, buf);
      for (let i = 0; i < c; i++) {
        const n = buf[i];
        if (owner[n] !== tid || !terrain[n] || stampArr[n] === stampId) continue;
        stampArr[n] = stampId; cand.push(n);
      }
    }
    if (!cand.length) { removeAttack(a, 1); return; }
    // Favour tiles already surrounded by the attacker so fronts stay smooth.
    const score = new Float32Array(cand.length);
    for (let k = 0; k < cand.length; k++) {
      const t = cand[k], c = nb4(t, buf); let own = 0;
      for (let i = 0; i < c; i++) if (owner[buf[i]] === a.p) own++;
      score[k] = own + rand() * 1.6;
    }
    const order = Array.from(cand.keys()).sort((i, j) => score[j] - score[i]);
    const border = cand.length, Pm = P.m, Tm = T ? T.m : null;
    // Leader abilities on both sides that scale this attack's losses
    let am = 1;
    if (T) {
      am = Pm.atk * Tm.def;
      if (T.type === 'bot') am *= Pm.atkBots;
      if (T.tiles > P.tiles) am *= Pm.vsBigger; else if (P.tiles > T.tiles) am *= Tm.defBigger;
      if (T.troops < P.troops) am *= Pm.vsWeaker;
      if (Pm.revenge !== 1 && attacks.some(x => x.p === tid && x.target === P.id)) am *= Pm.revenge;
      if (Pm.killPower) am *= Math.max(0.5, 1 - Pm.killPower * P.kills);
      // Traitors fight and defend 20% worse
      if (P.traitorUntil > tick) am *= 1.25;
      if (T.traitorUntil > tick) am *= 0.8;
    }
    let frac = 0;
    for (const k of order) {
      const t = cand[k], hills = terrain[t] >= 2;
      let { mag, cost } = TERR[terrain[t]];
      if (T && hasDefensePost(t, tid)) { mag *= 5 * Tm.defStr; cost *= 3; }
      if (falloutUntil[t] > tick) { mag *= 2; cost *= 2; }
      mag *= hills ? Pm.atkHills : Pm.atkPlains;
      if (T) mag *= am * (hills ? Tm.defHills : 1);
      let loss, defLoss = 0, f;
      if (!T) {
        loss = mag / (P.type === 'bot' ? 10 : 5) * TILE_SCALE * Pm.atkNeutral;
        f = within(2000 * cost / Math.max(1, a.troops), 5, 100) / (border * 2);
      } else {
        if (P.type !== 'bot' && T.type === 'bot') mag *= 0.7;
        defLoss = T.troops / Math.max(1, T.tiles);
        const ratio = T.troops / Math.max(1, a.troops);
        loss = mag * within(ratio, 0.6, 2) * (0.463 * TILE_SCALE + 0.0039 * defLoss);
        const speedCost = within(ratio, 0.82, 7.5) * within(ratio / 20, 1, 50) / 8.55;
        f = speedCost * cost / border;
      }
      if (a.troops < loss) { removeAttack(a, 0); return; }
      a.troops -= loss;
      if (T) { T.troops = Math.max(0, T.troops - defLoss); T.lastHitBy = a.p; P.gold += Pm.plunder; }
      setOwner(t, a.p);
      frac += f * FRONT_SLOWDOWN / Pm.speed;
      if (frac >= 1) break;
    }
  }

  // ──────────── Ships ────────────
  function waterBFS(starts, isGoal, maxNodes) {
    bfsStamp++;
    let qh = 0, qt = 0;
    for (const s of starts) { if (bfsMark[s] === bfsStamp) continue; bfsMark[s] = bfsStamp; bfsPrev[s] = -1; bfsQ[qt++] = s; }
    const buf = new Int32Array(4);
    while (qh < qt) {
      const t = bfsQ[qh++];
      if (isGoal(t)) return t;
      if (maxNodes && qh > maxNodes) return -1;
      const c = nb4(t, buf);
      for (let i = 0; i < c; i++) {
        const n = buf[i];
        if (terrain[n] || bfsMark[n] === bfsStamp) continue;
        bfsMark[n] = bfsStamp; bfsPrev[n] = t; bfsQ[qt++] = n;
      }
    }
    return -1;
  }
  function tracePath(goal) { const path = []; for (let t = goal; t !== -1; t = bfsPrev[t]) path.push(t); return path; }
  function waterNbrs(t) { const c = nb4(t, NB), out = []; for (let i = 0; i < c; i++) if (!terrain[NB[i]]) out.push(NB[i]); return out; }
  function boatsOf(p) { let n = 0; for (const s of ships) if (s.kind === 'transport' && s.owner === p.id) n++; return n; }

  // Route a transport from p's nearest coast to land tile T.
  function boatPath(p, T) {
    const starts = waterNbrs(T);
    if (!starts.length) return null;
    const buf = new Int32Array(4);
    const goal = waterBFS(starts, w => {
      const c = nb4(w, buf);
      for (let i = 0; i < c; i++) if (owner[buf[i]] === p.id && terrain[buf[i]]) return true;
      return false;
    });
    return goal < 0 ? null : tracePath(goal);
  }
  function addShip(s) { s.id = shipSeq++; s.px = s.x; s.py = s.y; s.ang = s.ang || 0; ships.push(s); return s; }
  function sendBoat(p, T, troops, declare) {
    if (!terrain[T]) return 'Boats must land on a coast';
    const werr = ensureWar(p, owner[T], declare);
    if (werr) return werr;
    if (boatsOf(p) >= MAX_BOATS + p.m.boats) return `You already have ${MAX_BOATS + p.m.boats} boats at sea`;
    const tgt = owner[T];
    if (tgt === p.id) return null;
    if (tgt && tick < immunityUntil) return 'Spawn protection is still active';
    if (tgt && allied(p.id, tgt)) return 'You cannot attack an ally';
    if (troops < 1) return 'Not enough troops';
    const path = boatPath(p, T);
    if (!path) return 'No sea route to that coast';
    p.troops -= troops;
    const s0 = path[0];
    addShip({ kind: 'transport', owner: p.id, path, i: 0, x: s0 % W + 0.5, y: ((s0 / W) | 0) + 0.5, troops, target: T, speed: BOAT_SPEED * p.m.boatSpeed });
    if (tgt) {
      addHate(players[tgt], p.id, 1);
      if (isHuman(players[tgt])) ev(tgt, `<b>${esc(p.name)}</b> sent a boat with ${fmt(troops)} troops toward you`, 'warn');
    }
    return null;
  }
  function followPath(s, speed) {
    let rem = speed;
    while (rem > 0 && s.i < s.path.length) {
      const t = s.path[s.i], tx = t % W + 0.5, ty = ((t / W) | 0) + 0.5;
      const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
      if (d > 0.01) s.ang = Math.atan2(dy, dx);
      if (d <= rem) { s.x = tx; s.y = ty; rem -= d; s.i++; }
      else { s.x += dx / d * rem; s.y += dy / d * rem; rem = 0; }
    }
    return s.i >= s.path.length;
  }
  function shipTile(s) { return (s.y | 0) * W + (s.x | 0); }
  function landBoat(s) {
    const P = players[s.owner];
    if (!P.alive) return;
    const T = s.target, o = owner[T];
    if (o === s.owner) { P.troops += s.troops; return; }
    if (o && (allied(s.owner, o) || tick < immunityUntil || needsWar(P, o))) { P.troops += s.troops; return; }
    // Raiders land stronger; isolationist coasts shred invaders
    const troops = s.troops * P.m.boatPower / (o ? players[o].m.coastDef : 1);
    setOwner(T, s.owner);
    startAttack(P, o, troops, true);
    if (isHuman(P)) ev(P.id, `Your boat landed on ${o ? '<b>' + esc(players[o].name) + '</b>' : 'new land'}`, 'good');
  }
  function spawnTrade(s) {
    const options = structs.filter(d => d.alive && d.type === 'port' && d.doneAt <= tick && d.owner !== s.owner &&
      players[d.owner].alive && waterBody[d.dock] === waterBody[s.dock]);
    if (!options.length) return;
    const d = options[rand() * options.length | 0];
    const key = s.id + '>' + d.id;
    let path = tradePaths.get(key);
    if (path === undefined) {
      const goal = waterBFS([d.dock], t => t === s.dock);
      path = goal < 0 ? null : tracePath(goal);
      tradePaths.set(key, path);
    }
    if (!path) return;
    const t0 = path[0];
    addShip({ kind: 'trade', owner: s.owner, path, i: 0, x: t0 % W + 0.5, y: ((t0 / W) | 0) + 0.5, dest: d, value: Math.floor(3000 + path.length * 120), speed: 0.9 });
  }
  // Warships fire their cannon at enemy ships in range (only nations they are at war with):
  // boats and trade ships sink in one shot, warships and cruisers take damage.
  function stepWarship(s) {
    s.cd = Math.max(0, s.cd - 1);
    if (s.cd === 0) {
      let best = null, bd = CANNON_RANGE * CANNON_RANGE;
      for (const o of ships) {
        if (o === s || o.dead || !atWar(s.owner, o.owner)) continue;
        const dx = o.x - s.x, dy = o.y - s.y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = o; }
      }
      if (best) { s.cd = 15; fireAt(s, best); }
    }
    sail(s);
  }
  function fireAt(s, o) {
    const S = players[s.owner], O = players[o.owner];
    fx({ kind: 'shot', x0: s.x, y0: s.y, x1: o.x, y1: o.y, dur: 250 });
    if (o.kind === 'warship' || o.kind === 'cruiser') {
      o.hp -= 250 * S.m.warshipDmg;
      if (o.hp > 0) return;
      o.dead = true; boom(o.x, o.y, 3);
      if (isHuman(O)) ev(O.id, `One of your ${o.kind}s was sunk by ${who(S)}`, 'bad');
      if (isHuman(S)) ev(S.id, `Your warship sank a ${o.kind} from ${who(O)}`, 'good', { ttl: 3000 });
      return;
    }
    o.dead = true; boom(o.x, o.y, 2);
    if (o.kind === 'trade') {
      S.gold += o.value * (S.m.piracy ? 2 : 1);
      if (isHuman(O)) ev(O.id, `${who(S)} sank your trade ship`, 'bad');
      return;
    }
    // Pirates press the crew of a sunk boat into service
    if (S.m.piracy) { S.troops += o.troops * S.m.piracy; if (isHuman(S)) ev(S.id, `${fmt(o.troops * S.m.piracy)} troops from the sunk boat joined you`, 'good', { ttl: 3000 }); }
    if (isHuman(O)) ev(O.id, `Your boat with ${fmt(o.troops)} troops was sunk by ${who(S)}`, 'bad');
    if (isHuman(S)) ev(S.id, `Your warship sank a boat from ${who(O)}`, 'good', { ttl: 3000 });
  }
  // Cruisers shell enemy buildings in range (ports first), or the troops on the nearest enemy coast
  function stepCruiser(s) {
    s.cd = Math.max(0, s.cd - 1);
    if (s.cd === 0) {
      const S = players[s.owner], R2 = CRUISER_RANGE * CRUISER_RANGE;
      let tgt = null, td = Infinity;
      for (const b of structs) {
        if (!b.alive || !atWar(s.owner, b.owner)) continue;
        const dx = b.x + 0.5 - s.x, dy = b.y + 0.5 - s.y, d2 = dx * dx + dy * dy;
        const w = b.type === 'port' ? d2 * 0.4 : d2;
        if (d2 <= R2 && w < td) { td = w; tgt = b; }
      }
      if (tgt) {
        s.cd = 20;
        fx({ kind: 'shot', x0: s.x, y0: s.y, x1: tgt.x + 0.5, y1: tgt.y + 0.5, dur: 300 });
        boom(tgt.x + 0.5, tgt.y + 0.5, 2);
        const O = players[tgt.owner];
        // Three shells wreck a building; a city loses a level instead
        if (++tgt.hits >= 3) {
          tgt.hits = 0;
          const name = BUILD[tgt.type].name.toLowerCase();
          if (tgt.type === 'city' && tgt.level > 1) { tgt.level--; structVer++; }
          else destroyStruct(tgt);
          if (isHuman(O)) ev(O.id, `An enemy cruiser from ${who(S)} shelled your ${name}`, 'bad', { ttl: 3000 });
          if (isHuman(S)) ev(S.id, `Your cruiser destroyed a ${name} of ${who(O)}`, 'good', { ttl: 3000 });
        }
      } else {
        // Nothing to hit: shell the nearest enemy-held coast and kill the troops there
        const cx = s.x | 0, cy = s.y | 0, R = CRUISER_RANGE;
        let best = -1, bd = R2;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx, y = cy + dy, d2 = dx * dx + dy * dy;
          if (x < 0 || y < 0 || x >= W || y >= H || d2 >= bd) continue;
          const t = y * W + x;
          if (coastal[t] && owner[t] && atWar(s.owner, owner[t])) { bd = d2; best = t; }
        }
        if (best >= 0) {
          s.cd = 20;
          const O = players[owner[best]], bx = best % W + 0.5, by = ((best / W) | 0) + 0.5;
          fx({ kind: 'shot', x0: s.x, y0: s.y, x1: bx, y1: by, dur: 300 });
          boom(bx, by, 2);
          O.troops -= Math.min(O.troops, O.troops / Math.max(1, O.tiles) * 10 * S.m.warshipDmg);
        }
      }
    }
    sail(s);
  }
  // Warships and cruisers: follow an order, otherwise patrol around their home water
  function sail(s) {
    const sp = players[s.owner].m.warshipSpeed;
    if (s.ordered) {
      if (s.path && s.i < s.path.length) { followPath(s, WARSHIP_SPEED * sp); return; }
      s.ordered = false; s.path = null;   // arrived: patrol around the new spot
    }
    if (!s.path || s.i >= s.path.length) {
      s.path = null;
      const hx = s.home % W, hy = (s.home / W) | 0, body = waterBody[s.home];
      for (let k = 0; k < 20; k++) {
        const x = within(hx + ((rand() - 0.5) * 50 | 0), 0, W - 1), y = within(hy + ((rand() - 0.5) * 50 | 0), 0, H - 1), t = y * W + x;
        if (terrain[t] || waterBody[t] !== body) continue;
        const cur = shipTile(s);
        const g = waterBFS([t], u => u === cur, 6000);
        if (g >= 0) { s.path = tracePath(g); s.i = 0; break; }
      }
      if (!s.path) return;
    }
    followPath(s, 0.8 * sp);
  }
  // Send a warship or cruiser to water tile t. Returns why it can't go, or null.
  function orderShip(s, t) {
    const cur = shipTile(s);
    if (!(t >= 0 && t < N) || terrain[t]) return 'Ships can only sail on water';
    if (waterBody[t] !== waterBody[cur]) return "Your ship can't reach that water";
    const g = waterBFS([t], u => u === cur, 60000);
    if (g < 0) return "Your ship can't reach that water";
    s.path = tracePath(g); s.i = 0; s.home = t; s.ordered = true;
    return null;
  }

  // ──────────── Structures ────────────
  function countUnits(p, type) {
    if (type === 'warship' || type === 'cruiser') return ships.filter(s => s.kind === type && s.owner === p.id).length;
    let n = 0;
    for (const s of structs) if (s.alive && s.owner === p.id && s.type === type) n += type === 'city' ? s.level : 1;
    return n;
  }
  function costOf(p, type) {
    // unitCost() in OpenFront
    const n = countUnits(p, type), m = p.m['c_' + type], atomic = resActive('atomic') ? 0.6 : 1;
    switch (type) {
      case 'city': return Math.min(2e6, 2 ** n * 125000) * m;
      case 'port': return Math.min(5e6, 2 ** n * 125000) * m;
      case 'factory': return Math.min(5e6, 2 ** n * 200000) * m;
      case 'defense': return Math.min(250000, (n + 1) * 50000) * m;
      case 'sam': return Math.min(2e6, 1e6 + n * 250000) * m;
      case 'silo': return 1e6 * m * atomic;
      case 'warship': return Math.min(1e6, (n + 1) * 250000) * m;
      case 'cruiser': return Math.min(1.6e6, (n + 1) * 400000) * m;
      case 'atom': return p.freeNukes > 0 ? 0 : 750000 * m * atomic;
      case 'hydrogen': return 5e6 * m * atomic;
    }
    return Infinity;
  }
  function spacingOk(t, minD) {
    const x = t % W, y = (t / W) | 0, m2 = minD * minD;
    for (const s of structs) {
      if (!s.alive) continue;
      const dx = s.x - x, dy = s.y - y;
      if (dx * dx + dy * dy < m2) return false;
    }
    return true;
  }
  function readySilo(p, t) {
    let best = null, bd = 1e18;
    const x = t % W, y = (t / W) | 0;
    for (const s of structs) {
      if (!s.alive || s.type !== 'silo' || s.owner !== p.id || s.doneAt > tick || s.readyAt > tick) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function nearestPort(p, t) {
    let best = null, bd = 50 * 50;
    const x = t % W, y = (t / W) | 0;
    for (const s of structs) {
      if (!s.alive || s.type !== 'port' || s.owner !== p.id || s.doneAt > tick || waterBody[s.dock] !== waterBody[t]) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  // Returns null if p can build `type` on tile t, otherwise the reason it can't.
  function placeError(p, type, t) {
    if (!(t >= 0 && t < N)) return 'Off the map';
    if ((type === 'atom' || type === 'hydrogen' || type === 'silo') && resActive('nonprolif')) return "The World's Fair has banned nuclear weapons";
    if (type === 'atom' || type === 'hydrogen') return readySilo(p, t) ? null : 'You need a ready missile silo';
    if (type === 'warship' || type === 'cruiser') {
      if (terrain[t]) return `Place ${type}s on water`;
      return nearestPort(p, t) ? null : 'Must be within 50 tiles of one of your ports';
    }
    if (owner[t] !== p.id) return 'Build on your own land';
    const ex = structAt[t] >= 0 ? structs[structAt[t]] : null;
    if (type === 'city' && ex && ex.type === 'city') return null;   // upgrade
    if (type === 'port' && !coastal[t]) return 'Ports must be on the coast';
    if (!spacingOk(t, 4)) return 'Too close to another building';
    return null;
  }
  function build(p, type, t, declare) {
    if (!BUILD[type]) return 'Unknown building';
    if ((type === 'atom' || type === 'hydrogen') && t >= 0 && t < N) { const werr = ensureWar(p, owner[t], declare); if (werr) return werr; }
    const cost = costOf(p, type);
    if (p.gold < cost) return 'Not enough gold';
    const err = placeError(p, type, t);
    if (err) return err;
    if (type === 'atom' || type === 'hydrogen') return launchNuke(p, type, t, cost);
    if (type === 'warship' || type === 'cruiser') {
      p.gold -= cost;
      addWarship(p, nearestPort(p, t).dock, t, type);
      return null;
    }
    p.gold -= cost;
    placeStruct(p, type, t);
    if (isHuman(p)) ev(p.id, `${BUILD[type].name} under construction`, 'good', { ttl: 2000 });
    return null;
  }
  function addWarship(p, dock, home, kind = 'warship') {
    return addShip({ kind, owner: p.id, x: dock % W + 0.5, y: ((dock / W) | 0) + 0.5, hp: (kind === 'cruiser' ? 1500 : 1000) * p.m.warshipHp, home, path: null, i: 0, cd: 0 });
  }
  // Put up a building (or raise a city's level) without paying for it
  function placeStruct(p, type, t) {
    structVer++;
    const ex = structAt[t] >= 0 ? structs[structAt[t]] : null;
    if (type === 'city' && ex) { ex.level++; return ex; }
    const time = Math.round(BUILD[type].time * p.m.buildTime);
    const s = { id: structs.length, type, owner: p.id, t, x: t % W, y: (t / W) | 0, level: 1, doneAt: tick + time, readyAt: 0, alive: true, dock: -1, nextTrade: tick + time + 30, hits: 0 };
    if (type === 'port') {
      let bestW = -1;
      for (const w of waterNbrs(t)) if (bestW < 0 || waterSizes[waterBody[w]] > waterSizes[waterBody[bestW]]) bestW = w;
      s.dock = bestW;
    }
    structs.push(s);
    structAt[t] = s.id;
    return s;
  }
  function destroyStruct(s) {
    if (!s.alive) return;
    s.alive = false;
    structVer++;
    if (structAt[s.t] === s.id) structAt[s.t] = -1;
  }

  // ──────────── Nukes ────────────
  function launchNuke(p, type, t, cost) {
    const silo = readySilo(p, t);
    if (!silo) return 'You need a ready missile silo';
    p.gold -= cost;
    if (type === 'atom' && p.freeNukes > 0) p.freeNukes--;
    silo.readyAt = tick + Math.round(80 * p.m.siloReload);
    structVer++;
    // The first bomb gives away a hidden agenda
    if (++p.nukes === 1 && p.type === 'nation' && leaderOf(p) && leaderOf(p).hidden)
      ev(0, `&#9762; ${who(p)} was never as peaceful as he looked. Hidden agenda revealed: ${esc(leaderOf(p).hidden)}`, 'warn', { ttl: 12000 });
    const tx = t % W + 0.5, ty = ((t / W) | 0) + 0.5, x0 = silo.x + 0.5, y0 = silo.y + 0.5;
    const dur = Math.max(25, Math.hypot(tx - x0, ty - y0) / 2.5 | 0);
    const nk = { owner: p.id, type, x0, y0, tx, ty, t, start: tick, dur, intercept: -1, sam: null };
    for (const s of structs) {
      if (!s.alive || s.type !== 'sam' || s.doneAt > tick || s.readyAt > tick) continue;
      if (s.owner === p.id || allied(s.owner, p.id)) continue;
      if ((s.x - tx) ** 2 + (s.y - ty) ** 2 > SAM_RANGE * SAM_RANGE) continue;
      nk.intercept = tick + Math.floor(dur * 0.75);
      nk.sam = s;
      s.readyAt = nk.intercept + 100;
      break;
    }
    nukes.push(nk);
    const v = owner[t];
    const what = type === 'atom' ? 'an atom bomb' : 'a hydrogen bomb';
    if (v && v !== p.id) {
      addHate(players[v], p.id, 12);
      if (isHuman(players[v])) ev(v, `&#9762; <b>${esc(p.name)}</b> launched ${what} at you!`, 'bad');
    }
    ev(0, `&#9762; <b>${esc(p.name)}</b> launched ${what}${v && v !== p.id ? ' at <b>' + esc(players[v].name) + '</b>' : ''}`, 'warn', { except: [p.id, v] });
    return null;
  }
  function nukePos(nk, alpha) {
    const pr = Math.min(1, (tick - nk.start + alpha) / nk.dur);
    const d = Math.hypot(nk.tx - nk.x0, nk.ty - nk.y0);
    return [nk.x0 + (nk.tx - nk.x0) * pr, nk.y0 + (nk.ty - nk.y0) * pr - Math.sin(Math.PI * pr) * d * 0.25];
  }
  function detonate(nk) {
    const R = NUKE[nk.type], cx = nk.t % W, cy = (nk.t / W) | 0;
    const in2 = R.inner * R.inner, out2 = R.outer * R.outer;
    for (const s of structs) if (s.alive && (s.x - cx) ** 2 + (s.y - cy) ** 2 <= out2) destroyStruct(s);
    for (const s of ships) if ((s.x - cx) ** 2 + (s.y - cy) ** 2 <= out2) s.dead = true;
    const lost = new Map(), before = new Map();
    for (let dy = -R.outer; dy <= R.outer; dy++) for (let dx = -R.outer; dx <= R.outer; dx++) {
      const x = cx + dx, y = cy + dy, d2 = dx * dx + dy * dy;
      if (x < 0 || y < 0 || x >= W || y >= H || d2 > out2) continue;
      if (d2 > in2 && rand() > 0.5) continue;
      const t = y * W + x;
      if (!terrain[t]) continue;
      falloutUntil[t] = tick + 400 + (rand() * 500 | 0);
      falloutList.push(t);
      if (track) falloutBuf.push(t, falloutUntil[t]);
      const o = owner[t];
      if (o) {
        if (!before.has(o)) before.set(o, players[o].tiles);
        lost.set(o, (lost.get(o) || 0) + 1);
        players[o].lastHitBy = nk.owner;
        setOwner(t, 0);
      } else hooks.tile(t);
    }
    // nukeDeathFactor() in OpenFront kills 5 × troops/tile per tile; softened to 3 for the smaller map.
    for (const [o, l] of lost) {
      const q = players[o];
      q.troops -= Math.min(q.troops, q.troops * 3 * l / Math.max(1, before.get(o)));
    }
    boom(nk.tx, nk.ty, R.outer, true);
  }
  function boom(x, y, r, big) { fx({ kind: 'boom', x, y, r, dur: big ? 1400 : 600, big: !!big }); }

  // ──────────── Diplomacy ────────────
  function atWar(a, b) { return a !== b && a > 0 && b > 0 && !!players[a] && players[a].wars.has(b); }
  function formAlliance(a, b) {
    if (atWar(a, b)) return;
    const until = tick + Math.round(ALLIANCE_TICKS * Math.max(players[a].m.allianceTime, players[b].m.allianceTime));
    players[a].allies.set(b, until); players[b].allies.set(a, until);
    allyVer++;
    for (const at of attacks.slice()) if ((at.p === a && at.target === b) || (at.p === b && at.target === a)) removeAttack(at, 1);
  }
  function breakAlliance(a, b, betray) {
    players[a].allies.delete(b); players[b].allies.delete(a);
    allyVer++;
    if (betray) {
      addHate(players[b], a, 8);
      moodDirty = true;
      if (players[a].m.traitorFree) return;   // nobody else holds it against them
      players[a].traitorUntil = tick + TRAITOR_TICKS;
      for (const q of players) if (q && q.type === 'nation' && q.id !== b && q.id !== a) addHate(q, a, 1);
    }
  }
  function addFavor(p, towards, v) {
    if (!p || p.type !== 'nation') return;
    if (v > 0) v *= players[towards].m.favorGain;
    p.favor.set(towards, within((p.favor.get(towards) || 0) + v, 0, 10));
    moodDirty = true;
  }
  // A gift worth a tenth of a nation's wealth earns about one point of goodwill
  function giftScale(p) { return Math.max(20000, (p.gold + p.troops * TROOP_GOLD) * 0.1); }

  // ── Opinions ──
  // How AI nation p feels about player q, as labelled modifiers. Everything used here is synced to
  // multiplayer clients, so the diplomacy screen shows the same numbers the server decides with.
  const q10 = v => Math.round((v || 0) * 10) / 10;   // the precision clients receive
  const hasBoatsOut = q => ships.some(s => s.kind === 'transport' && s.owner === q.id);
  const attackingNations = (q, except) => attacks.some(a => a.p === q.id && a.target && a.target !== except && players[a.target].type !== 'bot');
  const AGENDAS = {
    peace: (p, q) => q.wars.size || attackingNations(q, p.id) ? [['Disapproves of your wars', -4]] : [['Appreciates your peaceful ways', 2]],
    army: (p, q) => q.troops > p.troops * 1.1 ? [['Respects your mighty army', 3]] : q.troops < p.troops * 0.5 ? [['Scorns your weak army', -3]] : [],
    conquest: (p, q) => [q.kills > 0 && ['Admires your conquests', 2], q.tiles < p.tiles * 0.4 && ['Sees you as easy prey', -2]],
    navy: (p, q) => {
      const n = countUnits(q, 'port') + countUnits(q, 'warship');
      return n >= 2 ? [['Respects your navy', 2]] : n ? [] : [['Thinks you have no navy', -2]];
    },
    loyalty: (p, q) => q.traitorUntil > tick ? [['Despises traitors', -5]] : q.allies.size ? [['Values your loyalty to allies', 2]] : [],
    gold: (p, q) => q.gold > p.gold ? [['Impressed by your treasury', 2]] : q.gold < p.gold * 0.2 ? [['Thinks you are poor', -1]] : [],
    walls: (p, q) => [countUnits(q, 'defense') > 0 && ['Respects your defenses', 2], attacks.some(a => a.p === q.id && a.target === p.id) && ['You are attacking their land', -3]],
    land: (p, q) => q.tiles > p.tiles * 1.2 ? [['Envies your vast lands', -3]] : q.tiles < p.tiles * 0.8 ? [['Does not feel threatened by you', 1]] : [],
    industry: (p, q) => q.factories ? [['Admires your industry', 2]] : [],
    isolation: (p, q) => hasBoatsOut(q) ? [['Dislikes your boats on the sea', -2]] : [['Likes that you keep to yourself', 1]],
    opportunist: (p, q) => q.troops < p.troops * 0.6 ? [['Smells weakness', -2]] : q.troops > p.troops * 1.3 ? [['Respects your strength', 2]] : [],
    alliances: (p, q) => q.allies.size ? [['Admires your friendships', Math.min(3, q.allies.size)]] : [['Pities the friendless', -1]],
    trade: (p, q) => countUnits(q, 'port') ? [['Likes your trading ports', 1]] : [],
    cities: (p, q) => q.cityLevels >= Math.max(1, p.cityLevels) ? [['Admires your great cities', 2]] : q.cityLevels ? [] : [['Thinks you have no great cities', -1]],
    antinuke: (p, q) => q.nukes > 0 ? [['Horrified that you used nuclear weapons', -8]] : countUnits(q, 'silo') ? [['Hates your missile silos', -4]] : [['Glad you have no nuclear weapons', 2]],
    nuclear: (p, q) => countUnits(q, 'silo') ? [['Respects your nuclear arsenal', 3]] : [['Thinks you are weak without nukes', -1]],
    balance: (p, q) => largestNation() === q ? [['Fears the most powerful nation', -4]] : [['Values the balance of power', 1]],
  };
  function opinionMods(p, q) {
    if (!p || !q || p === q || p.type !== 'nation') return [];
    const L = leaderOf(p), T = traitsOf(p), mods = [];
    if (allied(p.id, q.id)) mods.push(['Allies', 4]);
    if (atWar(p.id, q.id)) mods.push(['At war', -10]);
    else for (const [id] of p.wars) if (q.wars.has(id)) { mods.push(['Fighting a common enemy', 3]); break; }
    const hate = q10(p.hate.get(q.id));
    if (hate >= 0.5) mods.push(['Attacks and insults', -Math.min(15, Math.round(hate * (0.6 + T.grudge * 0.8)))]);
    const fav = q10(p.favor.get(q.id));
    if (fav >= 0.5) mods.push(L && L.agenda === 'trade' ? ['Loves trading with you', Math.min(12, Math.round(fav * 2))] : ['Gifts and fair trades', Math.min(8, Math.round(fav))]);
    if (q.traitorUntil > tick && !(L && L.agenda === 'loyalty')) mods.push(['Betrayed an ally recently', -Math.round(2 + T.loyal * 3)]);
    if (L && AGENDAS[L.agenda]) for (const m of AGENDAS[L.agenda](p, q)) if (m) mods.push(m);
    if (q.m.opinion) mods.push([`Charmed by ${leaderOf(q) ? leaderOf(q).name : q.name}`, q.m.opinion]);
    return mods.filter(m => m[1]);
  }
  function opinion(p, q) { let s = 0; for (const m of opinionMods(p, q)) s += m[1]; return s; }

  // ── Verdicts ──
  // Each says whether an AI nation would agree, and why, without changing anything. The same
  // function makes the decision, so the diplomacy screen can predict the answer exactly.
  // ok: true / false, or null when a human player decides.
  function verdict(factors, need, yes, no) {
    factors = factors.filter(f => f[0] && f[1]);
    const score = factors.reduce((s, f) => s + f[1], 0);
    return { ok: score >= need, score, need, factors, reason: score >= need ? yes : no };
  }
  function allianceVerdict(q, p) {   // would q accept an alliance with p?
    if (allied(q.id, p.id)) return { ok: false, reason: 'Already allies' };
    if (atWar(q.id, p.id)) return { ok: false, reason: 'You are at war. Make peace first.' };
    if (isHuman(q)) return { ok: null, reason: `${q.name} will decide` };
    if (q.type === 'bot') return p.m.tribeAlly ? { ok: true, reason: 'Tribes always trust you' } : { ok: null, reason: 'Tribes accept about one request in seven' };
    const T = traitsOf(q);
    return verdict([
      ['Their opinion of you', opinion(q, p)],
      ['Difficulty', Math.round((D.acc - 0.7) * 20)],
      [T.loyal >= 0.5 ? 'Loyal by nature' : 'Distrustful by nature', Math.round((T.loyal - 0.5) * 4)],
      ['Their other alliances', -Math.round(q.allies.size * 1.5)],
      ['Your army is bigger', p.troops > q.troops ? 2 : 0],
    ], 0, 'Would accept an alliance', 'Would refuse an alliance');
  }
  function cleanDeal(d) { d = d || {}; return { gold: Math.max(0, Math.floor(+d.gold || 0)), troops: Math.max(0, Math.floor(+d.troops || 0)) }; }
  const dealEmpty = d => !d.gold && !d.troops;
  function dealText(d) { return [d.gold && fmt(d.gold) + ' gold', d.troops && fmt(d.troops) + ' troops'].filter(Boolean).join(' and ') || 'nothing'; }
  // What a deal is worth to p: warlike leaders value troops more, economic ones gold
  function dealValue(p, d) { const T = traitsOf(p); return d.gold * (0.8 + T.econ * 0.4) + d.troops * TROOP_GOLD * (0.8 + T.aggr * 0.4); }
  function tradeVerdict(q, p, give, get) {   // would q take `give` from p in return for `get`?
    if (dealEmpty(give) && dealEmpty(get)) return { ok: false, reason: 'Add gold or troops to the deal' };
    if (give.gold > p.gold || give.troops > p.troops) return { ok: false, reason: "You don't have that much" };
    if (get.gold > q.gold || get.troops > q.troops) return { ok: false, reason: `${q.name} doesn't have that much` };
    if (dealEmpty(get)) return { ok: true, gift: true, reason: 'A gift is always welcome' };
    if (isHuman(q)) return { ok: null, reason: `${q.name} will decide` };
    if (q.type === 'bot') return { ok: false, reason: 'Tribes only accept gifts' };
    if (atWar(q.id, p.id)) return { ok: false, reason: 'They will not trade with an enemy' };
    if (get.troops && q.troops - get.troops < maxTroops(q) * 0.25) return { ok: false, reason: 'They need those troops to defend themselves' };
    const T = traitsOf(q), op = within(opinion(q, p), -15, 15);
    let worth = dealValue(q, give) * (1 + op * 0.03);
    // Allies and friends will hand over a little for nothing
    if (allied(q.id, p.id) || op >= 6) worth += T.generous * 0.05 * (q.gold + q.troops * TROOP_GOLD);
    const need = dealValue(q, get) * (1.25 - T.generous * 0.35);
    if (worth >= need) return { ok: true, reason: worth > need * 1.3 ? 'A generous offer' : 'A fair deal' };
    const short = (need - worth) / ((0.8 + T.econ * 0.4) * (1 + op * 0.03));
    return { ok: false, short, reason: `They want about ${fmt(short)} more gold in value` };
  }
  // Reasons a joint war of a and b against e can't happen, or null
  function warBlocker(a, b, e) {
    if (!e || !e.alive || e === a || e === b) return 'Pick another nation to fight';
    if (!a.alive || !b.alive) return 'That nation is gone';
    if (allied(a.id, e.id)) return `${a.name} is allied with ${e.name}`;
    if (allied(b.id, e.id)) return `${b.name} is allied with ${e.name}`;
    if (atWar(a.id, b.id)) return `${a.name} and ${b.name} are at war`;
    if (resActive('ceasefire')) return "The World's Fair has called a ceasefire";
    return null;
  }
  function jointWarVerdict(q, p, e) {   // would q join p in a war on e?
    const err = warBlocker(q, p, e);
    if (err) return { ok: false, reason: err };
    if (isHuman(q)) return { ok: null, reason: `${q.name} will decide` };
    if (q.type === 'bot') return { ok: false, reason: 'Tribes do not join wars' };
    const T = traitsOf(q), L = leaderOf(q), opE = opinion(q, e), ratio = (p.troops + q.troops) / Math.max(1, e.troops);
    const near = touches(q, e.id, -1);
    return verdict([
      ['Their opinion of you', Math.round(opinion(q, p) * 0.5)],
      ['You are allies', allied(q.id, p.id) ? 4 : 0],
      [`Already at war with ${e.name}`, atWar(q.id, e.id) ? 6 : 0],
      [opE < 0 ? `Dislikes ${e.name}` : `Likes ${e.name}`, -Math.round(opE * 0.6)],
      [T.aggr >= 0.5 ? 'Warlike by nature' : 'Cautious by nature', Math.round((T.aggr - 0.5) * 8)],
      ['Prefers peace', L && L.agenda === 'peace' ? -3 : 0],
      [ratio >= 1.5 ? 'Together you are stronger' : `${e.name} is too strong`, ratio >= 1.5 ? 2 : ratio < 0.8 ? -4 : 0],
      [`Doesn't border ${e.name}`, near ? 0 : -2],
    ], 3, `Would join a war on ${e.name}`, `Won't join a war on ${e.name}`);
  }
  function peaceVerdict(q, p) {   // would q make peace with p?
    if (!atWar(q.id, p.id)) return { ok: false, reason: 'You are not at war' };
    if (isHuman(q)) return { ok: null, reason: `${q.name} will decide` };
    const w = q.wars.get(p.id), T = traitsOf(q);
    if (tick - w.start < PEACE_MIN_TICKS) return { ok: false, reason: `The war has only just begun. Ask again in ${Math.ceil((w.start + PEACE_MIN_TICKS - tick) / 10)}s` };
    return verdict([
      ['Their opinion of you', Math.round((opinion(q, p) + 10) * 0.5)],   // +10 leaves out the at-war penalty
      [p.troops > q.troops ? 'Your army is bigger' : 'Their army is bigger', p.troops > q.troops ? 3 : -2],
      [T.aggr < 0.5 ? 'Peaceful by nature' : 'Warlike by nature', Math.round((0.5 - T.aggr) * 8)],
      ['Their army is worn out', q.troops < maxTroops(q) * 0.3 ? 3 : 0],
      ['Tired of the long war', Math.min(4, Math.floor((tick - w.start) / 600))],
    ], 1, 'Would agree to peace', 'Wants to keep fighting');
  }

  // ── Acting on diplomacy ──
  function requestAlliance(p, q) {
    const key = p.id + ':' + q.id;
    if ((askCooldown.get(key) || 0) > tick) return `Wait before asking ${q.name} again`;
    if (atWar(p.id, q.id)) return `You are at war with ${q.name}. Make peace first.`;
    askCooldown.set(key, tick + 300);
    if (isHuman(q)) {
      pendingReq.set(key, tick + 200);
      ev(q.id, `${who(p)} requests an alliance`, 'info', { req: p.id, ttl: 20000 });
      ev(p.id, `Alliance request sent to <b>${esc(q.name)}</b>`, 'info');
      return null;
    }
    const ok = q.type === 'bot' ? p.m.tribeAlly || rand() < 0.15 : allianceVerdict(q, p).ok;
    if (ok) { formAlliance(p.id, q.id); ev(p.id, `${who(q)} accepted your alliance`, 'good'); }
    else ev(p.id, `${who(q)} declined your alliance`, 'info');
    return null;
  }
  function replyAlliance(p, fromId, yes) {
    const key = fromId + ':' + p.id, q = players[fromId];
    if (!pendingReq.has(key) || !q) return null;
    pendingReq.delete(key);
    if (!yes) {
      addHate(q, p.id, 1);
      if (isHuman(q)) ev(q.id, `<b>${esc(p.name)}</b> declined your alliance`, 'info');
      return null;
    }
    if (!q.alive || !p.alive || atWar(p.id, q.id)) return null;
    formAlliance(p.id, q.id);
    ev(p.id, `You are now allied with ${who(q)}`, 'good');
    if (isHuman(q)) ev(q.id, `<b>${esc(p.name)}</b> accepted your alliance`, 'good');
    return null;
  }
  function sendTroops(p, q, troops) {
    if (troops < 1) return;
    p.troops -= troops; q.troops += troops * p.m.giftTroops;
    addFavor(q, p.id, troops * TROOP_GOLD / giftScale(q));
    ev(p.id, `Sent ${fmt(troops)} troops to <b>${esc(q.name)}</b>`, 'good');
    if (isHuman(q)) ev(q.id, `<b>${esc(p.name)}</b> sent you ${fmt(troops)} troops`, 'good');
  }
  // a gives `give` to b, b gives `get` to a
  function executeTrade(a, b, give, get) {
    a.gold += get.gold - give.gold; a.troops += get.troops - give.troops;
    b.gold += give.gold - get.gold; b.troops += give.troops - get.troops;
    // Goodwill grows with how much the deal favoured each AI side, and shrinks if they were the generous one
    if (b.type === 'nation') addFavor(b, a.id, (dealValue(b, give) - dealValue(b, get)) / giftScale(b));
    if (a.type === 'nation') addFavor(a, b.id, (dealValue(a, get) - dealValue(a, give)) / giftScale(a));
  }
  function makeOffer(from, to, kind, data, html) {
    const id = offerSeq++;
    offers.set(id, Object.assign({ id, kind, from: from.id, to: to.id, until: tick + OFFER_TICKS }, data));
    ev(to.id, html, 'info', { offer: id, ttl: OFFER_TICKS * TICK_MS });
  }
  function cooldown(p, q, what, ticks) {
    const key = p.id + ':' + q.id + ':' + what;
    if ((askCooldown.get(key) || 0) > tick) return true;
    askCooldown.set(key, tick + ticks);
    return false;
  }
  function proposeTrade(p, q, give, get) {
    if (dealEmpty(give) && dealEmpty(get)) return 'Add gold or troops to the deal';
    if (give.gold > p.gold || give.troops > p.troops) return "You don't have that much";
    if (get.gold > q.gold || get.troops > q.troops) return `${q.name} doesn't have that much`;
    if (cooldown(p, q, 'trade', 20)) return 'Wait a moment before offering again';
    if (isHuman(q) && !dealEmpty(get)) {
      makeOffer(p, q, 'trade', { give, get }, `${who(p)} offers you ${dealText(give)} for ${dealText(get)}`);
      ev(p.id, `Trade offer sent to <b>${esc(q.name)}</b>`, 'info');
      return null;
    }
    const v = tradeVerdict(q, p, give, get);
    if (!v.ok) { ev(p.id, `${who(q)} declined: ${esc(v.reason)}`, 'info'); return null; }
    executeTrade(p, q, give, get);
    if (v.gift) {
      ev(p.id, `You gave ${who(q)} ${dealText(give)}`, 'good');
      if (isHuman(q)) ev(q.id, `<b>${esc(p.name)}</b> gave you ${dealText(give)}`, 'good');
    } else ev(p.id, `${who(q)} accepted: you gave ${dealText(give)} for ${dealText(get)}`, 'good');
    return null;
  }
  function declareWar(a, b) {
    const old = a.wars.get(b.id), w = { until: tick + WAR_TICKS, start: old ? old.start : tick };
    a.wars.set(b.id, w); b.wars.set(a.id, { ...w });
    warVer++;
    addHate(b, a.id, 4);
    moodDirty = true;
  }
  function endWar(a, b) { players[a].wars.delete(b); players[b].wars.delete(a); warVer++; }
  // Attacking a nation or player (not a tribe) needs a declared war. Tribes raid without one.
  const needsWar = (p, o) => !!o && p.type !== 'bot' && players[o].type !== 'bot' && !atWar(p.id, o);
  // Fighting keeps a war going; it ends WAR_TICKS after the last attack. Refreshed at most every 30 s.
  function refreshWar(a, b) {
    const w = a.wars.get(b.id);
    if (!w || w.until - tick > WAR_TICKS - 300) return;
    w.until = b.wars.get(a.id).until = tick + WAR_TICKS;
    warVer++;
  }
  function declareBlocker(p, q) {
    if (!q || !q.alive || q === p) return 'Pick another nation';
    if (allied(p.id, q.id)) return `${q.name} is your ally. Break the alliance first.`;
    if (resActive('ceasefire')) return "The World's Fair has called a ceasefire";
    return null;
  }
  // p declares war on q
  function declareOn(p, q) {
    if (atWar(p.id, q.id)) return null;
    const err = declareBlocker(p, q);
    if (err) return err;
    declareWar(p, q);
    ev(q.id, `&#9876;&#65039; ${who(p)} declared war on you!`, 'bad');
    ev(p.id, `&#9876;&#65039; You declared war on ${who(q)}`, 'warn');
    return null;
  }
  // Make sure p may attack owner o, declaring war if allowed. Computer nations always declare;
  // players declare when they confirmed it (declare = true).
  function ensureWar(p, o, declare) {
    if (!needsWar(p, o)) return null;
    if (!declare && p.type === 'human') return `You are not at war with ${players[o].name}`;
    return declareOn(p, players[o]);
  }
  function startJointWar(a, b, e) {
    declareWar(a, e); declareWar(b, e);
    ev(e.id, `&#9876;&#65039; ${who(a)} and ${who(b)} declared war on you!`, 'bad');
    ev(0, `&#9876;&#65039; ${who(a)} and ${who(b)} declared a joint war on ${who(e)}`, 'warn', { except: [e.id] });
  }
  function proposeJointWar(p, q, e) {
    if (q.type === 'bot') return 'Tribes do not join wars';
    const err = warBlocker(p, q, e);
    if (err) return err;
    if (cooldown(p, q, 'war', 100)) return `Wait before asking ${q.name} again`;
    if (isHuman(q)) {
      makeOffer(p, q, 'war', { enemy: e.id }, `${who(p)} proposes a joint war against ${who(e)}`);
      ev(p.id, `Joint war proposal sent to <b>${esc(q.name)}</b>`, 'info');
      return null;
    }
    const v = jointWarVerdict(q, p, e);
    if (!v.ok) { ev(p.id, `${who(q)} won't join a war on <b>${esc(e.name)}</b>`, 'info'); return null; }
    startJointWar(p, q, e);
    return null;
  }
  function makePeace(a, b) {
    endWar(a.id, b.id);
    a.peaceAt.set(b.id, tick); b.peaceAt.set(a.id, tick);
    for (const [x, y] of [[a, b], [b, a]]) if (x.m.treatyGold) { const g = goldRate(x) * x.m.treatyGold; x.gold += g; ev(x.id, `The peace treaty with ${who(y)} brought you ${fmt(g)} gold`, 'good'); }
    ev(a.id, `You made peace with ${who(b)}`, 'good');
    ev(b.id, `You made peace with ${who(a)}`, 'good');
    ev(0, `&#128330; ${who(a)} and ${who(b)} made peace`, 'info', { except: [a.id, b.id] });
  }
  function proposePeace(p, q) {
    if (!atWar(p.id, q.id)) return `You are not at war with ${q.name}`;
    if (cooldown(p, q, 'peace', 100)) return `Wait before asking ${q.name} again`;
    if (isHuman(q)) {
      makeOffer(p, q, 'peace', {}, `${who(p)} offers peace`);
      ev(p.id, `Peace offer sent to <b>${esc(q.name)}</b>`, 'info');
      return null;
    }
    const v = peaceVerdict(q, p);
    if (!v.ok) { ev(p.id, `${who(q)} refused peace: ${esc(v.reason)}`, 'info'); return null; }
    makePeace(p, q);
    return null;
  }
  function replyOffer(p, id, yes) {
    const o = offers.get(id);
    if (!o || o.to !== p.id) return null;
    offers.delete(id);
    const q = players[o.from];
    if (!q || !q.alive || !p.alive) return 'That offer is no longer valid';
    if (!yes) {
      addHate(q, p.id, o.demand ? 3 : 0.5);
      if (isHuman(q)) ev(q.id, `<b>${esc(p.name)}</b> declined your ${o.kind === 'war' ? 'joint war' : o.kind} offer`, 'info');
      if (o.demand) ev(p.id, `${who(q)} will remember this.`, 'warn');
      moodDirty = true;
      return null;
    }
    if (o.kind === 'trade') {
      if (o.give.gold > q.gold || o.give.troops > q.troops) return `${q.name} no longer has that much`;
      if (o.get.gold > p.gold || o.get.troops > p.troops) return "You don't have that much any more";
      executeTrade(q, p, o.give, o.get);
      ev(p.id, dealEmpty(o.give) ? `You paid ${who(q)} ${dealText(o.get)}` : `Trade done: you got ${dealText(o.give)} for ${dealText(o.get)}`, 'good');
      if (isHuman(q)) ev(q.id, `<b>${esc(p.name)}</b> accepted your trade`, 'good');
    } else if (o.kind === 'war') {
      const e = players[o.enemy], err = warBlocker(q, p, e);
      if (err) return err;
      startJointWar(q, p, e);
    } else if (o.kind === 'peace' && atWar(p.id, q.id)) makePeace(p, q);
    return null;
  }

  // ──────────── World's Fair ────────────
  // Nations meet to vote on resolutions: when the first missile silo is finished, and when half
  // and then a quarter of the nations are gone (Metternich can also call one). Every nation gets
  // one vote plus its leader's extra votes. Ballots are secret: only the totals are announced.
  const fair = { session: null, active: [], held: 0, last: -1e9, silo: false, half: false, quarter: false, start: 0 };
  let fairVer = 1;
  function resActive(id, target) {
    return fair.active.some(r => r.id === id && r.until > tick && (target === undefined || r.target === target));
  }
  function largestNation() {
    let best = null;
    for (const p of players) if (p && p.alive && p.type !== 'bot' && (!best || p.tiles > best.tiles)) best = p;
    return best;
  }
  // Resolutions on the ballot: the ones required plus random others, never one already in force
  function ballot(must, size) {
    const items = must.map(id => ({ id }));
    const pool = Object.keys(RESOLUTIONS).filter(id => !must.includes(id) && !resActive(id));
    while (items.length < size && pool.length) items.push({ id: pool.splice(rand() * pool.length | 0, 1)[0] });
    for (const it of items) if (RESOLUTIONS[it.id].target) { const t = largestNation(); it.target = t ? t.id : 0; }
    return items.filter(it => !RESOLUTIONS[it.id].target || it.target);
  }
  function conveneFair(why, must) {
    if (fair.session) return "The World's Fair is already in session";
    const items = ballot(must, 2);
    if (!items.length) return 'There is nothing left to vote on';
    fair.session = { n: ++fair.held, why, items, ends: tick + FAIR_VOTE_TICKS, votes: new Map() };
    fair.last = tick; fairVer++;
    for (const p of players) if (p && p.alive && p.type === 'nation') fair.session.votes.set(p.id, items.map(it => aiVote(p, it)));
    ev(0, `&#127963; The World's Fair convenes ${esc(why)}. Cast your votes!`, 'info', { ttl: 8000 });
    return null;
  }
  function voteFair(p, k, yes) {
    const s = fair.session;
    if (!s || !p.alive || p.type === 'bot' || !s.items[k]) return null;
    if (!s.votes.has(p.id)) s.votes.set(p.id, s.items.map(() => null));
    s.votes.get(p.id)[k] = yes;
    return null;
  }
  // How a computer leader votes
  function aiVote(p, it) {
    const L = leaderOf(p), T = traitsOf(p), stance = L && L.nukes, silos = countUnits(p, 'silo') > 0;
    switch (it.id) {
      case 'nonprolif': return stance === 'anti' ? true : stance === 'pro' || T.nuke >= 0.8 ? false : !silos;
      case 'atomic': return stance === 'pro' || T.nuke >= 0.8 ? true : stance === 'anti' ? false : silos;
      case 'freetrade': return p.ports > 0 || T.econ >= 0.7;
      case 'workers': return p.ports + p.factories > 0;
      case 'ceasefire': return T.aggr < 0.5 || [...p.wars].some(([id]) => players[id].troops > p.troops);
      case 'sanctions': {
        const t = players[it.target];
        if (t === p || allied(p.id, t.id)) return false;
        return opinion(p, t) < 0 || t.tiles > p.tiles * 1.5;
      }
    }
    return false;
  }
  function closeFair() {
    const s = fair.session;
    fair.session = null; fairVer++;
    s.items.forEach((it, k) => {
      let yes = 0, no = 0;
      for (const [pid, v] of s.votes) {
        const p = players[pid];
        if (!p.alive || v[k] == null) continue;
        if (v[k]) yes += 1 + p.m.votes; else no += 1 + p.m.votes;
      }
      const R = RESOLUTIONS[it.id], pass = yes > no, name = R.name + (it.target ? ` on ${players[it.target].name}` : '');
      ev(0, `&#127963; ${esc(name)} ${pass ? 'passed' : 'failed'}, ${yes} votes to ${no}`, pass ? 'good' : 'info', { ttl: 8000 });
      if (!pass) return;
      fair.active.push({ id: it.id, target: it.target || 0, until: tick + (R.dur || FAIR_TICKS) });
      if (it.id === 'ceasefire') for (const p of players) if (p) for (const [id] of [...p.wars]) { endWar(p.id, id); p.peaceAt.set(id, tick); }
    });
  }
  function fairTick() {
    const n = fair.active.length;
    fair.active = fair.active.filter(r => r.until > tick);
    if (fair.active.length !== n) fairVer++;
    if (fair.session) { if (tick >= fair.session.ends) closeFair(); return; }
    if (tick - fair.last < FAIR_GAP) return;
    if (!fair.silo && structs.some(s => s.alive && s.type === 'silo' && s.doneAt <= tick)) {
      fair.silo = true;
      conveneFair('as the first missile silo is completed', ['nonprolif']);
      return;
    }
    const alive = players.filter(p => p && p.alive && p.type !== 'bot').length;
    if (!fair.half && fair.start >= 4 && alive <= Math.ceil(fair.start / 2)) { fair.half = true; conveneFair('as half the nations of the world have fallen', []); return; }
    if (!fair.quarter && fair.start >= 8 && alive <= Math.ceil(fair.start / 4)) { fair.quarter = true; conveneFair('as only a few nations remain', []); }
  }

  // ──────────── Leader powers ────────────
  // Each leader's active power (frontier-leaders.js): temporary modifiers, an instant effect, or both.
  function powerOf(p) { const L = leaderOf(p); return L ? L.power : null; }
  function usePower(p) {
    const P = powerOf(p);
    if (!P || !p.alive || state !== 'play') return null;
    if (tick < p.powerReady) return `${P.name} is ready in ${Math.ceil((p.powerReady - tick) / 10)}s`;
    // An effect list like "finish,income:600" works if any part of it does, and a power with lasting
    // modifiers works even when its instant part has nothing to do
    const errs = P.fx ? P.fx.split(',').map(fx => powerFx(p, fx)) : [];
    if (errs.length && errs.every(Boolean) && !P.mods) return errs[0];
    p.powerReady = tick + Math.round(P.cd * (p.type === 'nation' ? D.powerCd : 1));
    if (P.dur) { p.powerUntil = tick + P.dur; refreshMods(p); }
    ev(p.id, `&#9889; <b>${esc(P.name)}</b>: ${esc(P.desc)}`, 'good', { ttl: 4000 });
    // Warn the players it may be aimed at: neighbours, and anyone at war with them.
    // A secret power stays vague until its leader's hidden agenda is out.
    const near = neighbors(p).players, desc = P.secret && !p.nukes ? '' : ': ' + esc(P.desc);
    for (const q of players) if (isHuman(q) && q !== p && q.alive && (near.has(q.id) || atWar(p.id, q.id)))
      ev(q.id, `&#9889; ${who(p)} used <b>${esc(P.name)}</b>${desc}`, 'warn', { ttl: 5000 });
    return null;
  }
  // One instant effect of a power, as "kind:amount". Returns why it can't be used, or null.
  function powerFx(p, fx) {
    const [kind, v] = fx.split(':'), n = +v;
    const ports = () => structs.filter(s => s.alive && s.type === 'port' && s.owner === p.id && s.doneAt <= tick && s.dock >= 0);
    switch (kind) {
      case 'troops': p.troops += maxTroops(p) * n; return null;
      case 'income': p.gold += goldRate(p) * n; return null;
      case 'freeNukes':
        if (!countUnits(p, 'silo')) return 'Build a missile silo first';
        p.freeNukes += n; return null;
      case 'warships': {
        const ps = ports().slice(0, n);
        if (!ps.length) return 'You need a finished port';
        for (const s of ps) addWarship(p, s.dock, s.dock);
        return null;
      }
      case 'trade': {
        const ps = ports();
        if (!ps.length) return 'You need a finished port';
        for (const s of ps) spawnTrade(s);
        return null;
      }
      case 'walls': {
        // Border land facing other nations or tribes, the strongest neighbour's first
        const buf = new Int32Array(4), opts = [];
        for (const t of p.border) {
          const c = nb4(t, buf);
          let w = 0;
          for (let i = 0; i < c; i++) { const o = owner[buf[i]]; if (o && o !== p.id && !allied(p.id, o)) w = Math.max(w, players[o].troops); }
          if (w) opts.push([t, w + rand() * w * 0.5]);
        }
        if (!opts.length) return 'You have no hostile border to fortify';
        opts.sort((a, b) => b[1] - a[1]);
        let built = 0;
        for (const [t] of opts) {
          if (built >= n) break;
          if (!placeError(p, 'defense', t)) { placeStruct(p, 'defense', t).doneAt = tick; built++; }
        }
        return built ? null : 'No room for defense posts on your border';
      }
      case 'flowerwar': {
        let got = 0;
        for (const [id] of neighbors(p).players) {
          const q = players[id];
          if (q.type !== 'bot') continue;
          const take = q.troops * n;
          q.troops -= take; got += take;
        }
        if (!got) return 'No tribes border you';
        p.troops += got;
        return null;
      }
      case 'allyTroops': {
        let got = 0;
        for (const [id] of p.allies) {
          const a = players[id];
          if (!a.alive) continue;
          const give = a.troops * n;
          a.troops -= give; got += give;
          if (isHuman(a)) ev(a.id, `${who(p)} called on the alliance: you sent ${fmt(give)} troops`, 'info');
        }
        if (!got) return 'You have no allies to call on';
        p.troops += got;
        return null;
      }
      case 'union': {
        let joined = 0;
        for (const [id] of neighbors(p).players) {
          const q = players[id];
          if (q.type !== 'nation' || allied(p.id, id) || atWar(p.id, id) || opinion(q, p) < 0) continue;
          formAlliance(p.id, id); joined++;
          ev(p.id, `${who(q)} joined your union`, 'good');
        }
        return joined ? null : 'No neighbour likes you enough to join';
      }
      case 'liberate': {
        let tribe = null;
        for (const [id] of neighbors(p).players) { const q = players[id]; if (q.type === 'bot' && (!tribe || q.tiles > tribe.tiles)) tribe = q; }
        if (!tribe) return 'No tribe borders you';
        for (let t = 0; t < N; t++) if (owner[t] === tribe.id) setOwner(t, p.id);
        p.troops += tribe.troops; tribe.troops = 0; tribe.lastHitBy = p.id;
        ev(p.id, `<b>${esc(tribe.name)}</b> joined your nation`, 'good');
        return null;
      }
      case 'peace': {
        if (!p.wars.size) return 'You are not at war';
        for (const [id] of [...p.wars]) {
          const q = players[id];
          endWar(p.id, id); q.hate.delete(p.id);
          if (isHuman(q)) ev(q.id, `${who(p)} ended the war with you`, 'good');
        }
        moodDirty = true;
        return null;
      }
      case 'finish': {
        let k = 0;
        for (const s of structs) {
          if (!s.alive || s.owner !== p.id) continue;
          if (s.doneAt > tick) { s.doneAt = tick; k++; }
          if ((s.type === 'silo' || s.type === 'sam') && s.readyAt > tick) { s.readyAt = tick; k++; }
        }
        if (!k) return 'Nothing to finish or reload';
        structVer++;
        return null;
      }
      case 'cityUp': {
        const cities = structs.filter(s => s.alive && s.type === 'city' && s.owner === p.id).slice(0, n);
        if (!cities.length) return 'Build a city first';
        for (const s of cities) s.level++;
        structVer++;
        return null;
      }
      case 'fair': return conveneFair(`at the call of ${leaderOf(p).name}`, []);
      case 'mirrors': {
        // Burning mirrors: sink every enemy ship within 12 tiles of your land
        let sunk = 0;
        for (const o of ships) {
          if (o.dead || !atWar(p.id, o.owner)) continue;
          const cx = o.x | 0, cy = o.y | 0;
          let near = false;
          for (let dy = -12; dy <= 12 && !near; dy++) for (let dx = -12; dx <= 12; dx++) {
            const x = cx + dx, y = cy + dy;
            if (x >= 0 && y >= 0 && x < W && y < H && owner[y * W + x] === p.id && dx * dx + dy * dy <= 144) { near = true; break; }
          }
          if (near) { o.dead = true; boom(o.x, o.y, 3); sunk++; }
        }
        return sunk ? null : 'No enemy ships near your coast';
      }
      case 'peaceTribute': {
        if (!p.wars.size) return 'You are not at war';
        for (const [id] of [...p.wars]) {
          const q = players[id], pay = Math.min(q.gold, goldRate(q) * n);
          q.gold -= pay; p.gold += pay;
          makePeace(p, q);
          if (isHuman(q)) ev(q.id, `The treaty with ${who(p)} cost you ${fmt(pay)} gold in tribute`, 'warn');
        }
        return null;
      }
      case 'mercs': {
        // 3 troops for every 2 gold, spending at most half the treasury
        const troops = Math.min(p.gold * 0.5 * 1.5, maxTroops(p) * 0.4);
        if (troops < 1000) return 'Not enough gold to hire anyone';
        p.gold -= troops / 1.5; p.troops += troops;
        return null;
      }
    }
    return null;
  }
  function aiPower(p, info) {
    const P = powerOf(p);
    if (!P || tick < p.powerReady || tick < immunityUntil || rand() > 0.3) return;
    let want = true;
    switch (P.ai) {
      case 'attack': want = attacks.some(a => a.p === p.id && a.target && players[a.target].type !== 'bot' && a.troops > p.troops * 0.1); break;
      case 'defend': want = p.wars.size > 0 || attacks.some(a => a.target === p.id && players[a.p].type !== 'bot' && a.troops > p.troops * 0.15); break;
      case 'build': want = p.gold > 300000; break;
      case 'naval': want = countUnits(p, 'port') > 0; break;
      case 'expand': want = info.neutral > 0 || [...info.players.keys()].some(id => players[id].type === 'bot'); break;
      case 'nuke': want = countUnits(p, 'silo') > 0; break;
    }
    if (want && usePower(p)) p.powerReady = tick + 100;   // it couldn't be used: try again later
  }

  // ──────────── AI ────────────
  // Nations play by their leader's personality (traitsOf): aggressive leaders attack sooner and
  // with more troops, seafarers send more boats and warships, builders favour factories, and a
  // leader who loves nukes builds silos whatever the difficulty.
  function aiTick(p) {
    const info = neighbors(p), max = maxTroops(p), imm = tick < immunityUntil, T = traitsOf(p);
    // Keep just enough civilians to fill the jobs in ports and factories
    p.share = within(1 - jobsOf(p) / Math.max(1, p.troops + p.civs), 0.6, 1);
    aiPower(p, info);
    aiBuild(p, info);
    aiDiplomacy(p, info);
    const ratio = D.ratio * (0.85 + 0.3 * T.aggr), maxBoats = (T.naval >= 0.7 ? 3 : 2) + p.m.boats;
    if (p.troops < max * Math.min(0.95, D.thr * (1.1 - 0.2 * T.aggr))) return;
    // Wars already declared come first
    if (!imm && p.wars.size) {
      for (const [id] of p.wars) if (info.players.has(id) && rand() < 0.7) { startAttack(p, id, p.troops * ratio * 1.1); return; }
      if (info.coastal && boatsOf(p) < maxBoats && rand() < 0.1 + T.naval * 0.3 && aiWarBoat(p)) return;
    }
    if (info.neutral > 0) {
      startAttack(p, 0, p.troops * D.ratio * (0.8 + 0.4 * T.expand));
      if (!info.players.size || rand() < 0.6) return;
    }
    if (!imm && info.players.size) {
      let best = null, bs = 1e9;
      for (const [id] of info.players) {
        if (allied(p.id, id) || !mayDeclare(p, id)) continue;
        const q = players[id];
        let s = q.troops / Math.max(1, p.troops);
        if (q.type === 'bot') s -= 0.6;
        else { const op = opinion(p, q); s += op > 0 ? op * 0.04 : op * 0.02; }   // spare friends, pick on rivals
        if (q.traitorUntil > tick) s -= 0.3;
        s -= Math.min(10, p.hate.get(id) || 0) * 0.05 * (0.5 + T.grudge);
        if (s < bs) { bs = s; best = q; }
      }
      if (best && bs < 0.9 * D.aggr * (0.8 + 0.4 * T.aggr) + (p.troops > max * 0.9 ? 0.5 : 0) && !ensureWar(p, best.id, true)) {
        startAttack(p, best.id, p.troops * ratio * (best.type === 'bot' ? 0.8 : 1.2));
        return;
      }
    }
    if (!info.neutral && info.coastal && boatsOf(p) < maxBoats && (!info.players.size || rand() < 0.15 + T.naval * 0.3)) aiBoat(p, imm);
  }
  // Land a boat on the coast of a nation p is at war with
  function aiWarBoat(p) {
    for (const [id] of p.wars) {
      const e = players[id], opts = [];
      if (!e.alive) continue;
      for (const t of e.border) if (coastal[t]) { opts.push(t); if (opts.length > 40) break; }
      if (opts.length && !sendBoat(p, opts[rand() * opts.length | 0], p.troops * D.ratio * 1.2, true)) return true;
    }
    return false;
  }
  function aiBoat(p, imm) {
    let pick = -1, pd = 1e18;
    for (let k = 0; k < 40; k++) {
      const t = rand() * N | 0;
      if (!coastal[t]) continue;
      const o = owner[t];
      if (o === p.id || allied(p.id, o) || (o && (imm || !mayDeclare(p, o)))) continue;
      if (o && players[o].troops > p.troops * D.aggr) continue;
      const d = (t % W - p.lx) ** 2 + (((t / W) | 0) - p.ly) ** 2 + (o ? 4000 : 0);
      if (d < pd) { pd = d; pick = t; }
    }
    if (pick >= 0) sendBoat(p, pick, p.troops * D.ratio, true);
  }
  // A computer nation can attack o: already at war, or free to declare (no ceasefire, no fresh truce)
  function mayDeclare(p, o) {
    if (!needsWar(p, o)) return true;
    return !resActive('ceasefire') && (p.peaceAt.get(o) || -1e9) < tick - TRUCE_TICKS;
  }
  function aiBuild(p, info) {
    if (rand() > 0.5) return;
    const g = p.gold, T = traitsOf(p), nukeLover = T.nuke >= 0.9;
    const ok = (type, t) => t >= 0 && g >= costOf(p, type) && !build(p, type, t);
    // A leader who loves nukes spends on them before anything else, and mostly saves up for them
    // once two cities (and a factory, for a builder) are standing
    if (nukeLover) {
      if (aiNukes(p, g, ok, true)) return;
      const invested = countUnits(p, 'city') >= 2 && (countUnits(p, 'factory') || T.econ < 0.85);
      if (tick > immunityUntil && invested && (!countUnits(p, 'silo') || g < costOf(p, 'atom')) && rand() < 0.7) return;
    }
    if (g >= costOf(p, 'city') && countUnits(p, 'city') < 2 + p.tiles / 700) {
      if (ok('city', findTile(p, t => distT[t] >= 3 && !placeError(p, 'city', t)))) return;
    }
    // Easier difficulties build fewer factories
    if (g >= costOf(p, 'factory') && countUnits(p, 'factory') < (D.factories ? 1 + p.tiles / 1200 : 0.5 + p.tiles / 4000) + T.econ * 0.5) {
      if (ok('factory', findTile(p, t => distT[t] >= 3 && !placeError(p, 'factory', t)))) return;
    }
    if (info.coastal && g >= costOf(p, 'port') && countUnits(p, 'port') < 1 + p.tiles / 1600 + T.naval) {
      const opts = [];
      for (const t of p.border) if (coastal[t] && !placeError(p, 'port', t)) { opts.push(t); if (opts.length > 30) break; }
      if (opts.length && ok('port', opts[rand() * opts.length | 0])) return;
    }
    if ((D.defense || T.defense >= 0.85) && tick > immunityUntil && g >= costOf(p, 'defense') && countUnits(p, 'defense') < (D.defense ? 1 : 0.5) * (1 + p.tiles / 450 * (0.5 + T.defense))) {
      let threat = 0, tt = 0;
      for (const [id] of info.players) { const q = players[id]; if (!allied(p.id, id) && q.type !== 'bot' && q.troops > tt) { tt = q.troops; threat = id; } }
      if (threat && (tt > p.troops * 0.7 || atWar(p.id, threat))) {
        const buf = new Int32Array(4); const opts = [];
        for (const t of p.border) {
          const c = nb4(t, buf);
          for (let i = 0; i < c; i++) if (owner[buf[i]] === threat) { opts.push(t); break; }
          if (opts.length > 40) break;
        }
        const t = opts.length ? opts[rand() * opts.length | 0] : -1;
        if (t >= 0 && !placeError(p, 'defense', t) && ok('defense', t)) return;
      }
    }
    if (!nukeLover && aiNukes(p, g, ok, false)) return;
    if (rand() < 0.3 + T.naval * 0.4 && g >= costOf(p, 'warship') && countUnits(p, 'warship') < countUnits(p, 'port') * (1 + T.naval)) {
      const port = structs.find(s => s.alive && s.type === 'port' && s.owner === p.id && s.doneAt <= tick);
      if (port) ok('warship', port.dock);
    }
    if (p.wars.size && rand() < 0.2 + T.naval * 0.4 && g >= costOf(p, 'cruiser') && countUnits(p, 'cruiser') < Math.max(1, countUnits(p, 'port'))) {
      const port = structs.find(s => s.alive && s.type === 'port' && s.owner === p.id && s.doneAt <= tick && enemyPort(p, s.dock));
      if (port && ok('cruiser', port.dock)) aiCruisers(p);
    }
    if (tick % 100 < D.every) aiCruisers(p);
  }
  // An enemy port a ship starting from `dock` can sail to
  function enemyPort(p, dock) {
    let best = null, bd = Infinity;
    for (const s of structs) {
      if (!s.alive || s.type !== 'port' || s.dock < 0 || !atWar(p.id, s.owner) || waterBody[s.dock] !== waterBody[dock]) continue;
      const d = (s.dock % W - dock % W) ** 2 + (((s.dock / W) | 0) - ((dock / W) | 0)) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  // Idle cruisers sail off to shell the nearest enemy port
  function aiCruisers(p) {
    for (const s of ships) {
      if (s.kind !== 'cruiser' || s.owner !== p.id || s.ordered) continue;
      const tgt = enemyPort(p, shipTile(s));
      if (tgt && (s.home !== tgt.dock)) orderShip(s, tgt.dock);
    }
  }
  // Silos, SAMs and nukes. A nuke lover builds up to three silos early and fires whenever it can pay.
  function aiNukes(p, g, ok, lover) {
    if (!(D.nukes || traitsOf(p).nuke >= 0.8) || tick < immunityUntil || p.tiles <= landTotal * (lover ? 0.01 : 0.05)) return false;
    const silos = countUnits(p, 'silo');
    const siloCost = costOf(p, 'silo'), atomCost = costOf(p, 'atom');
    if ((!silos || (lover && silos < 3 && g >= siloCost + atomCost)) && g >= siloCost) { if (ok('silo', findTile(p, t => distT[t] >= 4 && !placeError(p, 'silo', t)))) return true; }
    const enemySilo = structs.some(s => s.alive && s.type === 'silo' && s.owner !== p.id && !allied(s.owner, p.id));
    if (enemySilo && g >= costOf(p, 'sam') && countUnits(p, 'sam') < Math.min(3, countUnits(p, 'city'))) {
      const city = structs.find(s => s.alive && s.type === 'city' && s.owner === p.id);
      if (city) {
        const t = findTile(p, u => (u % W - city.x) ** 2 + (((u / W) | 0) - city.y) ** 2 < 100 && !placeError(p, 'sam', u), 300);
        if (ok('sam', t)) return true;
      }
    }
    if (silos && g >= (lover ? atomCost : 1e6) && rand() < (lover ? 0.9 : 0.35)) {
      let tgt = null, ts = 0;
      for (const q of players) {
        if (!q || !q.alive || q === p || q.type === 'bot' || allied(p.id, q.id) || !mayDeclare(p, q.id)) continue;
        const s = q.tiles * (1 + Math.min(10, p.hate.get(q.id) || 0) * 0.2) * (atWar(p.id, q.id) ? 3 : 1);
        if (s > ts) { ts = s; tgt = q; }
      }
      if (tgt && tgt.bestT >= 0) {
        const city = structs.find(s => s.alive && s.owner === tgt.id && s.type === 'city');
        if (ok(g >= 5.5e6 ? 'hydrogen' : 'atom', city ? city.t : tgt.bestT)) return true;
      }
    }
    return false;
  }
  function aiDiplomacy(p, info) {
    if (tick < immunityUntil) return;
    const T = traitsOf(p);
    // Offer an alliance to a neighbouring player the leader likes
    for (const [id] of info.players) {
      const h = players[id];
      if (!isHuman(h) || !h.alive || allied(p.id, id) || atWar(p.id, id)) continue;
      const key = p.id + ':' + id;
      if (pendingReq.has(key) || rand() >= 0.02) continue;
      if (opinion(p, h) < 0 || h.troops < p.troops * 0.6 || h.traitorUntil > tick) continue;
      pendingReq.set(key, tick + 200);
      ev(id, `${who(p)} requests an alliance`, 'info', { req: p.id, ttl: 20000 });
      return;
    }
    if (rand() < 0.01) {
      for (const [id] of info.players) {
        const q = players[id];
        if (q.type !== 'nation' || allied(p.id, id) || atWar(p.id, id) || p.allies.size >= 2 || q.allies.size >= 2) continue;
        if (opinion(p, q) < 1 || !allianceVerdict(q, p).ok) continue;
        formAlliance(p.id, id);
        ev(0, `&#129309; ${who(p)} and ${who(q)} formed an alliance`, 'info', { ttl: 4000 });
        break;
      }
    }
    // Rally an ally into a joint war against a neighbour the leader dislikes
    if (p.allies.size && rand() < 0.004 * (0.5 + T.aggr)) {
      let e = null, es = 0;
      for (const [id] of info.players) {
        const q = players[id];
        if (q.type === 'bot' || allied(p.id, id) || atWar(p.id, id)) continue;
        const s = -opinion(p, q) + (q.troops < p.troops ? 2 : 0);
        if (s > es) { es = s; e = q; }
      }
      if (e && es >= 3) for (const [aid] of p.allies) {
        const a = players[aid];
        if (warBlocker(p, a, e) || atWar(a.id, e.id)) continue;
        if (isHuman(a)) {
          if (cooldown(p, a, 'war', 600)) continue;
          makeOffer(p, a, 'war', { enemy: e.id }, `${who(p)} asks you to join a war against ${who(e)}`);
          break;
        }
        if (jointWarVerdict(a, p, e).ok) { startJointWar(p, a, e); break; }
      }
    }
    // Faithless leaders turn on weak allies
    if (T.loyal < 0.35 && rand() < 0.03 * (1 - T.loyal)) {
      for (const [aid] of p.allies) {
        const a = players[aid];
        if (!info.players.has(aid) || a.troops > p.troops * 0.35) continue;
        breakAlliance(p.id, aid, true);
        ev(aid, `&#128481; ${who(p)} betrayed your alliance!`, 'bad');
        if (!ensureWar(p, aid, true)) startAttack(p, aid, p.troops * D.ratio * 1.5);
        return;
      }
    }
    // Warlike leaders demand tribute from weaker neighbours
    if (T.aggr >= 0.7 && rand() < 0.003) {
      for (const [id] of info.players) {
        const h = players[id];
        if (!isHuman(h) || allied(p.id, id) || h.troops > p.troops * 0.6 || h.gold < 50000 || cooldown(p, h, 'demand', 1800)) continue;
        const want = cleanDeal({ gold: h.gold * 0.25 });
        makeOffer(p, h, 'trade', { give: cleanDeal(), get: want, demand: true },
          `${who(p)} demands ${fmt(want.gold)} gold from you. Refuse, and they will remember it.`);
        break;
      }
    }
    // Generous leaders send gifts to their allies
    if (T.generous >= 0.7 && p.gold > 300000 && rand() < 0.004 * T.generous) {
      const ids = [...p.allies.keys()].filter(id => players[id].alive);
      if (ids.length) {
        const a = players[ids[rand() * ids.length | 0]], gift = Math.floor(p.gold * 0.1);
        p.gold -= gift; a.gold += gift;
        addFavor(a, p.id, gift / giftScale(a));
        ev(a.id, `&#127873; ${who(p)} sent you a gift of ${fmt(gift)} gold`, 'good');
      }
    }
    // A losing war ends in peace talks
    for (const [id, w] of p.wars) {
      const e = players[id];
      if (tick - w.start < PEACE_MIN_TICKS || p.troops > e.troops * 0.6 || rand() > 0.05) continue;
      if (isHuman(e)) { if (!cooldown(p, e, 'peace', 600)) makeOffer(p, e, 'peace', {}, `${who(p)} asks for peace`); }
      else if (e.type === 'nation' && peaceVerdict(e, p).ok) makePeace(p, e);
      break;
    }
  }
  function botTick(p) {
    const max = maxTroops(p);
    if (p.troops < max * 0.35) return;
    const info = neighbors(p);
    if (info.neutral) { startAttack(p, 0, p.troops / 8); return; }
    if (tick >= immunityUntil && info.players.size && rand() < 0.25) {
      const ids = [...info.players.keys()].filter(id => !allied(p.id, id));
      if (!ids.length) return;
      const q = players[ids[rand() * ids.length | 0]];
      if (q.troops < p.troops * 1.5) startAttack(p, q.id, p.troops / 10);
    }
  }

  // ──────────── Spawning ────────────
  function canSpawn(t, minGap, self) {
    if (!(t >= 0 && t < N) || !terrain[t] || (owner[t] && owner[t] !== self) || landSizes[landBody[t]] < 60) return false;
    const x = t % W, y = (t / W) | 0;
    for (let dy = -minGap; dy <= minGap; dy++) for (let dx = -minGap; dx <= minGap; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const o = owner[yy * W + xx];
      if (o && o !== self) return false;
    }
    return true;
  }
  function claimSpawn(p, t, R) {
    R += p.m.spawnRadius;
    const cx = t % W, cy = (t / W) | 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || dx * dx + dy * dy > R * R + 1) continue;
      const u = y * W + x;
      if (terrain[u] && !owner[u]) setOwner(u, p.id);
    }
    p.spawned = true;
  }
  // On real maps a nation starts at its leader's capital, or the closest free land to it.
  function spawnAtHome(p) {
    const real = Maps.MAPS[cfg.map], L = leaderOf(p);
    if (!real || !L) return false;
    const c = lonLatTile(real, L.home[0], L.home[1]);
    if (c < 0) return false;
    const cx = c % W, cy = (c / W) | 0;
    for (let r = 0; r <= 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (canSpawn(y * W + x, 3, 0)) { claimSpawn(p, y * W + x, 3); return true; }
    }
    return false;
  }
  function spawnAIs() {
    const ais = players.filter(p => p && p.type !== 'human' && !spawnAtHome(p));
    let gap = Math.max(4, Math.floor(Math.sqrt(landTotal / Math.max(1, ais.length)) * 0.45));
    for (const p of ais) {
      let done = false;
      for (let round = 0; round < 6 && !done; round++) {
        for (let k = 0; k < 600; k++) {
          const t = rand() * N | 0;
          if (canSpawn(t, gap, 0)) { claimSpawn(p, t, p.type === 'bot' ? 2 : 3); done = true; break; }
        }
        if (!done) gap = Math.max(3, Math.floor(gap * 0.7));
      }
    }
  }
  function spawnHuman(p, t) {
    if (!canSpawn(t, 5, p.id)) return false;
    if (p.spawned) for (let u = 0; u < N; u++) if (owner[u] === p.id) setOwner(u, 0);
    claimSpawn(p, t, 3);
    computeLabels();
    return true;
  }

  // ──────────── Game loop ────────────
  function gameTick() {
    tick++;
    if (state === 'spawn') {
      spawnLeft--;
      if (spawnLeft <= 0) beginPlay();
      return;
    }
    for (const p of players) {
      if (!p || !p.alive) continue;
      if (p.powerOn && tick >= p.powerUntil) refreshMods(p);
      growPopulation(p);
      p.gold += goldRate(p);
    }
    for (const a of attacks.slice()) if (attacks.includes(a)) stepAttack(a);

    for (const s of ships) { s.px = s.x; s.py = s.y; }
    for (const s of ships) {
      if (s.dead) continue;
      if (!players[s.owner].alive) { s.dead = true; continue; }
      if (s.kind === 'warship') { stepWarship(s); continue; }
      if (s.kind === 'cruiser') { stepCruiser(s); continue; }
      if (followPath(s, s.speed)) {
        s.dead = true;
        if (s.kind === 'transport') landBoat(s);
        else if (s.dest.alive && players[s.dest.owner].alive) {
          const free = resActive('freetrade') ? 1.5 : 1;
          players[s.owner].gold += s.value * players[s.owner].m.tradeGold * free; players[s.dest.owner].gold += s.value * players[s.dest.owner].m.tradeGold * free;
        }
      }
    }
    ships = ships.filter(s => !s.dead);

    for (const nk of nukes.slice()) {
      if (nk.intercept >= 0 && tick >= nk.intercept) {
        const [x, y] = nukePos(nk, 0);
        boom(x, y, 3);
        if (nk.sam) fx({ kind: 'shot', x0: nk.sam.x + 0.5, y0: nk.sam.y + 0.5, x1: x, y1: y, dur: 400 });
        if (isHuman(players[nk.owner])) ev(nk.owner, 'Your nuke was shot down by a SAM', 'bad');
        if (nk.sam && isHuman(players[nk.sam.owner])) ev(nk.sam.owner, 'Your SAM shot down a nuke!', 'good');
        nukes.splice(nukes.indexOf(nk), 1);
      } else if (tick - nk.start >= nk.dur) {
        nukes.splice(nukes.indexOf(nk), 1);
        detonate(nk);
      }
    }

    for (const p of players) if (p) { p.cityLevels = 0; p.factories = 0; p.ports = 0; }
    for (const s of structs) {
      if (!s.alive) continue;
      if (s.type === 'city' && s.doneAt <= tick) players[s.owner].cityLevels += s.level;
      if (s.type === 'factory' && s.doneAt <= tick) players[s.owner].factories++;
      if (s.type === 'port' && s.doneAt <= tick) players[s.owner].ports++;
      if (s.type === 'port' && s.doneAt <= tick && tick >= s.nextTrade && s.dock >= 0) {
        s.nextTrade = tick + Math.round((100 + (rand() * 60 | 0)) / players[s.owner].m.tradeFreq);
        if (ships.length < 140) spawnTrade(s);
      }
    }

    for (const p of players) {
      if (!p || !p.alive || p.type === 'human') continue;
      if (p.type === 'bot') { if ((tick + p.aiPhase) % 15 === 0) botTick(p); }
      else if ((tick + p.aiPhase) % D.every === 0) aiTick(p);
    }

    if (tick % 10 === 0) {
      for (const p of players) {
        if (!p) continue;
        for (const [id, until] of p.allies) if (until <= tick && id > p.id) {
          breakAlliance(p.id, id, false);
          const q = players[id];
          if (isHuman(p)) ev(p.id, `Your alliance with <b>${esc(q.name)}</b> expired`, 'info');
          if (isHuman(q)) ev(q.id, `Your alliance with <b>${esc(p.name)}</b> expired`, 'info');
          // A nation that still likes its human ally offers to renew
          for (const [a, b] of [[p, q], [q, p]]) {
            if (a.type !== 'nation' || !isHuman(b) || !a.alive || !b.alive || opinion(a, b) < 4) continue;
            pendingReq.set(a.id + ':' + b.id, tick + 200);
            ev(b.id, `${who(a)} would like to renew your alliance`, 'info', { req: a.id, ttl: 20000 });
          }
        }
        for (const [id, w] of p.wars) if (w.until <= tick && id > p.id) {
          endWar(p.id, id);
          const q = players[id];
          if (isHuman(p)) ev(p.id, `Your war with ${who(q)} has ended`, 'info');
          if (isHuman(q)) ev(q.id, `Your war with ${who(p)} has ended`, 'info');
        }
        // Grudges fade, slower for leaders who hold them
        const fade = 0.995 + traitsOf(p).grudge * 0.004;
        for (const [id, v] of p.hate) if (v < 0.05) p.hate.delete(id); else p.hate.set(id, v * fade);
        for (const [id, v] of p.favor) if (v < 0.05) p.favor.delete(id); else p.favor.set(id, v * 0.997);
      }
      for (const [k, until] of pendingReq) if (until <= tick) pendingReq.delete(k);
      for (const [id, o] of offers) if (o.until <= tick) offers.delete(id);
    }
    if (tick % 20 === 0) computeLabels();
    if (tick % 50 === 0) sweepFallout();
    if (tick % 10 === 0) fairTick();
    checkElims();
  }
  function sweepFallout() {
    for (let i = falloutList.length - 1; i >= 0; i--) {
      const t = falloutList[i];
      if (falloutUntil[t] <= tick) { hooks.tile(t); falloutList[i] = falloutList[falloutList.length - 1]; falloutList.pop(); }
    }
  }
  function beginPlay() {
    for (const p of players) {
      if (!p || p.spawned || p.type !== 'human') continue;
      for (let k = 0; k < 5000 && !p.spawned; k++) spawnHuman(p, rand() * N | 0);
      if (p.spawned) ev(p.id, 'You were placed at a random spot', 'info');
    }
    for (const p of players) if (p && !p.spawned) p.alive = false;
    state = 'play';
    immunityUntil = tick + IMMUNITY_TICKS;
    // AI nations on easier difficulties also wait longer for their first power
    for (const p of players) if (p) p.powerReady = immunityUntil + (p.type === 'nation' && leaderOf(p) ? Math.round(leaderOf(p).power.cd * (D.powerCd - 1) * 0.5) : 0);
    fair.start = players.filter(p => p && p.alive && p.type !== 'bot').length;
    // Leaders who start with a free, finished port (Victoria)
    for (const p of players) {
      if (!p || !p.alive || !p.m.freePort) continue;
      for (const t of p.border) if (coastal[t] && !placeError(p, 'port', t)) { placeStruct(p, 'port', t).doneAt = tick; break; }
    }
    computeLabels();
    ev(0, 'The game has begun! Spawn protection lasts 30 seconds.', 'info');
  }
  function checkElims() {
    for (const p of players) {
      if (!p || !p.alive || !p.spawned || p.tiles > 0) continue;
      p.alive = false;
      for (const a of attacks.slice()) {
        if (a.p === p.id) removeAttack(a, 0);
        else if (a.target === p.id) removeAttack(a, 1);
      }
      for (const s of ships) if (s.owner === p.id) s.dead = true;
      for (const [id] of p.allies) breakAlliance(p.id, id, false);
      for (const [id] of p.wars) endWar(p.id, id);
      for (const [id, o] of offers) if (o.from === p.id || o.to === p.id || o.enemy === p.id) offers.delete(id);
      const killer = players[p.lastHitBy];
      if (killer && killer.alive) { killer.gold += p.gold; killer.troops += maxTroops(killer) * killer.m.killTroops; }
      p.gold = 0; p.civs = 0; p.powerUntil = 0; refreshMods(p);
      if (killer) killer.kills++;
      const msg = `<b>${esc(p.name)}</b> was eliminated${killer ? ' by <b>' + esc(killer.name) + '</b>' : ''}`;
      if (p.type !== 'bot') ev(0, msg, isHuman(p) ? 'bad' : 'warn');
      else if (isHuman(killer)) ev(killer.id, msg, 'warn');
    }
    if (tick % 10 || ended) return;
    const alive = players.filter(p => p && p.alive);
    for (const p of alive) {
      if (p.tiles >= landTotal * WIN_SHARE) { ended = true; winner = p.id; hooks.end(p.id); return; }
    }
  }

  // ──────────── Player intents (same for singleplayer and server) ────────────
  function attackTile(p, t, r, declare) {
    if (!terrain[t]) return null;
    const o = owner[t];
    if (o === p.id) return null;
    if (o && allied(p.id, o)) return `${players[o].name} is your ally`;
    if (o && tick < immunityUntil) return `Spawn protection: ${Math.ceil((immunityUntil - tick) / 10)}s left`;
    const troops = p.troops * r;
    if (troops < 1) return 'Not enough troops';
    const werr = ensureWar(p, o, declare);
    if (werr) return werr;
    if (touches(p, o, o ? -1 : landBody[t])) { startAttack(p, o, troops); return null; }
    if (coastal[t]) return sendBoat(p, t, troops, declare);
    return 'You need to border that land, or click its coast to send a boat';
  }
  function act(pid, i) {
    const p = players[pid];
    if (!p || mirror || !i || typeof i.a !== 'string') return null;
    const t = i.t | 0, target = i.target | 0;
    if (i.a === 'spawn') {
      if (state !== 'spawn' || p.type !== 'human') return null;
      return spawnHuman(p, t) ? null : "You can't spawn there. Pick open land away from other nations.";
    }
    if (i.a === 'startNow') { if (state === 'spawn' && opt.allowStartNow && p.spawned) spawnLeft = 1; return null; }
    if (i.a === 'share') { if (p.type === 'human') p.share = within(+i.v || DEFAULT_SHARE, 0.1, 1); return null; }
    if (state !== 'play' || !p.alive || ended && winner) return null;
    const r = within(+i.r || 0.2, 0.01, 1);
    const q = players[target];
    switch (i.a) {
      case 'click': return t >= 0 && t < N ? attackTile(p, t, r, !!i.declare) : null;
      case 'boat': return t >= 0 && t < N ? sendBoat(p, t, p.troops * r, !!i.declare) : null;
      case 'build': return build(p, String(i.k), t, !!i.declare);
      case 'declare': return q && q.type !== 'bot' ? declareOn(p, q) : null;
      case 'vote': return voteFair(p, i.k | 0, i.yes == null ? null : !!i.yes);
      case 'move': {
        const s = ships.find(x => x.id === (i.id | 0) && (x.kind === 'warship' || x.kind === 'cruiser') && x.owner === pid && !x.dead);
        return s ? orderShip(s, t) : null;
      }
      case 'retreat': {
        const a = attacks.find(a => a.p === pid && a.target === target);
        if (a) { removeAttack(a, 0.75); ev(pid, 'Troops retreated', 'info', { ttl: 2000 }); }
        return null;
      }
      case 'ally': return q && q.alive && q !== p && !allied(pid, target) ? requestAlliance(p, q) : null;
      case 'allyReply': return replyAlliance(p, i.from | 0, !!i.yes);
      case 'break':
        if (!allied(pid, target)) return null;
        breakAlliance(pid, target, true);
        ev(pid, `You betrayed <b>${esc(q.name)}</b>. Others will trust you less.`, 'bad');
        if (isHuman(q)) ev(target, `<b>${esc(p.name)}</b> betrayed your alliance!`, 'bad');
        return null;
      case 'donate': if (q && allied(pid, target)) sendTroops(p, q, p.troops * r); return null;
      case 'trade': return q && q.alive && q !== p ? proposeTrade(p, q, cleanDeal(i.give), cleanDeal(i.get)) : null;
      case 'jointWar': return q && q.alive && q !== p ? proposeJointWar(p, q, players[i.enemy | 0]) : null;
      case 'peace': return q && q.alive && q !== p ? proposePeace(p, q) : null;
      case 'offerReply': return replyOffer(p, i.id | 0, !!i.yes);
      case 'power': return usePower(p);
    }
    return null;
  }

  // ──────────── Network sync ────────────
  // Server side: delta() is sent every tick; full() to a player who (re)connects mid-game.
  const r1 = v => Math.round(v * 10) / 10;
  function snapshotCommon(force) {
    const m = {
      k: tick, st: state, sl: spawnLeft, im: immunityUntil,
      p: players.map(p => p ? [Math.floor(p.troops), Math.floor(p.gold), p.tiles, p.alive ? 1 : 0, p.traitorUntil, p.cityLevels, p.spawned ? 1 : 0,
        Math.floor(p.civs), Math.round(p.share * 100), p.factories, p.kills, p.powerReady, p.powerUntil, p.freeNukes, p.nukes, p.ports] : null),
      sh: ships.map(s => [s.id, SHIP_KINDS.indexOf(s.kind), s.owner, r1(s.x), r1(s.y), r1(s.ang), Math.floor(s.troops || 0)]),
      n: nukes.map(n => [n.owner, n.type === 'atom' ? 0 : 1, n.x0, n.y0, n.tx, n.ty, n.t, n.start, n.dur, n.intercept]),
      a: attacks.map(a => [a.p, a.target, Math.floor(a.troops)]),
    };
    if (force || structVer !== lastStructVer) {
      lastStructVer = structVer;
      m.s = structs.filter(s => s.alive).map(s => [s.id, STRUCT_TYPES.indexOf(s.type), s.owner, s.t, s.level, s.doneAt, s.readyAt, s.dock]);
    }
    if (force || allyVer !== lastAllyVer) {
      lastAllyVer = allyVer;
      m.al = players.map(p => p ? [...p.allies] : null);
    }
    if (force || fairVer !== lastFairVer) {
      lastFairVer = fairVer;
      const se = fair.session;
      m.fair = { s: se && { n: se.n, why: se.why, items: se.items, ends: se.ends }, a: fair.active };
    }
    if (force || warVer !== lastWarVer) {
      lastWarVer = warVer;
      m.w = players.map(p => p ? [...p.wars].map(([id, w]) => [id, w.until, w.start]) : null);
    }
    // Nations' grudges and goodwill (x10), so clients can show leaders' opinions: [nation, towards, hate, favor, ...]
    if (force || moodDirty || tick % 10 === 0) {
      moodDirty = false;
      m.hf = [];
      for (const p of players) {
        if (!p || p.type !== 'nation' || !p.alive) continue;
        for (const id of new Set([...p.hate.keys(), ...p.favor.keys()])) {
          const h = Math.round((p.hate.get(id) || 0) * 10), f = Math.round((p.favor.get(id) || 0) * 10);
          if (h || f) m.hf.push(p.id, id, h, f);
        }
      }
    }
    return m;
  }
  let lastStructVer = 0, lastAllyVer = 0, lastWarVer = 0, lastFairVer = 0;
  function delta() {
    const m = snapshotCommon(false);
    if (tileBuf.length) m.o = tileBuf;
    if (falloutBuf.length) m.f = falloutBuf;
    if (fxBuf.length) m.fx = fxBuf;
    tileBuf = []; falloutBuf = []; fxBuf = [];
    return m;
  }
  function full() {
    const m = snapshotCommon(true);
    lastStructVer = 0; lastAllyVer = 0; lastWarVer = 0; lastFairVer = 0;   // make the next delta resend, so everyone stays in sync
    const runs = [];
    let cur = owner[0], len = 0;
    for (let t = 0; t < N; t++) {
      if (owner[t] === cur) len++;
      else { runs.push(cur, len); cur = owner[t]; len = 1; }
    }
    runs.push(cur, len);
    m.full = runs;
    m.f = [];
    for (const t of falloutList) if (falloutUntil[t] > tick) m.f.push(t, falloutUntil[t]);
    return m;
  }
  function startInfo() {
    return { cfg, players: players.map(p => p ? { id: p.id, name: p.name, type: p.type, color: p.color, leader: p.leader } : null), landTotal };
  }

  // Client side (mirror): apply a server message.
  function apply(m) {
    if (m.full) {
      let t = 0;
      for (let i = 0; i < m.full.length; i += 2) {
        const o = m.full[i], end = t + m.full[i + 1];
        for (; t < end; t++) owner[t] = o;
      }
      for (const p of players) if (p) { p.border.clear(); p.tiles = 0; p.terr = [0, 0, 0, 0]; p.coast = 0; }
      for (let u = 0; u < N; u++) {
        const o = owner[u];
        if (o) { const p = players[o]; p.tiles++; p.terr[terrain[u]]++; p.coast += coastal[u]; if (isBorderTile(u)) p.border.add(u); }
        hooks.tile(u);
      }
    }
    tick = m.k; state = m.st; spawnLeft = m.sl; immunityUntil = m.im;
    if (m.o) for (let i = 0; i < m.o.length; i += 2) setOwner(m.o[i], m.o[i + 1]);
    if (m.f) for (let i = 0; i < m.f.length; i += 2) {
      const t = m.f[i];
      falloutUntil[t] = m.f[i + 1]; falloutList.push(t); hooks.tile(t);
    }
    m.p.forEach((d, id) => {
      const p = players[id];
      if (!p || !d) return;
      [p.troops, p.gold, p.tiles, p.alive, p.traitorUntil, p.cityLevels, p.spawned] = d;
      p.alive = !!p.alive; p.spawned = !!p.spawned;
      p.civs = d[7] || 0; p.share = d[8] == null ? 1 : d[8] / 100; p.factories = d[9] || 0; p.kills = d[10] || 0;
      p.powerReady = d[11] || 0; p.powerUntil = d[12] || 0; p.freeNukes = d[13] || 0; p.nukes = d[14] || 0; p.ports = d[15] || 0;
      if ((p.powerUntil > tick) !== p.powerOn) refreshMods(p);
    });
    if (m.al) m.al.forEach((list, id) => { if (players[id] && list) players[id].allies = new Map(list); });
    if (m.fair) { fair.session = m.fair.s; fair.active = m.fair.a; }
    if (m.w) m.w.forEach((list, id) => { if (players[id] && list) players[id].wars = new Map(list.map(([e, until, start]) => [e, { until, start }])); });
    if (m.hf) {
      for (const p of players) if (p && p.type === 'nation') { p.hate.clear(); p.favor.clear(); }
      for (let i = 0; i < m.hf.length; i += 4) {
        const p = players[m.hf[i]];
        if (!p) continue;
        if (m.hf[i + 2]) p.hate.set(m.hf[i + 1], m.hf[i + 2] / 10);
        if (m.hf[i + 3]) p.favor.set(m.hf[i + 1], m.hf[i + 3] / 10);
      }
    }
    if (m.s) {
      structAt.fill(-1);
      structs = [];
      for (const [id, ti, o, t, level, doneAt, readyAt, dock] of m.s) {
        structAt[t] = structs.length;
        structs.push({ id, type: STRUCT_TYPES[ti], owner: o, t, x: t % W, y: (t / W) | 0, level, doneAt, readyAt, dock, alive: true });
      }
    }
    const prev = new Map(ships.map(s => [s.id, s]));
    ships = m.sh.map(([id, ki, o, x, y, ang, troops]) => {
      const old = prev.get(id);
      return { id, kind: SHIP_KINDS[ki], owner: o, x, y, ang, troops, px: old ? old.x : x, py: old ? old.y : y };
    });
    nukes = m.n.map(([o, ty, x0, y0, tx, ty2, t, start, dur, intercept]) => ({ owner: o, type: ty ? 'hydrogen' : 'atom', x0, y0, tx, ty: ty2, t, start, dur, intercept }));
    attacks = m.a.map(([p, target, troops]) => ({ p, target, troops }));
    if (m.fx) for (const e of m.fx) hooks.effect(e);
    if (m.full || tick % 20 === 0) computeLabels();
    if (tick % 50 === 0) sweepFallout();
  }

  // ──────────── Setup ────────────
  genMap();
  if (mirror) {
    for (const p of opt.players) if (p) makePlayer(p.name, p.type, p.color, p.id, p.leader);
  } else {
    const humans = opt.humans || [];
    humans.forEach((h, i) => makePlayer(String(h.name || 'Player').slice(0, 16), 'human', HUMAN_COLORS[i % HUMAN_COLORS.length], 0, h.leader));
    // Nations get the leaders nobody picked. On a real map, leaders whose capital is on it go first.
    const taken = new Set(humans.map(h => h.leader));
    let pool = LEADERS.map((_, i) => i).filter(i => !taken.has(i));
    for (let i = pool.length - 1; i > 0; i--) { const j = rand() * (i + 1) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const real = Maps.MAPS[cfg.map];
    if (real) {
      const onMap = i => LEADERS[i].home[0] >= real.lon[0] && LEADERS[i].home[0] <= real.lon[1] && LEADERS[i].home[1] <= real.lat[0] && LEADERS[i].home[1] >= real.lat[1];
      // Spread the nations out: each next leader is one whose capital is far from those already picked
      const left = pool.filter(onMap), spread = left.splice(0, 1);
      while (left.length) {
        let bi = 0, bs = -1;
        left.forEach((c, k) => {
          let md = Infinity;
          for (const s of spread) { const dx = LEADERS[c].home[0] - LEADERS[s].home[0], dy = LEADERS[c].home[1] - LEADERS[s].home[1]; md = Math.min(md, dx * dx + dy * dy); }
          const sc = md * (0.6 + rand() * 0.8);
          if (sc > bs) { bs = sc; bi = k; }
        });
        spread.push(left.splice(bi, 1)[0]);
      }
      pool = spread.concat(pool.filter(i => !onMap(i)));
    }
    // A custom lineup picks each nation's leader (repeats allowed, -1 = random); otherwise all random
    const lineup = Array.isArray(cfg.lineup) && cfg.lineup.length ? cfg.lineup.slice(0, MAX_NATIONS) : null;
    const count = lineup ? lineup.length : Math.min(MAX_NATIONS, cfg.nations | 0);
    const seen = {};
    for (const h of players) if (h) seen[h.name] = 1;
    let next = 0;
    for (let i = 0; i < count; i++) {
      let hue = (i * 137.508 + 20) % 360;
      if (hue > 195 && hue < 240) hue = (hue + 60) % 360;
      const L = lineup && LEADERS[lineup[i]] ? lineup[i] : pool[next++ % pool.length], civ = LEADERS[L].civ;
      makePlayer(numbered(civ, seen[civ] || 0), 'nation', hsl2rgb(hue, 62, 52), 0, L);
      seen[civ] = (seen[civ] || 0) + 1;
    }
    for (let i = 0; i < (cfg.bots | 0); i++) makePlayer(botName(), 'bot', hsl2rgb(rand() * 360, 18 + rand() * 14, 40 + rand() * 16));
    spawnAIs();
    computeLabels();
  }
  for (let t = 0; t < N; t++) hooks.tile(t);

  return {
    get W() { return W; }, get H() { return H; }, get N() { return N; },
    get terrain() { return terrain; }, get owner() { return owner; }, get baseCol() { return baseCol; },
    get coastal() { return coastal; }, get falloutUntil() { return falloutUntil; }, get landBody() { return landBody; },
    get landTotal() { return landTotal; }, get players() { return players; }, get attacks() { return attacks; },
    get ships() { return ships; }, get nukes() { return nukes; }, get structs() { return structs; }, get structAt() { return structAt; },
    get tick() { return tick; }, get state() { return state; }, get spawnLeft() { return spawnLeft; },
    get immunityUntil() { return immunityUntil; }, get ended() { return ended; }, get winner() { return winner; },
    cfg, D,
    step: gameTick, act, delta, full, startInfo, apply,
    maxTroops, troopRate, goldRate, costOf, placeError, hasDefensePost, allied, nukePos, civGold: workerGold, jobsOf, workersOf,
    atWar, countUnits, traitsOf, leaderOf, opinionMods, opinion, touches, resActive, needsWar, declareBlocker,
    get fair() { return fair; },
    allianceVerdict, tradeVerdict: (q, p, give, get) => tradeVerdict(q, p, cleanDeal(give), cleanDeal(get)), jointWarVerdict, peaceVerdict,
  };
}

const api = {
  createGame, fmt, esc, within, TICK_MS, SPAWN_TICKS, IMMUNITY_TICKS, WIN_SHARE, DEFENSE_RANGE, SAM_RANGE,
  NUKE, TERR, DIFF, BUILD, BUILD_ORDER, MAP_SIZES, MAP_NAMES, MAP_KINDS, DEFAULT_SHARE, LEADERS, STYLES, attitude, ALLIANCE_TICKS, WAR_TICKS, MAX_NATIONS,
  RESOLUTIONS, CANNON_RANGE, CRUISER_RANGE,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.FrontierCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

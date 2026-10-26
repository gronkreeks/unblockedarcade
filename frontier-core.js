// Frontier game rules, shared by the browser (singleplayer + multiplayer view) and the
// Node multiplayer server. Troop growth, troop cap, attack loss/speed and building costs
// follow OpenFront's open-source engine (packages/engine & engine-lib), scaled for a smaller map.
(function (root) {
'use strict';

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
const WIN_SHARE = 0.8;
const CITY_TROOPS = 250000;
// OpenFront maps have roughly 10x more land tiles. Each tile here stands in for several
// OpenFront tiles so troop density, and so the attacker/defender balance, stays similar.
const TILE_SCALE = 4;
const FRONT_SLOWDOWN = Math.sqrt(TILE_SCALE);   // fronts advance in tiles, so scale by the side length
const DEFENSE_RANGE = 10;
const SAM_RANGE = 24;
const MAX_BOATS = 3;
const NUKE = { atom: { inner: 7, outer: 12 }, hydrogen: { inner: 16, outer: 26 } };
// terrainAttackBase() in OpenFront
const TERR = [null, { mag: 80, cost: 16.5, name: 'Plains' }, { mag: 100, cost: 20, name: 'Highland' }, { mag: 120, cost: 25, name: 'Mountains' }];
const MAP_SIZES = { small: [320, 200], medium: [440, 272], large: [560, 344] };

const DIFF = {
  easy:       { start: 12500, grow: 0.9,  thr: 0.65, ratio: 0.2,  acc: 0.75, defense: false, nukes: false, every: 14, aggr: 0.55 },
  medium:     { start: 18750, grow: 0.95, thr: 0.55, ratio: 0.25, acc: 0.55, defense: true,  nukes: false, every: 10, aggr: 0.8 },
  hard:       { start: 25000, grow: 1,    thr: 0.45, ratio: 0.3,  acc: 0.35, defense: true,  nukes: true,  every: 8,  aggr: 1.0 },
  impossible: { start: 31250, grow: 1.1,  thr: 0.35, ratio: 0.35, acc: 0.2,  defense: true,  nukes: true,  every: 6,  aggr: 1.3 },
};

const BUILD = {
  city:     { name: 'City',      key: '1', time: 50,  tip: '+250K troop cap' },
  port:     { name: 'Port',      key: '2', time: 50,  tip: 'Trade ships earn gold. Must be on the coast.' },
  defense:  { name: 'Defense',   key: '3', time: 40,  tip: 'Land within 10 tiles is 5× harder to take' },
  silo:     { name: 'Silo',      key: '4', time: 100, tip: 'Launches nukes' },
  sam:      { name: 'SAM',       key: '5', time: 80,  tip: 'Shoots down nukes aimed within 24 tiles' },
  warship:  { name: 'Warship',   key: '6', time: 0,   tip: 'Click water near your port. Sinks enemy boats.' },
  atom:     { name: 'Atom Bomb', key: '7', time: 0,   tip: 'Small blast. Needs a ready silo.' },
  hydrogen: { name: 'H-Bomb',    key: '8', time: 0,   tip: 'Huge blast. Needs a ready silo.' },
};
const BUILD_ORDER = ['city', 'port', 'defense', 'silo', 'sam', 'warship', 'atom', 'hydrogen'];
const SHIP_KINDS = ['transport', 'trade', 'warship'];
const STRUCT_TYPES = ['city', 'port', 'defense', 'silo', 'sam'];

const NATION_NAMES = ['Aurelia', 'Borovia', 'Caldora', 'Drakmar', 'Elyria', 'Fenmark', 'Galdor', 'Halvard', 'Istria', 'Jorvik', 'Kaldera',
  'Lumina', 'Morvath', 'Norland', 'Ostara', 'Pyrrha', 'Quorin', 'Rhovan', 'Sylvara', 'Tarsis', 'Umbra', 'Valtor', 'Westmark', 'Xandria',
  'Ysolde', 'Zephyra', 'Arkos', 'Brennic', 'Corvina', 'Dunmere'];
const SYL = ['ka', 'ro', 'th', 'ul', 'mi', 'zan', 'ok', 'ra', 'en', 'dor', 'vi', 'ash', 'ur', 'tek', 'mo', 'lia', 'gar', 'is', 'bo', 'nu'];
// Bright, well-separated colours for human players (the first is the singleplayer colour).
const HUMAN_COLORS = [[30, 96, 255], [255, 64, 129], [0, 200, 140], [255, 152, 0], [156, 39, 176], [0, 188, 212], [205, 220, 57], [233, 30, 99],
  [63, 81, 181], [255, 87, 34], [76, 175, 80], [121, 85, 72], [96, 125, 139], [255, 235, 59], [0, 150, 136], [103, 58, 183]];

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
  let shipSeq = 1, structVer = 1, allyVer = 1;
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
    [W, H] = MAP_SIZES[cfg.size] || MAP_SIZES.medium; N = W * H;
    const rng = mulberry32(cfg.seed >>> 0);
    const n1 = makeNoise(rng), n2 = makeNoise(rng), n3 = makeNoise(rng);
    const freq = cfg.map === 'archipelago' ? 9 : cfg.map === 'pangaea' ? 3.4 : 4.4;
    const h = new Float32Array(N), e = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = y * W + x, nx = x / W * freq, ny = y / W * freq;
      let v = fbm(n1, nx, ny, 5);
      if (cfg.map === 'continents') v = v * 0.75 + fbm(n2, nx * 0.3 + 7, ny * 0.3 + 3, 2) * 0.45;
      if (cfg.map === 'pangaea') {
        const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
        v = v * 0.55 + (1 - Math.sqrt(dx * dx + dy * dy)) * 0.5;
      }
      const ex = Math.min(x, W - 1 - x) / W, ey = Math.min(y, H - 1 - y) / H;
      const edge = Math.min(ex / 0.07, ey / 0.1, 1);
      v -= (1 - edge) * 0.5;
      h[t] = v;
      e[t] = (1 - Math.abs(fbm(n3, nx * 1.6, ny * 1.6, 4) * 2 - 1));
    }
    const waterFrac = { continents: 0.52, pangaea: 0.46, archipelago: 0.64 }[cfg.map] || 0.52;
    const sorted = Float32Array.from(h).sort();
    const sea = sorted[Math.floor(N * waterFrac)];

    terrain = new Uint8Array(N);
    const landE = [];
    for (let t = 0; t < N; t++) if (h[t] > sea) { e[t] = (h[t] - sea) * 2 + e[t] * 0.35; landE.push(e[t]); }
    landE.sort((a, b) => a - b);
    const pHigh = landE[Math.floor(landE.length * 0.58)] || 0, pMount = landE[Math.floor(landE.length * 0.86)] || 0;
    for (let t = 0; t < N; t++) if (h[t] > sea) terrain[t] = e[t] < pHigh ? 1 : e[t] < pMount ? 2 : 3;

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
    if (old) { const op = players[old]; op.tiles--; op.border.delete(t); }
    owner[t] = o;
    if (o) players[o].tiles++;
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
  function makePlayer(name, type, color, id) {
    const p = {
      id: id || players.length, name, type, color,
      troops: type === 'bot' ? 10000 : type === 'nation' ? D.start : 25000,
      gold: 0, tiles: 0, border: new Set(), alive: true, spawned: false,
      allies: new Map(), traitorUntil: 0, hate: new Map(), cityLevels: 0,
      lx: 0, ly: 0, lfs: 0, best: 0, bestT: -1, minX: W, maxX: 0, minY: H, maxY: 0,
      aiPhase: (rand() * 20) | 0, lastHitBy: 0,
    };
    players[p.id] = p;
    return p;
  }
  function botName() {
    const n = SYL[rand() * SYL.length | 0] + SYL[rand() * SYL.length | 0] + (rand() < 0.5 ? SYL[rand() * SYL.length | 0] : '');
    return n[0].toUpperCase() + n.slice(1);
  }
  function maxTroops(p) {
    // troopCap() in OpenFront: 2 * (tiles^0.6 * 1000 + 50000) + cities
    let m = 2 * (Math.pow(p.tiles * TILE_SCALE, 0.6) * 1000 + 50000) + p.cityLevels * CITY_TROOPS;
    if (p.type === 'bot') m /= 3;
    return m;
  }
  function troopRate(p) {
    // troopIncreaseRate() in OpenFront
    const max = maxTroops(p);
    let add = (10 + Math.pow(Math.max(0, p.troops), 0.73) / 4) * (1 - p.troops / max);
    if (p.type === 'bot') add *= 0.5;
    if (p.type === 'nation') add *= D.grow;
    return add;
  }
  function goldRate(p) { return (p.type === 'bot' ? 50 : 100) + 5 * Math.sqrt(p.tiles); }
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
    const x = t % W, y = (t / W) | 0, R2 = DEFENSE_RANGE * DEFENSE_RANGE;
    for (const s of structs) {
      if (!s.alive || s.type !== 'defense' || s.owner !== o || s.doneAt > tick) continue;
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
    const border = cand.length;
    let frac = 0;
    for (const k of order) {
      const t = cand[k];
      let { mag, cost } = TERR[terrain[t]];
      if (T && hasDefensePost(t, tid)) { mag *= 5; cost *= 3; }
      if (falloutUntil[t] > tick) { mag *= 2; cost *= 2; }
      let loss, defLoss = 0, f;
      if (!T) {
        loss = mag / (P.type === 'bot' ? 10 : 5) * TILE_SCALE;
        f = within(2000 * cost / Math.max(1, a.troops), 5, 100) / (border * 2);
      } else {
        if (P.type !== 'bot' && T.type === 'bot') mag *= 0.7;
        const traitor = T.traitorUntil > tick;
        defLoss = T.troops / Math.max(1, T.tiles);
        const ratio = T.troops / Math.max(1, a.troops);
        loss = mag * (traitor ? 0.5 : 1) * within(ratio, 0.6, 2) * (0.463 * TILE_SCALE + 0.0039 * defLoss);
        const speedCost = within(ratio, 0.82, 7.5) * within(ratio / 20, 1, 50) / 8.55;
        f = speedCost * cost * (traitor ? 0.8 : 1) / border;
      }
      if (a.troops < loss) { removeAttack(a, 0); return; }
      a.troops -= loss;
      if (T) { T.troops = Math.max(0, T.troops - defLoss); T.lastHitBy = a.p; }
      setOwner(t, a.p);
      frac += f * FRONT_SLOWDOWN;
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
  function sendBoat(p, T, troops) {
    if (!terrain[T]) return 'Boats must land on a coast';
    if (boatsOf(p) >= MAX_BOATS) return 'You already have 3 boats at sea';
    const tgt = owner[T];
    if (tgt === p.id) return null;
    if (tgt && tick < immunityUntil) return 'Spawn protection is still active';
    if (tgt && allied(p.id, tgt)) return 'You cannot attack an ally';
    if (troops < 1) return 'Not enough troops';
    const path = boatPath(p, T);
    if (!path) return 'No sea route to that coast';
    p.troops -= troops;
    const s0 = path[0];
    addShip({ kind: 'transport', owner: p.id, path, i: 0, x: s0 % W + 0.5, y: ((s0 / W) | 0) + 0.5, troops, target: T, speed: 1 });
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
    if (o && (allied(s.owner, o) || tick < immunityUntil)) { P.troops += s.troops; return; }
    setOwner(T, s.owner);
    startAttack(P, o, s.troops, true);
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
    addShip({ kind: 'trade', owner: s.owner, path, i: 0, x: t0 % W + 0.5, y: ((t0 / W) | 0) + 0.5, dest: d, value: Math.floor(2000 + path.length * 80), speed: 0.9 });
  }
  function stepWarship(s) {
    s.cd = Math.max(0, s.cd - 1);
    let best = null, bd = 225;
    for (const o of ships) {
      if (o === s || o.dead || o.owner === s.owner || allied(o.owner, s.owner)) continue;
      const dx = o.x - s.x, dy = o.y - s.y, d2 = dx * dx + dy * dy;
      if (o.kind === 'warship') {
        if (d2 < 100 && s.cd === 0) {
          o.hp -= 250; s.cd = 15;
          fx({ kind: 'shot', x0: s.x, y0: s.y, x1: o.x, y1: o.y, dur: 250 });
          if (o.hp <= 0) { o.dead = true; boom(o.x, o.y, 3); if (isHuman(players[o.owner])) ev(o.owner, 'One of your warships was sunk', 'bad'); }
        }
      } else if (d2 < bd) { bd = d2; best = o; }
    }
    if (best) {
      if (bd <= 4) {
        best.dead = true;
        if (best.kind === 'trade') {
          players[s.owner].gold += best.value;
          if (isHuman(players[best.owner])) ev(best.owner, `<b>${esc(players[s.owner].name)}</b> captured your trade ship`, 'bad');
        } else {
          boom(best.x, best.y, 2);
          if (isHuman(players[best.owner])) ev(best.owner, `Your boat with ${fmt(best.troops)} troops was sunk by <b>${esc(players[s.owner].name)}</b>`, 'bad');
          if (isHuman(players[s.owner])) ev(s.owner, `Your warship sank a boat from <b>${esc(players[best.owner].name)}</b>`, 'good');
        }
        return;
      }
      // Greedy chase toward the target
      const cur = shipTile(s), c = nb4(cur, NB); let nx = -1, nd = 1e9;
      for (let i = 0; i < c; i++) {
        const n = NB[i]; if (terrain[n]) continue;
        const dx = n % W + 0.5 - best.x, dy = ((n / W) | 0) + 0.5 - best.y, d2 = dx * dx + dy * dy;
        if (d2 < nd) { nd = d2; nx = n; }
      }
      if (nx >= 0) { s.path = [nx]; s.i = 0; followPath(s, 1.3); return; }
    }
    if (!s.path || s.i >= s.path.length) {
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
    followPath(s, 0.8);
  }

  // ──────────── Structures ────────────
  function countUnits(p, type) {
    if (type === 'warship') return ships.filter(s => s.kind === 'warship' && s.owner === p.id).length;
    let n = 0;
    for (const s of structs) if (s.alive && s.owner === p.id && s.type === type) n += type === 'city' ? s.level : 1;
    return n;
  }
  function costOf(p, type) {
    // unitCost() in OpenFront
    const n = countUnits(p, type);
    switch (type) {
      case 'city': case 'port': return Math.min(1e6, 2 ** n * 125000);
      case 'defense': return Math.min(250000, (n + 1) * 50000);
      case 'sam': return Math.min(3e6, (n + 1) * 1.5e6);
      case 'silo': return 1e6;
      case 'warship': return Math.min(1e6, (n + 1) * 250000);
      case 'atom': return 750000;
      case 'hydrogen': return 5e6;
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
    if (type === 'atom' || type === 'hydrogen') return readySilo(p, t) ? null : 'You need a ready missile silo';
    if (type === 'warship') {
      if (terrain[t]) return 'Place warships on water';
      return nearestPort(p, t) ? null : 'Must be within 50 tiles of one of your ports';
    }
    if (owner[t] !== p.id) return 'Build on your own land';
    const ex = structAt[t] >= 0 ? structs[structAt[t]] : null;
    if (type === 'city' && ex && ex.type === 'city') return null;   // upgrade
    if (type === 'port' && !coastal[t]) return 'Ports must be on the coast';
    if (!spacingOk(t, 4)) return 'Too close to another building';
    return null;
  }
  function build(p, type, t) {
    if (!BUILD[type]) return 'Unknown building';
    const cost = costOf(p, type);
    if (p.gold < cost) return 'Not enough gold';
    const err = placeError(p, type, t);
    if (err) return err;
    if (type === 'atom' || type === 'hydrogen') return launchNuke(p, type, t, cost);
    if (type === 'warship') {
      const port = nearestPort(p, t);
      p.gold -= cost;
      const d = port.dock;
      addShip({ kind: 'warship', owner: p.id, x: d % W + 0.5, y: ((d / W) | 0) + 0.5, hp: 1000, home: t, path: null, i: 0, cd: 0 });
      return null;
    }
    p.gold -= cost;
    structVer++;
    const ex = structAt[t] >= 0 ? structs[structAt[t]] : null;
    if (type === 'city' && ex) { ex.level++; return null; }
    const s = { id: structs.length, type, owner: p.id, t, x: t % W, y: (t / W) | 0, level: 1, doneAt: tick + BUILD[type].time, readyAt: 0, alive: true, dock: -1, nextTrade: tick + BUILD[type].time + 30 };
    if (type === 'port') {
      let bestW = -1;
      for (const w of waterNbrs(t)) if (bestW < 0 || waterSizes[waterBody[w]] > waterSizes[waterBody[bestW]]) bestW = w;
      s.dock = bestW;
    }
    structs.push(s);
    structAt[t] = s.id;
    if (isHuman(p)) ev(p.id, `${BUILD[type].name} under construction`, 'good', { ttl: 2000 });
    return null;
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
    silo.readyAt = tick + 80;
    structVer++;
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
      if (allied(p.id, v)) breakAlliance(p.id, v, true);
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
  function formAlliance(a, b) {
    const until = tick + ALLIANCE_TICKS;
    players[a].allies.set(b, until); players[b].allies.set(a, until);
    allyVer++;
    for (const at of attacks.slice()) if ((at.p === a && at.target === b) || (at.p === b && at.target === a)) removeAttack(at, 1);
  }
  function breakAlliance(a, b, betray) {
    players[a].allies.delete(b); players[b].allies.delete(a);
    allyVer++;
    if (betray) {
      players[a].traitorUntil = tick + 300;
      addHate(players[b], a, 8);
      for (const q of players) if (q && q.type === 'nation' && q.id !== b && q.id !== a) addHate(q, a, 1);
    }
  }
  function requestAlliance(p, q) {
    const key = p.id + ':' + q.id;
    if ((askCooldown.get(key) || 0) > tick) return `Wait before asking ${q.name} again`;
    askCooldown.set(key, tick + 300);
    if (isHuman(q)) {
      pendingReq.set(key, tick + 200);
      ev(q.id, `<b>${esc(p.name)}</b> requests an alliance`, 'info', { req: p.id, ttl: 20000 });
      ev(p.id, `Alliance request sent to <b>${esc(q.name)}</b>`, 'info');
      return null;
    }
    // Nation q decides whether to accept p's request.
    const hate = q.hate.get(p.id) || 0;
    let chance = D.acc + (p.troops > q.troops ? 0.2 : 0) - hate * 0.08 - (p.traitorUntil > tick ? 0.5 : 0) - q.allies.size * 0.1;
    if (q.type === 'bot') chance = 0.15;
    if (rand() < chance) { formAlliance(p.id, q.id); ev(p.id, `<b>${esc(q.name)}</b> accepted your alliance`, 'good'); }
    else ev(p.id, `<b>${esc(q.name)}</b> declined your alliance`, 'info');
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
    if (!q.alive || !p.alive) return null;
    formAlliance(p.id, q.id);
    ev(p.id, `You are now allied with <b>${esc(q.name)}</b>`, 'good');
    if (isHuman(q)) ev(q.id, `<b>${esc(p.name)}</b> accepted your alliance`, 'good');
    return null;
  }
  function sendTroops(p, q, troops) {
    if (troops < 1) return;
    p.troops -= troops; q.troops += troops;
    ev(p.id, `Sent ${fmt(troops)} troops to <b>${esc(q.name)}</b>`, 'good');
    if (isHuman(q)) ev(q.id, `<b>${esc(p.name)}</b> sent you ${fmt(troops)} troops`, 'good');
  }

  // ──────────── AI ────────────
  function aiTick(p) {
    const info = neighbors(p), max = maxTroops(p), imm = tick < immunityUntil;
    aiBuild(p, info);
    aiDiplomacy(p, info);
    if (p.troops < max * D.thr) return;
    if (info.neutral > 0) {
      startAttack(p, 0, p.troops * D.ratio);
      if (!info.players.size || rand() < 0.6) return;
    }
    if (!imm && info.players.size) {
      let best = null, bs = 1e9;
      for (const [id] of info.players) {
        if (allied(p.id, id)) continue;
        const q = players[id];
        let s = q.troops / Math.max(1, p.troops);
        if (q.type === 'bot') s -= 0.6;
        if (q.traitorUntil > tick) s -= 0.3;
        s -= Math.min(10, p.hate.get(id) || 0) * 0.05;
        if (s < bs) { bs = s; best = q; }
      }
      if (best && bs < 0.9 * D.aggr + (p.troops > max * 0.9 ? 0.5 : 0)) {
        startAttack(p, best.id, p.troops * D.ratio * (best.type === 'bot' ? 0.8 : 1.2));
        return;
      }
    }
    if (!info.neutral && info.coastal && boatsOf(p) < 2 && (!info.players.size || rand() < 0.15)) aiBoat(p, imm);
  }
  function aiBoat(p, imm) {
    let pick = -1, pd = 1e18;
    for (let k = 0; k < 40; k++) {
      const t = rand() * N | 0;
      if (!coastal[t]) continue;
      const o = owner[t];
      if (o === p.id || allied(p.id, o) || (o && imm)) continue;
      if (o && players[o].troops > p.troops * D.aggr) continue;
      const d = (t % W - p.lx) ** 2 + (((t / W) | 0) - p.ly) ** 2 + (o ? 4000 : 0);
      if (d < pd) { pd = d; pick = t; }
    }
    if (pick >= 0) sendBoat(p, pick, p.troops * D.ratio);
  }
  function aiBuild(p, info) {
    if (rand() > 0.5) return;
    const g = p.gold;
    const ok = (type, t) => t >= 0 && g >= costOf(p, type) && !build(p, type, t);
    if (g >= costOf(p, 'city') && countUnits(p, 'city') < 2 + p.tiles / 700) {
      if (ok('city', findTile(p, t => distT[t] >= 3 && !placeError(p, 'city', t)))) return;
    }
    if (info.coastal && g >= costOf(p, 'port') && countUnits(p, 'port') < 1 + p.tiles / 1600) {
      const opts = [];
      for (const t of p.border) if (coastal[t] && !placeError(p, 'port', t)) { opts.push(t); if (opts.length > 30) break; }
      if (opts.length && ok('port', opts[rand() * opts.length | 0])) return;
    }
    if (D.defense && tick > immunityUntil && g >= costOf(p, 'defense') && countUnits(p, 'defense') < 1 + p.tiles / 450) {
      let threat = 0, tt = 0;
      for (const [id] of info.players) { const q = players[id]; if (!allied(p.id, id) && q.type !== 'bot' && q.troops > tt) { tt = q.troops; threat = id; } }
      if (threat && tt > p.troops * 0.7) {
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
    if (D.nukes && p.tiles > landTotal * 0.05) {
      if (!countUnits(p, 'silo') && g >= 1e6) { if (ok('silo', findTile(p, t => distT[t] >= 4 && !placeError(p, 'silo', t)))) return; }
      const enemySilo = structs.some(s => s.alive && s.type === 'silo' && s.owner !== p.id && !allied(s.owner, p.id));
      if (enemySilo && g >= costOf(p, 'sam') && countUnits(p, 'sam') < Math.min(3, countUnits(p, 'city'))) {
        const city = structs.find(s => s.alive && s.type === 'city' && s.owner === p.id);
        if (city) {
          const t = findTile(p, u => (u % W - city.x) ** 2 + (((u / W) | 0) - city.y) ** 2 < 100 && !placeError(p, 'sam', u), 300);
          if (ok('sam', t)) return;
        }
      }
      if (countUnits(p, 'silo') && g >= 750000 + 250000 && rand() < 0.35) {
        let tgt = null, ts = 0;
        for (const q of players) {
          if (!q || !q.alive || q === p || q.type === 'bot' || allied(p.id, q.id)) continue;
          const s = q.tiles * (1 + Math.min(10, p.hate.get(q.id) || 0) * 0.2);
          if (s > ts) { ts = s; tgt = q; }
        }
        if (tgt && tgt.bestT >= 0) {
          const city = structs.find(s => s.alive && s.owner === tgt.id && s.type === 'city');
          const t = city ? city.t : tgt.bestT;
          if (ok(g >= 5.5e6 ? 'hydrogen' : 'atom', t)) return;
        }
      }
    }
    if (rand() < 0.3 && g >= costOf(p, 'warship') && countUnits(p, 'warship') < countUnits(p, 'port')) {
      const port = structs.find(s => s.alive && s.type === 'port' && s.owner === p.id && s.doneAt <= tick);
      if (port) ok('warship', port.dock);
    }
  }
  function aiDiplomacy(p, info) {
    if (tick < immunityUntil) return;
    for (const [id] of info.players) {
      const h = players[id];
      if (!isHuman(h) || !h.alive || allied(p.id, id)) continue;
      const key = p.id + ':' + id;
      if (pendingReq.has(key) || rand() >= 0.02) continue;
      if ((p.hate.get(id) || 0) >= 2 || h.troops < p.troops * 0.7 || h.traitorUntil > tick) continue;
      pendingReq.set(key, tick + 200);
      ev(id, `<b>${esc(p.name)}</b> requests an alliance`, 'info', { req: p.id, ttl: 20000 });
      return;
    }
    if (rand() < 0.01) {
      for (const [id] of info.players) {
        const q = players[id];
        if (q.type !== 'nation' || allied(p.id, id) || (p.hate.get(id) || 0) > 1 || (q.hate.get(p.id) || 0) > 1) continue;
        if (p.allies.size >= 2 || q.allies.size >= 2) continue;
        formAlliance(p.id, id);
        break;
      }
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
    const cx = t % W, cy = (t / W) | 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || dx * dx + dy * dy > R * R + 1) continue;
      const u = y * W + x;
      if (terrain[u] && !owner[u]) setOwner(u, p.id);
    }
    p.spawned = true;
  }
  function spawnAIs() {
    const ais = players.filter(p => p && p.type !== 'human');
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
      p.troops = Math.max(0, p.troops + troopRate(p));
      p.gold += goldRate(p);
    }
    for (const a of attacks.slice()) if (attacks.includes(a)) stepAttack(a);

    for (const s of ships) { s.px = s.x; s.py = s.y; }
    for (const s of ships) {
      if (s.dead) continue;
      if (!players[s.owner].alive) { s.dead = true; continue; }
      if (s.kind === 'warship') { stepWarship(s); continue; }
      if (followPath(s, s.speed)) {
        s.dead = true;
        if (s.kind === 'transport') landBoat(s);
        else if (s.dest.alive && players[s.dest.owner].alive) {
          players[s.owner].gold += s.value; players[s.dest.owner].gold += s.value;
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

    for (const p of players) if (p) p.cityLevels = 0;
    for (const s of structs) {
      if (!s.alive) continue;
      if (s.type === 'city' && s.doneAt <= tick) players[s.owner].cityLevels += s.level;
      if (s.type === 'port' && s.doneAt <= tick && tick >= s.nextTrade && s.dock >= 0) {
        s.nextTrade = tick + 100 + (rand() * 60 | 0);
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
        }
        for (const [id, v] of p.hate) p.hate.set(id, v * 0.995);
      }
      for (const [k, until] of pendingReq) if (until <= tick) pendingReq.delete(k);
    }
    if (tick % 20 === 0) computeLabels();
    if (tick % 50 === 0) sweepFallout();
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
      const killer = players[p.lastHitBy];
      if (killer && killer.alive) killer.gold += p.gold;
      p.gold = 0;
      if (killer) killer.kills = (killer.kills || 0) + 1;
      const msg = `<b>${esc(p.name)}</b> was eliminated${killer ? ' by <b>' + esc(killer.name) + '</b>' : ''}`;
      if (p.type !== 'bot') ev(0, msg, isHuman(p) ? 'bad' : 'warn');
      else if (isHuman(killer)) ev(killer.id, msg, 'warn');
    }
    if (tick % 10 || ended) return;
    const alive = players.filter(p => p && p.alive);
    for (const p of alive) {
      if (p.tiles >= landTotal * WIN_SHARE || alive.length === 1) { ended = true; winner = p.id; hooks.end(p.id); return; }
    }
  }

  // ──────────── Player intents (same for singleplayer and server) ────────────
  function attackTile(p, t, r) {
    if (!terrain[t]) return null;
    const o = owner[t];
    if (o === p.id) return null;
    if (o && allied(p.id, o)) return `${players[o].name} is your ally`;
    if (o && tick < immunityUntil) return `Spawn protection: ${Math.ceil((immunityUntil - tick) / 10)}s left`;
    const troops = p.troops * r;
    if (troops < 1) return 'Not enough troops';
    if (touches(p, o, o ? -1 : landBody[t])) { startAttack(p, o, troops); return null; }
    if (coastal[t]) return sendBoat(p, t, troops);
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
    if (state !== 'play' || !p.alive || ended && winner) return null;
    const r = within(+i.r || 0.2, 0.01, 1);
    const q = players[target];
    switch (i.a) {
      case 'click': return t >= 0 && t < N ? attackTile(p, t, r) : null;
      case 'boat': return t >= 0 && t < N ? sendBoat(p, t, p.troops * r) : null;
      case 'build': return build(p, String(i.k), t);
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
    }
    return null;
  }

  // ──────────── Network sync ────────────
  // Server side: delta() is sent every tick; full() to a player who (re)connects mid-game.
  const r1 = v => Math.round(v * 10) / 10;
  function snapshotCommon(force) {
    const m = {
      k: tick, st: state, sl: spawnLeft, im: immunityUntil,
      p: players.map(p => p ? [Math.floor(p.troops), Math.floor(p.gold), p.tiles, p.alive ? 1 : 0, p.traitorUntil, p.cityLevels, p.spawned ? 1 : 0] : null),
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
    return m;
  }
  let lastStructVer = 0, lastAllyVer = 0;
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
    lastStructVer = 0; lastAllyVer = 0;   // make the next delta resend, so everyone stays in sync
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
    return { cfg, players: players.map(p => p ? { id: p.id, name: p.name, type: p.type, color: p.color } : null), landTotal };
  }

  // Client side (mirror): apply a server message.
  function apply(m) {
    if (m.full) {
      let t = 0;
      for (let i = 0; i < m.full.length; i += 2) {
        const o = m.full[i], end = t + m.full[i + 1];
        for (; t < end; t++) owner[t] = o;
      }
      for (const p of players) if (p) { p.border.clear(); p.tiles = 0; }
      for (let u = 0; u < N; u++) {
        const o = owner[u];
        if (o) { players[o].tiles++; if (isBorderTile(u)) players[o].border.add(u); }
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
    });
    if (m.al) m.al.forEach((list, id) => { if (players[id] && list) players[id].allies = new Map(list); });
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
    for (const p of opt.players) if (p) makePlayer(p.name, p.type, p.color, p.id);
  } else {
    (opt.humans || []).forEach((h, i) => makePlayer(String(h.name || 'Player').slice(0, 16), 'human', HUMAN_COLORS[i % HUMAN_COLORS.length]));
    const names = NATION_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) { const j = rand() * (i + 1) | 0; [names[i], names[j]] = [names[j], names[i]]; }
    for (let i = 0; i < (cfg.nations | 0); i++) {
      let hue = (i * 137.508 + 20) % 360;
      if (hue > 195 && hue < 240) hue = (hue + 60) % 360;
      makePlayer(names[i % names.length] + (i >= names.length ? ' II' : ''), 'nation', hsl2rgb(hue, 62, 52));
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
    maxTroops, troopRate, goldRate, costOf, placeError, hasDefensePost, allied, nukePos,
  };
}

const api = {
  createGame, fmt, esc, within, TICK_MS, SPAWN_TICKS, IMMUNITY_TICKS, WIN_SHARE, DEFENSE_RANGE, SAM_RANGE,
  NUKE, TERR, DIFF, BUILD, BUILD_ORDER, MAP_SIZES,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.FrontierCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

// Timberfall game rules, shared by the browser (singleplayer + online view) and the Node
// multiplayer server (server/timberfall.js). A top-down battle royale for 20 players: loot guns,
// chop trees for wood, throw up barricades when you're shot at, and be the last team standing
// inside the shrinking zone. Empty seats are bots, from Easy to Impossible.
// Everything that changes the world (trees, barricades, loot) goes through applyEvent(), so the
// server's world and every browser's copy of it change in exactly the same way.
(function (root) {
'use strict';

// ──────────── Settings ────────────
const TICK_RATE = 20, DT = 1 / TICK_RATE, TICK_MS = 1000 / TICK_RATE;
const MAP_SIZE = 3400, CELL = 100, GRID_N = Math.ceil(MAP_SIZE / CELL);
const DENSITY = (MAP_SIZE / 2600) ** 2;   // object counts below are for a 2600 map
const MAX_PLAYERS = 20;
const TEAM_SIZES = { solo: 1, duo: 2, squad: 4 };
const DIFFS = ['easy', 'medium', 'hard', 'impossible'];
const PLAYER_R = 16, SPEED = 215;
const HP_MAX = 100, SHIELD_MAX = 100;
const TREE_HP = 5, WOOD_PER_CHOP = 15, WOOD_MAX = 300;
const BAR = { cost: 20, len: 86, half: 8, hp: 180, dist: 46, cooldown: 0.3, max: 150 };
const DROP_SECS = 10;
const HISTORY = 16;                  // ticks of positions kept for lag compensation (800 ms)
const PICKUP_R = 44;
// Zone phases: wait (s), shrink (s), radius as a share of the first circle, damage per second outside
const ZONE = [[50, 35, 0.55, 1], [35, 25, 0.32, 2], [30, 20, 0.16, 4], [25, 15, 0.06, 7], [20, 20, 0, 10]];
const ZONE_R0 = MAP_SIZE * 0.72;

const WEAPONS = {
  axe:     { name: 'Axe',     melee: true, dmg: 25, rate: 2.2, reach: 24, barDmg: 60 },
  pistol:  { name: 'Pistol',  dmg: 20, rate: 4,    mag: 12, reload: 1.2, spread: 0.05,  range: 650,  pellets: 1, rank: 1, keep: 300 },
  smg:     { name: 'SMG',     dmg: 13, rate: 10,   mag: 30, reload: 1.8, spread: 0.11,  range: 480,  pellets: 1, rank: 3, keep: 220 },
  shotgun: { name: 'Shotgun', dmg: 11, rate: 1.1,  mag: 5,  reload: 2.4, spread: 0.2,   range: 320,  pellets: 8, rank: 3, keep: 110, falloff: true },
  rifle:   { name: 'Rifle',   dmg: 21, rate: 6,    mag: 30, reload: 2.2, spread: 0.045, range: 850,  pellets: 1, rank: 4, keep: 380 },
  sniper:  { name: 'Sniper',  dmg: 90, rate: 0.75, mag: 4,  reload: 2.8, spread: 0,     range: 1500, pellets: 1, rank: 2, keep: 600, zoom: 1.45 },
};
const WEAPON_IDS = ['axe', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper'];
const GUNS = WEAPON_IDS.slice(1);
const HEALS = {
  bandage: { name: 'Bandage', time: 2,   hp: 20,  cap: 75,  max: 10, per: 3 },
  medkit:  { name: 'Medkit',  time: 5,   hp: 100, cap: 100, max: 3,  per: 1 },
  shield:  { name: 'Shield',  time: 2.5, shield: 50,        max: 4,  per: 1 },
};
const HEAL_IDS = ['bandage', 'medkit', 'shield'];

// How each bot difficulty plays. react: seconds from first seeing you to the first shot.
// aimErr: aim wobble (radians). turn: how fast it can swing its aim (rad/s). spreadMul: weapon
// spread it suffers (0 = every bullet lands where it aims). build: chance it throws up a barricade
// when shot. Impossible never misses, so beat it by breaking line of sight, using bushes and
// barricades, or shooting first.
const BOT = {
  easy:       { react: 0.9,  aimErr: 0.3,   turn: 3.5, view: 500, strafe: 0.15, build: 0.06, healAt: 25, spreadMul: 1.4, burst: [0.5, 0.9], zoneLead: 0,   chopTo: 40,  investigate: 0,   shootBars: 0,   swap: false },
  medium:     { react: 0.48, aimErr: 0.13,  turn: 7,   view: 600, strafe: 0.5,  build: 0.3,  healAt: 45, spreadMul: 1.1, burst: [0.9, 0.45], zoneLead: 0.3, chopTo: 80,  investigate: 0.4, shootBars: 0.4, swap: false },
  hard:       { react: 0.27, aimErr: 0.03, turn: 14,  view: 680, strafe: 0.9,  build: 0.75, healAt: 60, spreadMul: 1,   burst: null, zoneLead: 0.75, chopTo: 140, investigate: 0.8, shootBars: 1, swap: true },
  impossible: { react: 0.2,  aimErr: 0,     turn: 1e9, view: 700, strafe: 1,    build: 0.9,  healAt: 65, spreadMul: 0,   burst: null, zoneLead: 1,    chopTo: 160, investigate: 1,   shootBars: 1, swap: true },
};
const MIXED_WEIGHTS = [30, 35, 25, 10];
const BOT_NAMES = ['Maple', 'Birch', 'Cedar', 'Willow', 'Aspen', 'Spruce', 'Hazel', 'Rowan', 'Alder', 'Juniper', 'Oakley', 'Pine',
  'Cypress', 'Elm', 'Ash', 'Larch', 'Holly', 'Laurel', 'Sequoia', 'Redwood', 'Sycamore', 'Poplar', 'Linden', 'Hemlock', 'Yew', 'Fir',
  'Magnolia', 'Acacia', 'Banyan', 'Baobab', 'Chestnut', 'Hickory', 'Walnut', 'Beech', 'Sorrel', 'Thistle', 'Bramble', 'Fern'];

// ──────────── Utilities ────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const r1 = v => Math.round(v * 10) / 10;
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ──────────── Geometry ────────────
// Ray tests return the distance along the (unit) ray, or -1 for a miss. Starting inside counts as 0.
function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx, fy = oy - cy, c = fx * fx + fy * fy - r * r;
  if (c < 0) return 0;
  const b = fx * dx + fy * dy;
  if (b > 0) return -1;
  const disc = b * b - c;
  return disc < 0 ? -1 : -b - Math.sqrt(disc);
}
function rayRect(ox, oy, dx, dy, x, y, w, h) {
  let t0 = 0, t1 = Infinity;
  if (Math.abs(dx) < 1e-9) { if (ox < x || ox > x + w) return -1; }
  else { let a = (x - ox) / dx, b = (x + w - ox) / dx; if (a > b) { const s = a; a = b; b = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
  if (Math.abs(dy) < 1e-9) { if (oy < y || oy > y + h) return -1; }
  else { let a = (y - oy) / dy, b = (y + h - oy) / dy; if (a > b) { const s = a; a = b; b = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
  return t0 <= t1 ? t0 : -1;
}
// Barricades are rotated rectangles: centre x, y, along angle a
function rayBar(ox, oy, dx, dy, b) {
  const c = Math.cos(b.a), s = Math.sin(b.a), rx = ox - b.x, ry = oy - b.y;
  return rayRect(rx * c + ry * s, -rx * s + ry * c, dx * c + dy * s, -dx * s + dy * c, -BAR.len / 2, -BAR.half, BAR.len, BAR.half * 2);
}
function barEnds(b) {
  const hx = Math.cos(b.a) * BAR.len / 2, hy = Math.sin(b.a) * BAR.len / 2;
  return [b.x - hx, b.y - hy, b.x + hx, b.y + hy];
}
// Closest point on a barricade's centre line to (px, py)
function barClosest(b, px, py) {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const t = clamp((px - b.x) * c + (py - b.y) * s, -BAR.len / 2, BAR.len / 2);
  return [b.x + c * t, b.y + s * t];
}

// ──────────── World ────────────
// The map is generated from the seed, so the server and every browser build the same one and only
// changes need to be sent. Object kinds: 1 rock, 2 tree, 3 wall (box). Bushes hide you but don't block.
function genWorld(seed) {
  const rnd = mulberry32(seed ^ 0x5eed);
  const S = MAP_SIZE;
  const W = { seed, size: S, rocks: [], trees: [], walls: [], bushes: [], ruins: [], grid: [], bars: new Map(), loot: new Map(), stamp: 0, nextId: 1 };
  for (let i = 0; i < GRID_N * GRID_N; i++) W.grid.push([]);
  const taken = [];   // circles kept clear so solid things never touch
  const free = (x, y, r, gap) => x > r + 30 && y > r + 30 && x < S - r - 30 && y < S - r - 30 &&
    taken.every(c => (c.x - x) ** 2 + (c.y - y) ** 2 > (c.r + r + gap) ** 2);
  const add = (o, x0, y0, x1, y1) => {
    for (let gx = Math.max(0, Math.floor(x0 / CELL)); gx <= Math.min(GRID_N - 1, Math.floor(x1 / CELL)); gx++)
      for (let gy = Math.max(0, Math.floor(y0 / CELL)); gy <= Math.min(GRID_N - 1, Math.floor(y1 / CELL)); gy++) W.grid[gy * GRID_N + gx].push(o);
  };
  const wall = (x, y, w, h) => { const o = { k: 3, x, y, w, h, st: 0 }; W.walls.push(o); add(o, x, y, x + w, y + h); };

  // Ruins: walled yards with doorways. Most of the loot is inside them.
  const n = k => Math.round(k * DENSITY);
  for (let tries = 0; W.ruins.length < n(8) && tries < 800; tries++) {
    const w = 170 + rnd() * 130 | 0, h = 150 + rnd() * 110 | 0;
    const x = 140 + rnd() * (S - 280 - w) | 0, y = 140 + rnd() * (S - 280 - h) | 0;
    const cx = x + w / 2, cy = y + h / 2, r = Math.hypot(w, h) / 2;
    if (!free(cx, cy, r, 120)) continue;
    taken.push({ x: cx, y: cy, r: r + 20 });
    W.ruins.push({ x, y, w, h });
    const T = 16, door = 66;
    const doors = [0, 1, 2, 3].map(() => rnd() < 0.6);
    if (doors.filter(Boolean).length < 2) { doors[0] = true; doors[2] = true; }
    const side = (horiz, sx, sy, len, hasDoor) => {
      if (!hasDoor) return horiz ? wall(sx, sy, len, T) : wall(sx, sy, T, len);
      const g = T + 10 + rnd() * (len - 2 * T - 20 - door);
      if (horiz) { wall(sx, sy, g, T); wall(sx + g + door, sy, len - g - door, T); }
      else { wall(sx, sy, T, g); wall(sx, sy + g + door, T, len - g - door); }
    };
    side(true, x, y, w, doors[0]); side(true, x, y + h - T, w, doors[2]);
    side(false, x, y + T, h - 2 * T, doors[3]); side(false, x + w - T, y + T, h - 2 * T, doors[1]);
  }
  for (let i = 0, tries = 0; i < n(45) && tries < 6000; tries++) {
    const r = 26 + rnd() * 22, x = rnd() * S, y = rnd() * S;
    if (!free(x, y, r, 44)) continue;
    const o = { k: 1, x, y, r, st: 0 }; W.rocks.push(o); taken.push(o); add(o, x - r, y - r, x + r, y + r); i++;
  }
  for (let i = 0, tries = 0; i < n(190) && tries < 12000; tries++) {
    const r = 22 + rnd() * 9, x = rnd() * S, y = rnd() * S;
    if (!free(x, y, r, 40)) continue;
    const o = { k: 2, id: W.trees.length, x, y, r, hp: TREE_HP, st: 0 }; W.trees.push(o); taken.push(o); add(o, x - r, y - r, x + r, y + r); i++;
  }
  for (let i = 0, tries = 0; i < n(70) && tries < 6000; tries++) {
    const r = 30 + rnd() * 9, x = rnd() * S, y = rnd() * S;
    if (!free(x, y, r, 4)) continue;
    W.bushes.push({ x, y, r }); i++;
  }

  // Starting loot, also from the seed
  const pick = (list, wts) => { let t = rnd() * wts.reduce((a, b) => a + b, 0); for (let i = 0; i < list.length; i++) if ((t -= wts[i]) < 0) return list[i]; return list[0]; };
  const item = (x, y) => {
    const gun = rnd() < 0.55;
    const k = gun ? pick(GUNS, [25, 22, 20, 23, 10]) : pick(HEAL_IDS, [40, 25, 35]);
    const n = gun ? WEAPONS[k].mag : HEALS[k].per;
    const id = W.nextId++;
    W.loot.set(id, { id, k, x: Math.round(x), y: Math.round(y), n });
  };
  for (const r of W.ruins) for (let i = 0, n = 4 + (rnd() * 3 | 0); i < n; i++) item(r.x + 34 + rnd() * (r.w - 68), r.y + 34 + rnd() * (r.h - 68));
  for (let i = 0, tries = 0; i < n(40) && tries < 4000; tries++) {
    const x = 60 + rnd() * (S - 120), y = 60 + rnd() * (S - 120);
    if (!free(x, y, 14, 6)) continue;
    item(x, y); i++;
  }
  return W;
}

function cellsAround(W, x0, y0, x1, y1, fn) {
  const gx0 = Math.max(0, Math.floor(x0 / CELL)), gx1 = Math.min(GRID_N - 1, Math.floor(x1 / CELL));
  const gy0 = Math.max(0, Math.floor(y0 / CELL)), gy1 = Math.min(GRID_N - 1, Math.floor(y1 / CELL));
  const st = ++W.stamp;
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++)
    for (const o of W.grid[gy * GRID_N + gx]) { if (o.st === st) continue; o.st = st; if (o.k === 2 && o.hp <= 0) continue; fn(o); }
}

// Does a circle at (x, y) overlap anything solid?
function solidAt(W, x, y, r) {
  if (x < r || y < r || x > W.size - r || y > W.size - r) return true;
  let hit = false;
  cellsAround(W, x - r, y - r, x + r, y + r, o => {
    if (hit) return;
    if (o.k === 3) { const cx = clamp(x, o.x, o.x + o.w), cy = clamp(y, o.y, o.y + o.h); hit = (x - cx) ** 2 + (y - cy) ** 2 < r * r; }
    else hit = (x - o.x) ** 2 + (y - o.y) ** 2 < (o.r + r) ** 2;
  });
  if (hit) return true;
  for (const b of W.bars.values()) {
    if (Math.abs(b.x - x) > BAR.len && Math.abs(b.y - y) > BAR.len) continue;
    const [cx, cy] = barClosest(b, x, y);
    if ((x - cx) ** 2 + (y - cy) ** 2 < (r + BAR.half) ** 2) return true;
  }
  return false;
}

function pushFrom(p, cx, cy, m) {
  const dx = p.x - cx, dy = p.y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= m * m) return;
  const d = Math.sqrt(d2);
  if (d < 1e-4) { p.x += m; return; }
  p.x = cx + dx / d * m; p.y = cy + dy / d * m;
}
function resolve(W, p) {
  const R = PLAYER_R;
  for (let it = 0; it < 2; it++) {
    cellsAround(W, p.x - R, p.y - R, p.x + R, p.y + R, o => {
      if (o.k === 3) {
        const cx = clamp(p.x, o.x, o.x + o.w), cy = clamp(p.y, o.y, o.y + o.h);
        if (cx === p.x && cy === p.y) {   // centre inside the box: leave by the nearest side
          const l = p.x - o.x, r = o.x + o.w - p.x, t = p.y - o.y, b = o.y + o.h - p.y, m = Math.min(l, r, t, b);
          if (m === l) p.x = o.x - R; else if (m === r) p.x = o.x + o.w + R; else if (m === t) p.y = o.y - R; else p.y = o.y + o.h + R;
        } else pushFrom(p, cx, cy, R);
      } else pushFrom(p, o.x, o.y, o.r + R);
    });
    for (const b of W.bars.values()) {
      if (Math.abs(b.x - p.x) > BAR.len || Math.abs(b.y - p.y) > BAR.len) continue;
      const [cx, cy] = barClosest(b, p.x, p.y);
      pushFrom(p, cx, cy, R + BAR.half);
    }
    p.x = clamp(p.x, R, W.size - R); p.y = clamp(p.y, R, W.size - R);
  }
}
// One tick of walking. Used by the server and, for your own player, by your browser to predict.
function move(W, p, mx, my, mul) {
  const len = Math.hypot(mx, my);
  if (len < 0.01) return;
  const step = SPEED * mul * DT / Math.max(1, len);
  p.x += mx * step; p.y += my * step;
  resolve(W, p);
}
function speedMul(healing, weapon) { return (healing ? 0.5 : 1) * (weapon === 'sniper' ? 0.9 : 1); }

// First solid thing along a ray: { t, o } (o is null when nothing is hit within maxD)
function raycast(W, ox, oy, dx, dy, maxD) {
  let best = maxD, hit = null;
  const st = ++W.stamp;
  let ix = Math.floor(ox / CELL), iy = Math.floor(oy / CELL);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity, tdy = Math.abs(dy) > 1e-9 ? CELL / Math.abs(dy) : Infinity;
  let tmx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / Math.abs(dx)) : Infinity;
  let tmy = Math.abs(dy) > 1e-9 ? ((dy > 0 ? (iy + 1) * CELL - oy : oy - iy * CELL) / Math.abs(dy)) : Infinity;
  let enter = 0;
  while (enter <= best) {
    if (ix >= 0 && iy >= 0 && ix < GRID_N && iy < GRID_N) {
      for (const o of W.grid[iy * GRID_N + ix]) {
        if (o.st === st) continue;
        o.st = st;
        if (o.k === 2 && o.hp <= 0) continue;
        const t = o.k === 3 ? rayRect(ox, oy, dx, dy, o.x, o.y, o.w, o.h) : rayCircle(ox, oy, dx, dy, o.x, o.y, o.r);
        if (t >= 0 && t < best) { best = t; hit = o; }
      }
    } else if (ix < -1 || iy < -1 || ix > GRID_N || iy > GRID_N) break;
    if (tmx < tmy) { enter = tmx; tmx += tdx; ix += sx; } else { enter = tmy; tmy += tdy; iy += sy; }
  }
  for (const b of W.bars.values()) {
    // skip barricades nowhere near the ray
    const fx = b.x - ox, fy = b.y - oy, along = fx * dx + fy * dy;
    if (along < -BAR.len || along > best + BAR.len || Math.abs(fx * dy - fy * dx) > BAR.len / 2 + BAR.half) continue;
    const t = rayBar(ox, oy, dx, dy, b);
    if (t >= 0 && t < best) { best = t; hit = b; }
  }
  return { t: best, o: hit };
}
const inBush = (W, x, y) => W.bushes.some(b => (b.x - x) ** 2 + (b.y - y) ** 2 < (b.r - 4) ** 2);

// World changes. The server makes them by emitting events, and browsers apply the same events.
function applyEvent(W, e) {
  switch (e.e) {
    case 'tr': { const t = W.trees[e.id]; if (t) t.hp = e.hp; break; }
    case 'b+': W.bars.set(e.id, { id: e.id, x: e.x, y: e.y, a: e.a, hp: e.hp, tm: e.tm }); break;
    case 'bh': { const b = W.bars.get(e.id); if (b) b.hp = e.hp; break; }
    case 'b-': W.bars.delete(e.id); break;
    case 'l+': W.loot.set(e.id, { id: e.id, k: e.k, x: e.x, y: e.y, n: e.n }); break;
    case 'l-': W.loot.delete(e.id); break;
  }
}
// Everything a browser needs to catch up with a world already in progress
function worldFull(W) {
  return {
    trees: W.trees.filter(t => t.hp < TREE_HP).map(t => [t.id, t.hp]),
    bars: [...W.bars.values()].map(b => [b.id, b.x, b.y, b.a, b.hp, b.tm]),
    loot: [...W.loot.values()].map(l => [l.id, l.k, l.x, l.y, l.n]),
  };
}
function applyFull(W, f) {
  for (const t of W.trees) t.hp = TREE_HP;
  for (const [id, hp] of f.trees) if (W.trees[id]) W.trees[id].hp = hp;
  W.bars.clear();
  for (const [id, x, y, a, hp, tm] of f.bars) W.bars.set(id, { id, x, y, a, hp, tm });
  W.loot.clear();
  for (const [id, k, x, y, n] of f.loot) W.loot.set(id, { id, k, x, y, n });
}

// ──────────── Game ────────────
// cfg: { mode: 'solo'|'duo'|'squad', diff: one of DIFFS or 'mixed', teamUp: humans share teams,
//        mix: optional [easy, medium, hard, impossible] weights for 'mixed' (ranked uses these) }
// humans: [{ name }]. The first humans get player ids 1, 2, …
function cleanCfg(c) {
  c = c || {};
  return {
    mode: TEAM_SIZES[c.mode] ? c.mode : 'solo',
    diff: DIFFS.includes(c.diff) || c.diff === 'mixed' ? c.diff : 'medium',
    teamUp: c.teamUp !== false,
    mix: Array.isArray(c.mix) && c.mix.length === DIFFS.length && c.mix.every(n => typeof n === 'number' && n >= 0 && n <= 100) && c.mix.some(n => n > 0) ? c.mix.slice() : undefined,
  };
}
function createGame({ seed, cfg, humans, hooks }) {
  cfg = cleanCfg(cfg);
  hooks = hooks || {};
  const rnd = mulberry32((seed * 7919) ^ 0xb055);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
  const W = genWorld(seed);
  const size = TEAM_SIZES[cfg.mode], nTeams = MAX_PLAYERS / size;
  const players = [], byId = new Map();
  let events = [];
  let tick = 0, phase = 'drop', dropLeft = DROP_SECS * TICK_RATE, winner = 0;
  const zone = { cx: MAP_SIZE / 2, cy: MAP_SIZE / 2, r: ZONE_R0, fx: 0, fy: 0, fr: 0, tx: 0, ty: 0, tr: 0, i: 0, t: ZONE[0][0], shrinking: false };
  const hist = [];   // hist[tick % HISTORY] = Map(id -> [x, y])

  // Teams: humans first (together if teamUp), then bots fill every team to full size
  const teamCount = new Array(nTeams + 1).fill(0);
  const names = BOT_NAMES.slice().sort(() => rnd() - 0.5);
  function addPlayer(name, team, prof) {
    const p = {
      id: players.length + 1, name, team, bot: !!prof, diff: prof ? prof.key : null, ai: prof ? newAI(prof) : null,
      x: 0, y: 0, aim: 0, hp: HP_MAX, shield: 0, wood: 0, slots: [{ w: 'axe', mag: 0 }, null, null], cur: 0,
      heals: { bandage: 0, medkit: 0, shield: 0 }, fireCd: 0, reloadT: 0, healT: 0, healKind: null, buildCd: 0,
      alive: true, landed: false, kills: 0, dmg: 0, place: 0, land: null, inputs: [], ack: 0, lastShot: -9, killer: 0,
    };
    players.push(p); byId.set(p.id, p); teamCount[team]++;
    return p;
  }
  humans.slice(0, MAX_PLAYERS).forEach((h, i) => {
    let team = cfg.teamUp ? Math.floor(i / size) + 1 : i + 1;
    if (team > nTeams) team = (i % nTeams) + 1;
    addPlayer(String(h.name || 'Player').slice(0, 16), team, null);
  });
  for (let t = 1; t <= nTeams; t++) while (teamCount[t] < size) {
    let key = cfg.diff;
    if (key === 'mixed') {
      const wts = cfg.mix || MIXED_WEIGHTS;
      let x = rnd() * wts.reduce((a, b) => a + b, 0);
      key = DIFFS[wts.findIndex(w => (x -= w) < 0)] || 'medium';
    }
    addPlayer(names[players.length % names.length], t, { ...BOT[key], key });
  }

  const ev = e => { events.push(e); return e; };
  const wev = e => { applyEvent(W, e); events.push(e); };
  const time = () => tick * DT;
  const teamAlive = t => players.some(p => p.team === t && p.alive);
  const teamsLeft = () => new Set(players.filter(p => p.alive).map(p => p.team)).size;

  // ── Loot ──
  function dropLoot(k, x, y, n) {
    // find a clear spot near (x, y) so loot never ends up inside a rock
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : 14 + i * 6;
      const lx = clamp(x + Math.cos(a) * d, 20, MAP_SIZE - 20), ly = clamp(y + Math.sin(a) * d, 20, MAP_SIZE - 20);
      if (!solidAt(W, lx, ly, 10) || i === 11) { wev({ e: 'l+', id: W.nextId++, k, x: Math.round(lx), y: Math.round(ly), n }); return; }
    }
  }
  function pickupWeapon(p, it, slotPref) {
    let s = !p.slots[1] ? 1 : !p.slots[2] ? 2 : -1;
    if (s < 0) s = slotPref === 1 || slotPref === 2 ? slotPref : p.cur > 0 ? p.cur : 1;
    const old = p.slots[s];
    p.slots[s] = { w: it.k, mag: it.n };
    wev({ e: 'l-', id: it.id });
    if (old) dropLoot(old.w, p.x, p.y, old.mag);
    p.cur = s; p.reloadT = 0; p.fireCd = Math.max(p.fireCd, 0.3);
  }
  function autoPickup(p) {
    for (const it of W.loot.values()) {
      if ((it.x - p.x) ** 2 + (it.y - p.y) ** 2 > PICKUP_R * PICKUP_R) continue;
      if (it.k === 'wood') {
        const take = Math.min(it.n, WOOD_MAX - p.wood);
        if (take <= 0) continue;
        p.wood += take;
        wev({ e: 'l-', id: it.id });
        if (take < it.n) dropLoot('wood', it.x, it.y, it.n - take);
      } else if (HEALS[it.k]) {
        const take = Math.min(it.n, HEALS[it.k].max - p.heals[it.k]);
        if (take <= 0) continue;
        p.heals[it.k] += take;
        wev({ e: 'l-', id: it.id });
        if (take < it.n) dropLoot(it.k, it.x, it.y, it.n - take);
      }
    }
  }
  function nearestWeaponLoot(p) {
    let best = null, bd = PICKUP_R * PICKUP_R;
    for (const it of W.loot.values()) {
      if (!WEAPONS[it.k]) continue;
      const d = (it.x - p.x) ** 2 + (it.y - p.y) ** 2;
      if (d <= bd) { bd = d; best = it; }
    }
    return best;
  }

  // ── Damage ──
  function damage(v, amount, att, wid) {
    if (!v.alive || phase !== 'play') return;
    let left = amount, sh = 0;
    if (att && v.shield > 0) { sh = Math.min(v.shield, left); v.shield -= sh; left -= sh; }
    v.hp -= left;
    v.lastHit = time();
    if (att) {
      att.dmg += amount;
      ev({ e: 'd', p: v.id, by: att.id, n: Math.round(amount), s: sh > 0 ? 1 : 0 });
      if (v.ai) v.ai.hit = { t: time(), by: att.id };
    }
    if (v.hp <= 0.001) kill(v, att, wid);
  }
  function kill(v, att, wid) {
    v.alive = false; v.hp = 0; v.shield = 0; v.healT = 0; v.reloadT = 0; v.killer = att ? att.id : 0;
    if (att && att !== v) att.kills++;
    ev({ e: 'k', k: att ? att.id : 0, v: v.id, w: wid });
    for (const s of v.slots.slice(1)) if (s) dropLoot(s.w, v.x, v.y, s.mag);
    for (const h of HEAL_IDS) if (v.heals[h]) dropLoot(h, v.x, v.y, v.heals[h]);
    if (v.wood >= 10) dropLoot('wood', v.x, v.y, v.wood);
    v.heals = { bandage: 0, medkit: 0, shield: 0 }; v.wood = 0;
    if (!teamAlive(v.team)) {
      const place = teamsLeft() + 1;
      for (const p of players) if (p.team === v.team) p.place = place;
      ev({ e: 'te', team: v.team, place });
    }
    if (teamsLeft() <= 1 && phase === 'play') {
      const last = players.find(p => p.alive);
      winner = last ? last.team : v.team;
      for (const p of players) if (p.team === winner) p.place = 1;
      phase = 'over';
      ev({ e: 'end', team: winner });
      if (hooks.end) hooks.end(winner);
    }
  }
  function damageBar(b, n) {
    const hp = Math.round(b.hp - n);
    if (hp <= 0) wev({ e: 'b-', id: b.id }); else wev({ e: 'bh', id: b.id, hp });
  }

  // ── Actions ──
  function lagPos(q, vt) {
    if (vt == null) return q;
    vt = clamp(vt, tick - HISTORY + 1, tick);
    const a = hist[Math.floor(vt) % HISTORY], b = hist[Math.ceil(vt) % HISTORY];
    const pa = a && a.k === Math.floor(vt) && a.m.get(q.id), pb = b && b.k === Math.ceil(vt) && b.m.get(q.id);
    if (!pa || !pb) return q;
    const f = vt - Math.floor(vt);
    return { x: pa[0] + (pb[0] - pa[0]) * f, y: pa[1] + (pb[1] - pa[1]) * f };
  }
  function fireGun(p, moving, vt) {
    const s = p.slots[p.cur], W8 = WEAPONS[s.w];
    s.mag--; p.fireCd = 1 / W8.rate; p.lastShot = time();
    const spr = W8.spread * (p.ai ? p.ai.prof.spreadMul : 1) * (moving ? 1.35 : 1);
    const pts = [], dealt = new Map();
    for (let k = 0; k < W8.pellets; k++) {
      const a = W8.pellets > 1
        ? p.aim + ((k / (W8.pellets - 1)) - 0.5) * 1.6 * spr + (rnd() - 0.5) * 0.4 * spr
        : p.aim + (rnd() - 0.5) * 2 * spr;
      const dx = Math.cos(a), dy = Math.sin(a);
      const w = raycast(W, p.x, p.y, dx, dy, W8.range);
      let bt = w.t, victim = null;
      for (const q of players) {
        if (!q.alive || !q.landed || q.team === p.team) continue;
        const pos = p.ai ? q : lagPos(q, vt);
        const t = rayCircle(p.x, p.y, dx, dy, pos.x, pos.y, PLAYER_R + 1);
        if (t >= 0 && t < bt) { bt = t; victim = q; }
      }
      pts.push(Math.round(p.x + dx * bt), Math.round(p.y + dy * bt));
      if (victim) dealt.set(victim, (dealt.get(victim) || 0) + W8.dmg * (W8.falloff ? Math.max(0.35, 1 - bt / W8.range * 0.75) : 1));
      else if (w.o && w.o.tm !== undefined && W.bars.has(w.o.id)) damageBar(w.o, W8.dmg);
    }
    ev({ e: 's', p: p.id, w: WEAPON_IDS.indexOf(s.w), x: Math.round(p.x), y: Math.round(p.y), pts, h: dealt.size ? 1 : 0 });
    for (const [v, n] of dealt) damage(v, n, p, s.w);
    // Nearby bots hear it; each decides once whether to go and look
    for (const b of players) {
      if (!b.ai || !b.alive || b === p || b.team === p.team || (b.x - p.x) ** 2 + (b.y - p.y) ** 2 > 650 * 650) continue;
      if (b.ai.sound && time() - b.ai.sound.t < 4) continue;
      if (rnd() < b.ai.prof.investigate) b.ai.sound = { x: p.x, y: p.y, t: time() };
    }
    if (s.mag <= 0) p.reloadT = W8.reload;
  }
  function swing(p) {
    const A = WEAPONS.axe;
    p.fireCd = 1 / A.rate;
    const hx = p.x + Math.cos(p.aim) * (PLAYER_R + 18), hy = p.y + Math.sin(p.aim) * (PLAYER_R + 18);
    ev({ e: 'm', p: p.id, a: r1(p.aim) });
    for (const q of players) {
      if (!q.alive || !q.landed || q.team === p.team) continue;
      if ((q.x - hx) ** 2 + (q.y - hy) ** 2 < (PLAYER_R + A.reach) ** 2) { damage(q, A.dmg, p, 'axe'); return; }
    }
    let tree = null;
    cellsAround(W, hx - 60, hy - 60, hx + 60, hy + 60, o => {
      if (!tree && o.k === 2 && (o.x - hx) ** 2 + (o.y - hy) ** 2 < (o.r + A.reach) ** 2) tree = o;
    });
    if (tree) {
      wev({ e: 'tr', id: tree.id, hp: tree.hp - 1 });
      p.wood = Math.min(WOOD_MAX, p.wood + WOOD_PER_CHOP);
      return;
    }
    for (const b of W.bars.values()) {
      const [cx, cy] = barClosest(b, hx, hy);
      if ((cx - hx) ** 2 + (cy - hy) ** 2 < (BAR.half + A.reach) ** 2) { damageBar(b, A.barDmg); return; }
    }
  }
  function build(p) {
    if (p.wood < BAR.cost || p.buildCd > 0) return false;
    const x = p.x + Math.cos(p.aim) * BAR.dist, y = p.y + Math.sin(p.aim) * BAR.dist;
    const b = { x, y, a: p.aim + Math.PI / 2 };
    if (x < 10 || y < 10 || x > MAP_SIZE - 10 || y > MAP_SIZE - 10) return false;
    for (const q of players) {
      if (!q.alive || !q.landed) continue;
      const [cx, cy] = barClosest(b, q.x, q.y);
      if ((cx - q.x) ** 2 + (cy - q.y) ** 2 < (PLAYER_R + BAR.half + 1) ** 2) return false;
    }
    if (W.bars.size >= BAR.max) wev({ e: 'b-', id: W.bars.keys().next().value });   // oldest goes first
    p.wood -= BAR.cost; p.buildCd = BAR.cooldown;
    wev({ e: 'b+', id: W.nextId++, x: r1(x), y: r1(y), a: Math.round(b.a * 1000) / 1000, hp: BAR.hp, tm: p.team });
    return true;
  }
  function startHeal(p, kind) {
    if (p.healT > 0) return;
    if (kind === 'heal') kind = p.hp < HEALS.bandage.cap && p.heals.bandage ? 'bandage' : p.hp < HP_MAX && p.heals.medkit ? 'medkit' : null;
    if (!kind || !HEALS[kind] || !p.heals[kind]) return;
    if (kind === 'shield' ? p.shield >= SHIELD_MAX : p.hp >= HEALS[kind].cap) return;
    p.healKind = kind; p.healT = HEALS[kind].time; p.reloadT = 0;
  }

  // One frame of controls: { s: seq, mx, my, a: aim, f: fire held, vt: view tick,
  // b: build, e: pick up, es: slot to replace, r: reload, sl: slot, h: 'heal'|'shield' }
  function applyInput(p, inp) {
    if (typeof inp.a === 'number' && isFinite(inp.a)) p.aim = inp.a;
    if (Number.isInteger(inp.sl) && inp.sl >= 0 && inp.sl <= 2 && p.slots[inp.sl] && inp.sl !== p.cur) {
      p.cur = inp.sl; p.reloadT = 0; p.healT = 0; p.fireCd = Math.max(p.fireCd, 0.25);
    }
    const w = p.slots[p.cur], W8 = WEAPONS[w.w];
    if (inp.r && !W8.melee && w.mag < W8.mag && p.reloadT <= 0) { p.reloadT = W8.reload; p.healT = 0; }
    if (inp.h) startHeal(p, inp.h);
    if (inp.b) build(p);
    if (inp.e) { const it = nearestWeaponLoot(p); if (it) pickupWeapon(p, it, inp.es); }
    // Shoot before walking: the aim was taken from where the player stood when they pressed fire
    const mx = clamp(+inp.mx || 0, -1, 1), my = clamp(+inp.my || 0, -1, 1);
    if (inp.f && p.fireCd <= 0) {
      const s = p.slots[p.cur], S8 = WEAPONS[s.w];
      if (S8.melee) { p.healT = 0; swing(p); }
      else if (p.reloadT <= 0) {
        if (s.mag > 0) { p.healT = 0; fireGun(p, mx || my, inp.vt); }
        else p.reloadT = S8.reload;
      }
    }
    if (p.alive) move(W, p, mx, my, speedMul(p.healT > 0, p.slots[p.cur].w));
  }

  // ── Zone ──
  function nextZoneTarget() {
    const ph = ZONE[Math.min(zone.i, ZONE.length - 1)];
    zone.tr = ph[2] * ZONE_R0;
    const room = Math.max(0, zone.r - zone.tr);
    for (let i = 0; i < 30; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * room;
      const x = zone.cx + Math.cos(a) * d, y = zone.cy + Math.sin(a) * d;
      const m = Math.min(zone.tr, MAP_SIZE * 0.3);
      if (x > m && y > m && x < MAP_SIZE - m && y < MAP_SIZE - m || i === 29) { zone.tx = clamp(x, 100, MAP_SIZE - 100); zone.ty = clamp(y, 100, MAP_SIZE - 100); break; }
    }
  }
  function stepZone() {
    zone.t -= DT;
    if (zone.shrinking) {
      const dur = ZONE[zone.i][1], f = clamp(1 - zone.t / dur, 0, 1);
      zone.cx = zone.fx + (zone.tx - zone.fx) * f; zone.cy = zone.fy + (zone.ty - zone.fy) * f; zone.r = zone.fr + (zone.tr - zone.fr) * f;
      if (zone.t <= 0 && zone.i < ZONE.length - 1) {
        zone.i++; zone.shrinking = false; zone.t = ZONE[zone.i][0]; nextZoneTarget();
        ev({ e: 'z', n: 'next' });
      } else if (zone.t <= 0) zone.t = 0;
    } else if (zone.t <= 0) {
      zone.shrinking = true; zone.t = ZONE[zone.i][1]; zone.fx = zone.cx; zone.fy = zone.cy; zone.fr = zone.r;
      ev({ e: 'z', n: 'shrink' });
    }
    const dps = ZONE[zone.i][3] + (zone.i === ZONE.length - 1 && zone.shrinking && zone.t <= 0 ? 10 : 0);
    for (const p of players) {
      if (!p.alive || !p.landed) continue;
      if ((p.x - zone.cx) ** 2 + (p.y - zone.cy) ** 2 > zone.r * zone.r) {
        p.hp -= dps * DT;
        if (p.hp <= 0.001) kill(p, null, 'zone');
        if (phase !== 'play') return;
      }
    }
  }
  const inZone = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;

  // ── Landing ──
  function freeSpot(x, y) {
    for (let i = 0; i < 200; i++) {
      const a = i * 2.4, d = i * 6;
      const sx = clamp(x + Math.cos(a) * d, 40, MAP_SIZE - 40), sy = clamp(y + Math.sin(a) * d, 40, MAP_SIZE - 40);
      if (!solidAt(W, sx, sy, PLAYER_R + 2)) return [sx, sy];
    }
    return [MAP_SIZE / 2, MAP_SIZE / 2];
  }
  function land() {
    // Bot teams land spread out: best of several random spots, as far as possible from the others
    const anchors = players.filter(p => !p.bot && p.land).map(p => p.land);
    const spot = () => {
      let best = null, bd = -1;
      for (let i = 0; i < 16; i++) {
        const c = [200 + rnd() * (MAP_SIZE - 400), 200 + rnd() * (MAP_SIZE - 400)];
        const d = anchors.reduce((m, a) => Math.min(m, Math.hypot(a[0] - c[0], a[1] - c[1])), Infinity);
        if (d > bd) { bd = d; best = c; }
      }
      anchors.push(best);
      return best;
    };
    for (let t = 1; t <= nTeams; t++) {
      const team = players.filter(p => p.team === t);
      const lead = team.find(p => !p.bot && p.land);
      const anchor = lead ? lead.land : spot();
      for (const p of team) {
        const want = !p.bot && p.land ? p.land : [anchor[0] + (rnd() - 0.5) * 160, anchor[1] + (rnd() - 0.5) * 160];
        [p.x, p.y] = freeSpot(want[0], want[1]);
        p.landed = true; p.aim = rnd() * Math.PI * 2;
        if (p.ai) p.ai.calmUntil = time() + 6 + rnd() * 8;   // loot first, like a person who just landed
      }
    }
    phase = 'play';
    nextZoneTarget();
    ev({ e: 'land' });
  }

  // ──────────── Bots ────────────
  function newAI(prof) {
    return {
      prof, seen: new Map(), target: 0, goal: null, goalT: 0, aimOff: 0, aimOffT: 0, strafe: 0, strafeT: 0,
      stuckT: 0, stuckDir: 0, chkX: 0, chkY: 0, chkT: 0, burstT: 0, burstOn: true, hit: null, buildT: 0, swapT: 0,
      side: 1, sideT: 0, sound: null, item: null, itemT: 0, ignore: new Set(), tree: null, zoneEarly: false, zonePhase: -1, decideT: 0, calmUntil: 0,
    };
  }
  // 0 = clear line of sight, 1 = blocked by a barricade (returned too), 2 = blocked by something else
  function sight(p, q) {
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
    const w = raycast(W, p.x, p.y, dx / d, dy / d, d);
    if (!w.o || w.t >= d - PLAYER_R) return { v: 0, d };
    return { v: w.o.tm !== undefined ? 1 : 2, d, bar: w.o };
  }
  function canSee(p, q, d) {
    if (inBush(W, q.x, q.y) && d > 140 && time() - q.lastShot > 1.2) return false;
    return sight(p, q).v === 0;
  }
  function gunScore(w, d) {
    if (!w || WEAPONS[w.w].melee) return 0;
    const W8 = WEAPONS[w.w];
    if (d > W8.range * 0.95) return 0.5;
    const fit = 1 - Math.min(1, Math.abs(d - W8.keep) / 500);
    return W8.rank + fit * 3 + (w.mag > 0 ? 2 : 0);
  }
  // Which slot a bot would put this gun in, or -1 if it doesn't want it
  function wantsWeapon(p, k) {
    const [a, b] = [p.slots[1], p.slots[2]];
    if ((a && a.w === k) || (b && b.w === k)) return -1;
    if (!a) return 1;
    if (!b) return 2;
    const worst = WEAPONS[a.w].rank <= WEAPONS[b.w].rank ? 1 : 2;
    return WEAPONS[k].rank > WEAPONS[p.slots[worst].w].rank ? worst : -1;
  }
  function steer(p, ai, dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return [0, 0];
    dx /= len; dy /= len;
    if (ai.stuckT > 0) { ai.stuckT -= DT; return [Math.cos(ai.stuckDir), Math.sin(ai.stuckDir)]; }
    const base = Math.atan2(dy, dx);
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5]) {
      const a = base + off * ai.side;
      if (!solidAt(W, p.x + Math.cos(a) * 26, p.y + Math.sin(a) * 26, PLAYER_R - 3)) {
        if (off !== 0) ai.sideT = time() + 0.6;
        return [Math.cos(a), Math.sin(a)];
      }
    }
    return [dx, dy];
  }
  // The teammate a bot sticks with: a human if there is one, otherwise the first bot
  function teamLead(p) {
    let lead = null;
    for (const q of players) {
      if (q.team !== p.team || !q.alive || q === p) continue;
      if (!q.bot) { if (!lead || lead.bot) lead = q; }
      else if (q.id < p.id && !lead) lead = q;
    }
    return lead;
  }

  function think(p) {
    const ai = p.ai, prof = ai.prof, now = time();
    const inp = { mx: 0, my: 0, a: p.aim, f: false };
    if (ai.sideT < now && rnd() < 0.02) ai.side = -ai.side;
    // Who can I see? Checked five times a second, at a different moment for each bot.
    if (now >= ai.decideT) {
      ai.decideT = now + 0.2;
      for (const q of players) {
        if (!q.alive || !q.landed || q.team === p.team) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        const e = ai.seen.get(q.id);
        if (d <= prof.view && canSee(p, q, d)) {
          if (!e || now - e.last > 0.5) ai.seen.set(q.id, { first: now, last: now, x: q.x, y: q.y });
          else { e.last = now; e.x = q.x; e.y = q.y; }
        } else if (e && now - e.last > 4) ai.seen.delete(q.id);
      }
      let best = 0, bd = Infinity;
      for (const [id, e] of ai.seen) {
        const q = byId.get(id);
        if (!q.alive) { ai.seen.delete(id); continue; }
        if (now - e.last > 0.3) continue;
        let d = Math.hypot(q.x - p.x, q.y - p.y);
        const attacked = ai.hit && ai.hit.by === id && now - ai.hit.t < 2;
        if (now < ai.calmUntil && !attacked && d > 150) continue;   // still looting after landing
        if (attacked) d *= 0.5;   // fight back against whoever is shooting
        if (d < bd) { bd = d; best = id; }
      }
      ai.target = best;
      if (zone.i !== ai.zonePhase) { ai.zonePhase = zone.i; ai.zoneEarly = rnd() < prof.zoneLead; }
    }
    const T = ai.target ? byId.get(ai.target) : null;
    const seenT = T && ai.seen.get(T.id);
    const gun = p.slots[p.cur], W8 = WEAPONS[gun.w];
    let mvx = 0, mvy = 0, want = null;   // want: angle to aim at

    // Barricade when shot at
    if (ai.hit && now - ai.hit.t < 0.6 && now >= ai.buildT && p.wood >= BAR.cost) {
      ai.buildT = now + 1.3;
      const att = byId.get(ai.hit.by);
      if (att && att.alive && rnd() < prof.build) {
        const s = sight(p, att);
        if (s.v === 0 || s.d < 120) { inp.b = 1; inp.a = Math.atan2(att.y - p.y, att.x - p.x); p.aim = inp.a; ai.hit = null; return inp; }
      }
      ai.hit = null;
    }

    const hasGun = p.slots[1] || p.slots[2];
    if (T && seenT) {
      const dx = T.x - p.x, dy = T.y - p.y, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
      // Pick the right gun for the range
      if (now >= ai.swapT) {
        let bestS = p.cur, bs = gunScore(gun, d);
        for (let s = 1; s <= 2; s++) { const sc = gunScore(p.slots[s], d); if (sc > bs + (prof.swap ? 0.5 : 2.5)) { bs = sc; bestS = s; } }
        if (!hasGun) bestS = 0;
        if (bestS !== p.cur) { inp.sl = bestS; ai.swapT = now + (prof.swap ? 0.6 : 2); }
      }
      if (!hasGun) {
        // Only an axe: fight back if they're on top of me or hitting me, otherwise go and find a gun
        const attacked = ai.hit && ai.hit.by === T.id && now - ai.hit.t < 2;
        if (d < 70 || (attacked && d < 160)) { mvx = ux; mvy = uy; }
        else {
          let it = null, bd = 500 * 500;
          for (const l of W.loot.values()) if (WEAPONS[l.k]) { const dd = (l.x - p.x) ** 2 + (l.y - p.y) ** 2; if (dd < bd) { bd = dd; it = l; } }
          if (it) { mvx = it.x - p.x; mvy = it.y - p.y; if (bd < (PICKUP_R - 8) ** 2) { inp.e = 1; inp.es = 1; } }
          else { mvx = -ux; mvy = -uy; }
        }
      } else {
        const keep = W8.melee ? 40 : W8.keep;
        if (d > keep + 70) { mvx += ux; mvy += uy; } else if (d < keep - 70) { mvx -= ux; mvy -= uy; }
        if (ai.strafeT <= now) { ai.strafeT = now + 0.35 + rnd() * 0.8; ai.strafe = rnd() < prof.strafe ? (rnd() < 0.5 ? -1 : 1) : 0; }
        mvx += -uy * ai.strafe; mvy += ux * ai.strafe;
      }
      if (now >= ai.aimOffT) { ai.aimOffT = now + 0.35; ai.aimOff = gauss() * prof.aimErr; }
      want = Math.atan2(dy, dx) + ai.aimOff;
      const ready = now - seenT.first >= prof.react;
      if (prof.burst) { if (now >= ai.burstT) { ai.burstOn = !ai.burstOn; ai.burstT = now + prof.burst[ai.burstOn ? 0 : 1] * (0.6 + rnd() * 0.8); } }
      const range = W8.melee ? PLAYER_R * 2 + WEAPONS.axe.reach + 4 : W8.range * 0.95;
      if (ready && d <= range && (!prof.burst || ai.burstOn) && Math.abs(angDiff(p.aim, want)) < (W8.pellets > 1 ? 0.25 : 0.12)) {
        // Still in the open right now? (sight is only rechecked 5 times a second.) Good bots
        // shoot through an enemy barricade; others hold fire.
        const s = sight(p, T);
        inp.f = s.v === 0 || (s.v === 1 && s.bar.tm !== p.team && rnd() < prof.shootBars);
        if (s.v === 2) seenT.last = now - 0.31;
      }
      if (!W8.melee && gun.mag <= 0) { inp.f = false; if (p.reloadT <= 0) inp.r = 1; }
    } else {
      // Nobody in sight. Priorities: storm, healing, loot, wood, hunting, wandering.
      const last = [...ai.seen.values()].sort((a, b) => b.last - a.last)[0];
      const outNow = !inZone(p.x, p.y, zone.cx, zone.cy, zone.r - 40);
      const outNext = !inZone(p.x, p.y, zone.tx, zone.ty, Math.max(60, zone.tr - 60));
      const lead = teamLead(p);
      if (gun.mag < (WEAPONS[gun.w].mag || 0) && !W8.melee && p.reloadT <= 0 && p.healT <= 0) inp.r = 1;
      if (outNow || (outNext && (zone.shrinking || ai.zoneEarly))) {
        const tx = outNow && !zone.shrinking ? zone.cx : zone.tx, ty = outNow && !zone.shrinking ? zone.cy : zone.ty;
        mvx = tx - p.x; mvy = ty - p.y;
        if (outNow && p.hp < prof.healAt && p.heals.medkit + p.heals.bandage > 0 && zone.i < 2) inp.h = 'heal';
      } else if (p.healT > 0) {
        // keep still while healing
      } else if (p.hp < prof.healAt && (p.heals.bandage && p.hp < HEALS.bandage.cap || p.heals.medkit)) {
        inp.h = 'heal';
      } else if (p.shield < 60 && p.heals.shield) {
        inp.h = 'shield';
      } else {
        // Loot I can see that I want
        if (!ai.item || !W.loot.has(ai.item.id) || now > ai.itemT) {
          if (ai.item && now > ai.itemT) ai.ignore.add(ai.item.id);
          ai.item = null;
          let bd = (prof.view * 0.8) ** 2;
          for (const it of W.loot.values()) {
            if (ai.ignore.has(it.id)) continue;
            const d = (it.x - p.x) ** 2 + (it.y - p.y) ** 2;
            if (d > bd) continue;
            const ok = WEAPONS[it.k] ? wantsWeapon(p, it.k) >= 0 : it.k === 'wood' ? p.wood < WOOD_MAX - 20 : p.heals[it.k] < HEALS[it.k].max;
            if (ok && inZone(it.x, it.y, zone.cx, zone.cy, zone.r)) { bd = d; ai.item = it; }
          }
          if (ai.item) ai.itemT = now + 7;
        }
        if (ai.item) {
          const it = ai.item, d = Math.hypot(it.x - p.x, it.y - p.y);
          mvx = it.x - p.x; mvy = it.y - p.y;
          if (WEAPONS[it.k] && d < PICKUP_R - 8) {
            const slot = wantsWeapon(p, it.k);
            if (slot >= 0) { inp.e = 1; inp.es = slot; } else ai.ignore.add(it.id);
            ai.item = null;
          }
        } else if (p.wood < prof.chopTo) {
          if (!ai.tree || ai.tree.hp <= 0) {
            ai.tree = null;
            let bd = 600 * 600;
            for (const t of W.trees) {
              if (t.hp <= 0) continue;
              const d = (t.x - p.x) ** 2 + (t.y - p.y) ** 2;
              if (d < bd && inZone(t.x, t.y, zone.cx, zone.cy, zone.r - 80)) { bd = d; ai.tree = t; }
            }
          }
          if (ai.tree) {
            const t = ai.tree, d = Math.hypot(t.x - p.x, t.y - p.y);
            if (d - t.r < PLAYER_R + 16) {
              if (p.cur !== 0) inp.sl = 0;
              want = Math.atan2(t.y - p.y, t.x - p.x);
              if (Math.abs(angDiff(p.aim, want)) < 0.3) inp.f = true;
            } else { mvx = t.x - p.x; mvy = t.y - p.y; }
          }
        } else if (last && now - last.last < 2.5 && prof.investigate > 0.5) {
          mvx = last.x - p.x; mvy = last.y - p.y;
          if (mvx * mvx + mvy * mvy < 40 * 40) last.last = -99;
        } else if (ai.sound && now - ai.sound.t < 4) {
          mvx = ai.sound.x - p.x; mvy = ai.sound.y - p.y;
          if (mvx * mvx + mvy * mvy < 80 * 80) ai.sound = null;
        } else if (lead && (lead.x - p.x) ** 2 + (lead.y - p.y) ** 2 > 260 * 260) {
          mvx = lead.x - p.x; mvy = lead.y - p.y;
        } else {
          // Drift around nearby, staying inside the next zone
          if (!ai.goal || now > ai.goalT || (ai.goal[0] - p.x) ** 2 + (ai.goal[1] - p.y) ** 2 < 50 * 50) {
            for (let i = 0; i < 8; i++) {
              const a = rnd() * Math.PI * 2, d = 120 + rnd() * 280;
              ai.goal = [clamp(p.x + Math.cos(a) * d, 60, MAP_SIZE - 60), clamp(p.y + Math.sin(a) * d, 60, MAP_SIZE - 60)];
              if (inZone(ai.goal[0], ai.goal[1], zone.tx, zone.ty, Math.max(80, zone.tr - 40))) break;
            }
            ai.goalT = now + 5 + rnd() * 6;
          }
          mvx = ai.goal[0] - p.x; mvy = ai.goal[1] - p.y;
          if (rnd() < 0.3 && now - ai.goalT > -2) { mvx = 0; mvy = 0; }   // and sometimes just hold a spot
        }
        // Holding the axe out of a fight: switch to a gun
        if (p.cur === 0 && hasGun && !ai.tree) inp.sl = p.slots[1] ? 1 : 2;
        if (ai.tree && (p.wood >= prof.chopTo || ai.item)) ai.tree = null;
      }
      // Shoot an enemy's barricade if I last saw them behind it
      if (last && now - last.last < 3 && prof.shootBars > 0 && !W8.melee && gun.mag > 0) {
        const q = [...ai.seen.entries()].find(([, e]) => e === last);
        const tq = q && byId.get(q[0]);
        if (tq && tq.alive && Math.hypot(tq.x - p.x, tq.y - p.y) < W8.range * 0.9) {
          const s = sight(p, tq);
          if (s.v === 1 && s.bar.tm !== p.team && rnd() < prof.shootBars) { want = Math.atan2(tq.y - p.y, tq.x - p.x); inp.f = Math.abs(angDiff(p.aim, want)) < 0.15; }
        }
      }
      // Turned toward someone shooting at me that I can't see yet
      if (!want && ai.hit && now - ai.hit.t < 1.5 && prof.key !== 'easy') {
        const att = byId.get(ai.hit.by);
        if (att) want = Math.atan2(att.y - p.y, att.x - p.x);
      }
    }
    // Stuck on something? Walk off in a random direction for a moment.
    if (now >= ai.chkT) {
      if ((mvx || mvy) && Math.hypot(p.x - ai.chkX, p.y - ai.chkY) < 14) { ai.stuckT = 0.5 + rnd() * 0.5; ai.stuckDir = rnd() * Math.PI * 2; }
      ai.chkX = p.x; ai.chkY = p.y; ai.chkT = now + 0.8;
    }
    [inp.mx, inp.my] = steer(p, ai, mvx, mvy);
    if (want === null && (inp.mx || inp.my)) want = Math.atan2(inp.my, inp.mx);
    if (want !== null) {
      const d = angDiff(p.aim, want), mx = prof.turn * DT;
      p.aim += Math.abs(d) <= mx ? d : Math.sign(d) * mx;
    }
    inp.a = p.aim;
    return inp;
  }

  // ──────────── Tick ────────────
  function step() {
    tick++;
    if (phase === 'drop') {
      for (const p of players) {
        for (const inp of p.inputs) { if (inp.drop) setLand(p, inp.drop); p.ack = inp.s | 0; }
        p.inputs.length = 0;
      }
      if (--dropLeft <= 0) land();
    } else if (phase === 'play' || phase === 'over') {
      for (const p of players) {
        if (!p.alive) { p.inputs.length = 0; continue; }
        p.fireCd -= DT; p.buildCd -= DT;
        if (p.bot) { if (phase === 'play') applyInput(p, think(p)); }
        else {
          // Humans: one queued input a tick (two when we're behind, so lag doesn't build up). A late
          // input is applied late rather than guessed, so the browser's prediction stays exact.
          let n = p.inputs.length > 3 ? 2 : 1;
          while (n-- > 0 && p.inputs.length) {
            const inp = p.inputs.shift();
            p.ack = inp.s | 0;
            applyInput(p, inp);
          }
        }
        if (!p.alive) continue;
        if (p.reloadT > 0 && (p.reloadT -= DT) <= 0) { const s = p.slots[p.cur]; if (WEAPONS[s.w].mag) s.mag = WEAPONS[s.w].mag; p.reloadT = 0; }
        if (p.healT > 0 && (p.healT -= DT) <= 0) {
          const h = HEALS[p.healKind];
          if (p.heals[p.healKind] > 0) {
            p.heals[p.healKind]--;
            if (h.shield) p.shield = Math.min(SHIELD_MAX, p.shield + h.shield);
            else p.hp = Math.max(p.hp, Math.min(h.cap, p.hp + h.hp));
          }
          p.healT = 0; p.healKind = null;
        }
        if (tick % 2 === 0) autoPickup(p);
      }
      if (phase === 'play') stepZone();
    }
    const m = new Map();
    for (const p of players) if (p.alive && p.landed) m.set(p.id, [p.x, p.y]);
    hist[tick % HISTORY] = { k: tick, m };
  }
  function setLand(p, d) {
    if (!Array.isArray(d)) return;
    const x = +d[0], y = +d[1];
    if (isFinite(x) && isFinite(y)) p.land = [clamp(x, 60, MAP_SIZE - 60), clamp(y, 60, MAP_SIZE - 60)];
  }

  // ──────────── What gets sent ────────────
  function snapshot() {
    const ps = [];
    for (const p of players) if (p.alive && p.landed) {
      ps.push([p.id, r1(p.x), r1(p.y), Math.round(p.aim * 100) / 100, Math.ceil(p.hp), Math.ceil(p.shield),
        WEAPON_IDS.indexOf(p.slots[p.cur].w), (p.healT > 0 ? 1 : 0) | (p.reloadT > 0 ? 2 : 0)]);
    }
    return {
      k: tick, ph: phase, dl: Math.ceil(dropLeft / TICK_RATE), al: players.filter(p => p.alive).length, tm: teamsLeft(),
      z: [Math.round(zone.cx), Math.round(zone.cy), Math.round(zone.r), Math.round(zone.tx), Math.round(zone.ty), Math.round(zone.tr), zone.i, r1(Math.max(0, zone.t)), zone.shrinking ? 1 : 0],
      p: ps, ev: events,
    };
  }
  function priv(id) {
    const p = byId.get(id);
    if (!p) return null;
    const W8 = WEAPONS[p.slots[p.cur].w];
    return {
      ack: p.ack, hp: Math.ceil(p.hp), sh: Math.ceil(p.shield), wd: p.wood, cur: p.cur,
      sl: p.slots.map(s => s ? [WEAPON_IDS.indexOf(s.w), s.mag] : null),
      hl: HEAL_IDS.map(h => p.heals[h]),
      rl: r1(Math.max(0, p.reloadT)), rlm: W8.reload || 0, ht: r1(Math.max(0, p.healT)), hk: p.healKind ? HEAL_IDS.indexOf(p.healKind) : -1,
      kl: p.kills, dm: Math.round(p.dmg), al: p.alive ? 1 : 0, pl: p.place, kb: p.killer, land: p.land, ld: p.landed ? 1 : 0,
    };
  }
  function flush() { const e = events; events = []; return e; }

  return {
    W, cfg, players, byId,
    get tick() { return tick; }, get phase() { return phase; }, get winner() { return winner; },
    roster: () => players.map(p => [p.id, p.name, p.team, p.bot ? DIFFS.indexOf(p.diff) : -1]),
    input(id, inp) {
      const p = byId.get(id);
      if (!p || !inp || typeof inp !== 'object') return;
      if (p.inputs.length < 20) p.inputs.push(inp);
    },
    step, snapshot, priv, flush, full: () => worldFull(W),
    // Hand a player over to a bot (used when someone leaves an online game for good)
    botify(id, key) { const p = byId.get(id); if (p && !p.bot) { p.bot = true; p.diff = key; p.ai = newAI({ ...BOT[key], key }); } },
  };
}

const api = {
  TICK_RATE, DT, TICK_MS, MAP_SIZE, MAX_PLAYERS, TEAM_SIZES, DIFFS, PLAYER_R, SPEED, HP_MAX, SHIELD_MAX, TREE_HP, WOOD_MAX, WOOD_PER_CHOP,
  BAR, DROP_SECS, PICKUP_R, ZONE, ZONE_R0, WEAPONS, WEAPON_IDS, HEALS, HEAL_IDS, BOT, HISTORY,
  genWorld, applyEvent, applyFull, worldFull, createGame, cleanCfg, move, speedMul, raycast, solidAt, inBush, barEnds, cellsAround,
  clamp, angDiff, esc, mulberry32,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.TimberfallCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

// Bombsite: the map "Dunehold" (an original layout), its collision boxes, ray casts and bot navigation.
// Two bomb sites (A top right, B top left), CT spawn between them, T spawn at the bottom, and three lanes:
// Long A, Mid (with Catwalk to A and Window to B) and the roofed B Tunnels.
// Units are metres. x runs left → right, z runs top (CT side) → bottom (T side), y is up.
// The map is drawn on a 32 × 32 grid of 4 m cells, then crates, door leaves and roofs are added as boxes.
(function () {
  'use strict';
  const CELL = 4, GW = 32, GH = 32, SIZE = CELL * GW;
  const WALL_H = 7;

  // ── Grid ── '#' wall · '.' floor · 'a' / 'b' plant zones · 't' / 's' T and CT spawn (buy zones)
  const grid = (() => {
    const g = Array.from({ length: GH }, () => Array(GW).fill('#'));
    const R = (c0, r0, c1, r1, ch) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = ch; };
    R(2, 2, 10, 9, '.'); R(4, 3, 8, 7, 'b');        // B site
    R(21, 2, 29, 9, '.'); R(23, 3, 27, 7, 'a');     // A site
    R(13, 1, 18, 4, 's');                           // CT spawn
    R(11, 2, 12, 4, '.'); R(19, 2, 20, 4, '.');     // CT → B, CT → A
    R(15, 5, 16, 24, '.');                          // Mid
    R(12, 20, 19, 23, '.');                         // T Mid
    R(11, 8, 14, 9, '.');                           // B Window (Mid → B)
    R(17, 11, 24, 12, '.'); R(22, 10, 24, 10, '.'); // Catwalk (Mid → A)
    R(28, 10, 29, 25, '.');                         // Long A
    R(2, 10, 3, 25, '.');                           // B Tunnels
    R(4, 21, 11, 22, '.');                          // Lower Tunnel (Tunnels → T Mid)
    R(10, 26, 21, 30, 't');                         // T spawn
    R(14, 24, 17, 25, '.');                         // T spawn → Mid
    R(2, 26, 9, 27, '.'); R(22, 26, 29, 27, '.');   // T spawn → Tunnels / Long
    R(15, 13, 15, 14, '#');                         // Mid Doors (only the right lane stays open)
    R(16, 19, 16, 19, '#');                         // breaks the straight line down Mid
    R(28, 18, 28, 18, '#');                         // Long Doors
    return g.map(r => r.join(''));
  })();
  const cellAt = (x, z) => {
    const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
    return c < 0 || r < 0 || c >= GW || r >= GH ? '#' : grid[r][c];
  };

  // ── Boxes ── { x0, y0, z0, x1, y1, z1, kind, thin, mat }
  const boxes = [];
  const addBox = (x0, y0, z0, x1, y1, z1, kind, extra) => { const b = { x0, y0, z0, x1, y1, z1, kind, ...(extra || {}) }; boxes.push(b); return b; };
  // Walls: greedy merge of the '#' cells into rectangles
  (() => {
    const used = grid.map(r => [...r].map(ch => ch !== '#'));
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      if (used[r][c]) continue;
      let w = 1; while (c + w < GW && !used[r][c + w]) w++;
      let h = 1;
      outer: while (r + h < GH) { for (let k = 0; k < w; k++) if (used[r + h][c + k]) break outer; h++; }
      for (let rr = r; rr < r + h; rr++) for (let k = 0; k < w; k++) used[rr][c + k] = true;
      const edge = c === 0 || r === 0 || c + w === GW || r + h === GH;
      addBox(c * CELL, 0, r * CELL, (c + w) * CELL, edge ? WALL_H + 3 : WALL_H, (r + h) * CELL, 'wall');
    }
  })();
  // Crates: centre x, z, width, depth, height, look
  const CRATES = [
    // A site
    [100, 20, 2.4, 2.4, 2.3, 'wood'], [102.6, 21.7, 1.4, 1.4, 1.15, 'wood'], [116, 30, 2.2, 2.2, 1.15, 'wood'], [117.2, 33.4, 2.2, 2.2, 2.3, 'metal'],
    [88, 14, 2, 2, 1.15, 'wood'], [92, 31, 2, 3, 1.15, 'metal'], [110, 12, 2.4, 1.6, 1.15, 'wood'],
    // B site
    [26, 20, 2.4, 2.4, 2.3, 'wood'], [23.4, 21.6, 1.4, 1.4, 1.15, 'wood'], [13, 32, 2.2, 2.2, 2.3, 'metal'], [16.2, 34.2, 1.6, 1.6, 1.15, 'wood'],
    [38, 28, 2, 2, 1.15, 'wood'], [12, 12, 2, 2, 1.15, 'wood'], [34, 12, 2.4, 1.6, 1.15, 'metal'],
    // Mid, T Mid, Catwalk
    [61.5, 30, 1.8, 1.8, 1.15, 'wood'], [56, 86, 2.2, 2.2, 2.3, 'wood'], [72, 90, 2, 2, 1.15, 'metal'], [84, 46.2, 1.8, 1.8, 1.15, 'wood'],
    // T spawn
    [50, 112, 2.2, 2.2, 1.15, 'wood'], [76, 118, 2.4, 2.4, 2.3, 'metal'], [64, 120, 2, 2, 1.15, 'wood'],
    // Long A, Tunnels
    [118, 58, 2, 2, 1.15, 'wood'], [114, 92, 2, 2, 2.3, 'metal'], [14.6, 66, 1.6, 1.6, 1.15, 'wood'],
  ];
  for (const [x, z, w, d, h, look] of CRATES) addBox(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, 'crate', { mat: look });
  // Door leaves (thin wood: bullets go through them, losing some damage)
  addBox(66, 0, 53.92, 68, 2.7, 54.08, 'door', { thin: true });    // Mid Doors
  addBox(118, 0, 73.92, 120, 2.7, 74.08, 'door', { thin: true });  // Long Doors
  // Roofs over the B Tunnels and the Lower Tunnel (dark, and grenades bounce off them)
  addBox(8, 3.7, 48, 16, 4.3, 100, 'roof');
  addBox(16, 3.7, 84, 48, 4.3, 92, 'roof');
  const solidBoxes = boxes;

  // ── Ray casts ── slab test against every box, plus the floor (y = 0)
  // Returns the nearest solid hit { t, box, nx, ny, nz } and (if wanted) the thin boxes passed on the way.
  function raycast(ox, oy, oz, dx, dy, dz, tmax, thinOut) {
    let best = tmax, hit = null;
    if (dy < 0) { const t = -oy / dy; if (t >= 0 && t < best) { best = t; hit = { t, box: null, nx: 0, ny: 1, nz: 0 }; } }
    const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      let t0 = (b.x0 - ox) * ix, t1 = (b.x1 - ox) * ix, ax = 0;
      if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
      let u0 = (b.y0 - oy) * iy, u1 = (b.y1 - oy) * iy;
      if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }
      if (u0 > t0) { t0 = u0; ax = 1; }
      if (u1 < t1) t1 = u1;
      if (t0 > t1) continue;
      let v0 = (b.z0 - oz) * iz, v1 = (b.z1 - oz) * iz;
      if (v0 > v1) { const s = v0; v0 = v1; v1 = s; }
      if (v0 > t0) { t0 = v0; ax = 2; }
      if (v1 < t1) t1 = v1;
      if (t0 > t1 || t1 < 0) continue;
      const te = Math.max(0, t0);
      if (te >= best) continue;
      if (b.thin && thinOut) { thinOut.push({ t: te, box: b }); continue; }
      if (b.thin && !thinOut && thinOut !== undefined) continue;
      best = te;
      hit = { t: te, box: b, nx: ax === 0 ? -Math.sign(dx) : 0, ny: ax === 1 ? -Math.sign(dy) : 0, nz: ax === 2 ? -Math.sign(dz) : 0 };
    }
    if (thinOut) { for (let i = thinOut.length - 1; i >= 0; i--) if (thinOut[i].t >= best) thinOut.splice(i, 1); thinOut.sort((a, b) => a.t - b.t); }
    return hit;
  }
  // Clear line between two points (door leaves block sight too)
  function los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return true;
    return !raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.02);
  }

  // ── Moving bodies ── an upright box (half width r, height h) sliding against the boxes, with step-up
  function overlaps(x, y, z, r, h, b) { return x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1 && y + h > b.y0 && y < b.y1; }
  function blocked(x, y, z, r, h) {
    for (let i = 0; i < boxes.length; i++) if (overlaps(x, y, z, r, h, boxes[i])) return boxes[i];
    return null;
  }
  // Moves p (with p.x, p.y, p.z) by dx, dy, dz. Returns { ground, hitX, hitZ, ceil }.
  function moveBody(p, dx, dy, dz, r, h, canStep) {
    const out = { ground: false, hitX: false, hitZ: false, ceil: false };
    const STEP = 0.5;
    const horiz = (axis, d) => {
      if (!d) return;
      const nx = axis === 0 ? p.x + d : p.x, nz = axis === 2 ? p.z + d : p.z;
      const b = blocked(nx, p.y, nz, r, h);
      if (!b) { p.x = nx; p.z = nz; return; }
      // Step up onto low things (stairs, small ledges)
      if (canStep && b.y1 - p.y <= STEP && !blocked(nx, b.y1 + 0.001, nz, r, h)) { p.x = nx; p.z = nz; p.y = b.y1 + 0.001; return; }
      if (axis === 0) { p.x = d > 0 ? b.x0 - r - 0.001 : b.x1 + r + 0.001; out.hitX = true; }
      else { p.z = d > 0 ? b.z0 - r - 0.001 : b.z1 + r + 0.001; out.hitZ = true; }
      // A second box could still overlap after the push; give up the move in that case
      if (blocked(p.x, p.y, p.z, r, h)) { if (axis === 0) p.x -= d; else p.z -= d; }
    };
    // Split long moves so nothing tunnels through thin door leaves
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.1));
    for (let i = 0; i < n; i++) { horiz(0, dx / n); horiz(2, dz / n); }
    const ny = p.y + dy;
    if (dy <= 0) {
      if (ny <= 0) { p.y = 0; out.ground = true; }
      else {
        const b = blocked(p.x, ny, p.z, r, h);
        if (b) { p.y = b.y1; out.ground = true; } else p.y = ny;
      }
    } else {
      const b = blocked(p.x, ny, p.z, r, h);
      if (b) { p.y = b.y0 - h - 0.001; out.ceil = true; } else p.y = ny;
    }
    // Standing on something? (checked a hair below the feet)
    if (!out.ground && dy <= 0 && (p.y <= 0.001 || blocked(p.x, p.y - 0.02, p.z, r, h))) out.ground = true;
    return out;
  }

  // ── Navigation ── 2 m cells, 8-way A*, string-pulled paths
  const NC = 2, NW = SIZE / NC, NH = SIZE / NC;
  const walk = new Uint8Array(NW * NH);
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const x = i * NC + NC / 2, z = j * NC + NC / 2;
    let ok = cellAt(x, z) !== '#';
    if (ok) for (const b of boxes) {
      if (b.y0 > 2) continue;
      const m = b.kind === 'door' ? 0.55 : 0.75;
      if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m) { ok = false; break; }
    }
    walk[j * NW + i] = ok ? 1 : 0;
  }
  const nIdx = (x, z) => { const i = Math.floor(x / NC), j = Math.floor(z / NC); return i < 0 || j < 0 || i >= NW || j >= NH ? -1 : j * NW + i; };
  const walkable = (x, z) => { const k = nIdx(x, z); return k >= 0 && walk[k] === 1; };
  const nodePos = k => ({ x: (k % NW) * NC + NC / 2, z: Math.floor(k / NW) * NC + NC / 2 });
  function nearestWalkable(x, z) {
    const k0 = nIdx(Math.max(0, Math.min(SIZE - 0.01, x)), Math.max(0, Math.min(SIZE - 0.01, z)));
    if (k0 >= 0 && walk[k0]) return k0;
    const seen = new Uint8Array(NW * NH), q = [k0]; seen[k0] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const k = q[qi];
      if (walk[k]) return k;
      const i = k % NW, j = (k - i) / NW;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= NW || jj >= NH) continue;
        const kk = jj * NW + ii;
        if (!seen[kk]) { seen[kk] = 1; q.push(kk); }
      }
    }
    return k0;
  }
  // Binary heap A*. cost(k) adds danger (fire) to a cell; returns world points or null.
  const gScore = new Float32Array(NW * NH), came = new Int32Array(NW * NH), stamp = new Uint32Array(NW * NH), closed = new Uint32Array(NW * NH);
  let gen = 0;
  function findPath(sx, sz, tx, tz, cost) {
    const s = nearestWalkable(sx, sz), t = nearestWalkable(tx, tz);
    if (s < 0 || t < 0) return null;
    gen++;
    const ti = t % NW, tj = (t - ti) / NW;
    const h = k => { const i = k % NW, j = (k - i) / NW, a = Math.abs(i - ti), b = Math.abs(j - tj); return (Math.max(a, b) + 0.414 * Math.min(a, b)); };
    const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top[1]; };
    stamp[s] = gen; gScore[s] = 0; came[s] = -1; push(s, h(s));
    let found = false, iter = 0;
    while (heap.length && iter++ < 6000) {
      const k = pop();
      if (closed[k] === gen) continue;
      closed[k] = gen;
      if (k === t) { found = true; break; }
      const i = k % NW, j = (k - i) / NW;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= NW || jj >= NH) continue;
        const kk = jj * NW + ii;
        if (!walk[kk] || closed[kk] === gen) continue;
        if (di && dj && (!walk[j * NW + ii] || !walk[jj * NW + i])) continue;
        const g = gScore[k] + (di && dj ? 1.414 : 1) + (cost ? cost(kk) : 0);
        if (stamp[kk] !== gen || g < gScore[kk]) { stamp[kk] = gen; gScore[kk] = g; came[kk] = k; push(kk, g + h(kk)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = t; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    // String pulling: skip ahead while the straight line stays on walkable cells
    const pts = cells.map(nodePos);
    pts[pts.length - 1] = { x: tx, z: tz };
    if (!walkable(tx, tz)) pts[pts.length - 1] = nodePos(t);
    const out = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !walkLine(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
      out.push(pts[b]); a = b;
    }
    return out;
  }
  function walkLine(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.01) return true;
    const px = -dz / L * 0.45, pz = dx / L * 0.45, n = Math.ceil(L / 0.5);
    for (let s = 0; s <= n; s++) {
      const x = ax + dx * s / n, z = az + dz * s / n;
      if (!walkable(x, z) || !walkable(x + px, z + pz) || !walkable(x - px, z - pz)) return false;
    }
    return true;
  }

  // ── Places ── names for the radar and the kill feed, checked in order
  const REGIONS = [
    ['CT Spawn', 13, 1, 18, 4], ['A Site', 21, 2, 29, 9], ['B Site', 2, 2, 10, 9], ['B Window', 11, 8, 14, 9], ['CT → B', 11, 2, 12, 4], ['CT → A', 19, 2, 20, 4],
    ['Catwalk', 17, 10, 24, 12], ['Top Mid', 15, 5, 16, 12], ['Mid Doors', 15, 13, 16, 15], ['Mid', 15, 16, 16, 19], ['T Mid', 12, 20, 19, 25],
    ['Long A', 28, 10, 29, 17], ['Long Doors', 28, 18, 29, 19], ['Outside Long', 22, 20, 29, 27], ['Lower Tunnel', 4, 21, 11, 22],
    ['B Tunnels', 2, 10, 3, 19], ['Upper Tunnels', 2, 20, 9, 27], ['T Spawn', 10, 26, 21, 30],
  ];
  function regionName(x, z) {
    const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
    for (const [n, c0, r0, c1, r1] of REGIONS) if (c >= c0 && c <= c1 && r >= r0 && r <= r1) return n;
    return '';
  }

  // ── Spots the bots use ── (x, z, and where to look)
  const P = (x, z, lx, lz) => ({ x, z, lx, lz });
  const SPOTS = {
    tSpawn: [P(46, 108), P(54, 113), P(62, 116), P(70, 113), P(78, 108)],
    ctSpawn: [P(55, 8), P(61, 7), P(67, 8), P(57, 15), P(65, 15)],
    A: {
      plant: [P(96, 24), P(106, 17), P(106, 27), P(98, 14), P(110, 23)],
      hold: [P(106, 11, 116, 44), P(86, 22, 94, 44), P(112, 22, 116, 44), P(97, 13, 94, 44)],
      post: [P(114, 13, 100, 22), P(86, 30, 100, 22), P(118, 26, 100, 22), P(90, 12, 100, 22)],
      retake: P(80, 12), ctEntry: P(85, 10),
    },
    B: {
      plant: [P(30, 24), P(20, 16), P(32, 17), P(20, 27), P(28, 30)],
      hold: [P(30, 12, 12, 42), P(20, 13, 44, 36), P(36, 20, 12, 42), P(40, 14, 44, 36)],
      post: [P(12, 16, 26, 22), P(36, 32, 26, 22), P(40, 18, 26, 22), P(18, 30, 26, 22)],
      retake: P(46, 12), ctEntry: P(40, 12),
    },
    midHold: [P(62, 22, 66, 80), P(66, 26, 62, 60)],
    // T routes: walk to the stage (out of sight), then go in through the entry. util: smoke / flash landing spots.
    routes: {
      long:    { site: 'A', stage: P(117, 82, 116, 40), entry: P(116, 38), smoke: P(103, 16), flash: P(112, 30), molly: P(112, 16) },
      short:   { site: 'A', stage: P(68, 48, 92, 44), entry: P(94, 40), smoke: P(86, 18), flash: P(94, 32), molly: P(86, 20) },
      tunnels: { site: 'B', stage: P(12, 72, 12, 40), entry: P(12, 38), smoke: P(36, 16), flash: P(14, 30), molly: P(30, 13) },
      window:  { site: 'B', stage: P(66, 62, 64, 36), entry: P(46, 36), smoke: P(22, 14), flash: P(38, 34), molly: P(20, 14) },
    },
    // Where CTs throw to slow a rush
    ctUtil: {
      A: [{ from: P(106, 11), to: P(116, 46) }, { from: P(88, 22), to: P(94, 44) }],
      B: [{ from: P(30, 12), to: P(12, 44) }, { from: P(36, 18), to: P(46, 36) }],
    },
    midLurk: P(60, 84, 66, 30),
  };

  // ── Scene ── walls, floors, crates, signs, sky and light (three.js)
  function buildScene(THREE, scene, opts) {
    const hi = !opts || opts.quality !== 'low';
    const tex = (size, draw, rep) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const x = c.getContext('2d'); draw(x, size);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
      if (rep) t.repeat.set(rep, rep);
      return t;
    };
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const speckle = (x, s, n, a, cols) => { for (let i = 0; i < n; i++) { x.fillStyle = cols[i % cols.length]; x.globalAlpha = a * rnd(); x.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2); } x.globalAlpha = 1; };
    // Sandstone blocks (one tile = 4 m)
    const wallTex = tex(512, (x, s) => {
      x.fillStyle = '#d7b98a'; x.fillRect(0, 0, s, s);
      const rows = 8, bh = s / rows;
      for (let r = 0; r < rows; r++) {
        const bw = s / 4, off = (r % 2) * bw / 2;
        for (let k = -1; k < 5; k++) {
          const l = 205 + rnd() * 30 | 0;
          x.fillStyle = `rgb(${l},${l * 0.86 | 0},${l * 0.64 | 0})`;
          x.fillRect(k * bw + off + 3, r * bh + 3, bw - 6, bh - 6);
        }
      }
      speckle(x, s, 9000, 0.25, ['#8a6a44', '#fff1d0', '#b08a5a']);
      x.fillStyle = 'rgba(90,60,30,0.10)'; x.fillRect(0, s * 0.86, s, s * 0.14);
    });
    const floorTex = tex(512, (x, s) => {
      x.fillStyle = '#c8a878'; x.fillRect(0, 0, s, s);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const l = 185 + rnd() * 25 | 0;
        x.fillStyle = `rgb(${l},${l * 0.85 | 0},${l * 0.62 | 0})`;
        x.fillRect(i * s / 4 + 2, j * s / 4 + 2, s / 4 - 4, s / 4 - 4);
      }
      speckle(x, s, 14000, 0.22, ['#7a5a36', '#f6e2bb', '#a07a4c']);
    });
    const woodTex = tex(256, (x, s) => {
      x.fillStyle = '#9a6b3c'; x.fillRect(0, 0, s, s);
      for (let i = 0; i < 6; i++) { const l = 130 + rnd() * 40 | 0; x.fillStyle = `rgb(${l},${l * 0.68 | 0},${l * 0.38 | 0})`; x.fillRect(0, i * s / 6 + 2, s, s / 6 - 4); }
      x.strokeStyle = '#5a3a1a'; x.lineWidth = 18; x.strokeRect(9, 9, s - 18, s - 18);
      x.lineWidth = 14; x.beginPath(); x.moveTo(12, 12); x.lineTo(s - 12, s - 12); x.stroke();
      speckle(x, s, 2500, 0.3, ['#3d2610', '#d9a46a']);
    });
    const metalTex = tex(256, (x, s) => {
      x.fillStyle = '#4f6b5a'; x.fillRect(0, 0, s, s);
      for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#476251' : '#5a7865'; x.fillRect(i * s / 8, 0, s / 8, s); }
      x.strokeStyle = '#2c3d33'; x.lineWidth = 10; x.strokeRect(5, 5, s - 10, s - 10);
      speckle(x, s, 3000, 0.35, ['#8a6a44', '#1f2b24', '#9fb8a5']);
    });
    const doorTex = tex(256, (x, s) => {
      x.fillStyle = '#7a4f2a'; x.fillRect(0, 0, s, s);
      for (let i = 0; i < 5; i++) { x.fillStyle = i % 2 ? '#6e4524' : '#85592f'; x.fillRect(i * s / 5, 0, s / 5 - 3, s); }
      speckle(x, s, 2000, 0.35, ['#3d2610', '#c09060']);
    });
    const roofTex = tex(256, (x, s) => {
      x.fillStyle = '#6d5a45'; x.fillRect(0, 0, s, s);
      for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#5f4e3b' : '#7a6650'; x.fillRect(0, i * s / 8, s, s / 8 - 2); }
      speckle(x, s, 3000, 0.3, ['#2e241a', '#a08a70']);
    });
    // Box with UVs scaled to its real size (texture tile = `tile` metres)
    function boxMesh(b, mat, tile) {
      const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
      }
      const m = new THREE.Mesh(g, mat);
      m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      return m;
    }
    const M = {
      wall: new THREE.MeshLambertMaterial({ map: wallTex }),
      wood: new THREE.MeshLambertMaterial({ map: woodTex }),
      metal: new THREE.MeshLambertMaterial({ map: metalTex }),
      door: new THREE.MeshLambertMaterial({ map: doorTex }),
      roof: new THREE.MeshLambertMaterial({ map: roofTex }),
    };
    for (const b of boxes) {
      if (b.kind === 'wall') boxMesh(b, M.wall, 4);
      else if (b.kind === 'crate') boxMesh(b, M[b.mat] || M.wood, Math.max(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0));
      else if (b.kind === 'door') boxMesh(b, M.door, 2.7);
      else if (b.kind === 'roof') boxMesh(b, M.roof, 4);
    }
    // Floor
    floorTex.repeat.set(SIZE / 4, SIZE / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshLambertMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(SIZE / 2, 0, SIZE / 2); floor.receiveShadow = true;
    scene.add(floor);
    // Plant zones: painted hatched outline on the floor, and big letters
    const decal = (w, h, draw, x, y, z, rx, ry) => {
      const c = document.createElement('canvas'); c.width = Math.round(w * 64); c.height = Math.round(h * 64);
      draw(c.getContext('2d'), c.width, c.height);
      const t = new THREE.CanvasTexture(c); t.anisotropy = 8;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.receiveShadow = true;
      scene.add(m);
      return m;
    };
    const zone = (c0, r0, c1, r1, letter) => {
      const w = (c1 - c0 + 1) * CELL, h = (r1 - r0 + 1) * CELL;
      decal(w, h, (x, cw, chh) => {
        x.strokeStyle = 'rgba(190,40,30,0.75)'; x.lineWidth = 22; x.setLineDash([60, 30]); x.strokeRect(16, 16, cw - 32, chh - 32);
        x.setLineDash([]); x.fillStyle = 'rgba(190,40,30,0.55)'; x.font = `900 ${chh * 0.5 | 0}px Nunito, Arial, sans-serif`;
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(letter, cw * 0.5, chh * 0.55);
      }, c0 * CELL + w / 2, 0.02, r0 * CELL + h / 2, -Math.PI / 2);
    };
    zone(23, 3, 27, 7, 'A'); zone(4, 3, 8, 7, 'B');
    const sign = (text, x, y, z, ry, size) => decal(size * Math.max(1, text.length * 0.62), size, (c, cw, chh) => {
      c.fillStyle = 'rgba(160,30,25,0.85)'; c.font = `900 ${chh * 0.82 | 0}px Nunito, Arial, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, cw / 2, chh * 0.55);
    }, x, y, z, 0, ry);
    sign('A', 104, 4, 8.03, 0, 3);
    sign('B', 26, 4, 8.03, 0, 3);
    sign('A ↑', 112.03, 2.6, 62, Math.PI / 2, 1.4);
    sign('B ↑', 15.97, 2.4, 106, -Math.PI / 2, 1.2);
    sign('↖ B   A ↗', 64, 2.8, 79.97, Math.PI, 1.2);
    sign('B ←', 59.97, 2.6, 40, -Math.PI / 2, 1.2);
    sign('A →', 68.03, 2.6, 48, Math.PI / 2, 1.2);
    // Sky dome
    const sky = tex(256, (x, s) => { const g = x.createLinearGradient(0, 0, 0, s); g.addColorStop(0, '#4f8fd6'); g.addColorStop(0.5, '#a9cdee'); g.addColorStop(1, '#f2dcb8'); x.fillStyle = g; x.fillRect(0, 0, s, s); });
    sky.wrapS = sky.wrapT = THREE.ClampToEdgeWrapping;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.position.set(SIZE / 2, 0, SIZE / 2);
    scene.add(dome);
    // Light: soft sky + a warm low sun with one baked shadow pass
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x8a6a48, 0.5));
    scene.add(new THREE.AmbientLight(0xffffff, 0.06));
    const sun = new THREE.DirectionalLight(0xffe8c4, 0.78);
    sun.position.set(SIZE / 2 + 75, 85, SIZE / 2 + 45);
    sun.target.position.set(SIZE / 2, 0, SIZE / 2);
    sun.castShadow = hi;
    sun.shadow.mapSize.set(hi ? 4096 : 1024, hi ? 4096 : 1024);
    const sc = sun.shadow.camera; sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 10; sc.far = 300;
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);
    scene.fog = new THREE.Fog(0xe9d9bd, 70, 260);
  }

  window.BombsiteWorld = Object.freeze({
    CELL, SIZE, grid, cellAt, boxes: solidBoxes, raycast, los, moveBody, blocked,
    walkable, findPath, nearestWalkable, nodePos, nIdx, NC, NW, NH, regionName, SPOTS, buildScene, WALL_H,
  });
})();

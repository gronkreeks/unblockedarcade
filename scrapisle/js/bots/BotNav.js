// Bot movement: steering with obstacle avoidance, stuck recovery, doors, and grid paths through bases.
import { PIECES, CELL, FOUND_H } from '../data/building.js';
import { dist, angleWrap, randRange } from '../core/util.js';

export class BotNav {
  constructor(game) { this.game = game; }

  // Move a bot toward (tx,tz). mode: 'full' | 'mid' | 'far'. Returns true when within arrive radius.
  // Blocked by a ledge (a foundation edge, a half wall, a rock): jump up it like a player would.
  _hop(b, px, pz, speed, dt) {
    const ai = b.ai;
    if (!b.onGround || Math.hypot(b.x - px, b.z - pz) >= speed * dt * 0.35) return;
    if (this.game.now < (ai.hopT || 0)) return;
    ai.hopT = this.game.now + 0.6 + Math.random() * 0.5;
    b.vy = 5.4; b.onGround = false;
  }
  moveTo(b, tx, tz, dt, mode, opts = {}) {
    const ai = b.ai, W = this.game.world;
    const arrive = opts.arrive ?? 1.2;
    const d = dist(b.x, b.z, tx, tz);
    if (d <= arrive) { b.vx = 0; b.vz = 0; return true; }
    const run = opts.run ?? (d > 15 && b.hyd > 40 && b.cal > 60);
    let speed = (run && !((b.slowUntil || 0) > this.game.now) ? 5.4 : 3.0) * (b.crouch ? 0.55 : 1);
    if (mode === 'far') {
      // abstract: terrain-following travel without collision, still walking around guarded monuments
      const step = Math.min(d, 5.6 * (0.85 + 0.15 * ai.S.efficiency) * dt);
      const a = this.avoidMonuments(b, tx, tz, Math.atan2(tx - b.x, tz - b.z));
      b.x += Math.sin(a) * step; b.z += Math.cos(a) * step;
      const ws = W.waterSurface(b.x, b.z);
      b.y = Math.max(W.heightAt(b.x, b.z), ws ? ws.y - 1.3 : -99);
      b.yaw = Math.atan2(tx - b.x, tz - b.z);
      return d - step <= arrive;
    }
    let want = Math.atan2(tx - b.x, tz - b.z);
    want = this.avoidMonuments(b, tx, tz, want);
    // walls, rocks or a building in the way (or stuck): walk a planned route around them
    let routed = false, steer = null;
    if (mode === 'full' && d > 2.5 && d < 70 && !opts.noGrid) {
      const G = this.game; let gp = ai.gpath;
      steer = this.avoid(b, want);
      const blockedAhead = steer !== want;
      // keep a route until the goal moves or the bot stops making progress (replanning every few
      // seconds made bots flip between going left and right around the same wall)
      if ((blockedAhead || ai.stuckT > 1) && (!gp || dist(gp.tx, gp.tz, tx, tz) > 4 || (G.now - gp.t > 3 && ai.stuckT > 1.5))) {
        const pts = this.gridPath(b, tx, tz);
        gp = ai.gpath = pts && pts.length ? { pts, i: 0, t: G.now, tx, tz } : null;
        if (!gp) ai.gpathFail = G.now;
      }
      if (gp && G.now - gp.t < 15) {
        while (gp.i < gp.pts.length - 1 && dist(b.x, b.z, gp.pts[gp.i].x, gp.pts[gp.i].z) < 0.9) gp.i++;
        const wp = gp.pts[gp.i];
        want = Math.atan2(wp.x - b.x, wp.z - b.z); routed = true;
        if (gp.i >= gp.pts.length - 1 && dist(b.x, b.z, wp.x, wp.z) < 0.9) ai.gpath = null;
      } else if (gp) ai.gpath = null;
    }
    // obstacle avoidance (full detail only)
    if (mode === 'full' && d > 1.5 && !routed) want = steer ?? this.avoid(b, want);
    // water: don't walk into deep water unless the target is there
    const ahead = 3;
    const wx = b.x + Math.sin(want) * ahead, wz = b.z + Math.cos(want) * ahead;
    const ws = W.waterSurface(wx, wz);
    if (ws && ws.y - W.heightAt(wx, wz) > 1.4 && !opts.swim) {
      const l = want + Math.PI / 2, r = want - Math.PI / 2;
      const okL = !W.waterSurface(b.x + Math.sin(l) * ahead, b.z + Math.cos(l) * ahead);
      want = okL ? want + 0.9 : want - 0.9;
    }
    // stuck recovery
    ai.stuckT = ai.stuckT || 0;
    if (ai.unstuck > 0 && !routed) { ai.unstuck -= dt; want = ai.unstuckDir; }
    b.yaw += angleWrap(want - b.yaw) * Math.min(1, dt * 8);
    const water = W.waterSurface(b.x, b.z);
    const swim = water && water.y - b.y > 1.25;
    if (swim) speed = 2.2;
    b.vx = Math.sin(want) * speed; b.vz = Math.cos(want) * speed;
    if (swim) b.vy += ((water.y - 1.35) - b.y) * dt * 3 - b.vy * dt * 2;
    else b.vy -= 9.8 * 1.35 * dt;
    const px = b.x, pz = b.z;
    if (mode === 'full') {
      b.landSpeed = 0;
      this.game.physics.move(b, dt);
      if (b.landSpeed > 10) this.game.surv.fallDamage(b, b.landSpeed);
      this._hop(b, px, pz, speed, dt);
    } else {
      // mid detail: collide with structures only near bases, otherwise terrain-follow
      const nearBase = this.game.build.structureNear(b.x, b.z, 12);
      if (nearBase) { this.game.physics.move(b, dt); this._hop(b, px, pz, speed, dt); }
      else { b.x += b.vx * dt; b.z += b.vz * dt; b.y = Math.max(W.heightAt(b.x, b.z), swim ? water.y - 1.3 : -99); b.vy = 0; }
    }
    // progress tracking
    ai.progT = (ai.progT || 0) + dt;
    if (ai.progT > 1.5) {
      const moved = dist(b.x, b.z, ai.progX ?? b.x, ai.progZ ?? b.z);
      if (moved < 0.8) {
        ai.stuckT += ai.progT;
        ai.unstuck = randRange(0.6, 1.4); ai.unstuckDir = want + (Math.random() < 0.5 ? 1 : -1) * randRange(1.2, 2.2);
        if (ai.stuckT > 9 && this.game.player && dist(b.x, b.z, this.game.player.x, this.game.player.z) > 70) {
          // nobody is watching: nudge past the obstacle
          b.x += Math.sin(want) * 2.5; b.z += Math.cos(want) * 2.5; b.y = W.heightAt(b.x, b.z); ai.stuckT = 0;
        }
      } else ai.stuckT = Math.max(0, ai.stuckT - 1);
      ai.progX = b.x; ai.progZ = b.z; ai.progT = 0;
    }
    return false;
  }
  // ---------- local grid paths around walls, rocks and buildings ----------
  // A* on a 1 m grid in a window around the bot and its goal, with solid colliders (inflated by the
  // bot's radius) as blocked cells. Low things you can step or hop onto stay open.
  gridPath(b, tx, tz) {
    const P = this.game.physics, R = 0.45;
    const d = dist(b.x, b.z, tx, tz);
    const half = Math.min(32, Math.max(14, d / 2 + 8));
    const cx = (b.x + tx) / 2, cz = (b.z + tz) / 2, N = Math.ceil(half * 2);
    const x0 = cx - half, z0 = cz - half;
    const blocked = new Uint8Array(N * N);
    const cols = [];
    P.near(cx, cz, half * 1.5, c => {
      if (!c.solid || c.tag === 'drop' || c.tag === 'bag' || c.ref === b) return;
      if (c.tag === 'door' && c.ref.door && c.ref.door.open) return;
      const top = c.type === 'box' ? c.y + c.hy : c.y1, bot = c.type === 'box' ? c.y - c.hy : c.y0;
      if (top - b.y <= 0.8 || bot - b.y > 1.9) return;   // hop-able or overhead
      cols.push(c);
    });
    for (const c of cols) {
      const ext = c.type === 'box' ? Math.hypot(c.hx, c.hz) + R : c.r + R;
      const i0 = Math.max(0, Math.floor(c.x - ext - x0)), i1 = Math.min(N - 1, Math.ceil(c.x + ext - x0));
      const j0 = Math.max(0, Math.floor(c.z - ext - z0)), j1 = Math.min(N - 1, Math.ceil(c.z + ext - z0));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = x0 + i + 0.5, pz = z0 + j + 0.5;
        if (c.type === 'box') {
          const cc = Math.cos(c.yaw || 0), ss = Math.sin(c.yaw || 0), dx = px - c.x, dz = pz - c.z;
          const lx = dx * cc - dz * ss, lz = dx * ss + dz * cc;
          if (Math.abs(lx) < c.hx + R && Math.abs(lz) < c.hz + R) blocked[j * N + i] = 1;
        } else if (Math.hypot(px - c.x, pz - c.z) < c.r + R) blocked[j * N + i] = 1;
      }
    }
    const cell = (x, z) => [Math.max(0, Math.min(N - 1, Math.floor(x - x0))), Math.max(0, Math.min(N - 1, Math.floor(z - z0)))];
    const [si, sj] = cell(b.x, b.z); let [gi, gj] = cell(tx, tz);
    blocked[sj * N + si] = 0;
    if (blocked[gj * N + gi]) {   // goal inside something: aim for the nearest open cell next to it
      let best = null, bd = Infinity;
      for (let j = Math.max(0, gj - 4); j <= Math.min(N - 1, gj + 4); j++) for (let i = Math.max(0, gi - 4); i <= Math.min(N - 1, gi + 4); i++) if (!blocked[j * N + i]) { const dd = (i - gi) ** 2 + (j - gj) ** 2; if (dd < bd) { bd = dd; best = [i, j]; } }
      if (!best) return null; [gi, gj] = best;
    }
    const g = new Float32Array(N * N).fill(Infinity), came = new Int32Array(N * N).fill(-1), open = [];
    const h = (i, j) => Math.hypot(i - gi, j - gj);
    const start = sj * N + si, goal = gj * N + gi;
    g[start] = 0; open.push([h(si, sj), start]);
    const closed = new Uint8Array(N * N); let found = false, iter = 0;
    while (open.length && iter++ < 6000) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue; closed[cur] = 1;
      const ci = cur % N, cj = (cur / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni; if (blocked[nk] || closed[nk]) continue;
        if (di && dj && (blocked[cj * N + ni] || blocked[nj * N + ci])) continue;   // no corner cutting
        const ng = g[cur] + (di && dj ? 1.414 : 1);
        if (ng < g[nk]) { g[nk] = ng; came[nk] = cur; open.push([ng + h(ni, nj), nk]); }
      }
    }
    if (!found) return null;
    const cells = []; for (let k = goal; k !== -1; k = came[k]) cells.push(k); cells.reverse();
    // keep only the turns (string pulling against the grid)
    const clear = (a, c) => { const ai = a % N, aj = (a / N) | 0, ci = c % N, cj = (c / N) | 0, n = Math.max(Math.abs(ci - ai), Math.abs(cj - aj)) * 2; for (let s = 1; s < n; s++) { const i = Math.round(ai + (ci - ai) * s / n), j = Math.round(aj + (cj - aj) * s / n); if (blocked[j * N + i]) return false; } return true; };
    const pts = []; let anchor = 0;
    for (let k = 2; k < cells.length; k++) if (!clear(cells[anchor], cells[k])) { anchor = k - 1; pts.push(cells[anchor]); }
    pts.push(cells[cells.length - 1]);
    return pts.map(k => ({ x: x0 + (k % N) + 0.5, z: z0 + ((k / N) | 0) + 0.5 }));
  }
  // Steer around monuments with armed guards unless the target is inside one.
  avoidMonuments(b, tx, tz, want) {
    const W = this.game.world;
    let hx = Math.sin(want), hz = Math.cos(want);
    for (const m of W.monuments) {
      if (m.tier < 2) continue;
      const R = m.r + 30;
      const ax = m.x - b.x, az = m.z - b.z, d = Math.hypot(ax, az) || 1;
      if (d > R + 40 || dist(tx, tz, m.x, m.z) < m.r + 10) continue;
      if (ax * hx + az * hz < 0 && d > R) continue;            // already moving away
      let px = az / d, pz = -ax / d;                            // perpendicular around the monument
      if (px * hx + pz * hz < 0) { px = -px; pz = -pz; }        // the side that keeps us going forward
      const w = Math.min(2, (R + 40 - d) / 40);
      hx += px * w * 1.5 - (ax / d) * w * 0.5;
      hz += pz * w * 1.5 - (az / d) * w * 0.5;
    }
    return Math.atan2(hx, hz);
  }
  avoid(b, want) {
    const P = this.game.physics, look = 2.6;
    const blocked = (a) => {
      const dx = Math.sin(a), dz = Math.cos(a);
      for (const h of [0.55, 1.3]) {
        const hc = P.rayColliders(b.x, b.y + h, b.z, dx, 0, dz, look, c => c.solid && c.tag !== 'drop' && c.ref !== b && !(c.tag === 'door' && c.ref.door && c.ref.door.open));
        if (hc) {
          // allow stepping onto low boxes (foundations, steps)
          const top = hc.c.type === 'box' ? hc.c.y + hc.c.hy : hc.c.y1;
          if (top - b.y > 0.55) return hc.t;
        }
      }
      return null;
    };
    const f = blocked(want);
    if (f === null) return want;
    for (const off of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.2, -2.2]) if (blocked(want + off) === null) return want + off;
    return want + Math.PI * 0.8;
  }
  // Follow a list of waypoints [{x,z,door?}]. Returns true when the last is reached.
  follow(b, path, dt, mode, opts = {}) {
    const ai = b.ai;
    if (!path || !path.length) return true;
    ai.pathI = ai.pathI || 0;
    if (ai.pathI >= path.length) return true;
    const wp = path[ai.pathI];
    // open doors on the way
    if (wp.door && mode !== 'far') {
      const p = wp.door;
      if (p.door && !p.door.open && dist(b.x, b.z, wp.x, wp.z) < 2.6) {
        if (this.game.build.canOpen(b.team, p)) this.game.build.toggleDoor(b.team, p);
        else if (!opts.force) return false;
      }
    }
    const last = ai.pathI === path.length - 1;
    if (this.moveTo(b, wp.x, wp.z, dt, mode, { arrive: last ? (opts.arrive ?? 0.9) : 0.7, run: opts.run })) {
      // close door behind
      if (wp.door && wp.closeAfter && wp.door.door && wp.door.door.open && mode !== 'far') ai.closeDoor = { p: wp.door, x: wp.x, z: wp.z };
      ai.pathI++;
    }
    if (ai.closeDoor && dist(b.x, b.z, ai.closeDoor.x, ai.closeDoor.z) > 1.8) {
      const p = ai.closeDoor.p; ai.closeDoor = null;
      if (p.door && p.door.open && this.game.build.canOpen(b.team, p)) this.game.build.toggleDoor(b.team, p);
    }
    return ai.pathI >= path.length;
  }

  // ---------- base grid paths ----------
  footprint(st) {
    const cells = new Set();
    for (const p of st.pieces.values()) if (p.type === 'foundation') cells.add(`${p.i},${p.j}`);
    return cells;
  }
  cellOf(st, x, z) { const L = this.game.build.toLocal(st, x, 0, z); return [Math.floor(L.x / CELL), Math.floor(L.z / CELL)]; }
  cellCenter(st, i, j) { const w = this.game.build.toWorld(st, (i + 0.5) * CELL, FOUND_H, (j + 0.5) * CELL); return w; }
  edgeKey(a, b) {
    // a,b adjacent cells [i,j]
    if (a[0] !== b[0]) return `x:${Math.max(a[0], b[0])},${a[1]},0`;
    return `z:${a[0]},${Math.max(a[1], b[1])},0`;
  }
  // Edge passability cost for a team. Infinity = blocked for walking. raid=true: cost in breach damage.
  edgeCost(st, key, team, raid) {
    const p = st.pieces.get(key);
    if (!p) return { cost: 0 };
    const t = PIECES[p.type];
    if (p.type === 'doorway') {
      if (!p.door) return { cost: 0, piece: p };
      if (p.door.open || this.game.build.canOpen(team, p)) return { cost: 0.5, piece: p, door: true };
      return raid ? { cost: p.door.hp * (p.door.type === 'wood_door' ? 0.8 : 1), piece: p, door: true, breach: true } : { cost: Infinity };
    }
    if (p.type === 'half_wall') return { cost: raid ? p.hp : Infinity, piece: p, breach: true };
    return raid ? { cost: p.hp * 1.0, piece: p, breach: true } : { cost: Infinity };
  }
  // Dijkstra from outside (or the bot's cell) to a target cell at ground level.
  // Returns { path:[{x,z,door,piece,breach}], breaches:[piece], cost }
  basePath(st, team, fromX, fromZ, target, raid = false) {
    const fp = this.footprint(st);
    const start = this.cellOf(st, fromX, fromZ);
    const inside = fp.has(`${start[0]},${start[1]}`);
    const key = (c) => `${c[0]},${c[1]}`;
    const tk = key(target);
    const distM = new Map(), prev = new Map();
    const pq = [];
    const push = (c, d, from, via) => { const k = key(c); if (d < (distM.get(k) ?? Infinity)) { distM.set(k, d); prev.set(k, { from, via }); pq.push([d, c]); } };
    if (inside) push(start, 0, null, null);
    else {
      // every perimeter edge is an entry
      for (const s of fp) {
        const [i, j] = s.split(',').map(Number);
        for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
          if (fp.has(`${a},${b}`)) continue;
          const e = this.edgeCost(st, this.edgeKey([i, j], [a, b]), team, raid);
          if (e.cost === Infinity) continue;
          const outPt = this.cellCenter(st, a, b);
          push([i, j], e.cost + dist(fromX, fromZ, outPt.x, outPt.z) * 0.01, 'out:' + a + ',' + b, e);
        }
      }
    }
    while (pq.length) {
      pq.sort((x, y) => x[0] - y[0]);
      const [d, c] = pq.shift();
      const k = key(c);
      if (d > (distM.get(k) ?? Infinity)) continue;
      if (k === tk) break;
      for (const n of [[c[0] - 1, c[1]], [c[0] + 1, c[1]], [c[0], c[1] - 1], [c[0], c[1] + 1]]) {
        if (!fp.has(key(n))) continue;
        const e = this.edgeCost(st, this.edgeKey(c, n), team, raid);
        if (e.cost === Infinity) continue;
        push(n, d + e.cost + 1, k, e);
      }
    }
    if (!distM.has(tk)) return null;
    // rebuild
    const cells = [];
    let cur = tk;
    while (cur) {
      const pr = prev.get(cur);
      cells.unshift({ cell: cur, via: pr ? pr.via : null });
      if (!pr || !pr.from) break;
      if (pr.from.startsWith('out:')) { cells.unshift({ cell: pr.from.slice(4), outside: true }); break; }
      cur = pr.from;
    }
    const path = [], breaches = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const [ci, cj] = c.cell.split(',').map(Number);
      if (c.via && c.via.piece) {
        const p = c.via.piece;
        // stand in front of the edge on the previous cell side, then pass through it
        const prevC = cells[i - 1];
        if (prevC) { const [pi, pj] = prevC.cell.split(',').map(Number); const pc = this.cellCenter(st, pi, pj); const mid = { x: (pc.x + p.wx) / 2, z: (pc.z + p.wz) / 2 }; path.push({ x: mid.x, z: mid.z }); }
        path.push({ x: p.wx, z: p.wz, door: p.type === 'doorway' ? p : null, piece: p, breach: !!c.via.breach, closeAfter: !raid });
        if (c.via.breach) breaches.push(p);
      }
      const cc = this.cellCenter(st, ci, cj);
      path.push({ x: cc.x, z: cc.z });
    }
    return { path, breaches, cost: distM.get(tk), inside };
  }
  // The cell the Claim Cabinet (or a box) stands in.
  cellOfDep(st, d) { return this.cellOf(st, d.x, d.z); }
}

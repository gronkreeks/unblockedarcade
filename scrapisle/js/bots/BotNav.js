// Bot movement: steering with obstacle avoidance, stuck recovery, doors, and grid paths through bases.
import { PIECES, CELL, FOUND_H } from '../data/building.js';
import { dist, angleWrap, randRange } from '../core/util.js';

export class BotNav {
  constructor(game) { this.game = game; }

  // Move a bot toward (tx,tz). mode: 'full' | 'mid' | 'far'. Returns true when within arrive radius.
  moveTo(b, tx, tz, dt, mode, opts = {}) {
    const ai = b.ai, W = this.game.world;
    const arrive = opts.arrive ?? 1.2;
    const d = dist(b.x, b.z, tx, tz);
    if (d <= arrive) { b.vx = 0; b.vz = 0; return true; }
    const run = opts.run ?? (d > 15 && b.hyd > 40 && b.cal > 60);
    let speed = (run ? 5.4 : 3.0) * (b.crouch ? 0.55 : 1);
    if (mode === 'far') {
      // abstract: terrain-following travel without collision, still walking around guarded monuments
      const step = Math.min(d, 5 * (0.85 + 0.15 * ai.S.efficiency) * dt);
      const a = this.avoidMonuments(b, tx, tz, Math.atan2(tx - b.x, tz - b.z));
      b.x += Math.sin(a) * step; b.z += Math.cos(a) * step;
      const ws = W.waterSurface(b.x, b.z);
      b.y = Math.max(W.heightAt(b.x, b.z), ws ? ws.y - 1.3 : -99);
      b.yaw = Math.atan2(tx - b.x, tz - b.z);
      return d - step <= arrive;
    }
    let want = Math.atan2(tx - b.x, tz - b.z);
    want = this.avoidMonuments(b, tx, tz, want);
    // obstacle avoidance (full detail only)
    if (mode === 'full' && d > 1.5) want = this.avoid(b, want);
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
    if (ai.unstuck > 0) { ai.unstuck -= dt; want = ai.unstuckDir; }
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
      // jump small obstacles
      if (b.onGround && Math.hypot(b.x - px, b.z - pz) < speed * dt * 0.2 && Math.random() < 0.08) b.vy = 5;
    } else {
      // mid detail: collide with structures only near bases, otherwise terrain-follow
      const nearBase = this.game.build.structureNear(b.x, b.z, 12);
      if (nearBase) this.game.physics.move(b, dt);
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

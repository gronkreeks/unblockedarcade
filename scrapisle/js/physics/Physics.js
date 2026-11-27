// Collision world: terrain heightfield + static/dynamic colliders in a spatial grid.
// Colliders: { type:'box', x,y,z (center), hx,hy,hz, yaw, ref, solid, layer } or { type:'cyl', x,z,y0,y1,r, ref }.
// Movers are vertical cylinders (radius r, height h, feet at y).
import { SpatialHash } from '../core/spatial.js';

const STEP = 0.55;
const MANTLE = 0.85;

export class Physics {
  constructor(world) {
    this.world = world;
    this.grid = new SpatialHash(12);
    this.all = new Set();
  }
  add(c) {
    if (c.type === 'box') {
      c.c = Math.cos(c.yaw || 0); c.s = Math.sin(c.yaw || 0);
      c.rad = Math.hypot(c.hx, c.hz);
    } else c.rad = c.r;
    if (c.solid === undefined) c.solid = true;
    this.all.add(c);
    // insert into every grid cell the collider's bounding circle touches
    c._cells = [];
    const cell = this.grid.cell, r = c.rad;
    const x0 = Math.floor((c.x - r) / cell), x1 = Math.floor((c.x + r) / cell);
    const z0 = Math.floor((c.z - r) / cell), z1 = Math.floor((c.z + r) / cell);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = this.grid._key(cx, cz);
      let b = this.grid.map.get(k); if (!b) { b = []; this.grid.map.set(k, b); }
      b.push(c); c._cells.push(k);
    }
    return c;
  }
  remove(c) {
    if (!c || !this.all.has(c)) return;
    this.all.delete(c);
    for (const k of c._cells) { const b = this.grid.map.get(k); if (b) { const i = b.indexOf(c); if (i >= 0) { b[i] = b[b.length - 1]; b.pop(); } } }
    c._cells = [];
  }
  near(x, z, r, fn) {
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    this.grid.query(x, z, r + 4, c => { if (!seen.has(c)) { seen.add(c); return fn(c); } });
  }

  groundAt(x, z) { return this.world.heightAt(x, z); }

  // Move a cylinder body. body: {x,y,z, vx,vy,vz, r, h, onGround}. Returns body (mutated).
  move(body, dt, opts = {}) {
    const W = this.world;
    let nx = body.x + body.vx * dt, nz = body.z + body.vz * dt, ny = body.y + body.vy * dt;
    const r = body.r, h = body.h;
    let ground = W.heightAt(nx, nz);
    let onGround = false;
    // resolve against colliders (2 iterations)
    for (let it = 0; it < 2; it++) {
      this.near(nx, nz, r + 2, c => {
        if (!c.solid || c === opts.ignore || (opts.ignoreRef && c.ref === opts.ignoreRef)) return;
        if (c.type === 'cyl') {
          if (ny + h < c.y0 || ny > c.y1) return;
          const dx = nx - c.x, dz = nz - c.z, d2 = dx * dx + dz * dz, rr = r + c.r;
          if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.001; nx = c.x + dx / d * rr; nz = c.z + dz / d * rr; }
          return;
        }
        // box in local frame
        const dx = nx - c.x, dz = nz - c.z;
        const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
        if (Math.abs(lx) > c.hx + r || Math.abs(lz) > c.hz + r) return;
        const top = c.y + c.hy, bot = c.y - c.hy;
        if (ny + h <= bot + 0.02 || ny >= top) {
          // above the box: stand on it while any part of the body's footprint is over it
          if (ny >= top - 0.001 && top > ground) ground = Math.max(ground, top);
          return;
        }
        // overlapping vertically: walk up low steps (foundation edges, stairs)
        if (top - ny <= STEP && body.vy <= 0.5) { ground = Math.max(ground, top); return; }
        // jump-up: while airborne, pull onto a ledge that is within reach of the hands
        if (!body.onGround && opts.mantle !== false && top - ny <= MANTLE && body.vy > -7 && c.hy * 2 < 4) { ground = Math.max(ground, top); body.vy = Math.max(0, body.vy); return; }
        // closest point push-out
        const cx = Math.max(-c.hx, Math.min(c.hx, lx)), cz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ox = lx - cx, oz = lz - cz;
        let d = Math.hypot(ox, oz);
        let plx, plz;
        if (d < 1e-4) {
          // center inside box: push along least penetration axis
          const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
          if (px < pz) { plx = (lx < 0 ? -1 : 1) * (c.hx + r); plz = lz; } else { plx = lx; plz = (lz < 0 ? -1 : 1) * (c.hz + r); }
        } else {
          if (d >= r) return;
          plx = cx + ox / d * r; plz = cz + oz / d * r;
        }
        // back to world
        nx = c.x + plx * c.c + plz * c.s;
        nz = c.z - plx * c.s + plz * c.c;
        // ceiling bump
        if (body.vy > 0 && ny + h > bot && ny < bot) body.vy = 0;
      });
    }
    if (opts.noOcean !== false) {
      // keep inside the map
      const lim = W.half - 5;
      nx = Math.max(-lim, Math.min(lim, nx)); nz = Math.max(-lim, Math.min(lim, nz));
    }
    const tg = W.heightAt(nx, nz);
    ground = Math.max(ground, tg);
    if (ny <= ground + 0.001) {
      if (ground - ny > STEP + 0.4 && ground > tg + 0.01) {
        // tried to move into a tall ledge: cancel horizontal move
        nx = body.x; nz = body.z; ny = Math.max(ny, W.heightAt(nx, nz));
      } else { ny = ground; }
      if (body.vy < 0) { body.landSpeed = -body.vy; body.vy = 0; }
      onGround = true;
    } else if (ny - ground < 0.06 && body.vy <= 0) { onGround = true; }
    body.x = nx; body.y = ny; body.z = nz;
    body.onGround = onGround;
    body.groundY = ground;
    return body;
  }

  // Ray against colliders. Returns nearest {t, c, point, normal} or null. filter(c) to skip.
  rayColliders(ox, oy, oz, dx, dy, dz, maxT, filter) {
    let best = null, bt = maxT;
    const steps = Math.ceil(maxT / 8);
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(maxT, s * 8);
      const px = ox + dx * t, pz = oz + dz * t;
      this.grid.query(px, pz, 6, c => {
        if (seen.has(c)) return; seen.add(c);
        if (filter && !filter(c)) return;
        const hit = c.type === 'box' ? rayBox(ox, oy, oz, dx, dy, dz, c) : rayCyl(ox, oy, oz, dx, dy, dz, c);
        if (hit && hit.t < bt && hit.t >= 0) { bt = hit.t; best = hit; hit.c = c; }
      });
      if (best && best.t < t - 6) break;
    }
    return best;
  }
  // Ray against terrain by marching. Returns t or null.
  rayTerrain(ox, oy, oz, dx, dy, dz, maxT) {
    const W = this.world;
    let prevT = 0, prevD = oy - W.heightAt(ox, oz);
    if (prevD < 0) return 0;
    const step = 1.5;
    for (let t = step; t <= maxT + step; t += step) {
      const tt = Math.min(t, maxT);
      const y = oy + dy * tt, d = y - W.heightAt(ox + dx * tt, oz + dz * tt);
      if (d < 0) {
        // refine
        let a = prevT, b = tt;
        for (let i = 0; i < 6; i++) { const m = (a + b) / 2; const dm = oy + dy * m - W.heightAt(ox + dx * m, oz + dz * m); if (dm < 0) b = m; else a = m; }
        return (a + b) / 2;
      }
      prevT = tt; prevD = d;
      if (tt >= maxT) break;
    }
    return null;
  }
  // Line of sight between two points (true = clear).
  los(a, b, filter) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.01) return true;
    const ux = dx / L, uy = dy / L, uz = dz / L;
    const tt = this.rayTerrain(a.x, a.y, a.z, ux, uy, uz, L - 0.3);
    if (tt !== null) return false;
    const hc = this.rayColliders(a.x, a.y, a.z, ux, uy, uz, L - 0.3, c => c.solid && c.blocksSight !== false && (!filter || filter(c)));
    return !hc;
  }
}

export function rayBox(ox, oy, oz, dx, dy, dz, c) {
  // transform ray into box local space (rotation about Y by yaw: local = R(-yaw)?) consistent with move():
  // lx = dx*c - dz*s, lz = dx*s + dz*c
  const rx = ox - c.x, rz = oz - c.z, ry = oy - c.y;
  const lox = rx * c.c - rz * c.s, loz = rx * c.s + rz * c.c, loy = ry;
  const ldx = dx * c.c - dz * c.s, ldz = dx * c.s + dz * c.c, ldy = dy;
  let tmin = -Infinity, tmax = Infinity, nAxis = 0, nSign = 1;
  const o = [lox, loy, loz], d = [ldx, ldy, ldz], h = [c.hx, c.hy, c.hz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < -h[a] || o[a] > h[a]) return null; continue; }
    let t1 = (-h[a] - o[a]) / d[a], t2 = (h[a] - o[a]) / d[a];
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const t = tmin >= 0 ? tmin : 0;
  // normal in local -> world
  let lnx = 0, lny = 0, lnz = 0;
  if (nAxis === 0) lnx = nSign; else if (nAxis === 1) lny = nSign; else lnz = nSign;
  const nx = lnx * c.c + lnz * c.s, nz = -lnx * c.s + lnz * c.c;
  return { t, normal: { x: nx, y: lny, z: nz }, point: { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t } };
}

export function rayCyl(ox, oy, oz, dx, dy, dz, c) {
  const fx = ox - c.x, fz = oz - c.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null;
  const b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - c.r * c.r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0) return null;
  const y = oy + dy * t;
  if (y < c.y0 || y > c.y1) return null;
  const px = ox + dx * t, pz = oz + dz * t;
  const nl = Math.hypot(px - c.x, pz - c.z) || 1;
  return { t, normal: { x: (px - c.x) / nl, y: 0, z: (pz - c.z) / nl }, point: { x: px, y, z: pz } };
}

// Segment vs sphere (for hit tests). Returns t in [0,1] or null.
export function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const fx = ax - cx, fy = ay - cy, fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-12) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

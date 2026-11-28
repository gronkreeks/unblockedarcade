// Monument layouts: geometry, colliders, loot spawn points, recyclers, militia posts and radiation zones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBuilder } from './geo.js';
import { mulberry32 } from '../core/util.js';

const C = {
  concrete: 0x8f8c86, dark: 0x6b6964, asphalt: 0x3b3b3d, rust: 0x8a4b2a, metal: 0x7d868f, yellow: 0xc9a23a,
  red: 0x9a3a2a, white: 0xd8d8d0, green: 0x3d6b4a, blue: 0x3a5a8a, wood: 0x8a5d34, glass: 0x6a8a9a, orange: 0xc4682a, black: 0x2a2a2a,
};
const CONTAINER_COLS = [0x9a3a2a, 0x3a5a8a, 0x3d6b4a, 0xc4682a, 0x7d868f, 0x8a4b2a, 0xc9a23a];

// Which textured material each palette colour uses, and the tint it keeps.
const PAINTED = new Set([C.yellow, C.red, C.white, C.green, C.blue, C.orange, ...CONTAINER_COLS]);
function matFor(color) {
  if (color === C.concrete || color === C.dark) return ['concrete', color === C.dark ? 0xa8a8a8 : 0xffffff];
  if (color === C.asphalt) return ['asphalt', 0xffffff];
  if (color === C.rust) return ['rust', 0xffffff];
  if (color === C.metal) return ['corrugated', 0xffffff];
  if (color === C.wood) return ['wood', 0xffffff];
  if (color === C.glass) return ['glass', 0xffffff];
  if (color === C.black) return ['rubber', 0xffffff];
  if (PAINTED.has(color)) return ['paint', color];
  return ['rock', color];
}

class MonBuilder {
  constructor(m, physics, mats, world) {
    this.m = m; this.phys = physics; this.mats = mats; this.world = world;
    this.g = new GeoBuilder(0.5);
    this.xf = GeoBuilder.xf(m.x, m.y, m.z, m.rot);
    this.loot = []; this.recyclers = []; this.npcs = []; this.rads = []; this.colliders = [];
    this.rng = mulberry32((Math.abs(Math.round(m.x * 7 + m.z * 13)) + 1) >>> 0);
  }
  W(x, y, z) { return this.xf(x, y, z); }
  // y = bottom of the box (local, above pad)
  box(x, y, z, hx, hy, hz, color, opt = {}) {
    const yaw = opt.yaw || 0;
    const [mk, tint] = matFor(color); this.g.setMat(mk);
    this.g.box(this.xf, x, y + hy, z, hx, hy, hz, tint, yaw);
    if (opt.solid !== false) {
      const p = this.xf(x, y + hy, z);
      this.colliders.push(this.phys.add({ type: 'box', x: p[0], y: p[1], z: p[2], hx, hy, hz, yaw: this.m.rot + yaw, ref: this.m }));
    }
  }
  // A paved plate. Where the ground falls away under it, it becomes a solid concrete block down to
  // the ground (with collision) instead of a thin sheet hanging in the air.
  slab(x, z, hx, hz, color, y = 0.02) {
    const [mk, tint] = matFor(color); this.g.setMat(mk);
    const top = y + 0.04;
    let low = Infinity;
    if (this.world) {
      const sx = Math.max(1, Math.ceil(hx / 2.5)), sz = Math.max(1, Math.ceil(hz / 2.5));
      for (let a = 0; a <= sx; a++) for (let b = 0; b <= sz; b++) {
        const p = this.xf(x - hx + (2 * hx * a) / sx, 0, z - hz + (2 * hz * b) / sz);
        low = Math.min(low, this.world.heightAt(p[0], p[2]) - this.m.y);
      }
    }
    if (low < top - 0.1) {
      const bot = Math.max(low - 0.5, -14), hy = (top - bot) / 2;
      this.g.box(this.xf, x, bot + hy, z, hx, hy, hz, tint, 0, false);
      const p = this.xf(x, bot + hy, z);
      this.colliders.push(this.phys.add({ type: 'box', x: p[0], y: p[1], z: p[2], hx, hy, hz, yaw: this.m.rot, ref: this.m }));
    } else this.g.box(this.xf, x, y, z, hx, 0.04, hz, tint, 0, false);
  }
  cyl(x, y, z, r, h, color, solid = true, seg = 12) {
    const [mk, tint] = matFor(color); this.g.setMat(mk);
    this.g.cyl(this.xf, x, y, z, r, h, tint, Math.max(seg, 16));
    if (solid) { const p = this.xf(x, 0, z); this.colliders.push(this.phys.add({ type: 'cyl', x: p[0], z: p[2], y0: this.m.y + y, y1: this.m.y + y + h, r, ref: this.m })); }
  }
  // Rectangular room with walls; doors: [{side:'+z'|'-z'|'+x'|'-x', at, w, h}]. Returns door waypoints.
  room(cx, cz, w, d, h, color, doors = [], roofColor = C.dark, opt = {}) {
    const t = 0.3, hw = w / 2, hd = d / 2;
    const sides = [
      { s: '+z', ax: 'x', len: w, fx: cx, fz: cz + hd },
      { s: '-z', ax: 'x', len: w, fx: cx, fz: cz - hd },
      { s: '+x', ax: 'z', len: d, fx: cx + hw, fz: cz },
      { s: '-x', ax: 'z', len: d, fx: cx - hw, fz: cz },
    ];
    const ways = [];
    for (const S of sides) {
      const ds = doors.filter(o => o.side === S.s).sort((a, b) => a.at - b.at);
      let cur = -S.len / 2;
      const segs = [];
      for (const dr of ds) {
        segs.push([cur, dr.at - dr.w / 2]);
        // lintel
        const mid = dr.at, lh = h - dr.h;
        if (lh > 0.05) this._wallSeg(S, mid - dr.w / 2, mid + dr.w / 2, dr.h, h, t, color);
        cur = dr.at + dr.w / 2;
        // waypoint outside/inside the door
        const out = S.s[0] === '+' ? 2.2 : -2.2;
        if (S.ax === 'x') ways.push({ out: [S.fx + mid, S.fz + out], in: [S.fx + mid, S.fz - out * 0.8] });
        else ways.push({ out: [S.fx + out, S.fz + mid], in: [S.fx - out * 0.8, S.fz + mid] });
      }
      segs.push([cur, S.len / 2]);
      for (const [a, b] of segs) if (b - a > 0.05) this._wallSeg(S, a, b, 0, h, t, color);
    }
    if (!opt.noRoof) {
      this.box(cx, h, cz, hw + 0.2, 0.2, hd + 0.2, roofColor);
      // parapet, roof clutter and wall trims for detail
      for (const [x, z, a, b] of [[cx, cz + hd + 0.12, hw + 0.3, 0.1], [cx, cz - hd - 0.12, hw + 0.3, 0.1], [cx + hw + 0.12, cz, 0.1, hd + 0.3], [cx - hw - 0.12, cz, 0.1, hd + 0.3]]) this.box(x, h + 0.4, z, a, 0.22, b, C.dark, { solid: false });
      if (w > 7) { this.box(cx + hw * 0.4, h + 0.4, cz - hd * 0.3, 0.9, 0.45, 0.7, C.metal, { solid: false }); this.cyl(cx - hw * 0.5, h + 0.4, cz + hd * 0.4, 0.25, 1.2, C.metal, false, 10); }
      this.box(cx, 0, cz + hd + 0.16, hw + 0.15, 0.25, 0.06, C.dark, { solid: false });
      this.box(cx, 0, cz - hd - 0.16, hw + 0.15, 0.25, 0.06, C.dark, { solid: false });
    }
    // door frames
    for (const dr of doors) {
      const S = sides.find(q => q.s === dr.side);
      const off = S.s[0] === '+' ? 0.17 : -0.17;
      for (const e of [-1, 1]) {
        if (S.ax === 'x') this.box(S.fx + dr.at + e * (dr.w / 2 + 0.06), 0, S.fz + off, 0.06, dr.h / 2, 0.04, C.metal, { solid: false });
        else this.box(S.fx + off, 0, S.fz + dr.at + e * (dr.w / 2 + 0.06), 0.04, dr.h / 2, 0.06, C.metal, { solid: false });
      }
    }
    this.slab(cx, cz, hw, hd, opt.floor || C.dark, 0.03);
    return ways;
  }
  _wallSeg(S, a, b, y0, y1, t, color) {
    const mid = (a + b) / 2, half = (b - a) / 2, hh = (y1 - y0) / 2;
    if (S.ax === 'x') this.box(S.fx + mid, y0, S.fz, half, hh, t / 2, color);
    else this.box(S.fx, y0, S.fz + mid, t / 2, hh, half, color);
  }
  lootAt(x, z, kind, y = 0, via = null, yaw = 0) {
    const p = this.xf(x, y, z);
    const v = via ? via.map(q => { const w = this.xf(q[0], q[2] || 0, q[1]); return { x: w[0], y: w[1], z: w[2] }; }) : null;
    this.loot.push({ x: p[0], y: p[1], z: p[2], kind, via: v, yaw: this.m.rot + yaw, mon: this.m.id });
  }
  recycler(x, z, via = null, yaw = 0) {
    const p = this.xf(x, 0, z);
    const v = via ? via.map(q => { const w = this.xf(q[0], 0, q[1]); return { x: w[0], y: w[1], z: w[2] }; }) : null;
    this.recyclers.push({ x: p[0], y: p[1], z: p[2], yaw: this.m.rot + yaw, via: v, mon: this.m.id });
  }
  npc(x, z) { const p = this.xf(x, 0, z); this.npcs.push({ x: p[0], y: p[1], z: p[2], mon: this.m.id }); }
  rad(x, z, r, level, y1 = 30) { const p = this.xf(x, 0, z); this.rads.push({ x: p[0], z: p[2], r, level, y0: this.m.y - 2, y1: this.m.y + y1, mon: this.m.id }); }
  container(x, z, yaw, stacked = 1) {
    const col = CONTAINER_COLS[Math.floor(this.rng() * CONTAINER_COLS.length)];
    for (let s = 0; s < stacked; s++) this.box(x, s * 2.6, z, 3, 1.3, 1.2, s === 0 ? col : CONTAINER_COLS[Math.floor(this.rng() * CONTAINER_COLS.length)], { yaw });
  }
  barrelsAround(n, r0, r1) {
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2, r = r0 + this.rng() * (r1 - r0);
      this.lootAt(Math.cos(a) * r, Math.sin(a) * r, 'barrel');
    }
  }
  car(x, z, yaw) {
    const col = CONTAINER_COLS[Math.floor(this.rng() * CONTAINER_COLS.length)];
    this.box(x, 0.3, z, 0.95, 0.45, 2.1, col, { yaw });
    this.box(x, 1.2, z - 0.2 * Math.cos(yaw), 0.85, 0.35, 1.1, C.glass, { yaw, solid: false });
  }
  finish(scene) {
    const meshes = this.g.meshes(k => this.mats.get(k, { vc: true }));
    for (const mesh of meshes) scene.add(mesh);
    return { m: this.m, mesh: meshes[0], meshes, loot: this.loot, recyclers: this.recyclers, npcs: this.npcs, rads: this.rads, colliders: this.colliders };
  }
}

const LAYOUTS = {
  supermarket(b) {
    b.slab(0, 8, 24, 16, C.asphalt);
    const w = b.room(0, -4, 26, 16, 5.5, C.concrete, [{ side: '+z', at: 0, w: 5, h: 3.2 }, { side: '-z', at: 8, w: 1.8, h: 2.5 }], C.dark);
    b.box(0, 5.7, 4.2, 6, 0.6, 0.1, C.red, { solid: false });
    for (let i = -2; i <= 2; i++) b.box(i * 4.6, 0, -5.5, 0.5, 0.9, 4.2, C.metal);
    b.box(-8, 0, 1.5, 3, 0.55, 0.6, C.wood);
    const v = [w[0].out, w[0].in];
    b.lootAt(-2.3, -7, 'food_crate', 0, v); b.lootAt(2.3, -3, 'food_crate', 0, v); b.lootAt(6.9, -9, 'food_crate', 0, v);
    b.lootAt(-11, -9.5, 'crate', 0, v); b.lootAt(11, 1, 'crate', 0, v);
    b.recycler(-10.5, -1.5, v, Math.PI / 2);
    b.car(-12, 12, 0.1); b.car(9, 14, -0.2); b.car(3, 18, 1.5);
    b.barrelsAround(5, 16, 24);
  },
  gas_station(b) {
    b.slab(2, 4, 22, 14, C.asphalt);
    const w = b.room(-10, -6, 12, 9, 4, C.white, [{ side: '+z', at: 0, w: 2.2, h: 2.6 }], C.red);
    for (const [x, z] of [[1, -1], [11, -1], [1, 9], [11, 9]]) b.box(x, 0, z, 0.3, 2.6, 0.3, C.white);
    b.box(6, 5.2, 4, 7, 0.25, 6, C.red, { solid: false });
    b.box(6, 0, 1.5, 0.6, 0.9, 0.4, C.metal); b.box(6, 0, 6.5, 0.6, 0.9, 0.4, C.metal);
    b.box(-10, 0, -8.5, 4, 0.5, 0.5, C.metal);
    const v = [w[0].out, w[0].in];
    b.lootAt(-14, -9, 'food_crate', 0, v); b.lootAt(-6, -9, 'food_crate', 0, v); b.lootAt(-14, -3, 'crate', 0, v);
    b.recycler(-2, -9, null, 0);
    b.car(14, 12, 0.4);
    b.barrelsAround(5, 14, 24);
  },
  fuel_stop(b) {
    b.slab(0, 2, 22, 16, C.asphalt);
    const g = b.room(8, -6, 14, 10, 5, C.concrete, [{ side: '+z', at: 0, w: 10, h: 4.2 }], C.rust);
    const s = b.room(-9, -6, 10, 8, 4, C.yellow, [{ side: '+z', at: 1, w: 2, h: 2.6 }], C.dark);
    b.cyl(-4, 0, -16, 1.6, 7, C.white); b.cyl(0, 0, -16, 1.6, 7, C.white);
    b.box(8, 0, -9, 4, 0.5, 0.6, C.metal);
    b.car(6, -4, 0);
    b.lootAt(13, -9, 'crate', 0, [g[0].out, g[0].in]); b.lootAt(3, -9.5, 'crate', 0, [g[0].out, g[0].in]);
    b.lootAt(-12, -8.5, 'food_crate', 0, [s[0].out, s[0].in]); b.lootAt(-6, -8.5, 'food_crate', 0, [s[0].out, s[0].in]);
    b.recycler(12, -3, [g[0].out, g[0].in], -Math.PI / 2);
    b.barrelsAround(6, 15, 25);
  },
  lighthouse(b) {
    const R = 3.2, H = 24, seg = 16;
    // tower wall segments with a ground door facing land (-z)
    for (let i = 0; i < seg; i++) {
      const a = (i + 0.5) / seg * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const yaw = -a + Math.PI / 2; // align box x-extent tangentially
      const half = Math.PI * R / seg + 0.05;
      const isDoor = Math.abs(a - Math.PI * 1.5) < 0.25;
      b.box(x, isDoor ? 2.6 : 0, z, half, isDoor ? (H - 2.6) / 2 : H / 2, 0.18, i % 4 < 2 ? C.white : C.red, { yaw });
    }
    b.cyl(0, 0, 0, 0.4, H, C.dark);
    const steps = 45, way = [[0, -R - 2.2], [0, -R + 1.2]];
    let lastA = 0;
    for (let i = 0; i < steps; i++) {
      const a = Math.PI * 1.5 + 0.4 + i * 0.42, y = 0.25 + i * 0.5;
      const x = Math.cos(a) * 1.7, z = Math.sin(a) * 1.7;
      b.box(x, y, z, 1.25, 0.12, 0.42, C.concrete, { yaw: -a });
      if (i % 3 === 0 || i === steps - 1) way.push([x, z, y]);
      lastA = a;
    }
    const topY = 0.25 + steps * 0.5;
    const lx = Math.cos(lastA + 0.7) * 1.7, lz = Math.sin(lastA + 0.7) * 1.7;
    b.box(lx, topY - 0.2, lz, 1.3, 0.12, 1.3, C.concrete, { yaw: -(lastA + 0.7) });
    b.cyl(0, H, 0, R + 0.4, 0.4, C.dark, false, 16);
    b.cyl(0, H + 0.4, 0, 1.8, 3, C.glass, false, 12);
    b.cyl(0, H + 3.4, 0, 2.2, 0.8, C.red, false, 12);
    b.lootAt(lx, lz, 'crate', topY, way.concat([[lx, lz, topY]]));
    const hs = b.room(9, -6, 7, 6, 3.2, C.white, [{ side: '-z', at: 0, w: 1.6, h: 2.4 }], C.red);
    b.lootAt(10.5, -4.5, 'food_crate', 0, [hs[0].out, hs[0].in]);
    b.barrelsAround(4, 6, 14);
  },
  mining_outpost(b) {
    b.slab(0, 0, 18, 18, C.dark);
    const s1 = b.room(-8, -6, 10, 7, 4, C.rust, [{ side: '+z', at: 0, w: 2.4, h: 2.8 }], C.dark);
    const s2 = b.room(9, 8, 8, 6, 3.5, C.metal, [{ side: '-x', at: 0, w: 2, h: 2.6 }], C.rust);
    for (let i = 0; i < 6; i++) b.box(-2 + i * 2.2, i * 0.9 + 1, 6 - i * 0.6, 1.2, 0.2, 0.6, C.black, { solid: i > 2 });
    for (let i = 0; i < 4; i++) b.box(-2 + i * 2.2 * 1.5, 0, 6 - i * 0.9, 0.15, 0.6 + i * 0.7, 0.15, C.metal);
    b.cyl(12, 0, -8, 2.4, 9, C.metal); b.cyl(12, 9, -8, 2.4, 1, C.rust, false);
    for (let i = 0; i < 5; i++) b.box(-14 + i * 1.6, 0, 12 + (i % 2), 1.1, 0.6 - i * 0.05, 1.1, 0x6b5a48, { yaw: i });
    b.lootAt(-11, -8.5, 'crate', 0, [s1[0].out, s1[0].in]); b.lootAt(-5, -8.5, 'crate', 0, [s1[0].out, s1[0].in]);
    b.lootAt(11.5, 9.5, 'food_crate', 0, [s2[0].out, s2[0].in]);
    b.recycler(-3, -1, null, 0);
    b.barrelsAround(5, 10, 18);
  },
  harbour(b) {
    // +z faces the sea
    b.slab(0, -18, 40, 26, C.concrete);
    b.box(0, -9, 32, 30, 4.5, 22, C.concrete);        // dock (top at local y 0)
    b.box(-45, -9, 22, 8, 4.5, 14, C.concrete);
    for (const x of [-18, 14]) {                       // gantry cranes
      for (const [dx, dz] of [[-5, 18], [5, 18], [-5, 34], [5, 34]]) b.box(x + dx, 0, dz, 0.5, 9, 0.5, C.yellow);
      b.box(x, 18, 26, 6, 0.6, 12, C.yellow, { solid: false }); b.box(x, 18.6, 40, 1, 0.5, 8, C.yellow, { solid: false });
    }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
      if (b.rng() < 0.25) continue;
      b.container(-28 + c * 8, -36 + r * 6, 0, b.rng() < 0.4 ? 2 : 1);
    }
    const wh = b.room(22, -22, 22, 14, 7, C.metal, [{ side: '+z', at: 0, w: 8, h: 5.5 }, { side: '-x', at: 3, w: 2, h: 2.6 }], C.rust);
    const off = b.room(-28, -6, 10, 6, 3.5, C.white, [{ side: '+z', at: 0, w: 1.8, h: 2.5 }], C.blue);
    b.box(22, 0, -26, 6, 0.6, 1.2, C.wood); b.box(16, 0, -18, 1.2, 1.3, 1.2, C.wood);
    b.lootAt(26, -26, 'military_crate', 0, [wh[0].out, wh[0].in]);
    b.lootAt(15, -27, 'crate', 0, [wh[0].out, wh[0].in]); b.lootAt(29, -18, 'crate', 0, [wh[0].out, wh[0].in]);
    b.lootAt(-30, -7.5, 'food_crate', 0, [off[0].out, off[0].in]);
    b.lootAt(0, 22, 'crate', 0); b.lootAt(-10, 40, 'military_crate', 0); b.lootAt(-44, 28, 'crate', 0);
    b.recycler(14, -12, null, Math.PI);
    b.npc(0, 20); b.npc(20, -10); b.npc(-20, -20);
    b.barrelsAround(8, 20, 45);
  },
  train_yard(b) {
    b.slab(0, 0, 75, 50, C.dark);
    for (const z of [-30, -20, -10]) { b.box(0, 0, z - 0.75, 74, 0.08, 0.08, C.metal, { solid: false }); b.box(0, 0, z + 0.75, 74, 0.08, 0.08, C.metal, { solid: false }); }
    for (const [x, z] of [[-40, -30], [-26, -30], [10, -20], [24, -20], [45, -10], [-15, -10]]) {
      b.box(x, 0.6, z, 6, 1.6, 1.5, CONTAINER_COLS[Math.floor(b.rng() * CONTAINER_COLS.length)]);
    }
    const shed = b.room(0, 25, 40, 20, 9, C.rust, [{ side: '+x', at: 0, w: 10, h: 7 }, { side: '-x', at: 0, w: 10, h: 7 }, { side: '-z', at: -10, w: 3, h: 3 }], C.dark);
    b.box(-8, 0, 25, 8, 1.6, 1.6, C.blue); b.box(10, 0, 22, 3, 1, 3, C.metal);
    const ctl = b.room(-50, 32, 10, 8, 6, C.concrete, [{ side: '+x', at: 0, w: 2, h: 2.6 }], C.dark);
    for (let i = 0; i < 6; i++) b.container(40 + (i % 2) * 7, 22 + Math.floor(i / 2) * 5, Math.PI / 2 * 0, b.rng() < 0.5 ? 2 : 1);
    const vs = [shed[0].out, shed[0].in];
    b.lootAt(4, 30, 'military_crate', 0, vs); b.lootAt(-14, 18, 'military_crate', 0, [shed[1].out, shed[1].in]);
    b.lootAt(16, 32, 'crate', 0, vs); b.lootAt(-17, 32, 'crate', 0, [shed[1].out, shed[1].in]);
    b.lootAt(-52, 34, 'crate', 0, [ctl[0].out, ctl[0].in]); b.lootAt(-47, 30, 'food_crate', 0, [ctl[0].out, ctl[0].in]);
    b.lootAt(30, -14, 'crate', 0);
    b.recycler(-42, 26, null, 0);
    b.rad(0, 25, 18, 1, 10);
    b.npc(0, 10); b.npc(-30, 5); b.npc(30, 5); b.npc(0, -40);
    b.barrelsAround(8, 25, 60);
  },
  launch_site(b) {
    b.slab(0, 0, 100, 90, C.dark);
    const hall = b.room(0, 0, 60, 28, 14, C.concrete, [{ side: '-z', at: -10, w: 8, h: 6 }, { side: '+x', at: 0, w: 6, h: 5 }, { side: '-x', at: 6, w: 3, h: 3 }], C.metal);
    for (let i = -2; i <= 2; i++) b.box(i * 10, 0, 6, 2.5, 2 + Math.abs(i), 3, C.metal);
    b.box(0, 5, -8, 26, 0.2, 2, C.yellow, { solid: false });
    // gantry + rocket
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) b.box(55 + dx, 0, 40 + dz, 0.45, 21, 0.45, C.red);
    for (let y = 6; y < 42; y += 8) b.box(55, y, 40, 4.5, 0.2, 4.5, C.red, { solid: false });
    b.cyl(55, 0, 52, 3.2, 38, C.white, true, 16); b.cyl(55, 38, 52, 3.2, 6, C.white, false, 16);
    const wh = b.room(-50, 40, 20, 14, 8, C.metal, [{ side: '-z', at: 0, w: 6, h: 5 }], C.rust);
    const wh2 = b.room(-55, -40, 16, 12, 7, C.rust, [{ side: '+x', at: 0, w: 4, h: 4 }], C.dark);
    for (const [x, z] of [[30, -45], [-15, -55], [60, -20]]) { b.box(x, 0, z, 0.4, 3, 0.4, C.metal); b.cyl(x, 6, z, 3.5, 0.3, C.white, false, 14); }
    for (let i = 0; i < 10; i++) b.box(-95 + i * 20, 0, -88, 9, 1.2, 0.08, C.metal);
    const vh = [hall[0].out, hall[0].in], vh2 = [hall[1].out, hall[1].in];
    b.lootAt(-20, -9, 'military_crate', 0, vh); b.lootAt(20, -9, 'military_crate', 0, vh2); b.lootAt(-25, 10, 'military_crate', 0, vh);
    b.lootAt(25, 10, 'crate', 0, vh2); b.lootAt(-5, -10, 'crate', 0, vh);
    b.lootAt(-55, 44, 'military_crate', 0, [wh[0].out, wh[0].in]); b.lootAt(-44, 43, 'crate', 0, [wh[0].out, wh[0].in]);
    b.lootAt(-59, -42, 'crate', 0, [wh2[0].out, wh2[0].in]); b.lootAt(-51, -44, 'food_crate', 0, [wh2[0].out, wh2[0].in]);
    b.lootAt(52, 34, 'crate', 0);
    b.recycler(-40, 30, null, 0);
    b.rad(0, 0, 30, 2, 15); b.rad(55, 46, 14, 1, 45);
    b.npc(0, -25); b.npc(-30, -20); b.npc(30, -20); b.npc(40, 30); b.npc(-40, 20); b.npc(0, 30); b.npc(-60, -25); b.npc(70, 0);
    b.barrelsAround(10, 40, 95);
  },
  airfield(b) {
    b.slab(0, 48, 115, 12, C.asphalt);
    b.slab(0, 0, 100, 60, C.dark, 0.01);
    for (let x = -110; x <= 110; x += 12) b.slab(x, 48, 3, 0.25, C.white, 0.05);
    const hs = [];
    for (const x of [-60, -25, 10]) {
      hs.push(b.room(x, -20, 26, 22, 11, C.metal, [{ side: '+z', at: 0, w: 18, h: 9 }], C.green));
    }
    // plane wreck in first hangar
    b.box(-60, 0.5, -22, 1.4, 1.3, 7, C.white); b.box(-60, 1.4, -22, 8, 0.2, 1.6, C.white, { solid: false });
    const ctl = b.room(55, -5, 14, 8, 4, C.concrete, [{ side: '+z', at: 0, w: 2, h: 2.6 }], C.dark);
    b.box(55, 4, -25, 3, 6, 3, C.concrete); b.box(55, 16, -25, 4, 1.5, 4, C.glass, { solid: false });
    b.lootAt(-66, -26, 'military_crate', 0, [hs[0][0].out, hs[0][0].in]); b.lootAt(-54, -14, 'crate', 0, [hs[0][0].out, hs[0][0].in]);
    b.lootAt(-30, -27, 'military_crate', 0, [hs[1][0].out, hs[1][0].in]); b.lootAt(-18, -27, 'crate', 0, [hs[1][0].out, hs[1][0].in]);
    b.lootAt(5, -27, 'military_crate', 0, [hs[2][0].out, hs[2][0].in]); b.lootAt(15, -12, 'crate', 0, [hs[2][0].out, hs[2][0].in]);
    b.lootAt(52, -7, 'food_crate', 0, [ctl[0].out, ctl[0].in]); b.lootAt(58, -7, 'crate', 0, [ctl[0].out, ctl[0].in]);
    b.recycler(45, 3, null, Math.PI);
    b.rad(-25, -20, 12, 1, 11);
    b.npc(-60, 0); b.npc(-25, 0); b.npc(10, 0); b.npc(55, 10); b.npc(30, 30); b.npc(-80, 30);
    b.barrelsAround(10, 30, 100);
  },
};

export function buildMonuments(world, scene, physics, mats) {
  const out = [];
  for (const m of world.monuments) {
    const b = new MonBuilder(m, physics, mats, world);
    LAYOUTS[m.type](b);
    out.push(b.finish(scene));
  }
  // All monuments together are only a few thousand triangles: one mesh per material for the whole
  // island draws them in a handful of calls instead of five or so per monument.
  const by = new Map();
  for (const md of out) for (const mesh of md.meshes) { const k = mesh.material.id + (mesh.castShadow ? 's' : '') + (mesh.receiveShadow ? 'r' : ''); if (!by.has(k)) by.set(k, []); by.get(k).push(mesh); }
  for (const list of by.values()) {
    if (list.length < 2) continue;
    for (const m of list) m.updateMatrixWorld(true);
    const g = mergeGeometries(list.map(m => m.geometry.clone().applyMatrix4(m.matrixWorld)));
    if (!g) continue;
    const merged = new THREE.Mesh(g, list[0].material);
    merged.castShadow = list[0].castShadow; merged.receiveShadow = list[0].receiveShadow;
    for (const m of list) { scene.remove(m); m.geometry.dispose(); }
    scene.add(merged);
  }
  return out;
}

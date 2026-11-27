// Procedural vegetation and natural props: tree variants (pine, snowy pine, oak, palm, cactus, dead),
// ore rocks, pickups, and a streamed decoration layer (grass, bushes, ferns, stones, fallen logs,
// branches, dead trees) placed deterministically around the camera with instanced rendering.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hash2, clamp } from '../core/util.js';
import { BIOME } from '../world/WorldGeneration.js';

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function prep(g) { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; }
function merge(list) { return list.length ? mergeGeometries(list.map(prep)) : null; }
function jitter(g, amt, rng, keepBottom = true) {
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, [(rng() - 0.5) * amt, (rng() - 0.5) * amt * 0.6, (rng() - 0.5) * amt]);
    const d = seen.get(key);
    if (keepBottom && p.getY(i) <= 0.001) continue;
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  g.computeVertexNormals();
  return g;
}
// Cylinder from a to b with radii r0 (at a) and r1 (at b).
function limb(a, b, r0, r1, seg = 7) {
  const dir = b.clone().sub(a), len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 3, false);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * len * 0.5);
  return g;
}

// ---------- trees ----------
function pine(rng, snow, lod) {
  const H = 9 + rng() * 6;
  const bark = [], fol = [], cap = [];
  bark.push(limb(v3(0, -0.5, 0), v3((rng() - 0.5) * 0.4, H, (rng() - 0.5) * 0.4), 0.38, 0.05, lod ? 5 : 8));
  const layers = lod ? 3 : 7;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const y = 2.2 + t * (H - 2.6);
    const r = (2.9 - t * 2.3) * (0.85 + rng() * 0.3);
    const h = (H - 2.2) / layers * 1.9;
    const c = new THREE.ConeGeometry(r, h, lod ? 6 : 11, lod ? 1 : 3, true);
    if (!lod) jitter(c, 0.28, rng, false);
    c.rotateY(rng() * 6.28); c.translate(0, y + h / 2, 0);
    fol.push(c);
    if (!lod) { const inner = new THREE.ConeGeometry(r * 0.6, h * 0.9, 7, 1, false); inner.translate(0, y + h / 2, 0); fol.push(inner); }
    if (snow && !lod && i % 2 === 0) { const s = new THREE.ConeGeometry(r * 0.75, h * 0.35, 9, 1, true); jitter(s, 0.3, rng, false); s.translate(0, y + h * 0.62, 0); cap.push(s); }
  }
  return { bark: merge(bark), foliage: merge(fol), snow: merge(cap), folKey: 'needles', h: H };
}
function oak(rng, lod) {
  const H = 5 + rng() * 2.5;
  const bark = [], fol = [];
  const top = v3((rng() - 0.5) * 0.5, H, (rng() - 0.5) * 0.5);
  bark.push(limb(v3(0, -0.5, 0), top, 0.45, 0.22, lod ? 5 : 9));
  const branches = lod ? 3 : 4 + Math.floor(rng() * 3);
  const tips = [top.clone().add(v3(0, 1.6, 0))];
  for (let i = 0; i < branches; i++) {
    const a = i / branches * Math.PI * 2 + rng() * 0.6, start = v3(0, H * (0.55 + rng() * 0.35), 0);
    const len = 2.2 + rng() * 1.8;
    const end = start.clone().add(v3(Math.cos(a) * len, len * (0.45 + rng() * 0.4), Math.sin(a) * len));
    if (!lod) bark.push(limb(start, end, 0.17, 0.06, 6));
    tips.push(end);
  }
  for (const t of tips) {
    const n = lod ? 1 : 3;
    for (let k = 0; k < n; k++) {
      const r = (lod ? 2.6 : 1.5 + rng() * 0.9);
      const b = new THREE.IcosahedronGeometry(r, lod ? 0 : 1);
      if (!lod) jitter(b, 0.6, rng, false);
      b.scale(1, 0.75, 1);
      b.translate(t.x + (rng() - 0.5) * 1.4, t.y + (rng() - 0.3) * 0.9, t.z + (rng() - 0.5) * 1.4);
      fol.push(b);
    }
  }
  return { bark: merge(bark), foliage: merge(fol), folKey: 'leaves', h: H + 3 };
}
function palm(rng, lod) {
  const H = 6 + rng() * 3, lean = (rng() - 0.5) * 2;
  const curve = new THREE.QuadraticBezierCurve3(v3(0, -0.3, 0), v3(lean * 0.3, H * 0.5, 0), v3(lean, H, 0));
  const trunk = new THREE.TubeGeometry(curve, lod ? 4 : 12, 0.26, lod ? 5 : 8);
  const fol = [];
  const top = curve.getPoint(1);
  const fronds = lod ? 5 : 8;
  for (let i = 0; i < fronds; i++) {
    const a = i / fronds * Math.PI * 2 + rng() * 0.3;
    const L = 3.2 + rng() * 1.2;
    const g = new THREE.PlaneGeometry(1.1, L, 1, lod ? 2 : 6);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k) + L / 2; const t = y / L; p.setXYZ(k, p.getX(k) * (1 - t * 0.7), y, -t * t * 1.6); }
    g.rotateX(-Math.PI / 2 + 0.35); g.rotateY(a); g.translate(top.x, top.y, top.z);
    g.computeVertexNormals();
    fol.push(g);
  }
  return { bark: merge([trunk]), foliage: merge(fol), folKey: 'leaves', h: H + 1 };
}
function cactus(rng, lod) {
  const prof = [];
  const H = 2.6 + rng() * 1.4;
  for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(0.32 * Math.sqrt(Math.max(0.02, 1 - Math.pow(t, 6))), t * H)); }
  const parts = [new THREE.LatheGeometry(prof, lod ? 6 : 14)];
  if (!lod) {
    // ribs
    const p = parts[0].attributes.position;
    for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + Math.cos(a * 7) * 0.06; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    parts[0].computeVertexNormals();
  }
  for (const s of [-1, 1]) {
    if (rng() < 0.3) continue;
    const y = H * (0.35 + rng() * 0.25);
    parts.push(limb(v3(0, y, 0), v3(s * 0.7, y + 0.1, 0), 0.18, 0.18, 6));
    parts.push(limb(v3(s * 0.7, y, 0), v3(s * 0.7, y + 0.9 + rng() * 0.6, 0), 0.18, 0.13, 6));
  }
  return { bark: merge(parts), foliage: null, barkKey: 'cactus', h: H };
}
function deadTree(rng) {
  const H = 5 + rng() * 4;
  const parts = [limb(v3(0, -0.4, 0), v3((rng() - 0.5) * 0.6, H, (rng() - 0.5) * 0.6), 0.32, 0.04, 7)];
  for (let i = 0; i < 6; i++) {
    const y = H * (0.35 + rng() * 0.55), a = rng() * 6.28, L = 1 + rng() * 2;
    const s = v3(0, y, 0), e = s.clone().add(v3(Math.cos(a) * L, L * (0.2 + rng() * 0.6), Math.sin(a) * L));
    parts.push(limb(s, e, 0.09, 0.02, 5));
  }
  return { bark: merge(parts), foliage: null, h: H };
}

const TREE_GEN = { pine: (r, l) => pine(r, false, l), pine_snow: (r, l) => pine(r, true, l), oak, palm, cactus };
const FOL_TINT = { pine: 0x8aa874, pine_snow: 0x7f9c80, oak: 0x9cbc70, palm: 0xa8bc6a };

// ---------- rocks ----------
export function rockGeometry(seed, detail = 3, kind = 'stone') {
  const rng = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1.1, detail);
  const p = g.attributes.position;
  const sx = 1.1 + rng() * 0.3, sz = 0.85 + rng() * 0.3, sy = 0.65 + rng() * 0.15;
  const f = [rng() * 10, rng() * 10, rng() * 10];
  const col = new Float32Array(p.count * 3);
  const base = kind === 'sulfur' ? [0.78, 0.74, 0.55] : kind === 'metal' ? [0.72, 0.66, 0.6] : [0.86, 0.86, 0.84];
  const vein = kind === 'sulfur' ? [1.0, 0.85, 0.25] : kind === 'metal' ? [0.85, 0.5, 0.28] : [0.75, 0.74, 0.72];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 3.1 + f[0]) * Math.cos(z * 2.7 + f[1]) * 0.12 + Math.sin(y * 5.3 + x * 4.1 + f[2]) * 0.06 + Math.sin((x + z) * 9.1) * 0.025;
    const k = 1 + n;
    p.setXYZ(i, x * k * sx, Math.max(-0.35, y * k * sy), z * k * sz);
    const v = Math.sin(x * 7.3 + z * 5.9 + f[0]) * Math.sin(y * 6.1 + f[1]);
    const t = kind === 'stone' ? 0 : clamp((v - 0.35) * 3, 0, 1);
    col[i * 3] = base[0] + (vein[0] - base[0]) * t; col[i * 3 + 1] = base[1] + (vein[1] - base[1]) * t; col[i * 3 + 2] = base[2] + (vein[2] - base[2]) * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.5);
  return g;
}

// ---------- library of shared variant geometries ----------
export class VegetationLibrary {
  constructor(mats) {
    this.mats = mats; this.variants = {}; this.misc = {};
  }
  tree(kind, variant) {
    const key = kind + variant;
    if (!this.variants[key]) {
      const gen = TREE_GEN[kind] || TREE_GEN.oak;
      const hi = gen(mulberry32(hash2(variant, kind.length, 3) * 1e9 | 0), false);
      const lo = gen(mulberry32(hash2(variant, kind.length, 3) * 1e9 | 0), true);
      const M = this.mats;
      const barkMat = kind === 'cactus' ? M.get('leather', { color: 0x5f8a45 }) : M.get('bark', { color: kind === 'palm' ? 0xb09070 : 0xffffff });
      const folMat = hi.foliage ? M.get(hi.folKey, { color: FOL_TINT[kind] || 0x6f8a50 }) : null;
      const parts = (t) => [{ geo: t.bark, mat: barkMat, shadow: true }, t.foliage && { geo: t.foliage, mat: folMat, shadow: true, tint: true }, t.snow && { geo: t.snow, mat: M.get('snow') }].filter(Boolean);
      this.variants[key] = { hi: parts(hi), lo: parts(lo), h: hi.h };
    }
    return this.variants[key];
  }
  rock(kind, variant, lod) {
    const key = 'rock' + kind + variant + (lod ? 'l' : '');
    if (!this.misc[key]) this.misc[key] = [{ geo: rockGeometry(variant * 977 + kind.length, lod ? 1 : 3, kind), mat: this.mats.get('rock', { vc: true }), shadow: !lod }];
    return this.misc[key];
  }
  pickup(kind) {
    if (this.misc[kind]) return this.misc[kind];
    const M = this.mats, rng = mulberry32(kind.length * 31);
    let out;
    if (kind === 'hemp') {
      const st = [], lv = [];
      for (let i = 0; i < 5; i++) { const a = i * 1.3, x = Math.cos(a) * 0.12, z = Math.sin(a) * 0.12; st.push(limb(v3(x, 0, z), v3(x * 1.6, 1.1 + rng() * 0.3, z * 1.6), 0.015, 0.01, 4)); for (let k = 0; k < 3; k++) { const p = new THREE.PlaneGeometry(0.35, 0.18); p.rotateX(-Math.PI / 2 + 0.4); p.rotateY(a + k * 2); p.translate(x * 1.4, 0.45 + k * 0.25, z * 1.4); lv.push(p); } }
      out = [{ geo: merge(st), mat: M.get('leather', { color: 0x5a8a3a }) }, { geo: merge(lv), mat: M.get('leaves', { color: 0x8ab85a }) }];
    } else if (kind === 'wood_pile') {
      const logs = []; for (let i = 0; i < 4; i++) logs.push(limb(v3(-0.5, 0.12 + (i > 2 ? 0.22 : 0), -0.25 + i % 3 * 0.24), v3(0.5, 0.12 + (i > 2 ? 0.22 : 0), -0.25 + i % 3 * 0.24 + 0.05), 0.11, 0.1, 7));
      out = [{ geo: merge(logs), mat: M.get('bark'), shadow: true }];
    } else if (kind === 'mushroom') {
      const s = [new THREE.CylinderGeometry(0.035, 0.045, 0.16, 6).translate(0, 0.08, 0)], c = [new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.15, 0)];
      out = [{ geo: merge(s), mat: M.get('flat', { color: 0xe8dcc0 }) }, { geo: merge(c), mat: M.get('leather', { color: 0xa8784a }) }];
    } else if (kind === 'berries') {
      const b = []; for (let i = 0; i < 5; i++) { const g = new THREE.IcosahedronGeometry(0.32, 1); jitter(g, 0.15, rng, false); g.translate((rng() - 0.5) * 0.5, 0.3 + rng() * 0.25, (rng() - 0.5) * 0.5); b.push(g); }
      const fr = []; for (let i = 0; i < 14; i++) fr.push(new THREE.SphereGeometry(0.04, 6, 4).translate((rng() - 0.5) * 0.8, 0.25 + rng() * 0.45, (rng() - 0.5) * 0.8));
      out = [{ geo: merge(b), mat: M.get('leaves', { color: 0x5f8a45 }) }, { geo: merge(fr), mat: M.get('flat', { color: 0x6b2f90 }) }];
    } else {
      const kk = kind === 'metal_pile' ? 'metal' : kind === 'sulfur_pile' ? 'sulfur' : 'stone';
      const rs = []; for (let i = 0; i < 3; i++) { const g = rockGeometry(i * 7 + kk.length, 1, kk); g.scale(0.22, 0.22, 0.22); g.translate((rng() - 0.5) * 0.4, 0.08, (rng() - 0.5) * 0.4); rs.push(g); }
      const merged = mergeGeometries(rs.map(g => { const n = g.toNonIndexed(); return n; }));
      out = [{ geo: merged, mat: M.get('rock', { vc: true }), shadow: true }];
    }
    this.misc[kind] = out;
    return out;
  }
  decor(kind) {
    if (this.misc['d' + kind]) return this.misc['d' + kind];
    const M = this.mats, rng = mulberry32(kind.length * 77 + 5);
    let out;
    switch (kind) {
      case 'grass': {
        const q = []; for (let i = 0; i < 3; i++) { const p = new THREE.PlaneGeometry(0.9, 0.55); p.translate(0, 0.27, 0); p.rotateY(i * Math.PI / 3); q.push(p); }
        const g = merge(q); const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); // lit like the ground
        out = [{ geo: g, mat: M.get('blades', { color: 0xbfd08a }), tint: true }]; break;
      }
      case 'bush': {
        const b = []; for (let i = 0; i < 4; i++) { const g = new THREE.IcosahedronGeometry(0.55 + rng() * 0.25, 1); jitter(g, 0.25, rng, false); g.translate((rng() - 0.5) * 0.9, 0.4 + rng() * 0.3, (rng() - 0.5) * 0.9); b.push(g); }
        out = [{ geo: merge(b), mat: M.get('leaves', { color: 0x6f8a4a }), tint: true, shadow: true }]; break;
      }
      case 'fern': {
        const f = []; for (let i = 0; i < 7; i++) { const L = 0.8 + rng() * 0.4; const g = new THREE.PlaneGeometry(0.35, L, 1, 4); const p = g.attributes.position; for (let k = 0; k < p.count; k++) { const y = p.getY(k) + L / 2, t = y / L; p.setXYZ(k, p.getX(k) * (1 - t * 0.8), y * 0.8, -t * t * 0.5); } g.rotateY(i / 7 * Math.PI * 2); g.computeVertexNormals(); f.push(g); }
        out = [{ geo: merge(f), mat: M.get('leaves', { color: 0x5f8a3a }), tint: true }]; break;
      }
      case 'stone': out = [{ geo: (() => { const g = rockGeometry(91, 1, 'stone'); g.scale(0.35, 0.3, 0.35); return g; })(), mat: M.get('rock', { vc: true }), shadow: true }]; break;
      case 'boulder': out = [{ geo: (() => { const g = rockGeometry(173, 2, 'stone'); g.scale(1.6, 1.4, 1.6); return g; })(), mat: M.get('rock', { vc: true }), shadow: true }]; break;
      case 'log': out = [{ geo: merge([limb(v3(-2, 0.25, 0), v3(2, 0.3, 0.1), 0.28, 0.24, 9)]), mat: M.get('bark'), shadow: true }]; break;
      case 'branch': { const b = [limb(v3(-0.8, 0.05, 0), v3(0.8, 0.07, 0.1), 0.05, 0.03, 5), limb(v3(0, 0.06, 0), v3(0.4, 0.08, 0.45), 0.03, 0.015, 4)]; out = [{ geo: merge(b), mat: M.get('bark') }]; break; }
      case 'dead': { const d = deadTree(rng); out = [{ geo: d.bark, mat: M.get('bark', { color: 0xa09080 }), shadow: true }]; break; }
    }
    this.misc['d' + kind] = out;
    return out;
  }
}

// ---------- streamed decoration layer ----------
const DECOR_TYPES = {
  // per 32 m cell, how many of each per biome
  bush: { [BIOME.FOREST]: 6, [BIOME.GRASS]: 2, [BIOME.DESERT]: 1, [BIOME.ROCK]: 1 },
  fern: { [BIOME.FOREST]: 10, [BIOME.GRASS]: 1 },
  stone: { [BIOME.ROCK]: 10, [BIOME.SNOW]: 4, [BIOME.DESERT]: 5, [BIOME.GRASS]: 2, [BIOME.FOREST]: 2, [BIOME.BEACH]: 3 },
  boulder: { [BIOME.ROCK]: 1.2, [BIOME.SNOW]: 0.5, [BIOME.DESERT]: 0.5 },
  log: { [BIOME.FOREST]: 1.2, [BIOME.SNOW]: 0.4 },
  branch: { [BIOME.FOREST]: 6, [BIOME.GRASS]: 1.5, [BIOME.SNOW]: 1 },
  dead: { [BIOME.DESERT]: 0.4, [BIOME.ROCK]: 0.3, [BIOME.GRASS]: 0.15, [BIOME.SNOW]: 0.3 },
};
const GRASS_TINT = { [BIOME.GRASS]: [0.85, 1.0, 0.65], [BIOME.FOREST]: [0.7, 0.85, 0.55], [BIOME.DESERT]: [1.0, 0.85, 0.55], [BIOME.BEACH]: [0.95, 0.95, 0.7], [BIOME.ROCK]: [0.8, 0.8, 0.6] };
const GRASS_DENS = { [BIOME.GRASS]: 1, [BIOME.FOREST]: 0.55, [BIOME.DESERT]: 0.15, [BIOME.BEACH]: 0.1, [BIOME.ROCK]: 0.2 };

export class DecorLayer {
  constructor(game, lib, gfx) {
    this.game = game; this.lib = lib; this.gfx = gfx;
    this.pools = {};
    this.lastCX = 1e9; this.lastCZ = 1e9; this.gx = 1e9; this.gz = 1e9;
    const dens = gfx.decor || 1;
    this.radius = 60 + 110 * dens;
    this.grassR = (gfx.grass || 0) > 0 ? 18 + 32 * gfx.grass : 0;
    for (const k of Object.keys(DECOR_TYPES)) this.pools[k] = this.makePool(lib.decor(k), Math.round(1800 * dens * (k === 'fern' || k === 'branch' || k === 'stone' ? 1.6 : 0.6)));
    if (this.grassR) this.pools.grass = this.makePool(lib.decor('grass'), Math.round(9000 * gfx.grass));
    this.colliders = [];
  }
  makePool(parts, cap) {
    const meshes = parts.map(p => { const m = new THREE.InstancedMesh(p.geo, p.mat, cap); m.count = 0; m.castShadow = !!p.shadow; m.receiveShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); if (p.tint) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); this.game.scene.add(m); return m; });
    return { meshes, cap, parts };
  }
  dispose() { for (const p of Object.values(this.pools)) for (const m of p.meshes) { this.game.scene.remove(m); m.dispose(); } this.pools = {}; }
  okSpot(x, z) {
    const W = this.game.world;
    const h = W.heightAt(x, z);
    if (h < 0.6 || W.isRoad(x, z) || W.monumentAt(x, z, 4) || W.riverAt(x, z) > h - 0.6) return false;
    return true;
  }
  update(cam) {
    const W = this.game.world;
    const cell = 32;
    const cx = Math.floor(cam.x / 16), cz = Math.floor(cam.z / 16);
    if (cx !== this.lastCX || cz !== this.lastCZ) { this.lastCX = cx; this.lastCZ = cz; this.rebuild(cam, cell); }
    if (this.grassR) { const gx = Math.floor(cam.x / 6), gz = Math.floor(cam.z / 6); if (gx !== this.gx || gz !== this.gz) { this.gx = gx; this.gz = gz; this.rebuildGrass(cam); } }
    void W;
  }
  rebuild(cam, cell) {
    const W = this.game.world, R = this.radius;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const counts = {}; for (const k in this.pools) if (k !== 'grass') counts[k] = 0;
    const dens = this.gfx.decor || 1;
    const i0 = Math.floor((cam.x - R) / cell), i1 = Math.floor((cam.x + R) / cell), j0 = Math.floor((cam.z - R) / cell), j1 = Math.floor((cam.z + R) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ccx = (i + 0.5) * cell, ccz = (j + 0.5) * cell;
      if (Math.hypot(ccx - cam.x, ccz - cam.z) > R + cell) continue;
      const b = W.biomeAt(ccx, ccz);
      for (const [k, per] of Object.entries(DECOR_TYPES)) {
        const pool = this.pools[k];
        const n = (per[b] || 0) * dens;
        const whole = Math.floor(n) + (hash2(i, j, k.length * 7) < n % 1 ? 1 : 0);
        for (let t = 0; t < whole; t++) {
          if (counts[k] >= pool.cap) break;
          const x = i * cell + hash2(i * 3 + t, j, k.length) * cell, z = j * cell + hash2(i, j * 3 + t, k.length + 1) * cell;
          if (!this.okSpot(x, z)) continue;
          if (k !== 'stone' && k !== 'branch' && this.game.build.blockedAt(x, z, 1)) continue;
          const y = W.heightAt(x, z);
          const sc = k === 'boulder' ? 0.7 + hash2(i, t, 9) * 1.2 : 0.7 + hash2(t, j, 5) * 0.6;
          const nrm = W.normalAt(x, z);
          q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nrm.x * 0.5, 1, nrm.z * 0.5).normalize());
          q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(i + t, j - t, 4) * 6.28));
          m4.compose(p.set(x, y - (k === 'boulder' ? 0.5 : 0.02), z), q, s.set(sc, sc, sc));
          const idx = counts[k]++;
          for (const m of pool.meshes) { m.setMatrixAt(idx, m4); if (m.instanceColor) { const v = 0.8 + hash2(i, j + t, 3) * 0.35; col.setRGB(v, v * (0.95 + hash2(t, i, 2) * 0.1), v * 0.85); m.setColorAt(idx, col); } }
        }
      }
    }
    for (const k in counts) for (const m of this.pools[k].meshes) { m.count = counts[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  rebuildGrass(cam) {
    const W = this.game.world, R = this.grassR, pool = this.pools.grass;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let n = 0;
    const cell = 3;
    const per = 2.2 * Math.min(1.6, this.gfx.grass);
    const i0 = Math.floor((cam.x - R) / cell), i1 = Math.floor((cam.x + R) / cell), j0 = Math.floor((cam.z - R) / cell), j1 = Math.floor((cam.z + R) / cell);
    for (let j = j0; j <= j1 && n < pool.cap; j++) for (let i = i0; i <= i1 && n < pool.cap; i++) {
      const cx = (i + 0.5) * cell, cz = (j + 0.5) * cell;
      const d = Math.hypot(cx - cam.x, cz - cam.z);
      if (d > R) continue;
      const b = W.biomeAt(cx, cz);
      const dens = (GRASS_DENS[b] || 0) * per * (1 - d / R * 0.5);
      const cnt = Math.floor(dens) + (hash2(i, j, 31) < dens % 1 ? 1 : 0);
      for (let t = 0; t < cnt && n < pool.cap; t++) {
        const x = i * cell + hash2(i + t * 17, j, 11) * cell, z = j * cell + hash2(i, j + t * 13, 12) * cell;
        const h = W.heightAt(x, z);
        if (h < 1.5 || W.slopeAt(x, z) > 0.3 || W.isRoad(x, z) || W.riverAt(x, z) > h - 0.4 || W.monumentAt(x, z, 2)) continue;
        const sc = 0.6 + hash2(t, i + j, 7) * 0.8;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(i * t, j, 8) * 6.28);
        m4.compose(p.set(x, h - 0.03, z), q, s.set(sc, sc * (0.8 + hash2(i, j * t, 5) * 0.6), sc));
        const tint = GRASS_TINT[b] || GRASS_TINT[BIOME.GRASS];
        const v = 0.75 + hash2(i + 3, j + t, 6) * 0.4;
        col.setRGB(tint[0] * v, tint[1] * v, tint[2] * v);
        for (const m of pool.meshes) { m.setMatrixAt(n, m4); if (m.instanceColor) m.setColorAt(n, col); }
        n++;
      }
    }
    for (const m of pool.meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}

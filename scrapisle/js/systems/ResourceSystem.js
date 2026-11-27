// Harvestable nodes: trees, ore nodes, hemp, loose pickups and animal corpses.
import * as THREE from 'three';
import { SpatialHash } from '../core/spatial.js';
import { GeoBuilder } from '../world/geo.js';
import { mulberry32, clamp } from '../core/util.js';
import { segSphere, rayCyl } from '../physics/Physics.js';
import { ITEMS } from '../data/items.js';

const TREE_TOTAL = { pine: 300, oak: 350, pine_snow: 300, cactus: 120, palm: 220 };
const ORE_TOTAL = {
  stone: { stones: 600 },
  metal: { metal_ore: 300, stones: 200 },
  sulfur: { sulfur_ore: 300 },
};
const PICKUPS = {
  stone_pile: { stones: 50 }, wood_pile: { wood: 50 }, metal_pile: { metal_ore: 50 }, sulfur_pile: { sulfur_ore: 50 },
  mushroom: { mushroom: 2 }, berries: { berries: 3 }, hemp: { cloth: 10 },
};
const RESPAWN = { tree: 900, ore: 600, pick: 300 };
const CHUNK = 256;

function treeGeo(kind) {
  const g = new GeoBuilder(), xf = GeoBuilder.xf(0, 0, 0, 0);
  if (kind === 'cactus') {
    g.cyl(xf, 0, 0, 0, 0.35, 3.2, 0x4f7a3a, 8); g.cyl(xf, 0.7, 1.2, 0, 0.22, 1.3, 0x4f7a3a, 6); g.box(xf, 0.35, 1.2, 0, 0.35, 0.18, 0.18, 0x4f7a3a);
    g.cyl(xf, -0.6, 1.6, 0, 0.2, 1.0, 0x56803e, 6); g.box(xf, -0.3, 1.6, 0, 0.3, 0.16, 0.16, 0x56803e);
  } else if (kind === 'palm') {
    g.cyl(xf, 0, 0, 0, 0.28, 7, 0x8a6a48, 7, true, 0.2);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.box(xf, Math.cos(a) * 1.6, 6.8, Math.sin(a) * 1.6, 1.7, 0.08, 0.45, 0x4f8a3a, -a); }
  } else if (kind === 'oak') {
    g.cyl(xf, 0, 0, 0, 0.42, 4.5, 0x6b4a2e, 8, true, 0.32);
    g.cyl(xf, 0, 3.6, 0, 2.8, 2.6, 0x3f6b2e, 9, true, 1.6); g.cyl(xf, 0, 6.2, 0, 1.6, 1.6, 0x467536, 9, true, 0.2);
  } else {
    const snow = kind === 'pine_snow';
    g.cyl(xf, 0, 0, 0, 0.38, 3, 0x5e4430, 7, true, 0.3);
    for (let i = 0; i < 4; i++) g.cyl(xf, 0, 2 + i * 2, 0, 2.6 - i * 0.5, 3, snow && i % 2 ? 0xdde6ea : 0x2f5a35, 9, true, 0.15);
  }
  return g.geometry();
}
function rockGeo(kind, seed) {
  const base = new THREE.IcosahedronGeometry(1.1, 1);
  const pos = base.attributes.position;
  const r = mulberry32(seed);
  const colA = new THREE.Color(kind === 'sulfur' ? 0x9c9360 : kind === 'metal' ? 0x7d756c : 0x8f8f8a);
  const colB = new THREE.Color(kind === 'sulfur' ? 0xe8d84a : kind === 'metal' ? 0xc98b5a : 0x7a7a75);
  const g = base.toNonIndexed();
  const p = g.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const disp = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!disp.has(key)) disp.set(key, 0.8 + r() * 0.4);
    const k = disp.get(key);
    p.setXYZ(i, p.getX(i) * k * 1.15, Math.max(-0.3, p.getY(i) * k * 0.75), p.getZ(i) * k);
  }
  for (let t = 0; t < p.count; t += 3) {
    const c = r() < 0.3 ? colB : colA;
    const sh = 0.85 + r() * 0.2;
    for (let v = 0; v < 3; v++) { cols[(t + v) * 3] = c.r * sh; cols[(t + v) * 3 + 1] = c.g * sh; cols[(t + v) * 3 + 2] = c.b * sh; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}
function pickGeo(kind) {
  const g = new GeoBuilder(), xf = GeoBuilder.xf(0, 0, 0, 0);
  if (kind === 'hemp') { for (let i = 0; i < 5; i++) { const a = i * 1.3; g.box(xf, Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15, 0.03, 0.6, 0.03, 0x5a8a3a); g.box(xf, Math.cos(a) * 0.2, 1.0, Math.sin(a) * 0.2, 0.18, 0.05, 0.06, 0x6fa04a, a); } }
  else if (kind === 'wood_pile') { for (let i = 0; i < 3; i++) g.cyl(GeoBuilder.xf(0, 0.12 + i * 0.2, 0, 0), 0, 0, -0.5 + i * 0.05, 0.1, 1, 0x8a6a48, 6); g.box(xf, 0, 0.1, 0, 0.5, 0.1, 0.3, 0x7a5a38); }
  else if (kind === 'mushroom') { g.cyl(xf, 0, 0, 0, 0.04, 0.15, 0xe8dcc0, 5); g.cyl(xf, 0, 0.15, 0, 0.14, 0.07, 0xb9926a, 7, true, 0.02); }
  else if (kind === 'berries') { g.cyl(xf, 0, 0, 0, 0.5, 0.6, 0x3f6b2e, 7, true, 0.25); for (let i = 0; i < 6; i++) g.box(xf, Math.cos(i) * 0.4, 0.3 + (i % 3) * 0.1, Math.sin(i) * 0.4, 0.05, 0.05, 0.05, 0x7b3fa0); }
  else {
    const col = kind === 'metal_pile' ? 0x9a7a5a : kind === 'sulfur_pile' ? 0xcfc050 : 0x9a9a95;
    g.box(xf, 0, 0.12, 0, 0.25, 0.12, 0.2, col, 0.4); g.box(xf, 0.2, 0.08, 0.15, 0.15, 0.08, 0.12, col, 1.2);
  }
  return g.geometry();
}

export class ResourceSystem {
  constructor(game) {
    this.game = game;
    this.nodes = [];
    this.hash = new SpatialHash(16);
    this.groups = new Map();   // key -> {mesh, nodes:[]}
    this.dynamic = [];         // corpses
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.geos = {};
  }
  geoFor(type, kind) {
    const key = type + ':' + kind;
    if (!this.geos[key]) this.geos[key] = type === 'tree' ? treeGeo(kind) : type === 'ore' ? rockGeo(kind, kind.length * 99) : pickGeo(kind);
    return this.geos[key];
  }

  init(world) {
    const W = world;
    const add = (type, kind, x, z, rot, s) => {
      const y = W.heightAt(x, z);
      const n = { idx: this.nodes.length, type, kind, x, y, z, rot: rot || 0, s: s || 1, alive: true, respawnAt: 0, hp: 0, total: null };
      this._reset(n);
      this.nodes.push(n);
      this.hash.insert(n);
      return n;
    };
    for (const t of W.spawns.trees) add('tree', t.kind, t.x, t.z, t.r, t.s);
    for (const o of W.spawns.nodes) add('ore', o.kind, o.x, o.z, o.r, 1);
    for (const h of W.spawns.hemp) add('pick', 'hemp', h.x, h.z, 0, 1);
    for (const p of W.spawns.pickups) add('pick', p.kind, p.x, p.z, (p.x * 13) % 6, 1);
    // instanced meshes per kind per chunk
    for (const n of this.nodes) {
      const cx = Math.floor((n.x + W.half) / CHUNK), cz = Math.floor((n.z + W.half) / CHUNK);
      const key = `${n.type}:${n.kind}:${cx}:${cz}`;
      let g = this.groups.get(key);
      if (!g) { g = { key, type: n.type, kind: n.kind, nodes: [], cx: (cx + 0.5) * CHUNK - W.half, cz: (cz + 0.5) * CHUNK - W.half }; this.groups.set(key, g); }
      n.group = g; n.inst = g.nodes.length; g.nodes.push(n);
    }
    const m4 = new THREE.Matrix4();
    for (const g of this.groups.values()) {
      const mesh = new THREE.InstancedMesh(this.geoFor(g.type, g.kind), this.mat, g.nodes.length);
      mesh.castShadow = g.type === 'tree';
      mesh.receiveShadow = g.type !== 'tree';
      g.mesh = mesh;
      for (const n of g.nodes) this._writeMatrix(n, m4);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.game.scene.add(mesh);
    }
    for (const n of this.nodes) if (n.alive) this._addCollider(n);
  }
  _reset(n) {
    if (n.type === 'tree') { const t = TREE_TOTAL[n.kind] * n.s; n.total = { wood: Math.round(t) }; }
    else if (n.type === 'ore') n.total = { ...ORE_TOTAL[n.kind] };
    else n.total = { ...PICKUPS[n.kind] };
    n.hpMax = Object.values(n.total).reduce((a, b) => a + b, 0);
    n.hp = n.hpMax;
    n.frac = {};
  }
  _writeMatrix(n, m4 = new THREE.Matrix4()) {
    const s = n.alive ? n.s : 0.0001;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), n.rot);
    const sink = n.type === 'tree' ? -0.3 : n.type === 'ore' ? -0.15 : 0;
    const scl = n.type === 'ore' ? Math.max(0.45, n.hp / n.hpMax) * s : s;
    m4.compose(new THREE.Vector3(n.x, n.y + sink, n.z), q, new THREE.Vector3(scl, scl, scl));
    n.group.mesh.setMatrixAt(n.inst, m4);
    n.group.mesh.instanceMatrix.needsUpdate = true;
  }
  _addCollider(n) {
    const P = this.game.physics;
    if (n.type === 'tree') n.col = P.add({ type: 'cyl', x: n.x, z: n.z, y0: n.y - 1, y1: n.y + 9 * n.s, r: (n.kind === 'cactus' ? 0.35 : 0.42) * n.s, ref: n, blocksSight: false });
    else if (n.type === 'ore') n.col = P.add({ type: 'cyl', x: n.x, z: n.z, y0: n.y - 1, y1: n.y + 1.1, r: 1.05, ref: n });
  }
  _removeCollider(n) { if (n.col) { this.game.physics.remove(n.col); n.col = null; } }

  gatherClass(n) { return n.type === 'tree' ? 'tree' : n.type === 'ore' ? 'ore' : n.type === 'corpse' ? 'flesh' : 'pick'; }

  // A hit with a tool. Returns { gave: {id: n}, depleted } or null.
  hit(surv, n, toolDef, stack, efficiency = 1) {
    if (!n.alive || n.type === 'pick') return null;
    const cls = this.gatherClass(n);
    const base = ((toolDef && toolDef.gather && toolDef.gather[cls]) || 1) * efficiency;
    const work = Math.min(base, n.hp);
    const mult = this.game.settings.mult;
    const gave = {};
    for (const id in n.total) {
      const exact = n.total[id] * (work / n.hpMax) * mult + (n.frac[id] || 0);
      const k = Math.floor(exact);
      n.frac[id] = exact - k;
      if (k > 0) gave[id] = k;
    }
    n.hp -= work;
    let depleted = false;
    if (n.hp <= 0.001) {
      depleted = true;
      if (n.type === 'tree') gave.wood = (gave.wood || 0) + Math.round(n.total.wood * 0.15 * mult);
      if (n.type === 'ore') {
        const oreTool = toolDef && toolDef.gather && toolDef.gather.ore >= 25;
        if (n.kind === 'metal' && oreTool) gave.hqm_ore = (gave.hqm_ore || 0) + Math.max(1, Math.round((1 + Math.random() * 2) * mult));
        if (n.kind === 'sulfur') gave.sulfur_ore = (gave.sulfur_ore || 0) + Math.round(30 * mult);
        if (n.kind === 'stone') gave.stones = (gave.stones || 0) + Math.round(60 * mult);
      }
      this.deplete(n);
    } else if (n.type === 'ore') this._writeMatrix(n);
    for (const id in gave) {
      const left = surv.inv.give(id, gave[id]);
      if (left > 0) this.game.loot.dropItem(id, left, surv.x, surv.y + 1, surv.z);
    }
    if (stack && stack.c !== undefined && toolDef.dur) stack.c = Math.max(0, stack.c - 1 / toolDef.dur);
    this.game.events.emit('gather', { surv, node: n, gave });
    return { gave, depleted };
  }
  // Pick up a hemp plant or loose pile.
  pick(surv, n) {
    if (!n.alive || n.type !== 'pick') return null;
    const mult = this.game.settings.mult;
    const gave = {};
    for (const id in n.total) {
      const d = ITEMS[id];
      const k = d.type === 'food' ? n.total[id] : Math.round(n.total[id] * mult);
      gave[id] = k;
      const left = surv.inv.give(id, k);
      if (left > 0) this.game.loot.dropItem(id, left, surv.x, surv.y + 1, surv.z);
    }
    this.deplete(n);
    return { gave };
  }
  deplete(n) {
    n.alive = false;
    n.respawnAt = this.game.now + (n.type === 'corpse' ? 0 : RESPAWN[n.type] * (0.8 + Math.random() * 0.4));
    this._removeCollider(n);
    if (n.type === 'corpse') { this.removeCorpse(n); return; }
    this._writeMatrix(n);
  }

  // Corpses from animals (and survivors): gather flesh with any tool.
  addCorpse(species, x, y, z, yieldTable, mesh) {
    const n = { type: 'corpse', kind: species, x, y, z, alive: true, total: { ...yieldTable }, frac: {}, mesh, born: this.game.now };
    n.hpMax = Object.values(n.total).reduce((a, b) => a + b, 0) * 1.2; n.hp = n.hpMax;
    this.dynamic.push(n); this.hash.insert(n);
    return n;
  }
  removeCorpse(n) {
    n.alive = false;
    this.hash.remove(n);
    const i = this.dynamic.indexOf(n); if (i >= 0) this.dynamic.splice(i, 1);
    if (n.mesh) { n.mesh.parent && n.mesh.parent.remove(n.mesh); n.mesh = null; }
  }

  update(dt) {
    const now = this.game.now;
    // respawns (spread out over frames)
    const N = this.nodes.length;
    if (!N) return;
    const per = Math.max(50, Math.ceil(N / 60));
    for (let k = 0; k < per; k++) {
      this._cursor = ((this._cursor || 0) + 1) % N;
      const n = this.nodes[this._cursor];
      if (!n.alive && now >= n.respawnAt) {
        if (this.game.build && this.game.build.blockedAt(n.x, n.z, 2.5)) { n.respawnAt = now + 120; continue; }
        n.alive = true; this._reset(n); this._writeMatrix(n); this._addCollider(n);
      }
    }
    // corpses rot away after 6 minutes
    for (let i = this.dynamic.length - 1; i >= 0; i--) { const c = this.dynamic[i]; if (now - c.born > 360) this.removeCorpse(c); }
  }
  updateVisibility(cam) {
    for (const g of this.groups.values()) {
      const dx = g.cx - cam.x, dz = g.cz - cam.z;
      const lim = g.type === 'pick' ? 260 : g.type === 'ore' ? 600 : 900;
      g.mesh.visible = dx * dx + dz * dz < (lim + 180) * (lim + 180);
    }
  }

  // Ray pick of a node within reach. Returns {node, t} or null.
  rayNode(o, d, maxT) {
    let best = null, bt = maxT;
    this.hash.query(o.x + d.x * maxT * 0.5, o.z + d.z * maxT * 0.5, maxT, n => {
      if (!n.alive) return;
      let t = null;
      if (n.type === 'tree') {
        const h = rayCyl(o.x, o.y, o.z, d.x, d.y, d.z, { x: n.x, z: n.z, r: 0.55 * n.s + 0.15, y0: n.y - 1, y1: n.y + 8 });
        t = h ? h.t : null;
      } else {
        const r = n.type === 'ore' ? 1.15 * Math.max(0.6, n.hp / n.hpMax) : n.type === 'corpse' ? 0.9 : 0.55;
        const cy = n.y + (n.type === 'ore' ? 0.3 : n.type === 'corpse' ? 0.4 : 0.3);
        const tt = segSphere(o.x, o.y, o.z, o.x + d.x * maxT, o.y + d.y * maxT, o.z + d.z * maxT, n.x, cy, n.z, r);
        t = tt === null ? null : tt * maxT;
      }
      if (t !== null && t < bt) { bt = t; best = n; }
    });
    return best ? { node: best, t: bt } : null;
  }
  nearest(x, z, r, filter) { return this.hash.nearest(x, z, r, n => n.alive && (!filter || filter(n))); }

  serialize() {
    const out = [];
    for (const n of this.nodes) if (!n.alive || n.hp < n.hpMax) out.push([n.idx, n.alive ? 1 : 0, Math.round(n.hp * 10) / 10, Math.round(n.respawnAt)]);
    return out;
  }
  load(arr) {
    if (!arr) return;
    for (const [i, alive, hp, at] of arr) {
      const n = this.nodes[i]; if (!n) continue;
      n.alive = !!alive; n.hp = hp; n.respawnAt = at;
      if (!n.alive) this._removeCollider(n);
      this._writeMatrix(n);
    }
  }
}

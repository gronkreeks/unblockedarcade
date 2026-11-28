// Harvestable nodes: trees, ore nodes, hemp, loose pickups and animal corpses.
import * as THREE from 'three';
import { SpatialHash } from '../core/spatial.js';
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
  mushroom: { mushroom: 2 }, berries: { berries: 3 }, hemp: { cloth: 12 },
};
const RESPAWN = { tree: 900, ore: 600, pick: 240 };
const GATHER_SPEED = 1.2;   // every hit gathers a little more (nodes deplete sooner too)
const CHUNK = 128;
const VARIANTS = { pine: 4, pine_snow: 3, oak: 4, palm: 3, cactus: 3 };

export class ResourceSystem {
  constructor(game) {
    this.game = game;
    this.nodes = [];
    this.hash = new SpatialHash(16);
    this.groups = new Map();   // key -> {mesh, nodes:[]}
    this.dynamic = [];         // corpses
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
    for (const h of W.spawns.hemp2 || []) add('pick', 'hemp', h.x, h.z, 0, 1);
    for (const o of W.spawns.nodes2 || []) add('ore', o.kind, o.x, o.z, o.r, 1);
    for (const p of W.spawns.pickups2 || []) add('pick', p.kind, p.x, p.z, (p.x * 13) % 6, 1);
    // instanced meshes per kind + variant per chunk, with a detailed and a coarse version
    const V = this.game.veg;
    for (const n of this.nodes) {
      const cx = Math.floor((n.x + W.half) / CHUNK), cz = Math.floor((n.z + W.half) / CHUNK);
      n.variant = n.type === 'tree' ? n.idx % (VARIANTS[n.kind] || 3) : n.type === 'ore' ? n.idx % 3 : 0;
      const key = `${n.type}:${n.kind}:${n.variant}:${cx}:${cz}`;
      let g = this.groups.get(key);
      if (!g) { g = { key, type: n.type, kind: n.kind, variant: n.variant, nodes: [], cx: (cx + 0.5) * CHUNK - W.half, cz: (cz + 0.5) * CHUNK - W.half }; this.groups.set(key, g); }
      n.group = g; n.inst = g.nodes.length; g.nodes.push(n);
    }
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (const g of this.groups.values()) {
      let hi, lo;
      if (g.type === 'tree') { const t = V.tree(g.kind, g.variant); hi = t.hi; lo = t.lo; }
      else if (g.type === 'ore') { hi = V.rock(g.kind, g.variant, false); lo = V.rock(g.kind, g.variant, true); }
      else { hi = V.pickup(g.kind); lo = null; }
      const mk = (parts, shadows) => parts.map(p => {
        const m = new THREE.InstancedMesh(p.geo, p.mat, g.nodes.length);
        m.castShadow = shadows && !!p.shadow; m.receiveShadow = true;
        if (p.tint) { for (let i = 0; i < g.nodes.length; i++) { const v = 0.82 + ((g.nodes[i].idx * 37) % 100) / 100 * 0.32; col.setRGB(v, v * (0.96 + ((g.nodes[i].idx * 13) % 10) / 100), v * 0.9); m.setColorAt(i, col); } }
        this.game.scene.add(m); return m;
      });
      g.hi = mk(hi, true); g.lo = lo ? mk(lo, false) : [];
      g.meshes = [...g.hi, ...g.lo];
      for (const n of g.nodes) this._writeMatrix(n, m4);
      for (const m of g.meshes) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
    }
    for (const n of this.nodes) if (n.alive) this._addCollider(n);
  }
  // Pick a free spot in the node's own map chunk (its mesh batch lives there) and move it.
  _relocate(n) {
    const W = this.game.world, G = this.game, g = n.group, ore = n.type === 'ore';
    const x0 = g.cx - CHUNK / 2, z0 = g.cz - CHUNK / 2;
    for (let k = 0; k < 14; k++) {
      const x = x0 + 4 + Math.random() * (CHUNK - 8), z = z0 + 4 + Math.random() * (CHUNK - 8);
      if (!W._okSpawn(x, z, ore ? 4 : 2) || W.slopeAt(x, z) > (ore ? 0.4 : 0.3)) continue;
      if (G.build && G.build.blockedAt(x, z, 3)) continue;
      if (G.deploy && G.deploy.hash.nearest(x, z, 4)) continue;
      if (this.hash.nearest(x, z, ore ? 4 : 2, m => m !== n && (m.alive || m.type !== 'pick'))) continue;
      let busy = false; G.actorHash.query(x, z, 6, a => { if (a.alive && Math.hypot(a.x - x, a.z - z) < 6) { busy = true; return true; } });
      if (busy) continue;
      this._moveTo(n, x, z, Math.random() * Math.PI * 2);
      return true;
    }
    return false;
  }
  _moveTo(n, x, z, rot) {
    const had = !!n.col;
    if (had) this._removeCollider(n);
    n.x = x; n.z = z; n.y = this.game.world.heightAt(x, z); n.rot = rot; n.moved = true; n.tilt = undefined;
    this.hash.update(n);
    if (had) this._addCollider(n);
    this._writeMatrix(n);
    this._dirtyBounds = this._dirtyBounds || new Set(); this._dirtyBounds.add(n.group);
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
    const sink = n.type === 'tree' ? -0.1 : n.type === 'ore' ? -0.15 : 0;
    const scl = n.type === 'ore' ? Math.max(0.45, n.hp / n.hpMax) * s : s;
    // trees lean slightly with the slope they grow on
    if (n.type === 'tree' && n.alive && n.tilt === undefined) { const nr = this.game.world.normalAt(n.x, n.z); n.tilt = [nr.x * 0.25, nr.z * 0.25]; }
    if (n.type === 'tree' && n.tilt) q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(n.tilt[1], 0, -n.tilt[0])));
    m4.compose(new THREE.Vector3(n.x, n.y + sink, n.z), q, new THREE.Vector3(scl, scl, scl));
    for (const m of n.group.meshes) { m.setMatrixAt(n.inst, m4); m.instanceMatrix.needsUpdate = true; }
    // the rock's collision shrinks with it, so what you see is what you hit and bump into
    if (n.type === 'ore' && n.col) { n.col.r = 1.05 * Math.max(0.5, n.hp / n.hpMax); n.col.y1 = n.y + 1.1 * Math.max(0.55, n.hp / n.hpMax); }
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
    const base = ((toolDef && toolDef.gather && toolDef.gather[cls]) || 1) * efficiency * GATHER_SPEED;
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
        // ore and loose piles come back somewhere else in the area, like Rust (trees stay where they grew)
        if (n.type === 'ore' || (n.type === 'pick' && n.group)) this._relocate(n);
        n.alive = true; this._reset(n); this._writeMatrix(n); this._addCollider(n);
      }
    }
    if (this._dirtyBounds && this._dirtyBounds.size) { for (const g of this._dirtyBounds) for (const m of g.meshes) m.computeBoundingSphere(); this._dirtyBounds.clear(); }
    // corpses rot away after 6 minutes
    for (let i = this.dynamic.length - 1; i >= 0; i--) { const c = this.dynamic[i]; if (now - c.born > 360) this.removeCorpse(c); }
  }
  updateVisibility(cam) {
    const gfx = this.game.gfx || {};
    const detail = gfx.treeDetail || 180, view = (gfx.viewDist || 1000) + 100;
    for (const g of this.groups.values()) {
      const d = Math.hypot(g.cx - cam.x, g.cz - cam.z) - CHUNK * 0.7;
      const lim = g.type === 'pick' ? 160 + detail * 0.3 : view;
      const near = g.type === 'tree' ? d < detail : g.type === 'ore' ? d < detail * 0.8 : true;
      const show = d < lim;
      for (const m of g.hi) m.visible = show && (near || !g.lo.length);
      for (const m of g.lo) m.visible = show && !near;
    }
  }
  // Ray pick of a node within reach. Returns {node, t} or null.
  rayNode(o, d, maxT, filter) {
    let best = null, bt = maxT;
    this.hash.query(o.x + d.x * maxT * 0.5, o.z + d.z * maxT * 0.5, maxT, n => {
      if (!n.alive || (filter && !filter(n))) return;
      let t = null;
      if (n.type === 'tree') {
        const h = rayCyl(o.x, o.y, o.z, d.x, d.y, d.z, { x: n.x, z: n.z, r: 0.55 * n.s + 0.15, y0: n.y - 1, y1: n.y + 8 });
        t = h ? h.t : null;
      } else {
        const r = n.type === 'ore' ? 1.15 * Math.max(0.55, n.hp / n.hpMax) : n.type === 'corpse' ? 0.9 : 0.55;
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
    for (const n of this.nodes) {
      if (n.alive && n.hp >= n.hpMax && !n.moved) continue;
      const e = [n.idx, n.alive ? 1 : 0, Math.round(n.hp * 10) / 10, Math.round(n.respawnAt)];
      if (n.moved) e.push(Math.round(n.x * 10) / 10, Math.round(n.z * 10) / 10, Math.round(n.rot * 100) / 100);
      out.push(e);
    }
    return out;
  }
  load(arr) {
    if (!arr) return;
    for (const [i, alive, hp, at, mx, mz, mr] of arr) {
      const n = this.nodes[i]; if (!n) continue;
      if (mx !== undefined) this._moveTo(n, mx, mz, mr || 0);
      n.alive = !!alive; n.hp = hp; n.respawnAt = at;
      if (!n.alive) this._removeCollider(n);
      this._writeMatrix(n);
    }
  }
}

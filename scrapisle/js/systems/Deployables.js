// Deployables: boxes, furnaces, campfires, workbenches, research table, sleeping bags, beds,
// claim cabinets and monument recyclers. Furnace/campfire/recycler processing lives here too.
import * as THREE from 'three';
import { DEPLOYABLES, SPAWN_COOLDOWN, FOUND_H, LEVEL_H } from '../data/building.js';
import { ITEMS } from '../data/items.js';
import { RECIPE } from '../data/recipes.js';
import { Container } from './InventorySystem.js';
import { GeoBuilder, VCOLOR_MAT } from '../world/geo.js';
import { SpatialHash } from '../core/spatial.js';
import { uid, dist } from '../core/util.js';

function depGeo(type) {
  const g = new GeoBuilder(), xf = GeoBuilder.xf(0, 0, 0, 0);
  const D = DEPLOYABLES[type];
  const [hx, hy, hz] = D.size;
  switch (type) {
    case 'wood_box': case 'large_box':
      g.box(xf, 0, hy, 0, hx, hy, hz, 0x9a6b3f); g.box(xf, 0, hy * 1.6, 0, hx + 0.02, 0.04, hz + 0.02, 0x5a3d22);
      g.box(xf, -hx * 0.7, hy, 0, 0.04, hy + 0.01, hz + 0.02, 0x5a3d22); g.box(xf, hx * 0.7, hy, 0, 0.04, hy + 0.01, hz + 0.02, 0x5a3d22); break;
    case 'furnace':
      g.cyl(xf, 0, 0, 0, 0.55, 1.2, 0x8d8d8d, 8, true, 0.4); g.cyl(xf, 0, 1.2, 0, 0.18, 0.4, 0x6d6d6d, 6); g.box(xf, 0, 0.35, 0.42, 0.2, 0.18, 0.08, 0x2a2a2a); break;
    case 'campfire':
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.box(xf, Math.cos(a) * 0.45, 0.07, Math.sin(a) * 0.45, 0.1, 0.07, 0.08, 0x7a7a75, -a); }
      g.box(xf, 0, 0.08, 0, 0.35, 0.05, 0.06, 0x5e4430, 0.5); g.box(xf, 0, 0.12, 0, 0.35, 0.05, 0.06, 0x5e4430, -0.7); break;
    case 'workbench1': case 'workbench2': case 'workbench3': {
      const top = type === 'workbench1' ? 0x9a6b3f : type === 'workbench2' ? 0x8f969e : 0x4a6b8a;
      g.box(xf, 0, 0.9, 0, hx, 0.06, hz, top);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(xf, a * (hx - 0.08), 0.42, b * (hz - 0.08), 0.05, 0.42, 0.05, 0x5a3d22);
      g.box(xf, 0, 0.3, 0, hx - 0.1, 0.03, hz - 0.1, 0x5a3d22);
      if (type !== 'workbench1') g.box(xf, hx * 0.6, 1.05, 0, 0.12, 0.1, 0.1, 0x3a3a3a);
      if (type === 'workbench3') g.box(xf, -hx * 0.5, 1.2, -hz * 0.6, 0.4, 0.25, 0.04, 0x5ad88a);
      break; }
    case 'research_table':
      g.box(xf, 0, 0.85, 0, hx, 0.05, hz, 0x3a5a8a);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(xf, a * (hx - 0.08), 0.4, b * (hz - 0.08), 0.05, 0.4, 0.05, 0x55606b);
      g.box(xf, 0.3, 1.0, 0, 0.18, 0.12, 0.14, 0x5b8fd6); break;
    case 'sleeping_bag':
      g.box(xf, 0, 0.06, 0, hx, 0.06, hz, 0x5a7a3a); g.box(xf, 0, 0.1, -hz + 0.25, hx - 0.05, 0.06, 0.2, 0x6b8a4a); break;
    case 'bed':
      g.box(xf, 0, 0.2, 0, hx, 0.2, hz, 0x6b4a2e); g.box(xf, 0, 0.45, 0.1, hx - 0.05, 0.08, hz - 0.15, 0x3a5a7a); g.box(xf, 0, 0.55, -hz + 0.3, hx - 0.1, 0.07, 0.18, 0xd8d8d0); break;
    case 'claim_cabinet':
      g.box(xf, 0, hy, 0, hx, hy, hz, 0x7a5130);
      for (let i = 0; i < 4; i++) g.box(xf, 0, 0.3 + i * 0.42, hz + 0.01, hx - 0.06, 0.16, 0.02, 0x5a3d22);
      g.box(xf, 0, hy * 2 + 0.05, 0, hx + 0.05, 0.05, hz + 0.05, 0x5a3d22); break;
    case 'recycler':
      g.box(xf, 0, hy, 0, hx, hy, hz, 0x3d6b4a); g.box(xf, 0, hy * 2 + 0.2, 0, hx * 0.6, 0.2, hz * 0.6, 0x2e5238);
      g.box(xf, 0, 0.5, hz + 0.02, 0.5, 0.25, 0.03, 0x1a1a1a); g.box(xf, hx * 0.7, hy * 1.6, hz + 0.03, 0.08, 0.08, 0.03, 0xd8c43a); break;
    default: g.box(xf, 0, hy, 0, hx, hy, hz, D.color || 0x888888);
  }
  return g.geometry();
}

export class Deployables {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
    this.hash = new SpatialHash(12);
    this.geos = {};
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.flameGeo = new THREE.ConeGeometry(0.22, 0.55, 6);
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  }
  geo(type) { if (!this.geos[type]) this.geos[type] = depGeo(type); return this.geos[type]; }

  // Find the support (foundation/floor) under a world point.
  supportAt(x, y, z) {
    let best = null;
    this.game.build.pieceHash.query(x, z, 4, p => {
      if (p.type !== 'foundation' && p.type !== 'floor') return;
      const st = this.game.build.structures.get(p.st);
      const L = this.game.build.toLocal(st, x, y, z);
      const ci = Math.floor(L.x / 3), cj = Math.floor(L.z / 3);
      if (ci !== p.i || cj !== p.j) return;
      if (Math.abs(y - p.wy) < 0.5) best = p;
    });
    return best;
  }

  check(team, type, x, y, z, yaw) {
    const D = DEPLOYABLES[type];
    const W = this.game.world;
    if (!D) return 'Unknown item';
    if (W.waterSurface(x, z) && W.waterSurface(x, z).y > y) return 'Cannot place in water';
    if (W.monumentAt(x, z, 6)) return 'Too close to a monument';
    const b = this.game.build.blockedFor(team, x, z);
    if (b) return 'Building blocked';
    const sup = this.supportAt(x, y, z);
    if (type === 'claim_cabinet') {
      if (!sup) return 'Place on a foundation or floor';
      const st = this.game.build.structures.get(sup.st);
      if (st.tc) return 'This building already has a Claim Cabinet';
    }
    if (!sup && Math.abs(W.heightAt(x, z) - y) > 0.4) return 'Needs flat ground or a floor';
    if (!sup && W.slopeAt(x, z) > 0.35) return 'Too steep';
    let bad = null;
    this.hash.query(x, z, 3, d => { if (Math.abs(d.y - y) < 1 && dist(d.x, d.z, x, z) < (D.size[0] + DEPLOYABLES[d.type].size[0]) * 0.8) { bad = 'Too close to another item'; return true; } });
    if (bad) return bad;
    if (D.solid !== false) {
      // don't overlap walls
      let hit = false;
      this.game.physics.near(x, z, 3, c => {
        if (c.type !== 'box' || !c.solid) return;
        if (c.tag === 'piece' && (c.ref.type === 'foundation' || c.ref.type === 'floor' || c.ref.type === 'roof')) return;
        if (c.y - c.hy > y + D.size[1] * 2 - 0.05 || c.y + c.hy < y + 0.05) return;
        const l = this._localIn(c, x, z);
        if (Math.abs(l.x) < c.hx + D.size[0] * 0.6 && Math.abs(l.z) < c.hz + D.size[2] * 0.6) { hit = true; return true; }
      });
      if (hit) return 'Blocked by a wall';
    }
    return null;
  }
  _localIn(c, x, z) { const dx = x - c.x, dz = z - c.z; return { x: dx * c.c - dz * c.s, z: dx * c.s + dz * c.c }; }

  place(surv, type, x, y, z, yaw, opts = {}) {
    const err = this.check(surv.team, type, x, y, z, yaw);
    if (err) return { ok: false, err };
    if (!opts.free && !surv.inv.remove(type, 1)) return { ok: false, err: 'Missing item' };
    const sup = this.supportAt(x, y, z);
    // items set down on the ground right next to a building still belong to it
    const stNear = sup ? null : this.game.build.structureNear(x, z, 4);
    const d = this.create({ type, x, y, z, yaw, team: surv.team, owner: surv.id, st: sup ? sup.st : stNear ? stNear.id : null, piece: sup ? sup.id : null });
    if (type === 'claim_cabinet' && sup) { const st = this.game.build.structures.get(sup.st); st.tc = d.id; st.version++; }
    this.game.events.emit('deployed', { surv, dep: d });
    return { ok: true, dep: d };
  }
  create(o) {
    const D = DEPLOYABLES[o.type];
    const d = Object.assign({ id: o.id || uid('d'), hp: D.hp, maxHp: D.hp, on: false, fuelT: 0, procT: 0, lastUsed: -999, lock: null, auth: new Set([o.team]) }, o);
    if (o.auth) d.auth = new Set(o.auth);
    d.cont = D.slots ? new Container(D.slots, { kind: o.type }) : null;
    if (o.slots && d.cont) d.cont.load(o.slots);
    d.def = D;
    const m = new THREE.Mesh(this.geo(o.type), VCOLOR_MAT);
    m.position.set(d.x, d.y, d.z); m.rotation.y = d.yaw;
    m.castShadow = true; m.receiveShadow = true;
    m.userData.dep = d;
    this.group.add(m);
    d.mesh = m;
    if (o.type === 'campfire' || o.type === 'furnace') {
      const f = new THREE.Mesh(this.flameGeo, this.flameMat);
      f.position.set(0, o.type === 'campfire' ? 0.35 : 0.4, o.type === 'furnace' ? 0.38 : 0);
      if (o.type === 'furnace') f.scale.set(0.6, 0.5, 0.6);
      f.visible = false; m.add(f); d.flame = f;
    }
    const [hx, hy, hz] = D.size;
    d.col = this.game.physics.add({ type: 'box', x: d.x, y: d.y + hy, z: d.z, hx, hy, hz, yaw: d.yaw, ref: d, tag: 'deploy', solid: D.solid !== false });
    this.list.push(d); this.byId.set(d.id, d); this.hash.insert(d);
    return d;
  }
  remove(d, dropContents = true) {
    if (!this.byId.has(d.id)) return;
    this.byId.delete(d.id);
    const i = this.list.indexOf(d); if (i >= 0) this.list.splice(i, 1);
    this.hash.remove(d);
    this.group.remove(d.mesh);
    this.game.physics.remove(d.col);
    if (dropContents && d.cont && !d.cont.isEmpty()) this.game.loot.spawnBag(d.x, d.y + 0.3, d.z, d.cont.slots.filter(Boolean), d.def.name);
    if (d.type === 'claim_cabinet' && d.st) { const st = this.game.build.structures.get(d.st); if (st && st.tc === d.id) { st.tc = null; st.version++; } }
    this.game.events.emit('deployRemoved', { dep: d });
  }
  damage(d, amount, type, attacker) {
    const m = (d.def.dmg && d.def.dmg[type]) ?? 1;
    d.hp -= amount * m;
    if (d.st) { const st = this.game.build.structures.get(d.st); if (st) this.game.events.emit('structureHit', { st, dep: d, attacker, dmg: amount * m, type }); }
    if (d.hp <= 0 && d.type !== 'recycler') { this.remove(d, true); return true; }
    return false;
  }
  onPieceRemoved(p) {
    for (const d of [...this.list]) if (d.piece === p.id) this.remove(d, true);
  }

  // Access rules
  canAccess(team, d) {
    if (d.lock && !d.lock.auth.includes(team)) return false;
    return true;
  }
  placeLock(surv, d, lockType, code) {
    if (d.lock || !d.cont) return { ok: false, err: 'Cannot lock this' };
    if (!surv.inv.remove(lockType, 1)) return { ok: false, err: 'No lock' };
    d.lock = lockType === 'code_lock' ? { type: 'code', code: code || String(Math.floor(1000 + Math.random() * 9000)), auth: [surv.team] } : { type: 'key', auth: [surv.team] };
    return { ok: true, code: d.lock.code };
  }
  authorize(team, d) { if (d.type !== 'claim_cabinet') return false; if (d.lock && !d.lock.auth.includes(team)) return false; d.auth.add(team); return true; }
  clearAuth(team, d) { if (d.type !== 'claim_cabinet' || !d.auth.has(team)) return false; d.auth = new Set([team]); return true; }

  benchTierNear(x, y, z, r) {
    let t = 0;
    this.hash.query(x, z, r, d => { if (d.def.bench && Math.abs(d.y - y) < 2.5 && dist(d.x, d.z, x, z) < r) t = Math.max(t, d.def.bench); });
    return t;
  }
  near(x, z, r, filter) { return this.hash.queryList(x, z, r, filter); }
  bagsOf(ownerId) { return this.list.filter(d => d.def.spawn && d.owner === ownerId); }
  spawnReady(d) { return this.game.now - d.lastUsed >= (SPAWN_COOLDOWN[d.type] || 60); }

  // ---------- processing ----------
  update(dt, camPos) {
    for (const d of this.list) {
      if (d.type === 'furnace') this._furnace(d, dt);
      else if (d.type === 'campfire') this._campfire(d, dt);
      else if (d.type === 'recycler') this._recycler(d, dt);
      if (d.flame) d.flame.visible = d.on;
    }
  }
  toggle(d) {
    if (d.type === 'recycler') { d.on = !d.on; return true; }
    if (d.type !== 'furnace' && d.type !== 'campfire') return false;
    if (!d.on && d.cont.count('wood') <= 0) return false;
    d.on = !d.on; return true;
  }
  _burn(d, dt, every, charcoal) {
    d.fuelT -= dt;
    if (d.fuelT <= 0) {
      if (d.cont.remove('wood', 1) < 1) { d.on = false; return false; }
      d.fuelT += every;
      if (charcoal && Math.random() < 0.75) d.cont.add('charcoal', 1);
    }
    return true;
  }
  _furnace(d, dt) {
    if (!d.on) return;
    if (!this._burn(d, dt, 2, true)) return;
    d.procT += dt;
    while (d.procT >= 1) {
      d.procT -= 1;
      let done = 0;
      for (let i = 0; i < d.cont.size && done < 3; i++) {
        const s = d.cont.slots[i];
        if (!s) continue;
        const def = ITEMS[s.id];
        const out = def.smelt || def.cooks;
        if (!out) continue;
        s.prog = (s.prog || 0) + 1 / (def.smeltTime || 4);
        while (s.prog >= 1 && s.n > 0) {
          if (d.cont.room(out) < 1) break;
          s.prog -= 1; s.n -= 1; d.cont.add(out, 1);
        }
        if (s.n <= 0) d.cont.slots[i] = null;
        done++;
      }
      d.cont.touch();
    }
  }
  _campfire(d, dt) {
    if (!d.on) return;
    if (!this._burn(d, dt, 3, false)) return;
    d.procT += dt;
    if (d.procT >= 4) {
      d.procT -= 4;
      for (let i = 0; i < d.cont.size; i++) {
        const s = d.cont.slots[i];
        if (s && ITEMS[s.id].cooks) { s.n -= 1; if (s.n <= 0) d.cont.slots[i] = null; if (d.cont.add(ITEMS[s.id].cooks, 1)) this.game.loot.dropItem(ITEMS[s.id].cooks, 1, d.x, d.y + 0.5, d.z); break; }
      }
      d.cont.touch();
    }
  }
  // Recycler: slots 0-5 input, 6-11 output. One item every 5 seconds.
  _recycler(d, dt) {
    if (!d.on) return;
    d.procT += dt;
    if (d.procT < 5) return;
    d.procT -= 5;
    const out = recycleYield(d.cont.slots.slice(0, 6).find(Boolean)?.id);
    const idx = d.cont.slots.slice(0, 6).findIndex(Boolean);
    if (idx < 0 || !out) { d.on = false; return; }
    // check output room
    const outC = new Container(6); outC.load(d.cont.slots.slice(6));
    for (const k in out) if (outC.add(k, out[k]) > 0) { d.on = false; return; }
    for (let i = 0; i < 6; i++) d.cont.slots[6 + i] = outC.slots[i];
    const s = d.cont.slots[idx]; s.n -= 1; if (s.n <= 0) d.cont.slots[idx] = null;
    d.cont.touch();
    this.game.events.emit('recycled', { dep: d });
  }

  serialize() {
    return this.list.filter(d => d.type !== 'recycler').map(d => ({ id: d.id, type: d.type, x: d.x, y: d.y, z: d.z, yaw: d.yaw, hp: d.hp, team: d.team, owner: d.owner, st: d.st, piece: d.piece, on: d.on, lastUsed: d.lastUsed, lock: d.lock, auth: [...d.auth], slots: d.cont ? d.cont.serialize() : null }))
      .concat(this.list.filter(d => d.type === 'recycler').map(d => ({ recycler: true, id: d.id, on: d.on, slots: d.cont.serialize() })));
  }
  load(arr) {
    for (const o of arr || []) {
      if (o.recycler) { const d = this.byId.get(o.id); if (d) { d.cont.load(o.slots); d.on = o.on; } continue; }
      this.create({ ...o });
    }
  }
}

// What one item recycles into (components use their table, other craftables give half the cost back).
export function recycleYield(id) {
  if (!id) return null;
  const d = ITEMS[id];
  if (d.recycle) return d.recycle;
  const rc = RECIPE[id];
  if (!rc || d.type === 'resource') return null;
  const out = {};
  for (const k in rc.cost) { const n = Math.floor(rc.cost[k] * 0.5 / rc.n); if (n > 0) out[k] = n; }
  if (d.value >= 10) out.scrap = (out.scrap || 0) + Math.round(d.value * 0.2);
  return Object.keys(out).length ? out : null;
}

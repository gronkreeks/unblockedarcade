// Deployables: boxes, furnaces, campfires, workbenches, research table, sleeping bags, beds,
// claim cabinets and monument recyclers. Furnace/campfire/recycler processing lives here too.
import * as THREE from 'three';
import { DEPLOYABLES, SPAWN_COOLDOWN, FOUND_H, LEVEL_H } from '../data/building.js';
import { ITEMS } from '../data/items.js';
import { RECIPE } from '../data/recipes.js';
import { Container } from './InventorySystem.js';
import { GeoBuilder } from '../world/geo.js';
import { SpatialHash } from '../core/spatial.js';
import { uid, dist } from '../core/util.js';

// Separating-axis test for two yawed rectangles on the ground plane.
function obbOverlap(a, b) {
  const axes = [];
  for (const r of [a, b]) { const c = Math.cos(r.yaw), s = Math.sin(r.yaw); axes.push([c, -s], [s, c]); }
  const corners = (r) => { const c = Math.cos(r.yaw), s = Math.sin(r.yaw); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [r.x + u * r.hx * c + v * r.hz * s, r.z - u * r.hx * s + v * r.hz * c]); };
  const A = corners(a), B = corners(b);
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [px, pz] of A) { const d = px * ax + pz * az; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [px, pz] of B) { const d = px * ax + pz * az; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 + 0.01 || b1 <= a0 + 0.01) return false;
  }
  return true;
}

// Builds a deployable into a GeoBuilder using material buckets.
function depBuild(type, g) {
  const xf = GeoBuilder.xf(0, 0, 0, 0);
  const D = DEPLOYABLES[type];
  const [hx, hy, hz] = D.size;
  const W = 0xffffff;
  switch (type) {
    case 'wood_box': case 'large_box':
      g.setMat('wood'); g.box(xf, 0, hy * 0.9, 0, hx, hy * 0.9, hz, W); g.box(xf, 0, hy * 1.88, 0, hx + 0.02, hy * 0.12, hz + 0.02, 0xc8b8a0);
      g.setMat('metal');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(xf, sx * (hx - 0.02), hy, sz * (hz - 0.02), 0.035, hy + 0.01, 0.035, 0x9a9a9a);
      if (type === 'large_box') for (const x of [-hx * 0.5, hx * 0.5]) g.box(xf, x, hy, 0, 0.03, hy + 0.012, hz + 0.012, 0x8a8a8a);
      g.box(xf, 0, hy * 1.7, hz + 0.02, 0.05, 0.06, 0.015, 0x707070);
      break;
    case 'furnace':
      g.setMat('rock'); g.cyl(xf, 0, 0, 0, 0.58, 1.15, 0x9a9590, 14, true, 0.42);
      g.setMat('metal'); g.cyl(xf, 0, 1.12, 0, 0.16, 0.55, 0x6a6a6a, 10, true); g.box(xf, 0, 0.36, 0.47, 0.22, 0.19, 0.04, 0x5a5a5a);
      g.setMat('dark'); g.box(xf, 0, 0.36, 0.5, 0.16, 0.13, 0.01, 0x111111);
      break;
    case 'campfire':
      g.setMat('rock'); for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; g.box(xf, Math.cos(a) * 0.48, 0.07, Math.sin(a) * 0.48, 0.11, 0.08, 0.09, 0xa09a92, -a); }
      g.setMat('bark'); for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI; g.stick(xf, Math.cos(a) * 0.35, 0.05, Math.sin(a) * 0.35, -Math.cos(a) * 0.35, 0.18, -Math.sin(a) * 0.35, 0.05, W); }
      break;
    case 'workbench1': case 'workbench2': case 'workbench3': {
      const tier = +type.slice(-1);
      g.setMat(tier === 1 ? 'wood' : 'metal'); g.box(xf, 0, 0.88, 0, hx, 0.05, hz, tier === 1 ? W : 0xb0b0b0);
      g.setMat(tier === 1 ? 'wood' : 'metal');
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(xf, a * (hx - 0.08), 0.42, b * (hz - 0.08), 0.05, 0.42, 0.05, tier === 1 ? 0x8a7a68 : 0x707070);
      g.box(xf, 0, 0.3, 0, hx - 0.1, 0.025, hz - 0.1, tier === 1 ? 0x8a7a68 : 0x808080);
      g.setMat('metal'); g.box(xf, hx * 0.62, 1.0, hz * 0.3, 0.1, 0.08, 0.12, 0x555555); g.cyl(xf, hx * 0.62, 0.93, hz * 0.55, 0.015, 0.12, 0x888888, 6, false);
      if (tier >= 2) { g.setMat('paint'); g.box(xf, -hx * 0.5, 1.05, -hz * 0.55, 0.35, 0.15, 0.08, 0xc4682a); }
      if (tier === 3) { g.setMat('screen'); g.box(xf, -hx * 0.1, 1.2, -hz * 0.62, 0.25, 0.16, 0.02, W); }
      break; }
    case 'research_table':
      g.setMat('metal'); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(xf, a * (hx - 0.08), 0.4, b * (hz - 0.08), 0.04, 0.4, 0.04, 0x707070);
      g.setMat('wood'); g.box(xf, 0, 0.84, 0, hx, 0.04, hz, W);
      g.setMat('paint'); g.box(xf, 0.3, 1.0, 0, 0.2, 0.12, 0.16, 0x3a5a8a);
      g.setMat('screen'); g.box(xf, 0.3, 1.02, 0.165, 0.14, 0.07, 0.005, W);
      break;
    case 'sleeping_bag':
      g.setMat('cloth'); g.box(xf, 0, 0.07, 0.1, hx, 0.07, hz - 0.1, 0x5a7a3a); g.box(xf, 0, 0.11, -hz + 0.22, hx - 0.05, 0.07, 0.18, 0x8a9a6a);
      break;
    case 'bed':
      g.setMat('wood'); g.box(xf, 0, 0.18, 0, hx, 0.08, hz, W); for (const z of [-hz + 0.05, hz - 0.05]) g.box(xf, 0, 0.3, z, hx, 0.3, 0.04, W);
      g.setMat('cloth'); g.box(xf, 0, 0.36, 0.05, hx - 0.06, 0.1, hz - 0.12, 0xd8d0c0); g.box(xf, 0, 0.47, -hz + 0.3, hx - 0.12, 0.06, 0.16, 0xffffff); g.box(xf, 0, 0.47, 0.25, hx - 0.04, 0.03, hz * 0.6, 0x3a5a7a);
      break;
    case 'claim_cabinet':
      g.setMat('wood'); g.box(xf, 0, hy, 0, hx, hy, hz, W); g.box(xf, 0, hy * 2 + 0.04, 0, hx + 0.04, 0.04, hz + 0.04, 0xa89880);
      for (let i = 0; i < 4; i++) g.box(xf, 0, 0.3 + i * 0.42, hz + 0.012, hx - 0.06, 0.17, 0.012, 0xb8a890);
      g.setMat('metal'); for (let i = 0; i < 4; i++) g.box(xf, 0, 0.3 + i * 0.42, hz + 0.035, 0.07, 0.02, 0.015, 0x999999);
      break;
    case 'recycler':
      g.setMat('paint'); g.box(xf, 0, hy, 0, hx, hy, hz, 0x3d6b4a); g.box(xf, 0, 0.12, hz + 0.03, hx, 0.12, 0.03, 0xd8c43a);
      g.setMat('metal'); g.box(xf, 0, hy * 2 + 0.25, 0, hx * 0.6, 0.25, hz * 0.6, 0x8a8a8a); g.box(xf, 0, 0.5, hz + 0.02, 0.5, 0.25, 0.03, 0x404040);
      g.setMat('screen'); g.box(xf, hx * 0.7, hy * 1.6, hz + 0.03, 0.07, 0.07, 0.02, W);
      break;
    default: g.setMat('wood'); g.box(xf, 0, hy, 0, hx, hy, hz, W);
  }
  return g;
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
  // Ghost silhouette geometry.
  geo(type) { if (!this.geos[type]) this.geos[type] = depBuild(type, new GeoBuilder(1)).merged(); return this.geos[type]; }
  parts(type) {
    if (!this.partsCache) this.partsCache = {};
    if (!this.partsCache[type]) {
      const M = this.game.mats;
      const mats = { wood: M.get('wood', { vc: true }), metal: M.get('metal', { vc: true }), rock: M.get('rock', { vc: true }), bark: M.get('bark', { vc: true }), cloth: M.get('cloth', { vc: true }), paint: M.get('paint', { vc: true }), dark: M.get('rubber'), screen: M.get('emissive') };
      this.partsCache[type] = depBuild(type, new GeoBuilder(1.2)).parts(k => mats[k]);
    }
    return this.partsCache[type];
  }

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
    // the whole footprint must rest on the same floor (no hanging over edges)
    if (sup) {
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const lx = a * D.size[0] * 0.9, lz = b * D.size[2] * 0.9;
        const px = x + lx * c + lz * sn, pz = z - lx * sn + lz * c;
        const s2 = this.supportAt(px, y, pz);
        if (!s2 || s2.st !== sup.st) return 'Doesn\'t fit on this floor';
      }
    }
    // footprint overlap against walls, doors, other items, trees and rocks (oriented boxes)
    const me = { x, z, hx: D.size[0], hz: D.size[2], yaw, y0: y + 0.03, y1: y + D.size[1] * 2 };
    let bad = null;
    this.hash.query(x, z, 4, d => {
      const E = DEPLOYABLES[d.type];
      if (d.y + E.size[1] * 2 < me.y0 || d.y > me.y1) return;
      if (obbOverlap(me, { x: d.x, z: d.z, hx: E.size[0], hz: E.size[2], yaw: d.yaw })) { bad = 'Too close to another item'; return true; }
    });
    if (bad) return bad;
    this.game.physics.near(x, z, 3, c => {
      if (!c.solid || c.tag === 'drop' || c.tag === 'bag' || c.tag === 'deploy') return;
      if (c.type === 'cyl') { if (c.y1 < me.y0 || c.y0 > me.y1) return; if (dist(c.x, c.z, x, z) < c.r + Math.min(me.hx, me.hz)) { bad = 'Something is in the way'; return true; } return; }
      if (c.y + c.hy <= me.y0 + 0.02 || c.y - c.hy >= me.y1) return;
      if (obbOverlap(me, { x: c.x, z: c.z, hx: c.hx, hz: c.hz, yaw: c.yaw })) { bad = c.tag === 'piece' || c.tag === 'door' ? 'Blocked by a wall' : 'Something is in the way'; return true; }
    });
    if (bad) return bad;
    // no standing items under a low ceiling
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
    const m = new THREE.Group();
    for (const p of this.parts(o.type)) { const x = new THREE.Mesh(p.geo, p.mat); x.castShadow = true; x.receiveShadow = true; x.userData.dep = d; m.add(x); }
    m.position.set(d.x, d.y, d.z); m.rotation.y = d.yaw;
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
  // Pick an item back up with the hammer. Contents move to the inventory; refuses if they don't fit.
  canPickup(surv, d) {
    if (d.type === 'recycler') return 'This can\'t be picked up';
    const st = d.st ? this.game.build.structures.get(d.st) : null;
    const tc = st && this.game.build.tcOf(st);
    if (tc && !this.game.build.isAuthed(surv.team, st)) return 'You need building privilege';
    if (!tc && d.team !== surv.team) return 'This isn\'t yours';
    if (d.lock && !d.lock.auth.includes(surv.team)) return 'It\'s locked';
    if (d.on) return 'Turn it off first';
    return null;
  }
  pickup(surv, d) {
    const err = this.canPickup(surv, d);
    if (err) return { ok: false, err };
    if (d.cont && !d.cont.isEmpty()) {
      let room = 0; const need = d.cont.slots.filter(Boolean).length + 1;
      room = surv.inv.main.emptyCount() + surv.inv.belt.emptyCount();
      if (room < need) return { ok: false, err: 'Not enough room in your inventory for its contents' };
      for (let i = 0; i < d.cont.size; i++) { const s = d.cont.slots[i]; if (s) { const left = surv.inv.giveStack(s); d.cont.slots[i] = left || null; } }
    }
    this.remove(d, true);
    surv.inv.give(d.type, 1);
    if (d.lock) surv.inv.give(d.lock.type === 'code' ? 'code_lock' : 'key_lock', 1);
    return { ok: true };
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

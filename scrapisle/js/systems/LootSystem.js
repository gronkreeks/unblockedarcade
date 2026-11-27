// Loot containers (barrels, crates, food crates, military crates), dropped items and loot bags.
import * as THREE from 'three';
import { LOOT_TABLES } from '../data/loot.js';
import { ITEMS, makeStack, hasCondition } from '../data/items.js';
import { Container } from './InventorySystem.js';
import { GeoBuilder, VCOLOR_MAT } from '../world/geo.js';
import { SpatialHash } from '../core/spatial.js';
import { uid, randInt, randRange, weightedPick } from '../core/util.js';

const RESPAWN = { barrel: 360, crate: 480, food_crate: 420, military_crate: 720 };
const HP = { barrel: 35 };
const SIZE = { barrel: [0.42, 0.55, 0.42], crate: [0.6, 0.4, 0.45], food_crate: [0.45, 0.3, 0.35], military_crate: [0.75, 0.38, 0.45] };

function containerGeo(kind, variant = 0) {
  const g = new GeoBuilder(), xf = GeoBuilder.xf(0, 0, 0, 0);
  if (kind === 'barrel') {
    const col = [0x3a5a8a, 0x9a3a2a, 0x8a4b2a][variant % 3];
    g.cyl(xf, 0, 0, 0, 0.42, 1.1, col, 10); g.cyl(xf, 0, 0.3, 0, 0.44, 0.06, 0x2a2a2a, 10, false); g.cyl(xf, 0, 0.8, 0, 0.44, 0.06, 0x2a2a2a, 10, false);
  } else {
    const [hx, hy, hz] = SIZE[kind];
    const col = kind === 'crate' ? 0x8a6a42 : kind === 'food_crate' ? 0x6b8a4a : 0x3d5a3a;
    g.box(xf, 0, hy, 0, hx, hy, hz, col);
    g.box(xf, 0, hy * 2 + 0.02, 0, hx + 0.02, 0.03, hz + 0.02, kind === 'military_crate' ? 0xc9a23a : 0x5a3d22);
    if (kind === 'military_crate') g.box(xf, 0, hy, hz + 0.01, hx * 0.5, 0.08, 0.01, 0xc9a23a);
  }
  return g.geometry();
}

export class LootSystem {
  constructor(game) {
    this.game = game;
    this.containers = [];
    this.bags = [];
    this.drops = [];
    this.hash = new SpatialHash(16);
    this.geos = {};
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.bagGeo = (() => { const g = new GeoBuilder(); g.cyl(GeoBuilder.xf(0, 0, 0, 0), 0, 0, 0, 0.35, 0.45, 0x6b5a3a, 7, true, 0.18); return g.geometry(); })();
    this.dropGeo = new THREE.BoxGeometry(0.28, 0.18, 0.28);
    this.dropMats = {};
  }
  geo(kind, v) { const k = kind + v; if (!this.geos[k]) this.geos[k] = containerGeo(kind, v); return this.geos[k]; }

  init(world, monumentData) {
    let i = 0;
    for (const md of monumentData) for (const p of md.loot) this._addContainer(i++, p.kind, p.x, p.y, p.z, p.yaw || 0, p.mon, p.via);
    for (const b of world.spawns.barrels) this._addContainer(i++, b.kind, b.x, world.heightAt(b.x, b.z), b.z, (b.x * 7) % 6, null, null);
  }
  _addContainer(idx, kind, x, y, z, yaw, mon, via) {
    const c = { idx, id: 'lc' + idx, kind, x, y, z, yaw, mon, via, alive: false, respawnAt: 0, cont: new Container(kind === 'barrel' ? 6 : 12, { kind }), hp: HP[kind] || 0 };
    this.containers.push(c);
    this.hash.insert(c);
    this._spawn(c);
    return c;
  }
  _spawn(c) {
    c.alive = true; c.hp = HP[c.kind] || 0;
    c.cont.clear();
    for (const s of this.roll(c.kind)) c.cont.addStack(s);
    const m = new THREE.Mesh(this.geo(c.kind, c.idx % 3), VCOLOR_MAT);
    m.position.set(c.x, c.y, c.z); m.rotation.y = c.yaw; m.castShadow = true;
    m.userData.loot = c;
    this.group.add(m); c.mesh = m;
    const [hx, hy, hz] = SIZE[c.kind];
    c.col = this.game.physics.add({ type: 'box', x: c.x, y: c.y + hy, z: c.z, hx, hy, hz, yaw: c.yaw, ref: c, tag: 'loot' });
  }
  _despawn(c) {
    c.alive = false;
    c.respawnAt = this.game.now + RESPAWN[c.kind] * (0.8 + Math.random() * 0.4);
    if (c.mesh) { this.group.remove(c.mesh); c.mesh = null; }
    if (c.col) { this.game.physics.remove(c.col); c.col = null; }
    c.cont.clear();
  }

  // Roll a loot table into stacks.
  roll(kind) {
    const T = LOOT_TABLES[kind]; if (!T) return [];
    const mult = this.game.settings.mult;
    const out = [];
    const qty = (id, a, b) => { const d = ITEMS[id]; const n = randInt(a, b); return d.stack > 1 && !hasCondition(id) ? Math.max(1, Math.round(n * mult)) : 1; };
    for (const [id, a, b] of T.guaranteed) out.push(makeStack(id, qty(id, a, b)));
    const rolls = Math.round(randRange(T.rolls[0], T.rolls[1] + 0.99) * (1 + (mult - 1) * 0.12));
    const entries = T.entries.map(e => [e, e[1]]);
    for (let r = 0; r < rolls; r++) {
      const e = weightedPick(entries);
      const s = makeStack(e[0], qty(e[0], e[2], e[3]));
      if (s.c !== undefined) s.c = 0.35 + Math.random() * 0.6;
      out.push(s);
    }
    return out;
  }

  // Barrels break when hit; their items spill as a small bag.
  hitContainer(c, dmg, attacker) {
    if (!c.alive || c.kind !== 'barrel') return false;
    c.hp -= dmg;
    if (c.hp <= 0) {
      const items = c.cont.slots.filter(Boolean);
      this.spawnBag(c.x, c.y + 0.3, c.z, items, 'Barrel loot', 90);
      this._despawn(c);
      this.game.events.emit('barrelBroken', { c, attacker });
      return true;
    }
    return false;
  }
  // Called after someone takes items from a crate.
  touched(c) { if (c.kind !== 'barrel' && c.alive && c.cont.isEmpty()) this._despawn(c); }

  // ---------- loot bags ----------
  spawnBag(x, y, z, stacks, label = 'Loot', life = 600) {
    const n = Math.max(12, Math.min(48, stacks.length + 6));
    const bag = { id: uid('bag'), x, y, z, label, cont: new Container(n, { kind: 'bag' }), born: this.game.now, life };
    for (const s of stacks) bag.cont.addStack(s);
    const gy = this._groundY(x, y, z);
    bag.y = gy;
    const m = new THREE.Mesh(this.bagGeo, VCOLOR_MAT);
    m.position.set(x, gy, z); m.castShadow = true; m.userData.bag = bag;
    this.group.add(m); bag.mesh = m;
    bag.col = this.game.physics.add({ type: 'box', x, y: gy + 0.25, z, hx: 0.35, hy: 0.25, hz: 0.35, yaw: 0, ref: bag, tag: 'bag', solid: false });
    this.bags.push(bag); this.hash.insert(bag);
    return bag;
  }
  removeBag(b) {
    const i = this.bags.indexOf(b); if (i < 0) return;
    this.bags.splice(i, 1); this.hash.remove(b);
    this.group.remove(b.mesh); this.game.physics.remove(b.col);
  }
  _groundY(x, y, z) {
    // drop onto the highest surface below y (floors, terrain)
    let g = this.game.world.heightAt(x, z);
    this.game.physics.near(x, z, 1, c => {
      if (c.type !== 'box' || !c.solid) return;
      const dx = x - c.x, dz = z - c.z, lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
      if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) { const top = c.y + c.hy; if (top <= y + 0.6 && top > g) g = top; }
    });
    return g;
  }

  // ---------- dropped items ----------
  dropItem(id, n, x, y, z, stack) {
    if (n <= 0 && !stack) return null;
    const s = stack || makeStack(id, n);
    const d = { id: uid('it'), stack: s, x, y, z, vy: 1.5, born: this.game.now, rest: false };
    const col = ITEMS[s.id].color || '#888';
    if (!this.dropMats[col]) this.dropMats[col] = new THREE.MeshLambertMaterial({ color: col });
    const m = new THREE.Mesh(this.dropGeo, this.dropMats[col]);
    m.position.set(x, y, z); m.userData.drop = d;
    this.group.add(m); d.mesh = m;
    d.col = this.game.physics.add({ type: 'box', x, y, z, hx: 0.25, hy: 0.2, hz: 0.25, yaw: 0, ref: d, tag: 'drop', solid: false });
    this.drops.push(d); this.hash.insert(d);
    return d;
  }
  removeDrop(d) {
    const i = this.drops.indexOf(d); if (i < 0) return;
    this.drops.splice(i, 1); this.hash.remove(d);
    this.group.remove(d.mesh); this.game.physics.remove(d.col);
  }
  pickupDrop(surv, d) {
    const left = surv.inv.giveStack(d.stack);
    if (left) { d.stack = left; return false; }
    this.removeDrop(d);
    return true;
  }

  update(dt) {
    const now = this.game.now;
    for (const c of this.containers) if (!c.alive && now >= c.respawnAt) this._spawn(c);
    for (let i = this.bags.length - 1; i >= 0; i--) { const b = this.bags[i]; if (b.cont.isEmpty() || now - b.born > b.life) this.removeBag(b); }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (now - d.born > 300) { this.removeDrop(d); continue; }
      if (!d.rest) {
        d.vy -= 9.8 * dt; d.y += d.vy * dt;
        const gy = this._groundY(d.x, d.y + 0.3, d.z) + 0.09;
        if (d.y <= gy) { d.y = gy; d.rest = true; }
        d.mesh.position.y = d.y;
        this.game.physics.remove(d.col);
        d.col = this.game.physics.add({ type: 'box', x: d.x, y: d.y, z: d.z, hx: 0.25, hy: 0.2, hz: 0.25, yaw: 0, ref: d, tag: 'drop', solid: false });
      }
    }
  }

  serialize() {
    return {
      c: this.containers.map(c => [c.alive ? 1 : 0, Math.round(c.respawnAt), c.alive ? c.cont.serialize() : null, c.hp]),
      bags: this.bags.map(b => ({ x: b.x, y: b.y, z: b.z, label: b.label, born: b.born, life: b.life, slots: b.cont.serialize() })),
      drops: this.drops.map(d => ({ x: d.x, y: d.y, z: d.z, born: d.born, stack: d.stack })),
    };
  }
  load(d) {
    if (!d) return;
    (d.c || []).forEach((row, i) => {
      const c = this.containers[i]; if (!c) return;
      const [alive, at, slots, hp] = row;
      if (!alive) { if (c.alive) this._despawn(c); c.respawnAt = at; }
      else { c.cont.load(slots); c.hp = hp ?? c.hp; }
    });
    for (const b of d.bags || []) { const bag = this.spawnBag(b.x, b.y + 0.2, b.z, b.slots.filter(Boolean), b.label, b.life); bag.born = b.born; }
    for (const it of d.drops || []) { const dd = this.dropItem(it.stack.id, it.stack.n, it.x, it.y + 0.2, it.z, it.stack); dd.born = it.born; }
  }
}

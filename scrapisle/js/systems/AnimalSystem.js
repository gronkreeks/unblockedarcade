// Wildlife: chickens, deer, boars, wolves, bears. Wander, flee, chase, attack, die into harvestable corpses.
import { AnimalAvatar } from '../entities/Avatars.js';
import { ANIMAL_YIELD } from '../data/loot.js';
import { BIOME } from '../world/WorldGeneration.js';
import { uid, randRange, dist, angleWrap, pick } from '../core/util.js';

export const SPECIES = {
  chicken: { hp: 25, walk: 1.2, run: 3.8, size: 0.3, temper: 'shy', sense: 12 },
  deer: { hp: 100, walk: 1.6, run: 5.2, size: 0.7, temper: 'shy', sense: 30 },
  boar: { hp: 150, walk: 1.3, run: 4.6, size: 0.6, temper: 'defensive', dmg: 7, sense: 14 },
  wolf: { hp: 120, walk: 1.6, run: 5.0, size: 0.6, temper: 'hunter', dmg: 9, sense: 24 },
  bear: { hp: 400, walk: 1.4, run: 4.8, size: 1.0, temper: 'defensive', dmg: 20, sense: 16 },
};
const BIOME_SPECIES = {
  [BIOME.FOREST]: [['deer', 3], ['boar', 3], ['wolf', 1], ['bear', 0.6], ['chicken', 1]],
  [BIOME.GRASS]: [['chicken', 3], ['deer', 3], ['boar', 2], ['wolf', 0.5]],
  [BIOME.SNOW]: [['wolf', 2], ['bear', 1], ['deer', 2]],
  [BIOME.DESERT]: [['chicken', 2], ['boar', 1]],
  [BIOME.ROCK]: [['wolf', 1], ['bear', 1], ['deer', 1]],
};

export class AnimalSystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.target = Math.round(130 * (game.world.size / 2048) ** 2);
    this.spawnT = 0;
  }
  init() { for (let i = 0; i < this.target; i++) this.spawnOne(true); }
  spawnOne(initial) {
    const W = this.game.world, P = this.game.player;
    for (let t = 0; t < 30; t++) {
      const x = randRange(-W.half + 60, W.half - 60), z = randRange(-W.half + 60, W.half - 60);
      const h = W.heightAt(x, z);
      if (h < 1 || W.waterSurface(x, z) || W.monumentAt(x, z, 30)) continue;
      if (!initial && P && dist(x, z, P.x, P.z) < 90) continue;
      const table = BIOME_SPECIES[W.biomeAt(x, z)];
      if (!table) continue;
      let tot = 0; for (const e of table) tot += e[1];
      let r = Math.random() * tot, sp = table[0][0];
      for (const e of table) { r -= e[1]; if (r <= 0) { sp = e[0]; break; } }
      return this.create(sp, x, h, z);
    }
    return null;
  }
  create(species, x, y, z, o = {}) {
    const S = SPECIES[species];
    const a = {
      kind: 'animal', id: o.id || uid('an'), species, x, y, z, yaw: Math.random() * 6.28, hp: o.hp ?? S.hp, maxHp: S.hp, alive: true,
      size: S.size, state: 'idle', target: null, timer: randRange(1, 5), home: { x, z }, r: S.size * 0.6, h: S.size * 1.5, vx: 0, vy: 0, vz: 0, speed: 0,
      atkT: 0, name: species[0].toUpperCase() + species.slice(1),
    };
    a.onDamage = (amount, info) => this.onDamage(a, amount, info);
    a.avatar = new AnimalAvatar(species);
    a.avatar.root.position.set(x, y, z); a.avatar.root.visible = false;   // shown once it's close (update)
    this.game.scene.add(a.avatar.root);
    this.list.push(a);
    this.game.actors.add(a);
    return a;
  }
  onDamage(a, amount, info) {
    a.hp -= amount * (info.area === 'head' ? 1.5 : 1);
    const S = SPECIES[a.species];
    const att = info.attacker;
    if (att && att.alive !== false) {
      if (S.temper === 'shy' || (a.hp < a.maxHp * 0.25 && a.species !== 'bear')) { a.state = 'flee'; a.target = att; a.timer = 4; }
      else { a.state = 'chase'; a.target = att; a.timer = 20; }
    }
    if (a.hp <= 0) this.die(a, info);
  }
  die(a, info) {
    a.alive = false;
    this.game.actors.delete(a);
    const i = this.list.indexOf(a); if (i >= 0) this.list.splice(i, 1);
    a.avatar.die();
    this.game.res.addCorpse(a.species, a.x, a.y, a.z, ANIMAL_YIELD[a.species], a.avatar.root);
    this.game.events.emit('animalKilled', { animal: a, killer: info && info.attacker });
  }

  update(dt) {
    const now = this.game.now, P = this.game.player;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 20; if (this.list.length < this.target) this.spawnOne(false); }
    for (const a of this.list) {
      const near = P && Math.abs(a.x - P.x) + Math.abs(a.z - P.z) < 380;
      a._acc = (a._acc || 0) + dt;
      // distant animals think and move rarely
      if (!near && !a.watched) { if (a._acc < 2) continue; }
      const step = a._acc; a._acc = 0;
      this.think(a, step);
      this.move(a, step, near);
      a.avatar.root.visible = near && (a.x - P.x) ** 2 + (a.z - P.z) ** 2 < 200 * 200;   // too small to see further out
    }
  }
  senseThreat(a) {
    const S = SPECIES[a.species];
    let best = null, bd = S.sense;
    this.game.actorHash.query(a.x, a.z, S.sense, s => {
      if (s.kind !== 'survivor' || !s.alive) return;
      let r = S.sense * (s.crouch ? 0.5 : 1);
      if (this.game.env.isNight) r *= 0.7;
      const d = dist(a.x, a.z, s.x, s.z);
      if (d < r && d < bd) { bd = d; best = s; }
    });
    return best;
  }
  think(a, dt) {
    const S = SPECIES[a.species];
    a.timer -= dt; a.atkT -= dt;
    if (a.target && (!a.target.alive || dist(a.x, a.z, a.target.x, a.target.z) > 80)) { a.target = null; a.state = 'idle'; }
    if (a.state === 'idle' || a.state === 'wander') {
      const th = this.senseThreat(a);
      if (th) {
        if (S.temper === 'shy') { a.state = 'flee'; a.target = th; a.timer = 4; }
        else if (S.temper === 'hunter' && Math.random() < (this.game.env.isNight ? 0.5 : 0.15)) { a.state = 'chase'; a.target = th; a.timer = 14; }
        else if (S.temper === 'hunter') { a.state = 'wander'; a.timer = 6; a.goal = { x: a.x + (a.x - th.x), z: a.z + (a.z - th.z) }; }
        else if (S.temper === 'defensive' && dist(a.x, a.z, th.x, th.z) < S.sense * 0.4 && Math.random() < 0.5) { a.state = 'chase'; a.target = th; a.timer = 8; }
      }
      if (a.timer <= 0) {
        a.timer = randRange(3, 9);
        if (Math.random() < 0.6) { a.state = 'wander'; a.goal = { x: a.home.x + randRange(-30, 30), z: a.home.z + randRange(-30, 30) }; }
        else a.state = 'idle';
      }
    } else if (a.state === 'flee' || a.state === 'chase') {
      if (a.timer <= 0) { a.state = 'idle'; a.target = null; a.home = { x: a.x, z: a.z }; }
    }
    if (a.state === 'chase' && a.target) {
      const d = dist(a.x, a.z, a.target.x, a.target.z);
      // must actually reach the target: no biting from above or below
      if (d < 1.6 + a.size && Math.abs(a.target.y - a.y) < 1.2 && a.atkT <= 0) {
        a.atkT = 1.2;
        this.game.combat.damageActor(a.target, S.dmg || 5, { type: 'melee', area: Math.random() < 0.5 ? 'legs' : 'chest', attacker: a, bleed: 0.3 });
      }
    }
  }
  move(a, dt, near) {
    const S = SPECIES[a.species];
    let tx = null, tz = null, sp = 0;
    if (a.state === 'wander' && a.goal) { tx = a.goal.x; tz = a.goal.z; sp = S.walk; if (dist(a.x, a.z, tx, tz) < 1.5) a.state = 'idle'; }
    else if (a.state === 'flee' && a.target) { tx = a.x + (a.x - a.target.x); tz = a.z + (a.z - a.target.z); sp = S.run; }
    else if (a.state === 'chase' && a.target) { tx = a.target.x; tz = a.target.z; sp = dist(a.x, a.z, tx, tz) < 1.5 + a.size ? 0 : S.run; }
    if (tx === null || sp === 0) {
      a.speed = 0;
      // standing still still falls to the ground
      if (near) { a.vx = a.vz = 0; a.vy = (a.vy || 0) - 9.8 * dt; this.game.physics.move(a, dt); } else a.y = this.game.world.heightAt(a.x, a.z);
      a.avatar.root.position.set(a.x, a.y, a.z);
      a.avatar.animate(dt, 0); return;
    }
    const want = Math.atan2(tx - a.x, tz - a.z);
    a.yaw += angleWrap(want - a.yaw) * Math.min(1, dt * 5);
    const nx = a.x + Math.sin(a.yaw) * sp * dt, nz = a.z + Math.cos(a.yaw) * sp * dt;
    const W = this.game.world;
    const ws = W.waterSurface(nx, nz);
    if ((ws && ws.y - W.heightAt(nx, nz) > 0.8) || !W.inBounds(nx, nz, 40)) { a.yaw += Math.PI * 0.6; a.state = 'idle'; a.timer = 1; return; }
    if (near) {
      a.vx = Math.sin(a.yaw) * sp; a.vz = Math.cos(a.yaw) * sp; a.vy = (a.vy || 0) - 9.8 * dt;
      this.game.physics.move(a, dt);
    } else { a.x = nx; a.z = nz; a.y = W.heightAt(nx, nz); }
    a.speed = sp;
    a.avatar.root.position.set(a.x, a.y, a.z);
    a.avatar.root.rotation.y = a.yaw;
    a.avatar.animate(dt, sp);
  }
  nearest(x, z, r, filter) {
    let best = null, bd = r;
    for (const a of this.list) { const d = dist(x, z, a.x, a.z); if (d < bd && (!filter || filter(a))) { bd = d; best = a; } }
    return best;
  }
  serialize() { return this.list.map(a => ({ s: a.species, x: Math.round(a.x * 10) / 10, z: Math.round(a.z * 10) / 10, hp: Math.round(a.hp) })); }
  load(arr) {
    for (const a of [...this.list]) { this.game.scene.remove(a.avatar.root); this.game.actors.delete(a); }
    this.list = [];
    for (const o of arr || []) this.create(o.s, o.x, this.game.world.heightAt(o.x, o.z), o.z, { hp: o.hp });
  }
}

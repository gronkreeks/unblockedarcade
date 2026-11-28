// Weapons: melee, ballistic projectiles, reloading, recoil, durability, armour, raid charges, deaths.
import * as THREE from 'three';
import { ITEMS, makeStack } from '../data/items.js';
import { segSphere } from '../physics/Physics.js';
import { randRange, dist3, uid } from '../core/util.js';
import * as Recoil from './Recoil.js';

const GRAV = 9.81;
const tmpV = new THREE.Vector3();

// Hit spheres for actors. Returns [{x,y,z,r,area}]
export function hitShapes(a) {
  if (a.kind === 'animal') {
    const s = a.size || 0.6;
    return [{ x: a.x, y: a.y + s * 0.9, z: a.z, r: s * 0.75, area: 'chest' }, { x: a.x + Math.sin(a.yaw) * s * 0.9, y: a.y + s * 1.1, z: a.z + Math.cos(a.yaw) * s * 0.9, r: s * 0.4, area: 'head' }];
  }
  const c = a.crouch ? 0.7 : 1;
  return [
    { x: a.x, y: a.y + 1.66 * c, z: a.z, r: 0.17, area: 'head' },
    { x: a.x, y: a.y + 1.22 * c, z: a.z, r: 0.33, area: 'chest' },
    { x: a.x, y: a.y + 0.5 * c, z: a.z, r: 0.3, area: 'legs' },
  ];
}

// How big each blast looks, sounds and shakes (satchel = 1).
const BLAST_SIZE = { timed_charge: 1.8, rocket: 1.3, hv_rocket: 0.8, satchel_charge: 1, beancan: 0.7, grenade: 0.8 };

export class CombatSystem {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.charges = [];
    this.fx = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8 });
    this.arrowMat = new THREE.LineBasicMaterial({ color: 0x8a6a48 });
    this.puffGeo = new THREE.SphereGeometry(0.08, 5, 4);
    this.puffMats = {};
    this.chargeGeo = new THREE.BoxGeometry(0.3, 0.2, 0.15);
    this.chargeMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
    this.c4Mat = new THREE.MeshLambertMaterial({ color: 0xb03a2e });
  }

  // ---------- ammo / reload ----------
  ammoTypeFor(surv, stack, def) {
    if (surv.inv.count(stack.at) > 0 || stack.ammo > 0) return stack.at;
    for (const a of def.ammo) if (surv.inv.count(a) > 0) { stack.at = a; return a; }
    return stack.at;
  }
  canReload(surv, stack, def) {
    if (!stack || def.type === 'bow' || stack.ammo >= def.mag) return false;
    const at = this.ammoTypeFor(surv, stack, def);
    return surv.inv.count(at) > 0;
  }
  startReload(surv, stack, def) {
    if (!this.canReload(surv, stack, def) || surv.reloadT > 0) return false;
    surv.reloadT = def.reload; surv.reloadStack = stack;
    return true;
  }
  finishReload(surv) {
    const stack = surv.reloadStack; surv.reloadStack = null;
    if (!stack) return;
    const def = ITEMS[stack.id];
    const need = def.mag - stack.ammo;
    const got = surv.inv.remove(stack.at, need);
    stack.ammo += got;
  }
  tickSurvivor(surv, dt) {
    if (surv.reloadT > 0) { surv.reloadT -= dt; if (surv.reloadT <= 0) { surv.reloadT = 0; if (surv.activeStack() === surv.reloadStack) this.finishReload(surv); else surv.reloadStack = null; } }
    surv.fireT = Math.max(0, surv.fireT - dt);
    surv.swingT = Math.max(0, surv.swingT - dt);
  }
  // Unload a gun's magazine back to inventory (when switching ammo types)
  unload(surv, stack) { if (stack.ammo > 0) { const left = surv.inv.give(stack.at, stack.ammo); stack.ammo = left; } }

  // ---------- firing ----------
  // dir: unit vector. Returns null or {recoil:{p,y}} on a shot.
  fire(surv, stack, dir, opts = {}) {
    const def = ITEMS[stack.id];
    if (!def || (def.type !== 'gun' && def.type !== 'bow')) return null;
    if (surv.fireT > 0 || surv.reloadT > 0) return null;
    if (stack.c !== undefined && stack.c <= 0) return { broken: true };
    let at = stack.at;
    if (def.type === 'bow') {
      at = this.ammoTypeFor(surv, stack, def);
      if (surv.inv.count(at) <= 0) return { empty: true };
      surv.inv.remove(at, 1);
    } else {
      if (stack.ammo <= 0) return { empty: true };
      if (def.flint && Math.random() < def.flint) { surv.fireT = 0.45; return { flint: true }; }
      stack.ammo -= 1;
    }
    surv.fireT = 60 / def.rpm;
    const A = ITEMS[at];
    const eye = opts.origin || surv.eye();
    let spread = Recoil.spreadFor(surv, def, opts) * (opts.spreadMult || 1);
    // weapon sway shifts where the barrel points at the moment of the shot
    const sw = Recoil.sway(surv, def, opts.aiming, Math.hypot(surv.vx || 0, surv.vz || 0));
    dir = rotateDir(dir, sw.p * Math.PI / 180, -sw.y * Math.PI / 180);
    const pellets = A.pellets || 1;
    const vel = def.vel * (A.velMult || 1);
    const dmg = def.dmg * (A.dmgMult || 1);
    for (let p = 0; p < pellets; p++) {
      const sp = (spread + (pellets > 1 ? A.spread : 0)) * Math.PI / 180;
      const d = jitter(dir, sp);
      this.spawnProjectile({ x: eye.x + d.x * 0.4, y: eye.y + d.y * 0.4, z: eye.z + d.z * 0.4, vx: d.x * vel, vy: d.y * vel, vz: d.z * vel, dmg, owner: surv, weapon: def.id, ammo: at, bleed: A.bleed || 0.3, arrow: def.type === 'bow' || def.id === 'crossbow', headMult: def.headMult || 2, rocket: A.blast ? { type: at, dmg: A.blast, radius: A.radius || 3, hurt: A.hurt, splash: A.splash } : null });
    }
    if (stack.c !== undefined) stack.c = Math.max(0, stack.c - 1 / def.dur);
    this.game.events.emit('noise', { x: surv.x, z: surv.z, r: def.noise || 150, src: surv, kind: 'shot', weapon: def.id });
    this.game.audio && this.game.audio.shot(def, surv);
    const st = Recoil.onShot(surv, def, this.game.now, opts);
    this.game.events.emit('shot', { surv, def, eye, dir });
    return { recoil: st };
  }

  spawnProjectile(p) {
    p.life = 3; p.id = uid('pr'); p.sx = p.x; p.sy = p.y; p.sz = p.z;
    const near = this.game.camPos && Math.abs(p.x - this.game.camPos.x) + Math.abs(p.z - this.game.camPos.z) < 300;
    if (near) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      p.line = new THREE.Line(g, p.arrow ? this.arrowMat : this.tracerMat);
      this.game.scene.add(p.line);
    }
    this.projectiles.push(p);
  }

  update(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      const ox = p.x, oy = p.y, oz = p.z;
      p.vy -= GRAV * dt * (p.rocket ? 0.12 : p.arrow ? 0.5 : 0.35);
      const nx = ox + p.vx * dt, ny = oy + p.vy * dt, nz = oz + p.vz * dt;
      const hit = this.traceSegment(ox, oy, oz, nx, ny, nz, p.owner);
      if (p.owner && p.owner.kind === 'survivor') this._nearMiss(p, ox, oy, oz, hit ? hit.point.x : nx, hit ? hit.point.y : ny, hit ? hit.point.z : nz);
      if (hit) { this.applyProjectileHit(p, hit); this._killProj(i); continue; }
      p.x = nx; p.y = ny; p.z = nz;
      if (p.line) {
        // a short streak behind the round (an arrow shaft for arrows), never reaching back past the muzzle
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
        const flown = Math.hypot(nx - p.sx, ny - p.sy, nz - p.sz);
        const L = Math.min(p.arrow ? 0.85 : Math.min(2.2, sp * 0.006), flown);
        const pos = p.line.geometry.attributes.position;
        pos.setXYZ(0, nx, ny, nz); pos.setXYZ(1, nx - p.vx / sp * L, ny - p.vy / sp * L, nz - p.vz / sp * L);
        pos.needsUpdate = true; p.line.geometry.computeBoundingSphere();
      }
      if (p.life <= 0 || ny < -20) { if (p.rocket && p.life <= 0) this.explode({ ...p.rocket, type: p.rocket.type || 'rocket', x: nx, y: ny, z: nz, owner: p.owner }); this._killProj(i); }
    }
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const c = this.charges[i];
      c.fuse -= dt;
      if (c.fuse <= 0) { this.charges.splice(i, 1); this.explode(c); }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.t -= dt;
      f.m.position.y += f.vy * dt; f.m.scale.multiplyScalar(f.grow ? 1 + dt * 6 : 1);
      if (f.t <= 0) { this.game.scene.remove(f.m); this.fx.splice(i, 1); }
    }
  }
  // Bullets and arrows that fly past someone (within ~3 m) let them know they're being shot at.
  _nearMiss(p, ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1e-6) return;
    const o = p.owner;
    this.game.actorHash.query((ax + bx) / 2, (az + bz) / 2, Math.sqrt(L2) / 2 + 3.5, a => {
      if (!a.ai || !a.alive || a === o || (o.team && a.team === o.team)) return;
      if (p.whiz && p.whiz.has(a.id)) return;
      const cx = a.x - ax, cy = a.y + 1.2 - ay, cz = a.z - az;
      const t = Math.max(0, Math.min(1, (cx * dx + cy * dy + cz * dz) / L2));
      const ex = cx - dx * t, ey = cy - dy * t, ez = cz - dz * t;
      if (ex * ex + ey * ey + ez * ez > 9) return;
      (p.whiz || (p.whiz = new Set())).add(a.id);
      this.game.events.emit('nearmiss', { victim: a, attacker: o });
    });
  }
  _killProj(i) { const p = this.projectiles[i]; if (p.line) { this.game.scene.remove(p.line); p.line.geometry.dispose(); } this.projectiles.splice(i, 1); }

  // Trace a segment against actors, colliders and terrain. Returns nearest hit.
  traceSegment(ax, ay, az, bx, by, bz, ignore) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return null;
    let best = null, bt = 1;
    // actors
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    this.game.actorHash.query(mx, mz, L / 2 + 2.5, a => {
      if (!a.alive || a === ignore) return;
      for (const s of hitShapes(a)) {
        const t = segSphere(ax, ay, az, bx, by, bz, s.x, s.y, s.z, s.r);
        if (t !== null && t < bt) { bt = t; best = { t, actor: a, area: s.area }; }
      }
    });
    // colliders
    const ux = dx / L, uy = dy / L, uz = dz / L;
    const hc = this.game.physics.rayColliders(ax, ay, az, ux, uy, uz, L, c => c.tag !== 'drop' && c.tag !== 'bag' && !(ignore && c.ref === ignore));
    if (hc && hc.t / L < bt) { bt = hc.t / L; best = { t: bt, col: hc.c, point: hc.point, normal: hc.normal }; }
    const tt = this.game.physics.rayTerrain(ax, ay, az, ux, uy, uz, L);
    if (tt !== null && tt / L < bt) { bt = tt / L; best = { t: bt, terrain: true }; }
    if (best) best.point = best.point || { x: ax + dx * bt, y: ay + dy * bt, z: az + dz * bt };
    return best;
  }

  applyProjectileHit(p, hit) {
    const pt = hit.point;
    if (p.rocket) {
      // rockets blow up on whatever they hit, a little in front of the surface
      const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
      this.explode({ ...p.rocket, type: p.rocket.type || 'rocket', x: pt.x - p.vx / sp * 0.3, y: pt.y - p.vy / sp * 0.3, z: pt.z - p.vz / sp * 0.3, owner: p.owner });
      return;
    }
    if (hit.actor) {
      const mult = hit.area === 'head' ? p.headMult : hit.area === 'legs' ? 0.6 : 1;
      this.damageActor(hit.actor, p.dmg * mult, { type: 'proj', area: hit.area, attacker: p.owner, weapon: p.weapon, bleed: p.bleed });
      this.fxAt('flesh', pt);
      if (p.owner && p.owner.isPlayer) this.game.ui && this.game.ui.hitmarker(hit.area === 'head');
      return;
    }
    if (hit.col) this.damageCollider(hit.col, p.dmg * 0.6, 'bullet', p.owner);
    this.fxAt(hit.terrain ? this.groundKind(pt) : this.colliderKind(hit.col), pt, hit.normal);
  }
  damageCollider(col, amount, type, attacker) {
    const ref = col.ref;
    if (col.tag === 'piece') return this.game.build.damagePiece(ref, amount, type, attacker);
    if (col.tag === 'door') return this.game.build.damageDoor(ref, amount, type, attacker);
    if (col.tag === 'deploy') return this.game.deploy.damage(ref, amount, type, attacker);
    if (col.tag === 'loot') return this.game.loot.hitContainer(ref, amount, attacker);
    return 0;
  }

  // ---------- melee ----------
  // Swing the active tool/weapon. Returns description of what was hit or null.
  melee(surv, stack, opts = {}) {
    const def = stack ? ITEMS[stack.id] : null;
    if (!def || surv.swingT > 0) return null;
    surv.swingT = def.rate || 1;
    // like Rust: swinging slows you to a walk, so melee isn't a sprinting free-for-all
    surv.slowUntil = this.game.now + Math.max(0.55, def.rate || 1);
    if (stack.c !== undefined && stack.c <= 0) return { broken: true };
    const eye = opts.origin || surv.eye(), d = opts.dir || surv.dir();
    const range = def.range || 2;
    const res = this.meleeTrace(surv, eye, d, range);
    if (!res) return { miss: true };
    const dmg = (def.dmg || 5) * (opts.dmgMult || 1);
    if (res.actor) {
      this.damageActor(res.actor, dmg, { type: 'melee', area: res.area, attacker: surv, weapon: def.id, bleed: def.bleed || 0.2 });
      if (stack.c !== undefined && def.dur) stack.c = Math.max(0, stack.c - 1 / def.dur);
      this.fxAt('flesh', res.point);
      // corpses are harvested through the resource system
      return { actor: res.actor };
    }
    if (res.node) {
      const r = this.game.res.hit(surv, res.node, def, stack, opts.efficiency || 1);
      this.fxAt(res.node.type === 'tree' ? 'wood' : res.node.type === 'corpse' ? 'flesh' : 'stone', res.point, { x: -d.x, y: -d.y, z: -d.z });
      if (res.node.type === 'tree' && Math.random() < 0.5) this.fxAt('leaves', { x: res.node.x, y: res.node.y, z: res.node.z });
      return { node: res.node, gather: r };
    }
    if (res.col) {
      this.damageCollider(res.col, dmg, 'melee', surv);
      if (stack.c !== undefined && def.dur) stack.c = Math.max(0, stack.c - 0.5 / def.dur);
      this.fxAt(this.colliderKind(res.col), res.point, { x: -d.x, y: -d.y, z: -d.z });
      return { col: res.col };
    }
    return { miss: true };
  }
  meleeTrace(surv, eye, d, range) {
    let best = null, bt = range;
    this.game.actorHash.query(eye.x, eye.z, range + 2, a => {
      if (!a.alive || a === surv) return;
      for (const s of hitShapes(a)) {
        const t = segSphere(eye.x, eye.y, eye.z, eye.x + d.x * range, eye.y + d.y * range, eye.z + d.z * range, s.x, s.y, s.z, s.r + 0.12);
        if (t !== null && t * range < bt) { bt = t * range; best = { actor: a, area: s.area }; }
      }
    });
    const rn = this.game.res.rayNode(eye, d, range);
    if (rn && rn.t < bt) { bt = rn.t; best = { node: rn.node }; }
    const hc = this.game.physics.rayColliders(eye.x, eye.y, eye.z, d.x, d.y, d.z, range, c => c.tag !== 'drop' && c.tag !== 'bag' && c.ref !== surv);
    if (hc && hc.t < bt) {
      bt = hc.t;
      // a rock or tree's own collision shape counts as hitting the node, from any angle
      const r = hc.c.ref;
      best = r && r.alive && (r.type === 'ore' || r.type === 'tree') && this.game.res.nodes[r.idx] === r ? { node: r } : { col: hc.c };
    }
    const tt = this.game.physics.rayTerrain(eye.x, eye.y, eye.z, d.x, d.y, d.z, range);
    if (tt !== null && tt < bt) return null;
    if (best) best.point = { x: eye.x + d.x * bt, y: eye.y + d.y * bt, z: eye.z + d.z * bt };
    return best;
  }

  // ---------- damage ----------
  damageActor(a, amount, info) {
    if (a.isPlayer && this.game.admin && this.game.admin.god) return 0;   // admin space: can't be hurt
    if (!a.alive) return 0;
    if (a.kind !== 'survivor') { if (a.onDamage) a.onDamage(amount, info); return amount; }
    let dmg = amount;
    if (info.type === 'proj' || info.type === 'melee') {
      const prot = a.protection(info.area || 'chest', info.type === 'proj' ? 'proj' : 'melee');
      dmg *= 1 - prot;
      // wear down armour on that area
      for (const s of a.inv.wear.slots) if (s && ITEMS[s.id].covers && ITEMS[s.id].covers.includes(info.area)) s.c = Math.max(0, (s.c ?? 1) - amount / 900);
      if (Math.random() < (info.bleed || 0) * (1 - prot)) a.bleed = Math.min(2, a.bleed + randRange(0.15, 0.6));
    }
    if (info.type === 'explosive') dmg *= 1 - a.protection('chest', 'proj') * 0.5;
    a.hp -= dmg;
    if (info.attacker && info.attacker !== a) { a.lastHitBy = info.attacker; a.lastHitTime = this.game.now; }
    this.game.events.emit('hurt', { victim: a, attacker: info.attacker, dmg, info });
    if (a.hp <= 0) this.kill(a, info);
    return dmg;
  }
  kill(a, info = {}) {
    if (!a.alive) return;
    a.alive = false; a.hp = 0; a.deaths++;
    a.bleed = 0;
    const killer = info.attacker;
    if (killer && killer.kind === 'survivor' && killer !== a) killer.kills++;
    // body bag with everything they carried
    const stacks = [];
    for (const c of [a.inv.belt, a.inv.wear, a.inv.main]) { for (let i = 0; i < c.size; i++) { if (c.slots[i]) stacks.push(c.slots[i]); c.slots[i] = null; } c.touch(); }
    // whatever was still being crafted goes back as its ingredients, into the same bag
    const refund = {};
    for (const q of a.craftQueue) for (const k in q.cost) refund[k] = (refund[k] || 0) + q.cost[k];
    a.craftQueue.length = 0;
    for (const k in refund) { let n = refund[k]; const max = ITEMS[k].stack || 1; while (n > 0) { const c = Math.min(n, max); stacks.push(makeStack(k, c)); n -= c; } }
    if (stacks.length) this.game.loot.spawnBag(a.x, a.y + 0.5, a.z, stacks, `${a.name}'s body`, 900);
    this.game.events.emit('death', { victim: a, killer, info });
  }

  // ---------- raid charges ----------
  // Stick a charge to whatever is in front (or drop it). Returns charge or null.
  throwCharge(surv, type, target) {
    const def = ITEMS[type];
    if (!def || surv.inv.count(type) < 1) return null;
    surv.inv.remove(type, 1);
    let pos;
    if (target) pos = target;
    else {
      const e = surv.eye(), d = surv.dir();
      const hc = this.game.physics.rayColliders(e.x, e.y, e.z, d.x, d.y, d.z, 3.5, c => c.solid);
      pos = hc ? { x: hc.point.x - d.x * 0.1, y: hc.point.y, z: hc.point.z - d.z * 0.1 } : { x: e.x + d.x * 2, y: this.game.world.heightAt(e.x + d.x * 2, e.z + d.z * 2) + 0.1, z: e.z + d.z * 2 };
    }
    const m = new THREE.Mesh(this.chargeGeo, type === 'timed_charge' ? this.c4Mat : this.chargeMat);
    m.position.set(pos.x, pos.y, pos.z);
    this.game.scene.add(m);
    const c = { type, x: pos.x, y: pos.y, z: pos.z, fuse: def.fuse * randRange(0.9, 1.1), dmg: def.dmg, radius: def.radius, owner: surv, mesh: m, dud: type === 'satchel_charge' && Math.random() < 0.12 };
    this.charges.push(c);
    this.game.events.emit('noise', { x: pos.x, z: pos.z, r: 60, src: surv, kind: 'charge' });
    return c;
  }
  explode(c) {
    if (c.dud) { c.dud = false; c.fuse = 4 + Math.random() * 3; this.charges.push(c); return; }
    if (c.mesh) this.game.scene.remove(c.mesh);
    const R = c.radius;
    const hitPieces = new Set();
    this.game.physics.near(c.x, c.z, R + 2, col => {
      if (col.tag !== 'piece' && col.tag !== 'door' && col.tag !== 'deploy' && col.tag !== 'loot') return;
      const key = col.ref;
      if (hitPieces.has(key) && col.tag === 'piece') return;
      const d = distToBox(c, col);
      if (d > R) return;
      hitPieces.add(key);
      const f = 1 - 0.5 * (d / R);
      this.damageCollider(col, c.dmg * f, 'explosive', c.owner);
    });
    // Splash on people: full force close in, fading to nothing at the edge of the blast. Rockets
    // (and HV rockets) say how hard and how far; charges use their size.
    const reach = c.splash || R * 1.6, hurt = c.hurt || (c.type === 'timed_charge' ? 150 : 60);
    this.game.actorHash.query(c.x, c.z, reach + 1, a => {
      if (!a.alive) return;
      const d = Math.hypot(a.x - c.x, a.y + 1 - c.y, a.z - c.z);
      if (d >= reach) return;
      const f = d < reach * 0.25 ? 1 : 1 - (d - reach * 0.25) / (reach * 0.75);
      this.damageActor(a, hurt * f, { type: 'explosive', attacker: c.owner });
    });
    const size = c.size = BLAST_SIZE[c.type] || 1;
    this.flash(c.x, c.y, c.z, size);
    this.fxAt('explosion', c, null, size);
    this.game.events.emit('noise', { x: c.x, z: c.z, r: 350 + 100 * size, src: c.owner, kind: 'explosion' });
    this.game.events.emit('explosion', { x: c.x, y: c.y, z: c.z, owner: c.owner, type: c.type, size });
    this.game.audio && this.game.audio.explosion(c);
  }

  // ---------- fx ----------
  fxAt(kind, p, n, scale = 1) {
    const fx = this.game.fx; if (!fx || !this.game.camPos) return;
    if (Math.abs(p.x - this.game.camPos.x) + Math.abs(p.z - this.game.camPos.z) > 220) return;
    fx.burst(kind, p.x, p.y, p.z, n ? n.x : 0, n ? n.y : 1, n ? n.z : 0, scale);
  }
  groundKind(p) { const b = this.game.world.biomeAt(p.x, p.z); return b === 1 || b === 6 || b === 0 ? 'sand' : b === 5 ? 'snow' : 'dirt'; }
  colliderKind(c) {
    if (!c) return 'dirt';
    if (c.tag === 'piece') return c.ref.grade <= 1 ? 'wood' : c.ref.grade === 2 ? 'stone' : 'metal';
    if (c.tag === 'door') return c.ref.door && c.ref.door.type === 'wood_door' ? 'wood' : 'metal';
    if (c.tag === 'loot' || c.tag === 'deploy') return c.ref.kind === 'barrel' || c.ref.type === 'furnace' || c.ref.type === 'recycler' ? 'metal' : 'wood';
    if (c.ref && c.ref.type === 'tree') return 'wood';
    if (c.ref && c.ref.type === 'ore') return 'stone';
    return 'stone';
  }
  puff(x, y, z, color) {
    if (!this.game.camPos || Math.abs(x - this.game.camPos.x) + Math.abs(z - this.game.camPos.z) > 150) return;
    if (!this.puffMats[color]) this.puffMats[color] = new THREE.MeshBasicMaterial({ color });
    const m = new THREE.Mesh(this.puffGeo, this.puffMats[color]);
    m.position.set(x, y, z);
    this.game.scene.add(m);
    this.fx.push({ m, t: 0.25, vy: 0.6 });
  }
  flash(x, y, z, size = 1) {
    if (!this.game.camPos || Math.abs(x - this.game.camPos.x) + Math.abs(z - this.game.camPos.z) > 400) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.85 }));
    m.position.set(x, y, z); m.scale.setScalar(size);
    this.game.scene.add(m);
    this.fx.push({ m, t: 0.35, vy: 1, grow: true });
  }
}

// Rotate a direction by pitch (up) and yaw (left) offsets in radians.
function rotateDir(d, dp, dy) {
  const yaw = Math.atan2(d.x, d.z) + dy, pitch = Math.asin(Math.max(-1, Math.min(1, d.y))) + dp, cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp };
}
function jitter(d, ang) {
  if (ang <= 0) return { x: d.x, y: d.y, z: d.z };
  // random direction within cone
  const u = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * ang;
  tmpV.set(d.x, d.y, d.z);
  const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3().crossVectors(tmpV, up).normalize();
  const b = new THREE.Vector3().crossVectors(a, tmpV).normalize();
  const o = tmpV.clone().multiplyScalar(Math.cos(r)).add(a.multiplyScalar(Math.sin(r) * Math.cos(u))).add(b.multiplyScalar(Math.sin(r) * Math.sin(u)));
  return { x: o.x, y: o.y, z: o.z };
}
function distToBox(p, c) {
  if (c.type !== 'box') return Math.hypot(p.x - c.x, p.z - c.z);
  const dx = p.x - c.x, dz = p.z - c.z;
  const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c, ly = p.y - c.y;
  const ex = Math.max(0, Math.abs(lx) - c.hx), ey = Math.max(0, Math.abs(ly) - c.hy), ez = Math.max(0, Math.abs(lz) - c.hz);
  return Math.hypot(ex, ey, ez);
}

// First-person controls for the player's survivor: movement, interaction, using held items, building previews.
import { MOVE_KEYS } from '../ui/UIManager.js';
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';
import { PIECES, PIECE_ORDER, DEPLOYABLES, pieceCost } from '../data/building.js';
import { ViewModel } from './ViewModel.js';
import * as Recoil from '../systems/Recoil.js';
import { clamp } from '../core/util.js';

const WALK = 3.0, RUN = 5.6, CROUCH = 1.6, SWIM = 2.2, JUMP = 5.4;

export class PlayerController {
  constructor(game, camera, canvas) {
    this.game = game; this.cam = camera; this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { l: false, r: false, lPressed: false };
    this.sens = 0.0022;
    this.vm = new ViewModel(camera, game.mats);
    this.buildType = 'foundation'; this.buildRot = 0; this.deployYaw = 0;
    this.ghost = null; this.ghostKey = null; this.spec = null; this.aimT = 0;
    this.target = null; this.drawT = 0; this.useT = 0;
    this.locked = false;
    this._bind();
  }
  get s() { return this.game.player; }

  _bind() {
    const c = this.canvas;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) {
        // opening the inventory keeps you moving; anything else stops you
        if (this.game.ui.open === 'inv') { for (const k of [...this.keys]) if (!MOVE_KEYS.has(k)) this.keys.delete(k); } else this.keys.clear();
        this.mouse.l = this.mouse.r = false; this.game.onUnlock();
      }
    });
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', e => {
      if (!this.locked || !this.s || !this.s.alive) return;
      const zoom = this.mouse.r && this.isGun() ? 1 / (ITEMS[this.s.activeStack().id].zoom || 1.3) : 1;
      this.s.yaw -= e.movementX * this.sens * zoom;
      this.mouseDX = (this.mouseDX || 0) + e.movementX; this.mouseDY = (this.mouseDY || 0) + e.movementY;
      this.s.pitch = clamp(this.s.pitch - e.movementY * this.sens * zoom, -1.5, 1.5);
    });
    c.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.l = true; this.mouse.lPressed = true; }
      if (e.button === 2) { this.mouse.r = true; this.onRightDown(); }
    });
    document.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    c.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('wheel', e => {
      if (!this.locked || !this.s) return;
      this.selectSlot((this.s.active + (e.deltaY > 0 ? 1 : 5)) % 6);
    }, { passive: true });
    document.addEventListener('keydown', e => {
      if (this.game.ui.captureKeys(e)) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!this.locked) { if (this.game.ui.open === 'inv' && MOVE_KEYS.has(e.code)) this.keys.add(e.code); return; }
      this.keys.add(e.code);
      const s = this.s; if (!s || !s.alive) return;
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 6) this.selectSlot(n - 1); }
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyR') this.onR();
      if (e.code === 'Tab' || e.code === 'KeyI') this.game.ui.openInventory();
      if (e.code === 'KeyQ') this.game.ui.openInventory('craft');
      if (e.code === 'KeyM') this.game.ui.openMap();
      if (e.code === 'KeyG') this.dropActive();
      if (e.code === 'KeyF' && this.isGun()) this.cycleAmmo();
    });
    document.addEventListener('keyup', e => this.keys.delete(e.code));
  }
  lock() { if (!this.locked) this.canvas.requestPointerLock(); }
  isGun() { const d = this.s && this.s.activeDef(); return !!d && (d.type === 'gun' || d.type === 'bow'); }
  selectSlot(i) {
    const s = this.s; if (s.active === i) return;
    if (s.reloadT > 0) { s.reloadT = 0; s.reloadStack = null; }
    s.active = i; this.drawT = 0; this.clearGhost();
  }
  dropActive() {
    const s = this.s, st = s.activeStack(); if (!st) return;
    s.inv.belt.take(s.active);
    const d = s.dir();
    this.game.loot.dropItem(st.id, st.n, s.x + d.x * 0.8, s.y + 1.2, s.z + d.z * 0.8, st);
  }
  cycleAmmo() {
    const s = this.s, st = s.activeStack(), d = ITEMS[st.id];
    const i = d.ammo.indexOf(st.at);
    for (let k = 1; k <= d.ammo.length; k++) {
      const a = d.ammo[(i + k) % d.ammo.length];
      if (a === st.at) break;
      if (s.inv.count(a) > 0) { this.game.combat.unload(s, st); st.at = a; this.game.ui.toast(`Ammo: ${ITEMS[a].name}`); this.game.combat.startReload(s, st, d); return; }
    }
  }

  onR() {
    const s = this.s, d = s.activeDef();
    if (!d) return;
    if (d.type === 'gun') { if (this.game.combat.startReload(s, s.activeStack(), d)) this.game.audio.reload(d); }
    else if (d.type === 'plan') this.buildRot = (this.buildRot + 1) % 4;
    else if (d.type === 'deploy') this.deployYaw += Math.PI / 2;
    else if (d.type === 'hammer') { const p = this.aimPiece(); if (p && this.game.build.rotate(s, p)) this.game.ui.toast('Rotated'); }
  }
  onRightDown() {
    const d = this.s.activeDef(); if (!d) return;
    if (d.type === 'plan') { this.game.ui.openBuildMenu(); this.mouse.r = false; }
    else if (d.type === 'hammer') {
      const t = this.findTarget();
      if (t && t.dep) { this.game.ui.openDeployMenu(t.dep); this.mouse.r = false; return; }
      const p = this.aimPiece(); if (p) { this.game.ui.openHammerMenu(p); this.mouse.r = false; }
    }
  }

  // What the player is looking at for E.
  findTarget() {
    const s = this.s, e = s.eye(), d = s.dir();
    const G = this.game;
    let best = null, bt = 3.2;
    const hc = G.physics.rayColliders(e.x, e.y, e.z, d.x, d.y, d.z, 3.2, c => ['loot', 'bag', 'drop', 'deploy', 'door', 'piece'].includes(c.tag));
    if (hc) { bt = hc.t; best = { col: hc.c, t: hc.t }; }
    // pickups only: a big rock or tree next to a pile must not hide it
    const rn = G.res.rayNode(e, d, 3.2, n => n.type === 'pick');
    if (rn && rn.t < bt) { bt = rn.t; best = { node: rn.node }; }
    const tt = G.physics.rayTerrain(e.x, e.y, e.z, d.x, d.y, d.z, 3.2);
    if (tt !== null && tt < bt) best = null;
    if (!best) {
      // water to drink?
      const p = { x: e.x + d.x * 2, z: e.z + d.z * 2 };
      const w = G.world.waterSurface(p.x, p.z);
      if (w && d.y < -0.2 && e.y - w.y < 2.4) return { water: w };
      return null;
    }
    if (best.col) {
      const c = best.col;
      if (c.tag === 'piece') { if (c.ref.type === 'doorway' && c.ref.door) return { door: c.ref }; return null; }
      if (c.tag === 'door') return { door: c.ref };
      if (c.tag === 'loot') return { loot: c.ref };
      if (c.tag === 'bag') return { bag: c.ref };
      if (c.tag === 'drop') return { drop: c.ref };
      if (c.tag === 'deploy') return { dep: c.ref };
    }
    return best;
  }
  promptFor(t) {
    if (!t) return null;
    if (t.water) return t.water.fresh ? 'E  Drink water' : 'E  Drink sea water';
    if (t.node) return `E  Pick up ${t.node.kind === 'hemp' ? 'Hemp' : t.node.kind.replace('_', ' ')}`;
    if (t.loot) return t.loot.kind === 'barrel' ? 'Break the barrel to loot it' : `E  Open ${t.loot.kind.replace('_', ' ')}`;
    if (t.bag) return `E  Loot ${t.bag.label}`;
    if (t.drop) return `E  Pick up ${ITEMS[t.drop.stack.id].name}${t.drop.stack.n > 1 ? ' x' + t.drop.stack.n : ''}`;
    if (t.door) { const d = t.door.door; const lk = d.lock ? (this.game.build.canOpen(this.s.team, t.door) ? '' : ' (locked)') : ''; return `E  ${d.open ? 'Close' : 'Open'} door${lk}`; }
    if (t.dep) {
      const D = t.dep.def;
      if (t.dep.type === 'sleeping_bag' || t.dep.type === 'bed') return `${D.name}${t.dep.owner === this.s.id ? ' (yours)' : ''}`;
      if (t.dep.type.startsWith('workbench')) return `E  Use ${D.name} (tech tree)`;
      return `E  Open ${D.name}`;
    }
    return null;
  }
  interact() {
    const t = this.target, s = this.s, G = this.game;
    if (!t) return;
    if (t.water) { const r = G.surv.drink(s); G.ui.toast(r === 'fresh' ? 'You drink fresh water' : 'Salt water makes you sick'); return; }
    if (t.node) { const r = G.res.pick(s, t.node); if (r) { for (const k in r.gave) G.ui.pickupNote(k, r.gave[k]); G.audio.pickup(); } return; }
    if (t.drop) { const st = t.drop.stack; const n = st.n, id = st.id; if (G.loot.pickupDrop(s, t.drop)) G.ui.pickupNote(id, n); else G.ui.toast('Inventory full'); return; }
    if (t.loot) { if (t.loot.kind !== 'barrel') G.ui.openLoot({ kind: 'loot', ref: t.loot, cont: t.loot.cont, title: t.loot.kind.replace('_', ' ') }); return; }
    if (t.bag) { G.ui.openLoot({ kind: 'bag', ref: t.bag, cont: t.bag.cont, title: t.bag.label }); return; }
    if (t.door) {
      const p = t.door;
      if (G.build.canOpen(s.team, p)) { G.build.toggleDoor(s.team, p); G.audio.door(); }
      else if (p.door.lock.type === 'code') G.ui.openCodeEntry(code => { if (G.build.tryCode(s.team, p, code)) { G.ui.toast('Code accepted'); G.build.toggleDoor(s.team, p); G.audio.door(); } else { G.ui.toast('Wrong code'); G.audio.deny(); } });
      else { G.ui.toast('Locked'); G.audio.deny(); }
      return;
    }
    if (t.dep) {
      const d = t.dep;
      if (d.def.bench) { G.ui.openTechTree(d); return; }
      if (!d.cont) return;
      if (!G.deploy.canAccess(s.team, d)) {
        if (d.lock.type === 'code') G.ui.openCodeEntry(code => { if (d.lock.code === code) { d.lock.auth.push(s.team); G.ui.toast('Code accepted'); G.ui.openLoot({ kind: 'dep', ref: d, cont: d.cont, title: d.def.name }); } else G.ui.toast('Wrong code'); });
        else G.ui.toast('Locked');
        return;
      }
      G.ui.openLoot({ kind: 'dep', ref: d, cont: d.cont, title: d.def.name });
    }
  }
  aimPiece() {
    const s = this.s, e = s.eye(), d = s.dir();
    const hc = this.game.physics.rayColliders(e.x, e.y, e.z, d.x, d.y, d.z, 4, c => c.tag === 'piece' || c.tag === 'door');
    return hc ? hc.c.ref : null;
  }
  aimPoint(max = 6) {
    const s = this.s, e = s.eye(), d = s.dir();
    let t = max, normal = null, col = null;
    const hc = this.game.physics.rayColliders(e.x, e.y, e.z, d.x, d.y, d.z, max, c => c.solid && c.tag !== 'drop');
    if (hc) { t = hc.t; normal = hc.normal; col = hc.c; }
    const tt = this.game.physics.rayTerrain(e.x, e.y, e.z, d.x, d.y, d.z, max);
    if (tt !== null && tt < t) { t = tt; normal = { x: 0, y: 1, z: 0 }; col = null; }
    if (!normal) return null;
    return { x: e.x + d.x * t, y: e.y + d.y * t, z: e.z + d.z * t, normal, col, t };
  }

  // ---------- ghosts ----------
  clearGhost() { if (this.ghost) { this.game.scene.remove(this.ghost); this.ghost = null; this.ghostKey = null; } this.spec = null; this.depSpot = null; }
  setGhost(key, geoFn, ok, pos, yaw) {
    if (this.ghostKey !== key) {
      if (this.ghost) this.game.scene.remove(this.ghost);
      this.ghost = new THREE.Mesh(geoFn(), this.game.build.ghostOk);
      this.ghost.renderOrder = 5;
      this.game.scene.add(this.ghost); this.ghostKey = key;
    }
    this.ghost.material = ok ? this.game.build.ghostOk : this.game.build.ghostBad;
    this.ghost.position.set(pos.x, pos.y, pos.z); this.ghost.rotation.y = yaw;
  }
  updateBuildPreview() {
    const s = this.s, d = s.activeDef(), G = this.game;
    if (!d || (d.type !== 'plan' && d.type !== 'deploy')) { this.clearGhost(); return; }
    if (d.type === 'plan') {
      const hit = this.aimPoint(7);
      if (!hit) { this.clearGhost(); return; }
      const spec = G.build.specFromAim(s, this.buildType, hit, this.buildRot);
      if (!spec) { this.clearGhost(); this.buildErr = 'Needs a foundation'; return; }
      spec.rot = this.buildRot;
      const err = spec.invalid ? (G.build.check(s.team, spec) || 'Cannot place here') : G.build.check(s.team, spec);
      const tf = G.build.specTransform(spec);
      this.spec = err ? null : spec; this.buildErr = err;
      this.setGhost('p:' + this.buildType, () => G.build.geo(this.buildType), !err, tf, tf.yaw);
      return;
    }
    // deployables
    if (d.door) {
      const p = this.aimPiece();
      if (p && p.type === 'doorway' && !p.door) { this.depSpot = { door: p }; this.setGhost('door', () => G.build.geo('door'), true, { x: p.wx, y: p.wy, z: p.wz }, p.wyaw); this.buildErr = null; }
      else { this.clearGhost(); this.buildErr = 'Aim at an empty doorway'; }
      return;
    }
    if (d.lock) {
      const p = this.aimPiece();
      const t = this.target;
      if (p && p.door && !p.door.lock) { this.depSpot = { lockDoor: p }; this.buildErr = null; }
      else if (t && t.dep && t.dep.cont && !t.dep.lock) { this.depSpot = { lockDep: t.dep }; this.buildErr = null; }
      else { this.depSpot = null; this.buildErr = 'Aim at a door or box'; }
      return;
    }
    const hit = this.aimPoint(5);
    if (!hit || hit.normal.y < 0.7) { this.clearGhost(); this.buildErr = 'Aim at the ground or a floor'; return; }
    const yaw = s.yaw + Math.PI + this.deployYaw;
    const err = G.deploy.check(s.team, d.deploy, hit.x, hit.y, hit.z, yaw);
    this.depSpot = err ? null : { x: hit.x, y: hit.y, z: hit.z, yaw };
    this.buildErr = err;
    this.setGhost('d:' + d.deploy, () => G.deploy.geo(d.deploy), !err, hit, yaw);
  }

  // ---------- per-frame ----------
  update(dt) {
    const s = this.s, G = this.game;
    if (!s || !s.alive) { this.vm.update(dt, 0, { hidden: true }); this.clearGhost(); return; }
    const uiOpen = G.ui.isOpen();
    const still = uiOpen && G.ui.open !== 'inv';   // menus other than the inventory stop you
    const k = this.keys;
    // movement
    const W = G.world;
    const water = W.waterSurface(s.x, s.z);
    const depth = water ? water.y - s.y : 0;
    const swimming = depth > 1.25;
    s.crouch = !still && (k.has('ControlLeft') || k.has('KeyC')) && !swimming;
    const sprint = !still && (k.has('ShiftLeft') || k.has('ShiftRight')) && !s.crouch && !this.mouse.r && k.has('KeyW');
    let fx = 0, fz = 0;
    if (!still) {
      if (k.has('KeyW')) fz += 1; if (k.has('KeyS')) fz -= 1;
      if (k.has('KeyA')) fx += 1; if (k.has('KeyD')) fx -= 1;
    }
    const len = Math.hypot(fx, fz) || 1;
    let speed = swimming ? SWIM : s.crouch ? CROUCH : sprint ? RUN : WALK;
    if (this.mouse.r && this.isGun()) speed *= 0.6;
    if (depth > 0.5 && !swimming) speed *= 0.7;
    const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
    const wx = (fz * sy + fx * cy) / len * speed, wz = (fz * cy - fx * sy) / len * speed;
    const accel = s.onGround || swimming ? 12 : 2.5;
    s.vx += (wx - s.vx) * Math.min(1, dt * accel); s.vz += (wz - s.vz) * Math.min(1, dt * accel);
    if (swimming) {
      s.vy += ((water.y - 1.35) - s.y) * dt * 3 - s.vy * dt * 2;
      if (k.has('Space')) s.vy = 1.5;
    } else {
      s.vy -= 9.81 * 1.35 * dt;
      if (k.has('Space') && s.onGround && !still) { s.vy = JUMP; s.onGround = false; }
    }
    s.landSpeed = 0;
    G.physics.move(s, dt);
    if (s.landSpeed > 0 && !swimming) G.surv.fallDamage(s, s.landSpeed);
    this.sprinting = sprint && Math.hypot(s.vx, s.vz) > 4;
    // footsteps: dust on soft ground and a step sound
    const hs = Math.hypot(s.vx, s.vz);
    if (s.onGround && hs > 0.6 && !swimming) {
      this.stepAcc = (this.stepAcc || 0) + hs * dt;
      if (this.stepAcc > (this.sprinting ? 2.1 : 1.6)) {
        this.stepAcc = 0;
        const kind = G.combat.groundKind(s);
        if (s.y - W.heightAt(s.x, s.z) < 0.2 && kind !== 'dirt' || G.world.biomeAt(s.x, s.z) === 2 && Math.random() < 0.3) G.fx.footstep(s.x, s.y, s.z, kind === 'dirt' ? 'dust' : kind);
        G.audio.step(kind, s.crouch);
      }
    }
    // sleeves follow the worn shirt
    if (this.wearV !== s.inv.wear.version) {
      this.wearV = s.inv.wear.version;
      const shirt = s.inv.wear.slots[2] || s.inv.wear.slots[3];
      this.vm.setSleeve(shirt ? new THREE.Color(ITEMS[shirt.id].color).getHex() : 0xc8a07a);
    }
    // fov / zoom
    const d = s.activeDef();
    const aiming = !uiOpen && this.mouse.r && !!d && (d.type === 'gun' || d.type === 'bow');
    // recoil: queued kick is applied smoothly to the aim; punch and sway move the view
    const isGun = !!d && (d.type === 'gun' || d.type === 'bow');
    const rs = Recoil.update(s, isGun ? d : null, dt, G.now, 0);
    const sw = isGun ? Recoil.sway(s, d, aiming, Math.hypot(s.vx, s.vz)) : { p: 0, y: 0 };
    const D2R = Math.PI / 180;
    this.landDip = Math.max(0, (this.landDip || 0) - dt * 3);
    if (s.landSpeed > 4) this.landDip = Math.min(0.35, s.landSpeed * 0.03);
    // camera
    this.cam.position.set(s.x, s.y + s.eyeH - this.landDip * 0.4, s.z);
    this.cam.rotation.set(s.pitch + (rs.punch * 0.35 + sw.p) * D2R, s.yaw + Math.PI - (rs.punchY * 0.3 + sw.y) * D2R, rs.punchY * 0.15 * D2R, 'YXZ');
    const fov = G.settings.fov / (aiming ? (d.zoom || 1.3) : 1);
    if (Math.abs(this.cam.fov - fov) > 0.1) { this.cam.fov += (fov - this.cam.fov) * Math.min(1, dt * 12); this.cam.updateProjectionMatrix(); }
    // target + prompts
    this.target = this.findTarget();
    G.ui.setPrompt(uiOpen ? null : this.promptFor(this.target));
    // held item
    const st = s.activeStack();
    this.vm.setItem(st ? st.id : null);
    G.combat.tickSurvivor(s, dt);
    if (!uiOpen) this.useItem(dt, st, d, aiming);
    else this.mouse.lPressed = false;
    this.updateBuildPreview();
    this.vm.update(dt, Math.hypot(s.vx, s.vz), { aim: aiming, reloading: s.reloadT > 0, reloadT: s.reloadT, torch: d && d.light, sprint: this.sprinting, crouch: s.crouch, onGround: s.onGround, vy: s.vy, recoil: rs, def: d, stack: st, draw: this.drawT, mouseDX: this.mouseDX || 0, mouseDY: this.mouseDY || 0 });
    this.mouseDX = 0; this.mouseDY = 0;
    this.mouse.lPressed = false;
  }

  useItem(dt, st, d, aiming) {
    const s = this.s, G = this.game;
    if (!st || !d) {
      // fists: punch
      if (this.mouse.l && s.swingT <= 0) { s.swingT = 0.6; this.vm.doSwing(); const r = G.combat.meleeTrace(s, s.eye(), s.dir(), 1.6); if (r && r.actor) G.combat.damageActor(r.actor, 5, { type: 'melee', area: r.area, attacker: s }); }
      return;
    }
    const lp = this.mouse.lPressed, lh = this.mouse.l;
    switch (d.type) {
      case 'tool': case 'melee': case 'hammer': {
        if (d.type === 'hammer' && lp) { const p = this.aimPiece(); if (p && p.type) { const r = G.build.repair(s, p); G.ui.toast(r.ok ? `Repaired ${Math.round(p.hp)}/${p.maxHp}` : r.err); if (r.ok) { this.vm.doSwing(); G.audio.hit('wood'); } return; } }
        if (lh && s.swingT <= 0) {
          this.vm.doSwing();
          const r = G.combat.melee(s, st);
          if (r && r.broken) G.ui.toast('This item is broken');
          else if (r && r.gather) { for (const k in r.gather.gave) G.ui.pickupNote(k, r.gather.gave[k]); G.audio.hit(r.node.type === 'tree' ? 'wood' : r.node.type === 'corpse' ? 'flesh' : 'stone'); }
          else if (r && (r.actor || r.col)) G.audio.hit(r.actor ? 'flesh' : 'stone');
          else G.audio.swing();
        }
        break;
      }
      case 'gun': {
        if ((d.auto ? lh : lp) && s.reloadT <= 0) {
          const moving = Math.hypot(s.vx, s.vz) > 0.5;
          const r = G.combat.fire(s, st, s.dir(), { aiming, moving });
          if (r && r.recoil) this.vm.doShot(d);
          else if (r && r.empty) { if (lp) { if (!G.combat.startReload(s, st, d)) { G.audio.click(); G.ui.toast('No ammo'); } else G.audio.reload(); } }
          else if (r && r.flint) G.audio.click();
          else if (r && r.broken) G.ui.toast('This weapon is broken');
        }
        break;
      }
      case 'bow': {
        if (this.mouse.r) this.drawT += dt; else this.drawT = 0;
        if (lp) {
          if (this.drawT < 0.45) { G.ui.toast('Hold right mouse to draw'); break; }
          const r = G.combat.fire(s, st, s.dir(), { aiming: true, moving: Math.hypot(s.vx, s.vz) > 0.5 });
          if (r && r.recoil) { this.drawT = 0; G.audio.bow(); this.vm.doShot(d); } else if (r && r.empty) G.ui.toast('No arrows');
        }
        break;
      }
      case 'food': case 'med': {
        if (lp && s.useT <= 0) {
          s.useT = d.type === 'med' ? d.useTime : 0.6;
          if (G.surv.use(s, s.inv.belt, s.active)) { G.audio.eat(); this.vm.doSwing(); }
        }
        s.useT = Math.max(0, s.useT - dt);
        break;
      }
      case 'plan': {
        if (lp) {
          if (!this.spec) { G.ui.toast(this.buildErr || 'Cannot place here'); G.audio.deny(); break; }
          const r = G.build.place(s, this.spec);
          if (r.ok) G.audio.build(); else { G.ui.toast(r.err); G.audio.deny(); }
        }
        break;
      }
      case 'deploy': {
        if (!lp) break;
        if (!this.depSpot) { G.ui.toast(this.buildErr || 'Cannot place here'); G.audio.deny(); break; }
        let r;
        if (this.depSpot.door) r = G.build.placeDoor(s, this.depSpot.door, d.id, { flip: false });
        else if (this.depSpot.lockDoor || this.depSpot.lockDep) {
          const target = this.depSpot.lockDoor || this.depSpot.lockDep;
          const apply = code => {
            const res = this.depSpot && this.depSpot.lockDoor ? G.build.placeLock(s, target, d.id, code) : G.deploy.placeLock(s, target, d.id, code);
            G.ui.toast(res.ok ? (res.code ? `Lock set. Code ${res.code}` : 'Lock placed. Your team has the key') : res.err);
            if (res.ok) G.audio.build();
          };
          if (d.id === 'code_lock') { const spot = this.depSpot; G.ui.openCodeEntry(code => { this.depSpot = spot; apply(code); }, 'Set a 4-digit code'); }
          else apply();
          break;
        } else r = G.deploy.place(s, d.deploy, this.depSpot.x, this.depSpot.y, this.depSpot.z, this.depSpot.yaw);
        if (r.ok) { G.audio.build(); this.clearGhost(); } else { G.ui.toast(r.err); G.audio.deny(); }
        break;
      }
      case 'raid': {
        if (lp) { const c = G.combat.throwCharge(s, d.id); if (c) G.ui.toast(`${d.name} armed`); }
        break;
      }
    }
  }
}

export { PIECE_ORDER, PIECES, pieceCost, DEPLOYABLES };

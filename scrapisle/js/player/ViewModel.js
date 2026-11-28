// First-person arms and held item: equip, idle breathing, movement bob, sprint pose, aiming down sights,
// weapon-specific firing kick and cycling (slide, bolt, pump, cylinder), weapon-specific reloads,
// bow draw, melee swings, inertia sway, landing dip and muzzle flash.
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';
import { buildItemModel } from '../entities/WeaponModels.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const seg = (p, a, b) => ease((p - a) / (b - a));          // 0..1 over [a,b]
const bump = (p, a, b) => Math.sin(Math.PI * Math.min(1, Math.max(0, (p - a) / (b - a))));

// A hand (palm, fingers, thumb, cuff). The forearm is a separate mesh that always runs from the wrist
// to a fixed elbow anchor below the screen edge, so swings move the hand and tool, never the whole arm.
function handMesh(skin, sleeve) {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.09), skin); g.add(palm);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.045, 3, 6), skin); f.rotation.x = Math.PI / 2 + 0.6; f.position.set(-0.026 + i * 0.017, -0.012, -0.06); g.add(f); }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.035, 3, 6), skin); th.rotation.set(Math.PI / 2, 0, 0.9); th.position.set(-0.04, 0.0, -0.02); g.add(th);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.035, 10), sleeve); cuff.rotation.x = Math.PI / 2; cuff.position.set(0, 0, 0.055); g.add(cuff);
  g.userData.wrist = new THREE.Vector3(0, 0, 0.06);
  g.traverse(o => { if (o.isMesh) o.renderOrder = 10; });
  return g;
}
const ARM_GEO = (() => { const g = new THREE.CylinderGeometry(0.046, 0.033, 1, 10); g.translate(0, 0.5, 0); return g; })();

export class ViewModel {
  constructor(camera, mats) {
    this.cam = camera; this.mats = mats;
    this.root = new THREE.Group(); camera.add(this.root);
    this.pivot = new THREE.Group(); this.root.add(this.pivot);
    this.skin = mats.get('skin', { color: 0xb88462 });
    this.sleeveMat = mats.get('cloth', { color: 0x9a9080 });
    this.rHand = handMesh(this.skin, this.sleeveMat); this.pivot.add(this.rHand);
    this.lHand = handMesh(this.skin, this.sleeveMat); this.root.add(this.lHand);
    this.rArm = new THREE.Mesh(ARM_GEO, this.sleeveMat); this.lArm = new THREE.Mesh(ARM_GEO, this.sleeveMat);
    this.rArm.renderOrder = this.lArm.renderOrder = 10; this.root.add(this.rArm); this.root.add(this.lArm);
    // elbows sit just off the bottom corners of the screen
    this.rElbow = V(0.34, -0.5, -0.05); this.lElbow = V(-0.34, -0.5, -0.05);
    this.holder = new THREE.Group(); this.pivot.add(this.holder);
    // muzzle flash: star sprite planes + light
    const fm = new THREE.MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flash = new THREE.Group();
    for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.05), fm); p.rotation.z = i * Math.PI / 3; this.flash.add(p); }
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), fm); this.flash.add(core);
    this.flash.visible = false;
    this.light = new THREE.PointLight(0xffb060, 0, 14, 1.8); camera.add(this.light);
    this.base = V(0.15, -0.17, -0.5);
    this.id = null; this.model = null; this.info = null;
    this.equipT = 0; this.swing = 0; this.flashT = 0; this.bobT = 0; this.inertia = V(0, 0, 0); this.aimT = 0; this.sprintT = 0; this.cycle = 0; this.cycleDur = 0; this.reloadDur = 1; this.swingDir = 1;
    this.root.traverse(o => { o.renderOrder = 10; });
  }
  setSleeve(color) { this.sleeveMat = this.mats.get('cloth', { color }); for (const h of [this.rHand, this.lHand]) h.children[h.children.length - 1].material = this.sleeveMat; this.rArm.material = this.lArm.material = this.sleeveMat; }
  // Stretch a forearm from a hand's wrist to its elbow anchor (root space).
  placeArm(arm, hand, elbow) {
    if (!hand.visible) { arm.visible = false; return; }
    arm.visible = true;
    hand.updateWorldMatrix(true, false);
    const w = hand.userData.wrist.clone().applyMatrix4(hand.matrixWorld);
    this.root.worldToLocal(w);
    const dir = elbow.clone().sub(w), len = dir.length();
    arm.position.copy(w);
    arm.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
    arm.scale.set(1, len, 1);
  }
  setItem(id) {
    if (id === this.id) return;
    this.id = id;
    if (this.model) { this.holder.remove(this.model); this.model = null; }
    this.info = null;
    this.equipT = 1;
    if (!id) return;
    this.model = buildItemModel(id);
    // the stock sits against the shoulder, behind the camera: hide it in first person
    this.model.traverse(o => { if (o.isMesh) { o.renderOrder = 10; o.castShadow = false; } if (o.name === 'stock') o.visible = false; });
    this.info = this.model.userData.weapon;
    this.holder.add(this.model);
    const m = this.info.parts.muzzle;
    if (m) { m.add(this.flash); this.flash.position.set(0, 0, -0.06); }
    const d = ITEMS[id];
    this.kind = d.type === 'gun' ? (this.info.pistol ? 'pistol' : 'rifle') : d.type === 'bow' ? 'bow' : ['tool', 'melee', 'hammer'].includes(d.type) ? 'melee' : 'item';
    if (d.icon === 'spear') this.kind = 'spear';
    // hand-held tools stand upright in the fist; guns, spears and bows point forward
    this.holder.rotation.set(0, 0, 0);
    if (this.kind === 'melee') this.holder.rotation.set(1.25, 0.15, 0.1);
    // rest positions of animated parts
    this.rest = {};
    for (const [k, o] of Object.entries(this.info.parts)) this.rest[k] = { p: o.position.clone(), r: o.rotation.clone() };
  }
  doSwing() { this.swing = 1; }
  doShot(def) {
    this.flashT = def && def.type === 'bow' ? 0 : 0.045;
    if (this.flash) { this.flash.rotation.z = Math.random() * Math.PI; const s = 0.8 + Math.random() * 0.5; this.flash.scale.set(s, s, s); }
    if (def && (def.id === 'bolt_rifle' || def.id === 'pump_shotgun')) { this.cycle = 0.0001; this.cycleDur = def.id === 'bolt_rifle' ? 1.0 : 0.6; }
    else if (def && def.type === 'gun') { this.cycle = 0.0001; this.cycleDur = Math.min(0.12, 60 / def.rpm * 0.8); }
    if (def && def.id === 'revolver' && this.info && this.info.parts.cylinder) this.info.parts.cylinder.rotation.z += Math.PI / 3;
  }
  update(dt, speed, o = {}) {
    const P = this.pivot;
    this.root.visible = !o.hidden;
    // scoped rifles: once aimed in, the model hides and you look through the scope (overlay)
    const scoped = !o.hidden && this.info && this.info.scope && this.aimT > 0.85;
    const so = document.getElementById('scopeOverlay');
    if (so && so.hidden === scoped) { so.hidden = !scoped; document.body.classList.toggle('scoped', scoped); }
    if (scoped) this.root.visible = false;
    if (o.hidden) { this.light.intensity = 0; return; }
    this.bobT += dt * (speed > 0.3 ? speed * 2.1 : 1);
    this.equipT = Math.max(0, this.equipT - dt * 3);
    this.aimT += ((o.aim && this.kind !== 'melee' ? 1 : 0) - this.aimT) * Math.min(1, dt * 14);
    this.sprintT += ((o.sprint ? 1 : 0) - this.sprintT) * Math.min(1, dt * 8);
    this.swing = Math.max(0, this.swing - dt * 2.8);
    this.flashT -= dt;
    // inertia sway: weapon lags behind mouse movement
    this.inertia.x += (-o.mouseDX * 0.00025 - this.inertia.x) * Math.min(1, dt * 8);
    this.inertia.y += (o.mouseDY * 0.00025 - this.inertia.y) * Math.min(1, dt * 8);
    const rs = o.recoil;
    const kick = rs ? rs.kickZ : 0, punch = rs ? rs.punch : 0;
    const moving = Math.min(1, speed / 3);
    const bob = Math.sin(this.bobT) * 0.012 * moving * (1 - this.aimT * 0.8), bobY = -Math.abs(Math.cos(this.bobT)) * 0.012 * moving * (1 - this.aimT * 0.8);
    const breath = Math.sin(performance.now() * 0.0016) * 0.003 * (1 - this.aimT * 0.7);
    // positions
    const sight = this.info ? this.info.sight : 0.08;
    const aimPos = V(0, -sight - 0.004, this.kind === 'bow' ? -0.4 : -0.4);
    const pos = this.base.clone().lerp(aimPos, this.aimT);
    pos.x += bob + this.inertia.x; pos.y += bobY + breath + this.inertia.y - this.equipT * 0.35 - this.sprintT * 0.06;
    pos.z += kick + (o.crouch ? 0.01 : 0);
    let rx = punch * 0.012 + this.equipT * -0.9 - this.sprintT * 0.35 + this.inertia.y * 2, ry = this.sprintT * 0.6 + this.inertia.x * 2, rz = this.sprintT * 0.4 + this.inertia.x * 3;
    // landing dip
    if (!o.onGround && o.vy < -2) pos.y += Math.min(0.03, -o.vy * 0.003);
    // reload animation
    const def = o.def;
    const parts = this.info ? this.info.parts : {};
    this.resetParts();
    let lh = parts.lh ? null : null;
    if (o.reloading && def && def.type === 'gun') {
      const p = 1 - Math.max(0, o.reloadT) / def.reload;
      const r = this.reloadPose(def, p, parts);
      pos.add(r.pos); rx += r.rx; ry += r.ry; rz += r.rz; lh = r.lh;
    }
    // firing cycle (slides, bolts, pumps)
    if (this.cycle > 0) { this.cycle += dt / Math.max(0.01, this.cycleDur); if (this.cycle >= 1) this.cycle = 0; else this.cyclePose(def, this.cycle, parts); }
    // bow draw
    if (this.kind === 'bow' && def) {
      const dr = Math.min(1, (o.draw || 0) / 0.45);
      if (parts.string) parts.string.position.z = this.rest.string.p.z + dr * 0.22;
      if (parts.arrow) { parts.arrow.visible = !!o.stack && dr > 0.02; parts.arrow.position.z = this.rest.arrow.p.z + dr * 0.22; }
      if (parts.stringLine) { const ps = parts.stringLine.geometry.attributes.position; ps.setZ(1, 0); ps.needsUpdate = true; }
      rz += 0.12; pos.x -= 0.02 * dr;
    }
    if (def && def.id === 'crossbow' && parts.arrow) parts.arrow.visible = (o.stack && o.stack.ammo > 0) || false;
    // melee: Rust-style wind-up then a down-and-across strike; the arm stays anchored below the screen
    if (this.kind === 'melee' || this.kind === 'item' || this.kind === 'spear') {
      const t = this.swing > 0 ? 1 - this.swing : 1;
      const wind = seg(t, 0, 0.18) * (1 - seg(t, 0.18, 0.32));
      const strike = seg(t, 0.18, 0.42) * (1 - seg(t, 0.55, 1));
      if (this.kind === 'spear') { pos.z += wind * 0.08 - strike * 0.32; pos.x -= strike * 0.04; }
      else if (this.kind === 'item') { pos.add(V(0.02 * wind - 0.09 * strike, 0.03 * wind + 0.02 * strike, 0.05 * wind - 0.2 * strike)); rx += 0.25 * wind - 0.2 * strike; }
      else {
        pos.add(V(0.04 * wind - 0.13 * strike, 0.08 * wind - 0.12 * strike, 0.05 * wind - 0.1 * strike));
        rx += 0.55 * wind - 1.25 * strike; ry += -0.15 * wind + 0.35 * strike; rz += -0.25 * wind + 0.45 * strike;
      }
      if (this.kind === 'melee') { pos.add(V(0.03, -0.03, 0.08)); rx -= 0.1; }
      if (this.kind === 'item') pos.add(V(0.03, -0.02, 0.1));
    }
    if (parts.flame) { const f = 1 + Math.sin(performance.now() * 0.03) * 0.15; parts.flame.scale.set(f, f, 1 + Math.sin(performance.now() * 0.021) * 0.2); }
    P.position.copy(pos);
    P.rotation.set(rx, ry, rz, 'YXZ');
    // right hand sits on the grip; left hand on the support marker (or animated during reload)
    this.rHand.position.set(0.005, -0.02, 0.03); this.rHand.rotation.set(this.kind === 'melee' ? 0.2 : 0.55, 0.15, -0.2);
    this.rHand.visible = true;
    const showL = this.kind === 'rifle' || this.kind === 'pistol' || this.kind === 'bow' || this.kind === 'spear';
    this.lHand.visible = showL;
    if (showL) {
      const target = new THREE.Vector3();
      if (lh) target.copy(lh); else if (parts.lh) parts.lh.getWorldPosition(target); else target.set(0, 0, -0.2);
      if (!lh && parts.lh) this.root.worldToLocal(target);
      else if (lh) { P.updateMatrix(); target.applyMatrix4(P.matrix); }
      this.lHand.position.copy(target).add(V(-0.02, -0.02, 0.0));
      this.lHand.rotation.set(0.45 + rx * 0.8, ry - (this.kind === 'pistol' ? 0.3 : 0.75), rz + 0.5);
    }
    this.placeArm(this.rArm, this.rHand, this.rElbow);
    this.placeArm(this.lArm, this.lHand, this.lElbow);
    // muzzle flash + light
    this.flash.visible = this.flashT > 0;
    this.light.intensity = o.torch ? 2.4 + Math.sin(performance.now() * 0.02) * 0.3 : this.flashT > 0 ? 4 : 0;
    this.light.position.set(0.2, 0.05, o.torch ? -0.3 : -0.6);
  }
  resetParts() {
    if (!this.info) return;
    for (const [k, o] of Object.entries(this.info.parts)) { const r = this.rest[k]; if (!r || k === 'cylinder' || k === 'stock') continue; o.position.copy(r.p); o.rotation.copy(r.r); o.visible = true; }
  }
  cyclePose(def, c, parts) {
    if (!def) return;
    if (def.id === 'semi_pistol' && parts.slide) parts.slide.position.z = this.rest.slide.p.z + bump(c, 0, 1) * 0.035;
    else if (def.id === 'bolt_rifle' && parts.bolt) { const up = bump(c, 0.15, 0.85); parts.bolt.rotation.z = -seg(c, 0.15, 0.3) * 1.1 * (1 - seg(c, 0.7, 0.85)); parts.bolt.position.z = this.rest.bolt.p.z + (seg(c, 0.3, 0.5) - seg(c, 0.5, 0.7)) * 0.07; void up; }
    else if (def.id === 'pump_shotgun' && parts.pump) parts.pump.position.z = this.rest.pump.p.z + bump(c, 0.2, 0.9) * 0.08;
    else if (parts.bolt) parts.bolt.position.z = this.rest.bolt.p.z + bump(c, 0, 1) * 0.04;
    if (parts.hammer && def.id === 'revolver') parts.hammer.rotation.x = -bump(c, 0, 1) * 0.6;
  }
  // Weapon-specific reload choreography. p = 0..1 progress. Returns offsets and an optional left-hand point.
  reloadPose(def, p, parts) {
    const out = { pos: V(0, 0, 0), rx: 0, ry: 0, rz: 0, lh: null };
    const id = def.id;
    if (id === 'revolver') {
      out.rz = seg(p, 0, 0.15) * 0.6 * (1 - seg(p, 0.85, 1)); out.rx = bump(p, 0.15, 0.4) * 0.5;
      if (parts.cylinder) { parts.cylinder.position.x = this.rest.cylinder.p.x - seg(p, 0.1, 0.2) * 0.035 * (1 - seg(p, 0.82, 0.92)); }
      const t = (p * 6) % 1; out.lh = V(-0.05 + Math.sin(t * Math.PI) * 0.04, -0.06 + (p > 0.3 && p < 0.8 ? Math.sin(t * Math.PI) * -0.05 : 0), -0.04);
    } else if (id === 'pump_shotgun' || id === 'bolt_rifle' || id === 'pipe_pistol') {
      const n = id === 'pipe_pistol' ? 1 : 4;
      out.rz = seg(p, 0, 0.12) * 0.7 * (1 - seg(p, 0.85, 1)); out.pos.y = -0.03 * seg(p, 0, 0.12) * (1 - seg(p, 0.85, 1));
      if (id === 'bolt_rifle' && parts.bolt) { parts.bolt.rotation.z = -1.1 * seg(p, 0.05, 0.12) * (1 - seg(p, 0.86, 0.94)); parts.bolt.position.z = this.rest.bolt.p.z + 0.07 * seg(p, 0.12, 0.18) * (1 - seg(p, 0.8, 0.86)); }
      const t = ((p - 0.15) / 0.65 * n) % 1;
      if (p > 0.15 && p < 0.8) out.lh = V(-0.02, -0.03 - Math.sin(t * Math.PI) * 0.08, -0.12 + Math.sin(t * Math.PI) * 0.03);
      if (id === 'pump_shotgun' && parts.pump) parts.pump.position.z = this.rest.pump.p.z + bump(p, 0.82, 0.97) * 0.08;
    } else if (id === 'double_barrel') {
      if (parts.barrels) parts.barrels.rotation.x = -0.6 * seg(p, 0.05, 0.2) * (1 - seg(p, 0.8, 0.92));
      out.rx = 0.25 * seg(p, 0.05, 0.2) * (1 - seg(p, 0.8, 0.92));
      if (p > 0.25 && p < 0.75) { const t = ((p - 0.25) / 0.5 * 2) % 1; out.lh = V(-0.03, -0.08 + Math.sin(t * Math.PI) * 0.06, -0.05); }
    } else if (id === 'crossbow') {
      out.rx = 0.5 * bump(p, 0, 1);
      if (parts.string) parts.string.position.z = this.rest.string.p.z - 0.12 * (1 - seg(p, 0.3, 0.8));
      out.lh = V(-0.02, -0.02 + bump(p, 0.2, 0.8) * 0.05, -0.15 + seg(p, 0.2, 0.8) * 0.1);
    } else {
      // magazine weapons: tilt, mag out, new mag in, seat, charge
      out.rz = seg(p, 0, 0.12) * 0.55 * (1 - seg(p, 0.88, 1)); out.rx = seg(p, 0, 0.12) * 0.12 * (1 - seg(p, 0.88, 1));
      out.pos.y = -0.03 * seg(p, 0, 0.12) * (1 - seg(p, 0.88, 1));
      const mag = parts.mag;
      if (mag) {
        const r = this.rest.mag.p;
        const outT = seg(p, 0.12, 0.3), inT = seg(p, 0.42, 0.62);
        mag.position.y = r.y - outT * 0.25 + inT * 0.25;
        mag.visible = !(p > 0.3 && p < 0.42);
        if (p > 0.3) mag.position.x = r.x - (1 - inT) * 0.05;
        const mw = new THREE.Vector3(); mag.getWorldPosition(mw); void mw;
        out.lh = V(mag.position.x - 0.02, mag.position.y - 0.06, mag.position.z + 0.01);
      }
      if (parts.bolt && p > 0.7) { parts.bolt.position.z = this.rest.bolt.p.z + bump(p, 0.7, 0.85) * 0.06; if (p > 0.68 && p < 0.86) out.lh = V(parts.bolt.position.x + 0.03, parts.bolt.position.y, parts.bolt.position.z + 0.02); }
      if (parts.slide && p > 0.7) parts.slide.position.z = this.rest.slide.p.z + bump(p, 0.72, 0.85) * 0.035;
    }
    return out;
  }
}

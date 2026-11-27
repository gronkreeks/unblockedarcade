// Low-poly meshes for survivors, militia and animals, with simple walk/swing animation.
import * as THREE from 'three';
import { ITEMS, WEAR_SLOTS } from '../data/items.js';

const SKIN = [0xe0b48a, 0xc68e62, 0x8d5a3a, 0xf0c8a0, 0x6b4430];
const matCache = new Map();
function mat(color) { if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color })); return matCache.get(color); }
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const G = { torso: box(0.5, 0.62, 0.28), head: box(0.26, 0.28, 0.26), arm: box(0.15, 0.62, 0.15), leg: box(0.19, 0.78, 0.2), mask: box(0.28, 0.16, 0.06), helm: box(0.3, 0.12, 0.3) };
G.arm.translate(0, -0.29, 0); G.leg.translate(0, -0.38, 0);

export function heldMesh(id) {
  const d = ITEMS[id]; if (!d) return null;
  const g = new THREE.Group();
  const c = mat(new THREE.Color(d.color || '#888').getHex());
  const dark = mat(0x2e2e2e), wood = mat(0x7a5a3a);
  if (id === 'rock') { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), mat(0x9a9a95)); r.position.z = 0.05; g.add(r); return g; }
  if (d.type === 'gun') {
    const long = ['rifle', 'shotgun', 'smg'].includes(d.icon);
    const b = new THREE.Mesh(box(0.07, 0.1, long ? 0.8 : 0.35), dark); b.position.z = long ? 0.3 : 0.12; g.add(b);
    const s = new THREE.Mesh(box(0.06, 0.14, 0.2), c); s.position.set(0, -0.06, long ? -0.12 : -0.02); g.add(s);
  } else if (d.type === 'bow') {
    const b = new THREE.Mesh(box(0.04, 0.9, 0.06), wood); b.position.z = 0.1; g.add(b);
  } else if (d.type === 'melee' || d.type === 'tool' || d.type === 'hammer') {
    const len = d.icon === 'spear' ? 1.6 : 0.6;
    const h = new THREE.Mesh(box(0.05, 0.05, len), wood); h.position.z = len / 2 - 0.1; g.add(h);
    if (d.icon !== 'spear' && d.icon !== 'torch') { const head = new THREE.Mesh(box(0.08, 0.2, 0.1), c); head.position.set(0, 0.05, len - 0.12); g.add(head); }
    if (d.icon === 'torch') { const f = new THREE.Mesh(box(0.1, 0.1, 0.14), mat(0xffa040)); f.position.z = len - 0.05; g.add(f); }
  } else {
    const b = new THREE.Mesh(box(0.15, 0.15, 0.15), c); b.position.z = 0.1; g.add(b);
  }
  return g;
}

export class HumanoidAvatar {
  constructor(opts = {}) {
    this.root = new THREE.Group();
    const skin = opts.skin ?? SKIN[Math.floor(Math.random() * SKIN.length)];
    this.skinMat = mat(skin);
    const body = new THREE.Group(); body.position.y = 0.8; this.root.add(body); this.body = body;
    this.torso = new THREE.Mesh(G.torso, this.skinMat); this.torso.position.y = 0.42; body.add(this.torso);
    this.head = new THREE.Mesh(G.head, this.skinMat); this.head.position.y = 0.88; body.add(this.head);
    this.helm = new THREE.Mesh(G.helm, mat(0x555555)); this.helm.position.y = 1.03; this.helm.visible = false; body.add(this.helm);
    this.mask = new THREE.Mesh(G.mask, mat(0x6f7a86)); this.mask.position.set(0, 0.86, 0.14); this.mask.visible = false; body.add(this.mask);
    this.armL = new THREE.Mesh(G.arm, this.skinMat); this.armL.position.set(-0.33, 0.7, 0); body.add(this.armL);
    this.armR = new THREE.Mesh(G.arm, this.skinMat); this.armR.position.set(0.33, 0.7, 0); body.add(this.armR);
    this.legL = new THREE.Mesh(G.leg, this.skinMat); this.legL.position.set(-0.12, 0.0, 0); body.add(this.legL);
    this.legR = new THREE.Mesh(G.leg, this.skinMat); this.legR.position.set(0.12, 0.0, 0); body.add(this.legR);
    this.hand = new THREE.Group(); this.hand.position.set(0, -0.55, 0.05); this.armR.add(this.hand);
    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.phase = 0; this.swing = 0; this.wearV = -1; this.heldId = null; this.dead = false;
    if (opts.uniform) this.setUniform(opts.uniform);
  }
  setUniform(c) { this.torso.material = mat(c.torso); this.legL.material = this.legR.material = mat(c.legs); this.armL.material = this.armR.material = mat(c.torso); if (c.helm) { this.helm.visible = true; this.helm.material = mat(c.helm); } if (c.mask) this.mask.visible = true; }
  applyWear(wear) {
    const get = (slot) => { const s = wear.slots[WEAR_SLOTS.indexOf(slot)]; return s ? ITEMS[s.id] : null; };
    const shirt = get('shirt'), chest = get('chest'), pants = get('pants'), kilt = get('kilt'), head = get('head'), face = get('face');
    const top = chest || shirt;
    this.torso.material = top ? mat(new THREE.Color(top.color).getHex()) : this.skinMat;
    this.armL.material = this.armR.material = shirt ? mat(new THREE.Color(shirt.color).getHex()) : this.skinMat;
    const leg = kilt || pants || (shirt && shirt.id === 'hazmat_suit' ? shirt : null);
    this.legL.material = this.legR.material = leg ? mat(new THREE.Color(leg.color).getHex()) : this.skinMat;
    const hh = head || (shirt && shirt.id === 'hazmat_suit' ? shirt : null);
    this.helm.visible = !!hh; if (hh) this.helm.material = mat(new THREE.Color(hh.color).getHex());
    this.mask.visible = !!face;
  }
  setHeld(id) {
    if (id === this.heldId) return;
    this.heldId = id;
    while (this.hand.children.length) this.hand.remove(this.hand.children[0]);
    if (id) { const m = heldMesh(id); if (m) { m.rotation.x = -Math.PI / 2; this.hand.add(m); } }
  }
  // speed in m/s, aiming bool, crouch bool
  animate(dt, speed, opts = {}) {
    if (this.dead) return;
    this.phase += dt * speed * 2.2;
    const sw = Math.sin(this.phase) * Math.min(0.7, speed * 0.12);
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw * 0.8;
    this.swing = Math.max(0, this.swing - dt * 4);
    const aim = opts.aim ? -1.45 : -0.35;
    this.armR.rotation.x = opts.aim ? aim : sw * 0.8 + aim * 0.3 - Math.sin(this.swing * Math.PI) * 1.6;
    if (opts.aim) this.armL.rotation.x = -1.2;
    this.body.position.y = opts.crouch ? 0.55 : 0.8;
    this.legL.scale.y = this.legR.scale.y = opts.crouch ? 0.7 : 1;
  }
  die() { this.dead = true; this.root.rotation.z = Math.PI / 2; this.root.position.y += 0.2; }
  revive() { this.dead = false; this.root.rotation.z = 0; }
}

const SPECIES_LOOK = {
  chicken: { body: [0.3, 0.3, 0.4], col: 0xe8e0d0, leg: 0.25, head: 0.16, h: 0.35 },
  deer: { body: [0.45, 0.6, 1.3], col: 0x9a6a3f, leg: 0.8, head: 0.3, h: 1.0, antler: true },
  boar: { body: [0.55, 0.55, 1.1], col: 0x4a3a2a, leg: 0.4, head: 0.35, h: 0.55 },
  wolf: { body: [0.4, 0.5, 1.1], col: 0x7a7a7a, leg: 0.55, head: 0.3, h: 0.75 },
  bear: { body: [0.9, 1.0, 1.9], col: 0x4a3020, leg: 0.7, head: 0.5, h: 1.0 },
};
export class AnimalAvatar {
  constructor(species) {
    const L = SPECIES_LOOK[species];
    this.root = new THREE.Group();
    const m = mat(L.col), dark = mat(0x2a2a2a);
    const body = new THREE.Mesh(box(...L.body), m); body.position.y = L.h + L.body[1] / 2 - 0.05; this.root.add(body);
    const head = new THREE.Mesh(box(L.head, L.head, L.head * 1.3), m); head.position.set(0, L.h + L.body[1] * 0.8, L.body[2] / 2 + L.head * 0.4); this.root.add(head);
    if (L.antler) { const a = new THREE.Mesh(box(0.5, 0.35, 0.05), dark); a.position.set(0, head.position.y + 0.3, head.position.z); this.root.add(a); }
    this.legs = [];
    const lg = box(L.body[0] * 0.25, L.leg, L.body[0] * 0.25); lg.translate(0, -L.leg / 2, 0);
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const leg = new THREE.Mesh(lg, m); leg.position.set(x * L.body[0] * 0.35, L.h, z * L.body[2] * 0.35); this.root.add(leg); this.legs.push(leg);
    }
    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.phase = 0;
  }
  animate(dt, speed) {
    this.phase += dt * speed * 2.5;
    const s = Math.sin(this.phase) * Math.min(0.6, speed * 0.1);
    this.legs[0].rotation.x = s; this.legs[3].rotation.x = s; this.legs[1].rotation.x = -s; this.legs[2].rotation.x = -s;
  }
  die() { this.root.rotation.z = Math.PI / 2; }
}

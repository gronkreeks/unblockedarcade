// First-person held item: bob, swing, recoil, reload dip, muzzle flash, torch light.
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';

export class ViewModel {
  constructor(camera) {
    this.cam = camera;
    this.root = new THREE.Group();
    camera.add(this.root);
    this.pivot = new THREE.Group(); this.root.add(this.pivot);
    this.base = new THREE.Vector3(0.28, -0.3, -0.55);
    this.pivot.position.copy(this.base);
    const armMat = new THREE.MeshLambertMaterial({ color: 0xd0a07a });
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.4), armMat); this.arm.position.set(0.03, -0.09, 0.2); this.pivot.add(this.arm);
    this.holder = new THREE.Group(); this.pivot.add(this.holder);
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd080 }));
    this.flash.visible = false; this.pivot.add(this.flash);
    this.light = new THREE.PointLight(0xffa850, 0, 18, 1.6); this.light.position.set(0.2, 0.1, -0.3); camera.add(this.light);
    this.id = null; this.swing = 0; this.kick = 0; this.bobT = 0; this.flashT = 0; this.reload = 0; this.draw = 0;
    this.root.traverse(o => { o.renderOrder = 10; });
  }
  setItem(id) {
    if (id === this.id) return;
    this.id = id;
    while (this.holder.children.length) this.holder.remove(this.holder.children[0]);
    this.arm.visible = true;
    if (!id) return;
    const m = fpModel(id);
    if (m) this.holder.add(m);
  }
  doSwing() { this.swing = 1; }
  doShot(kick) { this.kick = Math.min(1.5, this.kick + kick); this.flashT = 0.05; }
  update(dt, speed, opts = {}) {
    this.bobT += dt * speed * 1.8;
    const bob = Math.sin(this.bobT) * 0.012 * Math.min(1, speed / 3), bobY = Math.abs(Math.cos(this.bobT)) * 0.01 * Math.min(1, speed / 3);
    this.swing = Math.max(0, this.swing - dt * 3.2);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.flashT -= dt;
    const target = opts.aim ? new THREE.Vector3(0.0, -0.2, -0.45) : this.base;
    this.pivot.position.lerp(new THREE.Vector3(target.x + bob, target.y + bobY - (opts.reloading ? 0.18 : 0), target.z + this.kick * 0.06), Math.min(1, dt * 14));
    const s = Math.sin(this.swing * Math.PI);
    this.pivot.rotation.set(-s * 1.1 + this.kick * 0.12, s * 0.4, s * 0.3);
    this.flash.visible = this.flashT > 0;
    this.flash.position.set(0, 0.04, -0.75);
    this.light.intensity = opts.torch ? 2.2 : this.flashT > 0 ? 3 : 0;
    this.root.visible = !opts.hidden;
  }
}

// First-person models, built for the camera's frame (x right, y up, -z forward).
const MATS = new Map();
const mat = (c) => { if (!MATS.has(c)) MATS.set(c, new THREE.MeshLambertMaterial({ color: c })); return MATS.get(c); };
function box(w, h, d, c, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); return m; }
function fpModel(id) {
  const d = ITEMS[id]; if (!d) return null;
  const g = new THREE.Group();
  const col = new THREE.Color(d.color || '#888').getHex();
  const wood = 0x7a5a3a, dark = 0x2e2e2e;
  if (id === 'rock') { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.085, 0), mat(0x9a9a95)); r.scale.set(1.1, 0.85, 1); r.position.set(0, 0.03, -0.08); g.add(r); return g; }
  if (d.type === 'gun' || d.type === 'bow') {
    if (d.type === 'bow') { g.add(box(0.025, 0.55, 0.03, wood, 0, 0.05, -0.2)); g.add(box(0.004, 0.5, 0.004, 0xdddddd, 0.0, 0.05, -0.15)); return g; }
    const long = ['rifle', 'shotgun', 'smg'].includes(d.icon);
    const L = long ? 0.62 : 0.26;
    g.add(box(0.05, 0.07, L, dark, 0, 0.03, -L / 2));
    g.add(box(0.045, 0.06, L * 0.55, col, 0, -0.01, -L * 0.35));
    g.add(box(0.035, 0.11, 0.05, col, 0, -0.06, -0.02));
    if (long) g.add(box(0.045, 0.08, 0.2, d.icon === 'rifle' ? 0x5a3d22 : col, 0, -0.01, 0.12));
    if (d.icon === 'smg' || d.icon === 'rifle') g.add(box(0.03, 0.12, 0.05, dark, 0, -0.08, -0.18));
    return g;
  }
  if (d.type === 'tool' || d.type === 'melee' || d.type === 'hammer') {
    if (d.icon === 'spear') { const s = box(0.03, 0.03, 1.1, wood, 0, 0, -0.35); g.add(s); g.add(box(0.05, 0.05, 0.14, col, 0, 0, -0.95)); g.rotation.x = 0.1; return g; }
    if (d.icon === 'knife') { g.add(box(0.03, 0.12, 0.035, 0x5a3d22, 0, 0, 0)); g.add(box(0.012, 0.3, 0.05, col, 0, 0.2, 0)); g.rotation.x = -0.4; return g; }
    if (d.icon === 'torch') { g.add(box(0.035, 0.42, 0.035, wood, 0, 0.1, 0)); g.add(box(0.06, 0.08, 0.06, 0xffa040, 0, 0.34, 0)); g.rotation.x = -0.3; return g; }
    g.add(box(0.032, 0.5, 0.032, wood, 0, 0.12, 0));
    if (d.icon === 'pick') g.add(box(0.035, 0.04, 0.32, col, 0, 0.35, -0.02));
    else if (d.icon === 'hammer') g.add(box(0.06, 0.07, 0.16, 0x777777, 0, 0.35, 0));
    else g.add(box(0.025, 0.12, 0.13, col, 0, 0.32, -0.07));
    g.rotation.x = -0.35; g.rotation.z = 0.15;
    return g;
  }
  if (d.type === 'plan') { g.add(box(0.2, 0.005, 0.26, 0xd8e4f0, 0, 0, -0.12)); g.rotation.x = 0.9; return g; }
  g.add(box(0.1, 0.1, 0.1, col, 0, 0, -0.08));
  return g;
}

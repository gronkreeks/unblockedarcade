// Characters and animals. Survivors and militia use a jointed body (hips, spine, head, two-part arms
// and legs, hands, feet) with layered clothing and armour, and procedural animation: idle breathing,
// walk/run/sprint cycles, crouch, jump/fall/land, aiming, reloading, melee swings and death falls.
import * as THREE from 'three';
import { ITEMS, WEAR_SLOTS } from '../data/items.js';
import { buildItemModel } from './WeaponModels.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let M = null;
export function setAvatarMaterials(m) { M = m; }
let BATCH = null;   // gfx/Batcher: draws every character's parts as shared instanced batches
export function setAvatarBatch(b) { BATCH = b; }
const SKIN = [0xc08a64, 0xa06a48, 0x6e4430, 0xc89a78, 0x4e3022, 0xb07a58];
const G = {};
// Small parts nobody can make out past a few dozen metres; gfx/Batcher skips them for far characters.
const DETAIL = new Set(['nose', 'eye', 'hand', 'foot', 'neck', 'strap', 'slit', 'glove', 'boot', 'hoof']);
function geo(key, fn) {
  if (G[key]) return G[key];
  const v = G[key] = fn();
  if (v && v.isBufferGeometry && DETAIL.has(key.split(':').pop())) v.userData.detail = true;
  return v;
}
const capsule = (r, len, k) => geo(k, () => { const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.translate(0, -len / 2 - r * 0.6, 0); return g; });
const mesh = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = true; return x; };
// Parts that never move relative to each other are merged into one model per material (fewer draws).
// list: [[geometry with its offset baked in, material]] -> [[geometry, material]]
function mergeByMat(list) {
  const by = new Map();
  for (const [g, m] of list) { if (!by.has(m)) by.set(m, []); by.get(m).push(g); }
  const out = [];
  for (const [m, gs] of by) {
    // models made different ways (indexed or not, extra attributes) are brought to the same form first
    const sig = x => (x.index ? 'i' : '') + Object.keys(x.attributes).sort().join();
    const norm = x => { const n = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; };
    const g = gs.length === 1 ? gs[0] : mergeGeometries(gs.every(x => sig(x) === sig(gs[0])) ? gs : gs.map(norm));
    if (g) out.push([g, m]); else for (const x of gs) out.push([x, m]);
  }
  return out;
}
const lerp = (a, b, t) => a + (b - a) * t;

function torsoGeo(w, h, d, k) {
  return geo(k, () => {
    const g = new THREE.CapsuleGeometry(0.5, 0.6, 4, 12);
    g.scale(w, h / 1.6, d); g.translate(0, h * 0.5, 0);
    // narrower waist, broader chest
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h; const k2 = 0.82 + 0.22 * Math.min(1, Math.max(0, y)); p.setX(i, p.getX(i) * k2); }
    g.computeVertexNormals();
    return g;
  });
}

// What a character holds: the item's model merged into one piece per material and built once per item,
// so every bot holding the same gun shares it and it's drawn as one batch.
const HELD = new Map();
function heldModel(id) {
  let t = HELD.get(id);
  if (!t) {
    const src = buildItemModel(id), list = [];
    src.updateMatrixWorld(true);
    src.traverse(o => { if (o.isMesh && o.visible) list.push([o.geometry.clone().applyMatrix4(o.matrixWorld), o.material]); });
    t = { parts: mergeByMat(list), weapon: src.userData.weapon };
    HELD.set(id, t);
  }
  const g = new THREE.Group();
  for (const [geo, mat] of t.parts) g.add(new THREE.Mesh(geo, mat));
  g.userData.weapon = t.weapon;
  return g;
}

export class HumanoidAvatar {
  constructor(opts = {}) {
    this.root = new THREE.Group();
    if (BATCH) BATCH.add(this.root);
    const skinCol = opts.skin ?? SKIN[Math.floor(Math.random() * SKIN.length)];
    this.skin = M.get('skin', { color: skinCol });
    this.hairMat = M.get('flat', { color: [0x2a1e14, 0x4a3420, 0x1a1a1a, 0x8a6a3a][Math.floor(Math.random() * 4)] });
    const B = this.b = {};
    B.hips = new THREE.Group(); B.hips.position.y = 0.95; this.root.add(B.hips);
    B.spine = new THREE.Group(); B.hips.add(B.spine);
    B.chest = mesh(torsoGeo(0.4, 0.6, 0.23, 'torso'), this.skin); B.chest.position.y = 0.02; B.spine.add(B.chest);
    B.pelvis = mesh(geo('pelvis', () => new THREE.CapsuleGeometry(0.15, 0.12, 4, 10).rotateZ(Math.PI / 2)), this.skin); B.pelvis.position.y = 0.0; B.hips.add(B.pelvis);
    B.neck = new THREE.Group(); B.neck.position.y = 0.64; B.spine.add(B.neck);
    B.neck.add(mesh(geo('neck', () => new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8).translate(0, 0.04, 0)), this.skin));
    B.head = mesh(geo('head', () => { const g = new THREE.SphereGeometry(0.115, 14, 12); g.scale(0.92, 1.12, 1); g.translate(0, 0.16, 0.01); return g; }), this.skin); B.neck.add(B.head);
    const nose = mesh(geo('nose', () => new THREE.ConeGeometry(0.018, 0.05, 6).rotateX(Math.PI / 2).translate(0, 0.15, 0.12)), this.skin); B.neck.add(nose);
    const eyeM = M.get('flat', { color: 0x1a1a1a });
    for (const x of [-0.04, 0.04]) { const e = mesh(geo('eye', () => new THREE.SphereGeometry(0.014, 6, 6)), eyeM); e.position.set(x, 0.18, 0.1); B.neck.add(e); }
    this.hair = mesh(geo('hair', () => new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.1, 1.05).translate(0, 0.17, -0.005)), this.hairMat); B.neck.add(this.hair);
    const limbs = (side) => {
      const s = side === 'L' ? -1 : 1;
      const ua = new THREE.Group(); ua.position.set(s * 0.22, 0.56, 0); B.spine.add(ua);
      ua.add(mesh(capsule(0.052, 0.2, 'ua'), this.skin));
      const fa = new THREE.Group(); fa.position.y = -0.3; ua.add(fa);
      fa.add(mesh(capsule(0.045, 0.19, 'fa'), this.skin));
      const hd = new THREE.Group(); hd.position.y = -0.28; fa.add(hd);
      hd.add(mesh(geo('hand', () => new THREE.BoxGeometry(0.07, 0.09, 0.035).translate(0, -0.04, 0)), this.skin));
      const th = new THREE.Group(); th.position.set(s * 0.1, -0.04, 0); B.hips.add(th);
      th.add(mesh(capsule(0.075, 0.3, 'th'), this.skin));
      const sh = new THREE.Group(); sh.position.y = -0.44; th.add(sh);
      sh.add(mesh(capsule(0.06, 0.3, 'sh'), this.skin));
      const ft = new THREE.Group(); ft.position.y = -0.43; sh.add(ft);
      const foot = mesh(geo('foot', () => new THREE.BoxGeometry(0.09, 0.07, 0.22).translate(0, -0.035, 0.05)), M.get('leather', { color: 0x3a2a1e })); ft.add(foot);
      B['ua' + side] = ua; B['fa' + side] = fa; B['hd' + side] = hd; B['th' + side] = th; B['sh' + side] = sh; B['ft' + side] = ft; B['foot' + side] = foot;
    };
    limbs('L'); limbs('R');
    this.hand = new THREE.Group(); this.hand.position.set(0, -0.06, 0.02); B.hdR.add(this.hand);
    this.layers = new THREE.Group(); this.root.add(this.layers);
    this.clothes = [];
    this.phase = Math.random() * 6; this.swing = 0; this.wearV = -1; this.heldId = null; this.dead = false; this.deathT = 0; this.air = 0; this.land = 0; this.reloadT = 0; this.breath = Math.random() * 6;
    if (opts.uniform) this.setUniform(opts.uniform);
  }
  // Clothing layers attach to the bones so they follow every animation.
  clearClothes() { for (const c of this.clothes) c.parent && c.parent.remove(c); this.clothes = []; this.hair.visible = true; }
  addLayer(bone, g, m) { const x = mesh(g, m); bone.add(x); this.clothes.push(x); return x; }
  dressShirt(m, sleeves = true) {
    const B = this.b;
    this.addLayer(B.spine, torsoGeo(0.43, 0.62, 0.26, 'torsoC'), m).position.y = 0.01;
    if (sleeves) for (const s of ['L', 'R']) { this.addLayer(B['ua' + s], capsule(0.06, 0.2, 'uaC'), m); this.addLayer(B['fa' + s], capsule(0.052, 0.17, 'faC'), m); }
  }
  dressPants(m) {
    const B = this.b;
    this.addLayer(B.hips, geo('pelvisC', () => new THREE.CapsuleGeometry(0.165, 0.13, 4, 10).rotateZ(Math.PI / 2)), m);
    for (const s of ['L', 'R']) { this.addLayer(B['th' + s], capsule(0.084, 0.3, 'thC'), m); this.addLayer(B['sh' + s], capsule(0.068, 0.28, 'shC'), m); }
  }
  setUniform(c) {
    this.clearClothes();
    this.dressShirt(M.get('cloth', { color: c.torso })); this.dressPants(M.get('cloth', { color: c.legs }));
    this.addLayer(this.b.spine, geo('vest', () => new THREE.BoxGeometry(0.46, 0.4, 0.3).translate(0, 0.36, 0)), M.get('cloth', { color: 0x2f3a2c }));
    if (c.helm) { this.addLayer(this.b.neck, geo('helmet', () => new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.17, 0)), M.get('paint', { color: c.helm })); this.hair.visible = false; }
    if (c.mask) this.addLayer(this.b.neck, geo('gasmask', () => new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0.12, 0.11)), M.get('polymer'));
  }
  applyWear(wear) {
    this.clearClothes();
    const B = this.b;
    const get = (slot) => { const s = wear.slots[WEAR_SLOTS.indexOf(slot)]; return s ? ITEMS[s.id] : null; };
    const shirt = get('shirt'), chest = get('chest'), pants = get('pants'), kilt = get('kilt'), head = get('head'), face = get('face'), feet = get('feet'), hands = get('hands');
    const cm = (d, k = 'cloth') => M.get(k, { color: new THREE.Color(d.color).getHex() });
    if (shirt && shirt.id === 'hazmat_suit') {
      const m = M.get('cloth', { color: 0xd6c43a });
      this.dressShirt(m); this.dressPants(m);
      this.addLayer(B.neck, geo('hood', () => new THREE.SphereGeometry(0.15, 14, 10).scale(1, 1.1, 1).translate(0, 0.16, 0)), m);
      this.addLayer(B.neck, geo('visor', () => new THREE.SphereGeometry(0.12, 12, 8, -0.9, 1.8, 0.9, 1.0).translate(0, 0.16, 0.035)), M.get('glass'));
      this.hair.visible = false;
    } else {
      if (shirt) this.dressShirt(cm(shirt));
      if (pants) this.dressPants(cm(pants));
    }
    if (chest) {
      const k = chest.id === 'wood_chest' ? 'wood' : chest.id === 'roadsign_vest' ? 'paint' : 'armored';
      const mat = k === 'paint' ? M.get('paint', { color: 0xd9b84a }) : M.get(k);
      this.addLayer(B.spine, geo('plateF', () => new THREE.BoxGeometry(0.38, 0.38, 0.04).translate(0, 0.36, 0.14)), mat);
      this.addLayer(B.spine, geo('plateB', () => new THREE.BoxGeometry(0.38, 0.38, 0.04).translate(0, 0.36, -0.14)), mat);
      for (const x of [-0.2, 0.2]) this.addLayer(B.spine, geo('strap', () => new THREE.BoxGeometry(0.04, 0.05, 0.3).translate(0, 0.58, 0)), M.get('leather', { color: 0x3a2a1e })).position.x = x;
    }
    if (kilt) this.addLayer(B.hips, geo('kilt', () => new THREE.CylinderGeometry(0.2, 0.25, 0.3, 10, 1, true).translate(0, -0.12, 0)), M.get('paint', { color: 0xd9b84a }));
    if (head) {
      if (head.id === 'coffee_can_helmet') this.addLayer(B.neck, geo('can', () => new THREE.CylinderGeometry(0.135, 0.135, 0.2, 14).translate(0, 0.22, 0)), M.get('paint', { color: 0x8f969e }));
      else if (head.id === 'bone_helmet') this.addLayer(B.neck, geo('bone', () => new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1.15, 1.1).translate(0, 0.17, 0)), M.get('flat', { color: 0xe8e0cc }));
      else this.addLayer(B.neck, geo('hoodC', () => new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0, 0.16, -0.01)), cm(head));
      this.hair.visible = false;
    }
    if (face) { this.addLayer(B.neck, geo('mask', () => new THREE.BoxGeometry(0.2, 0.17, 0.05).translate(0, 0.15, 0.115)), M.get('armored')); this.addLayer(B.neck, geo('slit', () => new THREE.BoxGeometry(0.15, 0.02, 0.02).translate(0, 0.18, 0.14)), M.get('flat', { color: 0x111111 })); }
    if (feet) for (const s of ['L', 'R']) this.addLayer(B['ft' + s], geo('boot', () => new THREE.BoxGeometry(0.1, 0.16, 0.24).translate(0, -0.0, 0.04)), M.get('leather', { color: 0x5a3d22 }));
    if (hands) for (const s of ['L', 'R']) this.addLayer(B['hd' + s], geo('glove', () => new THREE.BoxGeometry(0.08, 0.1, 0.045).translate(0, -0.04, 0)), M.get('leather', { color: 0x6b4a2e }));
  }
  setHeld(id) {
    if (id === this.heldId) return;
    this.heldId = id;
    while (this.hand.children.length) this.hand.remove(this.hand.children[0]);
    if (!id) return;
    const m = heldModel(id);
    m.rotation.x = -Math.PI / 2;
    m.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.hand.add(m);
    const d = ITEMS[id];
    this.gun = d && (d.type === 'gun' || d.type === 'bow');
    this.longGun = this.gun && !(m.userData.weapon && m.userData.weapon.pistol);
  }
  // opts: aim, crouch, onGround, vy, reloading, sprint
  animate(dt, speed, o = {}) {
    const B = this.b;
    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 2.2);
      const t = this.deathT, e = 1 - Math.pow(1 - t, 3);
      this.root.rotation.x = -e * Math.PI / 2 * this.fallDir; this.root.position.y += 0; B.hips.position.y = lerp(0.95, 0.2, e);
      B.uaL.rotation.z = -e * 1.2; B.uaR.rotation.z = e * 1.2; B.thL.rotation.x = e * 0.2; B.thR.rotation.x = -e * 0.3; B.shL.rotation.x = e * 0.4;
      return;
    }
    this.breath += dt;
    // airborne / landing state
    if (o.onGround === false) this.air = Math.min(1, this.air + dt * 5); else { if (this.air > 0.5) this.land = 1; this.air = Math.max(0, this.air - dt * 8); }
    this.land = Math.max(0, this.land - dt * 4);
    const run = Math.min(1, Math.max(0, (speed - 3) / 2.5)), walk = Math.min(1, speed / 3);
    this.phase += dt * (speed > 0.1 ? 4.2 + speed * 1.15 : 0);
    const ph = this.phase;
    const amp = walk * (0.45 + run * 0.45);
    const crouch = o.crouch ? 1 : 0;
    // hips + spine
    B.hips.position.y = 0.95 - crouch * 0.32 - Math.abs(Math.sin(ph)) * 0.035 * walk + 0.02 * walk - this.land * 0.12;
    B.spine.rotation.x = run * 0.22 + crouch * 0.25 + (o.aim ? 0.05 : 0);
    B.spine.rotation.y = Math.sin(ph) * 0.08 * walk * (o.aim ? 0.2 : 1);
    B.chest.scale.set(1, 1 + Math.sin(this.breath * 1.6) * 0.012, 1);
    // legs
    const legSwing = (side, off) => {
      const s = Math.sin(ph + off);
      const th = B['th' + side], sh = B['sh' + side], ft = B['ft' + side];
      th.rotation.x = -s * amp - crouch * 1.05 - this.air * 0.55;
      sh.rotation.x = Math.max(0, Math.cos(ph + off) * amp * 1.4) + crouch * 1.7 + this.air * 0.9 + this.land * 0.4;
      ft.rotation.x = -crouch * 0.6 + Math.max(0, -s) * 0.3 * walk;
    };
    legSwing('L', 0); legSwing('R', Math.PI);
    // arms
    this.swing = Math.max(0, this.swing - dt * 3.5);
    const armSwing = Math.sin(ph) * amp * 0.9;
    if (o.aim && this.gun) {
      const lo = o.reloading ? 0.5 : 0;
      B.uaR.rotation.set(-1.35 + lo, 0, -0.1); B.faR.rotation.set(-0.25, 0, 0);
      if (this.longGun) { B.uaL.rotation.set(-1.25 + lo, 0, 0.55); B.faL.rotation.set(-0.5, 0, 0); }
      else { B.uaL.rotation.set(-1.3 + lo, 0, 0.35); B.faL.rotation.set(-0.3, 0, 0); }
      if (o.reloading) { const r = Math.sin(this.breath * 5) * 0.3; B.uaL.rotation.x += 0.4 + r; B.faL.rotation.x -= 0.3; }
    } else {
      const sw = Math.sin(this.swing * Math.PI);
      B.uaR.rotation.set(armSwing * 0.8 - (this.gun ? 0.35 : 0.15) - sw * 2.2 - run * 0.2, 0, -0.08 - sw * 0.3);
      B.faR.rotation.set(-0.25 - run * 0.9 - sw * 0.4, 0, 0);
      B.uaL.rotation.set(-armSwing * 0.8 - run * 0.2 - this.air * 0.5, 0, 0.08 + this.air * 0.4);
      B.faL.rotation.set(-0.2 - run * 0.9, 0, 0);
    }
    B.neck.rotation.x = -(B.spine.rotation.x * 0.6);
  }
  die() { this.dead = true; this.deathT = 0; this.fallDir = Math.random() < 0.5 ? 1 : -1; }
  revive() { this.dead = false; this.root.rotation.x = 0; this.deathT = 0; }
}

// ---------- animals ----------
const SPECIES_LOOK = {
  chicken: { len: 0.32, h: 0.28, w: 0.2, leg: 0.22, neck: 0.15, head: 0.08, col: 0xe8e0d0, tail: 0.1, beak: true },
  deer: { len: 1.15, h: 0.5, w: 0.36, leg: 0.85, neck: 0.5, head: 0.17, col: 0x9a6a3f, tail: 0.12, antler: true },
  boar: { len: 1.0, h: 0.55, w: 0.45, leg: 0.4, neck: 0.15, head: 0.25, col: 0x4a3a2a, tail: 0.1, tusk: true },
  wolf: { len: 1.0, h: 0.42, w: 0.32, leg: 0.6, neck: 0.25, head: 0.16, col: 0x7a7a7a, tail: 0.45, ears: true },
  bear: { len: 1.7, h: 0.95, w: 0.85, leg: 0.65, neck: 0.25, head: 0.3, col: 0x4a3020, tail: 0.08, ears: true },
};
export class AnimalAvatar {
  constructor(species) {
    const L = SPECIES_LOOK[species];
    this.L = L;
    // models are shared by every animal of a species, so they can be drawn as one batch (gfx/Batcher)
    const cg = (k, fn) => geo(species + ':' + k, fn);
    const fur = M.get('fur', { color: L.col }), dark = M.get('flat', { color: 0x1e1a16 }), horn = M.get('flat', { color: 0xcab89a });
    this.root = new THREE.Group();
    const body = new THREE.Group(); body.position.y = L.leg + L.h * 0.5; this.root.add(body); this.body = body;
    const torso = mesh(cg('torso', () => new THREE.CapsuleGeometry(L.h * 0.5, L.len * 0.7, 4, 12).rotateX(Math.PI / 2).scale(L.w / L.h, 1, 1)), fur); body.add(torso);
    const neck = new THREE.Group(); neck.position.set(0, L.h * 0.25, L.len * 0.48); body.add(neck); this.neck = neck;
    neck.add(mesh(cg('neckA', () => new THREE.CapsuleGeometry(L.head * 0.55, L.neck, 3, 8).rotateX(-0.9).translate(0, L.neck * 0.35, L.neck * 0.25)), fur));
    const head = new THREE.Group(); head.position.set(0, L.neck * 0.75, L.neck * 0.5); neck.add(head); this.head = head;
    const ivory = M.get('flat', { color: 0xece6d6 }), beak = M.get('flat', { color: 0xd8a23a });
    const headParts = geo(species + ':headParts', () => {
      const list = [];
      list.push([new THREE.SphereGeometry(L.head, 10, 8).scale(0.85, 0.85, 1.1), fur]);
      list.push([new THREE.CylinderGeometry(L.head * 0.45, L.head * 0.6, L.head * 1.2, 8).rotateX(Math.PI / 2).translate(0, -L.head * 0.2, L.head * 1.0), fur]);
      list.push([new THREE.SphereGeometry(L.head * 0.2, 6, 6).translate(0, -L.head * 0.15, L.head * 1.6), dark]);
      for (const s of [-1, 1]) {
        list.push([new THREE.SphereGeometry(L.head * 0.12, 6, 6).translate(s * L.head * 0.45, L.head * 0.25, L.head * 0.6), dark]);
        if (L.ears) list.push([new THREE.ConeGeometry(L.head * 0.25, L.head * 0.55, 5).translate(s * L.head * 0.5, L.head * 0.85, -L.head * 0.1), fur]);
        if (L.antler) {
          const ox = s * L.head * 0.4, oy = L.head * 0.8;
          list.push([new THREE.CylinderGeometry(0.015, 0.025, 0.45, 5).translate(0, 0.22, 0).rotateZ(-s * 0.4).translate(ox, oy, 0), horn]);
          list.push([new THREE.CylinderGeometry(0.01, 0.02, 0.25, 5).translate(0, 0.12, 0).rotateZ(s * 0.3).translate(-s * 0.08, 0.25, 0.05).translate(ox, oy, 0), horn]);
        }
        if (L.tusk) list.push([new THREE.ConeGeometry(0.018, 0.1, 5).rotateX(-0.6).translate(s * L.head * 0.5, -L.head * 0.3, L.head * 1.3), ivory]);
      }
      if (L.beak) list.push([new THREE.ConeGeometry(0.025, 0.07, 5).rotateX(Math.PI / 2).translate(0, -0.01, L.head * 1.6), beak]);
      const out = mergeByMat(list);
      for (const [g, m] of out) if (m === dark) g.userData.detail = true;   // eyes and nose
      return out;
    });
    for (const [g, m] of headParts) head.add(mesh(g, m));
    const tail = mesh(cg('tail', () => new THREE.CapsuleGeometry(Math.max(0.02, L.h * 0.12), L.tail, 3, 6).translate(0, -L.tail * 0.5, 0)), fur); tail.position.set(0, L.h * 0.25, -L.len * 0.5); tail.rotation.x = -0.9; body.add(tail); this.tail = tail;
    this.legs = [];
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const up = new THREE.Group(); up.position.set(x * L.w * 0.32, -L.h * 0.15, z * L.len * 0.38); body.add(up);
      up.add(mesh(cg('legU', () => new THREE.CapsuleGeometry(L.w * 0.13, L.leg * 0.4, 3, 6).translate(0, -L.leg * 0.25, 0)), fur));
      const lo = new THREE.Group(); lo.position.y = -L.leg * 0.5; up.add(lo);
      lo.add(mesh(cg('legL', () => new THREE.CapsuleGeometry(L.w * 0.09, L.leg * 0.4, 3, 6).translate(0, -L.leg * 0.22, 0)), fur));
      lo.add(mesh(cg('hoof', () => new THREE.BoxGeometry(L.w * 0.2, 0.04, L.w * 0.25).translate(0, -L.leg * 0.45, 0.02)), dark));
      this.legs.push({ up, lo, z });
    }
    if (BATCH) BATCH.add(this.root);
    this.phase = Math.random() * 6; this.deathT = -1;
  }
  animate(dt, speed) {
    if (this.deathT >= 0) { this.deathT = Math.min(1, this.deathT + dt * 2); this.root.rotation.z = (1 - Math.pow(1 - this.deathT, 3)) * Math.PI / 2; return; }
    this.phase += dt * (speed > 0.1 ? 3 + speed * 1.4 : 0.6);
    const a = Math.min(0.8, speed * 0.12), gallop = speed > 5;
    this.legs.forEach((l, i) => {
      const off = gallop ? (l.z > 0 ? 0 : Math.PI * 0.6) + (i % 2) * 0.3 : (i === 0 || i === 3 ? 0 : Math.PI);
      const s = Math.sin(this.phase + off);
      l.up.rotation.x = s * a; l.lo.rotation.x = Math.max(0, -Math.cos(this.phase + off)) * a * 1.2;
    });
    this.body.position.y = this.L.leg + this.L.h * 0.5 + Math.abs(Math.sin(this.phase)) * a * 0.06;
    this.neck.rotation.x = speed < 0.2 ? Math.sin(this.phase * 0.3) * 0.25 + 0.3 : -0.1 + Math.sin(this.phase * 2) * 0.05;
    this.tail.rotation.z = Math.sin(this.phase * 1.5) * 0.3;
  }
  die() { this.deathT = 1; this.root.rotation.z = Math.PI / 2; this.root.position.y += this.L.w * 0.3; }
}

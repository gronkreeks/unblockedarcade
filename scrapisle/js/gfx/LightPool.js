// Fire light at night: campfires, furnaces, candles, torches (yours included) and muzzle flashes.
// A small fixed set of point lights is handed each frame to the sources nearest the camera. Every
// point light costs every lit pixel, so the pool is only switched on at night (one shader rebuild at
// dusk and dawn) and holds 2 to 6 lights depending on the graphics preset.
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';

// what each kind of light gives: intensity (candela), reach (m), height above the item, colour
const KINDS = {
  campfire: { i: 34, r: 20, y: 0.5, c: 0xff9a40 },
  furnace: { i: 16, r: 12, y: 0.45, c: 0xff8a30 },
  candle: { i: 4.5, r: 7, y: 0.22, c: 0xffc070 },
  torch: { i: 22, r: 18, y: 1.5, c: 0xffa850 },
};
const _v = new THREE.Vector3();

export class LightPool {
  constructor(game, n = 4) {
    this.game = game;
    this.lights = [];
    for (let k = 0; k < n; k++) {
      const L = new THREE.PointLight(0xffa040, 0, 20, 2); L.castShadow = false; L.visible = false;
      game.scene.add(L); this.lights.push(L);
    }
    this.on = false;
    this.src = [];
    this.scanT = 0;
  }
  update(cp, dt = 0.016) {
    const G = this.game;
    // night only (with a little overlap at dusk and dawn)
    const sh = G.env.sunHeight(), want = this.on ? sh < 0.12 : sh < 0.06;
    if (want !== this.on) { this.on = want; for (const L of this.lights) { L.visible = want; L.intensity = 0; } }
    if (!this.on) return;
    // the world's fires change slowly: rescan a few times a second
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.25;
      const src = this.src; src.length = 0;
      const R = 60;
      G.deploy.hash.query(cp.x, cp.z, R, d => {
        const K = KINDS[d.type]; if (!K || !d.on) return;
        src.push({ x: d.x, y: d.y + K.y, z: d.z, K, seed: d.x * 0.37 + d.z * 0.11 });
      });
      G.actorHash.query(cp.x, cp.z, R, a => {
        if (a === G.player || !a.alive || !a.inv || a.kind !== 'survivor') return;
        const st = a.inv.belt.slots[a.active]; if (!st || !ITEMS[st.id].light) return;
        src.push({ x: a.x, y: a.y + KINDS.torch.y, z: a.z, K: KINDS.torch, seed: a.x, actor: a });
      });
      for (const s of src) s.d = (s.x - cp.x) ** 2 + (s.z - cp.z) ** 2 - s.K.r * s.K.r * 0.5;   // brighter ones win at equal range
      src.sort((a, b) => a.d - b.d);
    }
    const t = performance.now() * 0.001;
    let k = 0;
    // your own torch or muzzle flash comes first, just in front of your view
    const vm = G.controls && G.controls.vm;
    if (vm && vm.light.intensity > 0 && this.lights.length) {
      const L = this.lights[k++];
      G.camera.getWorldDirection(_v);
      L.position.set(cp.x + _v.x * 0.4, cp.y - 0.15, cp.z + _v.z * 0.4); L.color.setHex(0xffa850); L.distance = 20; L.intensity = vm.light.intensity;
    }
    for (let j = 0; k < this.lights.length; k++, j++) {
      const L = this.lights[k], s = this.src[j];
      if (!s) { L.intensity = 0; continue; }
      if (s.actor) { s.x = s.actor.x; s.z = s.actor.z; s.y = s.actor.y + s.K.y; }
      const flick = s.K === KINDS.candle ? 1 + Math.sin(t * 9 + s.seed) * 0.05 : 1 + Math.sin(t * 13 + s.seed) * 0.07 + Math.sin(t * 5.1 + s.seed * 2) * 0.06;
      L.position.set(s.x, s.y, s.z); L.color.setHex(s.K.c); L.distance = s.K.r; L.intensity = s.K.i * flick;
    }
  }
}

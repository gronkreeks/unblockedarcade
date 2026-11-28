// Fire light at night: campfires, furnaces, candles and torches carried by others.
// A fixed set of point lights (so shaders never recompile) is handed each frame to the sources
// nearest the camera. Intensities are physical (candela) with inverse-square falloff.
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';

// what each kind of light gives: intensity, reach (m), height above the item, colour
const KINDS = {
  campfire: { i: 34, r: 22, y: 0.5, c: 0xff9a40 },
  furnace: { i: 16, r: 13, y: 0.45, c: 0xff8a30 },
  candle: { i: 4.5, r: 8, y: 0.22, c: 0xffc070 },
  torch: { i: 22, r: 20, y: 1.5, c: 0xffa850 },
};

export class LightPool {
  constructor(game, n = 8) {
    this.game = game;
    this.lights = [];
    for (let k = 0; k < n; k++) {
      const L = new THREE.PointLight(0xffa040, 0, 20, 2); L.castShadow = false;
      game.scene.add(L); this.lights.push(L);
    }
    this.src = [];
  }
  update(cp) {
    const G = this.game, src = this.src; src.length = 0;
    const R = 70;
    G.deploy.hash.query(cp.x, cp.z, R, d => {
      const K = KINDS[d.type]; if (!K || !d.on) return;
      src.push({ x: d.x, y: d.y + K.y, z: d.z, K, seed: d.x * 0.37 + d.z * 0.11 });
    });
    G.actorHash.query(cp.x, cp.z, R, a => {
      if (a === G.player || !a.alive || !a.inv || a.kind !== 'survivor') return;
      const st = a.inv.belt.slots[a.active]; if (!st || !ITEMS[st.id].light) return;
      src.push({ x: a.x, y: a.y + KINDS.torch.y, z: a.z, K: KINDS.torch, seed: a.x });
    });
    for (const s of src) s.d = (s.x - cp.x) ** 2 + (s.z - cp.z) ** 2 - s.K.r * s.K.r * 0.5;   // brighter ones win at equal range
    src.sort((a, b) => a.d - b.d);
    const t = performance.now() * 0.001;
    this.lights.forEach((L, k) => {
      const s = src[k];
      if (!s) { if (L.intensity) L.intensity = 0; return; }
      const flick = s.K === KINDS.candle ? 1 + Math.sin(t * 9 + s.seed) * 0.05 : 1 + Math.sin(t * 13 + s.seed) * 0.07 + Math.sin(t * 5.1 + s.seed * 2) * 0.06;
      L.position.set(s.x, s.y, s.z); L.color.setHex(s.K.c); L.distance = s.K.r; L.intensity = s.K.i * flick;
    });
  }
}

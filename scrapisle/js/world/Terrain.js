// Terrain, water, river and road meshes built from the World data.
import * as THREE from 'three';
import { BIOME, SEA_LEVEL } from './WorldGeneration.js';
import { hash2, lerp, clamp } from '../core/util.js';

const BIOME_COL = {
  [BIOME.OCEAN]: [0.76, 0.70, 0.52],
  [BIOME.BEACH]: [0.86, 0.79, 0.58],
  [BIOME.GRASS]: [0.42, 0.58, 0.26],
  [BIOME.FOREST]: [0.26, 0.42, 0.20],
  [BIOME.ROCK]: [0.50, 0.48, 0.45],
  [BIOME.SNOW]: [0.90, 0.92, 0.95],
  [BIOME.DESERT]: [0.82, 0.66, 0.42],
};

export function buildTerrain(world, scene) {
  const group = new THREE.Group();
  const N = world.N, CH = 64;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const H = world.heights;
  for (let cj = 0; cj < N - 1; cj += CH) for (let ci = 0; ci < N - 1; ci += CH) {
    const w = Math.min(CH, N - 1 - ci), h = Math.min(CH, N - 1 - cj);
    const vx = w + 1, vz = h + 1;
    const pos = new Float32Array(vx * vz * 3), col = new Float32Array(vx * vz * 3);
    for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
      const gi = ci + i, gj = cj + j, k = gj * N + gi, o = (j * vx + i) * 3;
      const x = world.fromGrid(gi), z = world.fromGrid(gj), y = H[k];
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      const b = world.biome[k];
      let c = BIOME_COL[b];
      const slope = (gi > 0 && gj > 0 && gi < N - 1 && gj < N - 1) ? Math.max(Math.abs(H[k + 1] - H[k - 1]), Math.abs(H[k + N] - H[k - N])) / 8 : 0;
      let r = c[0], g = c[1], bl = c[2];
      // steep = rock, underwater = sand/dark
      const rockT = clamp((slope - 0.55) * 2.2, 0, 1);
      if (b !== BIOME.SNOW || slope > 0.8) { r = lerp(r, 0.47, rockT); g = lerp(g, 0.45, rockT); bl = lerp(bl, 0.42, rockT); }
      if (y < SEA_LEVEL) { const d = clamp(-y / 12, 0, 1); r = lerp(0.74, 0.30, d); g = lerp(0.68, 0.36, d); bl = lerp(0.50, 0.38, d); }
      if (world.water[k] > -900 && y < world.water[k] + 0.3) { r *= 0.7; g *= 0.72; bl *= 0.7; }
      if (world.roadMask[k]) { r = 0.30; g = 0.29; bl = 0.28; }
      const n = (hash2(gi, gj, 7) - 0.5) * 0.06;
      col[o] = clamp(r + n, 0, 1); col[o + 1] = clamp(g + n, 0, 1); col[o + 2] = clamp(bl + n, 0, 1);
    }
    const idx = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const a = j * vx + i, b2 = a + 1, c2 = a + vx, d = c2 + 1;
      idx.push(a, c2, b2, b2, c2, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
  }
  scene.add(group);

  // Ocean
  const oceanMat = new THREE.MeshLambertMaterial({ color: 0x2f6f8f, transparent: true, opacity: 0.82 });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(world.size * 3, world.size * 3, 1, 1), oceanMat);
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = SEA_LEVEL;
  scene.add(ocean);

  // Rivers: ribbons along the path at the water surface
  const riverMat = new THREE.MeshLambertMaterial({ color: 0x3f86a8, transparent: true, opacity: 0.85 });
  for (const rv of world.rivers) {
    const pts = rv.pts, pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], pp = pts[Math.max(0, i - 1)];
      let dx = q.x - pp.x, dz = q.z - pp.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const w = p.w * 0.6;
      const y = Math.max(p.s, SEA_LEVEL + 0.02);
      pos.push(p.x - dz * w, y, p.z + dx * w, p.x + dz * w, y, p.z - dx * w);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, riverMat);
    m.renderOrder = 1;
    scene.add(m);
  }

  // Roads: painted centre line ribbons on top of the dark road colour baked in terrain
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xc9b25a });
  for (const road of world.roads) {
    const pts = road.pts, pos = [], idx = [];
    let n = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const L = Math.hypot(q.x - p.x, q.z - p.z);
      const dx = (q.x - p.x) / L, dz = (q.z - p.z) / L;
      for (let d = 0; d < L - 3; d += 6) {
        const x0 = p.x + dx * d, z0 = p.z + dz * d, x1 = p.x + dx * (d + 3), z1 = p.z + dz * (d + 3);
        const y0 = world.heightAt(x0, z0) + 0.06, y1 = world.heightAt(x1, z1) + 0.06;
        const w = 0.12;
        pos.push(x0 - dz * w, y0, z0 + dx * w, x0 + dz * w, y0, z0 - dx * w, x1 - dz * w, y1, z1 + dx * w, x1 + dz * w, y1, z1 - dx * w);
        idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); n += 4;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    scene.add(new THREE.Mesh(g, lineMat));
  }
  return { group, ocean };
}

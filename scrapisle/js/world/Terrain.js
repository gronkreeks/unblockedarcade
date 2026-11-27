// Terrain: chunked meshes with two levels of detail, smooth bicubic heights, and a splatting shader that
// blends seven PBR layers (grass, forest floor, sand, dirt, rock, snow, asphalt) by biome, slope, height
// and noise, with two-scale sampling to hide tiling and baked ambient occlusion. Plus ocean, rivers, roads.
import * as THREE from 'three';
import { BIOME, SEA_LEVEL } from './WorldGeneration.js';
import { hash2, clamp, smoothstep } from '../core/util.js';
import { Noise2D } from '../core/noise.js';
import { waterMaterial, makeDepthTexture } from '../gfx/Water.js';

const CH = 64;           // heightmap cells per chunk (256 m)

function terrainMaterial(arrays, quality) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tAlb = { value: arrays.albedo }; sh.uniforms.tNor = { value: arrays.normal };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aW0; attribute vec4 aW1; varying vec4 vW0; varying vec4 vW1; varying vec3 vWPos; varying vec3 vWN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vW0 = aW0; vW1 = aW1; vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray tAlb; uniform sampler2DArray tNor;
        varying vec4 vW0; varying vec4 vW1; varying vec3 vWPos; varying vec3 vWN;
        float th(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float tn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(th(i), th(i + vec2(1, 0)), f.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), f.x), f.y); }
        vec4 tAcc; vec3 tNAcc; float tAO;
        void layer(float w, float idx, vec2 uvA, vec2 uvB, float mb) {
          if (w < 0.01) return;
          vec4 a = texture(tAlb, vec3(uvA, idx));
          vec4 n = texture(tNor, vec3(uvA, idx));
          ${quality > 0 ? 'vec4 a2 = texture(tAlb, vec3(uvB, idx)); vec4 n2 = texture(tNor, vec3(uvB, idx)); a = mix(a, a2, mb); n = mix(n, n2, mb);' : ''}
          tAcc += a * w; tNAcc += (n.xyz * 2.0 - 1.0) * w; tAO += n.w * w;
        }
        // triplanar for cliffs: no stretching on steep faces
        void layerTri(float w, float idx, float sc) {
          if (w < 0.01) return;
          vec3 bw = pow(abs(normalize(vWN)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          vec4 ax = texture(tAlb, vec3(vWPos.zy * sc, idx)), ay = texture(tAlb, vec3(vWPos.xz * sc, idx)), az = texture(tAlb, vec3(vWPos.xy * sc, idx));
          vec4 nx = texture(tNor, vec3(vWPos.zy * sc, idx)), ny = texture(tNor, vec3(vWPos.xz * sc, idx)), nz = texture(tNor, vec3(vWPos.xy * sc, idx));
          vec4 a = ax * bw.x + ay * bw.y + az * bw.z, n = nx * bw.x + ny * bw.y + nz * bw.z;
          tAcc += a * w; tNAcc += (n.xyz * 2.0 - 1.0) * w; tAO += n.w * w;
        }`)
      .replace('#include <map_fragment>', `
        tAcc = vec4(0.0); tNAcc = vec3(0.0); tAO = 0.0;
        vec2 uvA = vWPos.xz * 0.28;
        float rot = 0.7;
        vec2 uvB = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * vWPos.xz * 0.071 + 0.37;
        float macro = tn(vWPos.xz * 0.013) * 0.6 + tn(vWPos.xz * 0.051) * 0.4;
        float mb = smoothstep(0.3, 0.7, tn(vWPos.xz * 0.021 + 11.0));
        float wsum = dot(vW0, vec4(1.0)) + vW1.x + vW1.y + vW1.z;
        vec4 w0 = vW0 / max(wsum, 0.001); vec3 w1 = vW1.xyz / max(wsum, 0.001);
        layer(w0.x, 0.0, uvA, uvB, mb); layer(w0.y, 1.0, uvA, uvB, mb); layer(w0.z, 2.0, uvA * 0.8, uvB, mb); layer(w0.w, 3.0, uvA, uvB, mb);
        layerTri(w1.x, 4.0, 0.14); layer(w1.y, 5.0, uvA * 0.6, uvB, mb); layer(w1.z, 6.0, uvA * 0.7, uvB * 2.0, 0.0);
        vec3 tCol = tAcc.rgb * (0.82 + macro * 0.32);
        diffuseColor.rgb *= tCol * vW1.w * (0.55 + 0.45 * tAO);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(tAcc.a, 0.3, 1.0);')
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 tN = normalize(tNAcc + vec3(0.0, 0.0, 0.001));
          vec3 up = normalize(vWN);
          vec3 tx = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
          vec3 tz = normalize(cross(tx, up));
          vec3 wN = normalize(up * tN.z * 1.4 + tx * tN.x - tz * tN.y);
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'terrain' + quality;
  return m;
}

// Layer weights at a point: [grass, forest, sand, dirt] [rock, snow, asphalt, ao]
const BW = new Float32Array(8);
function weightsAt(world, n, x, z, h, slope) {
  world.biomeWeights(x, z, BW);
  const pn = n.fbm(x * 0.03, z * 0.03, 3), pn2 = n.fbm(x * 0.11 + 9, z * 0.11, 2);
  let grass = BW[BIOME.GRASS] + BW[BIOME.FOREST] * 0.25;
  let forest = BW[BIOME.FOREST] * 0.75;
  let sand = BW[BIOME.BEACH] + BW[BIOME.OCEAN] + BW[BIOME.DESERT] * 0.65;
  let dirt = BW[BIOME.DESERT] * 0.35 + BW[BIOME.ROCK] * 0.3;
  let rock = BW[BIOME.ROCK] * 0.7;
  let snow = BW[BIOME.SNOW];
  // noise patches: bare dirt in fields, rock showing through snow
  const patch = smoothstep(0.25, 0.5, pn);
  dirt += grass * patch * 0.5; grass *= 1 - patch * 0.5;
  const fp = smoothstep(0.1, 0.45, pn2); forest += grass * fp * 0.3 * BW[BIOME.FOREST];
  // slopes become rock, gentle shores become sand
  const rk = smoothstep(0.38, 0.75, slope);
  const total = grass + forest + sand + dirt + snow;
  rock += rk * 1.5; const keep = 1 - Math.min(1, rk);
  grass *= keep; forest *= keep; sand *= keep; dirt = dirt * keep + rk * 0.2; snow *= 1 - Math.min(1, rk * 0.6);
  if (h < 2.2 && h > -3) { const s = smoothstep(2.2, 1.0, h); sand += s * 1.2; grass *= 1 - s; forest *= 1 - s; }
  // river beds
  const rv = world.riverAt(x, z);
  if (rv > -900 && h < rv + 0.6) { dirt += 1.2; grass *= 0.2; forest *= 0.2; }
  const road = clamp(world.roadWeight(x, z) * 1.3, 0, 1);
  const k = 1 - road;
  void total;
  return [grass * k, forest * k, sand * k, dirt * k + road * 0.15, rock * k, snow * k, road * 1.2];
}

export function buildTerrain(world, game) {
  const scene = game.scene, gfx = game.gfx;
  const quality = gfx.texture >= 512 ? 1 : 0;
  const arrays = game.tex.terrainArrays();
  const mat = terrainMaterial(arrays, quality);
  const noise = new Noise2D(world.seed ^ 0x7e11);
  const chunks = [];
  const N = world.N;
  const group = new THREE.Group();
  // Layer weights + AO computed once per heightmap vertex; chunks interpolate them (cheap rebuilds).
  const WG = new Float32Array(N * N * 8);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = world.fromGrid(i), z = world.fromGrid(j), H = world.heights;
    const h = H[k];
    const hl = H[k - (i > 0 ? 1 : 0)], hr = H[k + (i < N - 1 ? 1 : 0)], hd = H[k - (j > 0 ? N : 0)], hu = H[k + (j < N - 1 ? N : 0)];
    const ny = 2 * world.cs / Math.hypot(hl - hr, 2 * world.cs, hd - hu);
    const w = weightsAt(world, noise, x, z, h, (1 - ny) * 3);
    const r = 2;
    const avg = (H[j * N + Math.max(0, i - r)] + H[j * N + Math.min(N - 1, i + r)] + H[Math.max(0, j - r) * N + i] + H[Math.min(N - 1, j + r) * N + i]) / 4;
    const ao = clamp(1 - Math.max(0, avg - h) * 0.07 + (hash2(i, j, 3) - 0.5) * 0.04, 0.62, 1.05);
    WG.set(w, k * 8); WG[k * 8 + 7] = ao;
  }
  const wAt = (x, z, out) => {
    const gx = clamp(world.toGrid(x), 0, N - 1.001), gz = clamp(world.toGrid(z), 0, N - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const a = (j * N + i) * 8, b = a + 8, c = a + N * 8, d = c + 8;
    const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
    for (let q = 0; q < 8; q++) out[q] = WG[a + q] * w00 + WG[b + q] * w10 + WG[c + q] * w01 + WG[d + q] * w11;
    return out;
  };
  const tmpW = new Float32Array(8);
  const build = (ci, cj, step) => {
    const cells = CH * world.cs / step;
    const vx = cells + 1;
    const x0 = world.fromGrid(ci), z0 = world.fromGrid(cj);
    const pos = new Float32Array(vx * vx * 3), nor = new Float32Array(vx * vx * 3), w0 = new Float32Array(vx * vx * 4), w1 = new Float32Array(vx * vx * 4);
    for (let j = 0; j < vx; j++) for (let i = 0; i < vx; i++) {
      const x = x0 + i * step, z = z0 + j * step, o = j * vx + i;
      const h = world.heightAt(x, z);
      pos[o * 3] = x; pos[o * 3 + 1] = h; pos[o * 3 + 2] = z;
      const w = wAt(x, z, tmpW);
      w0[o * 4] = w[0]; w0[o * 4 + 1] = w[1]; w0[o * 4 + 2] = w[2]; w0[o * 4 + 3] = w[3];
      w1[o * 4] = w[4]; w1[o * 4 + 1] = w[5]; w1[o * 4 + 2] = w[6]; w1[o * 4 + 3] = w[7];
    }
    // normals from the vertex grid (plus one sample outside the chunk edge)
    const hAt = (i, j) => (i >= 0 && j >= 0 && i < vx && j < vx) ? pos[(j * vx + i) * 3 + 1] : world.heightAt(x0 + i * step, z0 + j * step);
    for (let j = 0; j < vx; j++) for (let i = 0; i < vx; i++) {
      const o = j * vx + i;
      let nx = hAt(i - 1, j) - hAt(i + 1, j), ny = 2 * step, nz = hAt(i, j - 1) - hAt(i, j + 1);
      const l = Math.hypot(nx, ny, nz); nor[o * 3] = nx / l; nor[o * 3 + 1] = ny / l; nor[o * 3 + 2] = nz / l;
    }
    const idx = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) { const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1; idx.push(a, c, b, b, c, d); }
    // skirts: a lowered copy of the border ring hides cracks between chunks of different detail
    const ring = [];
    for (let i = 0; i < vx; i++) ring.push(i);
    for (let j = 1; j < vx; j++) ring.push(j * vx + vx - 1);
    for (let i = vx - 2; i >= 0; i--) ring.push((vx - 1) * vx + i);
    for (let j = vx - 2; j > 0; j--) ring.push(j * vx);
    const base = vx * vx, extra = ring.length;
    const P2 = new Float32Array((base + extra) * 3), N2 = new Float32Array((base + extra) * 3), A2 = new Float32Array((base + extra) * 4), B2 = new Float32Array((base + extra) * 4);
    P2.set(pos); N2.set(nor); A2.set(w0); B2.set(w1);
    ring.forEach((v, k) => { const o = base + k; P2.set([pos[v * 3], pos[v * 3 + 1] - 5, pos[v * 3 + 2]], o * 3); N2.set(nor.subarray(v * 3, v * 3 + 3), o * 3); A2.set(w0.subarray(v * 4, v * 4 + 4), o * 4); B2.set(w1.subarray(v * 4, v * 4 + 4), o * 4); });
    for (let k = 0; k < extra; k++) { const a = ring[k], b = ring[(k + 1) % extra], c = base + k, d = base + (k + 1) % extra; idx.push(a, c, b, b, c, d, a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P2, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N2, 3));
    g.setAttribute('aW0', new THREE.BufferAttribute(A2, 4));
    g.setAttribute('aW1', new THREE.BufferAttribute(B2, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = false;
    return m;
  };
  for (let cj = 0; cj < N - 1; cj += CH) for (let ci = 0; ci < N - 1; ci += CH) {
    const lo = build(ci, cj, 8);
    group.add(lo);
    chunks.push({ ci, cj, cx: world.fromGrid(ci) + CH * world.cs / 2, cz: world.fromGrid(cj) + CH * world.cs / 2, lo, hi: null, hiBuilt: false });
  }
  scene.add(group);
  const T = { group, chunks, build, hiRange: 330 };

  // Ocean: a grid that follows the camera, with waves and depth colour from the heightmap
  game.waterMats = [];
  const depthTex = makeDepthTexture(world);
  const ocean = waterMaterial({ depthTex, worldSize: world.size, quality: gfx.water === 'full' ? 1 : 0.4 });
  game.waterMats.push(ocean);
  const og = new THREE.PlaneGeometry(2600, 2600, gfx.water === 'full' ? 220 : 80, gfx.water === 'full' ? 220 : 80); og.rotateX(-Math.PI / 2);
  const oceanMesh = new THREE.Mesh(og, ocean); oceanMesh.position.y = SEA_LEVEL; oceanMesh.renderOrder = 2; oceanMesh.frustumCulled = false;
  scene.add(oceanMesh);
  T.ocean = oceanMesh;
  // Far ocean beyond the wave grid
  const far = new THREE.Mesh(new THREE.PlaneGeometry(world.size * 6, world.size * 6).rotateX(-Math.PI / 2), waterMaterial({ depthTex: null, worldSize: world.size, quality: 0.2 }));
  far.material.uniforms.fresh.value = 0; game.waterMats.push(far.material); far.position.y = SEA_LEVEL - 0.3; far.renderOrder = 1; scene.add(far);

  // Rivers: ribbons with per-vertex depth
  const river = waterMaterial({ fresh: true, quality: 1 });
  river.uniforms.flow.value.set(0.4, 0.25);
  game.waterMats.push(river);
  for (const rv of world.rivers) {
    const pts = rv.pts, pos = [], dep = [], idx = [];
    const across = 5;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], pp = pts[Math.max(0, i - 1)];
      let dx = q.x - pp.x, dz = q.z - pp.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const w = p.w * 0.62, y = Math.max(p.s, SEA_LEVEL + 0.02);
      for (let a = 0; a < across; a++) {
        const t = a / (across - 1) * 2 - 1;
        const x = p.x - dz * w * t, z = p.z + dx * w * t;
        pos.push(x, y, z); dep.push(Math.max(0, y - world.heightAt(x, z)));
      }
      if (i > 0) for (let a = 0; a < across - 1; a++) { const b0 = (i - 1) * across + a, b1 = i * across + a; idx.push(b0, b1, b0 + 1, b0 + 1, b1, b1 + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, river); m.renderOrder = 3;
    scene.add(m);
  }

  // Road centre lines (paint)
  const lineMat = game.mats.get('paint', { color: 0xc9b25a });
  for (const road of world.roads) {
    const pts = road.pts, pos = [], idx = [], uv = [];
    let n = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const L = Math.hypot(q.x - p.x, q.z - p.z);
      const dx = (q.x - p.x) / L, dz = (q.z - p.z) / L;
      for (let d = 0; d < L - 3; d += 6) {
        const x0 = p.x + dx * d, z0 = p.z + dz * d, x1 = p.x + dx * (d + 3), z1 = p.z + dz * (d + 3);
        const y0 = world.heightAt(x0, z0) + 0.05, y1 = world.heightAt(x1, z1) + 0.05;
        const w = 0.12;
        pos.push(x0 - dz * w, y0, z0 + dx * w, x0 + dz * w, y0, z0 - dx * w, x1 - dz * w, y1, z1 + dx * w, x1 + dz * w, y1, z1 - dx * w);
        uv.push(0, 0, 1, 0, 0, 1, 1, 1);
        idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); n += 4;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, lineMat); m.receiveShadow = true;
    scene.add(m);
  }
  return T;
}

// Swap chunks between detailed and coarse meshes around the camera; builds detailed meshes lazily.
export function updateTerrainLOD(T, cam, budget = 1) {
  let built = 0;
  const order = T.chunks.map(c => [Math.hypot(c.cx - cam.x, c.cz - cam.z), c]).sort((a, b) => a[0] - b[0]);
  for (const [dd, c] of order) {
    const d = dd - 180;
    const wantHi = d < T.hiRange;
    if (wantHi && !c.hiBuilt && built < budget) { c.hi = T.build(c.ci, c.cj, 2); T.group.add(c.hi); c.hiBuilt = true; built++; }
    if (c.hi) c.hi.visible = wantHi;
    c.lo.visible = !(wantHi && c.hi);
  }
  // ocean grid follows the camera in 20 m steps
  T.ocean.position.x = Math.round(cam.x / 20) * 20; T.ocean.position.z = Math.round(cam.z / 20) * 20;
}

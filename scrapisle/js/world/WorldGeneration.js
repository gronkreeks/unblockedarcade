// Procedural island: heightmap, biomes, rivers, roads, monument sites and spawn lists.
// Pure data; deterministic from the seed so saves only store the seed and diffs.
import { Noise2D } from '../core/noise.js';
import { mulberry32, clamp, smoothstep, lerp, dist } from '../core/util.js';

export const BIOME = { OCEAN: 0, BEACH: 1, GRASS: 2, FOREST: 3, ROCK: 4, SNOW: 5, DESERT: 6 };
export const BIOME_NAMES = ['Ocean', 'Beach', 'Fields', 'Forest', 'Mountains', 'Snow', 'Desert'];
export const SEA_LEVEL = 0;

export const MONUMENT_TYPES = {
  launch_site: { name: 'Launch Site', r: 115, flat: true, inland: true, rad: 2, tier: 3 },
  airfield: { name: 'Airfield', r: 120, flat: true, inland: true, rad: 0, tier: 3 },
  train_yard: { name: 'Train Yard', r: 80, flat: true, inland: true, rad: 1, tier: 2 },
  harbour: { name: 'Harbour', r: 70, coastal: true, rad: 0, tier: 2 },
  mining_outpost: { name: 'Mining Outpost', r: 35, rocky: true, rad: 0, tier: 1 },
  lighthouse: { name: 'Lighthouse', r: 22, coastal: true, rad: 0, tier: 1 },
  supermarket: { name: 'Abandoned Supermarket', r: 28, flat: true, inland: true, rad: 0, tier: 1 },
  gas_station: { name: 'Gas Station', r: 28, flat: true, inland: true, rad: 0, tier: 1 },
  fuel_stop: { name: 'Roadside Fuel Stop', r: 28, flat: true, inland: true, rad: 0, tier: 1 },
};

export class World {
  constructor(seed, size = 2048) {
    this.seed = seed >>> 0;
    this.size = size;
    this.half = size / 2;
    this.cs = 4;                     // heightmap cell size (m)
    this.N = size / this.cs + 1;
    this.heights = new Float32Array(this.N * this.N);
    this.biome = new Uint8Array(this.N * this.N);
    this.water = new Float32Array(this.N * this.N).fill(-999); // river water surface height (fresh water)
    this.roadMask = new Uint8Array(this.N * this.N);
    this.rivers = [];
    this.roads = [];
    this.monuments = [];
    this.spawns = { trees: [], nodes: [], hemp: [], pickups: [], barrels: [], beaches: [] };
    this.generate();
  }

  idx(i, j) { return j * this.N + i; }
  toGrid(x) { return (x + this.half) / this.cs; }
  fromGrid(i) { return i * this.cs - this.half; }

  heightAt(x, z) {
    const gx = clamp(this.toGrid(x), 0, this.N - 1.001), gz = clamp(this.toGrid(z), 0, this.N - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const H = this.heights, N = this.N, k = j * N + i;
    const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }
  normalAt(x, z) {
    const e = 1.5;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z), hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    const nx = hl - hr, nz = hd - hu, ny = 2 * e;
    const l = Math.hypot(nx, ny, nz);
    return { x: nx / l, y: ny / l, z: nz / l };
  }
  slopeAt(x, z) { return 1 - this.normalAt(x, z).y; }
  biomeAt(x, z) {
    const i = clamp(Math.round(this.toGrid(x)), 0, this.N - 1), j = clamp(Math.round(this.toGrid(z)), 0, this.N - 1);
    return this.biome[j * this.N + i];
  }
  // Fresh-water surface height at a point, or -999.
  riverAt(x, z) {
    const i = clamp(Math.round(this.toGrid(x)), 0, this.N - 1), j = clamp(Math.round(this.toGrid(z)), 0, this.N - 1);
    return this.water[j * this.N + i];
  }
  // Water surface above ground here (ocean = sea level, river = river surface), or null.
  waterSurface(x, z) {
    const h = this.heightAt(x, z);
    const r = this.riverAt(x, z);
    if (r > h - 0.05 && r > -900) return { y: r, fresh: true };
    if (h < SEA_LEVEL) return { y: SEA_LEVEL, fresh: false };
    return null;
  }
  isRoad(x, z) {
    const i = clamp(Math.round(this.toGrid(x)), 0, this.N - 1), j = clamp(Math.round(this.toGrid(z)), 0, this.N - 1);
    return this.roadMask[j * this.N + i] > 0;
  }
  inBounds(x, z, pad = 0) { return Math.abs(x) < this.half - pad && Math.abs(z) < this.half - pad; }
  monumentAt(x, z, pad = 0) {
    for (const m of this.monuments) if (dist(x, z, m.x, m.z) < m.r + pad) return m;
    return null;
  }
  // Temperature in °C before weather/time modifiers.
  baseTemperature(x, z) {
    const b = this.biomeAt(x, z), h = this.heightAt(x, z);
    let t = 20;
    if (b === BIOME.SNOW) t = -6; else if (b === BIOME.DESERT) t = 32; else if (b === BIOME.ROCK) t = 12; else if (b === BIOME.FOREST) t = 17;
    return t - Math.max(0, h - 40) * 0.15;
  }

  generate() {
    const rng = mulberry32(this.seed);
    const n1 = new Noise2D(this.seed ^ 0x1234), n2 = new Noise2D(this.seed ^ 0x5678), n3 = new Noise2D(this.seed ^ 0x9abc), n4 = new Noise2D(this.seed ^ 0xdef0);
    const N = this.N, H = this.heights, half = this.half;
    this.temp = new Float32Array(N * N);
    this.forest = new Float32Array(N * N);
    // 1. Base island shape + mountains + cliffs
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = this.fromGrid(i), z = this.fromGrid(j);
      const nx = x / half, nz = z / half;
      const warp = n1.fbm(nx * 1.6 + 7, nz * 1.6 - 3, 4) * 0.22;
      const d = Math.sqrt(nx * nx + nz * nz) + warp;
      const land = 1 - smoothstep(0.74, 1.0, d);
      let h = -14 + land * 26;                                    // coast to plateau ~12m
      h += n2.fbm(nx * 4, nz * 4, 5) * 7 * land;                   // rolling hills
      const mMask = smoothstep(0.0, 0.38, n3.fbm(nx * 1.8 + 11, nz * 1.8 + 5, 3)) * smoothstep(0.85, 0.45, d);
      h += n3.ridged(nx * 3.2, nz * 3.2, 5) * 95 * mMask;           // mountain ranges
      // coastal cliffs: steepen the land edge where cliff noise is high
      const cliffN = n4.fbm(nx * 3 + 2, nz * 3 - 9, 3);
      if (cliffN > 0.15 && land > 0.05 && land < 0.95) h += smoothstep(0.15, 0.45, cliffN) * smoothstep(0.05, 0.35, land) * 16;
      H[j * N + i] = h;
      // temperature: north (-z) cold, south-east hot
      this.temp[j * N + i] = clamp(0.5 + nz * 0.42 + nx * 0.12 + n4.fbm(nx * 2.5, nz * 2.5, 3) * 0.25, 0, 1);
      this.forest[j * N + i] = n1.fbm(nx * 6 + 40, nz * 6 + 40, 4);
    }
    // terraced cliff bands inland
    for (let k = 0; k < N * N; k++) {
      const h = H[k];
      if (h > 22) { const t = 9; const q = Math.floor(h / t) * t; const f = (h - q) / t; H[k] = q + t * smoothstep(0.35, 0.65, f) * 0.85 + f * t * 0.15; }
    }
    this._smooth(1);

    // 2. Monuments (before rivers/roads so they get flat pads)
    this._placeMonuments(rng);
    // 3. Rivers
    this._makeRivers(rng);
    // 4. Roads between monuments
    this._makeRoads(rng);
    // 5. Biomes
    this._assignBiomes();
    // 6. Spawns
    this._spawnLists(rng);
  }

  _smooth(passes) {
    const N = this.N, H = this.heights, tmp = new Float32Array(N * N);
    for (let p = 0; p < passes; p++) {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        let s = 0, c = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= N || b >= N) continue;
          s += H[b * N + a]; c++;
        }
        tmp[j * N + i] = s / c;
      }
      H.set(tmp);
    }
  }

  _forArea(x, z, r, fn) {
    const i0 = Math.max(0, Math.floor(this.toGrid(x - r))), i1 = Math.min(this.N - 1, Math.ceil(this.toGrid(x + r)));
    const j0 = Math.max(0, Math.floor(this.toGrid(z - r))), j1 = Math.min(this.N - 1, Math.ceil(this.toGrid(z + r)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i, j, this.fromGrid(i), this.fromGrid(j), j * this.N + i);
  }

  _placeMonuments(rng) {
    const order = ['launch_site', 'airfield', 'train_yard', 'harbour', 'mining_outpost', 'lighthouse', 'supermarket', 'gas_station', 'fuel_stop', 'supermarket', 'lighthouse', 'mining_outpost'];
    if (this.size < 2000) order.splice(9);
    const half = this.half;
    for (const type of order) {
      const T = MONUMENT_TYPES[type];
      let best = null, bestScore = -Infinity;
      for (let t = 0; t < 260; t++) {
        const x = (rng() * 2 - 1) * (half - T.r - 40), z = (rng() * 2 - 1) * (half - T.r - 40);
        const h = this.heightAt(x, z);
        if (this.monuments.some(m => dist(x, z, m.x, m.z) < m.r + T.r + 60)) continue;
        let score = 0;
        if (T.coastal) {
          if (h < 1 || h > 9) continue;
          // must have deep water within ~T.r
          let water = 0;
          for (let a = 0; a < 8; a++) { const ang = a / 8 * Math.PI * 2; if (this.heightAt(x + Math.cos(ang) * T.r * 0.9, z + Math.sin(ang) * T.r * 0.9) < -2) water++; }
          if (water < 1 || water > 5) continue;
          score = 10 - Math.abs(h - 4);
        } else {
          if (h < 4) continue;
          let mn = Infinity, mx = -Infinity, wet = 0;
          for (let a = 0; a < 12; a++) for (const rr of [0.4, 0.8, 1.0]) {
            const ang = a / 12 * Math.PI * 2; const hh = this.heightAt(x + Math.cos(ang) * T.r * rr, z + Math.sin(ang) * T.r * rr);
            mn = Math.min(mn, hh); mx = Math.max(mx, hh); if (hh < 1) wet++;
          }
          if (wet > 0) continue;
          if (T.rocky) { if (h < 20) continue; score = h * 0.2 - (mx - mn) * 0.3; }
          else score = -(mx - mn) - Math.abs(h - 12) * 0.2;
        }
        if (score > bestScore) { bestScore = score; best = { x, z }; }
      }
      if (!best) continue;
      const pad = T.coastal ? clamp(this.heightAt(best.x, best.z), 2.5, 5) : this._padHeight(best.x, best.z, T.r);
      const rot = Math.floor(rng() * 4) * Math.PI / 2;
      const m = { id: 'm' + this.monuments.length, type, name: T.name, x: best.x, z: best.z, y: pad, r: T.r, rot, rad: T.rad, tier: T.tier };
      if (T.coastal) {
        // face the sea: rotate so local +z points to the lowest direction
        let low = Infinity, la = 0;
        for (let a = 0; a < 16; a++) { const ang = a / 16 * Math.PI * 2; const hh = this.heightAt(best.x + Math.sin(ang) * T.r, best.z + Math.cos(ang) * T.r); if (hh < low) { low = hh; la = ang; } }
        m.rot = la;
      }
      this.monuments.push(m);
      this._flatten(m.x, m.z, T.coastal ? T.r * 0.75 : T.r, pad, T.coastal ? 10 : 30);
    }
  }
  _padHeight(x, z, r) {
    let s = 0, c = 0;
    this._forArea(x, z, r, (i, j, px, pz, k) => { if (dist(px, pz, x, z) <= r) { s += this.heights[k]; c++; } });
    return Math.max(4, s / Math.max(1, c));
  }
  _flatten(x, z, r, h, blend) {
    this._forArea(x, z, r + blend, (i, j, px, pz, k) => {
      const d = dist(px, pz, x, z);
      const t = 1 - smoothstep(r, r + blend, d);
      if (t > 0) this.heights[k] = lerp(this.heights[k], h, t);
    });
  }

  _makeRivers(rng) {
    const count = Math.round(this.size / 512) + 1;
    const half = this.half;
    for (let r = 0; r < count; r++) {
      // pick a high, inland start that is not inside a monument
      let start = null;
      for (let t = 0; t < 200; t++) {
        const x = (rng() * 2 - 1) * half * 0.5, z = (rng() * 2 - 1) * half * 0.5;
        const h = this.heightAt(x, z);
        if (h > 18 && h < 60 && !this.monumentAt(x, z, 30) && !this.rivers.some(rv => dist(rv.pts[0].x, rv.pts[0].z, x, z) < 300)) { start = { x, z }; break; }
      }
      if (!start) continue;
      const pts = [];
      let x = start.x, z = start.z;
      let dirx = x, dirz = z; const l0 = Math.hypot(dirx, dirz) || 1; dirx /= l0; dirz /= l0;
      let surface = this.heightAt(x, z) - 1;
      for (let s = 0; s < 400; s++) {
        const h = this.heightAt(x, z);
        surface = Math.min(surface, h - 0.6);
        pts.push({ x, z, s: surface, w: 7 + Math.min(10, s * 0.06) });
        if (h < -1.5) break;
        // gradient
        const e = 6;
        const gx = this.heightAt(x + e, z) - this.heightAt(x - e, z), gz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
        const ox = x, oz = z; const ol = Math.hypot(ox, oz) || 1;
        let ndx = dirx * 0.6 + (ox / ol) * 0.35 - gx * 0.08 + (rng() - 0.5) * 0.35;
        let ndz = dirz * 0.6 + (oz / ol) * 0.35 - gz * 0.08 + (rng() - 0.5) * 0.35;
        const nl = Math.hypot(ndx, ndz) || 1; dirx = ndx / nl; dirz = ndz / nl;
        // avoid monuments by steering
        const m = this.monumentAt(x + dirx * 30, z + dirz * 30, 15);
        if (m) { const ax = x - m.x, az = z - m.z, al = Math.hypot(ax, az) || 1; dirx = dirx * 0.3 + (-az / al) * 0.7; dirz = dirz * 0.3 + (ax / al) * 0.7; const ll = Math.hypot(dirx, dirz); dirx /= ll; dirz /= ll; }
        x += dirx * 10; z += dirz * 10;
        if (!this.inBounds(x, z, 10)) break;
      }
      if (pts.length < 20) continue;
      // carve
      for (let p = 0; p < pts.length; p++) {
        const P = pts[p];
        const w = P.w;
        this._forArea(P.x, P.z, w + 8, (i, j, px, pz, k) => {
          const d = dist(px, pz, P.x, P.z);
          if (d > w + 8) return;
          const bed = P.s - 1.6 * (1 - smoothstep(0, w * 0.5, d)) - 0.3;
          const bank = P.s + smoothstep(w * 0.5, w + 8, d) * 4;
          const target = d < w * 0.5 ? bed : Math.min(this.heights[k], bank);
          if (target < this.heights[k]) this.heights[k] = target;
          if (d < w * 0.55 && P.s > SEA_LEVEL - 0.5) this.water[k] = Math.max(this.water[k], P.s);
        });
      }
      this.rivers.push({ pts });
    }
  }

  _makeRoads(rng) {
    const ms = this.monuments.filter(m => m.type !== 'lighthouse');
    if (ms.length < 2) return;
    // minimum spanning tree + one extra loop edge
    const edges = [];
    const inTree = new Set([0]);
    while (inTree.size < ms.length) {
      let best = null, bd = Infinity;
      for (const a of inTree) for (let b = 0; b < ms.length; b++) {
        if (inTree.has(b)) continue;
        const d = dist(ms[a].x, ms[a].z, ms[b].x, ms[b].z);
        if (d < bd) { bd = d; best = [a, b]; }
      }
      inTree.add(best[1]); edges.push(best);
    }
    if (ms.length > 4) edges.push([0, ms.length - 1]);
    for (const [a, b] of edges) {
      const A = ms[a], B = ms[b];
      const pts = this._roadPath(A, B, rng);
      if (pts) this.roads.push({ pts });
    }
    // flatten + mark
    for (const road of this.roads) {
      const pts = road.pts;
      // smooth heights along the road
      const hs = pts.map(p => Math.max(1.2, this.heightAt(p.x, p.z)));
      for (let pass = 0; pass < 6; pass++) for (let i = 1; i < hs.length - 1; i++) hs[i] = (hs[i - 1] + hs[i] * 2 + hs[i + 1]) / 4;
      pts.forEach((p, i) => p.y = hs[i]);
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const len = dist(p.x, p.z, q.x, q.z);
        const steps = Math.ceil(len / 2);
        for (let s = 0; s <= steps; s++) {
          const t = s / steps, x = lerp(p.x, q.x, t), z = lerp(p.z, q.z, t), y = lerp(p.y, q.y, t);
          this._forArea(x, z, 12, (ii, jj, px, pz, k) => {
            const d = dist(px, pz, x, z);
            if (this.monumentAt(px, pz, -5)) return;
            const f = 1 - smoothstep(4.5, 12, d);
            if (f > 0) this.heights[k] = lerp(this.heights[k], y, f);
            if (d < 4.5) this.roadMask[k] = 1;
          });
        }
      }
    }
  }
  _roadPath(A, B, rng) {
    // start/end at the edge of each monument, wiggle the middle, reject paths across the sea
    const ang = Math.atan2(B.z - A.z, B.x - A.x);
    const sx = A.x + Math.cos(ang) * (A.r * 0.8), sz = A.z + Math.sin(ang) * (A.r * 0.8);
    const ex = B.x - Math.cos(ang) * (B.r * 0.8), ez = B.z - Math.sin(ang) * (B.r * 0.8);
    const L = dist(sx, sz, ex, ez);
    const steps = Math.max(2, Math.ceil(L / 40));
    const pts = [];
    const nx = -Math.sin(ang), nz = Math.cos(ang);
    const off1 = (rng() - 0.5) * L * 0.25;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const bend = Math.sin(t * Math.PI) * off1;
      let x = lerp(sx, ex, t) + nx * bend, z = lerp(sz, ez, t) + nz * bend;
      // push away from water by sampling sideways
      for (let k = 0; k < 6 && this.heightAt(x, z) < 1.5; k++) { const ox = x, oz = z; const l = Math.hypot(ox, oz) || 1; x -= ox / l * 20; z -= oz / l * 20; }
      if (this.heightAt(x, z) < 0.5) return null;
      pts.push({ x, z });
    }
    return pts;
  }

  _assignBiomes() {
    const N = this.N, H = this.heights, B = this.biome;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, h = H[k], x = this.fromGrid(i), z = this.fromGrid(j);
      if (h < SEA_LEVEL - 0.2) { B[k] = BIOME.OCEAN; continue; }
      const t = this.temp[k];
      const slope = (i > 0 && j > 0 && i < N - 1 && j < N - 1) ? Math.max(Math.abs(H[k + 1] - H[k - 1]), Math.abs(H[k + N] - H[k - N])) / (2 * this.cs) : 0;
      if (h < 2.6 && slope < 0.35) B[k] = BIOME.BEACH;
      else if (t < 0.25 || (t < 0.38 && h > 30)) B[k] = BIOME.SNOW;
      else if (h > 48 || slope > 0.9) B[k] = BIOME.ROCK;
      else if (t > 0.78) B[k] = BIOME.DESERT;
      else if (this.forest[k] > 0.08) B[k] = BIOME.FOREST;
      else B[k] = BIOME.GRASS;
    }
  }

  _okSpawn(x, z, clear = 6) {
    if (!this.inBounds(x, z, 20)) return false;
    const h = this.heightAt(x, z);
    if (h < 0.8) return false;
    if (this.riverAt(x, z) > h - 1) return false;
    if (this.isRoad(x, z) || this.isRoad(x + clear, z) || this.isRoad(x - clear, z)) return false;
    if (this.monumentAt(x, z, 8)) return false;
    return true;
  }

  _spawnLists(rng) {
    const S = this.spawns, half = this.half;
    const area = (this.size / 2048) ** 2;
    // Trees
    const treeTries = Math.round(42000 * area);
    for (let t = 0; t < treeTries; t++) {
      const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
      if (!this._okSpawn(x, z, 4)) continue;
      const b = this.biomeAt(x, z), sl = this.slopeAt(x, z);
      if (sl > 0.35) continue;
      const dens = { [BIOME.FOREST]: 0.55, [BIOME.GRASS]: 0.04, [BIOME.SNOW]: 0.2, [BIOME.DESERT]: 0.015, [BIOME.ROCK]: 0.03, [BIOME.BEACH]: 0.01 }[b] || 0;
      if (rng() > dens) continue;
      const kind = b === BIOME.SNOW ? 'pine_snow' : b === BIOME.DESERT ? 'cactus' : b === BIOME.BEACH ? 'palm' : (b === BIOME.FOREST && rng() < 0.55) ? 'pine' : 'oak';
      S.trees.push({ x, z, kind, s: 0.8 + rng() * 0.5, r: rng() * Math.PI * 2 });
    }
    // Ore nodes
    const nodeTries = Math.round(15000 * area);
    for (let t = 0; t < nodeTries; t++) {
      const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
      if (!this._okSpawn(x, z, 4)) continue;
      const b = this.biomeAt(x, z), h = this.heightAt(x, z);
      const dens = { [BIOME.ROCK]: 0.5, [BIOME.SNOW]: 0.28, [BIOME.DESERT]: 0.22, [BIOME.FOREST]: 0.05, [BIOME.GRASS]: 0.06, [BIOME.BEACH]: 0.04 }[b] || 0;
      if (rng() > dens * (h > 30 ? 1.4 : 1)) continue;
      let w;
      if (b === BIOME.SNOW) w = [['stone', 3], ['metal', 5], ['sulfur', 2]];
      else if (b === BIOME.DESERT) w = [['stone', 3], ['metal', 2], ['sulfur', 5]];
      else if (b === BIOME.ROCK) w = [['stone', 4], ['metal', 3], ['sulfur', 3]];
      else w = [['stone', 6], ['metal', 2.5], ['sulfur', 1.5]];
      let tot = w.reduce((a, e) => a + e[1], 0), rr = rng() * tot, kind = 'stone';
      for (const e of w) { rr -= e[1]; if (rr <= 0) { kind = e[0]; break; } }
      S.nodes.push({ x, z, kind, r: rng() * Math.PI * 2 });
    }
    // Hemp
    for (let t = 0; t < 2400 * area; t++) {
      const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
      if (!this._okSpawn(x, z, 2)) continue;
      const b = this.biomeAt(x, z);
      if ((b === BIOME.GRASS && rng() < 0.4) || (b === BIOME.FOREST && rng() < 0.25)) S.hemp.push({ x, z });
    }
    // Pickups: loose stones, wood piles, mushrooms, berries, metal and sulfur chunks
    for (let t = 0; t < 5000 * area; t++) {
      const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
      if (!this._okSpawn(x, z, 2)) continue;
      const b = this.biomeAt(x, z);
      let kind = null;
      const q = rng();
      if (b === BIOME.FOREST) kind = q < 0.35 ? 'mushroom' : q < 0.6 ? 'wood_pile' : q < 0.8 ? 'berries' : 'stone_pile';
      else if (b === BIOME.GRASS) kind = q < 0.25 ? 'berries' : q < 0.5 ? 'wood_pile' : q < 0.7 ? 'stone_pile' : null;
      else if (b === BIOME.ROCK || b === BIOME.SNOW) kind = q < 0.4 ? 'stone_pile' : q < 0.65 ? 'metal_pile' : q < 0.8 ? 'sulfur_pile' : null;
      else if (b === BIOME.DESERT) kind = q < 0.4 ? 'sulfur_pile' : q < 0.6 ? 'stone_pile' : null;
      else if (b === BIOME.BEACH) kind = q < 0.3 ? 'wood_pile' : q < 0.45 ? 'stone_pile' : null;
      if (kind) S.pickups.push({ x, z, kind });
    }
    // Roadside barrels
    for (const road of this.roads) {
      for (let i = 1; i < road.pts.length; i++) {
        const p = road.pts[i - 1], q = road.pts[i];
        const len = dist(p.x, p.z, q.x, q.z);
        for (let d = 0; d < len; d += 15) {
          if (rng() > 0.55) continue;
          const t = d / len, x = lerp(p.x, q.x, t), z = lerp(p.z, q.z, t);
          const ang = Math.atan2(q.z - p.z, q.x - p.x) + Math.PI / 2;
          const side = rng() < 0.5 ? 1 : -1;
          const bx = x + Math.cos(ang) * 6.5 * side, bz = z + Math.sin(ang) * 6.5 * side;
          if (this.monumentAt(bx, bz, 5)) continue;
          S.barrels.push({ x: bx, z: bz, kind: rng() < 0.18 ? 'crate' : 'barrel' });
          if (rng() < 0.4) S.barrels.push({ x: bx + (rng() - 0.5) * 2.5, z: bz + (rng() - 0.5) * 2.5, kind: 'barrel' });
        }
      }
    }
    // Beach spawn points (for fresh spawns)
    for (let t = 0; t < 4000 && S.beaches.length < 160; t++) {
      const ang = rng() * Math.PI * 2;
      for (let r = half * 0.95; r > half * 0.3; r -= 8) {
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const h = this.heightAt(x, z);
        if (h > 0.6) { if (h < 4 && !this.monumentAt(x, z, 20) && this.slopeAt(x, z) < 0.2) S.beaches.push({ x, z }); break; }
      }
    }
  }
}

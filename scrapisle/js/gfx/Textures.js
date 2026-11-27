// Procedural PBR textures generated at load time: albedo, normal and packed AO/roughness/metalness maps.
// Every pattern is tileable (periodic noise) so it can repeat across large surfaces.
import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';

// ---------- tileable noise ----------
const PERM = new Uint8Array(512);
{ const r = mulberry32(1337); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
const fade = t => t * t * (3 - 2 * t);
function hashv(x, y, s) { return PERM[(PERM[(x + s * 31) & 255] + y) & 255] / 255; }
// value noise, periodic with period P (integer cells)
function vnoise(x, y, P, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
  const u = fade(xf), v = fade(yf);
  const a = hashv(x0, y0, s), b = hashv(x1, y0, s), c = hashv(x0, y1, s), d = hashv(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// fbm over [0,1) uv, base period P
export function fbm(u, v, P, oct = 4, s = 0) {
  let a = 0.5, f = 1, t = 0, n = 0;
  for (let o = 0; o < oct; o++) { t += a * vnoise(u * P * f, v * P * f, P * f, s + o * 7); n += a; a *= 0.5; f *= 2; }
  return t / n;
}
function ridge(u, v, P, oct = 4, s = 0) {
  let a = 0.5, f = 1, t = 0, n = 0;
  for (let o = 0; o < oct; o++) { t += a * (1 - Math.abs(vnoise(u * P * f, v * P * f, P * f, s + o * 13) * 2 - 1)); n += a; a *= 0.5; f *= 2; }
  return t / n;
}
// cellular (worley) distance, periodic
function cell(u, v, P, s = 0) {
  const x = u * P, y = v * P, xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const px = ((cx % P) + P) % P, py = ((cy % P) + P) % P;
    const fx = cx + hashv(px, py, s), fy = cy + hashv(px, py, s + 5);
    const d = Math.hypot(fx - x, fy - y);
    if (d < d1) { d2 = d1; d1 = d; id = hashv(px, py, s + 9); } else if (d < d2) d2 = d;
  }
  return { d1, d2, id };
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------- material pixel programs: (u,v,o) => fills o.{r,g,b,h,rough,metal,ao,a} ----------
const P = {
  wood(u, v, o) {
    const plank = Math.floor(v * 4), pv = v * 4 - plank;
    const off = hashv(plank, 3, 1);
    const grain = fbm(u * 0.25 + off, pv * 0.25 + plank * 0.37, 8, 3, 2);
    const lines = 0.5 + 0.5 * Math.sin((u * 6 + grain * 6 + off * 20) * Math.PI * 2 + pv * 3);
    const knot = Math.max(0, 1 - Math.hypot((u + off) % 1 - 0.5, (pv - 0.5) * 0.6) * 9);
    const gap = sstep(0.0, 0.04, pv) * sstep(1.0, 0.96, pv);
    const endSeam = sstep(0, 0.008, Math.abs(((u + off * 3) % 0.5) - 0.25)) ;
    const tone = 0.75 + off * 0.35;
    const k = (0.55 + lines * 0.25 - knot * 0.35) * tone * (0.45 + 0.55 * gap) * (0.7 + 0.3 * endSeam);
    o.r = 0.52 * k + 0.05; o.g = 0.36 * k + 0.03; o.b = 0.21 * k + 0.02;
    o.h = gap * (0.6 + lines * 0.2) - knot * 0.2; o.rough = 0.72 + (1 - lines) * 0.15; o.metal = 0; o.ao = 0.55 + 0.45 * gap;
  },
  twig(u, v, o) {
    const s = Math.abs(Math.sin(u * Math.PI * 7 + fbm(u, v, 4, 2) * 3));
    const n = fbm(u, v, 16, 3);
    o.r = 0.55 * (0.6 + n * 0.5); o.g = 0.42 * (0.6 + n * 0.5); o.b = 0.25 * (0.6 + n * 0.5);
    o.h = s * 0.7 + n * 0.3; o.rough = 0.85; o.metal = 0; o.ao = 0.6 + s * 0.4;
  },
  bark(u, v, o) {
    const r = ridge(u * 3, v * 0.6, 6, 4, 4);
    const n = fbm(u, v, 12, 3, 9);
    const k = 0.35 + r * 0.5 + n * 0.15;
    o.r = 0.34 * k; o.g = 0.26 * k; o.b = 0.19 * k;
    o.h = r; o.rough = 0.92; o.metal = 0; o.ao = 0.5 + r * 0.5;
  },
  stone(u, v, o) {
    const row = Math.floor(v * 4), rv = v * 4 - row;
    const off = row % 2 ? 0.25 : 0;
    const bu = (u * 2 + off) % 1, col = Math.floor((u * 2 + off) % 2);
    const id = hashv(row, col + 4, 3);
    const mortar = sstep(0, 0.05, rv) * sstep(1, 0.95, rv) * sstep(0, 0.03, bu) * sstep(1, 0.97, bu);
    const n = fbm(u, v, 16, 4, id * 50 | 0);
    const crack = sstep(0.06, 0.0, Math.abs(ridge(u, v, 6, 3, 21) - 0.75));
    const tone = 0.55 + id * 0.25 + n * 0.25;
    o.r = (0.56 * tone) * (0.5 + 0.5 * mortar); o.g = (0.55 * tone) * (0.5 + 0.5 * mortar); o.b = (0.52 * tone) * (0.5 + 0.5 * mortar);
    o.r -= crack * 0.12; o.g -= crack * 0.12; o.b -= crack * 0.12;
    o.h = mortar * (0.7 + n * 0.3) - crack * 0.3; o.rough = 0.88; o.metal = 0; o.ao = 0.45 + 0.55 * mortar;
  },
  rock(u, v, o) {
    const n = fbm(u, v, 6, 5, 3), r = ridge(u, v, 4, 4, 11);
    const crack = sstep(0.08, 0.0, Math.abs(r - 0.8));
    const k = 0.45 + n * 0.45;
    o.r = 0.5 * k + 0.04; o.g = 0.48 * k + 0.03; o.b = 0.44 * k + 0.03;
    o.r -= crack * 0.15; o.g -= crack * 0.15; o.b -= crack * 0.15;
    o.h = n * 0.7 + r * 0.3 - crack * 0.4; o.rough = 0.86; o.metal = 0; o.ao = 0.55 + n * 0.45;
  },
  concrete(u, v, o) {
    const n = fbm(u, v, 24, 4, 5), stain = fbm(u, v, 3, 3, 17), pit = vnoise(u * 96, v * 96, 96, 3);
    const pits = pit > 0.86 ? 1 : 0;
    const k = 0.62 + n * 0.15 - sstep(0.55, 0.8, stain) * 0.15 - pits * 0.2;
    o.r = 0.58 * k + 0.08; o.g = 0.57 * k + 0.08; o.b = 0.54 * k + 0.08;
    o.h = n * 0.5 - pits * 0.5; o.rough = 0.92; o.metal = 0; o.ao = 0.7 + n * 0.3 - pits * 0.3;
  },
  asphalt(u, v, o) {
    const n = fbm(u, v, 32, 3, 8), spk = vnoise(u * 128, v * 128, 128, 1);
    const crack = sstep(0.05, 0.0, Math.abs(ridge(u, v, 4, 3, 2) - 0.85));
    const k = 0.18 + n * 0.08 + (spk > 0.8 ? 0.1 : 0) - crack * 0.08;
    o.r = k; o.g = k; o.b = k * 1.03; o.h = n * 0.4 + (spk > 0.8 ? 0.3 : 0) - crack * 0.5; o.rough = 0.95; o.metal = 0; o.ao = 0.8 + n * 0.2;
  },
  metal(u, v, o) {
    const brushed = fbm(u * 0.1, v * 4, 32, 3, 6) * 0.15;
    const scratch = sstep(0.985, 1, vnoise(u * 64 + v * 7, v * 3, 64, 4));
    const wear = fbm(u, v, 8, 4, 31);
    const k = 0.55 + brushed + scratch * 0.3;
    o.r = k * 0.62; o.g = k * 0.64; o.b = k * 0.67; o.h = brushed - scratch * 0.3; o.rough = 0.42 + wear * 0.25 - scratch * 0.2; o.metal = 0.9; o.ao = 0.9;
  },
  corrugated(u, v, o) {
    const w = Math.sin(u * Math.PI * 16);
    const rust = sstep(0.55, 0.75, fbm(u, v, 6, 4, 12) + (1 - v) * 0.15);
    const streak = fbm(u * 6, v * 0.5, 8, 2, 40) * sstep(0.3, 1, v);
    const base = 0.62 + w * 0.05;
    o.r = mix(base * 0.66, 0.45, rust) - streak * 0.08; o.g = mix(base * 0.68, 0.24, rust) - streak * 0.08; o.b = mix(base * 0.7, 0.13, rust) - streak * 0.08;
    o.h = w * 0.5 + 0.5; o.rough = mix(0.45, 0.85, rust); o.metal = mix(0.75, 0.2, rust); o.ao = 0.75 + 0.25 * (w * 0.5 + 0.5);
  },
  armored(u, v, o) {
    const pu = (u * 2) % 1, pv = (v * 2) % 1;
    const seam = sstep(0, 0.03, pu) * sstep(1, 0.97, pu) * sstep(0, 0.03, pv) * sstep(1, 0.97, pv);
    let rivet = 0;
    for (const [a, b] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92], [0.5, 0.08], [0.5, 0.92]]) rivet = Math.max(rivet, 1 - Math.hypot(pu - a, pv - b) * 30);
    const n = fbm(u, v, 16, 3, 9), wear = sstep(0.7, 0.9, fbm(u, v, 8, 4, 44));
    const k = 0.3 + n * 0.1 + wear * 0.25 + rivet * 0.2;
    o.r = k * 0.9; o.g = k * 0.93; o.b = k; o.h = seam * 0.6 + rivet * 0.6 + n * 0.1; o.rough = 0.5 - wear * 0.15; o.metal = 0.85; o.ao = 0.4 + 0.6 * seam;
  },
  rust(u, v, o) {
    const n = fbm(u, v, 8, 5, 22), p = fbm(u, v, 24, 3, 3);
    const k = 0.5 + n * 0.4;
    o.r = 0.48 * k + p * 0.08; o.g = 0.27 * k + p * 0.04; o.b = 0.14 * k;
    o.h = n * 0.6 + p * 0.4; o.rough = 0.85; o.metal = 0.25; o.ao = 0.6 + n * 0.4;
  },
  paint(u, v, o) {
    // light base meant to be tinted by vertex colour; chips show bare metal
    const chip = sstep(0.68, 0.72, fbm(u, v, 10, 5, 66));
    const dirt = fbm(u, v, 4, 3, 14) * 0.15 + (1 - v) * 0.05;
    const k = 0.92 - dirt;
    o.r = mix(k, 0.45, chip); o.g = mix(k, 0.42, chip); o.b = mix(k, 0.4, chip);
    o.h = 1 - chip * 0.4; o.rough = mix(0.65, 0.45, chip); o.metal = mix(0.05, 0.85, chip); o.ao = 0.9;
  },
  gunmetal(u, v, o) {
    const n = fbm(u, v, 48, 3, 4), wear = sstep(0.75, 0.95, fbm(u, v, 12, 4, 50));
    const k = 0.16 + n * 0.05 + wear * 0.35;
    o.r = k; o.g = k * 1.02; o.b = k * 1.06; o.h = n * 0.3; o.rough = 0.38 + n * 0.15 - wear * 0.1; o.metal = 0.9; o.ao = 1;
  },
  polymer(u, v, o) {
    const st = vnoise(u * 160, v * 160, 160, 5);
    const k = 0.09 + st * 0.03;
    o.r = k; o.g = k; o.b = k * 1.05; o.h = st * 0.4; o.rough = 0.7; o.metal = 0; o.ao = 1;
  },
  gunwood(u, v, o) {
    const g = fbm(u * 0.15, v * 2, 16, 3, 7);
    const l = 0.5 + 0.5 * Math.sin((v * 20 + g * 8) * Math.PI);
    const k = 0.5 + l * 0.25;
    o.r = 0.5 * k; o.g = 0.27 * k; o.b = 0.14 * k; o.h = l * 0.3; o.rough = 0.55; o.metal = 0; o.ao = 1;
  },
  cloth(u, v, o) {
    const w = (Math.sin(u * Math.PI * 128) * Math.sin(v * Math.PI * 128)) * 0.5 + 0.5;
    const n = fbm(u, v, 8, 3, 2), dirt = fbm(u, v, 3, 3, 77) * 0.25;
    const k = 0.78 + w * 0.12 + n * 0.1 - dirt;
    o.r = k; o.g = k; o.b = k; o.h = w * 0.6 + n * 0.2; o.rough = 0.95; o.metal = 0; o.ao = 0.85 + w * 0.15;
  },
  leather(u, v, o) {
    const c = cell(u, v, 24, 8), n = fbm(u, v, 8, 3, 1);
    const k = 0.6 + n * 0.25 - sstep(0.06, 0, c.d2 - c.d1) * 0.2;
    o.r = 0.52 * k; o.g = 0.33 * k; o.b = 0.2 * k; o.h = (c.d2 - c.d1) * 0.8; o.rough = 0.75; o.metal = 0; o.ao = 0.9;
  },
  grass(u, v, o) {
    const n = fbm(u, v, 8, 5, 2), b = fbm(u, v, 48, 2, 7), dirt = sstep(0.62, 0.8, fbm(u, v, 4, 4, 33));
    o.r = mix(0.24 + n * 0.12 + b * 0.05, 0.36, dirt); o.g = mix(0.36 + n * 0.16 + b * 0.08, 0.28, dirt); o.b = mix(0.12 + n * 0.05, 0.17, dirt);
    o.h = b * 0.6 + n * 0.4; o.rough = 0.95; o.metal = 0; o.ao = 0.75 + b * 0.25;
  },
  forest(u, v, o) {
    const n = fbm(u, v, 8, 4, 12), c = cell(u, v, 20, 3);
    const leaf = sstep(0.16, 0.08, c.d1) * 0.22;
    const hue = c.id, moss = sstep(0.45, 0.7, fbm(u, v, 4, 3, 21));
    o.r = mix(mix(0.24 + n * 0.08, 0.2, moss), 0.34 + hue * 0.1, leaf); o.g = mix(mix(0.2 + n * 0.08, 0.27, moss), 0.25 + hue * 0.06, leaf); o.b = mix(0.11, 0.1, leaf);
    o.h = n * 0.5 + leaf * 0.5; o.rough = 0.92; o.metal = 0; o.ao = 0.6 + n * 0.4;
  },
  sand(u, v, o) {
    const rip = Math.sin((v * 24 + fbm(u, v, 4, 3, 4) * 6) * Math.PI) * 0.5 + 0.5;
    const n = fbm(u, v, 32, 3, 9), g = vnoise(u * 200, v * 200, 200, 2);
    const k = 0.78 + n * 0.12 + g * 0.06;
    o.r = 0.82 * k; o.g = 0.73 * k; o.b = 0.55 * k; o.h = rip * 0.4 + g * 0.3; o.rough = 0.93; o.metal = 0; o.ao = 0.9;
  },
  dirt(u, v, o) {
    const n = fbm(u, v, 8, 5, 6), c = cell(u, v, 16, 4);
    const pebble = sstep(0.32, 0.22, c.d1) * (c.id > 0.5 ? 1 : 0);
    const k = 0.45 + n * 0.25 + pebble * 0.2;
    o.r = 0.42 * k + pebble * 0.08; o.g = 0.32 * k + pebble * 0.08; o.b = 0.22 * k + pebble * 0.08;
    o.h = n * 0.5 + pebble * 0.6; o.rough = 0.94; o.metal = 0; o.ao = 0.6 + n * 0.3 + pebble * 0.1;
  },
  snow(u, v, o) {
    const n = fbm(u, v, 8, 4, 19), sp = vnoise(u * 180, v * 180, 180, 3) > 0.93 ? 1 : 0;
    const k = 0.86 + n * 0.1;
    o.r = k * 0.95; o.g = k * 0.97; o.b = k; o.h = n; o.rough = 0.55 - sp * 0.4; o.metal = 0; o.ao = 0.9 + n * 0.1;
  },
  fur(u, v, o) {
    const s = fbm(u * 0.2, v * 6, 32, 3, 3);
    const k = 0.6 + s * 0.4;
    o.r = k; o.g = k; o.b = k; o.h = s; o.rough = 0.95; o.metal = 0; o.ao = 0.8 + s * 0.2;
  },
  // alpha textures for foliage and grass
  leaves(u, v, o) {
    const c = cell(u, v, 7, 6);
    const leaf = sstep(0.5, 0.38, c.d1);
    const vein = sstep(0.04, 0, Math.abs((u * 7 % 1) - (v * 7 % 1)) * 0.3);
    const tone = 0.7 + c.id * 0.5;
    o.r = 0.2 * tone; o.g = 0.36 * tone; o.b = 0.12 * tone; o.a = leaf; o.h = leaf * (0.6 + vein * 0.4); o.rough = 0.8; o.metal = 0; o.ao = 0.7 + leaf * 0.3;
  },
  needles(u, v, o) {
    let a = 0;
    for (let k = 0; k < 6; k++) { const ang = hashv(k, 2, 1) * 6.28; const cx = hashv(k, 7, 3), cy = hashv(k, 9, 5); const du = ((u - cx + 1.5) % 1) - 0.5, dv = ((v - cy + 1.5) % 1) - 0.5; const along = du * Math.cos(ang) + dv * Math.sin(ang), across = -du * Math.sin(ang) + dv * Math.cos(ang); if (Math.abs(along) < 0.45) a = Math.max(a, sstep(0.025, 0.008, Math.abs(across - Math.sin(along * 30) * 0.004))); }
    const n = fbm(u, v, 8, 3, 4);
    a = Math.max(a, sstep(0.38, 0.5, fbm(u, v, 6, 3, 8)));
    o.r = 0.12 + n * 0.06; o.g = 0.26 + n * 0.08; o.b = 0.12; o.a = a; o.h = a; o.rough = 0.8; o.metal = 0; o.ao = 0.6 + a * 0.4;
  },
  blades(u, v, o) {
    let a = 0;
    for (let k = 0; k < 9; k++) { const x = hashv(k, 1, 2) * 0.9 + 0.05, top = 0.45 + hashv(k, 3, 4) * 0.55, lean = (hashv(k, 5, 6) - 0.5) * 0.3; const w = 0.035 * (1 - v / top); const cx = x + lean * v; if (v < top && Math.abs(u - cx) < w) a = 1; }
    const tone = 0.7 + v * 0.4;
    o.r = 0.28 * tone; o.g = 0.42 * tone; o.b = 0.14 * tone; o.a = a; o.h = a; o.rough = 0.9; o.metal = 0; o.ao = 0.5 + v * 0.5;
  },
};

function build(name, S, normalStrength = 2) {
  const prog = P[name];
  const n = S * S;
  const alb = new Uint8Array(n * 4), orm = new Uint8Array(n * 4), nor = new Uint8Array(n * 4);
  const H = new Float32Array(n);
  const o = { r: 0, g: 0, b: 0, h: 0, rough: 0.8, metal: 0, ao: 1, a: 1 };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    o.a = 1;
    prog(x / S, y / S, o);
    const i = y * S + x, k = i * 4;
    alb[k] = clamp01(o.r) * 255; alb[k + 1] = clamp01(o.g) * 255; alb[k + 2] = clamp01(o.b) * 255; alb[k + 3] = clamp01(o.a) * 255;
    orm[k] = clamp01(o.ao) * 255; orm[k + 1] = clamp01(o.rough) * 255; orm[k + 2] = clamp01(o.metal) * 255; orm[k + 3] = 255;
    H[i] = o.h;
  }
  const st = normalStrength * S / 256;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = H[y * S + ((x - 1 + S) % S)], r = H[y * S + ((x + 1) % S)], d = H[((y - 1 + S) % S) * S + x], u = H[((y + 1) % S) * S + x];
    let nx = (l - r) * st, ny = (d - u) * st, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const k = (y * S + x) * 4;
    nor[k] = (nx * 0.5 + 0.5) * 255; nor[k + 1] = (ny * 0.5 + 0.5) * 255; nor[k + 2] = (nz * 0.5 + 0.5) * 255; nor[k + 3] = 255;
  }
  return { alb, orm, nor, S };
}
function tex(data, S, srgb, aniso) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export const TERRAIN_LAYERS = ['grass', 'forest', 'sand', 'dirt', 'rock', 'snow', 'asphalt'];
const NORMAL_STRENGTH = { wood: 3, stone: 4, rock: 5, bark: 6, concrete: 2, corrugated: 6, armored: 4, rust: 3, sand: 2, dirt: 4, grass: 3, forest: 3, snow: 2, asphalt: 3, cloth: 2, leather: 3, gunmetal: 1, polymer: 1.5, metal: 1, paint: 2, leaves: 3, needles: 2, blades: 2, gunwood: 1.5, fur: 3, twig: 5 };

export class TextureLibrary {
  constructor(size = 512, aniso = 4) { this.S = size; this.aniso = aniso; this.sets = {}; }
  // Generate a set of textures, yielding between materials so the loading screen stays alive.
  async generate(names, onStep) {
    for (const n of names) {
      if (this.sets[n]) continue;
      const S = n === 'blades' || n === 'leaves' || n === 'needles' ? Math.min(this.S, 256) : this.S;
      const b = build(n, S, NORMAL_STRENGTH[n] || 2);
      this.sets[n] = { map: tex(b.alb, S, true, this.aniso), normalMap: tex(b.nor, S, false, this.aniso), orm: tex(b.orm, S, false, this.aniso), raw: b };
      if (onStep) await onStep(n);
    }
  }
  get(n) { return this.sets[n]; }
  // All terrain layers stacked into array textures for the terrain shader.
  terrainArrays() {
    const S = this.S, L = TERRAIN_LAYERS.length;
    const alb = new Uint8Array(S * S * 4 * L), nor = new Uint8Array(S * S * 4 * L);
    TERRAIN_LAYERS.forEach((n, i) => {
      const r = this.sets[n].raw;
      // pack roughness into albedo alpha and AO into normal alpha
      const a = new Uint8Array(r.alb), nn = new Uint8Array(r.nor);
      for (let k = 0; k < S * S; k++) { a[k * 4 + 3] = r.orm[k * 4 + 1]; nn[k * 4 + 3] = r.orm[k * 4]; }
      alb.set(a, i * S * S * 4); nor.set(nn, i * S * S * 4);
    });
    const mk = (d, srgb) => { const t = new THREE.DataArrayTexture(d, S, S, L); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = this.aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
    return { albedo: mk(alb, true), normal: mk(nor, false) };
  }
}
export const ALL_TEXTURES = Object.keys(P);

// Geometry builder: accumulate boxes, cylinders and prisms into per-material buckets with world-scaled
// UVs and vertex tint colours, then emit one mesh per material.
import * as THREE from 'three';

const _c = new THREE.Color();

export class GeoBuilder {
  constructor(uvScale = 0.5) { this.buckets = new Map(); this.mat = 'flat'; this.uvScale = uvScale; this.fakeShade = false; }
  get b() { let b = this.buckets.get(this.mat); if (!b) { b = { pos: [], nor: [], col: [], uv: [] }; this.buckets.set(this.mat, b); } return b; }
  setMat(k) { this.mat = k; return this; }
  _tri(a, b, c, r, g, bl, ua, ub, uc) {
    const B = this.b;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    B.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    B.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    B.col.push(r, g, bl, r, g, bl, r, g, bl);
    B.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  _quad(p0, p1, p2, p3, r, g, b, w = 1, h = 1) {
    const s = this.uvScale;
    const u0 = [0, 0], u1 = [w * s, 0], u2 = [w * s, h * s], u3 = [0, h * s];
    this._tri(p0, p1, p2, r, g, b, u0, u1, u2);
    this._tri(p0, p2, p3, r, g, b, u0, u2, u3);
  }
  static xf(ox, oy, oz, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return (x, y, z) => [ox + x * c + z * s, oy + y, oz - x * s + z * c];
  }
  box(xf, x, y, z, hx, hy, hz, color, yaw = 0, shade) {
    _c.set(color);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (a, b, d) => xf(x + a * c + d * s, y + b, z - a * s + d * c);
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    const sh = shade ?? this.fakeShade;
    const r = _c.r, g = _c.g, b = _c.b, k = sh ? 0.82 : 1, k2 = sh ? 0.7 : 1;
    const W = hx * 2, H = hy * 2, D = hz * 2;
    this._quad(v[4], v[5], v[6], v[7], r * k, g * k, b * k, W, H);
    this._quad(v[1], v[0], v[3], v[2], r * k, g * k, b * k, W, H);
    this._quad(v[5], v[1], v[2], v[6], r * k2, g * k2, b * k2, D, H);
    this._quad(v[0], v[4], v[7], v[3], r * k2, g * k2, b * k2, D, H);
    this._quad(v[3], v[7], v[6], v[2], r, g, b, W, D);
    this._quad(v[0], v[1], v[5], v[4], r * 0.6, g * 0.6, b * 0.6, W, D);
  }
  cyl(xf, x, y0, z, rad, h, color, seg = 10, top = true, rad2 = rad) {
    _c.set(color);
    const r = _c.r, g = _c.g, b = _c.b, s = this.uvScale;
    const circ = Math.PI * 2 * Math.max(rad, rad2);
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p0 = xf(x + Math.cos(a0) * rad, y0, z + Math.sin(a0) * rad), p1 = xf(x + Math.cos(a1) * rad, y0, z + Math.sin(a1) * rad);
      const p2 = xf(x + Math.cos(a1) * rad2, y0 + h, z + Math.sin(a1) * rad2), p3 = xf(x + Math.cos(a0) * rad2, y0 + h, z + Math.sin(a0) * rad2);
      const ua = i / seg * circ * s, ub = (i + 1) / seg * circ * s;
      this._tri(p0, p3, p2, r, g, b, [ua, 0], [ua, h * s], [ub, h * s]);
      this._tri(p0, p2, p1, r, g, b, [ua, 0], [ub, h * s], [ub, 0]);
      if (top && rad2 > 0) { const c0 = xf(x, y0 + h, z); this._tri(c0, p2, p3, r, g, b, [0.5, 0.5], [Math.cos(a1) * rad2 * s, Math.sin(a1) * rad2 * s], [Math.cos(a0) * rad2 * s, Math.sin(a0) * rad2 * s]); }
    }
  }
  gable(xf, x, y, z, hx, hz, h, color) {
    _c.set(color);
    const r = _c.r, g = _c.g, b = _c.b;
    const a = xf(x - hx, y, z - hz), bb = xf(x + hx, y, z - hz), c = xf(x + hx, y, z + hz), d = xf(x - hx, y, z + hz);
    const e = xf(x - hx, y + h, z), f = xf(x + hx, y + h, z);
    const sl = Math.hypot(hz, h);
    this._quad(a, e, f, bb, r, g, b, sl, hx * 2);
    this._quad(c, f, e, d, r, g, b, sl, hx * 2);
    this._tri(d, e, a, r, g, b, [0, 0], [0.5, 1], [1, 0]);
    this._tri(bb, f, c, r, g, b, [0, 0], [0.5, 1], [1, 0]);
  }
  // A stick between two points (square section), for lattices and frames.
  stick(xf, ax, ay, az, bx, by, bz, t, color) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    const d = new THREE.Vector3(dx / L, dy / L, dz / L);
    const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(d, up).normalize().multiplyScalar(t), w = new THREE.Vector3().crossVectors(d, u).normalize().multiplyScalar(t);
    const P = (s, a, b) => xf(ax + dx * s + u.x * a + w.x * b, ay + dy * s + u.y * a + w.y * b, az + dz * s + u.z * a + w.z * b);
    _c.set(color);
    const r = _c.r, g = _c.g, b = _c.b;
    const c = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) { const p = c[i], q = c[(i + 1) % 4]; this._quad(P(0, p[0], p[1]), P(0, q[0], q[1]), P(1, q[0], q[1]), P(1, p[0], p[1]), r, g, b, t * 2, L); }
  }
  geometry(key) {
    const b = key ? this.buckets.get(key) : [...this.buckets.values()][0];
    const g = new THREE.BufferGeometry();
    if (!b) return g;
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
  // Everything in one geometry (placement ghosts).
  merged() {
    const g = new THREE.BufferGeometry(), all = { pos: [], nor: [], col: [], uv: [] };
    for (const b of this.buckets.values()) for (const k in all) all[k].push(...b[k]);
    g.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(all.nor, 3));
    g.computeBoundingSphere();
    return g;
  }
  // One mesh per material bucket. matFn(key) -> material.
  meshes(matFn) { return [...this.buckets.keys()].map(k => { const m = new THREE.Mesh(this.geometry(k), matFn(k)); m.castShadow = true; m.receiveShadow = true; return m; }); }
  // Bucket geometries keyed by material (for building one geometry per material set).
  parts(matFn) { return [...this.buckets.keys()].map(k => ({ geo: this.geometry(k), mat: matFn(k) })); }
  get empty() { return this.buckets.size === 0; }
}

export const VCOLOR_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

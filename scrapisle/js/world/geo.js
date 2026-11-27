// Tiny geometry builder: accumulate colored boxes/cylinders/prisms into one BufferGeometry.
import * as THREE from 'three';

const _c = new THREE.Color();

export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  _tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.col.push(r, g, b, r, g, b, r, g, b);
  }
  _quad(p0, p1, p2, p3, r, g, b) {
    this._tri(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], r, g, b);
    this._tri(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], r, g, b);
  }
  // Transform helper: local (x,y,z) around an origin with yaw.
  static xf(ox, oy, oz, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return (x, y, z) => [ox + x * c + z * s, oy + y, oz - x * s + z * c];
  }
  // Box centered at local (x,y,z) with half extents, extra yaw about its own center, in frame xf.
  box(xf, x, y, z, hx, hy, hz, color, yaw = 0, shade = true) {
    _c.set(color);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (a, b, d) => xf(x + a * c + d * s, y + b, z - a * s + d * c);
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    const r = _c.r, g = _c.g, b = _c.b;
    const k = shade ? 0.82 : 1, k2 = shade ? 0.7 : 1;
    this._quad(v[4], v[5], v[6], v[7], r * k, g * k, b * k);       // +z
    this._quad(v[1], v[0], v[3], v[2], r * k, g * k, b * k);       // -z
    this._quad(v[5], v[1], v[2], v[6], r * k2, g * k2, b * k2);    // +x
    this._quad(v[0], v[4], v[7], v[3], r * k2, g * k2, b * k2);    // -x
    this._quad(v[3], v[7], v[6], v[2], r, g, b);                   // top
    this._quad(v[0], v[1], v[5], v[4], r * 0.5, g * 0.5, b * 0.5); // bottom
  }
  cyl(xf, x, y0, z, rad, h, color, seg = 10, top = true, rad2 = rad) {
    _c.set(color);
    const r = _c.r, g = _c.g, b = _c.b;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p0 = xf(x + Math.cos(a0) * rad, y0, z + Math.sin(a0) * rad), p1 = xf(x + Math.cos(a1) * rad, y0, z + Math.sin(a1) * rad);
      const p2 = xf(x + Math.cos(a1) * rad2, y0 + h, z + Math.sin(a1) * rad2), p3 = xf(x + Math.cos(a0) * rad2, y0 + h, z + Math.sin(a0) * rad2);
      const sh = 0.75 + 0.25 * Math.cos(a0 - 0.8);
      this._quad(p0, p3, p2, p1, r * sh, g * sh, b * sh);
      if (top && rad2 > 0) { const c0 = xf(x, y0 + h, z); this._tri(c0[0], c0[1], c0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], r, g, b); }
    }
  }
  // Gable roof prism along local x.
  gable(xf, x, y, z, hx, hz, h, color) {
    _c.set(color);
    const r = _c.r, g = _c.g, b = _c.b;
    const a = xf(x - hx, y, z - hz), bb = xf(x + hx, y, z - hz), c = xf(x + hx, y, z + hz), d = xf(x - hx, y, z + hz);
    const e = xf(x - hx, y + h, z), f = xf(x + hx, y + h, z);
    this._quad(a, e, f, bb, r * 0.9, g * 0.9, b * 0.9);
    this._quad(c, f, e, d, r, g, b);
    this._tri(d[0], d[1], d[2], e[0], e[1], e[2], a[0], a[1], a[2], r * 0.7, g * 0.7, b * 0.7);
    this._tri(bb[0], bb[1], bb[2], f[0], f[1], f[2], c[0], c[1], c[2], r * 0.7, g * 0.7, b * 0.7);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.pos.length === 0; }
}

export const VCOLOR_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

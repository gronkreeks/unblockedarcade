// Uniform grid spatial hash on the XZ plane. Items need x, z and are keyed by object identity.

export class SpatialHash {
  constructor(cell = 16) { this.cell = cell; this.map = new Map(); this.where = new Map(); }
  _key(cx, cz) { return (cx + 4096) * 8192 + (cz + 4096); }
  insert(obj, x = obj.x, z = obj.z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const k = this._key(cx, cz);
    const prev = this.where.get(obj);
    if (prev === k) return;
    if (prev !== undefined) { const b = this.map.get(prev); if (b) { const i = b.indexOf(obj); if (i >= 0) { b[i] = b[b.length - 1]; b.pop(); } } }
    let b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(obj);
    this.where.set(obj, k);
  }
  update(obj, x = obj.x, z = obj.z) { this.insert(obj, x, z); }
  remove(obj) {
    const k = this.where.get(obj);
    if (k === undefined) return;
    const b = this.map.get(k);
    if (b) { const i = b.indexOf(obj); if (i >= 0) { b[i] = b[b.length - 1]; b.pop(); } }
    this.where.delete(obj);
  }
  // Calls fn(obj) for objects in cells overlapping the circle; fn may return true to stop.
  query(x, z, r, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const b = this.map.get(this._key(cx, cz));
      if (!b) continue;
      for (let i = 0; i < b.length; i++) if (fn(b[i]) === true) return;
    }
  }
  queryList(x, z, r, filter) {
    const out = [], r2 = r * r;
    this.query(x, z, r, o => { const dx = o.x - x, dz = o.z - z; if (dx * dx + dz * dz <= r2 && (!filter || filter(o))) out.push(o); });
    return out;
  }
  // Searches outward ring by ring and stops once nothing further out can be closer, so a match next
  // door costs a few cells instead of the whole square (bots look for trees and ore up to 700 m away).
  nearest(x, z, r, filter) {
    const c = this.cell, cx0 = Math.floor(x / c), cz0 = Math.floor(z / c), last = Math.ceil(r / c) + 1;
    let best = null, bd = r * r;
    const scan = (cx, cz) => {
      const b = this.map.get(this._key(cx, cz));
      if (!b) return;
      for (let i = 0; i < b.length; i++) { const o = b[i], dx = o.x - x, dz = o.z - z, d = dx * dx + dz * dz; if (d < bd && (!filter || filter(o))) { bd = d; best = o; } }
    };
    scan(cx0, cz0);
    for (let k = 1; k <= last; k++) {
      const near = (k - 1) * c;   // every cell in this ring is at least this far away
      if (near * near > bd) break;
      for (let cx = cx0 - k; cx <= cx0 + k; cx++) { scan(cx, cz0 - k); scan(cx, cz0 + k); }
      for (let cz = cz0 - k + 1; cz <= cz0 + k - 1; cz++) { scan(cx0 - k, cz); scan(cx0 + k, cz); }
    }
    return best;
  }
  clear() { this.map.clear(); this.where.clear(); }
}

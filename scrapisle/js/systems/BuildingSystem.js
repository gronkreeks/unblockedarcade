// Grid building: structures, pieces, grades, stability, privilege, upkeep, decay, doors and locks.
import * as THREE from 'three';
import { CELL, LEVEL_H, FOUND_H, GRADES, PIECES, STRUCT_DMG, DOORS, pieceCost, pieceMaxHp, pieceUpkeep, PRIVILEGE_PAD } from '../data/building.js';
import { GeoBuilder } from '../world/geo.js';
import { SpatialHash } from '../core/spatial.js';
import { uid, dist } from '../core/util.js';

const T = 0.1; // half wall thickness

// Boxes for each piece type in the piece frame. Cell pieces: origin = cell center at the floor surface.
// Edge pieces: origin = edge midpoint at the floor surface, spanning local x.
function pieceBoxes(type) {
  switch (type) {
    case 'foundation': return [{ x: 0, y: -1.5, z: 0, hx: 1.5, hy: 1.5, hz: 1.5 }];
    case 'floor': return [{ x: 0, y: -0.1, z: 0, hx: 1.5, hy: 0.1, hz: 1.5 }];
    case 'roof': return [{ x: 0, y: -0.1, z: 0, hx: 1.5, hy: 0.1, hz: 1.5 }];
    case 'wall': return [{ x: 0, y: 1.5, z: 0, hx: 1.5, hy: 1.5, hz: T }];
    case 'half_wall': return [{ x: 0, y: 0.75, z: 0, hx: 1.5, hy: 0.75, hz: T }];
    case 'doorway': return [
      { x: -1.05, y: 1.5, z: 0, hx: 0.45, hy: 1.5, hz: T }, { x: 1.05, y: 1.5, z: 0, hx: 0.45, hy: 1.5, hz: T },
      { x: 0, y: 2.6, z: 0, hx: 0.6, hy: 0.4, hz: T }];
    case 'window': return [
      { x: 0, y: 0.55, z: 0, hx: 1.5, hy: 0.55, hz: T }, { x: 0, y: 2.5, z: 0, hx: 1.5, hy: 0.5, hz: T },
      { x: -1.15, y: 1.55, z: 0, hx: 0.35, hy: 0.45, hz: T }, { x: 1.15, y: 1.55, z: 0, hx: 0.35, hy: 0.45, hz: T }];
    case 'stairs': {
      const out = [];
      for (let n = 0; n < 6; n++) { const top = 0.5 * (n + 1); out.push({ x: 0, y: top / 2, z: -1.5 + n * 0.5 + 0.25, hx: 1.4, hy: top / 2, hz: 0.25 }); }
      return out;
    }
  }
  return [];
}
const DOOR_BOX = { x: 0, y: 1.1, z: 0, hx: 0.6, hy: 1.1, hz: 0.05 };

export class BuildingSystem {
  constructor(game) {
    this.game = game;
    this.structures = new Map();
    this.pieceHash = new SpatialHash(12);
    this.geos = {};
    const M = game.mats;
    this.gradeMat = [M.get('twig', { vc: true }), M.get('wood', { vc: true }), M.get('stone', { vc: true }), M.get('corrugated', { vc: true }), M.get('armored', { vc: true })];
    this.trimMat = { wood: M.get('wood', { vc: true }), metal: M.get('metal', { vc: true }) };
    this.ghostOk = new THREE.MeshBasicMaterial({ color: 0x4ad86a, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: 0xd84a4a, transparent: true, opacity: 0.35, depthWrite: false });
    this.visuals = {};
    this.group = new THREE.Group();
    game.scene.add(this.group);
  }

  // Solid silhouette geometry (used for placement ghosts).
  geo(type) {
    if (!this.geos[type]) {
      const g = new GeoBuilder(), xf = GeoBuilder.xf(0, 0, 0, 0);
      if (type === 'roof') {
        g.box(xf, 0, -0.1, 0, 1.5, 0.1, 1.5, 0xffffff);
        g.cyl(GeoBuilder.xf(0, 0, 0, Math.PI / 4), 0, 0, 0, 2.12, 1.4, 0xe0e0e0, 4, true, 0.05);
      } else if (type === 'door') g.box(xf, DOOR_BOX.x, DOOR_BOX.y, DOOR_BOX.z, DOOR_BOX.hx, DOOR_BOX.hy, DOOR_BOX.hz, 0xffffff);
      else for (const b of pieceBoxes(type)) g.box(xf, b.x, b.y, b.z, b.hx, b.hy, b.hz, 0xffffff);
      this.geos[type] = g.geometry();
    }
    return this.geos[type];
  }
  // Detailed visual parts for a piece at a grade: twig is a lashed stick lattice; higher grades are
  // solid textured panels with frames/trim. Cached per type+grade.
  visual(type, grade) {
    const key = type + ':' + grade;
    if (this.visuals[key]) return this.visuals[key];
    const g = new GeoBuilder(0.66), xf = GeoBuilder.xf(0, 0, 0, 0);
    const boxes = pieceBoxes(type);
    if (grade === 0) {
      g.setMat('g');
      const t = 0.045;
      for (const b of boxes) {
        const x0 = b.x - b.hx, x1 = b.x + b.hx, y0 = b.y - b.hy, y1 = b.y + b.hy, z0 = b.z - b.hz, z1 = b.z + b.hz;
        const E = (a, c) => g.stick(xf, a[0], a[1], a[2], c[0], c[1], c[2], t, 0xffffff);
        const C = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
        for (const [a, c] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) E(C[a], C[c]);
        // diagonals across the largest faces
        if (b.hz <= b.hx && b.hz <= b.hy) { E(C[0], C[2]); E(C[5], C[7]); if (b.hy > 1) { E([x0, b.y, b.z], [x1, b.y, b.z]); } }
        else if (b.hx <= b.hz && b.hx <= b.hy) { E(C[0], C[7]); E(C[1], C[6]); }
        else { E(C[3], C[6]); E(C[2], C[7]); }
      }
      if (type === 'roof') g.cyl(GeoBuilder.xf(0, 0, 0, Math.PI / 4), 0, 0, 0, 2.12, 1.4, 0xd0d0d0, 4, true, 0.05);
    } else {
      g.setMat('g');
      const tint = grade === 2 ? 0xffffff : 0xffffff;
      for (const b of boxes) g.box(xf, b.x, b.y, b.z, b.hx, b.hy, b.hz, tint);
      if (type === 'roof') g.cyl(GeoBuilder.xf(0, 0, 0, Math.PI / 4), 0, 0, 0, 2.12, 1.4, 0xd8d8d8, 4, true, 0.05);
      // frames on wall-type pieces
      if ((type === 'wall' || type === 'doorway' || type === 'window' || type === 'half_wall') && (grade === 1 || grade === 3)) {
        g.setMat(grade === 1 ? 'tw' : 'tm');
        const col = grade === 1 ? 0x6b5038 : 0xcfcfcf, H = type === 'half_wall' ? 1.5 : 3;
        for (const x of [-1.44, 1.44]) g.box(xf, x, H / 2, 0, 0.07, H / 2, 0.13, col);
        g.box(xf, 0, H - 0.06, 0, 1.5, 0.06, 0.13, col); g.box(xf, 0, 0.06, 0, 1.5, 0.06, 0.13, col);
        if (type === 'doorway') for (const x of [-0.62, 0.62]) g.box(xf, x, 1.1, 0, 0.05, 1.1, 0.13, col);
      }
      if ((type === 'foundation' || type === 'floor') && grade === 1) { g.setMat('tw'); for (const x of [-1.35, 0, 1.35]) g.box(xf, x, type === 'floor' ? -0.22 : -0.08, 0, 0.08, 0.08, 1.5, 0x6b5038); }
    }
    const mats = { g: this.gradeMat[grade], tw: this.trimMat.wood, tm: this.trimMat.metal };
    return (this.visuals[key] = g.parts(k => mats[k]));
  }
  doorVisual(type) {
    const key = 'door:' + type;
    if (this.visuals[key]) return this.visuals[key];
    const g = new GeoBuilder(0.66), xf = GeoBuilder.xf(0, 0, 0, 0), M = this.game.mats;
    const B = DOOR_BOX;
    if (type === 'wood_door') {
      g.setMat('wood'); g.box(xf, B.x, B.y, B.z, B.hx, B.hy, B.hz, 0xffffff);
      g.setMat('trim'); for (const y of [0.4, 1.8]) g.box(xf, 0, y, 0.07, 0.58, 0.07, 0.025, 0x6b5038);
      g.stick(xf, -0.5, 0.45, 0.075, 0.5, 1.75, 0.075, 0.035, 0x6b5038);
    } else if (type === 'metal_door') {
      g.setMat('sheet'); g.box(xf, B.x, B.y, B.z, B.hx, B.hy, B.hz, 0xffffff);
      g.setMat('metal'); for (const x of [-0.56, 0.56]) g.box(xf, x, 1.1, 0, 0.04, 1.1, 0.07, 0xbbbbbb); for (const y of [0.04, 2.16]) g.box(xf, 0, y, 0, 0.6, 0.04, 0.07, 0xbbbbbb);
      g.setMat('dark'); g.box(xf, 0, 1.65, 0, 0.22, 0.04, 0.07, 0x111111);
    } else {
      g.setMat('arm'); g.box(xf, B.x, B.y, B.z, B.hx, B.hy, B.hz + 0.02, 0xffffff);
      g.setMat('metal'); for (const y of [0.35, 0.95, 1.55, 2.0]) g.box(xf, 0, y, 0, 0.6, 0.05, 0.09, 0x9a9a9a);
    }
    g.setMat('metal'); g.box(xf, 0.45, 1.05, 0.08, 0.02, 0.06, 0.03, 0xaaaaaa); g.box(xf, 0.45, 1.05, -0.08, 0.02, 0.06, 0.03, 0xaaaaaa);
    const mats = { wood: M.get('wood', { vc: true }), trim: M.get('wood', { vc: true }), sheet: M.get('corrugated', { vc: true }), metal: M.get('metal', { vc: true }), arm: M.get('armored', { vc: true }), dark: M.get('rubber') };
    return (this.visuals[key] = g.parts(k => mats[k]));
  }
  lockVisual(type) {
    const key = 'lock:' + type;
    if (this.visuals[key]) return this.visuals[key];
    const g = new GeoBuilder(1), xf = GeoBuilder.xf(0, 0, 0, 0), M = this.game.mats;
    if (type === 'code') { g.setMat('p'); g.box(xf, 0, 0, 0, 0.06, 0.09, 0.03, 0xffffff); g.setMat('l'); g.box(xf, 0, 0.065, 0.032, 0.02, 0.008, 0.004, 0xffffff); }
    else { g.setMat('m'); g.box(xf, 0, -0.02, 0, 0.04, 0.035, 0.015, 0xffffff); g.cyl(xf, 0, 0.015, 0, 0.025, 0.04, 0xffffff, 8, false); }
    const mats = { p: M.get('polymer'), l: M.get('emissive'), m: M.get('paint', { vc: true, color: 0xc7a34b }) };
    return (this.visuals[key] = g.parts(k => mats[k]));
  }
  _parts(parts, tag) {
    const grp = new THREE.Group();
    for (const p of parts) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = true; m.receiveShadow = true; m.userData[tag[0]] = tag[1]; grp.add(m); }
    return grp;
  }

  // ---------- coordinates ----------
  toWorld(st, lx, ly, lz) { return { x: st.ox + lx * st.c + lz * st.s, y: st.oy + ly, z: st.oz - lx * st.s + lz * st.c }; }
  toLocal(st, x, y, z) { const dx = x - st.ox, dz = z - st.oz; return { x: dx * st.c - dz * st.s, y: y - st.oy, z: dx * st.s + dz * st.c }; }
  // Piece frame origin (structure local) and yaw for a spec.
  frame(spec) {
    const { type, i, j, k } = spec;
    const y = FOUND_H + k * LEVEL_H;
    if (PIECES[type].kind === 'cell') return { lx: (i + 0.5) * CELL, ly: type === 'foundation' ? FOUND_H : y, lz: (j + 0.5) * CELL, yaw: type === 'stairs' ? (spec.rot || 0) * Math.PI / 2 : 0 };
    if (spec.axis === 'z') return { lx: (i + 0.5) * CELL, ly: y, lz: j * CELL, yaw: 0 };
    return { lx: i * CELL, ly: y, lz: (j + 0.5) * CELL, yaw: Math.PI / 2 };
  }
  keyOf(spec) {
    const { type, i, j, k } = spec;
    if (type === 'stairs') return `s:${i},${j},${k}`;
    if (PIECES[type].kind === 'cell') return `c:${i},${j},${k}`;
    return `${spec.axis}:${i},${j},${k}`;
  }
  get(st, key) { return st.pieces.get(key); }
  cellPiece(st, i, j, k) { return st.pieces.get(`c:${i},${j},${k}`); }
  stairsAt(st, i, j, k) { return st.pieces.get(`s:${i},${j},${k}`); }
  edgesOfCell(i, j, k) { return [`x:${i},${j},${k}`, `x:${i + 1},${j},${k}`, `z:${i},${j},${k}`, `z:${i},${j + 1},${k}`]; }
  cellsOfEdge(axis, i, j) { return axis === 'x' ? [[i - 1, j], [i, j]] : [[i, j - 1], [i, j]]; }

  // ---------- privilege ----------
  zoneOf(st) {
    if (st._zoneV === st.version) return st._zone;
    let cx = 0, cz = 0, n = 0;
    for (const p of st.pieces.values()) { cx += p.wx; cz += p.wz; n++; }
    cx /= Math.max(1, n); cz /= Math.max(1, n);
    let r = 0;
    for (const p of st.pieces.values()) r = Math.max(r, dist(cx, cz, p.wx, p.wz));
    st._zone = { x: cx, z: cz, r: r + PRIVILEGE_PAD, core: r + 3 };
    st._zoneV = st.version;
    return st._zone;
  }
  tcOf(st) { return st.tc ? this.game.deploy.byId.get(st.tc) : null; }
  isAuthed(team, st) { const tc = this.tcOf(st); return !tc || tc.auth.has(team); }
  // Is building blocked for this team at x,z by someone else's Claim Cabinet?
  blockedFor(team, x, z) {
    for (const st of this.structures.values()) {
      const tc = this.tcOf(st); if (!tc) continue;
      const zn = this.zoneOf(st);
      if (dist(x, z, zn.x, zn.z) < zn.r && !tc.auth.has(team)) return st;
    }
    return null;
  }
  privilegeAt(team, x, z) {
    for (const st of this.structures.values()) {
      const tc = this.tcOf(st); if (!tc) continue;
      const zn = this.zoneOf(st);
      if (dist(x, z, zn.x, zn.z) < zn.r) return tc.auth.has(team) ? 'auth' : 'blocked';
    }
    return null;
  }
  blockedAt(x, z, r) { let hit = false; this.pieceHash.query(x, z, r + 3, p => { if (dist(x, z, p.wx, p.wz) < r + 2.2) { hit = true; return true; } }); return hit; }
  structureNear(x, z, r) {
    let best = null, bd = r;
    this.pieceHash.query(x, z, r, p => { const d = dist(x, z, p.wx, p.wz); if (d < bd) { bd = d; best = p; } });
    return best ? this.structures.get(best.st) : null;
  }

  // ---------- validation ----------
  // spec: { st?: structureId, newSt?: {ox,oy,oz,yaw}, type, i, j, k, axis?, rot? }
  check(team, spec) {
    const P = PIECES[spec.type];
    if (!P) return 'Unknown piece';
    const W = this.game.world;
    const st = spec.st ? this.structures.get(spec.st) : null;
    if (!st && spec.type !== 'foundation') return 'Needs a foundation';
    const tmp = st || this._tmpStructure(spec.newSt);
    const f = this.frame(spec);
    const wp = this.toWorld(tmp, f.lx, f.ly, f.lz);
    if (!W.inBounds(wp.x, wp.z, 30)) return 'Too close to the edge of the world';
    // walling at monuments is allowed (fights), just not inside the monument's own buildings;
    // claim cabinets stay blocked there (Deployables) and monument walls decay fast (tickDecay)
    const mon = W.monumentAt(wp.x, wp.z, 12);
    if (mon && spec.type === 'foundation' && this._monumentInWay(mon, wp.x, wp.z, tmp.oy - 0.5, tmp.oy + 3.5)) return 'The monument is in the way';
    if (W.isRoad(wp.x, wp.z)) return 'Cannot build on roads';
    const blk = this.blockedFor(team, wp.x, wp.z);
    if (blk && (!st || blk !== st || !this.isAuthed(team, st))) return 'Building blocked';
    if (st && this.tcOf(st) && !this.isAuthed(team, st)) return 'Building blocked';
    const key = this.keyOf(spec);
    if (st && st.pieces.has(key)) return 'Something is already there';
    if (this._actorInside(tmp, spec)) return 'Someone is in the way';
    const k = spec.k;
    if (spec.type === 'foundation') {
      if (k !== 0) return 'Foundations go on the ground';
      // terrain under the cell
      const pts = [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4], [0, 0]].map(([a, b]) => this.toWorld(tmp, f.lx + a, 0, f.lz + b));
      const hs = pts.map(p => W.heightAt(p.x, p.z));
      const top = tmp.oy + FOUND_H;
      const mx = Math.max(...hs), mn = Math.min(...hs);
      if (mx > top + 0.35) return 'Terrain is in the way';
      if (mn < top - 3.6) return 'Too high off the ground';
      for (const p of pts) { if (W.waterSurface(p.x, p.z)) return 'Cannot build in water'; }
      // overlap with nodes / other structures / monuments colliders
      let bad = null;
      this.game.res.hash.query(wp.x, wp.z, 3.5, n => { if (n.alive && n.type !== 'pick' && dist(n.x, n.z, wp.x, wp.z) < 2.4) { bad = 'A tree or rock is in the way'; return true; } });
      if (bad) return bad;
      this.pieceHash.query(wp.x, wp.z, 5, p => { if (p.st !== (st && st.id) && dist(p.wx, p.wz, wp.x, wp.z) < 3.2) { bad = 'Another building is in the way'; return true; } });
      if (bad) return bad;
      if (st) {
        const { i, j } = spec;
        const adj = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].some(([a, b]) => this.cellPiece(st, a, b, 0));
        if (!adj) return 'Must connect to a foundation';
      }
      return null;
    }
    if (P.kind === 'edge') {
      const cells = this.cellsOfEdge(spec.axis, spec.i, spec.j);
      let sup = cells.some(([a, b]) => { const c = this.cellPiece(st, a, b, k); return c && c.type !== 'roof'; });
      if (!sup && k > 0) { const below = st.pieces.get(`${spec.axis}:${spec.i},${spec.j},${k - 1}`); sup = !!(below && PIECES[below.type].full); }
      if (!sup) return 'Needs support';
      if (k > 0 && cells.every(([a, b]) => !this.cellPiece(st, a, b, k) && !st.pieces.get(`${spec.axis}:${spec.i},${spec.j},${k - 1}`))) return 'Needs support';
      if (this.estimateStability(st, spec) < 0.15) return 'Not stable enough';
      return null;
    }
    // floor / roof / stairs
    const { i, j } = spec;
    if (spec.type === 'stairs') {
      const base = this.cellPiece(st, i, j, k);
      if (!base || base.type === 'roof') return 'Stairs need a floor or foundation';
      if (this.cellPiece(st, i, j, k + 1)) return 'Ceiling above the stairs';
      return null;
    }
    if (k < 1) return 'Place floors on top of walls';
    if (this.stairsAt(st, i, j, k - 1)) return 'Stairs below';
    const walls = this.edgesOfCell(i, j, k - 1).some(key2 => { const w = st.pieces.get(key2); return w && PIECES[w.type].kind === 'edge'; });
    if (spec.type === 'roof' && !walls) return 'Roofs need walls below';
    if (!walls) {
      const adj = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].some(([a, b]) => { const c = this.cellPiece(st, a, b, k); return c && c.type === 'floor'; });
      if (!adj) return 'Needs walls below';
    }
    if (this.estimateStability(st, spec) < 0.15) return 'Not stable enough';
    return null;
  }
  // Would the piece's solid boxes overlap a survivor, animal or guard?
  _actorInside(st, spec) {
    const f = this.frame(spec);
    const w = this.toWorld(st, f.lx, f.ly, f.lz);
    const yaw = st.yaw + f.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
    let hit = false;
    this.game.actorHash.query(w.x, w.z, 4, a => {
      if (!a.alive || hit) return;
      if (a.ai && a.ai.mode !== 'full') return; // distant bots are abstract; they step aside
      for (const b of pieceBoxes(spec.type)) {
        const bx = w.x + b.x * c + b.z * s, bz = w.z - b.x * s + b.z * c, by = w.y + b.y;
        const dx = a.x - bx, dz = a.z - bz;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        const r = a.r || 0.35, h = a.h || 1.8;
        if (Math.abs(lx) < b.hx + r && Math.abs(lz) < b.hz + r && a.y < by + b.hy - 0.05 && a.y + h > by - b.hy) { hit = true; return true; }
      }
    });
    return hit;
  }
  // Does a foundation here overlap one of the monument's buildings or props?
  _monumentInWay(mon, x, z, y0, y1) {
    let hit = false;
    this.game.physics.near(x, z, 8, c => {
      if (hit || c.ref !== mon) return;
      if (c.type === 'box') {
        if (c.y + c.hy < y0 + 0.35 || c.y - c.hy > y1) return;
        const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.yaw || 0), sn = Math.sin(c.yaw || 0);
        // either rotation sense: erring on the side of blocking
        for (const sg of [1, -1]) { const lx = dx * cs + sg * dz * sn, lz = -sg * dx * sn + dz * cs; if (Math.abs(lx) < c.hx + 1.5 && Math.abs(lz) < c.hz + 1.5) hit = true; }
      } else if (c.type === 'cyl') {
        if (c.y1 < y0 + 0.35 || c.y0 > y1) return;
        if (dist(x, z, c.x, c.z) < c.r + 1.5) hit = true;
      }
    });
    return hit;
  }
  _tmpStructure(n) { return { ox: n.ox, oy: n.oy, oz: n.oz, yaw: n.yaw, c: Math.cos(n.yaw), s: Math.sin(n.yaw), pieces: new Map() }; }

  // ---------- placement ----------
  place(surv, spec, opts = {}) {
    const err = this.check(surv.team, spec);
    if (err) return { ok: false, err };
    const cost = pieceCost(spec.type, 0);
    if (!opts.free && !surv.inv.pay(cost)) return { ok: false, err: 'Not enough wood' };
    let st = spec.st ? this.structures.get(spec.st) : null;
    if (!st) st = this.createStructure(spec.newSt, surv.team);
    const piece = this._addPiece(st, { type: spec.type, i: spec.i, j: spec.j, k: spec.k, axis: spec.axis, rot: spec.rot || 0, grade: 0 });
    this.recompute(st);
    this.game.events.emit('placed', { surv, st, piece });
    return { ok: true, piece, st };
  }
  createStructure(n, team, id) {
    const st = { id: id || uid('st'), ox: n.ox, oy: n.oy, oz: n.oz, yaw: n.yaw, c: Math.cos(n.yaw), s: Math.sin(n.yaw), pieces: new Map(), team, tc: null, created: this.game.now, version: 0 };
    this.structures.set(st.id, st);
    return st;
  }
  _addPiece(st, o) {
    const p = Object.assign({ id: o.id || uid('p'), st: st.id, hp: 0, maxHp: 0, stab: 1, placedAt: this.game.now, door: null, lastHit: -999 }, o);
    p.key = this.keyOf(p);
    p.maxHp = pieceMaxHp(p.type, p.grade);
    if (!o.hp) p.hp = p.maxHp;
    const f = this.frame(p);
    const w = this.toWorld(st, f.lx, f.ly, f.lz);
    p.wx = w.x; p.wy = w.y; p.wz = w.z; p.wyaw = st.yaw + f.yaw;
    st.pieces.set(p.key, p);
    st.version++;
    this.pieceHash.insert(p, p.wx, p.wz);
    this._buildPieceVisual(st, p);
    return p;
  }
  _buildPieceVisual(st, p) {
    if (p.mesh) this.group.remove(p.mesh);
    for (const c of p.cols || []) this.game.physics.remove(c);
    const m = this._parts(this.visual(p.type, p.grade), ['piece', p]);
    m.position.set(p.wx, p.wy, p.wz); m.rotation.y = p.wyaw;
    m.userData.piece = p;
    this.group.add(m);
    p.mesh = m;
    p.cols = [];
    const c = Math.cos(p.wyaw), s = Math.sin(p.wyaw);
    for (const b of pieceBoxes(p.type)) {
      const x = p.wx + b.x * c + b.z * s, z = p.wz - b.x * s + b.z * c;
      p.cols.push(this.game.physics.add({ type: 'box', x, y: p.wy + b.y, z, hx: b.hx, hy: b.hy, hz: b.hz, yaw: p.wyaw, ref: p, tag: 'piece' }));
    }
    if (p.door) this._buildDoorVisual(p);
  }
  _buildDoorVisual(p) {
    const d = p.door;
    if (d.mesh) this.group.remove(d.mesh);
    if (d.col) { this.game.physics.remove(d.col); d.col = null; }
    const hinge = new THREE.Group();
    const c = Math.cos(p.wyaw), s = Math.sin(p.wyaw);
    // hinge at the left edge of the opening
    const hx = -0.6;
    hinge.position.set(p.wx + hx * c, p.wy, p.wz - hx * s);
    hinge.rotation.y = p.wyaw + (d.open ? (d.flip ? -1 : 1) * Math.PI / 2 : 0);
    const m = this._parts(this.doorVisual(d.type), ['door', p]);
    m.position.set(0.6, 0, 0);
    hinge.add(m);
    if (d.lock) {
      for (const side of [1, -1]) { const lk = this._parts(this.lockVisual(d.lock.type), ['door', p]); lk.position.set(1.05, 1.15, 0.09 * side); lk.rotation.y = side > 0 ? 0 : Math.PI; hinge.add(lk); }
    }
    m.userData.door = p;
    this.group.add(hinge);
    d.mesh = hinge;
    if (!d.open) d.col = this.game.physics.add({ type: 'box', x: p.wx, y: p.wy + DOOR_BOX.y, z: p.wz, hx: 0.6, hy: 1.1, hz: 0.06, yaw: p.wyaw, ref: p, tag: 'door' });
  }

  removePiece(st, p, cause = 'destroyed') {
    if (!st.pieces.has(p.key)) return;
    st.pieces.delete(p.key);
    st.version++;
    this.pieceHash.remove(p);
    if (p.mesh) this.group.remove(p.mesh);
    for (const c of p.cols || []) this.game.physics.remove(c);
    if (p.door) { if (p.door.mesh) this.group.remove(p.door.mesh); if (p.door.col) this.game.physics.remove(p.door.col); }
    this.game.deploy.onPieceRemoved(p);
    this.game.events.emit('pieceDestroyed', { st, piece: p, cause });
    if (st.pieces.size === 0) {
      this.structures.delete(st.id);
      this.game.events.emit('structureGone', { st });
    }
  }

  // ---------- stability ----------
  computeStab(pieces, get) {
    // get(key) -> piece, over a map of pieces. Returns Map key->stab.
    const S = new Map();
    const byLevel = new Map();
    let maxK = 0;
    for (const p of pieces) { if (!byLevel.has(p.k)) byLevel.set(p.k, []); byLevel.get(p.k).push(p); maxK = Math.max(maxK, p.k); }
    const st = (key) => S.get(key) || 0;
    for (let k = 0; k <= maxK + 1; k++) {
      const L = byLevel.get(k) || [];
      // cells at this level
      const cells = L.filter(p => p.type === 'foundation' || p.type === 'floor' || p.type === 'roof');
      for (const p of cells) {
        if (p.type === 'foundation') { S.set(p.key, 1); continue; }
        let best = 0;
        for (const ek of this.edgesOfCell(p.i, p.j, k - 1)) { const w = get(ek); if (w && PIECES[w.type].kind === 'edge') best = Math.max(best, st(ek) * (PIECES[w.type].full ? 1 : 0.85)); }
        S.set(p.key, best);
      }
      for (let pass = 0; pass < 4; pass++) for (const p of cells) {
        if (p.type !== 'floor') continue;
        let best = S.get(p.key);
        for (const [a, b] of [[p.i - 1, p.j], [p.i + 1, p.j], [p.i, p.j - 1], [p.i, p.j + 1]]) { const q = get(`c:${a},${b},${k}`); if (q && q.type === 'floor') best = Math.max(best, st(q.key) * 0.72); }
        S.set(p.key, best);
      }
      for (const p of L) if (p.type === 'stairs') S.set(p.key, st(`c:${p.i},${p.j},${k}`));
      for (const p of L) {
        if (PIECES[p.type].kind !== 'edge') continue;
        let best = 0;
        for (const [a, b] of this.cellsOfEdge(p.axis, p.i, p.j)) { const c = get(`c:${a},${b},${k}`); if (c && c.type !== 'roof') best = Math.max(best, st(c.key) * 0.95); }
        const below = get(`${p.axis}:${p.i},${p.j},${k - 1}`);
        if (below && PIECES[below.type].full) best = Math.max(best, st(below.key) * 0.92);
        S.set(p.key, best);
      }
    }
    return S;
  }
  estimateStability(st, spec) {
    const fake = { ...spec, key: this.keyOf(spec) };
    const list = [...st.pieces.values(), fake];
    const S = this.computeStab(list, k => (k === fake.key ? fake : st.pieces.get(k)));
    return S.get(fake.key) || 0;
  }
  recompute(st) {
    for (let guard = 0; guard < 20; guard++) {
      const S = this.computeStab([...st.pieces.values()], k => st.pieces.get(k));
      let collapsed = false;
      for (const p of [...st.pieces.values()]) {
        p.stab = S.get(p.key) || 0;
        if (p.stab < 0.05) { this.removePiece(st, p, 'collapse'); collapsed = true; }
      }
      if (!collapsed) break;
    }
  }

  // ---------- grades / repair / demolish ----------
  upgrade(surv, p, grade) {
    if (!this.alive(p)) return { ok: false, err: 'That piece is gone' };
    const st = this.structures.get(p.st);
    if (!st || grade <= p.grade || grade >= GRADES.length) return { ok: false, err: 'Cannot upgrade' };
    if (this.tcOf(st) && !this.isAuthed(surv.team, st)) return { ok: false, err: 'Building blocked' };
    if (this.game.now - p.lastHit < 20) return { ok: false, err: 'Recently damaged' };
    const cost = pieceCost(p.type, grade);
    if (!surv.inv.pay(cost)) return { ok: false, err: 'Not enough resources' };
    const frac = p.hp / p.maxHp;
    p.grade = grade; p.maxHp = pieceMaxHp(p.type, grade); p.hp = Math.max(1, p.maxHp * Math.max(frac, 0.5));
    this._buildPieceVisual(st, p);
    st.version++;
    this.game.events.emit('upgraded', { surv, st, piece: p });
    return { ok: true };
  }
  repair(surv, p) {
    if (!this.alive(p)) return { ok: false, err: 'That piece is gone' };
    if (p.hp >= p.maxHp) return { ok: false, err: 'Not damaged' };
    if (this.game.now - p.lastHit < 20) return { ok: false, err: 'Recently damaged' };
    const amount = Math.min(p.maxHp - p.hp, p.maxHp * 0.1);
    const full = pieceCost(p.type, p.grade), cost = {};
    for (const k in full) cost[k] = Math.max(1, Math.ceil(full[k] * (amount / p.maxHp) * 0.5));
    if (!surv.inv.pay(cost)) return { ok: false, err: 'Not enough resources' };
    p.hp += amount;
    return { ok: true };
  }
  canDemolish(surv, p) { const st = this.structures.get(p.st); return st && this.isAuthed(surv.team, st) && st.team === surv.team && this.game.now - p.placedAt < 600; }
  demolish(surv, p) { if (!this.canDemolish(surv, p)) return false; this.removePiece(this.structures.get(p.st), p, 'demolish'); this.recompute(this.structures.get(p.st) || { pieces: new Map() }); return true; }
  rotate(surv, p) {
    if (p.type !== 'stairs' || !this.canDemolish(surv, p)) return false;
    const st = this.structures.get(p.st);
    p.rot = (p.rot + 1) % 4;
    const f = this.frame(p); p.wyaw = st.yaw + f.yaw;
    this._buildPieceVisual(st, p);
    return true;
  }

  // ---------- damage ----------
  damagePiece(p, amount, type, attacker) {
    const st = this.structures.get(p.st);
    if (!st || !st.pieces.has(p.key)) return 0;
    const mult = (STRUCT_DMG[type] || STRUCT_DMG.melee)[p.grade];
    const dmg = amount * mult;
    p.hp -= dmg; p.lastHit = this.game.now;
    this.game.events.emit('structureHit', { st, piece: p, attacker, dmg, type });
    if (p.hp <= 0) { this.removePiece(st, p, 'destroyed'); this.recompute(st); }
    return dmg;
  }
  damageDoor(p, amount, type, attacker) {
    const d = p.door; if (!d) return 0;
    const st = this.structures.get(p.st);
    const dmg = amount * (DOORS[d.type].dmg[type] || 0);
    d.hp -= dmg;
    this.game.events.emit('structureHit', { st, piece: p, attacker, dmg, type, door: true });
    if (d.hp <= 0) { this.removeDoor(p); this.game.events.emit('doorDestroyed', { st, piece: p, attacker }); }
    return dmg;
  }

  // ---------- doors + locks ----------
  alive(p) { const st = p && this.structures.get(p.st); return !!(st && st.pieces.get(p.key) === p); }
  placeDoor(surv, p, doorType, opts = {}) {
    if (!this.alive(p)) return { ok: false, err: 'That piece is gone' };
    if (p.type !== 'doorway' || p.door) return { ok: false, err: 'Needs an empty doorway' };
    const st = this.structures.get(p.st);
    if (this.tcOf(st) && !this.isAuthed(surv.team, st)) return { ok: false, err: 'Building blocked' };
    if (!opts.free && !surv.inv.remove(doorType, 1)) return { ok: false, err: 'No door' };
    p.door = { type: doorType, hp: DOORS[doorType].hp, maxHp: DOORS[doorType].hp, open: false, lock: null, flip: !!opts.flip, owner: surv.team };
    this._buildDoorVisual(p);
    st.version++;
    this.game.events.emit('doorPlaced', { surv, st, piece: p });
    return { ok: true };
  }
  // Hammer pickup of a door (and its lock).
  pickupDoor(surv, p) {
    const d = p.door; if (!d) return { ok: false, err: 'No door' };
    const st = this.structures.get(p.st);
    if (this.tcOf(st) && !this.isAuthed(surv.team, st)) return { ok: false, err: 'You need building privilege' };
    if (!this.tcOf(st) && st.team !== surv.team) return { ok: false, err: 'This isn\'t yours' };
    if (!this.canOpen(surv.team, p)) return { ok: false, err: 'It\'s locked' };
    this.removeDoor(p);
    surv.inv.give(d.type, 1);
    if (d.lock) surv.inv.give(d.lock.type === 'code' ? 'code_lock' : 'key_lock', 1);
    return { ok: true };
  }
  removeDoor(p) {
    const d = p.door; if (!d) return;
    if (d.mesh) this.group.remove(d.mesh);
    if (d.col) this.game.physics.remove(d.col);
    p.door = null;
    const st = this.structures.get(p.st); if (st) st.version++;
  }
  // lockType: 'key_lock' | 'code_lock'
  placeLock(surv, p, lockType, code) {
    if (!this.alive(p)) return { ok: false, err: 'That piece is gone' };
    const d = p.door;
    if (!d || d.lock) return { ok: false, err: 'Needs a door without a lock' };
    if (!surv.inv.remove(lockType, 1)) return { ok: false, err: 'No lock' };
    d.lock = lockType === 'code_lock' ? { type: 'code', code: code || String(Math.floor(1000 + Math.random() * 9000)), auth: [surv.team] } : { type: 'key', auth: [surv.team] };
    this._buildDoorVisual(p);
    return { ok: true, code: d.lock.code };
  }
  canOpen(team, p) { const d = p.door; if (!d) return true; if (!d.lock) return true; return d.lock.auth.includes(team); }
  tryCode(team, p, code) { const d = p.door; if (!d || !d.lock || d.lock.type !== 'code') return false; if (d.lock.code === code) { if (!d.lock.auth.includes(team)) d.lock.auth.push(team); return true; } return false; }
  toggleDoor(team, p, force) {
    const d = p.door; if (!d) return false;
    if (!this.canOpen(team, p) && !force) return false;
    d.open = !d.open;
    this._buildDoorVisual(p);
    this.game.events.emit('doorToggled', { piece: p, open: d.open });
    return true;
  }
  setDoor(team, p, open) { if (p.door && p.door.open !== open) return this.toggleDoor(team, p); return true; }

  // ---------- upkeep + decay ----------
  upkeepPerHour(st) {
    const out = {};
    for (const p of st.pieces.values()) { const u = pieceUpkeep(p.type, p.grade); for (const k in u) out[k] = (out[k] || 0) + u[k]; }
    return out;
  }
  // hours of protection the cabinet's contents give
  upkeepHours(st) {
    const tc = this.tcOf(st); if (!tc) return 0;
    const u = this.upkeepPerHour(st);
    let h = Infinity;
    for (const k in u) h = Math.min(h, tc.cont.count(k) / u[k]);
    return h === Infinity ? 0 : h;
  }
  tickDecay(hours) {
    if (hours <= 0) return;
    for (const st of [...this.structures.values()]) {
      const tc = this.tcOf(st);
      let paid = false;
      if (tc) {
        const u = this.upkeepPerHour(st);
        st.upkeepDebt = st.upkeepDebt || {};
        paid = true;
        for (const k in u) { st.upkeepDebt[k] = (st.upkeepDebt[k] || 0) + u[k] * hours; if (tc.cont.count(k) < Math.floor(st.upkeepDebt[k])) paid = false; }
        if (paid) for (const k in st.upkeepDebt) { const n = Math.floor(st.upkeepDebt[k]); if (n > 0) { tc.cont.remove(k, n); st.upkeepDebt[k] -= n; } }
      }
      st.decaying = !paid;
      if (paid) continue;
      const fast = this.game.world.monumentAt(st.ox, st.oz, 14) ? 8 : 1;   // walls at monuments are for fights
      for (const p of [...st.pieces.values()]) {
        p.hp -= p.maxHp * hours * fast / GRADES[p.grade].decayHours;
        if (p.hp <= 0) this.removePiece(st, p, 'decay');
      }
      if (this.structures.has(st.id)) this.recompute(st);
    }
  }

  // ---------- aiming (player) ----------
  // From a hit point, find the best slot for a piece type. Returns spec or null.
  specFromAim(surv, type, hit, rot = 0) {
    const P = PIECES[type];
    const st = this.structureNear(hit.x, hit.z, 9);
    if (!st) {
      if (type !== 'foundation') return null;
      const yaw = surv.yaw;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const top = this._foundationTop(hit.x, hit.z, yaw);
      const ox = hit.x - (1.5 * c + 1.5 * s), oz = hit.z - (-1.5 * s + 1.5 * c);
      return { type, i: 0, j: 0, k: 0, newSt: { ox, oy: top - FOUND_H, oz, yaw } };
    }
    const L = this.toLocal(st, hit.x, hit.y, hit.z);
    const ci = Math.floor(L.x / CELL), cj = Math.floor(L.z / CELL);
    const cands = [[ci, cj], [ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]];
    const score = (i, j) => Math.hypot((i + 0.5) * CELL - L.x, (j + 0.5) * CELL - L.z);
    let best = null, bs = Infinity;
    const tryOne = (spec, sc) => { if (sc < bs && !this.check(surv.team, spec)) { bs = sc; best = spec; } };
    if (type === 'foundation') {
      for (const [i, j] of cands) tryOne({ st: st.id, type, i, j, k: 0 }, score(i, j));
      if (!best) best = { st: st.id, type, i: cands[1][0], j: cands[1][1], k: 0, invalid: true };
      for (const [i, j] of cands) if (!st.pieces.has(`c:${i},${j},0`)) { if (!best || best.invalid) best = { st: st.id, type, i, j, k: 0 }; break; }
      return best;
    }
    if (P.kind === 'cell') {
      const k = type === 'stairs' ? Math.max(0, Math.round((L.y - FOUND_H) / LEVEL_H)) : Math.max(1, Math.round((L.y - FOUND_H) / LEVEL_H));
      for (const [i, j] of cands) for (const kk of [k, k + 1, k - 1]) { if (kk < (type === 'stairs' ? 0 : 1)) continue; tryOne({ st: st.id, type, i, j, k: kk, rot }, score(i, j) + Math.abs(kk - k) * 3); }
      return best || { st: st.id, type, i: ci, j: cj, k, rot, invalid: true };
    }
    // edges
    const k = Math.max(0, Math.floor((L.y - FOUND_H + 0.2) / LEVEL_H));
    const edgeList = [];
    for (const [i, j] of cands.slice(0, 1).concat(cands.slice(1))) {
      edgeList.push({ axis: 'x', i, j, mx: i * CELL, mz: (j + 0.5) * CELL });
      edgeList.push({ axis: 'x', i: i + 1, j, mx: (i + 1) * CELL, mz: (j + 0.5) * CELL });
      edgeList.push({ axis: 'z', i, j, mx: (i + 0.5) * CELL, mz: j * CELL });
      edgeList.push({ axis: 'z', i, j: j + 1, mx: (i + 0.5) * CELL, mz: (j + 1) * CELL });
    }
    for (const e of edgeList) for (const kk of [k, k - 1, k + 1]) {
      if (kk < 0) continue;
      tryOne({ st: st.id, type, i: e.i, j: e.j, k: kk, axis: e.axis }, Math.hypot(e.mx - L.x, e.mz - L.z) + Math.abs(kk - k) * 2);
    }
    if (best) return best;
    const e = edgeList.sort((a, b) => Math.hypot(a.mx - L.x, a.mz - L.z) - Math.hypot(b.mx - L.x, b.mz - L.z))[0];
    return { st: st.id, type, i: e.i, j: e.j, k, axis: e.axis, invalid: true };
  }
  _foundationTop(x, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let mx = -Infinity;
    for (const [a, b] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4], [0, 0]]) mx = Math.max(mx, this.game.world.heightAt(x + a * c + b * s, z - a * s + b * c));
    return mx + 0.25;
  }
  // World transform for a spec (ghost preview + bots)
  specTransform(spec) {
    const st = spec.st ? this.structures.get(spec.st) : this._tmpStructure(spec.newSt);
    const f = this.frame(spec);
    const w = this.toWorld(st, f.lx, f.ly, f.lz);
    return { x: w.x, y: w.y, z: w.z, yaw: st.yaw + f.yaw };
  }

  // ---------- save/load ----------
  serialize() {
    const out = [];
    for (const st of this.structures.values()) {
      out.push({
        id: st.id, ox: st.ox, oy: st.oy, oz: st.oz, yaw: st.yaw, team: st.team, tc: st.tc, created: st.created, debt: st.upkeepDebt || null,
        pieces: [...st.pieces.values()].map(p => ({ id: p.id, type: p.type, i: p.i, j: p.j, k: p.k, axis: p.axis, rot: p.rot, grade: p.grade, hp: Math.round(p.hp * 10) / 10, placedAt: p.placedAt,
          door: p.door ? { type: p.door.type, hp: p.door.hp, maxHp: p.door.maxHp, open: p.door.open, lock: p.door.lock, flip: p.door.flip, owner: p.door.owner } : null })),
      });
    }
    return out;
  }
  load(arr) {
    for (const s of arr || []) {
      const st = this.createStructure({ ox: s.ox, oy: s.oy, oz: s.oz, yaw: s.yaw }, s.team, s.id);
      st.tc = s.tc; st.created = s.created; st.upkeepDebt = s.debt || {};
      for (const p of s.pieces) {
        const door = p.door;
        const piece = this._addPiece(st, { ...p, door: null });
        piece.hp = p.hp;
        if (door) { piece.door = { ...door }; this._buildDoorVisual(piece); }
      }
      this.recompute(st);
    }
  }
}

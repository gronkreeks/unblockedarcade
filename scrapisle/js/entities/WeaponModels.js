// Detailed weapon, tool and item models built from bevelled and lathed parts with PBR materials.
// Frame: origin at the right-hand grip, -Z is forward (muzzle), +Y up. Moving parts are named so the
// first-person and third-person animators can drive them: mag, bolt, slide, pump, cylinder, hammer,
// barrels, string, arrow, muzzle (empty marker), lh (left hand marker), sight (eye height above origin).
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';

let M = null; // material library, set by setMaterials
export function setMaterials(m) { M = m; }
const geoCache = new Map();
const mat = (k, c) => M.get(k, c !== undefined ? { color: c } : {});

// Bevelled box centred on its middle, depth along Z.
function bbox(w, h, d, r = 0.004) {
  const key = `b${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${r}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const rr = Math.min(r, w / 2.2, h / 2.2);
  const s = new THREE.Shape();
  const x = -w / 2 + rr, y = -h / 2 + rr, W = w - rr * 2, H = h - rr * 2;
  s.moveTo(x, y); s.lineTo(x + W, y); s.lineTo(x + W, y + H); s.lineTo(x, y + H); s.lineTo(x, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - rr * 2), bevelEnabled: true, bevelThickness: rr, bevelSize: rr, bevelSegments: 2, curveSegments: 2 });
  g.translate(0, 0, -(d - rr * 2) / 2);
  scaleUV(g, 4);
  geoCache.set(key, g);
  return g;
}
function cyl(r1, r2, len, seg = 14) {
  const key = `c${r1},${r2},${len},${seg}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1);
  g.rotateX(-Math.PI / 2); // along -Z: r1 at back (+z), r2 at front
  scaleUV(g, 3);
  geoCache.set(key, g);
  return g;
}
function lathe(profile, seg = 16) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  scaleUV(g, 2);
  return g;
}
function extrudeProfile(pts, depth, bevel = 0.002) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.lineTo(pts[0][0], pts[0][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  scaleUV(g, 4);
  return g;
}
function scaleUV(g, k) { const uv = g.attributes.uv; if (!uv) return; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k); }

function part(geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}
function marker(name, x, y, z) { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); return o; }
function finish(g, info) {
  g.userData.weapon = info;
  g.traverse(o => { if (o.name) info.parts[o.name] = o; });
  for (const k of ['muzzle', 'lh']) if (!info.parts[k]) { const m = marker(k, 0, 0.04, k === 'muzzle' ? -0.5 : -0.25); g.add(m); info.parts[k] = m; }
  return g;
}

// ---------- guns ----------
function rifleBase(g, o) {
  const metal = mat('gunmetal'), poly = mat('polymer'), wood = mat('gunwood');
  const L = o.receiver || 0.24;
  g.add(part(bbox(0.045, 0.06, L, 0.006), metal, 0, 0.045, -L / 2 + 0.03));
  g.add(part(bbox(0.04, 0.02, L * 0.9, 0.006), metal, 0, 0.083, -L / 2 + 0.02)); // top cover
  // pistol grip
  if (o.grip !== false) g.add(part(extrudeProfile([[-0.016, 0.02], [0.018, 0.02], [0.03, -0.075], [0.0, -0.08], [-0.02, -0.06]], 0.032), o.gripMat || poly, 0, 0, 0.01, 0, Math.PI / 2, 0));
  // trigger guard
  g.add(part(bbox(0.006, 0.006, 0.06, 0.002), metal, 0, 0.005, -0.03));
  // barrel + handguard
  const bl = o.barrel || 0.36;
  g.add(part(cyl(0.011, 0.01, bl, 12), metal, 0, 0.055, -L - bl / 2 + 0.03));
  if (o.handguard !== false) g.add(part(bbox(0.052, 0.05, o.hgLen || 0.18, 0.01), o.hgMat || wood, 0, 0.045, -L - (o.hgLen || 0.18) / 2 + 0.03));
  // stock
  const S = (m) => { m.name = 'stock'; return m; };
  if (o.stock === 'wood') g.add(S(part(extrudeProfile([[0, 0.07], [0.24, 0.06], [0.26, -0.035], [0.22, -0.045], [0, 0.02]], 0.038, 0.004), wood, 0, 0.01, 0.06, 0, -Math.PI / 2, 0)));
  if (o.stock === 'poly') g.add(S(part(extrudeProfile([[0, 0.07], [0.22, 0.065], [0.23, -0.03], [0.2, -0.04], [0.05, 0.03], [0, 0.03]], 0.036, 0.004), poly, 0, 0.01, 0.06, 0, -Math.PI / 2, 0)));
  if (o.stock === 'wire') { for (const y of [0.06, 0.0]) g.add(S(part(cyl(0.004, 0.004, 0.22, 6), metal, 0, y, 0.15))); g.add(S(part(bbox(0.03, 0.08, 0.012), metal, 0, 0.03, 0.26))); }
  // sights
  g.add(part(bbox(0.003, 0.024, 0.004, 0.001), metal, 0, 0.1, -L - bl + 0.06));
  for (const x of [-0.007, 0.007]) g.add(part(bbox(0.004, 0.014, 0.008, 0.001), metal, x, 0.1, -0.02));
  g.add(marker('muzzle', 0, 0.055, -L - bl + 0.02));
  g.add(marker('lh', 0, 0.02, -L - 0.06));
  return { L, bl };
}
function curvedMag(n, len = 0.12, curve = 0.5, material) {
  const g = new THREE.Group(); g.name = 'mag';
  for (let i = 0; i < n; i++) { const t = i / n; const seg = part(bbox(0.024, len / n + 0.004, 0.05, 0.003), material, 0, -t * len, -t * t * curve * 0.06, t * curve * 0.6, 0, 0); g.add(seg); }
  return g;
}
const GUNS = {
  assault_rifle(g) {
    const b = rifleBase(g, { receiver: 0.26, barrel: 0.38, stock: 'wood', hgLen: 0.2 });
    const metal = mat('gunmetal');
    g.add(part(cyl(0.008, 0.008, 0.2, 8), metal, 0, 0.083, -b.L - 0.08)); // gas tube
    g.add(part(cyl(0.016, 0.016, 0.06, 10), metal, 0, 0.055, -b.L - b.bl + 0.0)); // muzzle brake
    const mag = curvedMag(5, 0.15, 0.8, mat('gunmetal')); mag.position.set(0, 0.02, -0.1); g.add(mag);
    const bolt = part(bbox(0.012, 0.012, 0.03, 0.003), metal, 0.03, 0.07, -0.12); bolt.name = 'bolt'; g.add(bolt);
    return { sight: 0.104, auto: true };
  },
  semi_rifle(g) {
    const b = rifleBase(g, { receiver: 0.22, barrel: 0.4, stock: 'wood', hgLen: 0.24 });
    const mag = part(bbox(0.024, 0.075, 0.045, 0.004), mat('gunmetal'), 0, -0.012, -0.09, 0.15); mag.name = 'mag'; g.add(mag);
    const bolt = part(bbox(0.012, 0.012, 0.03, 0.003), mat('gunmetal'), 0.028, 0.07, -0.1); bolt.name = 'bolt'; g.add(bolt);
    return { sight: 0.104 };
  },
  bolt_rifle(g) {
    const b = rifleBase(g, { receiver: 0.24, barrel: 0.5, stock: 'wood', hgLen: 0.36, hgMat: mat('gunwood') });
    const metal = mat('gunmetal');
    // scope
    const sc = new THREE.Group(); sc.position.set(0, 0.13, -0.12);
    sc.add(part(cyl(0.018, 0.018, 0.22, 16), metal));
    sc.add(part(cyl(0.022, 0.026, 0.05, 16), metal, 0, 0, -0.13));
    sc.add(part(cyl(0.022, 0.022, 0.04, 16), metal, 0, 0, 0.12));
    sc.add(part(cyl(0.017, 0.017, 0.004, 16), mat('glass'), 0, 0, 0.142));
    for (const z of [-0.06, 0.06]) sc.add(part(bbox(0.012, 0.03, 0.012), metal, 0, -0.025, z));
    g.add(sc);
    const bolt = new THREE.Group(); bolt.name = 'bolt'; bolt.position.set(0.0, 0.07, -0.03);
    bolt.add(part(cyl(0.008, 0.008, 0.08, 10), metal, 0, 0, 0)); bolt.add(part(cyl(0.004, 0.004, 0.05, 8), metal, 0.03, -0.01, 0.02, 0, Math.PI / 2, 0)); bolt.add(part(new THREE.SphereGeometry(0.009, 10, 8), metal, 0.055, -0.01, 0.02));
    g.add(bolt);
    const mag = part(bbox(0.02, 0.03, 0.06, 0.004), metal, 0, 0.0, -0.1); mag.name = 'mag'; g.add(mag);
    return { sight: 0.13, scope: true };
  },
  drum_smg(g) {
    const metal = mat('gunmetal'), wood = mat('gunwood');
    const b = rifleBase(g, { receiver: 0.22, barrel: 0.26, stock: 'wood', handguard: false, gripMat: wood });
    for (let i = 0; i < 8; i++) g.add(part(cyl(0.017, 0.017, 0.008, 12), metal, 0, 0.055, -0.25 - i * 0.018)); // cooling fins
    g.add(part(extrudeProfile([[-0.015, 0.0], [0.015, 0.0], [0.02, -0.08], [-0.01, -0.085]], 0.03), wood, 0, 0.02, -0.26, 0, Math.PI / 2, 0)); // fore grip
    const drum = new THREE.Group(); drum.name = 'mag'; drum.position.set(0, -0.03, -0.12);
    const d = part(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 22), metal, 0, -0.03, 0, 0, 0, Math.PI / 2); drum.add(d);
    drum.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.045, 10), mat('polymer'), 0, -0.03, 0, 0, 0, Math.PI / 2));
    g.add(drum);
    const bolt = part(bbox(0.012, 0.012, 0.025, 0.003), metal, 0, 0.09, -0.1); bolt.name = 'bolt'; g.add(bolt);
    g.getObjectByName('lh').position.set(0, -0.04, -0.27);
    return { sight: 0.104, auto: true };
  },
  scrap_smg(g) {
    const rust = mat('rust'), metal = mat('metal');
    rifleBase(g, { receiver: 0.2, barrel: 0.2, stock: 'wire', handguard: false, gripMat: rust });
    g.children[0].material = rust; g.children[1].material = rust;
    for (let i = 0; i < 5; i++) g.add(part(cyl(0.016, 0.016, 0.012, 10), metal, 0, 0.055, -0.22 - i * 0.03)); // pipe shroud rings
    g.add(part(cyl(0.015, 0.015, 0.16, 10), rust, 0, 0.055, -0.3));
    const mag = part(bbox(0.022, 0.13, 0.035, 0.003), metal, 0, -0.04, -0.09, 0.05); mag.name = 'mag'; g.add(mag);
    const bolt = part(bbox(0.01, 0.014, 0.025, 0.003), metal, 0.03, 0.07, -0.08); bolt.name = 'bolt'; g.add(bolt);
    return { sight: 0.104, auto: true };
  },
  semi_pistol(g) {
    const poly = mat('polymer'), metal = mat('gunmetal');
    g.add(part(extrudeProfile([[-0.015, 0.03], [0.02, 0.03], [0.03, -0.075], [0.0, -0.08], [-0.02, -0.06]], 0.03), poly, 0, 0, 0.005, 0, Math.PI / 2, 0));
    g.add(part(bbox(0.03, 0.025, 0.16, 0.004), poly, 0, 0.03, -0.06));
    const slide = part(bbox(0.032, 0.03, 0.18, 0.004), metal, 0, 0.058, -0.065); slide.name = 'slide'; g.add(slide);
    slide.add(part(bbox(0.004, 0.008, 0.004), metal, 0, 0.018, -0.08));
    slide.add(part(bbox(0.016, 0.008, 0.006), metal, 0, 0.018, 0.08));
    const mag = part(bbox(0.02, 0.08, 0.03, 0.003), metal, 0, -0.03, 0.01, 0.2); mag.name = 'mag'; g.add(mag);
    g.add(marker('muzzle', 0, 0.058, -0.16)); g.add(marker('lh', -0.012, -0.03, 0.0));
    return { sight: 0.08, pistol: true };
  },
  revolver(g) {
    const metal = mat('gunmetal'), wood = mat('gunwood');
    g.add(part(extrudeProfile([[-0.014, 0.02], [0.018, 0.02], [0.03, -0.07], [0.005, -0.08], [-0.02, -0.05]], 0.03), wood, 0, 0, 0.012, 0, Math.PI / 2, 0));
    g.add(part(bbox(0.028, 0.045, 0.07, 0.006), metal, 0, 0.04, -0.02));
    g.add(part(cyl(0.008, 0.008, 0.15, 12), metal, 0, 0.06, -0.12));
    g.add(part(bbox(0.012, 0.012, 0.14, 0.003), metal, 0, 0.072, -0.12));
    const cy = new THREE.Group(); cy.name = 'cylinder'; cy.position.set(0, 0.045, -0.04);
    const c = part(new THREE.CylinderGeometry(0.02, 0.02, 0.045, 6), metal); c.rotation.x = Math.PI / 2; cy.add(c);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cy.add(part(cyl(0.005, 0.005, 0.046, 8), mat('polymer'), Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0)); }
    g.add(cy);
    const hm = part(bbox(0.008, 0.02, 0.012, 0.002), metal, 0, 0.065, 0.02); hm.name = 'hammer'; g.add(hm);
    g.add(marker('muzzle', 0, 0.06, -0.2)); g.add(marker('lh', -0.012, -0.03, 0.0));
    return { sight: 0.082, pistol: true };
  },
  pipe_pistol(g) {
    const wood = mat('wood'), rust = mat('rust'), cloth = mat('cloth', 0x6b6050);
    g.add(part(bbox(0.035, 0.1, 0.05, 0.008), wood, 0, -0.03, 0.0, 0.25));
    g.add(part(cyl(0.017, 0.017, 0.22, 12), rust, 0, 0.04, -0.09));
    for (const z of [-0.04, -0.12]) g.add(part(cyl(0.02, 0.02, 0.025, 12), cloth, 0, 0.04, z));
    const fl = part(bbox(0.02, 0.012, 0.04, 0.003), mat('metal'), 0.02, 0.06, 0.0); fl.name = 'hammer'; g.add(fl);
    g.add(marker('muzzle', 0, 0.04, -0.21)); g.add(marker('lh', -0.01, 0.0, -0.08));
    return { sight: 0.07, pistol: true };
  },
  double_barrel(g) {
    const metal = mat('gunmetal'), wood = mat('gunwood');
    const stk = part(extrudeProfile([[0, 0.05], [0.28, 0.05], [0.3, -0.05], [0.25, -0.06], [0.02, -0.01]], 0.04, 0.004), wood, 0, 0.01, 0.05, 0, -Math.PI / 2, 0); stk.name = 'stock'; g.add(stk);
    g.add(part(bbox(0.05, 0.05, 0.08, 0.006), metal, 0, 0.04, -0.02));
    const br = new THREE.Group(); br.name = 'barrels'; br.position.set(0, 0.05, -0.06);
    for (const x of [-0.013, 0.013]) br.add(part(cyl(0.013, 0.013, 0.48, 14), metal, x, 0.01, -0.24));
    br.add(part(bbox(0.05, 0.03, 0.22, 0.008), wood, 0, -0.018, -0.12));
    br.add(marker('muzzle', 0, 0.01, -0.48));
    g.add(br);
    g.add(marker('lh', 0, 0.0, -0.18));
    return { sight: 0.08 };
  },
  pump_shotgun(g) {
    const metal = mat('gunmetal'), poly = mat('polymer');
    rifleBase(g, { receiver: 0.2, barrel: 0.44, stock: 'poly', handguard: false });
    g.add(part(cyl(0.012, 0.012, 0.36, 12), metal, 0, 0.028, -0.37)); // tube mag
    const pump = part(bbox(0.05, 0.045, 0.13, 0.012), poly, 0, 0.035, -0.32); pump.name = 'pump'; g.add(pump);
    for (let i = 0; i < 5; i++) pump.add(part(bbox(0.052, 0.004, 0.006), poly, 0, -0.015 + i * 0.008, 0));
    g.getObjectByName('lh').position.set(0, 0.01, -0.32);
    return { sight: 0.104 };
  },
  crossbow(g) {
    const wood = mat('wood'), metal = mat('metal');
    g.add(part(bbox(0.04, 0.05, 0.5, 0.008), wood, 0, 0.02, -0.18));
    g.add(part(extrudeProfile([[-0.015, 0.02], [0.018, 0.02], [0.03, -0.075], [0.0, -0.08], [-0.02, -0.06]], 0.032), wood, 0, 0, 0.01, 0, Math.PI / 2, 0));
    const prod = new THREE.Group(); prod.position.set(0, 0.04, -0.4);
    for (const s of [-1, 1]) prod.add(part(cyl(0.008, 0.006, 0.24, 8), metal, s * 0.11, 0, 0.02 * s * s, 0, s * 1.3, 0));
    g.add(prod);
    const str = part(cyl(0.002, 0.002, 0.42, 4), mat('flat', 0xdddddd), 0, 0.045, -0.3, 0, Math.PI / 2, 0); str.name = 'string'; g.add(str);
    const arrow = part(cyl(0.004, 0.004, 0.34, 6), wood, 0, 0.055, -0.22); arrow.name = 'arrow'; g.add(arrow);
    g.add(marker('muzzle', 0, 0.055, -0.42)); g.add(marker('lh', 0, 0.0, -0.3));
    return { sight: 0.09 };
  },
  hunting_bow(g) {
    const wood = mat('wood');
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.48, 0.06), new THREE.Vector3(0, 0, -0.12), new THREE.Vector3(0, -0.48, 0.06));
    g.add(part(new THREE.TubeGeometry(curve, 24, 0.011, 8), wood, 0, 0, -0.2));
    g.add(part(bbox(0.03, 0.09, 0.035, 0.008), mat('leather', 0x7a5130), 0, 0, -0.29));
    const str = new THREE.Group(); str.name = 'string'; str.position.set(0, 0, -0.14);
    const sgeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.48, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.48, 0)]);
    const line = new THREE.Line(sgeo, new THREE.LineBasicMaterial({ color: 0xdddddd })); line.name = 'stringLine'; str.add(line);
    g.add(str);
    const arrow = new THREE.Group(); arrow.name = 'arrow'; arrow.position.set(0, 0, -0.14);
    arrow.add(part(cyl(0.004, 0.004, 0.62, 6), wood, 0, 0, -0.31));
    arrow.add(part(new THREE.ConeGeometry(0.01, 0.04, 6).rotateX(-Math.PI / 2), mat('metal'), 0, 0, -0.64));
    for (let i = 0; i < 3; i++) arrow.add(part(bbox(0.002, 0.018, 0.06, 0.001), mat('flat', 0xc04040), 0, 0, 0.0, 0, 0, i * 2.1));
    g.add(arrow);
    g.add(marker('muzzle', 0, 0, -0.5)); g.add(marker('lh', 0, 0, -0.29));
    return { sight: 0.04, bow: true };
  },
};

// ---------- tools and melee ----------
function handle(g, len, material) { g.add(part(cyl(0.016, 0.013, len, 10), material || mat('wood'), 0, 0, -len / 2 + 0.06)); }
const TOOLS = {
  rock(g) { const r = new THREE.Mesh(rockGeo(), mat('rock')); r.scale.set(1.1, 0.85, 1); r.position.set(0, 0.03, -0.03); g.add(r); },
  torch(g) {
    handle(g, 0.45);
    g.add(part(cyl(0.028, 0.024, 0.08, 10), mat('cloth', 0x5a4a3a), 0, 0, -0.36));
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 8).rotateX(-Math.PI / 2), mat('emissive')); f.name = 'flame'; f.position.set(0, 0, -0.45); g.add(f);
  },
  stone_hatchet(g) { handle(g, 0.5); const h = new THREE.Mesh(rockGeo(), mat('rock')); h.scale.set(0.5, 0.9, 0.7); h.position.set(0, 0.04, -0.38); g.add(h); g.add(part(cyl(0.02, 0.02, 0.04, 8), mat('leather', 0x6b4a2e), 0, 0, -0.38)); },
  stone_pickaxe(g) { handle(g, 0.55); const h = new THREE.Mesh(rockGeo(), mat('rock')); h.scale.set(0.45, 0.45, 1.6); h.rotation.x = Math.PI / 2; h.position.set(0, 0.02, -0.43); g.add(h); g.add(part(cyl(0.02, 0.02, 0.04, 8), mat('leather', 0x6b4a2e), 0, 0, -0.43)); },
  hatchet(g) { handle(g, 0.48); g.add(part(extrudeProfile([[0, -0.02], [0.02, -0.02], [0.08, -0.06], [0.09, 0.05], [0.02, 0.025], [0, 0.025]], 0.012, 0.002), mat('metal'), 0, 0, -0.38, Math.PI / 2, 0, -Math.PI / 2)); },
  pickaxe(g) { handle(g, 0.55); const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.12, 0.02), new THREE.Vector3(0, 0, -0.03), new THREE.Vector3(0, 0.12, 0.02)); g.add(part(new THREE.TubeGeometry(c, 10, 0.012, 6), mat('metal'), 0, 0, -0.43)); },
  salvaged_axe(g) { handle(g, 0.55, mat('metal')); g.add(part(extrudeProfile([[0, -0.03], [0.03, -0.03], [0.12, -0.08], [0.13, 0.08], [0.03, 0.03], [0, 0.03]], 0.008, 0.002), mat('paint', 0xd9b84a), 0, 0, -0.42, Math.PI / 2, 0, -Math.PI / 2)); },
  salvaged_icepick(g) { handle(g, 0.55, mat('metal')); g.add(part(extrudeProfile([[-0.13, -0.01], [0.0, -0.025], [0.13, -0.01], [0.0, 0.025]], 0.02, 0.002), mat('paint', 0xd9b84a), 0, 0, -0.45, Math.PI / 2, 0, 0)); },
  hammer(g) { handle(g, 0.36); g.add(part(bbox(0.035, 0.03, 0.1, 0.004), mat('metal'), 0, 0, -0.3, 0, Math.PI / 2, 0)); },
  wooden_spear(g) { g.add(part(cyl(0.014, 0.012, 1.5, 8), mat('wood'), 0, 0, -0.5)); g.add(part(new THREE.ConeGeometry(0.014, 0.12, 8).rotateX(-Math.PI / 2), mat('wood'), 0, 0, -1.3)); },
  stone_spear(g) { TOOLS.wooden_spear(g); const h = new THREE.Mesh(rockGeo(), mat('rock')); h.scale.set(0.25, 0.25, 0.9); h.position.set(0, 0, -1.32); g.add(h); },
  bone_knife(g) { g.add(part(cyl(0.015, 0.015, 0.1, 8), mat('leather', 0x6b4a2e), 0, 0, 0.0)); g.add(part(extrudeProfile([[0, -0.012], [0.16, -0.004], [0.18, 0.0], [0, 0.012]], 0.008, 0.001), mat('flat', 0xece6d6), 0, 0, -0.06, 0, Math.PI / 2, 0)); },
  machete(g) { g.add(part(cyl(0.016, 0.016, 0.12, 8), mat('polymer'), 0, 0, 0.0)); g.add(part(extrudeProfile([[0, -0.02], [0.36, -0.01], [0.4, 0.02], [0.0, 0.02]], 0.004, 0.001), mat('metal'), 0, 0, -0.06, 0, Math.PI / 2, 0)); },
  salvaged_sword(g) { g.add(part(cyl(0.016, 0.016, 0.14, 8), mat('cloth', 0x3a3a3a), 0, 0, 0.0)); g.add(part(bbox(0.12, 0.02, 0.02), mat('metal'), 0, 0, -0.08)); g.add(part(extrudeProfile([[0, -0.03], [0.5, -0.025], [0.56, 0.0], [0.0, 0.03]], 0.006, 0.001), mat('paint', 0xb0a080), 0, 0, -0.09, 0, Math.PI / 2, 0)); },
  building_plan(g) { g.add(part(bbox(0.2, 0.004, 0.26, 0.001), mat('flat', 0xd8e4f0), 0, 0, -0.12, 0.9)); },
  satchel_charge(g) { g.add(part(bbox(0.16, 0.12, 0.1, 0.02), mat('cloth', 0x8a6a3a), 0, 0, -0.1)); g.add(part(cyl(0.004, 0.004, 0.12, 6), mat('flat', 0xdddddd), 0.05, 0.08, -0.1, 0.8)); },
  timed_charge(g) { g.add(part(bbox(0.16, 0.08, 0.1, 0.006), mat('paint', 0xb03a2e), 0, 0, -0.1)); g.add(part(bbox(0.06, 0.03, 0.04, 0.003), mat('polymer'), 0, 0.055, -0.1)); },
};
let _rockGeo = null;
function rockGeo() {
  if (_rockGeo) return _rockGeo;
  const g = new THREE.IcosahedronGeometry(0.08, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 0.85 + 0.25 * Math.sin(x * 61 + y * 37) * Math.cos(z * 53); p.setXYZ(i, x * k, y * k, z * k); }
  g.computeVertexNormals();
  return (_rockGeo = g);
}

// Build a model for any item id. Returns a Group with userData.weapon = { id, parts, sight, ... }.
export function buildItemModel(id) {
  const d = ITEMS[id];
  const g = new THREE.Group();
  const info = { id, parts: {}, sight: 0.08 };
  if (!d) return finish(g, info);
  if (GUNS[id]) Object.assign(info, GUNS[id](g) || {});
  else if (TOOLS[id]) TOOLS[id](g);
  else {
    // consumables / deployables held in hand: a small box tinted by the item colour
    const col = new THREE.Color(d.color || '#888').getHex();
    const k = d.type === 'food' || d.type === 'med' ? 'paint' : d.type === 'deploy' ? 'wood' : 'paint';
    g.add(part(bbox(0.08, 0.08, 0.1, 0.01), mat(k, col), 0, 0, -0.06));
  }
  info.isGun = !!GUNS[id];
  return finish(g, info);
}

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
  rocket_launcher(g) {
    const tube = mat('flat', 0x4f5a3c), dark = mat('gunmetal');
    g.add(part(cyl(0.045, 0.045, 0.9, 16), tube, 0, 0.06, -0.25));
    g.add(part(cyl(0.055, 0.05, 0.08, 16), dark, 0, 0.06, -0.72));
    g.add(part(cyl(0.06, 0.055, 0.07, 16), dark, 0, 0.06, 0.2));
    g.add(part(bbox(0.02, 0.09, 0.04), dark, 0, -0.03, -0.05));
    g.add(part(bbox(0.02, 0.08, 0.035), dark, 0, -0.02, -0.3));
    g.add(part(bbox(0.012, 0.03, 0.05), dark, -0.05, 0.12, -0.15));
    const tip = part(new THREE.ConeGeometry(0.03, 0.08, 12).rotateX(-Math.PI / 2), mat('flat', 0xb03a2e), 0, 0.06, -0.74); tip.name = 'mag'; g.add(tip);
    g.add(marker('muzzle', 0, 0.06, -0.72));
    return { sight: 0.12 };
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
  building_plan(g) {
    // a rolled-open blueprint: blue sheet with white lines
    const sh = new THREE.Group(); sh.position.set(0, 0, -0.12); sh.rotation.x = 0.9; g.add(sh);
    sh.add(part(bbox(0.2, 0.004, 0.26, 0.001), mat('flat', 0x2f5f9a)));
    const ln = mat('flat', 0xe8f0f8);
    for (const z of [-0.08, 0, 0.08]) sh.add(part(bbox(0.16, 0.001, 0.004, 0.0005), ln, 0, 0.003, z));
    for (const x of [-0.06, 0.04]) sh.add(part(bbox(0.004, 0.001, 0.2, 0.0005), ln, x, 0.003, 0));
    for (const z of [0.13, -0.13]) sh.add(part(cyl(0.008, 0.008, 0.21, 10), mat('flat', 0x2f5f9a), 0, 0.004, z, 0, Math.PI / 2, 0));
  },
  satchel_charge(g) { g.add(part(bbox(0.16, 0.12, 0.1, 0.02), mat('cloth', 0x8a6a3a), 0, 0, -0.1)); g.add(part(cyl(0.004, 0.004, 0.12, 6), mat('flat', 0xdddddd), 0.05, 0.08, -0.1, 0.8)); },
  timed_charge(g) { g.add(part(bbox(0.16, 0.08, 0.1, 0.006), mat('flat', 0xb03a2e), 0, 0, -0.1)); g.add(part(bbox(0.06, 0.03, 0.04, 0.003), mat('polymer'), 0, 0.055, -0.1)); },
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

// ---------- everything else: one model per icon type, tinted by the item's colour ----------
const hex = (d, fb = '#888888') => new THREE.Color(d.color || fb).getHex();
const sph = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const ITEM_MODELS = {
  log(g) { g.add(part(cyl(0.045, 0.045, 0.32, 12), mat('bark'), 0, 0, -0.1)); for (const z of [0.06, -0.26]) g.add(part(cyl(0.042, 0.042, 0.006, 12), mat('wood'), 0, 0, z)); },
  rock(g) { for (const [x, y, z, s] of [[0, 0, -0.08, 0.75], [0.05, 0.02, -0.03, 0.5], [-0.045, 0.015, -0.12, 0.45]]) { const r = new THREE.Mesh(rockGeo(), mat('rock')); r.scale.setScalar(s); r.position.set(x, y, z); g.add(r); } },
  ore(g, d) { ITEM_MODELS.rock(g); const sp = mat('flat', new THREE.Color(d.spot || d.color || '#cccccc').getHex()); for (const [x, y, z] of [[0.03, 0.05, -0.08], [-0.03, 0.04, -0.05], [0.0, 0.06, -0.11], [0.05, 0.04, -0.02]]) g.add(part(new THREE.IcosahedronGeometry(0.014, 0), sp, x, y, z)); },
  frags(g, d) { const m = mat('metal', hex(d, '#9aa3ab')); [[0, 0, -0.06, 0.3], [0.04, 0.01, -0.1, 1.2], [-0.04, 0.0, -0.08, 2.1], [0.02, 0.02, -0.02, 0.8], [-0.02, 0.015, -0.13, 2.6]].forEach(([x, y, z, r]) => g.add(part(bbox(0.04, 0.01, 0.03, 0.002), m, x, y, z, r * 0.3, r, r * 0.2))); },
  powder(g, d) { const c = mat('cloth', d.id === 'charcoal' ? 0x5a5a5a : d.id === 'gunpowder' ? 0x6b6b74 : 0xc8b04a); const sack = part(sph(0.06, 14, 10), c, 0, 0.02, -0.08); sack.scale.set(1, 1.15, 1); g.add(sack); g.add(part(cyl(0.022, 0.016, 0.04, 10), c, 0, 0.09, -0.08, Math.PI / 2)); g.add(part(cyl(0.024, 0.024, 0.01, 10), mat('cloth', 0x6b4a2e), 0, 0.075, -0.08, Math.PI / 2)); const pile = part(sph(0.03, 10, 6), mat('flat', hex(d)), 0, 0.075, -0.08); pile.scale.set(0.8, 0.35, 0.8); g.add(pile); },
  ingot(g, d) { const m = mat('metal', hex(d, '#b8c4cc')); const geo = extrudeProfile([[-0.06, -0.018], [0.06, -0.018], [0.045, 0.018], [-0.045, 0.018]], 0.05, 0.003); g.add(part(geo, m, 0, 0, -0.08)); g.add(part(geo, m, 0, 0.04, -0.08, 0, Math.PI / 2, 0)); },
  tnt(g, d) { const r = mat('flat', hex(d, '#b03a2e')); for (const x of [-0.03, 0, 0.03]) g.add(part(cyl(0.015, 0.015, 0.16, 10), r, x, 0, -0.08, 0, 0, 0)); g.add(part(bbox(0.1, 0.035, 0.02, 0.002), mat('rubber'), 0, 0, -0.08)); g.add(part(cyl(0.002, 0.002, 0.06, 4), mat('flat', 0xdddddd), 0, 0.02, -0.18, 0.5)); },
  cloth(g, d) { const m = mat(d.id === 'leather' ? 'leather' : 'cloth', hex(d)); for (let i = 0; i < 3; i++) g.add(part(bbox(0.16, 0.014, 0.12, 0.005), m, i * 0.006, i * 0.015, -0.08 - i * 0.004, 0, i * 0.12, 0)); },
  blob(g, d) { const b = part(sph(0.055, 14, 10), mat('flat', hex(d, '#e8d8a0')), 0, 0, -0.08); b.scale.set(1.2, 0.6, 1); g.add(b); },
  bone(g, d) { const m = mat('flat', hex(d, '#ece6d6')); for (const [x, ry] of [[0, 0.3], [0.03, -0.5]]) { const b = new THREE.Group(); b.position.set(x, 0, -0.08); b.rotation.y = ry; b.add(part(cyl(0.008, 0.008, 0.14, 6), m)); for (const z of [0.07, -0.07]) for (const xx of [-0.008, 0.008]) b.add(part(sph(0.012, 8, 6), m, xx, 0, z)); g.add(b); } },
  can(g, d) {
    if (d.id === 'low_grade') { const m = mat('flat', 0xb0302a); g.add(part(bbox(0.12, 0.16, 0.05, 0.01), m, 0, 0.04, -0.08)); g.add(part(cyl(0.012, 0.012, 0.03, 8), mat('metal'), 0.04, 0.135, -0.08, Math.PI / 2)); g.add(part(bbox(0.05, 0.012, 0.03, 0.004), m, -0.02, 0.13, -0.08)); return; }
    g.add(part(cyl(0.035, 0.035, 0.1, 16), mat('flat', hex(d)), 0, 0, -0.08, Math.PI / 2)); for (const y of [0.05, -0.05]) g.add(part(cyl(0.036, 0.036, 0.006, 16), mat('metal'), 0, y, -0.08, Math.PI / 2));
  },
  scrap(g) { const m = mat('rust'); [[0, 0, -0.08, 0.3, 0.4], [0.03, 0.02, -0.05, -0.6, 1.2], [-0.03, 0.01, -0.11, 0.9, -0.7]].forEach(([x, y, z, a, b]) => g.add(part(bbox(0.07, 0.006, 0.05, 0.002), m, x, y, z, a, b, 0.4))); g.add(part(bbox(0.02, 0.02, 0.04, 0.003), mat('metal'), 0.01, 0.03, -0.08, 0.5, 0.5, 0)); },
  rope(g, d) { const m = mat('cloth', hex(d, '#b8a27a')); for (let i = 0; i < 3; i++) g.add(part(new THREE.TorusGeometry(0.055 - i * 0.004, 0.01, 6, 20), m, 0, i * 0.018, -0.08, Math.PI / 2)); },
  kit(g) {
    // sewing kit: a small tin with a spool of thread and a needle
    g.add(part(bbox(0.13, 0.03, 0.09, 0.008), mat('flat', 0x5a6b8a), 0, 0, -0.08));
    g.add(part(cyl(0.022, 0.022, 0.05, 12), mat('cloth', 0xc0392b), -0.025, 0.035, -0.08, Math.PI / 2));
    for (const y of [0.012, 0.058]) g.add(part(cyl(0.028, 0.028, 0.006, 12), mat('gunwood'), -0.025, y, -0.08, Math.PI / 2));
    g.add(part(cyl(0.002, 0.001, 0.09, 4), mat('metal'), 0.035, 0.022, -0.08, 0, 0.6, 0));
  },
  gear(g, d) { const m = mat('metal', hex(d, '#9aa3ab')); const gr = new THREE.Group(); gr.position.set(0, 0, -0.08); gr.rotation.x = Math.PI / 2; gr.add(part(cyl(0.05, 0.05, 0.016, 20), m)); for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; gr.add(part(bbox(0.016, 0.014, 0.016, 0.002), m, Math.cos(a) * 0.056, Math.sin(a) * 0.056, 0, 0, 0, a)); } gr.add(part(cyl(0.015, 0.015, 0.02, 10), mat('rubber'))); g.add(gr); },
  pipe(g) { const m = mat('metal'); g.add(part(cyl(0.02, 0.02, 0.3, 14), m, 0, 0, -0.1)); for (const z of [0.05, -0.25]) g.add(part(cyl(0.024, 0.024, 0.02, 14), m, 0, 0, z)); g.add(part(cyl(0.013, 0.013, 0.302, 10), mat('rubber'), 0, 0, -0.1)); },
  spring(g) { const pts = []; for (let i = 0; i <= 80; i++) { const t = i / 80, a = t * Math.PI * 2 * 7; pts.push(new THREE.Vector3(Math.cos(a) * 0.025, Math.sin(a) * 0.025, -t * 0.16)); } g.add(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.004, 6), mat('metal'), 0, 0, 0)); },
  blade(g) { g.add(part(extrudeProfile([[0, -0.025], [0.2, -0.018], [0.24, 0.0], [0, 0.025]], 0.004, 0.001), mat('metal'), 0, 0, -0.02, 0, Math.PI / 2, 0)); },
  plate(g) { g.add(part(bbox(0.22, 0.006, 0.16, 0.003), mat('metal'), 0, 0, -0.08)); for (const [x, z] of [[-0.09, -0.15], [0.09, -0.15], [-0.09, -0.01], [0.09, -0.01]]) g.add(part(cyl(0.006, 0.006, 0.004, 8), mat('gunmetal'), x, 0.005, z, Math.PI / 2)); },
  sign(g, d) { const sg = part(new THREE.CylinderGeometry(0.11, 0.11, 0.006, 8), mat('paint', hex(d, '#d8b040')), 0, 0, -0.1, Math.PI / 2, 0, Math.PI / 8); g.add(sg); g.add(part(cyl(0.008, 0.008, 0.012, 8), mat('metal'), 0, 0, -0.096)); },
  body(g, d) {
    const m = mat('gunmetal'); g.add(part(bbox(0.045, 0.05, d.id === 'rifle_body' ? 0.24 : d.id === 'smg_body' ? 0.18 : 0.12, 0.005), m, 0, 0.03, -0.08));
    g.add(part(bbox(0.006, 0.006, 0.05, 0.002), m, 0, 0.0, -0.06)); g.add(part(bbox(0.035, 0.008, 0.012, 0.002), mat('polymer'), 0, 0.062, -0.04));
    g.add(part(cyl(0.008, 0.008, 0.03, 8), m, 0, 0.035, d.id === 'rifle_body' ? -0.215 : -0.16));
  },
  chip(g, d) { g.add(part(bbox(0.14, 0.005, 0.1, 0.002), mat('paint', d.id === 'electric_fuse' ? 0x3a3a3a : 0x2e6b3a), 0, 0, -0.08)); if (d.id === 'electric_fuse') { g.add(part(cyl(0.012, 0.012, 0.09, 10), mat('glass'), 0, 0.015, -0.08)); for (const z of [-0.035, -0.125]) g.add(part(cyl(0.014, 0.014, 0.015, 10), mat('metal'), 0, 0.015, z)); return; } for (const [x, z] of [[-0.035, -0.06], [0.03, -0.1], [-0.02, -0.11], [0.04, -0.055]]) g.add(part(bbox(0.03, 0.008, 0.025, 0.002), mat('rubber'), x, 0.006, z)); g.add(part(bbox(0.12, 0.002, 0.006, 0.001), mat('paint', 0xd8b040), 0, 0.004, -0.035)); },
  tank(g, d) { const m = mat('flat', hex(d, '#c9ced4')); g.add(part(cyl(0.055, 0.055, 0.16, 16), m, 0, 0.04, -0.08, Math.PI / 2)); for (const y of [0.12, -0.04]) g.add(part(sph(0.055, 14, 8), m, 0, y, -0.08)); g.add(part(cyl(0.012, 0.012, 0.04, 8), mat('metal'), 0, 0.18, -0.08, Math.PI / 2)); g.add(part(new THREE.TorusGeometry(0.03, 0.006, 6, 14), mat('metal'), 0, 0.18, -0.08, Math.PI / 2)); },
  arrow(g, d) { g.add(part(cyl(0.004, 0.004, 0.6, 6), mat('wood'), 0, 0, -0.2)); g.add(part(new THREE.ConeGeometry(0.009, 0.04, 8).rotateX(-Math.PI / 2), mat(d.id === 'hv_arrow' ? 'metal' : 'rock'), 0, 0, -0.52)); for (let i = 0; i < 3; i++) g.add(part(bbox(0.001, 0.016, 0.06, 0.0005), mat('flat', 0xd8d0c0), 0, 0, 0.06, 0, 0, i * Math.PI * 2 / 3)); },
  shell(g, d) { const m = mat('flat', hex(d, '#b03a2e')); [[-0.022, 0], [0.0, 0.006], [0.022, 0]].forEach(([x, y], i) => { g.add(part(cyl(0.01, 0.01, 0.055, 12), m, x, y, -0.08, Math.PI / 2 * 0, 0, 0)); g.add(part(cyl(0.011, 0.011, 0.014, 12), mat('flat', 0xc9a23a), x, y, -0.045)); }); },
  bullet(g, d) { g.add(part(bbox(0.1, 0.05, 0.07, 0.003), mat('flat', hex(d, '#9c7a32')), 0, 0, -0.08)); const brass = mat('flat', 0xc9a23a), tip = mat('metal', 0xb87333); for (let i = 0; i < 5; i++) { const x = -0.04 + i * 0.02; g.add(part(cyl(0.006, 0.006, 0.035, 8), brass, x, 0.04, -0.08, Math.PI / 2)); g.add(part(new THREE.ConeGeometry(0.006, 0.014, 8), tip, x, 0.064, -0.08)); } },
  rocket(g, d) { g.add(part(cyl(0.035, 0.035, 0.42, 14), mat('flat', hex(d, '#6b7a4a')), 0, 0, -0.15)); g.add(part(new THREE.ConeGeometry(0.035, 0.1, 14).rotateX(-Math.PI / 2), mat('flat', 0xb03a2e), 0, 0, -0.41)); for (let i = 0; i < 4; i++) g.add(part(bbox(0.002, 0.03, 0.06, 0.001), mat('gunmetal'), Math.cos(i * Math.PI / 2) * 0.045, Math.sin(i * Math.PI / 2) * 0.045, 0.04, 0, 0, i * Math.PI / 2)); },
  hat(g, d) { const m = d.id === 'coffee_can_helmet' ? mat('paint', hex(d)) : d.id === 'bone_helmet' ? mat('flat', 0xece6d6) : mat('cloth', hex(d)); g.add(part(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0, -0.08)); if (d.id === 'coffee_can_helmet') g.add(part(cyl(0.102, 0.102, 0.06, 18), m, 0, 0.02, -0.08, Math.PI / 2)); },
  shirt(g, d) { const m = mat('cloth', hex(d)); g.add(part(bbox(0.2, 0.025, 0.16, 0.01), m, 0, 0, -0.08)); g.add(part(new THREE.TorusGeometry(0.03, 0.008, 6, 14, Math.PI), m, 0, 0.015, -0.15, Math.PI / 2)); for (const x of [-0.09, 0.09]) g.add(part(bbox(0.05, 0.02, 0.06, 0.008), m, x, 0.005, -0.13, 0, x > 0 ? 0.4 : -0.4)); },
  pants(g, d) { const m = d.id === 'roadsign_kilt' ? mat('paint', hex(d)) : mat('cloth', hex(d)); g.add(part(bbox(0.16, 0.025, 0.08, 0.01), m, 0, 0, -0.05)); for (const x of [-0.045, 0.045]) g.add(part(bbox(0.065, 0.024, 0.14, 0.01), m, x, 0, -0.15)); g.add(part(bbox(0.16, 0.028, 0.012, 0.004), mat('leather', 0x4a3424), 0, 0.002, -0.012)); },
  boots(g, d) { const m = mat('leather', hex(d)); for (const x of [-0.035, 0.035]) { g.add(part(bbox(0.05, 0.1, 0.05, 0.012), m, x, 0.03, -0.06)); g.add(part(bbox(0.05, 0.035, 0.11, 0.012), m, x, -0.02, -0.09)); } },
  gloves(g, d) { const m = mat('leather', hex(d)); for (const x of [-0.04, 0.04]) { const h = part(sph(0.045, 12, 8), m, x, 0, -0.08); h.scale.set(0.75, 0.4, 1.2); g.add(h); g.add(part(cyl(0.025, 0.025, 0.04, 10), m, x, 0, -0.01)); } },
  vest(g, d) { const m = d.id === 'wood_chest' ? mat('wood') : d.id === 'metal_chest' ? mat('metal') : mat('paint', hex(d)); g.add(part(bbox(0.2, 0.03, 0.22, 0.01), m, 0, 0, -0.1)); for (const x of [-0.06, 0.06]) g.add(part(bbox(0.03, 0.012, 0.08, 0.004), mat('leather', 0x4a3424), x, 0.02, -0.02)); },
  mask(g, d) { const m = mat('flat', 0x9aa1a8).clone(); m.side = THREE.DoubleSide; g.add(part(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 16, 1, true, -Math.PI / 2.6, Math.PI / 1.3), m, 0, 0.0, -0.06)); for (const x of [-0.03, 0.03]) g.add(part(bbox(0.035, 0.008, 0.008, 0.002), mat('rubber'), x, 0.03, -0.148)); },
  hazmat(g, d) { ITEM_MODELS.shirt(g, d); g.add(part(cyl(0.04, 0.04, 0.02, 14), mat('rubber'), 0, 0.03, -0.08, Math.PI / 2)); g.add(part(cyl(0.03, 0.03, 0.022, 14), mat('glass'), 0, 0.04, -0.08, Math.PI / 2)); },
  food(g, d) { const m = mat('flat', hex(d, d.id === 'raw_meat' ? '#b0453a' : '#8a5a32')); const b = part(sph(0.06, 14, 10), m, 0, 0, -0.08); b.scale.set(1.25, 0.55, 1); g.add(b); g.add(part(cyl(0.008, 0.008, 0.08, 6), mat('flat', 0xece6d6), 0.06, 0.005, -0.03, 0, 0.8, 0)); },
  mushroom(g, d) { g.add(part(cyl(0.012, 0.015, 0.05, 8), mat('flat', 0xe8dcc0), 0, 0.02, -0.08, Math.PI / 2)); g.add(part(new THREE.SphereGeometry(0.035, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('flat', hex(d, '#a8784a')), 0, 0.04, -0.08)); },
  berry(g, d) { const m = mat('flat', hex(d, '#6b2f90')); for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 0.012 + (i % 3) * 0.01; g.add(part(sph(0.012, 8, 6), m, Math.cos(a) * r, (i % 2) * 0.012, -0.08 + Math.sin(a) * r)); } g.add(part(bbox(0.04, 0.002, 0.02, 0.001), mat('leaves', 0x5f8a45), 0.01, 0.025, -0.1)); },
  bar(g, d) { g.add(part(bbox(0.12, 0.018, 0.045, 0.004), mat('flat', hex(d)), 0, 0, -0.08)); for (const x of [-0.068, 0.068]) g.add(part(bbox(0.016, 0.012, 0.04, 0.002), mat('metal', 0xd0d0d0), x, 0, -0.08)); },
  bottle(g, d) { g.add(part(lathe([[0, 0], [0.032, 0], [0.034, 0.01], [0.034, 0.13], [0.014, 0.16], [0.012, 0.18], [0, 0.18]], 16), mat('glass'), 0, -0.05, -0.08)); g.add(part(cyl(0.013, 0.013, 0.02, 10), mat('flat', hex(d, '#3a7ab8')), 0, 0.135, -0.08, Math.PI / 2)); g.add(part(cyl(0.035, 0.035, 0.05, 16), mat('flat', hex(d, '#3a7ab8')), 0, 0.02, -0.08, Math.PI / 2)); },
  bandage(g, d) { const m = mat('cloth', 0xeeeae0); g.add(part(cyl(0.035, 0.035, 0.07, 16), m, 0, 0, -0.08, 0, Math.PI / 2, 0)); g.add(part(cyl(0.012, 0.012, 0.072, 10), mat('cloth', 0xc9b78a), 0, 0, -0.08, 0, Math.PI / 2, 0)); g.add(part(bbox(0.06, 0.002, 0.08, 0.001), m, 0, -0.034, -0.03, 0.15)); },
  syringe(g, d) { const r = new THREE.Group(); r.position.set(0, 0, -0.06); r.rotation.y = 0.2; r.add(part(cyl(0.012, 0.012, 0.1, 12), mat('glass'))); r.add(part(cyl(0.009, 0.009, 0.07, 10), mat('flat', hex(d, '#5ab8d8')), 0, 0, -0.01)); r.add(part(cyl(0.004, 0.004, 0.06, 6), mat('metal'), 0, 0, 0.07)); r.add(part(cyl(0.016, 0.016, 0.006, 10), mat('polymer'), 0, 0, 0.1)); r.add(part(cyl(0.001, 0.001, 0.04, 4), mat('metal'), 0, 0, -0.07)); r.add(part(bbox(0.04, 0.004, 0.008, 0.001), mat('polymer'), 0, 0, 0.045)); g.add(r); },
  med(g) { g.add(part(bbox(0.16, 0.08, 0.11, 0.012), mat('flat', 0xeeeeee), 0, 0, -0.08)); const red = mat('flat', 0xc0392b); g.add(part(bbox(0.05, 0.004, 0.016, 0.001), red, 0, 0.042, -0.08)); g.add(part(bbox(0.016, 0.004, 0.05, 0.001), red, 0, 0.042, -0.08)); g.add(part(bbox(0.05, 0.012, 0.012, 0.003), mat('polymer'), 0, 0.045, -0.04)); },
  pills(g, d) { g.add(part(cyl(0.025, 0.025, 0.07, 14), mat('flat', hex(d, '#d07a2a')), 0, 0, -0.08, Math.PI / 2)); g.add(part(cyl(0.027, 0.027, 0.02, 14), mat('flat', 0xf0f0f0), 0, 0.045, -0.08, Math.PI / 2)); g.add(part(cyl(0.0255, 0.0255, 0.03, 14), mat('flat', 0xf4f0e6), 0, 0.0, -0.08, Math.PI / 2)); },
  box(g, d) { const big = d.id === 'large_box'; const w = big ? 0.26 : 0.18; g.add(part(bbox(w, 0.12, 0.12, 0.006), mat('wood'), 0, 0.02, -0.1)); for (const x of [-w / 2 + 0.008, w / 2 - 0.008]) g.add(part(bbox(0.014, 0.124, 0.124, 0.003), mat('gunwood'), x, 0.02, -0.1)); g.add(part(bbox(0.03, 0.025, 0.006, 0.003), mat('metal'), 0, 0.06, -0.162)); },
  furnace(g) { g.add(part(lathe([[0, 0], [0.09, 0], [0.085, 0.06], [0.06, 0.16], [0.03, 0.2], [0, 0.2]], 14), mat('stone'), 0, -0.06, -0.1)); g.add(part(bbox(0.05, 0.04, 0.02, 0.004), mat('rubber'), 0, -0.02, -0.18)); g.add(part(bbox(0.035, 0.02, 0.012, 0.003), mat('emissive'), 0, -0.025, -0.186)); },
  fire(g) { const s = mat('stone'); for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const r = new THREE.Mesh(rockGeo(), s); r.scale.setScalar(0.28); r.position.set(Math.cos(a) * 0.07, -0.02, -0.1 + Math.sin(a) * 0.07); g.add(r); } for (const a of [0.4, -0.5, 1.6]) g.add(part(cyl(0.012, 0.012, 0.13, 8), mat('bark'), 0, 0.0, -0.1, 0, a, 0)); },
  bench(g, d) { const top = d.id === 'research_table' ? mat('flat', 0x5b8fd6) : d.id === 'workbench3' ? mat('flat', 0x4a6b8a) : d.id === 'workbench2' ? mat('metal') : mat('wood'); g.add(part(bbox(0.22, 0.02, 0.1, 0.004), top, 0, 0.04, -0.1)); for (const [x, z] of [[-0.09, -0.06], [0.09, -0.06], [-0.09, -0.14], [0.09, -0.14]]) g.add(part(bbox(0.014, 0.08, 0.014, 0.003), mat('gunwood'), x, 0.0, z)); g.add(part(bbox(0.04, 0.03, 0.03, 0.004), mat('gunmetal'), 0.07, 0.065, -0.08)); },
  bag(g, d) { const m = mat('cloth', hex(d)); g.add(part(cyl(0.05, 0.05, 0.2, 14), m, 0, 0, -0.1, 0, Math.PI / 2, 0)); for (const x of [-0.06, 0.06]) g.add(part(new THREE.TorusGeometry(0.052, 0.006, 6, 16), mat('leather', 0x4a3424), x, 0, -0.1, 0, Math.PI / 2, 0)); },
  cabinet(g, d) { g.add(part(bbox(0.12, 0.2, 0.08, 0.006), mat('wood', hex(d, '#7a5130')), 0, 0.06, -0.1)); for (let i = 0; i < 3; i++) g.add(part(bbox(0.1, 0.05, 0.004, 0.002), mat('gunwood'), 0, 0.0 + i * 0.06, -0.142)); g.add(part(cyl(0.006, 0.006, 0.006, 8), mat('metal'), 0, 0.12, -0.145, Math.PI / 2)); },
  door(g, d) { const m = d.id === 'wood_door' ? mat('wood') : d.id === 'armored_door' ? mat('armored') : mat('metal'); g.add(part(bbox(0.13, 0.24, 0.015, 0.003), m, 0, 0.06, -0.1)); g.add(part(cyl(0.006, 0.006, 0.02, 8), mat('metal', 0xc7a34b), 0.045, 0.06, -0.115, Math.PI / 2)); },
  lock(g) { g.add(part(bbox(0.06, 0.05, 0.022, 0.006), mat('flat', 0xc7a34b), 0, 0, -0.08)); g.add(part(new THREE.TorusGeometry(0.02, 0.005, 6, 14, Math.PI), mat('metal'), 0, 0.025, -0.08)); g.add(part(cyl(0.005, 0.005, 0.004, 8), mat('rubber'), 0, 0, -0.0685, Math.PI / 2)); },
  barricade(g) { const w = mat('wood'); for (let i = 0; i < 5; i++) { const x = -0.1 + i * 0.05; g.add(part(bbox(0.04, 0.16, 0.012, 0.003), w, x, 0.04, -0.1)); g.add(part(new THREE.ConeGeometry(0.02, 0.04, 4), w, x, 0.14, -0.1)); } for (const y of [0.0, 0.08]) g.add(part(bbox(0.27, 0.018, 0.012, 0.003), mat('bark'), 0, y, -0.088)); },
  codelock(g) { g.add(part(bbox(0.06, 0.1, 0.025, 0.006), mat('gunmetal'), 0, 0.02, -0.08)); for (let i = 0; i < 9; i++) g.add(part(bbox(0.012, 0.012, 0.004, 0.002), mat('flat', 0xd8d8d0), -0.016 + (i % 3) * 0.016, 0.045 - Math.floor(i / 3) * 0.016, -0.094)); g.add(part(bbox(0.04, 0.008, 0.004, 0.002), mat('emissive'), 0, -0.012, -0.094)); },
};
export const HAS_ITEM_MODEL = (id) => !!(ITEMS[id] && (GUNS[id] || TOOLS[id] || ITEM_MODELS[ITEMS[id].icon]));

// Build a model for any item id. Returns a Group with userData.weapon = { id, parts, sight, ... }.
export function buildItemModel(id) {
  const d = ITEMS[id];
  const g = new THREE.Group();
  const info = { id, parts: {}, sight: 0.08 };
  if (!d) return finish(g, info);
  if (GUNS[id]) Object.assign(info, GUNS[id](g) || {});
  else if (TOOLS[id]) TOOLS[id](g);
  else if (ITEM_MODELS[d.icon]) ITEM_MODELS[d.icon](g, d, id);
  else {
    // last resort (an item with no model yet): a small box tinted by the item colour
    g.add(part(bbox(0.08, 0.08, 0.1, 0.01), mat('paint', new THREE.Color(d.color || '#888').getHex()), 0, 0, -0.06));
  }
  info.isGun = !!GUNS[id];
  return finish(g, info);
}

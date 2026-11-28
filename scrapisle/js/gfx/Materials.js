// Shared PBR materials built from the procedural texture library. One instance per key, reused everywhere.
import * as THREE from 'three';

// key -> texture set name + material params
const DEFS = {
  wood: { tex: 'wood', rough: 1, normal: 1 },
  twig: { tex: 'twig', rough: 1, normal: 1.2 },
  bark: { tex: 'bark', rough: 1, normal: 1.4 },
  stone: { tex: 'stone', rough: 1, normal: 1.2 },
  rock: { tex: 'rock', rough: 1, normal: 1.3 },
  concrete: { tex: 'concrete', rough: 1, normal: 0.8 },
  asphalt: { tex: 'asphalt', rough: 1, normal: 0.6 },
  metal: { tex: 'metal', rough: 1, metal: 1, normal: 0.6 },
  corrugated: { tex: 'corrugated', rough: 1, metal: 1, normal: 1.2 },
  armored: { tex: 'armored', rough: 1, metal: 1, normal: 1 },
  rust: { tex: 'rust', rough: 1, metal: 1, normal: 1 },
  paint: { tex: 'paint', rough: 1, metal: 1, normal: 0.6, tint: true },
  gunmetal: { tex: 'gunmetal', rough: 1, metal: 1, normal: 0.5 },
  polymer: { tex: 'polymer', rough: 1, normal: 0.4 },
  gunwood: { tex: 'gunwood', rough: 1, normal: 0.5 },
  cloth: { tex: 'cloth', rough: 1, normal: 0.8, tint: true },
  leather: { tex: 'leather', rough: 1, normal: 0.8, tint: true },
  fur: { tex: 'fur', rough: 1, normal: 0.8, tint: true },
  leaves: { tex: 'leaves', rough: 1, normal: 0.8, alpha: true, tint: true, side: THREE.DoubleSide, wind: true },
  needles: { tex: 'needles', rough: 1, normal: 0.8, alpha: true, tint: true, side: THREE.DoubleSide, wind: true },
  blades: { tex: 'blades', rough: 1, normal: 0.5, alpha: true, tint: true, side: THREE.DoubleSide, wind: true },
  sand: { tex: 'sand' }, dirt: { tex: 'dirt' }, grass: { tex: 'grass' }, snow: { tex: 'snow' },
  glass: { color: 0x8fb3c4, rough: 0.08, metal: 0.2, transparent: 0.45 },
  rubber: { color: 0x1e1e1e, rough: 0.9 },
  skin: { color: 0xffffff, rough: 0.7, tint: true },
  flat: { color: 0xffffff, rough: 0.85, tint: true },
  emissive: { color: 0xffc070, emissive: 0xffa040 },
};

export class MaterialLibrary {
  // cheap: simple diffuse (Lambert) shading instead of PBR, for the Low preset
  constructor(textures, cheap = false) { this.cheap = cheap; this.tx = textures; this.cache = new Map(); this.windUniforms = { uTime: { value: 0 }, uWind: { value: 0.5 } }; }
  get(key, opts = {}) {
    const ck = key + (opts.vc ? ':vc' : '') + (opts.color !== undefined ? ':' + opts.color : '') + (opts.repeat ? ':r' + opts.repeat : '');
    if (this.cache.has(ck)) return this.cache.get(ck);
    const d = DEFS[key] || DEFS.flat;
    const p = { roughness: 1, metalness: d.metal ? 1 : 0 };
    if (d.tex && this.tx.get(d.tex)) {
      const t = this.tx.get(d.tex);
      const rep = opts.repeat || 1;
      const clone = (x) => { if (rep === 1) return x; const c = x.clone(); c.repeat.set(rep, rep); c.needsUpdate = true; return c; };
      p.map = clone(t.map); p.normalMap = clone(t.normalMap); p.roughnessMap = clone(t.orm); p.aoMap = clone(t.orm);
      if (d.metal) p.metalnessMap = clone(t.orm);
      p.normalScale = new THREE.Vector2(d.normal ?? 1, d.normal ?? 1);
      p.aoMapIntensity = 0.8;
    } else {
      p.color = new THREE.Color(d.color ?? 0xffffff);
      p.roughness = d.rough ?? 0.8; p.metalness = d.metal ?? 0;
    }
    if (opts.color !== undefined) p.color = new THREE.Color(opts.color);
    if (opts.vc) p.vertexColors = true;
    if (d.alpha) { p.alphaTest = 0.45; p.side = d.side || THREE.FrontSide; }
    if (d.transparent) { p.transparent = true; p.opacity = d.transparent; p.depthWrite = false; }
    if (d.emissive) { p.emissive = new THREE.Color(d.emissive); p.emissiveIntensity = 1.5; }
    if (d.side) p.side = d.side;
    let m;
    if (this.cheap) {
      const q = { ...p }; delete q.roughness; delete q.metalness; delete q.roughnessMap; delete q.metalnessMap; delete q.aoMap; delete q.aoMapIntensity;
      if (d.metal && !q.map) q.color = (q.color || new THREE.Color(0xffffff)).clone().multiplyScalar(0.75);
      m = new THREE.MeshLambertMaterial(q);
    } else m = new THREE.MeshStandardMaterial(p);
    m.userData.key = key;
    if (d.wind || opts.wind) this.addWind(m, opts.windStrength ?? (key === 'blades' ? 1 : 0.6));
    this.cache.set(ck, m);
    return m;
  }
  // Vertex shader sway for foliage and grass. Height above the instance origin scales the bend.
  addWind(m, strength) {
    const U = this.windUniforms;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
      sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          float hgt = max(0.0, transformed.y);
          float ph = wp.x * 0.09 + wp.z * 0.07;
          float sway = (sin(uTime * 1.7 + ph) * 0.6 + sin(uTime * 3.1 + ph * 2.3) * 0.25) * uWind * ${strength.toFixed(2)};
          transformed.x += sway * hgt * 0.06;
          transformed.z += sway * hgt * 0.04 * cos(ph);
        }`);
    };
    m.customProgramCacheKey = () => 'wind' + strength;
  }
  tick(time, wind) { this.windUniforms.uTime.value = time; this.windUniforms.uWind.value = wind; }
}

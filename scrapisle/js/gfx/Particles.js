// Pooled particle effects: impacts (dust, sparks, splinters, stone chips, blood, water), muzzle smoke,
// footstep dust, ambient dust motes and rain streaks. Two point clouds: additive (sparks/flashes)
// and normal (dust/debris). Fixed-size pools, no per-frame allocation.
import * as THREE from 'three';

const vert = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vAlpha; varying vec3 vColor;
void main() {
  vAlpha = aAlpha; vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * 300.0 / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const frag = `
uniform float soft;
varying float vAlpha; varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = vAlpha * (soft > 0.5 ? smoothstep(0.5, 0.1, d) : 1.0);
  gl_FragColor = vec4(vColor, a);
}`;

class Pool {
  constructor(scene, n, additive) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.col = new Float32Array(n * 3); this.grav = new Float32Array(n); this.grow = new Float32Array(n); this.a0 = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    const m = new THREE.ShaderMaterial({ uniforms: { soft: { value: 1 } }, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, size, color, alpha = 1, grav = 9.8, grow = 0) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.a0[i] = alpha; this.alpha[i] = alpha; this.grav[i] = grav; this.grow[i] = grow;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-dt * 1.5);
      this.vel[k] *= drag; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * Math.max(0, this.life[i] / this.max[i]);
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true; this.geo.attributes.aAlpha.needsUpdate = true; this.geo.attributes.aColor.needsUpdate = true;
  }
}

const C = (h) => new THREE.Color(h);
const COL = { dust: C(0x8a7a62), sand: C(0xc9b48a), wood: C(0x8a6238), spark: C(0xffc860), stone: C(0x9a9a95), blood: C(0x7a0e0e), water: C(0xc8dce8), smoke: C(0xb0b0b0), darkSmoke: C(0x4a4642), fire: C(0xff8a2a), snow: C(0xf0f4f8), leaf: C(0x4a6b2a), metal: C(0xb8c0c8) };
const r = (a = 1) => (Math.random() * 2 - 1) * a;

export class Particles {
  constructor(scene, density = 1) {
    this.density = density;
    this.add = new Pool(scene, 800, true);
    this.norm = new Pool(scene, 2000, false);
    // rain streaks
    const n = 2400, pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = r(30), y = Math.random() * 25, z = r(30); pos.set([x, y, z, x, y - 0.5, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xa8b8c8, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);
    this.moteT = 0;
  }
  burst(kind, x, y, z, nx = 0, ny = 1, nz = 0, scale = 1) {
    const k = Math.max(1, Math.round(this.density * scale * 10)) / 10;
    const emit = (pool, count, fn) => { for (let i = 0; i < Math.round(count * k); i++) fn(pool); };
    switch (kind) {
      case 'dirt': case 'sand': case 'snow':
        emit(this.norm, 10, p => p.spawn(x, y, z, nx * 2 + r(1.5), ny * 2.5 + Math.random() * 2, nz * 2 + r(1.5), 0.6 + Math.random() * 0.4, 0.05 + Math.random() * 0.06, COL[kind === 'dirt' ? 'dust' : kind], 0.9, 9.8));
        emit(this.norm, 4, p => p.spawn(x, y, z, nx * 0.6 + r(0.4), 0.6 + Math.random() * 0.5, nz * 0.6 + r(0.4), 1.4, 0.25, COL[kind === 'dirt' ? 'dust' : kind], 0.35, 0.3, 0.6));
        break;
      case 'wood':
        emit(this.norm, 9, p => p.spawn(x, y, z, nx * 3 + r(2), ny * 2 + Math.random() * 2.5, nz * 3 + r(2), 0.9, 0.035 + Math.random() * 0.04, COL.wood, 1, 9.8));
        emit(this.norm, 2, p => p.spawn(x, y, z, r(0.4), 0.5, r(0.4), 1, 0.18, COL.dust, 0.25, 0.2, 0.4));
        break;
      case 'stone':
        emit(this.norm, 8, p => p.spawn(x, y, z, nx * 3 + r(2), ny * 2 + Math.random() * 3, nz * 3 + r(2), 0.8, 0.03 + Math.random() * 0.04, COL.stone, 1, 9.8));
        emit(this.add, 4, p => p.spawn(x, y, z, nx * 4 + r(3), ny * 3 + r(2), nz * 4 + r(3), 0.18, 0.025, COL.spark, 1, 6));
        emit(this.norm, 3, p => p.spawn(x, y, z, r(0.4), 0.4, r(0.4), 1.2, 0.22, COL.smoke, 0.3, 0.1, 0.5));
        break;
      case 'metal':
        emit(this.add, 12, p => p.spawn(x, y, z, nx * 5 + r(4), ny * 4 + r(3), nz * 5 + r(4), 0.25 + Math.random() * 0.2, 0.02 + Math.random() * 0.015, COL.spark, 1, 9));
        emit(this.norm, 2, p => p.spawn(x, y, z, r(0.3), 0.4, r(0.3), 0.8, 0.12, COL.smoke, 0.3, 0.1, 0.4));
        break;
      case 'flesh':
        emit(this.norm, 8, p => p.spawn(x, y, z, nx * 1.5 + r(1.2), ny + Math.random() * 1.5, nz * 1.5 + r(1.2), 0.5, 0.04 + Math.random() * 0.04, COL.blood, 1, 9.8));
        emit(this.norm, 2, p => p.spawn(x, y, z, r(0.3), 0.2, r(0.3), 0.5, 0.14, COL.blood, 0.5, 1, 0.3));
        break;
      case 'water':
        emit(this.norm, 12, p => p.spawn(x, y, z, r(1.2), 2 + Math.random() * 2.5, r(1.2), 0.7, 0.05, COL.water, 0.8, 9.8));
        break;
      case 'muzzle':
        emit(this.norm, 5, p => p.spawn(x, y, z, nx * 1.5 + r(0.3), ny * 1.5 + 0.3, nz * 1.5 + r(0.3), 0.9, 0.08, COL.smoke, 0.25, -0.2, 0.5));
        break;
      case 'leaves':
        emit(this.norm, 6, p => p.spawn(x, y + 2 + Math.random() * 3, z, r(1), -0.2, r(1), 2.5, 0.06, COL.leaf, 1, 0.6));
        break;
      case 'explosion': {
        // scale: satchel about 1, rocket 1.3, C4 1.8. Bigger blasts throw everything further and
        // leave a taller smoke column.
        const s = Math.max(0.6, scale);
        emit(this.add, 30, p => p.spawn(x, y, z, r(3) * s, Math.random() * 3 * s, r(3) * s, 0.22, 0.9 * s, COL.fire, 1, -1, 3));   // fireball
        emit(this.add, 40, p => p.spawn(x, y, z, r(11) * s, Math.random() * 10 * s, r(11) * s, 0.4 + Math.random() * 0.3, 0.05, COL.spark, 1, 9.8));
        emit(this.norm, 26, p => p.spawn(x, y, z, r(9) * s, 2 + Math.random() * 9 * s, r(9) * s, 1.4 + Math.random() * 0.6, 0.05 + Math.random() * 0.06, COL.dust, 1, 9.8));   // debris
        emit(this.norm, 30, p => p.spawn(x + r(0.8), y, z + r(0.8), r(2.5) * s, 0.5 + Math.random() * 2.5 * s, r(2.5) * s, 3 + Math.random() * 2 * s, 0.6 * s, COL.smoke, 0.55, -0.4, 1.4));   // smoke cloud
        emit(this.norm, 14, p => p.spawn(x + r(0.5), y + 1, z + r(0.5), r(0.6), 1.5 + Math.random() * 1.5 * s, r(0.6), 5 + Math.random() * 3 * s, 0.8 * s, COL.darkSmoke, 0.45, -0.25, 1.1));   // rising column
        break;
      }
    }
  }
  footstep(x, y, z, surface) { if (Math.random() > this.density) return; for (let i = 0; i < 3; i++) this.norm.spawn(x + r(0.15), y + 0.05, z + r(0.15), r(0.4), 0.3 + Math.random() * 0.4, r(0.4), 0.7, 0.12, COL[surface] || COL.dust, 0.35, 0.5, 0.3); }
  update(dt, cam, env) {
    this.add.update(dt); this.norm.update(dt);
    // ambient dust motes in daylight around the camera
    this.moteT -= dt;
    if (this.moteT <= 0 && env && !env.isNight && env.rain < 0.3) {
      this.moteT = 0.15 / Math.max(0.1, this.density);
      this.norm.spawn(cam.x + r(8), cam.y + r(2) + 0.5, cam.z + r(8), r(0.15), r(0.05), r(0.15), 5, 0.025, COL.sand, 0.5, 0, 0);
    }
    // rain
    const rainOn = env && env.rain > 0.15;
    this.rain.visible = rainOn;
    if (rainOn) {
      this.rain.position.set(cam.x, cam.y - 8, cam.z);
      const p = this.rain.geometry.attributes.position, a = p.array, fall = dt * 22;
      for (let i = 0; i < a.length; i += 6) { a[i + 1] -= fall; a[i + 4] -= fall; if (a[i + 4] < 0) { a[i + 1] += 25; a[i + 4] += 25; } }
      p.needsUpdate = true;
      this.rain.material.opacity = 0.35 * env.rain;
    }
  }
}

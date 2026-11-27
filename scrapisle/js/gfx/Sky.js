// Sky dome: atmospheric gradient, sun and moon discs, stars and drifting procedural clouds.
import * as THREE from 'three';

const vert = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const frag = `
uniform vec3 sunDir; uniform vec3 moonDir; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunCol;
uniform float night; uniform float cloud; uniform float time; uniform float cloudsOn; uniform float rain;
varying vec3 vDir;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45));
  if (h < 0.0) col = horizon * (1.0 + h * 0.6);
  float sd = max(dot(d, sunDir), 0.0);
  col += sunCol * (pow(sd, 900.0) * 18.0 + pow(sd, 12.0) * 0.25 + pow(sd, 3.0) * 0.08) * (1.0 - night) * (1.0 - cloud * 0.7);
  float md = max(dot(d, moonDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, md) * 1.6 + pow(md, 60.0) * 0.08) * night;
  // stars
  if (night > 0.05 && h > 0.0) {
    vec2 sp = d.xz / (h + 0.2) * 180.0;
    float s = h21(floor(sp));
    float tw = 0.6 + 0.4 * sin(time * 3.0 + s * 50.0);
    col += vec3(step(0.996, s) * tw * night * (1.0 - cloud) * smoothstep(0.0, 0.2, h));
  }
  // clouds on a plane above the camera
  if (cloudsOn > 0.5 && h > 0.0) {
    vec2 uv = d.xz / (h + 0.08) * 0.6 + vec2(time * 0.004, time * 0.0025);
    float n = fbm(uv * 2.0) * 0.65 + fbm(uv * 6.0 + 7.0) * 0.35;
    float cover = mix(0.62, 0.38, cloud);
    float c = smoothstep(cover, cover + 0.22, n) * smoothstep(0.0, 0.18, h);
    float lit = 0.75 + 0.25 * pow(sd, 4.0);
    vec3 cc = mix(vec3(1.0, 0.98, 0.95) * lit, vec3(0.55, 0.57, 0.6), cloud * 0.6 + rain * 0.3);
    cc = mix(cc, horizon * 0.6 + vec3(0.02), night * 0.85);
    col = mix(col, cc, c * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, moonDir: { value: new THREE.Vector3(0, -1, 0) },
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunCol: { value: new THREE.Color(1, 0.95, 0.85) },
      night: { value: 0 }, cloud: { value: 0 }, time: { value: 0 }, cloudsOn: { value: 1 }, rain: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
}

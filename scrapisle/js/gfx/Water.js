// Ocean and river water: moving waves, depth-based colour and transparency, shoreline foam,
// fresnel sky reflection and sun glints. Depth comes from a texture baked from the heightmap.
import * as THREE from 'three';

const common = `
uniform float time; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 skyTop; uniform vec3 skyHor;
uniform vec3 shallow; uniform vec3 deep; uniform float fresh; uniform float quality;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
`;
const vert = `
${common}
uniform sampler2D depthTex; uniform float worldSize; uniform vec2 flow;
attribute float aDepth;
varying vec3 vWorld; varying float vDepth; varying vec3 vNormal;
#include <fog_pars_vertex>
float waveH(vec2 p, float amp) {
  return amp * (sin(dot(p, vec2(0.08, 0.05)) + time * 1.1) * 0.5 + sin(dot(p, vec2(-0.05, 0.11)) + time * 1.5) * 0.3 + sin(dot(p, vec2(0.17, -0.13)) + time * 2.3) * 0.15);
}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float depth = aDepth;
  if (fresh < 0.5) depth = texture2D(depthTex, wp.xz / worldSize + 0.5).r * 30.0;
  float amp = fresh > 0.5 ? 0.03 : 0.35 * smoothstep(0.0, 6.0, depth) * quality;
  float h = waveH(wp.xz, amp);
  float e = 0.6;
  float hx = waveH(wp.xz + vec2(e, 0.0), amp) - h, hz = waveH(wp.xz + vec2(0.0, e), amp) - h;
  vNormal = normalize(vec3(-hx / e, 1.0, -hz / e));
  wp.y += h;
  vWorld = wp.xyz; vDepth = depth;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const frag = `
${common}
uniform vec2 flow;
varying vec3 vWorld; varying float vDepth; varying vec3 vNormal;
#include <fog_pars_fragment>
void main() {
  vec2 p = vWorld.xz + flow * time;
  // ripples
  float n1 = vn(p * 0.7 + time * 0.3), n2 = vn(p * 1.9 - time * 0.45), n3 = vn(p * 4.3 + vec2(time * 0.6, -time * 0.2));
  vec3 N = normalize(vNormal + vec3(n1 - 0.5, 0.0, n2 - 0.5) * 0.35 + vec3(n3 - 0.5, 0.0, n1 - 0.5) * 0.15 * quality);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(skyHor, skyTop, clamp(R.y, 0.0, 1.0));
  float depthT = smoothstep(0.0, fresh > 0.5 ? 2.5 : 14.0, vDepth);
  vec3 water = mix(shallow, deep, depthT);
  vec3 col = mix(water, sky, 0.15 + fres * 0.75);
  vec3 H = normalize(sunDir + V);
  col += sunCol * pow(max(dot(N, H), 0.0), 220.0) * 2.5 * step(0.0, sunDir.y);
  // shoreline foam
  float foam = (1.0 - smoothstep(0.0, 0.9, vDepth)) * smoothstep(0.45, 0.75, vn(p * 2.2 + time * 0.8));
  foam += (1.0 - smoothstep(0.0, 0.25, vDepth)) * 0.6;
  col = mix(col, vec3(0.9, 0.93, 0.95), clamp(foam, 0.0, 1.0) * (1.0 - fresh * 0.5));
  float alpha = mix(0.35, 0.94, smoothstep(0.0, fresh > 0.5 ? 1.2 : 3.0, vDepth));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function makeDepthTexture(world) {
  const N = 512, data = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / N - 0.5) * world.size, z = (j / N - 0.5) * world.size;
    data[j * N + i] = Math.max(0, Math.min(255, -world.heightAt(x, z) / 30 * 255));
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

export function waterMaterial(opts) {
  const u = {
    time: { value: 0 }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) },
    skyTop: { value: new THREE.Color() }, skyHor: { value: new THREE.Color() },
    shallow: { value: new THREE.Color(opts.fresh ? 0x3f7a70 : 0x2f8f8f) }, deep: { value: new THREE.Color(opts.fresh ? 0x1c3f45 : 0x0b2e45) },
    fresh: { value: opts.fresh ? 1 : 0 }, quality: { value: opts.quality ?? 1 }, depthTex: { value: opts.depthTex || null }, worldSize: { value: opts.worldSize || 2048 },
    flow: { value: new THREE.Vector2(0, 0) },
  };
  const m = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, u]), vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true });
  // keep shared references so Environment can update one set of uniforms
  for (const k in u) m.uniforms[k] = u[k];
  return m;
}

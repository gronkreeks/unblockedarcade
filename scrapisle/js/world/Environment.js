// Day/night cycle, sky, fog, lights and weather.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';

export const DAY_SECONDS = 40 * 60;     // real seconds for one full day (night runs faster)
const WEATHERS = ['clear', 'clear', 'cloudy', 'rain', 'fog', 'cloudy', 'clear'];

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.tod = 0.35;          // 0..1, 0 = midnight
    this.day = 1;
    this.weather = 'clear';
    this.weatherT = 240;      // seconds until next weather roll
    this.rain = 0; this.fogAmt = 0; this.cloud = 0;
    this.sky = new THREE.Color();
    scene.background = this.sky;
    scene.fog = new THREE.Fog(0xbfd4e6, 60, 900);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 0.6);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0008;
    scene.add(this.sun); scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(this.ambient);
    // rain particles around the camera
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 60; pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainPts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaabbd0, size: 0.08, transparent: true, opacity: 0.7 }));
    this.rainPts.visible = false;
    scene.add(this.rainPts);
  }
  get isNight() { return this.sunHeight() < -0.05; }
  hours() { return this.tod * 24; }
  clock() { const h = Math.floor(this.tod * 24), m = Math.floor((this.tod * 24 - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
  sunHeight() { return Math.sin((this.tod - 0.25) * Math.PI * 2); }

  // Advance clock. Returns in-game hours passed (for decay/upkeep).
  advance(dt) {
    const night = this.sunHeight() < 0;
    const rate = (night ? 2.2 : 0.8) / DAY_SECONDS;
    const before = this.tod;
    this.tod += dt * rate;
    if (this.tod >= 1) { this.tod -= 1; this.day++; }
    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.weatherT = 180 + Math.random() * 300; this.weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)]; }
    const tr = this.weather === 'rain' ? 1 : 0, tf = this.weather === 'fog' ? 1 : 0, tc = this.weather === 'clear' ? 0 : 1;
    this.rain = lerp(this.rain, tr, dt * 0.1); this.fogAmt = lerp(this.fogAmt, tf, dt * 0.08); this.cloud = lerp(this.cloud, tc, dt * 0.1);
    let dh = this.tod - before; if (dh < 0) dh += 1;
    return dh * 24;
  }
  // Temperature modifier from time + weather (°C)
  tempOffset() { return lerp(-9, 0, smoothstep(-0.3, 0.4, this.sunHeight())) - this.rain * 5 - this.fogAmt * 2; }

  update(camPos) {
    const sh = this.sunHeight();
    const ang = (this.tod - 0.25) * Math.PI * 2;
    const sx = Math.cos(ang), sy = Math.sin(ang);
    const dayT = smoothstep(-0.12, 0.25, sh);
    const dusk = clamp(1 - Math.abs(sh) * 4, 0, 1) * (sh > -0.2 ? 1 : 0);
    const dayCol = new THREE.Color(0x8fbfe6), nightCol = new THREE.Color(0x070b16), duskCol = new THREE.Color(0xe0905a);
    this.sky.copy(nightCol).lerp(dayCol, dayT).lerp(duskCol, dusk * 0.45);
    const grey = new THREE.Color(0x8a9098).multiplyScalar(lerp(0.08, 1, dayT));
    this.sky.lerp(grey, this.cloud * 0.55 + this.fogAmt * 0.3);
    this.scene.fog.color.copy(this.sky);
    this.scene.fog.near = lerp(60, 10, this.fogAmt) * lerp(0.5, 1, dayT);
    this.scene.fog.far = lerp(lerp(260, 950, dayT), 140, this.fogAmt) * (1 - this.rain * 0.3);
    // lights
    const night = sh < 0;
    const ldir = night ? new THREE.Vector3(-sx, -sy + 0.3, 0.4) : new THREE.Vector3(sx, Math.max(0.08, sy), 0.35);
    ldir.normalize();
    this.sun.position.set(camPos.x + ldir.x * 150, camPos.y + ldir.y * 150, camPos.z + ldir.z * 150);
    this.sun.target.position.set(camPos.x, camPos.y, camPos.z);
    this.sun.intensity = night ? 0.12 : lerp(0.15, 1.25, dayT) * (1 - this.cloud * 0.45);
    this.sun.color.set(night ? 0x8fa6d6 : 0xfff1d6).lerp(new THREE.Color(0xffa060), dusk * 0.6);
    this.hemi.intensity = lerp(0.1, 0.65, dayT);
    this.ambient.intensity = lerp(0.07, 0.12, dayT);
    // rain
    this.rainPts.visible = this.rain > 0.15;
    if (this.rainPts.visible) {
      this.rainPts.position.set(camPos.x, camPos.y - 8, camPos.z);
      const p = this.rainPts.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { let y = p.getY(i) - 0.9; if (y < 0) y += 30; p.setY(i, y); }
      p.needsUpdate = true;
      this.rainPts.material.opacity = 0.7 * this.rain;
    }
  }
  serialize() { return { tod: this.tod, day: this.day, weather: this.weather, weatherT: this.weatherT }; }
  load(d) { if (!d) return; this.tod = d.tod; this.day = d.day; this.weather = d.weather; this.weatherT = d.weatherT; }
}

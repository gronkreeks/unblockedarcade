// Day/night cycle, sky, sun and moon lighting, shadows, fog and haze, weather, wind and sky reflections.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { Sky } from '../gfx/Sky.js';

export const DAY_SECONDS = 40 * 60;     // real seconds for one full day (night runs faster)
const WEATHERS = ['clear', 'clear', 'cloudy', 'rain', 'fog', 'cloudy', 'clear'];
const C = (h) => new THREE.Color(h);
const DAY_Z = C(0x3f78c4), DAY_H = C(0xb5cfe6), NIGHT_Z = C(0x0a1224), NIGHT_H = C(0x1a2438), DUSK_H = C(0xe39a62), GREY = C(0x8f969e);

export class Environment {
  constructor(scene, renderer, gfx = {}) {
    this.scene = scene; this.renderer = renderer; this.gfx = gfx;
    this.tod = 0.35; this.day = 1;
    this.weather = 'clear'; this.weatherT = 240;
    this.rain = 0; this.fogAmt = 0; this.cloud = 0; this.wind = 0.4; this.time = 0;
    this.sky = new Sky(scene);
    this.sky.uniforms.cloudsOn.value = gfx.clouds === false ? 0 : 1;
    scene.background = null;
    scene.fog = new THREE.Fog(0xbfd4e6, 80, gfx.viewDist || 1000);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 0.6); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sun.castShadow = !!gfx.shadows;
    const res = gfx.shadowRes || 2048;
    this.sun.shadow.mapSize.set(res, res);
    const sd = gfx.shadowDist || 70;
    const sc = this.sun.shadow.camera; sc.left = -sd; sc.right = sd; sc.top = sd; sc.bottom = -sd; sc.near = 1; sc.far = 500;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun); scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.1); scene.add(this.ambient);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.sky.mesh.geometry, this.sky.mat); this.envScene.add(this.envSky);
    this.envT = 0; this.envRT = null;
    this.zen = new THREE.Color(); this.hor = new THREE.Color();
  }
  get isNight() { return this.sunHeight() < -0.05; }
  hours() { return this.tod * 24; }
  clock() { const h = Math.floor(this.tod * 24), m = Math.floor((this.tod * 24 - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
  sunHeight() { return Math.sin((this.tod - 0.25) * Math.PI * 2); }

  advance(dt) {
    const night = this.sunHeight() < 0;
    const rate = (night ? 2.2 : 0.8) / DAY_SECONDS;
    const before = this.tod;
    this.tod += dt * rate; this.time += dt;
    if (this.tod >= 1) { this.tod -= 1; this.day++; }
    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.weatherT = 180 + Math.random() * 300; this.weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)]; }
    const tr = this.weather === 'rain' ? 1 : 0, tf = this.weather === 'fog' ? 1 : 0, tc = this.weather === 'clear' ? 0.1 : this.weather === 'fog' ? 0.6 : 1;
    this.rain = lerp(this.rain, tr, dt * 0.1); this.fogAmt = lerp(this.fogAmt, tf, dt * 0.08); this.cloud = lerp(this.cloud, tc, dt * 0.1);
    this.wind = lerp(this.wind, 0.35 + this.rain * 0.8 + this.cloud * 0.3, dt * 0.05);
    let dh = this.tod - before; if (dh < 0) dh += 1;
    return dh * 24;
  }
  tempOffset() { return lerp(-9, 0, smoothstep(-0.3, 0.4, this.sunHeight())) - this.rain * 5 - this.fogAmt * 2; }

  update(camPos, game) {
    const sh = this.sunHeight();
    const ang = (this.tod - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    const moonDir = sunDir.clone().multiplyScalar(-1); moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.15; moonDir.normalize();
    const dayT = smoothstep(-0.15, 0.25, sh);
    const dusk = clamp(1 - Math.abs(sh) * 3.5, 0, 1);
    const night = 1 - smoothstep(-0.2, 0.05, sh);
    // sky colours
    this.zen.copy(NIGHT_Z).lerp(DAY_Z, dayT);
    this.hor.copy(NIGHT_H).lerp(DAY_H, dayT).lerp(DUSK_H, dusk * 0.55);
    const grey = GREY.clone().multiplyScalar(lerp(0.12, 1, dayT));
    this.zen.lerp(grey, this.cloud * 0.55 + this.fogAmt * 0.3); this.hor.lerp(grey, this.cloud * 0.45 + this.fogAmt * 0.5);
    const U = this.sky.uniforms;
    U.sunDir.value.copy(sunDir); U.moonDir.value.copy(moonDir); U.zenith.value.copy(this.zen); U.horizon.value.copy(this.hor);
    U.night.value = night; U.cloud.value = this.cloud; U.time.value = this.time; U.rain.value = this.rain;
    U.sunCol.value.set(0xfff1d6).lerp(C(0xff9a50), dusk * 0.7);
    this.sky.mesh.position.copy(camPos);
    // fog and haze
    const vd = this.gfx.viewDist || 1000;
    this.scene.fog.color.copy(this.hor);
    this.scene.fog.near = lerp(lerp(30, 120, dayT), 8, this.fogAmt);
    this.scene.fog.far = lerp(lerp(vd * 0.45, vd, dayT), 150, this.fogAmt) * (1 - this.rain * 0.35);
    // lights: sun by day, moon at night (kept bright enough to play)
    const useMoon = sh < 0.02;
    const L = useMoon ? moonDir : sunDir;
    const sd = this.gfx.shadowDist || 70;
    this.sun.position.set(camPos.x + L.x * 200, camPos.y + Math.max(0.1, L.y) * 200, camPos.z + L.z * 200);
    // snap shadow camera to texels to stop shimmering
    const texel = (sd * 2) / (this.gfx.shadowRes || 2048);
    this.sun.target.position.set(Math.round(camPos.x / texel) * texel, camPos.y, Math.round(camPos.z / texel) * texel);
    this.sun.position.x += this.sun.target.position.x - camPos.x; this.sun.position.z += this.sun.target.position.z - camPos.z;
    const cloudDim = 1 - this.cloud * 0.55 - this.rain * 0.2;
    this.sun.intensity = useMoon ? 0.35 * night : lerp(0.2, 2.8, dayT) * cloudDim;
    this.sun.color.set(useMoon ? 0x9fb4e0 : 0xfff1d6).lerp(C(0xffa060), useMoon ? 0 : dusk * 0.65);
    this.hemi.color.copy(this.zen).lerp(C(0xffffff), 0.35);
    this.hemi.groundColor.set(0x4a4234).multiplyScalar(lerp(0.4, 1, dayT));
    this.hemi.intensity = lerp(0.35, 0.9, dayT);
    this.ambient.intensity = lerp(0.12, 0.05, dayT);
    this.renderer.toneMappingExposure = lerp(1.05, 0.85, dayT);
    // sky reflections for PBR metals/water, refreshed every few seconds
    this.envT -= 1 / 60;
    if (this.envT <= 0 && this.gfx.envMap !== false) {
      this.envT = 6;
      if (this.envRT) this.envRT.dispose();
      this.envSky.position.set(0, 0, 0);
      const clouds = U.cloudsOn.value; U.cloudsOn.value = 0;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      U.cloudsOn.value = clouds;
      this.scene.environment = this.envRT.texture;
    }
    if (this.scene.environmentIntensity !== undefined) this.scene.environmentIntensity = lerp(0.15, 0.6, dayT);
    // water uniforms
    if (game && game.waterMats) for (const m of game.waterMats) {
      m.uniforms.time.value = this.time; m.uniforms.sunDir.value.copy(L); m.uniforms.sunCol.value.copy(this.sun.color).multiplyScalar(useMoon ? 0.3 : 1);
      m.uniforms.skyTop.value.copy(this.zen); m.uniforms.skyHor.value.copy(this.hor);
    }
    if (game && game.mats) game.mats.tick(this.time, this.wind);
  }
  serialize() { return { tod: this.tod, day: this.day, weather: this.weather, weatherT: this.weatherT }; }
  load(d) { if (!d) return; this.tod = d.tod; this.day = d.day; this.weather = d.weather; this.weatherT = d.weatherT; }
}

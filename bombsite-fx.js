// Bombsite: sound (Web Audio, all made in code), 3D models (soldiers, guns, first-person arms, grenades,
// the bomb) and effects (tracers, bullet holes, sparks, muzzle flashes, smoke clouds, fire, explosions).
// Holds no game state; bombsite-game.js drives it.
(function () {
  'use strict';
  const rand = (a, b) => a + Math.random() * (b - a);

  // ══════════════ Sound ══════════════
  function createAudio() {
    let ctx = null, master = null, muffle = null, noise = null, on = true;
    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      master = ctx.createGain(); master.gain.value = on ? 0.6 : 0;
      muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
      master.connect(muffle); muffle.connect(comp); comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const ready = () => ctx && on && ctx.state === 'running';
    function out(pos, vol) {
      const g = ctx.createGain(); g.gain.value = vol == null ? 1 : vol;
      if (pos) {
        const p = ctx.createPanner();
        p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3.5; p.rolloffFactor = 1.15; p.maxDistance = 300;
        if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
        g.connect(p); p.connect(master);
      } else g.connect(master);
      return g;
    }
    function nz(dest, t, dur, type, f, q, gain, attack) {
      const s = ctx.createBufferSource(); s.buffer = noise;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + (attack || 0.002)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(fl); fl.connect(g); g.connect(dest);
      s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
      return fl;
    }
    function tn(dest, t, f0, f1, dur, type, gain, attack) {
      const o = ctx.createOscillator(); o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + (attack || 0.003)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    }
    const GUN = {
      pistol(d, t) { nz(d, t, 0.13, 'bandpass', 1900, 0.8, 1.1); nz(d, t, 0.22, 'lowpass', 700, 0.7, 0.7); tn(d, t, 190, 60, 0.08, 'sine', 0.6); },
      deagle(d, t) { nz(d, t, 0.2, 'bandpass', 1300, 0.7, 1.3); nz(d, t, 0.45, 'lowpass', 420, 0.7, 1.0); tn(d, t, 130, 40, 0.14, 'sine', 0.9); },
      smg(d, t) { nz(d, t, 0.09, 'bandpass', 2300, 1, 0.9); nz(d, t, 0.16, 'lowpass', 800, 0.7, 0.55); tn(d, t, 170, 70, 0.05, 'sine', 0.4); },
      rifle(d, t) { nz(d, t, 0.15, 'bandpass', 1250, 0.7, 1.15); nz(d, t, 0.36, 'lowpass', 430, 0.7, 0.9); tn(d, t, 115, 45, 0.11, 'sine', 0.8); },
      sniper(d, t) { nz(d, t, 0.3, 'bandpass', 900, 0.6, 1.4); nz(d, t, 1.0, 'lowpass', 260, 0.6, 1.1); tn(d, t, 85, 32, 0.28, 'sine', 1.1); },
      shotgun(d, t) { nz(d, t, 0.32, 'lowpass', 950, 0.6, 1.4); nz(d, t, 0.2, 'bandpass', 520, 0.8, 0.9); tn(d, t, 95, 38, 0.18, 'sine', 1.0); },
      zeus(d, t) { for (let i = 0; i < 6; i++) nz(d, t + i * 0.03, 0.05, 'highpass', 3000, 0.5, 0.6); tn(d, t, 95, 80, 0.3, 'sawtooth', 0.25); },
      knife(d, t) { const f = nz(d, t, 0.14, 'bandpass', 2600, 1.5, 0.35, 0.03); f.frequency.exponentialRampToValueAtTime(900, t + 0.14); },
    };
    function play(fn, pos, vol) { if (!ready()) return; fn(out(pos, vol), ctx.currentTime); }
    return {
      init, get ctx() { return ctx; },
      setOn(v) { on = v; if (master) master.gain.value = v ? 0.6 : 0; },
      listener(x, y, z, fx, fy, fz) {
        if (!ctx) return;
        const L = ctx.listener;
        if (L.positionX) { L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z; L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
        else { L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
      },
      shot(kind, pos, vol) { play(GUN[kind] || GUN.rifle, pos, (vol || 1) * 1.6); },
      step(pos, vol) { play((d, t) => { nz(d, t, 0.08, 'lowpass', rand(380, 620), 1, 0.9); nz(d, t + 0.01, 0.04, 'bandpass', 2500, 2, 0.12); }, pos, vol); },
      land(pos) { play((d, t) => nz(d, t, 0.12, 'lowpass', 300, 1, 1), pos, 1); },
      dry() { play((d, t) => tn(d, t, 1800, 1400, 0.03, 'square', 0.15)); },
      reload(pos) { play((d, t) => { nz(d, t, 0.04, 'bandpass', 3200, 3, 0.5); nz(d, t + 0.35, 0.05, 'bandpass', 2400, 3, 0.6); nz(d, t + 0.7, 0.05, 'bandpass', 3600, 3, 0.5); }, pos, 0.6); },
      draw(pos) { play((d, t) => nz(d, t, 0.06, 'bandpass', 3800, 3, 0.35), pos, 0.5); },
      bounce(pos) { play((d, t) => { tn(d, t, rand(1800, 2400), 1500, 0.06, 'triangle', 0.35); nz(d, t, 0.03, 'highpass', 4000, 1, 0.2); }, pos, 0.8); },
      pin(pos) { play((d, t) => { tn(d, t, 2600, 2600, 0.05, 'square', 0.12); nz(d, t + 0.08, 0.05, 'bandpass', 3000, 3, 0.4); }, pos, 0.6); },
      throwNade(pos) { play((d, t) => nz(d, t, 0.2, 'bandpass', 900, 1, 0.4, 0.05), pos, 0.7); },
      flashBang(pos) { play((d, t) => { nz(d, t, 0.25, 'highpass', 1500, 0.5, 1.5); nz(d, t, 0.6, 'lowpass', 500, 0.6, 1.0); }, pos, 2); },
      explode(pos, big) { play((d, t) => { nz(d, t, big ? 2.4 : 1.3, 'lowpass', big ? 220 : 380, 0.6, 1.6, 0.005); nz(d, t, 0.3, 'bandpass', 900, 0.5, 1.0); tn(d, t, 70, 25, big ? 1.2 : 0.6, 'sine', 1.2); }, pos, big ? 4 : 2.4); },
      smokePop(pos) { play((d, t) => { nz(d, t, 2.4, 'highpass', 1800, 0.4, 0.5, 0.05); nz(d, t, 0.2, 'lowpass', 300, 1, 0.6); }, pos, 1); },
      glass(pos) { play((d, t) => { nz(d, t, 0.3, 'highpass', 5000, 0.8, 0.9); for (let i = 0; i < 5; i++) tn(d, t + i * 0.02, rand(3000, 6000), 2500, 0.08, 'triangle', 0.15); nz(d, t + 0.05, 1.0, 'lowpass', 700, 0.5, 0.8, 0.1); }, pos, 1.4); },
      crackle(pos) { play((d, t) => { for (let i = 0; i < 4; i++) nz(d, t + Math.random() * 0.25, 0.04, 'bandpass', rand(1200, 3500), 2, 0.5); nz(d, t, 0.3, 'lowpass', 400, 0.5, 0.25, 0.1); }, pos, 0.8); },
      fizzle(pos) { play((d, t) => nz(d, t, 0.8, 'highpass', 2500, 0.5, 0.6, 0.02), pos, 1); },
      beep(pos, hi) { play((d, t) => tn(d, t, hi ? 1650 : 1250, hi ? 1650 : 1250, 0.09, 'sine', 0.6), pos, 1.4); },
      plantBeep(pos, i) { play((d, t) => tn(d, t, 900 + i * 120, 900 + i * 120, 0.06, 'square', 0.15), pos, 1); },
      defuseTick(pos) { play((d, t) => nz(d, t, 0.03, 'bandpass', 4200, 4, 0.4), pos, 0.8); },
      hit(head) { play((d, t) => { if (head) { tn(d, t, 2900, 2600, 0.18, 'triangle', 0.28); tn(d, t, 4300, 4100, 0.12, 'sine', 0.12); } else nz(d, t, 0.05, 'bandpass', 1800, 2, 0.35); }); },
      hurt() { play((d, t) => { nz(d, t, 0.12, 'lowpass', 400, 1, 0.9); tn(d, t, 140, 70, 0.1, 'sine', 0.5); }); },
      zap(pos) { play(GUN.zeus, pos, 1.2); },
      ui(kind) {
        play((d, t) => {
          if (kind === 'buy') { tn(d, t, 880, 880, 0.06, 'triangle', 0.25); tn(d, t + 0.05, 1320, 1320, 0.08, 'triangle', 0.2); }
          else if (kind === 'deny') tn(d, t, 220, 180, 0.12, 'square', 0.12);
          else if (kind === 'start') { for (let i = 0; i < 3; i++) tn(d, t + i * 0.09, 660 + i * 220, 660 + i * 220, 0.12, 'triangle', 0.22); }
          else if (kind === 'win') { [523, 659, 784, 1047].forEach((f, i) => tn(d, t + i * 0.1, f, f, 0.3, 'triangle', 0.25)); }
          else if (kind === 'lose') { [392, 330, 262].forEach((f, i) => tn(d, t + i * 0.14, f, f, 0.35, 'triangle', 0.22)); }
          else if (kind === 'planted') { tn(d, t, 990, 990, 0.12, 'square', 0.18); tn(d, t + 0.16, 990, 990, 0.12, 'square', 0.18); }
          else if (kind === 'kill') tn(d, t, 1200, 1500, 0.06, 'triangle', 0.15);
        });
      },
      // Ears ringing and the world muffled after a flash; strength 0..1
      flashed(dur, strength) {
        if (!ready()) return;
        const t = ctx.currentTime, d = out(null, 1);
        tn(d, t, 3100, 3000, dur, 'sine', 0.12 * strength, 0.02);
        muffle.frequency.cancelScheduledValues(t);
        muffle.frequency.setValueAtTime(20000, t); muffle.frequency.linearRampToValueAtTime(900 + (1 - strength) * 6000, t + 0.05);
        muffle.frequency.setValueAtTime(900 + (1 - strength) * 6000, t + dur * 0.45); muffle.frequency.exponentialRampToValueAtTime(20000, t + dur);
      },
    };
  }

  // ══════════════ Models ══════════════
  function createModels(THREE) {
    const mats = new Map();
    const mat = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: c, ...(o || {}) })); return mats.get(k); };
    const boxG = new THREE.BoxGeometry(1, 1, 1);
    function B(parent, w, h, d, c, x, y, z, rx, ry, rz) {
      const m = new THREE.Mesh(boxG, typeof c === 'number' ? mat(c) : c);
      m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0);
      parent.add(m); return m;
    }
    function C(parent, r, len, c, x, y, z, rx, segs) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segs || 10), typeof c === 'number' ? mat(c) : c);
      m.position.set(x, y, z); m.rotation.x = rx == null ? Math.PI / 2 : rx;
      parent.add(m); return m;
    }
    // A box stretched between two points (arms), in the parent's own space
    const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
    function limb(parent, ax, ay, az, bx, by, bz, w, c) {
      _a.set(ax, ay, az); _b.set(bx, by, bz);
      const m = new THREE.Mesh(boxG, mat(c));
      m.position.copy(_a).add(_b).multiplyScalar(0.5);
      m.scale.set(w, w, _a.distanceTo(_b));
      m.quaternion.setFromUnitVectors(_z, _b.sub(_a).normalize());
      parent.add(m);
      return m;
    }
    // Gun looks. Forward is -z; the grip is at the origin. userData: muzzle, gripL (support hand)
    const LOOK = {
      glock: { kind: 'pistol', body: 0x2b2b2e, furn: 0x1f1f22 },
      usp: { kind: 'pistol', body: 0x3a3d42, furn: 0x2a2c30, long: true },
      deagle: { kind: 'deagle', body: 0xb9bec6, furn: 0x2a2a2a },
      smg: { kind: 'smg', body: 0x2f3034, furn: 0x232427 },
      shotgun: { kind: 'shotgun', body: 0x2f2f33, furn: 0x6a4524 },
      galil: { kind: 'rifle', body: 0x34363a, furn: 0x8a7350, mag: 0x34363a },
      famas: { kind: 'bullpup', body: 0x5a5f66, furn: 0x3a3e44 },
      ak: { kind: 'rifle', body: 0x2a2a2c, furn: 0x8a5426, mag: 0x3a3a3c, curved: true },
      m4: { kind: 'rifle', body: 0x2c2e31, furn: 0x1f2124, mag: 0x2c2e31, rail: true },
      scout: { kind: 'sniper', body: 0x31414e, furn: 0x2a3540 },
      awp: { kind: 'sniper', body: 0x4b6b45, furn: 0x3d5a39, big: true },
      knife: { kind: 'knife' }, zeus: { kind: 'zeus' },
      flash: { kind: 'nade', body: 0x8c9399, band: 0xeeeeee }, he: { kind: 'nade', body: 0x4a6b3a, band: 0x2b3a22 },
      smoke: { kind: 'nade', body: 0x7a8794, band: 0xd0d6dc, tall: true }, molotov: { kind: 'bottle', body: 0x9b5a1c }, incendiary: { kind: 'nade', body: 0x9a4a2a, band: 0xffb14a, tall: true },
      decoy: { kind: 'nade', body: 0x6b5a45, band: 0xc0a070 }, bomb: { kind: 'bomb' },
    };
    function gun(id) {
      const L = LOOK[id] || LOOK.glock, g = new THREE.Group();
      let muzzle = -0.2, gripL = [0, -0.02, -0.12];
      const b = L.body, f = L.furn;
      switch (L.kind) {
        case 'pistol':
          B(g, 0.036, 0.05, L.long ? 0.22 : 0.19, b, 0, 0.055, -0.07);
          B(g, 0.034, 0.03, 0.15, f, 0, 0.02, -0.05);
          B(g, 0.034, 0.11, 0.05, f, 0, -0.03, 0.01, 0.25);
          muzzle = L.long ? -0.19 : -0.17; gripL = [0, -0.03, 0.0]; break;
        case 'deagle':
          B(g, 0.045, 0.065, 0.27, b, 0, 0.06, -0.09);
          B(g, 0.04, 0.035, 0.18, 0x8a9098, 0, 0.02, -0.06);
          B(g, 0.04, 0.12, 0.055, f, 0, -0.035, 0.01, 0.2);
          muzzle = -0.23; gripL = [0, -0.035, 0.0]; break;
        case 'smg':
          B(g, 0.055, 0.085, 0.3, b, 0, 0.04, -0.1);
          C(g, 0.012, 0.12, 0x111111, 0, 0.055, -0.31);
          B(g, 0.04, 0.2, 0.045, f, 0, -0.07, -0.07);
          B(g, 0.035, 0.1, 0.045, f, 0, -0.03, 0.03, 0.25);
          B(g, 0.03, 0.05, 0.16, f, 0, 0.03, 0.12);
          muzzle = -0.38; gripL = [0, -0.06, -0.09]; break;
        case 'shotgun':
          B(g, 0.055, 0.075, 0.42, b, 0, 0.04, -0.15);
          C(g, 0.016, 0.4, 0x1a1a1a, 0, 0.065, -0.52);
          C(g, 0.022, 0.18, f, 0, 0.02, -0.42);
          B(g, 0.05, 0.1, 0.26, f, 0, 0.0, 0.18, -0.1);
          B(g, 0.035, 0.1, 0.045, f, 0, -0.04, 0.04, 0.3);
          muzzle = -0.73; gripL = [0, 0.0, -0.42]; break;
        case 'bullpup':
          B(g, 0.06, 0.11, 0.55, b, 0, 0.04, -0.05);
          B(g, 0.03, 0.04, 0.3, f, 0, 0.12, -0.1);
          C(g, 0.014, 0.2, 0x111111, 0, 0.05, -0.42);
          B(g, 0.035, 0.1, 0.045, f, 0, -0.05, -0.12, 0.25);
          B(g, 0.04, 0.14, 0.06, 0x2a2a2a, 0, -0.04, 0.12, -0.1);
          muzzle = -0.53; gripL = [0, -0.02, -0.28]; break;
        case 'rifle':
          B(g, 0.055, 0.085, 0.4, b, 0, 0.04, -0.12);
          B(g, 0.06, 0.07, 0.24, f, 0, 0.035, -0.42);
          C(g, 0.013, 0.24, 0x161616, 0, 0.055, -0.64);
          B(g, 0.045, 0.1, 0.24, f, 0, 0.005, 0.2, -0.06);
          B(g, 0.035, 0.11, 0.045, f === 0x1f2124 ? f : 0x2a2a2a, 0, -0.05, 0.03, 0.3);
          B(g, 0.04, 0.17, 0.065, L.mag, 0, -0.09, -0.18, L.curved ? -0.35 : -0.12);
          if (L.rail) { B(g, 0.03, 0.03, 0.3, 0x111111, 0, 0.1, -0.15); B(g, 0.02, 0.06, 0.02, 0x111111, 0, 0.09, -0.5); }
          else B(g, 0.01, 0.04, 0.01, 0x111111, 0, 0.09, -0.6);
          muzzle = -0.76; gripL = [0, 0.0, -0.42]; break;
        case 'sniper':
          B(g, 0.06, 0.09, 0.5, b, 0, 0.04, -0.1);
          C(g, L.big ? 0.02 : 0.015, 0.55, 0x1a1a1a, 0, 0.06, -0.62);
          C(g, 0.03, 0.32, 0x111111, 0, 0.13, -0.12);
          C(g, 0.036, 0.04, 0x111111, 0, 0.13, -0.3); C(g, 0.034, 0.04, 0x111111, 0, 0.13, 0.05);
          B(g, 0.055, 0.13, 0.32, f, 0, -0.0, 0.25, -0.05);
          B(g, 0.035, 0.1, 0.045, 0x222222, 0, -0.05, 0.05, 0.3);
          B(g, 0.04, 0.1, 0.06, 0x222222, 0, -0.06, -0.12);
          muzzle = -0.9; gripL = [0, -0.01, -0.34]; break;
        case 'knife':
          B(g, 0.028, 0.032, 0.11, 0x222222, 0, 0, 0.0);
          B(g, 0.05, 0.012, 0.012, 0x555555, 0, 0, -0.06);
          B(g, 0.005, 0.034, 0.19, new THREE.MeshLambertMaterial({ color: 0xd8dde3, emissive: 0x222222 }), 0, 0.004, -0.16);
          B(g, 0.004, 0.02, 0.05, new THREE.MeshLambertMaterial({ color: 0xd8dde3, emissive: 0x222222 }), 0, 0.012, -0.265, 0.5);
          muzzle = -0.28; gripL = null; break;
        case 'zeus':
          B(g, 0.05, 0.075, 0.16, 0xf2c230, 0, 0.03, -0.05);
          B(g, 0.052, 0.03, 0.06, 0x1a1a1a, 0, 0.03, -0.12);
          B(g, 0.035, 0.1, 0.045, 0x1a1a1a, 0, -0.035, 0.02, 0.25);
          muzzle = -0.15; gripL = null; break;
        case 'nade':
          C(g, 0.032, L.tall ? 0.12 : 0.09, b, 0, 0.0, 0, 0, 12);
          C(g, 0.034, 0.02, L.band, 0, L.tall ? 0.03 : 0.02, 0, 0, 12);
          B(g, 0.015, 0.03, 0.05, 0x777777, 0, L.tall ? 0.075 : 0.06, 0.01);
          muzzle = 0; gripL = null; break;
        case 'bottle':
          C(g, 0.034, 0.13, new THREE.MeshLambertMaterial({ color: b, transparent: true, opacity: 0.85 }), 0, 0, 0, 0, 10);
          C(g, 0.013, 0.06, b, 0, 0.09, 0, 0, 8);
          B(g, 0.02, 0.05, 0.02, 0xe8e0c8, 0, 0.13, 0);
          muzzle = 0; gripL = null; break;
        case 'bomb':
          B(g, 0.2, 0.09, 0.14, 0x3a3a2a, 0, 0, -0.05);
          B(g, 0.1, 0.01, 0.06, 0x1a1a1a, 0.02, 0.05, -0.05);
          B(g, 0.07, 0.006, 0.035, new THREE.MeshBasicMaterial({ color: 0x40ff60 }), 0.02, 0.056, -0.05);
          B(g, 0.03, 0.02, 0.03, 0xaa2222, -0.06, 0.055, -0.08);
          muzzle = 0; gripL = null; break;
      }
      g.userData.muzzle = new THREE.Vector3(0, 0.055, muzzle);
      g.userData.gripL = gripL;
      return g;
    }
    // First-person arms holding a gun (in the view-model scene)
    function viewModel(id, team) {
      const root = new THREE.Group(), g = gun(id), sleeve = team === 'T' ? 0x8f7550 : 0x2f4866, glove = team === 'T' ? 0x3b3026 : 0x1e2630;
      root.add(g);
      const k = (LOOK[id] || {}).kind;
      // Right hand on the grip, forearm running back and down out of view
      if (k === 'nade' || k === 'bottle' || k === 'bomb') {
        B(root, 0.07, 0.07, 0.08, glove, 0.0, -0.04, 0.02);
        limb(root, 0.0, -0.06, 0.06, 0.12, -0.3, 0.42, 0.075, sleeve);
      } else {
        B(root, 0.06, 0.07, 0.08, glove, 0.0, -0.035, 0.02);
        limb(root, 0.0, -0.06, 0.05, 0.1, -0.28, 0.45, 0.075, sleeve);
      }
      const gl = g.userData.gripL;
      if (gl) {
        B(root, 0.065, 0.06, 0.08, glove, gl[0] - 0.01, gl[1] - 0.03, gl[2]);
        limb(root, gl[0] - 0.02, gl[1] - 0.05, gl[2] + 0.02, -0.28, -0.32, gl[2] + 0.32, 0.075, sleeve);
      }
      root.userData.muzzle = g.userData.muzzle;
      root.userData.kind = k;
      return root;
    }
    // Third-person soldier. Faces -z. Parts are returned for animation.
    function soldier(team, name, tagColor) {
      const T = team === 'T';
      const c = T ? { shirt: 0xa5865a, pants: 0x5b4b36, vest: 0x6a5838, head: 0x2b2926, skin: 0xc4946c, boot: 0x2a221a, band: 0xc0392b }
                  : { shirt: 0x35527a, pants: 0x2c3d55, vest: 0x22324a, head: 0x27313d, skin: 0xd6a784, boot: 0x1a1f26, band: 0x3aa0e8 };
      const root = new THREE.Group(), body = new THREE.Group(), upper = new THREE.Group();
      root.add(body); body.add(upper);
      const legL = new THREE.Group(), legR = new THREE.Group();
      legL.position.set(-0.11, 0.9, 0); legR.position.set(0.11, 0.9, 0);
      B(legL, 0.17, 0.82, 0.2, c.pants, 0, -0.43, 0); B(legL, 0.18, 0.1, 0.28, c.boot, 0, -0.85, -0.04);
      B(legR, 0.17, 0.82, 0.2, c.pants, 0, -0.43, 0); B(legR, 0.18, 0.1, 0.28, c.boot, 0, -0.85, -0.04);
      body.add(legL, legR);
      upper.position.set(0, 0.9, 0);
      B(upper, 0.44, 0.58, 0.25, c.shirt, 0, 0.33, 0);
      B(upper, 0.47, 0.4, 0.3, c.vest, 0, 0.32, -0.005);
      B(upper, 0.48, 0.06, 0.05, c.band, 0, 0.46, -0.16);
      const head = new THREE.Group(); head.position.set(0, 0.76, 0); upper.add(head);
      B(head, 0.24, 0.26, 0.25, T ? c.head : c.skin, 0, 0, 0);
      if (T) { B(head, 0.2, 0.06, 0.02, c.skin, 0, 0.02, -0.125); B(head, 0.04, 0.03, 0.01, 0x111111, -0.05, 0.02, -0.136); B(head, 0.04, 0.03, 0.01, 0x111111, 0.05, 0.02, -0.136); }
      else {
        B(head, 0.29, 0.12, 0.3, c.head, 0, 0.12, 0.0); B(head, 0.3, 0.03, 0.12, c.head, 0, 0.07, -0.13);
        B(head, 0.04, 0.03, 0.01, 0x111111, -0.05, 0.0, -0.126); B(head, 0.04, 0.03, 0.01, 0x111111, 0.05, 0.0, -0.126);
      }
      // Hands hold the gun in front of the chest
      const hands = new THREE.Group(); hands.position.set(0.1, 0.4, -0.26); upper.add(hands);
      const armR = limb(upper, 0.24, 0.55, 0, 0.1, 0.38, -0.25, 0.1, c.shirt);
      const armL = limb(upper, -0.24, 0.55, 0, 0.06, 0.4, -0.5, 0.1, c.shirt);
      let tag = null;
      if (name) {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
        const x = cv.getContext('2d'); x.font = '800 30px Nunito, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,0.8)'; x.strokeText(name, 128, 32); x.fillStyle = tagColor || '#7fe0a8'; x.fillText(name, 128, 32);
        tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
        tag.scale.set(1.3, 0.33, 1); tag.position.set(0, 2.15, 0); tag.renderOrder = 5;
        root.add(tag);
      }
      // Blob shadow
      const sh = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; root.add(sh);
      return { root, body, upper, legL, legR, head, hands, armR, armL, tag, shadow: sh, gun: null, gunId: null };
    }
    function setSoldierGun(s, id) {
      if (s.gunId === id) return;
      if (s.gun) s.hands.remove(s.gun);
      s.gun = id ? gun(id) : null; s.gunId = id;
      if (s.gun) s.hands.add(s.gun);
    }
    return { gun, viewModel, soldier, setSoldierGun, mat };
  }

  // ══════════════ Effects ══════════════
  function createEffects(THREE, scene) {
    const canvasTex = (s, draw) => { const c = document.createElement('canvas'); c.width = c.height = s; draw(c.getContext('2d'), s); return new THREE.CanvasTexture(c); };
    const soft = canvasTex(128, (x, s) => { const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, s, s); });
    const puff = canvasTex(128, (x, s) => {
      for (let i = 0; i < 14; i++) {
        const cx = s / 2 + (Math.random() - 0.5) * s * 0.4, cy = s / 2 + (Math.random() - 0.5) * s * 0.4, r = s * (0.18 + Math.random() * 0.2);
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(0.6, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, s, s);
      }
    });
    const star = canvasTex(128, (x, s) => {
      x.translate(s / 2, s / 2);
      for (let i = 0; i < 6; i++) { x.rotate(Math.PI / 3); const g = x.createLinearGradient(0, 0, s / 2, 0); g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(1, 'rgba(255,180,60,0)'); x.fillStyle = g; x.beginPath(); x.moveTo(0, -s * 0.06); x.lineTo(s / 2, 0); x.lineTo(0, s * 0.06); x.fill(); }
      const g = x.createRadialGradient(0, 0, 0, 0, 0, s * 0.25); g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(1, 'rgba(255,200,80,0)'); x.fillStyle = g; x.fillRect(-s / 2, -s / 2, s, s);
    });
    const hole = canvasTex(64, (x, s) => { const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(10,8,6,1)'); g.addColorStop(0.35, 'rgba(30,24,18,0.9)'); g.addColorStop(0.6, 'rgba(60,45,30,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, s, s); });
    const scorch = canvasTex(128, (x, s) => { const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(20,14,8,0.85)'); g.addColorStop(0.7, 'rgba(30,20,10,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, s, s); });

    // Tracers
    const tracers = [];
    const trMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 48; i++) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const l = new THREE.Line(g, trMat.clone()); l.visible = false; l.frustumCulled = false; scene.add(l);
      tracers.push({ l, life: 0 });
    }
    let trI = 0;
    function tracer(a, b) {
      const t = tracers[trI++ % tracers.length], p = t.l.geometry.attributes.position.array;
      // Start a little ahead of the muzzle so it reads as a streak, not a line glued to the gun
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz) || 1, s = Math.min(0.6, L * 0.3) / L;
      p[0] = a.x + dx * s; p[1] = a.y + dy * s; p[2] = a.z + dz * s; p[3] = b.x; p[4] = b.y; p[5] = b.z;
      t.l.geometry.attributes.position.needsUpdate = true; t.l.geometry.computeBoundingSphere();
      t.l.visible = true; t.life = 0.07; t.l.material.opacity = 0.85;
    }
    // Bullet holes
    const decals = [], decalG = new THREE.PlaneGeometry(0.11, 0.11);
    const decalM = new THREE.MeshBasicMaterial({ map: hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    let dI = 0;
    const _n = new THREE.Vector3();
    function decal(x, y, z, nx, ny, nz) {
      let m = decals[dI % 160];
      if (!m) { m = new THREE.Mesh(decalG, decalM); decals.push(m); scene.add(m); }
      dI++;
      m.visible = true;
      m.position.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
      _n.set(x + nx, y + ny, z + nz); m.lookAt(_n); m.rotateZ(Math.random() * 6.28);
    }
    // Particles (sparks, dust, debris)
    const MAXP = 900, pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pVel = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pGrav = new Float32Array(MAXP), pBase = new Float32Array(MAXP * 3);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, map: soft, transparent: true, depthWrite: false, sizeAttenuation: true }));
    pts.frustumCulled = false; scene.add(pts);
    for (let i = 0; i < MAXP; i++) pPos[i * 3 + 1] = -100;
    let pI = 0;
    function particles(x, y, z, n, color, speed, grav, life, dir) {
      const r = (color >> 16 & 255) / 255, g = (color >> 8 & 255) / 255, b = (color & 255) / 255;
      for (let k = 0; k < n; k++) {
        const i = pI++ % MAXP;
        pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
        let vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1);
        if (dir) { vx = vx * 0.6 + dir.x; vy = vy * 0.6 + dir.y; vz = vz * 0.6 + dir.z; }
        const s = speed * rand(0.4, 1) / (Math.hypot(vx, vy, vz) || 1);
        pVel[i * 3] = vx * s; pVel[i * 3 + 1] = vy * s; pVel[i * 3 + 2] = vz * s;
        pLife[i] = life * rand(0.6, 1); pGrav[i] = grav;
        pBase[i * 3] = r; pBase[i * 3 + 1] = g; pBase[i * 3 + 2] = b;
      }
    }
    // Billboards: muzzle flashes, explosion flashes
    const flashes = [];
    function billboard(x, y, z, size, life, color, tex, additive) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex || star, color: color || 0xffffff, transparent: true, depthWrite: false, blending: additive === false ? THREE.NormalBlending : THREE.AdditiveBlending }));
      s.position.set(x, y, z); s.scale.set(size, size, 1); s.material.rotation = Math.random() * 6.28;
      scene.add(s); flashes.push({ s, life, max: life, size });
      return s;
    }
    // Smoke cloud: a ring of soft puffs that grows to radius R and fades at the end
    function smokeCloud(x, y, z, R) {
      const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
      const puffs = [];
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()), h = Math.pow(Math.random(), 1.3);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: new THREE.Color().setHSL(0.08, 0.05, 0.6 + Math.random() * 0.15), transparent: true, depthWrite: false, opacity: 0 }));
        s.material.rotation = Math.random() * 6.28;
        g.add(s); puffs.push({ s, a, rr, h, spin: rand(-0.15, 0.15) });
      }
      return {
        update(grow, alpha, dt) {
          for (const p of puffs) {
            const r = R * grow;
            const spread = r * 0.8 * (1 - 0.35 * p.h);
            p.s.position.set(Math.cos(p.a) * p.rr * spread, 0.5 + p.h * r * 1.0, Math.sin(p.a) * p.rr * spread);
            const sz = (2.8 + r * 1.0) * (0.8 + p.rr * 0.35);
            p.s.scale.set(sz, sz, 1); p.s.material.opacity = Math.min(1, alpha); p.s.material.rotation += p.spin * dt;
          }
        },
        remove() { scene.remove(g); for (const p of puffs) p.s.material.dispose(); },
      };
    }
    // Fire on the ground at a set of patch points
    function fire(points, y) {
      const g = new THREE.Group(); scene.add(g);
      const fl = [];
      const sm = new THREE.SpriteMaterial({ map: soft, color: 0xff7a1a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      for (const p of points) {
        for (let k = 0; k < 2; k++) {
          const s = new THREE.Sprite(sm.clone());
          s.position.set(p.x + rand(-0.3, 0.3), y + 0.3, p.z + rand(-0.3, 0.3));
          g.add(s); fl.push({ s, ph: Math.random() * 6.28, sp: rand(7, 13), base: rand(0.7, 1.2) });
        }
        const sc = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
        sc.rotation.x = -Math.PI / 2; sc.position.set(p.x, y + 0.03, p.z); g.add(sc);
      }
      return {
        update(t, alpha) {
          for (const f of fl) {
            const k = 0.75 + 0.35 * Math.sin(t * f.sp + f.ph);
            f.s.scale.set(1.0 * f.base * k, 1.5 * f.base * k, 1);
            f.s.position.y = y + 0.45 * f.base * k;
            f.s.material.opacity = alpha * (0.7 + 0.3 * Math.sin(t * f.sp * 1.7 + f.ph));
            f.s.material.color.setHSL(0.06 + 0.03 * Math.sin(t * 3 + f.ph), 1, 0.55);
          }
        },
        remove() { scene.remove(g); },
      };
    }
    function update(dt) {
      for (const t of tracers) if (t.life > 0) { t.life -= dt; t.l.material.opacity = Math.max(0, t.life / 0.07) * 0.85; if (t.life <= 0) t.l.visible = false; }
      for (let i = 0; i < MAXP; i++) {
        if (pLife[i] <= 0) continue;
        pLife[i] -= dt;
        if (pLife[i] <= 0) { pPos[i * 3 + 1] = -100; continue; }
        pVel[i * 3 + 1] -= pGrav[i] * dt;
        pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        if (pPos[i * 3 + 1] < 0.02) { pPos[i * 3 + 1] = 0.02; pVel[i * 3 + 1] *= -0.3; pVel[i * 3] *= 0.6; pVel[i * 3 + 2] *= 0.6; }
        const f = Math.min(1, pLife[i] * 3);
        pCol[i * 3] = pBase[i * 3] * f; pCol[i * 3 + 1] = pBase[i * 3 + 1] * f; pCol[i * 3 + 2] = pBase[i * 3 + 2] * f;
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]; f.life -= dt;
        if (f.life <= 0) { scene.remove(f.s); f.s.material.dispose(); flashes.splice(i, 1); continue; }
        const k = f.life / f.max; f.s.material.opacity = k; const sz = f.size * (1.4 - 0.4 * k); f.s.scale.set(sz, sz, 1);
      }
    }
    function clear() {
      for (const m of decals) m.visible = false;
      for (let i = 0; i < MAXP; i++) { pLife[i] = 0; pPos[i * 3 + 1] = -100; }
      for (const f of flashes) { scene.remove(f.s); f.s.material.dispose(); }
      flashes.length = 0;
    }
    return { tracer, decal, particles, billboard, smokeCloud, fire, update, clear, tex: { soft, star } };
  }

  window.BombsiteFX = Object.freeze({ createAudio, createModels, createEffects });
})();

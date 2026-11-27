// Synthesised sound effects (WebAudio). Distance-attenuated for world sounds.
const SHOT_RANGE = 200;   // gunshots fade out at about 200 m (30 s of running)
const BOOM_RANGE = 320;   // explosions carry a bit further
export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null; this.master = null;
    this.volume = 0.6;
    this.noiseBuf = null;
    this.last = {};
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
      // a limiter so loud gunfire and explosions punch without clipping
      const lim = this.ctx.createDynamicsCompressor();
      lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.15;
      this.master.connect(lim); lim.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  _gainFor(pos, range = 120) {
    const P = this.game.player;
    if (!pos || !P) return 1;
    const d = Math.hypot(pos.x - P.x, pos.z - P.z);
    return Math.max(0, 1 - d / range) ** 1.6;
  }
  // Where a sound comes from: an HRTF panner at its position, so you hear left/right/behind.
  // Our own distance falloff is kept (rolloff 0), the panner only adds direction.
  _dest(pos) {
    if (!pos || !this.ctx || pos.isPlayer) return this.master;
    const P = this.game.player;
    if (P && Math.hypot(pos.x - P.x, pos.z - P.z) < 0.8) return this.master;
    const c = this.ctx, pn = c.createPanner();
    pn.panningModel = 'HRTF'; pn.distanceModel = 'linear'; pn.rolloffFactor = 0; pn.refDistance = 1; pn.maxDistance = 10000;
    const y = (pos.y ?? (this.game.world ? this.game.world.heightAt(pos.x, pos.z) : 0)) + 1.2;
    if (pn.positionX) { pn.positionX.value = pos.x; pn.positionY.value = y; pn.positionZ.value = pos.z; } else pn.setPosition(pos.x, y, pos.z);
    pn.connect(this.master);
    setTimeout(() => { try { pn.disconnect(); } catch (e) { /* already gone */ } }, 4000);
    return pn;
  }
  // The listener follows the camera every frame.
  listen(cam) {
    if (!this.ctx || !cam) return;
    const L = this.ctx.listener, e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    const p = cam.position;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(fx, fy, fz, ux, uy, uz); }
  }
  _throttle(key, ms) { const t = performance.now(); if (this.last[key] && t - this.last[key] < ms) return true; this.last[key] = t; return false; }
  noise(dur, freq, q, vol, type = 'bandpass', at = 0, dest = null) {
    if (!this.ctx || vol <= 0.003) return;
    const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, vol, type = 'sine', slide = 0, at = 0, dest = null) {
    if (!this.ctx || vol <= 0.003) return;
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  shot(def, src) {
    // a fight you can just hear is about 30 s of running away (~200 m)
    const v = this._gainFor(src, SHOT_RANGE) * (src && src.isPlayer ? 0.85 : 0.8);
    if (v < 0.01 || this._throttle('shot' + (src && src.id), 30)) return;
    const out = this._dest(src);
    if (def.type === 'bow') { this.noise(0.12, 900, 2, 0.25 * v, 'bandpass', 0, out); return; }
    const heavy = def.icon === 'rifle' || def.icon === 'shotgun';
    const body = { assault_rifle: [0.32, 650, 95], semi_rifle: [0.3, 750, 110], bolt_rifle: [0.5, 520, 70], pump_shotgun: [0.42, 420, 70], double_barrel: [0.45, 400, 65], drum_smg: [0.22, 950, 140], scrap_smg: [0.2, 1100, 150], revolver: [0.3, 800, 105], semi_pistol: [0.22, 1200, 150], pipe_pistol: [0.4, 380, 60], crossbow: [0.12, 1300, 300] }[def.id] || [heavy ? 0.35 : 0.22, heavy ? 700 : 1100, heavy ? 90 : 140];
    // far shots arrive a moment later (sound travels ~340 m/s)
    const P = this.game.player, d = src && P && !src.isPlayer ? Math.hypot(src.x - P.x, src.z - P.z) : 0, late = Math.min(1.5, d / 340);
    this.noise(0.035, 3200, 0.6, 0.75 * v, 'highpass', late, out);           // the crack
    this.noise(body[0], body[1], 0.7, 1.05 * v, 'bandpass', late, out);      // the body of the shot
    this.tone(body[2], 0.22, 0.7 * v, 'triangle', 0.4, late, out);           // low punch
    this.noise(body[0] * 1.8, 260, 0.6, 0.45 * v, 'lowpass', late + 0.01, out); // room / tail
    // distant shots lose their high end and arrive as a low boom
    if (src && !src.isPlayer && v < 0.35) this.noise(0.7, 220, 0.5, 0.65 * Math.sqrt(v), 'lowpass', late + 0.03, out);
  }
  explosion(c) {
    const v = this._gainFor(c, BOOM_RANGE) * 0.85, out = this._dest(c);
    const P = this.game.player, late = P ? Math.min(2.5, Math.hypot(c.x - P.x, c.z - P.z) / 340) : 0;
    this.noise(0.08, 2200, 0.5, 0.8 * v, 'highpass', late, out);   // the blast crack
    this.noise(1.6, 180, 0.6, 1.1 * v, 'lowpass', late, out);      // the boom
    this.tone(48, 1.1, 0.8 * v, 'sine', 0.45, late, out);          // the thump you feel
    this.noise(2.2, 120, 0.4, 0.35 * Math.sqrt(v), 'lowpass', late + 0.15, out); // rolling echo
  }
  hit(kind) { if (kind === 'wood') this.noise(0.12, 500, 3, 0.35); else if (kind === 'flesh') this.noise(0.1, 300, 1, 0.3, 'lowpass'); else { this.noise(0.08, 2400, 4, 0.3); this.tone(900, 0.06, 0.08, 'square'); } }
  hitAt(kind, pos) { const v = this._gainFor(pos, 60); if (v < 0.02 || this._throttle('hit' + kind, 80)) return; const out = this._dest(pos); if (kind === 'wood') this.noise(0.12, 500, 3, 0.3 * v, 'bandpass', 0, out); else this.noise(0.08, 2400, 4, 0.25 * v, 'bandpass', 0, out); }
  swing() { this.noise(0.15, 600, 0.8, 0.12, 'bandpass'); }
  pickup() { this.tone(660, 0.08, 0.12, 'sine', 1.4); }
  build() { this.noise(0.18, 400, 2, 0.4); this.tone(180, 0.15, 0.15, 'square', 0.7); }
  door() { this.noise(0.25, 300, 3, 0.25); this.tone(120, 0.2, 0.1, 'sawtooth', 0.8); }
  deny() { this.tone(200, 0.12, 0.15, 'square'); this.tone(150, 0.15, 0.15, 'square', 1, 0.1); }
  click() { this.tone(1600, 0.03, 0.12, 'square'); }
  // Reload sounds follow the weapon's own reload timeline (mag out, mag in, charge / shells / cylinder).
  reload(def) {
    const T = def ? def.reload : 2;
    const clack = (at, f = 700, v = 0.14) => { this.noise(0.05, f * 2, 3, v, 'bandpass', at); this.tone(f, 0.04, v * 0.7, 'square', 0.8, at); };
    if (def && (def.id === 'pump_shotgun' || def.id === 'bolt_rifle')) { for (let i = 0; i < 4; i++) clack(T * (0.2 + i * 0.15), 900, 0.12); clack(T * 0.9, 500, 0.18); }
    else if (def && def.id === 'revolver') { clack(T * 0.12, 1200); for (let i = 0; i < 6; i++) clack(T * (0.32 + i * 0.07), 1500, 0.08); clack(T * 0.88, 1000); }
    else if (def && def.id === 'double_barrel') { clack(T * 0.1, 500, 0.2); clack(T * 0.4, 900); clack(T * 0.6, 900); clack(T * 0.9, 450, 0.22); }
    else { clack(T * 0.18, 600); clack(T * 0.55, 800, 0.18); clack(T * 0.78, 1000); clack(T * 0.85, 700); }
  }
  // Footsteps: a heel thump plus the texture of the ground (gravel, sand, snow, wood floors).
  // A footstep: a boot heel striking, then the toe rolling off, with the ground's own texture on top
  // (crunchy gravel, soft sand, squeaky snow, hollow wooden floors). Slight random variation per step.
  _stepSound(kind, vol, out) {
    const r = () => 0.9 + Math.random() * 0.2;
    const toe = 0.055 + Math.random() * 0.02;
    if (kind === 'wood') {
      this.tone(170 * r(), 0.09, vol * 1.1, 'triangle', 0.7, 0, out);          // hollow knock
      this.noise(0.05, 900 * r(), 2.5, vol * 0.9, 'bandpass', 0, out);
      this.tone(150 * r(), 0.06, vol * 0.55, 'triangle', 0.7, toe, out);       // toe
      this.noise(0.04, 1400 * r(), 3, vol * 0.4, 'bandpass', toe, out);
      if (Math.random() < 0.25) this.tone(520 * r(), 0.12, vol * 0.12, 'sawtooth', 1.15, toe + 0.02, out); // board creak
      return;
    }
    // heel: a firm, short thud
    this.tone(85 * r(), 0.06, vol * 1.0, 'sine', 0.55, 0, out);
    this.noise(0.045, 450 * r(), 0.8, vol * 0.9, 'lowpass', 0, out);
    // toe roll-off
    this.noise(0.04, 380 * r(), 0.8, vol * 0.5, 'lowpass', toe, out);
    // the surface
    if (kind === 'sand') { this.noise(0.14, 1700 * r(), 0.7, vol * 0.55, 'bandpass', 0.01, out); return; }   // soft shuffle
    const grains = kind === 'snow' ? 4 : 3, f = kind === 'snow' ? 3400 : 2600;                                // gravel / snow crunch
    for (let i = 0; i < grains; i++) this.noise(0.012 + Math.random() * 0.01, f * r(), 1.2, vol * (0.55 - i * 0.08), 'bandpass', 0.004 + i * (0.012 + Math.random() * 0.01), out);
    for (let i = 0; i < 2; i++) this.noise(0.01, f * 1.1 * r(), 1.2, vol * 0.3, 'bandpass', toe + 0.005 + i * 0.012, out);
  }
  step(kind, crouch, run) {
    if (this._throttle('step', 160)) return;
    this._stepSound(kind, crouch ? 0.045 : run ? 0.16 : 0.11, this.master);
  }
  // Someone else walking: placed where they are, louder when they run, almost silent crouched.
  stepAt(kind, pos, crouch, run) {
    const range = crouch ? 10 : run ? 45 : 28;
    const v = this._gainFor(pos, range);
    if (v < 0.02 || this._throttle('st' + (pos.id || ''), 150)) return;
    this._stepSound(kind, (crouch ? 0.05 : run ? 0.32 : 0.22) * v, this._dest(pos));
  }
  eat() { this.noise(0.2, 800, 1.5, 0.2); }
  bow() { this.noise(0.1, 1200, 2, 0.2); this.tone(300, 0.1, 0.1, 'triangle', 0.6); }
  hurt() { if (this._throttle('hurt', 150)) return; this.tone(220, 0.15, 0.2, 'sawtooth', 0.6); }
  hitmark() { this.tone(1400, 0.04, 0.15, 'square'); }
  craftDone() { this.tone(880, 0.08, 0.12, 'sine'); this.tone(1320, 0.1, 0.12, 'sine', 1, 0.08); }
}

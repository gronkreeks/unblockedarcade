// Synthesised sound effects (WebAudio). Distance-attenuated for world sounds.
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
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
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
  _throttle(key, ms) { const t = performance.now(); if (this.last[key] && t - this.last[key] < ms) return true; this.last[key] = t; return false; }
  noise(dur, freq, q, vol, type = 'bandpass', at = 0) {
    if (!this.ctx || vol <= 0.003) return;
    const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, vol, type = 'sine', slide = 0, at = 0) {
    if (!this.ctx || vol <= 0.003) return;
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  shot(def, src) {
    const v = this._gainFor(src, 420) * (src && src.isPlayer ? 1 : 0.9);
    if (v < 0.01 || this._throttle('shot' + (src && src.id), 30)) return;
    if (def.type === 'bow') { this.noise(0.12, 900, 2, 0.25 * v); return; }
    const heavy = def.icon === 'rifle' || def.icon === 'shotgun';
    this.noise(heavy ? 0.35 : 0.22, heavy ? 700 : 1100, 0.7, 0.6 * v);
    this.tone(heavy ? 90 : 140, 0.18, 0.35 * v, 'triangle', 0.4);
  }
  explosion(c) { const v = this._gainFor(c, 600); this.noise(1.4, 180, 0.6, 0.9 * v, 'lowpass'); this.tone(55, 0.9, 0.6 * v, 'sine', 0.5); }
  hit(kind) { if (kind === 'wood') this.noise(0.12, 500, 3, 0.35); else if (kind === 'flesh') this.noise(0.1, 300, 1, 0.3, 'lowpass'); else { this.noise(0.08, 2400, 4, 0.3); this.tone(900, 0.06, 0.08, 'square'); } }
  hitAt(kind, pos) { const v = this._gainFor(pos, 60); if (v < 0.02 || this._throttle('hit' + kind, 80)) return; if (kind === 'wood') this.noise(0.12, 500, 3, 0.3 * v); else this.noise(0.08, 2400, 4, 0.25 * v); }
  swing() { this.noise(0.15, 600, 0.8, 0.12, 'bandpass'); }
  pickup() { this.tone(660, 0.08, 0.12, 'sine', 1.4); }
  build() { this.noise(0.18, 400, 2, 0.4); this.tone(180, 0.15, 0.15, 'square', 0.7); }
  door() { this.noise(0.25, 300, 3, 0.25); this.tone(120, 0.2, 0.1, 'sawtooth', 0.8); }
  deny() { this.tone(200, 0.12, 0.15, 'square'); this.tone(150, 0.15, 0.15, 'square', 1, 0.1); }
  click() { this.tone(1600, 0.03, 0.12, 'square'); }
  reload() { this.tone(800, 0.04, 0.12, 'square'); this.tone(500, 0.05, 0.12, 'square', 1, 0.25); this.tone(900, 0.04, 0.12, 'square', 1, 0.6); }
  eat() { this.noise(0.2, 800, 1.5, 0.2); }
  bow() { this.noise(0.1, 1200, 2, 0.2); this.tone(300, 0.1, 0.1, 'triangle', 0.6); }
  hurt() { if (this._throttle('hurt', 150)) return; this.tone(220, 0.15, 0.2, 'sawtooth', 0.6); }
  hitmark() { this.tone(1400, 0.04, 0.15, 'square'); }
  craftDone() { this.tone(880, 0.08, 0.12, 'sine'); this.tone(1320, 0.1, 0.12, 'sine', 1, 0.08); }
}

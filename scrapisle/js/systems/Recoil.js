// Weapon recoil: fixed, learnable per-weapon patterns, smooth camera kick, accumulation, recovery,
// hip-fire vs aimed behaviour, weapon sway and spread bloom. Used identically by the player and bots.

// Pattern control points: [shotIndex, pitchUpDeg, yawRightDeg] per shot. Values between points interpolate.
// Shots past the last point repeat the last value. Semi-auto weapons use short patterns that reset quickly.
const R = {
  assault_rifle: { pts: [[0, 1.9, 0.0], [3, 2.3, 0.35], [7, 2.0, -0.6], [11, 1.4, -1.0], [15, 1.1, 0.4], [19, 1.0, 1.1], [23, 0.9, 0.2], [27, 0.85, -0.8], [30, 0.8, -0.4]], kick: 0.075, recover: 0.3, ads: 0.72, crouch: 0.85, punch: 1.4, kickback: 0.07, bloom: 0.09, maxBloom: 2.4, sway: 0.08 },
  drum_smg: { pts: [[0, 1.1, 0.25], [5, 1.0, 0.5], [10, 0.85, -0.3], [15, 0.75, -0.6], [20, 0.7, 0.2]], kick: 0.06, recover: 0.4, ads: 0.75, crouch: 0.85, punch: 0.8, kickback: 0.045, bloom: 0.07, maxBloom: 2.0, sway: 0.06 },
  scrap_smg: { pts: [[0, 0.95, -0.3], [2, 0.9, 0.35], [4, 0.85, -0.35], [6, 0.8, 0.4], [9, 0.75, -0.45], [12, 0.75, 0.45], [16, 0.7, -0.4], [24, 0.7, 0.4]], kick: 0.055, recover: 0.42, ads: 0.78, crouch: 0.85, punch: 0.7, kickback: 0.04, bloom: 0.08, maxBloom: 2.2, sway: 0.06 },
  semi_rifle: { pts: [[0, 1.5, 0.22], [1, 1.6, -0.15], [2, 1.7, 0.3], [3, 1.8, -0.1]], kick: 0.06, recover: 0.55, ads: 0.68, crouch: 0.85, punch: 1.1, kickback: 0.06, bloom: 0.15, maxBloom: 1.6, sway: 0.07 },
  semi_pistol: { pts: [[0, 1.7, 0.3], [1, 1.9, -0.2], [2, 2.0, 0.35]], kick: 0.05, recover: 0.6, ads: 0.75, crouch: 0.9, punch: 1.2, kickback: 0.05, bloom: 0.18, maxBloom: 1.8, sway: 0.09 },
  revolver: { pts: [[0, 2.4, 0.45], [1, 2.6, 0.2], [2, 2.7, 0.5]], kick: 0.06, recover: 0.6, ads: 0.75, crouch: 0.9, punch: 1.6, kickback: 0.06, bloom: 0.2, maxBloom: 1.8, sway: 0.09 },
  pipe_pistol: { pts: [[0, 6.0, 1.0]], kick: 0.08, recover: 0.5, ads: 0.85, crouch: 0.9, punch: 3.2, kickback: 0.1, bloom: 0, maxBloom: 0, sway: 0.15 },
  double_barrel: { pts: [[0, 7.5, -1.2], [1, 8.5, 1.4]], kick: 0.09, recover: 0.45, ads: 0.85, crouch: 0.9, punch: 3.8, kickback: 0.13, bloom: 0, maxBloom: 0, sway: 0.1 },
  pump_shotgun: { pts: [[0, 6.5, 0.8]], kick: 0.085, recover: 0.5, ads: 0.85, crouch: 0.9, punch: 3.4, kickback: 0.12, bloom: 0, maxBloom: 0, sway: 0.1 },
  rocket_launcher: { pts: [[0, 6.0, 1.0]], kick: 0.12, recover: 0.5, ads: 0.85, crouch: 0.85, punch: 3.4, kickback: 0.16, bloom: 0, maxBloom: 0, sway: 0.3, cycle: 1.0 },
  bolt_rifle: { pts: [[0, 5.0, 0.6]], kick: 0.09, recover: 0.65, ads: 0.8, crouch: 0.85, punch: 2.6, kickback: 0.11, bloom: 0, maxBloom: 0, sway: 0.18, cycle: 1.0 },
  crossbow: { pts: [[0, 2.0, 0.3]], kick: 0.07, recover: 0.7, ads: 0.9, crouch: 0.9, punch: 1.0, kickback: 0.05, bloom: 0, maxBloom: 0, sway: 0.1 },
  hunting_bow: { pts: [[0, 0.6, 0.1]], kick: 0.06, recover: 0.8, ads: 1, crouch: 1, punch: 0.4, kickback: 0.02, bloom: 0, maxBloom: 0, sway: 0.22 },
};
const DEFAULT = { pts: [[0, 1.5, 0.2]], kick: 0.07, recover: 0.5, ads: 0.8, crouch: 0.9, punch: 1, kickback: 0.05, bloom: 0.1, maxBloom: 1.5, sway: 0.1 };
export const recoilProfile = (id) => R[id] || DEFAULT;
const KICK = 1.4;         // recoil strength on top of each weapon's pattern
const GUN_SPREAD = 0.4;   // gun spread is kept tight

// Pattern value for shot index i (deterministic).
export function patternAt(id, i) {
  const pts = recoilProfile(id).pts;
  if (i <= pts[0][0]) return { p: pts[0][1], y: pts[0][2] };
  for (let k = 1; k < pts.length; k++) {
    if (i <= pts[k][0]) {
      const a = pts[k - 1], b = pts[k], t = (i - a[0]) / (b[0] - a[0]);
      return { p: a[1] + (b[1] - a[1]) * t, y: a[2] + (b[2] - a[2]) * t };
    }
  }
  const l = pts[pts.length - 1];
  return { p: l[1], y: l[2] };
}
// How hard a weapon is to control (degrees of drift per second of fire), used by abstract combat.
export function controlDifficulty(def) {
  if (!def || !def.rpm) return 0;
  let s = 0; for (let i = 0; i < 10; i++) { const r = patternAt(def.id, i); s += Math.hypot(r.p, r.y); }
  return (s / 10) * Math.min(def.rpm, 700) / 60;
}

const D2R = Math.PI / 180;

export class RecoilState {
  constructor() { this.i = 0; this.last = -99; this.pendP = 0; this.pendY = 0; this.accP = 0; this.accY = 0; this.bloom = 0; this.punch = 0; this.punchY = 0; this.kickZ = 0; this.cycleT = 0; this.weapon = null; this.swayT = Math.random() * 10; }
}
export function rc(s) { return s.rc || (s.rc = new RecoilState()); }

// Called when a shot is fired. Queues the kick for this shot and returns spread to use (degrees).
export function onShot(s, def, now, opts = {}) {
  const st = rc(s), P = recoilProfile(def.id);
  if (st.weapon !== def.id) { st.weapon = def.id; st.i = 0; st.accP = 0; st.accY = 0; st.bloom = 0; }
  const reset = (60 / (def.rpm || 60)) * 1.8 + 0.12;
  if (now - st.last > reset) { st.i = 0; st.accP = 0; st.accY = 0; }
  const r = patternAt(def.id, st.i);
  let mult = opts.aiming ? P.ads : 1;
  if (s.crouch) mult *= P.crouch;
  if (opts.moving) mult *= 1.15;
  // tiny per-shot variation keeps it from feeling mechanical while the pattern stays learnable
  const jitter = 1 + (Math.sin(st.i * 12.9898 + def.id.length) * 0.5) * 0.06;
  st.pendP += r.p * mult * jitter * KICK; st.pendY += r.y * mult * KICK;
  st.punch = Math.min(6, st.punch + P.punch * mult);
  st.punchY += (r.y >= 0 ? 1 : -1) * P.punch * 0.25 * mult;
  st.kickZ = Math.min(0.25, st.kickZ + P.kickback);
  st.bloom = Math.min(P.maxBloom, st.bloom + P.bloom * (opts.aiming ? 0.4 : 1));
  if (P.cycle) st.cycleT = P.cycle;
  st.i++; st.last = now;
  return st;
}
// Current spread in degrees for the next shot.
export function spreadFor(s, def, opts = {}) {
  const st = rc(s);
  // guns are precise; where the bullets go is about controlling the kick (bows keep their own spread)
  const tight = def.type === 'gun' ? GUN_SPREAD : 1;
  let sp = ((opts.aiming ? def.aimSpread : def.spread) + (st.weapon === def.id ? st.bloom * 0.5 : 0)) * tight;
  if (opts.moving) sp *= opts.aiming ? 1.6 : 1.8;
  if (s.crouch) sp *= 0.8;
  if (!s.onGround && s.onGround !== undefined) sp *= 2.2;
  return sp;
}
// Per-frame update: applies queued kick smoothly to yaw/pitch, recovers when not firing,
// decays bloom and visual punch. `pull` (0..1) is how much of the remaining drift the shooter
// actively pulls back this frame (bots use it to model recoil control; the player uses the mouse).
export function update(s, def, dt, now, pull = 0) {
  const st = rc(s);
  const P = def ? recoilProfile(def.id) : DEFAULT;
  // apply queued kick over P.kick seconds
  if (st.pendP !== 0 || st.pendY !== 0) {
    const k = Math.min(1, dt / P.kick);
    const dp = st.pendP * k, dy = st.pendY * k;
    st.pendP -= dp; st.pendY -= dy;
    if (Math.abs(st.pendP) < 1e-3) st.pendP = 0; if (Math.abs(st.pendY) < 1e-3) st.pendY = 0;
    s.pitch = Math.min(1.5, s.pitch + dp * D2R); s.yaw -= dy * D2R;
    st.accP += dp; st.accY += dy;
  }
  const firing = now - st.last < (60 / ((def && def.rpm) || 60)) * 1.5 + 0.05;
  // shooter compensation
  if (pull > 0 && (st.accP > 0.01 || Math.abs(st.accY) > 0.01)) {
    const cp = st.accP * Math.min(1, pull), cy = st.accY * Math.min(1, pull);
    s.pitch -= cp * D2R; s.yaw += cy * D2R; st.accP -= cp; st.accY -= cy;
  }
  // automatic partial recovery once the trigger is released
  if (!firing && (st.accP > 0.01 || Math.abs(st.accY) > 0.01)) {
    const budgetP = st.accP * P.recover, rate = Math.min(1, dt * 7);
    const rp = budgetP * rate, ry = st.accY * P.recover * rate;
    s.pitch -= rp * D2R; s.yaw += ry * D2R;
    st.accP -= rp / Math.max(0.05, P.recover); st.accY -= ry / Math.max(0.05, P.recover);
    if (st.accP < 0.02) st.accP = 0; if (Math.abs(st.accY) < 0.02) st.accY = 0;
  }
  st.bloom = Math.max(0, st.bloom - dt * (firing ? 0.6 : 3.5));
  st.punch *= Math.exp(-dt * 14); st.punchY *= Math.exp(-dt * 12);
  st.kickZ *= Math.exp(-dt * 16);
  if (st.cycleT > 0) st.cycleT = Math.max(0, st.cycleT - dt);
  st.swayT += dt;
  return st;
}
// Weapon sway (degrees) from breathing and movement; larger when moving, smaller when crouched and aiming.
export function sway(s, def, aiming, speed) {
  const st = rc(s), P = def ? recoilProfile(def.id) : DEFAULT;
  const t = st.swayT;
  let amp = P.sway * (aiming ? 1 : 2.2) * (s.crouch ? 0.55 : 1) * (1 + Math.min(1, speed / 4) * 1.5);
  return { p: Math.sin(t * 1.3) * amp * 0.6 + Math.sin(t * 2.9) * amp * 0.2, y: Math.cos(t * 0.9) * amp + Math.sin(t * 2.1) * amp * 0.25 };
}

// Metabolism, temperature, bleeding, radiation, healing, eating/using items, fall damage.
import { ITEMS } from '../data/items.js';
import { clamp, dist } from '../core/util.js';

export const MAX_CAL = 500, MAX_HYD = 250;

export class SurvivalSystem {
  constructor(game) { this.game = game; this.radZones = []; }

  setRadZones(z) { this.radZones = z; }
  radiationAt(x, y, z) {
    let lvl = 0;
    for (const r of this.radZones) if (y >= r.y0 && y <= r.y1 && dist(x, z, r.x, r.z) < r.r) lvl = Math.max(lvl, r.level * (1 - 0.4 * dist(x, z, r.x, r.z) / r.r));
    return lvl;
  }
  // Ambient temperature at a point including warmth sources and shelter.
  ambientTemp(s) {
    const W = this.game.world, env = this.game.env;
    let t = W.baseTemperature(s.x, s.z) + env.tempOffset();
    // campfires / furnaces nearby
    for (const d of this.game.deploy.near(s.x, s.z, 4, d => d.on && (d.type === 'campfire' || d.type === 'furnace'))) t += 14 * (1 - dist(s.x, s.z, d.x, d.z) / 4);
    // indoors: under a floor/roof piece
    if (this.game.build.structureNear(s.x, s.z, 4)) t += 6;
    const st = s.activeStack(); if (st && ITEMS[st.id].warmth) t += ITEMS[st.id].warmth;
    const wet = W.waterSurface(s.x, s.z); if (wet && wet.y > s.y + 0.6) t -= 8;
    return t;
  }

  tick(s, dt, sprinting = false) {
    if (!s.alive) return;
    const amb = this.ambientTemp(s);
    const felt = amb + s.warmth();
    s.bodyTemp += (felt - s.bodyTemp) * Math.min(1, dt * 0.3);
    // metabolism
    let calRate = 0.045, hydRate = 0.04;
    if (sprinting) { calRate *= 1.8; hydRate *= 1.8; }
    if (s.bodyTemp < 5) calRate *= 1 + (5 - s.bodyTemp) * 0.08;
    if (s.bodyTemp > 32) hydRate *= 1 + (s.bodyTemp - 32) * 0.1;
    s.cal = Math.max(0, s.cal - calRate * dt);
    s.hyd = Math.max(0, s.hyd - hydRate * dt);
    let dmg = 0;
    if (s.cal <= 0) dmg += 0.25 * dt;
    if (s.hyd <= 0) dmg += 0.35 * dt;
    if (s.bodyTemp < -8) dmg += (-8 - s.bodyTemp) * 0.02 * dt;
    if (s.bodyTemp > 42) dmg += (s.bodyTemp - 42) * 0.05 * dt;
    // bleeding
    if (s.bleed > 0) { dmg += s.bleed * dt; s.bleed = Math.max(0, s.bleed - dt * 0.1); }
    // radiation: exposure builds poisoning, poisoning hurts above 25
    const rad = this.radiationAt(s.x, s.y, s.z);
    if (rad > 0) s.rads = Math.min(500, s.rads + rad * 6 * (1 - s.radProtection()) * dt);
    else s.rads = Math.max(0, s.rads - dt * 0.4);
    if (s.rads > 25) dmg += (s.rads - 25) * 0.004 * dt;
    s.radLevel = rad;
    // poison (raw meat)
    if (s.poison > 0) { const k = Math.min(s.poison, dt * 0.5); s.poison -= k; dmg += k; }
    // healing: over-time pool, plus slow regen when well fed
    if (s.hot > 0) { const k = Math.min(s.hot, dt * 2.5); s.hot -= k; s.hp = Math.min(s.maxHp, s.hp + k); }
    if (s.cal > 150 && s.hyd > 70 && s.bleed <= 0 && s.rads < 25 && s.bodyTemp > 5 && s.bodyTemp < 38) s.hp = Math.min(s.maxHp, s.hp + 0.06 * dt);
    if (dmg > 0) {
      s.hp -= dmg;
      if (s.hp <= 0) this.game.combat.kill(s, { type: 'survival', cause: s.cal <= 0 ? 'starvation' : s.hyd <= 0 ? 'dehydration' : s.bleed > 0 ? 'bleeding' : s.rads > 25 ? 'radiation' : 'exposure' });
    }
  }
  fallDamage(s, speed) {
    if (speed < 10) return;
    const dmg = (speed - 10) * 9;
    this.game.combat.damageActor(s, dmg, { type: 'fall', area: 'legs' });
    if (speed > 13 && Math.random() < 0.5) s.bleed = Math.min(3, s.bleed + 0.5);
  }

  // Eat food or use medical item from a container slot. Returns true if used.
  use(s, cont, i) {
    const st = cont.slots[i]; if (!st) return false;
    const d = ITEMS[st.id];
    if (d.type === 'food') {
      s.cal = clamp(s.cal + (d.cal || 0), 0, 500); s.hyd = clamp(s.hyd + (d.hyd || 0), 0, 250);
      s.hp = Math.min(s.maxHp, s.hp + (d.heal || 0));
      if (d.poison) s.poison += d.poison * (Math.random() < 0.6 ? 1 : 0);
    } else if (d.type === 'med') {
      s.hp = Math.min(s.maxHp, s.hp + d.heal); s.hot += d.hot;
      if (d.stopBleed) s.bleed = 0;
      if (d.rad) s.rads = Math.max(0, s.rads - d.rad);
    } else return false;
    st.n -= 1; if (st.n <= 0) cont.slots[i] = null;
    cont.touch();
    this.game.events.emit('used', { surv: s, id: d.id });
    return true;
  }
  // Drink fresh water in front of the survivor.
  drink(s) {
    const w = this.game.world.waterSurface(s.x + Math.sin(s.yaw) * 1.2, s.z + Math.cos(s.yaw) * 1.2) || this.game.world.waterSurface(s.x, s.z);
    if (!w) return false;
    if (w.fresh) { s.hyd = Math.min(250, s.hyd + 30); return 'fresh'; }
    s.hyd = Math.max(0, s.hyd - 5); s.hp -= 2; return 'salt';
  }
}

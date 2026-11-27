// A survivor is the player or a bot. Same data, same rules.
import { SurvivorInventory } from '../systems/InventorySystem.js';
import { ITEMS, WEAR_SLOTS } from '../data/items.js';
import { DEFAULT_BLUEPRINTS } from '../data/recipes.js';
import { uid } from '../core/util.js';

export class Survivor {
  constructor(o = {}) {
    this.kind = 'survivor';
    this.id = o.id || uid('s');
    this.name = o.name || 'Survivor';
    this.isPlayer = !!o.isPlayer;
    this.team = o.team || this.id;
    this.x = o.x || 0; this.y = o.y || 0; this.z = o.z || 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.r = 0.35; this.h = 1.8; this.crouch = false;
    this.onGround = true;
    this.hp = 100; this.maxHp = 100;
    this.cal = 250; this.hyd = 150;   // max 500 / 250
    this.bodyTemp = 20;               // felt temperature °C
    this.bleed = 0;                   // hp/s
    this.rads = 0;                    // radiation poisoning
    this.poison = 0;
    this.hot = 0;                     // healing over time pool
    this.alive = true;
    this.inv = new SurvivorInventory();
    this.active = 0;                  // belt slot
    this.bp = new Set(DEFAULT_BLUEPRINTS);
    this.craftQueue = [];
    this.lastHitBy = null; this.lastHitTime = -999;
    this.swingT = 0; this.fireT = 0; this.reloadT = 0; this.useT = 0;
    this.recoil = 0;
    this.kills = 0; this.deaths = 0;
    this.spawnedAt = 0;
    this.wounded = 0;
  }
  get eyeH() { return this.crouch ? 1.15 : 1.62; }
  eye() { return { x: this.x, y: this.y + this.eyeH, z: this.z }; }
  activeStack() { return this.inv.belt.slots[this.active] || null; }
  activeDef() { const s = this.activeStack(); return s ? ITEMS[s.id] : null; }
  dir() {
    const cp = Math.cos(this.pitch);
    return { x: Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: Math.cos(this.yaw) * cp };
  }
  // Total protection for a body area and damage type ('proj' | 'melee'), capped at 80%.
  protection(area, type) {
    let p = 0;
    for (const s of this.inv.wear.slots) {
      if (!s) continue;
      const d = ITEMS[s.id];
      if (d.covers && d.covers.includes(area)) p += (d.prot[type] || 0) * (0.35 + 0.65 * (s.c ?? 1));
    }
    return Math.min(0.8, p);
  }
  warmth() { let w = 0; for (const s of this.inv.wear.slots) if (s) w += ITEMS[s.id].cold || 0; return w; }
  radProtection() { let r = 0; for (const s of this.inv.wear.slots) if (s) r += ITEMS[s.id].rad || 0; return Math.min(0.95, r); }
  armorScore() {
    let a = 0;
    for (const s of this.inv.wear.slots) if (s) { const d = ITEMS[s.id]; if (d.prot) a += (d.prot.proj + d.prot.melee) * d.covers.length; }
    return a;
  }
  wearing() { return this.inv.wear.slots.map((s, i) => (s ? s.id : null)); }
  serialize() {
    return {
      id: this.id, name: this.name, isPlayer: this.isPlayer, team: this.team,
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch,
      hp: this.hp, cal: this.cal, hyd: this.hyd, bleed: this.bleed, rads: this.rads, poison: this.poison, hot: this.hot, alive: this.alive,
      inv: this.inv.serialize(), active: this.active, bp: [...this.bp], craftQueue: this.craftQueue.map(q => ({ ...q })),
      kills: this.kills, deaths: this.deaths, crouch: this.crouch,
    };
  }
  load(d) {
    Object.assign(this, {
      id: d.id, name: d.name, isPlayer: d.isPlayer, team: d.team, x: d.x, y: d.y, z: d.z, yaw: d.yaw, pitch: d.pitch,
      hp: d.hp, cal: d.cal, hyd: d.hyd, bleed: d.bleed, rads: d.rads, poison: d.poison || 0, hot: d.hot || 0, alive: d.alive,
      active: d.active, kills: d.kills || 0, deaths: d.deaths || 0,
    });
    this.inv.load(d.inv);
    this.bp = new Set([...DEFAULT_BLUEPRINTS, ...(d.bp || [])]);
    this.craftQueue = (d.craftQueue || []).map(q => ({ ...q }));
  }
}

export { WEAR_SLOTS };

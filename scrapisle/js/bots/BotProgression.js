// What a bot should work towards next, from its real inventory, blueprints, base and team.
// Produces a wishlist and resolves the first unmet wish into a concrete activity.
import { ITEMS, weaponScore } from '../data/items.js';
import { RECIPE } from '../data/recipes.js';
import { SKILL, PERSONALITIES } from './BotProfiles.js';

// Where raw resources come from.
export const SOURCE = {
  wood: 'tree', stones: 'stone', metal_ore: 'metal', sulfur_ore: 'sulfur', hqm_ore: 'metal',
  metal_frag: 'smelt', sulfur: 'smelt', hqm: 'smelt', charcoal: 'smelt',
  cloth: 'hemp', leather: 'hunt', animal_fat: 'hunt', bone_frag: 'hunt', raw_meat: 'hunt',
  scrap: 'loot',
};
const SMELT_FROM = { metal_frag: 'metal_ore', sulfur: 'sulfur_ore', hqm: 'hqm_ore', charcoal: 'wood' };
const LOOT_ONLY = new Set(['scrap', 'rope', 'tarp', 'sewing_kit', 'gears', 'metal_pipe', 'metal_spring', 'metal_blade', 'sheet_metal', 'road_sign', 'semi_body', 'smg_body', 'rifle_body', 'tech_trash', 'propane_tank', 'electric_fuse']);

const has = (b, id, n = 1) => b.inv.count(id) + b.inv.wear.count(id) >= n;
const hasAny = (b, ids) => ids.some(id => has(b, id));

export class BotProgression {
  constructor(game) { this.game = game; this.cache = new Map(); }

  // Team progression snapshot (cached ~1 s).
  progressOf(team) {
    const c = this.cache.get(team.id);
    if (c && this.game.now - c.t < 1) return c.p;
    const G = this.game;
    const st = team.base && team.base.st ? G.build.structures.get(team.base.st) : null;
    const deps = st ? G.deploy.list.filter(d => d.st === st.id) : [];
    const bench = deps.reduce((m, d) => Math.max(m, d.def.bench || 0), 0);
    const boxes = deps.filter(d => d.type === 'wood_box' || d.type === 'large_box');
    let boxSpace = 0; for (const bx of boxes) boxSpace += bx.cont.emptyCount();
    const members = G.teams.membersOf(team);
    const bp = new Set(); for (const m of members) for (const id of m.bp) bp.add(id);
    const stash = (id) => boxes.reduce((n, bx) => n + bx.cont.count(id), 0) + (deps.find(d => d.type === 'furnace')?.cont.count(id) || 0);
    let scrap = stash('scrap'); for (const m of members) scrap += m.inv.count('scrap');
    let hqm = stash('hqm'); for (const m of members) hqm += m.inv.count('hqm');
    const mult = G.settings.mult;
    const p = {
      st, deps, bench, boxes, boxSpace, bp, stash, scrap, hqm,
      knows: (id) => bp.has(id),
      furnace: deps.find(d => d.type === 'furnace') || null,
      tc: deps.find(d => d.type === 'claim_cabinet') || null,
      research: deps.find(d => d.type === 'research_table') || null,
      benchDep: (tier) => deps.filter(d => (d.def.bench || 0) >= tier).sort((a, b) => a.def.bench - b.def.bench)[0] || null,
      upkeepH: st ? G.build.upkeepHours(st) : 0,
      wantBench2: scrap >= 450 || hqm >= 20 * mult,
      wantBench3: scrap >= 1000,
      rich: hqm >= 300,
    };
    this.cache.set(team.id, { t: G.now, p });
    return p;
  }

  // Ordered wishes for one bot. Each: { id, n, why }
  wishes(b, team, prog) {
    const ai = b.ai, S = ai.S, P = PERSONALITIES[ai.pers];
    const W = [];
    const want = (id, n, why) => W.push({ id, n, why });
    const bench = prog.bench;
    // tools
    if (!hasAny(b, ['stone_hatchet', 'hatchet', 'salvaged_axe'])) want('stone_hatchet', 1, 'tools');
    if (!hasAny(b, ['stone_pickaxe', 'pickaxe', 'salvaged_icepick'])) want('stone_pickaxe', 1, 'tools');
    // first weapon
    const best = this.bestWeapon(b);
    if (weaponScore(best) < 9) {
      if (ai.pers === 'hunter' || ai.pers === 'fighter' || S === SKILL.expert || S === SKILL.hard) { want('hunting_bow', 1, 'weapon'); want('wooden_arrow', 24, 'ammo'); }
      else want('wooden_spear', 1, 'weapon');
    }
    // basic clothes + bandages
    if (!has(b, 'cloth_shirt') && !this.wearsSlot(b, 'chest')) want('cloth_shirt', 1, 'clothes');
    if (!has(b, 'cloth_pants') && !this.wearsSlot(b, 'kilt')) want('cloth_pants', 1, 'clothes');
    if (b.inv.count('bandage') < 2) want('bandage', 3, 'meds');
    if (!prog.st) return W; // the base comes before anything else past the basics
    // metal tools once a bench exists
    if (bench >= 1) {
      if (!hasAny(b, ['hatchet', 'salvaged_axe'])) want('hatchet', 1, 'tools');
      if (!hasAny(b, ['pickaxe', 'salvaged_icepick'])) want('pickaxe', 1, 'tools');
      if (!hasAny(b, ['revolver', 'double_barrel', 'semi_pistol', 'pump_shotgun', 'drum_smg', 'scrap_smg', 'semi_rifle', 'assault_rifle', 'bolt_rifle', 'crossbow'])) {
        if (ai.pers === 'fighter' || ai.pers === 'looter') want('double_barrel', 1, 'weapon'); else want('revolver', 1, 'weapon');
      }
      if (b.inv.count('med_syringe') < 2) want('med_syringe', 2, 'meds');
      if (!this.wearsSlot(b, 'head') || this.armorOf(b, 'head') < 0.2) want('coffee_can_helmet', 1, 'armour');
      if (this.armorOf(b, 'chest') < 0.3) want('roadsign_vest', 1, 'armour');
    }
    if (bench >= 2) {
      if (!hasAny(b, ['semi_rifle', 'assault_rifle', 'bolt_rifle', 'drum_smg', 'scrap_smg', 'pump_shotgun'])) want(ai.pers === 'fighter' ? 'pump_shotgun' : 'semi_rifle', 1, 'weapon');
      if (!hasAny(b, ['salvaged_axe'])) want('salvaged_axe', 1, 'tools');
      if (b.inv.count('large_medkit') < 1) want('large_medkit', 1, 'meds');
      if (!has(b, 'hazmat_suit') && (ai.pers === 'looter')) want('hazmat_suit', 1, 'armour');
      if (!this.wearsSlot(b, 'kilt')) want('roadsign_kilt', 1, 'armour');
    }
    if (bench >= 3) {
      if (!hasAny(b, ['assault_rifle', 'bolt_rifle'])) want(S.headChance > 0.3 && Math.random() < 0.5 ? 'bolt_rifle' : 'assault_rifle', 1, 'weapon');
      if (!this.wearsSlot(b, 'face')) want('metal_facemask', 1, 'armour');
      if (this.armorOf(b, 'chest') < 0.5) want('metal_chest', 1, 'armour');
    }
    // ammo for whatever gun they carry
    const g = this.bestGun(b);
    if (g) { const d = ITEMS[g.id]; const at = d.ammo.find(a => RECIPE[a]) || d.ammo[0]; const target = d.type === 'bow' ? 24 : Math.max(20, d.mag * 3); if (b.inv.count(at) + (g.ammo || 0) < target) want(at, target, 'ammo'); }
    return W;
  }
  wearsSlot(b, slot) { return b.inv.wear.slots.some(s => s && ITEMS[s.id].slot === slot); }
  armorOf(b, area) { return b.protection(area, 'proj'); }
  bestWeapon(b) {
    let best = null, bs = 0;
    for (const s of [...b.inv.belt.slots, ...b.inv.main.slots]) { if (!s) continue; const d = ITEMS[s.id]; if (!d.dmg) continue; if (s.c !== undefined && s.c <= 0) continue; const sc = weaponScore(s.id) * ((d.type === 'gun' || d.type === 'bow') ? (b.inv.count(s.at) + (s.ammo || 0) > 0 ? 1 : 0.15) : 1); if (sc > bs) { bs = sc; best = s; } }
    return best ? best.id : null;
  }
  bestGun(b) {
    let best = null, bs = 0;
    for (const s of [...b.inv.belt.slots, ...b.inv.main.slots]) { if (!s) continue; const d = ITEMS[s.id]; if (d.type !== 'gun' && d.type !== 'bow') continue; if (s.c !== undefined && s.c <= 0) continue; const sc = weaponScore(s.id); if (sc > bs) { bs = sc; best = s; } }
    return best;
  }

  // Resolve "get n of id" into the next concrete activity. Returns activity or null if satisfied.
  // Activities: {a:'craft',id,times,tier} {a:'unlock',id,tier} {a:'withdraw',items} {a:'gather',res,need}
  //             {a:'smelt',ore,need} {a:'hunt'} {a:'hemp'} {a:'loot',need} {a:'needBench',tier} {a:'research',id}
  resolve(b, prog, id, n, depth = 0) {
    if (depth > 6) return null;
    const have = b.inv.count(id) + (depth === 0 ? b.inv.wear.count(id) : 0) + this.game.crafting.queuedCount(b, id);
    if (have >= n) return null;
    const need = n - have;
    // in the stash?
    if (prog.st && prog.stash(id) > 0) return { a: 'withdraw', items: { [id]: Math.min(need, prog.stash(id)) } };
    const rc = RECIPE[id];
    if (rc && !LOOT_ONLY.has(id)) {
      if (rc.tier > prog.bench) return { a: 'needBench', tier: rc.tier };
      if (!b.bp.has(id)) {
        if (prog.bp.has(id)) { b.bp.add(id); }
        else {
          // found one? research it
          if (prog.research && b.inv.count(id) > 0) return { a: 'research', id };
          const cost = this.game.crafting.unlockCost(id);
          const scrap = b.inv.count('scrap');
          if (scrap >= cost) return { a: 'unlock', id, tier: rc.tier };
          return this.resolve(b, prog, 'scrap', cost + (depth === 0 ? 0 : 0), depth + 1) || { a: 'unlock', id, tier: rc.tier };
        }
      }
      const times = Math.ceil(need / rc.n);
      for (const k in rc.cost) {
        const sub = this.resolve(b, prog, k, rc.cost[k] * times, depth + 1);
        if (sub) return sub;
      }
      return { a: 'craft', id, times, tier: rc.tier };
    }
    // raw / loot-only
    const src = SOURCE[id] || (LOOT_ONLY.has(id) ? 'loot' : null);
    if (src === 'smelt') {
      const ore = SMELT_FROM[id];
      if (b.inv.count(ore) >= Math.min(need, 50) || (prog.furnace && prog.furnace.cont.count(id) > 0)) return { a: 'smelt', ore, out: id, need };
      return this.resolve(b, prog, ore, Math.min(need, 600), depth + 1);
    }
    if (src === 'tree' || src === 'stone' || src === 'metal' || src === 'sulfur') return { a: 'gather', res: id, kind: src, need };
    if (src === 'hemp') return { a: 'hemp', need };
    if (src === 'hunt') return { a: 'hunt', need, res: id };
    if (src === 'loot') return { a: 'loot', need, res: id };
    return { a: 'loot', need, res: id };
  }

  // Buffer factor: on higher loot multipliers bots stockpile more because it costs them less.
  buffer(res) { const m = this.game.settings.mult; return { wood: 500, stones: 400, metal_ore: 300, sulfur_ore: 300 }[res] * (0.6 + m * 0.4) || 0; }
}

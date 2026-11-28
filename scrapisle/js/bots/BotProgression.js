// What a bot should work towards next, from its real inventory, blueprints, base and team.
// Produces a wishlist and resolves the first unmet wish into a concrete activity.
import { ITEMS, weaponScore } from '../data/items.js';
import { RECIPE } from '../data/recipes.js';
import { SKILL, PERSONALITIES, styleOf } from './BotProfiles.js';

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
    const tcDep = deps.find(d => d.type === 'claim_cabinet');
    const stash = (id) => boxes.reduce((n, bx) => n + bx.cont.count(id), 0) + (deps.find(d => d.type === 'furnace')?.cont.count(id) || 0) + (tcDep && !['wood', 'stones', 'metal_frag', 'hqm'].includes(id) ? tcDep.cont.count(id) : 0);
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
      // the player out-teching everyone pulls every clan up the tree sooner
      arms: G.armsRace ?? -1,
      wantBench2: scrap >= 450 * styleOf(team).bench || hqm >= 20 * mult || ((G.armsRace ?? -1) >= 2 && scrap >= 250),
      wantBench3: scrap >= 1000 * styleOf(team).bench || ((G.armsRace ?? -1) >= 3 && scrap >= 500),
      rich: hqm >= 300 * Math.min(1, styleOf(team).bench),
    };
    // progression milestones (for tests, the island news and the clan list)
    if (team.ms) {
      const ms = team.ms, now = G.now, mark = (k, ok) => { if (ok && ms[k] === undefined) ms[k] = Math.round(now); };
      mark('base', !!st); mark('tc', !!p.tc); mark('furnace', !!p.furnace); mark('bench1', bench >= 1); mark('bench2', bench >= 2); mark('bench3', bench >= 3);
      if (st) { let g = 9; for (const pc of st.pieces.values()) g = Math.min(g, pc.grade); mark('stone', g >= 2 && g < 9); mark('metal', g >= 3 && g < 9); mark('armored', g >= 4 && g < 9); }
      const guns = members.some(m => [...m.inv.belt.slots, ...m.inv.main.slots].some(x => x && ITEMS[x.id].type === 'gun'));
      mark('gun', guns);
      mark('rifle', members.some(m => [...m.inv.belt.slots, ...m.inv.main.slots].some(x => x && ['semi_rifle', 'assault_rifle', 'bolt_rifle'].includes(x.id))));
      mark('ak', members.some(m => m.inv.count('assault_rifle') > 0) || stash('assault_rifle') > 0);
      mark('rockets', members.some(m => m.inv.count('rocket_launcher') > 0) || stash('rocket_launcher') > 0);
    }
    this.cache.set(team.id, { t: G.now, p });
    return p;
  }

  // Ordered wishes for one bot. Each: { id, n, why }
  wishes(b, team, prog) {
    const ai = b.ai, S = ai.S, P = PERSONALITIES[ai.pers];
    const W = [];
    const want = (id, n, why) => W.push({ id, n, why });
    const bench = prog.bench;
    // scrap saved for the next workbench (level 2 costs 500, level 3 costs 1250)
    const reserve = bench === 1 ? 500 : bench === 2 ? 1250 : 0;
    const extra = (id) => prog.knows(id) || prog.scrap - this.game.crafting.unlockCost(id) >= reserve;
    // tools
    if (!hasAny(b, ['stone_hatchet', 'hatchet', 'salvaged_axe'])) want('stone_hatchet', 1, 'tools');
    if (!hasAny(b, ['stone_pickaxe', 'pickaxe', 'salvaged_icepick'])) want('stone_pickaxe', 1, 'tools');
    // first weapon
    const best = this.bestWeapon(b);
    // arms race: a gun as soon as the player has one (pipe pistol is the quickest)
    const myTier = (() => { const g = this.bestGun(b); return g ? (ITEMS[g.id].type === 'bow' ? 0 : (RECIPE[g.id] ? RECIPE[g.id].tier : 1)) : -1; })();
    if ((prog.arms ?? -1) >= 1 && myTier < 1 && bench >= 1) want(ai.pers === 'fighter' ? 'double_barrel' : 'pipe_pistol', 1, 'race');
    if ((prog.arms ?? -1) >= 2 && myTier < 2 && bench >= 2) want('semi_rifle', 1, 'race');
    if ((prog.arms ?? -1) >= 3 && myTier < 3 && bench >= 3) want('assault_rifle', 1, 'race');
    // everyone carries a ranged kit: a bow and arrows (a spear only as a stopgap before the base)
    const ranged = this.bestGun(b);
    if (!ranged) {
      if (weaponScore(best) < 9 && !prog.st && b.inv.count('cloth') + prog.stash('cloth') < 50) want('wooden_spear', 1, 'weapon');
      want('hunting_bow', 1, 'weapon');
    }
    if (!ranged || ITEMS[ranged.id].type === 'bow') { if (b.inv.count('wooden_arrow') + b.inv.count('hv_arrow') < 20) want('wooden_arrow', 30, 'ammo'); }
    // basic clothes + bandages
    if (!has(b, 'cloth_shirt') && !this.wearsSlot(b, 'chest')) want('cloth_shirt', 1, 'clothes');
    if (!has(b, 'cloth_pants') && !this.wearsSlot(b, 'kilt')) want('cloth_pants', 1, 'clothes');
    if (b.inv.count('bandage') < 2) want('bandage', 3, 'meds');
    if (!prog.st) return this.order(W); // the base comes before anything else past the basics
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
      // extras only when they don't eat the scrap saved for the next workbench
      if (!hasAny(b, ['salvaged_axe']) && extra('salvaged_axe')) want('salvaged_axe', 1, 'tools');
      if (b.inv.count('large_medkit') < 1 && extra('large_medkit')) want('large_medkit', 1, 'meds');
      if (!has(b, 'hazmat_suit') && (ai.pers === 'looter') && extra('hazmat_suit')) want('hazmat_suit', 1, 'armour');
      if (!this.wearsSlot(b, 'kilt') && extra('roadsign_kilt')) want('roadsign_kilt', 1, 'armour');
    }
    if (bench >= 3) {
      if (!hasAny(b, ['assault_rifle', 'bolt_rifle'])) want(S.headChance > 0.15 && Math.random() < 0.5 ? 'bolt_rifle' : 'assault_rifle', 1, 'weapon');
      if (!this.wearsSlot(b, 'face')) want('metal_facemask', 1, 'armour');
      if (this.armorOf(b, 'chest') < 0.5) want('metal_chest', 1, 'armour');
    }
    // a couple of barricades for gunfights once they're armed
    if (bench >= 1 && this.bestGun(b) && ITEMS[this.bestGun(b).id].type === 'gun' && b.inv.count('barricade') < 1) want('barricade', 2, 'ammo');
    // raid tech: the leader works toward a rocket launcher once the clan has a level 2 bench
    if (team && bench >= 2 && prog.scrap >= 300 && this.game.teams.leader(team) === b && !this.game.teams.membersOf(team).some(m => m.inv.count('rocket_launcher') > 0) && prog.stash('rocket_launcher') === 0) want('rocket_launcher', 1, 'raid');
    // ammo duty: when the clan's guns are short of rounds, about a third of the members (always the
    // same ones) farm sulfur, make gunpowder and craft ammunition before anything else
    if (team && prog.st) {
      const am = this.ammoStatus(team, prog);
      const short = Object.keys(am.need).filter(a => am.have[a] < am.need[a] * 0.6 && RECIPE[a]);
      if (short.length) {
        const crew = this.game.teams.alive(team).slice().sort((x, y) => x.id.localeCompare(y.id));
        const duty = crew.slice(0, Math.max(1, Math.ceil(crew.length / 3)));
        if (duty.includes(b)) want(short[0], Math.min(120, am.need[short[0]] - am.have[short[0]] + 20), 'race');
      }
    }
    // ammo for whatever gun they carry
    const g = this.ownedGun(b);
    if (g) { const d = ITEMS[g.id]; const at = d.ammo.find(a => RECIPE[a]) || d.ammo[0]; const target = d.type === 'bow' ? 24 : Math.max(20, d.mag * 3); if (b.inv.count(at) + (g.ammo || 0) < target) want(at, target, 'ammo'); }
    return this.order(W);
  }
  // Guns before comfort: catching up and better weapons come right after the first tools.
  order(W) {
    const PRI = { race: 0, weapon: 2, ammo: 3, raid: 3.5, clothes: 4, meds: 5, armour: 6 };
    const pri = (w) => w.why === 'tools' ? (/^stone_/.test(w.id) ? 1 : 7) : (PRI[w.why] ?? 8);
    return W.map((w, i) => [w, i]).sort((a, c) => pri(a[0]) - pri(c[0]) || a[1] - c[1]).map(x => x[0]);
  }
  wearsSlot(b, slot) { return b.inv.wear.slots.some(s => s && ITEMS[s.id].slot === slot); }
  armorOf(b, area) { return b.protection(area, 'proj'); }
  bestWeapon(b) {
    let best = null, bs = 0;
    for (const s of [...b.inv.belt.slots, ...b.inv.main.slots]) { if (!s) continue; const d = ITEMS[s.id]; if (!d.dmg) continue; if (s.c !== undefined && s.c <= 0) continue; const sc = weaponScore(s.id) * ((d.type === 'gun' || d.type === 'bow') ? (b.inv.count(s.at) + (s.ammo || 0) > 0 ? 1 : 0.15) : 1); if (sc > bs) { bs = sc; best = s; } }
    return best ? best.id : null;
  }
  // Best ranged weapon the bot can actually shoot (ammo carried or loaded). ownedGun ignores ammo.
  bestGun(b, ignoreAmmo = false) {
    let best = null, bs = 0;
    for (const s of [...b.inv.belt.slots, ...b.inv.main.slots]) {
      if (!s) continue; const d = ITEMS[s.id]; if (d.type !== 'gun' && d.type !== 'bow') continue; if (s.c !== undefined && s.c <= 0) continue;
      if (!ignoreAmmo && (s.ammo || 0) <= 0 && !d.ammo.some(a => b.inv.count(a) > 0)) continue;
      const sc = weaponScore(s.id); if (sc > bs) { bs = sc; best = s; }
    }
    return best;
  }
  ownedGun(b) { return this.bestGun(b, true); }
  ammoFor(id) { const d = ITEMS[id]; return d && d.ammo ? (d.ammo.find(a => RECIPE[a]) || d.ammo[0]) : null; }
  // Ammo the clan has against what its guns need (carried + stored). Cached with the progress snapshot.
  ammoStatus(team, prog) {
    if (prog._ammo) return prog._ammo;
    const G = this.game, need = {}, have = {};
    const addGun = (id) => { const d = ITEMS[id]; if (!d || d.type !== 'gun') return; const a = this.ammoFor(id); if (a) need[a] = (need[a] || 0) + Math.max(30, d.mag * 4); };
    for (const m of G.teams.membersOf(team)) for (const sl of [...m.inv.belt.slots, ...m.inv.main.slots]) if (sl) addGun(sl.id);
    for (const bx of prog.boxes) for (const sl of bx.cont.slots) if (sl) addGun(sl.id);
    for (const a in need) { have[a] = prog.stash(a); for (const m of G.teams.membersOf(team)) have[a] += m.inv.count(a); }
    return (prog._ammo = { need, have });
  }

  // Resolve "get n of id" into the next concrete activity. Returns activity or null if satisfied.
  // Activities: {a:'craft',id,times,tier} {a:'unlock',id,tier} {a:'withdraw',items} {a:'gather',res,need}
  //             {a:'smelt',ore,need} {a:'hunt'} {a:'hemp'} {a:'loot',need} {a:'needBench',tier} {a:'research',id}
  resolve(b, prog, id, n, depth = 0) {
    if (depth > 6) return null;
    const have = b.inv.count(id) + (depth === 0 ? b.inv.wear.count(id) : 0) + this.game.crafting.queuedCount(b, id);
    if (have >= n) return null;
    const need = n - have;
    // a gun in the box stays there until there are rounds for it: make the ammo first
    if (ITEMS[id] && ITEMS[id].type === 'gun' && prog.st && prog.stash(id) > 0) {
      const a = this.ammoFor(id), rounds = a ? b.inv.count(a) + prog.stash(a) : 0;
      if (a && rounds < ITEMS[id].mag * 2) return this.resolve(b, prog, a, ITEMS[id].mag * 3, depth + 1) || { a: 'withdraw', items: { [id]: 1 } };
    }
    // in the stash?
    if (prog.st && prog.stash(id) > 0) return { a: 'withdraw', items: { [id]: Math.min(need, prog.stash(id)) } };
    // low grade fuel: barrels drop it too, so not everyone has to go hunting for fat
    if (id === 'low_grade' && b.inv.count('animal_fat') + prog.stash('animal_fat') < 20 && ((b.id.charCodeAt(b.id.length - 1) + Math.floor(this.game.now / 300)) & 1)) return { a: 'loot', need, res: 'low_grade' };
    const rc = RECIPE[id];
    if (rc && !LOOT_ONLY.has(id)) {
      if (rc.tier > prog.bench) return { a: 'needBench', tier: rc.tier };
      if (!b.bp.has(id)) {
        if (prog.bp.has(id)) { b.bp.add(id); }
        else {
          // found one? research it
          if (prog.research && b.inv.count(id) > 0) return { a: 'research', id };
          // follow the tech tree: unlock the first locked item on the way there
          const step = this.game.crafting.nextOnPath(b, id);
          const cost = this.game.crafting.unlockCost(step);
          const scrap = b.inv.count('scrap');
          if (scrap >= cost) return { a: 'unlock', id: step, tier: rc.tier };
          return this.resolve(b, prog, 'scrap', cost, depth + 1) || { a: 'unlock', id: step, tier: rc.tier };
        }
      }
      const times = Math.ceil(need / rc.n);
      // every missing ingredient is a job; take one no teammate is already on (stash first)
      const subs = [];
      for (const k in rc.cost) { const sub = this.resolve(b, prog, k, rc.cost[k] * times, depth + 1); if (sub) subs.push(sub); }
      if (subs.length) {
        const w = subs.find(a => a.a === 'withdraw'); if (w) return w;
        const ai = this.game.bots.ai, team = this.game.teams.of(b);
        return subs.find(a => !ai.claimCount(team, ai.actKey(a), b)) || subs[0];
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

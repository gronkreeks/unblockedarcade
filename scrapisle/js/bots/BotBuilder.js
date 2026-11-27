// Base templates, base site selection and the next construction step for a team.
import { pieceCost, CELL, FOUND_H, GRADES } from '../data/building.js';
import { SKILL } from './BotProfiles.js';
import { dist, randRange } from '../core/util.js';

// core: [w,d] cells; airlock cell in front of the core; door from airlock into core.
const TEMPLATES = {
  small: { core: [2, 2], airlock: [0, -1] },
  medium: { core: [3, 2], airlock: [1, -1] },
  large: { core: [4, 3], airlock: [1, -1] },
};

export function buildTemplate(name) {
  const T = TEMPLATES[name];
  const [W, D] = T.core;
  const cells = [];
  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) cells.push([i, j]);
  cells.push(T.airlock);
  const set = new Set(cells.map(c => c.join(',')));
  const [ai, aj] = T.airlock;
  const doorways = new Set([`z:${ai},${aj},0`, `z:${ai},${aj + 1},0`]);
  const walls = [];
  for (const [i, j] of cells) {
    for (const [ni, nj, key] of [[i - 1, j, `x:${i},${j},0`], [i + 1, j, `x:${i + 1},${j},0`], [i, j - 1, `z:${i},${j},0`], [i, j + 1, `z:${i},${j + 1},0`]]) {
      const inside = set.has(`${ni},${nj}`);
      const isAirlockEdge = (i === ai && j === aj) || (ni === ai && nj === aj);
      if (inside && !isAirlockEdge) continue;  // open core
      if (walls.some(w => w.key === key)) continue;
      const [axis, rest] = key.split(':'); const [ei, ej] = rest.split(',').map(Number);
      walls.push({ key, axis, i: ei, j: ej, type: doorways.has(key) ? 'doorway' : 'wall' });
    }
  }
  // deployable slots along the core's inner walls (structure-local metres)
  const Wm = W * CELL, Dm = D * CELL, doorX = (ai + 0.5) * CELL;
  const slots = [];
  for (let x = 0.9; x <= Wm - 0.9; x += 2.3) slots.push({ x, z: Dm - 0.7, yaw: 0 });
  for (let z = 1.2; z <= Dm - 1.6; z += 2.3) { slots.push({ x: Wm - 0.7, z, yaw: Math.PI / 2 }); slots.push({ x: 0.7, z, yaw: -Math.PI / 2 }); }
  for (let x = 0.9; x <= Wm - 0.9; x += 2.3) if (Math.abs(x - doorX) > 1.6) slots.push({ x, z: 0.7, yaw: Math.PI });
  return {
    name, cells, walls, floors: cells.map(([i, j]) => ({ i, j })),
    doorways: [...doorways], airlock: T.airlock, slots,
    bagSpots: [{ x: (ai + 0.5) * CELL, z: (aj + 0.5) * CELL }, { x: Wm / 2, z: Dm / 2 }, { x: Wm / 2 + 1, z: Dm / 2 - 1 }, { x: Wm / 2 - 1, z: Dm / 2 + 0.8 }],
  };
}
const TPL_CACHE = {};
export const tpl = (n) => TPL_CACHE[n] || (TPL_CACHE[n] = buildTemplate(n));

// Deployable order inside the base. 'at' = minimum progression before it's wanted.
export const BASE_DEPLOY_ORDER = ['claim_cabinet', 'wood_box', 'furnace', 'workbench1', 'large_box', 'research_table', 'workbench2', 'large_box', 'workbench3'];

export class BotBuilder {
  constructor(game) { this.game = game; }

  templateFor(team) {
    const n = team.size;
    if (n >= 6) return 'large';
    if (n >= 3) return 'medium';
    return 'small';
  }

  // Pick a site for a team's base near a point. Returns { ox, oy, oz, yaw, template } or null.
  chooseSite(team, near, rng = Math.random) {
    const G = this.game, W = G.world;
    const name = this.templateFor(team), T = tpl(name);
    const S = SKILL[team.tier];
    let best = null, bs = -Infinity;
    const radius = 120 + S.siteSkill * 260;
    for (let t = 0; t < 60; t++) {
      const x = near.x + randRange(-radius, radius), z = near.z + randRange(-radius, radius);
      if (!W.inBounds(x, z, 80)) continue;
      const h = W.heightAt(x, z);
      if (h < 2 || W.waterSurface(x, z)) continue;
      const yaw = Math.floor(rng() * 4) * Math.PI / 2 + randRange(-0.3, 0.3);
      const site = this.fitSite(team, x, z, yaw, T);
      if (!site) continue;
      // scoring
      let score = 0;
      let res = 0;
      G.res.hash.query(x, z, 70, n => { if (n.type === 'tree') res += 0.5; else if (n.type === 'ore') res += 1.2; });
      score += Math.min(40, res) * (0.5 + S.siteSkill * 0.5);
      let nearest = Infinity;
      for (const st of G.build.structures.values()) { const zz = G.build.zoneOf(st); nearest = Math.min(nearest, dist(x, z, zz.x, zz.z)); }
      if (nearest < 70) continue;
      score += Math.min(150, nearest) * 0.15 * (0.4 + S.siteSkill);
      const mon = W.monuments.reduce((m, mm) => Math.min(m, dist(x, z, mm.x, mm.z) - mm.r), Infinity);
      if (mon < 50) continue;
      score -= Math.max(0, mon - 350) * 0.03;
      if (W.isRoad(x, z) || W.isRoad(x + 25, z) || W.isRoad(x - 25, z) || W.isRoad(x, z + 25) || W.isRoad(x, z - 25)) score -= 15 * S.siteSkill;
      const b = W.biomeAt(x, z);
      if (b === 5) score -= 6 * (1 - S.siteSkill * 0.5); // snow is cold
      score += (rng() - 0.5) * 30 * (1 - S.siteSkill * 0.7);
      if (score > bs) { bs = score; best = { ...site, template: name, score }; }
    }
    return best;
  }
  // Check every foundation of the template fits at this spot.
  fitSite(team, x, z, yaw, T) {
    const G = this.game;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let top = -Infinity;
    for (const [i, j] of T.cells) for (const [a, b] of [[0.1, 0.1], [2.9, 0.1], [0.1, 2.9], [2.9, 2.9], [1.5, 1.5]]) {
      const lx = i * CELL + a, lz = j * CELL + b;
      top = Math.max(top, G.world.heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
    }
    const newSt = { ox: x, oy: top + 0.2 - FOUND_H, oz: z, yaw };
    for (const [i, j] of T.cells) if (G.build.check(team.id, { type: 'foundation', i, j, k: 0, newSt })) return null;
    return newSt;
  }

  // Next construction step for the team's base (the first of nextSteps).
  nextStep(team, prog) { return this.nextSteps(team, prog)[0] || null; }
  // Open construction steps on parallel tracks so team members can work on different things at once.
  // Each step: { kind:'foundation'|'piece'|'door'|'deploy'|'upgrade'|'lock'|'swapdoor'|'repair', cost, ... }
  nextSteps(team, prog) {
    const G = this.game, base = team.base;
    if (!base) return [];
    const T = tpl(base.template);
    const st = base.st ? G.build.structures.get(base.st) : null;
    const skip = new Set(base.skip || []);
    if (!st) return [{ kind: 'foundation', i: T.cells[0][0], j: T.cells[0][1], newSt: base.site, cost: pieceCost('foundation', 0) }];
    const out = [];
    // shell: foundations, walls, ceiling
    let shell = null;
    for (const [i, j] of T.cells) if (!shell && !st.pieces.has(`c:${i},${j},0`) && !skip.has(`c:${i},${j},0`)) shell = { kind: 'piece', spec: { st: st.id, type: 'foundation', i, j, k: 0 }, cost: pieceCost('foundation', 0) };
    const footDone = !shell;
    if (!shell && st.tc) for (const w of T.walls) if (!shell && !st.pieces.has(w.key) && !skip.has(w.key)) shell = { kind: 'piece', spec: { st: st.id, type: w.type, i: w.i, j: w.j, k: 0, axis: w.axis }, cost: pieceCost(w.type, 0) };
    if (!shell && st.tc) for (const f of T.floors) if (!shell && !st.pieces.has(`c:${f.i},${f.j},1`) && !skip.has(`c:${f.i},${f.j},1`)) shell = { kind: 'piece', spec: { st: st.id, type: 'floor', i: f.i, j: f.j, k: 1 }, cost: pieceCost('floor', 0) };
    const shellDone = !shell && !!st.tc;
    // claim cabinet comes first once the footprint exists
    if (footDone && !st.tc) { const s = this._deployStep(team, st, T, 'claim_cabinet', 0); if (s) return [s]; }
    if (shell) out.push(shell);
    // doors
    let door = null;
    for (const key of T.doorways) {
      const p = st.pieces.get(key);
      if (!p || door) continue;
      if (!p.door) door = { kind: 'door', piece: p, item: 'wood_door', cost: {} };
      else if (!p.door.lock && shellDone && this.has(st, 'furnace')) door = { kind: 'lock', piece: p, item: 'code_lock', cost: {} };
      else if (p.door.type === 'wood_door' && prog.bench >= 1 && prog.knows('metal_door')) door = { kind: 'swapdoor', piece: p, item: 'metal_door', cost: {} };
      else if (p.door.type === 'metal_door' && prog.knows('armored_door') && prog.bench >= 3) door = { kind: 'swapdoor', piece: p, item: 'armored_door', cost: {} };
    }
    if (door) out.push(door);
    // deployables in order of need
    if (st.tc) {
      let dep = null;
      const bags = G.deploy.list.filter(d => d.st === st.id && d.type === 'sleeping_bag').length;
      if (!this.has(st, 'wood_box')) dep = this._deployStep(team, st, T, 'wood_box', 0);
      else if (prog.boxSpace < 5 && this.count(st, 'wood_box') < 2 && !prog.knows('large_box')) dep = this._deployStep(team, st, T, 'wood_box', 0);
      else if (!this.has(st, 'furnace')) dep = this._deployStep(team, st, T, 'furnace', 0);
      else if (bags < Math.min(team.size, 4)) dep = this._bagStep(team, st, T, bags);
      else if (!this.has(st, 'workbench1')) dep = this._deployStep(team, st, T, 'workbench1', 1);
      else if (prog.boxSpace < 6 && this.count(st, 'large_box') < 3 && prog.knows('large_box')) dep = this._deployStep(team, st, T, 'large_box', 1);
      else if (!this.has(st, 'research_table') && prog.bench >= 1 && prog.knows('research_table')) dep = this._deployStep(team, st, T, 'research_table', 1);
      else if (!this.has(st, 'workbench2') && prog.bench >= 1 && prog.wantBench2) dep = this._deployStep(team, st, T, 'workbench2', 2);
      else if (!this.has(st, 'workbench3') && prog.bench >= 2 && prog.wantBench3) dep = this._deployStep(team, st, T, 'workbench3', 3);
      if (dep) out.push(dep);
    }
    // upgrades, gated by progression
    if (shellDone) {
      const minGrade = Math.min(...[...st.pieces.values()].map(p => p.grade));
      let target = 1;
      if (this.has(st, 'furnace')) target = 2;
      if (prog.bench >= 2) target = 3;
      if (prog.bench >= 3 && prog.rich) target = 4;
      if (minGrade < target) { const u = this._upgradeStep(st, Math.min(target, minGrade + 1)); if (u) out.push(u); }
    }
    for (const p of st.pieces.values()) if (p.hp < p.maxHp * 0.7 && G.now - p.lastHit > 25) { out.push({ kind: 'repair', piece: p, cost: pieceCost(p.type, p.grade) }); break; }
    return out;
  }
  has(st, type) { return this.game.deploy.list.some(d => d.st === st.id && d.type === type); }
  count(st, type) { return this.game.deploy.list.filter(d => d.st === st.id && d.type === type).length; }
  _upgradeStep(st, grade) {
    // doorways and walls first (outside shell), then the rest
    const order = [...st.pieces.values()].filter(p => p.grade < grade).sort((a, b) => (b.type === 'doorway') - (a.type === 'doorway') || (a.type === 'floor') - (b.type === 'floor'));
    const p = order[0];
    return p ? { kind: 'upgrade', piece: p, grade, cost: pieceCost(p.type, grade) } : null;
  }
  _deployStep(team, st, T, type, tier) {
    for (const slot of T.slots) {
      const w = this.game.build.toWorld(st, slot.x, FOUND_H, slot.z);
      if (this.game.deploy.near(w.x, w.z, 1.4).length) continue;
      if (!this.game.deploy.supportAt(w.x, w.y, w.z)) continue;   // that part of the floor was never built
      if (this.game.deploy.check(team.id, type, w.x, w.y, w.z, st.yaw + slot.yaw)) continue;
      return { kind: 'deploy', item: type, x: w.x, y: w.y, z: w.z, yaw: st.yaw + slot.yaw, tier, cost: {} };
    }
    // fallback: anywhere on a built foundation
    for (const p of st.pieces.values()) {
      if (p.type !== 'foundation') continue;
      for (const [ox, oz] of [[0, 0], [-0.8, -0.8], [0.8, 0.8], [-0.8, 0.8], [0.8, -0.8]]) {
        const w = this.game.build.toWorld(st, (p.i + 0.5) * CELL + ox, FOUND_H, (p.j + 0.5) * CELL + oz);
        if (this.game.deploy.near(w.x, w.z, 1.2).length) continue;
        if (this.game.deploy.check(team.id, type, w.x, w.y, w.z, st.yaw)) continue;
        return { kind: 'deploy', item: type, x: w.x, y: w.y, z: w.z, yaw: st.yaw, tier, cost: {} };
      }
    }
    return null;
  }
  _bagStep(team, st, T, n) {
    const spot = T.bagSpots[n % T.bagSpots.length];
    const w = this.game.build.toWorld(st, spot.x, FOUND_H, spot.z);
    return { kind: 'deploy', item: 'sleeping_bag', x: w.x + n * 0.05, y: w.y, z: w.z, yaw: st.yaw, tier: 0, cost: {} };
  }
  // Total base cost to reach the given grade (for planning resources)
  remainingCost(team) {
    const step = this.nextStep(team, this.game.bots.progressOf(team));
    return step ? step.cost : {};
  }
}

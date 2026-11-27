// Base templates, base site selection and the next construction step for a team.
import { pieceCost, CELL, FOUND_H, GRADES } from '../data/building.js';
import { SKILL, styleOf } from './BotProfiles.js';
import { DEPLOYABLES } from '../data/building.js';
import { dist, randRange } from '../core/util.js';

// Bases grow in stages that nest inside each other: a 1x1 hut, then a 2x2 with an airlock,
// then 3x2 and 4x3. core: [w,d] cells; airlock: the cell in front of the door (null = door straight in).
const TEMPLATES = {
  hut: { core: [1, 1], airlock: null },
  small: { core: [2, 2], airlock: [0, -1] },
  medium: { core: [3, 2], airlock: [0, -1] },
  large: { core: [4, 3], airlock: [0, -1] },
  // layouts of bases in saves from before bases grew in stages (kept so they aren't rebuilt)
  'medium@1': { core: [3, 2], airlock: [1, -1] },
  'large@1': { core: [4, 3], airlock: [1, -1] },
};
const layoutOf = (base) => base.final || !TEMPLATES[base.template + '@1'] ? base.template : base.template + '@1';
export const STAGES = ['hut', 'small', 'medium', 'large'];

export function buildTemplate(name) {
  const T = TEMPLATES[name];
  const [W, D] = T.core;
  const cells = [];
  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) cells.push([i, j]);
  if (T.airlock) cells.push(T.airlock);
  const set = new Set(cells.map(c => c.join(',')));
  const [ai, aj] = T.airlock || [0, -1];
  const doorways = new Set(T.airlock ? [`z:${ai},${aj},0`, `z:${ai},${aj + 1},0`] : ['z:0,0,0']);
  const walls = [];
  for (const [i, j] of cells) {
    for (const [ni, nj, key] of [[i - 1, j, `x:${i},${j},0`], [i + 1, j, `x:${i + 1},${j},0`], [i, j - 1, `z:${i},${j},0`], [i, j + 1, `z:${i},${j + 1},0`]]) {
      const inside = set.has(`${ni},${nj}`);
      const isAirlockEdge = T.airlock && ((i === ai && j === aj) || (ni === ai && nj === aj));
      if (inside && !isAirlockEdge) continue;  // open core
      if (walls.some(w => w.key === key)) continue;
      const [axis, rest] = key.split(':'); const [ei, ej] = rest.split(',').map(Number);
      walls.push({ key, axis, i: ei, j: ej, type: doorways.has(key) ? 'doorway' : 'wall' });
    }
  }
  // deployable slots along the core's inner walls (structure-local metres); the exact spot is
  // fitted to each item's size when it's placed
  const Wm = W * CELL, Dm = D * CELL, doorX = (ai + 0.5) * CELL;
  const slots = [];
  const along = (len) => { const out = []; const n = Math.max(1, Math.floor(len / 2.3)); for (let k = 0; k < n; k++) out.push((k + 0.5) * len / n); return out; };
  for (const x of along(Wm)) slots.push({ x, z: Dm, wall: 'back', yaw: 0 });
  for (const z of along(Dm)) { slots.push({ x: Wm, z, wall: 'right', yaw: Math.PI / 2 }); slots.push({ x: 0, z, wall: 'left', yaw: -Math.PI / 2 }); }
  for (const x of along(Wm)) if (Math.abs(x - doorX) > 1.4) slots.push({ x, z: 0, wall: 'front', yaw: Math.PI });
  const bagSpots = T.airlock
    ? [{ x: (ai + 0.5) * CELL, z: (aj + 0.5) * CELL }, { x: Wm / 2, z: Dm / 2 }, { x: Wm / 2 + 1, z: Dm / 2 - 1 }, { x: Wm / 2 - 1, z: Dm / 2 + 0.8 }]
    : [{ x: 1.5, z: 1.1 }, { x: 1.0, z: 1.6 }, { x: 2.0, z: 1.6 }, { x: 1.5, z: 2.0 }];
  return { name, cells, walls, floors: cells.map(([i, j]) => ({ i, j })), doorways: [...doorways], airlock: T.airlock, slots, bagSpots, Wm, Dm };
}
const TPL_CACHE = {};
export const tpl = (n) => TPL_CACHE[n] || (TPL_CACHE[n] = buildTemplate(n));

// Deployable order inside the base. 'at' = minimum progression before it's wanted.
export const BASE_DEPLOY_ORDER = ['claim_cabinet', 'wood_box', 'furnace', 'workbench1', 'large_box', 'research_table', 'workbench2', 'large_box', 'workbench3'];

export class BotBuilder {
  constructor(game) { this.game = game; }

  // The base the team grows into (the site is picked to fit it).
  templateFor(team) {
    const n = team.size, Y = styleOf(team);
    let f = n >= 6 ? 3 : n >= 3 ? 2 : 1;
    if (team.style === 'turtle') f = Math.min(3, f + 1);
    if (team.style === 'rush' && n < 4) f = Math.min(f, Y.stage);
    return STAGES[f];
  }
  // How far the base should have grown by now.
  wantedStage(team, prog) {
    const base = team.base, fi = STAGES.indexOf(base.final || base.template);
    const furnace = !!prog.furnace, boxes = prog.boxes.length;
    let s = 0;
    if (furnace && boxes >= 1 && (prog.bench >= 1 || prog.boxSpace < 10 || base.cramped)) s = 1;
    if (prog.bench >= 1 && furnace && (boxes >= 2 || base.cramped) && team.size >= 2) s = 2;
    if (prog.bench >= 2 && team.size >= 3) s = 3;
    if (team.style === 'turtle' && furnace) s += 1;
    if (base.cramped) s = Math.max(s, STAGES.indexOf(base.template) + 1);
    return Math.max(0, Math.min(fi, s));
  }

  // Pick a site for a team's base near a point. Returns { ox, oy, oz, yaw, template } or null.
  chooseSite(team, near, rng = Math.random) {
    const G = this.game, W = G.world;
    const name = this.templateFor(team), T = tpl(name);
    const S = SKILL[team.tier];
    let best = null, bs = -Infinity;
    const radius = 120 + S.siteSkill * 260;
    for (let t = 0; t < 90; t++) {
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
      // sites other teams have picked but not started yet count too
      for (const o of G.teams.teams.values()) if (o !== team && o.base) nearest = Math.min(nearest, dist(x, z, o.base.x, o.base.z));
      if (nearest < 160) continue;
      score += Math.min(300, nearest) * 0.12 * (0.4 + S.siteSkill);
      const mon = W.monuments.reduce((m, mm) => Math.min(m, dist(x, z, mm.x, mm.z) - mm.r), Infinity);
      if (mon < 50) continue;
      score -= Math.max(0, mon - 350) * 0.03;
      if (W.isRoad(x, z) || W.isRoad(x + 25, z) || W.isRoad(x - 25, z) || W.isRoad(x, z + 25) || W.isRoad(x, z - 25)) score -= 15 * S.siteSkill;
      const b = W.biomeAt(x, z);
      if (b === 5) score -= 6 * (1 - S.siteSkill * 0.5); // snow is cold
      score += (rng() - 0.5) * 30 * (1 - S.siteSkill * 0.7);
      if (score > bs) { bs = score; best = { ...site, template: STAGES[0], final: name, score }; }
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
  // Planning is cached per team for a couple of seconds (it checks many placement spots), and
  // refreshed at once when the base or its items change.
  nextSteps(team, prog) {
    const base = team.base;
    if (!base) return [];
    const st = base.st ? this.game.build.structures.get(base.st) : null;
    const key = `${base.st}|${base.template}|${st ? st.version : 0}|${this.game.deploy.list.length}|${prog.bench}|${prog.boxSpace}|${prog.knows('large_box')}`;
    const c = team._steps;
    if (c && c.key === key && this.game.now - c.t < 2.5) return c.steps;
    const steps = this._nextSteps(team, prog);
    team._steps = { key, t: this.game.now, steps };
    return steps;
  }
  _nextSteps(team, prog) {
    const G = this.game, base = team.base;
    if (!base) return [];
    const T = tpl(layoutOf(base));
    const st = base.st ? G.build.structures.get(base.st) : null;
    const skip = new Set(base.skip || []);
    if (!st) return [{ kind: 'foundation', i: T.cells[0][0], j: T.cells[0][1], newSt: base.site, cost: pieceCost('foundation', 0) }];
    const out = [];
    // grow into the next stage once this one is finished and the team has outgrown it
    if (base.final && base.template !== base.final && st.tc && this._stageDone(st, T, skip)) {
      const cur = STAGES.indexOf(base.template);
      if (this.wantedStage(team, prog) > cur) {
        base.template = STAGES[cur + 1]; base.cramped = false;
        G.logEvent(`${team.name} is expanding their base`);
        return this._nextSteps(team, prog);
      }
    }
    // shell: foundations, walls, ceiling
    let shell = null;
    for (const [i, j] of T.cells) if (!shell && !st.pieces.has(`c:${i},${j},0`) && !skip.has(`c:${i},${j},0`)) shell = { kind: 'piece', spec: { st: st.id, type: 'foundation', i, j, k: 0 }, cost: pieceCost('foundation', 0) };
    const footDone = !shell;
    if (!shell && st.tc) for (const w of T.walls) if (!shell && !st.pieces.has(w.key) && !skip.has(w.key)) shell = { kind: 'piece', spec: { st: st.id, type: w.type, i: w.i, j: w.j, k: 0, axis: w.axis }, cost: pieceCost(w.type, 0) };
    if (!shell && st.tc) for (const f of T.floors) if (!shell && !st.pieces.has(`c:${f.i},${f.j},1`) && !skip.has(`c:${f.i},${f.j},1`)) shell = { kind: 'piece', spec: { st: st.id, type: 'floor', i: f.i, j: f.j, k: 1 }, cost: pieceCost('floor', 0) };
    const shellDone = !shell && !!st.tc;
    // walls left inside after an expansion come down once the new shell stands
    if (shellDone) {
      const keep = new Set(T.walls.map(w => w.key));
      for (const p of st.pieces.values()) if (p.k === 0 && (p.type === 'wall' || p.type === 'doorway') && !keep.has(p.key)) { out.push({ kind: 'demolish', piece: p, cost: {} }); break; }
    }
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
      const Y = styleOf(team);
      const bags = G.deploy.list.filter(d => d.st === st.id && d.type === 'sleeping_bag').length;
      const boxN = this.count(st, 'wood_box') + this.count(st, 'large_box');
      // what the base still wants, in order; the first one that fits is the next step
      const want = [];
      if (bags < 1) want.push(['bag']);
      if (!this.has(st, 'wood_box')) want.push(['wood_box', 0]);
      if (bags < Math.min(team.size, 2)) want.push(['bag']);
      if (prog.boxSpace < 5 && this.count(st, 'wood_box') < 2 && !prog.knows('large_box')) want.push(['wood_box', 0]);
      if (!this.has(st, 'furnace')) want.push(['furnace', 0]);
      if (bags < Math.min(team.size, 4)) want.push(['bag']);
      if (team.style === 'turtle' && boxN < Y.boxes && prog.boxSpace < 12) want.push([prog.knows('large_box') && prog.bench >= 1 ? 'large_box' : 'wood_box', 0]);
      if (!this.has(st, 'workbench1')) want.push(['workbench1', 1]);
      if (prog.boxSpace < 6 && this.count(st, 'large_box') < Y.boxes && prog.knows('large_box')) want.push(['large_box', 1]);
      if (!this.has(st, 'research_table') && prog.bench >= 1 && prog.knows('research_table')) want.push(['research_table', 1]);
      if (!this.has(st, 'workbench2') && prog.bench >= 1 && prog.wantBench2) want.push(['workbench2', 2]);
      if (!this.has(st, 'workbench3') && prog.bench >= 2 && prog.wantBench3) want.push(['workbench3', 3]);
      let found = 0, cramped = false, bagDone = false;
      for (const [type, tier] of want) {
        if (type === 'bag' && bagDone) continue;
        const dep = type === 'bag' ? this._bagStep(team, st, T, bags) : this._deployStep(team, st, T, type, tier);
        if (type === 'bag') bagDone = true;
        if (dep) { out.push(dep); if (++found >= 2) break; continue; }
        if (type !== 'bag' || bags < 1) cramped = true;   // no room for something the base needs
      }
      if (cramped) base.cramped = true;
    }
    // upgrades, gated by progression
    if (shellDone) {
      const minGrade = Math.min(...[...st.pieces.values()].map(p => p.grade));
      let target = 1;
      if (this.has(st, 'furnace')) target = 2;
      if (prog.bench >= 2) target = 3;
      if (prog.bench >= 3 && prog.rich) target = 4;
      const off = styleOf(team).upgrade;
      if (off > 0 && this.has(st, 'furnace')) { if (prog.bench >= 1) target = Math.max(target, 3); if (prog.bench >= 2 && prog.hqm >= 60) target = 4; }
      if (off < 0 && prog.bench < 2) target = Math.min(target, 2);
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
  _stageDone(st, T, skip) {
    for (const [i, j] of T.cells) { const k = `c:${i},${j},0`; if (!st.pieces.has(k) && !skip.has(k)) return false; }
    for (const w of T.walls) if (!st.pieces.has(w.key) && !skip.has(w.key)) return false;
    for (const f of T.floors) { const k = `c:${f.i},${f.j},1`; if (!st.pieces.has(k) && !skip.has(k)) return false; }
    for (const key of T.doorways) { const p = st.pieces.get(key); if (p && !p.door) return false; }
    return true;
  }
  // A slot's exact spot for one item: flush against its wall, kept clear of the corners.
  _fitSlot(slot, T, type) {
    const D = DEPLOYABLES[type], hx = D.size[0], hz = D.size[2], gap = 0.17;
    const clampA = (v, len) => Math.max(hx + gap, Math.min(len - hx - gap, v));
    if (slot.wall === 'back') return { x: clampA(slot.x, T.Wm), z: T.Dm - hz - gap };
    if (slot.wall === 'front') return { x: clampA(slot.x, T.Wm), z: hz + gap };
    if (slot.wall === 'right') return { x: T.Wm - hz - gap, z: clampA(slot.z, T.Dm) };
    return { x: hz + gap, z: clampA(slot.z, T.Dm) };
  }
  _deployStep(team, st, T, type, tier) {
    this._wantedDeploy = true;
    const D = DEPLOYABLES[type];
    if (2 * D.size[0] + 0.34 <= Math.min(T.Wm, T.Dm)) for (const slot of T.slots) {
      const f = this._fitSlot(slot, T, type);
      const w = this.game.build.toWorld(st, f.x, FOUND_H, f.z);
      if (!this.game.deploy.supportAt(w.x, w.y, w.z)) continue;   // that part of the floor was never built
      if (this.game.deploy.check(team.id, type, w.x, w.y, w.z, st.yaw + slot.yaw)) continue;
      this._wantedDeploy = false;
      return { kind: 'deploy', item: type, x: w.x, y: w.y, z: w.z, yaw: st.yaw + slot.yaw, tier, cost: {} };
    }
    // fallback: anywhere on a built foundation
    for (const p of st.pieces.values()) {
      if (p.type !== 'foundation') continue;
      for (const [ox, oz] of [[0, 0], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7]]) for (const yo of [0, Math.PI / 2]) {
        const w = this.game.build.toWorld(st, (p.i + 0.5) * CELL + ox, FOUND_H, (p.j + 0.5) * CELL + oz);
        if (this.game.deploy.check(team.id, type, w.x, w.y, w.z, st.yaw + yo)) continue;
        this._wantedDeploy = false;
        return { kind: 'deploy', item: type, x: w.x, y: w.y, z: w.z, yaw: st.yaw + yo, tier, cost: {} };
      }
    }
    return null;
  }
  _bagStep(team, st, T, n) {
    for (let k = 0; k < T.bagSpots.length; k++) {
      const spot = T.bagSpots[(n + k) % T.bagSpots.length];
      for (const yo of [0, Math.PI / 2]) {
        const w = this.game.build.toWorld(st, spot.x, FOUND_H, spot.z);
        if (!this.game.deploy.check(team.id, 'sleeping_bag', w.x, w.y, w.z, st.yaw + yo)) return { kind: 'deploy', item: 'sleeping_bag', x: w.x, y: w.y, z: w.z, yaw: st.yaw + yo, tier: 0, cost: {} };
      }
    }
    return this._deployStep(team, st, T, 'sleeping_bag', 0);
  }
  // Total base cost to reach the given grade (for planning resources)
  remainingCost(team) {
    const step = this.nextStep(team, this.game.bots.progressOf(team));
    return step ? step.cost : {};
  }
}

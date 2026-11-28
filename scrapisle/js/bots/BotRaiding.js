// Team raids: discover bases, judge if a raid is worth it, prepare charges, set up a forward base,
// breach, loot, haul it home. Also base defence: teams react when their buildings take damage.
//
// How a raid runs (the way player clans do it in Rust):
//  prep   - craft the boom, a box and a sleeping bag each.
//  rally  - put up a FOB (forward operating base) right outside the target's building privilege:
//           a two-storey stone tower with windows facing the base (stairs inside), sleeping bags and
//           a box for the spare boom on the ground floor. The overwatch shoots from its windows.
//           Where there's no room for a tower, a bag-and-box FOB on open ground 40-50 m out.
//  breach - one or two breachers carry a few charges at a time and blow the cheapest way in; a runner
//           brings more from the FOB box; everyone else holds overwatch and shoots defenders. Rockets
//           are fired from the FOB side from range (a siege). The dead respawn at the FOB.
//  loot   - strip the boxes; full bags are dropped in the FOB box instead of running home each time.
//  haul   - empty the FOB box and carry it all home.
import { ITEMS } from '../data/items.js';
import { STRUCT_DMG, DOORS, CELL, FOUND_H, LEVEL_H, pieceMaxHp } from '../data/building.js';
import { SKILL, PERSONALITIES } from './BotProfiles.js';
import { dist, randRange } from '../core/util.js';

const COOLDOWN = { normal: 420, hard: 480, expert: 600 };
const WORTH = { normal: 0.42, hard: 0.6, expert: 0.8 };
const ROCKET = 250;   // a rocket's blast against buildings (before the grade/door multiplier)
export const CARRY = { satchel_charge: 4, timed_charge: 2, rocket: 3 };   // what a breacher carries at once (the rest waits in the FOB box)

export class BotRaiding {
  constructor(game) {
    this.game = game;
    game.events.on('structureHit', e => this.onStructureHit(e));
    game.events.on('structureGone', e => this.game.teams.forget(e.st.id));
  }
  log(text) { this.game.logEvent(text); }

  // ---------- discovery ----------
  scan(b, team, range) {
    const G = this.game;
    G.build.pieceHash.query(b.x, b.z, range, p => {
      const st = G.build.structures.get(p.st);
      if (!st || st.team === team.id) return;
      const k = team.known.get(st.id);
      if (k && G.now - k.lastSeen < 60) return;
      G.teams.remember(team, st, this.estimateValue(st));
    });
  }
  // What a base probably holds, judged from outside: size and how upgraded it is.
  estimateValue(st) {
    let n = 0, g = 0;
    for (const p of st.pieces.values()) { n++; g += p.grade; }
    const avg = n ? g / n : 0;
    return 15 + n * 2.5 * (1 + avg * 0.8);
  }

  // ---------- breach planning ----------
  // Plan the cheapest route into the base's Claim Cabinet (or biggest box). Returns plan or null.
  planBreach(team, st, from, goalDep = null) {
    const G = this.game, nav = G.bots.nav;
    const tc = G.build.tcOf(st);
    const targets = G.deploy.list.filter(d => d.st === st.id && d.cont);
    const goal = goalDep || tc || targets[0];
    if (!goal) return null;
    const cell = nav.cellOf(st, goal.x, goal.z);
    const r = nav.basePath(st, team.id, from.x, from.z, cell, true);
    if (!r) return null;
    let sat = 0, c4 = 0, melee = 0, rockets = 0;
    for (const p of r.breaches) {
      const isDoor = p.type === 'doorway' && p.door;
      const hp = isDoor ? p.door.hp : p.hp;
      const em = isDoor ? DOORS[p.door.type].dmg.explosive : STRUCT_DMG.explosive[p.grade];
      const mm = isDoor ? DOORS[p.door.type].dmg.melee : STRUCT_DMG.melee[p.grade];
      sat += Math.ceil(hp / (75 * em * 0.95));
      c4 += Math.ceil(hp / (275 * em * 0.95));
      rockets += Math.ceil(hp / (ROCKET * em * 0.9));
      melee += mm > 0 ? hp / (25 * mm) : Infinity;
    }
    return { path: r.path, breaches: r.breaches.map(p => p.id), sat, c4, melee, rockets, goal: goal.id };
  }

  // ---------- decision (team leader, every ~15 s) ----------
  consider(team) {
    const G = this.game;
    if (team.raid) return this.advance(team);
    if (!team.base || !team.base.st) return;
    const S = SKILL[team.tier];
    const alive = G.teams.alive(team);
    if (alive.length < Math.max(1, Math.ceil(team.size * 0.5))) return;
    const prog = G.bots.progressOf(team);
    const late = prog.bench >= 3 || (prog.knows('rocket') && prog.knows('rocket_launcher'));
    if (G.now - team.lastRaid < COOLDOWN[team.tier] * (late ? 0.6 : 1)) return;
    if (team.raidDrive < 1) return;
    if (prog.bench < 2 || !prog.tc) return; // raids wait for a level 2 bench: early game is for progressing
    const canSatchel = prog.knows('satchel_charge') && prog.bench >= 2;
    const canC4 = prog.knows('timed_charge') && prog.bench >= 3;
    const canRocket = prog.knows('rocket') && prog.knows('rocket_launcher') && prog.bench >= 2;
    const pers = alive.reduce((a, b) => a + PERSONALITIES[b.ai.pers].raid, 0) / alive.length;
    const ours = G.teams.strength(team);
    let best = null, bs = 0;
    // everyone knows where the biggest bases on the island are (yours included): big bases draw raids
    const cand = new Map(team.known);
    const famous = [...G.build.structures.values()].filter(st => st.team !== team.id && st.pieces.size >= 12).map(st => [st, this.estimateValue(st)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [st, v] of famous) if (!cand.has(st.id)) { const z = G.build.zoneOf(st); cand.set(st.id, { x: z.x, z: z.z, team: st.team, value: v, famous: true }); }
    for (const [stId, k] of cand) {
      const st = G.build.structures.get(stId);
      if (!st) { team.known.delete(stId); continue; }
      const home = G.build.structures.get(team.base.st);
      const from = home ? G.build.zoneOf(home) : { x: alive[0].x, z: alive[0].z };
      const plan = this.planBreach(team, st, from);
      if (!plan) continue;
      // method
      let method = null, charges = 0, cost = 0;
      const meleeHits = plan.melee;
      if (meleeHits < 35 * alive.length) { method = 'melee'; cost = meleeHits * 0.15; }
      if (canC4 && plan.c4 <= 6 && (!method || plan.c4 * 40 < cost)) { method = 'timed_charge'; charges = plan.c4; cost = plan.c4 * 40; }
      if (canSatchel && plan.sat <= 14 && (!method || plan.sat * 8 < cost)) { method = 'satchel_charge'; charges = plan.sat; cost = plan.sat * 8; }
      if (canRocket && plan.rockets <= 24 && (!method || method === 'melee' || plan.rockets * 9 < cost)) { method = 'rocket'; charges = plan.rockets; cost = plan.rockets * 9; }
      if (!method) continue;
      if (plan.breaches.length === 0) { method = 'walk'; cost = 0; }
      const theirs = st.team === G.player?.team ? G.bots.powerOf(G.player) : (G.teams.get(st.team) ? G.teams.strength(G.teams.get(st.team)) : 10);
      const risk = Math.max(0.3, theirs / Math.max(1, ours));
      const travel = dist(from.x, from.z, k.x, k.z) / 400;
      const size = st.pieces.size;
      const worth = k.value * pers * (1 + size / 30) / ((cost + 10) * risk * (1 + travel));
      const grudge = 1 + (team.threats.get(st.team) || 0) * 0.02;
      // like players: offline raids (nobody home) are the safe ones, and night hides the approach
      let when = G.env.isNight ? 1.15 : 1;
      if (G.player && st.team === G.player.team) { const P = G.player; when *= !P.alive || dist(P.x, P.z, k.x, k.z) > 300 ? 1.4 : G.bots.playerSheltered() ? 0.75 : 1; }
      const score = worth * grudge * when * (0.75 + Math.random() * 0.5);
      if (score > WORTH[team.tier] && score > bs) { bs = score; best = { st, plan, method, charges }; }
    }
    if (!best) { team.raidDrive = Math.min(team.raidDrive, 1.1); return; }
    const z = G.build.zoneOf(best.st);
    const home = G.build.structures.get(team.base.st);
    const hz = home ? G.build.zoneOf(home) : z;
    const { fob, tower } = this.planFob(team, best.st, hz);
    team.raid = {
      tower,
      state: best.method === 'melee' || best.method === 'walk' ? 'rally' : 'prep', target: best.st.id, targetTeam: best.st.team, method: best.method,
      need: this.needFor(best.method, best.charges),
      rally: fob, fob, started: G.now, stateT: G.now, looted: 0, lootedValue: 0,
      targetName: this.teamLabel(best.st.team), tx: z.x, tz: z.z,
    };
    team.raidDrive = 0;
    this.log(`${team.name} are planning a ${best.method === 'rocket' ? 'rocket raid' : 'raid'} on ${team.raid.targetName}'s base`);
  }
  // A FOB spot 40-50 m out from the target on the home side: flat dry ground, not right outside
  // anyone else's base, and best of all with a hill, rock or trees between it and the target's walls.
  chooseFob(st, home) {
    const G = this.game, W = G.world, z = G.build.zoneOf(st);
    const ang = Math.atan2(home.x - z.x, home.z - z.z);
    let best = null, bs = -Infinity;
    for (let k = -4; k <= 4; k++) for (const extra of [38, 46]) {
      const a = ang + k * 0.3, x = z.x + Math.sin(a) * (z.core + extra), zz = z.z + Math.cos(a) * (z.core + extra);
      const h = W.heightAt(x, zz);
      if (h < 1.5 || W.slopeAt(x, zz) > 0.35 || W.riverAt(x, zz) > h - 0.5 || W.monumentAt(x, zz, 8) || G.build.blockedAt(x, zz, 3)) continue;
      let sc = -Math.abs(k) * 6;
      if (!G.physics.los({ x: z.x, y: W.heightAt(z.x, z.z) + 4, z: z.z }, { x, y: h + 1.5, z: zz })) sc += 60;   // out of sight of the walls
      for (const zn of G.bots.baseZones()) if (zn.st !== st.id && dist(x, zz, zn.x, zn.z) < zn.r) sc -= 80;
      if (sc > bs) { bs = sc; best = { x, z: zz }; }
    }
    return best || { x: z.x + Math.sin(ang) * (z.core + 40), z: z.z + Math.cos(ang) * (z.core + 40) };
  }
  // ---------- the FOB tower ----------
  // Three cells in a row, side-on to the target: ground floor walled with a doorway on the far side
  // and stairs in the end cell, an upper floor over the other two cells with windows facing the
  // base, and a roof. Built just outside the target's building privilege (closer isn't allowed).
  towerSite(team, st, home) {
    const G = this.game, z = G.build.zoneOf(st);
    const ang0 = Math.atan2(home.x - z.x, home.z - z.z);
    for (const extra of [4, 8, 13, 19]) for (const k of [0, -1, 1, -2, 2, -3, 3]) {
      const a = ang0 + k * 0.32, d = z.r + extra;
      const cx = z.x + Math.sin(a) * d, cz = z.z + Math.cos(a) * d;
      const yaw = Math.atan2(z.x - cx, z.z - cz);        // local +z faces the target
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const ox = cx - (4.5 * c + 1.5 * sn), oz = cz - (-4.5 * sn + 1.5 * c);   // footprint centred on (cx, cz)
      if (G.world.monumentAt(cx, cz, 10)) continue;
      const site = G.bots.builder.fitSite(team, ox, oz, yaw, { cells: [[0, 0], [1, 0], [2, 0]] });
      if (site) return site;
    }
    return null;
  }
  // Plan a raid's FOB: a tower when there's room for one (else open ground). Returns { fob, tower }.
  planFob(team, st, home) {
    const G = this.game, site = this.towerSite(team, st, home);
    if (!site) return { fob: this.chooseFob(st, home), tower: null };
    const w = (lx, lz, ly = FOUND_H) => { const c = Math.cos(site.yaw), sn = Math.sin(site.yaw); return { x: site.ox + lx * c + lz * sn, y: site.oy + ly, z: site.oz - lx * sn + lz * c }; };
    const plan = [];
    for (let i = 0; i < 3; i++) plan.push({ type: 'foundation', i, j: 0, k: 0 });
    const ground = [['x', 0, 0, 'wall'], ['x', 3, 0, 'wall'], ['z', 0, 0, 'wall'], ['z', 1, 0, 'doorway'], ['z', 2, 0, 'wall'], ['z', 0, 1, 'wall'], ['z', 1, 1, 'wall'], ['z', 2, 1, 'wall']];
    for (const [axis, i, j, type] of ground) plan.push({ type, i, j, k: 0, axis });
    plan.push({ type: 'stairs', i: 2, j: 0, k: 0, rot: 0, stairs: true });
    plan.push({ type: 'floor', i: 0, j: 0, k: 1 }, { type: 'floor', i: 1, j: 0, k: 1 });
    const upper = [['x', 0, 0, 'wall'], ['x', 3, 0, 'wall'], ['z', 0, 0, 'wall'], ['z', 1, 0, 'wall'], ['z', 2, 0, 'wall'], ['z', 0, 1, 'window'], ['z', 1, 1, 'window'], ['z', 2, 1, 'wall']];
    for (const [axis, i, j, type] of upper) plan.push({ type, i, j, k: 1, axis });
    for (let i = 0; i < 3; i++) plan.push({ type: 'roof', i, j: 0, k: 2 });
    const up = FOUND_H + LEVEL_H + 0.05;
    const tower = {
      site, plan, next: 0, st: null, built: false,
      outDoor: w(4.5, -1.6), inDoor: w(4.5, 1.2), build: w(4.5, -4.5),
      spots: [w(1.0, 2.3, up), w(2.0, 2.3, up), w(4.0, 2.3, up), w(5.0, 2.3, up)],
      boxAt: w(1.0, 1.6), bagAt: [w(3.6, 0.8), w(4.6, 0.8), w(5.4, 1.4), w(3.4, 2.1), w(4.4, 2.3), w(2.0, 0.8), w(1.0, 0.7), w(2.2, 2.4)],
      floorY: site.oy + up,
    };
    return { fob: { x: tower.outDoor.x, z: tower.outDoor.z }, tower };
  }
  // Put the next piece of the tower up (free, straight to stone: it's a quick build). Returns false
  // once there's nothing left to place.
  buildTowerStep(b, r) {
    const G = this.game, T = r.tower;
    while (T.next < T.plan.length) {
      const sp = T.plan[T.next];
      const spec = { ...sp, st: T.st || undefined, newSt: T.st ? undefined : T.site };
      if (sp.stairs) return this.placeStairs(b, T, spec);
      const res = G.build.place(b, spec, { free: true });
      if (res.ok) {
        if (!T.st) T.st = res.st.id;
        this.toStone(res.piece);
        T.next++;
        return true;
      }
      // can't place this one (terrain, someone standing in it): try again shortly, skip after a few goes
      sp.fails = (sp.fails || 0) + 1;
      if (sp.fails < 4 && !/already/.test(res.err)) return true;
      if (sp.type === 'foundation' && !T.st) { T.failed = true; return false; }
      T.next++;
    }
    return false;
  }
  toStone(p) {
    const G = this.game, st = G.build.structures.get(p.st);
    p.grade = 2; p.maxHp = pieceMaxHp(p.type, 2); p.hp = p.maxHp;
    G.build._buildPieceVisual(st, p); st.version++;
  }
  // The stairs have to rise towards the upper floor: try each way round until the top step lands
  // over the middle cell, and remember where to start and finish the climb.
  placeStairs(b, T, spec) {
    const G = this.game, mid = (() => { const c = Math.cos(T.site.yaw), sn = Math.sin(T.site.yaw); return { x: T.site.ox + 4.5 * c + 1.5 * sn, z: T.site.oz - 4.5 * sn + 1.5 * c }; })();
    for (let rot = 0; rot < 4; rot++) {
      const res = G.build.place(b, { ...spec, rot }, { free: true });
      if (!res.ok) { T.next++; return true; }
      const cols = res.piece.cols.slice().sort((a, c) => a.y - c.y), lo = cols[0], hi = cols[cols.length - 1];
      const dx = hi.x - lo.x, dz = hi.z - lo.z, L = Math.hypot(dx, dz) || 1;
      const top = { x: hi.x + dx / L * 1.0, z: hi.z + dz / L * 1.0 };
      if (Math.hypot(top.x - mid.x, top.z - mid.z) < 2.2) {
        this.toStone(res.piece);
        T.stairBot = { x: lo.x - dx / L * 1.0, y: T.site.oy + FOUND_H, z: lo.z - dz / L * 1.0 };
        T.stairTop = { x: top.x, y: T.floorY, z: top.z };
        T.next++;
        return true;
      }
      const st = G.build.structures.get(res.piece.st);
      G.build.removePiece(st, res.piece, 'demolish'); G.build.recompute(st);
    }
    T.next++;
    return true;
  }

  // A rocket raid keeps a spare launcher in the FOB box (a dead shooter's launcher is in his body bag).
  spareKit(r) {
    const box = this.fobBox(r);
    if (box && r.method === 'rocket' && !r.spareLauncher) { r.spareLauncher = true; box.cont.add('rocket_launcher', 1); }
  }
  // Tower's up: the box and everyone's sleeping bags go on its ground floor.
  finishTower(b, team, r) {
    const G = this.game, T = r.tower;
    if (T.built) return;
    T.built = true;
    if (T.failed || !T.st) { T.failed = true; return; }
    if (!this.fobBox(r)) {
      const type = b.inv.count('large_box') ? 'large_box' : 'wood_box';
      const res = G.deploy.place(b, type, T.boxAt.x, T.boxAt.y, T.boxAt.z, T.site.yaw, { free: !b.inv.count(type) });
      if (res.ok) r.fob.box = res.dep.id;
    }
    this.spareKit(r);
    r.fob.bags = r.fob.bags || [];
    for (const m of G.teams.alive(team)) {
      if (r.fob.bags.some(id => G.deploy.byId.get(id)?.owner === m.id)) continue;
      for (const at of T.bagAt) {
        const res = G.deploy.place(m, 'sleeping_bag', at.x, at.y, at.z, T.site.yaw, { free: !m.inv.count('sleeping_bag') });
        if (res.ok) { r.fob.bags.push(res.dep.id); break; }
      }
    }
    G.logEvent(`${team.name} put up a raid tower outside ${r.targetName === 'you' ? 'your' : r.targetName + (/s$/.test(r.targetName) ? "'" : "'s")} base`);
  }

  // Boom to bring: the plan's count plus spares, like players do (satchels dud now and then,
  // rockets miss, and a door gets replaced mid-raid).
  needFor(method, n) { return method === 'satchel_charge' ? Math.ceil(n * 1.35) + 2 : method === 'timed_charge' ? n + 1 : method === 'rocket' ? Math.ceil(n * 1.25) + 2 : n; }
  fobBox(r) { const d = r && r.fob && r.fob.box && this.game.deploy.byId.get(r.fob.box); return d && d.cont ? d : null; }
  fobBags(r) { return r && r.fob && r.fob.bags ? r.fob.bags.map(id => this.game.deploy.byId.get(id)).filter(Boolean) : []; }
  // Firing-line spot n for the overwatch: spread sideways across the FOB, facing the target.
  overwatchSpot(r, n) {
    const f = r.fob, ax = r.tx - f.x, az = r.tz - f.z, L = Math.hypot(ax, az) || 1, ux = ax / L, uz = az / L;
    const side = [0, -7, 7, -14, 14, -20, 20][n % 7], fwd = 3 + (n % 3) * 2;
    return { x: f.x + uz * side + ux * fwd, z: f.z - ux * side + uz * fwd };
  }
  teamLabel(id) { if (this.game.player && id === this.game.player.team) return 'you'; const t = this.game.teams.get(id); return t ? t.name : 'a lone survivor'; }

  // Boom actually on the crew (what a raid can use). Charges still in the home boxes don't count:
  // counting those sent clans out with empty pockets to stand around the target until they gave up.
  chargesCarried(team) {
    const r = team.raid;
    if (!r || r.method === 'melee' || r.method === 'walk') return 0;
    let n = 0;
    for (const b of this.game.teams.alive(team)) n += b.inv.count(r.method);
    return n;
  }
  chargesOwned(team) {
    const G = this.game, r = team.raid;
    if (!r || r.method === 'melee' || r.method === 'walk') return 0;
    let n = 0;
    for (const b of G.teams.alive(team)) n += b.inv.count(r.method);
    return n + G.bots.progressOf(team).stash(r.method);
  }

  advance(team) {
    const G = this.game, r = team.raid;
    const st = G.build.structures.get(r.target);
    if (!r.fob) r.fob = r.rally || (st ? this.chooseFob(st, G.build.zoneOf(st)) : { x: r.tx || 0, z: r.tz || 0 });   // raids from older saves had only a rally point
    if (!r.rally) r.rally = r.fob;
    const alive = G.teams.alive(team);
    const end = (result) => {
      team.lastRaid = G.now; team.stats.raids++;
      if (result === 'success') team.stats.raidsWon++;
      // the side that was hit gets a defence when the raid was beaten back
      const beaten = /^(failed|stalled|ran out of charges|timed out)/.test(result) && r.state !== 'prep';
      if (beaten) {
        if (G.player && r.targetTeam === G.player.team) { G.pstats.defended++; if (G.online) G.online.soon(); }
        else { const def = G.teams.get(r.targetTeam); if (def) def.stats.defended = (def.stats.defended || 0) + 1; }
      }
      if (result === 'success' && r.lootedValue < 1) result = 'found nothing worth taking';
      this.log(result === 'success' ? `${team.name} raided ${r.targetName} and took ${Math.round(r.lootedValue)} scrap worth of loot` : `${team.name}'s raid on ${r.targetName}: ${result}`);
      G.events.emit('raidEnded', { team, result, value: r.lootedValue });
      G.raidHistory.push({ t: G.now, day: G.env.day, team: team.name, teamId: team.id, color: team.color, target: r.targetName, result, value: Math.round(r.lootedValue), x: r.tx !== undefined ? Math.round(r.tx) : undefined, z: r.tz !== undefined ? Math.round(r.tz) : undefined });
      team.raid = null;
    };
    if (!st) { if (r.state === 'loot' || r.state === 'enter') return end('success'); return end('was called off (target gone)'); }
    // Too few left standing: the raid's beaten - unless they have bags at the FOB to come back at
    // (then it's only over if they can't get enough back up within two minutes).
    if (alive.length < Math.max(1, Math.ceil(team.size * 0.35)) && r.state !== 'prep') {
      if (!this.fobBags(r).length || G.now - (r.lowSince ??= G.now) > 120) return end('failed');
    } else r.lowSince = null;
    if (G.now - r.started > 2400) return end('timed out');
    switch (r.state) {
      case 'prep': {
        const launcher = r.method !== 'rocket' || alive.some(m => m.inv.count('rocket_launcher') > 0);
        if (this.chargesCarried(team) >= r.need && launcher) { r.state = 'rally'; r.stateT = G.now; this.log(`${team.name} are heading out to ${r.method === 'rocket' ? 'rocket ' : ''}raid ${r.targetName}`); }
        else if (G.now - r.stateT > 1800) end('was called off (not enough charges)');
        break;
      }
      case 'rally': {
        const f = r.fob, there = alive.filter(b => dist(b.x, b.z, f.x, f.z) < 25);
        if (there.length && !r.arrivedT) r.arrivedT = G.now;
        // go once most of the crew is at the FOB and it's set up (or they've waited long enough)
        const waited = G.now - (r.arrivedT || G.now);
        const setUp = r.tower && !r.tower.failed ? (r.tower.built || waited > 150)
          : (this.fobBox(r) || waited > 25) && (this.fobBags(r).length || waited > 25);
        if ((there.length >= Math.ceil(alive.length * 0.7) && (setUp || r.method === 'melee' || r.method === 'walk')) || G.now - r.stateT > 180) {
          const plan = this.planBreach(team, st, f);
          if (!plan) return end('found no way in');
          r.breaches = plan.breaches; r.path = plan.path; r.state = 'breach'; r.stateT = G.now; r.goal = plan.goal; r.roles = null;
          G.events.emit('raidStarted', { team, st });
          this.log(`${team.name} are breaching ${r.targetName === 'you' ? 'your' : r.targetName + (/s$/.test(r.targetName) ? "'" : "'s")} base`);
        }
        break;
      }
      case 'breach': {
        // remaining breaches = pieces still standing
        const before = r.breaches.length;
        r.breaches = r.breaches.filter(id => this.findPiece(st, id));
        if (r.breaches.length < before && r.breaches.length) this.log(`${team.name} blew through ${r.targetName === 'you' ? 'your' : r.targetName + (/s$/.test(r.targetName) ? "'" : "'s")} ${before - r.breaches.length > 1 ? 'walls' : 'first line'} and are pushing on (${r.breaches.length} more to go)`);
        // a breacher couldn't get to its wall: plan a fresh way in from the FOB
        if (r.replan) {
          r.replan = false;
          const plan = this.planBreach(team, st, r.fob, r.goal ? G.deploy.byId.get(r.goal) : null) || this.planBreach(team, st, r.fob);
          if (plan) { r.breaches = plan.breaches; r.path = plan.path; }
        }
        if (!r.breaches.length) { r.state = 'loot'; r.stateT = G.now; break; }
        const zz = G.build.zoneOf(st);
        const bagged = G.loot.bags.reduce((a, o) => a + (o.cont && dist(o.x, o.z, zz.x, zz.z) < zz.r + 40 ? o.cont.count(r.method) : 0), 0);
        const boom = this.chargesCarried(team) + (this.fobBox(r) ? this.fobBox(r).cont.count(r.method) : 0) + bagged;
        const ticking = G.combat.charges.some(c => c.owner && c.owner.team === team.id);
        if (r.method !== 'melee' && r.method !== 'walk' && boom <= 0 && !ticking) {
          // out of boom at the FOB: someone runs home for more (or the clan crafts it), up to 4 minutes
          const home = G.bots.progressOf(team).stash(r.method);
          if (!r.resupply) { r.resupply = G.now; if (home > 0) this.log(`${team.name} are running home for more ${ITEMS[r.method].name}s`); }
          if (G.now - r.resupply > 240) return end('ran out of charges');
        } else if (boom > 0) r.resupply = 0;
        if (G.now - r.stateT > 900) return end('stalled');
        this.assignRoles(team);
        break;
      }
      case 'loot': {
        const conts = G.deploy.list.filter(d => d.st === st.id && d.cont && !d.cont.isEmpty() && !d.def.spawn);
        const full = alive.every(b => b.inv.main.emptyCount() < 2);
        // boxes left that nobody can get to: blow a way to the nearest one (if there's boom left)
        const ai = G.bots.ai, reachable = conts.filter(d => alive.some(b => !ai.unreachable(b, d)));
        if (conts.length && !reachable.length && r.method !== 'melee' && this.chargesCarried(team) + (this.fobBox(r) ? this.fobBox(r).cont.count(r.method) : 0) > 0) {
          const plan = this.planBreach(team, st, r.fob, conts[0]);
          if (plan && plan.breaches.length) { r.breaches = plan.breaches; r.path = plan.path; r.goal = plan.goal; r.state = 'breach'; r.stateT = G.now; break; }
        }
        if (!reachable.length || full || G.now - r.stateT > 360) { r.state = 'haul'; r.stateT = G.now; }
        break;
      }
      case 'return': case 'haul': {
        const box = this.fobBox(r);
        if (!box || box.cont.isEmpty() || G.now - r.stateT > 240) end('success');
        break;
      }
    }
  }
  // Who does what during the breach: one or two breachers (whoever holds boom; for rockets, whoever
  // holds a launcher), one runner who keeps them supplied from the FOB box, the rest on overwatch.
  assignRoles(team) {
    const G = this.game, r = team.raid, alive = G.teams.alive(team);
    if (r.roles && G.now - r.rolesT < 6 && Object.keys(r.roles).every(id => G.bots.byId.get(id)?.alive)) return;
    r.roles = {}; r.rolesT = G.now;
    if (r.method === 'melee' || r.method === 'walk') { for (const b of alive) r.roles[b.id] = 'breacher'; return; }
    const box = this.fobBox(r);
    const holds = b => r.method === 'rocket' ? b.inv.count('rocket_launcher') + (box && box.cont.count('rocket_launcher') ? 0.5 : 0) : b.inv.count(r.method);
    const byBoom = alive.slice().sort((a, b) => holds(b) - holds(a));
    const nBreach = r.method === 'rocket' ? 2 : alive.length >= 4 ? 2 : 1;
    let n = 0, ow = 0;
    for (const b of byBoom) {
      if (n < nBreach && holds(b) > 0) { r.roles[b.id] = 'breacher'; n++; continue; }
      if (!Object.values(r.roles).includes('runner') && this.fobBox(r) && alive.length >= 3) { r.roles[b.id] = 'runner'; continue; }
      r.roles[b.id] = 'overwatch'; b.ai.owSlot = ow++;
    }
    // nobody holds boom yet but the box has it: the first in line goes and gets it
    if (!n && byBoom[0]) r.roles[byBoom[0].id] = 'breacher';
  }
  findPiece(st, id) { for (const p of st.pieces.values()) if (p.id === id) return p.type === 'doorway' ? (p.door ? p : null) : p; return null; }

  // What a member should do for the raid right now. Returns a task or null.
  memberTask(b, team) {
    const G = this.game, r = team.raid;
    if (!r) return null;
    if (!r.fob) r.fob = r.rally || { x: r.tx || b.x, z: r.tz || b.z };   // raids from older saves
    const st = G.build.structures.get(r.target);
    if (!st) return null;
    const alive = G.teams.alive(team), prog = G.bots.progressOf(team);
    const fob = r.fob || r.rally, box = this.fobBox(r), atFob = dist(b.x, b.z, fob.x, fob.z) < 12;
    if (r.state === 'prep') {
      // everyone helps build charges: whoever can craft them does
      if (r.method === 'rocket' && !alive.some(m => m.inv.count('rocket_launcher') > 0) && alive[0] === b) {
        if (prog.stash('rocket_launcher') > 0) return { type: 'activity', act: { a: 'withdraw', items: { rocket_launcher: 1 } } };
        const act = G.bots.prog.resolve(b, prog, 'rocket_launcher', 1);
        return act ? { type: 'activity', act } : null;
      }
      const per = Math.ceil(r.need / Math.max(1, alive.length));
      if (b.inv.count(r.method) < per && this.chargesCarried(team) < r.need) {
        // boom already made and sitting in the base boxes: pick it up first
        if (prog.stash(r.method) > 0) return { type: 'activity', act: { a: 'withdraw', items: { [r.method]: per - b.inv.count(r.method) } } };
        const act = G.bots.prog.resolve(b, prog, r.method, per);
        return act ? { type: 'activity', act } : null;
      }
      // the FOB kit: a box (the leader) and a sleeping bag each, if they're cheap to make
      if (alive[0] === b && b.inv.count('wood_box') + b.inv.count('large_box') < 1 && b.inv.count('wood') >= 100) { const act = G.bots.prog.resolve(b, prog, 'wood_box', 1); if (act && act.a === 'craft') return { type: 'activity', act }; }
      if (b.inv.count('sleeping_bag') < 1 && b.inv.count('cloth') >= 30) { const act = G.bots.prog.resolve(b, prog, 'sleeping_bag', 1); if (act && act.a === 'craft') return { type: 'activity', act }; }
      return null;
    }
    const T = r.tower && !r.tower.failed ? r.tower : null;
    // the tower goes up first: one or two builders, everyone else covers them
    if (T && !T.built && (r.state === 'rally' || r.state === 'breach')) {
      const builders = alive.slice(0, alive.length >= 4 ? 2 : 1);
      if (builders.includes(b)) return { type: 'fobbuild' };
    }
    // the tower's up: the first few overwatch take its windows
    const towerSlot = (n) => T && T.built && n < T.spots.length ? { type: 'towerwatch', slot: n } : null;
    if (r.state === 'rally') {
      if (!atFob) return { type: 'goto', x: fob.x + randRange(-5, 5), z: fob.z + randRange(-5, 5), arrive: 4, raid: true };
      const setup = this.fobSetupFor(b, r);
      if (setup) return setup;
      return towerSlot(alive.indexOf(b)) || { type: 'overwatch', ...this.overwatchSpot(r, alive.indexOf(b) + 3), face: { x: r.tx, z: r.tz } };
    }
    if (r.state === 'breach') {
      const pid = r.breaches[0];
      const p = this.findPiece(st, pid);
      if (!p) return null;
      const role = (r.roles && r.roles[b.id]) || 'overwatch';
      const m = r.method;
      if (m === 'melee' || m === 'walk') return { type: 'breach', piece: p, st, method: m, path: r.path, fob };
      if (role === 'breacher') {
        if (m === 'rocket') {
          if (b.inv.count('rocket_launcher') > 0 && b.inv.count('rocket') > 0) return { type: 'breach', piece: p, st, method: 'rocket', path: r.path, fob };
          if (b.inv.count('rocket_launcher') > 0 && box && box.cont.count('rocket') > 0) return { type: 'fobfetch', dep: box, item: 'rocket', n: CARRY.rocket };
          // lost the launcher (died and came back at the FOB): the spare's in the box
          if (!b.inv.count('rocket_launcher') && box && box.cont.count('rocket_launcher') > 0) return { type: 'fobfetch', dep: box, item: 'rocket_launcher', n: 1 };
        } else {
          if (b.inv.count(m) > 0) return { type: 'breach', piece: p, st, method: m, path: r.path, fob };
          if (box && box.cont.count(m) > 0) return { type: 'fobfetch', dep: box, item: m, n: CARRY[m] || 3 };
        }
      }
      if (r.resupply && (role === 'runner' || (role === 'overwatch' && !Object.values(r.roles || {}).includes('runner') && (b.ai.owSlot ?? 0) === 0))) {
        const item = m === 'rocket' ? 'rocket' : m;
        if (b.inv.count(item) > 0) return box ? { type: 'fobstash', dep: box, item, keep: 0 } : { type: 'goto', x: fob.x, z: fob.z, arrive: 4, raid: true };
        if (prog.stash(item) > 0) return { type: 'activity', act: { a: 'withdraw', items: { [item]: 12 } } };
        const act = G.bots.prog.resolve(b, prog, item, 4);
        if (act) return { type: 'activity', act };
      }
      // boom on a dead teammate (their body bag near the base): go and get it back
      if ((role === 'breacher' || role === 'runner') && b.inv.count(m === 'rocket' ? 'rocket' : m) === 0 && !(box && box.cont.count(m === 'rocket' ? 'rocket' : m) > 0)) {
        const item = m === 'rocket' ? 'rocket' : m, z = G.build.zoneOf(st);
        const bag = G.loot.bags.filter(o => o.cont && (o.cont.count(item) > 0 || (m === 'rocket' && o.cont.count('rocket_launcher') > 0)) && dist(o.x, o.z, z.x, z.z) < z.r + 40)
          .sort((a, c) => dist(b.x, b.z, a.x, a.z) - dist(b.x, b.z, c.x, c.z))[0];
        if (bag) return { type: 'lootbag', bag, dep: bag };
      }
      if (role === 'runner') {
        const item = m === 'rocket' ? 'rocket' : m;
        const needy = alive.filter(x => r.roles[x.id] === 'breacher' && x.inv.count(item) < 2 && (m !== 'rocket' || x.inv.count('rocket_launcher') > 0));
        if (b.inv.count(item) > 0 && needy.length) return { type: 'handoff', to: needy[0].id, item, dep: needy[0] };
        if (box && box.cont.count(item) > 0 && b.inv.count(item) < (CARRY[item] || 3)) return { type: 'fobfetch', dep: box, item, n: CARRY[item] || 3 };
      }
      // overwatch: hold the firing line at the FOB (spare boom carried by others goes in the box first)
      const setup = atFob && this.fobSetupFor(b, r);
      if (setup) return setup;
      return towerSlot(b.ai.owSlot ?? alive.indexOf(b)) || { type: 'overwatch', ...this.overwatchSpot(r, (b.ai.owSlot ?? alive.indexOf(b)) + 3), face: { x: p.wx, z: p.wz } };
    }
    if (r.state === 'loot') {
      // a full bag goes into the FOB box (a short walk) instead of all the way home
      if (b.inv.main.emptyCount() < 2) return box && box.cont.emptyCount() > 0 ? { type: 'fobstash', dep: box, all: true } : null;
      const conts = G.deploy.list.filter(d => d.st === st.id && d.cont && !d.cont.isEmpty() && !d.def.spawn && !G.bots.ai.unreachable(b, d));
      if (!conts.length) return null;
      conts.sort((a, c) => dist(b.x, b.z, a.x, a.z) - dist(b.x, b.z, c.x, c.z));
      return { type: 'raidloot', dep: conts[0], st };
    }
    if (r.state === 'haul' || r.state === 'return') {
      // carry the FOB box home a bagful at a time (the normal deposit run takes it from there)
      if (box && !box.cont.isEmpty() && b.inv.main.emptyCount() >= 3) return { type: 'raidloot', dep: box, st: null };
      return null;
    }
    return null;
  }
  // FOB set-up jobs for one bot standing at it: put the box down, put its sleeping bag down, and
  // leave spare boom in the box (a breacher only carries a few at a time).
  fobSetupFor(b, r) {
    const box = this.fobBox(r), tower = r.tower && !r.tower.failed;   // a tower gets its box and bags when it's finished
    if (!tower && !box && (b.inv.count('wood_box') || b.inv.count('large_box'))) return { type: 'fobsetup', item: b.inv.count('large_box') ? 'large_box' : 'wood_box' };
    if (!tower && b.inv.count('sleeping_bag') && !this.fobBags(r).some(d => d.owner === b.id)) return { type: 'fobsetup', item: 'sleeping_bag' };
    const item = r.method === 'rocket' ? 'rocket' : r.method, keep = (r.roles && r.roles[b.id] === 'breacher') || r.state === 'rally' ? (CARRY[item] || 3) : 0;
    if (box && CARRY[item] && b.inv.count(item) > keep && box.cont.room(item) > 0) return { type: 'fobstash', dep: box, item, keep };
    return null;
  }

  // ---------- defence ----------
  onStructureHit(e) {
    const G = this.game;
    if (!e.st || !e.attacker || e.attacker.kind !== 'survivor') return;
    const owner = G.teams.get(e.st.team);
    if (!owner || e.attacker.team === owner.id) return;
    if (owner.raid && owner.raid.tower && owner.raid.tower.st === e.st.id) return;   // their raid tower getting shot at isn't a raid on their base
    if (owner.underAttack <= 0) this.log(`${owner.name}'s base is under attack`);
    owner.underAttack = 120;
    owner.attackers.add(e.attacker.id);
    G.teams.hostility(owner, e.attacker.team, 5);
    // whoever damaged us is remembered as a base we might raid back
    const theirTeam = G.teams.get(e.attacker.team);
    if (theirTeam && theirTeam.base && theirTeam.base.st) { const tst = G.build.structures.get(theirTeam.base.st); if (tst) G.teams.remember(owner, tst, this.estimateValue(tst)); }
  }
}

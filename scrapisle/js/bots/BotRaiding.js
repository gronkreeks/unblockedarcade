// Team raids: discover bases, judge if a raid is worth it, prepare charges, rally, breach, loot, go home.
// Also base defence: teams react when their buildings take damage.
import { ITEMS } from '../data/items.js';
import { STRUCT_DMG, DOORS, CELL } from '../data/building.js';
import { SKILL, PERSONALITIES } from './BotProfiles.js';
import { dist, randRange } from '../core/util.js';

const COOLDOWN = { easy: 300, normal: 420, hard: 480, expert: 600 };
const WORTH = { easy: 0.25, normal: 0.42, hard: 0.6, expert: 0.8 };
const ROCKET = 250;   // a rocket's blast against buildings (before the grade/door multiplier)

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
  planBreach(team, st, from) {
    const G = this.game, nav = G.bots.nav;
    const tc = G.build.tcOf(st);
    const targets = G.deploy.list.filter(d => d.st === st.id && d.cont);
    const goal = tc || targets[0];
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
    if (G.now - team.lastRaid < COOLDOWN[team.tier]) return;
    if (team.raidDrive < 1) return;
    const prog = G.bots.progressOf(team);
    if (prog.bench < 1 || !prog.tc) return; // raiding starts once a group is established
    const canSatchel = prog.knows('satchel_charge') && prog.bench >= 1;
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
      const score = worth * grudge * (0.75 + Math.random() * 0.5);
      if (score > WORTH[team.tier] && score > bs) { bs = score; best = { st, plan, method, charges }; }
    }
    if (!best) { team.raidDrive = Math.min(team.raidDrive, 1.1); return; }
    const z = G.build.zoneOf(best.st);
    const home = G.build.structures.get(team.base.st);
    const hz = home ? G.build.zoneOf(home) : z;
    const ang = Math.atan2(hz.x - z.x, hz.z - z.z);
    team.raid = {
      state: best.method === 'melee' || best.method === 'walk' ? 'rally' : 'prep', target: best.st.id, targetTeam: best.st.team, method: best.method,
      need: best.charges + (best.method === 'satchel_charge' ? 2 : best.method === 'timed_charge' ? 1 : best.method === 'rocket' ? 2 : 0),
      rally: { x: z.x + Math.sin(ang) * (z.r + 30), z: z.z + Math.cos(ang) * (z.r + 30) }, started: G.now, stateT: G.now, looted: 0, lootedValue: 0,
      targetName: this.teamLabel(best.st.team), tx: z.x, tz: z.z,
    };
    team.raidDrive = 0;
    this.log(`${team.name} are planning a ${best.method === 'rocket' ? 'rocket raid' : 'raid'} on ${team.raid.targetName}'s base`);
  }
  teamLabel(id) { if (this.game.player && id === this.game.player.team) return 'you'; const t = this.game.teams.get(id); return t ? t.name : 'a lone survivor'; }

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
    const alive = G.teams.alive(team);
    const end = (result) => {
      team.lastRaid = G.now; team.stats.raids++;
      if (result === 'success') team.stats.raidsWon++;
      // the side that was hit gets a defence when the raid was beaten back
      const beaten = /^(failed|stalled|ran out of charges|timed out)/.test(result) && r.state !== 'prep';
      if (beaten) {
        if (G.player && r.targetTeam === G.player.team) G.pstats.defended++;
        else { const def = G.teams.get(r.targetTeam); if (def) def.stats.defended = (def.stats.defended || 0) + 1; }
      }
      if (result === 'success' && r.lootedValue < 1) result = 'found nothing worth taking';
      this.log(result === 'success' ? `${team.name} raided ${r.targetName} and took ${Math.round(r.lootedValue)} scrap worth of loot` : `${team.name}'s raid on ${r.targetName}: ${result}`);
      G.raidHistory.push({ t: G.now, day: G.env.day, team: team.name, teamId: team.id, color: team.color, target: r.targetName, result, value: Math.round(r.lootedValue), x: r.tx !== undefined ? Math.round(r.tx) : undefined, z: r.tz !== undefined ? Math.round(r.tz) : undefined });
      team.raid = null;
    };
    if (!st) { if (r.state === 'loot' || r.state === 'enter') return end('success'); return end('was called off (target gone)'); }
    if (alive.length < Math.max(1, Math.ceil(team.size * 0.35)) && r.state !== 'prep') return end('failed');
    if (G.now - r.started > 2400) return end('timed out');
    switch (r.state) {
      case 'prep': {
        const launcher = r.method !== 'rocket' || alive.some(m => m.inv.count('rocket_launcher') > 0) || G.bots.progressOf(team).stash('rocket_launcher') > 0;
        if (this.chargesOwned(team) >= r.need && launcher) { r.state = 'rally'; r.stateT = G.now; this.log(`${team.name} are heading out to ${r.method === 'rocket' ? 'rocket ' : ''}raid ${r.targetName}`); }
        else if (G.now - r.stateT > 1800) end('was called off (not enough charges)');
        break;
      }
      case 'rally': {
        const there = alive.filter(b => dist(b.x, b.z, r.rally.x, r.rally.z) < 25).length;
        if (there >= Math.ceil(alive.length * 0.7) || G.now - r.stateT > 150) {
          // fresh breach plan from the rally point
          const plan = this.planBreach(team, st, r.rally);
          if (!plan) return end('found no way in');
          r.breaches = plan.breaches; r.path = plan.path; r.state = 'breach'; r.stateT = G.now; r.goal = plan.goal;
          G.events.emit('raidStarted', { team, st });
        }
        break;
      }
      case 'breach': {
        // remaining breaches = pieces still standing
        r.breaches = r.breaches.filter(id => this.findPiece(st, id));
        if (!r.breaches.length) { r.state = 'loot'; r.stateT = G.now; break; }
        if (r.method !== 'melee' && r.method !== 'walk' && this.chargesOwned(team) <= 0 && !G.combat.charges.some(c => c.owner && c.owner.team === team.id)) return end('ran out of charges');
        if (G.now - r.stateT > 900) return end('stalled');
        break;
      }
      case 'loot': {
        const conts = G.deploy.list.filter(d => d.st === st.id && d.cont && !d.cont.isEmpty());
        const full = alive.every(b => b.inv.main.emptyCount() < 2);
        if (!conts.length || full || G.now - r.stateT > 300) { r.state = 'return'; r.stateT = G.now; }
        break;
      }
      case 'return': {
        if (G.now - r.stateT > 60) end('success');
        break;
      }
    }
  }
  findPiece(st, id) { for (const p of st.pieces.values()) if (p.id === id) return p.type === 'doorway' ? (p.door ? p : null) : p; return null; }

  // What a member should do for the raid right now. Returns a task or null.
  memberTask(b, team) {
    const G = this.game, r = team.raid;
    if (!r) return null;
    const st = G.build.structures.get(r.target);
    if (!st) return null;
    if (r.state === 'prep') {
      // everyone helps build charges: whoever can craft them does
      const prog = G.bots.progressOf(team);
      if (r.method === 'rocket' && !G.teams.alive(team).some(m => m.inv.count('rocket_launcher') > 0) && G.teams.alive(team)[0] === b) {
        const act = G.bots.prog.resolve(b, prog, 'rocket_launcher', 1);
        return act ? { type: 'activity', act } : null;
      }
      const per = Math.ceil(r.need / Math.max(1, G.teams.alive(team).length));
      if (b.inv.count(r.method) < per && this.chargesOwned(team) < r.need) {
        const act = G.bots.prog.resolve(b, prog, r.method, per);
        return act ? { type: 'activity', act } : null;
      }
      return null;
    }
    if (r.state === 'rally') return { type: 'goto', x: r.rally.x + randRange(-6, 6), z: r.rally.z + randRange(-6, 6), arrive: 4, raid: true };
    if (r.state === 'breach') {
      const pid = r.breaches[0];
      const p = this.findPiece(st, pid);
      if (!p) return null;
      // the member with charges (or everyone, for melee) works the breach; others guard
      if (r.method === 'rocket') {
        if (b.inv.count('rocket_launcher') > 0) {
          // teammates nearby pass their rockets to the shooter
          if (b.inv.count('rocket') < 2) for (const m of G.teams.alive(team)) { if (m === b) continue; const n = m.inv.count('rocket'); if (n && dist(m.x, m.z, b.x, b.z) < 40) { m.inv.remove('rocket', n); b.inv.give('rocket', n); } }
          if (b.inv.count('rocket') > 0) return { type: 'breach', piece: p, st, method: 'rocket', path: r.path };
        }
        return { type: 'guard', x: r.rally.x, z: r.rally.z, near: { x: p.wx, z: p.wz } };
      }
      const carrier = r.method === 'melee' || r.method === 'walk' || b.inv.count(r.method) > 0;
      if (!carrier) {
        if (r.method !== 'melee' && this.chargesOwned(team) > 0 && G.bots.progressOf(team).stash(r.method) > 0 && dist(b.x, b.z, r.rally.x, r.rally.z) > 200) return null;
        return { type: 'guard', x: r.rally.x, z: r.rally.z, near: { x: p.wx, z: p.wz } };
      }
      return { type: 'breach', piece: p, st, method: r.method, path: r.path };
    }
    if (r.state === 'loot') {
      const conts = G.deploy.list.filter(d => d.st === st.id && d.cont && !d.cont.isEmpty());
      if (!conts.length || b.inv.main.emptyCount() < 2) return null;
      conts.sort((a, c) => dist(b.x, b.z, a.x, a.z) - dist(b.x, b.z, c.x, c.z));
      return { type: 'raidloot', dep: conts[0], st };
    }
    return null;
  }

  // ---------- defence ----------
  onStructureHit(e) {
    const G = this.game;
    if (!e.st || !e.attacker || e.attacker.kind !== 'survivor') return;
    const owner = G.teams.get(e.st.team);
    if (!owner || e.attacker.team === owner.id) return;
    if (owner.underAttack <= 0) this.log(`${owner.name}'s base is under attack`);
    owner.underAttack = 120;
    owner.attackers.add(e.attacker.id);
    G.teams.hostility(owner, e.attacker.team, 5);
    // whoever damaged us is remembered as a base we might raid back
    const theirTeam = G.teams.get(e.attacker.team);
    if (theirTeam && theirTeam.base && theirTeam.base.st) { const tst = G.build.structures.get(theirTeam.base.st); if (tst) G.teams.remember(owner, tst, this.estimateValue(tst)); }
  }
}

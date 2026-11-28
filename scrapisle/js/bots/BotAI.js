// Bot brain: needs, perception, combat, and the economy loop that drives progression.
// Every action goes through the same systems the player uses.
import { ITEMS, weaponScore } from '../data/items.js';
import { RECIPE } from '../data/recipes.js';
import { sortContainer } from '../systems/InventorySystem.js';
import { PERSONALITIES, styleOf } from './BotProfiles.js';
import { recycleYield } from '../systems/Deployables.js';
import * as Recoil from '../systems/Recoil.js';
import { dist, randRange, angleWrap, clamp, pick } from '../core/util.js';

const KEEP_CATS = new Set(['Ammo', 'Medical', 'Food', 'Raid']);
const RAW = ['wood', 'stones', 'metal_ore', 'metal_frag', 'sulfur_ore', 'sulfur', 'hqm_ore', 'hqm', 'charcoal', 'cloth', 'leather', 'animal_fat', 'low_grade', 'scrap'];
// How much raw material a bot is hauling (scrap and refined metal count extra).
export function rawLoad(b) { let n = 0; for (const k of RAW) n += b.inv.count(k) * (k === 'scrap' || k === 'hqm' ? 8 : k === 'metal_frag' || k === 'sulfur' ? 2 : 1); return n; }

export class BotAI {
  constructor(game, mgr) { this.game = game; this.mgr = mgr; }
  get nav() { return this.mgr.nav; }

  // ================= BRAIN =================
  think(b, mode) {
    const G = this.game, ai = b.ai, team = G.teams.of(b);
    if (!b.alive) return;
    this.selfCare(b);
    this.perceive(b, mode);
    // the clan is pushing the player: everyone nearby joins in, using what the clan knows
    const P = G.player;
    if (team && team.push && G.now < team.push.until && P && P.alive && this.kitted(b) && dist(b.x, b.z, P.x, P.z) < 350 && !(team.raid && team.raid.state === 'breach') && !(team.underAttack > 0 && ai.goal === 'fight' && ai.target && ai.target !== P)) {
      if (ai.target !== P) this.startCombat(b, P);
      ai.targetSeen = G.now; ai.lastSeen = { x: team.intel.x, z: team.intel.z };
      ai.goal = b.hp < 20 && !(ai.cornered > G.now) ? 'flee' : 'fight';
      return;
    }
    if (ai.target) {
      const keep = this.underFire(b, ai.target) ? 300 : ai.S.sight * 1.2;
      if (!ai.target.alive || dist(b.x, b.z, ai.target.x, ai.target.z) > keep || (G.now - ai.targetSeen > 12)) { this.endCombat(b); }
      else {
        const decision = this.engageDecision(b, ai.target);
        if (decision === 'fight' || decision === 'flee') { ai.goal = decision; return; }
        if (decision === 'ignore') this.endCombat(b, true);
      }
    }
    ai.goal = 'task';
    // base defence
    if (team && team.underAttack > 0 && team.base && team.base.st && !(team.raid && team.raid.state === 'breach')) {
      const st = G.build.structures.get(team.base.st);
      if (st) {
        const z = G.build.zoneOf(st);
        const d = dist(b.x, b.z, z.x, z.z);
        if (d < 600) {
          // pick an attacker to hunt down
          const bare = !this.kitted(b);
          for (const id of team.attackers) { const a = G.actorById(id); if (a && a.alive && dist(a.x, a.z, z.x, z.z) < z.r + 60 && !(bare && a.kind === 'survivor' && this.kitted(a))) { this.startCombat(b, a); ai.goal = 'fight'; return; } }
          // a bare bot doesn't run into a gunfight at home: it rekits or keeps away (chooseEconomy)
          if (bare && [...team.attackers].some(id => { const a = G.actorById(id); return a && a.alive && a.kind === 'survivor' && this.kitted(a); })) { if (ai.task && ai.task.type === 'defend') ai.task = null; }
          else if (d > z.core + 4 && (!ai.task || ai.task.type !== 'defend')) this.setTask(b, { type: 'defend', x: z.x, z: z.z, until: G.now + 60 });
          if (ai.task && ai.task.type === 'defend') return;
        }
      }
    }
    // raid participation
    if (team && team.raid) {
      const t = this.game.bots.raiding.memberTask(b, team);
      if (t) {
        if (t.type === 'activity') { const tt = this.activityTask(b, team, t.act); if (tt) { if (!ai.task || ai.task.type !== tt.type || ai.task.why !== 'raid') { tt.why = 'raid'; this.setTask(b, tt); } return; } }
        else { if (!ai.task || ai.task.type !== t.type || (t.piece && ai.task.piece !== t.piece) || (t.dep && ai.task.dep !== t.dep)) this.setTask(b, t); return; }
      }
    }
    // keep going with the current task unless it's stale
    if (ai.task && G.now < ai.task.until && !ai.redecide) return;
    ai.redecide = false;
    this.chooseEconomy(b, team);
  }
  // ---------- team task split ----------
  // What a task works toward, so teammates can see it's covered and pick something else.
  taskKey(t) {
    if (!t) return null;
    switch (t.type) {
      case 'harvest': return 'g:' + (t.res || (t.node && t.node.kind));
      case 'pick': return 'p:' + (t.chain || (t.node && t.node.kind));
      case 'hunt': return 'hunt';
      case 'smelt': return 's:' + t.out;
      case 'craft': return 'c:' + t.id;
      case 'unlock': return 'u:' + t.id;
      case 'build': return 'b:' + t.step.kind + ':' + (t.step.item || (t.step.spec && t.step.spec.type + t.step.spec.i + t.step.spec.j) || (t.step.piece && t.step.piece.key) || '');
      case 'loot': return t.cont && t.cont.id ? 'l:' + t.cont.id : null;
      case 'stocktc': return 'tc';
      case 'research': return 'r';
    }
    return null;
  }
  actKey(a) {
    if (!a) return null;
    switch (a.a) { case 'gather': return 'g:' + a.res; case 'smelt': return 's:' + a.out; case 'hunt': return 'hunt'; case 'hemp': return 'p:hemp'; case 'craft': return 'c:' + a.id; case 'unlock': return 'u:' + a.id; }
    return null;
  }
  // How many teammates are already on it.
  claimCount(team, key, b) {
    if (!key || !team) return 0;
    let n = 0;
    for (const m of this.game.teams.alive(team)) if (m !== b && m.ai.claim === key && m.ai.task && this.game.now < m.ai.task.until) n++;
    return n;
  }
  setTask(b, t) {
    const ai = b.ai;
    ai.claim = this.taskKey(t);
    if (!t.until) {
      // allow for the walk there: tasks far away get more time
      const tgt = t.node || t.cont || t.bench || t.table || t.rec || t.bag || t.dep || t.animal || (t.step && (t.step.piece || (t.step.newSt ? { x: t.step.newSt.ox, z: t.step.newSt.oz } : t.step))) || (t.x !== undefined ? t : null);
      const mon = t.mon && this.game.world.monuments.find(m => m.id === t.mon);
      const p = mon || tgt;
      const px = p ? (p.x ?? p.wx) : undefined, pz = p ? (p.z ?? p.wz) : undefined;
      const travel = px !== undefined ? dist(b.x, b.z, px, pz) / 3.5 : 0;
      t.until = this.game.now + travel + (t.type === 'monument' ? 360 : t.type === 'harvest' ? 140 : 120);
    }
    t.started = this.game.now; ai.task = t; ai.path = null; ai.pathI = 0;
  }

  // ---------- needs ----------
  selfCare(b) {
    const ai = b.ai, G = this.game;
    if (G.now < (ai.useT || 0)) return;
    const useFrom = (pred) => {
      for (const c of [b.inv.belt, b.inv.main]) for (let i = 0; i < c.size; i++) { const s = c.slots[i]; if (s && pred(ITEMS[s.id])) { G.surv.use(b, c, i); ai.useT = G.now + 1.5; return true; } }
      return false;
    };
    if (b.bleed > 0.15 && useFrom(d => d.type === 'med' && d.stopBleed)) return;
    if (b.hp < ai.S.healAt && useFrom(d => d.type === 'med' && (d.heal || d.hot) > 0 && d.id !== 'bandage')) return;
    if (b.hp < ai.S.healAt * 0.7 && useFrom(d => d.id === 'bandage')) return;
    if (b.rads > 40 && useFrom(d => d.id === 'anti_rad')) return;
    if (b.cal < 160) { if (useFrom(d => d.type === 'food' && d.cal >= 40 && !d.poison)) return; if (b.cal < 70 && useFrom(d => d.type === 'food' && d.cal > 0)) return; }
    if (b.hyd < 90 && useFrom(d => d.type === 'food' && d.hyd >= 40)) return;
  }

  // ---------- perception ----------
  perceive(b, mode) {
    const G = this.game, ai = b.ai;
    const every = mode === 'full' ? 0.35 : mode === 'mid' ? 1 : 2;
    if (G.now - (ai.perceiveT || 0) < every) return;
    ai.perceiveT = G.now;
    const team = G.teams.of(b);
    // remember bases we can see
    if (team && Math.random() < 0.3) this.game.bots.raiding.scan(b, team, ai.S.sight * 0.9);
    let range = ai.S.sight * (G.env.isNight ? 0.55 : 1) * (mode === 'far' ? 0.6 : 1);
    if (ai.target && ai.target.alive) range = Math.max(range, dist(b.x, b.z, ai.target.x, ai.target.z) + 5);
    let best = null, bs = -Infinity;
    const eye = b.eye();
    G.actorHash.query(b.x, b.z, range, a => {
      if (a === b || !a.alive) return;
      let hostile = false;
      if (a.kind === 'survivor') hostile = a.team !== b.team;
      else if (a.kind === 'npc') hostile = dist(b.x, b.z, a.x, a.z) < 70;
      else if (a.kind === 'animal') hostile = a.state === 'chase' && a.target === b;
      if (!hostile) return;
      const d = dist(b.x, b.z, a.x, a.z);
      if (d > range) return;
      const attacker = (b.lastHitBy === a && G.now - b.lastHitTime < 15) || this.underFire(b, a);
      const heard = ai.heard && ai.heard.src === a && G.now - ai.heard.t < 6 && d < 120;
      if (mode !== 'far' && !attacker && d > 10) {
        const ang = Math.abs(angleWrap(Math.atan2(a.x - b.x, a.z - b.z) - b.yaw));
        const crouchF = a.crouch ? 0.6 : 1;
        if (ang > 1.3 && d > 25 && !heard) return;
        if (d > range * crouchF) return;
        if (!G.physics.los(eye, { x: a.x, y: a.y + 1.3, z: a.z })) return;
      }
      if (!attacker && ai.ignore instanceof Map && (ai.ignore.get(a.id) || 0) > G.now) return;
      const score = (attacker ? 100 : 0) + (a === ai.target ? 30 : 0) - d;
      if (score > bs) { bs = score; best = a; }
    });
    // whoever is shooting at us counts even beyond normal sight
    if (!best && ai.shotAt && G.now - ai.shotAt.t < 10 && ai.shotAt.src.alive && dist(b.x, b.z, ai.shotAt.src.x, ai.shotAt.src.z) < 380) best = ai.shotAt.src;
    // gunfire nearby: look towards it (so the next look can spot the shooter)
    if (!best && !ai.target && ai.heard && G.now - ai.heard.t < 3 && mode !== 'far' && dist(b.x, b.z, ai.heard.x, ai.heard.z) < 140 && ai.lookedAt !== ai.heard.t) {
      ai.lookedAt = ai.heard.t;
      const want = Math.atan2(ai.heard.x - b.x, ai.heard.z - b.z);
      if (Math.random() < 0.4 + ai.S.caution * 0.6) { ai.lookYaw = want; ai.lookUntil = G.now + 1.5 + Math.random(); }
    }
    // team alerts: help a teammate who is fighting nearby
    if (!best && team && team.alert && G.now - team.alert.t < 6) {
      const t = G.actorById(team.alert.id);
      const help = ai.tier === 'easy' ? 170 : ai.tier === 'normal' ? 130 : 100;
      const ignored = ai.ignore instanceof Map && (ai.ignore.get(team.alert.id) || 0) > G.now;
      if (t && t.alive && !ignored && G.now - team.alert.t < 6 && dist(b.x, b.z, team.alert.x, team.alert.z) < help && (this.kitted(b) || !(t.kind === 'survivor' && this.kitted(t)))) best = t;
    }
    if (best) {
      if (best === G.player) this.mgr.spotPlayer(team, best.x, best.z);
      if (best !== ai.target) this.startCombat(b, best);
      ai.targetSeen = G.now; ai.lastSeen = { x: best.x, z: best.z };
    }
  }
  // The moment a bot is hit (or a shot flies past it): turn on the shooter or run, and call the team.
  onHurt(b, a, nearMiss) {
    const G = this.game, ai = b.ai;
    if (!b.alive || !a || a === b || !a.alive) return;
    if (a.kind === 'survivor' && a.team && a.team === b.team) return;
    if (a.kind === 'animal' && nearMiss) return;
    ai.shotAt = { src: a, t: G.now, x: a.x, z: a.z, hit: !nearMiss };
    if (a === G.player) this.mgr.spotPlayer(G.teams.of(b), a.x, a.z);
    ai.perceiveT = 0;
    const team = G.teams.of(b);
    if (team && a.kind === 'survivor') {
      team.alert = { id: a.id, x: b.x, z: b.z, t: G.now };
      // teammates hear about it straight away, wherever they are
      for (const m of G.teams.alive(team)) if (m !== b && !m.ai.target && dist(m.x, m.z, b.x, b.z) < 150) { m.ai.perceiveT = 0; m.ai.redecide = true; }
    }
    const cur = ai.target;
    const switchTo = !cur || !cur.alive || cur === a || (cur.kind !== 'survivor' && a.kind === 'survivor') || dist(b.x, b.z, a.x, a.z) < dist(b.x, b.z, cur.x, cur.z) * 0.7;
    if (switchTo) {
      if (cur !== a) this.startCombat(b, a);
      ai.targetSeen = G.now; ai.lastSeen = { x: a.x, z: a.z };
      if (ai.ignore instanceof Map) ai.ignore.delete(a.id);
      const dec = this.engageDecision(b, a);
      ai.goal = dec === 'flee' ? 'flee' : 'fight';
      if (b.crouch && !nearMiss) b.crouch = false;
    }
  }
  underFire(b, a) { const s = b.ai.shotAt; return s && s.src === a && this.game.now - s.t < 10; }
  startCombat(b, t) {
    const ai = b.ai;
    ai.target = t; ai.reactT = ai.S.react * randRange(0.9, 1.3);   // expert about 0.3-0.45 s, a touch slower than a real player ai.targetSeen = this.game.now; ai.lastSeen = { x: t.x, z: t.z }; ai.engagedAt = this.game.now;
    ai.aimErrX = randRange(-1, 1); ai.aimErrY = randRange(-1, 1); ai.aimFor = null;
    const team = this.game.teams.of(b);
    if (team && t.kind === 'survivor') { if (b.lastHitBy === t) team.alert = { id: t.id, x: b.x, z: b.z, t: this.game.now }; this.game.teams.hostility(team, t.team, 1); }
  }
  endCombat(b, ignore) { const ai = b.ai; if (ignore && ai.target) { if (!(ai.ignore instanceof Map)) ai.ignore = new Map(); ai.ignore.set(ai.target.id, this.game.now + 150 + Math.random() * 150); } ai.target = null; ai.goal = 'task'; b.crouch = false; }

  // A ranged kit: a bow or gun with arrows / ammo to shoot. Rocks, spears and empty guns don't count.
  kitted(a) { return !!(a && a.inv && this.mgr.prog.bestGun(a)); }
  // Remember where a kitted enemy is, so a bare bot keeps clear of it while it rekits
  noteDanger(b, t) { b.ai.danger = { x: t.x, z: t.z, t: this.game.now }; }
  // A kitted enemy close by in the last few minutes (where this bot died, or where the clan saw the player)
  dangerNear(b, team) {
    const G = this.game, ai = b.ai, spots = [];
    if (ai.danger && G.now - ai.danger.t < 150) spots.push(ai.danger);
    if (team && team.intel && G.now - team.intel.t < 75 && G.player && G.player.alive && this.kitted(G.player)) spots.push(team.intel);
    return spots.find(p => dist(b.x, b.z, p.x, p.z) < 120) || null;
  }
  // The best bow or gun in the clan's boxes that has ammo stored with it: what a bare bot takes to rekit
  storedKit(b, prog) {
    if (!prog || !prog.st) return null;
    let best = null, bs = 0;
    for (const bx of prog.boxes) for (const sl of bx.cont.slots) {
      if (!sl) continue; const d = ITEMS[sl.id]; if (d.type !== 'gun' && d.type !== 'bow') continue;
      const ammo = d.ammo.find(a => prog.stash(a) > 0); if (!ammo && !(sl.ammo > 0)) continue;
      const sc = weaponScore(sl.id); if (sc > bs) { bs = sc; best = { id: sl.id, ammo }; }
    }
    if (!best) return null;
    const items = { [best.id]: 1 };
    if (best.ammo) items[best.ammo] = Math.min(prog.stash(best.ammo), ITEMS[best.id].type === 'bow' ? 30 : ITEMS[best.id].mag * 4);
    return items;
  }
  powerOf(a) {
    if (!a) return 0;
    if (a.kind === 'npc') return 45;
    if (a.kind === 'animal') return a.species === 'bear' ? 85 : a.species === 'wolf' ? 32 : a.species === 'boar' ? 16 : 5;
    const w = this.mgr.prog.bestWeapon(a);
    return weaponScore(w) + a.armorScore() * 18 + a.hp / 5;
  }
  engageDecision(b, t) {
    const G = this.game, ai = b.ai, S = ai.S, P = PERSONALITIES[ai.pers], team0 = G.teams.of(b);
    if (ai.cornered > G.now && ai.target === t) return 'fight';   // nowhere left to run
    // outgunned as a clan (an AK against bows): everyone keeps away from the player
    if (team0 && team0.retreat && G.now < team0.retreat.until && t === G.player) return 'flee';
    if (ai.ignore instanceof Map && (ai.ignore.get(t.id) || 0) > G.now && b.lastHitBy !== t) return 'ignore';
    // no bow or gun (rocks and spears don't count): never charge someone who has one. Back off and rekit
    if (t.kind === 'survivor' && !this.kitted(b) && this.kitted(t)) {
      const hit = b.lastHitBy === t && G.now - b.lastHitTime < 12;
      if (hit || dist(b.x, b.z, t.x, t.z) < 35) { this.noteDanger(b, t); return 'flee'; }
      return 'ignore';
    }
    const mine = this.powerOf(b), theirs = this.powerOf(t);
    const attacked = b.lastHitBy === t && G.now - b.lastHitTime < 12;
    const team = G.teams.of(b);
    // defending home means the enemy is at our base, not just that we happen to be near it
    let nearBase = false;
    if (team && team.base && team.base.st) { const st = G.build.structures.get(team.base.st); if (st) { const z = G.build.zoneOf(st); nearBase = dist(b.x, b.z, z.x, z.z) < z.r + 15 && dist(t.x, t.z, z.x, z.z) < z.r + 22; } }
    const d = dist(b.x, b.z, t.x, t.z);
    const allies = G.teams.alive(team || { members: [] }).filter(m => m !== b && dist(m.x, m.z, b.x, b.z) < 60).length;
    const odds = (mine * (1 + allies * 0.6)) / Math.max(1, theirs);
    if (b.hp < 25 && !nearBase && odds < 2) return 'flee';
    if (odds < 0.45 + S.caution * 0.5 && !nearBase) return attacked || d < 20 ? 'flee' : 'ignore';
    if (attacked || nearBase) return 'fight';
    if (t.kind === 'npc') return (ai.task && ai.task.type === 'monument') || d < 35 ? 'fight' : 'ignore';
    if (t.kind === 'animal') return 'fight';
    // carrying loot home? cautious bots avoid optional fights
    const carrying = b.inv.main.totalValue();
    if (carrying > 40 + 80 * (1 - S.caution) && S.caution > 0.5 && d > 25) return 'ignore';
    if (rawLoad(b) > 1200 && d > 15) return 'ignore';   // hauling materials home: not now
    if (ai.goal === 'fight') return 'fight';
    // fresh spawns and two rock-holders mostly leave each other alone
    if (t.kind === 'survivor' && G.now - (t.spawnedAt || 0) < 90) return 'ignore';
    const armed = weaponScore(this.mgr.prog.bestWeapon(b)) > 9, theyArmed = t.kind === 'survivor' && weaponScore(this.mgr.prog.bestWeapon(t)) > 9;
    if (!armed) return 'ignore';
    if (t.kind === 'survivor' && !this.kitted(b) && (theyArmed || d > 12)) return 'ignore';
    let kos = 0.05 * P.fight * (1 - S.caution * 0.5) * Math.min(1.5, odds) * ({ easy: 0.5, normal: 0.8, hard: 1, expert: 0.7 })[ai.tier];
    if (mode_far(b)) kos *= 0.5;
    kos *= styleOf(team).avoid;   // rushers and turtles don't go looking for fights
    if (armed && !theyArmed) kos *= 1.6;
    if (d < 12) kos *= 1.5;
    return Math.random() < kos ? 'fight' : 'ignore';
  }

  // ================= ECONOMY =================
  chooseEconomy(b, team) {
    const G = this.game, ai = b.ai, S = ai.S, P = PERSONALITIES[ai.pers];
    const prog = this.mgr.progressOf(team);
    // 1. water / food
    if (b.hyd < 70) { const w = this.findWater(b); if (w) return this.setTask(b, { type: 'drink', x: w.x, z: w.z }); }
    if (b.cal < 120 && !this.hasFood(b)) {
      const f = G.res.nearest(b.x, b.z, 120, n => n.type === 'pick' && (n.kind === 'berries' || n.kind === 'mushroom'));
      if (f) return this.setTask(b, { type: 'pick', node: f });
      const a = this.findPrey(b); if (a) return this.setTask(b, { type: 'hunt', animal: a });
    }
    // 1b. no kit and a kitted enemy about: don't wander back into them with a rock. Farm somewhere
    // quiet away from them until it blows over, then rekit (bow and arrows from the boxes, or craft them)
    if (!this.kitted(b)) {
      const kit = this.storedKit(b, prog);
      if (kit && (!ai.task || ai.task.type !== 'withdraw')) return this.setTask(b, { type: 'withdraw', items: kit });
      const dz = this.dangerNear(b, team);
      if (dz) {
        if (ai.task && ai.task.calm && G.now < ai.task.calmUntil) return;
        let ax = b.x - dz.x, az = b.z - dz.z; const L = Math.hypot(ax, az) || 1; ax /= L; az /= L;
        if (L < 1) { const a = Math.random() * Math.PI * 2; ax = Math.cos(a); az = Math.sin(a); }
        const tx = clampToIsland(G, dz.x + ax * 170, dz.z + az * 170), node = G.res.nearest(tx.x, tx.z, 60, n => n.type === 'tree' && !this.unreachable(b, n));
        const task = node ? { type: 'harvest', node, res: 'wood', need: b.inv.count('wood') + 300 } : { type: 'roam', x: tx.x, z: tx.z, until: G.now + 30 };
        task.calm = true; task.calmUntil = G.now + 40;
        return this.setTask(b, task);
      }
    }
    // 2. loot bags lying around
    const bag = G.loot.hash.nearest(b.x, b.z, 45, o => o.cont && o.label && !o.cont.isEmpty() && o.cont.totalValue() > 8 && b.inv.main.emptyCount() > 3);
    if (bag) return this.setTask(b, { type: 'lootbag', bag });
    // 3. tidy up: drop spare copies of tools and weapons, then deposit when heavy (needs room in a base box)
    this.cleanInventory(b);
    const boxRoom = prog.boxes.some(d => d.cont.emptyCount() > 1) || (prog.tc && prog.tc.cont.emptyCount() > 1);
    const holding = ai.keep && G.now < ai.keepUntil;   // carrying materials taken out for a job
    const load = rawLoad(b);
    const loaded = load > 1500;   // thousands of materials: bank them and build, don't wander off
    // only what a deposit actually puts away counts (ammo, meds and food stay on the bot)
    let bankable = 0, bankSlots = 0;
    for (const sl of b.inv.main.slots) if (sl && !(KEEP_CATS.has(ITEMS[sl.id].cat) && sl.id !== 'raw_meat')) { bankable += (ITEMS[sl.id].value || 0) * sl.n; bankSlots++; }
    if (prog.st && boxRoom && bankSlots > 0 && (b.inv.main.emptyCount() <= (holding ? 1 : 4) || (!holding && (bankable > 60 + 140 * (1 - S.caution) || loaded)))) {
      // first spend what's needed on the base, then bank the rest
      const affordable = team && team.base && this.mgr.builder.nextSteps(team, prog).find(st => st.kind !== 'deploy' && Object.keys(st.cost).length && Object.keys(st.cost).every(k => b.inv.count(k) >= st.cost[k]));
      if (affordable && !holding) { const t = this.stepTask(b, team, prog, affordable); if (t && t.type === 'build') return this.setTask(b, t); }
      return this.setTask(b, { type: 'deposit' });
    }
    // 4. base: the leader picks a site
    if (team && !team.base) {
      const leader = G.teams.leader(team);
      // the leader picks the spot; anyone hauling lots of wood does if the leader is far away
      const leaderFar = leader && leader !== b && dist(leader.x, leader.z, b.x, b.z) > 150;
      if ((leader === b && (b.inv.count('wood') >= 120 || G.now - b.spawnedAt > 120)) || (leaderFar && b.inv.count('wood') >= 400)) {
        const site = this.mgr.builder.chooseSite(team, b);
        if (site) { team.base = { site: { ox: site.ox, oy: site.oy, oz: site.oz, yaw: site.yaw }, template: site.template, final: site.final, st: null, x: site.ox, z: site.oz }; G.logEvent(`${team.name} started building a base`); }
      }
    }
    // candidates
    const options = [];
    const Y = styleOf(team);
    const heavy = rawLoad(b) > 1200 && !!(team && team.base);
    const AWAY = new Set(['loot', 'monument', 'roam', 'hunt', 'recycle']);
    const add = (score, task) => {
      if (!task) return;
      if (heavy) score *= AWAY.has(task.type) ? 0.2 : task.type === 'build' ? 1.6 : 1;
      // split the work: something a teammate is already doing is worth less to a second bot
      const taken = this.claimCount(team, this.taskKey(task), b);
      if (taken) score *= task.type === 'build' || task.type === 'craft' || task.type === 'hunt' ? 0.3 : taken >= 2 ? 0.3 : 0.55;
      options.push({ score: score * (1 + randRange(-S.noise, S.noise)), task });
    };
    const wishes = this.mgr.prog.wishes(b, team, prog);
    const first = wishes[0];
    // base steps (several tracks: shell, doors, deployables, upgrades)
    const steps = team && team.base ? this.mgr.builder.nextSteps(team, prog) : [];
    const toolsFirst = first && first.why === 'tools';
    steps.forEach((step, i) => {
      // big crafts (workbenches) get one crafter, so the clan pools materials instead of each member
      // hoarding a share and nobody ever having enough
      if (step.kind === 'deploy' && /^workbench[23]/.test(step.item || '') && b.inv.count(step.item) === 0 && this.benchCrafter(team, step.item) !== b) return;
      const urgent = step.kind === 'foundation' || step.kind === 'piece' || (step.kind === 'deploy' && ['claim_cabinet', 'wood_box', 'furnace'].includes(step.item)) || step.kind === 'door';
      const ready = (!step.item || b.inv.count(step.item) > 0) && Object.keys(step.cost).every(k => b.inv.count(k) >= step.cost[k]);
      const tech = step.kind === 'deploy' && /^workbench|research_table/.test(step.item);
      const behind = tech && (prog.arms ?? -1) > prog.bench;   // the player is ahead: benches first
      const sw = tech ? 1.6 * (team.style === 'rush' ? 1.6 : 1) * (behind ? 1.6 : 1) : urgent ? 1 : step.kind === 'upgrade' || step.kind === 'repair' ? Y.build : Math.sqrt(Y.build);
      add((urgent ? 2.2 : 1.3) * P.build * sw * (toolsFirst ? 0.6 : 1) * (ready ? 1.4 : 1) * (1 - i * 0.08), this.stepTask(b, team, prog, step));
    });
    const step = steps[0];
    // pool materials: if I carry what the next furnace / bench / box needs and I'm not the one
    // crafting it, put it in the box so whoever builds it has everything in one place
    if (prog.st && boxRoom && !holding && team && G.teams.alive(team).length > 1 && dist(b.x, b.z, prog.st.ox, prog.st.oz) < 220) {
      const mine = ai.claim || '';
      // what a deposit keeps back (materials for the planned walls and upgrades) doesn't count
      const kept = {}; for (const st of steps) for (const k in st.cost) kept[k] = (kept[k] || 0) + st.cost[k] * 3;
      const spare = (k) => b.inv.count(k) - (kept[k] || 0);
      for (const st of steps.slice(0, 2)) {
        if (st.kind !== 'deploy' || !RECIPE[st.item] || mine.endsWith(st.item)) continue;
        const rc = RECIPE[st.item];
        if (Object.keys(rc.cost).some(k => spare(k) >= Math.min(rc.cost[k], 25) && spare(k) * 4 >= rc.cost[k] && prog.stash(k) < rc.cost[k])) { add(2.3, { type: 'deposit' }); break; }
      }
    }
    // upkeep
    if (prog.st && prog.tc && prog.upkeepH < (6 + S.ambition * 8) * Y.upkeepH) add(2.4, this.upkeepTask(b, team, prog));
    // personal wishes (first two)
    for (const [i, w] of wishes.slice(0, 3).entries()) {
      const unarmed = !this.mgr.prog.bestGun(b);
      const base = { race: 3.0, raid: 1.7, tools: 2.6, weapon: unarmed ? 4.5 : 1.6 * P.fight, ammo: unarmed ? 3.5 : 1.2 * P.fight, clothes: 1.1, meds: 0.9, armour: 1.0 * P.fight }[w.why] || 1;
      const act = this.mgr.prog.resolve(b, prog, w.id, w.n);
      if (act) add(base * (i === 0 ? 1 : i === 1 ? 0.8 : 0.65), this.activityTask(b, team, act));
    }
    // loot runs: scrap matters for workbenches and unlocks
    const scrapNeed = prog.scrap < (prog.bench < 1 ? 60 : prog.bench < 2 ? 500 : 1300) * Math.max(Y.bench, 0.8) * ((prog.arms ?? -1) > prog.bench ? 1.5 : 1);
    const armed = weaponScore(this.mgr.prog.bestWeapon(b)) > 9;
    // no ranged kit, no trips: get a bow first, loot only close to home meanwhile
    const kitted = !!this.mgr.prog.bestGun(b) && (b.inv.count('wooden_arrow') + b.inv.count('hv_arrow') + b.inv.all().filter(s => ITEMS[s.id].type === 'ammo').length > 0);
    add(P.loot * Y.loot * (scrapNeed ? 1.3 : 0.5) * (armed ? 1 : 0.6) * (prog.st ? 1 : 0.5) * (kitted ? 1 : 0.3), this.lootTask(b, team, prog, kitted));
    // turtles stockpile: keep gathering the basics for walls and upkeep
    if (team && team.style === 'turtle' && prog.st) {
      const low = ['wood', 'stones', 'metal_frag'].find(k => prog.stash(k) < (k === 'metal_frag' ? 600 : 2500) * Math.max(1, G.settings.mult * 0.5));
      if (low) { const act = this.mgr.prog.resolve(b, prog, low, 400); if (act) add(1.25, this.activityTask(b, team, act)); }
    }
    // gun body runs: an AK needs a rifle body, and those come from the military crates at the big monuments
    if (prog.st && this.mgr.prog.bestGun(b)) {
      const bodies = (id) => prog.stash(id) + G.teams.membersOf(team).reduce((a, m) => a + m.inv.count(id), 0);
      if (prog.bench >= 3 && !G.teams.membersOf(team).some(m => m.inv.count('assault_rifle') > 0) && bodies('rifle_body') < 1) add(2.4, this.lootTask(b, team, prog, true, 'rifle_body'));
      else if (prog.bench >= 2 && bodies('semi_body') < 1 && !b.inv.count('semi_rifle')) add(1.6, this.lootTask(b, team, prog, true, 'semi_body'));
    }
    // recycling when carrying components
    const compValue = b.inv.main.slots.reduce((v, s) => v + (s && ITEMS[s.id].type === 'component' ? ITEMS[s.id].value * s.n : 0), 0);
    if (compValue > 25) add(1.4 + compValue / 60, this.recycleTask(b));
    // hunting for fat/leather/food
    const fatNeed = (b.inv.count('animal_fat') + prog.stash('animal_fat')) < 60 || (b.inv.count('leather') + prog.stash('leather')) < 30;
    add(P.hunt * (fatNeed ? 0.9 : 0.25), this.findPrey(b) ? { type: 'hunt', animal: this.findPrey(b) } : null);
    // research found items
    // research only with scrap to spare beyond what the next workbench needs
    const saving = prog.bench === 1 ? 500 : prog.bench === 2 ? 1250 : 0;
    if (prog.research && prog.scrap >= saving + 150) { const unknown = b.inv.main.slots.find(s => s && RECIPE[s.id] && !RECIPE[s.id].known && !b.bp.has(s.id)); if (unknown && b.inv.count('scrap') >= 40) add(1.5 * (team && team.style === 'rush' && prog.bench < 2 ? 0.3 : Y.research), { type: 'research', id: unknown.id, table: prog.research }); }
    // idle / roam for sloppier bots (around home, so the team stays together)
    const home = this.homeOrigin(b, team);
    add(S.idle * 3 * Y.idle, { type: 'roam', x: home.x + randRange(-40, 40), z: home.z + randRange(-40, 40), until: G.now + randRange(8, 20) });
    if (!options.length) return this.setTask(b, { type: 'roam', x: b.x + randRange(-50, 50), z: b.z + randRange(-50, 50), until: G.now + 15 });
    options.sort((a, c) => c.score - a.score);
    this.setTask(b, options[0].task);
  }
  hasFood(b) { return [...b.inv.belt.slots, ...b.inv.main.slots].some(s => s && ITEMS[s.id].type === 'food' && ITEMS[s.id].cal > 20); }
  findWater(b) {
    let best = null, bd = 700;
    for (const rv of this.game.world.rivers) for (let i = 0; i < rv.pts.length; i += 2) { const p = rv.pts[i]; if (p.s < 0.2) continue; const d = dist(b.x, b.z, p.x, p.z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  findPrey(b) {
    const strong = weaponScore(this.mgr.prog.bestWeapon(b)) > 9;
    const ranged = !!this.mgr.prog.bestGun(b);
    const o = this.homeOrigin(b, this.game.teams.of(b));
    return this.game.animals.nearest((b.x + o.x) / 2, (b.z + o.z) / 2, 200, a => a.alive && (ranged || a.species === 'boar' || a.species === 'chicken') && (strong || (a.species !== 'bear' && a.species !== 'wolf')));
  }

  // Convert a progression activity into a task.
  activityTask(b, team, act) {
    const G = this.game, prog = this.mgr.progressOf(team);
    switch (act.a) {
      case 'craft': {
        const bench = act.tier > 0 ? prog.benchDep(act.tier) : null;
        if (act.tier > 0 && !bench) return null;
        return { type: 'craft', id: act.id, times: Math.min(act.times, 10), bench };
      }
      case 'unlock': { const bench = prog.benchDep(act.tier); return bench ? { type: 'unlock', id: act.id, bench } : null; }
      case 'research': return prog.research ? { type: 'research', id: act.id, table: prog.research } : null;
      case 'withdraw': return { type: 'withdraw', items: act.items };
      case 'gather': {
        const kind = act.kind;
        const o = this.homeOrigin(b, team);
        const node = G.res.nearest(o.x, o.z, 200, n => !this.unreachable(b, n) && (kind === 'tree' ? n.type === 'tree' : (n.type === 'ore' && (n.kind === kind || (kind === 'stone' && n.kind !== 'sulfur'))) || (n.type === 'pick' && n.kind === kind + '_pile')))
          || G.res.nearest(b.x, b.z, 260, n => !this.unreachable(b, n) && (kind === 'tree' ? n.type === 'tree' : n.type === 'ore' && n.kind === kind))
          || G.res.nearest(o.x, o.z, 700, n => kind === 'tree' ? n.type === 'tree' : n.type === 'ore' && n.kind === kind);
        if (!node) return { type: 'roam', x: b.x + randRange(-150, 150), z: b.z + randRange(-150, 150), until: G.now + 30 };
        return node.type === 'pick' ? { type: 'pick', node } : { type: 'harvest', node, res: act.res, need: act.need + this.mgr.prog.buffer(act.res) };
      }
      case 'smelt': return prog.furnace ? { type: 'smelt', ore: act.ore, out: act.out } : null;
      case 'hemp': { const o = this.homeOrigin(b, team); const n = G.res.nearest(o.x, o.z, 300, n => n.type === 'pick' && n.kind === 'hemp' && !this.unreachable(b, n)); return n ? { type: 'pick', node: n, chain: 'hemp', need: act.need } : { type: 'hunt', animal: this.findPrey(b) }; }
      case 'hunt': { const a = this.findPrey(b); return a ? { type: 'hunt', animal: a } : null; }
      case 'loot': return this.lootTask(b, team, prog, true, act.res);
      case 'needBench': return null;
    }
    return null;
  }
  // Search origin for resources: the team base when there is one, otherwise where the bot stands.
  homeOrigin(b, team) {
    if (team && team.base) { const st = team.base.st && this.game.build.structures.get(team.base.st); if (st) { const z = this.game.build.zoneOf(st); return { x: z.x, z: z.z }; } return { x: team.base.x, z: team.base.z }; }
    // no base yet: stay near the leader so the team works the same area
    const L = team && this.game.teams.leader(team);
    if (L && L !== b && dist(L.x, L.z, b.x, b.z) < 600) return { x: L.x, z: L.z };
    return { x: b.x, z: b.z };
  }
  unreachable(b, n) { const u = b.ai.unreach; return u && u.get(n) > this.game.now; }
  markUnreachable(b, n) { const ai = b.ai; if (!ai.unreach) ai.unreach = new Map(); ai.unreach.set(n, this.game.now + 120); }

  stepTask(b, team, prog, step) {
    // make sure the bot holds what the step costs
    if (step.kind === 'deploy' || step.kind === 'door' || step.kind === 'lock' || step.kind === 'swapdoor') {
      if (b.inv.count(step.item) < 1) {
        const act = this.mgr.prog.resolve(b, prog, step.item, 1);
        return act ? this.activityTask(b, team, act) : null;
      }
      return { type: 'build', step };
    }
    for (const k in step.cost) {
      if (b.inv.count(k) < step.cost[k]) {
        const act = this.mgr.prog.resolve(b, prog, k, step.cost[k] * (step.kind === 'upgrade' ? 3 : 4));
        return act ? this.activityTask(b, team, act) : null;
      }
    }
    return { type: 'build', step };
  }
  upkeepTask(b, team, prog) {
    const st = prog.st; if (!st) return null;
    const u = G_upkeep(this.game, st);
    const hours = 12 + b.ai.S.ambition * 12;
    for (const k in u) {
      const want = Math.ceil(u[k] * hours) - prog.tc.cont.count(k);
      if (want <= 0) continue;
      if (b.inv.count(k) >= Math.min(want, 50)) return { type: 'stocktc', res: k, n: want };
      const act = this.mgr.prog.resolve(b, prog, k, Math.min(want, 1000));
      return act ? this.activityTask(b, team, act) : null;
    }
    return null;
  }
  // May this bot go to that monument? Guarded ones (militia) need a real gun with ammo, some armour
  // and good health; irradiated ones need radiation protection (hazmat for the launch site).
  monumentReady(b, m) {
    const G = this.game, gun = this.mgr.prog.bestGun(b), real = gun && ITEMS[gun.id].type === 'gun';
    const rounds = real ? (gun.ammo || 0) + b.inv.count(this.mgr.prog.ammoFor(gun.id)) : 0;
    const guarded = G.npcs.posts.some(p => p.mon === m.id);
    if (guarded && !(real && rounds >= ITEMS[gun.id].mag * 2 && b.armorScore() >= 0.6 && b.hp > 60)) return false;
    if (m.tier >= 2 && !real) return false;
    if (m.rad >= 1 && b.radProtection() < 0.25 * m.rad) return false;
    return true;
  }
  lootTask(b, team, prog, kitted = true, res = null) {
    const G = this.game, ai = b.ai, S = ai.S;
    const gear = weaponScore(this.mgr.prog.bestWeapon(b));
    if (res === 'low_grade') {
      const o = this.homeOrigin(b, team);
      const br = G.loot.hash.nearest(o.x, o.z, 400, x => x.kind === 'barrel' && x.alive && !this.unreachable(b, x));
      if (br) return { type: 'loot', cont: br };
    }
    if (!kitted) {
      const o = this.homeOrigin(b, team);
      const c = G.loot.hash.nearest(o.x, o.z, 140, x => x.kind && x.alive && !x.mon && !this.unreachable(b, x));
      return c ? { type: 'loot', cont: c } : null;
    }
    // a clan run is on: everyone who's ready for that monument goes along
    const run = team && team.monumentRun && G.now < team.monumentRun.until ? team.monumentRun : null;
    const runMon = run ? G.world.monuments.find(m => m.id === run.mon) : null;
    if (runMon && this.monumentReady(b, runMon)) return { type: 'monument', mon: runMon.id, run: true };
    // start a run: most of the clan goes together, to a harder monument once they need better parts
    const body = res === 'rifle_body' || res === 'smg_body' || res === 'semi_body';
    const wantMon = body || Math.random() < (ai.pers === 'looter' ? 0.8 : 0.45) * Math.min(1.3, Y_loot(team));
    if (wantMon && gear > 8 && (!team || G.now > (team.nextRunT || 0))) {
      const crew = team ? G.teams.alive(team) : [b];
      const minTier = res === 'rifle_body' ? 3 : (body || prog.bench >= 2) ? 2 : 1;
      const options = G.world.monuments.filter(m => m.tier >= minTier)
        .map(m => ({ m, ready: crew.filter(x => this.monumentReady(x, m)) }))
        .filter(o => o.ready.includes(b) && o.ready.length >= Math.max(1, Math.ceil(crew.length * 0.6)));
      let pick = null, bs = -Infinity;
      for (const o of options) { const sc = o.m.tier * 140 * S.lootGreed - dist(b.x, b.z, o.m.x, o.m.z) + o.ready.length * 20; if (sc > bs) { bs = sc; pick = o; } }
      // nothing hard enough is safe yet: a tier 1 run instead
      if (!pick && !body) { const t1 = G.world.monuments.filter(m => m.tier === 1 && crew.filter(x => this.monumentReady(x, m)).length >= Math.max(1, Math.ceil(crew.length * 0.6))); t1.sort((x, y) => dist(b.x, b.z, x.x, x.z) - dist(b.x, b.z, y.x, y.z)); if (t1[0]) pick = { m: t1[0] }; }
      if (pick) {
        if (team && crew.length > 1) { team.monumentRun = { mon: pick.m.id, until: G.now + 420 }; G.logEvent(`${team.name} are heading to the ${pick.m.name}`); }
        return { type: 'monument', mon: pick.m.id, run: true };
      }
    }
    const c = G.loot.hash.nearest(b.x, b.z, 350, o => o.kind && o.alive && !o.mon && !this.unreachable(b, o));
    if (c) return { type: 'loot', cont: c };
    const anyMon = G.world.monuments.filter(m => m.tier === 1).sort((a, c2) => dist(b.x, b.z, a.x, a.z) - dist(b.x, b.z, c2.x, c2.z))[0];
    return anyMon ? { type: 'monument', mon: anyMon.id } : null;
  }
  recycleTask(b) {
    const G = this.game;
    // only recyclers at monuments this bot can safely go to (not past the militia or into radiation)
    const ok = (d) => { const m = G.world.monuments.find(mm => dist(d.x, d.z, mm.x, mm.z) < mm.r + 12); return !m || this.monumentReady(b, m); };
    const r = G.deploy.list.filter(d => d.type === 'recycler' && ok(d)).sort((a, c) => dist(b.x, b.z, a.x, a.z) - dist(b.x, b.z, c.x, c.z))[0];
    return r && dist(b.x, b.z, r.x, r.z) < 900 ? { type: 'recycle', rec: r } : null;
  }

  // ================= EXECUTION =================
  exec(b, dt, mode) {
    const ai = b.ai;
    if (!b.alive) return;
    if (ai.goal === 'fight' && ai.target) return this.fight(b, dt, mode);
    if (ai.goal === 'flee' && ai.target) return this.flee(b, dt, mode);
    // stop for a moment and look towards gunfire
    if (ai.lookUntil > this.game.now) {
      b.yaw += clamp(angleWrap(ai.lookYaw - b.yaw), -6 * dt, 6 * dt); b.pitch *= 0.9;
      b.vx = b.vz = 0; b.vy -= 9.8 * dt; if (mode !== 'far') this.game.physics.move(b, dt);
      return;
    }
    const t = ai.task;
    if (!t) { b.vx = b.vz = 0; return; }
    if (this.game.now > t.until) { ai.task = null; ai.redecide = true; return; }
    const fn = this['t_' + t.type];
    const r = fn ? fn.call(this, b, t, dt, mode) : 'done';
    if (r === 'done' || r === 'fail') { ai.task = null; ai.redecide = true; ai.lastResult = r; }
  }
  // Equip an item by id (moving it to the belt if needed). Returns the stack.
  equip(b, pred) {
    const inv = b.inv;
    let bi = inv.belt.slots.findIndex(s => s && pred(s));
    if (bi < 0) {
      const mi = inv.main.slots.findIndex(s => s && pred(s));
      if (mi < 0) return null;
      let free = inv.belt.firstEmpty();
      if (free < 0) free = 5;
      const tmp = inv.belt.slots[free]; inv.belt.slots[free] = inv.main.slots[mi]; inv.main.slots[mi] = tmp; inv.belt.touch(); inv.main.touch();
      bi = free;
    }
    if (b.active !== bi) { b.active = bi; if (b.reloadT > 0) { b.reloadT = 0; b.reloadStack = null; } }
    return inv.belt.slots[bi];
  }
  equipTool(b, cls) {
    let best = null, bv = 0;
    for (const s of [...b.inv.belt.slots, ...b.inv.main.slots]) { if (!s) continue; const d = ITEMS[s.id]; if (!d.gather || (s.c !== undefined && s.c <= 0)) continue; const v = d.gather[cls] || 0; if (v > bv) { bv = v; best = s; } }
    if (!best) return null;
    return this.equip(b, s => s === best);
  }
  // Walk to a point; inside/near the bot's own base use the grid path through doors.
  goTo(b, x, z, dt, mode, arrive = 1.3, opts = {}) {
    const G = this.game, ai = b.ai;
    const team = G.teams.of(b);
    const st = opts.st || (team && team.base && team.base.st ? G.build.structures.get(team.base.st) : null);
    if (st && mode !== 'far') {
      const zn = G.build.zoneOf(st);
      const targetIn = dist(x, z, zn.x, zn.z) < zn.core;
      const meIn = dist(b.x, b.z, zn.x, zn.z) < zn.core;
      if (targetIn || meIn) {
        if (!ai.path || ai.pathFor !== `${x.toFixed(1)},${z.toFixed(1)}` || G.now - ai.pathT > 8) {
          if (!meIn && dist(b.x, b.z, zn.x, zn.z) > zn.core + 12) return this.nav.moveTo(b, zn.x + (b.x - zn.x) / Math.max(1, dist(b.x, b.z, zn.x, zn.z)) * (zn.core + 8), zn.z + (b.z - zn.z) / Math.max(1, dist(b.x, b.z, zn.x, zn.z)) * (zn.core + 8), dt, mode, { arrive: 3 }) && false;
          const cell = this.nav.cellOf(st, x, z);
          const r = this.nav.basePath(st, b.team, b.x, b.z, cell, !!opts.raid);
          ai.path = r ? r.path.concat([{ x, z }]) : [{ x, z }];
          ai.pathI = 0; ai.pathFor = `${x.toFixed(1)},${z.toFixed(1)}`; ai.pathT = G.now;
        }
        return this.nav.follow(b, ai.path, dt, mode, { arrive, force: opts.raid });
      }
    }
    return this.nav.moveTo(b, x, z, dt, mode, { arrive });
  }
  faceTo(b, x, y, z) { b.yaw = Math.atan2(x - b.x, z - b.z); const e = b.eye(); b.pitch = Math.atan2(y - e.y, Math.hypot(x - b.x, z - b.z)); }
  swingReady(b, mode) { return b.swingT <= 0; }

  // ---------- tasks ----------
  t_goto(b, t, dt, mode) { return this.goTo(b, t.x, t.z, dt, mode, t.arrive || 2, { raid: t.raid }) ? 'done' : undefined; }
  t_roam(b, t, dt, mode) { if (this.nav.moveTo(b, t.x, t.z, dt, mode, { arrive: 2, run: false })) { b.vx = b.vz = 0; if (this.game.now > t.until - 1) return 'done'; } }
  t_defend(b, t, dt, mode) { if (this.goTo(b, t.x, t.z, dt, mode, 3)) { b.vx = b.vz = 0; this.equipWeapon(b); } }
  t_guard(b, t, dt, mode) { const tx = t.near.x + (t.x - t.near.x) * 0.3, tz = t.near.z + (t.z - t.near.z) * 0.3; if (this.nav.moveTo(b, tx, tz, dt, mode, { arrive: 5 })) { b.vx = b.vz = 0; this.equipWeapon(b); } }
  t_drink(b, t, dt, mode) {
    if (this.nav.moveTo(b, t.x, t.z, dt, mode, { arrive: 4, swim: true })) {
      b.yaw = Math.atan2(t.x - b.x, t.z - b.z);
      const r = this.game.surv.drink(b) || (b.hyd = Math.min(250, b.hyd + 30), 'fresh');
      if (b.hyd > 220 || r === 'salt') return 'done';
    }
  }
  t_harvest(b, t, dt, mode) {
    const n = t.node, G = this.game;
    if (!n.alive) {
      // duty crew on a farm run: sulfur first, then wood (charcoal), stone and metal on the way,
      // until the bags are nearly full
      if (b.ai.duty && b.inv.main.emptyCount() > 3) {
        const pri = (m) => m.type === 'ore' && m.kind === 'sulfur' ? 0 : m.type === 'tree' ? 1 : m.type === 'ore' ? 2 : 9;
        let best = null, bs = Infinity;
        G.res.hash.query(b.x, b.z, 45, m => { if (!m.alive || this.unreachable(b, m) || pri(m) > 2) return; const sc = pri(m) * 25 + dist(b.x, b.z, m.x, m.z); if (sc < bs) { bs = sc; best = m; } });
        if (best) { t.node = best; t.need = Infinity; t.farm = true; return; }
      }
      if (b.inv.count(t.res) >= t.need) return 'done';
      // next node of the same kind nearby
      const nx = G.res.nearest(b.x, b.z, 80, m => m.type === n.type && (n.type === 'tree' || m.kind === n.kind) && !this.unreachable(b, m));
      if (!nx) return 'done';
      t.node = nx; return;
    }
    const reach = n.type === 'tree' ? 1.2 + 0.4 * n.s : n.type === 'corpse' ? 1.4 : 1.8;
    if (!this.nav.moveTo(b, n.x, n.z, dt, mode, { arrive: reach })) {
      if (b.ai.stuckT > 6) { this.markUnreachable(b, n); b.ai.stuckT = 0; return 'fail'; }
      return;
    }
    b.vx = b.vz = 0;
    const cls = n.type === 'tree' ? 'tree' : n.type === 'corpse' ? 'flesh' : 'ore';
    const st = this.equipTool(b, cls);
    if (!st) { // craft a rock
      if (b.inv.count('stones') >= 10) this.game.crafting.craft(b, 'rock', 1);
      return 'fail';
    }
    const d = ITEMS[st.id];
    this.faceTo(b, n.x, n.y + 1, n.z);
    if (b.swingT <= 0) {
      b.swingT = d.rate || 1;
      b.ai.swing = 1;
      const hits = mode === 'far' ? Math.max(1, Math.round(dt / (d.rate || 1))) : 1;
      const eff = b.ai.S.efficiency * styleOf(this.game.teams.of(b)).gather;
      for (let h = 0; h < hits && n.alive; h++) G.res.hit(b, n, d, st, eff);
      if (mode === 'full') { G.audio.hitAt(n.type === 'tree' ? 'wood' : 'stone', n); G.combat.fxAt(n.type === 'tree' ? 'wood' : n.type === 'corpse' ? 'flesh' : 'stone', { x: n.x + (b.x - n.x) * 0.3, y: n.y + 1, z: n.z + (b.z - n.z) * 0.3 }); }
    }
    if (b.inv.count(t.res) >= t.need) return 'done';
    if (b.inv.main.emptyCount() === 0 && b.inv.belt.emptyCount() === 0) return 'done';
    if (t.farm && b.inv.main.emptyCount() <= 3) return 'done';   // farm run over: head home and bank it
  }
  t_pick(b, t, dt, mode) {
    const n = t.node;
    if (!n.alive) {
      if (t.chain && b.inv.count('cloth') < t.need) { const nx = this.game.res.nearest(b.x, b.z, 120, m => m.type === 'pick' && m.kind === n.kind); if (nx) { t.node = nx; return; } }
      return 'done';
    }
    if (this.nav.moveTo(b, n.x, n.z, dt, mode, { arrive: 1.3 })) { this.game.res.pick(b, n); if (!t.chain) return 'done'; }
    else if (b.ai.stuckT > 6) { this.markUnreachable(b, n); return 'fail'; }
  }
  t_hunt(b, t, dt, mode) {
    const a = t.animal, G = this.game;
    if (!a) return 'fail';
    if (!a.alive) {
      // harvest the corpse
      const c = G.res.nearest(a.x, a.z, 6, n => n.type === 'corpse');
      if (!c) return 'done';
      this.setTask(b, { type: 'harvest', node: c, res: 'raw_meat', need: 9999, until: G.now + 60 });
      return;
    }
    a.watched = true;
    const d = dist(b.x, b.z, a.x, a.z);
    if (d > 28 && a.state !== 'chase') { b.crouch = d < 60; this.nav.moveTo(b, a.x, a.z, dt, mode, { arrive: 26, run: d > 60 }); return; }
    if (!b.ai.target) this.startCombat(b, a);
    b.ai.goal = 'fight';
  }
  t_craft(b, t, dt, mode) {
    if (t.bench) {
      if (!this.game.deploy.byId.has(t.bench.id)) return 'fail';
      if (!this.goTo(b, t.bench.x, t.bench.z, dt, mode, 2.2)) return;
      b.vx = b.vz = 0;
      if (mode === 'far') { b.x = t.bench.x + 1.2; b.z = t.bench.z; b.y = t.bench.y; }
    }
    const ok = this.game.crafting.craft(b, t.id, t.times);
    if (!ok && t.times > 1) this.game.crafting.craft(b, t.id, 1);
    return 'done';
  }
  t_unlock(b, t, dt, mode) {
    if (!this.game.deploy.byId.has(t.bench.id)) return 'fail';
    if (!this.goTo(b, t.bench.x, t.bench.z, dt, mode, 2.2)) return;
    if (this.game.crafting.unlock(b, t.id, t.bench.def.bench)) this.mgr.shareBlueprint(b, t.id);
    return 'done';
  }
  t_research(b, t, dt, mode) {
    const tb = t.table; if (!this.game.deploy.byId.has(tb.id)) return 'fail';
    if (!this.goTo(b, tb.x, tb.z, dt, mode, 2)) return;
    // move the item into the table and research it
    const src = [b.inv.main, b.inv.belt].find(c => c.slots.some(s => s && s.id === t.id));
    if (!src) return 'done';
    const i = src.slots.findIndex(s => s && s.id === t.id);
    if (tb.cont.slots[0]) return 'fail';
    tb.cont.slots[0] = { ...src.slots[i], n: 1 }; src.slots[i].n -= 1; if (src.slots[i].n <= 0) src.slots[i] = null; src.touch();
    if (this.game.crafting.research(b, tb.cont, 0)) this.mgr.shareBlueprint(b, t.id);
    else { const left = b.inv.giveStack(tb.cont.slots[0]); tb.cont.slots[0] = left; }
    return 'done';
  }
  baseContainers(b) {
    const team = this.game.teams.of(b);
    const prog = this.mgr.progressOf(team);
    const boxes = prog.deps.filter(d => d.cont && (d.type === 'wood_box' || d.type === 'large_box' || d.type === 'furnace'));
    // the claim cabinet holds materials too (and they pay its upkeep) when the boxes are full
    if (prog.tc && !boxes.some(d => d.type !== 'furnace' && d.cont.emptyCount() > 0)) boxes.push(prog.tc);
    return boxes;
  }
  t_withdraw(b, t, dt, mode) {
    const all = this.baseContainers(b), tc = this.mgr.progressOf(this.game.teams.of(b)).tc;
    if (tc && !all.includes(tc)) all.push(tc);
    const conts = all.filter(d => Object.keys(t.items).some(k => d.cont.count(k) > 0 && (d !== tc || !['wood', 'stones', 'metal_frag', 'hqm'].includes(k))));
    if (!conts.length) return 'done';
    const c = conts.sort((a, d) => dist(b.x, b.z, a.x, a.z) - dist(b.x, b.z, d.x, d.z))[0];
    if (!this.goTo(b, c.x, c.z, dt, mode, 1.8)) return;
    for (const k in t.items) {
      const take = Math.min(t.items[k], c.cont.count(k), b.inv.room(k));
      if (take > 0) {
        c.cont.remove(k, take); b.inv.give(k, take); t.items[k] -= take;
        // remember what was taken out for a job so it isn't put straight back
        const ai = b.ai; if (!ai.keep || this.game.now > ai.keepUntil) ai.keep = {};
        ai.keep[k] = (ai.keep[k] || 0) + take; ai.keepUntil = this.game.now + 240;
      }
    }
    if (Object.values(t.items).some(v => v > 0) && conts.length > 1) return;
    return 'done';
  }
  // Like a player sorting their base: throw out what the clan has outgrown (stone tools once metal
  // ones exist, spears and pipe pistols once they have real guns, spare cloth clothes, rocks and
  // torches) into a bag outside, then sort what's left.
  tidyBase(team, prog) {
    const G = this.game;
    const has = (ids) => ids.some(id => prog.stash(id) > 0 || G.teams.membersOf(team).some(m => m.inv.count(id) > 0));
    const realGun = has(['revolver', 'double_barrel', 'semi_pistol', 'pump_shotgun', 'drum_smg', 'scrap_smg', 'semi_rifle', 'assault_rifle', 'bolt_rifle']);
    const keep = { hunting_bow: Math.max(1, G.teams.alive(team).length), wooden_arrow: 400, cloth_shirt: 1, cloth_pants: 1, cloth_hood: 1 };
    const junk = (id, seen) => {
      if (id === 'rock' || id === 'torch') return true;
      if ((id === 'stone_hatchet' && has(['hatchet', 'salvaged_axe'])) || (id === 'stone_pickaxe' && has(['pickaxe', 'salvaged_icepick']))) return true;
      if (realGun && ['wooden_spear', 'stone_spear', 'bone_knife', 'pipe_pistol', 'handmade_shell'].includes(id)) return true;
      if (prog.bench >= 2 && ['cloth_shirt', 'cloth_pants', 'cloth_hood', 'bone_helmet', 'wood_chest'].includes(id)) return true;
      if (keep[id] !== undefined && seen > keep[id]) return true;
      return false;
    };
    const thrown = [], seen = {};
    for (const bx of prog.boxes) {
      for (let i = 0; i < bx.cont.size; i++) {
        const sl = bx.cont.slots[i]; if (!sl) continue;
        seen[sl.id] = (seen[sl.id] || 0) + sl.n;
        if (junk(sl.id, seen[sl.id])) { thrown.push(sl); bx.cont.slots[i] = null; }
      }
      sortContainer(bx.cont);
    }
    if (thrown.length && prog.st) { const z = G.build.zoneOf(prog.st); G.loot.spawnBag(z.x + z.r + 2, G.world.heightAt(z.x + z.r + 2, z.z) + 0.5, z.z, thrown, 'Thrown out', 300); }
    return thrown.length;
  }
  t_deposit(b, t, dt, mode) {
    const conts = this.baseContainers(b).filter(d => d.type !== 'furnace' && d.cont.emptyCount() > 0);
    if (!conts.length) return 'done';
    const c = conts.sort((a, d) => dist(b.x, b.z, a.x, a.z) - dist(b.x, b.z, d.x, d.z))[0];
    if (!this.goTo(b, c.x, c.z, dt, mode, 1.8)) return;
    // ores straight into the furnace
    const team = this.game.teams.of(b);
    const fur = this.mgr.progressOf(team).furnace;
    // keep resources for the next construction steps
    const keep = {};
    for (const st of this.mgr.builder.nextSteps(team, this.mgr.progressOf(team))) for (const k in st.cost) keep[k] = (keep[k] || 0) + st.cost[k] * 3;
    if (b.ai.keep && this.game.now < b.ai.keepUntil) for (const k in b.ai.keep) keep[k] = (keep[k] || 0) + b.ai.keep[k];
    for (let i = 0; i < b.inv.main.size; i++) {
      const s = b.inv.main.slots[i]; if (!s) continue;
      const d = ITEMS[s.id];
      if (KEEP_CATS.has(d.cat) && d.id !== 'raw_meat') continue;
      if (keep[s.id] > 0) { const k = Math.min(keep[s.id], s.n); keep[s.id] -= k; if (k >= s.n) continue; const part = { ...s, n: s.n - k }; s.n = k; const left = c.cont.addStack(part); if (left) s.n += left.n; continue; }
      if (fur && (d.smelt || d.cooks) && fur.cont.room(s.id) >= s.n && dist(b.x, b.z, fur.x, fur.z) < 12) { fur.cont.add(s.id, s.n); b.inv.main.slots[i] = null; continue; }
      const left = c.cont.addStack(s);
      b.inv.main.slots[i] = left;
    }
    b.inv.main.touch();
    if (fur && fur.cont.count('wood') < 40 && c.cont.count('wood') > 0) { const k = Math.min(100, c.cont.count('wood')); c.cont.remove('wood', k); fur.cont.add('wood', k); }
    if (fur && !fur.on && fur.cont.count('wood') > 0 && fur.cont.slots.some(s => s && (ITEMS[s.id].smelt || ITEMS[s.id].cooks))) this.game.deploy.toggle(fur);
    // every so often, whoever drops stuff off also tidies the boxes
    if (team && this.game.now - (team.tidyT || 0) > 120) { team.tidyT = this.game.now; this.tidyBase(team, this.mgr.progressOf(team)); }
    return 'done';
  }
  t_stocktc(b, t, dt, mode) {
    const team = this.game.teams.of(b), prog = this.mgr.progressOf(team);
    const tc = prog.tc; if (!tc) return 'fail';
    if (!this.goTo(b, tc.x, tc.z, dt, mode, 1.8)) return;
    const n = Math.min(t.n, b.inv.count(t.res), tc.cont.room(t.res));
    if (n > 0) { b.inv.remove(t.res, n); tc.cont.add(t.res, n); }
    return 'done';
  }
  t_smelt(b, t, dt, mode) {
    const team = this.game.teams.of(b), prog = this.mgr.progressOf(team);
    // with several furnaces, use the one with the least ore in it (pick once per trip)
    if (!t.f || !this.game.deploy.list.includes(t.f)) {
      const fs = prog.deps.filter(d => d.type === 'furnace');
      t.f = fs.sort((a, c) => (a.cont.count('metal_ore') + a.cont.count('sulfur_ore') + a.cont.count('hqm_ore')) - (c.cont.count('metal_ore') + c.cont.count('sulfur_ore') + c.cont.count('hqm_ore')))[0] || null;
    }
    const f = t.f; if (!f) return 'fail';
    if (!this.goTo(b, f.x, f.z, dt, mode, 1.8)) return;
    const G = this.game;
    // take finished output
    for (const id of ['metal_frag', 'sulfur', 'hqm', 'charcoal', 'cooked_meat']) { const k = Math.min(f.cont.count(id), b.inv.room(id)); if (k > 0) { f.cont.remove(id, k); b.inv.give(id, k); } }
    // load ore + fuel
    const ore = b.inv.count(t.ore);
    if (ore > 0) { const k = Math.min(ore, f.cont.room(t.ore)); if (k > 0) { b.inv.remove(t.ore, k); f.cont.add(t.ore, k); } }
    const fuelNeed = Math.ceil(f.cont.count(t.ore) * 0.5) + 10 - f.cont.count('wood');
    if (fuelNeed > 0) { const k = Math.min(fuelNeed, b.inv.count('wood'), f.cont.room('wood')); if (k > 0) { b.inv.remove('wood', k); f.cont.add('wood', k); } }
    if (!f.on) G.deploy.toggle(f);
    // load it and go, like a player (output is collected on the next trip); only a short wait
    if (!t.waitUntil) t.waitUntil = G.now + Math.min(8, f.cont.count(t.ore) * 0.3);
    if (G.now < t.waitUntil && f.on) { b.vx = b.vz = 0; return; }
    for (const id of ['metal_frag', 'sulfur', 'hqm', 'charcoal']) { const k = Math.min(f.cont.count(id), b.inv.room(id)); if (k > 0) { f.cont.remove(id, k); b.inv.give(id, k); } }
    return 'done';
  }
  t_build(b, t, dt, mode) {
    const G = this.game, team = G.teams.of(b), s = t.step;
    if (!team || !team.base) return 'fail';
    if (s.piece && !G.build.alive(s.piece)) return 'fail';
    if (s.spec && s.spec.st && !G.build.structures.has(s.spec.st)) return 'fail';
    let tx, tz;
    if (s.kind === 'foundation') { const c = Math.cos(s.newSt.yaw), sn = Math.sin(s.newSt.yaw); tx = s.newSt.ox + 1.5 * c + 1.5 * sn; tz = s.newSt.oz - 1.5 * sn + 1.5 * c; }
    else if (s.kind === 'piece') { const tf = G.build.specTransform(s.spec); tx = tf.x; tz = tf.z; }
    else if (s.piece) { tx = s.piece.wx; tz = s.piece.wz; }
    else { tx = s.x; tz = s.z; }
    const arrive = s.kind === 'deploy' ? 1.6 : 2.6;
    // within arm's reach with a clear view counts, like a player placing from beside a foundation
    const ty = s.y ?? (s.piece ? s.piece.wy : s.kind === 'foundation' ? s.newSt.oy + 1 : b.y);
    const reach = mode === 'far' ? 0 : s.kind === 'deploy' ? 2.8 : 3.4;
    const inReach = reach > 0 && dist(b.x, b.z, tx, tz) < reach && Math.abs(ty - b.y) < 2.6 && G.physics.los(b.eye(), { x: tx, y: ty + 0.4, z: tz });
    if (inReach) { b.vx = b.vz = 0; }
    else if (!this.goTo(b, tx, tz, dt, mode, arrive)) { if (b.ai.stuckT > 10) return 'fail'; return; }
    let r;
    switch (s.kind) {
      case 'foundation': {
        r = G.build.place(b, { type: 'foundation', i: s.i, j: s.j, k: 0, newSt: s.newSt });
        if (r.ok) { team.base.st = r.st.id; r.st.team = team.id; }
        else { team.base = null; team.siteFails = (team.siteFails || 0) + 1; team.lastSiteErr = r.err; if (team.siteFails % 3 === 1) G.logEvent(`${team.name} had to pick a new base site`); }
        break;
      }
      case 'piece': r = G.build.place(b, s.spec); break;
      case 'upgrade': r = G.build.upgrade(b, s.piece, s.grade); break;
      case 'repair': r = G.build.repair(b, s.piece); break;
      case 'demolish': { const st = G.build.structures.get(s.piece.st); if (st) { G.build.removePiece(st, s.piece, 'demolish'); G.build.recompute(st); } r = { ok: true }; break; }
      case 'door': r = G.build.placeDoor(b, s.piece, s.item); break;
      case 'swapdoor': {
        const old = s.piece.door; if (!old) { r = { ok: false }; break; }
        const lock = old.lock;
        G.build.removeDoor(s.piece);
        b.inv.give(old.type, 0);
        r = G.build.placeDoor(b, s.piece, s.item);
        if (r.ok && lock) { s.piece.door.lock = lock; G.build._buildDoorVisual(s.piece); }
        break;
      }
      case 'lock': r = G.build.placeLock(b, s.piece, s.item); if (r.ok) { for (const m of G.teams.membersOf(team)) if (!s.piece.door.lock.auth.includes(m.team)) s.piece.door.lock.auth.push(m.team); } break;
      case 'deploy': r = G.deploy.place(b, s.item, s.x, s.y, s.z, s.yaw); if (r.ok && s.item === 'claim_cabinet') { r.dep.auth.add(team.id); } break;
    }
    if (!r || !r.ok) {
      b.ai.buildFails = (b.ai.buildFails || 0) + 1; b.ai.lastBuildErr = r && r.err;
      // a slot that keeps failing (blocked by terrain or a neighbour) is dropped from the plan
      if (s.kind === 'piece' && r && r.err !== 'Someone is in the way' && r.err !== 'Not enough wood') {
        const key = G.build.keyOf(s.spec);
        team.base.fails = team.base.fails || {};
        team.base.fails[key] = (team.base.fails[key] || 0) + 1;
        if (team.base.fails[key] >= 3) { team.base.skip = team.base.skip || []; if (!team.base.skip.includes(key)) team.base.skip.push(key); }
      }
      return 'fail';
    }
    b.ai.buildFails = 0;
    // keep building while resources last
    const prog = this.mgr.progressOf(team);
    const next = this.mgr.builder.nextStep(team, prog);
    if (next && next.kind === s.kind && (!next.item || b.inv.count(next.item) > 0) && Object.keys(next.cost).every(k => b.inv.count(k) >= next.cost[k])) { t.step = next; return; }
    return 'done';
  }
  // Loot a roadside or monument container (barrels are broken first).
  t_loot(b, t, dt, mode) {
    const c = t.cont, G = this.game;
    if (!c.alive) { // barrel broke: grab the spill bag
      const bag = G.loot.hash.nearest(c.x, c.z, 3, o => o.cont && o.label && !o.cont.isEmpty());
      if (bag) { t.type = 'lootbag'; t.bag = bag; return; }
      return 'done';
    }
    const via = c.via;
    if (via && mode !== 'far') {
      if (!t.vi) t.vi = 0;
      while (t.vi < via.length && dist(b.x, b.z, c.x, c.z) > dist(via[t.vi].x, via[t.vi].z, c.x, c.z) + 0.5 && t.vi < via.length) {
        if (this.nav.moveTo(b, via[t.vi].x, via[t.vi].z, dt, mode, { arrive: 1 })) { t.vi++; } return;
      }
    }
    if (!this.nav.moveTo(b, c.x, c.z, dt, mode, { arrive: c.kind === 'barrel' ? 1.6 : 1.4 })) {
      if (b.ai.stuckT > 8) { this.markUnreachable(b, c); return 'fail'; }
      return;
    }
    b.vx = b.vz = 0;
    if (c.kind === 'barrel') {
      const st = this.equipTool(b, 'tree') || this.equip(b, s => ITEMS[s.id].type === 'melee');
      if (b.swingT <= 0) { b.swingT = st ? ITEMS[st.id].rate : 0.8; b.ai.swing = 1; this.faceTo(b, c.x, c.y + 0.5, c.z); const hits = mode === 'far' ? Math.max(1, Math.round(dt / b.swingT)) : 1; for (let h = 0; h < hits; h++) G.loot.hitContainer(c, st ? ITEMS[st.id].dmg : 6, b); if (mode === 'full') G.audio.hitAt('stone', c); }
      return;
    }
    this.takeFrom(b, c.cont, true);
    G.loot.touched(c);
    return 'done';
  }
  t_lootbag(b, t, dt, mode) {
    const bag = t.bag;
    if (!this.game.loot.bags.includes(bag)) return 'done';
    if (!this.nav.moveTo(b, bag.x, bag.z, dt, mode, { arrive: 1.4 })) return;
    this.takeFrom(b, bag.cont);
    this.autoWear(b);
    return 'done';
  }
  // Take items from a container, most valuable first.
  // Who crafts the clan's next workbench: whoever already holds most of what it costs (kept while alive)
  benchCrafter(team, item) {
    const G = this.game, alive = G.teams.alive(team);
    if (!alive.length) return null;
    team.crafters = team.crafters || {};
    let c = G.actorById(team.crafters[item]);
    if (c && c.alive && c.team === team.id) return c;
    const rc = RECIPE[item], worth = m => rc ? Object.keys(rc.cost).reduce((a, k) => a + Math.min(1, m.inv.count(k) / rc.cost[k]), 0) : 0;
    c = alive.slice().sort((x, y) => worth(y) - worth(x) || x.id.localeCompare(y.id))[0];
    team.crafters[item] = c.id;
    return c;
  }
  // Bots play 24/7 in big groups; at low loot multipliers they get a little more scrap and HQ metal from
  // the world (crates, barrels, nodes, recyclers) so the late game still arrives: x2.5 at 1x, x1.6 at 2x.
  pace() { const m = this.game.settings.mult || 1; return m >= 4 ? 1 : m >= 2 ? 1.6 : 2.5; }
  takeFrom(b, cont, world = false) {
    if (world) { const f = this.pace(); if (f > 1) for (const s of cont.slots) if (s && (s.id === 'scrap' || s.id === 'hqm') && !s.paced) { s.n = Math.round(s.n * f); s.paced = true; } }
    const order = cont.slots.map((s, i) => [s, i]).filter(x => x[0]).sort((a, c) => ITEMS[c[0].id].value * c[0].n - ITEMS[a[0].id].value * a[0].n);
    // rushers know which crates matter and strip them for scrap
    const rush = (this.game.teams.of(b) || {}).style === 'rush';
    for (const [s, i] of order) {
      if (rush && s.id === 'scrap') s.n = Math.round(s.n * 1.7);
      const left = b.inv.giveStack(s);
      cont.slots[i] = left || null;
      if (left) break;
    }
    cont.touch();
    this.autoWear(b);
  }
  // Keep one of each tool/weapon (the best condition), drop spare copies and extra torches/rocks.
  cleanInventory(b) {
    const best = new Map();
    const all = [];
    for (const c of [b.inv.belt, b.inv.main]) c.slots.forEach((s, i) => { if (s && s.c !== undefined && ITEMS[s.id].type !== 'wear') all.push({ c, i, s }); });
    for (const e of all) { const cur = best.get(e.s.id); if (!cur || (e.s.c || 0) > (cur.s.c || 0)) best.set(e.s.id, e); }
    for (const e of all) {
      if (best.get(e.s.id) === e) continue;
      e.c.slots[e.i] = null; e.c.touch();
      this.game.loot.dropItem(e.s.id, e.s.n, b.x, b.y + 1, b.z, e.s);
    }
    // worn-out tools go too
    for (const c of [b.inv.belt, b.inv.main]) c.slots.forEach((s, i) => { if (s && s.c !== undefined && s.c <= 0 && ITEMS[s.id].type !== 'wear') { c.slots[i] = null; c.touch(); } });
  }
  autoWear(b) {
    for (const c of [b.inv.main, b.inv.belt]) for (let i = 0; i < c.size; i++) {
      const s = c.slots[i]; if (!s || ITEMS[s.id].type !== 'wear') continue;
      if (!b.inv.equip(s)) { c.slots[i] = null; c.touch(); }
    }
  }
  t_monument(b, t, dt, mode) {
    const G = this.game, m = G.world.monuments.find(x => x.id === t.mon);
    if (!m) return 'fail';
    if (!t.phase) t.phase = 'travel';
    // turn back if this bot isn't ready for it any more (lost its gun, hurt, out of ammo)
    // at a guarded or irradiated monument that check holds the whole time: out of ammo or hurt means leaving
    const risky = m.rad >= 1 || G.npcs.posts.some(p => p.mon === m.id);
    if ((t.phase !== 'loot' || risky) && !this.monumentReady(b, m)) return 'fail';
    if (t.phase === 'travel') {
      if (!this.nav.moveTo(b, m.x, m.z, dt, mode, { arrive: m.r * 0.6 })) return;
      t.phase = 'loot'; t.done = new Set(); t.lootUntil = G.now + 150 + m.tier * 60;
    }
    if (t.phase === 'loot' && G.now > t.lootUntil) t.phase = 'recycle';   // don't hang around
    if (t.phase === 'loot') {
      if (t.sub) { const fn = t.sub.type === 'lootbag' ? this.t_lootbag : this.t_loot; const r = fn.call(this, b, t.sub, dt, mode); if (r === 'done' || r === 'fail') { t.done.add(t.sub.cont); t.sub = null; } return; }
      if (b.inv.main.emptyCount() < 3) { t.phase = 'recycle'; return; }
      const c = G.loot.hash.nearest(b.x, b.z, m.r + 10, o => o.kind && o.alive && o.mon === m.id && !t.done.has(o) && !this.unreachable(b, o) && (G.survRadiation(o) < 1.5 || b.radProtection() > 0.3));
      if (c) { t.sub = { type: 'loot', cont: c }; return; }
      t.phase = 'recycle';
    }
    if (t.phase === 'recycle') {
      const rec = G.deploy.list.find(d => d.type === 'recycler' && dist(d.x, d.z, m.x, m.z) < m.r + 10);
      const hasComp = b.inv.main.slots.some(s => s && ITEMS[s.id].type === 'component');
      const team = G.teams.of(b);
      if (team && team.monumentRun && team.monumentRun.mon === m.id) { team.monumentRun = null; team.nextRunT = G.now + 360; }   // run over; next one later
      if (rec && hasComp) { t.type = 'recycle'; t.rec = rec; t.phase = null; return; }
      return 'done';
    }
  }
  t_recycle(b, t, dt, mode) {
    const r = t.rec, G = this.game;
    if (!this.nav.moveTo(b, r.x, r.z, dt, mode, { arrive: 1.8 })) { if (b.ai.stuckT > 8) return 'fail'; return; }
    b.vx = b.vz = 0;
    if (!t.loaded) {
      // load components (keep a few needed for crafting)
      for (let i = 0; i < b.inv.main.size; i++) {
        const s = b.inv.main.slots[i]; if (!s) continue;
        const d = ITEMS[s.id];
        if (d.type !== 'component' && !(d.type === 'wear' && d.value < 3 && b.inv.wear.count(s.id) === 0)) continue;
        const slot = r.cont.slots.slice(0, 6).findIndex(x => !x);
        if (slot < 0) break;
        if (['rope', 'sewing_kit', 'metal_spring', 'metal_pipe', 'semi_body', 'rifle_body', 'smg_body', 'gears', 'tech_trash'].includes(s.id) && this.keepComponent(b, s.id)) {
          // needed for crafting: keep a working stock, recycle only the surplus (pipes and springs pile up)
          const keep = s.id === 'metal_pipe' ? 12 : s.id === 'metal_spring' ? 8 : Infinity;
          if (s.n <= keep) continue;
          r.cont.slots[slot] = { ...s, n: s.n - keep }; s.n = keep;
          continue;
        }
        r.cont.slots[slot] = s; b.inv.main.slots[i] = null;
      }
      r.cont.touch(); b.inv.main.touch();
      if (!r.on) G.deploy.toggle(r);
      t.loaded = true; t.waitUntil = G.now + 70;
    }
    // collect output as it comes
    for (let i = 6; i < 12; i++) { const s = r.cont.slots[i]; if (s) { if ((s.id === 'scrap' || s.id === 'hqm') && !s.paced) { s.n = Math.round(s.n * this.pace()); s.paced = true; } const left = b.inv.giveStack(s); r.cont.slots[i] = left || null; } }
    r.cont.touch();
    const inputLeft = r.cont.slots.slice(0, 6).some(Boolean);
    if (!inputLeft || G.now > t.waitUntil) {
      // take back anything unprocessed
      for (let i = 0; i < 6; i++) { const s = r.cont.slots[i]; if (s) { const left = b.inv.giveStack(s); r.cont.slots[i] = left || null; } }
      return 'done';
    }
  }
  keepComponent(b, id) {
    // keep components the bot's next weapon/armour recipe needs
    const team = this.game.teams.of(b);
    const prog = this.mgr.progressOf(team);
    // gun bodies are the rare part of the guns the clan is heading for: never recycle them
    if (id === 'rifle_body') return true;
    if ((id === 'semi_body' || id === 'smg_body') && prog.bench >= 1) return true;
    for (const w of this.mgr.prog.wishes(b, team, prog).slice(0, 3)) { const rc = RECIPE[w.id]; if (rc && rc.cost[id]) return true; }
    if (team && team.raid && RECIPE[team.raid.method] && RECIPE[team.raid.method].cost[id]) return true;
    return false;
  }
  t_activity(b, t, dt, mode) { return 'done'; }

  // ---------- raid tasks ----------
  t_breach(b, t, dt, mode) {
    const G = this.game, p = t.piece;
    const alive = p.type === 'doorway' ? !!p.door : t.st.pieces.has(p.key);
    if (!alive) return 'done';
    if (t.method === 'rocket') return this._rocketBreach(b, t, dt, mode);
    // stand on the outside of the piece, on the side we're approaching from
    const nx = Math.sin(p.wyaw + Math.PI / 2), nz = Math.cos(p.wyaw + Math.PI / 2);
    const side = (b.x - p.wx) * nx + (b.z - p.wz) * nz >= 0 ? 1 : -1;
    const sx = p.wx + nx * side * 1.3, sz = p.wz + nz * side * 1.3;
    if (!t.placed || G.now > t.placed + 14) {
      if (!this.nav.moveTo(b, sx, sz, dt, mode, { arrive: 0.9 })) return;
      if (t.method === 'melee' || t.method === 'walk') {
        const st = this.equipTool(b, 'tree') || this.equip(b, s => ITEMS[s.id].type === 'melee');
        if (b.swingT <= 0 && st) {
          b.swingT = ITEMS[st.id].rate; b.ai.swing = 1; this.faceTo(b, p.wx, p.wy + 1.2, p.wz);
          const dmg = ITEMS[st.id].dmg;
          if (p.type === 'doorway' && p.door) G.build.damageDoor(p, dmg, 'melee', b); else G.build.damagePiece(p, dmg, 'melee', b);
          if (st.c !== undefined) st.c = Math.max(0, st.c - 1 / (ITEMS[st.id].dur || 300));
          if (mode === 'full') G.audio.hitAt('wood', p);
        }
        return;
      }
      if (b.inv.count(t.method) <= 0) return 'done';
      const def = ITEMS[t.method];
      const live = G.combat.charges.filter(c => Math.hypot(c.x - p.wx, c.z - p.wz) < 2.5).length;
      const hp = p.type === 'doorway' && p.door ? p.door.hp : p.hp;
      const per = def.dmg;
      const needed = Math.max(1, Math.ceil(hp / per) - live);
      for (let i = 0; i < Math.min(needed, b.inv.count(t.method)); i++) G.combat.throwCharge(b, t.method, { x: p.wx + nx * side * 0.25 + randRange(-0.2, 0.2), y: p.wy + 1 + randRange(-0.3, 0.3), z: p.wz + nz * side * 0.25 });
      t.placed = G.now;
      if (mode === 'full') G.audio.click();
    }
    // back off while it blows
    this.nav.moveTo(b, p.wx + nx * side * 9, p.wz + nz * side * 9, dt, mode, { arrive: 1 });
  }
  // Rocket raid: stand off about 18 m with a clear shot and put rockets into the wall or door.
  _rocketBreach(b, t, dt, mode) {
    const G = this.game, p = t.piece;
    if (b.inv.count('rocket') <= 0 || b.inv.count('rocket_launcher') <= 0) return 'done';
    const nx = Math.sin(p.wyaw + Math.PI / 2), nz = Math.cos(p.wyaw + Math.PI / 2);
    if (t.side === undefined) t.side = (b.x - p.wx) * nx + (b.z - p.wz) * nz >= 0 ? 1 : -1;
    if (t.range === undefined) t.range = 18;
    const sx = p.wx + nx * t.side * t.range, sz = p.wz + nz * t.side * t.range;
    if (!t.inPos) { if (!this.nav.moveTo(b, sx, sz, dt, mode, { arrive: 3, run: true })) return; t.inPos = true; }
    b.vx = b.vz = 0;
    this.equip(b, s => s.id === 'rocket_launcher');
    const ty = p.wy + 1.2;
    this.faceTo(b, p.wx, ty, p.wz);
    b.fireT = (b.fireT || 0) - dt;
    if (b.fireT > 0) return;
    const e = b.eye(); const dx = p.wx - e.x, dy = ty - e.y, dz = p.wz - e.z, L = Math.hypot(dx, dy, dz) || 1;
    if (!G.physics.los(e, { x: p.wx - dx / L * 0.8, y: ty, z: p.wz - dz / L * 0.8 }, c => !(c.ref === p || (p.door && c.ref === p)))) { if (t.range > 6) { t.range -= 4; t.inPos = false; return; } }   // something in the way: step closer
    const err = b.ai.S.aimErr * 1.5;
    const ux = dx / L + randRange(-err, err), uy = dy / L + randRange(-err, err) + L * 0.0014, uz = dz / L + randRange(-err, err);
    const ul = Math.hypot(ux, uy, uz), v = ITEMS.rocket_launcher.vel;
    b.inv.remove('rocket', 1);
    G.combat.spawnProjectile({ x: e.x + ux / ul * 0.8, y: e.y + uy / ul * 0.8, z: e.z + uz / ul * 0.8, vx: ux / ul * v, vy: uy / ul * v, vz: uz / ul * v, dmg: 0, owner: b, weapon: 'rocket_launcher', ammo: 'rocket', bleed: 0, rocket: { dmg: ITEMS.rocket.blast, radius: ITEMS.rocket.radius } });
    G.events.emit('noise', { x: b.x, z: b.z, r: 320, src: b, kind: 'shot', weapon: 'rocket_launcher' });
    if (mode === 'full' && G.audio) G.audio.shot(ITEMS.rocket_launcher, b);
    b.ai.swing = 0; b.fireT = 3.5 + Math.random();
  }
  t_raidloot(b, t, dt, mode) {
    const G = this.game, d = t.dep;
    if (!G.deploy.byId.has(d.id) || d.cont.isEmpty()) return 'done';
    if (!this.goTo(b, d.x, d.z, dt, mode, 1.6, { st: t.st, raid: true })) { if (b.ai.stuckT > 12) return 'fail'; return; }
    const before = b.inv.totalValue();
    this.takeFrom(b, d.cont);
    const team = G.teams.of(b);
    if (team && team.raid) { team.raid.lootedValue += Math.max(0, b.inv.totalValue() - before); }
    return 'done';
  }

  // ================= COMBAT =================
  equipWeapon(b) {
    const best = this.mgr.prog.bestWeapon(b);
    if (!best) return null;
    const cur = b.activeStack();
    if (cur && cur.id === best && (cur.c === undefined || cur.c > 0)) return cur;
    return this.equip(b, s => s.id === best && (s.c === undefined || s.c > 0));
  }
  preferredRange(d) {
    if (!d || (d.type !== 'gun' && d.type !== 'bow')) return 1.4;
    if (d.icon === 'shotgun' || d.id === 'pipe_pistol') return 7;
    if (d.type === 'bow') return 18;
    if (d.id === 'bolt_rifle') return 55;
    if (d.icon === 'rifle') return 35;
    if (d.icon === 'smg') return 18;
    return 20;
  }
  fight(b, dt, mode) {
    const G = this.game, ai = b.ai, S = ai.S, t = ai.target;
    if (!t || !t.alive) { this.endCombat(b); return; }
    const team = G.teams.of(b);
    // call for help only when actually under fire
    if (team && t.kind === 'survivor' && ((b.lastHitBy === t && G.now - b.lastHitTime < 6) || b.hp < 50)) team.alert = { id: t.id, x: b.x, z: b.z, t: G.now };
    const st = this.equipWeapon(b);
    const def = st ? ITEMS[st.id] : null;
    const ranged = def && (def.type === 'gun' || def.type === 'bow');
    const d = dist(b.x, b.z, t.x, t.z);
    if (mode === 'far') return this.abstractFight(b, t, st, def, d, dt);
    // reload when empty
    if (ranged && def.type === 'gun' && st.ammo <= 0) {
      if (!G.combat.startReload(b, st, def) && b.reloadT <= 0) {
        // out of ammo for this gun: fall back to another weapon
        if (G.combat.ammoTypeFor(b, st, def) && b.inv.count(st.at) <= 0) { const alt = this.equip(b, s => s !== st && ITEMS[s.id].dmg && (ITEMS[s.id].type === 'melee' || ITEMS[s.id].type === 'tool' || b.inv.count(s.at) > 0 || (s.ammo || 0) > 0)); if (!alt) return this.flee(b, dt, mode); }
      }
    }
    G.combat.tickSurvivor(b, dt);
    // movement
    const want = this.preferredRange(def);
    const tx = t.x, tz = t.z;
    // taking fire in the open: throw down a barricade between us and them
    if (ranged && d > 12 && d < 90 && this.underFire(b, t) && b.inv.count('barricade') > 0 && G.now > (ai.barrT || 0) && mode !== 'far') {
      ai.barrT = G.now + 18 + Math.random() * 10;
      const ux = (tx - b.x) / d, uz = (tz - b.z) / d, bx = b.x + ux * 1.6, bz = b.z + uz * 1.6;
      const sup = G.deploy.supportAt(bx, b.y, bz);
      G.deploy.place(b, 'barricade', bx, sup ? sup.wy : G.world.heightAt(bx, bz), bz, Math.atan2(ux, uz) + Math.PI);
    }
    // don't chase someone across the island: a target that stays out of range and isn't
    // shooting at us any more is let go (and left alone for a while)
    if (d > want + 45 && !this.underFire(b, t) && !(team && team.underAttack > 0)) { ai.chaseT = (ai.chaseT || 0) + dt; if (ai.chaseT > 10) { ai.chaseT = 0; this.endCombat(b, true); return; } } else ai.chaseT = 0;
    ai.strafeT = (ai.strafeT || 0) - dt;
    if (ai.strafeT <= 0) { ai.strafeT = randRange(0.6, 1.8); ai.strafeDir = Math.random() < 0.5 ? -1 : 1; b.crouch = ranged && d > 25 && Math.random() < S.crouch; }
    const reloading = b.reloadT > 0;
    // pushing as a clan: fan out around the target instead of walking in a line
    let gx = tx, gz = tz;
    if (team && team.push && t === G.player && d > 8) {
      // only clanmates actually in on the push count, and the fan closes up as they get near
      const mates = G.teams.alive(team).filter(m => dist(m.x, m.z, tx, tz) < 150), idx = mates.indexOf(b), n = mates.length;
      const off = idx < 0 ? 0 : (idx - (n - 1) / 2) * 6 * Math.min(1, (d - 8) / 30);
      gx = tx - (b.z - tz) / d * off; gz = tz + (b.x - tx) / d * off;
    }
    if (!ranged || d > want + 6) { this.nav.moveTo(b, gx, gz, dt, mode, { arrive: ranged ? want : 1.2, run: true }); b.crouch = false; }
    else if (d < want - 4 || (reloading && S.caution > 0.5)) { const ax = b.x - (tx - b.x), az = b.z - (tz - b.z); this.nav.moveTo(b, ax, az, dt, mode, { arrive: 0.5, run: true }); }
    else if (Math.random() < S.strafe) {
      const ang = Math.atan2(tx - b.x, tz - b.z) + ai.strafeDir * Math.PI / 2;
      this.nav.moveTo(b, b.x + Math.sin(ang) * 3, b.z + Math.cos(ang) * 3, dt, mode, { arrive: 0.3, run: false });
    } else { b.vx = b.vz = 0; b.vy -= 9.8 * dt; G.physics.move(b, dt); }
    // aim
    const head = Math.random() < S.headChance * 0.05 ? true : (ai.aimHead ?? false);
    if (Math.random() < 0.02) ai.aimHead = Math.random() < S.headChance * (def && def.type === 'bow' ? 0.5 : 1);
    const ty = t.y + (t.kind === 'animal' ? (t.size || 0.6) * 0.9 : head ? (t.crouch ? 1.15 : 1.62) : (t.crouch ? 0.85 : 1.2));
    const e = b.eye();
    const vel = def && ranged ? def.vel : 300;
    const travel = d / vel;
    // leading a moving target is guesswork, more so with slow arrows
    if (ai.leadFor !== t || G.now > (ai.leadT || 0)) { ai.leadFor = t; ai.leadT = G.now + 1.2; ai.leadErr = randRange(-0.45, 0.45) * (def && def.type === 'bow' ? 1.6 : 1); }
    const lead = (0.3 + S.recoilCtrl * 0.7) * (1 + ai.leadErr);
    const px = tx + (t.vx || 0) * travel * lead, pz = tz + (t.vz || 0) * travel * lead;
    const drop = ranged ? 0.5 * 9.81 * (def.type === 'bow' || def.id === 'crossbow' ? 0.5 : 0.35) * travel * travel * (0.3 + S.recoilCtrl * 0.7) : 0;
    ai.errT = (ai.errT || 0) - dt;
    if (ai.errT <= 0) { ai.errT = 0.4; ai.aimErrX = randRange(-1, 1); ai.aimErrY = randRange(-1, 1); }
    const moving = Math.hypot(t.vx || 0, t.vz || 0) > 1;
    const bow = def && def.type === 'bow';
    // the first shots of a fight are rushed; aim settles over a couple of seconds
    const settle = 1 + 1.6 * Math.exp(-(G.now - (ai.engagedAt ?? -99)) / 1.4);
    const err = settle * S.aimErr * (1 + d / 70) * (moving ? 1.5 : 1) * (G.env.isNight ? 1.3 : 1) * (bow ? 1.5 : 1) * (Math.hypot(b.vx, b.vz) > 1 ? 1.3 : 1);
    const wantYaw = Math.atan2(px - e.x, pz - e.z) + ai.aimErrX * err;
    const wantPitch = Math.atan2(ty + drop - e.y, Math.hypot(px - e.x, pz - e.z)) + ai.aimErrY * err * 0.6;
    // The bot tracks its intended aim; recoil drift (rs.accP/accY) sits on top of it and is only
    // pulled back as fast as the bot's recoil control allows - the same kick the player feels.
    if (ai.aimYaw === undefined || ai.aimFor !== t) { ai.aimYaw = b.yaw; ai.aimPitch = b.pitch; ai.aimFor = t; }
    const turn = 2.2 + S.recoilCtrl * 4;   // nobody snaps 180 degrees in a frame
    const dy = angleWrap(wantYaw - ai.aimYaw);
    ai.aimYaw += clamp(dy, -turn * dt, turn * dt);
    ai.aimPitch += clamp(wantPitch - ai.aimPitch, -turn * dt, turn * dt);
    const rs = Recoil.update(b, ranged ? def : null, dt, G.now, dt * (1.5 + S.recoilCtrl * 12));
    b.yaw = ai.aimYaw - rs.accY * Math.PI / 180 - rs.pendY * 0;
    b.pitch = ai.aimPitch + rs.accP * Math.PI / 180;
    ai.reactT -= dt;
    // line of sight (cached)
    ai.losT = (ai.losT || 0) - dt;
    if (ai.losT <= 0) { ai.losT = 0.25; ai.los = G.physics.los(e, { x: tx, y: ty, z: tz }); if (ai.los) { ai.targetSeen = G.now; ai.lastSeen = { x: tx, z: tz }; } }
    if (ai.reactT > 0 || Math.abs(dy) > 0.12) return;
    if (ranged) {
      if (!ai.los || d > (def.id === 'bolt_rifle' ? 160 : def.type === 'bow' ? 60 : 110)) return;
      // a teammate in the line of fire: hold the shot and sidestep for a clear one
      if (team) {
        const ux = (tx - e.x) / d, uz = (tz - e.z) / d;
        for (const m of G.teams.alive(team)) {
          if (m === b) continue;
          const mx = m.x - e.x, mz = m.z - e.z, along = mx * ux + mz * uz;
          if (along > 0.5 && along < d && Math.abs(mx * uz - mz * ux) < 1.1) { ai.strafeT = 0; return; }
        }
      }
      // fire discipline: better bots wait for drift to settle; worse bots keep spraying
      const maxDrift = ({ easy: 10, normal: 5, hard: 3.5, expert: 2.5 })[ai.tier] * (d < 15 ? 2.5 : 1);
      if (def.type === 'gun' && def.auto) { if (rs.accP > maxDrift) { ai.burstHold = G.now + 0.15 + (1 - S.recoilCtrl) * 0.2; } if (G.now < (ai.burstHold || 0)) return; }
      else if (def.type === 'gun' && (rs.accP > maxDrift * 0.6 || G.now - (ai.lastShot || 0) < (60 / def.rpm) * (1.6 - S.recoilCtrl * 0.6))) return;
      if (def.type === 'bow') {
        // nock, draw and hold like a player: about 1.6-2.4 s between arrows
        if (G.now - (ai.lastShot || 0) < 0.7 + (1 - S.recoilCtrl) * 0.5) { ai.drawT = 0; return; }
        ai.drawT = (ai.drawT || 0) + dt;
        if (ai.drawT < 0.9 + Math.random() * 0.4) return;
        ai.drawT = 0;
      }
      const r = G.combat.fire(b, st, b.dir(), { aiming: d > 12, moving: Math.hypot(b.vx, b.vz) > 0.5 });
      if (r && r.recoil) { ai.lastShot = G.now; ai.shotFx = 0.06; ai.shot = 1; }
    } else if (d < (def ? def.range : 1.6) + 0.5 && b.swingT <= 0) {
      ai.swing = 1;
      if (st) G.combat.melee(b, st, { dir: b.dir() });
      else { b.swingT = 0.7; b.slowUntil = G.now + 0.7; G.combat.damageActor(t, 5, { type: 'melee', area: 'chest', attacker: b }); }
    }
  }
  // Long-range simulation of a firefight: same weapons, ammo, armour and health, resolved statistically.
  abstractFight(b, t, st, def, d, dt) {
    const G = this.game, ai = b.ai, S = ai.S;
    const ranged = def && (def.type === 'gun' || def.type === 'bow');
    const range = ranged ? (def.type === 'bow' ? 35 : 80) : 1.8;
    if (d > range) { this.nav.moveTo(b, t.x, t.z, dt, 'far', { arrive: range * 0.8 }); return; }
    if (ranged) {
      if (def.type === 'gun' && st.ammo <= 0) { if (!G.combat.canReload(b, st, def)) { this.endCombat(b); return; } st.ammo = b.inv.remove(st.at, def.mag); return; }
      const shots = Math.max(1, Math.floor(dt * def.rpm / 60 * 0.45));
      for (let i = 0; i < shots; i++) {
        if (def.type === 'gun') { if (st.ammo <= 0) break; st.ammo--; } else { if (b.inv.remove(st.at, 1) < 1) break; }
        if (st.c !== undefined) st.c = Math.max(0, st.c - 1 / def.dur);
        const drift = Recoil.controlDifficulty(def) * (1 - S.recoilCtrl) * Math.min(1, shots / 3) * (d / 40);
        const p = clamp((0.75 - S.aimErr * 25 - d / 160) / (1 + drift * 0.08), 0.05, 0.9) * (def.type === 'bow' ? 0.7 : 1);
        const A = ITEMS[st.at];
        for (let k = 0; k < (A.pellets || 1); k++) {
          if (Math.random() > p * (A.pellets > 1 ? Math.max(0.2, 1 - d / 25) : 1)) continue;
          const area = Math.random() < S.headChance * 0.5 ? 'head' : Math.random() < 0.7 ? 'chest' : 'legs';
          const mult = area === 'head' ? (def.headMult || 2) : area === 'legs' ? 0.6 : 1;
          G.combat.damageActor(t, def.dmg * (A.dmgMult || 1) * mult, { type: 'proj', area, attacker: b, weapon: def.id, bleed: A.bleed });
        }
        if (!t.alive) break;
      }
    } else {
      if (b.swingT <= 0) { b.swingT = def ? def.rate : 0.8; G.combat.damageActor(t, def ? def.dmg : 5, { type: 'melee', area: 'chest', attacker: b }); }
      b.swingT -= dt;
    }
    if (!t.alive) this.endCombat(b);
  }
  flee(b, dt, mode) {
    const ai = b.ai, t = ai.target, G = this.game;
    if (!t) { ai.goal = 'task'; return; }
    const team = G.teams.of(b);
    // run away from the attacker; head home only if home isn't past them
    const ax = b.x - t.x, az = b.z - t.z, al = Math.hypot(ax, az) || 1;
    let tx = b.x + ax / al * 40, tz = b.z + az / al * 40;
    if (team && team.base && team.base.st) {
      const st = G.build.structures.get(team.base.st);
      if (st) { const z = G.build.zoneOf(st); const hx = z.x - b.x, hz = z.z - b.z; if (hx * ax + hz * az > 0 || Math.hypot(hx, hz) < z.core + 2) { tx = z.x; tz = z.z; } }
    }
    const arrived = this.nav.moveTo(b, tx, tz, dt, mode, { arrive: 3, run: true });
    // cornered: stuck against a wall, home with the attacker still on us, or they're right here -> fight
    ai.fleeT = (ai.fleeT || 0) + dt;
    if (ai.fleeT > 1.5) { ai.fleeStuck = Math.hypot(b.x - (ai.fleeX ?? b.x + 9), b.z - (ai.fleeZ ?? b.z)) < 1.5; ai.fleeX = b.x; ai.fleeZ = b.z; ai.fleeT = 0; }
    const d = dist(b.x, b.z, t.x, t.z);
    if (d < 6 || ((ai.fleeStuck || arrived) && d < 35 && (this.underFire(b, t) || d < 15))) {
      ai.cornered = G.now + 15; ai.fleeStuck = false; ai.goal = 'fight'; ai.reactT = Math.min(ai.reactT || 0, 0.3);
      return;
    }
    // made it home without a kit and nobody's shooting: stop running and grab one from the boxes
    if (arrived && !this.kitted(b) && !this.underFire(b, t) && G.now - (b.lastHitTime || -99) > 4) { this.noteDanger(b, t); this.endCombat(b, true); return; }
    if (!this.underFire(b, t) && (d > ai.S.sight || G.now - ai.targetSeen > 8)) this.endCombat(b, true);
  }
}

function mode_far(b) { return b.ai.mode === 'far'; }
function Y_loot(team) { return styleOf(team).loot; }
function G_upkeep(game, st) { return game.build.upkeepPerHour(st); }
export { pick, recycleYield };
// A point on dry land near (x, z): pulled back toward the bot's own side of the island if it's in the sea
function clampToIsland(G, x, z) {
  const W = G.world, lim = W.half - 120;
  x = clamp(x, -lim, lim); z = clamp(z, -lim, lim);
  for (let i = 0; i < 6 && W.heightAt(x, z) < 1.5; i++) { x *= 0.8; z *= 0.8; }
  return { x, z };
}

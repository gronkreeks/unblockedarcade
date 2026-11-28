// Owns every bot: spawning, teams, level-of-detail scheduling, avatars, respawns, save/load.
import { Survivor } from '../entities/Survivor.js';
import { HumanoidAvatar } from '../entities/Avatars.js';
import { makeStack, ITEMS, weaponScore } from '../data/items.js';
import { RECIPE } from '../data/recipes.js';
import { SKILL, PERSONALITIES, rollTier, rollPersonality, botName, styleOf } from './BotProfiles.js';
import { BotNav } from './BotNav.js';
import { BotBuilder } from './BotBuilder.js';
import { BotProgression } from './BotProgression.js';
import { BotRaiding } from './BotRaiding.js';
import { BotAI } from './BotAI.js';
import { dist, randRange, pick, mulberry32 } from '../core/util.js';

export const LOD = { full: 170, mid: 550, render: 360 };

export class BotManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
    this.nav = new BotNav(game);
    this.builder = new BotBuilder(game);
    this.prog = new BotProgression(game);
    this.raiding = new BotRaiding(game);
    this.ai = new BotAI(game, this);
    this.teamT = 0;
    this.counts = { full: 0, mid: 0, far: 0 };
    game.events.on('death', e => this.onDeath(e));
    game.events.on('noise', e => this.onNoise(e));
    game.events.on('hurt', e => {
      if (!e.victim.ai || !e.attacker) return;
      if (e.attacker.kind === 'survivor') { const t = this.game.teams.of(e.victim); if (t) this.game.teams.hostility(t, e.attacker.team, 3); }
      this.ai.onHurt(e.victim, e.attacker, false);
    });
    game.events.on('nearmiss', e => this.ai.onHurt(e.victim, e.attacker, true));
  }
  progressOf(team) { return this.prog.progressOf(team || { id: '_none', members: [] }); }
  powerOf(a) { return this.ai.powerOf(a); }

  init(count, difficulty, seed) {
    const rng = mulberry32(seed ^ 0xb075);
    const bots = [];
    for (let i = 0; i < count; i++) {
      const tier = rollTier(difficulty, rng);
      bots.push(this.create({ tier, pers: rollPersonality(tier, rng), name: botName(rng) }));
    }
    const teams = this.game.teams.form(bots, rng);
    // each team starts together on a beach
    const beaches = this.game.world.spawns.beaches;
    for (const t of teams) {
      const p = beaches[Math.floor(rng() * beaches.length)];
      for (const id of t.members) { const b = this.byId.get(id); this.placeAt(b, p.x + randRange(-8, 8), p.z + randRange(-8, 8)); }
    }
  }
  create(o) {
    const b = new Survivor({ name: o.name, id: o.id });
    // each bot controls recoil a little differently from others of its tier
    const h = [...String(b.id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % 1000 / 1000;
    const S = Object.assign({}, SKILL[o.tier], { recoilCtrl: Math.max(0.05, Math.min(0.97, SKILL[o.tier].recoilCtrl + (h - 0.5) * 0.36)) });
    b.ai = { tier: o.tier, S, pers: o.pers, P: PERSONALITIES[o.pers], teamId: null, goal: 'task', task: null, thinkT: 0, mode: 'far', acc: Math.random() * 2 };
    b.spawnedAt = this.game.now;
    if (!o.noKit) this.starterKit(b);
    b.avatar = null;
    this.list.push(b); this.byId.set(b.id, b);
    this.game.actors.add(b);
    return b;
  }
  starterKit(b) { b.inv.belt.put(0, makeStack('rock')); b.inv.belt.put(1, makeStack('torch')); b.active = 0; b.hp = 60 + Math.random() * 20; b.cal = 160; b.hyd = 120; }
  placeAt(b, x, z) { b.x = x; b.z = z; b.y = this.game.world.heightAt(x, z) + 0.05; b.vx = b.vy = b.vz = 0; }
  shareBlueprint(b, id) { const t = this.game.teams.of(b); if (!t) return; for (const m of this.game.teams.membersOf(t)) m.bp.add(id); }

  onDeath(e) {
    const v = e.victim;
    if (!v.ai) return;
    v.respawnAt = this.game.now + randRange(20, 45);
    v.ai.task = null; v.ai.target = null; v.ai.goal = 'task';
    v.diedAt = this.game.now;
    // killed by someone with a gun or bow: after respawning, keep clear of them until rekitted
    if (e.killer && e.killer.kind === 'survivor' && e.killer !== v && this.prog.bestGun(e.killer)) v.ai.danger = { x: e.killer.x, z: e.killer.z, t: this.game.now };
    if (v.avatar) { if (v.avatar.root.visible) v.avatar.die(); else v.avatar.root.visible = false; }
    const k = e.killer;
    if (k && k.kind === 'survivor' && k.ai) { const t = this.game.teams.of(k); if (t) t.stats.kills++; }
    const vt = this.game.teams.of(v); if (vt) vt.stats.deaths = (vt.stats.deaths || 0) + 1;
  }
  // A clan learns where the player is (seen, heard shooting, or shot by them).
  spotPlayer(team, x, z) { if (team) team.intel = { x, z, t: this.game.now }; }
  // Push or back off, as a clan: their combined firepower near you against your gear.
  // AK against a clan of bows: they all back off. AK against three or more guns: they all come.
  assessPlayer(t) {
    const G = this.game, P = G.player;
    const clear = () => { t.push = null; t.retreat = null; };
    if (t.hunt && (G.now > t.hunt.until || !P || !P.alive)) t.hunt = null;
    if (!P || !P.alive || !t.intel || G.now - t.intel.t > 90) return clear();
    // a well-off clan that heard your shots keeps coming unless it's clearly outgunned
    if (t.hunt) {
      const fire = (a) => { const w = this.prog.bestWeapon(a); return weaponScore(w) * (1 + Math.min(1, a.armorScore()) * 0.5); };
      const crew = G.teams.alive(t).filter(m => this.huntReady(m) && dist(m.x, m.z, P.x, P.z) < 500);
      const ratio = crew.reduce((a, m) => a + fire(m), 0) / Math.max(15, fire(P));
      if (crew.length && ratio >= 0.6) { t.push = { until: G.now + 60, hunt: true }; t.retreat = null; return; }
      t.hunt = null;
    }
    const near = G.teams.alive(t).filter(m => dist(m.x, m.z, P.x, P.z) < 350);
    if (!near.length) return clear();
    // firepower: the weapon each one carries, a little more with armour (numbers count, health doesn't)
    const fire = (a) => { const w = this.prog.bestWeapon(a); return weaponScore(w) * (1 + Math.min(1, a.armorScore()) * 0.5); };
    const ours = near.reduce((a, m) => a + fire(m), 0), theirs = Math.max(15, fire(P));
    const ratio = ours / theirs, PUSH = { easy: 1.15, normal: 1.3, hard: 1.45, expert: 1.6 }[t.tier] || 1.3;
    const theirGun = this.prog.bestGun(P), playerTier = theirGun && ITEMS[theirGun.id].type === 'gun' ? (RECIPE[theirGun.id] ? RECIPE[theirGun.id].tier : 1) : 0;
    const clanHasGuns = near.some(m => { const g = this.prog.bestGun(m); return g && ITEMS[g.id].type === 'gun'; });
    const keep = t.push ? 0.75 : 1;   // once committed, a push doesn't stop at the first wobble
    if (((near.length >= 2 && ratio >= PUSH * keep) || ratio >= PUSH * 1.8) && (clanHasGuns || playerTier < 2)) {
      if (!t.push) G.logEvent(`${t.name} are coming for you (${near.length} of them)`);
      t.push = { until: G.now + 60 }; t.retreat = null;
    } else if (ratio < 0.8 || (playerTier >= 2 && !clanHasGuns)) {
      if (!t.retreat) G.logEvent(`${t.name} are keeping away from you`);
      t.retreat = { until: G.now + 60 }; t.push = null;
    } else clear();
  }
  // Fight-ready: a real gun with two magazines of rounds, decent health and something to heal with.
  huntReady(m) {
    if (!m.alive || m.hp < 55) return false;
    const g = this.prog.bestGun(m); if (!g || ITEMS[g.id].type !== 'gun') return false;
    const rounds = (g.ammo || 0) + m.inv.count(this.prog.ammoFor(g.id));
    if (rounds < ITEMS[g.id].mag * 2) return false;
    return m.inv.count('bandage') + m.inv.count('med_syringe') + m.inv.count('large_medkit') > 0;
  }
  // Not lacking anything: a base and bench, ammo stocked for its guns, most of the clan fight-ready,
  // and nothing else going on (a raid, being raided, a monument run, or backing off from you).
  wellOff(t) {
    const G = this.game, prog = this.progressOf(t), alive = G.teams.alive(t);
    if (!prog.st || prog.bench < 1 || t.raid || t.underAttack > 0) return false;
    if ((t.retreat && G.now < t.retreat.until) || (t.monumentRun && G.now < t.monumentRun.until)) return false;
    const ready = alive.filter(m => this.huntReady(m)).length;
    if (ready < Math.min(t.size, 2) || ready < Math.ceil(t.size * 0.5)) return false;
    const am = this.prog.ammoStatus(t, prog);
    for (const a in am.need) if (ITEMS[a] && ITEMS[a].cat !== 'Raid' && a !== 'rocket' && (am.have[a] || 0) < am.need[a] * 0.5) return false;   // rockets are raid stock, not kit
    return true;
  }
  // Your gunshots (and explosions) carry: well-off clans in earshot come to fight you.
  answerShots(e) {
    const G = this.game, R = Math.min(350, (e.r || 150) * 1.5);
    for (const t of G.teams.teams.values()) {
      const alive = G.teams.alive(t); if (!alive.length) continue;
      const heard = alive.some(m => dist(m.x, m.z, e.x, e.z) < R) || (t.base && dist(t.base.x, t.base.z, e.x, e.z) < R);
      if (!heard) continue;
      if (t.hunt && G.now < t.hunt.until) { t.hunt.until = G.now + 120; this.spotPlayer(t, e.x, e.z); continue; }
      if (!this.wellOff(t)) continue;
      t.hunt = { x: e.x, z: e.z, t: G.now, until: G.now + 120 };
      this.spotPlayer(t, e.x, e.z);
      G.logEvent(`${t.name} heard your shots and are coming to fight`);
    }
  }
  onNoise(e) {
    if (!e.src || e.kind === 'charge') return;
    if (e.src === this.game.player && (e.kind === 'explosion' || (e.kind === 'shot' && ITEMS[e.weapon] && ITEMS[e.weapon].type === 'gun'))) this.answerShots(e);
    this.game.actorHash.query(e.x, e.z, Math.min(e.r, 160), a => {
      if (!a.ai || a === e.src || !a.alive) return;
      if (e.src.team && e.src.team === a.team) return;
      a.ai.heard = { src: e.src, t: this.game.now, x: e.x, z: e.z };
      if (e.src === this.game.player && e.kind === 'shot') this.spotPlayer(this.game.teams.of(a), e.x, e.z);
    });
  }
  respawn(b) {
    const G = this.game;
    const bags = G.deploy.list.filter(d => d.def.spawn && d.team === b.team && G.deploy.spawnReady(d));
    this.starterKit(b);
    b.alive = true; b.hp = 60 + Math.random() * 20; b.bleed = 0; b.rads = 0; b.poison = 0; b.hot = 0;
    b.lastHitBy = null; b.ai.target = null; b.ai.task = null; b.ai.goal = 'task'; b.ai.path = null;
    b.ai.keep = null; b.ai.shotAt = null; b.ai.lookUntil = 0;
    if (bags.length) { const d = pick(bags); d.lastUsed = G.now; this.placeAt(b, d.x + randRange(-0.3, 0.3), d.z + randRange(-0.3, 0.3)); b.y = d.y + 0.1; }
    else {
      // no bag: wake up on a beach near home (or near a teammate) instead of across the island
      const t = G.teams.of(b), mate = t && G.teams.alive(t).find(m => m !== b);
      const home = t && t.base ? { x: t.base.x, z: t.base.z } : mate ? { x: mate.x, z: mate.z } : null;
      const beaches = G.world.spawns.beaches;
      const p = home ? beaches.slice().sort((a, c) => dist(a.x, a.z, home.x, home.z) - dist(c.x, c.z, home.x, home.z))[Math.floor(Math.random() * 3)] : pick(beaches);
      this.placeAt(b, p.x, p.z);
    }
    b.spawnedAt = G.now;
    if (b.avatar) b.avatar.revive();
  }

  update(dt) {
    const G = this.game, P = G.player;
    this.counts = { full: 0, mid: 0, far: 0 };
    for (const b of this.list) {
      if (!b.alive) {
        // the body stays down for a few seconds before the bag is all that's left
        if (b.avatar && b.avatar.root.visible) { if (G.now - (b.diedAt || 0) < 8) b.avatar.animate(dt, 0); else b.avatar.root.visible = false; }
        if (G.now >= b.respawnAt) this.respawn(b);
        continue;
      }
      const d = P ? dist(b.x, b.z, P.x, P.z) : 9999;
      const mode = d < LOD.full ? 'full' : d < LOD.mid ? 'mid' : 'far';
      b.ai.mode = mode;
      this.counts[mode]++;
      if (mode === 'far') {
        b.ai.acc += dt;
        if (b.ai.acc < 2) continue;
        const step = b.ai.acc; b.ai.acc = 0;
        this.tickBot(b, step, mode, true);
      } else {
        b.ai.thinkAcc = (b.ai.thinkAcc || 0) + dt;
        const every = mode === 'full' ? 0.25 : 1;
        this.tickBot(b, dt, mode, b.ai.thinkAcc >= every);
        if (b.ai.thinkAcc >= every) b.ai.thinkAcc = 0;
      }
      this.updateAvatar(b, dt, d);
      // footsteps you can hear (and place) when someone is close
      if (d < 50 && mode === 'full') this.footsteps(b, dt);
    }
    // arms race: the best weapon tier the player has had (0 bow, 1 pistols/shotguns, 2 semi/SMG, 3 AK/bolt)
    this.armsT = (this.armsT || 0) - dt;
    if (this.armsT <= 0 && P) {
      this.armsT = 5;
      let t = -1;
      for (const st of P.inv.all()) { const d = ITEMS[st.id]; if (d.type === 'gun' || d.type === 'bow') t = Math.max(t, d.type === 'bow' ? 0 : (RECIPE[st.id] ? RECIPE[st.id].tier : 1)); }
      if (t > (G.armsRace ?? -1)) { G.armsRace = t; if (t >= 1) G.logEvent(`Word spreads that someone has a ${t >= 3 ? 'military rifle' : t >= 2 ? 'semi-automatic' : 'gun'}. Every clan is racing to catch up`); }
    }
    // team-level planning
    this.teamT -= dt;
    if (this.teamT <= 0) {
      this.teamT = 5;
      for (const t of G.teams.teams.values()) {
        t._raidT = (t._raidT || 0) - 5;
        if (t._raidT <= 0) { t._raidT = t.raid ? 5 : 15; this.raiding.consider(t); }
        if (t.monumentRun && G.now > t.monumentRun.until) t.monumentRun = null;
        this.assessPlayer(t);
      }
    }
    G.teams.update(dt);
  }
  tickBot(b, dt, mode, think) {
    const G = this.game;
    G.crafting.tick(b, dt, styleOf(G.teams.of(b)).craft || 1);
    G.surv.tick(b, dt, mode !== 'far' && Math.hypot(b.vx, b.vz) > 4);
    if (!b.alive) return;
    if (mode === 'far') { b.swingT = Math.max(0, b.swingT - dt); b.fireT = 0; if (b.reloadT > 0) { b.reloadT = 0; G.combat.finishReload(b); } }
    else if (b.ai.goal !== 'fight') G.combat.tickSurvivor(b, dt);
    if (think) this.ai.think(b, mode);
    this.ai.exec(b, dt, mode);
    // a finished task is replaced straight away instead of idling until the next think
    if (b.alive && !b.ai.task && b.ai.goal === 'task') this.ai.think(b, mode);
  }
  footsteps(a, dt) {
    const sp = Math.hypot(a.vx || 0, a.vz || 0);
    if (sp < 0.6 || a.onGround === false) return;
    a._stepAcc = (a._stepAcc || 0) + sp * dt;
    const run = sp > 4;
    if (a._stepAcc < (run ? 2.1 : 1.6)) return;
    a._stepAcc = 0;
    const W = this.game.world;
    const kind = a.y - W.heightAt(a.x, a.z) > 0.25 ? 'wood' : this.game.combat.groundKind(a);
    this.game.audio.stepAt(kind, a, a.crouch, run);
  }
  updateAvatar(b, dt, d) {
    const G = this.game;
    const show = d < LOD.render && b.alive;
    if (show && !b.avatar) { b.avatar = new HumanoidAvatar(); G.scene.add(b.avatar.root); b.avatar.wearV = -1; }
    if (!b.avatar) return;
    b.avatar.root.visible = show;
    if (!show) return;
    if (b.avatar.wearV !== b.inv.wear.version) { b.avatar.applyWear(b.inv.wear); b.avatar.wearV = b.inv.wear.version; }
    const st = b.activeStack();
    b.avatar.setHeld(st ? st.id : null);
    b.avatar.root.position.set(b.x, b.y, b.z);
    b.avatar.root.rotation.y = b.yaw;
    if (b.ai.swing) { b.avatar.swing = 1; b.ai.swing = 0; }
    b.avatar.animate(dt, Math.hypot(b.vx, b.vz), { aim: b.ai.goal === 'fight', crouch: b.crouch, onGround: b.ai.mode === 'full' ? b.onGround : true, vy: b.vy, reloading: b.reloadT > 0 });
  }

  serialize() {
    return this.list.map(b => ({ ...b.serialize(), ai: { tier: b.ai.tier, pers: b.ai.pers }, respawnAt: b.respawnAt || 0, spawnedAt: b.spawnedAt }));
  }
  load(arr) {
    for (const o of arr || []) {
      const b = this.create({ id: o.id, name: o.name, tier: o.ai.tier, pers: o.ai.pers, noKit: true });
      b.load(o);
      b.respawnAt = o.respawnAt; b.spawnedAt = o.spawnedAt || 0;
      b.ai.teamId = b.team;
    }
  }
}

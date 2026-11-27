// Owns every bot: spawning, teams, level-of-detail scheduling, avatars, respawns, save/load.
import { Survivor } from '../entities/Survivor.js';
import { HumanoidAvatar } from '../entities/Avatars.js';
import { makeStack } from '../data/items.js';
import { SKILL, PERSONALITIES, rollTier, rollPersonality, botName } from './BotProfiles.js';
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
    game.events.on('hurt', e => { if (e.victim.ai && e.attacker && e.attacker.kind === 'survivor') { const t = this.game.teams.of(e.victim); if (t) this.game.teams.hostility(t, e.attacker.team, 3); } });
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
    b.ai = { tier: o.tier, S: SKILL[o.tier], pers: o.pers, P: PERSONALITIES[o.pers], teamId: null, goal: 'task', task: null, thinkT: 0, mode: 'far', acc: Math.random() * 2 };
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
    if (v.avatar) v.avatar.root.visible = false;
    const k = e.killer;
    if (k && k.kind === 'survivor' && k.ai) { const t = this.game.teams.of(k); if (t) t.stats.kills++; }
  }
  onNoise(e) {
    if (!e.src || e.kind === 'charge') return;
    this.game.actorHash.query(e.x, e.z, Math.min(e.r, 160), a => {
      if (!a.ai || a === e.src || !a.alive) return;
      if (e.src.team && e.src.team === a.team) return;
      a.ai.heard = { src: e.src, t: this.game.now, x: e.x, z: e.z };
    });
  }
  respawn(b) {
    const G = this.game;
    const bags = G.deploy.list.filter(d => d.def.spawn && d.team === b.team && G.deploy.spawnReady(d));
    this.starterKit(b);
    b.alive = true; b.hp = 60 + Math.random() * 20; b.bleed = 0; b.rads = 0; b.poison = 0; b.hot = 0;
    b.lastHitBy = null; b.ai.target = null; b.ai.task = null; b.ai.goal = 'task'; b.ai.path = null;
    if (bags.length) { const d = pick(bags); d.lastUsed = G.now; this.placeAt(b, d.x + randRange(-0.3, 0.3), d.z + randRange(-0.3, 0.3)); b.y = d.y + 0.1; }
    else { const p = pick(G.world.spawns.beaches); this.placeAt(b, p.x, p.z); }
    b.spawnedAt = G.now;
  }

  update(dt) {
    const G = this.game, P = G.player;
    this.counts = { full: 0, mid: 0, far: 0 };
    for (const b of this.list) {
      if (!b.alive) { if (G.now >= b.respawnAt) this.respawn(b); continue; }
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
    }
    // team-level planning
    this.teamT -= dt;
    if (this.teamT <= 0) {
      this.teamT = 5;
      for (const t of G.teams.teams.values()) {
        t._raidT = (t._raidT || 0) - 5;
        if (t._raidT <= 0) { t._raidT = t.raid ? 5 : 15; this.raiding.consider(t); }
        if (t.monumentRun && G.now > t.monumentRun.until) t.monumentRun = null;
      }
    }
    G.teams.update(dt);
  }
  tickBot(b, dt, mode, think) {
    const G = this.game;
    G.crafting.tick(b, dt);
    G.surv.tick(b, dt, mode !== 'far' && Math.hypot(b.vx, b.vz) > 4);
    if (!b.alive) return;
    if (mode === 'far') { b.swingT = Math.max(0, b.swingT - dt); b.fireT = 0; if (b.reloadT > 0) { b.reloadT = 0; G.combat.finishReload(b); } }
    else if (b.ai.goal !== 'fight') G.combat.tickSurvivor(b, dt);
    if (think) this.ai.think(b, mode);
    this.ai.exec(b, dt, mode);
    // a finished task is replaced straight away instead of idling until the next think
    if (b.alive && !b.ai.task && b.ai.goal === 'task') this.ai.think(b, mode);
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
    b.avatar.animate(dt, Math.hypot(b.vx, b.vz), { aim: b.ai.goal === 'fight', crouch: b.crouch });
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

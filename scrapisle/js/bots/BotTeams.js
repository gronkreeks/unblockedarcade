// Team formation, shared memory (known bases, threats), shared base + stash, raid drive.
import { TIERS, SKILL, teamName, rollStyle, styleOf } from './BotProfiles.js';
import { randInt, shuffle, uid, dist } from '../core/util.js';

const TEAM_COLORS = ['#e05a4a', '#4a8ae0', '#5ad88a', '#e0b84a', '#b05ae0', '#4ad8d8', '#e08a4a', '#8ae04a', '#e04a9a', '#9a9ae0'];

// Preferred team sizes per tier: [size, weight]
const SIZE_PREF = {
  easy: [[4, 2], [5, 3], [6, 3], [7, 2], [8, 1.5], [3, 0.6]],
  normal: [[2, 2], [3, 3], [4, 2.5], [5, 1.5], [1, 0.4]],
  hard: [[1, 1.3], [2, 3], [3, 2.5], [4, 0.4]],
  expert: [[1, 2.5], [2, 3], [3, 1.6]],
};

export class Team {
  constructor(o) {
    this.id = o.id || uid('t');
    this.name = o.name;
    this.tier = o.tier;
    this.members = o.members || [];
    this.color = o.color;
    this.base = o.base || null;      // { st, x, z, yaw, template, siteScore }
    this.known = new Map(o.known || []); // stId -> { x, z, team, value, lastSeen, size, grade }
    this.threats = new Map();        // team id -> hostility score
    this.raid = o.raid || null;
    // the breach route holds live building pieces, so it isn't saved: plan it again from the rally point
    if (this.raid && !this.raid.path && (this.raid.state === 'breach' || this.raid.state === 'enter')) { this.raid.state = 'rally'; this.raid.stateT = -999; }
    this.raidDrive = o.raidDrive || 0;
    this.lastRaid = o.lastRaid || -9999;
    this.underAttack = 0;            // time left of an active base defence
    this.attackers = new Set();
    this.stats = o.stats || { raids: 0, raidsWon: 0, defended: 0, kills: 0 };
    this.monumentRun = null;
    this.style = o.style || rollStyle(o.tier, hashRand(this.id));
    this.ms = o.ms || {};            // progression milestones: name -> game time reached
  }
  get size() { return this.members.length; }
  serialize() { return { id: this.id, name: this.name, tier: this.tier, members: this.members, color: this.color, base: this.base, known: [...this.known], raid: this.raid ? { ...this.raid, members: undefined, path: undefined, goal: undefined } : null, raidDrive: this.raidDrive, lastRaid: this.lastRaid, stats: this.stats, style: this.style, ms: this.ms }; }
}

export class BotTeams {
  constructor(game) { this.game = game; this.teams = new Map(); this.colorI = 0; }

  // Build teams from a list of bots (each with ai.tier). Mostly same-tier teams, a few mixed.
  form(bots, rng) {
    const pools = {}; for (const t of TIERS) pools[t] = shuffle(bots.filter(b => b.ai.tier === t), rng);
    const out = [];
    for (const tier of TIERS) {
      const pool = pools[tier];
      while (pool.length) {
        const size = Math.min(pool.length, pickSize(tier, rng));
        const members = pool.splice(0, size);
        // occasionally pull one member from a neighbouring tier for variety
        const ti = TIERS.indexOf(tier);
        if (size >= 2 && rng() < 0.15) {
          const other = pools[TIERS[Math.min(3, ti + (rng() < 0.5 ? 1 : -1))] || tier];
          if (other && other.length > 2) members.push(other.pop());
        }
        out.push(this.create(tier, members, rng));
      }
    }
    return out;
  }
  create(tier, members, rng = Math.random) {
    let name = teamName(rng);
    for (let k = 0; k < 30 && [...this.teams.values()].some(o => o.name === name); k++) name = teamName(rng);
    const t = new Team({ name, tier, style: rollStyle(tier, rng), members: members.map(m => m.id), color: TEAM_COLORS[this.colorI++ % TEAM_COLORS.length] });
    for (const m of members) { m.team = t.id; m.ai.teamId = t.id; }
    this.teams.set(t.id, t);
    return t;
  }
  get(id) { return this.teams.get(id); }
  of(bot) { return this.teams.get(bot.team); }
  membersOf(team) { return team.members.map(id => this.game.bots.byId.get(id)).filter(Boolean); }
  alive(team) { return this.membersOf(team).filter(b => b.alive); }
  leader(team) {
    const al = this.alive(team);
    return al.sort((a, b) => TIERS.indexOf(b.ai.tier) - TIERS.indexOf(a.ai.tier) || a.id.localeCompare(b.id))[0] || null;
  }
  // Rough team combat strength from real gear.
  strength(team) {
    let s = 0;
    for (const b of this.alive(team)) s += this.game.bots.powerOf(b);
    return s;
  }
  // Remember a structure someone saw.
  remember(team, st, value) {
    if (st.team === team.id) return;
    const z = this.game.build.zoneOf(st);
    const prev = team.known.get(st.id);
    let grade = 0, n = 0;
    for (const p of st.pieces.values()) { grade += p.grade; n++; }
    team.known.set(st.id, { x: z.x, z: z.z, team: st.team, value: Math.max(value, prev ? prev.value * 0.9 : 0), lastSeen: this.game.now, size: n, grade: n ? grade / n : 0 });
  }
  forget(stId) { for (const t of this.teams.values()) t.known.delete(stId); }
  hostility(team, otherTeam, add) { const v = (team.threats.get(otherTeam) || 0) + add; team.threats.set(otherTeam, v); return v; }

  update(dt) {
    for (const t of this.teams.values()) {
      if (t.underAttack > 0) t.underAttack -= dt;
      if (t.underAttack <= 0) t.attackers.clear();
      for (const [k, v] of t.threats) t.threats.set(k, v * Math.pow(0.995, dt));
      // raid drive: bigger teams and easier tiers want to raid more often
      const S = SKILL[t.tier];
      const sizeF = 0.4 + t.size * 0.35;
      // rushers don't waste sulfur and lives on raids until they have tier 2 gear
      const hold = t.style === 'rush' && this.game.bots.progressOf(t).bench < 2;
      if (!hold) t.raidDrive = Math.min(1.5, t.raidDrive + dt * S.raidRate * styleOf(t).raid * sizeF / 1300);
    }
  }
  serialize() { return [...this.teams.values()].map(t => t.serialize()); }
  load(arr) {
    this.teams.clear();
    for (const o of arr || []) { const t = new Team(o); this.teams.set(t.id, t); }
    this.colorI = this.teams.size;
  }
}

function hashRand(str) { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h >>> 0) % 10000) / 10000; }
function pickSize(tier, rng) {
  const prefs = SIZE_PREF[tier];
  let tot = 0; for (const p of prefs) tot += p[1];
  let r = rng() * tot;
  for (const p of prefs) { r -= p[1]; if (r <= 0) return p[0]; }
  return prefs[0][0];
}
export { dist, randInt };

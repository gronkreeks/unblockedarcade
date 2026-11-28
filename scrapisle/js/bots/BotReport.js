// Bot progress report. Every 30 s of game time each clan is checked for the usual reasons a clan
// stops progressing (storage full, a workbench it can't afford or fit, guns without ammo, upkeep
// running out, dying over and over...). Each problem is logged with its cause, and when it is
// fixed. A clan that keeps running into the same problem learns a lesson that changes what it does
// next (more storage, ammo first, fewer even fights...). Lessons are also kept between islands
// (localStorage): clans on a new island start with the average of what earlier clans learned.
//
// Read it in game (map screen: Bot report, with Copy and Download) or from the console:
//   scrapIsle.bots.report.text()
import { ITEMS } from '../data/items.js';
import { RECIPE } from '../data/recipes.js';
import { rawLoad } from './BotAI.js';
import { tpl, layoutOf } from './BotBuilder.js';
import { styleOf } from './BotProfiles.js';

const EVERY = 30;
const GLOBAL_KEY = 'clanwars.botLessons.v1';
const LOG_MAX = 400;
export const LESSONS = {
  storage: { max: 4, text: 'build more and bigger boxes and bank food and meds sooner' },
  ammo: { max: 3, text: 'make ammo first when the guns are empty' },
  bench: { max: 3, text: 'put the next workbench ahead of other spending' },
  upkeep: { max: 3, text: 'keep more upkeep in the claim cabinet' },
  fights: { max: 3, text: 'pick fewer even fights' },
  gear: { max: 3, text: 'craft guns as soon as the bench allows' },
};
const fmtT = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; };

export class BotReport {
  constructor(game, mgr) {
    this.game = game; this.mgr = mgr;
    this.log = [];
    this.issues = new Map();     // `${teamId}|${kind}` -> { kind, team, since, hits, text }
    this.deaths = [];            // [teamId, time]
    this.t = 0;
    this.global = this.loadGlobal();
  }
  loadGlobal() { try { return JSON.parse(localStorage.getItem(GLOBAL_KEY)) || {}; } catch { return {}; } }
  saveGlobal() { try { localStorage.setItem(GLOBAL_KEY, JSON.stringify(this.global)); } catch { } }
  // what a clan has learned (new clans start from the island-wide average)
  lessons(team) {
    if (!team.lessons) { team.lessons = {}; for (const k in LESSONS) { const g = (this.global[k] && this.global[k].v) || 0; team.lessons[k] = Math.min(LESSONS[k].max, Math.floor(g + 0.3)); } }
    return team.lessons;
  }
  lesson(team, key) { return team ? this.lessons(team)[key] || 0 : 0; }

  note(team, text, kind = 'info') {
    const G = this.game, last = this.log[this.log.length - 1];
    if (last && last.text === text && last.team === (team && team.name) && G.now - last.t < 60) return;
    this.log.push({ t: G.now, day: G.env ? G.env.day : 0, team: team ? team.name : '', kind, text });
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
  }
  onDeath(e) {
    const v = e.victim; if (!v || !v.ai) return;
    const t = this.game.teams.of(v); if (t) this.deaths.push([t.id, this.game.now]);
  }
  learn(team, key, why) {
    const L = this.lessons(team);
    if (L[key] >= LESSONS[key].max) return;
    L[key]++;
    this.note(team, `Learned (${key} ${L[key]}): ${LESSONS[key].text}, because ${why}`, 'learn');
  }
  // The memory carried to new islands: every 10 minutes it moves a little toward the average of what
  // this island's clans have learned (clans that never needed a lesson count as 0).
  remember() {
    const teams = [...this.game.teams.teams.values()]; if (!teams.length) return;
    for (const k in LESSONS) {
      const avg = teams.reduce((n, t) => n + this.lesson(t, k), 0) / teams.length;
      const g = this.global[k] || { v: 0, n: 0 };
      g.v = g.v * 0.9 + avg * 0.1; g.n++;
      this.global[k] = g;
    }
    this.saveGlobal();
  }

  update(dt) {
    this.t += dt;
    if (this.t < EVERY) return;
    this.t = 0;
    const G = this.game;
    const cut = G.now - 600; while (this.deaths.length && this.deaths[0][1] < cut) this.deaths.shift();
    for (const team of G.teams.teams.values()) this.check(team);
    this.memT = (this.memT || 0) + EVERY;
    if (this.memT >= 600) { this.memT = 0; this.remember(); }
  }

  // The problems a clan has right now: [{ kind, text, lesson?, learnAt? }]
  findings(team) {
    const G = this.game, M = this.mgr, prog = M.progressOf(team), base = team.base;
    const alive = G.teams.alive(team), out = [];
    const mult = G.settings.mult || 1, scale = Math.max(0.4, 1 / Math.sqrt(mult));
    const ms = team.ms || {};
    const total = (id) => prog.stash(id) + G.teams.membersOf(team).reduce((n, m) => n + m.inv.count(id), 0);
    const home = prog.st ? G.build.zoneOf(prog.st) : null;
    if (!alive.length) return out;
    // no base
    if (!prog.st && G.now > 600 * scale) out.push({ kind: 'nobase', text: `no base after ${fmtT(G.now)}${team.lastSiteErr ? ` (last site failed: ${team.lastSiteErr})` : ''}${team.siteFails ? `, ${team.siteFails} sites given up` : ''}` });
    if (prog.st && !prog.tc && ms.base !== undefined && G.now - ms.base > 120) out.push({ kind: 'notc', text: 'base has no claim cabinet' });
    // storage
    if (prog.st) {
      const full = alive.filter(m => m.inv.main.emptyCount() <= 3);
      const lowSpace = prog.boxSpace < 4 + team.size;
      if (lowSpace && full.length) {
        const cnt = {};
        for (const m of full) for (const s of m.inv.main.slots) if (s) cnt[s.id] = (cnt[s.id] || 0) + 1;
        for (const bx of prog.boxes) for (const s of bx.cont.slots) if (s) cnt[s.id] = (cnt[s.id] || 0) + 1;
        const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `${ITEMS[id].name} ${n}`).join(', ');
        const slots = prog.boxes.reduce((n, d) => n + d.cont.size, 0);
        out.push({ kind: 'storage', lesson: 'storage', learnAt: 4,
          text: `storage full: ${full.length} of ${alive.length} with full bags, ${prog.boxes.length} boxes (${slots} slots, ${prog.boxSpace} free). Most slots: ${top}. Cause: ${(base && base.storageBlock) || (prog.boxes.length ? 'more boxes are planned but not built yet' : 'no box yet')}` });
      }
      // roaming far from home with a full bag
      const roam = home ? alive.filter(m => m.inv.main.emptyCount() <= 1 && Math.hypot(m.x - home.x, m.z - home.z) > 150) : [];
      if (roam.length) out.push({ kind: 'roamfull', lesson: 'storage', learnAt: 6, text: `${roam.map(m => `${m.name} (${(m.ai.task && m.ai.task.type) || m.ai.goal})`).join(', ')} roaming ${Math.round(Math.hypot(roam[0].x - home.x, roam[0].z - home.z))} m from home with a full bag` });
      // carrying a fortune in materials while the boxes have room
      const spare = (m) => rawLoad(m, m.ai.keep && G.now < m.ai.keepUntil ? m.ai.keep : null);
      const haul = alive.filter(m => spare(m) > 3000 * Math.sqrt(mult) && prog.boxSpace >= 6);
      if (haul.length) out.push({ kind: 'hoard', quiet: 4, text: `${haul.map(m => `${m.name} (${(m.ai.task && m.ai.task.type) || m.ai.goal})`).join(', ')} carrying ${haul.map(m => spare(m)).join(', ')} load of materials without banking it, boxes have ${prog.boxSpace} free slots` });
    }
    // workbench progress
    const next = prog.bench + 1;
    if (prog.st && next <= 3) {
      const since = next === 1 ? (ms.base ?? 0) : ms['bench' + prog.bench];
      const limit = ({ 1: 25, 2: 55, 3: 80 })[next] * 60 * scale;
      if (since !== undefined && G.now - since > limit) {
        const id = 'workbench' + next, rc = RECIPE[id], miss = [];
        for (const k in rc.cost) { const have = total(k); if (have < rc.cost[k]) miss.push(`${ITEMS[k].name} ${Math.floor(have)}/${rc.cost[k]}`); }
        const want = next === 1 || (next === 2 ? prog.wantBench2 : prog.wantBench3);
        let why;
        const maker = alive.find(m => m.craftQueue.some(q => q.id === id) || m.inv.count(id) > 0);
        if (maker) why = `${maker.name} is ${maker.inv.count(id) ? 'carrying it to the base' : 'crafting it'}`;
        else if (miss.length) why = `short of ${miss.join(', ')}`;
        else if (base && base.benchCramped) why = 'it does not fit in the base yet (base is growing)';
        else if (!want) why = `the clan isn't saving for it yet (scrap ${Math.round(prog.scrap)})`;
        else { const c = M.ai.benchCrafter && M.ai.benchCrafter(team, id); why = `materials are there but it isn't built yet${c ? ` (crafter: ${c.name}, ${(c.ai.task && c.ai.task.type) || c.ai.goal})` : ''}`; }
        out.push({ kind: 'bench', lesson: miss.length || !want ? 'bench' : null, learnAt: 10, text: `workbench ${next} not reached ${fmtT(G.now - since)} after ${next === 1 ? 'the base went up' : 'workbench ' + prog.bench}: ${why}` });
      }
    }
    // guns and ammo
    const P = M.prog;
    const guns = alive.filter(m => { const g = P.ownedGun(m); return g && ITEMS[g.id].type === 'gun'; });
    const loaded = guns.filter(m => { const g = P.bestGun(m); return g && ITEMS[g.id].type === 'gun'; });
    if (prog.bench >= 1 && ms.bench1 !== undefined && G.now - ms.bench1 > 12 * 60 * scale && guns.length < Math.ceil(alive.length / 2))
      out.push({ kind: 'gear', lesson: 'gear', learnAt: 8, text: `${guns.length} of ${alive.length} members have a gun at workbench ${prog.bench}. Has: scrap ${Math.round(prog.scrap)}, pipes ${total('metal_pipe')}, springs ${total('metal_spring')}, metal ${total('metal_frag')}, gunpowder ${total('gunpowder')}` });
    if (guns.length > loaded.length)
      out.push({ kind: 'ammo', lesson: 'ammo', learnAt: 6, text: `${guns.length - loaded.length} of ${guns.length} guns have no ammo. Has: gunpowder ${total('gunpowder')}, sulfur ${total('sulfur')}, sulfur ore ${total('sulfur_ore')}, charcoal ${total('charcoal')}, metal ${total('metal_frag')}` });
    // upkeep
    if (prog.tc && prog.upkeepH < 1) out.push({ kind: 'upkeep', lesson: 'upkeep', learnAt: 3, text: `upkeep runs out in ${Math.round(prog.upkeepH * 60)} min (cabinet has wood ${prog.tc.cont.count('wood')}, stones ${prog.tc.cont.count('stones')}, metal ${prog.tc.cont.count('metal_frag')})` });
    // claim cabinet out of its corner (it's carried over once the walls are up)
    if (prog.tc && prog.st && base && !this.mgr.builder.tcInCorner(prog.st, tpl(layoutOf(base)), prog.tc)) out.push({ kind: 'tccorner', quiet: 6, text: `claim cabinet is not in a corner of the ${base.template} base${base.tcFails ? ` (${base.tcFails} failed moves)` : ''}` });
    // dying a lot
    const d10 = this.deaths.filter(d => d[0] === team.id).length;
    if (d10 >= Math.max(4, 2 * team.size)) out.push({ kind: 'deaths', lesson: 'fights', learnAt: 10, text: `${d10} deaths in the last 10 minutes (${alive.length} of ${team.size} alive)` });
    // build steps that keep failing and bots that are stuck
    const bf = alive.filter(m => (m.ai.buildFails || 0) >= 3);
    if (bf.length) out.push({ kind: 'buildfail', text: bf.map(m => `${m.name} failed to build ${m.ai.buildFails} times (${m.ai.lastBuildErr || 'no reason given'})`).join('; ') });
    const stuck = alive.filter(m => (m.ai.stuckT || 0) > 20);
    if (stuck.length) out.push({ kind: 'stuck', text: stuck.map(m => `${m.name} stuck for ${Math.round(m.ai.stuckT)} s at ${Math.round(m.x)}, ${Math.round(m.z)} (${(m.ai.task && m.ai.task.type) || m.ai.goal})`).join('; ') });
    return out;
  }
  check(team) {
    const G = this.game, seen = new Set();
    for (const f of this.findings(team)) {
      const key = team.id + '|' + f.kind; seen.add(key);
      let r = this.issues.get(key);
      if (!r) { r = { kind: f.kind, team: team.id, since: G.now, hits: 0, text: f.text, logged: false }; this.issues.set(key, r); }
      r.hits++; r.text = f.text; r.miss = 0;
      // a problem is logged once it lasts (some fix themselves within a minute)
      if (!r.logged && r.hits >= (f.quiet || 2)) { r.logged = true; this.note(team, `Problem: ${f.text}`, 'problem'); }
      else if (r.logged && r.hits % 20 === 0) this.note(team, `Still (${fmtT(G.now - r.since)}): ${f.text}`, 'problem');
      // the first lesson comes quickly, each further one needs the problem to last much longer
      if (f.lesson) { const L = this.lesson(team, f.lesson); if (r.hits === f.learnAt * (L + 1) * (L + 1)) this.learn(team, f.lesson, f.text.split(':')[0]); }
    }
    for (const [key, r] of this.issues) {
      if (r.team !== team.id || seen.has(key)) continue;
      if (++r.miss < 2) continue;   // gone for two checks in a row before it counts as fixed
      if (r.logged) this.note(team, `Fixed after ${fmtT(G.now - r.since)}: ${r.kind === 'tccorner' ? 'claim cabinet moved to a corner' : r.text.split(':')[0]}`, 'fixed');
      this.issues.delete(key);
    }
  }
  // open problems, oldest first
  open(team) { return [...this.issues.values()].filter(r => r.logged && (!team || r.team === team.id)).sort((a, b) => a.since - b.since); }

  text() {
    const G = this.game, M = this.mgr, cfg = G.cfg || {};
    const L = [];
    L.push(`Clan Wars bot report: "${cfg.name || 'island'}", day ${G.env ? G.env.day : '?'}, ${fmtT(G.now)} in, ${cfg.difficulty || 'normal'} difficulty, ${G.settings.mult}x loot, ${M.list.length} bots`);
    L.push(`Written ${new Date().toLocaleString()}`);
    const gl = Object.keys(LESSONS).map(k => `${k} ${((this.global[k] && this.global[k].v) || 0).toFixed(1)}`).join(', ');
    L.push(`Lessons carried between islands (average): ${gl}`);
    L.push('');
    L.push('Clans');
    const teams = [...G.teams.teams.values()].sort((a, b) => M.progressOf(b).bench - M.progressOf(a).bench || b.size - a.size);
    for (const t of teams) {
      const p = M.progressOf(t), alive = G.teams.alive(t);
      const guns = alive.filter(m => { const g = M.prog.bestGun(m); return g && ITEMS[g.id].type === 'gun'; }).length;
      const slots = p.boxes.reduce((n, d) => n + d.cont.size, 0);
      const ms = Object.entries(t.ms || {}).sort((a, b) => a[1] - b[1]).map(([k, v]) => `${k} ${fmtT(v)}`).join(', ');
      const ls = Object.entries(this.lessons(t)).filter(e => e[1] > 0).map(e => e.join(' ')).join(', ');
      L.push(`${t.name} (${t.tier}, ${styleOf(t).name.toLowerCase()}, ${alive.length}/${t.size} alive): ${p.st ? `${t.base.template} base, workbench ${p.bench}, ${p.boxes.length} boxes (${p.boxSpace}/${slots} free), upkeep ${p.tc ? p.upkeepH.toFixed(1) + ' h' : 'no cabinet'}` : 'no base'}, ${guns} loaded guns, raids ${t.stats.raidsWon}/${t.stats.raids}, kills ${t.stats.kills}, deaths ${t.stats.deaths || 0}`);
      if (ms) L.push(`  Reached: ${ms}`);
      if (ls) L.push(`  Lessons: ${ls}`);
      for (const r of this.open(t)) L.push(`  Open for ${fmtT(G.now - r.since)}: ${r.text}`);
    }
    L.push('');
    L.push('Log (newest first)');
    for (const e of this.log.slice().reverse()) L.push(`${fmtT(e.t).padStart(7)}  ${e.team ? e.team + ': ' : ''}${e.text}`);
    return L.join('\n');
  }
  serialize() { return { log: this.log.slice(-200), deaths: this.deaths }; }
  load(o) { if (!o) return; this.log = o.log || []; this.deaths = o.deaths || []; }
}

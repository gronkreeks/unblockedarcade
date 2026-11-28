// Admin space: set up situations to test and practise against. A raid on your base you can defend,
// clan against clan raids to watch, clans hunting you, kits, time and weather, fast-forward.
// Opens from the pause menu and asks for the team password (the same one the chat team sign-in uses).
// The server checks it (POST /team/check); the page never sees or stores the password, only that
// this tab was unlocked. A world where admin tools were used no longer posts to the leaderboard.
import { ITEMS, makeStack } from '../data/items.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const UNLOCK = 'clanwars.admin';

// Kits for you or for bots, from early game to late game.
const KITS = {
  bow: { name: 'Bow', gun: 'hunting_bow', ammo: ['wooden_arrow', 60], wear: ['cloth_hood', 'cloth_shirt', 'cloth_pants', 'hide_boots'], meds: [['bandage', 6]] },
  pistol: { name: 'Revolver', gun: 'revolver', ammo: ['pistol_ammo', 120], wear: ['bone_helmet', 'wood_chest', 'cloth_pants', 'hide_boots'], meds: [['bandage', 6], ['med_syringe', 2]] },
  rifle: { name: 'Semi rifle', gun: 'semi_rifle', ammo: ['rifle_ammo', 160], wear: ['coffee_can_helmet', 'roadsign_vest', 'roadsign_kilt', 'hide_boots', 'leather_gloves'], meds: [['med_syringe', 4], ['bandage', 4]] },
  ak: { name: 'Assault rifle', gun: 'assault_rifle', ammo: ['rifle_ammo', 240], wear: ['metal_facemask', 'metal_chest', 'roadsign_kilt', 'hide_boots', 'leather_gloves'], meds: [['med_syringe', 6], ['large_medkit', 2]] },
};
const METHODS = { satchel_charge: 'Satchel charges', timed_charge: 'C4 (timed charges)', rocket: 'Rockets', melee: 'Melee (soft side, no boom)' };

function serverBase() {
  let p = null;
  try { p = new URLSearchParams(location.search).get('server'); } catch (e) { /* no query */ }
  const ws = p && /^(wss:\/\/|ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/.test(p) ? p : 'wss://api.eduarcade.online';
  return ws.replace(/^ws/, 'http').replace(/\/+$/, '');
}

export class Admin {
  constructor(game) {
    this.game = game;
    this.busy = false;
    this.el = document.createElement('div');
    this.el.id = 'adminScreen'; this.el.className = 'screen dim'; this.el.hidden = true;
    document.body.appendChild(this.el);
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('change', e => { if (e.target.id === 'adGod') { this.used(); game.admin = game.admin || {}; game.admin.god = e.target.checked; this.msg(e.target.checked ? 'You can\'t be hurt' : 'You can be hurt again'); } });
    this.el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.id === 'adPw') this.unlock(); });
  }
  get unlocked() { try { return sessionStorage.getItem(UNLOCK) === '1'; } catch (e) { return false; } }
  open() {
    const G = this.game;
    if (!G.running) return;
    G.ui.showScreen('adminScreen');
    if (this.unlocked) this.render(); else this.renderLock();
  }
  close(resume) { this.el.hidden = true; if (resume) this.game.ui.resume(); else this.game.ui.showPause(); }

  // ---------- password ----------
  renderLock(msg = '') {
    this.el.innerHTML = `<div class="wrap">
      <h2>Admin space</h2>
      <p class="muted">Type the team password (the one the chat team sign-in uses).</p>
      <label>Password <input type="password" id="adPw" autocomplete="off" maxlength="200"></label>
      <p class="muted" id="adMsg">${esc(msg)}</p>
      <div class="row"><button class="btn go" data-a="unlock">Unlock</button><button class="btn" data-a="back">Back</button></div>
    </div>`;
    setTimeout(() => { const i = $('adPw'); if (i) i.focus(); }, 30);
  }
  async unlock() {
    const pw = $('adPw') ? $('adPw').value : '';
    if (!pw || this.busy) return;
    this.busy = true; $('adMsg').textContent = 'Checking…';
    try {
      const r = await fetch(serverBase() + '/team/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pw }) });
      const j = await r.json().catch(() => ({ ok: false, error: 'The server didn\'t answer.' }));
      if (j.ok) { try { sessionStorage.setItem(UNLOCK, '1'); } catch (e) { /* private mode: unlocked until reload */ } this.render(); }
      else this.renderLock(j.error || 'Wrong password.');
    } catch (e) { this.renderLock('Couldn\'t reach the server. Check your connection and try again.'); }
    this.busy = false;
  }

  // ---------- panel ----------
  render() {
    const G = this.game;
    const clans = [...G.teams.teams.values()].filter(t => G.teams.alive(t).length || t.size);
    const clanOpts = clans.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (${t.tier}, ${G.teams.alive(t).length} alive${t.base && t.base.st ? '' : ', no base'})</option>`).join('');
    const baseClans = clans.filter(t => t.base && t.base.st && G.build.structures.get(t.base.st));
    const baseOpts = baseClans.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    const kitOpts = Object.entries(KITS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    const methodOpts = Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    const items = Object.keys(ITEMS).filter(id => ITEMS[id].name).sort((a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name));
    const raids = clans.filter(t => t.raid).map(t => `${esc(t.name)}: ${t.raid.state} on ${esc(t.raid.targetName)}`).join('<br>') || 'None';
    const myBase = this.playerBase();
    this.el.innerHTML = `<div class="wrap admin">
      <h2>Admin space</h2>
      <p class="muted small">Scores from this world stop going to the leaderboard once you use anything here.</p>

      <h4>Raid on your base</h4>
      ${myBase ? '' : '<p class="muted small">You don\'t have a base. Build one, or claim a clan\'s base below.</p>'}
      <label>Raiding clan <select id="adRaidClan">${clanOpts}</select></label>
      <label>Raiding with <select id="adRaidMethod">${methodOpts}</select></label>
      <label>Raiders carry <select id="adRaidKit"><option value="">Their own gear</option>${kitOpts}</select></label>
      <label>Start <select id="adRaidStart"><option value="fob">At their FOB, ready to breach (about a minute away)</option><option value="home">From their base (they walk over and set up)</option><option value="prep">From scratch (they make the boom first)</option></select></label>
      <div class="row"><button class="btn go" data-a="raidme" ${myBase ? '' : 'disabled'}>Start the raid</button></div>

      <h4>Clan raids clan (to watch)</h4>
      <label>Attackers <select id="adCvCa">${clanOpts}</select></label>
      <label>Target base <select id="adCvCt">${baseOpts}</select></label>
      <div class="row"><button class="btn" data-a="raidclan">Start</button><button class="btn" data-a="watch">Take me to the target</button></div>
      <p class="muted small">Raids running: ${raids}</p>
      <div class="row"><button class="btn danger" data-a="cancelraids">Call off every raid</button></div>

      <h4>Fights</h4>
      <label>Clan <select id="adHuntClan">${clanOpts}</select></label>
      <label>Armed with <select id="adHuntKit"><option value="">Their own gear</option>${kitOpts}</select></label>
      <div class="row"><button class="btn" data-a="hunt">Send them after me</button><button class="btn" data-a="nearby">Drop them 60 m away</button></div>

      <h4>You</h4>
      <label class="check"><input type="checkbox" id="adGod" ${G.admin && G.admin.god ? 'checked' : ''}> Can't be hurt</label>
      <label>Kit <select id="adKit">${kitOpts}</select></label>
      <div class="row"><button class="btn" data-a="kit">Give me the kit</button><button class="btn" data-a="heal">Heal me</button><button class="btn" data-a="claim">Claim the nearest clan base</button></div>
      <label>Item <select id="adItem">${items.map(id => `<option value="${id}">${esc(ITEMS[id].name)}</option>`).join('')}</select></label>
      <label>How many <input type="text" id="adCount" value="1" inputmode="numeric"></label>
      <div class="row"><button class="btn" data-a="give">Give</button><button class="btn" data-a="boom">Raid kit (C4, rockets, launcher)</button></div>

      <h4>World</h4>
      <div class="row"><button class="btn small" data-a="time" data-v="0.3">Morning</button><button class="btn small" data-a="time" data-v="0.5">Noon</button><button class="btn small" data-a="time" data-v="0.76">Dusk</button><button class="btn small" data-a="time" data-v="0.95">Night</button></div>
      <div class="row"><button class="btn small" data-a="weather" data-v="clear">Clear</button><button class="btn small" data-a="weather" data-v="rain">Rain</button><button class="btn small" data-a="weather" data-v="fog">Fog</button></div>
      <div class="row"><button class="btn small" data-a="ff" data-v="5">Skip 5 min</button><button class="btn small" data-a="ff" data-v="30">Skip 30 min</button><button class="btn small" data-a="ff" data-v="120">Skip 2 hours</button></div>
      <p class="muted" id="adMsg"></p>
      <div class="row"><button class="btn go" data-a="resume">Back to the game</button><button class="btn" data-a="back">Pause menu</button><button class="btn" data-a="lock">Lock</button></div>
    </div>`;
  }
  msg(t) { const m = $('adMsg'); if (m) m.textContent = t; }
  used() { const G = this.game; if (!G.pstats.admin) { G.pstats.admin = true; G.logEvent('Admin tools were used in this world'); } }

  onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a, G = this.game;
    if (a === 'unlock') return this.unlock();
    if (a === 'back') return this.close(false);
    if (a === 'resume') return this.close(true);
    if (a === 'lock') { try { sessionStorage.removeItem(UNLOCK); } catch (err) { /* nothing to remove */ } return this.renderLock(); }
    if (!this.unlocked || this.busy) return;
    const val = id => $(id) ? $(id).value : '';
    try {
      switch (a) {
        case 'raidme': this.used(); return this.done(this.raid(G.teams.get(val('adRaidClan')), this.playerBase(), val('adRaidMethod'), val('adRaidKit'), val('adRaidStart')));
        case 'raidclan': { this.used(); const t = G.teams.get(val('adCvCt')); return this.done(this.raid(G.teams.get(val('adCvCa')), t && G.build.structures.get(t.base.st), 'satchel_charge', '', 'fob')); }
        case 'watch': { this.used(); const t = G.teams.get(val('adCvCt')); const st = t && G.build.structures.get(t.base.st); if (!st) return this.msg('That clan has no base'); const z = G.build.zoneOf(st); this.teleport(z.x + z.r + 25, z.z); return this.msg(`You're next to ${t.name}'s base`); }
        case 'cancelraids': { let n = 0; for (const t of G.teams.teams.values()) if (t.raid) { t.raid = null; t.lastRaid = G.now; n++; } return this.msg(n ? `Called off ${n} raid${n > 1 ? 's' : ''}` : 'No raids running'); }
        case 'hunt': this.used(); return this.msg(this.hunt(G.teams.get(val('adHuntClan')), val('adHuntKit'), false));
        case 'nearby': this.used(); return this.msg(this.hunt(G.teams.get(val('adHuntClan')), val('adHuntKit'), true));
        case 'kit': this.used(); this.kitUp(G.player, val('adKit')); return this.msg(`Gave you the ${KITS[val('adKit')].name} kit`);
        case 'heal': { this.used(); const P = G.player; P.hp = 100; P.bleed = 0; P.rads = 0; P.poison = 0; P.cal = Math.max(P.cal, 400); P.hyd = Math.max(P.hyd, 200); return this.msg('Healed'); }
        case 'claim': this.used(); return this.msg(this.claimBase());
        case 'give': { this.used(); const id = val('adItem'), n = Math.max(1, Math.min(10000, parseInt(val('adCount'), 10) || 1)); const left = G.player.inv.give(id, n); return this.msg(left ? `Gave ${n - left} ${ITEMS[id].name} (no room for ${left})` : `Gave ${n} ${ITEMS[id].name}`); }
        case 'boom': { this.used(); const P = G.player; P.inv.give('timed_charge', 6); P.inv.give('satchel_charge', 10); P.inv.give('rocket_launcher', 1); P.inv.give('rocket', 12); return this.msg('Gave 6 C4, 10 satchels, a launcher and 12 rockets'); }
        case 'time': this.used(); G.env.tod = +b.dataset.v; return this.msg('Time changed');
        case 'weather': this.used(); G.env.weather = b.dataset.v; G.env.weatherT = 600; return this.msg(`Weather: ${b.dataset.v} (it eases in over a minute)`);
        case 'ff': this.used(); return this.fastForward(+b.dataset.v);
      }
    } catch (err) { console.error(err); this.msg('That didn\'t work: ' + err.message); }
  }
  done(r) { if (typeof r === 'string') return this.msg(r); this.msg(r.msg); if (r.resume) setTimeout(() => this.close(true), 600); }

  // ---------- helpers ----------
  playerBase() {
    const G = this.game, P = G.player; let best = null, bn = 0;
    for (const st of G.build.structures.values()) if (st.team === P.team && st.pieces.size > bn) { bn = st.pieces.size; best = st; }
    return best;
  }
  teleport(x, z) { const G = this.game, P = G.player; P.x = x; P.z = z; P.y = G.world.heightAt(x, z) + 0.3; P.vx = P.vy = P.vz = 0; }
  // Arm someone with a kit: gun (loaded) on the belt, ammo, armour worn, meds.
  kitUp(a, kind) {
    const K = KITS[kind]; if (!K) return;
    const gun = makeStack(K.gun); if (ITEMS[K.gun].mag) gun.ammo = ITEMS[K.gun].mag;
    const free = a.inv.belt.slots.findIndex(s => !s);
    if (free >= 0) { a.inv.belt.slots[free] = gun; a.inv.belt.touch(); if (!a.isPlayer) a.active = free; } else a.inv.giveStack(gun);
    a.inv.give(K.ammo[0], K.ammo[1]);
    for (const w of K.wear) { const left = a.inv.equip(makeStack(w)); if (left) a.inv.giveStack(left); }
    for (const [m, n] of K.meds) a.inv.give(m, n);
    a.hp = Math.max(a.hp, 100);
  }
  // Bring a clan's dead back and return the living members.
  crew(team) {
    const G = this.game;
    for (const m of G.teams.membersOf(team)) if (!m.alive) G.bots.respawn(m);
    return G.teams.alive(team);
  }
  // A raid by `team` on structure `st`. method: satchel_charge / timed_charge / rocket / melee.
  // start: 'fob' (crew already at the FOB with the boom), 'home' (crew at home with the boom),
  // 'prep' (the clan has to make the boom first, like a normal raid).
  raid(team, st, method, kit, start) {
    const G = this.game, R = G.bots.raiding;
    if (!team) return 'Pick a clan';
    if (!st) return 'There\'s no base to raid';
    if (st.team === team.id) return 'A clan can\'t raid its own base';
    const crew = this.crew(team);
    if (!crew.length) return `${team.name} have nobody alive`;
    for (const t of G.teams.teams.values()) if (t.raid && t.raid.target === st.id) t.raid = null;   // one raid at a time on a base
    const z = G.build.zoneOf(st);
    const homeSt = team.base && team.base.st && G.build.structures.get(team.base.st);
    const home = homeSt ? G.build.zoneOf(homeSt) : { x: crew[0].x, z: crew[0].z };
    const fob = R.chooseFob(st, home);
    const plan = R.planBreach(team, st, fob);
    if (!plan && method !== 'melee') return 'They can\'t find a way into that base';
    const raw = method === 'timed_charge' ? plan.c4 : method === 'rocket' ? plan.rockets : method === 'satchel_charge' ? plan.sat : 0;
    const need = method === 'melee' ? 0 : Math.max(2, R.needFor(method, raw));
    // boom, launchers and the FOB kit, spread over the crew
    if (start !== 'prep' && method !== 'melee') {
      crew.forEach((m, i) => { const k = Math.ceil(need / crew.length); m.inv.give(method, k); });
      if (method === 'rocket') crew.slice(0, Math.min(2, crew.length)).forEach(m => { if (!m.inv.count('rocket_launcher')) m.inv.give('rocket_launcher', 1); });
    }
    crew.forEach(m => { if (!m.inv.count('sleeping_bag')) m.inv.give('sleeping_bag', 1); });
    if (!crew[0].inv.count('wood_box')) crew[0].inv.give('wood_box', 1);
    if (method === 'melee') crew.forEach(m => { if (!m.inv.count('salvaged_axe') && !m.inv.count('pickaxe')) m.inv.give('pickaxe', 1); });
    if (kit) crew.forEach(m => this.kitUp(m, kit));
    if (start === 'fob') crew.forEach((m, i) => { const a = i * 2.4; G.bots.placeAt(m, fob.x + Math.sin(a) * 4, fob.z + Math.cos(a) * 4); m.ai.task = null; m.ai.target = null; m.ai.goal = 'task'; });
    const tgtName = st.team === G.player.team ? 'you' : (G.teams.get(st.team) || {}).name || 'a lone survivor';
    team.raid = { state: start === 'prep' ? 'prep' : 'rally', target: st.id, targetTeam: st.team, method: method === 'melee' ? 'melee' : method, need,
      rally: fob, fob, started: G.now, stateT: G.now, looted: 0, lootedValue: 0, targetName: tgtName, tx: z.x, tz: z.z, admin: true };
    team.raidDrive = 0;
    G.logEvent(`${team.name} are coming to raid ${tgtName === 'you' ? 'you' : tgtName} (${METHODS[method]})`);
    const where = start === 'fob' ? 'They\'re at their FOB' : start === 'home' ? 'They\'re setting out from home' : 'They\'re making the boom first';
    return { msg: `${team.name} will raid ${tgtName === 'you' ? 'your base' : tgtName + '\'s base'} with ${need || 'no'} ${method === 'melee' ? 'boom (melee)' : ITEMS[method].name.toLowerCase() + 's'}. ${where}.`, resume: tgtName === 'you' };
  }
  // A clan comes to fight you: a hunt (they know where you are and push), optionally dropped close.
  hunt(team, kit, close) {
    const G = this.game, P = G.player;
    if (!team) return 'Pick a clan';
    const crew = this.crew(team);
    if (!crew.length) return `${team.name} have nobody alive`;
    if (kit) crew.forEach(m => this.kitUp(m, kit));
    if (close) {
      const a0 = Math.random() * Math.PI * 2;
      crew.forEach((m, i) => { const a = a0 + (i - crew.length / 2) * 0.12; G.bots.placeAt(m, P.x + Math.sin(a) * 60, P.z + Math.cos(a) * 60); m.ai.task = null; });
    }
    team.intel = { x: P.x, z: P.z, t: G.now };
    team.hunt = { x: P.x, z: P.z, t: G.now, until: G.now + 300 };
    team.push = { until: G.now + 120, hunt: true }; team.retreat = null;
    for (const m of crew) { m.ai.ignore = null; m.ai.redecide = true; }
    G.logEvent(`${team.name} are coming for you (${crew.length} of them)`);
    return `${team.name} are coming for you${close ? ' from 60 m away' : ''}`;
  }
  // Take over the clan base nearest to you (handy for practising raid defence without building).
  claimBase() {
    const G = this.game, P = G.player;
    let best = null, bd = Infinity;
    for (const t of G.teams.teams.values()) {
      const st = t.base && t.base.st && G.build.structures.get(t.base.st); if (!st) continue;
      const z = G.build.zoneOf(st), d = Math.hypot(z.x - P.x, z.z - P.z);
      if (d < bd) { bd = d; best = { t, st }; }
    }
    if (!best) return 'No clan has a base yet';
    const { t, st } = best;
    st.team = P.team;
    for (const d of G.deploy.list) if (d.st === st.id) { d.team = P.team; if (d.owner && G.bots.byId.has(d.owner)) d.owner = P.id; }
    const tc = G.build.tcOf(st); if (tc && tc.auth) { tc.auth.clear(); tc.auth.add(P.team); }
    for (const p of st.pieces.values()) if (p.door && p.door.lock) p.door.lock.auth = [P.team];
    t.base = null; t.raid = null; G.teams.forget && G.teams.forget(st.id);
    G.bots._zones = null;
    // stand inside on a floor
    for (const p of st.pieces.values()) if (p.key && p.key.startsWith('c:')) { P.x = p.wx; P.z = p.wz; P.y = p.wy + 0.4; P.vx = P.vy = P.vz = 0; break; }
    G.logEvent(`You took over ${t.name}'s base`);
    return `It's yours: ${t.name}'s base (${st.pieces.size} pieces). They'll need a new one.`;
  }
  // Run the world forward (bots, crafting, raids, day and night) while the panel shows progress.
  async fastForward(min) {
    const G = this.game; this.busy = true;
    const end = G.now + min * 60, P = G.player, px = P.x, pz = P.z;
    while (G.now < end) {
      const t0 = performance.now();
      while (performance.now() - t0 < 120 && G.now < end) { G.sim.update(0.05); if (P.alive) { P.x = px; P.z = pz; P.vx = P.vz = 0; } }
      this.msg(`Skipping ahead… ${Math.round((1 - (end - G.now) / (min * 60)) * 100)}%`);
      await new Promise(r => setTimeout(r, 0));
    }
    this.busy = false; this.msg(`Skipped ${min} minutes`);
  }
}

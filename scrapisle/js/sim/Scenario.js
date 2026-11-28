// Admin raid scenarios (opened from the admin space): a fresh small island with one base and a clan
// coming to raid it. You either hold the base yourself or fly around and watch it play out (a bot
// clan holds it then). Scenario worlds aren't saved and don't post to the leaderboard.
// Also here: the kits, and starting a raid on any base (the in-game admin panel uses it too).
import { ITEMS, makeStack } from '../data/items.js';
import { tpl } from '../bots/BotBuilder.js';
import { pieceMaxHp, FOUND_H } from '../data/building.js';
import { botName } from '../bots/BotProfiles.js';

// Kits for you or for bots, from early game to late game.
export const KITS = {
  bow: { name: 'Bow', gun: 'hunting_bow', ammo: ['wooden_arrow', 60], wear: ['cloth_hood', 'cloth_shirt', 'cloth_pants', 'hide_boots'], meds: [['bandage', 6]] },
  pistol: { name: 'Revolver', gun: 'revolver', ammo: ['pistol_ammo', 120], wear: ['bone_helmet', 'wood_chest', 'cloth_pants', 'hide_boots'], meds: [['bandage', 6], ['med_syringe', 2], ['barricade', 1]] },
  rifle: { name: 'Semi rifle', gun: 'semi_rifle', ammo: ['rifle_ammo', 160], wear: ['coffee_can_helmet', 'roadsign_vest', 'roadsign_kilt', 'hide_boots', 'leather_gloves'], meds: [['med_syringe', 4], ['bandage', 4], ['barricade', 2]] },
  ak: { name: 'Assault rifle', gun: 'assault_rifle', ammo: ['rifle_ammo', 240], wear: ['metal_facemask', 'metal_chest', 'roadsign_kilt', 'hide_boots', 'leather_gloves'], meds: [['med_syringe', 6], ['large_medkit', 2], ['barricade', 3]] },
};
export const METHODS = { satchel_charge: 'Satchel charges', timed_charge: 'C4 (timed charges)', rocket: 'Rockets', melee: 'Melee (soft side, no boom)' };

// Arm someone with a kit: gun (loaded) on the belt, ammo, armour worn, meds.
export function kitUp(a, kind) {
  const K = KITS[kind]; if (!K) return;
  const gun = makeStack(K.gun); if (ITEMS[K.gun].mag) gun.ammo = ITEMS[K.gun].mag;
  const free = a.inv.belt.slots.findIndex(s => !s);
  if (free >= 0) { a.inv.belt.slots[free] = gun; a.inv.belt.touch(); if (!a.isPlayer) a.active = free; } else a.inv.giveStack(gun);
  a.inv.give(K.ammo[0], K.ammo[1]);
  for (const w of K.wear) { const left = a.inv.equip(makeStack(w)); if (left) a.inv.giveStack(left); }
  for (const [m, n] of K.meds) a.inv.give(m, n);
  a.hp = Math.max(a.hp, 100);
}

// A raid by `team` on structure `st`. method: satchel_charge / timed_charge / rocket / melee.
// start: 'fob' (crew already where their FOB tower goes, with the boom), 'home' (crew at home with
// the boom: they walk over), 'prep' (the clan has to make the boom first, like a normal raid).
export function startRaid(G, team, st, method, kit, start) {
  const R = G.bots.raiding;
  if (!team) return { msg: 'Pick a clan' };
  if (!st) return { msg: 'There\'s no base to raid' };
  if (st.team === team.id) return { msg: 'A clan can\'t raid its own base' };
  for (const m of G.teams.membersOf(team)) if (!m.alive) G.bots.respawn(m);
  const crew = G.teams.alive(team);
  if (!crew.length) return { msg: `${team.name} have nobody alive` };
  for (const t of G.teams.teams.values()) if (t.raid && t.raid.target === st.id) t.raid = null;   // one raid at a time on a base
  const z = G.build.zoneOf(st);
  const homeSt = team.base && team.base.st && G.build.structures.get(team.base.st);
  const cx = crew.reduce((a, m) => a + m.x, 0) / crew.length, cz = crew.reduce((a, m) => a + m.z, 0) / crew.length;
  const home = homeSt ? G.build.zoneOf(homeSt) : { x: cx, z: cz };
  const { fob, tower } = R.planFob(team, st, home);
  const plan = R.planBreach(team, st, fob);
  if (!plan && method !== 'melee') return { msg: 'They can\'t find a way into that base' };
  const raw = method === 'timed_charge' ? plan.c4 : method === 'rocket' ? plan.rockets : method === 'satchel_charge' ? plan.sat : 0;
  const need = method === 'melee' ? 0 : Math.max(2, R.needFor(method, raw));
  if (start !== 'prep' && method !== 'melee') {
    crew.forEach(m => m.inv.give(method, Math.ceil(need / crew.length)));
    if (method === 'rocket') crew.slice(0, Math.min(2, crew.length)).forEach(m => { if (!m.inv.count('rocket_launcher')) m.inv.give('rocket_launcher', 1); });
  }
  crew.forEach(m => { if (!m.inv.count('sleeping_bag')) m.inv.give('sleeping_bag', 1); });
  if (!crew[0].inv.count('large_box')) crew[0].inv.give('large_box', 1);
  if (method === 'melee') crew.forEach(m => { if (!m.inv.count('salvaged_axe') && !m.inv.count('pickaxe')) m.inv.give('pickaxe', 1); });
  if (kit) crew.forEach(m => kitUp(m, kit));
  if (start === 'fob') {
    const at = tower ? tower.build : fob;
    crew.forEach((m, i) => { const a = i * 2.4; G.bots.placeAt(m, at.x + Math.sin(a) * 3, at.z + Math.cos(a) * 3); m.ai.task = null; m.ai.target = null; m.ai.goal = 'task'; });
  }
  const tgtName = st.team === (G.player && G.player.team) ? 'you' : (G.teams.get(st.team) || {}).name || 'a lone survivor';
  team.raid = { state: start === 'prep' ? 'prep' : 'rally', target: st.id, targetTeam: st.team, method, need, tower,
    rally: fob, fob, started: G.now, stateT: G.now, looted: 0, lootedValue: 0, targetName: tgtName, tx: z.x, tz: z.z, admin: true };
  team.raidDrive = 0;
  G.logEvent(`${team.name} are coming to raid ${tgtName === 'you' ? 'you' : tgtName} (${METHODS[method]})`);
  const where = start === 'fob' ? 'They\'re putting up their raid tower outside' : start === 'home' ? 'They\'re setting out from home' : 'They\'re making the boom first';
  return { ok: true, msg: `${team.name} will raid ${tgtName === 'you' ? 'your base' : tgtName + '\'s base'} with ${need || 'no'} ${method === 'melee' ? 'boom (melee)' : ITEMS[method].name.toLowerCase() + 's'}. ${where}.`, mine: tgtName === 'you' };
}

// ---------- PvP scenario ----------
// sc: { kind: 'pvp', role: 'fight'|'watch', place: 'field'|'woods'|'monument', distance,
//       enemies, tier, kit, playerKit, aSize, aTier, aKit (watch: clan A), night }
// Rounds: when one side is all down, the winner is announced and everyone is put back at their
// starting spots with fresh kits a few seconds later.
export function buildPvp(G, sc) {
  G.pstats.admin = true;
  const W = G.world, P = G.player;
  // where: open grass, a forest, or the middle of the biggest monument
  let C = null;
  if (sc.place === 'monument') { const m = W.monuments.slice().sort((a, b) => b.r - a.r)[0]; if (m) C = { x: m.x, z: m.z }; }
  const want = sc.place === 'woods' ? 3 : 2;   // biome: 2 grass, 3 forest
  for (let k = 0; k < 600 && !C; k++) {
    const x = (Math.random() - 0.5) * W.size * 0.7, z = (Math.random() - 0.5) * W.size * 0.7;
    if (W.heightAt(x, z) < 3 || W.slopeAt(x, z) > 0.25 || W.monumentAt(x, z, 40)) continue;
    if (k < 450 && W.biomeAt(x, z) !== want) continue;
    C = { x, z };
  }
  C = C || { x: 0, z: 0 };
  const d = sc.distance || 100, a0 = Math.random() * Math.PI * 2;
  const side = (s) => { const x = C.x + Math.sin(a0) * d / 2 * s, z = C.z + Math.cos(a0) * d / 2 * s; return { x, z }; };
  const A = side(-1), B = side(1);
  const clan = (n, tier, at) => {
    const members = [];
    for (let i = 0; i < Math.max(1, n); i++) members.push(G.bots.create({ tier, pers: 'fighter', name: botName(), noKit: true }));
    const t = G.teams.create(tier, members);
    t.pvp = true;
    return t;
  };
  const pvp = { C, A, B, a0, d, round: 1, score: { A: 0, B: 0 }, resetT: 0, sc };
  if (sc.role === 'watch') {
    pvp.teamA = clan(sc.aSize || 4, sc.aTier || 'hard', A).id;
    pvp.teamB = clan(sc.enemies || 4, sc.tier || 'hard', B).id;
  } else pvp.teamB = clan(sc.enemies || 3, sc.tier || 'hard', B).id;
  G.pvp = pvp;
  G.env.tod = sc.night ? 0.93 : 0.4; G.env.weather = 'clear'; G.env.weatherT = 3600;
  G.admin = { god: sc.role === 'watch' };
  if (sc.role === 'watch') { G.spectate = true; P.x = C.x + Math.cos(a0) * 45; P.z = C.z - Math.sin(a0) * 45; P.y = W.heightAt(P.x, P.z) + 18; P.yaw = Math.atan2(C.x - P.x, C.z - P.z); P.pitch = -0.4; }
  startRound(G);
  const B_ = G.teams.get(pvp.teamB);
  return sc.role === 'watch'
    ? `PvP scenario: ${G.teams.get(pvp.teamA).name} against ${B_.name}, ${d} m apart. First side wiped loses the round.`
    : `PvP scenario: you against ${B_.name} (${B_.size}, ${sc.tier || 'hard'}), ${d} m apart. Wipe them to win the round.`;
}
// Everyone back at their spot with a fresh kit.
function startRound(G) {
  const pv = G.pvp, P = G.player, sc = pv.sc;
  const place = (team, at, kit) => {
    G.teams.membersOf(team).forEach((m, i) => {
      if (!m.alive) { m.alive = true; m.bleed = 0; m.rads = 0; m.poison = 0; if (m.avatar) m.avatar.revive(); }
      for (const c of [m.inv.belt, m.inv.main, m.inv.wear]) { c.slots.fill(null); c.touch(); }
      kitUp(m, kit); m.hp = 100; m.cal = 400; m.hyd = 250;
      const o = (i - (team.members.length - 1) / 2) * 3;
      G.bots.placeAt(m, at.x + Math.cos(pv.a0) * o, at.z - Math.sin(pv.a0) * o);
      m.ai.task = null; m.ai.target = null; m.ai.goal = 'task'; m.ai.ignore = null; m.ai.danger = null; m.respawnAt = Infinity;
    });
  };
  if (pv.teamA) place(G.teams.get(pv.teamA), pv.A, sc.aKit || sc.kit || 'rifle');
  place(G.teams.get(pv.teamB), pv.B, sc.kit || 'rifle');
  if (sc.role !== 'watch') {
    if (!P.alive) { G.respawnPlayer(null); G.ui.hideScreens(); clearInterval(G.ui.deathTimer); }
    for (const c of [P.inv.belt, P.inv.main, P.inv.wear]) { c.slots.fill(null); c.touch(); }
    kitUp(P, sc.playerKit || 'ak'); P.hp = 100; P.bleed = 0; P.cal = Math.max(P.cal, 300); P.hyd = Math.max(P.hyd, 200);
    P.x = pv.A.x; P.z = pv.A.z; P.y = G.world.heightAt(P.x, P.z) + 0.2; P.vx = P.vy = P.vz = 0; P.yaw = Math.atan2(pv.B.x - P.x, pv.B.z - P.z);
  }
  pv.resetT = 0;
  G.ui.toast(`Round ${pv.round}`);
}
// Runs every frame in a scenario world (main loop).
export function tickScenario(G, dt) {
  const pv = G.pvp;
  if (!pv) return;
  const P = G.player, sc = pv.sc;
  const B = G.teams.get(pv.teamB), A = pv.teamA ? G.teams.get(pv.teamA) : null;
  // the dead wait for the next round instead of respawning on a beach
  for (const t of [A, B]) if (t) for (const m of G.teams.membersOf(t)) if (!m.alive) m.respawnAt = Infinity;
  const aliveA = A ? G.teams.alive(A).length : (P.alive ? 1 : 0), aliveB = G.teams.alive(B).length;
  if (pv.resetT > 0) { pv.resetT -= dt; if (pv.resetT <= 0) { pv.round++; startRound(G); } return; }
  if (!aliveA || !aliveB) {
    const winA = aliveA > 0;
    pv.score[winA ? 'A' : 'B']++;
    const nameA = A ? A.name : 'You', nameB = B.name;
    G.ui.toast(`${winA ? nameA + (A ? ' win' : ' win') : nameB + ' win'} round ${pv.round}. ${nameA} ${pv.score.A} : ${pv.score.B} ${nameB}`);
    G.logEvent(`Round ${pv.round}: ${winA ? nameA : nameB} won (${pv.score.A}-${pv.score.B})`);
    pv.resetT = 6;
    return;
  }
  // keep both sides coming at each other (they'd otherwise go about their day)
  pv.pushT = (pv.pushT || 0) - dt;
  if (pv.pushT > 0) return;
  pv.pushT = 1.5;
  const push = (team, foes) => {
    const live = foes.filter(f => f && f.alive);
    if (!live.length) return;
    for (const m of G.teams.alive(team)) {
      if (m.ai.target && m.ai.target.alive) continue;
      const f = live.sort((a, c) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(c.x - m.x, c.z - m.z))[0];
      team.alert = { id: f.id, x: f.x, z: f.z, t: G.now };
      m.ai.ignore = null;
      if (Math.hypot(f.x - m.x, f.z - m.z) < 60) { G.bots.ai.startCombat(m, f); m.ai.goal = 'fight'; }
      else m.ai.task = { type: 'goto', x: f.x + (Math.random() - 0.5) * 20, z: f.z + (Math.random() - 0.5) * 20, arrive: 25, until: G.now + 4 };
    }
  };
  push(B, A ? G.teams.membersOf(A) : [P]);
  if (A) push(A, G.teams.membersOf(B));
}

// ---------- scenario worlds ----------
// sc: { role: 'defend'|'watch', base: 'small'|'medium'|'large', grade: 1-4, door, raiders, tier,
//       method, kit, start: 'fob'|'home', defenders, defKit, playerKit, night }
export function buildScenario(G, sc) {
  G.pstats.admin = true;
  const W = G.world, P = G.player, T = tpl(sc.base || 'medium');
  P.x = W.half * 0.8; P.z = W.half * 0.8; P.y = W.heightAt(P.x, P.z) + 2;   // out of the way while building
  // a flat spot near the middle of the island, away from monuments
  let site = null;
  for (let r = 0; r < 400 && !site; r += 12) for (let k = 0; k < 10 && !site; k++) {
    const a = k / 10 * Math.PI * 2 + r * 0.1, x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (W.heightAt(x, z) < 3 || W.monuments.some(m => Math.hypot(m.x - x, m.z - z) < m.r + 90)) continue;
    site = G.bots.builder.fitSite({ id: 'scenario' }, x, z, Math.round(Math.random() * 3) * Math.PI / 2, T);
  }
  if (!site) return 'Couldn\'t find flat ground for the base on this island';
  // who owns it: you, or a bot clan holding it while you watch
  let owner = P, defTeam = null;
  if (sc.role === 'watch') {
    const members = [];
    for (let i = 0; i < Math.max(1, sc.defenders || 0); i++) members.push(G.bots.create({ tier: sc.defTier || 'hard', pers: 'fighter', name: botName() }));
    defTeam = G.teams.create(sc.defTier || 'hard', members);
    owner = members[0];
    for (const m of members) G.bots.placeAt(m, P.x, P.z);
  }
  const st = buildBase(G, owner, site, T, sc.grade || 2, sc.door || 'metal_door');
  if (!st) return 'The base couldn\'t be built there';
  const zone = G.build.zoneOf(st);
  if (defTeam) {
    defTeam.base = { st: st.id, x: zone.x, z: zone.z, yaw: site.yaw, template: T.name, final: T.name, site };
    defTeam.homeGuard = true;   // they stay in and hold it
    G.teams.membersOf(defTeam).forEach((m, i) => { G.bots.placeAt(m, zone.x + (i % 3 - 1) * 1.2, zone.z + Math.floor(i / 3) - 0.5); m.y = site.oy + FOUND_H + 0.05; if (sc.defKit) kitUp(m, sc.defKit); });
  }
  // the raiders: a clan of their own, starting 300 m out
  const members = [];
  for (let i = 0; i < Math.max(1, sc.raiders || 4); i++) members.push(G.bots.create({ tier: sc.tier || 'hard', pers: 'fighter', name: botName() }));
  const raiders = G.teams.create(sc.tier || 'hard', members);
  let home = null;
  for (let k = 0; k < 40 && !home; k++) { const a = Math.random() * Math.PI * 2, x = zone.x + Math.sin(a) * 300, z = zone.z + Math.cos(a) * 300; if (W.inBounds(x, z, 60) && W.heightAt(x, z) > 2) home = { x, z }; }
  home = home || { x: zone.x + 200, z: zone.z };
  for (const m of members) G.bots.placeAt(m, home.x + (Math.random() - 0.5) * 6, home.z + (Math.random() - 0.5) * 6);
  const r = startRaid(G, raiders, st, sc.method || 'satchel_charge', sc.kit || 'rifle', sc.start || 'fob');
  // a scenario raid brings a full load (half again on top of the plan) so it plays out to the end
  if (r.ok && raiders.raid.method !== 'melee') { const extra = Math.ceil(raiders.raid.need * 0.5); members.forEach((m, i) => { if (i < extra) m.inv.give(raiders.raid.method, 1); }); }
  // time of day
  G.env.tod = sc.night ? 0.93 : 0.38; G.env.weather = 'clear'; G.env.weatherT = 3600;
  // you
  G.admin = { god: sc.role === 'watch' };
  if (sc.role === 'watch') {
    G.spectate = true;
    const a = Math.atan2(zone.x - (r.ok && raiders.raid.fob ? raiders.raid.fob.x : home.x), zone.z - (r.ok && raiders.raid.fob ? raiders.raid.fob.z : home.z));
    P.x = zone.x - Math.sin(a) * 45 + Math.cos(a) * 25; P.z = zone.z - Math.cos(a) * 45 - Math.sin(a) * 25; P.y = W.heightAt(P.x, P.z) + 22;
    P.yaw = Math.atan2(zone.x - P.x, zone.z - P.z); P.pitch = -0.35;
  } else {
    const c = T.cells[Math.floor(T.cells.length / 2)];
    const wp = G.build.toWorld(st, (c[0] + 0.5) * 3, FOUND_H, (c[1] + 0.5) * 3);
    P.x = wp.x; P.z = wp.z; P.y = wp.y + 0.2; P.vx = P.vy = P.vz = 0;
    kitUp(P, sc.playerKit || 'ak');
  }
  G.scenarioInfo = { st: st.id, raiders: raiders.id, defenders: defTeam ? defTeam.id : null, role: sc.role };
  return `Raid scenario: ${raiders.name} (${members.length}, ${sc.tier || 'hard'}) are raiding ${sc.role === 'watch' ? defTeam.name + '\'s' : 'your'} base. ${r.msg || ''}`;
}

// A finished base from a bot template: foundations, walls and doorways, ceiling, all at one grade,
// doors with code locks, a claim cabinet in a corner, workbench, furnace, boxes with loot and a few
// sleeping bags. Built for `owner` (you or a bot), free.
function buildBase(G, owner, site, T, grade, door) {
  const B = G.build;
  let st = null;
  const put = (spec) => { const res = B.place(owner, { ...spec, st: st ? st.id : undefined, newSt: st ? undefined : site }, { free: true }); if (res.ok && !st) st = res.st; return res.ok ? res.piece : null; };
  for (const [i, j] of T.cells) put({ type: 'foundation', i, j, k: 0 });
  if (!st) return null;
  st.team = owner.team;
  for (const w of T.walls) put({ type: w.type, i: w.i, j: w.j, k: 0, axis: w.axis });
  for (const f of T.floors) put({ type: 'floor', i: f.i, j: f.j, k: 1 });
  for (const p of st.pieces.values()) { p.grade = grade; p.maxHp = pieceMaxHp(p.type, grade); p.hp = p.maxHp; B._buildPieceVisual(st, p); }
  st.version++;
  for (const p of st.pieces.values()) if (p.type === 'doorway') {
    B.placeDoor(owner, p, door, { free: true });
    owner.inv.give('code_lock', 1); B.placeLock(owner, p, 'code_lock');
  }
  // inside: items against the walls (slots are on the wall line; step them in a little)
  const inward = { back: [0, -0.6], front: [0, 0.6], left: [0.6, 0], right: [-0.6, 0] };
  const at = (slot) => { const [dx, dz] = inward[slot.wall]; return B.toWorld(st, slot.x + dx, FOUND_H, slot.z + dz); };
  const items = ['claim_cabinet', 'large_box', 'large_box', 'workbench2', 'furnace', 'large_box', 'research_table'];
  const placed = [];
  let si = 0;
  for (const type of items) {
    for (; si < T.slots.length; si++) {
      const sl = T.slots[si], p = at(sl);
      const res = G.deploy.place(owner, type, p.x, p.y, p.z, st.yaw + sl.yaw, { free: true });
      if (res.ok) { placed.push(res.dep); si++; break; }
    }
  }
  const tc = G.build.tcOf(st); if (tc && tc.auth) tc.auth.add(owner.team);
  // the loot that makes it worth raiding
  const loot = [['scrap', 1200], ['sulfur', 3000], ['gunpowder', 800], ['metal_frag', 4000], ['hqm', 120], ['rifle_ammo', 400], ['explosives', 30], ['assault_rifle', 1], ['semi_rifle', 2], ['med_syringe', 10], ['metal_chest', 1]];
  const boxes = placed.filter(d => d.type === 'large_box');
  loot.forEach(([id, n], i) => { const b = boxes[i % Math.max(1, boxes.length)]; if (b) b.cont.add(id, n); });
  if (tc && tc.cont) { tc.cont.add('wood', 3000); tc.cont.add('stones', 5000); tc.cont.add('metal_frag', 2000); }
  // sleeping bags to come back at
  for (const s of T.bagSpots.slice(0, 3)) { const p = B.toWorld(st, s.x, FOUND_H, s.z); G.deploy.place(owner, 'sleeping_bag', p.x, p.y, p.z, st.yaw, { free: true }); }
  return st;
}

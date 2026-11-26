// Bombsite: a 5v5 bomb-defusal shooter against bots. You and 4 bot teammates play 5 bots, first to 6 rounds,
// sides swap after round 5 (5–5 goes to one overtime round). Ts plant the bomb at A or B; CTs stop them or defuse.
// Money from kills, round wins and loss bonuses buys guns, armour, a defuse kit and grenades.
// Ranked: ranked.js ladder; the enemy bots get tougher with each rank. Challenger = the most kills in one
// Champion match (server/challenger.js `bombsite`).
// Online: up to 10 people in a lobby, bots fill the rest; the host's page runs the match (see the Online section and
// server/bombsite.js). Online matches are unranked.
// Everything runs inside this function, so nothing outside the game can replace its functions or read its state.
(() => {
  'use strict';
  const W = window.BombsiteWorld, FXL = window.BombsiteFX;
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('bombsite-' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bombsite-' + k, v); } catch (e) { } },
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.random() * a.length | 0];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
  const fwd = (yaw, pitch) => { const c = Math.cos(pitch); return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c }; };
  const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const other = t => t === 'T' ? 'CT' : 'T';
  const TEAMNAME = { T: 'Terrorists', CT: 'Counter-Terrorists' };

  // ══════════════ Rules ══════════════
  const FREEZE = 8, BUY_TIME = 28, ROUND_TIME = 115, BOMB_TIME = 40, POST_TIME = 5.5, PLANT_TIME = 3.2, DEFUSE_TIME = 10, KIT_TIME = 5;
  const HALF = 5, TO_WIN = 6;
  const GRAV = 20, NADE_G = 9, BASE_FOV = 72;
  const JUMP_BUFFER = 0.15, AIR_WISH = 0.85, AIR_ACCEL = 12;
  const UNITS = 250 / 6.35;   // speed counter in CS units per second (knife run speed = 250)
  const ECON = { start: 800, max: 16000, elim: 3250, bomb: 3500, defuse: 3500, time: 3250, loss: [1400, 1900, 2400, 2900, 3400], plantTeam: 800, plant: 300, defuse_: 300, ot: 10000 };

  // Guns. dmg per bullet · pen = share of damage that gets through armour · rf = damage kept per 10 m ·
  // spread / move = inaccuracy in degrees standing / at full run · up / side = recoil (degrees) · fi = extra spread per shot in a spray
  const WD = {
    knife: { id: 'knife', name: 'Knife', slot: 3, look: 'knife', price: 0, kill: 1500, melee: true, dmg: 40, alt: 65, range: 1.9, speed: 6.35, draw: 0.3 },
    zeus: { id: 'zeus', name: 'Zap-27', slot: 3, look: 'zeus', price: 200, kill: 100, zeus: true, dmg: 500, pen: 1, rf: 1, rpm: 60, mag: 1, reserve: 0, range: 3.6, speed: 6.1, spread: 0.2, move: 0.5, up: 0, side: 0, fi: 0, snd: 'zeus', draw: 0.5 },
    glock: { id: 'glock', name: 'P-18', slot: 2, team: 'T', look: 'glock', price: 200, kill: 300, dmg: 30, pen: 0.47, rf: 0.85, rpm: 400, mag: 20, reserve: 120, reload: 2.2, speed: 6.1, spread: 0.3, move: 1.8, up: 0.9, side: 0.25, fi: 0.15, recover: 3.2, snd: 'pistol', draw: 0.5 },
    usp: { id: 'usp', name: 'K-45', slot: 2, team: 'CT', look: 'usp', price: 200, kill: 300, dmg: 35, pen: 0.505, rf: 0.91, rpm: 352, mag: 12, reserve: 24, reload: 2.2, speed: 6.1, spread: 0.2, move: 1.6, up: 1.2, side: 0.25, fi: 0.18, recover: 3.2, snd: 'pistol', draw: 0.5 },
    deagle: { id: 'deagle', name: 'Viper .50', slot: 2, look: 'deagle', price: 700, kill: 300, dmg: 63, pen: 0.93, rf: 0.81, rpm: 267, mag: 7, reserve: 35, reload: 2.2, speed: 5.9, spread: 0.25, move: 3.8, up: 3.6, side: 0.7, fi: 0.7, recover: 2.4, snd: 'deagle', draw: 0.6 },
    smg: { id: 'smg', name: 'Hornet', slot: 1, look: 'smg', cat: 'smg', price: 1250, kill: 600, dmg: 26, pen: 0.6, rf: 0.87, rpm: 857, auto: true, mag: 30, reserve: 120, reload: 2.1, speed: 6.1, spread: 1.0, move: 1.8, up: 0.5, side: 0.45, fi: 0.1, recover: 15, snd: 'smg', draw: 0.6 },
    shotgun: { id: 'shotgun', name: 'Brawler', slot: 1, look: 'shotgun', cat: 'heavy', price: 1050, kill: 900, dmg: 26, pellets: 9, pen: 0.5, rf: 0.45, rpm: 68, mag: 8, reserve: 32, shell: 0.5, speed: 5.9, spread: 3.4, move: 1.2, up: 4, side: 0.5, fi: 0, recover: 6, snd: 'shotgun', draw: 0.7 },
    galil: { id: 'galil', name: 'Scrapper', slot: 1, team: 'T', look: 'galil', cat: 'rifle', price: 1800, kill: 300, dmg: 30, pen: 0.775, rf: 0.98, rpm: 666, auto: true, mag: 35, reserve: 90, reload: 3.0, speed: 5.7, spread: 0.65, move: 5.5, up: 0.72, side: 0.7, fi: 0.14, recover: 12, snd: 'rifle', draw: 0.75 },
    famas: { id: 'famas', name: 'Burstline', slot: 1, team: 'CT', look: 'famas', cat: 'rifle', price: 1950, kill: 300, dmg: 30, pen: 0.7, rf: 0.96, rpm: 666, auto: true, mag: 25, reserve: 90, reload: 3.3, speed: 5.7, spread: 0.55, move: 5.2, up: 0.7, side: 0.55, fi: 0.13, recover: 12, snd: 'rifle', draw: 0.75 },
    ak: { id: 'ak', name: 'AR-7', slot: 1, team: 'T', look: 'ak', cat: 'rifle', price: 2700, kill: 300, dmg: 36, pen: 0.775, rf: 0.98, rpm: 600, auto: true, mag: 30, reserve: 90, reload: 2.5, speed: 5.5, spread: 0.45, move: 6.5, up: 1.05, side: 0.95, fi: 0.16, recover: 12, snd: 'rifle', draw: 0.8 },
    m4: { id: 'm4', name: 'M-Carbine', slot: 1, team: 'CT', look: 'm4', cat: 'rifle', price: 2900, kill: 300, dmg: 33, pen: 0.7, rf: 0.97, rpm: 666, auto: true, mag: 30, reserve: 90, reload: 3.1, speed: 5.6, spread: 0.38, move: 6.0, up: 0.85, side: 0.7, fi: 0.13, recover: 13, snd: 'rifle', draw: 0.8 },
    scout: { id: 'scout', name: 'Scout', slot: 1, look: 'scout', cat: 'sniper', price: 1700, kill: 300, dmg: 88, pen: 0.85, rf: 0.98, rpm: 48, mag: 10, reserve: 90, reload: 3.7, speed: 6.1, spread: 2.8, scoped: 0.04, move: 3.5, up: 3, side: 0.3, fi: 0, recover: 3, scope: [31], jumpAcc: true, snd: 'sniper', draw: 0.9 },
    awp: { id: 'awp', name: 'Longbow', slot: 1, look: 'awp', cat: 'sniper', price: 4750, kill: 100, dmg: 115, pen: 0.975, rf: 0.99, rpm: 41, mag: 5, reserve: 30, reload: 3.7, speed: 5.0, spread: 6, scoped: 0.02, move: 10, up: 4, side: 0.4, fi: 0, recover: 3, scope: [31, 8], snd: 'sniper', draw: 1.0 },
  };
  for (const d of Object.values(WD)) { let h = 0; for (const c of d.id) h = (h * 31 + c.charCodeAt(0)) | 0; d.seed = (Math.abs(h) % 1000) / 1000 * TAU; }
  const NADES = {
    flash: { id: 'flash', name: 'Flashbang', price: 200, max: 2 },
    he: { id: 'he', name: 'HE Grenade', price: 300, max: 1 },
    smoke: { id: 'smoke', name: 'Smoke', price: 300, max: 1 },
    molotov: { id: 'molotov', name: 'Molotov', price: 400, max: 1, team: 'T' },
    incendiary: { id: 'incendiary', name: 'Incendiary', price: 500, max: 1, team: 'CT' },
    decoy: { id: 'decoy', name: 'Decoy', price: 50, max: 1 },
  };
  const GEAR = {
    kevlar: { id: 'kevlar', name: 'Kevlar Vest', price: 650 },
    helmet: { id: 'helmet', name: 'Kevlar + Helmet', price: 1000 },
    kit: { id: 'kit', name: 'Defuse Kit', price: 400, team: 'CT' },
  };
  const NADE_DEF = { id: 'nade', speed: 6.1, draw: 0.35 }, BOMB_DEF = { id: 'bomb', name: 'Bomb', speed: 6.1, draw: 0.5 };
  const KNIFE = { def: WD.knife };
  const inst = id => ({ def: WD[id], ammo: WD[id].mag || 0, reserve: WD[id].reserve || 0 });
  // Spray pattern: shot i of a spray → [yaw, pitch] offset in radians (climbs, then sways side to side)
  function recoil(d, i) {
    if (!d.up) return [0, 0];
    const n = Math.min(i, 9);
    const p = d.up * (n - n * n / 22) + (i > 9 ? d.up * 0.35 * Math.sin(i * 0.8) : 0);
    const y = i < 3 ? d.side * 0.2 * i * (Math.sin(d.seed) > 0 ? 1 : -1) : d.side * 2.2 * Math.sin((i - 3) * 0.42 + d.seed);
    return [y * DEG, p * DEG];
  }

  // Bot skill. Ranked blends easy / normal / hard for each rank (ranked.js blendLevels); Champion goes past hard.
  // react: seconds to start shooting · aim: starting aim error (degrees) · turn: rad/s · track: how fast the error shrinks ·
  // spray: recoil control · hs: how often they go for the head · util: grenade use · stop: stops to shoot
  const BOT_LV = {
    easy: { react: 0.78, aim: 3.6, turn: 3.2, track: 0.42, spray: 0.2, hs: 0.08, burst: 4, util: 0.25, strafe: 0.1, fov: 95, hear: 0.6, stop: 0.15, crouch: 0.1 },
    normal: { react: 0.44, aim: 1.9, turn: 6, track: 0.68, spray: 0.5, hs: 0.28, burst: 6, util: 0.6, strafe: 0.4, fov: 115, hear: 0.85, stop: 0.55, crouch: 0.25 },
    hard: { react: 0.28, aim: 1.0, turn: 9.5, track: 0.86, spray: 0.76, hs: 0.52, burst: 9, util: 0.9, strafe: 0.65, fov: 130, hear: 1, stop: 0.85, crouch: 0.35 },
  };
  const profAt = at => Ranked.blendLevels(BOT_LV.easy, BOT_LV.normal, BOT_LV.hard, [at])[0];
  const RANK_AT = [0, 0.55, 1.1, 1.6, 2, 2.45];
  const RANK_LABEL = ['Bronze bots: slow to react and spray wildly', 'Silver bots: getting the hang of it', 'Gold bots: solid aim, use some grenades',
    'Platinum bots: quick, accurate and they throw utility', 'Diamond bots: sharp reactions and control their spray', 'Champion bots: near-instant reactions and lots of headshots'];
  const PRACTICE_AT = { easy: 0, normal: 1, hard: 2, expert: 2.45 };
  const BOT_NAMES = ['Ace', 'Blitz', 'Cobra', 'Dune', 'Echo', 'Flint', 'Ghost', 'Havoc', 'Jinx', 'Kodiak', 'Lynx', 'Maverick', 'Nomad', 'Onyx', 'Pike', 'Quill', 'Raven', 'Sable', 'Talon', 'Vex', 'Wolf', 'Zed', 'Rook', 'Bishop', 'Tango', 'Viper', 'Sparrow'];

  // ══════════════ Setup ══════════════
  const settings = {
    side: store.get('side', 'random'), diff: store.get('diff', 'normal'), quality: store.get('quality', 'high'),
    sens: clamp(parseFloat(store.get('sens', '1')) || 1, 0.1, 4), sound: store.get('sound', '1') === '1', speedo: store.get('speedo', '0') === '1',
  };
  const cv = $('cv');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.quality === 'low' ? 0.85 : 1.5));
  renderer.shadowMap.enabled = settings.quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  const scene = new THREE.Scene(), vmScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 700); camera.rotation.order = 'YXZ';
  const vmCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  vmScene.add(new THREE.HemisphereLight(0xfff4e0, 0x6b5a45, 0.85));
  const vmSun = new THREE.DirectionalLight(0xffffff, 0.75); vmSun.position.set(0.5, 1, 0.6); vmScene.add(vmSun);
  W.buildScene(THREE, scene, { quality: settings.quality });
  renderer.shadowMap.needsUpdate = true;
  const audio = FXL.createAudio(); audio.setOn(settings.sound);
  const models = FXL.createModels(THREE);
  const fx = FXL.createEffects(THREE, scene);
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = vmCam.aspect = w / h; camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
    const a = $('after'); a.width = Math.max(1, w / 2 | 0); a.height = Math.max(1, h / 2 | 0);
  }
  addEventListener('resize', resize); resize();

  // ══════════════ State ══════════════
  let T = 0;                 // game clock (stops while paused)
  let G = null, R = null;    // match, round
  let ents = [], player = null, nextId = 1;
  const nades = [], smokes = [], fires = [], decoys = [], drops = [];
  const bomb = { state: 'none', carrier: null, x: 0, y: 0, z: 0, vy: 0, site: null, explodeAt: 0, nextBeep: 0, defuser: null, mesh: null, led: null, dropT: 0 };
  let intel = { T: new Map(), CT: new Map() };
  const fireGrid = new Uint8Array(W.NW * W.NH);
  let paused = false, camMode = 'fp', specId = 0, specAt = 0, shake = 0;
  const byId = id => ents.find(e => e.id === id);
  const aliveOf = team => ents.filter(e => e.alive && e.team === team);
  // Online play (the Online section further down). The host's page runs the match; the other players' pages
  // (clients) show what the host sends and send back their own movement and actions.
  const NET = { on: false, host: false, client: false, sock: null, open: false, room: null, token: null, ev: [], acts: [], ids: { n: 0, s: 0, f: 0, d: 0 },
    seq: 0, cid: 0, at: 1, sendAcc: 0, inAcc: 0, lastFull: -9, lastSend: -9, lastG: '', lastIn: '', lastInT: 0, clock: false, myInfo: null, ticker: null, retryT: 0, retryMs: 1000 };
  const emit = ev => { if (NET.host) NET.ev.push(ev); };
  const netAct = a => { if (NET.client) NET.acts.push(a); };
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const isHuman = e => e.isPlayer || !!e.net || !!e.human;

  // ══════════════ Entities ══════════════
  function makeEnt(name, team, isPlayer, prof) {
    const e = {
      id: nextId++, name, team, isPlayer, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, crouch: 0, onGround: true,
      hp: 100, armor: 0, helmet: false, kit: false, money: ECON.start, alive: true,
      prim: null, sec: inst(team === 'T' ? 'glock' : 'usp'), zeus: null, nades: [], bomb: false, slot: 2, sub3: 'knife', nadeI: 0, lastSlot: 3,
      switchUntil: 0, reloadUntil: 0, reloadStart: 0, shellAt: 0, nextFire: 0, recoilIdx: 0, lastShot: -9, scope: 0, scopeT: 0, rescopeAt: 0,
      punchP: 0, punchY: 0, kickP: 0, kickY: 0, flashUntil: 0, flashStr: 0, flashT0: 0, flashDur: 0, tagUntil: 0, stepT: 0, deadAt: 0, spottedUntil: 0,
      planting: null, defusing: null, pin: null, trigLatch: false, fireAcc: 0, inFire: false, swingT: -9,
      stats: { k: 0, d: 0, a: 0, hs: 0, dmg: 0, mvp: 0 }, rk: 0, dmgFrom: new Map(), model: null, b: null,
    };
    if (!isPlayer) e.b = newBrain(prof);
    return e;
  }
  const eyeH = e => 1.64 - 0.5 * e.crouch;
  const bodyH = e => 1.8 - 0.5 * e.crouch;
  const eyePos = e => ({ x: e.pos.x, y: e.pos.y + eyeH(e), z: e.pos.z });
  const hSpeed = e => Math.hypot(e.vel.x, e.vel.z);
  function cur(e) {
    switch (e.slot) {
      case 1: return e.prim;
      case 2: return e.sec;
      case 3: return e.sub3 === 'zeus' && e.zeus ? e.zeus : KNIFE;
      case 4: return e.nades.length ? { def: NADE_DEF, nade: e.nades[e.nadeI % e.nades.length] } : null;
      case 5: return e.bomb ? { def: BOMB_DEF } : null;
    }
    return null;
  }
  const lookOf = e => { if (e.netLook !== undefined) return e.netLook; const w = cur(e); return !w ? null : w.nade ? w.nade : w.def.id === 'bomb' ? 'bomb' : w.def.look; };
  function maxSpeed(e) {
    const w = cur(e), d = w && w.def;
    let s = d ? d.speed : 6.1;
    if (d && d.scope && e.scope) s *= 0.55;
    if (T < e.tagUntil) s *= 0.55;
    return s;
  }
  function bestSlot(e) { return e.prim ? 1 : e.sec ? 2 : 3; }
  function selectSlot(e, s, sub) {
    if (!e.alive) return false;
    if ((s === 1 && !e.prim) || (s === 2 && !e.sec) || (s === 4 && !e.nades.length) || (s === 5 && !e.bomb)) return false;
    if (s === 3 && sub === 'zeus' && !e.zeus) sub = 'knife';
    if (s === e.slot && (s !== 3 || (sub || 'knife') === e.sub3)) return false;
    if (e.slot !== s) e.lastSlot = e.slot;
    e.slot = s; if (s === 3) e.sub3 = sub || 'knife';
    e.reloadUntil = 0; e.scope = 0; e.rescopeAt = 0; e.pin = null; e.planting = null;
    const w = cur(e);
    e.switchUntil = T + ((w && w.def.draw) || 0.45);
    e.nextFire = Math.max(e.nextFire, e.switchUntil);
    if (e.isPlayer) { vmState.drawT = T; audio.draw(null); }
    return true;
  }
  function startReload(e) {
    const w = cur(e);
    if (!w || !w.def.mag || w.nade || w.def.zeus || w.ammo >= w.def.mag || w.reserve <= 0 || e.reloadUntil) return;
    e.reloadStart = T; e.scope = 0; e.rescopeAt = 0;
    if (w.def.shell) { e.reloadUntil = T + 99; e.shellAt = T + 0.55; } else e.reloadUntil = T + w.def.reload;
    audio.reload(e.isPlayer ? null : eyePos(e));
    noise(e, 'reload', 9);
    if (NET.client && e.isPlayer) netAct(['r']);
  }
  function updateReload(e) {
    if (!e.reloadUntil) return;
    const w = cur(e);
    if (!w || !w.def.mag) { e.reloadUntil = 0; return; }
    if (w.def.shell) {
      if (T >= e.shellAt) {
        if (w.ammo < w.def.mag && w.reserve > 0) { w.ammo++; w.reserve--; e.shellAt = T + w.def.shell; if (e.isPlayer) audio.draw(null); }
        if (w.ammo >= w.def.mag || w.reserve <= 0) e.reloadUntil = 0;
      }
    } else if (T >= e.reloadUntil) {
      const n = Math.min(w.def.mag - w.ammo, w.reserve); w.ammo += n; w.reserve -= n; e.reloadUntil = 0;
    }
  }
  function spreadOf(e, w) {
    const d = w.def;
    let s = d.scope ? (e.scope && T - e.scopeT > 0.16 ? d.scoped : d.spread) : d.spread;
    const sp = hSpeed(e) / 6.35;
    s += d.move * Math.max(0, sp - 0.2) / 0.8;
    if (!e.onGround) s += d.jumpAcc && Math.abs(e.vel.y) < 1.5 ? 0.15 : (d.cat === 'sniper' ? 9 : 4 + d.move * 0.6);
    s += (d.fi || 0) * Math.min(e.recoilIdx, 6);
    if (e.crouch > 0.8 && e.onGround) s *= 0.78;
    return s;
  }

  // ══════════════ Shooting ══════════════
  const HG = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };
  function rayAABB(o, d, x0, y0, z0, x1, y1, z1, tmax) {
    let t0 = 0, t1 = tmax;
    for (let a = 0; a < 3; a++) {
      const oo = a === 0 ? o.x : a === 1 ? o.y : o.z, dd = a === 0 ? d.x : a === 1 ? d.y : d.z;
      const lo = a === 0 ? x0 : a === 1 ? y0 : z0, hi = a === 0 ? x1 : a === 1 ? y1 : z1;
      if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return -1; continue; }
      let u0 = (lo - oo) / dd, u1 = (hi - oo) / dd;
      if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }
      if (u0 > t0) t0 = u0; if (u1 < t1) t1 = u1;
      if (t0 > t1) return -1;
    }
    return t0;
  }
  function raySphere(o, d, cx, cy, cz, r, tmax) {
    const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz, b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
    if (disc < 0) return -1;
    let t = -b - Math.sqrt(disc); if (t < 0) t = -b + Math.sqrt(disc);
    return t >= 0 && t < tmax ? t : -1;
  }
  function hitTest(v, o, d, tmax) {
    const x = v.pos.x, y = v.pos.y, z = v.pos.z;
    const cx = x - o.x, cy = y + 1 - o.y, cz = z - o.z, tc = cx * d.x + cy * d.y + cz * d.z;
    if (tc < -1.5 || tc > tmax + 1.5) return null;
    const qx = cx - d.x * tc, qy = cy - d.y * tc, qz = cz - d.z * tc;
    if (qx * qx + qy * qy + qz * qz > 1.4) return null;
    const drop = 0.5 * v.crouch;
    let best = tmax, g = null, t;
    t = raySphere(o, d, x, y + 1.63 - drop, z, 0.15, best); if (t >= 0) { best = t; g = 'head'; }
    t = rayAABB(o, d, x - 0.24, y + 1.08 - drop, z - 0.24, x + 0.24, y + 1.49 - drop, z + 0.24, best); if (t >= 0 && t < best) { best = t; g = 'chest'; }
    t = rayAABB(o, d, x - 0.22, y + 0.84 - drop * 0.9, z - 0.2, x + 0.22, y + 1.08 - drop, z + 0.2, best); if (t >= 0 && t < best) { best = t; g = 'stomach'; }
    t = rayAABB(o, d, x - 0.22, y, z - 0.2, x + 0.22, y + 0.84 - drop * 0.9, z + 0.2, best); if (t >= 0 && t < best) { best = t; g = 'legs'; }
    return g ? { t: best, g } : null;
  }
  function muzzleWorld(e) {
    const ey = eyePos(e), f = fwd(e.yaw, e.pitch), rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
    if (e.isPlayer && camMode === 'fp') return { x: ey.x + f.x * 0.6 + rx * 0.14, y: ey.y + f.y * 0.6 - 0.14, z: ey.z + f.z * 0.6 + rz * 0.14 };
    return { x: ey.x + f.x * 0.75 + rx * 0.12, y: ey.y + f.y * 0.75 - 0.28, z: ey.z + f.z * 0.75 + rz * 0.12 };
  }
  function shoot(e, alt) {
    if (!e.alive || T < e.switchUntil || T < e.nextFire) return false;
    const w = cur(e);
    if (!w || w.nade || w.def.id === 'bomb') return false;
    const d = w.def;
    if (d.melee) return knifeAttack(e, alt);
    if (e.reloadUntil && !d.shell) return false;
    if (w.ammo <= 0) {
      if (e.isPlayer) { audio.dry(); e.nextFire = T + 0.25; if (w.reserve > 0) startReload(e); }
      return false;
    }
    if (d.shell && e.reloadUntil) e.reloadUntil = 0;
    w.ammo--;
    e.nextFire = T + 60 / d.rpm;
    const sp = spreadOf(e, w) * DEG, [ry, rp] = recoil(d, e.recoilIdx);
    const comp = e.b ? 1 - e.b.prof.spray : 1;
    const eye = eyePos(e), m = muzzleWorld(e), ends = [];
    for (let i = 0; i < (d.pellets || 1); i++) {
      const a = Math.random() * TAU, r = sp * Math.sqrt(Math.random());
      ends.push(fireBullet(e, eye, fwd(e.yaw + ry * comp + Math.cos(a) * r, e.pitch + rp * comp + Math.sin(a) * r), d, m, i < 2));
    }
    emit(['sh', e.id, d.snd, ends]);
    if (NET.client && e.isPlayer) netAct(['f', d.id, 0, netHits.splice(0), ends]);
    e.recoilIdx += 1; e.lastShot = T;
    if (e.isPlayer) { vmState.kick = 1; vmState.flashT = T; }
    else fx.billboard(m.x, m.y, m.z, d.cat === 'sniper' || d.pellets ? 0.6 : 0.4, 0.05, 0xffd080);
    audio.shot(d.snd, e.isPlayer && camMode === 'fp' ? null : eye, 1);
    noise(e, 'shot', d.cat === 'sniper' ? 95 : 70);
    if (d.scope && e.scope) { e.rescope = e.scope; e.scope = 0; e.rescopeAt = T + 60 / d.rpm * 0.85; }
    if (d.zeus) { e.zeus = null; e.sub3 = 'knife'; if (NET.client) e.netHold = T + 1; if (e.isPlayer) setTimeout(() => { if (e.alive && e.slot === 3) selectSlot(e, bestSlot(e)); }, 300); }
    if (e.isPlayer && w.ammo === 0 && w.reserve > 0 && !d.zeus) e.autoReloadAt = T + 0.35;
    return true;
  }
  const thinHits = [], netHits = [];
  function fireBullet(src, o, d, def, from, tracerOn) {
    thinHits.length = 0;
    const range = def.zeus ? def.range : 230;
    const wall = W.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range, thinHits);
    let bt = wall ? wall.t : range, best = null, bg = null;
    for (const v of ents) {
      if (v === src || !v.alive || v.team === src.team) continue;
      const r = hitTest(v, o, d, bt);
      if (r) { best = v; bt = r.t; bg = r.g; }
    }
    let mult = 1;
    for (const th of thinHits) if (th.t < bt) {
      mult *= 0.6;
      const hx = o.x + d.x * th.t, hy = o.y + d.y * th.t, hz = o.z + d.z * th.t, b = th.box;
      const nz = Math.abs(hz - b.z0) < 0.02 ? -1 : 1;
      fx.decal(hx, hy, hz, 0, 0, nz); fx.particles(hx, hy, hz, 4, 0x8a5a2a, 2.5, 9, 0.4, null);
    }
    const end = { x: o.x + d.x * bt, y: o.y + d.y * bt, z: o.z + d.z * bt };
    if (best) {
      const raw = def.dmg * Math.pow(def.rf, bt / 10) * mult;
      // Online, a client's bullets are checked on its own screen and the host applies the damage
      if (NET.client) { netHits.push([best.id, bg, r2(raw)]); audio.hit(bg === 'head'); }
      else damage(best, raw, bg, src, def, { dir: d });
      fx.particles(end.x, end.y, end.z, bg === 'head' ? 9 : 5, 0xe8dcc4, 2.6, 5, 0.3, null);
    } else if (wall) {
      fx.decal(end.x, end.y, end.z, wall.nx, wall.ny, wall.nz);
      fx.particles(end.x, end.y, end.z, 6, wall.box && wall.box.kind === 'crate' ? 0xb08050 : 0xe0c49a, 3.5, 9, 0.45, { x: wall.nx * 2, y: wall.ny * 2 + 0.8, z: wall.nz * 2 });
      if (Math.random() < 0.3) fx.particles(end.x, end.y, end.z, 2, 0xffd27a, 6, 9, 0.2, { x: wall.nx * 3, y: wall.ny * 3, z: wall.nz * 3 });
    }
    if (tracerOn && !def.zeus) fx.tracer(from, end);
    if (def.zeus) fx.particles(end.x, end.y, end.z, 10, 0x9fd8ff, 3, 2, 0.3, null);
    // Bullets passing close by give a bot away the shooter's position
    for (const v of ents) {
      if (!v.b || !v.alive || v.team === src.team) continue;
      const vx = v.pos.x - o.x, vy = v.pos.y + 1.4 - o.y, vz = v.pos.z - o.z, t = clamp(vx * d.x + vy * d.y + vz * d.z, 0, bt);
      if (Math.hypot(vx - d.x * t, vy - d.y * t, vz - d.z * t) < 3) alert(v, src);
    }
    return [r2(end.x), r2(end.y), r2(end.z), best ? (bg === 'head' ? 8 : 7) : wall ? normIdx(wall) : 0];
  }
  const normIdx = w => w.nx > 0.5 ? 1 : w.nx < -0.5 ? 2 : w.ny > 0.5 ? 3 : w.ny < -0.5 ? 4 : w.nz > 0.5 ? 5 : 6;
  function knifeAttack(e, stab) {
    const d = WD.knife;
    e.nextFire = T + (stab ? 1.0 : 0.45); e.swingT = T; e.swingAlt = stab;
    audio.shot('knife', e.isPlayer ? null : eyePos(e), 0.8);
    const eye = eyePos(e), f = fwd(e.yaw, e.pitch), range = stab ? 1.6 : 1.9;
    let best = null, bt = range, bg = 'chest';
    for (const v of ents) {
      if (v === e || !v.alive || v.team === e.team) continue;
      for (const ox of [0, -0.12, 0.12]) {
        const dir = fwd(e.yaw + ox, e.pitch);
        const r = hitTest(v, eye, dir, bt);
        if (r) { best = v; bt = r.t; bg = r.g; }
      }
    }
    if (best && W.los(eye.x, eye.y, eye.z, best.pos.x, best.pos.y + 1.2, best.pos.z)) {
      const back = Math.abs(angDiff(best.yaw, e.yaw)) < 60 * DEG;
      const dmg = stab ? (back ? 180 : 65) : (back ? 90 : 40);
      if (NET.client) netHits.push([best.id, 'chest', dmg]);
      else damage(best, dmg, 'chest', e, { ...d, pen: 0.85, name: 'Knife' }, {});
      audio.hit(false);
    } else {
      const hit = W.raycast(eye.x, eye.y, eye.z, f.x, f.y, f.z, range);
      if (hit) { fx.particles(eye.x + f.x * hit.t, eye.y + f.y * hit.t, eye.z + f.z * hit.t, 4, 0xffe0a0, 3, 9, 0.25, null); audio.bounce(null); }
    }
    emit(['sh', e.id, 'knife', []]);
    if (NET.client && e.isPlayer) netAct(['f', 'knife', stab ? 1 : 0, netHits.splice(0), []]);
    return true;
  }
  function damage(v, raw, g, a, def, o) {
    o = o || {};
    if (!v.alive || NET.client) return;
    let dmg = raw * (HG[g] || 1);
    const armored = v.armor > 0 && !o.noArmor && (g === 'head' ? v.helmet : g !== 'legs');
    if (armored) {
      const pen = def.pen != null ? def.pen : 0.5;
      let hpD = dmg * pen, arD = (dmg - hpD) * 0.5;
      if (arD > v.armor) { hpD = dmg - v.armor * 2; arD = v.armor; }
      v.armor = Math.max(0, Math.round(v.armor - arD)); dmg = hpD;
    }
    dmg = Math.max(1, Math.round(dmg));
    const before = v.hp;
    v.hp = Math.max(0, v.hp - dmg);
    const dealt = before - v.hp;
    if (v.net) { const f = a && a !== v ? a.pos : o.from; emit(['hu', v.id, f ? r2(f.x) : null, f ? r2(f.z) : null, dmg, v.hp, o.fire ? 1 : 0]); }
    if (a && a !== v && a.team !== v.team) { a.stats.dmg += dealt; v.dmgFrom.set(a.id, (v.dmgFrom.get(a.id) || 0) + dealt); }
    if (!o.fire) {
      v.tagUntil = T + 0.35;
      v.kickP += rand(0.012, 0.03) * Math.min(1.5, dmg / 30); v.kickY += rand(-0.015, 0.015);
    }
    if (v.isPlayer) { hurtHUD(a && a !== v ? a.pos : o.from, dmg); if (!o.fire || Math.random() < 0.25) audio.hurt(); }
    if (a && a.isPlayer && a !== v && !o.fire && !o.nade) audio.hit(g === 'head');
    if (v.b && a && a !== v && a.team !== v.team) alert(v, a, true);
    if (v.hp <= 0) kill(v, a, def, g === 'head' && !o.nade, o);
  }
  function kill(v, a, def, hs, o) {
    v.alive = false; v.deadAt = T; v.hp = 0; v.planting = null; v.defusing = null; v.pin = null; v.scope = 0;
    v.stats.d++;
    if (a && a !== v && a.team !== v.team) {
      a.stats.k++; a.rk++; if (hs) a.stats.hs++;
      const reward = def.kill != null ? def.kill : 300;
      a.money = Math.min(ECON.max, a.money + reward);
      givePop(a, reward); if (a.isPlayer) audio.ui('kill');
    } else if (a && a !== v && a.team === v.team) { a.money = Math.max(0, a.money - 300); a.stats.k--; }
    for (const [id, dmg] of v.dmgFrom) { const p = byId(id); if (p && p !== a && dmg >= 41 && p.team !== v.team) p.stats.a++; }
    emit(['k', a ? a.id : 0, v.id, o.weaponName || def.name || '', hs ? 1 : 0, o.wall ? 1 : 0]);
    feed(a, v, o.weaponName || def.name || '', hs, !!o.wall);
    if (v.prim || v.sec) dropItem(v, v.prim || v.sec, true);
    if (v.bomb) dropBomb(v, true);
    v.prim = null; v.sec = null; v.nades = []; v.zeus = null; v.armor = 0; v.helmet = false; v.kit = false; v.slot = 3; v.sub3 = 'knife';
    if (v.model) { v.model.fallDir = Math.random() < 0.5 ? 1 : -1; }
    if (v.isPlayer) { camMode = 'dead'; specAt = T + 1.8; setBuy(false); }
    if (v.b) { v.b.target = null; v.b.throwing = null; }
    if (bomb.defuser === v) bomb.defuser = null;
    checkRoundEnd();
  }
  function alert(v, src, hurt) {
    const b = v.b;
    b.heard = { x: src.pos.x, y: src.pos.y + 1.5, z: src.pos.z, t: T, kind: 'shot' };
    if (hurt) { b.hurtBy = src; b.hurtT = T; }
  }

  // ══════════════ Sound events the bots can hear ══════════════
  function noise(src, kind, radius, pos) {
    const p = pos || src.pos;
    for (const v of ents) {
      if (!v.b || !v.alive || (src && v.team === src.team)) continue;
      const d = dist2(v.pos.x, v.pos.z, p.x, p.z);
      if (d > radius * v.b.prof.hear) continue;
      const h = v.b.heard;
      if (!h || T - h.t > 0.6 || kind === 'shot' || kind === 'defuse') v.b.heard = { x: p.x, y: (p.y || 0) + 1.4, z: p.z, t: T, kind };
      if (kind === 'step') { const s = siteSide(p.x, p.z); if (s) v.b.stepHeard = { site: s, t: T }; }
      if (kind === 'defuse' && v.team === 'T') v.b.defuseHeard = T;
    }
  }
  function siteSide(x, z) {
    const r = W.regionName(x, z);
    if (r === 'A Site' || r === 'Long A' || r === 'Catwalk' || r === 'Long Doors') return 'A';
    if (r === 'B Site' || r === 'B Tunnels' || r === 'B Window') return 'B';
    return null;
  }

  // ══════════════ Drops (guns on the floor) ══════════════
  function dropItem(e, w, death) {
    if (e.prim === w) e.prim = null; else if (e.sec === w) e.sec = null;
    const m = models.gun(w.def.look);
    m.rotation.set(0, rand(0, TAU), PI / 2);
    scene.add(m);
    const f = fwd(e.yaw, 0), dd = { w, x: e.pos.x, y: e.pos.y + (death ? 0.4 : 1.3), z: e.pos.z, vx: death ? rand(-1, 1) : f.x * 4 + e.vel.x, vy: death ? 1 : 2.5, vz: death ? rand(-1, 1) : f.z * 4 + e.vel.z, mesh: m, t: T, by: e.id };
    drops.push(dd);
    dd.id = ++NET.ids.d;
    emit(['dr', dd.id, w.def.id, r2(dd.x), r2(dd.y), r2(dd.z), r2(dd.vx), r2(dd.vy), r2(dd.vz), e.id]);
    if (!death && e.alive && (e.slot === 1 || e.slot === 2) && !cur(e)) selectSlot(e, bestSlot(e));
    return dd;
  }
  function updateDrops(dt) {
    for (const d of drops) {
      if (d.vy !== 0 || d.vx || d.vz) {
        d.vy -= GRAV * dt;
        const p = { x: d.x, y: d.y, z: d.z };
        const r = W.moveBody(p, d.vx * dt, d.vy * dt, d.vz * dt, 0.15, 0.1, false);
        d.x = p.x; d.y = p.y; d.z = p.z;
        if (r.hitX) d.vx *= -0.3; if (r.hitZ) d.vz *= -0.3;
        if (r.ground) { d.vy = 0; d.vx *= 0.8; d.vz *= 0.8; if (Math.abs(d.vx) + Math.abs(d.vz) < 0.1) d.vx = d.vz = 0; }
      }
      d.mesh.position.set(d.x, d.y + 0.05, d.z);
    }
  }
  function removeDrop(d) { const i = drops.indexOf(d); if (i >= 0) drops.splice(i, 1); scene.remove(d.mesh); emit(['dx', d.id]); }
  function pickUp(e, d) {
    const slot = d.w.def.slot;
    const old = slot === 1 ? e.prim : e.sec;
    if (old) dropItem(e, old, false);
    if (slot === 1) e.prim = d.w; else e.sec = d.w;
    removeDrop(d);
    e.slot = 0; selectSlot(e, slot);
    if (e.isPlayer) audio.draw(null);
    if (e.net) emit(['gv', e.id, slot, d.w.def.id, d.w.ammo, d.w.reserve]);
  }
  function nearestDrop(e, r) {
    let best = null, bd = r;
    for (const d of drops) { const dd = Math.hypot(d.x - e.pos.x, d.z - e.pos.z, (d.y - e.pos.y) * 0.5); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }

  // ══════════════ Grenades ══════════════
  function nadePhys(n, dt, onContact) {
    const SUB = 4, h = dt / SUB, r = 0.07;
    for (let s = 0; s < SUB; s++) {
      n.vy -= NADE_G * h;
      const px = n.x, py = n.y, pz = n.z;
      n.x += n.vx * h; n.y += n.vy * h; n.z += n.vz * h;
      n.ground = false;
      if (n.y < r) {
        n.y = r;
        if (n.vy < 0) { if (onContact) onContact(n, 'top', -n.vy); n.vy = -n.vy * 0.36; n.vx *= 0.72; n.vz *= 0.72; if (n.vy < 0.7) n.vy = 0; }
        n.ground = true;
      }
      for (const b of W.boxes) {
        if (n.x + r <= b.x0 || n.x - r >= b.x1 || n.y + r <= b.y0 || n.y - r >= b.y1 || n.z + r <= b.z0 || n.z - r >= b.z1) continue;
        if (py - r >= b.y1 - 0.001) {
          n.y = b.y1 + r;
          if (n.vy < 0) { if (onContact) onContact(n, 'top', -n.vy); n.vy = -n.vy * 0.36; n.vx *= 0.72; n.vz *= 0.72; if (n.vy < 0.7) n.vy = 0; }
          n.ground = true;
        } else if (px + r <= b.x0 || px - r >= b.x1) { n.x = px + r <= b.x0 ? b.x0 - r : b.x1 + r; if (onContact) onContact(n, 'side', Math.abs(n.vx)); n.vx = -n.vx * 0.45; n.vy *= 0.85; n.vz *= 0.85; }
        else if (pz + r <= b.z0 || pz - r >= b.z1) { n.z = pz + r <= b.z0 ? b.z0 - r : b.z1 + r; if (onContact) onContact(n, 'side', Math.abs(n.vz)); n.vz = -n.vz * 0.45; n.vy *= 0.85; n.vx *= 0.85; }
        else if (py + r <= b.y0 + 0.001) { n.y = b.y0 - r; if (onContact) onContact(n, 'side', Math.abs(n.vy)); n.vy = -Math.abs(n.vy) * 0.4; }
        else { n.y = b.y1 + r; n.vy = 0; n.ground = true; }
      }
      if (n.ground && n.vy === 0) { const f = Math.max(0, 1 - 3.2 * h); n.vx *= f; n.vz *= f; }
    }
  }
  // Where a grenade thrown like this goes off (used by the bots to line up throws)
  function simulateNade(type, x, y, z, vx, vy, vz) {
    const n = { x, y, z, vx, vy, vz, landed: false }, dt = 1 / 60;
    let rest = 0;
    for (let t = 0; t < 5; t += dt) {
      let hitTop = false;
      nadePhys(n, dt, (nn, kind) => { if (kind === 'top') hitTop = true; });
      if ((type === 'molotov' || type === 'incendiary') && hitTop) return { x: n.x, y: n.y, z: n.z, t };
      if ((type === 'flash' || type === 'he') && t >= 1.6) return { x: n.x, y: n.y, z: n.z, t };
      if (Math.hypot(n.vx, n.vy, n.vz) < 0.25) { rest += dt; if (rest > 0.3) return { x: n.x, y: n.y, z: n.z, t }; } else rest = 0;
      if ((type === 'molotov' || type === 'incendiary') && t > 2) return null;
    }
    return { x: n.x, y: n.y, z: n.z, t: 5 };
  }
  function spawnNade(type, owner, x, y, z, vx, vy, vz, cid) {
    const mesh = models.gun(type); scene.add(mesh);
    const n = { type, owner, team: owner.team, x, y, z, vx, vy, vz, t0: T, rest: 0, mesh, spin: rand(-14, 14), bounceT: 0 };
    nades.push(n);
    if (NET.host) { n.nid = ++NET.ids.n; emit(['n', n.nid, type, owner.id, r3(x), r3(y), r3(z), r3(vx), r3(vy), r3(vz), cid || 0]); }
    audio.throwNade(owner.isPlayer ? null : eyePos(owner));
    noise(owner, 'nade', 14);
    return n;
  }
  // power 1 = full throw, ~0.55 = both buttons, 0.25 = underhand lob
  function throwNade(e, power, aimYaw, aimPitch) {
    const w = cur(e);
    if (!w || !w.nade) return;
    const type = w.nade;
    const yaw = aimYaw == null ? e.yaw : aimYaw;
    let pitch = aimPitch == null ? e.pitch + (PI / 2 - Math.abs(e.pitch)) * (10 / 90) : aimPitch;
    const dir = fwd(yaw, pitch), v = 18.5 * (power * 0.7 + 0.3), eye = eyePos(e);
    let sx = eye.x + dir.x * 0.35, sy = eye.y + dir.y * 0.35 - 0.06, sz = eye.z + dir.z * 0.35;
    if (!W.los(eye.x, eye.y, eye.z, sx, sy, sz)) { sx = eye.x; sy = eye.y; sz = eye.z; }
    const vx = r3(dir.x * v + e.vel.x * 0.9), vy = r3(dir.y * v + e.vel.y * 0.9), vz = r3(dir.z * v + e.vel.z * 0.9);
    if (NET.client) {
      // Thrown here straight away; the host throws the real one and its blast replaces this one
      sx = r3(sx); sy = r3(sy); sz = r3(sz);
      const n = spawnNade(type, e, sx, sy, sz, vx, vy, vz); n.cid = ++NET.cid;
      netAct(['t', type, sx, sy, sz, vx, vy, vz, n.cid]); e.netHold = T + 1.2;
    } else spawnNade(type, e, sx, sy, sz, vx, vy, vz);
    const i = e.nades.indexOf(type); if (i >= 0) e.nades.splice(i, 1);
    e.pin = null;
    if (e.nades.length && e.isPlayer) { e.nadeI = e.nadeI % e.nades.length; e.switchUntil = T + 0.5; vmState.drawT = T; }
    else { const back = e.lastSlot && e.lastSlot !== 4 ? e.lastSlot : bestSlot(e); e.slot = 0; if (!selectSlot(e, back)) selectSlot(e, bestSlot(e)); }
  }
  function updateNades(dt) {
    for (let i = nades.length - 1; i >= 0; i--) {
      const n = nades[i], age = T - n.t0;
      let popAt = null;
      nadePhys(n, dt, (nn, kind, sp) => {
        if (sp > 2 && T - n.bounceT > 0.08) { audio.bounce(n); n.bounceT = T; noise(n.owner, 'nade', 12, n); }
        if (kind === 'top' && (n.type === 'molotov' || n.type === 'incendiary') && !popAt) popAt = { x: n.x, y: n.y - 0.07, z: n.z };
      });
      n.mesh.position.set(n.x, n.y, n.z);
      if (Math.hypot(n.vx, n.vy, n.vz) > 0.3) { n.mesh.rotation.x += n.spin * dt; n.mesh.rotation.z += n.spin * 0.6 * dt; }
      n.rest = Math.hypot(n.vx, n.vy, n.vz) < 0.25 ? n.rest + dt : 0;
      let det = false;
      if (n.type === 'flash' || n.type === 'he') det = age >= 1.6;
      else if (n.type === 'smoke') det = n.rest > 0.25 || age > 4;
      else if (n.type === 'decoy') det = n.rest > 0.4 || age > 5;
      else if (popAt) { det = true; n.x = popAt.x; n.y = popAt.y; n.z = popAt.z; }
      else if (age > 2) { det = true; n.air = true; }
      if (n.type === 'molotov' || n.type === 'incendiary') {
        if (Math.random() < 0.5) fx.particles(n.x, n.y + 0.08, n.z, 1, 0xffa040, 0.3, -1, 0.3, null);
        for (const s of smokes) if (Math.hypot(n.x - s.x, n.y - (s.y + 1.5), n.z - s.z) < s.R * smokeGrow(s)) { det = true; n.fizz = true; }
      }
      if (det && !NET.client) { detonate(n); scene.remove(n.mesh); nades.splice(i, 1); }
      else if (NET.client && age > 8) { scene.remove(n.mesh); nades.splice(i, 1); }
    }
  }
  function detonate(n) {
    const p = { x: n.x, y: n.y, z: n.z };
    const sid = n.type === 'smoke' ? ++NET.ids.s : 0;
    emit(['nd', n.nid, n.type, r2(n.x), r2(n.y), r2(n.z), n.air ? 2 : n.fizz ? 1 : 0, sid]);
    if (n.type === 'flash') {
      fx.billboard(n.x, n.y, n.z, 7, 0.25, 0xffffff); fx.particles(n.x, n.y, n.z, 18, 0xffffff, 6, 2, 0.4, null);
      audio.flashBang(p); flashEvent(n.x, n.y, n.z, n.owner);
      noise(n.owner, 'shot', 40, p);
    } else if (n.type === 'he') {
      explosion(n.x, n.y, n.z, n.owner, 98, 9.5, 'HE Grenade');
      noise(n.owner, 'shot', 50, p);
    } else if (n.type === 'smoke') {
      const gy = n.y - 0.07;
      const s = { x: n.x, y: gy, z: n.z, t0: T, until: T + 18, R: 4.6, cloud: fx.smokeCloud(n.x, gy, n.z, 4.6), sid };
      smokes.push(s); audio.smokePop(p);
      for (const f of fires) if (Math.hypot(f.x - s.x, f.z - s.z) < s.R + 2 && Math.abs(f.y - s.y) < 3) { f.until = Math.min(f.until, T + 0.3); audio.fizzle(f); emit(['fo', f.fid]); }
    } else if (n.type === 'decoy') {
      const g = n.owner.prim ? n.owner.prim.def : WD[n.owner.team === 'T' ? 'glock' : 'usp'];
      decoys.push({ x: n.x, y: n.y, z: n.z, owner: n.owner, snd: g.snd, until: T + 15, next: T + 0.3 });
    } else {
      if (n.air || n.fizz) { audio.fizzle(p); fx.particles(n.x, n.y, n.z, 14, 0xff8a30, 3, 3, 0.5, null); if (n.air) audio.glass(p); return; }
      createFire(n.x, n.y, n.z, n.owner);
    }
  }
  function flashEvent(x, y, z) { for (const e of ents) flashEnt(e, x, y, z); }
  // Online, each page works out its own player's flash from where they're really looking
  function flashEnt(e, x, y, z) {
    if (!e.alive) return;
    const ey = eyePos(e), dx = x - ey.x, dy = y - ey.y, dz = z - ey.z, d = Math.hypot(dx, dy, dz);
    if (d > 48 || !W.los(x, y, z, ey.x, ey.y, ey.z) || smokeBlocks(x, y, z, ey.x, ey.y, ey.z)) return;
    const f = fwd(e.yaw, e.pitch), dot = (f.x * dx + f.y * dy + f.z * dz) / (d || 1);
    let s = dot > 0.6 ? 1 : dot > 0.15 ? 0.78 : dot > -0.4 ? 0.42 : 0.18;
    s *= clamp(1.18 - d / 38, 0.2, 1);
    if (s < 0.08) return;
    const dur = 0.25 + 4.7 * s * s;
    if (T + dur > e.flashUntil) { e.flashUntil = T + dur; e.flashStr = s; e.flashT0 = T; e.flashDur = dur; }
    if (e.isPlayer) playerFlashed(s, dur);
    if (e.b && e.b.throwing) e.b.throwing = null;
  }
  function explosion(x, y, z, owner, maxDmg, R, name) {
    fx.billboard(x, y + 0.5, z, R * 0.9, 0.35, 0xffa040); fx.billboard(x, y + 0.6, z, R * 0.5, 0.5, 0xffe0a0);
    fx.particles(x, y + 0.3, z, 50, 0xffa040, 9, 6, 0.8, null); fx.particles(x, y + 0.3, z, 40, 0x555048, 5, -0.5, 1.6, { x: 0, y: 1.5, z: 0 });
    audio.explode({ x, y, z }, R > 15);
    for (const e of ents) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.y + 1 - y, e.pos.z - z);
      if (e.isPlayer) shake = Math.max(shake, clamp(1 - d / (R * 2.4), 0, 1) * 0.8);
      if (NET.client || d > R) continue;
      if (!W.los(x, y + 0.3, z, e.pos.x, e.pos.y + 1.1, e.pos.z) && !W.los(x, y + 0.3, z, e.pos.x, e.pos.y + 1.6, e.pos.z)) continue;
      let dmg = R > 15 ? maxDmg * Math.exp(-(d * d) / (2 * 8.5 * 8.5)) : maxDmg * (1 - d / R);
      if (owner && e.team === owner.team && e !== owner) dmg *= 0.5;
      damage(e, dmg, 'chest', owner, { id: 'he', name, pen: R > 15 ? 0.5 : 0.575, kill: 300 }, { nade: true, from: { x, z }, weaponName: name });
    }
  }
  const smokeRise = s => { const k = clamp((T - s.t0) / 1.3, 0, 1); return 1 - (1 - k) * (1 - k); };
  const smokeFade = s => T > s.until - 2.5 ? clamp((s.until - T) / 2.5, 0, 1) : 1;
  const smokeGrow = s => smokeRise(s) * smokeFade(s);
  // Does a smoke cloud cover the line from a to b? The shape matches the cloud you see (fx smokeCloud):
  // about 1.15 R wide and from the floor to ~1.5 R up, so nobody sees or shoots through its soft edges.
  function smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of smokes) {
      const r = s.R * smokeGrow(s);
      if (r < 0.8) continue;
      const hr = r * 1.15, vr = r * 0.8 + 0.6, k = hr / vr;
      const cx = s.x, cy = (s.y + 0.4 + r * 0.6) * k, cz = s.z;
      const Ay = ay * k, By = by * k;
      const dx = bx - ax, dy = By - Ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz || 1;
      const t = clamp(((cx - ax) * dx + (cy - Ay) * dy + (cz - az) * dz) / L2, 0, 1);
      if (Math.hypot(ax + dx * t - cx, Ay + dy * t - cy, az + dz * t - cz) < hr) return true;
    }
    return false;
  }
  function createFire(x, y, z, owner) {
    for (const s of smokes) if (Math.hypot(x - s.x, z - s.z) < s.R * smokeGrow(s) + 0.5) { audio.fizzle({ x, y, z }); return; }
    const pts = [], R = 3.4;
    for (let gx = -R; gx <= R + 0.01; gx += 0.85) for (let gz = -R; gz <= R + 0.01; gz += 0.85) {
      if (gx * gx + gz * gz > R * R) continue;
      const px = x + gx, pz = z + gz;
      if (y < 0.25) { if (W.cellAt(px, pz) === '#' || W.blocked(px, 0.05, pz, 0.15, 0.3)) continue; }
      else if (!W.blocked(px, y - 0.12, pz, 0.05, 0.05) || W.blocked(px, y + 0.05, pz, 0.05, 0.3)) continue;
      if (!W.los(x, y + 0.25, z, px, y + 0.25, pz)) continue;
      pts.push({ x: px, z: pz });
    }
    if (!pts.length) pts.push({ x, z });
    const gy = y < 0.25 ? 0 : y;
    const fid = ++NET.ids.f;
    fires.push({ x, y: gy, z, pts, t0: T, until: T + 7, owner, vis: fx.fire(pts, gy), crackle: 0, fid });
    emit(['fi', fid, r2(x), r2(gy), r2(z), pts.flatMap(p => [r2(p.x), r2(p.z)])]);
    audio.glass({ x, y, z });
    noise(owner, 'nade', 25, { x, y, z });
    markFireGrid();
  }
  function markFireGrid() {
    fireGrid.fill(0);
    for (const f of fires) if (f.y < 0.5) for (const p of f.pts) {
      for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = W.nIdx(p.x + ox, p.z + oz); if (k >= 0) fireGrid[k] = 1; }
    }
    for (const e of ents) if (e.b) e.b.path = null;
  }
  const inFireAt = (x, y, z) => fires.some(f => T < f.until && Math.abs(y - f.y) < 0.9 && f.pts.some(p => Math.abs(p.x - x) < 0.72 && Math.abs(p.z - z) < 0.72));
  function updateUtil(dt) {
    for (let i = smokes.length - 1; i >= 0; i--) {
      const s = smokes[i];
      if (T >= s.until) { s.cloud.remove(); smokes.splice(i, 1); continue; }
      s.cloud.update(Math.max(0.15, smokeRise(s)), Math.min(smokeFade(s), clamp((T - s.t0) * 2.5, 0, 1)), dt);
    }
    let changed = false;
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i];
      if (T >= f.until) { f.vis.remove(); fires.splice(i, 1); changed = true; continue; }
      f.vis.update(T, clamp((f.until - T) / 0.8, 0, 1) * clamp((T - f.t0) * 4, 0, 1));
      if (T > f.crackle) { f.crackle = T + rand(0.2, 0.5); audio.crackle({ x: f.x, y: f.y, z: f.z }); }
      if (Math.random() < 0.3) { const p = pick(f.pts); fx.particles(p.x, f.y + 0.5, p.z, 1, 0x666058, 0.6, -0.8, 1.2, { x: 0, y: 1, z: 0 }); }
    }
    if (changed) markFireGrid();
    for (const e of ents) {
      if (!e.alive) continue;
      e.inFire = fires.length > 0 && inFireAt(e.pos.x, e.pos.y, e.pos.z);
      if (e.inFire && !NET.client) {
        const f = fires.find(ff => Math.abs(e.pos.y - ff.y) < 0.9 && ff.pts.some(p => Math.abs(p.x - e.pos.x) < 0.72 && Math.abs(p.z - e.pos.z) < 0.72));
        const mult = f && f.owner && f.owner.team === e.team && f.owner !== e ? 0.5 : 1;
        e.fireAcc += 34 * dt * mult;
        if (e.fireAcc >= 4) { const n = Math.floor(e.fireAcc); e.fireAcc -= n; damage(e, n, 'legs', f && f.owner, { id: 'fire', name: f && f.owner && f.owner.team === 'T' ? 'Molotov' : 'Incendiary', pen: 1, kill: 300 }, { noArmor: true, fire: true, nade: true, from: f, weaponName: f && f.owner && f.owner.team === 'T' ? 'Molotov' : 'Incendiary' }); }
      }
    }
    for (let i = decoys.length - 1; i >= 0; i--) {
      const d = decoys[i];
      if (T >= d.until) { decoys.splice(i, 1); fx.billboard(d.x, d.y + 0.2, d.z, 1.2, 0.2, 0xffc080); audio.explode(d, false); continue; }
      if (T >= d.next) {
        const n = 1 + (Math.random() * 4 | 0);
        for (let k = 0; k < n; k++) setTimeout(() => { if (G && !paused) audio.shot(d.snd, d, 1); }, k * 110);
        emit(['ds', r2(d.x), r2(d.y), r2(d.z), d.snd, n]);
        d.next = T + rand(0.6, 1.8);
        noise(d.owner, 'shot', 60, d);
        d.owner.decoyAt = { x: d.x, z: d.z, t: T };
      }
    }
  }

  // ══════════════ Bomb ══════════════
  function bombMesh() {
    if (bomb.mesh) return;
    bomb.mesh = models.gun('bomb'); bomb.mesh.scale.setScalar(1.6);
    bomb.led = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.tex.soft, color: 0xff2020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    bomb.led.scale.set(0.35, 0.35, 1); bomb.led.position.set(-0.06, 0.1, -0.08); bomb.led.visible = false;
    bomb.mesh.add(bomb.led);
    scene.add(bomb.mesh);
  }
  function giveBomb(e) { bomb.state = 'carried'; bomb.carrier = e; e.bomb = true; if (bomb.mesh) bomb.mesh.visible = false; }
  function dropBomb(e, death) {
    e.bomb = false;
    if (e.slot === 5 && e.alive) selectSlot(e, bestSlot(e));
    bombMesh();
    const f = fwd(e.yaw, 0);
    bomb.state = 'dropped'; bomb.carrier = null; bomb.dropT = T; bomb.dropBy = e.id;
    bomb.x = e.pos.x + (death ? 0 : f.x * 0.6); bomb.y = e.pos.y + (death ? 0.3 : 1.2); bomb.z = e.pos.z + (death ? 0 : f.z * 0.6); bomb.vy = 0;
    bomb.vx = death ? 0 : f.x * 3.5; bomb.vz = death ? 0 : f.z * 3.5;
    bomb.mesh.visible = true; bomb.led.visible = false;
    radio(e.isPlayer && !NET.on ? 'You' : e.name, 'Bomb dropped at ' + (W.regionName(e.pos.x, e.pos.z) || 'here'), 'T');
  }
  function plantBomb(e) {
    e.bomb = false; e.planting = null;
    e.money = Math.min(ECON.max, e.money + ECON.plant); givePop(e, ECON.plant);
    bombMesh();
    bomb.state = 'planted'; bomb.carrier = null; bomb.planter = e;
    bomb.x = e.pos.x; bomb.y = e.pos.y; bomb.z = e.pos.z; bomb.site = W.cellAt(e.pos.x, e.pos.z) === 'a' ? 'A' : 'B';
    bomb.explodeAt = T + BOMB_TIME; bomb.nextBeep = T + 1; bomb.defuser = null;
    bomb.mesh.visible = true; bomb.mesh.position.set(bomb.x, bomb.y + 0.08, bomb.z); bomb.mesh.rotation.set(0, e.yaw, 0);
    R.phase = 'planted'; R.planted = true;
    selectSlot(e, bestSlot(e));
    banner('Bomb has been planted', 'warn', 3);
    emit(['pl', bomb.site]);
    audio.ui('planted');
    for (const c of ents) if (c.b && c.team === 'CT') c.b.knowBombAt = T + rand(1, 3);
    noise(e, 'plant', 20);
  }
  function updateBomb(dt) {
    if (bomb.state === 'dropped' && !NET.client) {
      bomb.vy -= GRAV * dt;
      const p = { x: bomb.x, y: bomb.y, z: bomb.z };
      const r = W.moveBody(p, (bomb.vx || 0) * dt, bomb.vy * dt, (bomb.vz || 0) * dt, 0.15, 0.12, false);
      bomb.x = p.x; bomb.y = p.y; bomb.z = p.z;
      if (r.ground) { bomb.vy = 0; bomb.vx *= 0.85; bomb.vz *= 0.85; }
      bomb.mesh.position.set(bomb.x, bomb.y + 0.06, bomb.z);
      for (const e of ents) {
        if (!e.alive || e.team !== 'T') continue;
        if (e.id === bomb.dropBy && T - bomb.dropT < 1.2) continue;
        if (Math.hypot(e.pos.x - bomb.x, e.pos.z - bomb.z) < 1 && Math.abs(e.pos.y - bomb.y) < 1.2) {
          giveBomb(e);
          if (e.isPlayer) { banner('You picked up the bomb', 'info', 2); audio.draw(null); }
          break;
        }
      }
    }
    if (bomb.state === 'planted') {
      const left = bomb.explodeAt - T;
      if (T >= bomb.nextBeep) {
        audio.beep(bomb, left < 8);
        bomb.led.visible = true; bomb.ledOff = T + 0.12;
        bomb.nextBeep = T + Math.max(0.12, 0.95 * clamp(left / BOMB_TIME, 0, 1) + 0.05);
        if (left < 1.2) bomb.nextBeep = T + 0.08;
      }
      if (bomb.ledOff && T > bomb.ledOff) bomb.led.visible = false;
      if (left <= 0 && !NET.client) {
        bomb.state = 'exploded'; bomb.mesh.visible = false;
        emit(['bx', r2(bomb.x), r2(bomb.y), r2(bomb.z)]);
        explosion(bomb.x, bomb.y + 0.5, bomb.z, null, 500, 32, 'Bomb');
        fx.billboard(bomb.x, bomb.y + 4, bomb.z, 30, 1.2, 0xffb060);
        if (R.phase !== 'over') endRound('T', 'bomb');
      }
    }
  }
  // Plant / defuse progress (players and bots)
  function updatePlantDefuse(e, wantPlant, wantDefuse) {
    if (e.planting) {
      const ok = wantPlant && e.alive && e.bomb && e.onGround && (e.net || hSpeed(e) < 0.6) && 'ab'.includes(W.cellAt(e.pos.x, e.pos.z)) && R.phase === 'live';
      if (!ok) e.planting = null;
      else {
        const k = (T - e.planting.t0) / PLANT_TIME;
        if (k >= (e.planting.beeps + 1) / 7) { e.planting.beeps++; audio.plantBeep(e.isPlayer ? null : e.pos, e.planting.beeps); }
        if (k >= 1) plantBomb(e);
      }
    } else if (wantPlant && e.bomb && e.onGround && 'ab'.includes(W.cellAt(e.pos.x, e.pos.z)) && R.phase === 'live') {
      e.planting = { t0: T, beeps: 0 }; e.vel.x = e.vel.z = 0;
      if (e.slot !== 5) { e.lastSlot = e.slot; e.slot = 5; if (e.isPlayer) vmState.drawT = T - 1; }
    }
    if (e.defusing) {
      const ok = wantDefuse && e.alive && bomb.state === 'planted' && Math.hypot(e.pos.x - bomb.x, e.pos.z - bomb.z) < 1.9 && Math.abs(e.pos.y - bomb.y) < 1.5;
      if (!ok) { e.defusing = null; if (bomb.defuser === e) bomb.defuser = null; }
      else {
        if (T > (e.defusing.tick || 0)) { audio.defuseTick(e.isPlayer ? null : e.pos); e.defusing.tick = T + 0.5; noise(e, 'defuse', 16); }
        if (T - e.defusing.t0 >= e.defusing.len) {
          bomb.state = 'defused'; bomb.led.visible = false; bomb.defuser = null; e.defusing = null;
          e.money = Math.min(ECON.max, e.money + ECON.defuse_); givePop(e, ECON.defuse_);
          R.defuser = e;
          endRound('CT', 'defuse');
        }
      }
    } else if (wantDefuse && e.team === 'CT' && bomb.state === 'planted' && !bomb.defuser && Math.hypot(e.pos.x - bomb.x, e.pos.z - bomb.z) < 1.9 && Math.abs(e.pos.y - bomb.y) < 1.5) {
      e.defusing = { t0: T, len: e.kit ? KIT_TIME : DEFUSE_TIME, tick: 0 }; bomb.defuser = e; e.vel.x = e.vel.z = 0;
      if (e.isPlayer) audio.draw(null);
    }
  }

  // ══════════════ Buying ══════════════
  const inBuyZone = e => W.cellAt(e.pos.x, e.pos.z) === (e.team === 'T' ? 't' : 's');
  const canBuyNow = e => !!(R && e.alive && (R.phase === 'freeze' || (R.phase === 'live' && T < R.t0 + BUY_TIME)) && inBuyZone(e));
  function priceOf(e, id) {
    if (id === 'helmet') return e.armor >= 100 && !e.helmet ? 350 : GEAR.helmet.price;
    return (WD[id] || NADES[id] || GEAR[id]).price;
  }
  function buyCheck(e, id) {
    if (!BUYABLE.has(id)) return 'Unknown item';
    const d = WD[id] || NADES[id] || GEAR[id];
    if (!d) return 'Unknown item';
    if (d.team && d.team !== e.team) return 'Not for your side';
    if (!canBuyNow(e)) return R && R.phase === 'live' && T >= R.t0 + BUY_TIME ? 'Buy time is over' : 'Go back to your spawn to buy';
    const p = priceOf(e, id);
    if (e.money < p) return 'Not enough money';
    if (WD[id]) {
      if (id === 'zeus') { if (e.zeus) return 'You have one'; }
      else if ((d.slot === 1 && e.prim && e.prim.def.id === id) || (d.slot === 2 && e.sec && e.sec.def.id === id)) return 'You have one';
    } else if (NADES[id]) {
      if (e.nades.filter(n => n === id).length >= d.max) return 'You can\'t carry more';
      if (e.nades.length >= 4) return 'Grenade slots full (4)';
    } else if (id === 'kevlar' && e.armor >= 100) return 'Armour is full';
    else if (id === 'helmet' && e.helmet && e.armor >= 100) return 'You have it';
    else if (id === 'kit' && e.kit) return 'You have one';
    return '';
  }
  function tryBuy(e, id) {
    if (buyCheck(e, id)) { if (e.isPlayer) audio.ui('deny'); return false; }
    e.money -= priceOf(e, id);
    if (WD[id]) {
      const d = WD[id];
      if (id === 'zeus') e.zeus = inst('zeus');
      else {
        const old = d.slot === 1 ? e.prim : e.sec;
        if (old) dropItem(e, old, false);
        if (d.slot === 1) e.prim = inst(id); else e.sec = inst(id);
        e.slot = 0; selectSlot(e, d.slot);
        if (e.net) { const g = d.slot === 1 ? e.prim : e.sec; emit(['gv', e.id, d.slot, id, g.ammo, g.reserve]); }
      }
    } else if (NADES[id]) e.nades.push(id);
    else if (id === 'kevlar') e.armor = 100;
    else if (id === 'helmet') { e.armor = 100; e.helmet = true; }
    else if (id === 'kit') e.kit = true;
    if (e.isPlayer) { audio.ui('buy'); renderBuy(); }
    return true;
  }
  function botBuy(e) {
    const P = e.b.prof, team = e.team;
    const pistolRound = G.round === 1 || G.round === HALF + 1;
    const mates = ents.filter(x => x.team === team && !x.isPlayer);
    const avg = mates.reduce((s, x) => s + x.money, 0) / (mates.length || 1);
    const b = id => tryBuy(e, id);
    const util = keep => {
      const list = team === 'T' ? ['smoke', 'flash', 'molotov', 'flash', 'he'] : ['smoke', 'incendiary', 'flash', 'he', 'flash'];
      for (const id of list) if (e.money - priceOf(e, id) >= keep && Math.random() < 0.35 + P.util * 0.6) b(id);
    };
    if (pistolRound && !G.ot) {
      const r = Math.random();
      if (r < 0.45) b('kevlar'); else if (r < 0.7) { b('flash'); b('smoke'); } else if (r < 0.85) b('deagle'); else if (team === 'CT') b('kit');
      return;
    }
    const rifle = team === 'T' ? 'ak' : 'm4', cheap = team === 'T' ? 'galil' : 'famas';
    const hasRifle = e.prim && (e.prim.def.cat === 'rifle' || e.prim.def.cat === 'sniper');
    const lastChance = G.score[other(team)] === TO_WIN - 1 || G.round === HALF;
    const eco = !hasRifle && avg < 3300 && e.money < 3700 && G.ls[team] < 3 && !lastChance && !G.ot;
    if (eco) { if (e.money > 2600 && Math.random() < 0.5) b('deagle'); return; }
    if (!hasRifle) {
      if (e.b.awper && e.money >= WD.awp.price + 1000) b('awp');
      else if (e.money >= WD[rifle].price + 650) b(rifle);
      else if (e.money >= WD[cheap].price + 650) b(cheap);
      else if (e.money >= 1900) b(Math.random() < 0.6 ? 'smg' : 'shotgun');
      else if (e.money >= 1300) b('smg');
    }
    if (e.money >= 1000) b('helmet'); else if (e.money >= 650) b('kevlar');
    if (team === 'CT' && e.money >= 600 && Math.random() < 0.75) b('kit');
    util(G.ot ? 0 : 100);
    if (e.money > 1500 && e.sec && e.sec.def.id !== 'deagle' && Math.random() < 0.3) b('deagle');
  }

  // ══════════════ Bots ══════════════
  function newBrain(prof) {
    return { prof, goal: null, look: null, path: null, pi: 0, pathGoal: null, repathAt: 0, nextSee: 0, target: null, visible: false, reactAt: 0, errY: 0, errP: 0,
      lastSeen: null, heard: null, hurtBy: null, hurtT: -9, burst: 0, pauseUntil: 0, strafe: 1, strafeAt: 0, aimPart: 'chest', aimPartAt: 0,
      throwQ: [], throwing: null, lastPos: null, holdStill: 0, stopRoll: false, stopRollAt: 0, stuckT: 0, detour: null, role: null, route: null, post: null, scanT: 0, scanOff: 0, crouchUntil: 0, used: {}, awper: false, tap: 0 };
  }
  function canSee(e, o) {
    const ex = e.pos.x, ey = e.pos.y + eyeH(e), ez = e.pos.z;
    for (const h of [1.6 - 0.5 * o.crouch, 1.15 - 0.45 * o.crouch, 0.45]) {
      const ty = o.pos.y + h;
      if (W.los(ex, ey, ez, o.pos.x, ty, o.pos.z) && !smokeBlocks(ex, ey, ez, o.pos.x, ty, o.pos.z)) return true;
    }
    return false;
  }
  function perceive(e) {
    const b = e.b, P = b.prof;
    b.visible = false;
    if (T < e.flashUntil - e.flashDur * 0.18 && e.flashStr > 0.3) { b.blind = true; return; }
    b.blind = false;
    let best = null, bs = 1e9;
    for (const o of ents) {
      if (!o.alive || o.team === e.team) continue;
      const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z, d = Math.hypot(dx, dz);
      if (d > 115) continue;
      const ang = Math.abs(angDiff(yawTo(dx, dz), e.yaw));
      const aware = (b.hurtBy === o && T - b.hurtT < 1.6) || d < 2.2;
      if (!aware && ang > P.fov * DEG / 2) continue;
      if (!canSee(e, o)) continue;
      const s = d * (o === b.target ? 0.55 : 1) * (1 + ang * 0.8);
      if (s < bs) { bs = s; best = o; }
    }
    if (!best) return;
    const dx = best.pos.x - e.pos.x, dz = best.pos.z - e.pos.z, d = Math.hypot(dx, dz);
    if (best !== b.target || !b.lastSeen || T - b.lastSeen.t > 0.7) {
      let rt = P.react * rand(0.85, 1.3);
      const off = Math.abs(angDiff(yawTo(dx, dz), e.yaw));
      if (off < 12 * DEG) rt *= 0.75; else if (off > 70 * DEG) rt += 0.08;
      if (T - e.flashUntil < 0.6) rt += 0.25;
      b.reactAt = T + rt;
      const err = P.aim * DEG * (1 + d / 45);
      b.errY = randn() * err; b.errP = randn() * err * 0.6 + err * 0.3;
      if (best !== b.target) b.burst = 0;
      if (!intel[e.team].has(best.id) || T - intel[e.team].get(best.id).t > 6) callout(e, best);
    }
    b.target = best; b.visible = true;
    b.lastSeen = { x: best.pos.x, y: best.pos.y, z: best.pos.z, t: T };
    best.spottedUntil = T + 0.7;
    intel[e.team].set(best.id, { x: best.pos.x, z: best.pos.z, t: T, site: siteSide(best.pos.x, best.pos.z) });
  }
  let lastCallout = { T: 0, CT: 0 };
  function callout(e, o) {
    if (!player || (!NET.host && e.team !== player.team) || T - lastCallout[e.team] < 3) return;
    lastCallout[e.team] = T;
    const where = W.regionName(o.pos.x, o.pos.z);
    radio(e.name, `Enemy spotted${where ? ', ' + where : ''}`, e.team);
  }
  function turnToward(e, yaw, pitch, rate, dt) {
    const dy = angDiff(yaw, e.yaw), dp = pitch - e.pitch, step = rate * dt;
    const n = Math.hypot(dy, dp);
    if (n <= step) { e.yaw += dy; e.pitch = pitch; }
    else { e.yaw += dy / n * step; e.pitch += dp / n * step; }
    e.yaw = angDiff(e.yaw, 0);
    e.pitch = clamp(e.pitch, -1.5, 1.5);
  }
  function lookAtPt(e, x, y, z, rate, dt) {
    const ey = eyePos(e), dx = x - ey.x, dz = z - ey.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    turnToward(e, yawTo(dx, dz), Math.atan2(y - ey.y, Math.hypot(dx, dz)), rate, dt);
  }
  const fireCost = k => fireGrid[k] ? 40 : 0;
  function followPath(e, gx, gz) {
    const b = e.b;
    if (b.detour) {
      if (T > b.detour.until || dist2(e.pos.x, e.pos.z, b.detour.x, b.detour.z) < 0.6) b.detour = null;
      else return { x: b.detour.x - e.pos.x, z: b.detour.z - e.pos.z, arrived: false };
    }
    const moved = b.pathGoal ? dist2(b.pathGoal.x, b.pathGoal.z, gx, gz) : 99;
    if (!b.path || (moved > 1.5 && T > b.repathAt - 3.5) || T > b.repathAt) {
      b.path = W.findPath(e.pos.x, e.pos.z, gx, gz, fires.length ? fireCost : null) || [];
      b.pi = 0; b.pathGoal = { x: gx, z: gz }; b.repathAt = T + 4 + Math.random() * 2;
    }
    const path = b.path;
    while (b.pi < path.length && dist2(e.pos.x, e.pos.z, path[b.pi].x, path[b.pi].z) < (b.pi === path.length - 1 ? 0.45 : 0.9)) b.pi++;
    if (b.pi >= path.length) return { x: 0, z: 0, arrived: true };
    const p = path[b.pi];
    return { x: p.x - e.pos.x, z: p.z - e.pos.z, arrived: false, next: p };
  }
  function solveThrow(e, type, tx, ty, tz) {
    const key = type + '|' + Math.round(e.pos.x) + ',' + Math.round(e.pos.z) + '|' + Math.round(tx) + ',' + Math.round(tz);
    if (throwCache.has(key)) return throwCache.get(key);
    const eye = eyePos(e), dx = tx - eye.x, dz = tz - eye.z, d = Math.hypot(dx, dz), yaw = yawTo(dx, dz), h = ty - eye.y;
    const tol = type === 'flash' ? 6 : type === 'he' ? 3.5 : 2.6;
    let best = null, bd = tol;
    const test = (power, pitch) => {
      const dir = fwd(yaw, pitch), v = 18.5 * (power * 0.7 + 0.3);
      const r = simulateNade(type, eye.x + dir.x * 0.35, eye.y + dir.y * 0.35 - 0.06, eye.z + dir.z * 0.35, dir.x * v, dir.y * v, dir.z * v);
      if (!r) return;
      let m = Math.hypot(r.x - tx, r.z - tz);
      if (type === 'flash') m = Math.hypot(r.x - tx, r.z - tz) + (r.y < 1 ? 2 : 0);
      if (m < bd) { bd = m; best = { yaw, pitch, power }; }
    };
    for (const power of [1, 0.55, 0.25]) {
      const v = 18.5 * (power * 0.7 + 0.3), g = NADE_G, disc = v ** 4 - g * (g * d * d + 2 * h * v * v);
      if (disc < 0) continue;
      const lo = Math.atan((v * v - Math.sqrt(disc)) / (g * d)), hi = Math.atan((v * v + Math.sqrt(disc)) / (g * d));
      for (const p of type === 'flash' ? [hi, lo] : [lo, hi]) { test(power, p); if (best && bd < tol * 0.5) break; }
    }
    if (!best) for (let p = -0.1; p < 1.2 && !(best && bd < tol * 0.6); p += 0.09) for (const power of [1, 0.55]) test(power, p);
    throwCache.set(key, best);
    return best;
  }
  const throwCache = new Map();
  function queueThrow(e, type, spot, delay) {
    if (!e.nades.includes(type) || e.b.used[type + spot.x]) return;
    e.b.used[type + spot.x] = true;
    e.b.throwQ.push({ type, x: spot.x, y: 0.2, z: spot.z, at: T + (delay || 0) });
  }
  function hasNade(e, ...types) { return types.find(t => e.nades.includes(t)); }

  // Team plans for the round
  function makePlan() {
    const tBots = ents.filter(e => e.team === 'T' && e.b), ctBots = ents.filter(e => e.team === 'CT' && e.b);
    const site = Math.random() < 0.5 ? 'A' : 'B';
    const main = site === 'A' ? (Math.random() < 0.6 ? 'long' : 'short') : (Math.random() < 0.6 ? 'tunnels' : 'window');
    const alt = { long: 'short', short: 'long', tunnels: 'window', window: 'tunnels' }[main];
    const split = Math.random() < 0.35;
    shuffle(tBots).forEach((e, i) => { e.b.route = split && i % 3 === 2 ? alt : main; e.b.slotI = i; e.b.lurk = false; e.b.post = null; });
    if (tBots.length >= 4 && Math.random() < 0.25) { const l = tBots[tBots.length - 1]; l.b.lurk = true; }
    const roles = ctBots.length >= 5 ? ['A', 'A', 'B', 'B', 'M'] : ctBots.length === 4 ? pick([['A', 'A', 'B', 'M'], ['A', 'B', 'B', 'M'], ['A', 'A', 'B', 'B']]) : ['A', 'B', 'M', 'A'].slice(0, ctBots.length);
    const used = { A: 0, B: 0, M: 0 };
    shuffle(ctBots).forEach((e, i) => {
      const r = roles[i] || 'M', k = used[r]++;
      e.b.role = r;
      e.b.post = r === 'M' ? W.SPOTS.midHold[k % 2] : W.SPOTS[r].hold[k % W.SPOTS[r].hold.length];
      e.b.anchor = k === 0 && r !== 'M';
    });
    return { T: { site, main, phase: 'gather', exec: 0, rush: Math.random() < 0.12, said: false }, CT: { rotate: null, rotT: 0, retake: null }, next: 0 };
  }
  function planUpdate() {
    const P = R.plan;
    if (!P || T < P.next) return;
    P.next = T + 0.4;
    const left = R.endAt - T, live = T - R.liveAt;
    const tBots = ents.filter(e => e.team === 'T' && e.b && e.alive);
    // A player carrying the bomb leads: the bots go where you're heading
    const hb = bomb.carrier && isHuman(bomb.carrier) && bomb.carrier.alive ? bomb.carrier : null;
    if (hb && P.T.phase === 'gather' && live > 4) {
      const reg = W.regionName(hb.pos.x, hb.pos.z);
      const route = { 'Long A': 'long', 'Long Doors': 'long', 'Outside Long': 'long', 'Catwalk': 'short', 'Top Mid': 'short', 'A Site': 'long',
        'B Tunnels': 'tunnels', 'Upper Tunnels': 'tunnels', 'Lower Tunnel': 'tunnels', 'B Window': 'window', 'B Site': 'tunnels', 'Mid Doors': null, 'Mid': null }[reg];
      if (route) { const site = W.SPOTS.routes[route].site; if (site !== P.T.site) { P.T.site = site; P.T.main = route; for (const e of tBots) e.b.route = route; radio(tBots[0] ? tBots[0].name : '', `Following you to ${site}`, 'T'); } }
    }
    if (P.T.phase === 'gather') {
      let n = 0, there = 0;
      for (const e of tBots) { if (e.b.lurk) continue; n++; const s = W.SPOTS.routes[e.b.route].stage; if (dist2(e.pos.x, e.pos.z, s.x, s.z) < 8) there++; }
      const contact = tBots.some(e => e.b.visible);
      const playerAtSite = ents.some(x => isHuman(x) && x.team === 'T' && x.alive && siteSide(x.pos.x, x.pos.z) === P.T.site);
      if ((P.T.rush && live > 2) || (n && there >= Math.ceil(n * 0.75) && live > 12) || left < 62 || (contact && live > 10) || playerAtSite) {
        P.T.phase = 'execute'; P.T.exec = T;
        for (const [i, e] of tBots.entries()) {
          const r = W.SPOTS.routes[e.b.route];
          if (Math.random() < e.b.prof.util) {
            if (e.nades.includes('smoke')) queueThrow(e, 'smoke', r.smoke, i * 0.3);
            if (e.nades.includes('molotov')) queueThrow(e, 'molotov', r.molly, 0.8 + i * 0.3);
            if (e.nades.includes('flash')) queueThrow(e, 'flash', r.flash, 1.6 + i * 0.5);
          }
        }
        if (tBots.length) radio(tBots[0].name, `Go go go! Hitting ${P.T.site} through ${{ long: 'Long', short: 'Catwalk', tunnels: 'Tunnels', window: 'Window' }[P.T.main]}`, 'T');
      }
    }
    // CT rotations from what the team sees and hears
    const ctBots = ents.filter(e => e.team === 'CT' && e.b && e.alive);
    if (!R.planted) {
      const seen = { A: 0, B: 0 };
      for (const [, v] of intel.CT) if (T - v.t < 4 && v.site) seen[v.site]++;
      for (const e of ctBots) if (e.b.stepHeard && T - e.b.stepHeard.t < 2.5) seen[e.b.stepHeard.site] += 0.5;
      const hot = seen.A >= 2 ? 'A' : seen.B >= 2 ? 'B' : null;
      if (hot && P.CT.rotate !== hot) {
        P.CT.rotate = hot; P.CT.rotT = T;
        if (ctBots.length) radio(ctBots[0].name, `They're hitting ${hot}! Rotating`, 'CT');
        for (const e of ctBots) {
          if (e.b.role !== hot) continue;
          const u = W.SPOTS.ctUtil[hot];
          if (Math.random() < e.b.prof.util) {
            const s = u.reduce((a, c) => dist2(e.pos.x, e.pos.z, c.from.x, c.from.z) < dist2(e.pos.x, e.pos.z, a.from.x, a.from.z) ? c : a);
            const t = hasNade(e, 'incendiary', 'molotov', 'he', 'smoke');
            if (t) queueThrow(e, t, s.to, rand(0, 0.6));
          }
        }
      }
    } else if (!P.CT.retake) {
      P.CT.retake = { site: bomb.site, go: false, at: T };
    }
    if (P.CT.retake && !P.CT.retake.go) {
      const st = W.SPOTS[P.CT.retake.site].retake;
      const ready = ctBots.every(e => dist2(e.pos.x, e.pos.z, st.x, st.z) < 10 || siteSide(e.pos.x, e.pos.z) === P.CT.retake.site);
      if (ready || bomb.explodeAt - T < 26 || aliveOf('T').length === 0) {
        P.CT.retake.go = true;
        if (ctBots.length) radio(ctBots[0].name, `Retaking ${P.CT.retake.site}, go!`, 'CT');
        for (const e of ctBots) if (e.nades.includes('flash') && Math.random() < e.b.prof.util) queueThrow(e, 'flash', W.SPOTS[P.CT.retake.site].plant[0], rand(0, 0.8));
        // Defuser: closest one with a kit, else closest
        let best = null, bd = 1e9;
        for (const e of ctBots) { const d = dist2(e.pos.x, e.pos.z, bomb.x, bomb.z) - (e.kit ? 15 : 0); if (d < bd) { bd = d; best = e; } }
        P.CT.retake.defuser = best ? best.id : null;
      }
    }
    if (P.CT.retake && P.CT.retake.go) {
      const d = byId(P.CT.retake.defuser);
      if (!d || !d.alive) {
        let best = null, bd = 1e9;
        for (const e of ctBots) { const dd = dist2(e.pos.x, e.pos.z, bomb.x, bomb.z); if (dd < bd) { bd = dd; best = e; } }
        P.CT.retake.defuser = best ? best.id : null;
      }
    }
  }
  // Where a bot wants to be and look right now
  function objective(e) {
    const b = e.b, P = R.plan, S = W.SPOTS, left = R.endAt - T;
    b.walk = false; b.wantPlant = false; b.wantDefuse = false;
    if (e.inFire || (b.fleeUntil && T < b.fleeUntil)) {
      if (!b.flee || T > b.fleeUntil) {
        let bestK = -1, bd = 1e9;
        for (let r = 1; r <= 4 && bestK < 0; r++) for (let a = 0; a < 12; a++) {
          const x = e.pos.x + Math.cos(a / 12 * TAU) * r * 1.6, z = e.pos.z + Math.sin(a / 12 * TAU) * r * 1.6, k = W.nIdx(x, z);
          if (k < 0 || !W.walkable(x, z) || fireGrid[k]) continue;
          const d = r; if (d < bd) { bd = d; bestK = k; }
        }
        b.flee = bestK >= 0 ? W.nodePos(bestK) : null; b.fleeUntil = T + 1.2;
      }
      if (b.flee) { b.goal = b.flee; return; }
    }
    if (e.team === 'T') {
      if (bomb.state === 'planted') {
        if (!b.post || b.post.site !== bomb.site) { const k = (b.slotI || 0) % 4; b.post = { site: bomb.site, ...S[bomb.site].post[k] }; }
        b.goal = b.post; b.look = { x: bomb.x, y: 1, z: bomb.z };
        if (b.defuseHeard && T - b.defuseHeard < 1.5) {
          const t = hasNade(e, 'molotov', 'he');
          if (t && !b.throwing && !b.throwQ.length) queueThrow(e, t, { x: bomb.x, z: bomb.z }, 0);
          else b.goal = { x: bomb.x, z: bomb.z };
        }
        return;
      }
      if (bomb.state === 'dropped') {
        const ts = aliveOf('T').filter(x => x.b);
        let near = null, nd = 1e9;
        for (const x of ts) { const d = dist2(x.pos.x, x.pos.z, bomb.x, bomb.z); if (d < nd) { nd = d; near = x; } }
        if (near === e && !(player.team === 'T' && player.alive && dist2(player.pos.x, player.pos.z, bomb.x, bomb.z) < nd - 5)) { b.goal = { x: bomb.x, z: bomb.z }; b.look = null; return; }
      }
      const route = S.routes[b.route || 'long'];
      const site = S[route.site];
      if (e.bomb) {
        if (P.T.phase === 'execute' || left < 35) {
          if (T - P.T.exec < 1.5 && P.T.phase === 'execute') { b.goal = route.stage; b.look = { x: route.stage.lx, y: 1.6, z: route.stage.lz }; return; }
          if (!b.plantSpot || b.plantSpot.site !== route.site) b.plantSpot = { site: route.site, ...pick(site.plant) };
          b.goal = b.plantSpot; b.look = null;
          if ('ab'.includes(W.cellAt(e.pos.x, e.pos.z)) && dist2(e.pos.x, e.pos.z, b.plantSpot.x, b.plantSpot.z) < 2.2 && !b.visible) b.wantPlant = true;
          return;
        }
        b.goal = route.stage; b.look = { x: route.stage.lx, y: 1.6, z: route.stage.lz }; return;
      }
      if (b.lurk && P.T.phase !== 'execute') { b.goal = S.midLurk; b.look = { x: S.midLurk.lx, y: 1.6, z: S.midLurk.lz }; b.walk = true; return; }
      if (P.T.phase === 'gather' && left > 35) {
        const off = ((b.slotI || 0) - 2) * 1.2;
        b.goal = { x: route.stage.x + off * 0.5, z: route.stage.z + Math.abs(off) }; b.look = { x: route.stage.lx, y: 1.6, z: route.stage.lz };
        if (dist2(e.pos.x, e.pos.z, route.stage.x, route.stage.z) < 14) b.walk = true;
        return;
      }
      // Executing: through the entry, then take a spot in the site
      if (!b.entered && dist2(e.pos.x, e.pos.z, route.entry.x, route.entry.z) < 3) b.entered = true;
      if (!b.entered && T - P.T.exec < 25) { b.goal = route.entry; b.look = null; return; }
      if (!b.post || b.post.site !== route.site) b.post = { site: route.site, ...S[route.site].post[(b.slotI || 0) % 4] };
      b.goal = b.post; b.look = { x: b.post.lx, y: 1.4, z: b.post.lz };
      return;
    }
    // CT
    if (bomb.state === 'planted' && b.knowBombAt && T > b.knowBombAt) {
      const rt = P.CT.retake;
      const site = S[bomb.site];
      if (!rt || !rt.go) { b.goal = site.retake; b.look = { x: bomb.x, y: 1, z: bomb.z }; return; }
      if (rt.defuser === e.id) {
        b.goal = { x: bomb.x, z: bomb.z }; b.look = { x: bomb.x, y: 0.2, z: bomb.z };
        const others = aliveOf('T').length;
        if (dist2(e.pos.x, e.pos.z, bomb.x, bomb.z) < 1.5 && (!b.visible || (bomb.explodeAt - T) < (e.kit ? 6 : 11) || others === 0)) b.wantDefuse = true;
        return;
      }
      if (!b.post || b.post.site !== bomb.site) b.post = { site: bomb.site, ...site.hold[(e.id) % site.hold.length] };
      b.goal = b.post; b.look = { x: b.post.lx, y: 1.5, z: b.post.lz };
      return;
    }
    if (bomb.state === 'planted') { b.goal = S[bomb.site === 'A' ? 'A' : 'B'].retake; return; }
    // Hunt the last ones late in the round
    if (aliveOf('T').length <= 1 && left < 50 && intel.CT.size) {
      let last = null; for (const [, v] of intel.CT) if (!last || v.t > last.t) last = v;
      if (last && T - last.t < 15) { b.goal = { x: last.x, z: last.z }; b.look = null; return; }
    }
    const rot = P.CT.rotate;
    if (rot && b.role !== rot && !(b.anchor && T - P.CT.rotT < 30 && Math.random() < 0)) {
      if (!(b.anchor && b.role !== 'M')) {
        if (!b.rotPost || b.rotPost.site !== rot) b.rotPost = { site: rot, ...S[rot].hold[2 + (e.id % 2)] };
        b.goal = b.rotPost; b.look = { x: b.rotPost.lx, y: 1.5, z: b.rotPost.lz }; return;
      }
    }
    b.goal = b.post; b.look = { x: b.post.lx, y: 1.5, z: b.post.lz };
    if (dist2(e.pos.x, e.pos.z, b.post.x, b.post.z) < 10) b.walk = true;
  }
  function botUpdate(e, dt) {
    const b = e.b, P = b.prof;
    if (!e.alive) return;
    if (T >= b.nextSee) { b.nextSee = T + 0.08 + Math.random() * 0.05; perceive(e); }
    const frozen = R.phase === 'freeze' || R.phase === 'over' && false;
    let mx = 0, mz = 0, speed = maxSpeed(e), firing = false;
    const tgt = b.target && b.target.alive ? b.target : null;
    if (!tgt) b.target = null;
    if (R.phase === 'freeze') { botPhysics(e, dt, 0, 0); return; }
    objective(e);
    // Weapon upkeep
    const w = cur(e);
    if ((e.slot === 1 || e.slot === 2 || e.slot === 3) && !b.throwing) {
      if (e.prim && e.prim.ammo + e.prim.reserve > 0 && e.slot !== 1 && !(tgt && b.visible && e.slot === 2 && e.prim.ammo === 0)) selectSlot(e, 1);
      else if ((!e.prim || e.prim.ammo + e.prim.reserve === 0) && e.sec && e.sec.ammo + e.sec.reserve > 0 && e.slot !== 2) selectSlot(e, 2);
      else if (e.slot === 1 && e.prim.ammo === 0 && tgt && b.visible && e.sec && e.sec.ammo > 0 && dist2(e.pos.x, e.pos.z, tgt.pos.x, tgt.pos.z) < 15) selectSlot(e, 2);
    }
    const ww = cur(e);
    if (ww && ww.def.mag && !ww.def.zeus && !e.reloadUntil) {
      if (ww.ammo === 0 && ww.reserve > 0) startReload(e);
      else if (ww.ammo < ww.def.mag * 0.45 && ww.reserve > 0 && (!b.lastSeen || T - b.lastSeen.t > 2.5)) startReload(e);
    }
    // Throwing a grenade
    if (b.throwing) {
      const th = b.throwing;
      if (tgt && b.visible && dist2(e.pos.x, e.pos.z, tgt.pos.x, tgt.pos.z) < 18) { b.throwing = null; selectSlot(e, bestSlot(e)); }
      else {
        turnToward(e, th.yaw, th.pitch, 9, dt);
        if (Math.abs(angDiff(th.yaw, e.yaw)) < 0.02 && Math.abs(th.pitch - e.pitch) < 0.02 && T - th.t > 0.5 && T >= e.switchUntil) {
          throwNade(e, th.power, th.yaw, th.pitch); b.throwing = null;
        }
        botPhysics(e, dt, 0, 0);
        return;
      }
    } else if (b.throwQ.length && T >= b.throwQ[0].at && !(tgt && b.visible)) {
      // Throw once in range (they walk toward the site meanwhile); give up after a while
      const q = b.throwQ[0], d = dist2(e.pos.x, e.pos.z, q.x, q.z);
      if (!e.nades.includes(q.type) || T > q.at + 25) b.throwQ.shift();
      else if (d < 34 && T > (q.tryAt || 0)) {
        const sol = solveThrow(e, q.type, q.x, q.y, q.z);
        if (sol) { b.throwQ.shift(); b.throwing = { ...sol, t: T }; e.nadeI = e.nades.indexOf(q.type); e.lastSlot = e.slot; e.slot = 0; selectSlot(e, 4); }
        else q.tryAt = T + 0.7;
      }
    }
    if (tgt && b.visible) {
      firing = botCombat(e, tgt, dt);
      const d = dist2(e.pos.x, e.pos.z, tgt.pos.x, tgt.pos.z), wcur = cur(e);
      if (wcur && wcur.def.melee) { const v = followPath(e, tgt.pos.x, tgt.pos.z); mx = v.x; mz = v.z; }
      else if (firing && T < b.holdStill) { mx = mz = 0; }
      else if (wcur && wcur.def.cat === 'sniper') { mx = mz = 0; }
      else {
        if (T > b.strafeAt) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeAt = T + rand(0.25, 0.75); b.strafeOn = Math.random() < P.strafe; }
        if (b.strafeOn) { const yaw = yawTo(tgt.pos.x - e.pos.x, tgt.pos.z - e.pos.z); mx = Math.cos(yaw) * b.strafe; mz = -Math.sin(yaw) * b.strafe; speed *= 0.6; }
        else if (b.goal && !firing && d > 12) { const v = followPath(e, b.goal.x, b.goal.z); mx = v.x; mz = v.z; speed *= 0.5; }
      }
      if (firing && d > 10 && Math.random() < P.crouch * dt * 4) b.crouchUntil = T + rand(0.4, 1);
    } else {
      // No one in sight: hold the last angle, turn to noises, or carry on with the plan
      let look = null;
      if (b.blind && b.lastSeen && T - b.lastSeen.t < 1) { if (Math.random() < 0.4 && cur(e) && cur(e).ammo > 0) shoot(e, false); }
      if (b.hurtBy && T - b.hurtT < 1.4 && b.hurtBy.alive) look = { x: b.hurtBy.pos.x, y: b.hurtBy.pos.y + 1.4, z: b.hurtBy.pos.z };
      else if (b.lastSeen && T - b.lastSeen.t < 2.2) look = { x: b.lastSeen.x, y: b.lastSeen.y + 1.5, z: b.lastSeen.z };
      else if (b.heard && T - b.heard.t < 2.2) look = b.heard;
      let arrived = false;
      if (b.goal) {
        const v = followPath(e, b.goal.x, b.goal.z);
        arrived = v.arrived; mx = v.x; mz = v.z;
        if (!look) {
          if (arrived || dist2(e.pos.x, e.pos.z, b.goal.x, b.goal.z) < 5) {
            if (b.look) {
              if (T > b.scanT) { b.scanT = T + rand(1.2, 3); b.scanOff = rand(-0.25, 0.25); }
              const yaw = yawTo(b.look.x - e.pos.x, b.look.z - e.pos.z) + b.scanOff * 0.5;
              const dd = Math.hypot(b.look.x - e.pos.x, b.look.z - e.pos.z);
              turnToward(e, yaw, Math.atan2((b.look.y != null ? b.look.y : 1.5) - eyeH(e) - e.pos.y, Math.max(1, dd)), P.turn * 0.6, dt);
            }
          } else if (v.next) {
            const dx = v.next.x - e.pos.x, dz = v.next.z - e.pos.z;
            if (Math.hypot(dx, dz) > 0.3) turnToward(e, yawTo(dx, dz), 0, P.turn * 0.55, dt);
          }
        }
      }
      if (look) lookAtPt(e, look.x, look.y, look.z, P.turn * 0.8, dt);
      if (b.walk) speed *= 0.52;
    }
    // Plant / defuse
    if (b.wantPlant || b.wantDefuse) { mx = mz = 0; }
    updatePlantDefuse(e, b.wantPlant && hSpeed(e) < 0.6, b.wantDefuse && hSpeed(e) < 0.6);
    if (e.planting || e.defusing) mx = mz = 0;
    // Stuck?
    const L = Math.hypot(mx, mz);
    if (L > 0.01) { mx /= L; mz /= L; } else mx = mz = 0;
    if (L > 0.3 && !firing) {
      if (!b.lastPos || T - b.lastPos.t > 0.9) {
        if (b.lastPos && dist2(e.pos.x, e.pos.z, b.lastPos.x, b.lastPos.z) < 0.35) {
          b.path = null;
          const a = Math.random() * TAU; const dx = e.pos.x + Math.cos(a) * 2.5, dz = e.pos.z + Math.sin(a) * 2.5;
          if (W.walkable(dx, dz)) b.detour = { x: dx, z: dz, until: T + 0.8 };
        }
        b.lastPos = { x: e.pos.x, z: e.pos.z, t: T };
      }
    } else b.lastPos = null;
    const wantC = T < b.crouchUntil ? 1 : 0;
    e.crouch += clamp(wantC - e.crouch, -dt * 7, dt * 7);
    if (e.crouch > 0.5) speed *= 0.5;
    botPhysics(e, dt, mx * speed, mz * speed);
    footsteps(e, dt);
  }
  function botCombat(e, tgt, dt) {
    const b = e.b, P = b.prof, w = cur(e);
    if (T > b.aimPartAt) { b.aimPart = Math.random() < P.hs ? 'head' : 'chest'; b.aimPartAt = T + rand(0.5, 1.3); }
    const lag = (1 - P.track) * 0.22;
    const tx = tgt.pos.x - tgt.vel.x * lag, tz = tgt.pos.z - tgt.vel.z * lag;
    const ty = tgt.pos.y + (b.aimPart === 'head' ? 1.62 - 0.5 * tgt.crouch : 1.22 - 0.45 * tgt.crouch);
    const ey = eyePos(e), dx = tx - ey.x, dz = tz - ey.z, d = Math.hypot(dx, dz);
    const yaw = yawTo(dx, dz), pitch = Math.atan2(ty - ey.y, d);
    const k = Math.exp(-dt * P.track * 3.2);
    b.errY *= k; b.errP *= k;
    if (T >= b.reactAt - P.react * 0.45) turnToward(e, yaw + b.errY, pitch + b.errP, P.turn * (T < b.reactAt ? 0.5 : 1), dt);
    if (T < b.reactAt || !w || w.nade || w.def.id === 'bomb') return false;
    if (smokes.length && smokeBlocks(ey.x, ey.y, ey.z, tgt.pos.x, ty, tgt.pos.z)) { b.visible = false; return false; }
    if (w.def.mag && w.ammo === 0) return false;
    const err = Math.hypot(angDiff(yaw, e.yaw), pitch - e.pitch);
    const tol = Math.max(0.01, Math.atan2(0.32, d));
    if (w.def.melee) { if (d < 1.9 && err < 0.4) shoot(e, d < 1.5); return true; }
    if (w.def.zeus) { if (d < 3.2 && err < tol * 2) shoot(e, false); return d < 3.2; }
    // Better bots stop moving before they shoot (counter-strafe); weaker ones run and gun
    if (T > b.stopRollAt) { b.stopRoll = Math.random() < P.stop; b.stopRollAt = T + rand(0.6, 1.2); }
    if (b.stopRoll || w.def.cat === 'sniper') { b.holdStill = T + 0.3; if (hSpeed(e) > (w.def.cat === 'smg' ? 3 : 1.5)) return true; }
    if (T < b.pauseUntil) return true;
    if (w.def.cat === 'sniper') {
      if (!e.scope && w.def.scope) { e.scope = 1; e.scopeT = T; }
      if (err < tol * 0.8 && hSpeed(e) < 1.2 && T - e.scopeT > 0.25) shoot(e, false);
      return true;
    }
    if (err > tol * 2.6 && !(d < 6 && err < 0.15)) return false;
    const auto = w.def.auto;
    const maxBurst = d > 32 ? (auto ? 2 : 1) : d > 16 ? (auto ? 4 : 2) : P.burst;
    if (!auto && T < b.tap) return true;
    if (shoot(e, false)) {
      b.burst++;
      if (!auto) b.tap = T + rand(0.12, 0.3) * (1.2 - P.spray * 0.5);
      if (b.burst >= maxBurst) { b.burst = 0; b.pauseUntil = T + rand(0.16, 0.34) * (d > 25 ? 1.4 : 1); }
    }
    return true;
  }
  function botPhysics(e, dt, vx, vz) {
    const k = Math.min(1, dt * (e.onGround ? 11 : 2));
    e.vel.x += (vx - e.vel.x) * k; e.vel.z += (vz - e.vel.z) * k;
    e.vel.y -= GRAV * dt;
    const r = W.moveBody(e.pos, e.vel.x * dt, e.vel.y * dt, e.vel.z * dt, 0.4, bodyH(e), e.onGround);
    if (r.ground) e.vel.y = 0;
    if (r.hitX) e.vel.x = 0; if (r.hitZ) e.vel.z = 0;
    e.onGround = r.ground;
  }
  function footsteps(e, dt) {
    const sp = hSpeed(e);
    if (!e.onGround || sp < 3.4) { e.stepT = 0.1; return; }
    e.stepT -= dt * sp / 5.5;
    if (e.stepT <= 0) {
      e.stepT = 0.36;
      if (!e.isPlayer || camMode !== 'fp') audio.step(e.pos, 1.4);
      else audio.step(null, 0.18);
      noise(e, 'step', 24);
    }
  }

  // ══════════════ Player ══════════════
  const keys = {}, mouse = { l: false, r: false };
  function playerUpdate(dt) {
    const e = player;
    if (!e.alive) return;
    const frozen = R.phase === 'freeze' || e.planting || e.defusing || (NET.client && e.netUse && netCanUse(e));
    // Crouch (and crouch-jump: tuck your legs in the air)
    const wantC = keys.KeyC ? 1 : 0;
    const prevC = e.crouch;
    let nc = e.crouch + clamp(wantC - e.crouch, -dt * 8, dt * 8);
    if (nc < e.crouch && W.blocked(e.pos.x, e.pos.y + 0.05, e.pos.z, 0.39, 1.8 - 0.5 * nc)) nc = e.crouch;
    e.crouch = nc;
    if (!e.onGround && e.crouch > prevC) { const lift = 0.5 * (e.crouch - prevC); if (!W.blocked(e.pos.x, e.pos.y + lift, e.pos.z, 0.39, bodyH(e))) e.pos.y += lift; }
    // Move
    let fx_ = 0, fz_ = 0;
    if (!frozen) {
      const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
      fx_ = -sy * f + cy * s; fz_ = -cy * f - sy * s;
      const L = Math.hypot(fx_, fz_); if (L > 0) { fx_ /= L; fz_ /= L; }
    }
    let ms = maxSpeed(e);
    if (keys.ShiftLeft || keys.ShiftRight) ms *= 0.52;
    if (e.crouch > 0.5) ms = maxSpeed(e) * 0.34;
    if (frozen) ms = 0;
    const v = e.vel;
    // Bunny hopping: a jump pressed up to JUMP_BUFFER s before landing goes off on the landing frame, and
    // that frame skips ground friction, so chained hops keep their speed. In the air you gain speed by
    // strafing with A/D while turning the mouse the same way (air acceleration like CS, capped wish speed).
    if (e.onGround) {
      const jump = !frozen && T < (e.jumpBuf || 0);
      if (jump) {
        e.jumpBuf = 0; v.y = 7.2; e.onGround = false; noise(e, 'step', 18);
        accelerate(v, fx_, fz_, ms, 5.5, dt);
      } else {
        const sp = Math.hypot(v.x, v.z);
        if (sp > 0) { const drop = Math.max(sp, 2) * 5.2 * dt, ns = Math.max(0, sp - drop); v.x *= ns / sp; v.z *= ns / sp; }
        accelerate(v, fx_, fz_, ms, 5.5, dt);
      }
    } else accelerate(v, fx_, fz_, Math.min(ms, AIR_WISH), AIR_ACCEL, dt, ms);
    v.y -= GRAV * dt;
    const vyBefore = v.y;
    const r = W.moveBody(e.pos, v.x * dt, v.y * dt, v.z * dt, 0.39, bodyH(e), e.onGround);
    if (r.ground && !e.onGround && vyBefore < -6) { audio.land(null); noise(e, 'step', 16); }
    if (r.ground && v.y < 0) v.y = 0;
    if (r.ceil && v.y > 0) v.y = 0;
    if (r.hitX) v.x = 0; if (r.hitZ) v.z = 0;
    e.onGround = r.ground;
    footsteps(e, dt);
    // Weapon
    const w = cur(e);
    if (e.rescopeAt && T >= e.rescopeAt) { if (w && w.def.scope && mouse.r === false && e.rescope) { e.scope = e.rescope; e.scopeT = T; } e.rescopeAt = 0; e.rescope = 0; }
    if (e.autoReloadAt && T >= e.autoReloadAt) { e.autoReloadAt = 0; startReload(e); }
    if (buyOpen() || frozen && R.phase !== 'freeze') { /* no shooting while buying or planting */ }
    else if (w && w.nade) {
      if ((mouse.l || mouse.r) && T >= e.switchUntil && R.phase !== 'freeze') { if (!e.pin) { e.pin = { t: T, l: false, r: false }; audio.pin(null); } }
      if (e.pin) {
        e.pin.l = e.pin.l || mouse.l; e.pin.r = e.pin.r || mouse.r;
        if (!mouse.l && !mouse.r && T - e.pin.t > 0.18) throwNade(e, e.pin.l && e.pin.r ? 0.55 : e.pin.l ? 1 : 0.25);
      }
    } else if (e.slot === 5) {
      // Bomb in hand: hold the mouse to plant
    } else if (mouse.l && R.phase !== 'freeze') {
      if (w && (w.def.auto || w.def.melee || !e.trigLatch)) { if (shoot(e, false)) e.trigLatch = true; }
    } else if (mouse.r && w && w.def.melee && R.phase !== 'freeze') shoot(e, true);
    if (!mouse.l) e.trigLatch = false;
    // Use: plant / defuse
    const useHeld = !!keys.KeyE || (e.slot === 5 && mouse.l);
    if (NET.client) e.netUse = useHeld;   // the host does the planting and defusing
    else updatePlantDefuse(e, useHeld && e.bomb, useHeld && e.team === 'CT');
    if (e.planting || e.defusing || (NET.client && e.netUse && netCanUse(e))) { v.x = v.z = 0; }
    if (!NET.client) autoPickup(e);
  }
  // Walk over a gun with that slot empty: pick it up
  function autoPickup(e) {
    for (const d of drops) {
      if (Math.hypot(d.x - e.pos.x, d.z - e.pos.z) > 0.9 || Math.abs(d.y - e.pos.y) > 1.2) continue;
      if (d.by === e.id && T - d.t < 1.5) continue;
      if ((d.w.def.slot === 1 && !e.prim) || (d.w.def.slot === 2 && !e.sec)) { pickUp(e, d); break; }
    }
  }
  // Online: would holding E start a plant or defuse right here? (the page stops you moving straight away)
  const netCanUse = e => (e.bomb && e.onGround && 'ab'.includes(W.cellAt(e.pos.x, e.pos.z)) && R.phase === 'live') ||
    (e.team === 'CT' && bomb.state === 'planted' && (!bomb.defuser || bomb.defuser === e) && Math.hypot(e.pos.x - bomb.x, e.pos.z - bomb.z) < 1.9 && Math.abs(e.pos.y - bomb.y) < 1.5);
  // base: the speed the acceleration scales with (in the air, the full run speed, as in CS)
  function accelerate(v, wx, wz, wishSpeed, accel, dt, base) {
    if (!wx && !wz) return;
    const curS = v.x * wx + v.z * wz, add = wishSpeed - curS;
    if (add <= 0) return;
    const as = Math.min(accel * (base || Math.max(wishSpeed, 1)) * dt, add);
    v.x += as * wx; v.z += as * wz;
  }
  function useKey() {
    const e = player;
    if (!e || !e.alive || !G) return;
    if (e.bomb && 'ab'.includes(W.cellAt(e.pos.x, e.pos.z))) return;
    if (e.team === 'CT' && bomb.state === 'planted' && Math.hypot(e.pos.x - bomb.x, e.pos.z - bomb.z) < 1.9) return;
    const d = lookDrop();
    if (d) { if (NET.client) netAct(['u', d.id]); else pickUp(e, d); }
  }
  function lookDrop() {
    const e = player, f = fwd(e.yaw, e.pitch), ey = eyePos(e);
    let best = null, bs = 0.86;
    for (const d of drops) {
      const dx = d.x - ey.x, dy = d.y - ey.y, dz = d.z - ey.z, L = Math.hypot(dx, dy, dz);
      if (L > 2.6) continue;
      const dot = (dx * f.x + dy * f.y + dz * f.z) / (L || 1);
      if (dot > bs) { bs = dot; best = d; }
    }
    return best;
  }

  // ══════════════ Rounds and the match ══════════════
  function startMatch(opts) {
    audio.init();
    for (const x of ents) if (x.model) scene.remove(x.model.s.root);
    ents = []; nextId = 1; intel = { T: new Map(), CT: new Map() };
    const side = opts.side === 'random' || !opts.side ? (Math.random() < 0.5 ? 'T' : 'CT') : opts.side;
    const names = shuffle(BOT_NAMES.slice());
    player = makeEnt(playerName(), side, true);
    ents.push(player);
    const mateP = profAt(opts.teamAt), foeP = profAt(opts.at);
    for (let i = 0; i < 4; i++) ents.push(makeEnt(names.pop(), side, false, mateP));
    for (let i = 0; i < 5; i++) ents.push(makeEnt(names.pop(), other(side), false, foeP));
    for (const t of ['T', 'CT']) { const bots = ents.filter(e => e.b && e.team === t); if (bots.length) pick(bots).b.awper = true; }
    G = { ranked: !!opts.ranked, at: opts.at, label: opts.label, round: 1, score: { T: 0, CT: 0 }, ls: { T: 0, CT: 0 }, ot: false, startT: T, over: false, history: [] };
    showGameUI();
    if (opts.ranked) RK.begin();
    startRound();
    lockPointer();
  }
  function showGameUI() {
    paused = false;
    $('menu').hidden = true; $('endBox').hidden = true; $('pauseBox').hidden = true; $('hud').hidden = false;
    feedEl.innerHTML = ''; radioEl.innerHTML = '';
  }
  function ensureModel(e) {
    const tagged = !e.isPlayer && player && e.team === player.team;
    if (e.model && e.model.team === e.team && e.model.tagged === tagged) return;
    if (e.model) scene.remove(e.model.s.root);
    const s = models.soldier(e.team, tagged ? e.name : null, '#8ff0b8');
    s.root.rotation.order = 'YXZ';
    scene.add(s.root);
    e.model = { s, team: e.team, tagged, phase: Math.random() * 6, fall: 0, fallDir: 1 };
  }
  function clearRoundStuff() {
    for (const n of nades) scene.remove(n.mesh); nades.length = 0;
    for (const s of smokes) s.cloud.remove(); smokes.length = 0;
    for (const f of fires) f.vis.remove(); fires.length = 0; fireGrid.fill(0);
    decoys.length = 0;
    for (const d of drops) scene.remove(d.mesh); drops.length = 0;
    fx.clear();
    bomb.state = 'none'; bomb.carrier = null; bomb.defuser = null; if (bomb.mesh) bomb.mesh.visible = false;
  }
  function startRound() {
    clearRoundStuff();
    const first = G.round === 1, swap = G.round === HALF + 1, ot = G.round === HALF * 2 + 1;
    if (swap || ot) {
      if (swap) {
        for (const e of ents) e.team = other(e.team);
        G.score = { T: G.score.CT, CT: G.score.T };
        banner('Switching sides', 'info', 3);
      } else { G.ot = true; banner('Overtime: one round decides it', 'warn', 3.5); }
      G.ls = { T: 0, CT: 0 };
      for (const e of ents) { e.money = swap ? ECON.start : ECON.ot; e.alive = false; }
    }
    R = { phase: 'freeze', t0: T, liveAt: T + FREEZE + (first ? 2 : 0), endAt: 0, planted: false, plan: null, winner: null, mvp: null, defuser: null };
    R.endAt = R.liveAt + ROUND_TIME;
    const sp = { T: shuffle(W.SPOTS.tSpawn.slice()), CT: shuffle(W.SPOTS.ctSpawn.slice()) };
    for (const e of ents) {
      ensureModel(e);
      const died = !e.alive || swap || ot;
      e.alive = true; e.hp = 100; e.deadAt = 0;
      if (died) { e.prim = null; e.sec = inst(e.team === 'T' ? 'glock' : 'usp'); e.nades = []; e.zeus = null; e.armor = 0; e.helmet = false; e.kit = false; }
      e.bomb = false;
      const p = sp[e.team].pop();
      e.pos.x = p.x + rand(-0.4, 0.4); e.pos.y = 0; e.pos.z = p.z + rand(-0.4, 0.4);
      e.vel.x = e.vel.y = e.vel.z = 0; e.crouch = 0; e.onGround = true;
      e.yaw = e.team === 'T' ? 0 : PI; e.pitch = 0;
      e.flashUntil = 0; e.flashStr = 0; e.planting = null; e.defusing = null; e.pin = null; e.scope = 0; e.reloadUntil = 0; e.recoilIdx = 0;
      e.punchP = e.punchY = e.kickP = e.kickY = 0; e.rk = 0; e.dmgFrom.clear(); e.fireAcc = 0; e.tagUntil = 0;
      e.slot = 0; selectSlot(e, bestSlot(e)); e.switchUntil = 0; e.nextFire = 0;
      if (e.model) { e.model.fall = 0; e.model.s.root.visible = true; if (e.model.s.tag) e.model.s.tag.visible = true; }
      if (e.b) { const keep = { prof: e.b.prof, awper: e.b.awper }; e.b = newBrain(keep.prof); e.b.awper = keep.awper; }
    }
    // The bomb goes to a random T (you included)
    giveBomb(pick(aliveOf('T')));
    if (NET.host) emit(['rs', G.round, ents.map(e => [e.id, r2(e.pos.x), r2(e.pos.y), r2(e.pos.z), r3(e.yaw)])]);
    for (const e of ents) if (e.b) botBuy(e);
    R.plan = makePlan();
    intel = { T: new Map(), CT: new Map() };
    camMode = 'fp';
    setBuy(false);
    if (!swap && !ot) banner(first ? 'Match start · buy with B' : `Round ${G.round}`, 'info', 2.2);
    if (bomb.carrier && isHuman(bomb.carrier)) radio('', 'You have the bomb. Plant it at A or B (hold E in the site).', 'T', bomb.carrier.id);
  }
  function checkRoundEnd() {
    if (!G || !R || R.phase === 'over') return;
    const tA = aliveOf('T').length, cA = aliveOf('CT').length;
    if (cA === 0) return endRound('T', 'elim');
    if (tA === 0 && bomb.state !== 'planted') return endRound('CT', 'elim');
  }
  function endRound(winner, reason) {
    if (R.phase === 'over') return;
    const loser = other(winner);
    R.phase = 'over'; R.winner = winner; R.reason = reason; R.nextAt = T + POST_TIME;
    for (const e of ents) { e.planting = null; e.defusing = null; }
    G.score[winner]++;
    // Money
    const win = { elim: ECON.elim, bomb: ECON.bomb, defuse: ECON.defuse, time: ECON.time }[reason];
    const lossAmt = ECON.loss[Math.min(G.ls[loser], 4)];
    for (const e of ents) {
      if (e.team === winner) e.money = Math.min(ECON.max, e.money + win);
      else if (!(reason === 'time' && e.team === 'T' && e.alive)) e.money = Math.min(ECON.max, e.money + lossAmt + (loser === 'T' && R.planted ? ECON.plantTeam : 0));
    }
    G.ls[winner] = Math.max(0, G.ls[winner] - 1); G.ls[loser] = Math.min(4, G.ls[loser] + 1);
    // MVP
    let mvp = null;
    if (reason === 'bomb' && bomb.planter) mvp = bomb.planter;
    else if (reason === 'defuse' && R.defuser) mvp = R.defuser;
    else for (const e of ents) if (e.team === winner && (!mvp || e.rk > mvp.rk)) mvp = e;
    if (mvp) { mvp.stats.mvp++; R.mvp = mvp; }
    emit(['re', winner, reason, mvp ? mvp.id : 0, mvp ? mvp.rk : 0]);
    G.history.push(winner === player.team ? 1 : 0);
    const text = { elim: `${TEAMNAME[winner]} win`, bomb: 'Target bombed', defuse: 'Bomb defused', time: 'Time ran out' }[reason];
    const sub = (mvp ? `MVP: ${mvp.isPlayer ? 'you' : mvp.name}` + (mvp.rk ? ` · ${mvp.rk} kill${mvp.rk === 1 ? '' : 's'}` : '') : '') +
      ` · ${player.team === winner ? 'Round won' : 'Round lost'}`;
    banner(text, winner === 'T' ? 't' : 'ct', POST_TIME - 0.3, sub);
    audio.ui(winner === player.team ? 'win' : 'lose');
  }
  function roundUpdate() {
    if (R.phase === 'freeze' && T >= R.liveAt) { R.phase = 'live'; audio.ui('start'); }
    if (R.phase === 'live' && T >= R.endAt) endRound('CT', 'time');
    if (R.phase === 'over' && T >= R.nextAt) {
      if (G.score.T >= TO_WIN || G.score.CT >= TO_WIN) return endMatch(false);
      G.round++;
      startRound();
    }
  }
  function endMatch(quit) {
    if (!G || G.over) return;
    G.over = true;
    const mine = G.score[player.team], theirs = G.score[other(player.team)], won = !quit && mine > theirs;
    let rk = '';
    if (G.ranked) rk = RK.resultHTML(RK.record(won, { kills: Math.max(0, player.stats.k), deaths: player.stats.d, hs: player.stats.hs }));
    // Online: tell everyone, then the lobby goes back to waiting for the next match
    if (G.online && NET.host) { emit(['end', quit ? 1 : 0]); hostSend(true); netSend({ t: 'b_end' }); }
    unlockPointer(); setBuy(false); $('board').hidden = true;
    if (quit) { toMenu(); return; }
    showEnd(won, mine, theirs, rk, G.ranked ? '' : G.online ? 'Online match' : `Practice against ${G.label} bots.`);
  }
  function showEnd(won, mine, theirs, rk, text) {
    $('endTitle').textContent = won ? 'Victory' : mine === theirs ? 'Draw' : 'Defeat';
    $('endTitle').className = won ? 'win' : 'loss';
    $('endScore').innerHTML = `<span class="${player.team.toLowerCase()}">${mine}</span> – <span class="${other(player.team).toLowerCase()}">${theirs}</span>`;
    const s = player.stats, hsP = s.k > 0 ? Math.round(s.hs / s.k * 100) : 0;
    $('endStats').innerHTML = `<div><b>${s.k}</b><span>Kills</span></div><div><b>${s.d}</b><span>Deaths</span></div><div><b>${s.a}</b><span>Assists</span></div><div><b>${hsP}%</b><span>Headshots</span></div><div><b>${s.mvp}</b><span>MVPs</span></div>`;
    $('endText').textContent = text;
    $('endRank').innerHTML = rk;
    $('endAgain').textContent = G.online ? 'Back to lobby' : 'Play again';
    $('endBox').hidden = false; $('hud').hidden = true;
  }
  function toMenu() {
    G = null; R = null; paused = false;
    if (NET.on) { NET.on = NET.host = NET.client = false; NET.ev = []; NET.acts = []; stopTicker(); renderRoom(); }
    for (const x of ents) if (x.model) x.model.s.root.visible = false;
    clearRoundStuff();
    $('hud').hidden = true; $('endBox').hidden = true; $('pauseBox').hidden = true; $('menu').hidden = false; $('board').hidden = true;
    setBuy(false); renderRank(); unlockPointer();
    if (vm) { vmScene.remove(vm); vm = null; vmKey = ''; }
    $('flashOv').style.opacity = 0; $('after').style.opacity = 0; $('scopeOv').hidden = true; $('smokeFog').style.opacity = 0;
  }

  // ══════════════ First-person view model ══════════════
  let vm = null, vmKey = '', vmFlash = null;
  const vmState = { kick: 0, drawT: -9, flashT: -9, swayX: 0, swayY: 0, mdx: 0, mdy: 0, bob: 0 };
  function updateVM(dt) {
    const e = player;
    const show = G && camMode === 'fp' && e.alive && !(e.scope && cur(e) && cur(e).def.scope);
    const look = show ? lookOf(e) : null, key = look ? look + e.team : '';
    if (key !== vmKey) {
      if (vm) vmScene.remove(vm);
      vm = look ? models.viewModel(look, e.team) : null; vmKey = key;
      if (vm) {
        vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.tex.star, color: 0xffd080, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        vmFlash.scale.set(0.22, 0.22, 1); vmFlash.position.copy(vm.userData.muzzle); vmFlash.visible = false;
        vm.add(vmFlash); vmScene.add(vm);
      }
    }
    if (!vm) return;
    const k = vm.userData.kind, sp = hSpeed(e);
    vmState.kick *= Math.exp(-dt * 14);
    vmState.swayX += (clamp(-vmState.mdx * 0.0005, -0.04, 0.04) - vmState.swayX) * Math.min(1, dt * 10);
    vmState.swayY += (clamp(vmState.mdy * 0.0005, -0.04, 0.04) - vmState.swayY) * Math.min(1, dt * 10);
    vmState.mdx = vmState.mdy = 0;
    if (e.onGround) vmState.bob += dt * sp * 1.6;
    const bobA = Math.min(1, sp / 6) * (e.onGround ? 1 : 0);
    let px = 0.2, py = -0.21, pz = -0.5, rx = 0, ry = 0.06, rz = 0;
    if (k === 'knife') { px = 0.22; py = -0.22; pz = -0.42; ry = 0.15; }
    if (k === 'nade' || k === 'bottle') { px = 0.2; py = -0.24; pz = -0.45; }
    if (k === 'bomb') { px = 0.12; py = -0.27; pz = -0.5; }
    if (k === 'pistol' || k === 'deagle' || k === 'zeus') { px = 0.19; py = -0.2; pz = -0.56; ry = 0.08; }
    px += Math.cos(vmState.bob) * 0.012 * bobA + vmState.swayX; py += -Math.abs(Math.sin(vmState.bob)) * 0.012 * bobA + vmState.swayY;
    pz += vmState.kick * 0.05; rx += vmState.kick * 0.1;
    py -= e.crouch * 0.01;
    const dk = clamp((T - vmState.drawT) / 0.4, 0, 1);
    py -= (1 - dk) * (1 - dk) * 0.22; rx -= (1 - dk) * 0.7;
    if (e.reloadUntil) {
      const w = cur(e), dur = w && w.def.shell ? 0.5 : w ? w.def.reload : 2, ph = w && w.def.shell ? 0.5 : clamp((T - e.reloadStart) / dur, 0, 1);
      const dip = Math.sin(ph * PI);
      py -= dip * 0.07; rz += dip * 0.55; rx += dip * 0.25;
    }
    if (k === 'knife' && T - e.swingT < 0.32) {
      const s = (T - e.swingT) / 0.32, a = Math.sin(s * PI);
      if (e.swingAlt) { pz -= a * 0.12; rx -= a * 0.3; } else { ry += a * 1.1; rz -= a * 0.6; px -= a * 0.08; }
    }
    if (e.pin) { pz += 0.06; py += 0.03; rx -= 0.4; }
    if (e.planting) { py -= 0.05; rx += 0.6; }
    if (e.defusing) { py -= 0.3; }
    vm.position.set(px, py, pz); vm.rotation.set(rx, ry, rz);
    vmFlash.visible = T - vmState.flashT < 0.045;
    if (vmFlash.visible) vmFlash.material.rotation = Math.random() * 6;
  }

  // ══════════════ Camera, models, render ══════════════
  function syncModel(e, dt) {
    const m = e.model; if (!m) return;
    const s = m.s, root = s.root;
    root.visible = !(e.isPlayer && camMode === 'fp');
    root.position.set(e.pos.x, e.pos.y, e.pos.z);
    if (e.alive) {
      root.rotation.set(0, e.yaw, 0);
      const sp = hSpeed(e);
      m.phase += dt * sp * 1.9;
      const sw = Math.sin(m.phase) * Math.min(1, sp / 4) * 0.65;
      const c = e.crouch;
      s.legL.position.y = s.legR.position.y = 0.9 - 0.45 * c;
      s.legL.scale.y = s.legR.scale.y = 1 - 0.5 * c;
      s.legL.rotation.x = sw; s.legR.rotation.x = -sw;
      s.upper.position.y = 0.9 - 0.45 * c;
      s.upper.rotation.x = e.pitch * 0.45;
      s.head.rotation.x = e.pitch * 0.4;
      models.setSoldierGun(s, lookOf(e));
      s.shadow.visible = true;
      if (s.tag) s.tag.visible = true;
    } else {
      m.fall = Math.min(1, m.fall + dt * 2.6);
      const k = 1 - Math.pow(1 - m.fall, 3);
      root.rotation.set(-PI / 2 * k, e.yaw, 0.3 * k * m.fallDir);
      root.position.y = e.pos.y + 0.14 * k;
      s.legL.rotation.x = s.legR.rotation.x = 0;
      models.setSoldierGun(s, null);
      s.shadow.visible = false;
      if (s.tag) s.tag.visible = false;
    }
  }
  let menuAng = 0;
  function updateCamera(dt) {
    if (!G) {
      menuAng += dt * 0.04;
      const c = W.SIZE / 2;
      camera.position.set(c + Math.cos(menuAng) * 70, 42, c + Math.sin(menuAng) * 70);
      camera.lookAt(c, 0, c);
      camera.fov = 60; camera.updateProjectionMatrix();
      return;
    }
    const e = player;
    shake *= Math.exp(-dt * 5);
    const sx = (Math.random() - 0.5) * shake * 0.05, sy = (Math.random() - 0.5) * shake * 0.05;
    if (camMode === 'fp' && e.alive) {
      const ey = eyePos(e);
      camera.position.set(ey.x, ey.y, ey.z);
      camera.rotation.set(clamp(e.pitch + e.punchP + e.kickP, -1.55, 1.55) + sy, e.yaw + e.punchY + e.kickY + sx, 0);
      const w = cur(e), fov = w && w.def.scope && e.scope ? w.def.scope[e.scope - 1] : BASE_FOV;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    } else {
      // Spectate a teammate (over the shoulder)
      if (camMode === 'dead' && T > specAt) camMode = 'spec';
      if (camMode === 'dead') {
        // Look down at your body for a moment
        const k = clamp((T - e.deadAt) / 1.2, 0, 1), f0 = fwd(e.yaw, 0);
        camera.position.set(e.pos.x - f0.x * (1 + 2 * k), e.pos.y + 1.6 + 2.2 * k, e.pos.z - f0.z * (1 + 2 * k));
        camera.lookAt(e.pos.x + f0.x * 0.6, e.pos.y + 0.3, e.pos.z + f0.z * 0.6);
        if (camera.fov !== BASE_FOV) { camera.fov = BASE_FOV; camera.updateProjectionMatrix(); }
        const cf0 = new THREE.Vector3(); camera.getWorldDirection(cf0);
        audio.listener(camera.position.x, camera.position.y, camera.position.z, cf0.x, cf0.y, cf0.z);
        return;
      }
      let tgt = byId(specId);
      if (!tgt || !tgt.alive) { const m = aliveOf(e.team); tgt = m[0] || ents.find(x => x.alive) || e; specId = tgt.id; }
      const ey = eyePos(tgt), f = fwd(tgt.yaw, tgt.pitch);
      let back = 2.6;
      const hit = W.raycast(ey.x, ey.y + 0.35, ey.z, -f.x, -f.y * 0.5, -f.z, back + 0.3);
      if (hit) back = Math.max(0.3, hit.t - 0.3);
      camera.position.set(ey.x - f.x * back, ey.y + 0.35 - f.y * back * 0.5, ey.z - f.z * back);
      camera.rotation.set(tgt.pitch * 0.85, tgt.yaw, 0);
      if (camera.fov !== BASE_FOV) { camera.fov = BASE_FOV; camera.updateProjectionMatrix(); }
    }
    const cf = fwd(camera.rotation.y, camera.rotation.x);
    audio.listener(camera.position.x, camera.position.y, camera.position.z, cf.x, cf.y, cf.z);
  }
  let captureFlash = false;
  function render() {
    renderer.clear();
    renderer.render(scene, camera);
    if (captureFlash) {
      captureFlash = false;
      const a = $('after'), x = a.getContext('2d');
      try { x.drawImage(cv, 0, 0, a.width, a.height); } catch (e) { }
    }
    if (vm && G && !G.over && camMode === 'fp' && player.alive) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
  }

  // ══════════════ HUD ══════════════
  const feedEl = $('feed'), radioEl = $('radio');
  const setText = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  const setHTML = (el, v) => { if (el._h !== v) { el._h = v; el.innerHTML = v; } };
  function banner(text, kind, dur, sub) {
    const el = $('msg');
    el.innerHTML = `<div class="m-${kind || 'info'}">${esc(text)}</div>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    el.className = 'show'; el._until = T + (dur || 2.5);
  }
  // to: only for that player (an entity id); online, the host passes every message on and each page keeps its side's
  function radio(from, text, team, to) {
    emit(['r', from, text, team || '', to || 0]);
    if (!player || (team && team !== player.team) || (to && to !== player.id)) return;
    const d = document.createElement('div');
    d.innerHTML = (from ? `<b>${esc(from)}</b> ` : '') + esc(text);
    radioEl.appendChild(d);
    while (radioEl.children.length > 4) radioEl.firstChild.remove();
    setTimeout(() => d.remove(), 6000);
  }
  function feed(a, v, wname, hs, wall) {
    const d = document.createElement('div');
    const me = (a && a.isPlayer) || v.isPlayer;
    d.className = 'kf' + (me ? ' me' : '');
    const nm = x => `<span class="${x.team.toLowerCase()}">${esc(x.isPlayer ? playerName() : x.name)}</span>`;
    d.innerHTML = (a && a !== v ? nm(a) + ' ' : '') + `<i>${esc(wname)}</i>` + (hs ? ' <em>HS</em>' : '') + ' ' + nm(v);
    feedEl.appendChild(d);
    while (feedEl.children.length > 6) feedEl.firstChild.remove();
    setTimeout(() => d.remove(), 7000);
  }
  // Money earned: the pop-up for you, or sent to the player it belongs to online
  function givePop(e, n) { if (e.isPlayer) moneyPop(n); else if (e.net) emit(['mp', e.id, n]); }
  function moneyPop(n) { const el = $('moneyPop'); el.textContent = '+' + money(n); el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }
  let hurtV = 0;
  function hurtHUD(from, dmg) {
    hurtV = Math.min(1, hurtV + dmg / 45);
    if (from && player) {
      const a = angDiff(yawTo(from.x - player.pos.x, from.z - player.pos.z), player.yaw);
      const el = $('hurtDir'); el.style.transform = `translate(-50%,-50%) rotate(${-a}rad)`; el.style.opacity = 1; el._t = T;
    }
  }
  function playerFlashed(s, dur) {
    captureFlash = true;
    $('after').style.opacity = 0;
    audio.flashed(dur, s);
  }
  const radarCv = $('radar'), radarCtx = radarCv.getContext('2d');
  const radarMap = document.createElement('canvas');
  (() => {
    const S = 4; radarMap.width = radarMap.height = W.SIZE * S;
    const x = radarMap.getContext('2d');
    for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) {
      const ch = W.grid[r][c];
      x.fillStyle = ch === '#' ? 'rgba(20,16,12,0.92)' : ch === 'a' || ch === 'b' ? '#8a5a3c' : ch === 't' ? '#7a6a48' : ch === 's' ? '#4f6278' : '#a08a66';
      x.fillRect(c * 4 * S, r * 4 * S, 4 * S + 1, 4 * S + 1);
    }
    for (const b of W.boxes) if (b.kind === 'crate' || b.kind === 'door') { x.fillStyle = 'rgba(40,30,20,0.85)'; x.fillRect(b.x0 * S, b.z0 * S, (b.x1 - b.x0) * S, (b.z1 - b.z0) * S); }
    for (const b of W.boxes) if (b.kind === 'roof') { x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(b.x0 * S, b.z0 * S, (b.x1 - b.x0) * S, (b.z1 - b.z0) * S); }
    x.fillStyle = 'rgba(255,240,220,0.85)'; x.font = `900 ${18 * S}px Nunito, Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('A', 25.5 * 4 * S, 5.5 * 4 * S); x.fillText('B', 6.5 * 4 * S, 5.5 * 4 * S);
  })();
  let radarT = 0;
  function drawRadar() {
    const c = radarCtx, Wd = radarCv.width, S = 4, sc = Wd / (48 * 2) / S;   // 48 m around you
    const me = camMode === 'fp' || !byId(specId) ? player : byId(specId);
    c.clearRect(0, 0, Wd, Wd);
    c.save();
    c.beginPath(); c.arc(Wd / 2, Wd / 2, Wd / 2 - 2, 0, TAU); c.clip();
    c.fillStyle = 'rgba(10,10,14,0.55)'; c.fillRect(0, 0, Wd, Wd);
    c.translate(Wd / 2, Wd / 2); c.rotate(me.yaw); c.scale(sc, sc);
    c.translate(-me.pos.x * S, -me.pos.z * S);
    c.drawImage(radarMap, 0, 0);
    const dot = (x, z, col, r, ring) => { c.beginPath(); c.arc(x * S, z * S, r / sc, 0, TAU); c.fillStyle = col; c.fill(); if (ring) { c.lineWidth = 1.5 / sc; c.strokeStyle = '#000'; c.stroke(); } };
    for (const s of smokes) dot(s.x, s.z, 'rgba(200,200,200,0.55)', s.R * S * sc * smokeGrow(s), false);
    for (const f of fires) for (const p of f.pts) dot(p.x, p.z, 'rgba(255,120,40,0.6)', 0.8 * S * sc, false);
    for (const e of ents) {
      if (e === me && e.alive) continue;
      if (e.team === player.team) { if (e.alive) dot(e.pos.x, e.pos.z, e.team === 'T' ? '#ffcf5a' : '#6fb6ff', 4, true); else { c.fillStyle = 'rgba(255,255,255,0.5)'; c.font = `900 ${14 / sc}px Arial`; c.fillText('×', e.pos.x * S, e.pos.z * S); } }
      else if (e.alive && T < e.spottedUntil) dot(e.pos.x, e.pos.z, '#ff4d4d', 4, true);
    }
    if ((bomb.state === 'dropped' || (bomb.state === 'carried' && bomb.carrier)) && player.team === 'T') {
      const bx = bomb.state === 'carried' ? bomb.carrier.pos.x : bomb.x, bz = bomb.state === 'carried' ? bomb.carrier.pos.z : bomb.z;
      c.fillStyle = bomb.state === 'dropped' ? '#ffde59' : 'rgba(255,90,60,0.9)'; c.fillRect(bx * S - 3 / sc, bz * S - 3 / sc, 6 / sc, 6 / sc);
    }
    if (bomb.state === 'planted') { c.fillStyle = (T * 3 % 1) < 0.5 ? '#ff3030' : '#ffde59'; c.fillRect(bomb.x * S - 4 / sc, bomb.z * S - 4 / sc, 8 / sc, 8 / sc); }
    c.restore();
    // You: an arrow in the middle
    c.save(); c.translate(Wd / 2, Wd / 2);
    c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 5); c.lineTo(0, 2); c.lineTo(-5, 5); c.closePath();
    c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#000'; c.stroke();
    c.restore();
    c.beginPath(); c.arc(Wd / 2, Wd / 2, Wd / 2 - 2, 0, TAU); c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.35)'; c.stroke();
    setText($('loc'), W.regionName(me.pos.x, me.pos.z));
  }
  const fmtClock = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function hud(dt) {
    const e = player, spec = camMode !== 'fp' ? byId(specId) : null, me = spec && camMode === 'spec' ? spec : e;
    // Top bar
    setText($('scT'), String(G.score.T)); setText($('scCT'), String(G.score.CT));
    let clock;
    if (R.phase === 'freeze') clock = fmtClock(R.liveAt - T);
    else if (R.phase === 'live') clock = fmtClock(R.endAt - T);
    else if (R.phase === 'planted') clock = '';
    else clock = fmtClock(R.nextAt - T);
    setText($('clock'), clock);
    $('clock').classList.toggle('bomb', R.phase === 'planted');
    $('clock').classList.toggle('low', R.phase === 'live' && R.endAt - T < 10);
    const pips = t => ents.filter(x => x.team === t).map(x => `<i class="${x.alive ? 'on' : ''}${x.isPlayer ? ' me' : ''}"></i>`).join('');
    setHTML($('pipsT'), pips('T')); setHTML($('pipsCT'), pips('CT'));
    // Vitals / money / ammo
    setText($('hp'), String(me.hp)); $('hp').parentNode.classList.toggle('low', me.hp <= 25);
    setText($('ar'), String(me.armor)); setHTML($('arIc'), me.helmet ? ICON.helmet : ICON.shield);
    setText($('money'), money(e.money));
    const w = cur(me);
    if (NET.client && me !== e) $('ammo').hidden = true;
    else if (w && w.def.mag) { setText($('ammoMag'), String(w.ammo)); setText($('ammoRes'), '/ ' + w.reserve); $('ammo').hidden = false; $('ammoMag').classList.toggle('low', w.ammo <= Math.ceil(w.def.mag * 0.2)); }
    else if (w && w.nade) { setText($('ammoMag'), String(me.nades.filter(n => n === w.nade).length)); setText($('ammoRes'), NADES[w.nade].name); $('ammo').hidden = false; $('ammoMag').classList.remove('low'); }
    else $('ammo').hidden = true;
    // Inventory list
    const inv = [];
    const row = (slot, label, on) => inv.push(`<div class="${on ? 'on' : ''}"><kbd>${slot}</kbd>${esc(label)}</div>`);
    if (me.prim) row(1, me.prim.def.name, me.slot === 1);
    if (me.sec) row(2, me.sec.def.name, me.slot === 2);
    row(3, me.zeus ? (me.slot === 3 && me.sub3 === 'zeus' ? 'Zap-27' : 'Knife · Zap-27') : 'Knife', me.slot === 3);
    if (me.nades.length) row(4, [...new Set(me.nades)].map(n => NADES[n].name + (me.nades.filter(x => x === n).length > 1 ? ' ×2' : '')).join(' · '), me.slot === 4);
    if (me.bomb) row(5, 'Bomb', me.slot === 5);
    if (me.kit) inv.push('<div class="kit">Defuse kit</div>');
    setHTML($('inv'), inv.join(''));
    // Crosshair
    const xh = $('xh');
    const hideXh = !e.alive || camMode !== 'fp' || (w && w.def.cat === 'sniper') || (w && w.def.id === 'bomb');
    xh.hidden = hideXh;
    if (!hideXh && w && w.def.mag) {
      const gap = 3 + spreadOf(e, w) * 9;
      xh.style.setProperty('--g', Math.min(60, gap).toFixed(1) + 'px');
    } else xh.style.setProperty('--g', '4px');
    $('scopeOv').hidden = !(camMode === 'fp' && e.alive && w && w.def.scope && e.scope);
    // Hints and progress
    let hint = '';
    if (e.alive && camMode === 'fp') {
      if (R.phase === 'freeze' || (R.phase === 'live' && canBuyNow(e))) hint = buyOpen() ? '' : `Press <kbd>B</kbd> to buy · ${Math.ceil((R.t0 + BUY_TIME) - T)} s`;
      if (e.bomb && 'ab'.includes(W.cellAt(e.pos.x, e.pos.z)) && R.phase === 'live' && !e.planting) hint = 'Hold <kbd>E</kbd> to plant the bomb';
      else if (e.bomb && R.phase === 'live' && !hint) hint = 'You have the bomb: plant it at <b>A</b> or <b>B</b>';
      if (e.team === 'CT' && bomb.state === 'planted' && Math.hypot(e.pos.x - bomb.x, e.pos.z - bomb.z) < 1.9 && !e.defusing) hint = `Hold <kbd>E</kbd> to defuse (${e.kit ? 5 : 10} s${e.kit ? '' : ', a kit makes it 5'})`;
      const ld = !hint ? lookDrop() : null;
      if (ld) hint = `Press <kbd>E</kbd> to pick up ${esc(ld.w.def.name)}`;
    }
    setHTML($('hint'), hint);
    const prog = $('prog');
    if (e.planting || e.defusing) {
      const p = e.planting ? (T - e.planting.t0) / PLANT_TIME : (T - e.defusing.t0) / e.defusing.len;
      prog.hidden = false; $('progFill').style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%';
      setText($('progTxt'), e.planting ? 'Planting…' : 'Defusing…');
    } else prog.hidden = true;
    // Spectating
    const specEl = $('spec');
    if (camMode !== 'fp') {
      specEl.hidden = false;
      const t = byId(specId);
      specEl.innerHTML = camMode === 'spec' && t ? `Spectating <b>${esc(t.isPlayer ? 'you' : t.name)}</b> · ${t.hp} HP · click to switch` : 'You died';
    } else specEl.hidden = true;
    // Big message fades
    const msg = $('msg'); if (msg._until && T > msg._until) { msg.className = ''; msg._until = 0; }
    // Flash
    let fo = 0, ao = 0;
    if (T < e.flashUntil && e.alive) {
      const age = T - e.flashT0, hold = e.flashDur * 0.45, peak = e.flashStr >= 0.7 ? 1 : 0.35 + e.flashStr * 0.8;
      fo = age < hold ? peak : peak * clamp(1 - (age - hold) / (e.flashDur - hold), 0, 1);
      ao = age < hold ? 0.55 * peak : 0.55 * peak * clamp(1 - (age - hold) / (e.flashDur - hold), 0, 1);
    }
    $('flashOv').style.opacity = fo.toFixed(3); $('after').style.opacity = ao.toFixed(3);
    // Inside a smoke?
    let fog = 0;
    const ey = camera.position;
    for (const s of smokes) { const r = s.R * smokeGrow(s), d = Math.hypot(ey.x - s.x, (ey.y - s.y - r * 0.55) * 1.2, ey.z - s.z); if (d < r) fog = Math.max(fog, clamp((r - d) / 1.5, 0, 0.92)); }
    $('smokeFog').style.opacity = fog.toFixed(3);
    hurtV *= Math.exp(-dt * 2.5);
    $('hurtOv').style.opacity = (hurtV * 0.8).toFixed(3);
    const hd = $('hurtDir'); if (hd._t && T - hd._t > 0.2) hd.style.opacity = clamp(1 - (T - hd._t - 0.2) / 0.8, 0, 1).toFixed(2);
    // Speed counter (P): horizontal speed of you or whoever you spectate
    const spd = $('speedo');
    spd.hidden = !settings.speedo || !me.alive;
    if (!spd.hidden) {
      const u = Math.round(hSpeed(me) * UNITS);
      setText($('speedoN'), String(u));
      spd.classList.toggle('fast', u > 260);
    }
    radarT -= dt; if (radarT <= 0) { radarT = 0.05; drawRadar(); }
    if (!$('board').hidden) renderBoard();
  }
  const ICON = {
    shield: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z" fill="currentColor"/></svg>',
    helmet: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 15a9 9 0 0 1 18 0v2H3z M2 18h20v2H2z" fill="currentColor"/></svg>',
  };
  function renderBoard() {
    const rowsOf = t => ents.filter(e => e.team === t).sort((a, b) => b.stats.k - a.stats.k || a.stats.d - b.stats.d).map(e => {
      const hs = e.stats.k > 0 ? Math.round(e.stats.hs / e.stats.k * 100) : 0;
      return `<tr class="${e.alive ? '' : 'dead'}${e.isPlayer ? ' me' : ''}"><td>${esc(e.isPlayer ? playerName() : e.name)}${e.bomb && player.team === 'T' ? ' <em>bomb</em>' : ''}</td><td>${e.team === player.team ? money(e.money) : ''}</td><td>${e.stats.k}</td><td>${e.stats.a}</td><td>${e.stats.d}</td><td>${hs}%</td><td>${e.stats.mvp ? '★' + e.stats.mvp : ''}</td></tr>`;
    }).join('');
    const tbl = t => `<div class="bt ${t.toLowerCase()}"><h3>${TEAMNAME[t]} <b>${G.score[t]}</b></h3><table><tr><th>Player</th><th>Money</th><th>K</th><th>A</th><th>D</th><th>HS</th><th>MVP</th></tr>${rowsOf(t)}</table></div>`;
    setHTML($('board'), `<div class="bwrap">${tbl(player.team === 'CT' ? 'CT' : 'T')}${tbl(player.team === 'CT' ? 'T' : 'CT')}<p>Round ${G.round} · first to ${TO_WIN} · ${G.label}</p></div>`);
  }

  // ══════════════ Buy menu ══════════════
  const BUY = [
    ['Pistols', ['glock', 'usp', 'deagle']],
    ['SMG & Heavy', ['smg', 'shotgun']],
    ['Rifles', ['galil', 'famas', 'ak', 'm4']],
    ['Snipers', ['scout', 'awp']],
    ['Gear', ['kevlar', 'helmet', 'kit', 'zeus']],
    ['Grenades', ['flash', 'he', 'smoke', 'molotov', 'incendiary', 'decoy']],
  ];
  const INFO = {
    kevlar: 'Body armour: less damage to the chest, stomach and arms', helmet: 'Armour plus a helmet that stops one-tap headshots from most guns', kit: 'Defuse in 5 seconds instead of 10',
    zeus: 'One-shot taser, very short range', flash: 'Blinds anyone looking at it', he: 'Explodes after 1.6 s: up to 98 damage', smoke: 'Blocks sight for 18 s; puts out fire',
    molotov: 'Bursts into fire on the ground for 7 s', incendiary: 'Bursts into fire on the ground for 7 s', decoy: 'Fakes gunfire so enemies look the wrong way',
  };
  const buyOpen = () => !$('buy').hidden;
  function setBuy(on) {
    const el = $('buy');
    if (on) { if (!G || !player.alive || !canBuyNow(player)) { audio.ui('deny'); return; } el.hidden = false; renderBuy(); unlockPointer(true); }
    else if (!el.hidden) { el.hidden = true; if (G && !G.over && !paused) lockPointer(); }
  }
  function renderBuy() {
    const e = player;
    const cols = BUY.map(([title, ids]) => {
      const items = ids.filter(id => { const d = WD[id] || NADES[id] || GEAR[id]; return !d.team || d.team === e.team; }).map(id => {
        const d = WD[id] || NADES[id] || GEAR[id], why = buyCheck(e, id), p = priceOf(e, id);
        const stat = WD[id] && !WD[id].zeus ? `${d.dmg}${d.pellets ? '×' + d.pellets : ''} dmg · ${d.rpm} rpm · ${d.mag} rounds` : INFO[id] || '';
        const owned = why === 'You have one' || why === 'You have it' || why === 'Armour is full';
        return `<button type="button" data-buy="${id}" class="${why ? 'no' : ''}${owned ? ' own' : ''}" title="${esc(why || stat)}"><b>${esc(id === 'helmet' && e.armor >= 100 && !e.helmet ? 'Helmet' : d.name)}</b><span class="pr">${money(p)}</span><small>${esc(stat)}</small></button>`;
      }).join('');
      return `<div class="bcol"><h4>${title}</h4>${items}</div>`;
    }).join('');
    $('buyGrid').innerHTML = cols;
    setText($('buyMoney'), money(e.money));
    setText($('buyTime'), R && R.phase === 'freeze' ? 'Freeze time' : `${Math.max(0, Math.ceil(R.t0 + BUY_TIME - T))} s to buy`);
  }
  const BUYABLE = new Set(BUY.flatMap(([, ids]) => ids));
  // Online, a client asks the host to buy (the host has the real money)
  function doBuy(id) {
    if (!NET.client) return tryBuy(player, id);
    if (buyCheck(player, id)) { audio.ui('deny'); return; }
    audio.ui('buy'); netAct(['b', id]);
  }
  $('buyGrid').addEventListener('click', ev => { const b = ev.target.closest('[data-buy]'); if (b && G) doBuy(b.dataset.buy); });
  $('buyClose').onclick = () => setBuy(false);

  // ══════════════ Input ══════════════
  const lockPointer = () => { try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch (e) { } };
  let unlocking = false;
  function unlockPointer(forBuy) { unlocking = !!forBuy; if (document.pointerLockElement) document.exitPointerLock(); }
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === cv;
    if (locked) { paused = false; $('pauseBox').hidden = true; $('clickBox').hidden = true; unlocking = false; return; }
    if (!G || G.over) return;
    if (buyOpen() || unlocking) { unlocking = false; return; }
    paused = true; $('pauseBox').hidden = false;
    $('pauseTxt').textContent = NET.on ? 'This is an online match, so it keeps going while you\'re here.' : 'Click Resume to keep playing.';
    for (const k in keys) keys[k] = false; mouse.l = mouse.r = false;
  });
  document.addEventListener('mousemove', ev => {
    if (!G || document.pointerLockElement !== cv || !player.alive || camMode !== 'fp') return;
    const w = cur(player), zoom = w && w.def.scope && player.scope ? Math.tan(camera.fov * DEG / 2) / Math.tan(BASE_FOV * DEG / 2) : 1;
    const k = 0.0022 * settings.sens * zoom;
    player.yaw = angDiff(player.yaw - ev.movementX * k, 0);
    player.pitch = clamp(player.pitch - ev.movementY * k, -1.55, 1.55);
    vmState.mdx += ev.movementX; vmState.mdy += ev.movementY;
  });
  cv.addEventListener('mousedown', ev => {
    if (!G || G.over) return;
    if (document.pointerLockElement !== cv) { if (!buyOpen()) lockPointer(); return; }
    if (camMode !== 'fp' || !player.alive) { if (ev.button === 0 && camMode === 'spec') { const m = aliveOf(player.team); if (m.length) { const i = m.findIndex(x => x.id === specId); specId = m[(i + 1) % m.length].id; } } return; }
    if (ev.button === 0) mouse.l = true;
    if (ev.button === 2) {
      mouse.r = true;
      const w = cur(player);
      if (w && w.def.scope && T >= player.switchUntil && !player.reloadUntil) { player.scope = (player.scope + 1) % (w.def.scope.length + 1); player.scopeT = T; player.rescopeAt = 0; audio.dry(); }
    }
  });
  addEventListener('mouseup', ev => { if (ev.button === 0) mouse.l = false; if (ev.button === 2) mouse.r = false; });
  cv.addEventListener('contextmenu', ev => ev.preventDefault());
  addEventListener('wheel', ev => {
    if (!G || document.pointerLockElement !== cv || !player.alive) return;
    const order = [1, 2, 3, 4, 5].filter(s => (s === 1 && player.prim) || (s === 2 && player.sec) || s === 3 || (s === 4 && player.nades.length) || (s === 5 && player.bomb));
    const i = order.indexOf(player.slot), n = order[(i + (ev.deltaY > 0 ? 1 : -1) + order.length) % order.length];
    selectSlot(player, n);
  }, { passive: true });
  addEventListener('keydown', ev => {
    if (!G || G.over) return;
    if (ev.target && ev.target.tagName === 'INPUT') return;
    const c = ev.code;
    if (c === 'Tab') { ev.preventDefault(); $('board').hidden = false; renderBoard(); return; }
    if (paused) return;
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(c) || c.startsWith('Digit')) ev.preventDefault();
    if (c === 'Space' && player && player.alive && !ev.repeat) player.jumpBuf = T + JUMP_BUFFER;
    if (ev.repeat) { keys[c] = true; return; }
    keys[c] = true;
    const e = player;
    if (c === 'KeyB') { setBuy(!buyOpen()); return; }
    if (c === 'KeyP') { settings.speedo = !settings.speedo; store.set('speedo', settings.speedo ? '1' : '0'); return; }
    if (buyOpen() && c === 'Escape') { setBuy(false); return; }
    if (!e.alive) return;
    if (c === 'Digit1') selectSlot(e, 1);
    else if (c === 'Digit2') selectSlot(e, 2);
    else if (c === 'Digit3') selectSlot(e, 3, e.slot === 3 && e.sub3 === 'knife' && e.zeus ? 'zeus' : 'knife');
    else if (c === 'Digit4') { if (e.slot === 4 && e.nades.length > 1) { const curN = e.nades[e.nadeI % e.nades.length]; let j = e.nadeI; do { j = (j + 1) % e.nades.length; } while (e.nades[j] === curN && j !== e.nadeI); e.nadeI = j; vmState.drawT = T; e.pin = null; } else selectSlot(e, 4); }
    else if (c === 'Digit5') selectSlot(e, 5);
    else if (c === 'KeyQ') selectSlot(e, e.lastSlot || 3) || selectSlot(e, bestSlot(e));
    else if (c === 'KeyR') startReload(e);
    else if (c === 'KeyE') useKey();
    else if (c === 'KeyG') doDrop(e);
  });
  function doDrop(e) {
    if (NET.client) {
      // The host drops it for real; take it out of your hands now
      if (!((e.slot === 5 && e.bomb) || (e.slot === 1 && e.prim) || (e.slot === 2 && e.sec))) return;
      netAct(['g', e.slot]); e.netHold = T + 1;
      if (e.slot === 5) e.bomb = false; else if (e.slot === 1) e.prim = null; else e.sec = null;
      selectSlot(e, bestSlot(e));
      return;
    }
    if (e.slot === 5 && e.bomb) dropBomb(e, false);
    else if (e.slot === 1 && e.prim) dropItem(e, e.prim, false);
    else if (e.slot === 2 && e.sec) dropItem(e, e.sec, false);
  }
  addEventListener('keyup', ev => { keys[ev.code] = false; if (ev.code === 'Tab') $('board').hidden = true; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; });

  // ══════════════ Online ══════════════
  // Up to 10 people in a lobby (server/bombsite.js); bots fill the empty places. The host's page runs the match
  // and the server only passes messages on. Kept small on purpose:
  // · 20 snapshots a second, each with only the players whose position, aim or stance changed: 9 bytes for a
  //   small step from what that page already has (1 cm steps), 13 for a full position, then base64. The whole
  //   set every 2 s; nothing at all while nothing changes. Speeds aren't sent: each page works them out.
  // · Health, money, guns, scores and the round clock are sent only when they change.
  // · Shots, grenades, kills and drops are short events. Grenade flights are worked out on every page from the
  //   throw, so they're never streamed.
  // · Each player's page checks its own bullets against what it showed (what you saw is what you hit), so
  //   the host doesn't need to rewind anyone. Movement is sent 20 times a second, and only when it changed.
  // · Native WebSockets when the network allows them, otherwise the HTTP fallback in net.js.
  const SERVER = (() => {
    const p = new URLSearchParams(location.search).get('server');
    return p && /^(wss:\/\/|ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/.test(p) ? p : 'wss://api.eduarcade.online';
  })();
  const SNAP_DT = 0.05, INTERP = 0.11, FULL_EVERY = 2;
  const LOOKS = [null, 'knife', 'zeus', 'glock', 'usp', 'deagle', 'smg', 'shotgun', 'galil', 'famas', 'ak', 'm4', 'scout', 'awp',
    'flash', 'he', 'smoke', 'molotov', 'incendiary', 'decoy', 'bomb'];
  const NORMS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const DIFF_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };

  // ── Packing ──
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', B64I = {};
  for (let i = 0; i < 64; i++) B64I[B64[i]] = i;
  function b64(b) {
    let s = '';
    for (let i = 0; i < b.length; i += 3) {
      const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < b.length ? B64[n >> 6 & 63] : '') + (i + 2 < b.length ? B64[n & 63] : '');
    }
    return s;
  }
  function unb64(s) {
    const out = [];
    for (let i = 0; i < s.length; i += 4) {
      const n = ((B64I[s[i]] | 0) << 18) | ((B64I[s[i + 1]] | 0) << 12) | ((B64I[s[i + 2]] | 0) << 6) | (B64I[s[i + 3]] | 0);
      out.push(n >> 16 & 255);
      if (i + 2 < s.length) out.push(n >> 8 & 255);
      if (i + 3 < s.length) out.push(n & 255);
    }
    return out;
  }
  class Wr {
    constructor() { this.b = []; }
    u8(v) { this.b.push(clamp(Math.round(v) || 0, 0, 255)); }
    i8(v) { this.b.push(clamp(Math.round(v) || 0, -127, 127) & 255); }
    u16(v) { v = clamp(Math.round(v) || 0, 0, 65535); this.b.push(v >> 8, v & 255); }
  }
  class Rd {
    constructor(s) { this.b = unb64(String(s || '')); this.i = 0; }
    u8() { return this.b[this.i++] | 0; }
    i8() { const v = this.b[this.i++] | 0; return v > 127 ? v - 256 : v; }
    u16() { const v = ((this.b[this.i] | 0) << 8) | (this.b[this.i + 1] | 0); this.i += 2; return v; }
    left() { return this.b.length - this.i; }
  }
  const QX = v => (v + 8) * 400, DX = q => q / 400 - 8;          // 2.5 mm steps
  const QY = v => (v + 4) * 1000, DY = q => q / 1000 - 4;
  const QA = v => (((v % TAU) + TAU) % TAU) / TAU * 65535, DA = q => angDiff(q / 65535 * TAU, 0);
  // A player in a snapshot. fl bits: 1 on the ground, 2 scoped, 64 spotted, 128 = small step from the last one sent
  // (dx dy dz in 1 cm, turn in 1/2048 of a circle). base = what the other pages now have for this player.
  const DXY = 4, DYU = 10, DAU = 32;
  function entState(e) {
    const look = LOOKS.indexOf(lookOf(e));
    return { x: clamp(Math.round(QX(e.pos.x)), 0, 65535), y: clamp(Math.round(QY(e.pos.y)), 0, 65535), z: clamp(Math.round(QX(e.pos.z)), 0, 65535),
      a: clamp(Math.round(QA(e.yaw)), 0, 65535), p: clamp(Math.round(e.pitch * 80), -127, 127), c: clamp(Math.round(e.crouch * 255), 0, 255),
      look: look < 0 ? 0 : look, fl: (e.onGround ? 1 : 0) | (e.scope ? 2 : 0) | (T < e.spottedUntil ? 64 : 0) };
  }
  const wrapA = d => ((d + 32768) % 65536 + 65536) % 65536 - 32768;
  function writeEnt(w, id, s, base, full) {
    if (base && !full) {
      const dx = Math.round((s.x - base.x) / DXY), dy = Math.round((s.y - base.y) / DYU), dz = Math.round((s.z - base.z) / DXY), da = Math.round(wrapA(s.a - base.a) / DAU);
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), Math.abs(da)) <= 127) {
        if (!dx && !dy && !dz && !da && s.p === base.p && s.c === base.c && s.look === base.look && s.fl === base.fl) return base;   // unchanged
        w.u8(id); w.u8(s.fl | 128); w.i8(dx); w.i8(dy); w.i8(dz); w.i8(da); w.i8(s.p); w.u8(s.c); w.u8(s.look);
        return { x: base.x + dx * DXY, y: base.y + dy * DYU, z: base.z + dz * DXY, a: (base.a + da * DAU + 65536) % 65536, p: s.p, c: s.c, look: s.look, fl: s.fl };
      }
    }
    w.u8(id); w.u8(s.fl); w.u16(s.x); w.u16(s.y); w.u16(s.z); w.u16(s.a); w.i8(s.p); w.u8(s.c); w.u8(s.look);
    return s;
  }
  const timeBytes = w => { const ms = Math.max(0, Math.round(T * 1000)); w.u16(Math.floor(ms / 65536)); w.u16(ms % 65536); };

  // ── Connection ──
  function netSend(m) { const s = NET.sock; if (s && s.readyState === 1 && NET.open) s.send(JSON.stringify(m)); }
  const saveToken = t => { NET.token = t; try { sessionStorage.setItem('bombsite-token', t); } catch (e) { } };
  const forgetToken = () => { NET.token = null; try { sessionStorage.removeItem('bombsite-token'); } catch (e) { } };
  let httpOnly = false;   // this page found WebSockets blocked
  function netConnect() {
    if (NET.sock && NET.sock.readyState <= 1) return;
    clearTimeout(NET.retryT);
    setStatus('wait', 'Connecting to the game server… (it can take up to a minute to wake up)');
    const viaHttp = () => {
      let s;
      try { s = new EduSocket(SERVER); } catch (e) { setStatus('off', 'Could not reach the game server'); return; }
      NET.sock = s;
      s.onopen = () => netOpened(s); s.onmessage = ev => netMsg(ev.data); s.onclose = () => netClosed(s);
    };
    if (httpOnly || typeof WebSocket === 'undefined') { viaHttp(); return; }
    // A real WebSocket is lighter (no HTTP headers on every message); school wifi often blocks them
    let ws, opened = false;
    try { ws = new WebSocket(SERVER); } catch (e) { httpOnly = true; viaHttp(); return; }
    NET.sock = ws;
    const giveUp = setTimeout(() => { if (opened) return; ws.onclose = null; try { ws.close(); } catch (e) { } httpOnly = true; viaHttp(); }, 5000);
    ws.onopen = () => { opened = true; clearTimeout(giveUp); netOpened(ws); };
    ws.onmessage = ev => netMsg(ev.data);
    ws.onerror = () => { };
    ws.onclose = () => { clearTimeout(giveUp); if (!opened) { if (NET.sock === ws) { httpOnly = true; viaHttp(); } } else netClosed(ws); };
  }
  function netOpened(s) {
    if (NET.sock !== s) return;
    NET.open = true; NET.retryMs = 1000;
    let token = NET.token;
    try { token = token || sessionStorage.getItem('bombsite-token'); } catch (e) { }
    netSend({ t: 'b_hello' });
    if (token) netSend({ t: 'b_resume', token });
    setStatus('on', 'Connected');
    renderRoom();
  }
  function netClosed(s) {
    if (NET.sock !== s) return;
    const was = NET.open;
    NET.open = false; NET.sock = null;
    if (NET.host && G) {
      // The server ends the match when the host drops
      toMenu(); NET.room = null; forgetToken(); setErr('Lost connection to the game server, so the match ended.');
    } else if (NET.client && G && !G.over) banner('Connection lost. Reconnecting…', 'warn', 4);
    setStatus('off', was ? 'Disconnected. Reconnecting…' : 'Game server is offline or waking up. Retrying…');
    renderRoom();
    if (tab === 'on' || NET.on) { NET.retryT = setTimeout(netConnect, NET.retryMs); NET.retryMs = Math.min(15000, NET.retryMs * 1.7); }
  }
  function netMsg(data) {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    try { onNet(m); } catch (e) { console.error(e); }
  }
  function onNet(m) {
    if (m.p && m.t === 'b_i') { if (NET.host) hostInput(m); return; }
    switch (m.t) {
      case 'b_welcome': if (m.token) saveToken(m.token); break;
      case 'b_room': {
        NET.room = m;
        if (tab !== 'on' && !G) setTab('on');
        renderRoom();
        break;
      }
      case 'b_err': setErr(m.msg); break;
      case 'b_closed':
        forgetToken(); NET.room = null;
        if (NET.on && G) { toMenu(); setTab('on'); }
        renderRoom();
        if (m.msg) setErr(m.msg);
        break;
      case 'b_go': if (NET.room && NET.room.isHost) hostStart(m.cfg || {}, m.players || []); break;
      case 'b_joined': if (NET.host) hostJoin(m.p, m.name, m.team); break;
      case 'b_left': if (NET.host) botify(m.p); break;
      case 'b_s':
        if (m.full) { setErr('That match is full. You\'ll get a place in the next one.'); break; }
        if (m.init) { clientInit(m); break; }
        if (NET.client && G) clientApply(m);
        break;
    }
  }

  // ══ Host ══
  function hostStart(cfg, players) {
    audio.init();
    for (const x of ents) if (x.model) scene.remove(x.model.s.root);
    ents = []; nextId = 1; intel = { T: new Map(), CT: new Map() };
    const diff = own(PRACTICE_AT, cfg.diff) ? cfg.diff : 'normal', at = PRACTICE_AT[diff];
    NET.at = at;
    // Sides: people who picked one get it, the rest even out the teams (5 a side at most)
    const tl = [], cl = [], auto = [];
    for (const p of players) (p.team === 'T' ? tl : p.team === 'CT' ? cl : auto).push(p);
    for (const p of shuffle(auto)) (tl.length <= cl.length ? tl : cl).push(p);
    while (tl.length > 5) cl.push(tl.pop());
    while (cl.length > 5) tl.push(cl.pop());
    const prof = profAt(at), names = shuffle(BOT_NAMES.slice());
    const add = (p, team) => {
      if (p.pid === NET.room.me) { player = makeEnt(p.name, team, true); ents.push(player); return; }
      const e = makeEnt(p.name, team, false); e.b = null; e.net = { pid: p.pid, q: [], st: null }; e.ownerPid = p.pid; ents.push(e);
    };
    tl.forEach(p => add(p, 'T')); cl.forEach(p => add(p, 'CT'));
    if (!player) { player = makeEnt(playerName(), tl.length <= cl.length ? 'T' : 'CT', true); ents.push(player); }
    const size = cfg.bots === 'even' ? Math.max(1, tl.length, cl.length) : 5;
    for (const t of ['T', 'CT']) {
      let have = ents.filter(e => e.team === t).length;
      while (have++ < size) ents.push(makeEnt('BOT ' + names.pop(), t, false, prof));
      const bots = ents.filter(e => e.b && e.team === t);
      if (bots.length) pick(bots).b.awper = true;
    }
    G = { ranked: false, online: true, at, label: `${DIFF_LABEL[diff]} bots`, round: 1, score: { T: 0, CT: 0 }, ls: { T: 0, CT: 0 }, ot: false, startT: T, over: false, history: [] };
    Object.assign(NET, { on: true, host: true, client: false, ev: [], acts: [], ids: { n: 0, s: 0, f: 0, d: 0 }, lastFull: -9, lastSend: -9, lastG: '', sendAcc: 0 });
    showGameUI();
    startRound();
    for (const e of ents) if (e.net) sendInit(e);
    // Said in startRound before their pages were ready
    if (bomb.carrier && bomb.carrier.net) radio('', 'You have the bomb. Plant it at A or B (hold E in the site).', 'T', bomb.carrier.id);
    startTicker();
    lockPointer();
  }
  // Someone joined (or came back) during the match: they take over a bot
  function hostJoin(p, name, team) {
    if (!G || G.over) return;
    let e = ents.find(x => x.ownerPid === p && !x.isPlayer);
    if (!e) {
      const humansOn = t => ents.filter(x => x.team === t && isHuman(x)).length;
      const t = team === 'T' || team === 'CT' ? team : humansOn('T') <= humansOn('CT') ? 'T' : 'CT';
      e = ents.find(x => x.b && x.team === t) || ents.find(x => x.b);
      if (!e) { netSend({ t: 'b_s', to: p, full: 1 }); return; }
    }
    e.b = null; e.net = { pid: p, q: [], st: null }; e.ownerPid = p; e.name = String(name || 'Player').slice(0, 16); e.netInfo = '';
    radio('', `${e.name} joined the ${TEAMNAME[e.team]}`, '');
    sendInit(e);
  }
  // Someone dropped out: a bot plays their place until they come back
  function botify(p) {
    const e = ents.find(x => x.net && x.net.pid === p);
    if (!e) return;
    e.net = null; e.b = newBrain(profAt(NET.at));
    if (e.team === 'CT') { e.b.role = 'M'; e.b.post = W.SPOTS.midHold[0]; } else { e.b.route = R.plan ? R.plan.T.main : 'long'; e.b.slotI = 0; }
    e.planting = null; e.defusing = null; e.pin = null;
    radio('', `${e.name} left; a bot is playing for them`, '');
  }
  function sendInit(e) {
    hostSend(true);   // everyone is up to date first; the new page starts from here
    const gun = w => w ? [w.def.id, w.ammo, w.reserve] : null;
    const w = new Wr(); timeBytes(w);
    for (const x of ents) if (x.alive) writeEnt(w, x.id, x.netBase || entState(x), null, true);
    netSend({
      t: 'b_s', to: e.net.pid, s: b64(w.b), i: ents.map(entInfo), g: gameInfo(),
      init: {
        me: e.id, label: G.label, T: r3(T), seq: G.round & 255, roster: ents.map(x => [x.id, x.name, x.team, isHuman(x) ? 1 : 0]),
        pos: [r3(e.pos.x), r3(e.pos.y), r3(e.pos.z), r3(e.yaw)], guns: [gun(e.prim), gun(e.sec)], slot: e.slot,
        smokes: smokes.map(s => [s.sid, r2(s.x), r2(s.y), r2(s.z), r2(T - s.t0)]),
        fires: fires.map(f => [f.fid, r2(f.x), r2(f.y), r2(f.z), f.pts.flatMap(p => [r2(p.x), r2(p.z)]), r2(f.until - T)]),
        drops: drops.map(d => [d.id, d.w.def.id, r2(d.x), r2(d.y), r2(d.z)]),
        pd: ents.filter(x => x.planting || x.defusing).map(x => [x.id, x.planting ? 'p' : 'd', r3((x.planting || x.defusing).t0), x.defusing ? x.defusing.len : 0]),
      },
    });
  }
  const entInfo = e => [e.id, e.team === 'T' ? 0 : 1, e.alive ? 1 : 0, e.hp, e.armor, e.helmet ? 1 : 0, e.kit ? 1 : 0, Math.round(e.money),
    e.stats.k, e.stats.d, e.stats.a, e.stats.hs, e.stats.mvp, e.prim ? e.prim.def.id : '', e.sec ? e.sec.def.id : '', e.zeus ? 1 : 0,
    e.nades.join(','), e.bomb ? 1 : 0, e.name, isHuman(e) ? 1 : 0];
  const gameInfo = () => ({
    r: G.round, s: [G.score.T, G.score.CT], ot: G.ot ? 1 : 0, ph: R.phase, t0: r3(R.t0), la: r3(R.liveAt), ea: r3(R.endAt), na: r3(R.nextAt || 0), pl: R.planted ? 1 : 0,
    b: [bomb.state, r2(bomb.x), r2(bomb.y), r2(bomb.z), bomb.site || '', r3(bomb.explodeAt), bomb.carrier ? bomb.carrier.id : 0, bomb.defuser ? bomb.defuser.id : 0],
  });
  function hostSend(force) {
    if (!NET.host || !G) return;
    if (!ents.some(e => e.net)) { NET.ev.length = 0; return; }   // nobody else is here
    const full = force || T - NET.lastFull >= FULL_EVERY;
    if (full) NET.lastFull = T;
    const w = new Wr(); timeBytes(w);
    let n = 0;
    for (const e of ents) {
      if (!e.alive) { e.netBase = null; continue; }
      const len = w.b.length;
      e.netBase = writeEnt(w, e.id, entState(e), e.netBase, full);
      if (w.b.length > len) n++;
    }
    for (const e of ents) {
      const pd = e.planting || e.defusing, k = pd ? (e.planting ? 'p' : 'd') + pd.t0 : '';
      if (k !== (e.netPd || '')) { e.netPd = k; emit(['pd', e.id, k ? k[0] : '', pd ? r3(pd.t0) : 0, e.defusing ? e.defusing.len : 0]); }
    }
    const infos = [];
    for (const e of ents) { const a = entInfo(e), k = JSON.stringify(a); if (k !== e.netInfo) { e.netInfo = k; infos.push(a); } }
    const gi = gameInfo(), gk = JSON.stringify(gi), gch = gk !== NET.lastG;
    NET.lastG = gk;
    if (!n && !NET.ev.length && !infos.length && !gch && !force && T - NET.lastSend < 0.5) return;
    NET.lastSend = T;
    const m = { t: 'b_s', s: b64(w.b) };
    if (NET.ev.length) m.e = NET.ev.splice(0);
    if (infos.length) m.i = infos;
    if (gch) m.g = gi;
    netSend(m);
  }
  function hostInput(m) {
    const e = ents.find(x => x.net && x.net.pid === m.p);
    if (!e) return;
    if (typeof m.s === 'string') { const st = readInput(m.s); if (st) { st.fresh = true; st.at = T; e.net.st = st; } }
    if (Array.isArray(m.a)) for (const a of m.a.slice(0, 40)) e.net.q.push(a);
  }
  function readInput(s) {
    const r = new Rd(s);
    if (r.left() < 19) return null;
    const st = { seq: r.u8(), x: DX(r.u16()), y: DY(r.u16()), z: DX(r.u16()), yaw: DA(r.u16()), pitch: r.i8() / 80, crouch: r.u8() / 255,
      vx: r.i8() / 12, vz: r.i8() / 12, vy: r.i8() / 6 };
    const fl = r.u8(), sl = r.u8();
    st.og = !!(fl & 1); st.use = !!(fl & 2); st.scope = (fl >> 5) & 3;
    st.slot = sl & 7; st.zeus = !!(sl & 8); st.nadeI = (sl >> 4) & 7;
    st.ammo = r.u8(); st.res = r.u16();
    return st;
  }
  // Each step: the other players' movement, then their actions, then plant / defuse and pick-ups
  function hostNetStep(dt) {
    const seq = G.round & 255;
    for (const e of ents) {
      if (!e.net) continue;
      const st = e.net.st, ok = st && st.seq === seq;
      if (e.alive && ok) {
        if (st.fresh) { st.fresh = false; applyInput(e, st); }
        else if (T - st.at < 0.2) {
          // Between their messages, carry on in the same direction (briefly: if they go quiet, they stand still)
          e.vel.y -= GRAV * dt;
          const r = W.moveBody(e.pos, e.vel.x * dt, e.vel.y * dt, e.vel.z * dt, 0.39, bodyH(e), e.onGround);
          if (r.ground) e.vel.y = 0;
          e.onGround = r.ground;
        }
      }
      const q = e.net.q; e.net.q = [];
      for (const a of q) { try { hostAction(e, a); } catch (err) { console.error(err); } }
      if (!e.alive) continue;
      const use = !!(ok && st.use);
      updatePlantDefuse(e, use && e.bomb, use && e.team === 'CT');
      if (e.planting || e.defusing) e.vel.x = e.vel.z = 0;
      autoPickup(e);
      footsteps(e, dt);
    }
  }
  function applyInput(e, st) {
    e.pos.x = st.x; e.pos.y = st.y; e.pos.z = st.z;
    e.vel.x = st.vx; e.vel.y = st.vy; e.vel.z = st.vz;
    e.yaw = st.yaw; e.pitch = st.pitch; e.crouch = clamp(st.crouch, 0, 1); e.onGround = st.og; e.scope = st.scope;
    const s = st.slot;
    if ((s === 1 && e.prim) || (s === 2 && e.sec) || s === 3 || (s === 4 && e.nades.length) || (s === 5 && e.bomb)) e.slot = s;
    e.sub3 = st.zeus && e.zeus ? 'zeus' : 'knife'; e.nadeI = st.nadeI;
    const w = cur(e);
    if (w && !w.nade && w.def.mag && !w.def.zeus) { w.ammo = Math.min(st.ammo, w.def.mag); w.reserve = Math.min(st.res, w.def.reserve || 0); }
  }
  function hostAction(e, a) {
    if (!Array.isArray(a)) return;
    switch (a[0]) {
      case 'f': if (e.alive) netFire(e, a); break;
      case 't': if (e.alive) netThrow(e, a); break;
      case 'b': if (e.alive) tryBuy(e, String(a[1])); break;
      case 'g':
        if (!e.alive) break;
        if (a[1] === 5 && e.bomb) dropBomb(e, false);
        else if (a[1] === 1 && e.prim) dropItem(e, e.prim, false);
        else if (a[1] === 2 && e.sec) dropItem(e, e.sec, false);
        break;
      case 'u': {
        const d = drops.find(x => x.id === a[1]);
        if (d && e.alive && Math.hypot(d.x - e.pos.x, d.z - e.pos.z) < 3.2) pickUp(e, d);
        break;
      }
      case 'r': if (e.alive) { audio.reload(eyePos(e)); noise(e, 'reload', 9); } break;
    }
  }
  function netFire(e, a) {
    const wid = a[1];
    if (!own(WD, wid)) return;
    const d = WD[wid];
    const w = d.melee ? KNIFE : d.zeus ? e.zeus : e.prim && e.prim.def.id === wid ? e.prim : e.sec && e.sec.def.id === wid ? e.sec : null;
    if (!w) return;
    const gap = d.melee ? 0.45 : 60 / d.rpm;
    if (T - (e.netShotT || -9) < gap * 0.5) return;   // faster than the gun can fire
    e.netShotT = T; e.lastShot = T;
    const ends = (Array.isArray(a[4]) ? a[4] : []).slice(0, 9).filter(x => Array.isArray(x) && x.length === 4 && x.every(v => isFinite(v))).map(x => x.map(Number));
    const snd = d.melee ? 'knife' : d.snd;
    shotFx(e, snd, ends);
    emit(['sh', e.id, snd, ends]);
    if (!d.melee) { noise(e, 'shot', d.cat === 'sniper' ? 95 : 70); const eye = eyePos(e); for (const en of ends) alertLine(e, eye, en); }
    if (d.zeus) { e.zeus = null; e.sub3 = 'knife'; }
    // Hits as the shooter saw them, checked for sense: an enemy, in range, no more than the gun can do
    for (const h of (Array.isArray(a[3]) ? a[3] : []).slice(0, d.pellets || 1)) {
      if (!Array.isArray(h)) continue;
      const v = byId(h[0]), raw = +h[2];
      if (!v || !v.alive || v === e || v.team === e.team || !(raw > 0)) continue;
      const far = Math.hypot(v.pos.x - e.pos.x, v.pos.z - e.pos.z);
      if (d.melee) { if (far < 3.5 && raw <= 180) damage(v, raw, 'chest', e, { ...d, pen: 0.85, name: 'Knife' }, {}); }
      else if (far < (d.zeus ? 5.5 : 240) && raw <= d.dmg * 1.001) damage(v, raw, own(HG, h[1]) ? h[1] : 'chest', e, d, {});
    }
  }
  function alertLine(src, o, en) {
    const dx = en[0] - o.x, dy = en[1] - o.y, dz = en[2] - o.z, L = Math.hypot(dx, dy, dz) || 1, d = { x: dx / L, y: dy / L, z: dz / L };
    for (const v of ents) {
      if (!v.b || !v.alive || v.team === src.team) continue;
      const vx = v.pos.x - o.x, vy = v.pos.y + 1.4 - o.y, vz = v.pos.z - o.z, t = clamp(vx * d.x + vy * d.y + vz * d.z, 0, L);
      if (Math.hypot(vx - d.x * t, vy - d.y * t, vz - d.z * t) < 3) alert(v, src);
    }
  }
  function netThrow(e, a) {
    const type = a[1], v = a.slice(2, 8).map(Number);
    if (!own(NADES, type) || !e.nades.includes(type) || v.length < 6 || v.some(x => !isFinite(x))) return;
    const eye = eyePos(e);
    if (Math.hypot(v[0] - eye.x, v[1] - eye.y, v[2] - eye.z) > 2.5 || Math.hypot(v[3], v[4], v[5]) > 32) return;
    e.nades.splice(e.nades.indexOf(type), 1);
    spawnNade(type, e, v[0], v[1], v[2], v[3], v[4], v[5], a[8] | 0);
  }
  // A shot someone else fired: muzzle flash, sound, tracers and where the bullets landed
  function shotFx(e, snd, ends) {
    const eye = eyePos(e);
    if (snd === 'knife') { e.swingT = T; audio.shot('knife', eye, 0.8); return; }
    const m = muzzleWorld(e);
    fx.billboard(m.x, m.y, m.z, snd === 'sniper' || snd === 'shotgun' ? 0.6 : 0.4, 0.05, 0xffd080);
    audio.shot(snd, eye, 1);
    ends.forEach((en, i) => { if (i < 2 && snd !== 'zeus') fx.tracer(m, { x: en[0], y: en[1], z: en[2] }); impactFx(en); });
    if (snd === 'zeus' && ends[0]) fx.particles(ends[0][0], ends[0][1], ends[0][2], 10, 0x9fd8ff, 3, 2, 0.3, null);
  }
  function impactFx(en) {
    const k = en[3];
    if (k >= 1 && k <= 6) {
      const n = NORMS[k - 1];
      fx.decal(en[0], en[1], en[2], n[0], n[1], n[2]);
      fx.particles(en[0], en[1], en[2], 6, 0xe0c49a, 3.5, 9, 0.45, { x: n[0] * 2, y: n[1] * 2 + 0.8, z: n[2] * 2 });
    } else if (k >= 7) fx.particles(en[0], en[1], en[2], k === 8 ? 9 : 5, 0xe8dcc4, 2.6, 5, 0.3, null);
  }
  // A worker keeps the host's match running while its tab is in the background (browsers stop drawing there)
  let lastFrameAt = 0;
  function startTicker() {
    if (NET.ticker) return;
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 25);'], { type: 'text/javascript' }));
      NET.ticker = new Worker(url);
      NET.ticker.onmessage = () => {
        // Only when the page isn't drawing (a background tab, a minimised window)
        const now = performance.now();
        if (!NET.host || now - lastFrameAt < 150) return;
        const rdt = Math.min(0.25, (now - last) / 1000); last = now;
        simTick(rdt); netTick(rdt);
      };
    } catch (e) { NET.ticker = null; }
  }
  function stopTicker() { if (NET.ticker) { NET.ticker.terminate(); NET.ticker = null; } }
  function netTick(rdt) {
    if (NET.host && G) {
      NET.sendAcc += rdt;
      if (NET.sendAcc >= SNAP_DT) { NET.sendAcc = Math.min(NET.sendAcc - SNAP_DT, SNAP_DT); hostSend(false); }
    } else if (NET.client && G && !G.over) {
      NET.inAcc += rdt;
      if (NET.inAcc >= SNAP_DT || (NET.acts.length && NET.inAcc >= 0.02)) { NET.inAcc = 0; clientSendInput(); }
    }
  }

  // ══ Client ══
  function clientInit(m) {
    const I = m.init;
    audio.init();
    for (const x of ents) if (x.model) scene.remove(x.model.s.root);
    clearRoundStuff();
    ents = [];
    for (const [id, name, team, human] of I.roster) {
      const e = makeEnt(name, team, id === I.me);
      e.id = id; e.b = null; e.human = !!human; e.nb = [];
      if (id !== I.me) e.netLook = null;
      ents.push(e);
    }
    player = byId(I.me);
    if (!player) return;
    T = +I.T || 0; NET.clock = true;
    G = { ranked: false, online: true, label: I.label, round: 1, score: { T: 0, CT: 0 }, ls: { T: 0, CT: 0 }, ot: false, startT: T, over: false, history: [] };
    R = { phase: 'freeze', t0: T, liveAt: T, endAt: T, nextAt: 0, planted: false, plan: null, winner: null };
    Object.assign(NET, { on: true, host: false, client: true, acts: [], seq: I.seq, lastIn: '', inAcc: 0, myInfo: null });
    player.netHold = 0;
    for (const a of m.i || []) applyEntInfo(a, true);
    if (m.g) applyGame(m.g);
    const [px, py, pz, pyaw] = I.pos;
    player.pos.x = px; player.pos.y = py; player.pos.z = pz; player.yaw = pyaw; player.pitch = 0; player.vel.x = player.vel.y = player.vel.z = 0;
    const mk = g => g && own(WD, g[0]) ? { def: WD[g[0]], ammo: g[1] | 0, reserve: g[2] | 0 } : null;
    player.prim = mk(I.guns[0]); player.sec = mk(I.guns[1]);
    player.slot = 0; selectSlot(player, I.slot && I.slot !== 4 ? I.slot : bestSlot(player)) || selectSlot(player, bestSlot(player));
    for (const [sid, x, y, z, age] of I.smokes) smokes.push({ x, y, z, t0: T - age, until: T - age + 18, R: 4.6, cloud: fx.smokeCloud(x, y, z, 4.6), sid });
    for (const [fid, x, y, z, flat, left] of I.fires) netFire_(fid, x, y, z, flat, left);
    for (const [id, wid, x, y, z] of I.drops) netDrop(id, wid, x, y, z, 0, 0, 0, 0);
    for (const [id, k, t0, len] of I.pd) { const e = byId(id); if (e) setPd(e, k, t0, len); }
    for (const e of ents) { ensureModel(e); if (e.model) { e.model.fall = e.alive ? 0 : 1; } }
    camMode = player.alive ? 'fp' : 'spec';
    if (m.s) applySnap(m.s);
    for (const e of ents) if (e !== player && e.nb.length) { const s = e.nb[e.nb.length - 1]; e.pos.x = s.x; e.pos.y = s.y; e.pos.z = s.z; e.yaw = s.yaw; }
    showGameUI(); setErr('');
    banner(`${TEAMNAME[player.team]}`, player.team === 'T' ? 't' : 'ct', 2.5, `Online match · ${G.label}`);
    lockPointer();
  }
  function clientApply(m) {
    // Events first (a new round resets the world), then the scoreboard and round state on top
    if (typeof m.s === 'string') applySnap(m.s);
    if (Array.isArray(m.e)) for (const ev of m.e) { try { clientEvent(ev); } catch (err) { console.error(err); } }
    if (Array.isArray(m.i)) for (const a of m.i) applyEntInfo(a, false);
    if (m.g) applyGame(m.g);
  }
  function applySnap(s) {
    const r = new Rd(s);
    if (r.left() < 4) return;
    const ts = (r.u16() * 65536 + r.u16()) / 1000;
    const seen = new Set();
    while (r.left() >= 9) {
      const id = r.u8(), fl = r.u8(), e = byId(id);
      let q;
      if (fl & 128) {
        const b = e && e.netBase;
        const dx = r.i8(), dy = r.i8(), dz = r.i8(), da = r.i8();
        q = { p: r.i8(), c: r.u8(), look: r.u8() };
        if (!b) continue;   // can't happen on an ordered connection; the next full set fixes it
        q.x = b.x + dx * DXY; q.y = b.y + dy * DYU; q.z = b.z + dz * DXY; q.a = (b.a + da * DAU + 65536) % 65536;
      } else {
        if (r.left() < 11) break;
        q = { x: r.u16(), y: r.u16(), z: r.u16(), a: r.u16(), p: r.i8(), c: r.u8(), look: r.u8() };
      }
      if (!e) continue;
      e.netBase = q;
      seen.add(e);
      if (fl & 64) e.spottedUntil = Math.max(e.spottedUntil, T + 0.3);
      if (e === player) continue;
      pushSample(e, { t: ts, x: DX(q.x), y: DY(q.y), z: DX(q.z), yaw: DA(q.a), pitch: q.p / 80, crouch: q.c / 255, fl, look: q.look });
    }
    // Unchanged players: same as last time, now
    for (const e of ents) if (e !== player && !seen.has(e) && e.alive && e.nb && e.nb.length) { const l = e.nb[e.nb.length - 1]; if (l.t < ts) pushSample(e, { ...l, t: ts }); }
    // Keep the clock in step with the host's
    const err = ts - T;
    if (!NET.clock || Math.abs(err) > 0.5) { T = ts; NET.clock = true; } else T += err * 0.08;
  }
  // Speed comes from how far they moved since the last snapshot
  function pushSample(e, smp) {
    const l = e.nb[e.nb.length - 1], dt = l ? smp.t - l.t : 0;
    if (dt > 0.001 && dt < 0.6) { smp.vx = (smp.x - l.x) / dt; smp.vy = (smp.y - l.y) / dt; smp.vz = (smp.z - l.z) / dt; }
    else { smp.vx = l ? l.vx : 0; smp.vy = 0; smp.vz = l ? l.vz : 0; }
    e.nb.push(smp); if (e.nb.length > 40) e.nb.shift();
  }
  // Everyone else is drawn a little in the past, between two snapshots, so they move smoothly
  function interpEnts() {
    const rt = T - INTERP;
    for (const e of ents) {
      if (e === player || !e.nb || !e.nb.length) continue;
      const b = e.nb;
      while (b.length > 2 && b[1].t <= rt) b.shift();
      const a = b[0], c = b[1] || b[0];
      const k = c.t > a.t ? clamp((rt - a.t) / (c.t - a.t), 0, 1) : 1;
      if (!e.alive) continue;
      e.pos.x = a.x + (c.x - a.x) * k; e.pos.y = a.y + (c.y - a.y) * k; e.pos.z = a.z + (c.z - a.z) * k;
      e.yaw = angDiff(a.yaw + angDiff(c.yaw, a.yaw) * k, 0); e.pitch = a.pitch + (c.pitch - a.pitch) * k; e.crouch = a.crouch + (c.crouch - a.crouch) * k;
      e.vel.x = c.vx; e.vel.y = c.vy; e.vel.z = c.vz; e.onGround = !!(c.fl & 1); e.scope = c.fl & 2 ? 1 : 0;
      e.netLook = LOOKS[c.look] || null;
    }
  }
  function applyEntInfo(a, initial) {
    if (!Array.isArray(a)) return;
    const e = byId(a[0]);
    if (!e) return;
    const [, tm, alive, hp, armor, helmet, kit, money, k, d, as, hs, mvp, prim, sec, zeus, nades, bombF, name, human] = a;
    const team = tm ? 'CT' : 'T';
    if (team !== e.team) { e.team = team; if (!initial) ensureModel(e); }
    e.hp = hp; e.armor = armor; e.helmet = !!helmet; e.kit = !!kit; e.money = money;
    Object.assign(e.stats, { k, d, a: as, hs, mvp });
    e.name = String(name); e.human = !!human;
    if (!alive && e.alive) clientDeath(e);
    else if (alive && !e.alive && e !== player) { e.alive = true; if (e.model) e.model.fall = 0; }
    if (e === player) { NET.myInfo = a; applyOwnInv(); return; }
    const gun = (old, id) => !id || !own(WD, id) ? null : old && old.def.id === id ? old : inst(id);
    e.prim = gun(e.prim, prim); e.sec = gun(e.sec, sec); e.zeus = zeus ? e.zeus || inst('zeus') : null;
    e.nades = nades ? String(nades).split(',').filter(n => own(NADES, n)) : []; e.bomb = !!bombF;
  }
  // Your own guns, grenades and bomb, unless you just threw or dropped something the host hasn't seen yet
  function applyOwnInv() {
    const a = NET.myInfo, e = player;
    if (!a || !e || T < (e.netHold || 0)) return;
    NET.myInfo = null;
    const prim = a[13], sec = a[14], zeus = a[15], nades = a[16], bombF = !!a[17];
    if (!prim || !own(WD, prim)) e.prim = null; else if (!e.prim || e.prim.def.id !== prim) e.prim = inst(prim);
    if (!sec || !own(WD, sec)) e.sec = null; else if (!e.sec || e.sec.def.id !== sec) e.sec = inst(sec);
    if (zeus && !e.zeus) e.zeus = inst('zeus'); else if (!zeus) e.zeus = null;
    e.nades = nades ? String(nades).split(',').filter(n => own(NADES, n)) : [];
    if (bombF && !e.bomb && R && R.phase !== 'freeze' && e.alive) { banner('You picked up the bomb', 'info', 2); audio.draw(null); }
    e.bomb = bombF;
    if (e.sub3 === 'zeus' && !e.zeus) e.sub3 = 'knife';
    if (e.nades.length) e.nadeI %= e.nades.length;
    const ok = (e.slot === 1 && e.prim) || (e.slot === 2 && e.sec) || e.slot === 3 || (e.slot === 4 && e.nades.length) || (e.slot === 5 && e.bomb);
    if (!ok && e.alive) { e.slot = 0; selectSlot(e, bestSlot(e)); }
  }
  function applyGame(g) {
    if (!g || !G || !R) return;
    G.round = g.r; G.score.T = g.s[0]; G.score.CT = g.s[1]; G.ot = !!g.ot;
    if (R.phase === 'freeze' && g.ph === 'live') audio.ui('start');
    R.phase = g.ph; R.t0 = g.t0; R.liveAt = g.la; R.endAt = g.ea; R.nextAt = g.na; R.planted = !!g.pl;
    const [st, x, y, z, site, ex, car, def] = g.b, prev = bomb.state;
    bomb.state = st; bomb.x = x; bomb.y = y; bomb.z = z; bomb.site = site || null; bomb.explodeAt = ex;
    bomb.carrier = car ? byId(car) : null; bomb.defuser = def ? byId(def) : null;
    if (st === 'dropped' || st === 'planted' || st === 'defused') {
      bombMesh(); bomb.mesh.visible = true;
      bomb.mesh.position.set(x, y + (st === 'dropped' ? 0.06 : 0.08), z);
      if (st === 'planted' && prev !== 'planted') { bomb.nextBeep = T + 1; bomb.mesh.rotation.set(0, rand(0, TAU), 0); }
      if (st !== 'planted' && bomb.led) bomb.led.visible = false;
    } else if (bomb.mesh) bomb.mesh.visible = false;
  }
  function setPd(e, k, t0, len) {
    if (k === 'p') {
      e.planting = { t0, beeps: Math.floor(clamp((T - t0) / PLANT_TIME, 0, 1) * 7) }; e.defusing = null;
      if (e === player && e.slot !== 5) { e.lastSlot = e.slot; e.slot = 5; vmState.drawT = T - 1; }
    } else if (k === 'd') { e.defusing = { t0, len, tick: 0 }; e.planting = null; }
    else { e.planting = null; e.defusing = null; }
  }
  function clientDeath(v) {
    if (!v.alive) return;
    v.alive = false; v.deadAt = T; v.hp = 0; v.planting = null; v.defusing = null; v.pin = null; v.scope = 0;
    if (v.model) v.model.fallDir = Math.random() < 0.5 ? 1 : -1;
    if (v === player) { camMode = 'dead'; specAt = T + 1.8; setBuy(false); }
  }
  function netFire_(fid, x, y, z, flat, left) {
    const pts = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i], z: flat[i + 1] });
    if (!pts.length) pts.push({ x, z });
    fires.push({ x, y, z, pts, t0: T, until: T + (left == null ? 7 : left), owner: null, vis: fx.fire(pts, y), crackle: 0, fid });
  }
  function netDrop(id, wid, x, y, z, vx, vy, vz, by) {
    if (!own(WD, wid)) return;
    const m = models.gun(WD[wid].look);
    m.rotation.set(0, rand(0, TAU), PI / 2);
    scene.add(m);
    drops.push({ id, w: { def: WD[wid], ammo: 0, reserve: 0 }, x, y, z, vx, vy, vz, mesh: m, t: T, by });
  }
  function clientEvent(ev) {
    if (!Array.isArray(ev)) return;
    const E = id => byId(id);
    switch (ev[0]) {
      case 'sh': { const e = E(ev[1]); if (e && e !== player) { shotFx(e, ev[2], ev[3] || []); e.lastShot = T; } break; }
      case 'k': {
        const a = E(ev[1]), v = E(ev[2]);
        if (!v) break;
        feed(a, v, ev[3], !!ev[4], !!ev[5]);
        if (a === player && v.team !== player.team) audio.ui('kill');
        clientDeath(v);
        break;
      }
      case 'hu': {
        if (ev[1] !== player.id) break;
        const [, , fx_, fz_, dmg, hp, fire] = ev;
        player.hp = hp;
        hurtHUD(fx_ == null ? null : { x: fx_, z: fz_ }, dmg);
        if (!fire || Math.random() < 0.25) audio.hurt();
        if (!fire) { player.tagUntil = T + 0.35; player.kickP += rand(0.012, 0.03) * Math.min(1.5, dmg / 30); player.kickY += rand(-0.015, 0.015); }
        break;
      }
      case 'n': {
        const [, nid, type, oid, x, y, z, vx, vy, vz, cid] = ev, o = E(oid);
        if (!o || !own(NADES, type)) break;
        if (o === player && cid) { const mine = nades.find(n => n.cid === cid && !n.nid); if (mine) { mine.nid = nid; break; } }
        spawnNade(type, o, x, y, z, vx, vy, vz).nid = nid;
        break;
      }
      case 'nd': netDetonate(ev); break;
      case 'fi': { const [, fid, x, y, z, flat] = ev; netFire_(fid, x, y, z, flat); audio.glass({ x, y, z }); break; }
      case 'fo': { const f = fires.find(x => x.fid === ev[1]); if (f) { f.until = Math.min(f.until, T + 0.3); audio.fizzle(f); } break; }
      case 'ds': { const [, x, y, z, snd, n] = ev, p = { x, y, z }; for (let k = 0; k < Math.min(5, n | 0); k++) setTimeout(() => { if (G) audio.shot(snd, p, 1); }, k * 110); break; }
      case 'dr': { const [, id, wid, x, y, z, vx, vy, vz, by] = ev; netDrop(id, wid, x, y, z, vx, vy, vz, by); break; }
      case 'dx': { const d = drops.find(x => x.id === ev[1]); if (d) removeDrop(d); break; }
      case 'pl': banner('Bomb has been planted', 'warn', 3); audio.ui('planted'); break;
      case 'bx': {
        const [, x, y, z] = ev;
        bomb.state = 'exploded'; if (bomb.mesh) bomb.mesh.visible = false;
        explosion(x, y + 0.5, z, null, 500, 32, 'Bomb');
        fx.billboard(x, y + 4, z, 30, 1.2, 0xffb060);
        break;
      }
      case 'pd': { const e = E(ev[1]); if (e) setPd(e, ev[2], ev[3], ev[4]); break; }
      case 'rs': clientRoundStart(ev); break;
      case 're': {
        const [, winner, reason, mvpId, rk] = ev, mvp = E(mvpId);
        R.phase = 'over';
        const text = { elim: `${TEAMNAME[winner]} win`, bomb: 'Target bombed', defuse: 'Bomb defused', time: 'Time ran out' }[reason] || '';
        const sub = (mvp ? `MVP: ${mvp === player ? 'you' : mvp.name}` + (rk ? ` · ${rk} kill${rk === 1 ? '' : 's'}` : '') : '') + ` · ${player.team === winner ? 'Round won' : 'Round lost'}`;
        banner(text, winner === 'T' ? 't' : 'ct', POST_TIME - 0.3, sub);
        audio.ui(winner === player.team ? 'win' : 'lose');
        break;
      }
      case 'r': radio(ev[1], ev[2], ev[3], ev[4]); break;
      case 'mp': if (ev[1] === player.id) moneyPop(ev[2]); break;
      case 'gv': {
        const [, id, slot, wid, ammo, res] = ev;
        if (id !== player.id || !own(WD, wid) || (slot !== 1 && slot !== 2)) break;
        const w = { def: WD[wid], ammo: ammo | 0, reserve: res | 0 };
        if (slot === 1) player.prim = w; else player.sec = w;
        player.slot = 0; selectSlot(player, slot); audio.draw(null);
        break;
      }
      case 'end': clientEnd(!!ev[1]); break;
    }
  }
  function netDetonate(ev) {
    const [, nid, type, x, y, z, flag, sid] = ev, p = { x, y, z };
    const i = nades.findIndex(n => n.nid === nid);
    if (i >= 0) { scene.remove(nades[i].mesh); nades.splice(i, 1); }
    if (type === 'flash') {
      fx.billboard(x, y, z, 7, 0.25, 0xffffff); fx.particles(x, y, z, 18, 0xffffff, 6, 2, 0.4, null);
      audio.flashBang(p); flashEnt(player, x, y, z);
    } else if (type === 'he') explosion(x, y, z, null, 98, 9.5, 'HE Grenade');
    else if (type === 'smoke') {
      const gy = y - 0.07;
      smokes.push({ x, y: gy, z, t0: T, until: T + 18, R: 4.6, cloud: fx.smokeCloud(x, gy, z, 4.6), sid });
      audio.smokePop(p);
    } else if ((type === 'molotov' || type === 'incendiary') && flag) {
      audio.fizzle(p); fx.particles(x, y, z, 14, 0xff8a30, 3, 3, 0.5, null); if (flag === 2) audio.glass(p);
    }
  }
  function clientRoundStart(ev) {
    const [, round, spawns] = ev;
    const swap = round === HALF + 1, ot = round === HALF * 2 + 1, died = !player.alive || swap || ot;
    clearRoundStuff();
    G.round = round;
    for (const [id, x, y, z, yaw] of spawns) {
      const e = byId(id);
      if (!e) continue;
      e.alive = true; e.hp = 100; e.deadAt = 0; e.planting = null; e.defusing = null; e.flashUntil = 0; e.spottedUntil = 0;
      e.pos.x = x; e.pos.y = y; e.pos.z = z; e.yaw = yaw; e.pitch = 0; e.vel.x = e.vel.y = e.vel.z = 0; e.crouch = 0; e.onGround = true;
      if (e !== player) e.nb = [];
      ensureModel(e);
      if (e.model) { e.model.fall = 0; e.model.s.root.visible = true; if (e.model.s.tag) e.model.s.tag.visible = true; }
    }
    const e = player;
    if (died) { e.prim = null; e.sec = inst(e.team === 'T' ? 'glock' : 'usp'); e.nades = []; e.zeus = null; e.bomb = false; }
    e.pin = null; e.scope = 0; e.reloadUntil = 0; e.recoilIdx = 0; e.punchP = e.punchY = e.kickP = e.kickY = 0; e.tagUntil = 0; e.netHold = 0; e.jumpBuf = 0;
    e.slot = 0; selectSlot(e, bestSlot(e)); e.switchUntil = 0; e.nextFire = 0;
    NET.seq = round & 255;
    camMode = 'fp'; setBuy(false);
    applyOwnInv();
    if (swap) banner('Switching sides', 'info', 3);
    else if (ot) banner('Overtime: one round decides it', 'warn', 3.5);
    else banner(round === 1 ? 'Match start · buy with B' : `Round ${round}`, 'info', 2.2);
  }
  function clientEnd(quit) {
    if (!G || G.over) return;
    G.over = true;
    unlockPointer(); setBuy(false); $('board').hidden = true;
    const mine = G.score[player.team], theirs = G.score[other(player.team)];
    showEnd(!quit && mine > theirs, mine, theirs, '', quit ? 'The host ended the match.' : 'Online match');
  }
  function clientPlantSounds() {
    for (const e of ents) {
      if (e.planting) {
        const k = (T - e.planting.t0) / PLANT_TIME;
        if (e.planting.beeps < 7 && k >= (e.planting.beeps + 1) / 7) { e.planting.beeps++; audio.plantBeep(e === player ? null : e.pos, e.planting.beeps); }
      }
      if (e.defusing && T > (e.defusing.tick || 0)) { audio.defuseTick(e === player ? null : e.pos); e.defusing.tick = T + 0.5; }
    }
  }
  function clientStep(dt) {
    interpEnts();
    if (player.alive) { playerUpdate(dt); entUpdate(player, dt); }
    for (const e of ents) if (e !== player && e.alive) footsteps(e, dt);
    clientPlantSounds();
    separate();
    updateNades(dt); updateUtil(dt); updateBomb(dt); updateDrops(dt);
    playerSpotting();
    if (NET.myInfo) applyOwnInv();
    if (buyOpen() && (!player.alive || !canBuyNow(player))) setBuy(false);
    if (buyOpen()) renderBuyThrottled(dt);
  }
  function clientSendInput() {
    const e = player, w = new Wr();
    w.u8(NET.seq); w.u16(QX(e.pos.x)); w.u16(QY(e.pos.y)); w.u16(QX(e.pos.z)); w.u16(QA(e.yaw));
    w.i8(e.pitch * 80); w.u8(e.crouch * 255); w.i8(e.vel.x * 12); w.i8(e.vel.z * 12); w.i8(e.vel.y * 6);
    w.u8((e.onGround ? 1 : 0) | (e.netUse && e.alive ? 2 : 0) | ((e.scope & 3) << 5));
    w.u8((e.slot & 7) | (e.sub3 === 'zeus' ? 8 : 0) | ((e.nadeI & 7) << 4));
    const cw = cur(e), mag = cw && !cw.nade && cw.def.mag && !cw.def.zeus;
    w.u8(mag ? cw.ammo : 0); w.u16(mag ? cw.reserve : 0);
    const s = b64(w.b), now = performance.now();
    // Standing still with nothing to say: only a reminder twice a second
    if (!NET.acts.length && s === NET.lastIn && now - NET.lastInT < 500) return;
    NET.lastIn = s; NET.lastInT = now;
    const m = { t: 'b_i', s };
    if (NET.acts.length) m.a = NET.acts.splice(0);
    netSend(m);
  }

  // ══ Lobby ══
  const setErr = t => { $('onErr').textContent = t || ''; };
  function setStatus(cls, text) { $('onDot').className = 'dot ' + cls; $('onStatus').textContent = text; }
  function renderRoom() {
    const room = NET.room;
    $('onHome').hidden = !!room; $('onRoom').hidden = !room;
    for (const id of ['onCreate', 'onJoin']) $(id).disabled = !NET.open;
    if (!room) return;
    $('roomCode').textContent = room.code;
    const side = t => t === 'T' ? '<span class="tg t">T</span>' : t === 'CT' ? '<span class="tg ct">CT</span>' : '<span class="tg">Auto</span>';
    $('roomList').innerHTML = room.players.map(p => `<div class="${p.on ? '' : 'off'}${p.pid === room.me ? ' me' : ''}">${side(p.team)}<b>${esc(p.name)}</b>${p.host ? '<small>host</small>' : ''}${p.on ? '' : '<small>offline</small>'}</div>`).join('');
    const mine = room.players.find(p => p.pid === room.me);
    for (const b of $('teamSeg').children) b.classList.toggle('on', !!mine && b.dataset.v === mine.team);
    for (const b of $('botsSeg').children) { b.classList.toggle('on', b.dataset.v === room.cfg.bots); b.disabled = !room.isHost; }
    for (const b of $('bdiffSeg').children) { b.classList.toggle('on', b.dataset.v === room.cfg.diff); b.disabled = !room.isHost; }
    const n = room.players.length;
    $('roomHint').textContent = room.inGame ? (G && NET.on ? 'Match in progress.' : 'A match is on. You\'ll take a bot\'s place in it if there is one, or play the next match.')
      : (room.isHost ? 'You are the host. Share the code, pick the settings, then start. ' : 'Waiting for the host to start. ') +
      `${n} of ${room.max} people · ${room.cfg.bots === 'even' ? 'bots even out the teams' : `${Math.max(0, 10 - n)} bots fill the rest`}.`;
    $('roomStart').hidden = !room.isHost || room.inGame;
    $('roomStart').disabled = !NET.open;
  }
  $('onCreate').onclick = () => { setErr(''); netSend({ t: 'b_create', name: playerName(), cfg: { diff: settings.diff, bots: 'fill' } }); };
  $('onJoin').onclick = () => {
    const code = $('codeIn').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { setErr('Codes are 4 letters'); return; }
    setErr(''); netSend({ t: 'b_join', name: playerName(), code });
  };
  $('codeIn').addEventListener('keydown', ev => { if (ev.key === 'Enter') $('onJoin').click(); });
  $('teamSeg').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) netSend({ t: 'b_team', team: b.dataset.v }); });
  const sendCfg = (k, v) => { if (NET.room && NET.room.isHost) netSend({ t: 'b_cfg', cfg: { ...NET.room.cfg, [k]: v } }); };
  $('botsSeg').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) sendCfg('bots', b.dataset.v); });
  $('bdiffSeg').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) sendCfg('diff', b.dataset.v); });
  $('roomStart').onclick = () => { setErr(''); netSend({ t: 'b_start' }); };
  $('roomLeave').onclick = () => { netSend({ t: 'b_leave' }); forgetToken(); NET.room = null; renderRoom(); };
  $('roomCopy').onclick = () => { try { navigator.clipboard.writeText(NET.room.code); $('roomCopy').textContent = 'Copied'; setTimeout(() => { $('roomCopy').textContent = 'Copy'; }, 1200); } catch (e) { } };

  // ══════════════ Menu ══════════════
  const RK = Ranked.create('bombsite', { wins: [1, 1, 2, 2, 3], crEveryRun: true });
  const playerName = () => ($('nameIn').value.replace(/\s+/g, ' ').trim().slice(0, 16)) || 'You';
  $('nameIn').value = store.get('name', '');
  $('nameIn').oninput = () => store.set('name', $('nameIn').value);
  let tab = store.get('tab', 'rk');
  function setTab(t) {
    tab = t; store.set('tab', t);
    $('tabRk').classList.toggle('on', t === 'rk'); $('tabSp').classList.toggle('on', t === 'sp'); $('tabOn').classList.toggle('on', t === 'on');
    $('rkPanel').hidden = t !== 'rk'; $('spPanel').hidden = t !== 'sp'; $('onPanel').hidden = t !== 'on';
    if (t === 'rk') renderRank();
    if (t === 'on') { renderRoom(); netConnect(); }
  }
  function renderRank() {
    $('rkCard').innerHTML = RK.card('Ranked: random side, first to 6 rounds.');
    $('rkInfo').textContent = `${RK.placing ? RK.matchLabel : RK.tierName + ' match'}: ${RANK_LABEL[RK.botTier]}.`;
  }
  $('tabRk').onclick = () => setTab('rk');
  $('tabSp').onclick = () => setTab('sp');
  $('tabOn').onclick = () => setTab('on');
  function renderSettings() {
    for (const seg of document.querySelectorAll('.seg[data-key]')) for (const b of seg.children) b.classList.toggle('on', b.dataset.v === settings[seg.dataset.key]);
    $('sensIn').value = settings.sens; setText($('sensVal'), settings.sens.toFixed(2));
    setText($('muteBtn'), 'Sound: ' + (settings.sound ? 'on' : 'off')); setText($('pauseMute'), 'Sound: ' + (settings.sound ? 'on' : 'off'));
  }
  for (const seg of document.querySelectorAll('.seg[data-key]')) seg.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const k = seg.dataset.key;
    if (k === 'quality' && settings.quality !== b.dataset.v) { store.set('quality', b.dataset.v); location.reload(); return; }
    settings[k] = b.dataset.v; store.set(k, b.dataset.v); renderSettings();
  });
  $('sensIn').oninput = () => { settings.sens = clamp(parseFloat($('sensIn').value) || 1, 0.1, 4); store.set('sens', settings.sens); renderSettings(); };
  const toggleSound = () => { settings.sound = !settings.sound; store.set('sound', settings.sound ? '1' : '0'); audio.setOn(settings.sound); renderSettings(); };
  $('muteBtn').onclick = toggleSound; $('pauseMute').onclick = toggleSound;
  $('rkPlayBtn').onclick = () => {
    const at = RANK_AT[RK.botTier];
    startMatch({ ranked: true, at, teamAt: Math.max(1, at - 0.6), side: 'random', label: RK.matchLabel });
  };
  $('playBtn').onclick = () => {
    const at = PRACTICE_AT[settings.diff];
    startMatch({ ranked: false, at, teamAt: Math.max(1, at - 0.6), side: settings.side, label: { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' }[settings.diff] });
  };
  $('pauseResume').onclick = () => lockPointer();
  $('pauseLeave').onclick = () => {
    if (NET.on && G && !G.over) {
      if (NET.host) { if (confirm('End this match for everyone?')) endMatch(true); return; }
      netSend({ t: 'b_leave' }); forgetToken(); NET.room = null; toMenu(); return;
    }
    if (G && G.ranked && !G.over && !confirm('Leave this ranked match? It counts as a loss.')) return;
    if (G && G.ranked && !G.over) endMatch(true); else toMenu();
  };
  $('clickBox').onclick = () => lockPointer();
  $('endAgain').onclick = () => {
    if (G && G.online) { toMenu(); setTab('on'); return; }
    const r = G && G.ranked; toMenu(); (r ? $('rkPlayBtn') : $('playBtn')).click();
  };
  $('endMenu').onclick = () => toMenu();
  if (matchMedia('(hover: none)').matches) $('touchNote').hidden = false;
  addEventListener('beforeunload', ev => { if (G && !G.over && (G.ranked || NET.host)) { ev.preventDefault(); ev.returnValue = ''; } });
  renderSettings(); setTab(tab);
  // Back after a reload in the middle of an online match? Rejoin it.
  try { if (sessionStorage.getItem('bombsite-token') && tab !== 'on') setTab('on'); } catch (e) { }

  // ══════════════ Main loop ══════════════
  function separate() {
    if (NET.client) {
      // Only your own player is moved here; everyone else is where the host says
      if (!player.alive) return;
      for (const b of ents) {
        if (b === player || !b.alive) continue;
        const dx = b.pos.x - player.pos.x, dz = b.pos.z - player.pos.z, d = Math.hypot(dx, dz);
        if (d >= 0.78 || d < 1e-4 || Math.abs(player.pos.y - b.pos.y) > 1.6) continue;
        const push = (0.78 - d) * 0.5;
        W.moveBody(player.pos, -dx / d * push, 0, -dz / d * push, 0.39, bodyH(player), false);
      }
      return;
    }
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i]; if (!a.alive) continue;
      for (let j = i + 1; j < ents.length; j++) {
        const b = ents[j]; if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d >= 0.78 || d < 1e-4 || Math.abs(a.pos.y - b.pos.y) > 1.6) continue;
        const push = (0.78 - d) / 2, nx = dx / d * push, nz = dz / d * push;
        const ab = a.net ? 0 : a.isPlayer ? 0.3 : 1, bb = b.net ? 0 : b.isPlayer ? 0.3 : 1;
        W.moveBody(a.pos, -nx * ab, 0, -nz * ab, 0.39, bodyH(a), false);
        W.moveBody(b.pos, nx * bb, 0, nz * bb, 0.39, bodyH(b), false);
      }
    }
  }
  let spotT = 0;
  function playerSpotting() {
    spotT -= 1; if (spotT > 0) return; spotT = 6;
    if (!player.alive) return;
    const f = fwd(player.yaw, player.pitch), ey = eyePos(player);
    for (const o of ents) {
      if (!o.alive || o.team === player.team) continue;
      const dx = o.pos.x - ey.x, dy = o.pos.y + 1.2 - ey.y, dz = o.pos.z - ey.z, L = Math.hypot(dx, dy, dz);
      if ((dx * f.x + dy * f.y + dz * f.z) / L < 0.55) continue;
      if (canSee(player, o)) { o.spottedUntil = T + 0.7; intel[player.team].set(o.id, { x: o.pos.x, z: o.pos.z, t: T, site: siteSide(o.pos.x, o.pos.z) }); }
    }
  }
  function entUpdate(e, dt) {
    if (!e.alive) return;
    updateReload(e);
    const w = cur(e);
    if (w && w.def.rpm && T - e.lastShot > 60 / w.def.rpm * 1.15) e.recoilIdx = Math.max(0, e.recoilIdx - dt * (w.def.recover || 10));
    if (w && w.def.rpm) { const [ry, rp] = recoil(w.def, e.recoilIdx); const k = Math.min(1, dt * 18); e.punchP += (rp * 0.5 - e.punchP) * k; e.punchY += (ry * 0.5 - e.punchY) * k; }
    else { e.punchP *= Math.exp(-dt * 10); e.punchY *= Math.exp(-dt * 10); }
    e.kickP *= Math.exp(-dt * 9); e.kickY *= Math.exp(-dt * 9);
  }
  function step(dt) {
    roundUpdate();
    if (!G || G.over) return;
    if (NET.host) hostNetStep(dt);
    planUpdate();
    playerUpdate(dt);
    for (const e of ents) if (e.b) botUpdate(e, dt);
    for (const e of ents) entUpdate(e, dt);
    separate();
    updateNades(dt); updateUtil(dt); updateBomb(dt); updateDrops(dt);
    playerSpotting();
    if (buyOpen() && (!player.alive || !canBuyNow(player))) setBuy(false);
    if (buyOpen()) renderBuyThrottled(dt);
  }
  let buyT = 0;
  function renderBuyThrottled(dt) { buyT -= dt; if (buyT <= 0) { buyT = 0.25; renderBuy(); } }
  let last = performance.now(), speedMul = 1, freeT = 0;
  // Online matches don't pause (Esc only frees the mouse). A client only moves its own player.
  function simTick(dt) {
    if (!G || G.over || (paused && !NET.on)) return;
    const n = Math.max(1, Math.ceil(dt / 0.025));
    if (NET.client) { for (let i = 0; i < n; i++) { T += dt / n; clientStep(dt / n); if (!G || G.over) break; } return; }
    for (let i = 0; i < n; i++) { T += dt / n; step(dt / n); if (!G || G.over) break; }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000, rdt = Math.min(0.05, raw), dt = rdt * speedMul; last = now; lastFrameAt = performance.now();
    // Online the match has to keep real time even when the browser draws slowly (steps are split up inside)
    simTick(NET.on ? Math.min(0.25, Math.max(0, raw)) : dt);
    netTick(NET.on ? Math.min(0.25, Math.max(0, raw)) : rdt);
    if (G && !G.over && !paused && !buyOpen() && document.pointerLockElement !== cv) { freeT += dt; if (freeT > 0.5) $('clickBox').hidden = false; } else { freeT = 0; $('clickBox').hidden = true; }
    if (G) {
      for (const e of ents) syncModel(e, dt);
      fx.update(dt);
      updateVM(dt);
      if (!G.over) hud(dt);
    }
    updateCamera(dt);
    render();
  }
  requestAnimationFrame(frame);

  // Test hook, only on a local dev server with ?debug in the address
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('debug')) {
    window.bsDebug = {
      get T() { return T; }, get G() { return G; }, get R() { return R; }, get ents() { return ents; }, get player() { return player; }, bomb, smokes, fires, nades, drops,
      startMatch, setSpeed(s) { speedMul = s; }, step, tryBuy, throwNade, selectSlot, shoot, endRound, perceive, solveThrow, simulateNade, W,
      unpause() { paused = false; $('pauseBox').hidden = true; },
      // Run the game without rendering (dt steps), then draw one frame; returns ms per step and for the frame
      advance(sec, dt) {
        dt = dt || 1 / 60; const t0 = performance.now(); let n = 0;
        for (let t = 0; t < sec && G && !G.over; t += dt) { T += dt; step(dt); n++; }
        const t1 = performance.now();
        if (G) { for (const e of ents) syncModel(e, dt); fx.update(dt); updateVM(dt); if (!G.over) hud(dt); }
        updateCamera(dt); render();
        return { stepMs: n ? (t1 - t0) / n : 0, frameMs: performance.now() - t1 };
      },
      setCam(mode, id) { camMode = mode; if (id) specId = id; },
      get NET() { return NET; }, keys, mouse, simTick, netTick, doBuy, doDrop, get camMode() { return camMode; },
      // Run the game for ms of real time even in a background tab (a worker keeps time), then draw a frame
      pump(ms) {
        return new Promise(res => {
          const wk = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 16);'])));
          const end = performance.now() + ms;
          wk.onmessage = () => {
            const now = performance.now(), rdt = Math.min(0.05, (now - last) / 1000); last = now;
            simTick(rdt); netTick(rdt);
            if (now < end) return;
            wk.terminate();
            if (G) { for (const e of ents) syncModel(e, rdt); fx.update(rdt); updateVM(rdt); if (!G.over) hud(rdt); }
            updateCamera(rdt); render(); res(true);
          };
        });
      },
    };
  }
})();

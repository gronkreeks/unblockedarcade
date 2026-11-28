// Clan Wars bootstrap: renderer, game object, world setup, save/load, main loop.
import * as THREE from 'three';
import { World } from './world/WorldGeneration.js';
import { buildTerrain, updateTerrainLOD } from './world/Terrain.js';
import { buildMonuments } from './world/Monuments.js';
import { Environment } from './world/Environment.js';
import { Physics } from './physics/Physics.js';
import { SpatialHash } from './core/spatial.js';
import { EventBus, getUidCounter, setUidCounter, pick, randRange } from './core/util.js';
import { ResourceSystem } from './systems/ResourceSystem.js';
import { LootSystem } from './systems/LootSystem.js';
import { BuildingSystem } from './systems/BuildingSystem.js';
import { Deployables } from './systems/Deployables.js';
import { CraftingSystem } from './systems/CraftingSystem.js';
import { CombatSystem } from './systems/CombatSystem.js';
import { SurvivalSystem } from './systems/SurvivalSystem.js';
import { AnimalSystem } from './systems/AnimalSystem.js';
import { NPCSystem } from './systems/NPCSystem.js';
import { BotTeams } from './bots/BotTeams.js';
import { BotManager } from './bots/BotManager.js';
import { WorldSimulation } from './sim/WorldSimulation.js';
import { SaveSystem } from './save/SaveSystem.js';
import { OnlineBoard } from './save/OnlineBoard.js';
import { UIManager } from './ui/UIManager.js';
import { PlayerController } from './player/PlayerController.js';
import { Audio } from './audio/Audio.js';
import { Survivor } from './entities/Survivor.js';
import { ITEMS, makeStack, applyStackMult } from './data/items.js';
import { TextureLibrary, ALL_TEXTURES } from './gfx/Textures.js';
import { MaterialLibrary } from './gfx/Materials.js';
import { PRESETS, detectPreset, resolve as resolveGfx } from './gfx/GraphicsSettings.js';
import { Particles } from './gfx/Particles.js';
import { VegetationLibrary, DecorLayer } from './gfx/Vegetation.js';
import { PostFX } from './gfx/PostFX.js';
import { LightPool } from './gfx/LightPool.js';
import { setMaterials } from './entities/WeaponModels.js';
import { setAvatarMaterials, setAvatarBatch } from './entities/Avatars.js';
import { Batcher } from './gfx/Batcher.js';
import { Admin } from './ui/Admin.js';
import { buildScenario } from './sim/Scenario.js';

const PENDING = 'scrapisle.pending';

// three.js refreshes every object's matrices each frame, hidden ones too, and a world holds thousands
// of hidden things (far bots, loot, deployables). This refreshes only what can be drawn. A hidden object
// catches up the frame it's shown, since every visited object recomputes its own matrix.
function updateVisible(o, force) {
  if (o.matrixAutoUpdate) o.updateMatrix();
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.parent === null) o.matrixWorld.copy(o.matrix); else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    o.matrixWorldNeedsUpdate = false; force = true;
  }
  const ch = o.children;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (!c.visible) continue;
    if (c.isCamera) c.updateMatrixWorld(force);   // cameras also keep their inverse matrix
    else updateVisible(c, force);
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('cv');
    this.save = new SaveSystem();
    this.prefs = Object.assign({ sens: 1, fov: 75, vol: 0.6 }, this.save.loadSettings());
    if (!this.prefs.gfx) this.prefs.gfx = { preset: detectPreset(), custom: {} };
    this.gfx = resolveGfx(this.prefs.gfx);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.gfx.antialias, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.dynScale = 1;
    this.renderer.setSize(innerWidth, innerHeight);
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = false;   // the loop refreshes only what's drawn (see updateVisible)
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 2200);
    this.scene.add(this.camera);
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); if (this.post) this.post.setSize(innerWidth, innerHeight); });
    this.audio = new Audio(this);
    this.events = new EventBus();
    this.running = false; this.paused = false;
    this.ui = new UIManager(this);
    this.admin = null;   // admin-space switches (god mode); the panel itself is this.adminUI
    this.adminUI = new Admin(this);
    this.applyPrefs();
    document.addEventListener('pointerdown', () => this.audio.unlock());
    document.getElementById('clickBox').onclick = () => { this.audio.unlock(); this.controls && this.controls.lock(); };
    this.last = performance.now();
    requestAnimationFrame(t => this.loop(t));
    addEventListener('visibilitychange', () => { if (document.hidden && this.running) this.saveGame(true); });
    addEventListener('pagehide', () => { if (this.running) this.saveGame(true); });
    this.boot();
  }
  async boot() {
    const p = sessionStorage.getItem(PENDING);
    if (p) {
      sessionStorage.removeItem(PENDING);
      const job = JSON.parse(p);
      if (job.type === 'new') return this.startNew(job.cfg);
      if (job.type === 'load') return this.loadWorld(job.id);
    }
    this.ui.showMenu();
  }
  applyPrefs() {
    this.save.saveSettings(this.prefs);
    if (this.controls) this.controls.sens = 0.0022 * this.prefs.sens;
    if (this.settings) this.settings.fov = this.prefs.fov;
    this.audio.setVolume(this.prefs.vol);
    this.applyGraphics();
  }
  // Apply graphics settings that can change live (others need a reload; see GraphicsSettings).
  applyGraphics() {
    const g = this.gfx = resolveGfx(this.prefs.gfx);
    this.renderer.setPixelRatio(Math.min(g.maxPR || 2, (window.devicePixelRatio || 1) * g.renderScale * this.dynScale));
    this.renderer.shadowMap.enabled = g.shadows;
    if (this.env) {
      this.env.gfx = g;
      this.env.sun.castShadow = g.shadows;
      const sc = this.env.sun.shadow.camera, sd = g.shadowDist;
      sc.left = -sd; sc.right = sd; sc.top = sd; sc.bottom = -sd; sc.updateProjectionMatrix();
      if (this.env.sun.shadow.mapSize.x !== g.shadowRes) { this.env.sun.shadow.mapSize.set(g.shadowRes, g.shadowRes); if (this.env.sun.shadow.map) { this.env.sun.shadow.map.dispose(); this.env.sun.shadow.map = null; } }
      this.env.sky.uniforms.cloudsOn.value = g.clouds ? 1 : 0;
    }
    this.camera.far = g.viewDist + 400; this.camera.updateProjectionMatrix();
    if (this.fx) this.fx.density = g.particles;
    if (this.terrain) this.terrain.hiRange = Math.max(200, g.viewDist * 0.3);
    if (this.decor && (this.decor.gfx.grass !== g.grass || this.decor.gfx.decor !== g.decor)) { this.decor.dispose(); this.decor = new DecorLayer(this, this.veg, g); }
    if (this.res && this.res.groups) this.res.updateVisibility(this.camera.position);
    if (this.post) this.post.enabled = g.ao;
    else if (g.ao && this.running) this.post = new PostFX(this);
  }
  logEvent(text) { if (!this.env) return; this.log.push({ t: this.now, day: this.env.day, clock: this.env.clock(), text }); if (this.log.length > 200) this.log.shift(); }
  actorById(id) { if (this.player && this.player.id === id) return this.player; return this.bots.byId.get(id) || null; }
  survRadiation(o) { return this.surv.radiationAt(o.x, o.y + 1, o.z); }

  // ---------- world setup ----------
  async startNew(cfg) {
    if (this.running) { sessionStorage.setItem(PENDING, JSON.stringify({ type: 'new', cfg })); location.reload(); return; }
    this.worldId = cfg.scenario ? 'scenario' : 'w' + Date.now().toString(36);
    this.cfg = cfg;
    await this.setup(cfg, null);
  }
  // Admin raid scenario: a fresh small island with one base and a clan coming to raid it (sim/Scenario.js).
  async startScenario(sc) {
    const cfg = { name: 'Raid scenario', seed: Math.floor(Math.random() * 1e6), difficulty: 'hard', mult: 2, bots: 0, size: 1024, layout: 3, scenario: sc };
    if (this.running) { sessionStorage.setItem(PENDING, JSON.stringify({ type: 'new', cfg })); location.reload(); return; }
    this.worldId = 'scenario';
    this.cfg = cfg;
    await this.setup(cfg, null);
  }
  async loadWorld(id) {
    if (this.running) { sessionStorage.setItem(PENDING, JSON.stringify({ type: 'load', id })); location.reload(); return; }
    this.ui.showLoading('Reading your save…');
    let data = null;
    try { data = await this.save.load(id); } catch (e) { data = null; }
    if (!data) { this.ui.showMenu(); this.ui.toast('That save could not be loaded'); return; }
    this.worldId = id; this.cfg = data.cfg;
    await this.setup(data.cfg, data);
  }
  quitToMenu() { location.reload(); }
  step(text) { this.ui.showLoading(text); return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); }

  async setup(cfg, data) {
    if (cfg.difficulty === 'easy' || !cfg.difficulty) cfg.difficulty = 'normal';   // Easy was removed: those worlds play on Normal
    this.settings = { mult: cfg.mult, difficulty: cfg.difficulty, bots: cfg.bots, size: cfg.size, fov: this.prefs.fov, autosave: 120 };
    applyStackMult(cfg.mult);
    this.now = data ? data.now : 0;
    this.log = data ? data.log || [] : [];
    this.raidHistory = data ? data.raidHistory || [] : [];
    this.pstats = Object.assign({ defended: 0 }, data ? data.pstats : null);
    this.online = new OnlineBoard(this);   // Clan Wars board in the homepage's Hall of Challengers (Normal and up)
    this.seen = new Map(data ? data.seen || [] : []);
    this.actors = new Set();
    this.actorHash = new SpatialHash(16);
    // procedural PBR textures (generated once per page load)
    const g = this.gfx;
    this.tex = new TextureLibrary(g.texture, Math.min(g.aniso, this.renderer.capabilities.getMaxAnisotropy()));
    let ti = 0;
    await this.tex.generate(ALL_TEXTURES, async () => { ti++; if (ti % 3 === 0) await this.step(`Painting textures (${ti} of ${ALL_TEXTURES.length})…`); });
    this.mats = new MaterialLibrary(this.tex, !!g.cheap);
    setMaterials(this.mats); setAvatarMaterials(this.mats);
    this.batch = new Batcher(this.scene); setAvatarBatch(this.batch);   // characters, loot and deployables drawn as instanced batches
    await this.step('Shaping the island…');
    this.world = new World(cfg.seed, cfg.size, cfg.layout || 1);
    this.physics = new Physics(this.world);
    this.env = new Environment(this.scene, this.renderer, g);
    await this.step('Laying terrain, rivers and roads…');
    this.terrain = buildTerrain(this.world, this);
    this.terrain.hiRange = Math.max(200, g.viewDist * 0.3);
    const mons = buildMonuments(this.world, this.scene, this.physics, this.mats);
    this.monumentData = mons;
    await this.step('Growing trees and placing ore…');
    this.veg = new VegetationLibrary(this.mats);
    this.fx = new Particles(this.scene, g.particles);
    this.res = new ResourceSystem(this); this.res.init(this.world);
    this.loot = new LootSystem(this); this.loot.init(this.world, mons);
    this.build = new BuildingSystem(this);
    this.deploy = new Deployables(this);
    this.batch.addGroup(this.loot.group); this.batch.addGroup(this.deploy.group);
    this.crafting = new CraftingSystem(this);
    this.combat = new CombatSystem(this);
    this.surv = new SurvivalSystem(this);
    this.surv.setRadZones(mons.flatMap(m => m.rads));
    let ri = 0;
    for (const md of mons) for (const r of md.recyclers) this.deploy.create({ id: 'rc' + (ri++), type: 'recycler', x: r.x, y: r.y, z: r.z, yaw: r.yaw, team: 'world', owner: null });
    this.teams = new BotTeams(this);
    this.bots = new BotManager(this);
    this.sim = new WorldSimulation(this);
    this.controls = new PlayerController(this, this.camera, this.canvas);
    this.controls.sens = 0.0022 * this.prefs.sens;
    this.animals = new AnimalSystem(this);
    this.npcs = new NPCSystem(this);
    this.wireEvents();
    if (!data) {
      await this.step('Waking up the survivors…');
      this.player = this.makePlayer();
      this.npcs.init(mons);
      this.animals.init();
      this.bots.init(cfg.bots, cfg.difficulty, cfg.seed);
      this.spawnPlayerBeach();
      this.logEvent(`${cfg.bots} survivors washed up on the island`);
    } else {
      await this.step('Rebuilding bases and loading survivors…');
      setUidCounter(data.uid || 1);
      this.env.load(data.env);
      this.build.load(data.structures);
      this.deploy.load(data.deploys);
      this.res.load(data.res);
      this.loot.load(data.loot);
      this.npcs.init(mons); this.npcs.load(data.npcs);
      this.animals.load(data.animals);
      this.teams.load(data.teams);
      this.bots.load(data.bots);
      this.bots.report.load(data.botReport);
      this.player = this.makePlayer();
      this.player.load(data.player);
      this.player.isPlayer = true; this.player.team = 'player';
      if (!this.player.alive) setTimeout(() => this.ui.showDeath({ victim: this.player, info: {} }), 50);
    }
    this.actors.add(this.player);
    for (const a of this.actors) this.actorHash.insert(a);
    this.camPos = this.camera.position;
    // detailed terrain around the spawn before the first frame
    this.camera.position.set(this.player.x, this.player.y + 1.6, this.player.z);
    updateTerrainLOD(this.terrain, this.camera.position, 99);
    this.decor = new DecorLayer(this, this.veg, g);
    this.lightPool = new LightPool(this, g.lights || 3);   // campfires, furnaces, candles, torches (night only)
    if (g.ao) this.post = new PostFX(this);
    this.applyGraphics();
    this.ui.hideScreens();
    document.getElementById('hud').hidden = false;
    this.running = true;
    this.lastSave = 0;
    if (cfg.scenario) { const msg = buildScenario(this, cfg.scenario); this.ui.toast(msg); this.logEvent(msg); if (this.spectate) this.ui.toast('Watching: WASD to fly, Space up, Ctrl down, Shift faster'); }
    await this.saveGame(true);
    this.online.start();
    document.getElementById('clickBox').hidden = !this.player.alive ? true : false;
  }
  makePlayer() {
    const p = new Survivor({ name: 'You', isPlayer: true, team: 'player', id: 'player' });
    return p;
  }
  spawnPlayerBeach() {
    const P = this.player;
    // pick a beach without bots right next to it
    let b = pick(this.world.spawns.beaches);
    for (let k = 0; k < 20; k++) {
      const c = pick(this.world.spawns.beaches);
      const near = this.bots ? this.bots.list.some(x => x.alive && Math.hypot(x.x - c.x, x.z - c.z) < 120) : false;
      if (!near) { b = c; break; }
    }
    P.x = b.x; P.z = b.z; P.y = this.world.heightAt(b.x, b.z) + 0.1;
    P.yaw = Math.atan2(-b.x, -b.z);
    P.inv.belt.put(0, makeStack('rock')); P.inv.belt.put(1, makeStack('torch'));
    P.inv.main.add('bandage', 1);
    P.hp = 70; P.cal = 180; P.hyd = 140; P.alive = true; P.bleed = 0; P.rads = 0; P.poison = 0; P.hot = 0;
    P.active = 0; P.spawnedAt = this.now;
  }
  respawnPlayer(bagId) {
    const P = this.player;
    if (bagId) {
      const d = this.deploy.byId.get(bagId);
      if (d && this.deploy.spawnReady(d)) {
        d.lastUsed = this.now;
        P.x = d.x; P.z = d.z; P.y = d.y + 0.2;
        P.inv.belt.put(0, makeStack('rock')); P.inv.belt.put(1, makeStack('torch'));
        P.hp = 70; P.cal = Math.max(P.cal, 150); P.hyd = Math.max(P.hyd, 120); P.alive = true; P.bleed = 0; P.rads = 0; P.poison = 0; P.hot = 0; P.active = 0; P.spawnedAt = this.now;
      } else this.spawnPlayerBeach();
    } else this.spawnPlayerBeach();
    P.vx = P.vy = P.vz = 0; P.lastHitBy = null;
    this.actors.add(P);
    this.actorHash.insert(P);
    document.getElementById('clickBox').hidden = false;
  }
  wireEvents() {
    const E = this.events;
    E.on('death', e => {
      if (e.victim === this.player) {
        this.deathSpot = { x: this.player.x, z: this.player.z };
        this.ui.showDeath(e);
        const tier = e.killer && e.killer.ai ? ` (${e.killer.ai.tier.toUpperCase()})` : '';
        this.logEvent(e.killer && e.killer.name ? `${e.killer.name}${tier} killed you` : e.info && e.info.type === 'respawn' ? 'You respawned' : 'You died');
      } else if (e.killer === this.player && e.victim.kind === 'survivor') this.ui.toastHTML(`You killed ${this.ui.esc(e.victim.name)}${this.ui.tierTag(e.victim)}`);
      else if (e.victim.kind === 'survivor' && e.killer && e.killer.kind === 'survivor' && Math.random() < 0.05) this.logEvent(`${e.killer.name} killed ${e.victim.name}`);
    });
    E.on('hurt', e => { if (e.victim === this.player && e.dmg > 0.5) { this.ui.damageFlash(); this.audio.hurt(); } });
    E.on('crafted', e => { if (e.surv === this.player) { this.ui.pickupNote(e.id, e.n); this.audio.craftDone(); } });
    E.on('unlocked', e => { if (e.surv === this.player) this.ui.toast(`Blueprint learned: ${ITEMS[e.id].name}`); });
    // Explosions shake the screen (harder the closer and bigger they are) and flash it when close.
    E.on('explosion', e => {
      const cp = this.camera.position, d = Math.hypot(e.x - cp.x, (e.y || cp.y) - cp.y, e.z - cp.z), size = e.size || 1;
      const reach = 70 + 40 * size, k = Math.max(0, 1 - d / reach);
      if (k > 0) this.trauma = Math.min(1, (this.trauma || 0) + k * k * (0.55 + 0.35 * size));
      if (d < 16 * size) this.ui.blastFlash((1 - d / (16 * size)) * 0.85);
    });
    // Explosives on your base (or a clan's raid reaching your walls): the raid banner and alarm.
    E.on('raidEnded', e => { if (this.cfg && this.cfg.scenario) this.ui.toast(`Raid over: ${e.team.name} ${e.result === 'success' ? 'got in and took the loot' : e.result}`); });
    E.on('raidStarted', e => { if (e.st && e.st.team === this.player.team) this.ui.raidAlert(e.team.name); });
    E.on('structureHit', e => {
      if (!e.st || e.st.team !== this.player.team || !e.attacker || e.attacker === this.player) return;
      const t = e.attacker.team && this.teams.get(e.attacker.team);
      if (e.type === 'explosive' || (t && t.raid && t.raid.target === e.st.id)) this.ui.raidAlert(t ? t.name : 'someone');
    });
    E.on('structureHit', e => { if (e.st && e.st.team === this.player.team && e.attacker && e.attacker !== this.player && (!this._warnT || this.now - this._warnT > 30)) { this._warnT = this.now; this.ui.toast('Your base is taking damage'); } });
  }
  onUnlock() {
    if (!this.running) return;
    if (!this.ui.isOpen() && this.player && this.player.alive && document.getElementById('deathScreen').hidden) this.ui.showPause();
  }

  // ---------- save ----------
  serialize() {
    return {
      v: 1, cfg: this.cfg, now: this.now, uid: getUidCounter(), env: this.env.serialize(),
      player: this.player.serialize(), bots: this.bots.serialize(), teams: this.teams.serialize(),
      structures: this.build.serialize(), deploys: this.deploy.serialize(), res: this.res.serialize(), loot: this.loot.serialize(),
      animals: this.animals.serialize(), npcs: this.npcs.serialize(), log: this.log, raidHistory: this.raidHistory, seen: [...this.seen], pstats: this.pstats, botReport: this.bots.report.serialize(),
    };
  }
  async saveGame(auto) {
    if (!this.running) return false;
    if (this.cfg && this.cfg.scenario) { if (!auto) this.ui.toast('Raid scenarios aren\'t saved'); return true; }
    try {
      // plain data only: a stray 3D object or function anywhere would make the whole save fail
      const seen = new WeakSet();
      const data = JSON.parse(JSON.stringify(this.serialize(), function (k, v) {
        const o = this[k];   // the value before any toJSON() (3D objects have one)
        if (typeof o === 'function' || (o && (o.isObject3D || o.isMaterial || o.isBufferGeometry || o.isTexture))) return undefined;
        if (v && typeof v === 'object') { if (seen.has(v)) return undefined; seen.add(v); }
        return v;
      }));
      const meta = { id: this.worldId, name: this.cfg.name, seed: this.cfg.seed, size: this.cfg.size, difficulty: this.cfg.difficulty, mult: this.cfg.mult, bots: this.cfg.bots, day: this.env.day, updated: Date.now() };
      const ok = await this.save.save(meta, data);
      if (ok && !auto) this.ui.toast('World saved');
      return ok;
    } catch (e) { console.error('save failed', e); if (!auto) this.ui.toast('Saving failed: ' + e.message); return false; }
  }

  // ---------- loop ----------
  loop(t) {
    requestAnimationFrame(tt => this.loop(tt));
    const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    if (!this.running) { updateVisible(this.scene, false); this.renderer.render(this.scene, this.camera); return; }
    const paused = !document.getElementById('pauseScreen').hidden || !document.getElementById('settingsScreen').hidden || !this.adminUI.el.hidden;
    const P = this.player;
    if (!paused) {
      this.controls.update(dt);
      this.sim.update(dt);
    }
    if (!P.alive) { this.camera.position.set(P.x, P.y + 0.4, P.z); this.camera.rotation.set(-0.3, P.yaw + Math.PI, 0.6, 'YXZ'); }
    const cp = this.camera.position;
    if (this.trauma > 0 && (!paused || !P.alive)) this.shakeCamera(dt);   // (while paused the view isn't rebuilt each frame)
    this.camera.updateMatrixWorld(); this.audio.listen(this.camera);   // 3D sound follows your view
    this.env.update(cp, this);
    this.lightPool.update(cp, dt);
    this.build.flushVisuals();
    this.cullSmall(cp, dt);
    updateTerrainLOD(this.terrain, cp, 1);
    this.decor.update(cp);
    this.fx.update(dt, cp, this.env);
    this.adapt(dt);
    this.ui.updateHUD(dt);
    this.online.update();
    const cb = document.getElementById('clickBox');
    const wantClick = P.alive && !this.controls.locked && !this.ui.isOpen() && paused === false && document.getElementById('deathScreen').hidden && document.getElementById('pauseScreen').hidden;
    if (cb.hidden === wantClick) cb.hidden = !wantClick;
    updateVisible(this.scene, false);
    this.batch.update(cp, this.gfx.shadows ? (this.gfx.shadowDist || 70) * 1.45 + 5 : 0);
    if (this.post && this.post.enabled && this.post.ready) this.post.render(); else this.renderer.render(this.scene, this.camera);
  }
  // Screen shake from explosions: a jolt that dies away over about a second. The view is rebuilt
  // from the player every frame, so the offsets never add up.
  shakeCamera(dt) {
    const c = this.camera, a = this.trauma * this.trauma, t = performance.now() * 0.001;
    const n = (f, p) => Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 1.9 + p * 2.3) * 0.4;
    c.rotation.x += a * 0.07 * n(37, 0.3); c.rotation.y += a * 0.07 * n(31, 1.7); c.rotation.z += a * 0.05 * n(27, 4.1);
    c.position.x += a * 0.12 * n(43, 2.2); c.position.y += a * 0.12 * n(39, 5.3);
    this.trauma = Math.max(0, this.trauma - dt * 1.1);
  }
  // Small things far away aren't drawn: loot containers, bags and drops past ~140 m, deployables
  // past ~170 m (checked a few times a second).
  cullSmall(cp, dt) {
    this.cullT = (this.cullT || 0) - dt;
    if (this.cullT > 0) return;
    this.cullT = 0.3;
    const far = (this.gfx.viewDist || 1000) / 1000;
    const set = (grp, r) => { const r2 = r * r; for (const o of grp.children) { const dx = o.position.x - cp.x, dz = o.position.z - cp.z, v = dx * dx + dz * dz < r2; if (o.visible !== v && !o.userData.keepHidden) o.visible = v; } };
    set(this.loot.group, 140 * far);
    set(this.deploy.group, 170 * far);
  }
  // Adaptive resolution: drop render scale when the frame rate sags, recover when there's headroom.
  adapt(dt) {
    if (!this.gfx.adaptive) { if (this.dynScale !== 1) { this.dynScale = 1; this.applyGraphics(); } return; }
    this.fpsT = (this.fpsT || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsT < 3) return;
    const fps = this.fpsN / this.fpsT; this.fpsT = 0; this.fpsN = 0;
    // Resizing the frame buffers causes a hitch of its own, so only react to sustained changes
    // (two slow windows in a row to drop, five fast ones to recover) and never more than every 12 s.
    this.slowN = fps < 38 ? (this.slowN || 0) + 1 : 0;
    this.fastN = fps > 58 ? (this.fastN || 0) + 1 : 0;
    const before = this.dynScale;
    if (this.now - (this.scaleT || -99) < 12) return;
    if (this.slowN >= 2) { this.dynScale = Math.max(0.55, this.dynScale - 0.15); this.slowN = 0; }
    else if (this.fastN >= 5) { this.dynScale = Math.min(1, this.dynScale + 0.1); this.fastN = 0; }
    if (before !== this.dynScale) this.scaleT = this.now;
    if (before !== this.dynScale) this.renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * this.gfx.renderScale * this.dynScale));
  }
}

window.scrapIsle = new Game();

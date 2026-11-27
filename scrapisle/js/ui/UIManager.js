// All HTML UI: menus, HUD, inventory with drag and drop, crafting, containers, building menus, map, death screen.
import { ITEMS, WEAR_SLOTS } from '../data/items.js';
import { RECIPES, RECIPE, CRAFT_CATS, researchCost } from '../data/recipes.js';
import { PIECES, PIECE_ORDER, GRADES, pieceCost, DEPLOYABLES } from '../data/building.js';
import { MONUMENT_TYPES, BIOME } from '../world/WorldGeneration.js';
import { DISTRIBUTION, STYLES } from '../bots/BotProfiles.js';
import { moveSlot, splitSlot } from '../systems/InventorySystem.js';
import { recycleYield } from '../systems/Deployables.js';
import { iconURL } from './Icons.js';
import { fmtTime } from '../core/util.js';
import { PRESETS, resolve as resolveGfx } from '../gfx/GraphicsSettings.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WEAR_LABEL = { head: 'Head', face: 'Face', shirt: 'Shirt', chest: 'Chest armour', pants: 'Trousers', kilt: 'Leg armour', feet: 'Feet', hands: 'Hands' };
const costText = (cost, inv) => Object.entries(cost).map(([k, v]) => { const ok = !inv || inv.count(k) >= v; return `<span class="${ok ? '' : 'bad'}">${v} ${esc(ITEMS[k].name)}</span>`; }).join(', ');

export class UIManager {
  constructor(game) {
    this.game = game;
    this.open = null;          // 'inv' | 'map' | 'modal' | null
    this.tab = 'craft';
    this.loot = null;          // { kind, ref, cont, title }
    this.sel = null;           // { c, i }
    this.craftCat = 'Tools'; this.craftSel = 'stone_hatchet'; this.craftN = 1;
    this.drag = null;
    this.toasts = [];
    this.renderV = '';
    this.mapImg = null;
    this.bindStatic();
  }
  get P() { return this.game.player; }
  isOpen() { return !!this.open; }

  // ================= MENUS =================
  bindStatic() {
    document.addEventListener('mousemove', e => this.onDragMove(e));
    document.addEventListener('mouseup', e => this.onDragEnd(e));
    $('mnNew').onclick = () => this.showScreen('newScreen');
    $('mnLoad').onclick = () => this.showLoad();
    $('mnSettings').onclick = () => { this.settingsBack = 'menuScreen'; this.showSettings(); };
    $('mnContinue').onclick = () => { const id = this.game.save.lastWorld(); if (id) this.game.loadWorld(id); };
    for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => this.showScreen(b.dataset.back === 'settings' ? this.settingsBack : b.dataset.back);
    // new world form
    const segs = (id, cb) => { const el = $(id); el.onclick = e => { const b = e.target.closest('button'); if (!b) return; for (const x of el.children) x.classList.toggle('on', x === b); cb && cb(b.dataset.v); }; };
    segs('nwDiff', v => this.renderDist(v)); segs('nwMult'); segs('nwBots'); segs('nwSize');
    this.renderDist('normal');
    $('nwSeed').value = Math.floor(Math.random() * 1e6);
    $('nwStart').onclick = () => {
      const val = (id) => $(id).querySelector('.on').dataset.v;
      this.game.startNew({ name: $('nwName').value.trim() || 'My island', seed: parseInt($('nwSeed').value, 10) || Math.floor(Math.random() * 1e6), difficulty: val('nwDiff'), mult: +val('nwMult'), bots: +val('nwBots'), size: +val('nwSize'), layout: 2 });
    };
    // settings
    $('stSens').oninput = e => { this.game.prefs.sens = +e.target.value; this.game.applyPrefs(); };
    $('stFov').oninput = e => { this.game.prefs.fov = +e.target.value; this.game.applyPrefs(); };
    $('stVol').oninput = e => { this.game.prefs.vol = +e.target.value; this.game.applyPrefs(); };
    // graphics: a preset plus individual overrides
    const gp = () => this.game.prefs.gfx;
    $('gfxPreset').onclick = e => { const b = e.target.closest('button'); if (!b) return; gp().preset = b.dataset.v; gp().custom = {}; this.game.applyPrefs(); this.showSettings(); };
    const bind = (id, key, conv = v => +v, prop = 'value') => { $(id).oninput = $(id).onchange = e => { gp().custom[key] = conv(e.target[prop]); this.game.applyPrefs(); this.markPreset(); }; };
    bind('gShadows', 'shadows', v => v, 'checked'); bind('gShadowRes', 'shadowRes'); bind('gScale', 'renderScale'); bind('gView', 'viewDist');
    bind('gGrass', 'grass'); bind('gDecor', 'decor'); bind('gTrees', 'treeDetail'); bind('gFx', 'particles');
    bind('gAO', 'ao', v => v, 'checked'); bind('gClouds', 'clouds', v => v, 'checked'); bind('gAdaptive', 'adaptive', v => v, 'checked');
    bind('gTex', 'texture'); bind('gAA', 'antialias', v => v, 'checked');
    // pause
    $('psResume').onclick = () => this.resume();
    $('psSave').onclick = async () => { await this.game.saveGame(false); $('psMsg').textContent = 'Saved'; };
    $('psSettings').onclick = () => { this.settingsBack = 'pauseScreen'; this.showSettings(); };
    $('psQuit').onclick = async () => { await this.game.saveGame(true); this.game.quitToMenu(); };
    $('psMap').onclick = () => { this.hideScreens(); this.openMap(); };
  }
  renderDist(d) {
    const D = DISTRIBUTION[d];
    $('nwDist').textContent = `Bot skill mix: ${Math.round(D.easy * 100)}% easy, ${Math.round(D.normal * 100)}% normal, ${Math.round(D.hard * 100)}% hard and ${Math.round(D.expert * 100)}% expert.`;
  }
  hideScreens() { for (const s of document.querySelectorAll('.screen')) s.hidden = true; }
  showScreen(id) { this.hideScreens(); $(id).hidden = false; }
  async showMenu() {
    this.hideScreens(); $('hud').hidden = true; $('panel').hidden = true;
    $('menuScreen').hidden = false;
    const last = this.game.save.lastWorld();
    let meta = null;
    if (last) { try { meta = (await this.game.save.list()).find(m => m.id === last); } catch { meta = null; } }
    $('mnContinue').hidden = !meta;
    if (meta) $('mnContinue').textContent = `Continue ${meta.name} (day ${meta.day})`;
  }
  async showLoad() {
    this.showScreen('loadScreen');
    const list = $('ldList');
    list.innerHTML = '<p class="muted">Loading saves…</p>';
    let saves = [];
    try { saves = await this.game.save.list(); } catch (e) { list.innerHTML = '<p class="muted">Saves could not be read in this browser.</p>'; return; }
    if (!saves.length) { list.innerHTML = '<p class="muted">No saved worlds yet. Start a new one from the main menu.</p>'; return; }
    list.innerHTML = saves.map(s => `<div class="saveRow"><div><b>${esc(s.name)}</b><div class="muted">Day ${s.day}, ${s.bots} bots, ${s.difficulty} difficulty, ${s.mult}x loot, saved ${new Date(s.updated).toLocaleString()}</div></div>
      <div class="row"><button class="btn" data-load="${s.id}">Load</button><button class="btn danger" data-del="${s.id}">Delete</button></div></div>`).join('');
    list.onclick = async e => {
      const l = e.target.closest('[data-load]'), d = e.target.closest('[data-del]');
      if (l) this.game.loadWorld(l.dataset.load);
      if (d) {
        if (d.dataset.confirm !== '1') { d.dataset.confirm = '1'; d.textContent = 'Delete for good?'; return; }
        await this.game.save.remove(d.dataset.del); this.showLoad();
      }
    };
  }
  showSettings() {
    this.showScreen('settingsScreen');
    const p = this.game.prefs;
    $('stSens').value = p.sens; $('stFov').value = p.fov; $('stVol').value = p.vol;
    const g = resolveGfx(p.gfx);
    $('gShadows').checked = g.shadows; $('gShadowRes').value = String(g.shadowRes); $('gScale').value = g.renderScale; $('gView').value = g.viewDist;
    $('gGrass').value = g.grass; $('gDecor').value = g.decor; $('gTrees').value = g.treeDetail; $('gFx').value = g.particles;
    $('gAO').checked = g.ao; $('gClouds').checked = g.clouds; $('gAdaptive').checked = g.adaptive; $('gTex').value = String(g.texture); $('gAA').checked = g.antialias;
    this.markPreset();
  }
  markPreset() {
    const p = this.game.prefs.gfx, custom = Object.keys(p.custom || {}).length > 0;
    for (const b of $('gfxPreset').children) b.classList.toggle('on', b.dataset.v === p.preset && !custom);
  }
  showLoading(text) { this.showScreen('loadingScreen'); $('loadingTxt').textContent = text; }
  showPause() {
    if (!this.game.running || !this.P) return;
    this.showScreen('pauseScreen'); $('psMsg').textContent = '';
    const P = this.P;
    $('psInfo').textContent = `Day ${this.game.env.day}, ${this.game.env.clock()}. You have ${P.kills} kills and ${P.deaths} deaths.`;
  }
  resume() { this.hideScreens(); this.game.controls.lock(); }

  // ================= KEYS =================
  captureKeys(e) {
    if (!this.game.running) return false;
    if (this.open === 'modal' && this.modalKey && this.modalKey(e)) { e.preventDefault(); return true; }
    if (this.open) {
      if (e.code === 'Escape') { this.close(); e.preventDefault(); return true; }
      if ((e.code === 'Tab' || e.code === 'KeyI') && this.open === 'inv') { e.preventDefault(); this.close(true); return true; }
      if (e.code === 'KeyQ' && this.open === 'inv') { if (this.tab === 'craft') this.close(true); else { this.tab = 'craft'; this.render(true); } return true; }
      if (e.code === 'KeyM' && this.open === 'map') { this.close(true); return true; }
      if (e.code === 'Tab') e.preventDefault();
      return true;
    }
    return false;
  }
  close(relock) {
    if (this.loot && this.loot.kind === 'loot') this.game.loot.touched(this.loot.ref);
    this.open = null; this.loot = null; this.sel = null; this.modalKey = null;
    $('panel').hidden = true; $('modal').hidden = true; $('mapScreen').hidden = true;
    if (relock) this.game.controls.lock();
  }
  unlockForUI() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ================= INVENTORY PANEL =================
  openInventory(tab) {
    if (!this.P || !this.P.alive) return;
    this.open = 'inv';
    if (tab) this.tab = tab; else if (!this.loot) this.tab = this.tab === 'loot' ? 'craft' : this.tab;
    $('panel').hidden = false;
    this.unlockForUI();
    this.render(true);
  }
  openLoot(target) { this.loot = target; this.tab = 'loot'; this.openInventory('loot'); }
  cmap() { const P = this.P; return { main: P.inv.main, belt: P.inv.belt, wear: P.inv.wear, loot: this.loot ? this.loot.cont : null }; }
  slotHTML(c, i, s, extra = '') {
    const sel = this.sel && this.sel.c === c && this.sel.i === i ? ' sel' : '';
    if (!s) return `<div class="slot${sel}" data-c="${c}" data-i="${i}">${extra}</div>`;
    const d = ITEMS[s.id];
    const cond = s.c !== undefined ? `<i class="cond" style="height:${Math.round(s.c * 100)}%;background:${s.c > 0.5 ? '#6ea34a' : s.c > 0.2 ? '#d0a03a' : '#c0483a'}"></i>` : '';
    const n = s.n > 1 ? `<b class="n">${s.n}</b>` : s.ammo !== undefined && d.type === 'gun' ? `<b class="n">${s.ammo}</b>` : '';
    return `<div class="slot has${sel}" data-c="${c}" data-i="${i}" title="${esc(d.name)}"><img src="${iconURL(s.id)}" alt="">${n}${cond}</div>`;
  }
  render(force) {
    if (this.open !== 'inv') return;
    const P = this.P, G = this.game;
    const lv = this.loot ? this.loot.cont.version : 0;
    const L = this.loot && this.loot.ref;
    const v = `${P.inv.version}|${lv}|${this.tab}|${this.craftCat}|${this.craftSel}|${this.craftN}|${P.craftQueue.length}|${this.sel ? this.sel.c + this.sel.i : ''}|${G.crafting.benchTier(P)}|${L && L.on}|${L && L.auth ? L.auth.size : ''}`;
    if (!force && v === this.renderV) {
      // live numbers without rebuilding the DOM (rebuilding would eat clicks)
      const rp = $('recProg'); if (rp && L) rp.style.width = (L.on ? Math.round(L.procT / 5 * 100) : 0) + '%';
      const q = document.querySelector('#pRight .qrow .qt');
      if (q && P.craftQueue[0]) q.textContent = fmtTime(P.craftQueue[0].left);
      return;
    }
    this.renderV = v;
    // left: wear + stats
    $('pWear').innerHTML = WEAR_SLOTS.map((sl, i) => `<div class="wearRow">${this.slotHTML('wear', i, P.inv.wear.slots[i])}<span class="muted">${WEAR_LABEL[sl]}</span></div>`).join('');
    const pr = (a) => Math.round(P.protection(a, 'proj') * 100);
    $('pStats').innerHTML = `<p>Projectile protection: head ${pr('head')}%, body ${pr('chest')}%, legs ${pr('legs')}%</p><p>Warmth from clothing: ${P.warmth()} </p><p>Radiation protection: ${Math.round(P.radProtection() * 100)}%</p>`;
    // middle: main + belt
    $('pMain').innerHTML = P.inv.main.slots.map((s, i) => this.slotHTML('main', i, s)).join('');
    $('pBelt').innerHTML = P.inv.belt.slots.map((s, i) => this.slotHTML('belt', i, s, `<span class="key">${i + 1}</span>`)).join('');
    // details of selected
    $('pSel').innerHTML = this.selHTML();
    // tabs
    $('tabLoot').hidden = !this.loot;
    $('tabLoot').textContent = this.loot ? this.loot.title.replace(/^\w/, c => c.toUpperCase()) : 'Loot';
    for (const t of ['craft', 'loot']) $('tab' + t[0].toUpperCase() + t.slice(1)).classList.toggle('on', this.tab === t);
    $('pRight').innerHTML = this.tab === 'loot' && this.loot ? this.lootHTML() : this.craftHTML();
    this.wirePanel();
    this.wireSplit();
  }
  selHTML() {
    if (!this.sel) return '<p class="muted">Drag items to move them. Shift-click moves a stack across, right-click splits it, double-click uses or wears it, and dragging out of this window drops it.</p>';
    const c = this.cmap()[this.sel.c]; const s = c && c.slots[this.sel.i];
    if (!s) { this.sel = null; return ''; }
    const d = ITEMS[s.id];
    const lines = [];
    if (d.type === 'food') lines.push(`${d.cal} calories, ${d.hyd} water${d.poison ? ', may make you sick raw' : ''}`);
    if (d.type === 'med') lines.push(`Heals ${d.heal}${d.hot ? ` plus ${d.hot} over time` : ''}${d.stopBleed ? ', stops bleeding' : ''}${d.rad ? `, removes ${d.rad} radiation` : ''}`);
    if (d.type === 'wear') lines.push(`Protection ${Math.round(d.prot.proj * 100)}% projectile, ${Math.round(d.prot.melee * 100)}% melee, warmth ${d.cold}${d.rad ? `, radiation ${Math.round(d.rad * 100)}%` : ''}`);
    if (d.type === 'gun' || d.type === 'bow') lines.push(`${d.dmg} damage, ${d.mag} round magazine, uses ${d.ammo.map(a => ITEMS[a].name).join(' or ')}${s.at ? `. Loaded: ${s.ammo || 0} ${ITEMS[s.at].name}` : ''}`);
    if (d.gather) lines.push(`Gathers wood ${d.gather.tree}, ore ${d.gather.ore}, flesh ${d.gather.flesh} per hit`);
    if (d.recycle || recycleYield(s.id)) lines.push(`Recycles into ${Object.entries(recycleYield(s.id) || {}).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ')}`);
    if (s.c !== undefined) lines.push(`Condition ${Math.round(s.c * 100)}%`);
    const canUse = d.type === 'food' || d.type === 'med';
    return `<h3>${esc(d.name)}${s.n > 1 ? ` x${s.n}` : ''}</h3>${lines.map(l => `<p class="muted">${esc(l)}</p>`).join('')}
      <div class="row">${canUse ? '<button class="btn small" data-act="use">Use</button>' : ''}${d.type === 'wear' ? '<button class="btn small" data-act="wear">Wear</button>' : ''}
      <button class="btn small" data-act="drop">Drop all</button></div>
      ${s.n > 1 ? `<div class="splitRow"><label>Amount <input type="range" id="splitAmt" min="1" max="${s.n - 1}" value="${Math.floor(s.n / 2)}"></label>
        <input type="number" id="splitNum" min="1" max="${s.n - 1}" value="${Math.floor(s.n / 2)}">
        <button class="btn small" data-act="splitn">Split off</button><button class="btn small" data-act="dropn">Drop</button></div>` : ''}`;
  }
  lootHTML() {
    const L = this.loot, G = this.game, d = L.ref;
    let extra = '';
    if (L.kind === 'dep') {
      if (d.type === 'furnace' || d.type === 'campfire') extra = `<p class="muted">${d.type === 'furnace' ? 'Put wood in as fuel and ore to smelt. Burning wood makes charcoal. Raw meat cooks here too.' : 'Burns wood and cooks raw meat.'}</p><button class="btn ${d.on ? 'danger' : 'go'}" data-act="toggle">${d.on ? 'Turn off' : 'Turn on'}</button>`;
      if (d.type === 'recycler') return this.recyclerHTML(d);
      if (d.type === 'claim_cabinet') {
        const st = G.build.structures.get(d.st);
        const hrs = st ? G.build.upkeepHours(st) : 0;
        const up = st ? G.build.upkeepPerHour(st) : {};
        extra = `<p>${st ? `Upkeep per in-game hour: ${Object.entries(up).map(([k, v]) => `${v.toFixed(1)} ${ITEMS[k].name}`).join(', ') || 'none'}` : ''}</p>
          <p>${hrs > 0 ? `Protected from decay for about ${hrs.toFixed(1)} in-game hours.` : 'Not protected: the building is decaying. Put wood, stones or metal in here.'}</p>
          <p class="muted">${d.auth.has(this.P.team) ? 'You are authorised here.' : 'You are not authorised here.'} ${d.auth.size} team${d.auth.size > 1 ? 's' : ''} authorised.</p>
          <div class="row"><button class="btn small" data-act="auth">Authorise</button><button class="btn small" data-act="clearauth">Clear list</button></div>`;
      }
      if (d.type === 'research_table') {
        const s = d.cont.slots[0];
        const ok = s && G.crafting.canResearch(this.P, s);
        extra = `<p class="muted">Put an item in the slot to learn its blueprint. The item is used up.</p>${s ? `<p>${RECIPE[s.id] && !RECIPE[s.id].known ? (this.P.bp.has(s.id) ? 'You already know this.' : `Costs ${researchCost(s.id)} scrap.`) : 'This item cannot be researched.'}</p>` : ''}<button class="btn go" data-act="research" ${ok ? '' : 'disabled'}>Research</button>`;
      }
    }
    const slots = L.cont.slots.map((s, i) => this.slotHTML('loot', i, s)).join('');
    const cls = d && d.type === 'recycler' ? 'grid6 rec' : 'grid6';
    return `<h3>${esc(L.title.replace(/^\w/, c => c.toUpperCase()))}</h3><div class="${cls}">${slots}</div>${extra}<div class="row"><button class="btn small" data-act="takeall">Take all</button></div>`;
  }
  recyclerHTML(d) {
    const cont = d.cont, P = this.P;
    const inp = cont.slots.slice(0, 6).map((s, i) => this.slotHTML('loot', i, s)).join('');
    const out = cont.slots.slice(6, 12).map((s, i) => this.slotHTML('loot', i + 6, s)).join('');
    const next = cont.slots.slice(0, 6).find(Boolean);
    const yields = next ? recycleYield(next.id) : null;
    const comps = [...P.inv.main.slots, ...P.inv.belt.slots].filter(s => s && ITEMS[s.id].type === 'component').length;
    let status;
    if (!next) status = 'Put components or items you no longer need in the input slots.';
    else if (!yields) status = `${ITEMS[next.id].name} can't be recycled.`;
    else status = `Next: ${ITEMS[next.id].name} becomes ${Object.entries(yields).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ')}.`;
    return `<h3>Recycler</h3>
      <h4>Input</h4><div class="grid6 recIn">${inp}</div>
      <div class="recBar"><i id="recProg" style="width:${d.on ? Math.round(d.procT / 5 * 100) : 0}%"></i></div>
      <p class="muted">${esc(status)}</p>
      <div class="row"><button class="btn ${d.on ? 'danger' : 'go'}" data-act="toggle">${d.on ? 'Stop' : 'Start'}</button>
        <button class="btn small" data-act="recall" ${comps ? '' : 'disabled'}>Add all my components (${comps})</button></div>
      <h4>Output</h4><div class="grid6">${out}</div>
      <div class="row"><button class="btn small" data-act="takeout">Take all output</button></div>`;
  }
  craftHTML() {
    const P = this.P, G = this.game;
    const tier = G.crafting.benchTier(P);
    const cats = CRAFT_CATS.map(c => `<button class="cat ${c === this.craftCat ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('');
    const list = RECIPES.filter(r => ITEMS[r.out].cat === this.craftCat).map(r => {
      const known = P.bp.has(r.id);
      const can = known && r.tier <= tier && P.inv.has(r.cost);
      return `<div class="rec ${r.id === this.craftSel ? 'on' : ''} ${known ? '' : 'locked'}" data-rec="${r.id}"><img src="${iconURL(r.out)}" alt=""><span>${esc(ITEMS[r.out].name)}</span>${can ? '<em class="ok">Ready</em>' : known ? '' : '<em>Locked</em>'}</div>`;
    }).join('');
    const r = RECIPE[this.craftSel];
    let det = '';
    if (r) {
      const known = P.bp.has(r.id);
      const blk = G.crafting.blocker(P, r.id, this.craftN, tier);
      det = `<div class="det"><img src="${iconURL(r.out)}" alt=""><div><h3>${esc(ITEMS[r.out].name)}${r.n > 1 ? ` x${r.n}` : ''}</h3>
        <p>Needs ${costText(Object.fromEntries(Object.entries(r.cost).map(([k, v]) => [k, v * this.craftN])), P.inv)}</p>
        <p class="muted">${r.time * this.craftN} seconds${r.tier ? `, Workbench Level ${r.tier} nearby` : ''}${!known ? `. Unlock it at a Workbench Level ${r.tier} for ${r.unlock} scrap, or research one at a research table` : ''}</p></div></div>
        <div class="row"><button class="btn small" data-n="1">1</button><button class="btn small" data-n="5">5</button><button class="btn small" data-n="10">10</button>
        <button class="btn go" data-act="craft" ${blk ? 'disabled' : ''}>Craft ${this.craftN}</button></div>${blk ? `<p class="bad">${esc(blk)}</p>` : ''}`;
    }
    const q = P.craftQueue.map((q, i) => `<div class="qrow"><img src="${iconURL(q.id)}" alt=""><span>${esc(ITEMS[q.id].name)}${q.n > 1 ? ` x${q.n}` : ''}</span><span class="muted${i === 0 ? ' qt' : ''}">${i === 0 ? fmtTime(q.left) : 'Queued'}</span><button class="btn tiny" data-cancel="${i}">Cancel</button></div>`).join('');
    return `<div class="cats">${cats}</div><div class="recs">${list}</div>${det}${q ? `<h4>Crafting queue</h4>${q}` : ''}<p class="muted">Workbench level here: ${tier || 'none'}</p>`;
  }
  wirePanel() {
    const panel = $('panel');
    panel.onmousedown = e => this.onSlotDown(e);
    panel.oncontextmenu = e => { e.preventDefault(); const sl = e.target.closest('.slot'); if (sl) { const c = this.cmap()[sl.dataset.c]; splitSlot(c, +sl.dataset.i); this.render(true); } };
    panel.ondblclick = e => { const sl = e.target.closest('.slot.has'); if (sl) this.useSlot(sl.dataset.c, +sl.dataset.i); };
    panel.onclick = e => {
      const G = this.game, P = this.P;
      const t = e.target;
      const tab = t.closest('[data-tab]'); if (tab) { this.tab = tab.dataset.tab; this.render(true); return; }
      const cat = t.closest('[data-cat]'); if (cat) { this.craftCat = cat.dataset.cat; const f = RECIPES.find(r => ITEMS[r.out].cat === this.craftCat); this.craftSel = f ? f.id : null; this.render(true); return; }
      const rec = t.closest('[data-rec]'); if (rec) { this.craftSel = rec.dataset.rec; this.render(true); return; }
      const n = t.closest('[data-n]'); if (n) { this.craftN = +n.dataset.n; this.render(true); return; }
      const cn = t.closest('[data-cancel]'); if (cn) { G.crafting.cancel(P, +cn.dataset.cancel); this.render(true); return; }
      const act = t.closest('[data-act]'); if (!act) return;
      const a = act.dataset.act, L = this.loot;
      if (a === 'craft') { if (G.crafting.craft(P, this.craftSel, this.craftN)) G.audio.click(); }
      if (a === 'toggle' && L) { if (!G.deploy.toggle(L.ref)) this.toast(L.ref.type === 'recycler' ? 'Nothing to recycle' : 'Needs wood'); }
      if (a === 'auth' && L) { if (G.deploy.authorize(P.team, L.ref)) this.toast('Authorised'); else this.toast('The cabinet is locked'); }
      if (a === 'clearauth' && L) { if (G.deploy.clearAuth(P.team, L.ref)) this.toast('Authorisation list cleared'); }
      if (a === 'research' && L) { const id = L.cont.slots[0] && L.cont.slots[0].id; if (G.crafting.research(P, L.cont, 0)) this.toast(`Learned ${ITEMS[id].name}`); }
      if (a === 'recall' && L) {
        for (const src of [P.inv.main, P.inv.belt]) for (let i = 0; i < src.size; i++) {
          const st = src.slots[i]; if (!st || ITEMS[st.id].type !== 'component') continue;
          const k = L.cont.slots.slice(0, 6).findIndex(x => !x || (x.id === st.id && x.n < ITEMS[x.id].stack));
          if (k < 0) break;
          if (!L.cont.slots[k]) { L.cont.slots[k] = st; src.slots[i] = null; }
          else { const room = ITEMS[st.id].stack - L.cont.slots[k].n, mv = Math.min(room, st.n); L.cont.slots[k].n += mv; st.n -= mv; if (st.n <= 0) src.slots[i] = null; }
          src.touch(); L.cont.touch();
        }
        if (!L.ref.on && L.cont.slots.slice(0, 6).some(Boolean)) G.deploy.toggle(L.ref);
      }
      if (a === 'takeout' && L) { for (let i = 6; i < 12; i++) { const st = L.cont.slots[i]; if (st) L.cont.slots[i] = P.inv.giveStack(st); } L.cont.touch(); }
      if (a === 'takeall' && L) { for (let i = 0; i < L.cont.size; i++) { const s = L.cont.slots[i]; if (s) L.cont.slots[i] = P.inv.giveStack(s); } L.cont.touch(); }
      if (this.sel) {
        const c = this.cmap()[this.sel.c], s = c && c.slots[this.sel.i];
        if (a === 'use') this.useSlot(this.sel.c, this.sel.i);
        if (a === 'wear' && s) { const left = P.inv.equip(s); if (!left) { c.slots[this.sel.i] = null; c.touch(); this.sel = null; } else this.toast('That slot is taken'); }
        if (a === 'split') splitSlot(c, this.sel.i);
        if ((a === 'splitn' || a === 'dropn') && s && s.n > 1) {
          const n = Math.max(1, Math.min(s.n - 1, Math.round(+$('splitNum').value || 1)));
          if (a === 'dropn') { s.n -= n; c.touch(); const d = P.dir(); G.loot.dropItem(s.id, n, P.x + d.x, P.y + 1.2, P.z + d.z, { ...s, n }); }
          else {
            // put the split stack in an empty slot of the same container, or anywhere in the inventory
            const targets = [c, P.inv.main, P.inv.belt, this.loot && this.loot.cont].filter(Boolean);
            const dest = targets.find(x => x.firstEmpty() >= 0 && x.canAccept(s.id, x.firstEmpty()));
            if (!dest) this.toast('No empty slot to split into');
            else { const k = dest.firstEmpty(); dest.slots[k] = { ...s, n }; s.n -= n; c.touch(); dest.touch(); this.sel = { c: Object.entries(this.cmap()).find(([, v]) => v === dest)[0], i: k }; }
          }
        }
        if (a === 'drop' && s) { c.take(this.sel.i); const d = P.dir(); G.loot.dropItem(s.id, s.n, P.x + d.x, P.y + 1.2, P.z + d.z, s); this.sel = null; }
      }
      this.render(true);
    };
  }
  wireSplit() {
    const r = $('splitAmt'), n = $('splitNum');
    if (!r || !n) return;
    r.oninput = () => { n.value = r.value; };
    n.oninput = () => { r.value = n.value; };
    n.onkeydown = e => e.stopPropagation();
  }
  useSlot(cn, i) {
    const P = this.P, G = this.game, c = this.cmap()[cn], s = c && c.slots[i];
    if (!s) return;
    const d = ITEMS[s.id];
    if (d.type === 'food' || d.type === 'med') { if (G.surv.use(P, c, i)) G.audio.eat(); }
    else if (d.type === 'wear' && cn !== 'wear') { if (!P.inv.equip(s)) { c.slots[i] = null; c.touch(); } else this.toast('That slot is taken'); }
    else this.quickMove(cn, i);
    this.render(true);
  }
  quickMove(cn, i) {
    const P = this.P, m = this.cmap(), c = m[cn], s = c.slots[i];
    if (!s) return;
    let left = s;
    if (cn === 'loot') left = P.inv.giveStack(s);
    else if (this.loot && (cn === 'main' || cn === 'belt')) left = this.loot.cont.addStack(s);
    else if (cn === 'wear') left = P.inv.main.addStack(s);
    else if (ITEMS[s.id].type === 'wear') left = P.inv.equip(s);
    else left = (cn === 'main' ? P.inv.belt : P.inv.main).addStack(s);
    c.slots[i] = left || null; c.touch();
    if (this.loot && this.loot.kind === 'loot') this.game.loot.touched(this.loot.ref);
  }
  onSlotDown(e) {
    const sl = e.target.closest('.slot');
    if (!sl || e.button !== 0) return;
    const cn = sl.dataset.c, i = +sl.dataset.i;
    const c = this.cmap()[cn];
    if (!c) return;
    this.sel = { c: cn, i };
    if (!c.slots[i]) { this.render(true); return; }
    if (e.shiftKey) { this.quickMove(cn, i); this.render(true); return; }
    this.drag = { cn, i, x0: e.clientX, y0: e.clientY, moved: false, half: e.ctrlKey };
    e.preventDefault();
  }
  onDragMove(e) {
    if (!this.drag) return;
    const g = $('dragGhost');
    if (!this.drag.moved && Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0) > 4) {
      this.drag.moved = true;
      const s = this.cmap()[this.drag.cn].slots[this.drag.i];
      if (!s) { this.drag = null; return; }
      g.src = iconURL(s.id); g.hidden = false;
    }
    if (this.drag.moved) { g.style.left = e.clientX - 28 + 'px'; g.style.top = e.clientY - 28 + 'px'; }
  }
  onDragEnd(e) {
    const dr = this.drag; this.drag = null;
    $('dragGhost').hidden = true;
    if (!dr || !dr.moved) { if (dr) this.render(true); return; }
    const P = this.P, m = this.cmap();
    const from = m[dr.cn];
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const sl = el && el.closest('.slot');
    if (sl) {
      const to = m[sl.dataset.c], ti = +sl.dataset.i;
      const s = from.slots[dr.i];
      if (to && s) {
        if (sl.dataset.c === 'wear') {
          const d = ITEMS[s.id];
          if (d.type !== 'wear' || WEAR_SLOTS[ti] !== d.slot) this.toast('That does not go there');
          else if (P.inv.blockedSlot(ti, d) && !(dr.cn === 'wear')) this.toast('Take off your suit first');
          else moveSlot(from, dr.i, to, ti, dr.half ? Math.ceil(s.n / 2) : undefined);
        } else moveSlot(from, dr.i, to, ti, dr.half ? Math.ceil(s.n / 2) : undefined);
        this.sel = { c: sl.dataset.c, i: ti };
      }
    } else if (!el || !el.closest('#panel')) {
      const s = from.take(dr.i);
      if (s) { const d = P.dir(); this.game.loot.dropItem(s.id, s.n, P.x + d.x, P.y + 1.2, P.z + d.z, s); }
      this.sel = null;
    }
    if (this.loot && this.loot.kind === 'loot') this.game.loot.touched(this.loot.ref);
    this.render(true);
  }

  // ================= MODALS =================
  modal(html, onClick, onKey) {
    this.open = 'modal';
    this.unlockForUI();
    const m = $('modal'); m.innerHTML = `<div class="box">${html}<div class="row end"><button class="btn small" data-act="close">Close</button></div></div>`; m.hidden = false;
    m.onclick = e => { const a = e.target.closest('[data-act="close"]'); if (a) { this.close(true); return; } onClick && onClick(e); };
    this.modalKey = onKey || null;
  }
  openBuildMenu() {
    const G = this.game, P = this.P;
    const html = `<h2>Building plan</h2><p class="muted">Pick a piece. Left click places it, R rotates stairs. Everything is placed as twig, then upgraded with the hammer.</p>
      <div class="pieces">${PIECE_ORDER.map(t => `<button class="piece ${G.controls.buildType === t ? 'on' : ''}" data-piece="${t}"><b>${PIECES[t].name}</b><span class="muted">${costText(pieceCost(t, 0), P.inv)}</span></button>`).join('')}</div>`;
    this.modal(html, e => { const b = e.target.closest('[data-piece]'); if (b) { G.controls.buildType = b.dataset.piece; this.close(true); } },
      e => { const n = +e.key; if (n >= 1 && n <= PIECE_ORDER.length) { G.controls.buildType = PIECE_ORDER[n - 1]; this.close(true); return true; } return false; });
  }
  openHammerMenu(p) {
    const G = this.game, P = this.P;
    if (p.door !== undefined && p.type) {
      const opts = GRADES.map((g, i) => i > p.grade ? `<button class="piece" data-grade="${i}"><b>Upgrade to ${g.name}</b><span class="muted">${costText(pieceCost(p.type, i), P.inv)}</span></button>` : '').join('');
      const extra = (G.build.canDemolish(P, p) ? `<button class="piece" data-act2="demolish"><b>Demolish</b><span class="muted">Only in the first 10 minutes</span></button>` : '') + (p.type === 'stairs' && G.build.canDemolish(P, p) ? `<button class="piece" data-act2="rotate"><b>Rotate</b></button>` : '');
      const doorPick = p.door ? `<button class="piece" data-act2="pickdoor"><b>Pick up door</b><span class="muted">Returns the door${p.door.lock ? ' and its lock' : ''}</span></button>` : '';
      const doorInfo = p.door ? `<p>${esc(p.door.type.replace('_', ' '))}: ${Math.round(p.door.hp)}/${p.door.maxHp} health${p.door.lock ? `, ${p.door.lock.type} lock` : ''}</p>` : '';
      this.modal(`<h2>${PIECES[p.type].name} (${GRADES[p.grade].name})</h2><p>Health ${Math.round(p.hp)}/${p.maxHp}, stability ${Math.round(p.stab * 100)}%</p>${doorInfo}<div class="pieces">${opts}${extra}${doorPick}</div>`, e => {
        const g = e.target.closest('[data-grade]'), a = e.target.closest('[data-act2]');
        if (g) { const r = G.build.upgrade(P, p, +g.dataset.grade); this.toast(r.ok ? 'Upgraded' : r.err); if (r.ok) { G.audio.build(); this.close(true); } }
        if (a && a.dataset.act2 === 'demolish') { if (G.build.demolish(P, p)) this.toast('Demolished'); this.close(true); }
        if (a && a.dataset.act2 === 'rotate') { G.build.rotate(P, p); this.close(true); }
        if (a && a.dataset.act2 === 'pickdoor') { const r = G.build.pickupDoor(P, p); this.toast(r.ok ? 'Door picked up' : r.err); this.close(true); }
      });
    }
  }
  openDeployMenu(d) {
    const G = this.game, P = this.P;
    const err = G.deploy.canPickup(P, d);
    const html = `<h2>${esc(d.def.name)}</h2><p>Health ${Math.round(d.hp)}/${d.maxHp}</p>${d.cont && !d.cont.isEmpty() ? '<p class="muted">Its contents will go into your inventory.</p>' : ''}
      <div class="pieces"><button class="piece" data-act2="pickup" ${err ? 'disabled' : ''}><b>Pick up</b><span class="muted">${esc(err || 'Returns the item to your inventory')}</span></button></div>`;
    this.modal(html, e => { const b = e.target.closest('[data-act2="pickup"]'); if (b && !b.disabled) { const r = G.deploy.pickup(P, d); this.toast(r.ok ? `${d.def.name} picked up` : r.err); if (r.ok) G.audio.pickup(); this.close(true); } });
  }
  openCodeEntry(cb, title = 'Enter the code') {
    let code = '';
    const draw = () => { const el = $('codeShow'); if (el) el.textContent = code.padEnd(4, '_'); };
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK'].map(k => `<button class="btn key" data-k="${k}">${k}</button>`).join('');
    const submit = () => { if (code.length === 4) { this.close(true); cb(code); } };
    this.modal(`<h2>${esc(title)}</h2><div id="codeShow" class="code">____</div><div class="keypad">${keys}</div>`, e => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      const k = b.dataset.k;
      if (k === 'C') code = ''; else if (k === 'OK') return submit(); else if (code.length < 4) code += k;
      draw();
    }, e => {
      if (/^Digit\d$/.test(e.code) && code.length < 4) { code += e.code.slice(5); draw(); return true; }
      if (e.code === 'Backspace') { code = code.slice(0, -1); draw(); return true; }
      if (e.code === 'Enter') { submit(); return true; }
      return false;
    });
  }
  openTechTree(bench) {
    const G = this.game, P = this.P, tier = bench.def.bench;
    const draw = () => {
      const rows = RECIPES.filter(r => !r.known && r.tier >= 1 && r.tier <= tier).sort((a, b) => a.tier - b.tier || a.unlock - b.unlock).map(r => {
        const known = P.bp.has(r.id);
        return `<div class="qrow"><img src="${iconURL(r.out)}" alt=""><span>${esc(ITEMS[r.out].name)} <span class="muted">(level ${r.tier})</span></span>${known ? '<span class="ok">Known</span>' : `<button class="btn tiny" data-unlock="${r.id}" ${P.inv.count('scrap') >= r.unlock ? '' : 'disabled'}>Unlock for ${r.unlock} scrap</button>`}</div>`;
      }).join('');
      return `<h2>${esc(bench.def.name)}</h2><p class="muted">You have ${P.inv.count('scrap')} scrap. Crafting next to this bench allows level ${tier} recipes.</p><div class="tech">${rows}</div>`;
    };
    const onClick = e => { const u = e.target.closest('[data-unlock]'); if (u) { if (G.crafting.unlock(P, u.dataset.unlock, tier)) { this.toast(`Unlocked ${ITEMS[u.dataset.unlock].name}`); G.audio.craftDone(); } this.modal(draw(), onClick); } };
    this.modal(draw(), onClick);
  }

  // ================= MAP =================
  buildMapImage() {
    const W = this.game.world, N = 512;
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const x = cv.getContext('2d');
    const img = x.createImageData(N, N);
    const col = { [BIOME.OCEAN]: [40, 90, 120], [BIOME.BEACH]: [214, 198, 150], [BIOME.GRASS]: [110, 150, 70], [BIOME.FOREST]: [62, 105, 52], [BIOME.ROCK]: [128, 122, 115], [BIOME.SNOW]: [232, 236, 240], [BIOME.DESERT]: [206, 170, 110] };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const wx = (i / N - 0.5) * W.size, wz = (j / N - 0.5) * W.size;
      const h = W.heightAt(wx, wz);
      let c = col[W.biomeAt(wx, wz)] || [100, 100, 100];
      if (h < 0) { const d = Math.min(1, -h / 14); c = [60 - d * 30, 120 - d * 40, 150 - d * 30]; }
      const shade = 0.85 + Math.max(-0.2, Math.min(0.25, (W.heightAt(wx - 4, wz - 4) - h) * 0.06));
      const r = W.riverAt(wx, wz) > h - 0.2 && W.riverAt(wx, wz) > -900;
      const road = W.isRoad(wx, wz);
      const k = (j * N + i) * 4;
      const cc = road ? [70, 66, 60] : r ? [60, 130, 170] : c;
      img.data[k] = cc[0] * shade; img.data[k + 1] = cc[1] * shade; img.data[k + 2] = cc[2] * shade; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    this.mapImg = cv;
  }
  openMap() {
    if (!this.mapImg) this.buildMapImage();
    this.open = 'map';
    this.unlockForUI();
    $('mapScreen').hidden = false;
    this.mapSide();
    this.drawMap();
  }
  get mapOpts() { const G = this.game; return (G.prefs.map = Object.assign({ bases: false, raids: true, clans: true }, G.prefs.map || {})); }
  // Clans ranked by size and strength from what they really own.
  clanTable() {
    const G = this.game, out = [];
    for (const t of G.teams.teams.values()) {
      const st = t.base && t.base.st ? G.build.structures.get(t.base.st) : null;
      const prog = G.bots.progressOf(t);
      const alive = G.teams.alive(t).length;
      let grade = 0; if (st) { let g = 0, n = 0; for (const p of st.pieces.values()) { g += p.grade; n++; } grade = n ? g / n : 0; }
      const pieces = st ? st.pieces.size : 0;
      const score = t.size * 30 + pieces * 2 + prog.bench * 60 + grade * 30 + t.stats.raidsWon * 30 + t.stats.kills * 0.5;
      out.push({ t, st, alive, pieces, bench: prog.bench, grade, score });
    }
    return out.sort((a, b) => b.score - a.score);
  }
  mapSide() {
    const G = this.game, O = this.mapOpts;
    const GR = ['twig', 'wood', 'stone', 'metal', 'armoured'];
    const check = (k, label) => `<label class="mapOpt"><input type="checkbox" data-mopt="${k}" ${O[k] ? 'checked' : ''}> ${label}</label>`;
    const clans = this.clanTable();
    const top = clans[0];
    const biggest = top ? `<p><b style="color:${top.t.color}">${esc(top.t.name)}</b> run the island: ${top.t.size} members, ${top.pieces ? `a ${GR[Math.round(top.grade)]} base of ${top.pieces} pieces` : 'no base yet'}, ${top.t.stats.raidsWon} ${top.t.stats.raidsWon === 1 ? 'raid' : 'raids'} won and ${top.t.stats.kills} ${top.t.stats.kills === 1 ? 'kill' : 'kills'}.</p>` : '';
    const clanRows = clans.slice(0, 10).map((c, i) => `<tr><td>${i + 1}</td><td><span class="swatch" style="background:${c.t.color}"></span>${esc(c.t.name)}<div class="muted">${(STYLES[c.t.style] || STYLES.balanced).name}, ${c.t.tier}</div></td><td>${c.alive}/${c.t.size}</td><td>${c.pieces ? `${c.pieces} ${GR[Math.round(c.grade)]}` : 'none'}</td><td>${c.bench ? 'T' + c.bench : '-'}</td><td>${c.t.stats.raidsWon}/${c.t.stats.raids}</td><td>${c.t.stats.kills}</td></tr>`).join('');
    const clanHTML = O.clans ? `<h3>Clans</h3><table class="clanTable"><tr><th></th><th>Clan</th><th>Alive</th><th>Base</th><th>Bench</th><th>Raids won</th><th>Kills</th></tr>${clanRows}</table>` : '';
    const log = G.log.slice(-12).reverse().map(l => `<p><span class="muted">Day ${l.day} ${l.clock}</span> ${esc(l.text)}</p>`).join('') || '<p class="muted">Nothing has happened yet.</p>';
    const won = G.raidHistory.filter(r => r.result === 'success').length;
    const raids = G.raidHistory.slice(-10).reverse().map(r => `<p><span class="swatch" style="background:${r.color || '#888'}"></span>Day ${r.day}: ${esc(r.team)} vs ${esc(r.target)}, ${esc(r.result === 'success' ? 'raided' : r.result)}${r.value ? ` (${r.value} scrap worth)` : ''}</p>`).join('') || '<p class="muted">No raids yet.</p>';
    const teams = [...G.teams.teams.values()];
    const bases = teams.filter(t => t.base && t.base.st).length;
    $('mapSide').innerHTML = `<div class="mapOpts">${check('bases', 'Show every clan base')}${check('raids', 'Show raid spots')}${check('clans', 'Show clan list')}</div>
      <h3>Biggest clan</h3>${biggest || '<p class="muted">No clans yet.</p>'}${clanHTML}
      <h3>Raids</h3><p class="muted">${G.raidHistory.length} raids so far, ${won} of them successful.</p>${raids}
      <h3>Island news</h3>${log}
      <h3>World</h3><p>${G.bots.list.filter(b => b.alive).length} of ${G.bots.list.length} survivors alive in ${teams.length} groups, ${bases} of them with a base.</p>`;
    $('mapSide').onchange = e => { const k = e.target.dataset.mopt; if (!k) return; this.mapOpts[k] = e.target.checked; G.applyPrefs(); this.mapSide(); this.drawMap(); };
  }
  drawMap() {
    if (this.open !== 'map') return;
    const G = this.game, W = G.world, cv = $('mapCv'), x = cv.getContext('2d');
    const S = cv.width;
    const toM = (wx, wz) => [(wx / W.size + 0.5) * S, (wz / W.size + 0.5) * S];
    x.drawImage(this.mapImg, 0, 0, S, S);
    x.font = '600 13px Nunito, sans-serif'; x.textAlign = 'center';
    for (const m of W.monuments) {
      const [a, b] = toM(m.x, m.z);
      x.fillStyle = m.rad ? '#e0c040' : '#f0ece4'; x.beginPath(); x.arc(a, b, 4, 0, 7); x.fill();
      x.fillStyle = '#111'; x.fillText(m.name, a + 1, b - 7); x.fillStyle = '#f4f1ea'; x.fillText(m.name, a, b - 8);
    }
    const O = this.mapOpts;
    // every clan's base, in the clan's colour (optional)
    if (O.bases) {
      x.font = '700 11px Nunito, sans-serif';
      for (const t of G.teams.teams.values()) {
        const st = t.base && t.base.st ? G.build.structures.get(t.base.st) : null; if (!st) continue;
        const z = G.build.zoneOf(st); const [a, b] = toM(z.x, z.z);
        x.fillStyle = t.color; x.strokeStyle = '#111'; x.lineWidth = 1.5; x.beginPath(); x.rect(a - 4, b - 4, 8, 8); x.fill(); x.stroke();
        x.fillStyle = '#111'; x.fillText(t.name, a + 1, b + 15); x.fillStyle = '#f4f1ea'; x.fillText(t.name, a, b + 14);
      }
      x.font = '600 13px Nunito, sans-serif';
    } else {
      // structures the player has seen
      x.fillStyle = '#d0583a';
      for (const s of G.seen.values()) { const [a, b] = toM(s.x, s.z); x.fillRect(a - 3, b - 3, 6, 6); }
    }
    // where raids happened: a ring in the raiders' colour, filled when the raid succeeded
    if (O.raids) for (const r of G.raidHistory.slice(-30)) {
      if (r.x === undefined) continue;
      const [a, b] = toM(r.x, r.z);
      x.strokeStyle = r.color || '#e05a4a'; x.lineWidth = 2.5; x.beginPath(); x.arc(a, b, 9, 0, 7); x.stroke();
      if (r.result === 'success') { x.fillStyle = r.color || '#e05a4a'; x.globalAlpha = 0.35; x.fill(); x.globalAlpha = 1; }
    }
    // own buildings + bags
    x.fillStyle = '#6ea3e0';
    for (const st of G.build.structures.values()) if (st.team === this.P.team) { const z = G.build.zoneOf(st); const [a, b] = toM(z.x, z.z); x.fillRect(a - 4, b - 4, 8, 8); }
    for (const d of G.deploy.bagsOf(this.P.id)) { const [a, b] = toM(d.x, d.z); x.strokeStyle = '#6ea3e0'; x.lineWidth = 2; x.strokeRect(a - 4, b - 4, 8, 8); }
    if (G.deathSpot) { const [a, b] = toM(G.deathSpot.x, G.deathSpot.z); x.strokeStyle = '#ff4a4a'; x.lineWidth = 2; x.beginPath(); x.moveTo(a - 5, b - 5); x.lineTo(a + 5, b + 5); x.moveTo(a + 5, b - 5); x.lineTo(a - 5, b + 5); x.stroke(); }
    // player
    const P = this.P;
    if (P) {
      const [a, b] = toM(P.x, P.z);
      x.save(); x.translate(a, b); x.rotate(-P.yaw + Math.PI);
      x.fillStyle = '#fff'; x.strokeStyle = '#111'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -9); x.lineTo(6, 7); x.lineTo(0, 3); x.lineTo(-6, 7); x.closePath(); x.stroke(); x.fill();
      x.restore();
    }
  }

  // ================= DEATH =================
  showDeath(info) {
    this.close(false);
    this.unlockForUI();
    const G = this.game, P = this.P;
    const killer = info.killer;
    let cause = 'You died.';
    if (killer && killer.kind === 'survivor') cause = `You were killed by ${killer.name}${killer.ai ? ` of ${G.teams.of(killer)?.name || 'a group'}` : ''}.`;
    else if (killer && killer.kind === 'npc') cause = 'You were shot by the militia.';
    else if (killer && killer.kind === 'animal') cause = `You were killed by a ${killer.species}.`;
    else if (info.info && info.info.cause) cause = `You died of ${info.info.cause}.`;
    else if (info.info && info.info.type === 'fall') cause = 'You died from a fall.';
    this.showScreen('deathScreen');
    $('dsCause').textContent = cause;
    const draw = () => {
      const bags = G.deploy.bagsOf(P.id);
      const html = `<button class="btn go" data-spawn="beach">Respawn on a beach</button>` + bags.map(d => {
        const ready = G.deploy.spawnReady(d);
        const left = (d.type === 'bed' ? 60 : 120) - (G.now - d.lastUsed);
        return `<button class="btn" data-spawn="${d.id}" ${ready ? '' : 'disabled'}>${d.def.name}${ready ? '' : ` (${fmtTime(left)})`}</button>`;
      }).join('');
      if (html === this.deathHTML) return;
      this.deathHTML = html;
      // keep the beach button node alive so a click in progress is not lost
      const box = $('dsSpawns');
      if (!box.firstChild) box.innerHTML = html;
      else { while (box.children.length > 1) box.lastChild.remove(); box.insertAdjacentHTML('beforeend', html.slice(html.indexOf('</button>') + 9)); }
    };
    this.deathHTML = null; $('dsSpawns').innerHTML = '';
    draw();
    this.deathTimer = setInterval(draw, 1000);
    $('dsSpawns').onclick = e => { const b = e.target.closest('[data-spawn]'); if (!b || b.disabled) return; clearInterval(this.deathTimer); this.hideScreens(); G.respawnPlayer(b.dataset.spawn === 'beach' ? null : b.dataset.spawn); };
  }

  // ================= HUD =================
  toast(msg) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 2600);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }
  pickupNote(id, n) {
    const box = $('notes');
    const ex = [...box.children].find(c => c.dataset.id === id && Date.now() - c.dataset.t < 2500);
    if (ex) { ex.dataset.n = +ex.dataset.n + n; ex.dataset.t = Date.now(); ex.querySelector('span').textContent = `+${ex.dataset.n} ${ITEMS[id].name}`; return; }
    const el = document.createElement('div'); el.className = 'note'; el.dataset.id = id; el.dataset.n = n; el.dataset.t = Date.now();
    el.innerHTML = `<img src="${iconURL(id)}" alt=""><span>+${n} ${esc(ITEMS[id].name)}</span>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3000);
    while (box.children.length > 6) box.firstChild.remove();
  }
  setPrompt(t) { const el = $('prompt'); if (el.textContent !== (t || '')) el.textContent = t || ''; el.hidden = !t; }
  hitmarker(head) { const h = $('hitmark'); h.className = head ? 'show head' : 'show'; clearTimeout(this.hmT); this.hmT = setTimeout(() => h.className = '', 120); this.game.audio.hitmark(); }
  damageFlash() { const d = $('dmgflash'); d.style.opacity = 0.45; clearTimeout(this.dfT); this.dfT = setTimeout(() => d.style.opacity = 0, 160); }

  updateHUD(dt) {
    const P = this.P, G = this.game;
    if (!P) return;
    const bar = (id, v, max) => { const el = $(id); el.querySelector('i').style.width = Math.max(0, Math.min(100, v / max * 100)) + '%'; el.querySelector('b').textContent = Math.round(v); };
    bar('vHp', P.hp, 100); bar('vCal', P.cal, 500); bar('vHyd', P.hyd, 250);
    // status lines
    const st = [];
    if (P.bleed > 0.05) st.push('<span class="bad">Bleeding</span>');
    if (P.radLevel > 0 || P.rads > 5) st.push(`<span class="warn">Radiation ${Math.round(P.rads)}${P.radLevel > 0 ? ' and rising' : ''}</span>`);
    if (P.bodyTemp < 8) st.push(`<span class="cold">Cold ${Math.round(P.bodyTemp)}°C</span>`);
    else if (P.bodyTemp > 34) st.push(`<span class="warn">Hot ${Math.round(P.bodyTemp)}°C</span>`);
    if (P.poison > 0.5) st.push('<span class="bad">Food poisoning</span>');
    const priv = G.build.privilegeAt(P.team, P.x, P.z);
    if (priv === 'blocked') st.push('<span class="bad">Building blocked</span>');
    else if (priv === 'auth') st.push('<span class="ok">Building privilege</span>');
    const sh = st.join('');
    if ($('vStatus').innerHTML !== sh) $('vStatus').innerHTML = sh;
    // hotbar
    const hv = P.inv.belt.version + ':' + P.active + ':' + P.inv.main.version;
    if (hv !== this.hotV) {
      this.hotV = hv;
      $('hotbar').innerHTML = P.inv.belt.slots.map((s, i) => {
        if (!s) return `<div class="hslot ${i === P.active ? 'on' : ''}"><span class="key">${i + 1}</span></div>`;
        const d = ITEMS[s.id];
        const n = s.n > 1 ? `<b class="n">${s.n}</b>` : '';
        const cond = s.c !== undefined ? `<i class="cond" style="height:${Math.round(s.c * 100)}%"></i>` : '';
        return `<div class="hslot ${i === P.active ? 'on' : ''}"><span class="key">${i + 1}</span><img src="${iconURL(s.id)}" alt="">${n}${cond}</div>`;
      }).join('');
    }
    // ammo + held info
    const a = P.activeStack(), d = a && ITEMS[a.id];
    let info = '';
    if (d && d.type === 'gun') info = `${a.ammo} / ${P.inv.count(a.at)} ${ITEMS[a.at].name}${P.reloadT > 0 ? ', reloading' : ''}${d.ammo.length > 1 ? '. F switches ammo' : ''}`;
    else if (d && d.type === 'bow') info = `${P.inv.count(a.at)} ${ITEMS[a.at].name}. Hold right mouse to draw`;
    else if (d && d.type === 'plan') info = `${PIECES[G.controls.buildType].name}: ${Object.entries(pieceCost(G.controls.buildType, 0)).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ')}. Right mouse to pick a piece${G.controls.buildErr ? `. ${G.controls.buildErr}` : ''}`;
    else if (d && d.type === 'hammer') info = 'Left mouse repairs, right mouse upgrades the piece you look at';
    else if (d && d.type === 'deploy') info = G.controls.buildErr ? G.controls.buildErr : `Left mouse places, R rotates`;
    else if (d && d.type === 'raid') info = 'Left mouse sticks it to what you look at';
    if ($('held').textContent !== info) $('held').textContent = info;
    // crafting queue
    const qv = P.craftQueue.map(q => q.id + Math.ceil(q.left)).join(',');
    if (qv !== this.qV) { this.qV = qv; $('queue').innerHTML = P.craftQueue.slice(0, 5).map((q, i) => `<div class="qrow"><img src="${iconURL(q.id)}" alt=""><span>${i === 0 ? fmtTime(q.left) : ''}</span></div>`).join(''); }
    // clock + compass + debug
    const yawDeg = ((-P.yaw * 180 / Math.PI) % 360 + 360 + 180) % 360;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const top = `${G.env.clock()}, day ${G.env.day}, ${G.env.weather}. Facing ${dirs[Math.round(yawDeg / 45) % 8]}`;
    if ($('clock').textContent !== top) $('clock').textContent = top;
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 1) { $('perf').textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps, sim ${G.sim.stats.ms.toFixed(1)} ms`; this.fpsAcc = 0; this.fpsN = 0; }
    if (this.open === 'inv') this.render(false);
    if (this.open === 'map') { this.mapT = (this.mapT || 0) + dt; if (this.mapT > 0.5) { this.mapT = 0; this.drawMap(); } }
    if (this.open === 'inv' && this.loot) {
      // walked away from the container?
      const r = this.loot.ref;
      if (!r || Math.hypot(r.x - P.x, r.z - P.z) > 4.5 || (this.loot.kind === 'bag' && !G.loot.bags.includes(r)) || (this.loot.kind === 'loot' && !r.alive)) { this.loot = null; this.tab = 'craft'; this.render(true); }
    }
  }
}
export { MONUMENT_TYPES, DEPLOYABLES };

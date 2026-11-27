// Militia: armed guards posted at the bigger monuments. Hostile to every survivor.
import { HumanoidAvatar } from '../entities/Avatars.js';
import { ITEMS, makeStack } from '../data/items.js';
import { uid, randRange, dist, angleWrap, pick } from '../core/util.js';

const RESPAWN = 360;
const LOADOUT = { 3: ['semi_rifle', 'drum_smg', 'pump_shotgun', 'assault_rifle'], 2: ['semi_rifle', 'drum_smg', 'pump_shotgun'], 1: ['revolver', 'double_barrel'] };

export class NPCSystem {
  constructor(game) { this.game = game; this.list = []; this.posts = []; }
  init(monumentData) {
    for (const md of monumentData) for (const p of md.npcs) this.posts.push({ ...p, tier: md.m.tier, npc: null, respawnAt: 0 });
    for (const post of this.posts) this.spawn(post);
  }
  spawn(post) {
    const weapon = pick(LOADOUT[post.tier] || LOADOUT[2]);
    const n = {
      kind: 'npc', id: uid('np'), name: 'Militia', x: post.x + randRange(-3, 3), y: post.y, z: post.z + randRange(-3, 3), yaw: Math.random() * 6.28,
      hp: 150, maxHp: 150, alive: true, post, weapon, mag: ITEMS[weapon].mag, fireT: 0, reloadT: 0, target: null, seenT: 0, crouch: false, r: 0.35, h: 1.8,
      vx: 0, vy: 0, vz: 0, wander: null, wanderT: 0, react: 0,
    };
    n.onDamage = (amount, info) => this.onDamage(n, amount, info);
    n.avatar = new HumanoidAvatar({ uniform: { torso: 0x3d4a3a, legs: 0x2f3a2c, helm: 0x2a2f2a, mask: true } });
    n.avatar.setHeld(weapon);
    n.avatar.root.position.set(n.x, n.y, n.z);
    this.game.scene.add(n.avatar.root);
    post.npc = n;
    this.list.push(n);
    this.game.actors.add(n);
  }
  onDamage(n, amount, info) {
    const armor = info.area === 'head' ? 0.35 : 0.45;
    n.hp -= amount * (1 - armor);
    if (info.attacker && info.attacker.kind === 'survivor') { n.target = info.attacker; n.seenT = 8; n.react = 0.2; }
    if (n.hp <= 0) this.die(n, info);
  }
  die(n, info) {
    n.alive = false;
    this.game.actors.delete(n);
    this.list.splice(this.list.indexOf(n), 1);
    this.game.scene.remove(n.avatar.root);
    const stacks = this.game.loot.roll('militia');
    if (Math.random() < 0.3) { const s = makeStack(n.weapon); s.c = randRange(0.2, 0.6); stacks.push(s); }
    this.game.loot.spawnBag(n.x, n.y + 0.5, n.z, stacks, 'Militia body', 600);
    n.post.npc = null; n.post.respawnAt = this.game.now + RESPAWN;
    this.game.events.emit('npcKilled', { npc: n, killer: info && info.attacker });
  }
  update(dt) {
    const now = this.game.now, P = this.game.player;
    for (const post of this.posts) if (!post.npc && now >= post.respawnAt) {
      if (P && dist(P.x, P.z, post.x, post.z) < 60) { post.respawnAt = now + 30; continue; }
      this.spawn(post);
    }
    for (const n of this.list) {
      const active = (P && Math.abs(n.x - P.x) + Math.abs(n.z - P.z) < 320) || this._botNear(n);
      n.avatar.root.visible = P && Math.abs(n.x - P.x) + Math.abs(n.z - P.z) < 320;
      if (!active) continue;
      this.think(n, dt);
    }
  }
  _botNear(n) { let f = false; this.game.actorHash.query(n.x, n.z, 120, a => { if (a.kind === 'survivor' && a.alive && !a.isPlayer) { f = true; return true; } }); return f; }
  think(n, dt) {
    const W = this.game.world, def = ITEMS[n.weapon];
    n.fireT -= dt; n.react -= dt;
    if (n.reloadT > 0) { n.reloadT -= dt; if (n.reloadT <= 0) n.mag = def.mag; }
    // acquire
    n.seenT -= dt;
    if (!n.target || !n.target.alive || n.seenT <= -6) {
      n.target = null;
      let best = null, bd = 50;
      const mon = this.game.world.monuments.find(m => m.id === n.post.mon);
      this.game.actorHash.query(n.x, n.z, 50, a => {
        if (a.kind !== 'survivor' || !a.alive) return;
        // guards defend their monument; they leave passers-by on the road alone
        if (mon && dist(a.x, a.z, mon.x, mon.z) > mon.r + 12) return;
        const d = dist(n.x, n.z, a.x, a.z);
        if (d < bd && this.game.physics.los({ x: n.x, y: n.y + 1.6, z: n.z }, { x: a.x, y: a.y + 1.4, z: a.z })) { bd = d; best = a; }
      });
      if (best) { n.target = best; n.seenT = 3; n.react = 0.6; }
    }
    let moving = 0;
    if (n.target) {
      const t = n.target;
      const d = dist(n.x, n.z, t.x, t.z);
      const eye = { x: n.x, y: n.y + 1.6, z: n.z };
      const aimP = { x: t.x, y: t.y + (t.crouch ? 0.9 : 1.3), z: t.z };
      const vis = this.game.physics.los(eye, aimP);
      if (vis) n.seenT = 3;
      n.yaw += angleWrap(Math.atan2(t.x - n.x, t.z - n.z) - n.yaw) * Math.min(1, dt * 6);
      if (vis && n.react <= 0 && n.fireT <= 0 && n.reloadT <= 0) {
        if (n.mag <= 0) n.reloadT = def.reload;
        else {
          n.mag--; n.fireT = 60 / def.rpm * (def.auto ? 1.4 : 1.8);
          const dx = aimP.x - eye.x, dy = aimP.y - eye.y, dz = aimP.z - eye.z, L = Math.hypot(dx, dy, dz);
          const err = 0.035 + d * 0.0006;
          const ammo = ITEMS[def.ammo[0]];
          const pellets = ammo.pellets || 1;
          for (let p = 0; p < pellets; p++) {
            const ex = randRange(-err, err) + (pellets > 1 ? randRange(-0.06, 0.06) : 0), ey = randRange(-err, err) * 0.7;
            const ux = dx / L + ex, uy = dy / L + ey + d * 0.00025, uz = dz / L - ex * 0.3;
            const ul = Math.hypot(ux, uy, uz);
            const v = def.vel * (ammo.velMult || 1);
            this.game.combat.spawnProjectile({ x: eye.x + ux / ul * 0.5, y: eye.y + uy / ul * 0.5, z: eye.z + uz / ul * 0.5, vx: ux / ul * v, vy: uy / ul * v, vz: uz / ul * v, dmg: def.dmg * (ammo.dmgMult || 1) * 0.7, owner: n, weapon: n.weapon, bleed: 0.3, headMult: 2 });
          }
          this.game.events.emit('noise', { x: n.x, z: n.z, r: 150, src: n, kind: 'shot', weapon: n.weapon });
          this.game.audio && this.game.audio.shot(def, n);
        }
      }
      // hold position near post, strafe a little
      if (dist(n.x, n.z, n.post.x, n.post.z) < 25 && d > 12) moving = 1;
      if (moving) { const a = n.yaw + Math.sin(this.game.now * 0.7 + n.x) * 1.4; n.vx = Math.sin(a) * 2.2; n.vz = Math.cos(a) * 2.2; }
    } else {
      // patrol around the post
      n.wanderT -= dt;
      if (n.wanderT <= 0) { n.wanderT = randRange(4, 10); n.wander = { x: n.post.x + randRange(-10, 10), z: n.post.z + randRange(-10, 10) }; }
      if (n.wander && dist(n.x, n.z, n.wander.x, n.wander.z) > 1) {
        const a = Math.atan2(n.wander.x - n.x, n.wander.z - n.z);
        n.yaw += angleWrap(a - n.yaw) * Math.min(1, dt * 4);
        n.vx = Math.sin(n.yaw) * 1.4; n.vz = Math.cos(n.yaw) * 1.4; moving = 1;
      }
    }
    if (!moving) { n.vx = 0; n.vz = 0; }
    n.vy -= 9.8 * dt;
    this.game.physics.move(n, dt);
    n.avatar.root.position.set(n.x, n.y, n.z); n.avatar.root.rotation.y = n.yaw;
    n.avatar.animate(dt, Math.hypot(n.vx, n.vz), { aim: !!n.target });
  }
  serialize() { return this.posts.map(p => [p.npc ? 1 : 0, Math.round(p.respawnAt), p.npc ? Math.round(p.npc.hp) : 0]); }
  load(arr) {
    if (!arr) return;
    arr.forEach((row, i) => {
      const p = this.posts[i]; if (!p) return;
      if (!row[0] && p.npc) { const n = p.npc; this.game.actors.delete(n); this.list.splice(this.list.indexOf(n), 1); this.game.scene.remove(n.avatar.root); p.npc = null; p.respawnAt = row[1]; }
      else if (p.npc) p.npc.hp = row[2] || 150;
    });
  }
}

// World tick scheduler: runs every system each frame, with level-of-detail for bots, animals and NPCs.
// Distant activity keeps happening (abstract ticks), so the world moves on while the player is elsewhere.
import { dist } from '../core/util.js';

export class WorldSimulation {
  constructor(game) {
    this.game = game;
    this.decayAcc = 0; this.hashT = 0; this.seenT = 0; this.visT = 0;
    this.autosaveT = 0;
    this.stats = { ms: 0 };
  }
  update(dt) {
    const G = this.game, t0 = performance.now();
    G.now += dt;
    // clock, weather, decay/upkeep (applied every 10 s of in-game hours)
    this.decayAcc += G.env.advance(dt);
    if (this.decayAcc > 0.1) { G.build.tickDecay(this.decayAcc); this.decayAcc = 0; }
    // actor spatial hash: near actors every frame, everyone else twice a second
    this.hashT -= dt;
    const full = this.hashT <= 0; if (full) this.hashT = 0.5;
    const P = G.player;
    for (const a of G.actors) {
      if (!a.alive) { G.actorHash.remove(a); continue; }
      if (full || (P && Math.abs(a.x - P.x) + Math.abs(a.z - P.z) < 250)) G.actorHash.update(a);
    }
    // player systems
    if (P && P.alive) { G.surv.tick(P, dt, G.controls.sprinting); G.crafting.tick(P, dt); }
    G.bots.update(dt);
    G.animals.update(dt);
    G.npcs.update(dt);
    G.combat.update(dt);
    G.loot.update(dt);
    G.res.update(dt);
    G.deploy.update(dt);
    // what the player has seen (for the map)
    this.seenT -= dt;
    if (this.seenT <= 0 && P) {
      this.seenT = 1;
      G.build.pieceHash.query(P.x, P.z, 160, p => { if (!G.seen.has(p.st)) { const st = G.build.structures.get(p.st); if (st && st.team !== P.team) G.seen.set(p.st, { x: p.wx, z: p.wz, t: G.now }); } });
      for (const id of [...G.seen.keys()]) if (!G.build.structures.has(id)) G.seen.delete(id);
    }
    this.visT -= dt;
    if (this.visT <= 0 && P) { this.visT = 0.5; G.res.updateVisibility(P); }
    // autosave
    this.autosaveT += dt;
    if (this.autosaveT > G.settings.autosave) { this.autosaveT = 0; G.saveGame(true); }
    this.stats.ms = this.stats.ms * 0.95 + (performance.now() - t0) * 0.05;
  }
}

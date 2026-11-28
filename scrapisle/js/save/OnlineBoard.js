// Posts your Clan Wars score to the Hall of Challengers on the EduArcade homepage (server/challenger.js,
// board 'clanwars', through ranked.js). Every world posts (Normal is the easiest difficulty).
// Score: 1000 per raid defended, plus K/D × 100 (capped at 999) to break ties. The server keeps your
// best world. Each post uses a run token the server signed when the previous one finished.
const GAME = 'clanwars';
const CHECK_MS = 60000;               // look for a better score once a minute
const TOKEN_MAX_MS = 2.5 * 3600e3;    // the server refuses tokens older than 3 h

export const boardScore = s => 1000 * s.def + Math.min(999, Math.round(100 * s.kills / Math.max(1, s.deaths)));

export class OnlineBoard {
  constructor(game) {
    this.game = game;
    this.run = null; this.runAt = 0; this.busy = false;
    this.nextT = performance.now() + 20000;
    this.status = null;              // last answer from the server: { rank, challenger, best }
  }
  get on() { return !!(window.Ranked && Ranked.crStart) && !(this.game.pstats && this.game.pstats.admin); }   // admin-space worlds don't post
  stats() {
    const P = this.game.player;
    return { def: this.game.pstats.defended || 0, kills: (P && P.kills) || 0, deaths: (P && P.deaths) || 0 };
  }
  start() {
    if (!this.on) return;
    this.run = null;
    Ranked.crStart(GAME).then(r => { this.run = r; this.runAt = Date.now(); }).catch(() => { this.nextT = performance.now() + 5 * CHECK_MS; });
  }
  // A raid was just defended: post within a few seconds
  soon() { this.nextT = Math.min(this.nextT, performance.now() + 3000); }
  update() {
    const now = performance.now();
    if (now < this.nextT || this.busy || !this.on) return;
    this.nextT = now + CHECK_MS;
    if (!this.run) return this.start();
    if (Date.now() - this.runAt > TOKEN_MAX_MS) return this.start();
    const s = this.stats(), score = boardScore(s), ps = this.game.pstats;
    if (score <= 0 || score <= (ps.posted || 0)) return;
    if (Date.now() - this.runAt < 6000) { this.nextT = now + 7000; return; }
    this.busy = true;
    const run = this.run; this.run = null;
    Ranked.crFinish(run, s).then(j => {
      const was = this.status;
      ps.posted = score;
      this.status = { rank: j.rank, challenger: j.challenger, best: j.best };
      if (j.improved && (!was || j.rank < was.rank))
        this.game.ui.toast(j.challenger ? `You're a Challenger: #${j.rank} in Clan Wars` : `Clan Wars Hall of Challengers: you're #${j.rank}`);
    }).catch(() => { }).finally(() => { this.busy = false; this.start(); });
  }
}

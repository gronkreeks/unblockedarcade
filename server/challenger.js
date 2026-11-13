// Challenger: the rank above Champion. Champions keep playing the Champion bot, and every ranked win
// at Champion posts a score here. The top 3 on each game's leaderboard are that game's Challengers.
//
// Runs are timed by the server: the page asks for a signed run token when a Champion match starts and
// hands it back with the win, so the time on the board is the real time between the two, and nobody
// can post a faster time than they played. Tokens are signed (HMAC), not stored, so a run still counts
// if this free server went to sleep during a long match.
//
// Scores are kept in Upstash Redis when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set
// (free, survives restarts). Without them the boards live in memory and reset when the server sleeps.
//
// HTTP API (all JSON):
//   POST /cr/start  { game }                         → { run }
//   POST /cr/finish { run, key, name, stats }        → { score, best, rank, improved, challenger, board }
//   GET  /cr/board?game=chess&me=<id>                → { game, board, you }      (me = public player id)
//   GET  /cr/boards?me=<id>                          → { boards: { chess: {...}, ... } }
//   POST /cr/name   { key, name }                    → { ok, name }
'use strict';
const crypto = require('crypto');
const { redis, signer, same } = require('./secret.js');

const TOP_N = 3;          // Challengers per game
const BOARD_SIZE = 25;    // rows sent to pages
const MAX_RUN_MS = 3 * 3600 * 1000;

// Each game's score: faster wins score more, cleaner wins get a bonus. Stats are clamped to sane ranges.
// t = seconds the server measured between the start and the win.
const GAMES = {
  chess: {
    minT: 5, stats: { moves: [1, 400] },
    score: (t, s) => 3000 - 25 * s.moves - 2 * t,
  },
  volley: {
    minT: 15, stats: { pf: [0, 99], pa: [0, 99], rl: [0, 1] },
    score: (t, s) => 3000 - 8 * t + 40 * (s.pf - s.pa) - 300 * s.rl,
  },
  boxing: {
    minT: 10, stats: { dealt: [0, 2000], taken: [0, 2000], rl: [0, 1] },
    score: (t, s) => 3000 - 8 * t + 3 * (s.dealt - s.taken) - 300 * s.rl,
  },
  timberfall: {
    minT: 30, stats: { kills: [0, 99], dmg: [0, 50000] },
    score: (t, s) => 3000 - 3 * t + 120 * s.kills + s.dmg / 10,
  },
  frontier: {
    minT: 60, stats: { kills: [0, 99], land: [0, 100] },
    score: (t, s) => 4000 - 2 * t + 80 * s.kills,
  },
};

function tidyName(raw) {
  const n = String(raw == null ? '' : raw).normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 16);
  return n.length >= 2 ? n : '';
}
const playerId = key => crypto.createHash('sha256').update('eduarcade-cr|' + key).digest('hex').slice(0, 16);
const validKey = key => typeof key === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(key);

function createStore() {
  return {
    persistent: !!redis,
    async load(game) {
      if (!redis) return new Map();
      const flat = await redis(['HGETALL', 'cr:' + game]) || [];
      const m = new Map();
      for (let i = 0; i + 1 < flat.length; i += 2) { try { m.set(flat[i], JSON.parse(flat[i + 1])); } catch (e) { } }
      return m;
    },
    async save(game, id, entry) { if (redis) await redis(['HSET', 'cr:' + game, id, JSON.stringify(entry)]); },
  };
}

function createChallenger(opts) {
  const log = (opts && opts.log) || console.log;
  const store = createStore();
  const boards = {};                 // game → Map(id → { name, score, t, stats, at, runs })
  let ready = Promise.all(Object.keys(GAMES).map(async g => {
    try { boards[g] = await store.load(g); } catch (e) { log('challenger: could not load ' + g + ': ' + e.message); boards[g] = new Map(); }
  })).then(() => log(`challenger: boards ready (${store.persistent ? 'Upstash' : 'memory only'})`));

  const sign = signer('challenger-run');
  function newRun(game) {
    const body = `${game}.${Date.now()}.${crypto.randomBytes(6).toString('base64url')}`;
    return body + '.' + sign(body);
  }
  function readRun(run) {
    const parts = String(run || '').split('.');
    if (parts.length !== 4) return null;
    const body = parts.slice(0, 3).join('.');
    if (!same(sign(body), parts[3])) return null;
    return { game: parts[0], start: +parts[1], nonce: parts[2] };
  }
  const usedRuns = new Map();        // nonce → expiry, so one win can't be posted twice (while awake)

  function sorted(game) {
    return [...boards[game].entries()].map(([id, e]) => ({ id, ...e })).sort((a, b) => b.score - a.score || a.at - b.at);
  }
  function rowOf(e, i) { return { rank: i + 1, id: e.id, name: e.name, score: e.score, t: e.t, stats: e.stats, at: e.at, runs: e.runs || 1, challenger: i < TOP_N }; }
  function boardFor(game, me) {
    const all = sorted(game), i = me ? all.findIndex(e => e.id === me) : -1;
    return { game, top: TOP_N, players: all.length, board: all.slice(0, BOARD_SIZE).map(rowOf), you: i >= 0 ? rowOf(all[i], i) : null };
  }

  // Simple per-address limit so the board can't be flooded
  const hits = new Map();
  const limited = ip => {
    const t = Date.now(), h = (hits.get(ip) || []).filter(x => t - x < 60000);
    h.push(t); hits.set(ip, h);
    return h.length > 40;
  };
  setInterval(() => {
    const t = Date.now();
    for (const [k, h] of hits) if (!h.some(x => t - x < 60000)) hits.delete(k);
    for (const [k, exp] of usedRuns) if (exp < t) usedRuns.delete(k);
  }, 60000).unref();

  async function finish(body) {
    const run = readRun(body.run);
    if (!run || !GAMES[run.game]) return { error: 'That run is not valid.' };
    const G = GAMES[run.game], ms = Date.now() - run.start;
    if (ms > MAX_RUN_MS) return { error: 'That run is too old to count.' };
    if (usedRuns.has(run.nonce)) return { error: 'That win was already posted.' };
    if (!validKey(body.key)) return { error: 'Missing player key.' };
    const t = Math.round(ms / 100) / 10;
    if (t < G.minT) return { error: 'That win was too fast to be real.' };
    const stats = {};
    for (const [k, [lo, hi]] of Object.entries(G.stats)) {
      const v = Number(body.stats && body.stats[k]);
      stats[k] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : lo;
    }
    const score = Math.max(100, Math.round(G.score(t, stats)));
    usedRuns.set(run.nonce, run.start + MAX_RUN_MS);
    await ready;
    const id = playerId(body.key), board = boards[run.game], old = board.get(id);
    const name = tidyName(body.name) || (old && old.name) || 'Player ' + id.slice(0, 4).toUpperCase();
    const improved = !old || score > old.score;
    const entry = improved ? { name, score, t, stats, at: Date.now(), runs: ((old && old.runs) || 0) + 1 } : { ...old, name, runs: (old.runs || 1) + 1 };
    board.set(id, entry);
    try { await store.save(run.game, id, entry); } catch (e) { log('challenger: save failed: ' + e.message); }
    const b = boardFor(run.game, id);
    return { game: run.game, score, t, stats, best: entry.score, improved, rank: b.you.rank, challenger: b.you.challenger, board: b };
  }

  async function rename(body) {
    if (!validKey(body.key)) return { error: 'Missing player key.' };
    const name = tidyName(body.name);
    if (!name) return { error: 'Names need 2 to 16 characters.' };
    await ready;
    const id = playerId(body.key);
    for (const g of Object.keys(GAMES)) {
      const e = boards[g].get(id);
      if (!e) continue;
      e.name = name;
      try { await store.save(g, id, e); } catch (err) { log('challenger: save failed: ' + err.message); }
    }
    return { ok: true, name };
  }

  const send = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
  const readBody = (req, cb) => {
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > 4096) { req.destroy(); return; } parts.push(c); });
    req.on('end', () => { if (size > 4096) return; try { cb(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { cb(null); } });
  };

  // Returns true if it handled the request
  function handle(req, res, ipKey) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/cr/')) return false;
    const origin = req.headers.origin;
    if (origin && origin !== 'null') { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.writeHead(204).end(); return true; }
    if (!opts.originAllowed(origin)) { res.writeHead(403).end(); return true; }
    if (limited(ipKey)) { send(res, 429, { error: 'Too many requests, try again in a minute.' }); return true; }
    const me = /^[0-9a-f]{16}$/.test(url.searchParams.get('me') || '') ? url.searchParams.get('me') : '';
    const fail = e => { log('challenger: ' + e.message); send(res, 500, { error: 'Server error' }); };

    if (req.method === 'GET' && url.pathname === '/cr/board') {
      const game = url.searchParams.get('game');
      if (!GAMES[game]) { send(res, 404, { error: 'Unknown game' }); return true; }
      ready.then(() => send(res, 200, boardFor(game, me)), fail);
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/cr/boards') {
      ready.then(() => { const boardsOut = {}; for (const g of Object.keys(GAMES)) boardsOut[g] = boardFor(g, me); send(res, 200, { boards: boardsOut, persistent: store.persistent }); }, fail);
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, { error: 'Use POST' }); return true; }
    readBody(req, body => {
      if (!body) return send(res, 400, { error: 'Bad request' });
      if (url.pathname === '/cr/start') {
        if (!GAMES[body.game]) return send(res, 404, { error: 'Unknown game' });
        return send(res, 200, { run: newRun(body.game) });
      }
      if (url.pathname === '/cr/finish') return finish(body).then(r => send(res, r.error ? 400 : 200, r), fail);
      if (url.pathname === '/cr/name') return rename(body).then(r => send(res, r.error ? 400 : 200, r), fail);
      send(res, 404, { error: 'Not found' });
    });
    return true;
  }

  // The games where this player key is in the top 3 right now (for the Challenger tag in chat)
  function titles(key) {
    if (!validKey(key)) return [];
    const id = playerId(key);
    return Object.keys(GAMES).filter(g => boards[g] && boards[g].has(id) && sorted(g).slice(0, TOP_N).some(e => e.id === id));
  }

  return { handle, titles, stats: () => ({ persistent: store.persistent, players: Object.fromEntries(Object.entries(boards).map(([g, m]) => [g, m.size])) }) };
}

module.exports = { createChallenger, GAMES, TOP_N };

// Polls: players vote on what comes next (first one: which new learning game gets Ranked).
// One vote per player key (the same secret key the Challenger boards use); voting again changes your vote.
// Votes are kept in Upstash Redis when it's set up, otherwise in memory until the server restarts.
//
// HTTP API (all JSON):
//   GET  /poll/<id>?me=<public player id>   → { id, question, options: [{ id, name, votes }], total, you, open }
//   POST /poll/vote { poll, key, choice }    → the same, after your vote
'use strict';
const crypto = require('crypto');
const { redis } = require('./secret.js');

const POLLS = {
  'ranked-next': {
    question: 'One of the new games will get Ranked. Which one?',
    open: true,
    options: [
      { id: 'geography', name: 'World Pins' },
      { id: 'elements', name: 'Element Lab' },
      { id: 'spelling', name: 'Word Bee' },
      { id: 'timeline', name: 'Timeline' },
    ],
  },
};

const playerId = key => crypto.createHash('sha256').update('eduarcade-cr|' + key).digest('hex').slice(0, 16);
const validKey = key => typeof key === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(key);

function createPolls(opts) {
  const log = (opts && opts.log) || console.log;
  const votes = {};   // poll id → Map(player id → option id)
  const ready = Promise.all(Object.keys(POLLS).map(async id => {
    votes[id] = new Map();
    if (!redis) return;
    try {
      const flat = await redis(['HGETALL', 'poll:' + id]) || [];
      for (let i = 0; i + 1 < flat.length; i += 2) votes[id].set(flat[i], flat[i + 1]);
    } catch (e) { log('poll: could not load ' + id + ': ' + e.message); }
  }));

  function view(id, me) {
    const P = POLLS[id], counts = Object.fromEntries(P.options.map(o => [o.id, 0]));
    for (const c of votes[id].values()) if (c in counts) counts[c]++;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { id, question: P.question, open: P.open, total, you: (me && votes[id].get(me)) || null,
      options: P.options.map(o => ({ id: o.id, name: o.name, votes: counts[o.id] })) };
  }

  // A few votes a minute per address: plenty for a classroom on one network, too slow to stuff the box
  const hits = new Map();
  const limited = ip => {
    const t = Date.now(), h = (hits.get(ip) || []).filter(x => t - x < 60000);
    h.push(t); hits.set(ip, h);
    return h.length > 30;
  };
  setInterval(() => { const t = Date.now(); for (const [k, h] of hits) if (!h.some(x => t - x < 60000)) hits.delete(k); }, 60000).unref();

  const send = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));

  // Returns true if it handled the request
  function handle(req, res, ipKey) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/poll/')) return false;
    const origin = req.headers.origin;
    if (origin && origin !== 'null') { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.writeHead(204).end(); return true; }
    if (!opts.originAllowed(origin)) { res.writeHead(403).end(); return true; }
    const fail = e => { log('poll: ' + e.message); send(res, 500, { error: 'Server error' }); };

    if (req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice(6));
      if (!POLLS[id]) { send(res, 404, { error: 'Unknown poll' }); return true; }
      const me = /^[0-9a-f]{16}$/.test(url.searchParams.get('me') || '') ? url.searchParams.get('me') : '';
      ready.then(() => send(res, 200, view(id, me)), fail);
      return true;
    }
    if (req.method !== 'POST' || url.pathname !== '/poll/vote') { send(res, 404, { error: 'Not found' }); return true; }
    if (limited(ipKey)) { send(res, 429, { error: 'Too many votes from your network, try again in a minute.' }); return true; }
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > 2048) { req.destroy(); return; } parts.push(c); });
    req.on('end', () => {
      if (size > 2048) return;
      let body; try { body = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch (e) { return send(res, 400, { error: 'Bad request' }); }
      const P = POLLS[body.poll];
      if (!P) return send(res, 404, { error: 'Unknown poll' });
      if (!P.open) return send(res, 400, { error: 'This poll has closed.' });
      if (!validKey(body.key)) return send(res, 400, { error: 'Missing player key.' });
      if (!P.options.some(o => o.id === body.choice)) return send(res, 400, { error: 'Unknown choice.' });
      const id = playerId(body.key);
      ready.then(async () => {
        votes[body.poll].set(id, body.choice);
        if (redis) { try { await redis(['HSET', 'poll:' + body.poll, id, body.choice]); } catch (e) { log('poll: save failed: ' + e.message); } }
        send(res, 200, view(body.poll, id));
      }).catch(fail);
    });
    return true;
  }

  return { handle, stats: () => Object.fromEntries(Object.keys(POLLS).map(id => [id, votes[id] ? votes[id].size : 0])) };
}

module.exports = { createPolls, POLLS };

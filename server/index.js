// Frontier multiplayer server, plus chat.
// The server runs the real game (frontier-core.js) and streams changes to every player over
// WebSockets. Players only send intents ("attack this tile", "build a city here"), so nobody
// can cheat by editing their own copy of the game.
// It also hosts the EduArcade chatroom and Frontier's lobby/in-game chat (see chat.js), and
// Imposter games played on several devices (see imposter.js).
'use strict';
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const Core = require('../frontier-core.js');
// Render only redeploys when something in server/ changes, but the game rules live in
// ../frontier-core.js (with ../frontier-leaders.js and ../frontier-maps.js). After changing them,
// touch this file (or deploy by hand) or the live server keeps running the old rules. /status
// reports the rules it loaded so you can check.
const CORE_HASH = (() => {
  const h = crypto.createHash('sha1');
  for (const f of ['../frontier-core.js', '../frontier-leaders.js', '../frontier-maps.js']) h.update(fs.readFileSync(require.resolve(f)));
  return h.digest('hex').slice(0, 8);
})();
const { filterMessage, checkName, newRate, rateCheck, createChat } = require('./chat.js');
const { createImposter } = require('./imposter.js');

const PORT = process.env.PORT || 8080;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://unblockedarcade.org,https://www.unblockedarcade.org,https://gronkreeks.github.io').split(',').map(s => s.trim()).filter(Boolean);
const MAX_GAMES = +process.env.MAX_GAMES || 4;          // free Render instances have little CPU
const MAX_CLIENTS = +process.env.MAX_CLIENTS || 300;
const MAX_HUMANS = 16;
const PUBLIC_MIN_PLAYERS = 2;
const PUBLIC_COUNTDOWN_MS = 30000;
const SPAWN_TICKS = 150;                                // 15 s to pick a spawn
const GAME_OVER_LINGER_MS = 60000;
const EMPTY_GAME_TIMEOUT_MS = 60000;
const MAPS = Core.MAP_KINDS;
const SIZES = Object.keys(Core.MAP_SIZES);
const DIFFS = Object.keys(Core.DIFF);

const clients = new Set();
const sessions = new Map();   // token -> { token, name, leader, ws, room, pid }
const rooms = new Map();      // id -> room
let publicRotation = 0;

const newId = () => crypto.randomBytes(6).toString('hex');
const now = () => Date.now();
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
function cleanName(n) {
  n = String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  // Nation names are shown to everyone, so offensive ones become "Player"
  if (n && !checkName(n).ok && checkName(n).reason === 'Please pick a different name') return 'Player';
  return n || 'Player';
}
const cleanLeader = n => Number.isInteger(n) && n >= 0 && n < Core.LEADERS.length ? n : -1;
function cleanCfg(c) {
  c = c || {};
  return {
    map: MAPS.includes(c.map) ? c.map : 'continents',
    size: SIZES.includes(c.size) ? c.size : 'medium',
    diff: DIFFS.includes(c.diff) ? c.diff : 'medium',
    nations: Math.max(0, Math.min(24, c.nations | 0)),
    bots: Math.max(0, Math.min(120, c.bots | 0)),
  };
}
function lobbyCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (![...rooms.values()].some(r => r.code === c)) return c;
  }
}
const runningGames = () => [...rooms.values()].filter(r => r.state !== 'lobby').length;

// ──────────── Rooms ────────────
function createRoom(isPublic, cfg, host) {
  const room = {
    id: newId(), code: isPublic ? null : lobbyCode(), isPublic, cfg, host: host || null,
    members: [], state: 'lobby', game: null, timer: null, startsAt: 0, endedAt: 0, emptySince: 0,
  };
  rooms.set(room.id, room);
  return room;
}
function ensurePublicLobby() {
  if ([...rooms.values()].some(r => r.isPublic && r.state === 'lobby')) return;
  const map = MAPS[publicRotation++ % MAPS.length];
  createRoom(true, { map, size: 'medium', diff: 'medium', nations: 10, bots: 40 });
}
function roomInfo(room, s) {
  return {
    t: 'room', id: room.id, code: room.code, isPublic: room.isPublic, cfg: room.cfg,
    isHost: !room.isPublic && room.host === s.token,
    players: room.members.map(m => m.name), max: MAX_HUMANS,
    startsIn: room.startsAt ? Math.max(0, Math.ceil((room.startsAt - now()) / 1000)) : null,
  };
}
function pushRoom(room) { for (const m of room.members) send(m.ws, roomInfo(room, m)); }
function joinRoom(s, room) {
  if (room.state !== 'lobby') return send(s.ws, { t: 'err', msg: 'That game has already started' });
  if (room.members.length >= MAX_HUMANS) return send(s.ws, { t: 'err', msg: 'That lobby is full' });
  leaveRoom(s);
  room.members.push(s);
  s.room = room;
  if (room.isPublic) {
    if (room.members.length >= PUBLIC_MIN_PLAYERS && !room.startsAt) room.startsAt = now() + PUBLIC_COUNTDOWN_MS;
    if (room.members.length >= MAX_HUMANS) room.startsAt = now();
  }
  pushRoom(room);
}
function leaveRoom(s) {
  const room = s.room;
  if (!room) return;
  s.room = null; s.pid = 0;
  if (room.state !== 'lobby') return;   // in a running game the nation stays on the map
  room.members = room.members.filter(m => m !== s);
  if (!room.members.length && !room.isPublic) { rooms.delete(room.id); return; }
  if (room.host === s.token) room.host = room.members[0] ? room.members[0].token : null;
  if (room.isPublic && room.members.length < PUBLIC_MIN_PLAYERS) room.startsAt = 0;
  pushRoom(room);
}

function startGame(room) {
  if (room.state !== 'lobby') return;
  if (runningGames() >= MAX_GAMES) {
    for (const m of room.members) send(m.ws, { t: 'err', msg: 'The server is busy right now. Trying again in a few seconds…' });
    room.startsAt = room.isPublic ? now() + 10000 : 0;
    return;
  }
  const humans = room.members.slice();
  if (!humans.length) return;
  room.state = 'game';
  room.startsAt = 0;
  const cfg = { ...room.cfg, seed: crypto.randomInt(2 ** 31) };
  if (room.isPublic && humans.length > 6) cfg.size = 'large';
  const byPid = new Map();
  const game = Core.createGame({
    cfg, humans: humans.map(h => ({ name: h.name, leader: h.leader })), spawnTicks: SPAWN_TICKS, track: true,
    hooks: {
      event(pid, html, cls, extra) {
        const msg = JSON.stringify({ t: 'ev', html, cls, req: extra && extra.req, offer: extra && extra.offer, ttl: extra && extra.ttl });
        if (pid) { const s = byPid.get(pid); if (s) send(s.ws, msg); return; }
        const except = (extra && extra.except) || [];
        for (const s of humans) if (!except.includes(s.pid)) send(s.ws, msg);
      },
      end(winnerId) {
        room.state = 'over'; room.endedAt = now();
        const msg = JSON.stringify({ t: 'end', winner: winnerId });
        for (const s of humans) send(s.ws, msg);
      },
    },
  });
  room.game = game;
  humans.forEach((s, i) => { s.pid = i + 1; byPid.set(s.pid, s); });
  const info = game.startInfo();
  const first = JSON.stringify({ t: 'tick', ...game.full() });
  for (const s of humans) { send(s.ws, { t: 'start', ...info, me: s.pid }); send(s.ws, first); }
  room.timer = setInterval(() => stepRoom(room), Core.TICK_MS);
  if (room.isPublic) ensurePublicLobby();
  log(`game ${room.id} started: ${humans.length} humans, ${cfg.map}/${cfg.size}`);
}
function stepRoom(room) {
  const g = room.game;
  try { g.step(); } catch (e) { log('tick error', e); }
  const msg = JSON.stringify({ t: 'tick', ...g.delta() });
  let connected = 0;
  for (const s of room.members) if (s.ws && s.ws.readyState === 1) { connected++; s.ws.send(msg); }
  if (connected) room.emptySince = 0;
  else if (!room.emptySince) room.emptySince = now();
  if ((room.state === 'over' && now() - room.endedAt > GAME_OVER_LINGER_MS) ||
      (room.emptySince && now() - room.emptySince > EMPTY_GAME_TIMEOUT_MS)) closeRoom(room);
}
function closeRoom(room) {
  clearInterval(room.timer);
  rooms.delete(room.id);
  for (const s of room.members) {
    if (s.room === room) { s.room = null; s.pid = 0; send(s.ws, { t: 'closed' }); }
    if (!s.ws) sessions.delete(s.token);
  }
  log(`game ${room.id} closed`);
}

// ──────────── Lobby ticker ────────────
setInterval(() => {
  ensurePublicLobby();
  for (const room of rooms.values()) {
    if (room.state !== 'lobby') continue;
    if (room.startsAt && now() >= room.startsAt) startGame(room);
    else if (room.startsAt) pushRoom(room);
  }
  const list = JSON.stringify({
    t: 'lobbies',
    list: [...rooms.values()].filter(r => r.isPublic && r.state === 'lobby').map(r => ({
      id: r.id, map: r.cfg.map, size: r.cfg.size, players: r.members.length, max: MAX_HUMANS,
      startsIn: r.startsAt ? Math.max(0, Math.ceil((r.startsAt - now()) / 1000)) : null,
    })),
    games: runningGames(), online: clients.size,
  });
  for (const ws of clients) if (!ws.session || !ws.session.room) send(ws, list);
}, 1000);

const chat = createChat({ send, now, log });
const imposter = createImposter({ send, now, log, checkName, filterMessage });

// ──────────── Messages ────────────
function onMessage(ws, raw) {
  // Simple flood protection: at most 30 messages per second.
  const t = now();
  if (t - ws.rateStart > 1000) { ws.rateStart = t; ws.rateCount = 0; }
  if (++ws.rateCount > 30) return;
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  if (m.t.startsWith('c_')) { chat.handle(ws, m); return; }
  if (m.t.startsWith('i_')) { imposter.handle(ws, m); return; }

  if (m.t === 'hello') {
    const old = typeof m.token === 'string' && sessions.get(m.token);
    if (old && old.room && old.room.state !== 'lobby') {
      // Reconnect to a running game
      if (old.ws && old.ws !== ws) old.ws.session = null;
      old.ws = ws; ws.session = old;
      const g = old.room.game;
      send(ws, { t: 'welcome', token: old.token });
      send(ws, { t: 'start', ...g.startInfo(), me: old.pid, rejoin: true });
      send(ws, { t: 'tick', ...g.full() });
      return;
    }
    const s = { token: crypto.randomBytes(16).toString('hex'), name: cleanName(m.name), leader: cleanLeader(m.leader), ws, room: null, pid: 0, chatOn: false, chatRate: newRate() };
    sessions.set(s.token, s);
    ws.session = s;
    send(ws, { t: 'welcome', token: s.token });
    return;
  }
  const s = ws.session;
  if (!s) return;
  switch (m.t) {
    case 'name':
      s.name = cleanName(m.name);
      if ('leader' in m) s.leader = cleanLeader(m.leader);
      if (s.room && s.room.state === 'lobby') pushRoom(s.room);
      break;
    case 'joinPublic': {
      const room = rooms.get(String(m.id));
      if (room && room.isPublic) joinRoom(s, room); else send(ws, { t: 'err', msg: 'That lobby no longer exists' });
      break;
    }
    case 'create': {
      if (rooms.size > MAX_GAMES * 6) return send(ws, { t: 'err', msg: 'Too many lobbies open right now. Try again soon.' });
      const room = createRoom(false, cleanCfg(m.cfg), s.token);
      joinRoom(s, room);
      break;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase().trim();
      const room = [...rooms.values()].find(r => r.code === code);
      if (room) joinRoom(s, room); else send(ws, { t: 'err', msg: `No lobby with code ${code.slice(0, 8)}` });
      break;
    }
    case 'cfg':
      if (s.room && s.room.host === s.token && s.room.state === 'lobby') { s.room.cfg = cleanCfg(m.cfg); pushRoom(s.room); }
      break;
    case 'start':
      if (s.room && s.room.host === s.token) startGame(s.room);
      break;
    case 'leave':
      if (s.room && s.room.state !== 'lobby') { s.room.members = s.room.members.filter(x => x !== s); }
      leaveRoom(s);
      break;
    // Lobby and in-game chat. Only players who said they're 13+ and turned chat on send or receive it.
    case 'chatOn': s.chatOn = m.on === true; break;
    case 'chat': {
      if (!s.chatOn || !s.room) return;
      const f = filterMessage(m.text);
      if (!f.ok) return send(ws, { t: 'chatErr', msg: f.reason });
      const lim = rateCheck(s.chatRate, f.text, now());
      if (lim) return send(ws, { t: 'chatErr', msg: lim });
      const msg = JSON.stringify({ t: 'chat', from: s.name, pid: s.pid, text: f.text });
      for (const x of s.room.members) if (x.chatOn) send(x.ws, msg);
      break;
    }
    case 'act': {
      const room = s.room;
      if (!room || !room.game || !s.pid) return;
      let err = null;
      try { err = room.game.act(s.pid, m.i); } catch (e) { log('act error', e); }
      if (err) send(ws, { t: 'ev', html: Core.esc(err), cls: 'warn', ttl: 2500 });
      break;
    }
  }
}

// ──────────── HTTP + WebSocket server ────────────
const server = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, online: clients.size, games: runningGames(), core: CORE_HASH, lobbies: rooms.size - runningGames(), chat: chat.stats(), imposter: imposter.stats() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Frontier multiplayer and EduArcade chat server is running.\n');
});
function originAllowed(origin) {
  if (!origin || origin === 'null') return true;   // opened from a file, or a non-browser client
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return ALLOWED_ORIGINS.includes(origin);
}
const wss = new WebSocketServer({
  server, maxPayload: 16384,
  perMessageDeflate: { threshold: 512 },
  verifyClient: ({ origin }) => originAllowed(origin) && clients.size < MAX_CLIENTS,
});
wss.on('connection', (ws, req) => {
  clients.add(ws);
  // Only a hash of the address is kept, used for chat timeouts. The last X-Forwarded-For entry is
  // the one added by the hosting proxy; earlier entries can be faked by the client.
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  const ip = String(req.headers['cf-connecting-ip'] || '') || fwd[fwd.length - 1] || req.socket.remoteAddress || '';
  ws.ipKey = crypto.createHash('sha256').update(ip + 'eduarcade-chat').digest('hex').slice(0, 16);
  ws.rateStart = now(); ws.rateCount = 0; ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => onMessage(ws, raw));
  ws.on('close', () => {
    clients.delete(ws);
    chat.close(ws);
    imposter.close(ws);
    const s = ws.session;
    if (!s || s.ws !== ws) return;
    s.ws = null;
    if (!s.room || s.room.state === 'lobby') { leaveRoom(s); sessions.delete(s.token); }
  });
});
// Drop dead connections (phones that lost signal) so they can reconnect cleanly.
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 20000);

function log(...a) { console.log(new Date().toISOString(), ...a); }
server.listen(PORT, () => log(`Frontier server listening on port ${PORT} (core ${CORE_HASH})`));

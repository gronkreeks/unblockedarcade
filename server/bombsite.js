// Bombsite online games. The host's browser runs the match (it already runs the bots), and this server
// only passes messages along, so a match costs almost no server CPU:
//   host → everyone   b_s   a packed snapshot (only players that moved), events, and changed scoreboard info
//   player → host     b_i   that player's movement and actions (shots, throws, buys), tagged with their pid
// Messages are forwarded as the same string they arrived as, without being parsed and rebuilt.
// If the host leaves, the match ends; a player who drops is played by a bot until they come back.
'use strict';
const crypto = require('crypto');

const MAX_HUMANS = 10;
const MAX_ROOMS = 60;
const LOBBY_IDLE_MS = 20 * 60 * 1000;
const RATE = 90;                 // messages a second per connection (20 Hz movement + shots)
const MAX_MSG = 12000;

function createBombsite({ send, now, log, checkName }) {
  const rooms = new Map();       // code -> room
  const byToken = new Map();     // resume token -> member

  function roomCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
      if (!rooms.has(c)) return c;
    }
  }
  const online = m => !!m.ws;
  const cleanCfg = c => ({
    diff: ['easy', 'normal', 'hard', 'expert'].includes(c && c.diff) ? c.diff : 'normal',
    bots: c && c.bots === 'even' ? 'even' : 'fill',
  });
  const cleanTeam = t => t === 'T' || t === 'CT' ? t : 'auto';

  function roomInfo(room, m) {
    return {
      t: 'b_room', code: room.code, cfg: room.cfg, isHost: room.host === m, me: m.pid, inGame: room.state === 'game', max: MAX_HUMANS,
      players: room.members.map(x => ({ pid: x.pid, name: x.name, team: x.team, on: online(x), host: x === room.host })),
    };
  }
  function pushRoom(room) { for (const m of room.members) if (online(m)) send(m.ws, roomInfo(room, m)); }

  function leave(m) {
    const room = m.room;
    if (m.ws && m.ws.bs === m) m.ws.bs = null;
    m.ws = null; m.room = null;
    byToken.delete(m.token);
    if (!room) return;
    room.members = room.members.filter(x => x !== m);
    if (room.state === 'game' && room.host === m) { closeRoom(room, 'The host left, so the match ended.'); return; }
    if (!room.members.length) { closeRoom(room); return; }
    if (room.state === 'game' && room.host && room.host.ws) send(room.host.ws, { t: 'b_left', p: m.pid, gone: true });
    if (room.host === m) room.host = room.members.find(online) || room.members[0];
    pushRoom(room);
  }
  function closeRoom(room, msg) {
    rooms.delete(room.code);
    for (const m of room.members) {
      byToken.delete(m.token);
      if (m.ws) { send(m.ws, { t: 'b_closed', msg }); m.ws.bs = null; }
    }
    if (room.state === 'game') log(`bombsite ${room.code} closed`);
  }

  function handle(ws, m, raw) {
    const t = now();
    if (t - (ws.bsRateStart || 0) > 1000) { ws.bsRateStart = t; ws.bsRate = 0; }
    if (++ws.bsRate > RATE) return;
    const me = ws.bs, room = me && me.room;

    // ── In-game relay (the hot path) ──
    if (m.t === 'b_s') {
      if (!room || room.host !== me || room.state !== 'game' || raw.length > MAX_MSG) return;
      // A message for one player (m.to) or for everyone but the host
      for (const x of room.members) if (x !== me && online(x) && (!m.to || m.to === x.pid)) send(x.ws, raw);
      return;
    }
    if (m.t === 'b_i') {
      if (!room || room.state !== 'game' || room.host === me || !room.host.ws || raw.length > 4000) return;
      send(room.host.ws, '{"p":' + me.pid + ',' + raw.slice(1));
      return;
    }

    const err = msg => send(ws, { t: 'b_err', msg });
    switch (m.t) {
      case 'b_hello': send(ws, { t: 'b_welcome' }); return;
      case 'b_create': case 'b_join': {
        const c = checkName(m.name);
        if (!c.ok) return err(c.reason);
        let r = null;
        if (m.t === 'b_join') {
          r = rooms.get(String(m.code || '').toUpperCase().trim().slice(0, 4));
          if (!r) return err('No lobby with that code. Check it with your friend.');
          if (r.members.length >= MAX_HUMANS) return err('That lobby is full (10 players).');
          if (r.members.some(x => x.name.toLowerCase() === c.name.toLowerCase())) return err(`Someone in that lobby is already called ${c.name}.`);
        } else if (rooms.size >= MAX_ROOMS) return err('Too many lobbies are open right now. Try again soon.');
        if (me) leave(me);
        if (!r) {
          r = { code: roomCode(), cfg: cleanCfg(m.cfg), members: [], host: null, state: 'lobby', nextPid: 1, active: now() };
          rooms.set(r.code, r);
        }
        const mem = { token: crypto.randomBytes(16).toString('hex'), name: c.name, ws, room: r, pid: r.nextPid++, team: cleanTeam(m.team) };
        r.members.push(mem);
        if (!r.host) r.host = mem;
        byToken.set(mem.token, mem);
        ws.bs = mem;
        send(ws, { t: 'b_welcome', token: mem.token });
        pushRoom(r);
        // Joining a match that's already on: the host gives them a bot's place
        if (r.state === 'game' && r.host.ws) send(r.host.ws, { t: 'b_joined', p: mem.pid, name: mem.name, team: mem.team });
        return;
      }
      case 'b_resume': {
        const mem = byToken.get(String(m.token || ''));
        if (!mem || !mem.room) return send(ws, { t: 'b_closed' });
        if (mem.ws && mem.ws !== ws) { mem.ws.bs = null; send(mem.ws, { t: 'b_closed', msg: 'You opened this game in another tab.' }); }
        mem.ws = ws; ws.bs = mem;
        send(ws, { t: 'b_welcome', token: mem.token });
        const r = mem.room;
        pushRoom(r);
        if (r.state === 'game') {
          if (r.host === mem) send(ws, { t: 'b_closed', msg: 'The match ended when you left.' });
          else if (r.host.ws) send(r.host.ws, { t: 'b_joined', p: mem.pid, name: mem.name, team: mem.team, rejoin: true });
        }
        return;
      }
    }
    if (!me || !room) return;
    const isHost = room.host === me;
    switch (m.t) {
      case 'b_leave': leave(me); send(ws, { t: 'b_closed' }); return;
      case 'b_team':
        me.team = cleanTeam(m.team); pushRoom(room);
        return;
      case 'b_cfg':
        if (isHost && room.state === 'lobby') { room.cfg = cleanCfg(m.cfg); pushRoom(room); }
        return;
      case 'b_start': {
        if (!isHost || room.state !== 'lobby') return;
        room.state = 'game';
        for (const x of room.members.filter(y => !online(y))) leave(x);
        pushRoom(room);
        send(ws, { t: 'b_go', cfg: room.cfg, players: room.members.map(x => ({ pid: x.pid, name: x.name, team: x.team })) });
        log(`bombsite ${room.code} started: ${room.members.length} humans`);
        return;
      }
      case 'b_end':
        // The host's match finished (or they quit it): everyone goes back to the lobby
        if (isHost && room.state === 'game') {
          room.state = 'lobby'; room.active = now();
          for (const x of room.members.filter(y => !online(y))) leave(x);
          if (rooms.has(room.code)) pushRoom(room);
        }
        return;
    }
  }

  function close(ws) {
    const m = ws.bs;
    if (!m || m.ws !== ws) return;
    m.ws = null;
    const room = m.room;
    if (!room) return;
    if (room.state === 'lobby') { leave(m); return; }
    // In a match: the host leaving ends it; anyone else can come back with their token
    if (room.host === m) { closeRoom(room, 'The host lost connection, so the match ended.'); return; }
    if (room.host.ws) send(room.host.ws, { t: 'b_left', p: m.pid });
    pushRoom(room);
  }

  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.members.some(online)) room.active = now();
      else if (now() - room.active > LOBBY_IDLE_MS) closeRoom(room);
    }
  }, 60000);

  const stats = () => ({ rooms: rooms.size, games: [...rooms.values()].filter(r => r.state === 'game').length, players: byToken.size });
  return { handle, close, stats };
}

module.exports = { createBombsite };

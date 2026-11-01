// Timberfall online games. The server runs the real game (../timberfall-core.js) at 20 ticks a
// second and streams a snapshot to every player. Browsers only send their controls, and predict
// their own movement so it feels instant; the server rewinds other players to what the shooter
// saw when checking hits. Seats nobody takes are filled with bots.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const Core = require('../timberfall-core.js');
// Same idea as Frontier's CORE_HASH: the page won't start an online game against a server
// running different rules. Render only redeploys when server/ changes, so touch this file
// after editing ../timberfall-core.js.
const CORE_HASH = crypto.createHash('sha1').update(fs.readFileSync(require.resolve('../timberfall-core.js'))).digest('hex').slice(0, 8);

const MAX_HUMANS = 8;
const MAX_GAMES = +process.env.TIMBER_GAMES || 3;   // a game costs ~0.1 ms a tick, but free instances are small
const MAX_ROOMS = 40;
const OVER_LINGER_MS = 40000;
const EMPTY_GAME_MS = 45000;
const LOBBY_IDLE_MS = 20 * 60 * 1000;
const LEFT_BOT = 'medium';   // who takes over from a player who leaves mid-game

function createTimberfall({ send, now, log, checkName }) {
  const rooms = new Map();     // code -> room
  const byToken = new Map();   // resume token -> member

  function roomCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
      if (!rooms.has(c)) return c;
    }
  }
  const running = () => [...rooms.values()].filter(r => r.game && r.state === 'game').length;
  const online = m => !!m.ws;

  function roomInfo(room, m) {
    return {
      t: 'r_room', code: room.code, cfg: room.cfg, isHost: room.host === m, max: MAX_HUMANS,
      players: room.members.map(x => ({ name: x.name, on: online(x), host: x === room.host })),
    };
  }
  function pushRoom(room) { for (const m of room.members) if (online(m)) send(m.ws, roomInfo(room, m)); }

  function leave(m) {
    const room = m.room;
    if (m.ws && m.ws.tf === m) m.ws.tf = null;
    m.ws = null; m.room = null;
    byToken.delete(m.token);
    if (!room) return;
    room.members = room.members.filter(x => x !== m);
    if (room.game && m.pid) room.game.botify(m.pid, LEFT_BOT);
    if (!room.members.length) { closeRoom(room); return; }
    if (room.host === m) room.host = room.members.find(online) || room.members[0];
    if (!room.game) pushRoom(room);
  }
  function closeRoom(room) {
    clearInterval(room.timer);
    rooms.delete(room.code);
    for (const m of room.members) { byToken.delete(m.token); if (m.ws) { send(m.ws, { t: 'r_closed' }); m.ws.tf = null; } }
    if (room.game) log(`timberfall ${room.code} closed`);
  }

  function startGame(room) {
    if (running() >= MAX_GAMES) return 'The server is busy with other games right now. Try again in a minute.';
    const seed = crypto.randomInt(2 ** 31);
    const game = Core.createGame({ seed, cfg: room.cfg, humans: room.members.map(m => ({ name: m.name })), hooks: {
      end() { room.state = 'over'; room.endedAt = now(); },
    } });
    room.game = game; room.state = 'game'; room.seed = seed; room.emptySince = 0;
    room.members.forEach((m, i) => { m.pid = i + 1; });
    for (const m of room.members) if (online(m)) sendStart(room, m, false);
    room.timer = setInterval(() => stepRoom(room), Core.TICK_MS);
    log(`timberfall ${room.code} started: ${room.members.length} humans, ${room.cfg.mode}/${room.cfg.diff}`);
    return null;
  }
  function sendStart(room, m, rejoin) {
    send(m.ws, { t: 'r_start', seed: room.seed, cfg: room.game.cfg, me: m.pid, roster: room.game.roster(), rejoin });
    if (rejoin) send(m.ws, { t: 'r_full', ...room.game.full() });
  }
  function stepRoom(room) {
    const g = room.game;
    try { g.step(); } catch (e) { log('timberfall tick error', e); }
    const snap = g.snapshot();
    g.flush();
    const common = JSON.stringify(snap).slice(0, -1);   // '{...' without the closing brace
    let connected = 0;
    for (const m of room.members) {
      if (!online(m) || m.ws.readyState !== 1) continue;
      connected++;
      m.ws.send(common + ',"t":"r_s","me":' + JSON.stringify(g.priv(m.pid)) + '}');
    }
    if (connected) room.emptySince = 0;
    else if (!room.emptySince) room.emptySince = now();
    if (room.emptySince && now() - room.emptySince > EMPTY_GAME_MS) closeRoom(room);
    else if (room.state === 'over' && now() - room.endedAt > OVER_LINGER_MS) backToLobby(room);
  }
  // After a game the same group goes back to its lobby, with the same code, to play again
  function backToLobby(room) {
    clearInterval(room.timer);
    room.timer = null; room.game = null; room.state = 'lobby'; room.active = now();
    for (const m of room.members.filter(x => !online(x))) leave(m);
    if (!rooms.has(room.code)) return;
    for (const m of room.members) m.pid = 0;
    pushRoom(room);
  }
  const humansOut = room => room.members.every(m => { const p = room.game.byId.get(m.pid); return !p || !p.alive; });

  function handle(ws, m) {
    // Controls arrive 20 times a second, so they get their own flood limit
    const t = now();
    if (t - (ws.tfRateStart || 0) > 1000) { ws.tfRateStart = t; ws.tfRate = 0; }
    if (++ws.tfRate > 60) return;
    const err = msg => send(ws, { t: 'r_err', msg });
    const me = ws.tf;

    if (m.t === 'r_in') {
      if (me && me.room && me.room.game && me.pid && m.i && typeof m.i === 'object') me.room.game.input(me.pid, m.i);
      return;
    }
    switch (m.t) {
      case 'r_hello': send(ws, { t: 'r_welcome', core: CORE_HASH }); return;
      case 'r_create': case 'r_join': {
        const c = checkName(m.name);
        if (!c.ok) return err(c.reason);
        let room = null;
        if (m.t === 'r_join') {
          room = rooms.get(String(m.code || '').toUpperCase().trim().slice(0, 4));
          if (!room) return err('No lobby with that code. Check it with your friend.');
          if (room.game) return err('That game has already started. Wait for it to finish.');
          if (room.members.length >= MAX_HUMANS) return err('That lobby is full.');
          if (room.members.some(x => x.name.toLowerCase() === c.name.toLowerCase())) return err(`Someone in that lobby is already called ${c.name}.`);
        } else if (rooms.size >= MAX_ROOMS) return err('Too many lobbies are open right now. Try again soon.');
        if (me) leave(me);
        if (!room) {
          room = { code: roomCode(), cfg: Core.cleanCfg(m.cfg), members: [], host: null, game: null, state: 'lobby', timer: null, active: now() };
          rooms.set(room.code, room);
        }
        const mem = { token: crypto.randomBytes(16).toString('hex'), name: c.name, ws, room, pid: 0 };
        room.members.push(mem);
        if (!room.host) room.host = mem;
        byToken.set(mem.token, mem);
        ws.tf = mem;
        send(ws, { t: 'r_welcome', core: CORE_HASH, token: mem.token });
        pushRoom(room);
        return;
      }
      case 'r_resume': {
        const mem = byToken.get(String(m.token || ''));
        if (!mem || !mem.room) return send(ws, { t: 'r_gone' });
        if (mem.ws && mem.ws !== ws) { mem.ws.tf = null; send(mem.ws, { t: 'r_gone', msg: 'You opened this game in another tab.' }); }
        mem.ws = ws; ws.tf = mem;
        send(ws, { t: 'r_welcome', core: CORE_HASH, token: mem.token });
        if (mem.room.game) sendStart(mem.room, mem, true); else pushRoom(mem.room);
        return;
      }
    }
    if (!me || !me.room) return;
    const room = me.room, isHost = room.host === me;
    switch (m.t) {
      case 'r_leave': leave(me); send(ws, { t: 'r_gone' }); return;
      case 'r_cfg':
        if (isHost && !room.game) { room.cfg = Core.cleanCfg(m.cfg); pushRoom(room); }
        return;
      case 'r_start': {
        if (!isHost || room.game) return;
        const problem = startGame(room);
        if (problem) err(problem);
        return;
      }
      case 'r_lobby':
        // The host can end the game early once every human in it is out
        if (isHost && room.game && (room.state === 'over' || humansOut(room))) backToLobby(room);
        return;
    }
  }

  function close(ws) {
    const m = ws.tf;
    if (!m || m.ws !== ws) return;
    m.ws = null;
    const room = m.room;
    if (!room) return;
    if (!room.game) {
      // In a lobby, someone who drops is gone (they can rejoin with the code)
      leave(m);
    }
  }

  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.game) continue;
      if (room.members.some(online)) room.active = now();
      else if (now() - room.active > LOBBY_IDLE_MS) closeRoom(room);
    }
  }, 60000);

  const stats = () => ({ rooms: rooms.size, games: running(), players: byToken.size, core: CORE_HASH });
  return { handle, close, stats };
}

module.exports = { createTimberfall, CORE_HASH };

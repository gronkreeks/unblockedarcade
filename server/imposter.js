// Imposter played on several devices (WIP).
// The server deals the cards, so a browser only ever receives its own card: civilians get the word,
// Imposters get the hint. The host's browser sends the word list for each round, and the server
// picks the word and the Imposters, collects votes in private and decides the round. Clues and
// discussion happen out loud, the same as on one device.
'use strict';
const crypto = require('crypto');

const MAX_PLAYERS = 20;
const MAX_ROOMS = 300;
const MAX_WORDS = 150;
const ROOM_IDLE_MS = 15 * 60 * 1000;   // a room nobody is connected to is closed after this

const newId = n => crypto.randomBytes(n).toString('hex');
const tidy = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const plural = (n, w) => n === 1 ? `${n} ${w}` : `${n} ${w}s`;
const maxImposters = n => Math.max(1, Math.floor((n - 1) / 2));

// Lenient check of the caught Imposter's guess: ignores case, accents, spaces and punctuation,
// a plural "s", and one typo in longer words.
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
function closeEnough(guess, word) {
  const g = norm(guess), w = norm(word);
  if (!g) return false;
  if (g === w || g.replace(/e?s$/, '') === w.replace(/e?s$/, '')) return true;
  if (w.length < 5 || Math.abs(g.length - w.length) > 1) return false;
  let prev = Array.from({ length: w.length + 1 }, (_, j) => j);
  for (let i = 1; i <= g.length; i++) {
    const cur = [i];
    for (let j = 1; j <= w.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (g[i - 1] === w[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[w.length] <= 1;
}

function createImposter({ send, now, log, checkName, filterMessage }) {
  const rooms = new Map();     // code -> room
  const byToken = new Map();   // resume token -> player

  function roomCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
      if (!rooms.has(c)) return c;
    }
  }
  function cleanSettings(s) {
    s = s || {};
    const imposterCount = Math.max(1, Math.min(4, s.imposterCount | 0));
    return {
      imposterCount,
      voteRounds: Math.max(imposterCount, Math.min(imposterCount + 2, s.voteRounds | 0)),
      hintOn: s.hintOn !== false,
    };
  }
  // Words are shown to every player, so anything the chat filter wouldn't allow is dropped.
  function cleanWords(list) {
    const seen = new Set(), out = [];
    for (const e of Array.isArray(list) ? list.slice(0, MAX_WORDS) : []) {
      const w = tidy(Array.isArray(e) ? e[0] : '', 30);
      let h = tidy(Array.isArray(e) ? e[1] : '', 30);
      if (!w || seen.has(w.toLowerCase()) || !filterMessage(w).ok) continue;
      if (h && !filterMessage(h).ok) h = '';
      seen.add(w.toLowerCase());
      out.push([w, h]);
    }
    return out;
  }

  const online = p => !!p.ws && !p.gone;
  const find = (room, id) => room.players.find(p => p.id === id);
  const nm = (room, id) => (find(room, id) || {}).name || '';
  function nameList(room, ids) {
    const n = ids.map(i => nm(room, i));
    return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }
  const isImp = (r, id) => r.imposters.includes(id);
  const alive = r => r.ids.filter(id => !r.out.includes(id));
  const impLeft = r => r.imposters.filter(id => !r.out.includes(id));
  const order = r => r.ids.map((_, k) => r.ids[(r.starter + k) % r.ids.length]).filter(id => !r.out.includes(id));
  function nextAlive(r, i) {
    const n = r.ids.length;
    for (let k = 1; k <= n; k++) if (!r.out.includes(r.ids[(i + k) % n])) return (i + k) % n;
    return i;
  }

  // ──────────── What each player sees ────────────
  function view(room, p) {
    const r = room.round, host = find(room, room.host);
    const v = {
      t: 'i_state', code: room.code, me: p.id, host: room.host, hostName: host ? host.name : '',
      players: room.players.filter(x => !x.gone).map(x => ({ id: x.id, name: x.name, on: !!x.ws, score: x.score })),
      settings: room.settings, roundNo: room.roundNo, round: null,
    };
    if (!r) return v;
    const inRound = r.ids.includes(p.id), done = r.phase === 'result';
    const revealed = ['guess', 'elim', 'result'].includes(r.phase) && r.accused !== null;
    v.round = {
      phase: r.phase, category: r.category, names: Object.fromEntries(r.ids.map(id => [id, nm(room, id)])),
      ids: r.ids, out: r.out, order: order(r), clueRound: r.clueRound, voteNo: r.voteNo,
      impCount: r.imposters.length, impLeft: impLeft(r).length,
      card: !inRound ? null : isImp(r, p.id)
        ? { imposter: true, hintOn: room.settings.hintOn, hint: room.settings.hintOn ? r.hint : '' }
        : { word: r.word },
      seen: [...r.seen], voted: [...r.votes.keys()], myVote: r.votes.has(p.id) ? r.votes.get(p.id) : null,
      tally: r.tally, accused: revealed || r.phase === 'tally' ? r.accused : null,
      accusedImp: revealed && r.accused !== -1 ? isImp(r, r.accused) : null,
      outcome: r.outcome, reason: r.reason, gained: r.gained,
      reveal: done ? { word: r.word, hint: room.settings.hintOn ? r.hint : null, imposters: r.imposters } : null,
    };
    return v;
  }
  function push(room) {
    room.active = now();
    for (const p of room.players) if (online(p)) send(p.ws, view(room, p));
  }

  // ──────────── Players and rooms ────────────
  function fixHost(room) {
    const h = find(room, room.host);
    if (h && online(h)) return;
    const next = room.players.find(online);
    if (next) room.host = next.id;
  }
  function addPlayer(room, ws, name) {
    const p = { id: newId(4), token: newId(16), name, ws, score: 0, room, gone: false };
    room.players.push(p);
    byToken.set(p.token, p);
    ws.imp = p;
    send(ws, { t: 'i_welcome', token: p.token });
    return p;
  }
  function prune(room) {
    for (const p of room.players) if (p.gone) byToken.delete(p.token);
    room.players = room.players.filter(p => !p.gone);
  }
  function leave(p) {
    const room = p.room, r = room.round;
    if (p.ws && p.ws.imp === p) p.ws.imp = null;
    p.ws = null; p.gone = true;
    // Mid-round a player who leaves stays in the round, so names and votes still add up.
    if (!r || r.phase === 'result') prune(room);
    if (!room.players.some(online)) { closeRoom(room); return; }
    fixHost(room);
    if (r) checkProgress(room);
    push(room);
  }
  function closeRoom(room) {
    rooms.delete(room.code);
    for (const p of room.players) byToken.delete(p.token);
  }
  function nameProblem(room, raw) {
    const c = checkName(raw);
    if (!c.ok) return [null, c.reason];
    if (room && room.players.some(p => !p.gone && p.name.toLowerCase() === c.name.toLowerCase()))
      return [null, `Someone in this game is already called ${c.name}. Pick another name.`];
    return [c.name, null];
  }

  // ──────────── Round flow ────────────
  function startRound(room, cat) {
    const players = room.players.filter(online);
    const s = room.settings, n = players.length;
    if (n < 3) return 'You need at least 3 players.';
    if (s.imposterCount > maxImposters(n))
      return `With ${n} players you can have at most ${plural(maxImposters(n), 'Imposter')}. Wait for more players or choose fewer Imposters.`;
    const words = cleanWords(cat && cat.words);
    if (words.length < 2) return 'That category needs at least 2 words.';
    const key = tidy(cat.key, 30) || 'custom';
    let used = room.used[key] || [];
    let pool = words.filter(([w]) => !used.includes(w));
    if (!pool.length) { pool = words; used = []; }
    const [word, hint] = pool[crypto.randomInt(pool.length)];
    room.used[key] = [...used, word];
    prune(room);
    const ids = room.players.filter(online).map(p => p.id);
    const shuffled = ids.slice().sort(() => Math.random() - 0.5);
    room.roundNo++;
    room.round = {
      category: tidy(cat.label, 30) || 'Custom', word, hint,
      ids, imposters: shuffled.slice(0, s.imposterCount), starter: crypto.randomInt(ids.length),
      phase: 'cards', seen: new Set(), clueRound: 1, voteNo: 1, out: [],
      votes: new Map(), tally: null, accused: null, outcome: null, reason: '', gained: {},
    };
    return null;
  }

  // Moves on by itself once everyone still connected has looked at their card, or has voted.
  function checkProgress(room) {
    const r = room.round;
    if (!r) return;
    const waiting = ids => ids.filter(id => { const p = find(room, id); return p && online(p); });
    if (r.phase === 'cards' && waiting(r.ids).every(id => r.seen.has(id))) r.phase = 'clues';
    if (r.phase === 'vote' && waiting(alive(r)).every(id => r.votes.has(id))) closeVote(room);
  }
  function closeVote(room) {
    const r = room.round, counts = {};
    for (const t of r.votes.values()) counts[t] = (counts[t] || 0) + 1;
    const rows = Object.entries(counts).map(([id, c]) => [id, c]).sort((a, b) => b[1] - a[1]);
    const top = rows.filter(x => x[1] === (rows[0] || [])[1]);
    r.tally = rows;
    r.accused = top.length === 1 ? top[0][0] : -1;
    r.phase = 'tally';
  }
  function accuse(room, id) {
    const r = room.round;
    r.accused = id;
    if (id !== -1 && isImp(r, id)) { r.phase = 'guess'; return; }
    if (id !== -1) r.out.push(id);
    afterVote(room);
  }
  function afterVote(room) {
    const r = room.round, a = r.accused, multi = r.imposters.length > 1;
    const left = impLeft(r), civLeft = alive(r).filter(id => !isImp(r, id));
    if (!left.length) {
      finish(room, 'civilians', multi ? 'You caught every Imposter, and none of them guessed the word.'
                                      : `You caught ${nm(room, a)}, and they couldn’t guess the word.`);
      return;
    }
    const what = a === -1 ? 'The vote was tied.' : isImp(r, a) ? `${nm(room, a)} was caught.` : `${nm(room, a)} was innocent.`;
    if (left.length >= civLeft.length) {
      finish(room, 'imposter', left.length === 1 && civLeft.length === 1
        ? `${what} With only two players left, ${nm(room, left[0])} wins.`
        : `${what} The Imposters now match the civilians in number, so they can’t be outvoted.`);
      return;
    }
    if (r.voteNo < room.settings.voteRounds) {
      r.voteNo++; r.clueRound++;
      r.starter = nextAlive(r, r.starter);
      r.phase = 'elim';
      return;
    }
    const hiders = nameList(room, left);
    if (a === -1) finish(room, 'imposter', `The last vote was tied, so ${hiders} slipped away unnoticed.`);
    else if (isImp(r, a)) finish(room, 'imposter', `${nm(room, a)} was caught, but ${hiders} stayed hidden through the last vote.`);
    else finish(room, 'imposter', `${nm(room, a)} was innocent. ${multi ? 'The Imposters' : 'The real Imposter'}, ${hiders}, got away with it.`);
  }
  function finish(room, outcome, reason) {
    const r = room.round;
    r.outcome = outcome; r.reason = reason; r.gained = {}; r.phase = 'result';
    for (const id of r.ids) {
      const g = outcome === 'civilians' ? (isImp(r, id) ? 0 : 1) : (isImp(r, id) ? 2 : 0);
      const p = find(room, id);
      if (g && p) { r.gained[id] = g; p.score += g; }
    }
  }

  // ──────────── Messages ────────────
  function handle(ws, m) {
    const err = msg => send(ws, { t: 'i_err', msg });
    if (m.t === 'i_create' || m.t === 'i_join') {
      if (ws.imp) leave(ws.imp);
      let room = null;
      if (m.t === 'i_join') {
        room = rooms.get(tidy(m.code, 8).toUpperCase());
        if (!room) return err('No game with that code. Check it with the host.');
        if (room.round && room.round.phase !== 'result') return err('That round has already started. Try again when it ends.');
        if (room.players.filter(p => !p.gone).length >= MAX_PLAYERS) return err('That game is full.');
      } else if (rooms.size >= MAX_ROOMS) return err('Too many games are running right now. Try again soon.');
      const [name, problem] = nameProblem(room, m.name);
      if (problem) return err(problem);
      if (!room) {
        room = { code: roomCode(), host: null, players: [], settings: cleanSettings(m.settings), round: null, roundNo: 0, used: {}, active: now() };
        rooms.set(room.code, room);
      }
      const p = addPlayer(room, ws, name);
      if (!room.host) room.host = p.id;
      push(room);
      return;
    }
    if (m.t === 'i_resume') {
      const p = byToken.get(String(m.token || ''));
      if (!p || p.gone) return send(ws, { t: 'i_gone' });
      if (p.ws && p.ws !== ws) { p.ws.imp = null; send(p.ws, { t: 'i_gone', msg: 'You opened this game in another tab.' }); }
      p.ws = ws; ws.imp = p;
      send(ws, { t: 'i_welcome', token: p.token });
      fixHost(p.room);
      push(p.room);
      return;
    }

    const p = ws.imp;
    if (!p || p.ws !== ws) return;
    const room = p.room, r = room.round, isHost = room.host === p.id;
    switch (m.t) {
      case 'i_leave': leave(p); return;
      case 'i_kick': {
        const q = find(room, String(m.id));
        if (!isHost || !q || q === p || (r && r.phase !== 'result')) return;
        if (q.ws) { send(q.ws, { t: 'i_gone', msg: 'The host removed you from the game.' }); q.ws.imp = null; }
        leave(q);
        return;
      }
      case 'i_start': {
        if (!isHost || (r && r.phase !== 'result')) return;
        room.settings = cleanSettings(m.settings);
        const problem = startRound(room, m.cat);
        if (problem) return err(problem);
        break;
      }
      case 'i_lobby':
        if (!isHost) return;
        if (r && r.phase !== 'result') room.roundNo = Math.max(0, room.roundNo - 1);   // ended early, no points
        room.round = null;
        prune(room);
        break;
      case 'i_seen':
        if (!r || r.phase !== 'cards' || !r.ids.includes(p.id)) return;
        r.seen.add(p.id);
        break;
      case 'i_next': {
        if (!isHost || !r) return;
        const to = { cards: 'clues', clues: 'discuss', discuss: 'vote', elim: 'clues' }[r.phase];
        if (!to) return;
        if (to === 'vote') { r.votes.clear(); r.tally = null; r.accused = null; }
        r.phase = to;
        break;
      }
      case 'i_again':
        if (!isHost || !r || r.phase !== 'clues') return;
        r.clueRound++;
        r.starter = nextAlive(r, r.starter);
        break;
      case 'i_vote': {
        const t = String(m.id);
        if (!r || r.phase !== 'vote' || !alive(r).includes(p.id) || t === p.id || !alive(r).includes(t)) return;
        r.votes.set(p.id, t);
        break;
      }
      case 'i_close':
        if (!isHost || !r || r.phase !== 'vote' || !r.votes.size) return;
        closeVote(room);
        break;
      case 'i_reveal':
        if (!isHost || !r || r.phase !== 'tally') return;
        if (m.revote) { r.phase = 'vote'; r.votes.clear(); r.tally = null; r.accused = null; break; }
        accuse(room, r.accused);
        break;
      case 'i_guess': {
        if (!r || r.phase !== 'guess') return;
        const skip = m.skip === true && isHost;
        if (!skip && p.id !== r.accused) return;
        r.out.push(r.accused);
        if (!skip && closeEnough(tidy(m.text, 40), r.word))
          finish(room, 'imposter', `${nm(room, r.accused)} was caught but guessed the word, which steals the win${r.imposters.length > 1 ? ' for the Imposters' : ''}.`);
        else afterVote(room);
        break;
      }
      default: return;
    }
    checkProgress(room);
    push(room);
  }

  function close(ws) {
    const p = ws.imp;
    if (!p || p.ws !== ws) return;
    p.ws = null;
    const room = p.room;
    fixHost(room);
    checkProgress(room);
    push(room);
  }

  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.players.some(online)) room.active = now();
      else if (now() - room.active > ROOM_IDLE_MS) { closeRoom(room); log(`imposter room ${room.code} closed`); }
    }
  }, 60000);

  const stats = () => ({ rooms: rooms.size, players: byToken.size });
  return { handle, close, stats };
}

module.exports = { createImposter, closeEnough };

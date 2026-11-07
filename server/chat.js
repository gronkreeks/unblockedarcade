// Chat for EduArcade: the site-wide chatroom (index.html) and in-game chat for Frontier.
// Nothing is written to disk. Rooms and their last few messages live in memory only and are
// cleared when a room empties.
// The chatroom is end-to-end encrypted (c_emsg): the server relays ciphertext it can't read. There are no
// content rules or age limit; messages are only tidied (see tidy below).
'use strict';
const crypto = require('crypto');

// ──────────── Text clean-up ────────────
// No content rules: messages and names are only tidied (invisible characters stripped, spaces collapsed,
// length capped). Nothing is filtered or blocked for what it says.
function tidy(raw, max) {
  return String(raw == null ? '' : raw)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
const MAX_MSG = 200;
// Returns { ok, text } or { ok: false, reason }.
function filterMessage(raw) {
  const text = tidy(raw, MAX_MSG);
  return text ? { ok: true, text } : { ok: false, reason: 'Type a message first' };
}
// Returns { ok, name } or { ok: false, reason }.
function checkName(raw) {
  const name = tidy(raw, 16);
  return name.length < 2 ? { ok: false, reason: 'Names need at least 2 characters' } : { ok: true, name };
}

// Per-person flood control: short gap between messages, a burst cap, and a timeout for repeat offenders.
function newRate() { return { last: 0, times: [], strikes: 0, strikeAt: 0, mutedUntil: 0, lastText: '', lastTextAt: 0 }; }
function rateCheck(st, text, t) {
  if (st.mutedUntil > t) return `You're muted for ${Math.ceil((st.mutedUntil - t) / 1000)} more seconds`;
  if (t - st.strikeAt > 20000) st.strikes = 0;
  st.times = st.times.filter(x => t - x < 10000);
  if (t - st.last < 700 || st.times.length >= 6) {
    st.strikes++; st.strikeAt = t;
    if (st.strikes >= 3) { st.strikes = 0; st.mutedUntil = t + 30000; return "You're sending messages too fast, so you're muted for 30 seconds"; }
    return 'Slow down a little';
  }
  if (text && text === st.lastText && t - st.lastTextAt < 20000) return 'You just said that';
  st.last = t; st.times.push(t); st.lastText = text; st.lastTextAt = t;
  return null;
}

// ──────────── EduArcade chatroom ────────────
const PUBLIC_ROOMS = [
  { id: 'general', name: 'General', desc: 'Hang out and chat about anything' },
  { id: 'games', name: 'Games', desc: 'Strategies, high scores and game ideas' },
  { id: 'homework', name: 'Homework Help', desc: 'Ask and answer school questions' },
];
const MAX_PUBLIC = 60, MAX_PRIVATE = 16, MAX_PRIVATE_ROOMS = 80, HISTORY = 30;
const REPORTS_TO_REMOVE = 3, REPORT_WINDOW_MS = 10 * 60000, TIMEOUT_MS = 15 * 60000;

// Base64 fields of an encrypted message. A P-256 public key is 65 bytes (88 chars), an AES-KW
// wrapped key 40 bytes (56), the IV 12 bytes (16). Ciphertext covers 200 characters of UTF-8 plus the tag.
const b64 = (s, min, max) => typeof s === 'string' && s.length >= min && s.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : null;
// A report hands over that message's key, so the server can check the reported text is real.
function openReported(msg, roomId, keyB64) {
  try {
    const key = Buffer.from(b64(keyB64, 40, 48) || '', 'base64');
    if (key.length !== 32) return null;
    const buf = Buffer.from(msg.ct, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(msg.iv, 'base64'));
    d.setAAD(Buffer.from(`${roomId}|${msg.uid}`));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8');
  } catch { return null; }
}

function createChat({ send, now, log }) {
  const rooms = new Map();        // id -> { id, name, desc, code, isPublic, members: Set, history: [] }
  const timeouts = new Map();     // ipKey -> until
  const reports = new Map();      // userKey -> [{ by, at }]
  let msgSeq = 0;
  for (const r of PUBLIC_ROOMS) rooms.set(r.id, { ...r, code: null, isPublic: true, members: new Set(), history: [] });

  const users = new Set();
  const code4 = () => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
      if (![...rooms.values()].some(r => r.code === c)) return c;
    }
  };
  const roomList = () => [...rooms.values()].filter(r => r.isPublic)
    .map(r => ({ id: r.id, name: r.name, desc: r.desc, users: r.members.size, max: MAX_PUBLIC }));
  const roomInfo = r => ({ t: 'c_room', id: r.id, name: r.name, code: r.code, isPublic: r.isPublic,
    users: [...r.members].map(u => u.name), members: [...r.members].map(u => ({ uid: u.id, name: u.name, pub: u.pub })),
    max: r.isPublic ? MAX_PUBLIC : MAX_PRIVATE });
  function broadcast(r, msg) { const s = JSON.stringify(msg); for (const u of r.members) send(u.ws, s); }
  // An encrypted message goes to each person with only their own wrapped key
  const forUser = (msg, u) => msg.t !== 'c_emsg' ? msg : (msg.keys[u.id] ? { ...msg, keys: undefined, key: msg.keys[u.id] } : null);
  function post(r, msg) {
    r.history.push(msg);
    if (r.history.length > HISTORY) r.history.shift();
    if (msg.t !== 'c_emsg') return broadcast(r, msg);
    for (const u of r.members) { const m = forUser(msg, u); if (m) send(u.ws, JSON.stringify(m)); }
  }
  const sys = (r, text) => post(r, { t: 'c_msg', id: ++msgSeq, sys: true, text, at: now() });
  function uniqueName(r, name) {
    const taken = new Set([...r.members].map(u => u.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) { const cand = name.slice(0, 13) + ' ' + n; if (!taken.has(cand.toLowerCase())) return cand; }
  }
  function join(u, r) {
    if (r.members.size >= (r.isPublic ? MAX_PUBLIC : MAX_PRIVATE)) return send(u.ws, { t: 'c_err', msg: 'That room is full' });
    leave(u);
    u.name = uniqueName(r, u.baseName);
    r.members.add(u); u.room = r;
    send(u.ws, { t: 'c_you', name: u.name, uid: u.id });
    send(u.ws, { t: 'c_history', list: r.history.map(x => forUser(x, u)).filter(Boolean) });
    sys(r, `${u.name} joined`);
    broadcast(r, roomInfo(r));
  }
  function leave(u) {
    const r = u.room;
    if (!r) return;
    r.members.delete(u); u.room = null;
    if (!r.members.size) {
      r.history = [];
      if (!r.isPublic) rooms.delete(r.id);
      return;
    }
    sys(r, `${u.name} left`);
    broadcast(r, roomInfo(r));
  }
  function timeOut(u, why) {
    timeouts.set(u.ipKey, now() + TIMEOUT_MS);
    const r = u.room;
    log(`chat: ${u.name} timed out (${why})`);
    send(u.ws, { t: 'c_kicked', msg: 'You were removed from the chat for 15 minutes after other people reported your messages.' });
    if (r) { r.members.delete(u); u.room = null; if (r.members.size) { sys(r, `${u.name} was removed from the chat`); broadcast(r, roomInfo(r)); } else if (!r.isPublic) rooms.delete(r.id); }
    u.gone = true;
  }

  function handle(ws, m) {
    const t = now();
    if (m.t === 'c_hello') {
      const until = timeouts.get(ws.ipKey) || 0;
      if (until > t) return send(ws, { t: 'c_denied', msg: `You're in a timeout for ${Math.ceil((until - t) / 60000)} more minutes.` });
      const nm = checkName(m.name);
      if (!nm.ok) return send(ws, { t: 'c_denied', msg: nm.reason, name: true });
      if (ws.chat) leave(ws.chat);
      const u = { id: crypto.randomBytes(8).toString('hex'), ws, ipKey: ws.ipKey, baseName: nm.name, name: nm.name, room: null, rate: newRate(),
        pub: b64(m.pub, 88, 88) };
      ws.chat = u; users.add(u);
      send(ws, { t: 'c_welcome', name: u.name, rooms: roomList(), e2ee: 1 });
      return;
    }
    const u = ws.chat;
    if (!u || u.gone) return;
    switch (m.t) {
      case 'c_list': send(ws, { t: 'c_rooms', rooms: roomList() }); break;
      case 'c_join': {
        const r = rooms.get(String(m.id));
        if (r && r.isPublic) join(u, r); else send(ws, { t: 'c_err', msg: 'That room no longer exists' });
        break;
      }
      case 'c_create': {
        if ([...rooms.values()].filter(r => !r.isPublic).length >= MAX_PRIVATE_ROOMS) return send(ws, { t: 'c_err', msg: 'Too many private rooms right now. Try again soon.' });
        const r = { id: crypto.randomBytes(6).toString('hex'), name: 'Private room', desc: '', code: code4(), isPublic: false, members: new Set(), history: [] };
        rooms.set(r.id, r);
        join(u, r);
        break;
      }
      case 'c_code': {
        const code = String(m.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        const r = [...rooms.values()].find(x => x.code === code);
        if (r) join(u, r); else send(ws, { t: 'c_err', msg: `No room with code ${code || '----'}` });
        break;
      }
      case 'c_leave': leave(u); send(ws, { t: 'c_rooms', rooms: roomList() }); break;
      case 'c_msg': {
        if (!u.room) return;
        const f = filterMessage(m.text);
        if (!f.ok) return send(ws, { t: 'c_err', msg: f.reason });
        const lim = rateCheck(u.rate, f.text, t);
        if (lim) return send(ws, { t: 'c_err', msg: lim });
        post(u.room, { t: 'c_msg', id: ++msgSeq, from: u.name, uid: u.id, text: f.text, at: t });
        break;
      }
      case 'c_emsg': {
        if (!u.room || !u.pub) return;
        const iv = b64(m.iv, 16, 16), ct = b64(m.ct, 24, 1200);
        if (!iv || !ct || !m.keys || typeof m.keys !== 'object') return send(ws, { t: 'c_err', msg: "That message couldn't be sent" });
        const keys = {};
        for (const x of u.room.members) { const k = b64(m.keys[x.id], 56, 56); if (k) keys[x.id] = k; }
        const lim = rateCheck(u.rate, null, t);
        if (lim) return send(ws, { t: 'c_err', msg: lim });
        post(u.room, { t: 'c_emsg', id: ++msgSeq, from: u.name, uid: u.id, iv, ct, keys, at: t });
        break;
      }
      case 'c_report': {
        const r = u.room;
        if (!r) return;
        const msg = r.history.find(x => x.id === m.id && x.uid);
        if (!msg || msg.uid === u.id) return;
        const text = msg.t === 'c_emsg' ? openReported(msg, r.id, m.key) : msg.text;
        if (text == null) return send(ws, { t: 'c_err', msg: "That message couldn't be reported" });
        const author = [...r.members].find(x => x.id === msg.uid);
        log(`chat report in ${r.isPublic ? r.name : 'private ' + r.code}: "${msg.from}: ${text}" reported by ${u.name}`);
        send(ws, { t: 'c_err', msg: 'Thanks, the message was reported.', ok: true });
        if (!author) return;
        const list = (reports.get(author.ipKey) || []).filter(x => t - x.at < REPORT_WINDOW_MS && x.by !== u.ipKey);
        list.push({ by: u.ipKey, at: t });
        reports.set(author.ipKey, list);
        const needed = Math.min(REPORTS_TO_REMOVE, Math.max(1, r.members.size - 1));
        if (new Set(list.map(x => x.by)).size >= needed) { reports.delete(author.ipKey); timeOut(author, 'reports'); }
        break;
      }
    }
  }
  function close(ws) {
    const u = ws.chat;
    if (!u) return;
    leave(u); users.delete(u); ws.chat = null;
  }
  // Housekeeping: forget old timeouts and reports
  setInterval(() => {
    const t = now();
    for (const [k, v] of timeouts) if (v < t) timeouts.delete(k);
    for (const [k, v] of reports) if (!v.some(x => t - x.at < REPORT_WINDOW_MS)) reports.delete(k);
  }, 60000).unref();
  return { handle, close, stats: () => ({ users: users.size, rooms: rooms.size }), roomList };
}

module.exports = { MAX_MSG, filterMessage, checkName, newRate, rateCheck, createChat };

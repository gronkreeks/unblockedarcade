// Chat for EduArcade: the site-wide chatroom (index.html) and in-game chat for Frontier.
// Nothing is written to disk. Rooms and their last few messages live in memory only and are
// cleared when a room empties. Every message goes through the same safety filter.
'use strict';
const crypto = require('crypto');

// ──────────── Safety filter ────────────
// Roots are caught anywhere inside a word ("fucking", "bullshit"); whole words only match exactly,
// because they hide inside normal words ("class", "grape", "peacock").
const ROOTS = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'nigga', 'fagg', 'whore', 'slut', 'pussy', 'bastard',
  'asshole', 'wank', 'twat', 'retard', 'porn', 'penis', 'vagina', 'jizz', 'dildo', 'motherf', 'cocksuck',
  'blowjob', 'handjob', 'tranny', 'kike', 'wetback', 'beaner', 'chink', 'faggot', 'boner', 'hentai'];
const WORDS = new Set(['ass', 'asses', 'arse', 'dick', 'dicks', 'cum', 'fag', 'fags', 'hoe', 'hoes', 'tit', 'tits',
  'titty', 'titties', 'boob', 'boobs', 'sex', 'sexy', 'sexting', 'rape', 'raped', 'raping', 'cock', 'cocks', 'kys',
  'nude', 'nudes', 'horny', 'milf', 'stfu', 'wtf', 'fk', 'fck', 'fuk', 'fuq', 'fking', 'fcking', 'sht', 'btch',
  'rapist', 'rapists', 'spic', 'coon', 'gook', 'dyke', 'nazi', 'thot', 'pedo', 'damn', 'dammit', 'piss', 'pissed', 'crap', 'bollocks',
  'bugger', 'prick', 'skank', 'douche', 'jackass', 'dumbass', 'smartass', 'badass', 'lmfao']);
const SHORT_ROOTS = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'bitch', 'whore', 'slut', 'pussy', 'porn', 'dick', 'cock', 'kys'];
const LEET = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g' };
const squash = w => w.replace(/(.)\1+/g, '$1');
function core(token) {
  return token.toLowerCase().replace(/[0-9!|@$+]/g, c => LEET[c] || c).replace(/[^a-z]/g, '');
}
function isBad(word) {
  if (!word) return false;
  const sq = squash(word);
  if (WORDS.has(word) || WORDS.has(sq)) return true;
  return ROOTS.some(r => word.includes(r) || sq.includes(squash(r)));
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const DOMAIN_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|gg|me|tv|co|xyz|ly|app|dev|info|biz|us|uk|au|ca|nz|link|site|online|club|fun|live|ru|cn|to|cc)\b(?:\/\S*)?/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE_RE = /(?:\+?\d[\s().-]*){8,}/g;
const TAG_RE = /\b\S+#\d{4}\b/g;
const CONTACT_RE = /\b(snap ?chat|snap|insta(?:gram)?|discord|tik ?tok|whats ?app|kik|telegram|wechat|imessage|facetime|phone|cell|mobile|email|e-mail|socials?)\b/i;
const ADDRESS_RE = /\b(my|your|ur|home|street|house) address\b|\bwhere do (you|u) live\b|\bwhat school do (you|u) go\b/i;
const INTENT_RE = /\b(add|my|dm|dms|text|call|hmu|message me|pm|msg|send|whats|what's|whats your|give)\b/i;

function tidy(raw, max) {
  return String(raw == null ? '' : raw)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
// Returns { ok, text } or { ok: false, reason }.
function filterMessage(raw) {
  let text = tidy(raw, 240);
  if (!text) return { ok: false, reason: 'Type a message first' };
  if ((CONTACT_RE.test(text) && INTENT_RE.test(text)) || ADDRESS_RE.test(text)) {
    return { ok: false, reason: "For safety, sharing contact details or social accounts isn't allowed here" };
  }
  text = text.replace(EMAIL_RE, '[removed]').replace(URL_RE, '[link removed]').replace(DOMAIN_RE, '[link removed]')
    .replace(PHONE_RE, '[number removed] ').replace(TAG_RE, '[removed]').trim();
  // Spelled-out words like "f u c k" or "s.h.i.t"
  const letters = text.split(/[\s.,_*-]+/);
  for (let i = 0; i < letters.length; i++) {
    let run = '';
    for (let j = i; j < letters.length && letters[j].length === 1; j++) run += letters[j];
    if (run.length >= 3 && SHORT_ROOTS.some(r => core(run).includes(r))) return { ok: false, reason: 'That message was blocked by the language filter' };
  }
  text = text.split(/(\s+)/).map(tok => {
    if (/^\s+$/.test(tok)) return tok;
    return isBad(core(tok)) ? '*'.repeat(Math.min(8, Math.max(3, tok.length))) : tok;
  }).join('');
  if (!text.replace(/[*\s]/g, '')) return { ok: false, reason: 'That message was blocked by the language filter' };
  // Shouting: mostly-caps long messages are lowered
  const caps = text.replace(/[^A-Z]/g, '').length, lets = text.replace(/[^A-Za-z]/g, '').length;
  if (lets > 12 && caps / lets > 0.7) text = text.toLowerCase();
  return { ok: true, text };
}
const RESERVED = /\b(admin|administrator|mod|moderator|staff|system|server|eduarcade|official|owner|teacher)\b/i;
// Returns { ok, name } or { ok: false, reason }.
function checkName(raw) {
  const name = tidy(raw, 16).replace(/[^\p{L}\p{N} _.\-]/gu, '').trim();
  if (name.length < 2) return { ok: false, reason: 'Names need at least 2 letters' };
  if (RESERVED.test(name)) return { ok: false, reason: 'Please pick a different name' };
  if (/\d{4,}/.test(name)) return { ok: false, reason: "Names can't contain long numbers" };
  if (name.split(/\s+/).some(w => isBad(core(w))) || isBad(core(name))) return { ok: false, reason: 'Please pick a different name' };
  return { ok: true, name };
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
    users: [...r.members].map(u => u.name), max: r.isPublic ? MAX_PUBLIC : MAX_PRIVATE });
  function broadcast(r, msg) { const s = JSON.stringify(msg); for (const u of r.members) send(u.ws, s); }
  function post(r, msg) {
    r.history.push(msg);
    if (r.history.length > HISTORY) r.history.shift();
    broadcast(r, msg);
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
    send(u.ws, { t: 'c_history', list: r.history });
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
      if (m.over13 !== true) return send(ws, { t: 'c_denied', msg: 'The chatroom is only for people aged 13 and older.' });
      const nm = checkName(m.name);
      if (!nm.ok) return send(ws, { t: 'c_denied', msg: nm.reason, name: true });
      if (ws.chat) leave(ws.chat);
      const u = { id: crypto.randomBytes(8).toString('hex'), ws, ipKey: ws.ipKey, baseName: nm.name, name: nm.name, room: null, rate: newRate() };
      ws.chat = u; users.add(u);
      send(ws, { t: 'c_welcome', name: u.name, rooms: roomList() });
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
      case 'c_report': {
        const r = u.room;
        if (!r) return;
        const msg = r.history.find(x => x.id === m.id && x.uid);
        if (!msg || msg.uid === u.id) return;
        const author = [...r.members].find(x => x.id === msg.uid);
        log(`chat report in ${r.isPublic ? r.name : 'private ' + r.code}: "${msg.from}: ${msg.text}" reported by ${u.name}`);
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

module.exports = { filterMessage, checkName, newRate, rateCheck, createChat };

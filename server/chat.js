// Chat for EduArcade: the site-wide chat (index.html, chatroom.js) and the text helpers Frontier's
// in-game chat uses. Nothing is written to disk.
//
// The site-wide chat works like privatewebchat:
//   Channels   Announcements (only the owners in CHAT_OWNERS can post), General, Games, Homework.
//              Public, so not end-to-end encrypted: the last 50 messages of each are kept so people who
//              arrive see what's going on, and reports can be checked. In Upstash Redis when it's set up
//              (they survive restarts), otherwise in memory only.
//   Friends    added by friend code (or by clicking a name). Both sides have to agree.
//   DMs        between friends only, end-to-end encrypted: the server relays ciphertext it can't read.
//   Groups     any of your friends, end-to-end encrypted the same way.
// Who you are: each browser keeps a secret key; your id (friend code) is a hash of it.
// Friendships and group member lists are signed tokens the browsers keep and hand back when they
// connect, so they survive this free server restarting or going to sleep. DMs and group messages for
// someone who's offline wait in memory for up to 24 hours (lost if the server restarts first).
// There are no content rules; messages are only tidied (see tidy below).
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

// ──────────── EduArcade chat ────────────
const { redis, signer, same } = require('./secret.js');
const CHANNELS = [
  { id: 'news', name: 'Announcements', desc: 'News and patch notes from the EduArcade team', readonly: true },
  { id: 'general', name: 'General', desc: 'Hang out and chat about anything' },
  { id: 'games', name: 'Games', desc: 'Strategies, high scores and game ideas' },
  { id: 'homework', name: 'Homework Help', desc: 'Ask and answer school questions' },
];
const HISTORY = 50, NEWS_KEEP = 30;
// Team announcements have no 200-character limit and keep their line breaks (patch notes). This cap only
// keeps a message inside the connection's 16 KB message size.
const NEWS_MAX = 4000;
function tidyLong(raw, max) {
  return String(raw == null ? '' : raw).normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
const QUEUE_TTL = 24 * 3600000, QUEUE_MAX = 300, REQ_TTL = 7 * 24 * 3600000;
const MAX_GROUP = 12, MAX_FRIENDS = 200;
const REPORTS_TO_REMOVE = 3, REPORT_WINDOW_MS = 10 * 60000, TIMEOUT_MS = 15 * 60000;
// Friend codes of the people who can post announcements, comma-separated (dashes are fine)
const OWNERS = new Set((process.env.CHAT_OWNERS || '').split(',').map(s => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean));

const b64 = (s, min, max) => typeof s === 'string' && s.length >= min && s.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : null;
// Friend codes: 10 characters, no look-alikes (0/O, 1/I/L)
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function uidOf(key) {
  const h = crypto.createHash('sha256').update('eduarcade-chat|' + key).digest();
  let s = '';
  for (let i = 0; i < 10; i++) s += CODE_ABC[h[i] % CODE_ABC.length];
  return s;
}
const isUid = x => typeof x === 'string' && x.length === 10 && [...x].every(c => CODE_ABC.includes(c));
const validKey = k => typeof k === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(k);
const pair = (a, b) => a < b ? a + '|' + b : b + '|' + a;

function createChat({ send, now, log, crTitles }) {
  // Games where someone is a Challenger (top 3 on the leaderboard), checked by the server, never claimed
  const crOf = u => { try { const t = crTitles && u.pkey ? crTitles(u.pkey) : []; return t.length ? t : undefined; } catch (e) { return undefined; } };
  const signFriend = signer('chat-friend'), signGroup = signer('chat-group');
  const friendTok = (a, b) => signFriend(pair(a, b));
  const groupTok = (gid, members) => signGroup(gid + '|' + [...members].sort().join(','));

  const users = new Map();        // uid -> { uid, name, pub, conns: Set, friends: Set, rate, ipKey, owner }
  const queues = new Map();       // uid -> [{ msg, exp }]
  const requests = new Map();     // 'from>to' -> { from, name, pub, exp }
  const timeouts = new Map();     // ipKey -> until
  const reports = new Map();      // ipKey -> [{ by, at }]
  const hist = new Map(CHANNELS.map(c => [c.id, []]));
  // Message ids carry on from the clock, so they never repeat after a restart (browsers use them to drop duplicates)
  let seq = Date.now();

  // Channel history is kept in Upstash too (when it's set up), so it survives restarts and sleep.
  // Each channel is a list, newest first: chat:news, chat:general, ...
  const keep = ch => ch === 'news' ? NEWS_KEEP : HISTORY;
  if (redis) for (const c of CHANNELS) {
    redis(['LRANGE', 'chat:' + c.id, 0, keep(c.id) - 1]).then(list => {
      const loaded = (list || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean).reverse();
      hist.set(c.id, loaded.concat(hist.get(c.id)).slice(-keep(c.id)));   // anything said while loading stays
      for (const m of loaded) if (m.id > seq) seq = m.id;
    }).catch(e => log(`chat: could not load #${c.id}: ${e.message}`));
  }
  const saveHist = ch => {
    if (!redis) return;
    const h = hist.get(ch);
    redis(['DEL', 'chat:' + ch]).then(() => h.length && redis(['RPUSH', 'chat:' + ch, ...h.slice().reverse().map(m => JSON.stringify(m))]))
      .catch(e => log('chat: save failed: ' + e.message));
  };

  const sendU = (u, msg) => { const s = typeof msg === 'string' ? msg : JSON.stringify(msg); for (const ws of u.conns) send(ws, s); };
  // Deliver to someone now, or keep it until they connect (up to 24 hours)
  function deliver(uid, msg, ttl) {
    const u = users.get(uid);
    if (u && u.conns.size) return sendU(u, msg);
    const q = (queues.get(uid) || []).filter(x => x.exp > now());
    q.push({ msg, exp: now() + (ttl || QUEUE_TTL) });
    if (q.length > QUEUE_MAX) q.splice(0, q.length - QUEUE_MAX);
    queues.set(uid, q);
  }
  function everyone(msg) { const s = JSON.stringify(msg); for (const u of users.values()) sendU(u, s); }
  const onlineCount = () => [...users.values()].filter(u => u.conns.size).length;
  let countT = null;
  const countSoon = () => { if (!countT) countT = setTimeout(() => { countT = null; everyone({ t: 'c_online', n: onlineCount() }); }, 3000); };

  // text: the tidied message (already checked by the caller)
  function say(u, ch, m, text) {
    const gif = typeof m.gif === 'string' && /^[a-z0-9-]{1,24}$/.test(m.gif) ? m.gif : undefined;
    if (m.gif && !gif) return;
    const reply = m.reply && typeof m.reply === 'object' ? { id: +m.reply.id || 0, from: tidy(m.reply.from, 16), text: tidy(m.reply.text, 80) } : undefined;
    const msg = { t: 'c_said', ch, id: ++seq, uid: u.uid, from: u.name, text: gif ? '' : text, gif, reply, at: now(), owner: u.owner || undefined, cr: crOf(u) };
    const h = hist.get(ch); h.push(msg); if (h.length > keep(ch)) h.shift();
    if (redis) redis(['LPUSH', 'chat:' + ch, JSON.stringify(msg)]).then(() => redis(['LTRIM', 'chat:' + ch, 0, keep(ch) - 1])).catch(e => log('chat: save failed: ' + e.message));
    everyone(msg);
  }
  function timeOut(u, why) {
    timeouts.set(u.ipKey, now() + TIMEOUT_MS);
    log(`chat: ${u.name} (${u.uid}) timed out (${why})`);
    sendU(u, { t: 'c_kicked', msg: 'You were removed from the chat for 15 minutes after other people reported your messages.' });
    for (const ws of u.conns) ws.chat = null;
    u.conns.clear();
  }
  function friendInfo(u) { return { uid: u.uid, name: u.name, pub: u.pub }; }

  function handle(ws, m) {
    const t = now();
    if (m.t === 'c_hello') {
      const until = timeouts.get(ws.ipKey) || 0;
      if (until > t) return send(ws, { t: 'c_denied', msg: `You're in a timeout for ${Math.ceil((until - t) / 60000)} more minutes.` });
      if (!validKey(m.key)) return send(ws, { t: 'c_denied', msg: 'Please reload the page to use the new chat.' });
      const nm = checkName(m.name);
      if (!nm.ok) return send(ws, { t: 'c_denied', msg: nm.reason, name: true });
      if (ws.chat) close(ws);
      const uid = uidOf(m.key);
      let u = users.get(uid);
      if (!u) { u = { uid, conns: new Set(), friends: new Set(), rate: newRate(), owner: OWNERS.has(uid) }; users.set(uid, u); }
      const wasOnline = u.conns.size > 0;
      u.name = nm.name; u.pub = b64(m.pub, 88, 88) || u.pub; u.ipKey = ws.ipKey;
      // The browser's leaderboard key (ranked.js), so the server can tell whether this person is a Challenger
      u.pkey = typeof m.pkey === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(m.pkey) ? m.pkey : u.pkey;
      u.conns.add(ws); ws.chat = u; u.ws = ws;
      // Friendships this browser has tokens for
      u.friends = new Set();
      const bad = [];
      for (const f of Array.isArray(m.friends) ? m.friends.slice(0, MAX_FRIENDS) : []) {
        if (!f || !isUid(f.uid) || f.uid === uid) continue;
        if (typeof f.tok === 'string' && same(friendTok(uid, f.uid), f.tok)) u.friends.add(f.uid); else bad.push(f.uid);
      }
      for (const f of u.friends) { const o = users.get(f); if (o && o.conns.size) o.friends.add(uid); }
      const online = [...u.friends].filter(f => { const o = users.get(f); return o && o.conns.size && o.friends.has(uid); });
      send(ws, { t: 'c_welcome', uid, name: u.name, owner: u.owner, online: onlineCount(), friendsOnline: online, badFriends: bad,
        channels: CHANNELS.map(c => ({ ...c, readonly: c.readonly && !u.owner, history: hist.get(c.id) })) });
      // Waiting friend requests, DMs and group messages
      const reqs = [...requests.values()].filter(r => r.to === uid && r.exp > t);
      for (const r of reqs) send(ws, { t: 'c_freq', from: r.from, name: r.name, pub: r.pub });
      const q = (queues.get(uid) || []).filter(x => x.exp > t);
      queues.delete(uid);
      for (const x of q) send(ws, x.msg);
      if (!wasOnline) { for (const f of online) sendU(users.get(f), { t: 'c_presence', uid, on: true, name: u.name }); countSoon(); }
      return;
    }
    const u = ws.chat;
    if (!u) return;
    u.ws = ws;
    const err = msg => send(ws, { t: 'c_err', msg });
    const limited = () => { const l = rateCheck(u.rate, null, t); if (l) err(l); return !!l; };
    switch (m.t) {
      case 'c_say': {
        const ch = CHANNELS.find(c => c.id === m.ch);
        if (!ch) return;
        if (ch.readonly && !u.owner) return err('Only the EduArcade team can post here');
        let text = '';
        if (!m.gif) {
          if (ch.id === 'news') { text = tidyLong(m.text, NEWS_MAX); if (!text) return err('Type a message first'); }
          else { const f = filterMessage(m.text); if (!f.ok) return err(f.reason); text = f.text; }
          const l = rateCheck(u.rate, text, t); if (l) return err(l);
        } else if (limited()) return;
        say(u, ch.id, m, text);
        break;
      }
      case 'c_del': {   // the team can delete announcements
        if (!u.owner || m.ch !== 'news') return err('Only the EduArcade team can delete announcements');
        const h = hist.get('news'), i = h.findIndex(x => x.id === m.id);
        if (i < 0) return;
        h.splice(i, 1);
        saveHist('news');
        everyone({ t: 'c_deleted', ch: 'news', id: m.id });
        break;
      }
      case 'c_report': {
        const msg = (hist.get(m.ch) || []).find(x => x.id === m.id);
        if (!msg || msg.uid === u.uid) return;
        log(`chat report in #${m.ch}: "${msg.from} (${msg.uid}): ${msg.text || '[gif ' + msg.gif + ']'}" reported by ${u.name} (${u.uid})`);
        send(ws, { t: 'c_err', msg: 'Thanks, the message was reported.', ok: true });
        const author = users.get(msg.uid);
        if (!author || !author.conns.size) return;
        const list = (reports.get(author.ipKey) || []).filter(x => t - x.at < REPORT_WINDOW_MS && x.by !== u.ipKey);
        list.push({ by: u.ipKey, at: t });
        reports.set(author.ipKey, list);
        const needed = Math.min(REPORTS_TO_REMOVE, Math.max(1, onlineCount() - 1));
        if (new Set(list.map(x => x.by)).size >= needed) {
          reports.delete(author.ipKey);
          timeOut(author, 'reports');
          for (const [ch, h] of hist) {
            const n = h.length;
            for (let i = h.length - 1; i >= 0; i--) if (h[i].uid === author.uid) h.splice(i, 1);
            if (h.length !== n) saveHist(ch);
          }
          everyone({ t: 'c_purge', uid: author.uid });
        }
        break;
      }
      case 'c_freq': {   // friend request by friend code
        const to = String(m.to || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!isUid(to)) return err("That friend code isn't right. Codes are 10 letters and numbers.");
        if (to === u.uid) return err("That's your own friend code");
        if (u.friends.has(to)) return err("You're already friends");
        if (t - (u.lastReq || 0) < 1500) return err('Slow down a little');
        u.lastReq = t;
        if ([...requests.values()].filter(r => r.from === u.uid && r.exp > t).length >= 30) return err('You have a lot of friend requests waiting. Try again later.');
        // Both asked each other: that's a yes
        if (requests.has(to + '>' + u.uid)) return befriend(u, to);
        requests.set(u.uid + '>' + to, { from: u.uid, to, name: u.name, pub: u.pub, exp: t + REQ_TTL });
        const o = users.get(to);
        if (o && o.conns.size) sendU(o, { t: 'c_freq', from: u.uid, name: u.name, pub: u.pub });
        send(ws, { t: 'c_err', msg: o && o.conns.size ? `Friend request sent to ${o.name}` : 'Friend request sent. They\'ll see it next time they open the chat.', ok: true });
        break;
      }
      case 'c_fanswer': {
        const r = requests.get(m.uid + '>' + u.uid);
        requests.delete(m.uid + '>' + u.uid);
        if (r && m.ok) befriend(u, m.uid, r);
        break;
      }
      case 'c_unfriend': {
        if (!isUid(m.uid)) return;
        u.friends.delete(m.uid);
        requests.delete(m.uid + '>' + u.uid); requests.delete(u.uid + '>' + m.uid);
        const o = users.get(m.uid);
        if (o) o.friends.delete(u.uid);
        deliver(m.uid, { t: 'c_unfriended', uid: u.uid });
        break;
      }
      case 'c_dm': {
        if (!isUid(m.to) || !u.friends.has(m.to)) return err('You can only message friends');
        const iv = b64(m.iv, 16, 16), ct = b64(m.ct, 24, 3000), k = b64(m.k, 56, 56), ks = b64(m.ks, 56, 56);
        if (!iv || !ct || !k) return err("That message couldn't be sent");
        if (limited()) return;
        const id = ++seq;
        const cr = crOf(u);
        deliver(m.to, { t: 'c_dm', from: u.uid, name: u.name, id, iv, ct, k, at: t, cr });
        for (const c of u.conns) if (c !== ws && ks) send(c, { t: 'c_dm', from: u.uid, to: m.to, name: u.name, id, iv, ct, k: ks, at: t, mine: true });
        send(ws, { t: 'c_sent', cid: m.cid, id, at: t });
        break;
      }
      case 'c_gnew': {
        const infos = Array.isArray(m.members) ? m.members.slice(0, MAX_GROUP - 1) : [];
        const members = infos.map(x => x && x.uid).filter(isUid);
        if (!members.length) return err('Pick at least one friend');
        if (members.some(x => !u.friends.has(x))) return err('Groups can only have your friends in them');
        if (limited()) return;
        const gid = crypto.randomBytes(6).toString('hex'), all = [u.uid, ...new Set(members)];
        const name = tidy(m.name, 32) || 'Group chat';
        const people = [friendInfo(u), ...infos.filter(x => members.includes(x.uid)).map(x => ({ uid: x.uid, name: tidy(x.name, 16), pub: b64(x.pub, 88, 88) }))];
        const msg = { t: 'c_group', gid, name, members: people, tok: groupTok(gid, all), by: u.uid };
        for (const x of all) deliver(x, msg);
        break;
      }
      case 'c_gmsg': {
        const g = checkGroup(u, m);
        if (!g) return err("You're not in that group any more");
        const iv = b64(m.iv, 16, 16), ct = b64(m.ct, 24, 3000);
        if (!iv || !ct || !m.keys || typeof m.keys !== 'object') return err("That message couldn't be sent");
        if (limited()) return;
        const id = ++seq, cr = crOf(u);
        for (const x of g) {
          const k = b64(m.keys[x], 56, 56);
          if (!k) continue;
          const env = { t: 'c_gmsg', gid: m.gid, from: u.uid, name: u.name, id, iv, ct, k, at: t, cr };
          if (x === u.uid) { for (const c of u.conns) if (c !== ws) send(c, { ...env, mine: true }); }
          else deliver(x, env);
        }
        send(ws, { t: 'c_sent', cid: m.cid, id, at: t });
        break;
      }
      case 'c_gleave': {
        const g = checkGroup(u, m);
        if (!g) return;
        const rest = g.filter(x => x !== u.uid);
        const msg = { t: 'c_gupdate', gid: m.gid, members: rest, tok: groupTok(m.gid, rest), left: u.uid, name: u.name };
        for (const x of rest) deliver(x, msg);
        break;
      }
      case 'c_gadd': {
        const g = checkGroup(u, m), add = m.add && isUid(m.add.uid) ? m.add : null;
        if (!g || !add) return;
        if (!u.friends.has(add.uid)) return err('You can only add your friends');
        if (g.includes(add.uid)) return err("They're already in the group");
        if (g.length >= MAX_GROUP) return err(`Groups can have up to ${MAX_GROUP} people`);
        const all = [...g, add.uid], tok = groupTok(m.gid, all);
        const info = { uid: add.uid, name: tidy(add.name, 16), pub: b64(add.pub, 88, 88) };
        for (const x of g) deliver(x, { t: 'c_gupdate', gid: m.gid, members: all, tok, added: info, by: u.name });
        const people = (Array.isArray(m.infos) ? m.infos : []).filter(x => x && g.includes(x.uid)).map(x => ({ uid: x.uid, name: tidy(x.name, 16), pub: b64(x.pub, 88, 88) }));
        deliver(add.uid, { t: 'c_group', gid: m.gid, name: tidy(m.name, 32) || 'Group chat', members: [...people, info], tok, by: u.uid });
        break;
      }
    }
  }
  // A group message names the group, its member list and the token the server signed for that list
  function checkGroup(u, m) {
    if (typeof m.gid !== 'string' || !/^[0-9a-f]{12}$/.test(m.gid) || !Array.isArray(m.members) || m.members.length > MAX_GROUP) return null;
    const g = [...new Set(m.members.filter(isUid))];
    return g.includes(u.uid) && typeof m.tok === 'string' && same(groupTok(m.gid, g), m.tok) ? g : null;
  }
  function befriend(u, other, r) {
    const o = users.get(other);
    const tok = friendTok(u.uid, other);
    u.friends.add(other);
    if (o) o.friends.add(u.uid);
    requests.delete(other + '>' + u.uid); requests.delete(u.uid + '>' + other);
    const theirInfo = o ? friendInfo(o) : { uid: other, name: r ? r.name : 'Friend', pub: r ? r.pub : null };
    sendU(u, { t: 'c_friend', ...theirInfo, tok, on: !!(o && o.conns.size) });
    deliver(other, { t: 'c_friend', ...friendInfo(u), tok, on: true }, REQ_TTL);
  }
  function close(ws) {
    const u = ws.chat;
    if (!u) return;
    ws.chat = null;
    u.conns.delete(ws);
    if (u.ws === ws) u.ws = [...u.conns][0] || null;
    if (u.conns.size) return;
    for (const f of u.friends) { const o = users.get(f); if (o && o.conns.size) sendU(o, { t: 'c_presence', uid: u.uid, on: false }); }
    countSoon();
  }
  // Housekeeping: forget people who left, old queues, requests, timeouts and reports
  setInterval(() => {
    const t = now();
    for (const [k, u] of users) if (!u.conns.size && !queues.has(k)) users.delete(k);
    for (const [k, q] of queues) { const live = q.filter(x => x.exp > t); if (live.length) queues.set(k, live); else queues.delete(k); }
    for (const [k, r] of requests) if (r.exp < t) requests.delete(k);
    for (const [k, v] of timeouts) if (v < t) timeouts.delete(k);
    for (const [k, v] of reports) if (!v.some(x => t - x.at < REPORT_WINDOW_MS)) reports.delete(k);
  }, 60000).unref();
  return { handle, close, stats: () => ({ users: onlineCount(), queued: queues.size }) };
}

module.exports = { MAX_MSG, filterMessage, checkName, newRate, rateCheck, createChat };

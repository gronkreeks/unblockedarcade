// EduArcade Chat, modelled on privatewebchat. Server side: server/chat.js.
//   Channels  Announcements (team only), General, Games, Homework. Public, so not end-to-end encrypted;
//             the server keeps the last few messages so you see what's going on when you arrive.
//   Friends   added by friend code or by clicking a name. Both sides agree before anyone can DM.
//   DMs and groups are end-to-end encrypted: every message gets its own AES-GCM key, wrapped for each
//             reader with a key derived (ECDH P-256 + HKDF) from your key pair and theirs. The server
//             relays ciphertext it can't read.
// This browser keeps who you are (a secret key and your key pair), your friends, groups and the last
// 24 hours of DMs and group messages, in localStorage. Nothing else is saved.
(() => {
  'use strict';
  const param = new URLSearchParams(location.search).get('server');
  const SERVER = param && /^(wss:\/\/|ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/.test(param) ? param : 'wss://api.eduarcade.online';
  const $ = id => document.getElementById(id);
  const KEEP_MS = 24 * 3600000, KEEP_N = 200;
  const MAX = ChatText.MAX_MSG;
  const GIFS = typeof PwcGifs !== 'undefined' ? PwcGifs : { list: [], byId: {} };   // chat-gifs.js

  // ── Saved state ──
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  let me = load('edu-chat-me', null);            // { key, name }
  const friends = load('edu-chat-friends', {});  // uid -> { name, pub, tok }
  const groups = load('edu-chat-groups', {});    // gid -> { name, members: { uid: { name, pub } }, tok }
  const reqs = load('edu-chat-reqs', {});        // uid -> { name, pub }   (friend requests to you)
  const blocked = new Set(load('edu-chat-blocked', []));
  const convos = load('edu-chat-convos', {});    // 'd:UID' / 'g:GID' -> { msgs: [], unread }
  const saveFriends = () => store('edu-chat-friends', friends);
  const saveGroups = () => store('edu-chat-groups', groups);
  const saveReqs = () => store('edu-chat-reqs', reqs);
  const saveBlocked = () => store('edu-chat-blocked', [...blocked]);
  let saveT = 0;
  const saveConvos = () => { clearTimeout(saveT); saveT = setTimeout(() => store('edu-chat-convos', convos), 300); };
  const convExists = id => id.startsWith('d:') ? !!friends[id.slice(2)] : id.startsWith('g:') ? !!groups[id.slice(2)] : true;
  // DMs and group messages last 24 hours
  function prune() {
    const cut = Date.now() - KEEP_MS;
    for (const [id, c] of Object.entries(convos)) {
      c.msgs = (c.msgs || []).filter(m => m.at > cut).slice(-KEEP_N);
      if (!c.msgs.length && !convExists(id)) delete convos[id];
    }
    saveConvos();
  }

  // ── Live state ──
  let ws = null, uid = null, owner = false, active = false, retry = 1000, retryT = 0, helloT = 0, queue = Promise.resolve();
  let channels = [], onlineN = 0, cur = 'c:general', replyTo = null;
  const chLogs = {};                // 'c:ID' -> [msgs]
  const chUnread = {};
  const online = new Set();         // friends online
  const pending = new Map();        // cid -> { conv, body, msg, cid }   (sent, not confirmed yet)
  const send = m => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; };

  // ── Encryption ──
  const subtle = window.isSecureContext && window.crypto && crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const toB64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const K = { priv: null, pub: null, wrap: new Map() };
  async function loadKeys() {
    if (!subtle || K.priv) return;
    const saved = load('edu-chat-keys', null);
    try {
      if (saved && saved.jwk && saved.pub) {
        K.priv = await subtle.importKey('jwk', saved.jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
        K.pub = saved.pub; return;
      }
    } catch (e) { }
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    K.priv = pair.privateKey;
    K.pub = toB64(await subtle.exportKey('raw', pair.publicKey));
    store('edu-chat-keys', { jwk: await subtle.exportKey('jwk', pair.privateKey), pub: K.pub });
  }
  function wrapKey(pub) {
    if (!K.wrap.has(pub)) {
      K.wrap.set(pub, (async () => {
        const theirs = await subtle.importKey('raw', fromB64(pub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const bits = await subtle.deriveBits({ name: 'ECDH', public: theirs }, K.priv, 256);
        const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode('eduarcade-chat-v2') },
          hk, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
      })());
    }
    return K.wrap.get(pub);
  }
  // readers: { uid: pub }. Returns { iv, ct, keys: { uid: wrapped key } }
  async function seal(aad, body, readers) {
    const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, te.encode(JSON.stringify(body)));
    const keys = {};
    for (const [u, pub] of Object.entries(readers)) if (pub) keys[u] = toB64(await subtle.wrapKey('raw', key, await wrapKey(pub), 'AES-KW'));
    return { iv: toB64(iv), ct: toB64(ct), keys };
  }
  async function unseal(aad, x, senderPub) {
    if (!senderPub || !x.k || !K.priv) return null;
    try {
      const key = await subtle.unwrapKey('raw', fromB64(x.k), await wrapKey(senderPub), 'AES-KW', 'AES-GCM', false, ['decrypt']);
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(x.iv), additionalData: te.encode(aad) }, key, fromB64(x.ct));
      return JSON.parse(td.decode(pt));
    } catch (e) { return null; }
  }
  const dmAad = (a, b, from) => 'dm|' + (a < b ? a + '|' + b : b + '|' + a) + '|' + from;
  const gAad = (gid, from) => 'g|' + gid + '|' + from;
  // A decrypted message is tidied the same way the server tidies channel messages
  function cleanBody(b) {
    if (!b || typeof b !== 'object') return null;
    const gif = typeof b.gif === 'string' && GIFS.byId[b.gif] ? b.gif : undefined;
    const f = ChatText.filterMessage(b.text);
    if (!gif && !f.ok) return null;
    const reply = b.reply && typeof b.reply === 'object' ? { from: String(b.reply.from || '').slice(0, 16), text: String(b.reply.text || '').slice(0, 80) } : undefined;
    return { text: gif ? '' : f.text, gif, reply };
  }

  // ── Connection ──
  const status = t => { $('ecStatus').textContent = t; };
  const err = (t, ok) => { const e = $('ecErr'); e.textContent = t || ''; e.classList.toggle('ok', !!ok); if (t) setTimeout(() => { if (e.textContent === t) e.textContent = ''; }, 6000); };
  const showApp = on => { $('ecJoin').classList.toggle('ec-hidden', on); $('ecApp').classList.toggle('ec-hidden', !on); };
  function hello() {
    let pkey; try { pkey = localStorage.getItem('edu-player-key') || undefined; } catch (e) { }
    send({ t: 'c_hello', key: me.key, name: me.name, pub: K.pub || undefined, pkey,
      friends: Object.entries(friends).map(([u, f]) => ({ uid: u, tok: f.tok })) });
  }
  function connect() {
    if (ws && ws.readyState <= 1) return;
    clearTimeout(retryT);
    status('Connecting… the chat server can take up to a minute to wake up.');
    try { ws = new EduSocket(SERVER); } catch (e) { status("Couldn't reach the chat server."); return; }
    ws.onopen = () => {
      retry = 1000; status('');
      hello();
      clearTimeout(helloT);
      helloT = setTimeout(() => status("The chat isn't answering right now. It'll keep trying."), 12000);
    };
    // Handled one at a time, in order, because decrypting is asynchronous
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (!m.t || !m.t.startsWith('c_')) return;
      queue = queue.then(() => onMsg(m)).catch(x => console.error(x));
    };
    ws.onclose = () => {
      ws = null; online.clear(); renderList();
      if (!active) return;
      status('Disconnected. Reconnecting…');
      retryT = setTimeout(connect, retry);
      retry = Math.min(15000, retry * 1.7);
    };
  }
  function stop() { active = false; clearTimeout(retryT); if (ws) { try { ws.close(); } catch (e) { } } ws = null; }

  async function onMsg(m) {
    clearTimeout(helloT);
    switch (m.t) {
      case 'c_welcome': {
        uid = m.uid; owner = !!m.owner; onlineN = m.online;
        me.name = m.name; store('edu-chat-me', me);
        $('ecMe').textContent = m.name; $('ecCodeVal').textContent = fmtCode(uid);
        channels = m.channels;
        for (const c of channels) chLogs['c:' + c.id] = (c.history || []).map(fromSaid);
        online.clear(); for (const f of m.friendsOnline || []) online.add(f);
        // Friendships the server no longer recognises (its signing key changed): add them again
        for (const f of m.badFriends || []) if (friends[f]) friends[f].stale = true;
        saveFriends();
        showApp(true); status('');
        // Messages that weren't confirmed before the connection dropped go again
        const again = [...pending.values()]; pending.clear();
        for (const p of again) resend(p);
        openConv(cur, true);
        break;
      }
      case 'c_denied': case 'c_kicked': stop(); showApp(false); $('ecJoinErr').textContent = m.msg; status(''); break;
      case 'c_err': err(m.msg, m.ok); break;
      case 'c_online': onlineN = m.n; if (cur.startsWith('c:')) renderTop(); break;
      case 'c_said': {
        const x = fromSaid(m), id = 'c:' + m.ch, log = chLogs[id] || (chLogs[id] = []);
        log.push(x); if (log.length > 100) log.shift();
        if (blocked.has(x.uid)) break;
        const ping = !x.mine && ChatAlerts.mentions(x.text, me.name);
        if (id === cur) addMsg(x); else if (!x.mine) { chUnread[id] = (chUnread[id] || 0) + 1; renderList(); }
        if (ping || (m.ch === 'news' && !x.mine)) ChatAlerts.notify(x.from, x.text || 'sent a GIF', '#' + chName(m.ch));
        break;
      }
      case 'c_purge':
        for (const id of Object.keys(chLogs)) chLogs[id] = chLogs[id].filter(x => x.uid !== m.uid);
        if (cur.startsWith('c:')) openConv(cur, true);
        break;
      case 'c_freq':
        if (blocked.has(m.from) || friends[m.from]) break;
        reqs[m.from] = { name: m.name, pub: m.pub }; saveReqs(); renderList();
        ChatAlerts.notify(m.name, 'wants to be your friend', 'EduArcade Chat');
        break;
      case 'c_friend':
        if (blocked.has(m.uid)) { send({ t: 'c_unfriend', uid: m.uid }); break; }
        delete reqs[m.uid]; saveReqs();
        friends[m.uid] = { name: m.name, pub: m.pub || (friends[m.uid] && friends[m.uid].pub), tok: m.tok };
        saveFriends();
        if (m.on) online.add(m.uid);
        addTo('d:' + m.uid, { sys: true, text: `You and ${m.name} are friends now. Messages here are end-to-end encrypted.`, at: Date.now() });
        break;
      case 'c_unfriended':
        if (friends[m.uid]) { const n = friends[m.uid].name; delete friends[m.uid]; saveFriends(); addTo('d:' + m.uid, { sys: true, text: `${n} removed you as a friend.`, at: Date.now() }); }
        online.delete(m.uid);
        if (cur === 'd:' + m.uid) openConv('c:general', true); else renderList();
        break;
      case 'c_presence':
        if (m.on) online.add(m.uid); else online.delete(m.uid);
        if (m.on && m.name && friends[m.uid] && friends[m.uid].name !== m.name) { friends[m.uid].name = m.name; saveFriends(); }
        renderList(); if (cur === 'd:' + m.uid) renderTop();
        break;
      case 'c_dm': {
        const other = m.mine ? m.to : m.from, f = friends[other];
        if (!f || blocked.has(other)) break;
        if (!m.mine && m.name && f.name !== m.name) { f.name = m.name; saveFriends(); }
        const body = cleanBody(await unseal(dmAad(uid, other, m.from), m, m.mine ? K.pub : f.pub));
        const x = body ? { id: m.id, uid: m.from, from: m.mine ? me.name : f.name, ...body, at: m.at, mine: !!m.mine, cr: m.mine ? myCr() : m.cr }
          : { sys: true, text: `A message from ${f.name} couldn't be decrypted.`, at: m.at };
        addTo('d:' + other, x, !m.mine);
        if (!m.mine && body) ChatAlerts.notify(f.name, body.text || 'sent a GIF', 'a DM');
        break;
      }
      case 'c_group': {
        const mem = {};
        for (const p of m.members || []) if (p && p.uid) mem[p.uid] = { name: p.name, pub: p.pub };
        const isNew = !groups[m.gid];
        groups[m.gid] = { name: m.name, members: mem, tok: m.tok };
        saveGroups();
        if (isNew) addTo('g:' + m.gid, { sys: true, text: `${m.by === uid ? 'You' : (mem[m.by] || {}).name || 'A friend'} made this group. Messages here are end-to-end encrypted.`, at: Date.now() }, m.by !== uid);
        else renderList();
        if (m.by === uid) openConv('g:' + m.gid);
        break;
      }
      case 'c_gupdate': {
        const g = groups[m.gid];
        if (!g) break;
        const keep = {};
        for (const u of m.members) if (g.members[u]) keep[u] = g.members[u];
        if (m.added) keep[m.added.uid] = { name: m.added.name, pub: m.added.pub };
        g.members = keep; g.tok = m.tok; saveGroups();
        addTo('g:' + m.gid, { sys: true, text: m.left ? `${m.name} left the group.` : `${m.by} added ${m.added.name}.`, at: Date.now() });
        if (cur === 'g:' + m.gid) renderTop();
        break;
      }
      case 'c_gmsg': {
        const g = groups[m.gid];
        if (!g || blocked.has(m.from)) break;
        const sender = m.mine ? { name: me.name, pub: K.pub } : g.members[m.from];
        const body = cleanBody(await unseal(gAad(m.gid, m.from), m, sender && sender.pub));
        const x = body ? { id: m.id, uid: m.from, from: sender ? sender.name : m.name, ...body, at: m.at, mine: !!m.mine, cr: m.mine ? myCr() : m.cr }
          : { sys: true, text: `A message from ${m.name} couldn't be decrypted.`, at: m.at };
        addTo('g:' + m.gid, x, !m.mine);
        if (!m.mine && body && (ChatAlerts.mentions(body.text, me.name) || cur !== 'g:' + m.gid || document.hidden)) ChatAlerts.notify(x.from, body.text || 'sent a GIF', g.name);
        break;
      }
      case 'c_sent': {
        const p = pending.get(m.cid);
        if (!p) break;
        pending.delete(m.cid);
        p.msg.pending = false; p.msg.id = m.id; p.msg.at = m.at; saveConvos();
        if (cur === p.conv) openConv(cur, true);
        break;
      }
    }
  }
  const fromSaid = m => ({ id: m.id, uid: m.uid, from: m.from, text: m.text, gif: m.gif, reply: m.reply, at: m.at, owner: m.owner, cr: m.cr, mine: m.uid === uid });
  // Challenger tag: the server adds the games where the sender is in the top 3. For your own DMs and
  // group messages (which it doesn't stamp for you) it comes from your own Challenger status (ranked.js).
  const myCr = () => window.Ranked ? Object.keys(Ranked.CR_GAMES).filter(g => { const s = Ranked.crStatus(g); return s && s.challenger; }) : [];
  const crGames = list => Array.isArray(list) && window.Ranked ? list.filter(g => Ranked.CR_GAMES[g]) : [];
  const chName = id => (channels.find(c => c.id === id) || {}).name || id;
  const fmtCode = c => c ? c.slice(0, 5) + '-' + c.slice(5) : '';

  // Adds a DM / group message to its conversation (kept for 24 hours)
  function addTo(id, x, unread) {
    const c = convos[id] || (convos[id] = { msgs: [], unread: 0 });
    if (x.id && c.msgs.some(y => y.id === x.id)) return;
    c.msgs.push(x); if (c.msgs.length > KEEP_N) c.msgs.shift();
    if (id === cur && !(unread && document.hidden)) addMsg(x);
    else if (unread) c.unread = (c.unread || 0) + 1;
    saveConvos(); renderList();
  }

  // ── Sending ──
  async function sendMsg(gif) {
    const input = $('ecMsg');
    const text = gif ? '' : input.value.trim();
    if (!gif && !text) return;
    if (!ws || ws.readyState !== 1) return err('Not connected right now');
    const reply = replyTo ? { id: replyTo.id || 0, from: replyTo.from, text: (replyTo.text || (replyTo.gif ? '[GIF]' : '')).slice(0, 80) } : undefined;
    if (cur.startsWith('c:')) {
      if (!gif) { const f = ChatText.filterMessage(text); if (!f.ok) return err(f.reason); }
      send({ t: 'c_say', ch: cur.slice(2), text, gif, reply });
    } else {
      if (!subtle || !K.priv) return err("This browser can't encrypt messages, so it can't send DMs.");
      const f = gif ? { ok: true, text: '' } : ChatText.filterMessage(text);
      if (!f.ok) return err(f.reason);
      const body = { text: f.text, gif, reply }, cid = Math.random().toString(36).slice(2);
      const p = { conv: cur, body, cid, msg: { uid, from: me.name, ...body, at: Date.now(), mine: true, pending: true, cr: myCr() } };
      if (!(await sealAndSend(p))) return;
      pending.set(cid, p);
      addTo(cur, p.msg);
    }
    input.value = ''; left(); setReply(null);
  }
  async function sealAndSend(p) {
    try {
      if (p.conv.startsWith('d:')) {
        const other = p.conv.slice(2), f = friends[other];
        if (!f) { err("You're not friends any more"); return false; }
        if (f.stale) { err(`Your friendship with ${f.name} needs renewing first (Renew, at the top).`); return false; }
        if (!f.pub) { err(`${f.name} needs to open the chat once before you can message them.`); return false; }
        const s = await seal(dmAad(uid, other, uid), p.body, { [other]: f.pub, [uid]: K.pub });
        return send({ t: 'c_dm', to: other, iv: s.iv, ct: s.ct, k: s.keys[other], ks: s.keys[uid], cid: p.cid });
      }
      const gid = p.conv.slice(2), g = groups[gid];
      if (!g) { err("You're not in that group any more"); return false; }
      const readers = { [uid]: K.pub };
      for (const [u, x] of Object.entries(g.members)) if (u !== uid) readers[u] = x.pub;
      const s = await seal(gAad(gid, uid), p.body, readers);
      return send({ t: 'c_gmsg', gid, tok: g.tok, members: Object.keys(g.members), iv: s.iv, ct: s.ct, keys: s.keys, cid: p.cid });
    } catch (e) { err("That message couldn't be encrypted"); return false; }
  }
  function resend(p) { sealAndSend(p).then(ok => { if (ok) pending.set(p.cid, p); }); }

  // ── Rendering ──
  const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function item(id, label, opts) {
    const b = el('button', 'ec-item' + (id === cur ? ' on' : '') + (opts.unread ? ' unread' : ''));
    b.type = 'button';
    if (opts.hash) b.appendChild(el('span', 'hash', opts.hash));
    if (opts.dot != null) b.appendChild(el('span', 'ec-dot' + (opts.dot ? ' on' : '')));
    b.appendChild(el('span', 'nm', label));
    if (opts.unread) b.appendChild(el('span', 'ec-badge', opts.unread > 99 ? '99+' : opts.unread));
    b.onclick = () => openConv(id);
    return b;
  }
  function section(title, plus) {
    const s = el('div', 'ec-sec'); s.appendChild(el('span', '', title));
    if (plus) { const b = el('button', '', '+'); b.type = 'button'; b.title = plus.title; b.setAttribute('aria-label', plus.title); b.onclick = plus.click; s.appendChild(b); }
    return s;
  }
  function renderList() {
    const L = $('ecList');
    const scroll = L.scrollTop, typing = document.activeElement && document.activeElement.id === 'ecAddCode' ? document.activeElement.value : null;
    L.innerHTML = '';
    L.appendChild(section('Channels'));
    for (const c of channels) L.appendChild(item('c:' + c.id, c.name, { hash: c.id === 'news' ? '📣' : '#', unread: chUnread['c:' + c.id] || 0 }));
    const rq = Object.entries(reqs).filter(([u]) => !friends[u] && !blocked.has(u));
    if (rq.length) {
      L.appendChild(section('Friend requests'));
      for (const [u, r] of rq) {
        const row = el('div', 'ec-req'); row.appendChild(el('span', '', r.name));
        const yes = el('button', 'ec-btn sm', 'Accept'), no = el('button', 'ec-btn sm ghost', 'No');
        yes.type = no.type = 'button';
        yes.onclick = () => send({ t: 'c_fanswer', uid: u, ok: true });
        no.onclick = () => { send({ t: 'c_fanswer', uid: u, ok: false }); delete reqs[u]; saveReqs(); renderList(); };
        row.append(yes, no); L.appendChild(row);
      }
    }
    L.appendChild(section('Direct messages'));
    const fl = Object.entries(friends).sort((a, b) => (online.has(b[0]) - online.has(a[0])) || a[1].name.localeCompare(b[1].name));
    if (!fl.length) L.appendChild(el('div', 'ec-empty', 'No friends yet. Add one with their friend code, or click Add friend on a message in a channel.'));
    for (const [u, f] of fl) L.appendChild(item('d:' + u, f.name, { dot: online.has(u), unread: (convos['d:' + u] || {}).unread || 0 }));
    const add = el('form', 'ec-add');
    const inp = el('input', 'ec-in'); inp.placeholder = 'Friend code'; inp.maxLength = 11; inp.id = 'ecAddCode'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.setAttribute('aria-label', "Add a friend by their friend code");
    const go = el('button', 'ec-btn sm', 'Add'); go.type = 'submit';
    add.append(inp, go);
    add.onsubmit = e => { e.preventDefault(); const c = inp.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); if (c) { send({ t: 'c_freq', to: c }); inp.value = ''; } };
    L.appendChild(add);
    L.appendChild(section('Groups', { title: 'New group chat', click: newGroup }));
    const gl = Object.entries(groups);
    if (!gl.length) L.appendChild(el('div', 'ec-empty', 'Make a group chat with your friends with +.'));
    for (const [g, x] of gl) L.appendChild(item('g:' + g, x.name, { hash: '◆', unread: (convos['g:' + g] || {}).unread || 0 }));
    L.scrollTop = scroll;
    if (typing != null) { const i = $('ecAddCode'); i.value = typing; i.focus(); }
  }
  function renderTop() {
    const acts = $('ecActs'); acts.innerHTML = '';
    const btn = (t, f) => { const b = el('button', 'ec-link', t); b.type = 'button'; b.onclick = f; acts.appendChild(b); };
    const lock = $('ecLock');
    if (cur.startsWith('c:')) {
      const c = channels.find(x => 'c:' + x.id === cur) || {};
      $('ecTitle').textContent = (c.id === 'news' ? '📣 ' : '# ') + (c.name || '');
      $('ecSub').textContent = `${c.desc || ''} · ${onlineN} online`;
      lock.className = 'ec-lock pub'; lock.textContent = 'Public';
      lock.title = 'Everyone in the chat can read channels';
    } else if (cur.startsWith('d:')) {
      const u = cur.slice(2), f = friends[u] || { name: '?' };
      $('ecTitle').textContent = f.name;
      $('ecSub').textContent = (online.has(u) ? 'Online' : 'Offline') + ' · friend code ' + fmtCode(u);
      lock.className = 'ec-lock'; lock.textContent = 'Encrypted';
      lock.title = 'End-to-end encrypted: only you and ' + f.name + ' can read this';
      if (f.stale) { $('ecSub').textContent = 'Friendship needs renewing: send a request and they accept'; btn('Renew', () => send({ t: 'c_freq', to: u })); }
      btn('Unfriend', () => { if (confirm(`Remove ${f.name} as a friend? You won't be able to DM each other.`)) unfriend(u); });
      btn('Block', () => { if (confirm(`Block ${f.name}? You won't see their messages anywhere, and they're removed as a friend.`)) block(u, f.name); });
    } else {
      const g = groups[cur.slice(2)] || { name: '', members: {} };
      const names = Object.entries(g.members).map(([u, x]) => u === uid ? 'You' : x.name);
      $('ecTitle').textContent = g.name;
      $('ecSub').textContent = `${names.length} people · ${names.join(', ')}`;
      lock.className = 'ec-lock'; lock.textContent = 'Encrypted';
      lock.title = 'End-to-end encrypted: only the people in this group can read it';
      btn('Add', () => addToGroup(cur.slice(2)));
      btn('Leave', () => { if (confirm(`Leave ${g.name}?`)) leaveGroup(cur.slice(2)); });
    }
    const ro = cur === 'c:news' && !owner;
    $('ecSendRow').classList.toggle('ec-hidden', ro);
    $('ecRO').classList.toggle('ec-hidden', !ro);
    $('ecRO').textContent = ro ? 'Only the EduArcade team can post announcements.' : '';
  }
  function openConv(id, keep) {
    if (!convExists(id)) id = 'c:general';
    if (id !== cur) setReply(null);
    cur = id;
    if (id.startsWith('c:')) chUnread[id] = 0; else if (convos[id]) { convos[id].unread = 0; saveConvos(); }
    renderTop(); renderList();
    const log = $('ecLog'); log.innerHTML = '';
    const list = id.startsWith('c:') ? chLogs[id] || [] : (convos[id] || { msgs: [] }).msgs;
    let day = '';
    for (const x of list) {
      const d = new Date(x.at).toDateString();
      if (d !== day && !id.startsWith('c:')) { day = d; log.appendChild(el('div', 'day', d === new Date().toDateString() ? 'Today' : 'Yesterday')); }
      addMsg(x, true);
    }
    if (!list.length) log.appendChild(el('div', 'sys', id.startsWith('c:') ? 'No messages yet. Say hi!' : 'No messages in the last 24 hours.'));
    log.scrollTop = log.scrollHeight;
    if (!keep) { $('ecApp').classList.add('chatting'); if (matchMedia('(min-width: 761px)').matches) $('ecMsg').focus({ preventScroll: true }); }
  }
  function addMsg(x, bulk) {
    const log = $('ecLog');
    const atBottom = bulk || log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const only = log.children.length === 1 && log.firstChild;
    if (!bulk && only && only.classList.contains('sys') && !only.dataset.k) log.innerHTML = '';
    if (x.sys) { const s = el('div', 'sys', x.text); s.dataset.k = '1'; log.appendChild(s); }
    else {
      if (blocked.has(x.uid)) return;
      const line = el('div', 'm' + (x.pending ? ' pending' : ''));
      if (x.reply) line.appendChild(el('span', 'ec-quote', `↪ ${x.reply.from}: ${x.reply.text}`));
      line.appendChild(el('time', '', new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
      if (x.owner) line.appendChild(el('span', 'tagt', 'TEAM'));
      const crs = crGames(x.cr);
      if (crs.length) {
        const tag = el('span', 'tagc'); tag.innerHTML = Ranked.emblem(Ranked.CHALLENGER, 13);
        tag.appendChild(document.createTextNode('CHALLENGER'));
        tag.title = 'Challenger (top 3 on the leaderboard) in ' + crs.map(g => Ranked.CR_GAMES[g].name).join(', ');
        line.appendChild(tag);
      }
      const nm = el('b', 'who', x.from); nm.style.color = `hsl(${hue(x.uid || x.from)},75%,72%)`;
      nm.title = x.mine ? 'You' : 'Click to mention';
      nm.onclick = () => { if (!x.mine) mention(x.from); };
      line.appendChild(nm);
      if (x.gif && GIFS.byId[x.gif]) { const pre = el('pre', 'ec-gif'); pre.dataset.gif = x.gif; pre.textContent = GIFS.byId[x.gif].frames[0]; line.appendChild(pre); startGifs(); }
      else { const span = el('span'); ChatAlerts.renderText(span, x.text || '', me.name); line.appendChild(span); }
      if (!x.mine && ChatAlerts.mentions(x.text, me.name)) line.classList.add('ping');
      const acts = el('span', 'mact');
      const a = (t, f) => { const b = el('button', '', t); b.type = 'button'; b.onclick = f; acts.appendChild(b); };
      if (!x.pending) a('Reply', () => setReply(x));
      if (!x.mine && x.uid) {
        if (cur.startsWith('c:') && !friends[x.uid]) a('Add friend', () => send({ t: 'c_freq', to: x.uid }));
        if (cur.startsWith('c:')) a('Report', () => { if (confirm(`Report this message from ${x.from}?\n\n"${x.text || '[GIF]'}"`)) send({ t: 'c_report', ch: cur.slice(2), id: x.id }); });
        a('Block', () => { if (confirm(`Block ${x.from}? You won't see their messages anywhere${friends[x.uid] ? ", and they're removed as a friend" : ''}.`)) block(x.uid, x.from); });
      }
      if (acts.children.length) {
        line.appendChild(acts);
        // Touch screens have no hover: tap a message to show its buttons
        line.addEventListener('click', e => {
          if (e.target.closest('button, b.who')) return;
          const was = line.classList.contains('sel');
          for (const o of log.querySelectorAll('.m.sel')) o.classList.remove('sel');
          if (!was) line.classList.add('sel');
        });
      }
      log.appendChild(line);
    }
    while (log.children.length > 250) log.firstChild.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  function mention(n) {
    const i = $('ecMsg');
    i.value = (i.value && !i.value.endsWith(' ') ? i.value + ' ' : i.value) + '@' + n + ' ';
    i.focus(); left();
  }
  function setReply(x) {
    replyTo = x;
    $('ecReply').classList.toggle('ec-hidden', !x);
    if (x) { $('ecReplyText').textContent = `Replying to ${x.from}: ${x.text || '[GIF]'}`; $('ecMsg').focus(); }
  }
  // ASCII GIFs play while they're on screen
  let gifT = 0, gifTick = 0;
  function startGifs() {
    if (gifT) return;
    gifT = setInterval(() => {
      const pres = document.querySelectorAll('.ec-gif');
      if (!pres.length) { clearInterval(gifT); gifT = 0; return; }
      gifTick++;
      for (const p of pres) { const g = GIFS.byId[p.dataset.gif]; if (g) p.textContent = g.frames[Math.floor(gifTick * 100 / g.ms) % g.frames.length]; }
    }, 100);
  }
  function gifPicker() {
    const box = $('ecGifs');
    if (!box.classList.contains('ec-hidden')) { box.classList.add('ec-hidden'); return; }
    box.innerHTML = '';
    for (const g of GIFS.list) {
      const b = el('button'); b.type = 'button';
      b.append(el('pre', '', g.frames[0]), el('span', '', g.name));
      b.onclick = () => { box.classList.add('ec-hidden'); sendMsg(g.id); };
      box.appendChild(b);
    }
    box.classList.remove('ec-hidden');
  }

  // ── Friends and groups ──
  function unfriend(u) {
    send({ t: 'c_unfriend', uid: u });
    delete friends[u]; online.delete(u); saveFriends();
    if (cur === 'd:' + u) openConv('c:general', true); else renderList();
  }
  function block(u, name) {
    blocked.add(u); saveBlocked();
    if (friends[u]) unfriend(u);
    delete reqs[u]; saveReqs();
    openConv(cur, true);
    err(`${name} is blocked. You won't see their messages.`, true);
  }
  function dialog(title, body, okText, onOk) {
    const d = $('ecDlg'); d.innerHTML = '';
    d.append(el('h3', '', title), body);
    const row = el('div', 'ec-dlg-row'), cancel = el('button', 'ec-btn sm ghost', 'Cancel'), ok = el('button', 'ec-btn sm', okText);
    cancel.type = ok.type = 'button';
    cancel.onclick = () => d.close();
    ok.onclick = () => { if (onOk() !== false) d.close(); };
    row.append(cancel, ok); d.appendChild(row);
    d.showModal();
  }
  function friendPicks(exclude) {
    const box = el('div', 'ec-picks');
    const list = Object.entries(friends).filter(([u]) => !exclude.includes(u));
    if (!list.length) box.appendChild(el('div', 'ec-empty', exclude.length ? 'All your friends are already in it.' : 'Add some friends first.'));
    for (const [u, f] of list) {
      const l = el('label'), c = el('input'); c.type = 'checkbox'; c.value = u;
      l.append(c, el('span', '', f.name)); box.appendChild(l);
    }
    return box;
  }
  function newGroup() {
    const body = el('div'), name = el('input', 'ec-in'); name.placeholder = 'Group name'; name.maxLength = 32;
    const picks = friendPicks([]);
    body.append(name, picks);
    dialog('New group chat', body, 'Create', () => {
      const chosen = [...picks.querySelectorAll('input:checked')].map(c => c.value);
      if (!chosen.length) return false;
      send({ t: 'c_gnew', name: name.value.trim() || 'Group chat', members: chosen.map(u => ({ uid: u, name: friends[u].name, pub: friends[u].pub })) });
    });
  }
  function addToGroup(gid) {
    const g = groups[gid]; if (!g) return;
    const picks = friendPicks(Object.keys(g.members));
    dialog(`Add to ${g.name}`, picks, 'Add', () => {
      for (const c of picks.querySelectorAll('input:checked')) {
        const u = c.value, f = friends[u];
        send({ t: 'c_gadd', gid, tok: g.tok, members: Object.keys(g.members), name: g.name, add: { uid: u, name: f.name, pub: f.pub },
          infos: Object.entries(g.members).map(([x, m]) => ({ uid: x, name: m.name, pub: m.pub })) });
      }
    });
  }
  function leaveGroup(gid) {
    const g = groups[gid]; if (!g) return;
    send({ t: 'c_gleave', gid, tok: g.tok, members: Object.keys(g.members) });
    delete groups[gid]; delete convos['g:' + gid]; saveGroups(); saveConvos();
    openConv('c:general', true);
  }

  // ── Starting up ──
  async function enter(name) {
    if (!me || !me.key) {
      const a = new Uint8Array(24); crypto.getRandomValues(a);
      me = { key: toB64(a).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), name };
    }
    me.name = name; store('edu-chat-me', me);
    try { await loadKeys(); } catch (e) { K.priv = null; K.pub = null; }
    prune();
    active = true;
    if (ws && ws.readyState === 1) hello(); else connect();
  }
  let oldName = ''; try { oldName = localStorage.getItem('edu-chat-name') || ''; } catch (e) { }
  $('ecName').value = (me && me.name) || oldName;
  $('ecEnter').onclick = () => {
    const name = $('ecName').value.replace(/\s+/g, ' ').trim();
    if (name.length < 2) { $('ecJoinErr').textContent = 'Pick a name with at least 2 characters'; return; }
    $('ecJoinErr').textContent = '';
    if (ChatAlerts.enabled) ChatAlerts.askPermission();
    enter(name);
  };
  $('ecName').addEventListener('keydown', e => { if (e.key === 'Enter') $('ecEnter').click(); });
  $('ecRename').onclick = () => { stop(); showApp(false); status(''); $('ecName').focus(); };
  $('ecCode').onclick = () => { try { navigator.clipboard.writeText(fmtCode(uid)); err('Friend code copied', true); } catch (e) { } };
  $('ecBack').onclick = () => $('ecApp').classList.remove('chatting');
  $('ecSend').onclick = () => sendMsg();
  $('ecGifBtn').onclick = gifPicker;
  $('ecReplyX').onclick = () => setReply(null);
  $('ecMsg').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendMsg(); } else if (e.key === 'Escape') setReply(null); });
  const left = () => { const n = MAX - $('ecMsg').value.length; $('ecLeft').textContent = n <= 50 ? n : ''; $('ecLeft').classList.toggle('low', n <= 15); };
  $('ecMsg').addEventListener('input', left);
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#ecGifs, #ecGifBtn')) $('ecGifs').classList.add('ec-hidden'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !cur.startsWith('c:') && convos[cur] && convos[cur].unread) openConv(cur, true); });
  function bell() {
    const on = ChatAlerts.enabled;
    $('ecBell').textContent = on ? 'Alerts on' : 'Alerts off';
    $('ecBell').classList.toggle('on', on);
    $('ecBell').title = 'Sound, tab badge and a desktop popup for DMs, group messages, friend requests and @mentions';
  }
  $('ecBell').onclick = () => { ChatAlerts.setEnabled(!ChatAlerts.enabled); if (ChatAlerts.enabled) ChatAlerts.askPermission(); bell(); };
  bell();
  // Been here before: reconnect straight away, so DMs and friend requests arrive while the page is open
  if (me && me.key && me.name) enter(me.name);
})();

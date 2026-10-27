// EduArcade Chatroom. Connects only when you press "Enter Chatroom".
// Messages are end-to-end encrypted. Each visit makes a fresh P-256 key pair. Every message gets its
// own AES-GCM key, wrapped separately for each person in the room with a key derived from ECDH, so the
// server only relays ciphertext it can't read. The safety filter (chat-safety.js) runs before a message
// is sent and again on every message received. Reporting a message hands its key to the server so the
// report can be checked. Nothing is saved.
(() => {
  // Only encrypted connections, except a test server on this computer
  const param = new URLSearchParams(location.search).get('server');
  const SERVER = param && /^(wss:\/\/|ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/.test(param) ? param : 'wss://frontier-server.onrender.com';
  const $ = id => document.getElementById(id);
  let ws = null, me = null, room = null, wantRoom = null, retry = 1000, retryT = null, active = false, refreshT = null, helloT = null;
  let queue = Promise.resolve();
  const muted = new Set();
  try { $('crName').value = localStorage.getItem('edu-chat-name') || ''; } catch (e) { }

  // ── Encryption ──
  const subtle = window.isSecureContext && window.crypto && crypto.subtle;
  const E2E = {
    on: false,             // true once the server confirms it relays encrypted messages
    pair: null, pub: null, // this visit's key pair
    pubs: new Map(),       // uid -> public key, kept after people leave so late messages still open
    wrap: new Map(),       // public key -> promise of the AES-KW key shared with that person
    msgKeys: new Map(),    // message id -> raw message key, only used for reports
  };
  const te = new TextEncoder(), td = new TextDecoder();
  const toB64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const aad = (roomId, uid) => te.encode(roomId + '|' + uid);

  async function makeKeys() {
    if (!subtle || E2E.pair) return;
    E2E.pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    E2E.pub = toB64(await subtle.exportKey('raw', E2E.pair.publicKey));
  }
  function wrapKey(pub) {
    if (!E2E.wrap.has(pub)) {
      E2E.wrap.set(pub, (async () => {
        const theirs = await subtle.importKey('raw', fromB64(pub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const bits = await subtle.deriveBits({ name: 'ECDH', public: theirs }, E2E.pair.privateKey, 256);
        const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode('eduarcade-chat-wrap-v1') },
          hk, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
      })());
    }
    return E2E.wrap.get(pub);
  }
  async function seal(text) {
    const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(room.id, me.uid) }, key, te.encode(text));
    const keys = {};
    for (const m of room.members || []) {
      if (!m.pub) continue;
      keys[m.uid] = toB64(await subtle.wrapKey('raw', key, await wrapKey(m.pub), 'AES-KW'));
    }
    return { iv: toB64(iv), ct: toB64(ct), keys };
  }
  async function open(x, roomId) {
    const pub = E2E.pubs.get(x.uid);
    if (!pub || !x.key) return null;
    try {
      const key = await subtle.unwrapKey('raw', fromB64(x.key), await wrapKey(pub), 'AES-KW', 'AES-GCM', true, ['decrypt']);
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(x.iv), additionalData: aad(roomId, x.uid) }, key, fromB64(x.ct));
      E2E.msgKeys.set(x.id, toB64(await subtle.exportKey('raw', key)));
      while (E2E.msgKeys.size > 200) E2E.msgKeys.delete(E2E.msgKeys.keys().next().value);
      return td.decode(pt);
    } catch (e) { return null; }
  }
  // Every received message goes through the safety filter before it's shown
  async function reveal(x) {
    const raw = await open(x, room.id);
    if (raw == null) return { ...x, sys: true, text: `A message from ${x.from} couldn't be decrypted` };
    const f = ChatSafety.filterMessage(raw);
    if (!f.ok) return { ...x, sys: true, text: `A message from ${x.from} was hidden by the safety filter` };
    return { ...x, text: f.text, enc: true };
  }
  function lock() {
    const el = $('crLock');
    el.classList.toggle('off', !E2E.on);
    el.textContent = E2E.on ? 'End-to-end encrypted' : 'Not encrypted';
    el.title = E2E.on
      ? 'Only people in this room can read messages. The server relays them without being able to read them.'
      : (subtle ? "The chat server hasn't been updated for encryption yet, so messages are protected in transit only."
                : "This browser can't encrypt messages, so they're protected in transit only.");
  }

  // ── Connection ──
  const show = step => { for (const id of ['crJoin', 'crRooms', 'crChat']) $(id).classList.toggle('cr-hidden', id !== step); };
  const status = t => { $('crStatus').textContent = t; };
  const err = (id, t, ok) => { $(id).textContent = t || ''; $(id).classList.toggle('ok', !!ok); };
  const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const hello = () => send({ t: 'c_hello', name: $('crName').value.trim(), over13: true, pub: E2E.pub || undefined });

  function connect() {
    if (ws && ws.readyState <= 1) return;
    clearTimeout(retryT);
    status('Connecting… the chat server can take up to a minute to wake up.');
    try { ws = new WebSocket(SERVER); } catch (e) { status("Couldn't reach the chat server."); return; }
    ws.onopen = () => {
      retry = 1000; status('Connected');
      hello();
      // An older server without chat never answers
      clearTimeout(helloT);
      helloT = setTimeout(() => { stop(); show('crJoin'); err('crJoinErr', "The chatroom isn't available right now. Try again later."); status(''); }, 10000);
    };
    // Messages are handled one at a time, in order, because decrypting is asynchronous
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      queue = queue.then(() => onMsg(m)).catch(x => console.error(x));
    };
    ws.onclose = () => {
      ws = null;
      if (!active) return;
      status('Disconnected. Reconnecting…');
      retryT = setTimeout(connect, retry);
      retry = Math.min(15000, retry * 1.7);
    };
  }
  function stop() { active = false; clearInterval(refreshT); if (ws) { try { ws.close(); } catch (e) { } } ws = null; }

  async function onMsg(m) {
    if (m.t && m.t.startsWith('c_')) clearTimeout(helloT);
    switch (m.t) {
      case 'c_welcome':
        me = { name: m.name };
        E2E.on = !!(m.e2ee && E2E.pub);
        lock();
        try { localStorage.setItem('edu-chat-name', m.name); } catch (e) { }
        $('crMe').textContent = m.name;
        renderRooms(m.rooms);
        if (wantRoom) { send(wantRoom.code ? { t: 'c_code', code: wantRoom.code } : { t: 'c_join', id: wantRoom.id }); }
        else show('crRooms');
        clearInterval(refreshT);
        refreshT = setInterval(() => { if (!room) send({ t: 'c_list' }); }, 5000);
        break;
      case 'c_denied':
        stop(); show('crJoin'); err('crJoinErr', m.msg); status('');
        break;
      case 'c_kicked':
        stop(); room = null; wantRoom = null; show('crJoin'); err('crJoinErr', m.msg); status('');
        break;
      case 'c_rooms': renderRooms(m.rooms); break;
      case 'c_you': me = { name: m.name, uid: m.uid }; break;
      case 'c_room':
        room = m; wantRoom = { id: m.id, code: m.code };
        for (const x of m.members || []) if (x.pub) E2E.pubs.set(x.uid, x.pub);
        renderRoom(); show('crChat'); err('crRoomsErr', '');
        break;
      case 'c_history':
        $('crLog').innerHTML = '';
        for (const x of m.list) addMsg(x.t === 'c_emsg' ? await reveal(x) : x);
        if (E2E.on) addMsg({ sys: true, text: 'Messages here are end-to-end encrypted. You can read messages sent after you joined.' });
        break;
      case 'c_msg': addMsg(m, true); break;
      case 'c_emsg': if (room) addMsg(await reveal(m), true); break;
      case 'c_err':
        if (room) err('crChatErr', m.msg, m.ok);
        else { err('crRoomsErr', m.msg); if (wantRoom) { wantRoom = null; show('crRooms'); } }
        break;
    }
  }

  // ── Rendering ──
  function renderRooms(list) {
    const box = $('crPub');
    box.innerHTML = '';
    for (const r of list) {
      const b = document.createElement('button');
      b.className = 'cr-room';
      const t = document.createElement('b'); t.textContent = r.name;
      const d = document.createElement('span'); d.textContent = r.desc;
      const n = document.createElement('i'); n.textContent = `${r.users} online`;
      b.append(t, d, n);
      b.onclick = () => { err('crRoomsErr', ''); send({ t: 'c_join', id: r.id }); };
      box.appendChild(b);
    }
  }
  function renderRoom() {
    $('crTitle').textContent = room.isPublic ? room.name : 'Private room';
    $('crCodeTag').classList.toggle('cr-hidden', room.isPublic);
    $('crCodeTag').textContent = room.code || '';
    $('crCodeTag').title = 'Share this code with friends. Click to copy.';
    $('crCount').textContent = `${room.users.length} online`;
    const u = $('crUsers');
    u.innerHTML = '';
    const head = document.createElement('div'); head.className = 'cr-lbl'; head.textContent = 'In this room'; u.appendChild(head);
    for (const n of room.users) {
      const d = document.createElement('div');
      d.textContent = n + (me && n === me.name ? ' (you)' : '');
      d.style.color = `hsl(${hue(n)},75%,72%)`;
      d.title = 'Click to mention';
      d.onclick = () => mention(n);
      u.appendChild(d);
    }
  }
  // Click a name to start a message with @name
  function mention(n) {
    if (me && n === me.name) return;
    const i = $('crMsg');
    i.value = (i.value && !i.value.endsWith(' ') ? i.value + ' ' : i.value) + '@' + n + ' ';
    i.focus();
  }
  function bell() {
    const on = ChatAlerts.enabled, perm = ChatAlerts.permission();
    $('crBell').textContent = on ? 'Alerts on' : 'Alerts off';
    $('crBell').classList.toggle('on', on);
    $('crBell').title = on && perm === 'denied'
      ? 'Popups are blocked in your browser settings, so you get the sound and tab badge only'
      : 'Sound, tab badge and a desktop popup when someone writes @yourname';
  }
  function addMsg(x, live) {
    const log = $('crLog');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const line = document.createElement('div');
    if (x.sys) { line.className = 'sys'; line.textContent = x.text; }
    else {
      if (muted.has(x.uid)) return;
      const mine = me && x.uid === me.uid;
      line.className = 'm' + (mine ? ' me' : '');
      line.dataset.uid = x.uid;
      const tm = document.createElement('time');
      tm.textContent = new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const nm = document.createElement('b');
      nm.textContent = x.from;
      nm.style.color = `hsl(${hue(x.from)},75%,72%)`;
      nm.onclick = () => mention(x.from);
      line.append(tm, nm);
      ChatAlerts.renderText(line, x.text, me && me.name);
      if (!x.enc && E2E.on) {
        const p = document.createElement('span'); p.className = 'plain'; p.textContent = 'not encrypted';
        p.title = 'Sent from an older version of the page, so the server could read it';
        line.appendChild(p);
      }
      if (!mine && me && ChatAlerts.mentions(x.text, me.name)) {
        line.classList.add('ping');
        if (live) ChatAlerts.notify(x.from, x.text, room && room.isPublic ? room.name : 'a private room');
      }
      if (!mine) {
        const acts = document.createElement('span'); acts.className = 'acts';
        const mu = document.createElement('button'); mu.textContent = 'Mute';
        mu.onclick = () => {
          muted.add(x.uid);
          for (const l of [...log.querySelectorAll('.m')]) if (l.dataset.uid === x.uid) l.remove();
          const s = document.createElement('div'); s.className = 'sys'; s.textContent = `${x.from} is muted for you`; log.appendChild(s);
        };
        const rp = document.createElement('button'); rp.textContent = 'Report';
        rp.onclick = () => {
          if (!confirm(`Report this message from ${x.from}?\n\n"${x.text}"\n\nReporting shares this one message with the EduArcade team.`)) return;
          send(x.enc ? { t: 'c_report', id: x.id, key: E2E.msgKeys.get(x.id) } : { t: 'c_report', id: x.id });
        };
        acts.append(mu, rp);
        line.appendChild(acts);
      }
    }
    log.appendChild(line);
    while (log.children.length > 150) log.firstChild.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  async function sendMsg() {
    const t = $('crMsg').value.trim();
    if (!t) return;
    if (!ws || ws.readyState !== 1) { err('crChatErr', 'Not connected right now'); return; }
    if (E2E.on) {
      const f = ChatSafety.filterMessage(t);
      if (!f.ok) { err('crChatErr', f.reason); return; }
      try { send({ t: 'c_emsg', ...(await seal(f.text)) }); }
      catch (e) { err('crChatErr', "That message couldn't be encrypted"); return; }
    } else {
      send({ t: 'c_msg', text: t });
    }
    $('crMsg').value = ''; $('crLeft').textContent = '';
    err('crChatErr', '');
  }

  $('crEnter').onclick = async () => {
    const name = $('crName').value.trim();
    if (name.length < 2) return err('crJoinErr', 'Pick a name with at least 2 characters');
    if (!$('crAge').checked) return err('crJoinErr', 'You need to be 13 or older to use the chatroom');
    err('crJoinErr', '');
    if (ChatAlerts.enabled) ChatAlerts.askPermission();
    try { await makeKeys(); } catch (e) { E2E.pair = null; E2E.pub = null; }
    active = true; wantRoom = null;
    if (ws && ws.readyState === 1) hello(); else connect();
  };
  $('crName').addEventListener('keydown', e => { if (e.key === 'Enter') $('crEnter').click(); });
  $('crRename').onclick = () => { stop(); room = null; wantRoom = null; show('crJoin'); status(''); };
  $('crCreate').onclick = () => { err('crRoomsErr', ''); send({ t: 'c_create' }); };
  $('crJoinCode').onclick = () => {
    const code = $('crCode').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) return err('crRoomsErr', 'Codes are 4 letters');
    err('crRoomsErr', ''); send({ t: 'c_code', code });
  };
  $('crCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('crJoinCode').click(); });
  $('crLeave').onclick = () => { send({ t: 'c_leave' }); room = null; wantRoom = null; $('crLog').innerHTML = ''; show('crRooms'); };
  $('crSend').onclick = sendMsg;
  $('crBell').onclick = () => { ChatAlerts.setEnabled(!ChatAlerts.enabled); bell(); };
  bell();
  lock();
  $('crMsg').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendMsg(); } });
  // Characters left, shown once you get close to the 200 limit
  const left = () => { const n = 200 - $('crMsg').value.length; $('crLeft').textContent = n <= 50 ? n : ''; $('crLeft').classList.toggle('low', n <= 15); };
  $('crMsg').addEventListener('input', left);
  $('crCodeTag').onclick = () => { try { navigator.clipboard.writeText(room.code); err('crChatErr', 'Code copied', true); } catch (e) { } };
})();

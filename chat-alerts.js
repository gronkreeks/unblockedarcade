// Mention alerts for EduArcade chat (the home page chatroom and Frontier).
// When someone writes @yourname: a desktop notification (while the tab isn't in view), a short
// sound, and an unread badge on the tab's icon and title until you come back.
(() => {
  'use strict';
  const KEY = 'edu-chat-alerts';
  let enabled = true, unread = 0, actx = null, baseTitle = null, baseIcon = null, iconImg = null;
  try { enabled = localStorage.getItem(KEY) !== '0'; } catch (e) { }

  const NAME_CH = /[\p{L}\p{N}_]/u;
  // True if text contains "@name" as a whole mention (so @Anna doesn't fire for @Annabel).
  function mentions(text, name) {
    if (!name) return false;
    const t = String(text).toLowerCase(), n = '@' + String(name).toLowerCase();
    for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) {
      if (!NAME_CH.test(t.charAt(i + n.length))) return true;
    }
    return false;
  }
  // Append text to el, wrapping @mentions in <span class="at"> (and class "me" for you). No innerHTML.
  function renderText(el, text, myName) {
    const parts = String(text).split(/(@[\p{L}\p{N}_.\-]+)/u);
    for (const part of parts) {
      if (!part) continue;
      if (part[0] === '@' && part.length > 1) {
        const s = document.createElement('span');
        s.className = 'at' + (myName && mentions(part + ' ', myName) ? ' me' : '');
        s.textContent = part;
        el.appendChild(s);
      } else el.appendChild(document.createTextNode(part));
    }
  }

  // Sound needs a user gesture before it can play, so this is called from a button click.
  function unlock() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  }
  function ding() {
    if (!actx) return;
    const t = actx.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.09]]) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
      o.connect(g); g.connect(actx.destination);
      o.start(t + d); o.stop(t + d + 0.3);
    }
  }

  // ── Tab badge: "(2) Title" plus a red dot with the count on the favicon ──
  function iconLink() {
    let l = document.querySelector('link[rel~="icon"]');
    if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); }
    return l;
  }
  function drawBadge() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    try { if (iconImg && iconImg.complete && iconImg.naturalWidth) g.drawImage(iconImg, 0, 0, 64, 64); } catch (e) { }
    g.fillStyle = '#e8303f'; g.beginPath(); g.arc(44, 20, 19, 0, Math.PI * 2); g.fill();
    g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 26px Segoe UI, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(unread > 9 ? '9+' : String(unread), 44, 22);
    try { iconLink().href = c.toDataURL('image/png'); } catch (e) { }
  }
  function showBadge() {
    if (baseTitle === null) {
      baseTitle = document.title;
      baseIcon = iconLink().href;
      iconImg = new Image(); iconImg.onload = drawBadge; iconImg.src = baseIcon;
    }
    document.title = `(${unread}) ${baseTitle}`;
    drawBadge();
  }
  function clear() {
    unread = 0;
    if (baseTitle !== null) { document.title = baseTitle; iconLink().href = baseIcon; baseTitle = null; }
  }
  // Browsers only allow sound after the page has been clicked or typed in once
  addEventListener('pointerdown', unlock, { once: true, capture: true });
  addEventListener('keydown', unlock, { once: true, capture: true });
  const away = () => document.hidden || !document.hasFocus();
  addEventListener('focus', clear);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && document.hasFocus()) clear(); });

  // Call when a message mentions you. `where` names the place it happened, e.g. "General".
  function notify(from, text, where) {
    if (!enabled) return;
    ding();
    if (!away()) return;
    unread++;
    showBadge();
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(`${from} mentioned you${where ? ' in ' + where : ''}`, {
          body: String(text).slice(0, 140), icon: 'favicon.ico', tag: 'edu-chat-mention', renotify: true,
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch (e) { }
    }
  }
  // Ask for popup permission. Must be called from a click.
  function askPermission() {
    unlock();
    if ('Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (e) { }
    }
  }
  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) { }
    if (enabled) askPermission();
  }
  function permission() { return 'Notification' in window ? Notification.permission : 'unsupported'; }

  window.ChatAlerts = { mentions, renderText, notify, clear, unlock, askPermission, setEnabled, permission, get enabled() { return enabled; } };
})();

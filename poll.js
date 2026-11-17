// Polls on the page: <div data-poll="ranked-next"></div> becomes a vote box (server/poll.js keeps the votes).
// One vote per player (the same browser key the Challenger boards use); tap another option to change it.
// Results show once you've voted.
(function () {
  'use strict';
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Same server and player key as ranked.js
  function serverBase() {
    let p = null;
    try { p = new URLSearchParams(location.search).get('server'); } catch (e) { }
    const ws = p && /^(wss:\/\/|ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/.test(p) ? p : 'wss://api.eduarcade.online';
    return ws.replace(/^ws/, 'http').replace(/\/+$/, '');
  }
  function playerKey() {
    let k = lsGet('edu-player-key');
    if (!k || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
      const a = new Uint8Array(18); crypto.getRandomValues(a);
      k = btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      lsSet('edu-player-key', k); lsSet('edu-player-id', '');
    }
    return k;
  }
  async function playerId() {
    const have = lsGet('edu-player-id');
    if (have && /^[0-9a-f]{16}$/.test(have)) return have;
    try {
      const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('eduarcade-cr|' + playerKey()));
      const id = [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      lsSet('edu-player-id', id);
      return id;
    } catch (e) { return ''; }
  }
  async function api(path, body) {
    const r = await fetch(serverBase() + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({ error: 'Voting is offline right now.' }));
    if (!r.ok || j.error) throw new Error(j.error || 'Voting is offline right now.');
    return j;
  }

  const CSS = `
  .vote { text-align: left; background: linear-gradient(135deg, rgba(245,179,1,0.16), rgba(126,200,255,0.1)); border: 1px solid rgba(245,197,24,0.45); border-radius: 16px; padding: 0.85rem 0.95rem; color: #fff; font-family: inherit; }
  .vote-tag { font-size: 0.6rem; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; color: #ffd75e; }
  .vote-q { font-size: 1rem; font-weight: 900; margin: 0.15rem 0 0.55rem; line-height: 1.3; }
  .vote-opts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.4rem; }
  @media (min-width: 700px) { .vote.wide .vote-opts { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .vote-o { position: relative; overflow: hidden; font: inherit; text-align: left; color: #fff; font-size: 0.85rem; font-weight: 800; background: rgba(0,0,0,0.25); border: 1.5px solid rgba(255,255,255,0.18); border-radius: 11px; padding: 0.55rem 0.7rem; cursor: pointer; display: flex; justify-content: space-between; gap: 0.5rem; }
  .vote-o:hover { border-color: rgba(255,255,255,0.45); }
  .vote-o i { position: absolute; inset: 0 auto 0 0; width: 0; background: rgba(126,200,255,0.22); transition: width 0.5s ease-out; }
  .vote-o span, .vote-o b { position: relative; }
  .vote-o span { min-width: 0; overflow-wrap: anywhere; }
  .vote-o b { flex: none; }
  .vote-o.me { border-color: #ffd75e; }
  .vote-o.me i { background: rgba(255,215,94,0.3); }
  .vote-note { font-size: 0.72rem; font-weight: 700; color: rgba(255,255,255,0.62); margin-top: 0.45rem; min-height: 1em; }`;
  function injectCSS() {
    if (document.getElementById('vote-css')) return;
    const s = document.createElement('style'); s.id = 'vote-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function render(el, P, note) {
    const voted = !!P.you, total = P.total || 0;
    el.innerHTML = `<div class="vote ${el.dataset.wide ? 'wide' : ''}"><div class="vote-tag">Vote</div><div class="vote-q">${esc(P.question)}</div><div class="vote-opts">${P.options.map(o => {
      const pct = total ? Math.round(o.votes / total * 100) : 0;
      return `<button type="button" class="vote-o ${P.you === o.id ? 'me' : ''}" data-c="${esc(o.id)}" ${P.offline ? 'disabled' : ''}><i style="width:${voted ? pct : 0}%"></i><span>${esc(o.name)}${P.you === o.id ? ' ✓' : ''}</span>${voted ? `<b>${pct}%</b>` : ''}</button>`;
    }).join('')}</div><div class="vote-note">${esc(note || (voted ? `${total} vote${total === 1 ? '' : 's'} so far. Tap another game to change your vote.` : 'Pick one to vote and see the results.'))}</div></div>`;
  }

  // Shown while the server is asleep or unreachable
  const FALLBACK = { 'ranked-next': { question: 'One of the new games will get Ranked. Which one?',
    options: [['geography', 'World Pins'], ['elements', 'Element Lab'], ['spelling', 'Word Bee'], ['timeline', 'Timeline'], ['coding', 'Code Quest'], ['space', 'Space Explorer']].map(([id, name]) => ({ id, name, votes: 0 })) } };

  async function mount(el) {
    const id = el.dataset.poll;
    injectCSS();
    if (FALLBACK[id]) render(el, { ...FALLBACK[id], you: null }, 'Loading votes…');
    let P = null;
    try { P = await api(`/poll/${encodeURIComponent(id)}?me=${await playerId()}`); render(el, P); }
    catch (e) { if (FALLBACK[id]) render(el, { ...FALLBACK[id], you: null, offline: true }, e.message); return; }
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('.vote-o');
      if (!b || b.disabled || (P && P.you === b.dataset.c)) return;
      for (const x of el.querySelectorAll('.vote-o')) x.disabled = true;
      try { P = await api('/poll/vote', { poll: id, key: playerKey(), choice: b.dataset.c }); render(el, P, 'Thanks for voting! ' + `${P.total} vote${P.total === 1 ? '' : 's'} so far.`); }
      catch (e) { render(el, P, e.message); }
    });
  }
  const start = () => document.querySelectorAll('[data-poll]').forEach(mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

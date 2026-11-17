// Small helpers shared by the learning games (World Pins, Element Lab, Word Bee, Timeline).
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

  // Sound: short tones, with an on/off button (#soundBtn) remembered across the learning games
  let on = lsGet('learn-sound', true), ctx = null;
  function tone(f, d, type, vol, delay) {
    if (!on) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + 0.02);
    } catch (e) { }
  }
  const sfx = {
    ok: () => { tone(660, 0.09, 'triangle', 0.18); tone(990, 0.12, 'triangle', 0.14, 0.06); },
    no: () => tone(180, 0.22, 'square', 0.08),
    end: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.16, i * 0.11)),
  };
  function soundButton() {
    const b = $('soundBtn');
    if (!b) return;
    const paint = () => { b.textContent = on ? 'Sound on' : 'Sound off'; b.setAttribute('aria-pressed', String(on)); };
    b.onclick = () => { on = !on; lsSet('learn-sound', on); paint(); };
    paint();
  }

  // A row of option buttons (.seg) where one is picked; remembers the choice under key
  function seg(el, key, onPick) {
    let v = lsGet(key, null);
    const btns = [...el.querySelectorAll('button')];
    if (!btns.some(b => b.dataset.v === v)) v = btns[0].dataset.v;
    const paint = () => btns.forEach(b => b.classList.toggle('on', b.dataset.v === v));
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      v = b.dataset.v; lsSet(key, v); paint(); if (onPick) onPick(v);
    });
    paint();
    return () => v;
  }

  window.Learn = { $, esc, shuffle, lsGet, lsSet, sfx, soundButton, seg };
})();

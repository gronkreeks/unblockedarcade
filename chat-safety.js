// EduArcade chat safety filter, run in the browser. The chatroom is end-to-end encrypted, so the
// server can't read messages: this filter runs before a message is sent and again on every message
// received, so blocked content stays hidden even if a sender skips it.
// Keep in sync with the filter in server/chat.js (this copy is generated from it).
(function () {
'use strict';
// Roots are caught anywhere inside a word ("fucking", "bullshit"); whole words only match exactly,
// because they hide inside normal words ("class", "grape", "peacock").
// Everyday swearing (fuck, shit, damn…) is allowed. Slurs, sexual words and "kys"-style harassment are not.
const ROOTS = ['cunt', 'nigg', 'nigga', 'fagg', 'whore', 'slut', 'pussy', 'wank', 'twat', 'retard', 'porn', 'penis',
  'vagina', 'jizz', 'dildo', 'cocksuck', 'blowjob', 'handjob', 'tranny', 'kike', 'wetback', 'beaner', 'chink',
  'faggot', 'boner', 'hentai'];
const WORDS = new Set(['dick', 'dicks', 'cum', 'fag', 'fags', 'hoe', 'hoes', 'tit', 'tits', 'titty', 'titties',
  'boob', 'boobs', 'sex', 'sexy', 'sexting', 'rape', 'raped', 'raping', 'cock', 'cocks', 'kys', 'nude', 'nudes',
  'horny', 'milf', 'rapist', 'rapists', 'spic', 'coon', 'gook', 'dyke', 'nazi', 'thot', 'pedo', 'skank']);
const SHORT_ROOTS = ['cunt', 'nigg', 'fagg', 'whore', 'slut', 'pussy', 'porn', 'dick', 'cock', 'kys'];
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
const MAX_MSG = 200;
// Returns { ok, text } or { ok: false, reason }.
function filterMessage(raw) {
  // Squash runs of the same character ("!!!!!!!!", "loooooool") to 4 before applying the length cap
  let text = tidy(String(raw == null ? '' : raw).slice(0, MAX_MSG * 4).replace(/(.)\1{4,}/gu, '$1$1$1$1'), MAX_MSG);
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

window.ChatSafety = { MAX_MSG, filterMessage };
})();

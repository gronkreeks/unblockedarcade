// EduArcade chat text clean-up, run in the browser. No content rules: messages are only tidied
// (invisible characters stripped, spaces collapsed, length capped). Matches tidy() in server/chat.js.
(function () {
'use strict';
function tidy(raw, max) {
  return String(raw == null ? '' : raw)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
const MAX_MSG = 200;
// Returns { ok, text } or { ok: false, reason }.
function filterMessage(raw) {
  const text = tidy(raw, MAX_MSG);
  return text ? { ok: true, text } : { ok: false, reason: 'Type a message first' };
}
window.ChatText = Object.freeze({ MAX_MSG, filterMessage });
})();

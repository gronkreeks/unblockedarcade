// Shared server secrets: Upstash Redis (optional) and the key that signs Challenger runs and chat
// friendship / group tokens. On Render the key comes from the service id, so tokens stay valid across
// restarts with nothing to set up. Elsewhere set APP_SECRET; without anything, a fresh key is made up
// on every start (fine for testing: friendships and runs signed before a restart stop working).
// Changing APP_SECRET later breaks every friendship, so set it once or not at all.
'use strict';
const crypto = require('crypto');

const url = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, ''), token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const redis = url && token ? async cmd => {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
} : null;

// Render's service id comes first after an explicit secret: it never changes, so adding Upstash later
// doesn't make every friendship token invalid.
const base = process.env.APP_SECRET || process.env.CR_SECRET ||
  (process.env.RENDER_SERVICE_ID ? 'render|' + process.env.RENDER_SERVICE_ID : token ? 'upstash|' + token : '');
const stable = !!base;
const root = base ? crypto.createHash('sha256').update('eduarcade|' + base).digest() : crypto.randomBytes(32);
// A separate key for each use, so a token made for one thing never passes as another
const keyFor = purpose => crypto.createHmac('sha256', root).update(purpose).digest();
const signer = purpose => { const k = keyFor(purpose); return s => crypto.createHmac('sha256', k).update(s).digest('base64url').slice(0, 32); };
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = { redis, stable, signer, same };

// Plain-HTTP connections for networks that block WebSockets (school wifi filters).
// Each connection looks like a `ws` socket to the rest of the server (readyState, send, close,
// terminate, ping, and 'message' / 'close' / 'pong' events), so the games and chat don't know
// the difference. Two ways down, one way up:
//   GET  /s/stream          Server-Sent Events. The first event is `hello` with the connection id.
//                           The connection ends when this response ends.
//   POST /s/open            For networks that hold back streamed responses: returns {id}, then
//   GET  /s/poll?id=        long-polls (held up to 25 s, answered as soon as there is something to say).
//   POST /s/send?id=        Messages up: a JSON array of strings, sent in order, one request at a time.
//   POST /s/close?id=       Closes a connection straight away.
// Everything is a simple CORS request (GET, or POST with a text/plain body), so there is no preflight.
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');

const POLL_HOLD_MS = 25000;
const IDLE_MS = 45000;          // a long-poll connection with no poll for this long is dead
const MAX_QUEUE = 4000;         // messages waiting for a poll; a client this far behind is dropped
const MAX_BODY = 65536;
const MAX_MSG = 16384;          // same limit as the WebSocket server's maxPayload
const STREAM_PAD = ':' + ' '.repeat(2048) + '\n\n';   // some proxies hold the first couple of KB

class HttpConn extends EventEmitter {
  constructor(id, mode) {
    super();
    this.id = id; this.mode = mode; this.readyState = 1;
    this.stream = null; this.queue = []; this.poll = null; this.pollT = null; this.lastSeen = Date.now();
  }
  send(data) {
    if (this.readyState !== 1) return;
    data = String(data);
    if (this.stream) { this.stream.write('data: ' + data.split('\n').join('\ndata: ') + '\n\n'); return; }
    this.queue.push(data);
    if (this.queue.length > MAX_QUEUE) { this.close(); return; }
    if (this.poll) this.flushPoll();
  }
  flushPoll() {
    const res = this.poll; if (!res) return;
    this.poll = null; clearTimeout(this.pollT);
    const body = '[' + this.queue.map(s => JSON.stringify(s)).join(',') + ']';
    this.queue = [];
    res.end(body);
  }
  // The server's heartbeat calls ping() every 20 s and drops connections that don't answer with 'pong'
  ping() {
    if (this.readyState !== 1) return;
    if (this.stream) { this.stream.write(': ping\n\n'); setImmediate(() => this.emit('pong')); return; }
    if (this.poll || Date.now() - this.lastSeen < IDLE_MS) setImmediate(() => this.emit('pong'));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.stream) { try { this.stream.end(); } catch (e) { } this.stream = null; }
    if (this.poll) { clearTimeout(this.pollT); try { this.poll.writeHead(410).end(); } catch (e) { } this.poll = null; }
    this.queue = [];
    this.emit('close');
  }
  terminate() { this.close(); }
}

// opts: { originAllowed(origin), canOpen(), onConnection(conn, req) }
function createHttpTransport(opts) {
  const conns = new Map();
  const newConn = (mode, req) => {
    const conn = new HttpConn(crypto.randomBytes(16).toString('hex'), mode);
    conns.set(conn.id, conn);
    conn.on('close', () => conns.delete(conn.id));
    opts.onConnection(conn, req);
    return conn;
  };
  const cors = (req, res) => {
    const origin = req.headers.origin;
    if (origin && origin !== 'null') { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Cache-Control', 'no-store, no-transform');
  };
  const readBody = (req, cb) => {
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { req.destroy(); return; } parts.push(c); });
    req.on('end', () => { if (size <= MAX_BODY) cb(Buffer.concat(parts).toString('utf8')); });
  };

  // Returns true if it handled the request
  function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/s/')) return false;
    cors(req, res);
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); res.writeHead(204).end(); return true; }
    if (!opts.originAllowed(req.headers.origin)) { res.writeHead(403).end(); return true; }
    const id = url.searchParams.get('id') || '';
    const conn = id && conns.get(id);

    switch (url.pathname) {
      case '/s/stream': {
        if (req.method !== 'GET') break;
        if (!opts.canOpen()) { res.writeHead(503).end(); return true; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
        res.socket && res.socket.setNoDelay(true);
        const c = newConn('stream', req);
        res.write(STREAM_PAD + 'retry: 86400000\nevent: hello\ndata: ' + c.id + '\n\n');
        c.stream = res;
        for (const m of c.queue.splice(0)) c.send(m);   // anything said during 'connection'
        res.on('close', () => { if (c.stream === res) { c.stream = null; c.close(); } });
        return true;
      }
      case '/s/open': {
        if (req.method !== 'POST') break;
        if (!opts.canOpen()) { res.writeHead(503).end(); return true; }
        const c = newConn('poll', req);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: c.id }));
        return true;
      }
      case '/s/poll': {
        if (req.method !== 'GET') break;
        if (!conn || conn.mode !== 'poll') { res.writeHead(410).end(); return true; }
        conn.lastSeen = Date.now();
        if (conn.poll) { const old = conn.poll; conn.poll = null; clearTimeout(conn.pollT); old.end('[]'); }
        res.setHeader('Content-Type', 'application/json');
        conn.poll = res;
        res.on('close', () => { if (conn.poll === res) { conn.poll = null; clearTimeout(conn.pollT); conn.lastSeen = Date.now(); } });
        if (conn.queue.length) conn.flushPoll();
        else conn.pollT = setTimeout(() => { if (conn.poll === res) conn.flushPoll(); }, POLL_HOLD_MS);
        return true;
      }
      case '/s/send': {
        if (req.method !== 'POST') break;
        if (!conn) { res.writeHead(410).end(); return true; }
        readBody(req, body => {
          let list; try { list = JSON.parse(body); } catch (e) { list = null; }
          if (!Array.isArray(list)) { res.writeHead(400).end(); return; }
          if (conn.mode === 'poll') conn.lastSeen = Date.now();
          for (const m of list) {
            if (conn.readyState !== 1) break;
            if (typeof m === 'string' && m.length <= MAX_MSG) conn.emit('message', m);
          }
          res.writeHead(conn.readyState === 1 ? 204 : 410).end();
        });
        return true;
      }
      case '/s/close': {
        if (conn) conn.close();
        res.writeHead(204).end();
        return true;
      }
    }
    res.writeHead(404).end();
    return true;
  }
  return { handle, count: () => conns.size };
}

module.exports = { createHttpTransport };

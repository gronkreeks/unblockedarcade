// EduSocket: works like a WebSocket, but over plain HTTP, so it gets through school wifi that
// blocks WebSockets. new EduSocket('wss://api.eduarcade.online') gives the usual readyState,
// send(), close(), onopen, onmessage (e.data) and onclose.
// Messages come down as a streamed page (Server-Sent Events). If a filter holds the stream back,
// it switches to asking every moment instead (long-polling) and remembers that for 12 hours.
// Messages go up as ordinary POSTs, in order, batched while one is on its way.
// The server side is server/http-transport.js.
(function () {
  'use strict';
  const MODE_KEY = 'edu-net-poll';
  const POLL_MEMORY_MS = 12 * 3600e3;
  const STREAM_WAIT_MS = 5000;
  const usePoll = () => { try { return Date.now() - (+localStorage.getItem(MODE_KEY) || 0) < POLL_MEMORY_MS; } catch (e) { return false; } };
  const rememberPoll = on => { try { on ? localStorage.setItem(MODE_KEY, String(Date.now())) : localStorage.removeItem(MODE_KEY); } catch (e) { } };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  class EduSocket {
    constructor(url) {
      this.url = String(url);
      this.base = this.url.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
      this.readyState = 0;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this.id = null; this.es = null; this.poller = null; this.out = []; this.sending = false; this.closeAfterSend = false;
      if (usePoll() || typeof EventSource === 'undefined') this._openPoll(); else this._openStream();
    }

    // ── down: streamed ──
    _openStream() {
      let es;
      try { es = new EventSource(this.base + '/s/stream'); } catch (e) { this._openPoll(); return; }
      this.es = es;
      const slow = setTimeout(() => {
        // Nothing arrived: something on the network is holding the stream back
        if (this.es !== es || this.readyState !== 0) return;
        es.close(); this.es = null; rememberPoll(true); this._openPoll();
      }, STREAM_WAIT_MS);
      es.addEventListener('hello', e => {
        clearTimeout(slow);
        if (this.es !== es || this.readyState !== 0) { es.close(); return; }
        this.id = e.data; rememberPoll(false); this._opened();
      });
      es.onmessage = e => { if (this.es === es) this._deliver(e.data); };
      es.onerror = () => {
        clearTimeout(slow); es.close();
        if (this.es !== es) return;
        this.es = null;
        if (this.readyState === 0) this._openPoll(); else this._closed();
      };
    }

    // ── down: long-polling ──
    async _openPoll() {
      if (this.readyState !== 0) return;
      try {
        const r = await fetch(this.base + '/s/open', { method: 'POST', body: '', cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        this.id = (await r.json()).id;
      } catch (e) { this._closed(); return; }
      if (this.readyState !== 0) { this._sendClose(); return; }
      this._opened();
      let fails = 0;
      while (this.readyState === 1) {
        const ctrl = new AbortController(); this.poller = ctrl;
        const giveUp = setTimeout(() => ctrl.abort(), 35000);
        try {
          const r = await fetch(this.base + '/s/poll?id=' + this.id, { cache: 'no-store', signal: ctrl.signal });
          if (r.status === 410) { clearTimeout(giveUp); this._closed(); return; }
          if (!r.ok) throw new Error(r.status);
          const list = await r.json();
          clearTimeout(giveUp); fails = 0;
          for (const m of list) { if (this.readyState !== 1) return; this._deliver(m); }
        } catch (e) {
          clearTimeout(giveUp);
          if (this.readyState !== 1) return;
          if (++fails >= 3) { this._closed(); return; }
          await wait(1000);
        }
      }
    }

    // ── up ──
    send(data) {
      if (this.readyState !== 1) return;
      this.out.push(String(data));
      this._flush();
    }
    async _flush() {
      if (this.sending || !this.id) return;
      if (!this.out.length) { if (this.closeAfterSend) { this.closeAfterSend = false; this._sendClose(); this._closed(); } return; }
      this.sending = true;
      const body = JSON.stringify(this.out.splice(0, 100));
      let gone = false;
      try {
        const r = await fetch(this.base + '/s/send?id=' + this.id, { method: 'POST', body, cache: 'no-store', keepalive: body.length < 60000 });
        gone = r.status === 410;
      } catch (e) { gone = true; }   // the network dropped: same as a WebSocket closing
      this.sending = false;
      if (gone) { this.out = []; this._closed(); return; }
      this._flush();
    }

    close() {
      if (this.readyState >= 2) return;
      if (this.readyState === 1 && (this.sending || this.out.length)) {
        // Let the last messages (like "leave") get there first
        this.readyState = 2; this.closeAfterSend = true; this._stopDown(); return;
      }
      this._sendClose(); this._closed();
    }
    _sendClose() {
      if (this.id) fetch(this.base + '/s/close?id=' + this.id, { method: 'POST', body: '', keepalive: true }).catch(() => { });
    }
    _stopDown() {
      if (this.es) { this.es.close(); this.es = null; }
      if (this.poller) { this.poller.abort(); this.poller = null; }
    }
    _opened() { this.readyState = 1; if (this.onopen) this.onopen({ type: 'open' }); if (this.out.length) this._flush(); }
    _deliver(data) { if (this.onmessage) this.onmessage({ type: 'message', data }); }
    _closed() {
      if (this.readyState === 3) return;
      this.readyState = 3; this._stopDown();
      if (this.onclose) this.onclose({ type: 'close', code: 1006, wasClean: false });
    }
  }
  EduSocket.CONNECTING = 0; EduSocket.OPEN = 1; EduSocket.CLOSING = 2; EduSocket.CLOSED = 3;
  window.EduSocket = EduSocket;
})();

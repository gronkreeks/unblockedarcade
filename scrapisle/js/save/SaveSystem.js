// Persistent worlds in IndexedDB (meta + data stores). Small settings in localStorage.
const DB = 'scrapisle', VER = 1;
const LS_SETTINGS = 'scrapisle.settings', LS_LAST = 'scrapisle.lastWorld';

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(db, stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export class SaveSystem {
  constructor() { this.dbp = null; this.busy = false; }
  db() { if (!this.dbp) this.dbp = openDB(); return this.dbp; }
  async list() {
    const db = await this.db();
    return new Promise((res, rej) => {
      const r = db.transaction('meta').objectStore('meta').getAll();
      r.onsuccess = () => res(r.result.sort((a, b) => b.updated - a.updated));
      r.onerror = () => rej(r.error);
    });
  }
  async save(meta, data) {
    if (this.busy) return false;
    this.busy = true;
    try {
      const db = await this.db();
      await tx(db, ['meta', 'data'], 'readwrite', t => { t.objectStore('meta').put(meta); t.objectStore('data').put({ id: meta.id, data }); });
      localStorage.setItem(LS_LAST, meta.id);
      return true;
    } finally { this.busy = false; }
  }
  async load(id) {
    const db = await this.db();
    return new Promise((res, rej) => {
      const r = db.transaction('data').objectStore('data').get(id);
      r.onsuccess = () => res(r.result ? r.result.data : null);
      r.onerror = () => rej(r.error);
    });
  }
  async remove(id) {
    const db = await this.db();
    await tx(db, ['meta', 'data'], 'readwrite', t => { t.objectStore('meta').delete(id); t.objectStore('data').delete(id); });
    if (localStorage.getItem(LS_LAST) === id) localStorage.removeItem(LS_LAST);
  }
  lastWorld() { return localStorage.getItem(LS_LAST); }
  loadSettings() { try { return JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}; } catch { return {}; } }
  saveSettings(s) { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); }
}

// Containers and inventory operations shared by the player, bots, boxes, furnaces, loot bags.
import { ITEMS, makeStack, hasCondition, WEAR_SLOTS } from '../data/items.js';

export class Container {
  constructor(size, opts = {}) {
    this.slots = new Array(size).fill(null);
    this.kind = opts.kind || 'generic';
    this.accept = opts.accept || null; // (itemId, index) => bool
    this.version = 0;
  }
  get size() { return this.slots.length; }
  touch() { this.version++; }
  canAccept(id, i) { return !this.accept || this.accept(id, i); }
  stackable(id) { const d = ITEMS[id]; return d && d.stack > 1 && !hasCondition(id); }

  // Add n of id. Returns how many could NOT be added.
  add(id, n = 1, extra) {
    const d = ITEMS[id];
    if (!d || n <= 0) return n;
    if (this.stackable(id)) {
      for (let i = 0; i < this.slots.length && n > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.n < d.stack) { const k = Math.min(n, d.stack - s.n); s.n += k; n -= k; }
      }
    }
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      if (this.slots[i] || !this.canAccept(id, i)) continue;
      const k = Math.min(n, d.stack);
      this.slots[i] = makeStack(id, k, extra);
      n -= k;
    }
    this.touch();
    return n;
  }
  // Insert an existing stack object (keeps condition/ammo). Returns leftover stack or null.
  addStack(stack, preferIndex = -1) {
    if (!stack) return null;
    const d = ITEMS[stack.id];
    if (this.stackable(stack.id)) {
      const left = this.add(stack.id, stack.n);
      if (left <= 0) return null;
      return { id: stack.id, n: left };
    }
    if (preferIndex >= 0 && !this.slots[preferIndex] && this.canAccept(stack.id, preferIndex)) { this.slots[preferIndex] = stack; this.touch(); return null; }
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i] && this.canAccept(stack.id, i)) { this.slots[i] = stack; this.touch(); return null; }
    }
    return stack;
  }
  count(id) { let c = 0; for (const s of this.slots) if (s && s.id === id) c += s.n; return c; }
  // Remove up to n. Returns removed count.
  remove(id, n) {
    let r = 0;
    for (let i = this.slots.length - 1; i >= 0 && r < n; i--) {
      const s = this.slots[i];
      if (s && s.id === id) { const k = Math.min(n - r, s.n); s.n -= k; r += k; if (s.n <= 0) this.slots[i] = null; }
    }
    if (r) this.touch();
    return r;
  }
  take(i) { const s = this.slots[i]; this.slots[i] = null; this.touch(); return s; }
  put(i, s) { this.slots[i] = s; this.touch(); }
  firstEmpty() { for (let i = 0; i < this.slots.length; i++) if (!this.slots[i]) return i; return -1; }
  emptyCount() { let c = 0; for (const s of this.slots) if (!s) c++; return c; }
  isEmpty() { return this.slots.every(s => !s); }
  // room for n of id (approx)
  room(id) {
    const d = ITEMS[id]; let r = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s && this.canAccept(id, i)) r += d.stack;
      else if (s && s.id === id && this.stackable(id)) r += d.stack - s.n;
    }
    return r;
  }
  totalValue() { let v = 0; for (const s of this.slots) if (s) v += (ITEMS[s.id].value || 0) * s.n; return v; }
  clear() { this.slots.fill(null); this.touch(); }
  serialize() { return this.slots.map(s => (s ? { ...s } : null)); }
  load(arr) { if (!arr) return; for (let i = 0; i < this.slots.length; i++) this.slots[i] = arr[i] ? { ...arr[i] } : null; this.touch(); }
}

export function wearAccept(id, i) {
  const d = ITEMS[id];
  return !!d && d.type === 'wear' && d.slot === WEAR_SLOTS[i];
}

// Inventory of a survivor (player or bot): main 24, belt 6, wear 8.
export class SurvivorInventory {
  constructor() {
    this.main = new Container(24, { kind: 'main' });
    this.belt = new Container(6, { kind: 'belt' });
    this.wear = new Container(WEAR_SLOTS.length, { kind: 'wear', accept: wearAccept });
  }
  get version() { return this.main.version + this.belt.version * 1000 + this.wear.version * 1000000; }
  count(id) { return this.main.count(id) + this.belt.count(id); }
  has(cost, times = 1) { for (const k in cost) if (this.count(k) < cost[k] * times) return false; return true; }
  missing(cost, times = 1) { const m = {}; for (const k in cost) { const d = cost[k] * times - this.count(k); if (d > 0) m[k] = d; } return m; }
  remove(id, n) { let r = this.main.remove(id, n); if (r < n) r += this.belt.remove(id, n - r); return r; }
  pay(cost, times = 1) { if (!this.has(cost, times)) return false; for (const k in cost) this.remove(k, cost[k] * times); return true; }
  // Give items: tools/weapons/food/med go to belt first; resources to main first. Returns leftover count.
  give(id, n = 1) {
    const d = ITEMS[id];
    const beltFirst = d && ['tool', 'melee', 'gun', 'bow', 'food', 'med', 'plan', 'hammer', 'raid', 'deploy'].includes(d.type);
    let left = n;
    if (beltFirst) { left = this.belt.add(id, left); if (left) left = this.main.add(id, left); }
    else { left = this.main.add(id, left); if (left) left = this.belt.add(id, left); }
    return left;
  }
  giveStack(stack) {
    const d = ITEMS[stack.id];
    const beltFirst = d && ['tool', 'melee', 'gun', 'bow', 'food', 'med', 'plan', 'hammer', 'raid'].includes(d.type);
    let left = beltFirst ? this.belt.addStack(stack) : this.main.addStack(stack);
    if (left) left = beltFirst ? this.main.addStack(left) : this.belt.addStack(left);
    return left;
  }
  room(id) { return this.main.room(id) + this.belt.room(id); }
  equip(stack) {
    // wear an item; returns leftover (the item itself if it could not be worn)
    const d = ITEMS[stack.id];
    if (!d || d.type !== 'wear') return stack;
    const i = WEAR_SLOTS.indexOf(d.slot);
    if (this.wear.slots[i]) return stack;
    if (this.blockedSlot(i, d)) return stack;
    this.wear.put(i, stack);
    return null;
  }
  blockedSlot(i, d) {
    // hazmat blocks other slots; other items cannot go in while a blocker is worn, and vice versa
    const slot = WEAR_SLOTS[i];
    for (const s of this.wear.slots) { if (!s) continue; const sd = ITEMS[s.id]; if (sd.blocks && sd.blocks.includes(slot)) return true; }
    if (d.blocks) for (const b of d.blocks) if (this.wear.slots[WEAR_SLOTS.indexOf(b)]) return true;
    return false;
  }
  all() { const out = []; for (const c of [this.main, this.belt, this.wear]) for (const s of c.slots) if (s) out.push(s); return out; }
  totalValue() { return this.main.totalValue() + this.belt.totalValue() + this.wear.totalValue(); }
  serialize() { return { main: this.main.serialize(), belt: this.belt.serialize(), wear: this.wear.serialize() }; }
  load(d) { if (!d) return; this.main.load(d.main); this.belt.load(d.belt); this.wear.load(d.wear); }
  // Move everything into a container (death). Returns true if something moved.
  dumpInto(cont) {
    let any = false;
    for (const c of [this.belt, this.wear, this.main]) for (let i = 0; i < c.slots.length; i++) {
      const s = c.slots[i]; if (!s) continue;
      const left = cont.addStack(s); any = true;
      c.slots[i] = left || null;
    }
    this.main.touch(); this.belt.touch(); this.wear.touch();
    return any;
  }
}

// Move/merge/swap between two slots (used by the UI). n = amount (undefined = whole stack).
export function moveSlot(from, fi, to, ti, n) {
  const s = from.slots[fi];
  if (!s) return false;
  if (from === to && fi === ti) return false;
  if (!to.canAccept(s.id, ti)) return false;
  const d = ITEMS[s.id];
  const amount = n === undefined ? s.n : Math.min(n, s.n);
  const t = to.slots[ti];
  if (!t) {
    if (amount >= s.n) { to.slots[ti] = s; from.slots[fi] = null; }
    else { to.slots[ti] = { ...s, n: amount }; s.n -= amount; }
  } else if (t.id === s.id && to.stackable(s.id)) {
    const k = Math.min(amount, d.stack - t.n);
    if (k <= 0) return false;
    t.n += k; s.n -= k; if (s.n <= 0) from.slots[fi] = null;
  } else {
    if (amount < s.n) return false;
    if (!from.canAccept(t.id, fi)) return false;
    to.slots[ti] = s; from.slots[fi] = t;
  }
  from.touch(); to.touch();
  return true;
}

export function splitSlot(cont, i) {
  const s = cont.slots[i];
  if (!s || s.n < 2) return false;
  const e = cont.firstEmpty();
  if (e < 0) return false;
  const half = Math.floor(s.n / 2);
  cont.slots[e] = { ...s, n: half }; s.n -= half;
  cont.touch();
  return true;
}

// Sort a box: merge matching stacks, then order by category (weapons first, components last),
// then by name, bigger stacks first. Items with condition or loaded ammo are kept as they are.
const SORT_CATS = ['Weapons', 'Ammo', 'Tools', 'Medical', 'Food', 'Clothing', 'Raid', 'Construction', 'Items', 'Resources', 'Components'];
export function sortContainer(cont) {
  const totals = new Map(), singles = [];
  for (const s of cont.slots) {
    if (!s) continue;
    if (cont.stackable(s.id)) totals.set(s.id, (totals.get(s.id) || 0) + s.n);
    else singles.push(s);
  }
  const stacks = [...singles];
  for (const [id, n] of totals) { const max = Math.max(1, ITEMS[id].stack || 1); for (let left = n; left > 0; left -= max) stacks.push(makeStack(id, Math.min(max, left))); }
  const rank = (id) => { const i = SORT_CATS.indexOf(ITEMS[id].cat); return i < 0 ? SORT_CATS.length : i; };
  stacks.sort((a, b) => rank(a.id) - rank(b.id) || ITEMS[a.id].name.localeCompare(ITEMS[b.id].name) || b.n - a.n);
  if (stacks.length > cont.size) return false;   // can't happen after merging, but never lose items
  cont.slots.fill(null);
  stacks.forEach((s, i) => { cont.slots[i] = s; });
  cont.touch();
  return true;
}

// Quick stack: move items from the main inventory into the given containers, but only into a
// container that already holds that item (like Rust). Belt and worn items stay. Returns how
// many items moved and how many containers took something.
export function quickStack(inv, conts) {
  let moved = 0; const used = new Set();
  for (let i = 0; i < inv.main.size; i++) {
    const s = inv.main.slots[i]; if (!s) continue;
    for (const c of conts) {
      if (!c.slots.some(x => x && x.id === s.id)) continue;
      const before = s.n;
      const left = c.addStack(s);
      const after = left ? left.n : 0;
      if (after < before) { moved += before - after; used.add(c); }
      inv.main.slots[i] = left || null;
      if (!left) break;
    }
  }
  inv.main.touch(); for (const c of used) c.touch();
  return { moved, boxes: used.size };
}

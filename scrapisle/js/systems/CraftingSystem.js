// Crafting queue, blueprint knowledge, workbench tiers, tech-tree unlocks and research.
import { RECIPE, RECIPES, researchCost } from '../data/recipes.js';
import { ITEMS } from '../data/items.js';

export const BENCH_RANGE = 4.5;

export class CraftingSystem {
  constructor(game) { this.game = game; }

  // Highest workbench tier within range of the survivor.
  benchTier(s) { return this.game.deploy ? this.game.deploy.benchTierNear(s.x, s.y, s.z, BENCH_RANGE) : 0; }

  // Why a recipe can't be crafted now, or null if it can.
  blocker(s, id, times = 1, tier = this.benchTier(s)) {
    const rc = RECIPE[id];
    if (!rc) return 'Unknown recipe';
    if (!s.bp.has(id)) return 'Blueprint not known';
    if (rc.tier > tier) return `Needs Workbench Level ${rc.tier}`;
    if (!s.inv.has(rc.cost, times)) return 'Missing resources';
    if (s.craftQueue.length >= 12) return 'Queue full';
    return null;
  }
  canCraft(s, id, times = 1) { return this.blocker(s, id, times) === null; }

  // Craft `times` batches. Resources are taken now and refunded on cancel.
  craft(s, id, times = 1) {
    const rc = RECIPE[id];
    if (this.blocker(s, id, times)) return false;
    s.inv.pay(rc.cost, times);
    for (let i = 0; i < times; i++) s.craftQueue.push({ id, left: rc.time, total: rc.time, n: rc.n, cost: rc.cost });
    this.game.events.emit('craftStart', { surv: s, id, times });
    return true;
  }
  cancel(s, index) {
    const q = s.craftQueue[index];
    if (!q) return;
    s.craftQueue.splice(index, 1);
    for (const k in q.cost) { const left = s.inv.give(k, q.cost[k]); if (left) this.game.loot.dropItem(k, left, s.x, s.y + 1, s.z); }
  }
  // Advance a survivor's queue. speed > 1 for abstract simulation.
  tick(s, dt) {
    if (!s.craftQueue.length || !s.alive) return;
    const q = s.craftQueue[0];
    q.left -= dt;
    if (q.left <= 0) {
      s.craftQueue.shift();
      const left = s.inv.give(q.id, q.n);
      if (left) this.game.loot.dropItem(q.id, left, s.x, s.y + 1, s.z);
      this.game.events.emit('crafted', { surv: s, id: q.id, n: q.n });
      if (s.craftQueue.length && q.left < 0) s.craftQueue[0].left += q.left;
    }
  }
  queuedCount(s, id) { let c = 0; for (const q of s.craftQueue) if (q.id === id) c += q.n; return c; }

  // Workbench tech tree: unlock a recipe of the bench's tier (or lower) with scrap.
  unlockCost(id) { const rc = RECIPE[id]; return rc && !rc.known ? (rc.unlock || 50) : 0; }
  canUnlock(s, id, benchTier) {
    const rc = RECIPE[id];
    if (!rc || s.bp.has(id) || rc.known) return false;
    if (rc.tier > benchTier || rc.tier === 0) return false;
    return s.inv.count('scrap') >= this.unlockCost(id);
  }
  unlock(s, id, benchTier) {
    if (!this.canUnlock(s, id, benchTier)) return false;
    s.inv.remove('scrap', this.unlockCost(id));
    s.bp.add(id);
    this.game.events.emit('unlocked', { surv: s, id });
    return true;
  }
  // Research table: consume the item + scrap to learn its blueprint.
  canResearch(s, stack) {
    if (!stack) return false;
    const rc = RECIPE[stack.id];
    if (!rc || rc.known || s.bp.has(stack.id)) return false;
    return s.inv.count('scrap') >= researchCost(stack.id);
  }
  research(s, container, slotIndex) {
    const stack = container.slots[slotIndex];
    if (!this.canResearch(s, stack)) return false;
    s.inv.remove('scrap', researchCost(stack.id));
    stack.n -= 1; if (stack.n <= 0) container.slots[slotIndex] = null;
    container.touch();
    s.bp.add(stack.id);
    this.game.events.emit('unlocked', { surv: s, id: stack.id });
    return true;
  }
  recipesByCat(cat) { return RECIPES.filter(r => (ITEMS[r.out].cat === cat)); }
}

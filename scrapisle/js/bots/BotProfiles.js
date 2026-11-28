// Bot skill tiers, difficulty distributions, personalities and names.
import { weightedPick, pick } from '../core/util.js';

export const TIERS = ['normal', 'hard', 'expert'];
// Easy bots were removed (2026-11-28): bots and clans saved as easy load as normal.
export const tierOf = (t) => (t && TIERS.includes(t) ? t : 'normal');

// Share of each skill tier for every world difficulty setting.
export const DISTRIBUTION = {
  normal: { normal: 0.72, hard: 0.21, expert: 0.07 },
  hard: { normal: 0.3, hard: 0.5, expert: 0.2 },
  expert: { normal: 0.23, hard: 0.3, expert: 0.47 },
};

// Skill parameters per tier. aimErr in radians, react in seconds. Tiers differ in how they fight
// (aim, reactions, recoil, caution); gathering, building and planning are the same for everyone.
export const SKILL = {
  normal: { aimErr: 0.016, headChance: 0.06, react: 0.55, recoilCtrl: 0.5, sight: 90, efficiency: 1, noise: 0.12, caution: 0.45, strafe: 0.5, crouch: 0.15, idle: 0.03, ambition: 1, raidRate: 0.55, teamSize: [2, 7], healAt: 45, lootGreed: 0.8, siteSkill: 0.75 },
  hard: { aimErr: 0.0115, headChance: 0.12, react: 0.42, recoilCtrl: 0.72, sight: 110, efficiency: 1, noise: 0.12, caution: 0.6, strafe: 0.75, crouch: 0.3, idle: 0.03, ambition: 1, raidRate: 0.4, teamSize: [1, 3], healAt: 55, lootGreed: 0.8, siteSkill: 0.75 },
  expert: { aimErr: 0.0088, headChance: 0.18, react: 0.34, recoilCtrl: 0.88, sight: 130, efficiency: 1, noise: 0.12, caution: 0.78, strafe: 0.9, crouch: 0.45, idle: 0.03, ambition: 1, raidRate: 0.3, teamSize: [1, 3], healAt: 60, lootGreed: 0.8, siteSkill: 0.75 },
};

// Personality shifts what a bot wants to do with its time.
export const PERSONALITIES = {
  builder: { gather: 1.35, build: 1.5, loot: 0.75, fight: 0.6, hunt: 0.9, raid: 0.8 },
  looter: { gather: 0.85, build: 0.9, loot: 1.6, fight: 1.0, hunt: 0.8, raid: 1.1 },
  fighter: { gather: 0.8, build: 0.8, loot: 1.15, fight: 1.6, hunt: 1.1, raid: 1.5 },
  hunter: { gather: 1.0, build: 1.0, loot: 0.9, fight: 1.1, hunt: 1.6, raid: 0.9 },
  balanced: { gather: 1, build: 1, loot: 1, fight: 1, hunt: 1, raid: 1 },
};
const PERS_WEIGHTS = {
  normal: [['balanced', 3], ['builder', 2], ['looter', 2], ['fighter', 1.5], ['hunter', 1.5]],
  hard: [['balanced', 2], ['looter', 2.5], ['fighter', 2], ['builder', 1.5], ['hunter', 1]],
  expert: [['looter', 2.5], ['fighter', 2.5], ['balanced', 2], ['builder', 1]],
};

export function rollTier(difficulty, r = Math.random) {
  const d = DISTRIBUTION[tierOf(difficulty)];
  return weightedPick(TIERS.map(t => [t, d[t]]), r);
}
export function rollPersonality(tier, r = Math.random) { return weightedPick(PERS_WEIGHTS[tierOf(tier)], r); }

// Team playstyles. rush: races up the tech tree with loot runs and a small base.
// turtle: slow and steady, gathers, stocks boxes, upgrades walls early, rarely raids.
export const STYLES = {
  rush: { name: 'Rushers', craft: 2.2, avoid: 0.35, gather: 1.7, loot: 1.8, build: 0.8, upgrade: -1, bench: 0.55, idle: 0.03, raid: 1.35, stage: 1, boxes: 2, upkeepH: 0.6, research: 1.4 },
  balanced: { name: 'Balanced', craft: 1.5, avoid: 1, gather: 1.3, loot: 1, build: 1, upgrade: 0, bench: 1, idle: 0.03, raid: 1, stage: 3, boxes: 3, upkeepH: 1, research: 1 },
  turtle: { name: 'Turtles', craft: 1.35, avoid: 0.7, gather: 1.35, loot: 0.5, build: 1.55, upgrade: 1, bench: 1.6, idle: 0.03, raid: 0.35, stage: 3, boxes: 5, upkeepH: 1.8, research: 0.7 },
};
const STYLE_WEIGHTS = {
  normal: [['turtle', 3], ['balanced', 4.5], ['rush', 2.5]],
  hard: [['turtle', 2.5], ['balanced', 3.5], ['rush', 4]],
  expert: [['turtle', 2], ['balanced', 3], ['rush', 5]],
};
export function rollStyle(tier, r = Math.random) { return weightedPick(STYLE_WEIGHTS[tier] || STYLE_WEIGHTS.normal, r); }
export const styleOf = (team) => STYLES[(team && team.style) || 'balanced'] || STYLES.balanced;

const A = ['Ash', 'Brick', 'Cinder', 'Dusty', 'Echo', 'Flint', 'Gravel', 'Hollow', 'Iron', 'Jinx', 'Kettle', 'Lumen', 'Moss', 'Nettle', 'Onyx', 'Pike', 'Quill', 'Rust', 'Sable', 'Thorn', 'Umber', 'Vex', 'Wick', 'Yarrow', 'Zinc', 'Birch', 'Coal', 'Drift', 'Ember', 'Fern', 'Grim', 'Hawk', 'Ivy', 'Jade', 'Knox', 'Lark', 'Mako', 'Nova', 'Oak', 'Pebble', 'Raven', 'Slate', 'Tusk', 'Volt', 'Wren'];
const B = ['', '', '', 'y', 'er', 'ie', '_x', '99', '01', 'Fox', 'Wolf', 'Bear', 'Jaw', 'Eye', 'Hand', 'Kid', 'Boss', 'Byte', 'Tail', 'Run'];
const used = new Set();
export function botName(r = Math.random) {
  for (let i = 0; i < 40; i++) {
    const n = pick(A, r) + pick(B, r);
    if (!used.has(n)) { used.add(n); return n; }
  }
  return pick(A, r) + Math.floor(r() * 1000);
}
export function resetNames() { used.clear(); }

const TEAM_WORDS = ['Wolves', 'Crows', 'Tide', 'Rats', 'Clan', 'Crew', 'Pack', 'Squad', 'Order', 'Syndicate', 'Union', 'Gang', 'Hive', 'Circle'];
const TEAM_ADJ = ['Red', 'Iron', 'Salt', 'Night', 'Grey', 'Stone', 'Bone', 'Ash', 'Copper', 'Frost', 'Dune', 'Pine', 'Rust', 'Sulfur', 'Smoke'];
export function teamName(r = Math.random) { return `${pick(TEAM_ADJ, r)} ${pick(TEAM_WORDS, r)}`; }

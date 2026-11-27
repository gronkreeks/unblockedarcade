// Building piece + grade + deployable definitions.

export const CELL = 3;          // grid cell size (m)
export const LEVEL_H = 3;       // wall height (m)
export const FOUND_H = 1;       // foundation top above structure origin

export const GRADES = [
  { id: 'twig', name: 'Twig', hp: 10, cost: { wood: 50 }, decayHours: 24, color: 0xc8a46a },
  { id: 'wood', name: 'Wood', hp: 250, cost: { wood: 200 }, decayHours: 72, color: 0x8a5d34 },
  { id: 'stone', name: 'Stone', hp: 500, cost: { stones: 300 }, decayHours: 120, color: 0x9a9890 },
  { id: 'metal', name: 'Sheet Metal', hp: 1000, cost: { metal_frag: 200 }, decayHours: 192, color: 0x7d8790 },
  { id: 'armored', name: 'Armored', hp: 2000, cost: { hqm: 25 }, decayHours: 288, color: 0x4a5560 },
];

// Damage multipliers by damage type and grade index.
export const STRUCT_DMG = {
  melee: [1, 0.2, 0.02, 0.01, 0.005],
  bullet: [0.5, 0.05, 0.005, 0.002, 0.001],
  explosive: [1, 1.3, 1, 1, 1],
};

// kind: 'cell' (occupies a grid cell at a level) or 'edge' (sits on a cell edge).
export const PIECES = {
  foundation: { name: 'Foundation', kind: 'cell', mult: 1, hotkey: '1' },
  wall: { name: 'Wall', kind: 'edge', mult: 1, full: true, hotkey: '2' },
  doorway: { name: 'Doorway', kind: 'edge', mult: 1, full: true, door: true, hotkey: '3' },
  window: { name: 'Window', kind: 'edge', mult: 1, full: true, hotkey: '4' },
  half_wall: { name: 'Half Wall', kind: 'edge', mult: 0.5, full: false, hotkey: '5' },
  floor: { name: 'Floor', kind: 'cell', mult: 0.5, hotkey: '6' },
  stairs: { name: 'Stairs', kind: 'cell', mult: 1, rotates: true, hotkey: '7' },
  roof: { name: 'Roof', kind: 'cell', mult: 1, hotkey: '8' },
};
export const PIECE_ORDER = ['foundation', 'wall', 'doorway', 'window', 'half_wall', 'floor', 'stairs', 'roof'];

export function pieceCost(type, grade) {
  const g = GRADES[grade], m = PIECES[type].mult, out = {};
  for (const k in g.cost) out[k] = Math.ceil(g.cost[k] * m);
  return out;
}
export function pieceMaxHp(type, grade) { return Math.round(GRADES[grade].hp * (PIECES[type].mult < 1 ? 0.6 : 1)); }
// Upkeep per in-game hour, paid from the Claim Cabinet.
export function pieceUpkeep(type, grade) {
  const c = pieceCost(type, grade), out = {};
  for (const k in c) out[k] = c[k] * 0.004;
  return out;
}

export const DOORS = {
  wood_door: { name: 'Wooden Door', hp: 200, dmg: { melee: 0.4, bullet: 0.05, explosive: 1.1 }, color: 0x8a5d34 },
  metal_door: { name: 'Sheet Metal Door', hp: 250, dmg: { melee: 0.03, bullet: 0.01, explosive: 1 }, color: 0x8f969e },
  armored_door: { name: 'Armored Door', hp: 800, dmg: { melee: 0.005, bullet: 0.002, explosive: 1 }, color: 0x4a5560 },
};

// Deployables. size = half extents of the collider. slots = container slots (0 = none).
export const DEPLOYABLES = {
  wood_box: { name: 'Wooden Box', hp: 150, size: [0.45, 0.3, 0.3], slots: 24, color: 0x9a6b3f, dmg: { melee: 0.6, bullet: 0.2, explosive: 1 } },
  large_box: { name: 'Large Wood Box', hp: 300, size: [0.8, 0.42, 0.45], slots: 48, color: 0x7a5130, dmg: { melee: 0.5, bullet: 0.15, explosive: 1 } },
  furnace: { name: 'Furnace', hp: 500, size: [0.5, 0.75, 0.5], slots: 12, color: 0x8d8d8d, dmg: { melee: 0.1, bullet: 0.02, explosive: 1 } },
  campfire: { name: 'Campfire', hp: 50, size: [0.5, 0.15, 0.5], slots: 3, color: 0x6b4a2a, solid: false, dmg: { melee: 1, bullet: 0.5, explosive: 1 } },
  workbench1: { name: 'Workbench Level 1', hp: 500, size: [1, 0.5, 0.5], slots: 0, bench: 1, color: 0x9a6b3f, dmg: { melee: 0.3, bullet: 0.05, explosive: 1 } },
  workbench2: { name: 'Workbench Level 2', hp: 750, size: [1, 0.55, 0.55], slots: 0, bench: 2, color: 0x8f969e, dmg: { melee: 0.1, bullet: 0.02, explosive: 1 } },
  workbench3: { name: 'Workbench Level 3', hp: 1000, size: [1.1, 0.6, 0.6], slots: 0, bench: 3, color: 0x4a6b8a, dmg: { melee: 0.05, bullet: 0.01, explosive: 1 } },
  research_table: { name: 'Research Table', hp: 300, size: [0.8, 0.45, 0.45], slots: 2, color: 0x5b8fd6, dmg: { melee: 0.3, bullet: 0.05, explosive: 1 } },
  sleeping_bag: { name: 'Sleeping Bag', hp: 50, size: [0.45, 0.06, 1], slots: 0, solid: false, spawn: true, color: 0x5a7a3a, dmg: { melee: 1, bullet: 0.5, explosive: 1 } },
  bed: { name: 'Bed', hp: 200, size: [0.55, 0.25, 1.1], slots: 0, spawn: true, color: 0x3a5a7a, dmg: { melee: 0.5, bullet: 0.2, explosive: 1 } },
  claim_cabinet: { name: 'Claim Cabinet', hp: 500, size: [0.45, 0.9, 0.3], slots: 24, color: 0x7a5130, dmg: { melee: 0.2, bullet: 0.05, explosive: 1 } },
  // wide wooden cover you can throw down mid-fight (2.5 m wide, 1.8 m tall: it hides your head)
  barricade: { name: 'Wooden Barricade', hp: 300, size: [1.25, 0.9, 0.2], slots: 0, color: 0x9a6b3f, quick: true, dmg: { melee: 0.6, bullet: 0.35, explosive: 1.5 } },
  recycler: { name: 'Recycler', hp: 99999, size: [0.9, 0.9, 0.7], slots: 12, color: 0x3d6b4a, dmg: { melee: 0, bullet: 0, explosive: 0 } },
};

export const PRIVILEGE_PAD = 18; // privilege reaches this far past the outermost pieces
export const SPAWN_COOLDOWN = { sleeping_bag: 120, bed: 60 };

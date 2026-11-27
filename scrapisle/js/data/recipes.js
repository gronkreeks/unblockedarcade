// Crafting recipes. tier = workbench level needed nearby (0 = none).
// known: true = every survivor knows it from spawn. Otherwise it must be unlocked with scrap at a
// workbench of that tier (unlock cost) or researched at a research table (item + scrap).

const R = [];
function r(out, n, cost, time, tier, opts = {}) {
  R.push(Object.assign({ id: out, out, n, cost, time, tier, known: tier === 0 }, opts));
}

// Tools
r('rock', 1, { stones: 10 }, 2, 0);
r('torch', 1, { wood: 30, cloth: 1 }, 3, 0);
r('stone_hatchet', 1, { wood: 200, stones: 100 }, 12, 0);
r('stone_pickaxe', 1, { wood: 200, stones: 100 }, 12, 0);
r('hammer', 1, { wood: 100 }, 6, 0);
r('building_plan', 1, { wood: 20 }, 3, 0);
r('hatchet', 1, { wood: 100, metal_frag: 75 }, 20, 1, { unlock: 30 });
r('pickaxe', 1, { wood: 100, metal_frag: 125 }, 20, 1, { unlock: 30 });
r('salvaged_axe', 1, { metal_frag: 100, metal_blade: 3 }, 25, 2, { unlock: 90 });
r('salvaged_icepick', 1, { metal_frag: 125, metal_blade: 3, hqm: 1 }, 25, 2, { unlock: 90 });

// Melee
r('wooden_spear', 1, { wood: 300 }, 10, 0);
r('stone_spear', 1, { wooden_spear: 1, stones: 20 }, 6, 0);
r('bone_knife', 1, { bone_frag: 20 }, 6, 0);
r('machete', 1, { metal_frag: 40, metal_blade: 1 }, 15, 1, { unlock: 25 });
r('salvaged_sword', 1, { metal_frag: 30, metal_blade: 2, wood: 50 }, 15, 1, { unlock: 40 });

// Ranged
r('hunting_bow', 1, { wood: 200, cloth: 50 }, 15, 0);
r('crossbow', 1, { wood: 200, metal_frag: 75, rope: 2 }, 20, 1, { unlock: 60 });
r('pipe_pistol', 1, { wood: 75, metal_frag: 30 }, 10, 1, { unlock: 25 });
r('revolver', 1, { metal_frag: 125, metal_pipe: 1, cloth: 25 }, 25, 1, { unlock: 75 });
r('double_barrel', 1, { metal_frag: 175, metal_pipe: 2 }, 25, 1, { unlock: 75 });
r('semi_pistol', 1, { metal_frag: 75, metal_pipe: 1, semi_body: 1 }, 30, 2, { unlock: 125 });
r('pump_shotgun', 1, { metal_frag: 100, metal_pipe: 2, metal_spring: 1 }, 30, 2, { unlock: 125 });
r('drum_smg', 1, { wood: 100, hqm: 10, smg_body: 1, metal_spring: 1 }, 35, 2, { unlock: 150 });
r('scrap_smg', 1, { hqm: 8, smg_body: 1, metal_spring: 1 }, 35, 2, { unlock: 150 });
r('semi_rifle', 1, { metal_frag: 450, hqm: 4, metal_spring: 1, semi_body: 1 }, 40, 2, { unlock: 200 });
r('assault_rifle', 1, { hqm: 50, wood: 200, rifle_body: 1, metal_spring: 4 }, 50, 3, { unlock: 500 });
r('bolt_rifle', 1, { hqm: 20, metal_pipe: 3, rifle_body: 1, metal_spring: 1 }, 50, 3, { unlock: 500 });

// Ammo
r('wooden_arrow', 2, { wood: 25, stones: 10 }, 3, 0);
r('hv_arrow', 2, { wood: 20, metal_frag: 10 }, 4, 1, { unlock: 20 });
r('handmade_shell', 2, { gunpowder: 5, stones: 5 }, 3, 1, { unlock: 20 });
r('buckshot', 2, { gunpowder: 10, metal_frag: 5 }, 4, 1, { unlock: 30 });
r('pistol_ammo', 4, { gunpowder: 5, metal_frag: 10 }, 4, 1, { unlock: 40 });
r('slug', 2, { gunpowder: 10, metal_frag: 10 }, 4, 2, { unlock: 60 });
r('rifle_ammo', 3, { gunpowder: 5, metal_frag: 10 }, 4, 2, { unlock: 75 });

// Resources
r('low_grade', 4, { animal_fat: 3, cloth: 1 }, 2, 0);
r('rope', 1, { cloth: 15 }, 3, 0);
r('gunpowder', 10, { charcoal: 30, sulfur: 20 }, 3, 1, { known: true });
r('explosives', 1, { gunpowder: 50, low_grade: 3, sulfur: 10, metal_frag: 10 }, 5, 2, { unlock: 150 });

// Raid
r('satchel_charge', 1, { gunpowder: 120, metal_frag: 40, cloth: 10, rope: 1 }, 10, 1, { unlock: 90 });
r('timed_charge', 1, { explosives: 20, cloth: 5, tech_trash: 2 }, 30, 3, { unlock: 600 });

// Clothing
r('cloth_hood', 1, { cloth: 10 }, 5, 0);
r('cloth_shirt', 1, { cloth: 20 }, 6, 0);
r('cloth_pants', 1, { cloth: 20 }, 6, 0);
r('hide_boots', 1, { leather: 10 }, 6, 0);
r('leather_gloves', 1, { leather: 10 }, 6, 0);
r('wood_chest', 1, { wood: 200, rope: 1 }, 10, 0);
r('bone_helmet', 1, { bone_frag: 30, cloth: 5 }, 8, 0);
r('roadsign_vest', 1, { road_sign: 2, sewing_kit: 1 }, 15, 1, { unlock: 60 });
r('roadsign_kilt', 1, { road_sign: 2, leather: 5 }, 15, 1, { unlock: 50 });
r('coffee_can_helmet', 1, { metal_frag: 80, leather: 10 }, 15, 1, { unlock: 50 });
r('hazmat_suit', 1, { tarp: 5, sewing_kit: 2, hqm: 8 }, 30, 2, { unlock: 125 });
r('metal_facemask', 1, { hqm: 15, sewing_kit: 1, leather: 50 }, 30, 3, { unlock: 400 });
r('metal_chest', 1, { hqm: 25, sewing_kit: 1, leather: 50 }, 30, 3, { unlock: 400 });

// Medical
r('bandage', 1, { cloth: 4 }, 3, 0);
r('med_syringe', 2, { cloth: 15, metal_frag: 10, low_grade: 10 }, 6, 1, { unlock: 40 });
r('anti_rad', 1, { metal_frag: 20, cloth: 5 }, 5, 1, { unlock: 20 });
r('large_medkit', 1, { med_syringe: 2, low_grade: 10 }, 10, 2, { unlock: 125 });

// Deployables / construction
r('wood_box', 1, { wood: 100 }, 6, 0);
r('large_box', 1, { wood: 250, metal_frag: 50 }, 10, 1, { unlock: 30 });
r('furnace', 1, { stones: 200, wood: 100, low_grade: 50 }, 15, 0);
r('campfire', 1, { wood: 100 }, 4, 0);
r('sleeping_bag', 1, { cloth: 30 }, 6, 0);
r('bed', 1, { cloth: 60, metal_frag: 100, sewing_kit: 1 }, 15, 1, { unlock: 40 });
r('claim_cabinet', 1, { wood: 1000 }, 15, 0);
r('wood_door', 1, { wood: 300 }, 10, 0);
r('key_lock', 1, { wood: 75 }, 4, 0);
r('code_lock', 1, { metal_frag: 100 }, 6, 0);
r('metal_door', 1, { metal_frag: 150 }, 15, 1, { unlock: 40 });
r('armored_door', 1, { hqm: 20, gears: 5 }, 30, 3, { unlock: 300 });
r('workbench1', 1, { wood: 500, metal_frag: 100, scrap: 50 }, 20, 0);
r('research_table', 1, { metal_frag: 200, scrap: 20 }, 15, 1, { known: true });
r('workbench2', 1, { metal_frag: 500, hqm: 20, scrap: 500 }, 40, 1, { known: true });
r('workbench3', 1, { metal_frag: 1000, hqm: 100, scrap: 1250 }, 60, 2, { known: true });

export const RECIPES = R;
export const RECIPE = Object.fromEntries(R.map(x => [x.id, x]));
export const DEFAULT_BLUEPRINTS = R.filter(x => x.known).map(x => x.id);
export const CRAFT_CATS = ['Tools', 'Weapons', 'Ammo', 'Construction', 'Items', 'Clothing', 'Medical', 'Resources', 'Raid'];

// Scrap cost to research an item at a research table (needs one of the item, consumed).
export function researchCost(id) {
  const rc = RECIPE[id];
  if (!rc || rc.known) return 0;
  return Math.round(({ 1: 40, 2: 125, 3: 400 })[rc.tier] || 75);
}

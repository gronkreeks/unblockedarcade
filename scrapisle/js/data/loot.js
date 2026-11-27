// Loot tables. entries: [itemId, weight, min, max]. guaranteed: [itemId, min, max].
// Stackable quantities and roll counts scale with the world's loot multiplier.

export const LOOT_TABLES = {
  barrel: {
    rolls: [2, 3],
    guaranteed: [['scrap', 2, 4]],
    entries: [
      ['metal_frag', 10, 10, 25], ['low_grade', 6, 3, 8], ['cloth', 6, 5, 15], ['rope', 7, 1, 2], ['tarp', 3, 1, 1],
      ['sewing_kit', 5, 1, 1], ['gears', 5, 1, 2], ['metal_pipe', 6, 1, 2], ['metal_spring', 3, 1, 1],
      ['metal_blade', 6, 1, 2], ['sheet_metal', 3, 1, 1], ['road_sign', 6, 1, 2], ['propane_tank', 5, 1, 1],
      ['semi_body', 1.2, 1, 1], ['electric_fuse', 1, 1, 1], ['tech_trash', 1, 1, 1],
      ['pistol_ammo', 2, 4, 8], ['handmade_shell', 2, 4, 8], ['wooden_arrow', 2, 4, 8], ['bandage', 2, 1, 2],
      ['pipe_pistol', 0.5, 1, 1], ['revolver', 0.2, 1, 1], ['machete', 0.4, 1, 1], ['hatchet', 0.5, 1, 1], ['pickaxe', 0.4, 1, 1],
    ],
  },
  crate: {
    rolls: [2, 4],
    guaranteed: [['scrap', 4, 8]],
    entries: [
      ['metal_frag', 6, 20, 50], ['hqm', 2, 2, 5], ['gears', 6, 1, 3], ['metal_pipe', 6, 1, 3], ['metal_spring', 6, 1, 2],
      ['sheet_metal', 4, 1, 2], ['road_sign', 5, 1, 3], ['semi_body', 4, 1, 1], ['smg_body', 1.5, 1, 1], ['rifle_body', 0.7, 1, 1],
      ['tech_trash', 3, 1, 2], ['electric_fuse', 1.5, 1, 1], ['tarp', 3, 1, 1], ['sewing_kit', 4, 1, 2], ['rope', 3, 1, 2],
      ['pistol_ammo', 4, 8, 20], ['buckshot', 3, 4, 10], ['rifle_ammo', 1, 6, 12], ['hv_arrow', 2, 4, 10],
      ['med_syringe', 2, 1, 2], ['bandage', 3, 1, 3], ['anti_rad', 2, 1, 2],
      ['revolver', 1.5, 1, 1], ['double_barrel', 1, 1, 1], ['semi_pistol', 0.7, 1, 1], ['crossbow', 1, 1, 1], ['pipe_pistol', 1, 1, 1],
      ['roadsign_vest', 0.8, 1, 1], ['roadsign_kilt', 0.8, 1, 1], ['coffee_can_helmet', 0.9, 1, 1], ['hazmat_suit', 0.6, 1, 1],
      ['salvaged_axe', 0.4, 1, 1], ['salvaged_icepick', 0.4, 1, 1], ['hatchet', 1, 1, 1], ['pickaxe', 1, 1, 1],
    ],
  },
  food_crate: {
    rolls: [2, 3],
    guaranteed: [],
    entries: [
      ['canned_beans', 6, 1, 2], ['canned_tuna', 6, 1, 2], ['chocolate', 5, 1, 2], ['granola', 5, 1, 2], ['water_bottle', 7, 1, 2],
      ['bandage', 2, 1, 2], ['mushroom', 3, 1, 3], ['cooked_meat', 2, 1, 2], ['med_syringe', 0.8, 1, 1],
    ],
  },
  military_crate: {
    rolls: [3, 4],
    guaranteed: [['scrap', 8, 15]],
    entries: [
      ['hqm', 4, 8, 20], ['metal_frag', 3, 60, 120], ['rifle_body', 3, 1, 1], ['smg_body', 4, 1, 1], ['semi_body', 4, 1, 1],
      ['metal_spring', 5, 1, 3], ['metal_pipe', 4, 2, 4], ['tech_trash', 4, 1, 3], ['gears', 3, 2, 4], ['electric_fuse', 2, 1, 1],
      ['rifle_ammo', 5, 20, 40], ['pistol_ammo', 4, 20, 40], ['slug', 2, 6, 12], ['buckshot', 3, 8, 16],
      ['large_medkit', 2, 1, 1], ['med_syringe', 3, 2, 3], ['anti_rad', 2, 2, 3], ['explosives', 0.7, 2, 5],
      ['semi_rifle', 2, 1, 1], ['pump_shotgun', 2, 1, 1], ['drum_smg', 1.6, 1, 1], ['scrap_smg', 1.8, 1, 1], ['semi_pistol', 2, 1, 1],
      ['assault_rifle', 0.6, 1, 1], ['bolt_rifle', 0.5, 1, 1], ['metal_facemask', 0.5, 1, 1], ['metal_chest', 0.5, 1, 1],
      ['roadsign_vest', 1.5, 1, 1], ['coffee_can_helmet', 1.5, 1, 1], ['hazmat_suit', 1, 1, 1], ['timed_charge', 0.12, 1, 1],
    ],
  },
  militia: {
    rolls: [1, 2],
    guaranteed: [['scrap', 3, 8]],
    entries: [
      ['rifle_ammo', 4, 8, 20], ['pistol_ammo', 4, 10, 20], ['med_syringe', 3, 1, 2], ['bandage', 3, 1, 3], ['canned_tuna', 2, 1, 1],
      ['metal_spring', 1, 1, 1], ['tech_trash', 1, 1, 1], ['anti_rad', 2, 1, 2],
    ],
  },
};

// Total harvest per corpse at 1x. Each hit takes a slice proportional to the tool's flesh gather.
export const ANIMAL_YIELD = {
  chicken: { raw_meat: 2, bone_frag: 6, animal_fat: 3, cloth: 2 },
  deer: { raw_meat: 5, leather: 50, animal_fat: 15, bone_frag: 20 },
  boar: { raw_meat: 6, leather: 40, animal_fat: 20, bone_frag: 25 },
  wolf: { raw_meat: 4, leather: 40, animal_fat: 15, bone_frag: 20 },
  bear: { raw_meat: 12, leather: 120, animal_fat: 40, bone_frag: 50 },
  human: { bone_frag: 25, animal_fat: 5 },
};

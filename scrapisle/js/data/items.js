// Item definitions. Every item the game can hold lives here.
// value = rough worth in scrap, used by bots to judge loot, raid targets and what to keep.

const I = {};
function def(id, o) { I[id] = Object.assign({ id, stack: 1, value: 1, cat: 'Items' }, o); }

// ---------- Resources ----------
def('wood', { name: 'Wood', cat: 'Resources', type: 'resource', stack: 1000, icon: 'log', color: '#9a6b3f', value: 0.02, fuel: 1 });
def('stones', { name: 'Stones', cat: 'Resources', type: 'resource', stack: 1000, icon: 'rock', color: '#9aa0a6', value: 0.02 });
def('metal_ore', { name: 'Metal Ore', cat: 'Resources', type: 'resource', stack: 1000, icon: 'ore', color: '#8d7f74', spot: '#c98b5a', value: 0.08, smelt: 'metal_frag', smeltTime: 1.5 });
def('metal_frag', { name: 'Metal Fragments', cat: 'Resources', type: 'resource', stack: 1000, icon: 'frags', color: '#b8bec6', value: 0.12 });
def('sulfur_ore', { name: 'Sulfur Ore', cat: 'Resources', type: 'resource', stack: 1000, icon: 'ore', color: '#9c9360', spot: '#e8d84a', value: 0.08, smelt: 'sulfur', smeltTime: 1 });
def('sulfur', { name: 'Sulfur', cat: 'Resources', type: 'resource', stack: 1000, icon: 'powder', color: '#e6d34a', value: 0.12 });
def('hqm_ore', { name: 'High Quality Ore', cat: 'Resources', type: 'resource', stack: 100, icon: 'ore', color: '#6f7a86', spot: '#cfe3f5', value: 1.5, smelt: 'hqm', smeltTime: 4 });
def('hqm', { name: 'High Quality Metal', cat: 'Resources', type: 'resource', stack: 100, icon: 'ingot', color: '#cfe0ee', value: 2 });
def('charcoal', { name: 'Charcoal', cat: 'Resources', type: 'resource', stack: 1000, icon: 'powder', color: '#2c2c2c', value: 0.03 });
def('gunpowder', { name: 'Gunpowder', cat: 'Resources', type: 'resource', stack: 1000, icon: 'powder', color: '#4a4a52', value: 0.4 });
def('explosives', { name: 'Explosives', cat: 'Resources', type: 'resource', stack: 100, icon: 'tnt', color: '#b03a2e', value: 25 });
def('cloth', { name: 'Cloth', cat: 'Resources', type: 'resource', stack: 1000, icon: 'cloth', color: '#c9b78a', value: 0.15 });
def('leather', { name: 'Leather', cat: 'Resources', type: 'resource', stack: 1000, icon: 'cloth', color: '#8a5a36', value: 0.15 });
def('animal_fat', { name: 'Animal Fat', cat: 'Resources', type: 'resource', stack: 1000, icon: 'blob', color: '#e8dcb0', value: 0.1 });
def('bone_frag', { name: 'Bone Fragments', cat: 'Resources', type: 'resource', stack: 1000, icon: 'bone', color: '#ece6d6', value: 0.05 });
def('low_grade', { name: 'Low Grade Fuel', cat: 'Resources', type: 'resource', stack: 500, icon: 'can', color: '#c0392b', value: 0.5, fuel: 4 });
def('scrap', { name: 'Scrap', cat: 'Resources', type: 'resource', stack: 1000, icon: 'scrap', color: '#c7a34b', value: 1 });

// ---------- Components (found in loot, recycled into resources) ----------
const comp = (id, name, icon, color, value, recycle) => def(id, { name, cat: 'Components', type: 'component', stack: 20, icon, color, value, recycle });
comp('rope', 'Rope', 'rope', '#b8975a', 3, { cloth: 15 });
comp('tarp', 'Tarp', 'cloth', '#3d6b4a', 8, { cloth: 50 });
comp('sewing_kit', 'Sewing Kit', 'kit', '#c96f5a', 5, { cloth: 10, rope: 1 });
comp('gears', 'Gears', 'gear', '#a0a6ad', 12, { scrap: 10, metal_frag: 13 });
comp('metal_pipe', 'Metal Pipe', 'pipe', '#8f969e', 8, { scrap: 5, hqm: 1 });
comp('metal_spring', 'Metal Spring', 'spring', '#9aa3ad', 12, { scrap: 10, hqm: 1 });
comp('metal_blade', 'Metal Blade', 'blade', '#bfc5cc', 3, { scrap: 2, metal_frag: 15 });
comp('sheet_metal', 'Sheet Metal', 'plate', '#7d8790', 12, { scrap: 8, metal_frag: 100, hqm: 1 });
comp('road_sign', 'Road Sign', 'sign', '#d9b84a', 6, { scrap: 5, hqm: 1 });
comp('semi_body', 'Semi Automatic Body', 'body', '#55606b', 22, { scrap: 15, metal_frag: 75, hqm: 2 });
comp('smg_body', 'SMG Body', 'body', '#4c5560', 22, { scrap: 15, hqm: 2 });
comp('rifle_body', 'Rifle Body', 'body', '#3e464f', 35, { scrap: 25, hqm: 2 });
comp('tech_trash', 'Tech Trash', 'chip', '#3c8d5a', 25, { scrap: 20, hqm: 1 });
comp('propane_tank', 'Empty Propane Tank', 'tank', '#6b8fb3', 4, { scrap: 1, metal_frag: 50 });
comp('electric_fuse', 'Electric Fuse', 'chip', '#c9a23a', 20, { scrap: 20 });

// ---------- Tools ----------
// gather: base yield per hit at 1x, by node class. dmg: melee damage. rate: seconds per swing. dur: uses.
const tool = (id, o) => def(id, Object.assign({ cat: 'Tools', type: 'tool', icon: 'axe', range: 2.4 }, o));
tool('rock', { name: 'Rock', icon: 'rock', color: '#9aa0a6', gather: { tree: 10, ore: 12, flesh: 4 }, dmg: 10, rate: 1.0, dur: 400, value: 0.2 });
tool('torch', { name: 'Torch', icon: 'torch', color: '#e08b2a', gather: { tree: 1, ore: 1, flesh: 1 }, dmg: 8, rate: 0.9, dur: 300, warmth: 6, light: true, value: 0.5 });
tool('stone_hatchet', { name: 'Stone Hatchet', icon: 'axe', color: '#9aa0a6', gather: { tree: 25, ore: 4, flesh: 8 }, dmg: 15, rate: 0.9, dur: 250, value: 3 });
tool('stone_pickaxe', { name: 'Stone Pickaxe', icon: 'pick', color: '#9aa0a6', gather: { tree: 4, ore: 30, flesh: 3 }, dmg: 14, rate: 0.95, dur: 250, value: 3 });
tool('hatchet', { name: 'Hatchet', icon: 'axe', color: '#c9ced4', gather: { tree: 40, ore: 6, flesh: 12 }, dmg: 25, rate: 0.8, dur: 450, value: 10 });
tool('pickaxe', { name: 'Pickaxe', icon: 'pick', color: '#c9ced4', gather: { tree: 6, ore: 50, flesh: 5 }, dmg: 22, rate: 0.9, dur: 450, value: 12 });
tool('salvaged_axe', { name: 'Salvaged Axe', icon: 'axe', color: '#d8a24a', gather: { tree: 55, ore: 8, flesh: 16 }, dmg: 35, rate: 0.9, dur: 700, value: 30 });
tool('salvaged_icepick', { name: 'Salvaged Icepick', icon: 'pick', color: '#d8a24a', gather: { tree: 8, ore: 70, flesh: 6 }, dmg: 30, rate: 0.95, dur: 700, value: 35 });
def('hammer', { name: 'Hammer', cat: 'Tools', type: 'hammer', icon: 'hammer', color: '#a07a4a', dmg: 8, rate: 0.8, range: 3.5, dur: 9999, value: 1 });
def('building_plan', { name: 'Building Plan', cat: 'Tools', type: 'plan', icon: 'plan', color: '#5b8fd6', range: 6, value: 0.5 });

// ---------- Melee weapons ----------
const melee = (id, name, o) => def(id, Object.assign({ name, cat: 'Weapons', type: 'melee', icon: 'spear', gather: { tree: 2, ore: 1, flesh: 8 } }, o));
melee('wooden_spear', 'Wooden Spear', { color: '#9a6b3f', dmg: 25, rate: 0.85, range: 2.8, dur: 150, bleed: 0.3, value: 3 });
melee('stone_spear', 'Stone Spear', { color: '#9aa0a6', dmg: 35, rate: 0.85, range: 2.8, dur: 200, bleed: 0.4, value: 5 });
melee('bone_knife', 'Bone Knife', { icon: 'knife', color: '#ece6d6', dmg: 18, rate: 0.5, range: 1.8, dur: 200, bleed: 0.4, gather: { tree: 2, ore: 1, flesh: 15 }, value: 2 });
melee('machete', 'Machete', { icon: 'knife', color: '#c9ced4', dmg: 35, rate: 0.7, range: 2.2, dur: 300, bleed: 0.5, gather: { tree: 8, ore: 1, flesh: 14 }, value: 10 });
melee('salvaged_sword', 'Salvaged Sword', { icon: 'knife', color: '#d8a24a', dmg: 50, rate: 0.9, range: 2.4, dur: 350, bleed: 0.5, gather: { tree: 6, ore: 1, flesh: 12 }, value: 15 });

// ---------- Ammo ----------
const ammo = (id, name, o) => def(id, Object.assign({ name, cat: 'Ammo', type: 'ammo', stack: 128, icon: 'bullet', pellets: 1, spread: 0, dmgMult: 1, velMult: 1 }, o));
ammo('wooden_arrow', 'Wooden Arrow', { icon: 'arrow', color: '#9a6b3f', stack: 64, dmgMult: 1, velMult: 1, value: 0.3, bleed: 0.5 });
ammo('hv_arrow', 'High Velocity Arrow', { icon: 'arrow', color: '#c9ced4', stack: 64, dmgMult: 0.8, velMult: 1.6, value: 0.6, bleed: 0.4 });
ammo('handmade_shell', 'Handmade Shell', { icon: 'shell', color: '#6b8a3a', stack: 64, pellets: 6, spread: 7, dmgMult: 0.55, velMult: 0.8, value: 0.4, bleed: 0.3 });
ammo('buckshot', '12 Gauge Buckshot', { icon: 'shell', color: '#b03a2e', stack: 64, pellets: 8, spread: 5, dmgMult: 0.7, value: 1, bleed: 0.4 });
ammo('slug', '12 Gauge Slug', { icon: 'shell', color: '#2e6bb0', stack: 64, pellets: 1, spread: 0.5, dmgMult: 3.2, value: 1.4, bleed: 0.5 });
ammo('pistol_ammo', 'Pistol Bullet', { color: '#c7a34b', value: 0.5, bleed: 0.3 });
ammo('rocket', 'Rocket', { cat: 'Raid', icon: 'rocket', color: '#6b7a4a', stack: 6, value: 40, blast: 250, radius: 3, bleed: 0 });
ammo('rifle_ammo', '5.56 Rifle Ammo', { color: '#9c7a32', value: 0.8, bleed: 0.4 });

// ---------- Ranged weapons ----------
// dmg: damage per projectile with dmgMult 1. vel: m/s. rpm: shots/min. spread/aimSpread: degrees. recoil: degrees per shot.
const gun = (id, name, o) => def(id, Object.assign({ name, cat: 'Weapons', type: 'gun', icon: 'pistol', auto: false, mag: 1, reload: 2, spread: 2, aimSpread: 0.5, recoil: 1, recoilH: 0.3, zoom: 1.3, dur: 400 }, o));
gun('hunting_bow', 'Hunting Bow', { type: 'bow', icon: 'bow', color: '#9a6b3f', ammo: ['wooden_arrow', 'hv_arrow'], dmg: 50, vel: 80, rpm: 50, mag: 1, reload: 0, spread: 3, aimSpread: 0.6, recoil: 0, recoilH: 0, dur: 200, value: 6, noise: 20 });
gun('crossbow', 'Crossbow', { icon: 'bow', color: '#7a5a3a', ammo: ['wooden_arrow', 'hv_arrow'], dmg: 65, vel: 110, rpm: 20, mag: 1, reload: 3.4, spread: 1.5, aimSpread: 0.3, recoil: 2, recoilH: 0.5, dur: 300, value: 12, noise: 25 });
gun('pipe_pistol', 'Pipe Pistol', { icon: 'pistol', color: '#7d6b5a', ammo: ['handmade_shell', 'buckshot', 'slug'], dmg: 28, vel: 120, rpm: 30, mag: 1, reload: 2, spread: 3, aimSpread: 2.5, recoil: 6, recoilH: 2, dur: 120, flint: 0.4, value: 10, noise: 120 });
gun('revolver', 'Revolver', { icon: 'pistol', color: '#8f969e', ammo: ['pistol_ammo'], dmg: 35, vel: 300, rpm: 343, mag: 8, reload: 3.4, spread: 1.6, aimSpread: 0.35, recoil: 2.2, recoilH: 0.8, dur: 300, value: 25, noise: 160 });
gun('semi_pistol', 'Semi Pistol', { icon: 'pistol', color: '#55606b', ammo: ['pistol_ammo'], dmg: 40, vel: 300, rpm: 400, mag: 10, reload: 2.9, spread: 1.4, aimSpread: 0.3, recoil: 2.6, recoilH: 0.9, dur: 400, value: 45, noise: 160 });
gun('double_barrel', 'Double Barrel Shotgun', { icon: 'shotgun', color: '#7a5a3a', ammo: ['handmade_shell', 'buckshot', 'slug'], dmg: 30, vel: 225, rpm: 240, mag: 2, reload: 5.5, spread: 3, aimSpread: 2.2, recoil: 8, recoilH: 2, dur: 250, value: 30, noise: 200 });
gun('pump_shotgun', 'Pump Shotgun', { icon: 'shotgun', color: '#55606b', ammo: ['handmade_shell', 'buckshot', 'slug'], dmg: 30, vel: 225, rpm: 55, mag: 6, reload: 5.5, spread: 2.5, aimSpread: 1.8, recoil: 7, recoilH: 1.5, dur: 400, value: 55, noise: 200 });
gun('drum_smg', 'Drum SMG', { icon: 'smg', color: '#7a5a3a', ammo: ['pistol_ammo'], dmg: 38, vel: 300, rpm: 462, mag: 20, reload: 4, auto: true, spread: 2, aimSpread: 0.6, recoil: 1.4, recoilH: 0.7, dur: 600, value: 70, noise: 170 });
gun('scrap_smg', 'Scrap SMG', { icon: 'smg', color: '#8f969e', ammo: ['pistol_ammo'], dmg: 30, vel: 300, rpm: 600, mag: 24, reload: 4, auto: true, spread: 2.4, aimSpread: 0.8, recoil: 1.2, recoilH: 0.8, dur: 600, value: 55, noise: 170 });
gun('semi_rifle', 'Semi Rifle', { icon: 'rifle', color: '#55606b', ammo: ['rifle_ammo'], dmg: 40, vel: 375, rpm: 343, mag: 16, reload: 4.4, spread: 1.2, aimSpread: 0.2, recoil: 2, recoilH: 0.6, dur: 600, value: 80, noise: 220 });
gun('assault_rifle', 'Assault Rifle', { icon: 'rifle', color: '#3e464f', ammo: ['rifle_ammo'], dmg: 50, vel: 375, rpm: 450, mag: 30, reload: 4.4, auto: true, spread: 1.6, aimSpread: 0.35, recoil: 2.4, recoilH: 1.2, dur: 900, value: 180, noise: 240 });
gun('rocket_launcher', 'Rocket Launcher', { icon: 'launcher', color: '#4f5a3c', ammo: ['rocket'], dmg: 0, vel: 42, rpm: 10, mag: 1, reload: 5.5, spread: 1.2, aimSpread: 0.35, recoil: 4, recoilH: 1, zoom: 1.2, dur: 60, value: 150, noise: 320, rocket: true });
gun('bolt_rifle', 'Bolt Action Rifle', { icon: 'rifle', color: '#2e3a45', ammo: ['rifle_ammo'], dmg: 80, vel: 650, rpm: 35, mag: 4, reload: 4.5, spread: 1.5, aimSpread: 0.03, recoil: 6, recoilH: 1, zoom: 3.5, headMult: 2.2, dur: 400, value: 160, noise: 240 });

// ---------- Raid tools ----------
def('satchel_charge', { name: 'Satchel Charge', cat: 'Raid', type: 'raid', icon: 'satchel', color: '#8a6a3a', stack: 10, dmg: 75, radius: 4, fuse: 6, value: 30 });
def('timed_charge', { name: 'Timed Charge', cat: 'Raid', type: 'raid', icon: 'tnt', color: '#b03a2e', stack: 10, dmg: 275, radius: 3.5, fuse: 10, value: 600 });

// ---------- Clothing / armour ----------
// covers: body areas; prot: { proj, melee } fraction per covered area; cold: warmth points; rad: radiation protection.
const wear = (id, name, o) => def(id, Object.assign({ name, cat: 'Clothing', type: 'wear', icon: 'shirt', rad: 0, cold: 0, dur: 300 }, o));
wear('cloth_hood', 'Cloth Hood', { slot: 'head', icon: 'hat', covers: ['head'], prot: { proj: 0.1, melee: 0.1 }, cold: 4, color: '#c9b78a', value: 1 });
wear('cloth_shirt', 'Cloth Shirt', { slot: 'shirt', covers: ['chest'], prot: { proj: 0.1, melee: 0.1 }, cold: 6, color: '#c9b78a', value: 2 });
wear('cloth_pants', 'Cloth Trousers', { slot: 'pants', icon: 'pants', covers: ['legs'], prot: { proj: 0.1, melee: 0.1 }, cold: 6, color: '#b0a070', value: 2 });
wear('hide_boots', 'Hide Boots', { slot: 'feet', icon: 'boots', covers: ['legs'], prot: { proj: 0.04, melee: 0.05 }, cold: 4, color: '#8a5a36', value: 2 });
wear('leather_gloves', 'Leather Gloves', { slot: 'hands', icon: 'gloves', covers: ['chest'], prot: { proj: 0.03, melee: 0.05 }, cold: 3, color: '#8a5a36', value: 2 });
wear('wood_chest', 'Wood Chestplate', { slot: 'chest', icon: 'vest', covers: ['chest'], prot: { proj: 0.2, melee: 0.3 }, cold: -2, color: '#9a6b3f', value: 4 });
wear('bone_helmet', 'Bone Helmet', { slot: 'head', icon: 'hat', covers: ['head'], prot: { proj: 0.25, melee: 0.35 }, cold: 2, color: '#ece6d6', value: 4 });
wear('roadsign_vest', 'Road Sign Vest', { slot: 'chest', icon: 'vest', covers: ['chest'], prot: { proj: 0.35, melee: 0.4 }, cold: -3, color: '#d9b84a', value: 20 });
wear('roadsign_kilt', 'Road Sign Kilt', { slot: 'kilt', icon: 'pants', covers: ['legs'], prot: { proj: 0.3, melee: 0.35 }, cold: -2, color: '#d9b84a', value: 15 });
wear('coffee_can_helmet', 'Coffee Can Helmet', { slot: 'head', icon: 'hat', covers: ['head'], prot: { proj: 0.35, melee: 0.5 }, cold: 0, color: '#8f969e', value: 15 });
wear('metal_facemask', 'Metal Facemask', { slot: 'face', icon: 'mask', covers: ['head'], prot: { proj: 0.5, melee: 0.5 }, cold: 0, color: '#6f7a86', value: 90 });
wear('metal_chest', 'Metal Chestplate', { slot: 'chest', icon: 'vest', covers: ['chest'], prot: { proj: 0.5, melee: 0.5 }, cold: -4, color: '#6f7a86', value: 110 });
wear('hazmat_suit', 'Hazmat Suit', { slot: 'shirt', blocks: ['head', 'pants', 'feet', 'hands', 'face'], icon: 'hazmat', covers: ['head', 'chest', 'legs'], prot: { proj: 0.3, melee: 0.3 }, cold: 8, rad: 0.6, color: '#d6c43a', value: 40 });

// ---------- Food / water ----------
const food = (id, name, o) => def(id, Object.assign({ name, cat: 'Food', type: 'food', stack: 20, icon: 'food', heal: 0, hyd: 0 }, o));
food('raw_meat', 'Raw Meat', { color: '#c0392b', cal: 30, poison: 6, cooks: 'cooked_meat', value: 0.3 });
food('cooked_meat', 'Cooked Meat', { color: '#7a3b1e', cal: 110, heal: 4, value: 1 });
food('mushroom', 'Mushroom', { icon: 'mushroom', color: '#b9926a', cal: 15, hyd: 5, heal: 1, value: 0.2 });
food('berries', 'Wild Berries', { icon: 'berry', color: '#7b3fa0', cal: 25, hyd: 10, heal: 1, value: 0.3 });
food('canned_beans', 'Can of Beans', { icon: 'can', color: '#a0522d', cal: 160, hyd: 15, heal: 2, value: 3 });
food('canned_tuna', 'Can of Tuna', { icon: 'can', color: '#4a7ab0', cal: 110, hyd: 10, heal: 2, value: 2 });
food('chocolate', 'Chocolate Bar', { icon: 'bar', color: '#5a3a22', cal: 100, hyd: -2, heal: 1, value: 2 });
food('granola', 'Granola Bar', { icon: 'bar', color: '#c9a060', cal: 120, hyd: 0, heal: 1, value: 2 });
food('water_bottle', 'Water Bottle', { icon: 'bottle', color: '#5aa0d8', cal: 0, hyd: 120, value: 1 });

// ---------- Medical ----------
const med = (id, name, o) => def(id, Object.assign({ name, cat: 'Medical', type: 'med', stack: 10, icon: 'med', heal: 0, hot: 0, stopBleed: false, rad: 0, useTime: 1.5 }, o));
med('bandage', 'Bandage', { icon: 'bandage', color: '#ece6d6', heal: 5, stopBleed: true, useTime: 1.5, value: 1 });
med('med_syringe', 'Medical Syringe', { icon: 'syringe', color: '#5ad88a', heal: 15, hot: 20, stopBleed: true, rad: 10, useTime: 1, value: 6 });
med('large_medkit', 'Large Medkit', { icon: 'med', color: '#d84a4a', heal: 10, hot: 90, stopBleed: true, rad: 25, useTime: 3, value: 15 });
med('anti_rad', 'Anti-Radiation Pills', { icon: 'pills', color: '#e6d34a', rad: 50, useTime: 1, value: 4 });

// ---------- Deployables / construction ----------
const dep = (id, name, o) => def(id, Object.assign({ name, cat: 'Items', type: 'deploy', stack: 1, icon: 'box' }, o));
dep('barricade', 'Wooden Barricade', { cat: 'Construction', deploy: 'barricade', icon: 'barricade', color: '#9a6b3f', value: 4, stack: 5 });
dep('wood_box', 'Wooden Box', { deploy: 'wood_box', color: '#9a6b3f', value: 3 });
dep('large_box', 'Large Wood Box', { deploy: 'large_box', color: '#7a5130', value: 8 });
dep('furnace', 'Furnace', { deploy: 'furnace', icon: 'furnace', color: '#8d8d8d', value: 6 });
dep('campfire', 'Campfire', { deploy: 'campfire', icon: 'fire', color: '#e08b2a', value: 1, stack: 1 });
dep('candle', 'Candle', { deploy: 'candle', icon: 'candle', color: '#efe4c4', value: 1, stack: 10 });
dep('workbench1', 'Workbench Level 1', { deploy: 'workbench1', icon: 'bench', color: '#9a6b3f', value: 60 });
dep('workbench2', 'Workbench Level 2', { deploy: 'workbench2', icon: 'bench', color: '#8f969e', value: 600 });
dep('workbench3', 'Workbench Level 3', { deploy: 'workbench3', icon: 'bench', color: '#4a6b8a', value: 1500 });
dep('research_table', 'Research Table', { deploy: 'research_table', icon: 'bench', color: '#5b8fd6', value: 40 });
dep('sleeping_bag', 'Sleeping Bag', { deploy: 'sleeping_bag', icon: 'bag', color: '#5a7a3a', value: 3, stack: 5 });
dep('bed', 'Bed', { deploy: 'bed', icon: 'bag', color: '#3a5a7a', value: 20 });
dep('claim_cabinet', 'Claim Cabinet', { cat: 'Construction', deploy: 'claim_cabinet', icon: 'cabinet', color: '#7a5130', value: 10 });
dep('wood_door', 'Wooden Door', { cat: 'Construction', deploy: 'wood_door', door: true, icon: 'door', color: '#9a6b3f', value: 4 });
dep('metal_door', 'Sheet Metal Door', { cat: 'Construction', deploy: 'metal_door', door: true, icon: 'door', color: '#8f969e', value: 18 });
dep('armored_door', 'Armored Door', { cat: 'Construction', deploy: 'armored_door', door: true, icon: 'door', color: '#4a5560', value: 90 });
dep('key_lock', 'Key Lock', { cat: 'Construction', deploy: 'key_lock', lock: true, icon: 'lock', color: '#c7a34b', value: 1, stack: 10 });
dep('code_lock', 'Code Lock', { cat: 'Construction', deploy: 'code_lock', lock: true, icon: 'codelock', color: '#5ad88a', value: 12, stack: 10 });

export const ITEMS = I;
// Higher loot multipliers also mean bigger stacks (x5 loot = x5 stack sizes).
export function applyStackMult(mult) {
  const f = Math.max(1, Math.round(mult || 1));
  for (const d of Object.values(I)) { if (d.baseStack === undefined) d.baseStack = d.stack; if (d.baseStack > 1) d.stack = d.baseStack * f; }
}
export const item = (id) => I[id];
export const ITEM_IDS = Object.keys(I);

export const WEAR_SLOTS = ['head', 'face', 'shirt', 'chest', 'pants', 'kilt', 'feet', 'hands'];

export function maxDur(id) { const d = I[id]; return d && d.dur ? d.dur : 0; }
export function hasCondition(id) { const d = I[id]; return !!(d && d.dur && ['tool', 'melee', 'gun', 'bow', 'wear', 'hammer'].includes(d.type)); }
export function isWeapon(id) { const d = I[id]; return !!d && (d.type === 'gun' || d.type === 'bow' || d.type === 'melee'); }
export function isRanged(id) { const d = I[id]; return !!d && (d.type === 'gun' || d.type === 'bow'); }

// Create a fresh item stack object.
export function makeStack(id, n = 1, extra) {
  const s = { id, n };
  if (hasCondition(id)) s.c = 1;
  const d = I[id];
  if (d && (d.type === 'gun' || d.type === 'bow')) { s.ammo = 0; s.at = d.ammo[0]; }
  if (extra) Object.assign(s, extra);
  return s;
}

// Rough combat power score of a weapon, used by bots to compare gear.
export function weaponScore(id) {
  const d = I[id];
  if (!d) return 0;
  if (d.type === 'gun' || d.type === 'bow') {
    const dps = d.dmg * (d.type === 'bow' ? 1 : 1) * Math.min(d.rpm, 600) / 60;
    const capacity = Math.min(1, d.mag / 10) * 0.5 + 0.5;
    const acc = 1 / (0.6 + d.aimSpread);
    return dps * capacity * acc * 0.6 + d.value * 0.05 + 8;
  }
  if (d.type === 'melee' || d.type === 'tool') return (d.dmg || 5) / (d.rate || 1) * 0.35;
  return 0;
}

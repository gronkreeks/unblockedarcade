// Nations game rules: a turn-based empire game on a hex map. Found cities, grow them, research
// from the Bronze Age to the atomic era, and win by conquest, by space flight, or on score.
// Leaders (their personalities, agendas and portraits) are shared with Frontier
// (frontier-leaders.js). Everything here is plain data plus functions, so a game saves to JSON.
(function (root) {
'use strict';
const inNode = typeof module !== 'undefined' && module.exports;
const { LEADERS } = inNode ? require('./frontier-leaders.js') : root.FrontierLeaders;

// ════════════════ Utilities ════════════════
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// Smooth value noise
function makeNoise(rng) {
  const P = new Float32Array(512 * 512);
  for (let i = 0; i < P.length; i++) P[i] = rng();
  const g = (x, y) => P[((y & 511) << 9) | (x & 511)];
  const s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
function fbm(n, x, y, oct) { let v = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < oct; i++) { v += n(x * f, y * f) * a; t += a; a *= 0.5; f *= 2; } return v / t; }

// ════════════════ Rules data ════════════════
// Terrain. Yields are food / production / gold.
const OCEAN = 0, COAST = 1, GRASS = 2, PLAINS = 3, DESERT = 4, TUNDRA = 5, SNOW = 6;
const TERRAIN = [
  { name: 'Ocean', y: [1, 0, 0], water: true },
  { name: 'Coast', y: [1, 0, 1], water: true },
  { name: 'Grassland', y: [2, 0, 0] },
  { name: 'Plains', y: [1, 1, 0] },
  { name: 'Desert', y: [0, 0, 0] },
  { name: 'Tundra', y: [1, 0, 0] },
  { name: 'Snow', y: [0, 0, 0] },
];
const FLAT = 0, HILLS = 1, MOUNTAIN = 2;
const RESOURCES = {
  wheat:  { name: 'Wheat',   y: [1, 0, 0], on: t => (t.terr === GRASS || t.terr === PLAINS) && !t.forest && t.relief === FLAT },
  cattle: { name: 'Cattle',  y: [1, 0, 0], on: t => t.terr === GRASS && !t.forest },
  deer:   { name: 'Deer',    y: [1, 0, 0], on: t => t.forest || t.terr === TUNDRA },
  fish:   { name: 'Fish',    y: [2, 0, 0], on: t => t.terr === COAST },
  stone:  { name: 'Stone',   y: [0, 1, 0], on: t => t.relief === HILLS || t.terr === PLAINS },
  iron:   { name: 'Iron',    y: [0, 2, 0], on: t => t.relief === HILLS },
  horses: { name: 'Horses',  y: [1, 1, 0], on: t => (t.terr === PLAINS || t.terr === GRASS) && !t.forest },
  gold:   { name: 'Gold ore', y: [0, 0, 3], on: t => t.relief === HILLS || t.terr === DESERT },
  spices: { name: 'Spices',  y: [1, 0, 2], on: t => t.forest && t.terr === GRASS },
  gems:   { name: 'Gems',    y: [0, 0, 3], on: t => t.relief === HILLS || t.forest },
  oasis:  { name: 'Oasis',   y: [3, 0, 1], on: t => t.terr === DESERT && t.relief === FLAT },
};
const RES_IDS = Object.keys(RESOURCES);

// Eras, techs and what they unlock
const ERAS = ['Ancient', 'Classical', 'Medieval', 'Renaissance', 'Industrial', 'Modern', 'Atomic'];
const TECHS = {
  pottery:       { name: 'Pottery',            era: 0, cost: 25,  req: [] },
  husbandry:     { name: 'Animal Husbandry',   era: 0, cost: 25,  req: [] },
  mining:        { name: 'Mining',             era: 0, cost: 25,  req: [] },
  archery:       { name: 'Archery',            era: 0, cost: 40,  req: ['husbandry'] },
  masonry:       { name: 'Masonry',            era: 0, cost: 40,  req: ['mining'] },
  bronze:        { name: 'Bronze Working',     era: 0, cost: 40,  req: ['mining'] },
  writing:       { name: 'Writing',            era: 0, cost: 45,  req: ['pottery'] },
  riding:        { name: 'Horseback Riding',   era: 0, cost: 55,  req: ['husbandry'] },
  currency:      { name: 'Currency',           era: 1, cost: 80,  req: ['writing'] },
  iron:          { name: 'Iron Working',       era: 1, cost: 85,  req: ['bronze'] },
  mathematics:   { name: 'Mathematics',        era: 1, cost: 90,  req: ['writing', 'archery'] },
  engineering:   { name: 'Engineering',        era: 1, cost: 100, req: ['masonry', 'mathematics'] },
  apprenticeship:{ name: 'Apprenticeship',     era: 2, cost: 140, req: ['currency', 'mining'] },
  machinery:     { name: 'Machinery',          era: 2, cost: 150, req: ['iron', 'engineering'] },
  feudalism:     { name: 'Feudalism',          era: 2, cost: 150, req: ['bronze', 'apprenticeship'] },
  stirrups:      { name: 'Stirrups',           era: 2, cost: 165, req: ['riding', 'feudalism'] },
  education:     { name: 'Education',          era: 2, cost: 170, req: ['mathematics', 'apprenticeship'] },
  castles:       { name: 'Castles',            era: 2, cost: 180, req: ['engineering', 'feudalism'] },
  gunpowder:     { name: 'Gunpowder',          era: 3, cost: 240, req: ['machinery'] },
  banking:       { name: 'Banking',            era: 3, cost: 250, req: ['education', 'currency'] },
  metalcasting:  { name: 'Metal Casting',      era: 3, cost: 270, req: ['gunpowder'] },
  physics:       { name: 'Physics',            era: 3, cost: 270, req: ['education'] },
  milEngineering:{ name: 'Military Engineering', era: 3, cost: 290, req: ['castles', 'gunpowder'] },
  industrialization: { name: 'Industrialization', era: 4, cost: 360, req: ['banking', 'metalcasting'] },
  milScience:    { name: 'Military Science',   era: 4, cost: 390, req: ['stirrups', 'industrialization'] },
  rifling:       { name: 'Rifling',            era: 4, cost: 400, req: ['gunpowder', 'industrialization'] },
  ballistics:    { name: 'Ballistics',         era: 4, cost: 420, req: ['metalcasting', 'physics'] },
  chemistry:     { name: 'Chemistry',          era: 4, cost: 440, req: ['physics', 'industrialization'] },
  replaceable:   { name: 'Replaceable Parts',  era: 5, cost: 540, req: ['rifling', 'chemistry'] },
  electricity:   { name: 'Electricity',        era: 5, cost: 540, req: ['physics', 'industrialization'] },
  combustion:    { name: 'Combustion',         era: 5, cost: 570, req: ['chemistry'] },
  rocketry:      { name: 'Rocketry',           era: 5, cost: 620, req: ['ballistics', 'chemistry'] },
  computers:     { name: 'Computers',          era: 6, cost: 720, req: ['electricity', 'combustion'] },
  fission:       { name: 'Nuclear Fission',    era: 6, cost: 740, req: ['chemistry', 'rocketry'] },
  composites:    { name: 'Composites',         era: 6, cost: 800, req: ['combustion', 'computers'] },
  satellites:    { name: 'Satellites',         era: 6, cost: 820, req: ['rocketry', 'computers'] },
  fusion:        { name: 'Nuclear Fusion',     era: 6, cost: 950, req: ['fission', 'satellites'] },
};
const TECH_IDS = Object.keys(TECHS);
// Tile improvements develop by themselves on tiles a city keeps working; techs make them better
const DEVELOP_TURNS = 8;

// Units. cls: civ, recon, melee, anti (anti-mounted melee), mounted, ranged, siege, nuke.
// cs = combat strength, rs = ranged strength, rng = range, mv = moves
const UNITS = {
  settler:    { name: 'Settler',      cls: 'civ',     cost: 55,  cs: 0,  mv: 2, tech: null, desc: 'Founds a new city. Costs 1 population.' },
  scout:      { name: 'Scout',        cls: 'recon',   cost: 25,  cs: 10, mv: 3, tech: null, sight: 3, desc: 'Fast explorer that sees further.' },
  warrior:    { name: 'Warrior',      cls: 'melee',   cost: 30,  cs: 18, mv: 2, tech: null, up: 'swordsman' },
  archer:     { name: 'Archer',       cls: 'ranged',  cost: 50,  cs: 15, rs: 25, rng: 2, mv: 2, tech: 'archery', up: 'crossbowman' },
  spearman:   { name: 'Spearman',     cls: 'anti',    cost: 55,  cs: 25, mv: 2, tech: 'bronze', up: 'pikeman' },
  horseman:   { name: 'Horseman',     cls: 'mounted', cost: 70,  cs: 30, mv: 4, tech: 'riding', up: 'knight' },
  swordsman:  { name: 'Swordsman',    cls: 'melee',   cost: 90,  cs: 36, mv: 2, tech: 'iron', up: 'musketman' },
  catapult:   { name: 'Catapult',     cls: 'siege',   cost: 100, cs: 20, rs: 35, rng: 2, mv: 2, tech: 'mathematics', up: 'bombard' },
  crossbowman:{ name: 'Crossbowman',  cls: 'ranged',  cost: 140, cs: 30, rs: 40, rng: 2, mv: 2, tech: 'machinery', up: 'gatling' },
  pikeman:    { name: 'Pikeman',      cls: 'anti',    cost: 140, cs: 41, mv: 2, tech: 'feudalism', up: 'musketman' },
  knight:     { name: 'Knight',       cls: 'mounted', cost: 180, cs: 48, mv: 4, tech: 'stirrups', up: 'cavalry' },
  musketman:  { name: 'Musketman',    cls: 'melee',   cost: 220, cs: 55, mv: 2, tech: 'gunpowder', up: 'rifleman' },
  bombard:    { name: 'Bombard',      cls: 'siege',   cost: 240, cs: 30, rs: 55, rng: 2, mv: 2, tech: 'metalcasting', up: 'fieldart' },
  cavalry:    { name: 'Cavalry',      cls: 'mounted', cost: 300, cs: 62, mv: 5, tech: 'milScience', up: 'tank' },
  gatling:    { name: 'Gatling Gun',  cls: 'ranged',  cost: 300, cs: 45, rs: 60, rng: 1, mv: 2, tech: 'industrialization', up: 'machinegun' },
  rifleman:   { name: 'Rifleman',     cls: 'melee',   cost: 330, cs: 65, mv: 2, tech: 'rifling', up: 'infantry' },
  fieldart:   { name: 'Field Artillery', cls: 'siege', cost: 360, cs: 50, rs: 70, rng: 2, mv: 2, tech: 'ballistics', up: 'rocketart' },
  infantry:   { name: 'Infantry',     cls: 'melee',   cost: 430, cs: 75, mv: 2, tech: 'replaceable', up: 'mech' },
  machinegun: { name: 'Machine Gun',  cls: 'ranged',  cost: 440, cs: 60, rs: 75, rng: 1, mv: 2, tech: 'electricity' },
  tank:       { name: 'Tank',         cls: 'mounted', cost: 480, cs: 85, mv: 4, tech: 'combustion', up: 'armor' },
  rocketart:  { name: 'Rocket Artillery', cls: 'siege', cost: 520, cs: 60, rs: 85, rng: 3, mv: 2, tech: 'rocketry' },
  mech:       { name: 'Mechanized Infantry', cls: 'melee', cost: 560, cs: 88, mv: 3, tech: 'computers' },
  armor:      { name: 'Modern Armor', cls: 'mounted', cost: 600, cs: 95, mv: 4, tech: 'composites' },
  nuke:       { name: 'Nuclear Bomb', cls: 'nuke',    cost: 800, cs: 0, mv: 0, tech: 'fission', desc: 'Launch from its city at a target up to 12 tiles away. Destroys every unit within 1 tile and halves nearby cities.' },
};
const UNIT_IDS = Object.keys(UNITS);
const MILITARY = new Set(['recon', 'melee', 'anti', 'mounted', 'ranged', 'siege']);
const NUKE_RANGE = 12;

// Buildings. y: flat food/prod/gold, sci, cul; pct: percent bonuses; def: wall tier
const BUILDINGS = {
  monument:   { name: 'Monument',    cost: 40,  up: 0, tech: null, cul: 2, desc: '+2 culture: borders grow faster.' },
  granary:    { name: 'Granary',     cost: 60,  up: 0, tech: 'pottery', food: 2, desc: '+2 food.' },
  walls:      { name: 'Walls',       cost: 70,  up: 0, tech: 'masonry', def: 1, desc: '+100 city HP and +5 city strength.' },
  barracks:   { name: 'Barracks',    cost: 70,  up: 1, tech: 'bronze', milPct: 25, desc: 'Military units built 25% faster, and they heal faster here.' },
  library:    { name: 'Library',     cost: 80,  up: 0, tech: 'writing', sci: 2, sciPct: 10, desc: '+2 science, +10% science.' },
  market:     { name: 'Market',      cost: 100, up: 0, tech: 'currency', gold: 3, goldPct: 15, desc: '+3 gold, +15% gold.' },
  aqueduct:   { name: 'Aqueduct',    cost: 120, up: 0, tech: 'engineering', food: 1, housing: 6, desc: '+6 population cap, +1 food.' },
  workshop:   { name: 'Workshop',    cost: 140, up: 1, tech: 'apprenticeship', prod: 2, prodPct: 10, desc: '+2 production, +10% production.' },
  castle:     { name: 'Castle',      cost: 180, up: 0, tech: 'castles', def: 2, need: 'walls', desc: '+100 city HP and +5 city strength. Needs Walls.' },
  university: { name: 'University',  cost: 190, up: 1, tech: 'education', sci: 4, sciPct: 20, need: 'library', desc: '+4 science, +20% science. Needs a Library.' },
  bank:       { name: 'Bank',        cost: 220, up: 0, tech: 'banking', gold: 4, goldPct: 20, need: 'market', desc: '+4 gold, +20% gold. Needs a Market.' },
  observatory:{ name: 'Observatory', cost: 220, up: 1, tech: 'physics', sci: 3, sciPct: 10, desc: '+3 science, +10% science.' },
  fortress:   { name: 'Star Fort',   cost: 260, up: 1, tech: 'milEngineering', def: 3, need: 'castle', desc: '+100 city HP and +5 city strength. Needs a Castle.' },
  factory:    { name: 'Factory',     cost: 320, up: 1, tech: 'industrialization', prod: 4, prodPct: 25, need: 'workshop', desc: '+4 production, +25% production. Needs a Workshop.' },
  hospital:   { name: 'Hospital',    cost: 330, up: 1, tech: 'chemistry', food: 2, housing: 8, need: 'aqueduct', desc: '+8 population cap, +2 food. Needs an Aqueduct.' },
  powerplant: { name: 'Power Plant', cost: 400, up: 2, tech: 'electricity', prodPct: 20, need: 'factory', desc: '+20% production. Needs a Factory.' },
  lab:        { name: 'Research Lab', cost: 450, up: 2, tech: 'computers', sci: 6, sciPct: 25, need: 'university', desc: '+6 science, +25% science. Needs a University.' },
  spaceport:  { name: 'Spaceport',   cost: 500, up: 2, tech: 'rocketry', need: 'factory', desc: 'Builds the space program. Needs a Factory.' },
};
const BUILDING_IDS = Object.keys(BUILDINGS);
// The space race: build all three, in order, in a city with a Spaceport
const PROJECTS = {
  satellite: { name: 'Earth Satellite', cost: 1000, tech: 'rocketry', desc: 'Space race, stage 1 of 3.' },
  moon:      { name: 'Moon Landing',    cost: 1400, tech: 'satellites', after: 'satellite', desc: 'Space race, stage 2 of 3.' },
  mars:      { name: 'Mars Colony',     cost: 1800, tech: 'fusion', after: 'moon', desc: 'Space race, stage 3 of 3. Completing it wins the game.' },
};
const PROJECT_IDS = Object.keys(PROJECTS);

// Eight difficulty levels. ai: computer yields multiplier; human: yours; combat: strength the AI
// gets in every fight; aggr: how warlike they are; start: extra starting units; peace: turns
// before computer leaders may start wars.
const DIFFS = [
  { key: 'beginner',   name: 'Beginner',   ai: 0.55, human: 1.25, combat: -4, aggr: 0.3,  start: [],                                   peace: 130 },
  { key: 'easy',       name: 'Easy',       ai: 0.7,  human: 1.12, combat: -2, aggr: 0.5,  start: [],                                   peace: 100 },
  { key: 'normal',     name: 'Normal',     ai: 0.85, human: 1,    combat: -1, aggr: 0.7,  start: [],                                   peace: 75 },
  { key: 'balanced',   name: 'Balanced',   ai: 1,    human: 1,    combat: 0,  aggr: 0.85, start: [],                                   peace: 60 },
  { key: 'tricky',     name: 'Tricky',     ai: 1.15, human: 1,    combat: 1,  aggr: 1,    start: ['warrior'],                          peace: 50 },
  { key: 'hard',       name: 'Hard',       ai: 1.3,  human: 1,    combat: 2,  aggr: 1.1,  start: ['warrior', 'archer'],                peace: 40 },
  { key: 'brutal',     name: 'Brutal',     ai: 1.5,  human: 1,    combat: 3,  aggr: 1.25, start: ['warrior', 'warrior', 'settler'],    peace: 30 },
  { key: 'impossible', name: 'Impossible', ai: 1.8,  human: 1,    combat: 5,  aggr: 1.4,  start: ['warrior', 'warrior', 'archer', 'settler', 'settler'], peace: 25 },
];
// Game speed scales every cost (production, science, culture, growth) and the turn limit
const SPEEDS = {
  quick:    { name: 'Quick',    mul: 0.67, turns: 250 },
  standard: { name: 'Standard', mul: 1,    turns: 350 },
  epic:     { name: 'Epic',     mul: 1.5,  turns: 500 },
  marathon: { name: 'Marathon', mul: 2.5,  turns: 800 },
};
const MAP_SIZES = { small: { name: 'Small', w: 44, h: 28, civs: 4 }, standard: { name: 'Standard', w: 60, h: 38, civs: 6 }, large: { name: 'Large', w: 76, h: 48, civs: 8 } };
const MAP_TYPES = { pangaea: 'Pangaea', highlands: 'Highlands', lakes: 'Great Lakes' };

// Each Frontier playstyle becomes a bonus that fits this game
const STYLE_BONUS = {
  Nuclear:        { desc: 'Nuclear bombs cost half. +10% science.', nukeCost: 0.5, sci: 1.1 },
  Conquest:       { desc: '+5 strength when attacking cities.', atkCity: 5 },
  Diplomacy:      { desc: 'Other leaders like you more (+3). +10% gold.', opinion: 3, gold: 1.1 },
  Blitz:          { desc: 'Mounted units get +1 move and +3 strength when attacking.', mountedMv: 1, mountedAtk: 3 },
  Naval:          { desc: 'Coastal cities get +1 food and +2 gold.', coastFood: 1, coastGold: 2 },
  Economy:        { desc: '+20% gold.', gold: 1.2 },
  Raider:         { desc: 'Defeating a unit earns gold equal to its strength.', killGold: 1 },
  Walls:          { desc: 'Walls, Castles and Star Forts cost half; cities +4 strength.', wallCost: 0.5, cityCS: 4 },
  Isolation:      { desc: '+4 strength fighting in your own territory.', homeCS: 4 },
  Alliances:      { desc: 'Other leaders like you more (+2) and make peace more easily.', opinion: 2, peaceEase: 0.3 },
  Expansion:      { desc: 'Settlers cost 35% less.', settlerCost: 0.65 },
  Industry:       { desc: '+12% production.', prod: 1.12 },
  Army:           { desc: 'Melee and anti-cavalry units cost 25% less.', meleeCost: 0.75 },
  Builder:        { desc: 'Buildings cost 20% less.', buildCost: 0.8 },
  Opportunist:    { desc: '+6 strength against damaged units.', vsHurt: 6 },
  Mountains:      { desc: 'Hills give +1 production.', hillProd: 1 },
  Cities:         { desc: 'Cities get +2 culture and +1 production.', cityCul: 2, cityProd: 1 },
  Trade:          { desc: '+2 gold in every city.', cityGold: 2 },
  Peace:          { desc: '+25% science while at peace.', peaceSci: 1.25 },
  Defender:       { desc: '+5 strength when defending.', defCS: 5 },
  Islands:        { desc: 'Coastal cities get +2 food.', coastFood: 2 },
  Liberator:      { desc: '+4 strength in foreign territory.', foreignCS: 4 },
  Pirate:         { desc: 'Capturing a city loots 3x the usual gold.', lootMul: 3 },
  Tall:           { desc: 'Cities with 6+ population get +20% science and production.', tall: 1.2 },
  Explorer:       { desc: 'All units see 1 tile further, and scouts cost no upkeep.', sight: 1 },
  Elite:          { desc: 'Military units have +5 strength but cost 20% more.', unitCS: 5, unitCost: 1.2 },
  Guerrilla:      { desc: '+5 strength in forests and hills.', roughCS: 5 },
  Mercenary:      { desc: 'Buying things with gold costs 30% less.', buyCost: 0.7 },
  Underdog:       { desc: '+5 strength against civilizations with more cities than you.', underdog: 5 },
  'Counter-attack': { desc: '+5 strength against civilizations that declared war on you.', revenge: 5 },
  'Anti-Nuclear': { desc: '+15% science; other leaders like you more (+2).', sci: 1.15, opinion: 2 },
  Superweapons:   { desc: 'Siege units get +6 ranged strength.', siegeRS: 6 },
};

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#a855f7', '#10b981', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#6366f1'];
// A few real city names for each civilization; extra cities get generated names
const CITY_NAMES = {
  India: ['Delhi', 'Mumbai', 'Varanasi', 'Kolkata', 'Pataliputra', 'Madurai', 'Agra'], Rome: ['Rome', 'Antium', 'Capua', 'Ravenna', 'Neapolis', 'Arretium', 'Ostia'],
  Egypt: ['Thebes', 'Memphis', 'Alexandria', 'Heliopolis', 'Giza', 'Abydos', 'Aswan'], Mongolia: ['Karakorum', 'Ulaanbaatar', 'Khovd', 'Erdenet', 'Darkhan', 'Olgii'],
  France: ['Paris', 'Lyon', 'Orleans', 'Marseille', 'Bordeaux', 'Reims', 'Nantes'], Britain: ['London', 'York', 'Nottingham', 'Bristol', 'Canterbury', 'Oxford', 'Leeds'],
  America: ['Washington', 'New York', 'Boston', 'Philadelphia', 'Chicago', 'Atlanta', 'Seattle'], Aztecs: ['Tenochtitlan', 'Texcoco', 'Tlatelolco', 'Tlacopan', 'Xochimilco', 'Coyoacan'],
  China: ['Xian', 'Beijing', 'Luoyang', 'Nanjing', 'Kaifeng', 'Hangzhou', 'Chengdu'], Japan: ['Kyoto', 'Edo', 'Osaka', 'Nara', 'Kamakura', 'Nagoya', 'Sendai'],
  Macedon: ['Pella', 'Aigai', 'Amphipolis', 'Thessalonica', 'Dion', 'Methone'], Greece: ['Athens', 'Corinth', 'Argos', 'Delphi', 'Thebes', 'Megara', 'Olympia'],
  Russia: ['Moscow', 'St. Petersburg', 'Novgorod', 'Kazan', 'Smolensk', 'Tver', 'Yaroslavl'], Germany: ['Aachen', 'Berlin', 'Hamburg', 'Cologne', 'Munich', 'Nuremberg', 'Frankfurt'],
  Spain: ['Madrid', 'Toledo', 'Seville', 'Barcelona', 'Valencia', 'Cordoba', 'Granada'], Arabia: ['Mecca', 'Medina', 'Damascus', 'Baghdad', 'Basra', 'Kufa', 'Mosul'],
  Mali: ['Niani', 'Timbuktu', 'Djenne', 'Gao', 'Kangaba', 'Walata'], Zulu: ['Ulundi', 'Nongoma', 'Eshowe', 'Mahlabatini', 'Babanango', 'Nkandla'],
  Babylon: ['Babylon', 'Ur', 'Uruk', 'Nippur', 'Kish', 'Borsippa', 'Sippar'], Persia: ['Pasargadae', 'Persepolis', 'Susa', 'Ecbatana', 'Bactra', 'Gordium'],
  Norway: ['Trondheim', 'Bergen', 'Oslo', 'Stavanger', 'Tromso', 'Hamar'], Inca: ['Cusco', 'Machu Picchu', 'Quito', 'Vilcabamba', 'Cajamarca', 'Tumbes'],
  Ottomans: ['Istanbul', 'Edirne', 'Bursa', 'Konya', 'Izmir', 'Sinop', 'Ankara'], Korea: ['Seoul', 'Gyeongju', 'Kaesong', 'Busan', 'Pyongyang', 'Gwangju'],
  Netherlands: ['Amsterdam', 'Rotterdam', 'Utrecht', 'Leiden', 'Groningen', 'Delft', 'Haarlem'], Brazil: ['Rio de Janeiro', 'Sao Paulo', 'Salvador', 'Recife', 'Brasilia', 'Belem'],
  Australia: ['Canberra', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Hobart'], Poland: ['Krakow', 'Warsaw', 'Gniezno', 'Poznan', 'Wroclaw', 'Gdansk', 'Lublin'],
  Huns: ['Atilla\'s Court', 'Szeged', 'Pannonhalma', 'Sirmium', 'Aquincum', 'Nesebar'], Carthage: ['Carthage', 'Utica', 'Hippo', 'Gades', 'Leptis', 'Hadrumetum'],
  Canada: ['Ottawa', 'Montreal', 'Quebec City', 'Toronto', 'Vancouver', 'Halifax', 'Winnipeg'], Ethiopia: ['Addis Ababa', 'Aksum', 'Gondar', 'Lalibela', 'Harar', 'Adwa'],
  Georgia: ['Tbilisi', 'Kutaisi', 'Mtskheta', 'Batumi', 'Gori', 'Telavi'], Sweden: ['Stockholm', 'Uppsala', 'Gothenburg', 'Malmo', 'Linkoping', 'Kalmar'],
  Majapahit: ['Trowulan', 'Kediri', 'Singhasari', 'Daha', 'Tuban', 'Gresik'], 'Gran Colombia': ['Bogota', 'Caracas', 'Quito', 'Panama', 'Cartagena', 'Medellin'],
  Nubia: ['Meroe', 'Napata', 'Kerma', 'Faras', 'Dongola', 'Soba'], 'Red Flag Fleet': ['Canton', 'Macau', 'Lantau', 'Zhuhai', 'Shantou', 'Haikou'],
  Maya: ['Caracol', 'Tikal', 'Calakmul', 'Palenque', 'Copan', 'Uxmal'], 'Māori': ['Hokianga', 'Rotorua', 'Waitangi', 'Kaikoura', 'Tauranga', 'Ruatahuna'],
  Sparta: ['Sparta', 'Amyclae', 'Gytheio', 'Pellana', 'Sellasia', 'Therapne'], Vietnam: ['Me Linh', 'Hanoi', 'Hue', 'Hoi An', 'Da Nang', 'Can Tho'],
  Venice: ['Venice', 'Padua', 'Verona', 'Treviso', 'Vicenza', 'Ragusa'], Mapuche: ['Ngulumapu', 'Valdivia', 'Temuco', 'Angol', 'Imperial', 'Osorno'],
  Scotland: ['Edinburgh', 'Glasgow', 'Stirling', 'Aberdeen', 'Perth', 'Inverness'], Maurya: ['Pataliputra', 'Ujjain', 'Taxila', 'Tosali', 'Suvarnagiri', 'Vidisha'],
  Syracuse: ['Syracuse', 'Gela', 'Akragas', 'Leontinoi', 'Kamarina', 'Tauromenion'], Austria: ['Vienna', 'Salzburg', 'Graz', 'Linz', 'Innsbruck', 'Prague'],
  Florence: ['Florence', 'Pisa', 'Siena', 'Lucca', 'Arezzo', 'Pistoia'], Hittites: ['Hattusa', 'Kanesh', 'Sapinuwa', 'Karkemish', 'Alalakh', 'Samuha'],
};
const SYL = ['ka', 'ra', 'to', 'mi', 'sa', 'len', 'dor', 'va', 'nis', 'bel', 'ar', 'ta', 'gor', 'el', 'mun', 'ri', 'os', 'pa', 'ly', 'stan'];

// ════════════════ Hex grid (pointy-top, odd rows shifted right) ════════════════
function makeGrid(W, H) {
  const N = W * H, NB = new Int32Array(N * 6).fill(-1);
  const EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]], ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = y & 1 ? ODD : EVEN;
    for (let k = 0; k < 6; k++) {
      const nx = x + d[k][0], ny = y + d[k][1];
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) NB[(y * W + x) * 6 + k] = ny * W + nx;
    }
  }
  const cube = t => { const x = t % W, y = (t / W) | 0, q = x - (y - (y & 1)) / 2; return [q, y]; };
  const dist = (a, b) => { const [q1, r1] = cube(a), [q2, r2] = cube(b); const dq = q1 - q2, dr = r1 - r2; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; };
  function nb(t) { const out = []; for (let k = 0; k < 6; k++) { const n = NB[t * 6 + k]; if (n >= 0) out.push(n); } return out; }
  // All tiles within distance r of t
  function ring(t, r) {
    const out = [], x0 = t % W, y0 = (t / W) | 0;
    for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++)
      for (let x = Math.max(0, x0 - r - 1); x <= Math.min(W - 1, x0 + r + 1); x++) { const u = y * W + x; if (dist(t, u) <= r) out.push(u); }
    return out;
  }
  return { W, H, N, NB, nb, dist, ring };
}

// ════════════════ Map generation ════════════════
function genMap(seed, sizeKey, type) {
  const S = MAP_SIZES[sizeKey] || MAP_SIZES.standard, W = S.w, H = S.h, N = W * H;
  const rng = mulberry32(seed ^ 0x51ed), n1 = makeNoise(rng), n2 = makeNoise(rng), n3 = makeNoise(rng), n4 = makeNoise(rng);
  const terr = new Uint8Array(N), relief = new Uint8Array(N), forest = new Uint8Array(N), res = new Uint8Array(N);
  const elev = new Float32Array(N);
  const landShare = type === 'lakes' ? 0.5 : 0.46;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y * W + x, nx = x / W - 0.5, ny = y / H - 0.5;
    const radial = Math.sqrt((nx * 1.15) ** 2 + (ny * 1.35) ** 2);
    let e = fbm(n1, x * 0.09, y * 0.09, 5) - radial * 0.9;
    if (type === 'lakes') e -= Math.max(0, 0.18 - Math.abs(fbm(n4, x * 0.06, y * 0.06, 3) - 0.5)) * 1.4;
    elev[t] = e;
  }
  const sorted = Array.from(elev).sort((a, b) => b - a), sea = sorted[Math.floor(N * landShare)];
  for (let t = 0; t < N; t++) terr[t] = elev[t] > sea ? GRASS : OCEAN;
  // Keep the largest landmass; turn small islands into sea so everyone can reach everyone
  const body = new Int32Array(N).fill(-1), sizes = [];
  const G = makeGrid(W, H);
  for (let t = 0; t < N; t++) {
    if (terr[t] === OCEAN || body[t] >= 0) continue;
    const id = sizes.length, q = [t]; body[t] = id; let n = 0;
    while (q.length) { const u = q.pop(); n++; for (const v of G.nb(u)) if (terr[v] !== OCEAN && body[v] < 0) { body[v] = id; q.push(v); } }
    sizes.push(n);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  for (let t = 0; t < N; t++) if (terr[t] !== OCEAN && body[t] !== main) terr[t] = OCEAN;
  // Relief, climate, forests
  const mtn = type === 'highlands' ? 0.13 : 0.07, hills = type === 'highlands' ? 0.3 : 0.17;
  const land = []; for (let t = 0; t < N; t++) if (terr[t] !== OCEAN) land.push(t);
  const ridge = t => { const x = t % W, y = (t / W) | 0; return 1 - Math.abs(fbm(n2, x * 0.12, y * 0.12, 4) - 0.5) * 2; };
  const rs = land.map(t => [t, ridge(t) + rng() * 0.08]).sort((a, b) => b[1] - a[1]);
  rs.forEach(([t], i) => { if (i < land.length * mtn) relief[t] = MOUNTAIN; else if (i < land.length * (mtn + hills)) relief[t] = HILLS; });
  for (const t of land) {
    const x = t % W, y = (t / W) | 0, lat = Math.abs(y / (H - 1) - 0.5) * 2 + (fbm(n3, x * 0.15, y * 0.15, 2) - 0.5) * 0.25;
    const moist = fbm(n3, x * 0.07 + 40, y * 0.07, 4);
    if (lat > 0.9) terr[t] = SNOW;
    else if (lat > 0.74) terr[t] = TUNDRA;
    else if (moist < 0.38 && lat < 0.6) terr[t] = DESERT;
    else terr[t] = moist > 0.5 ? GRASS : PLAINS;
    if (relief[t] !== MOUNTAIN && terr[t] !== DESERT && terr[t] !== SNOW && moist + rng() * 0.25 > 0.66) forest[t] = 1;
  }
  for (let t = 0; t < N; t++) if (terr[t] === OCEAN && G.nb(t).some(u => !TERRAIN[terr[u]].water)) terr[t] = COAST;
  // Resources
  const R = RES_IDS.map(k => RESOURCES[k]);
  for (let t = 0; t < N; t++) {
    if (terr[t] === OCEAN || relief[t] === MOUNTAIN) continue;
    if (rng() > (terr[t] === COAST ? 0.07 : 0.11)) continue;
    const tile = { terr: terr[t], relief: relief[t], forest: forest[t] };
    const fits = R.map((r, i) => r.on(tile) ? i + 1 : 0).filter(Boolean);
    if (fits.length) res[t] = fits[rng() * fits.length | 0];
  }
  return { W, H, terr: Array.from(terr), relief: Array.from(relief), forest: Array.from(forest), res: Array.from(res) };
}

// ════════════════ New game ════════════════
// cfg: { seed, size, type, diff (0-7), speed, leader (your leader index, -1 random), name, ais, aiLeaders }
function newGame(cfg) {
  const seed = cfg.seed >>> 0 || (Math.random() * 2 ** 31) >>> 0;
  const size = MAP_SIZES[cfg.size] ? cfg.size : 'standard', type = MAP_TYPES[cfg.type] ? cfg.type : 'pangaea';
  const diff = clamp(cfg.diff | 0, 0, 7), speed = SPEEDS[cfg.speed] ? cfg.speed : 'standard';
  const ais = clamp(cfg.ais == null ? MAP_SIZES[size].civs - 1 : cfg.ais | 0, 1, 9);
  const map = genMap(seed, size, type);
  const N = map.W * map.H;
  const S = {
    v: 1, seed, turn: 1, cfg: { size, type, diff, speed, ais, human: cfg.human !== false }, rngState: seed ^ 0x2545f491,
    map, owner: new Array(N).fill(-1), tileCity: new Array(N).fill(-1), dev: new Array(N).fill(0), fallout: new Array(N).fill(0),
    players: [], cities: [], units: [], nextUnit: 1, notes: [], fx: [], over: null, cityNameSeq: 0,
  };
  const rng = mulberry32(seed ^ 0x77);
  const taken = new Set();
  const pickLeader = want => {
    if (want >= 0 && LEADERS[want] && !taken.has(want)) { taken.add(want); return want; }
    let i; do { i = rng() * LEADERS.length | 0; } while (taken.has(i)); taken.add(i); return i;
  };
  const humanLeader = S.cfg.human ? pickLeader(cfg.leader == null ? -1 : cfg.leader) : -1;
  const count = ais + (S.cfg.human ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const human = S.cfg.human && i === 0;
    const li = human ? humanLeader : pickLeader(Array.isArray(cfg.aiLeaders) && cfg.aiLeaders[i - 1] != null ? cfg.aiLeaders[i - 1] : -1);
    const L = LEADERS[li];
    S.players.push({
      id: i, leader: li, civ: L.civ, name: human && cfg.name ? String(cfg.name).slice(0, 20) : L.name, human, color: COLORS[i % COLORS.length], alive: true,
      gold: 0, sciProg: 0, research: null, queue: [], techs: [], seen: new Array(N).fill(0), met: [], wars: {}, peaceTurn: {}, warStarted: {}, declaredOnMe: {},
      opinionMods: {}, capital: -1, space: [], revealed: false, nukesUsed: 0, score: 0, cityNames: 0, ai: human ? null : { site: {}, target: -1, lastWar: 0 },
    });
  }
  // Start spots: good land, far apart
  const game = makeGame(S);
  game._placeStarts();
  return game;
}
function loadGame(json) {
  const S = typeof json === 'string' ? JSON.parse(json) : json;
  if (!S || S.v !== 1) throw new Error('Unknown save');
  return makeGame(S);
}

// ════════════════ Game ════════════════
function makeGame(S) {
  const M = S.map, W = M.W, H = M.H, N = W * H, G = makeGrid(W, H);
  const D = DIFFS[S.cfg.diff], SP = SPEEDS[S.cfg.speed];
  let rs = S.rngState >>> 0;
  const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ t >>> 15, 1 | t); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const P = id => S.players[id];
  const L = p => LEADERS[p.leader];
  const bonus = p => STYLE_BONUS[L(p).style] || {};
  const T = p => L(p).t;
  const cityAt = t => { const c = S.cities.find(c => c.t === t && c.alive); return c || null; };
  const unitAt = t => S.units.find(u => u.t === t && !u.dead) || null;
  const unitsAt = t => S.units.filter(u => u.t === t && !u.dead);
  const hasTech = (p, k) => !k || p.techs.includes(k);
  const atWar = (a, b) => a !== b && !!P(a).wars[b];
  const isWater = t => TERRAIN[M.terr[t]].water;
  const passable = t => !isWater(t) && M.relief[t] !== MOUNTAIN;
  const note = (pid, text, kind, at) => { S.notes.push({ pid, text, kind: kind || 'info', at: at == null ? -1 : at, turn: S.turn }); if (S.notes.length > 200) S.notes.splice(0, S.notes.length - 200); };
  const fx = e => { S.fx.push(e); if (S.fx.length > 100) S.fx.shift(); };
  const cityList = p => S.cities.filter(c => c.alive && c.owner === p.id);
  const unitList = p => S.units.filter(u => !u.dead && u.owner === p.id);
  const eraOf = p => p.techs.reduce((m, k) => Math.max(m, TECHS[k].era), 0);
  const yieldMul = p => p.human ? D.human : D.ai;

  // ──────────── Tiles ────────────
  function tileYield(t, p) {
    const tr = M.terr[t];
    let [f, pr, g] = TERRAIN[tr].y;
    if (M.relief[t] === HILLS) pr += 1;
    if (M.forest[t]) { f = Math.min(f, 1); pr += 1; }
    if (M.res[t]) { const r = RESOURCES[RES_IDS[M.res[t] - 1]].y; f += r[0]; pr += r[1]; g += r[2]; }
    // Developed tiles: farms, mines, lumber mills and fishing boats, better with later techs
    if (S.dev[t] >= DEVELOP_TURNS) {
      if (TERRAIN[tr].water) f += 1;
      else if (M.relief[t] === HILLS) pr += 1 + (p && hasTech(p, 'industrialization') ? 1 : 0);
      else if (M.forest[t]) pr += 1 + (p && hasTech(p, 'industrialization') ? 1 : 0);
      else if (tr === DESERT) g += 2;
      else f += 1 + (p && hasTech(p, 'chemistry') ? 1 : 0);
    }
    if (p && M.relief[t] === HILLS) pr += bonus(p).hillProd || 0;
    if (S.fallout[t] > S.turn) { f = 0; pr = 0; g = 0; }
    return [f, pr, g];
  }
  const isCoastal = t => G.nb(t).some(isWater);

  // ──────────── Cities ────────────
  function cityName(p) {
    const list = CITY_NAMES[p.civ] || [];
    const used = new Set(S.cities.map(c => c.name));
    for (const n of list) if (!used.has(n)) return n;
    for (;;) {
      const n = SYL[rand() * SYL.length | 0] + SYL[rand() * SYL.length | 0] + (rand() < 0.4 ? SYL[rand() * SYL.length | 0] : '');
      const name = n[0].toUpperCase() + n.slice(1);
      if (!used.has(name)) return name;
    }
  }
  function canFound(p, t) {
    if (!(t >= 0 && t < N) || !passable(t)) return 'Cities must be on open land';
    if (S.owner[t] >= 0 && S.owner[t] !== p.id) return "You can't settle in another civilization's territory";
    for (const c of S.cities) if (c.alive && G.dist(c.t, t) < 4) return 'Too close to another city (needs 3 tiles between cities)';
    return null;
  }
  function foundCity(p, t) {
    const c = {
      id: S.cities.length, owner: p.id, orig: p.id, t, name: cityName(p), pop: 1, food: 0, prod: 0, building: null, buildings: [],
      hp: 200, culture: 0, grown: 0, capital: !cityList(p).length, origCapital: !cityList(p).length, founded: S.turn, alive: true, focus: 'balanced', struck: false, worked: [],
    };
    S.cities.push(c);
    if (c.capital) p.capital = c.id;
    claimTile(c, t);
    for (const u of G.nb(t)) if (S.owner[u] < 0) claimTile(c, u);
    assignTiles(c);
    return c;
  }
  function claimTile(c, t) { S.owner[t] = c.owner; S.tileCity[t] = c.id; }
  const has = (c, b) => c.buildings.includes(b);
  const wallTier = c => (has(c, 'walls') ? 1 : 0) + (has(c, 'castle') ? 1 : 0) + (has(c, 'fortress') ? 1 : 0);
  const maxHP = c => 200 + wallTier(c) * 100;
  const housing = c => 8 + BUILDING_IDS.reduce((n, b) => n + (has(c, b) ? BUILDINGS[b].housing || 0 : 0), 0);
  // City defence follows the best melee unit the owner actually fields (not just has researched)
  function bestMelee(p) { let b = 18; for (const u of unitList(p)) { const U = UNITS[u.type]; if (U.cls === 'melee' || U.cls === 'anti') b = Math.max(b, U.cs); } return b; }
  function cityStrength(c) {
    const p = P(c.owner);
    let s = bestMelee(p) - 4 + wallTier(c) * 5 + (c.capital ? 2 : 0) + Math.floor(c.pop / 3) + (bonus(p).cityCS || 0);
    const g = unitsAt(c.t).find(u => MILITARY.has(UNITS[u.type].cls));
    if (g) s += 2;
    if (!p.human) s += D.combat;
    return s - Math.round((maxHP(c) - c.hp) / 40);
  }
  // Which tiles the city works: the best `pop` of its own tiles, by its focus
  function assignTiles(c) {
    const p = P(c.owner), w = { balanced: [1.35, 1, 0.6], food: [2, 0.7, 0.4], production: [0.8, 2, 0.4], gold: [0.8, 0.7, 1.8] }[c.focus] || [1.35, 1, 0.6];
    const starving = c.pop >= housing(c) ? 0.6 : 1;
    const opts = [];
    for (const t of G.ring(c.t, 3)) {
      if (t === c.t || S.tileCity[t] !== c.id) continue;
      const [f, pr, g] = tileYield(t, p);
      opts.push([t, f * w[0] * starving + pr * w[1] + g * w[2] + (S.dev[t] > 0 ? 0.05 : 0)]);
    }
    opts.sort((a, b) => b[1] - a[1]);
    c.worked = opts.slice(0, c.pop).map(o => o[0]);
  }
  // Yields per turn: { food, prod, gold, sci, cul } (food is the surplus after eating)
  function cityYields(c) {
    const p = P(c.owner), B = bonus(p);
    let [f, pr, g] = tileYield(c.t, p);
    f = Math.max(f, 3); pr = Math.max(pr, 1) + (B.cityProd || 0); g = Math.max(g, 1) + (B.cityGold || 0);
    for (const t of c.worked) { const y = tileYield(t, p); f += y[0]; pr += y[1]; g += y[2]; }
    g += c.pop * 0.3;   // taxes
    let sci = 1 + c.pop * 0.6, cul = 1 + (B.cityCul || 0);
    let pp = 0, gp = 0, sp = 0;
    for (const b of c.buildings) {
      const X = BUILDINGS[b];
      f += X.food || 0; pr += X.prod || 0; g += X.gold || 0; sci += X.sci || 0; cul += X.cul || 0;
      pp += X.prodPct || 0; gp += X.goldPct || 0; sp += X.sciPct || 0;
    }
    if (c.capital) { pr += 2; g += 3; sci += 2; cul += 1; }
    if (isCoastal(c.t)) { f += B.coastFood || 0; g += B.coastGold || 0; }
    const tall = B.tall && c.pop >= 6 ? B.tall : 1;
    const m = yieldMul(p);
    pr *= (1 + pp / 100) * (B.prod || 1) * tall * m;
    g *= (1 + gp / 100) * (B.gold || 1) * m;
    sci *= (1 + sp / 100) * (B.sci || 1) * tall * m * (B.peaceSci && !Object.keys(p.wars).length ? B.peaceSci : 1);
    cul *= m;
    const eat = c.pop * 2;
    return { food: f - eat, foodIn: f, prod: pr, gold: g, sci, cul };
  }
  const growCost = c => Math.round((15 + 6 * (c.pop - 1) + Math.pow(c.pop - 1, 1.7)) * SP.mul);
  const borderCost = c => Math.round((10 + 6 * Math.pow(c.grown, 1.3)) * SP.mul);

  // ──────────── Costs ────────────
  function unitCost(p, k) {
    const U = UNITS[k], B = bonus(p);
    let c = U.cost * SP.mul;
    if (k === 'settler') c = (U.cost + 12 * cityList(p).length) * SP.mul * (B.settlerCost || 1);
    if ((U.cls === 'melee' || U.cls === 'anti') && B.meleeCost) c *= B.meleeCost;
    if (MILITARY.has(U.cls) && B.unitCost) c *= B.unitCost;
    if (k === 'nuke' && B.nukeCost) c *= B.nukeCost;
    return Math.round(c);
  }
  function buildingCost(p, k) {
    const B = bonus(p);
    let c = BUILDINGS[k].cost * SP.mul * (B.buildCost || 1);
    if (BUILDINGS[k].def && B.wallCost) c *= B.wallCost;
    return Math.round(c);
  }
  const projectCost = k => Math.round(PROJECTS[k].cost * SP.mul);
  function itemCost(p, item) {
    const [kind, k] = item.split(':');
    return kind === 'u' ? unitCost(p, k) : kind === 'b' ? buildingCost(p, k) : projectCost(k);
  }
  function techCost(p, k) { return Math.round(TECHS[k].cost * 1.35 * SP.mul * (1 + 0.04 * Math.max(0, cityList(p).length - 1))); }
  const buyCost = (p, c) => { if (!c.building) return Infinity; const left = Math.max(0, itemCost(p, c.building) - c.prod); return Math.round((left * 2.2 + 10) * (bonus(p).buyCost || 1)); };
  function upkeep(p) {
    let g = 0, mil = 0;
    for (const c of cityList(p)) for (const b of c.buildings) g += BUILDINGS[b].up;
    for (const u of unitList(p)) { const U = UNITS[u.type]; if (MILITARY.has(U.cls) && !(U.cls === 'recon' && bonus(p).sight)) mil += 1 + Math.floor(TECHS[U.tech] ? TECHS[U.tech].era / 2 : 0); }
    const free = 2 + cityList(p).length;
    return g + Math.max(0, mil - free);
  }

  // What a city may build: [{ item: 'u:warrior', name, cost }]
  function buildable(c) {
    const p = P(c.owner), out = [];
    for (const k of UNIT_IDS) {
      const U = UNITS[k];
      if (!hasTech(p, U.tech)) continue;
      if (k === 'settler' && c.pop < 2) continue;
      if (UNITS[k].up && hasTech(p, UNITS[UNITS[k].up].tech) && k !== 'settler') continue;   // obsolete
      out.push({ item: 'u:' + k, name: U.name, cost: unitCost(p, k) });
    }
    for (const k of BUILDING_IDS) {
      const X = BUILDINGS[k];
      if (has(c, k) || !hasTech(p, X.tech) || (X.need && !has(c, X.need))) continue;
      out.push({ item: 'b:' + k, name: X.name, cost: buildingCost(p, k) });
    }
    if (has(c, 'spaceport')) for (const k of PROJECT_IDS) {
      const X = PROJECTS[k];
      if (!hasTech(p, X.tech) || p.space.includes(k) || (X.after && !p.space.includes(X.after))) continue;
      if (S.cities.some(o => o.alive && o.owner === p.id && o.building === 'p:' + k && o !== c)) continue;
      out.push({ item: 'p:' + k, name: X.name, cost: projectCost(k) });
    }
    return out;
  }
  function setProduction(c, item) {
    if (!buildable(c).some(b => b.item === item)) return 'Not available';
    if (c.building !== item) { if (c.building && item.split(':')[0] !== c.building.split(':')[0]) c.prod = Math.floor(c.prod * 0.5); c.building = item; }
    return null;
  }
  function finishItem(c, item) {
    const p = P(c.owner), [kind, k] = item.split(':');
    if (kind === 'u') {
      if (k === 'settler') { if (c.pop < 2) return false; c.pop--; assignTiles(c); }
      const spot = freeSpot(c.t, k);
      if (spot < 0) return false;
      addUnit(p, k, spot);
      if (p.human) note(p.id, `${c.name} trained a ${UNITS[k].name}`, 'good', c.t);
      if (k === 'nuke' && !p.revealed && L(p).hidden && !p.human) revealGandhi(p);
    } else if (kind === 'b') {
      c.buildings.push(k);
      if (BUILDINGS[k].def) c.hp = Math.min(maxHP(c), c.hp + 100);
      if (p.human) note(p.id, `${c.name} built a ${BUILDINGS[k].name}`, 'good', c.t);
    } else {
      p.space.push(k);
      note(-1, `${civName(p)} completed the ${PROJECTS[k].name}!`, p.human ? 'good' : 'warn', c.t);
      if (k === 'mars') endGame(p.id, 'space');
    }
    return true;
  }
  // A free tile for a new unit: the city itself, else next to it (one military + one civilian per tile)
  function freeSpot(t, k) {
    const civ = UNITS[k].cls === 'civ' || UNITS[k].cls === 'nuke';
    const ok = u => passable(u) && !unitsAt(u).some(x => (UNITS[x.type].cls === 'civ' || UNITS[x.type].cls === 'nuke') === civ);
    if (ok(t)) return t;
    for (const u of G.nb(t)) if (ok(u) && S.owner[u] === S.owner[t]) return u;
    return -1;
  }
  const civName = p => p.human ? `${p.name} (${p.civ})` : `${L(p).name} of ${p.civ}`;

  // ──────────── Units ────────────
  function addUnit(p, k, t) {
    const U = UNITS[k];
    const u = { id: S.nextUnit++, owner: p.id, type: k, t, hp: 100, mv: maxMoves(p, k), fort: 0, sleep: false, dest: -1, acted: false, moved: false };
    S.units.push(u);
    return u;
  }
  function maxMoves(p, k) { const U = UNITS[k]; return U.mv + (U.cls === 'mounted' ? bonus(p).mountedMv || 0 : 0); }
  const isMil = u => MILITARY.has(UNITS[u.type].cls);
  const sightOf = u => (UNITS[u.type].sight || 2) + (bonus(P(u.owner)).sight || 0);
  // Moving into t costs this many moves (Infinity = can't)
  function stepCost(u, t) {
    if (!passable(t)) return Infinity;
    const o = S.owner[t];
    if (o >= 0 && o !== u.owner && !atWar(u.owner, o)) return Infinity;   // closed borders
    return M.relief[t] === HILLS || M.forest[t] ? 2 : 1;
  }
  // Is there something hostile on t that blocks u?
  function hostileAt(u, t) {
    for (const x of unitsAt(t)) if (x.owner !== u.owner) return true;
    const c = cityAt(t);
    return !!(c && c.owner !== u.owner);
  }
  const zoc = (u, t) => UNITS[u.type].cls !== 'recon' && G.nb(t).some(n => unitsAt(n).some(x => x.owner !== u.owner && atWar(u.owner, x.owner) && isMil(x)) || (cityAt(n) && cityAt(n).owner !== u.owner && atWar(u.owner, cityAt(n).owner)));
  // A* over move costs. Returns the tile list from u (exclusive) to goal, or null
  function findPath(u, goal, maxLen = 400) {
    if (goal === u.t) return [];
    const g = new Map([[u.t, 0]]), prev = new Map(), open = [[G.dist(u.t, goal), u.t]];
    let n = 0;
    while (open.length && n++ < 6000) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === goal) break;
      for (const nx of G.nb(cur)) {
        let c = stepCost(u, nx);
        if (c === Infinity) continue;
        if (nx !== goal && hostileAt(u, nx)) continue;
        const ng = g.get(cur) + c;
        if (ng > maxLen) continue;
        if (!g.has(nx) || ng < g.get(nx)) { g.set(nx, ng); prev.set(nx, cur); open.push([ng + G.dist(nx, goal), nx]); }
      }
    }
    if (!prev.has(goal)) return null;
    const path = [];
    for (let t = goal; t !== u.t; t = prev.get(t)) path.push(t);
    return path.reverse();
  }
  // Can u stop on t? (one military and one civilian unit per tile)
  function canStop(u, t) {
    const civ = !isMil(u);
    return !unitsAt(t).some(x => x !== u && (x.owner !== u.owner || isMil(x) !== civ));
  }
  // Walk u toward goal as far as this turn's moves allow. Remembers the goal for next turns.
  function moveUnit(u, goal) {
    if (u.dead || u.mv <= 0) return 'No moves left';
    if (UNITS[u.type].cls === 'nuke') return 'Launch nukes at a target instead';
    const path = findPath(u, goal);
    if (!path) return "Can't get there";
    u.dest = goal; u.sleep = false; u.fort = 0;
    for (const t of path) {
      if (u.mv <= 0) break;
      if (hostileAt(u, t)) { u.dest = -1; break; }
      const cost = stepCost(u, t);
      if (cost === Infinity) { u.dest = -1; break; }
      const left = u.mv - cost;
      // don't end the turn on a tile someone else is using
      if (!canStop(u, t) && (left <= 0 || t === goal)) { if (t === goal) u.dest = -1; break; }
      u.t = t; u.mv = Math.max(0, left); u.moved = true;
      // stepping next to an enemy unit or city ends the move (zone of control)
      if (zoc(u, t)) u.mv = 0;
      reveal(P(u.owner), t, sightOf(u));
    }
    if (u.t === goal) u.dest = -1;
    return null;
  }

  // ──────────── Combat ────────────
  // Strength of u in a fight. ranged: using its ranged strength; att: u is attacking
  function strength(u, opp, att, ranged, vsCity) {
    const U = UNITS[u.type], p = P(u.owner), B = bonus(p);
    let s = ranged ? (U.rs || 0) : U.cs;
    s -= Math.round((100 - u.hp) / 10);
    if (!att) {
      if (M.relief[u.t] === HILLS) s += 3;
      if (M.forest[u.t]) s += 3;
      s += Math.min(2, u.fort) * 3;
      s += B.defCS || 0;
      // support: friendly units next to the defender
      s += Math.min(3, G.nb(u.t).filter(n => unitsAt(n).some(x => x.owner === u.owner && isMil(x))).length) * 2;
    }
    if (opp && !vsCity) {
      const O = UNITS[opp.type];
      if (U.cls === 'anti' && O.cls === 'mounted') s += 10;
      if (opp.hp < 50) s += B.vsHurt || 0;
      if (cityList(P(opp.owner)).length > cityList(p).length) s += B.underdog || 0;
      if (P(opp.owner).id in p.declaredOnMe) s += B.revenge || 0;
    }
    if (att && !ranged && opp) {
      // flanking: every other friendly unit next to the target adds strength (focus your push)
      const tgt = vsCity ? opp.t : opp.t;
      s += Math.min(4, G.nb(tgt).filter(n => n !== u.t && unitsAt(n).some(x => x.owner === u.owner && isMil(x))).length) * 2;
    }
    if (att && vsCity) { s += B.atkCity || 0; if (ranged && U.cls !== 'siege') s -= 10; }
    if (att && U.cls === 'mounted') s += B.mountedAtk || 0;
    if (U.cls === 'siege' && ranged) { s += B.siegeRS || 0; s += vsCity ? 8 : -8; }   // artillery wrecks walls, struggles against armies
    if (MILITARY.has(U.cls)) s += B.unitCS || 0;
    const own = S.owner[u.t];
    if (own === u.owner) s += B.homeCS || 0; else if (own >= 0) s += B.foreignCS || 0;
    if ((M.relief[u.t] === HILLS || M.forest[u.t])) s += B.roughCS || 0;
    if (!p.human) s += D.combat;
    return Math.max(1, s);
  }
  const dmg = (a, d) => Math.round(30 * Math.exp((a - d) / 25) * (0.8 + rand() * 0.4));
  // Expected damage numbers (no randomness), for previews and the AI
  function preview(u, t) {
    const ranged = !!UNITS[u.type].rs && G.dist(u.t, t) >= 1 && UNITS[u.type].cls !== 'melee';
    const c = cityAt(t), d = c && c.owner !== u.owner ? null : unitsAt(t).find(x => x.owner !== u.owner && isMil(x)) || unitsAt(t).find(x => x.owner !== u.owner);
    if (c && c.owner !== u.owner) {
      const A = strength(u, c, true, ranged, true), Dd = cityStrength(c);
      return { vs: 'city', city: c, toThem: Math.round(30 * Math.exp((A - Dd) / 25)), toMe: ranged ? 0 : Math.round(30 * Math.exp((Dd - A) / 25)), A, D: Dd, ranged };
    }
    if (!d) return null;
    if (!isMil(d)) return { vs: 'civ', unit: d, toThem: 100, toMe: 0, A: 0, D: 0, ranged };
    const A = strength(u, d, true, ranged, false), Dd = strength(d, u, false, false, false);
    return { vs: 'unit', unit: d, toThem: Math.round(30 * Math.exp((A - Dd) / 25)), toMe: ranged ? 0 : Math.round(30 * Math.exp((Dd - A) / 25)), A, D: Dd, ranged };
  }
  // u attacks tile t. Returns an error string, or null.
  function attack(u, t, declare) {
    if (u.dead || u.acted || u.mv <= 0) return 'This unit has already acted this turn';
    const U = UNITS[u.type];
    if (!MILITARY.has(U.cls)) return "This unit can't attack";
    const c = cityAt(t), def = unitsAt(t).filter(x => x.owner !== u.owner);
    const enemy = c && c.owner !== u.owner ? c.owner : def.length ? def[0].owner : -1;
    if (enemy < 0) return 'Nothing to attack there';
    if (!atWar(u.owner, enemy)) {
      if (!declare) return 'war?';
      const e = declareWar(u.owner, enemy); if (e) return e;
    }
    const d = G.dist(u.t, t), ranged = !!U.rs && U.cls !== 'melee';
    if (ranged ? d > U.rng : d !== 1) return ranged ? 'Out of range' : 'Melee units must be next to their target';
    if (!ranged && stepCost(u, t) === Infinity && !c) return "Can't attack across that terrain";
    const pv = preview(u, t);
    if (!pv) return 'Nothing to attack there';
    const me = P(u.owner);
    u.acted = true; u.fort = 0; u.sleep = false; u.moved = true;
    if (pv.vs === 'city') {
      const cc = pv.city, A = pv.A, Dd = pv.D;
      const toCity = dmg(A, Dd), toMe = ranged ? 0 : dmg(Dd, A);
      cc.hp = Math.max(0, cc.hp - toCity);
      fx({ k: ranged ? 'shot' : 'hit', from: u.t, to: t, n: toCity });
      if (!ranged) { u.hp -= toMe; u.mv = 0; if (u.hp <= 0) { killUnit(u, P(cc.owner)); return null; } }
      else u.mv = 0;
      if (!ranged && cc.hp <= 0 && U.cls !== 'siege') captureCity(cc, u);
      return null;
    }
    if (pv.vs === 'civ') {
      // capture a settler (it becomes yours) if it's alone
      const x = pv.unit;
      if (ranged) { killUnit(x, me); u.mv = 0; return null; }
      if (x.type === 'settler') { x.owner = u.owner; x.mv = 0; x.dest = -1; if (P(enemy).human) note(enemy, `Your Settler was captured by ${civName(me)}`, 'bad', t); }
      else killUnit(x, me);
      if (canStop(u, t)) { u.t = t; reveal(me, t, sightOf(u)); }
      u.mv = 0;
      return null;
    }
    const x = pv.unit, A = pv.A, Dd = pv.D;
    const toThem = dmg(A, Dd), toMe = ranged ? 0 : dmg(Dd, A);
    x.hp -= toThem; u.hp -= toMe;
    fx({ k: ranged ? 'shot' : 'hit', from: u.t, to: t, n: toThem });
    u.mv = ranged || U.cls !== 'mounted' ? 0 : Math.max(0, u.mv - 1);
    x.fort = 0;
    if (x.hp <= 0) {
      killUnit(x, me);
      // melee winners advance into the empty tile, taking any civilians there
      if (!ranged && u.hp > 0 && !cityAt(t)) {
        for (const y of unitsAt(t)) if (y.owner !== u.owner) { if (y.type === 'settler') { y.owner = u.owner; } else killUnit(y, me); }
        if (canStop(u, t)) { u.t = t; reveal(me, t, sightOf(u)); }
      }
    }
    if (u.hp <= 0) killUnit(u, P(x.owner));
    return null;
  }
  function killUnit(u, by) {
    if (u.dead) return;
    u.dead = true;
    if (by && bonus(by).killGold && isMil(u)) by.gold += UNITS[u.type].cs;
    const owner = P(u.owner);
    if (owner.human) note(owner.id, `Your ${UNITS[u.type].name} was destroyed${by ? ' by ' + civName(by) : ''}`, 'bad', u.t);
    else if (by && by.human) note(by.id, `You destroyed a ${civName(owner).split(' of ').pop()} ${UNITS[u.type].name}`, 'good', u.t);
  }
  function cityStrike(c, t) {
    if (c.struck) return 'This city has already attacked this turn';
    if (G.dist(c.t, t) > 2) return 'Out of range (2 tiles)';
    const x = unitsAt(t).find(y => y.owner !== c.owner && atWar(c.owner, y.owner));
    if (!x) return 'No enemy unit there';
    c.struck = true;
    const A = cityStrength(c) - 2, Dd = strength(x, null, false, false, false);
    const n = dmg(A, Dd);
    x.hp -= n;
    fx({ k: 'shot', from: c.t, to: t, n });
    if (x.hp <= 0) killUnit(x, P(c.owner));
    return null;
  }
  function captureCity(c, u) {
    const old = P(c.owner), me = P(u.owner);
    for (const x of unitsAt(c.t)) if (x.owner !== u.owner) killUnit(x, me);
    const loot = Math.round((20 + c.pop * 15) * (bonus(me).lootMul || 1));
    me.gold += Math.min(old.gold, loot) + 10; old.gold = Math.max(0, old.gold - loot);
    c.owner = me.id; c.pop = Math.max(1, Math.floor(c.pop * 0.75)); c.hp = 60; c.building = null; c.prod = 0;
    c.capital = false;
    c.buildings = c.buildings.filter(b => b !== 'walls' && b !== 'castle' && b !== 'fortress' || rand() < 0.5);
    for (let t = 0; t < N; t++) if (S.tileCity[t] === c.id) S.owner[t] = me.id;
    u.t = c.t; u.mv = 0;
    assignTiles(c);
    reveal(me, c.t, 3);
    note(-1, `${civName(me)} captured ${c.name} from ${civName(old)}`, me.human ? 'good' : old.human ? 'bad' : 'warn', c.t);
    if (old.capital === c.id) {
      // the old capital moves to their biggest city
      const rest = cityList(old).sort((a, b) => b.pop - a.pop);
      old.capital = rest.length ? rest[0].id : -1;
      if (rest.length) rest[0].capital = true;
    }
    if (!cityList(old).length) eliminate(old, me);
    checkDomination();
  }
  function eliminate(p, by) {
    p.alive = false;
    for (const u of unitList(p)) u.dead = true;
    for (const q of S.players) { delete q.wars[p.id]; }
    p.wars = {};
    note(-1, `${civName(p)} has been destroyed${by ? ' by ' + civName(by) : ''}`, p.human ? 'bad' : 'warn');
    if (p.human) endGame(-1, 'defeat');
  }

  // ──────────── Nukes ────────────
  function launchNuke(u, t) {
    if (UNITS[u.type].cls !== 'nuke') return 'Not a nuke';
    if (G.dist(u.t, t) > NUKE_RANGE) return `Out of range (${NUKE_RANGE} tiles)`;
    const me = P(u.owner);
    const victims = new Set();
    for (const n of G.ring(t, 1)) { if (S.owner[n] >= 0 && S.owner[n] !== me.id) victims.add(S.owner[n]); for (const x of unitsAt(n)) if (x.owner !== me.id) victims.add(x.owner); }
    for (const v of victims) if (!atWar(me.id, v)) return 'You can only nuke civilizations you are at war with';
    u.dead = true; me.nukesUsed++;
    fx({ k: 'nuke', from: u.t, to: t });
    for (const n of G.ring(t, 1)) {
      for (const x of unitsAt(n)) killUnit(x, null);
      S.fallout[n] = S.turn + 12;
      const c = cityAt(n);
      if (c) { c.pop = Math.max(1, Math.floor(c.pop / 2)); c.hp = 0; assignTiles(c); }
    }
    for (const q of S.players) if (q !== me && q.alive) addOpinion(q, me.id, 'nuked', -8);
    note(-1, `${civName(me)} launched a nuclear bomb!`, 'bad', t);
    if (!me.revealed && L(me).hidden) revealGandhi(me);
    return null;
  }
  function revealGandhi(p) {
    p.revealed = true;
    note(-1, `${L(p).name}'s hidden agenda is revealed: <b>Nuclear Gandhi</b>. "${L(p).angry}"`, 'bad');
  }

  // ──────────── Visibility ────────────
  function reveal(p, t, r) { for (const u of G.ring(t, r)) p.seen[u] = 1; for (const u of G.ring(t, r)) meet(p, u); }
  function meet(p, t) {
    const o = S.owner[t] >= 0 ? S.owner[t] : (unitAt(t) ? unitAt(t).owner : -1);
    if (o >= 0 && o !== p.id && !p.met.includes(o)) {
      p.met.push(o); const q = P(o); if (!q.met.includes(p.id)) q.met.push(p.id);
      if (p.human) note(p.id, `You met ${civName(q)}`, 'info', t);
      if (q.human) note(q.id, `You met ${civName(p)}`, 'info', t);
    }
  }
  // Tiles p can see right now
  function visible(p) {
    const v = new Uint8Array(N);
    for (const c of cityList(p)) for (const u of G.ring(c.t, 3)) v[u] = 1;
    for (let t = 0; t < N; t++) if (S.owner[t] === p.id) { v[t] = 1; for (const n of G.nb(t)) v[n] = 1; }
    for (const u of unitList(p)) for (const x of G.ring(u.t, sightOf(u))) v[x] = 1;
    return v;
  }

  // ──────────── Diplomacy ────────────
  function addOpinion(p, about, key, v) { p.opinionMods[about] = p.opinionMods[about] || {}; p.opinionMods[about][key] = v; }
  // Why p feels the way it does about q: [[reason, value]]
  function opinionOf(p, q) {
    const out = [], Lp = L(p), t = Lp.t;
    if (atWar(p.id, q.id)) out.push(['We are at war', -6]);
    const border = cityList(q).some(c => cityList(p).some(d => G.dist(c.t, d.t) <= 8));
    if (border) out.push(['Our borders are close', -Math.round(1 + t.aggr * 2)]);
    const qWars = Object.keys(q.wars).length, power = armyPower(q), mine = armyPower(p);
    switch (Lp.agenda) {
      case 'peace': if (qWars) out.push(['You are a warmonger', -3]); else out.push(['You keep the peace', 2]); break;
      case 'conquest': if (cityList(q).length < cityList(p).length * 0.6) out.push(['Your empire looks weak', -2]); else out.push(['Admires your empire', 1]); break;
      case 'army': if (power > mine * 1.2) out.push(['Respects your mighty army', 2]); else if (power < mine * 0.6) out.push(['Scorns your weak army', -3]); break;
      default: if (qWars > 1) out.push(['Worried by your wars', -1]);
    }
    for (const [k, v] of Object.entries(p.opinionMods[q.id] || {})) out.push([{ nuked: 'You used nuclear weapons', surprise: 'You declared war on us', peace: 'We made peace recently', liberated: 'You returned our city' }[k] || k, v]);
    const op = bonus(q).opinion || 0;
    if (op) out.push(['Admires your diplomats', op]);
    return out;
  }
  const opinion = (p, q) => opinionOf(p, q).reduce((s, x) => s + x[1], 0);
  const mood = v => v >= 4 ? 'Friendly' : v >= 0 ? 'Neutral' : v >= -5 ? 'Unfriendly' : 'Hostile';
  function armyPower(p) { let s = 0; for (const u of unitList(p)) if (isMil(u)) s += UNITS[u.type].cs * u.hp / 100; return s + cityList(p).length * 5; }
  function declareWar(a, b) {
    const p = P(a), q = P(b);
    if (atWar(a, b)) return null;
    if (!q.alive) return 'They are gone';
    if ((p.peaceTurn[b] || -99) > S.turn - 10) return `You signed peace ${S.turn - p.peaceTurn[b]} turns ago. Treaties last 10 turns.`;
    p.wars[b] = S.turn; q.wars[a] = S.turn; q.declaredOnMe[a] = S.turn;
    addOpinion(q, a, 'surprise', -4);
    for (const o of S.players) if (o !== p && o !== q && o.alive && !o.human) addOpinion(o, a, 'warmonger', L(o).agenda === 'peace' ? -2 : 0);
    note(-1, `${civName(p)} declared war on ${civName(q)}!`, q.human ? 'bad' : p.human ? 'warn' : 'info');
    return null;
  }
  function makePeace(a, b) {
    const p = P(a), q = P(b);
    delete p.wars[b]; delete q.wars[a];
    p.peaceTurn[b] = S.turn; q.peaceTurn[a] = S.turn;
    addOpinion(p, b, 'peace', 1); addOpinion(q, a, 'peace', 1);
    note(-1, `${civName(p)} and ${civName(q)} made peace`, 'info');
  }
  // How the war is going for p against q: positive = p is winning
  function warScore(p, q) {
    const pp = armyPower(p), qp = armyPower(q);
    const lost = S.cities.filter(c => c.alive && c.orig === p.id && c.owner === q.id).length, won = S.cities.filter(c => c.alive && c.orig === q.id && c.owner === p.id).length;
    return (pp - qp) / Math.max(20, pp + qp) * 10 + (won - lost) * 4;
  }
  // Would AI leader q accept peace with p?
  function peaceVerdict(q, p) {
    const since = S.turn - (q.wars[p.id] || S.turn);
    if (since < 8) return { ok: false, why: 'We have only just begun this war.' };
    const ws = warScore(q, p), want = -ws + since * 0.15 + (bonus(p).peaceEase || 0) * 10 + opinion(q, p) * 0.3 - T(q).aggr * 3;
    return want > 0.5 ? { ok: true } : { ok: false, why: ws > 3 ? 'We are winning this war. Why would we stop?' : 'Not yet. You will have to try harder.' };
  }
  function proposePeace(p, q) {
    if (!atWar(p.id, q.id)) return { ok: false, why: 'You are not at war' };
    const v = q.human ? { ok: false, why: 'Waiting for them to decide' } : peaceVerdict(q, p);
    if (v.ok) makePeace(p.id, q.id);
    return v;
  }

  // ──────────── Research ────────────
  function canResearch(p, k) { return !p.techs.includes(k) && TECHS[k].req.every(r => p.techs.includes(r)); }
  // Research k, queueing whatever it needs first
  function setResearch(p, k) {
    if (!TECHS[k] || p.techs.includes(k)) return 'Already known';
    const order = [], seen = new Set();
    const visit = x => { if (p.techs.includes(x) || seen.has(x)) return; seen.add(x); for (const r of TECHS[x].req) visit(r); order.push(x); };
    visit(k);
    p.queue = order;
    p.research = order[0];
    return null;
  }

  // ──────────── Turn processing ────────────
  function endPlayerTurn(p) {
    // Cities
    let gold = 0, sci = 0;
    for (const c of cityList(p)) {
      c.struck = false;
      const y = cityYields(c);
      gold += y.gold; sci += y.sci;
      // growth (slow once the city is at its population cap)
      c.food += y.food * (y.food > 0 && c.pop >= housing(c) ? 0.25 : 1);
      if (c.food >= growCost(c)) { c.food -= growCost(c); c.pop++; if (p.human && c.pop === housing(c)) note(p.id, `${c.name} has reached its population cap (${housing(c)}). Build an Aqueduct or Hospital.`, 'warn', c.t); }
      else if (c.food < 0) { if (c.pop > 1) { c.pop--; c.food = growCost(c) * 0.5; if (p.human) note(p.id, `${c.name} is starving!`, 'bad', c.t); } else c.food = 0; }
      // borders
      c.culture += y.cul;
      if (c.culture >= borderCost(c)) {
        const opts = [];
        const rad = c.pop >= 10 ? 4 : 3;
        for (const t of G.ring(c.t, rad)) {
          if (S.owner[t] >= 0 || !G.nb(t).some(n => S.tileCity[n] === c.id)) continue;
          const [f, pr, g] = tileYield(t, p);
          opts.push([t, f + pr + g * 0.7 + (M.res[t] ? 2 : 0) - G.dist(c.t, t) * 0.5]);
        }
        if (opts.length) { opts.sort((a, b) => b[1] - a[1]); claimTile(c, opts[0][0]); c.culture -= borderCost(c); c.grown++; }
        else c.culture = borderCost(c);
      }
      // develop worked tiles
      for (const t of c.worked) if (S.dev[t] < DEVELOP_TURNS) S.dev[t]++;
      assignTiles(c);
      // production
      if (!c.building && !p.human) aiChooseProd(c);
      if (c.building) {
        const [kind, k] = c.building.split(':');
        const mil = kind === 'u' && MILITARY.has(UNITS[k].cls) && has(c, 'barracks') ? 1.25 : 1;
        c.prod += y.prod * mil;
        const cost = itemCost(p, c.building);
        if (c.prod >= cost) {
          if (finishItem(c, c.building)) {
            c.prod -= cost; c.building = null;
            if (p.human) note(p.id, `${c.name} needs something to build`, 'warn', c.t); else aiChooseProd(c);
          } else c.prod = cost;   // no room for the unit yet: it waits
        }
      }
      // heal the city
      c.hp = Math.min(maxHP(c), c.hp + (Object.keys(p.wars).length ? 15 : 30));
    }
    // Gold
    p.gold += gold - upkeep(p);
    while (p.gold < 0) {
      const u = unitList(p).filter(isMil).sort((a, b) => UNITS[b.type].cost - UNITS[a.type].cost)[0];
      if (!u) { p.gold = 0; break; }
      u.dead = true; p.gold += 20;
      if (p.human) note(p.id, `You ran out of gold, so a ${UNITS[u.type].name} was disbanded`, 'bad', u.t);
    }
    // Science
    if (!p.research) { if (!p.human) aiResearch(p); }
    if (p.research) {
      p.sciProg += sci;
      const cost = techCost(p, p.research);
      if (p.sciProg >= cost) {
        p.sciProg -= cost;
        const k = p.research;
        p.techs.push(k);
        if (p.human) note(p.id, `Researched ${TECHS[k].name}`, 'good');
        if (k === 'fission' && L(p).hidden && !p.human) note(-1, `${L(p).name} has learned to split the atom...`, 'warn');
        p.queue = p.queue.filter(x => x !== k && !p.techs.includes(x));
        p.research = p.queue.find(x => canResearch(p, x)) || null;
        if (!p.research && !p.human) aiResearch(p);
      }
    } else p.gold += sci * 0.5;   // nothing to research: science becomes gold
    // Units: heal, fortify, refresh moves
    for (const u of unitList(p)) {
      if (!u.moved && !u.acted && isMil(u)) u.fort = Math.min(2, u.fort + 1);
      if (!u.moved && !u.acted) {
        const o = S.owner[u.t], c = cityAt(u.t);
        u.hp = Math.min(100, u.hp + (c && c.owner === p.id ? (has(c, 'barracks') ? 30 : 20) : o === p.id ? 10 : o < 0 ? 8 : 5));
      }
      if (S.fallout[u.t] > S.turn) u.hp -= 15;
      if (u.hp <= 0) killUnit(u, null);
      u.mv = maxMoves(p, u.type); u.acted = false; u.moved = false;
    }
    p.score = scoreOf(p);
  }
  function scoreOf(p) {
    return cityList(p).reduce((s, c) => s + 5 + c.pop * 2 + c.buildings.length, 0) + p.techs.length * 3 + p.space.length * 40 + Math.floor(S.owner.filter(o => o === p.id).length / 3);
  }
  function checkDomination() {
    if (S.over) return;
    // Owning every original capital wins
    const caps = S.cities.filter(c => c.origCapital && c.alive);
    for (const p of S.players) if (p.alive && caps.length > 1 && caps.every(c => c.owner === p.id)) { endGame(p.id, 'domination'); return; }
    const alive = S.players.filter(p => p.alive);
    if (alive.length === 1) endGame(alive[0].id, 'domination');
  }
  function endGame(winner, how) {
    if (S.over) return;
    S.over = { winner, how, turn: S.turn };
    const w = P(winner);
    note(-1, how === 'defeat' ? 'Your civilization has fallen.' : `${civName(w)} wins a ${how === 'space' ? 'science' : how === 'score' ? 'score' : 'domination'} victory!`, w && w.human ? 'good' : 'bad');
  }
  // The human ends their turn: every computer leader moves, then everyone's turn is tallied
  function endTurn() {
    if (S.over) return;
    for (const p of S.players) if (p.alive && !p.human) aiTurn(p);
    for (const p of S.players) if (p.alive) endPlayerTurn(p);
    S.turn++;
    if (!S.over && S.turn > SP.turns) {
      const best = S.players.filter(p => p.alive).sort((a, b) => b.score - a.score)[0];
      endGame(best.id, 'score');
    }
    // the human's units keep walking toward where they were sent
    for (const p of S.players) if (p.human && p.alive) for (const u of unitList(p)) if (u.dest >= 0 && !u.sleep) { const e = moveUnit(u, u.dest); if (e) u.dest = -1; }
    S.units = S.units.filter(u => !u.dead);
    S.rngState = rs;
  }

  // ════════════════ AI ════════════════
  function aiResearch(p) {
    const t = T(p), opts = TECH_IDS.filter(k => canResearch(p, k));
    if (!opts.length) { p.research = null; return; }
    const MIL = new Set(['archery', 'bronze', 'riding', 'iron', 'mathematics', 'machinery', 'feudalism', 'stirrups', 'castles', 'gunpowder', 'metalcasting', 'milEngineering', 'milScience', 'rifling', 'ballistics', 'replaceable', 'combustion', 'composites']);
    let best = null, bs = -1e9;
    for (const k of opts) {
      let s = -TECHS[k].cost / 40 + rand() * 2;
      if (MIL.has(k)) s += t.aggr * 3 + (Object.keys(p.wars).length ? 2 : 0); else s += t.econ * 2;
      if (k === 'fission' || k === 'rocketry') s += t.nuke * 4;
      if (['rocketry', 'satellites', 'fusion', 'computers'].includes(k)) s += 2;
      if (k === 'writing' || k === 'pottery') s += 1.5;
      if (s > bs) { bs = s; best = k; }
    }
    p.research = best; p.queue = [best];
  }
  // Best spot for a new city near p: lots of good tiles, close to home, away from others
  function aiSiteScore(p, t, from) {
    if (canFound(p, t)) return -1e9;
    let s = 0;
    for (const u of G.ring(t, 2)) {
      if (S.owner[u] >= 0 && S.owner[u] !== p.id) { s -= 2; continue; }
      const [f, pr, g] = tileYield(u, null);
      s += f * 1.2 + pr + g * 0.5 + (M.res[u] ? 1.5 : 0);
    }
    if (isCoastal(t)) s += 2;
    const home = cityList(p);
    const dHome = home.length ? Math.min(...home.map(c => G.dist(c.t, t))) : 0;
    s -= Math.max(0, dHome - 6) * 2.5 + G.dist(from, t) * 0.6;
    for (const q of S.players) if (q !== p && q.alive) for (const c of cityList(q)) if (G.dist(c.t, t) < 6) s -= 8;
    return s;
  }
  function aiFindSite(p, from) {
    let best = -1, bs = 20;
    for (const t of G.ring(from, 10)) { const s = aiSiteScore(p, t, from); if (s > bs) { bs = s; best = t; } }
    return best;
  }
  function wantedCities(p) { return Math.round(3 + T(p).expand * 6 + (S.cfg.size === 'large' ? 2 : S.cfg.size === 'small' ? -1 : 0)); }
  function aiChooseProd(c) {
    const p = P(c.owner), t = T(p), opts = buildable(c), has_ = i => opts.find(o => o.item === i);
    const cities = cityList(p).length, units = unitList(p), mil = units.filter(isMil).length;
    const settlers = units.filter(u => u.type === 'settler').length + S.cities.filter(x => x.alive && x.owner === p.id && x.building === 'u:settler').length;
    const war = Object.keys(p.wars).length > 0;
    const pick = item => { c.building = item; };
    const bestUnit = classes => { let b = null; for (const o of opts) if (o.item[0] === 'u' && classes.includes(UNITS[o.item.slice(2)].cls)) if (!b || UNITS[o.item.slice(2)].cs > UNITS[b.slice(2)].cs) b = o.item; return b; };
    const threatened = units.length && S.units.some(u => !u.dead && u.owner !== p.id && atWar(p.id, u.owner) && G.dist(u.t, c.t) <= 4);
    // Defend first
    if (threatened && !units.some(u => u.t === c.t && isMil(u))) { const b = bestUnit(['melee', 'anti', 'ranged']); if (b) return pick(b); }
    if ((threatened || war) && !has(c, 'walls') && has_('b:walls')) return pick('b:walls');
    // Gandhi and other nuke lovers
    if (has_('u:nuke') && (t.nuke >= 0.9 || (t.nuke >= 0.6 && war)) && units.filter(u => u.type === 'nuke').length < (t.nuke >= 0.9 ? 4 : 1)) return pick('u:nuke');
    // Space race
    for (const k of ['p:mars', 'p:moon', 'p:satellite']) if (has_(k) && (t.econ > 0.5 || rand() < 0.5)) return pick(k);
    if (has_('b:spaceport') && cities >= 2 && c.capital) return pick('b:spaceport');
    // Settlers while there's room
    if (has_('u:settler') && cities + settlers < wantedCities(p) && settlers < 2 && c.pop >= 2 && aiFindSite(p, c.t) >= 0 && (!war || rand() < 0.3)) return pick('u:settler');
    // Army size
    const want = Math.ceil(cities * (1.2 + t.aggr * 1.3) * (war ? 1.7 : 1) * D.aggr + 1 + eraOf(p) * 0.5);
    if (mil < want && rand() < 0.75) {
      const r = rand(), cls = war && r < 0.25 && eraOf(p) >= 1 ? ['siege'] : r < 0.45 ? ['melee', 'anti'] : r < 0.7 ? ['ranged'] : r < 0.85 ? ['mounted'] : ['melee'];
      const b = bestUnit(cls) || bestUnit(['melee', 'anti']);
      if (b) return pick(b);
    }
    if (mil === 0 || (!units.some(u => u.type === 'scout') && S.turn < 30 && has_('u:scout') && rand() < 0.5)) { const b = has_('u:scout') && mil > 0 ? 'u:scout' : bestUnit(['melee']); if (b) return pick(b); }
    // Buildings, by personality
    const W8 = { monument: 2, granary: 3 + t.expand, walls: 1 + t.defense * 3, barracks: t.aggr * 3, library: 3 + t.econ, market: 2 + t.econ * 3, aqueduct: c.pop >= housing(c) - 1 ? 8 : 1,
      workshop: 3 + t.econ * 2, castle: t.defense * 3, university: 3 + t.econ * 2, bank: 2 + t.econ * 3, observatory: 2 + t.econ, fortress: t.defense * 2,
      factory: 5, hospital: c.pop >= housing(c) - 1 ? 8 : 1, powerplant: 3, lab: 4, spaceport: 1 };
    // short of money: markets and banks first, and nothing with upkeep
    const net = cityList(p).reduce((s, x) => s + cityYields(x).gold, 0) - upkeep(p);
    if (net < 3) { W8.market *= 4; W8.bank *= 4; }
    let best = null, bs = -1;
    for (const o of opts) if (o.item[0] === 'b') {
      if (net < 0 && BUILDINGS[o.item.slice(2)].up > 0) continue;
      const s = (W8[o.item.slice(2)] || 1) * (0.7 + rand() * 0.6) / Math.sqrt(o.cost); if (s > bs) { bs = s; best = o.item; }
    }
    if (best) return pick(best);
    const b = bestUnit(['melee', 'anti', 'ranged', 'mounted']);
    pick(b || opts[0].item);
  }
  function aiDiplomacy(p) {
    const t = T(p);
    // Peace when the war goes badly or drags on
    for (const id of Object.keys(p.wars).map(Number)) {
      const q = P(id);
      if (!q.alive) { delete p.wars[id]; continue; }
      const since = S.turn - p.wars[id];
      if (since < 10) continue;
      if (q.human) {
        if (warScore(p, q) < -2 && rand() < 0.15 && S.turn - (p.ai.offered || -99) > 10) { p.ai.offered = S.turn; S.offers = S.offers || []; if (!S.offers.some(o => o.from === p.id)) { S.offers.push({ from: p.id, to: q.id, kind: 'peace', turn: S.turn }); note(q.id, `${civName(p)} offers peace`, 'info'); } }
      } else if (peaceVerdict(p, q).ok && peaceVerdict(q, p).ok && rand() < 0.3) makePeace(p.id, id);
    }
    // War
    if (S.turn < D.peace || S.turn - (p.ai.lastWar || 0) < 15 || Object.keys(p.wars).length) return;
    const mine = armyPower(p);
    let best = null, bs = 0;
    for (const id of p.met) {
      const q = P(id);
      if (!q.alive || atWar(p.id, id) || (p.peaceTurn[id] || -99) > S.turn - 15) continue;
      const near = cityList(q).some(c => cityList(p).some(d => G.dist(c.t, d.t) <= 14));
      if (!near) continue;
      const ratio = mine / Math.max(10, armyPower(q));
      let s = (ratio - 1.1) * 2 + t.aggr * 2 - opinion(p, q) * 0.3 + (cityList(q).length > cityList(p).length ? 0.5 : 0);
      if (L(p).hidden && p.revealed) s += 1;
      if (s > bs) { bs = s; best = q; }
    }
    if (best && rand() < 0.08 * D.aggr * (0.4 + t.aggr) * bs) { declareWar(p.id, best.id); p.ai.lastWar = S.turn; }
  }
  // Best thing u can attack right now: [tile, score]
  function aiBestAttack(u) {
    const U = UNITS[u.type], ranged = !!U.rs && U.cls !== 'melee', R = ranged ? U.rng : 1;
    let best = -1, bs = 0;
    for (const t of G.ring(u.t, R)) {
      if (t === u.t) continue;
      const c = cityAt(t), xs = unitsAt(t).filter(x => x.owner !== u.owner);
      const o = c && c.owner !== u.owner ? c.owner : xs.length ? xs[0].owner : -1;
      if (o < 0 || !atWar(u.owner, o)) continue;
      const pv = preview(u, t);
      if (!pv) continue;
      let s;
      if (pv.vs === 'city') {
        if (!ranged && U.cls === 'siege') continue;
        s = pv.toThem * (U.cls === 'siege' ? 1.5 : 1) - pv.toMe * 1.2;
        if (!ranged && pv.city.hp <= pv.toThem) s += 200;   // capture
        if (!ranged && pv.toMe >= u.hp) s -= 300;
        if (!ranged && pv.city.hp > 120 && pv.toMe > 25) s -= 40;
      } else if (pv.vs === 'civ') s = 60;
      else {
        s = pv.toThem - pv.toMe * 1.1 + (pv.unit.hp <= pv.toThem ? 60 : 0);
        if (pv.toMe >= u.hp) s -= 300;
      }
      if (s > bs) { bs = s; best = t; }
    }
    return [best, bs];
  }
  function aiTurn(p) {
    aiDiplomacy(p);
    if (!p.research) aiResearch(p);
    const cities = cityList(p), t = T(p);
    // Spend gold on what's urgent
    for (const c of cities) {
      if (!c.building) aiChooseProd(c);
      if (c.building && p.gold > buyCost(p, c) + 40 && (c.building === 'b:walls' || (Object.keys(p.wars).length && c.building[0] === 'u') || p.gold > 400 + 100 * eraOf(p))) { p.gold -= buyCost(p, c); c.prod = itemCost(p, c.building); }
    }
    // City strikes
    for (const c of cities) {
      let best = -1, bd = 0;
      for (const n of G.ring(c.t, 2)) for (const x of unitsAt(n)) if (x.owner !== p.id && atWar(p.id, x.owner) && 100 - x.hp + 10 > bd) { bd = 100 - x.hp + 10; best = n; }
      if (best >= 0) cityStrike(c, best);
    }
    // War target: the enemy city closest to our cities. The army gathers at a rally point a few
    // tiles short of it and only pushes in once enough of it has arrived.
    let target = null;
    if (Object.keys(p.wars).length) {
      let bd = 1e9;
      for (const c of S.cities) if (c.alive && atWar(p.id, c.owner)) { const d = Math.min(...cities.map(x => G.dist(x.t, c.t)), 99); if (d < bd) { bd = d; target = c; } }
    }
    const A = p.ai;
    if (!target) { A.tgt = -1; A.push = false; }
    else if (A.tgt !== target.id) {
      A.tgt = target.id; A.push = false; A.rally = -1;
      const home = nearestOwnCity(p, target.t);
      let rd = 1e9;
      for (const n of G.ring(target.t, 5)) {
        if (G.dist(n, target.t) < 4 || !passable(n) || (S.owner[n] >= 0 && S.owner[n] !== p.id && !atWar(p.id, S.owner[n]))) continue;
        const d = home ? G.dist(n, home.t) : 0;
        if (d < rd) { rd = d; A.rally = n; }
      }
    }
    if (target) {
      const army = unitList(p).filter(u => isMil(u) && UNITS[u.type].cls !== 'recon' && !cityAt(u.t));
      const gathered = army.filter(u => G.dist(u.t, A.rally >= 0 ? A.rally : target.t) <= 3 || G.dist(u.t, target.t) <= 3).length;
      const need = Math.min(Math.max(4, Math.round(army.length * 0.6)), army.length);
      if (!A.push && gathered >= need && need >= 3) A.push = true;
      if (A.push && army.filter(u => G.dist(u.t, target.t) <= 5).length < 2 && gathered < 2) A.push = false;   // the push collapsed: regroup
    }
    // Upgrades when rich
    for (const u of unitList(p)) { if (p.gold < 200) break; const to = UNITS[u.type].up; if (to && hasTech(p, UNITS[to].tech) && S.owner[u.t] === p.id) upgrade(u); }
    const units = unitList(p).sort((a, b) => (UNITS[b.type].rs ? 1 : 0) - (UNITS[a.type].rs ? 1 : 0));
    const garrisoned = new Set();
    for (const u of units) {
      if (u.dead) continue;
      const U = UNITS[u.type];
      if (u.type === 'settler') { aiSettler(p, u); continue; }
      if (U.cls === 'nuke') { aiNuke(p, u); continue; }
      // attack if worth it
      for (let k = 0; k < 2 && !u.acted && u.mv > 0; k++) {
        const [tt, sc] = aiBestAttack(u);
        if (tt >= 0 && sc > 5) attack(u, tt, false); else break;
      }
      if (u.dead || u.mv <= 0) continue;
      const here = cityAt(u.t);
      // keep one defender in every city
      if (here && here.owner === p.id && !garrisoned.has(here.id) && U.cls !== 'siege' && U.cls !== 'recon') { garrisoned.add(here.id); continue; }
      // hurt units go home to heal
      if (u.hp < 45 && isMil(u)) { const home = nearestOwnCity(p, u.t); if (home && home.t !== u.t) moveUnit(u, home.t); continue; }
      if (U.cls === 'recon') { aiExplore(p, u); continue; }
      const empty = cities.find(c => !garrisoned.has(c.id) && !unitsAt(c.t).some(x => x.owner === p.id && isMil(x)));
      if (empty && G.dist(empty.t, u.t) <= 8 && U.cls !== 'siege') { garrisoned.add(empty.id); moveUnit(u, empty.t); continue; }
      if (target && !A.push && A.rally >= 0) {
        // gather at the rally point before pushing
        if (G.dist(u.t, A.rally) > 2) { const spots = G.ring(A.rally, 2).filter(n => passable(n) && canStop(u, n) && !hostileAt(u, n)); spots.sort((a, b) => G.dist(a, u.t) - G.dist(b, u.t)); if (spots.length) moveUnit(u, spots[0]); }
        continue;
      }
      if (target) {
        // push on the target city: ranged and siege stop in range, melee next to it
        const want = U.rs ? U.rng : 1;
        if (G.dist(u.t, target.t) > want) {
          let goal = -1, gd = 1e9;
          for (const n of G.ring(target.t, want)) if (G.dist(n, target.t) === want && passable(n) && canStop(u, n) && !hostileAt(u, n)) { const d = G.dist(n, u.t); if (d < gd) { gd = d; goal = n; } }
          if (goal >= 0) moveUnit(u, goal);
        }
        for (let k = 0; k < 1 && !u.acted && u.mv > 0; k++) { const [tt, sc] = aiBestAttack(u); if (tt >= 0 && sc > 0) attack(u, tt, false); }
        continue;
      }
      // peacetime: stand near the border city closest to a rival
      if (u.fort === 0 && !u.moved && rand() < 0.3) {
        const c = cities[rand() * cities.length | 0];
        if (c) { const spots = G.ring(c.t, 2).filter(n => passable(n) && S.owner[n] === p.id && canStop(u, n)); if (spots.length) moveUnit(u, spots[rand() * spots.length | 0]); }
      }
    }
  }
  function nearestOwnCity(p, t) { let b = null, bd = 1e9; for (const c of cityList(p)) { const d = G.dist(c.t, t); if (d < bd) { bd = d; b = c; } } return b; }
  function aiSettler(p, u) {
    if (!cityList(p).length) { if (!canFound(p, u.t)) foundCity(p, u.t); return; }
    let site = p.ai.site[u.id];
    if (site == null || canFound(p, site)) { site = aiFindSite(p, u.t); p.ai.site[u.id] = site; }
    if (site < 0) { if (!canFound(p, u.t) && rand() < 0.2) found(u); return; }
    if (u.t === site) { found(u); return; }
    if (moveUnit(u, site)) p.ai.site[u.id] = null;
    if (u.t === site && u.mv > 0) found(u);
  }
  function aiExplore(p, u) {
    let best = -1, bs = -1;
    for (let k = 0; k < 30; k++) {
      const t = rand() * N | 0;
      if (!passable(t) || (S.owner[t] >= 0 && S.owner[t] !== p.id)) continue;
      const s = -G.dist(u.t, t) + (p.met.length < S.players.length - 1 ? 20 : 0) * rand();
      if (s > bs) { bs = s; best = t; }
    }
    if (best >= 0) moveUnit(u, best);
  }
  function aiNuke(p, u) {
    if (!Object.keys(p.wars).length || S.turn - (p.ai.lastNuke || -99) < 8) return;
    const t = T(p), losing = Object.keys(p.wars).some(id => warScore(p, P(+id)) < -4);
    if (!(t.nuke >= 0.9 || (t.nuke >= 0.6 && losing) || losing && rand() < 0.1)) return;
    let best = -1, bs = 0;
    for (const c of S.cities) {
      if (!c.alive || !atWar(p.id, c.owner) || G.dist(u.t, c.t) > NUKE_RANGE) continue;
      const s = c.pop * 3 + (c.capital ? 8 : 0) + unitsAt(c.t).length * 2;
      if (s > bs && !G.ring(c.t, 1).some(n => S.owner[n] >= 0 && S.owner[n] !== c.owner && !atWar(p.id, S.owner[n]))) { bs = s; best = c.t; }
    }
    if (best >= 0 && !launchNuke(u, best)) p.ai.lastNuke = S.turn;
  }

  // ──────────── Unit actions ────────────
  function found(u) {
    if (u.type !== 'settler' || u.dead) return 'Only Settlers can found cities';
    if (u.mv <= 0) return 'No moves left';
    const p = P(u.owner), e = canFound(p, u.t);
    if (e) return e;
    u.dead = true;
    const c = foundCity(p, u.t);
    reveal(p, c.t, 3);
    if (p.human) note(p.id, `${c.name} was founded`, 'good', c.t);
    return null;
  }
  function upgrade(u) {
    const p = P(u.owner), to = UNITS[u.type].up;
    if (!to || !hasTech(p, UNITS[to].tech)) return 'No upgrade available';
    if (S.owner[u.t] !== p.id) return 'Upgrade inside your own territory';
    const cost = upgradeCost(p, u);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost; u.type = to; u.mv = 0; u.acted = true;
    return null;
  }
  const upgradeCost = (p, u) => { const to = UNITS[u.type].up; return to ? Math.round(Math.max(20, (unitCost(p, to) - unitCost(p, u.type)) * 1.5)) : Infinity; };
  function buy(c) {
    const p = P(c.owner), cost = buyCost(p, c);
    if (!c.building) return 'Choose something to build first';
    if (c.building[0] === 'p') return "The space program can't be bought";
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost; c.prod = itemCost(p, c.building);
    // it finishes at the end of the turn
    return null;
  }

  // ──────────── Setup ────────────
  function placeStarts() {
    const land = [];
    for (let t = 0; t < N; t++) if (passable(t) && M.terr[t] !== SNOW && M.terr[t] !== TUNDRA) land.push(t);
    const score = t => G.ring(t, 2).reduce((s, u) => { const y = tileYield(u, null); return s + y[0] * 1.3 + y[1] + (M.res[u] ? 1 : 0); }, 0) + (M.terr[t] === DESERT ? -6 : 0) + (isCoastal(t) ? 1 : 0);
    const cands = land.map(t => [t, score(t)]).filter(x => x[1] > 10).sort((a, b) => b[1] - a[1]);
    let gap = Math.floor(Math.sqrt(land.length / S.players.length) * 0.9);
    let starts = [];
    while (gap >= 4) {
      starts = [];
      for (const [t] of cands) { if (starts.every(s => G.dist(s, t) >= gap)) starts.push(t); if (starts.length === S.players.length) break; }
      if (starts.length === S.players.length) break;
      gap--;
    }
    // shuffle so the human isn't always on the best spot
    for (let i = starts.length - 1; i > 0; i--) { const j = rand() * (i + 1) | 0; [starts[i], starts[j]] = [starts[j], starts[i]]; }
    S.players.forEach((p, i) => {
      const t = starts[i % starts.length];
      const units = ['settler', 'warrior', 'scout'].concat(p.human ? [] : D.start);
      for (const k of units) { const spot = freeSpot(t, k); addUnit(p, k, spot >= 0 ? spot : t); }
      reveal(p, t, 3);
      p.research = null;
    });
    S.rngState = rs;
  }

  return {
    S, G, M, W, H, N,
    get turn() { return S.turn; },
    // data access
    P, L, bonus, cityAt, unitAt, unitsAt, cityList, unitList, tileYield, cityYields, growCost, borderCost, housing, maxHP, cityStrength, wallTier,
    buildable, itemCost, unitCost, buildingCost, techCost, buyCost, upkeep, canResearch, canFound, findPath, stepCost, preview, strength,
    visible, opinionOf, opinion, mood, armyPower, peaceVerdict, warScore, atWar, eraOf, civName, isMil, upgradeCost, scoreOf, isCoastal, passable, sightOf,
    // actions (all return an error string or null)
    moveUnit, attack, found, upgrade, buy, cityStrike, launchNuke,
    setProduction: (c, item) => setProduction(c, item),
    setResearch: (p, k) => setResearch(p, k),
    setFocus(c, f) { if (['balanced', 'food', 'production', 'gold'].includes(f)) { c.focus = f; assignTiles(c); } },
    fortify(u) { u.sleep = true; u.dest = -1; },
    wake(u) { u.sleep = false; },
    skip(u) { u.skipTurn = S.turn; },
    disband(u) { u.dead = true; },
    declareWar: (a, b) => declareWar(a, b),
    proposePeace: (p, q) => proposePeace(p, q),
    acceptPeace(p, fromId) {
      const o = (S.offers || []).find(o => o.from === fromId && o.to === p.id);
      S.offers = (S.offers || []).filter(x => x !== o);
      if (o && atWar(p.id, fromId)) makePeace(p.id, fromId);
    },
    declinePeace(p, fromId) { S.offers = (S.offers || []).filter(o => !(o.from === fromId && o.to === p.id)); },
    endTurn,
    save: () => { S.rngState = rs; S.units = S.units.filter(u => !u.dead); return JSON.stringify(S); },
    _placeStarts: placeStarts,
    _aiTurn: aiTurn,
  };
}

const api = {
  TERRAIN, RESOURCES, RES_IDS, ERAS, TECHS, TECH_IDS, UNITS, UNIT_IDS, BUILDINGS, BUILDING_IDS, PROJECTS, PROJECT_IDS, DIFFS, SPEEDS, MAP_SIZES, MAP_TYPES,
  STYLE_BONUS, LEADERS, COLORS, MILITARY, NUKE_RANGE, DEVELOP_TURNS, OCEAN, COAST, GRASS, PLAINS, DESERT, TUNDRA, SNOW, FLAT, HILLS, MOUNTAIN,
  newGame, loadGame, makeGrid, mulberry32, esc, clamp,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.NationsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

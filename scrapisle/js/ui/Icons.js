// Procedural item icons drawn on a canvas, cached as data URLs.
import { ITEMS } from '../data/items.js';

const cache = new Map();
const S = 64;

function shade(hex, k) {
  const c = parseInt(hex.slice(1), 16);
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  r = Math.max(0, Math.min(255, Math.round(r * k))); g = Math.max(0, Math.min(255, Math.round(g * k))); b = Math.max(0, Math.min(255, Math.round(b * k)));
  return `rgb(${r},${g},${b})`;
}

const DRAW = {
  log(x, c) { x.fillStyle = shade(c, 0.8); x.fillRect(10, 26, 44, 14); x.fillStyle = c; x.fillRect(10, 22, 44, 8); x.fillStyle = shade(c, 1.3); x.beginPath(); x.ellipse(54, 31, 5, 9, 0, 0, 7); x.fill(); x.fillStyle = shade(c, 0.6); x.fillRect(10, 40, 40, 4); },
  rock(x, c) { x.fillStyle = c; x.beginPath(); x.moveTo(12, 44); x.lineTo(18, 22); x.lineTo(34, 14); x.lineTo(50, 22); x.lineTo(54, 42); x.lineTo(36, 50); x.closePath(); x.fill(); x.fillStyle = shade(c, 1.25); x.beginPath(); x.moveTo(18, 22); x.lineTo(34, 14); x.lineTo(36, 28); x.closePath(); x.fill(); },
  ore(x, c, d) { DRAW.rock(x, c); x.fillStyle = d.spot || '#ccc'; for (const [a, b] of [[26, 30], [40, 26], [32, 40], [22, 38], [44, 38]]) { x.beginPath(); x.arc(a, b, 3.2, 0, 7); x.fill(); } },
  frags(x, c) { x.fillStyle = c; for (const [a, b, w] of [[14, 30, 14], [30, 22, 16], [34, 38, 14], [18, 42, 10], [44, 28, 10]]) { x.fillRect(a, b, w, w * 0.6); } x.fillStyle = shade(c, 0.7); x.fillRect(30, 30, 16, 3); },
  powder(x, c) { x.fillStyle = c; x.beginPath(); x.moveTo(10, 48); x.quadraticCurveTo(32, 8, 54, 48); x.closePath(); x.fill(); x.fillStyle = shade(c, 1.3); x.beginPath(); x.arc(28, 30, 4, 0, 7); x.fill(); },
  ingot(x, c) { x.fillStyle = shade(c, 0.75); x.beginPath(); x.moveTo(10, 42); x.lineTo(18, 28); x.lineTo(54, 28); x.lineTo(46, 42); x.closePath(); x.fill(); x.fillStyle = c; x.beginPath(); x.moveTo(18, 28); x.lineTo(24, 20); x.lineTo(56, 20); x.lineTo(54, 28); x.closePath(); x.fill(); },
  tnt(x, c) { x.fillStyle = c; x.fillRect(16, 18, 10, 32); x.fillRect(28, 18, 10, 32); x.fillRect(40, 18, 10, 32); x.fillStyle = '#222'; x.fillRect(14, 30, 38, 6); x.strokeStyle = '#ddd'; x.lineWidth = 2; x.beginPath(); x.moveTo(33, 18); x.quadraticCurveTo(40, 6, 48, 10); x.stroke(); },
  cloth(x, c) { x.fillStyle = c; x.fillRect(12, 18, 40, 28); x.fillStyle = shade(c, 0.75); for (let i = 0; i < 4; i++) x.fillRect(12, 22 + i * 7, 40, 2); x.fillStyle = shade(c, 1.2); x.beginPath(); x.ellipse(52, 32, 5, 14, 0, 0, 7); x.fill(); },
  blob(x, c) { x.fillStyle = c; x.beginPath(); x.ellipse(32, 36, 20, 13, 0, 0, 7); x.fill(); x.fillStyle = shade(c, 1.15); x.beginPath(); x.ellipse(26, 32, 8, 5, 0, 0, 7); x.fill(); },
  bone(x, c) { x.strokeStyle = c; x.lineWidth = 7; x.lineCap = 'round'; x.beginPath(); x.moveTo(18, 46); x.lineTo(46, 18); x.stroke(); x.fillStyle = c; for (const [a, b] of [[14, 44], [20, 50], [44, 14], [50, 20]]) { x.beginPath(); x.arc(a, b, 5, 0, 7); x.fill(); } },
  can(x, c) { x.fillStyle = c; x.fillRect(20, 16, 24, 34); x.fillStyle = shade(c, 1.3); x.beginPath(); x.ellipse(32, 16, 12, 4, 0, 0, 7); x.fill(); x.fillStyle = '#eee'; x.fillRect(20, 28, 24, 8); },
  scrap(x, c) { x.fillStyle = c; x.beginPath(); x.moveTo(14, 40); x.lineTo(22, 20); x.lineTo(36, 26); x.lineTo(50, 16); x.lineTo(52, 40); x.lineTo(34, 48); x.closePath(); x.fill(); x.fillStyle = shade(c, 0.65); x.fillRect(26, 32, 14, 4); x.fillRect(38, 24, 4, 12); },
  rope(x, c) { x.strokeStyle = c; x.lineWidth = 5; for (let i = 0; i < 3; i++) { x.beginPath(); x.ellipse(32, 32, 18 - i * 5, 12 - i * 3, 0, 0, 7); x.stroke(); } },
  barricade(x, c) {
    for (let i = 0; i < 6; i++) { const xx = 8 + i * 8.6; x.fillStyle = i % 2 ? shade(c, 1.1) : shade(c, 0.85); x.fillRect(xx, 22, 7, 30); x.beginPath(); x.moveTo(xx, 22); x.lineTo(xx + 3.5, 14); x.lineTo(xx + 7, 22); x.fill(); }
    x.fillStyle = '#5a3d22'; x.fillRect(6, 28, 52, 4); x.fillRect(6, 42, 52, 4);
  },
  kit(x, c) {
    // sewing kit: a wooden spool of red thread with a needle across it
    x.fillStyle = '#8a6440'; x.fillRect(14, 14, 28, 6); x.fillRect(14, 44, 28, 6);
    x.fillStyle = '#c0392b'; x.fillRect(17, 20, 22, 24);
    x.strokeStyle = '#8e2a20'; x.lineWidth = 1.5; for (let yy = 23; yy < 44; yy += 4) { x.beginPath(); x.moveTo(17, yy); x.lineTo(39, yy + 2); x.stroke(); }
    x.strokeStyle = '#d8dde2'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(36, 54); x.lineTo(56, 14); x.stroke();
    x.strokeStyle = '#555'; x.lineWidth = 1; x.beginPath(); x.arc(54.5, 17, 1.6, 0, 7); x.stroke();
    x.strokeStyle = '#c0392b'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(54, 18); x.quadraticCurveTo(46, 30, 40, 26); x.stroke();
  },
  gear(x, c) { x.fillStyle = c; x.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 14 : 20; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } x.closePath(); x.fill(); x.fillStyle = '#1a1a1a'; x.beginPath(); x.arc(32, 32, 6, 0, 7); x.fill(); },
  pipe(x, c) { x.fillStyle = c; x.fillRect(10, 26, 44, 12); x.fillStyle = shade(c, 1.3); x.fillRect(10, 26, 44, 3); x.fillStyle = shade(c, 0.6); x.beginPath(); x.ellipse(54, 32, 3, 6, 0, 0, 7); x.fill(); },
  spring(x, c) { x.strokeStyle = c; x.lineWidth = 4; x.beginPath(); for (let i = 0; i <= 40; i++) { const t = i / 40; x.lineTo(12 + t * 40, 32 + Math.sin(t * Math.PI * 10) * 10); } x.stroke(); },
  blade(x, c) { x.fillStyle = c; x.beginPath(); x.moveTo(10, 40); x.lineTo(50, 18); x.lineTo(54, 24); x.lineTo(16, 46); x.closePath(); x.fill(); },
  plate(x, c) { x.fillStyle = c; x.fillRect(12, 16, 40, 32); x.fillStyle = shade(c, 1.25); for (const [a, b] of [[16, 20], [46, 20], [16, 42], [46, 42]]) { x.beginPath(); x.arc(a, b, 2, 0, 7); x.fill(); } },
  sign(x, c) { x.fillStyle = '#555'; x.fillRect(30, 30, 4, 22); x.fillStyle = c; x.beginPath(); x.moveTo(32, 8); x.lineTo(54, 30); x.lineTo(32, 52); x.lineTo(10, 30); x.closePath(); x.fill(); x.fillStyle = '#222'; x.fillRect(28, 22, 8, 16); },
  body(x, c) { x.fillStyle = c; x.fillRect(10, 24, 40, 12); x.fillRect(34, 34, 10, 14); x.fillStyle = shade(c, 1.3); x.fillRect(10, 24, 40, 3); },
  chip(x, c) { x.fillStyle = c; x.fillRect(16, 16, 32, 32); x.fillStyle = '#d8c43a'; for (let i = 0; i < 4; i++) { x.fillRect(10, 20 + i * 7, 6, 3); x.fillRect(48, 20 + i * 7, 6, 3); } x.fillStyle = '#222'; x.fillRect(24, 24, 16, 16); },
  tank(x, c) { x.fillStyle = c; x.beginPath(); x.roundRect(20, 14, 24, 38, 10); x.fill(); x.fillStyle = '#555'; x.fillRect(28, 8, 8, 8); },
  axe(x, c) { x.fillStyle = '#7a5a3a'; x.save(); x.translate(32, 32); x.rotate(-0.7); x.fillRect(-3, -24, 6, 48); x.fillStyle = c; x.beginPath(); x.moveTo(3, -22); x.lineTo(18, -26); x.lineTo(18, -6); x.lineTo(3, -10); x.closePath(); x.fill(); x.restore(); },
  pick(x, c) { x.fillStyle = '#7a5a3a'; x.save(); x.translate(32, 34); x.rotate(-0.7); x.fillRect(-3, -22, 6, 46); x.fillStyle = c; x.beginPath(); x.moveTo(-22, -16); x.quadraticCurveTo(0, -30, 22, -16); x.lineTo(20, -12); x.quadraticCurveTo(0, -22, -20, -12); x.closePath(); x.fill(); x.restore(); },
  torch(x, c) { x.fillStyle = '#7a5a3a'; x.save(); x.translate(32, 34); x.rotate(-0.5); x.fillRect(-3, -14, 6, 36); x.fillStyle = '#f0a040'; x.beginPath(); x.moveTo(-7, -14); x.quadraticCurveTo(0, -36, 7, -14); x.closePath(); x.fill(); x.restore(); },
  hammer(x, c) { x.fillStyle = '#7a5a3a'; x.save(); x.translate(32, 34); x.rotate(-0.7); x.fillRect(-3, -18, 6, 40); x.fillStyle = '#777'; x.fillRect(-12, -26, 24, 10); x.restore(); },
  plan(x, c) { x.fillStyle = '#d8e4f0'; x.fillRect(12, 12, 40, 40); x.strokeStyle = c; x.lineWidth = 2; for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(12 + i * 10, 12); x.lineTo(12 + i * 10, 52); x.stroke(); x.beginPath(); x.moveTo(12, 12 + i * 10); x.lineTo(52, 12 + i * 10); x.stroke(); } },
  spear(x, c) { x.strokeStyle = '#7a5a3a'; x.lineWidth = 5; x.beginPath(); x.moveTo(10, 54); x.lineTo(48, 16); x.stroke(); x.fillStyle = c; x.beginPath(); x.moveTo(44, 14); x.lineTo(56, 8); x.lineTo(50, 20); x.closePath(); x.fill(); },
  knife(x, c) { x.fillStyle = '#5a3d22'; x.save(); x.translate(32, 32); x.rotate(-0.8); x.fillRect(-4, 6, 8, 18); x.fillStyle = c; x.beginPath(); x.moveTo(-5, 6); x.lineTo(5, 6); x.lineTo(2, -26); x.lineTo(-5, -20); x.closePath(); x.fill(); x.restore(); },
  pistol(x, c) { x.fillStyle = c; x.fillRect(12, 22, 38, 10); x.fillStyle = shade(c, 0.6); x.beginPath(); x.moveTo(18, 32); x.lineTo(30, 32); x.lineTo(26, 50); x.lineTo(16, 50); x.closePath(); x.fill(); },
  shotgun(x, c) { x.fillStyle = '#7a5a3a'; x.fillRect(6, 30, 18, 10); x.fillStyle = c; x.fillRect(20, 26, 38, 6); x.fillRect(20, 33, 38, 4); },
  smg(x, c) { x.fillStyle = c; x.fillRect(8, 24, 46, 10); x.fillStyle = shade(c, 0.6); x.fillRect(26, 34, 8, 16); x.fillRect(16, 34, 6, 10); x.fillStyle = '#333'; x.fillRect(48, 26, 10, 4); },
  rifle(x, c) { x.fillStyle = '#5a3d22'; x.fillRect(4, 28, 16, 10); x.fillStyle = c; x.fillRect(18, 26, 40, 7); x.fillStyle = shade(c, 0.6); x.fillRect(30, 33, 6, 14); x.fillStyle = '#222'; x.fillRect(26, 20, 14, 4); },
  bow(x, c) { x.strokeStyle = c; x.lineWidth = 5; x.beginPath(); x.arc(14, 32, 26, -1.1, 1.1); x.stroke(); x.strokeStyle = '#ddd'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(26, 9); x.lineTo(26, 55); x.stroke(); },
  arrow(x, c) { x.strokeStyle = c; x.lineWidth = 3; x.beginPath(); x.moveTo(12, 52); x.lineTo(50, 14); x.stroke(); x.fillStyle = '#999'; x.beginPath(); x.moveTo(46, 12); x.lineTo(56, 8); x.lineTo(52, 18); x.closePath(); x.fill(); x.fillStyle = '#d84a4a'; x.fillRect(10, 46, 8, 8); },
  bullet(x, c) { for (let i = 0; i < 3; i++) { x.fillStyle = c; x.fillRect(16 + i * 12, 24, 8, 24); x.fillStyle = '#b87333'; x.beginPath(); x.moveTo(16 + i * 12, 24); x.lineTo(20 + i * 12, 14); x.lineTo(24 + i * 12, 24); x.closePath(); x.fill(); } },
  shell(x, c) { for (let i = 0; i < 2; i++) { x.fillStyle = c; x.fillRect(18 + i * 16, 18, 12, 26); x.fillStyle = '#c7a34b'; x.fillRect(18 + i * 16, 40, 12, 8); } },
  launcher(x, c) { x.fillStyle = c; x.fillRect(6, 24, 52, 12); x.fillStyle = shade(c, 0.7); x.fillRect(6, 22, 8, 16); x.fillRect(50, 22, 8, 16); x.fillStyle = '#333'; x.fillRect(26, 36, 6, 12); x.fillRect(38, 36, 5, 9); x.fillStyle = shade(c, 1.3); x.fillRect(30, 18, 10, 6); },
  rocket(x, c) { x.save(); x.translate(32, 32); x.rotate(-0.8); x.fillStyle = c; x.fillRect(-20, -5, 30, 10); x.fillStyle = '#b03a2e'; x.beginPath(); x.moveTo(10, -6); x.lineTo(22, 0); x.lineTo(10, 6); x.fill(); x.fillStyle = shade(c, 0.6); x.fillRect(-24, -8, 6, 16); x.restore(); },
  satchel(x, c) { x.fillStyle = c; x.fillRect(14, 22, 36, 26); x.fillStyle = shade(c, 0.7); x.fillRect(14, 22, 36, 8); x.strokeStyle = '#ddd'; x.lineWidth = 2; x.beginPath(); x.moveTo(40, 22); x.quadraticCurveTo(46, 8, 54, 12); x.stroke(); },
  shirt(x, c) { x.fillStyle = c; x.beginPath(); x.moveTo(20, 12); x.lineTo(44, 12); x.lineTo(56, 24); x.lineTo(48, 30); x.lineTo(46, 52); x.lineTo(18, 52); x.lineTo(16, 30); x.lineTo(8, 24); x.closePath(); x.fill(); },
  pants(x, c) { x.fillStyle = c; x.beginPath(); x.moveTo(18, 10); x.lineTo(46, 10); x.lineTo(48, 54); x.lineTo(36, 54); x.lineTo(32, 26); x.lineTo(28, 54); x.lineTo(16, 54); x.closePath(); x.fill(); },
  hat(x, c) { x.fillStyle = c; x.beginPath(); x.arc(32, 36, 18, Math.PI, 0); x.fill(); x.fillRect(10, 34, 44, 6); },
  mask(x, c) { x.fillStyle = c; x.beginPath(); x.roundRect(14, 12, 36, 40, 8); x.fill(); x.fillStyle = '#111'; x.fillRect(20, 24, 24, 5); x.fillRect(30, 34, 4, 10); },
  vest(x, c) { x.fillStyle = c; x.beginPath(); x.moveTo(18, 10); x.lineTo(28, 10); x.lineTo(32, 18); x.lineTo(36, 10); x.lineTo(46, 10); x.lineTo(50, 52); x.lineTo(14, 52); x.closePath(); x.fill(); x.fillStyle = shade(c, 0.7); x.fillRect(14, 34, 36, 4); },
  boots(x, c) { x.fillStyle = c; x.fillRect(14, 14, 12, 30); x.fillRect(14, 38, 20, 10); x.fillRect(36, 14, 12, 30); x.fillRect(36, 38, 18, 10); },
  gloves(x, c) { x.fillStyle = c; x.beginPath(); x.roundRect(16, 18, 26, 30, 6); x.fill(); x.fillRect(40, 26, 10, 8); },
  hazmat(x, c) { DRAW.shirt(x, c); x.fillStyle = '#222'; x.beginPath(); x.arc(32, 26, 6, 0, 7); x.fill(); },
  food(x, c) { x.fillStyle = c; x.beginPath(); x.ellipse(30, 34, 18, 13, -0.4, 0, 7); x.fill(); x.fillStyle = '#eee'; x.fillRect(42, 18, 10, 6); },
  mushroom(x, c) { x.fillStyle = '#e8dcc0'; x.fillRect(28, 30, 8, 18); x.fillStyle = c; x.beginPath(); x.arc(32, 32, 16, Math.PI, 0); x.fill(); },
  berry(x, c) { x.fillStyle = '#3f6b2e'; x.fillRect(30, 10, 4, 14); x.fillStyle = c; for (const [a, b] of [[24, 32], [38, 32], [31, 42], [20, 44], [42, 44]]) { x.beginPath(); x.arc(a, b, 7, 0, 7); x.fill(); } },
  bar(x, c) { x.fillStyle = c; x.fillRect(10, 24, 44, 16); x.fillStyle = '#d8d8d0'; x.fillRect(10, 24, 14, 16); },
  bottle(x, c) { x.fillStyle = c; x.beginPath(); x.roundRect(22, 18, 20, 36, 6); x.fill(); x.fillStyle = '#ddd'; x.fillRect(27, 8, 10, 10); },
  med(x, c) { x.fillStyle = '#eee'; x.beginPath(); x.roundRect(12, 16, 40, 32, 5); x.fill(); x.fillStyle = c; x.fillRect(28, 20, 8, 24); x.fillRect(20, 28, 24, 8); },
  bandage(x, c) { x.fillStyle = c; x.beginPath(); x.ellipse(32, 32, 18, 10, -0.5, 0, 7); x.fill(); x.fillStyle = '#d84a4a'; x.fillRect(28, 26, 8, 12); },
  syringe(x, c) { x.save(); x.translate(32, 32); x.rotate(-0.8); x.fillStyle = '#ddd'; x.fillRect(-5, -16, 10, 30); x.fillStyle = c; x.fillRect(-4, -8, 8, 20); x.fillStyle = '#999'; x.fillRect(-1, 14, 2, 12); x.fillRect(-8, -18, 16, 3); x.restore(); },
  pills(x, c) { x.fillStyle = '#eee'; x.beginPath(); x.roundRect(20, 14, 24, 36, 5); x.fill(); x.fillStyle = c; x.fillRect(20, 26, 24, 12); },
  box(x, c) { x.fillStyle = c; x.fillRect(10, 20, 44, 30); x.fillStyle = shade(c, 0.6); x.fillRect(10, 20, 44, 6); x.fillRect(18, 20, 4, 30); x.fillRect(42, 20, 4, 30); },
  furnace(x, c) { x.fillStyle = c; x.beginPath(); x.moveTo(14, 52); x.lineTo(20, 14); x.lineTo(44, 14); x.lineTo(50, 52); x.closePath(); x.fill(); x.fillStyle = '#f08030'; x.fillRect(26, 36, 12, 10); },
  fire(x, c) { x.fillStyle = '#5e4430'; x.fillRect(14, 44, 36, 6); x.fillStyle = c; x.beginPath(); x.moveTo(20, 44); x.quadraticCurveTo(32, 4, 44, 44); x.closePath(); x.fill(); },
  bench(x, c) { x.fillStyle = c; x.fillRect(8, 24, 48, 8); x.fillStyle = '#5a3d22'; x.fillRect(12, 32, 6, 20); x.fillRect(46, 32, 6, 20); x.fillRect(12, 42, 40, 4); },
  bag(x, c) { x.fillStyle = c; x.beginPath(); x.roundRect(10, 20, 44, 26, 10); x.fill(); x.fillStyle = shade(c, 1.3); x.fillRect(10, 26, 14, 14); },
  cabinet(x, c) { x.fillStyle = c; x.fillRect(16, 8, 32, 48); x.fillStyle = shade(c, 0.6); for (let i = 0; i < 4; i++) x.fillRect(19, 12 + i * 11, 26, 8); },
  door(x, c) { x.fillStyle = c; x.fillRect(18, 8, 28, 48); x.fillStyle = shade(c, 0.7); x.fillRect(22, 12, 20, 18); x.fillRect(22, 34, 20, 18); x.fillStyle = '#c7a34b'; x.fillRect(40, 32, 3, 5); },
  lock(x, c) { x.strokeStyle = '#999'; x.lineWidth = 5; x.beginPath(); x.arc(32, 26, 10, Math.PI, 0); x.stroke(); x.fillStyle = c; x.fillRect(18, 26, 28, 24); },
  codelock(x, c) { x.fillStyle = '#333'; x.fillRect(18, 10, 28, 44); x.fillStyle = c; for (let i = 0; i < 9; i++) x.fillRect(22 + (i % 3) * 8, 16 + Math.floor(i / 3) * 8, 5, 5); x.fillStyle = '#5ad88a'; x.fillRect(22, 44, 20, 4); },
};

// Short names for the icon corner, so you can tell items apart without opening them.
const SHORT = {
  metal_frag: 'Metal Frag', hqm_ore: 'HQ Ore', hqm: 'HQ Metal', explosives: 'Explosive', animal_fat: 'Fat', bone_frag: 'Bone Frag',
  low_grade: 'Low Grade', sewing_kit: 'Sew Kit', metal_pipe: 'Pipe', metal_spring: 'Spring', metal_blade: 'Blade', sheet_metal: 'Sheet Mtl',
  semi_body: 'Semi Body', tech_trash: 'Tech Trash', propane_tank: 'Propane', electric_fuse: 'Fuse', stone_hatchet: 'St Hatchet',
  stone_pickaxe: 'St Pickaxe', salvaged_axe: 'Salv Axe', salvaged_icepick: 'Icepick', building_plan: 'Plan', wooden_spear: 'Wd Spear',
  stone_spear: 'St Spear', salvaged_sword: 'Sword', wooden_arrow: 'Arrow', hv_arrow: 'HV Arrow', handmade_shell: 'HM Shell',
  buckshot: 'Buckshot', slug: 'Slug', pistol_ammo: 'Pistol Am', rifle_ammo: '5.56 Ammo', hunting_bow: 'Bow', pipe_pistol: 'Pipe Pist',
  semi_pistol: 'Semi Pist', double_barrel: 'DB Shotgun', pump_shotgun: 'Pump', semi_rifle: 'Semi Rifle', assault_rifle: 'AK',
  rocket_launcher: 'Launcher', bolt_rifle: 'Bolt', satchel_charge: 'Satchel', timed_charge: 'C4', cloth_hood: 'Hood', cloth_shirt: 'Shirt',
  cloth_pants: 'Pants', hide_boots: 'Boots', leather_gloves: 'Gloves', wood_chest: 'Wood Armor', bone_helmet: 'Bone Helm',
  roadsign_vest: 'Sign Vest', roadsign_kilt: 'Sign Kilt', coffee_can_helmet: 'Can Helm', metal_facemask: 'Facemask', metal_chest: 'Metal Vest',
  hazmat_suit: 'Hazmat', cooked_meat: 'Cooked', berries: 'Berries', canned_beans: 'Beans', canned_tuna: 'Tuna', chocolate: 'Choc Bar',
  granola: 'Granola', water_bottle: 'Water', med_syringe: 'Syringe', large_medkit: 'Medkit', anti_rad: 'Anti-Rad', wood_box: 'Box',
  large_box: 'Large Box', workbench1: 'Bench 1', workbench2: 'Bench 2', workbench3: 'Bench 3', research_table: 'Research',
  sleeping_bag: 'Sleep Bag', barricade: 'Barricade', claim_cabinet: 'Claim Cab', wood_door: 'Wood Door', metal_door: 'Metal Door', armored_door: 'Armor Door',
};
// Anything not listed: the name if it's short, otherwise abbreviated.
export function shortName(id) {
  const d = ITEMS[id]; if (!d) return '';
  if (SHORT[id]) return SHORT[id];
  const n = d.name;
  if (n.length <= 10) return n;
  const w = n.split(/[\s-]+/);
  const two = w[0] + ' ' + w[w.length - 1];
  if (two.length <= 10) return two;
  return w.length > 1 ? (w[0].slice(0, 4) + ' ' + w[w.length - 1].slice(0, 5)) : n.slice(0, 9) + '.';
}
function label(x, text) {
  let size = 12;
  x.textAlign = 'right'; x.textBaseline = 'top';
  do { x.font = `800 ${size}px Nunito, system-ui, sans-serif`; size -= 0.5; } while (x.measureText(text).width > 60 && size > 7);
  x.lineJoin = 'round'; x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(text, 62, 2);
  x.fillStyle = '#ffffff'; x.fillText(text, 62, 2);
}

export function iconURL(id, plain = false) {
  const key = plain ? id + ':plain' : id;
  if (cache.has(key)) return cache.get(key);
  const d = ITEMS[id];
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d');
  const fn = DRAW[d?.icon] || DRAW.box;
  try { fn(x, d?.color || '#888888', d || {}); } catch (e) { DRAW.box(x, '#888888'); }
  if (d && !plain) label(x, shortName(id));
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}

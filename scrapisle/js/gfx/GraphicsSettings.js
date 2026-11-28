// Graphics presets and individual settings. Values marked reload:true apply after a page reload.

export const PRESETS = {
  low: { texture: 256, aniso: 1, shadows: false, shadowRes: 1024, shadowDist: 40, renderScale: 0.6, viewDist: 650, grass: 0, decor: 0.4, treeDetail: 90, ao: false, water: 'simple', particles: 0.5, clouds: false, antialias: false, adaptive: true, lights: 2, maxPR: 1, cheap: true },
  medium: { texture: 256, aniso: 2, shadows: true, shadowRes: 1024, shadowDist: 50, renderScale: 0.8, viewDist: 900, grass: 0.5, decor: 0.7, treeDetail: 140, ao: false, water: 'full', particles: 0.8, clouds: true, antialias: true, adaptive: true, lights: 3, maxPR: 1.25 },
  high: { texture: 512, aniso: 4, shadows: true, shadowRes: 2048, shadowDist: 70, renderScale: 1, viewDist: 1150, grass: 1, decor: 1, treeDetail: 200, ao: false, water: 'full', particles: 1, clouds: true, antialias: true, adaptive: false, lights: 4, maxPR: 2 },
  ultra: { texture: 512, aniso: 8, shadows: true, shadowRes: 4096, shadowDist: 100, renderScale: 1.25, viewDist: 1400, grass: 1.6, decor: 1.4, treeDetail: 280, ao: true, water: 'full', particles: 1.2, clouds: true, antialias: true, adaptive: false, lights: 6, maxPR: 2 },
};
export const RELOAD_KEYS = new Set(['texture', 'aniso', 'antialias', 'cheap']);

// Pick a sensible default from the device.
export function detectPreset() {
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  const mobile = /Mobi|Android/i.test(navigator.userAgent);
  if (mobile || mem <= 2) return 'low';
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}
export function resolve(gfx) {
  const base = PRESETS[gfx.preset] || PRESETS.medium;
  return Object.assign({}, base, gfx.custom || {});
}

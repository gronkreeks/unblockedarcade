// Optional screen-space ambient occlusion (High/Ultra). Loaded on demand; if the add-on modules fail
// to load the game keeps rendering directly, with the baked AO in textures and terrain.
import * as THREE from 'three';

export class PostFX {
  constructor(game) {
    this.game = game; this.enabled = true; this.ready = false;
    this.init().catch(e => { console.warn('SSAO unavailable', e); this.enabled = false; });
  }
  async init() {
    const [{ EffectComposer }, { RenderPass }, { SSAOPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/SSAOPass.js'), import('three/addons/postprocessing/OutputPass.js'),
    ]);
    const G = this.game, w = innerWidth, h = innerHeight;
    this.composer = new EffectComposer(G.renderer);
    this.composer.addPass(new RenderPass(G.scene, G.camera));
    const ssao = new SSAOPass(G.scene, G.camera, Math.floor(w / 2), Math.floor(h / 2), 16);   // 16 samples (three's default 32 costs twice the GPU time for little difference after the blur)
    ssao.kernelRadius = 0.9; ssao.minDistance = 0.0006; ssao.maxDistance = 0.04;
    this.ssao = ssao;
    // The shadow map is already drawn for this frame by the main pass; don't draw it again for the
    // normals pass. And only walk the drawn part of the scene to hide points and lines (three.js walks
    // every object, hidden ones too, twice a frame).
    const draw = ssao.render.bind(ssao);
    ssao.render = (...a) => { const sm = G.renderer.shadowMap, au = sm.autoUpdate; sm.autoUpdate = false; sm.needsUpdate = false; draw(...a); sm.autoUpdate = au; };
    const hid = [];
    // Grass is also left out: its cut-out blades would count as solid squares there.
    ssao.overrideVisibility = () => {
      hid.length = 0;
      G.scene.traverseVisible(o => { if (o.isPoints || o.isLine) hid.push(o); });
      const grass = G.decor && G.decor.pools.grass;
      if (grass) for (const m of grass.meshes) if (m.visible) hid.push(m);
      // The shading only reaches a few metres, so far things (past the shadow range: far characters,
      // crates, trees and rocks) are left out of the normals pass too.
      if (G.gfx.shadows) {
        for (const b of G.batch.list) if (b.mesh.visible && !b.mesh.castShadow) hid.push(b.mesh);
        if (G.res.pools) for (const p of G.res.pools.values()) for (const w of ['N', 'L']) for (const m of p.sets[w]) if (m.visible) hid.push(m);
      }
      for (const o of hid) o.visible = false;
    };
    ssao.restoreVisibility = () => { for (const o of hid) o.visible = true; hid.length = 0; };
    this.composer.addPass(ssao);
    this.composer.addPass(new OutputPass());
    this.ready = true;
  }
  setSize(w, h) { if (this.composer) { this.composer.setSize(w, h); this.ssao.setSize(Math.floor(w / 2), Math.floor(h / 2)); } }
  render() { this.composer.render(); }
}
export { THREE };

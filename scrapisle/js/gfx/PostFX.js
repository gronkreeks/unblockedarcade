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
    const ssao = new SSAOPass(G.scene, G.camera, Math.floor(w / 2), Math.floor(h / 2));
    ssao.kernelRadius = 0.9; ssao.minDistance = 0.0006; ssao.maxDistance = 0.04;
    this.ssao = ssao;
    this.composer.addPass(ssao);
    this.composer.addPass(new OutputPass());
    this.ready = true;
  }
  setSize(w, h) { if (this.composer) { this.composer.setSize(w, h); this.ssao.setSize(Math.floor(w / 2), Math.floor(h / 2)); } }
  render() { this.composer.render(); }
}
export { THREE };

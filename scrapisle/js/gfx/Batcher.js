// Draws many small objects that share models as instanced batches. Bots, scientists and animals are
// built from 20 to 30 separate parts each, and every box, furnace and loot crate from a few more. Drawn
// one by one, that's a draw call per part (and another for its shadow), which is what held the frame
// rate down near bases and fights. Here every visible part is copied into one batch per model,
// texture set and shadow setting, so each kind of part costs one draw however many there are. Parts
// that differ only in colour (skin tones, hair, cloth dyes, fur) share a batch and keep their colour
// per instance.
// The parts keep their animation and visibility as before; they only move to a layer no camera
// draws, and the batches are rebuilt every frame from their positions.
import * as THREE from 'three';

const HIDDEN = 1 << 30;   // layer mask for the original parts
const WHITE = new THREE.Color(1, 1, 1);
const DETAIL_R2 = 60 * 60;   // past this, characters' small parts (eyes, hands, feet...) are left out

export class Batcher {
  constructor(scene) {
    this.scene = scene;
    this.roots = new Set();
    this.batches = new Map();
    this.list = [];
    this.white = new Map();
  }
  add(root) { this.roots.add(root); }
  // A group whose children are separate objects (loot, deployables): each child counts on its own.
  addGroup(group) { group.userData.batchGroup = true; this.roots.add(group); }
  // Call after world matrices are up to date and before rendering. Only things within shadowR of the
  // camera go in shadow-casting batches (the shadow map covers no more than that).
  update(cam, shadowR) {
    for (const b of this.list) b.n = 0;
    const r2 = shadowR * shadowR;
    for (const root of this.roots) {
      if (!root.parent) { this.roots.delete(root); continue; }   // removed from the world
      if (!this.shown(root)) continue;
      if (root.userData.batchGroup) {
        for (const c of root.children) if (c.visible) this.collect(c, (c.position.x - cam.x) ** 2 + (c.position.z - cam.z) ** 2 < r2, true);
      } else {
        const d2 = (root.position.x - cam.x) ** 2 + (root.position.z - cam.z) ** 2;
        this.collect(root, d2 < r2, d2 < DETAIL_R2);
      }
    }
    for (const b of this.list) {
      const m = b.mesh;
      m.count = b.n; m.visible = b.n > 0;
      if (b.n) for (const a of [m.instanceMatrix, m.instanceColor]) { a.clearUpdateRanges(); a.addUpdateRange(0, b.n * a.itemSize); a.needsUpdate = true; }
    }
  }
  shown(o) {
    for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === this.scene) return true; }
    return false;
  }
  collect(o, near, close) {
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) {
      const mat = o.material;
      if (o.__bm !== mat || o.__bg !== o.geometry) this.classify(o);
      if (!close && o.geometry.userData.detail) o.layers.mask = HIDDEN;   // too small to see from here
      else if (!o.__bk) o.layers.mask = 1;
      else {
        o.layers.mask = HIDDEN;
        const sh = near && o.castShadow, key = sh ? o.__bk + 's' : o.__bk;
        let b = this.batches.get(key);
        if (!b) { b = { n: 0, mesh: this.make(o.geometry, this.baseMat(mat), 16, sh, o.receiveShadow) }; this.batches.set(key, b); this.list.push(b); }
        if (b.n >= b.mesh.instanceMatrix.count) this.grow(b);
        b.mesh.instanceMatrix.array.set(o.matrixWorld.elements, b.n * 16);
        const c = o.__bc, ca = b.mesh.instanceColor.array, k = b.n * 3;
        ca[k] = c.r; ca[k + 1] = c.g; ca[k + 2] = c.b;
        b.n++;
      }
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) if (ch[i].visible) this.collect(ch[i], near, close);
  }
  // Which batch a part goes in (worked out once per model and material). See-through parts need
  // sorting and mirrored ones would turn inside out, so those are drawn as before.
  classify(o) {
    const mat = o.material;
    o.__bm = mat; o.__bg = o.geometry; o.__bk = null;
    if (Array.isArray(mat) || mat.transparent || o.matrixWorld.determinant() < 0) return;
    const tinted = !!(mat.userData.base && mat.color);
    o.__bc = tinted ? mat.color : WHITE;
    o.__bk = o.geometry.id + ':' + (tinted ? mat.userData.base : '#' + mat.id) + (o.receiveShadow ? 'r' : '');
  }
  // the batch's material: the part's own, or for colour-only variants a white copy tinted per instance
  baseMat(mat) {
    if (!mat.userData.base || !mat.color) return mat;
    const k = mat.userData.base + ':' + mat.type;
    let w = this.white.get(k);
    if (!w) {
      w = mat.clone(); w.color.set(0xffffff);
      w.onBeforeCompile = mat.onBeforeCompile; w.customProgramCacheKey = mat.customProgramCacheKey;
      this.white.set(k, w);
    }
    return w;
  }
  make(geo, mat, cap, cast, receive) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false; m.matrixAutoUpdate = false;
    m.castShadow = cast; m.receiveShadow = receive;
    this.scene.add(m);
    return m;
  }
  grow(b) {
    const old = b.mesh, m = this.make(old.geometry, old.material, old.instanceMatrix.count * 2, old.castShadow, old.receiveShadow);
    m.instanceMatrix.array.set(old.instanceMatrix.array); m.instanceColor.array.set(old.instanceColor.array);
    this.scene.remove(old); old.dispose();
    b.mesh = m;
  }
}

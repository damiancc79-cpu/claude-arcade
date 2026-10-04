/* ============================================================================
   kit.js — small shared builders used across the room and its fixtures.
============================================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { blobTexture, labelTexture } from './textures.js';

/* ---------------------------------------------------------------- batching --
   The arcade is static scenery made of hundreds of small boxes. Left as
   individual meshes that is well over a thousand draw calls before a single
   real machine exists. Batch collects geometry with baked world transforms and
   emits one merged mesh per material.                                        */
export class Batch {
  constructor(){ this.groups = new Map(); }

  add(geometry, material, matrix){
    const g = geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!this.groups.has(material)) this.groups.set(material, []);
    this.groups.get(material).push(g);
    return this;
  }

  /** Absorb an Object3D tree. The object needs no parent — local transforms
      are resolved from it downward, so the result is relative to its own root. */
  addObject(root){
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (o.isMesh && !o.isInstancedMesh) this.add(o.geometry, o.material, o.matrixWorld);
    });
    return this;
  }

  /** Emit merged meshes into `parent`. Returns them so they can be disposed. */
  build(parent){
    const out = [];
    for (const [material, list] of this.groups){
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.frustumCulled = false;      // one mesh spans the room; culling can't help
      parent.add(mesh);
      out.push(mesh);
      for (const g of list) if (g !== merged) g.dispose();
    }
    this.groups.clear();
    return out;
  }
}

/** Dispose and detach a list of meshes produced by Batch.build(). */
export function clearBatch(parent, meshes){
  for (const m of meshes){ parent.remove(m); m.geometry.dispose(); }
  meshes.length = 0;
}

export const MAT = {
  wallTrim  : new THREE.MeshStandardMaterial({ color:0x2b2b52, roughness:.55, metalness:.35 }),
  darkMetal : new THREE.MeshStandardMaterial({ color:0x191a2c, roughness:.48, metalness:.72 }),
  steel     : new THREE.MeshStandardMaterial({ color:0xb9c2d8, roughness:.28, metalness:.92 }),
  black     : new THREE.MeshStandardMaterial({ color:0x0d0c18, roughness:.82, metalness:.15 }),
  rubber    : new THREE.MeshStandardMaterial({ color:0x1a1a22, roughness:.96 }),
  glass     : new THREE.MeshPhysicalMaterial({
                color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.09,
                side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.28 }),
  cabinet   : new THREE.MeshStandardMaterial({ color:0x24244a, roughness:.42, metalness:.5 }),
};

export function emissive(color, intensity = 1.6, opts = {}){
  return new THREE.MeshStandardMaterial({
    color: 0x101018, emissive: color, emissiveIntensity: intensity,
    roughness: .5, metalness: 0, ...opts,
  });
}

/** Emissive panel that reads as a lit surface (signs, troffers, light strips). */
export function litPanel(map, intensity = 1.35, opts = {}){
  return new THREE.MeshStandardMaterial({
    map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: intensity,
    roughness: .6, metalness: 0, toneMapped: true, ...opts,
  });
}

export function box(w, h, d, mat, x, y, z, parent){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

/** Flat quad on a wall/ceiling. `dir` picks the facing. */
export function panel(w, h, mat, x, y, z, rotY = 0, parent){
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  if (parent) parent.add(m);
  return m;
}

let _blobGeo = null, _blobMat = null;
/** Cheap fake contact shadow — far cheaper than shadow maps for a big floor. */
export function blobShadow(w, d, x, z, parent, opacity = 1){
  if (!_blobGeo){
    _blobGeo = new THREE.PlaneGeometry(1, 1);
    _blobMat = new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent:true, depthWrite:false,
      blending: THREE.NormalBlending,
    });
  }
  const m = new THREE.Mesh(_blobGeo, opacity === 1 ? _blobMat : _blobMat.clone());
  if (opacity !== 1) m.material.opacity = opacity;
  m.rotation.x = -Math.PI/2;
  m.position.set(x, 0.012, z);
  m.scale.set(w, d, 1);
  m.renderOrder = 1;
  if (parent) parent.add(m);
  return m;
}

/** Camera-facing text chip, used by the bay-debug overlay. */
export function labelSprite(text, color, scale = 0.5){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: labelTexture(text, color), transparent:true, depthTest:false, depthWrite:false }));
  s.scale.set(scale, scale*0.5, 1);
  s.renderOrder = 999;
  return s;
}

/** Thin glowing tube for neon trim runs. */
export function neonRun(len, color, x, y, z, rotY = 0, parent, radius = 0.028){
  const g = new THREE.Group();
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, len, 8),
    emissive(color, 3.2)
  );
  tube.rotation.z = Math.PI/2;
  g.add(tube);
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  if (parent) parent.add(g);
  return g;
}

/** Axis-aligned collision volume for the walk controller. */
export function aabb(cx, cz, w, d, pad = 0){
  return { x0: cx - w/2 - pad, x1: cx + w/2 + pad, z0: cz - d/2 - pad, z1: cz + d/2 + pad };
}

/** Rotate a footprint by a multiple of 90°, returning an axis-aligned box. */
export function footprint(cx, cz, w, d, rotY){
  const swap = Math.abs(Math.round(rotY / (Math.PI/2))) % 2 === 1;
  return aabb(cx, cz, swap ? d : w, swap ? w : d);
}

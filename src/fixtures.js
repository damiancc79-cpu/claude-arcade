/* ============================================================================
   fixtures.js — everything that stands on the floor but isn't a crane bay:
   the gachapon banks, prize shelving, redemption counter, change machines.

   All capsules across the whole floor share one InstancedMesh, so a wall of
   thirty gacha units costs a single draw call for its contents.
============================================================================ */
import * as THREE from 'three';
import { MAT, Batch, box, emissive, litPanel, blobShadow, aabb } from './kit.js';
import { gachaLabel, signTexture, priceTexture } from './textures.js';
import { ROOM } from './room.js';

const CAPSULE_COLORS = [
  0xff5c8a, 0xffd166, 0x7ce38b, 0x6ec3ff, 0xc792ea,
  0xff9f6e, 0x5fe1c0, 0xff7ad9, 0xfff3d6,
];

/* --------------------------------------------------------- gacha column -- */
const GACHA = { w: 0.42, d: 0.40, unitH: 0.44, stack: 3, baseH: 0.42 };

/**
 * One stacked column of capsule-toy machines.
 * Pushes capsule transforms into `capsuleOut` for later instancing.
 */
const GM = {
  body: new THREE.MeshStandardMaterial({ color:0xe9ecf5, roughness:.5, metalness:.15 }),
  dome: new THREE.MeshPhysicalMaterial({
          color:0xffffff, roughness:.05, metalness:0, transparent:true, opacity:.20,
          side:THREE.DoubleSide, depthWrite:false }),
  knob: new THREE.MeshStandardMaterial({ color:0xd8dcea, roughness:.3, metalness:.7 }),
  glow: emissive(0xffd166, 2.6),
};
const LABEL_MATS = new Map();
const labelMat = i => {
  if (!LABEL_MATS.has(i)) LABEL_MATS.set(i, litPanel(gachaLabel(i), 0.42));
  return LABEL_MATS.get(i);
};
const SHELF_MATS = {
  deck : new THREE.MeshStandardMaterial({ color:0x2e2e5c, roughness:.6, metalness:.3 }),
  strip: emissive(0xfff0d0, 2.2),
  sign : litPanel(signTexture('景品', 'PRIZE', '#37e6ff', '#c792ea'), 1.35),
};
const PLUSH_MATS = new Map();
const plushMat = i => {
  const c = CAPSULE_COLORS[i % CAPSULE_COLORS.length];
  if (!PLUSH_MATS.has(c)) PLUSH_MATS.set(c, new THREE.MeshStandardMaterial({ color:c, roughness:.92 }));
  return PLUSH_MATS.get(c);
};

function gachaColumn(seed, capsuleOut, colMatrix){
  const g = new THREE.Group();
  const { w, d, unitH, stack, baseH } = GACHA;

  // pedestal
  box(w + 0.04, baseH, d + 0.04, MAT.darkMetal, 0, baseH/2, 0, g);
  box(w + 0.07, 0.04, d + 0.07, MAT.steel, 0, baseH, 0, g);

  for (let i = 0; i < stack; i++){
    const y = baseH + i * unitH;
    const unit = new THREE.Group();
    unit.position.y = y;
    g.add(unit);

    // clear capsule bowl (front) + machined back half
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(w * 0.46, 16, 12), GM.dome);
    bowl.position.set(0, unitH * 0.60, 0.02);
    bowl.scale.set(1, 0.92, 1);
    unit.add(bowl);

    box(w, unitH * 0.42, d * 0.55, GM.body, 0, unitH * 0.21, -d * 0.20, unit);
    // front fascia with the product label
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.86, unitH * 0.34),
      labelMat((seed + i) % 6)
    );
    face.position.set(0, unitH * 0.20, d * 0.10);
    unit.add(face);

    // coin knob + delivery flap
    const knob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), GM.knob);
    knob.rotation.x = Math.PI/2;
    knob.position.set(w * 0.28, unitH * 0.20, d * 0.13);
    unit.add(knob);
    box(w * 0.42, 0.07, 0.02, MAT.black, -w * 0.14, unitH * 0.05, d * 0.12, unit);

    // capsules inside the bowl
    const bowlY = y + unitH * 0.60;
    for (let k = 0; k < 9; k++){
      const a = (k / 9) * Math.PI * 2 + seed;
      const r = w * 0.20 * Math.sqrt(Math.random());
      capsuleOut.push({
        x: Math.cos(a) * r,
        y: bowlY - w * 0.20 + Math.random() * w * 0.34,
        z: 0.02 + Math.sin(a) * r,
        c: CAPSULE_COLORS[(k + seed) % CAPSULE_COLORS.length],
        s: 0.030 + Math.random() * 0.008,
        col: colMatrix,
      });
    }
  }

  // top header light
  const topY = baseH + stack * unitH;
  box(w + 0.06, 0.10, d + 0.06, MAT.darkMetal, 0, topY + 0.05, 0, g);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, 0.07), GM.glow);
  glow.position.set(0, topY + 0.05, d/2 + 0.035);
  g.add(glow);

  return g;
}

/**
 * A run of gacha columns along a line.
 * `dir` is +1 for columns advancing along +axis; `axis` is 'x' or 'z'.
 */
function gachaBank(parent, { x, z, rotY, count, axis = 'x' }, capsules, colliders){
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  parent.add(group);

  const pitch = GACHA.w + 0.04;
  const start = -((count - 1) * pitch) / 2;

  for (let i = 0; i < count; i++){
    const local = new THREE.Matrix4();
    const cx = start + i * pitch;
    const col = gachaColumn(i, capsules, null);
    col.position.x = cx;
    group.add(col);

    // record the world matrix so capsules can be instanced globally
    group.updateMatrixWorld(true);
    local.copy(col.matrixWorld);
    for (const c of capsules) if (c.col === null) c.col = local;
  }

  // one blob + one collider for the whole run
  const runLen = count * pitch;
  group.updateMatrixWorld(true);
  const wx = Math.abs(Math.sin(rotY)) > 0.5 ? GACHA.d + 0.1 : runLen;
  const wz = Math.abs(Math.sin(rotY)) > 0.5 ? runLen : GACHA.d + 0.1;
  blobShadow(wx * 1.15, wz * 1.6, x, z, parent, 0.85);
  colliders.push(aabb(x, z, wx, wz, 0.05));

  return group;
}

/* ------------------------------------------------------------- shelving -- */
function prizeShelf(parent, { x, z, rotY, w = 2.6 }, colliders){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  parent.add(g);

  const D = 0.46, H = 2.05;
  box(w, 0.10, D, MAT.darkMetal, 0, 0.05, 0, g);
  box(w, H, 0.06, MAT.cabinet, 0, H/2, -D/2 + 0.03, g);          // back
  for (const sx of [-1, 1]) box(0.06, H, D, MAT.cabinet, sx*(w/2 - 0.03), H/2, 0, g);

  for (let s = 0; s < 4; s++){
    const y = 0.34 + s * 0.46;
    box(w - 0.10, 0.035, D - 0.05, SHELF_MATS.deck, 0, y, 0, g);
    // under-shelf light strip
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.16, 0.02), SHELF_MATS.strip);
    strip.rotation.x = Math.PI/2;
    strip.position.set(0, y - 0.025, 0.04);
    g.add(strip);

    // boxed prizes
    const n = Math.floor(w / 0.34);
    for (let i = 0; i < n; i++){
      const px = -w/2 + 0.22 + i * 0.34;
      if (Math.random() < 0.16) continue;
      const h = 0.20 + Math.random() * 0.12;
      const bx = box(0.26, h, 0.26, plushMat(i + s), px, y + h/2 + 0.02, 0, g);
      bx.rotation.y = (Math.random() - 0.5) * 0.5;
    }
  }
  // header sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, 0.30), SHELF_MATS.sign);
  sign.position.set(0, H + 0.18, D/2 - 0.02);
  g.add(sign);
  box(w, 0.34, D * 0.4, MAT.darkMetal, 0, H + 0.17, 0, g);

  blobShadow(w * 1.2, D * 2.4, x, z, parent, 0.8);
  colliders.push(aabb(x, z,
    Math.abs(Math.sin(rotY)) > 0.5 ? D : w,
    Math.abs(Math.sin(rotY)) > 0.5 ? w : D, 0.05));
  return g;
}

/* -------------------------------------------------------------- counter -- */
function prizeCounter(parent, colliders){
  const g = new THREE.Group();
  const w = 3.4, d = 0.72, h = 1.06;
  g.position.set(5.1, 0, -ROOM.HZ + d/2 + 0.06);
  parent.add(g);

  box(w, h, d, MAT.cabinet, 0, h/2, 0, g);
  box(w + 0.10, 0.07, d + 0.12, MAT.steel, 0, h + 0.03, 0, g);
  // glow under the counter lip
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, 0.05), emissive(0x37e6ff, 3.0));
  strip.position.set(0, h - 0.10, d/2 + 0.005);
  g.add(strip);

  // back wall sign
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 0.62),
    litPanel(signTexture('景品交換', 'PRIZE EXCHANGE', '#ffd166', '#ff9f6e'), 1.5));
  sign.position.set(0, 2.20, -d/2 - 0.02);
  g.add(sign);

  // a couple of display prizes on the counter
  for (let i = 0; i < 5; i++){
    const s = 0.13 + Math.random() * 0.06;
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10),
      new THREE.MeshStandardMaterial({ color: CAPSULE_COLORS[i], roughness:.9 }));
    m.position.set(-w/2 + 0.45 + i * 0.62, h + 0.08 + s, 0);
    g.add(m);
  }

  blobShadow(w * 1.2, d * 2.2, g.position.x, g.position.z, parent, 0.8);
  colliders.push(aabb(g.position.x, g.position.z, w, d, 0.05));
  return g;
}

/* ------------------------------------------------------- change machine -- */
function changeMachine(parent, x, z, rotY, colliders){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  parent.add(g);

  const w = 0.52, d = 0.42, h = 1.44;
  box(w, h, d, new THREE.MeshStandardMaterial({ color:0xd4d8e6, roughness:.4, metalness:.5 }),
      0, h/2, 0, g);
  box(w + 0.03, 0.06, d + 0.03, MAT.darkMetal, 0, h, 0, g);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 0.08, 0.26),
    litPanel(signTexture('両替', 'CHANGE', '#ffd166', '#ff5c8a'), 1.3));
  face.position.set(0, h - 0.22, d/2 + 0.004);
  g.add(face);
  box(w - 0.14, 0.10, 0.02, MAT.black, 0, 0.72, d/2, g);

  blobShadow(w * 1.8, d * 2.0, x, z, parent, 0.8);
  colliders.push(aabb(x, z,
    Math.abs(Math.sin(rotY)) > 0.5 ? d : w,
    Math.abs(Math.sin(rotY)) > 0.5 ? w : d, 0.05));
  return g;
}

/* ============================================================== assemble == */
export function buildFixtures(scene){
  const group = new THREE.Group();
  scene.add(group);
  // Everything is authored into `staging` as ordinary nested meshes, then
  // merged down into a few draw calls. Nothing here ever moves.
  const staging = new THREE.Group();
  const colliders = [];
  const capsules = [];
  const { HX, HZ } = ROOM;

  // --- gacha bank along the west wall, facing +X --------------------------
  gachaBank(staging, { x: -HX + GACHA.d/2 + 0.10, z: -1.0, rotY: Math.PI/2, count: 12 },
            capsules, colliders);

  // --- gacha island near the entrance, back to back -----------------------
  gachaBank(staging, { x: -2.2, z: 3.30, rotY: 0,       count: 7 }, capsules, colliders);
  gachaBank(staging, { x: -2.2, z: 3.74, rotY: Math.PI, count: 7 }, capsules, colliders);

  // --- prize shelving -----------------------------------------------------
  prizeShelf(staging, { x: -5.6, z: -HZ + 0.28, rotY: 0,       w: 2.6 }, colliders);
  prizeShelf(staging, { x:  4.6, z:  HZ - 0.28,  rotY: Math.PI, w: 2.6 }, colliders);
  prizeShelf(staging, { x: -HX + 0.28, z: 3.9,   rotY: Math.PI/2, w: 2.4 }, colliders);

  // --- counter + change machines -----------------------------------------
  prizeCounter(staging, colliders);
  changeMachine(staging, -HX + 0.34, 5.60, Math.PI/2, colliders);
  changeMachine(staging,  2.60, HZ - 0.30, Math.PI, colliders);

  /* ---- one InstancedMesh for every capsule on the floor ---------------- */
  staging.updateMatrixWorld(true);
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const mat = new THREE.MeshStandardMaterial({ roughness:.35, metalness:.05 });
  const inst = new THREE.InstancedMesh(geo, mat, capsules.length);
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), col = new THREE.Color();
  capsules.forEach((c, i) => {
    v.set(c.x, c.y, c.z);
    if (c.col) v.applyMatrix4(c.col);
    m4.makeScale(c.s, c.s, c.s).setPosition(v);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, col.setHex(c.c));
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

  // collapse the staged scenery into one mesh per material
  const merged = new Batch().addObject(staging).build(group);
  group.add(inst);

  return { group, colliders, merged, capsuleCount: capsules.length,
           gachaUnits: Math.round(capsules.length / (9 * GACHA.stack)) };
}

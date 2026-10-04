/* ============================================================================
   layout.js — the machine BAY system.

   This is the seam the arcade is built around. The room reserves a set of bays
   (position, facing, footprint, intended machine family). Right now every bay
   shows a generic proxy cabinet so the floor reads correctly; later, a real
   machine is dropped in with `bays.mount(id, object3D)` and the proxy hides.

   A mounted machine is expected to be modelled with:
     · its base sitting on y = 0
     · its "front" facing +Z
     · centred on the origin in X/Z
   `mount()` will optionally rescale it to fit the reserved footprint, which is
   how an existing cabinet built at a different scale gets normalised.

   Proxies are merged into a handful of meshes rather than kept as ~400 separate
   objects; mounting rebuilds that merge, which is cheap because it happens at
   setup time and never per frame.
============================================================================ */
import * as THREE from 'three';
import { MAT, Batch, clearBatch, box, emissive, litPanel, blobShadow,
         labelSprite, footprint } from './kit.js';
import { priceTexture } from './textures.js';

/** Reserved volume for one crane cabinet, in metres (a real UFO catcher). */
export const BAY_SIZE = { w: 0.98, h: 1.95, d: 0.92 };

/**
 * Every machine family on the floor. The first four were reserved before any
 * machine existed; the last five are the settings that were built afterwards
 * and had no bays of their own, which STATUS.md flagged as a thing to decide
 * before arranging. They are decided here rather than by reassigning bays at
 * mount time, so the floor plan stays readable in one place.
 */
export const FAMILIES = {
  'claw-2arm'  : { label:'2-ARM',   color:0xff2f7f, jp:'２本爪' },
  'claw-3arm'  : { label:'3-ARM',   color:0x37e6ff, jp:'３本爪' },
  'claw-bridge': { label:'BRIDGE',  color:0xffd166, jp:'橋渡し' },
  'claw-big'   : { label:'BIG',     color:0x7ce38b, jp:'大型' },
  'himo'       : { label:'STRING',  color:0xc792ea, jp:'ヒモ' },
  'slider'     : { label:'SLIDER',  color:0xff9f6e, jp:'スライダー' },
  'ringhook'   : { label:'RING',    color:0xffc93c, jp:'リング掛け' },
  'seesaw'     : { label:'SEESAW',  color:0x4be0c4, jp:'シーソー' },
  'push'       : { label:'PUSH',    color:0xff8f3f, jp:'押し出し' },
};

/**
 * THE FLOOR PLAN, one entry per bay along each row.
 *
 * Laid out the way an operator lays one out rather than by tidy blocks. The
 * cheap high-turnover cabinets — 二本爪 and 三本爪 — take the aisle-facing front
 * rows where the traffic is. The specialist settings that need a player to stop
 * and read them (ヒモ, スライダー, リング掛け, シーソー, 押し出し) go on the
 * back rows, which face the quieter side of each island. 大型 keeps the east
 * wall: those cabinets are the tallest thing on the floor and a wall row is the
 * only place they do not block sightlines.
 */
const PLAN = {
  AF: ['claw-2arm', 'claw-2arm', 'claw-2arm', 'claw-2arm', 'claw-3arm', 'claw-3arm', 'claw-3arm'],
  AB: ['claw-3arm', 'claw-3arm', 'claw-3arm', 'claw-bridge', 'claw-bridge', 'himo', 'himo'],
  BF: ['claw-2arm', 'claw-2arm', 'claw-2arm', 'claw-2arm', 'slider', 'slider', 'slider'],
  BB: ['claw-bridge', 'claw-bridge', 'ringhook', 'ringhook', 'seesaw', 'seesaw', 'push'],
  E : Array.from({ length: 8 }, () => 'claw-big'),
};

const PITCH = 1.04;                       // centre-to-centre spacing in a row

/* --------------------------------------------------------- shared materials */
/* Created once: a fresh material per cabinet would defeat the batching. */
const PM = {
  body   : MAT.cabinet,
  trim   : MAT.darkMetal,
  steel  : MAT.steel,
  black  : MAT.black,
  glass  : MAT.glass,
  inner  : new THREE.MeshStandardMaterial({ color:0x2f2f61, roughness:.68, metalness:.2 }),
  shell  : new THREE.MeshStandardMaterial({ color:0x1e1e42, roughness:.5, metalness:.45 }),
  sticker: litPanel(priceTexture(), 0.55),
};
const MARQUEE = new Map();
function marqueeMat(color){
  if (!MARQUEE.has(color)) MARQUEE.set(color, emissive(color, 1.7));
  return MARQUEE.get(color);
}

/** Build one back-to-back island: two rows facing opposite directions. */
function island(prefix, zc, out){
  const front = PLAN[prefix + 'F'], back = PLAN[prefix + 'B'];
  const count = front.length;
  const halfD = BAY_SIZE.d / 2;
  const x0 = -((count - 1) * PITCH) / 2;
  for (let i = 0; i < count; i++){
    const x = x0 + i * PITCH;
    out.push({ id:`${prefix}F${i+1}`, kind:front[i], x, z: zc + halfD, rotY: 0 });
    out.push({ id:`${prefix}B${i+1}`, kind:back[i],  x, z: zc - halfD, rotY: Math.PI });
  }
}

/** The floor plan. Edit here to rearrange the arcade. */
export function buildBays(){
  const bays = [];
  island('A', -4.00, bays);
  island('B', -0.40, bays);

  // Long row against the east wall, facing back into the room.
  PLAN.E.forEach((kind, i) => {
    bays.push({ id:`E${i+1}`, kind, x: 6.95, z: -4.60 + i * PITCH, rotY: -Math.PI/2 });
  });
  for (const b of bays){
    b.size = { ...BAY_SIZE };
    b.filled = false;
    b.machine = null;
  }
  return bays;
}

/* ------------------------------------------------------------------ proxy */
/**
 * Generic cabinet stand-in. Deliberately plain — enough silhouette and glow to
 * make the floor read as an arcade, but clearly not a finished machine.
 */
function proxyCabinet(kind){
  const g = new THREE.Group();
  const { w, d } = BAY_SIZE;
  const fam = FAMILIES[kind] || FAMILIES['claw-2arm'];
  const BASE_H = 0.60, GLASS_H = 1.02, HEAD_H = 0.28;

  // plinth
  box(w, BASE_H, d, PM.body, 0, BASE_H/2, 0, g);
  box(w + 0.03, 0.06, d + 0.03, PM.trim, 0, BASE_H, 0, g);
  box(w + 0.02, 0.07, d + 0.02, PM.black, 0, 0.035, 0, g);

  // Display cage. Packed-in cabinets are panelled on the back and sides and
  // glazed only at the front, which is what makes a row read as a solid wall
  // of machines instead of a milky tunnel you can see straight through.
  const cy = BASE_H + GLASS_H/2;
  box(w, GLASS_H, 0.04, PM.shell, 0, cy, -d/2 + 0.02, g);                  // back
  for (const sx of [-1, 1]) box(0.04, GLASS_H, d, PM.shell, sx*(w/2 - 0.02), cy, 0, g);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.10, GLASS_H - 0.06), PM.glass);
  front.position.set(0, cy, d/2 - 0.02);
  g.add(front);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]){
    box(0.055, GLASS_H, 0.055, PM.steel,
        sx*(w/2 - 0.03), cy, sz*(d/2 - 0.03), g);
  }
  // interior deck so the empty cage isn't a black void
  box(w - 0.12, 0.02, d - 0.12, PM.inner, 0, BASE_H + 0.02, 0, g);

  // lit marquee header
  box(w, HEAD_H, d, PM.trim, 0, BASE_H + GLASS_H + HEAD_H/2, 0, g);
  const mm = marqueeMat(fam.color);
  for (const sz of [1, -1]){
    const lit = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, HEAD_H - 0.06), mm);
    lit.position.set(0, BASE_H + GLASS_H + HEAD_H/2, sz * (d/2 + 0.004));
    lit.rotation.y = sz > 0 ? 0 : Math.PI;
    g.add(lit);
  }
  box(w + 0.04, 0.05, d + 0.04, PM.trim, 0, BASE_H + GLASS_H + HEAD_H + 0.02, 0, g);

  // price sticker + coin door on the front face
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.15), PM.sticker);
  sticker.position.set(w/2 - 0.24, BASE_H - 0.16, d/2 + 0.006);
  g.add(sticker);
  box(0.16, 0.10, 0.03, PM.black, -w/2 + 0.22, BASE_H - 0.17, d/2, g);

  return g;
}

/* ------------------------------------------------------------------- bays */
export class Bays {
  constructor(scene){
    this.list  = buildBays();
    this.group = new THREE.Group();      // merged proxy meshes live here
    this.mounts = new THREE.Group();     // real machines get parented here
    this.debug = new THREE.Group();
    this.debug.visible = false;
    scene.add(this.group, this.mounts, this.debug);
    this._proxyMeshes = [];

    for (const bay of this.list){
      const holder = new THREE.Group();
      holder.position.set(bay.x, 0, bay.z);
      holder.rotation.y = bay.rotY;
      this.mounts.add(holder);
      bay.holder = holder;

      blobShadow(bay.size.w * 1.7, bay.size.d * 1.7, bay.x, bay.z, this.group, 0.9);
      this._debugFor(bay);
    }
    this._rebuildProxies();
  }

  /** Re-merge the stand-ins for every bay that has no real machine yet. */
  _rebuildProxies(){
    clearBatch(this.group, this._proxyMeshes);
    const batch = new Batch();
    for (const bay of this.list){
      if (bay.filled) continue;
      const proxy = proxyCabinet(bay.kind);
      proxy.position.set(bay.x, 0, bay.z);
      proxy.rotation.y = bay.rotY;
      batch.addObject(proxy);
    }
    this._proxyMeshes = batch.build(this.group);
  }

  _debugFor(bay){
    const fam = FAMILIES[bay.kind] || FAMILIES['claw-2arm'];
    const { w, h, d } = bay.size;
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: fam.color, transparent:true, opacity:.9,
                                    depthTest:false }));
    wire.position.set(bay.x, h/2, bay.z);
    wire.rotation.y = bay.rotY;
    wire.renderOrder = 998;
    this.debug.add(wire);

    const tag = labelSprite(bay.id, '#' + fam.color.toString(16).padStart(6,'0'), 0.42);
    tag.position.set(bay.x, h + 0.22, bay.z);
    this.debug.add(tag);

    // stub showing which way the cabinet faces
    const dir = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.20, 8),
      new THREE.MeshBasicMaterial({ color: fam.color, depthTest:false }));
    dir.position.set(bay.x + Math.sin(bay.rotY) * (d/2 + 0.18), 0.12,
                     bay.z + Math.cos(bay.rotY) * (d/2 + 0.18));
    dir.rotation.set(Math.PI/2, 0, -bay.rotY);
    dir.renderOrder = 998;
    this.debug.add(dir);
  }

  get(id){ return this.list.find(b => b.id === id); }
  setDebug(on){ this.debug.visible = on; }
  get filledCount(){ return this.list.filter(b => b.filled).length; }

  /** All bays intended for a given machine family. */
  byKind(kind){ return this.list.filter(b => b.kind === kind); }

  /**
   * Drop a real machine into a bay.
   * @param id     bay id, e.g. 'AF1'
   * @param object Object3D — base on y=0, front facing +Z, centred in X/Z
   * @param opts.fit  uniformly rescale to the reserved footprint (default true)
   */
  mount(id, object, opts = {}){
    const bay = this.get(id);
    if (!bay) throw new Error(`mount: no bay "${id}"`);
    const { fit = true } = opts;

    if (fit){
      const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
      const s = Math.min(bay.size.w / (size.x || 1),
                         bay.size.h / (size.y || 1),
                         bay.size.d / (size.z || 1));
      if (isFinite(s) && s > 0) object.scale.multiplyScalar(s);
      // re-seat on the floor after scaling
      object.position.y -= new THREE.Box3().setFromObject(object).min.y;
    }

    bay.holder.add(object);
    bay.machine = object;
    bay.filled  = true;
    this._rebuildProxies();
    return bay;
  }

  unmount(id){
    const bay = this.get(id);
    if (!bay || !bay.machine) return;
    bay.holder.remove(bay.machine);
    bay.machine = null;
    bay.filled = false;
    this._rebuildProxies();
  }

  /** Solid volumes the player cannot walk through. */
  collisionBoxes(){
    return this.list.map(b => footprint(b.x, b.z, b.size.w, b.size.d, b.rotY));
  }
}

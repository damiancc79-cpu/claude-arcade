/* ============================================================================
   room.js — the hall itself: floor, walls, ceiling rig, entrance.
   Fittings that stand on the floor (gacha, shelves, counter) live in fixtures.js.
============================================================================ */
import * as THREE from 'three';
import { MAT, box, panel, emissive, litPanel, neonRun, aabb } from './kit.js';
import {
  floorTexture, floorRoughness, wallTexture, ceilingTexture,
  trofferTexture, signTexture, neonTexture, posterTexture, streetTexture,
} from './textures.js';

/** Hall dimensions. HX/HZ are half-extents, so the floor spans ±HX by ±HZ. */
export const ROOM = {
  HX: 7.5,      // 15 m wide
  HZ: 6.5,      // 13 m deep
  H : 3.60,     // ceiling height
  DOOR_W: 4.4,  // entrance opening on the +Z wall
};

export function buildRoom(scene){
  const room = new THREE.Group();
  scene.add(room);
  const { HX, HZ, H } = ROOM;
  const colliders = [];
  const lights = { troffers: [], neon: [] };

  /* ------------------------------------------------------------- floor -- */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HX*2, HZ*2),
    new THREE.MeshStandardMaterial({
      map: floorTexture(13),
      roughnessMap: floorRoughness(13),
      roughness: .42, metalness: .30, color: 0xffffff,
    })
  );
  floor.rotation.x = -Math.PI/2;
  room.add(floor);

  /* ------------------------------------------------------------- walls -- */
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTexture([5,1]), roughness: .78, metalness: .12, side: THREE.FrontSide,
  });
  const wallMatEW = new THREE.MeshStandardMaterial({
    map: wallTexture([4,1]), roughness: .78, metalness: .12, side: THREE.FrontSide,
  });

  // north (-Z), facing +Z into the room
  panel(HX*2, H, wallMat, 0, H/2, -HZ, 0, room);
  // west (-X) facing +X, east (+X) facing -X
  panel(HZ*2, H, wallMatEW, -HX, H/2, 0,  Math.PI/2, room);
  panel(HZ*2, H, wallMatEW,  HX, H/2, 0, -Math.PI/2, room);

  // south (+Z) wall is split around the entrance opening
  {
    const side = (HX*2 - ROOM.DOOR_W) / 2;
    const cx = ROOM.DOOR_W/2 + side/2;
    panel(side, H, wallMat, -cx, H/2, HZ, Math.PI, room);
    panel(side, H, wallMat,  cx, H/2, HZ, Math.PI, room);
    // header above the doors
    panel(ROOM.DOOR_W, H - 2.5, wallMat, 0, 2.5 + (H-2.5)/2, HZ, Math.PI, room);
  }

  // skirting + a neon accent line running the perimeter
  const skirt = MAT.darkMetal;
  box(HX*2, 0.14, 0.06, skirt, 0, 0.07, -HZ + 0.03, room);
  box(0.06, 0.14, HZ*2, skirt, -HX + 0.03, 0.07, 0, room);
  box(0.06, 0.14, HZ*2, skirt,  HX - 0.03, 0.07, 0, room);

  for (const [len, x, z, ry] of [
    [HX*2, 0, -HZ + 0.05, 0],
    [HZ*2, -HX + 0.05, 0, Math.PI/2],
    [HZ*2,  HX - 0.05, 0, Math.PI/2],
  ]){
    lights.neon.push(neonRun(len, 0x37e6ff, x, 2.62, z, ry, room, 0.022));
    lights.neon.push(neonRun(len, 0xff2f7f, x, 0.30, z, ry, room, 0.018));
  }

  /* ----------------------------------------------------------- ceiling -- */
  // Grouped so the overview camera can strip the roof off and read as a plan.
  const ceiling = new THREE.Group();
  room.add(ceiling);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(HX*2, HZ*2),
    new THREE.MeshStandardMaterial({ map: ceilingTexture([8,6]), roughness:.92, metalness:.06 })
  );
  ceil.rotation.x = Math.PI/2;
  ceil.position.y = H;
  ceiling.add(ceil);

  // exposed structure: beams across X, cable tray down the middle
  for (let i = -3; i <= 3; i++){
    box(HX*2, 0.10, 0.12, MAT.black, 0, H - 0.06, i * 1.85, ceiling);
  }
  box(0.34, 0.09, HZ*2, MAT.darkMetal, -4.2, H - 0.20, 0, ceiling);
  box(0.34, 0.09, HZ*2, MAT.darkMetal,  4.2, H - 0.20, 0, ceiling);

  // fluorescent troffers, laid out in a grid over the aisles
  const trofMat = litPanel(trofferTexture(), 2.5);
  for (let ix = -2; ix <= 2; ix++){
    for (let iz = -2; iz <= 2; iz++){
      const x = ix * 2.9, z = iz * 2.5;
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.09, 0.42), MAT.darkMetal);
      t.position.set(x, H - 0.12, z);
      ceiling.add(t);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.36), trofMat);
      face.rotation.x = Math.PI/2;
      face.position.set(x, H - 0.168, z);
      ceiling.add(face);
      lights.troffers.push(face);
    }
  }

  /* ------------------------------------------- hanging aisle signage ---- */
  const banners = [
    { jp:'クレーンゲーム', en:'CRANE GAME',   z:-4.0, c1:'#ff2f7f', c2:'#ff8ac4' },
    { jp:'プライズコーナー', en:'PRIZE CORNER', z:-0.4, c1:'#37e6ff', c2:'#6ec3ff' },
    { jp:'ガチャガチャ',   en:'CAPSULE TOYS', z: 3.5, c1:'#ffd166', c2:'#ff9f6e' },
  ];
  for (const b of banners){
    const mat = litPanel(signTexture(b.jp, b.en, b.c1, b.c2), 1.5, { side: THREE.DoubleSide });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.30), mat);
    sign.position.set(0, H - 0.90, b.z);
    room.add(sign);
    // drop rods
    for (const sx of [-2.3, 2.3]){
      box(0.02, 0.62, 0.02, MAT.steel, sx, H - 0.32, b.z, room);
    }
  }

  /* ---------------------------------------------------------- entrance -- */
  {
    const dw = ROOM.DOOR_W;
    // night street backdrop, sitting just outside the glass
    const street = new THREE.Mesh(
      new THREE.PlaneGeometry(dw + 3.4, 3.2),
      new THREE.MeshBasicMaterial({ map: streetTexture(), toneMapped:false })
    );
    street.position.set(0, 1.6, HZ + 1.5);
    street.rotation.y = Math.PI;
    room.add(street);

    // sliding glass doors, parted in the middle
    const doorGlass = new THREE.MeshPhysicalMaterial({
      color:0xd8f2ff, roughness:.04, metalness:0, transparent:true, opacity:.16,
      side:THREE.DoubleSide, depthWrite:false,
    });
    for (const sx of [-1, 1]){
      const leaf = new THREE.Group();
      leaf.position.set(sx * (dw/2 - 0.55), 0, HZ);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 2.42), doorGlass);
      gl.position.set(0, 1.25, 0);
      leaf.add(gl);
      box(1.09, 0.06, 0.07, MAT.steel, 0, 2.47, 0, leaf);
      box(1.09, 0.06, 0.07, MAT.steel, 0, 0.05, 0, leaf);
      box(0.06, 2.48, 0.07, MAT.steel, sx * 0.53, 1.26, 0, leaf);
      room.add(leaf);
    }
    // door frame + threshold
    box(dw + 0.24, 0.14, 0.22, MAT.darkMetal, 0, 2.55, HZ, room);
    box(dw + 0.24, 0.03, 0.30, MAT.steel,     0, 0.015, HZ, room);
    for (const sx of [-1, 1]) box(0.14, 2.55, 0.22, MAT.darkMetal, sx*(dw/2 + 0.05), 1.27, HZ, room);

    // big neon sign over the entrance, read from inside
    const neonMat = litPanel(neonTexture('ゲームセンター', '#ff2f7f', 'GAME CENTER'), 2.2,
                             { transparent:false, side:THREE.DoubleSide });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 1.08), neonMat);
    neon.position.set(0, 3.02, HZ - 0.10);
    neon.rotation.y = Math.PI;
    room.add(neon);
  }

  /* ------------------------------------------------------- wall posters -- */
  const posterMat = i => litPanel(posterTexture(i), 0.75);
  // north wall, left half
  for (let i = 0; i < 3; i++){
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.01), posterMat(i));
    p.position.set(-5.4 + i * 1.15, 2.05, -HZ + 0.03);
    room.add(p);
  }
  // east wall above the machine row
  for (let i = 0; i < 3; i++){
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.01), posterMat(i + 2));
    p.position.set(HX - 0.03, 2.30, -4.0 + i * 1.5);
    p.rotation.y = -Math.PI/2;
    room.add(p);
  }
  // west wall, above the gacha bank
  for (let i = 0; i < 4; i++){
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.96), posterMat(i + 1));
    p.position.set(-HX + 0.03, 2.42, -3.6 + i * 2.0);
    p.rotation.y = Math.PI/2;
    room.add(p);
  }

  /* ------------------------------------------------------- wall colliders */
  const T = 0.35;
  colliders.push(
    aabb(0, -ROOM.HZ - T/2, ROOM.HX*2, T),   // north
    aabb(0,  ROOM.HZ + T/2, ROOM.HX*2, T),   // south (doors are scenery, not a route)
    aabb(-ROOM.HX - T/2, 0, T, ROOM.HZ*2),   // west
    aabb( ROOM.HX + T/2, 0, T, ROOM.HZ*2),   // east
  );

  return { room, ceiling, colliders, lights, floor };
}

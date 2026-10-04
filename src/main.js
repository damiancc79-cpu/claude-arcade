/* ============================================================================
   main.js — bootstrap: renderer, lighting, camera modes, loop.

   Lighting note: a game centre floor is uniformly, aggressively bright, and
   real-time shadows from a dozen sources would be ruinous here. The room is lit
   with a bright ambient/hemisphere base plus a handful of unshadowed point
   lights for colour pooling, and everything that should *look* like a light
   source is emissive geometry. Contact darkness comes from cheap blob decals.
============================================================================ */
import * as THREE from 'three';
import { buildRoom, ROOM } from './room.js';
import { buildFixtures } from './fixtures.js';
import { Bays, FAMILIES } from './layout.js';
import { Player, EYE } from './player.js';
import { TwoProngMachine } from './machines/claw2.js';
import { ThreeProngMachine } from './machines/claw3.js';
import { BigPrizeMachine } from './machines/clawbig.js';
import { StringCutMachine } from './machines/himo.js';
import { BridgeMachine } from './machines/bridge.js';
import { SliderMachine } from './machines/slider.js';
import { RingHookMachine } from './machines/ringhook.js';
import { SeesawMachine } from './machines/seesaw.js';
import { PushMachine } from './machines/push.js';
import { PlayController } from './play.js';

/* ------------------------------------------------------------- renderer -- */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07061a);

const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 120);

/* ----------------------------------------------------------- environment --
   Every metal surface here (chrome trim, cabinet shells, the floor) is
   metalness-driven, and a metal with no environment to reflect renders black.
   This bakes a tiny stand-in arcade — ceiling fluorescents plus pink/cyan wall
   neon — into an irradiance map, which both fixes the metals and supplies most
   of the room's bounce light for free.                                       */
function buildEnvironment(renderer){
  const env = new THREE.Scene();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const add = (hex, pos, scale) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: hex }));
    m.position.set(...pos); m.scale.set(...scale);
    env.add(m);
  };
  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(20, 5.4, 16),
    new THREE.MeshBasicMaterial({ color: 0x4a4878, side: THREE.BackSide })));

  // ceiling fluorescent banks
  add(0xffffff, [0, 2.45, -4.5], [16, 0.2, 1.5]);
  add(0xffffff, [0, 2.45,  0.0], [16, 0.2, 1.5]);
  add(0xfff2dc, [0, 2.45,  4.5], [16, 0.2, 1.5]);
  // neon side wash
  add(0xff2f7f, [-9.2, 0.2, 0], [0.2, 1.6, 13]);
  add(0x37e6ff, [ 9.2, 0.2, 0], [0.2, 1.6, 13]);
  add(0xffd166, [0, -0.4, -7.4], [14, 1.0, 0.2]);
  add(0xc792ea, [0, -0.4,  7.4], [14, 1.0, 0.2]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  geo.dispose();
  return rt.texture;
}
scene.environment = buildEnvironment(renderer);

/* --------------------------------------------------------------- lights -- */
const lightRig = new THREE.Group();
scene.add(lightRig);

// Game centres are relentlessly, flatly bright — the base light does the work
// and the point lights below only add colour pooling on top of it.
const ambient = new THREE.AmbientLight(0xbcc6ff, 2.35);
const hemi    = new THREE.HemisphereLight(0xf2f5ff, 0x3d3168, 2.30);
lightRig.add(ambient, hemi);

// colour pools along the aisles — no shadows, cheap
const POOLS = [
  [-4.6, 2.85, -4.2, 0xfff0dc, 26],
  [ 0.0, 2.85, -4.2, 0xff5c9e, 22],
  [ 4.6, 2.85, -4.2, 0xfff0dc, 26],
  [-4.6, 2.85, -0.6, 0x6fd8ff, 24],
  [ 0.0, 2.85, -0.6, 0xfff0dc, 26],
  [ 4.6, 2.85, -0.6, 0xffd166, 22],
  [-3.2, 2.85,  3.4, 0xfff0dc, 24],
  [ 3.2, 2.85,  3.4, 0xc792ea, 22],
  [ 0.0, 2.40,  6.0, 0xff2f7f, 18],
  [ 6.4, 2.85, -2.4, 0xfff0dc, 22],
  [ 6.4, 2.85,  2.0, 0x6fd8ff, 20],
  [-6.4, 2.85,  2.6, 0xffd166, 20],
];
const poolLights = POOLS.map(([x,y,z,c,i]) => {
  const l = new THREE.PointLight(c, i, 9.5, 2.0);
  l.position.set(x, y, z);
  lightRig.add(l);
  return l;
});

/* ----------------------------------------------------------------- room -- */
const built     = buildRoom(scene);
const fixtures  = buildFixtures(scene);
const bays      = new Bays(scene);

const colliders = [...built.colliders, ...fixtures.colliders, ...bays.collisionBoxes()];

/* ------------------------------------------------------------- machines -- */
/**
 * Fill every bay with the real cabinet its family calls for.
 *
 * `fit: false` on purpose. Every machine is authored to the model contract —
 * base on y = 0, front facing +Z, centred in X/Z, and 0.98 × 0.92 in plan,
 * which is the reserved footprint — so there is nothing to rescale and running
 * the fitter would only introduce a rounding error in the one direction the
 * cabinets are supposed to line up exactly.
 *
 * Each bay gets its own SEED, which is the second thing STATUS.md asked to
 * decide: a row of seven identical two-prong cabinets stocked identically reads
 * as wallpaper, and every machine already takes a `seed` that lays its prizes
 * out differently.
 */
const BUILDERS = {
  'claw-2arm'  : seed => new TwoProngMachine({ prizes: 9, seed }),
  'claw-3arm'  : seed => new ThreeProngMachine({ prizes: 8, seed }),
  'claw-bridge': seed => new BridgeMachine({ prizes: 3, seed }),
  'claw-big'   : seed => new BigPrizeMachine({ seed }),
  'himo'       : seed => new StringCutMachine({ seed }),
  'slider'     : seed => new SliderMachine({ seed }),
  'ringhook'   : seed => new RingHookMachine({ seed }),
  'seesaw'     : seed => new SeesawMachine({ prizes: 4, seed }),
  'push'       : seed => new PushMachine({ prizes: 5, seed }),
};

const machines = [];
bays.list.forEach((bay, i) => {
  const build = BUILDERS[bay.kind];
  if (!build) return;
  const machine = build(i);
  bays.mount(bay.id, machine.object3D, { fit: false });
  // One step places the claw's own meshes, which are only posed inside update().
  // Without it every cabinet on the floor shows its gantry parked at the origin.
  machine.update(1/60);
  machines.push({ machine, x: bay.x, z: bay.z, rotY: bay.rotY, kind: bay.kind, id: bay.id });
});

/**
 * THE FLOOR CANNOT RUN 36 PHYSICS WORLDS. Each cabinet owns a solver, and even
 * an idle one still tests its sleeping prizes against five kinematic colliders
 * every substep, so stepping all of them costs far more than drawing them.
 * Only cabinets near the player are stepped; the rest hold the pose they were
 * built in, which is exactly what an unplayed machine looks like anyway.
 */
const SIM_RADIUS = 7.0;
function stepMachines(dt){
  const cx = camera.position.x, cz = camera.position.z;
  for (const m of machines){
    const dx = m.x - cx, dz = m.z - cz;
    if (dx*dx + dz*dz < SIM_RADIUS*SIM_RADIUS) m.machine.update(dt);
  }
}

document.getElementById('sSlots').textContent  = bays.list.length;
document.getElementById('sFilled').textContent = bays.filledCount;
document.getElementById('sGacha').textContent  = fixtures.gachaUnits;

/* --------------------------------------------------------------- player -- */
const player = new Player(camera, canvas);
player.setColliders(colliders);
/* Walk up to a cabinet and play it — crosshair to pick, F for a coin, mouse
   buttons for ➊ and ➋. See play.js for why the buttons are on the mouse. */
const play = new PlayController({
  camera, dom: canvas, player, machines,
  labels: Object.fromEntries(Object.entries(FAMILIES).map(([k, f]) => [k, f.jp])),
});


const enterEl = document.getElementById('enter');
const crossEl = document.getElementById('cross');
player.onLockChange = locked => {
  enterEl.classList.toggle('hide', locked || mode === 'orbit');
  crossEl.classList.toggle('hide', !locked || mode === 'orbit');
};
enterEl.addEventListener('click', () => {
  if (mode === 'orbit') setMode('walk');
  player.requestLock();
});

/* ---------------------------------------------------------- camera modes -- */
let mode = 'walk';
const orbit = {
  az: 0.62, el: 0.85, dist: 19,
  azT: 0.62, elT: 0.85, distT: 19,
  target: new THREE.Vector3(0, 0.9, -1.2),
};
function setMode(next){
  mode = next;
  player.enabled = (mode === 'walk');
  document.getElementById('bView').classList.toggle('on', mode === 'orbit');
  document.getElementById('bView').textContent = mode === 'orbit' ? 'WALK' : 'OVERVIEW';
  if (mode === 'orbit'){
    if (document.exitPointerLock) document.exitPointerLock();
    enterEl.classList.add('hide');
    crossEl.classList.add('hide');
    built.ceiling.visible = false;      // strip the roof for a floor-plan read
    camera.fov = 46;
  } else {
    camera.fov = 72;
    built.ceiling.visible = true;
    enterEl.classList.toggle('hide', player.locked);
  }
  camera.updateProjectionMatrix();
}
document.getElementById('bView').onclick = () => setMode(mode === 'walk' ? 'orbit' : 'walk');

// orbit drag
let drag = null;
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'orbit') return;
  drag = { x:e.clientX, y:e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  orbit.azT -= (e.clientX - drag.x) * 0.006;
  orbit.elT  = Math.max(0.12, Math.min(1.45, orbit.elT + (e.clientY - drag.y) * 0.005));
  drag.x = e.clientX; drag.y = e.clientY;
});
canvas.addEventListener('pointerup',     () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', e => {
  if (mode !== 'orbit') return;
  e.preventDefault();
  orbit.distT = Math.max(7, Math.min(34, orbit.distT + e.deltaY * 0.012));
}, { passive:false });

/* ----------------------------------------------------------------- tools -- */
let slotsOn = false;
function toggleSlots(){
  slotsOn = !slotsOn;
  bays.setDebug(slotsOn);
  document.getElementById('bSlots').classList.toggle('on', slotsOn);
}
document.getElementById('bSlots').onclick = toggleSlots;

let night = true;
function toggleLights(){
  night = !night;
  // "day" = house lights up: flatter, brighter, less neon pooling
  ambient.intensity = night ? 2.35 : 3.30;
  hemi.intensity    = night ? 2.30 : 3.20;
  poolLights.forEach((l, i) => { l.intensity = POOLS[i][4] * (night ? 1 : 0.45); });
  renderer.toneMappingExposure = night ? 1.12 : 1.30;
  document.getElementById('bLights').classList.toggle('on', !night);
}
document.getElementById('bLights').onclick = toggleLights;

addEventListener('keydown', e => {
  if (e.code === 'KeyV') setMode(mode === 'walk' ? 'orbit' : 'walk');
  if (e.code === 'KeyG') toggleSlots();
});

/* ------------------------------------------------------------------ loop -- */
function resize(){
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  const dpr = Math.min(devicePixelRatio, 2);
  if (canvas.width !== Math.floor(cw*dpr) || canvas.height !== Math.floor(ch*dpr)){
    renderer.setPixelRatio(dpr);
    renderer.setSize(cw, ch, false);
    camera.aspect = cw/ch;
    camera.updateProjectionMatrix();
  }
}
addEventListener('resize', resize);

let last = performance.now(), fpsT = 0, fpsN = 0;
function frame(now){
  requestAnimationFrame(frame);
  resize();
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;

  stepMachines(dt);
  if (mode === 'walk') play.update();

  if (mode === 'walk'){
    player.update(dt);
  } else {
    orbit.az   += (orbit.azT - orbit.az) * 0.12;
    orbit.el   += (orbit.elT - orbit.el) * 0.12;
    orbit.dist += (orbit.distT - orbit.dist) * 0.12;
    const ce = Math.cos(orbit.el);
    camera.position.set(
      orbit.target.x + Math.sin(orbit.az) * ce * orbit.dist,
      orbit.target.y + Math.sin(orbit.el) * orbit.dist,
      orbit.target.z + Math.cos(orbit.az) * ce * orbit.dist
    );
    camera.lookAt(orbit.target);
  }

  renderer.render(scene, camera);

  fpsN++; fpsT += dt;
  if (fpsT > 0.5){
    const info = renderer.info.render;
    document.getElementById('fps').textContent =
      `${Math.round(fpsN/fpsT)} FPS · ${info.calls} draws · ${(info.triangles/1000).toFixed(0)}k tris`;
    fpsT = 0; fpsN = 0;
  }
}
resize();
requestAnimationFrame(frame);

/* Console handle — this is how machines will be dropped in later:
     ARC.bays.mount('AF1', someObject3D)                                       */
window.ARC = { THREE, scene, camera, renderer, player, bays, fixtures, machines, play, room: built, ROOM, setMode, orbit,
  /** Snap the overview camera somewhere without waiting for the easing. */
  look(az, el, dist, tx, ty, tz){
    orbit.az = orbit.azT = az; orbit.el = orbit.elT = el; orbit.dist = orbit.distT = dist;
    if (tx !== undefined) orbit.target.set(tx, ty, tz);
  },
};

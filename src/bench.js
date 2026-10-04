/* ============================================================================
   bench.js — standalone test bench for a single machine.

   Deliberately separate from the arcade floor: a machine gets built, tuned and
   played here on its own before it is ever mounted into the room.
============================================================================ */
import * as THREE from 'three';
import { CapsuleMachine } from './machines/capsule.js';
import { TwoProngMachine } from './machines/claw2.js';
import { ThreeProngMachine } from './machines/claw3.js';
import { BigPrizeMachine } from './machines/clawbig.js';
import { StringCutMachine } from './machines/himo.js';
import { BridgeMachine } from './machines/bridge.js';
import { SliderMachine } from './machines/slider.js';
import { RingHookMachine } from './machines/ringhook.js';
import { SeesawMachine } from './machines/seesaw.js';
import { PushMachine } from './machines/push.js';
import { MedalMachine } from './machines/medal.js';
import { BenchBot, PusherBot } from './bot.js';

/* ------------------------------------------------------------- renderer -- */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0a20);
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 40);

/* ---------------------------------------------------------- environment -- */
function buildEnvironment(){
  const env = new THREE.Scene();
  const geo = new THREE.BoxGeometry(1,1,1);
  const add = (hex, pos, scale) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color:hex }));
    m.position.set(...pos); m.scale.set(...scale); env.add(m);
  };
  env.add(new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6),
    new THREE.MeshBasicMaterial({ color:0x4a4878, side:THREE.BackSide })));
  add(0xffffff, [0, 1.9, 0], [4, 0.2, 2]);
  add(0xff2f7f, [-2.7, 0.2, 0], [0.2, 1.4, 4]);
  add(0x37e6ff, [ 2.7, 0.2, 0], [0.2, 1.4, 4]);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.02);
  pm.dispose(); geo.dispose();
  return rt.texture;
}
scene.environment = buildEnvironment();

scene.add(new THREE.AmbientLight(0xbcc6ff, 1.5));
scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x3d3168, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(0.7, 1.6, 1.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.2; key.shadow.camera.far = 4;
key.shadow.camera.left = -0.5; key.shadow.camera.right = 0.5;
key.shadow.camera.top = 0.8;  key.shadow.camera.bottom = -0.2;
key.shadow.bias = -0.0012;
scene.add(key);
const rimA = new THREE.PointLight(0xff5c9e, 6, 3, 2); rimA.position.set(-0.9, 0.6, 0.8);
const rimB = new THREE.PointLight(0x6fd8ff, 6, 3, 2); rimB.position.set( 0.9, 0.5, 0.7);
scene.add(rimA, rimB);

// bench floor
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48),
  new THREE.MeshStandardMaterial({ color:0x2a2450, roughness:.6, metalness:.3 }));
floor.rotation.x = -Math.PI/2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(2.4, 24, 0x37e6ff, 0x2c2c58);
grid.material.transparent = true; grid.material.opacity = 0.16;
scene.add(grid);

/* ------------------------------------------------------------- machine --- */
/* The bench hosts one machine at a time; ?m= picks which. */
const BUILDS = {
  capsule: {
    title: 'ガチャガチャ', sub: '65 mm CAPSULE MACHINE',
    make: () => new CapsuleMachine({ capsules: 18, seed: 2 }),
    views: [
      { name:'FRONT', az: 0,    el: 0.16, dist: 1.15, ty: 0.30 },
      { name:'MECH',  az: 0.60, el: 0.14, dist: 0.52, ty: 0.24 },
      { name:'TRAY',  az: 0.18, el:-0.20, dist: 0.44, ty: 0.08 },
      { name:'GLOBE', az: 0.35, el: 0.30, dist: 0.62, ty: 0.47 },
    ],
  },
  claw2: {
    title: '二本爪', sub: 'TWO-PRONG UFO CATCHER',
    make: () => new TwoProngMachine({ prizes: 9, seed: 1 }),
    views: [
      { name:'FRONT', az: 0,    el: 0.18, dist: 2.9, ty: 1.05 },
      { name:'FIELD', az: 0.30, el: 0.55, dist: 1.7, ty: 0.90 },
      { name:'CLAW',  az: 0.45, el: 0.16, dist: 1.1, ty: 1.20 },
      { name:'CHUTE', az:-0.35, el: 0.30, dist: 1.1, ty: 0.75 },
    ],
  },
  claw3: {
    title: '三本爪', sub: 'THREE-PRONG UFO CATCHER',
    make: () => new ThreeProngMachine({ prizes: 8, seed: 0 }),
    views: [
      { name:'FRONT', az: 0,    el: 0.20, dist: 2.9, ty: 1.02 },
      { name:'FIELD', az: 0.28, el: 0.58, dist: 1.7, ty: 0.86 },
      { name:'CLAW',  az: 0.45, el: 0.14, dist: 1.0, ty: 1.00 },
      { name:'CHUTE', az:-0.40, el: 0.32, dist: 1.1, ty: 0.74 },
    ],
  },
  clawbig: {
    title: '大型', sub: 'BIG PRIZE · TAG SETTING',
    make: () => new BigPrizeMachine({ seed: 0 }),
    views: [
      { name:'FRONT', az: 0,    el: 0.16, dist: 2.6, ty: 0.95 },
      { name:'BAR',   az: 0.10, el: 0.30, dist: 1.35, ty: 0.98 },
      { name:'END',   az: 0.95, el: 0.18, dist: 1.05, ty: 0.96 },
      { name:'PAN',   az:-0.30, el: 0.42, dist: 1.20, ty: 0.55 },
    ],
  },
  himo: {
    title: 'ヒモ', sub: 'STRING CUT SETTING',
    make: () => new StringCutMachine({ seed: 0 }),
    views: [
      { name:'FRONT', az: 0,    el: 0.16, dist: 2.5, ty: 1.00 },
      { name:'BLADE', az: 0.14, el: 0.10, dist: 0.85, ty: 1.02 },
      { name:'CORD',  az: 0.55, el: 0.06, dist: 1.10, ty: 1.10 },
      { name:'PAN',   az:-0.30, el: 0.44, dist: 1.20, ty: 0.60 },
    ],
  },
  slider: {
    title: 'スライダー', sub: 'SLIDER / RAIL SETTING',
    make: () => new SliderMachine({ seed: 1 }),
    views: [
      { name:'FRONT', az: 0.10, el: 0.42, dist: 2.10, ty: 1.02 },
      { name:'LANES', az: 0.05, el: 0.70, dist: 1.55, ty: 0.90 },
      { name:'EDGE',  az: 0.90, el: 0.12, dist: 0.95, ty: 0.85 },
      { name:'CLAW',  az: 0.45, el: 0.16, dist: 1.15, ty: 1.15 },
    ],
  },
  push: {
    title: '押し出し', sub: 'PUSH SETTING',
    make: () => new PushMachine({ prizes: 5, seed: 0 }),
    views: [
      { name:'FRONT', az: 0,    el: 0.22, dist: 2.4, ty: 0.95 },
      { name:'SHELF', az: 0.10, el: 0.55, dist: 1.4, ty: 0.80 },
      { name:'EDGE',  az: 0.90, el: 0.12, dist: 0.95, ty: 0.76 },
      { name:'WELL',  az:-0.25, el: 0.40, dist: 1.2, ty: 0.58 },
    ],
  },
  seesaw: {
    title: 'シーソー', sub: 'BALANCE SETTING',
    make: () => new SeesawMachine({ prizes: 4, seed: 0 }),
    views: [
      { name:'FRONT', az: 0,    el: 0.20, dist: 2.5, ty: 0.95 },
      { name:'PLATE', az: 0.12, el: 0.50, dist: 1.5, ty: 0.80 },
      { name:'HINGE', az: 1.20, el: 0.10, dist: 1.0, ty: 0.74 },
      { name:'WELL',  az:-0.25, el: 0.38, dist: 1.2, ty: 0.60 },
    ],
  },
  ringhook: {
    title: 'リング掛け', sub: 'RING HOOK SETTING',
    make: () => new RingHookMachine({ seed: 0 }),
    views: [
      { name:'FRONT', az: 0,    el: 0.22, dist: 2.5, ty: 1.02 },
      { name:'RACK',  az: 0.10, el: 0.52, dist: 1.45, ty: 0.92 },
      { name:'HOOK',  az: 0.85, el: 0.10, dist: 0.85, ty: 0.98 },
      { name:'WELL',  az:-0.28, el: 0.40, dist: 1.20, ty: 0.72 },
    ],
  },
  medal: {
    title: 'メダルゲーム', sub: 'MEDAL PUSHER',
    make: () => new MedalMachine({ seed: 0 }),
    views: [
      { name:'FRONT', az: 0,    el: 0.22, dist: 2.2, ty: 0.90 },
      { name:'FIELD', az: 0.06, el: 0.55, dist: 1.3, ty: 0.76 },
      { name:'SHELF', az: 0.85, el: 0.16, dist: 0.90, ty: 0.78 },
      { name:'LIP',   az:-0.20, el: 0.24, dist: 0.85, ty: 0.66 },
    ],
  },
  bridge: {
    title: '橋渡し', sub: 'BRIDGE SETTING',
    make: () => new BridgeMachine({ prizes: 3, seed: 0 }),
    views: [
      { name:'FRONT', az: 0.16, el: 0.48, dist: 1.95, ty: 1.00 },
      { name:'BARS',  az: 0.18, el: 0.62, dist: 1.5, ty: 0.95 },
      { name:'CLAW',  az: 0.50, el: 0.14, dist: 1.1, ty: 1.20 },
      { name:'SPAN',  az: 1.35, el: 0.16, dist: 1.2, ty: 0.93 },
    ],
  },
};
const which = new URLSearchParams(location.search).get('m') || 'capsule';
const BUILD = BUILDS[which] || BUILDS.capsule;
const isCapsule = which === 'capsule';

const machine = BUILD.make();
scene.add(machine.object3D);
machine.object3D.traverse(o => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
document.querySelector('#title .jp').textContent = BUILD.title;
document.querySelector('#title .en').textContent = BUILD.sub + '  ·  BENCH';
document.title = 'MACHINE BENCH — ' + BUILD.title;

// HUD labels + control legend differ per machine
{
  const labels = isCapsule
    ? ['CREDIT','CRANK','IN GLOBE','IN TRAY','COLLECTED','TURNS']
    : which === 'bridge'
      ? ['CREDIT','PHASE','ON BARS','TO EDGE','WON','PLAYS']
      : which === 'slider'
        ? ['CREDIT','PHASE','ON RAILS','NEAREST','WON','PLAYS']
        : which === 'claw3'
          ? ['CREDIT','PHASE','ON FIELD','TO CHUTE','WON','PLAYS']
          : which === 'clawbig'
            ? ['CREDIT','PHASE','ON BAR','TO END','WON','PLAYS']
            : which === 'himo'
              ? ['CREDIT','PHASE','ON CORD','CUT','WON','PLAYS']
              : which === 'ringhook'
                ? ['CREDIT','PHASE','ON RACK','HOOKED','WON','PLAYS']
              : which === 'seesaw'
                ? ['CREDIT','PHASE','ON PLATE','TILT','WON','PLAYS']
              : which === 'push'
                ? ['CREDIT','PHASE','ON SHELF','TO EDGE','WON','PLAYS']
              : which === 'medal'
                ? ['CREDIT','PHASE','ON FIELD','TO LIP','PAID','COINS']
                : ['CREDIT','PHASE','ON FIELD','AIM','WON','PLAYS'];
  document.querySelectorAll('#state .row span')
    .forEach((el, i) => { if (labels[i]) el.textContent = labels[i]; });
  if (which === 'medal'){
    document.getElementById('keys').innerHTML =
      '<h4>CONTROLS</h4>' +
      '<div><kbd>click</kbd><span>coin slot — insert ¥100</span></div>' +
      '<div><kbd>➊</kbd><span>hold: chute tracks right</span></div>' +
      '<div><kbd>➊</kbd><span>release: the medal drops</span></div>' +
      '<div><kbd>→</kbd><span>button ➊ &nbsp; (➋ unused)</span></div>' +
      '<div><kbd>C</kbd><span>coin &nbsp; <kbd>R</kbd>restock &nbsp; <kbd>G</kbd>colliders</span></div>' +
      '<div><kbd>drag bg</kbd><span>orbit &nbsp; <kbd>wheel</kbd>zoom</span></div>';
  } else if (!isCapsule){
    document.getElementById('keys').innerHTML =
      '<h4>CONTROLS</h4>' +
      '<div><kbd>click</kbd><span>coin slot — insert ¥100</span></div>' +
      '<div><kbd>➊</kbd><span>hold: track right, release to lock</span></div>' +
      '<div><kbd>➋</kbd><span>hold: track back, release to drop</span></div>' +
      '<div><kbd>→</kbd><span>button ➊ &nbsp; <kbd>↑</kbd>button ➋</span></div>' +
      '<div><kbd>C</kbd><span>coin &nbsp; <kbd>R</kbd>restock &nbsp; <kbd>G</kbd>colliders</span></div>' +
      '<div><kbd>drag bg</kbd><span>orbit &nbsp; <kbd>wheel</kbd>zoom</span></div>';
  }
}

const showPrize = prize => {
  document.getElementById('prizeJp').textContent = prize.jp;
  document.getElementById('prizeEn').textContent = prize.en;
  const el = document.getElementById('prize');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
};
if (isCapsule){
  machine.onCollect = p => { showPrize(p); hint('nice — insert another <b>¥100</b>'); };
  machine.onDispense = () => hint('capsule delivered — open the <b>door</b>');
} else {
  machine.onWin = p => { showPrize(p); hint('down the chute! insert another <b>¥100</b>'); };
  machine.onPhase = ph => {
    const msg = which === 'medal' ? {
      aim : 'hold <b>➊</b> — the chute tracks right, release to drop',
      drop: 'medal away…',
      idle: 'click the <b>coin slot</b> to play',
    }[ph] : {
      aimX: 'hold <b>➊</b> to track right — release to lock',
      aimZ: 'hold <b>➋</b> to track back — release and it drops',
      drop: 'descending…', close: 'prongs closing', lift: 'lifting',
      return: 'returning to the chute', release: 'opening',
      idle: 'click the <b>coin slot</b> to play',
    }[ph];
    if (msg) hint(msg);
  };
}

/* -------------------------------------------------------------- camera --- */
const V0 = BUILD.views[0];
const orbit = { az: V0.az, el: V0.el, dist: V0.dist, azT: V0.az, elT: V0.el, distT: V0.dist,
                target: new THREE.Vector3(0, V0.ty, 0) };
function updateCamera(){
  orbit.az += (orbit.azT - orbit.az) * 0.14;
  orbit.el += (orbit.elT - orbit.el) * 0.14;
  orbit.dist += (orbit.distT - orbit.dist) * 0.14;
  const ce = Math.cos(orbit.el);
  camera.position.set(
    orbit.target.x + Math.sin(orbit.az) * ce * orbit.dist,
    orbit.target.y + Math.sin(orbit.el) * orbit.dist,
    orbit.target.z + Math.cos(orbit.az) * ce * orbit.dist);
  camera.lookAt(orbit.target);
}

/* ------------------------------------------------------------- picking --- */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickAt(cx, cy){
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left)/r.width)*2 - 1, -((cy - r.top)/r.height)*2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = machine.picks.concat(
    (machine.trayCapsules || []).map(b => b.mesh).filter(Boolean));
  const hits = ray.intersectObjects(targets, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.pick) o = o.parent;
  return o ? { kind:o.userData.pick, obj:o, point:hits[0].point } : null;
}

/* --------------------------------------------------------------- input --- */
let drag = null;          // { mode:'orbit'|'crank', ... }
const keys = Object.create(null);

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const hit = pickAt(e.clientX, e.clientY);
  if (hit && hit.kind === 'knob'){
    // project the knob centre to screen space; drag angle around it drives the crank
    const c = machine.knob.getWorldPosition(new THREE.Vector3()).project(camera);
    const r = canvas.getBoundingClientRect();
    drag = { mode:'crank',
             cx: r.left + (c.x*0.5 + 0.5)*r.width,
             cy: r.top  + (-c.y*0.5 + 0.5)*r.height,
             last: null };
    drag.last = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
    canvas.classList.add('turning');
    if (machine.crankLocked) hint('insert a <b>¥100</b> coin first');
    return;
  }
  if (hit && hit.kind === 'coin'){ doCoin(); return; }
  if (hit && hit.kind === 'flap'){ machine.toggleFlap(); return; }
  if (hit && hit.kind === 'capsule'){ doCollect(); return; }
  if (hit && hit.kind === 'btnA'){ machine.pressA(true); drag = { mode:'btnA' }; return; }
  if (hit && hit.kind === 'btnB'){ machine.pressB(true); drag = { mode:'btnB' }; return; }
  drag = { mode:'orbit', x:e.clientX, y:e.clientY };
});

canvas.addEventListener('pointermove', e => {
  if (!drag || drag.mode === 'btnA' || drag.mode === 'btnB') return;
  if (drag.mode === 'orbit'){
    orbit.azT -= (e.clientX - drag.x) * 0.007;
    orbit.elT = Math.max(-0.35, Math.min(1.15, orbit.elT + (e.clientY - drag.y) * 0.006));
    drag.x = e.clientX; drag.y = e.clientY;
    return;
  }
  // crank: accumulate signed angle around the knob centre; clockwise on screen
  // is the direction the real knob turns.
  const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
  let d = a - drag.last;
  while (d >  Math.PI) d -= Math.PI*2;
  while (d < -Math.PI) d += Math.PI*2;
  drag.last = a;
  machine.crankBy(d);                       // screen-clockwise == positive
});

const endDrag = () => {
  if (drag && drag.mode === 'btnA') machine.pressA(false);
  if (drag && drag.mode === 'btnB') machine.pressB(false);
  drag = null; canvas.classList.remove('turning');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  orbit.distT = Math.max(0.35, Math.min(2.2, orbit.distT + e.deltaY * 0.0012));
}, { passive:false });

const BTN_A = ['ArrowRight', 'Digit1', 'KeyZ'];
const BTN_B = ['ArrowUp', 'Digit2', 'KeyX'];

addEventListener('keydown', e => {
  if (['Space','ArrowRight','ArrowUp'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'KeyC') doCoin();
  if (e.code === 'KeyG') toggleDebug();
  if (isCapsule){
    if (e.code === 'KeyF') machine.toggleFlap();
    if (e.code === 'KeyE') doCollect();
    if (e.code === 'KeyR'){ machine.refill(); hint('globe refilled'); }
  } else {
    if (e.code === 'KeyR'){ machine.reset(); hint('playfield restocked'); }
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });

function doCoin(){
  if (machine.insertCoin()){
    hint(isCapsule ? 'coin accepted — <b>turn the knob</b>'
                   : 'hold <b>➊</b> to track right — release to lock');
  } else hint('the mech already has a credit');
}
function doCollect(){
  if (!machine.trayCapsules.length){ hint('nothing in the tray yet'); return; }
  if (machine.flapOpen < 0.5){ machine.toggleFlap(); hint('opening the door…'); return; }
  machine.collect();
}
let hintT = 0;
function hint(html){ document.getElementById('hint').innerHTML = html; hintT = 4; }

/* --------------------------------------------------------------- tools --- */
let debugOn = false;
function toggleDebug(){
  debugOn = !debugOn;
  if (!machine.debug) machine.buildDebug();
  machine.debug.visible = debugOn;
  document.getElementById('bDebug').classList.toggle('on', debugOn);
}
document.getElementById('bDebug').onclick = toggleDebug;

let cutaway = false;
const SHELL_HEX = isCapsule ? 0xf2f4fa
  : which === 'bridge' ? 0x23324f : which === 'slider' ? 0x2c2350
  : which === 'claw3' ? 0xece2ea : which === 'clawbig' ? 0x0f3b46
  : which === 'himo' ? 0x2a1730 : which === 'ringhook' ? 0x3b1420 : which === 'seesaw' ? 0x14304a : which === 'push' ? 0x1d2b3a : which === 'medal' ? 0x3a0d18 : 0x232349;
document.getElementById('bCut').onclick = () => {
  cutaway = !cutaway;
  // hide the outer shell so the mechanism is visible while tuning
  machine.object3D.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m && m.isMeshStandardMaterial && !m.transparent &&
        m.color && m.color.getHex() === SHELL_HEX) o.visible = !cutaway;
  });
  document.getElementById('bCut').classList.toggle('on', cutaway);
};
document.getElementById('bRefill').onclick = () => {
  if (isCapsule){ machine.refill(); hint('globe refilled'); }
  else { machine.reset(); hint('playfield restocked'); }
};

const VIEWS = BUILD.views;
let viewIdx = 0;
document.getElementById('bView').onclick = () => {
  viewIdx = (viewIdx + 1) % VIEWS.length;
  const v = VIEWS[viewIdx];
  orbit.azT = v.az; orbit.elT = v.el; orbit.distT = v.dist;
  orbit.target.set(0, v.ty, 0);
  document.getElementById('bView').textContent = VIEWS[(viewIdx+1)%VIEWS.length].name;
};

/* ---------------------------------------------------------------- loop --- */
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

const el = id => document.getElementById(id);
let last = performance.now(), fpsT = 0, fpsN = 0;

function frame(now){
  requestAnimationFrame(frame);
  resize();
  let dt = (now - last)/1000; last = now;
  if (dt > 0.1) dt = 0.1;

  if (isCapsule){
    machine.setCrankVelocity(keys.Space ? 3.4 : 0);
  } else {
    machine.pressA(BTN_A.some(k => keys[k]) || (drag && drag.mode === 'btnA'));
    machine.pressB(BTN_B.some(k => keys[k]) || (drag && drag.mode === 'btnB'));
  }
  machine.update(dt);
  if (machine.updateDebug) machine.updateDebug();
  updateCamera();
  renderer.render(scene, camera);

  /* ---- HUD ---- */
  el('sCredit').textContent = machine.credit ? '¥100' : '¥0';
  if (isCapsule){
    const cr = el('sCrank');
    cr.textContent = machine.crankLocked ? 'LOCKED' : `${Math.round(machine.crank/(Math.PI*2)*100)}%`;
    cr.className = machine.crankLocked ? '' : 'hot';
    el('sLeft').textContent  = machine.capsulesLeft;
    el('sTray').textContent  = machine.inTray;
    el('sGot').textContent   = machine.collected.length;
    el('sTurns').textContent = machine.turnsCompleted;
    const cw = el('crank');
    cw.classList.toggle('show', !machine.crankLocked);
    el('crankFill').style.width = (machine.crank/(Math.PI*2)*100).toFixed(1) + '%';
    if (hintT > 0){ hintT -= dt; if (hintT <= 0) el('hint').innerHTML =
      machine.crankLocked ? 'click the <b>coin slot</b> to start' : '<b>drag the knob</b> clockwise'; }
  } else {
    const cr = el('sCrank');
    cr.textContent = machine.phase.toUpperCase();
    cr.className = machine.phase === 'idle' ? '' : 'hot';
    el('sLeft').textContent  = machine.prizesLeft;
    if (which === 'bridge'){
      const sp = machine.spanProgress;
      el('sTray').textContent = sp ? sp.toEnd.toFixed(2) + 'm' : '—';
    } else if (which === 'slider'){
      const o = machine.overhangs;
      el('sTray').textContent = o.length ? Math.min(...o).toFixed(3) + 'm' : '—';
    } else if (which === 'claw3'){
      const d = machine.nearest;
      el('sTray').textContent = d === null ? '—' : d.toFixed(3) + 'm';
    } else if (which === 'clawbig'){
      const d = machine.toEnd;
      el('sTray').textContent = d === null ? '—' : d.toFixed(3) + 'm';
    } else if (which === 'himo'){
      el('sTray').textContent = (machine.cutFrac*100).toFixed(0) + '%';
    } else if (which === 'ringhook'){
      el('sTray').textContent = machine.lifted ? 'ON HOOK' : `${machine.lifts} LIFTS`;
    } else if (which === 'seesaw'){
      el('sTray').textContent = machine.tilt.toFixed(1) + '\u00b0';
    } else if (which === 'push'){
      const d = machine.nearest;
      el('sTray').textContent = d === null ? '\u2014' : d.toFixed(3) + 'm';
    } else if (which === 'medal'){
      const d = machine.toLip;
      el('sTray').textContent = d === null ? '\u2014' : d.toFixed(3) + 'm';
    } else {
      el('sTray').textContent = machine.phase.startsWith('aim') ? 'AIMING' : '—';
    }
    el('sGot').textContent   = machine.wins;
    el('sTurns').textContent = which === 'medal' ? machine.dropped : machine.plays;
    el('crank').classList.remove('show');
    if (hintT > 0){ hintT -= dt; if (hintT <= 0) el('hint').innerHTML =
      machine.phase === 'idle' ? 'click the <b>coin slot</b> to play' : ''; }
  }

  fpsN++; fpsT += dt;
  if (fpsT > 0.5){
    el('fps').textContent = `${Math.round(fpsN/fpsT)} FPS · ${machine.world.bodies.length} bodies` +
      ` · ${machine.world.contacts.length} contacts`;
    fpsT = 0; fpsN = 0;
  }
}
resize();
requestAnimationFrame(frame);

window.BENCH = { THREE, scene, camera, machine, orbit,
  // Headless driver — see src/bot.js. `BenchBot` drives the two-button gantry
  // contract, which covers every crane plus 押し出し. メダルゲーム has the same
  // button grammar but a completely different statistic (medals out per medal
  // in, not plays to a win), so it gets `PusherBot` instead.
  bot: which === 'medal' ? new PusherBot(machine)
     : machine.rig ? new BenchBot(machine) : null,
  look(az, el2, dist, ty){ orbit.az = orbit.azT = az; orbit.el = orbit.elT = el2;
    orbit.dist = orbit.distT = dist; if (ty !== undefined) orbit.target.set(0, ty, 0); } };

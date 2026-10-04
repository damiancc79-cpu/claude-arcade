/* ============================================================================
   machines/bridge.js — 橋渡し (hashiwatashi), the bridge setting.

   The connoisseur's cabinet. There is no deck to shove a box across: the prize
   lies BRIDGED across two parallel bars with an open well underneath, and the
   only thing between you and it is geometry.

     ┌───────────────────────┐
     │   ▓▓▓▓▓▓▓▓▓▓▓▓        │  box bridging the two bars
     │ ══╪═════════╪══       │  bar        bar
     │   │  (well) │         │  open drop straight to the prize chute
     └───────────────────────┘

   Anything that leaves the bars is yours, so the operator sets the overhang to
   a couple of centimetres a side and the fight is entirely about moving a box
   you cannot lift. Both real winning lines fall out of the physics rather than
   being special-cased:

     · ずらし — walk the box along the rails, one end at a time, until an end
       clears the last bar and it tips into the well
     · 縦ハメ — rotate the box until its short axis lines up with the gap and it
       drops straight between the bars

   A bad grab does the opposite: it squares the box back up, or slides it to the
   dead centre of the span where you have nothing to hook.

   Uses the shared ClawRig (two prongs, two-button cycle).
   Model contract: base on y = 0, front facing +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, BoxCollider, PlaneCollider, CapsuleCollider, boxCluster } from '../physics.js';
import { ClawRig } from './clawrig.js';

const V3 = THREE.Vector3;
const _u = new V3();

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width : 0.98, depth : 0.92, height: 1.90,

  deckY  : 0.780,                       // the side shelves either side of the well
  cageTop: 1.620,
  inX    : 0.420, inZ: 0.380,

  // the two rails, running front-to-back
  // Rail spacing is THE difficulty dial, and an operator sets it so the box
  // cannot drop through in EITHER orientation: the clear gap (2*x - 2*r) stays
  // narrower than both box dimensions. A lucky 90° spin therefore wins nothing
  // — but at 90° the box has barely a centimetre of purchase a side, which is
  // exactly the knife-edge 縦ハメ tension. The way home is walking it off the
  // end of the rails.
  bar    : { x: 0.066, y: 0.885, r: 0.013, z0: -0.330, z1: 0.250 },
  // open drop between and around them — everything here falls to the chute
  well   : { x0: -0.170, x1: 0.170, z0: -0.350, z1: 0.270 },

  railY  : 1.520,
  headTop: 1.460,
  headMin: 1.215,                       // prong tips reach just below bar level

  limX   : [-0.240, 0.240],
  limZ   : [-0.290, 0.230],
  homeX  : -0.230, homeZ: 0.215,
};

/* Near-square in plan, so BOTH dimensions overhang the 106 mm rail gap by
   ~3 cm. The box therefore has to be shifted a long way sideways before an edge
   clears a rail — at the centimetre-or-two a play the claw can manage, that is
   a genuine grind rather than a lucky spin. */
const BOX = { w: 0.170, h: 0.080, d: 0.166 };

const PRIZE_COLORS = [0xff5c8a, 0xffd166, 0x7ce38b, 0x6ec3ff, 0xc792ea, 0xff9f6e];
export const PRIZE_TYPES = [
  { key:'figure', jp:'スケールフィギュア', en:'SCALE FIGURE' },
  { key:'boxset', jp:'ボックスセット',     en:'BOX SET'     },
  { key:'plate',  jp:'アクリルプレート',   en:'ACRYLIC PLATE' },
  { key:'tumb',   jp:'タンブラー',         en:'TUMBLER'     },
];
const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

/* --------------------------------------------------------- prize box art -- */
const artCache = new Map();
function boxArt(seed){
  if (artCache.has(seed)) return artCache.get(seed);
  const W = 384, H = 224;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const hex = '#' + PRIZE_COLORS[seed % PRIZE_COLORS.length].toString(16).padStart(6,'0');
  const t = PRIZE_TYPES[seed % PRIZE_TYPES.length];

  g.fillStyle = '#f7f4ec'; g.fillRect(0,0,W,H);
  g.fillStyle = hex; g.globalAlpha = .16; g.fillRect(0,0,W,H); g.globalAlpha = 1;
  g.fillStyle = hex; g.fillRect(0, 0, W, 52);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 30px ${JP_FONT}`; g.fillStyle = '#241f30';
  g.fillText(t.jp, W/2, 27);

  // window box: a figure silhouette behind a clear panel
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillRect(28, 72, 150, 124);
  g.strokeStyle = '#241f30'; g.lineWidth = 5; g.strokeRect(28, 72, 150, 124);
  g.fillStyle = hex;
  g.beginPath(); g.arc(103, 118, 30, 0, 7); g.fill();
  g.fillRect(78, 148, 50, 44);
  g.fillStyle = '#241f30';
  g.beginPath(); g.arc(93, 114, 5, 0, 7); g.arc(113, 114, 5, 0, 7); g.fill();

  g.font = `bold 26px ${JP_FONT}`; g.fillStyle = '#241f30';
  g.fillText('全4種', 285, 100);
  g.fillStyle = '#241f30'; g.fillRect(200, 130, 170, 62);
  g.font = 'bold 24px ui-monospace, monospace'; g.fillStyle = '#ffd166';
  g.fillText(t.en, 285, 161);
  g.strokeStyle = '#241f30'; g.lineWidth = 8; g.strokeRect(4,4,W-8,H-8);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  artCache.set(seed, tex);
  return tex;
}

/* ============================================================== machine === */
export class BridgeMachine {
  constructor(opts = {}){
    this.opts = { prizes: 3, seed: 0, strength: 1.10, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'bridge-machine';
    this.world = new World({ gravity: -9.81, velIters: 12, posIters: 4 });

    this.prizes = [];
    this.picks = [];
    this.collected = [];
    this.wins = 0;
    this.onWin = null;
    this.onPhase = null;

    this._buildVisuals();
    this._buildColliders();

    this.rig = new ClawRig(this.world, this.root, {
      inX: SPEC.inX, inZ: SPEC.inZ,
      railY: SPEC.railY, headTop: SPEC.headTop, headMin: SPEC.headMin,
      limX: SPEC.limX, limZ: SPEC.limZ, homeX: SPEC.homeX, homeZ: SPEC.homeZ,
      prongCount: 2,
      strength: this.opts.strength,
      dropSpeed: 0.36, closeTime: 0.80,
      prong: {
        hingeR: 0.055, hingeDrop: 0.050,
        profile: [[0, 0], [0.050, 0.200], [0.020, 0.340]],
        rUpper: 0.028, rLower: 0.026,
        open: -0.35, close: 0.35,
        inertia: 0.020, w0: 3.0,
      },
    });
    // the head body itself, so it can bump a box it lands on
    this.rig.hub = this.world.addCollider(new BoxCollider([0,0,0], [0.075, 0.045, 0.075],
      null, { friction: 0.35, restitution: 0.05 }));
    this.rig.hub.kinematic = true;
    this.rig.hub.reaction = new V3();
    this.rig.hub.pointVel = (p, out) => out.copy(this.rig.headVel);

    this.rig.buildButtons(0.11, 0.560, SPEC.depth/2 + 0.016);
    this.rig.onPhase = ph => { if (this.onPhase) this.onPhase(ph); };
    this.picks.push(...this.rig.picks);

    this._loadPrizes(this.opts.prizes);
  }

  get object3D(){ return this.root; }
  get prizesLeft(){ return this.prizes.filter(p => !p.won).length; }
  get phase(){ return this.rig.phase; }
  get credit(){ return this.rig.credit; }
  get plays(){ return this.rig.plays; }
  insertCoin(){ return this.rig.insertCoin(); }
  pressA(d){ this.rig.pressA(d); }
  pressB(d){ this.rig.pressB(d); }

  /* ------------------------------------------------------------ physics -- */
  _buildColliders(){
    const W = this.world, S = SPEC, B = S.bar, WL = S.well;
    const steel = { friction: 0.46, restitution: 0.04 };   // chromed rail, but not ice
    const deck  = { friction: 0.50, restitution: 0.04 };
    const glass = { friction: 0.20, restitution: 0.10 };

    // THE BARS. Capsules, so a box can pivot and roll on them the way it does
    // on real chromed rail — this is the entire game.
    this.bars = [-1, 1].map(sx => W.addCollider(new CapsuleCollider(
      [sx*B.x, B.y, B.z0], [sx*B.x, B.y, B.z1], B.r, steel)));
    // stub posts holding the rails up at each end
    for (const sx of [-1, 1]) for (const z of [B.z0, B.z1]){
      W.addCollider(new BoxCollider([sx*B.x, (S.deckY + B.y)/2, z],
        [0.016, (B.y - S.deckY)/2, 0.016], null, deck));
    }

    // side shelves either side of the well (stock sits here, not in play)
    const shelf = (x0, x1) => W.addCollider(new BoxCollider(
      [(x0+x1)/2, S.deckY - 0.03, 0], [(x1-x0)/2, 0.03, S.inZ], null, deck));
    shelf(-S.inX, WL.x0);
    shelf(WL.x1, S.inX);
    // and the strips fore/aft of the well
    W.addCollider(new BoxCollider([0, S.deckY - 0.03, (WL.z1 + S.inZ)/2],
      [(WL.x1-WL.x0)/2, 0.03, (S.inZ - WL.z1)/2], null, deck));
    W.addCollider(new BoxCollider([0, S.deckY - 0.03, (-S.inZ + WL.z0)/2],
      [(WL.x1-WL.x0)/2, 0.03, (WL.z0 + S.inZ)/2], null, deck));

    // cage
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.03), 1.15, 0], [0.03, 0.50, S.inZ + 0.03], null, glass));
    for (const sz of [-1, 1]) W.addCollider(new BoxCollider(
      [0, 1.15, sz*(S.inZ + 0.03)], [S.inX + 0.03, 0.50, 0.03], null, glass));
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));

    // Kerbs between the shelves and the well. The prongs can reach past the
    // gantry limits, and without these a stray swipe tips the display stock
    // into the well and hands out a prize nobody played for.
    for (const sx of [-1, 1]){
      W.addCollider(new BoxCollider([sx*(WL.x1 + 0.012), S.deckY + 0.020, 0],
        [0.012, 0.020, S.inZ], null, deck));
    }

    // catch pan under the well + a floor of last resort
    W.addCollider(new BoxCollider([0, 0.34, 0],
      [(WL.x1-WL.x0)/2, 0.02, (WL.z1-WL.z0)/2], null, deck));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  _loadPrizes(n){
    const S = SPEC, B = S.bar;
    const cluster = boxCluster([BOX.w/2, BOX.h/2, BOX.d/2], 0.028);

    // one box on the bars in play, the rest as stock on the side shelves
    for (let i = 0; i < n; i++){
      const seed = (this.opts.seed + i) % PRIZE_COLORS.length;
      const b = new Body(cluster, {
        // Heavy on purpose, and it is the main difficulty dial. Grip capacity
        // works out far below the box's weight, so the prongs can shove and
        // pivot it but never carry it, and each play shifts it a centimetre or
        // two rather than flinging it across the span — which is precisely how
        // an operator sets a bridge machine.
        mass: 1.60, friction: 0.50, restitution: 0.02, linDamp: 0.35, angDamp: 3.0,
      });
      b.tag = 'prize';
      b.prize = { ...PRIZE_TYPES[seed % PRIZE_TYPES.length], color: PRIZE_COLORS[seed] };
      b.won = false;
      b.onBars = (i === 0);

      if (i === 0){
        // bridged across the rails, square on, near the back of the span
        b.setPos(0, B.y + B.r + BOX.h/2 + 0.002, B.z0 + 0.20);
      } else {
        const sx = i % 2 ? 1 : -1;
        b.setPos(sx * 0.32, S.deckY + BOX.h/2 + 0.002, -0.20 + (i - 1) * 0.20);
        b.quat.setFromEuler(new THREE.Euler(0, sx * 0.25, 0));
      }
      b.updateTransform();

      const mesh = this._boxMesh(seed);
      b.mesh = mesh;
      mesh.userData.pick = 'prize';
      this.prizeLayer.add(mesh);
      this.world.add(b);
      this.prizes.push(b);
    }
    for (let i = 0; i < 220; i++) this.world.substep(this.world.cfg.fixedDt);
    for (const b of this.prizes) b.syncMesh();
  }

  _boxMesh(seed){
    const art = boxArt(seed);
    const col = PRIZE_COLORS[seed % PRIZE_COLORS.length];
    const side  = new THREE.MeshStandardMaterial({ color: col, roughness:.60, metalness:.05 });
    const plain = new THREE.MeshStandardMaterial({ color: 0xece7dc, roughness:.7 });
    const face  = new THREE.MeshStandardMaterial({ map: art, roughness:.55 });
    return new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d),
      [side, side, plain, plain, face, side]);
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const S = SPEC, B = S.bar, WL = S.well, root = this.root;
    this.prizeLayer = new THREE.Group();
    root.add(this.prizeLayer);

    const body   = new THREE.MeshStandardMaterial({ color:0x23324f, roughness:.42, metalness:.5 });
    const trim   = new THREE.MeshStandardMaterial({ color:0x14152a, roughness:.45, metalness:.7 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xd2dae8, roughness:.16, metalness:.98 });
    const deckM  = new THREE.MeshStandardMaterial({ color:0x2f4a6e, roughness:.7, metalness:.2 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    this.MAT = { body, trim, chrome, deckM, glass };

    const box = (w,h,d,m,x,y,z,parent=root) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); parent.add(o); return o;
    };

    // plinth
    box(S.width, 0.74, S.depth, body, 0, 0.37, 0);
    box(S.width + 0.02, 0.06, S.depth + 0.02, trim, 0, 0.755, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, trim, 0, 0.040, 0);

    // side shelves + fore/aft strips, leaving the well open
    const slab = (x0,x1,z0,z1) =>
      box(x1-x0, 0.02, z1-z0, deckM, (x0+x1)/2, S.deckY - 0.01, (z0+z1)/2);
    slab(-S.inX, WL.x0, -S.inZ, S.inZ);
    slab(WL.x1,  S.inX, -S.inZ, S.inZ);
    slab(WL.x0, WL.x1, WL.z1, S.inZ);
    slab(WL.x0, WL.x1, -S.inZ, WL.z0);

    // the well mouth, glowing — this is the whole target
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.17, 0.010, 8, 44),
      new THREE.MeshStandardMaterial({ color:0x00ffc8, emissive:0x00ffc8,
        emissiveIntensity:2.0, roughness:.4 }));
    rim.rotation.x = -Math.PI/2;
    rim.position.set(0, S.deckY + 0.004, (WL.z0+WL.z1)/2);
    rim.scale.set((WL.x1-WL.x0)/0.34, 1, (WL.z1-WL.z0)/0.34);
    root.add(rim);
    this.rim = rim;
    // dark shaft so the well reads as a hole rather than a painted rectangle
    box(WL.x1-WL.x0, 0.42, WL.z1-WL.z0,
      new THREE.MeshStandardMaterial({ color:0x05060f, roughness:1 }),
      0, S.deckY - 0.22, (WL.z0+WL.z1)/2);

    // THE BARS
    for (const sx of [-1, 1]){
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(B.r, B.r, B.z1 - B.z0, 14), chrome);
      bar.rotation.x = Math.PI/2;
      bar.position.set(sx*B.x, B.y, (B.z0+B.z1)/2);
      root.add(bar);
      for (const z of [B.z0, B.z1]){
        box(0.030, B.y - S.deckY, 0.030, trim, sx*B.x, (S.deckY + B.y)/2, z);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(B.r*1.5, 12, 8), chrome);
        cap.position.set(sx*B.x, B.y, z);
        root.add(cap);
      }
    }

    // cage
    for (const sx of [-1,1]) for (const sz of [-1,1]){
      box(0.045, S.cageTop - S.deckY + 0.10, 0.045, chrome,
          sx*(S.inX + 0.02), (S.deckY + S.cageTop)/2, sz*(S.inZ + 0.02));
    }
    const pane = (w,h,x,y,z,ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), glass);
      m.position.set(x,y,z); m.rotation.y = ry; root.add(m);
    };
    const ch = S.cageTop - S.deckY, cy = (S.deckY + S.cageTop)/2;
    pane(S.inX*2, ch, 0, cy,  S.inZ + 0.02, 0);
    pane(S.inZ*2, ch,  S.inX + 0.02, cy, 0, Math.PI/2);
    pane(S.inZ*2, ch, -S.inX - 0.02, cy, 0, Math.PI/2);
    box(S.inX*2 + 0.05, ch, 0.03,
      new THREE.MeshStandardMaterial({ color:0x141f38, roughness:.7 }),
      0, cy, -S.inZ - 0.03);

    // marquee
    box(S.width, 0.30, S.depth, trim, 0, 1.75, 0);
    const tex = this._marqueeTexture();
    const mq = new THREE.Mesh(new THREE.PlaneGeometry(S.width - 0.06, 0.22),
      new THREE.MeshStandardMaterial({ map: tex, emissive:0xffffff, emissiveMap: tex,
        emissiveIntensity:1.3, roughness:.6 }));
    mq.position.set(0, 1.75, S.depth/2 + 0.004);
    root.add(mq);
    box(S.width + 0.03, 0.04, S.depth + 0.03, trim, 0, 1.90, 0);

    // coin slot + delivery mouth
    const coin = box(0.055, 0.075, 0.02,
      new THREE.MeshStandardMaterial({ color:0x0d0c18, roughness:.85 }),
      -0.30, 0.50, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x220a12, emissive:0xff2f6e, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.30, 0.445, S.depth/2 + 0.012);
    root.add(this.coinLamp);
    box(0.30, 0.22, 0.02, new THREE.MeshStandardMaterial({ color:0x0d0c18, roughness:.85 }),
      0, 0.21, S.depth/2 - 0.005);
  }

  _marqueeTexture(){
    if (this._mqTex) return this._mqTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#ffd166'); grd.addColorStop(.5, '#ff9f6e'); grd.addColorStop(1, '#37e6ff');
    g.fillStyle = '#0b0720'; g.fillRect(0,0,1024,256);
    g.fillStyle = grd; g.fillRect(0,0,1024,256);
    g.globalAlpha = .18; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(560,0); g.lineTo(780,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign='center'; g.textBaseline='middle';
    g.font = `bold 108px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(10,6,26,.85)';
    g.strokeText('橋渡し', 512, 102); g.fillStyle = '#fff'; g.fillText('橋渡し', 512, 102);
    g.font = 'bold 34px ui-monospace, monospace';
    g.fillText('BRIDGE SETTING  ·  ¥100', 512, 196);
    this._mqTex = new THREE.CanvasTexture(c);
    this._mqTex.colorSpace = THREE.SRGBColorSpace;
    return this._mqTex;
  }

  /* ------------------------------------------------------------- update -- */
  update(dt){
    this.world.step(dt, h => this.rig.stepMechanism(h));
    this.rig.integrateHinges(this.world.cfg.fixedDt);
    this.rig.sync();

    this.coinLamp.material.emissiveIntensity = this.rig.credit > 0
      ? 1.6 + Math.sin(performance.now()*0.006)*0.6 : 0;
    this.rim.material.emissiveIntensity = 1.5 + Math.sin(performance.now()*0.003)*0.6;

    for (const b of this.prizes) if (!b.won) b.syncMesh();
    this._checkPrizes();
    if (this.debug && this.debug.visible) this.rig.updateDebug();
  }

  /** Anything that clears the rails and enters the well is won. */
  _checkPrizes(){
    const S = SPEC, WL = S.well;
    for (const b of this.prizes){
      if (b.won) continue;
      b.onBars = b.pos.y > S.deckY + 0.04;
      if (b.pos.y < S.deckY - 0.08 &&
          b.pos.x > WL.x0 - 0.04 && b.pos.x < WL.x1 + 0.04 &&
          b.pos.z > WL.z0 - 0.04 && b.pos.z < WL.z1 + 0.04){
        b.won = true;
        this.wins++;
        this.collected.push(b.prize);
        if (this.onWin) this.onWin(b.prize);
      }
    }
  }

  /** Distance the in-play box still has to travel — used by the HUD. */
  get spanProgress(){
    const live = this.prizes.filter(p => !p.won && p.onBars);
    if (!live.length) return null;
    const b = live[0], B = SPEC.bar;
    return { z: b.pos.z, toEnd: +(B.z1 - b.pos.z).toFixed(3),
             yaw: +Math.abs(Math.atan2(
               2*(b.quat.w*b.quat.y + b.quat.x*b.quat.z),
               1 - 2*(b.quat.y*b.quat.y + b.quat.z*b.quat.z))).toFixed(2) };
  }

  reset(){
    for (const b of this.prizes){ this.world.remove(b); this.prizeLayer.remove(b.mesh); }
    this.prizes.length = 0;
    this.rig.reset();
    this._loadPrizes(this.opts.prizes);
  }

  /* --------------------------------------------------------------- debug -- */
  buildDebug(){
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color:0x00ff9d, wireframe:true,
      transparent:true, opacity:.4, depthTest:false });
    const hot = new THREE.MeshBasicMaterial({ color:0xff3d8b, wireframe:true,
      transparent:true, opacity:.85, depthTest:false });
    for (const c of this.world.colliders){
      if (c instanceof BoxCollider){
        const m = new THREE.Mesh(new THREE.BoxGeometry(c.h.x*2, c.h.y*2, c.h.z*2),
          c === this.rig.hub ? hot : mat);
        m.position.copy(c.c); m.quaternion.copy(c.q);
        if (c === this.rig.hub) this._dbgHub = m;
        g.add(m);
      }
    }
    for (const bar of this.bars){
      _u.copy(bar.b).sub(bar.a);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(bar.r, _u.length(), 4, 10), mat);
      m.position.copy(bar.a).addScaledVector(_u, 0.5);
      m.quaternion.setFromUnitVectors(new V3(0,1,0), _u.clone().normalize());
      g.add(m);
    }
    this.rig.buildDebug(g, hot);
    g.renderOrder = 999;
    this.debug = g;
    this.root.add(g);
    return g;
  }
  updateDebug(){
    if (this._dbgHub) this._dbgHub.position.copy(this.rig.hub.c);
    this.rig.updateDebug();
  }
}

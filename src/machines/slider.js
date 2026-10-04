/* ============================================================================
   machines/slider.js — スライダー, the rail/slider setting.

   Superficially close to 橋渡し, mechanically its opposite. On a bridge the box
   can escape sideways, rotate, wedge, drop between the rails — there are half a
   dozen ways home. Here there are none. Each prize sits in its own guided lane:

     side view              plan view
     ╲                      ┌────┬────┐
      ╲▓▓▓                  │ ▓  │    │   two guided lanes, rails front-to-back
       ╲══════╗             │    │ ▓  │   inclined ~7 degrees toward the player
        (drop)╚═            ├────┴────┤
                            │  chute  │   open drop across the front
                            └─────────┘

   Guide walls mean the box cannot leave its lane and cannot usefully rotate.
   The ONLY way to win is to advance it, a few millimetres at a time, until its
   centre of mass passes the end of the rails and it tips into the chute. That
   is the entire game, and it is why these are the most patience-taxing setting
   on the floor.

   Two details make the grind behave:

     · the rails are inclined a few degrees toward the front. Static friction
       holds the box at rest, but every disturbance is biased downhill, so
       progress accumulates instead of random-walking
     · the prongs grip ACROSS the lane, on the box's side faces. Working along
       the lane instead looks right but cancels: the two opposed prongs both
       reach the box and the rear-pushing one usually wins, walking the prize
       backwards. Gripping the sides lets the lift break friction and the ramp
       decide the direction

   Uses the shared ClawRig. Model contract: base y = 0, front +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, BoxCollider, PlaneCollider, CapsuleCollider, boxCluster } from '../physics.js';
import { ClawRig } from './clawrig.js';

const V3 = THREE.Vector3;
const _u = new V3();

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width : 0.98, depth : 0.92, height: 1.90,

  deckY  : 0.700,
  cageTop: 1.600,
  inX    : 0.420, inZ: 0.380,

  // Two lanes, not three. The prongs open to ±0.19, so a lane must be wide
  // enough for them to drop INSIDE it and grip the box's sides. Narrower
  // lanes just make the claw clamp the guide walls.
  lanes  : [-0.210, 0.210],
  laneHalf: 0.200,                       // guide-wall half-spacing
  railDx : 0.046,                        // rail offset either side of lane centre
  railR  : 0.010,
  // inclined: higher at the back, so every nudge is biased downhill
  // ~6.7 degrees. Static friction still holds the box at rest, but every
  // disturbance is biased downhill, so nudges accumulate instead of
  // random-walking. Too shallow and the grind never converges.
  railZ0 : -0.300, railY0: 0.855,
  railZ1 :  0.170, railY1: 0.800,
  wallH  : 0.062,

  chuteZ0: 0.195, chuteZ1: 0.380,        // open drop across the full width

  railY  : 1.500,
  headTop: 1.440,
  // Tuned so the prong tips land at the box's MID-HEIGHT at the low end of the
  // ramp — pushing the vertical face. Any deeper and a prong slips underneath,
  // and the close turns into a scoop that flings the box half a metre instead
  // of nudging it. At the high end the claw simply bottoms out on the rails and
  // the hoist-resistance stall stops it, as a real machine does.
  headMin: 1.215,

  limX   : [-0.290, 0.290],
  limZ   : [-0.280, 0.240],
  homeX  : -0.285, homeZ: 0.230,         // parked over the chute
};

const BOX = { w: 0.140, h: 0.100, d: 0.175 };

const PRIZE_COLORS = [0xff5c8a, 0xffd166, 0x7ce38b, 0x6ec3ff, 0xc792ea, 0xff9f6e];
export const PRIZE_TYPES = [
  { key:'figure', jp:'プレミアムフィギュア', en:'PREMIUM FIGURE' },
  { key:'watch',  jp:'腕時計',             en:'WATCH'          },
  { key:'audio',  jp:'ワイヤレスイヤホン',   en:'EARBUDS'        },
  { key:'game',   jp:'ゲームソフト',        en:'GAME'           },
];
const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

/** Rail height at a given z — the lanes are a ramp, not a shelf. */
export function railHeightAt(z){
  const S = SPEC;
  const t = Math.max(0, Math.min(1, (z - S.railZ0) / (S.railZ1 - S.railZ0)));
  return S.railY0 + (S.railY1 - S.railY0) * t;
}

/* --------------------------------------------------------- prize box art -- */
const artCache = new Map();
function boxArt(seed){
  if (artCache.has(seed)) return artCache.get(seed);
  const W = 320, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const hex = '#' + PRIZE_COLORS[seed % PRIZE_COLORS.length].toString(16).padStart(6,'0');
  const t = PRIZE_TYPES[seed % PRIZE_TYPES.length];

  g.fillStyle = '#111428'; g.fillRect(0,0,W,H);
  g.fillStyle = hex; g.globalAlpha = .22; g.fillRect(0,0,W,H); g.globalAlpha = 1;
  // premium-looking band + foil stripe
  g.fillStyle = hex; g.fillRect(0, 0, W, 46);
  g.fillStyle = '#ffd166'; g.fillRect(0, 46, W, 5);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 26px ${JP_FONT}`; g.fillStyle = '#111428';
  g.fillText(t.jp, W/2, 24);

  g.fillStyle = 'rgba(255,255,255,.10)';
  g.fillRect(38, 76, W-76, 118);
  g.strokeStyle = hex; g.lineWidth = 4; g.strokeRect(38, 76, W-76, 118);
  g.fillStyle = hex;
  g.beginPath(); g.arc(W/2, 122, 30, 0, 7); g.fill();
  g.fillRect(W/2-26, 152, 52, 38);
  g.fillStyle = '#111428';
  g.beginPath(); g.arc(W/2-11, 118, 5, 0, 7); g.arc(W/2+11, 118, 5, 0, 7); g.fill();

  g.font = 'bold 22px ui-monospace, monospace'; g.fillStyle = '#ffd166';
  g.fillText(t.en, W/2, 220);
  g.strokeStyle = hex; g.lineWidth = 8; g.strokeRect(4,4,W-8,H-8);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  artCache.set(seed, tex);
  return tex;
}

/* ============================================================== machine === */
export class SliderMachine {
  constructor(opts = {}){
    this.opts = { seed: 0, strength: 1.50, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'slider-machine';
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
      dropSpeed: 0.34, closeTime: 0.85,
      prong: {
        hingeR: 0.052, hingeDrop: 0.050,
        profile: [[0, 0], [0.046, 0.200], [0.018, 0.340]],
        rUpper: 0.027, rLower: 0.025,
        open: -0.32, close: 0.38,
        inertia: 0.019, w0: 3.0,
      },
    });
    this.rig.hub = this.world.addCollider(new BoxCollider([0,0,0], [0.070, 0.045, 0.070],
      null, { friction: 0.35, restitution: 0.05 }));
    this.rig.hub.kinematic = true;
    this.rig.hub.reaction = new V3();
    this.rig.hub.pointVel = (p, out) => out.copy(this.rig.headVel);

    this.rig.buildButtons(0.11, 0.560, SPEC.depth/2 + 0.016);
    this.rig.onPhase = ph => { if (this.onPhase) this.onPhase(ph); };
    this.picks.push(...this.rig.picks);

    this._loadPrizes();
  }

  get object3D(){ return this.root; }
  get prizesLeft(){ return this.prizes.filter(p => !p.won).length; }
  get phase(){ return this.rig.phase; }
  get credit(){ return this.rig.credit; }
  get plays(){ return this.rig.plays; }
  insertCoin(){ return this.rig.insertCoin(); }
  pressA(d){ this.rig.pressA(d); }
  pressB(d){ this.rig.pressB(d); }

  /** How far each live box still has to travel before it tips. */
  get overhangs(){
    return this.prizes.filter(p => !p.won)
      .map(p => +(SPEC.railZ1 - p.pos.z).toFixed(3));
  }

  /* ------------------------------------------------------------ physics -- */
  _buildColliders(){
    const W = this.world, S = SPEC;
    const steel = { friction: 0.48, restitution: 0.03 };   // well above tan(6.7deg)
    const deck  = { friction: 0.55, restitution: 0.03 };
    const glass = { friction: 0.20, restitution: 0.10 };

    this.rails = [];
    for (const lx of S.lanes){
      // the two inclined rails of this lane
      for (const sx of [-1, 1]){
        this.rails.push(W.addCollider(new CapsuleCollider(
          [lx + sx*S.railDx, S.railY0, S.railZ0],
          [lx + sx*S.railDx, S.railY1, S.railZ1], S.railR, steel)));
      }
      // guide walls: the box cannot leave its lane, which is the whole point
      for (const sx of [-1, 1]){
        W.addCollider(new BoxCollider(
          [lx + sx*S.laneHalf, (S.railY0 + S.railY1)/2 + S.wallH/2 - 0.01,
           (S.railZ0 + S.railZ1)/2],
          [0.010, S.wallH/2 + 0.030, (S.railZ1 - S.railZ0)/2], null, deck));
      }
      // back stop, so a botched grab cannot shove the prize out the rear
      W.addCollider(new BoxCollider([lx, S.railY0 + 0.045, S.railZ0 - 0.012],
        [S.laneHalf, 0.045, 0.012], null, deck));
    }

    // support structure under the rails (visual parity + stops strays)
    W.addCollider(new BoxCollider([0, S.deckY - 0.03, (S.railZ0 - 0.05)],
      [S.inX, 0.03, 0.06], null, deck));

    // cage
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.03), 1.12, 0], [0.03, 0.50, S.inZ + 0.03], null, glass));
    for (const sz of [-1, 1]) W.addCollider(new BoxCollider(
      [0, 1.12, sz*(S.inZ + 0.03)], [S.inX + 0.03, 0.50, 0.03], null, glass));
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));

    // catch pan under the chute + floor of last resort
    W.addCollider(new BoxCollider([0, 0.32, (S.chuteZ0 + S.chuteZ1)/2],
      [S.inX - 0.02, 0.02, (S.chuteZ1 - S.chuteZ0)/2], null, deck));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  _loadPrizes(){
    const S = SPEC;
    const cluster = boxCluster([BOX.w/2, BOX.h/2, BOX.d/2], 0.026);
    // staged at slightly different points down the ramp — an operator always
    // leaves one looking almost ready, which is the hook
    // staged part-way down, the way an operator leaves them: close enough to
    // look winnable, far enough to be a real grind
    const startZ = [0.020, 0.072];

    S.lanes.forEach((lx, i) => {
      const seed = (this.opts.seed + i) % PRIZE_COLORS.length;
      const b = new Body(cluster, {
        // Heavy, like the bridge box: the prongs can shove it but never lift it,
        // and each play is worth millimetres rather than a flung throw.
        mass: 1.60, friction: 0.50, restitution: 0.02, linDamp: 0.34, angDamp: 3.0,
      });
      b.tag = 'prize';
      b.lane = i;
      b.prize = { ...PRIZE_TYPES[seed % PRIZE_TYPES.length], color: PRIZE_COLORS[seed] };
      b.won = false;
      const z = startZ[i];
      b.setPos(lx, railHeightAt(z) + S.railR + BOX.h/2 + 0.002, z);
      // Rotation about +X sends the +Z end DOWN for a positive angle, so the
      // drop must be written (back - front). Getting this backwards seats every
      // box leaning uphill and quietly biases the whole machine the wrong way.
      b.quat.setFromEuler(new THREE.Euler(
        Math.atan2(S.railY0 - S.railY1, S.railZ1 - S.railZ0), 0, 0));
      b.updateTransform();

      const mesh = this._boxMesh(seed);
      b.mesh = mesh;
      mesh.userData.pick = 'prize';
      this.prizeLayer.add(mesh);
      this.world.add(b);
      this.prizes.push(b);
    });
    for (let i = 0; i < 240; i++) this.world.substep(this.world.cfg.fixedDt);
    for (const b of this.prizes) b.syncMesh();
  }

  _boxMesh(seed){
    const art = boxArt(seed);
    const col = PRIZE_COLORS[seed % PRIZE_COLORS.length];
    const side  = new THREE.MeshStandardMaterial({ color: col, roughness:.5, metalness:.15 });
    const dark  = new THREE.MeshStandardMaterial({ color: 0x161a30, roughness:.6 });
    const face  = new THREE.MeshStandardMaterial({ map: art, roughness:.5 });
    return new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d),
      [side, side, dark, dark, face, dark]);
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const S = SPEC, root = this.root;
    this.prizeLayer = new THREE.Group();
    root.add(this.prizeLayer);

    const body   = new THREE.MeshStandardMaterial({ color:0x2c2350, roughness:.42, metalness:.5 });
    const trim   = new THREE.MeshStandardMaterial({ color:0x14152a, roughness:.45, metalness:.7 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xd2dae8, roughness:.16, metalness:.98 });
    const wallM  = new THREE.MeshStandardMaterial({ color:0x3d3470, roughness:.6, metalness:.25 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    this.MAT = { body, trim, chrome, glass };

    const box = (w,h,d,m,x,y,z,parent=root) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); parent.add(o); return o;
    };

    // plinth
    box(S.width, 0.66, S.depth, body, 0, 0.33, 0);
    box(S.width + 0.02, 0.06, S.depth + 0.02, trim, 0, 0.675, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, trim, 0, 0.040, 0);
    // dark interior floor so the chute reads as a void
    box(S.inX*2, 0.02, S.inZ*2,
      new THREE.MeshStandardMaterial({ color:0x0a0b18, roughness:1 }),
      0, S.deckY - 0.20, 0);

    // --- the lanes --------------------------------------------------------
    const railLen = Math.hypot(S.railZ1 - S.railZ0, S.railY1 - S.railY0);
    const pitch = Math.atan2(S.railY1 - S.railY0, S.railZ1 - S.railZ0);
    for (const lx of S.lanes){
      for (const sx of [-1, 1]){
        const r = new THREE.Mesh(
          new THREE.CylinderGeometry(S.railR, S.railR, railLen, 12), chrome);
        r.rotation.x = Math.PI/2 + pitch;
        r.position.set(lx + sx*S.railDx, (S.railY0 + S.railY1)/2,
                       (S.railZ0 + S.railZ1)/2);
        root.add(r);
      }
      // guide walls
      for (const sx of [-1, 1]){
        const w = new THREE.Mesh(
          new THREE.BoxGeometry(0.010, S.wallH, railLen), wallM);
        w.rotation.x = pitch;
        w.position.set(lx + sx*S.laneHalf,
                       (S.railY0 + S.railY1)/2 + S.wallH/2 - 0.01,
                       (S.railZ0 + S.railZ1)/2);
        root.add(w);
      }
      // back stop + support legs
      box(S.laneHalf*2, 0.09, 0.024, trim, lx, S.railY0 + 0.045, S.railZ0 - 0.012);
      for (const z of [S.railZ0 + 0.06, S.railZ1 - 0.06]){
        box(0.024, railHeightAt(z) - S.deckY + 0.10, 0.024, trim,
            lx, (railHeightAt(z) + S.deckY) / 2 - 0.05, z);
      }
      // lit edge marker at the drop, so the target is unmistakable
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(S.laneHalf*2, 0.010, 0.014),
        new THREE.MeshStandardMaterial({ color:0x00ffc8, emissive:0x00ffc8,
          emissiveIntensity:2.2, roughness:.4 }));
      edge.position.set(lx, S.railY1 + 0.004, S.railZ1);
      root.add(edge);
      if (!this.edges) this.edges = [];
      this.edges.push(edge);
    }

    // chute mouth glow
    const rim = new THREE.Mesh(
      new THREE.PlaneGeometry(S.inX*2 - 0.04, S.chuteZ1 - S.chuteZ0),
      new THREE.MeshStandardMaterial({ color:0x0a3f3a, emissive:0x00ffc8,
        emissiveIntensity:.5, roughness:.6, transparent:true, opacity:.65 }));
    rim.rotation.x = -Math.PI/2;
    rim.position.set(0, S.deckY - 0.185, (S.chuteZ0 + S.chuteZ1)/2);
    root.add(rim);
    this.rim = rim;

    // --- cage -------------------------------------------------------------
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
      new THREE.MeshStandardMaterial({ color:0x1a1636, roughness:.7 }),
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
      -0.30, 0.46, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x220a12, emissive:0xff2f6e, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.30, 0.405, S.depth/2 + 0.012);
    root.add(this.coinLamp);
    box(0.32, 0.22, 0.02, new THREE.MeshStandardMaterial({ color:0x0d0c18, roughness:.85 }),
      0, 0.20, S.depth/2 - 0.005);
  }

  _marqueeTexture(){
    if (this._mqTex) return this._mqTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#37e6ff'); grd.addColorStop(.5, '#6ec3ff'); grd.addColorStop(1, '#c792ea');
    g.fillStyle = '#0b0720'; g.fillRect(0,0,1024,256);
    g.fillStyle = grd; g.fillRect(0,0,1024,256);
    g.globalAlpha = .18; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(560,0); g.lineTo(780,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign='center'; g.textBaseline='middle';
    g.font = `bold 104px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(10,6,26,.85)';
    g.strokeText('スライダー', 512, 100); g.fillStyle = '#fff'; g.fillText('スライダー', 512, 100);
    g.font = 'bold 34px ui-monospace, monospace';
    g.fillText('SLIDER  ·  RAIL SETTING  ·  ¥100', 512, 196);
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
    const pulse = 1.8 + Math.sin(performance.now()*0.004)*0.7;
    for (const e of this.edges) e.material.emissiveIntensity = pulse;

    for (const b of this.prizes) if (!b.won) b.syncMesh();
    this._checkPrizes();
    if (this.debug && this.debug.visible) this.updateDebug();
  }

  /** A box that has tipped off the end of its rails and fallen is won. */
  _checkPrizes(){
    const S = SPEC;
    for (const b of this.prizes){
      if (b.won) continue;
      if (b.pos.y < S.railY1 - 0.12 && b.pos.z > S.railZ1 - 0.03){
        b.won = true;
        this.wins++;
        this.collected.push(b.prize);
        if (this.onWin) this.onWin(b.prize);
      }
    }
  }

  reset(){
    for (const b of this.prizes){ this.world.remove(b); this.prizeLayer.remove(b.mesh); }
    this.prizes.length = 0;
    this.rig.reset();
    this._loadPrizes();
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
    for (const rail of this.rails){
      _u.copy(rail.b).sub(rail.a);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(rail.r, _u.length(), 4, 8), mat);
      m.position.copy(rail.a).addScaledVector(_u, 0.5);
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

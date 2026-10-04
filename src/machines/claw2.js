/* ============================================================================
   machines/claw2.js — 二本爪 (nisū), the two-prong UFO catcher.

   This is NOT a "grab it and carry it home" machine, and it is not built like
   one. Two-prong cabinets are stocked with BOXED prizes, and the prongs are
   broad, rigid and set 180° apart. You almost never lift a box clear; you
   wedge, shove, tilt and topple it across the playfield until it drops into
   the prize chute. Everything below is arranged to make that the real strategy:

     · prizes are boxes, not plush — sphere-cluster rounded cuboids that rest on
       four contact points, stack, and tip over an edge the way a box does
     · the prongs are 1-DOF hinges with genuine rotational inertia (physics.Arm),
       driven by a geared-motor torque curve. A box they cannot close around
       stops them dead, and the reaction is what shifts the box
     · the head hangs on a cable modelled as a damped pendulum, so a fast gantry
       move leaves it swinging and your aim drifts

   CONTROLS are the authentic Japanese two-button scheme: hold button ➊ and the
   claw tracks right, release to lock that axis; hold button ➋ and it tracks
   back, release and the machine takes over — descend, close, lift, return.
   There is no free-flight joystick and no second chance.

   The crane itself is the shared ClawRig. This machine carried its own copy of
   the prong/gantry code for a long time — it was written before the rig was
   extracted from it — and the copy was left alone rather than risk regressing a
   verified cabinet. Porting it was checked by running both builds side by side
   against a seeded pile and an identical scripted play list, and comparing every
   prize's position to five decimal places after every play.

   Model contract: base on y = 0, front facing +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, BoxCollider, PlaneCollider, boxCluster } from '../physics.js';
import { ClawRig } from './clawrig.js';

const V3 = THREE.Vector3;
const _u = new V3();

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width  : 0.98, depth : 0.92, height: 1.90,

  floorY : 0.640,                       // playfield deck
  cageTop: 1.600,
  inX    : 0.420, inZ  : 0.380,         // playfield half-extents

  // prize chute: front-left corner, the way nearly every cabinet is laid out
  chute  : { x0:-0.420, x1:-0.150, z0: 0.090, z1: 0.380 },

  railY  : 1.500,
  headTop: 1.440,
  headMin: 1.010,                       // prong tips just graze the deck here

  limX   : [-0.300, 0.340],
  limZ   : [-0.300, 0.260],
  homeX  : -0.285, homeZ: 0.235,        // parked over the chute

  prong  : {
    hingeR: 0.055, hingeDrop: 0.050,
    profile: [[0, 0], [0.050, 0.200], [0.020, 0.340]],
    rUpper: 0.028, rLower: 0.026,
    open: -0.35, close: 0.35,
    inertia: 0.020, w0: 3.0,            // motor no-load speed, rad/s
  },
};

const BOX = { w: 0.120, h: 0.160, d: 0.080 };

/** Deterministic RNG, so a restock lays the same pile out every time. */
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRIZE_COLORS = [
  0xff5c8a, 0xffd166, 0x7ce38b, 0x6ec3ff, 0xc792ea, 0xff9f6e, 0x5fe1c0,
];
export const PRIZE_TYPES = [
  { key:'figure', jp:'フィギュア',     en:'FIGURE'      },
  { key:'nendo',  jp:'デフォルメ',     en:'CHIBI FIGURE'},
  { key:'mug',    jp:'マグカップ',     en:'MUG'         },
  { key:'set',    jp:'アクリルスタンド', en:'ACRYLIC STAND' },
];

const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

/* ------------------------------------------------------- prize box art --- */
const boxArtCache = new Map();
function boxArt(seed){
  if (boxArtCache.has(seed)) return boxArtCache.get(seed);
  const W = 256, H = 340;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const pal = PRIZE_COLORS[seed % PRIZE_COLORS.length];
  const hex = '#' + pal.toString(16).padStart(6, '0');
  const t = PRIZE_TYPES[seed % PRIZE_TYPES.length];

  g.fillStyle = '#f7f4ec'; g.fillRect(0, 0, W, H);
  g.fillStyle = hex; g.fillRect(0, 0, W, 64);
  g.fillStyle = hex; g.globalAlpha = .18; g.fillRect(0, 64, W, H - 64); g.globalAlpha = 1;

  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 30px ${JP_FONT}`; g.fillStyle = '#241f30';
  g.fillText(t.jp, W/2, 33);

  // a little figure silhouette so the box reads as merchandise
  g.fillStyle = hex;
  g.beginPath(); g.arc(W/2, 150, 44, 0, 7); g.fill();
  g.fillRect(W/2 - 34, 186, 68, 74);
  g.fillStyle = '#241f30';
  g.beginPath(); g.arc(W/2 - 16, 146, 7, 0, 7); g.arc(W/2 + 16, 146, 7, 0, 7); g.fill();
  g.strokeStyle = '#241f30'; g.lineWidth = 4;
  g.beginPath(); g.arc(W/2, 160, 12, 0.15*Math.PI, 0.85*Math.PI); g.stroke();

  g.fillStyle = '#241f30'; g.fillRect(0, H - 56, W, 56);
  g.font = 'bold 26px ui-monospace, monospace'; g.fillStyle = '#ffd166';
  g.fillText('PRIZE  /  ' + t.en, W/2, H - 28);
  g.strokeStyle = '#241f30'; g.lineWidth = 8; g.strokeRect(4, 4, W-8, H-8);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  boxArtCache.set(seed, tex);
  return tex;
}

/* ============================================================== machine === */
export class TwoProngMachine {
  constructor(opts = {}){
    this.opts = { prizes: 9, seed: 0, strength: 1.5, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'two-prong-machine';
    this.world = new World({ gravity: -9.81, velIters: 10, posIters: 4 });

    this.prizes = [];
    this.picks = [];
    this.collected = [];
    this.wins = 0;
    this.onWin = null;
    this.onPhase = null;

    this._buildVisuals();
    this._buildColliders();

    // The rig's colliders have to land in the world in the same order they did
    // when this machine owned them — prongs first, then the head hub — because
    // the sequential-impulse solve walks contacts in creation order.
    this.rig = new ClawRig(this.world, this.root, {
      inX: SPEC.inX, inZ: SPEC.inZ,
      railY: SPEC.railY, headTop: SPEC.headTop, headMin: SPEC.headMin,
      limX: SPEC.limX, limZ: SPEC.limZ, homeX: SPEC.homeX, homeZ: SPEC.homeZ,
      prongCount: 2,
      strength: this.opts.strength,
      // moveSpeed, dropSpeed and closeTime are all left at the rig's defaults,
      // which ARE this machine's original numbers — 0.34, 0.42 and 0.75.
      prong: SPEC.prong,
    });
    this.hub = this.world.addCollider(new BoxCollider([0, 0, 0], [0.075, 0.045, 0.075],
      null, { friction: 0.35, restitution: 0.05 }));
    this.hub.kinematic = true;
    this.hub.reaction = new V3();
    this.hub.pointVel = (p, out) => out.copy(this.rig.headVel);
    this.rig.hub = this.hub;

    this.rig.buildButtons(0.11, 0.560, SPEC.depth/2 + 0.016);
    this.rig.onPhase = ph => { if (this.onPhase) this.onPhase(ph); };
    this.picks.push(...this.rig.picks);
    this._buildBlades();

    this._loadPrizes(this.opts.prizes);
  }

  get object3D(){ return this.root; }
  get prizesLeft(){ return this.prizes.filter(p => !p.won).length; }
  get busy(){ return this.rig.busy; }
  get phase(){ return this.rig.phase; }
  get credit(){ return this.rig.credit; }
  get plays(){ return this.rig.plays; }
  insertCoin(){ return this.rig.insertCoin(); }
  pressA(d){ this.rig.pressA(d); }
  pressB(d){ this.rig.pressB(d); }

  /* ------------------------------------------------------------ physics -- */
  _buildColliders(){
    const W = this.world, S = SPEC;
    const deck = { friction: 0.45, restitution: 0.04 };
    const glass = { friction: 0.20, restitution: 0.10 };

    // Playfield deck, built as slabs around the chute mouth so the hole is real
    // geometry rather than a scripted trigger.
    const C = S.chute, fy = S.floorY;
    const slab = (x0, x1, z0, z1) => W.addCollider(new BoxCollider(
      [(x0+x1)/2, fy - 0.03, (z0+z1)/2], [(x1-x0)/2, 0.03, (z1-z0)/2], null, deck));
    slab(C.x1, S.inX, -S.inZ, S.inZ);          // everything right of the chute
    slab(-S.inX, C.x1, -S.inZ, C.z0);          // the strip behind it

    // chute lip — a real rim, so a box has to be pushed over it
    W.addCollider(new BoxCollider([C.x1, fy + 0.012, (C.z0+C.z1)/2],
      [0.010, 0.012, (C.z1-C.z0)/2], null, deck));
    W.addCollider(new BoxCollider([(C.x0+C.x1)/2, fy + 0.012, C.z0],
      [(C.x1-C.x0)/2, 0.012, 0.010], null, deck));

    // cage walls + roof
    for (const sx of [-1, 1]){
      W.addCollider(new BoxCollider([sx*(S.inX + 0.03), 1.10, 0],
        [0.03, 0.50, S.inZ + 0.03], null, glass));
    }
    for (const sz of [-1, 1]){
      W.addCollider(new BoxCollider([0, 1.10, sz*(S.inZ + 0.03)],
        [S.inX + 0.03, 0.50, 0.03], null, glass));
    }
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));

    // catch bin under the chute + a floor of last resort
    W.addCollider(new BoxCollider([(C.x0+C.x1)/2, 0.30, (C.z0+C.z1)/2],
      [(C.x1-C.x0)/2, 0.02, (C.z1-C.z0)/2], null, deck));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  _loadPrizes(n){
    const S = SPEC;
    // Overlapping shell grid, not eight corner spheres — see physics.boxCluster.
    const cluster = boxCluster([BOX.w/2, BOX.h/2, BOX.d/2], 0.026);
    /* SEEDED, like every other machine here. This used to jitter the grid with
       raw Math.random(), which made 二本爪 the one cabinet on the floor whose
       stock could not be reproduced: the same `seed` laid out a different pile
       every build, so `BENCH.bot.session({ seed })` did not control the pile it
       was measuring and no A/B on this machine could have a control. It was
       found by exactly that failure — it was the only machine whose
       two-fresh-builds fingerprint disagreed with itself.

       The floor still gets its variety, because `main.js` hands every bay a
       different seed; what it gains is that a given bay now looks the same
       every time you walk up to it. */
    const rand = rng(this.opts.seed * 977 + 13);

    for (let i = 0; i < n; i++){
      const seed = (this.opts.seed + i) % PRIZE_COLORS.length;
      const b = new Body(cluster, {
        mass: 0.26, friction: 0.44, restitution: 0.03, linDamp: 0.2, angDamp: 1.1,
      });
      b.tag = 'prize';
      b.prize = { ...PRIZE_TYPES[seed % PRIZE_TYPES.length],
                  color: PRIZE_COLORS[seed] };
      b.won = false;

      // Stock the field the way an operator would: a standing back row and a
      // lying front row. The grid deliberately clears the chute mouth — a box
      // seeded over the hole drops through during the settle and hands out a
      // free prize before the machine has taken a coin.
      const col = i % 3, row = Math.floor(i / 3);
      let x = -0.26 + col * 0.190 + (rand()-0.5)*0.025;
      let z = -0.260 + row * 0.155 + (rand()-0.5)*0.025;
      const C = SPEC.chute, pad = BOX.w;
      if (x < C.x1 + pad && z > C.z0 - pad) z = C.z0 - pad - 0.02;   // nudge clear
      const lying = row >= 1;
      b.setPos(x, S.floorY + (lying ? BOX.d/2 : BOX.h/2) + 0.004, z);
      if (lying) b.quat.setFromEuler(new THREE.Euler(Math.PI/2, rand()*0.6-0.3, 0));
      else       b.quat.setFromEuler(new THREE.Euler(0, rand()*0.5-0.25, 0));
      b.updateTransform();

      const mesh = this._boxMesh(seed);
      b.mesh = mesh;
      mesh.userData.pick = 'prize';
      this.prizeLayer.add(mesh);
      this.world.add(b);
      this.prizes.push(b);
    }
    for (let i = 0; i < 200; i++) this.world.substep(this.world.cfg.fixedDt);
    for (const b of this.prizes) b.syncMesh();
  }

  _boxMesh(seed){
    const art = boxArt(seed);
    const side = new THREE.MeshStandardMaterial({
      color: PRIZE_COLORS[seed % PRIZE_COLORS.length], roughness: .62, metalness: .05 });
    const face = new THREE.MeshStandardMaterial({ map: art, roughness: .55 });
    const plain = new THREE.MeshStandardMaterial({ color: 0xece7dc, roughness: .7 });
    const g = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d),
      [side, side, plain, plain, face, side]);      // +Z face carries the art
    return g;
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const S = SPEC, root = this.root;
    this.prizeLayer = new THREE.Group();
    root.add(this.prizeLayer);

    const body   = new THREE.MeshStandardMaterial({ color:0x232349, roughness:.42, metalness:.5 });
    const trim   = new THREE.MeshStandardMaterial({ color:0x14152a, roughness:.45, metalness:.7 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xc8d0e2, roughness:.22, metalness:.95 });
    const deckM  = new THREE.MeshStandardMaterial({ color:0x3a3a72, roughness:.72, metalness:.18 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    const dark   = new THREE.MeshStandardMaterial({ color:0x0d0c18, roughness:.85 });
    this.MAT = { body, trim, chrome, deckM, glass, dark };

    const box = (w,h,d,m,x,y,z,parent=root) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); parent.add(o); return o;
    };

    // --- plinth -----------------------------------------------------------
    box(S.width, 0.60, S.depth, body, 0, 0.30, 0);
    box(S.width + 0.02, 0.06, S.depth + 0.02, trim, 0, 0.615, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, dark, 0, 0.040, 0);

    // playfield deck, in slabs around the chute
    const C = S.chute;
    const deckSlab = (x0,x1,z0,z1) =>
      box(x1-x0, 0.02, z1-z0, deckM, (x0+x1)/2, S.floorY - 0.01, (z0+z1)/2);
    deckSlab(C.x1, S.inX, -S.inZ, S.inZ);
    deckSlab(-S.inX, C.x1, -S.inZ, C.z0);
    // glowing chute rim
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.010, 8, 40),
      new THREE.MeshStandardMaterial({ color:0x00ffc8, emissive:0x00ffc8,
        emissiveIntensity:2.2, roughness:.4 }));
    rim.rotation.x = -Math.PI/2;
    rim.position.set((C.x0+C.x1)/2, S.floorY + 0.014, (C.z0+C.z1)/2);
    rim.scale.set((C.x1-C.x0)/0.32, 1, (C.z1-C.z0)/0.32);
    root.add(rim);
    this.rim = rim;

    // --- cage -------------------------------------------------------------
    for (const sx of [-1,1]) for (const sz of [-1,1]){
      box(0.045, S.cageTop - S.floorY + 0.10, 0.045, chrome,
          sx*(S.inX + 0.02), (S.floorY + S.cageTop)/2, sz*(S.inZ + 0.02));
    }
    const pane = (w,h,x,y,z,ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), glass);
      m.position.set(x,y,z); m.rotation.y = ry; root.add(m);
    };
    const ch = S.cageTop - S.floorY, cy = (S.floorY + S.cageTop)/2;
    pane(S.inX*2, ch, 0, cy,  S.inZ + 0.02, 0);
    pane(S.inZ*2, ch,  S.inX + 0.02, cy, 0,  Math.PI/2);
    pane(S.inZ*2, ch, -S.inX - 0.02, cy, 0,  Math.PI/2);
    // opaque back panel so a row of these reads as a wall of machines
    box(S.inX*2 + 0.05, ch, 0.03,
        new THREE.MeshStandardMaterial({ color:0x1b1c3c, roughness:.7 }),
        0, cy, -S.inZ - 0.03);

    // --- marquee ----------------------------------------------------------
    box(S.width, 0.30, S.depth, trim, 0, 1.75, 0);
    const mq = new THREE.Mesh(new THREE.PlaneGeometry(S.width - 0.06, 0.22),
      new THREE.MeshStandardMaterial({ map: this._marqueeTexture(),
        emissive:0xffffff, emissiveMap:this._marqueeTexture(),
        emissiveIntensity:1.3, roughness:.6 }));
    mq.position.set(0, 1.75, S.depth/2 + 0.004);
    root.add(mq);
    box(S.width + 0.03, 0.04, S.depth + 0.03, trim, 0, 1.90, 0);

    // The gantry, cable, head, prong meshes and the two buttons are all built
    // by ClawRig — see the constructor. Only the BLADES are ours: a 二本爪 has
    // broad flat plates where the three-prong has thin hooks, and that is the
    // one part of the claw that is specific to this cabinet.

    // coin slot
    const coin = box(0.055, 0.075, 0.02, this.MAT.dark, -0.30, 0.50, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x220a12, emissive:0xff2f6e, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.30, 0.445, S.depth/2 + 0.012);
    root.add(this.coinLamp);

    // prize delivery mouth
    box(0.26, 0.20, 0.02, this.MAT.dark, -0.28, 0.20, S.depth/2 - 0.005);
  }

  _marqueeTexture(){
    if (this._mqTex) return this._mqTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#ff2f7f'); grd.addColorStop(.55, '#ff8ac4'); grd.addColorStop(1, '#ffd166');
    g.fillStyle = '#0b0720'; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
    g.globalAlpha = .18; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(560,0); g.lineTo(780,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 110px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(10,6,26,.85)';
    g.strokeText('二本爪', 512, 104); g.fillStyle = '#fff'; g.fillText('二本爪', 512, 104);
    g.font = 'bold 36px ui-monospace, monospace';
    g.fillText('TWO-PRONG  ·  ¥100', 512, 196);
    this._mqTex = new THREE.CanvasTexture(c);
    this._mqTex.colorSpace = THREE.SRGBColorSpace;
    return this._mqTex;
  }

  /* ------------------------------------------------------- interactions -- */
  reset(){
    for (const b of this.prizes){ this.world.remove(b); this.prizeLayer.remove(b.mesh); }
    this.prizes.length = 0;
    this.rig.reset();
    this._loadPrizes(this.opts.prizes);
  }

  /* ------------------------------------------------------------- update -- */
  update(dt){
    this.world.step(dt, h => this.rig.stepMechanism(h));
    this.rig.integrateHinges(this.world.cfg.fixedDt);
    this.rig.sync();
    this._syncBlades();

    this.coinLamp.material.emissiveIntensity = this.rig.credit > 0
      ? 1.6 + Math.sin(performance.now()*0.006)*0.6 : 0;
    this.rim.material.emissiveIntensity = 1.6 + Math.sin(performance.now()*0.003)*0.7;

    for (const b of this.prizes) if (!b.won) b.syncMesh();
    this._checkPrizes();
    if (this.debug && this.debug.visible) this.updateDebug();
  }

  /**
   * The broad flat plates that make this read as a 二本爪 rather than a crane
   * with two of the three-prong's hooks. Purely visual — the collision prong is
   * the rig's capsule pair — so they are built and posed here rather than being
   * pushed into ClawRig for one cabinet's sake.
   */
  _buildBlades(){
    this.blades = this.rig.prongs.map(() => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.10, 0.075), this.rig.chrome);
      this.root.add(b);
      return b;
    });
  }
  _syncBlades(){
    for (let i = 0; i < this.blades.length; i++){
      const p = this.rig.prongs[i], m = this.rig.prongMeshes[i];
      _u.copy(p.lower.b).sub(p.lower.a);
      this.blades[i].position.copy(p.lower.a).addScaledVector(_u, 0.5);
      this.blades[i].quaternion.copy(m.lower.quaternion);
    }
  }

  _checkPrizes(){
    const C = SPEC.chute;
    for (const b of this.prizes){
      if (b.won) continue;
      if (b.pos.y < SPEC.floorY - 0.10 &&
          b.pos.x > C.x0 - 0.05 && b.pos.x < C.x1 + 0.05 &&
          b.pos.z > C.z0 - 0.05 && b.pos.z < C.z1 + 0.05){
        b.won = true;
        this.wins++;
        this.collected.push(b.prize);
        if (this.onWin) this.onWin(b.prize);
      }
    }
  }

  /* --------------------------------------------------------------- debug -- */
  buildDebug(){
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color:0x00ff9d, wireframe:true,
      transparent:true, opacity:.4, depthTest:false });
    const hot = new THREE.MeshBasicMaterial({ color:0xff3d8b, wireframe:true,
      transparent:true, opacity:.8, depthTest:false });
    for (const c of this.world.colliders){
      if (c instanceof BoxCollider){
        const m = new THREE.Mesh(new THREE.BoxGeometry(c.h.x*2, c.h.y*2, c.h.z*2),
          c === this.hub ? hot : mat);
        m.position.copy(c.c); m.quaternion.copy(c.q);
        if (c === this.hub) this._dbgHub = m;
        g.add(m);
      }
    }
    this.rig.buildDebug(g, hot);
    g.renderOrder = 999;
    this.debug = g;
    this.root.add(g);
    return g;
  }
  updateDebug(){
    if (!this.debug || !this.debug.visible) return;
    if (this._dbgHub) this._dbgHub.position.copy(this.hub.c);
    this.rig.updateDebug();
  }
}

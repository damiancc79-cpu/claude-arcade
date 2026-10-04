/* ============================================================================
   machines/push.js — 押し出し (oshidashi), the push setting. No claw at all.

   The head carries a single chromed FINGER. It comes down behind a prize and
   strokes forward, and that is the entire mechanism — nothing opens, nothing
   grips, nothing is ever lifted. Prizes lie flat on a shelf and have to be
   walked forward over its open front edge:

          finger ↓
              │
              ▓▓▓▓▓▓▓▓  ──────►            ┊ open edge
        ══════════════════════════════════╛
                                            ▼ well

   The reason to build it after four cranes is that it removes the variable
   every other cabinet here turns on. There is no grip to survive, no hold to
   set, no cable swing to fight. A play is a position and nothing else, and the
   only thing a position buys you is WHERE ON THE PRIZE the finger lands.

   Dead centre and the prize slides straight forward. Off centre and the same
   stroke spends itself spinning the prize instead of advancing it — the further
   out, the more of the push goes into rotation and the less into travel, until
   far enough out the finger simply sweeps past the corner and the play is worth
   nothing. That trade is the whole game, and it is emergent: a point finger
   against a box is a torque, and the solver does the rest.

   NO NEW BOT. `BENCH.bot` was written for ClawRig, but what it actually drives
   is the two-button gantry — phases named `aimX`/`aimZ`, a `gx`/`gz` carriage,
   and a coast to compensate for. `PushRig` below exposes exactly that contract
   and the existing, verified driver runs this cabinet unmodified. The claw was
   never the part the bot cared about.

   Model contract: base on y = 0, front facing +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, BoxCollider, CapsuleCollider, PlaneCollider, boxCluster }
  from '../physics.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const _u = new V3(), _w = new V3();

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width : 0.98, depth : 0.92, height: 1.90,

  deckY  : 0.700,
  cageTop: 1.600,
  inX    : 0.420, inZ: 0.380,

  // The shelf, and its open front lip. Everything past `edgeZ` is well.
  deckX  : 0.360, deckBack: -0.340, edgeZ: 0.160,
  binY   : 0.340,

  railY  : 1.500,
  headTop: 1.430,
  // The finger's lower end sits 5 mm over the shelf at full drop, so it strokes
  // through the bottom of a prize's back face rather than over the top of it.
  // Pushing low matters: a finger that lands high tips a flat box onto its face
  // instead of sliding it, and a box on its face has a different footprint and
  // a different answer to every subsequent play.
  headMin: 0.945,

  // THE CARRIAGE MUST REACH THE WHOLE SHELF, and that is a correctness
  // requirement rather than a comfort. A prize shoved into a corner the finger
  // cannot get behind squarely is a prize that can only ever be rotated: with
  // the travel stopping at ±0.300 against a shelf 0.360 wide, one carton ended
  // a 120-play soak parked against the left wall, still on the shelf, 60 mm
  // short of the lip and unwinnable. The limits now cover the shelf's own
  // half-width, so every point a prize can occupy can be struck dead centre.
  //
  // Home is the far LEFT because ➊ only tracks one way: it moves the carriage
  // right from wherever it parks, so parking anywhere else puts part of the
  // shelf permanently out of reach. Same forced handedness as 大型.
  limX   : [-0.340, 0.340],
  limZ   : [-0.300, 0.120],
  homeX  : -0.340, homeZ: 0.120,
};

/**
 * THE FINGER, as a capsule hanging under the head.
 *
 * 18 mm of radius against a 160 mm prize. That ratio is the difficulty: a broad
 * blade would meet the whole back face and push everything square no matter
 * where it was aimed, which is a machine with no aiming in it. A point contact
 * turns every millimetre of offset into torque.
 */
const FINGER = { r: 0.018, top: 0.060, bottom: 0.240 };

/**
 * THE STROKE: how far the carriage drives forward once the finger is down.
 *
 * Short on purpose. At 110 mm a single square hit carried a prize most of the
 * way to the lip and the cabinet was a three-play machine; the stroke has to be
 * a play, not a win. 45 mm is about six clean pushes from the back rank to the
 * edge, which leaves room for the thing this machine is actually about to
 * matter — measured, advance and spin against how far off centre the finger
 * lands on a 160 mm prize:
 *
 *     offset   0    20    40    60    80   100 mm
 *     advance 116   119   112    37    27    0
 *     spin      0     0    -8   -72   -51    —   degrees
 *
 * Inside 40 mm the whole stroke becomes travel. Past that it becomes rotation
 * instead, and past 100 mm — the prize's half-width plus the finger's radius —
 * the finger sweeps by the corner and the play is worth nothing at all. A
 * prize left sitting at an angle is then a harder target than it was, because
 * it presents its 110 mm face instead of its 160 mm one.
 */
const STROKE = 0.045;

const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

const BOX = { hx: 0.080, hy: 0.025, hz: 0.055 };

export const PRIZE_TYPES = [
  { key:'plate',  jp:'アクリルプレート', en:'ACRYLIC PANEL', color:0x6ec3ff },
  { key:'book',   jp:'アートブック',     en:'ART BOOK',      color:0xff6b8a },
  { key:'disc',   jp:'サウンドトラック', en:'SOUNDTRACK',    color:0x7ce38b },
  { key:'case',   jp:'コレクションケース', en:'DISPLAY CASE', color:0xffd166 },
  { key:'poster', jp:'ポスターセット',   en:'POSTER SET',    color:0xc792ea },
  { key:'card',   jp:'カードセット',     en:'CARD SET',      color:0xff9f6e },
];

/** Deterministic RNG, so a restock lays the shelf out the same way. */
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================== the rig === */
/**
 * The two-button gantry, with a pusher on it instead of a claw.
 *
 * Deliberately the same public shape as `ClawRig` — `phase`, `gx`/`gz`,
 * `vx`/`vz`, `cfg.limX/limZ/homeX/homeZ/moveSpeed`, `insertCoin`, `pressA`,
 * `pressB`, `plays` — because that, not the claw, is what `BENCH.bot` drives.
 *
 * The play cycle is the same authentic scheme as every other cabinet: hold ➊ to
 * track right, release to lock; hold ➋ to track back, release and the machine
 * takes over. What it takes over with is different — drop, stroke, lift, return.
 */
export class PushRig {
  constructor(world, root, cfg){
    this.world = world; this.root = root; this.cfg = cfg;
    this.picks = [];

    this.credit = 0; this.plays = 0;
    this.phase = 'idle'; this.t = 0;
    this.pressedA = false; this.pressedB = false;
    this.btnA = false; this.btnB = false;
    this.onPhase = null;

    this.gx = cfg.homeX; this.gz = cfg.homeZ;
    this.vx = 0; this.vz = 0;
    this.y = cfg.headTop; this.vy = 0;
    this.strokeFrom = 0;
    this.resist = 0;
    this.headPos = new V3();
    this.headVel = new V3();

    // The finger. Kinematic, so the shelf never pushes it back — but the
    // STROKE is force-limited below, which is where the give comes from.
    this.finger = world.addCollider(new CapsuleCollider(
      [0,0,0], [0,0,0], FINGER.r, { friction: 0.30, restitution: 0.04 }));
    this.finger.kinematic = true;
    this.finger.reaction = new V3();
    this.finger.pointVel = (p, out) => out.copy(this.headVel);

    this._buildVisuals();
    this.poseHead();
  }

  _buildVisuals(){
    const cfg = this.cfg, root = this.root;
    const chrome = new THREE.MeshStandardMaterial({ color:0xc8d0e2, roughness:.22, metalness:.95 });
    const trim   = new THREE.MeshStandardMaterial({ color:0x15202e, roughness:.45, metalness:.7 });
    for (const sx of [-1, 1]){
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, cfg.inZ*2, 10), chrome);
      r.rotation.x = Math.PI/2;
      r.position.set(sx*(cfg.inX - 0.02), cfg.railY, 0);
      root.add(r);
    }
    this.bridge = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.inX*2 - 0.02, 0.035, 0.07), trim);
    root.add(this.bridge);
    this.carriage = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.10), trim);
    root.add(this.carriage);
    this.mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), chrome);
    root.add(this.mast);

    this.head = new THREE.Group();
    root.add(this.head);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.09), trim);
    block.position.y = 0.02; this.head.add(block);
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(FINGER.r, FINGER.r, FINGER.bottom - FINGER.top, 12), chrome);
    rod.position.y = -(FINGER.top + FINGER.bottom)/2;
    this.head.add(rod);
    const pad = new THREE.Mesh(new THREE.SphereGeometry(FINGER.r*1.05, 12, 10),
      new THREE.MeshStandardMaterial({ color:0x1a1a22, roughness:.95 }));
    pad.position.y = -FINGER.bottom;
    this.head.add(pad);
    this.lamp = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.008, 8, 20),
      new THREE.MeshStandardMaterial({ color:0x37e6ff, emissive:0x37e6ff,
        emissiveIntensity:1.4, roughness:.4 }));
    this.lamp.rotation.x = Math.PI/2;
    this.lamp.position.y = 0.05;
    this.head.add(this.lamp);
  }

  buildButtons(dx, y, z){
    const trim = new THREE.MeshStandardMaterial({ color:0x15202e, roughness:.45, metalness:.7 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(dx*3.8, 0.13, 0.03), trim);
    plate.position.set(0, y, z - 0.020);
    this.root.add(plate);
    this.buttons = [];
    for (const [i, sx] of [-1, 1].entries()){
      const g = new THREE.Group();
      g.position.set(sx * dx, y, z);
      this.root.add(g);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.016, 20), trim);
      rim.rotation.x = Math.PI/2;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.020, 20),
        new THREE.MeshStandardMaterial({
          color: i ? 0x2b6fff : 0xff2f4f, emissive: i ? 0x1030a0 : 0xa01020,
          emissiveIntensity: 0.6, roughness:.35 }));
      cap.rotation.x = Math.PI/2; cap.position.z = 0.010;
      g.add(rim, cap);
      const tag = i ? 'btnB' : 'btnA';
      cap.userData.pick = tag; rim.userData.pick = tag;
      this.picks.push(cap, rim);
      this.buttons.push({ cap, base: 0.010 });
    }
  }

  insertCoin(){
    if (this.credit >= 1 || this.busy) return false;
    this.credit = 1; this.phase = 'aimX'; this.t = 0;
    this.pressedA = this.pressedB = false;
    this._emit();
    return true;
  }
  pressA(down){ this.btnA = down; }
  pressB(down){ this.btnB = down; }
  _emit(){ if (this.onPhase) this.onPhase(this.phase); }
  get busy(){ return this.phase !== 'idle' && this.phase !== 'aimX' && this.phase !== 'aimZ'; }
  get aiming(){ return this.phase === 'aimX' || this.phase === 'aimZ'; }

  reset(){
    this.phase = 'idle'; this.credit = 0;
    this.gx = this.cfg.homeX; this.gz = this.cfg.homeZ;
    this.vx = this.vz = 0; this.y = this.cfg.headTop; this.vy = 0;
    this.resist = 0;
  }

  poseHead(){
    this.headPos.set(this.gx, this.y, this.gz);
    this.headVel.set(this.vx, this.vy, this.vz);
    this.finger.a.set(this.gx, this.y - FINGER.top, this.gz);
    this.finger.b.set(this.gx, this.y - FINGER.bottom, this.gz);
  }

  /** One fixed substep. Call from inside World.step(). */
  stepMechanism(h){
    const cfg = this.cfg;
    const MOVE = cfg.moveSpeed ?? 0.34, ACC = 3.2, DRAG = 8;
    let ax = 0, az = 0, targetVy = 0, driveZ = false;

    switch (this.phase){
      case 'idle': break;
      case 'aimX':
        this.t += h;
        if (this.btnA){ ax = 1; this.pressedA = true; }
        else if (this.pressedA || this.t > 20){ this.phase = 'aimZ'; this.t = 0; this._emit(); }
        break;
      case 'aimZ':
        this.t += h;
        if (this.btnB){ az = -1; this.pressedB = true; }
        else if (this.pressedB || this.t > 20){
          this.phase = 'drop'; this.t = 0; this._emit();
        }
        break;
      case 'drop':
        targetVy = -(cfg.dropSpeed ?? 0.42);
        if (this.y <= cfg.headMin + 0.001){
          this.phase = 'push'; this.t = 0;
          this.strokeFrom = this.gz;
          this._emit();
        }
        break;
      case 'push':
        // THE STROKE. Force-limited rather than a scripted slide: the carriage
        // aims for `strokeSpeed` and gives it up in proportion to what the
        // finger is pushing against, so a prize that will not move stalls the
        // stroke instead of being teleported forward by a kinematic collider.
        driveZ = true;
        this.t += h;
        if (this.gz - this.strokeFrom >= (cfg.stroke ?? STROKE) ||
            this.gz >= cfg.limZ[1] - 0.001 || this.t > 6){
          this.phase = 'lift'; this.t = 0; this._emit();
        }
        break;
      case 'lift':
        targetVy = 0.45;
        if (this.y >= cfg.headTop - 0.004){ this.phase = 'return'; this.t = 0; this._emit(); }
        break;
      case 'return': {
        this.t += h;
        const dx = cfg.homeX - this.gx, dz = cfg.homeZ - this.gz;
        ax = Math.max(-0.7, Math.min(0.7, dx*4.0 - this.vx*1.7));
        az = Math.max(-0.7, Math.min(0.7, dz*4.0 - this.vz*1.7));
        if ((Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01 &&
             Math.abs(this.vx) < 0.05 && Math.abs(this.vz) < 0.05) || this.t > 8){
          this.phase = 'idle'; this.credit = 0; this.plays++; this._emit();
        }
        break;
      }
    }

    // how hard the finger is pressing on the world, smoothed — the same trick
    // ClawRig uses on its hoist
    const react = Math.hypot(this.finger.reaction.x, this.finger.reaction.z);
    const rNow = Math.max(0, Math.min(1, (react / h) / 22));
    this.resist += (rNow - this.resist) * Math.min(1, 14*h);

    if (driveZ){
      const target = (this.cfg.strokeSpeed ?? 0.18) * (1 - this.resist);
      this.vz += (target - this.vz) * Math.min(1, 10*h);
    } else {
      this.vz += az * ACC * h;
      if (az === 0) this.vz -= this.vz * Math.min(1, DRAG*h);
      this.vz = Math.max(-MOVE, Math.min(MOVE, this.vz));
    }
    this.vx += ax * ACC * h;
    if (ax === 0) this.vx -= this.vx * Math.min(1, DRAG*h);
    this.vx = Math.max(-MOVE, Math.min(MOVE, this.vx));

    this.gx += this.vx * h; this.gz += this.vz * h;
    if (this.gx < cfg.limX[0]){ this.gx = cfg.limX[0]; this.vx = 0; }
    if (this.gx > cfg.limX[1]){ this.gx = cfg.limX[1]; this.vx = 0; }
    if (this.gz < cfg.limZ[0]){ this.gz = cfg.limZ[0]; this.vz = 0; }
    if (this.gz > cfg.limZ[1]){ this.gz = cfg.limZ[1]; this.vz = 0; }

    this.vy += (targetVy - this.vy) * Math.min(1, 12*h);
    this.y += this.vy * h;
    if (this.y < cfg.headMin){ this.y = cfg.headMin; this.vy = Math.max(0, this.vy); }
    if (this.y > cfg.headTop){ this.y = cfg.headTop; this.vy = Math.min(0, this.vy); }

    this.poseHead();
  }

  sync(){
    const cfg = this.cfg;
    this.bridge.position.set(0, cfg.railY, this.gz);
    this.carriage.position.set(this.gx, cfg.railY - 0.05, this.gz);
    this.head.position.copy(this.headPos);
    _u.set(this.gx, cfg.railY - 0.05, this.gz).sub(this.headPos);
    const len = _u.length();
    this.mast.position.copy(this.headPos).addScaledVector(_u, 0.5);
    this.mast.scale.set(1, len, 1);
    _w.copy(_u).normalize();
    this.mast.quaternion.setFromUnitVectors(UP, _w);
    if (this.buttons){
      for (const [i, b] of this.buttons.entries()){
        const down = i ? this.btnB : this.btnA;
        b.cap.position.z = b.base - (down ? 0.008 : 0);
        b.cap.material.emissiveIntensity = down ? 1.6 : 0.6;
      }
    }
    this.lamp.material.emissiveIntensity = this.phase === 'push' ? 3.0
      : this.busy ? 2.2 : 1.1;
  }

  buildDebug(group, mat){
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(FINGER.r, 1, 4, 8), mat);
    group.add(m); this._dbg = m;
  }
  updateDebug(){
    if (!this._dbg) return;
    _u.copy(this.finger.b).sub(this.finger.a);
    const L = _u.length();
    this._dbg.position.copy(this.finger.a).addScaledVector(_u, 0.5);
    _w.copy(_u).normalize();
    this._dbg.quaternion.setFromUnitVectors(UP, _w);
    this._dbg.scale.set(1, Math.max(0.001, L), 1);
  }
}

/* ---------------------------------------------------------------- art ---- */
const artCache = new Map();
function faceArt(type){
  if (artCache.has(type.key)) return artCache.get(type.key);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 352;
  const g = c.getContext('2d');
  g.fillStyle = '#' + type.color.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 512, 352);
  const grd = g.createLinearGradient(0, 0, 512, 352);
  grd.addColorStop(0, 'rgba(255,255,255,.45)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 352);
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 7;
  g.strokeRect(28, 28, 456, 296);
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 44px ${JP_FONT}`;
  g.fillText(type.jp, 256, 158);
  g.font = 'bold 22px ui-monospace, monospace';
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillText(type.en, 256, 214);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  artCache.set(type.key, tex);
  return tex;
}

function makePrize(type){
  const g = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ color: type.color, roughness:.6, metalness:.06 });
  const face = new THREE.MeshStandardMaterial({ map: faceArt(type), roughness:.5, metalness:.06 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(BOX.hx*2, BOX.hy*2, BOX.hz*2),
    [side, side, face, side, side, side]));
  return { group: g, spheres: boxCluster([BOX.hx, BOX.hy, BOX.hz], 0.025) };
}

/* ============================================================== machine === */
export class PushMachine {
  constructor(opts = {}){
    this.opts = { prizes: 5, seed: 0, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'push-machine';
    this.world = new World({ gravity: -9.81, velIters: 12, posIters: 4 });

    this.prizes = [];
    this.picks = [];
    this.collected = [];
    this.wins = 0;
    this.onWin = null;
    this.onPhase = null;

    this._buildVisuals();
    this._buildColliders();

    this.rig = new PushRig(this.world, this.root, {
      inX: SPEC.inX, inZ: SPEC.inZ,
      railY: SPEC.railY, headTop: SPEC.headTop, headMin: SPEC.headMin,
      limX: SPEC.limX, limZ: SPEC.limZ, homeX: SPEC.homeX, homeZ: SPEC.homeZ,
      moveSpeed: 0.34, dropSpeed: 0.42,
      stroke: STROKE, strokeSpeed: 0.18,
    });
    this.rig.buildButtons(0.11, 0.520, SPEC.depth/2 + 0.016);
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
    const W = this.world, S = SPEC;
    const deck  = { friction: 0.34, restitution: 0.02 };
    const glass = { friction: 0.20, restitution: 0.10 };

    // the shelf
    W.addCollider(new BoxCollider(
      [0, S.deckY - 0.02, (S.deckBack + S.edgeZ)/2],
      [S.deckX, 0.02, (S.edgeZ - S.deckBack)/2], null, deck));
    // side walls and a back wall — a prize can only ever leave over the FRONT
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.deckX + 0.012), S.deckY + 0.035, (S.deckBack + S.edgeZ)/2],
      [0.012, 0.035, (S.edgeZ - S.deckBack)/2], null, deck));
    W.addCollider(new BoxCollider([0, S.deckY + 0.035, S.deckBack - 0.012],
      [S.deckX, 0.035, 0.012], null, deck));

    // cage
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.03), 1.10, 0], [0.03, 0.52, S.inZ + 0.03], null, glass));
    for (const sz of [-1, 1]) W.addCollider(new BoxCollider(
      [0, 1.10, sz*(S.inZ + 0.03)], [S.inX + 0.03, 0.52, 0.03], null, glass));
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));

    // catch bin under the well + a floor of last resort
    W.addCollider(new BoxCollider([0, S.binY, (S.edgeZ + S.inZ)/2],
      [S.inX, 0.02, (S.inZ - S.edgeZ)/2], null, { friction: 0.5, restitution: 0.04 }));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  _loadPrizes(n){
    const S = SPEC;
    const rand = rng(this.opts.seed * 977 + 13);
    // Two ranks, well back from the lip. Nothing is stocked near the edge: a
    // prize seeded there is won by the first stroke that touches it and the
    // cabinet's play count stops meaning anything.
    const slots = [];
    for (const z of [-0.240, -0.090]) for (const x of [-0.210, 0, 0.210]) slots.push([x, z]);
    for (let i = 0; i < n && i < slots.length; i++){
      const t = PRIZE_TYPES[(this.opts.seed + i) % PRIZE_TYPES.length];
      const art = makePrize(t);
      const b = new Body(art.spheres, {
        mass: 0.5, friction: 0.45, restitution: 0.02,
        linDamp: 0.25, angDamp: 2.2,
      });
      b.tag = 'prize';
      b.prize = { ...t };
      b.won = false;
      const [sx, sz] = slots[i];
      b.setPos(sx + (rand()-0.5)*0.02, S.deckY + BOX.hy + 0.004, sz + (rand()-0.5)*0.02);
      b.quat.setFromAxisAngle(UP, (rand()-0.5)*0.25);
      b.updateTransform();
      const holder = new THREE.Group();
      art.group.position.copy(b.comOffset).negate();
      holder.add(art.group);
      holder.userData.pick = 'prize';
      b.mesh = holder;
      this.prizeLayer.add(holder);
      this.world.add(b);
      this.prizes.push(b);
    }
    for (let i = 0; i < 240; i++) this.world.substep(this.world.cfg.fixedDt);
    for (const b of this.prizes) b.syncMesh();
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const S = SPEC, root = this.root;
    this.prizeLayer = new THREE.Group();
    root.add(this.prizeLayer);

    const body   = new THREE.MeshStandardMaterial({ color:0x1d2b3a, roughness:.46, metalness:.34 });
    const trim   = new THREE.MeshStandardMaterial({ color:0xff8f3f, roughness:.38, metalness:.45 });
    const dark   = new THREE.MeshStandardMaterial({ color:0x0a121b, roughness:.86 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xdfe7f5, roughness:.18, metalness:.95 });
    const deckM  = new THREE.MeshStandardMaterial({ color:0x2f4356, roughness:.6, metalness:.28 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    this.MAT = { body, trim, dark, chrome, deckM, glass };

    const box = (w,h,d,m,x,y,z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); root.add(o); return o;
    };

    box(S.width, 0.62, S.depth, body, 0, 0.31, 0);
    const cw = 0.07, CW = S.width + 0.02, CD = S.depth + 0.02;
    for (const sz of [-1, 1]) box(CW, 0.05, cw, trim, 0, 0.640, sz*(CD - cw)/2);
    for (const sx of [-1, 1]) box(cw, 0.05, CD - cw*2, trim, sx*(CW - cw)/2, 0.640, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, dark, 0, 0.040, 0);

    // the shelf and its rails, with the front lip picked out — the edge is the
    // thing the player is aiming at, so it is the brightest line in the cabinet
    box(S.deckX*2, 0.02, S.edgeZ - S.deckBack, deckM, 0, S.deckY - 0.01,
        (S.deckBack + S.edgeZ)/2);
    for (const sx of [-1, 1])
      box(0.024, 0.07, S.edgeZ - S.deckBack, trim, sx*(S.deckX + 0.012),
          S.deckY + 0.035, (S.deckBack + S.edgeZ)/2);
    box(S.deckX*2, 0.07, 0.024, trim, 0, S.deckY + 0.035, S.deckBack - 0.012);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(S.deckX*2, 0.012, 0.016),
      new THREE.MeshStandardMaterial({ color:0xff8f3f, emissive:0xff8f3f,
        emissiveIntensity:1.6, roughness:.4 }));
    lip.position.set(0, S.deckY - 0.006, S.edgeZ + 0.008);
    root.add(lip);
    this.lip = lip;

    // the well
    box(S.inX*2, 0.30, S.inZ - S.edgeZ,
      new THREE.MeshStandardMaterial({ color:0x05090f, roughness:1 }),
      0, S.deckY - 0.19, (S.edgeZ + S.inZ)/2);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(S.inX*1.94, (S.inZ - S.edgeZ)*0.9),
      new THREE.MeshStandardMaterial({ color:0xff8f3f, emissive:0xff8f3f,
        emissiveIntensity:0.7, roughness:.5, transparent:true, opacity:.20 }));
    glow.rotation.x = -Math.PI/2;
    glow.position.set(0, S.binY + 0.012, (S.edgeZ + S.inZ)/2);
    root.add(glow);
    this.wellGlow = glow;
    box(S.inX*2, 0.02, S.inZ - S.edgeZ, deckM, 0, S.binY, (S.edgeZ + S.inZ)/2);

    for (const sx of [-1,1]) for (const sz of [-1,1]){
      box(0.045, S.cageTop - 0.60, 0.045, chrome,
          sx*(S.inX + 0.02), (0.60 + S.cageTop)/2, sz*(S.inZ + 0.02));
    }
    const pane = (w,h,x,y,z,ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), glass);
      m.position.set(x,y,z); m.rotation.y = ry; root.add(m);
    };
    const ch = S.cageTop - 0.62, cy = (0.62 + S.cageTop)/2;
    pane(S.inX*2, ch, 0, cy,  S.inZ + 0.02, 0);
    pane(S.inZ*2, ch,  S.inX + 0.02, cy, 0, Math.PI/2);
    pane(S.inZ*2, ch, -S.inX - 0.02, cy, 0, Math.PI/2);
    box(S.inX*2 + 0.05, ch, 0.03,
      new THREE.MeshStandardMaterial({ color:0x16222f, roughness:.75 }),
      0, cy, -S.inZ - 0.03);

    box(S.width, 0.30, S.depth, trim, 0, 1.75, 0);
    const tex = this._marqueeTexture();
    const mq = new THREE.Mesh(new THREE.PlaneGeometry(S.width - 0.06, 0.22),
      new THREE.MeshStandardMaterial({ map: tex, emissive:0xffffff, emissiveMap: tex,
        emissiveIntensity:1.35, roughness:.6 }));
    mq.position.set(0, 1.75, S.depth/2 + 0.004);
    root.add(mq);
    box(S.width + 0.03, 0.04, S.depth + 0.03, trim, 0, 1.90, 0);

    const coin = box(0.055, 0.075, 0.02, dark, -0.30, 0.420, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x2a1405, emissive:0xff8f3f, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.30, 0.365, S.depth/2 + 0.012);
    root.add(this.coinLamp);
    box(0.30, 0.22, 0.02, dark, 0, 0.180, S.depth/2 - 0.005);
  }

  _marqueeTexture(){
    if (this._mqTex) return this._mqTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#ff8f3f'); grd.addColorStop(.5, '#ffd166'); grd.addColorStop(1, '#37e6ff');
    g.fillStyle = '#0a121b'; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
    g.globalAlpha = .18; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(560,0); g.lineTo(780,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 112px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(10,18,27,.85)';
    g.strokeText('押し出し', 512, 100);
    g.fillStyle = '#fff'; g.fillText('押し出し', 512, 100);
    g.font = `bold 34px ${JP_FONT}`;
    g.fillText('PUSH  ·  ¥100', 512, 196);
    this._mqTex = new THREE.CanvasTexture(c);
    this._mqTex.colorSpace = THREE.SRGBColorSpace;
    return this._mqTex;
  }

  /* ------------------------------------------------------------- update -- */
  update(dt){
    this.world.step(dt, h => this.rig.stepMechanism(h));
    this.rig.sync();

    this.coinLamp.material.emissiveIntensity = this.rig.credit > 0
      ? 1.6 + Math.sin(performance.now()*0.006)*0.6 : 0;
    this.wellGlow.material.emissiveIntensity = 0.6 + Math.sin(performance.now()*0.003)*0.3;

    for (const b of this.prizes) if (!b.won) b.syncMesh();
    this._checkPrizes();
    if (this.debug && this.debug.visible) this.updateDebug();
  }

  _checkPrizes(){
    const S = SPEC;
    for (const b of this.prizes){
      if (b.won) continue;
      if (b.pos.z > S.edgeZ && b.pos.y < S.deckY - 0.10){
        b.won = true;
        this.wins++;
        this.collected.push(b.prize);
        if (this.onWin) this.onWin(b.prize);
      }
    }
  }

  /** How far the closest live prize still is from the lip, in metres. */
  get nearest(){
    let best = null;
    for (const b of this.prizes){
      if (b.won) continue;
      const d = SPEC.edgeZ - b.pos.z;
      if (best === null || d < best) best = d;
    }
    return best;
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
      if (!(c instanceof BoxCollider)) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(c.h.x*2, c.h.y*2, c.h.z*2), mat);
      m.position.copy(c.c); m.quaternion.copy(c.q);
      g.add(m);
    }
    this._dbgPrizes = [];
    for (const b of this.prizes) for (const s of b.spheres){
      const m = new THREE.Mesh(new THREE.SphereGeometry(s.r, 10, 8), mat);
      g.add(m); this._dbgPrizes.push({ m, s });
    }
    this.rig.buildDebug(g, hot);
    g.renderOrder = 999;
    this.debug = g;
    this.root.add(g);
    return g;
  }
  updateDebug(){
    if (!this.debug || !this.debug.visible) return;
    for (const d of this._dbgPrizes) d.m.position.copy(d.s.w);
    this.rig.updateDebug();
  }
}

/* ============================================================================
   machines/seesaw.js — シーソー (shiisoo), the balance setting.

   The playfield is not a deck. It is a single sprung platform on a hinge across
   the cabinet, and everything on it weighs on one side of that hinge or the
   other:

                     ┌──────────────────────────────┐
        back lip →   │▓▓  ▓▓  ▓▓                    │  ← open front edge
                     └───────────────▲──────────────┘
                                   pivot        │
                                                ▼  delivery well

   Stocked, the prizes sit behind the pivot and the platform rests tipped back
   against them. Every play drags one a few centimetres forward. Nothing happens
   for a while — and then enough weight is forward of the hinge that the platform
   starts to come level, which slides the prizes further forward, which tips it
   further. The end of the machine is an avalanche: the platform goes over and
   everything on it slides off the front edge at once.

   That last part is the whole reason to build it. Every other cabinet on this
   floor pays out one prize for one successful play. This one pays out whatever
   happens to be on the platform, and the player can see it coming.

   NO PART OF THAT IS SCRIPTED. There is no tilt counter and no dump animation:
   the platform is a `physics.Arm` carrying real load through real contacts, and
   the runaway is positive feedback between the tilt and where the prizes slide.

   THE ONE THING THE ENGINE COULD NOT DO is a mechanical stop. `Arm` has joint
   limits, but they are applied when the angle is integrated — AFTER the solve —
   so the solver never knows they are there and an arm resting on one cannot
   support what is standing on it. Built that way first: a box on a level
   platform slid steadily backwards at 50 mm/s and off the back edge, because
   each substep the counterweight drove the arm into its stop, the collider
   reported the surface velocity of a rotation that was about to be clamped away,
   and the box was dragged by a platform that never actually moved. Zeroing the
   velocity before the solve as well does not fix it — the arm still cannot carry
   the load, because nothing in the solve knows the stop exists.

   So this platform has no mechanical stop. What holds it is a SPRING, which is a
   load-bearing constraint the solver can see, because it acts through the arm's
   own inertia every substep. Same box, same platform: 3 mm of drift instead of
   240, and it settles at a real equilibrium angle.

   A plain torsion spring is not enough either — it has no threshold, so the
   platform simply deflects in proportion to whichever way it is loaded, and the
   stocked prizes put it on its backward limit. What works is a constant
   COUNTERWEIGHT for the threshold plus a stiff one-sided spring as the rubber
   pad it rests on. See PLATE below; both findings are gotchas 17 and 18.

   Uses the shared ClawRig, two prongs across the drag axis.
   Model contract: base on y = 0, front facing +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, Arm, BoxCollider, PlaneCollider, boxCluster } from '../physics.js';
import { ClawRig } from './clawrig.js';

const V3 = THREE.Vector3;
const AXIS = new V3(1, 0, 0);          // the hinge runs across the cabinet

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width : 0.98, depth : 0.92, height: 1.90,

  cageTop: 1.600,
  inX    : 0.420, inZ: 0.380,

  // THE HINGE, hard against the back of the playfield, and its position is the
  // machine. Built the other way first — hinge near the middle, prizes stocked
  // on a long rear arm — and the balance was simply unreachable: the stocked
  // load sat a mean 200 mm behind the hinge, about −8.8 N·m against a +1.5 N·m
  // threshold, so the whole load had to travel 195 mm forward before anything
  // could happen. At the 5–23 mm a play the claw manages that is not a grind,
  // it is a wall. Sixty plays moved the tilt one degree and won nothing.
  //
  // Put the hinge behind the prizes instead and both halves of the sum improve
  // at once: the stocked moment shrinks to −1.2 N·m because the cartons are
  // only 45 mm behind the pivot, and the arm in front of them is now 330 mm of
  // leverage instead of 200. One carton dragged to the front edge is enough.
  pivotY : 0.700, pivotZ: -0.180,

  // Everything forward of this is the delivery well — open all the way down,
  // and it starts UNDER the platform's front half rather than beyond its edge.
  // A tipped platform's front edge swings back as it drops (at 40° this one
  // retreats from z 0.150 to 0.073), so a well that begins past the resting
  // edge is a well the avalanche misses entirely.
  wellZ  : 0.030,
  binY   : 0.340,

  railY  : 1.500,
  headTop: 1.430,
  // The prong tips hang 256 mm under the head when open, which puts them at
  // 0.744 — the middle of a carton standing on a level platform. The platform is
  // rarely level, so the cartons at the back of a tipped-back platform sit lower
  // and are harder to get a grip on than the ones at the front. That is a
  // difficulty gradient the machine gets for free from its own geometry.
  headMin: 1.000,

  limX   : [-0.300, 0.290],
  limZ   : [-0.280, 0.120],
  homeX  : -0.280, homeZ: 0.110,       // parked at the front edge, not over the well
};

/**
 * THE PLATFORM, in metres relative to the hinge.
 *
 * The deck, the back lip and both side walls are four separate colliders that
 * all share ONE `Arm`. Nothing about that is special-cased in the engine —
 * a collider participates in a hinge simply by carrying `.arm`, so an assembly
 * is just several of them repositioned from the same angle each substep.
 *
 * The lip and the walls are not decoration. A tipped-back platform is a slope,
 * and a slope with an open bottom edge is a machine that unloads itself onto the
 * floor before the player has put a coin in.
 */
/*
 * The front arm deliberately reaches 110 mm FURTHER FORWARD than the claw can,
 * and that one number decides what kind of machine this is. At a shorter front
 * arm the claw could drag a carton clean over the front edge on its own, and it
 * did: six of eight first payouts were a single prize toppled off the end rather
 * than the platform going over, so the avalanche — the entire reason to build a
 * balance — was the minority outcome. Put the edge out of reach and the claw
 * cannot deliver anything by itself. The only way to be paid is to tip it.
 */
export const PLATE = {
  back: -0.110, front: 0.410, hx: 0.340, t: 0.020,
  /**
   * Height of the back lip and the side walls, and it has to CLEAR THE PRIZE.
   *
   * At 70 mm against a 90 mm carton it did not, and that was the cabinet's one
   * stall: a carton went over the back, dropped past the cage glass — which
   * only starts at y 0.58 — and came to rest on the cabinet floor at z −0.431,
   * behind a platform whose back edge is at −0.290. Probed there it moved 0 mm
   * in both axes, because nothing in the machine can reach it. Worse than the
   * lost prize is what it does to the rest of the session: the bot keeps
   * cycling onto it and spends a third of its plays pushing at something that
   * cannot move.
   *
   * 105 mm is over the carton's own height, so there is no orientation it can
   * be shoved or flung out in.
   */
  wall: 0.105,
  /**
   * A COUNTERWEIGHT and a RUBBER STOP, not a torsion spring, and the difference
   * between those two is the whole machine.
   *
   * A plain spring was built first and cannot work, for a reason worth keeping:
   * it resists in proportion to the angle, in BOTH directions, so the tilt it
   * settles at is proportional to the load's moment whichever side of the hinge
   * that load is on. There is no threshold anywhere in it. Tuned soft enough for
   * a forward load to reach the cartons' friction angle, the stocked load —
   * which is bigger, because it is the same cartons further from the hinge —
   * drove it straight onto its backward travel limit at 23°, well past that same
   * friction angle. Everything slid into the back lip on the first frame and the
   * claw then had to drag cartons UP a 23° slope. Fourteen plays moved nothing
   * at all and the tilt never changed by a tenth of a degree.
   *
   * A counterweight is a CONSTANT torque, and constant is what makes a
   * threshold. Below it the platform does not move; above it there is nothing
   * left holding the platform up and it goes over. `stopK` is the rubber pad it
   * rests on, one-sided and stiff, which keeps the resting tilt at a couple of
   * degrees — shallow enough that nothing slides while the machine is idle.
   *
   * `counter` is the difficulty dial and the only one: how many N·m of prize
   * moment must get forward of the hinge before the machine pays out. It GRADES
   * — monotonically, over a 4× range — which is worth saying out loud after
   * リング掛け, where every lever tried was a cliff or did nothing at all. On an
   * earlier front-arm length, median plays to a dump ran 5.5 / 12 / 17 / 37 at
   * counter 1.6 / 2.2 / 3.0 / 6.0.
   *
   * 4.0 is where it ships. 18 sessions: **median 17 plays, mean 17.6, range
   * 7–39**, 17 of them converging inside 50. That is comparable to 三本爪 for a
   * cabinet that hands over FOUR prizes, and it is the only machine on this
   * floor where a single play can empty the whole thing.
   */
  counter: 4.0, stopK: 120, damp: 1.5,
  inertia: 0.055,
  limit: [-0.40, 0.55],                 // travel limits, well clear of anything reached in play
};

const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

const BOX = { hx: 0.070, hy: 0.045, hz: 0.065 };

export const PRIZE_TYPES = [
  { key:'sweets', jp:'お菓子詰め合わせ', en:'SWEETS BOX',   color:0xff6b8a },
  { key:'mug',    jp:'ペアマグカップ',   en:'MUG SET',      color:0x6ec3ff },
  { key:'towel',  jp:'タオルセット',     en:'TOWEL SET',    color:0x7ce38b },
  { key:'snack',  jp:'スナック',         en:'SNACK CRATE',  color:0xffd166 },
  { key:'game',   jp:'ゲームソフト',     en:'GAME SOFTWARE',color:0xc792ea },
  { key:'gadget', jp:'ガジェット',       en:'GADGET BOX',   color:0xff9f6e },
];

/** Deterministic RNG, so a restock lays the platform out the same way. */
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const artCache = new Map();
function boxArt(type){
  if (artCache.has(type.key)) return artCache.get(type.key);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 384;
  const g = c.getContext('2d');
  const hex = '#' + type.color.toString(16).padStart(6, '0');
  g.fillStyle = hex; g.fillRect(0, 0, 512, 384);
  const grd = g.createLinearGradient(0, 0, 512, 384);
  grd.addColorStop(0, 'rgba(255,255,255,.40)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 384);
  g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 8;
  g.strokeRect(34, 34, 444, 316);
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 46px ${JP_FONT}`;
  g.fillText(type.jp, 256, 192);
  g.font = 'bold 22px ui-monospace, monospace';
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillText(type.en, 256, 250);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  artCache.set(type.key, tex);
  return tex;
}

/** One carton: art plus the cluster that matches it. */
function makePrize(type){
  const g = new THREE.Group();
  const tex = boxArt(type);
  const side = new THREE.MeshStandardMaterial({ color: type.color, roughness:.62, metalness:.05 });
  const lid  = new THREE.MeshStandardMaterial({ map: tex, roughness:.55, metalness:.05 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(BOX.hx*2, BOX.hy*2, BOX.hz*2),
    [side, side, lid, side, side, side]));
  return { group: g, spheres: boxCluster([BOX.hx, BOX.hy, BOX.hz], 0.045) };
}

/* ============================================================== machine === */
export class SeesawMachine {
  constructor(opts = {}){
    // `strength` buys a shove, never a carry, and it has to be set against the
    // PLATFORM's friction rather than the carton's weight. At 0.85/0.45 the claw
    // gripped fine and simply slipped: 2.6 N of drag against the 3.5 N it took
    // to slide a carton, so twenty plays moved the front prize three millimetres
    // and the machine looked broken when it was only weak.
    this.opts = { prizes: 4, seed: 0, strength: 1.30, hold: 0.55,
                  counter: PLATE.counter, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'seesaw-machine';
    this.world = new World({ gravity: -9.81, velIters: 14, posIters: 5 });

    this.prizes = [];
    this.picks = [];
    this.collected = [];
    this.wins = 0;
    this.dumps = 0;                    // times the platform has gone over
    this.onWin = null;
    this.onPhase = null;

    // THE HINGE. No motor and no stops — a torsion spring is the whole model.
    this.arm = new Arm(PLATE.inertia);
    this.arm.axis.copy(AXIS);
    this.arm.pivot.set(0, SPEC.pivotY, SPEC.pivotZ);

    this._buildVisuals();
    this._buildColliders();

    this.rig = new ClawRig(this.world, this.root, {
      inX: SPEC.inX, inZ: SPEC.inZ,
      railY: SPEC.railY, headTop: SPEC.headTop, headMin: SPEC.headMin,
      limX: SPEC.limX, limZ: SPEC.limZ, homeX: SPEC.homeX, homeZ: SPEC.homeZ,
      prongCount: 2,
      // Across the drag axis. The prizes travel in Z, so the prongs close on
      // their left and right faces — スライダー's lesson, and it applies for the
      // same reason: prongs working ALONG the travel direction put one prong
      // behind the prize, and the one pushing backwards usually wins.
      prongYaw: 0,
      strength: this.opts.strength,
      holdScale: this.opts.hold,
      dropSpeed: 0.42, closeTime: 0.85,
      prong: {
        hingeR: 0.050, hingeDrop: 0.045,
        profile: [[0, 0], [0.050, 0.150], [0.030, 0.230]],
        rUpper: 0.024, rLower: 0.022,
        open: -0.30, close: 0.40,
        inertia: 0.020, w0: 3.0,
      },
    });
    this.rig.hub = this.world.addCollider(new BoxCollider([0,0,0], [0.070, 0.045, 0.070],
      null, { friction: 0.35, restitution: 0.05 }));
    this.rig.hub.kinematic = true;
    this.rig.hub.reaction = new V3();
    this.rig.hub.pointVel = (p, out) => out.copy(this.rig.headVel);

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

  /** Platform tilt in degrees; negative is tipped back. HUD + tuning. */
  get tilt(){ return +(this.arm.angle * 180 / Math.PI).toFixed(1); }

  /* ------------------------------------------------------------ physics -- */
  _buildColliders(){
    const W = this.world, S = SPEC, P = PLATE;
    // Slick. Two jobs: it sets the tilt at which the avalanche starts (17.5°
    // against a carton), and it decides whether the claw can drag a carton at
    // all. Against a 900 g carton, sliding one takes 2.8 N and the claw's grip
    // delivers about 4.9 N — while lifting one would take 8.8 N, which it cannot
    // reach. That window is the machine: shove, never carry.
    const plate = { friction: 0.22, restitution: 0.02 };
    const glass = { friction: 0.20, restitution: 0.10 };

    // The platform assembly: four colliders, one arm. `off` is each part's
    // position in the platform's own frame, measured from the hinge.
    this.plateParts = [];
    const part = (off, half) => {
      const c = new BoxCollider([0,0,0], half, null, plate);
      c.kinematic = true;
      c.arm = this.arm;
      c.off = new V3().fromArray(off);
      // Surface velocity of a point on a rotating platform: ω × (p − pivot).
      c.pointVel = (p, out) =>
        out.subVectors(p, this.arm.pivot).cross(AXIS).multiplyScalar(-this.arm.avel);
      W.addCollider(c);
      this.plateParts.push(c);
      return c;
    };
    const zc = (P.back + P.front) / 2, hz = (P.front - P.back) / 2;
    part([0, -P.t/2, zc], [P.hx, P.t/2, hz]);                          // deck
    part([0, P.wall/2, P.back + 0.010], [P.hx, P.wall/2, 0.010]);      // back lip
    for (const sx of [-1, 1])
      part([sx*(P.hx + 0.010), P.wall/2, zc], [0.010, P.wall/2, hz]);  // side walls
    this._placePlate();

    // cage
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.03), 1.10, 0], [0.03, 0.52, S.inZ + 0.03], null, glass));
    for (const sz of [-1, 1]) W.addCollider(new BoxCollider(
      [0, 1.10, sz*(S.inZ + 0.03)], [S.inX + 0.03, 0.52, 0.03], null, glass));
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));

    // catch bin under the well + a floor of last resort
    W.addCollider(new BoxCollider([0, S.binY, (S.wellZ + S.inZ)/2],
      [S.inX, 0.02, (S.inZ - S.wellZ)/2], null, { friction: 0.5, restitution: 0.04 }));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  /** Put every platform part where the current hinge angle says it is. */
  _placePlate(){
    const q = this._q || (this._q = new THREE.Quaternion());
    const v = this._v || (this._v = new V3());
    q.setFromAxisAngle(AXIS, this.arm.angle);
    for (const c of this.plateParts){
      v.copy(c.off).applyQuaternion(q);
      c.c.copy(this.arm.pivot).add(v);
      c.q.copy(q);
      c.qi.copy(q).invert();
    }
    if (this.plateMesh){
      this.plateMesh.position.copy(this.arm.pivot);
      this.plateMesh.quaternion.copy(q);
    }
  }

  /**
   * One substep of the hinge. The spring is the only thing holding the platform
   * up; the prizes' weight arrives through the contacts, exactly as it would on
   * any other body.
   */
  _stepPlate(h){
    const a = this.arm;
    // counterweight: constant, so it sets a threshold rather than a deflection
    let tau = -this.opts.counter * Math.cos(a.angle);
    // the rubber stop, one-sided — it only pushes back below level
    if (a.angle < 0) tau += -PLATE.stopK * a.angle;
    tau -= PLATE.damp * a.avel;
    a.avel += tau * a.invI * h;
    this._placePlate();
  }

  /** Integrate the hinge AFTER the solve — see physics.Arm, and gotcha 2. */
  _integratePlate(dt){
    this.arm.angle += this.arm.avel * dt;
    const [lo, hi] = PLATE.limit;
    if (this.arm.angle < lo){ this.arm.angle = lo; if (this.arm.avel < 0) this.arm.avel = 0; }
    if (this.arm.angle > hi){ this.arm.angle = hi; if (this.arm.avel > 0) this.arm.avel = 0; }
  }

  _loadPrizes(n){
    const S = SPEC, P = PLATE;
    const rand = rng(this.opts.seed * 977 + 13);
    // ONE row, tucked against the back lip just behind the hinge. There is only
    // room for one — the rear arm is 110 mm and a carton is 130 mm deep — and
    // that is the point: the stocked load has to sit close to the pivot so its
    // moment is small, leaving the whole front arm as the travel that decides
    // the machine. Nothing starts forward of the pivot, or the first coin
    // collects the lot.
    const slots = [];
    for (const x of [-0.240, -0.080, 0.080, 0.240]) slots.push([x, P.back + 0.065]);
    for (let i = 0; i < n && i < slots.length; i++){
      const t = PRIZE_TYPES[(this.opts.seed + i) % PRIZE_TYPES.length];
      const art = makePrize(t);
      const b = new Body(art.spheres, {
        mass: 0.9, friction: 0.45, restitution: 0.02,
        linDamp: 0.25, angDamp: 3.0,
      });
      b.tag = 'prize';
      b.prize = { ...t };
      b.won = false;
      const [sx, sz] = slots[i];
      b.setPos(sx + (rand()-0.5)*0.02,
               S.pivotY + BOX.hy + 0.010,
               S.pivotZ + sz + (rand()-0.5)*0.02);
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
    // Let the platform find its resting angle under the load before play.
    for (let i = 0; i < 400; i++){
      this._stepPlate(this.world.cfg.fixedDt);
      this.world.substep(this.world.cfg.fixedDt);
      this._integratePlate(this.world.cfg.fixedDt);
    }
    for (const b of this.prizes) b.syncMesh();
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const S = SPEC, P = PLATE, root = this.root;
    this.prizeLayer = new THREE.Group();
    root.add(this.prizeLayer);

    const body   = new THREE.MeshStandardMaterial({ color:0x14304a, roughness:.46, metalness:.34 });
    const trim   = new THREE.MeshStandardMaterial({ color:0x4be0c4, roughness:.36, metalness:.5 });
    const dark   = new THREE.MeshStandardMaterial({ color:0x081420, roughness:.86 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xdfe7f5, roughness:.18, metalness:.95 });
    const deckM  = new THREE.MeshStandardMaterial({ color:0x25405c, roughness:.55, metalness:.3 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    this.MAT = { body, trim, dark, chrome, deckM, glass };

    const box = (w,h,d,m,x,y,z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); root.add(o); return o;
    };

    // plinth
    box(S.width, 0.62, S.depth, body, 0, 0.31, 0);
    const cw = 0.07, CW = S.width + 0.02, CD = S.depth + 0.02;
    for (const sz of [-1, 1]) box(CW, 0.05, cw, trim, 0, 0.640, sz*(CD - cw)/2);
    for (const sx of [-1, 1]) box(cw, 0.05, CD - cw*2, trim, sx*(CW - cw)/2, 0.640, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, dark, 0, 0.040, 0);

    // THE PLATFORM, drawn as one group parented at the hinge so it simply
    // inherits the angle the physics is already computing.
    const g = new THREE.Group();
    const zc = (P.back + P.front)/2, hz = (P.front - P.back)/2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(P.hx*2, P.t, hz*2), deckM);
    deck.position.set(0, -P.t/2, zc); g.add(deck);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(P.hx*2, P.wall, 0.020), trim);
    lip.position.set(0, P.wall/2, P.back + 0.010); g.add(lip);
    for (const sx of [-1, 1]){
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.020, P.wall, hz*2), trim);
      w.position.set(sx*(P.hx + 0.010), P.wall/2, zc); g.add(w);
    }
    // the hinge itself, visible through the glass — this cabinet's signature
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, P.hx*2 + 0.09, 12), chrome);
    shaft.rotation.z = Math.PI/2; g.add(shaft);
    root.add(g);
    this.plateMesh = g;
    for (const sx of [-1, 1]){
      box(0.05, S.pivotY - 0.60, 0.05, chrome, sx*(P.hx + 0.035), (0.60 + S.pivotY)/2, S.pivotZ);
    }

    // the well: a lit throat in front of the platform
    box(S.inX*2, 0.28, S.inZ - S.wellZ,
      new THREE.MeshStandardMaterial({ color:0x04080f, roughness:1 }),
      0, S.pivotY - 0.20, (S.wellZ + S.inZ)/2);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(S.inX*1.94, (S.inZ - S.wellZ)*0.9),
      new THREE.MeshStandardMaterial({ color:0x4be0c4, emissive:0x4be0c4,
        emissiveIntensity:0.7, roughness:.5, transparent:true, opacity:.20 }));
    glow.rotation.x = -Math.PI/2;
    glow.position.set(0, S.binY + 0.012, (S.wellZ + S.inZ)/2);
    root.add(glow);
    this.wellGlow = glow;
    box(S.inX*2, 0.02, S.inZ - S.wellZ, deckM, 0, S.binY, (S.wellZ + S.inZ)/2);

    // cage
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
      new THREE.MeshStandardMaterial({ color:0x0d2135, roughness:.75 }),
      0, cy, -S.inZ - 0.03);

    // marquee
    box(S.width, 0.30, S.depth, trim, 0, 1.75, 0);
    const tex = this._marqueeTexture();
    const mq = new THREE.Mesh(new THREE.PlaneGeometry(S.width - 0.06, 0.22),
      new THREE.MeshStandardMaterial({ map: tex, emissive:0xffffff, emissiveMap: tex,
        emissiveIntensity:1.35, roughness:.6 }));
    mq.position.set(0, 1.75, S.depth/2 + 0.004);
    root.add(mq);
    box(S.width + 0.03, 0.04, S.depth + 0.03, trim, 0, 1.90, 0);

    // coin slot + delivery mouth
    const coin = box(0.055, 0.075, 0.02, dark, -0.30, 0.420, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x04201c, emissive:0x4be0c4, emissiveIntensity:0 }));
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
    grd.addColorStop(0, '#4be0c4'); grd.addColorStop(.5, '#37a6ff'); grd.addColorStop(1, '#b1a4ff');
    g.fillStyle = '#081420'; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
    g.globalAlpha = .18; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(560,0); g.lineTo(780,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 112px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(8,20,32,.85)';
    g.strokeText('シーソー', 512, 100);
    g.fillStyle = '#fff'; g.fillText('シーソー', 512, 100);
    g.font = `bold 34px ${JP_FONT}`;
    g.fillText('BALANCE  ·  ¥100', 512, 196);
    this._mqTex = new THREE.CanvasTexture(c);
    this._mqTex.colorSpace = THREE.SRGBColorSpace;
    return this._mqTex;
  }

  /* ------------------------------------------------------------- update -- */
  update(dt){
    this.world.step(dt, h => { this._stepPlate(h); this.rig.stepMechanism(h); });
    this._integratePlate(this.world.cfg.fixedDt);
    this.rig.integrateHinges(this.world.cfg.fixedDt);
    this.rig.sync();
    this._placePlate();

    this.coinLamp.material.emissiveIntensity = this.rig.credit > 0
      ? 1.6 + Math.sin(performance.now()*0.006)*0.6 : 0;
    this.wellGlow.material.emissiveIntensity = 0.6 + Math.sin(performance.now()*0.003)*0.3;

    for (const b of this.prizes) if (!b.won) b.syncMesh();
    this._checkPrizes();
    if (this.debug && this.debug.visible) this.updateDebug();
  }

  /** Won when a carton is off the front of the platform and down in the well. */
  _checkPrizes(){
    const S = SPEC;
    for (const b of this.prizes){
      if (b.won) continue;
      if (b.pos.z > S.wellZ - 0.02 && b.pos.y < S.pivotY - 0.12){
        b.won = true;
        this.wins++;
        this.collected.push(b.prize);
        if (this.onWin) this.onWin(b.prize);
      }
    }
  }

  /** How far the closest live carton still is from the front edge, in metres. */
  get nearest(){
    let best = null;
    for (const b of this.prizes){
      if (b.won) continue;
      const d = (SPEC.pivotZ + PLATE.front) - b.pos.z;
      if (best === null || d < best) best = d;
    }
    return best;
  }

  reset(){
    for (const b of this.prizes){ this.world.remove(b); this.prizeLayer.remove(b.mesh); }
    this.prizes.length = 0;
    this.dumps = 0;
    this.arm.angle = 0; this.arm.avel = 0;
    this._placePlate();
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
    this._dbgPlate = [];
    for (const c of this.world.colliders){
      if (!(c instanceof BoxCollider)) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(c.h.x*2, c.h.y*2, c.h.z*2),
        c === this.rig.hub ? hot : mat);
      m.position.copy(c.c); m.quaternion.copy(c.q);
      if (c === this.rig.hub) this._dbgHub = m;
      if (c.arm) this._dbgPlate.push({ m, c });
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
    if (this._dbgHub) this._dbgHub.position.copy(this.rig.hub.c);
    for (const d of this._dbgPlate){ d.m.position.copy(d.c.c); d.m.quaternion.copy(d.c.q); }
    for (const d of this._dbgPrizes) d.m.position.copy(d.s.w);
    this.rig.updateDebug();
  }
}

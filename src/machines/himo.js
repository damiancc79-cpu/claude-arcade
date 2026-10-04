/* ============================================================================
   machines/himo.js — ヒモ (himo), the string-cut setting.

   The prize is not on a deck, not on a bar, and not something the claw could
   ever carry. It hangs on a cord from the roof of the cabinet, and bolted in
   the middle of the field is a CUTTER — a fixed blade, edge up.

        ╔═════════════════════════════╗
        ║              ╿ anchor       ║
        ║              │              ║
        ║        ▲     │  ← cord      ║   the claw's job is the CORD,
        ║      blade   │              ║   never the prize
        ║              ▓              ║
        ║             ▓▓▓             ║
        ║  (open drop to the pan)     ║
        ╚═════════════════════════════╝

   The claw never touches the blade and never cuts anything itself. It takes
   hold of the prize and its return stroke swings the prize out on its cord —
   and a cord pulled to an angle is a cord dragged across whatever is in the
   way. Where you take hold, and how far the swing carries, is the whole game.
   Grip strength barely matters: the prize weighs 350 g and hangs free, so
   there is nothing to overcome but its own pendulum.

   Cutting is not a counter. The cord is a real chain of bodies (physics.Link),
   and the blade is a real collider; every substep the machine integrates the
   contact impulse the cord presses onto the blade with, and severs the link
   when that integral reaches the cord's rated work. Press it harder and it
   parts sooner; catch it at a slack angle and you saw at it all day.

   Uses the shared ClawRig. Model contract: base on y = 0, front facing +Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, Link, BoxCollider, CapsuleCollider, PlaneCollider,
         boxCluster } from '../physics.js';
import { ClawRig } from './clawrig.js';

const V3 = THREE.Vector3;
const _u = new V3(), _v = new V3();

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width : 0.98, depth : 0.92, height: 1.90,

  // Catch pan, and the whole floor is the chute. Lower here than on the other
  // hanging cabinets, and it has to be: the prize dangles at the BOTTOM of a
  // draped cord, and if it can reach the pan it rests there, the cord goes
  // slack, and the machine is dead — no tension, nothing to cut, every
  // subsequent play worth zero. Measured, it settled 21 mm above the old pan
  // and the cabinet stopped responding after a single play.
  // The prize hangs at the bottom of a cord and must not reach the pan: the
  // moment it rests, the cord goes slack, the wrap on the blade is lost, and no
  // play can restore it. Deepening this to 0.250 for more shock margin was
  // tried and measured worse overall (see STATUS.md).
  panY   : 0.380,
  cageTop: 1.600,
  inX    : 0.420, inZ: 0.380,

  // Where the cord is tied. A single bracket, not a rail — a rail across the
  // cabinet is exactly the thing the claw head would collide with.
  //
  // The HEIGHT is the constraint that matters, and it is not obvious: the whole
  // cord has to hang BELOW the parked claw's prong tips (1.264). Tied up at the
  // roof, the claw swept straight through the upper cord on every traverse and
  // batted it aside before the play had even begun — measured, the cord was
  // 60 mm out of place by the time the claw started its descent.
  // Where the cord is tied. A single bracket, not a rail — a rail across the
  // cabinet is exactly the thing the claw head would collide with.
  //
  // The HEIGHT is the constraint that matters: the whole cord has to hang BELOW
  // the parked claw's prong tips (1.078). Tied up at the roof, the claw swept
  // straight through the upper cord on every traverse and batted it aside
  // before the play had even begun.
  anchor : { x: -0.160, y: 1.045, z: -0.150 },

  // THE CUTTER, and the cord is ALREADY LYING ON IT. That is the design: the
  // cord runs from its anchor on the left, over the blade, and down to the
  // prize on the right, so contact is guaranteed by geometry and never has to
  // be achieved by aim.
  //
  // Two earlier layouts put the blade beside a hanging cord and asked the claw
  // to bring the two together. Neither works. A prong sweeping at a hanging
  // cord pushes it aside rather than pinching it — the cord is a pendulum with
  // nothing to brace against. And gripping the prize instead does not help,
  // because the rig lifts before it returns: the prize goes UP, the cord goes
  // slack, and the closest the cord ever came to the blade was 93 mm.
  //
  // Draped over the edge, none of that matters. What decides the cut is
  // TENSION, and tension is what a pull on the prize produces.
  blade  : { x:  0.020, y: 0.975, z: -0.150, halfZ: 0.055, r: 0.0035 },

  // CHEEK PLATES either side of the cutter, forming a channel the cord runs in.
  //
  // These exist because of one measurement. The cord does not fall off the
  // blade sideways in the XY plane; it is pushed ALONG the blade's own Z axis
  // by the closing prongs — 10 mm into the edge when the close begins, 97 mm
  // clear of it when the close ends, repeatably. Trying to stop the claw doing
  // that failed three separate ways. Constraining where the cord can GO does
  // not require stopping anything: an 8 mm running clearance either side caps
  // the drift at 8 mm instead of 97, and the cord still slides freely along its
  // own length, which is the direction that matters.
  //
  // They sit at the cutter's x, ~70 mm from where the claw works, so they
  // cannot foul the prongs — and prongs are colliders, which never test against
  // other colliders anyway.
  // Sized to cover the cord's ENTIRE working run, not just the blade. A short
  // plate around the edge alone leaves the cord free where the claw actually
  // presses it (x ≈ 0.09) and where the hub pushes it down to (y ≈ 0.94), and
  // it escapes round the outside — measured 166 mm of Z drift with a channel
  // only 26 mm wide. The plates run from behind the cutter down to just above
  // the prize.
  cheek  : { gap: 0.026, t: 0.006, x0: -0.020, x1: 0.130, y0: 0.760, y1: 1.060 },

  // THE BEADS HAVE TO OVERLAP. Spacing 32 mm against an 18 mm bead radius, so
  // consecutive beads intersect and the cord is a continuous solid the claw can
  // actually catch. At 65 mm spacing with 7.5 mm beads — a far more cord-like
  // set of numbers — the cord was collidable along 12% of its length and the
  // prong swept cleanly through the gap between two beads every single play.
  // The result reads as a thick plastic strap rather than a thread, which is
  // what these cabinets use anyway.
  cord   : { seg: 0.032, n: 12, drop: 0.060, r: 0.018, toBlade: 6 },
  /** Angle of the cord's descending leg below the cutter, from vertical. */
  cordAngle: 0.35,

  // THE GUIDE — a real threaded eyelet, and the thing that finally deletes the
  // cord's free equilibrium.
  //
  // The cord has two stable resting shapes: wrapped over the cutter, and
  // hanging straight from anchor to prize 105 mm BELOW it. Once a play knocked
  // it into the second, re-wrapping meant lifting the cord back over the blade
  // and nothing does that — the cabinet was dead. Blocking the obvious route
  // with a wall was tried and failed, because the cord has more than one way
  // out.
  //
  // A ring it is THREADED THROUGH has no way out at all, in any direction. This
  // is the same construction as 大型's tag ring (`clawbig.js`) with the roles
  // swapped: there the ring is part of a moving body and the bar is static;
  // here the ring is static and the cord runs through it. Eighteen overlapping
  // spheres, so there is no gap between them for the cord to escape through,
  // and a 32 mm clear hole against an 18 mm cord so it still runs freely.
  //
  // Sited 90 mm down the descending leg: far enough past the cutter to still
  // force the wrap over it, low enough to clear the claw's hub.
  guide  : { s: 0.090, R: 0.042, r: 0.010, n: 18 },

  // Keeps the prize to the right of the cutter — see _buildColliders.
  // Keeps the prize on the cutter's right so the cord's wrap cannot invert.
  //
  // Extending this wall UP to meet the blade — leaving a gap too narrow for the
  // cord, so that no path from anchor side to prize side exists except over the
  // cutter — was tried as a way to delete the cord's free equilibrium outright.
  // It does not work: the cord still ends up off the blade in 5 sessions of 18,
  // and it makes the machine trivial besides (median 1 play instead of 4,
  // because the tighter wrap cuts far faster). See STATUS.md.
  divider: { x: -0.010, top: 0.760 },

  railY  : 1.500,
  headTop: 1.440,
  // The claw descends until its HUB is on the cord, just downhill of the blade.
  //
  // Taking hold of the prize and pulling was an earlier design and it fails on
  // the rig's own cycle: the crane lifts before it returns, so the prize goes
  // up, gets carried to the park position and dropped from height. Measured,
  // that peaked at 371 N through the cord, threw the prize onto the pan, and
  // pulled the cord clean off the blade. Pressing on the DESCENT uses the one
  // part of the cycle that applies a large, sustained, controllable force.
  headMin: 0.980,

  limX   : [-0.310, 0.330],
  limZ   : [-0.250, -0.050],
  homeX  : -0.300, homeZ: -0.150,        // parked left, past the blade
};

/**
 * Work the cord takes before it parts, in newton-seconds of blade contact.
 *
 * Set from the best single play the cabinet can produce. A well-placed claw
 * delivers about 2.7 N·s, so at 9.0 a perfect play is worth roughly a third of
 * the cord and a badly placed one — the claw straddling the blade instead of
 * pressing beside it — is worth about 2%.
 */
const CUT_WORK = 9.0;
/** Tension the hanging prize alone puts on the cord — below this, nothing cuts. */
const REST_TENSION = 5.0;
/** Tension above REST that counts as a full-strength bite. */
const BITE_RANGE = 6.0;

const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

export const PRIZE_TYPES = [
  { key:'headphone', jp:'ワイヤレスヘッドホン', en:'WIRELESS HEADPHONES' },
  { key:'watch',     jp:'スマートウォッチ',     en:'SMART WATCH'         },
  { key:'camera',    jp:'インスタントカメラ',   en:'INSTANT CAMERA'      },
  { key:'speaker',   jp:'スピーカー',           en:'BLUETOOTH SPEAKER'   },
];
const PRIZE_COLORS = [0xff5c8a, 0xffd166, 0x6ec3ff, 0xc792ea];

const BOX = { w: 0.150, h: 0.110, d: 0.090 };

/* ---------------------------------------------------------- prize box art -- */
const artCache = new Map();
function boxArt(seed){
  if (artCache.has(seed)) return artCache.get(seed);
  const W = 320, H = 236;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const t = PRIZE_TYPES[seed % PRIZE_TYPES.length];
  const hex = '#' + PRIZE_COLORS[seed % PRIZE_COLORS.length].toString(16).padStart(6,'0');

  g.fillStyle = '#12101c'; g.fillRect(0,0,W,H);
  g.fillStyle = hex; g.globalAlpha = .20; g.fillRect(0,0,W,H); g.globalAlpha = 1;
  g.fillStyle = hex; g.fillRect(0, 0, W, 44);
  g.fillStyle = '#ffd166'; g.fillRect(0, 44, W, 4);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 24px ${JP_FONT}`; g.fillStyle = '#12101c';
  g.fillText(t.jp, W/2, 22);

  g.strokeStyle = hex; g.lineWidth = 4;
  g.strokeRect(34, 72, W-68, 104);
  g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(34, 72, W-68, 104);
  g.fillStyle = hex;
  g.beginPath(); g.arc(W/2, 124, 30, 0, 7); g.fill();
  g.fillStyle = '#12101c';
  g.beginPath(); g.arc(W/2, 124, 15, 0, 7); g.fill();

  g.font = 'bold 20px ui-monospace, monospace'; g.fillStyle = '#ffd166';
  g.fillText(t.en, W/2, 204);
  g.strokeStyle = hex; g.lineWidth = 7; g.strokeRect(4,4,W-8,H-8);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  artCache.set(seed, tex);
  return tex;
}

/**
 * Where the guide ring sits and how it is oriented: centred on the cord's own
 * seeded path below the cutter, with its hole facing along that path so the
 * cord threads straight through it.
 */
export function guideFrame(){
  const B = SPEC.blade, C = SPEC.cord, G = SPEC.guide, a = SPEC.cordAngle;
  const down = new V3(Math.sin(a), -Math.cos(a), 0);
  const centre = new V3(B.x, B.y + B.r + C.r, B.z).addScaledVector(down, G.s);
  // hole axis = `down`; the ring lies in the plane spanned by u and v
  const v = new V3(0, 0, 1);
  const u = new V3().copy(down).cross(v).normalize();
  return { centre, down, u, v };
}

/* ============================================================== machine === */
export class StringCutMachine {
  constructor(opts = {}){
    this.opts = { seed: 0, strength: 0.90, hold: 0.50, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'string-cut-machine';
    // A cord is a series chain carrying a prize ten times a bead's mass. A
    // short chain like this still needs the iterations to stay taut.
    // XPBD trades solver iterations for SUBSTEPS — that is where its stiffness
    // comes from — so this world runs at 1/240 rather than the usual 1/120.
    // posIters still does the positional work and has to stay interleaved with
    // the contact pass; see the note in World.substep.
    this.world = new World({ gravity: -9.81, velIters: 16, posIters: 7,
                             fixedDt: 1/240, maxSubsteps: 8 });

    this.prizes = [];
    this.picks = [];
    this.collected = [];
    this.wins = 0;
    this.cut = 0;                        // N·s of blade contact accumulated
    this.severed = false;
    this.onWin = null;
    this.onPhase = null;

    this._buildVisuals();
    this._buildColliders();

    this.rig = new ClawRig(this.world, this.root, {
      inX: SPEC.inX, inZ: SPEC.inZ,
      railY: SPEC.railY, headTop: SPEC.headTop, headMin: SPEC.headMin,
      limX: SPEC.limX, limZ: SPEC.limZ, homeX: SPEC.homeX, homeZ: SPEC.homeZ,
      prongCount: 2,
      // Across the cord. Turning the claw a quarter so it closes along ±X was
      // tried and is much worse — the prongs then straddle the cutter post
      // itself and knock the cord off at nearly every aim.
      prongYaw: Math.PI/2,
      strength: this.opts.strength,
      holdScale: this.opts.hold,
      dropSpeed: 0.34, closeTime: 0.70,
      prong: {
        // Ordinary two-prong geometry. The claw's job is the CORD, not the
        // prize — the head presses, the prongs are mostly along for the ride —
        // but shortening them so the claw physically cannot reach the prize was
        // tried and made the cabinet strictly worse (see STATUS.md).
        hingeR: 0.055, hingeDrop: 0.050,
        profile: [[0, 0], [0.050, 0.200], [0.020, 0.340]],
        rUpper: 0.026, rLower: 0.024,
        open: -0.35, close: 0.38,
        inertia: 0.020, w0: 3.0,
      },
    });
    this.rig.hub = this.world.addCollider(new BoxCollider([0,0,0], [0.060, 0.040, 0.060],
      null, { friction: 0.35, restitution: 0.05 }));
    this.rig.hub.kinematic = true;
    this.rig.hub.reaction = new V3();
    this.rig.hub.pointVel = (p, out) => out.copy(this.rig.headVel);

    this.rig.buildButtons(0.11, 0.280, SPEC.depth/2 + 0.016);
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

  /** How far through the cord the blade has got, 0–1. */
  get cutFrac(){ return Math.min(1, this.cut / CUT_WORK); }

  /* ------------------------------------------------------------ physics -- */
  _buildColliders(){
    const W = this.world, S = SPEC, B = S.blade;
    const steel = { friction: 0.30, restitution: 0.02 };
    const glass = { friction: 0.20, restitution: 0.10 };
    const pan   = { friction: 0.55, restitution: 0.05 };

    // THE BLADE. A capsule with a 3.5 mm radius lying across the cabinet, so
    // the cord — which swings in the XY plane — can only ever meet it edge-on.
    this.blade = W.addCollider(new CapsuleCollider(
      [B.x, B.y, B.z - B.halfZ], [B.x, B.y, B.z + B.halfZ], B.r, steel));
    // its post
    W.addCollider(new BoxCollider([B.x, (S.panY + B.y - 0.02)/2, B.z],
      [0.022, (B.y - 0.02 - S.panY)/2, 0.022], null, steel));

    const K = S.cheek;
    for (const sz of [-1, 1]){
      W.addCollider(new BoxCollider(
        [(K.x0+K.x1)/2, (K.y0+K.y1)/2, B.z + sz*(K.gap + K.t)],
        [(K.x1-K.x0)/2, (K.y1-K.y0)/2, K.t],
        null, { friction: 0.15, restitution: 0.02 }));
    }

    // THE GUIDE RING — 18 overlapping spheres (degenerate capsules) in a circle.
    const G = S.guide, F = guideFrame();
    this.guide = [];
    for (let i = 0; i < G.n; i++){
      const a = (i / G.n) * Math.PI * 2;
      const p = F.centre.clone()
        .addScaledVector(F.u, Math.cos(a) * G.R)
        .addScaledVector(F.v, Math.sin(a) * G.R);
      this.guide.push(W.addCollider(new CapsuleCollider(
        [p.x, p.y, p.z], [p.x, p.y, p.z], G.r,
        { friction: 0.18, restitution: 0.02 })));
    }

    // THE DIVIDER, and the machine does not work without it. The cord only
    // presses on the blade because it WRAPS it — anchor up and left, prize down
    // and right. Let the prize swing left past the blade and the wrap goes to
    // zero, the cord lifts off, and it then hangs plumb from the anchor 161 mm
    // clear of the edge with no way back. Measured, that is a dead cabinet:
    // cut frozen at 35%, every further play worth zero. The divider keeps the
    // prize on its own side of the cutter, so the wrap can never be lost.
    W.addCollider(new BoxCollider([S.divider.x, (S.panY + S.divider.top)/2, 0],
      [0.008, (S.divider.top - S.panY)/2, S.inZ], null, steel));

    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.03), 1.00, 0], [0.03, 0.62, S.inZ + 0.03], null, glass));
    for (const sz of [-1, 1]) W.addCollider(new BoxCollider(
      [0, 1.00, sz*(S.inZ + 0.03)], [S.inX + 0.03, 0.62, 0.03], null, glass));
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));

    W.addCollider(new BoxCollider([0, S.panY - 0.02, 0],
      [S.inX, 0.02, S.inZ], null, pan));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  /**
   * Tie the cord and hang the prize on it.
   *
   * The beads are collision geometry as well as constraint anchors — they have
   * to be, or the claw would sweep straight through the cord and the whole
   * cabinet would be unplayable.
   */
  _loadPrizes(){
    const S = SPEC, A = S.anchor, C = S.cord;
    const t = PRIZE_TYPES[this.opts.seed % PRIZE_TYPES.length];

    // Lay the cord along the path it has to take: down to the blade, then on
    // down to the prize. Seeded straight below the anchor it simply hangs there
    // and never finds the blade at all.
    const B = SPEC.blade;
    const over = new V3(B.x, B.y + B.r + C.r, B.z);
    // Walk the path by ARC LENGTH at the links' own rest length. Interpolating
    // by fraction instead — parcelling however far it is to the blade out among
    // however many beads — seeds every segment at nearly double its rest
    // length, and the cord arrives already 250 mm out of shape.
    const up = new V3().copy(over).sub(new V3(A.x, A.y, A.z));
    const L1 = up.length();
    up.divideScalar(L1);
    const down = new V3(Math.sin(SPEC.cordAngle), -Math.cos(SPEC.cordAngle), 0);
    const path = (i, out) => {
      const s = C.seg * i;
      return s <= L1
        ? out.set(A.x, A.y, A.z).addScaledVector(up, s)
        : out.copy(over).addScaledVector(down, s - L1);
    };

    this.beads = [];
    for (let i = 0; i < C.n; i++){
      const b = new Body([{ o:[0,0,0], r: C.r }], {
        // Heavy for their size on purpose. A cord of near-weightless beads
        // under a 0.42 kg prize is a mass ratio the solver cannot hold taut,
        // and it stretches like elastic.
        mass: 0.030, friction: 0.55, restitution: 0.02,
        linDamp: 0.35, angDamp: 2.0,
      });
      b.tag = 'cord';
      const q = path(i + 1, new V3());
      b.setPos(q.x, q.y, q.z);
      this.world.add(b);
      this.beads.push(b);
    }

    const prize = new Body(boxCluster([BOX.w/2, BOX.h/2, BOX.d/2], 0.030), {
      mass: 0.350, friction: 0.50, restitution: 0.03, linDamp: 0.25, angDamp: 2.4,
    });
    prize.tag = 'prize';
    prize.prize = { ...t, color: PRIZE_COLORS[this.opts.seed % PRIZE_COLORS.length] };
    prize.won = false;
    const pAt = path(C.n, new V3()).addScaledVector(down, C.drop + BOX.h/2);
    prize.setPos(pAt.x, pAt.y, pAt.z);
    this.world.add(prize);
    this.prizes.push(prize);

    // Near-rigid, but not rigid: a real cord has some give, and the compliance
    // term is also what keeps the accumulated impulse settling rather than
    // ratcheting (see physics.Link).
    const CO = { compliance: 5e-6 };
    this.links = [];
    this.links.push(this.world.addLink(
      new Link(this.beads[0], null, C.seg, { anchor: [A.x, A.y, A.z], ...CO })));
    for (let i = 1; i < C.n; i++)
      this.links.push(this.world.addLink(new Link(this.beads[i], this.beads[i-1], C.seg, CO)));
    this.links.push(this.world.addLink(
      new Link(prize, this.beads[C.n-1], C.drop + BOX.h/2, CO)));

    // art
    const mesh = this._boxMesh(this.opts.seed % PRIZE_TYPES.length);
    prize.mesh = mesh;
    mesh.userData.pick = 'prize';
    this.prizeLayer.add(mesh);
    this._buildCordArt();

    for (let i = 0; i < 420; i++) this.world.substep(this.world.cfg.fixedDt);
    prize.syncMesh();
    this._syncCord();
  }

  _boxMesh(seed){
    const art = boxArt(seed);
    const col = PRIZE_COLORS[seed % PRIZE_COLORS.length];
    const side  = new THREE.MeshStandardMaterial({ color: col, roughness:.55, metalness:.15 });
    const plain = new THREE.MeshStandardMaterial({ color: 0x1a1826, roughness:.7 });
    const face  = new THREE.MeshStandardMaterial({ map: art, roughness:.5 });
    return new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d),
      [side, side, plain, plain, face, side]);
  }

  /* -------------------------------------------------------------- cord ---- */
  _buildCordArt(){
    const mat = new THREE.MeshStandardMaterial({ color:0xf4efe2, roughness:.85 });
    this.cordSegs = [];
    for (let i = 0; i <= this.beads.length; i++){
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1, 8), mat);
      this.root.add(m);
      this.cordSegs.push(m);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8),
      new THREE.MeshStandardMaterial({ color:0x8a8377, roughness:.6, metalness:.3 }));
    knot.position.set(SPEC.anchor.x, SPEC.anchor.y, SPEC.anchor.z);
    this.root.add(knot);
  }

  /** Redraw the cord through the bead positions; hide any severed span. */
  _syncCord(){
    const A = SPEC.anchor;
    const pt = i => i < 0 ? _v.set(A.x, A.y, A.z) : _v.copy(this.beads[i].pos);
    for (let i = 0; i <= this.beads.length; i++){
      const seg = this.cordSegs[i];
      const link = this.links[i];
      if (link && link.broken){ seg.visible = false; continue; }
      seg.visible = true;
      const a = pt(i - 1).clone();
      const b = i < this.beads.length ? this.beads[i].pos : this.prizes[0].pos;
      _u.copy(b).sub(a);
      const L = _u.length();
      seg.position.copy(a).addScaledVector(_u, 0.5);
      seg.quaternion.setFromUnitVectors(new V3(0,1,0), _u.clone().normalize());
      seg.scale.set(1, Math.max(0.001, L), 1);
    }
  }

  /**
   * Integrate what the blade is doing to the cord.
   *
   * `world.contacts` still holds the previous substep's contacts with their
   * final accumulated impulses, so this runs at the top of the step callback
   * and is one substep behind — which over a play of several hundred substeps
   * is not worth correcting for.
   */
  _accumulateCut(h){
    if (this.severed) return;
    let press = 0, worst = -1, worstIdx = -1;
    for (const c of this.world.contacts){
      if (c.col !== this.blade || !c.a || c.a.tag !== 'cord') continue;
      press += c.Pn;
      if (c.Pn > worst){ worst = c.Pn; worstIdx = this.beads.indexOf(c.a); }
    }
    if (press <= 0) return;
    // THE CORD IS ALWAYS TOUCHING THE BLADE, so contact alone cannot be what
    // cuts it — left alone the cabinet would saw through its own cord overnight.
    // What cuts is TENSION above the load the prize puts on it at rest. Hanging
    // still, the cord carries about 3.4 N and does nothing. Pull the prize and
    // it spikes, and the blade bites in proportion.
    const idx = worstIdx < 0 ? 0 : worstIdx;
    const T = this.links[idx]?.tension ?? 0;
    const bite = Math.max(0, (T - REST_TENSION) / BITE_RANGE);
    if (bite <= 0) return;
    this.cut += press * Math.min(1, bite);
    this.bladeIdx = idx;
    if (this.cut >= CUT_WORK) this._sever(idx);
  }

  _sever(idx){
    const l = this.links[idx];
    if (!l || l.broken) return;
    l.broken = true;
    this.severed = true;
    for (const b of this.beads) b.wake();
    this.prizes[0].wake();
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const S = SPEC, B = S.blade, root = this.root;
    this.prizeLayer = new THREE.Group();
    root.add(this.prizeLayer);

    const body   = new THREE.MeshStandardMaterial({ color:0x2a1730, roughness:.44, metalness:.42 });
    const trim   = new THREE.MeshStandardMaterial({ color:0xffb03a, roughness:.40, metalness:.35 });
    const dark   = new THREE.MeshStandardMaterial({ color:0x150c1a, roughness:.85 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xdce6f2, roughness:.14, metalness:.98 });
    const panM   = new THREE.MeshStandardMaterial({ color:0x2b2036, roughness:.8, metalness:.15 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    this.MAT = { body, trim, dark, chrome, panM, glass };

    const box = (w,h,d,m,x,y,z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); root.add(o); return o;
    };

    box(S.width, S.panY - 0.04, S.depth, body, 0, (S.panY - 0.04)/2, 0);
    const cw = 0.07, CW = S.width + 0.02, CD = S.depth + 0.02, capY = S.panY - 0.015;
    for (const sz of [-1, 1]) box(CW, 0.05, cw, trim, 0, capY, sz*(CD - cw)/2);
    for (const sx of [-1, 1]) box(cw, 0.05, CD - cw*2, trim, sx*(CW - cw)/2, capY, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, dark, 0, 0.040, 0);

    box(S.inX*2, 0.02, S.inZ*2, panM, 0, S.panY - 0.01, 0);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(S.inX*1.9, S.inZ*1.9),
      new THREE.MeshStandardMaterial({ color:0xffb03a, emissive:0xffb03a,
        emissiveIntensity:0.6, roughness:.5, transparent:true, opacity:.20 }));
    glow.rotation.x = -Math.PI/2;
    glow.position.set(0, S.panY + 0.002, 0);
    root.add(glow);
    this.panGlow = glow;

    // THE CUTTER: a wedge on a post, edge up, lit so it is unmistakably the
    // thing the game is about.
    const post = box(0.044, B.y - 0.02 - S.panY, 0.044, chrome, B.x, (S.panY + B.y - 0.02)/2, B.z);
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, B.halfZ*2, 6),
      new THREE.MeshStandardMaterial({ color:0xfff0c0, emissive:0xffb03a,
        emissiveIntensity:1.1, roughness:.25, metalness:.9 }));
    edge.rotation.x = Math.PI/2;
    edge.position.set(B.x, B.y, B.z);
    root.add(edge);
    this.bladeMesh = edge;
    const wedge = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.055, 4), chrome);
    wedge.position.set(B.x, B.y - 0.030, B.z);
    wedge.rotation.y = Math.PI/4;
    root.add(wedge);

    // the cheek plates
    for (const sz of [-1, 1]){
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(B ? (S.cheek.x1-S.cheek.x0) : 0.09,
                              S.cheek.y1-S.cheek.y0, S.cheek.t*2),
        new THREE.MeshStandardMaterial({ color:0xb9c4d4, roughness:.3, metalness:.85,
          transparent:true, opacity:.55, side:THREE.DoubleSide }));
      c.position.set((S.cheek.x0+S.cheek.x1)/2, (S.cheek.y0+S.cheek.y1)/2,
                     B.z + sz*(S.cheek.gap + S.cheek.t));
      root.add(c);
    }

    // the guide ring
    {
      const F = guideFrame(), G = S.guide;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(G.R, G.r, 8, 26), chrome);
      ring.position.copy(F.centre);
      ring.quaternion.setFromUnitVectors(new V3(0, 0, 1), F.down);
      root.add(ring);
    }

    // the anchor bracket, hanging off the cage roof
    box(0.030, 0.055, 0.030, chrome, S.anchor.x, S.anchor.y + 0.028, S.anchor.z);
    // the divider
    box(0.016, S.divider.top - S.panY, S.inZ*2,
      new THREE.MeshStandardMaterial({ color:0x3a2a44, roughness:.6, metalness:.3 }),
      S.divider.x, (S.panY + S.divider.top)/2, 0);

    for (const sx of [-1,1]) for (const sz of [-1,1]){
      box(0.045, S.cageTop - S.panY + 0.10, 0.045, chrome,
          sx*(S.inX + 0.02), (S.panY + S.cageTop)/2, sz*(S.inZ + 0.02));
    }
    const pane = (w,h,x,y,z,ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), glass);
      m.position.set(x,y,z); m.rotation.y = ry; root.add(m);
    };
    const ch = S.cageTop - S.panY, cy = (S.panY + S.cageTop)/2;
    pane(S.inX*2, ch, 0, cy,  S.inZ + 0.02, 0);
    pane(S.inZ*2, ch,  S.inX + 0.02, cy, 0, Math.PI/2);
    pane(S.inZ*2, ch, -S.inX - 0.02, cy, 0, Math.PI/2);
    box(S.inX*2 + 0.05, ch, 0.03,
      new THREE.MeshStandardMaterial({ color:0x1d1226, roughness:.7 }), 0, cy, -S.inZ - 0.03);

    box(S.width, 0.30, S.depth, trim, 0, 1.75, 0);
    const tex = this._marqueeTexture();
    const mq = new THREE.Mesh(new THREE.PlaneGeometry(S.width - 0.06, 0.22),
      new THREE.MeshStandardMaterial({ map: tex, emissive:0xffffff, emissiveMap: tex,
        emissiveIntensity:1.35, roughness:.6 }));
    mq.position.set(0, 1.75, S.depth/2 + 0.004);
    root.add(mq);
    box(S.width + 0.03, 0.04, S.depth + 0.03, trim, 0, 1.90, 0);

    const coin = box(0.055, 0.075, 0.02, dark, -0.30, 0.135, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x2a1a08, emissive:0xffb03a, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.30, 0.082, S.depth/2 + 0.012);
    root.add(this.coinLamp);
  }

  _marqueeTexture(){
    if (this._mqTex) return this._mqTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#ffb03a'); grd.addColorStop(.5, '#ff6ea9'); grd.addColorStop(1, '#c792ea');
    g.fillStyle = '#140a1c'; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
    g.globalAlpha = .18; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(560,0); g.lineTo(780,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 108px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(12,6,20,.85)';
    g.strokeText('ヒモ', 512, 100); g.fillStyle = '#fff'; g.fillText('ヒモ', 512, 100);
    g.font = `bold 34px ${JP_FONT}`;
    g.fillText('ひも切り  ·  STRING CUT  ·  ¥100', 512, 196);
    this._mqTex = new THREE.CanvasTexture(c);
    this._mqTex.colorSpace = THREE.SRGBColorSpace;
    return this._mqTex;
  }

  /* ------------------------------------------------------------- update -- */
  update(dt){
    this.world.step(dt, h => { this._accumulateCut(h); this.rig.stepMechanism(h); });
    this.rig.integrateHinges(this.world.cfg.fixedDt);
    this.rig.sync();
    this._syncCord();

    this.coinLamp.material.emissiveIntensity = this.rig.credit > 0
      ? 1.6 + Math.sin(performance.now()*0.006)*0.6 : 0;
    this.panGlow.material.emissiveIntensity = 0.5 + Math.sin(performance.now()*0.003)*0.25;
    this.bladeMesh.material.emissiveIntensity = 1.0 + this.cutFrac * 2.2;

    for (const b of this.prizes) if (!b.won) b.syncMesh();
    this._checkPrizes();
    if (this.debug && this.debug.visible) this.updateDebug();
  }

  /** Won once the prize is off the cord and down in the pan. */
  _checkPrizes(){
    for (const b of this.prizes){
      if (b.won) continue;
      // Severed is unambiguous — the prize is tied on, so it cannot come down
      // any other way. Gating on it means the height test carries no risk of a
      // false positive and only decides WHEN the win registers.
      if (this.severed && b.pos.y < SPEC.panY + 0.14){
        b.won = true;
        this.wins++;
        this.collected.push(b.prize);
        if (this.onWin) this.onWin(b.prize);
      }
    }
  }

  reset(){
    for (const l of this.links) this.world.removeLink(l);
    for (const b of this.beads) this.world.remove(b);
    for (const b of this.prizes){ this.world.remove(b); this.prizeLayer.remove(b.mesh); }
    for (const s of this.cordSegs) this.root.remove(s);
    this.prizes.length = 0;
    this.cut = 0; this.severed = false;
    this.rig.reset();
    this.opts.seed++;
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
    _u.copy(this.blade.b).sub(this.blade.a);
    const bm = new THREE.Mesh(new THREE.CapsuleGeometry(this.blade.r, _u.length(), 4, 8), hot);
    bm.position.copy(this.blade.a).addScaledVector(_u, 0.5);
    bm.quaternion.setFromUnitVectors(new V3(0,1,0), _u.clone().normalize());
    g.add(bm);
    this._dbgBeads = [];
    for (const b of this.beads){
      const m = new THREE.Mesh(new THREE.SphereGeometry(b.spheres[0].r, 8, 6), mat);
      g.add(m); this._dbgBeads.push({ m, b });
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
    for (const d of this._dbgBeads) d.m.position.copy(d.b.pos);
    this.rig.updateDebug();
  }
}

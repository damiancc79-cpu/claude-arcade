/* ============================================================================
   machines/clawbig.js — 大型 (ōgata), the big-prize cabinet, run as a
   タグ掛け (tag setting).

   One prize, 44 cm of it, and it weighs 1.15 kg. No claw on this floor can
   lift that, and this one is not meant to: the prize does not sit on anything.
   It HANGS, by the plastic tag loop on its head, threaded onto a steel bar
   that runs the width of the cabinet.

      free end                                          collar   post
         ╲                                                  ●      ║
          ╰──────────────────────────────────────────────╮        ║
       ═══════════════════════════════════════════════════════════╣
                                              ◯ ← tag ring, threaded
                                              ▓
                                             ▓▓▓ ← 1.15 kg, hanging
       (open drop to the catch pan, the whole floor, all the way down)

   That single fact changes what a play IS. You cannot take the prize, and you
   cannot topple it — there is nothing under it. All you can do is grip it,
   have the claw drag it a few centimetres toward the free end of the bar, and
   watch the ring slide. The prize is won when the ring comes off the end.

   THE BAR RISES 85 mm toward its free end, on a curve, and that is the
   difficulty. It was a stopper ball first — fatter than the ring's hole, so the last
   centimetre had to be LIFTED rather than walked. That cannot work: lifting the
   ring means taking all 11.3 N of the prize on the grip, and a grip that strong
   drags the prize the length of the bar in one play. The two requirements are
   the same number pulling in opposite directions. An incline splits them: it
   costs a fraction of the weight per play instead of all of it at the end, so
   the drag stays a grind and the last stretch is simply the hardest part of it.
   Friction on chromed steel still holds the ring at rest on the slope, so a
   play that achieves nothing loses nothing.

   The bar's height is load-bearing in a way I did not get to the bottom of.
   Raising it 100 mm and raising the claw's `headMin` by the same 100 mm — which
   leaves every relative distance between bar, claw and prize unchanged — took
   the machine from a median of 13 plays to NOT ONE WIN IN TWENTY SESSIONS, with
   the prize moving ±2 mm a play. It is left at the height that works. See
   STATUS.md; this is an unexplained result, not a tuning choice.

   None of that needs a joint or a constraint. The tag ring is simply part of
   the prize's own sphere cluster — twelve small spheres in a circle — and the
   bar passes through the hole in the middle of it. The ring cannot leave the
   bar sideways because there is nothing to leave through. It is threaded in
   the same way a real one is.

   Uses the shared ClawRig, two prongs turned to work across the bar.
   Model contract: base on y = 0, front facing +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, BoxCollider, CapsuleCollider, PlaneCollider } from '../physics.js';
import { ClawRig } from './clawrig.js';

const V3 = THREE.Vector3;
const _u = new V3();

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width : 0.98, depth : 0.92, height: 1.90,

  // Catch pan, and the whole floor is the chute — there is nothing to land on
  // but the prize's own delivery tray. It sits at plinth height rather than
  // down at the skirt: the play area has to start ABOVE the control panel, or
  // the buttons end up inside the display cage, which is exactly where they
  // were until this was measured against the glass.
  panY   : 0.460,
  cageTop: 1.600,
  inX    : 0.420, inZ: 0.380,

  // THE BAR. Anchored in a post at the RIGHT, free at the LEFT — and that
  // handedness is forced, not cosmetic. The two-button scheme only tracks one
  // way: ➊ moves the claw RIGHT from wherever it parks, and it parks at home.
  // So home has to be the leftmost point of the cabinet or half the bar is
  // unreachable, and home is also where the claw returns to on every play —
  // which is what drags the prize. Free end at the left is the only
  // arrangement where aiming and dragging both work.
  bar    : { z: -0.150, endX: -0.300, anchorX: 0.340,
             anchorY: 0.920, rise: 0.085, segs: 10, r: 0.012,
             // A COLLAR near the anchored end, fatter than the ring's hole, so
             // the ring cannot slide all the way back. Not decoration: a play
             // that goes wrong shoves the prize DOWNHILL, and without this the
             // prize eventually ends up hard against the anchor post, hanging
             // at a permanent 50 mm tilt with its body wedged. From there every
             // further play moved it ±1 mm and the cabinet was dead — measured,
             // 2 sessions in 16 ended that way. The collar keeps the prize
             // hanging free no matter how badly it is played.
             collarX: 0.230, collarR: 0.030 },

  railY  : 1.500,
  headTop: 1.440,
  // The claw's hub has to pass CLEAR ABOVE the bar — at 1.190 its underside
  // sits 33 mm over the high end — while the prong tips reach 290 mm BELOW the
  // bar to the prize's middle. That gap is why the prongs on this cabinet are
  // 430 mm long: anything shorter can only scalp a prize that hangs this far
  // under its own support.
  headMin: 1.090,

  limX   : [-0.340, 0.310],
  // Deliberately narrow. The prize hangs on the bar's line, so there is only
  // one z worth aiming at; the depth axis is about not missing, not about
  // choosing.
  limZ   : [-0.260, -0.040],
  homeX  : -0.330, homeZ: -0.150,        // parked past the free end of the bar
};

/**
 * Height of the bar at a given x. It is not a straight ramp but a CURVE, and
 * that is the machine's whole answer to a problem a straight one could not
 * solve.
 *
 * On any constant slope the force needed to drag the ring is constant, so a
 * grip either supplies it and drags the prize the entire length of the bar in
 * one play, or fails to and moves it a few millimetres. Measured on a straight
 * 6° bar, exactly that: gains of 24, 16, 15 mm and then 173 mm. There is no
 * setting in between, because there is nothing about the geometry that changes
 * as the prize moves.
 *
 * Quadratic, the slope steepens as the prize approaches the free end, so every
 * play stalls somewhere — and stalls sooner than the last one did. The grind
 * gets harder as it gets closer, which is what a big-prize cabinet is for. The
 * steepest point is 15°, still inside the ring's static friction on chromed
 * steel (μ ≈ 0.37, holding to 20°), so a stalled prize stays where it stopped
 * rather than sliding back to the bottom.
 */
export function barYat(x){
  const B = SPEC.bar;
  const u = Math.max(0, Math.min(1, (B.anchorX - x) / (B.anchorX - B.endX)));
  return B.anchorY + B.rise * u * u;
}

/* The prize, in local metres with the tag ring at the origin. */
const RING = { r: 0.030, seg: 0.009, n: 12 };
const HEAD = { r: 0.080, y: -0.115 };
const BODY = { r: 0.115, y: -0.290 };

const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

export const PRIZE_TYPES = [
  { key:'bear',  jp:'特大くまぬいぐるみ', en:'JUMBO BEAR',    color:0xffd166 },
  { key:'cat',   jp:'特大ねこぬいぐるみ', en:'JUMBO CAT',     color:0xff9f6e },
  { key:'panda', jp:'特大パンダ',         en:'JUMBO PANDA',   color:0xf2eee6 },
  { key:'frog',  jp:'特大かえる',         en:'JUMBO FROG',    color:0x7ce38b },
];

const pm = (c, rough = 0.94) =>
  new THREE.MeshStandardMaterial({ color:c, roughness:rough, metalness:0 });
const EYE = new THREE.MeshStandardMaterial({ color:0x1b1520, roughness:0.35 });

function sph(r, mat, x, y, z, sx = 1, sy = 1, sz = 1){
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  return m;
}

/**
 * The prize: art group plus the cluster that matches it.
 *
 * The ring is REAL COLLISION GEOMETRY, not decoration — twelve spheres in a
 * circle whose plane is normal to the bar. Its hole is 21 mm of clear radius
 * against a 12 mm bar, so the prize slides freely along it and cannot come off
 * it in any other direction. Everything this machine does comes from that.
 *
 * The threading is only as good as the timestep: a ring sphere that moves more
 * than its own radius in one substep passes through the bar. Measured, that
 * takes 5.0 m/s — the mechanism peaks around 0.3 m/s, so there is a 15× margin,
 * but do not make the ring finer without checking it again.
 */
function makePrize(type, color){
  const g = new THREE.Group();
  const mat = pm(color);
  const light = pm(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5).getHex());
  const spheres = [];

  // --- the tag: a plastic loop and a printed card ------------------------
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(RING.r, RING.seg, 10, 28),
    new THREE.MeshStandardMaterial({ color:0xe8f4ff, roughness:.25, metalness:.1,
      transparent:true, opacity:.85 }));
  ring.rotation.y = Math.PI/2;                 // hole faces along the bar
  g.add(ring);
  for (let i = 0; i < RING.n; i++){
    const a = (i / RING.n) * Math.PI * 2;
    spheres.push({ o: [0, Math.cos(a)*RING.r, Math.sin(a)*RING.r], r: RING.seg });
  }
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.055, 0.040),
    new THREE.MeshStandardMaterial({ color:0xfff6e0, roughness:.8 }));
  tag.position.set(0, -0.052, 0.004);
  g.add(tag);

  // --- the prize itself ---------------------------------------------------
  g.add(sph(BODY.r, mat, 0, BODY.y, 0, 1, 1.02, 0.96));
  g.add(sph(HEAD.r, mat, 0, HEAD.y, 0));
  spheres.push({ o: [0, HEAD.y, 0], r: HEAD.r }, { o: [0, BODY.y, 0], r: BODY.r });

  if (type === 'frog'){
    for (const s of [-1, 1]) g.add(sph(0.034, mat,  s*0.050, HEAD.y + 0.055, 0.006));
    for (const s of [-1, 1]) g.add(sph(0.022, light, s*0.050, HEAD.y + 0.062, 0.020));
    for (const s of [-1, 1]) g.add(sph(0.012, EYE,   s*0.050, HEAD.y + 0.066, 0.030));
  } else if (type === 'panda' || type === 'bear'){
    const ear = type === 'panda' ? pm(0x2b2b33) : mat;
    for (const s of [-1, 1]) g.add(sph(0.030, ear, s*0.058, HEAD.y + 0.062, -0.004));
    for (const s of [-1, 1]) g.add(sph(0.013, EYE, s*0.031, HEAD.y + 0.014, 0.068));
    if (type === 'panda')
      for (const s of [-1, 1]) g.add(sph(0.026, pm(0x2b2b33), s*0.033, HEAD.y + 0.012, 0.058, 1, 1.25, 0.5));
  } else {
    for (const s of [-1, 1]){
      const e = sph(0.028, mat, s*0.052, HEAD.y + 0.068, 0, 1, 1.35, 0.7);
      e.rotation.z = s*0.30; g.add(e);
    }
    for (const s of [-1, 1]) g.add(sph(0.013, EYE, s*0.031, HEAD.y + 0.014, 0.068));
  }
  // muzzle, arms, feet
  g.add(sph(0.030, light, 0, HEAD.y - 0.018, 0.062, 1.2, 0.85, 1));
  g.add(sph(0.010, EYE,   0, HEAD.y - 0.010, 0.084));
  g.add(sph(0.055, light, 0, BODY.y + 0.010, 0.070, 1.1, 1.25, 0.7));
  for (const s of [-1, 1]) g.add(sph(0.042, mat, s*0.108, BODY.y + 0.030, 0.010, 1, 1.35, 1));
  for (const s of [-1, 1]) g.add(sph(0.048, mat, s*0.058, BODY.y - 0.098, 0.020));

  return { group: g, spheres };
}

/* ============================================================== machine === */
export class BigPrizeMachine {
  constructor(opts = {}){
    // The prize cannot be lifted off the bar by any grip — it is threaded on.
    // `strength` therefore buys DRAG, not carry: how far along the bar one play
    // walks the ring. `hold` is what is left of it once the claw starts moving,
    // which is where the drag actually happens.
    this.opts = { seed: 0, strength: 1.20, hold: 0.65, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'big-prize-machine';
    this.world = new World({ gravity: -9.81, velIters: 14, posIters: 5 });

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
      // Turned a quarter so the prongs work ACROSS the bar, one in front of the
      // prize and one behind. Left at the default they would come down on the
      // bar's own line and clamp the bar instead of the prize.
      prongYaw: Math.PI/2,
      strength: this.opts.strength,
      holdScale: this.opts.hold,
      dropSpeed: 0.38, closeTime: 0.90,
      prong: {
        // Long, because the hub has to stay above the bar while the tips reach
        // 360 mm below it to the prize's shoulders.
        hingeR: 0.060, hingeDrop: 0.050,
        profile: [[0, 0], [0.085, 0.220], [0.060, 0.430]],
        rUpper: 0.026, rLower: 0.024,
        open: -0.15, close: 0.45,
        inertia: 0.035, w0: 2.6,
      },
    });
    this.rig.hub = this.world.addCollider(new BoxCollider([0,0,0], [0.075, 0.045, 0.075],
      null, { friction: 0.35, restitution: 0.05 }));
    this.rig.hub.kinematic = true;
    this.rig.hub.reaction = new V3();
    this.rig.hub.pointVel = (p, out) => out.copy(this.rig.headVel);

    this.rig.buildButtons(0.11, 0.340, SPEC.depth/2 + 0.016);
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

  /* ------------------------------------------------------------ physics -- */
  _buildColliders(){
    const W = this.world, S = SPEC, B = S.bar;
    const steel = { friction: 0.25, restitution: 0.03 };   // chromed: the ring slides
    const glass = { friction: 0.20, restitution: 0.10 };
    const pan   = { friction: 0.55, restitution: 0.05 };

    // THE BAR, and the stopper on its free end. The stopper is a degenerate
    // capsule, which CapsuleCollider handles as a plain sphere.
    // The curve is a polyline of capsules; neighbours share an endpoint so the
    // ring never falls into a gap between them.
    this.bar = [];
    for (let i = 0; i < B.segs; i++){
      const x0 = B.anchorX + (B.endX - B.anchorX) * (i / B.segs);
      const x1 = B.anchorX + (B.endX - B.anchorX) * ((i+1) / B.segs);
      this.bar.push(W.addCollider(new CapsuleCollider(
        [x0, barYat(x0), B.z], [x1, barYat(x1), B.z], B.r, steel)));
    }
    this.collar = W.addCollider(new CapsuleCollider(
      [B.collarX, barYat(B.collarX), B.z], [B.collarX, barYat(B.collarX), B.z],
      B.collarR, steel));
    // the post the bar is anchored into, set back far enough that the prize
    // cannot reach it even when parked against the collar
    W.addCollider(new BoxCollider([B.anchorX + 0.060, (S.panY + B.anchorY)/2, B.z],
      [0.030, (B.anchorY - S.panY)/2, 0.030], null, steel));

    // cage
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.03), 1.00, 0], [0.03, 0.62, S.inZ + 0.03], null, glass));
    for (const sz of [-1, 1]) W.addCollider(new BoxCollider(
      [0, 1.00, sz*(S.inZ + 0.03)], [S.inX + 0.03, 0.62, 0.03], null, glass));
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));

    // The catch pan IS the floor. There is no deck in this cabinet — anything
    // that comes off the bar has been won, so nothing needs a chute mouth.
    W.addCollider(new BoxCollider([0, S.panY - 0.02, 0],
      [S.inX, 0.02, S.inZ], null, pan));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  _loadPrizes(){
    const S = SPEC, B = S.bar;
    const t = PRIZE_TYPES[this.opts.seed % PRIZE_TYPES.length];
    const art = makePrize(t.key, t.color);

    const b = new Body(art.spheres, {
      mass: 1.15, friction: 0.55, restitution: 0.03,
      // It hangs, so it is a pendulum. Without real angular damping it swings
      // for the whole play and the next grab is aiming at a moving target.
      linDamp: 0.30, angDamp: 3.2,
    });
    b.tag = 'prize';
    b.prize = { ...t };
    b.won = false;

    // Threaded on the bar near the anchored end, hanging at rest: the ring's
    // inner top rests on the bar's crown.
    //
    // `setPos` positions the CENTRE OF MASS, and Body re-centres its cluster on
    // it — so the ring, authored at the local origin, ends up at -comOffset.y
    // above the body position. Get that sign backwards (it was, first time) and
    // the prize is seeded a whole body-length too high, lands ON the bar
    // instead of hanging from it, and sits there balanced and immovable.
    const sx = B.anchorX - 0.16;
    b.setPos(sx, barYat(sx) - (RING.r - RING.seg) + b.comOffset.y, B.z);

    const holder = new THREE.Group();
    art.group.position.copy(b.comOffset).negate();
    holder.add(art.group);
    holder.userData.pick = 'prize';
    b.mesh = holder;
    this.prizeLayer.add(holder);

    this.world.add(b);
    this.prizes.push(b);
    for (let i = 0; i < 220; i++) this.world.substep(this.world.cfg.fixedDt);
    b.syncMesh();
  }

  /** World position of the tag ring — the mean of the ring's own spheres. */
  ringPos(b, out = _u){
    out.set(0, 0, 0);
    for (let i = 0; i < RING.n; i++) out.add(b.spheres[i].w);
    return out.divideScalar(RING.n);
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const S = SPEC, B = S.bar, root = this.root;
    this.prizeLayer = new THREE.Group();
    root.add(this.prizeLayer);

    const body   = new THREE.MeshStandardMaterial({ color:0x0f3b46, roughness:.44, metalness:.45 });
    const trim   = new THREE.MeshStandardMaterial({ color:0x7ce38b, roughness:.40, metalness:.35 });
    const dark   = new THREE.MeshStandardMaterial({ color:0x081c22, roughness:.85 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xdce6f2, roughness:.14, metalness:.98 });
    const panM   = new THREE.MeshStandardMaterial({ color:0x123039, roughness:.8, metalness:.15 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    this.MAT = { body, trim, dark, chrome, panM, glass };

    const box = (w,h,d,m,x,y,z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); root.add(o); return o;
    };

    // plinth, and a frame cap rather than a slab so the pan reads as recessed
    box(S.width, S.panY - 0.04, S.depth, body, 0, (S.panY - 0.04)/2, 0);
    const cw = 0.07, CW = S.width + 0.02, CD = S.depth + 0.02;
    const capY = S.panY - 0.015;
    for (const sz of [-1, 1]) box(CW, 0.05, cw, trim, 0, capY, sz*(CD - cw)/2);
    for (const sx of [-1, 1]) box(cw, 0.05, CD - cw*2, trim, sx*(CW - cw)/2, capY, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, dark, 0, 0.040, 0);

    // the catch pan, lit from below so a won prize is unmissable
    box(S.inX*2, 0.02, S.inZ*2, panM, 0, S.panY - 0.01, 0);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(S.inX*1.9, S.inZ*1.9),
      new THREE.MeshStandardMaterial({ color:0x00ffc8, emissive:0x00ffc8,
        emissiveIntensity:0.6, roughness:.5, transparent:true, opacity:.22 }));
    glow.rotation.x = -Math.PI/2;
    glow.position.set(0, S.panY + 0.002, 0);
    root.add(glow);
    this.panGlow = glow;

    // THE BAR + its post + the stopper ball
    for (let i = 0; i < B.segs; i++){
      const x0 = B.anchorX + (B.endX - B.anchorX) * (i / B.segs);
      const x1 = B.anchorX + (B.endX - B.anchorX) * ((i+1) / B.segs);
      const y0 = barYat(x0), y1 = barYat(x1);
      const L = Math.hypot(x1-x0, y1-y0);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(B.r, B.r, L*1.06, 12), chrome);
      seg.position.set((x0+x1)/2, (y0+y1)/2, B.z);
      seg.quaternion.setFromUnitVectors(new V3(0,1,0), new V3(x1-x0, y1-y0, 0).normalize());
      root.add(seg);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(B.r*1.6, 14, 10), chrome);
    cap.position.set(B.endX, barYat(B.endX), B.z);
    root.add(cap);
    box(0.060, B.anchorY - S.panY + 0.04, 0.060, chrome,
        B.anchorX + 0.060, (S.panY + B.anchorY)/2, B.z);
    const collar = new THREE.Mesh(new THREE.SphereGeometry(B.collarR, 16, 12), chrome);
    collar.position.set(B.collarX, barYat(B.collarX), B.z);
    root.add(collar);

    // cage
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
      new THREE.MeshStandardMaterial({ color:0x0a2730, roughness:.7 }),
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

    // coin slot + the delivery mouth, which on this cabinet is the whole front
    const coin = box(0.055, 0.075, 0.02, dark, -0.30, 0.165, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x0a2218, emissive:0x7ce38b, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.30, 0.110, S.depth/2 + 0.012);
    root.add(this.coinLamp);
  }

  _marqueeTexture(){
    if (this._mqTex) return this._mqTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#7ce38b'); grd.addColorStop(.5, '#37e6ff'); grd.addColorStop(1, '#ffd166');
    g.fillStyle = '#04121a'; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
    g.globalAlpha = .18; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(560,0); g.lineTo(780,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 112px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(4,10,18,.85)';
    g.strokeText('大型', 512, 100); g.fillStyle = '#fff'; g.fillText('大型', 512, 100);
    g.font = `bold 34px ${JP_FONT}`;
    g.fillText('タグ掛け  ·  BIG PRIZE  ·  ¥100', 512, 196);
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
    this.panGlow.material.emissiveIntensity = 0.5 + Math.sin(performance.now()*0.003)*0.25;

    for (const b of this.prizes) if (!b.won) b.syncMesh();
    this._checkPrizes();
    if (this.debug && this.debug.visible) this.updateDebug();
  }

  /**
   * The prize is won when it is off the bar — tested on the RING, not on the
   * prize. There is no chute mouth here, and height alone is not enough to
   * separate the two states: a prize hanging at the low end of the bar and one
   * lying in the pan are only 130 mm apart. The ring having passed the free end
   * is unambiguous — and it is the ONLY safe test. A height threshold generous
   * enough to catch a fallen prize also catches one still hanging at the low
   * end of the bar, which handed out a win on the first coin.
   */
  _checkPrizes(){
    for (const b of this.prizes){
      if (b.won) continue;
      if (this.ringPos(b).x < SPEC.bar.endX - 0.010){
        b.won = true;
        this.wins++;
        this.collected.push(b.prize);
        if (this.onWin) this.onWin(b.prize);
      }
    }
  }

  /** How far the ring still has to travel to reach the stopper, in metres. */
  get toEnd(){
    const live = this.prizes.filter(p => !p.won);
    if (!live.length) return null;
    return +(this.ringPos(live[0]).x - SPEC.bar.endX).toFixed(3);
  }

  reset(){
    for (const b of this.prizes){ this.world.remove(b); this.prizeLayer.remove(b.mesh); }
    this.prizes.length = 0;
    this.rig.reset();
    // Restock with the next prize in the list. Safe to do mid-measurement: all
    // four types share one collider cluster and one mass, so they differ in
    // artwork only and cannot skew a play count.
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
    for (const cap of this.bar.concat([this.collar])){
      _u.copy(cap.b).sub(cap.a);
      const L = _u.length();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(cap.r, L, 4, 12), mat);
      m.position.copy(cap.a).addScaledVector(_u, 0.5);
      if (L > 1e-6) m.quaternion.setFromUnitVectors(new V3(0,1,0), _u.clone().normalize());
      g.add(m);
    }
    // the prize cluster — the ring is the part worth being able to see
    this._dbgPrize = [];
    for (const b of this.prizes) for (const s of b.spheres){
      const m = new THREE.Mesh(new THREE.SphereGeometry(s.r, 10, 8), mat);
      g.add(m); this._dbgPrize.push({ m, s });
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
    for (const d of this._dbgPrize) d.m.position.copy(d.s.w);
    this.rig.updateDebug();
  }
}

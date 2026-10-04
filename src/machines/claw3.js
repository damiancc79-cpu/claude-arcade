/* ============================================================================
   machines/claw3.js — 三本爪 (sanbonzume), the three-prong plush catcher.

   The machine everyone pictures when they hear "claw machine", and the only
   one on this floor where LIFTING the prize is the actual plan. Three thin
   hooks 120° apart can genuinely cup a plush; two broad blades never can. So
   unlike 二本爪 — where you shove a box across the deck over several plays —
   here a play either carries the prize or it doesn't.

   What makes it hard is not the aim — measured, aim jitter of 8 mm and 40 mm
   give the same play count inside noise. It is the grip, and the SIZE of the
   prize against the claw:

     · the claw opens to 226 mm against prizes 155–240 mm across. That ratio is
       the difficulty. Open it wider and the hooks drop cleanly around anything,
       reach the deck beside it, and scoop it home on the metal — at which point
       the grip setting stops mattering at all (see the note on `open`)
     · the motor has two settings, as a real cabinet does: a firm CLOSE and a
       much weaker HOLD for everything after it. The close takes a confident
       grip; the hold is below what most of the stock weighs
     · a failed grab still moves the prize a median 27 mm, so the other real
       arcade line stays open: 寄せ — work a plush toward the chute over several
       plays and push it over the kerb

   Prizes are sphere clusters, not boxes: two to five overlapping spheres per
   plush, which is what lets them nest into a pile, roll off each other, and
   catch on a hook by an ear.

   Measured over 32 restocked sessions, all of which converged: median 18–19
   plays, range 5–42, wins split roughly 60/40 between a clean carry and a prize
   worked over the kerb. README.md records what three earlier versions of this
   machine got wrong and why.

   Uses the shared ClawRig with prongCount: 3.
   Model contract: base on y = 0, front facing +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, BoxCollider, PlaneCollider } from '../physics.js';
import { ClawRig } from './clawrig.js';

const V3 = THREE.Vector3;

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width : 0.98, depth : 0.92, height: 1.90,

  floorY : 0.640,                        // playfield deck
  cageTop: 1.600,
  inX    : 0.420, inZ: 0.380,

  // prize chute, front-left — the player watches the plush drop through the glass
  chute  : { x0: -0.420, x1: -0.160, z0: 0.100, z1: 0.380 },

  railY  : 1.500,
  headTop: 1.430,
  // The open prong tips hang 203 mm below the head, so this puts them level
  // with the deck: the claw can reach the floor beside a plush rather than
  // only pawing at its top. Raise it and every grab becomes a scalp.
  headMin: 0.843,

  limX   : [-0.300, 0.340],
  limZ   : [-0.300, 0.260],
  homeX  : -0.290, homeZ: 0.240,         // parked over the chute
};

/** Height of the raised rim around the chute mouth — see _buildColliders. */
const KERB = 0.030;

const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

/* ---------------------------------------------------------------- plush --- */
const PALETTE = [
  0xff5c8a, 0xffd166, 0x7ce38b, 0x6ec3ff, 0xc792ea,
  0xff9f6e, 0x5fe1c0, 0xff7ad9, 0x8fa4ff,
];

/**
 * One factor scales BOTH the art and the collider, so they can never drift
 * apart — and it is the ratio that decides whether this machine is a machine
 * at all. Measured: at scale 1.0 the plush were ~130 mm across against a claw
 * that closes to a ~100 mm cup, and the three hooks simply cradled every prize
 * — 1 play to win at any motor strength, including one twelfth of the final
 * setting. A real cabinet runs a ~60 mm closed claw against a 200 mm plush.
 * At 1.35 the prizes are ~230 mm and the claw has to actually grip.
 */
const PLUSH_SCALE = 1.35;

/**
 * The stock list. `mass` and `friction` live here rather than in the art
 * because they are what the machine is actually stocked BY: mass/friction is
 * the grip a prize needs before it can be lifted, and it spans nearly 3× from
 * the fleece star to the satin jumbo cushion. The cabinet uses that ordering
 * to lay the field out, so it has to be readable without building any meshes.
 *
 * Masses are stated rather than derived from the cluster: a plush is mostly
 * air, and summed sphere volume is a bad proxy for it.
 */
export const PRIZE_TYPES = [
  { key:'bear',    jp:'くまのぬいぐるみ',   en:'BEAR PLUSH',       mass:0.265, friction:0.62 },
  { key:'bunny',   jp:'うさぎのぬいぐるみ', en:'BUNNY PLUSH',      mass:0.215, friction:0.62 },
  { key:'penguin', jp:'ペンギン',           en:'PENGUIN PLUSH',    mass:0.245, friction:0.52 },
  { key:'ball',    jp:'特大クッション',     en:'JUMBO CUSHION',    mass:0.310, friction:0.34 },
  { key:'worm',    jp:'ながいもいもむし',   en:'LONG CATERPILLAR', mass:0.175, friction:0.70 },
  { key:'star',    jp:'ほしのクッション',   en:'STAR CUSHION',     mass:0.155, friction:0.78 },
];

/** Grip a prize needs before it can be lifted — the stocking order. */
const hardness = t => t.mass / t.friction;

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

const pm = (c, rough = 0.94) =>
  new THREE.MeshStandardMaterial({ color:c, roughness:rough, metalness:0 });
const EYE = new THREE.MeshStandardMaterial({ color:0x1b1520, roughness:0.35 });

function sph(r, mat, x, y, z, sx = 1, sy = 1, sz = 1){
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  return m;
}
function eyes(g, y, z, dx, r = 0.008){
  for (const s of [-1, 1]) g.add(sph(r, EYE, s*dx, y, z));
}

/**
 * One plush: the art group and the collision cluster that matches it.
 *
 * Collider spheres are deliberately few — body, head, and on the bunny the
 * ears. Ears as real geometry matter: hooking one is how a light plush comes
 * off a pile, and without them the bunny plays identically to the bear.
 */
function makePlush(type, color){
  const g = new THREE.Group();
  const mat = pm(color);
  const light = pm(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex());
  let spheres;

  if (type === 'bear'){
    g.add(sph(0.062, mat, 0, 0, 0, 1, 1.04, 0.94));
    g.add(sph(0.044, mat, 0, 0.078, 0));
    for (const s of [-1, 1]) g.add(sph(0.019, mat,  s*0.032, 0.108, -0.003));
    for (const s of [-1, 1]) g.add(sph(0.010, light, s*0.032, 0.108, 0.006));
    g.add(sph(0.020, light, 0, 0.068, 0.034, 1.15, 0.85, 1));
    g.add(sph(0.007, EYE,   0, 0.074, 0.050));
    eyes(g, 0.088, 0.037, 0.017);
    for (const s of [-1, 1]) g.add(sph(0.025, mat, s*0.064, 0.007, 0.007, 1, 1.25, 1));
    for (const s of [-1, 1]) g.add(sph(0.027, mat, s*0.034, -0.053, 0.009));
    spheres = [{ o:[0, 0, 0], r:0.064 }, { o:[0, 0.078, 0], r:0.046 }];
  }
  else if (type === 'bunny'){
    g.add(sph(0.056, mat, 0, 0, 0, 1, 1.06, 0.95));
    g.add(sph(0.041, mat, 0, 0.072, 0));
    for (const s of [-1, 1]){
      const ear = sph(0.016, mat, s*0.019, 0.126, -0.004, 1, 2.5, 0.6);
      ear.rotation.z = s*0.28; g.add(ear);
      const inr = sph(0.009, light, s*0.021, 0.126, 0.005, 1, 2.4, 0.6);
      inr.rotation.z = s*0.28; g.add(inr);
    }
    eyes(g, 0.080, 0.035, 0.016);
    g.add(sph(0.008, light, 0, 0.070, 0.039));
    for (const s of [-1, 1]) g.add(sph(0.021, mat, s*0.056, 0, 0.007));
    for (const s of [-1, 1]) g.add(sph(0.025, mat, s*0.029, -0.049, 0.015, 1.3, 0.8, 1.5));
    g.add(sph(0.019, light, 0, -0.020, -0.055));
    // the ears are colliders too — hooking one is how you win a bunny
    spheres = [{ o:[0, 0, 0], r:0.058 }, { o:[0, 0.072, 0], r:0.043 },
               { o:[-0.019, 0.126, 0], r:0.020 }, { o:[0.019, 0.126, 0], r:0.020 }];
  }
  else if (type === 'penguin'){
    g.add(sph(0.058, mat, 0, 0, 0, 0.92, 1.12, 0.88));
    g.add(sph(0.040, light, 0, -0.004, 0.026, 0.72, 0.98, 0.6));
    g.add(sph(0.042, mat, 0, 0.071, 0));
    g.add(sph(0.028, light, 0, 0.063, 0.024, 0.85, 0.85, 0.7));
    eyes(g, 0.081, 0.033, 0.015, 0.007);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.029, 10), pm(0xffb03a, 0.7));
    beak.rotation.x = Math.PI/2; beak.position.set(0, 0.068, 0.046);
    g.add(beak);
    for (const s of [-1, 1]){
      const w = sph(0.017, mat, s*0.055, -0.004, 0, 0.55, 1.6, 1.0);
      w.rotation.z = s*0.22; g.add(w);
    }
    for (const s of [-1, 1]) g.add(sph(0.017, pm(0xffb03a, 0.7), s*0.024, -0.063, 0.019, 1.1, 0.5, 1.6));
    // satin body: the collider is plain, the low friction is in PRIZE_TYPES
    spheres = [{ o:[0, 0, 0], r:0.059 }, { o:[0, 0.071, 0], r:0.044 }];
  }
  else if (type === 'ball'){
    // THE BAIT. A 240 mm floor cushion, and the point of it is that it is
    // WIDER than the claw opens (226 mm at the tips): the hooks land on top of
    // it and can never get underneath, so it cannot be lifted at all — only
    // shoved, and only over the kerb.
    //
    // It was a single 180 mm sphere first, on the theory that a slick satin
    // cover would make it the hardest prize in the cabinet. The opposite
    // happened. A lone sphere nests perfectly into three closing hooks and is
    // carried by the cone they form, with friction never entering into it:
    // stocked nearest the chute it was carried home on the FIRST COIN in 5
    // sessions out of 8. Roundness is what makes a prize easy here, not hard.
    g.add(sph(0.062, mat, 0, 0, 0, 1.42, 0.72, 1.42));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.010, 8, 32), light);
    band.rotation.x = Math.PI/2; g.add(band);
    g.add(sph(0.024, light, 0, 0.044, 0, 1, 0.30, 1));
    g.add(sph(0.024, light, 0, -0.044, 0, 1, 0.30, 1));
    spheres = [{ o:[0, 0, 0], r:0.044 },
               { o:[ 0.044, 0, 0], r:0.044 }, { o:[-0.044, 0, 0], r:0.044 },
               { o:[0, 0,  0.044], r:0.044 }, { o:[0, 0, -0.044], r:0.044 }];
  }
  else if (type === 'worm'){
    for (let i = 0; i < 3; i++){
      const r = i === 0 ? 0.044 : 0.040;
      g.add(sph(r, i === 1 ? light : mat, -0.048 + i*0.048, 0, 0));
    }
    eyes(g, 0.015, 0.030, 0.015, 0.007);
    g.add(sph(0.018, mat, -0.048, 0.039, 0, 1, 0.55, 1));
    // Long and low. A hook that lands across the middle picks it up cleanly —
    // the easy prize, and every cabinet has one.
    spheres = [{ o:[-0.048, 0, 0], r:0.045 }, { o:[0, 0, 0], r:0.041 },
               { o:[0.048, 0, 0], r:0.041 }];
  }
  else { // star
    g.add(sph(0.039, mat, 0, 0, 0));
    for (let i = 0; i < 5; i++){
      const ang = (i/5)*Math.PI*2 + Math.PI/2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.054, 8), mat);
      spike.position.set(Math.cos(ang)*0.046, Math.sin(ang)*0.046, 0);
      spike.rotation.z = ang - Math.PI/2;
      g.add(spike);
    }
    eyes(g, 0.010, 0.034, 0.014, 0.007);
    g.add(sph(0.010, light, 0, -0.010, 0.033, 1.4, 0.7, 0.5));
    spheres = [{ o:[0, 0, 0], r:0.057 }];
  }

  const S = PLUSH_SCALE;
  g.scale.setScalar(S);
  spheres = spheres.map(s => ({ o:[s.o[0]*S, s.o[1]*S, s.o[2]*S], r:s.r*S }));
  return { group: g, spheres };
}

/* ============================================================== machine === */
export class ThreeProngMachine {
  constructor(opts = {}){
    // `strength` and `hold` are the operator's two power settings, and between
    // them they are the whole difficulty model. `strength` is the prong motor
    // torque during the CLOSE, set high enough to take a firm hold of anything
    // on the deck; `hold` is the fraction of it left once the claw starts
    // moving, and it is deliberately below what most of the stock weighs.
    // That split is what produces the near-miss this format is famous for —
    // the claw grips, lifts, and gives the prize up on the way home.
    this.opts = { prizes: 8, seed: 0, strength: 0.42, hold: 0.32, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'three-prong-machine';
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
      prongCount: 3,
      strength: this.opts.strength,
      holdScale: this.opts.hold,
      dropSpeed: 0.40, closeTime: 0.85,
      prong: {
        // Thin hooks on a small hinge circle, unlike the two-prong's broad
        // blades: they have to close around a plush, not shove a box.
        hingeR: 0.048, hingeDrop: 0.045,
        // A shallow J: the tip curls in only 14 mm relative to the elbow. The
        // first attempt curled it 36 mm and the machine was unwinnable-proof in
        // the wrong direction — the OPEN claw was already a basket, its tips
        // closer to the axis than its elbows, so a prize dropped in could not
        // pass back out. Measured: prizes carried home with the prongs still
        // sitting at their open stop, never having closed at all, at every
        // motor strength tried. Open, this profile is a slightly diverging
        // cone; the prize can always fall back out, and only the grip stops it.
        profile: [[0, 0], [0.050, 0.100], [0.036, 0.175]],
        rUpper: 0.020, rLower: 0.018,
        // 226 mm open across the tips, against prizes 155–180 mm across. Closed,
        // the hooks meet on the axis — but nothing on this cabinet is small
        // enough to let them get there, so a grab always stalls against the
        // prize and is held by friction, never by the mechanical stop.
        open: -0.28, close: 0.45,
        inertia: 0.010, w0: 3.2,
      },
    });
    // the head body itself, so it can bump a plush it lands on
    this.rig.hub = this.world.addCollider(new BoxCollider([0,0,0], [0.070, 0.045, 0.070],
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
    const W = this.world, S = SPEC, C = S.chute;
    // A grippy matted deck, not the two-prong's slick one, and the reason is
    // the same one an operator has for fitting it: at 0.42 a prong could shove
    // a plush 180 mm in a single play, so two lucky swipes emptied the cabinet.
    // At 0.70 the push a stalled prong can deliver is below what it takes to
    // slide a plush flat, so the claw has to get a hook under one to move it —
    // and 寄せ becomes centimetres a play instead of a bulldoze.
    const deck  = { friction: 0.70, restitution: 0.04 };
    const glass = { friction: 0.20, restitution: 0.10 };

    // Deck built as slabs around the chute mouth, so the hole is real geometry
    // rather than a scripted trigger.
    const fy = S.floorY;
    const slab = (x0, x1, z0, z1) => W.addCollider(new BoxCollider(
      [(x0+x1)/2, fy - 0.03, (z0+z1)/2], [(x1-x0)/2, 0.03, (z1-z0)/2], null, deck));
    slab(C.x1, S.inX, -S.inZ, S.inZ);          // everything right of the chute
    slab(-S.inX, C.x1, -S.inZ, C.z0);          // the strip behind it

    // THE KERB, and it is a difficulty dial in its own right. A rising hook
    // squeezes a plush sideways as it slides out from under it, and a slippery
    // one skates. At a 16 mm lip that alone dropped prizes in: measured, a
    // third of all wins arrived with nothing ever leaving the deck, which is
    // not what this machine is supposed to be about. At 30 mm a skated prize
    // stops against the rim and only a carried one goes in — but the rim is
    // still low enough that a prize deliberately worked at from the far side
    // can be pushed over it.
    W.addCollider(new BoxCollider([C.x1, fy + KERB/2, (C.z0+C.z1)/2],
      [0.008, KERB/2, (C.z1-C.z0)/2], null, deck));
    W.addCollider(new BoxCollider([(C.x0+C.x1)/2, fy + KERB/2, C.z0],
      [(C.x1-C.x0)/2, KERB/2, 0.008], null, deck));

    // cage
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.03), 1.10, 0], [0.03, 0.50, S.inZ + 0.03], null, glass));
    for (const sz of [-1, 1]) W.addCollider(new BoxCollider(
      [0, 1.10, sz*(S.inZ + 0.03)], [S.inX + 0.03, 0.50, 0.03], null, glass));
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));

    // catch bin under the chute + a floor of last resort
    W.addCollider(new BoxCollider([(C.x0+C.x1)/2, 0.30, (C.z0+C.z1)/2],
      [(C.x1-C.x0)/2, 0.02, (C.z1-C.z0)/2], null, deck));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  /** Stock the field. Layout is a difficulty setting — see the note below. */
  _loadPrizes(n){
    const S = SPEC, C = S.chute;
    const rand = rng(this.opts.seed * 977 + 13);

    // Three rows deep, front row short so nothing is seeded over the chute —
    // a prize dropped through during the settle is a free win before the
    // machine has taken a coin.
    const slots = [];
    for (const z of [-0.250, -0.040, 0.165]){
      for (const x of [-0.265, -0.020, 0.225]){
        // Keep a bare landing strip around the chute mouth, the way an operator
        // stocks one. Not just to avoid a prize dropping through during the
        // settle — a plush seeded ON the lip is won by the first grab that
        // touches it, which makes the machine's difficulty unmeasurable.
        if (x < C.x1 + 0.16 && z > C.z0 - 0.12) continue;
        slots.push([x, z]);
      }
    }

    // WHICH prize goes WHERE, and it is a real operator decision rather than a
    // detail. The awkward stock — the heavy penguin, the satin round cushion —
    // goes nearest the chute, and the light grippy stock goes to the back of
    // the field where the claw has the furthest to carry it. Stocked the other
    // way round (or at random, which is the same thing on average) a quarter of
    // all sessions ended on the very first coin, because the easiest prize in
    // the cabinet happened to be sitting on the edge of the hole.
    slots.sort((a, b2) =>
      Math.hypot(a[0]-S.homeX, a[1]-S.homeZ) - Math.hypot(b2[0]-S.homeX, b2[1]-S.homeZ));
    const stock = Array.from({ length: n },
      (_, i) => PRIZE_TYPES[(this.opts.seed + i) % PRIZE_TYPES.length])
      .sort((a, b2) => hardness(b2) - hardness(a));
    // Overflow stacks on the FAR end of the field, not the near end. Running
    // the second tier near-to-far instead put the easiest prize in the cabinet
    // on top of the pile closest to the chute, which halved the play count.
    const places = Array.from({ length: n }, (_, i) => {
      const tier = Math.floor(i / slots.length), j = i % slots.length;
      return { slot: slots[tier % 2 ? slots.length - 1 - j : j], tier };
    });

    for (let i = 0; i < n; i++){
      const t = stock[i];
      const color = PALETTE[(this.opts.seed * 3 + i * 5) % PALETTE.length];
      const art = makePlush(t.key, color);

      const b = new Body(art.spheres, {
        mass: t.mass, friction: t.friction, restitution: 0.05,
        // Heavy damping, and not for stability: a plush is a soft bag that
        // deforms against the deck, so it does not roll or skate the way a
        // sphere cluster otherwise would. Left at marble-like values, a nudged
        // round cushion coasted 200 mm and fell in the chute on its own.
        linDamp: 0.45, angDamp: 4.0,
      });
      b.tag = 'prize';
      b.prize = { ...t, color };
      b.won = false;

      const [sx, sz] = places[i].slot;
      const tier = places[i].tier;                          // second layer piles on top
      b.setPos(sx + (rand()-0.5)*0.05,
               S.floorY + 0.115 + tier * 0.215,
               sz + (rand()-0.5)*0.05);
      b.quat.setFromEuler(new THREE.Euler(
        (rand()-0.5)*0.5, rand()*Math.PI*2, (rand()-0.5)*0.5));
      b.updateTransform();

      // The Body re-centres its cluster on the centre of mass, so the art has
      // to be shifted back by the same amount or it floats off the collider.
      const holder = new THREE.Group();
      art.group.position.copy(b.comOffset).negate();
      holder.add(art.group);
      holder.userData.pick = 'prize';
      b.mesh = holder;
      this.prizeLayer.add(holder);

      this.world.add(b);
      this.prizes.push(b);
    }
    for (let i = 0; i < 260; i++) this.world.substep(this.world.cfg.fixedDt);

    // A prize that rolled into the chute while the pile was settling would be
    // handed out for free by the first _checkPrizes() after the machine is
    // built. An operator would just put it back on the deck, so we do too —
    // dropped in at the back, where nothing is in the way, and settled again.
    for (const b of this.prizes){
      if (b.pos.y > S.floorY - 0.02) continue;
      b.vel.set(0,0,0); b.avel.set(0,0,0);
      b.setPos(C.x1 + 0.14 + rand()*0.18, S.floorY + 0.16, -S.inZ + 0.12 + rand()*0.06);
      for (let i = 0; i < 140; i++) this.world.substep(this.world.cfg.fixedDt);
    }
    for (const b of this.prizes) b.syncMesh();
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const S = SPEC, C = S.chute, root = this.root;
    this.prizeLayer = new THREE.Group();
    root.add(this.prizeLayer);

    // A pearl-white cabinet with pink trim — the UFO-catcher house style, and
    // it keeps this machine legible in a row of dark two-prong cabinets.
    const body   = new THREE.MeshStandardMaterial({ color:0xece2ea, roughness:.48, metalness:.25 });
    const trim   = new THREE.MeshStandardMaterial({ color:0xff4f9b, roughness:.42, metalness:.35 });
    const dark   = new THREE.MeshStandardMaterial({ color:0x2a2138, roughness:.85 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xc8d0e2, roughness:.22, metalness:.95 });
    const deckM  = new THREE.MeshStandardMaterial({ color:0x37325e, roughness:.80, metalness:.12 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    this.MAT = { body, trim, dark, chrome, deckM, glass };

    const box = (w,h,d,m,x,y,z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); root.add(o); return o;
    };

    // plinth. The cap is a FRAME, not a slab: a solid one sits a centimetre
    // under the deck and shows through the chute mouth, so the hole reads as a
    // painted ellipse instead of an opening.
    box(S.width, 0.60, S.depth, body, 0, 0.30, 0);
    const cw = 0.07, CW = S.width + 0.02, CD = S.depth + 0.02;
    for (const sz of [-1, 1]) box(CW, 0.06, cw, trim, 0, 0.615, sz*(CD - cw)/2);
    for (const sx of [-1, 1]) box(cw, 0.06, CD - cw*2, trim, sx*(CW - cw)/2, 0.615, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, dark, 0, 0.040, 0);

    // deck, in slabs around the chute
    const deckSlab = (x0,x1,z0,z1) =>
      box(x1-x0, 0.02, z1-z0, deckM, (x0+x1)/2, S.floorY - 0.01, (z0+z1)/2);
    deckSlab(C.x1, S.inX, -S.inZ, S.inZ);
    deckSlab(-S.inX, C.x1, -S.inZ, C.z0);

    // the kerb, drawn where the collider actually is
    box(0.016, KERB, C.z1-C.z0, trim, C.x1, S.floorY + KERB/2, (C.z0+C.z1)/2);
    box(C.x1-C.x0, KERB, 0.016, trim, (C.x0+C.x1)/2, S.floorY + KERB/2, C.z0);

    // glowing chute rim + a dark shaft so the hole reads as a hole
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.009, 8, 40),
      new THREE.MeshStandardMaterial({ color:0x00ffc8, emissive:0x00ffc8,
        emissiveIntensity:2.2, roughness:.4 }));
    rim.rotation.x = -Math.PI/2;
    rim.position.set((C.x0+C.x1)/2, S.floorY + KERB + 0.004, (C.z0+C.z1)/2);
    rim.scale.set((C.x1-C.x0)/0.32, 1, (C.z1-C.z0)/0.32);
    root.add(rim);
    this.rim = rim;
    box(C.x1-C.x0, 0.28, C.z1-C.z0,
      new THREE.MeshStandardMaterial({ color:0x05060f, roughness:1 }),
      (C.x0+C.x1)/2, S.floorY - 0.15, (C.z0+C.z1)/2);

    // cage
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
    pane(S.inZ*2, ch,  S.inX + 0.02, cy, 0, Math.PI/2);
    pane(S.inZ*2, ch, -S.inX - 0.02, cy, 0, Math.PI/2);
    box(S.inX*2 + 0.05, ch, 0.03,
      new THREE.MeshStandardMaterial({ color:0xf6eef4, roughness:.75 }),
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
    const coin = box(0.055, 0.075, 0.02, dark, -0.30, 0.50, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x220a12, emissive:0xff2f6e, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.30, 0.445, S.depth/2 + 0.012);
    root.add(this.coinLamp);
    box(0.28, 0.22, 0.02, dark, -0.27, 0.21, S.depth/2 - 0.005);
  }

  _marqueeTexture(){
    if (this._mqTex) return this._mqTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#37e6ff'); grd.addColorStop(.5, '#b1a4ff'); grd.addColorStop(1, '#ff7ad9');
    g.fillStyle = '#0b0720'; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
    g.globalAlpha = .20; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(560,0); g.lineTo(780,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 110px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(10,6,26,.85)';
    g.strokeText('三本爪', 512, 104); g.fillStyle = '#fff'; g.fillText('三本爪', 512, 104);
    g.font = 'bold 36px ui-monospace, monospace';
    g.fillText('THREE-PRONG  ·  ¥100', 512, 196);
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
    this.rim.material.emissiveIntensity = 1.6 + Math.sin(performance.now()*0.003)*0.7;

    for (const b of this.prizes) if (!b.won) b.syncMesh();
    this._checkPrizes();
    if (this.debug && this.debug.visible) this.rig.updateDebug();
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

  /** How far the closest live plush still is from the chute mouth — HUD + tuning. */
  get nearest(){
    const C = SPEC.chute;
    const cx = (C.x0+C.x1)/2, cz = (C.z0+C.z1)/2;
    let best = null;
    for (const b of this.prizes){
      if (b.won) continue;
      const d = Math.hypot(b.pos.x - cx, b.pos.z - cz);
      if (best === null || d < best) best = d;
    }
    return best;
  }

  /** True while the claw is holding a plush clear of the deck. */
  get carrying(){
    for (const b of this.prizes){
      if (b.won) continue;
      if (b.pos.y > SPEC.floorY + 0.24) return true;
    }
    return false;
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
    // plush clusters, so a pile that behaves oddly can be read directly
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
    for (const d of this._dbgPrizes) d.m.position.copy(d.s.w);
    this.rig.updateDebug();
  }
}

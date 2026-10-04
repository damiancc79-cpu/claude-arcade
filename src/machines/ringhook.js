/* ============================================================================
   machines/ringhook.js — リング掛け (ring-gake), the ring-hook setting.

   Every other crane on this floor wins by FRICTION: the claw squeezes a prize
   and the grip either survives the trip home or it does not. This one cannot
   squeeze anything. The prizes stand in a display rack 70 mm below the lowest
   point the claw can reach, and the only thing up at the claw's working height
   is a 56 mm steel hanger tab standing on each carton's lid:

        ◯ ← tab, hole facing the claw               claw sweeps ──►
        │
      ▓▓▓▓▓▓▓▓  ← boxed prize, in a trough it cannot climb out of
     ═══════════════════════════════════════════  rack

   So the claw's prongs are not prongs at all, they are HOOKS: a shank down past
   the tab and a barb pointing back up and inward. The claw straddles the prize,
   and as it closes, one barb sweeps horizontally through the tab. That is the
   whole machine. There is no second way to win: 60 deliberate near-misses moved
   every carton about a millimetre and won nothing, so unlike every other
   cabinet here there is no 寄せ line and a miss is worth exactly zero.

   THREE THINGS MEASUREMENT CONTRADICTED, all of them things this file used to
   assert, and all of them worth reading before changing anything:

     · THE HOOK DOES NOT THREAD THE HOLE. A hook and a ring SELF-CENTRE — the
       barb catches the inside of the tab and the rim cams the carton sideways
       until it drops through. So the hole is not the gate. Barb radius 8 → 12 mm
       against a 28 mm hole leaves the capture window at ±22 mm throughout.
     · WEIGHT MATTERS, and so does `strength` — but as CLIFFS, not dials. 450 g
       plays and 1 kg never wins at any aim; motor 0.50 never wins and 0.90 wins
       96%. What the motor buys is the shove to force the tab past the barb, and
       either it can or it cannot. See the note on `strength` below.
     · AIM IS EVERYTHING, and only on one axis. Along the sweep (x) the barb
       crosses at nearly the same height across a wide band; across it (z) the
       window is ±22 mm and nothing else decides a play. 三本爪's open thread is
       that aim barely matters there; here it is the only thing that does.

   THE DIFFICULTY IS FIXED, by two changes that only worked together. The tab
   HANGS on two anchored rods so it swings away instead of being cammed onto the
   barb, and the gantry runs at 0.65 m/s so the same window is worth less time.
   Measured at the floor's ±60 ms of release timing: single-play win rate 0.62 →
   0.23, sessions from a median of 1 to a median of 3.

   The hanging tab had been built and reverted once, because a third of captures
   ended with the prize stranded on the hook. That was never a tab problem —
   `ClawRig` was opening the prongs at the HOLD setting, so the claw had 0.30 N·m
   of opening against 0.53 N·m of load closing it. `releaseScale` fixed that
   independently (it was also the 1-in-15 jam on the rigid build), and with a
   real opening torque the same experiment strands nothing at all: 0 in 90.

   The tab is real collision geometry — eleven spheres in a circle — and it is
   its own body, slung from the carton on two `Link`s anchored at POINTS rather
   than centres. That is the one engine feature this cabinet needed.

   Uses the shared ClawRig, two hooks, `prongYaw` left at 0 so they work along
   ±X — the ring's hole faces the same way, which is the whole point.
   Model contract: base on y = 0, front facing +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, Link, BoxCollider, PlaneCollider, boxCluster } from '../physics.js';
import { ClawRig } from './clawrig.js';

const V3 = THREE.Vector3;

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width : 0.98, depth : 0.92, height: 1.90,

  deckY  : 0.760,                     // rack floor
  cageTop: 1.600,
  inX    : 0.420, inZ: 0.380,

  // THE DELIVERY WELL is the whole front third of the playfield, and it is a
  // hole rather than a chute mouth in a deck. That is not a styling choice: a
  // prize can only ever be let go of at the park position or dropped off the
  // hook mid-return, and both happen over the front of the cabinet. Leaving a
  // strip of deck in front of the well gives a slipped prize somewhere to land
  // lying at an arbitrary yaw — and a ring turned across the claw's sweep is
  // unhookable with nothing in the cabinet able to turn it back. A cabinet
  // whose failure mode is a prize nobody can ever win again is the one thing
  // this floor has already spent a machine's worth of debugging on (see ヒモ in
  // STATUS.md), so there is no such strip: forward of the rack lip it is open
  // all the way to the glass.
  wellZ  : 0.035,

  railY  : 1.500,
  headTop: 1.430,
  // Set so the barb crosses the ring's plane at the ring's own centre height.
  // The barb hangs 157 mm under the head at the angle where it crosses the
  // rings' offset, and the rings stand at 0.903 — see RING/HOOK_DROP below. The
  // hub's underside then sits 86 mm over the rings, the barb passes 70 mm over
  // the prize lids and the crook 27 mm over them, so no part of the claw can
  // touch a prize except through its ring. Verified rather than asserted: 60
  // deliberate near-misses moved every carton by about a millimetre and won
  // nothing, so there is no second way to take a prize off this rack and no
  // 寄せ line either — a miss on this cabinet is worth exactly zero.
  headMin: 1.060,

  limX   : [-0.300, 0.260],
  limZ   : [-0.250, 0.140],
  homeX  : -0.265, homeZ: 0.130,      // parked over the well
};

/**
 * THE RACK. Two troughs running left-to-right, closed at both ends, with a
 * lip along the front that doubles as the edge of the delivery well.
 *
 * The troughs are 128 mm across against a prize 124 mm deep and 180 mm long,
 * and BOTH of those ratios are load-bearing.
 *
 * Long-vs-wide is the dead-state answer: a prize cannot lie across a trough, so
 * one that ends up back in the rack can only settle along it, which puts its
 * ring back in the claw's plane by itself. No equivalent of ヒモ's frozen cord
 * is reachable from any state this cabinet can get into.
 *
 * The 2 mm of side slack is the DIFFICULTY, and it was measured rather than
 * chosen. A hook and a ring SELF-CENTRE: a barb that arrives off-target still
 * touches the inside of the hole, and the rim then cams the prize sideways
 * until the barb drops through. At the 15 mm of slack the rack had first, that
 * camming absorbed the whole aim error — the capture window measured ±26 mm
 * against a hole only ±14 mm wide on the geometry, and every play from every
 * seed won. Narrowing the trough is worth more than anything done to the claw.
 *
 * The end walls are not decoration either. The barb sweeps inward, so a miss
 * shoves the prize left along its trough a few millimetres at a time; with the
 * rack open-ended a prize eventually walks past the gantry's limit and can
 * never be reached again. The stops are set inside the reachable band with the
 * prize's own half-length allowed for: 0.350 − 0.090 = 0.260, which is exactly
 * `limX[1]`.
 */
export const RACK = {
  ribZ : [0.020, -0.128, -0.276],     // front lip, divider, back rail
  ribT : 0.010, ribH: 0.055,
  endX : [-0.340, 0.360], endT: 0.010,
  lanes: [-0.054, -0.202],            // trough centres
  cols : [-0.175, 0.040, 0.255],      // station centres along a trough
};

/* The prize, in local metres, with the box's centre at the origin. */
const BOX   = { hx: 0.090, hy: 0.030, hz: 0.062 };
/** Lid to the tab's centre — the wire stalk that stands the tab up. */
const STALK = 0.055;
/**
 * THE RING — a 56 mm hanger tab with a 28 mm hole, against a 16 mm barb. On
 * geometry alone that is ±6 mm of aim across the sweep. Measured, the capture
 * window is ±22 mm, and the gap between those two numbers is the single most
 * important thing about this cabinet.
 *
 * DO NOT tune this by shrinking the hole. It was the obvious lever and it is not
 * one: the barb does not pass cleanly through a stationary hole, it cams the
 * carton onto itself, so what matters is whether the motor can shove — not
 * whether the barb fits. Sweeping barb radius 8 → 10 → 11 → 12 mm against this
 * same 28 mm hole left the window at ±22 mm at every step. Halving the rack's
 * side slack from 15 mm to 2 mm bought ±26 → ±22 and nothing more.
 *
 * Eleven spheres of 7 mm on a 21 mm circle sit 12.0 mm apart, so neighbours
 * overlap and the annulus is closed — a barb cannot slip between two of them.
 * And as with 大型's tag ring, the threading is only as good as the timestep: a
 * ring sphere that travels further than its own radius in one substep passes
 * straight through the barb. 7 mm at 1/120 is 0.84 m/s; the barb tip crosses
 * the ring plane at about 0.24 m/s, so there is a 3.5× margin. Make the ring
 * finer and that has to be re-checked.
 */
const RING  = { R: 0.021, seg: 0.007, n: 11 };
/**
 * The tab is 35 mm RIGHT of the carton's centre, and that offset is not
 * styling — it is what puts the claw's aim where a player's eye already is.
 *
 * The hook's barb sweeps inward through a band of x offsets, and the height it
 * crosses a ring's plane at depends on where in that band the ring sits: it
 * peaks 35–40 mm out from the claw's axis and falls away by 9 mm at the ends.
 * With the tab centred on the carton, aiming at the prize put the ring at the
 * very INNER end of that band — the barb arrived at full stretch, at the wrong
 * height, having spent its whole sweep getting there, and jammed against the
 * rim instead of going through. Measured: the pierce line passed within 3 mm of
 * the hole's centre on six runs out of six and only one of them won, which
 * reads as a z-aim problem and is nothing of the kind.
 *
 * Offsetting the tab moves the ring to the middle of the band instead, where
 * the barb is crossing at its lowest point and at its most level. Aim at the
 * prize and the geometry is now correct by construction.
 */
const RING_X = 0.035;

/** Tab centre above the carton centre. */
const RING_Y = BOX.hy + STALK + RING.R + RING.seg;

/**
 * THE TAB HANGS, on two 30 mm rods anchored at POINTS on both bodies — which is
 * what `Link`'s `ra`/`rb` offsets exist for. Two rods rather than one because a
 * tab hung from a single point has no restoring torque in yaw at all and would
 * keep whatever heading it was last knocked into, which is an unwinnable prize.
 * Verified in isolation: a 9 rad/s yaw kick is rejected completely while a
 * sideways shove still swings it +/-40 mm.
 *
 * This was built, measured and REVERTED once — see below — and is back because
 * the thing that killed it has since been fixed independently.
 */
const TAG_L = 0.030;
/** Carton-local height of the hanger arm the rods hang from. */
const MAST_Y = RING_Y + TAG_L;

/**
 * THE HISTORY, because it is the whole reason this shape is here.
 *
 * A rigid tab made this cabinet unwinnable-proof in the wrong direction: a hook
 * and a ring self-centre, so the barb cammed the carton onto itself whether or
 * not it found the hole and capture ran to +/-22 mm against a hole worth +/-6.
 * Hanging the tab cut capture from 0.94 to 0.65 — a real, measured improvement —
 * but a third of captures then ended with the prize still on the hook, because a
 * tab pinned into the crook by the carton's weight could not slide back off the
 * barb. That was disqualifying and the whole thing was reverted.
 *
 * It was never a tab problem. `ClawRig` was opening the prongs at the HOLD
 * setting, so the claw had 0.30 N.m of opening against 0.53 N.m of load closing
 * it — the same defect that later showed up on the rigid build as a 1-in-15 jam
 * and was fixed with `releaseScale`. With a real opening torque the tab sheds,
 * and the capture improvement is available without the bricking state.
 */

/**
 * How far under the head the barb sits when it crosses a ring standing at
 * `RING_X`. `SPEC.headMin` is derived from this and the rings' standing height,
 * and the pair is the single most load-bearing number in the file: get it wrong
 * by 10 mm and the barb rakes the rim on every play instead of going through.
 *
 * Measured off the profile below rather than chosen. The crossing height peaks
 * at this offset and falls ~9 mm away at either end of the usable band, which
 * is what sets the x tolerance at roughly ±35 mm — generous next to the ±6 mm
 * the hole allows across the sweep. That asymmetry IS the machine.
 */
const HOOK_DROP = 0.157;

const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

export const PRIZE_TYPES = [
  { key:'figure',  jp:'フィギュア',       en:'FIGURE BOX',     color:0xff5c8a },
  { key:'limited', jp:'限定フィギュア',   en:'LIMITED FIGURE', color:0xffd166 },
  { key:'mascot',  jp:'マスコット',       en:'MASCOT SET',     color:0x7ce38b },
  { key:'mug',     jp:'マグカップ',       en:'PRINTED MUG',    color:0x6ec3ff },
  { key:'stand',   jp:'アクリルスタンド', en:'ACRYLIC STAND',  color:0xc792ea },
  { key:'throw',   jp:'ひざかけ',         en:'FLEECE THROW',   color:0xff9f6e },
];

/** Deterministic RNG, so a restock lays the rack out the same way every time. */
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ art --- */
const artCache = new Map();

/** The printed lid of a boxed prize, drawn on canvas. */
function boxArt(type, color){
  const key = type.key + color;
  if (artCache.has(key)) return artCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 352;
  const g = c.getContext('2d');
  const hex = '#' + color.toString(16).padStart(6, '0');
  g.fillStyle = hex; g.fillRect(0, 0, 512, 352);
  const grd = g.createLinearGradient(0, 0, 512, 352);
  grd.addColorStop(0, 'rgba(255,255,255,.42)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 352);
  // a window die-cut, the way a real prize carton has one
  g.fillStyle = 'rgba(10,14,30,.30)';
  g.fillRect(150, 58, 212, 220);
  g.strokeStyle = 'rgba(255,255,255,.72)'; g.lineWidth = 7;
  g.strokeRect(150, 58, 212, 220);
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 44px ${JP_FONT}`;
  g.fillText(type.jp, 256, 312);
  g.font = 'bold 22px ui-monospace, monospace';
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillText('PRIZE', 256, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  artCache.set(key, tex);
  return tex;
}

/**
 * One prize: the art group and the cluster that matches it — carton plus tab,
 * one rigid body.
 *
 * The carton is `boxCluster` and the tab is eleven spheres. Eight corner spheres
 * would leave a gap down the middle of a 180 mm carton that a barb goes straight
 * through — that trap is written up in physics.js and applies here as much as
 * anywhere.
 */
function makePrize(type){
  const g = new THREE.Group();
  const tex = boxArt(type, type.color);
  const side = new THREE.MeshStandardMaterial({ color: type.color, roughness:.62, metalness:.05 });
  const lid  = new THREE.MeshStandardMaterial({ map: tex, roughness:.55, metalness:.05 });
  const chrome = new THREE.MeshStandardMaterial({ color:0xdfe7f5, roughness:.16, metalness:.96 });

  // carton — the printed face is the LID, because that is what a player sees
  // through the glass looking down into a rack
  const carton = new THREE.Mesh(
    new THREE.BoxGeometry(BOX.hx*2, BOX.hy*2, BOX.hz*2),
    [side, side, lid, side, side, side]);
  g.add(carton);

  // the hanger: a wire stalk and the ring itself, hole facing along ±X
  // The hanger arm: a post up from the lid and a crossbar the two rods hang
  // from. Visual only — the claw's shank sweeps through the volume it occupies,
  // and giving it geometry buys a jam rather than a mechanism.
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, MAST_Y - BOX.hy, 8), chrome);
  post.position.set(RING_X, (BOX.hy + MAST_Y)/2, 0);
  g.add(post);
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, RING.R*2, 6), chrome);
  bar.rotation.x = Math.PI/2;
  bar.position.set(RING_X, MAST_Y, 0);
  g.add(bar);

  return {
    group: g,
    spheres: boxCluster([BOX.hx, BOX.hy, BOX.hz], 0.030),
    tag: makeTag(chrome),
  };
}

/** The tab: its own body. The two rods are added when it is placed. */
function makeTag(chrome){
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(RING.R, RING.seg, 10, 30), chrome);
  ring.rotation.y = Math.PI/2;
  g.add(ring);
  for (const sz of [-1, 1]){
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, TAG_L, 5), chrome);
    rod.position.set(0, TAG_L/2, sz*RING.R);
    g.add(rod);
  }
  const spheres = [];
  for (let i = 0; i < RING.n; i++){
    const a = (i / RING.n) * Math.PI * 2;
    spheres.push({ o: [0, Math.cos(a)*RING.R, Math.sin(a)*RING.R], r: RING.seg });
  }
  return { group: g, spheres };
}

/* ============================================================== machine === */
export class RingHookMachine {
  constructor(opts = {}){
    // `strength` on this cabinet is a THRESHOLD, not a dial, and that is the
    // most surprising thing measurement turned up here.
    //
    // The expectation was that it would not matter at all: a hooked ring is
    // held by geometry, so the motor has nothing to grip with. What it actually
    // buys is the push to get the barb PAST the rim in the first place — the
    // hook does not thread a stationary hole so much as force the ring onto
    // itself, shoving the carton a millimetre or two out of the way as it goes.
    // Measured, single-play win rate at ±20 mm of aim:
    //
    //     0.045 → 0.00    0.15 → 0.00    0.30 → 0.00    0.50 → 0.00    0.90 → 0.96
    //
    // A cliff somewhere between 0.5 and 0.9 and nothing in between. Prize mass
    // behaves the same way from the other side — 450 g plays, 1 kg never wins at
    // any aim — because it is the same balance seen twice. Both are left well
    // clear of the edge deliberately: a cabinet tuned to sit ON that cliff would
    // be a coin-flip dressed up as a difficulty setting.
    this.opts = { seed: 0, strength: 0.90, hold: 0.55, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'ring-hook-machine';
    this.world = new World({ gravity: -9.81, velIters: 12, posIters: 4 });

    this.prizes = [];
    this.tags = [];
    this.picks = [];
    this.collected = [];
    this.wins = 0;
    this.lifts = 0;            // times a prize has come clear of the rack
    this.onWin = null;
    this.onPhase = null;

    this._buildVisuals();
    this._buildColliders();

    this.rig = new ClawRig(this.world, this.root, {
      inX: SPEC.inX, inZ: SPEC.inZ,
      railY: SPEC.railY, headTop: SPEC.headTop, headMin: SPEC.headMin,
      limX: SPEC.limX, limZ: SPEC.limZ, homeX: SPEC.homeX, homeZ: SPEC.homeZ,
      prongCount: 2,
      // Left at 0, so the hooks work along ±X — the axis the rings' holes face
      // and the axis the troughs run along. Turning the claw a quarter puts the
      // barbs across the ring and there is nothing to thread.
      prongYaw: 0,
      strength: this.opts.strength,
      holdScale: this.opts.hold,
      // THE OPENING IS ITS OWN SETTING HERE, and it has to be, because on this
      // cabinet the claw opens with a prize hanging off it. A tab seated in the
      // crook pulls the prong CLOSED with about 0.53 N·m; at the hold setting
      // the motor could only open with 0.30 N·m, so a shallow catch left the
      // claw stalled part way open at −0.75 rad — exactly the angle where the
      // barb goes horizontal — with the prize still on the hook. Measured 4
      // times in 130 plays at ±60 ms of aim, and 0 in 130 with the opening
      // torque raised. It is not a dead state (the next play shakes it off and
      // delivers it) but it costs the player a coin, and it is fixed rather than
      // documented now.
      //
      // Note it only ever showed up on a SLOPPY hook. At ±20 mm of aim it is 0
      // in 130, because a well-centred barb seats the tab deep in the crook
      // where it sheds cleanly; it is the marginal catch, perched near the tip,
      // that jams. Measure this one with the timing model, not the tight one.
      releaseScale: 1.6,
      // THE CLOSE HAS TO OUTLAST THE SWEEP, and on this cabinet that is a much
      // longer close than anywhere else. The hook travels 1.3 rad from its open
      // stop to the ring's plane, and `Arm` angles are integrated once per
      // FRAME while the motor is driven once per SUBSTEP — two substeps to a
      // frame — so the angle advances at half the rate `avel` suggests. At the
      // usual 0.85 s the barb was still short of the tab when the hoist started
      // lifting, and it caught the tab on the way UP instead of on the level.
      // That still won, which is what made it hard to spot: it won far too
      // often, because a barb rising through a ring catches the rim over a
      // ±30 mm band. The machine was measuring the wrong mechanism.
      // A FAST GANTRY, and it is the only difficulty lever on this cabinet that
      // survived being measured. Nothing about the mechanism changes: the same
      // ±22 mm capture window is simply worth less TIME. At the standard
      // 0.34 m/s that window is a ±65 ms release, which is not a demanding thing
      // to ask of anyone; at 0.65 it is ±34 ms.
      //
      // 0.55 is chosen for BEHAVIOUR, not for the biggest number. Two things
      // have to hold for a difficulty figure here to mean anything: a player who
      // aims perfectly must win, and more aim error must win less.
      //
      //     gantry       0.34   0.55   0.65   0.70   0.80
      //     perfect aim   1.00   1.00   1.00   0.67   0.00
      //     ±30 ms        0.97   0.75   0.48    —      —
      //     ±60 ms        0.87   0.73   0.55   0.46   0.10
      //     ±90 ms         —     0.43   0.50    —      —
      //
      // 0.65 still wins on perfect aim but its curve is FLAT — 0.48 / 0.55 /
      // 0.50 over a 3× range of aim error, which is a coin flip wearing a
      // difficulty number. By 0.70 perfect aim itself starts failing and the
      // cabinet is simply broken: past there the falling win rate is the head's
      // residual cable swing, not the player being examined.
      moveSpeed: 0.65,
      dropSpeed: 0.40, closeTime: 1.20,
      prong: {
        // A HOOK, not a prong: 150 mm of shank down past the ring, then a 52 mm
        // barb pointing back UP and INWARD (the tip is 38 mm inboard of the
        // elbow and 36 mm above it). The crook at the bottom is what carries the
        // prize; the barb is what stops the ring coming back off it.
        hingeR: 0.034, hingeDrop: 0.042,
        profile: [[0, 0], [0.024, 0.150], [-0.014, 0.114]],
        // The barb has to get through a 28 mm hole, so it is thin — thinner than
        // anything else on the floor. It is NOT a difficulty setting: 8 through
        // 12 mm all measured the same capture window.
        rUpper: 0.016, rLower: 0.008,
        // CHROMED, where every other cabinet's hooks are rubber-padded, and it
        // is a requirement rather than a finish. The ring has to slide back off
        // the barb when the claw opens over the well, and it only does that once
        // the barb points further below horizontal than the friction angle. At
        // the default µ 1.05 that is 46°, which this hinge cannot reach; at 0.22
        // it is 14°, and `open` below clears it by 5°.
        muUpper: 0.30, muLower: 0.22,
        // Opens to −63°. Wider than any other cabinet, and not for reach: this
        // is the angle at which the barb tips downward far enough to shed the
        // tab. Anything shallower and a won prize rides home and then stays on
        // the hook through the release.
        //
        // It is not quite enough. Measured over 120 plays, 8 of them (1 in 15)
        // end with the tab still jammed on the barb and the prong stopped part
        // way open at −0.75 rad, unable to finish. It is NOT a dead state — the
        // prize hangs there through any amount of idle time and is then shaken
        // off and delivered by the very next play, so it costs the player a coin
        // rather than a prize — but it is a real defect and it is not fixed.
        // An earlier 24-play check said "never", which is what a 7% fault looks
        // like when you do not take enough samples.
        open: -1.10, close: 0.45,
        // w0 is high for the same reason: the barb still only crosses the tab's
        // plane at ~0.24 m/s, which is a 3.5× margin on the 0.84 m/s that would
        // let a 7 mm ring sphere tunnel through it in one substep.
        inertia: 0.014, w0: 4.6,
      },
    });
    this.rig.hub = this.world.addCollider(new BoxCollider([0,0,0], [0.060, 0.040, 0.060],
      null, { friction: 0.35, restitution: 0.05 }));
    this.rig.hub.kinematic = true;
    this.rig.hub.reaction = new V3();
    this.rig.hub.pointVel = (p, out) => out.copy(this.rig.headVel);

    this.rig.buildButtons(0.11, 0.620, SPEC.depth/2 + 0.016);
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
    const W = this.world, S = SPEC, R = RACK;
    const rack  = { friction: 0.45, restitution: 0.04 };
    const glass = { friction: 0.20, restitution: 0.10 };

    // The rack floor. It stops at the well lip — forward of that there is
    // nothing at all between the claw and the catch bin.
    W.addCollider(new BoxCollider(
      [0, S.deckY - 0.03, (-S.inZ + S.wellZ)/2],
      [S.inX, 0.03, (S.wellZ + S.inZ)/2], null, rack));

    // ribs and end stops — the troughs
    this.rails = [];
    for (const z of R.ribZ){
      this.rails.push(W.addCollider(new BoxCollider(
        [0, S.deckY + R.ribH/2, z], [S.inX, R.ribH/2, R.ribT], null, rack)));
    }
    for (const x of R.endX){
      this.rails.push(W.addCollider(new BoxCollider(
        [x, S.deckY + R.ribH/2, (R.ribZ[2] + R.ribZ[0])/2],
        [R.endT, R.ribH/2, (R.ribZ[0] - R.ribZ[2])/2], null, rack)));
    }

    // cage
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.03), 1.16, 0], [0.03, 0.44, S.inZ + 0.03], null, glass));
    for (const sz of [-1, 1]) W.addCollider(new BoxCollider(
      [0, 1.16, sz*(S.inZ + 0.03)], [S.inX + 0.03, 0.44, 0.03], null, glass));
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));

    // catch bin under the well + a floor of last resort
    W.addCollider(new BoxCollider([0, 0.36, (S.wellZ + S.inZ)/2],
      [S.inX, 0.02, (S.inZ - S.wellZ)/2], null, rack));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  _loadPrizes(){
    const S = SPEC, R = RACK;
    const rand = rng(this.opts.seed * 977 + 13);

    let i = 0;
    for (const z of R.lanes) for (const x of R.cols){
      const t = PRIZE_TYPES[(this.opts.seed + i) % PRIZE_TYPES.length];
      const art = makePrize(t);

      const b = new Body(art.spheres, {
        mass: 0.45, friction: 0.35, restitution: 0.04,
        // A carton in a trough, not a plush on a deck: it slides rather than
        // rolls, and it swings on the hook like the rigid thing it is.
        linDamp: 0.25, angDamp: 3.2,
      });
      b.tag = 'prize';
      b.prize = { ...t };
      b.won = false;
      b.airborne = false;

      // `setPos` places the CENTRE OF MASS, and the ring pulls the cluster's
      // COM ~4 mm above the carton's own centre. Ignore that and the whole
      // prize seeds low, the carton's spheres start inside the rack floor, and
      // the position solver fires it out sideways on the first substep.
      // The z jitter has to stay inside the trough's 2 mm of side slack. Seed a
      // carton overlapping a rib and the position solver fires it out of the
      // rack at speed, which is gotcha 4 in STATUS.md arriving on cue.
      b.setPos(x + (rand() - 0.5) * 0.016,
               S.deckY + BOX.hy + b.comOffset.y,
               z + (rand() - 0.5) * 0.003);
      b.updateTransform();

      const holder = new THREE.Group();
      art.group.position.copy(b.comOffset).negate();
      holder.add(art.group);
      holder.userData.pick = 'prize';
      b.mesh = holder;
      this.prizeLayer.add(holder);

      this.world.add(b);
      this.prizes.push(b);

      const tagBody = new Body(art.tag.spheres, {
        mass: 0.030, friction: 0.25, restitution: 0.02,
        linDamp: 0.35, angDamp: 2.2,
      });
      tagBody.tag = 'tag';
      tagBody.carton = b;
      tagBody.setPos(b.pos.x + RING_X, S.deckY + BOX.hy + RING_Y, b.pos.z);
      const tagHolder = new THREE.Group();
      art.tag.group.position.copy(tagBody.comOffset).negate();
      tagHolder.add(art.tag.group);
      tagBody.mesh = tagHolder;
      this.prizeLayer.add(tagHolder);
      this.world.add(tagBody);

      // Anchored at points, not centres: the tab's rim to the ends of the
      // carton's hanger bar. `rope: false` so the rods carry compression too —
      // as ropes the tab could ride 2x their length upward before they came
      // taut and the barb would lift it most of the way off on its own.
      b.hanger = [-1, 1].map(sz => this.world.addLink(new Link(tagBody, b, TAG_L, {
        rope: false, compliance: 5e-6,
        ra: [0, 0, sz * RING.R],
        rb: [RING_X, MAST_Y, sz * RING.R],
      })));
      this.tags.push(tagBody);
      i++;
    }
    for (let n = 0; n < 200; n++) this.world.substep(this.world.cfg.fixedDt);
    for (const b of this.prizes) b.syncMesh();
    for (const t of this.tags) t.syncMesh();
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const S = SPEC, R = RACK, root = this.root;
    this.prizeLayer = new THREE.Group();
    root.add(this.prizeLayer);

    // Oxblood and brass — a specialist cabinet, and it needs to read as one in
    // a row of white and blue UFO catchers.
    const body   = new THREE.MeshStandardMaterial({ color:0x3b1420, roughness:.46, metalness:.34 });
    const trim   = new THREE.MeshStandardMaterial({ color:0xffc93c, roughness:.34, metalness:.62 });
    const dark   = new THREE.MeshStandardMaterial({ color:0x1a0810, roughness:.86 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xdfe7f5, roughness:.16, metalness:.96 });
    const rackM  = new THREE.MeshStandardMaterial({ color:0x2c1a2c, roughness:.78, metalness:.16 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    this.MAT = { body, trim, dark, chrome, rackM, glass };

    const box = (w,h,d,m,x,y,z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); root.add(o); return o;
    };

    // plinth
    box(S.width, S.deckY - 0.04, S.depth, body, 0, (S.deckY - 0.04)/2, 0);
    const cw = 0.07, CW = S.width + 0.02, CD = S.depth + 0.02;
    const capY = S.deckY - 0.015;
    for (const sz of [-1, 1]) box(CW, 0.05, cw, trim, 0, capY, sz*(CD - cw)/2);
    for (const sx of [-1, 1]) box(cw, 0.05, CD - cw*2, trim, sx*(CW - cw)/2, capY, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, dark, 0, 0.040, 0);

    // the rack floor, drawn where the collider is
    box(S.inX*2, 0.02, S.wellZ + S.inZ, rackM, 0, S.deckY - 0.01, (-S.inZ + S.wellZ)/2);
    for (const z of R.ribZ)
      box(S.inX*2, R.ribH, R.ribT*2, trim, 0, S.deckY + R.ribH/2, z);
    for (const x of R.endX)
      box(R.endT*2, R.ribH, R.ribZ[0] - R.ribZ[2], trim,
          x, S.deckY + R.ribH/2, (R.ribZ[2] + R.ribZ[0])/2);

    // the delivery well: a lit throat so the drop reads as a drop
    box(S.inX*2, 0.30, S.inZ - S.wellZ,
      new THREE.MeshStandardMaterial({ color:0x05060f, roughness:1 }),
      0, S.deckY - 0.16, (S.wellZ + S.inZ)/2);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(S.inX*1.94, (S.inZ - S.wellZ)*0.92),
      new THREE.MeshStandardMaterial({ color:0xffc93c, emissive:0xffc93c,
        emissiveIntensity:0.7, roughness:.5, transparent:true, opacity:.20 }));
    glow.rotation.x = -Math.PI/2;
    glow.position.set(0, S.deckY - 0.30, (S.wellZ + S.inZ)/2);
    root.add(glow);
    this.wellGlow = glow;
    box(S.inX*2, 0.02, S.inZ - S.wellZ, rackM, 0, 0.35, (S.wellZ + S.inZ)/2);

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
      new THREE.MeshStandardMaterial({ color:0x2a0e18, roughness:.75 }),
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
    const coin = box(0.055, 0.075, 0.02, dark, -0.30, 0.520, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x2a1a05, emissive:0xffc93c, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.30, 0.465, S.depth/2 + 0.012);
    root.add(this.coinLamp);
    box(0.30, 0.24, 0.02, dark, 0, 0.22, S.depth/2 - 0.005);
  }

  _marqueeTexture(){
    if (this._mqTex) return this._mqTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#ffc93c'); grd.addColorStop(.5, '#ff6b6b'); grd.addColorStop(1, '#c792ea');
    g.fillStyle = '#1a0810'; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
    g.globalAlpha = .18; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(560,0); g.lineTo(780,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 112px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(26,8,16,.85)';
    g.strokeText('リング掛け', 512, 100);
    g.fillStyle = '#fff'; g.fillText('リング掛け', 512, 100);
    g.font = `bold 34px ${JP_FONT}`;
    g.fillText('RING HOOK  ·  ¥100', 512, 196);
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
    this.wellGlow.material.emissiveIntensity = 0.6 + Math.sin(performance.now()*0.003)*0.3;

    for (const b of this.prizes) if (!b.won) b.syncMesh();
    for (const t of this.tags) if (!t.carton.won) t.syncMesh();
    this._checkPrizes();
    if (this.debug && this.debug.visible) this.updateDebug();
  }

  /**
   * Won when the prize is below the rack and forward of the lip.
   *
   * Unambiguous here in a way it is not on a decked cabinet: forward of the lip
   * there is no floor at all, so "below the rack" and "in the well" cannot mean
   * anything except delivered. `lifts` is the other half of the story and the
   * number worth watching while tuning — a prize clear of the rack has been
   * hooked, whether or not it survives the trip home.
   */
  _checkPrizes(){
    const S = SPEC;
    for (const b of this.prizes){
      if (b.won) continue;
      const up = b.pos.y > S.deckY + 0.14;
      if (up && !b.airborne) this.lifts++;
      b.airborne = up;
      if (b.pos.y < S.deckY - 0.12 && b.pos.z > S.wellZ - 0.04){
        b.won = true;
        this.wins++;
        this.collected.push(b.prize);
        if (this.onWin) this.onWin(b.prize);
      }
    }
  }

  /** Prizes currently off the rack — HUD. */
  get lifted(){
    return this.prizes.filter(b => !b.won && b.pos.y > SPEC.deckY + 0.14).length;
  }

  /** How far the closest live prize is from the well mouth — HUD + tuning. */
  get nearest(){
    let best = null;
    for (const b of this.prizes){
      if (b.won) continue;
      const d = Math.hypot(b.pos.x - SPEC.homeX, b.pos.z - SPEC.homeZ);
      if (best === null || d < best) best = d;
    }
    return best;
  }

  reset(){
    for (const b of this.prizes){
      if (b.hanger) for (const l of b.hanger) this.world.removeLink(l);
      this.world.remove(b); this.prizeLayer.remove(b.mesh);
    }
    for (const t of this.tags){ this.world.remove(t); this.prizeLayer.remove(t.mesh); }
    this.prizes.length = 0;
    this.tags.length = 0;
    this.lifts = 0;
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
    // the prize clusters — the rings are the part worth being able to see
    this._dbgPrizes = [];
    for (const b of this.prizes.concat(this.tags)) for (const s of b.spheres){
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

/* ============================================================================
   machines/medal.js — メダルゲーム, the coin pusher. The first non-crane cabinet.

   Nine settings on this floor are a crane with something different underneath
   it. This one shares nothing with them: there is no claw, no gantry that
   travels in two axes, no prize, and no "win". What it has is a shelf that
   never stops moving:

        chute ↓  (sweeps in X — the whole aim)
              ▓
        ┌─────────────┐ curtain (fixed — this is the scraper)
        │  ▒▒▒▒▒▒▒▒   │
        ╞═════════════╡◄──►  pusher, reciprocating in Z
        │             │
        │  ▒▒▒▒▒▒▒▒▒▒▒│
        └─────────────┴──── open lip ──► payout
             gutters either side

   THE DOUBLE DECK IS THE WHOLE MACHINE, and none of it is scripted:

     · medals dropped from the chute land on the pusher's TOP face, hard against
       the fixed CURTAIN at the back of it;
     · the pile they form cannot move back, because the curtain is there — so
       when the pusher runs back, the SHELF SLIDES OUT FROM UNDER THE PILE and
       whatever was overhanging the front edge loses its support and drops;
     · on the field below, the pusher's FRONT face shoves the carpet toward the
       open lip, and whatever crosses it is paid out.

   Nothing in that list is a rule in code. The curtain is a static box and the
   pusher is a kinematic box; the delivery is a pile held by a wall while the
   floor is withdrawn. The only thing this file decides is where the medal
   enters.

   THAT MECHANISM HAS EXACTLY ONE REQUIREMENT AND IT IS EASY TO MISS: the pile
   must REACH the curtain. Built first with the curtain 90 mm behind the drop
   point, the shelf pile floated free — nothing held it, so it simply rode back
   and forth with the shelf, and the upper deck was a null mechanism. Twenty
   coins moved the field 0 mm, measured, with a shelf carrying thirty medals.
   A pile that is not against the wall is not being ratcheted, it is being
   carried. See the geometry note on CURTAIN_Z.

   WHAT IS BEING MEASURED IS NOT PLAYS-TO-WIN. Every other cabinet here is
   scored by how many coins it takes to get one thing out; a pusher pays out
   continuously and the honest statistic is the PAYOUT RATIO — medals out per
   medal in. A ratio over 1 is a machine that empties itself, under 1 is a
   machine that eats the field you paid to build. `PusherBot` in bot.js measures
   that, and it is why the crane bot could not be reused even though the button
   grammar is identical.

   Model contract: base on y = 0, front facing +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import { World, Body, BoxCollider, PlaneCollider } from '../physics.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const ONE = new V3(1, 1, 1);
const _m4 = new THREE.Matrix4();

const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  width: 0.98, depth: 0.92, height: 1.75,

  // The playfield. Narrower than the cabinet on purpose: a real pusher spends
  // its width on side towers, displays and the payout hopper, and the field a
  // player actually looks at is a strip up the middle.
  fieldY : 0.700,          // field floor, top surface
  fieldX : 0.220,          // field half-width — also the gutter lip
  backZ  : -0.300,
  // The open front edge; past this is payout. 204 mm in front of the pusher's
  // face at the back of its stroke, and that run IS the cabinet's economy — see
  // the note on PUSHER. Built at 274 mm the machine took forty coins to pay
  // anything at all and had 96 medals on the field by the time it did.
  lipZ   : 0.040,

  shelfY : 0.755,          // the pusher's top face, 55 mm over the field
  railTop: 0.900,          // side rails, which contain the SHELF and not the field

  gutterX: 0.300,          // outer wall of the side gutters
  gutterY: 0.560,          // gutter floor — anything here is lost
  // Payout tray floor. Low, because the cabinet front stacks the way a real
  // one does — field, then the two buttons, then the tray under them. Put at
  // 0.480 first, which is button height, and the control panel then stood
  // squarely in front of the payout: the one thing on this cabinet the player
  // most wants to look at, behind the one thing they have to reach for.
  trayY  : 0.360,

  inX: 0.320, inZ: 0.375, cageTop: 1.460,

  // The chute head. One axis, and the only thing the player controls.
  headY  : 0.960,
  // The drop lands hard against the curtain, not in the middle of the shelf.
  // A medal that lands clear of the wall joins nothing: it rides the shelf back
  // and forth for ever, because the only thing that makes the shelf deliver is
  // a pile the wall is holding still.
  headZ  : -0.212,
  dropY  : 0.800,          // where a released medal actually appears
  limX   : [-0.190, 0.190],
  homeX  : -0.190,
};

/**
 * THE PUSHER.
 *
 * `back`/`front` are the travel of its CENTRE, so its rear face runs
 * -0.280 → -0.235 and its front face -0.164 → -0.119.
 *
 * Its DEPTH is not a styling choice, it is the one dimension the double deck
 * turns on. Two constraints pull against each other:
 *
 *   · the rear must never come forward of the curtain, or a slot opens at the
 *     back of the shelf and medals drop through the machine into a region
 *     nothing can reach;
 *   · the exposed shelf — curtain to front edge — has to be SHORT, because the
 *     pile only delivers once it spans that gap, and a pile 200 mm long is
 *     seventy medals nobody is going to feed in.
 *
 * Those give `shelfDepth ≤ pusherDepth − margin − stroke` directly. Wanting
 * 2–3 medals of shelf (about 66 mm) at a 45 mm stroke fixes the depth at
 * 116 mm and there is nothing else to choose. Built first at 220 mm deep with
 * the curtain right at the back, the shelf was 170–215 mm — five to six medals
 * — and never delivered anything at all.
 *
 * The stroke is 45 mm against 204 mm of exposed field. That ratio is the
 * machine's economy and it is the first number to reach for if the payout is
 * wrong — a carpet does not advance by a stroke per stroke, it COMPRESSES, and
 * how far it has to travel before the front rank overhangs decides everything.
 *
 * Sinusoidal rather than triangular because a real pusher is crank-driven, and
 * because the dwell at each end is what lets a compressed carpet relax before
 * it is squeezed again.
 */
const PUSHER = {
  halfX: 0.220, halfZ: 0.058,
  back: -0.222, front: -0.177,
  period: 2.0,
};

/**
 * The fixed curtain's FRONT FACE — the wall the shelf pile is held against.
 *
 * It has to clear the pusher's rear at full extension (-0.235) so no slot ever
 * opens, and it has to be close enough to the shelf's front edge (-0.164 at the
 * back of the stroke) that a two-deep pile already overhangs. 66 mm of shelf at
 * the back of the stroke, 111 mm at the front: the edge withdraws 45 mm from
 * under the pile every cycle, which is more than a medal's own diameter, so a
 * loaded shelf sheds a rank per stroke.
 */
const CURTAIN_Z = -0.230;

/**
 * THE CROWN — the field is a shallow roof, not a table.
 *
 * Built flat first, and flat is a machine that cannot take anything back. At
 * equilibrium a closed pusher pays out exactly what it is fed — in = out + lost
 * is not a design choice, it is bookkeeping — so with the gutters inert the
 * cabinet settled at a payout ratio of 1.000 over 97 coins with 2 medals lost.
 * A player at that machine breaks even for ever, which is not a game and is
 * certainly not a business.
 *
 * The lever is the loss rate and nothing else, and a crown is the honest way to
 * get one. 2.5° either side of the centreline is far under the 17.7° a medal
 * needs to slide on its own (atan of 0.32 friction), so nothing creeps on a
 * quiet field. What it does is bias the jostling: every stroke shuffles the
 * carpet, and on a crowned deck that shuffle has a preferred direction. The
 * medals that go over the side are the ones that were already at the edge and
 * already being squeezed — which is exactly which medals a real pusher eats.
 */
const CROWN = 2.5 * Math.PI / 180;

/**
 * THE MEDAL, as seven overlapping spheres in a flat hexagon.
 *
 * 34 mm across and 12 mm thick. A real 25 mm medal is 1.6 mm thick and there is
 * no honest way to build one here: a sphere cluster cannot be thinner than the
 * spheres in it, and spheres small enough to make a 2 mm disc would need
 * hundreds per medal. So the medal is a thick token, and that is a deliberate
 * trade rather than an oversight — it is also what makes a carpet of them
 * stack and slide stably instead of forming towers the solver cannot hold.
 *
 * Seven is the minimum that closes: six on a ring at 11 mm with 6 mm spheres
 * overlap each other (11 < 12) and the centre (11 < 12), so the envelope has no
 * hole. Four in a square leaves diagonal gaps a rail corner catches on.
 */
const MEDAL = { r: 0.0060, ring: 0.0110, radius: 0.0170, mass: 0.014 };

function medalCluster(){
  const out = [{ o: [0, 0, 0], r: MEDAL.r }];
  for (let i = 0; i < 6; i++){
    const a = i * Math.PI / 3;
    out.push({ o: [Math.cos(a) * MEDAL.ring, 0, Math.sin(a) * MEDAL.ring], r: MEDAL.r });
  }
  return out;
}

/**
 * How many medal bodies may exist at once. Paid and lost medals are REMOVED
 * from the world rather than flagged, which is what keeps this bounded at all.
 *
 * Set well clear of the cabinet's steady state (~70). It is a backstop, not a
 * budget: a cabinet sitting ON the cap is a cabinet whose economy is wrong, and
 * `refused` counts every coin it ate without producing a medal so that failure
 * can never be mistaken for a dry run.
 */
const MAX_MEDALS = 140;

/**
 * How many paid medals stay in the tray, as real bodies, before the oldest is
 * retired.
 *
 * Removing them the instant they cross the lip is the cheap thing to do and it
 * was wrong. Watched rather than measured, the cabinet's entire payoff — the
 * cascade over the edge — happened into a black hole: the counter went up and
 * nothing arrived anywhere. A pusher's reward is not a number, it is a heap of
 * metal you can see growing. Fourteen is enough to read as a heap and cheap
 * enough to be free.
 */
const TRAY_KEEP = 14;

/**
 * How many lost medals stay lying in the side gutters.
 *
 * Small on purpose, and not for the draw cost. The gutters take about a fifth
 * of everything fed in, so left to accumulate they would fill the channels and
 * eventually back up to the field lip — which would change the loss rate the
 * cabinet is tuned around. Ten, spread over two 440 mm channels 140 mm below
 * the deck, is a visible scatter that can never reach the playfield. The real
 * machine's answer is the same: the side chutes go to the operator's hopper.
 */
const GUTTER_KEEP = 10;

/** Deterministic RNG, so a restock lays the field out the same way. */
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =============================================================== the rig == */
/**
 * The mechanism: a reciprocating pusher, a sweeping chute, and a one-button
 * play cycle.
 *
 * The button grammar is deliberately the floor's: hold ➊ and the head tracks
 * right, release and the machine takes over. What is different is that there is
 * NO COAST TO COMPENSATE FOR — the medal leaves the chute at the instant of
 * release, not after the carriage settles. That makes this the pure form of the
 * model bot.js argues for everywhere else: the player does not choose a
 * position, they choose a moment, and the distance that moment is worth is
 * exactly `timing × sweepSpeed`. On every other cabinet those two models agree
 * only because the gantry speed happens to be 0.34 m/s; here they are the same
 * statement.
 *
 * The PUSHER runs whether or not there is a credit in the machine, because a
 * real one does and because the field has to keep evolving while you decide.
 */
export class PusherRig {
  constructor(world, root, cfg){
    this.world = world; this.root = root; this.cfg = cfg;
    this.picks = [];

    this.credit = 0; this.plays = 0;
    this.phase = 'idle'; this.t = 0;
    this.pressedA = false;
    this.btnA = false; this.btnB = false;
    this.onPhase = null;
    this.onRelease = null;             // (x) => spawn a medal there

    this.gx = cfg.homeX; this.vx = 0;
    this.clock = 0;                    // pusher crank angle, seconds
    this.pz = PUSHER.back;
    this.pv = 0;

    // THE PUSHER as one kinematic box. Its top face is the upper shelf and its
    // front face is the shove — one collider does both jobs, exactly as one
    // moulding does on the real machine.
    this.pusher = world.addCollider(new BoxCollider(
      [0, (cfg.fieldY + cfg.shelfY) / 2, PUSHER.back],
      [PUSHER.halfX, (cfg.shelfY - cfg.fieldY) / 2, PUSHER.halfZ],
      null, { friction: 0.42, restitution: 0.02 }));
    this.pusher.kinematic = true;
    this.pusher.pointVel = (p, out) => out.set(0, 0, this.pv);

    this._buildVisuals();
    this.sync();
  }

  _buildVisuals(){
    const cfg = this.cfg, root = this.root;
    const steel = new THREE.MeshStandardMaterial({ color:0xc9d2e6, roughness:.26, metalness:.94 });
    const dark  = new THREE.MeshStandardMaterial({ color:0x1a1016, roughness:.5, metalness:.6 });

    // the pusher itself
    this.pusherMesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(PUSHER.halfX*2, cfg.shelfY - cfg.fieldY, PUSHER.halfZ*2),
      new THREE.MeshStandardMaterial({ color:0x2b1620, roughness:.55, metalness:.4 }));
    body.position.y = (cfg.fieldY + cfg.shelfY) / 2;
    this.pusherMesh.add(body);
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(PUSHER.halfX*2 + 0.004, 0.012, 0.008),
      new THREE.MeshStandardMaterial({ color:0xffc93c, emissive:0xffc93c,
        emissiveIntensity:1.5, roughness:.4 }));
    face.position.set(0, cfg.shelfY - 0.006, PUSHER.halfZ + 0.004);
    this.pusherMesh.add(face);
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(PUSHER.halfX*2, 0.006, PUSHER.halfZ*2),
      steel);
    top.position.y = cfg.shelfY - 0.003;
    this.pusherMesh.add(top);
    root.add(this.pusherMesh);

    // the chute head on its rail
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.010, 0.010, cfg.limX[1]*2 + 0.10, 10), steel);
    rail.rotation.z = Math.PI/2;
    rail.position.set(0, cfg.headY + 0.05, cfg.headZ);
    root.add(rail);

    this.head = new THREE.Group();
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.06), dark);
    carriage.position.y = 0.05;
    this.head.add(carriage);
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, cfg.headY - cfg.dropY, 14, 1, true),
      new THREE.MeshStandardMaterial({ color:0x8f97ad, roughness:.3, metalness:.85,
        side: THREE.DoubleSide }));
    tube.position.y = -(cfg.headY - cfg.dropY) / 2;
    this.head.add(tube);
    this.headLamp = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.006, 8, 18),
      new THREE.MeshStandardMaterial({ color:0xff3b5c, emissive:0xff3b5c,
        emissiveIntensity:1.2, roughness:.4 }));
    this.headLamp.rotation.x = Math.PI/2;
    this.headLamp.position.y = -(cfg.headY - cfg.dropY);
    this.head.add(this.headLamp);
    root.add(this.head);
  }

  /** Same two-button plate as every other cabinet — ➋ is unused here and is
      left dark, because a pusher has exactly one decision in it. */
  buildButtons(dx, y, z){
    const trim = new THREE.MeshStandardMaterial({ color:0x2a1016, roughness:.45, metalness:.7 });
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
          color: i ? 0x3a2a30 : 0xffc93c, emissive: i ? 0x100a0c : 0xa06a10,
          emissiveIntensity: 0.6, roughness:.35 }));
      cap.rotation.x = Math.PI/2; cap.position.z = 0.010;
      g.add(rim, cap);
      const tag = i ? 'btnB' : 'btnA';
      cap.userData.pick = tag; rim.userData.pick = tag;
      this.picks.push(cap, rim);
      this.buttons.push({ cap, base: 0.010, live: i === 0 });
    }
  }

  insertCoin(){
    if (this.credit >= 1 || this.busy) return false;
    this.credit = 1; this.phase = 'aim'; this.t = 0;
    this.pressedA = false;
    this._emit();
    return true;
  }
  pressA(down){ this.btnA = down; }
  pressB(down){ this.btnB = down; }
  _emit(){ if (this.onPhase) this.onPhase(this.phase); }
  get busy(){ return this.phase === 'drop'; }
  get aiming(){ return this.phase === 'aim'; }

  reset(){
    this.phase = 'idle'; this.credit = 0;
    this.gx = this.cfg.homeX; this.vx = 0;
    this.clock = 0; this.pz = PUSHER.back; this.pv = 0;
    this.pusher.c.z = this.pz;
  }

  /** One fixed substep. Called from inside World.step(). */
  stepMechanism(h){
    const cfg = this.cfg;
    const MOVE = cfg.moveSpeed ?? 0.34, ACC = 3.2, DRAG = 8;

    /* ---- the pusher, which never stops ---- */
    this.clock += h;
    const w = (Math.PI * 2) / PUSHER.period;
    const mid = (PUSHER.back + PUSHER.front) / 2;
    const amp = (PUSHER.front - PUSHER.back) / 2;
    const prev = this.pz;
    this.pz = mid - Math.cos(w * this.clock) * amp;
    this.pv = (this.pz - prev) / h;
    this.pusher.c.z = this.pz;

    /* ---- the chute head ---- */
    let ax = 0;
    switch (this.phase){
      case 'idle': {
        // park back at home so the aim always starts from the same place, the
        // way ➊-only tracking on every other cabinet does
        const dx = cfg.homeX - this.gx;
        ax = Math.max(-0.7, Math.min(0.7, dx * 4.0 - this.vx * 1.7));
        break;
      }
      case 'aim':
        this.t += h;
        if (this.btnA){ ax = 1; this.pressedA = true; }
        else if (this.pressedA || this.t > 20){
          // THE MEDAL LEAVES ON RELEASE, at the head's position right now.
          // No coast: nothing travels after the button goes, so the aim error
          // is exactly the release timing times the sweep speed.
          if (this.onRelease) this.onRelease(this.gx);
          this.phase = 'drop'; this.t = 0; this._emit();
        }
        break;
      case 'drop':
        this.t += h;
        {
          const dx = cfg.homeX - this.gx;
          ax = Math.max(-0.7, Math.min(0.7, dx * 4.0 - this.vx * 1.7));
        }
        // long enough for the medal to land and be taken by the shelf; the
        // field keeps moving afterwards either way
        if (this.t > 1.4){
          this.phase = 'idle'; this.credit = 0; this.plays++; this._emit();
        }
        break;
    }

    this.vx += ax * ACC * h;
    if (ax === 0) this.vx -= this.vx * Math.min(1, DRAG * h);
    this.vx = Math.max(-MOVE, Math.min(MOVE, this.vx));
    this.gx += this.vx * h;
    if (this.gx < cfg.limX[0]){ this.gx = cfg.limX[0]; this.vx = 0; }
    if (this.gx > cfg.limX[1]){ this.gx = cfg.limX[1]; this.vx = 0; }
  }

  sync(){
    const cfg = this.cfg;
    this.pusherMesh.position.z = this.pz;
    this.head.position.set(this.gx, cfg.headY, cfg.headZ);
    this.headLamp.material.emissiveIntensity = this.phase === 'aim' ? 3.0 : 1.0;
    if (this.buttons){
      for (const [i, b] of this.buttons.entries()){
        const down = b.live && this.btnA;
        b.cap.position.z = b.base - (down ? 0.008 : 0);
        b.cap.material.emissiveIntensity = !b.live ? 0.15 : down ? 1.8 : 0.6;
      }
    }
  }

  buildDebug(group, mat){
    const p = this.pusher;
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.h.x*2, p.h.y*2, p.h.z*2), mat);
    group.add(m); this._dbg = m;
  }
  updateDebug(){ if (this._dbg) this._dbg.position.copy(this.pusher.c); }
}

/* ---------------------------------------------------------------- art ---- */
let _faceTex = null;
function medalFace(){
  if (_faceTex) return _faceTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c8961f'; g.fillRect(0, 0, 256, 256);
  const grd = g.createRadialGradient(96, 88, 12, 128, 128, 140);
  grd.addColorStop(0, '#ffe9a8'); grd.addColorStop(0.55, '#e8b73a'); grd.addColorStop(1, '#8d6410');
  g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI*2); g.fill();
  g.strokeStyle = 'rgba(90,60,8,.75)'; g.lineWidth = 9;
  g.beginPath(); g.arc(128, 128, 104, 0, Math.PI*2); g.stroke();
  g.fillStyle = 'rgba(80,52,6,.9)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 96px ${JP_FONT}`;
  g.fillText('メ', 128, 122);
  g.font = 'bold 26px ui-monospace, monospace';
  g.fillText('MEDAL', 128, 196);
  _faceTex = new THREE.CanvasTexture(c);
  _faceTex.colorSpace = THREE.SRGBColorSpace;
  return _faceTex;
}

/* ============================================================== machine === */
export class MedalMachine {
  /**
   * @param opts.field   medals stocked on the playfield
   * @param opts.shelf   medals stocked on the pusher's top shelf
   * @param opts.seed    layout seed — every bay gets its own
   */
  constructor(opts = {}){
    // Stocked AT the cabinet's own steady state, measured: 90 on the field and
    // 15 on the shelf is where it settles and stays, whatever it started from.
    // An operator loads a pusher because a loaded field is the entire lure, and
    // a bench that starts it bare spends its first sixty coins measuring the
    // priming rather than the machine — the payout ratio read 0.24 over the
    // first 25 coins from a light stock and 0.68 once it had equilibrated,
    // which is the same cabinet.
    this.opts = { field: 90, shelf: 15, seed: 0, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'medal-machine';
    // A pusher never sleeps: the shelf is kinematic and touching most of the
    // stock, so the carpet is woken every substep. velIters is where the money
    // goes on this cabinet, not in the broadphase.
    this.world = new World({ gravity: -9.81, velIters: 12, posIters: 4 });

    this.medals = [];          // in play: field + shelf
    this.tray = [];            // paid out, still simulating, visible in the well
    this.gutter = [];          // lost over the side, still simulating, visible
    this.picks = [];
    this.collected = [];
    this.wins = 0;             // medals paid out, all time
    this.lost = 0;             // medals down the side gutters
    this.dropped = 0;          // medals fed in
    this.refused = 0;          // coins taken with the cabinet at the body cap
    this.escaped = 0;          // left the machine some way that is a bug
    this.onWin = null;
    this.onPhase = null;

    this._pending = 0;         // paid but not yet announced
    this._quiet = 0;

    this._buildVisuals();
    this._buildColliders();

    this.rig = new PusherRig(this.world, this.root, {
      fieldY: SPEC.fieldY, shelfY: SPEC.shelfY,
      headY: SPEC.headY, headZ: SPEC.headZ, dropY: SPEC.dropY,
      limX: SPEC.limX, homeX: SPEC.homeX, moveSpeed: 0.34,
    });
    this.rig.buildButtons(0.11, 0.590, SPEC.depth/2 + 0.016);
    this.rig.onPhase = ph => { if (this.onPhase) this.onPhase(ph); };
    this.rig.onRelease = x => this._feed(x);
    this.picks.push(...this.rig.picks);

    this._loadField();
  }

  get object3D(){ return this.root; }
  get prizesLeft(){ return this.medals.length; }
  get phase(){ return this.rig.phase; }
  get credit(){ return this.rig.credit; }
  get plays(){ return this.rig.plays; }
  insertCoin(){ return this.rig.insertCoin(); }
  pressA(d){ this.rig.pressA(d); }
  pressB(d){ this.rig.pressB(d); }

  /** Medals out per medal in, this cabinet's life. The statistic. */
  get ratio(){ return this.dropped ? this.wins / this.dropped : 0; }

  /** How far the front-most medal still is from the lip, in metres. */
  get toLip(){
    let best = null;
    for (const b of this.medals){
      if (b.pos.y < SPEC.fieldY - 0.02) continue;      // in the air / falling out
      const d = SPEC.lipZ - b.pos.z;
      if (best === null || d < best) best = d;
    }
    return best;
  }

  /* ------------------------------------------------------------ physics -- */
  _buildColliders(){
    const W = this.world, S = SPEC;
    const deck  = { friction: 0.36, restitution: 0.02 };
    const wall  = { friction: 0.20, restitution: 0.04 };
    const glass = { friction: 0.18, restitution: 0.08 };

    // The field floor, from the back wall to the open lip, as two crowned
    // halves meeting on the centreline. Rotated OUTWARD-DOWN: +CROWN about Z
    // drops the −X edge, −CROWN drops the +X edge.
    for (const sx of [-1, 1]){
      const q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), -sx * CROWN);
      W.addCollider(new BoxCollider(
        [sx * S.fieldX/2, S.fieldY - 0.02, (S.backZ + S.lipZ)/2],
        [S.fieldX/2, 0.02, (S.lipZ - S.backZ)/2], q, deck));
    }
    // back wall, under the curtain
    W.addCollider(new BoxCollider([0, S.fieldY + 0.05, S.backZ - 0.02],
      [S.fieldX, 0.06, 0.02], null, wall));

    // THE CURTAIN. A fixed wall whose bottom edge hangs 2 mm over the pusher's
    // top face. This is the ratchet: medals riding out on the shelf cannot ride
    // back in, so every cycle leaves them further forward. It is also the one
    // piece of geometry with no tolerance in it — the pusher's rear face must
    // never come forward of it, or medals fall through the back of the machine.
    W.addCollider(new BoxCollider(
      [0, (S.shelfY + 0.002 + S.cageTop)/2, CURTAIN_Z - 0.045],
      [S.fieldX, (S.cageTop - S.shelfY - 0.002)/2, 0.045], null, wall));

    // Side rails. They start AT the shelf, so they contain the upper deck and
    // leave the field open at the sides — which is what makes the gutters
    // reachable at all. A rail that came down to the field floor would turn
    // this cabinet into a machine you cannot lose medals in.
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.fieldX + 0.015), (S.shelfY + S.railTop)/2, (S.backZ + S.lipZ)/2],
      [0.015, (S.railTop - S.shelfY)/2, (S.lipZ - S.backZ)/2], null, wall));

    // the gutters either side of the field, and their outer walls
    for (const sx of [-1, 1]){
      W.addCollider(new BoxCollider(
        [sx*(S.fieldX + S.gutterX)/2, S.gutterY - 0.02, (S.backZ + S.lipZ)/2],
        [(S.gutterX - S.fieldX)/2, 0.02, (S.lipZ - S.backZ)/2], null, deck));
      W.addCollider(new BoxCollider(
        [sx*(S.gutterX + 0.02), S.gutterY + 0.12, (S.backZ + S.lipZ)/2],
        [0.02, 0.14, (S.lipZ - S.backZ)/2], null, wall));
      /* A CHANNEL NEEDS AN END. The gutter floor stopped at the lip and the
         payout well began there, so a lost medal that slid forward along the
         channel dropped straight into the tray — the machine paying out a medal
         it had just taken off you. Invisible until lost medals started
         persisting, because before that they were deleted before they could
         travel anywhere. On a real cabinet the side chute is closed and goes to
         the operator's hopper; this is that wall. */
      W.addCollider(new BoxCollider(
        [sx*(S.fieldX + S.gutterX)/2, (S.gutterY + S.fieldY)/2, S.lipZ + 0.015],
        [(S.gutterX - S.fieldX)/2, (S.fieldY - S.gutterY)/2, 0.015], null, wall));
      /* And an INNER wall, because the channel's inboard side is the underside
         of the playfield — open space from the gutter floor up to the deck. A
         medal nudged back in-board off the floor's inner edge dropped through
         it and out of the machine. It stops 45 mm short of the deck so the drop
         path from the field edge into the channel is untouched: this closes the
         void, it does not narrow the mouth. */
      W.addCollider(new BoxCollider(
        [sx*(S.fieldX - 0.008), (S.gutterY + S.fieldY - 0.045)/2, (S.backZ + S.lipZ)/2],
        [0.008, (S.fieldY - 0.045 - S.gutterY)/2, (S.lipZ - S.backZ)/2], null, wall));
    }

    // Payout tray under the lip. Thick, because a medal falls 340 mm into it —
    // 2.6 m/s, or 22 mm a substep against a 6 mm sphere. A thin plate is a
    // plate a payout can pass straight through (gotcha 10, from the other side).
    W.addCollider(new BoxCollider([0, S.trayY - 0.04, (S.lipZ + S.inZ)/2],
      [S.inX, 0.04, (S.inZ - S.lipZ)/2], null, { friction: 0.5, restitution: 0.03 }));
    // THE TRAY NEEDS A FRONT. The cage glass only starts at y 0.59, so below
    // that the well opens straight out of the cabinet into the room — a medal
    // that bounced forward on landing left the machine entirely and came to
    // rest on the arcade floor. It did not even register as escaped, because a
    // paid medal is no longer swept.
    W.addCollider(new BoxCollider([0, (S.trayY + S.fieldY)/2, S.inZ + 0.015],
      [S.inX, (S.fieldY - S.trayY)/2, 0.015], null, wall));
    // and its sides, for the same reason — the cage is open below 0.59 on every
    // face, not just the front
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.015), (S.trayY + S.fieldY)/2, (S.lipZ + S.inZ)/2],
      [0.015, (S.fieldY - S.trayY)/2, (S.inZ - S.lipZ)/2], null, wall));

    /* THE DROP FACE — the wall under the field's front edge.
       Modelled as scenery only at first, and the hole it left was invisible
       because it is behind the one event nobody watches closely: a medal goes
       over the lip, is counted as paid, and THEN drifts 40 mm back under the
       deck into open air and falls out of the machine. Three in twenty-five
       coins. It cannot be caught by watching the payout, because the payout
       already happened.

       Its front face has to sit EXACTLY on the lip. One centimetre proud and it
       is a 10 mm slot against a 12 mm medal — every payout jams on the edge
       instead of falling. */
    W.addCollider(new BoxCollider([0, (S.trayY + S.fieldY - 0.04)/2, S.lipZ - 0.015],
      [S.inX, (S.fieldY - 0.04 - S.trayY)/2, 0.015], null, wall));

    // cage
    for (const sx of [-1, 1]) W.addCollider(new BoxCollider(
      [sx*(S.inX + 0.03), 1.05, 0], [0.03, 0.46, S.inZ + 0.03], null, glass));
    W.addCollider(new BoxCollider([0, 1.05, S.inZ + 0.03],
      [S.inX + 0.03, 0.46, 0.03], null, glass));
    W.addCollider(new BoxCollider([0, S.cageTop + 0.03, 0],
      [S.inX, 0.03, S.inZ], null, glass));
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction: 0.5 }));
  }

  _newMedal(x, y, z){
    if (this.medals.length >= MAX_MEDALS) return null;
    const b = new Body(medalCluster(), {
      mass: MEDAL.mass, friction: 0.32, restitution: 0.02,
      linDamp: 0.15, angDamp: 2.4,
    });
    b.tag = 'medal';
    b.setPos(x, y, z);
    // A medal lands flat or it does not land at all — a token stood on its rim
    // in a carpet is a jam waiting to happen, so seed them level with a little
    // yaw and let play tip them if it wants to.
    //
    // The yaw comes off the machine's OWN seeded stream, including for medals
    // fed mid-session. Reaching for Math.random here would make a session
    // unrepeatable, and an unrepeatable session cannot be used as its own
    // control — which is the only cheap way to prove a change did nothing.
    b.quat.setFromAxisAngle(UP, this._rand() * Math.PI * 2);
    b.updateTransform();
    this.world.add(b);
    this.medals.push(b);
    return b;
  }

  /**
   * Stock the cabinet the way an operator does: a loose carpet across the front
   * of the field and a short rank on the shelf.
   *
   * Nothing is stocked within 60 mm of the lip. A medal seeded there is paid out
   * by the first stroke that touches it and the payout ratio stops meaning
   * anything — the same trap 押し出し's front rank has.
   */
  _loadField(){
    const S = SPEC;
    const rand = this._rand = rng(this.opts.seed * 1181 + 7);

    // Field: a jittered grid from hard against the pusher's face to 60 mm short
    // of the lip. Two shallow layers, because one layer of tokens does not read
    // as a loaded pusher and does not shove as a mass either.
    //
    // z0 IS INSIDE THE FACE'S TRAVEL ON PURPOSE. Stocked at -0.060 the carpet's
    // back edge sat exactly on the face's most-forward position and the pusher
    // never touched it — 20 coins, 0 mm of movement, and it read as a payout
    // problem rather than as a cabinet whose carriage could not reach its own
    // playfield. Same fault 押し出し's travel limits were widened for.
    const z0 = -0.150, z1 = S.lipZ - 0.060;
    const cols = 8, rows = 5;
    const slots = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++){
      slots.push([
        -S.fieldX + 0.036 + c * ((S.fieldX*2 - 0.072) / (cols - 1)),
        z0 + r * ((z1 - z0) / (rows - 1)),
      ]);
    }
    for (let i = 0; i < this.opts.field; i++){
      const [sx, sz] = slots[i % slots.length];
      const layer = Math.floor(i / slots.length);
      this._newMedal(
        sx + (rand() - 0.5) * 0.018,
        S.fieldY + MEDAL.r + 0.002 + layer * (MEDAL.r * 2 + 0.004),
        sz + (rand() - 0.5) * 0.018);
    }

    // Shelf: ranks built FORWARD FROM THE CURTAIN, which is where the hopper
    // drops them and the only place a pile is held. Stocked anywhere else it is
    // free-floating and the deck delivers nothing.
    for (let i = 0; i < this.opts.shelf; i++){
      const c = i % 6, r = Math.floor(i / 6);
      this._newMedal(
        -0.175 + c * 0.070 + (rand() - 0.5) * 0.010,
        S.shelfY + MEDAL.r + 0.002,
        CURTAIN_Z + MEDAL.radius + 0.001 + r * (MEDAL.radius * 2 + 0.002));
    }

    for (let i = 0; i < 300; i++) this.world.substep(this.world.cfg.fixedDt);

    /* RUN THE MACHINE IN, rather than guessing what a loaded field looks like.
       A grid of tokens is not a carpet: the real thing is graded, one layer
       deep at the front and two at the back, with its rear edge sitting exactly
       where the pusher can still reach it. Every one of those is something the
       pusher DOES, so the honest way to get it is to let the pusher do it —
       five seconds of stroking before the cabinet is ever looked at, which is
       also the true state of a machine you walk up to on a real floor.

       Whatever falls out during the run-in is not a payout; the counters are
       zeroed afterwards. Without that the cabinet would report having paid a
       dozen medals before anyone put a coin in it. */
    if (this.rig){
      for (let i = 0; i < 600; i++){
        this.rig.stepMechanism(this.world.cfg.fixedDt);
        this.world.substep(this.world.cfg.fixedDt);
        if ((i & 7) === 0) this._sweep(true);
      }
      this.rig.clock = 0;
      this.rig.pz = PUSHER.back;
      this.rig.pusher.c.z = PUSHER.back;
    }

    // SETTLE, THEN CHECK. Medals travel a long way while a carpet finds its
    // level, and one that ends the settle past the lip would be handed out by
    // the first _sweep() after the machine was built, before any coin — the
    // same thing that caught 三本爪.
    this._sweep(true);
    // The run-in's spillage is not a payout, and it is not a loss either
    for (const b of this.tray) this.world.remove(b);
    for (const b of this.gutter) this.world.remove(b);
    this.tray.length = 0;
    this.gutter.length = 0;
    this.wins = 0; this.lost = 0; this.dropped = 0;
    this.refused = 0; this.escaped = 0;
    this._pending = 0; this._quiet = 0;
  }

  /** Feed one medal from the chute at x. */
  _feed(x){
    const b = this._newMedal(x, SPEC.dropY, SPEC.headZ);
    if (b) this.dropped++; else this.refused++;
    return b;
  }

  /* ------------------------------------------------------------- update -- */
  update(dt){
    this.world.step(dt, h => this.rig.stepMechanism(h));
    this.rig.sync();
    this._sweep(false);
    this._syncMedals();
    // Once a payout heap has settled it is inert, and a sleeping body costs
    // nothing — but the tray floor is not kinematic, so nothing wakes them.

    // Batch the payout toast. Medals cross the lip in clusters and at any
    // moment — the pusher runs with no credit in the machine — so announce a
    // run once it has stopped rather than once per medal.
    if (this._pending){
      this._quiet += dt;
      if (this._quiet > 0.5){
        const n = this._pending;
        this._pending = 0; this._quiet = 0;
        this.collected.push({ jp: `メダル ×${n}`, en: `${n} MEDAL${n > 1 ? 'S' : ''}` });
        if (this.onWin) this.onWin(this.collected[this.collected.length - 1]);
      }
    }

    this.coinLamp.material.emissiveIntensity = this.rig.credit > 0
      ? 1.6 + Math.sin(performance.now()*0.006)*0.6 : 0;
    this.lipGlow.material.emissiveIntensity = 1.2 + Math.sin(performance.now()*0.004)*0.5;
    if (this.debug && this.debug.visible) this.updateDebug();
  }

  /**
   * Take everything that has left the field. Paid past the lip, lost down a
   * gutter, and a floor of last resort for anything that got out some other way
   * — which is worth counting separately, because it is a bug and not a play.
   */
  _sweep(quiet){
    const S = SPEC;
    let paid = 0, lost = 0;
    for (let i = this.medals.length - 1; i >= 0; i--){
      const b = this.medals[i];
      const p = b.pos;
      let fate = null;
      if (p.y < S.fieldY - 0.08 && p.z > S.lipZ) fate = 'paid';
      else if (p.y < S.fieldY - 0.08 && Math.abs(p.x) > S.fieldX) fate = 'lost';
      else if (p.y < S.trayY - 0.10) fate = 'escaped';
      if (!fate) continue;
      this.medals.splice(i, 1);
      if (fate === 'paid'){
        // A paid medal is not deleted, it is HANDED OVER — it keeps simulating
        // and piles up in the tray where the player can see what they won.
        paid++;
        this.tray.push(b);
        while (this.tray.length > TRAY_KEEP) this.world.remove(this.tray.shift());
      } else if (fate === 'lost'){
        // NOR IS A LOST ONE. This used to delete the medal the instant it
        // qualified — at y 0.62, which is 60 mm into a 140 mm fall — so the
        // single most important thing this cabinet does to you happened to a
        // medal that had already stopped existing. It did not even reach the
        // channel. A fifth of every stack fed in goes this way and the player
        // never saw one go.
        lost++;
        this.gutter.push(b);
        while (this.gutter.length > GUTTER_KEEP) this.world.remove(this.gutter.shift());
      } else {
        this.world.remove(b);
        this.escaped++;
      }
    }
    if (paid){ this.wins += paid; if (!quiet){ this._pending += paid; this._quiet = 0; } }
    this.lost += lost;

    // Neither the tray nor the gutters are swept for fate, but both ARE
    // watched: a medal that ends up below the floor it was handed to got out of
    // the machine, and that is a hole in the geometry rather than a payout or a
    // loss. Counting it is how the hole gets found.
    const drain = (list, floorY) => {
      for (let i = list.length - 1; i >= 0; i--){
        if (list[i].pos.y > floorY - 0.15) continue;
        this.world.remove(list[i]);
        list.splice(i, 1);
        this.escaped++;
      }
    };
    drain(this.tray, S.trayY);
    drain(this.gutter, S.gutterY);
  }

  /* ------------------------------------------------------------ visuals -- */
  _syncMedals(){
    const im = this.medalMesh;
    let i = 0;
    for (const b of this.medals){ _m4.compose(b.pos, b.quat, ONE); im.setMatrixAt(i++, _m4); }
    for (const b of this.tray)  { _m4.compose(b.pos, b.quat, ONE); im.setMatrixAt(i++, _m4); }
    for (const b of this.gutter){ _m4.compose(b.pos, b.quat, ONE); im.setMatrixAt(i++, _m4); }
    im.count = i;
    im.instanceMatrix.needsUpdate = true;
  }

  _buildVisuals(){
    const S = SPEC, root = this.root;

    const body   = new THREE.MeshStandardMaterial({ color:0x3a0d18, roughness:.44, metalness:.4 });
    const trim   = new THREE.MeshStandardMaterial({ color:0xffc93c, roughness:.34, metalness:.62 });
    const dark   = new THREE.MeshStandardMaterial({ color:0x120509, roughness:.86 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xdfe7f5, roughness:.18, metalness:.95 });
    const deckM  = new THREE.MeshStandardMaterial({ color:0x14323f, roughness:.52, metalness:.34 });
    const rail   = new THREE.MeshStandardMaterial({ color:0x2a1016, roughness:.5, metalness:.55 });
    const glass  = new THREE.MeshPhysicalMaterial({
      color:0xbcd8f0, roughness:.05, metalness:0, transparent:true, opacity:.10,
      side:THREE.DoubleSide, depthWrite:false, envMapIntensity:.3 });
    this.MAT = { body, trim, dark, chrome, deckM, glass };

    const box = (w,h,d,m,x,y,z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); root.add(o); return o;
    };

    /* THE BASE, WITH A PAYOUT RECESS CUT INTO IT.
       A solid plinth is what every other cabinet on this floor has and it is
       wrong here, because this is the only cabinet whose payout is a PLACE
       rather than an event. Modelled solid, the tray at y 0.48 sat inside the
       block: thirteen medals, correctly simulated, correctly lit, and behind
       18 cm of cabinet. Found by raycasting from the camera to a tray medal
       and getting three hits, none of them the medal. */
    const REC = { y0: 0.30, y1: 0.52, z0: 0.02, x: 0.34 };
    box(S.width, REC.y0, S.depth, body, 0, REC.y0/2, 0);
    box(S.width, REC.y1 - REC.y0, S.depth/2 + REC.z0, body,
        0, (REC.y0 + REC.y1)/2, -(S.depth/2 - REC.z0)/2 - REC.z0/2);
    for (const sx of [-1, 1])
      box(S.width/2 - REC.x, REC.y1 - REC.y0, S.depth/2 - REC.z0, body,
          sx*(S.width/2 + REC.x)/2, (REC.y0 + REC.y1)/2, (S.depth/2 + REC.z0)/2);

    const cw = 0.07, CW = S.width + 0.02, CD = S.depth + 0.02;
    for (const sz of [-1, 1]) box(CW, 0.05, cw, trim, 0, 0.640, sz*(CD - cw)/2);
    for (const sx of [-1, 1]) box(cw, 0.05, CD - cw*2, trim, sx*(CW - cw)/2, 0.640, 0);
    box(S.width + 0.02, 0.08, S.depth + 0.02, dark, 0, 0.040, 0);

    // the field, its rails, and the lip the whole game is aimed at
    for (const sx of [-1, 1]){
      const half = box(S.fieldX, 0.02, S.lipZ - S.backZ, deckM,
        sx * S.fieldX/2, S.fieldY - 0.01, (S.backZ + S.lipZ)/2);
      half.rotation.z = -sx * CROWN;
    }
    for (const sx of [-1, 1])
      box(0.030, S.railTop - S.shelfY, S.lipZ - S.backZ, rail,
          sx*(S.fieldX + 0.015), (S.shelfY + S.railTop)/2, (S.backZ + S.lipZ)/2);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(S.fieldX*2, 0.010, 0.016),
      new THREE.MeshStandardMaterial({ color:0xff3b5c, emissive:0xff3b5c,
        emissiveIntensity:1.6, roughness:.4 }));
    lip.position.set(0, S.fieldY - 0.005, S.lipZ + 0.008);
    root.add(lip);
    this.lipGlow = lip;

    /* THE GUTTERS, lit like the thing they are.
       Cold cyan against the field's warm gold, so a channel reads as loss and
       the payout well reads as gain without either needing a label. They were
       geometrically visible from a standing eye position all along — raycast
       and confirmed, nothing occludes them — and still invisible, because the
       floor was near-black, the glow was at 30% opacity, and no medal ever
       lasted long enough to land in one. All three had to go. */
    for (const sx of [-1, 1]){
      const cx = sx*(S.fieldX + S.gutterX)/2, cz = (S.backZ + S.lipZ)/2;
      box((S.gutterX - S.fieldX), 0.02, S.lipZ - S.backZ,
        new THREE.MeshStandardMaterial({ color:0x16323f, roughness:.75, metalness:.25 }),
        cx, S.gutterY - 0.01, cz);
      // the glow sits just UNDER the medals' resting height, never through them
      const g = new THREE.Mesh(
        new THREE.PlaneGeometry((S.gutterX - S.fieldX)*0.92, (S.lipZ - S.backZ)*0.96),
        new THREE.MeshStandardMaterial({ color:0x37e6ff, emissive:0x37e6ff,
          emissiveIntensity:1.15, roughness:.5, transparent:true, opacity:.36 }));
      g.rotation.x = -Math.PI/2;
      g.position.set(cx, S.gutterY + 0.0015, cz);
      root.add(g);
      // and a lamp in the channel, for the same reason the tray has one
      const lamp = new THREE.PointLight(0x8fe6ff, 1.5, 0.42, 2.0);
      lamp.position.set(cx, S.gutterY + 0.10, cz);
      root.add(lamp);
      // a lit edge strip along the field lip, so you can see WHERE the drop is
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.010, S.lipZ - S.backZ),
        new THREE.MeshStandardMaterial({ color:0x37e6ff, emissive:0x37e6ff,
          emissiveIntensity:1.5, roughness:.4 }));
      edge.position.set(sx*(S.fieldX + 0.004), S.fieldY - 0.006, cz);
      root.add(edge);
    }

    // the curtain, and the machine behind it
    box(S.fieldX*2 + 0.06, S.cageTop - S.shelfY, 0.09,
      new THREE.MeshStandardMaterial({ color:0x24090f, roughness:.7, metalness:.3 }),
      0, (S.shelfY + S.cageTop)/2, CURTAIN_Z - 0.045);
    const curtainLip = new THREE.Mesh(
      new THREE.BoxGeometry(S.fieldX*2 + 0.06, 0.008, 0.010), trim);
    curtainLip.position.set(0, S.shelfY + 0.006, CURTAIN_Z + 0.005);
    root.add(curtainLip);

    /* The payout well, built as SURFACES rather than as a solid block. It was a
       solid block first, which looks identical from outside and is not: the
       block filled the very volume the paid medals land in, so a tray with
       thirteen medals in it rendered as a flat black slab. A void modelled as a
       solid is invisible until something has to be inside it. */
    const wellDark = new THREE.MeshStandardMaterial({ color:0x2a1218, roughness:.85 });
    box(S.inX*2, S.fieldY - 0.04 - S.trayY, 0.03, wellDark,
        0, (S.trayY + S.fieldY - 0.04)/2, S.lipZ - 0.015);          // face under the lip
    for (const sx of [-1, 1])
      box(0.02, S.fieldY - S.trayY, S.inZ - S.lipZ, wellDark,
          sx*(S.inX - 0.01), (S.trayY + S.fieldY)/2, (S.lipZ + S.inZ)/2);
    box(S.inX*2, 0.04, S.inZ - S.lipZ, deckM, 0, S.trayY - 0.02, (S.lipZ + S.inZ)/2);
    /* The tray is LIT, and it has to be. A payout well is a cavity with no
       light path into it: the fourteen medals sitting in this one rendered as
       an unbroken black slab, correctly positioned and completely invisible.
       Real payout trays have a lamp in them for exactly this reason.

       The plane sits just UNDER the medals' resting height, not over it —
       at trayY + 0.012 it was drawn through them. */
    const wellGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(S.inX*1.9, (S.inZ - S.lipZ)*0.88),
      new THREE.MeshStandardMaterial({ color:0xffc93c, emissive:0xffc93c,
        emissiveIntensity:2.2, roughness:.5, transparent:true, opacity:.55 }));
    wellGlow.rotation.x = -Math.PI/2;
    wellGlow.position.set(0, S.trayY - 0.0005, (S.lipZ + S.inZ)/2);
    root.add(wellGlow);
    this.trayLamp = new THREE.PointLight(0xffd98a, 2.0, 0.55, 2.0);
    this.trayLamp.position.set(0, S.trayY + 0.13, (S.lipZ + S.inZ)/2 + 0.04);
    root.add(this.trayLamp);

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
      new THREE.MeshStandardMaterial({ color:0x1a0810, roughness:.75 }),
      0, cy, -S.inZ - 0.03);

    box(S.width, 0.26, S.depth, trim, 0, 1.60, 0);
    const tex = this._marqueeTexture();
    const mq = new THREE.Mesh(new THREE.PlaneGeometry(S.width - 0.06, 0.19),
      new THREE.MeshStandardMaterial({ map: tex, emissive:0xffffff, emissiveMap: tex,
        emissiveIntensity:1.4, roughness:.6 }));
    mq.position.set(0, 1.60, S.depth/2 + 0.004);
    root.add(mq);
    box(S.width + 0.03, 0.04, S.depth + 0.03, trim, 0, 1.75, 0);

    const coin = box(0.055, 0.075, 0.02, dark, -0.37, 0.590, S.depth/2 + 0.002);
    coin.userData.pick = 'coin'; this.picks.push(coin);
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color:0x2a1405, emissive:0xffc93c, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.37, 0.535, S.depth/2 + 0.012);
    root.add(this.coinLamp);

    /* ONE mesh for the whole carpet. A loaded field is 45+ tokens and a bank of
       these cabinets would be hundreds; as individual meshes that is more draw
       calls than the entire rest of the room. CylinderGeometry comes in three
       groups (side, top cap, bottom cap) and an InstancedMesh honours them, so
       the face art goes on the caps and milled brass on the rim for the cost of
       three draws total however many medals are on the field. */
    const geo = new THREE.CylinderGeometry(MEDAL.radius, MEDAL.radius, MEDAL.r*2, 18, 1, false);
    const rim  = new THREE.MeshStandardMaterial({ color:0xb98a24, roughness:.38, metalness:.85 });
    const face = new THREE.MeshStandardMaterial({ map: medalFace(), roughness:.34, metalness:.75 });
    this.medalMesh = new THREE.InstancedMesh(geo, [rim, face, face],
      MAX_MEDALS + TRAY_KEEP + GUTTER_KEEP);
    this.medalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.medalMesh.frustumCulled = false;
    this.medalMesh.count = 0;
    root.add(this.medalMesh);
  }

  _marqueeTexture(){
    if (this._mqTex) return this._mqTex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#180309'; g.fillRect(0, 0, 1024, 256);
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#8e0d22'); grd.addColorStop(.5, '#ff3b5c'); grd.addColorStop(1, '#ffc93c');
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
    g.globalAlpha = .16; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0,256); g.lineTo(520,0); g.lineTo(740,0); g.lineTo(220,256); g.fill();
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 104px ${JP_FONT}`;
    g.lineWidth = 12; g.strokeStyle = 'rgba(16,4,8,.85)';
    g.strokeText('メダルゲーム', 512, 100);
    g.fillStyle = '#fff'; g.fillText('メダルゲーム', 512, 100);
    g.font = `bold 32px ${JP_FONT}`;
    g.fillText('MEDAL PUSHER  ·  ¥100', 512, 196);
    this._mqTex = new THREE.CanvasTexture(c);
    this._mqTex.colorSpace = THREE.SRGBColorSpace;
    return this._mqTex;
  }

  reset(){
    for (const b of this.medals) this.world.remove(b);
    for (const b of this.tray) this.world.remove(b);
    for (const b of this.gutter) this.world.remove(b);
    this.medals.length = 0;
    this.tray.length = 0;
    this.gutter.length = 0;
    this.rig.reset();
    this.wins = 0; this.lost = 0; this.dropped = 0;
    this.refused = 0; this.escaped = 0;
    this._pending = 0; this._quiet = 0;
    this._loadField();
  }

  /* --------------------------------------------------------------- debug -- */
  buildDebug(){
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color:0x00ff9d, wireframe:true,
      transparent:true, opacity:.4, depthTest:false });
    const hot = new THREE.MeshBasicMaterial({ color:0xff3d8b, wireframe:true,
      transparent:true, opacity:.85, depthTest:false });
    for (const c of this.world.colliders){
      if (!(c instanceof BoxCollider) || c === this.rig.pusher) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(c.h.x*2, c.h.y*2, c.h.z*2), mat);
      m.position.copy(c.c); m.quaternion.copy(c.q);
      g.add(m);
    }
    this.rig.buildDebug(g, hot);
    g.renderOrder = 999;
    this.debug = g;
    this.root.add(g);
    return g;
  }
  updateDebug(){
    if (!this.debug || !this.debug.visible) return;
    this.rig.updateDebug();
  }
}

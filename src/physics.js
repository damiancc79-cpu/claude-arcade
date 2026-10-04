/* ============================================================================
   physics.js — small rigid-body engine shared by every machine on the floor.

   Ported from the standalone claw machine and generalised. The solver is the
   same one that was tuned there:

     · bodies are clusters of spheres (one sphere is the common case here;
       plush toys use several so they tumble and catch on each other)
     · sequential impulses, accumulated normal impulse clamped >= 0, two-axis
       Coulomb friction clamped to mu * Pn
     · warm starting across frames, keyed per contact pair
     · split impulse (pseudo velocities) for penetration recovery, so pushing
       overlapping bodies apart never injects real kinetic energy
     · velocity-threshold sleeping so a settled pile costs nothing

   CONTACT NORMAL CONVENTION — normals always point TOWARD body `a`, the body
   that receives the positive impulse. Getting this backwards makes bodies
   attract instead of repel; every collider below follows it.

   Static geometry is described with collider objects exposing
   `collide(centre, radius, out[])`. Kinematic ones also expose
   `pointVel(p, out)` so a moving surface can drag bodies along with it.
============================================================================ */
import * as THREE from 'three';

const V3 = THREE.Vector3;

export const DEFAULTS = {
  gravity   : -9.81,
  fixedDt   : 1/120,
  maxSubsteps: 5,
  velIters  : 10,
  posIters  : 4,
  slop      : 0.0012,
  baumgarte : 0.28,
  maxCorrect: 1.6,
  sleepLin  : 0.020,     // m/s
  sleepAng  : 0.35,      // rad/s
  sleepTime : 0.55,      // s below threshold before sleeping
};

/* ------------------------------------------------------------ scratch ---- */
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(),
      _f = new V3(), _g = new V3(), _h = new V3(), _k = new V3();
const _m3 = new THREE.Matrix3(), _m3b = new THREE.Matrix3(), _m4 = new THREE.Matrix4();

function rotateInertia(out, Il, R){
  _m3.copy(R).multiply(Il);
  _m3b.copy(R).transpose();
  return out.copy(_m3).multiply(_m3b);
}
function m3apply(out, m, v){
  const e = m.elements, x = v.x, y = v.y, z = v.z;
  return out.set(e[0]*x + e[3]*y + e[6]*z,
                 e[1]*x + e[4]*y + e[7]*z,
                 e[2]*x + e[5]*y + e[8]*z);
}
function basis(n, t1, t2){
  if (Math.abs(n.x) >= 0.57735) t1.set(n.y, -n.x, 0);
  else                          t1.set(0, n.z, -n.y);
  t1.normalize();
  t2.copy(n).cross(t1);
}

/* ================================================================ body ==== */
let _bodyId = 0;

export class Body {
  /**
   * @param spheres [{o:[x,y,z], r}]  collision cluster in local space
   * @param opts    {density, friction, restitution, linDamp, angDamp}
   */
  constructor(spheres, opts = {}){
    const {
      density = 120, friction = 0.5, restitution = 0.08,
      linDamp = 0.10, angDamp = 0.60, mass: massTarget = null,
    } = opts;

    this.id = _bodyId++;
    this.pos  = new V3();
    this.quat = new THREE.Quaternion();
    this.vel  = new V3();
    this.avel = new V3();
    this.pvel = new V3();     // pseudo velocities (position correction only)
    this.pavel= new V3();
    this.friction = friction;
    this.restitution = restitution;
    this.linDamp = linDamp;
    this.angDamp = angDamp;

    // --- mass properties from the sphere cluster -------------------------
    let m = 0;
    const com = new V3();
    const raw = spheres.map(s => ({ o:new V3(s.o[0], s.o[1], s.o[2]), r:s.r, m:0 }));
    for (const s of raw){
      s.m = (4/3) * Math.PI * s.r ** 3 * density;
      m += s.m;
      com.addScaledVector(s.o, s.m);
    }
    com.divideScalar(m);
    for (const s of raw) s.o.sub(com);
    this.comOffset = com.clone();

    // solid-sphere term + parallel axis, then invert
    const I = [0,0,0, 0,0,0, 0,0,0];
    for (const s of raw){
      const is = 0.4 * s.m * s.r * s.r;
      const dv = s.o, dd = dv.lengthSq();
      I[0] += is + s.m*(dd - dv.x*dv.x); I[1] += -s.m*dv.x*dv.y;            I[2] += -s.m*dv.x*dv.z;
      I[3] += -s.m*dv.y*dv.x;            I[4] += is + s.m*(dd - dv.y*dv.y); I[5] += -s.m*dv.y*dv.z;
      I[6] += -s.m*dv.z*dv.x;            I[7] += -s.m*dv.z*dv.y;            I[8] += is + s.m*(dd - dv.z*dv.z);
    }
    // A sphere cluster's summed volume is a poor proxy for a real object's
    // mass (overlaps double-count, boxes are mostly air). `mass` lets a machine
    // state the weight it wants; inertia scales with it.
    let scale = 1;
    if (massTarget){ scale = massTarget / m; m = massTarget; }
    if (scale !== 1) for (let i = 0; i < 9; i++) I[i] *= scale;

    this.mass = m;
    this.invMass = 1/m;
    this.invIlocal = new THREE.Matrix3().set(I[0],I[1],I[2], I[3],I[4],I[5], I[6],I[7],I[8]).invert();
    this.invI = new THREE.Matrix3().copy(this.invIlocal);
    this.rotM = new THREE.Matrix3();

    this.spheres = raw.map(s => ({ o:s.o, r:s.r, w:new V3() }));
    let br = 0;
    for (const s of this.spheres) br = Math.max(br, s.o.length() + s.r);
    this.bound = br;

    this.awake = true;
    this.sleepT = 0;
    // Was this body still at the START of the current substep, before gravity?
    // See World.substep — sampling it anywhere else gives the wrong answer.
    this.quiet = false;
    this.dead = false;
    this.mesh = null;
    this.tag = null;         // free-form: machines use it to identify bodies
  }

  updateTransform(){
    _m4.makeRotationFromQuaternion(this.quat);
    this.rotM.setFromMatrix4(_m4);
    rotateInertia(this.invI, this.invIlocal, this.rotM);
    for (const s of this.spheres) m3apply(s.w, this.rotM, s.o).add(this.pos);
  }
  pointVel(p, out){
    _a.copy(p).sub(this.pos);
    return out.copy(this.avel).cross(_a).add(this.vel);
  }
  wake(){ this.awake = true; this.sleepT = 0; }
  setPos(x, y, z){ this.pos.set(x, y, z); this.updateTransform(); this.wake(); return this; }
  /** Push the body's transform onto its render mesh. */
  syncMesh(){
    if (!this.mesh) return;
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
  }
}

/**
 * Sphere cluster approximating a solid box, for prize packaging.
 *
 * Eight spheres at the corners is the obvious construction and it is WRONG for
 * anything but a near-cube: on a long box the corner spheres do not meet in the
 * middle, leaving a gap a claw prong passes straight through. This lays out a
 * grid dense enough that neighbours always overlap, so the envelope is a closed
 * rounded cuboid. `r` trades corner rounding against sphere count.
 *
 * @param half [hx,hy,hz] box half-extents
 * @param r    sphere radius; clamped to the smallest half-extent
 */
export function boxCluster(half, r){
  r = Math.min(r, half[0], half[1], half[2]);
  const step = r * 1.7;                       // < 2r, so neighbours overlap
  const spread = [0,1,2].map(i => Math.max(0, half[i] - r));
  const counts = spread.map(e => e < 1e-6 ? 1 : Math.max(2, Math.ceil(2*e / step) + 1));
  const axis = (e, n) => n === 1 ? [0]
    : Array.from({ length: n }, (_, i) => -e + (2*e*i) / (n - 1));
  const out = [];
  const [ax, ay, az] = [axis(spread[0], counts[0]),
                        axis(spread[1], counts[1]),
                        axis(spread[2], counts[2])];
  for (let i = 0; i < ax.length; i++)
    for (let j = 0; j < ay.length; j++)
      for (let k = 0; k < az.length; k++){
        // interior spheres can never touch anything — skip them
        const onShell = i === 0 || i === ax.length-1 ||
                        j === 0 || j === ay.length-1 ||
                        k === 0 || k === az.length-1;
        if (onShell) out.push({ o: [ax[i], ay[j], az[k]], r });
      }
  return out;
}

/* ============================================================ colliders === */
let _colId = 0;

/** Base class. Subclasses push contacts into `out` as {n, depth, p}. */
export class Collider {
  constructor(opts = {}){
    this.id = _colId++;
    this.friction    = opts.friction    ?? 0.45;
    this.restitution = opts.restitution ?? 0.05;
    this.enabled     = opts.enabled     ?? true;
    this.kinematic   = false;
  }
  collide(/* centre, radius, out */){ }
  pointVel(p, out){ out.set(0, 0, 0); }
}

function pushContact(out, nx, ny, nz, depth, px, py, pz){
  out.push({ nx, ny, nz, depth, px, py, pz });
}

/** Infinite half-space. n·x + d = 0, n points into the allowed region. */
export class PlaneCollider extends Collider {
  constructor(n, d, opts){ super(opts); this.n = new V3().fromArray(n).normalize(); this.d = d; }
  collide(c, r, out){
    const dist = this.n.dot(c) + this.d;
    if (dist >= r) return;
    const depth = r - dist;
    pushContact(out, this.n.x, this.n.y, this.n.z, depth,
      c.x - this.n.x*(r - depth*0.5),
      c.y - this.n.y*(r - depth*0.5),
      c.z - this.n.z*(r - depth*0.5));
  }
}

/** Solid oriented box; bodies collide with it from the outside. */
export class BoxCollider extends Collider {
  constructor(center, half, quat, opts){
    super(opts);
    this.c = new V3().fromArray(center);
    this.h = new V3().fromArray(half);
    this.q = quat ? quat.clone() : new THREE.Quaternion();
    this.qi = this.q.clone().invert();
  }
  collide(c, r, out){
    // sphere centre in box space
    _a.copy(c).sub(this.c).applyQuaternion(this.qi);
    const cx = Math.max(-this.h.x, Math.min(this.h.x, _a.x));
    const cy = Math.max(-this.h.y, Math.min(this.h.y, _a.y));
    const cz = Math.max(-this.h.z, Math.min(this.h.z, _a.z));
    _b.set(cx, cy, cz);
    _c.copy(_a).sub(_b);
    let d2 = _c.lengthSq(), nx, ny, nz, depth;

    if (d2 > 1e-12){                                  // centre outside the box
      const dist = Math.sqrt(d2);
      if (dist >= r) return;
      _c.divideScalar(dist);
      depth = r - dist;
      nx = _c.x; ny = _c.y; nz = _c.z;
    } else {                                          // centre inside: eject on the shallowest axis
      const ex = this.h.x - Math.abs(_a.x);
      const ey = this.h.y - Math.abs(_a.y);
      const ez = this.h.z - Math.abs(_a.z);
      if (ex <= ey && ex <= ez){ nx = Math.sign(_a.x) || 1; ny = 0; nz = 0; depth = r + ex; }
      else if (ey <= ez)       { nx = 0; ny = Math.sign(_a.y) || 1; nz = 0; depth = r + ey; }
      else                     { nx = 0; ny = 0; nz = Math.sign(_a.z) || 1; depth = r + ez; }
      _b.copy(_a);
    }
    _d.set(nx, ny, nz).applyQuaternion(this.q);
    _b.applyQuaternion(this.q).add(this.c);
    pushContact(out, _d.x, _d.y, _d.z, depth, _b.x, _b.y, _b.z);
  }
}

/**
 * Hollow sphere; bodies are kept INSIDE it (a globe / bowl).
 * `yMin` opens the bottom of the shell: below that height the sphere stops
 * constraining, so the contents can drain into whatever sits underneath.
 * Without it a globe is a sealed ball and nothing ever reaches the mechanism.
 */
export class SphereShellCollider extends Collider {
  constructor(center, radius, opts = {}){
    super(opts);
    this.c = new V3().fromArray(center);
    this.r = radius;
    this.yMin = opts.yMin ?? -Infinity;
  }
  collide(c, r, out){
    if (c.y < this.yMin) return;
    _a.copy(c).sub(this.c);
    const dist = _a.length();
    const limit = this.r - r;
    if (dist <= limit) return;
    if (dist < 1e-9) return;
    _a.divideScalar(dist);                 // outward
    const depth = dist - limit;
    pushContact(out, -_a.x, -_a.y, -_a.z, depth,      // normal points inward
      this.c.x + _a.x*this.r, this.c.y + _a.y*this.r, this.c.z + _a.z*this.r);
  }
}

/**
 * Hollow truncated cone with a vertical axis; bodies are kept INSIDE.
 * This is the hopper funnel that feeds capsules down to the mechanism.
 */
export class FunnelCollider extends Collider {
  constructor({ cx = 0, cz = 0, yTop, rTop, yBot, rBot }, opts){
    super(opts);
    this.cx = cx; this.cz = cz;
    this.yTop = yTop; this.rTop = rTop;
    this.yBot = yBot; this.rBot = rBot;
    const dy = yTop - yBot, dr = rTop - rBot;
    this.slope = dr / dy;                       // dR/dY
    // surface normal in the (radial, y) plane, pointing inward
    const len = Math.hypot(1, this.slope);
    this.nr = -1 / len;
    this.ny =  this.slope / len;
  }
  collide(c, r, out){
    if (c.y > this.yTop || c.y < this.yBot - r) return;
    const dx = c.x - this.cx, dz = c.z - this.cz;
    const rad = Math.hypot(dx, dz);
    // Clamp below the throat so the cone doesn't keep narrowing past its
    // opening — under yBot it behaves as a short straight neck.
    const wallR = this.rBot + Math.max(0, c.y - this.yBot) * this.slope;
    // signed distance from the cone surface, measured inward
    const dist = (wallR - rad) * (-this.nr);
    if (dist >= r) return;
    const depth = r - dist;
    const ux = rad > 1e-9 ? dx / rad : 1, uz = rad > 1e-9 ? dz / rad : 0;
    const nx = this.nr * ux, ny = this.ny, nz = this.nr * uz;
    pushContact(out, nx, ny, nz, depth,
      c.x - nx*(r - depth*0.5), c.y - ny*(r - depth*0.5), c.z - nz*(r - depth*0.5));
  }
}

/**
 * A one-degree-of-freedom hinge, solved in reduced coordinates.
 *
 * Claw prongs are not animated: a motor torque drives the angle, and prizes
 * push back through the very same contacts that move them. Attaching an Arm to
 * a collider makes the solver treat it as a body with real rotational inertia
 * about its hinge — the contact's effective mass picks up a (axis x r)^2 / I
 * term, and every impulse feeds back into the arm's angular velocity.
 *
 * IMPORTANT: integrate `angle` from `avel` AFTER World.substep(), never before.
 * Advancing the angle first lets the prong sweep through a prize and only then
 * have its velocity cancelled — it passes straight through whatever it hits.
 */
export class Arm {
  constructor(inertia = 0.012){
    this.axis  = new V3(0, 0, 1);   // world hinge axis
    this.pivot = new V3();          // world hinge point
    this.invI  = 1 / inertia;
    this.avel  = 0;
    this.angle = 0;
  }
  setInertia(i){ this.invI = 1 / i; }
}

/** Capsule: a segment with a radius. The workhorse for claw prongs. */
export class CapsuleCollider extends Collider {
  constructor(a, b, radius, opts){
    super(opts);
    this.a = new V3().fromArray(a);
    this.b = new V3().fromArray(b);
    this.r = radius;
  }
  collide(c, r, out){
    _a.copy(this.b).sub(this.a);
    const L2 = _a.lengthSq();
    let t = L2 > 1e-12 ? _b.copy(c).sub(this.a).dot(_a) / L2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    _c.copy(this.a).addScaledVector(_a, t);          // closest point on the segment
    _d.copy(c).sub(_c);
    const sum = this.r + r, d2 = _d.lengthSq();
    if (d2 >= sum*sum || d2 < 1e-12) return;
    const dist = Math.sqrt(d2);
    _d.divideScalar(dist);
    pushContact(out, _d.x, _d.y, _d.z, sum - dist,
      _c.x + _d.x*this.r, _c.y + _d.y*this.r, _c.z + _d.z*this.r);
  }
}

/** Solid cylinder with a vertical axis (a post). Bodies collide outside it. */
export class PostCollider extends Collider {
  constructor({ cx = 0, cz = 0, r, y0, y1 }, opts){
    super(opts);
    this.cx = cx; this.cz = cz; this.r = r; this.y0 = y0; this.y1 = y1;
  }
  collide(c, rad, out){
    if (c.y < this.y0 - rad || c.y > this.y1 + rad) return;
    const dx = c.x - this.cx, dz = c.z - this.cz;
    const d = Math.hypot(dx, dz);
    if (d >= this.r + rad || d < 1e-9) return;
    const depth = this.r + rad - d;
    const nx = dx/d, nz = dz/d;
    pushContact(out, nx, 0, nz, depth, this.cx + nx*this.r, c.y, this.cz + nz*this.r);
  }
}

/* =============================================================== link ===== */
/**
 * Distance link between two body centres, or between a body and a fixed point
 * in the world. A chain of these IS a cord — there is no rope primitive beyond
 * this.
 *
 * Anchors are at the body CENTRES by default, which drops every rotational term
 * out of the solve. For a cord that is not an approximation worth worrying about
 * (a 16 mm bead has no meaningful angular inertia) and it makes the constraint
 * stiff enough to hang a half-kilo prize without a joint solver.
 *
 * `ra` / `rb` opt into LOCAL ANCHOR POINTS on either body instead, which turns
 * the link into a proper distance joint: the rotational terms come back, an
 * impulse torques the bodies it acts on, and two of them side by side make a
 * hanger that cannot yaw. リング掛け needs that — a tag hung from its centre has
 * no restoring torque at all and keeps whatever orientation it was last knocked
 * into, which on that cabinet is an unhookable prize. The offsets are optional
 * and the centre-anchored path is left arithmetically untouched, so ヒモ's cord
 * is bit-identical either way (verified: 13 bead positions and 13 tensions to
 * nine decimal places after 600 substeps).
 *
 * `rope: true` resists stretching only — it goes slack when the ends come
 * closer than `len`, the way a cord does. Set false for a rigid rod.
 *
 * `tension` is left in newtons after each substep. Machines read it: a cord
 * that is not taut cannot be cut, however hard you press it onto a blade.
 */
export class Link {
  /**
   * @param a  body
   * @param b  body, or null to anchor to a fixed world point
   * @param len rest length
   * @param opts {rope, anchor:[x,y,z], ra:[x,y,z], rb:[x,y,z]}
   */
  constructor(a, b, len, opts = {}){
    this.a = a;
    this.b = b;
    this.len = len;
    this.rope = opts.rope ?? true;
    // Local anchor points. Absent on both ends means centre-to-centre and the
    // original solve; present on either end switches the whole link to the
    // anchored path in World.
    this.raL = opts.ra ? new V3().fromArray(opts.ra) : null;
    this.rbL = opts.rb ? new V3().fromArray(opts.rb) : null;
    this.anchored = !!(this.raL || this.rbL);
    this.wa = new V3();          // world-space offsets, refreshed each substep
    this.wb = new V3();
    /**
     * XPBD compliance, in metres per newton — the inverse of stiffness. 0 is a
     * rigid constraint. It enters the solve as α̃ = compliance/dt², which both
     * softens the constraint and REGULARISES the accumulated impulse: the −α̃λ
     * term pulls λ back toward the compliant solution every iteration, so it
     * settles instead of ratcheting. That is the property this is here for.
     * Decaying a warm-started impulse by a fudge factor is the hack it replaces.
     *
     * CAVEAT: leave this at 0 and there is no regulariser, while the warm start
     * is undecayed — which is the combination that ratchets. Any link that
     * carries a steady load wants a small non-zero compliance. 5e-6 hangs a
     * 350 g prize on a 12-link cord at 17% stretch with correct tension, and
     * full recovery from a 4.5 m/s shock.
     */
    this.compliance = opts.compliance ?? 0;
    this.gamma = 0;
    this.anchor = opts.anchor ? new V3().fromArray(opts.anchor) : new V3();
    this.n = new V3();
    this.P = 0;          // accumulated impulse, warm-started between substeps
    this.Pp = 0;
    this.k = 0;
    this.bias = 0;
    this.slack = true;
    this.dist = len;
    this.tension = 0;
    this.broken = false;
  }
  /** World position of the far end — the other body, or the fixed anchor. */
  far(out){
    if (!this.b) return out.copy(this.anchor);
    return this.anchored ? out.copy(this.b.pos).add(this.wb) : out.copy(this.b.pos);
  }
  /** World position of the near end. */
  near(out){
    return this.anchored ? out.copy(this.a.pos).add(this.wa) : out.copy(this.a.pos);
  }
  get invMassB(){ return this.b ? this.b.invMass : 0; }
}

/* ============================================================== world ===== */
export class World {
  constructor(opts = {}){
    this.cfg = { ...DEFAULTS, ...opts };
    this.bodies = [];
    this.colliders = [];
    this.links = [];
    this.contacts = [];
    this.pool = [];
    this.prevCache = new Map();
    this.acc = 0;
    this._hits = [];
  }

  add(body){ this.bodies.push(body); return body; }
  addCollider(c){ this.colliders.push(c); return c; }
  addLink(l){ this.links.push(l); return l; }
  removeLink(l){
    const i = this.links.indexOf(l);
    if (i >= 0) this.links.splice(i, 1);
  }
  remove(body){
    body.dead = true;
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
  }
  wakeAll(){ for (const b of this.bodies) b.wake(); }

  /**
   * Is this body quiet enough to be a candidate for sleep?
   *
   * One definition, used both by the integrator (to run a body's sleep timer)
   * and by `buildContacts` (to decide whether a body is disturbing its
   * neighbours). Those two have to agree: if a body can be "too still to
   * sleep" and "moving enough to wake others" at the same time, a pile never
   * settles.
   */
  still(b){
    return b.vel.lengthSq()  < this.cfg.sleepLin ** 2 &&
           b.avel.lengthSq() < this.cfg.sleepAng ** 2;
  }

  _contact(){
    let c = this.pool.pop();
    if (!c) c = {
      a:null, b:null, col:null, arm:null,
      n:new V3(), t1:new V3(), t2:new V3(), p:new V3(),
      ra:new V3(), rb:new V3(), av:new V3(),
      depth:0, mu:0, e:0, key:0, vTarget:0, bias:0,
      kn:0, kt1:0, kt2:0, jaN:0, jaT1:0, jaT2:0,
      Pn:0, Pt1:0, Pt2:0, Pp:0,
    };
    c.a = c.b = c.col = c.arm = null;
    c.Pn = c.Pt1 = c.Pt2 = c.Pp = 0;
    return c;
  }

  /* --------------------------------------------------------- narrowphase */
  buildContacts(){
    for (const c of this.contacts) this.pool.push(c);
    this.contacts.length = 0;
    const B = this.bodies;

    // body vs body
    for (let i = 0; i < B.length; i++){
      const A = B[i];
      if (A.dead) continue;
      for (let j = i+1; j < B.length; j++){
        const C = B[j];
        if (C.dead) continue;
        if (!A.awake && !C.awake) continue;
        const rr = A.bound + C.bound;
        if (A.pos.distanceToSquared(C.pos) > rr*rr) continue;
        for (let si = 0; si < A.spheres.length; si++){
          const sa = A.spheres[si];
          for (let sj = 0; sj < C.spheres.length; sj++){
            const sb = C.spheres[sj];
            _a.copy(sa.w).sub(sb.w);              // toward A
            const rsum = sa.r + sb.r, d2 = _a.lengthSq();
            if (d2 >= rsum*rsum || d2 < 1e-12) continue;
            const dist = Math.sqrt(d2);
            const ct = this._contact();
            ct.a = A; ct.b = C;
            ct.n.copy(_a).divideScalar(dist);
            ct.depth = rsum - dist;
            ct.p.copy(sa.w).addScaledVector(ct.n, -(sa.r - ct.depth*0.5));
            ct.mu = Math.sqrt(A.friction * C.friction);
            ct.e  = Math.min(A.restitution, C.restitution);
            ct.key = ((A.id*8 + si) * 100003) + (C.id*8 + sj);
            this.contacts.push(ct);
            /* Wake a sleeping body only when the thing touching it is actually
               MOVING. Being awake is not enough, and the difference is the
               whole reason a settled pile used to stay awake for ever.

               This line used to read `A.wake(); C.wake()`, which has two
               faults. It re-wakes the body that just fell asleep, and — worse —
               `wake()` resets `sleepT`, so it also puts its still-awake
               neighbours back to zero. A pile could therefore only sleep if
               every member crossed the threshold on the SAME substep: the first
               one over the line reset everyone else, and the cycle restarted.
               Traced on 三本爪, whose prizes sat at 0.0003 m/s against a
               0.02 threshold and cycled 0.54 → sleep → wake → 0.008 → … for
               2400 substeps without ever going quiet.

               Using the integrator's own stillness test is the honest rule: if
               this body is calm enough that it would fall asleep itself, it is
               not a disturbance. Only the sleeper is touched, so the mover's
               own timer keeps running and the island converges. */
            if (A.awake !== C.awake){
              const mover = A.awake ? A : C;
              if (!mover.quiet) (A.awake ? C : A).wake();
            }
          }
        }
      }
    }

    // body vs colliders
    const hits = this._hits;
    for (const A of B){
      if (A.dead) continue;
      for (const col of this.colliders){
        if (!col.enabled) continue;
        if (!A.awake && !col.kinematic) continue;
        for (let si = 0; si < A.spheres.length; si++){
          const s = A.spheres[si];
          hits.length = 0;
          col.collide(s.w, s.r, hits);
          for (let hi = 0; hi < hits.length; hi++){
            const h = hits[hi];
            if (col.kinematic) A.wake();
            const ct = this._contact();
            ct.a = A; ct.b = null; ct.col = col; ct.arm = col.arm || null;
            ct.n.set(h.nx, h.ny, h.nz);
            ct.depth = h.depth;
            ct.p.set(h.px, h.py, h.pz);
            ct.mu = Math.sqrt(A.friction * col.friction);
            ct.e  = Math.min(A.restitution, col.restitution);
            ct.key = ((A.id*8 + si) * 100003) + (500000 + col.id*4 + hi);
            this.contacts.push(ct);
          }
        }
      }
    }
  }

  /* -------------------------------------------------------------- solver */
  /** Surface velocity of whatever body `a` is touching (collider + arm spin). */
  otherVel(c, out){
    out.set(0, 0, 0);
    if (c.col && c.col.kinematic) c.col.pointVel(c.p, out);
    if (c.arm) out.addScaledVector(c.av, c.arm.avel);
    return out;
  }

  relNormalVel(c){
    c.a.pointVel(c.p, _e);
    if (c.b){ c.b.pointVel(c.p, _f); _e.sub(_f); }
    else if (c.col){ this.otherVel(c, _f); _e.sub(_f); }
    return _e.dot(c.n);
  }

  prepare(dt){
    for (const c of this.contacts){
      const A = c.a, B2 = c.b;
      c.ra.copy(c.p).sub(A.pos);
      if (B2) c.rb.copy(c.p).sub(B2.pos);
      basis(c.n, c.t1, c.t2);

      // reduced-coordinate hinge term: av = axis x (p - pivot)
      if (c.arm){
        _k.copy(c.p).sub(c.arm.pivot);
        c.av.copy(c.arm.axis).cross(_k);
        c.jaN = c.av.dot(c.n); c.jaT1 = c.av.dot(c.t1); c.jaT2 = c.av.dot(c.t2);
      } else {
        c.av.set(0,0,0); c.jaN = c.jaT1 = c.jaT2 = 0;
      }

      // k = 1/m + ((I⁻¹(r × d)) × r)·d
      const kmass = dir => {
        let k = A.invMass;
        _a.copy(c.ra).cross(dir);
        m3apply(_b, A.invI, _a);
        k += _b.cross(c.ra).dot(dir);
        if (B2){
          k += B2.invMass;
          _a.copy(c.rb).cross(dir);
          m3apply(_b, B2.invI, _a);
          k += _b.cross(c.rb).dot(dir);
        }
        return k;
      };
      const ai = c.arm ? c.arm.invI : 0;
      const kn  = kmass(c.n)  + c.jaN  * c.jaN  * ai;
      const kt1 = kmass(c.t1) + c.jaT1 * c.jaT1 * ai;
      const kt2 = kmass(c.t2) + c.jaT2 * c.jaT2 * ai;
      c.kn  = kn  > 1e-9 ? 1/kn  : 0;
      c.kt1 = kt1 > 1e-9 ? 1/kt1 : 0;
      c.kt2 = kt2 > 1e-9 ? 1/kt2 : 0;

      c.bias = Math.min(this.cfg.maxCorrect,
        (this.cfg.baumgarte / dt) * Math.max(0, c.depth - this.cfg.slop));

      const vn = this.relNormalVel(c);
      c.vTarget = (vn < -0.55) ? -c.e * vn : 0;

      const prev = this.prevCache.get(c.key);
      if (prev){
        c.Pn = prev.Pn * 0.92; c.Pt1 = prev.Pt1 * 0.92; c.Pt2 = prev.Pt2 * 0.92;
        _a.set(0,0,0).addScaledVector(c.n, c.Pn)
                     .addScaledVector(c.t1, c.Pt1)
                     .addScaledVector(c.t2, c.Pt2);
        this.applyImpulse(c, _a, false);
        if (c.arm) c.arm.avel -= (c.Pn*c.jaN + c.Pt1*c.jaT1 + c.Pt2*c.jaT2) * c.arm.invI;
      }
    }
  }

  applyImpulse(c, P, pseudo){
    const A = c.a;
    if (pseudo){
      A.pvel.addScaledVector(P, A.invMass);
      _g.copy(c.ra).cross(P); m3apply(_h, A.invI, _g); A.pavel.add(_h);
      if (c.b){
        c.b.pvel.addScaledVector(P, -c.b.invMass);
        _g.copy(c.rb).cross(P); m3apply(_h, c.b.invI, _g); c.b.pavel.sub(_h);
      }
      return;
    }
    // Let a collider tally what the world pushed back with — machines use it to
    // sense contact (e.g. a hoist stalling as the claw settles onto a prize).
    if (c.col && c.col.reaction) c.col.reaction.sub(P);
    A.vel.addScaledVector(P, A.invMass);
    _g.copy(c.ra).cross(P); m3apply(_h, A.invI, _g); A.avel.add(_h);
    if (c.b){
      c.b.vel.addScaledVector(P, -c.b.invMass);
      _g.copy(c.rb).cross(P); m3apply(_h, c.b.invI, _g); c.b.avel.sub(_h);
    }
  }

  /* ---------------------------------------------------------------- links */
  prepareLinks(dt){
    for (const l of this.links){
      if (l.broken){ l.k = 0; continue; }
      const A = l.a;
      // Anchored links measure between two POINTS ON the bodies, so the world
      // offsets have to be refreshed from the current rotations first.
      if (l.anchored){
        if (l.raL) m3apply(l.wa, A.rotM, l.raL); else l.wa.set(0,0,0);
        if (l.rbL && l.b) m3apply(l.wb, l.b.rotM, l.rbL); else l.wb.set(0,0,0);
      }
      l.far(_a).sub(l.near(_b));
      const dist = _a.length();
      l.dist = dist;
      if (dist < 1e-9){ l.k = 0; l.P = 0; continue; }
      l.n.copy(_a).divideScalar(dist);            // points from A toward the far end
      let km = A.invMass + l.invMassB;
      if (l.anchored){
        // k = 1/m + ((I⁻¹(r × n)) × r)·n, the same term contacts carry
        _c.copy(l.wa).cross(l.n);
        m3apply(_d, A.invI, _c);
        km += _d.cross(l.wa).dot(l.n);
        if (l.b){
          _c.copy(l.wb).cross(l.n);
          m3apply(_d, l.b.invI, _c);
          km += _d.cross(l.wb).dot(l.n);
        }
      }
      // α̃ = compliance / dt². Folded into the effective mass, exactly as XPBD
      // does, so a compliant link simply resists less per unit impulse.
      l.gamma = l.compliance / (dt * dt);
      const denom = km + l.gamma;
      l.k = denom > 1e-9 ? 1/denom : 0;
      const stretch = dist - l.len;
      l.slack = l.rope && stretch <= 0;
      l.bias = Math.min(this.cfg.maxCorrect,
        (this.cfg.baumgarte / dt) * Math.max(0, stretch - this.cfg.slop));
      l.Pp = 0;
      // A stretched link MUST wake both ends. Contacts do this via the
      // kinematic check; links had no equivalent, and the consequence was not
      // subtle — a shock load stretched a cord 32% and it then fell asleep in
      // that shape, because the solver kept applying impulses that the
      // integrator skipped for a sleeping body. The cord stayed visibly
      // elastic-stretched for the rest of the session.
      if (l.bias > 0){ A.wake(); if (l.b) l.b.wake(); }
      if (l.slack){ l.P = 0; l.tension = 0; continue; }
      // Warm start UNDECAYED, and let compliance do the regulating.
      //
      // Textbook XPBD resets λ every substep; that is correct for a
      // position-based solver with many substeps and few iterations, and it is
      // wrong here. This is a velocity-level solver, where warm starting is
      // what carries a chain's tension from one substep to the next — reset it
      // and a 13-link cord cannot rebuild its tension in the iterations
      // available. Measured: 97% stretch, a cord hanging at twice its length.
      //
      // Carrying it over undecayed used to ratchet (280 N under a 3.4 N load).
      // The −α̃λ term is what fixes that: at convergence it pulls λ back to the
      // compliant solution instead of letting it grow. Compliance replaces the
      // decay fudge rather than replacing the warm start.
      if (l.P !== 0) this.applyLink(l, l.P, false);
    }
  }

  applyLink(l, P, pseudo){
    const A = l.a, B2 = l.b;
    if (pseudo){
      A.pvel.addScaledVector(l.n, P * A.invMass);
      if (B2) B2.pvel.addScaledVector(l.n, -P * B2.invMass);
      if (l.anchored){
        _f.copy(l.n).multiplyScalar(P);
        _g.copy(l.wa).cross(_f); m3apply(_h, A.invI, _g); A.pavel.add(_h);
        if (B2){ _g.copy(l.wb).cross(_f); m3apply(_h, B2.invI, _g); B2.pavel.sub(_h); }
      }
    } else {
      A.vel.addScaledVector(l.n, P * A.invMass);
      if (B2) B2.vel.addScaledVector(l.n, -P * B2.invMass);
      if (l.anchored){
        _f.copy(l.n).multiplyScalar(P);
        _g.copy(l.wa).cross(_f); m3apply(_h, A.invI, _g); A.avel.add(_h);
        if (B2){ _g.copy(l.wb).cross(_f); m3apply(_h, B2.invI, _g); B2.avel.sub(_h); }
      }
    }
  }

  /** Separation speed along the link, at the anchor points. */
  linkRelVel(l, pseudo){
    const A = l.a, B2 = l.b;
    if (!l.anchored){
      _e.copy(pseudo ? A.pvel : A.vel);
      if (B2) _e.sub(pseudo ? B2.pvel : B2.vel);
      return -_e.dot(l.n);
    }
    _e.copy(pseudo ? A.pavel : A.avel).cross(l.wa).add(pseudo ? A.pvel : A.vel);
    if (B2){
      _f.copy(pseudo ? B2.pavel : B2.avel).cross(l.wb).add(pseudo ? B2.pvel : B2.vel);
      _e.sub(_f);
    }
    return -_e.dot(l.n);
  }

  /**
   * @param reverse walk the chain backwards this iteration.
   *
   * Alternating direction is the single biggest thing that makes a cord stiff.
   * Gauss-Seidel on a series chain propagates tension exactly one link per
   * sweep, so a forwards-only solver needs as many iterations as there are
   * links before the prize's weight is even felt at the anchor. Alternating
   * carries it the whole way in two.
   */
  solveLinks(dt, reverse){
    const L = this.links;
    for (let i = 0; i < L.length; i++){
      const l = L[reverse ? L.length - 1 - i : i];
      if (!l.k || l.slack || l.broken) continue;
      // separation speed along the link; positive means it is being stretched.
      // P is the magnitude of the pull applied to A toward the far end, so a
      // POSITIVE separation calls for a POSITIVE impulse.
      const vn = this.linkRelVel(l, false);
      // XPBD/soft-constraint step: the −α̃λ term is the regulariser.
      let dP = (vn - l.gamma * l.P) * l.k;
      const old = l.P;
      l.P = l.rope ? Math.max(0, old + dP) : old + dP;
      dP = l.P - old;
      if (dP !== 0) this.applyLink(l, dP, false);
      l.tension = l.P / dt;
    }
  }

  solveLinkPositions(reverse){
    const L = this.links;
    for (let i = 0; i < L.length; i++){
      const l = L[reverse ? L.length - 1 - i : i];
      if (!l.k || l.slack || l.broken || l.bias <= 0) continue;
      const vn = this.linkRelVel(l, true);
      let dP = (vn + l.bias) * l.k;
      const old = l.Pp;
      l.Pp = Math.max(0, old + dP);
      dP = l.Pp - old;
      if (dP !== 0) this.applyLink(l, dP, true);
    }
  }

  /* A hard position-projection pass (clamping every link to at most its rest
     length after integration) was written here and removed. It does make the
     cord inextensible, but it is blind to collisions: applied to a cord DRAPED
     over something, it straightens the cord and pulls it off. On the string-cut
     cabinet the cord came off its blade on the first substep. If a future
     machine needs a stiffer rope that is not resting on anything, it is four
     lines — but it cannot be turned on globally. */

  solveVelocity(){
    for (const c of this.contacts){
      const A = c.a, B2 = c.b;
      const rel = () => {
        A.pointVel(c.p, _e);
        if (B2){ B2.pointVel(c.p, _f); _e.sub(_f); }
        else if (c.col){ this.otherVel(c, _f); _e.sub(_f); }
      };
      rel();
      const vn = _e.dot(c.n);
      let dPn = (c.vTarget - vn) * c.kn;
      const oldPn = c.Pn;
      c.Pn = Math.max(0, c.Pn + dPn);
      dPn = c.Pn - oldPn;
      if (dPn !== 0){
        _a.copy(c.n).multiplyScalar(dPn);
        this.applyImpulse(c, _a, false);
        if (c.arm) c.arm.avel -= dPn * c.jaN * c.arm.invI;
        rel();
      }

      const maxF = c.mu * c.Pn;
      let dP1 = -_e.dot(c.t1) * c.kt1;
      const o1 = c.Pt1;
      c.Pt1 = Math.max(-maxF, Math.min(maxF, c.Pt1 + dP1));
      dP1 = c.Pt1 - o1;

      let dP2 = -_e.dot(c.t2) * c.kt2;
      const o2 = c.Pt2;
      c.Pt2 = Math.max(-maxF, Math.min(maxF, c.Pt2 + dP2));
      dP2 = c.Pt2 - o2;

      if (dP1 !== 0 || dP2 !== 0){
        _a.set(0,0,0).addScaledVector(c.t1, dP1).addScaledVector(c.t2, dP2);
        this.applyImpulse(c, _a, false);
        if (c.arm) c.arm.avel -= (dP1*c.jaT1 + dP2*c.jaT2) * c.arm.invI;
      }
    }
  }

  solvePosition(){
    for (const c of this.contacts){
      if (c.bias <= 0) continue;
      const A = c.a, B2 = c.b;
      _e.copy(A.pavel).cross(c.ra).add(A.pvel);
      if (B2){ _f.copy(B2.pavel).cross(c.rb).add(B2.pvel); _e.sub(_f); }
      const vn = _e.dot(c.n);
      let dP = (c.bias - vn) * c.kn;
      const old = c.Pp;
      c.Pp = Math.max(0, old + dP);
      dP = c.Pp - old;
      if (dP !== 0){
        _a.copy(c.n).multiplyScalar(dP);
        this.applyImpulse(c, _a, true);
      }
    }
  }

  /** One fixed step. Call `substep(dt)` from a fixed-timestep loop. */
  substep(dt){
    const cfg = this.cfg;
    for (const col of this.colliders) if (col.reaction) col.reaction.set(0, 0, 0);
    for (const A of this.bodies){
      if (!A.awake || A.dead) continue;
      /* Stillness is sampled HERE, before the gravity increment, and this
         ordering is the whole point of the flag.

         `buildContacts` needs to know whether a body is disturbing its
         neighbours, but by the time it runs, every awake body has just been
         handed 0.082 m/s of downward velocity that its contacts have not
         cancelled yet — four times the 0.02 m/s sleep threshold. Ask "is this
         body still?" there and the answer is always no, for a settled pile
         standing perfectly on the floor. Measured: the wake rule fired on
         every single awake/asleep pair, and the fix that depended on it did
         nothing at all.

         Sampled before gravity, `quiet` is exactly the value the integrator
         computed at the end of the previous substep — nothing else touches
         `vel` in between — so the waking rule and the sleep timer agree. */
      A.quiet = this.still(A);
      A.vel.y += cfg.gravity * dt;
      A.vel.multiplyScalar(Math.max(0, 1 - A.linDamp * dt));
      A.avel.multiplyScalar(Math.max(0, 1 - A.angDamp * dt));
      A.pvel.set(0,0,0); A.pavel.set(0,0,0);
    }
    for (const A of this.bodies) A.updateTransform();

    this.buildContacts();
    this.prepare(dt);
    this.prepareLinks(dt);
    // Links are solved INSIDE the contact iteration, not after it. A cord is a
    // series chain: solved as a separate pass, tension propagates one link per
    // outer iteration and a hanging prize sags and bounces visibly.
    // NB: alternating the sweep direction (passing `i & 1`) is textbook for a
    // series chain and measurably improves shock recovery — but the string-cut
    // cabinet, the only consumer of links, measured WORSE with it on (8 wins in
    // 18 vs 12). Left forward-only until there is budget to find out why.
    for (let i = 0; i < cfg.velIters; i++){ this.solveVelocity(); this.solveLinks(dt); }
    // NB: extra link-only position sweeps after this loop were tried and are a
    // trap — the same one `projectLinks` fell into. Link correction with no
    // contact pass interleaved is blind to what the cord is resting on, so it
    // straightens the cord and drags it off its support. Link position
    // correction must always be interleaved with the contact pass, never run
    // unopposed.
    for (let i = 0; i < cfg.posIters; i++){ this.solvePosition(); this.solveLinkPositions(); }

    for (const A of this.bodies){
      if (!A.awake || A.dead) continue;
      _a.copy(A.vel).add(A.pvel);
      A.pos.addScaledVector(_a, dt);
      _b.copy(A.avel).add(A.pavel);
      const q = A.quat;
      const dq = new THREE.Quaternion(_b.x*dt*0.5, _b.y*dt*0.5, _b.z*dt*0.5, 0).multiply(q);
      q.set(q.x+dq.x, q.y+dq.y, q.z+dq.z, q.w+dq.w).normalize();


      A.sleepT = this.still(A) ? A.sleepT + dt : 0;
      if (A.sleepT > cfg.sleepTime){
        A.awake = false; A.sleepT = 0;
        A.vel.set(0,0,0); A.avel.set(0,0,0);
      }
    }

    this.prevCache.clear();
    for (const c of this.contacts){
      this.prevCache.set(c.key, { Pn:c.Pn, Pt1:c.Pt1, Pt2:c.Pt2 });
    }
  }

  /**
   * Advance by wall-clock `dt`, running whole fixed substeps.
   * `onStep(h)` runs before each substep — machines drive their mechanisms
   * there so contacts always see an up-to-date kinematic pose.
   */
  step(dt, onStep){
    const h = this.cfg.fixedDt;
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= h && n < this.cfg.maxSubsteps){
      if (onStep) onStep(h);
      this.substep(h);
      this.acc -= h;
      n++;
    }
    if (n === this.cfg.maxSubsteps) this.acc = 0;
    return n;
  }
}

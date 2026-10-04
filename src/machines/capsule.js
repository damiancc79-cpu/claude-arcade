/* ============================================================================
   machines/capsule.js — ガチャガチャ, standard 65 mm commercial single-window
   unit (~50 cm tall, ~27 cm wide): the format that fills a Japanese capsule
   corner.

   MECHANISM — simulated, not animated.

     globe ──► funnel ──► rotating drum with ONE cup ──► chute ──► tray

   The globe holds a physical pile of 65 mm capsules. Its floor tapers into a
   funnel whose opening is narrower than two capsules, so they queue single
   file. Below sits a drum rotating on a front-to-back axis, driven directly by
   the crank the player turns. One cup is machined into the drum: at rest it
   faces up under the funnel and is already loaded. Turning the crank carries
   that capsule round — it stays put while the cup is on its side, because
   gravity is then perpendicular to the cup axis, exactly as in the real thing
   — and only falls free once the cup rotates past horizontal and gravity gains
   a component along the cup's axis. It lands in the chute, rolls to the
   delivery tray, and the next capsule drops in as the cup comes back up.

   All of that is contact physics. There is no scripted dispense and nothing is
   ever teleported out of the globe.

   The machine owns its physics world in LOCAL space, so it works wherever it
   is mounted. Model contract: base on y = 0, front facing +Z, centred in X/Z.
============================================================================ */
import * as THREE from 'three';
import {
  World, Body, Collider, BoxCollider, PlaneCollider,
  SphereShellCollider, FunnelCollider,
} from '../physics.js';

const V3 = THREE.Vector3;
const _v = new V3(), _w = new V3();

/* ------------------------------------------------------------ dimensions -- */
export const SPEC = {
  capsuleR : 0.0325,          // 65 mm capsule — the standard commercial size
  width    : 0.30,
  depth    : 0.34,
  height   : 0.62,

  // The hopper has to be big: a 65 mm capsule is a quarter of the machine's
  // width, so a small globe simply cannot hold a believable load.
  globeC   : [0, 0.480, 0],
  globeR   : 0.132,

  // Cone from the globe's shoulder down to a snug throat. Two numbers matter:
  // the throat must be too narrow for two capsules abreast (they queue single
  // file), and it must end at the height the lowest capsule actually rests —
  // sitting on the drum's crown. A throat that is still wide there lets the
  // capsule perch on the cone wall beside the cup and never drop in.
  // Wall angle matters as much as the throat: shallow cones bridge. At ~19deg
  // from vertical this is in mass-flow territory for slick plastic shells.
  funnel   : { yTop: 0.559, rTop: 0.106, yBot: 0.334, rBot: 0.040 },

  // Drum axis runs front-to-back so the crank drives it directly. The drum is
  // deliberately much larger than a capsule for two reasons: the cup can then
  // be deep enough to swallow one flush (so it clears the funnel rim as it
  // sweeps past), and the drum's top surface sits AT the throat, meaning the
  // pile always rests on moving metal. Without that the capsules bridge —
  // three of them arch across the neck and the machine jams solid.
  // It also has to sit high enough that a released capsule lands clear of the
  // drum's own sweep (radius R + capsule). Mount it too low and the cup simply
  // scoops the capsule straight back up on the next pass.
  drum     : { y: 0.215, z: 0, R: 0.085, halfLen: 0.050,
               cupR: 0.038, cupDepth: 0.068,
               // Raised lip riding a quarter-turn ahead of the cup. Real rotors
               // carry one: it stirs the base of the capsule column each pass,
               // which is what stops the pile arching across the throat.
               agitR: 0.015, agitLift: 0.004, agitPhase: Math.PI/2 },

  trayY    : 0.032,
  frontZ   : 0.170,
};

const CAPSULE_COLORS = [
  0xff5c8a, 0xffd166, 0x7ce38b, 0x6ec3ff, 0xc792ea,
  0xff9f6e, 0x5fe1c0, 0xff7ad9, 0xff4f4f, 0x9be36f,
];

export const PRIZE_TYPES = [
  { key:'figure',   jp:'ミニフィギュア',   en:'MINI FIGURE'  },
  { key:'keychain', jp:'キーホルダー',     en:'KEYCHAIN'     },
  { key:'plush',    jp:'ぬいぐるみ',       en:'MINI PLUSH'   },
  { key:'charm',    jp:'ラバーストラップ', en:'RUBBER CHARM' },
];

/* ====================================================== drum collider ===== */
/**
 * Solid cylinder on a front-to-back (Z) axis with one cylindrical cup cut into
 * its surface. Kinematic: it rotates with the crank and drags the capsule
 * round by contact, so when the capsule leaves is decided by gravity and
 * geometry, not by a timer.
 */
class DrumCollider extends Collider {
  constructor(spec, opts){
    super(opts);
    this.cy = spec.y; this.cz = spec.z;
    this.R = spec.R; this.halfLen = spec.halfLen;
    this.cupR = spec.cupR; this.cupDepth = spec.cupDepth;
    this.agitR = spec.agitR ?? 0; this.agitLift = spec.agitLift ?? 0;
    this.agitPhase = spec.agitPhase ?? 0;
    this.agit = new V3();
    this.angle = 0;
    this.omega = 0;
    this.kinematic = true;
    this.dir = new V3(0, 1, 0);        // cup axis, pointing out of the drum
    this.bottom = new V3();            // centre of the cup floor
    this.refresh();
  }

  /** Cup pose for the current angle. angle 0 = cup facing straight up. */
  refresh(){
    const s = Math.sin(this.angle), c = Math.cos(this.angle);
    this.dir.set(-s, c, 0);                        // rotation about +Z
    const bd = this.R - this.cupDepth;
    this.bottom.set(this.dir.x * bd, this.cy + this.dir.y * bd, this.cz);
    if (this.agitR > 0){
      const a = this.angle + this.agitPhase;
      const ad = this.R + this.agitLift;
      this.agit.set(-Math.sin(a) * ad, this.cy + Math.cos(a) * ad, this.cz);
    }
  }

  collide(p, r, out){
    // --- cup-local coordinates -------------------------------------------
    _v.copy(p).sub(this.bottom);
    const u = _v.dot(this.dir);                        // along the cup axis
    _w.copy(_v).addScaledVector(this.dir, -u);         // radial offset
    const wl = _w.length();

    // Only "in the cup" while still inside the bore. Past the mouth it is free,
    // which is what lets gravity tip it out once the cup passes horizontal.
    if (u > -r && u < this.cupDepth && wl < this.cupR + r){
      if (wl + r > this.cupR && wl > 1e-9){            // bore wall, pushing inward
        out.push({ nx:-_w.x/wl, ny:-_w.y/wl, nz:-_w.z/wl,
                   depth: wl + r - this.cupR, px:p.x, py:p.y, pz:p.z });
      }
      if (u < r){                                      // cup floor
        out.push({ nx:this.dir.x, ny:this.dir.y, nz:this.dir.z, depth: r - u,
                   px:p.x - this.dir.x*r, py:p.y - this.dir.y*r, pz:p.z - this.dir.z*r });
      }
      return;
    }

    // --- agitator lip ----------------------------------------------------
    if (this.agitR > 0){
      const ax = p.x - this.agit.x, ay = p.y - this.agit.y, az = p.z - this.agit.z;
      const ad = Math.hypot(ax, ay, az), sum = this.agitR + r;
      if (ad < sum && ad > 1e-9){
        out.push({ nx:ax/ad, ny:ay/ad, nz:az/ad, depth: sum - ad,
                   px:this.agit.x + (ax/ad)*this.agitR,
                   py:this.agit.y + (ay/ad)*this.agitR,
                   pz:this.agit.z + (az/ad)*this.agitR });
      }
    }

    // --- drum outer surface ----------------------------------------------
    if (Math.abs(p.z - this.cz) > this.halfLen + r) return;
    // never seal the cup's mouth, or nothing could drop in
    if (u > 0 && wl < this.cupR) return;

    const dx = p.x, dy = p.y - this.cy;
    const d = Math.hypot(dx, dy);
    if (d >= this.R + r || d < 1e-9) return;
    out.push({ nx:dx/d, ny:dy/d, nz:0, depth: this.R + r - d,
               px:(dx/d)*this.R, py:this.cy + (dy/d)*this.R, pz:p.z });
  }

  pointVel(p, out){
    // ω about +Z:  v = ω ẑ × r = ω(−dy, dx, 0)
    out.set(-this.omega * (p.y - this.cy), this.omega * p.x, 0);
  }
}

/* ================================================== procedural textures === */
const JP_FONT = `'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif`;

function labelTexture(seed){
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const pal = ['#ff5c8a','#ffd166','#7ce38b','#6ec3ff','#c792ea','#ff9f6e'][seed % 6];
  g.fillStyle = '#fdfbf4'; g.fillRect(0,0,W,H);

  // sunburst behind the product art
  g.save(); g.translate(W*0.34, H*0.52);
  for (let i = 0; i < 18; i++){
    g.rotate(Math.PI*2/18);
    g.fillStyle = i % 2 ? pal : '#ffffff';
    g.globalAlpha = .30;
    g.beginPath(); g.moveTo(0,0); g.lineTo(420,-26); g.lineTo(420,26); g.fill();
  }
  g.restore(); g.globalAlpha = 1;

  // capsule graphic
  const cx = W*0.34, cy = H*0.52, cr = 62;
  g.fillStyle = pal;    g.beginPath(); g.arc(cx, cy, cr, Math.PI, 0); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, cr, 0, Math.PI); g.fill();
  g.strokeStyle = '#2a1a30'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, cr, 0, 7); g.stroke();

  // headline + price block on the right
  g.fillStyle = pal; g.fillRect(W*0.60, 0, W*0.40, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 34px ${JP_FONT}`; g.fillStyle = '#2a1a30';
  const name = PRIZE_TYPES[seed % PRIZE_TYPES.length].jp;
  g.fillText(name.slice(0, 5), W*0.80, H*0.24);
  if (name.length > 5) g.fillText(name.slice(5), W*0.80, H*0.42);
  g.fillStyle = '#151228'; g.fillRect(W*0.60, H*0.58, W*0.40, H*0.42);
  g.font = 'bold 62px ui-monospace, monospace'; g.fillStyle = '#ffd166';
  g.fillText('¥100', W*0.80, H*0.80);
  g.strokeStyle = '#2a1a30'; g.lineWidth = 10; g.strokeRect(5, 5, W-10, H-10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ========================================================= prize models === */
const S = 0.012;      // prizes are tiny — they have to live inside a 65 mm shell

function buildPrize(type, color){
  const g = new THREE.Group();
  const mat   = new THREE.MeshStandardMaterial({ color, roughness:.55, metalness:.05 });
  const dark  = new THREE.MeshStandardMaterial({ color:0x241f30, roughness:.4 });
  const light = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), .6), roughness:.6 });
  const metal = new THREE.MeshStandardMaterial({ color:0xd8dcea, roughness:.25, metalness:.9 });
  const at = (geo, m, x, y, z, rx = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z); o.rotation.x = rx;
    g.add(o); return o;
  };

  if (type === 'figure'){
    at(new THREE.CapsuleGeometry(S*0.9, S*1.1, 4, 10), mat, 0, S*1.1, 0);
    at(new THREE.SphereGeometry(S*1.15, 14, 10), mat, 0, S*2.6, 0);
    for (const sx of [-1,1]) at(new THREE.SphereGeometry(S*0.22, 8, 6), dark, sx*S*0.45, S*2.7, S*1.0);
    for (const sx of [-1,1]) at(new THREE.SphereGeometry(S*0.42, 8, 6), mat, sx*S*1.15, S*1.2, 0);
    for (const sx of [-1,1]) at(new THREE.SphereGeometry(S*0.45, 8, 6), light, sx*S*0.5, S*0.15, 0);
  } else if (type === 'keychain'){
    at(new THREE.TorusGeometry(S*0.7, S*0.13, 8, 16), metal, 0, S*2.7, 0);
    at(new THREE.BoxGeometry(S*1.9, S*2.2, S*0.5), mat, 0, S*1.2, 0);
    at(new THREE.SphereGeometry(S*0.6, 10, 8), light, 0, S*1.5, S*0.3);
    for (const sx of [-1,1]) at(new THREE.SphereGeometry(S*0.16, 6, 5), dark, sx*S*0.28, S*1.6, S*0.6);
  } else if (type === 'plush'){
    at(new THREE.SphereGeometry(S*1.5, 14, 10), mat, 0, S*1.5, 0);
    for (const sx of [-1,1]) at(new THREE.SphereGeometry(S*0.55, 8, 6), mat, sx*S*1.0, S*2.6, 0);
    for (const sx of [-1,1]) at(new THREE.SphereGeometry(S*0.2, 6, 5), dark, sx*S*0.45, S*1.7, S*1.25);
    at(new THREE.SphereGeometry(S*0.35, 8, 6), light, 0, S*1.35, S*1.4);
  } else {                                                     // rubber charm
    at(new THREE.CylinderGeometry(S*1.4, S*1.4, S*0.35, 18), mat, 0, S*1.4, 0, Math.PI/2);
    at(new THREE.TorusGeometry(S*0.4, S*0.1, 6, 12), metal, 0, S*3.0, 0);
    for (const sx of [-1,1]) at(new THREE.SphereGeometry(S*0.18, 6, 5), dark, sx*S*0.45, S*1.6, S*0.2);
    at(new THREE.SphereGeometry(S*0.3, 8, 6), light, 0, S*1.0, S*0.22);
  }
  return g;
}

/* ============================================================== machine === */
export class CapsuleMachine {
  /**
   * @param opts.capsules  how many to load into the globe (default 22)
   * @param opts.seed      picks the label art / product theme
   */
  constructor(opts = {}){
    this.opts = { capsules: 18, seed: 0, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'capsule-machine';

    this.world = new World({ gravity: -9.81, velIters: 8, posIters: 3 });
    this.capsules = [];
    this.picks = [];              // meshes the host page can raycast against

    // --- mechanism state ---
    this.credit       = 0;
    this.crank        = 0;        // progress through the current turn, 0..2π
    this.crankLocked  = true;     // no coin, no turn
    this.crankVel     = 0;        // rad/s from a held key
    this.crankPending = 0;        // rad queued from a mouse drag
    this.drumAngle    = 0;        // continuous — never reset, or the drum snaps
    this.turnsCompleted = 0;

    this.trayCapsules = [];
    this.collected    = [];
    this.flapOpen = 0;
    this.flapTarget = 0;
    this.onDispense = null;
    this.onCollect  = null;

    this._buildVisuals();
    this._buildColliders();
    this._loadCapsules(this.opts.capsules);
  }

  get object3D(){ return this.root; }
  get capsulesLeft(){ return this.capsules.filter(c => !c.taken && !c.inTray).length; }
  get inTray(){ return this.trayCapsules.length; }

  /* ------------------------------------------------------------ physics -- */
  _buildColliders(){
    const W = this.world;
    const plastic = { friction: 0.22, restitution: 0.30 };   // capsules are slick and bouncy
    const metal   = { friction: 0.16, restitution: 0.22 };

    // hopper
    // The globe opens into the funnel throat at the funnel's top edge, where
    // the two radii match, so capsules pass between them seamlessly.
    this.globe  = W.addCollider(new SphereShellCollider(SPEC.globeC, SPEC.globeR,
                    { ...plastic, yMin: SPEC.funnel.yTop }));
    this.funnel = W.addCollider(new FunnelCollider(SPEC.funnel, plastic));

    // mechanism
    this.drum = W.addCollider(new DrumCollider(SPEC.drum, metal));

    // Mechanism well — side and back walls so a capsule leaving the cup can
    // only go down into the chute. Kept clear of the drum's swept radius.
    for (const sx of [-1, 1]){
      W.addCollider(new BoxCollider([sx*0.102, 0.175, 0.005], [0.008, 0.135, 0.105], null, plastic));
    }
    W.addCollider(new BoxCollider([0, 0.175, -0.105], [0.102, 0.135, 0.008], null, plastic));

    // Chute: floor tilted so the front edge is lower, running the capsule
    // forward out of the mechanism well and into the tray.
    // It must clear the cup's swept path — a capsule riding upside-down in the
    // cup reaches y ≈ 0.104, so a chute any higher becomes a shelf the capsule
    // rests on and it rides all the way back round instead of dropping.
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, 0, 0));
    W.addCollider(new BoxCollider([0, 0.048, 0.006], [0.072, 0.008, 0.080], tilt, plastic));

    // Tray: floor, sides, and the flap face.
    W.addCollider(new BoxCollider([0, SPEC.trayY - 0.008, 0.110], [0.064, 0.008, 0.052], null, plastic));
    for (const sx of [-1, 1]){
      W.addCollider(new BoxCollider([sx*0.072, SPEC.trayY + 0.036, 0.110],
                                    [0.008, 0.040, 0.050], null, plastic));
    }
    this.flapCollider = W.addCollider(
      new BoxCollider([0, SPEC.trayY + 0.036, 0.158], [0.064, 0.040, 0.007], null, plastic));

    // backstop so nothing can ever fall out of the world
    W.addCollider(new PlaneCollider([0,1,0], 0.0, { friction:.4 }));
  }

  _loadCapsules(n){
    // Seed positions that are already legal for BOTH containers. Dropping a
    // capsule inside the funnel wall makes the position solver eject it at
    // speed, which flushes several through the mechanism on the first turn.
    const f = SPEC.funnel, R = SPEC.capsuleR, cy = SPEC.globeC[1];
    const slope = (f.rTop - f.rBot) / (f.yTop - f.yBot);
    const len = Math.hypot(1, slope);
    const allowed = (y) => {
      const dy = y - cy;
      const sq = (SPEC.globeR - R) ** 2 - dy * dy;
      const sphere = sq > 0 ? Math.sqrt(sq) : 0;
      const wallR = f.rBot + Math.max(0, Math.min(y, f.yTop) - f.yBot) * slope;
      const cone = y <= f.yTop ? wallR - R * len : Infinity;
      return Math.max(0, Math.min(sphere, cone));
    };

    const yLo = f.yBot + R * 2.2, yHi = cy + (SPEC.globeR - R) * 0.92;
    const placed = [];
    const D = R * 2.05;
    for (let i = 0; i < n; i++){
      let px = 0, py = yLo, pz = 0;
      for (let t = 0; t < 200; t++){
        const y = yLo + Math.random() * (yHi - yLo);
        const rad = allowed(y) * Math.sqrt(Math.random());
        const th = Math.random() * Math.PI * 2;
        px = Math.cos(th) * rad; pz = Math.sin(th) * rad; py = y;
        let ok = true;
        for (const q of placed){
          if ((px-q[0])**2 + (py-q[1])**2 + (pz-q[2])**2 < D*D){ ok = false; break; }
        }
        if (ok) break;
      }
      placed.push([px, py, pz]);
      const b = this._makeCapsule();
      b.setPos(px, py, pz);
      this.world.add(b);
      this.capsules.push(b);
    }
    // settle the pile before the player ever sees it
    for (let i = 0; i < 480; i++) this.world.substep(this.world.cfg.fixedDt);
    for (const b of this.capsules) b.syncMesh();
  }

  _makeCapsule(){
    const R = SPEC.capsuleR;
    // A real capsule plus trinket is ~14 g in a 65 mm shell.
    const body = new Body([{ o:[0,0,0], r:R }], {
      density: 96, friction: 0.14, restitution: 0.34, linDamp: 0.14, angDamp: 0.8,
    });
    const idx = Math.floor(Math.random() * CAPSULE_COLORS.length);
    const color = CAPSULE_COLORS[idx];
    const prizeColor = CAPSULE_COLORS[(idx + 3) % CAPSULE_COLORS.length];
    const prize = PRIZE_TYPES[Math.floor(Math.random() * PRIZE_TYPES.length)];

    const g = new THREE.Group();
    // classic two-part shell: opaque coloured top, tinted clear bottom
    g.add(new THREE.Mesh(
      new THREE.SphereGeometry(R, 20, 12, 0, Math.PI*2, 0, Math.PI/2),
      new THREE.MeshStandardMaterial({ color, roughness:.28, metalness:.02 })));
    g.add(new THREE.Mesh(
      new THREE.SphereGeometry(R, 20, 12, 0, Math.PI*2, Math.PI/2, Math.PI/2),
      new THREE.MeshPhysicalMaterial({
        color:0xffffff, roughness:.06, metalness:0, transparent:true,
        opacity:.30, side:THREE.DoubleSide, depthWrite:false })));
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(R*0.99, R*0.05, 6, 22),
      new THREE.MeshStandardMaterial({ color, roughness:.4 }));
    seam.rotation.x = Math.PI/2;
    g.add(seam);

    const inner = buildPrize(prize.key, prizeColor);
    inner.position.y = -R * 0.55;
    inner.scale.setScalar(0.85);
    g.add(inner);

    body.mesh = g;
    body.tag = 'capsule';
    body.prize = prize;
    body.prizeColor = prizeColor;
    body.shellColor = color;
    body.taken = false;
    body.inTray = false;
    g.userData.pick = 'capsule';
    g.userData.body = body;
    this.capsuleLayer.add(g);
    return body;
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const root = this.root;
    this.capsuleLayer = new THREE.Group();
    root.add(this.capsuleLayer);

    const shell  = new THREE.MeshStandardMaterial({ color:0xf2f4fa, roughness:.42, metalness:.12 });
    const dark   = new THREE.MeshStandardMaterial({ color:0x24243f, roughness:.5, metalness:.4 });
    const chrome = new THREE.MeshStandardMaterial({ color:0xc8d0e2, roughness:.22, metalness:.95 });
    const clear  = new THREE.MeshPhysicalMaterial({
      color:0xe8f4ff, roughness:.04, metalness:0, transparent:true, opacity:.16,
      side:THREE.DoubleSide, depthWrite:false });
    const milky  = new THREE.MeshPhysicalMaterial({
      color:0xdfe6f2, roughness:.35, metalness:0, transparent:true, opacity:.20,
      side:THREE.DoubleSide, depthWrite:false });

    const box = (w,h,d,m,x,y,z,parent=root) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);
      o.position.set(x,y,z); parent.add(o); return o;
    };

    // --- cabinet ----------------------------------------------------------
    // Lower body is built as a frame, not a solid block, so the delivery
    // chamber is a real opening in the front rather than a void buried inside.
    const W = SPEC.width, D = SPEC.depth, OP = 0.078;      // opening half-width
    box(W, 0.030, D, shell, 0, 0.015, 0);                                  // floor slab
    for (const sx of [-1, 1]){
      box(W/2 - OP, 0.120, D, shell, sx*(OP + (W/2 - OP)/2), 0.090, 0);    // side columns
    }
    box(W, 0.020, D, shell, 0, 0.140, 0);                                  // lintel
    box(W, 0.110, D/2 - 0.060, shell, 0, 0.085, -(D/4 + 0.030));           // rear wall
    box(W + 0.008, 0.014, D + 0.008, dark, 0, 0.007, 0);                   // foot

    box(W, 0.198, D, shell, 0, 0.249, 0);                                  // console
    box(W + 0.006, 0.010, D + 0.006, dark, 0, 0.150, 0);                   // waist trim
    box(W + 0.010, 0.016, D + 0.010, dark, 0, 0.350, 0);                   // globe collar

    // --- globe ------------------------------------------------------------
    const globe = new THREE.Mesh(new THREE.SphereGeometry(SPEC.globeR, 30, 20), clear);
    globe.position.set(...SPEC.globeC);
    root.add(globe);
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(SPEC.globeR*0.30, SPEC.globeR*0.34, 0.020, 18), dark);
    lid.position.set(0, SPEC.globeC[1] + SPEC.globeR - 0.006, 0);
    root.add(lid);

    // --- funnel -----------------------------------------------------------
    const f = SPEC.funnel;
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(f.rTop, f.rBot, f.yTop - f.yBot, 26, 1, true), milky);
    funnel.position.set(0, (f.yTop + f.yBot)/2, 0);
    root.add(funnel);

    // --- drum + cup -------------------------------------------------------
    const d = SPEC.drum;
    this.drumMesh = new THREE.Group();
    this.drumMesh.position.set(0, d.y, d.z);
    root.add(this.drumMesh);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(d.R, d.R, d.halfLen*2, 26),
      new THREE.MeshStandardMaterial({ color:0x3c4160, roughness:.35, metalness:.65 }));
    barrel.rotation.x = Math.PI/2;
    this.drumMesh.add(barrel);
    // cup recessed into the barrel so it reads as a bore
    const cup = new THREE.Group();
    cup.position.set(0, d.R - d.cupDepth, 0);
    const bore = new THREE.Mesh(
      new THREE.CylinderGeometry(d.cupR, d.cupR, d.cupDepth, 20, 1, true),
      new THREE.MeshStandardMaterial({ color:0x14162a, roughness:.7, side:THREE.BackSide }));
    bore.position.y = d.cupDepth/2;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(d.cupR, 20),
      new THREE.MeshStandardMaterial({ color:0x1b1e36, roughness:.6 }));
    floor.rotation.x = -Math.PI/2;
    cup.add(bore, floor);
    this.drumMesh.add(cup);

    // --- front console ----------------------------------------------------
    const fz = SPEC.frontZ;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.176, 0.088),                 // 2:1, matching the art
      new THREE.MeshStandardMaterial({ map: labelTexture(this.opts.seed), roughness:.65 }));
    label.position.set(0, 0.298, fz + 0.002);
    root.add(label);
    box(0.196, 0.108, 0.006, dark, 0, 0.298, fz - 0.002);    // card bezel

    // crank knob — coaxial with the drum, because it drives it directly
    this.knob = new THREE.Group();
    this.knob.position.set(0, SPEC.drum.y, fz + 0.006);
    root.add(this.knob);
    const knobBody = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.022, 22), chrome);
    knobBody.rotation.x = Math.PI/2;
    const knobFace = new THREE.Mesh(new THREE.CircleGeometry(0.026, 22),
      new THREE.MeshStandardMaterial({ color:0x2b2f4d, roughness:.45, metalness:.3 }));
    knobFace.position.z = 0.012;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.012, 0.014),
      new THREE.MeshStandardMaterial({ color:0xff3d6e, roughness:.35, metalness:.2 }));
    handle.position.z = 0.018;
    this.knob.add(knobBody, knobFace, handle);
    for (const m of [knobBody, knobFace, handle]){ m.userData.pick = 'knob'; this.picks.push(m); }

    const arrow = new THREE.Mesh(
      new THREE.RingGeometry(0.035, 0.041, 22, 1, 0, Math.PI*1.35),
      new THREE.MeshStandardMaterial({ color:0xffd166, emissive:0xffd166,
        emissiveIntensity:.8, side:THREE.DoubleSide }));
    arrow.position.set(0, SPEC.drum.y, fz + 0.001);
    root.add(arrow);

    // coin mech
    const coinPlate = box(0.052, 0.062, 0.012, dark, -0.090, SPEC.drum.y, fz - 0.002);
    const slot = box(0.006, 0.030, 0.006,
      new THREE.MeshStandardMaterial({ color:0x0a0b14, roughness:.9 }),
      -0.090, SPEC.drum.y + 0.008, fz + 0.006);
    for (const m of [coinPlate, slot]){ m.userData.pick = 'coin'; this.picks.push(m); }
    this.coinLamp = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12),
      new THREE.MeshStandardMaterial({ color:0x220a12, emissive:0xff2f6e, emissiveIntensity:0 }));
    this.coinLamp.position.set(-0.090, SPEC.drum.y - 0.026, fz + 0.007);
    root.add(this.coinLamp);

    // --- delivery door ----------------------------------------------------
    this.flap = new THREE.Group();
    this.flap.position.set(0, SPEC.trayY + 0.082, 0.166);
    root.add(this.flap);
    const flapPane = new THREE.Mesh(new THREE.BoxGeometry(0.128, 0.074, 0.006), clear);
    flapPane.position.y = -0.037;
    const flapFrame = new THREE.Mesh(new THREE.BoxGeometry(0.136, 0.010, 0.011), dark);
    flapFrame.position.y = -0.076;
    this.flap.add(flapPane, flapFrame);
    for (const m of [flapPane, flapFrame]){ m.userData.pick = 'flap'; this.picks.push(m); }

    // tray recess
    box(0.144, 0.006, 0.104, dark, 0, SPEC.trayY - 0.014, 0.110);
    for (const sx of [-1,1]) box(0.008, 0.080, 0.104, dark, sx*0.072, SPEC.trayY + 0.036, 0.110);
    box(0.144, 0.080, 0.006, dark, 0, SPEC.trayY + 0.036, 0.058);

    const price = new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.032),
      new THREE.MeshStandardMaterial({ color:0xffd166, emissive:0xffd166, emissiveIntensity:.5 }));
    price.position.set(0, 0.372, fz - 0.003);
    root.add(price);
  }

  /* ------------------------------------------------------- interactions -- */
  /** The mech holds one play at a time, like the real coin unit. */
  insertCoin(){
    if (this.credit >= 1) return false;
    this.credit = 1;
    this.crankLocked = false;
    this.crank = 0;
    return true;
  }

  /** Queue crank rotation from a mouse drag (radians, forward only). */
  crankBy(delta){ if (delta > 0) this.crankPending += delta; }

  /** Hold-to-turn, in rad/s. */
  setCrankVelocity(v){ this.crankVel = Math.max(0, v); }

  /** Internal: advance the ratchet, returning how far it actually moved. */
  _advanceCrank(delta){
    if (this.crankLocked || delta <= 0) return 0;
    const before = this.crank;
    this.crank = Math.min(Math.PI*2, this.crank + delta);
    const moved = this.crank - before;
    if (this.crank >= Math.PI*2 - 1e-6){
      // one full turn consumes the coin and the ratchet re-locks
      this.credit = 0;
      this.crankLocked = true;
      this.crank = 0;
      this.crankPending = 0;
      this.turnsCompleted++;
    }
    return moved;
  }

  toggleFlap(){ this.flapTarget = this.flapTarget > 0.5 ? 0 : 1; }

  /** Take a capsule from the tray. Returns the prize, or null. */
  collect(){
    if (!this.trayCapsules.length || this.flapOpen < 0.5) return null;
    const b = this.trayCapsules.shift();
    b.taken = true;
    this.world.remove(b);
    this.capsuleLayer.remove(b.mesh);
    const prize = { ...b.prize, color:b.prizeColor, shell:b.shellColor };
    this.collected.push(prize);
    if (this.onCollect) this.onCollect(prize);
    return prize;
  }

  refill(n = this.opts.capsules){
    for (const b of this.capsules){
      if (!b.taken){ this.world.remove(b); this.capsuleLayer.remove(b.mesh); }
    }
    this.capsules.length = 0;
    this.trayCapsules.length = 0;
    this._loadCapsules(n);
  }

  /* ------------------------------------------------------------- update -- */
  update(dt){
    // Drive the mechanism from inside the fixed-step loop so contacts always
    // see an up-to-date drum pose and a matching angular velocity.
    this.world.step(dt, h => {
      let adv = this.crankVel * h;
      if (this.crankPending > 0){
        const take = Math.min(this.crankPending, 14 * h);   // cap the drag rate
        adv += take;
        this.crankPending -= take;
      }
      const moved = this._advanceCrank(adv);
      this.drum.omega = moved / h;
      this.drumAngle += moved;          // continuous: never reset with the ratchet
      this.drum.angle = this.drumAngle;
      this.drum.refresh();
    });

    this.drumMesh.rotation.z = this.drumAngle;
    this.knob.rotation.z = -this.drumAngle;      // reads as clockwise from the front

    // flap, with its collider following so a capsule can't slip past a closing door
    this.flapOpen += (this.flapTarget - this.flapOpen) * Math.min(1, dt * 9);
    this.flap.rotation.x = -this.flapOpen * 1.15;
    this.flapCollider.enabled = this.flapOpen < 0.35;

    this.coinLamp.material.emissiveIntensity = this.credit > 0
      ? 1.6 + Math.sin(performance.now() * 0.006) * 0.6 : 0;

    for (const b of this.capsules){
      if (b.taken) continue;
      if (!b.inTray && b.pos.z > 0.070 && b.pos.y < SPEC.trayY + 0.060){
        b.inTray = true;
        this.trayCapsules.push(b);
        if (this.onDispense) this.onDispense(b);
      }
      b.syncMesh();
    }
    if (this.debug) this.updateDebug();
  }

  /* --------------------------------------------------------------- debug -- */
  /** Wireframes for every collider — invaluable when tuning the mechanism. */
  buildDebug(){
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color:0x00ff9d, wireframe:true,
      transparent:true, opacity:.4, depthTest:false });
    const cupMat = new THREE.MeshBasicMaterial({ color:0xff3d8b, wireframe:true,
      transparent:true, opacity:.85, depthTest:false });

    const globe = new THREE.Mesh(new THREE.SphereGeometry(SPEC.globeR, 18, 12), mat);
    globe.position.set(...SPEC.globeC); g.add(globe);
    const f = SPEC.funnel;
    const fn = new THREE.Mesh(
      new THREE.CylinderGeometry(f.rTop, f.rBot, f.yTop - f.yBot, 20, 1, true), mat);
    fn.position.set(0, (f.yTop + f.yBot)/2, 0); g.add(fn);
    const d = SPEC.drum;
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(d.R, d.R, d.halfLen*2, 20, 1, true), mat);
    barrel.rotation.x = Math.PI/2;
    barrel.position.set(0, d.y, d.z); g.add(barrel);

    for (const c of this.world.colliders){
      if (c instanceof BoxCollider){
        const m = new THREE.Mesh(new THREE.BoxGeometry(c.h.x*2, c.h.y*2, c.h.z*2), mat);
        m.position.copy(c.c); m.quaternion.copy(c.q); g.add(m);
      }
    }
    this._debugCup = new THREE.Mesh(
      new THREE.CylinderGeometry(d.cupR, d.cupR, d.cupDepth, 14, 1, true), cupMat);
    g.add(this._debugCup);
    g.renderOrder = 999;
    this.debug = g;
    this.root.add(g);
    return g;
  }

  updateDebug(){
    if (!this._debugCup) return;
    const d = SPEC.drum, dr = this.drum;
    this._debugCup.position.set(
      dr.bottom.x + dr.dir.x * d.cupDepth/2,
      dr.bottom.y + dr.dir.y * d.cupDepth/2,
      dr.bottom.z + dr.dir.z * d.cupDepth/2);
    this._debugCup.quaternion.setFromUnitVectors(new V3(0,1,0), dr.dir);
  }
}

/* ============================================================================
   machines/clawrig.js — the crane assembly shared by every UFO catcher:
   gantry, cable, head, prongs, and the two-button play cycle.

   Extracted from the two-prong build so 橋渡し, 三本爪 and the big-prize
   cabinets differ only in their cabinet, playfield and prizes — not in how the
   claw itself behaves.

   What the rig actually simulates:

     · each prong is a physics.Arm — a 1-DOF hinge with real rotational inertia
       driven by a geared-motor torque curve. A prize it cannot close around
       stops it dead, and prongs routinely finish a grab at different angles
       because they are independently blocked
     · the head hangs on a cable modelled as a damped pendulum whose period
       follows the cable length, so a fast gantry move leaves it swinging
     · the hoist slows against contact reaction, so the claw settles onto a
       prize instead of bulldozing through it

   The play cycle is the authentic Japanese two-button scheme: hold ➊ to track
   right, release to lock that axis; hold ➋ to track back, release and the
   machine takes over. Each aim phase commits on the RELEASE of its button.
============================================================================ */
import * as THREE from 'three';
import { Arm, CapsuleCollider } from '../physics.js';

const V3 = THREE.Vector3;
const _v = new V3(), _w = new V3(), _u = new V3();
const UP = new V3(0, 1, 0);

/** Capsule that rides a hinge and reports the head's linear velocity. */
class ProngCapsule extends CapsuleCollider {
  constructor(r, opts, arm, headVel){
    super([0,0,0], [0,0,1], r, opts);
    this.kinematic = true;
    this.arm = arm;
    this.headVel = headVel;
    this.reaction = new V3();
  }
  pointVel(p, out){ out.copy(this.headVel); }
}

/** One prong: a bent hook swinging on a horizontal hinge at the head. */
export class Prong {
  constructor(yaw, world, headVel, P){
    this.P = P;
    this.radial = new V3(Math.cos(yaw), 0, Math.sin(yaw));
    // hinge axis = radial x down; rotating about it swings the tip inward
    this.axisL = new V3(Math.sin(yaw), 0, -Math.cos(yaw));
    this.arm = new Arm(P.inertia);
    this.arm.angle = P.open;

    // Prong friction. The defaults are the rubber-padded hooks every gripping
    // cabinet on this floor wants — a grippy lower segment is most of what
    // holds a plush. リング掛け is the exception and needs the opposite: its
    // hook carries a ring by GEOMETRY, and the ring has to be able to slide
    // back off the barb when the claw opens over the chute. At the default
    // 1.05 it does not — the barb would have to point 45° down before the ring
    // let go, which is past anything the hinge can reach — so that cabinet
    // passes a chromed pair instead. Omit them and nothing changes.
    this.upper = world.addCollider(
      new ProngCapsule(P.rUpper, { friction: P.muUpper ?? 0.62, restitution: 0.05 }, this.arm, headVel));
    this.lower = world.addCollider(
      new ProngCapsule(P.rLower, { friction: P.muLower ?? 1.05, restitution: 0.02 }, this.arm, headVel));
    this.segs = [this.upper, this.lower];
    this.tip = new V3();
  }

  place(headPos, headQuat){
    const P = this.P;
    const r = _v.copy(this.radial).applyQuaternion(headQuat);
    const dn = _w.set(0, -1, 0).applyQuaternion(headQuat);
    this.arm.axis.copy(this.axisL).applyQuaternion(headQuat);
    this.arm.pivot.copy(headPos)
      .addScaledVector(r, P.hingeR).addScaledVector(dn, P.hingeDrop);

    const c = Math.cos(this.arm.angle), s = Math.sin(this.arm.angle);
    const pt = (i, out) => {
      const u = P.profile[i][0], v = P.profile[i][1];
      return out.copy(this.arm.pivot)
        .addScaledVector(r, u*c - v*s)
        .addScaledVector(dn, u*s + v*c);
    };
    pt(0, this.upper.a); pt(1, this.upper.b);
    this.lower.a.copy(this.upper.b); pt(2, this.lower.b);
    this.tip.copy(this.lower.b);
  }

  /** Geared-motor torque curve; `dir` is +1 closing, -1 opening, 0 free. */
  drive(dir, strength, dt){
    const P = this.P, a = this.arm;
    let tau = 0;
    if      (dir > 0) tau =  strength      * (1 - a.avel / P.w0);
    else if (dir < 0) tau = -strength*0.6  * (1 + a.avel / P.w0);
    a.avel += tau * a.invI * dt;
    a.avel *= Math.max(0, 1 - 2.2 * dt);
    a.avel = Math.max(-6, Math.min(6, a.avel));
  }

  /** Integrate the hinge AFTER the solve — see physics.Arm. */
  integrate(dt){
    const P = this.P, a = this.arm;
    a.angle += a.avel * dt;
    if (a.angle < P.open){  a.angle = P.open;  if (a.avel < 0) a.avel = 0; }
    if (a.angle > P.close){ a.angle = P.close; if (a.avel > 0) a.avel = 0; }
  }
}

/* ================================================================== rig === */
export class ClawRig {
  /**
   * @param world  physics world to add the claw colliders to
   * @param root   Object3D to parent the gantry/head meshes onto
   * @param cfg    geometry + behaviour, see the machines for concrete values
   */
  constructor(world, root, cfg){
    this.world = world;
    this.root = root;
    this.cfg = cfg;
    this.picks = [];

    this.credit = 0;
    this.plays = 0;
    this.phase = 'idle';
    this.t = 0;
    this.pressedA = false; this.pressedB = false;
    this.btnA = false; this.btnB = false;
    this.onPhase = null;

    this.gx = cfg.homeX; this.gz = cfg.homeZ;
    this.vx = 0; this.vz = 0;
    this.y = cfg.headTop; this.vy = 0;
    this.sx = 0; this.sz = 0; this.svx = 0; this.svz = 0;
    this.pvx = 0; this.pvz = 0;
    this.headPos = new V3(); this.headQuat = new THREE.Quaternion();
    this.headVel = new V3();
    this.motor = -1;
    this.stallT = 0;
    this.resist = 0;

    // prongYaw rotates the whole claw about its own axis. A slider cabinet
    // needs the prongs working ALONG the lane (±Z), not across it, or they
    // straddle the guide walls and never touch the prize.
    const y0 = cfg.prongYaw ?? 0;
    const yaws = cfg.prongCount === 3
      ? [y0, y0 + 2*Math.PI/3, y0 + 4*Math.PI/3]
      : [y0, y0 + Math.PI];
    this.prongs = yaws.map(y => new Prong(y, world, this.headVel, cfg.prong));

    this._buildVisuals();
    this.poseHead(1/120);
  }

  /* ------------------------------------------------------------ visuals -- */
  _buildVisuals(){
    const cfg = this.cfg, root = this.root;
    const chrome = new THREE.MeshStandardMaterial({ color:0xc8d0e2, roughness:.22, metalness:.95 });
    const trim   = new THREE.MeshStandardMaterial({ color:0x14152a, roughness:.45, metalness:.7 });
    this.chrome = chrome;

    for (const sx of [-1, 1]){
      const r = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, cfg.inZ*2, 10), chrome);
      r.rotation.x = Math.PI/2;
      r.position.set(sx*(cfg.inX - 0.02), cfg.railY, 0);
      root.add(r);
    }
    this.bridge = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.inX*2 - 0.02, 0.035, 0.07), trim);
    root.add(this.bridge);
    this.carriage = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.10), trim);
    root.add(this.carriage);
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 6), chrome);
    root.add(this.cable);

    this.head = new THREE.Group();
    root.add(this.head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.075, 0.06, 16), chrome);
    cap.position.y = 0.03; this.head.add(cap);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.050, 16, 12), chrome);
    dome.position.y = 0.065; this.head.add(dome);
    this.headRing = new THREE.Mesh(new THREE.TorusGeometry(0.070, 0.010, 8, 24),
      new THREE.MeshStandardMaterial({ color:0xff2f7f, emissive:0xff2f7f,
        emissiveIntensity:1.4, roughness:.4 }));
    this.headRing.rotation.x = Math.PI/2;
    this.head.add(this.headRing);

    const P = cfg.prong;
    this.prongMeshes = this.prongs.map(() => {
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(P.rUpper, 1, 4, 10), chrome);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(P.rLower, 1, 4, 10), chrome);
      const pad = new THREE.Mesh(new THREE.SphereGeometry(P.rLower * 1.22, 12, 10),
        new THREE.MeshStandardMaterial({ color:0x1a1a22, roughness:.95 }));
      root.add(upper, lower, pad);
      return { upper, lower, pad };
    });
  }

  /** Two cabinet buttons on the front face at (±dx, y, z). */
  buildButtons(dx, y, z){
    const trim = new THREE.MeshStandardMaterial({ color:0x14152a, roughness:.45, metalness:.7 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(dx*3.8, 0.13, 0.03), trim);
    plate.position.set(0, y, z - 0.020);
    this.root.add(plate);
    this.buttons = [];
    // NB: this was `[[0,-1],[1,1]].entries()`, which destructures to sx = [0,-1]
    // — an ARRAY — so `sx * dx` was NaN and both button groups sat at an
    // undefined x on every cabinet on the floor. They rendered nowhere and the
    // raycast could never hit them, which is why the bench has only ever been
    // played with the arrow keys. Nothing physical depends on it: button STATE
    // comes from pressA/pressB, not from these meshes.
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

  /* ------------------------------------------------------------- control -- */
  insertCoin(){
    if (this.credit >= 1 || this.busy) return false;
    this.credit = 1;
    this.phase = 'aimX';
    this.t = 0;
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
    this.sx = this.sz = this.svx = this.svz = 0;
    for (const p of this.prongs){ p.arm.angle = this.cfg.prong.open; p.arm.avel = 0; }
  }

  /* ------------------------------------------------------------ kinematics */
  poseHead(dt){
    const cfg = this.cfg;
    // cable pendulum: the head lags the gantry, so a hard move leaves it swinging
    const L = Math.max(0.10, cfg.railY - this.y);
    const w2 = 9.81 / L;
    const ax = (this.vx - this.pvx) / Math.max(dt, 1e-4);
    const az = (this.vz - this.pvz) / Math.max(dt, 1e-4);
    this.pvx = this.vx; this.pvz = this.vz;
    this.svx += (-w2*this.sx - 2.2*this.svx - ax) * dt;
    this.svz += (-w2*this.sz - 2.2*this.svz - az) * dt;
    this.sx += this.svx * dt;
    this.sz += this.svz * dt;
    const m = Math.hypot(this.sx, this.sz), MAX = 0.11;
    if (m > MAX){ const k = MAX/m; this.sx*=k; this.sz*=k; this.svx*=k*0.5; this.svz*=k*0.5; }

    this.headPos.set(this.gx + this.sx, this.y, this.gz + this.sz);
    this.headVel.set(this.vx + this.svx, this.vy, this.vz + this.svz);
    this.headQuat.setFromEuler(new THREE.Euler(
      Math.atan2(this.sz, L), 0, -Math.atan2(this.sx, L), 'XYZ'));

    if (this.hub) this.hub.c.copy(this.headPos);
    for (const p of this.prongs) p.place(this.headPos, this.headQuat);
  }

  /** Run one fixed substep of the mechanism. Call from inside World.step(). */
  stepMechanism(h){
    const cfg = this.cfg;
    const MOVE = cfg.moveSpeed ?? 0.34, ACC = 3.2, DRAG = 8;
    let ax = 0, az = 0, targetVy = 0;
    this.motor = -1;

    switch (this.phase){
      case 'idle': break;
      // Each aim phase commits on the RELEASE of its button, but only after it
      // has actually been pressed — otherwise a player who never touches the
      // button leaves the phase stuck. The timeout is the last-resort guard.
      case 'aimX':
        this.t += h;
        if (this.btnA){ ax = 1; this.pressedA = true; }
        else if (this.pressedA || this.t > 20){ this.phase = 'aimZ'; this.t = 0; this._emit(); }
        break;
      case 'aimZ':
        this.t += h;
        if (this.btnB){ az = -1; this.pressedB = true; }
        else if (this.pressedB || this.t > 20){
          this.phase = 'drop'; this.t = 0; this.stallT = 0; this._emit();
        }
        break;
      case 'drop':
        // NB: a settle-pause before descending was tried here to damp the cable
        // swing left over from aiming. It made the slider strictly worse (23 ->
        // 45+ plays) — that residual swing is a meaningful part of what breaks
        // static friction on an inclined rail. Left in deliberately.
        targetVy = -(cfg.dropSpeed ?? 0.42);
        this.stallT = this.resist > 0.7 ? this.stallT + h : 0;
        if (this.y <= cfg.headMin + 0.001 || this.stallT > 0.20){
          this.phase = 'close'; this.t = 0; this._emit();
        }
        break;
      case 'close':
        this.motor = 1; this.t += h;
        if (this.t > (cfg.closeTime ?? 0.75)){ this.phase = 'lift'; this.t = 0; this._emit(); }
        break;
      case 'lift':
        this.motor = 1; targetVy = 0.40;
        if (this.y >= cfg.headTop - 0.004){ this.phase = 'return'; this.t = 0; this._emit(); }
        break;
      case 'return': {
        this.motor = 1; targetVy = 0.40; this.t += h;
        const dx = cfg.homeX - this.gx, dz = cfg.homeZ - this.gz;
        ax = Math.max(-0.7, Math.min(0.7, dx*4.0 - this.vx*1.7));
        az = Math.max(-0.7, Math.min(0.7, dz*4.0 - this.vz*1.7));
        if ((Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01 &&
             Math.abs(this.vx) < 0.05 && Math.abs(this.vz) < 0.05) || this.t > 8){
          this.phase = 'release'; this.t = 0; this._emit();
        }
        break;
      }
      case 'release':
        this.motor = -1; this.t += h;
        if (this.t > 1.0){ this.phase = 'idle'; this.credit = 0; this.plays++; this._emit(); }
        break;
    }

    // gantry
    this.vx += ax * ACC * h;  this.vz += az * ACC * h;
    if (ax === 0) this.vx -= this.vx * Math.min(1, DRAG*h);
    if (az === 0) this.vz -= this.vz * Math.min(1, DRAG*h);
    this.vx = Math.max(-MOVE, Math.min(MOVE, this.vx));
    this.vz = Math.max(-MOVE, Math.min(MOVE, this.vz));
    this.gx += this.vx * h;   this.gz += this.vz * h;
    if (this.gx < cfg.limX[0]){ this.gx = cfg.limX[0]; this.vx = 0; }
    if (this.gx > cfg.limX[1]){ this.gx = cfg.limX[1]; this.vx = 0; }
    if (this.gz < cfg.limZ[0]){ this.gz = cfg.limZ[0]; this.vz = 0; }
    if (this.gz > cfg.limZ[1]){ this.gz = cfg.limZ[1]; this.vz = 0; }

    // hoist, slowed by whatever the claw is pressing on
    let react = this.hub ? -this.hub.reaction.y : 0;
    for (const p of this.prongs) react += -p.upper.reaction.y - p.lower.reaction.y;
    const rNow = Math.max(0, Math.min(1, (react / h) / 26));
    this.resist += (rNow - this.resist) * Math.min(1, 14*h);
    if (targetVy < 0) targetVy *= (1 - this.resist);
    this.vy += (targetVy - this.vy) * Math.min(1, 12*h);
    this.y += this.vy * h;
    if (this.y < cfg.headMin){ this.y = cfg.headMin; this.vy = Math.max(0, this.vy); }
    if (this.y > cfg.headTop){ this.y = cfg.headTop; this.vy = Math.min(0, this.vy); }

    // Prize machines let the operator set the claw's grip separately for the
    // CLOSE and for everything after it, and the standard setting is a strong
    // close with a weak hold. That is where the classic near-miss comes from:
    // the claw takes the prize cleanly, gets it off the deck, and loses it
    // halfway home. `holdScale` defaults to 1, so a cabinet that does not opt
    // in behaves exactly as before.
    //
    // `releaseScale` is the third setting, and it is what the prong motor pushes
    // with while it is OPENING rather than gripping. On a real cabinet that is a
    // different mechanism — a spring or solenoid return — so there is no reason
    // it should inherit the hold, and on リング掛け inheriting it was a bug: a
    // prize hanging in the crook of a hook exerts about 0.53 N·m closing the
    // prong, against only 0.30 N·m of opening at strength × hold. The claw
    // stalled part way open with the prize still on it, roughly 3 plays in 100.
    // Defaults to `holdScale`, so every cabinet that does not set it is
    // bit-for-bit unchanged.
    const grip = this.phase === 'close'
      ? cfg.strength
      : this.motor < 0 ? cfg.strength * (cfg.releaseScale ?? cfg.holdScale ?? 1)
                       : cfg.strength * (cfg.holdScale ?? 1);
    for (const p of this.prongs) p.drive(this.motor, grip, h);
    this.poseHead(h);
  }

  integrateHinges(dt){ for (const p of this.prongs) p.integrate(dt); }

  /* ------------------------------------------------------------- visuals -- */
  sync(){
    const cfg = this.cfg;
    this.bridge.position.set(0, cfg.railY, this.gz);
    this.carriage.position.set(this.gx, cfg.railY - 0.05, this.gz);
    this.head.position.copy(this.headPos);
    this.head.quaternion.copy(this.headQuat);

    _v.copy(this.carriage.position);
    _u.copy(this.headPos).sub(_v);
    const len = _u.length();
    this.cable.position.copy(_v).addScaledVector(_u, 0.5);
    this.cable.scale.set(1, len, 1);
    _w.copy(_u).normalize();
    this.cable.quaternion.setFromUnitVectors(UP, _w);

    for (let i = 0; i < this.prongs.length; i++){
      const p = this.prongs[i], m = this.prongMeshes[i];
      for (const [seg, mesh] of [[p.upper, m.upper], [p.lower, m.lower]]){
        _u.copy(seg.b).sub(seg.a);
        const L = _u.length();
        mesh.position.copy(seg.a).addScaledVector(_u, 0.5);
        _w.copy(_u).normalize();
        mesh.quaternion.setFromUnitVectors(UP, _w);
        mesh.scale.set(1, Math.max(0.001, L), 1);
      }
      m.pad.position.copy(p.tip);
    }

    if (this.buttons){
      for (const [i, b] of this.buttons.entries()){
        const down = i ? this.btnB : this.btnA;
        b.cap.position.z = b.base - (down ? 0.008 : 0);
        b.cap.material.emissiveIntensity = down ? 1.6 : 0.6;
      }
    }
    this.headRing.material.emissiveIntensity = this.busy ? 2.6 : 1.2;
  }

  /** Wireframes for the moving claw parts. */
  buildDebug(group, mat){
    this._dbg = [];
    for (const p of this.prongs) for (const seg of p.segs){
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(seg.r, 1, 4, 8), mat);
      group.add(m); this._dbg.push({ m, seg });
    }
  }
  updateDebug(){
    if (!this._dbg) return;
    for (const d of this._dbg){
      _u.copy(d.seg.b).sub(d.seg.a);
      const L = _u.length();
      d.m.position.copy(d.seg.a).addScaledVector(_u, 0.5);
      _w.copy(_u).normalize();
      d.m.quaternion.setFromUnitVectors(UP, _w);
      d.m.scale.set(1, Math.max(0.001, L), 1);
    }
  }
}

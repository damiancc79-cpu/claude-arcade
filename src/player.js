/* ============================================================================
   player.js — first-person walk controller.

   Movement is deliberately simple kinematics + axis-separated AABB resolution.
   The arcade has no dynamics of its own, so a full physics step would be waste;
   what matters is that you can't clip through cabinets and the aisles feel the
   right width when you walk them.
============================================================================ */
import * as THREE from 'three';

export const EYE = 1.62;          // eye height, metres
const RADIUS   = 0.30;            // player capsule radius
const ACCEL    = 34;
const MAX_SPD  = 2.35;
const RUN_SPD  = 4.20;
const DRAG     = 11;

export class Player {
  constructor(camera, domElement){
    this.camera = camera;
    this.dom = domElement;
    this.pos = new THREE.Vector3(0, EYE, 5.2);
    this.vel = new THREE.Vector3();
    this.yaw = 0;                  // camera looks down -Z: into the room
    this.pitch = -0.02;
    this.locked = false;
    this.keys = Object.create(null);
    this.colliders = [];
    this.bob = 0;
    this.enabled = true;

    this._onKeyDown = e => {
      this.keys[e.code] = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = e => { this.keys[e.code] = false; };
    this._onMove = e => {
      if (!this.locked || !this.enabled) return;
      this.yaw   -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch));
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this.onLockChange) this.onLockChange(this.locked);
    };

    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock(){
    if (this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  setColliders(list){ this.colliders = list; }

  update(dt){
    if (this.enabled){
      const k = this.keys;
      let fx = 0, fz = 0;
      if (k.KeyW || k.ArrowUp)    fz += 1;
      if (k.KeyS || k.ArrowDown)  fz -= 1;
      if (k.KeyD || k.ArrowRight) fx += 1;
      if (k.KeyA || k.ArrowLeft)  fx -= 1;

      const mag = Math.hypot(fx, fz);
      const top = (k.ShiftLeft || k.ShiftRight) ? RUN_SPD : MAX_SPD;
      if (mag > 0){
        fx /= mag; fz /= mag;
        // yaw-relative: forward is where the camera looks
        const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        const wx = fx * c - fz * s;
        const wz = -fx * s - fz * c;
        this.vel.x += wx * ACCEL * dt;
        this.vel.z += wz * ACCEL * dt;
      }
      // drag, then clamp to the current top speed
      const d = Math.max(0, 1 - DRAG * dt);
      this.vel.x *= d; this.vel.z *= d;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > top){ this.vel.x *= top/sp; this.vel.z *= top/sp; }

      this._move(this.vel.x * dt, this.vel.z * dt);

      // subtle head bob so walking has some weight
      this.bob += sp * dt * 3.1;
      const bobY = Math.sin(this.bob) * Math.min(sp / MAX_SPD, 1) * 0.022;
      this.pos.y = EYE + bobY;
    }

    this.camera.position.copy(this.pos);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  /** Axis-separated sweep so sliding along a cabinet face feels smooth. */
  _move(dx, dz){
    this.pos.x += dx;
    this._resolve('x');
    this.pos.z += dz;
    this._resolve('z');
  }

  _resolve(axis){
    const p = this.pos, r = RADIUS;
    for (const b of this.colliders){
      if (p.x + r <= b.x0 || p.x - r >= b.x1 || p.z + r <= b.z0 || p.z - r >= b.z1) continue;
      // push out along the axis we just moved on
      if (axis === 'x'){
        const toLeft  = (p.x + r) - b.x0;
        const toRight = b.x1 - (p.x - r);
        if (toLeft < toRight){ p.x = b.x0 - r; } else { p.x = b.x1 + r; }
        this.vel.x = 0;
      } else {
        const toNear = (p.z + r) - b.z0;
        const toFar  = b.z1 - (p.z - r);
        if (toNear < toFar){ p.z = b.z0 - r; } else { p.z = b.z1 + r; }
        this.vel.z = 0;
      }
    }
  }

  dispose(){
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}

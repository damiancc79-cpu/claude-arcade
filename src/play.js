/* ============================================================================
   play.js — playing the cabinets from inside the room.

   The bench drives a machine by clicking its parts directly. That does not
   survive the move into first person: a coin slot is 55 mm across and you meet
   it at 1.3 m, so pointing at one means holding the crosshair inside 2.5° while
   standing on a walk controller with head bob. Measured, aiming a ray at BF1's
   slot from a sensible standing position missed it by 180 mm.
   
   So the room picks the CABINET, not the part — the one you are close to, in
   front of, and roughly facing. There is only ever one machine within arm's
   reach on a floor with 1.04 m of pitch, so there is nothing to disambiguate.

   The control scheme is the authentic two-button one, on the mouse:

     F            insert ¥100 into the cabinet you are looking at
     hold LMB     button ➊ — track right, release to lock that axis
     hold RMB     button ➋ — track back, release and the machine takes over

   The two buttons are on the MOUSE rather than the keyboard because the
   keyboard is already the walk controller: `player.js` owns WASD and takes the
   arrow keys too (it preventDefaults them so the page does not scroll). Putting
   ➊/➋ on left and right mouse also happens to be the right shape — you stand
   still, both hands on the machine, and the whole game is when you let go.

   NOTHING HERE SIMULATES. The machines were already running; this only routes
   `insertCoin` / `pressA` / `pressB` to the one you are standing at, which is
   exactly what `bench.js` does through a different input device.
============================================================================ */
import * as THREE from 'three';

/** How close you have to stand, in metres. Arm's length at a cabinet. */
const REACH = 2.1;
/** How far off dead-on you may be looking and still be "at" the machine. */
const FACING = 0.62;          // cos of the half-angle, ~52°
/** A machine mid-play stays in control out to here, so a small step does not drop it. */
const HOLD = 3.4;

/*
 * The prompt is anchored to the BOTTOM OF THE SCREEN, not to the crosshair.
 *
 * It used to sit at `50% + 44px`, just under the crosshair, which is the
 * obvious place and the wrong one: the crosshair is on the machine, so the
 * prompt is on the machine. Measured by projecting each cabinet's action zone
 * from a standing position 1.05 m away, looking at it — the way you actually
 * stand at one:
 *
 *     押し出し shelf      screen y 0.40 – 0.57
 *     シーソー platform            0.40 – 0.58
 *     三本爪 claw + pile           0.35 – 0.64
 *     大型 bar                     0.35 – 0.64
 *
 * Every cabinet straddles the centre, because you are looking at it. The old
 * position landed at ~0.55 — inside the action band on all of them. It read as
 * a problem with the low cabinets only because their band is tighter and their
 * playfields are pale; over 三本爪's dark cage the same overlap just looked
 * like text.
 *
 * The bottom of the screen is outside 0.64 by a wide margin on every machine
 * and does not move when you look around. Sat above `#fps`, which is the only
 * other thing at bottom centre.
 */
const HUD_CSS = `
#play{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);
  font:11px/1.7 ui-monospace,"SF Mono",Menlo,monospace;color:#cfd6ff;text-align:center;
  letter-spacing:1.6px;text-shadow:0 2px 10px rgba(0,0,0,.9);pointer-events:none;opacity:0;
  transition:opacity .12s;
  /* A backing plate, because the bottom of the frame is the cabinet itself and
     the cabinets are not all dark — 三本爪 is white and hot pink, and pale text
     with a soft shadow disappears into it. Same language as the room's other
     panels so it reads as HUD rather than as decal. */
  padding:6px 16px 7px;border-radius:10px;
  background:rgba(9,8,22,.58);border:1px solid rgba(255,255,255,.07);
  white-space:nowrap}
#play.on{opacity:1}
#play b{color:#ffd166;font-weight:600}
#play .name{color:#fff;font-size:12.5px;letter-spacing:3px;display:block;margin-bottom:3px}
#play .state{color:#37e6ff}
#won{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%) scale(.8);
  font-family:ui-monospace,Menlo,monospace;text-align:center;opacity:0;pointer-events:none;
  white-space:nowrap}
#won.show{animation:wonpop 2.8s cubic-bezier(.2,1.3,.35,1) forwards}
#won .jp{font-size:26px;font-weight:800;letter-spacing:4px;color:#fff;
  text-shadow:0 0 24px #ff2f7f,0 0 60px #ff2f7f}
#won .en{font-size:10px;letter-spacing:4px;color:#ffd166;margin-top:7px}
@keyframes wonpop{
  0%{opacity:0;transform:translate(-50%,-50%) scale(.7)}
  12%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}
  24%{transform:translate(-50%,-50%) scale(1)}
  78%{opacity:1;transform:translate(-50%,-56%) scale(1)}
  100%{opacity:0;transform:translate(-50%,-78%) scale(.95)}}
`;

const PHASE_HINT = {
  aimX  : 'hold <b>LMB</b> — track right, release to lock',
  aimZ  : 'hold <b>RMB</b> — track back, release to drop',
  drop  : 'descending…',
  close : 'closing',
  push  : 'pushing',
  lift  : 'lifting',
  return: 'returning',
  release: 'opening',
};

export class PlayController {
  /**
   * @param opts.machines [{ machine, x, z }] as main.js builds them
   * @param opts.labels   map of bay kind -> display name, for the prompt
   */
  constructor({ camera, dom, player, machines, labels = {} }){
    this.camera = camera;
    this.player = player;
    this.entries = machines;
    this.labels = labels;

    this._dir = new THREE.Vector3();
    this._to = new THREE.Vector3();
    for (const e of this.entries){
      // the way the cabinet faces, from its bay rotation
      e.front = new THREE.Vector3(Math.sin(e.rotY), 0, Math.cos(e.rotY));
      e.machine.onWin = prize => this._won(prize);
    }

    this.active = null;                    // the cabinet taking our input
    this.lmb = false; this.rmb = false;

    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.id = 'play';
    this.won = document.createElement('div');
    this.won.id = 'won';
    this.won.innerHTML = '<div class="jp"></div><div class="en"></div>';
    document.getElementById('hud').append(this.el, this.won);

    dom.addEventListener('mousedown', e => {
      if (!player.locked) return;          // not in the room yet; let the lock click through
      e.preventDefault();
      if (e.button === 0) this.lmb = true;
      if (e.button === 2) this.rmb = true;
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('keydown', e => {
      if (e.code === 'KeyF' && player.locked) this._coin();
    });
    // Losing the pointer lock has to release the buttons, or a machine keeps
    // tracking on a button nobody is holding any more.
    addEventListener('blur', () => { this.lmb = this.rmb = false; });
  }

  _coin(){
    const m = this.active && this.active.machine;
    if (m && m.insertCoin) m.insertCoin();
  }

  _won(prize){
    this.won.querySelector('.jp').textContent = prize.jp || '';
    this.won.querySelector('.en').textContent = prize.en || '';
    this.won.classList.remove('show');
    void this.won.offsetWidth;
    this.won.classList.add('show');
  }

  /**
   * The cabinet you are standing at, or null: near enough to touch, on the side
   * it opens onto, and roughly facing it. Best-facing wins if two qualify.
   */
  _look(){
    const cam = this.camera.position;
    this.camera.getWorldDirection(this._dir);
    let best = null, bestDot = FACING;
    for (const e of this.entries){
      const dx = e.x - cam.x, dz = e.z - cam.z;
      const d = Math.hypot(dx, dz);
      if (d > REACH || d < 1e-3) continue;
      // must be on the cabinet's front side, or you are playing it through its back
      if (-dx * e.front.x - dz * e.front.z <= 0) continue;
      const dot = (dx * this._dir.x + dz * this._dir.z) / d;
      if (dot > bestDot){ bestDot = dot; best = e; }
    }
    return best;
  }

  update(){
    const locked = this.player.locked && this.player.enabled;
    const cam = this.camera.position;

    // A cabinet mid-play keeps control until you walk away from it, so that
    // stepping back during the drop does not silently hand the buttons to a
    // neighbour — which on a row of cabinets 1.04 m apart is very easy to do.
    let next = null;
    if (locked){
      const a = this.active;
      const busy = a && a.machine.credit > 0;
      const near = a && Math.hypot(a.x - cam.x, a.z - cam.z) < HOLD;
      next = (busy && near) ? a : this._look();
    }

    if (next !== this.active){
      if (this.active){ this.active.machine.pressA(false); this.active.machine.pressB(false); }
      this.active = next;
    }

    const m = this.active && this.active.machine;
    if (m){
      m.pressA(this.lmb);
      m.pressB(this.rmb);
    }
    this._prompt(m);
  }

  _prompt(m){
    if (!m){ this.el.classList.remove('on'); return; }
    const name = this.labels[this.active.kind] || '';
    let line;
    if (m.credit > 0 || m.phase !== 'idle'){
      line = PHASE_HINT[m.phase] || '';
    } else {
      line = m.prizesLeft ? 'press <b>F</b> — insert <b>¥100</b>' : 'sold out';
    }
    const won = m.wins ? `  ·  <span class="state">won ${m.wins}</span>` : '';
    this.el.innerHTML = `<span class="name">${name}</span>${line}${won}`;
    this.el.classList.add('on');
  }
}

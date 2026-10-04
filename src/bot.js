/* ============================================================================
   bot.js — headless driver for the crane machines.

   Hand-testing a claw machine in a browser tab does not work: the tab throttles
   the moment it loses focus and a "measurement" becomes a measurement of the
   scheduler. Every difficulty number in the README came from this file instead
   — the machine stepped directly at a fixed 1/60 with the buttons driven by
   code.

   It works on any cabinet built from ClawRig (二本爪, 三本爪, 橋渡し,
   スライダー): they all expose the same two-button interface and all park the
   claw over their own chute, so `rig.homeX/homeZ` IS the goal to push a prize
   toward. Nothing here is used by the game.

     BENCH.bot.play({ pull: 0.05 })      one play at the prize nearest the goal
     BENCH.bot.session({ cap: 40 })      plays until something is won
     BENCH.bot.rate({ n: 60 })           win probability from a fresh restock

   Two details it must get right, both of which cost real debugging time:

     · GANTRY COAST. Each aim phase commits when its button is RELEASED, and
       the gantry then drifts ~42 mm further (MOVE/DRAG = 0.34/8). A bot that
       releases on the target overshoots it every single time.
     · A HUMAN ALWAYS TAPS. Each aim phase advances on the release of a button
       that has actually been pressed, so a bot that never presses one sits in
       the phase until the 20-second timeout. Both phases get a two-frame tap
       even when the claw is already where it wants to be.
============================================================================ */

/**
 * Gantry drift after the button is released, in metres.
 *
 * 0.042 is the measured coast for the standard 0.34 m/s gantry and every
 * published number on this floor was taken with it, so it stays exactly where
 * it is. It is not a universal constant though: the gantry decays at a fixed
 * DRAG, so the coast is proportional to the speed, measured at 0.1167 × MOVE
 * over a 3× range (0.34 → 0.0397, 0.55 → 0.0642, 0.80 → 0.0933, 1.10 → 0.1283).
 * A cabinet running a non-default `moveSpeed` gets the linear form; leaving it
 * on 0.042 would have the bot overshoot by 90 mm at 1.1 m/s and every number
 * from such a cabinet would be measuring the harness.
 *
 * The two forms differ by 2 mm at the default, which is well under the aim
 * error but is not bit-identical — hence the guard rather than the formula.
 */
const COAST_DEFAULT = 0.042;
/** Coast per unit of CURRENT velocity — measured, and the constant behind both forms. */
const COAST_K = 0.1167;
const coastOf = rig => {
  const v = rig.cfg.moveSpeed ?? 0.34;
  return v === 0.34 ? COAST_DEFAULT : COAST_K * v;
};

/**
 * A FIXED coast offset is only right when the gantry has reached top speed by
 * the time the button goes, and on a fast cabinet it has not: accelerating at
 * 3.2 m/s² it needs 100 mm to reach 0.8 m/s, and the move from the park position
 * to the nearest prize is 91 mm. Releasing at `target − topSpeedCoast` then
 * stops the claw 77 mm SHORT, every play, and the cabinet reads as impossible
 * when what is broken is the harness. Measured on リング掛け at 0.8 m/s: the head
 * arrived 77 mm off in x, no aim offset rescued it, and the obvious reading —
 * "a fast gantry is a swing lottery" — was wrong.
 *
 * Predicting the stopping point from the CURRENT velocity is both correct at any
 * speed and what a player actually does: you watch the claw move and let go when
 * it looks like it will stop in the right place. Used automatically for any
 * cabinet running a non-default gantry; the standard 0.34 m/s keeps the fixed
 * constant so every number already published still reproduces exactly.
 */
const stopsAt = (pos, vel) => pos + vel * COAST_K;

export class BenchBot {
  /**
   * @param machine any ClawRig-based machine
   * @param opts.goal {x,z} the point prizes have to reach; defaults to the
   *                  claw's park position, which is over the chute on every
   *                  cabinet on this floor
   */
  constructor(machine, opts = {}){
    this.m = machine;
    this.rig = machine.rig;
    this.goal = opts.goal ?? { x: this.rig.cfg.homeX, z: this.rig.cfg.homeZ };
  }

  /** Live prizes, nearest the goal first. */
  live(){
    const g = this.goal;
    return this.m.prizes
      .filter(p => !p.won)
      .map(p => ({ body: p, d: Math.hypot(p.pos.x - g.x, p.pos.z - g.z) }))
      .sort((a, b) => a.d - b.d);
  }

  /** Distance from the goal to the closest live prize, or null if none. */
  nearest(){ const l = this.live(); return l.length ? l[0].d : null; }

  /**
   * One coin, one play.
   *
   * @param o.jitter human aim error, metres (uniform ±)
   * @param o.timing human aim error expressed as RELEASE TIMING instead,
   *        seconds (uniform ±), converted with the gantry's own speed. This is
   *        the honest parameterisation for a two-button cabinet: the player does
   *        not choose a position, they choose a moment to let go, and the
   *        distance that moment is worth depends on how fast the gantry runs.
   *        At the standard 0.34 m/s the floor's usual ±20 mm IS ±59 ms, so the
   *        two models agree on every cabinet built so far — they only come apart
   *        when a cabinet changes `moveSpeed`, which is exactly when the spatial
   *        form stops meaning anything.
   * @param o.pull   land the claw this far past the prize on the side AWAY
   *                 from the goal, so the closing hooks drag it inward. This
   *                 is 寄せ, and it is the difference between a bot that makes
   *                 progress and one that random-walks a prize forever.
   * @param o.at     {x,z} to aim somewhere specific instead of at a prize
   * @param o.body   a specific prize to go for instead of the closest one
   */
  play(o = {}){
    const { jitter = 0.020, timing = null, pull = 0, at = null, body = null } = o;
    const m = this.m, rig = this.rig, g = this.goal;
    const COAST = coastOf(rig);
    const predict = (rig.cfg.moveSpeed ?? 0.34) !== 0.34;
    const jit = timing !== null ? timing * (rig.cfg.moveSpeed ?? 0.34) : jitter;

    let tx, tz, watched = null;
    if (at){ tx = at.x; tz = at.z; }
    else {
      const l = this.live();
      if (!l.length) return null;
      watched = body && !body.won ? body : l[0].body;
      const d = Math.max(Math.hypot(watched.pos.x - g.x, watched.pos.z - g.z), 1e-6);
      tx = watched.pos.x + ((watched.pos.x - g.x) / d) * pull;
      tz = watched.pos.z + ((watched.pos.z - g.z) / d) * pull;
    }
    tx += (Math.random() - 0.5) * 2 * jit;
    tz += (Math.random() - 0.5) * 2 * jit;
    const [lx0, lx1] = rig.cfg.limX, [lz0, lz1] = rig.cfg.limZ;
    tx = Math.max(lx0 + COAST + 0.005, Math.min(lx1, tx));
    tz = Math.max(lz0, Math.min(lz1 - COAST - 0.005, tz));

    const before = { d: this.nearest(), wins: m.wins };
    const start = watched ? { x: watched.pos.x, z: watched.pos.z } : null;
    if (!m.insertCoin()) return null;

    let nA = 0, nB = 0, top = 0;
    for (let i = 0; i < 2400; i++){
      // ➊ tracks +X, so hold while the predicted stop is still short of the
      // target; ➋ tracks −X... −Z, so hold while it is still beyond it.
      const holdA = predict ? stopsAt(rig.gx, rig.vx) < tx : rig.gx < tx - COAST;
      const holdB = predict ? stopsAt(rig.gz, rig.vz) > tz : rig.gz > tz + COAST;
      const a = rig.phase === 'aimX' && (holdA || nA < 2);
      const b = rig.phase === 'aimZ' && (holdB || nB < 2);
      if (a) nA++;
      if (b) nB++;
      m.pressA(a); m.pressB(b);
      m.update(1/60);
      for (const p of m.prizes) if (!p.won) top = Math.max(top, p.pos.y);
      if (rig.phase === 'idle') break;
    }
    for (let i = 0; i < 200; i++) m.update(1/60);   // let the pile settle

    const after = this.nearest();
    return {
      aim: [+tx.toFixed(3), +tz.toFixed(3)],
      won: m.wins > before.wins,
      // a prize clear of the cage's lower half was genuinely carried, not
      // just knocked up onto the pile
      carried: top > (rig.cfg.headMin + rig.cfg.headTop) / 2,
      shifted: start ? +Math.hypot(watched.pos.x - start.x, watched.pos.z - start.z).toFixed(3) : null,
      // millimetres the closest prize gained on the goal; negative is a setback
      gain: (before.d === null || after === null) ? null
            : +((before.d - after) * 1000).toFixed(0),
    };
  }

  /**
   * Restock, then play until something drops. Returns plays-to-win.
   *
   * @param o.patience give up on a prize after this many failed plays and go
   *        for the next one out. It matters more than it sounds: the stock is
   *        not equally winnable — a 155 g star cushion needs about half the
   *        grip a 265 g bear does — so a bot that hammers the closest prize
   *        forever simply never wins if that prize happens to be a heavy one.
   *        Measured: with no patience at all, 4 sessions in 12 never won in 40
   *        plays while the rest averaged 3. Switching targets is what a player
   *        does, and it is the difference between a bimodal result and a
   *        meaningful one.
   */
  session(o = {}){
    const { cap = 40, seed = null, patience = 4, ...rest } = o;
    const m = this.m;
    if (seed !== null) m.opts.seed = seed;
    m.wins = 0; this.rig.plays = 0; m.collected.length = 0;
    m.reset();
    const trail = [];
    const tries = new Map();
    let plays = 0, carries = 0, switches = 0;
    while (m.wins === 0 && plays < cap){
      const l = this.live();
      if (!l.length) break;
      let pick = l.find(e => (tries.get(e.body) || 0) < patience);
      if (!pick){ tries.clear(); pick = l[0]; }        // everything tried: start over
      if (pick.body !== l[0].body) switches++;
      const r = this.play({ ...rest, body: pick.body });
      if (!r) break;
      plays++;
      if (r.carried) carries++;
      if (!r.won) tries.set(pick.body, (tries.get(pick.body) || 0) + 1);
      trail.push(r.won ? 'WIN' : r.gain);
    }
    return { plays, carries, switches, won: m.wins > 0, trail };
  }

  /**
   * Win probability for a SINGLE play from a full cabinet — the statistic that
   * actually responds to a tuning change, since plays-to-win from an evolving
   * pile is dominated by how the pile happens to break.
   */
  rate(o = {}){
    const { n = 60, seeds = 6, ...rest } = o;
    const m = this.m;
    let wins = 0, carried = 0, gains = [];
    const per = Math.max(1, Math.round(n / seeds));
    for (let s = 0; s < seeds; s++) for (let i = 0; i < per; i++){
      m.opts.seed = s; m.wins = 0; this.rig.plays = 0; m.reset();
      const r = this.play(rest);
      if (!r) continue;
      if (r.won) wins++;
      if (r.carried) carried++;
      if (!r.won && r.gain !== null) gains.push(r.gain);
    }
    const total = per * seeds;
    gains.sort((a, b) => a - b);
    return {
      n: total,
      pWin: +(wins/total).toFixed(3),
      pCarry: +(carried/total).toFixed(3),
      gain: gains.length
        ? { min: gains[0], med: gains[gains.length >> 1], max: gains[gains.length-1] }
        : null,
    };
  }
}

/* ==========================================================================
   PusherBot — headless driver for メダルゲーム.

   `BenchBot` above drives the two-button gantry contract, and 押し出し proved
   that contract is not claw-specific. It IS however cabinet-specific in one
   way that finally bites here: everything it returns is shaped around a cabinet
   that hands out one thing and stops. `won`, `carried`, `plays-to-win`, `gain`
   toward a goal — none of those mean anything on a machine that pays out
   continuously, never empties, and whose field is worth more at the end of a
   session than the coins that built it.

   THE STATISTIC IS THE PAYOUT RATIO: medals out per medal in. Over 1.0 and the
   cabinet gives away the field an operator paid to load; under it and the field
   grows while the player's stack shrinks, which is the correct direction and
   the whole business model. It is also the only number on this cabinet that
   responds cleanly to a tuning change — a single coin can pay 0 or 9 depending
   on where the carpet happened to be sitting, so nothing shorter than a full
   session says anything at all.
========================================================================== */
export class PusherBot {
  constructor(machine){
    this.m = machine;
    this.rig = machine.rig;
  }

  /**
   * Where a player would aim: the column with the most medals nearest the lip.
   *
   * Feeding the leading edge is the whole strategy of a pusher — a medal
   * dropped onto a bare patch is a medal that has to travel the entire field
   * before it is worth anything, while the same medal on a loaded column adds
   * its weight to a stack that is already overhanging. Scored as the sum of
   * 1/(20 mm + distance to the lip) over everything within 50 mm of the
   * candidate x, so a column that is both crowded AND far forward wins.
   */
  bestX(){
    const m = this.m, lim = this.rig.cfg.limX;
    let bx = 0, best = -1;
    for (let i = 0; i <= 24; i++){
      const x = lim[0] + (lim[1] - lim[0]) * (i / 24);
      let s = 0;
      for (const b of m.medals){
        if (Math.abs(b.pos.x - x) > 0.05) continue;
        if (b.pos.y < 0.68) continue;                 // already falling out
        s += 1 / (0.020 + Math.max(0, 0.160 - b.pos.z));
      }
      if (s > best){ best = s; bx = x; }
    }
    return bx;
  }

  /**
   * One coin.
   *
   * @param o.at      aim here instead of at the bot's own choice
   * @param o.timing  human aim error as RELEASE TIMING, seconds (uniform ±).
   *        This cabinet is the pure case for that model: the medal leaves the
   *        chute at the instant the button goes, so there is no coast to
   *        compensate for and the error IS `timing × sweepSpeed`. Nothing
   *        converts it to metres behind your back.
   * @param o.settle  frames to let the field run after the play window closes
   */
  drop(o = {}){
    const { at = null, timing = 0.055, settle = 30 } = o;
    const m = this.m, rig = this.rig;
    const MOVE = rig.cfg.moveSpeed ?? 0.34;
    let tx = at !== null ? at : this.bestX();
    tx += (Math.random() - 0.5) * 2 * timing * MOVE;
    const [lx0, lx1] = rig.cfg.limX;
    tx = Math.max(lx0, Math.min(lx1, tx));

    const before = { paid: m.wins, lost: m.lost };
    if (!m.insertCoin()) return null;

    // ➊ tracks right from home and the medal drops on release, so hold while
    // the head is still short of the target. A player who never presses at all
    // times out at 20 s, exactly as on the gantry cabinets — so tap regardless.
    let n = 0;
    for (let i = 0; i < 1800; i++){
      const a = rig.phase === 'aim' && (rig.gx < tx || n < 2);
      if (a) n++;
      m.pressA(a);
      m.update(1/60);
      if (rig.phase === 'idle') break;
    }
    m.pressA(false);
    for (let i = 0; i < settle; i++) m.update(1/60);

    return {
      aim: +tx.toFixed(3),
      paid: m.wins - before.paid,
      lost: m.lost - before.lost,
      toLip: m.toLip === null ? null : +m.toLip.toFixed(3),
      onField: m.medals.length,
    };
  }

  /**
   * Restock and feed `coins` coins, the way a player works through a stack.
   *
   * Returns the payout ratio and where the medals went. `drain` runs the field
   * on afterwards without feeding it, because the pusher does not stop when you
   * do and a medal already overhanging the lip is owed to the player.
   */
  session(o = {}){
    const { coins = 30, seed = null, drain = 400, ...rest } = o;
    const m = this.m;
    if (seed !== null) m.opts.seed = seed;
    m.reset();
    const trail = [];
    for (let i = 0; i < coins; i++){
      const r = this.drop(rest);
      if (!r) break;
      trail.push(r.paid);
    }
    const beforeDrain = m.wins;
    for (let i = 0; i < drain; i++) m.update(1/60);
    m._sweep(true);
    return {
      coins: m.dropped,
      paid: m.wins,
      lost: m.lost,
      escaped: m.escaped || 0,
      refused: m.refused || 0,
      ratio: +(m.wins / Math.max(1, m.dropped)).toFixed(3),
      drained: m.wins - beforeDrain,
      onField: m.medals.length,
      dry: trail.filter(p => p === 0).length,      // coins that paid nothing
      best: Math.max(0, ...trail),
      trail,
    };
  }

  /**
   * Payout ratio across several fresh cabinets. The tuning statistic — one
   * session swings hard on how the carpet happens to break, exactly as
   * plays-to-win does on a crane.
   */
  rate(o = {}){
    const { seeds = 6, coins = 30, ...rest } = o;
    const out = [];
    for (let s = 0; s < seeds; s++) out.push(this.session({ ...rest, coins, seed: s }));
    const rs = out.map(o2 => o2.ratio).sort((a, b) => a - b);
    const sum = k => out.reduce((t, o2) => t + o2[k], 0);
    return {
      sessions: out.length, coins: sum('coins'),
      paid: sum('paid'), lost: sum('lost'),
      escaped: sum('escaped'), refused: sum('refused'),
      ratio: +(sum('paid') / Math.max(1, sum('coins'))).toFixed(3),
      dry: +(sum('dry') / Math.max(1, sum('coins'))).toFixed(3),
      spread: { min: rs[0], med: rs[rs.length >> 1], max: rs[rs.length - 1] },
      each: rs,
    };
  }
}

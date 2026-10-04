# Project status — read this first

The map and the open threads. `README.md` has the per-machine detail.

Finished work is not kept here. What is kept is the stuff that is still true:
what exists, what is unexplained, what will bite you, and how to measure.

## Where things stand

Eleven machines, all verified. Thirty-six bays, all filled and playable in first
person. Eight cranes share `clawrig.js`; 押し出し has no claw and runs its own
`PushRig`; メダルゲーム is not a crane in any sense and is on the bench only.
No duplicated mechanism code, and no machine with a known bricking state.

| | state |
|---|---|
| Arcade room (`index.html`) | Walk + overview cameras, collision, 36 bays. Floor renders in 2.8 ms / 1047 draws walking, 9.0 ms / 3371 in overview. |
| Physics engine (`src/physics.js`) | Sphere-cluster bodies, sequential impulses, warm starting, split impulse, sleeping, `Arm` hinges, `Link` ropes, `boxCluster`. |
| Bench bots (`src/bot.js`) | `BenchBot` drives the two-button gantry contract; `PusherBot` drives メダルゲーム. Every figure below came from them. |
| ガチャガチャ capsule | 16 consecutive plays, one capsule per turn, no jams. |
| 二本爪 two-prong | 1 win / 10 plays. Restock seeded, so the cabinet is deterministic end to end. |
| 三本爪 three-prong | 32 sessions, all converged. Median 18–19 plays, range 5–42. |
| 大型 big prize | 30 sessions, all converged. Median 11 plays, range 4–34. |
| ヒモ string cut | 18 sessions, 16 won, median 4 plays. |
| 橋渡し bridge | 5 plays to win, repeatable. |
| スライダー slider | Median ~30 plays. **Least well-tuned — see open threads.** |
| 押し出し push | 18 sessions, median 18, range 16–22. A full cabinet empties in ~55 plays with nothing stranded. |
| シーソー seesaw | Median 16.5 plays, range 7–41, 30 of 30 converging. Dumps four prizes at once. Needs `patience` — see open threads. |
| リング掛け ring hook | 18 sessions, median 3, mean 3.3, range 1–8. |
| メダルゲーム coin pusher | 180 coins over 6 seeds: **payout ratio 0.617**, 24% lost to the gutters, **0 escaped**. ~4.5 ms a frame. Bench only. |

Stepping all 36 cabinets costs **3.01 ms** a frame, with 34 of 209 bodies awake
— 26 of those are ヒモ's two cords, which are awake by design (gotcha 12). The
distance gate in `stepMachines` therefore buys almost nothing on a crane floor.
It stays because a *pusher* never sleeps, and that is the case it now exists for.

## Running it

```bash
python3 arcade/serve.py ~/Documents/claude 8777
```

`bench.html?m=<name>` — `capsule`, `claw2`, `claw3`, `clawbig`, `himo`, `bridge`,
`slider`, `ringhook`, `seesaw`, `push`, `medal`.

**The module cache will eat your edits, and cache-busting the HTML does not
help.** Reloading `bench.html?v=2` is a new document, but the modules it imports
are the *same URLs* and come straight from cache. This looks exactly like a
change that did nothing, and it has cost a wasted hour and one full false
diagnosis in which a working fix appeared to fail catastrophically.

1. **Change the port — to one you have not used yet this session.** A different
   origin is a different cache key and it is the only lever that cannot fail.
   **A port is only cold the FIRST time**; going back to one you loaded from
   earlier re-serves what it cached then, which is the nastiest form of this
   because that port "worked" last time.
2. `arcade/serve.py` sends `Cache-Control: no-store`, which only helps if it was
   set *before* the first fetch. Added to an already-cached response it does
   nothing, because the browser never asks again.
3. `localhost` ↔ `127.0.0.1` is lever 1 by another name.

**Check, do not assume** — ask the running code what it is:

```js
BENCH.machine._loadPrizes.toString().includes('rand()')   // is the fix live?
BENCH.machine.world.colliders.length                      // did geometry change?
```

`Function.prototype.toString` returns the source actually loaded, so it settles
the question in one line. Reach for it the moment a change appears to do
nothing — or appears to do something spectacular.

## What's next

### Track 0 — PLAY THE MACHINES. Every session, before anything else.

Not a chore and not a demo: it is the only test that catches what the bot
cannot. The bots measure whether a cabinet CONVERGES. They cannot tell you
whether it is worth standing in front of, and they have now been wrong about
that four times.

Open `index.html`, walk to a cabinet, press `F` and play it. Then play a
DIFFERENT one, because the floor is a floor and cabinets are judged against
their neighbours.

What playing has caught that measurement did not:

* **シーソー near-tips.** By hand it went past level to +4.2°, slid its cartons
  forward and settled back; again at +9.1°; only the third approach carried it
  over. Nothing in the play count says that, and it is the best thing about the
  machine.
* **リング掛け's coin-flip years.** Every difficulty number on it was honest and
  every one described a cabinet nobody would queue for.
* **メダルゲーム's payout went into a black hole** while its ratio read
  correctly the whole time. Three separate holes came out of looking at the
  cabinet rather than at its numbers, one of them a real bug the payout counter
  actively concealed.
* **シーソー hammered at the nearest carton does nothing** — three plays moved
  the tilt 0.2°. Visible by hand in three coins, not just in a bot's stall count.

Write down what you noticed, in the machine's own file or here. A sentence about
how a cabinet FEELS is worth keeping even before it is a number — several
findings in this file started as one.

Two things about playing in the room specifically:

* The FPS counter lies whenever the browser pane is not frontmost, because
  `requestAnimationFrame` stops — it reported 23 FPS for a floor that renders in
  2.8 ms. Drive `renderer.render` directly if you want a number. This has now
  fooled two sessions, and in an automated pane rAF stops *entirely*: 0 frames
  in 6 s, so nothing advances between tool calls unless you step it by hand.
* To capture a physical moment the render loop will run past it. Freeze the
  cabinet first — swap `machine.update` for a no-op, draw, screenshot, restore.

### Track C — a second floor  ← the live one

The room is signed `CRANE GAME FLOOR · 1F` and the sign is a promise. A real
game centre stacks: cranes and gacha at street level, medal games and the
noisier cabinets upstairs.

This is now the blocking item for the whole non-crane half of the project.
メダルゲーム is finished and has nowhere to stand: all 36 bays are full, and at
~4.5 ms a cabinet a *bank* of pushers does not fit the crane hall's budget.
What it needs:

* a way up the player controller can climb (`player.js` is a flat walker with
  AABB collision — stairs or an escalator is a real change to it; a lift is the
  cheaper honest answer)
* `room.js` generalised from one hall to a storey, so a second is a call rather
  than a copy
* `layout.js` bays keyed by floor, and **the distance gate culling by storey** —
  36 crane worlds cost 3.01 ms and sleep when idle, so a second crane floor is
  nearly free, but a medal floor is not. That cull is the one load-bearing piece
  of this track; the rest is geometry.

### Track A — more machines

None of these share the crane rig. Expect a new mechanism, a new driver, and in
most cases a new room to put it in.

* **More medal games** — a jackpot first (チャッカー gates the medal physically
  falls through, not a scripted bonus), then plinko feeds, slots, horse-racing
  sims with a physical track, bingo.
* **Purikura** booths — a room inside a room: a lit cubicle, a curtain, a
  screen, and a completely different interaction from a two-button gantry.
* **Rhythm** cabinets — the input problem is the whole machine. Timing windows
  and note charts rather than physics.
* **Versus** cabinets — sit-down twins, back to back, with a shared screen.

**Ask what the new machine's NUMBER is before deciding whether an existing
driver fits.** `BenchBot` is not claw-specific — it drives the two-button gantry
contract, and 押し出し reuses it unchanged. メダルゲーム *also* fits that
contract and still needed its own driver, because plays-to-win, carries and
gain-toward-a-goal are all meaningless on a cabinet that pays continuously. What
a driver really encodes is the question you are asking.

Nothing gets tuned by eye in a browser tab, so each new category needs a
headless driver before it needs balance.

## Open threads

* **シーソー must be driven with `patience`, or it looks far worse than it is.**
  `BENCH.bot.play()` in a bare loop always targets the prize nearest the chute,
  which here is whichever carton is furthest forward — often one pinned at the
  reach limit that cannot move at all. Driven that way, 3 sessions in 9 hit a
  50-play cap having won nothing; `session({ patience: 3 })` converges every
  time. Nothing about the machine changed between those measurements. Quote a
  play count off a bare `play()` loop here and it is the driver being measured.

* **ヒモ's last 1-in-18 is unexplained.** The old dead state (cord resting below
  the cutter, unrecoverable) is cured by a threaded guide ring — 18 overlapping
  static spheres forming an annulus on the descending leg, 32 mm hole against an
  18 mm cord. 11-in-18 dead → 1-in-18, and 12 → 16 wins in 18. That last one is
  not diagnosed.

  Nine measured dead ends, recorded so they are not retried: lengthening the
  blade in Z; `prongYaw: 0`; divider-under-blade + short prongs + raising the
  assembly; cheek plates covering only the blade; symmetric alternating link
  sweeps; deepening the pan; extra link-only position sweeps (link position
  correction must ALWAYS stay interleaved with the contact pass); and the near
  miss — extending the wall up to the blade so no path under it existed, which
  still left the cord off the blade 5 times in 18 and made the machine trivial
  (median 1 play). Blocking one route out is not the same as having no route out.

  Results swing on small samples; 18 sessions minimum.

* **大型: the bar's height is load-bearing and unexplained.** Raising the bar
  100 mm and the claw's `headMin` by the same 100 mm — every relative distance
  unchanged — took it from a median of 13 plays to *not one win in twenty
  sessions*, the prize moving ±2 mm a play. Reverting restored it exactly. Left
  at the height that works. Worth chasing: it probably means something in the
  rig or the solver depends on absolute height in a way nothing else has
  exposed.

* **三本爪 has no near-miss.** The plush that clears the rim and is lost halfway
  home — the emotional point of the format — does not happen. 72 plays gave 8
  wins, 5 nudges, zero halfway-then-dropped. Grip is a friction threshold
  against a constant load, so a hold that survives the first centimetre survives
  all of them. `holdScale` was added to attack this and did not fix it. Needs
  something that varies *during* the lift; the cable swing on the return is the
  obvious candidate and is far too gentle to break a grip.

* **三本爪 aim barely matters.** Medians of 6, 3 and 5 plays at 8, 20 and 40 mm
  of jitter are within run-to-run noise. Outcome is dominated by which prize you
  pick and how the pile sits. Arguably true to the format, but the machine does
  not reward precision.

* **スライダー: dead-centre aim creeps backward** at −5 to −7 mm per play.
  Off-centre (human) aim progresses forward normally so the machine plays
  correctly, but this is an unexplained physics result, not a difficulty choice.

* **スライダー difficulty is wide** — five sessions gave `>45, 24, 31, 32, 1`.
  Median ~30 is defensible for a slider; the variance is not understood.

* **橋渡し is calibrated to a skilled player** (5 plays). A casual bridge in real
  life is a 20-play grind. Push it out if that matters.

* **メダルゲーム's payout ratio has moved twice under changes not aimed at it**
  — 0.561 → 0.661 across the sleep fix, 0.661 → 0.617 when lost medals were made
  to persist. Same 180-coin, 6-seed measurement each time. The second step is
  ~1.2 standard errors and is noise; the first is bigger and has a plausible
  story (a sleeping carpet is a rigid mass that transmits the pusher's shove,
  where a jittering one absorbs it) that has not been demonstrated.

* **メダルゲーム has no jackpot**, and a real medal floor is mostly jackpot.
  Worth doing as a gate the medal physically falls through rather than as a
  scripted bonus, in keeping with everything else here.

* **メダルゲーム is authored to the 0.98 × 0.92 crane bay** like everything else,
  and a real pusher is substantially bigger. The right call for a first one, but
  a scale compromise.

* **The room is not wired for メダルゲーム**, deliberately. `layout.js` has no
  `medal` family; `play.js`'s `PHASE_HINT` has no `aim` entry and its `drop`
  entry says "descending…", which is a claw, not a chute. Both belong to
  mounting it — and wiring a room for a cabinet with nowhere to stand is how
  dead code starts.

## How to prove a change did not break a machine

Re-measuring the play count proves nothing: a claw machine is chaotic enough
that two runs of the *same* build diverge.

1. **Compare the mechanism with no prizes.** `new Machine({ prizes: 0 })` leaves
   the world with no bodies, so the claw is fully deterministic. Step both
   builds side by side and compare gantry, hoist, cable swing, resist, prong
   angles, tip positions and the hub every frame. The `claw2` port came out at a
   maximum absolute difference of **0** over 468 frames.
2. **Then compare whole machines from an identical pile.** Construct both,
   restock under a seeded RNG, drive both with the same aim numbers.
3. **Always run the control**: the same test against two instances of the OLD
   code. If the control diverges, the test is measuring the harness. Two
   harnesses were thrown away this way before one worked, and the control is
   what exposed 二本爪's unseeded restock.

For a SOLVER change, fingerprint the numbers rather than the play. A fresh
machine stepped a fixed number of substeps with no input is fully deterministic:
`Link`'s anchor-offset work was checked on ヒモ's 13 bead positions and 13 link
tensions after 600 substeps, identical to nine decimal places, and the sleep fix
was checked the same way across all ten gantry cabinets — seven came out
bit-identical, which is what bounded its blast radius to the two that did not.

For an ADDITIVE change — a new option whose default reproduces the old literal —
`BENCH.bot.session({ seed, jitter: 0 })` is fully deterministic. Record the trail
on two seeds before the edit and require it back afterwards. Its control is free:
running it twice on unchanged code must agree exactly, and it must survive an
intervening session on a different seed.

**When a change legitimately alters trajectories, pair it PILE BY PILE.** A
before/after difference in win rate on a chaotic machine is almost all noise,
and averaging more replicates does not fix that — it is the wrong experiment.
Put a temporary toggle on the old behaviour, run the same seeded piles through
both at `jitter: 0` so each pile gives one deterministic outcome, and count
discordant pairs. On 二本爪, 60 piles: 51 identical, and the 9 that differed
split 5 to the old rule and 4 to the new — a null result no amount of aggregate
sampling had been able to produce. Take the toggle out afterwards.

Two traps, both of which produced convincing false regressions:

* **Seeding `Math.random` at construction does not give both builds the same
  pile.** three.js draws on it for object UUIDs, so a build creating a different
  number of meshes consumes a different amount of the stream. Seed around
  `reset()`, where both builds run identical code. Beware texture caches too:
  the first build of a machine populates them and later ones do not, which
  shifts the stream again.
* **Copying prize positions across is not enough.** Each pile carries the
  warm-start impulse cache it accumulated during its own settle, which is not in
  `pos`/`quat`/`vel`. Two piles that look identical still diverge.

## Gotchas that will bite a fresh session

Each of these is a bug that already cost real time. All are also commented at
the site in code. This list is the most valuable thing in the file.

1. **Contact normals always point toward body `a`.** Reverse it and bodies
   attract instead of repel.
2. **`Arm` angles integrate AFTER `World.substep()`, never before.** Advancing
   first lets a prong sweep through a prize and only then have its velocity
   cancelled — it passes clean through whatever it hits.
3. **Never build a box from eight corner spheres.** Use `boxCluster()`. On
   anything longer than a cube the corners do not meet and a prong passes
   through the gap.
4. **Seed prizes inside the container profile.** A body seeded intersecting
   geometry gets ejected at speed by the position solver.
5. **Machines own their physics world in LOCAL space.** Model contract: base on
   `y = 0`, front facing `+Z`, centred in X/Z.
6. **A settle-pause before the claw descends makes the slider worse** (23 → 45+
   plays). Already tried; the residual cable swing is load-bearing.
7. **A claw grips by GEOMETRY long before it grips by friction.** If a prize
   fits inside the closed hooks, or the open hooks curl in far enough to stop it
   falling back out, the prize rides home on the metal and the grip setting is
   irrelevant — 三本爪 was won in 1 play at a twentieth of its final motor
   strength this way, twice, for two different reasons. Check the clear diameter
   at the tips AND the elbows, open and closed. A lone sphere nests perfectly.
8. **Settle the pile, then check the chute.** Prizes drift a long way while a
   pile settles — one landed in the chute during setup and was handed out before
   any coin. `claw3.js` re-seeds anything ending the settle below the deck.
9. **Do not hand-test in a browser tab.** It throttles the moment it loses focus.
   Use the bots.
10. **A ring threaded on a bar is only as threaded as the timestep.** A ring
    sphere travelling further than its own radius in one substep passes straight
    through the bar. Measured threshold 5.0 m/s against a 0.3 m/s mechanism.
    Check it again if 大型's ring is ever made finer.
11. **Test the win on the quantity that actually defines it.** 大型's prize is
    won when the ring leaves the bar. A height threshold generous enough to
    catch a fallen prize also catches one still hanging at the low end — 130 mm
    apart — and the cabinet paid out on the first coin.
12. **A `Link` must wake the bodies it pulls on.** Contacts wake bodies through
    the kinematic check; links needed their own, and without it a shock-stretched
    cord fell asleep 32% over-length and stayed that shape for ever. Any new
    constraint type needs the same.
13. **Rope length-projection is not safe on a draped cord.** Clamping link
    lengths after integration does make a cord inextensible, but it is blind to
    collisions: applied to a cord resting on something it straightens the cord
    and pulls it off.
14. **`Link` compliance replaces the warm-start DECAY, not the warm start.**
    Textbook XPBD resets the multiplier every substep — correct for a
    position-based solver, wrong here. Reset it and a 13-link cord hangs at 97%
    stretch. But warm starting undecayed with compliance 0 ratchets instead of
    settling — 280 N under a 3.4 N load. Undecayed warm start **plus** a small
    non-zero compliance is the combination that works.
15. **An `Arm` angle advances at HALF the rate its `avel` implies.** The motor is
    driven once per SUBSTEP but `integrateHinges` runs once per FRAME, and a
    1/60 frame is two 1/120 substeps. Any `closeTime` sized off `avel` is half
    what it needs to be. On リング掛け the claw hooked on the way UP, which won
    more often than hooking properly did — so it read as the machine being easy
    rather than the close being short. Size `closeTime` against the measured
    angle, never against `w0`.
16. **The claw's reach band is not flat, and where in it you land matters.** A
    hook's tip crosses a target's plane at a height that depends how far through
    the sweep it gets there — on リング掛け that varies 9 mm across the usable
    band and peaks 35–40 mm out from the axis. Put the target at the inner end
    and the claw arrives at full stretch, at the wrong height, and jams. It
    reads as an aim problem on the other axis entirely.
17. **An `Arm`'s joint limits cannot carry load.** They are applied when the
    angle is integrated, AFTER the solve, so the solver never knows they are
    there: an arm resting on a limit is, to every contact, free to rotate. On
    シーソー a box on a level platform slid backwards at 50 mm/s off the back
    edge. A passive hinge that must HOLD something has to be sprung, not
    stopped. Same box, same platform: 3 mm of drift instead of 240.
18. **A linear spring has no tipping point.** It resists in proportion to the
    angle in BOTH directions, so the settled angle tracks the load's moment
    whichever side of the hinge it is on. A CONSTANT counterweight torque is
    what makes a threshold, with a stiff one-sided spring as the pad it rests on.
19. **A retaining wall has to clear the PRIZE, not just look like a wall.**
    シーソー's 70 mm lip against a 90 mm carton let one over about once in 18
    sessions, into a dead zone nothing could reach. The lost prize is the smaller
    half of the damage — the bigger half is that the bot keeps cycling onto it
    and the session reads as a difficulty stall. Walls are now 105 mm.
20. **A claw that opens with a prize on it needs its own opening torque.**
    Driving the prong motor at the *hold* setting while opening stalled
    リング掛け's claw part way open with the prize still on it. `releaseScale`
    fixed it: 7 in 130 → 0 in 130. It only ever showed on a SLOPPY catch — at
    tight aim it was 0 in 130. A fault that hides at the aim you happen to be
    measuring at is worth remembering.
21. **The carriage must reach every point a prize can occupy.** Easy to miss
    when travel limits are set from the claw's comfort rather than the
    playfield's width. On 押し出し a ±0.300 gantry against a 0.360 shelf left one
    carton parked against the wall after a 120-play soak, 60 mm from the lip and
    unwinnable. Check by emptying the whole cabinet, not by playing to first win.
22. **`setPos` positions the CENTRE OF MASS, not the model origin.** `Body`
    re-centres its cluster on the COM, so a part authored at the local origin
    ends up `-comOffset` away. Get the sign backwards and the prize seeds a
    whole body-length out of place.
23. **A void modelled as a solid is invisible until something has to be inside
    it.** メダルゲーム's payout well was a dark box — identical from outside to a
    hollow one, and it filled the volume the medals land in, so a tray holding
    fourteen rendered as a flat black slab. Diagnosed by raycasting camera →
    body and reading back what was in the way: three hits, none of them the
    medal. That is the cheap test whenever something simulates correctly and
    cannot be seen.
24. **A cage that starts at the glass line leaves the cabinet open underneath.**
    メダルゲーム's cage begins at y 0.59, fine for a playfield at 0.70 and wrong
    for a tray at 0.36: the well's front and both sides were open air, and a
    medal that bounced on landing left the machine. Anything below the glass
    needs its own box.
25. **Scenery is not a collider, and the gap will hide behind a completed
    event.** The wall under メダルゲーム's field lip existed only as a mesh, so a
    medal could cross the lip, be counted as paid, then drift back *under* the
    deck and fall out. Invisible to every statistic the cabinet reports, because
    a paid medal has stopped being watched. When an object leaves a machine's
    normal accounting, keep counting it anyway — `escaped` is what found this.
26. **`wake()` resets `sleepT`, so waking a neighbour restarts its clock too.**
    The old rule woke BOTH bodies of an awake/asleep pair, so the first body in
    a pile to fall asleep knocked every neighbour's timer back to zero — a pile
    could only sleep if all of it crossed the threshold on the same substep, and
    none ever did. Settled piles stayed awake for ever, 三本爪 and 二本爪
    included. **Anything that calls `wake()` is resetting a timer, not just
    setting a flag.**
27. **Sample a body's stillness BEFORE the gravity increment, never after.**
    `substep` applies gravity at the top, before `buildContacts`. Ask "is this
    body still?" inside `buildContacts` and the answer is no for a settled pile
    standing motionless, because it carries 0.082 m/s its contacts have not
    cancelled — four times the 0.02 m/s threshold. This silently defeated the
    first version of the sleep fix: the rule looked right, read the right field,
    and fired on every pair anyway. `Body.quiet` exists for this.
28. **A machine that reaches for `Math.random()` cannot be measured.** 二本爪
    stocked its field that way and was the only cabinet whose *same seed*
    produced a different pile every build — so it had no control, and
    `session({ seed })` did not control the pile it measured. Use the house
    `rng(this.opts.seed * 977 + 13)`. The tell is cheap: build the same machine
    twice and compare.
29. **An object deleted on contact hides every geometry fault beyond that
    point.** メダルゲーム deleted a lost medal 60 mm into a 140 mm drop, so it
    never reached the gutter. That concealed two holes for the cabinet's whole
    life — the channel had no end (medals slid forward into the payout tray, the
    machine paying out what it had just taken) and no inboard wall. Both
    appeared within 90 coins of making lost medals persist.
30. **Do not anchor a HUD prompt to the crosshair.** The crosshair is on the
    machine, so the prompt is on the machine. Measured, every cabinet's action
    zone straddles the centre of the frame (0.35–0.64) from where a player
    actually stands. Screen-anchor anything persistent; the centre belongs to
    the thing being played.
31. **`seeds` in `bot.rate()` is the PILE COUNT.** With a seeded restock,
    `rate({ n, seeds })` samples exactly `seeds` layouts, and a small value
    measures those layouts rather than the machine. Measured on 二本爪, same
    build: `seeds: 4` read 0.438, `seeds: 24` read 0.209.
32. **An aggregate win rate cannot detect a small change on a chaotic machine.**
    二本爪 read 0.313 → 0.260 across the sleep fix and that looked like a
    regression for two sessions; paired pile by pile it is 51 of 60 piles
    identical and the rest 5–4, i.e. nothing. The aggregate was never going to
    settle it at any sample size, because pile-to-pile variance swamps the
    effect. Pair the experiment instead of enlarging it.

## How to test a machine

`BenchBot` drives any two-button gantry cabinet headlessly:

```js
BENCH.bot.session({ seed: 0, cap: 60 })   // plays until something drops
BENCH.bot.rate({ n: 60, seeds: 24 })      // win probability from a full cabinet
BENCH.bot.play({ pull: 0.05 })            // one play, aimed to drag a prize inward
BENCH.bot.play({ timing: 0.060 })         // aim error as release timing, not metres
```

**Tune against `rate()`, not `session()`.** Plays-to-win from an evolving pile is
dominated by how the pile happens to break; the single-play win rate from a fresh
restock responds cleanly to a change. Take 18 sessions minimum before quoting a
number — these machines swing hard on small runs.

`timing` is the same error in seconds rather than metres, converted with the
gantry's own speed — the honest form for a two-button cabinet, and the only one
that means anything if a machine sets a non-default `moveSpeed`. At the standard
0.34 m/s the two agree exactly (±20 mm ≡ ±59 ms). Coast is derived the same way:
**coast = 0.1167 × MOVE**, measured. Left at the old fixed 0.042, a 1.1 m/s
cabinet would overshoot 90 mm every play.

Two things the bot must get right, both of which cost real time: the gantry
coasts ~42 mm past the point a button is released, and each aim phase only
advances once its button has actually been pressed — a bot that never taps sits
there until the 20-second timeout.

`BENCH.look(az, el, dist, targetY)` snaps the camera.

### Testing メダルゲーム specifically

`BENCH.bot` is `PusherBot` there, and the question is different:

```js
BENCH.bot.drop({ timing: 0.055 })          // one coin
BENCH.bot.session({ seed: 0, coins: 30 })  // a stack; returns the payout ratio
BENCH.bot.rate({ seeds: 6, coins: 30 })    // ratio across fresh cabinets
```

* **Equilibrium first, ratio second.** A pusher below its steady state absorbs
  coins while the field fills, and the ratio then measures the priming. Same
  build: 0.24 over the first 25 coins from a light stock, 0.68 once settled. The
  cabinet runs itself in at construction, but if you change the stock or the
  geometry, re-find the steady state before quoting anything.
* **in = out + lost + Δfield, always.** If a change moves the ratio, check which
  of the other terms moved. A flat field measured 1.000 and that was not a bug —
  it was the machine having nowhere else to put a medal.
* **A 30-coin session takes ~25 s of compute** at ~120 bodies and will blow a
  console timeout. Reset, then feed in chunks of 15.

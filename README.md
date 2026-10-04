# ゲームセンター — arcade floor

A working game centre: a room shell with all 36 machine bays filled by real,
physically-simulated cabinets — nine crane settings plus the gacha banks — and a
メダルゲーム coin pusher on the bench, the first machine here that is not a
crane at all.

## Run

```bash
python3 -m http.server 8777 --directory ~/Documents/claude
```

Then open <http://localhost:8777/arcade/index.html>. A server is required — the
project is ES modules, which browsers refuse to load over `file://`.

**If you are editing a machine rather than looking at the room, use
`arcade/serve.py` instead** — it is the same thing with `Cache-Control:
no-store`, which stops the browser serving you the previous build of a module
you just changed. See STATUS.md; this has cost real time twice.

```bash
python3 arcade/serve.py ~/Documents/claude 8777
```

## Controls

| | |
|---|---|
| `W A S D` | walk (yaw-relative) |
| mouse | look — click once to capture the pointer, `Esc` releases |
| `Shift` | run |
| `V` | toggle walk / overview camera |
| `G` | toggle the machine-bay overlay |
| `F` | insert ¥100 into the cabinet you are standing at |
| hold `LMB` | button ➊ — track right, release to lock that axis |
| hold `RMB` | button ➋ — track back, release and the machine takes over |

Walk up to any cabinet and it becomes the one you are playing — a prompt names
it and tells you what the machine wants next. Walk away and it hands control
back. Every one of the 36 is live: the same physics as the bench, driven through
the same `insertCoin` / `pressA` / `pressB` the bench uses, just with a
different input device.

**The room picks the cabinet, not the part.** The bench clicks a coin slot
directly; that does not survive first person, where a slot is 55 mm across at
1.3 m and needs the crosshair held inside 2.5° on top of a walk controller —
measured, aiming at one from a sensible standing position missed by 180 mm. The
room selects whichever cabinet you are close to, in front of, and roughly
facing, and at 1.04 m of pitch there is never more than one of those.

The two buttons are on the mouse because the keyboard is already the walk
controller — `player.js` owns WASD and takes the arrow keys as well.

Overview strips the ceiling off and reads as a floor plan; drag to orbit,
wheel to zoom.

## Files

| file | role |
|---|---|
| `src/main.js` | renderer, environment map, lights, camera modes, loop |
| `src/room.js` | hall shell — floor, walls, ceiling rig, entrance, signage |
| `src/fixtures.js` | gacha banks, prize shelving, counter, change machines |
| `src/layout.js` | **the bay system** — floor plan + `mount()` |
| `src/player.js` | first-person walk controller + AABB collision |
| `src/kit.js` | shared builders, materials, geometry batching |
| `src/textures.js` | every texture, drawn procedurally on canvas |
| `src/physics.js` | **rigid-body engine** shared by all machines |
| `src/machines/capsule.js` | ガチャガチャ — 65 mm capsule machine |
| `src/machines/clawrig.js` | shared crane rig — gantry, cable, prongs, play cycle. Used by all eight cranes |
| `src/machines/claw2.js` | 二本爪 — two-prong UFO catcher |
| `src/machines/claw3.js` | 三本爪 — three-prong plush catcher |
| `src/machines/clawbig.js` | 大型 — big-prize cabinet, tag setting |
| `src/machines/himo.js` | ヒモ — string-cut setting |
| `src/machines/bridge.js` | 橋渡し — bridge setting |
| `src/machines/slider.js` | スライダー — slider / rail setting |
| `src/machines/ringhook.js` | リング掛け — ring-hook setting |
| `src/machines/seesaw.js` | シーソー — balance setting |
| `src/machines/push.js` | 押し出し — push setting, and its own `PushRig` |
| `src/machines/medal.js` | メダルゲーム — coin pusher, and its own `PusherRig`. Not a crane |
| `src/play.js` | playing the cabinets from inside the room |
| `bench.html` + `src/bench.js` | single-machine test bench |
| `serve.py` | no-store static server — use it when editing, not `http.server` |
| `src/bot.js` | headless drivers — `BenchBot` for the gantry cabinets, `PusherBot` for メダルゲーム. Every difficulty number below came from them |

No external assets — all art is generated at runtime.

## Machine bench

The bench builds one machine on its own, away from the room, for tuning and
play. `?m=` picks which:

* <http://localhost:8777/arcade/bench.html?m=capsule> — ガチャガチャ
* <http://localhost:8777/arcade/bench.html?m=claw2> — 二本爪
* <http://localhost:8777/arcade/bench.html?m=claw3> — 三本爪
* <http://localhost:8777/arcade/bench.html?m=clawbig> — 大型
* <http://localhost:8777/arcade/bench.html?m=himo> — ヒモ
* <http://localhost:8777/arcade/bench.html?m=bridge> — 橋渡し
* <http://localhost:8777/arcade/bench.html?m=slider> — スライダー
* <http://localhost:8777/arcade/bench.html?m=ringhook> — リング掛け
* <http://localhost:8777/arcade/bench.html?m=seesaw> — シーソー
* <http://localhost:8777/arcade/bench.html?m=push> — 押し出し
* <http://localhost:8777/arcade/bench.html?m=medal> — メダルゲーム

`G` draws every collider; `CUTAWAY` hides the shell so the mechanism is visible;
`R` restocks.

### Measuring a machine

Do not hand-test a claw machine in a browser tab — the tab throttles as soon as
it loses focus and you end up measuring the scheduler. `BENCH.bot` drives the
machine directly at a fixed 1/60 instead:

```js
BENCH.bot.session({ seed: 0, cap: 60 })   // plays until something drops
BENCH.bot.rate({ n: 60 })                 // win probability from a full cabinet
BENCH.bot.play({ pull: 0.05 })            // one play, aimed to drag a prize inward
```

`rate()` is the one to tune against. Plays-to-win from an evolving pile is
dominated by how the pile happens to break, so it moves a lot between runs;
the single-play win rate from a fresh restock responds cleanly to a change.

**`seeds` is the pile count, not a convenience knob.** Every machine restocks
from a seeded RNG, so `rate({ n, seeds })` samples exactly `seeds` distinct
layouts and a small value measures *those layouts* rather than the cabinet.
Measured on 二本爪, one build, two settings: `seeds: 4` read 0.438 and
`seeds: 24` read 0.209.

`timing` is the same aim error stated in seconds of release timing rather than
metres, converted with the gantry's own speed — the honest parameterisation for
a two-button cabinet, and the only one that means anything if a machine changes
`moveSpeed`. At the standard 0.34 m/s the two agree exactly (±20 mm ≡ ±59 ms),
so nothing already measured moves.

The gantry's coast is derived from that speed too. 0.042 m is the measured coast
for the standard gantry and is kept verbatim so every published number still
reproduces; other speeds get the measured linear form, **coast = 0.1167 × MOVE**
(0.34 → 0.0397, 0.55 → 0.0642, 0.80 → 0.0933, 1.10 → 0.1283). Left at the
constant, a 1.1 m/s cabinet would have the bot overshoot by 90 mm every play.

The bot works on every crane cabinet, and on 押し出し, which has no claw at all —
what it actually drives is the two-button gantry, not the claw, so any mechanism
exposing `phase`/`gx`/`gz`/`cfg.limX…` runs on it unmodified. `capsule` has no
`BENCH.bot` — it is a gacha machine, not a crane.

メダルゲーム gets a different driver, `PusherBot`, and the reason is the
statistic rather than the controls — its button grammar is the floor's. A pusher
pays continuously and never empties, so plays-to-win is meaningless on it:

```js
BENCH.bot.drop({ timing: 0.055 })         // one coin, aimed at the leading edge
BENCH.bot.session({ seed: 0, coins: 30 }) // a stack of coins; returns the ratio
BENCH.bot.rate({ seeds: 6, coins: 30 })   // payout ratio across fresh cabinets
```

**Never quote a ratio from an unequilibrated cabinet.** A pusher below its
steady state absorbs coins while the field fills — the same build read 0.24 over
its first 25 coins from a light stock and 0.68 once settled. A 30-coin session
also takes roughly 25 s of real compute at ~120 bodies, so it will not fit in
one console call the way a crane session does.

## The physics engine

`src/physics.js` is the solver from the standalone claw machine, generalised:
sphere-cluster bodies, sequential impulses with clamped accumulation, two-axis
Coulomb friction, warm starting, split-impulse penetration recovery, and
velocity-threshold sleeping. Static geometry is described by colliders exposing
`collide(centre, radius, out[])`; kinematic ones add `pointVel()` so moving
surfaces drag bodies along. Built-ins: plane, oriented box, capsule, sphere
shell (with an openable bottom), cone funnel, post. Machines subclass
`Collider` for their own mechanisms.

**Normals always point toward body `a`.** Reversing that makes bodies attract.

**Sleeping.** A body whose linear and angular speed stay under `sleepLin` /
`sleepAng` for `sleepTime` stops being integrated. Two rules keep that honest,
and both were got wrong first:

* A sleeping body is woken by a neighbour only when that neighbour is **actually
  moving**, judged by the same stillness test the integrator uses — and only the
  sleeper is woken. Waking both, as this used to, meant `wake()` reset the
  *neighbour's* `sleepT` as well, so a pile could only ever sleep if every
  member crossed the threshold on the same substep. In practice none did, and
  settled piles stayed awake indefinitely: 三本爪 held 5 of 8 prizes awake
  through 2400 substeps at 0.0003 m/s against a 0.02 threshold.
* Stillness is sampled into `Body.quiet` at the top of `substep`, **before the
  gravity increment**. Sampled anywhere later it is meaningless — every awake
  body is carrying 0.082 m/s of uncancelled gravity by the time contacts are
  built, four times the threshold, so a motionless pile reads as moving.

Bodies resting on a *kinematic* collider are woken unconditionally, whether or
not it is moving. That is deliberate and is what lets a claw pick up a sleeping
prize; the cost is that シーソー's cartons never sleep.

`Arm` is a one-degree-of-freedom hinge solved in reduced coordinates. Attach one
to a collider and the solver treats it as a body with real rotational inertia
about its pivot: the contact's effective mass gains an `(axis × r)² / I` term
and every impulse feeds back into the arm's angular velocity. That is what makes
a claw prong stop dead on a prize instead of sweeping through it — with the
caveat that the angle must be integrated **after** `World.substep()`, never
before.

`Body` takes an optional `mass` to override the density estimate; a sphere
cluster's summed volume is a poor proxy for a box that is mostly air.

`Link` is a distance constraint between two body centres, or between a body and
a fixed world point — a chain of them is a cord, and that is all ヒモ's string
is. Anchors sit at body centres by default: it drops every rotational term out
of the solve, which for a 36 mm bead costs nothing and buys enough stiffness to
hang a prize off. `ra` / `rb` opt into **local anchor points** on either body
instead, which makes it a proper distance joint — the rotational terms come
back, an impulse torques the bodies it acts on, and two side by side make a
hanger that can swing but cannot yaw. Added for リング掛け's hanging-tab
experiment; the experiment was reverted and the feature kept. The offsets are
optional and the centre-anchored path is arithmetically untouched, verified by
fingerprinting ヒモ's cord — 13 bead positions and 13 link tensions identical to
**nine decimal places** after 600 substeps, and that fingerprint reproduces
exactly across two fresh builds, so the control is free. `rope: true` resists stretching only. Links are solved INSIDE
the contact iteration rather than after it, because a cord is a series chain and
a separate pass propagates tension one link per outer iteration — a hanging
prize visibly sags and bounces. `tension` is left in newtons for machines to read.

A stretched link wakes both its bodies. Contacts get this via the kinematic
check; links needed their own, and without it a shock-stretched cord fell asleep
32% too long and stayed that shape for good.

`compliance` is XPBD's inverse stiffness, in metres per newton — α̃ =
compliance/dt², folded into the effective mass. The `−α̃λ` term is a
**regulariser**, and that is what it is here for: it pulls the accumulated
impulse back toward the compliant solution every iteration instead of letting it
grow. Without it, an undecayed warm start ratchets — a 3.4 N load reported 280 N
of tension. Two things about it are counter-intuitive and both were measured the
hard way:

* **Do not reset λ per substep**, as textbook XPBD does. That is right for a
  position-based solver with many substeps; this is a velocity-level solver
  where warm starting is what carries a chain's tension from substep to substep.
  Reset it and a 13-link cord hangs at **97% stretch** — twice its length.
* **Do not leave compliance at 0 on a loaded link.** There is then no
  regulariser and an undecayed warm start, which is exactly the ratcheting
  combination.

Compliance replaces the decay fudge; it does not replace the warm start. At
5e-6 a 12-link cord hangs a 350 g prize at 17% stretch with correct tension, and
recovers completely from a 4.5 m/s shock.

`ClawRig` takes an optional `holdScale`: the fraction of the prong motor torque
left once the claw stops closing and starts moving. Real prize machines set the
close and the move strengths separately. It defaults to 1, so a cabinet that
does not opt in is bit-for-bit unchanged — verified by A/B on 橋渡し.

`boxCluster(half, r)` builds the sphere cluster for a boxed prize. Use it rather
than eight corner spheres: on anything longer than a cube the corner spheres do
not meet in the middle and a claw prong passes clean through the gap. It lays
out an overlapping shell grid instead.

## Capsule machine (ガチャガチャ)

A 65 mm commercial single-window unit. The mechanism is simulated, not animated:

    globe ──► funnel ──► rotating drum with ONE cup ──► chute ──► tray

Turning the crank rotates a drum on a front-to-back axis. Its single cup starts
loaded under the funnel; the capsule rides round, stays put while the cup is on
its side (gravity is perpendicular to the cup axis), and only falls free once
the cup passes horizontal. Nothing is teleported and there is no dispense timer.

Four geometry constraints make it work — each one was a jam until it was fixed:

* the globe must **open** into the funnel throat, or the pile rests on a sealed
  sphere floor and never reaches the mechanism;
* the throat must be narrow **at the height the lowest capsule rests**, or the
  capsule perches on the cone wall beside the cup;
* the drum must be large enough for a cup deep enough to swallow a capsule
  flush, and high enough that a released capsule lands clear of its own sweep —
  otherwise the cup scoops it straight back up;
* the rotor carries an **agitator lip** a quarter-turn ahead of the cup. Without
  it the pile bridges across the throat after a couple of plays and the machine
  jams solid, exactly as a real hopper does.

Verified at 16 consecutive plays: exactly one capsule per turn, no jams, no
double-dispense.

At ~62 cm the cabinet is taller than the 45–55 cm most sources quote. That is a
consequence of honest scale: a 65 mm capsule is a quarter of the machine's
width, so a hopper that holds a believable load and a funnel steep enough not to
bridge simply need the height.

## Adding a machine

`src/layout.js` reserves 36 bays. Each has an id, a footprint, a facing, and an
intended family:

| family | bays | where |
|---|---|---|
| `claw-2arm` | 14 | front rows of both islands (`AF1‑7`, `BF1‑7`) |
| `claw-3arm` | 7 | island A back row (`AB1‑7`) |
| `claw-bridge` | 7 | island B back row (`BB1‑7`) |
| `claw-big` | 8 | east wall row (`E1‑8`) |

The floor plan itself is `PLAN` at the top of `layout.js`, one entry per bay,
and `main.js` builds and mounts a real machine for every one of them at startup.

To drop one in by hand:

```js
bays.mount('AF1', machineObject3D, { fit: false });
```

`fit: false` because every machine here is already authored to the reserved
footprint; the fitter exists for cabinets built at some other scale.

The object must be authored with:

* its base sitting on **y = 0**
* its front facing **+Z**
* centred on the origin in **X / Z**

`mount()` uniformly rescales it to the reserved footprint by default
(`{ fit: false }` opts out) and re-seats it on the floor afterwards, so a
cabinet authored at any scale drops in correctly. The proxy cabinet for that
bay disappears and the remaining proxies are re-merged.

`bays.unmount(id)` puts the proxy back. `bays.byKind('claw-2arm')` lists the
bays reserved for a family.

`window.ARC` exposes `THREE`, `scene`, `bays`, `player`, `setMode`, and `look()`
for poking at the floor from the console.

## Performance notes

* The scenery is static, so `kit.js` `Batch` merges it into one mesh per
  material — roughly 1200 draw calls down to ~150, before any machines exist.
  Bay proxies re-merge on mount/unmount, which only happens at setup.
* Every capsule in every gacha unit is a single `InstancedMesh`.
* No real-time shadows. The room is lit by a bright ambient/hemisphere base, a
  baked arcade environment map (which is also what stops the metal surfaces
  rendering black), and unshadowed point lights for colour pooling. Contact
  darkness under fixtures is a cheap blob decal.


## Two-prong machine (二本爪)

A 98 cm cabinet that drops straight into a `claw-2arm` bay — no rescaling.

Two-prong cabinets are stocked with **boxed** prizes and the prongs are broad,
rigid and 180° apart. You rarely lift a box clear; you wedge, shove and topple
it across the deck over several plays until it goes down the chute. The build
makes that the actual strategy rather than a story:

* prizes are rounded cuboids — eight spheres at the inset corners, so they rest
  on four points, stack, and tip over an edge the way a box does;
* each prong is a `physics.Arm` with real inertia on a geared-motor torque
  curve. A box they cannot close around stops them dead, and the two prongs
  routinely end a grab at *different* angles because they are independently
  blocked;
* the head hangs on a damped-pendulum cable, so a fast gantry move leaves it
  swinging and your aim drifts;
* the hoist slows against contact reaction, so the claw settles onto a prize
  instead of driving through it.

**Controls are the authentic two-button scheme.** Hold ➊ and the claw tracks
right; release and that axis locks. Hold ➋ and it tracks back; release and the
machine takes over — descend, close, lift, return. No joystick, no second
chance. Each aim phase commits on the *release* of its button.

Measured over 14 plays with naive aiming: **4 wins**, with the distance from the
target box to the chute visibly shrinking across plays (0.29 → 0.22 → 0.15 →
win). Bad grabs push boxes the wrong way, and prizes sometimes fall in because
the claw knocked a *neighbour* over the lip.


## Three-prong machine (三本爪)

The machine everyone pictures when they hear "claw machine", and the only
cabinet on this floor where **lifting** the prize is the plan rather than the
fantasy. Prizes are plush — sphere clusters of two to five spheres, so they
nest into a pile, roll off each other, and can be hooked by an ear.

Three numbers decide everything, and all three were found by measurement rather
than by choosing them:

| | |
|---|---|
| **claw span vs prize** (226 mm open, prizes 155–240 mm) | the ratio a real cabinet runs. It is the difficulty, more than the motor is |
| **close grip** (0.42 N·m) | strong enough to take a firm hold of anything on the deck |
| **hold grip** (32 % of it) | what is left once the claw starts moving, and deliberately below what most of the stock weighs |

The split between close and hold is a real setting on a real prize machine
(爪の強さ is configured separately for the close and for the move), and it is
what makes this cabinet a cabinet: the claw grips confidently and then has to
survive the trip home.

### What the measurements actually taught

Three separate versions of this machine were trivially winnable, each for a
different reason, and each is now a comment at the site in the code:

* **the prizes were too small.** At a 130 mm plush against a claw closing to a
  100 mm cup, the three hooks simply cradled everything — 1 play to win at any
  motor strength, including a twentieth of the final one. The load was carried
  by geometry and never touched the grip at all. Prizes are on one
  `PLUSH_SCALE` knob now, and it is set so the claw has to actually grip.
* **the hooks curled too far.** With a 36 mm inward curl the *open* claw was
  already a basket — its tips nearer the axis than its elbows — so a prize that
  dropped in could not fall back out. Prizes came home with the prongs still
  sitting at their open stop, never having closed. The hook is a shallow J now,
  and open it is a slightly diverging cone.
* **the round cushion was a sphere.** A lone sphere nests perfectly into three
  closing hooks; stocked near the chute it was carried home on the first coin
  in five sessions out of eight, despite having the lowest friction in the
  cabinet. Roundness is what makes a prize easy here, not hard. It is a 240 mm
  floor cushion now — wider than the claw opens, so it cannot be lifted at all,
  only shoved. It is the cabinet's bait, and honestly so.

Two smaller ones: the deck is matted (μ 0.70, not the two-prong's 0.42) because
at the slick value a stalled prong could shove a plush 180 mm in one play, and
the chute has a 30 mm kerb because without it a third of all wins arrived with
nothing ever leaving the deck.

### Stocking

Prizes are laid out by `mass / friction` — the grip each one needs before it
can be lifted, which spans nearly 3× from the fleece star to the satin jumbo
cushion. The awkward stock goes nearest the chute and the light grippy stock
goes to the back of the field. Stocked at random, a quarter of all sessions
ended on the first coin because the easiest prize in the cabinet happened to be
sitting on the edge of the hole. Operators do this for the same reason.

### Measured

32 bot sessions, restocked between each, every one of them converging:

    5 7 7 10 11 11 12 14 14 15 15 16 16 16 18 18 19 19
    21 22 22 22 23 24 25 26 27 28 30 31 40 42

**Median 18–19 plays**, mean 19.6, range 5–42. Over those 626 plays the claw
got a prize clear of the pile 48 times — a 7.7 % carry rate — and wins split
roughly 60/40 between a clean carry and a prize worked over the kerb, so both
authentic lines are live. The prize being aimed at moves a median 27 mm a play,
so a failed grab is rarely a wasted one.

That puts it between 橋渡し (5) and スライダー (~30), which is about where a
三本爪 stocked with big plush belongs — ¥1800 or so a prize.

Aim precision barely matters: medians of 6, 3 and 5 plays at aim jitter of 8,
20 and 40 mm are all inside the run-to-run noise. The outcome is dominated by
how the pile happens to sit and by *which* prize you go for, which is closer to
台選び than to marksmanship — true to the format, but worth knowing.

### What is not right yet

**There is no near-miss.** The signature of this format is the plush that comes
off the deck, clears the rim, and is lost halfway home. It does not happen here.
Outcomes are binary: 72 plays at the final setting produced 8 wins, 5 small
nudges, and *zero* prizes lifted halfway and dropped. The reason is that grip is
a Coulomb friction threshold against a constant load, so a hold that survives
the first centimetre survives all of them. The close/hold split was added to
attack exactly this and it did not fix it — it made the claw take hold more
confidently, but the hold is still constant once the lift starts. Something that
varies *during* the lift is needed; the cable swing on the return is the obvious
candidate and is currently far too gentle to break a grip.

## Big prize (大型) — the tag setting

One prize, 44 cm of it, 1.15 kg. No claw on this floor could lift that and this
one is not meant to, because the prize **does not sit on anything**. It hangs,
by the plastic tag loop on its head, threaded onto a steel bar that crosses the
cabinet.

That single fact rewrites what a play is. You cannot take the prize and you
cannot topple it — there is nothing underneath it but the catch pan. All you can
do is grip it, let the claw's return drag it a few centimetres toward the free
end of the bar, and watch the ring slide. It is won when the ring comes off the
end.

### The ring is real geometry

No joint, no constraint, no new engine feature. The tag ring is twelve small
spheres in a circle, part of the prize's own collision cluster, and the bar
passes through the hole in the middle of them. It cannot leave the bar sideways
because there is nothing to leave through — it is threaded exactly the way a
real one is. 21 mm of clear hole against a 12 mm bar.

The threading is only as good as the timestep: a ring sphere that moves further
than its own radius in one substep passes straight through the bar. Measured,
that takes **5.0 m/s**, and the mechanism peaks around 0.3 m/s — a 15× margin,
but do not make the ring finer without re-checking it.

### The bar is a curve, and that is the difficulty

It rises 85 mm toward the free end. Two earlier designs failed first:

* **A stopper ball** at the free end, fatter than the ring's hole, so the last
  centimetre had to be *lifted* rather than walked. That cannot work: lifting the
  ring means taking all 11.3 N of the prize on the grip, and a grip strong enough
  to do that drags the prize the whole length of the bar in one play. The two
  requirements are the same number pulling opposite ways.
* **A straight ramp.** On a constant slope the force to drag the ring is
  constant, so a grip either supplies it and drags the prize the entire bar in
  one play or fails and moves it millimetres. Measured on a straight 6° bar:
  gains of 24, 16, 15 mm — and then 173 mm. Nothing in between, because nothing
  about the geometry changes as the prize moves.

Quadratic, the slope steepens toward the free end, so every play stalls
somewhere and stalls sooner than the last one did. The grind gets harder as it
gets closer, which is what a big-prize cabinet is for. The steepest point is
15°, inside the ring's static friction on chromed steel, so a stalled prize
stays where it stopped instead of sliding back to the bottom.

A **collar** near the anchored end stops the ring sliding all the way back. Not
decoration: a play that goes wrong shoves the prize downhill, and without it the
prize ended up hard against the anchor post, hanging at a permanent 50 mm tilt
with its body wedged — from there every further play moved it ±1 mm and the
cabinet was dead. Two sessions in sixteen ended that way before the collar.

### Handedness is forced

The two-button scheme only tracks one way: ➊ moves the claw right from wherever
it parks, and it parks at home. So home has to be the leftmost point of the
cabinet or half the bar is unreachable — and home is also where the claw returns
on every play, which is what does the dragging. Free end at the left is the only
arrangement where aiming and dragging both work. Built the other way round
first, and the claw simply could not reach the prize at all.

### Measured

30 bot sessions, restocked between each, all of them converging:

    4 7 7 7 7 7 8 8 8 9 9 9 9 10 10 11 13 14 14 15 15 16 16 18 18 22 26 27 28 34

**Median 11 plays**, mean 13.5, range 4–34, over 406 plays. A representative
trail, millimetres of ring travel per play:

    21 27 -31 -26 29 24 169 128 WIN

Small gains, real setbacks, and then a grab that really bites and moves it a long
way. That is the shape of the machine.

### What is not right yet

**The bar's height is load-bearing and I do not know why.** Raising the bar
100 mm and raising the claw's `headMin` by the same 100 mm — which leaves every
relative distance between bar, claw and prize unchanged — took the machine from
a median of 13 plays to *not one win in twenty sessions*, with the prize moving
±2 mm a play. It is left at the height that works. That is an unexplained
result, not a tuning choice.

## String cut (ヒモ)

The prize hangs on a cord, and bolted in the middle of the field is a cutter —
a fixed blade, edge up. The cord runs from its anchor on the left, **over the
blade**, and down to the prize on the right, so blade contact is guaranteed by
geometry and never has to be achieved by aim.

The cord is real: twelve overlapping beads joined by `physics.Link`, hanging a
420 g prize. Cutting is not a counter either — every substep the machine
integrates the contact impulse the cord presses onto the blade with, scaled by
how far the cord's tension exceeds what the prize alone puts on it, and severs
the link when that integral reaches the cord's rated work. Left alone the
cabinet does nothing: at rest the cord carries about 3.4 N and the blade just
sits in it.

What the claw does is **press the cord down beside the blade on its descent**.
No grip, no carry. Where you put it is the entire game:

| claw x | cut in one play |
|---|---|
| −0.06 | 30% |
| −0.02 | 2% — straddling the blade, no leverage |
| +0.02 | 14% |
| +0.06 | 11% |
| +0.10 | 30% |

### Three designs that did not work

Each is a comment at the site in the code, because each looks obviously right
and is not:

* **Catch the cord with the prongs.** A prong sweeping horizontally cannot pinch
  a hanging cord — the cord is a pendulum with nothing to brace against, so it
  deflects around the prong. Measured: 5 mm of displacement, full closure on
  empty air, and the cord back where it started, every play.
* **Grip the prize and pull.** This is what a real cabinet does, and it fails on
  *this rig*, because ClawRig lifts before it returns: the prize goes up, the
  cord goes slack, and the prize is carried to the park position and dropped
  from height. Measured 371 N through the cord, the prize thrown onto the pan,
  and the cord pulled clean off the blade.
* **A cord of realistic beads.** 65 mm spacing with 7.5 mm beads is a sensible
  description of a cord and makes it collidable along 12% of its length; the
  prong swept between two beads every time. The beads have to overlap, which is
  why the cord reads as a thick plastic strap rather than a thread.

Two supporting parts earn their place the same way. The **divider** keeps the
prize on its own side of the cutter — let it swing left past the blade and the
wrap goes to zero, the cord lifts off, and it hangs plumb 161 mm clear with no
way back. And the divider's own height is a squeeze: tall enough to block the
prize, low enough that the *cord* never rests on it, because at 900 mm it caught
the cord itself and became a second, unwanted cutter post.

### Measured

18 sessions, cap 25 plays: **16 won, median 4 plays**, and the cord now leaves
its blade in 1 session out of 18 rather than 11. The progression, all on the same
18-session measurement: 7 won bare, 12 with the cheek plates, 14 once the cord
got XPBD compliance, 16 with the threaded guide ring.

    11 2 3 0 WIN           (% of the cord cut per play)

Note this machine's results swing hard on small samples; an earlier 12-session
read gave 9 wins on a configuration that a proper 18-session read scored at 7.
Use 18 sessions minimum.

### The guide ring — what finally fixed it

The cord had two stable resting shapes: **wrapped** over the cutter, and **free**,
hanging straight from anchor to prize 105 mm *below* it. Both are valid
equilibria for the same cord. Once a play knocked it into the free one,
re-wrapping meant lifting the cord back over the blade and nothing does that —
the cut froze and every later play was worth zero.

Every fix aimed at the claw, the divider or the pan only changed how *often* that
happened. Even walling off the under-the-blade route entirely — an 8.5 mm gap
against a 36 mm cord — left the cord off the blade 5 times in 18, because it has
more than one way out (and it made the machine trivial, median 1 play).

A ring the cord is **threaded through** has no way out in any direction. Eighteen
overlapping static spheres forming an annulus on the descending leg, 32 mm clear
hole against an 18 mm cord so it still runs freely, sited 90 mm below the cutter
— far enough past it to still force the wrap, low enough to clear the claw's hub.
It is the same construction as 大型's tag ring with the roles swapped: there the
ring rides on a moving body and the bar is static; here the ring is static and
the cord runs through it. Neither needed a new engine feature.

### What is not right yet

**A third of sessions still reach a dead state**: the cord comes off the blade,
and nothing in the cabinet can put it back — the cut freezes and every further
play is worth zero. **Not ready to mount.**

The good news is that the cause has moved, and the new one is better understood
than the old one.

**The old cause — now fixed.** The prongs close along ±Z, the blade's own axis,
and shoved the cord along the edge and off the end: 10 mm into the blade at the
start of the close, 97 mm clear by the end, repeatably. The cheek plates cap
that drift at their 8 mm running clearance, and it is gone.

**The remaining cause is cord stretch, not geometry.** In the dead states that
survive, the beads are still in the channel and still at the right z — but the
cord measures **24% longer than its rest length**, which drops its whole path
below the blade and loses the wrap. The `Link` solver leaves about 10% at
equilibrium and a shock load pushes it far past that. So the real fix is a
stiffer rope, not more guides.

That is a physics-engine problem with a known shape: hard position projection is
the standard answer and is written up in `physics.js`, but it cannot be used
naively here because it is blind to collisions and straightens a draped cord
right off its blade. What is needed is a projection pass that runs *before* the
collision solve, or one that skips links currently in contact.

Attempts that made things WORSE, recorded so they are not repeated:

| attempt | result |
|---|---|
| Lengthen the blade in Z (55 → 110 mm half-length) | cord still came off at 4 of 5 aims |
| Turn the claw a quarter (`prongYaw: 0`) to close across the cord | far worse — prongs straddle the cutter post and knock the cord off at nearly every aim |
| Divider under the blade + short prongs + raise the whole assembly 150 mm | 0 wins in 6, dead every time |
| Cheek plates covering only the blade (x −0.02…0.07) | cord escaped round them where the claw actually presses; 166 mm of Z drift |

## Bridge setting (橋渡し)

The skill format, and a different playfield entirely: no deck, just two chromed
rails over an open well. Anything that leaves the rails is won.

Three numbers are the whole difficulty model, and they interact:

| | |
|---|---|
| **rail gap** (106 mm) | narrower than *both* box plan dimensions (170 × 166 mm), so a lucky 90° spin drops nothing — the box must be shifted ~3 cm sideways to clear a rail |
| **box mass** (1.6 kg) | grip capacity is far below its weight, so the prongs shove and pivot it but can never carry it |
| **rail friction** | high enough that a play moves the box a centimetre or two, not across the span |

Both authentic winning lines emerge from the physics rather than being
special-cased: **ずらし**, walking it along the rails a few millimetres a play
until an end clears the last rail, and the knife-edge case where it ends up
square to the gap with barely a centimetre of purchase a side.

Measured, resetting between sessions: **5 plays** with a bot that aims precisely
and compensates for gantry coast; **2–4** with a deliberately sloppy one. Wild
grabs sometimes luck out where careful ones only nudge — which is honest, but it
does mean this reads as an efficient-skill-player bridge rather than the 20-play
grind a casual player would face. A typical trail: +9 mm, −3 mm, +4 mm, +14 mm,
then it goes.

## Slider / rail setting (スライダー)

Superficially close to the bridge, mechanically its opposite. On a bridge the box
can escape sideways, rotate, wedge or drop between the rails. Here it can do none
of those: each prize sits in its own guided lane on inclined rails, and the only
way to win is to advance it until its centre of mass passes the end and it tips
into the chute.

Two things make the grind behave:

* **the rails are inclined ~7°.** Static friction holds the box at rest, but
  every disturbance is biased downhill, so nudges accumulate rather than
  random-walking;
* **the prongs grip ACROSS the lane**, on the box's side faces. Working along
  the lane looks more natural and is wrong — the two opposed prongs both reach
  the box and the rear-pushing one usually wins, walking the prize *backwards*
  at a steady 10–28 mm a play. That measurement is what forced two wide lanes
  instead of three narrow ones, since the prongs need room to drop inside a lane.

Claw depth is the other critical number. The tip must land at the box's
mid-height and push the vertical face: 20 mm lower and it slips underneath, and
the close becomes a scoop that flings the box half a metre (measured: 553 mm in
a single play).

**Measured**, five sessions with human-like aim jitter: `>45, 24, 31, 32, 1` —
median around 30 plays. A representative trail, in millimetres per play:

    0 +15 +12 -55 -11 +8 +2 +3 +3 +2 +3 +5 +11 -10 +11 +10 -50 +4 ...

Small forward nudges, with occasional heavy knock-backs when a grab goes wrong.
That is the slider's whole character, and it is the most patience-taxing setting
on the floor.

### What is not right yet

Aiming *dead centre* on the box produces a consistent −5 to −7 mm per play — a
systematic backward creep I did not track down. Off-centre (human) aim progresses
forward normally, so the machine plays correctly, but that bias is a real
unexplained result rather than a deliberate difficulty choice.

A settle-pause before the claw descends was tried to damp the cable swing left
over from aiming. It made the slider strictly worse (23 → 45+ plays): that
residual swing is a meaningful part of what breaks static friction on an
inclined rail. The finding is recorded in `clawrig.js` so it is not retried.

## Ring hook (リング掛け)

The only cabinet on the floor that cannot squeeze anything. The prizes are
boxed, they stand in a slotted display rack, and the rack sits **65 mm below
the lowest point the claw can reach** — the only thing up at the claw's working
height is a 56 mm steel hanger tab standing on each carton's lid.

So the prongs are hooks: a shank down past the tab, then a barb pointing back up
and inward. The claw straddles the prize and, as it closes, one barb sweeps
horizontally through the tab. Nothing about grip enters into it. That is
verified rather than asserted — 60 deliberate near-misses moved every carton by
about a millimetre and won nothing, so there is no second way to take a prize
off this rack and **no 寄せ line at all**: a miss here is worth exactly zero,
which is unique on this floor.

### The hook does not thread the hole — it forces the tab onto itself

This is the thing measurement changed my mind about, and every other finding
follows from it.

The design intent was a threading problem: put an 8 mm barb through a 28 mm
hole, ±10 mm of geometric tolerance, done. What actually happens is that a hook
and a ring **self-centre**. A barb that arrives off-target still catches the
inside of the tab, and the rim then cams the carton sideways until the barb
drops through. Three separate measurements say the hole is not the gate:

| changed | window across the sweep |
|---|---|
| rack side slack 15 mm → 2 mm | ±26 mm → ±22 mm |
| barb radius 8 → 10 → 11 → 12 mm | ±22 mm throughout |
| hole 28 mm, tab 56 mm | ±22 mm |

Barb thickness is half the hole and moves nothing, because the barb is shoving
its way in rather than passing cleanly through. What *does* gate it is whether
the motor can do that shoving — and that turns out to be a cliff, not a dial:

| prong motor | 0.045 | 0.15 | 0.30 | 0.50 | 0.90 |
|---|---|---|---|---|---|
| single-play win rate | 0.00 | 0.00 | 0.00 | 0.00 | 0.96 |

(24 plays a point, which is a small sample everywhere else in this file and is
enough here only because the result is 0 against ~1.)

Prize mass says the same thing from the other side: 450 g plays normally, 1 kg
never wins at any aim tested, and so do 2 kg and 4 kg. Both are left well clear
of the edge on purpose — a cabinet tuned to sit *on* that cliff would be a
coin-flip dressed up as a difficulty setting.

### Two bugs that both looked like difficulty

* **The close was shorter than the sweep.** `Arm` angles integrate once per
  frame while the motor is driven once per substep, so the angle advances at
  half the rate `avel` implies. At the usual 0.85 s close the barb was still
  short of the tab when the hoist began lifting and threaded it *on the way up*
  — which still won, and won far too often, because a barb rising through a ring
  catches the rim over a ±30 mm band. The machine was measuring the wrong
  mechanism. The close is 1.20 s.
* **The tab was centred on the carton.** The height at which the barb crosses a
  tab's plane depends on where in the sweep it gets there: it peaks 35–40 mm out
  from the claw's axis and falls away 9 mm at either end. With the tab centred,
  aiming at the prize put it at the very *inner* end — the barb arrived at full
  stretch, at the wrong height, and jammed against the rim. Measured: the pierce
  line passed within 3 mm of the hole's centre on six runs out of six and one of
  them won. That reads exactly like a depth-aim problem and is nothing of the
  kind. The tab now sits 35 mm right of centre, so aiming at the prize is
  correct by construction.

### Measured

Aim error against single-play win rate, **180 plays across 6 seeds at each
point**:

| aim jitter | ±20 mm | ±30 | ±40 | ±60 | ±90 | ±130 |
|---|---|---|---|---|---|---|
| win rate | 0.94 | 0.65 | 0.46 | 0.21 | 0.14 | 0.06 |

Clean and monotone over a 6.5× range — the cabinet is well behaved. Take the
sample size seriously here: an earlier 60-play read put the ±40 mm point at 0.50
and a repeat of the same 60 put it at 0.32, which is the machine doing what
STATUS.md warns every machine on this floor does on small runs.

The tolerances behind the curve are strongly asymmetric, and that is the
machine's character: **±22 mm across the sweep, and −30/+50 mm along it.** The
depth button decides every play; the left-right button barely matters.

Forty restocked sessions at the floor's standard ±20 mm aim: **37 won on the
first coin, 3 on the second.** Those figures are for the original 0.34 m/s
gantry; the cabinet now runs at 0.55, which moves it to a median of 1 and a mean
of 1.4 plays — see the gantry section below.

**The jam is fixed.** About 1 play in 15 used to strand a prize on the hook with
the prong stalled part way open at −0.75 rad. It was a torque balance, not a
timing problem: `ClawRig` opened the prongs at `strength × holdScale`, and a tab
hanging in the crook exerts ~0.53 N·m closing the prong against only ~0.30 N·m of
opening. A claw's opening is a spring return, not a grip setting, so it now has
its own `releaseScale`. Measured 7 in 130 before and **0 in 130 after**, at both
gantry speeds and both aim models.

It only ever appeared on a sloppy catch — at tight aim it measured 0 in 130 —
because a well-centred barb seats the tab deep in the crook where it sheds
cleanly. Measure this one with the timing model, not the tight one.

### What is not right yet

**It is far too easy at the aim model the rest of the floor is quoted against,
and it is not ready to mount.** Thirty-seven first-coin wins in forty is not a
cabinet.

The cause is understood, and it is the mechanism rather than the tuning. A hook
and a ring self-centre; the hook catches the rim whether or not it finds the
hole; and once caught, a tab on a hook never comes off — 12 lifts, 12 deliveries
with the hold torque at 0.06 of the close, and the same at four rack depths from
55 to 125 mm. Every lever that makes a crane hard elsewhere on this floor was
measured here and does nothing: grip strength (a cliff), prize mass (a cliff),
hold torque (nothing), engagement depth (nothing), rack depth (nothing). The
only smooth knob is the player's aim, and a mechanism gated purely on aim cannot
be hard against a bot that aims to ±20 mm.

### The fix: hang the tab, and give the claw a real opening torque

The two changes only work together, and the second is why the first failed the
first time.

**Hang the tab.** It becomes its own body, slung from a hanger arm on the carton
by two 30 mm rods anchored at *points* on both bodies — `Link`'s `ra`/`rb`. Two
rods, not one, because a tab hung from a single point has no restoring torque in
yaw and would keep whatever heading it was knocked into. Struck on the rim it now
swings away instead of camming the carton onto the barb.

**Then give the claw something to open with.** The first attempt at this was
reverted because a third of captures ended with the prize stranded on the hook.
That was never the tab — `ClawRig` opened the prongs at the HOLD setting, so the
claw had 0.30 N·m of opening against 0.53 N·m of load closing it. `releaseScale`
fixed that independently (it was the same defect as the 1-in-15 jam on the rigid
build), and the same experiment now strands **0 in 90**.

**And run the gantry at its ceiling**, 0.65 m/s, so the window is worth less
time. Past that perfect aim starts failing and the cabinet stops being honest —
0/12 at 0.70 and 0.80, exactly as with the rigid tab.

| release timing | ±0 ms | ±30 | ±60 | ±90 |
|---|---|---|---|---|
| win rate | **1.00** | 0.44 | **0.23** | 0.25 |

Perfect aim still wins every time and more error wins less, which is the check
this cabinet taught the floor to run. 18 sessions: **median 3 plays, mean 3.3,
range 1–8**, all converging — from a median of 1.

One thing that did *not* stack: shrinking the hole on top of all this. At a
34 mm tab the barb jams instead of threading and perfect aim drops to 0/12 — the
same knife-edge failure as the first time it was tried. The hole is not the
lever, and this is the third measurement saying so.

### The hanging tab, first attempt — built and reverted

The obvious fix was to stop the tab being rigid. It was built: the tab became a
body of its own, slung from a hanger arm on the carton by two 30 mm rods
anchored at *points* on both bodies rather than at their centres — which is
what `Link`'s `ra`/`rb` offsets were added for. Two rods rather than one,
because a tab hung from a single point has no restoring torque in yaw at all and
would keep whatever heading it was last knocked into, which is precisely the
unwinnable prize the rigid rack exists to prevent. Checked in isolation first: a
9 rad/s yaw kick is rejected completely while a sideways shove still swings it
±40 mm.

Measured over 48 plays at ±20 mm aim:

| | rigid tab | hanging tab |
|---|---|---|
| captured and lifted | 0.94 | **0.65** |
| delivered | 0.94 | 0.35 |
| left hanging on the hook | 1 in 15, since fixed | **14 of 31 captures** |

So the camming theory was right in direction and far too optimistic in size. A
tab that swings does cut capture — but to 0.65, not to the ±6 mm the hole
geometry allows, because the barb shoves a swinging tab onto itself too, just
less reliably.

And it brings a bricking state, which is disqualifying. A tab pinned into the
crook by the carton's weight cannot slide back off the barb the way a rigid one
bolted to a whole prize can, so a third of captures end with the prize still on
the claw. Opening the hinge wider and dropping the barb friction were tried in
all four combinations; every one still stranded prizes. **The rigid tab ships.**

The trap here is worth more than the experiment. The win rate fell 0.94 → 0.35
and looked like a fix; most of that drop was the cabinet failing to pay out.
Split capture from delivery on this machine or a broken release reads as
difficulty.

### The aim model, tested as the lever, and it is not one either

The obvious remaining suspect was the harness rather than the cabinet: `BENCH.bot`
adds a *spatial* aim error, and on a two-button machine the player does not
choose a position, they choose a moment to let go. So the bot learned to take
`timing` in seconds instead, converted with the gantry's own speed.

That reframing is worth having and it is **not** a difficulty lever. At the
standard 0.34 m/s the floor's ±20 mm IS ±59 ms, and the two forms measure
identically — 三本爪 scores 0.033 either way, to the digit. What it buys is a
human-meaningful statement of what a cabinet demands: リング掛け's ±22 mm capture
window is a **±65 ms release window**, which is simply not hard.

Which suggests making time scarce — a faster gantry, so the same spatial window
is a tighter moment. **This is the one lever that survived**, and getting there
first required finding a bug in the bot.

A fast gantry read as a swing lottery: at 0.80 m/s a bot with perfect timing won
0 plays in 36, and no aim offset rescued it. That was the harness. A fixed coast
offset is only right once the gantry has reached top speed, and it has not —
accelerating at 3.2 m/s² it needs 100 mm to reach 0.8 m/s and the move from the
park position to the nearest prize is 91 mm. The bot was releasing early and
stopping the claw **77 mm short every play**. Predicting the stopping point from
the *current* velocity instead — which is also what a player does, watching the
claw and letting go when it looks like it will stop right — fixes it, and is now
used automatically for any cabinet running a non-default gantry.

With that corrected, gantry speed is real:

| gantry | 0.34 m/s | 0.55 | 0.65 | 0.70 | 0.80 |
|---|---|---|---|---|---|
| perfect aim | 1.00 | 1.00 | 1.00 | 0.67 | 0.00 |
| ±30 ms | 0.97 | 0.75 | 0.48 | — | — |
| ±60 ms | 0.87 | **0.73** | 0.55 | 0.46 | 0.10 |
| ±90 ms | — | 0.43 | 0.50 | — | — |

**The cabinet now runs at 0.55 m/s**, chosen for behaviour rather than for the
biggest number. 0.65 still wins on perfect aim but its curve is flat — 0.48 /
0.55 / 0.50 over a 3× range of aim error, a coin flip wearing a difficulty
number. By 0.70 perfect aim itself fails and the machine is simply broken.

Nothing about the mechanism changed: the same ±22 mm window is worth ±65 ms at
the old gantry and ±40 ms at this one. Sessions went from 37-of-40 on the first
coin to a median of 1 and a mean of 1.4 (14 × 1, 4 × 2, 3, 4). Honest, and still
easy — a real improvement rather than a fix.

Three experiments, and two of them had the same shape: a win rate that fell for
a reason that was not skill. On this cabinet, always check that **perfect aim
still wins and more error wins less** before believing a difficulty number.

## Push (押し出し) — no claw at all

The head carries one chromed finger. It comes down behind a prize and strokes
forward 45 mm, and that is the whole mechanism: nothing opens, nothing grips,
nothing is ever lifted. Prizes lie flat on a shelf and have to be walked over
its open front edge.

It is here because it removes the variable every other cabinet turns on. No grip
to survive, no hold to set, no cable swing. A play is a position, and the only
thing a position buys is **where on the prize the finger lands**:

| aim offset | 0 | 20 | 40 | 60 | 80 | 100 mm |
|---|---|---|---|---|---|---|
| advance | 116 | 119 | 112 | **37** | 27 | 0 |
| spin | 0° | 0° | −8° | **−72°** | −51° | miss |

Inside 40 mm the whole stroke becomes travel. Past that it becomes rotation
instead, and past 100 mm — the prize's half-width plus the finger's radius — the
finger sweeps by the corner and the play is worth nothing. A prize left at an
angle is then a harder target than it was, presenting its 110 mm face instead of
its 160 mm one. None of that is special-cased: a point finger against a box is a
torque and the solver does the rest.

### It did not need a new bot

`BENCH.bot` was written for `ClawRig`, and STATUS.md predicted this cabinet would
need its own driver. That was wrong. What the bot actually drives is the
two-button gantry — `aimX`/`aimZ` phases, a `gx`/`gz` carriage, and a coast to
compensate for. `PushRig` exposes exactly that contract and the existing,
verified driver runs the machine unmodified. The claw was never the part the bot
cared about.

### Measured

18 sessions: **median 18 plays, mean 18.4, range 16–22**, all converging. A full
five-prize cabinet empties in about 55 plays with nothing stranded.

That range is the tightest on the floor by a wide margin — 三本爪 spans 5–42 —
and the reason is structural. The stroke is a fixed 45 mm, so even flawless play
needs about six pushes per prize: the minimum here is a mechanical constant, not
a matter of luck. Aim error does not lower that floor, it adds to it, and adds
variance with it:

| aim jitter | ±0 mm | ±40 | ±80 |
|---|---|---|---|
| sessions | 20 18 20 19 18 | 6 21 32 16 33 | 7 51 23 60* 25 |

Perfect aim is not fast, it is *consistent*. This is the only cabinet here whose
best case is set by the machine rather than by the player.

### What the travel limits are for

The gantry originally stopped at ±0.300 against a 0.360 shelf, and a prize shoved
into a corner could then only be struck off-centre — which on this cabinet means
rotated, never advanced. One carton ended a 120-play soak parked against the wall
60 mm from the lip, unwinnable. The limits now cover the shelf's own half-width,
so every point a prize can occupy can be struck dead centre. Worth checking by
emptying a whole cabinet, not by playing to the first win.

## Seesaw (シーソー) — the balance setting

The playfield is one sprung platform on a hinge across the cabinet, and
everything on it weighs on one side of that hinge or the other. Stocked, the
prizes sit behind the pivot and the platform rests tipped back. Each play drags
one a few centimetres forward; nothing happens for a while, and then enough
weight is forward of the hinge that the platform starts to come level — which
slides the prizes further forward, which tips it further. The payoff is meant to
be an avalanche: the platform goes over and dumps whatever is on it at once,
which no other cabinet on this floor does.

The platform is four colliders — deck, back lip, two side walls — sharing one
`physics.Arm`, carrying real load through real contacts. There is no tilt counter
and no dump animation.

### Two things the engine will not do, both found the hard way

* **An `Arm`'s joint limits cannot carry load.** They are applied when the angle
  is integrated, *after* the solve, so the solver never knows they exist: an arm
  resting on a limit is, to every contact, free to rotate. It yields under
  whatever stands on it, and the collider reports the surface velocity of a
  rotation that is about to be clamped away. A box on a level platform slid
  backwards at 50 mm/s and off the back edge. Zeroing the velocity before the
  solve as well does not help. A passive hinge that must *hold* something has to
  be sprung rather than stopped — a spring acts through the arm's own inertia
  every substep, which the solver can see. Same box: 3 mm of drift instead of 240.
* **A linear spring has no tipping point.** It resists in proportion to angle in
  both directions, so the settled tilt tracks the load's moment whichever side of
  the hinge it is on. Tuned soft enough for a forward load to reach the prizes'
  friction angle, the *stocked* load — the same prizes, further out, so a bigger
  moment — drove it onto its backward limit at 23° and everything slid into the
  back lip on the first frame. A **constant counterweight** is what makes a
  threshold, with a stiff one-sided spring as the rubber pad it rests on.

### The geometry is the machine

Built first with the hinge near the middle and the prizes on a long rear arm,
and it was unwinnable — not hard, unreachable. The stocked load sat a mean
200 mm behind the hinge (−8.8 N·m against a +1.5 N·m threshold), so the whole
load had to travel ~195 mm forward before anything could happen, against a claw
that moves a carton 5–23 mm a play. Sixty plays moved the tilt one degree.

Putting the hinge hard against the **back** of the playfield fixes both halves
of the sum at once: the cartons now stock only 45 mm behind it, so the resting
moment is −0.94 N·m instead of −8.8, and the arm in front of them is 410 mm of
leverage instead of 200.

The front arm also reaches **110 mm further forward than the claw can**, and
that decides what kind of machine it is. Shorter, and the claw could drag a
carton clean over the front edge by itself — six of eight first payouts were a
single prize toppled off the end, so the avalanche was the minority outcome. Out
of reach, the claw cannot deliver anything on its own and the only way to be
paid is to tip the platform.

### Measured

30 sessions with `BENCH.bot.session({ cap: 50, pull: 0.05, patience: 3 })`:
**median 16.5 plays, mean 18.7, range 7–41, all 30 converging.** The payout is
almost always all four cartons at once — 7 of 8 sampled payouts were the full
platform. That is 三本爪's play count for four
prizes instead of one, and it is the only cabinet here where a single play can
empty the machine.

`counter` grades monotonically over a 4× range — worth saying out loud after
リング掛け, where every lever tried was either a cliff or did nothing.

### The stall, and what it actually was

It used to stall about 1 session in 18, and the reading that it was "a few
percent short of tipping" was the symptom rather than the cause. A carton was
going over the 70 mm back lip — which is shorter than the 90 mm carton — falling
past the cage glass (that only starts at y 0.58) and coming to rest on the
cabinet floor at z −0.431, behind a platform whose back edge is at −0.290.
Probed there it moved 0 mm on both axes: nothing in the machine can reach it.

The lost prize is the smaller half of the damage. The bigger half is that the bot
keeps cycling onto it and spends a third of the session pushing at something
immovable, so the session reads as a difficulty problem. Walls are 105 mm now,
over the carton's own height, and there is no orientation a carton can be shoved
or flung out in: **30 sessions, 0 stalls, 0 escapes**, with the play count
unchanged.

**Drive it with `patience`.** A bare `BENCH.bot.play()` loop always targets the
prize nearest the chute — here often one already pinned at the reach limit — and
3 sessions in 9 then hit a 50-play cap having won nothing. Nothing about the
machine changed between that and the numbers above; only the driver did.

## One rig, eight cabinets

`ClawRig` takes an optional `releaseScale`: what the prong motor pushes with
while it is OPENING, as distinct from `holdScale`, which is what is left of the
grip while it carries. On a real cabinet those are different mechanisms — a
spring or solenoid return against a grip setting — and conflating them stalled
リング掛け's claw part way open with a prize still hanging on it. Defaults to
`holdScale`, so every cabinet that does not set it is bit-for-bit unchanged.

`ClawRig` also takes optional `prong.muUpper` / `prong.muLower`, the two prong
friction values, defaulting to the rubber-padded 0.62 / 1.05 every gripping
cabinet wants. リング掛け is the one cabinet that needs the opposite — its tabs
have to slide back off the barb when the claw opens over the well, which at
µ 1.05 would need the barb pointing 46° below horizontal, past anything the
hinge can reach. Omit them and nothing changes, verified by A/B on 三本爪:
identical play trails to the number on two seeds, with `jitter: 0` making the
bot deterministic.

Every crane on this floor now runs the same `clawrig.js`. `claw2.js` was the
last holdout — it carried its own copy of the prong/gantry code because the rig
was *extracted from it*, and the copy was left alone rather than risk regressing
a verified machine. The port took 279 lines out of it and gave 二本爪 a headless
driver for the first time.

### How it was proved equivalent

Not by eye, and not by re-measuring the play count — a claw machine is chaotic
enough that two runs of the *same* build diverge, so "it still plays about the
same" proves nothing. Two things were checked instead.

**The mechanism, frame by frame, with no prizes at all.** With an empty
playfield the world has no bodies and the claw's motion is fully deterministic.
Old and new were stepped side by side through a complete play cycle and compared
on gantry position, both velocities, hoist height, cable swing, hoist
resistance, both prong angles, both tip positions and the head hub:

    468 frames, maximum absolute difference: 0
    phase timeline identical to the frame

**Then the whole machine, with a pile.** Both builds were constructed, then
restocked under a seeded RNG — seeding at construction does *not* work, because
three.js draws on `Math.random` for object UUIDs and the two builds create
different numbers of meshes, so the pile comes out different. Restocking after
construction runs identical code in both. From identical piles, driven by
identical aim values, across five seeds and 56 plays: **every prize in the same
place to within 1e-9 after every play, and identical win counts.**

Worth recording that the first two attempts at this test were both wrong and
both looked like real regressions — a seeded-at-construction pile diverged by
360 mm, and a copy-the-positions-across approach still diverged, because it does
not copy the warm-start impulse cache each pile accumulated during its own
settle. The control that caught it: run the test with *two instances of the old
class* and confirm they diverge too.

## Medal pusher (メダルゲーム) — the first non-crane cabinet

Nine settings on this floor are a crane with something different underneath.
This one shares nothing with them: no claw, no two-axis gantry, no prize, and no
"win". It has a shelf that never stops moving.

        chute ↓  (sweeps in X — the whole aim)
              ▓
        ┌─────────────┐ curtain (fixed)
        │  ▒▒▒▒▒▒▒▒   │   ← upper deck: the pusher's own top face
        ╞═════════════╡◄──►  pusher, 45 mm stroke, 2 s crank
        │  ▒▒▒▒▒▒▒▒▒▒▒│   ← field
        └─────────────┴──── open lip ──► payout
             gutters either side

The double deck is the whole machine and none of it is scripted. Medals land on
the pusher's top face against a fixed curtain; the pile cannot move back, so
when the pusher runs back **the shelf slides out from under it** and whatever
was overhanging drops onto the field. Down there the pusher's front face shoves
the carpet at the open lip. The curtain is a static box, the pusher is a
kinematic box, and the delivery is a pile held by a wall while the floor is
withdrawn.

### The upper deck has exactly one requirement

The pile must **reach** the curtain. Built first with the curtain 90 mm behind
the drop point, the shelf pile floated free — nothing held it, so it rode back
and forth with the shelf and the upper deck was a null mechanism. Twenty coins
moved the field **0 mm**, with thirty medals sitting on the shelf. A pile that
is not against the wall is not being ratcheted, it is being carried.

That fixes the pusher's depth, and there is nothing else to choose:

    shelfDepth ≤ pusherDepth − margin − stroke

Wanting 2–3 medals of shelf (66 mm) at a 45 mm stroke gives a 116 mm pusher.
The rear must also never come forward of the curtain, or a slot opens at the
back of the shelf and medals drop through the machine into a region nothing can
reach.

The field carpet had the same class of fault at the same time, independently:
stocked at z −0.060 its back edge sat *exactly* on the pusher face's
most-forward position, so the pusher never touched it. Both read as a payout
problem. Both were gotcha 21 — the carriage must reach every point a prize can
occupy.

### The statistic is the payout ratio, and it is bookkeeping

`BenchBot` returns plays-to-win, carries, and gain toward a goal. None of that
means anything on a machine that pays continuously, never empties, and whose
field is worth more at the end of a session than the coins that built it. So
`PusherBot` measures **medals out per medal in**.

The first flat-field build settled at a ratio of **1.000** over 97 coins with 2
medals lost. That is not a tuning failure, it is arithmetic: at equilibrium a
closed pusher pays out exactly what it is fed, because in = out + lost. With the
gutters inert there is nothing else for a medal to do. **The loss rate is the
only lever there is.**

Hence the crown: the field is a shallow roof, 2.5° either side of the
centreline. That is far under the 17.7° a medal needs to slide on its own
(atan µ 0.32), so nothing creeps on a quiet field — what it does is bias the
jostling. Every stroke shuffles the carpet, and on a crowned deck the shuffle
has a preferred direction. The medals that go over the side are the ones already
at the edge and already being squeezed, which is exactly which medals a real
pusher eats.

### Measured

Six seeds × 30 coins = **180 coins**, from a cabinet stocked at its own measured
steady state (90 field + 15 shelf):

| | |
|---|---|
| payout ratio | **0.617** overall; median session 0.60, range 0.533–0.733 |
| lost to gutters | 43 of 180 = **24%** |
| escaped the machine | **0** |
| field population | 105 at open, 108 mean at close |
| dry coins | about 2 in 3 pay nothing |
| best single coin | 6 medals |

A stack of medals therefore buys about 2.6× its own size in plays. Roughly two
coins in three pay nothing at all and the third pays 1–6 at once, which is the
right shape: a pusher is long stretches of nothing punctuated by a cascade.

The ratio has moved twice under changes that were not aimed at it, and neither
move is established: **0.561** before the engine's sleep fix, **0.661** after
it, **0.617** after lost medals were made to persist in the gutters. All three
are the same 180-coin, 6-seed measurement. The last step is 8 medals out of 180,
about 1.2 standard errors — noise. The first is bigger and has a plausible story
(a sleeping carpet is a rigid mass that transmits the pusher's shove, where a
jittering one absorbs it) which has not been demonstrated. Recorded as unsettled
rather than smoothed over.

Equilibrium is real and was measured directly — from a light stock the cabinet
took 40 coins to pay anything, then climbed to a marginal ratio of 1.00 at
99 medals on the field. **Quote a ratio off an unequilibrated cabinet and you
are measuring the priming, not the machine**: the same build read 0.24 over its
first 25 coins and 0.68 once settled. The cabinet now runs itself in at
construction — five seconds of stroking with the counters zeroed afterwards —
which is also the true state of a machine you walk up to on a real floor.

### Aim is release timing, with nothing in between

Same button grammar as every other cabinet: hold ➊, the chute tracks right,
release. What is different is that there is **no coast to compensate for** — the
medal leaves the chute at the instant of release, not after a carriage settles.
That makes this the pure case for the model `bot.js` argues for everywhere else:
the player does not choose a position, they choose a moment, and the distance
that moment is worth is exactly `timing × sweepSpeed`. On the crane cabinets the
timing and spatial models agree only because the gantry happens to run at
0.34 m/s. Here they are the same statement.

`PusherBot.bestX()` aims where a player does: the column scoring highest on
`Σ 1/(20 mm + distance to lip)` within 50 mm. Feeding the leading edge is the
whole strategy — a medal on a bare patch has to cross the entire field before it
is worth anything.

### The gutters, and why they were invisible

A fifth of everything fed in goes over the sides, and it is the only thing on
this cabinet that hurts — so a player has to be able to watch it happen. They
could not. Three separate causes, and the interesting one is not the obvious:

* **Sightlines were fine all along.** Raycast from a standing eye position to
  five points in the channels: nothing occludes them. That was the assumption
  worth testing first, and it was wrong.
* **The channel was near-black** — a 0x0a1a24 floor under a glow at 30% opacity.
  Now lit: a cold cyan floor, a brighter glow sitting just *under* the medals'
  resting height, a lamp in each channel, and a lit strip along the field edge
  so the drop line itself reads. Cold against the field's warm gold, so a
  channel says loss and the payout well says gain without either needing a
  label.
* **A lost medal was deleted mid-fall.** `_sweep` fired at y 0.62 and the
  channel floor is at 0.56 — the medal ceased to exist 60 mm into a 140 mm
  drop, never reaching the gutter at all. Nothing was ever there to see. Lost
  medals now persist as bodies and lie in the channel, capped at ten across both
  sides.

### Deleting on contact hides every fault downstream of it

The cap is not about draw cost — it is because a filled channel would eventually
back up to the field lip and change the loss rate the cabinet is tuned around.
Ten, spread over two 440 mm channels 140 mm below the deck, can never reach the
playfield.

Making them persist immediately exposed **two geometry holes that had been there
all along and were unfindable**, because nothing had ever survived long enough
to travel:

* **The channel had no end.** The gutter floor stopped at the lip and the payout
  well began there, so a lost medal sliding forward dropped into the tray — the
  machine paying out a medal it had just taken off you.
* **The channel had no inboard wall.** Its inner side is the underside of the
  playfield: open space from the gutter floor up to the deck. A medal nudged
  back in-board fell through it and out of the machine.

Both are now walled, the inner one stopping 45 mm short of the deck so the drop
path from the field edge is untouched. 180 coins with **0 escaped** afterwards,
against 2 in the 90 coins before. The general form is worth keeping: **an object
deleted on contact takes the evidence of every fault beyond that point with
it** — the same lesson as the payout counter concealing medals leaving the
machine, arrived at from the other direction.

### Three holes that a payout hides

All three were found by looking at the cabinet rather than at its numbers, and
none of them would ever have shown up in the ratio.

* **The tray was inside solid geometry.** Paid medals were deleted at the lip,
  so the cascade — the machine's entire payoff — happened into a black hole.
  Keeping the last 14 as real bodies fixed that, except they then rendered
  invisible: the base was a solid plinth and the tray at y 0.48 was *inside* it.
  Found by raycasting camera→medal and getting three hits, none of them the
  medal. The base now has a payout recess cut into it.
* **The well was modelled as a solid block.** Identical from outside, and not
  the same thing at all: the block filled the very volume the medals land in. A
  void modelled as a solid is invisible until something has to be inside it.
* **The cabinet was open below the glass.** The cage begins at y 0.59, so the
  well's front and sides were open air — a medal that bounced on landing left
  the machine and came to rest on the arcade floor. It did not even register,
  because a paid medal is no longer swept. Worse, the wall under the field's
  front edge was scenery with no collider, so a medal could cross the lip, be
  counted as paid, then drift 40 mm back *under* the deck and fall out through
  the bottom. Three in twenty-five coins. That one cannot be caught by watching
  the payout, because the payout already happened.

Its front face has to sit exactly on the lip, incidentally: one centimetre proud
and it is a 10 mm slot against a 12 mm medal, and every payout jams on the edge
instead of falling.

### The medal is a thick token, deliberately

Seven overlapping spheres in a flat hexagon: 34 mm across, 12 mm thick, 14 g. A
real 25 mm medal is 1.6 mm thick and there is no honest way to build one here —
a sphere cluster cannot be thinner than the spheres in it, and spheres fine
enough for a 2 mm disc would run to hundreds per medal. Seven is the minimum
that closes: six on an 11 mm ring with 6 mm spheres overlap each other and the
centre, so the envelope has no hole. Four in a square leaves diagonal gaps that
catch on a rail corner.

The thickness is not only a concession. A carpet of thick tokens stacks and
slides stably; thin discs build towers the solver cannot hold.

### What is not right yet

**It is not mounted, and that is now a floor-plan question rather than an engine
one.** It cost **6.4 ms a frame standing idle** — worse than all 36 crane
cabinets together — which turned out to be an engine bug rather than anything
about pushers: settled piles never slept anywhere, 三本爪 and 二本爪 included.
See the sleeping notes above and STATUS.md. Fixed, and the cabinet now costs
**~4.5 ms**, of which most is honest: the pusher genuinely agitates its carpet
twice a second, so the field never gets the 0.55 s of quiet that sleeping needs.
Only 9–11 medals touch the pusher at a time and at most 10 are above the sleep
threshold, so there is little left to reclaim without fewer bodies, fewer solver
iterations, or stopping the motor.

At ~4.5 ms a cabinet, one or two near the player is affordable against a 16.7 ms
frame; a *bank* of them is not, and that is the argument for putting medal games
on a second storey culled by floor rather than into the crane hall.

Three smaller things:

* **No jackpot.** Real medal floors run チャッカー gates and progressive
  payouts, and this cabinet has none — it is a pure pusher. That is the obvious
  next thing on it, and it wants a gate the medal physically falls through
  rather than a scripted bonus.
* **The room does not know about it yet**, deliberately: `layout.js` has no
  `medal` family and `play.js` has no `aim` prompt (its `drop` entry says
  "descending…", which is a claw, not a chute). Wiring a room for a cabinet
  that has nowhere to stand is how dead code starts.

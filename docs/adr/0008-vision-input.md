# ADR 0008 — Camera (vision) control as a pluggable input source

**Status:** Proposed (2026-09-10)
**Date:** 2026-09-10
**Deciders:** Bharat (lead)
**Decision lens:** Add a whole new control modality without reopening the engine contract
**Builds on:** ADR 0002 (`RealtimeModule`, the real-time family)
**Note on numbering:** 0007 is reserved for the variants / `ParamSchema` decision already
cited across `tasks/backlog.md` (MPG-096, MPG-098, MPG-103, MPG-031); this ADR takes 0008.

---

## Context

We want a new **set** of real-time games controlled by the camera: the player points the
webcam at themselves, the app tracks a chosen body part (hand or head), and that part's
position drives the character. Two games are in scope:

- **Game A — no-gravity side-scroller.** Obstacles scroll right-to-left (selling the
  illusion the character flies right); the player's tracked position maps **directly to
  the character's Y**. Unlike Floppy Birds there is no gravity and no impulse — it is
  position control, not force control.
- **Game B — jet dodging missiles.** The jet sits centred, low on the screen; the tracked
  position maps to **X**; missiles come at it.

The starting question was whether this needs a new game family. It does not. Reading the
trunk:

- `RealtimeModule<S, I>` (ADR 0002 §1) already leaves the per-tick input `I` entirely to
  the module. ADR 0002 explicitly anticipated this: _"a continuous game could use
  `{ axis: number }`"_. Nothing in the engine contract needs to change.
- `useRealtimeLoop` is **already input-source-agnostic**. It takes `sampleInput: () => I`
  and calls it exactly once per fixed tick. It does not know or care where the value comes
  from.
- Determinism survives untouched. The controller records every tick's input into
  `inputLog`; `(seed, inputLog)` still replays a run exactly, so the server-side
  re-simulation anti-cheat (`submitRealtimeScore`) works for an analog axis exactly as it
  does for a boolean flap.

So the engine is ready and the loop is ready. The one thing that is **not** ready is the
layer between them:

- `RealtimeControls<I, A>` in `RealtimePlayScreen.tsx` is hardwired to a **discrete action
  union**: `keyMap: Record<string, A>`, `toInput(pressed: ReadonlySet<A>)`,
  `resolveTapAction(fractionX)`. There is no way to express a continuous axis, and no
  lifecycle at all — no async acquisition, no permission, no failure state, no teardown.

That is the whole decision surface: **generalize input at the web layer, and only there.**

Two forces shape the rest:

1. **Graceful degradation is a platform pillar.** A camera can be absent, denied, in use
   by another app, or defeated by bad lighting. A game that only works with a working
   camera is a game that frequently does not work.
2. **A camera is a privacy surface**, and the audience explicitly includes kids
   (MPG-092). This needs an argued position, not an afterthought.

## Decision

Introduce an **`InputSource<I>` seam in the web layer**. Camera control becomes one
implementation of it. `packages/engine` is not touched at all.

### 1. `InputSource<I>` — a sampler with a lifecycle

```ts
export interface InputSource<I> {
  readonly id: InputSourceId; // "actions" | "pointer-axis" | "vision-axis"
  readonly label: string; // player-facing, e.g. "Camera (hand)"

  /** Cheap capability probe. False → never offered in the picker. */
  isAvailable(): Promise<boolean>;

  /** Acquire resources (camera stream, model weights). Rejects → caller falls back. */
  start(signal: AbortSignal): Promise<void>;

  /** Release everything, synchronously. MUST stop camera tracks, not just pause them. */
  stop(): void;

  /** Called exactly once per fixed tick. MUST be synchronous and allocation-light. */
  sample(): I;

  /** Liveness for the UI: acquiring / calibrating / tracking / lost / failed. */
  getStatus(): InputSourceStatus;

  /** Optional in-surface UI: camera preview, calibration target, tracking dot. */
  renderOverlay?(): ReactNode;
}
```

`RealtimePlayScreen` takes an `InputSource` instead of building a sampler from
`RealtimeControls`. The existing discrete-action path becomes one built-in source,
`createActionInputSource(controls)`, wrapping today's `keyMap`/`toInput`/`resolveTapAction`
logic verbatim. **Floppy Birds, Drunk Walk and Reflex Test change behaviour not at all**;
`RealtimeControls` survives as the config for that one source rather than as the screen's
only input concept.

### 2. The critical constraint: `sample()` never awaits the camera

This is the main correctness trap and it is called out here so nobody rediscovers it:

- The simulation ticks at a **fixed 60 Hz**, consumed by the accumulator in
  `useRealtimeLoop`. Ticks can be consumed several-at-a-time inside one frame.
- A webcam delivers frames at **~30 fps, variably**, and landmark inference costs
  milliseconds.

Therefore the tracker runs on its **own** cadence (`requestVideoFrameCallback`, falling
back to `requestAnimationFrame`) and writes the latest derived axis value into a mutable
ref. `sample()` does nothing but read that ref. Consequences, accepted deliberately:

- The sim is never blocked by, or coupled to, camera frame rate — the fixed-step
  determinism guarantee from ADR 0002 §1 is preserved exactly.
- When the sim outruns the camera, consecutive ticks legitimately sample the **same** axis
  value. That is correct behaviour (input is held between samples), not a bug, and it is
  what keeps the input log replayable.
- Any `async`/`await` inside `sample()` is a design error, not an optimisation problem.

### 3. The axis pipeline — pure, in the web layer, unit-tested

Raw landmark coordinates are not a playable control. The transformation is a chain of
**pure functions** (`raw → playable`), placed in the web layer because this is input
handling, not rules — but held to the engine's testing discipline: scripted landmark
sequences in, asserted axis values out, no camera, no DOM, no timers.

Stages, in order:

1. **Normalise** the landmark to `0..1` in camera space.
2. **Mirror** horizontally. Selfie video is mirrored; without this, moving right moves the
   character left and the game feels broken within one second.
3. **Calibrate.** Capture a neutral centre during a short ready-state countdown, and map a
   **comfort range** — a fraction of the frame the player can actually reach — onto the
   full play range. Mapping raw frame extents to play extents is unplayable: nobody can
   move their head to the top edge of the frame, so the top of the play area becomes
   unreachable.
4. **Deadzone** around the calibrated centre, so idle micro-motion does not drift the
   character.
5. **Smooth** with a **one-euro filter**, not a fixed EMA. The tradeoff is jitter versus
   latency, and it is not constant: a fixed filter that is calm enough when the player
   holds still is too laggy when they move fast. One-euro adapts its cutoff to speed,
   which is exactly the right shape for this.
6. **Clamp** to `0..1`.

Only the **final scalar** enters the tick input and therefore the input log (see §7).

### 4. `Tracker` — where MediaPipe plugs in, and where it stops

Tracking is itself pluggable, one level below the input source:

```ts
export interface Tracker {
  readonly id: TrackerId; // "hand" | "head" | (later) "region"
  load(): Promise<void>; // lazy: WASM + model weights, never in the main bundle
  track(frame: VideoFrame | HTMLVideoElement): Point2D | null; // null = lost this frame
  dispose(): void;
}
```

**Ship first:** `@mediapipe/tasks-vision` hand landmarker and face landmarker. The player
picks "hand" or "head". Robust across lighting, gives clean normalised coordinates, and
directly serves the two named games.

**Deliberately later, behind the same interface:** a generic "select any object" tracker,
where the player drags a box over anything on the preview and it is tracked by template
matching / frame differencing. It is the more flexible answer to the original "user can
select the main object" framing, but it is markedly jitterier and lighting-sensitive, and
it should not be on the critical path for proving the seam. The `Tracker` boundary exists
precisely so it can land later without touching the games, the pipeline, or the screen.

The model bundle (several MB of WASM + weights) is **lazy-loaded on demand** and never
enters the initial bundle. A player who never opens a vision game never pays for it.

### 5. Graceful degradation is mandatory, not optional

Every vision game ships with a **fallback ladder**, ordered:

> `vision-axis` → `pointer-axis` (drag/move on the play surface) → keyboard axis (arrows)

Rules this ladder must satisfy:

- **Both games are fully playable, scored, and leaderboard-eligible with the camera off.**
  This is a hard requirement, not a courtesy.
- Camera denied, no device, model load failure, or device busy → the game **starts anyway**
  on `pointer-axis`, with a plain-language, non-blocking note and a way to retry.
- Tracking lost for more than a short grace window mid-run → **auto-pause** with a
  recoverable message ("we lost you — step back into frame"), reusing the existing pause
  state rather than inventing a new one. A run is never silently failed by the tracker.
- The escape hatch ("play without camera") is visible in **every** state, including the
  permission-priming state.

This also happens to make the games testable: Playwright cannot drive a webcam, so
`pointer-axis` is what the e2e path exercises.

### 6. Privacy

- **Frames never leave the device.** All inference is in-browser WASM. There is no upload
  path, and none is to be added for these games.
- **No frame or landmark is ever persisted** — not in the input log, not in the leaderboard
  submission, not in logs. Only the derived scalar axis.
- A **priming step precedes the browser permission prompt**, stating in one line what the
  camera is used for and that video stays on the device. Firing the OS prompt cold is both
  worse UX and a worse grant rate.
- A **visible camera-on indicator** and a **kill switch** are present for the whole run.
- On pause, game-over, unmount, and tab-hide, the camera **track is stopped**, not merely
  ignored — the device's hardware indicator must go dark when the game is not being played.

### 7. Leaderboards: input modality is part of the board key

A run controlled by a smoothed 30 Hz camera axis and a run controlled by a mouse are not
the same difficulty. Merging them makes the board meaningless — the same fairness argument
ADR 0007 makes for parameter variants ("one player picks `gravity: 0.1` and the global
board is meaningless"). So the leaderboard key gains the input-source id.

Anti-cheat is **unchanged in kind**. The input log is a per-tick scalar; the server
re-simulates `(seed, inputLog)` with the same pure module and validates the score exactly
as it does today. Stated honestly: an axis log is fabricable, and so is a flap log — this
ADR neither improves nor regresses that property. What it does preserve is that raw
landmarks stay **out** of the log, so a tracker or model upgrade can never invalidate
previously-submitted runs.

### 8. The two games

Both are `RealtimeModule<S, { axis: number }>` — same input shape, different axis. That
they differ only in which axis they read is the evidence the seam generalises, the same way
Lumberjack was ADR 0002's evidence for `RealtimeModule`.

|               | Game A (no-gravity scroller)            | Game B (jet)                                |
| ------------- | --------------------------------------- | ------------------------------------------- |
| Axis          | Y (vertical)                            | X (horizontal)                              |
| Character     | Fixed X, player-controlled Y            | Fixed Y (low, centred), player-controlled X |
| Threat        | Gaps in left-scrolling obstacles        | Missiles converging on the jet              |
| Scoring       | Obstacles passed                        | Time survived / missiles dodged             |
| Control model | Direct position, no gravity, no impulse | Direct position                             |

Both stay pure, seeded, and PRNG-in-state per ADR 0002. Ids and display names are still
open (Game A is deliberately **not** a Floppy Birds variant — no gravity means different
rules, different feel, and a separate module).

### 9. Accessibility

Vision control cuts both ways and the DoD must reflect both:

- For some players it is a genuine **hands-free** input. Good.
- For others it is **unavailable** — no camera, limited mobility, a shared or public space,
  or simply not wanting to be on camera. Hence §5 is a hard requirement: camera control is
  never the only way to play, and never the only way to reach the leaderboard.
- A game demanding sustained physical movement should say so up front and keep runs short.
- `prefers-reduced-motion` obligations from ADR 0002 §5 carry over unchanged.

## Alternatives considered

1. **Put the tracker in the engine, as part of the module.** Rejected outright. It is I/O
   plus a clock plus a model — it violates the purity guardrail ADR 0001 and ADR 0002 both
   rest on, and it would mean the server needs a camera to re-simulate a run. Input
   acquisition is the controller's job; that split is the whole reason re-sim works.

2. **Put raw landmarks in the tick input and smooth inside `tick`.** Rejected. It inflates
   the input log from one scalar to a landmark set at 60 Hz, and it couples the game's
   rules to a specific tracker's output shape — a model upgrade would then change replay
   results and invalidate stored runs. Smoothing is input conditioning, not rules.

3. **Add an optional `axis` field to `RealtimeControls`.** Rejected: it is precisely the
   mistake ADR 0002 §Alternatives-1 refused when it declined to bolt `tick` onto
   `GameModule`. Discrete-action config and continuous-axis acquisition share no honest
   members — `keyMap` and `resolveTapAction` are meaningless for an axis, and `start`/
   `stop`/`getStatus` are meaningless for a keyboard. One interface would be
   "sometimes-meaningless" in both directions, and every consumer would branch on which.

4. **Vision as a global app setting rather than a per-run source.** Rejected. The choice is
   per-game (only some games have an axis) and must be changeable **mid-run** when the
   fallback ladder fires. A settings toggle cannot express "we lost the camera, we are now
   on pointer, here is how to get back".

5. **Full-body pose or eye tracking (e.g. WebGazer).** Rejected for scope. Both games need
   exactly one 2-D point; hand and face landmarkers deliver it more cheaply and more
   robustly than pose estimation, and eye tracking needs per-user calibration far beyond
   what a casual arcade run can justify.

6. **A separate "vision games" silo/route.** Rejected for the same reason ADR 0002 §Alt-2
   rejected an arcade silo: one catalog, one front door. These are real-time games that
   happen to offer a second input source.

## Consequences

**Positive**

- `packages/engine` is untouched; `useRealtimeLoop` is untouched; the three shipped
  real-time games are untouched. The change is additive and confined to one screen plus new
  files.
- Determinism, replay, and re-simulation anti-cheat all keep working with no new machinery,
  because the axis is just a different `I`.
- The axis pipeline is pure, so the hard part (does this _feel_ right?) is unit-testable
  without a camera.
- Both games are fully playable and e2e-testable with the camera off, so vision can land
  after the games rather than blocking them.
- A second tracker (generic object selection) and any third input source (gamepad, device
  tilt) drop in later against an interface that already exists.

**Negative / risks (and mitigations)**

- _Feel is the real risk, and it is not verifiable by tests._ Calibration, deadzone and
  filter constants decide whether these games are delightful or nauseating. → Budget an
  explicit tuning pass with real devices; keep the constants in one named, documented
  table, as `WORLD` already is for Floppy Birds.
- _Bundle weight._ Several MB of WASM + weights. → Lazy-loaded on demand, never in the
  initial bundle; the first-load budget for non-vision players is unchanged.
- _Low-end mobile performance._ Inference plus a 60 Hz sim plus rendering may not hold. →
  The §2 decoupling means a slow tracker degrades to a _less responsive_ control, not a
  slow game; add a frame-rate floor that drops to `pointer-axis` with a message.
- _Permission friction costs players at the door._ → §6's priming step, plus the game being
  immediately playable without the camera, means a denied prompt is not a lost player.
- _A second leaderboard key splits already-thin boards._ → Accepted; a merged board would
  be dishonest. The minimum-plays threshold question is shared with MPG-098 and should be
  answered once, for both.

## Recommendation — build order

1. **The seam first, with zero behaviour change** — `InputSource<I>`,
   `createActionInputSource(controls)`, and `RealtimePlayScreen` consuming a source. The
   three existing games must be pixel- and test-identical afterwards. (MPG-120)
2. **`pointer-axis` source** — the fallback rung, and the thing that makes the games
   buildable and e2e-testable before any camera work. (MPG-121)
3. **Both games, pointer-controlled** — engine modules + tests, then scenes + catalog
   wiring. Fully playable and shippable at this point. (MPG-122…MPG-125)
4. **The pure axis pipeline** — mirror, calibrate, deadzone, one-euro, clamp, with scripted
   landmark tests. (MPG-126)
5. **`Tracker` + MediaPipe hand/face**, lazy-loaded. (MPG-127)
6. **`vision-axis` source** — camera lifecycle, priming, overlay, status, fallback ladder,
   kill switch. (MPG-128)
7. **Modality-keyed leaderboards.** (MPG-129)
8. **Later:** the generic object tracker, behind the `Tracker` interface. (MPG-130)

Steps 1–3 deliver two finished games with no vision dependency at all. If the camera work
stalls on device reality, the catalog still gained two games — which is the point of the
ordering.

## Revisit triggers

- **The feel tuning fails on real devices** — if hand/head control cannot be made to feel
  good after a dedicated pass, that is a product signal about the whole category, not a
  constant to keep nudging.
- **A vision game wants live multiplayer** — reopens ADR 0002's own revisit trigger
  (shared-clock multiplayer), not this ADR.
- **A third input source with a genuinely different shape** (e.g. one supplying discrete
  gestures rather than an axis) — check whether `InputSource` still fits before widening it.
- **On-device model APIs land in browsers** (a standard shape-detection or pose API with
  real support) — could replace the MediaPipe dependency behind `Tracker` with no change
  above it. That is the boundary paying off, and should be a cheap swap by construction.
- **Raw landmarks are ever wanted in the log** (e.g. for gesture replay) — that reopens §7
  and the replay-invalidation argument with it.

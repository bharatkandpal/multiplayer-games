import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeGameId, RealtimeModule } from "@mpg/engine";

/**
 * The impure controller for a real-time game (MPG-040c, ADR 0002) — the arcade
 * counterpart to `useLocalPlayController`. It owns everything the pure
 * `RealtimeModule` deliberately does not: the `requestAnimationFrame` loop, the
 * wall-clock → fixed-step accumulator (so the sim is frame-rate independent and
 * deterministic), per-tick DOM input sampling, pause/resume (incl. auto-pause when
 * the tab is backgrounded), and the run-complete seam.
 *
 * Determinism is preserved end-to-end: the module ticks at a FIXED rate regardless of
 * frame rate, and every tick's input is recorded into an input log. Combined with the
 * seed, that log makes a run fully reproducible — a server can re-simulate it with the
 * same shared module to validate a submitted score (leaderboard anti-cheat, north-star).
 */

/** ready → running ⇄ paused → over. `over` is terminal until `restart`. */
export type RealtimeLoopPhase = "ready" | "running" | "paused" | "over";

/** Fired once when a run ends. Carries the seed + per-tick input log for server re-sim. */
export interface RunComplete<I> {
  gameId: RealtimeGameId;
  score: number;
  seed: number;
  /** One entry per tick consumed — replay `(seed, inputLog)` to reproduce the run. */
  inputLog: readonly I[];
}

export interface UseRealtimeLoopParams<S, I> {
  module: RealtimeModule<S, I>;
  /** Seed for the initial run. `restart` can override it for a fresh run. */
  seed: number;
  /**
   * Samples the input for the NEXT tick, called exactly once per fixed tick. The
   * caller owns input state (e.g. reading + clearing a rising-edge "flap" ref) so the
   * hook stays game-agnostic.
   */
  sampleInput: () => I;
  /** Fired once, the tick the run first ends. */
  onRunComplete?: (result: RunComplete<I>) => void;
  /** Auto-pause when the window blurs / tab is hidden (default true). Never auto-resumes. */
  autoPauseOnBlur?: boolean;
}

export interface UseRealtimeLoopResult<S> {
  /** Latest simulation state — updated once per animation frame that ticked. */
  state: S;
  score: number;
  phase: RealtimeLoopPhase;
  /** Number of ticks consumed so far (== input-log length). */
  tickCount: number;
  /** Begin a `ready` run. No-op unless currently `ready`. */
  start: () => void;
  /** Pause a `running` run. No-op otherwise. */
  pause: () => void;
  /** Resume a `paused` run (no time catches up). No-op otherwise. */
  resume: () => void;
  /** Reset to a fresh `ready` run, optionally with a new seed. */
  restart: (seed?: number) => void;
}

// Cap the time consumed per frame so a long stall (tab switch, breakpoint) can't
// queue thousands of catch-up ticks — a classic "spiral of death" guard.
const MAX_FRAME_MS = 250;

export function useRealtimeLoop<S, I>({
  module,
  seed,
  sampleInput,
  onRunComplete,
  autoPauseOnBlur = true,
}: UseRealtimeLoopParams<S, I>): UseRealtimeLoopResult<S> {
  const [state, setState] = useState<S>(() => module.createInitialState(seed));
  const [score, setScore] = useState(0);
  const [phase, setPhase] = useState<RealtimeLoopPhase>("ready");
  const [tickCount, setTickCount] = useState(0);

  // Live values the rAF loop reads without re-subscribing. Refs (not effect deps) keep
  // the single loop stable for the component's lifetime, mirroring the spike controller.
  const moduleRef = useRef(module);
  moduleRef.current = module;
  const sampleInputRef = useRef(sampleInput);
  sampleInputRef.current = sampleInput;
  const onRunCompleteRef = useRef(onRunComplete);
  onRunCompleteRef.current = onRunComplete;
  const autoPauseRef = useRef(autoPauseOnBlur);
  autoPauseRef.current = autoPauseOnBlur;

  const seedRef = useRef(seed);
  const stateRef = useRef<S>(state);
  const inputLogRef = useRef<I[]>([]);
  const accRef = useRef(0);
  const lastRef = useRef(0);
  const rafRef = useRef(0);
  const phaseRef = useRef<RealtimeLoopPhase>("ready");
  const completedRef = useRef(false);

  const start = useCallback(() => {
    if (phaseRef.current !== "ready") return;
    accRef.current = 0;
    lastRef.current = 0; // next frame's dt starts at 0 (no jump from mount → start)
    phaseRef.current = "running";
    setPhase("running");
  }, []);

  const pause = useCallback(() => {
    if (phaseRef.current !== "running") return;
    phaseRef.current = "paused";
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    if (phaseRef.current !== "paused") return;
    accRef.current = 0;
    lastRef.current = 0; // discard the paused interval — no catch-up burst on resume
    phaseRef.current = "running";
    setPhase("running");
  }, []);

  const restart = useCallback((nextSeed?: number) => {
    if (nextSeed !== undefined) seedRef.current = nextSeed;
    const fresh = moduleRef.current.createInitialState(seedRef.current);
    stateRef.current = fresh;
    inputLogRef.current = [];
    accRef.current = 0;
    lastRef.current = 0;
    completedRef.current = false;
    phaseRef.current = "ready";
    setState(fresh);
    setScore(0);
    setTickCount(0);
    setPhase("ready");
  }, []);

  // The single rAF loop. Runs for the component's lifetime; gated by `phaseRef` so we
  // never tear down and rebuild it on state changes.
  useEffect(() => {
    const step = (now: number): void => {
      rafRef.current = requestAnimationFrame(step);
      const last = lastRef.current || now;
      lastRef.current = now;
      if (phaseRef.current !== "running") return;

      // Accumulate real elapsed time and consume it in FIXED ticks (framerate-independent).
      const tickMs = 1000 / moduleRef.current.tickHz;
      accRef.current += Math.min(now - last, MAX_FRAME_MS);
      let s = stateRef.current;
      let ticked = false;
      while (accRef.current >= tickMs) {
        const input = sampleInputRef.current();
        inputLogRef.current.push(input);
        s = moduleRef.current.tick(s, input);
        accRef.current -= tickMs;
        ticked = true;
        if (moduleRef.current.isGameOver(s)) break;
      }
      if (!ticked) return;

      stateRef.current = s;
      setState(s);
      setScore(moduleRef.current.getScore(s));
      setTickCount(inputLogRef.current.length);

      if (moduleRef.current.isGameOver(s) && !completedRef.current) {
        completedRef.current = true;
        phaseRef.current = "over"; // stop immediately, before the next frame
        setPhase("over");
        onRunCompleteRef.current?.({
          gameId: moduleRef.current.id,
          score: moduleRef.current.getScore(s),
          seed: seedRef.current,
          inputLog: inputLogRef.current.slice(),
        });
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Auto-pause when the tab is backgrounded so a run doesn't silently die off-screen
  // (ADR 0002 §5). Never auto-resumes — coming back is a deliberate user action.
  useEffect(() => {
    const pauseIfRunning = (): void => {
      if (autoPauseRef.current) pause();
    };
    const onVisibility = (): void => {
      if (document.hidden) pauseIfRunning();
    };
    window.addEventListener("blur", pauseIfRunning);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", pauseIfRunning);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pause]);

  return { state, score, phase, tickCount, start, pause, resume, restart };
}

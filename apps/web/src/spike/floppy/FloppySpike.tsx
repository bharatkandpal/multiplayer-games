// THROWAWAY SPIKE (MPG-039) — not shipped. See docs/adr/0002-realtime-games.md.
//
// Proves a realtime game loop is feasible inside our stack and shows where each
// responsibility lands relative to the proposed `RealtimeModule`:
//   - PURE module (floppyModule.ts): fixed-step tick(state, input) → state, PRNG in state.
//   - IMPURE controller (this file): requestAnimationFrame loop, wall-clock → dt
//     accumulator stepping the sim at a FIXED rate (determinism), DOM input sampling,
//     Canvas 2D rendering, and the score / game-over / restart / pause surface.
//
// Deliberately NOT to the full UX bar: plain Canvas, no design tokens/components, no
// tests, minimal a11y. It exists to inform the ADR, not to be MPG-040. Canvas 2D was
// chosen precisely because the animation-tech (three.js/WebGL) decision is PARKED —
// the spike must not smuggle in a renderer commitment.

import { useCallback, useEffect, useRef, useState } from "react";
import { WORLD, floppyBirds, type FloppyInput, type FloppyState } from "./floppyModule";

const TICK_MS = 1000 / floppyBirds.tickHz;
const CANVAS = 480; // px; world is 100u square → scale = 4.8

type Phase = "ready" | "running" | "over";

export function FloppySpike(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const [paused, setPaused] = useState(false);

  // Mutable loop refs (kept out of React state so the rAF loop never re-subscribes).
  const stateRef = useRef<FloppyState>(floppyBirds.createInitialState(1));
  const flapRef = useRef(false); // rising-edge input, consumed on the next tick
  const accRef = useRef(0);
  const lastRef = useRef(0);
  const rafRef = useRef(0);
  const phaseRef = useRef<Phase>("ready");
  const pausedRef = useRef(false);
  phaseRef.current = phase;
  pausedRef.current = paused;

  const draw = useCallback((s: FloppyState) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const k = CANVAS / WORLD.width;
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    // pipes
    ctx.fillStyle = "#3ddc84";
    for (const p of s.pipes) {
      const x = p.x * k;
      const w = WORLD.pipeWidth * k;
      const gapTop = (p.gapY - WORLD.pipeGap / 2) * k;
      const gapBottom = (p.gapY + WORLD.pipeGap / 2) * k;
      ctx.fillRect(x, 0, w, gapTop);
      ctx.fillRect(x, gapBottom, w, CANVAS - gapBottom);
    }
    // bird
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(WORLD.birdX * k, s.birdY * k, WORLD.birdRadius * k, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  const reset = useCallback(() => {
    stateRef.current = floppyBirds.createInitialState((Date.now() & 0xffff) || 1);
    accRef.current = 0;
    flapRef.current = false;
    setScore(0);
    setPhase("ready");
    draw(stateRef.current);
  }, [draw]);

  // The single rAF loop. Runs for the component's lifetime; behavior is gated by
  // phase/paused refs so we never tear down and rebuild the loop on state changes.
  useEffect(() => {
    const step = (now: number) => {
      rafRef.current = requestAnimationFrame(step);
      const last = lastRef.current || now;
      lastRef.current = now;

      if (phaseRef.current !== "running" || pausedRef.current) return;

      // Clamp to avoid a spiral of death after a tab-switch; accumulate real time
      // and consume it in FIXED ticks so the sim is framerate-independent.
      accRef.current += Math.min(now - last, 250);
      let s = stateRef.current;
      while (accRef.current >= TICK_MS) {
        const input: FloppyInput = { flap: flapRef.current };
        flapRef.current = false;
        s = floppyBirds.tick(s, input);
        accRef.current -= TICK_MS;
        if (floppyBirds.isGameOver(s)) break;
      }
      stateRef.current = s;
      draw(s);
      setScore(floppyBirds.getScore(s));

      if (floppyBirds.isGameOver(s)) {
        setPhase("over");
        // SEAM: this is where a shipped realtime screen would fire
        // onRunComplete({ gameId, score, seed }) → leaderboard (north-star).
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  useEffect(() => {
    draw(stateRef.current);
  }, [draw]);

  const flap = useCallback(() => {
    if (phaseRef.current === "ready") {
      accRef.current = 0;
      lastRef.current = 0;
      setPhase("running");
    }
    if (phaseRef.current === "over") return;
    flapRef.current = true;
  }, []);

  // Keyboard: Space/ArrowUp to flap, P to pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        flap();
      } else if (e.key.toLowerCase() === "p") {
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flap]);

  return (
    <div style={{ fontFamily: "system-ui", color: "#e8eaf0", background: "#05070f", minHeight: "100vh", padding: 24 }}>
      <p style={{ opacity: 0.6, fontSize: 13, margin: "0 0 8px" }}>
        THROWAWAY SPIKE — MPG-039. Not the shipped game. Canvas 2D on purpose (renderer choice is parked).
      </p>
      <h1 style={{ margin: "0 0 4px" }}>Floppy Birds (spike)</h1>
      <p style={{ margin: "0 0 12px", opacity: 0.8 }}>
        Click / tap the canvas or press Space to flap. P to pause. Score: <strong>{score}</strong>
        {paused ? " — PAUSED" : ""}
      </p>
      <div style={{ position: "relative", width: CANVAS }}>
        <canvas
          ref={canvasRef}
          width={CANVAS}
          height={CANVAS}
          onPointerDown={flap}
          style={{ borderRadius: 12, cursor: "pointer", touchAction: "none", display: "block" }}
        />
        {phase !== "running" ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "rgba(5,7,15,0.55)",
              borderRadius: 12,
              textAlign: "center",
            }}
          >
            <div>
              {phase === "over" ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>Game over</div>
                  <div style={{ margin: "6px 0 16px" }}>Final score: {score}</div>
                  <button onClick={reset} style={btn}>Play again</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Tap / Space to start</div>
                  <button onClick={flap} style={btn}>Start</button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "10px 18px",
  fontSize: 16,
  borderRadius: 8,
  border: "none",
  background: "#3ddc84",
  color: "#05070f",
  fontWeight: 700,
  cursor: "pointer",
};

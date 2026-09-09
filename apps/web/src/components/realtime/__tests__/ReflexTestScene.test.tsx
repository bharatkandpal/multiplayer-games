import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { REFLEX, reflexTest, type ReflexInput, type ReflexState } from "@mpg/engine";

import { ReflexTestScene } from "../ReflexTestScene";
import type { RealtimeLoopPhase } from "../../../game";

const IDLE: ReflexInput = { tap: false };
const TAP: ReflexInput = { tap: true };

/** Ticks with no input until the panel turns green. */
function tickToGreen(start: ReflexState): ReflexState {
  let state = start;
  for (let i = 0; i < 10_000 && state.light !== "go"; i += 1) {
    state = reflexTest.tick(state, IDLE);
  }
  return state;
}

/** Waits for green, idles `reactTicks` ticks, then taps — one completed round. */
function playRound(start: ReflexState, reactTicks: number): ReflexState {
  let state = tickToGreen(start);
  for (let i = 0; i < reactTicks - 1; i += 1) state = reflexTest.tick(state, IDLE);
  return reflexTest.tick(state, TAP);
}

function renderScene(state: ReflexState, phase: RealtimeLoopPhase = "running"): void {
  render(
    <ReflexTestScene
      state={state}
      phase={phase}
      score={reflexTest.getScore(state)}
      reducedMotion={false}
    />,
  );
}

describe("ReflexTestScene", () => {
  it("shows an inert panel before the run starts", () => {
    // A live red "WAIT" on the ready overlay would have the player reacting to a
    // signal that isn't running yet.
    renderScene(reflexTest.createInitialState(1), "ready");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText("WAIT")).not.toBeInTheDocument();
  });

  it("labels the red panel with a word, not colour alone", () => {
    renderScene(reflexTest.createInitialState(1));
    expect(screen.getByText("WAIT")).toBeInTheDocument();
  });

  it("labels the green panel with a word, not colour alone", () => {
    renderScene(tickToGreen(reflexTest.createInitialState(1)));
    expect(screen.getByText("GO — TAP!")).toBeInTheDocument();
  });

  it("exposes the light state as data for styling and assertions", () => {
    const { container } = render(
      <ReflexTestScene
        state={tickToGreen(reflexTest.createInitialState(1))}
        phase="running"
        score={0}
        reducedMotion={false}
      />,
    );
    expect(container.querySelector('[data-light="go"]')).not.toBeNull();
  });

  it("counts up the live reaction time while the panel is green", () => {
    let state = tickToGreen(reflexTest.createInitialState(1));
    for (let i = 0; i < 40; i += 1) state = reflexTest.tick(state, IDLE);
    renderScene(state);
    expect(screen.getByText("200 ms")).toBeInTheDocument();
  });

  it("shows the round counter", () => {
    // After one completed round the player is on round 2 of 5. Scoped to the
    // counter line — bare digits also appear as round indices in the list below.
    const state = playRound(reflexTest.createInitialState(1), 40);
    renderScene(state);
    expect(screen.getByText(/Round/).textContent).toMatch(
      new RegExp(`Round\\s*2\\s*of\\s*${REFLEX.rounds}`),
    );
  });

  it("lists every round, marking unplayed ones for assistive tech", () => {
    renderScene(reflexTest.createInitialState(1));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(REFLEX.rounds);
    expect(screen.getAllByText("not yet played")).toHaveLength(REFLEX.rounds);
  });

  it("shows each completed round's time", () => {
    let state = reflexTest.createInitialState(13);
    state = playRound(state, 60); // 300ms
    state = playRound(state, 40); // 200ms
    renderScene(state);
    // Scoped to the round list: these same times also appear in the best/average
    // summary, so an unscoped query is ambiguous.
    const rounds = within(screen.getByRole("list"));
    expect(rounds.getByText("300 ms")).toBeInTheDocument();
    expect(rounds.getByText("200 ms")).toBeInTheDocument();
    expect(rounds.getAllByText("not yet played")).toHaveLength(REFLEX.rounds - 2);
  });

  it("reports best and average once rounds are banked", () => {
    let state = reflexTest.createInitialState(13);
    state = playRound(state, 60); // 300ms
    state = playRound(state, 40); // 200ms
    state = playRound(state, 50); // 250ms
    renderScene(state);

    const best = screen.getByText("Best").closest("div");
    const average = screen.getByText("Average").closest("div");
    expect(best).not.toBeNull();
    expect(average).not.toBeNull();
    expect(best?.textContent).toContain("200 ms");
    expect(average?.textContent).toContain("250 ms");
  });

  it("has no best/average before any round completes", () => {
    renderScene(reflexTest.createInitialState(13));
    expect(screen.getByText("Best").closest("div")?.textContent).toContain("—");
    expect(screen.getByText("Average").closest("div")?.textContent).toContain("—");
  });

  it("explains a false start in plain language rather than just turning a colour", () => {
    const state = reflexTest.tick(reflexTest.createInitialState(5), TAP);
    expect(state.falseStart).toBe(true);
    renderScene(state);
    expect(screen.getByText("Too soon!")).toBeInTheDocument();
    expect(screen.getByText("You tapped before the panel turned green.")).toBeInTheDocument();
  });

  describe("finished run", () => {
    /** Plays all five rounds, reacting in 40 ticks (200ms) each. */
    function playFullRun(): ReflexState {
      let state = reflexTest.createInitialState(17);
      for (let r = 0; r < REFLEX.rounds; r += 1) state = playRound(state, 40);
      return state;
    }

    it("does not leave the panel on a green 'GO' once the run is over", () => {
      // The last round leaves `light` on "go", so the finished run used to sit on
      // a green GO panel — inviting a tap when there is nothing left to tap.
      const state = playFullRun();
      expect(state.over).toBe(true);
      expect(state.light).toBe("go");

      renderScene(state, "over");
      expect(screen.queryByText("GO — TAP!")).not.toBeInTheDocument();
      expect(screen.getByText("All 5 rounds done")).toBeInTheDocument();
    });

    it("still shows best and average after the run ends", () => {
      renderScene(playFullRun(), "over");
      expect(screen.getByText("Best").closest("div")?.textContent).toContain("200 ms");
      expect(screen.getByText("Average").closest("div")?.textContent).toContain("200 ms");
    });
  });
});

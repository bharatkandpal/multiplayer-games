import { describe, it, expect } from "vitest";
import {
  BREAKOUT_WORLD,
  breakout,
  brickRect,
  type BreakoutInput,
  type BreakoutState,
} from "./breakout";
import { clearRealtimeRegistry, getRealtimeGame } from "./realtime-registry";
import { registerBuiltInRealtimeGames } from "./realtime-games";

const IDLE: BreakoutInput = { move: null };
const LEFT: BreakoutInput = { move: "left" };
const RIGHT: BreakoutInput = { move: "right" };

function brickCount(state: BreakoutState): number {
  return state.bricks.filter((b) => b === 1).length;
}

describe("breakout module", () => {
  it("starts with a full wall, all lives, and the ball above the paddle", () => {
    const state = breakout.createInitialState(1);
    expect(brickCount(state)).toBe(BREAKOUT_WORLD.cols * BREAKOUT_WORLD.rows);
    expect(state.lives).toBe(BREAKOUT_WORLD.lives);
    expect(state.score).toBe(0);
    expect(state.over).toBe(false);
    expect(state.ballVY).toBeLessThan(0); // launched upward
    expect(state.ballY).toBeLessThan(BREAKOUT_WORLD.paddleY);
  });

  it("moves the paddle under input and clamps it to the walls", () => {
    let state = breakout.createInitialState(1);
    const start = state.paddleX;
    state = breakout.tick(state, RIGHT);
    expect(state.paddleX).toBeGreaterThan(start);

    // Drive it hard right for many ticks — it must stop at the wall, not pass it.
    for (let i = 0; i < 200; i += 1) state = breakout.tick(state, RIGHT);
    expect(state.paddleX).toBeLessThanOrEqual(
      BREAKOUT_WORLD.width - BREAKOUT_WORLD.paddleWidth / 2,
    );
    expect(state.paddleX).toBeCloseTo(BREAKOUT_WORLD.width - BREAKOUT_WORLD.paddleWidth / 2, 5);

    // ...and all the way left.
    for (let i = 0; i < 200; i += 1) state = breakout.tick(state, LEFT);
    expect(state.paddleX).toBeCloseTo(BREAKOUT_WORLD.paddleWidth / 2, 5);
  });

  it("coasts after the last input, then stops", () => {
    let state = breakout.createInitialState(1);
    state = breakout.tick(state, RIGHT);
    expect(state.paddleVX).toBeGreaterThan(0);
    // No further input: velocity persists through the coast window, then zeroes.
    for (let i = 0; i < BREAKOUT_WORLD.paddleCoastTicks; i += 1) {
      state = breakout.tick(state, IDLE);
    }
    expect(state.paddleVX).toBe(0);
  });

  it("bounces the ball off a side wall (vx flips sign)", () => {
    let state = breakout.createInitialState(1);
    // Aim the ball straight at the right wall from mid-field, no bricks in the way.
    state = {
      ...state,
      bricks: state.bricks.map(() => 0),
      ballX: 90,
      ballY: 50,
      ballVX: 2,
      ballVY: 0,
    };
    // Clearing the wall triggers a refill on the next tick; re-clear so the ball
    // travels freely to the wall.
    let sawFlip = false;
    for (let i = 0; i < 40 && !sawFlip; i += 1) {
      const before = state.ballVX;
      state = breakout.tick({ ...state, bricks: state.bricks.map(() => 0) }, IDLE);
      if (Math.sign(state.ballVX) !== Math.sign(before)) sawFlip = true;
    }
    expect(sawFlip).toBe(true);
  });

  it("clears a brick and scores when the ball reaches the wall", () => {
    const base = breakout.createInitialState(1);
    // Park the ball just under brick 0, moving up into it; still the paddle's ball.
    const { x0, y1 } = brickRect(0);
    let state: BreakoutState = {
      ...base,
      ballX: (x0 + brickRect(0).x1) / 2,
      ballY: y1 + BREAKOUT_WORLD.ballRadius + 0.2,
      ballVX: 0,
      ballVY: -base.ballSpeed,
    };
    const startCount = brickCount(state);
    let hit = false;
    for (let i = 0; i < 20 && !hit; i += 1) {
      state = breakout.tick(state, IDLE);
      if (brickCount(state) < startCount) hit = true;
    }
    expect(hit).toBe(true);
    expect(state.score).toBe(BREAKOUT_WORLD.pointsPerBrick);
    expect(state.ballVY).toBeGreaterThan(0); // reflected downward off the brick
  });

  it("loses a life when the ball falls past the bottom, and relaunches", () => {
    const base = breakout.createInitialState(1);
    const state: BreakoutState = {
      ...base,
      ballX: 50,
      ballY: BREAKOUT_WORLD.height - 1,
      ballVX: 0,
      ballVY: 3,
    };
    const after = breakout.tick(state, IDLE);
    expect(after.lives).toBe(BREAKOUT_WORLD.lives - 1);
    expect(after.over).toBe(false);
    expect(after.ballVY).toBeLessThan(0); // relaunched upward
  });

  it("ends the run when the last life is lost", () => {
    const base = breakout.createInitialState(1);
    const state: BreakoutState = {
      ...base,
      lives: 1,
      ballX: 50,
      ballY: BREAKOUT_WORLD.height - 1,
      ballVX: 0,
      ballVY: 3,
    };
    const after = breakout.tick(state, IDLE);
    expect(after.lives).toBe(0);
    expect(after.over).toBe(true);
    expect(breakout.isGameOver(after)).toBe(true);
  });

  it("refills the wall and speeds up when every brick is cleared", () => {
    const base = breakout.createInitialState(1);
    // One brick left, ball about to strike it; clearing it empties the wall.
    const idx = 0;
    const { x0, x1, y1 } = brickRect(idx);
    const bricks = base.bricks.map((_, i) => (i === idx ? 1 : 0));
    const state: BreakoutState = {
      ...base,
      bricks,
      ballX: (x0 + x1) / 2,
      ballY: y1 + BREAKOUT_WORLD.ballRadius + 0.2,
      ballVX: 0,
      ballVY: -base.ballSpeed,
    };
    let after = state;
    for (let i = 0; i < 20 && after.level === base.level; i += 1) {
      after = breakout.tick(after, IDLE);
    }
    expect(after.level).toBe(base.level + 1);
    expect(brickCount(after)).toBe(BREAKOUT_WORLD.cols * BREAKOUT_WORLD.rows); // refilled
    expect(after.ballSpeed).toBeGreaterThan(base.ballSpeed);
  });

  it("freezes once over — further ticks are no-ops", () => {
    const over: BreakoutState = { ...breakout.createInitialState(1), over: true };
    expect(breakout.tick(over, RIGHT)).toBe(over);
  });

  it("is deterministic: same seed + inputs reproduce the run exactly", () => {
    const inputs: BreakoutInput[] = [RIGHT, RIGHT, IDLE, LEFT, IDLE, LEFT, RIGHT, IDLE];
    const run = (): BreakoutState => {
      let s = breakout.createInitialState(24680);
      for (let i = 0; i < 300; i += 1) s = breakout.tick(s, inputs[i % inputs.length] ?? IDLE);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("keeps the ball speed constant across a wall bounce", () => {
    const base = breakout.createInitialState(1);
    const state: BreakoutState = {
      ...base,
      bricks: base.bricks.map(() => 1),
      ballX: BREAKOUT_WORLD.width - 2,
      ballY: 60,
      ballVX: base.ballSpeed,
      ballVY: 0,
    };
    const after = breakout.tick(state, IDLE);
    expect(Math.hypot(after.ballVX, after.ballVY)).toBeCloseTo(base.ballSpeed, 5);
  });
});

describe("breakout registry wiring", () => {
  it("is registered as a realtime game", () => {
    clearRealtimeRegistry();
    registerBuiltInRealtimeGames();
    const module = getRealtimeGame("breakout");
    expect(module.id).toBe("breakout");
    expect(module.kind).toBe("realtime");
  });
});

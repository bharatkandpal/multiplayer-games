import { describe, expect, it } from "vitest";
import {
  snake,
  SNAKE,
  stepTicks,
  foodsEaten,
  snakeLength,
  type SnakeDir,
  type SnakeInput,
  type SnakeState,
} from "./snake";

const SIZE = SNAKE.size;
const NO_INPUT: SnakeInput = { turn: null };

/** Row/col → board index, so tests read as coordinates rather than arithmetic. */
function at(row: number, col: number): number {
  return row * SIZE + col;
}

/** Runs `n` ticks with no input. */
function idle(state: SnakeState, n: number): SnakeState {
  let s = state;
  for (let i = 0; i < n; i += 1) s = snake.tick(s, NO_INPUT);
  return s;
}

/** Ticks until the snake takes exactly one step (or the run ends). */
function oneStep(state: SnakeState, input: SnakeInput = NO_INPUT): SnakeState {
  const before = state.snake[0];
  let s = snake.tick(state, input);
  // Guard the loop so a bug that stops the snake fails as an assertion below
  // rather than hanging the suite.
  for (let i = 0; i < 100 && !s.over && s.snake[0] === before; i += 1) {
    s = snake.tick(s, NO_INPUT);
  }
  return s;
}

/**
 * A state with the food parked somewhere harmless, so a test about movement
 * isn't perturbed by an accidental meal. `null` would also work, but that is the
 * board-full sentinel and means something else entirely.
 */
function withFoodAway(state: SnakeState): SnakeState {
  return { ...state, food: at(0, 0) };
}

describe("snake — module contract", () => {
  it("is a registered realtime module", () => {
    expect(snake.id).toBe("snake");
    expect(snake.kind).toBe("realtime");
    expect(snake.tickHz).toBeGreaterThan(0);
  });

  it("starts with a body, a heading, a score of zero, and food on the board", () => {
    const state = snake.createInitialState(1);
    expect(snakeLength(state)).toBe(SNAKE.startLength);
    expect(state.dir).toBe("right");
    expect(snake.getScore(state)).toBe(0);
    expect(snake.isGameOver(state)).toBe(false);
    expect(state.food).not.toBeNull();
  });

  it("starts with the head first and the body trailing behind it", () => {
    const state = snake.createInitialState(7);
    const [head, second] = state.snake;
    // Heading right means each body cell is one column to the LEFT of the last.
    expect(head).toBe((second ?? 0) + 1);
  });

  it("never places the starting food under the snake", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const state = snake.createInitialState(seed);
      expect(state.snake).not.toContain(state.food);
    }
  });
});

describe("snake — determinism", () => {
  it("replays identically from the same seed and input log", () => {
    const inputs: SnakeInput[] = Array.from({ length: 400 }, (_, i) => ({
      turn: i % 17 === 0 ? (["up", "left", "down", "right"][i % 4] as SnakeDir) : null,
    }));
    const run = (): SnakeState => {
      let s = snake.createInitialState(4242);
      for (const input of inputs) s = snake.tick(s, input);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("diverges between seeds (the food is actually seeded)", () => {
    const foods = new Set(
      Array.from({ length: 50 }, (_, seed) => snake.createInitialState(seed).food),
    );
    expect(foods.size).toBeGreaterThan(1);
  });

  it("uses no ambient randomness or clock", () => {
    // Same state in, same state out — twice, with real time passing between.
    const state = snake.createInitialState(9);
    const a = snake.tick(state, { turn: "up" });
    const b = snake.tick(state, { turn: "up" });
    expect(a).toEqual(b);
  });
});

describe("snake — movement", () => {
  it("moves one cell per step interval, not one per tick", () => {
    const start = withFoodAway(snake.createInitialState(3));
    const head = start.snake[0] ?? 0;
    const interval = stepTicks(0);

    const justBefore = idle(start, interval - 1);
    expect(justBefore.snake[0]).toBe(head);

    const stepped = idle(start, interval);
    expect(stepped.snake[0]).toBe(head + 1); // one column right
  });

  it("keeps its length when it does not eat", () => {
    const start = withFoodAway(snake.createInitialState(3));
    const moved = oneStep(start);
    expect(snakeLength(moved)).toBe(snakeLength(start));
  });

  it("applies a queued turn at the next step, not mid-cell", () => {
    const start = withFoodAway(snake.createInitialState(3));
    const head = start.snake[0] ?? 0;
    // Steer up on the very first tick; the head must not move until the step.
    const steered = snake.tick(start, { turn: "up" });
    expect(steered.snake[0]).toBe(head);
    expect(steered.pendingDir).toBe("up");

    const stepped = oneStep(steered);
    expect(stepped.snake[0]).toBe(head - SIZE); // one row up
    expect(stepped.dir).toBe("up");
  });

  it("honours a turn requested on the same tick as the step", () => {
    const start = withFoodAway(snake.createInitialState(3));
    const head = start.snake[0] ?? 0;
    const interval = stepTicks(0);
    // Land the steer exactly on the tick that also steps.
    const s = snake.tick(idle(start, interval - 1), { turn: "down" });
    expect(s.snake[0]).toBe(head + SIZE);
  });
});

describe("snake — steering rules", () => {
  it("rejects a 180° reversal instead of killing the run", () => {
    const start = withFoodAway(snake.createInitialState(3)); // heading right
    const s = snake.tick(start, { turn: "left" });
    expect(s.pendingDir).toBeNull();

    const stepped = oneStep(s);
    expect(stepped.over).toBe(false);
    expect(stepped.dir).toBe("right");
  });

  it("cannot compose two fast turns into a fatal reversal", () => {
    // Heading right: "up" is legal, and "left" after it must still be rejected —
    // validated against the direction TRAVELLED, not against the queued turn.
    const start = withFoodAway(snake.createInitialState(3));
    const queued = snake.tick(start, { turn: "up" });
    const then = snake.tick(queued, { turn: "left" });
    expect(then.pendingDir).toBe("up");

    const stepped = oneStep(then);
    expect(stepped.over).toBe(false);
    expect(stepped.dir).toBe("up");
  });

  it("ignores a turn into the direction it is already travelling", () => {
    const start = withFoodAway(snake.createInitialState(3));
    const s = snake.tick(start, { turn: "right" });
    expect(s.pendingDir).toBeNull();
  });

  it("lets a later legal turn replace an earlier queued one", () => {
    const start = withFoodAway(snake.createInitialState(3));
    const s = snake.tick(snake.tick(start, { turn: "up" }), { turn: "down" });
    expect(s.pendingDir).toBe("down");
  });
});

describe("snake — eating and growth", () => {
  /** Parks the food directly in front of the head. */
  function foodAhead(state: SnakeState): SnakeState {
    const head = state.snake[0] ?? 0;
    return { ...state, food: head + 1 };
  }

  it("scores and grows on eating, and places new food off the snake", () => {
    const start = foodAhead(snake.createInitialState(5));
    const ate = oneStep(start);

    expect(snake.getScore(ate)).toBe(SNAKE.foodScore);
    expect(foodsEaten(ate)).toBe(1);
    expect(ate.food).not.toBe(start.food);
    expect(ate.snake).not.toContain(ate.food);
  });

  it("grows by exactly one segment per food", () => {
    const start = foodAhead(snake.createInitialState(5));
    const before = snakeLength(start);
    const ate = oneStep(start);
    // Growth is paid on the eating step itself.
    expect(snakeLength(ate)).toBe(before + SNAKE.growPerFood);
    // ...and then the length holds on the following step.
    expect(snakeLength(oneStep(withFoodAway(ate)))).toBe(before + SNAKE.growPerFood);
  });

  it("speeds up as the snake eats, down to a floor", () => {
    expect(stepTicks(0)).toBe(SNAKE.startStepTicks);
    expect(stepTicks(SNAKE.foodsPerSpeedUp)).toBe(SNAKE.startStepTicks - 1);
    expect(stepTicks(10_000)).toBe(SNAKE.minStepTicks);
    // Monotonic, never below the floor.
    for (let eaten = 0; eaten < 200; eaten += 1) {
      expect(stepTicks(eaten)).toBeGreaterThanOrEqual(SNAKE.minStepTicks);
      expect(stepTicks(eaten + 1)).toBeLessThanOrEqual(stepTicks(eaten));
    }
  });
});

describe("snake — ways the run ends", () => {
  it("ends on hitting a wall", () => {
    // Park the head one cell from the right wall, heading right.
    const base = withFoodAway(snake.createInitialState(3));
    const head = at(5, SIZE - 1);
    const state: SnakeState = { ...base, snake: [head, head - 1, head - 2], dir: "right" };

    const stepped = oneStep(state);
    expect(snake.isGameOver(stepped)).toBe(true);
    // The head stays on the board — nothing renders off-grid on the game-over frame.
    expect(stepped.snake[0]).toBe(head);
  });

  it("ends on running into its own body", () => {
    // A coil: turning down drives the head into a MID-body cell — not the tail,
    // which is a separate (legal) case covered below.
    const head = at(5, 5);
    const base = withFoodAway(snake.createInitialState(3));
    const state: SnakeState = {
      ...base,
      snake: [head, head - 1, head - 1 + SIZE, head + SIZE, head + SIZE + 1],
      dir: "right",
      grow: 0,
    };
    const stepped = oneStep(state, { turn: "down" });
    expect(snake.isGameOver(stepped)).toBe(true);
  });

  it("allows moving into the cell the tail is vacating", () => {
    // Classic edge case: the tail moves away on the same step, so this is legal.
    const head = at(5, 5);
    const tail = head + SIZE;
    const base = withFoodAway(snake.createInitialState(3));
    const state: SnakeState = {
      ...base,
      snake: [head, head - 1, head - 1 + SIZE, tail],
      dir: "right",
      grow: 0,
    };
    const stepped = oneStep(state, { turn: "down" });
    expect(stepped.over).toBe(false);
    expect(stepped.snake[0]).toBe(tail);
  });

  it("does NOT allow that when growth is owed (the tail stays put)", () => {
    const head = at(5, 5);
    const tail = head + SIZE;
    const base = withFoodAway(snake.createInitialState(3));
    const state: SnakeState = {
      ...base,
      snake: [head, head - 1, head - 1 + SIZE, tail],
      dir: "right",
      grow: 1,
    };
    const stepped = oneStep(state, { turn: "down" });
    expect(snake.isGameOver(stepped)).toBe(true);
  });

  it("ends when the snake fills the board rather than hunting for food forever", () => {
    // Every cell but the one ahead of the head is occupied; eating it completes
    // the board, so there is nowhere left to place food.
    const base = snake.createInitialState(3);
    const all = Array.from({ length: SIZE * SIZE }, (_, i) => i);
    const head = at(0, 0);
    const body = all.filter((c) => c !== head && c !== head + 1);
    const state: SnakeState = {
      ...base,
      snake: [head, ...body],
      dir: "right",
      food: head + 1,
      grow: 0,
    };

    const stepped = oneStep(state);
    expect(stepped.food).toBeNull();
    expect(snake.isGameOver(stepped)).toBe(true);
    expect(snake.getScore(stepped)).toBe(SNAKE.foodScore);
  });

  it("freezes once over — further ticks change nothing", () => {
    const base = withFoodAway(snake.createInitialState(3));
    const over: SnakeState = { ...base, over: true };
    expect(snake.tick(over, { turn: "up" })).toBe(over);
    expect(snake.getScore(idle(over, 50))).toBe(over.score);
  });

  it("never leaves the board or duplicates a cell over a long random run", () => {
    // A fuzz pass: whatever the input, the invariants hold every tick.
    for (let seed = 0; seed < 25; seed += 1) {
      let state = snake.createInitialState(seed);
      let rolling = seed;
      for (let i = 0; i < 600 && !state.over; i += 1) {
        rolling = (rolling * 1103515245 + 12345) & 0x7fffffff;
        const turn =
          rolling % 5 === 0 ? (["up", "down", "left", "right"][rolling % 4] as SnakeDir) : null;
        state = snake.tick(state, { turn });

        for (const cell of state.snake) {
          expect(cell).toBeGreaterThanOrEqual(0);
          expect(cell).toBeLessThan(SIZE * SIZE);
        }
        expect(new Set(state.snake).size).toBe(state.snake.length);
        if (state.food !== null) expect(state.snake).not.toContain(state.food);
        expect(snake.getScore(state)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

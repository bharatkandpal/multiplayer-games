// Tests for MPG-014: server-side AI turn-advancement loop.
//
// The first block exercises `BotRunner` directly against a real `RoomManager` (no
// Socket.IO) — fast, deterministic-enough unit coverage of the scheduling contract.
// The last block goes through a real HTTP + Socket.IO server (mirrors
// gameHandlers.test.ts) to prove the wiring in `moveHandler.ts` actually drives a bot
// seat end-to-end for a real client.

import type { AddressInfo } from "node:net";

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

import { getGame, registerBuiltInGames, clearRegistry } from "@mpg/engine";
import type { Result } from "@mpg/engine";

import { BotRunner } from "../botRunner.js";
import { RoomManager } from "../RoomManager.js";
import type { Room, Slot } from "../types.js";
// Importing index.js registers the built-in games as a side effect (and gives the
// integration block below the shared HTTP/Socket.IO/RoomManager singleton) — do this
// once, statically, rather than each block trying to register independently.
import { httpServer, io as sharedIo, roomManager as sharedRoomManager } from "../../index.js";

/** Polls `predicate` until it's truthy or `timeoutMs` elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface RecordedUpdate {
  room: Room;
  lastMove: { slot: Slot; move: unknown };
}

function makeRecordingRunner(
  roomManager: RoomManager,
  options?: ConstructorParameters<typeof BotRunner>[2],
): {
  runner: BotRunner;
  updates: RecordedUpdate[];
  gameOvers: { room: Room; result: Result }[];
} {
  const updates: RecordedUpdate[] = [];
  const gameOvers: { room: Room; result: Result }[] = [];
  const runner = new BotRunner(
    roomManager,
    {
      onUpdate: (room, lastMove) => updates.push({ room, lastMove }),
      onGameOver: (room, result) => gameOvers.push({ room, result }),
    },
    { minReplyDelayMs: 1, maxReplyDelayMs: 5, ...options },
  );
  return { runner, updates, gameOvers };
}

describe("BotRunner (unit, no transport)", () => {
  let roomManager: RoomManager;

  beforeEach(() => {
    roomManager = new RoomManager({ pacingMs: 10 });
  });

  afterEach(() => {
    roomManager.destroy();
  });

  it("human-vs-bot: after the human's move, the bot auto-responds with a valid move", () => {
    const { room } = roomManager.createRoom("tictactoe", [
      { slot: 1, kind: "human", self: true },
      { slot: 2, kind: "bot", difficulty: "hard" },
    ]);
    expect(room.status).toBe("active");
    expect(room.turn).toBe(1);

    const { runner, updates } = makeRecordingRunner(roomManager);

    // Simulate the human's move the way moveHandler.ts does: apply it directly, then
    // ask the runner to take over if the next turn is a bot's.
    const module = getGame("tictactoe");
    room.state = module.applyMove(room.state as never, { cell: 4 }, 1);
    room.turn = module.currentPlayer(room.state as never);
    runner.scheduleNext(room, false);

    return waitFor(() => updates.length === 1).then(() => {
      const update = updates[0];
      expect(update?.lastMove.slot).toBe(2);
      const board = (update?.room.state as { board: (number | null)[] }).board;
      expect(board[4]).toBe(1); // the human's move landed
      // The bot placed a mark somewhere else on the board.
      expect(board.filter((c) => c !== null)).toHaveLength(2);
      runner.destroy();
    });
  });

  it("bot-vs-bot: the game auto-plays to completion without any human input", async () => {
    const { room } = roomManager.createRoom("tictactoe", [
      { slot: 1, kind: "bot", difficulty: "easy" },
      { slot: 2, kind: "bot", difficulty: "hard" },
    ]);
    expect(room.status).toBe("active"); // no open human seats — active immediately

    const { runner, updates, gameOvers } = makeRecordingRunner(roomManager);
    runner.scheduleNext(room, false);

    await waitFor(() => gameOvers.length === 1, 5000);

    expect(gameOvers[0]?.result.status === "win" || gameOvers[0]?.result.status === "draw").toBe(
      true,
    );
    expect(room.status).toBe("finished");
    // Every move in the game came from the bot runner, alternating slots 1/2.
    expect(updates.length).toBeGreaterThan(0);
    for (const [i, update] of updates.entries()) {
      expect(update.lastMove.slot).toBe(i % 2 === 0 ? 1 : 2);
    }
    runner.destroy();
  });

  it("respects the seat's difficulty: a hard bot takes an immediately-winning move", async () => {
    const module = getGame("tictactoe");
    // X (slot 1) has two in a row (0, 1) and can win at 2. O (slot 2) has played
    // elsewhere. It's X's turn.
    let state = module.createInitialState();
    state = module.applyMove(state, { cell: 0 }, 1); // X
    state = module.applyMove(state, { cell: 3 }, 2); // O
    state = module.applyMove(state, { cell: 1 }, 1); // X: two in a row, threatens cell 2
    state = module.applyMove(state, { cell: 6 }, 2); // O plays elsewhere

    const { room } = roomManager.createRoom("tictactoe", [
      { slot: 1, kind: "bot", difficulty: "hard" },
      { slot: 2, kind: "bot", difficulty: "hard" },
    ]);
    room.state = state;
    room.turn = module.currentPlayer(state);
    expect(room.turn).toBe(1);

    const { runner, updates, gameOvers } = makeRecordingRunner(roomManager);
    runner.scheduleNext(room, false);

    await waitFor(() => updates.length >= 1);
    expect(updates[0]?.lastMove).toEqual({ slot: 1, move: { cell: 2 } });
    await waitFor(() => gameOvers.length === 1);
    expect(gameOvers[0]?.result).toMatchObject({ status: "win", winner: 1 });
    runner.destroy();
  });

  it("does not move a bot seat when the game is already finished", async () => {
    const { room } = roomManager.createRoom("tictactoe", [
      { slot: 1, kind: "human", self: true },
      { slot: 2, kind: "bot", difficulty: "easy" },
    ]);
    room.status = "finished";

    const { runner, updates, gameOvers } = makeRecordingRunner(roomManager);
    runner.scheduleNext(room, false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updates).toHaveLength(0);
    expect(gameOvers).toHaveLength(0);
    runner.destroy();
  });

  it("scheduleNext is a no-op when it isn't a bot's turn", async () => {
    const { room } = roomManager.createRoom("tictactoe", [
      { slot: 1, kind: "human", self: true },
      { slot: 2, kind: "bot", difficulty: "easy" },
    ]);
    expect(room.turn).toBe(1); // human's turn

    const { runner, updates } = makeRecordingRunner(roomManager);
    runner.scheduleNext(room, false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updates).toHaveLength(0);
    runner.destroy();
  });

  it("cancel() stops a pending bot move (e.g. room abandoned mid-delay)", async () => {
    const { room } = roomManager.createRoom("tictactoe", [
      { slot: 1, kind: "human", self: true },
      { slot: 2, kind: "bot", difficulty: "easy" },
    ]);
    const module = getGame("tictactoe");
    room.state = module.applyMove(room.state as never, { cell: 0 }, 1);
    room.turn = module.currentPlayer(room.state as never);

    const { runner, updates } = makeRecordingRunner(roomManager, {
      minReplyDelayMs: 50,
      maxReplyDelayMs: 50,
    });
    runner.scheduleNext(room, false);
    runner.cancel(room.id);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(updates).toHaveLength(0);
    runner.destroy();
  });
});

// ---------------------------------------------------------------------------------
// Integration: real HTTP + Socket.IO server (shared singleton, mirrors
// gameHandlers.test.ts), proving moveHandler.ts's BotRunner wiring end-to-end.
// ---------------------------------------------------------------------------------

describe("BotRunner (integration, human-vs-bot over a real socket)", () => {
  let baseUrl: string;

  function connectClient(): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(baseUrl, { transports: ["websocket"], forceNew: true });
      socket.on("connect", () => resolve(socket));
      socket.on("connect_error", reject);
    });
  }

  function once<T>(socket: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, resolve));
  }

  interface PublicRoomLike {
    roomId: string;
    status: string;
    turn: number;
    state: { board: (number | null)[] };
  }

  let hostSocket: ClientSocket;

  beforeAll(async () => {
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    sharedIo.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    sharedRoomManager.destroy();
    clearRegistry();
    registerBuiltInGames();
  });

  beforeEach(async () => {
    hostSocket = await connectClient();
  });

  afterEach(() => {
    hostSocket?.close();
  });

  it("auto-plays a human-vs-bot room to completion without the client driving the bot", async () => {
    const createdPromise = once<{ room: PublicRoomLike; sessionToken: string }>(
      hostSocket,
      "room:created",
    );
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true, displayName: "Host" },
        { slot: 2, kind: "bot", difficulty: "easy" },
      ],
    });
    const created = await createdPromise;
    expect(created.room.status).toBe("active"); // no open human seats to wait on

    const roomId = created.room.roomId;
    const gameOverPromise = once<{ result: { status: string } }>(hostSocket, "game:over");

    // Human (slot 1) always plays the first empty cell whenever a `game:update` shows
    // it's their turn again — including after the bot's (slot 2) server-driven reply,
    // which this test never computes itself.
    const seenBotSlots: number[] = [];
    hostSocket.on(
      "game:update",
      (payload: { room: PublicRoomLike; lastMove: { slot: number } }) => {
        if (payload.lastMove.slot === 2) seenBotSlots.push(2);
        if (payload.room.status !== "active" || payload.room.turn !== 1) return;
        const nextEmpty = payload.room.state.board.findIndex((c) => c === null);
        if (nextEmpty === -1) return;
        hostSocket.emit("move", { roomId, move: { cell: nextEmpty } });
      },
    );

    hostSocket.emit("move", { roomId, move: { cell: 0 } });

    const gameOver = await gameOverPromise;
    expect(["win", "draw"]).toContain(gameOver.result.status);
    // The bot (slot 2) must have moved at least once, entirely server-side.
    expect(seenBotSlots.length).toBeGreaterThan(0);
  }, 10000);
});

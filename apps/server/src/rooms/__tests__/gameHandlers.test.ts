// Integration tests for MPG-013: server-authoritative move validation +
// game:update/game:over broadcast. Real HTTP server + real Socket.IO
// client/server pair, mirroring integration.test.ts's approach.

import type { AddressInfo } from "node:net";

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

import { registerBuiltInGames, clearRegistry } from "@mpg/engine";

import { httpServer, io, roomManager, store } from "../../index.js";

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

function ack<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

interface PublicRoomLike {
  roomId: string;
  status: string;
  turn: number;
  state: unknown;
}

beforeAll(async () => {
  try {
    registerBuiltInGames();
  } catch {
    // already registered
  }
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  roomManager.destroy();
  clearRegistry();
  registerBuiltInGames();
});

describe("Gameplay (move validation + broadcast)", () => {
  let hostSocket: ClientSocket;
  let guestSocket: ClientSocket;

  beforeEach(async () => {
    hostSocket = await connectClient();
    guestSocket = await connectClient();
  });

  afterAll(() => {
    hostSocket?.close();
    guestSocket?.close();
  });

  async function createTwoPlayerRoom(): Promise<{
    roomId: string;
    hostSessionToken: string;
    guestSessionToken: string;
  }> {
    const createdPromise = once<{
      room: PublicRoomLike;
      sessionToken: string;
    }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true, displayName: "Host" },
        { slot: 2, kind: "human", displayName: "Guest" },
      ],
    });
    const created = await createdPromise;

    const gameStartPromise = once<{ room: PublicRoomLike }>(hostSocket, "game:start");
    const joinAck = await ack<{ ok: boolean; data: { sessionToken: string } }>(
      guestSocket,
      "room:join",
      { roomId: created.room.roomId },
    );
    await gameStartPromise;

    return {
      roomId: created.room.roomId,
      hostSessionToken: created.sessionToken,
      guestSessionToken: joinAck.data.sessionToken,
    };
  }

  it("emits game:start to both players once all seats are filled", async () => {
    const createdPromise = once<{ room: PublicRoomLike }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true },
        { slot: 2, kind: "human" },
      ],
    });
    const created = await createdPromise;

    const hostStartPromise = once<{ room: PublicRoomLike }>(hostSocket, "game:start");
    const guestStartPromise = once<{ room: PublicRoomLike }>(guestSocket, "game:start");
    guestSocket.emit("room:join", { roomId: created.room.roomId });

    const [hostStart, guestStart] = await Promise.all([hostStartPromise, guestStartPromise]);
    expect(hostStart.room.status).toBe("active");
    expect(guestStart.room.status).toBe("active");
    expect(hostStart.room.turn).toBe(1);
  });

  it("broadcasts game:update to both sockets on a valid move", async () => {
    const { roomId } = await createTwoPlayerRoom();

    const hostUpdatePromise = once<{ room: PublicRoomLike; lastMove: unknown }>(
      hostSocket,
      "game:update",
    );
    const guestUpdatePromise = once<{ room: PublicRoomLike; lastMove: unknown }>(
      guestSocket,
      "game:update",
    );

    hostSocket.emit("move", { roomId, move: { cell: 0 } });

    const [hostUpdate, guestUpdate] = await Promise.all([hostUpdatePromise, guestUpdatePromise]);
    expect(hostUpdate.room.turn).toBe(2);
    expect(hostUpdate.lastMove).toEqual({ slot: 1, move: { cell: 0 } });
    expect(guestUpdate.room.turn).toBe(2);
  });

  it("rejects an out-of-turn move with move:rejected NOT_YOUR_TURN, not broadcast", async () => {
    const { roomId } = await createTwoPlayerRoom();

    const guestUpdatePromise = new Promise((_resolve, reject) => {
      guestSocket.once("game:update", () => reject(new Error("should not broadcast")));
    });
    const rejectedPromise = once<{ reason: string }>(guestSocket, "move:rejected");

    // Guest (slot 2) moves first — it's slot 1's turn.
    guestSocket.emit("move", { roomId, move: { cell: 0 } });

    const rejected = await Promise.race([rejectedPromise, guestUpdatePromise]);
    expect(rejected).toEqual({ reason: "NOT_YOUR_TURN" });
  });

  it("rejects an illegal move (occupied cell) with move:rejected ILLEGAL_MOVE", async () => {
    const { roomId } = await createTwoPlayerRoom();

    await Promise.all([
      once(hostSocket, "game:update"),
      once(guestSocket, "game:update"),
      (async () => hostSocket.emit("move", { roomId, move: { cell: 0 } }))(),
    ]);

    // Guest (now slot 2's turn) tries to occupy the same cell.
    const rejectedPromise = once<{ reason: string }>(guestSocket, "move:rejected");
    guestSocket.emit("move", { roomId, move: { cell: 0 } });
    const rejected = await rejectedPromise;
    expect(rejected.reason).toBe("ILLEGAL_MOVE");
  });

  it("plays a full game to completion, emits game:over, and persists results", async () => {
    const { roomId, hostSessionToken, guestSessionToken } = await createTwoPlayerRoom();

    // X (host, slot 1) wins top row: 0,1,2. O (guest, slot 2) plays 3,4.
    const moves: Array<{ socket: ClientSocket; cell: number }> = [
      { socket: hostSocket, cell: 0 },
      { socket: guestSocket, cell: 3 },
      { socket: hostSocket, cell: 1 },
      { socket: guestSocket, cell: 4 },
      { socket: hostSocket, cell: 2 }, // completes top row for X
    ];

    const gameOverPromise = once<{
      room: PublicRoomLike;
      result: { status: string; winner?: number };
    }>(hostSocket, "game:over");

    for (const { socket, cell } of moves) {
      const updatePromise = once(hostSocket, "game:update");
      socket.emit("move", { roomId, move: { cell } });
      await updatePromise;
    }

    const gameOverPayload = await gameOverPromise;
    expect(gameOverPayload.result.status).toBe("win");
    expect(gameOverPayload.result.winner).toBe(1);
    expect(gameOverPayload.room.status).toBe("finished");

    // Give the fire-and-forget persistence a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const hostHistory = await store.results.findByOwner(hostSessionToken);
    const guestHistory = await store.results.findByOwner(guestSessionToken);
    expect(hostHistory.some((r) => r.status === "win" && r.winnerSlot === 1)).toBe(true);
    expect(guestHistory.some((r) => r.status === "win" && r.winnerSlot === 1)).toBe(true);

    // Leaderboard (MPG-055): the winner gets a win, the loser a loss.
    const hostRank = await store.leaderboard.rankOf("tictactoe", "wld", hostSessionToken);
    const guestRank = await store.leaderboard.rankOf("tictactoe", "wld", guestSessionToken);
    expect(hostRank).toBeDefined();
    expect(guestRank).toBeDefined();
    const entries = await store.leaderboard.topN("tictactoe", "wld", 10);
    const hostEntry = entries.find((e) => e.ownerToken === hostSessionToken);
    const guestEntry = entries.find((e) => e.ownerToken === guestSessionToken);
    expect(hostEntry?.wins).toBe(1);
    expect(guestEntry?.losses).toBe(1);
  });

  it("rejects a move after the game has ended", async () => {
    const { roomId } = await createTwoPlayerRoom();

    const gameOverPromise = once(hostSocket, "game:over");
    const moves: Array<{ socket: ClientSocket; cell: number }> = [
      { socket: hostSocket, cell: 0 },
      { socket: guestSocket, cell: 3 },
      { socket: hostSocket, cell: 1 },
      { socket: guestSocket, cell: 4 },
      { socket: hostSocket, cell: 2 },
    ];
    for (const { socket, cell } of moves) {
      const updatePromise = once(hostSocket, "game:update");
      socket.emit("move", { roomId, move: { cell } });
      await updatePromise;
    }
    await gameOverPromise;

    const rejectedPromise = once<{ reason: string }>(guestSocket, "move:rejected");
    guestSocket.emit("move", { roomId, move: { cell: 5 } });
    const rejected = await rejectedPromise;
    expect(rejected.reason).toBe("GAME_OVER");
  });
});

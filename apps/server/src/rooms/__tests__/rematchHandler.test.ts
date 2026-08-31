// Integration tests for MPG-015: result → rematch flow over Socket.IO. Real
// HTTP server + real Socket.IO client/server pair, mirroring
// gameHandlers.test.ts's approach.

import type { AddressInfo } from "node:net";

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

import { registerBuiltInGames, clearRegistry } from "@mpg/engine";

import { httpServer, io, roomManager } from "../../index.js";

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

describe("Rematch flow", () => {
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

  /** Creates a two-human room and plays it to completion (host, slot 1, wins). */
  async function playToFinish(): Promise<{
    roomId: string;
    hostSessionToken: string;
    guestSessionToken: string;
  }> {
    const createdPromise = once<{ room: PublicRoomLike; sessionToken: string }>(
      hostSocket,
      "room:created",
    );
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true, displayName: "Host" },
        { slot: 2, kind: "human", displayName: "Guest" },
      ],
    });
    const created = await createdPromise;

    const gameStartPromise = once(hostSocket, "game:start");
    const joinAck = await ack<{ ok: boolean; data: { sessionToken: string } }>(
      guestSocket,
      "room:join",
      { roomId: created.room.roomId },
    );
    await gameStartPromise;

    const roomId = created.room.roomId;
    const hostSessionToken = created.sessionToken;
    const guestSessionToken = joinAck.data.sessionToken;

    // X (host, slot 1) wins top row: 0,1,2. O (guest, slot 2) plays 3,4.
    const moves: Array<{ socket: ClientSocket; cell: number }> = [
      { socket: hostSocket, cell: 0 },
      { socket: guestSocket, cell: 3 },
      { socket: hostSocket, cell: 1 },
      { socket: guestSocket, cell: 4 },
      { socket: hostSocket, cell: 2 },
    ];
    const gameOverPromise = once(hostSocket, "game:over");
    for (const { socket, cell } of moves) {
      const updatePromise = once(hostSocket, "game:update");
      socket.emit("move", { roomId, move: { cell } });
      await updatePromise;
    }
    await gameOverPromise;

    return { roomId, hostSessionToken, guestSessionToken };
  }

  it("mutual propose creates a new room with the same config and notifies both sockets", async () => {
    const { roomId, hostSessionToken, guestSessionToken } = await playToFinish();

    const hostProposedPromise = once<{ from: number }>(hostSocket, "rematch:proposed");
    const guestProposedPromise = once<{ from: number }>(guestSocket, "rematch:proposed");
    const hostProposeAck = await ack<{ ok: boolean; data: { allProposed: boolean } }>(
      hostSocket,
      "rematch:propose",
      { roomId, sessionToken: hostSessionToken },
    );
    const [hostProposed, guestProposed] = await Promise.all([
      hostProposedPromise,
      guestProposedPromise,
    ]);
    expect(hostProposed).toEqual({ from: 1 });
    expect(guestProposed).toEqual({ from: 1 });
    expect(hostProposeAck.data.allProposed).toBe(false);

    const hostStartPromise = once<{ roomId: string }>(hostSocket, "rematch:start");
    const guestStartPromise = once<{ roomId: string }>(guestSocket, "rematch:start");
    const guestProposeAck = await ack<{ ok: boolean; data: { allProposed: boolean } }>(
      guestSocket,
      "rematch:propose",
      { roomId, sessionToken: guestSessionToken },
    );
    expect(guestProposeAck.data.allProposed).toBe(true);

    const [hostStart, guestStart] = await Promise.all([hostStartPromise, guestStartPromise]);
    expect(hostStart.roomId).toBe(guestStart.roomId);
    expect(hostStart.roomId).not.toBe(roomId);

    const newRoom = roomManager.getRoom(hostStart.roomId);
    expect(newRoom).toBeTruthy();
    expect(newRoom?.gameId).toBe("tictactoe");
    expect(newRoom?.status).toBe("active");
    expect(newRoom?.state).not.toBe(undefined);
    // Fresh state: no moves played yet.
    expect(newRoom?.moveLog).toHaveLength(0);
    expect(newRoom?.turn).toBe(1);
    // Same players, same seats.
    const newSeats = newRoom?.seats ?? [];
    expect(newSeats.find((s) => s.slot === 1)?.sessionToken).toBe(hostSessionToken);
    expect(newSeats.find((s) => s.slot === 2)?.sessionToken).toBe(guestSessionToken);
  });

  it("propose + decline clears the rematch state and notifies the room", async () => {
    const { roomId, hostSessionToken, guestSessionToken } = await playToFinish();

    await ack(hostSocket, "rematch:propose", { roomId, sessionToken: hostSessionToken });
    expect(roomManager.getRoom(roomId)?.rematchState?.proposedBy.size).toBe(1);

    const hostDeclinedPromise = once<{ from: number }>(hostSocket, "rematch:declined");
    const declineAck = await ack<{ ok: boolean }>(guestSocket, "rematch:decline", {
      roomId,
      sessionToken: guestSessionToken,
    });
    expect(declineAck.ok).toBe(true);

    const declined = await hostDeclinedPromise;
    expect(declined).toEqual({ from: 2 });
    expect(roomManager.getRoom(roomId)?.rematchState).toBeUndefined();
  });

  it("cannot propose a rematch before the game has finished", async () => {
    const createdPromise = once<{ room: PublicRoomLike; sessionToken: string }>(
      hostSocket,
      "room:created",
    );
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true },
        { slot: 2, kind: "human" },
      ],
    });
    const created = await createdPromise;

    const gameStartPromise = once(hostSocket, "game:start");
    await ack(guestSocket, "room:join", { roomId: created.room.roomId });
    await gameStartPromise;

    const errorAck = await ack<{ ok: boolean; error: { code: string } }>(
      hostSocket,
      "rematch:propose",
      { roomId: created.room.roomId, sessionToken: created.sessionToken },
    );
    expect(errorAck.ok).toBe(false);
    expect(errorAck.error.code).toBe("NOT_FINISHED");
  });
});

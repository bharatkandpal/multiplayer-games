// Integration tests: real HTTP server + real Socket.IO client/server pair,
// bound to an ephemeral port. Exercises the wire contract end-to-end rather
// than mocking transport.

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

describe("HTTP", () => {
  it("GET /health reports ok with engine version and uptime", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number; engineVersion: string };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.engineVersion).toBe("string");
  });

  it("GET /healthz reports ok", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /api/rooms creates a room and GET /api/rooms/:id looks it up", async () => {
    const createRes = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameId: "tictactoe",
        seats: [
          { slot: 1, kind: "human", self: true, displayName: "Bharat" },
          { slot: 2, kind: "bot", difficulty: "hard" },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      roomId: string;
      status: string;
      sessionToken: string;
    };
    expect(created.roomId).toBeTruthy();
    expect(created.status).toBe("active");
    expect(created.sessionToken).toBeTruthy();

    const getRes = await fetch(`${baseUrl}/api/rooms/${created.roomId}`);
    expect(getRes.status).toBe(200);
    const room = (await getRes.json()) as { roomId: string; seats: unknown[] };
    expect(room.roomId).toBe(created.roomId);
    expect(room.seats).toHaveLength(2);
  });

  it("POST /api/rooms rejects an unknown game", async () => {
    const res = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: "chess", seats: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/rooms/:id 404s for an unknown room", async () => {
    const res = await fetch(`${baseUrl}/api/rooms/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

describe("Socket.IO room lifecycle", () => {
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

  it("room:create creates a room and emits room:created to the creator", async () => {
    const createdPromise = once<{
      room: { roomId: string };
      yourSlot: number;
      sessionToken: string;
    }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true, displayName: "Host" },
        { slot: 2, kind: "human" },
      ],
    });
    const created = await createdPromise;
    expect(created.room.roomId).toBeTruthy();
    expect(created.yourSlot).toBe(1);
    expect(created.sessionToken).toBeTruthy();
  });

  it("room:join fills the open seat and broadcasts room:updated to both sockets", async () => {
    const createdPromise = once<{ room: { roomId: string } }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true },
        { slot: 2, kind: "human" },
      ],
    });
    const { room } = await createdPromise;

    const hostUpdatedPromise = once<{ room: { status: string } }>(hostSocket, "room:updated");
    guestSocket.emit("room:join", { roomId: room.roomId, displayName: "Guest" }, (ack: unknown) => {
      const response = ack as { ok: boolean; data?: { yourSlot: number } };
      expect(response.ok).toBe(true);
      expect(response.data?.yourSlot).toBe(2);
    });

    const hostUpdate = await hostUpdatedPromise;
    expect(hostUpdate.room.status).toBe("active");
  });

  it("room:join on a full room replies with a room:error ROOM_FULL", async () => {
    const createdPromise = once<{ room: { roomId: string } }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true },
        { slot: 2, kind: "bot", difficulty: "easy" },
      ],
    });
    const { room } = await createdPromise;

    const errorPromise = once<{ code: string }>(guestSocket, "room:error");
    guestSocket.emit("room:join", { roomId: room.roomId });
    const error = await errorPromise;
    expect(error.code).toBe("ROOM_FULL");
  });

  it("room:join on an unknown room replies with room:error NOT_FOUND", async () => {
    const errorPromise = once<{ code: string }>(guestSocket, "room:error");
    guestSocket.emit("room:join", { roomId: "does-not-exist" });
    const error = await errorPromise;
    expect(error.code).toBe("NOT_FOUND");
  });

  it("room:state returns the current room snapshot", async () => {
    const createdPromise = once<{ room: { roomId: string } }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true },
        { slot: 2, kind: "bot", difficulty: "easy" },
      ],
    });
    const { room } = await createdPromise;

    const statePromise = new Promise((resolve) => {
      guestSocket.emit("room:state", { roomId: room.roomId }, resolve);
    });
    const response = (await statePromise) as { ok: boolean; data: { room: { roomId: string } } };
    expect(response.ok).toBe(true);
    expect(response.data.room.roomId).toBe(room.roomId);
  });

  it("room:leave frees a waiting seat and broadcasts room:updated", async () => {
    const createdPromise = once<{ room: { roomId: string } }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true },
        { slot: 2, kind: "human" },
      ],
    });
    const { room } = await createdPromise;

    const joinAck = await new Promise<{ ok: boolean; data: { sessionToken: string } }>(
      (resolve) => {
        guestSocket.emit("room:join", { roomId: room.roomId }, resolve);
      },
    );

    const leftPromise = once<{ room: { seats: { open: boolean }[] } }>(guestSocket, "room:updated");
    guestSocket.emit("room:leave", {
      roomId: room.roomId,
      sessionToken: joinAck.data.sessionToken,
    });
    const updated = await leftPromise;
    expect(updated.room.seats[1]?.open).toBe(true);
  });

  it("opponent:disconnected fires when a connected seat's socket drops mid-game", async () => {
    const createdPromise = once<{ room: { roomId: string } }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "human", self: true },
        { slot: 2, kind: "human" },
      ],
    });
    const { room } = await createdPromise;

    await new Promise((resolve) => guestSocket.emit("room:join", { roomId: room.roomId }, resolve));

    const disconnectedPromise = once<{ graceMs: number }>(hostSocket, "opponent:disconnected");
    guestSocket.close();
    const payload = await disconnectedPromise;
    expect(typeof payload.graceMs).toBe("number");
  });
});

describe("All-bot watch mode (MPG-025)", () => {
  let hostSocket: ClientSocket;
  let strangerSocket: ClientSocket;

  beforeEach(async () => {
    hostSocket = await connectClient();
    strangerSocket = await connectClient();
  });

  afterAll(() => {
    hostSocket?.close();
    strangerSocket?.close();
  });

  it("requires no human seat at all (regression: RoomManager already allows this)", async () => {
    const createdPromise = once<{
      room: { roomId: string; status: string; seats: { kind: string }[] };
      yourSlot?: number;
      sessionToken?: string;
    }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "bot", difficulty: "easy" },
        { slot: 2, kind: "bot", difficulty: "hard" },
      ],
    });
    const created = await createdPromise;
    expect(created.room.status).toBe("active");
    expect(created.room.seats.every((s) => s.kind === "bot")).toBe(true);
    expect(created.yourSlot).toBeUndefined();
    expect(created.sessionToken).toBeUndefined();
  });

  it("the creator receives game:start/game:update/game:over as the bots play through", async () => {
    // Register listeners *before* emitting `room:create`: for an all-bot room,
    // `game:start` broadcasts synchronously inside the server's `room:create`
    // handling — before it even replies with `room:created` — so a real client
    // must have these bound ahead of time (matches how a client would normally
    // wire up its socket).
    const createdPromise = once<{
      room: { roomId: string };
      creatorToken: string;
    }>(hostSocket, "room:created");
    const startPromise = once<{ room: { status: string } }>(hostSocket, "game:start");
    const updatePromise = once<{ room: { turn: number }; lastMove: { slot: number } }>(
      hostSocket,
      "game:update",
    );
    const gameOverPromise = once<{ result: { status: string } }>(hostSocket, "game:over");

    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "bot", difficulty: "easy" },
        { slot: 2, kind: "bot", difficulty: "easy" },
      ],
    });

    const created = await createdPromise;
    expect(created.creatorToken).toBeTruthy();

    // The creator's own socket auto-joined on `room:create` — it sees the game
    // start immediately (no separate `room:join`/`room:watch` call needed).
    const start = await startPromise;
    expect(start.room.status).toBe("active");

    const update = await updatePromise;
    expect(typeof update.lastMove.slot).toBe("number");

    const over = await gameOverPromise;
    expect(["win", "draw"]).toContain(over.result.status);
  }, 15000);

  it("rejects a watch-join attempt from an unrelated session/creator token", async () => {
    const createdPromise = once<{ room: { roomId: string } }>(hostSocket, "room:created");
    hostSocket.emit("room:create", {
      gameId: "tictactoe",
      seats: [
        { slot: 1, kind: "bot", difficulty: "easy" },
        { slot: 2, kind: "bot", difficulty: "easy" },
      ],
    });
    const { room } = await createdPromise;

    // A stranger presenting a bogus creatorToken gets a snapshot back (room:state
    // always replies) but is never actually joined to the room's broadcast channel.
    const stateAck = await new Promise<{ ok: boolean }>((resolve) => {
      strangerSocket.emit(
        "room:state",
        { roomId: room.roomId, creatorToken: "not-the-real-token" },
        resolve,
      );
    });
    expect(stateAck.ok).toBe(true);

    let receivedBroadcast = false;
    strangerSocket.on("game:update", () => {
      receivedBroadcast = true;
    });
    strangerSocket.on("game:over", () => {
      receivedBroadcast = true;
    });

    // Give the bots a couple of paced moves worth of time to broadcast.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(receivedBroadcast).toBe(false);
  });
});

// @mpg/server — authoritative backend (HTTP + Socket.IO).
// MPG-011: Express + Socket.IO transport, ephemeral Room Manager.
// MPG-053: durable persistence foundation (Postgres / in-memory) — game
// results/leaderboard/sessions only; rooms themselves are ephemeral (in-memory).

import { createServer } from "node:http";

import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { Server as SocketIOServer } from "socket.io";

import { ENGINE_VERSION, registerBuiltInGames, registerBuiltInRealtimeGames } from "@mpg/engine";

import { JSON_BODY_LIMIT } from "./config.js";
import { createLeaderboardRouter } from "./leaderboard/leaderboardRoutes.js";
import { parseCorsOrigin } from "./middleware/cors.js";
import { createRateLimiter } from "./middleware/rateLimit.js";
import { registerGameHandlers } from "./rooms/moveHandler.js";
import { registerRematchHandlers } from "./rooms/rematchHandler.js";
import { RoomManager, RoomManagerError } from "./rooms/RoomManager.js";
import { registerRoomHandlers } from "./rooms/roomHandlers.js";
import { createResultRouter } from "./results/resultRoutes.js";
import { createShareRouter } from "./share/shareRoutes.js";
import type { SeatConfig } from "./rooms/types.js";
import {
  createSessionMiddleware,
  createSocketSessionMiddleware,
} from "./sessions/sessionMiddleware.js";
import { createSessionRouter } from "./sessions/sessionRoutes.js";
import { createStore } from "./store/index.js";

registerBuiltInGames();
registerBuiltInRealtimeGames();

const store = await createStore();
const mode = process.env["DATABASE_URL"] ? "postgres" : "memory";

console.log(`@mpg/server — engine v${ENGINE_VERSION}, store: ${mode}`);

// CORS lock-down (MPG-021, docs/TDD.md §11). `CORS_ORIGIN` is a comma-separated
// allowlist of app origins; unset defaults to `*` for dev convenience. In
// production a wildcard is almost certainly a misconfiguration, so we warn
// loudly on startup rather than shipping an open API silently — but we don't
// hard-crash, because the origin allowlist is an operator concern.
const corsOrigin = parseCorsOrigin(process.env["CORS_ORIGIN"]);
if (process.env["NODE_ENV"] === "production" && corsOrigin === "*") {
  console.warn(
    "[cors] CORS_ORIGIN is unset in production — the API is accepting requests from ANY " +
      "origin. Set CORS_ORIGIN to your app origin(s) to lock this down.",
  );
}

const app = express();
app.use(cors({ origin: corsOrigin, credentials: true }));
// Bound the request body (see config.ts). Input logs are the largest legitimate
// payload and sit under this; an unbounded body is a cheap memory-pressure vector.
app.use(express.json({ limit: JSON_BODY_LIMIT }));

// In-house rate limiter (MPG-021). Disabled (no-op) unless RATE_LIMITER_URL is
// set, and fail-open when the service is unreachable — see middleware/rateLimit.ts.
const rateLimiter = createRateLimiter();
console.log(`@mpg/server — rate limiter: ${rateLimiter.enabled ? "enabled" : "disabled"}`);

// Session identity — mints or resolves an opaque token on every request.
app.use(createSessionMiddleware(store));

// Session routes (GET/DELETE /api/session, GET /api/session/history).
app.use("/api", createSessionRouter(store, rateLimiter.limit.bind(rateLimiter)));

// Leaderboard routes (GET /api/leaderboard/:gameId, GET /api/leaderboard/:gameId/rank).
app.use("/api", createLeaderboardRouter(store, rateLimiter.limit.bind(rateLimiter)));

// Client-reported turn-based results (POST /api/results) — MPG-131. Local play
// never touches a room, so this is the only way a local game becomes shareable.
app.use("/api", createResultRouter(store, rateLimiter.limit.bind(rateLimiter)));

// Durable share links (POST /api/share, GET/DELETE /api/share/:token) — MPG-056.
app.use("/api", createShareRouter(store, rateLimiter.limit.bind(rateLimiter)));

const startedAt = Date.now();

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: Date.now() - startedAt, engineVersion: ENGINE_VERSION });
});

// docs/API_SPEC.md §2 liveness alias.
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

const roomManager = new RoomManager();

function isSeatConfigArray(v: unknown): v is SeatConfig[] {
  return (
    Array.isArray(v) &&
    v.every((s) => {
      if (typeof s !== "object" || s === null) return false;
      const seat = s as Record<string, unknown>;
      if (typeof seat["slot"] !== "number") return false;
      if (seat["kind"] === "human") return true;
      if (seat["kind"] === "bot") return typeof seat["difficulty"] === "string";
      return false;
    })
  );
}

// docs/API_SPEC.md §2 — `POST /api/rooms`. Room creation is also available over
// Socket.IO (`room:create`, see roomHandlers.ts) for clients that prefer a single
// transport end-to-end; both paths share the same RoomManager.
app.post("/api/rooms", rateLimiter.limit("room_create"), (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const gameId = body["gameId"];
  const seats = body["seats"];

  if (typeof gameId !== "string" || !isSeatConfigArray(seats)) {
    res.status(400).json({ code: "INVALID_REQUEST", message: "gameId and seats are required" });
    return;
  }

  try {
    const { room, sessionTokens, creatorToken } = roomManager.createRoom(gameId, seats);
    const selfSlot = seats.find((s) => s.kind === "human" && s.self)?.slot;
    const sessionToken = selfSlot !== undefined ? sessionTokens.get(selfSlot) : undefined;
    const hasOpenHumanSeat = room.seats.some((s) => s.kind === "human" && !s.sessionToken);

    res.status(201).json({
      roomId: room.id,
      gameId: room.gameId,
      inviteUrl: hasOpenHumanSeat ? `/${room.gameId}/room/${room.id}` : undefined,
      yourSlot: selfSlot,
      sessionToken,
      // Lets the creator watch-join an all-bot room's live broadcasts over Socket.IO
      // via `room:state` — there's no seat (and so no `sessionToken`) for that case.
      creatorToken,
      status: room.status,
    });
  } catch (err) {
    if (err instanceof RoomManagerError) {
      res.status(400).json({ code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ code: "INTERNAL_ERROR", message: "Unexpected error" });
  }
});

// docs/API_SPEC.md §2 — `GET /api/rooms/:roomId`.
app.get("/api/rooms/:roomId", (req: Request, res: Response) => {
  const room = roomManager.getRoom(req.params["roomId"] as string);
  if (!room) {
    res.status(404).json({ code: "NOT_FOUND", message: "Room not found or expired" });
    return;
  }
  res.json(roomManager.toPublicRoom(room));
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Unexpected error" });
});

const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  // Same allowlist as the HTTP layer so the two transports can't drift.
  cors: { origin: corsOrigin },
});

io.use(createSocketSessionMiddleware(store));
registerRoomHandlers(io, roomManager);
registerGameHandlers(io, roomManager, store);
registerRematchHandlers(io, roomManager);

const port = Number(process.env["PORT"] ?? 3001);

// Only bind a real port when run directly (`node src/index.ts` / `pnpm dev`), not
// when imported by tests — tests exercise `app`/`io` in-process instead.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  httpServer.listen(port, () => {
    console.log(`@mpg/server listening on :${port}`);
  });
}

export { app, httpServer, io, roomManager, store };

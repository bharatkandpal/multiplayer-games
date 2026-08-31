/**
 * Socket.IO client (MPG-012) — the transport underneath the room lifecycle
 * (`useRoom`) and, eventually, live gameplay events.
 *
 * A thin wrapper, not a raw re-export of `socket.io-client`: it owns the
 * *lazy*, *singleton* connection (docs/ARCHITECTURE.md — transport stays
 * swappable, one connection per tab) and attaches the session token
 * (`getSessionToken()`, `../api/session.ts`) to the handshake `auth` payload
 * so the server can resolve/mint the same identity it uses for HTTP.
 *
 * Callers should go through `getSocket()`/`connectSocket()` rather than
 * importing `socket.io-client` directly, so raw Socket.IO calls stay out of
 * game/room logic (docs/ARCHITECTURE.md).
 */

import { io, type Socket } from "socket.io-client";
import { getSessionToken } from "./session.js";

/** Resolves the realtime server's base URL. Defaults to the local dev server. */
function getServerUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env["VITE_SERVER_URL"] ?? "http://localhost:3001";
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

type ConnectionStateListener = (state: ConnectionState) => void;

let socket: Socket | undefined;
let connectionState: ConnectionState = "disconnected";
const stateListeners = new Set<ConnectionStateListener>();

function setConnectionState(next: ConnectionState): void {
  if (connectionState === next) return;
  connectionState = next;
  for (const listener of stateListeners) listener(next);
}

/** Current connection state, synchronously — for callers that don't need updates. */
export function getConnectionState(): ConnectionState {
  return connectionState;
}

/** Subscribe to connection-state changes. Returns an unsubscribe function. */
export function onConnectionStateChange(listener: ConnectionStateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function createSocket(): Socket {
  const instance = io(getServerUrl(), {
    autoConnect: false,
    // socket.io-client's "dynamic auth" contract is callback-based, not a plain
    // return value (see `Socket.prototype.onopen` in socket.io-client): when
    // `auth` is a function, the client calls it with a `(data) => void`
    // callback and waits for that callback to fire before ever sending the
    // CONNECT packet. A function that just *returns* the payload (the
    // previous shape here) is never invoked correctly — the callback is never
    // called, so the client never emits `40` (Socket.IO CONNECT) and every
    // room/game emit queues forever with no error, no timeout, and no visible
    // failure (found via MPG-017's e2e suite: real browsers hung on "Play
    // online" indefinitely; unit/integration tests didn't catch it because
    // they exercise the socket layer through mocks, not a real
    // socket.io-client handshake).
    auth: (cb: (data: { sessionToken: string | undefined }) => void) =>
      cb({ sessionToken: getSessionToken() ?? undefined }),
  });

  instance.on("connect", () => setConnectionState("connected"));
  instance.on("disconnect", () => setConnectionState("disconnected"));
  instance.io.on("reconnect_attempt", () => setConnectionState("reconnecting"));
  instance.io.on("reconnect", () => setConnectionState("connected"));

  return instance;
}

/**
 * Returns the singleton socket, creating it (disconnected) on first call.
 * Does NOT connect — call `connectSocket()` (or `.connect()` on the result)
 * to actually open the connection.
 */
export function getSocket(): Socket {
  socket ??= createSocket();
  return socket;
}

/** Connects the singleton socket if it isn't already connected/connecting. */
export function connectSocket(): Socket {
  const instance = getSocket();
  if (!instance.connected && !instance.active) {
    setConnectionState("connecting");
    instance.connect();
  } else if (!instance.connected) {
    setConnectionState("connecting");
  }
  return instance;
}

/** Disconnects the singleton socket, if connected. Safe to call repeatedly. */
export function disconnectSocket(): void {
  socket?.disconnect();
  setConnectionState("disconnected");
}

/** Test-only: drop the singleton so the next `getSocket()` builds a fresh one. */
export function __resetSocketForTests(): void {
  socket?.disconnect();
  socket?.removeAllListeners();
  socket = undefined;
  connectionState = "disconnected";
  stateListeners.clear();
}

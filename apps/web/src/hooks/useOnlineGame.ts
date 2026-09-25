/**
 * Peer-to-peer online play — the Ably-based replacement for the old
 * Socket.IO room/game stack (`useRoom.ts` + `useOnlinePlay.ts`, both deleted).
 *
 * There is no server in this loop at all: two browsers exchange moves
 * directly over an Ably Realtime channel derived from `(roomId, secret)`
 * (`POST /api/game/token`, `../api/game.ts`). Each peer independently
 * validates the other's moves against the shared, pure `GameModule`
 * (`@mpg/engine`) before applying them — exactly the trust model local
 * hot-seat/bot play already uses; there is no server referee.
 *
 * This ONE hook covers the whole online-play lifecycle App.tsx drives, the
 * same span `useRoom.ts` used to own: create a room, wait for the invite to
 * be opened (`InviteScreen`), join one (`JoinScreen`), then play it out
 * (`OnlineGameRoute`/`OnlineGamePlayScreen`) — one Ably connection, mounted
 * once, torn down on `leaveRoom`.
 *
 * Wire protocol (event name `"game"` on the derived channel):
 *   - `{ type: "move", slot, move, seq }` — `seq` is the mover's `moveLog`
 *     index at publish time, for gap detection.
 *   - `{ type: "sync_request", fromSeq }` / `{ type: "sync_state", moveLog }`
 *     — requested when a received `seq` skips ahead of what's expected;
 *     `sync_state`'s log is never trusted as-is, always replayed through
 *     `GameModule.applyMove` (see `hydrateFromLog` below).
 * "Who's here" (the brief's `hello` announcement) rides Ably's own presence
 * channel instead of a bespoke message: `presence.enter({ slot, gameId })` on
 * connect gives both "the peer joined" (`InviteScreen`'s cue to proceed) and
 * "the peer disconnected" (a presence `leave`) for free, and needs no ack
 * dance — deterministic start (`createInitialState()`) needs no agreement.
 *
 * Offline pillar (CLAUDE.md): a token-mint or Ably failure degrades to
 * `unavailable` — never a throw, never a retry loop, never a blocked screen.
 * Each peer's own board stays driven by its own local session regardless of
 * the other's connectivity; a disconnected peer only ever shows as a gentle
 * "waiting for them" affordance at the point it would be their turn.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Realtime } from "ably";
import type * as Ably from "ably";
import type { GameId, Player } from "@mpg/engine";
import { getGame } from "@mpg/engine";

import { fetchGameToken, type GameTokenResponse } from "../api/game.js";
import { buildGameInviteUrl, createRoomId, createRoomSecret } from "../api/gameInvite.js";
import {
  clearGameRoom,
  loadGameRoom,
  saveGameRoom,
  type StoredGameRoom,
  type StoredMove,
} from "../api/gameRoomStorage.js";
import {
  createGameSession,
  gameSessionReducer,
  type AppliedMove,
  type GameSessionAction,
  type GameSessionState,
} from "../game/gameSession";

type AnySession = GameSessionState<unknown, unknown>;

/** The one wire shape exchanged over the `"game"` event. */
type ProtocolMessage =
  | { readonly type: "move"; readonly slot: Player; readonly move: unknown; readonly seq: number }
  | { readonly type: "sync_request"; readonly fromSeq: number }
  | { readonly type: "sync_state"; readonly moveLog: readonly StoredMove[] };

export type OnlineGamePhase =
  /** No room created/joined yet. */
  | "idle"
  /** Minting a token / opening the Ably connection. */
  | "connecting"
  /** Connected, but the other seat hasn't been seen yet (or has dropped). */
  | "waiting"
  | "playing"
  | "finished"
  /** Token mint or Ably connection failed outright — offer online play as absent. */
  | "unavailable";

export interface UseOnlineGameResult {
  phase: OnlineGamePhase;
  gameId: GameId | undefined;
  roomId: string | undefined;
  inviteUrl: string | undefined;
  /** This browser's own seat (1 = room creator, 2 = the invite-link opener). */
  yourSlot: Player | undefined;
  /** Whether the other seat's presence has been seen on the channel right now. */
  peerConnected: boolean;
  connectionState: Ably.ConnectionState | "unknown";
  session: AnySession | undefined;
  turn: Player | undefined;
  yourTurn: boolean;
  moveLog: readonly AppliedMove<unknown>[];
  /**
   * True once the game has started and the peer's presence has since been
   * lost — a gentle in-game banner, never a blocked screen: THIS player's own
   * board stays fully visible/interactive from local state regardless.
   */
  opponentDisconnected: boolean;
  /** Plain-language copy for the last locally-rejected move, if any. */
  error: string | undefined;
  clearError: () => void;
  /** Send a move as this client's own seat. No-op if it isn't your turn. */
  makeMove: (move: unknown) => void;
  /** Creates a fresh room as slot 1 and starts connecting. Returns the invite link to share. */
  createRoom: (gameId: GameId) => { roomId: string; secret: string; inviteUrl: string };
  /** Joins an existing room (from an invite link) as slot 2 — or resumes it, if this
   *  browser was already in it (a reload mid-game recovers its own stored slot). */
  joinRoom: (gameId: GameId, roomId: string, secret: string) => void;
  /** Tears the connection down and forgets this room. */
  leaveRoom: () => void;
}

const TERMINAL_STATES = new Set<Ably.ConnectionState>(["failed", "suspended", "closed"]);

interface Identity {
  readonly gameId: GameId;
  readonly roomId: string;
  readonly secret: string;
  readonly mySlot: Player;
}

/** Replays a stored/peer move log through the engine from a fresh position. Never
 * trusts the log itself — a replay that throws (a corrupt or fabricated log) simply
 * fails to hydrate, degrading to "start fresh" rather than adopting bad state. */
function hydrateFromLog(
  game: ReturnType<typeof getGame>,
  log: readonly StoredMove[],
): { state: unknown; moveLog: AppliedMove<unknown>[] } | undefined {
  try {
    let state = game.createInitialState();
    const moveLog: AppliedMove<unknown>[] = [];
    for (const entry of log) {
      state = game.applyMove(state, entry.move, entry.player);
      moveLog.push({ move: entry.move, player: entry.player });
    }
    return { state, moveLog };
  } catch {
    return undefined;
  }
}

function toStoredMoves(moveLog: readonly AppliedMove<unknown>[]): StoredMove[] {
  return moveLog.map((m) => ({ move: m.move, player: m.player }));
}

/**
 * Owns one online room's lifecycle end-to-end (mount once, e.g. in `App.tsx`,
 * the same way `useRoom()` used to be a single shared instance for the tab).
 */
export function useOnlineGame(): UseOnlineGameResult {
  const [identity, setIdentity] = useState<Identity | undefined>(undefined);
  const [session, setSession] = useState<AnySession | undefined>(undefined);
  const [peerConnected, setPeerConnected] = useState(false);
  // Once the peer has been seen at all, a later drop must never yank the
  // board away (CLAUDE.md offline pillar: each side's own board stays
  // visible/interactive from local state regardless of the other's
  // connectivity) — this distinguishes "still waiting for the very first
  // join" (full "waiting" screen) from "we were playing and they dropped"
  // (a gentle in-game banner, `opponentDisconnected` below).
  const [everConnected, setEverConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [connectionState, setConnectionState] = useState<Ably.ConnectionState | "unknown">(
    "unknown",
  );

  const identityRef = useRef(identity);
  identityRef.current = identity;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const channelRef = useRef<Ably.RealtimeChannel | undefined>(undefined);
  const generationRef = useRef(0);
  // A stable per-tab client id for this room's Ably identity — regenerated per
  // room so a rejoin after leaving looks like a fresh peer, not a stale one.
  const clientIdRef = useRef<string>("");

  const dispatch = useCallback((action: GameSessionAction<unknown, unknown>) => {
    setSession((prev) => (prev ? gameSessionReducer(prev, action) : prev));
  }, []);

  const publish = useCallback((payload: ProtocolMessage) => {
    channelRef.current?.publish("game", payload).catch(() => {
      // Best-effort — Ably queues while reconnecting; a truly dead connection
      // is already reflected in `connectionState`/`unavailable`.
    });
  }, []);

  // Persist every local/remote move as it lands, so a reload can resume this
  // browser's own copy of the game (`../api/gameRoomStorage.ts`) — never a
  // trusted-blob save, just the log the engine can replay.
  useEffect(() => {
    if (!identity || !session) return;
    saveGameRoom({
      roomId: identity.roomId,
      secret: identity.secret,
      gameId: identity.gameId,
      mySlot: identity.mySlot,
      moveLog: toStoredMoves(session.moveLog),
    });
  }, [identity, session]);

  useEffect(() => {
    if (!identity) return undefined;
    let cancelled = false;
    const generation = ++generationRef.current;
    setUnavailable(false);
    setConnectionState("unknown");
    setPeerConnected(false);
    setEverConnected(false);

    let client: Ably.Realtime | undefined;
    let channel: Ably.RealtimeChannel | undefined;
    let primed: GameTokenResponse | null = null;

    const degrade = (): void => {
      if (cancelled) return;
      setUnavailable(true);
      try {
        client?.close();
      } catch {
        // Already degraded — closing a half-open client can throw; irrelevant.
      }
    };

    const handleConnectionChange = (change: Ably.ConnectionStateChange): void => {
      if (cancelled) return;
      setConnectionState(change.current);
      if (TERMINAL_STATES.has(change.current)) setUnavailable(true);
    };

    const applyPeerMove = (slot: Player, move: unknown, seq: number): void => {
      const current = sessionRef.current;
      if (!current) return;
      const expected = current.moveLog.length;
      if (seq === expected) {
        dispatch({ type: "apply_remote_move", move, player: slot });
        return;
      }
      if (seq > expected) {
        // We're behind — ask for the peer's full log rather than guessing at
        // the gap (never trust a raw state blob; always replay a resync).
        publish({ type: "sync_request", fromSeq: expected });
      }
      // seq < expected: a stale re-delivery/duplicate — already applied, ignore.
    };

    const handleMessage = (msg: Ably.InboundMessage): void => {
      if (cancelled) return;
      const data = msg.data as ProtocolMessage | undefined;
      const id = identityRef.current;
      if (!data || !id) return;
      switch (data.type) {
        case "move": {
          if (data.slot === id.mySlot) return; // our own publish (shouldn't echo, but be safe)
          applyPeerMove(data.slot, data.move, data.seq);
          return;
        }
        case "sync_request": {
          const current = sessionRef.current;
          if (!current) return;
          publish({ type: "sync_state", moveLog: toStoredMoves(current.moveLog) });
          return;
        }
        case "sync_state": {
          const game = getGame(id.gameId);
          const hydrated = hydrateFromLog(game, data.moveLog);
          if (!hydrated) return; // a bad/fabricated log — ignore, keep local state
          dispatch({
            type: "reconcile",
            state: hydrated.state,
            moveLog: hydrated.moveLog,
          });
          return;
        }
        default:
          return;
      }
    };

    const handlePresenceEnter = (member: Ably.PresenceMessage): void => {
      if (cancelled) return;
      const data = member.data as { slot?: Player } | undefined;
      const id = identityRef.current;
      if (!id || data?.slot === undefined || data.slot === id.mySlot) return;
      setPeerConnected(true);
      setEverConnected(true);
    };

    const handlePresenceLeave = (member: Ably.PresenceMessage): void => {
      if (cancelled) return;
      const data = member.data as { slot?: Player } | undefined;
      const id = identityRef.current;
      if (!id || data?.slot === undefined || data.slot === id.mySlot) return;
      setPeerConnected(false);
    };

    fetchGameToken(identity.roomId, identity.secret, clientIdRef.current)
      .then((initial) => {
        if (cancelled || generation !== generationRef.current) return;
        if (!initial) {
          degrade();
          return;
        }
        primed = initial;

        try {
          client = new Realtime({
            autoConnect: true,
            // We publish our own moves and don't want them echoed back as if
            // the peer sent them — the gap-detection logic above assumes a
            // "move" message is always from the OTHER seat.
            echoMessages: false,
            authCallback: (_params, callback) => {
              const first = primed;
              primed = null;
              const source = first
                ? Promise.resolve(first)
                : fetchGameToken(identity.roomId, identity.secret, clientIdRef.current);
              source
                .then((token) => {
                  if (cancelled) return;
                  if (!token) {
                    callback("game_unavailable", null);
                    degrade();
                    return;
                  }
                  callback(null, token.tokenRequest as Ably.TokenDetails);
                })
                .catch(() => {
                  if (cancelled) return;
                  callback("game_unavailable", null);
                  degrade();
                });
            },
          });
        } catch {
          setUnavailable(true);
          return;
        }

        channel = client.channels.get(initial.channelName);
        channelRef.current = channel;
        client.connection.on(handleConnectionChange);
        channel.subscribe("game", handleMessage).catch(() => {
          if (!cancelled) setUnavailable(true);
        });
        channel.presence.subscribe("enter", handlePresenceEnter).catch(() => {});
        channel.presence.subscribe("leave", handlePresenceLeave).catch(() => {});
        channel.presence.enter({ slot: identity.mySlot, gameId: identity.gameId }).catch(() => {
          // Presence is an enhancement over the core move protocol — a failed
          // enter just means "waiting for opponent" lingers, never a crash.
        });
        channel.presence
          .get()
          .then((members) => {
            if (cancelled) return;
            const id = identityRef.current;
            if (!id) return;
            if (
              members.some((m) => (m.data as { slot?: Player } | undefined)?.slot !== id.mySlot)
            ) {
              setPeerConnected(true);
              setEverConnected(true);
            }
          })
          .catch(() => {
            // Best-effort — a failed presence read just leaves "waiting for
            // opponent" up until the next `enter` event arrives.
          });
      })
      .catch(() => degrade());

    return () => {
      cancelled = true;
      if (channelRef.current === channel) channelRef.current = undefined;
      if (client) client.connection.off(handleConnectionChange);
      if (channel) {
        channel.unsubscribe("game", handleMessage);
        channel.presence.unsubscribe();
        channel.presence.leave().catch(() => {});
      }
      if (client) client.close();
    };
  }, [identity, dispatch, publish]);

  const createRoom = useCallback(
    (gameId: GameId): { roomId: string; secret: string; inviteUrl: string } => {
      const roomId = createRoomId();
      const secret = createRoomSecret();
      clientIdRef.current = crypto.randomUUID();
      const game = getGame(gameId);
      setSession(createGameSession(game));
      setIdentity({ gameId, roomId, secret, mySlot: 1 });
      return { roomId, secret, inviteUrl: buildGameInviteUrl(gameId, roomId, secret) };
    },
    [],
  );

  const joinRoom = useCallback((gameId: GameId, roomId: string, secret: string): void => {
    clientIdRef.current = crypto.randomUUID();
    const game = getGame(gameId);
    // A reload mid-game (either seat) recovers its own stored slot/progress
    // rather than assuming "opening a link always means slot 2".
    const stored: StoredGameRoom | undefined = loadGameRoom(roomId);
    const resuming = stored && stored.gameId === gameId && stored.secret === secret;
    const mySlot = resuming ? (stored.mySlot as Player) : 2;
    const hydrated = resuming ? hydrateFromLog(game, stored.moveLog) : undefined;
    setSession(
      hydrated
        ? { ...createGameSession(game, hydrated.state), moveLog: hydrated.moveLog }
        : createGameSession(game),
    );
    setIdentity({ gameId, roomId, secret, mySlot });
  }, []);

  const leaveRoom = useCallback((): void => {
    if (identityRef.current) clearGameRoom(identityRef.current.roomId);
    setIdentity(undefined);
    setSession(undefined);
    setPeerConnected(false);
    setEverConnected(false);
    setUnavailable(false);
  }, []);

  const clearError = useCallback(() => dispatch({ type: "clear_error" }), [dispatch]);

  const makeMove = useCallback(
    (move: unknown) => {
      const id = identityRef.current;
      const current = sessionRef.current;
      if (!id || !current) return;
      if (current.game.currentPlayer(current.state) !== id.mySlot) return;
      if (current.result.status !== "in_progress") return;
      const seq = current.moveLog.length;
      dispatch({ type: "apply_local_move", move });
      publish({ type: "move", slot: id.mySlot, move, seq });
    },
    [dispatch, publish],
  );

  const phase: OnlineGamePhase = useMemo(() => {
    if (!identity) return "idle";
    if (unavailable) return "unavailable";
    if (!session) return "connecting";
    if (session.result.status !== "in_progress") return "finished";
    // Only the FIRST join blocks on "waiting" — once the peer has ever been
    // seen, a later drop must never yank this player's own board away (see
    // `everConnected`'s doc comment above); that's `opponentDisconnected`, a
    // banner over a still-fully-interactive board, not a phase change.
    if (!peerConnected && !everConnected) return "waiting";
    return "playing";
  }, [identity, unavailable, session, peerConnected, everConnected]);

  const opponentDisconnected = phase === "playing" && everConnected && !peerConnected;

  // `session.status` starts "idle" (see `createGameSession`) until moved into
  // "playing"/"game_over" by a "start" action — needed so `GamePlayScreenView`
  // (which reads `session.status.type`, not this hook's own `phase`) renders
  // the board/result screen the instant the room is actually playable,
  // including a resumed-already-finished reload.
  useEffect(() => {
    if ((phase === "playing" || phase === "finished") && session?.status.type === "idle") {
      dispatch({ type: "start" });
    }
  }, [phase, session, dispatch]);

  const yourTurn =
    phase === "playing" &&
    session !== undefined &&
    identity !== undefined &&
    session.game.currentPlayer(session.state) === identity.mySlot;

  return {
    phase,
    gameId: identity?.gameId,
    roomId: identity?.roomId,
    inviteUrl: identity
      ? buildGameInviteUrl(identity.gameId, identity.roomId, identity.secret)
      : undefined,
    yourSlot: identity?.mySlot,
    peerConnected,
    connectionState,
    session,
    turn: session ? session.game.currentPlayer(session.state) : undefined,
    yourTurn,
    moveLog: session?.moveLog ?? [],
    opponentDisconnected,
    error: session?.status.type === "error" ? session.status.message : undefined,
    clearError,
    makeMove,
    createRoom,
    joinRoom,
    leaveRoom,
  };
}

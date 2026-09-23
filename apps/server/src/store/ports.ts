/**
 * Repository port interfaces — the contract between server logic and persistence.
 *
 * Each repo is a narrow, async interface. Two adapters exist:
 *   • Postgres (prod) — implemented via Drizzle in `./pg/`
 *   • In-memory (dev + Vitest) — implemented in `./memory/`
 *
 * No I/O types from `packages/engine` leak here — the store uses plain strings
 * for game IDs, keeping the engine pure and the boundary clean.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface PaginationOpts {
  readonly limit?: number;
  readonly offset?: number;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface Session {
  readonly id: string;
  readonly token: string;
  readonly username: string | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly metadata: unknown;
}

/** Result of a `setUsername` attempt — case-insensitively unique. */
export type SetUsernameResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly reason: "taken" };

export interface SessionRepo {
  /** Create or return existing session for `token`. */
  upsert(token: string): Promise<Session>;

  /** Find a session by its token. */
  findByToken(token: string): Promise<Session | undefined>;

  /** Update `lastSeenAt` to now. */
  touch(token: string): Promise<void>;

  /** Delete a session. Returns true if it existed. */
  delete(token: string): Promise<boolean>;

  /**
   * Set (or re-set) `token`'s username. Case-insensitively unique across all
   * sessions; re-posting the caller's own current username (any casing)
   * succeeds rather than being treated as a collision.
   */
  setUsername(token: string, username: string): Promise<SetUsernameResult>;
}

// ---------------------------------------------------------------------------
// Identity (MPG-091)
// ---------------------------------------------------------------------------

export interface Identity {
  readonly id: string;
  readonly handle: string;
  readonly createdAt: Date;
}

/** Result of a `claim` — links the caller's session to a new durable identity. */
export type ClaimResult =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly reason: "handle_taken" | "already_claimed" };

/** Result of an `adopt` — relinks the caller's session to an existing identity. */
export type AdoptResult =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly reason: "invalid_code" };

export interface IdentityRepo {
  /**
   * Mint a durable identity for `handle` and link `token` to it. The caller
   * generates the recovery code and passes only its hash — the plaintext never
   * reaches the store. `handle_taken` when another identity holds the handle
   * (case-insensitive); `already_claimed` when this session is already linked.
   */
  claim(token: string, handle: string, recoveryCodeHash: string): Promise<ClaimResult>;

  /**
   * Link `token` to whichever identity a recovery-code hash resolves to
   * (cross-device adoption). `invalid_code` when no identity matches.
   */
  adopt(token: string, recoveryCodeHash: string): Promise<AdoptResult>;

  /** The identity `token` is linked to, if any. */
  findByToken(token: string): Promise<Identity | undefined>;

  /** All session tokens linked to an identity (owner-union source for MPG-091-b). */
  tokensForIdentity(identityId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Game Result
// ---------------------------------------------------------------------------

export interface GameResult {
  readonly id: string;
  readonly runId: string;
  readonly gameId: string;
  readonly gameFamily: string;
  readonly eventId: string | null;
  readonly ownerToken: string;
  readonly status: string;
  readonly winnerSlot: number | null;
  readonly score: number | null;
  readonly seatsSnapshot: unknown;
  readonly durationMs: number | null;
  readonly moveLog: unknown;
  readonly createdAt: Date;
}

export interface NewGameResult {
  readonly runId: string;
  readonly gameId: string;
  readonly gameFamily?: string;
  readonly eventId?: string | null;
  readonly ownerToken: string;
  readonly status: string;
  readonly winnerSlot?: number | null;
  readonly score?: number | null;
  readonly seatsSnapshot: unknown;
  readonly durationMs?: number | null;
  readonly moveLog?: unknown;
}

export interface ResultRepo {
  /** Persist a game result. Idempotent on `runId`. */
  save(result: NewGameResult): Promise<GameResult>;

  /** Find a result by its idempotency key. */
  findByRunId(runId: string): Promise<GameResult | undefined>;

  /**
   * Find a result by its primary key. Share links store the result's `id` as
   * their `targetId` (MPG-056), so resolving a shared link is a lookup by id,
   * not by the client-minted `runId`.
   */
  findById(id: string): Promise<GameResult | undefined>;

  /** All results owned by a session token, newest first. */
  findByOwner(ownerToken: string, opts?: PaginationOpts): Promise<GameResult[]>;

  /**
   * All results owned by ANY of `ownerTokens`, newest first — the cross-device
   * read for MPG-091-b. The caller resolves the token set (all sessions linked
   * to an identity, or the bare token when unclaimed) and this unions them at
   * read time; no result row is ever re-owned on claim/adopt. An empty set
   * returns `[]`.
   */
  findByOwners(ownerTokens: readonly string[], opts?: PaginationOpts): Promise<GameResult[]>;

  /** Results for a game + optional event scope, newest first. */
  findByGameAndEvent(
    gameId: string,
    eventId?: string | null,
    opts?: PaginationOpts,
  ): Promise<GameResult[]>;

  /** Delete all results owned by a token. Returns count deleted. */
  deleteByOwner(ownerToken: string): Promise<number>;

  /** Delete results older than `cutoff`. Returns count deleted. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  readonly id: string;
  readonly gameId: string;
  readonly metric: string;
  readonly eventId: string | null;
  readonly timeBucket: string | null;
  readonly ownerToken: string;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly bestScore: number | null;
  readonly totalGames: number;
  readonly runId: string | null;
  readonly updatedAt: Date;
}

export interface UpsertLeaderboardEntry {
  readonly gameId: string;
  readonly metric: string;
  readonly eventId?: string | null;
  readonly timeBucket?: string | null;
  readonly ownerToken: string;
  readonly wins?: number;
  readonly losses?: number;
  readonly draws?: number;
  readonly bestScore?: number | null;
  readonly totalGames?: number;
  readonly runId?: string | null;
}

export interface LeaderboardFilter {
  readonly eventId?: string | null;
  readonly timeBucket?: string | null;
}

export interface LeaderboardRepo {
  /** Insert or update a leaderboard entry. Upsert key = (gameId, eventId, timeBucket, ownerToken). */
  upsert(entry: UpsertLeaderboardEntry): Promise<LeaderboardEntry>;

  /** Top N entries for a game + metric, highest first. */
  topN(
    gameId: string,
    metric: string,
    n: number,
    filter?: LeaderboardFilter,
  ): Promise<LeaderboardEntry[]>;

  /** 1-based rank of a specific owner. Undefined if not on the board. */
  rankOf(
    gameId: string,
    metric: string,
    ownerToken: string,
    filter?: LeaderboardFilter,
  ): Promise<number | undefined>;

  /**
   * Best (numerically smallest) 1-based rank held by ANY of `ownerTokens` — the
   * cross-device `yourRank` for MPG-091-b. Entries stay per-token aggregates
   * (nothing is merged on claim/adopt); "your rank" is resolved at read time as
   * the highest-placed of the caller's linked sessions. Undefined if none of
   * them are on the board; an empty set is also undefined.
   */
  rankOfBest(
    gameId: string,
    metric: string,
    ownerTokens: readonly string[],
    filter?: LeaderboardFilter,
  ): Promise<number | undefined>;

  /** Delete all entries owned by a token. Returns count deleted. */
  deleteByOwner(ownerToken: string): Promise<number>;

  /** Delete all entries scoped to an event. Returns count deleted. */
  deleteByEvent(eventId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Share Link
// ---------------------------------------------------------------------------

export interface ShareLink {
  readonly id: string;
  readonly token: string;
  readonly kind: string;
  readonly targetId: string;
  readonly ownerToken: string;
  readonly eventId: string | null;
  readonly expiresAt: Date | null;
  readonly revoked: boolean;
  readonly createdAt: Date;
}

export interface NewShareLink {
  readonly token: string;
  readonly kind: string;
  readonly targetId: string;
  readonly ownerToken: string;
  readonly eventId?: string | null;
  readonly expiresAt?: Date | null;
}

export interface ShareLinkRepo {
  /** Create a share link. */
  create(link: NewShareLink): Promise<ShareLink>;

  /** Resolve a share link by its public token. Returns undefined if not found, revoked, or expired. */
  findByToken(token: string): Promise<ShareLink | undefined>;

  /** Revoke a share link. Only the owner can revoke. Returns true if revoked. */
  revoke(token: string, ownerToken: string): Promise<boolean>;

  /** Delete all share links owned by a token. Returns count deleted. */
  deleteByOwner(ownerToken: string): Promise<number>;

  /** Delete expired share links. Returns count deleted. */
  deleteExpired(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Analytics Event (MPG-097)
// ---------------------------------------------------------------------------

export interface AnalyticsEvent {
  readonly id: string;
  readonly name: string;
  readonly ownerToken: string;
  readonly gameId: string | null;
  readonly shareLinkId: string | null;
  readonly eventId: string | null;
  readonly props: unknown;
  readonly createdAt: Date;
}

export interface NewAnalyticsEvent {
  readonly name: string;
  readonly ownerToken: string;
  readonly gameId?: string | null;
  readonly shareLinkId?: string | null;
  readonly eventId?: string | null;
  readonly props?: unknown;
  /**
   * When the event actually happened. Omitted for server-side events (the
   * write *is* the moment). Client batches may deliver late, so they carry
   * their own timestamp rather than being credited to flush time — a funnel
   * that timestamps at flush would smear every metric by the batch interval.
   */
  readonly createdAt?: Date;
}

export interface EventCount {
  readonly name: string;
  readonly count: number;
}

export interface EventRepo {
  /**
   * Append events. Batched because the client flushes in batches and because
   * one round-trip per event would make instrumentation cost more than the
   * thing it measures. Append-only: no update, no delete-by-id.
   */
  record(events: readonly NewAnalyticsEvent[]): Promise<void>;

  /** Count events by name in `[since, until)`. The primitive every funnel rate is built from. */
  countByName(since: Date, until: Date): Promise<EventCount[]>;

  /** Distinct sessions that emitted `name` in `[since, until)`. Denominator for per-user rates. */
  countDistinctOwners(name: string, since: Date, until: Date): Promise<number>;

  /** Delete all events owned by a token. Returns count deleted. */
  deleteByOwner(ownerToken: string): Promise<number>;

  /** Delete events older than `cutoff`. Returns count deleted. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

// ---------------------------------------------------------------------------
// Report (MPG-092 slice 2 — report-a-name)
// ---------------------------------------------------------------------------

/**
 * A player-filed report about authored content (a username or handle at L1/L2).
 *
 * This is a **review queue, not an enforcement action**: writing a report
 * hides nothing and blocks no one. A human reviewer (MPG-103/104) decides what
 * happens. The row is owner-scoped by the *reporter's* session token — the same
 * opaque no-PII token as everywhere else, FK-cascaded so "forget me" erases a
 * reporter's filings along with the rest of their trail.
 *
 * `targetId` is a plain string, not an FK: targets are heterogeneous (a
 * username belongs to a session, a handle to an identity, later a name to a
 * variant), so it stores whatever id the reported surface uses, uninterpreted.
 */
export interface Report {
  readonly id: string;
  readonly kind: string;
  readonly targetId: string;
  readonly reason: string | null;
  readonly reporterToken: string;
  readonly createdAt: Date;
}

export interface NewReport {
  readonly kind: string;
  readonly targetId: string;
  readonly reason?: string | null;
  readonly reporterToken: string;
}

export interface ReportRepo {
  /** File a report. Append-only — a report is never updated, only reviewed elsewhere. */
  create(report: NewReport): Promise<Report>;

  /** All reports filed by a session token, newest first. */
  findByReporter(reporterToken: string, opts?: PaginationOpts): Promise<Report[]>;

  /** Delete all reports filed by a token ("forget me"). Returns count deleted. */
  deleteByOwner(reporterToken: string): Promise<number>;

  /** Delete reports older than `cutoff`. Returns count deleted. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

// ---------------------------------------------------------------------------
// Variant (MPG-089 — save & share a customized game)
// ---------------------------------------------------------------------------

/**
 * A named, player-authored customization of a base game. At L1 (ADR 0007) the
 * customization is `cosmetics` — a flat, opaque `string→string` map the server
 * stores but never interprets (the `CosmeticSchema` lives in `apps/web`).
 *
 * `forkedFrom` is the id of the variant this one was derived from, if any —
 * provisioned for lineage (MPG-099); no fork path ships at L1.
 */
export interface Variant {
  readonly id: string;
  readonly name: string;
  readonly ownerToken: string;
  readonly baseGameId: string;
  readonly cosmetics: Readonly<Record<string, string>>;
  readonly forkedFrom: string | null;
  readonly createdAt: Date;
}

export interface NewVariant {
  readonly name: string;
  readonly ownerToken: string;
  readonly baseGameId: string;
  readonly cosmetics: Readonly<Record<string, string>>;
  readonly forkedFrom?: string | null;
}

export interface VariantRepo {
  /** Persist a new variant. */
  create(variant: NewVariant): Promise<Variant>;

  /**
   * Find a variant by its primary key. A `kind: "variant"` share link stores
   * this id as its `targetId` (MPG-089-b), so resolving a shared variant is a
   * lookup by id.
   */
  findById(id: string): Promise<Variant | undefined>;

  /** All variants authored by a session token, newest first. */
  findByOwner(ownerToken: string, opts?: PaginationOpts): Promise<Variant[]>;

  /** Delete all variants authored by a token ("forget me"). Returns count deleted. */
  deleteByOwner(ownerToken: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Chat Message (CHAT-021 — durable chat history)
// ---------------------------------------------------------------------------

/**
 * A persisted chat message. Keyed by the **derived channel** it was published
 * to (`chat:<roomId>` or the private `chat:p-<hmac>`), never by the room secret
 * — a private room's history groups by its opaque hash. `text` is already
 * profanity-masked (the store never holds raw text); `ts` is the message's
 * authoritative broadcast timestamp (epoch ms), the same one the live Ably
 * message carried, so history and live reconcile by `id` and sort on one clock.
 */
export interface ChatStoredMessage {
  readonly id: string;
  readonly channel: string;
  readonly roomId: string;
  readonly senderToken: string;
  readonly senderName: string;
  readonly text: string;
  readonly ts: number;
}

export interface NewChatMessage {
  readonly id: string;
  readonly channel: string;
  readonly roomId: string;
  readonly senderToken: string;
  readonly senderName: string;
  readonly text: string;
  readonly ts: number;
}

/** A paging cursor into a channel's history: everything strictly older than this. */
export interface ChatCursor {
  readonly ts: number;
  readonly id: string;
}

export interface ChatPageOpts {
  /** Return only messages strictly older than this `(ts, id)`. Omit for the newest page. */
  readonly before?: ChatCursor;
  /** Max messages to return. */
  readonly limit: number;
}

export interface ChatMessageRepo {
  /**
   * Persist a message. Idempotent on `id` — a retried write (or the same id
   * arriving twice) is a no-op, never a duplicate row or an error.
   */
  append(message: NewChatMessage): Promise<void>;

  /**
   * Persist a batch in one round trip, for the write-behind history queue
   * (CHAT-023). Same idempotency contract as {@link append}, per message.
   *
   * Optional: a repo that doesn't implement it is written one message at a
   * time by the queue, which is correct, just chattier.
   */
  appendMany?(messages: readonly NewChatMessage[]): Promise<void>;

  /**
   * A page of a channel's messages, **newest first**, strictly older than
   * `before` when given. `(ts, id)` is the total order — ties on `ts` break by
   * `id`, so paging never skips or repeats a same-millisecond message.
   */
  page(channel: string, opts: ChatPageOpts): Promise<ChatStoredMessage[]>;

  /** Delete all messages sent by a token ("forget me"). Returns count deleted. */
  deleteByOwner(senderToken: string): Promise<number>;

  /** Delete messages older than `cutoff`. Returns count deleted. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

// ---------------------------------------------------------------------------
// Chat Room (CHAT-022 — admin-owned room registry)
// ---------------------------------------------------------------------------

export type ChatRoomVisibility = "public" | "private";

/**
 * A room as the registry holds it — **including the secret**, which is why this
 * type never leaves the server. The wire shape the lobby renders is built from
 * it by dropping `secret` (docs/CHAT_UI.md §6.2).
 */
export interface ChatRoom {
  readonly id: string;
  readonly label: string;
  readonly visibility: ChatRoomVisibility;
  /** The shared room code; non-null exactly when `visibility === "private"`. */
  readonly secret: string | null;
  readonly sortOrder: number;
}

/**
 * Read-only by design. Rooms are administrator-owned and managed directly in
 * the database, so there is deliberately no `create`/`update`/`delete` here —
 * see docs/CHAT_UI.md §6.3.1 for the `ADMIN_TOKEN` shape if that ever changes.
 */
export interface ChatRoomRepo {
  /** Every room, in admin order (`sortOrder` asc, then `id` asc). */
  list(): Promise<ChatRoom[]>;

  /** One room by slug, or `null` when no such room exists. */
  get(roomId: string): Promise<ChatRoom | null>;
}

// ---------------------------------------------------------------------------
// Store (bundle of all repos)
// ---------------------------------------------------------------------------

export interface Store {
  readonly sessions: SessionRepo;
  readonly identities: IdentityRepo;
  readonly results: ResultRepo;
  readonly leaderboard: LeaderboardRepo;
  readonly shareLinks: ShareLinkRepo;
  readonly events: EventRepo;
  readonly reports: ReportRepo;
  readonly variants: VariantRepo;
  readonly chat: ChatMessageRepo;
  readonly chatRooms: ChatRoomRepo;
}

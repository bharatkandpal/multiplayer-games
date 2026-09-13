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
// Store (bundle of all repos)
// ---------------------------------------------------------------------------

export interface Store {
  readonly sessions: SessionRepo;
  readonly identities: IdentityRepo;
  readonly results: ResultRepo;
  readonly leaderboard: LeaderboardRepo;
  readonly shareLinks: ShareLinkRepo;
  readonly events: EventRepo;
}

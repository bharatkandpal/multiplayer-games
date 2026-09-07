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
// Store (bundle of all repos)
// ---------------------------------------------------------------------------

export interface Store {
  readonly sessions: SessionRepo;
  readonly results: ResultRepo;
  readonly leaderboard: LeaderboardRepo;
  readonly shareLinks: ShareLinkRepo;
}

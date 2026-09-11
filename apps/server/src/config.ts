/**
 * Server-wide hardening limits (MPG-021).
 *
 * Kept in one place so the production composition root (`index.ts`) and the tests
 * that stand up their own apps agree on the same bounds instead of drifting.
 */

/**
 * Max JSON request body size. The largest *legitimate* payload is a realtime
 * game's `inputLog` (leaderboard submit / result save), which the server must
 * receive in full to re-simulate for anti-cheat. Express's implicit default is
 * only 100kb — enough for ~1 minute of 60fps play — so this raises the ceiling
 * to comfortably cover long runs while still bounding memory on an
 * unauthenticated endpoint.
 */
export const JSON_BODY_LIMIT = "1mb";

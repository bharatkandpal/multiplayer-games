/**
 * Recovery codes — the device-key secret behind MPG-091's claimable handle.
 *
 * A recovery code is the *only* way to re-link a new device to a claimed
 * identity (no passwords, no email, no OAuth). So it must be:
 *   - high-entropy (unguessable — it authorises adopting an identity);
 *   - readable and re-typeable by a human, including a child, off a screen;
 *   - format-insensitive on input (case, spaces, and grouping dashes ignored).
 *
 * We store only the SHA-256 of the normalised code; the plaintext is shown to
 * the player exactly once at claim time. A leak of `recovery_code_hash` can't
 * be reversed into a usable code.
 */

import { createHash, randomInt } from "node:crypto";

/**
 * Crockford-ish alphabet with the visually ambiguous characters removed
 * (no 0/O, 1/I/L, U — the last to avoid accidental profanity). 29 symbols.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 4;
const GROUP_LEN = 4; // 16 symbols → ~29^16 ≈ 2^78 of entropy.

/** Generate a fresh recovery code, formatted as dash-separated groups. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = "";
    for (let i = 0; i < GROUP_LEN; i += 1) {
      group += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/**
 * Normalise a code for hashing/lookup: upper-case and strip anything that
 * isn't an alphabet symbol, so `k7qn-4fh2` and `K7QN 4FH2` hash identically.
 */
export function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** SHA-256 (hex) of the normalised code — what the store persists. */
export function hashRecoveryCode(raw: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(raw)).digest("hex");
}

/** The number of normalised symbols a valid code carries (cheap input guard). */
export const RECOVERY_CODE_LENGTH = GROUPS * GROUP_LEN;

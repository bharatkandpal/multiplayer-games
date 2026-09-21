/**
 * Minimal word-boundary profanity mask for chat text (CHAT-003).
 *
 * `moderation/moderate.ts` REJECTS handles/variant names outright; chat
 * cannot do that (a rejected chat message with no server-side transcript
 * has nowhere to show the sender why it vanished), so this masks instead of
 * blocking. Deliberately simple — a literal, case-insensitive, word-boundary
 * match against the same curated list moderation uses, replaced with
 * asterisks of the same length. It will not catch leetspeak/spacing
 * obfuscation the way `moderate.ts`'s collapse does; that tradeoff is
 * intentional for a masker (over-blocking a livelier chat surface is worse
 * than under-catching an determined obfuscator).
 */

import { PROFANITY } from "../moderation/wordlist.js";

function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROFANITY_PATTERN = new RegExp(`\\b(${PROFANITY.map(escapeRegExp).join("|")})\\b`, "gi");

/** Replace whole-word profanity matches with same-length asterisk runs. */
export function maskProfanity(text: string): string {
  return text.replace(PROFANITY_PATTERN, (match) => "*".repeat(match.length));
}

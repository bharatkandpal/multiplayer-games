// Reads motion durations from the design-token layer (../styles/tokens.css) so
// JS-driven pacing (e.g. the bot-vs-bot "thinking" delay) stays in lock-step with
// the CSS values — including the `prefers-reduced-motion` override, which zeroes
// `--duration-bot-thinking-step` globally (see tokens.css) so reduced-motion users
// see bots move without an artificial delay, not just without animation.

const FALLBACK_BOT_THINKING_STEP_MS = 600;

function readDurationMs(cssVarName: string, fallbackMs: number): number {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallbackMs;
  }
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
  if (raw === "") return fallbackMs;
  const value = raw.endsWith("ms")
    ? Number.parseFloat(raw)
    : raw.endsWith("s")
      ? Number.parseFloat(raw) * 1000
      : Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallbackMs;
}

/**
 * The pacing delay for one bot "move step" — how long a bot appears to "think"
 * before its move lands, so bot-vs-bot watch mode is followable (UX_PRINCIPLES §3).
 * Reads `--duration-bot-thinking-step`; falls back to 600ms if unavailable (e.g. SSR).
 */
export function getBotThinkingDelayMs(): number {
  return readDurationMs("--duration-bot-thinking-step", FALLBACK_BOT_THINKING_STEP_MS);
}

// Reads motion durations from the design-token layer (../styles/tokens.css) so
// JS-driven pacing (e.g. the bot-vs-bot "thinking" delay) stays in lock-step with
// the CSS values — including the `prefers-reduced-motion` override, which zeroes
// `--duration-bot-thinking-step` globally (see tokens.css) so reduced-motion users
// see bots move without an artificial delay, not just without animation.

const FALLBACK_BOT_THINKING_STEP_MS = 600;
const FALLBACK_SURPRISE_SPIN_MS = 800;

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

/**
 * How long "Surprise me" shuffles before it lands on the game it already picked
 * (MPG-143). Reads `--duration-surprise-spin`, which `prefers-reduced-motion`
 * zeroes — so a reduced-motion player goes straight into the game rather than
 * watching a shuffle with the animation stripped out of it.
 *
 * The shuffle is decoration over a decision that has already been made, which is
 * what makes a delay in front of gameplay defensible here at all: it is local,
 * it is what the player asked for by pressing a dice button, and it is always
 * skippable (see `SurpriseMe`). If it ever becomes unskippable, it is in breach
 * of the "never block or delay gameplay" rule in `docs/UX_PRINCIPLES.md` §7.
 */
export function getSurpriseSpinMs(): number {
  return readDurationMs("--duration-surprise-spin", FALLBACK_SURPRISE_SPIN_MS);
}

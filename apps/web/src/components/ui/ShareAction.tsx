/**
 * The one-tap share affordance (MPG-087), as a shared component.
 *
 * Extracted when turn-based results became shareable (MPG-131): the real-time
 * game-over overlay had grown a hand-built share button, status line and
 * copy-fallback field, and reproducing that in the turn-based result actions
 * would have meant two share affordances drifting apart — the same complaint
 * `docs/DESIGN_LANGUAGE.md` slice UI-8 makes about the result card itself.
 *
 * The whole fallback ladder lives in `useShareLink`; this component is only its
 * UI, and it renders every rung:
 *
 *   • the button, labelled honestly for the platform ("Share" where a native
 *     sheet exists, "Copy link" where it doesn't — never promising a sheet that
 *     won't appear);
 *   • a politely-announced confirmation, in a slot that is always present so
 *     confirming a share never shifts the layout under the player's thumb;
 *   • and, when nothing automatic worked, the URL itself in a selectable field.
 *     That last rung is why this never renders an error: a share that can't be
 *     automated becomes a manual one, not a dead end.
 *
 * Deliberately unstyled beyond layout — it inherits colour and type from wherever
 * it is mounted, so it reads correctly both in the arcade overlay (which keeps its
 * dark treatment in light theme) and in the turn-based result actions.
 */

import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import { VisuallyHidden } from "./VisuallyHidden";
import { useShareLink } from "../../hooks/useShareLink";
import styles from "./ShareAction.module.css";

export interface ShareActionProps {
  /** The URL to share. Render nothing when you have none — this expects a real one. */
  url: string;
  /** Native-sheet title (usually the game). */
  title?: string;
  /** Brag-first accompanying text — the score/outcome leads, the link follows. */
  text?: string;
  /**
   * Overrides the label used where a native share sheet exists (default
   * "Share") — e.g. "Share score". The no-sheet label is deliberately NOT
   * overridable: it must keep saying "Copy link", because that is what the
   * button actually does there.
   */
  shareLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function ShareAction({
  url,
  title,
  text,
  shareLabel,
  variant = "secondary",
  size = "sm",
}: ShareActionProps): React.JSX.Element {
  const { share, status, canShare, reset } = useShareLink();

  const handleShare = (): void => {
    void share({
      url,
      ...(title !== undefined ? { title } : {}),
      ...(text !== undefined ? { text } : {}),
    });
  };

  return (
    <div className={styles.wrap}>
      <Button variant={variant} size={size} onClick={handleShare}>
        {canShare ? (shareLabel ?? "Share") : "Copy link"}
      </Button>

      {/* Always rendered (empty when idle) so the confirmation can't reflow the
          actions beneath it — see UX_PRINCIPLES §2 on stable state slots. */}
      <p className={styles.status} role="status">
        {status === "shared" ? "Shared!" : null}
        {status === "copied" ? "Link copied!" : null}
      </p>

      {status === "unavailable" ? (
        <label className={styles.fallback}>
          <VisuallyHidden>Link to copy</VisuallyHidden>
          <input
            className={styles.fallbackInput}
            type="text"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={reset}
          />
        </label>
      ) : null}
    </div>
  );
}

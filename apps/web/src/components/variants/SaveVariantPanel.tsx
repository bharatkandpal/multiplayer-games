/**
 * "Name + save this variant" (MPG-089-c) — the client half of MPG-089's
 * save-and-share loop, mounted on the customize surface itself (not a
 * post-game CTA — see the task's decided scope).
 *
 * Offline pillar, applied here exactly as `useClaimGate` applies it to the
 * claim prompt: the whole panel renders nothing until a boot probe
 * (`useBackendReachable`) confirms the backend is up. Customizing and playing
 * with a look never depend on this — they already work from
 * `cosmetics/storage.ts` alone — so a down backend simply means "save" isn't
 * offered, never an error in front of the customize menu.
 *
 * On success the response already carries the auto-minted `/s/:token` link
 * (the save route mints it in the same request — see the server's
 * `variantRoutes.ts` doc comment), so this reuses `ShareAction` /
 * `shareUrlForToken` rather than minting a second one.
 */

import { useId, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../ui/Button";
import { ShareAction } from "../ui/ShareAction";
import { shareUrlForToken } from "../../api/share.js";
import {
  isValidVariantNameFormat,
  saveVariant,
  type SaveVariantResult,
  type VariantNameReason,
} from "../../api/variants.js";
import { useBackendReachable } from "../../hooks/useBackendReachable.js";
import type { CosmeticConfig } from "../../cosmetics";
import styles from "./SaveVariantPanel.module.css";

export interface SaveVariantPanelProps {
  readonly baseGameId: string;
  readonly cosmetics: CosmeticConfig;
}

const NAME_MAX_LENGTH = 40;

/** Plain-language copy for the server's authoritative moderation reasons. */
function nameReasonCopy(reason: VariantNameReason): string {
  switch (reason) {
    case "EMPTY":
    case "TOO_SHORT":
      return "Give this variant a name.";
    case "TOO_LONG":
      return "Keep it under 40 characters.";
    case "INVALID_CHARS":
      return "Use letters, numbers, spaces, and basic punctuation only.";
    case "PROFANITY":
    case "RESERVED":
      return "That name isn't allowed — try something else.";
  }
}

/** Instant, no-request copy for the local format pre-check. */
function localFormatCopy(trimmed: string): string {
  if (trimmed.length === 0) return "Give this variant a name.";
  if (trimmed.length > NAME_MAX_LENGTH) return "Keep it under 40 characters.";
  return "Use letters, numbers, spaces, and basic punctuation only.";
}

/** Maps every non-success `saveVariant` outcome to one line of plain copy. */
function serverErrorCopy(result: Extract<SaveVariantResult, { ok: false }>): string {
  switch (result.reason) {
    case "invalid_name":
      return nameReasonCopy(result.detail);
    case "invalid_base_game":
    case "invalid_cosmetics":
      // Both are effectively "this shouldn't happen" for a client-generated
      // request — a stale build, a retired game, a corrupted local config.
      return "Couldn't save that — try customizing again.";
    case "unavailable":
      return "Couldn't reach the server — try again in a moment.";
  }
}

/**
 * The save-and-name form, plus its own success face (name confirmed + share
 * ladder) — a stable slot on the customize surface rather than a separate
 * modal, so saving never interrupts customizing.
 */
export function SaveVariantPanel({
  baseGameId,
  cosmetics,
}: SaveVariantPanelProps): React.JSX.Element | null {
  const reachable = useBackendReachable();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<{ name: string; shareUrl: string } | undefined>(undefined);
  const nameId = useId();
  const errorId = useId();

  // Never on the play/customize critical path — see the module comment.
  if (!reachable) return null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!isValidVariantNameFormat(trimmed)) {
      setError(localFormatCopy(trimmed));
      return;
    }
    setError(undefined);
    setSaving(true);
    void saveVariant({ baseGameId, name: trimmed, cosmetics }).then((result) => {
      setSaving(false);
      if (result.ok) {
        setSaved({ name: result.variant.name, shareUrl: shareUrlForToken(result.share.token) });
        return;
      }
      setError(serverErrorCopy(result));
    });
  };

  const saveAnother = (): void => {
    setSaved(undefined);
    setName("");
    setError(undefined);
  };

  if (saved) {
    return (
      <div className={styles.panel}>
        <p role="status" className={styles.savedText}>
          Saved as <strong>{saved.name}</strong> — share it so friends can play it too.
        </p>
        <ShareAction url={saved.shareUrl} title={saved.name} shareLabel="Share this variant" />
        <button type="button" className={styles.linkButton} onClick={saveAnother}>
          Save another version
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={styles.panel}>
      <p className={styles.intro}>Like this combo? Name it and save a link to share.</p>

      <label className={styles.label} htmlFor={nameId}>
        Variant name
      </label>
      <input
        id={nameId}
        className={styles.input}
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={NAME_MAX_LENGTH}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="e.g. Party Ghost"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      <div id={errorId} role="alert" aria-live="assertive" className={styles.error}>
        {error ?? ""}
      </div>

      <div className={styles.actions}>
        <Button type="submit" variant="secondary" loading={saving} loadingLabel="Saving">
          Save this variant
        </Button>
      </div>
    </form>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "./Button";
import { Modal } from "./Modal";
import type { ClaimView } from "../../hooks/useClaimGate";
import styles from "./ClaimHandlePrompt.module.css";

export interface ClaimHandlePromptProps {
  isOpen: boolean;
  view: ClaimView;
  /** The recovery code to reveal once, on the "recovery" view. */
  recoveryCode: string | undefined;
  /** The handle just claimed/adopted (for confirmation copy). */
  claimedHandle: string | undefined;
  claimError: string | undefined;
  adoptError: string | undefined;
  submitting: boolean;
  onSubmitClaim: (handle: string) => void;
  onSubmitAdopt: (code: string) => void;
  onConfirmSaved: () => void;
  onSwitchToAdopt: () => void;
  onSwitchToClaim: () => void;
  onCancel: () => void;
}

const TITLES: Record<ClaimView, string> = {
  claim: "Save your handle",
  recovery: "Save your recovery code",
  adopt: "Restore your handle",
  restored: "You're back",
};

/**
 * The claim/adopt/recovery modal (MPG-091-c). Three faces of one dialog:
 *
 *  • **claim** — pick a handle; a link swaps to the adopt form for returning players.
 *  • **recovery** — the recovery code shown **exactly once**, with a copy control
 *    and an explicit "this is the only copy" warning. Closing = acknowledging.
 *  • **adopt** — enter a recovery code to re-link this device to an existing handle.
 *
 * Local-first and never blocking: submitting a claim shows a brief `submitting`
 * state only; the game behind the modal is untouched. Format is checked here for
 * instant feedback (the gate re-checks), and every server error arrives as plain,
 * inline language via `claimError`/`adoptError`.
 */
export function ClaimHandlePrompt({
  isOpen,
  view,
  recoveryCode,
  claimedHandle,
  claimError,
  adoptError,
  submitting,
  onSubmitClaim,
  onSubmitAdopt,
  onConfirmSaved,
  onSwitchToAdopt,
  onSwitchToClaim,
  onCancel,
}: ClaimHandlePromptProps): React.JSX.Element {
  const [handle, setHandle] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const handleInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const handleErrorId = useId();
  const codeErrorId = useId();

  // Reset transient field state whenever the modal opens or changes face, so a
  // reopened dialog never shows a stale value or "Copied" flash.
  useEffect(() => {
    if (!isOpen) return;
    setCopied(false);
    if (view === "claim") requestAnimationFrame(() => handleInputRef.current?.focus());
    if (view === "adopt") requestAnimationFrame(() => codeInputRef.current?.focus());
  }, [isOpen, view]);

  // Closing the recovery view IS acknowledging the code (it can't be shown
  // again). Every other view just cancels.
  const handleClose = view === "recovery" ? onConfirmSaved : onCancel;

  const submitClaim = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmitClaim(handle);
  };

  const submitAdopt = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmitAdopt(code);
  };

  const copyCode = (): void => {
    if (!recoveryCode) return;
    void navigator.clipboard
      ?.writeText(recoveryCode)
      .then(() => setCopied(true))
      .catch(() => {
        // Clipboard blocked/unavailable — the code is on screen to copy by hand.
      });
  };

  return (
    <Modal isOpen={isOpen} title={TITLES[view]} onClose={handleClose}>
      {view === "claim" ? (
        <form onSubmit={submitClaim} noValidate>
          <p className={styles.intro}>
            Nice one — save a handle so this score follows you to your other devices. No password,
            no email.
          </p>

          <label className={styles.label} htmlFor="claim-handle-input">
            Handle
          </label>
          <input
            id="claim-handle-input"
            ref={handleInputRef}
            className={styles.input}
            type="text"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            minLength={3}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={claimError ? true : undefined}
            aria-describedby={claimError ? handleErrorId : undefined}
          />

          <div id={handleErrorId} role="alert" aria-live="assertive" className={styles.error}>
            {claimError ?? ""}
          </div>

          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={submitting} loadingLabel="Saving">
              Save handle
            </Button>
          </div>

          <p className={styles.altLine}>
            Already have a handle?{" "}
            <button type="button" className={styles.linkButton} onClick={onSwitchToAdopt}>
              Enter your recovery code
            </button>
          </p>
        </form>
      ) : null}

      {view === "recovery" ? (
        <div>
          <p className={styles.intro}>
            {claimedHandle ? (
              <>
                <strong>{claimedHandle}</strong> is yours.{" "}
              </>
            ) : null}
            This recovery code is the <strong>only</strong> way to get your handle back on another
            device. Save it now — we can't show it again.
          </p>

          <div className={styles.codeBlock}>
            <code className={styles.code}>{recoveryCode}</code>
          </div>

          <div className={styles.actions}>
            <Button variant="secondary" onClick={copyCode}>
              {copied ? "Copied ✓" : "Copy code"}
            </Button>
            <Button variant="primary" onClick={onConfirmSaved}>
              I've saved it
            </Button>
          </div>

          <div aria-live="polite" className={styles.srStatus}>
            {copied ? "Recovery code copied to clipboard." : ""}
          </div>
        </div>
      ) : null}

      {view === "adopt" ? (
        <form onSubmit={submitAdopt} noValidate>
          <p className={styles.intro}>
            Enter the recovery code you saved when you claimed your handle, and we'll link it to
            this device.
          </p>

          <label className={styles.label} htmlFor="adopt-code-input">
            Recovery code
          </label>
          <input
            id="adopt-code-input"
            ref={codeInputRef}
            className={styles.input}
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            aria-invalid={adoptError ? true : undefined}
            aria-describedby={adoptError ? codeErrorId : undefined}
          />

          <div id={codeErrorId} role="alert" aria-live="assertive" className={styles.error}>
            {adoptError ?? ""}
          </div>

          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={submitting} loadingLabel="Restoring">
              Restore handle
            </Button>
          </div>

          <p className={styles.altLine}>
            <button type="button" className={styles.linkButton} onClick={onSwitchToClaim}>
              ← Claim a new handle instead
            </button>
          </p>
        </form>
      ) : null}

      {view === "restored" ? (
        <div>
          <p className={styles.intro} role="status">
            {claimedHandle ? (
              <>
                Welcome back, <strong>{claimedHandle}</strong> — your scores and history are linked
                to this device now.
              </>
            ) : (
              <>Your handle is linked to this device now.</>
            )}
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={onConfirmSaved}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

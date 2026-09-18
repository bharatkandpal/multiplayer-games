import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { isValidUsernameFormat } from "../../api/username.js";
import styles from "./UsernamePrompt.module.css";

export interface UsernamePromptProps {
  isOpen: boolean;
  /** Called on a valid, local-only submit — do not wait on this for anything network-related. */
  onSubmit: (username: string) => void;
  /** Backs out without picking a name (Escape/backdrop/close button). */
  onCancel: () => void;
  /**
   * Preset inline error, shown when the picker reopens after a background
   * sync found a genuine, server-confirmed collision (see `useUsernameGate`).
   */
  collisionMessage?: string | undefined;
  /**
   * Pre-fills the input — used by the "change your name" flow so an existing
   * (auto-assigned or chosen) name is there to edit rather than a blank box.
   * Defaults to empty (the first-run picker).
   */
  initialValue?: string;
  /** Modal heading. Defaults to the first-run "Pick a username". */
  title?: string;
  /** Intro copy above the field. Defaults to the online-play explanation. */
  intro?: string;
}

const FORMAT_ERROR = "3–20 characters: letters, numbers, _ or - only.";
const DEFAULT_INTRO =
  "Playing online needs a name so other players (and the leaderboard) can recognize you.";

/**
 * First-run username picker (MPG-077). Local-first: submitting a valid name
 * saves it to this browser and dismisses immediately — the server sync that
 * confirms global uniqueness happens in the background and never blocks
 * this form. The only inline error is a genuine name collision (reported
 * back in via `collisionMessage` when the picker is reopened) or an
 * obviously-invalid format, checked client-side before it would ever round-trip.
 */
export function UsernamePrompt({
  isOpen,
  onSubmit,
  onCancel,
  collisionMessage,
  initialValue = "",
  title = "Pick a username",
  intro = DEFAULT_INTRO,
}: UsernamePromptProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [formatError, setFormatError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const error = formatError ?? collisionMessage;

  useEffect(() => {
    if (!isOpen) return;
    setSubmitting(false);
    setFormatError(undefined);
    // Seed the field with the current name each time it opens (edit flow), and
    // select it so a re-type replaces rather than appends.
    setValue(initialValue);
    if (initialValue || collisionMessage) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isOpen, collisionMessage, initialValue]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = value.trim();

    if (!isValidUsernameFormat(trimmed)) {
      setFormatError(FORMAT_ERROR);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    setFormatError(undefined);
    setSubmitting(true);
    // Local-first: this is synchronous storage + a callback, never a network
    // await — the brief `submitting` state exists only to keep the button
    // visibly responsive for the one tick before the modal is dismissed.
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <Modal isOpen={isOpen} title={title} onClose={onCancel}>
      <form onSubmit={handleSubmit} noValidate>
        <p className={styles.intro}>{intro}</p>

        <label className={styles.label} htmlFor="username-input">
          Username
        </label>
        <input
          id="username-input"
          ref={inputRef}
          className={styles.input}
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (formatError) setFormatError(undefined);
          }}
          minLength={3}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoFocus
        />

        <div id={errorId} role="alert" aria-live="assertive" className={styles.error}>
          {error ?? ""}
        </div>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={submitting} loadingLabel="Saving">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { cx } from "./cx";
import {
  ensureUsername,
  isValidUsernameFormat,
  onUsernameChange,
  rerollUsername,
  setStoredUsername,
  syncUsername,
} from "../../api/username.js";
import { clearLocalData } from "../../api/localData.js";
import styles from "./ProfileMenu.module.css";

export interface ProfileMenuProps {
  className?: string | undefined;
  /**
   * Runs after local data is cleared. Defaults to a page reload so every
   * in-memory copy (theme, name, game state) restarts from the empty store.
   */
  onCleared?: () => void;
}

type View = "main" | "edit" | "confirmClear";

const FORMAT_ERROR = "3–20 characters: letters, numbers, _ or - only.";
const FOCUSABLE = "button:not([disabled]), input:not([disabled])";

/**
 * Profile avatar + anchored popover (MPG-147): who you are, in one place.
 *
 * Shows the auto-assigned name, lets the player shuffle or type their own, and
 * offers Clear local data behind an in-page confirmation. One popover at every
 * width. It is a non-modal dialog (it holds a form, so not `role="menu"`):
 * Esc or an outside press closes it and focus returns to the avatar; arrows
 * and Tab both walk its controls. Global settings that deserve a home here
 * later (e.g. sound) are just more rows in `main`. The theme switch lives in
 * the bar, not here.
 *
 * Local-first throughout: every action writes locally and any uniqueness sync is
 * fire-and-forget, so nothing here blocks on, or errors from, the network. A
 * sync status (`hasUnconfirmedUsername`) is deliberately never shown.
 */
export function ProfileMenu({ className, onCleared }: ProfileMenuProps): React.JSX.Element {
  const [name, setName] = useState(ensureUsername);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const errorId = useId();

  useEffect(() => onUsernameChange(setName), []);

  const close = (restoreFocus = true): void => {
    setOpen(false);
    setView("main");
    setError(undefined);
    if (restoreFocus) triggerRef.current?.focus();
  };

  // Move focus to the first control whenever the panel opens or changes view.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(
      view === "edit" ? "input" : FOCUSABLE,
    );
    first?.focus();
    if (view === "edit") (first as HTMLInputElement | undefined)?.select();
  }, [open, view]);

  // Outside press closes without stealing focus from what was pressed.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  };

  // Tabbing past either end leaves the popover: close it, keep natural order.
  const onBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (next && !rootRef.current?.contains(next)) close(false);
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const next = draft.trim();
    if (!isValidUsernameFormat(next)) {
      setError(FORMAT_ERROR);
      return;
    }
    // Optimistic, local-first: reflect now, sync in the background. A genuine
    // collision on a chosen name reopens the app's username picker.
    setStoredUsername(next, false, false);
    setName(next);
    void syncUsername(next);
    setView("main");
    setError(undefined);
  };

  const confirmClear = (): void => {
    clearLocalData();
    close(false);
    (onCleared ?? (() => window.location.reload()))();
  };

  return (
    <div ref={rootRef} className={cx(styles.root, className)} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`Your profile, ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Avatar name={name} />
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className={styles.panel}
          onKeyDown={onKeyDown}
        >
          {view === "main" ? (
            <>
              <p className={styles.eyebrow} id={titleId}>
                Playing as
              </p>
              <p className={styles.name}>{name}</p>
              <div className={styles.rows}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDraft(name);
                    setView("edit");
                  }}
                >
                  Edit name
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setName(rerollUsername())}>
                  Shuffle name
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setView("confirmClear")}>
                  Clear local data
                </Button>
              </div>
            </>
          ) : null}

          {view === "edit" ? (
            <form onSubmit={submitEdit} noValidate>
              <p className={styles.eyebrow} id={titleId}>
                Change your name
              </p>
              <input
                className={styles.input}
                type="text"
                aria-label="Name"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(undefined);
                }}
                maxLength={20}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
              <div id={errorId} role="alert" className={styles.error}>
                {error ?? ""}
              </div>
              <div className={styles.rows}>
                <Button type="submit" variant="primary" size="sm">
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setView("main");
                    setError(undefined);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}

          {view === "confirmClear" ? (
            <>
              <p className={styles.eyebrow} id={titleId}>
                Clear local data?
              </p>
              <p className={styles.body}>
                This forgets your name, scores and settings on this device. It can&apos;t be undone.
              </p>
              <div className={styles.rows}>
                <Button variant="danger" size="sm" onClick={confirmClear}>
                  Clear everything
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setView("main")}>
                  Keep my data
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

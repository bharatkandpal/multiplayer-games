// CHAT-006 — the chat screen. A game already works with chat's backend
// completely down (CLAUDE.md "no feature may break offline play"): an
// unreachable chat service just disables the composer and shows a quiet
// note, never an error banner or a dead end.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, UIEvent } from "react";
import {
  BackArrowIcon,
  Button,
  HomeIcon,
  Modal,
  ShareAction,
  StatusBadge,
  Toast,
  UsernamePrompt,
} from "../components/ui";
import { useChatChannel } from "../hooks/useChatChannel.js";
import { useChatRooms } from "../hooks/useChatRooms.js";
import { requestChatToken } from "../api/chat.js";
import type { ChatMessage, ChatRoomSummary } from "../api/chat.js";
import { getSessionToken } from "../api/session.js";
import { DEFAULT_CHAT_ROOM_ID, roomLabel, roomShareUrl } from "./chatRoom.js";
import {
  ensureUsername,
  onUsernameChange,
  setStoredUsername,
  syncUsername,
} from "../api/username.js";
import { getMutedTokens, muteToken, onMuteChange } from "../api/chatMute.js";
import { getRoomSecret, setRoomSecret } from "../api/chatSecret.js";
import { RoomRail } from "./RoomRail.js";
import styles from "./ChatScreen.module.css";

/** How another room is opened — public, or private with a `?p=1` link (CHAT-020). */
export interface OpenRoomOptions {
  /** Open the target as a private room (the secret is already persisted by the caller). */
  readonly private?: boolean;
}

export interface ChatScreenProps {
  /** The chat room to join — `"global"` for the default room (CHAT-022). */
  roomId: string;
  /**
   * Site chrome to hang in the screen's own header. Chat owns the whole canvas
   * (no page chrome bar above it), so anything the site would normally offer
   * there — the theme switch — is handed in and rendered inside this header.
   */
  toolbar?: React.ReactNode;
  /**
   * This room is private (CHAT-020): its channel is derived from a shared
   * secret, so the screen prompts for that secret (a lock gate) before
   * connecting, unless one is already held for this tab.
   */
  isPrivate?: boolean;
  onBack: () => void;
  /**
   * Navigate to another room. When provided, the room rail can switch rooms and
   * the room bar can share the current one. Omit to pin the screen to one room.
   * Rooms are administrator-owned (CHAT-022), so nothing here creates one.
   */
  onOpenRoom?: (roomId: string, opts?: OpenRoomOptions) => void;
}

const MAX_LENGTH = 500;

/** Characters left before the composer starts showing its remaining count. */
const COUNTER_VISIBLE_FROM = 50;

/**
 * How close to the bottom (px) the reader has to be for a new message to
 * auto-scroll them along with it. Anything further and they've scrolled up
 * to re-read history on purpose — a new arrival shouldn't yank them back.
 */
const AUTO_SCROLL_THRESHOLD = 120;

/**
 * How close to the top (px) the reader has to scroll before we fetch the next
 * older page of history (CHAT-021). A little slack so the load starts just
 * before they hit the very top, not only once they're stuck against it.
 */
const NEAR_TOP_THRESHOLD = 80;

export function ChatScreen({
  roomId,
  isPrivate = false,
  onBack,
  onOpenRoom,
  toolbar,
}: ChatScreenProps): React.JSX.Element {
  // A private room needs its shared secret before it can connect. We may
  // already hold one for this tab (entered earlier, survived a reload); if not,
  // the room stays "locked" and shows a secret gate instead of the chat body.
  const [secret, setSecret] = useState<string | null>(() =>
    isPrivate ? getRoomSecret(roomId) : null,
  );
  const locked = isPrivate && secret === null;

  const { messages, status, send, hasMoreHistory, loadingOlder, loadOlder } = useChatChannel(
    roomId,
    secret ?? undefined,
    !locked,
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  const [muted, setMuted] = useState<Set<string>>(() => getMutedTokens());
  const [name, setName] = useState(ensureUsername);
  const [editingName, setEditingName] = useState(false);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const { rooms, loading: roomsLoading } = useChatRooms();
  // The room list is collapsed by default, at every width: you arrive in a
  // conversation (the Global room), and the list is one labelled control away.
  // Wide screens open it as a column beside the conversation, narrow ones as a
  // drawer over it — both driven from this one flag, in CSS.
  const [railOpen, setRailOpen] = useState(false);
  // Set when a room code is rejected, so the gate can say so in place rather
  // than degrading to silence (docs/CHAT_UI.md §6.5).
  const [unlockError, setUnlockError] = useState<string | undefined>(undefined);

  // Prefer the registry's label over the slug — the rail knows a room's real
  // name, and a room reached by direct link falls back to the slug until the
  // list arrives.
  const currentRoomLabel = rooms?.find((r) => r.id === roomId)?.label ?? roomLabel(roomId);
  // With no registry there is no list to open, so the toggle isn't offered at
  // all (CHAT-022 degrades to absence). While it loads we still offer it — the
  // rail renders its own skeleton.
  const hasRooms = roomsLoading || (rooms !== null && rooms.length > 0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // When we prepend an older page, this holds the pre-load distance from the
  // bottom of the scroll content. Restoring it after the prepend keeps the
  // reader looking at the same messages instead of being thrown to the top.
  const prependAnchorRef = useRef<number | null>(null);
  const errorId = useId();
  const counterId = useId();
  const railId = useId();

  const myToken = getSessionToken();

  useEffect(() => onUsernameChange(setName), []);
  useEffect(() => onMuteChange(() => setMuted(getMutedTokens())), []);

  // Escape closes the room list — on a narrow screen it covers the
  // conversation, and a covering surface must always be dismissible.
  useEffect(() => {
    if (!railOpen) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railOpen]);

  // Focus the composer the moment chat is actually usable, so a keyboard user
  // lands ready to type rather than having to hunt for the field.
  useEffect(() => {
    if (status === "live") inputRef.current?.focus();
  }, [status]);

  // Keep the viewport sensible as the message list changes. A prepended older
  // page (CHAT-021) restores the reader's prior position; otherwise we
  // auto-scroll to the newest message, but only when they were already near the
  // bottom (see AUTO_SCROLL_THRESHOLD). useLayoutEffect so the adjustment lands
  // before paint — no visible jump. Runs before the aria-live announce settles.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (prependAnchorRef.current !== null) {
      // Older messages were added at the top: hold the same distance from the
      // bottom, so the messages under the reader's eye don't move.
      list.scrollTop = list.scrollHeight - prependAnchorRef.current;
      prependAnchorRef.current = null;
      return;
    }
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceFromBottom < AUTO_SCROLL_THRESHOLD) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  // Scroll-up paging: near the top, pull the next older page. We record the
  // distance from the bottom first so the layout effect above can restore it
  // once the page prepends. Guarded on `hasMoreHistory`/`loadingOlder` so it
  // fires once per page, and a history outage simply stops offering more (the
  // hook degrades to absence) — never an error.
  const handleListScroll = (event: UIEvent<HTMLDivElement>): void => {
    const list = event.currentTarget;
    if (list.scrollTop <= NEAR_TOP_THRESHOLD && hasMoreHistory && !loadingOlder) {
      prependAnchorRef.current = list.scrollHeight - list.scrollTop;
      void loadOlder();
    }
  };

  const visibleMessages = messages.filter((message) => !muted.has(message.sender.token));

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || status !== "live") return;
    setSending(true);
    setSendError(undefined);
    setDraft("");
    void send(text).then((result) => {
      setSending(false);
      if (result.ok) return;
      // Never a raw error — plain language, and the draft is restored so
      // nothing typed is lost on a failed send (UX_PRINCIPLES §2 "Error").
      setSendError(
        result.reason === "rate_limited"
          ? "Slow down a little — try again in a moment."
          : "Couldn't send that. Chat may be unavailable right now.",
      );
      setDraft(text);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
  };

  // The counter is only worth space once the limit is in sight — before that it
  // reports a number nobody is watching.
  const remaining = MAX_LENGTH - draft.length;
  const showCounter = remaining <= COUNTER_VISIBLE_FROM;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleNameSubmit = (next: string): void => {
    // Local-first, same pattern as `UsernameBadge` — never waits on the network.
    setStoredUsername(next, false, false);
    setEditingName(false);
    void syncUsername(next);
  };

  // Unlock a private room. The registry now checks the code server-side
  // (CHAT-022), so a wrong one is a real, recoverable error told in place —
  // before it became a registry, a wrong code silently landed you on a
  // different empty channel with nothing to distinguish it from a quiet room.
  const handleUnlock = (next: string): void => {
    const trimmed = next.trim();
    if (!trimmed) return;
    setUnlockError(undefined);
    void requestChatToken(roomId, trimmed).then((result) => {
      if (result.ok) {
        setRoomSecret(roomId, trimmed);
        setSecret(trimmed);
        return;
      }
      if (result.reason === "bad_secret") {
        setUnlockError("That code doesn't match. Check it and try again.");
        return;
      }
      // Unknown room or chat down: degrade to absence rather than blaming the
      // code the player typed — it may well have been right.
      setUnlockError(undefined);
    });
  };

  // Selecting a room from the rail. A private room routes through the gate; a
  // public one opens straight into the conversation.
  const handleRoomSelect = (room: ChatRoomSummary): void => {
    setRailOpen(false);
    if (room.id === roomId) return;
    onOpenRoom?.(room.id, { private: room.visibility === "private" });
  };

  const badgeStatus =
    status === "live" ? "success" : status === "connecting" ? "neutral" : "warning";
  const badgeLabel =
    status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Unavailable";

  return (
    <div className={styles.main}>
      {/* One header, not two: the app bar carries the room list toggle, the way
          home, the current room's name, its status and its share control. Every
          pixel below it belongs to the conversation (docs/CHAT_UI.md §1.1). */}
      <header className={styles.topBar}>
        <div className={styles.topBarSide}>
          {/* Hidden when there is no list to open — chat degrades to absence,
              never to a control that does nothing. */}
          {hasRooms ? (
            <Button
              variant="ghost"
              size="sm"
              className={styles.railToggle}
              onClick={() => setRailOpen((open) => !open)}
              aria-expanded={railOpen}
              aria-controls={railId}
            >
              <span className={styles.railToggleGlyph} aria-hidden="true">
                ☰
              </span>
              <span className={styles.railToggleLabel}>Rooms</span>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="Home">
            <span className={styles.homeIcons} aria-hidden="true">
              <BackArrowIcon />
              <HomeIcon />
            </span>
            <span className={styles.homeLabel}>Home</span>
          </Button>
        </div>

        <h1 className={styles.heading}>
          {isPrivate ? (
            <span className={styles.roomLock} title="Private room">
              <span aria-hidden="true">🔒</span> <span>{currentRoomLabel}</span>
              <span className={styles.srOnly}> (private)</span>
            </span>
          ) : (
            <>
              <span className={styles.roomHash} aria-hidden="true">
                #
              </span>
              <span>{currentRoomLabel}</span>
            </>
          )}
        </h1>

        <div className={styles.topBarSide} data-align="end">
          {/* `data-state` lets the narrow layout drop the badge while chat is
              simply working — a phone header has no room for a label that says
              nothing is wrong. Connecting/unavailable always show. */}
          <span className={styles.statusSlot} data-state={status}>
            <StatusBadge status={badgeStatus} busy={status === "connecting"}>
              {badgeLabel}
            </StatusBadge>
          </span>
          {onOpenRoom ? (
            <Button
              variant="ghost"
              size="sm"
              className={styles.roomButton}
              onClick={() => setRoomDialogOpen(true)}
              aria-haspopup="dialog"
            >
              Share
            </Button>
          ) : null}
          {toolbar ? <span className={styles.toolbarSlot}>{toolbar}</span> : null}
        </div>
      </header>

      {/* `data-rail` drives the collapse in CSS: a column beside the
          conversation at ≥ 64rem, a drawer over it below that. Keeping it in
          CSS means no viewport-width state in React and no flash of the wrong
          layout on first paint. */}
      <div className={styles.body} data-rail={railOpen ? "open" : "closed"}>
        <div className={styles.railColumn} id={railId}>
          <RoomRail
            rooms={rooms}
            loading={roomsLoading}
            currentRoomId={roomId}
            onSelect={handleRoomSelect}
          />
        </div>

        <div className={styles.conversation}>
          {locked ? (
            <LockGate roomLabel={currentRoomLabel} error={unlockError} onUnlock={handleUnlock} />
          ) : (
            <>
              {status === "unavailable" ? (
                <div className={styles.unavailableSlot}>
                  <Toast variant="warning">
                    Chat is unavailable right now — nothing else is affected, and your messages will
                    send again once it's back.
                  </Toast>
                </div>
              ) : null}

              <div
                ref={listRef}
                className={styles.messageList}
                role="log"
                aria-live="polite"
                aria-label="Chat messages"
                onScroll={handleListScroll}
              >
                {/* Earlier-history affordance (CHAT-021): a quiet marker at the top
                while an older page loads, so scroll-up paging is legible without
                a spinner that outlives its request. */}
                {loadingOlder ? (
                  <p className={styles.loadingOlder} aria-live="polite">
                    Loading earlier messages…
                  </p>
                ) : null}

                {status === "connecting" && messages.length === 0 ? (
                  <ul className={styles.skeletonList} aria-hidden="true">
                    <li className={styles.skeletonBubble} />
                    <li className={styles.skeletonBubble} />
                    <li className={styles.skeletonBubble} />
                  </ul>
                ) : null}

                {status === "live" && visibleMessages.length === 0 ? (
                  <p className={styles.empty}>No messages yet — say hello.</p>
                ) : null}

                {visibleMessages.length > 0 ? (
                  <ul className={styles.bubbles}>
                    {visibleMessages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        isOwn={myToken !== null && message.sender.token === myToken}
                        onMute={() => muteToken(message.sender.token)}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>

              {/* One row, and nothing else by default: every line of standing
                  composer chrome is a line the conversation doesn't get. The
                  label is spoken, not printed; the counter appears only near
                  the limit; the error row exists only when there is an error. */}
              <form className={styles.composer} onSubmit={handleSubmit}>
                <div className={styles.composerRow}>
                  {/* Who you're posting as, and the way to change it — the
                      "playing as …" line, compressed into the row it used to
                      sit above. */}
                  <button
                    type="button"
                    className={styles.nameEdit}
                    onClick={() => setEditingName(true)}
                    aria-label={`Change your name — currently ${name}`}
                  >
                    <span aria-hidden="true">{name}</span>
                  </button>
                  <label className={styles.srOnly} htmlFor="chat-input">
                    Message — playing as {name}
                  </label>
                  <div className={styles.inputWrap}>
                    <textarea
                      id="chat-input"
                      ref={inputRef}
                      className={styles.textarea}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
                      onKeyDown={handleKeyDown}
                      maxLength={MAX_LENGTH}
                      placeholder={
                        status === "unavailable" ? "Chat is unavailable" : "Type a message…"
                      }
                      disabled={status !== "live"}
                      rows={1}
                      aria-describedby={showCounter ? `${counterId} ${errorId}` : errorId}
                    />
                    {/* Only once the limit is close enough to matter, and laid
                        over the field's corner so it costs no height. */}
                    {showCounter ? (
                      <span id={counterId} className={styles.counter}>
                        {remaining}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    loading={sending}
                    loadingLabel="Sending"
                    disabled={status !== "live" || draft.trim().length === 0}
                  >
                    Send
                  </Button>
                </div>
                {/* Kept mounted so the live region is registered before an
                    error lands in it; it collapses to nothing while empty. */}
                <div
                  id={errorId}
                  role="alert"
                  aria-live="assertive"
                  className={styles.sendErrorSlot}
                >
                  {sendError ? <span className={styles.sendError}>{sendError}</span> : null}
                </div>
              </form>
            </>
          )}
        </div>
      </div>

      <UsernamePrompt
        isOpen={editingName}
        initialValue={name}
        title="Change your name"
        intro="This is how others in chat will see you."
        onSubmit={handleNameSubmit}
        onCancel={() => setEditingName(false)}
      />

      {onOpenRoom ? (
        <RoomSwitchPrompt
          isOpen={roomDialogOpen}
          roomId={roomId}
          isPrivate={isPrivate}
          onClose={() => setRoomDialogOpen(false)}
          onOpenRoom={(next, opts) => {
            setRoomDialogOpen(false);
            onOpenRoom(next, opts);
          }}
        />
      ) : null}
    </div>
  );
}

interface LockGateProps {
  roomLabel: string;
  /** Set when the server rejected the code, so the gate can say so in place. */
  error?: string | undefined;
  onUnlock: (secret: string) => void;
}

/**
 * The secret gate shown for a private room until its code is entered
 * (CHAT-020). It replaces the message list + composer — nothing connects behind
 * it — so a passer-by with the link but not the code sees a plain prompt, never
 * the conversation.
 *
 * Since the room registry landed (CHAT-022) the server checks the code, so a
 * wrong one is a real, recoverable error shown here with the field retained.
 * Before that, a mismatch silently derived a different empty channel and the
 * gate could only ever "succeed".
 */
function LockGate({ roomLabel, error, onUnlock }: LockGateProps): React.JSX.Element {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onUnlock(value);
  };

  return (
    <div className={styles.lockGate}>
      <form className={styles.lockCard} onSubmit={handleSubmit}>
        <div className={styles.lockIcon} aria-hidden="true">
          🔒
        </div>
        <h2 className={styles.lockTitle}>“{roomLabel}” is private</h2>
        <p className={styles.roomHint}>
          Enter the room secret to join. Whoever invited you shares it separately from the link.
        </p>
        <div className={styles.roomRow}>
          <input
            ref={inputRef}
            type="password"
            className={styles.roomInput}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Room secret"
            aria-label="Room secret"
            autoComplete="off"
            maxLength={128}
          />
          <Button type="submit" variant="primary" size="md" disabled={value.trim().length === 0}>
            Join
          </Button>
        </div>
        <div role="alert" aria-live="assertive" className={styles.roomErrorSlot}>
          {error ? <span className={styles.roomError}>{error}</span> : null}
        </div>
      </form>
    </div>
  );
}

interface RoomSwitchPromptProps {
  isOpen: boolean;
  roomId: string;
  isPrivate: boolean;
  onClose: () => void;
  onOpenRoom: (roomId: string, opts?: OpenRoomOptions) => void;
}

/**
 * Create-or-join-a-room dialog (CHAT-019, private rooms CHAT-020). Rooms are
 * just slugs, so this is pure client: type a name (and, optionally, a secret to
 * make it private), it slugifies to a valid id and navigates there; the current
 * room's link is shareable via the standard share ladder (which degrades to a
 * selectable field, never a dead end). Nothing here talks to the network, so it
 * works whether or not chat itself is reachable.
 *
 * A private join persists the secret for the tab *before* navigating, so the
 * target room mounts already unlocked (no gate re-prompt). The secret never
 * rides in the URL — only a `?p=1` hint that tells an opener to prompt for it.
 */
function RoomSwitchPrompt({
  isOpen,
  roomId,
  isPrivate,
  onClose,
  onOpenRoom,
}: RoomSwitchPromptProps): React.JSX.Element {
  const shareUrl =
    typeof window !== "undefined"
      ? roomShareUrl(roomId, window.location.origin, { private: isPrivate })
      : "";

  return (
    <Modal isOpen={isOpen} title="Share room" onClose={onClose}>
      <div className={styles.roomDialog}>
        <section className={styles.roomSection}>
          <h3 className={styles.roomSectionTitle}>Share this room</h3>
          <p className={styles.roomHint}>
            {isPrivate ? (
              <>
                The link opens the lock screen for <strong>{roomLabel(roomId)}</strong> — share the
                secret separately, or no one gets in.
              </>
            ) : (
              <>
                Anyone with the link joins <strong>{roomLabel(roomId)}</strong>.
              </>
            )}
          </p>
          {shareUrl ? (
            <ShareAction url={shareUrl} title="Join my chat room" shareLabel="Share room" />
          ) : null}
        </section>

        {roomId !== DEFAULT_CHAT_ROOM_ID ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={styles.roomLobbyLink}
            onClick={() => onOpenRoom(DEFAULT_CHAT_ROOM_ID)}
          >
            Back to Global
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  onMute: () => void;
}

/**
 * A message. Yours stack right and carry no name — in a two-sided conversation
 * your own name is the one thing you already know, and printing it on every
 * bubble spends a line to say nothing. Theirs stack left under the sender's
 * name, the way every messaging app does it.
 *
 * Nothing here is signalled by colour alone (UX_PRINCIPLES §4): side and the
 * presence of a name carry own/other visually, and a screen-reader-only "You"
 * carries it for assistive tech, which cannot perceive alignment at all.
 */
function MessageBubble({ message, isOwn, onMute }: MessageBubbleProps): React.JSX.Element {
  const pending = message.delivery === "pending";
  const time = new Date(message.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const ownClass = pending ? `${styles.own} ${styles.pending}` : styles.own;
  return (
    <li className={isOwn ? `${styles.bubble} ${ownClass}` : `${styles.bubble} ${styles.other}`}>
      {isOwn ? (
        <span className={styles.srOnly}>You</span>
      ) : (
        <span className={styles.bubbleName}>{message.sender.name}</span>
      )}
      <p className={styles.bubbleText}>{message.text}</p>
      <div className={styles.bubbleMeta}>
        {/* Own bubbles show a delivery marker in place of a wall-clock time
            until they're confirmed — the send felt instant, so "Sending…"
            reassures without implying it's already delivered. */}
        <span className={styles.bubbleTime}>{isOwn && pending ? "Sending…" : time}</span>
        {!isOwn ? (
          <button
            type="button"
            className={styles.muteButton}
            onClick={onMute}
            aria-label={`Mute ${message.sender.name}`}
          >
            Mute
          </button>
        ) : null}
      </div>
    </li>
  );
}

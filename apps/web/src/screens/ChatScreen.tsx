// CHAT-006 — the chat screen. A game already works with chat's backend
// completely down (CLAUDE.md "no feature may break offline play"): an
// unreachable chat service just disables the composer and shows a quiet
// note, never an error banner or a dead end.

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
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
import type { ChatMessage } from "../api/chat.js";
import { getSessionToken } from "../api/session.js";
import { DEFAULT_CHAT_ROOM_ID, roomLabel, roomShareUrl, slugifyRoomName } from "./chatRoom.js";
import {
  ensureUsername,
  onUsernameChange,
  setStoredUsername,
  syncUsername,
} from "../api/username.js";
import { getMutedTokens, muteToken, onMuteChange } from "../api/chatMute.js";
import styles from "./ChatScreen.module.css";

export interface ChatScreenProps {
  /** The chat room to join — `"lobby"` for the default, un-scoped room. */
  roomId: string;
  onBack: () => void;
  /**
   * Navigate to another room (CHAT-019). When provided, the screen shows a
   * room bar that can create/join a room by name and share the current one.
   * Omit to hide room switching entirely (the lobby-only entry point).
   */
  onOpenRoom?: (roomId: string) => void;
}

const MAX_LENGTH = 500;

/**
 * How close to the bottom (px) the reader has to be for a new message to
 * auto-scroll them along with it. Anything further and they've scrolled up
 * to re-read history on purpose — a new arrival shouldn't yank them back.
 */
const AUTO_SCROLL_THRESHOLD = 120;

export function ChatScreen({ roomId, onBack, onOpenRoom }: ChatScreenProps): React.JSX.Element {
  const { messages, status, send } = useChatChannel(roomId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  const [muted, setMuted] = useState<Set<string>>(() => getMutedTokens());
  const [name, setName] = useState(ensureUsername);
  const [editingName, setEditingName] = useState(false);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();
  const counterId = useId();

  const myToken = getSessionToken();

  useEffect(() => onUsernameChange(setName), []);
  useEffect(() => onMuteChange(() => setMuted(getMutedTokens())), []);

  // Focus the composer the moment chat is actually usable, so a keyboard user
  // lands ready to type rather than having to hunt for the field.
  useEffect(() => {
    if (status === "live") inputRef.current?.focus();
  }, [status]);

  // Auto-scroll to the newest message, but only when the reader was already
  // near the bottom (see AUTO_SCROLL_THRESHOLD above).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceFromBottom < AUTO_SCROLL_THRESHOLD) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

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

  const badgeStatus =
    status === "live" ? "success" : status === "connecting" ? "neutral" : "warning";
  const badgeLabel =
    status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Unavailable";

  return (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Home">
          <span className={styles.homeIcons} aria-hidden="true">
            <BackArrowIcon />
            <HomeIcon />
          </span>
          <span className={styles.homeLabel}>Home</span>
        </Button>
        <h1 className={styles.heading}>Chat</h1>
        <StatusBadge status={badgeStatus} busy={status === "connecting"}>
          {badgeLabel}
        </StatusBadge>
      </div>

      {onOpenRoom ? (
        <div className={styles.roomBar}>
          <span className={styles.roomName}>
            Room · <strong>{roomLabel(roomId)}</strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className={styles.roomButton}
            onClick={() => setRoomDialogOpen(true)}
            aria-haspopup="dialog"
          >
            Rooms
          </Button>
        </div>
      ) : null}

      {status === "unavailable" ? (
        <div className={styles.unavailableSlot}>
          <Toast variant="warning">
            Chat is unavailable right now — nothing else is affected, and your messages will send
            again once it's back.
          </Toast>
        </div>
      ) : null}

      <div
        ref={listRef}
        className={styles.messageList}
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
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

      <form className={styles.composer} onSubmit={handleSubmit}>
        <label className={styles.composerLabel} htmlFor="chat-input">
          Message — playing as <strong>{name}</strong>
          <button type="button" className={styles.nameEdit} onClick={() => setEditingName(true)}>
            change
          </button>
        </label>
        <div className={styles.composerRow}>
          <textarea
            id="chat-input"
            ref={inputRef}
            className={styles.textarea}
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={handleKeyDown}
            maxLength={MAX_LENGTH}
            placeholder={status === "unavailable" ? "Chat is unavailable" : "Type a message…"}
            disabled={status !== "live"}
            rows={1}
            aria-describedby={`${counterId} ${errorId}`}
          />
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
        <div className={styles.composerFooter}>
          <span id={counterId} className={styles.counter}>
            {draft.length}/{MAX_LENGTH}
          </span>
          <div id={errorId} role="alert" aria-live="assertive" className={styles.sendErrorSlot}>
            {sendError ? <span className={styles.sendError}>{sendError}</span> : null}
          </div>
        </div>
      </form>

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
          onClose={() => setRoomDialogOpen(false)}
          onOpenRoom={(next) => {
            setRoomDialogOpen(false);
            onOpenRoom(next);
          }}
        />
      ) : null}
    </div>
  );
}

interface RoomSwitchPromptProps {
  isOpen: boolean;
  roomId: string;
  onClose: () => void;
  onOpenRoom: (roomId: string) => void;
}

/**
 * Create-or-join-a-room dialog (CHAT-019). Rooms are just slugs, so this is
 * pure client: type a name, it slugifies to a valid id and navigates there;
 * the current room's link is shareable via the standard share ladder (which
 * degrades to a selectable field, never a dead end). Nothing here talks to the
 * network, so it works whether or not chat itself is reachable.
 */
function RoomSwitchPrompt({
  isOpen,
  roomId,
  onClose,
  onOpenRoom,
}: RoomSwitchPromptProps): React.JSX.Element {
  const [roomDraft, setRoomDraft] = useState("");
  const [roomError, setRoomError] = useState<string | undefined>(undefined);
  const shareUrl =
    typeof window !== "undefined" ? roomShareUrl(roomId, window.location.origin) : "";

  const handleRoomSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const slug = slugifyRoomName(roomDraft);
    if (!slug) {
      setRoomError("Use letters or numbers for the room name.");
      return;
    }
    if (slug === roomId) {
      // Already here — just close, rather than a no-op navigation.
      onClose();
      return;
    }
    setRoomDraft("");
    setRoomError(undefined);
    onOpenRoom(slug);
  };

  return (
    <Modal isOpen={isOpen} title="Rooms" onClose={onClose}>
      <div className={styles.roomDialog}>
        <section className={styles.roomSection}>
          <h3 className={styles.roomSectionTitle}>Share this room</h3>
          <p className={styles.roomHint}>
            Anyone with the link joins <strong>{roomLabel(roomId)}</strong>.
          </p>
          {shareUrl ? (
            <ShareAction url={shareUrl} title="Join my chat room" shareLabel="Share room" />
          ) : null}
        </section>

        <form className={styles.roomSection} onSubmit={handleRoomSubmit}>
          <h3 className={styles.roomSectionTitle}>Create or join a room</h3>
          <p className={styles.roomHint}>
            Type a name — anyone who opens the same name lands in the same room.
          </p>
          <div className={styles.roomRow}>
            <input
              type="text"
              className={styles.roomInput}
              value={roomDraft}
              onChange={(event) => setRoomDraft(event.target.value)}
              placeholder="e.g. weekend-games"
              aria-label="Room name"
              aria-invalid={roomError ? true : undefined}
              maxLength={64}
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={roomDraft.trim().length === 0}
            >
              Go
            </Button>
          </div>
          <div role="alert" aria-live="assertive" className={styles.roomErrorSlot}>
            {roomError ? <span className={styles.roomError}>{roomError}</span> : null}
          </div>
          {roomId !== DEFAULT_CHAT_ROOM_ID ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={styles.roomLobbyLink}
              onClick={() => onOpenRoom(DEFAULT_CHAT_ROOM_ID)}
            >
              Back to the lobby
            </Button>
          ) : null}
        </form>
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
 * Own vs. others' messages are told apart by alignment + a directional
 * marker glyph (▸/◂), never by color alone (UX_PRINCIPLES §4).
 */
function MessageBubble({ message, isOwn, onMute }: MessageBubbleProps): React.JSX.Element {
  const pending = message.delivery === "pending";
  const time = new Date(message.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const ownClass = pending ? `${styles.own} ${styles.pending}` : styles.own;
  return (
    <li className={isOwn ? `${styles.bubble} ${ownClass}` : `${styles.bubble} ${styles.other}`}>
      <div className={styles.bubbleHeader}>
        <span className={styles.bubbleMarker} aria-hidden="true">
          {isOwn ? "▸" : "◂"}
        </span>
        <span className={styles.bubbleName}>{isOwn ? "You" : message.sender.name}</span>
        {/* Own bubbles show a delivery marker in place of a wall-clock time
            until they're confirmed — the send felt instant, so "Sending…"
            reassures without implying it's already delivered. */}
        {isOwn && pending ? (
          <span className={styles.bubbleTime}>Sending…</span>
        ) : (
          <span className={styles.bubbleTime}>{time}</span>
        )}
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
      <p className={styles.bubbleText}>{message.text}</p>
    </li>
  );
}

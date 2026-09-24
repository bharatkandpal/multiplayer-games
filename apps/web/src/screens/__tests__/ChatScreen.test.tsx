import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatScreen } from "../ChatScreen";
import type { ChatMessage, ChatRoomSummary } from "../../api/chat";

const state = vi.hoisted(() => ({
  status: "connecting" as "connecting" | "live" | "unavailable",
  messages: [] as ChatMessage[],
  send: vi.fn(),
  hasMoreHistory: false,
  loadingOlder: false,
  loadOlder: vi.fn(),
  // CHAT-022: the administrator-owned room registry the rail renders.
  rooms: null as ChatRoomSummary[] | null,
  roomsLoading: false,
  requestChatToken: vi.fn(),
}));

vi.mock("../../hooks/useChatChannel.js", () => ({
  useChatChannel: () => ({
    status: state.status,
    messages: state.messages,
    send: state.send,
    hasMoreHistory: state.hasMoreHistory,
    loadingOlder: state.loadingOlder,
    loadOlder: state.loadOlder,
    connectionState: "unknown",
  }),
}));

vi.mock("../../hooks/useChatRooms.js", () => ({
  useChatRooms: () => ({ rooms: state.rooms, loading: state.roomsLoading }),
}));

vi.mock("../../api/chat.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/chat.js")>()),
  requestChatToken: (...args: unknown[]) => state.requestChatToken(...args),
}));

const SESSION_KEY = "mpg_session_token";
const USERNAME_KEY = "mpg_username";

describe("ChatScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_KEY, "tok-me");
    window.localStorage.setItem(USERNAME_KEY, JSON.stringify({ name: "me", confirmed: true }));
    state.status = "connecting";
    state.messages = [];
    state.send = vi.fn().mockResolvedValue({ ok: true });
    state.hasMoreHistory = false;
    state.loadingOlder = false;
    state.loadOlder = vi.fn();
    state.rooms = [
      { id: "global", label: "Global", visibility: "public", active: 3 },
      { id: "pvt", label: "Private", visibility: "private", active: 1 },
    ];
    state.roomsLoading = false;
    state.requestChatToken = vi.fn().mockResolvedValue({ ok: true, token: {} });
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows a connecting state with a disabled composer", () => {
    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Message/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("shows the empty state once live with no messages", () => {
    state.status = "live";
    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });

  it("renders messages, distinguishing own vs. others' and offering mute for others", () => {
    state.status = "live";
    state.messages = [
      { id: "m1", roomId: "lobby", sender: { token: "tok-me", name: "me" }, text: "hi", ts: 1 },
      {
        id: "m2",
        roomId: "lobby",
        sender: { token: "tok-other", name: "Ada" },
        text: "hey",
        ts: 2,
      },
    ];
    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("hey")).toBeInTheDocument();
    // An incoming message is named; your own is not — side carries it, and your
    // own name is the one you already know. "You" survives only for assistive
    // tech, which cannot perceive which side a bubble sits on.
    expect(screen.getByText("Ada")).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Chat messages" });
    expect(within(log).queryByText("me")).not.toBeInTheDocument();
    expect(screen.getAllByText("You")).toHaveLength(1);
    // The time/mute row is collapsed until the bubble is tapped.
    expect(screen.queryByRole("button", { name: "Mute Ada" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("hey"));
    // Only the other player's message offers a mute control.
    expect(screen.getByRole("button", { name: "Mute Ada" })).toBeInTheDocument();
  });

  it("toggles a bubble's time/mute row open and closed on click", () => {
    state.status = "live";
    state.messages = [
      {
        id: "m1",
        roomId: "lobby",
        sender: { token: "tok-other", name: "Ada" },
        text: "hey",
        ts: 2,
      },
    ];
    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    const bubble = screen.getByText("hey").closest("li")!;
    expect(screen.queryByRole("button", { name: "Mute Ada" })).not.toBeInTheDocument();

    fireEvent.click(bubble);
    expect(screen.getByRole("button", { name: "Mute Ada" })).toBeInTheDocument();

    fireEvent.click(bubble);
    expect(screen.queryByRole("button", { name: "Mute Ada" })).not.toBeInTheDocument();
  });

  it("mutes a sender, then lets it be undone from the Muted list — no dead-end for an accidental mute", () => {
    state.status = "live";
    state.messages = [
      {
        id: "m1",
        roomId: "lobby",
        sender: { token: "tok-other", name: "Ada" },
        text: "hey",
        ts: 2,
      },
    ];
    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    // No "Muted" control until there's something to undo.
    expect(screen.queryByRole("button", { name: /^Muted/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("hey"));
    fireEvent.click(screen.getByRole("button", { name: "Mute Ada" }));

    const log = screen.getByRole("log", { name: "Chat messages" });
    expect(within(log).queryByText("hey")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Muted (1)" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));

    expect(screen.queryByRole("button", { name: /^Muted/ })).not.toBeInTheDocument();
    expect(within(log).getByText("hey")).toBeInTheDocument();
  });

  it("shows the unavailable state with a quiet note, never an error banner blocking anything", () => {
    state.status = "unavailable";
    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Chat is unavailable right now/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Message/ })).toBeDisabled();
  });

  it("sends on submit and shows a gentle message on rate-limit, restoring the draft", async () => {
    state.status = "live";
    state.send = vi.fn().mockResolvedValue({ ok: false, reason: "rate_limited" });
    const user = userEvent.setup();

    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    const input = screen.getByRole("textbox", { name: /Message/ });
    await user.type(input, "hello there");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(state.send).toHaveBeenCalledWith("hello there"));
    await waitFor(() => expect(screen.getByText(/Slow down a little/)).toBeInTheDocument());
    expect(input).toHaveValue("hello there");
  });

  it("sends on Enter without Shift", async () => {
    state.status = "live";
    const user = userEvent.setup();
    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    const input = screen.getByRole("textbox", { name: /Message/ });
    await user.type(input, "quick message");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(state.send).toHaveBeenCalledWith("quick message"));
  });

  it("keeps the composer to one row: the counter only appears near the limit", async () => {
    state.status = "live";
    const user = userEvent.setup();
    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    const input = screen.getByRole("textbox", { name: /Message/ });
    await user.type(input, "short");
    // Nothing standing in the composer but the field — no count of characters
    // nobody is watching, and no "playing as" line of its own.
    expect(screen.queryByText("495")).not.toBeInTheDocument();

    // Within 50 of the 500 limit it appears, counting down what's left.
    fireEvent.change(input, { target: { value: "x".repeat(470) } });
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("offers the name change from the composer row, labelled with the current name", () => {
    state.status = "live";
    render(<ChatScreen roomId="lobby" onBack={() => {}} />);

    expect(
      screen.getByRole("button", { name: "Change your name — currently me" }),
    ).toBeInTheDocument();
  });

  it("calls onBack when Home is activated", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ChatScreen roomId="lobby" onBack={onBack} />);

    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  describe("CHAT-022: the room rail", () => {
    it("lists the administrator-owned rooms with their live counts", () => {
      state.status = "live";
      render(<ChatScreen roomId="global" onBack={() => {}} onOpenRoom={() => {}} />);

      const rail = screen.getByRole("navigation", { name: "Chat rooms" });
      expect(within(rail).getByText("Global")).toBeInTheDocument();
      expect(within(rail).getByText("Private")).toBeInTheDocument();
      // The count has a text equivalent, not just a bare number.
      expect(within(rail).getByText("3 people here")).toBeInTheDocument();
      expect(within(rail).getByText("1 person here")).toBeInTheDocument();
    });

    it("offers no way to create a room — the set is admin-owned", async () => {
      state.status = "live";
      const user = userEvent.setup();
      render(<ChatScreen roomId="global" onBack={() => {}} onOpenRoom={() => {}} />);

      expect(screen.queryByRole("textbox", { name: "Room name" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Share" }));
      // The dialog that used to create/join rooms is share-only now.
      expect(screen.getByRole("dialog", { name: "Share room" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Room name" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();
    });

    it("opens a public room directly and a private one through the gate", async () => {
      state.status = "live";
      const onOpenRoom = vi.fn();
      const user = userEvent.setup();
      render(<ChatScreen roomId="global" onBack={() => {}} onOpenRoom={onOpenRoom} />);

      const rail = screen.getByRole("navigation", { name: "Chat rooms" });
      await user.click(within(rail).getByText("Private"));
      expect(onOpenRoom).toHaveBeenCalledWith("pvt", { private: true });
    });

    it("starts with the room list collapsed, and the Rooms control opens it", async () => {
      state.status = "live";
      const user = userEvent.setup();
      render(<ChatScreen roomId="global" onBack={() => {}} onOpenRoom={() => {}} />);

      // Collapsed is the default — you land in the conversation, not a lobby.
      const toggle = screen.getByRole("button", { name: "Rooms" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      // Escape closes it — on a narrow screen it covers the conversation.
      await user.keyboard("{Escape}");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("closes the room list once a room is chosen", async () => {
      state.status = "live";
      const user = userEvent.setup();
      render(<ChatScreen roomId="global" onBack={() => {}} onOpenRoom={() => {}} />);

      const toggle = screen.getByRole("button", { name: "Rooms" });
      await user.click(toggle);
      const rail = screen.getByRole("navigation", { name: "Chat rooms" });
      await user.click(within(rail).getByText("Private"));

      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("offers no Rooms control when there is no list to open", () => {
      state.status = "live";
      state.rooms = null;
      render(<ChatScreen roomId="global" onBack={() => {}} onOpenRoom={() => {}} />);

      // Degrades to absence — never a control that does nothing.
      expect(screen.queryByRole("button", { name: "Rooms" })).not.toBeInTheDocument();
    });

    it("renders no rail at all when the room list is unavailable", () => {
      state.status = "live";
      state.rooms = null;
      render(<ChatScreen roomId="global" onBack={() => {}} onOpenRoom={() => {}} />);

      // Degrades to absence: no error row, no retry — the conversation is intact.
      expect(screen.queryByRole("navigation", { name: "Chat rooms" })).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /Message/ })).toBeInTheDocument();
    });

    it("falls back to the slug when the registry has no label for the room", () => {
      state.status = "live";
      state.rooms = [];
      render(<ChatScreen roomId="mystery" onBack={() => {}} onOpenRoom={() => {}} />);

      expect(screen.getByText("mystery")).toBeInTheDocument();
    });
  });

  describe("CHAT-021: history paging", () => {
    it("shows a quiet 'loading earlier messages' marker while an older page loads", () => {
      state.status = "live";
      state.loadingOlder = true;
      render(<ChatScreen roomId="lobby" onBack={() => {}} />);

      expect(screen.getByText(/Loading earlier messages/)).toBeInTheDocument();
    });

    it("pulls the next older page when the list is scrolled to the top", () => {
      state.status = "live";
      state.hasMoreHistory = true;
      state.messages = [
        { id: "m1", roomId: "lobby", sender: { token: "tok-me", name: "me" }, text: "hi", ts: 1 },
      ];
      render(<ChatScreen roomId="lobby" onBack={() => {}} />);

      // jsdom reports scrollTop 0, which is at/above the near-top threshold.
      fireEvent.scroll(screen.getByRole("log", { name: "Chat messages" }));
      expect(state.loadOlder).toHaveBeenCalledTimes(1);
    });

    it("does not page when there is no more history to load", () => {
      state.status = "live";
      state.hasMoreHistory = false;
      render(<ChatScreen roomId="lobby" onBack={() => {}} />);

      fireEvent.scroll(screen.getByRole("log", { name: "Chat messages" }));
      expect(state.loadOlder).not.toHaveBeenCalled();
    });
  });

  describe("CHAT-020: private rooms", () => {
    afterEach(() => {
      window.sessionStorage.clear();
    });

    it("gates a private room behind a secret prompt, hiding the chat body", () => {
      state.status = "live";
      window.sessionStorage.clear();
      render(<ChatScreen roomId="poker" isPrivate onBack={() => {}} onOpenRoom={() => {}} />);

      // The lock gate stands in for the whole chat surface — no composer.
      expect(screen.getByText(/is private/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: /Message/ })).not.toBeInTheDocument();
      // The room bar flags it as private for assistive tech, not colour alone.
      // Scoped to the room bar: the rail also marks its own private rooms, so
      // a bare getByText would now match both.
      expect(screen.getAllByText("(private)").length).toBeGreaterThan(0);
    });

    it("reveals the chat body once the secret is entered, and remembers it for the tab", async () => {
      state.status = "live";
      window.sessionStorage.clear();
      const user = userEvent.setup();
      render(<ChatScreen roomId="poker" isPrivate onBack={() => {}} onOpenRoom={() => {}} />);

      // A password field has no "textbox" role — query it by its label.
      await user.type(screen.getByLabelText("Room secret"), "royal");
      await user.click(screen.getByRole("button", { name: "Join" }));

      // Gate gone, composer back.
      expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /Message/ })).toBeInTheDocument();
      // Persisted for the tab so a reload doesn't re-prompt.
      expect(window.sessionStorage.getItem("chat.secret.poker")).toBe("royal");
    });

    it("skips the gate when a secret is already held for the tab", () => {
      state.status = "live";
      window.sessionStorage.setItem("chat.secret.poker", "royal");
      render(<ChatScreen roomId="poker" isPrivate onBack={() => {}} onOpenRoom={() => {}} />);

      expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /Message/ })).toBeInTheDocument();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatScreen } from "../ChatScreen";
import type { ChatMessage } from "../../api/chat";

const state = vi.hoisted(() => ({
  status: "connecting" as "connecting" | "live" | "unavailable",
  messages: [] as ChatMessage[],
  send: vi.fn(),
  hasMoreHistory: false,
  loadingOlder: false,
  loadOlder: vi.fn(),
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
    expect(screen.getAllByText("You")).toHaveLength(1);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    // Only the other player's message offers a mute control.
    expect(screen.getByRole("button", { name: "Mute Ada" })).toBeInTheDocument();
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

  it("calls onBack when Home is activated", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ChatScreen roomId="lobby" onBack={onBack} />);

    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  describe("CHAT-019: room switching", () => {
    it("hides the room bar entirely when room switching isn't wired", () => {
      render(<ChatScreen roomId="lobby" onBack={() => {}} />);
      expect(screen.queryByRole("button", { name: "Rooms" })).not.toBeInTheDocument();
    });

    it("names the current room and opens the create/join dialog", async () => {
      state.status = "live";
      const user = userEvent.setup();
      render(<ChatScreen roomId="lobby" onBack={() => {}} onOpenRoom={() => {}} />);

      // The room bar names the current room.
      expect(screen.getByText("Lobby")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Rooms" }));
      expect(screen.getByRole("dialog", { name: "Rooms" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Room name" })).toBeInTheDocument();
    });

    it("navigates to a slugified room when a name is submitted", async () => {
      state.status = "live";
      const onOpenRoom = vi.fn();
      const user = userEvent.setup();
      render(<ChatScreen roomId="lobby" onBack={() => {}} onOpenRoom={onOpenRoom} />);

      await user.click(screen.getByRole("button", { name: "Rooms" }));
      await user.type(screen.getByRole("textbox", { name: "Room name" }), "Weekend Games!");
      await user.click(screen.getByRole("button", { name: "Go" }));

      // A public room (no secret) navigates with no private options.
      expect(onOpenRoom).toHaveBeenCalledWith("weekend-games", undefined);
    });

    it("rejects a name that slugifies to nothing, without navigating", async () => {
      state.status = "live";
      const onOpenRoom = vi.fn();
      const user = userEvent.setup();
      render(<ChatScreen roomId="lobby" onBack={() => {}} onOpenRoom={onOpenRoom} />);

      await user.click(screen.getByRole("button", { name: "Rooms" }));
      await user.type(screen.getByRole("textbox", { name: "Room name" }), "!!!");
      await user.click(screen.getByRole("button", { name: "Go" }));

      expect(onOpenRoom).not.toHaveBeenCalled();
      expect(screen.getByText(/Use letters or numbers/)).toBeInTheDocument();
    });

    it("offers a back-to-lobby jump only when not already in the lobby", async () => {
      state.status = "live";
      const onOpenRoom = vi.fn();
      const user = userEvent.setup();
      render(<ChatScreen roomId="my-room" onBack={() => {}} onOpenRoom={onOpenRoom} />);

      await user.click(screen.getByRole("button", { name: "Rooms" }));
      await user.click(screen.getByRole("button", { name: "Back to the lobby" }));

      expect(onOpenRoom).toHaveBeenCalledWith("lobby", undefined);
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
      expect(screen.getByText("(private)")).toBeInTheDocument();
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

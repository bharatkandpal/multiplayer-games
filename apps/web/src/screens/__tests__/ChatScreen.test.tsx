import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatScreen } from "../ChatScreen";
import type { ChatMessage } from "../../api/chat";

const state = vi.hoisted(() => ({
  status: "connecting" as "connecting" | "live" | "unavailable",
  messages: [] as ChatMessage[],
  send: vi.fn(),
}));

vi.mock("../../hooks/useChatChannel.js", () => ({
  useChatChannel: () => ({
    status: state.status,
    messages: state.messages,
    send: state.send,
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
      { id: "m2", roomId: "lobby", sender: { token: "tok-other", name: "Ada" }, text: "hey", ts: 2 },
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
    await waitFor(() =>
      expect(screen.getByText(/Slow down a little/)).toBeInTheDocument(),
    );
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
});

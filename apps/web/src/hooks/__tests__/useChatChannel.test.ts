import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (arg: unknown) => void;

const state = vi.hoisted(() => {
  return {
    instances: [] as FakeRealtimeInstance[],
  };
});

interface FakeRealtimeInstance {
  channel: {
    handlers: Map<string, Handler>;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    emitMessage: (data: unknown) => void;
  };
  connection: {
    handlers: Set<Handler>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    emitChange: (current: string) => void;
  };
  close: ReturnType<typeof vi.fn>;
  authCallback: (params: unknown, callback: (error: unknown, token: unknown) => void) => void;
}

vi.mock("ably", () => {
  class FakeChannel {
    handlers = new Map<string, Handler>();
    subscribe = vi.fn((event: string, listener: Handler) => {
      this.handlers.set(event, listener);
      return Promise.resolve(null);
    });
    unsubscribe = vi.fn();
    emitMessage(data: unknown): void {
      // Real Ably hands the listener an `InboundMessage` (`.data` holds the
      // payload) — mirror that shape rather than the raw payload.
      this.handlers.get("message")?.({ data });
    }
  }

  class FakeConnection {
    handlers = new Set<Handler>();
    on = vi.fn((listener: Handler) => {
      this.handlers.add(listener);
    });
    off = vi.fn((listener: Handler) => {
      this.handlers.delete(listener);
    });
    emitChange(current: string): void {
      this.handlers.forEach((listener) => listener({ current }));
    }
  }

  class FakeRealtime {
    channel = new FakeChannel();
    connection = new FakeConnection();
    close = vi.fn();
    authCallback: FakeRealtimeInstance["authCallback"];
    channels = { get: vi.fn(() => this.channel) };

    constructor(opts: { authCallback: FakeRealtimeInstance["authCallback"] }) {
      this.authCallback = opts.authCallback;
      state.instances.push(this as unknown as FakeRealtimeInstance);
    }
  }

  return { Realtime: FakeRealtime };
});

vi.mock("../../api/chat.js", () => ({
  fetchChatToken: vi.fn(),
  fetchChatHistory: vi.fn(),
  sendChatMessage: vi.fn(),
}));

vi.mock("../../api/username.js", () => ({
  getStoredUsername: vi.fn(() => "tester"),
}));

/**
 * The hook now learns the channel name from an initial token fetch *before*
 * constructing the Ably client (a private room's channel is secret-derived, so
 * it can't be reconstructed client-side), so the fake Realtime instance appears
 * a microtask after render rather than synchronously — wait for it.
 */
async function firstInstance(): Promise<FakeRealtimeInstance> {
  await waitFor(() => expect(state.instances.length).toBeGreaterThan(0));
  const instance = state.instances[0];
  if (!instance) throw new Error("no fake Realtime instance created");
  return instance;
}

describe("useChatChannel", () => {
  beforeEach(async () => {
    state.instances.length = 0;
    vi.resetAllMocks();
    // History is an enhancement: default it to "nothing / unavailable" so every
    // existing test behaves as before, and the history-specific tests opt in.
    const { fetchChatHistory } = await import("../../api/chat.js");
    vi.mocked(fetchChatHistory).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts connecting, then goes live and appends de-duped, ts-ordered messages", async () => {
    const { fetchChatToken } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue({
      tokenRequest: { token: "tok" },
      channelName: "chat:lobby",
      clientId: "client-1",
    });

    const { useChatChannel } = await import("../useChatChannel.js");
    const { result } = renderHook(() => useChatChannel("lobby"));

    expect(result.current.status).toBe("connecting");

    const instance = await firstInstance();

    act(() => instance.connection.emitChange("connected"));
    await waitFor(() => expect(result.current.status).toBe("live"));

    act(() => {
      instance.channel.emitMessage({
        id: "m2",
        roomId: "lobby",
        sender: { token: "tok-a", name: "Ada" },
        text: "second",
        ts: 200,
      });
      instance.channel.emitMessage({
        id: "m1",
        roomId: "lobby",
        sender: { token: "tok-b", name: "Bo" },
        text: "first",
        ts: 100,
      });
      // A duplicate id must not append a second time.
      instance.channel.emitMessage({
        id: "m1",
        roomId: "lobby",
        sender: { token: "tok-b", name: "Bo" },
        text: "first",
        ts: 100,
      });
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("degrades to unavailable when the token endpoint is down, without throwing", async () => {
    const { fetchChatToken } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue(null);

    const { useChatChannel } = await import("../useChatChannel.js");
    const { result } = renderHook(() => useChatChannel("lobby"));

    // The initial token fetch is what learns the channel name; when it fails we
    // never even construct an Ably client — we degrade straight to absence, so
    // there is no connection quietly retrying behind the scenes.
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(state.instances.length).toBe(0);
  });

  it("send() posts through the REST endpoint and reports rate-limit/unavailable reasons", async () => {
    const { fetchChatToken, sendChatMessage } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue({
      tokenRequest: {},
      channelName: "chat:lobby",
      clientId: "c1",
    });
    vi.mocked(sendChatMessage).mockResolvedValueOnce({ ok: true, id: "m1", ts: 1 });
    vi.mocked(sendChatMessage).mockResolvedValueOnce({ ok: false, reason: "rate_limited" });

    const { useChatChannel } = await import("../useChatChannel.js");
    const { result } = renderHook(() => useChatChannel("lobby"));

    let first: unknown;
    await act(async () => {
      first = await result.current.send("hello");
    });
    expect(first).toEqual({ ok: true });

    let second: unknown;
    await act(async () => {
      second = await result.current.send("again");
    });
    expect(second).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("optimistically shows the sender's own message instantly, then reconciles it on send success", async () => {
    const { fetchChatToken, sendChatMessage } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue({
      tokenRequest: {},
      channelName: "chat:lobby",
      clientId: "c1",
    });
    let resolveSend: (value: { ok: true; id: string; ts: number }) => void = () => {};
    vi.mocked(sendChatMessage).mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );

    const { useChatChannel } = await import("../useChatChannel.js");
    const { result } = renderHook(() => useChatChannel("lobby"));

    const instance = await firstInstance();
    act(() => instance.connection.emitChange("connected"));
    await waitFor(() => expect(result.current.status).toBe("live"));

    // The bubble appears the instant send() is called, before the POST resolves.
    let sendPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("hi");
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.text).toBe("hi");
    expect(result.current.messages[0]?.delivery).toBe("pending");

    // On a successful POST the pending marker clears (no stranded "sending…").
    await act(async () => {
      resolveSend({ ok: true, id: "ignored", ts: 1 });
      await sendPromise;
    });
    expect(result.current.messages[0]?.delivery).toBeUndefined();

    // The server broadcast (same client-minted id) reconciles in place — the
    // authoritative copy replaces the optimistic one rather than duplicating it.
    const ownId = result.current.messages[0]!.id;
    act(() =>
      instance.channel.emitMessage({
        id: ownId,
        roomId: "lobby",
        sender: { token: "tok-me", name: "tester" },
        text: "hi (from server)",
        ts: 9,
      }),
    );
    await waitFor(() => expect(result.current.messages[0]?.text).toBe("hi (from server)"));
    expect(result.current.messages).toHaveLength(1);
  });

  it("removes the optimistic bubble when the send fails, so the draft can be restored", async () => {
    const { fetchChatToken, sendChatMessage } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue({
      tokenRequest: {},
      channelName: "chat:lobby",
      clientId: "c1",
    });
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: false, reason: "unavailable" });

    const { useChatChannel } = await import("../useChatChannel.js");
    const { result } = renderHook(() => useChatChannel("lobby"));

    const instance = await firstInstance();
    act(() => instance.connection.emitChange("connected"));
    await waitFor(() => expect(result.current.status).toBe("live"));

    let sendResult: unknown;
    await act(async () => {
      sendResult = await result.current.send("hi");
    });
    expect(sendResult).toEqual({ ok: false, reason: "unavailable" });
    expect(result.current.messages).toHaveLength(0);
  });

  it("seeds recent history on mount and merges it with live messages, ts-ordered (CHAT-021)", async () => {
    const { fetchChatToken, fetchChatHistory } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue({
      tokenRequest: {},
      channelName: "chat:lobby",
      clientId: "c1",
    });
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { id: "h1", roomId: "lobby", sender: { token: "t", name: "A" }, text: "old-1", ts: 10 },
        { id: "h2", roomId: "lobby", sender: { token: "t", name: "A" }, text: "old-2", ts: 20 },
      ],
      hasMore: true,
      cursor: { ts: 10, id: "h1" },
    });

    const { useChatChannel } = await import("../useChatChannel.js");
    const { result } = renderHook(() => useChatChannel("lobby"));

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages.map((m) => m.id)).toEqual(["h1", "h2"]);
    expect(result.current.hasMoreHistory).toBe(true);

    // A live message lands after the history and sorts to the bottom by ts.
    const instance = await firstInstance();
    act(() =>
      instance.channel.emitMessage({
        id: "live-1",
        roomId: "lobby",
        sender: { token: "t", name: "A" },
        text: "new",
        ts: 30,
      }),
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    expect(result.current.messages.map((m) => m.id)).toEqual(["h1", "h2", "live-1"]);
  });

  it("loadOlder pages the next older window and prepends it, updating hasMoreHistory", async () => {
    const { fetchChatToken, fetchChatHistory } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue({
      tokenRequest: {},
      channelName: "chat:lobby",
      clientId: "c1",
    });
    // First call (mount seed) → the newest message, with an older page waiting.
    vi.mocked(fetchChatHistory).mockResolvedValueOnce({
      messages: [
        { id: "h2", roomId: "lobby", sender: { token: "t", name: "A" }, text: "old-2", ts: 20 },
      ],
      hasMore: true,
      cursor: { ts: 20, id: "h2" },
    });
    // Second call (loadOlder) → the older page, nothing beyond it.
    vi.mocked(fetchChatHistory).mockResolvedValueOnce({
      messages: [
        { id: "h1", roomId: "lobby", sender: { token: "t", name: "A" }, text: "old-1", ts: 10 },
      ],
      hasMore: false,
      cursor: { ts: 10, id: "h1" },
    });

    const { useChatChannel } = await import("../useChatChannel.js");
    const { result } = renderHook(() => useChatChannel("lobby"));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.hasMoreHistory).toBe(true);

    await act(async () => {
      await result.current.loadOlder();
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(["h1", "h2"]);
    expect(result.current.hasMoreHistory).toBe(false);

    // The loadOlder fetch used the seed's cursor as its `before`.
    expect(vi.mocked(fetchChatHistory).mock.calls[1]?.[1]).toMatchObject({
      before: { ts: 20, id: "h2" },
    });
  });

  it("degrades to live-only when history is unavailable, without throwing", async () => {
    const { fetchChatToken, fetchChatHistory } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue({
      tokenRequest: {},
      channelName: "chat:lobby",
      clientId: "c1",
    });
    vi.mocked(fetchChatHistory).mockResolvedValue(null);

    const { useChatChannel } = await import("../useChatChannel.js");
    const { result } = renderHook(() => useChatChannel("lobby"));

    const instance = await firstInstance();
    act(() => instance.connection.emitChange("connected"));
    await waitFor(() => expect(result.current.status).toBe("live"));

    // No history seeded, no "load older" offered — but live chat is unaffected.
    expect(result.current.hasMoreHistory).toBe(false);
    act(() =>
      instance.channel.emitMessage({
        id: "live-1",
        roomId: "lobby",
        sender: { token: "t", name: "A" },
        text: "hi",
        ts: 1,
      }),
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
  });

  it("tears down the Ably connection on unmount", async () => {
    const { fetchChatToken } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue({
      tokenRequest: {},
      channelName: "chat:lobby",
      clientId: "c1",
    });

    const { useChatChannel } = await import("../useChatChannel.js");
    const { unmount } = renderHook(() => useChatChannel("lobby"));

    const instance = await firstInstance();

    unmount();

    expect(instance.close).toHaveBeenCalledTimes(1);
    expect(instance.channel.unsubscribe).toHaveBeenCalled();
  });
});

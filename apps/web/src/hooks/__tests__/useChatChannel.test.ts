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
  authCallback: (
    params: unknown,
    callback: (error: unknown, token: unknown) => void,
  ) => void;
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
  sendChatMessage: vi.fn(),
}));

vi.mock("../../api/username.js", () => ({
  getStoredUsername: vi.fn(() => "tester"),
}));

describe("useChatChannel", () => {
  beforeEach(() => {
    state.instances.length = 0;
    vi.resetAllMocks();
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

    const instance = state.instances[0];
    if (!instance) throw new Error("no fake Realtime instance created");

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

    const instance = state.instances[0];
    if (!instance) throw new Error("no fake Realtime instance created");

    let receivedError: unknown = "unset";
    instance.authCallback({}, (error) => {
      receivedError = error;
    });

    await waitFor(() => expect(receivedError).toBeTruthy());

    act(() => instance.connection.emitChange("failed"));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
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

  it("tears down the Ably connection on unmount", async () => {
    const { fetchChatToken } = await import("../../api/chat.js");
    vi.mocked(fetchChatToken).mockResolvedValue({
      tokenRequest: {},
      channelName: "chat:lobby",
      clientId: "c1",
    });

    const { useChatChannel } = await import("../useChatChannel.js");
    const { unmount } = renderHook(() => useChatChannel("lobby"));

    const instance = state.instances[0];
    if (!instance) throw new Error("no fake Realtime instance created");

    unmount();

    expect(instance.close).toHaveBeenCalledTimes(1);
    expect(instance.channel.unsubscribe).toHaveBeenCalled();
  });
});

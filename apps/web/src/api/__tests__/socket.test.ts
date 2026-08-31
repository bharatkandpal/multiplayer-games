import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ioMock = vi.fn();

vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

vi.mock("../session.js", () => ({
  getSessionToken: vi.fn(() => "cached-session-token"),
}));

interface FakeSocket {
  connected: boolean;
  active: boolean;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  io: { on: ReturnType<typeof vi.fn> };
}

function makeFakeSocket(): FakeSocket {
  return {
    connected: false,
    active: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    io: { on: vi.fn() },
  };
}

describe("socket client", () => {
  beforeEach(() => {
    vi.resetModules();
    ioMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not connect until connectSocket() is called (lazy)", async () => {
    const fake = makeFakeSocket();
    ioMock.mockReturnValue(fake);
    const { getSocket } = await import("../socket.js");

    getSocket();

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("returns the same singleton socket across calls", async () => {
    ioMock.mockReturnValue(makeFakeSocket());
    const { getSocket } = await import("../socket.js");

    const a = getSocket();
    const b = getSocket();

    expect(a).toBe(b);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it("attaches the session token via an auth callback", async () => {
    ioMock.mockReturnValue(makeFakeSocket());
    const { getSocket } = await import("../socket.js");
    const { getSessionToken } = await import("../session.js");

    getSocket();

    const [, options] = ioMock.mock.calls[0] as [
      string,
      { auth: (cb: (data: Record<string, unknown>) => void) => void },
    ];
    const received = await new Promise((resolve) => options.auth(resolve));
    expect(received).toEqual({ sessionToken: "cached-session-token" });
    expect(getSessionToken).toHaveBeenCalled();
  });

  it("connectSocket() connects an inactive socket and marks state connecting", async () => {
    const fake = makeFakeSocket();
    ioMock.mockReturnValue(fake);
    const { connectSocket, getConnectionState } = await import("../socket.js");

    connectSocket();

    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(getConnectionState()).toBe("connecting");
  });

  it("connectSocket() is a no-op when already active", async () => {
    const fake = makeFakeSocket();
    fake.active = true;
    ioMock.mockReturnValue(fake);
    const { connectSocket } = await import("../socket.js");

    connectSocket();

    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("tracks connection state via connect/disconnect handlers", async () => {
    const fake = makeFakeSocket();
    ioMock.mockReturnValue(fake);
    const { getSocket, onConnectionStateChange } = await import("../socket.js");

    getSocket();
    const connectHandler = fake.on.mock.calls.find(
      ([event]) => event === "connect",
    )?.[1] as () => void;
    const disconnectHandler = fake.on.mock.calls.find(
      ([event]) => event === "disconnect",
    )?.[1] as () => void;

    const states: string[] = [];
    onConnectionStateChange((state) => states.push(state));

    connectHandler();
    expect(states).toEqual(["connected"]);

    disconnectHandler();
    expect(states).toEqual(["connected", "disconnected"]);
  });

  it("disconnectSocket() disconnects the socket and resets state", async () => {
    const fake = makeFakeSocket();
    ioMock.mockReturnValue(fake);
    const { getSocket, connectSocket, disconnectSocket, getConnectionState } =
      await import("../socket.js");

    getSocket();
    connectSocket();
    disconnectSocket();

    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(getConnectionState()).toBe("disconnected");
  });
});

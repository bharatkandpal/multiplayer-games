import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

interface FakeSocket {
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  handlers: Map<string, Handler>;
}

function makeFakeSocket(): FakeSocket {
  const handlers = new Map<string, Handler>();
  const socket: FakeSocket = {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    off: vi.fn(),
    handlers,
  };
  return socket;
}

let fakeSocket: FakeSocket;

vi.mock("../../api/socket.js", () => ({
  getSocket: () => fakeSocket,
}));

describe("useRematch", () => {
  beforeEach(() => {
    fakeSocket = makeFakeSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proposeRematch emits rematch:propose with roomId/sessionToken", async () => {
    const { useRematch } = await import("../useRematch.js");
    const { result } = renderHook(() => useRematch("room-1", "tok-1", 1));

    act(() => result.current.proposeRematch());

    expect(fakeSocket.emit).toHaveBeenCalledWith(
      "rematch:propose",
      { roomId: "room-1", sessionToken: "tok-1" },
      expect.any(Function),
    );
  });

  it("sets rematchProposed when this seat's own proposal is echoed back", async () => {
    const { useRematch } = await import("../useRematch.js");
    const { result } = renderHook(() => useRematch("room-1", "tok-1", 1));

    act(() => {
      fakeSocket.handlers.get("rematch:proposed")?.({ from: 1 });
    });

    await waitFor(() => expect(result.current.rematchProposed).toBe(true));
    expect(result.current.opponentProposed).toBe(false);
  });

  it("sets opponentProposed when another seat proposes", async () => {
    const { useRematch } = await import("../useRematch.js");
    const { result } = renderHook(() => useRematch("room-1", "tok-1", 1));

    act(() => {
      fakeSocket.handlers.get("rematch:proposed")?.({ from: 2 });
    });

    await waitFor(() => expect(result.current.opponentProposed).toBe(true));
    expect(result.current.rematchProposed).toBe(false);
  });

  it("declineRematch emits rematch:decline and clears rematchProposed", async () => {
    const { useRematch } = await import("../useRematch.js");
    const { result } = renderHook(() => useRematch("room-1", "tok-1", 1));

    act(() => {
      fakeSocket.handlers.get("rematch:proposed")?.({ from: 1 });
    });
    await waitFor(() => expect(result.current.rematchProposed).toBe(true));

    act(() => result.current.declineRematch());

    expect(fakeSocket.emit).toHaveBeenCalledWith(
      "rematch:decline",
      { roomId: "room-1", sessionToken: "tok-1" },
      expect.any(Function),
    );
    expect(result.current.rematchProposed).toBe(false);
  });

  it("clears proposed state on a rematch:declined broadcast", async () => {
    const { useRematch } = await import("../useRematch.js");
    const { result } = renderHook(() => useRematch("room-1", "tok-1", 1));

    act(() => {
      fakeSocket.handlers.get("rematch:proposed")?.({ from: 2 });
    });
    await waitFor(() => expect(result.current.opponentProposed).toBe(true));

    act(() => {
      fakeSocket.handlers.get("rematch:declined")?.({ from: 2 });
    });
    await waitFor(() => expect(result.current.opponentProposed).toBe(false));
  });

  it("sets rematchAccepted + newRoomId and calls onRematchStart on rematch:start", async () => {
    const onRematchStart = vi.fn();
    const { useRematch } = await import("../useRematch.js");
    const { result } = renderHook(() => useRematch("room-1", "tok-1", 1, onRematchStart));

    act(() => {
      fakeSocket.handlers.get("rematch:start")?.({ roomId: "room-2" });
    });

    await waitFor(() => expect(result.current.rematchAccepted).toBe(true));
    expect(result.current.newRoomId).toBe("room-2");
    expect(onRematchStart).toHaveBeenCalledWith("room-2");
  });

  it("surfaces rematch:error broadcasts", async () => {
    const { useRematch } = await import("../useRematch.js");
    const { result } = renderHook(() => useRematch("room-1", "tok-1", 1));

    act(() => {
      fakeSocket.handlers.get("rematch:error")?.({ code: "NOT_FINISHED", message: "nope" });
    });

    await waitFor(() =>
      expect(result.current.error).toEqual({ code: "NOT_FINISHED", message: "nope" }),
    );

    act(() => result.current.clearError());
    expect(result.current.error).toBeUndefined();
  });

  it("resets rematch state when roomId changes", async () => {
    const { useRematch } = await import("../useRematch.js");
    const { result, rerender } = renderHook(({ roomId }) => useRematch(roomId, "tok-1", 1), {
      initialProps: { roomId: "room-1" },
    });

    act(() => {
      fakeSocket.handlers.get("rematch:proposed")?.({ from: 1 });
    });
    await waitFor(() => expect(result.current.rematchProposed).toBe(true));

    rerender({ roomId: "room-2" });
    await waitFor(() => expect(result.current.rematchProposed).toBe(false));
  });
});

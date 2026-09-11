import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEventQueue, flush, installFlushOnHide, track } from "../events";

describe("client funnel events (MPG-097)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  /** Registered so a failing assertion cannot leak a `pagehide` listener into the next test. */
  let uninstallers: (() => void)[] = [];

  function install(): () => void {
    const off = installFlushOnHide();
    uninstallers.push(off);
    return off;
  }

  beforeEach(() => {
    uninstallers = [];
    __resetEventQueue();
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("mpg_session_token", "tok-test");
  });

  afterEach(() => {
    for (const off of uninstallers) off();
    uninstallers = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    __resetEventQueue();
  });

  function sentBodies(): { events: { name: string }[] }[] {
    return fetchMock.mock.calls.map(
      (call) => JSON.parse(String((call[1] as RequestInit).body)) as { events: { name: string }[] },
    );
  }

  it("does not send immediately — events are batched", () => {
    track("first_input");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("coalesces a burst into one request on flush", async () => {
    track("first_input");
    track("first_input");

    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sentBodies()[0]?.events).toHaveLength(2);
  });

  it("flushes on its own after the interval", async () => {
    track("first_input");

    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("stamps each event with when it happened, not when it was sent", async () => {
    vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
    track("first_input");

    vi.setSystemTime(new Date("2026-09-11T12:00:04.000Z"));
    await flush();

    const [event] = sentBodies()[0]?.events ?? [];
    expect((event as unknown as { occurredAt: number }).occurredAt).toBe(
      new Date("2026-09-11T12:00:00.000Z").getTime(),
    );
  });

  it("swallows a failing send — analytics degrades to absence, never to an error", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    track("first_input");

    // The offline pillar in one assertion: a dead server must not surface here.
    await expect(flush()).resolves.toBeUndefined();
  });

  it("drops a failed batch rather than retrying it forever", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    track("first_input");
    await flush();

    await flush();

    // Only the failed attempt — nothing was re-queued.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("is a no-op when nothing is queued", async () => {
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps the queue instead of growing without bound", async () => {
    for (let i = 0; i < 60; i++) track("first_input");

    await flush();

    expect(sentBodies()[0]?.events).toHaveLength(50);
  });

  it("beacons the queue on pagehide, carrying the token the header cannot", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    const uninstall = install();
    track("first_input");
    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeacon).toHaveBeenCalledOnce();
    const blob = sendBeacon.mock.calls[0]?.[1] as Blob;
    const body = JSON.parse(await blob.text()) as { sessionToken?: string };
    expect(body.sessionToken).toBe("tok-test");

    uninstall();
  });

  it("falls back to fetch when sendBeacon refuses the payload", async () => {
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn().mockReturnValue(false) });

    const uninstall = install();
    track("first_input");
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledOnce();
    uninstall();
  });

  it("stops listening once uninstalled", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });

    const uninstall = install();
    uninstall();

    track("first_input");
    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

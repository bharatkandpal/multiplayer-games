import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEventQueue, flush } from "../../api/events";
import { __resetFirstInput, markColdArrival, markFirstInput } from "../firstInput";

describe("time-to-first-input (MPG-097 leg 5)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetEventQueue();
    __resetFirstInput();
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __resetEventQueue();
    __resetFirstInput();
  });

  async function sentEvents(): Promise<
    { name: string; gameId?: string; props: { msSinceArrival: number; viaShare: boolean } }[]
  > {
    await flush();
    if (fetchMock.mock.calls.length === 0) return [];
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      events: {
        name: string;
        gameId?: string;
        props: { msSinceArrival: number; viaShare: boolean };
      }[];
    };
    return body.events;
  }

  it("fires once, with the game it happened in", async () => {
    markFirstInput("connect-four");

    const events = await sentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("first_input");
    expect(events[0]?.gameId).toBe("connect-four");
  });

  it("is a no-op on every later move — a latency metric, not a move counter", async () => {
    markFirstInput("connect-four");
    markFirstInput("connect-four");
    markFirstInput("connect-four");

    expect(await sentEvents()).toHaveLength(1);
  });

  it("measures elapsed time from arrival", async () => {
    vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
    markColdArrival();

    vi.setSystemTime(new Date("2026-09-11T12:00:03.500Z"));
    markFirstInput("nim");

    expect((await sentEvents())[0]?.props.msSinceArrival).toBe(3500);
  });

  it("flags a share-link arrival as viral, and an ordinary load as not", async () => {
    // The distinction the whole leg rests on: a stranger following a link is
    // the only arrival that counts toward k-factor.
    markColdArrival();
    markFirstInput("nim");
    expect((await sentEvents())[0]?.props.viaShare).toBe(true);

    __resetEventQueue();
    __resetFirstInput();
    fetchMock.mockClear();

    markFirstInput("nim");
    expect((await sentEvents())[0]?.props.viaShare).toBe(false);
  });

  it("re-arms when a new cold arrival is marked", async () => {
    markFirstInput("nim");
    markColdArrival();
    markFirstInput("gomoku");

    const events = await sentEvents();
    expect(events).toHaveLength(2);
    expect(events[1]?.gameId).toBe("gomoku");
  });

  it("never reports a negative elapsed time if the clock jumps backwards", async () => {
    vi.setSystemTime(new Date("2026-09-11T12:00:05.000Z"));
    markColdArrival();

    vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
    markFirstInput("nim");

    expect((await sentEvents())[0]?.props.msSinceArrival).toBe(0);
  });
});

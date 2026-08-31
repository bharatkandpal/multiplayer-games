import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import {
  SESSION_COOKIE,
  SESSION_HEADER,
  createSessionMiddleware,
  createSocketSessionMiddleware,
  extractSessionToken,
  parseCookies,
} from "../sessionMiddleware.js";

function mockReqRes(headers: Record<string, string | string[] | undefined> = {}) {
  const req = { headers, sessionToken: undefined } as unknown as Request;
  const res = {
    setHeader: vi.fn(),
    cookie: vi.fn(),
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next };
}

describe("parseCookies", () => {
  it("parses a cookie header into key/value pairs", () => {
    expect(parseCookies("a=1; b=2")).toEqual({ a: "1", b: "2" });
  });

  it("returns an empty object for undefined/empty headers", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("decodes URI-encoded cookie values", () => {
    expect(parseCookies("t=abc%2Fdef")).toEqual({ t: "abc/def" });
  });
});

describe("extractSessionToken", () => {
  it("prefers the x-session-token header", () => {
    const token = extractSessionToken({
      [SESSION_HEADER]: "hdr-token",
      cookie: `${SESSION_COOKIE}=cookie-token`,
    });
    expect(token).toBe("hdr-token");
  });

  it("falls back to the mpg_session cookie", () => {
    const token = extractSessionToken({ cookie: `${SESSION_COOKIE}=cookie-token` });
    expect(token).toBe("cookie-token");
  });

  it("returns undefined when neither is present", () => {
    expect(extractSessionToken({})).toBeUndefined();
  });
});

describe("createSessionMiddleware", () => {
  it("mints a new token when none is present and upserts it", async () => {
    const store = createMemoryStore();
    const middleware = createSessionMiddleware(store);
    const { req, res, next } = mockReqRes();

    await middleware(req, res, next);

    expect(req.sessionToken).toBeTruthy();
    expect(res.setHeader).toHaveBeenCalledWith(SESSION_HEADER, req.sessionToken);
    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      req.sessionToken,
      expect.objectContaining({ httpOnly: true }),
    );
    expect(next).toHaveBeenCalledWith();

    const stored = await store.sessions.findByToken(req.sessionToken);
    expect(stored).toBeDefined();
  });

  it("reuses an existing token from the header", async () => {
    const store = createMemoryStore();
    const middleware = createSessionMiddleware(store);
    const { req, res, next } = mockReqRes({ [SESSION_HEADER]: "existing-token" });

    await middleware(req, res, next);

    expect(req.sessionToken).toBe("existing-token");
    expect(next).toHaveBeenCalledWith();
  });

  it("touches lastSeenAt on every request", async () => {
    const store = createMemoryStore();
    const touchSpy = vi.spyOn(store.sessions, "touch");
    const middleware = createSessionMiddleware(store);
    const { req, res, next } = mockReqRes({ [SESSION_HEADER]: "tok-touch" });

    await middleware(req, res, next);

    expect(touchSpy).toHaveBeenCalledWith("tok-touch");
  });

  it("calls next with an error if the store throws", async () => {
    const store = {
      sessions: {
        upsert: vi.fn().mockRejectedValue(new Error("boom")),
        touch: vi.fn(),
        findByToken: vi.fn(),
        delete: vi.fn(),
      },
    } as unknown as Store;
    const middleware = createSessionMiddleware(store);
    const { req, res, next } = mockReqRes();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("createSocketSessionMiddleware", () => {
  function mockSocket(overrides: {
    auth?: Record<string, unknown>;
    headers?: Record<string, string | string[] | undefined>;
  }) {
    return {
      handshake: {
        auth: overrides.auth ?? {},
        headers: overrides.headers ?? {},
      },
      data: {} as Record<string, unknown>,
    } as unknown as import("socket.io").Socket;
  }

  it("uses the token from handshake auth when present", async () => {
    const store = createMemoryStore();
    const middleware = createSocketSessionMiddleware(store);
    const socket = mockSocket({ auth: { sessionToken: "auth-token" } });
    const next = vi.fn();

    await middleware(socket, next);

    expect(socket.data["sessionToken"]).toBe("auth-token");
    expect(next).toHaveBeenCalledWith();
  });

  it("falls back to headers, then mints a token", async () => {
    const store = createMemoryStore();
    const middleware = createSocketSessionMiddleware(store);
    const socket = mockSocket({ headers: { [SESSION_HEADER]: "hdr-token" } });
    const next = vi.fn();

    await middleware(socket, next);

    expect(socket.data["sessionToken"]).toBe("hdr-token");
  });

  it("mints a token when nothing is present", async () => {
    const store = createMemoryStore();
    const middleware = createSocketSessionMiddleware(store);
    const socket = mockSocket({});
    const next = vi.fn();

    await middleware(socket, next);

    expect(typeof socket.data["sessionToken"]).toBe("string");
    expect((socket.data["sessionToken"] as string).length).toBeGreaterThan(0);
    expect(next).toHaveBeenCalledWith();
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShareLink } from "../useShareLink";

const PAYLOAD = { url: "https://example.test/drunk-walk", title: "Drunk Walk", text: "I scored 17" };

/** Installs (or removes) a `navigator.share` for one test. */
function stubNativeShare(impl?: (data: ShareData) => Promise<void>): void {
  if (impl) {
    Object.defineProperty(navigator, "share", { value: impl, configurable: true, writable: true });
  } else {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "share");
  }
}

/**
 * jsdom ships no `navigator.clipboard` at all, so there's nothing to spy on
 * until we put one there. Returns the `writeText` mock under test.
 */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

/**
 * jsdom implements neither `document.execCommand` nor a real clipboard, so the
 * legacy rung has to be installed explicitly to be exercised as a FAILING one.
 */
function failLegacyCopy(): void {
  Object.defineProperty(document, "execCommand", {
    value: () => {
      throw new Error("unsupported");
    },
    configurable: true,
    writable: true,
  });
}

describe("useShareLink", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubNativeShare();
    stubClipboard();
  });

  afterEach(() => {
    stubNativeShare();
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "clipboard");
    Reflect.deleteProperty(document as unknown as Record<string, unknown>, "execCommand");
  });

  it("uses the native share sheet when one exists, passing title/text/url", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNativeShare(share);

    const { result } = renderHook(() => useShareLink());
    expect(result.current.canShare).toBe(true);

    await act(async () => {
      await result.current.share(PAYLOAD);
    });

    expect(share).toHaveBeenCalledWith({
      title: "Drunk Walk",
      text: "I scored 17",
      url: "https://example.test/drunk-walk",
    });
    expect(result.current.status).toBe("shared");
  });

  it("treats a dismissed share sheet as a cancel, not a failure — and does not copy instead", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    stubNativeShare(vi.fn().mockRejectedValue(abort));
    const writeText = stubClipboard();

    const { result } = renderHook(() => useShareLink());
    await act(async () => {
      await result.current.share(PAYLOAD);
    });

    expect(result.current.status).toBe("idle");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls through to the clipboard when the native share rejects for a real reason", async () => {
    stubNativeShare(vi.fn().mockRejectedValue(new Error("not a secure context")));
    const writeText = stubClipboard();

    const { result } = renderHook(() => useShareLink());
    await act(async () => {
      await result.current.share(PAYLOAD);
    });

    expect(writeText).toHaveBeenCalledWith("https://example.test/drunk-walk");
    expect(result.current.status).toBe("copied");
  });

  it("copies straight away on a platform with no share sheet", async () => {
    const writeText = stubClipboard();

    const { result } = renderHook(() => useShareLink());
    expect(result.current.canShare).toBe(false);

    await act(async () => {
      await result.current.share(PAYLOAD);
    });

    expect(writeText).toHaveBeenCalledWith("https://example.test/drunk-walk");
    expect(result.current.status).toBe("copied");
  });

  it("reports 'unavailable' — never a silent no-op — when every path fails", async () => {
    stubClipboard().mockRejectedValue(new Error("denied"));
    failLegacyCopy();

    const { result } = renderHook(() => useShareLink());
    await act(async () => {
      await result.current.share(PAYLOAD);
    });

    expect(result.current.status).toBe("unavailable");
  });

  it("auto-clears a transient success but leaves 'unavailable' in place", async () => {
    stubClipboard();

    const { result } = renderHook(() => useShareLink({ resetMs: 20 }));
    await act(async () => {
      await result.current.share(PAYLOAD);
    });
    expect(result.current.status).toBe("copied");
    await waitFor(() => expect(result.current.status).toBe("idle"));

    stubClipboard().mockRejectedValue(new Error("denied"));
    failLegacyCopy();
    await act(async () => {
      await result.current.share(PAYLOAD);
    });
    // Still there well past resetMs — the escape hatch must not vanish.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.status).toBe("unavailable");
  });
});

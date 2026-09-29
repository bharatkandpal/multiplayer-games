import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisualViewportBox } from "../useVisualViewportBox.js";

interface FakeViewport {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  emit: (type: "resize" | "scroll") => void;
}

function fakeVisualViewport(height: number, offsetTop = 0): FakeViewport {
  const listeners = new Map<string, Set<() => void>>();
  return {
    height,
    offsetTop,
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    }),
    emit: (type) => listeners.get(type)?.forEach((fn) => fn()),
  };
}

describe("useVisualViewportBox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  let vv: FakeViewport;

  beforeEach(() => {
    vv = fakeVisualViewport(800);
    vi.stubGlobal("visualViewport", vv);
  });

  it("sizes and offsets the element to the visual viewport when enabled", () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = el;

    renderHook(() => useVisualViewportBox(ref, true));

    expect(el.style.height).toBe("800px");
    expect(el.style.transform).toBe("translateY(0px)");
  });

  it("tracks the viewport shrinking and shifting when the keyboard opens", () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = el;

    renderHook(() => useVisualViewportBox(ref, true));

    // Keyboard opens: the visual viewport shrinks and scrolls down.
    vv.height = 500;
    vv.offsetTop = 120;
    vv.emit("resize");

    expect(el.style.height).toBe("500px");
    expect(el.style.transform).toBe("translateY(120px)");
  });

  it("does nothing while disabled, and leaves the box to CSS", () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = el;

    renderHook(() => useVisualViewportBox(ref, false));

    expect(el.style.height).toBe("");
    expect(el.style.transform).toBe("");
    expect(vv.addEventListener).not.toHaveBeenCalled();
  });

  it("hands the box back to CSS on cleanup", () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = el;

    const { unmount } = renderHook(() => useVisualViewportBox(ref, true));
    expect(el.style.height).toBe("800px");

    unmount();
    expect(el.style.height).toBe("");
    expect(el.style.transform).toBe("");
    expect(vv.removeEventListener).toHaveBeenCalled();
  });
});

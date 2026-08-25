import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toast } from "./Toast";

describe("Toast", () => {
  it("uses a polite status role for informational variants", () => {
    render(<Toast variant="info">Opponent joined</Toast>);
    expect(screen.getByRole("status")).toHaveTextContent("Opponent joined");
  });

  it("uses an assertive alert role for danger/warning variants", () => {
    render(<Toast variant="danger">Move rejected</Toast>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent("Move rejected");
  });

  it("calls onDismiss when the dismiss button is activated", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Toast variant="success" onDismiss={onDismiss}>
        Rematch started
      </Toast>,
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("omits the dismiss button when onDismiss is not provided", () => {
    render(<Toast variant="info">Reconnecting…</Toast>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("auto-dismisses after autoDismissMs", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toast variant="info" onDismiss={onDismiss} autoDismissMs={3000}>
        Copied link
      </Toast>,
    );

    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  describe("autoDismiss pause-on-interaction (WCAG 2.2.1)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("pauses the countdown on hover and resumes with the remaining time on mouse leave", () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      render(
        <Toast variant="info" onDismiss={onDismiss} autoDismissMs={3000}>
          Copied link
        </Toast>,
      );

      const toast = screen.getByRole("status");

      // 1s elapsed, then hover — pauses with ~2s remaining.
      vi.advanceTimersByTime(1000);
      fireEvent.mouseEnter(toast);

      // Far more than the remaining time passes while paused: still no dismiss.
      vi.advanceTimersByTime(5000);
      expect(onDismiss).not.toHaveBeenCalled();

      // Leaving resumes the ~2s that was remaining.
      fireEvent.mouseLeave(toast);
      vi.advanceTimersByTime(1999);
      expect(onDismiss).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("pauses the countdown while a child (e.g. the dismiss button) has focus", () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      render(
        <Toast variant="info" onDismiss={onDismiss} autoDismissMs={2000}>
          Copied link
        </Toast>,
      );

      const dismissButton = screen.getByRole("button", { name: "Dismiss" });
      fireEvent.focus(dismissButton);

      vi.advanceTimersByTime(10000);
      expect(onDismiss).not.toHaveBeenCalled();

      fireEvent.blur(dismissButton, { relatedTarget: document.body });
      vi.advanceTimersByTime(2000);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});

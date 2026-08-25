import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

function Fixture({ initialOpen = true }: { initialOpen?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open modal
      </button>
      <Modal isOpen={open} title="Rematch?" onClose={() => setOpen(false)}>
        <p>Play again with the same seats?</p>
        <button type="button">Confirm</button>
      </Modal>
    </div>
  );
}

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal isOpen={false} title="Rematch?" onClose={() => undefined}>
        <p>Hidden</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders an accessible dialog labelled by its title when open", () => {
    render(
      <Modal isOpen title="Rematch?" onClose={() => undefined}>
        <p>Play again?</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Rematch?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("calls onClose on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal isOpen title="Rematch?" onClose={onClose}>
        <p>Play again?</p>
      </Modal>,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked, not when dialog content is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal isOpen title="Rematch?" onClose={onClose}>
        <p>Play again?</p>
      </Modal>,
    );

    await user.click(screen.getByText("Play again?"));
    expect(onClose).not.toHaveBeenCalled();

    // The backdrop is the dialog's offset parent in the portal.
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is activated", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal isOpen title="Rematch?" onClose={onClose}>
        <p>Play again?</p>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps focus within the dialog (Tab wraps from last to first focusable)", async () => {
    const user = userEvent.setup();
    render(
      <Modal isOpen title="Rematch?" onClose={() => undefined}>
        <button type="button">Confirm</button>
      </Modal>,
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    const confirmButton = screen.getByRole("button", { name: "Confirm" });

    // Close is the first focusable element in DOM order (header precedes
    // body content), so it receives initial focus.
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(confirmButton).toHaveFocus();

    // Tab from the last focusable element wraps back to the first.
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirmButton).toHaveFocus();
  });

  it("restores focus to the previously focused element on close", async () => {
    const user = userEvent.setup();
    render(<Fixture initialOpen={false} />);

    const opener = screen.getByRole("button", { name: "Open modal" });
    opener.focus();
    await user.click(opener);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

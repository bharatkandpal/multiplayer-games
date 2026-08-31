import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UsernamePrompt } from "./UsernamePrompt";

describe("UsernamePrompt", () => {
  it("renders nothing when closed", () => {
    render(<UsernamePrompt isOpen={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits a valid name immediately, without waiting on anything async", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UsernamePrompt isOpen onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "bharat_k");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("bharat_k");
  });

  it("shows an inline format error and refocuses the input for a too-short name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UsernamePrompt isOpen onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "ab");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/3–20 characters/);
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveFocus());
  });

  it("shows an inline format error for disallowed characters", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UsernamePrompt isOpen onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "bad name!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/3–20 characters/);
  });

  it("shows a server-reported collision message when reopened after one", () => {
    render(
      <UsernamePrompt
        isOpen
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        collisionMessage="That name's taken — try another for this browser."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("That name's taken");
  });

  it("calls onCancel on Escape without ever calling onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<UsernamePrompt isOpen onSubmit={onSubmit} onCancel={onCancel} />);

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit an empty name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UsernamePrompt isOpen onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/3–20 characters/);
  });
});

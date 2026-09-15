import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClaimHandlePrompt } from "./ClaimHandlePrompt";

const baseProps = {
  isOpen: true as const,
  view: "claim" as const,
  recoveryCode: undefined,
  claimedHandle: undefined,
  claimError: undefined,
  adoptError: undefined,
  submitting: false,
  onSubmitClaim: vi.fn(),
  onSubmitAdopt: vi.fn(),
  onConfirmSaved: vi.fn(),
  onSwitchToAdopt: vi.fn(),
  onSwitchToClaim: vi.fn(),
  onCancel: vi.fn(),
};

describe("ClaimHandlePrompt", () => {
  it("renders nothing when closed", () => {
    render(<ClaimHandlePrompt {...baseProps} isOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  describe("claim view", () => {
    it("submits the typed handle", async () => {
      const user = userEvent.setup();
      const onSubmitClaim = vi.fn();
      render(<ClaimHandlePrompt {...baseProps} onSubmitClaim={onSubmitClaim} />);

      await user.type(screen.getByLabelText("Handle"), "Nova");
      await user.click(screen.getByRole("button", { name: "Save handle" }));

      expect(onSubmitClaim).toHaveBeenCalledWith("Nova");
    });

    it("shows a claim error inline as an alert", () => {
      render(<ClaimHandlePrompt {...baseProps} claimError="That handle's taken — try another." />);
      expect(screen.getByRole("alert")).toHaveTextContent("That handle's taken");
    });

    it("offers the adopt toggle", async () => {
      const user = userEvent.setup();
      const onSwitchToAdopt = vi.fn();
      render(<ClaimHandlePrompt {...baseProps} onSwitchToAdopt={onSwitchToAdopt} />);

      await user.click(screen.getByRole("button", { name: "Enter your recovery code" }));
      expect(onSwitchToAdopt).toHaveBeenCalledTimes(1);
    });
  });

  describe("recovery view", () => {
    it("reveals the code and confirms it was saved", async () => {
      const user = userEvent.setup();
      const onConfirmSaved = vi.fn();
      render(
        <ClaimHandlePrompt
          {...baseProps}
          view="recovery"
          recoveryCode="K7QN-4FH2-ABCD-EJKM"
          claimedHandle="Nova"
          onConfirmSaved={onConfirmSaved}
        />,
      );

      expect(screen.getByText("K7QN-4FH2-ABCD-EJKM")).toBeInTheDocument();
      expect(screen.getByText(/only/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "I've saved it" }));
      expect(onConfirmSaved).toHaveBeenCalledTimes(1);
    });

    it("copies the code to the clipboard", async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      // Define AFTER setup so this wins over userEvent's own clipboard stub —
      // the Copy button calls navigator.clipboard.writeText directly.
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      render(
        <ClaimHandlePrompt {...baseProps} view="recovery" recoveryCode="K7QN-4FH2-ABCD-EJKM" />,
      );

      await user.click(screen.getByRole("button", { name: "Copy code" }));
      expect(writeText).toHaveBeenCalledWith("K7QN-4FH2-ABCD-EJKM");
    });
  });

  describe("adopt view", () => {
    it("submits the entered code", async () => {
      const user = userEvent.setup();
      const onSubmitAdopt = vi.fn();
      render(<ClaimHandlePrompt {...baseProps} view="adopt" onSubmitAdopt={onSubmitAdopt} />);

      await user.type(screen.getByLabelText("Recovery code"), "K7QN-4FH2-ABCD-EJKM");
      await user.click(screen.getByRole("button", { name: "Restore handle" }));

      expect(onSubmitAdopt).toHaveBeenCalledWith("K7QN-4FH2-ABCD-EJKM");
    });

    it("shows an adopt error inline as an alert", () => {
      render(
        <ClaimHandlePrompt
          {...baseProps}
          view="adopt"
          adoptError="We couldn't find that code. Check it and try again."
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent("We couldn't find that code");
    });
  });

  describe("restored view", () => {
    it("confirms the restore and closes on Done", async () => {
      const user = userEvent.setup();
      const onConfirmSaved = vi.fn();
      render(
        <ClaimHandlePrompt
          {...baseProps}
          view="restored"
          claimedHandle="Nova"
          onConfirmSaved={onConfirmSaved}
        />,
      );

      expect(screen.getByRole("status")).toHaveTextContent(/Welcome back/);
      expect(screen.getByText("Nova")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Done" }));
      expect(onConfirmSaved).toHaveBeenCalledTimes(1);
    });
  });
});

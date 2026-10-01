import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileMenu } from "./ProfileMenu";
import { initialsOf } from "./Avatar";
import { getStoredUsername, setStoredUsername } from "../../api/username.js";

beforeEach(() => {
  window.localStorage.clear();
  setStoredUsername("strongWolf", false, true);
  // Backend down: every request fails. Nothing here may care.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

const trigger = (): HTMLElement => screen.getByRole("button", { name: /your profile/i });

describe("initialsOf", () => {
  it("splits camelCase auto names and falls back to leading characters", () => {
    expect(initialsOf("strongWolf")).toBe("SW");
    expect(initialsOf("bob")).toBe("BO");
    expect(initialsOf("_")).toBe("?");
  });
});

describe("ProfileMenu", () => {
  it("opens to show the auto-assigned name, with no theme switch and no sync badge", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu />);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("strongWolf")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/unconfirmed|not saved|syncing/i)).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the avatar", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu />);
    await user.click(trigger());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("moves between controls with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu />);
    await user.click(trigger());
    expect(screen.getByRole("button", { name: "Edit name" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Shuffle name" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "Edit name" })).toHaveFocus();
  });

  it("edits the name locally while the backend is down", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu />);
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Edit name" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    await user.clear(input);
    await user.type(input, "ab");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/3–20 characters/);
    await user.clear(input);
    await user.type(input, "Maple_9");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(getStoredUsername()).toBe("Maple_9");
    expect(screen.getByText("Maple_9")).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: /./ })).not.toBeInTheDocument();
  });

  it("asks in-page before clearing, and Keep leaves data alone", async () => {
    const user = userEvent.setup();
    const onCleared = vi.fn();
    render(<ProfileMenu onCleared={onCleared} />);
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Clear local data" }));
    expect(screen.getByText("Clear local data?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep my data" }));
    expect(onCleared).not.toHaveBeenCalled();
    expect(getStoredUsername()).toBe("strongWolf");
  });

  it("clears local data once confirmed", async () => {
    const user = userEvent.setup();
    const onCleared = vi.fn();
    render(<ProfileMenu onCleared={onCleared} />);
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Clear local data" }));
    await user.click(screen.getByRole("button", { name: "Clear everything" }));
    expect(getStoredUsername()).toBeNull();
    expect(onCleared).toHaveBeenCalledOnce();
  });

  it("closes on an outside press", async () => {
    render(
      <div>
        <ProfileMenu />
        <button type="button">elsewhere</button>
      </div>,
    );
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

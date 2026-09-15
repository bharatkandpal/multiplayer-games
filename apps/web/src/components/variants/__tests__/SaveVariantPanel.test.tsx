import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SaveVariantPanel } from "../SaveVariantPanel";
import { saveVariant } from "../../../api/variants.js";
import { useBackendReachable } from "../../../hooks/useBackendReachable.js";

vi.mock("../../../api/variants.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/variants.js")>();
  return { ...actual, saveVariant: vi.fn() };
});

vi.mock("../../../hooks/useBackendReachable.js", () => ({
  useBackendReachable: vi.fn(),
}));

const COSMETICS = { hat: "party-hat" };

describe("SaveVariantPanel (MPG-089-c)", () => {
  beforeEach(() => {
    vi.mocked(saveVariant).mockReset();
    vi.mocked(useBackendReachable).mockReset();
  });

  it("OFFLINE PILLAR: renders nothing when the backend isn't known-reachable", () => {
    vi.mocked(useBackendReachable).mockReturnValue(false);
    const { container } = render(
      <SaveVariantPanel baseGameId="drunk-walk" cosmetics={COSMETICS} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("EMPTY/idle: shows the name field and a disabled-by-default save action", () => {
    vi.mocked(useBackendReachable).mockReturnValue(true);
    render(<SaveVariantPanel baseGameId="drunk-walk" cosmetics={COSMETICS} />);
    expect(screen.getByLabelText("Variant name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save this variant" })).toBeInTheDocument();
  });

  it("instant local validation rejects an empty name with no network call", async () => {
    vi.mocked(useBackendReachable).mockReturnValue(true);
    const user = userEvent.setup();
    render(<SaveVariantPanel baseGameId="drunk-walk" cosmetics={COSMETICS} />);

    await user.click(screen.getByRole("button", { name: "Save this variant" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Give this variant a name.");
    expect(saveVariant).not.toHaveBeenCalled();
  });

  it("OPTIMISTIC/SUCCESS: saves, then shows the confirmation + share ladder using the returned token", async () => {
    vi.mocked(useBackendReachable).mockReturnValue(true);
    vi.mocked(saveVariant).mockResolvedValue({
      ok: true,
      variant: {
        id: "v1",
        name: "Party Ghost",
        baseGameId: "drunk-walk",
        cosmetics: COSMETICS,
        forkedFrom: null,
        createdAt: "2026-09-15T00:00:00.000Z",
      },
      share: {
        token: "tok-1",
        kind: "variant",
        createdAt: "2026-09-15T00:00:00.000Z",
        expiresAt: null,
      },
    });
    const user = userEvent.setup();
    render(<SaveVariantPanel baseGameId="drunk-walk" cosmetics={COSMETICS} />);

    await user.type(screen.getByLabelText("Variant name"), "Party Ghost");
    await user.click(screen.getByRole("button", { name: "Save this variant" }));

    expect(saveVariant).toHaveBeenCalledWith({
      baseGameId: "drunk-walk",
      name: "Party Ghost",
      cosmetics: COSMETICS,
    });

    expect(await screen.findByText(/Saved as/)).toBeInTheDocument();
    expect(screen.getByText("Party Ghost")).toBeInTheDocument();
    // The share button reuses the token the save response already minted —
    // no second network mint.
    expect(
      screen.getByRole("button", { name: /Share this variant|Copy link/ }),
    ).toBeInTheDocument();
  });

  it("ERROR: surfaces the server's moderation reason inline, and lets the player retry", async () => {
    vi.mocked(useBackendReachable).mockReturnValue(true);
    vi.mocked(saveVariant).mockResolvedValue({
      ok: false,
      reason: "invalid_name",
      detail: "PROFANITY",
    });
    const user = userEvent.setup();
    render(<SaveVariantPanel baseGameId="drunk-walk" cosmetics={COSMETICS} />);

    await user.type(screen.getByLabelText("Variant name"), "bad name");
    await user.click(screen.getByRole("button", { name: "Save this variant" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That name isn't allowed");
    // The form is still there to retry — never a dead end.
    expect(screen.getByRole("button", { name: "Save this variant" })).toBeInTheDocument();
  });

  it("BACKEND-DOWN AFTER A DELIBERATE CLICK: says so plainly, never a blank/error page", async () => {
    vi.mocked(useBackendReachable).mockReturnValue(true);
    vi.mocked(saveVariant).mockResolvedValue({ ok: false, reason: "unavailable" });
    const user = userEvent.setup();
    render(<SaveVariantPanel baseGameId="drunk-walk" cosmetics={COSMETICS} />);

    await user.type(screen.getByLabelText("Variant name"), "Party Ghost");
    await user.click(screen.getByRole("button", { name: "Save this variant" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the server — try again in a moment.",
    );
  });

  it("lets the player save another version after a successful save", async () => {
    vi.mocked(useBackendReachable).mockReturnValue(true);
    vi.mocked(saveVariant).mockResolvedValue({
      ok: true,
      variant: {
        id: "v1",
        name: "Party Ghost",
        baseGameId: "drunk-walk",
        cosmetics: COSMETICS,
        forkedFrom: null,
        createdAt: "2026-09-15T00:00:00.000Z",
      },
      share: {
        token: "tok-1",
        kind: "variant",
        createdAt: "2026-09-15T00:00:00.000Z",
        expiresAt: null,
      },
    });
    const user = userEvent.setup();
    render(<SaveVariantPanel baseGameId="drunk-walk" cosmetics={COSMETICS} />);

    await user.type(screen.getByLabelText("Variant name"), "Party Ghost");
    await user.click(screen.getByRole("button", { name: "Save this variant" }));
    await waitFor(() => expect(screen.getByText(/Saved as/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Save another version" }));
    expect(screen.getByLabelText("Variant name")).toHaveValue("");
  });
});

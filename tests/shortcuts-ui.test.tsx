// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutsSettings } from "../components/shortcuts";
import { FeedbackProvider } from "../components/ui";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  status: undefined as unknown,
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutation,
  useQuery: () => mocks.status,
}));

const token = `dw_${"a".repeat(43)}`;
const view = () =>
  render(
    <FeedbackProvider>
      <ShortcutsSettings />
    </FeedbackProvider>,
  );

afterEach(() => {
  cleanup();
  mocks.mutation.mockReset();
  mocks.status = undefined;
  vi.unstubAllEnvs();
});

describe("Apple Shortcuts settings", () => {
  it("creates a token and shows it once", async () => {
    mocks.status = null;
    mocks.mutation.mockResolvedValueOnce(token);
    const { rerender } = view();
    await userEvent.click(
      screen.getByRole("button", { name: /Create a token/ }),
    );
    expect(mocks.mutation).toHaveBeenCalledWith({});
    mocks.status = { prefix: "aaaaaaa", createdAt: Date.now() };
    rerender(
      <FeedbackProvider>
        <ShortcutsSettings />
      </FeedbackProvider>,
    );
    expect(screen.getByLabelText("Your token").textContent).toBe(token);
    expect(screen.getByText("Token created")).toBeTruthy();
  });

  it("shows only the prefix of a saved token", () => {
    mocks.status = {
      prefix: "abc1234",
      createdAt: Date.now(),
      lastUsedAt: undefined,
    };
    view();
    expect(screen.getByText("dw_abc1234…")).toBeTruthy();
    expect(screen.getByText(/not used yet/)).toBeTruthy();
    expect(screen.queryByLabelText("Your token")).toBeNull();
  });

  it("asks for a second tap before revoking", async () => {
    mocks.status = { prefix: "abc1234", createdAt: Date.now() };
    view();
    await userEvent.click(screen.getByRole("button", { name: /Revoke/ }));
    expect(mocks.mutation).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: /Tap again to revoke/ }),
    );
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Token revoked")).toBeTruthy();
  });

  it("lists the HTTP site addresses for this deployment", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_CONVEX_URL",
      "https://happy-otter-123.convex.cloud",
    );
    mocks.status = null;
    view();
    await userEvent.click(screen.getByText("How to set up a shortcut"));
    expect(
      screen.getByText("https://happy-otter-123.convex.site/shortcuts/water"),
    ).toBeTruthy();
    expect(
      screen.getByText("https://happy-otter-123.convex.site/shortcuts/steps"),
    ).toBeTruthy();
    expect(screen.getByText(/Find Health Samples: Steps/)).toBeTruthy();
  });
});

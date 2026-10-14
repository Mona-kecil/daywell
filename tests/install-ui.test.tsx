// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallCard } from "../components/install";

let standalone = false;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: standalone }));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  standalone = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const iphone = () =>
  vi
    .spyOn(navigator, "userAgent", "get")
    .mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    );

describe("Install card", () => {
  it("spells out Add to Home Screen on iPhone and remembers Not now", async () => {
    iphone();
    render(<InstallCard />);
    expect(
      screen.getByText(
        /iPhone only sends reminders to apps on the Home Screen/,
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      ["Tap  in the browser toolbar.", "Choose  Add to Home Screen."],
    );
    expect(screen.getByRole("img", { name: "Share" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("heading")).toBeNull();
    cleanup();
    render(<InstallCard />);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("offers the browser's install prompt when there is one", async () => {
    render(<InstallCard />);
    // A desktop browser with no prompt: nothing to offer.
    expect(screen.queryByRole("heading")).toBeNull();
    const prompt = vi.fn(async () => {});
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt,
        userChoice: Promise.resolve({ outcome: "accepted" as const }),
      },
    );
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await userEvent.click(
      screen.getByRole("button", { name: "Install Daywell" }),
    );
    expect(prompt).toHaveBeenCalledOnce();
    // The prompt is single-use, so the card goes once it has been answered.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(localStorage.getItem("daywell.installDismissed")).toBeNull();
  });

  it("stays away once Daywell runs from the Home Screen", () => {
    iphone();
    standalone = true;
    render(<InstallCard />);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

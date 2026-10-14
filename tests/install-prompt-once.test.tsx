/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { InstallCard } from "../components/install";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  if (originalMatchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
});

describe("install card", () => {
  it("stays hidden when matchMedia is missing", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });

    expect(() => render(<InstallCard />)).not.toThrow();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("does not call one deferred prompt twice while its first call is pending", () => {
    const prompt = vi.fn(() => new Promise<void>(() => {}));
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt,
        userChoice: new Promise<{ outcome: "accepted" | "dismissed" }>(
          () => {},
        ),
      },
    );
    act(() => window.dispatchEvent(event));
    render(<InstallCard />);
    const button = screen.getByRole("button", { name: "Install Daywell" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(prompt).toHaveBeenCalledTimes(1);
  });
});

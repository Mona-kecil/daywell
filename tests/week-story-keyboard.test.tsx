/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekStory } from "../components/week-story";

vi.mock("convex/react", () => ({
  useQuery: () => ({ lifts: [] }),
}));

HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const review = {
  fromDay: "2026-10-08",
  toDay: "2026-10-14",
  daysLogged: 5,
  workouts: 2,
  totalSets: 10,
  newPRs: 0,
  avgSleepHours: null,
  sleepDays: 0,
  avgWaterMl: 2000,
  waterGoalMl: 2500,
  waterGoalPercent: 80,
} as never;

describe("week story keyboard", () => {
  it("lets Enter advance after a held press is canceled outside the page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    render(<WeekStory review={review} now={0} onClose={() => {}} />);

    const stage = document.querySelector(".story-stage")!;
    fireEvent.pointerDown(stage);
    vi.advanceTimersByTime(500);
    fireEvent.pointerLeave(stage);

    const next = screen.getByRole("button", { name: "Next page" });
    next.focus();
    await userEvent.keyboard("{Enter}");

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "2 workouts",
    );
  });

  it("keeps a touch hold from turning the page when leave follows up", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    render(<WeekStory review={review} now={0} onClose={() => {}} />);
    const first = screen.getByRole("heading", { level: 2 }).textContent;

    const stage = document.querySelector(".story-stage")!;
    fireEvent.pointerDown(stage);
    vi.advanceTimersByTime(500);
    // Touch order: up, then leave, then the click.
    fireEvent.pointerUp(stage);
    fireEvent.pointerLeave(stage);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(first);
  });
});

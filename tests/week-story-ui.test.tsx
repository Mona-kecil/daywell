// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeeklyReview } from "../components/review";

const review = {
  fromDay: "2026-10-08",
  toDay: "2026-10-14",
  isoWeek: "2026-W42",
  workouts: 4,
  totalSets: 62,
  newPRs: 2,
  avgSleepHours: 7.25,
  sleepDays: 5,
  avgWaterMl: 2140,
  waterGoalMl: 2500,
  waterGoalPercent: 85.6,
  daysLogged: 6,
};
const mocks = vi.hoisted(() => ({
  review: null as unknown,
  lifts: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useQuery: (_: unknown, args: { timeZone?: string }) =>
    args.timeZone ? mocks.review : { lifts: mocks.lifts },
}));

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

let reduced = false;
beforeEach(() => {
  mocks.review = review;
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
});
afterEach(() => {
  cleanup();
  reduced = false;
  mocks.lifts = [];
  vi.unstubAllGlobals();
});

const lift = (name: string, status: string, changePct: number | null) => ({
  id: `e-${name}`,
  name,
  status,
  unit: "kg",
  points: [{ at: 0, value: 100 }],
  best: 100,
  bestAt: 0,
  sessionsSinceBest: 0,
  changePct,
  lastAt: 0,
});
const page = () =>
  within(screen.getByRole("dialog")).getByRole("heading").textContent;
const fill = () =>
  document.querySelector(".story-progress .active > span") as Element;
// jsdom has no AnimationEvent, so React listens for the WebKit name.
const end = () =>
  fireEvent(fill(), new Event("webkitAnimationEnd", { bubbles: true }));

describe("Week story", () => {
  it("plays the week page by page and closes from the last page", async () => {
    mocks.lifts = [
      lift("Squat", "climbing", 1.2),
      lift("Deadlift", "climbing", 2.84),
      lift("Crunch", "stalled", 0),
    ];
    render(<WeeklyReview now={0} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Play your week" }),
    );
    expect(screen.getByRole("dialog", { name: "Your week" })).toBeTruthy();
    expect(screen.getByText("Page 1 of 6")).toBeTruthy();
    expect(page()).toBe("6 of 7 days");

    // Each page moves on when its progress bar fills.
    end();
    expect(page()).toBe("4 workouts");
    expect(
      screen.getByText("62 sets, and 2 new personal records."),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(page()).toBe("+2.8% a week");
    expect(
      screen.getByText("Deadlift is climbing fastest, estimated max 100 kg."),
    ).toBeTruthy();
    expect(screen.getByText(/Stalled: Crunch\./)).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "Previous page" }),
    );
    expect(page()).toBe("4 workouts");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(page()).toBe("2,140 ml a day");
    expect(
      screen.getByText("86% of your 2,500 ml goal, on average."),
    ).toBeTruthy();
    end();
    expect(page()).toBe("7.3 h a night");
    end();
    expect(page()).toBe("Nicely done.");
    expect(screen.getByText("Page 6 of 6")).toBeTruthy();
    // The last page waits for the reader.
    end();
    expect(page()).toBe("Nicely done.");

    await userEvent.click(screen.getByRole("button", { name: "Watch again" }));
    expect(page()).toBe("6 of 7 days");
    await userEvent.keyboard("{ArrowLeft}");
    expect(page()).toBe("6 of 7 days");

    await userEvent.click(screen.getByRole("button", { name: "Close story" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pauses, and skips pages that have nothing to say", async () => {
    mocks.review = {
      ...review,
      workouts: 0,
      totalSets: 0,
      newPRs: 0,
      avgSleepHours: null,
      sleepDays: 0,
      daysLogged: 2,
    };
    render(<WeeklyReview now={0} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Play your week" }),
    );
    expect(screen.getByText("Page 1 of 4")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Pause story" }));
    expect((fill() as HTMLElement).style.animationPlayState).toBe("paused");
    await userEvent.click(screen.getByRole("button", { name: "Play story" }));
    expect((fill() as HTMLElement).style.animationPlayState).toBe("running");

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(page()).toBe("A rest week");
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(page()).toBe("2,140 ml a day");
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(page()).toBe("Every log counts.");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("holding the page pauses it without turning it", () => {
    vi.useFakeTimers();
    try {
      render(<WeeklyReview now={0} />);
      fireEvent.click(screen.getByRole("button", { name: "Play your week" }));
      const stage = document.querySelector(".story-stage") as Element;
      fireEvent.pointerDown(stage);
      expect((fill() as HTMLElement).style.animationPlayState).toBe("paused");
      vi.advanceTimersByTime(800);
      fireEvent.pointerUp(stage);
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(page()).toBe("6 of 7 days");
      expect((fill() as HTMLElement).style.animationPlayState).toBe("running");
      // A quick tap still turns the page.
      fireEvent.pointerDown(stage);
      fireEvent.pointerUp(stage);
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(page()).toBe("4 workouts");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves pages still when motion is reduced", async () => {
    reduced = true;
    render(<WeeklyReview now={0} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Play your week" }),
    );
    expect(screen.queryByRole("button", { name: "Pause story" })).toBeNull();
    end();
    expect(page()).toBe("6 of 7 days");
  });
});

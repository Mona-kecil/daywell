// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WeeklyReview } from "../components/review";
import { storySlides } from "../components/week-story";

const base = {
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
const cardio = {
  cardioSessions: 3,
  cardioMinutes: 95,
  cardioActiveMinutes: 120,
  cardioGoal: 150,
};
const mocks = vi.hoisted(() => ({ review: null as unknown }));
vi.mock("convex/react", () => ({
  useQuery: (_: unknown, args: { timeZone?: string }) =>
    args.timeZone ? mocks.review : { lifts: [] },
}));
afterEach(cleanup);

type Review = Parameters<typeof storySlides>[0];

describe("cardio in the weekly review", () => {
  it("shows active minutes against the goal on the card", () => {
    mocks.review = { ...base, ...cardio };
    render(<WeeklyReview now={Date.now()} />);
    expect(screen.getByText("Cardio 3 sessions")).toBeTruthy();
    expect(screen.getByText("120 of 150 active min")).toBeTruthy();
    const meter = screen.getByRole("meter", {
      name: "Active cardio minutes against the weekly goal",
    });
    expect(meter.getAttribute("aria-valuenow")).toBe("80");
  });
  it("leaves the card alone without cardio", () => {
    mocks.review = { ...base, ...cardio, cardioSessions: 0 };
    render(<WeeklyReview now={Date.now()} />);
    expect(screen.queryByText(/^Cardio/)).toBeNull();
    mocks.review = base;
    cleanup();
    render(<WeeklyReview now={Date.now()} />);
    expect(screen.queryByText(/^Cardio/)).toBeNull();
  });
  it("adds a cardio page to the story after training", () => {
    const slides = storySlides({ ...base, ...cardio } as Review, []);
    const keys = slides.map((s) => s.key);
    expect(keys.indexOf("cardio")).toBe(keys.indexOf("training") + 1);
    const page = slides.find((s) => s.key === "cardio")!;
    expect(page.eyebrow).toBe("Cardio");
    expect(page.big).toBe("120 active minutes");
    expect(page.text).toBe("3 sessions, 1 h 35 min in all. 30 to go for 150.");
    const done = storySlides(
      {
        ...base,
        ...cardio,
        cardioActiveMinutes: 180,
        cardioSessions: 1,
      } as Review,
      [],
    ).find((s) => s.key === "cardio")!;
    expect(done.text).toBe(
      "1 session, 1 h 35 min in all. You hit the 150-minute goal.",
    );
    expect(
      storySlides({ ...base, ...cardio, cardioSessions: 0 } as Review, []).some(
        (s) => s.key === "cardio",
      ),
    ).toBe(false);
  });
});

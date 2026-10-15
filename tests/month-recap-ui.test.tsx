// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthRecap, recapSlides } from "../components/month-recap";

const full = {
  month: "2026-09",
  fromDay: "2026-09-01",
  toDay: "2026-09-30",
  days: 30,
  daysLogged: 24,
  workouts: 12,
  totalSets: 180,
  volumeKg: 45210,
  newPRs: 3,
  topMuscles: [
    { name: "Back", workouts: 6 },
    { name: "Chest", workouts: 4 },
    { name: "Legs", workouts: 1 },
  ],
  cardio: {
    sessions: 8,
    minutes: 245,
    activeMinutes: 310,
    distanceKm: 42.5,
    topKind: "run",
  },
  weight: { startKg: 81.4, endKg: 80.6, changeKg: -0.8 },
  habits: { done: 45, possible: 60 },
  water: { avgMl: 2140, goalMl: 2500, daysAtGoal: 11 },
  sleep: { avgHours: 7.24, days: 20 },
  best: { day: "2026-09-22", reason: "workout+cardio" },
  previous: { workouts: 9, cardioActiveMinutes: 200, daysLogged: 20 },
} as const;
const empty = {
  ...full,
  month: "2026-10",
  fromDay: "2026-10-01",
  toDay: "2026-10-15",
  days: 15,
  daysLogged: 0,
  workouts: 0,
  totalSets: 0,
  volumeKg: 0,
  newPRs: 0,
  topMuscles: [],
  cardio: {
    sessions: 0,
    minutes: 0,
    activeMinutes: 0,
    distanceKm: 0,
    topKind: null,
  },
  weight: null,
  habits: null,
  water: { avgMl: 0, goalMl: 2500, daysAtGoal: 0 },
  sleep: { avgHours: null, days: 0 },
  best: null,
  previous: { workouts: 12, cardioActiveMinutes: 310, daysLogged: 24 },
} as const;

type Recap = Parameters<typeof recapSlides>[0];
const text = (s: { text: unknown }) => s.text;

// A stat splits its unit into <small>, so match the whole <dd>.
const stat = (card: HTMLElement, text: string) =>
  within(card).getByText(
    (_, el) => el?.tagName === "DD" && el.textContent === text,
  );

describe("monthly recap pages", () => {
  it("tells a full month in order", () => {
    const slides = recapSlides(full as unknown as Recap);
    expect(slides.map((s) => s.key)).toEqual([
      "days",
      "training",
      "muscles",
      "cardio",
      "weight",
      "habits",
      "water",
      "sleep",
      "best",
      "end",
    ]);
    const page = Object.fromEntries(slides.map((s) => [s.key, s]));
    expect(page.days.eyebrow).toBe("September 2026");
    expect(page.days.big).toBe("24 of 30 days");
    expect(text(page.days)).toBe("You logged something on 24 days.");
    expect(page.training.big).toBe("12 workouts");
    expect(text(page.training)).toBe(
      "180 sets and 45,210 kg lifted. 3 more than August.",
    );
    expect(page.muscles.big).toBe("Back");
    expect(text(page.muscles)).toBe(
      "Back 6 workouts, Chest 4 workouts, Legs 1 workout.",
    );
    expect(page.cardio.big).toBe("310 active minutes");
    expect(text(page.cardio)).toBe(
      "8 sessions, 4 h 5 min in all, 42.5 km covered. Mostly running.",
    );
    expect(page.weight.big).toBe("−0.8 kg");
    expect(text(page.weight)).toBe(
      "From 81.4 to 80.6 kg on your smoothed trend.",
    );
    expect(page.habits.big).toBe("75% done");
    expect(text(page.habits)).toBe("45 of 60 habit check-ins.");
    expect(page.water.big).toBe("2,140 ml a day");
    expect(text(page.water)).toBe("You reached your 2,500 ml goal on 11 days.");
    expect(page.sleep.big).toBe("7.2 h a night");
    expect(page.best.eyebrow).toBe("Standout day");
    expect(page.best.big).toBe("Tuesday, Sep 22");
    expect(text(page.best)).toBe("You lifted and got your cardio in.");
    expect(page.end.eyebrow).toBe("That's September");
    expect(page.end.big).toBe("More days than August.");
  });
  it("keeps a quiet month short and honest", () => {
    const slides = recapSlides(empty as unknown as Recap);
    expect(slides.map((s) => s.key)).toEqual([
      "days",
      "training",
      "water",
      "end",
    ]);
    expect(slides[0].eyebrow).toBe("October so far");
    expect(slides[1].big).toBe("A month off lifting");
    expect(slides.at(-1)?.eyebrow).toBe("That's October so far");
    expect(slides.at(-1)?.big).toBe("Every log counts.");
  });
  it("words weight gain, fewer workouts and a cardio-only best day", () => {
    const slides = recapSlides({
      ...full,
      workouts: 7,
      weight: { startKg: 80, endKg: 80.5, changeKg: 0.5 },
      cardio: { ...full.cardio, distanceKm: 0, topKind: "other" },
      best: { day: "2026-09-03", reason: "cardio" },
    } as unknown as Recap);
    const page = Object.fromEntries(slides.map((s) => [s.key, s]));
    expect(text(page.training)).toBe(
      "180 sets and 45,210 kg lifted. 2 fewer than August.",
    );
    expect(page.weight.big).toBe("+0.5 kg");
    expect(text(page.cardio)).toBe("8 sessions, 4 h 5 min in all.");
    expect(text(page.best)).toBe("You got your cardio in.");
  });
  it("keeps the last day of this month in progress", () => {
    const lastDay = {
      ...full,
      month: "2026-10",
      fromDay: "2026-10-01",
      toDay: "2026-10-31",
      days: 31,
      daysLogged: 31,
    };
    const slides = recapSlides(lastDay as unknown as Recap, true);
    expect(slides[0].eyebrow).toBe("October so far");
    expect(slides.at(-1)?.eyebrow).toBe("That's October so far");
    expect(recapSlides(lastDay as unknown as Recap, false)[0].eyebrow).toBe(
      "October 2026",
    );
  });

  it("compares a past month off lifting with the month before", () => {
    const training = (previousWorkouts: number) =>
      recapSlides({
        ...empty,
        month: "2026-09",
        fromDay: "2026-09-01",
        toDay: "2026-09-30",
        days: 30,
        previous: { ...empty.previous, workouts: previousWorkouts },
      } as unknown as Recap).find((s) => s.key === "training")!;
    expect(text(training(4))).toBe(
      "No workouts logged this month, after 4 in August.",
    );
    expect(text(training(1))).toBe(
      "No workouts logged this month, after 1 in August.",
    );
    expect(text(training(0))).toBe("No workouts logged this month.");
  });

  it("compares a month in progress only once it is ahead", () => {
    const training = (workouts: number) =>
      recapSlides({
        ...empty,
        workouts,
        totalSets: 10,
        volumeKg: 1000,
        previous: { ...empty.previous, workouts: 6 },
      } as unknown as Recap).find((s) => s.key === "training")!;
    expect(text(training(4))).toBe("10 sets and 1,000 kg lifted.");
    expect(text(training(6))).toBe("10 sets and 1,000 kg lifted.");
    expect(text(training(8))).toBe(
      "10 sets and 1,000 kg lifted. 2 more than September already.",
    );
  });
  it("words muscle-only training, lowercase muscles and a dry month", () => {
    const page = (recap: object) =>
      Object.fromEntries(
        recapSlides({ ...full, ...recap } as unknown as Recap).map((s) => [
          s.key,
          s,
        ]),
      );
    const bodyOnly = page({
      totalSets: 6,
      volumeKg: 0,
      topMuscles: [
        { name: "abs", workouts: 6 },
        { name: "calves", workouts: 5 },
      ],
      water: { avgMl: 1723, goalMl: 2500, daysAtGoal: 0 },
    });
    expect(text(bodyOnly.training)).toBe("6 sets logged. 3 more than August.");
    expect(bodyOnly.muscles.big).toBe("Abs");
    expect(text(bodyOnly.muscles)).toBe("Abs 6 workouts, Calves 5 workouts.");
    expect(text(bodyOnly.water)).toBe(
      "You didn't reach your 2,500 ml goal this month.",
    );
    const noSets = page({
      totalSets: 0,
      volumeKg: 0,
      previous: { ...full.previous, workouts: 12 },
    });
    expect(text(noSets.training)).toBe("Same as August.");
    expect(
      text(
        page({
          totalSets: 0,
          volumeKg: 0,
          previous: { ...full.previous, workouts: 0 },
        }).training,
      ),
    ).toBe("Logged by muscle group.");
  });
});

const mocks = vi.hoisted(() => ({
  args: [] as { month: string; timeZone: string }[],
  data: {} as Record<string, unknown>,
}));
vi.mock("convex/react", () => ({
  useQuery: (_: unknown, args: { month: string; timeZone: string }) => {
    mocks.args.push(args);
    return mocks.data[args.month];
  },
}));
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};
beforeEach(() => {
  mocks.args = [];
  mocks.data = { "2026-09": full, "2026-10": empty };
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("monthly recap card", () => {
  it("plays this month as in progress on its last day", async () => {
    mocks.data["2026-10"] = {
      ...full,
      month: "2026-10",
      fromDay: "2026-10-01",
      toDay: "2026-10-31",
      days: 31,
    };
    render(<MonthRecap now={new Date(2026, 9, 31, 21).getTime()} />);
    await userEvent.click(screen.getByRole("button", { name: "Play October" }));
    expect(screen.getByRole("dialog", { name: "October so far" })).toBeTruthy();
  });

  it("opens on last month early in a month and plays it", async () => {
    render(<MonthRecap now={new Date(2026, 9, 5, 12).getTime()} />);
    expect(mocks.args.at(-1)?.month).toBe("2026-09");
    const card = screen.getByRole("region", { name: "Your month" });
    expect(
      within(card)
        .getByRole("button", { name: "September" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(stat(card, "24/30")).toBeTruthy();
    expect(stat(card, "−0.8 kg")).toBeTruthy();
    await userEvent.click(
      within(card).getByRole("button", { name: "Play September" }),
    );
    const story = screen.getByRole("dialog", { name: "September 2026" });
    expect(within(story).getByText("24 of 30 days")).toBeTruthy();
  });
  it("opens on this month later on, and switches months", async () => {
    render(<MonthRecap now={new Date(2026, 9, 15, 12).getTime()} />);
    expect(mocks.args.at(-1)?.month).toBe("2026-10");
    const card = screen.getByRole("region", { name: "Your month" });
    expect(stat(card, "0/15")).toBeTruthy();
    // Nothing to play in an empty month.
    expect(within(card).queryByRole("button", { name: /^Play/ })).toBeNull();
    await userEvent.click(
      within(card).getByRole("button", { name: "September" }),
    );
    expect(mocks.args.at(-1)?.month).toBe("2026-09");
    expect(stat(card, "24/30")).toBeTruthy();
  });
});

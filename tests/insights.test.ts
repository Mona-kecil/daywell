import { describe, expect, it } from "vitest";
import {
  binDays,
  bucketDays,
  dayWindow,
  streak,
  summarize,
  type InsightsInput,
} from "../lib/insights";

const now = new Date(2026, 9, 13, 15, 30);
const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour).getTime();
const input = (over: Partial<InsightsInput> = {}): InsightsInput => ({
  waterGoal: 2000,
  muscles: [
    { _id: "chest", name: "chest" },
    { _id: "calves", name: "calves" },
  ],
  water: [],
  meals: [],
  workouts: [],
  ...over,
});

describe("insights day window", () => {
  it("ends with today and spans whole local days", () => {
    const w = dayWindow(now, 7);
    expect(w.days.map((d) => d.key)).toEqual([
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
    ]);
    expect(w.startMs).toBe(new Date(2026, 9, 7).getTime());
    expect(w.endMs).toBe(new Date(2026, 9, 14).getTime());
  });
});

describe("bucketDays", () => {
  it("assigns entries to their local day and ignores outsiders", () => {
    const w = dayWindow(now, 3);
    const days = bucketDays(
      w.days,
      input({
        water: [
          { at: at(13, 0), amountMl: 500 },
          { at: at(13, 23), amountMl: 250 },
          { at: at(10, 12), amountMl: 999 },
        ],
        meals: [
          { at: at(12, 8), kcal: 400, protein: 20, carbs: 50, fat: 10 },
          { at: at(12, 19), kcal: 600, protein: 30, carbs: 60, fat: 20 },
        ],
        workouts: [
          { trainedAt: at(11, 18), muscleIds: ["chest"] },
          { trainedAt: at(11, 20), muscleIds: ["chest", "calves"] },
        ],
      }),
    );
    expect(days.map((d) => d.waterMl)).toEqual([0, 0, 750]);
    expect(days[1]).toMatchObject({ meals: 2, kcal: 1000, protein: 50 });
    expect(days[0].trained).toEqual(["chest", "calves"]);
  });
});

describe("binDays", () => {
  it("averages over logged days and aligns weeks to today", () => {
    const w = dayWindow(now, 10);
    const days = bucketDays(
      w.days,
      input({
        water: [
          { at: at(13, 9), amountMl: 2000 },
          { at: at(12, 9), amountMl: 1000 },
        ],
        workouts: [
          { trainedAt: at(13, 9), muscleIds: ["chest"] },
          { trainedAt: at(12, 9), muscleIds: ["chest"] },
        ],
      }),
    );
    const bins = binDays(days, 7);
    expect(bins.map((b) => b.days.length)).toEqual([3, 7]);
    expect(bins[1].days.at(-1)?.key).toBe("2026-10-13");
    expect(bins[1].waterMl).toBe(1500);
    expect(bins[1].macros).toBeNull();
    expect(bins[1].trained.get("chest")).toBe(2);
    expect(bins[0].waterMl).toBeNull();
  });
});

describe("streaks and summary", () => {
  const w = dayWindow(now, 14);
  const goalOn = (...dates: number[]) =>
    input({ water: dates.map((d) => ({ at: at(d, 10), amountMl: 2100 })) });

  it("does not break the streak while today is still in progress", () => {
    const days = bucketDays(w.days, goalOn(10, 11, 12));
    expect(streak(days, (d) => d.waterMl >= 2000)).toBe(3);
  });
  it("counts today once it is met and stops at a gap", () => {
    const days = bucketDays(w.days, goalOn(9, 11, 12, 13));
    expect(streak(days, (d) => d.waterMl >= 2000)).toBe(3);
  });
  it("reports untrained muscles and logged-day averages", () => {
    const data = input({
      water: [{ at: at(13, 9), amountMl: 1000 }],
      meals: [{ at: at(12, 9), kcal: 1800, protein: 90, carbs: 200, fat: 60 }],
      workouts: [{ trainedAt: at(6, 9), muscleIds: ["chest"] }],
    });
    const history = bucketDays(w.days, data);
    const week = history.slice(-7);
    const s = summarize(week, history, data);
    expect(s.untrained.map((m) => m.name)).toEqual(["chest", "calves"]);
    expect(s).toMatchObject({
      avgWaterMl: 1000,
      waterDays: 1,
      avgKcal: 1800,
      mealDays: 1,
      trainingDays: 0,
      trainingStreakWeeks: 1,
    });
  });
});

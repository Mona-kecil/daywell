import { describe, expect, it } from "vitest";
import { monthlyRecap, monthRange } from "../lib/monthly-recap";

const at = (day: string) => Date.parse(`${day}T12:00:00Z`);
const empty: Parameters<typeof monthlyRecap>[0] = {
  month: "2026-10",
  now: at("2026-10-15"),
  timeZone: "UTC",
  waterGoal: 2500,
  muscles: [],
  workouts: [],
  sets: [],
  water: [],
  meals: [],
  checkins: [],
  habits: [],
  habitLogs: [],
  cardio: [],
};
const lift = (day: string, workoutId: string, weightKg = 100) => ({
  trainedAt: at(day),
  workoutId,
  exerciseId: "bench",
  reps: 1,
  weightKg,
});
const workout = (day: string, muscleIds: string[] = []) => ({
  trainedAt: at(day),
  muscleIds,
});
const cardio = (day: string, minutes = 10) =>
  ({
    day,
    minutes,
    kind: "run",
    effort: "hard",
    createdAt: at(day),
  }) satisfies Parameters<typeof monthlyRecap>[0]["cardio"][number];

describe("monthRange", () => {
  it("clips this month and keeps full past months, leap years and year boundaries", () => {
    expect(monthRange("2026-10", "2026-10-15")).toEqual({
      fromDay: "2026-10-01",
      toDay: "2026-10-15",
      days: 15,
    });
    expect(monthRange("2026-09", "2026-10-15")).toEqual({
      fromDay: "2026-09-01",
      toDay: "2026-09-30",
      days: 30,
    });
    expect(monthRange("2024-02", "2026-10-15").days).toBe(29);
    expect(monthRange("2026-02", "2026-10-15").days).toBe(28);
    expect(monthRange("2025-12", "2026-01-01").days).toBe(31);
    expect(monthRange("0096-02", "2026-10-15").days).toBe(29);
  });
  it.each([
    "2026-11",
    "2027-01",
    "2026-00",
    "2026-13",
    "2026-1",
    "26-10",
    "2026-10-01",
    " 2026-10",
    "2026-10\n",
    "bad",
  ])("rejects %s", (month) => {
    expect(() => monthRange(month, "2026-10-15")).toThrow();
  });
});

it("returns the complete empty recap and the full previous calendar month", () => {
  expect(monthlyRecap(empty)).toEqual({
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
    previous: { workouts: 0, cardioActiveMinutes: 0, daysLogged: 0 },
  });
});

it("counts sets and volume, compares PRs to all past sessions, and excludes later rows", () => {
  const baseline = lift("2020-01-01", "baseline");
  const result = monthlyRecap({
    ...empty,
    workouts: [
      workout("2026-10-01"),
      workout("2026-10-15"),
      { ...workout("2026-10-15"), trainedAt: empty.now + 1 },
    ],
    sets: [
      baseline,
      { ...lift("2026-10-01", "below-baseline", 50), reps: 2 },
      lift("2026-10-15", "pr", 110.4),
      lift("2026-10-15", "pr", 120.4),
      {
        ...baseline,
        trainedAt: empty.now + 1,
        workoutId: "future",
        weightKg: 1000,
      },
    ],
  });
  expect(result).toMatchObject({
    workouts: 2,
    totalSets: 3,
    volumeKg: 331,
    newPRs: 1,
  });
});

it("orders the top three muscles by workout count then name, counting each muscle once per workout", () => {
  const result = monthlyRecap({
    ...empty,
    muscles: [
      { _id: "z", name: "Zebra" },
      { _id: "a", name: "Arms" },
      { _id: "b", name: "Back" },
      { _id: "c", name: "Chest" },
    ],
    workouts: [
      workout("2026-10-01", ["z", "b", "a", "c", "z", "deleted"]),
      workout("2026-10-02", ["z"]),
    ],
  });
  expect(result.topMuscles).toEqual([
    { name: "Zebra", workouts: 2 },
    { name: "Arms", workouts: 1 },
    { name: "Back", workouts: 1 },
  ]);
});

it("counts distinct logged days from all six sources, omitting empty check-ins, unready meals and future rows", () => {
  const result = monthlyRecap({
    ...empty,
    workouts: [workout("2026-10-01"), workout("2026-10-01")],
    water: [{ at: at("2026-10-02"), amountMl: 1 }],
    meals: [
      { at: at("2026-10-03"), analysis: { status: "ready" } },
      { at: at("2026-10-07"), analysis: { status: "analyzing" } },
      { at: empty.now + 1, analysis: { status: "ready" } },
    ],
    checkins: [
      { day: "2026-10-04", sleepHours: 0 },
      { day: "2026-10-08", note: "  " },
      { day: "2026-10-16", mood: 3 },
    ],
    habitLogs: [
      { habitId: "archived", day: "2026-10-05", _creationTime: 1 },
      { habitId: "a", day: "2026-10-09", _creationTime: empty.now + 1 },
    ],
    cardio: [
      cardio("2026-10-06"),
      { ...cardio("2026-10-10"), createdAt: empty.now + 1 },
      cardio("2026-10-16"),
    ],
  });
  expect(result.daysLogged).toBe(6);
});

it("sums cardio, doubles hard minutes, rounds to one decimal and sorts topKind by total minutes then kind", () => {
  const result = monthlyRecap({
    ...empty,
    cardio: [
      {
        ...cardio("2026-10-01", 10.14),
        kind: "walk",
        effort: "easy",
        distanceKm: 1.24,
      },
      { ...cardio("2026-10-02", 5.07), distanceKm: 0.54 },
      cardio("2026-10-03", 5.07),
    ],
  });
  expect(result.cardio).toEqual({
    sessions: 3,
    minutes: 20.3,
    activeMinutes: 30.4,
    distanceKm: 1.8,
    topKind: "run",
  });
});

it("uses trend points from all preceding weigh-ins and subtracts the rounded endpoints", () => {
  const result = monthlyRecap({
    ...empty,
    checkins: [
      { day: "2026-09-30", weightKg: 80 },
      { day: "2026-10-02", weightKg: 70 },
      { day: "2026-10-10", weightKg: 69 },
      { day: "2026-10-16", weightKg: 30 },
    ],
  });
  expect(result.weight).toEqual({ startKg: 80, endKg: 78, changeKg: -2 });
  expect(
    monthlyRecap({
      ...empty,
      checkins: [
        { day: "2026-09-30", weightKg: 80 },
        { day: "2026-10-02", weightKg: 70 },
      ],
    }).weight,
  ).toBeNull();
});

it("counts active habit opportunities from creation or the first backfilled log, clipped to the range", () => {
  const result = monthlyRecap({
    ...empty,
    habits: [
      { _id: "old", createdAt: at("2026-09-01") },
      { _id: "new", createdAt: at("2026-10-10") },
      { _id: "archived", createdAt: 1, archivedAt: 2 },
      { _id: "future", createdAt: empty.now + 1 },
    ],
    habitLogs: [
      { habitId: "new", day: "2026-09-20", _creationTime: 1 },
      { habitId: "new", day: "2026-10-02", _creationTime: 1 },
      { habitId: "old", day: "2026-10-15", _creationTime: 1 },
      { habitId: "archived", day: "2026-10-03", _creationTime: 1 },
    ],
  });
  expect(result.habits).toEqual({ done: 2, possible: 30 });
  expect(
    monthlyRecap({
      ...empty,
      habits: [{ _id: "new", createdAt: at("2026-10-10") }],
    }).habits,
  ).toEqual({ done: 0, possible: 6 });
  expect(
    monthlyRecap({
      ...empty,
      month: "2026-09",
      habits: [{ _id: "new", createdAt: at("2026-10-10") }],
    }).habits,
  ).toEqual({ done: 0, possible: 0 });
});

it("averages water over all elapsed dates and includes zero hours in sleep", () => {
  const result = monthlyRecap({
    ...empty,
    waterGoal: 2000,
    water: [
      { at: at("2026-10-01"), amountMl: 1000 },
      { at: at("2026-10-01"), amountMl: 1000 },
      { at: at("2026-10-02"), amountMl: 999 },
      { at: at("2026-09-30"), amountMl: 9999 },
      { at: empty.now + 1, amountMl: 9999 },
    ],
    checkins: [
      { day: "2026-10-01", sleepHours: 0 },
      { day: "2026-10-02", sleepHours: 7.25 },
      { day: "2026-10-03", mood: 3 },
    ],
  });
  expect(result.water).toEqual({ avgMl: 200, goalMl: 2000, daysAtGoal: 1 });
  expect(result.sleep).toEqual({ avgHours: 3.6, days: 2 });
});

it("chooses latest workout+cardio, else most sets with latest tie, else latest cardio", () => {
  const input = {
    ...empty,
    workouts: [
      workout("2026-10-02"),
      workout("2026-10-03"),
      workout("2026-10-04"),
    ],
    sets: [
      lift("2026-10-02", "a"),
      lift("2026-10-02", "a"),
      lift("2026-10-03", "b"),
      lift("2026-10-03", "b"),
      lift("2026-10-04", "c"),
    ],
  };
  expect(
    monthlyRecap({
      ...input,
      cardio: [
        cardio("2026-10-02"),
        cardio("2026-10-04"),
        cardio("2026-10-05"),
      ],
    }).best,
  ).toEqual({ day: "2026-10-04", reason: "workout+cardio" });
  expect(monthlyRecap(input).best).toEqual({
    day: "2026-10-03",
    reason: "workout",
  });
  expect(
    monthlyRecap({
      ...empty,
      cardio: [cardio("2026-10-01"), cardio("2026-10-02")],
    }).best,
  ).toEqual({ day: "2026-10-02", reason: "cardio" });
  expect(
    monthlyRecap({
      ...empty,
      workouts: [workout("2026-10-01"), workout("2026-10-02")],
    }).best,
  ).toEqual({ day: "2026-10-02", reason: "workout" });
});

it("compares with the full previous calendar month across a year boundary", () => {
  expect(
    monthlyRecap({
      ...empty,
      month: "2026-01",
      now: at("2026-01-02"),
      workouts: [
        workout("2025-12-01"),
        workout("2025-12-31"),
        workout("2025-11-30"),
      ],
      cardio: [cardio("2025-12-31", 20.14)],
      water: [{ at: at("2025-12-20"), amountMl: 1 }],
    }).previous,
  ).toEqual({ workouts: 2, cardioActiveMinutes: 40.3, daysLogged: 3 });
});

it("counts 23:30 on the last local day in that month, even when UTC is next month", () => {
  const result = monthlyRecap({
    ...empty,
    month: "2026-09",
    timeZone: "America/Los_Angeles",
    workouts: [
      { trainedAt: Date.parse("2026-10-01T06:30Z"), muscleIds: [] },
      { trainedAt: Date.parse("2026-09-01T06:30Z"), muscleIds: [] },
    ],
  });
  expect(result).toMatchObject({
    workouts: 1,
    daysLogged: 1,
    best: { day: "2026-09-30", reason: "workout" },
    previous: { workouts: 1, daysLogged: 1 },
  });
});

it("accepts year 0000, including January's previous calendar month", () => {
  expect(monthRange("0000-02", "2026-10-15").days).toBe(29);
  expect(monthlyRecap({ ...empty, month: "0000-01" })).toMatchObject({
    fromDay: "0000-01-01",
    toDay: "0000-01-31",
    days: 31,
    previous: { workouts: 0, cardioActiveMinutes: 0, daysLogged: 0 },
  });
});

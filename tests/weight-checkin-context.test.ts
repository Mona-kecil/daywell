import { expect, it } from "vitest";
import { buildCoachSnapshot } from "../lib/coach-chat";
import { historyThroughNow } from "../lib/history";

const now = Date.parse("2026-10-15T12:00:00Z");

it("keeps waist-only check-ins in history but excludes empty and future days", () => {
  const history = historyThroughNow({
    now,
    timeZone: "UTC",
    waterGoal: 2500,
    muscleIds: [],
    workouts: [],
    sets: [],
    water: [],
    meals: [],
    checkins: [
      { day: "2026-10-15", waistCm: 82.25 },
      { day: "2026-10-14" },
      { day: "2026-10-16", waistCm: 83 },
    ],
  });
  expect(history.checkins).toEqual([{ day: "2026-10-15", waistCm: 82.25 }]);
});

it("passes waist through the coach snapshot with the existing measurements", () => {
  const input = {
    now,
    timeZone: "UTC",
    waterGoal: 2500,
    targets: {},
    water: [],
    meals: [],
    workouts: [],
    muscles: [],
    suggestions: [],
    checkin: { day: "2026-10-15", weightKg: 75, waistCm: 82.25 },
  };
  expect(buildCoachSnapshot(input).latestCheckin).toEqual({
    day: "2026-10-15",
    weightKg: 75,
    waistCm: 82.25,
    sleepHours: null,
    mood: null,
    energy: null,
  });
  expect(
    buildCoachSnapshot({ ...input, checkin: { day: "2026-10-15" } })
      .latestCheckin,
  ).toMatchObject({ waistCm: null });
});

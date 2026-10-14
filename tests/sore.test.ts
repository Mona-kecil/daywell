import { describe, expect, it } from "vitest";
import { recovery, SORE_EXTEND_HOURS, SORE_MAX_HOURS } from "../lib/recovery";
import { forecast } from "../lib/forecast";
import { planWeek } from "../lib/week-plan";
import { coachSuggestions, type CoachInput } from "../lib/coach";
import { buildCoachSnapshot } from "../lib/coach-chat";

const hour = 3_600_000;
const now = Date.parse("2026-10-12T12:00:00Z");
const chest = {
  name: "chest",
  cooldownHours: 24,
  lastTrainedAt: now - 48 * hour,
  soreUntil: now + 36 * hour,
};
const coach: CoachInput = {
  now,
  localMinutes: 12 * 60,
  waterMl: 2500,
  waterGoal: 2500,
  macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  targets: {},
  mealCount: 1,
  muscles: [chest],
};

describe("sore recovery", () => {
  it("exports the extension and cap in hours", () => {
    expect([SORE_EXTEND_HOURS, SORE_MAX_HOURS]).toEqual([12, 72]);
  });

  it("extends an unfinished cooldown and measures progress from training", () => {
    expect(recovery(12 * hour, 0, 24, 48 * hour)).toEqual({
      kind: "recovering",
      fraction: 0.25,
      label: "Sore · ready in 36h 0m",
      sore: true,
    });
  });

  it("keeps a trained muscle recovering after its cooldown ends", () => {
    expect(recovery(36 * hour, 0, 24, 48 * hour)).toEqual({
      kind: "recovering",
      fraction: 0.75,
      label: "Sore · ready in 12h 0m",
      sore: true,
    });
  });

  it("marks a never-trained sore muscle as recovering with zero progress", () => {
    expect(recovery(now, null, 24, now + hour + 1)).toEqual({
      kind: "recovering",
      fraction: 0,
      label: "Sore · ready in 1h 1m",
      sore: true,
    });
  });

  it.each([null, undefined, 12 * hour, 24 * hour, 36 * hour])(
    "ignores expired or absent soreness: %s",
    (soreUntil) => {
      expect(recovery(36 * hour, 0, 24, soreUntil)).toEqual(
        recovery(36 * hour, 0, 24),
      );
      expect(recovery(36 * hour, null, 24, soreUntil)).toEqual(
        recovery(36 * hour, null, 24),
      );
    },
  );

  it.each([18, 24])(
    "keeps cooldowns that outlast soreness at %i hours",
    (end) => {
      expect(recovery(12 * hour, 0, 24, end * hour)).toEqual({
        kind: "recovering",
        fraction: 0.5,
        label: "Ready in 12h 0m",
        sore: false,
      });
    },
  );

  it("clamps soreness progress before a future workout", () => {
    expect(recovery(0, hour, 24, 48 * hour).fraction).toBe(0);
  });
});

it("forecasts sore split readiness including never-trained muscles", () => {
  const back = {
    ...chest,
    name: "back",
    lastTrainedAt: null,
    soreUntil: now + 12 * hour,
  };
  const result = forecast([chest, back], now);
  expect(result.recovering.map(({ muscle, at }) => [muscle.name, at])).toEqual([
    ["back", now + 12 * hour],
    ["chest", now + 36 * hour],
  ]);
  expect(result.next).toMatchObject({ id: "pull", at: now + 12 * hour });
  expect(forecast([{ ...back, soreUntil: now }], now).recovering).toEqual([]);
});

it("plans a sore muscle only after soreness ends and leaves inputs intact", () => {
  const muscle = { ...chest, id: "chest", current: 0 };
  const result = planWeek([muscle], { now, timeZone: "UTC" });
  expect(result.days.map((day) => day.split)).toEqual([
    null,
    null,
    "push",
    "push",
    "push",
    null,
    null,
  ]);
  expect(result.days[2].muscles).toEqual([{ id: "chest", name: "chest" }]);
  expect(muscle).toEqual({ ...chest, id: "chest", current: 0 });
});

it("chooses a ready muscle over a sore one and rests when all are sore", () => {
  const back = { ...chest, name: "back", soreUntil: null };
  expect(coachSuggestions({ ...coach, muscles: [chest, back] })).toMatchObject([
    { kind: "train", id: "train:back" },
  ]);
  expect(coachSuggestions(coach)).toMatchObject([
    { kind: "rest", id: "rest:chest" },
  ]);
  expect(
    coachSuggestions({
      ...coach,
      muscles: [{ ...chest, lastTrainedAt: null }],
    }),
  ).toMatchObject([{ kind: "rest", id: "rest:chest" }]);
});

it("snapshots soreness hours even for a never-trained muscle", () => {
  const result = buildCoachSnapshot({
    ...coach,
    timeZone: "UTC",
    water: [],
    meals: [],
    workouts: [],
    checkin: null,
    suggestions: [],
    muscles: [chest, { ...chest, name: "back", lastTrainedAt: null }],
  });
  expect(result.muscles).toEqual([
    { name: "chest", status: "recovering", hoursUntilReady: 36 },
    { name: "back", status: "recovering", hoursUntilReady: 36 },
  ]);
});

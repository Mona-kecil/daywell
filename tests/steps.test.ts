import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import { stepCount, stepGoal, stepWeek } from "../lib/steps";
import { coachSuggestions, type CoachInput } from "../lib/coach";
import { buildCoachSnapshot, type CoachSnapshotInput } from "../lib/coach-chat";
import * as cardio from "../lib/cardio";
import * as forecast from "../lib/forecast";
import * as clock from "../lib/coach-time";
import * as recovery from "../lib/recovery";

const base: CoachInput = {
  now: Date.parse("2026-10-15T12:00Z"),
  timeZone: "Asia/Jakarta",
  localMinutes: 19 * 60,
  waterMl: 2500,
  waterGoal: 2500,
  macros: { kcal: 2000, protein: 120, carbs: 200, fat: 60 },
  targets: {},
  mealCount: 1,
  muscles: [],
  steps: { today: 6150, goal: 8000, recentDays: 3 },
};
const nudge = (changes: Partial<CoachInput> = {}) =>
  coachSuggestions({ ...base, ...changes }).find((s) => s.kind === "steps");

describe("step counts and goals", () => {
  it.each([
    [0, 0],
    [-0.4, 0],
    [99999.6, 100000],
    [100000, 100000],
    [100000.4, 100000],
    [1234.5, 1235],
  ])("rounds %s to %s before checking bounds", (value, expected) => {
    expect(stepCount(value)).toBe(expected);
  });
  it.each([-1, 100000.6, NaN, Infinity, -Infinity])(
    "rejects count %s",
    (value) => expect(() => stepCount(value)).toThrow("0–100,000"),
  );
  it.each([1000, 8000, 50000])("accepts goal %s", (value) => {
    expect(stepGoal(value)).toBe(value);
  });
  it.each([999, 50001, 8000.5, NaN, Infinity])("rejects goal %s", (value) => {
    expect(() => stepGoal(value)).toThrow("integer from 1,000–50,000");
  });
});

describe("steps coach", () => {
  it.each([
    [16 * 60 + 59, false],
    [17 * 60, true],
    [21 * 60 + 59, true],
    [22 * 60, false],
  ])("checks local minute %i", (localMinutes, expected) => {
    expect(Boolean(nudge({ localMinutes }))).toBe(expected);
  });
  it.each([
    [4000, 3, true],
    [3999, 3, false],
    [8000, 3, false],
    [9000, 3, false],
    [6150, 2, false],
    [null, 7, false],
    [0, 7, false],
  ] satisfies [number | null, number, boolean][])(
    "checks today's %s steps and %s recent days",
    (today, recentDays, expected) => {
      expect(Boolean(nudge({ steps: { today, goal: 8000, recentDays } }))).toBe(
        expected,
      );
    },
  );
  it("formats thousands and uses the long-walk copy", () => {
    expect(nudge()).toEqual({
      id: "today:steps",
      kind: "steps",
      priority: 3,
      title: "1,850 steps to your goal",
      body: "A 20-minute walk is about 2,000 steps.",
    });
  });
  it.each([1, 999, 1000, 1001])(
    "chooses copy for %i remaining",
    (remaining) => {
      expect(
        nudge({ steps: { today: 8000 - remaining, goal: 8000, recentDays: 3 } })
          ?.body,
      ).toBe(
        remaining > 1000
          ? "A 20-minute walk is about 2,000 steps."
          : "A short walk after dinner gets you there.",
      );
    },
  );
  it("keeps one per kind, priority ordering and the top-three cap", () => {
    const suggestions = coachSuggestions({
      ...base,
      waterMl: 0,
      mealCount: 0,
      targets: { kcalTarget: 3000, proteinTarget: 200 },
      muscles: [{ name: "back", cooldownHours: 24, lastTrainedAt: null }],
    });
    expect(suggestions.map((s) => s.kind)).toEqual(["food", "water", "steps"]);
    expect(new Set(suggestions.map((s) => s.kind)).size).toBe(3);
  });
  it("preserves e8961e6 output bytes across 1500 generated inputs without steps", () => {
    const source = execFileSync("git", ["show", "e8961e6:lib/coach.ts"], {
      encoding: "utf8",
    });
    const code = transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS },
    }).outputText;
    const baselineModule = { exports: {} };
    const legacy: unknown = runInNewContext(
      `${code}\nmodule.exports.coachSuggestions;`,
      {
        module: baselineModule,
        exports: baselineModule.exports,
        require: (name: string) => {
          switch (name) {
            case "./cardio":
              return cardio;
            case "./forecast":
              return forecast;
            case "./coach-time":
              return clock;
            case "./recovery":
              return recovery;
            default:
              throw new Error(`Unexpected baseline import ${name}`);
          }
        },
      },
    );
    if (typeof legacy !== "function") throw new Error("Missing baseline coach");
    let state = 187;
    const random = (max: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % max;
    };
    for (let i = 0; i < 1500; i++) {
      const input: CoachInput = {
        ...base,
        steps: undefined,
        now: base.now + random(365) * 86400000,
        timeZone: ["UTC", "Asia/Jakarta", "America/Los_Angeles"][random(3)],
        localMinutes: random(1440),
        waterMl: random(4000),
        waterGoal: random(4000),
        mealCount: random(5),
        macros: {
          kcal: random(3000),
          protein: random(180),
          carbs: 100,
          fat: 40,
        },
        targets: random(2) ? {} : { kcalTarget: 2000, proteinTarget: 120 },
        habits: [{ id: "h", name: "Read", order: 0 }],
        habitLogs: random(2) ? [] : [{ habitId: "h", day: "2026-10-15" }],
        cardio: random(2)
          ? undefined
          : {
              weekActiveMinutes: random(300),
              todayMinutes: random(2) * 30,
              weekday: 1 + random(7),
            },
        readiness: random(2)
          ? undefined
          : { score: random(100), band: "easy", weakest: "sleep" },
        muscles: random(3)
          ? [
              {
                name: "back",
                cooldownHours: 24,
                lastTrainedAt: random(2)
                  ? base.now - random(72) * 3600000
                  : null,
                soreUntil: random(2) ? base.now + 3600000 : null,
              },
            ]
          : [],
      };
      expect(JSON.stringify(coachSuggestions(input)), `input ${i}`).toBe(
        JSON.stringify(legacy(input)),
      );
    }
  });
});

describe("step history math", () => {
  it("bounds a complete streak at 366 days", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      day: cardio.addDays("2026-10-15", -i),
      count: 8000,
    }));
    expect(stepWeek("2026-10-15", 8000, rows).streak).toBe(366);
    expect(stepWeek("2026-10-16", 8000, rows).streak).toBe(366);
  });
  it("keeps zero distinct from missing and excludes today from average28", () => {
    const result = stepWeek("2026-10-15", 8000, [
      { day: "2026-10-15", count: 99999 },
      { day: "2026-10-14", count: 0 },
      { day: "2026-10-13", count: 1000 },
      { day: "2026-09-17", count: 2000 },
      { day: "2026-09-16", count: 50000 },
    ]);
    expect(result.average28).toBe(1000);
    expect(result.days[2]).toEqual({ day: "2026-10-14", count: 0 });
    expect(result.days[4]).toEqual({ day: "2026-10-16", count: null });
  });
});

it("includes today's steps in chat only when the count is known, including zero", () => {
  const input: CoachSnapshotInput = {
    now: base.now,
    timeZone: "Asia/Jakarta",
    waterGoal: 2500,
    targets: {},
    water: [],
    meals: [],
    workouts: [],
    muscles: [],
    checkin: null,
    suggestions: [],
  };
  expect(buildCoachSnapshot(input).today).not.toHaveProperty("steps");
  expect(
    buildCoachSnapshot({ ...input, steps: { today: null, goal: 8000 } }).today,
  ).not.toHaveProperty("steps");
  for (const today of [0, 6150])
    expect(
      buildCoachSnapshot({ ...input, steps: { today, goal: 9000 } }).today
        .steps,
    ).toEqual({ today, goal: 9000 });
});

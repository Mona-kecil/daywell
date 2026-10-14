import { describe, expect, it } from "vitest";
import { localClock } from "../lib/coach-time";
import { MUSCLE_DEFAULTS } from "../lib/recovery";
import {
  PLAN_HOUR,
  SETS_PER_SESSION,
  planWeek,
  type PlanMuscle,
} from "../lib/week-plan";

const monday = Date.parse("2026-10-12T12:00:00Z");
const options = { now: monday, timeZone: "UTC" };
function muscle(name: string, overrides: Partial<PlanMuscle> = {}): PlanMuscle {
  return {
    id: name,
    name,
    cooldownHours: 72,
    lastTrainedAt: null,
    current: 0,
    ...overrides,
  };
}

it.each([
  ["2026-10-14T17:59:59.999Z", "2026-10-14", 5],
  ["2026-10-14T18:00:00Z", "2026-10-15", 4],
  ["2026-10-14T18:00:00.001Z", "2026-10-15", 4],
])("starts on the remaining day at %s", (at, firstDay, length) => {
  const result = planWeek([muscle("chest")], {
    ...options,
    now: Date.parse(at),
  });
  expect(result.days).toHaveLength(length);
  expect(result.days[0]).toMatchObject({
    day: firstDay,
    at: Date.parse(`${firstDay}T18:00:00Z`),
  });
  expect(result.days.at(-1)?.day).toBe("2026-10-18");
});

it("has no remaining days on Sunday evening and preserves volume totals", () => {
  expect(
    planWeek([muscle("chest", { current: 10 }), muscle("abs")], {
      ...options,
      now: Date.parse("2026-10-18T18:00:00Z"),
    }),
  ).toEqual({
    days: [],
    projected: { chest: 10, abs: 0 },
    onTarget: 1,
    total: 2,
  });
});

it("includes a Sunday session before its slot", () => {
  expect(
    planWeek([muscle("chest")], {
      ...options,
      now: Date.parse("2026-10-18T17:59:59Z"),
    }).days.map((day) => day.split),
  ).toEqual(["push"]);
});

it("rotates splits and carries cooldowns and sets into later days", () => {
  const result = planWeek(
    [muscle("chest"), muscle("back"), muscle("quads")],
    options,
  );
  expect([PLAN_HOUR, SETS_PER_SESSION]).toEqual([18, 4]);
  expect(result.days.map((day) => day.split)).toEqual([
    "push",
    "pull",
    "legs",
    "push",
    "pull",
    "legs",
    "push",
  ]);
  expect(result.projected).toEqual({ chest: 12, back: 8, quads: 8 });
  expect(result.onTarget).toBe(1);
  expect(result.total).toBe(3);
});

it("blocks a split until every present muscle reaches its cooldown boundary", () => {
  const result = planWeek(
    [
      muscle("chest", {
        lastTrainedAt: Date.parse("2026-10-11T18:00:00Z"),
      }),
      muscle("shoulders", {
        cooldownHours: 48,
        lastTrainedAt: Date.parse("2026-10-12T18:00:00Z"),
        current: 10,
      }),
    ],
    options,
  );
  expect(result.days.slice(0, 3).map((day) => day.split)).toEqual([
    null,
    null,
    "push",
  ]);
  expect(result.days[2].muscles).toEqual([
    { id: "chest", name: "chest" },
    { id: "shoulders", name: "shoulders" },
  ]);
  expect(result.days.map((day) => day.split)).toEqual([
    null,
    null,
    "push",
    null,
    null,
    "push",
    null,
  ]);
  expect(result.projected).toEqual({ chest: 8, shoulders: 18 });
});

it("picks the largest summed deficit rather than the lowest individual volume", () => {
  const result = planWeek(
    [
      muscle("chest", { current: 4 }),
      muscle("triceps", { current: 4 }),
      muscle("back"),
      muscle("quads", { current: 10 }),
    ],
    options,
  );
  expect(result.days[0].split).toBe("push");
  expect(result.days[1].split).toBe("pull");
});

it("clips deficits at zero when a split muscle exceeds the target", () => {
  expect(
    planWeek(
      [
        muscle("chest"),
        muscle("triceps", { current: 100 }),
        muscle("back", { current: 1 }),
      ],
      options,
    ).days[0].split,
  ).toBe("push");
});

it("breaks deficit ties by the oldest maximum training time", () => {
  expect(
    planWeek(
      [
        muscle("chest", {
          cooldownHours: 0,
          lastTrainedAt: Date.parse("2026-10-10T18:00:00Z"),
          current: 5,
        }),
        muscle("triceps", { current: 5 }),
        muscle("back", {
          cooldownHours: 0,
          lastTrainedAt: Date.parse("2026-10-09T18:00:00Z"),
        }),
      ],
      options,
    ).days[0].split,
  ).toBe("pull");
});

it("treats never-trained muscles as oldest, including before the Unix epoch", () => {
  expect(
    planWeek([muscle("chest", { lastTrainedAt: -1 }), muscle("back")], options)
      .days[0].split,
  ).toBe("pull");
});

it("breaks remaining ties by SPLITS order rather than input order", () => {
  expect(
    planWeek([muscle("quads"), muscle("back"), muscle("chest")], options)
      .days[0].split,
  ).toBe("push");
});

it("ignores absent split muscles and never schedules empty splits", () => {
  const result = planWeek([muscle("back", { current: 8 })], options);
  expect(result.days[0]).toMatchObject({
    split: "pull",
    muscles: [{ id: "back", name: "back" }],
    rest: null,
  });
  expect(result.days.slice(1).every((day) => day.rest === "on-target")).toBe(
    true,
  );
  expect(result.projected).toEqual({ back: 12 });
  expect(result.onTarget).toBe(1);
});

it("attaches only ready, deficient extras to session days", () => {
  const result = planWeek(
    [
      muscle("chest"),
      muscle("abs", {
        cooldownHours: 24,
        current: 6,
        lastTrainedAt: Date.parse("2026-10-12T19:00:00Z"),
      }),
      muscle("neck", { current: 10 }),
    ],
    options,
  );
  expect(
    result.days.map((day) => day.muscles.map((muscle) => muscle.id)),
  ).toEqual([["chest"], [], [], ["chest", "abs"], [], [], ["chest"]]);
  expect(result.projected).toEqual({ chest: 12, abs: 10, neck: 10 });
  expect(result.onTarget).toBe(3);
  expect(result.total).toBe(3);
});

it("does not schedule extras alone even when they are ready", () => {
  const result = planWeek([muscle("abs")], options);
  expect(result.days.map(({ rest, waiting }) => ({ rest, waiting }))).toEqual(
    Array.from({ length: 7 }, () => ({ rest: "extras", waiting: ["abs"] })),
  );
  expect(
    result.days.every((day) => day.split === null && !day.muscles.length),
  ).toBe(true);
  expect(result.projected).toEqual({ abs: 0 });
});

it("rests on target only when split muscles and extras all meet the target", () => {
  const onTarget = planWeek(
    [muscle("chest", { current: 10 }), muscle("abs", { current: 10 })],
    options,
  );
  expect(onTarget.days.every((day) => day.rest === "on-target")).toBe(true);
  const extras = planWeek(
    [
      muscle("neck", { current: 9 }),
      muscle("chest", { current: 10 }),
      muscle("abs", { current: 9 }),
      muscle("obliques", { current: 10 }),
    ],
    options,
  );
  expect(extras.days.map(({ rest, waiting }) => ({ rest, waiting }))).toEqual(
    Array.from({ length: 7 }, () => ({
      rest: "extras",
      waiting: ["neck", "abs"],
    })),
  );
});

it("rests for recovery when a deficient split is on cooldown despite deficient extras", () => {
  const result = planWeek(
    [muscle("chest", { lastTrainedAt: monday }), muscle("abs")],
    options,
  );
  expect(result.days[0]).toMatchObject({ rest: "recovering" });
  expect(result.days[0]).not.toHaveProperty("waiting");
});

it("returns an empty projected record and on-target rest for no muscles", () => {
  const result = planWeek([], options);
  expect(result.projected).toEqual({});
  expect(result.onTarget).toBe(0);
  expect(result.total).toBe(0);
  expect(result.days).toHaveLength(7);
  expect(result.days.every((day) => day.rest === "on-target")).toBe(true);
});

describe("local session slots", () => {
  it.each([
    ["2026-10-26T12:00:00Z", "2026-10-26", "2026-11-01", 22, 23],
    ["2026-03-02T12:00:00Z", "2026-03-02", "2026-03-08", 23, 22],
  ])(
    "keeps 18:00 across the DST week starting %s",
    (at, first, last, before, after) => {
      const timeZone = "America/New_York";
      const result = planWeek([muscle("chest")], {
        now: Date.parse(at),
        timeZone,
      });
      expect(result.days).toHaveLength(7);
      expect(result.days[0].day).toBe(first);
      expect(result.days.at(-1)?.day).toBe(last);
      for (const [index, day] of result.days.entries()) {
        const hour = index === 6 ? after : before;
        expect(day.at).toBe(Date.parse(`${day.day}T${hour}:00:00Z`));
        expect(localClock(day.at, timeZone)).toMatchObject({
          localDay: day.day,
          slot: "18:00",
        });
      }
    },
  );

  it("uses a local Sunday and a half-hour UTC offset", () => {
    const result = planWeek([muscle("chest")], {
      now: Date.parse("2026-10-18T12:29:59Z"),
      timeZone: "Asia/Kolkata",
    });
    expect(result.days).toHaveLength(1);
    expect(result.days[0].at).toBe(Date.parse("2026-10-18T12:30:00Z"));
    expect(
      planWeek([muscle("chest")], {
        now: Date.parse("2026-10-18T12:30:00Z"),
        timeZone: "Asia/Kolkata",
      }).days,
    ).toEqual([]);
  });
});

it("does not mutate input muscles and returns the same plan for the same inputs", () => {
  const input = MUSCLE_DEFAULTS.map((entry) => muscle(entry.name, entry));
  const original = structuredClone(input);
  input.forEach(Object.freeze);
  Object.freeze(input);
  const result = planWeek(input, options);
  expect(input).toEqual(original);
  expect(planWeek(input, options)).toEqual(result);
});

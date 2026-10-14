import { describe, expect, it } from "vitest";
import {
  VOLUME_HIGH,
  VOLUME_LOW,
  weeklyVolume,
  weekStart,
  type VolumeSet,
} from "../lib/volume";

const muscles = [
  { id: "chest", name: "Chest" },
  { id: "triceps", name: "Triceps" },
  { id: "back", name: "Back" },
];
const now = Date.parse("2026-10-14T12:00:00Z");
const options = { timeZone: "UTC", weeks: 4, now };
function set(overrides: Partial<VolumeSet> = {}): VolumeSet {
  return {
    workoutId: "workout",
    exerciseId: "bench",
    trainedAt: now,
    reps: 8,
    weightKg: 100,
    muscleIds: ["chest"],
    ...overrides,
  };
}
function countSets(count: number, overrides: Partial<VolumeSet> = {}) {
  return Array.from({ length: count }, () => set(overrides));
}

describe("local Monday boundaries", () => {
  it.each([
    ["America/Los_Angeles", "2026-10-12T06:30:00Z", "2026-10-12T07:10:00Z"],
    ["Asia/Tokyo", "2026-10-11T14:30:00Z", "2026-10-11T15:10:00Z"],
  ])(
    "separates Sunday 23:30 and Monday 00:10 in %s",
    (timeZone, sunday, monday) => {
      expect(weekStart(Date.parse(sunday), timeZone)).toBe("2026-10-05");
      expect(weekStart(Date.parse(monday), timeZone)).toBe("2026-10-12");
      const result = weeklyVolume(
        [
          set({ trainedAt: Date.parse(sunday) }),
          set({ trainedAt: Date.parse(monday) }),
        ],
        muscles,
        { timeZone, weeks: 2, now: Date.parse(monday) },
      );
      expect(result.weeks.map((week) => week.perMuscle.chest)).toEqual([1, 1]);
    },
  );

  it("keeps the DST Sunday in its week and advances at local Monday", () => {
    const timeZone = "America/Los_Angeles";
    for (const at of [
      "2025-03-09T09:30:00Z",
      "2025-03-09T10:30:00Z",
      "2025-03-10T06:30:00Z",
    ])
      expect(weekStart(Date.parse(at), timeZone)).toBe("2025-03-03");
    expect(weekStart(Date.parse("2025-03-10T07:10:00Z"), timeZone)).toBe(
      "2025-03-10",
    );
  });

  it.each([
    ["2025-03-06T03:00:00Z", "low"],
    ["2025-10-30T02:24:00Z", "on-track"],
  ])("paces by the elapsed fraction of a DST week at %s", (at, status) => {
    const atMs = Date.parse(at);
    const result = weeklyVolume(countSets(4, { trainedAt: atMs }), muscles, {
      timeZone: "America/Los_Angeles",
      weeks: 2,
      now: atMs,
    });
    expect(result.muscles[0].status).toBe(status);
  });
});

it("zero-fills every muscle and week in oldest-to-newest order", () => {
  expect(weeklyVolume([], muscles, options)).toEqual({
    weeks: ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"].map(
      (start) => ({
        start,
        perMuscle: { chest: 0, triceps: 0, back: 0 },
      }),
    ),
    muscles: muscles.map((muscle) => ({
      ...muscle,
      current: 0,
      average: 0,
      status: "none",
    })),
  });
  expect(weeklyVolume([], [], options).weeks).toHaveLength(4);
});

it("excludes warm-ups and counts back-offs at the inclusive 90% boundary", () => {
  const result = weeklyVolume(
    [20, 89.99, 90, 100].map((weightKg) => set({ weightKg })),
    muscles,
    options,
  );
  expect(result.muscles[0].current).toBe(2);
});

it("detects working sets per workout and exercise, including bodyweight sessions", () => {
  const result = weeklyVolume(
    [
      set({ weightKg: 100 }),
      set({ weightKg: 20 }),
      set({ workoutId: "second", weightKg: 20 }),
      set({ exerciseId: "push-up", weightKg: 0 }),
      set({ exerciseId: "push-up", weightKg: 0 }),
      set({ exerciseId: "weighted-dip", weightKg: 0 }),
      set({ exerciseId: "weighted-dip", weightKg: 10 }),
    ],
    muscles,
    options,
  );
  expect(result.muscles[0].current).toBe(5);
});

it("credits each listed muscle once and ignores unknown muscle IDs", () => {
  const input = [
    set({ muscleIds: ["chest", "triceps", "triceps", "deleted"] }),
  ];
  const result = weeklyVolume(input, muscles, options);
  expect(result.weeks.at(-1)?.perMuscle).toEqual({
    chest: 1,
    triceps: 1,
    back: 0,
  });
  expect(input[0].weightKg).toBe(100);
});

it.each([
  [0, "none"],
  [3, "low"],
  [4, "on-track"],
  [8, "on-track"],
  [20, "on-track"],
  [21, "high"],
])("classifies %i sets at Wednesday noon as %s", (count, status) => {
  expect([VOLUME_LOW, VOLUME_HIGH]).toEqual([10, 20]);
  expect(
    weeklyVolume(countSets(count), muscles, options).muscles[0].status,
  ).toBe(status);
});

it("counts the low threshold as on-track and uses none at Monday midnight", () => {
  const monday = Date.parse("2026-10-12T00:00:00Z");
  expect(
    weeklyVolume([], muscles, { ...options, now: monday }).muscles[0].status,
  ).toBe("none");
  const halfWeek = Date.parse("2026-10-15T12:00:00Z");
  expect(
    weeklyVolume(countSets(5), muscles, { ...options, now: halfWeek })
      .muscles[0].status,
  ).toBe("on-track");
});

it("averages complete previous weeks including zeros and excludes current and out-of-range sets", () => {
  const result = weeklyVolume(
    [
      ...countSets(2, {
        workoutId: "oldest",
        trainedAt: Date.parse("2026-09-21T00:00:00Z"),
      }),
      ...countSets(4, {
        workoutId: "previous",
        trainedAt: Date.parse("2026-10-11T23:59:59Z"),
      }),
      ...countSets(9),
      set({
        workoutId: "too-old",
        trainedAt: Date.parse("2026-09-20T23:59:59Z"),
      }),
      set({ trainedAt: now + 1, weightKg: 200 }),
      set({ trainedAt: Date.parse("2026-10-19T00:00:00Z") }),
    ],
    muscles,
    options,
  );
  expect(result.weeks.map((week) => week.perMuscle.chest)).toEqual([
    2, 0, 4, 9,
  ]);
  expect(result.muscles[0]).toMatchObject({ current: 9, average: 2 });
});

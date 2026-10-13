import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { computeAchievements } from "../lib/achievements";
import { DAY_MS, shiftDay, type HistoryInput } from "../lib/history";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-31T20:00Z");
const empty: HistoryInput = {
  now,
  timeZone: "UTC",
  waterGoal: 2500,
  muscleIds: ["a", "b"],
  workouts: [],
  sets: [],
  water: [],
  meals: [],
  checkins: [],
};
function achievement(id: string, input: Partial<HistoryInput> = {}) {
  const row = computeAchievements({ ...empty, ...input }).find(
    (a) => a.id === id,
  );
  if (!row) throw new Error("Missing achievement");
  return row;
}

describe("achievement thresholds", () => {
  it.each([
    ["first-workout", "workouts", 1],
    ["workouts-10", "workouts", 10],
    ["workouts-50", "workouts", 50],
    ["sets-100", "sets", 100],
    ["sets-1000", "sets", 1000],
    ["meals-10", "meals", 10],
  ] as const)("earns %s at the threshold", (id, field, target) => {
    const input = {
      workouts: Array.from({ length: target }, (_, i) => ({
        trainedAt: i + 1,
        muscleIds: ["a"],
      })),
      sets: Array.from({ length: target }, (_, i) => ({
        trainedAt: i + 1,
        exerciseId: "e",
        workoutId: "w",
        weightKg: 10,
        reps: 1,
      })),
      meals: Array.from({ length: target }, (_, i) => ({
        at: i + 1,
        analysis: { status: "ready" },
      })),
    };
    const before = { [field]: input[field].slice(0, target - 1) };
    expect(achievement(id, before)).toMatchObject({
      earnedAt: null,
      progress: { value: target - 1, target },
    });
    expect(achievement(id, input)).toMatchObject({
      earnedAt: target,
      progress: { value: target, target },
    });
  });

  it.each([3, 7, 30])(
    "earns a %i-day water streak and keeps a broken past streak",
    (target) => {
      const water = Array.from({ length: target }, (_, i) => ({
        at: Date.parse("2026-09-01T12:00Z") + i * DAY_MS,
        amountMl: 2500,
      }));
      expect(
        achievement(`water-streak-${target}`, { water: water.slice(0, -1) }),
      ).toMatchObject({
        earnedAt: null,
        progress: { value: target - 1, target },
      });
      expect(achievement(`water-streak-${target}`, { water })).toMatchObject({
        earnedAt: water[target - 1].at,
        progress: { value: target, target },
      });
    },
  );

  it("earns check-ins at seven nonempty days; estimates midnight UTC from the stored day", () => {
    const checkins = Array.from({ length: 7 }, (_, i) => ({
      day: shiftDay("2026-10-01", i),
      sleepHours: 0,
    }));
    expect(
      achievement("checkin-streak-7", { checkins: checkins.slice(0, 6) })
        .earnedAt,
    ).toBeNull();
    expect(achievement("checkin-streak-7", { checkins }).earnedAt).toBe(
      Date.parse("2026-10-07T00:00Z"),
    );
    expect(
      achievement("checkin-streak-7", {
        checkins: checkins.map((c) => ({ day: c.day })),
      }).progress.value,
    ).toBe(0);
  });

  it("uses previous session e1RM, excludes initial baselines, ties and future sessions", () => {
    const baseline = {
      exerciseId: "e",
      workoutId: "w1",
      trainedAt: 1,
      reps: 1,
      weightKg: 100,
    };
    const sets = [
      baseline,
      { ...baseline, weightKg: 80 },
      { ...baseline, workoutId: "w2", trainedAt: 2 },
      { ...baseline, workoutId: "w3", trainedAt: 3, weightKg: 101 },
    ];
    expect(
      achievement("first-pr", { sets: sets.slice(0, 3) }).earnedAt,
    ).toBeNull();
    expect(achievement("first-pr", { sets }).earnedAt).toBe(3);
    expect(
      achievement("first-pr", {
        sets: [...sets.slice(0, 3), { ...sets[3], trainedAt: now + 1 }],
      }).earnedAt,
    ).toBeNull();
  });

  it("requires all muscles inside seven local dates and never awards an empty muscle list", () => {
    const first = Date.parse("2026-10-01T12:00Z");
    const workouts = [
      { trainedAt: first, muscleIds: ["a"] },
      { trainedAt: first + 6 * DAY_MS, muscleIds: ["b"] },
    ];
    expect(
      achievement("all-muscles-7", { workouts: workouts.slice(0, 1) }),
    ).toMatchObject({ earnedAt: null, progress: { value: 1, target: 2 } });
    expect(achievement("all-muscles-7", { workouts }).earnedAt).toBe(
      workouts[1].trainedAt,
    );
    expect(
      achievement("all-muscles-7", {
        workouts: [
          workouts[0],
          { ...workouts[1], trainedAt: first + 7 * DAY_MS },
        ],
      }).earnedAt,
    ).toBeNull();
    expect(
      achievement("all-muscles-7", { muscleIds: [], workouts }).earnedAt,
    ).toBeNull();
  });
});

it("groups water by IANA local midnight, adds split drinks, handles DST and gaps", () => {
  const water = [
    { at: Date.parse("2026-10-01T16:59:59Z"), amountMl: 2500 },
    { at: Date.parse("2026-10-01T17:00Z"), amountMl: 1000 },
    { at: Date.parse("2026-10-02T16:59Z"), amountMl: 1500 },
    { at: Date.parse("2026-10-02T17:00Z"), amountMl: 2500 },
  ];
  expect(
    achievement("water-streak-3", { timeZone: "Asia/Jakarta", water }).earnedAt,
  ).toBe(water[3].at);
  expect(achievement("water-streak-3", { water }).earnedAt).toBeNull();
  const dst = [
    "2026-03-07T17:00Z",
    "2026-03-08T16:00Z",
    "2026-03-09T16:00Z",
  ].map((at) => ({ at: Date.parse(at), amountMl: 2500 }));
  expect(
    achievement("water-streak-3", { timeZone: "America/New_York", water: dst })
      .earnedAt,
  ).toBe(dst[2].at);
  expect(
    achievement("water-streak-3", { water: [dst[0], dst[2]] }).earnedAt,
  ).toBeNull();
});

it("keeps earned timestamps independent of now and returns stable order", () => {
  const input = {
    ...empty,
    workouts: [{ trainedAt: 1, muscleIds: ["a", "b"] }],
  };
  expect(computeAchievements(input)).toEqual(
    computeAchievements({ ...input, now: now + DAY_MS }),
  );
  expect(computeAchievements(input).map((a) => a.id)).toEqual([
    "first-workout",
    "workouts-10",
    "workouts-50",
    "sets-100",
    "sets-1000",
    "first-pr",
    "water-streak-3",
    "water-streak-7",
    "water-streak-30",
    "checkin-streak-7",
    "all-muscles-7",
    "meals-10",
  ]);
});

it("authenticates, isolates users, validates clocks, and rejects capped history", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const args = { now, timeZone: "UTC" };
  await expect(t.query(api.achievements.list, args)).rejects.toThrow("Sign in");
  await alice.mutation(api.tracker.initialize, {});
  const muscles = (await alice.query(api.tracker.overview, {})).muscles;
  await alice.mutation(api.tracker.addWorkout, {
    trainedAt: 10,
    muscleIds: [muscles[0]._id],
    note: "",
  });
  expect((await alice.query(api.achievements.list, args))[0].earnedAt).toBe(10);
  expect(
    (
      await t
        .withIdentity({ subject: "bob" })
        .query(api.achievements.list, args)
    )[0].earnedAt,
  ).toBeNull();
  await expect(
    alice.query(api.achievements.list, { ...args, now: -1 }),
  ).rejects.toThrow("Invalid timestamp.");
  await expect(
    alice.query(api.achievements.list, { ...args, now: 8_640_000_000_000_000 }),
  ).rejects.toThrow("Invalid timestamp.");
  await expect(
    alice.query(api.achievements.list, { ...args, timeZone: "bad" }),
  ).rejects.toThrow("IANA");
  await t.run(async (ctx) => {
    for (let i = 0; i < 1000; i++)
      await ctx.db.insert("workouts", {
        userId: "alice",
        trainedAt: i,
        muscleIds: [muscles[0]._id],
        note: "",
      });
  });
  await expect(alice.query(api.achievements.list, args)).rejects.toThrow(
    "History exceeds review limits.",
  );
});

import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { planWeek } from "../lib/week-plan";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-14T19:00:00Z");
function setup(at = now) {
  vi.spyOn(Date, "now").mockReturnValue(at);
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
afterEach(() => vi.restoreAllMocks());

it("requires authentication", async () => {
  const { t } = setup();
  await expect(t.query(api.plan.week, {})).rejects.toThrow("Sign in");
});

it("uses UTC when settings are absent or the time zone is unset", async () => {
  const { alice } = setup();
  const expected = planWeek([], { now, timeZone: "UTC" });
  expect(await alice.query(api.plan.week, {})).toEqual(expected);
  await alice.mutation(api.tracker.initialize, {});
  const result = await alice.query(api.plan.week, {});
  expect(result.days.map((day) => ({ day: day.day, at: day.at }))).toEqual(
    expected.days.map((day) => ({ day: day.day, at: day.at })),
  );
  expect(result.total).toBe(11);
});

it("reads the saved time zone and matches planWeek with current volume and latest training", async () => {
  const { alice } = setup();
  await alice.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setTimeZone, {
    timeZone: "America/Los_Angeles",
  });
  const muscles = (await alice.query(api.tracker.overview, {})).muscles;
  const chest = muscles.find((muscle) => muscle.name === "chest");
  const exercises = await alice.query(api.strength.exercises, {});
  const bench = exercises.find((exercise) => exercise.name === "Bench press");
  if (!chest || !bench) throw new Error("Missing defaults");
  await alice.mutation(api.strength.logSession, {
    trainedAt: Date.parse("2026-10-13T20:00:00Z"),
    note: "",
    entries: [
      {
        exerciseId: bench._id,
        sets: Array.from({ length: 7 }, () => ({ reps: 8, weightKg: 100 })),
      },
    ],
  });
  const overview = await alice.query(api.tracker.overview, {});
  const volume = await alice.query(api.volume.weekly, { weeks: 2 });
  const result = await alice.query(api.plan.week, {});
  expect(result).toEqual(
    planWeek(
      overview.muscles.map((muscle) => ({
        id: muscle._id,
        name: muscle.name,
        cooldownHours: muscle.cooldownHours,
        lastTrainedAt: muscle.lastTrainedAt,
        current:
          volume.muscles.find((entry) => entry.id === muscle._id)?.current ?? 0,
      })),
      { now, timeZone: "America/Los_Angeles" },
    ),
  );
  expect(result.days[0]).toMatchObject({
    day: "2026-10-14",
    at: Date.parse("2026-10-15T01:00:00Z"),
    split: "legs",
  });
  expect(result.days.at(-1)?.day).toBe("2026-10-18");
  expect(
    volume.muscles.find((muscle) => muscle.id === chest._id)?.current,
  ).toBe(7);
  expect(result.projected[chest._id]).toBe(11);
});

it("counts only the caller's current-week working sets and filters slack and future rows", async () => {
  const at = Date.parse("2026-10-18T12:30:00Z");
  const { t, alice, bob } = setup(at);
  await alice.mutation(api.tracker.initialize, {});
  await bob.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setTimeZone, { timeZone: "Asia/Kolkata" });
  const muscles = (await alice.query(api.tracker.overview, {})).muscles;
  const exercises = await alice.query(api.strength.exercises, {});
  const bench = exercises.find((exercise) => exercise.name === "Bench press");
  const chest = muscles.find((muscle) => muscle.name === "chest");
  const triceps = muscles.find((muscle) => muscle.name === "triceps");
  const shoulders = muscles.find((muscle) => muscle.name === "shoulders");
  const abs = muscles.find((muscle) => muscle.name === "abs");
  if (!bench || !chest || !triceps || !shoulders || !abs)
    throw new Error("Missing defaults");
  let workoutId;
  for (const trainedAt of [
    "2026-10-04T18:29:59Z", // Before the oldest local Monday, inside UTC slack.
    "2026-10-04T18:30:00Z", // Previous local Monday.
    "2026-10-11T18:29:59Z", // Previous local Sunday, in the UTC slack.
    "2026-10-11T18:30:00Z", // Current local Monday.
  ])
    workoutId = await alice.mutation(api.strength.logSession, {
      trainedAt: Date.parse(trainedAt),
      note: "",
      entries: [
        {
          exerciseId: bench._id,
          sets: [
            { reps: 10, weightKg: 20 },
            { reps: 8, weightKg: 89.99 },
            { reps: 8, weightKg: 90 },
            { reps: 8, weightKg: 100 },
          ],
        },
      ],
      extraMuscleIds: [abs._id],
    });
  if (!workoutId) throw new Error("Missing workout");
  const row = {
    userId: "alice",
    workoutId,
    exerciseId: bench._id,
    muscleIds: [chest._id],
    trainedAt: at,
    reps: 8,
    weightKg: 100,
    order: 0,
  };
  await t.run(async (ctx) => {
    await ctx.db.insert("strengthSets", { ...row, trainedAt: at + 1 });
    await ctx.db.insert("strengthSets", { ...row, userId: "bob" });
    await ctx.db.insert("workoutMuscles", {
      userId: "bob",
      workoutId: row.workoutId,
      muscleId: chest._id,
      trainedAt: at,
    });
  });
  const result = await alice.query(api.plan.week, {});
  expect(result.days).toEqual([]);
  expect(result.projected).toEqual(
    Object.fromEntries(
      muscles.map((muscle) => [
        muscle._id,
        [chest._id, triceps._id, shoulders._id].includes(muscle._id) ? 2 : 0,
      ]),
    ),
  );
  expect(result.onTarget).toBe(0);
  expect(result.total).toBe(11);
  const overview = await alice.query(api.tracker.overview, {});
  const volume = await alice.query(api.volume.weekly, { weeks: 2 });
  expect(result).toEqual(
    planWeek(
      overview.muscles.map((muscle) => ({
        id: muscle._id,
        name: muscle.name,
        cooldownHours: muscle.cooldownHours,
        lastTrainedAt: muscle.lastTrainedAt,
        current:
          volume.muscles.find((entry) => entry.id === muscle._id)?.current ?? 0,
      })),
      { now: at, timeZone: "Asia/Kolkata" },
    ),
  );
  expect(
    overview.muscles.find((muscle) => muscle._id === chest._id)?.lastTrainedAt,
  ).toBe(Date.parse("2026-10-11T18:30:00Z"));
  expect(await bob.query(api.plan.week, {})).toEqual(
    planWeek(
      (await bob.query(api.tracker.overview, {})).muscles.map((muscle) => ({
        id: muscle._id,
        name: muscle.name,
        cooldownHours: muscle.cooldownHours,
        lastTrainedAt: muscle.lastTrainedAt,
        current: 0,
      })),
      { now: at, timeZone: "UTC" },
    ),
  );
});

it("reads cooldown history before the volume window", async () => {
  const { t, alice } = setup();
  const muscleId = await t.run((ctx) =>
    ctx.db.insert("muscles", {
      userId: "alice",
      name: "chest",
      cooldownHours: 720,
    }),
  );
  const lastTrainedAt = Date.parse("2026-10-01T12:00:00Z");
  await alice.mutation(api.tracker.addWorkout, {
    trainedAt: lastTrainedAt,
    muscleIds: [muscleId],
    note: "",
  });
  const result = await alice.query(api.plan.week, {});
  expect(result).toEqual(
    planWeek(
      [
        {
          id: muscleId,
          name: "chest",
          cooldownHours: 720,
          lastTrainedAt,
          current: 0,
        },
      ],
      { now, timeZone: "UTC" },
    ),
  );
  expect(result.days.every((day) => day.rest === "recovering")).toBe(true);
});

it("accepts exactly 5,000 sets and rejects overflow instead of truncating", async () => {
  const { t, alice } = setup();
  const row = await t.run(async (ctx) => {
    const muscleId = await ctx.db.insert("muscles", {
      userId: "alice",
      name: "chest",
      cooldownHours: 48,
    });
    const exerciseId = await ctx.db.insert("exercises", {
      userId: "alice",
      name: "Push-up",
      muscleIds: [muscleId],
      custom: true,
    });
    const workoutId = await ctx.db.insert("workouts", {
      userId: "alice",
      trainedAt: now,
      muscleIds: [muscleId],
      note: "",
    });
    const row = {
      userId: "alice",
      exerciseId,
      workoutId,
      muscleIds: [muscleId],
      trainedAt: now,
      reps: 8,
      weightKg: 0,
      order: 0,
    };
    for (let order = 0; order < 5000; order++)
      await ctx.db.insert("strengthSets", { ...row, order });
    return row;
  });
  const result = await alice.query(api.plan.week, {});
  expect(result.projected).toEqual({ [row.muscleIds[0]]: 5000 });
  expect(result.onTarget).toBe(1);
  await t.run((ctx) => ctx.db.insert("strengthSets", { ...row, order: 5000 }));
  await expect(alice.query(api.plan.week, {})).rejects.toThrow(
    "Weekly volume exceeds the 5,000-set limit.",
  );
});

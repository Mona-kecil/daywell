import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-14T19:00:00Z");
function setup() {
  vi.spyOn(Date, "now").mockReturnValue(now);
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
  await expect(t.query(api.volume.weekly, { weeks: 4 })).rejects.toThrow(
    "Sign in",
  );
});

it("validates integer weeks from 2–12 and accepts both endpoints", async () => {
  const { alice } = setup();
  for (const weeks of [1, 13, 0, -2, 2.5, NaN, Infinity, -Infinity])
    await expect(alice.query(api.volume.weekly, { weeks })).rejects.toThrow(
      "Weeks must be an integer from 2–12.",
    );
  for (const weeks of [2, 12]) {
    const result = await alice.query(api.volume.weekly, { weeks });
    expect(result.weeks).toHaveLength(weeks);
    expect(result.weeks.at(-1)).toEqual({ start: "2026-10-12", perMuscle: {} });
    expect(result.muscles).toEqual([]);
  }
});

it("reads the saved zone, filters slack and future sets, and returns working volume for the caller", async () => {
  const { t, alice, bob } = setup();
  await alice.mutation(api.tracker.initialize, {});
  await bob.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setTimeZone, { timeZone: "Asia/Tokyo" });
  const muscles = (await alice.query(api.tracker.overview, {})).muscles;
  const exercises = await alice.query(api.strength.exercises, {});
  const bench = exercises.find((exercise) => exercise.name === "Bench press");
  const pushup = exercises.find((exercise) => exercise.name === "Push-up");
  const chest = muscles.find((muscle) => muscle.name === "chest");
  const triceps = muscles.find((muscle) => muscle.name === "triceps");
  const abs = muscles.find((muscle) => muscle.name === "abs");
  if (!bench || !pushup || !chest || !triceps || !abs)
    throw new Error("Missing defaults");
  for (const trainedAt of [
    "2026-10-04T14:59:59Z", // Sunday before the oldest Monday in Tokyo.
    "2026-10-04T15:00:00Z", // Oldest Monday, before its UTC date starts.
    "2026-10-11T14:30:00Z", // Previous Sunday 23:30.
    "2026-10-11T15:10:00Z", // Current Monday 00:10.
    "2026-10-14T19:00:01Z", // Future, even though it has today's local date.
  ])
    await alice.mutation(api.strength.logSession, {
      trainedAt: Date.parse(trainedAt),
      note: "",
      entries: [
        {
          exerciseId: bench._id,
          sets: [
            { reps: 10, weightKg: 20 },
            { reps: 8, weightKg: 90 },
            { reps: 8, weightKg: 100 },
          ],
        },
      ],
      extraMuscleIds: [abs._id],
    });
  const workoutId = await alice.mutation(api.strength.logSession, {
    trainedAt: now,
    note: "",
    entries: [{ exerciseId: pushup._id, sets: [{ reps: 10, weightKg: 0 }] }],
  });
  await t.run((ctx) =>
    ctx.db.insert("strengthSets", {
      userId: "bob",
      workoutId,
      exerciseId: pushup._id,
      muscleIds: [chest._id],
      trainedAt: now,
      reps: 8,
      weightKg: 100,
      order: 0,
    }),
  );
  const result = await alice.query(api.volume.weekly, { weeks: 2 });
  expect(result.weeks.map((week) => week.start)).toEqual([
    "2026-10-05",
    "2026-10-12",
  ]);
  expect(result.weeks.map((week) => week.perMuscle[chest._id])).toEqual([4, 3]);
  expect(result.muscles.find((muscle) => muscle.id === chest._id)).toEqual({
    id: chest._id,
    name: "chest",
    current: 3,
    average: 4,
    status: "low",
  });
  expect(
    result.muscles.find((muscle) => muscle.id === triceps._id),
  ).toMatchObject({ current: 3, average: 4 });
  expect(result.muscles.find((muscle) => muscle.id === abs._id)).toMatchObject({
    current: 0,
    average: 0,
    status: "none",
  });
  const theirs = await bob.query(api.volume.weekly, { weeks: 2 });
  expect(theirs.muscles).toHaveLength(11);
  expect(
    theirs.muscles.every(
      (muscle) => muscle.current === 0 && muscle.average === 0,
    ),
  ).toBe(true);
  expect(
    theirs.weeks.every((week) =>
      Object.values(week.perMuscle).every((count) => count === 0),
    ),
  ).toBe(true);
});

it("returns exactly 5,000 sets and rejects overflow rather than truncating", async () => {
  const { t, alice } = setup();
  const row = await t.run(async (ctx) => {
    const muscleId = await ctx.db.insert("muscles", {
      userId: "alice",
      name: "Chest",
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
  expect(
    (await alice.query(api.volume.weekly, { weeks: 2 })).muscles[0].current,
  ).toBe(5000);
  await t.run((ctx) => ctx.db.insert("strengthSets", { ...row, order: 5000 }));
  await expect(alice.query(api.volume.weekly, { weeks: 2 })).rejects.toThrow(
    "Weekly volume exceeds the 5,000-set limit.",
  );
});

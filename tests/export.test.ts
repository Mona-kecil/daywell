import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import type { MealItem } from "../lib/nutrients";
import { api } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.{ts,js}");

it("exports every owned category with sets and nutrition, without photos or bookkeeping", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  await alice.mutation(api.tracker.initialize, {});
  await bob.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setTargets, {
    kcalTarget: 2100,
    proteinTarget: 130,
  });
  await alice.mutation(api.coach.setTimeZone, { timeZone: "Asia/Jakarta" });
  const muscles = (await alice.query(api.tracker.overview, {})).muscles;
  const custom = await alice.mutation(api.strength.addExercise, {
    name: "Alice press",
    muscleIds: [muscles[0]._id],
  });
  const bench = (await alice.query(api.strength.exercises, {})).find(
    (e) => e.name === "Bench press",
  );
  if (!bench) throw new Error("Missing bench");
  const workoutId = await alice.mutation(api.strength.logSession, {
    trainedAt: 200,
    note: "Alice workout",
    entries: [
      { exerciseId: bench._id, sets: [{ reps: 8, weightKg: 60 }] },
      { exerciseId: custom, sets: [{ reps: 10, weightKg: 30 }] },
    ],
  });
  const plain = await alice.mutation(api.tracker.addWorkout, {
    trainedAt: 100,
    note: "Plain workout",
    muscleIds: [muscles[0]._id],
  });
  await alice.mutation(api.tracker.addWater, { amountMl: 250, at: 100 });
  await alice.mutation(api.checkins.upsert, {
    day: "2026-10-14",
    weightKg: 75,
    sleepHours: 7.25,
    mood: 4,
    energy: 3,
    note: "Alice check-in",
  });
  const item = {
    id: "rice",
    name: "Rice",
    grams: 200,
    searchQuery: "rice",
    status: "matched",
    fdcId: 1,
    foodDescription: "Cooked rice",
    per100g: { kcal: 130, protein: 2, carbs: 28, fat: 0.3 },
  } satisfies MealItem;
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["private-photo"]));
    for (const userId of ["alice", "bob"]) {
      await ctx.db.insert("meals", {
        userId,
        storageId,
        at: 200,
        description: `${userId} meal`,
        items: [item],
        revision: 9876,
        analysis: { status: "ready" },
      });
      await ctx.db.insert("pushSubscriptions", {
        userId,
        endpoint: `https://private-push.example/${userId}`,
        keys: { p256dh: "private-key", auth: "private-key" },
        createdAt: 1,
      });
      await ctx.db.insert("uploads", {
        userId,
        sha256: "private-digest",
        expiresAt: 100,
      });
    }
    await ctx.db.insert("meals", {
      userId: "alice",
      storageId,
      at: 300,
      description: "Retry meal",
      items: [],
      revision: 9876,
      analysis: { status: "error", message: "Search failed" },
    });
  });
  await bob.mutation(api.checkins.upsert, {
    day: "2026-10-14",
    note: "Bob check-in",
  });
  await bob.mutation(api.tracker.addWater, { amountMl: 999, at: 400 });
  const bobMuscles = (await bob.query(api.tracker.overview, {})).muscles;
  const bobCustom = await bob.mutation(api.strength.addExercise, {
    name: "Bob exercise",
    muscleIds: [bobMuscles[0]._id],
  });
  await bob.mutation(api.strength.logSession, {
    trainedAt: 400,
    note: "Bob workout",
    entries: [{ exerciseId: bobCustom, sets: [{ reps: 2, weightKg: 90 }] }],
  });

  const before = Date.now();
  const data = await alice.query(api.exportData.all, {});
  expect(data.version).toBe(1);
  expect(data.exportedAt).toBeGreaterThanOrEqual(before);
  expect(data.exportedAt).toBeLessThanOrEqual(Date.now());
  expect(data.settings).toMatchObject({
    waterGoal: 2500,
    kcalTarget: 2100,
    proteinTarget: 130,
    timeZone: "Asia/Jakarta",
  });
  expect(data.muscles).toHaveLength(11);
  expect(data.workouts.map((w) => w.id)).toEqual([plain, workoutId]);
  expect(data.workouts[0].sets).toEqual([]);
  expect(data.workouts[1].sets).toMatchObject([
    {
      exerciseId: bench._id,
      exerciseName: "Bench press",
      reps: 8,
      weightKg: 60,
      order: 0,
    },
    {
      exerciseId: custom,
      exerciseName: "Alice press",
      muscleIds: [muscles[0]._id],
      reps: 10,
      weightKg: 30,
      order: 1,
    },
  ]);
  expect(data.exercises).toEqual([
    { id: custom, name: "Alice press", muscleIds: [muscles[0]._id] },
  ]);
  expect(data.water).toMatchObject([{ at: 100, amountMl: 250 }]);
  expect(data.meals).toMatchObject([
    {
      at: 200,
      description: "alice meal",
      items: [item],
      status: "ready",
      totals: { kcal: 260, protein: 4, carbs: 56, fat: 0.6 },
    },
    {
      at: 300,
      status: "error",
      error: "Search failed",
      totals: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    },
  ]);
  expect(data.checkins).toMatchObject([
    {
      day: "2026-10-14",
      weightKg: 75,
      sleepHours: 7.25,
      mood: 4,
      energy: 3,
      note: "Alice check-in",
    },
  ]);
  const json = JSON.stringify(data);
  for (const privateField of [
    "storageId",
    "photoUrl",
    "revision",
    "startedAt",
    "userId",
    "_creationTime",
    "pushSubscriptions",
    "private-push",
    "private-key",
    "private-digest",
    "coachSent",
    "coachRuns",
    "pushDeliveries",
    "Bob",
  ])
    expect(json).not.toContain(privateField);
  expect(JSON.parse(json)).toEqual(data);
  const theirs = await bob.query(api.exportData.all, {});
  expect(theirs.workouts).toHaveLength(1);
  expect(theirs.water[0].amountMl).toBe(999);
  expect(JSON.stringify(theirs)).not.toContain("Alice");
  await alice.mutation(api.tracker.deleteWorkout, { id: workoutId });
  expect((await alice.query(api.exportData.all, {})).workouts).toMatchObject([
    { id: plain, sets: [] },
  ]);
});

it("requires auth and exports an empty account without requiring initialization", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.exportData.all, {})).rejects.toThrow("Sign in");
  const data = await t
    .withIdentity({ subject: "new" })
    .query(api.exportData.all, {});
  expect(data).toEqual({
    version: 1,
    exportedAt: expect.any(Number),
    settings: null,
    muscles: [],
    workouts: [],
    exercises: [],
    water: [],
    caffeine: [],
    cardioSessions: [],
    steps: [],
    habits: [],
    habitLogs: [],
    meals: [],
    progressPhotos: [],
    checkins: [],
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";
import type { LiftSession } from "../lib/trends";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const NOW = Date.parse("2026-10-14T19:00:00Z");
const DAY = 86_400_000;
const WEEK = 7 * DAY;

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

afterEach(() => vi.unstubAllEnvs());

async function seedLift(
  t: ReturnType<typeof setup>["t"],
  name: string,
  sessions: LiftSession[],
  userId = "alice",
) {
  return t.run(async (ctx) => {
    const exerciseId = await ctx.db.insert("exercises", {
      userId,
      name,
      muscleIds: [],
      custom: true,
    });
    for (const session of sessions) {
      const workoutId = await ctx.db.insert("workouts", {
        userId,
        trainedAt: session.trainedAt,
        muscleIds: [],
        note: "",
      });
      for (const [order, set] of session.sets.entries())
        await ctx.db.insert("strengthSets", {
          userId,
          exerciseId,
          workoutId,
          muscleIds: [],
          trainedAt: session.trainedAt,
          ...set,
          order,
        });
    }
    return exerciseId;
  });
}

function weekly(values: number[], lastAt = NOW): LiftSession[] {
  return values.map((value, index) => ({
    trainedAt: lastAt - (values.length - index - 1) * WEEK,
    sets: [{ reps: 1, weightKg: value }],
  }));
}

it("requires authentication", async () => {
  const { t } = setup();
  await expect(t.query(api.trends.list, { now: NOW })).rejects.toThrow(
    "Sign in to continue.",
  );
});

it.each([-1, NaN, Infinity, -Infinity, 8_640_000_000_000_001])(
  "rejects invalid now=%s",
  async (now) => {
    const { alice } = setup();
    await expect(alice.query(api.trends.list, { now })).rejects.toThrow(
      "Invalid timestamp.",
    );
  },
);

it("accepts timestamp endpoints and returns no lifts without strength sessions", async () => {
  const { t, alice } = setup();
  await seedLift(t, "Unused", []);
  for (const now of [0, NOW, 8_640_000_000_000_000])
    expect(await alice.query(api.trends.list, { now })).toEqual({ lifts: [] });
});

it("groups all sets by workout and exercise, keeping distinct workouts at the same time", async () => {
  const { alice } = setup();
  await alice.mutation(api.tracker.initialize, {});
  const exercises = await alice.query(api.strength.exercises, {});
  const bench = exercises.find((exercise) => exercise.name === "Bench press");
  const pushup = exercises.find((exercise) => exercise.name === "Push-up");
  if (!bench || !pushup) throw new Error("Missing default exercises");
  await alice.mutation(api.strength.logSession, {
    trainedAt: NOW - WEEK,
    note: "",
    entries: [
      {
        exerciseId: bench._id,
        sets: [
          { reps: 1, weightKg: 100 },
          { reps: 60, weightKg: 40 },
        ],
      },
      {
        exerciseId: pushup._id,
        sets: [
          { reps: 10, weightKg: 0 },
          { reps: 12, weightKg: 0 },
        ],
      },
    ],
  });
  for (const weightKg of [110, 115])
    await alice.mutation(api.strength.logSession, {
      trainedAt: NOW,
      note: "",
      entries: [{ exerciseId: bench._id, sets: [{ reps: 1, weightKg }] }],
    });
  const { lifts } = await alice.query(api.trends.list, { now: NOW });
  expect(lifts).toHaveLength(2);
  const result = lifts.find((lift) => lift.id === bench._id);
  expect(result).toMatchObject({
    id: bench._id,
    name: "Bench press",
    unit: "kg",
    best: 120,
    bestAt: NOW - WEEK,
    sessionsSinceBest: 2,
    lastAt: NOW,
  });
  expect(
    result?.points.map((point) => point.value).sort((a, b) => a - b),
  ).toEqual([110, 115, 120]);
  expect(result?.points.map((point) => point.at)).toEqual([
    NOW - WEEK,
    NOW,
    NOW,
  ]);
  expect(lifts.find((lift) => lift.id === pushup._id)).toMatchObject({
    unit: "reps",
    points: [{ at: NOW - WEEK, value: 12 }],
    status: "early",
  });
});

it("excludes deleted exercises even when their strength sets remain", async () => {
  const { t, alice } = setup();
  const deleted = await seedLift(t, "Deleted", weekly([100]));
  const kept = await seedLift(t, "Kept", weekly([90]));
  await t.run((ctx) => ctx.db.delete(deleted));
  expect(
    (await alice.query(api.trends.list, { now: NOW })).lifts.map(
      (lift) => lift.id,
    ),
  ).toEqual([kept]);
});

it("sorts all statuses in priority order and each group by last session descending", async () => {
  const { t, alice } = setup();
  const cases = [
    { status: "lapsed", values: [100], lastAt: NOW - 22 * DAY },
    { status: "early", values: [100, 100], lastAt: NOW },
    { status: "steady", values: [100, 100, 100], lastAt: NOW },
    { status: "climbing", values: [80, 90, 100], lastAt: NOW },
    { status: "slipping", values: [100, 90, 80], lastAt: NOW },
    { status: "stalled", values: [100, 100, 100, 100, 100], lastAt: NOW },
  ];
  for (const { status, values, lastAt } of cases) {
    await seedLift(t, `${status} older`, weekly(values, lastAt - DAY));
    await seedLift(t, `${status} newer`, weekly(values, lastAt));
  }
  const result = await alice.query(api.trends.list, { now: NOW });
  expect(result.lifts.map((lift) => [lift.name, lift.status])).toEqual([
    ["stalled newer", "stalled"],
    ["stalled older", "stalled"],
    ["slipping newer", "slipping"],
    ["slipping older", "slipping"],
    ["climbing newer", "climbing"],
    ["climbing older", "climbing"],
    ["steady newer", "steady"],
    ["steady older", "steady"],
    ["early newer", "early"],
    ["early older", "early"],
    ["lapsed newer", "lapsed"],
    ["lapsed older", "lapsed"],
  ]);
});

it("excludes other users' sets and exercises, including foreign references", async () => {
  const { t, alice, bob } = setup();
  const own = await seedLift(t, "Alice", weekly([100]));
  const foreign = await seedLift(t, "Bob", weekly([200]), "bob");
  await t.run(async (ctx) => {
    const workoutId = await ctx.db.insert("workouts", {
      userId: "bob",
      trainedAt: NOW,
      note: "",
      muscleIds: [],
    });
    const set = {
      workoutId,
      trainedAt: NOW,
      muscleIds: [],
      reps: 1,
      weightKg: 999,
      order: 0,
    };
    await ctx.db.insert("strengthSets", {
      ...set,
      userId: "bob",
      exerciseId: own,
    });
    await ctx.db.insert("strengthSets", {
      ...set,
      userId: "alice",
      exerciseId: foreign,
    });
  });
  expect(
    (await alice.query(api.trends.list, { now: NOW })).lifts,
  ).toMatchObject([
    { id: own, name: "Alice", best: 100, points: [{ at: NOW, value: 100 }] },
  ]);
  expect((await bob.query(api.trends.list, { now: NOW })).lifts).toMatchObject([
    { id: foreign, name: "Bob", best: 200, points: [{ at: NOW, value: 200 }] },
  ]);
});

it("uses the supplied now for window cutoffs, lapsed status, and future exclusion", async () => {
  const { t, alice } = setup();
  const start = NOW - 8 * WEEK;
  await seedLift(
    t,
    "Bench",
    [
      { trainedAt: start - 1, sets: [{ reps: 1, weightKg: 200 }] },
      { trainedAt: start, sets: [{ reps: 1, weightKg: 100 }] },
      { trainedAt: NOW, sets: [{ reps: 1, weightKg: 110 }] },
      { trainedAt: NOW + 1, sets: [{ reps: 1, weightKg: 300 }] },
    ].reverse(),
  );
  expect(
    (await alice.query(api.trends.list, { now: NOW })).lifts,
  ).toMatchObject([
    {
      status: "early",
      best: 200,
      bestAt: start - 1,
      sessionsSinceBest: 2,
      points: [
        { at: start, value: 100 },
        { at: NOW, value: 110 },
      ],
      lastAt: NOW,
    },
  ]);
  expect(
    (await alice.query(api.trends.list, { now: NOW + 22 * DAY })).lifts,
  ).toMatchObject([
    {
      status: "lapsed",
      best: 300,
      lastAt: NOW + 1,
    },
  ]);
});

it("bounds history to the latest 5,000 rows without future rows displacing them", async () => {
  const { t, alice } = setup();
  const id = await seedLift(t, "Bench", weekly([200, 100]));
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("strengthSets")
      .withIndex("by_user_exercise_time", (q) =>
        q.eq("userId", "alice").eq("exerciseId", id),
      )
      .collect();
    const latest = rows.at(-1);
    if (!latest) throw new Error("Missing fixture set");
    const {
      userId,
      exerciseId,
      workoutId,
      muscleIds,
      trainedAt,
      reps,
      weightKg,
    } = latest;
    const row = {
      userId,
      exerciseId,
      workoutId,
      muscleIds,
      trainedAt,
      reps,
      weightKg,
    };
    for (let order = 1; order < 5000; order++)
      await ctx.db.insert("strengthSets", { ...row, order });
    await ctx.db.insert("strengthSets", {
      ...row,
      trainedAt: NOW + 1,
      weightKg: 999,
      order: 5000,
    });
  });
  expect(
    (await alice.query(api.trends.list, { now: NOW })).lifts,
  ).toMatchObject([
    {
      id,
      best: 100,
      bestAt: NOW,
      sessionsSinceBest: 0,
      points: [{ at: NOW, value: 100 }],
    },
  ]);
});

it("seeds a stalled Crunch and climbing Bench press with deterministic demo history", async () => {
  const { t } = setup();
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  vi.stubEnv("DEV_AUTH_JWKS", "test-jwks");
  const demo = t.withIdentity({ subject: DEV_USER, issuer: DEV_ISSUER });
  const args = {
    now: NOW,
    days: Array.from({ length: 14 }, (_, i) => NOW - i * DAY),
    meals: [],
  };
  for (let run = 0; run < 2; run++) {
    await demo.mutation(internal.demo.replace, args);
    const { lifts } = await demo.query(api.trends.list, { now: NOW });
    expect(lifts.find((lift) => lift.name === "Crunch")).toMatchObject({
      status: "stalled",
      unit: "reps",
      best: 10,
      sessionsSinceBest: 4,
    });
    expect(lifts.find((lift) => lift.name === "Bench press")).toMatchObject({
      status: "climbing",
      unit: "kg",
      sessionsSinceBest: 0,
    });
  }
});

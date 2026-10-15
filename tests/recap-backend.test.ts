import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-15T12:00Z");
const args = { month: "2026-10", now, timeZone: "UTC" };
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
afterEach(() => vi.useRealTimers());

it("requires authentication", async () => {
  const { t } = setup();
  await expect(t.query(api.recap.month, args)).rejects.toThrow(
    "Sign in to continue.",
  );
});
it.each(["2026-11", "2026-13", "2026-1", "2026-10-01", "bad"])(
  "rejects future or malformed month %s",
  async (month) => {
    const { alice } = setup();
    await expect(
      alice.query(api.recap.month, { ...args, month }),
    ).rejects.toThrow("Choose a month up to this one.");
  },
);
it("validates the supplied clock", async () => {
  const { alice } = setup();
  await expect(
    alice.query(api.recap.month, { ...args, now: -1 }),
  ).rejects.toThrow("Invalid timestamp.");
  await expect(
    alice.query(api.recap.month, { ...args, timeZone: "bad" }),
  ).rejects.toThrow("Choose a valid IANA time zone.");
});

it("returns a seeded story, retains old PR/trend baselines, excludes future data and isolates users", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now - 1);
  const { t, alice, bob } = setup();
  await t.run(async (ctx) => {
    const userId = "alice";
    await ctx.db.insert("settings", { userId, waterGoal: 2000 });
    const muscleId = await ctx.db.insert("muscles", {
      userId,
      name: "Back",
      cooldownHours: 48,
    });
    const exerciseId = await ctx.db.insert("exercises", {
      userId,
      name: "Row",
      muscleIds: [muscleId],
      custom: true,
    });
    for (const [day, weightKg] of [
      ["2020-01-01", 100],
      ["2026-09-01", 100],
      ["2026-10-01", 110],
      ["2026-10-02", 120],
      ["2026-11-01", 999],
    ] as const) {
      const trainedAt = Date.parse(`${day}T12:00Z`);
      const workoutId = await ctx.db.insert("workouts", {
        userId,
        trainedAt,
        muscleIds: [muscleId],
        note: "",
      });
      await ctx.db.insert("strengthSets", {
        userId,
        workoutId,
        exerciseId,
        muscleIds: [muscleId],
        trainedAt,
        reps: 1,
        weightKg,
        order: 0,
      });
    }
    for (const [day, weightKg] of [
      ["2026-08-01", 80],
      ["2026-10-02", 70],
      ["2026-10-10", 69],
      ["2026-11-01", 30],
    ] as const)
      await ctx.db.insert("bodyCheckins", {
        userId,
        day,
        weightKg,
        sleepHours: 8,
      });
    await ctx.db.insert("bodyCheckins", {
      userId,
      day: "2026-10-11",
      note: " ",
    });
    for (const day of ["2026-09-30", "2026-10-02", "2026-11-01"])
      await ctx.db.insert("cardioSessions", {
        userId,
        day,
        kind: "run",
        effort: "hard",
        minutes: 20.1,
        distanceKm: 3.24,
        createdAt: now - 1,
      });
    await ctx.db.insert("cardioSessions", {
      userId,
      day: "2026-10-11",
      kind: "run",
      effort: "hard",
      minutes: 100,
      createdAt: now + 1,
    });
    await ctx.db.insert("water", {
      userId,
      at: Date.parse("2026-10-03T12:00Z"),
      amountMl: 2000,
    });
    await ctx.db.insert("water", { userId, at: now + 1, amountMl: 9999 });
    for (const status of ["ready", "analyzing"] as const)
      await ctx.db.insert("meals", {
        userId,
        at: Date.parse(`2026-10-0${status === "ready" ? 4 : 5}T12:00Z`),
        description: "",
        items: [],
        revision: 0,
        analysis: status === "ready" ? { status } : { status, startedAt: now },
      });
    const habitId = await ctx.db.insert("habits", {
      userId,
      name: "Read",
      icon: "book",
      order: 0,
      createdAt: Date.parse("2026-10-05T12:00Z"),
    });
    await ctx.db.insert("habitLogs", { userId, habitId, day: "2026-10-06" });
    await ctx.db.insert("habitLogs", { userId, habitId, day: "2026-11-01" });
    await ctx.db.insert("workouts", {
      userId: "bob",
      trainedAt: now,
      muscleIds: [],
      note: "",
    });
  });
  expect(await alice.query(api.recap.month, args)).toEqual({
    month: "2026-10",
    fromDay: "2026-10-01",
    toDay: "2026-10-15",
    days: 15,
    daysLogged: 6,
    workouts: 2,
    totalSets: 2,
    volumeKg: 230,
    newPRs: 2,
    topMuscles: [{ name: "Back", workouts: 2 }],
    cardio: {
      sessions: 1,
      minutes: 20.1,
      activeMinutes: 40.2,
      distanceKm: 3.2,
      topKind: "run",
    },
    weight: { startKg: 80, endKg: 78, changeKg: -2 },
    habits: { done: 1, possible: 11 },
    water: { avgMl: 133, goalMl: 2000, daysAtGoal: 1 },
    sleep: { avgHours: 8, days: 2 },
    best: { day: "2026-10-02", reason: "workout+cardio" },
    previous: { workouts: 1, cardioActiveMinutes: 40.2, daysLogged: 2 },
  });
  expect(await bob.query(api.recap.month, args)).toMatchObject({
    workouts: 1,
    totalSets: 0,
    daysLogged: 1,
    water: { goalMl: 2500 },
    habits: null,
  });
});

it("pads timestamp ranges then filters by local day at both month boundaries", async () => {
  const { t, alice } = setup();
  await t.run(async (ctx) => {
    for (const trainedAt of [
      "2026-10-01T06:30Z",
      "2026-09-01T06:30Z",
      "2026-08-01T06:30Z",
      "2026-10-01T07:00Z",
    ])
      await ctx.db.insert("workouts", {
        userId: "alice",
        trainedAt: Date.parse(trainedAt),
        muscleIds: [],
        note: "",
      });
  });
  expect(
    await alice.query(api.recap.month, {
      ...args,
      month: "2026-09",
      timeZone: "America/Los_Angeles",
    }),
  ).toMatchObject({
    workouts: 1,
    daysLogged: 1,
    best: { day: "2026-09-30", reason: "workout" },
    previous: { workouts: 1, daysLogged: 1 },
  });
});

it("accepts the workout limit, then throws instead of truncating at limit+1", async () => {
  const { t, alice } = setup();
  await t.run(async (ctx) => {
    for (let i = 0; i < 1000; i++)
      await ctx.db.insert("workouts", {
        userId: "alice",
        trainedAt: now - i,
        muscleIds: [],
        note: "",
      });
  });
  expect((await alice.query(api.recap.month, args)).workouts).toBe(1000);
  await t.run((ctx) =>
    ctx.db.insert("workouts", {
      userId: "alice",
      trainedAt: now,
      muscleIds: [],
      note: "",
    }),
  );
  await expect(alice.query(api.recap.month, args)).rejects.toThrow(
    "History exceeds recap limits.",
  );
});

it.each([
  ["strengthSets", 5000],
  ["water", 10000],
  ["meals", 3000],
  ["bodyCheckins", 1000],
  ["cardioSessions", 3100],
  ["habits", 1000],
  ["habitLogs", 10000],
  ["muscles", 11],
  ["settings", 1],
] as const)("rejects %s history over %i rows", async (table, limit) => {
  vi.useFakeTimers();
  vi.setSystemTime(now - 60_000);
  const { t, alice } = setup();
  await t.run(async (ctx) => {
    const userId = "alice";
    const muscleId = await ctx.db.insert("muscles", {
      userId,
      name: "Back",
      cooldownHours: 48,
    });
    const workoutId = await ctx.db.insert("workouts", {
      userId,
      trainedAt: now,
      muscleIds: [muscleId],
      note: "",
    });
    const exerciseId = await ctx.db.insert("exercises", {
      userId,
      name: "Row",
      muscleIds: [muscleId],
      custom: true,
    });
    const habitId = await ctx.db.insert("habits", {
      userId,
      name: "Read",
      icon: "book",
      order: 0,
      createdAt: now,
    });
    const count = table === "habits" || table === "muscles" ? limit : limit + 1;
    for (let i = 0; i < count; i++) {
      switch (table) {
        case "strengthSets":
          await ctx.db.insert(table, {
            userId,
            workoutId,
            exerciseId,
            trainedAt: now,
            muscleIds: [muscleId],
            reps: 1,
            weightKg: 100,
            order: i,
          });
          break;
        case "water":
          await ctx.db.insert(table, { userId, at: now, amountMl: 1 });
          break;
        case "meals":
          await ctx.db.insert(table, {
            userId,
            at: now,
            description: "",
            items: [],
            revision: 0,
            analysis: { status: "ready" },
          });
          break;
        case "bodyCheckins":
          await ctx.db.insert(table, { userId, day: "2026-10-01", mood: 3 });
          break;
        case "cardioSessions":
          await ctx.db.insert(table, {
            userId,
            day: "2026-10-01",
            kind: "walk",
            effort: "easy",
            minutes: 1,
            createdAt: now,
          });
          break;
        case "habits":
          await ctx.db.insert(table, {
            userId,
            name: "Read",
            icon: "book",
            order: i,
            createdAt: now,
          });
          break;
        case "habitLogs":
          await ctx.db.insert(table, { userId, habitId, day: "2026-10-01" });
          break;
        case "muscles":
          await ctx.db.insert(table, {
            userId,
            name: "Back",
            cooldownHours: 48,
          });
          break;
        case "settings":
          await ctx.db.insert(table, { userId, waterGoal: 2500 });
          break;
        default: {
          const exhaustive: never = table;
          throw new Error(`Unexpected table: ${exhaustive}`);
        }
      }
    }
  });
  await expect(alice.query(api.recap.month, args)).rejects.toThrow(
    "History exceeds recap limits.",
  );
});

it("uses a backfill before the previous month for habit opportunities", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now - 60_000);
  const { t, alice } = setup();
  await t.run(async (ctx) => {
    const userId = "alice";
    const habitId = await ctx.db.insert("habits", {
      userId,
      name: "Read",
      icon: "book",
      order: 0,
      createdAt: Date.parse("2026-10-10T12:00Z"),
    });
    await ctx.db.insert("habitLogs", { userId, habitId, day: "2020-01-01" });
  });
  expect((await alice.query(api.recap.month, args)).habits).toEqual({
    done: 0,
    possible: 15,
  });
});

it("accepts year 0000 rather than rejecting a month allowed by the contract", async () => {
  const { alice } = setup();
  expect(
    await alice.query(api.recap.month, { ...args, month: "0000-01" }),
  ).toMatchObject({ fromDay: "0000-01-01", toDay: "0000-01-31", days: 31 });
});

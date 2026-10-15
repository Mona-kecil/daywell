import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import type { MutationCtx } from "../convex/_generated/server";
import type { TableNames } from "../convex/_generated/dataModel";
import { loadReadiness, READINESS_LIMIT_MESSAGE } from "../convex/readiness";
import { readinessForCoach, suggestionsFor } from "../convex/coachData";
import {
  stepDays,
  stepSettings,
  STEPS_LIMIT_MESSAGE,
} from "../convex/stepsModel";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-15T13:00Z");
const day = "2026-10-15";
const oldDay = "2026-09-25";
const userId = "alice";
const readinessTables = [
  ["bodyCheckins", 29],
  ["strengthSets", 5000],
  ["cardioSessions", 400],
  ["muscles", 11],
] as const;
type ReadinessTable = (typeof readinessTables)[number][0];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now - 60_000);
});
afterEach(() => vi.useRealTimers());

async function insertRows(
  ctx: MutationCtx,
  table: ReadinessTable,
  count: number,
) {
  if (table === "strengthSets") {
    const workoutId = await ctx.db.insert("workouts", {
      userId,
      trainedAt: now - 1,
      muscleIds: [],
      note: "",
    });
    const exerciseId = await ctx.db.insert("exercises", {
      userId,
      name: "Row",
      muscleIds: [],
      custom: true,
    });
    for (let order = 0; order < count; order++)
      await ctx.db.insert(table, {
        userId,
        workoutId,
        exerciseId,
        muscleIds: [],
        trainedAt: now - 1,
        reps: 5,
        weightKg: 20,
        order,
      });
    return;
  }
  for (let i = 0; i < count; i++) {
    switch (table) {
      case "bodyCheckins":
        await ctx.db.insert(table, { userId, day, sleepHours: 0, energy: 1 });
        break;
      case "cardioSessions":
        await ctx.db.insert(table, {
          userId,
          day,
          kind: "run",
          effort: "hard",
          minutes: 600,
          createdAt: now - 1,
        });
        break;
      case "muscles":
        await ctx.db.insert(table, {
          userId,
          name: "Legs",
          cooldownHours: 48,
          soreUntil: now + 3_600_000,
        });
        break;
    }
  }
}

it.each(readinessTables)(
  "excludes future-created %s from readiness below the cap",
  async (table) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("bodyCheckins", {
        userId,
        day: "2026-10-14",
        sleepHours: 8,
      });
      await ctx.db.insert("muscles", {
        userId,
        name: "Back",
        cooldownHours: 48,
      });
      for (const sessionDay of [oldDay, day])
        await ctx.db.insert("cardioSessions", {
          userId,
          day: sessionDay,
          kind: "walk",
          effort: "moderate",
          minutes: 10,
          createdAt: now - 1,
        });
    });
    const read = () => t.run((ctx) => loadReadiness(ctx, userId, now, "UTC"));
    const before = await read();
    expect(before.components.map((row) => row.key).sort()).toEqual([
      "load",
      "sleep",
      "soreness",
    ]);
    vi.setSystemTime(now + 1);
    await t.run((ctx) => insertRows(ctx, table, 1));
    expect(await read()).toEqual(before);
  },
);

it("excludes cardio createdAt and steps updatedAt after the slot", async () => {
  const t = convexTest(schema, modules);
  const before = await t.run((ctx) => loadReadiness(ctx, userId, now, "UTC"));
  await t.run(async (ctx) => {
    await ctx.db.insert("cardioSessions", {
      userId,
      day: oldDay,
      kind: "run",
      effort: "hard",
      minutes: 600,
      createdAt: now + 1,
    });
    await ctx.db.insert("steps", {
      userId,
      day,
      count: 8000,
      source: "manual",
      updatedAt: now + 1,
    });
  });
  expect(await t.run((ctx) => loadReadiness(ctx, userId, now, "UTC"))).toEqual(
    before,
  );
  expect(
    await t.run((ctx) => stepDays(ctx, userId, oldDay, day, now, 7)),
  ).toEqual([]);
});

it("excludes future-created steps and settings below their caps", async () => {
  const t = convexTest(schema, modules);
  vi.setSystemTime(now + 1);
  await t.run(async (ctx) => {
    await ctx.db.insert("steps", {
      userId,
      day,
      count: 8000,
      source: "shortcut",
      updatedAt: now - 1,
    });
    await ctx.db.insert("settings", { userId, waterGoal: 2500 });
  });
  expect(
    await t.run((ctx) => stepDays(ctx, userId, oldDay, day, now, 7)),
  ).toEqual([]);
  expect(await t.run((ctx) => stepSettings(ctx, userId, now))).toBeNull();
});

it.each(readinessTables)(
  "counts future-created %s toward the raw take limit",
  async (table, limit) => {
    const t = convexTest(schema, modules);
    vi.setSystemTime(now + 1);
    await t.run((ctx) => insertRows(ctx, table, limit + 1));
    await expect(
      t.run((ctx) => loadReadiness(ctx, userId, now, "UTC")),
    ).rejects.toThrow(READINESS_LIMIT_MESSAGE);
  },
);

it.each(["steps", "settings"] as const)(
  "counts future-created %s toward the raw take limit",
  async (table) => {
    const t = convexTest(schema, modules);
    vi.setSystemTime(now + 1);
    await t.run(async (ctx) => {
      for (let i = 0; i < (table === "steps" ? 8 : 2); i++) {
        if (table === "steps")
          await ctx.db.insert(table, {
            userId,
            day,
            count: 8000,
            source: "manual",
            updatedAt: now - 1,
          });
        else await ctx.db.insert(table, { userId, waterGoal: 2500 });
      }
    });
    await expect(
      t.run(async (ctx) => {
        if (table === "steps") await stepDays(ctx, userId, oldDay, day, now, 7);
        else await stepSettings(ctx, userId, now);
      }),
    ).rejects.toThrow(STEPS_LIMIT_MESSAGE);
  },
);

type Read = { table: TableNames; limit: number };
function guardScans(ctx: MutationCtx, reads: Read[]): MutationCtx {
  function guard<T extends object>(builder: T, table: TableNames): T {
    return new Proxy(builder, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (key === "filter" || key === "collect" || key === "paginate")
            throw new Error(`Unbounded ${table}.${String(key)} before take`);
          if (key === "take") {
            const [limit] = args;
            if (typeof limit !== "number")
              throw new Error("Missing take limit");
            reads.push({ table, limit });
          } else if (key === "first" || key === "unique") {
            reads.push({ table, limit: key === "first" ? 1 : 2 });
          }
          const result = Reflect.apply(value, target, args);
          return key === "withIndex" || key === "order"
            ? guard(result, table)
            : result;
        };
      },
    });
  }
  return {
    ...ctx,
    db: new Proxy(ctx.db, {
      get(target, key, receiver) {
        if (key === "query")
          return (table: TableNames) => guard(target.query(table), table);
        return Reflect.get(target, key, receiver);
      },
    }),
  };
}

it("caps every suggestionsFor read before filtering, including recipes and readiness", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 50; i++)
      await ctx.db.insert("muscles", {
        userId,
        name: `Group ${i}`,
        cooldownHours: 48,
      });
  });
  const reads: Read[] = [];
  await t.run(async (ctx) => {
    const guarded = guardScans(ctx, reads);
    await suggestionsFor(
      guarded,
      { userId, waterGoal: 2500, proteinTarget: 120 },
      now,
      "UTC",
      readinessForCoach(guarded, userId, now, "UTC"),
    );
  });
  const expected: Read[] = [
    { table: "bodyCheckins", limit: 30 },
    { table: "strengthSets", limit: 5001 },
    { table: "cardioSessions", limit: 401 },
    { table: "muscles", limit: 12 },
    { table: "water", limit: 1000 },
    { table: "meals", limit: 300 },
    { table: "muscles", limit: 50 },
    ...Array.from(
      { length: 50 },
      () => ({ table: "workoutMuscles", limit: 1 }) satisfies Read,
    ),
    { table: "savedMeals", limit: 60 },
    { table: "habits", limit: 200 },
    { table: "habitLogs", limit: 400 },
    { table: "cardioSessions", limit: 351 },
    { table: "cardioSessions", limit: 1 },
    { table: "steps", limit: 8 },
  ];
  const sortKey = (read: Read) => `${read.table}:${read.limit}`;
  expect(
    reads.toSorted((a, b) => sortKey(a).localeCompare(sortKey(b))),
  ).toEqual(expected.toSorted((a, b) => sortKey(a).localeCompare(sortKey(b))));
  expect(reads.reduce((sum, read) => sum + read.limit, 0)).toBe(7864);
});

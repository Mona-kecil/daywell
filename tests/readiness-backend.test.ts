import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import { shiftDay } from "../lib/history";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-15T12:00Z");
const day = "2026-10-15";
const args = { now, timeZone: "UTC" };
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now - 60_000);
});
afterEach(() => vi.useRealTimers());

async function addSets(
  ctx: Pick<MutationCtx, "db">,
  count: number,
  trainedAt: number,
  userId = "alice",
) {
  const workoutId = await ctx.db.insert("workouts", {
    userId,
    trainedAt,
    muscleIds: [],
    note: "",
  });
  const exerciseId = await ctx.db.insert("exercises", {
    userId,
    name: "Row",
    muscleIds: [],
    custom: true,
  });
  for (let order = 0; order < count; order++) {
    await ctx.db.insert("strengthSets", {
      userId,
      workoutId,
      exerciseId,
      muscleIds: [],
      trainedAt,
      reps: 5,
      weightKg: 20,
      order,
    });
  }
}

it("requires authentication", async () => {
  const { t } = setup();
  await expect(t.query(api.readiness.today, args)).rejects.toThrow(
    "Sign in to continue.",
  );
});

it("validates the history clock", async () => {
  const { alice } = setup();
  for (const invalid of [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    8_640_000_000_000_001,
  ]) {
    await expect(
      alice.query(api.readiness.today, { ...args, now: invalid }),
    ).rejects.toThrow("Invalid timestamp.");
  }
  await expect(
    alice.query(api.readiness.today, { ...args, timeZone: "bad" }),
  ).rejects.toThrow("Choose a valid IANA time zone.");
});

it("returns missing inputs when no history exists", async () => {
  const { alice } = setup();
  expect(await alice.query(api.readiness.today, args)).toEqual({
    day,
    score: null,
    band: null,
    components: [],
    missing: ["sleep", "feel"],
  });
});

it("ignores another user's check-ins, muscles, sets and cardio before applying limits", async () => {
  const { t, alice, bob } = setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("bodyCheckins", {
      userId: "alice",
      day,
      sleepHours: 8,
      mood: 5,
    });
  });
  const before = await alice.query(api.readiness.today, args);
  await t.run(async (ctx) => {
    await ctx.db.insert("bodyCheckins", {
      userId: "bob",
      day,
      sleepHours: 4,
      mood: 1,
    });
    await ctx.db.insert("muscles", {
      userId: "bob",
      name: "Back",
      cooldownHours: 48,
      soreUntil: now + 1,
    });
    await addSets(ctx, 10, now, "bob");
    for (let i = 0; i < 401; i++) {
      await ctx.db.insert("cardioSessions", {
        userId: "bob",
        day,
        kind: "walk",
        effort: "easy",
        minutes: 1,
        createdAt: now - 1,
      });
    }
  });
  expect(await alice.query(api.readiness.today, args)).toEqual(before);
  await expect(bob.query(api.readiness.today, args)).rejects.toThrow(
    "History exceeds readiness limits.",
  );
});

it("counts sets plus effort-adjusted cardio as set-equivalents", async () => {
  const { t, alice } = setup();
  await t.run(async (ctx) => {
    await addSets(ctx, 1, now);
    await addSets(ctx, 1, Date.parse("2026-09-25T12:00Z"));
    await ctx.db.insert("cardioSessions", {
      userId: "alice",
      day,
      kind: "run",
      effort: "hard",
      minutes: 15,
      createdAt: now,
    });
    await ctx.db.insert("cardioSessions", {
      userId: "alice",
      day: "2026-09-25",
      kind: "walk",
      effort: "moderate",
      minutes: 110,
      createdAt: now,
    });
    await ctx.db.insert("muscles", {
      userId: "alice",
      name: "Back",
      cooldownHours: 48,
    });
  });
  const result = await alice.query(api.readiness.today, args);
  expect(result.components.find((row) => row.key === "load")).toEqual({
    key: "load",
    score: 100,
    weight: 0.5,
    detail: { acute: 4, chronic: 4, acwr: 1 },
  });
  expect(result.score).toBe(100);
});

it("counts soreness only while soreUntil is greater than now", async () => {
  const { t, alice } = setup();
  await t.run(async (ctx) => {
    for (const soreUntil of [now - 1, now, now + 1, undefined]) {
      await ctx.db.insert("muscles", {
        userId: "alice",
        name: "Back",
        cooldownHours: 48,
        soreUntil,
      });
    }
  });
  expect((await alice.query(api.readiness.today, args)).components).toEqual([
    { key: "soreness", score: 75, weight: 1, detail: { sore: 1, total: 4 } },
  ]);
});

it("excludes future event times, local days and creation times", async () => {
  const { t, alice } = setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("bodyCheckins", {
      userId: "alice",
      day: shiftDay(day, -1),
      sleepHours: 8,
    });
    await ctx.db.insert("muscles", {
      userId: "alice",
      name: "Back",
      cooldownHours: 48,
    });
    for (const session of [
      { day: shiftDay(day, -20), minutes: 30 },
      { day, minutes: 10 },
    ]) {
      await ctx.db.insert("cardioSessions", {
        userId: "alice",
        kind: "walk",
        effort: "easy",
        createdAt: now,
        ...session,
      });
    }
  });
  const before = await alice.query(api.readiness.today, args);
  await t.run(async (ctx) => {
    await addSets(ctx, 10, now + 1);
    await ctx.db.insert("bodyCheckins", {
      userId: "alice",
      day: shiftDay(day, 1),
      sleepHours: 0,
      mood: 1,
    });
    for (const session of [
      { day, createdAt: now + 1 },
      { day: shiftDay(day, 1), createdAt: now },
    ]) {
      await ctx.db.insert("cardioSessions", {
        userId: "alice",
        kind: "run",
        effort: "hard",
        minutes: 600,
        ...session,
      });
    }
  });
  vi.setSystemTime(now + 60_000);
  await t.run(async (ctx) => {
    await ctx.db.insert("bodyCheckins", {
      userId: "alice",
      day,
      sleepHours: 0,
      energy: 1,
    });
    await addSets(ctx, 10, now - 1);
    await ctx.db.insert("cardioSessions", {
      userId: "alice",
      day,
      kind: "run",
      effort: "hard",
      minutes: 600,
      createdAt: now - 1,
    });
    await ctx.db.insert("muscles", {
      userId: "alice",
      name: "Legs",
      cooldownHours: 48,
      soreUntil: now + 1,
    });
  });
  expect(await alice.query(api.readiness.today, args)).toEqual(before);
});

it("uses the non-UTC today and includes only sets on the local 28-day boundary", async () => {
  const { t, alice } = setup();
  const clock = {
    now: Date.parse("2026-10-15T01:00Z"),
    timeZone: "America/Los_Angeles",
  };
  vi.setSystemTime(clock.now - 60_000);
  await t.run(async (ctx) => {
    await ctx.db.insert("bodyCheckins", {
      userId: "alice",
      day: "2026-10-14",
      sleepHours: 7,
      mood: 3,
    });
    await ctx.db.insert("bodyCheckins", {
      userId: "alice",
      day: "2026-10-15",
      sleepHours: 4,
      mood: 1,
    });
    // Sept 16 is outside the window. Sept 17 at local midnight is inside.
    await addSets(ctx, 20, Date.parse("2026-09-17T06:59:59.999Z"));
    await addSets(ctx, 6, Date.parse("2026-09-17T07:00Z"));
    await addSets(ctx, 2, clock.now);
    await addSets(ctx, 20, clock.now + 1);
    // Bare workouts do not count as strength sets.
    await ctx.db.insert("workouts", {
      userId: "alice",
      trainedAt: clock.now,
      muscleIds: [],
      note: "",
    });
  });
  const result = await alice.query(api.readiness.today, clock);
  expect(result).toMatchObject({ day: "2026-10-14", score: 82, missing: [] });
  expect(result.components.find((row) => row.key === "load")?.detail).toEqual({
    acute: 2,
    chronic: 2,
    acwr: 1,
  });
  expect(result.components.find((row) => row.key === "sleep")?.detail).toEqual({
    sleepHours: 7,
  });
});

it("handles a DST transition between the load boundary and today", async () => {
  const { t, alice } = setup();
  const clock = {
    now: Date.parse("2026-03-28T18:00Z"),
    timeZone: "America/New_York",
  };
  vi.setSystemTime(clock.now - 60_000);
  await t.run(async (ctx) => {
    await addSets(ctx, 10, Date.parse("2026-03-01T04:59:59.999Z"));
    await addSets(ctx, 3, Date.parse("2026-03-01T05:00Z"));
    await addSets(ctx, 1, clock.now);
  });
  expect(
    (await alice.query(api.readiness.today, clock)).components[0]?.detail,
  ).toEqual({ acute: 1, chronic: 1, acwr: 1 });
});

it.each(["checkins", "sets", "cardio", "muscles"] as const)(
  "accepts the %s limit then throws on one more row",
  async (table) => {
    const { t, alice } = setup();
    const limit = { checkins: 29, sets: 5000, cardio: 400, muscles: 11 }[table];
    const insert = async (count: number, offset = 0) =>
      t.run(async (ctx) => {
        if (table === "sets") return addSets(ctx, count, now);
        for (let i = offset; i < offset + count; i++) {
          if (table === "checkins") {
            await ctx.db.insert("bodyCheckins", {
              userId: "alice",
              day: shiftDay(day, -(i % 29)),
              sleepHours: 8,
            });
          } else if (table === "cardio") {
            await ctx.db.insert("cardioSessions", {
              userId: "alice",
              day,
              kind: "walk",
              effort: "easy",
              minutes: 1,
              createdAt: now,
            });
          } else {
            await ctx.db.insert("muscles", {
              userId: "alice",
              name: "Back",
              cooldownHours: 48,
            });
          }
        }
      });
    await insert(limit);
    await expect(alice.query(api.readiness.today, args)).resolves.toMatchObject(
      { day },
    );
    await insert(1, limit);
    await expect(alice.query(api.readiness.today, args)).rejects.toThrow(
      "History exceeds readiness limits.",
    );
  },
  15_000,
);

it("does not charge out-of-range days but counts future-created rows against limits", async () => {
  const { t, alice } = setup();
  await t.run(async (ctx) => {
    for (let i = 0; i < 30; i++) {
      for (const date of [shiftDay(day, -29), shiftDay(day, 1)]) {
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day: date,
          sleepHours: 8,
        });
      }
    }
  });
  expect(await alice.query(api.readiness.today, args)).toMatchObject({
    score: null,
    components: [],
  });
  vi.setSystemTime(now + 60_000);
  await t.run(async (ctx) => {
    for (let i = 0; i < 30; i++) {
      await ctx.db.insert("bodyCheckins", {
        userId: "alice",
        day,
        sleepHours: 8,
      });
    }
  });
  await expect(alice.query(api.readiness.today, args)).rejects.toThrow(
    "History exceeds readiness limits.",
  );
});

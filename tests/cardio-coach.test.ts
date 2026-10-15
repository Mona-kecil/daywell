import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { coachSuggestions, type CoachInput } from "../lib/coach";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-15T00:00:00Z"); // Wednesday 17:00 in LA.
const base: CoachInput = {
  now,
  localMinutes: 17 * 60,
  timeZone: "America/Los_Angeles",
  waterMl: 0,
  waterGoal: 0,
  macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  targets: {},
  mealCount: 1,
  muscles: [],
};
const cardio = { weekActiveMinutes: 30, todayMinutes: 0, weekday: 3 };
const suggest = (changes: Partial<CoachInput> = {}) =>
  coachSuggestions({ ...base, cardio, ...changes });

describe("cardio coach rule", () => {
  it("fires at 17:00 with a five-minute rounded walk and one nudge per kind", () => {
    expect(suggest()).toEqual([
      {
        id: "today:cardio",
        kind: "cardio",
        priority: 3,
        title: "30 of 150 active minutes",
        body: "A 35-minute brisk walk tonight gets you back on pace for the week.",
      },
    ]);
    expect(new Set(suggest().map((s) => s.kind)).size).toBe(suggest().length);
  });
  it("does not fire before 17:00", () => {
    expect(suggest({ localMinutes: 17 * 60 - 1 })).toEqual([]);
  });
  it("does not fire after any cardio today", () => {
    expect(suggest({ cardio: { ...cardio, todayMinutes: 0.1 } })).toEqual([]);
  });
  it("does not fire at or above the rounded pace target", () => {
    for (const weekActiveMinutes of [64, 65, 150])
      expect(suggest({ cardio: { ...cardio, weekActiveMinutes } })).toEqual([]);
  });
  it("does not fire without cardio input", () => {
    expect(coachSuggestions(base)).toEqual([]);
  });
  it.each([
    {
      weekActiveMinutes: 63.4,
      weekday: 3,
      minutes: 10,
      title: "63 of 150 active minutes",
    },
    {
      weekActiveMinutes: 0,
      weekday: 7,
      minutes: 45,
      title: "0 of 150 active minutes",
    },
    {
      weekActiveMinutes: 140,
      weekday: 7,
      minutes: 10,
      title: "140 of 150 active minutes",
    },
  ])(
    "clamps walk duration to $minutes minutes for $weekActiveMinutes minutes on weekday $weekday",
    ({ weekActiveMinutes, weekday, minutes, title }) => {
      expect(
        suggest({ cardio: { weekActiveMinutes, weekday, todayMinutes: 0 } }),
      ).toMatchObject([
        {
          title,
          body: `A ${minutes}-minute brisk walk tonight gets you back on pace for the week.`,
        },
      ]);
    },
  );
  it("reaches 150 on Sunday", () => {
    expect(
      suggest({ cardio: { ...cardio, weekday: 7, weekActiveMinutes: 149 } }),
    ).toHaveLength(1);
    expect(
      suggest({ cardio: { ...cardio, weekday: 7, weekActiveMinutes: 150 } }),
    ).toEqual([]);
  });
  it("preserves the priority and ID ordering and three-nudge cap", () => {
    const result = suggest({
      localMinutes: 19 * 60,
      waterGoal: 2500,
      targets: { proteinTarget: 100 },
      habits: [{ id: "read", name: "Read", order: 0 }],
      muscles: [{ name: "Back", cooldownHours: 24, lastTrainedAt: null }],
    });
    expect(result.map((s) => s.id)).toEqual([
      "food:targets",
      "water:pace",
      "today:cardio",
    ]);
  });
});

async function setup(at = now) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      userId: "alice",
      waterGoal: 0,
      timeZone: "America/Los_Angeles",
    });
    await ctx.db.insert("meals", {
      userId: "alice",
      at,
      description: "Meal",
      items: [],
      revision: 1,
      analysis: { status: "ready" },
    });
  });
  return { t, alice: t.withIdentity({ subject: "alice" }) };
}

describe("cardio coach backend", () => {
  it("sums hard minutes since local Monday, excludes other users and out-of-range days, then stops after today's log", async () => {
    const { t, alice } = await setup();
    await t.run(async (ctx) => {
      for (const [userId, day, minutes, effort] of [
        ["alice", "2026-10-12", 10, "hard"],
        ["alice", "2026-10-13", 10, "easy"],
        ["alice", "2026-10-11", 600, "hard"],
        ["alice", "2026-10-15", 600, "hard"],
        ["bob", "2026-10-12", 600, "hard"],
      ] as const)
        await ctx.db.insert("cardioSessions", {
          userId,
          day,
          minutes,
          effort,
          kind: "walk",
          createdAt: now,
        });
    });
    expect(await alice.query(api.coach.suggestions, { now })).toEqual(
      suggest(),
    );
    await t.run((ctx) =>
      ctx.db.insert("cardioSessions", {
        userId: "alice",
        day: "2026-10-14",
        minutes: 1,
        effort: "easy",
        kind: "walk",
        createdAt: now,
      }),
    );
    expect(await alice.query(api.coach.suggestions, { now })).toEqual([]);
  });
  it("uses the local Sunday pace even after UTC Monday begins", async () => {
    const at = Date.parse("2026-10-19T00:00:00Z");
    const { t, alice } = await setup(at);
    await t.run((ctx) =>
      ctx.db.insert("cardioSessions", {
        userId: "alice",
        day: "2026-10-12",
        minutes: 140,
        effort: "easy",
        kind: "walk",
        createdAt: at,
      }),
    );
    expect(await alice.query(api.coach.suggestions, { now: at })).toMatchObject(
      [
        {
          kind: "cardio",
          title: "140 of 150 active minutes",
          body: "A 10-minute brisk walk tonight gets you back on pace for the week.",
        },
      ],
    );
  });
  it("stays quiet for someone with no cardio in the last four weeks", async () => {
    const { t, alice } = await setup();
    expect(await alice.query(api.coach.suggestions, { now })).toEqual([]);
    await t.run((ctx) =>
      ctx.db.insert("cardioSessions", {
        userId: "alice",
        day: "2026-09-13",
        minutes: 30,
        effort: "easy",
        kind: "walk",
        createdAt: now,
      }),
    );
    expect(await alice.query(api.coach.suggestions, { now })).toEqual([]);
    await t.run((ctx) =>
      ctx.db.insert("cardioSessions", {
        userId: "alice",
        day: "2026-09-14",
        minutes: 30,
        effort: "easy",
        kind: "walk",
        createdAt: now,
      }),
    );
    expect(await alice.query(api.coach.suggestions, { now })).toMatchObject([
      { kind: "cardio", title: "0 of 150 active minutes" },
    ]);
  });
  it("skips cardio above 350 rows without dropping other suggestions", async () => {
    const { t, alice } = await setup();
    await t.run(async (ctx) => {
      // Small seeded values isolate the limit from the on-pace guard.
      for (let i = 0; i < 350; i++)
        await ctx.db.insert("cardioSessions", {
          userId: "alice",
          day: "2026-10-12",
          minutes: 0.1,
          effort: "easy",
          kind: "walk",
          createdAt: now,
        });
    });
    expect(await alice.query(api.coach.suggestions, { now })).toMatchObject([
      { kind: "cardio", title: "35 of 150 active minutes" },
    ]);
    await t.run(async (ctx) => {
      await ctx.db.insert("cardioSessions", {
        userId: "alice",
        day: "2026-10-12",
        minutes: 0.1,
        effort: "easy",
        kind: "walk",
        createdAt: now,
      });
      const settings = await ctx.db.query("settings").first();
      if (!settings) throw new Error("Missing settings");
      await ctx.db.patch(settings._id, { waterGoal: 2500 });
    });
    expect(
      (await alice.query(api.coach.suggestions, { now })).map((s) => s.kind),
    ).toEqual(["water"]);
  });
});

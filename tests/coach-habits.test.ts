import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { coachSuggestions } from "../lib/coach";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-14T18:00:00Z");
const habits = [
  { id: "read", name: "Read", order: 2 },
  { id: "walk", name: "Walk", order: 1 },
  { id: "vitamins", name: "Vitamins", order: 0 },
];
const base = {
  now,
  localMinutes: 18 * 60,
  timeZone: "UTC",
  waterMl: 2500,
  waterGoal: 2500,
  macros: { kcal: 2000, protein: 100, carbs: 0, fat: 0 },
  targets: {},
  mealCount: 1,
  muscles: [],
  habits,
  habitLogs: [{ habitId: "walk", day: "2026-10-14" }],
};
const suggest = (changes: Partial<typeof base> = {}) =>
  coachSuggestions({ ...base, ...changes });

describe("habit coach rules", () => {
  it("does not nudge when there are no habits", () => {
    expect(suggest({ habits: [] })).toEqual([]);
  });
  it("does not nudge when all habits are done today", () => {
    expect(
      suggest({
        habitLogs: habits.map((habit) => ({
          habitId: habit.id,
          day: "2026-10-14",
        })),
      }),
    ).toEqual([]);
  });
  it("does not nudge before 18:00 local time", () => {
    expect(suggest({ localMinutes: 18 * 60 - 1 })).toEqual([]);
  });
  it("nudges at 18:00 with unfinished habits in order", () => {
    expect(suggest()).toEqual([
      {
        id: "today:habits",
        kind: "habit",
        priority: 3,
        title: "2 habits left today",
        body: "Vitamins, Read.",
      },
    ]);
    expect(suggest()).toEqual(suggest());
    expect(habits.map((habit) => habit.id)).toEqual([
      "read",
      "walk",
      "vitamins",
    ]);
  });
  it("names at most three unfinished habits with a +N more tail", () => {
    expect(
      suggest({
        habits: [
          ...habits,
          { id: "stretch", name: "Stretch", order: 3 },
          { id: "journal", name: "Journal", order: 4 },
        ],
        habitLogs: [],
      }),
    ).toMatchObject([
      {
        title: "5 habits left today",
        body: "Vitamins, Walk, Read, +2 more.",
      },
    ]);
  });
  it("ignores archived habits, including an archive timestamp of zero", () => {
    const archived = habits.map((habit) => ({ ...habit, archivedAt: 0 }));
    expect(coachSuggestions({ ...base, habits: archived })).toEqual([]);
    expect(
      coachSuggestions({
        ...base,
        habits: [archived[0], habits[2]],
      }),
    ).toMatchObject([{ title: "1 habit left today", body: "Vitamins." }]);
  });
  it("uses the local day across midnight in a non-UTC zone", () => {
    const changes = {
      habits: [habits[2]],
      timeZone: "America/Los_Angeles",
      habitLogs: [{ habitId: "vitamins", day: "2026-10-14" }],
    };
    // UTC is already October 15 while the user's day is still October 14.
    expect(
      suggest({
        ...changes,
        now: Date.parse("2026-10-15T06:59:00Z"),
        localMinutes: 23 * 60 + 59,
      }),
    ).toEqual([]);
    expect(
      suggest({
        ...changes,
        now: Date.parse("2026-10-15T07:00:00Z"),
        localMinutes: 0,
      }),
    ).toEqual([]);
    expect(
      suggest({
        ...changes,
        now: Date.parse("2026-10-16T01:00:00Z"),
        localMinutes: 18 * 60,
      }),
    ).toMatchObject([{ title: "1 habit left today", body: "Vitamins." }]);
  });
  it("keeps water, food, and recovery ahead of habits but nudges before routine training", () => {
    const muscles = [{ name: "back", cooldownHours: 24, lastTrainedAt: null }];
    expect(coachSuggestions({ ...base, muscles }).map((s) => s.kind)).toEqual([
      "habit",
      "train",
    ]);
    expect(
      coachSuggestions({
        ...base,
        muscles: [{ ...muscles[0], lastTrainedAt: now }],
      }).map((s) => s.kind),
    ).toEqual(["rest", "habit"]);
    expect(
      coachSuggestions({
        ...base,
        waterMl: 0,
        macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
        targets: { kcalTarget: 2000, proteinTarget: 100 },
        mealCount: 0,
        localMinutes: 19 * 60 + 30,
        muscles,
      }).map((s) => s.kind),
    ).toEqual(["food", "water", "food"]);
  });
  it("keeps the longest supported names within existing text bounds", () => {
    const results = suggest({
      habits: Array.from({ length: 12 }, (_, order) => ({
        id: String(order),
        name: String(order).padEnd(40, "x"),
        order,
      })),
      habitLogs: [],
    });
    expect(results).toHaveLength(1);
    expect(results[0].title.length).toBeLessThanOrEqual(60);
    expect(results[0].body.length).toBeLessThanOrEqual(140);
    expect(results[0].body).toContain("+9 more");
  });
});

function setup() {
  const t = convexTest(schema, modules);
  return { t, alice: t.withIdentity({ subject: "alice" }) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("habit coach backend", () => {
  it("shows only the user's active habits and completions for the local day", async () => {
    const { t, alice } = setup();
    const at = Date.parse("2026-10-15T01:00:00Z"); // October 14, 18:00 in LA
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        userId: "alice",
        waterGoal: 0,
        timeZone: "America/Los_Angeles",
      });
      await ctx.db.insert("meals", {
        userId: "alice",
        at,
        description: "Dinner",
        items: [],
        revision: 1,
        analysis: { status: "ready" },
      });
      for (const habit of habits) {
        const habitId = await ctx.db.insert("habits", {
          userId: "alice",
          name: habit.name,
          icon: "check",
          order: habit.order,
          createdAt: at - 86_400_000,
        });
        await ctx.db.insert("habitLogs", {
          userId: "alice",
          habitId,
          day: habit.id === "walk" ? "2026-10-14" : "2026-10-15",
        });
        // Even a foreign user's log referencing Alice's habit cannot mark it done.
        await ctx.db.insert("habitLogs", {
          userId: "bob",
          habitId,
          day: "2026-10-14",
        });
      }
      for (const userId of ["alice", "bob"]) {
        await ctx.db.insert("habits", {
          userId,
          name: "Excluded",
          icon: "check",
          order: -1,
          createdAt: at,
          ...(userId === "alice" ? { archivedAt: 0 } : {}),
        });
      }
    });
    expect(await alice.query(api.coach.suggestions, { now: at })).toEqual([
      {
        id: "today:habits",
        kind: "habit",
        priority: 3,
        title: "2 habits left today",
        body: "Vitamins, Read.",
      },
    ]);
    // Device time zone overrides the saved zone; UTC is before the evening threshold.
    expect(
      await alice.query(api.coach.suggestions, { now: at, timeZone: "UTC" }),
    ).toEqual([]);
    await expect(t.query(api.coach.suggestions, { now: at })).rejects.toThrow(
      "Sign in",
    );
  });

  it("delivers the evening habit text once and stops nudging after completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T02:31:00Z")); // October 14, 19:31 in LA
    vi.stubEnv("PUSH_PROVIDER", "fake");
    const { t, alice } = setup();
    await alice.mutation(api.tracker.initialize, {});
    const habitId = await t.run(async (ctx) => {
      const settings = await ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", "alice"))
        .unique();
      if (!settings) throw new Error("Missing initialized settings");
      await ctx.db.patch(settings._id, {
        waterGoal: 0,
        timeZone: "America/Los_Angeles",
        remindersEnabled: true,
      });
      await ctx.db.insert("meals", {
        userId: "alice",
        at: Date.now() - 60_000,
        description: "Dinner",
        items: [],
        revision: 1,
        analysis: { status: "ready" },
      });
      return ctx.db.insert("habits", {
        userId: "alice",
        name: "Vitamins",
        icon: "pill",
        order: 0,
        createdAt: Date.now() - 86_400_000,
      });
    });
    await alice.mutation(api.push.subscribe, {
      endpoint: "https://fcm.googleapis.com/fcm/send/alice",
      keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
    });
    await t.mutation(internal.coachCron.run, {});
    await t.mutation(internal.coachCron.run, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const deliveries = await t.run((ctx) =>
      ctx.db.query("pushDeliveries").collect(),
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      payload: {
        kind: "habit",
        title: "1 habit left today",
        body: "Vitamins.",
        slot: "2026-10-14/19:30",
      },
      statusCode: 201,
    });
    await alice.mutation(api.habits.toggle, {
      id: habitId,
      day: "2026-10-14",
    });
    expect(
      (await alice.query(api.coach.suggestions, { now: Date.now() })).map(
        (suggestion) => suggestion.kind,
      ),
    ).toEqual(["train"]);
    await alice.mutation(api.coach.setCheckIns, { checkIns: ["19:45"] });
    vi.setSystemTime(new Date("2026-10-15T02:46:00Z"));
    await t.mutation(internal.coachCron.run, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.run((ctx) => ctx.db.query("pushDeliveries").collect()),
    ).toMatchObject([
      { payload: { kind: "habit" } },
      { payload: { kind: "train" } },
    ]);
  });
});

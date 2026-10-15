import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { historyFor } from "../convex/historyData";
import { historyThroughNow, type HistoryInput } from "../lib/history";
import { weeklyReviewText, weeklySummary } from "../lib/weekly-review";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-19T01:00:00Z"); // Sunday evening in LA.
const base: HistoryInput = {
  now,
  timeZone: "America/Los_Angeles",
  waterGoal: 2500,
  muscleIds: [],
  workouts: [],
  sets: [],
  water: [],
  meals: [],
  checkins: [],
};
const sessions = [
  { day: "2026-10-12", minutes: 20.1, effort: "easy" },
  { day: "2026-10-14", minutes: 25.2, effort: "hard" },
  { day: "2026-10-18", minutes: 24.5, effort: "moderate" },
] as const;

describe("cardio weekly review", () => {
  it("counts sessions and distinct logged days within seven local dates, rounding totals once", () => {
    const input = {
      ...base,
      water: [{ at: Date.parse("2026-10-15T12:00Z"), amountMl: 700 }],
      checkins: [{ day: "2026-10-14", mood: 3 }],
      cardio: [
        ...sessions,
        { day: "2026-10-14", minutes: 0.15, effort: "hard" },
        { day: "2026-10-11", minutes: 600, effort: "hard" },
        { day: "2026-10-19", minutes: 600, effort: "hard" },
      ],
    } satisfies HistoryInput;
    expect(weeklySummary(input)).toMatchObject({
      fromDay: "2026-10-12",
      toDay: "2026-10-18",
      cardioSessions: 4,
      cardioMinutes: 70,
      cardioActiveMinutes: 95.3,
      cardioGoal: 150,
      daysLogged: 4,
    });
  });

  it("drops future cardio using the local day before summaries are built", () => {
    const input = {
      ...base,
      cardio: [sessions[2], { day: "2026-10-19", minutes: 30, effort: "hard" }],
    } satisfies HistoryInput;
    expect(historyThroughNow(input).cardio).toEqual([sessions[2]]);
  });

  it.each([
    {
      cardio: [sessions[0]],
      sentence: "Cardio 1 session, 20 of 150 active min.",
      days: 1,
    },
    {
      cardio: [...sessions],
      sentence: "Cardio 3 sessions, 95 of 150 active min.",
      days: 3,
    },
  ])(
    "places $sentence between water and logged days, ahead of habits",
    ({ cardio, sentence, days }) => {
      const summary = weeklySummary({
        ...base,
        cardio,
        habits: [{ _id: "read", createdAt: 0 }],
      });
      expect(weeklyReviewText(summary).body).toBe(
        `0 workouts · 0 sets · 0 new PRs. Sleep not logged. Water 0 / 2500 ml avg (0%). ${sentence} Logged ${days}/7 days. Habits 0/7 done.`,
      );
    },
  );

  it("keeps the original text byte for byte when cardio is absent or empty", () => {
    const original =
      "0 workouts · 0 sets · 0 new PRs. Sleep not logged. Water 0 / 2500 ml avg (0%). Logged 0/7 days.";
    expect(weeklyReviewText(weeklySummary(base)).body).toBe(original);
    const absent = weeklySummary(base);
    for (const field of [
      "cardioSessions",
      "cardioMinutes",
      "cardioActiveMinutes",
      "cardioGoal",
    ])
      expect(absent).not.toHaveProperty(field);
    const empty = weeklySummary({ ...base, cardio: [] });
    expect(empty).toMatchObject({
      cardioSessions: 0,
      cardioMinutes: 0,
      cardioActiveMinutes: 0,
      cardioGoal: 150,
    });
    expect(weeklyReviewText(empty).body).toBe(original);
  });
});

describe("cardio history backend", () => {
  it("returns only owned in-range cardio for weekly mode and omits it from achievements", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const session of [
        ...sessions,
        { ...sessions[0], day: "2026-10-11" },
        { ...sessions[0], day: "2026-10-19" },
      ])
        await ctx.db.insert("cardioSessions", {
          ...session,
          userId: "alice",
          kind: "walk",
          createdAt: now,
        });
      await ctx.db.insert("cardioSessions", {
        ...sessions[0],
        userId: "bob",
        kind: "walk",
        createdAt: now,
      });
    });
    const weekly = await t.run((ctx) =>
      historyFor(ctx, "alice", now, base.timeZone, "weekly"),
    );
    expect(weekly.cardio).toEqual(sessions);
    const achievements = await t.run((ctx) =>
      historyFor(ctx, "alice", now, base.timeZone, "achievements"),
    );
    expect(achievements.cardio).toBeUndefined();
  });

  it("accepts 350 rows and rejects 351 only for weekly review", async () => {
    const t = convexTest(schema, modules);
    const row = {
      ...sessions[0],
      userId: "alice",
      kind: "walk",
      createdAt: now,
    } as const;
    await t.run(async (ctx) => {
      for (let i = 0; i < 350; i++) await ctx.db.insert("cardioSessions", row);
    });
    expect(
      (
        await t.run((ctx) =>
          historyFor(ctx, "alice", now, base.timeZone, "weekly"),
        )
      ).cardio,
    ).toHaveLength(350);
    await t.run((ctx) => ctx.db.insert("cardioSessions", row));
    await expect(
      t.run((ctx) => historyFor(ctx, "alice", now, base.timeZone, "weekly")),
    ).rejects.toThrow("History exceeds review limits.");
    expect(
      (
        await t.run((ctx) =>
          historyFor(ctx, "alice", now, base.timeZone, "achievements"),
        )
      ).cardio,
    ).toBeUndefined();
  });
});

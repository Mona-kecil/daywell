import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { lastDays } from "../lib/habits";
import { weeklyReviewText } from "../lib/weekly-review";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-18T12:00Z");
const today = "2026-10-18";

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const t = convexTest(schema, modules);
  return { t, alice: t.withIdentity({ subject: "alice" }) };
}

describe("habit history", () => {
  it("returns only the owned habit's unique days in the inclusive 84-day range, including archives", async () => {
    const { t, alice } = setup();
    const id = await alice.mutation(api.habits.create, {
      name: "Read",
      icon: "book",
    });
    const other = await alice.mutation(api.habits.create, {
      name: "Walk",
      icon: "sun",
    });
    const days = lastDays(today, 84);
    await t.run(async (ctx) => {
      for (const day of [
        today,
        days[0],
        days[20],
        days[20],
        "2026-07-26",
        "2026-10-19",
      ])
        await ctx.db.insert("habitLogs", { userId: "alice", habitId: id, day });
      await ctx.db.insert("habitLogs", {
        userId: "bob",
        habitId: id,
        day: days[1],
      });
      await ctx.db.insert("habitLogs", {
        userId: "alice",
        habitId: other,
        day: days[2],
      });
    });
    await alice.mutation(api.habits.archive, { id });
    expect(await alice.query(api.habits.history, { id, today })).toEqual({
      days: [days[0], days[20], today],
    });
    expect(
      await alice.query(api.habits.history, { id: other, today: "2024-03-01" }),
    ).toEqual({ days: [] });
  });

  it("requires authentication and ownership, including missing habits", async () => {
    const { t, alice } = setup();
    const id = await alice.mutation(api.habits.create, {
      name: "Read",
      icon: "book",
    });
    await expect(t.query(api.habits.history, { id, today })).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(
      t
        .withIdentity({ subject: "bob" })
        .query(api.habits.history, { id, today }),
    ).rejects.toThrow("Habit not found.");
    await t.run((ctx) => ctx.db.delete(id));
    await expect(
      alice.query(api.habits.history, { id, today }),
    ).rejects.toThrow("Habit not found.");
  });

  it.each(["", "2026-02-29", "2026-04-31", "2026-1-01", "2026-10-18T00:00Z"])(
    "rejects invalid history day %j",
    async (today) => {
      const { alice } = setup();
      const id = await alice.mutation(api.habits.create, {
        name: "Read",
        icon: "book",
      });
      await expect(
        alice.query(api.habits.history, { id, today }),
      ).rejects.toThrow("Use a valid YYYY-MM-DD day.");
    },
  );
});

it("feeds active habit counts and creation-local-day opportunities into the weekly query and push text", async () => {
  const { t, alice } = setup();
  vi.mocked(Date.now).mockReturnValue(now - 60_000);
  await t.run(async (ctx) => {
    const old = await ctx.db.insert("habits", {
      userId: "alice",
      name: "Old",
      icon: "book",
      order: 0,
      createdAt: Date.parse("2026-10-01T00:00Z"),
    });
    const recent = await ctx.db.insert("habits", {
      userId: "alice",
      name: "Recent",
      icon: "book",
      order: 1,
      createdAt: Date.parse("2026-10-14T17:00Z"),
    });
    const archived = await ctx.db.insert("habits", {
      userId: "alice",
      name: "Archived",
      icon: "book",
      order: 2,
      createdAt: 0,
      archivedAt: now,
    });
    for (const [habitId, day] of [
      [old, "2026-10-11"],
      [old, "2026-10-12"],
      [old, today],
      [old, "2026-10-19"],
      [recent, "2026-10-15"],
      [archived, today],
    ] as const)
      await ctx.db.insert("habitLogs", { userId: "alice", habitId, day });
    await ctx.db.insert("habitLogs", {
      userId: "bob",
      habitId: old,
      day: today,
    });
  });
  const summary = await alice.query(api.coach.weeklyReview, {
    now,
    timeZone: "Asia/Jakarta",
  });
  expect(summary).toMatchObject({ habitsDone: 3, habitsPossible: 11 });
  expect(weeklyReviewText(summary).body).toBe(
    "0 workouts · 0 sets · 0 new PRs. Sleep not logged. Water 0 / 2500 ml avg (0%). Logged 0/7 days. Habits 3/11 done.",
  );
  const bob = await t
    .withIdentity({ subject: "bob" })
    .query(api.coach.weeklyReview, { now, timeZone: "Asia/Jakarta" });
  expect(bob).toMatchObject({ habitsDone: 0, habitsPossible: 0 });
  expect(weeklyReviewText(bob).body).not.toContain("Habits");
});

it("loads archived habit runs for badges, caps progress, isolates users and preserves completion timestamps", async () => {
  const { t, alice } = setup();
  const id = await alice.mutation(api.habits.create, {
    name: "Read",
    icon: "book",
  });
  await t.run(async (ctx) => {
    for (const day of lastDays("2026-09-30", 30))
      await ctx.db.insert("habitLogs", { userId: "alice", habitId: id, day });
  });
  const logs = await t.run((ctx) => ctx.db.query("habitLogs").collect());
  await alice.mutation(api.habits.archive, { id });
  const badges = await alice.query(api.achievements.list, {
    now: now + 60_000,
    timeZone: "UTC",
  });
  for (const target of [7, 30])
    expect(
      badges.find((badge) => badge.id === `habit-streak-${target}`),
    ).toMatchObject({
      earnedAt: logs[target - 1]._creationTime,
      progress: { value: target, target },
    });
  const bob = await t
    .withIdentity({ subject: "bob" })
    .query(api.achievements.list, { now: now + 60_000, timeZone: "UTC" });
  expect(bob.find((badge) => badge.id === "habit-streak-7")).toMatchObject({
    earnedAt: null,
    progress: { value: 0, target: 7 },
  });
});

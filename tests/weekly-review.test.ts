import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { isoWeek, weeklySummary, weeklyReviewText } from "../lib/weekly-review";
import type { HistoryInput } from "../lib/history";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-18T12:00Z"); // Sunday 19:00 Jakarta
const empty: HistoryInput = {
  now,
  timeZone: "Asia/Jakarta",
  waterGoal: 2500,
  muscleIds: [],
  workouts: [],
  sets: [],
  water: [],
  meals: [],
  checkins: [],
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("summarizes seven civil dates, counts session PRs against past history and includes zero sleep", () => {
  const baseline = {
    exerciseId: "bench",
    workoutId: "old",
    trainedAt: Date.parse("2026-10-11T12:00Z"),
    reps: 1,
    weightKg: 100,
  };
  const summary = weeklySummary({
    ...empty,
    sets: [
      baseline,
      { ...baseline, workoutId: "new", trainedAt: now, weightKg: 110 },
      { ...baseline, workoutId: "new", trainedAt: now, weightKg: 120 },
      { ...baseline, exerciseId: "first", workoutId: "new", trainedAt: now },
    ],
    workouts: [
      { trainedAt: now, muscleIds: [] },
      { trainedAt: now + 1, muscleIds: [] },
    ],
    water: [
      { at: Date.parse("2026-10-11T16:59:59Z"), amountMl: 5000 },
      { at: Date.parse("2026-10-11T17:00Z"), amountMl: 2500 },
      { at: now, amountMl: 2500 },
    ],
    checkins: [
      { day: "2026-10-13", sleepHours: 0 },
      { day: "2026-10-14", sleepHours: 8 },
      { day: "2026-10-15", note: "" },
    ],
    meals: [
      { at: Date.parse("2026-10-16T12:00Z"), analysis: { status: "ready" } },
      { at: Date.parse("2026-10-17T12:00Z"), analysis: { status: "error" } },
    ],
  });
  expect(summary).toEqual({
    fromDay: "2026-10-12",
    toDay: "2026-10-18",
    isoWeek: "2026-W42",
    workouts: 1,
    totalSets: 3,
    newPRs: 1,
    avgSleepHours: 4,
    sleepDays: 2,
    avgWaterMl: 5000 / 7,
    waterGoalMl: 2500,
    waterGoalPercent: (5000 / 7 / 2500) * 100,
    daysLogged: 5,
  });
  expect(weeklyReviewText(summary)).toEqual({
    title: "Your weekly review",
    body: "1 workout · 3 sets · 1 new PR. Sleep 4.0 h avg. Water 714 / 2500 ml avg (29%). Logged 5/7 days.",
  });
  expect(weeklyReviewText(weeklySummary(empty)).body).toBe(
    "0 workouts · 0 sets · 0 new PRs. Sleep not logged. Water 0 / 2500 ml avg (0%). Logged 0/7 days.",
  );
});

it("uses ISO week years and seven dates across DST", () => {
  expect(isoWeek("2021-01-03")).toBe("2020-W53");
  expect(isoWeek("2021-01-04")).toBe("2021-W01");
  expect(
    weeklySummary({
      ...empty,
      now: Date.parse("2026-03-08T23:00Z"),
      timeZone: "America/New_York",
    }),
  ).toMatchObject({ fromDay: "2026-03-02", toDay: "2026-03-08" });
});

async function setup(timeZone = "Asia/Jakarta") {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  await alice.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setTimeZone, { timeZone });
  await alice.mutation(api.coach.setRemindersEnabled, { enabled: true });
  const endpoint = "https://fcm.googleapis.com/fcm/send/alice";
  await alice.mutation(api.push.subscribe, {
    endpoint,
    keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
  });
  return { t, alice, endpoint };
}
async function drain(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

it("sends the same summary as the query once per ISO week, even after a timezone change or replay", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now + 60_000);
  vi.stubEnv("PUSH_PROVIDER", "fake");
  const { t, alice } = await setup();
  await alice.mutation(api.tracker.addWater, { at: now, amountMl: 2500 });
  await alice.mutation(api.checkins.upsert, {
    day: "2026-10-18",
    sleepHours: 8,
  });
  const summary = await alice.query(api.coach.weeklyReview, {
    now,
    timeZone: "Asia/Jakarta",
  });
  await t.mutation(internal.weeklyReviewCron.run, {});
  await t.mutation(internal.weeklyReviewCron.run, {});
  await drain(t);
  const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    localDay: "2026-W42",
    slot: "weekly-review",
  });
  await t.action(internal.pushActions.deliver, { sentId: sent[0]._id });
  await alice.mutation(api.coach.setTimeZone, { timeZone: "UTC" });
  vi.setSystemTime(Date.parse("2026-10-18T19:01Z"));
  await t.mutation(internal.weeklyReviewCron.run, {});
  await drain(t);
  const deliveries = await t.run((ctx) =>
    ctx.db.query("pushDeliveries").collect(),
  );
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].payload).toEqual({
    ...weeklyReviewText(summary),
    kind: "weekly-review",
    slot: "2026-W42/weekly-review",
  });
  vi.setSystemTime(Date.parse("2026-10-25T19:01Z"));
  // Outages drain in daily batches, as the existing check-in cron does.
  for (let i = 0; i < 7; i++)
    await t.mutation(internal.weeklyReviewCron.run, {});
  await drain(t);
  expect(
    await t.run((ctx) => ctx.db.query("pushDeliveries").collect()),
  ).toHaveLength(2);
});

it.each([
  "disabled",
  "unsubscribed",
  "disabled-before-delivery",
  "wrong-day",
  "wrong-time",
])("does not send when %s", async (mode) => {
  vi.useFakeTimers();
  vi.setSystemTime(now + 60_000);
  vi.stubEnv("PUSH_PROVIDER", "fake");
  const { t, alice, endpoint } = await setup();
  if (mode === "disabled")
    await alice.mutation(api.coach.setRemindersEnabled, { enabled: false });
  if (mode === "unsubscribed")
    await alice.mutation(api.push.unsubscribe, { endpoint });
  if (mode === "wrong-day") vi.setSystemTime(Date.parse("2026-10-19T12:01Z"));
  if (mode === "wrong-time") vi.setSystemTime(now - 60_000);
  await t.mutation(internal.weeklyReviewCron.run, {});
  if (mode === "disabled-before-delivery")
    await alice.mutation(api.coach.setRemindersEnabled, { enabled: false });
  await drain(t);
  expect(
    await t.run((ctx) => ctx.db.query("pushDeliveries").collect()),
  ).toEqual([]);
});

it("authenticates the review query, isolates users and validates the clock", async () => {
  const { t, alice } = await setup();
  const args = { now, timeZone: "UTC" };
  await expect(t.query(api.coach.weeklyReview, args)).rejects.toThrow(
    "Sign in",
  );
  await expect(
    alice.query(api.coach.weeklyReview, { ...args, now: NaN }),
  ).rejects.toThrow("timestamp");
  await expect(
    alice.query(api.coach.weeklyReview, { ...args, timeZone: "wrong" }),
  ).rejects.toThrow("IANA");
  await alice.mutation(api.tracker.addWater, { at: now, amountMl: 2500 });
  expect(
    await t
      .withIdentity({ subject: "bob" })
      .query(api.coach.weeklyReview, args),
  ).toMatchObject({ avgWaterMl: 0, daysLogged: 0 });
});

it("skips an oversized user's history without blocking another user's review", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now + 60_000);
  vi.stubEnv("PUSH_PROVIDER", "fake");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const { t, alice } = await setup();
  const bob = t.withIdentity({ subject: "bob" });
  await bob.mutation(api.tracker.initialize, {});
  await bob.mutation(api.coach.setTimeZone, { timeZone: "Asia/Jakarta" });
  await bob.mutation(api.coach.setRemindersEnabled, { enabled: true });
  await bob.mutation(api.push.subscribe, {
    endpoint: "https://fcm.googleapis.com/fcm/send/bob",
    keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
  });
  const exercises = await alice.query(api.strength.exercises, {});
  const muscle = (await alice.query(api.tracker.overview, {})).muscles[0];
  const workoutId = await alice.mutation(api.tracker.addWorkout, {
    trainedAt: now,
    muscleIds: [muscle._id],
    note: "",
  });
  await t.run(async (ctx) => {
    for (let i = 0; i < 5001; i++)
      await ctx.db.insert("strengthSets", {
        userId: "alice",
        workoutId,
        exerciseId: exercises[0]._id,
        muscleIds: [muscle._id],
        trainedAt: now,
        reps: 1,
        weightKg: 10,
        order: i,
      });
  });
  await expect(
    alice.query(api.coach.weeklyReview, { now, timeZone: "Asia/Jakarta" }),
  ).rejects.toThrow("History exceeds review limits.");
  await t.mutation(internal.weeklyReviewCron.run, {});
  await drain(t);
  expect(log).toHaveBeenCalledWith("Weekly review skipped", {
    userId: "alice",
    reason: "history-limit",
  });
  const deliveries = await t.run((ctx) =>
    ctx.db.query("pushDeliveries").collect(),
  );
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].endpoint).toBe(
    "https://fcm.googleapis.com/fcm/send/bob",
  );
});

it("counts creation dates across DST, excludes archived and future habits, and leaves empty habit text unchanged", () => {
  const summary = weeklySummary({
    ...empty,
    now: Date.parse("2026-03-08T23:00Z"),
    timeZone: "America/New_York",
    habits: [
      { _id: "old", createdAt: 0 },
      { _id: "new", createdAt: Date.parse("2026-03-08T04:30Z") },
      { _id: "future", createdAt: Date.parse("2026-03-09T04:00Z") },
      { _id: "archived", createdAt: 0, archivedAt: 1 },
    ],
    habitLogs: [
      { habitId: "old", day: "2026-03-02", _creationTime: 1 },
      { habitId: "new", day: "2026-03-08", _creationTime: 2 },
      { habitId: "archived", day: "2026-03-08", _creationTime: 3 },
      { habitId: "old", day: "2026-03-01", _creationTime: 4 },
      { habitId: "old", day: "2026-03-09", _creationTime: 5 },
    ],
  });
  expect(summary).toMatchObject({ habitsDone: 2, habitsPossible: 9 });
  const zero = weeklySummary({ ...empty, habits: [], habitLogs: [] });
  expect(zero).toMatchObject({ habitsDone: 0, habitsPossible: 0 });
  expect(weeklyReviewText(zero)).toEqual(
    weeklyReviewText(weeklySummary(empty)),
  );
});

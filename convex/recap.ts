import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./model";
import { validHistoryClock } from "./historyData";
import { localClock } from "../lib/coach-time";
import { DAY_MS, dayNumber } from "../lib/history";
import { monthlyRecap, monthRange } from "../lib/monthly-recap";

const LIMITS = {
  settings: 1,
  muscles: 11,
  workouts: 1000,
  sets: 5000,
  water: 10000,
  meals: 3000,
  checkins: 1000,
  cardio: 3100,
  habits: 1000,
  habitLogs: 10000,
};
function bounded<T>(rows: T[], limit: number) {
  if (rows.length > limit)
    throw new ConvexError("History exceeds recap limits.");
  return rows;
}

export const month = query({
  args: { month: v.string(), now: v.number(), timeZone: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validHistoryClock(args.now, args.timeZone);
    const today = localClock(args.now, args.timeZone).localDay;
    let range: ReturnType<typeof monthRange>;
    try {
      range = monthRange(args.month, today);
    } catch {
      throw new ConvexError("Choose a month up to this one.");
    }
    const previous = new Date(`${range.fromDay}T00:00:00Z`);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    const previousFromDay = previous.toISOString().split("T")[0];
    // One UTC date of padding on each side covers local offsets and DST.
    const start = previous.getTime() - DAY_MS;
    const end = Math.min(args.now, (dayNumber(range.toDay) + 2) * DAY_MS - 1);
    const [
      settings,
      muscles,
      workouts,
      sets,
      water,
      meals,
      checkins,
      cardio,
      habits,
      habitLogs,
    ] = await Promise.all([
      ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(LIMITS.settings + 1),
      ctx.db
        .query("muscles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(LIMITS.muscles + 1),
      ctx.db
        .query("workouts")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).gte("trainedAt", start).lte("trainedAt", end),
        )
        .take(LIMITS.workouts + 1),
      // PRs and the weight trend need their baselines before these two months.
      ctx.db
        .query("strengthSets")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).lte("trainedAt", end),
        )
        .take(LIMITS.sets + 1),
      ctx.db
        .query("water")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).gte("at", start).lte("at", end),
        )
        .take(LIMITS.water + 1),
      ctx.db
        .query("meals")
        .withIndex("by_user_status_time", (q) =>
          q
            .eq("userId", userId)
            .eq("analysis.status", "ready")
            .gte("at", start)
            .lte("at", end),
        )
        .take(LIMITS.meals + 1),
      ctx.db
        .query("bodyCheckins")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", userId).lte("day", range.toDay),
        )
        .take(LIMITS.checkins + 1),
      ctx.db
        .query("cardioSessions")
        .withIndex("by_user_day", (q) =>
          q
            .eq("userId", userId)
            .gte("day", previousFromDay)
            .lte("day", range.toDay),
        )
        .take(LIMITS.cardio + 1),
      ctx.db
        .query("habits")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(LIMITS.habits + 1),
      // Keep earlier backfills: they can move a habit's first possible day back.
      ctx.db
        .query("habitLogs")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", userId).lte("day", range.toDay),
        )
        .take(LIMITS.habitLogs + 1),
    ]);
    return monthlyRecap({
      ...args,
      waterGoal: bounded(settings, LIMITS.settings)[0]?.waterGoal ?? 2500,
      muscles: bounded(muscles, LIMITS.muscles),
      workouts: bounded(workouts, LIMITS.workouts),
      sets: bounded(sets, LIMITS.sets),
      water: bounded(water, LIMITS.water),
      meals: bounded(meals, LIMITS.meals),
      checkins: bounded(checkins, LIMITS.checkins),
      cardio: bounded(cardio, LIMITS.cardio),
      habits: bounded(habits, LIMITS.habits),
      habitLogs: bounded(habitLogs, LIMITS.habitLogs),
    });
  },
});

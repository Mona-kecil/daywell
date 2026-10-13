import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { localClock, normalizeTimeZone } from "../lib/coach-time";
import { validTimestamp } from "./model";
import { DAY_MS, shiftDay } from "../lib/history";

export const HISTORY_LIMITS = {
  workouts: 1000,
  sets: 5000,
  water: 10000,
  checkins: 1000,
  muscles: 11,
};

export function validHistoryClock(now: number, timeZone: string) {
  validTimestamp(now);
  try {
    normalizeTimeZone(timeZone);
  } catch {
    throw new ConvexError("Choose a valid IANA time zone.");
  }
  // The civil-date APIs use four-digit years, like body check-ins.
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localClock(now, timeZone).localDay))
      throw new Error("Unsupported civil year");
  } catch {
    throw new ConvexError("Invalid timestamp.");
  }
}

export async function historyFor(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  now: number,
  timeZone: string,
  mode: "achievements" | "weekly" = "achievements",
) {
  const today = localClock(now, timeZone).localDay;
  const start = mode === "weekly" ? Math.max(0, now - 8 * DAY_MS) : 0;
  const fromDay = mode === "weekly" ? shiftDay(today, -6) : "0000-01-01";
  const [settings, muscles, workouts, sets, water, checkins] =
    await Promise.all([
      ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      ctx.db
        .query("muscles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(HISTORY_LIMITS.muscles + 1),
      ctx.db
        .query("workouts")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).gte("trainedAt", start).lte("trainedAt", now),
        )
        .take(HISTORY_LIMITS.workouts + 1),
      ctx.db
        .query("strengthSets")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).lte("trainedAt", now),
        )
        .take(HISTORY_LIMITS.sets + 1),
      ctx.db
        .query("water")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).gte("at", start).lte("at", now),
        )
        .take(HISTORY_LIMITS.water + 1),
      ctx.db
        .query("bodyCheckins")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", userId).gte("day", fromDay).lte("day", today),
        )
        .take(HISTORY_LIMITS.checkins + 1),
    ]);
  for (const [length, limit] of [
    [workouts.length, HISTORY_LIMITS.workouts],
    [sets.length, HISTORY_LIMITS.sets],
    [water.length, HISTORY_LIMITS.water],
    [checkins.length, HISTORY_LIMITS.checkins],
    [muscles.length, HISTORY_LIMITS.muscles],
  ])
    if (length > limit) throw new ConvexError("History exceeds review limits.");
  return {
    now,
    timeZone,
    waterGoal: settings?.waterGoal ?? 2500,
    muscleIds: muscles.map((m) => m._id),
    workouts,
    sets,
    water,
    checkins,
  };
}

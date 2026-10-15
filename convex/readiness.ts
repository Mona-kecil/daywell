import { ConvexError, v } from "convex/values";
import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { requireUser } from "./model";
import { validHistoryClock } from "./historyData";
import { localClock } from "../lib/coach-time";
import { activeMinutes } from "../lib/cardio";
import { DAY_MS, dayNumber, shiftDay } from "../lib/history";
import { readiness, type Readiness } from "../lib/readiness";

export const READINESS_LIMIT_MESSAGE = "History exceeds readiness limits.";

const LIMITS = { checkins: 29, sets: 5000, cardio: 400, muscles: 11 };
function bounded<T>(rows: T[], limit: number) {
  if (rows.length > limit) throw new ConvexError(READINESS_LIMIT_MESSAGE);
  return rows;
}

function localDayStart(day: string, timeZone: string): number {
  // Search the offset-padded UTC range so DST and fractional offsets retain
  // the exact local boundary, without charging padding rows against the limit.
  const utc = dayNumber(day) * DAY_MS;
  let start = utc - DAY_MS;
  let end = utc + DAY_MS;
  while (start < end) {
    const mid = Math.floor((start + end) / 2);
    if (localClock(mid, timeZone).localDay < day) start = mid + 1;
    else end = mid;
  }
  return start;
}

export async function loadReadiness(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  now: number,
  timeZone: string,
): Promise<Readiness> {
  validHistoryClock(now, timeZone);
  const day = localClock(now, timeZone).localDay;
  const loadFromDay = shiftDay(day, -27);
  const [checkins, sets, cardio, muscles] = await Promise.all([
    ctx.db
      .query("bodyCheckins")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).gte("day", shiftDay(day, -28)).lte("day", day),
      )
      .take(LIMITS.checkins + 1),
    ctx.db
      .query("strengthSets")
      .withIndex("by_user_time", (q) =>
        q
          .eq("userId", userId)
          .gte("trainedAt", localDayStart(loadFromDay, timeZone))
          .lte("trainedAt", now),
      )
      .take(LIMITS.sets + 1),
    ctx.db
      .query("cardioSessions")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).gte("day", loadFromDay).lte("day", day),
      )
      .take(LIMITS.cardio + 1),
    ctx.db
      .query("muscles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(LIMITS.muscles + 1),
  ]);
  // Count every indexed row against the cap before excluding post-slot writes.
  const dailyLoad = new Map<string, number>();
  for (const row of bounded(sets, LIMITS.sets).filter(
    (row) => row._creationTime <= now,
  )) {
    const setDay = localClock(row.trainedAt, timeZone).localDay;
    dailyLoad.set(setDay, (dailyLoad.get(setDay) ?? 0) + 1);
  }
  for (const row of bounded(cardio, LIMITS.cardio).filter(
    (row) => row.createdAt <= now && row._creationTime <= now,
  )) {
    dailyLoad.set(
      row.day,
      (dailyLoad.get(row.day) ?? 0) +
        activeMinutes(row.minutes, row.effort) / 10,
    );
  }
  const groups = bounded(muscles, LIMITS.muscles).filter(
    (row) => row._creationTime <= now,
  );
  return readiness({
    day,
    checkins: bounded(checkins, LIMITS.checkins).filter(
      (row) => row._creationTime <= now,
    ),
    soreMuscles: groups.filter(
      (row) => row.soreUntil !== undefined && row.soreUntil > now,
    ).length,
    totalMuscles: groups.length,
    dailyLoad: [...dailyLoad].map(([day, load]) => ({ day, load })),
  });
}

export const today = query({
  args: { now: v.number(), timeZone: v.string() },
  handler: async (ctx, { now, timeZone }): Promise<Readiness> => {
    const userId = await requireUser(ctx);
    return loadReadiness(ctx, userId, now, timeZone);
  },
});

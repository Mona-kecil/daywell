import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { validLocalDay } from "./model";
import { validHistoryClock } from "./historyData";
import { localClock } from "../lib/coach-time";
import { shiftDay } from "../lib/history";
import { stepCount } from "../lib/steps";

export const STEPS_LIMIT_MESSAGE = "History exceeds steps limits.";
const LIMITS = { settings: 1, day: 1, history: 373, all: 10000 };

function bounded<T>(rows: T[], limit: number) {
  if (rows.length > limit) throw new ConvexError(STEPS_LIMIT_MESSAGE);
  return rows;
}

export function validStepDay(day: string, now: number, timeZone: string) {
  validLocalDay(day);
  validHistoryClock(now, timeZone);
  const today = localClock(now, timeZone).localDay;
  if (day < shiftDay(today, -400) || day > shiftDay(today, 1))
    throw new ConvexError(
      "Use a day within the past 400 local days or tomorrow.",
    );
}

export async function stepSettings(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  now?: number,
) {
  const rows = await ctx.db
    .query("settings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(LIMITS.settings + 1);
  return (
    bounded(rows, LIMITS.settings).filter(
      (row) => now === undefined || row._creationTime <= now,
    )[0] ?? null
  );
}

export async function stepDays(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  fromDay: string,
  toDay: string,
  now: number,
  limit = LIMITS.history,
) {
  const rows = await ctx.db
    .query("steps")
    .withIndex("by_user_day", (q) =>
      q.eq("userId", userId).gte("day", fromDay).lte("day", toDay),
    )
    .take(limit + 1);
  return bounded(rows, limit).filter(
    (row) => row._creationTime <= now && row.updatedAt <= now,
  );
}

export async function allSteps(ctx: QueryCtx | MutationCtx, userId: string) {
  const rows = await ctx.db
    .query("steps")
    .withIndex("by_user_day", (q) => q.eq("userId", userId))
    .take(LIMITS.all + 1);
  return bounded(rows, LIMITS.all);
}

export async function stepForDay(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  day: string,
) {
  const rows = await ctx.db
    .query("steps")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
    .take(LIMITS.day + 1);
  return bounded(rows, LIMITS.day)[0] ?? null;
}

export async function upsertSteps(
  ctx: MutationCtx,
  userId: string,
  input: {
    day: string;
    count: number;
    timeZone: string;
    source: Doc<"steps">["source"];
  },
  now = Date.now(),
) {
  validStepDay(input.day, now, input.timeZone);
  const count = stepCount(input.count);
  const existing = await stepForDay(ctx, userId, input.day);
  const fields = {
    day: input.day,
    count,
    source: input.source,
    updatedAt: now,
  };
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("steps", { userId, ...fields });
  return { day: input.day, steps: count };
}

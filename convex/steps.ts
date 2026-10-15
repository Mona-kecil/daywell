import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./model";
import { validHistoryClock } from "./historyData";
import {
  stepDays,
  stepForDay,
  stepSettings,
  upsertSteps,
  validStepDay,
} from "./stepsModel";
import { localClock } from "../lib/coach-time";
import { addDays, mondayOf } from "../lib/cardio";
import { DEFAULT_STEP_GOAL, stepGoal, stepWeek } from "../lib/steps";

export const set = mutation({
  args: { day: v.string(), count: v.number(), timeZone: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return upsertSteps(ctx, userId, { ...args, source: "manual" });
  },
});

export const remove = mutation({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const settings = await stepSettings(ctx, userId);
    validStepDay(day, now, settings?.timeZone ?? "UTC");
    const row = await stepForDay(ctx, userId, day);
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

export const setGoal = mutation({
  args: { goal: v.union(v.number(), v.null()) },
  handler: async (ctx, { goal }) => {
    const userId = await requireUser(ctx);
    const value = goal === null ? undefined : stepGoal(goal);
    const settings = await stepSettings(ctx, userId);
    if (settings) await ctx.db.patch(settings._id, { stepGoal: value });
    else if (value !== undefined)
      await ctx.db.insert("settings", {
        userId,
        waterGoal: 2500,
        stepGoal: value,
      });
    return null;
  },
});

export const week = query({
  args: { now: v.number(), timeZone: v.string() },
  handler: async (ctx, { now, timeZone }) => {
    const userId = await requireUser(ctx);
    validHistoryClock(now, timeZone);
    const today = localClock(now, timeZone).localDay;
    const [settings, rows, synced] = await Promise.all([
      stepSettings(ctx, userId, now),
      stepDays(
        ctx,
        userId,
        addDays(today, -366),
        addDays(mondayOf(today), 6),
        now,
      ),
      // This index selects the latest sync across all days, including old imports.
      ctx.db
        .query("steps")
        .withIndex("by_user_source_updated", (q) =>
          q.eq("userId", userId).eq("source", "shortcut").lte("updatedAt", now),
        )
        .filter((q) => q.lte(q.field("_creationTime"), now))
        .order("desc")
        .take(1),
    ]);
    return {
      ...stepWeek(today, settings?.stepGoal ?? DEFAULT_STEP_GOAL, rows),
      lastSync: synced[0]?.updatedAt ?? null,
    };
  },
});

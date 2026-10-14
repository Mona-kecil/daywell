import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { dayZone, requireUser } from "./model";
import { DAY_MS, dayNumber, shiftDay } from "../lib/history";
import { weeklyVolume, weekStart } from "../lib/volume";
import { planWeek, type WeekPlan } from "../lib/week-plan";

const LIMIT = 5000;

export const week = query({
  args: { timeZone: v.optional(v.string()) },
  handler: async (ctx, args): Promise<WeekPlan> => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const [settings, muscles] = await Promise.all([
      ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      ctx.db
        .query("muscles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    ]);
    const timeZone = dayZone(args.timeZone, settings?.timeZone);
    const oldest = shiftDay(weekStart(now, timeZone), -7);
    // Match volume.weekly's two-week read window and UTC slack.
    const startMs = dayNumber(oldest) * DAY_MS - DAY_MS;
    const sets = await ctx.db
      .query("strengthSets")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("trainedAt", startMs).lte("trainedAt", now),
      )
      .take(LIMIT + 1);
    if (sets.length > LIMIT)
      throw new ConvexError("Weekly volume exceeds the 5,000-set limit.");
    const volume = weeklyVolume(
      sets,
      muscles.map((muscle) => ({ id: muscle._id, name: muscle.name })),
      { timeZone, weeks: 2, now },
    );
    const current = new Map(
      volume.muscles.map((muscle) => [muscle.id, muscle.current]),
    );
    const inputs = await Promise.all(
      muscles.map(async (muscle) => {
        const last = await ctx.db
          .query("workoutMuscles")
          .withIndex("by_user_muscle_time", (q) =>
            q.eq("userId", userId).eq("muscleId", muscle._id),
          )
          .order("desc")
          .first();
        return {
          id: muscle._id,
          name: muscle.name,
          cooldownHours: muscle.cooldownHours,
          lastTrainedAt: last?.trainedAt ?? null,
          current: current.get(muscle._id) ?? 0,
        };
      }),
    );
    return planWeek(inputs, { now, timeZone });
  },
});

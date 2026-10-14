import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { dayZone, requireUser } from "./model";
import { DAY_MS, dayNumber, shiftDay } from "../lib/history";
import { weeklyVolume, weekStart, type WeeklyVolume } from "../lib/volume";

const LIMIT = 5000;

export const weekly = query({
  args: { weeks: v.number(), timeZone: v.optional(v.string()) },
  handler: async (ctx, { weeks, ...args }): Promise<WeeklyVolume> => {
    const userId = await requireUser(ctx);
    if (!Number.isInteger(weeks) || weeks < 2 || weeks > 12)
      throw new ConvexError("Weeks must be an integer from 2–12.");
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
    const oldest = shiftDay(weekStart(now, timeZone), -7 * (weeks - 1));
    // One day of UTC slack covers local midnight; weeklyVolume filters it out.
    const startMs = dayNumber(oldest) * DAY_MS - DAY_MS;
    const sets = await ctx.db
      .query("strengthSets")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("trainedAt", startMs).lte("trainedAt", now),
      )
      .take(LIMIT + 1);
    if (sets.length > LIMIT)
      throw new ConvexError("Weekly volume exceeds the 5,000-set limit.");
    return weeklyVolume(
      sets,
      muscles.map((muscle) => ({ id: muscle._id, name: muscle.name })),
      { timeZone, weeks, now },
    );
  },
});

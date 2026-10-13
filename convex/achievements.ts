import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./model";
import { historyFor, validHistoryClock } from "./historyData";
import { computeAchievements } from "../lib/achievements";

export const list = query({
  args: { now: v.number(), timeZone: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validHistoryClock(args.now, args.timeZone);
    const data = await historyFor(ctx, userId, args.now, args.timeZone);
    const meals = await ctx.db
      .query("meals")
      .withIndex("by_user_status_time", (q) =>
        q
          .eq("userId", userId)
          .eq("analysis.status", "ready")
          .lte("at", args.now),
      )
      .take(10);
    return computeAchievements({ ...data, meals });
  },
});

import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { historyFor } from "./historyData";
import { DAY_MS } from "../lib/history";
import { weeklySummary } from "../lib/weekly-review";

export async function weeklyReviewFor(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  now: number,
  timeZone: string,
) {
  const data = await historyFor(ctx, userId, now, timeZone, "weekly");
  // Eight elapsed days cover seven civil dates across DST and timezone offset changes.
  const meals = await ctx.db
    .query("meals")
    .withIndex("by_user_status_time", (q) =>
      q
        .eq("userId", userId)
        .eq("analysis.status", "ready")
        .gte("at", Math.max(0, now - 8 * DAY_MS))
        .lte("at", now),
    )
    .take(501);
  if (meals.length > 500)
    throw new ConvexError("History exceeds review limits.");
  const summary = weeklySummary({ ...data, meals });
  // Check-ins are already stored as civil dates; the pure summary removes days before fromDay.
  return summary;
}

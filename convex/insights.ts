import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser, validTimestamp } from "./model";
import { mealTotals } from "../lib/nutrients";

// 13 weeks plus slack for DST shifts at either end.
const MAX_RANGE_MS = 93 * 24 * 3_600_000;

export const range = query({
  args: { startMs: v.number(), endMs: v.number() },
  handler: async (ctx, { startMs, endMs }) => {
    const userId = await requireUser(ctx);
    validTimestamp(startMs);
    validTimestamp(endMs);
    if (endMs <= startMs || endMs - startMs > MAX_RANGE_MS)
      throw new ConvexError("Invalid range.");
    const [settings, muscles, water, meals, workouts] = await Promise.all([
      ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      ctx.db
        .query("muscles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("water")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).gte("at", startMs).lt("at", endMs),
        )
        .collect(),
      ctx.db
        .query("meals")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).gte("at", startMs).lt("at", endMs),
        )
        .collect(),
      ctx.db
        .query("workouts")
        .withIndex("by_user_time", (q) =>
          q
            .eq("userId", userId)
            .gte("trainedAt", startMs)
            .lt("trainedAt", endMs),
        )
        .collect(),
    ]);
    // Muscles with a session before the range, so replay can tell a rested
    // muscle from one that hadn't been trained yet.
    const trainedBefore = (
      await Promise.all(
        muscles.map((m) =>
          ctx.db
            .query("workoutMuscles")
            .withIndex("by_user_muscle_time", (q) =>
              q
                .eq("userId", userId)
                .eq("muscleId", m._id)
                .lt("trainedAt", startMs),
            )
            .first(),
        ),
      )
    ).flatMap((row) => (row ? [row.muscleId] : []));
    return {
      waterGoal: settings?.waterGoal ?? 2500,
      trainedBefore,
      muscles: muscles.map((m) => ({ _id: m._id, name: m.name })),
      water: water.map((w) => ({ at: w.at, amountMl: w.amountMl })),
      meals: meals
        .filter((m) => m.analysis.status === "ready")
        .map((m) => ({ at: m.at, ...mealTotals(m.items) })),
      workouts: workouts.map((w) => ({
        trainedAt: w.trainedAt,
        muscleIds: w.muscleIds,
      })),
    };
  },
});

import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { EXERCISE_DEFAULTS } from "../lib/strength";

export const MAX_EXERCISES = 500;

export async function seedExercises(ctx: MutationCtx, userId: string) {
  const muscles = await ctx.db
    .query("muscles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const existing = await ctx.db
    .query("exercises")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const exercise of EXERCISE_DEFAULTS) {
    if (existing.some((row) => !row.custom && row.name === exercise.name))
      continue;
    const muscleIds = exercise.muscles.map((name) => {
      const muscle = muscles.find((row) => row.name === name);
      if (!muscle)
        throw new ConvexError("Initialize muscles before loading exercises.");
      return muscle._id;
    });
    await ctx.db.insert("exercises", {
      userId,
      name: exercise.name,
      muscleIds,
      custom: false,
    });
  }
}

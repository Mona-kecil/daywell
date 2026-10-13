import { ConvexError, v } from "convex/values";
import type { Auth } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { mealItem } from "./validators";
import { requireUser } from "./model";
import { MUSCLE_DEFAULTS } from "../lib/recovery";
import { isLocalDeployment } from "../lib/local-deployment";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";

export async function requireDevUser(ctx: { auth: Auth }) {
  if (
    !isLocalDeployment(process.env) ||
    !process.env.DEV_AUTH_JWKS ||
    (await requireUser(ctx)) !== DEV_USER ||
    (await ctx.auth.getUserIdentity())?.issuer !== DEV_ISSUER
  )
    throw new ConvexError(
      "Demo seed requires the configured dev-user identity.",
    );
}

export const replace = internalMutation({
  args: {
    now: v.number(),
    days: v.array(v.number()),
    meals: v.array(
      v.object({
        storageId: v.id("_storage"),
        at: v.number(),
        description: v.string(),
        items: v.array(mealItem),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireDevUser(ctx);
    if (args.days.length !== 14)
      throw new ConvexError("Seed requires fourteen days.");
    const userId = DEV_USER;
    const oldMeals = await ctx.db
      .query("meals")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .collect();
    for (const meal of oldMeals) {
      await ctx.storage.delete(meal.storageId);
      await ctx.db.delete(meal._id);
    }
    const records = [
      ...(await ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("muscles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("workouts")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("workoutMuscles")
        .withIndex("by_user_workout", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("water")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("uploads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()),
    ];
    for (const record of records) await ctx.db.delete(record._id);
    await ctx.db.insert("settings", { userId, waterGoal: 2500 });
    const muscles = new Map<string, Id<"muscles">>();
    for (const muscle of MUSCLE_DEFAULTS)
      muscles.set(
        muscle.name,
        await ctx.db.insert("muscles", { userId, ...muscle }),
      );
    const rotation = [
      { label: "Push", names: ["chest", "shoulders", "triceps"] },
      { label: "Pull", names: ["back", "biceps", "forearms"] },
      {
        label: "Legs",
        names: ["quads", "hamstrings", "glutes", "calves", "abs"],
      },
    ];
    let workouts = 0,
      water = 0;
    for (const [offset, start] of args.days.entries()) {
      if (offset % 4 !== 3) {
        const session = rotation[(offset - Math.floor(offset / 4)) % 3];
        const muscleIds = session.names.map((name) => {
          const id = muscles.get(name);
          if (!id) throw new ConvexError("Missing demo muscle.");
          return id;
        });
        const trainedAt = args.now - (offset * 24 + 2) * 3_600_000;
        const workoutId = await ctx.db.insert("workouts", {
          userId,
          muscleIds,
          trainedAt,
          note: `${session.label} · 3 sets per exercise, steady effort`,
        });
        for (const muscleId of muscleIds)
          await ctx.db.insert("workoutMuscles", {
            userId,
            muscleId,
            workoutId,
            trainedAt,
          });
        workouts++;
      }
      for (const [index, hour] of [7, 10, 13, 16, 19, 21].entries()) {
        const at =
          offset === 0
            ? start + ((args.now - start) * (index + 1)) / 7
            : start + hour * 3_600_000;
        await ctx.db.insert("water", {
          userId,
          amountMl: [350, 500, 400, 500, 350, 250][(index + offset) % 6],
          at,
        });
        water++;
      }
    }
    for (const meal of args.meals)
      await ctx.db.insert("meals", {
        userId,
        ...meal,
        revision: 1,
        analysis: { status: "ready" },
      });
    return {
      days: args.days.length,
      workouts,
      water,
      meals: args.meals.length,
      muscles: muscles.size,
    };
  },
});

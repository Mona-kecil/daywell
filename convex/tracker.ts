import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
  requireUser,
  positive,
  validDay,
  validTimestamp,
  createWorkout,
  createWater,
} from "./model";
import { dayArgs } from "./validators";
import { seedExercises } from "./exerciseModel";
import { readyAt } from "../lib/forecast";
import {
  MUSCLE_DEFAULTS,
  SORE_EXTEND_HOURS,
  SORE_MAX_HOURS,
} from "../lib/recovery";

export const initialize = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    if (
      !(await ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique())
    ) {
      await ctx.db.insert("settings", { userId, waterGoal: 2500 });
      for (const muscle of MUSCLE_DEFAULTS)
        await ctx.db.insert("muscles", { userId, ...muscle });
    }
    await seedExercises(ctx, userId);
  },
});
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const groups = await ctx.db
      .query("muscles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const muscles = await Promise.all(
      groups.map(async (group) => {
        const last = await ctx.db
          .query("workoutMuscles")
          .withIndex("by_user_muscle_time", (q) =>
            q.eq("userId", userId).eq("muscleId", group._id),
          )
          .order("desc")
          .first();
        return {
          ...group,
          lastTrainedAt: last?.trainedAt ?? null,
          soreUntil: group.soreUntil ?? null,
        };
      }),
    );
    return { waterGoal: settings?.waterGoal ?? 2500, muscles };
  },
});
export const setCooldown = mutation({
  args: { id: v.id("muscles"), hours: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    positive(args.hours, 720, "Cooldown hours");
    const muscle = await ctx.db.get(args.id);
    if (!muscle || muscle.userId !== userId)
      throw new ConvexError("Muscle not found.");
    await ctx.db.patch(args.id, { cooldownHours: args.hours });
  },
});
export const reportSore = mutation({
  args: { muscleId: v.id("muscles"), now: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validTimestamp(args.now);
    const muscle = await ctx.db.get(args.muscleId);
    if (!muscle || muscle.userId !== userId)
      throw new ConvexError("Muscle not found.");
    const last = await ctx.db
      .query("workoutMuscles")
      .withIndex("by_user_muscle_time", (q) =>
        q.eq("userId", userId).eq("muscleId", muscle._id),
      )
      .order("desc")
      .first();
    const currentReadyAt =
      readyAt(
        {
          ...muscle,
          lastTrainedAt: last?.trainedAt ?? null,
        },
        args.now,
      ) ?? args.now;
    const soreUntil = Math.min(
      Math.max(currentReadyAt, args.now) + SORE_EXTEND_HOURS * 3_600_000,
      args.now + SORE_MAX_HOURS * 3_600_000,
    );
    await ctx.db.patch(muscle._id, { soreUntil });
    return soreUntil;
  },
});
export const clearSore = mutation({
  args: { muscleId: v.id("muscles") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const muscle = await ctx.db.get(args.muscleId);
    if (!muscle || muscle.userId !== userId)
      throw new ConvexError("Muscle not found.");
    await ctx.db.patch(muscle._id, { soreUntil: undefined });
    return null;
  },
});
export const addWorkout = mutation({
  args: {
    muscleIds: v.array(v.id("muscles")),
    trainedAt: v.number(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return createWorkout(ctx, userId, args);
  },
});
export const workoutHistory = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return ctx.db
      .query("workouts")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
export const deleteWorkout = mutation({
  args: { id: v.id("workouts") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const workout = await ctx.db.get(args.id);
    if (!workout || workout.userId !== userId)
      throw new ConvexError("Workout not found.");
    const links = await ctx.db
      .query("workoutMuscles")
      .withIndex("by_user_workout", (q) =>
        q.eq("userId", userId).eq("workoutId", args.id),
      )
      .collect();
    for (const link of links) await ctx.db.delete(link._id);
    const sets = await ctx.db
      .query("strengthSets")
      .withIndex("by_user_workout", (q) =>
        q.eq("userId", userId).eq("workoutId", args.id),
      )
      .collect();
    for (const set of sets) await ctx.db.delete(set._id);
    await ctx.db.delete(args.id);
  },
});
export const waterToday = query({
  args: dayArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validDay(args.startMs, args.endMs);
    return ctx.db
      .query("water")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("at", args.startMs).lt("at", args.endMs),
      )
      .order("desc")
      .collect();
  },
});
export const addWater = mutation({
  args: { amountMl: v.number(), at: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return createWater(ctx, userId, args);
  },
});
export const setWaterGoal = mutation({
  args: { goal: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    positive(args.goal, 20_000, "Water goal");
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!settings)
      throw new ConvexError("Settings are not ready. Please refresh.");
    await ctx.db.patch(settings._id, { waterGoal: args.goal });
  },
});
export const deleteWater = mutation({
  args: { id: v.id("water") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const entry = await ctx.db.get(args.id);
    if (!entry || entry.userId !== userId)
      throw new ConvexError("Entry not found.");
    await ctx.db.delete(args.id);
  },
});

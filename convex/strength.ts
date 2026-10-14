import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { createWorkout, requireUser, validTimestamp } from "./model";
import {
  nextTarget as targetFromSessions,
  repRange,
  summarizeSets,
  type StrengthSet,
} from "../lib/strength";

async function ownedExercise(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  id: Id<"exercises">,
) {
  const exercise = await ctx.db.get(id);
  if (!exercise || exercise.userId !== userId)
    throw new ConvexError("Exercise not found.");
  return exercise;
}

export const exercises = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const muscles = await ctx.db
      .query("muscles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const names = new Map(muscles.map((m) => [m._id, m.name]));
    const rows = await ctx.db
      .query("exercises")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => ({
        _id: row._id,
        name: row.name,
        muscles: row.muscleIds.map((id) => names.get(id) ?? "Unknown muscle"),
        custom: row.custom,
      }));
  },
});

export const addExercise = mutation({
  args: { name: v.string(), muscleIds: v.array(v.id("muscles")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const name = args.name.trim();
    const muscleIds = [...new Set(args.muscleIds)];
    if (
      !name ||
      args.name.length > 100 ||
      !muscleIds.length ||
      muscleIds.length > 11
    )
      throw new ConvexError(
        "Enter a name of 1–100 characters and choose 1–11 muscles.",
      );
    for (const id of muscleIds) {
      const muscle = await ctx.db.get(id);
      if (!muscle || muscle.userId !== userId)
        throw new ConvexError("Muscle not found.");
    }
    return ctx.db.insert("exercises", {
      userId,
      name,
      muscleIds,
      custom: true,
    });
  },
});

export const deleteExercise = mutation({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const exercise = await ownedExercise(ctx, userId, args.id);
    if (!exercise.custom)
      throw new ConvexError("Only custom exercises can be deleted.");
    const referenced = await ctx.db
      .query("strengthSets")
      .withIndex("by_user_exercise_time", (q) =>
        q.eq("userId", userId).eq("exerciseId", args.id),
      )
      .first();
    if (referenced)
      throw new ConvexError("Delete the workouts using this exercise first.");
    await ctx.db.delete(args.id);
    const routines = await ctx.db
      .query("routines")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const routine of routines)
      if (routine.exerciseIds.includes(args.id))
        await ctx.db.patch(routine._id, {
          exerciseIds: routine.exerciseIds.filter((id) => id !== args.id),
        });
    return null;
  },
});

const setInput = v.object({ reps: v.number(), weightKg: v.number() });
export const logSession = mutation({
  args: {
    trainedAt: v.number(),
    note: v.string(),
    entries: v.array(
      v.object({ exerciseId: v.id("exercises"), sets: v.array(setInput) }),
    ),
    extraMuscleIds: v.optional(v.array(v.id("muscles"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (
      !args.entries.length ||
      args.entries.length > 50 ||
      new Set(args.entries.map((e) => e.exerciseId)).size !==
        args.entries.length ||
      args.entries.reduce((total, entry) => total + entry.sets.length, 0) > 500
    )
      throw new ConvexError(
        "Choose 1–50 distinct exercises and at most 500 sets.",
      );
    const muscleIds = new Set(args.extraMuscleIds ?? []);
    const entries = [];
    for (const entry of args.entries) {
      const exercise = await ownedExercise(ctx, userId, entry.exerciseId);
      if (!entry.sets.length || entry.sets.length > 20)
        throw new ConvexError("Record 1–20 sets per exercise.");
      for (const set of entry.sets) {
        if (
          !Number.isInteger(set.reps) ||
          set.reps < 1 ||
          set.reps > 100 ||
          !Number.isFinite(set.weightKg) ||
          set.weightKg < 0 ||
          set.weightKg > 1000
        )
          throw new ConvexError(
            "Reps must be an integer from 1–100; weight must be 0–1000 kg.",
          );
      }
      for (const id of exercise.muscleIds) muscleIds.add(id);
      entries.push({ exercise, sets: entry.sets });
    }
    const workoutId = await createWorkout(ctx, userId, {
      trainedAt: args.trainedAt,
      note: args.note,
      muscleIds: [...muscleIds],
    });
    let order = 0;
    for (const entry of entries)
      for (const set of entry.sets)
        await ctx.db.insert("strengthSets", {
          userId,
          workoutId,
          exerciseId: entry.exercise._id,
          muscleIds: entry.exercise.muscleIds,
          trainedAt: args.trainedAt,
          ...set,
          order: order++,
        });
    return workoutId;
  },
});

export const session = query({
  args: { workoutId: v.id("workouts") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const workout = await ctx.db.get(args.workoutId);
    if (!workout || workout.userId !== userId) return null;
    const sets = await ctx.db
      .query("strengthSets")
      .withIndex("by_user_workout", (q) =>
        q.eq("userId", userId).eq("workoutId", args.workoutId),
      )
      .collect();
    const entries = new Map<
      Id<"exercises">,
      {
        exerciseId: Id<"exercises">;
        name: string;
        sets: {
          _id: Id<"strengthSets">;
          reps: number;
          weightKg: number;
          order: number;
        }[];
      }
    >();
    for (const set of sets.sort((a, b) => a.order - b.order)) {
      let entry = entries.get(set.exerciseId);
      if (!entry) {
        const exercise = await ownedExercise(ctx, userId, set.exerciseId);
        entry = { exerciseId: exercise._id, name: exercise.name, sets: [] };
        entries.set(set.exerciseId, entry);
      }
      entry.sets.push({
        _id: set._id,
        reps: set.reps,
        weightKg: set.weightKg,
        order: set.order,
      });
    }
    return {
      workoutId: workout._id,
      trainedAt: workout.trainedAt,
      note: workout.note,
      entries: [...entries.values()],
    };
  },
});

export const exerciseHistory = query({
  args: { exerciseId: v.id("exercises"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ownedExercise(ctx, userId, args.exerciseId);
    const limit = args.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ConvexError("Limit must be an integer from 1–100.");
    const rows = await ctx.db
      .query("strengthSets")
      .withIndex("by_user_exercise_time", (q) =>
        q.eq("userId", userId).eq("exerciseId", args.exerciseId),
      )
      .order("asc")
      .collect();
    const sessions = new Map<
      Id<"workouts">,
      {
        workoutId: Id<"workouts">;
        trainedAt: number;
        sets: { reps: number; weightKg: number }[];
      }
    >();
    for (const row of rows.sort(
      (a, b) => a.trainedAt - b.trainedAt || a.order - b.order,
    )) {
      let entry = sessions.get(row.workoutId);
      if (!entry) {
        entry = {
          workoutId: row.workoutId,
          trainedAt: row.trainedAt,
          sets: [],
        };
        sessions.set(row.workoutId, entry);
      }
      entry.sets.push({ reps: row.reps, weightKg: row.weightKg });
    }
    const summaries = [...sessions.values()].map((s) => ({
      ...s,
      ...summarizeSets(s.sets),
    }));
    let prE1rm = 0,
      prWeightKg = 0;
    let prAt: number | null = null;
    for (const s of summaries) {
      if (s.bestE1rm > prE1rm) {
        prE1rm = s.bestE1rm;
        prAt = s.trainedAt;
      }
      prWeightKg = Math.max(prWeightKg, s.topSetKg);
    }
    return {
      sessions: summaries.reverse().slice(0, limit),
      prE1rm,
      prWeightKg,
      prAt,
    };
  },
});

export const nextTarget = query({
  args: { exerciseId: v.id("exercises"), now: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const exercise = await ownedExercise(ctx, userId, args.exerciseId);
    if (!Number.isFinite(args.now)) throw new ConvexError("Invalid timestamp.");
    const rows = await ctx.db
      .query("strengthSets")
      .withIndex("by_user_exercise_time", (q) =>
        q.eq("userId", userId).eq("exerciseId", args.exerciseId),
      )
      .order("desc")
      .take(200);
    const sessions = new Map<
      Id<"workouts">,
      { trainedAt: number; sets: StrengthSet[] }
    >();
    for (const row of rows
      .reverse()
      .sort((a, b) => a.trainedAt - b.trainedAt || a.order - b.order)) {
      let entry = sessions.get(row.workoutId);
      if (!entry) {
        entry = { trainedAt: row.trainedAt, sets: [] };
        sessions.set(row.workoutId, entry);
      }
      entry.sets.push({ reps: row.reps, weightKg: row.weightKg });
    }
    return targetFromSessions(
      [...sessions.values()].slice(-2),
      args.now,
      repRange(exercise.name),
    );
  },
});

export const weeklyMuscleSets = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validTimestamp(args.now);
    const muscles = await ctx.db
      .query("muscles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const sets = await ctx.db
      .query("strengthSets")
      .withIndex("by_user_time", (q) =>
        q
          .eq("userId", userId)
          .gte("trainedAt", Math.max(0, args.now - 7 * 86_400_000))
          .lte("trainedAt", args.now),
      )
      .collect();
    const counts = new Map<Id<"muscles">, number>();
    for (const set of sets)
      for (const id of set.muscleIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    return muscles.map((m) => ({
      muscleId: m._id,
      name: m.name,
      sets: counts.get(m._id) ?? 0,
    }));
  },
});

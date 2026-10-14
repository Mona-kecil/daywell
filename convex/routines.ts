import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./model";

async function ownedRoutine(
  ctx: MutationCtx,
  userId: string,
  id: Id<"routines">,
) {
  const routine = await ctx.db.get(id);
  if (!routine || routine.userId !== userId)
    throw new ConvexError("Routine not found.");
  return routine;
}

function validName(
  value: string,
  routines: Doc<"routines">[],
  id?: Id<"routines">,
) {
  const name = value.trim();
  if (!name || name.length > 40)
    throw new ConvexError("Enter a name of 1–40 characters.");
  if (
    routines.some(
      (routine) =>
        routine._id !== id && routine.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new ConvexError(`You already have a routine called ${name}.`);
  return name;
}

async function validExercises(
  ctx: MutationCtx,
  userId: string,
  exerciseIds: Id<"exercises">[],
) {
  if (
    !exerciseIds.length ||
    exerciseIds.length > 25 ||
    new Set(exerciseIds).size !== exerciseIds.length
  )
    throw new ConvexError("Choose 1–25 distinct exercises.");
  for (const id of exerciseIds) {
    const exercise = await ctx.db.get(id);
    if (!exercise || exercise.userId !== userId)
      throw new ConvexError("Exercise not found.");
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const routines = await ctx.db
      .query("routines")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const muscles = await ctx.db
      .query("muscles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const names = new Map(muscles.map((m) => [m._id, m.name]));
    const rows = [];
    for (const routine of routines.sort(
      (a, b) =>
        (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt) ||
        a.name.localeCompare(b.name),
    )) {
      const exercises = [];
      for (const id of routine.exerciseIds) {
        const exercise = await ctx.db.get(id);
        if (!exercise || exercise.userId !== userId) continue;
        exercises.push({
          _id: exercise._id,
          name: exercise.name,
          muscles: exercise.muscleIds.map(
            (id) => names.get(id) ?? "Unknown muscle",
          ),
          custom: exercise.custom,
        });
      }
      rows.push({
        _id: routine._id,
        name: routine.name,
        lastUsedAt: routine.lastUsedAt ?? null,
        exercises,
      });
    }
    return rows;
  },
});

export const create = mutation({
  args: { name: v.string(), exerciseIds: v.array(v.id("exercises")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const routines = await ctx.db
      .query("routines")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const name = validName(args.name, routines);
    await validExercises(ctx, userId, args.exerciseIds);
    if (routines.length >= 30)
      throw new ConvexError("You can save at most 30 routines.");
    return ctx.db.insert("routines", {
      userId,
      name,
      exerciseIds: args.exerciseIds,
      createdAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: { id: v.id("routines"), name: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ownedRoutine(ctx, userId, args.id);
    const routines = await ctx.db
      .query("routines")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    await ctx.db.patch(args.id, {
      name: validName(args.name, routines, args.id),
    });
    return null;
  },
});

export const update = mutation({
  args: { id: v.id("routines"), exerciseIds: v.array(v.id("exercises")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ownedRoutine(ctx, userId, args.id);
    await validExercises(ctx, userId, args.exerciseIds);
    await ctx.db.patch(args.id, { exerciseIds: args.exerciseIds });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("routines") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const routine = await ownedRoutine(ctx, userId, args.id);
    await ctx.db.delete(args.id);
    return { name: routine.name, exerciseIds: routine.exerciseIds };
  },
});

export const markUsed = mutation({
  args: { id: v.id("routines") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ownedRoutine(ctx, userId, args.id);
    await ctx.db.patch(args.id, { lastUsedAt: Date.now() });
    return null;
  },
});

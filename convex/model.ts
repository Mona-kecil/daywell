import { ConvexError } from "convex/values";
import type { Auth } from "convex/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
export async function requireUser(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to continue.");
  return identity.subject;
}
export function positive(value: number, max: number, name: string) {
  if (!Number.isFinite(value) || value <= 0 || value > max)
    throw new ConvexError(`${name} must be greater than 0 and at most ${max}.`);
}
export function validTimestamp(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 8_640_000_000_000_000)
    throw new ConvexError("Invalid timestamp.");
}
export function validDay(startMs: number, endMs: number) {
  validTimestamp(startMs);
  validTimestamp(endMs);
  if (endMs <= startMs || endMs - startMs > 26 * 3_600_000)
    throw new ConvexError("Invalid day range.");
}
export async function ownedMeal(ctx: QueryCtx | MutationCtx, id: Id<"meals">) {
  const userId = await requireUser(ctx);
  const meal = await ctx.db.get(id);
  if (!meal || meal.userId !== userId) throw new ConvexError("Meal not found.");
  return meal;
}

export async function createWorkout(
  ctx: MutationCtx,
  userId: string,
  args: {
    muscleIds: Id<"muscles">[];
    trainedAt: number;
    note: string;
  },
) {
  validTimestamp(args.trainedAt);
  const ids = [...new Set(args.muscleIds)];
  if (!ids.length || ids.length > 11 || args.note.length > 2000)
    throw new ConvexError(
      "Choose muscles and keep the note under 2,000 characters.",
    );
  for (const id of ids) {
    const muscle = await ctx.db.get(id);
    if (!muscle || muscle.userId !== userId)
      throw new ConvexError("Muscle not found.");
  }
  const workoutId = await ctx.db.insert("workouts", {
    userId,
    muscleIds: ids,
    trainedAt: args.trainedAt,
    note: args.note.trim(),
  });
  for (const muscleId of ids)
    await ctx.db.insert("workoutMuscles", {
      userId,
      muscleId,
      workoutId,
      trainedAt: args.trainedAt,
    });
  return workoutId;
}

export function validLocalDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new ConvexError("Use a valid YYYY-MM-DD day.");
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== day
  )
    throw new ConvexError("Use a valid YYYY-MM-DD day.");
  return timestamp;
}

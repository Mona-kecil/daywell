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

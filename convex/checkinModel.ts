import { ConvexError, v, type ObjectType } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { validLocalDay } from "./model";

const optionalNumber = v.optional(v.union(v.number(), v.null()));
export const checkinFields = {
  day: v.string(),
  weightKg: optionalNumber,
  waistCm: optionalNumber,
  sleepHours: optionalNumber,
  mood: optionalNumber,
  energy: optionalNumber,
  note: v.optional(v.union(v.string(), v.null())),
};
export type CheckinInput = ObjectType<typeof checkinFields>;

export async function upsertCheckin(
  ctx: MutationCtx,
  userId: string,
  args: CheckinInput,
) {
  validLocalDay(args.day);
  for (const [name, value, min, max, integer] of [
    ["Weight", args.weightKg, 20, 400, false],
    ["Waist", args.waistCm, 40, 200, false],
    ["Sleep", args.sleepHours, 0, 24, false],
    ["Mood", args.mood, 1, 5, true],
    ["Energy", args.energy, 1, 5, true],
  ] satisfies [string, number | null | undefined, number, number, boolean][]) {
    if (value === undefined || value === null) continue;
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      throw new ConvexError(
        `${name} must be ${integer ? "an integer " : ""}from ${min}–${max}.`,
      );
  }
  if (args.note !== undefined && args.note !== null && args.note.length > 280)
    throw new ConvexError("Keep the note to 280 characters.");
  const fields: Partial<
    Pick<
      Doc<"bodyCheckins">,
      "weightKg" | "waistCm" | "sleepHours" | "mood" | "energy" | "note"
    >
  > = {};
  if (args.weightKg !== undefined) fields.weightKg = args.weightKg ?? undefined;
  if (args.waistCm !== undefined) fields.waistCm = args.waistCm ?? undefined;
  if (args.sleepHours !== undefined)
    fields.sleepHours = args.sleepHours ?? undefined;
  if (args.mood !== undefined) fields.mood = args.mood ?? undefined;
  if (args.energy !== undefined) fields.energy = args.energy ?? undefined;
  if (args.note !== undefined) fields.note = args.note ?? undefined;
  const existing = await ctx.db
    .query("bodyCheckins")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", args.day))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return existing._id;
  }
  return ctx.db.insert("bodyCheckins", { userId, day: args.day, ...fields });
}

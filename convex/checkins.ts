import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireUser, validLocalDay } from "./model";

const optionalNumber = v.optional(v.union(v.number(), v.null()));
export const upsert = mutation({
  args: {
    day: v.string(),
    weightKg: optionalNumber,
    sleepHours: optionalNumber,
    mood: optionalNumber,
    energy: optionalNumber,
    note: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validLocalDay(args.day);
    for (const [name, value, min, max, integer] of [
      ["Weight", args.weightKg, 20, 400, false],
      ["Sleep", args.sleepHours, 0, 24, false],
      ["Mood", args.mood, 1, 5, true],
      ["Energy", args.energy, 1, 5, true],
    ] satisfies [
      string,
      number | null | undefined,
      number,
      number,
      boolean,
    ][]) {
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
        "weightKg" | "sleepHours" | "mood" | "energy" | "note"
      >
    > = {};
    if (args.weightKg !== undefined)
      fields.weightKg = args.weightKg ?? undefined;
    if (args.sleepHours !== undefined)
      fields.sleepHours = args.sleepHours ?? undefined;
    if (args.mood !== undefined) fields.mood = args.mood ?? undefined;
    if (args.energy !== undefined) fields.energy = args.energy ?? undefined;
    if (args.note !== undefined) fields.note = args.note ?? undefined;
    const existing = await ctx.db
      .query("bodyCheckins")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).eq("day", args.day),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return ctx.db.insert("bodyCheckins", { userId, day: args.day, ...fields });
  },
});

export const get = query({
  args: { day: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validLocalDay(args.day);
    return ctx.db
      .query("bodyCheckins")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).eq("day", args.day),
      )
      .unique();
  },
});

export const range = query({
  args: { fromDay: v.string(), toDay: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const start = validLocalDay(args.fromDay),
      end = validLocalDay(args.toDay);
    if (end < start || (end - start) / 86_400_000 + 1 > 400)
      throw new ConvexError("Choose an ascending range of at most 400 days.");
    return ctx.db
      .query("bodyCheckins")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).gte("day", args.fromDay).lte("day", args.toDay),
      )
      .collect();
  },
});

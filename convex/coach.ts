import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { positive, requireUser } from "./model";
import { DEFAULT_CHECK_INS } from "../lib/coach";

async function userSettings(ctx: QueryCtx | MutationCtx) {
  const userId = await requireUser(ctx);
  return ctx.db
    .query("settings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}
async function writableSettings(ctx: MutationCtx) {
  const row = await userSettings(ctx);
  if (!row) throw new ConvexError("Settings are not ready. Please refresh.");
  return row;
}
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const row = await userSettings(ctx);
    return {
      waterGoal: row?.waterGoal ?? 2500,
      kcalTarget: row?.kcalTarget ?? null,
      proteinTarget: row?.proteinTarget ?? null,
      timeZone: row?.timeZone ?? null,
      checkIns: row?.checkIns ?? DEFAULT_CHECK_INS,
      remindersEnabled: row?.remindersEnabled ?? false,
    };
  },
});
export const setTargets = mutation({
  args: {
    kcalTarget: v.optional(v.number()),
    proteinTarget: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await writableSettings(ctx);
    if (args.kcalTarget !== undefined)
      positive(args.kcalTarget, 20_000, "Calorie target");
    if (args.proteinTarget !== undefined)
      positive(args.proteinTarget, 1000, "Protein target");
    await ctx.db.patch(row._id, {
      kcalTarget: args.kcalTarget,
      proteinTarget: args.proteinTarget,
    });
  },
});
export const setCheckIns = mutation({
  args: { checkIns: v.array(v.string()) },
  handler: async (ctx, args) => {
    const row = await writableSettings(ctx);
    if (
      args.checkIns.length > 24 ||
      args.checkIns.some((slot) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot)) ||
      new Set(args.checkIns).size !== args.checkIns.length
    )
      throw new ConvexError("Choose up to 24 distinct times in HH:MM format.");
    await ctx.db.patch(row._id, { checkIns: [...args.checkIns].sort() });
  },
});
export const setTimeZone = mutation({
  args: { timeZone: v.string() },
  handler: async (ctx, args) => {
    const row = await writableSettings(ctx);
    let timeZone: string;
    try {
      timeZone = new Intl.DateTimeFormat("en-US", {
        timeZone: args.timeZone,
      }).resolvedOptions().timeZone;
    } catch {
      throw new ConvexError("Choose a valid IANA time zone.");
    }
    await ctx.db.patch(row._id, { timeZone });
  },
});
export const setRemindersEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const row = await writableSettings(ctx);
    if (args.enabled && !row.timeZone)
      throw new ConvexError("Set your time zone before enabling reminders.");
    await ctx.db.patch(row._id, { remindersEnabled: args.enabled });
  },
});

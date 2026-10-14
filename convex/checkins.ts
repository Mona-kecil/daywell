import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, validLocalDay } from "./model";
import { checkinFields, upsertCheckin } from "./checkinModel";

export const upsert = mutation({
  args: checkinFields,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return upsertCheckin(ctx, userId, args);
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

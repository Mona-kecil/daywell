import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./model";
import { dayArgs } from "./validators";

export const add = mutation({
  args: { mg: v.number(), label: v.string(), at: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (!Number.isFinite(args.mg) || args.mg < 1 || args.mg > 1000)
      throw new ConvexError("Caffeine amount must be between 1 and 1,000 mg.");
    const label = args.label.trim();
    if (!label || label.length > 40)
      throw new ConvexError("Enter a label of 1–40 characters.");
    const now = Date.now();
    if (
      !Number.isFinite(args.at) ||
      args.at < now - 7 * 86_400_000 ||
      args.at > now + 5 * 60_000
    )
      throw new ConvexError(
        "Use a time within the past 7 days or next 5 minutes.",
      );
    return ctx.db.insert("caffeine", {
      userId,
      mg: args.mg,
      label,
      at: args.at,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("caffeine") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const entry = await ctx.db.get(args.id);
    if (!entry || entry.userId !== userId)
      throw new ConvexError("Entry not found.");
    await ctx.db.delete(args.id);
  },
});

export const list = query({
  args: dayArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (
      !Number.isFinite(args.startMs) ||
      !Number.isFinite(args.endMs) ||
      args.endMs <= args.startMs ||
      args.endMs - args.startMs > 48 * 3_600_000
    )
      throw new ConvexError("Use a time range of at most 48 hours.");
    return ctx.db
      .query("caffeine")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("at", args.startMs).lt("at", args.endMs),
      )
      .order("asc")
      .collect();
  },
});

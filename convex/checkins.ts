import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, validLocalDay } from "./model";
import { checkinFields, upsertCheckin } from "./checkinModel";
import { shiftDay } from "../lib/history";
import { goalEta, trendSeries, weeklyRate } from "../lib/weight-trend";

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

export const weightTrend = query({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validLocalDay(args.today);
    const fromDay = shiftDay(args.today, -119);
    const [checkins, settings] = await Promise.all([
      ctx.db
        .query("bodyCheckins")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", userId).gte("day", fromDay).lte("day", args.today),
        )
        .collect(),
      ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    ]);
    const weighIns = checkins.flatMap((row) =>
      row.weightKg === undefined
        ? []
        : [{ day: row.day, weightKg: row.weightKg }],
    );
    const points = trendSeries(weighIns);
    const latestKg = weighIns.at(-1)?.weightKg ?? null;
    const trendKg = points.at(-1)?.trendKg ?? null;
    const ratePerWeek = weeklyRate(points);
    const goalKg = settings?.goalWeightKg ?? null;
    return {
      points,
      latestKg,
      trendKg,
      ratePerWeek,
      goalKg,
      eta: goalEta({ trendKg, ratePerWeek, goalKg, today: args.today }),
      waist: checkins.flatMap((row) =>
        row.waistCm === undefined
          ? []
          : [{ day: row.day, waistCm: row.waistCm }],
      ),
    };
  },
});

import { internalMutation } from "./_generated/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { dueSlots } from "../lib/coach-time";
import { DAY_MS, dayNumber } from "../lib/history";
import {
  isoWeek,
  weeklyReviewText,
  type WeeklySummary,
} from "../lib/weekly-review";
import { weeklyReviewFor } from "./weeklyReviewData";

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cursor = await ctx.db
      .query("coachRuns")
      .withIndex("by_key", (q) => q.eq("key", "weekly-review"))
      .unique();
    const since = cursor?.lastRunAt ?? now - 15 * 60_000;
    const until = Math.min(now, since + DAY_MS);
    if (until <= since) return;
    const users = await ctx.db
      .query("settings")
      .withIndex("by_reminders", (q) => q.eq("remindersEnabled", true))
      .collect();
    for (const settings of users) {
      if (!settings.timeZone) continue;
      const subscription = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", settings.userId))
        .first();
      if (!subscription) continue;
      for (const due of dueSlots({
        since,
        now: until,
        timeZone: settings.timeZone,
        checkIns: ["19:00"],
      })) {
        if (new Date(dayNumber(due.localDay) * DAY_MS).getUTCDay() !== 0)
          continue;
        const week = isoWeek(due.localDay);
        const existing = await ctx.db
          .query("coachSent")
          .withIndex("by_user_day_slot", (q) =>
            q
              .eq("userId", settings.userId)
              .eq("localDay", week)
              .eq("slot", "weekly-review"),
          )
          .unique();
        if (existing) continue;
        let summary: WeeklySummary;
        try {
          summary = await weeklyReviewFor(
            ctx,
            settings.userId,
            due.at,
            settings.timeZone,
          );
        } catch (error) {
          if (
            !(error instanceof ConvexError) ||
            error.data !== "History exceeds review limits."
          )
            throw error;
          console.error("Weekly review skipped", {
            userId: settings.userId,
            reason: "history-limit",
          });
          continue;
        }
        const sentId = await ctx.db.insert("coachSent", {
          userId: settings.userId,
          localDay: week,
          slot: "weekly-review",
          createdAt: now,
          delivery: {
            status: "pending",
            payload: {
              ...weeklyReviewText(summary),
              kind: "weekly-review",
              slot: `${week}/weekly-review`,
            },
          },
        });
        await ctx.scheduler.runAfter(0, internal.pushActions.deliver, {
          sentId,
        });
      }
    }
    if (cursor) await ctx.db.patch(cursor._id, { lastRunAt: until });
    else
      await ctx.db.insert("coachRuns", {
        key: "weekly-review",
        lastRunAt: until,
      });
  },
});

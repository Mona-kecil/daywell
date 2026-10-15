import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { dueSlots } from "../lib/coach-time";
import { DEFAULT_CHECK_INS, inReadinessWindow } from "../lib/coach";
import { readinessForCoach, suggestionsFor } from "./coachData";

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cursor = await ctx.db
      .query("coachRuns")
      .withIndex("by_key", (q) => q.eq("key", "check-ins"))
      .unique();
    const since = cursor?.lastRunAt ?? now - 15 * 60_000;
    // Drain a long outage in daily batches instead of exceeding a mutation's execution limit.
    const until = Math.min(now, since + 24 * 3_600_000);
    if (until <= since) return;
    const users = await ctx.db
      .query("settings")
      .withIndex("by_reminders", (q) => q.eq("remindersEnabled", true))
      .collect();
    for (const settings of users) {
      if (!settings.timeZone) continue;
      const slots = dueSlots({
        since,
        now: until,
        timeZone: settings.timeZone,
        checkIns: settings.checkIns ?? DEFAULT_CHECK_INS,
      });
      if (slots.length === 0) continue;
      await ctx.scheduler.runAfter(0, internal.coachCron.runUser, {
        userId: settings.userId,
        since,
        until,
      });
    }
    if (cursor) await ctx.db.patch(cursor._id, { lastRunAt: until });
    else
      await ctx.db.insert("coachRuns", { key: "check-ins", lastRunAt: until });
  },
});

export const runUser = internalMutation({
  args: { userId: v.string(), since: v.number(), until: v.number() },
  handler: async (ctx, { userId, since, until }) => {
    const now = Date.now();
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!settings?.remindersEnabled || !settings.timeZone) return;
    const slots = dueSlots({
      since,
      now: until,
      timeZone: settings.timeZone,
      checkIns: settings.checkIns ?? DEFAULT_CHECK_INS,
    });
    let readiness: ReturnType<typeof readinessForCoach> | undefined;
    for (const due of slots) {
      const existing = await ctx.db
        .query("coachSent")
        .withIndex("by_user_day_slot", (q) =>
          q
            .eq("userId", userId)
            .eq("localDay", due.localDay)
            .eq("slot", due.slot),
        )
        .unique();
      if (existing) continue;
      // Reuse the first in-window estimate throughout this user's outage batch.
      if (inReadinessWindow(due.localMinutes))
        readiness ??= readinessForCoach(ctx, userId, due.at, settings.timeZone);
      const top = (
        await suggestionsFor(
          ctx,
          settings,
          due.at,
          settings.timeZone,
          readiness,
        )
      )[0];
      if (!top) continue;
      const sentId = await ctx.db.insert("coachSent", {
        userId,
        localDay: due.localDay,
        slot: due.slot,
        createdAt: now,
        delivery: {
          status: "pending",
          payload: {
            title: top.title,
            body: top.body,
            kind: top.kind,
            slot: `${due.localDay}/${due.slot}`,
          },
        },
      });
      await ctx.scheduler.runAfter(0, internal.pushActions.deliver, {
        sentId,
      });
    }
  },
});

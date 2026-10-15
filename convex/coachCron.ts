import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { dueSlots } from "../lib/coach-time";
import { DEFAULT_CHECK_INS, inReadinessWindow } from "../lib/coach";
import { readinessForCoach, suggestionsFor } from "./coachData";

export const COACH_FANOUT_PAGE = 200;
export const COACH_FRESHNESS_MS = 2 * 3_600_000;

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
    const until = cursor?.pageCursor
      ? (cursor.windowUntil ?? Math.min(now, since + 24 * 3_600_000))
      : Math.min(now, since + 24 * 3_600_000);
    if (until <= since) return;
    const users = await ctx.db
      .query("settings")
      .withIndex("by_reminders", (q) => q.eq("remindersEnabled", true))
      .paginate({
        numItems: COACH_FANOUT_PAGE,
        cursor: cursor?.pageCursor ?? null,
      });
    for (const settings of users.page) {
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
    // Every invocation writes this document, so OCC serializes cron/continuation races.
    // The page's schedules and cursor update commit in the same transaction.
    const progress = users.isDone
      ? { lastRunAt: until, windowUntil: undefined, pageCursor: undefined }
      : {
          lastRunAt: since,
          windowUntil: until,
          pageCursor: users.continueCursor,
        };
    if (cursor) await ctx.db.patch(cursor._id, progress);
    else await ctx.db.insert("coachRuns", { key: "check-ins", ...progress });
    if (!users.isDone)
      await ctx.scheduler.runAfter(0, internal.coachCron.run, {});
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
    // One slot: 1 settings + 1 sent + 1,000 water + 300 meals + 50 muscles
    // + 50 last workouts + 200 habits + 400 logs + 351 cardio + 1 recent cardio
    // + 8 steps + 5,444 readiness + 60 saved meals = 7,866 documents.
    // Readiness: 30 check-ins + 5,001 sets + 401 cardio + 12 muscles = 5,444.
    // Caps apply before JS filters. A unique() read stops at two on duplicates
    // and aborts before loading history, so it cannot exceed this budget.
    const due = slots
      .filter((slot) => slot.at >= now - COACH_FRESHNESS_MS)
      .at(-1);
    if (!due) return;
    const existing = await ctx.db
      .query("coachSent")
      .withIndex("by_user_day_slot", (q) =>
        q
          .eq("userId", userId)
          .eq("localDay", due.localDay)
          .eq("slot", due.slot),
      )
      .unique();
    // A retry must not backfill an older slot after the latest one was sent.
    if (existing) return;
    const readiness = inReadinessWindow(due.localMinutes)
      ? readinessForCoach(ctx, userId, due.at, settings.timeZone)
      : undefined;
    const top = (
      await suggestionsFor(ctx, settings, due.at, settings.timeZone, readiness)
    )[0];
    if (!top) return;
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
    await ctx.scheduler.runAfter(0, internal.pushActions.deliver, { sentId });
  },
});

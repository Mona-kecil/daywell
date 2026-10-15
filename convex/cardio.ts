import { ConvexError, v, type ObjectType } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser, validLocalDay } from "./model";
import { cardioKind, cardioEffort } from "./validators";
import { cardioHistory, MAX_SESSIONS_PER_DAY } from "./cardioModel";
import {
  ACTIVE_MINUTES_GOAL,
  activeMinutes,
  addDays,
  cardioKcal,
  formatPace,
  mondayOf,
  pace,
  type CardioKind,
} from "../lib/cardio";

const sessionFields = {
  kind: cardioKind,
  effort: cardioEffort,
  day: v.string(),
  minutes: v.number(),
  distanceKm: v.optional(v.union(v.number(), v.null())),
  note: v.optional(v.string()),
};
const oneDp = (value: number) => Math.round(value * 10) / 10;
const twoDp = (value: number) => Math.round(value * 100) / 100;

async function validatedSession(
  ctx: MutationCtx,
  userId: string,
  args: ObjectType<typeof sessionFields>,
  id?: Id<"cardioSessions">,
) {
  validLocalDay(args.day);
  if (args.day > addDays(new Date(Date.now()).toISOString().slice(0, 10), 1))
    throw new ConvexError("That day is in the future.");
  if (!Number.isFinite(args.minutes) || args.minutes < 1 || args.minutes > 600)
    throw new ConvexError("Duration must be from 1–600 minutes.");
  const distanceKm =
    args.distanceKm == null ? undefined : twoDp(args.distanceKm);
  if (
    (args.distanceKm != null && args.distanceKm > 1000) ||
    (distanceKm !== undefined &&
      (!Number.isFinite(distanceKm) || distanceKm <= 0))
  )
    throw new ConvexError("Distance must be up to 1000 km.");
  const note = args.note?.trim() || undefined;
  if (note !== undefined && note.length > 200)
    throw new ConvexError("Note must be 200 characters or fewer.");
  const sessions = await ctx.db
    .query("cardioSessions")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", args.day))
    .take(MAX_SESSIONS_PER_DAY);
  if (
    sessions.filter((session) => session._id !== id).length >=
    MAX_SESSIONS_PER_DAY
  )
    throw new ConvexError("That's a lot of sessions for one day.");
  return {
    kind: args.kind,
    effort: args.effort,
    day: args.day,
    minutes: oneDp(args.minutes),
    distanceKm,
    note,
  };
}

export const add = mutation({
  args: sessionFields,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const fields = await validatedSession(ctx, userId, args);
    return ctx.db.insert("cardioSessions", {
      userId,
      ...fields,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: { id: v.id("cardioSessions"), ...sessionFields },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const session = await ctx.db.get(args.id);
    if (!session || session.userId !== userId)
      throw new ConvexError("Entry not found.");
    await ctx.db.patch(
      args.id,
      await validatedSession(ctx, userId, args, args.id),
    );
  },
});

export const remove = mutation({
  args: { id: v.id("cardioSessions") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const session = await ctx.db.get(args.id);
    if (!session || session.userId !== userId)
      throw new ConvexError("Entry not found.");
    await ctx.db.delete(args.id);
  },
});

export const week = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const userId = await requireUser(ctx);
    validLocalDay(today);
    const weekStart = mondayOf(today);
    const weekEnd = addDays(weekStart, 6);
    const historyStart = addDays(weekStart, -52 * 7);
    const rows = await ctx.db
      .query("cardioSessions")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).gte("day", historyStart).lte("day", weekEnd),
      )
      .take(53 * 7 * MAX_SESSIONS_PER_DAY);
    const byWeek = new Map<string, number>();
    for (const row of rows) {
      const start = mondayOf(row.day);
      byWeek.set(
        start,
        (byWeek.get(start) ?? 0) + activeMinutes(row.minutes, row.effort),
      );
    }
    const current = rows
      .filter((row) => row.day >= weekStart)
      .sort((a, b) => b.day.localeCompare(a.day) || b.createdAt - a.createdAt);
    const checkins = await ctx.db
      .query("bodyCheckins")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).lte("day", weekEnd),
      )
      .order("desc")
      .take(400);
    const weights = new Map(
      [...new Set(current.map((row) => row.day))].map(
        (day) =>
          [
            day,
            checkins.find((row) => row.day <= day && row.weightKg !== undefined)
              ?.weightKg ?? null,
          ] as const,
      ),
    );
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const sessions = current.filter((row) => row.day === day);
      return {
        day,
        minutes: oneDp(sessions.reduce((sum, row) => sum + row.minutes, 0)),
        activeMinutes: oneDp(
          sessions.reduce(
            (sum, row) => sum + activeMinutes(row.minutes, row.effort),
            0,
          ),
        ),
      };
    });
    const totals = new Map<
      CardioKind,
      { kind: CardioKind; minutes: number; distanceKm: number }
    >();
    for (const row of current) {
      const total = totals.get(row.kind) ?? {
        kind: row.kind,
        minutes: 0,
        distanceKm: 0,
      };
      total.minutes += row.minutes;
      total.distanceKm += row.distanceKm ?? 0;
      totals.set(row.kind, total);
    }
    const weekActiveMinutes = oneDp(byWeek.get(weekStart) ?? 0);
    let streakWeeks = weekActiveMinutes >= ACTIVE_MINUTES_GOAL ? 1 : 0;
    for (let i = 1; i <= 52; i++) {
      if (
        oneDp(byWeek.get(addDays(weekStart, -i * 7)) ?? 0) < ACTIVE_MINUTES_GOAL
      )
        break;
      streakWeeks++;
    }
    return {
      weekStart,
      days,
      sessions: current.map((row) => {
        const p = pace(row.kind, row.distanceKm ?? null, row.minutes);
        return {
          id: row._id,
          createdAt: row.createdAt,
          kind: row.kind,
          effort: row.effort,
          day: row.day,
          minutes: row.minutes,
          distanceKm: row.distanceKm ?? null,
          note: row.note ?? null,
          pace: p === null ? null : formatPace(p),
          activeMinutes: activeMinutes(row.minutes, row.effort),
          kcal: cardioKcal(
            row.kind,
            row.effort,
            row.minutes,
            weights.get(row.day) ?? null,
          ),
        };
      }),
      minutes: oneDp(days.reduce((sum, day) => sum + day.minutes, 0)),
      activeMinutes: weekActiveMinutes,
      goal: ACTIVE_MINUTES_GOAL,
      lastWeekActiveMinutes: oneDp(byWeek.get(addDays(weekStart, -7)) ?? 0),
      streakWeeks,
      totals: [...totals.values()]
        .map((total) => ({
          ...total,
          minutes: oneDp(total.minutes),
          distanceKm: twoDp(total.distanceKm),
        }))
        .sort((a, b) => b.minutes - a.minutes),
    };
  },
});

export const bests = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    let longestRunKm: number | null = null;
    let longestRideKm: number | null = null;
    let fastest: { day: string; distanceKm: number; seconds: number } | null =
      null;
    for await (const rows of cardioHistory(ctx, userId)) {
      for (const row of rows) {
        if (row.distanceKm === undefined) continue;
        if (row.kind === "ride")
          longestRideKm = Math.max(longestRideKm ?? 0, row.distanceKm);
        if (row.kind !== "run") continue;
        longestRunKm = Math.max(longestRunKm ?? 0, row.distanceKm);
        if (row.distanceKm < 1) continue;
        const seconds = (row.minutes * 60) / row.distanceKm;
        if (
          fastest === null ||
          seconds < fastest.seconds ||
          (seconds === fastest.seconds && row.day < fastest.day)
        )
          fastest = { day: row.day, distanceKm: row.distanceKm, seconds };
      }
    }
    return {
      longestRunKm,
      longestRideKm,
      fastestRun:
        fastest === null
          ? null
          : {
              day: fastest.day,
              distanceKm: fastest.distanceKm,
              pace: formatPace({ unit: "/km", seconds: fastest.seconds }),
            },
    };
  },
});

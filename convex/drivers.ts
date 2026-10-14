import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { dayZone, requireUser } from "./model";
import { localClock } from "../lib/coach-time";
import { DAY_MS, shiftDay } from "../lib/history";
import { drivers, type DayRow, type Finding } from "../lib/drivers";
import { mealTotals } from "../lib/nutrients";

export type DriversResult = {
  days: number;
  // Days with both mood and energy, not weight/sleep-only check-ins.
  checkInDays: number;
  // Minimum check-in coverage; sufficient factor variation is also required.
  needed: number;
  findings: Finding[];
};

const LOG_LIMIT = 10_000;

export const list = query({
  // timeZone: the device zone check-in days were dated in (see dayZone).
  args: { days: v.number(), timeZone: v.optional(v.string()) },
  handler: async (ctx, args): Promise<DriversResult> => {
    const { days } = args;
    const userId = await requireUser(ctx);
    if (!Number.isInteger(days) || days < 14 || days > 120)
      throw new ConvexError("Choose a whole number of days from 14–120.");
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const timeZone = dayZone(args.timeZone, settings?.timeZone);
    const now = Date.now();
    const today = localClock(now, timeZone).localDay;
    const firstDay = shiftDay(today, 1 - days);
    // One UTC day of slack covers all IANA offsets, including DST changes.
    // Filter the slack by civil date below; never pair it into the findings.
    const startMs = Date.parse(`${firstDay}T00:00:00Z`) - DAY_MS;
    const [checkins, water, meals, caffeine, workouts] = await Promise.all([
      ctx.db
        .query("bodyCheckins")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", userId).gte("day", firstDay).lte("day", today),
        )
        .take(days + 1),
      ctx.db
        .query("water")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).gte("at", startMs).lte("at", now),
        )
        .take(LOG_LIMIT + 1),
      ctx.db
        .query("meals")
        .withIndex("by_user_status_time", (q) =>
          q
            .eq("userId", userId)
            .eq("analysis.status", "ready")
            .gte("at", startMs)
            .lte("at", now),
        )
        .take(LOG_LIMIT + 1),
      ctx.db
        .query("caffeine")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).gte("at", startMs).lte("at", now),
        )
        .take(LOG_LIMIT + 1),
      ctx.db
        .query("workouts")
        .withIndex("by_user_time", (q) =>
          q
            .eq("userId", userId)
            .gte("trainedAt", startMs)
            .lte("trainedAt", now),
        )
        .take(LOG_LIMIT + 1),
    ]);
    if (
      checkins.length > days ||
      [water, meals, caffeine, workouts].some((logs) => logs.length > LOG_LIMIT)
    )
      throw new ConvexError("History exceeds pattern review limits.");

    const rows = new Map<string, DayRow>();
    for (let i = 0; i < days; i++) {
      const day = shiftDay(firstDay, i);
      rows.set(day, { day, factors: {}, outcomes: {} });
    }
    for (const checkin of checkins) {
      const row = rows.get(checkin.day);
      if (!row) continue;
      row.factors.trained = 0;
      if (checkin.sleepHours !== undefined)
        row.factors.sleepHours = checkin.sleepHours;
      if (checkin.mood !== undefined) row.outcomes.mood = checkin.mood;
      if (checkin.energy !== undefined) row.outcomes.energy = checkin.energy;
    }
    for (const log of water) {
      const row = rows.get(localClock(log.at, timeZone).localDay);
      if (row) row.factors.waterMl = (row.factors.waterMl ?? 0) + log.amountMl;
    }
    for (const meal of meals) {
      const row = rows.get(localClock(meal.at, timeZone).localDay);
      if (!row) continue;
      const totals = mealTotals(meal.items);
      row.factors.proteinG = (row.factors.proteinG ?? 0) + totals.protein;
      row.factors.kcal = (row.factors.kcal ?? 0) + totals.kcal;
    }
    let firstCaffeineDay: string | undefined;
    for (const dose of caffeine) {
      const clock = localClock(dose.at, timeZone);
      const row = rows.get(clock.localDay);
      if (!row) continue;
      if (firstCaffeineDay === undefined || clock.localDay < firstCaffeineDay)
        firstCaffeineDay = clock.localDay;
      row.factors.caffeineMg = (row.factors.caffeineMg ?? 0) + dose.mg;
      row.factors.lateCaffeineMg =
        (row.factors.lateCaffeineMg ?? 0) +
        (clock.localMinutes >= 14 * 60 ? dose.mg : 0);
    }
    // Caffeine is known on dose days, and assumed zero on later days only
    // after a dose in this window. Before the first dose it stays unknown.
    // This is a logging convention, not evidence of abstinence.
    for (const row of rows.values()) {
      if (firstCaffeineDay !== undefined && row.day >= firstCaffeineDay) {
        row.factors.caffeineMg ??= 0;
        row.factors.lateCaffeineMg ??= 0;
      }
    }
    for (const workout of workouts) {
      const row = rows.get(localClock(workout.trainedAt, timeZone).localDay);
      if (row) row.factors.trained = 1;
    }
    const dayRows = [...rows.values()];
    const checkInDays = dayRows.filter(
      (row) =>
        row.outcomes.mood !== undefined && row.outcomes.energy !== undefined,
    ).length;
    return {
      days,
      checkInDays,
      needed: Math.max(0, 10 - checkInDays),
      findings: drivers(dayRows),
    };
  },
});

import { ConvexError } from "convex/values";
import { activeMinutes, addDays, mondayOf } from "../lib/cardio";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  coachSuggestions,
  inReadinessWindow,
  type CoachInput,
} from "../lib/coach";
import { localClock } from "../lib/coach-time";
import { mealTotals, sumNutrients } from "../lib/nutrients";
import { loadReadiness, READINESS_LIMIT_MESSAGE } from "./readiness";

export async function readinessForCoach(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  now: number,
  timeZone: string,
): Promise<CoachInput["readiness"]> {
  try {
    const result = await loadReadiness(ctx, userId, now, timeZone);
    const weakest = result.components[0];
    return {
      score: result.score,
      band: result.band,
      ...(weakest && weakest.score < 50 ? { weakest: weakest.key } : {}),
    };
  } catch (error) {
    if (error instanceof ConvexError && error.data === READINESS_LIMIT_MESSAGE)
      return undefined;
    throw error;
  }
}

export async function todayDataFor(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  now: number,
  timeZone: string,
) {
  const { localDay, localMinutes } = localClock(now, timeZone);
  // A civil day can span 25 hours during a DST fold. Include an extra hour for historical offsets.
  const start = Math.max(0, now - 26 * 3_600_000);
  const [water, meals, groups] = await Promise.all([
    ctx.db
      .query("water")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("at", start).lte("at", now),
      )
      .collect(),
    ctx.db
      .query("meals")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("at", start).lte("at", now),
      )
      .collect(),
    ctx.db
      .query("muscles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  ]);
  const todayMeals = meals.filter(
    (m) => localClock(m.at, timeZone).localDay === localDay,
  );
  const muscles = await Promise.all(
    groups.map(async (m) => {
      const last = await ctx.db
        .query("workoutMuscles")
        .withIndex("by_user_muscle_time", (q) =>
          q.eq("userId", userId).eq("muscleId", m._id).lte("trainedAt", now),
        )
        .order("desc")
        .first();
      return {
        name: m.name,
        cooldownHours: m.cooldownHours,
        soreUntil: m.soreUntil ?? null,
        lastTrainedAt: last?.trainedAt ?? null,
      };
    }),
  );
  return {
    day: localDay,
    localMinutes,
    waterMl: water
      .filter((w) => localClock(w.at, timeZone).localDay === localDay)
      .reduce((sum, w) => sum + w.amountMl, 0),
    macros: sumNutrients(
      todayMeals
        .filter((m) => m.analysis.status === "ready")
        .map((m) => mealTotals(m.items)),
    ),
    mealCount: todayMeals.length,
    muscles,
  };
}

export async function suggestionsFor(
  ctx: QueryCtx | MutationCtx,
  settings: Pick<
    Doc<"settings">,
    "userId" | "waterGoal" | "kcalTarget" | "proteinTarget"
  >,
  now: number,
  timeZone: string,
  // Chat loads readiness for its snapshot too; share that read.
  readiness?: Promise<CoachInput["readiness"]>,
) {
  const today = await todayDataFor(ctx, settings.userId, now, timeZone);
  const { localDay } = localClock(now, timeZone);
  const weekday = new Date(`${localDay}T00:00:00Z`).getUTCDay() || 7;
  const monday = mondayOf(localDay);
  const [habits, habitLogs, cardio, recentCardio, todayReadiness] =
    await Promise.all([
      ctx.db
        .query("habits")
        .withIndex("by_user", (q) => q.eq("userId", settings.userId))
        .filter((q) => q.eq(q.field("archivedAt"), undefined))
        .collect(),
      ctx.db
        .query("habitLogs")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", settings.userId).eq("day", today.day),
        )
        .collect(),
      ctx.db
        .query("cardioSessions")
        .withIndex("by_user_day", (q) =>
          q
            .eq("userId", settings.userId)
            .gte("day", monday)
            .lte("day", localDay),
        )
        .take(351),
      ctx.db
        .query("cardioSessions")
        .withIndex("by_user_day", (q) =>
          q
            .eq("userId", settings.userId)
            .gte("day", addDays(monday, -28))
            .lt("day", monday),
        )
        .first(),
      // Up to a month of history, so only read it when it can change a nudge.
      inReadinessWindow(today.localMinutes)
        ? (readiness ?? readinessForCoach(ctx, settings.userId, now, timeZone))
        : undefined,
    ]);
  // Only people who do cardio hear about it: something this week or in the four before.
  const cardioUser = cardio.length > 0 || recentCardio !== null;
  return coachSuggestions({
    now,
    localMinutes: today.localMinutes,
    timeZone,
    waterGoal: settings.waterGoal,
    waterMl: today.waterMl,
    macros: today.macros,
    mealCount: today.mealCount,
    targets: {
      kcalTarget: settings.kcalTarget,
      proteinTarget: settings.proteinTarget,
    },
    muscles: today.muscles,
    readiness: todayReadiness,
    habits: habits.map((habit) => ({
      id: habit._id,
      name: habit.name,
      order: habit.order,
    })),
    habitLogs,
    cardio:
      cardio.length > 350 || !cardioUser
        ? undefined
        : {
            weekActiveMinutes: cardio.reduce(
              (sum, row) => sum + activeMinutes(row.minutes, row.effort),
              0,
            ),
            todayMinutes: cardio
              .filter((row) => row.day === localDay)
              .reduce((sum, row) => sum + row.minutes, 0),
            weekday,
          },
  });
}

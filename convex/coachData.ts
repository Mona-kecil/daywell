import { loadSavedMeals } from "./savedMeals";
import { servingTotals } from "../lib/saved-meals";
import { stepDays } from "./stepsModel";
import { DEFAULT_STEP_GOAL } from "../lib/steps";
import { ConvexError } from "convex/values";
import { activeMinutes, addDays, mondayOf } from "../lib/cardio";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  coachSuggestions,
  foodTargetState,
  inReadinessWindow,
  type CoachInput,
} from "../lib/coach";
import { localClock } from "../lib/coach-time";
import { mealTotals, sumNutrients } from "../lib/nutrients";
import { loadReadiness, READINESS_LIMIT_MESSAGE } from "./readiness";

export const COACH_WATER_LIMIT = 1_000;
export const COACH_MEAL_LIMIT = 300;
export const COACH_HABIT_LIMIT = 200;
export const COACH_HABIT_LOG_LIMIT = 400;
export const COACH_MUSCLE_LIMIT = 50;

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
  // Caps keep the first N indexed rows. Heavy water days sum only those rows
  // in the 26-hour window; water and meal totals can undercount the local day.
  // Muscle suggestions consider only the first COACH_MUSCLE_LIMIT groups.
  const [water, meals, groups] = await Promise.all([
    ctx.db
      .query("water")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("at", start).lte("at", now),
      )
      .take(COACH_WATER_LIMIT),
    ctx.db
      .query("meals")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("at", start).lte("at", now),
      )
      .take(COACH_MEAL_LIMIT),
    ctx.db
      .query("muscles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(COACH_MUSCLE_LIMIT),
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
    "userId" | "waterGoal" | "kcalTarget" | "proteinTarget" | "stepGoal"
  >,
  now: number,
  timeZone: string,
  // Chat loads readiness for its snapshot too; share that read.
  readiness?: Promise<CoachInput["readiness"]>,
  loadRecipes: () => ReturnType<typeof loadSavedMeals> = () =>
    loadSavedMeals(ctx, settings.userId),
) {
  const today = await todayDataFor(ctx, settings.userId, now, timeZone);
  const targets = {
    kcalTarget: settings.kcalTarget,
    proteinTarget: settings.proteinTarget,
  };
  const savedMeals = foodTargetState({ ...today, targets }).proteinBehind
    ? (await loadRecipes()).map((row) => ({
        id: row._id,
        name: row.name,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        ...servingTotals(row.items, row.servings).perServing,
      }))
    : undefined;
  const { localDay } = localClock(now, timeZone);
  const weekday = new Date(`${localDay}T00:00:00Z`).getUTCDay() || 7;
  const monday = mondayOf(localDay);
  const [habits, habitLogs, cardio, recentCardio, todayReadiness, steps] =
    await Promise.all([
      ctx.db
        .query("habits")
        .withIndex("by_user", (q) => q.eq("userId", settings.userId))
        // Cap before filtering so archived habits also count against the scan budget.
        .take(COACH_HABIT_LIMIT),
      ctx.db
        .query("habitLogs")
        .withIndex("by_user_day", (q) =>
          q.eq("userId", settings.userId).eq("day", today.day),
        )
        .take(COACH_HABIT_LOG_LIMIT),
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
      stepDays(ctx, settings.userId, addDays(localDay, -6), localDay, now, 7),
    ]);
  // Only people who do cardio hear about it: something this week or in the four before.
  const cardioUser = cardio.length > 0 || recentCardio !== null;
  return coachSuggestions({
    now,
    savedMeals,
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
    steps: {
      today: steps.find((row) => row.day === localDay)?.count ?? null,
      goal: settings.stepGoal ?? DEFAULT_STEP_GOAL,
      recentDays: new Set(steps.map((row) => row.day)).size,
    },
    // Caps can omit active habits or completion logs beyond the first N rows.
    habits: habits
      .filter((habit) => habit.archivedAt === undefined)
      .map((habit) => ({
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

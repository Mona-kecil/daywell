import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { coachSuggestions } from "../lib/coach";
import { localClock } from "../lib/coach-time";
import { mealTotals, sumNutrients } from "../lib/nutrients";

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
) {
  const today = await todayDataFor(ctx, settings.userId, now, timeZone);
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
  });
}

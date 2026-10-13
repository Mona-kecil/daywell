import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./model";
import { mealTotals } from "../lib/nutrients";

export const all = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const [
      settings,
      muscles,
      workouts,
      sets,
      exercises,
      water,
      meals,
      checkins,
    ] = await Promise.all([
      ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      ctx.db
        .query("muscles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("workouts")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("strengthSets")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("exercises")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("water")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("meals")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("bodyCheckins")
        .withIndex("by_user_day", (q) => q.eq("userId", userId))
        .collect(),
    ]);
    const names = new Map(exercises.map((e) => [e._id, e.name]));
    const workoutSets = new Map<Id<"workouts">, Doc<"strengthSets">[]>();
    for (const set of sets) {
      const rows = workoutSets.get(set.workoutId) ?? [];
      rows.push(set);
      workoutSets.set(set.workoutId, rows);
    }
    return {
      version: 1,
      exportedAt: Date.now(),
      settings: settings
        ? {
            waterGoal: settings.waterGoal,
            kcalTarget: settings.kcalTarget,
            proteinTarget: settings.proteinTarget,
            timeZone: settings.timeZone,
            checkIns: settings.checkIns,
            remindersEnabled: settings.remindersEnabled,
          }
        : null,
      muscles: muscles.map((m) => ({
        id: m._id,
        name: m.name,
        cooldownHours: m.cooldownHours,
      })),
      workouts: workouts.map((w) => ({
        id: w._id,
        muscleIds: w.muscleIds,
        trainedAt: w.trainedAt,
        note: w.note,
        sets: (workoutSets.get(w._id) ?? [])
          .sort((a, b) => a.order - b.order)
          .map((s) => ({
            id: s._id,
            exerciseId: s.exerciseId,
            exerciseName: names.get(s.exerciseId) ?? "Unknown exercise",
            muscleIds: s.muscleIds,
            reps: s.reps,
            weightKg: s.weightKg,
            order: s.order,
          })),
      })),
      exercises: exercises
        .filter((e) => e.custom)
        .map((e) => ({ id: e._id, name: e.name, muscleIds: e.muscleIds })),
      water: water.map((w) => ({ id: w._id, amountMl: w.amountMl, at: w.at })),
      meals: meals.map((m) => ({
        id: m._id,
        description: m.description,
        at: m.at,
        items: m.items,
        totals: mealTotals(m.items),
        status: m.analysis.status,
        ...(m.analysis.status === "error" ? { error: m.analysis.message } : {}),
      })),
      checkins: checkins.map((c) => ({
        id: c._id,
        day: c.day,
        weightKg: c.weightKg,
        sleepHours: c.sleepHours,
        mood: c.mood,
        energy: c.energy,
        note: c.note,
      })),
    };
  },
});

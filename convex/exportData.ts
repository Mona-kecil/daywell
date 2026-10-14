import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { cardioHistory } from "./cardioModel";
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
      caffeine,
      habits,
      habitLogs,
      meals,
      checkins,
      progressPhotos,
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
        .query("caffeine")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("habits")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("habitLogs")
        .withIndex("by_user_day", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("meals")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("bodyCheckins")
        .withIndex("by_user_day", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("progressPhotos")
        .withIndex("by_user_day", (q) => q.eq("userId", userId))
        .collect(),
    ]);
    const cardioSessions = [];
    for await (const rows of cardioHistory(ctx, userId))
      cardioSessions.push(...rows);
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
        soreUntil: m.soreUntil ?? null,
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
      cardioSessions: cardioSessions.map((session) => ({
        id: session._id,
        kind: session.kind,
        effort: session.effort,
        day: session.day,
        minutes: session.minutes,
        distanceKm: session.distanceKm ?? null,
        note: session.note ?? null,
        createdAt: session.createdAt,
      })),
      caffeine: caffeine.map((c) => ({
        id: c._id,
        at: c.at,
        mg: c.mg,
        label: c.label,
      })),
      habits: habits.map((habit) => ({
        id: habit._id,
        name: habit.name,
        icon: habit.icon,
        order: habit.order,
        createdAt: habit.createdAt,
        archivedAt: habit.archivedAt ?? null,
      })),
      habitLogs: habitLogs.map((log) => ({
        id: log._id,
        habitId: log.habitId,
        day: log.day,
      })),
      meals: meals.map((m) => ({
        id: m._id,
        description: m.description,
        at: m.at,
        items: m.items,
        totals: mealTotals(m.items),
        status: m.analysis.status,
        ...(m.analysis.status === "error" ? { error: m.analysis.message } : {}),
      })),
      progressPhotos: progressPhotos.map((photo) => ({
        pose: photo.pose,
        day: photo.day,
        takenAt: photo.takenAt,
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

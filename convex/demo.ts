import { addDays } from "../lib/cardio";
import { localClock } from "../lib/coach-time";
import { ConvexError, v } from "convex/values";
import type { Auth } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { allSteps, upsertSteps } from "./stepsModel";
import { cardioHistory } from "./cardioModel";
import type { CardioKind, CardioEffort } from "../lib/cardio";
import { mealItem } from "./validators";
import { seedExercises } from "./exerciseModel";
import { requireUser, createWorkout, validLocalDay } from "./model";
import { MUSCLE_DEFAULTS } from "../lib/recovery";
import { isLocalDeployment } from "../lib/local-deployment";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";
import { HABIT_ICONS, lastDays } from "../lib/habits";

export async function requireDevUser(ctx: { auth: Auth }) {
  if (
    !isLocalDeployment(process.env) ||
    !process.env.DEV_AUTH_JWKS ||
    (await requireUser(ctx)) !== DEV_USER ||
    (await ctx.auth.getUserIdentity())?.issuer !== DEV_ISSUER
  )
    throw new ConvexError(
      "Demo seed requires the configured dev-user identity.",
    );
}

export const replace = internalMutation({
  args: {
    now: v.number(),
    days: v.array(v.number()),
    checkinDays: v.optional(v.array(v.string())),
    meals: v.array(
      v.object({
        storageId: v.id("_storage"),
        at: v.number(),
        description: v.string(),
        items: v.array(mealItem),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireDevUser(ctx);
    if (args.days.length !== 14)
      throw new ConvexError("Seed requires fourteen days.");
    const checkinDays =
      args.checkinDays ??
      Array.from({ length: 90 }, (_, i) =>
        new Date(args.days[0] - i * 86_400_000).toISOString().slice(0, 10),
      );
    if (checkinDays.length !== 90 || new Set(checkinDays).size !== 90)
      throw new ConvexError("Seed requires ninety distinct check-in days.");
    for (const day of checkinDays) validLocalDay(day);
    const userId = DEV_USER;
    const oldMeals = await ctx.db
      .query("meals")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .collect();
    for (const meal of oldMeals) {
      if (meal.storageId) await ctx.storage.delete(meal.storageId);
      await ctx.db.delete(meal._id);
    }
    const oldProgressPhotos = await ctx.db
      .query("progressPhotos")
      .withIndex("by_user_day", (q) => q.eq("userId", userId))
      .collect();
    for (const photo of oldProgressPhotos) {
      await ctx.storage.delete(photo.storageId);
      await ctx.db.delete(photo._id);
    }
    for await (const rows of cardioHistory(ctx, userId))
      for (const row of rows) await ctx.db.delete(row._id);
    for (const row of await allSteps(ctx, userId)) await ctx.db.delete(row._id);
    const records = [
      ...(await ctx.db
        .query("bodyCheckins")
        .withIndex("by_user_day", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("muscles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("workouts")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("workoutMuscles")
        .withIndex("by_user_workout", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("strengthSets")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("exercises")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("water")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("caffeine")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("habits")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("habitLogs")
        .withIndex("by_user_day", (q) => q.eq("userId", userId))
        .collect()),
      ...(await ctx.db
        .query("uploads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()),
    ];
    for (const record of records) await ctx.db.delete(record._id);
    const priorSettings = records.find((record) => "waterGoal" in record);
    const timeZone =
      priorSettings && "timeZone" in priorSettings
        ? priorSettings.timeZone
        : undefined;
    await ctx.db.insert("settings", { userId, waterGoal: 2500, timeZone });
    const stepsToday =
      args.checkinDays?.[0] ?? localClock(args.now, timeZone ?? "UTC").localDay;
    for (let offset = 0; offset < 60; offset++) {
      if (offset % 13 === 5) continue;
      await upsertSteps(
        ctx,
        userId,
        {
          day: addDays(stepsToday, -offset),
          count:
            offset % 17 === 0 ? 8000 : 4000 + ((offset * 1733 + 2150) % 8001),
          timeZone: timeZone ?? "UTC",
          source: offset % 9 === 0 ? "manual" : "shortcut",
        },
        args.now,
      );
    }
    const habitDays = lastDays(checkinDays[0], 28);
    const demoHabits = [
      { name: "Vitamins", icon: "pill" },
      { name: "Stretch 10 min", icon: "stretch" },
      { name: "Read", icon: "book" },
    ] satisfies { name: string; icon: (typeof HABIT_ICONS)[number] }[];
    for (const [order, habit] of demoHabits.entries()) {
      const habitId = await ctx.db.insert("habits", {
        userId,
        ...habit,
        order,
        createdAt: new Date(`${habitDays[0]}T00:00:00Z`).getTime(),
      });
      for (const [index, day] of habitDays.entries()) {
        if ((index + order * 2) % (7 - order) === 0) continue;
        await ctx.db.insert("habitLogs", { userId, habitId, day });
      }
    }
    const cardioDays = lastDays(checkinDays[0], 10);
    const demoCardio = [
      { offset: 0, kind: "run", effort: "easy", minutes: 30, distanceKm: 5 },
      { offset: 2, kind: "walk", effort: "easy", minutes: 40, distanceKm: 3 },
      {
        offset: 4,
        kind: "ride",
        effort: "moderate",
        minutes: 60,
        distanceKm: 24,
      },
      { offset: 6, kind: "run", effort: "hard", minutes: 25, distanceKm: 5 },
      {
        offset: 9,
        kind: "run",
        effort: "moderate",
        minutes: 45,
        distanceKm: 7.5,
      },
    ] satisfies {
      offset: number;
      kind: CardioKind;
      effort: CardioEffort;
      minutes: number;
      distanceKm: number;
    }[];
    for (const { offset, ...session } of demoCardio)
      await ctx.db.insert("cardioSessions", {
        userId,
        ...session,
        day: cardioDays[offset],
        createdAt: args.now - (9 - offset) * 86_400_000,
      });
    const muscles = new Map<string, Id<"muscles">>();
    for (const muscle of MUSCLE_DEFAULTS)
      muscles.set(
        muscle.name,
        await ctx.db.insert("muscles", { userId, ...muscle }),
      );
    await seedExercises(ctx, userId);
    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const rotation = [
      {
        label: "Push",
        exercises: [
          ["Bench press", 65],
          ["Overhead press", 30],
          ["Triceps pushdown", 20],
        ],
        names: ["chest", "shoulders", "triceps"],
      },
      {
        label: "Pull",
        exercises: [
          ["Barbell row", 55],
          ["Hammer curl", 14],
          ["Wrist curl", 10],
        ],
        names: ["back", "biceps", "forearms"],
      },
      {
        label: "Legs",
        exercises: [
          ["Back squat", 85],
          ["Romanian deadlift", 65],
          ["Standing calf raise", 40],
          ["Crunch", 0],
        ],
        names: ["quads", "hamstrings", "glutes", "calves", "abs"],
      },
    ] satisfies {
      label: string;
      names: string[];
      exercises: [string, number][];
    }[];
    let workouts = 0,
      water = 0;
    const days = Array.from(
      { length: 36 },
      (_, i) => args.days[i] ?? args.days[0] - i * 86_400_000,
    );
    for (const [offset, start] of days.entries()) {
      if (offset % 4 !== 3) {
        const session = rotation[(offset - Math.floor(offset / 4)) % 3];
        const muscleIds = session.names.map((name) => {
          const id = muscles.get(name);
          if (!id) throw new ConvexError("Missing demo muscle.");
          return id;
        });
        const trainedAt = args.now - (offset * 24 + 2) * 3_600_000;
        const workoutId = await createWorkout(ctx, userId, {
          muscleIds,
          trainedAt,
          note: `${session.label} · 3 sets per exercise, steady effort`,
        });
        let order = 0;
        // Two older Crunch sessions show a stall alongside the climbing lifts.
        const strengthExercises = session.exercises.filter(
          ([name]) => offset < 14 || (name === "Crunch" && offset <= 18),
        );
        for (const [name, baseWeight] of strengthExercises) {
          const exercise = exercises.find((row) => row.name === name);
          if (!exercise || typeof baseWeight !== "number")
            throw new ConvexError("Missing demo exercise.");
          const weightKg =
            baseWeight === 0
              ? 0
              : Math.max(2, baseWeight - Math.floor(offset / 4) * 2.5);
          for (const reps of [10, 8, 8])
            await ctx.db.insert("strengthSets", {
              userId,
              workoutId,
              exerciseId: exercise._id,
              muscleIds: exercise.muscleIds,
              trainedAt,
              reps,
              weightKg,
              order: order++,
            });
        }
        workouts++;
      }
      // The following day's energy follows the same thirteen-day sleep cycle.
      // Late doses go with lower next-day energy; this is synthetic correlation.
      const nextEnergy = 2 + Math.floor(((offset + 12) % 13) / 4);
      const mg = (5 - nextEnergy) * 50;
      if (offset > 0 && mg > 0)
        await ctx.db.insert("caffeine", {
          userId,
          at: start + 15 * 3_600_000,
          mg,
          label: "Afternoon coffee",
        });
      for (const [index, hour] of [7, 10, 13, 16, 19, 21].entries()) {
        const at =
          offset === 0
            ? start + ((args.now - start) * (index + 1)) / 7
            : start + hour * 3_600_000;
        await ctx.db.insert("water", {
          userId,
          amountMl: [350, 500, 400, 500, 350, 250][(index + offset) % 6],
          at,
        });
        water++;
      }
    }
    for (const meal of args.meals)
      await ctx.db.insert("meals", {
        userId,
        ...meal,
        revision: 1,
        analysis: { status: "ready" },
      });
    let checkins = 0;
    for (const [offset, day] of checkinDays.entries()) {
      if (offset % 10 === 4) continue;
      await ctx.db.insert("bodyCheckins", {
        userId,
        day,
        weightKg:
          Math.round((75 + offset * 0.012 + Math.sin(offset) * 0.18) * 10) / 10,
        sleepHours: 5.5 + (offset % 13) * 0.25,
        mood: 3 + (offset % 3),
        energy: 2 + Math.floor((offset % 13) / 4),
        ...(offset % 12 === 0 ? { note: "Steady training and meals." } : {}),
      });
      checkins++;
    }
    return {
      checkins,
      days: days.length,
      workouts,
      water,
      meals: args.meals.length,
      muscles: muscles.size,
    };
  },
});

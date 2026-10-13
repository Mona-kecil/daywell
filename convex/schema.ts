import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { mealItem, pushKeys, pushPayload } from "./validators";

export default defineSchema({
  settings: defineTable({
    userId: v.string(),
    waterGoal: v.number(),
    kcalTarget: v.optional(v.number()),
    proteinTarget: v.optional(v.number()),
    timeZone: v.optional(v.string()),
    checkIns: v.optional(v.array(v.string())),
    remindersEnabled: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"])
    .index("by_reminders", ["remindersEnabled"]),
  pushSubscriptions: defineTable({
    userId: v.string(),
    endpoint: v.string(),
    keys: pushKeys,
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),
  coachSent: defineTable({
    userId: v.string(),
    localDay: v.string(),
    slot: v.string(),
    createdAt: v.number(),
    delivery: v.union(
      v.object({ status: v.literal("pending"), payload: pushPayload }),
      v.object({ status: v.literal("attempted"), at: v.number() }),
    ),
  }).index("by_user_day_slot", ["userId", "localDay", "slot"]),
  coachRuns: defineTable({
    key: v.literal("check-ins"),
    lastRunAt: v.number(),
  }).index("by_key", ["key"]),
  pushDeliveries: defineTable({
    sentId: v.id("coachSent"),
    endpoint: v.string(),
    payload: pushPayload,
    statusCode: v.number(),
    at: v.number(),
  }).index("by_sent", ["sentId"]),
  muscles: defineTable({
    userId: v.string(),
    name: v.string(),
    cooldownHours: v.number(),
  }).index("by_user", ["userId"]),
  workouts: defineTable({
    userId: v.string(),
    muscleIds: v.array(v.id("muscles")),
    trainedAt: v.number(),
    note: v.string(),
  }).index("by_user_time", ["userId", "trainedAt"]),
  exercises: defineTable({
    userId: v.string(),
    name: v.string(),
    muscleIds: v.array(v.id("muscles")),
    custom: v.boolean(),
  }).index("by_user", ["userId"]),
  strengthSets: defineTable({
    userId: v.string(),
    workoutId: v.id("workouts"),
    exerciseId: v.id("exercises"),
    muscleIds: v.array(v.id("muscles")),
    trainedAt: v.number(),
    reps: v.number(),
    weightKg: v.number(),
    order: v.number(),
  })
    .index("by_user_workout", ["userId", "workoutId"])
    .index("by_user_exercise_time", ["userId", "exerciseId", "trainedAt"])
    .index("by_user_time", ["userId", "trainedAt"]),
  workoutMuscles: defineTable({
    userId: v.string(),
    muscleId: v.id("muscles"),
    workoutId: v.id("workouts"),
    trainedAt: v.number(),
  })
    .index("by_user_muscle_time", ["userId", "muscleId", "trainedAt"])
    .index("by_user_workout", ["userId", "workoutId"]),
  bodyCheckins: defineTable({
    userId: v.string(),
    day: v.string(),
    weightKg: v.optional(v.number()),
    sleepHours: v.optional(v.number()),
    mood: v.optional(v.number()),
    energy: v.optional(v.number()),
    note: v.optional(v.string()),
  }).index("by_user_day", ["userId", "day"]),
  water: defineTable({
    userId: v.string(),
    amountMl: v.number(),
    at: v.number(),
  }).index("by_user_time", ["userId", "at"]),
  uploads: defineTable({
    userId: v.string(),
    sha256: v.string(),
    expiresAt: v.number(),
  }).index("by_user", ["userId"]),
  meals: defineTable({
    userId: v.string(),
    storageId: v.optional(v.id("_storage")),
    at: v.number(),
    description: v.string(),
    items: v.array(mealItem),
    revision: v.number(),
    analysis: v.union(
      v.object({ status: v.literal("analyzing"), startedAt: v.number() }),
      v.object({ status: v.literal("ready") }),
      v.object({ status: v.literal("error"), message: v.string() }),
    ),
  })
    .index("by_user_time", ["userId", "at"])
    .index("by_user_status_time", ["userId", "analysis.status", "at"])
    .index("by_storage", ["storageId"]),
});

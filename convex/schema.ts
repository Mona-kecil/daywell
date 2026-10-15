import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  cardioKind,
  cardioEffort,
  habitIcon,
  mealItem,
  savedMealItem,
  progressPose,
  pushKeys,
  pushPayload,
} from "./validators";

export default defineSchema({
  habits: defineTable({
    userId: v.string(),
    name: v.string(),
    icon: habitIcon,
    order: v.number(),
    createdAt: v.number(),
    archivedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),
  habitLogs: defineTable({
    userId: v.string(),
    habitId: v.id("habits"),
    day: v.string(),
  })
    .index("by_user_habit_day", ["userId", "habitId", "day"])
    .index("by_user_day", ["userId", "day"]),
  shortcutTokens: defineTable({
    userId: v.string(),
    hash: v.string(),
    prefix: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_hash", ["hash"])
    .index("by_user", ["userId"]),
  shortcutLimits: defineTable({
    userId: v.string(),
    requestedAt: v.array(v.number()),
  }).index("by_user", ["userId"]),
  quickLogLimits: defineTable({
    userId: v.string(),
    sentAt: v.array(v.number()),
  }).index("by_user", ["userId"]),
  coachChatLimits: defineTable({
    userId: v.string(),
    sentAt: v.array(v.number()),
  }).index("by_user", ["userId"]),
  coachMessages: defineTable(
    v.union(
      v.object({
        userId: v.string(),
        role: v.literal("user"),
        text: v.string(),
        at: v.number(),
        status: v.literal("done"),
      }),
      v.object({
        userId: v.string(),
        role: v.literal("assistant"),
        text: v.string(),
        at: v.number(),
        status: v.union(
          v.literal("pending"),
          v.literal("done"),
          v.literal("error"),
        ),
        error: v.optional(v.string()),
      }),
    ),
  ).index("by_user_time", ["userId", "at"]),
  settings: defineTable({
    userId: v.string(),
    waterGoal: v.number(),
    stepGoal: v.optional(v.number()),
    kcalTarget: v.optional(v.number()),
    proteinTarget: v.optional(v.number()),
    goalWeightKg: v.optional(v.number()),
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
    key: v.union(v.literal("check-ins"), v.literal("weekly-review")),
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
    soreUntil: v.optional(v.number()),
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
  routines: defineTable({
    userId: v.string(),
    name: v.string(),
    exerciseIds: v.array(v.id("exercises")),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
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
    waistCm: v.optional(v.number()),
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
  steps: defineTable({
    userId: v.string(),
    day: v.string(),
    count: v.number(),
    source: v.union(v.literal("shortcut"), v.literal("manual")),
    updatedAt: v.number(),
  })
    .index("by_user_day", ["userId", "day"])
    .index("by_user_source_updated", ["userId", "source", "updatedAt"]),
  cardioSessions: defineTable({
    userId: v.string(),
    kind: cardioKind,
    effort: cardioEffort,
    day: v.string(),
    minutes: v.number(),
    distanceKm: v.optional(v.number()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user_day", ["userId", "day"]),
  caffeine: defineTable({
    userId: v.string(),
    at: v.number(),
    mg: v.number(),
    label: v.string(),
  }).index("by_user_time", ["userId", "at"]),
  uploads: defineTable({
    userId: v.string(),
    sha256: v.string(),
    expiresAt: v.number(),
  }).index("by_user", ["userId"]),
  progressPhotos: defineTable({
    userId: v.string(),
    storageId: v.id("_storage"),
    pose: progressPose,
    day: v.string(),
    takenAt: v.number(),
  })
    .index("by_user_day", ["userId", "day", "takenAt"])
    .index("by_storage", ["storageId"]),
  savedMeals: defineTable({
    userId: v.string(),
    name: v.string(),
    items: v.array(savedMealItem),
    servings: v.number(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
  }).index("by_user_used", ["userId", "lastUsedAt"]),
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

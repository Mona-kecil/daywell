import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { mealItem } from "./validators";

export default defineSchema({
  settings: defineTable({ userId: v.string(), waterGoal: v.number() }).index("by_user", ["userId"]),
  muscles: defineTable({ userId: v.string(), name: v.string(), cooldownHours: v.number() }).index("by_user", ["userId"]),
  workouts: defineTable({ userId: v.string(), muscleIds: v.array(v.id("muscles")), trainedAt: v.number(), note: v.string() }).index("by_user_time", ["userId", "trainedAt"]),
  workoutMuscles: defineTable({ userId: v.string(), muscleId: v.id("muscles"), workoutId: v.id("workouts"), trainedAt: v.number() })
    .index("by_user_muscle_time", ["userId", "muscleId", "trainedAt"]).index("by_user_workout", ["userId", "workoutId"]),
  water: defineTable({ userId: v.string(), amountMl: v.number(), at: v.number() }).index("by_user_time", ["userId", "at"]),
  uploads: defineTable({ userId: v.string(), sha256: v.string(), expiresAt: v.number() }).index("by_user", ["userId"]),
  meals: defineTable({
    userId: v.string(), storageId: v.id("_storage"), at: v.number(), description: v.string(), items: v.array(mealItem), revision: v.number(),
    analysis: v.union(v.object({ status: v.literal("analyzing"), startedAt: v.number() }), v.object({ status: v.literal("ready") }), v.object({ status: v.literal("error"), message: v.string() })),
  }).index("by_user_time", ["userId", "at"]).index("by_storage", ["storageId"]),
});

import { v } from "convex/values";
export const macros = v.object({
  kcal: v.number(),
  protein: v.number(),
  carbs: v.number(),
  fat: v.number(),
});
const itemFields = {
  id: v.string(),
  name: v.string(),
  grams: v.number(),
  searchQuery: v.string(),
};
export const mealItem = v.union(
  v.object({
    ...itemFields,
    status: v.literal("matched"),
    fdcId: v.optional(v.number()),
    foodDescription: v.string(),
    per100g: macros,
  }),
  v.object({ ...itemFields, status: v.literal("unmatched") }),
);
export const dayArgs = { startMs: v.number(), endMs: v.number() };

export const pushKeys = v.object({ p256dh: v.string(), auth: v.string() });
export const pushPayload = v.object({
  title: v.string(),
  body: v.string(),
  slot: v.string(),
  kind: v.union(
    v.literal("water"),
    v.literal("food"),
    v.literal("train"),
    v.literal("rest"),
    v.literal("weekly-review"),
  ),
});

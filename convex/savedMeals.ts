import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ownedMeal, requireUser, validTimestamp } from "./model";
import { savedMealItem } from "./validators";
import {
  SAVED_MEAL_LIMIT,
  savedMealSchema,
  scaleItems,
  servingTotals,
  validEaten,
} from "../lib/saved-meals";

async function ownedSavedMeal(
  ctx: MutationCtx,
  userId: string,
  id: Id<"savedMeals">,
) {
  const meal = await ctx.db.get(id);
  if (!meal || meal.userId !== userId)
    throw new ConvexError("Saved meal not found.");
  return meal;
}

function validRecipe(input: unknown) {
  const parsed = savedMealSchema.safeParse(input);
  if (!parsed.success)
    throw new ConvexError(
      "Use a saved meal name of 1–80 characters, 1–30 foods and 1–20 whole servings; food names 1–200 characters, grams >0–10,000, FDC IDs positive integers, kcal 0–1,000 and macros 0–100 per 100 g.",
    );
  return parsed.data;
}

async function insertRecipe(ctx: MutationCtx, userId: string, input: unknown) {
  const recipe = validRecipe(input);
  const rows = await ctx.db
    .query("savedMeals")
    .withIndex("by_user_used", (q) => q.eq("userId", userId))
    .take(SAVED_MEAL_LIMIT);
  if (rows.length >= SAVED_MEAL_LIMIT)
    throw new ConvexError("You can save at most 60 meals.");
  return ctx.db.insert("savedMeals", {
    userId,
    ...recipe,
    createdAt: Date.now(),
    useCount: 0,
  });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("savedMeals")
      .withIndex("by_user_used", (q) => q.eq("userId", userId))
      .order("desc")
      .take(SAVED_MEAL_LIMIT);
    return rows
      .sort(
        (a, b) =>
          (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1) ||
          b.createdAt - a.createdAt ||
          b._creationTime - a._creationTime,
      )
      .map((row) => ({
        id: row._id,
        name: row.name,
        servings: row.servings,
        items: row.items,
        useCount: row.useCount,
        lastUsedAt: row.lastUsedAt ?? null,
        ...servingTotals(row.items, row.servings),
      }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    items: v.array(savedMealItem),
    servings: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return insertRecipe(ctx, userId, args);
  },
});

export const saveFromMeal = mutation({
  args: {
    mealId: v.id("meals"),
    name: v.optional(v.string()),
    servings: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const meal = await ownedMeal(ctx, args.mealId);
    if (meal.analysis.status !== "ready")
      throw new ConvexError("Only ready meals can be saved.");
    const items = meal.items.flatMap((item) =>
      item.status === "matched"
        ? [
            {
              name: item.name,
              grams: item.grams,
              fdcId: item.fdcId,
              per100g: item.per100g,
            },
          ]
        : [],
    );
    if (!items.length) throw new ConvexError("No matched foods to save.");
    return insertRecipe(ctx, userId, {
      name: args.name ?? meal.description.trim().slice(0, 80),
      items,
      servings: args.servings ?? 1,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("savedMeals"),
    name: v.optional(v.string()),
    items: v.optional(v.array(savedMealItem)),
    servings: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const meal = await ownedSavedMeal(ctx, userId, args.id);
    await ctx.db.patch(
      args.id,
      validRecipe({
        name: args.name ?? meal.name,
        items: args.items ?? meal.items,
        servings: args.servings ?? meal.servings,
      }),
    );
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("savedMeals") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ownedSavedMeal(ctx, userId, args.id);
    await ctx.db.delete(args.id);
    return null;
  },
});

export const log = mutation({
  args: { id: v.id("savedMeals"), at: v.number(), servings: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const meal = await ownedSavedMeal(ctx, userId, args.id);
    validTimestamp(args.at);
    if (!validEaten(args.servings))
      throw new ConvexError("Choose servings from 0.25–10 in steps of 0.25.");
    const id = await ctx.db.insert("meals", {
      userId,
      at: args.at,
      description: meal.name,
      revision: 0,
      analysis: { status: "ready" },
      items: scaleItems(meal.items, args.servings, meal.servings).map(
        (item, index) => ({
          ...item,
          id: `saved:${index}`,
          searchQuery: item.name,
          foodDescription: item.name,
          status: "matched",
        }),
      ),
    });
    await ctx.db.patch(args.id, {
      lastUsedAt: Date.now(),
      useCount: meal.useCount + 1,
    });
    return id;
  },
});

import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./model";
import { fdcMode } from "../lib/local-deployment";
import { groundFood, searchFoods } from "../lib/fdc";
import type { MealItem } from "../lib/nutrients";
import { mealVisionProvider } from "./mealVision";

async function analyze(ctx: ActionCtx, id: Id<"meals">): Promise<void> {
  await requireUser(ctx);
  const source = await ctx.runQuery(internal.meals.read, { id });
  if (!source.storageId)
    throw new ConvexError("This meal has no photo to re-analyse.");
  const revision = await ctx.runMutation(internal.meals.begin, { id });
  try {
    const meal = await ctx.runQuery(internal.meals.read, { id });
    if (!meal.photoUrl)
      throw new Error("Photo is missing. Please upload a new meal.");
    const result = await mealVisionProvider().analyze({
      imageUrl: meal.photoUrl,
      description: meal.description || undefined,
    });
    const items = [];
    // Sequential requests avoid a burst against DEMO_KEY's small quota.
    for (const [index, item] of result.items.entries())
      items.push(
        await groundFood(
          {
            id: `${revision}:${index}`,
            name: item.name,
            grams: item.estimatedGrams,
            searchQuery: item.searchQuery,
          },
          process.env.USDA_FDC_API_KEY,
          fdcMode(process.env),
        ),
      );
    await ctx.runMutation(internal.meals.complete, {
      id,
      revision,
      result: { status: "ready", description: result.description, items },
    });
  } catch (error) {
    await ctx.runMutation(internal.meals.complete, {
      id,
      revision,
      result: {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Meal analysis failed. Please retry.",
      },
    });
  }
}
export const create = action({
  args: { ticketId: v.id("uploads"), storageId: v.string(), at: v.number() },
  handler: async (ctx, args): Promise<Id<"meals">> => {
    await requireUser(ctx);
    const id = await ctx.runMutation(internal.meals.register, args);
    await analyze(ctx, id);
    return id;
  },
});
export const reanalyze = action({
  args: { id: v.id("meals") },
  handler: async (ctx, args): Promise<void> => analyze(ctx, args.id),
});
export const research = action({
  args: { id: v.id("meals"), itemId: v.string(), query: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await requireUser(ctx);
    if (!args.query.trim() || args.query.length > 200)
      throw new ConvexError("Enter a food query under 200 characters.");
    const meal = await ctx.runQuery(internal.meals.read, { id: args.id });
    if (meal.analysis.status === "analyzing")
      throw new ConvexError("Wait for the analysis to finish.");
    const item = meal.items.find((item) => item.id === args.itemId);
    if (!item) throw new ConvexError("Item not found.");
    const revision = await ctx.runMutation(internal.meals.begin, {
      id: args.id,
      expectedRevision: meal.revision,
    });
    try {
      const grounded = await groundFood(
        {
          id: item.id,
          name: item.name,
          grams: item.grams,
          searchQuery: args.query.trim(),
        },
        process.env.USDA_FDC_API_KEY,
        fdcMode(process.env),
      );
      await ctx.runMutation(internal.meals.complete, {
        id: args.id,
        revision,
        result: {
          status: "ready",
          description: meal.description,
          items: meal.items.map((entry) =>
            entry.id === item.id ? grounded : entry,
          ),
        },
      });
    } catch (error) {
      await ctx.runMutation(internal.meals.complete, {
        id: args.id,
        revision,
        result: {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Food search failed. Please retry.",
        },
      });
    }
  },
});

export const pickMatch = action({
  args: {
    id: v.id("meals"),
    itemId: v.string(),
    query: v.string(),
    fdcId: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireUser(ctx);
    const meal = await ctx.runQuery(internal.meals.read, { id: args.id });
    const query = args.query.trim().replace(/\s+/g, " ");
    if (query.length < 2 || query.length > 80)
      throw new ConvexError("Search for a food name of 2 to 80 characters.");
    if (meal.analysis.status === "analyzing")
      throw new ConvexError("Wait for the analysis to finish.");
    const item = meal.items.find((item) => item.id === args.itemId);
    if (!item) throw new ConvexError("Item not found.");
    let hits: Awaited<ReturnType<typeof searchFoods>>;
    try {
      hits = await searchFoods(
        query,
        process.env.USDA_FDC_API_KEY,
        fdcMode(process.env),
      );
    } catch {
      throw new ConvexError(
        "Food search is unavailable right now. Please try again.",
      );
    }
    const hit = hits.find((hit) => hit.fdcId === args.fdcId);
    if (!hit)
      throw new ConvexError(
        "That food is no longer in the USDA results. Search again.",
      );
    const revision = await ctx.runMutation(internal.meals.begin, {
      id: args.id,
      expectedRevision: meal.revision,
    });
    await ctx.runMutation(internal.meals.complete, {
      id: args.id,
      revision,
      result: {
        status: "ready",
        description: meal.description,
        items: meal.items.map((entry): MealItem =>
          entry.id === item.id
            ? {
                id: item.id,
                name: item.name,
                grams: item.grams,
                status: "matched",
                fdcId: hit.fdcId,
                foodDescription: hit.description,
                per100g: hit.per100g,
                searchQuery: query,
              }
            : entry,
        ),
      },
    });
  },
});

export const createFromText = action({
  args: {
    description: v.string(),
    at: v.number(),
    items: v.array(
      v.object({
        name: v.string(),
        grams: v.number(),
        searchQuery: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Id<"meals">> => {
    await requireUser(ctx);
    const id = await ctx.runMutation(internal.meals.registerText, args);
    const revision = await ctx.runMutation(internal.meals.begin, { id });
    try {
      const items = [];
      const mode = fdcMode(process.env);
      for (const [index, item] of args.items.entries())
        items.push(
          await groundFood(
            {
              ...item,
              name: item.name.trim(),
              searchQuery: item.searchQuery.trim(),
              id: `${revision}:${index}`,
            },
            process.env.USDA_FDC_API_KEY,
            mode,
          ),
        );
      await ctx.runMutation(internal.meals.complete, {
        id,
        revision,
        result: {
          status: "ready",
          description: args.description.trim(),
          items,
        },
      });
    } catch {
      // Fetch errors can contain USDA URLs with credentials; never persist them.
      await ctx.runMutation(internal.meals.complete, {
        id,
        revision,
        result: {
          status: "error",
          message: "Food search failed. Please retry later.",
        },
      });
    }
    return id;
  },
});

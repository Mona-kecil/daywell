import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./model";
import { fdcMode } from "../lib/local-deployment";
import { groundFood } from "../lib/fdc";
import { mealVisionProvider } from "./mealVision";

async function analyze(ctx: ActionCtx, id: Id<"meals">): Promise<void> {
  await requireUser(ctx);
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

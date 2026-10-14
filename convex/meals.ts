import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  ownedMeal,
  requireUser,
  validDay,
  validTimestamp,
  positive,
} from "./model";
import { dayArgs, mealItem, macros } from "./validators";
import { mealItemSchema, mealTotals } from "../lib/nutrients";
import { textMealSchema } from "../lib/quick-log";
import { manualMealSchema } from "../lib/manual-meal";

export const today = query({
  args: dayArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validDay(args.startMs, args.endMs);
    const meals = await ctx.db
      .query("meals")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("at", args.startMs).lt("at", args.endMs),
      )
      .order("desc")
      .collect();
    return Promise.all(
      meals.map(async (meal) => ({
        ...meal,
        photoUrl: meal.storageId
          ? await ctx.storage.getUrl(meal.storageId)
          : null,
      })),
    );
  },
});
export const uploadUrl = mutation({
  args: { sha256: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(args.sha256))
      throw new ConvexError("Invalid photo digest.");
    const ticketId = await ctx.db.insert("uploads", {
      userId,
      sha256: args.sha256,
      expiresAt: Date.now() + 10 * 60_000,
    });
    return { ticketId, url: await ctx.storage.generateUploadUrl() };
  },
});
export const register = internalMutation({
  args: { ticketId: v.id("uploads"), storageId: v.string(), at: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validTimestamp(args.at);
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket || ticket.userId !== userId || ticket.expiresAt < Date.now())
      throw new ConvexError(
        "Photo upload expired. Please choose the photo again.",
      );
    const storageId = ctx.db.system.normalizeId("_storage", args.storageId);
    if (!storageId) throw new ConvexError("Invalid photo ID.");
    const metadata = await ctx.db.system.get(storageId);
    if (
      !metadata ||
      metadata.sha256 !== ticket.sha256 ||
      metadata.contentType !== "image/jpeg" ||
      metadata.size > 3_000_000
    )
      throw new ConvexError("Photo must be the uploaded JPEG, under 3 MB.");
    if (
      await ctx.db
        .query("meals")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first()
    )
      throw new ConvexError("Photo is already attached to a meal.");
    await ctx.db.delete(args.ticketId);
    return ctx.db.insert("meals", {
      userId,
      storageId,
      at: args.at,
      description: "",
      items: [],
      revision: 0,
      analysis: { status: "analyzing", startedAt: Date.now() },
    });
  },
});
export const begin = internalMutation({
  args: { id: v.id("meals"), expectedRevision: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const meal = await ownedMeal(ctx, args.id);
    if (
      args.expectedRevision !== undefined &&
      meal.revision !== args.expectedRevision
    )
      throw new ConvexError("Meal changed. Please retry your search.");
    const revision = meal.revision + 1;
    await ctx.db.patch(args.id, {
      revision,
      analysis: { status: "analyzing", startedAt: Date.now() },
    });
    return revision;
  },
});
export const read = internalQuery({
  args: { id: v.id("meals") },
  handler: async (ctx, args) => {
    const meal = await ownedMeal(ctx, args.id);
    return {
      ...meal,
      photoUrl: meal.storageId
        ? await ctx.storage.getUrl(meal.storageId)
        : null,
    };
  },
});
export const complete = internalMutation({
  args: {
    id: v.id("meals"),
    revision: v.number(),
    result: v.union(
      v.object({
        status: v.literal("ready"),
        description: v.string(),
        items: v.array(mealItem),
      }),
      v.object({ status: v.literal("error"), message: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const meal = await ownedMeal(ctx, args.id);
    if (meal.revision !== args.revision) return;
    if (args.result.status === "error")
      await ctx.db.patch(args.id, {
        analysis: {
          status: "error",
          message: args.result.message.slice(0, 500),
        },
      });
    else {
      const items = mealItemSchema.array().max(30).parse(args.result.items);
      await ctx.db.patch(args.id, {
        analysis: { status: "ready" },
        description: args.result.description.slice(0, 4000),
        items,
      });
    }
  },
});
function editable(status: "analyzing" | "ready" | "error") {
  if (status === "analyzing")
    throw new ConvexError("Wait for the analysis to finish before editing.");
}
export const setDescription = mutation({
  args: { id: v.id("meals"), description: v.string() },
  handler: async (ctx, args) => {
    const meal = await ownedMeal(ctx, args.id);
    editable(meal.analysis.status);
    if (!args.description.trim() || args.description.length > 4000)
      throw new ConvexError("Enter a description under 4,000 characters.");
    await ctx.db.patch(args.id, {
      description: args.description.trim(),
      revision: meal.revision + 1,
    });
  },
});
export const setGrams = mutation({
  args: { id: v.id("meals"), itemId: v.string(), grams: v.number() },
  handler: async (ctx, args) => {
    const meal = await ownedMeal(ctx, args.id);
    editable(meal.analysis.status);
    positive(args.grams, 10_000, "Grams");
    if (!meal.items.some((item) => item.id === args.itemId))
      throw new ConvexError("Item not found.");
    await ctx.db.patch(args.id, {
      revision: meal.revision + 1,
      items: meal.items.map((item) =>
        item.id === args.itemId ? { ...item, grams: args.grams } : item,
      ),
    });
  },
});
export const removeItem = mutation({
  args: { id: v.id("meals"), itemId: v.string() },
  handler: async (ctx, args) => {
    const meal = await ownedMeal(ctx, args.id);
    editable(meal.analysis.status);
    await ctx.db.patch(args.id, {
      revision: meal.revision + 1,
      items: meal.items.filter((item) => item.id !== args.itemId),
    });
  },
});
export const deleteMeal = mutation({
  args: { id: v.id("meals") },
  handler: async (ctx, args) => {
    const meal = await ownedMeal(ctx, args.id);
    if (meal.storageId) await ctx.storage.delete(meal.storageId);
    await ctx.db.delete(args.id);
  },
});

export const repeat = mutation({
  args: { mealId: v.id("meals"), at: v.number() },
  handler: async (ctx, args) => {
    const meal = await ownedMeal(ctx, args.mealId);
    validTimestamp(args.at);
    if (meal.analysis.status !== "ready")
      throw new ConvexError("Only analysed meals can be repeated.");
    // Omit the photo: deleting either meal must not affect the other's storage.
    return ctx.db.insert("meals", {
      userId: meal.userId,
      at: args.at,
      description: meal.description,
      items: meal.items,
      revision: 0,
      analysis: { status: "ready" },
    });
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const limit = args.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new ConvexError("Limit must be an integer from 1–20.");
    const rows = await ctx.db
      .query("meals")
      .withIndex("by_user_status_time", (q) =>
        q.eq("userId", userId).eq("analysis.status", "ready"),
      )
      .order("desc")
      .take(200);
    const seen = new Set<string>();
    const result = [];
    for (const meal of rows) {
      const key = meal.description
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        id: meal._id,
        description: meal.description,
        ...mealTotals(meal.items),
        at: meal.at,
        hasPhoto: Boolean(meal.storageId),
      });
      if (result.length === limit) break;
    }
    return result;
  },
});

export const photos = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { numItems } = args.paginationOpts;
    if (!Number.isInteger(numItems) || numItems < 1 || numItems > 60)
      throw new ConvexError("Limit must be an integer from 1–60.");
    const result = await ctx.db
      .query("meals")
      .withIndex("by_user_status_time", (q) =>
        q.eq("userId", userId).eq("analysis.status", "ready"),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("storageId"), undefined))
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      result.page.map(async (meal) => ({
        id: meal._id,
        at: meal.at,
        description: meal.description,
        photoUrl: meal.storageId
          ? await ctx.storage.getUrl(meal.storageId)
          : null,
        ...mealTotals(meal.items),
      })),
    );
    return { ...result, page };
  },
});

export const addManual = mutation({
  args: {
    at: v.number(),
    description: v.string(),
    items: v.array(
      v.object({
        name: v.string(),
        grams: v.number(),
        fdcId: v.optional(v.number()),
        per100g: macros,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validTimestamp(args.at);
    const parsed = manualMealSchema.safeParse(args);
    if (!parsed.success)
      throw new ConvexError(
        "Use a description of 1–4,000 characters and 1–30 items; names 1–200 characters, grams >0–10,000, FDC IDs positive integers, kcal 0–1,000 and macros 0–100 per 100 g.",
      );
    const { at, description, items } = parsed.data;
    return ctx.db.insert("meals", {
      userId,
      at,
      description,
      revision: 0,
      analysis: { status: "ready" },
      items: items.map((item, index) => ({
        ...item,
        id: `manual:${index}`,
        searchQuery: item.name,
        foodDescription: item.name,
        status: "matched",
      })),
    });
  },
});

export const registerText = internalMutation({
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validTimestamp(args.at);
    const parsed = textMealSchema.safeParse(args);
    if (!parsed.success)
      throw new ConvexError(
        "Use a description of 1–4,000 characters and 1–30 items; names and search queries 1–200 characters, grams >0–10,000.",
      );
    return ctx.db.insert("meals", {
      userId,
      at: parsed.data.at,
      description: parsed.data.description,
      items: [],
      revision: 0,
      analysis: { status: "analyzing", startedAt: Date.now() },
    });
  },
});

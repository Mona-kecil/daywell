import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { ownedMeal, requireUser, validDay, validTimestamp, positive } from "./model";
import { dayArgs, mealItem } from "./validators";
import { mealItemSchema } from "../lib/nutrients";

export const today = query({ args: dayArgs, handler: async (ctx, args) => {
  const userId = await requireUser(ctx); validDay(args.startMs, args.endMs);
  const meals = await ctx.db.query("meals").withIndex("by_user_time", q => q.eq("userId", userId).gte("at", args.startMs).lt("at", args.endMs)).order("desc").collect();
  return Promise.all(meals.map(async meal => ({ ...meal, photoUrl: await ctx.storage.getUrl(meal.storageId) })));
} });
export const uploadUrl = mutation({ args: { sha256: v.string() }, handler: async (ctx, args) => {
  const userId = await requireUser(ctx);
  if (!/^[a-f0-9]{64}$/.test(args.sha256)) throw new ConvexError("Invalid photo digest.");
  const ticketId = await ctx.db.insert("uploads", { userId, sha256: args.sha256, expiresAt: Date.now() + 10 * 60_000 });
  return { ticketId, url: await ctx.storage.generateUploadUrl() };
} });
export const register = internalMutation({ args: { ticketId: v.id("uploads"), storageId: v.string(), at: v.number() }, handler: async (ctx, args) => {
  const userId = await requireUser(ctx); validTimestamp(args.at);
  const ticket = await ctx.db.get(args.ticketId);
  if (!ticket || ticket.userId !== userId || ticket.expiresAt < Date.now()) throw new ConvexError("Photo upload expired. Please choose the photo again.");
  const storageId = ctx.db.system.normalizeId("_storage", args.storageId);
  if (!storageId) throw new ConvexError("Invalid photo ID.");
  const metadata = await ctx.db.system.get(storageId);
  if (!metadata || metadata.sha256 !== ticket.sha256 || metadata.contentType !== "image/jpeg" || metadata.size > 3_000_000) throw new ConvexError("Photo must be the uploaded JPEG, under 3 MB.");
  if (await ctx.db.query("meals").withIndex("by_storage", q => q.eq("storageId", storageId)).first()) throw new ConvexError("Photo is already attached to a meal.");
  await ctx.db.delete(args.ticketId);
  return ctx.db.insert("meals", { userId, storageId, at: args.at, description: "", items: [], revision: 0, analysis: { status: "analyzing", startedAt: Date.now() } });
} });
export const begin = internalMutation({ args: { id: v.id("meals"), expectedRevision: v.optional(v.number()) }, handler: async (ctx, args) => {
  const meal = await ownedMeal(ctx, args.id);
  if (args.expectedRevision !== undefined && meal.revision !== args.expectedRevision) throw new ConvexError("Meal changed. Please retry your search.");
  const revision = meal.revision + 1;
  await ctx.db.patch(args.id, { revision, analysis: { status: "analyzing", startedAt: Date.now() } });
  return revision;
} });
export const read = internalQuery({ args: { id: v.id("meals") }, handler: async (ctx, args) => {
  const meal = await ownedMeal(ctx, args.id);
  return { ...meal, photoUrl: await ctx.storage.getUrl(meal.storageId) };
} });
export const complete = internalMutation({ args: { id: v.id("meals"), revision: v.number(), result: v.union(
  v.object({ status: v.literal("ready"), description: v.string(), items: v.array(mealItem) }),
  v.object({ status: v.literal("error"), message: v.string() }),
) }, handler: async (ctx, args) => {
  const meal = await ownedMeal(ctx, args.id);
  if (meal.revision !== args.revision) return;
  if (args.result.status === "error") await ctx.db.patch(args.id, { analysis: { status: "error", message: args.result.message.slice(0, 500) } });
  else {
    const items = mealItemSchema.array().max(30).parse(args.result.items);
    await ctx.db.patch(args.id, { analysis: { status: "ready" }, description: args.result.description.slice(0, 4000), items });
  }
} });
function editable(status: "analyzing" | "ready" | "error") {
  if (status === "analyzing") throw new ConvexError("Wait for the analysis to finish before editing.");
}
export const setDescription = mutation({ args: { id: v.id("meals"), description: v.string() }, handler: async (ctx, args) => {
  const meal = await ownedMeal(ctx, args.id); editable(meal.analysis.status);
  if (!args.description.trim() || args.description.length > 4000) throw new ConvexError("Enter a description under 4,000 characters.");
  await ctx.db.patch(args.id, { description: args.description.trim(), revision: meal.revision + 1 });
} });
export const setGrams = mutation({ args: { id: v.id("meals"), itemId: v.string(), grams: v.number() }, handler: async (ctx, args) => {
  const meal = await ownedMeal(ctx, args.id); editable(meal.analysis.status); positive(args.grams, 10_000, "Grams");
  if (!meal.items.some(item => item.id === args.itemId)) throw new ConvexError("Item not found.");
  await ctx.db.patch(args.id, { revision: meal.revision + 1, items: meal.items.map(item => item.id === args.itemId ? { ...item, grams: args.grams } : item) });
} });
export const removeItem = mutation({ args: { id: v.id("meals"), itemId: v.string() }, handler: async (ctx, args) => {
  const meal = await ownedMeal(ctx, args.id); editable(meal.analysis.status);
  await ctx.db.patch(args.id, { revision: meal.revision + 1, items: meal.items.filter(item => item.id !== args.itemId) });
} });
export const deleteMeal = mutation({ args: { id: v.id("meals") }, handler: async (ctx, args) => {
  const meal = await ownedMeal(ctx, args.id);
  await ctx.storage.delete(meal.storageId);
  await ctx.db.delete(args.id);
} });

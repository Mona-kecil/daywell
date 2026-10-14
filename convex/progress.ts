import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, validLocalDay, validTimestamp } from "./model";
import { createPhotoUpload, uploadedPhoto } from "./photoUploads";
import { progressPose } from "./validators";

export const uploadUrl = mutation({
  args: { sha256: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return createPhotoUpload(ctx, userId, args.sha256);
  },
});

export const add = mutation({
  args: {
    ticketId: v.id("uploads"),
    storageId: v.string(),
    pose: progressPose,
    day: v.string(),
    takenAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validLocalDay(args.day);
    validTimestamp(args.takenAt);
    if (args.takenAt > Date.now() + 5 * 60_000)
      throw new ConvexError("Invalid timestamp.");
    const storageId = await uploadedPhoto(ctx, userId, args);
    const photos = await ctx.db
      .query("progressPhotos")
      .withIndex("by_user_day", (q) => q.eq("userId", userId))
      .take(200);
    if (photos.length >= 200)
      throw new ConvexError("You can keep up to 200 progress photos.");
    await ctx.db.delete(args.ticketId);
    return ctx.db.insert("progressPhotos", {
      userId,
      storageId,
      pose: args.pose,
      day: args.day,
      takenAt: args.takenAt,
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const photos = await ctx.db
      .query("progressPhotos")
      .withIndex("by_user_day", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    const days = [...new Set(photos.map((photo) => photo.day))];
    const weights = new Map(
      await Promise.all(
        days.map(async (day) => {
          const checkin = await ctx.db
            .query("bodyCheckins")
            .withIndex("by_user_day", (q) =>
              q.eq("userId", userId).eq("day", day),
            )
            .unique();
          return [day, checkin?.weightKg ?? null] as const;
        }),
      ),
    );
    return Promise.all(
      photos.map(async (photo) => ({
        id: photo._id,
        url: await ctx.storage.getUrl(photo.storageId),
        pose: photo.pose,
        day: photo.day,
        takenAt: photo.takenAt,
        weightKg: weights.get(photo.day) ?? null,
      })),
    );
  },
});

export const remove = mutation({
  args: { id: v.id("progressPhotos") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const photo = await ctx.db.get(args.id);
    if (!photo || photo.userId !== userId)
      throw new ConvexError("Photo not found.");
    await ctx.storage.delete(photo.storageId);
    await ctx.db.delete(args.id);
    return null;
  },
});

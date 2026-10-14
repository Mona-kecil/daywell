import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export async function createPhotoUpload(
  ctx: MutationCtx,
  userId: string,
  sha256: string,
) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(sha256))
    throw new ConvexError("Invalid photo digest.");
  const ticketId = await ctx.db.insert("uploads", {
    userId,
    sha256,
    expiresAt: Date.now() + 10 * 60_000,
  });
  return { ticketId, url: await ctx.storage.generateUploadUrl() };
}

export async function uploadedPhoto(
  ctx: MutationCtx,
  userId: string,
  args: { ticketId: Id<"uploads">; storageId: string },
) {
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
  if (
    await ctx.db
      .query("progressPhotos")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first()
  )
    throw new ConvexError("Photo is already attached to a progress photo.");
  return storageId;
}

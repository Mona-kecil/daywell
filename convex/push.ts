import { ConvexError, v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server";
import { requireUser } from "./model";
import { pushKeys, pushPayload } from "./validators";

function validateSubscription(
  endpoint: string,
  keys: { p256dh: string; auth: string },
) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ConvexError("Invalid push endpoint.");
  }
  // Restrict outbound requests to browser push services, including Mozilla's regional hosts.
  const host = url.hostname;
  if (
    endpoint.length > 2048 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      host === "fcm.googleapis.com" ||
      host === "updates.push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host === "web.push.apple.com" ||
      host.endsWith(".notify.windows.com")
    )
  )
    throw new ConvexError(
      "Use an HTTPS endpoint from a supported browser push service.",
    );
  if (
    !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) ||
    !/^[A-Za-z0-9_-]{22}$/.test(keys.auth)
  )
    throw new ConvexError("Invalid push subscription keys.");
}
export const subscribe = mutation({
  args: { endpoint: v.string(), keys: pushKeys },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validateSubscription(args.endpoint, args.keys);
    const row = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (row && row.userId !== userId)
      throw new ConvexError(
        "Push subscription belongs to another user. Unsubscribe on this device first.",
      );
    if (row) {
      await ctx.db.patch(row._id, { keys: args.keys });
      return row._id;
    }
    return ctx.db.insert("pushSubscriptions", {
      userId,
      ...args,
      createdAt: Date.now(),
    });
  },
});
export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (row?.userId === userId) await ctx.db.delete(row._id);
  },
});
export const claimDelivery = internalMutation({
  args: { sentId: v.id("coachSent") },
  handler: async (ctx, { sentId }) => {
    const sent = await ctx.db.get(sentId);
    if (!sent || sent.delivery.status !== "pending") return null;
    const payload = sent.delivery.payload;
    // Claim before external I/O: retries may lose a notification, but never send a slot twice.
    await ctx.db.patch(sentId, {
      delivery: { status: "attempted", at: Date.now() },
    });
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", sent.userId))
      .unique();
    if (!settings?.remindersEnabled) return null;
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", sent.userId))
      .collect();
    return { payload, subscriptions };
  },
});
export const removeExpired = internalMutation({
  args: { id: v.id("pushSubscriptions"), endpoint: v.string(), keys: pushKeys },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (
      row?.endpoint === args.endpoint &&
      row.keys.p256dh === args.keys.p256dh &&
      row.keys.auth === args.keys.auth
    )
      await ctx.db.delete(row._id);
  },
});
export const recordFake = internalMutation({
  args: {
    sentId: v.id("coachSent"),
    endpoint: v.string(),
    payload: pushPayload,
    statusCode: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pushDeliveries", { ...args, at: Date.now() });
  },
});

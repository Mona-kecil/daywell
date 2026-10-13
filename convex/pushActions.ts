"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { fake } from "./pushProviders/fake";
import { webPushProvider } from "./pushProviders/webpush";
import type { PushProvider } from "./pushProviders/types";

export const deliver = internalAction({
  args: { sentId: v.id("coachSent") },
  handler: async (ctx, { sentId }): Promise<void> => {
    let provider: PushProvider;
    const name = process.env.PUSH_PROVIDER ?? "fake";
    if (name === "fake")
      provider = fake(async (subscription, payload, statusCode) => {
        await ctx.runMutation(internal.push.recordFake, {
          sentId,
          endpoint: subscription.endpoint,
          payload,
          statusCode,
        });
      });
    else if (name === "webpush") provider = webPushProvider();
    else throw new Error(`Unknown push provider: ${name}`);
    const delivery = await ctx.runMutation(internal.push.claimDelivery, {
      sentId,
    });
    if (!delivery) return;
    for (const subscription of delivery.subscriptions) {
      try {
        const { statusCode } = await provider.send(
          subscription,
          delivery.payload,
        );
        if (statusCode === 404 || statusCode === 410)
          await ctx.runMutation(internal.push.removeExpired, {
            id: subscription._id,
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          });
        else if (statusCode < 200 || statusCode >= 300)
          console.error("Push provider rejected delivery", {
            sentId,
            statusCode,
          });
      } catch {
        console.error("Push delivery failed", { sentId });
      }
    }
  },
});

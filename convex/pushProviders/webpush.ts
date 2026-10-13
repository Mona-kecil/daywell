"use node";
import webpush from "web-push";
import type { PushProvider } from "./types";
export function webPushProvider(): PushProvider {
  const publicKey = process.env.VAPID_PUBLIC_KEY,
    privateKey = process.env.VAPID_PRIVATE_KEY,
    subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject)
    throw new Error(
      "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT for web push.",
    );
  return {
    async send(subscription, payload) {
      try {
        const result = await webpush.sendNotification(
          subscription,
          JSON.stringify(payload),
          {
            vapidDetails: { publicKey, privateKey, subject },
            TTL: 3600,
            timeout: 15_000,
          },
        );
        return { statusCode: result.statusCode };
      } catch (error) {
        if (error instanceof webpush.WebPushError)
          return { statusCode: error.statusCode };
        throw new Error(
          "Push delivery failed. Check the push provider configuration.",
        );
      }
    },
  };
}

import type { PushProvider, PushPayload, PushSubscription } from "./types";
export function fake(
  record: (
    subscription: PushSubscription,
    payload: PushPayload,
    statusCode: number,
  ) => Promise<void>,
): PushProvider {
  return {
    async send(subscription, payload) {
      const statusCode = Number(process.env.PUSH_FAKE_STATUS ?? "201");
      if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599)
        throw new Error("Invalid PUSH_FAKE_STATUS.");
      await record(subscription, payload, statusCode);
      return { statusCode };
    },
  };
}

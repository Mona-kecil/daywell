import type { Doc } from "../_generated/dataModel";
export type PushPayload = Extract<
  Doc<"coachSent">["delivery"],
  { status: "pending" }
>["payload"];
export type PushSubscription = Pick<
  Doc<"pushSubscriptions">,
  "endpoint" | "keys"
>;
export interface PushProvider {
  send(
    subscription: PushSubscription,
    payload: PushPayload,
  ): Promise<{ statusCode: number }>;
}

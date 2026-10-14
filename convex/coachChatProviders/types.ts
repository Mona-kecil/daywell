import type { CoachSnapshot } from "../../lib/coach-chat";

export type CoachChatInput = {
  snapshot: CoachSnapshot;
  messages: { role: "user" | "assistant"; text: string }[];
};
export interface CoachChatProvider {
  answer(input: CoachChatInput): Promise<string>;
}

export class CoachChatError extends Error {}

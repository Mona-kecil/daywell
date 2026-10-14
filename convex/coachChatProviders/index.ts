import { fake } from "./fake";
import { openai } from "./openai";
import { CoachChatError, type CoachChatProvider } from "./types";

export function coachChatProvider(): CoachChatProvider {
  const provider = process.env.COACH_CHAT_PROVIDER || "fake";
  if (provider === "fake") return fake;
  if (provider === "openai") return openai;
  throw new CoachChatError(
    "Choose fake or openai for COACH_CHAT_PROVIDER on Convex.",
  );
}

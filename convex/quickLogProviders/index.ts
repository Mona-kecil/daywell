import { fake } from "./fake";
import { openai } from "./openai";
import { QuickLogError, type QuickLogProvider } from "./types";

export function quickLogProvider(): QuickLogProvider {
  const provider = process.env.QUICK_LOG_PROVIDER || "fake";
  if (provider === "fake") return fake;
  if (provider === "openai") return openai;
  throw new QuickLogError(
    "Choose fake or openai for QUICK_LOG_PROVIDER on Convex.",
  );
}

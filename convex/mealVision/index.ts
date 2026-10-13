import { fake } from "./fake";
import { openai } from "./openai";
import { visionResultSchema, type MealVisionProvider } from "./types";
export function mealVisionProvider(): MealVisionProvider {
  const provider = process.env.MEAL_VISION_PROVIDER || "fake";
  const implementation =
    provider === "fake" ? fake : provider === "openai" ? openai : null;
  if (!implementation)
    throw new Error(`Unknown meal vision provider: ${provider}`);
  return {
    async analyze(input) {
      return visionResultSchema.parse(await implementation.analyze(input));
    },
  };
}

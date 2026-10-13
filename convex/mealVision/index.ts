import { fake } from "./fake";
import { visionResultSchema, type MealVisionProvider } from "./types";
export function mealVisionProvider(): MealVisionProvider {
  const provider = process.env.MEAL_VISION_PROVIDER || "fake";
  if (provider !== "fake")
    throw new Error(`Unknown meal vision provider: ${provider}`);
  return {
    async analyze(input) {
      return visionResultSchema.parse(await fake.analyze(input));
    },
  };
}

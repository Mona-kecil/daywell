import { z } from "zod";
import { extractPer100g, fdcFoodSchema, type MealItem } from "./nutrients";

const searchSchema = z.object({ foods: z.array(z.unknown()).default([]) });
export async function groundFood(input: { id: string; name: string; grams: number; searchQuery: string }, apiKey = "DEMO_KEY"): Promise<MealItem> {
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", apiKey || "DEMO_KEY");
  url.searchParams.set("query", input.searchQuery);
  url.searchParams.set("dataType", "Foundation,SR Legacy,Survey (FNDDS)");
  url.searchParams.set("pageSize", "25");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`USDA search failed (${response.status}). Please retry later.`);
  const result = searchSchema.parse(await response.json());
  // FDC returns relevance-ranked results. Select the first complete nutrient record.
  for (const candidate of result.foods) {
    const food = fdcFoodSchema.safeParse(candidate);
    if (!food.success) continue;
    const per100g = extractPer100g(food.data);
    if (per100g) return { ...input, status: "matched", fdcId: food.data.fdcId, foodDescription: food.data.description, per100g };
  }
  return { ...input, status: "unmatched" };
}

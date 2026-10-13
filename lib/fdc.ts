import { z } from "zod";
import { extractPer100g, fdcFoodSchema, type MealItem } from "./nutrients";
import { fixtureSearch } from "./fdc-fixtures";

const searchSchema = z.object({ foods: z.array(z.unknown()).default([]) });
export async function groundFood(
  input: { id: string; name: string; grams: number; searchQuery: string },
  apiKey = "DEMO_KEY",
  mode = "live",
): Promise<MealItem> {
  const result = searchSchema.parse(
    mode === "fixture"
      ? fixtureSearch(input.searchQuery)
      : await searchLive(input.searchQuery, apiKey),
  );
  // FDC returns relevance-ranked results. Select the first complete nutrient record.
  for (const candidate of result.foods) {
    const food = fdcFoodSchema.safeParse(candidate);
    if (!food.success) continue;
    const per100g = extractPer100g(food.data);
    if (per100g)
      return {
        ...input,
        status: "matched",
        fdcId: food.data.fdcId,
        foodDescription: food.data.description,
        per100g,
      };
  }
  return { ...input, status: "unmatched" };
}
async function searchLive(query: string, apiKey: string): Promise<unknown> {
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", apiKey || "DEMO_KEY");
  url.searchParams.set("query", query);
  url.searchParams.set("dataType", "Foundation,SR Legacy,Survey (FNDDS)");
  url.searchParams.set("pageSize", "25");
  const response = await fetch(url.toString().replace(/\+/g, "%20"), {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      "User-Agent": "Daywell/0.1 (food database integration)",
    },
  });
  if (!response.ok)
    throw new Error(
      `USDA search failed (${response.status}). Please retry later.`,
    );
  return response.json();
}

import { z } from "zod";
import { extractPer100g, fdcFoodSchema, type MealItem } from "./nutrients";
import { fixtureSearch, fixtureBarcode } from "./fdc-fixtures";
import { validBarcode, barcodeKey } from "./barcode";

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
async function searchLive(
  query: string,
  apiKey: string,
  dataType = "Foundation,SR Legacy,Survey (FNDDS)",
): Promise<unknown> {
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", apiKey || "DEMO_KEY");
  url.searchParams.set("query", query);
  url.searchParams.set("dataType", dataType);
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

const brandedFoodSchema = fdcFoodSchema.extend({
  dataType: z.literal("Branded"),
  gtinUpc: z.string(),
  brandName: z.string().nullish(),
  brandOwner: z.string().nullish(),
  servingSize: z.number().nullish(),
  servingSizeUnit: z.string().nullish(),
});

export async function lookupBarcode(
  code: string,
  apiKey = "DEMO_KEY",
  mode = "live",
) {
  if (!validBarcode(code))
    throw new Error(
      "Use a valid EAN-8, EAN-13 or UPC-A barcode with its check digit.",
    );
  const result = searchSchema.parse(
    mode === "fixture"
      ? fixtureBarcode(code)
      : await searchLive(code, apiKey, "Branded"),
  );
  for (const candidate of result.foods.slice(0, 25)) {
    const parsed = brandedFoodSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const food = parsed.data;
    if (
      !/^\d{8,14}$/.test(food.gtinUpc) ||
      barcodeKey(food.gtinUpc) !== barcodeKey(code)
    )
      continue;
    const per100g = extractPer100g(food);
    if (!per100g) continue;
    const grams = food.servingSize;
    const servingGrams =
      grams !== undefined &&
      grams !== null &&
      Number.isFinite(grams) &&
      grams > 0 &&
      /^(g|grm|gram|grams)$/i.test(food.servingSizeUnit ?? "")
        ? grams
        : null;
    return {
      fdcId: food.fdcId,
      description: food.description,
      brand: food.brandName?.trim() || food.brandOwner?.trim() || "",
      servingGrams,
      per100g,
    };
  }
  return null;
}

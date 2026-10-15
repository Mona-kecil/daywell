import { z } from "zod";
import { manualMealSchema } from "./manual-meal";
import { mealTotals } from "./nutrients";

export const SAVED_MEAL_LIMIT = 60;
export const savedMealSchema = z.object({
  name: z.string().trim().min(1).max(80),
  items: manualMealSchema.shape.items,
  servings: z.number().int().min(1).max(20),
});
export type SavedMeal = z.infer<typeof savedMealSchema>;
export type SavedMealItem = SavedMeal["items"][number];

export function validEaten(n: number) {
  return Number.isFinite(n) && n >= 0.25 && n <= 10 && Number.isInteger(n * 4);
}

export function scaleItems(
  items: SavedMealItem[],
  eaten: number,
  servings: number,
) {
  return items.map((item) => ({
    ...item,
    grams: Math.max(
      0.1,
      Math.round(((item.grams * eaten) / servings) * 10) / 10,
    ),
  }));
}

export function servingTotals(items: SavedMealItem[], servings: number) {
  const totals = mealTotals(
    items.map((item, index) => ({
      ...item,
      id: `saved:${index}`,
      status: "matched",
      searchQuery: item.name,
      foodDescription: item.name,
    })),
  );
  return {
    totals,
    perServing: {
      kcal: totals.kcal / servings,
      protein: totals.protein / servings,
      carbs: totals.carbs / servings,
      fat: totals.fat / servings,
    },
  };
}

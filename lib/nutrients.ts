import { z } from "zod";

export const macrosSchema = z.object({ kcal: z.number().nonnegative(), protein: z.number().nonnegative(), carbs: z.number().nonnegative(), fat: z.number().nonnegative() });
export type Macros = z.infer<typeof macrosSchema>;
export const ZERO_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function scaleNutrients(per100g: Macros, grams: number): Macros {
  return { kcal: per100g.kcal * grams / 100, protein: per100g.protein * grams / 100, carbs: per100g.carbs * grams / 100, fat: per100g.fat * grams / 100 };
}
export function sumNutrients(values: Macros[]): Macros {
  return values.reduce((total, value) => ({ kcal: total.kcal + value.kcal, protein: total.protein + value.protein, carbs: total.carbs + value.carbs, fat: total.fat + value.fat }), { ...ZERO_MACROS });
}

export const fdcFoodSchema = z.object({
  fdcId: z.number().int().positive(), description: z.string(), score: z.number().optional(),
  foodNutrients: z.array(z.object({ nutrientId: z.number().optional(), nutrientNumber: z.string().optional(), value: z.number().optional(), unitName: z.string().optional() })).default([]),
});
export type FdcFood = z.infer<typeof fdcFoodSchema>;

export function extractPer100g(food: FdcFood): Macros | null {
  const value = (id: number, unit: string) => {
    const nutrient = food.foodNutrients.find(n => (n.nutrientId === id || n.nutrientNumber === String(id)) && n.unitName?.toLowerCase() === unit);
    return nutrient?.value !== undefined && Number.isFinite(nutrient.value) && nutrient.value >= 0 ? nutrient.value : undefined;
  };
  const kcal = value(1008, "kcal") ?? value(2047, "kcal") ?? value(2048, "kcal");
  const protein = value(1003, "g"), carbs = value(1005, "g"), fat = value(1004, "g");
  if (kcal === undefined || protein === undefined || carbs === undefined || fat === undefined) return null;
  return { kcal, protein, carbs, fat };
}

const itemFields = { id: z.string(), name: z.string(), grams: z.number().positive(), searchQuery: z.string() };
export const mealItemSchema = z.discriminatedUnion("status", [
  z.object({ ...itemFields, status: z.literal("matched"), fdcId: z.number(), foodDescription: z.string(), per100g: macrosSchema }),
  z.object({ ...itemFields, status: z.literal("unmatched") }),
]);
export type MealItem = z.infer<typeof mealItemSchema>;
export function mealTotals(items: MealItem[]): Macros {
  return sumNutrients(items.flatMap(item => item.status === "matched" ? [scaleNutrients(item.per100g, item.grams)] : []));
}

import { z } from "zod";

export const DESCRIPTION_MAX = 4000;

export const manualMealSchema = z.object({
  at: z.number().finite(),
  description: z.string().max(DESCRIPTION_MAX).trim().min(1),
  items: z
    .array(
      z.object({
        name: z.string().max(200).trim().min(1),
        grams: z.number().positive().max(10000),
        fdcId: z.number().int().positive().optional(),
        per100g: z.object({
          kcal: z.number().min(0).max(1000),
          protein: z.number().min(0).max(100),
          carbs: z.number().min(0).max(100),
          fat: z.number().min(0).max(100),
        }),
      }),
    )
    .min(1)
    .max(30),
});

// The fallback meal name when none is given, kept within the server's limit.
export function mealSummary(names: string[]) {
  const text = names.join(", ");
  return text.length <= DESCRIPTION_MAX
    ? text
    : `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`;
}

// Explains the first problem in terms of the food row the person typed.
// Food rows come first: a blank meal name is usually a blank food name.
export function manualError(
  issues: z.core.$ZodIssue[],
  items: { name: string }[],
) {
  const issue = issues.find((i) => i.path[0] === "items") ?? issues[0];
  const [root, index, field, nutrient] = issue.path;
  if (root === "description") return "Give the meal a name.";
  if (root !== "items" || typeof index !== "number") return issue.message;
  const food = items[index]?.name || `Food ${index + 1}`;
  if (field === "name") return `Food ${index + 1} needs a name.`;
  if (field === "grams")
    return `${food}: enter an amount above 0 and up to 10,000 g.`;
  if (field === "per100g")
    return nutrient === "kcal"
      ? `${food} works out to more than 1,000 kcal per 100 g. Check its grams.`
      : `${food} works out to more than 100 g of ${String(nutrient)} per 100 g. Check its grams.`;
  return issue.message;
}

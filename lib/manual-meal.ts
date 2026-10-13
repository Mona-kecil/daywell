import { z } from "zod";

export const manualMealSchema = z.object({
  at: z.number().finite(),
  description: z.string().max(4000).trim().min(1),
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

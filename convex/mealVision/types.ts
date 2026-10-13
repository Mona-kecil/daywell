import { z } from "zod";
export const visionResultSchema = z.object({
  description: z.string().min(1).max(4000),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        estimatedGrams: z.number().positive().max(10_000),
        searchQuery: z.string().min(1).max(200),
      }),
    )
    .max(30),
});
export type VisionResult = z.infer<typeof visionResultSchema>;
export type VisionInput = { imageUrl: string; description?: string };
export interface MealVisionProvider {
  analyze(input: VisionInput): Promise<VisionResult>;
}

import { z } from "zod";
import {
  quickLogProposalSchema,
  quickLogCheckinSchema,
  textMealSchema,
} from "../../lib/quick-log";

export type QuickLogInput = {
  text: string;
  now: number;
  timeZone: string;
  localClock: string;
  muscles: string[];
};
export interface QuickLogProvider {
  parse(input: QuickLogInput): Promise<unknown>;
}
export class QuickLogError extends Error {}

// Required nullable fields satisfy strict structured output; the action removes nulls.
export const providerResultSchema = z.object({
  proposals: z
    .array(
      z.union([
        quickLogProposalSchema.options[0],
        z.object({
          kind: z.literal("workout"),
          muscles: z.array(z.string()).min(1).max(11),
          at: textMealSchema.shape.at,
          note: z.string().max(2000),
        }),
        textMealSchema.extend({ kind: z.literal("meal") }),
        z.object({
          kind: z.literal("checkin"),
          day: z.string(),
          weightKg: quickLogCheckinSchema.shape.weightKg.unwrap().nullable(),
          sleepHours: quickLogCheckinSchema.shape.sleepHours
            .unwrap()
            .nullable(),
          mood: quickLogCheckinSchema.shape.mood.unwrap().nullable(),
          energy: quickLogCheckinSchema.shape.energy.unwrap().nullable(),
        }),
      ]),
    )
    .max(100),
  leftover: z.array(z.string().max(500)).max(100),
});

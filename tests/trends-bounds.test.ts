import { expect, it } from "vitest";
import { list } from "../convex/trends";
import { MAX_EXERCISES } from "../convex/exerciseModel";

it("reads at most 500 exercises in trends.list", async () => {
  const exerciseRows = Array.from({ length: MAX_EXERCISES + 1 }, (_, i) => ({
    _id: `exercise-${i}`,
    userId: "alice",
    name: `Exercise ${i}`,
    muscleIds: [],
    custom: true,
  }));
  let exerciseRowsRead = 0;
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "alice" }) },
    db: {
      query: (table: string) => {
        const builder = {
          withIndex: (_name: string, range: (q: typeof index) => unknown) => {
            range(index);
            return builder;
          },
          order: () => builder,
          take: async (n: number) => {
            if (table === "strengthSets") return [];
            const rows = exerciseRows.slice(0, n);
            exerciseRowsRead += rows.length;
            return rows;
          },
          collect: async () => {
            exerciseRowsRead += exerciseRows.length;
            return exerciseRows;
          },
        };
        const index = { eq: () => index, lte: () => index };
        return builder;
      },
    },
  };
  if (!("_handler" in list) || typeof list._handler !== "function")
    throw new Error("Missing Convex query handler");
  await list._handler(ctx, { now: Date.parse("2026-10-14T19:00:00Z") });
  expect(exerciseRowsRead).toBeLessThanOrEqual(MAX_EXERCISES);
  expect(exerciseRowsRead).toBe(MAX_EXERCISES);
});

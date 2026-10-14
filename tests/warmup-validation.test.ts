import { describe, expect, it } from "vitest";
import { warmupSets } from "../lib/warmup";

describe("warm-up input validation", () => {
  it.each([0, -1, 1.5, 101])("rejects invalid work reps %s", (reps) => {
    expect(warmupSets(100, reps)).toEqual([]);
  });
});

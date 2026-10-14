import { describe, expect, it } from "vitest";
import { e1rm } from "../lib/strength";
import { loadable, repTable, repWeight } from "../lib/rep-max";

describe("rep targets", () => {
  it("inverts the e1RM formula", () => {
    for (const reps of [1, 3, 5, 8, 12])
      expect(e1rm({ reps, weightKg: repWeight(120, reps) })).toBeCloseTo(120);
  });

  it("rounds down to loadable 2.5 kg steps", () => {
    expect(loadable(87.49)).toBe(85);
    expect(loadable(87.5)).toBe(87.5);
    expect(loadable(2.4)).toBe(0);
  });

  it("never goes over a max that sits just under a step", () => {
    const [single] = repTable(49.999999999);
    expect(single.weightKg).toBeLessThanOrEqual(49.999999999);
    expect(single.weightKg).toBe(47.5);
    // Closer still, but well past float error: still under the step.
    expect(loadable(49.99999999999)).toBe(47.5);
    expect(loadable(2.49999999999975)).toBe(0);
  });

  it("keeps a lifted weight that float error leaves a hair under", () => {
    for (let kg = 20; kg <= 300; kg += 2.5)
      for (const reps of [2, 3, 4, 5, 6, 8, 10, 12, 15])
        expect(loadable(repWeight(e1rm({ reps, weightKg: kg }), reps))).toBe(
          kg,
        );
  });

  it("lists weights and percentages from a one-rep max", () => {
    const table = repTable(100);
    expect(table.map((r) => r.reps)).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12, 15]);
    expect(table[0]).toEqual({ reps: 1, weightKg: 100, percent: 100 });
    // 100 / (1 + 5/30) = 85.7 → 85 kg, 86 %.
    expect(table[4]).toEqual({ reps: 5, weightKg: 85, percent: 86 });
    expect(table.at(-1)).toEqual({ reps: 15, weightKg: 65, percent: 67 });
  });

  it("has no rows without a weighted max", () => {
    expect(repTable(0)).toEqual([]);
    expect(repTable(Number.NaN)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { warmupSets } from "../lib/warmup";
import { BAR_KG, loadBar } from "../lib/plates";

const bar = { reps: 10, weightKg: BAR_KG, label: "Bar × 10" };

describe("warmupSets", () => {
  it("ramps a 100 kg five-rep working set through 40, 60 and 80 percent", () => {
    expect(warmupSets(100, 5)).toEqual([
      bar,
      { reps: 5, weightKg: 40, label: "40 kg × 5" },
      { reps: 3, weightKg: 60, label: "60 kg × 3" },
      { reps: 2, weightKg: 80, label: "80 kg × 2" },
    ]);
  });

  it("rounds each ramp down to a loadable weight and trims decimals", () => {
    expect(warmupSets(107, 5)).toEqual([
      bar,
      { reps: 5, weightKg: 42.5, label: "42.5 kg × 5" },
      { reps: 3, weightKg: 62.5, label: "62.5 kg × 3" },
      { reps: 2, weightKg: 85, label: "85 kg × 2" },
    ]);
  });

  it("drops ramps at or below the previous weight for a light working set", () => {
    expect(warmupSets(40, 5)).toEqual([
      bar,
      { reps: 3, weightKg: 22.5, label: "22.5 kg × 3" },
      { reps: 2, weightKg: 30, label: "30 kg × 2" },
    ]);
    expect(warmupSets(30, 5)).toEqual([
      bar,
      { reps: 2, weightKg: 22.5, label: "22.5 kg × 2" },
    ]);
  });

  it("adds a 90 percent single for 180 kg and caps the result at five sets", () => {
    expect(warmupSets(180, 5)).toEqual([
      bar,
      { reps: 5, weightKg: 70, label: "70 kg × 5" },
      { reps: 3, weightKg: 107.5, label: "107.5 kg × 3" },
      { reps: 2, weightKg: 142.5, label: "142.5 kg × 2" },
      { reps: 1, weightKg: 160, label: "160 kg × 1" },
    ]);
    expect(warmupSets(139.9, 5)).toHaveLength(4);
    expect(warmupSets(140, 5).at(-1)?.reps).toBe(1);
  });

  it.each([12, 20])("uses one 50 percent ramp for %i-rep work", (reps) => {
    expect(warmupSets(100, reps)).toEqual([
      bar,
      { reps: 5, weightKg: 50, label: "50 kg × 5" },
    ]);
    expect(warmupSets(180, reps)).toHaveLength(2);
    expect(warmupSets(40, reps)).toEqual([bar]);
  });

  it("uses a custom bar for the threshold and loading increments", () => {
    expect(warmupSets(24, 5, { barKg: 15 })).toEqual([]);
    expect(warmupSets(25, 5, { barKg: 15 })).toEqual([
      { reps: 10, weightKg: 15, label: "Bar × 10" },
      { reps: 2, weightKg: 20, label: "20 kg × 2" },
    ]);
    expect(warmupSets(100, 5, { barKg: 15 })[0].weightKg).toBe(15);
  });

  it.each([0, -10, 20, 29.99, NaN, Infinity, -Infinity])(
    "returns no sets for invalid or below-threshold work weight %s",
    (weight) => expect(warmupSets(weight, 5)).toEqual([]),
  );

  it.each([NaN, Infinity, -Infinity])("rejects non-finite reps %s", (reps) => {
    expect(warmupSets(100, reps)).toEqual([]);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])(
    "rejects an invalid bar %s",
    (barKg) => {
      expect(warmupSets(100, 5, { barKg })).toEqual([]);
    },
  );

  it("returns ascending, loadable weights below working weight across bars and rep paths", () => {
    for (const barKg of [15, 20, 22]) {
      for (let workKg = barKg + 10; workKg <= 300; workKg += 0.25) {
        for (const reps of [5, 12]) {
          const sets = warmupSets(workKg, reps, { barKg });
          expect(sets.length).toBeLessThanOrEqual(5);
          let previousKg = -Infinity;
          for (const set of sets) {
            expect(loadBar(set.weightKg, barKg)).toMatchObject({
              remainderKg: 0,
              belowBar: false,
            });
            expect(set.weightKg).toBeGreaterThan(previousKg);
            expect(set.weightKg).toBeLessThan(workKg);
            previousKg = set.weightKg;
          }
        }
      }
    }
  });
});

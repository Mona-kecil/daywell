import { describe, expect, it } from "vitest";
import { DRINK_GAP_MS, dayTimeline } from "../lib/timeline";

const min = 60_000;
const t0 = Date.UTC(2026, 9, 14, 8);

describe("day timeline", () => {
  it("groups drinks into sittings by the gap from the previous drink", () => {
    const events = dayTimeline({
      water: [
        { at: t0 + 50 * min, amountMl: 200 },
        { at: t0, amountMl: 250 },
        { at: t0 + 25 * min, amountMl: 300 },
        { at: t0 + 50 * min + DRINK_GAP_MS + 1, amountMl: 500 },
      ],
      meals: [],
      workouts: [],
    });
    expect(events).toEqual([
      {
        kind: "water",
        at: t0 + 50 * min + DRINK_GAP_MS + 1,
        ml: 500,
        drinks: 1,
      },
      { kind: "water", at: t0, ml: 750, drinks: 3 },
    ]);
  });

  it("treats a drink exactly at the gap as the same sitting", () => {
    const events = dayTimeline({
      water: [
        { at: t0, amountMl: 100 },
        { at: t0 + DRINK_GAP_MS, amountMl: 100 },
      ],
      meals: [],
      workouts: [],
    });
    expect(events).toHaveLength(1);
  });

  it("interleaves meals and workouts newest first", () => {
    const events = dayTimeline({
      water: [{ at: t0 + 10 * min, amountMl: 250 }],
      meals: [{ id: "m", at: t0 + 60 * min, title: "Oats", kcal: 400 }],
      workouts: [{ id: "w", at: t0 + 30 * min, muscles: ["back"], note: "" }],
    });
    expect(events.map((e) => e.kind)).toEqual(["meal", "workout", "water"]);
  });

  it("returns nothing for an empty day", () => {
    expect(dayTimeline({ water: [], meals: [], workouts: [] })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { bucketDays, consistency, dayWindow } from "@/lib/insights";

const input = (overrides = {}) => ({
  waterGoal: 2000,
  muscles: [],
  water: [],
  meals: [],
  workouts: [],
  ...overrides,
});

describe("consistency", () => {
  // Wednesday 15 Oct 2025, local time.
  const now = new Date(2025, 9, 15, 18);
  const period = dayWindow(now, 10);
  const at = (daysAgo: number) =>
    period.days[period.days.length - 1 - daysAgo].startMs + 3_600_000;

  it("scores each day by the habits it hit", () => {
    const days = bucketDays(
      period.days,
      input({
        water: [
          { at: at(0), amountMl: 1500 },
          { at: at(0), amountMl: 600 },
          { at: at(1), amountMl: 1000 },
        ],
        meals: [{ at: at(0), kcal: 500, protein: 30, carbs: 50, fat: 20 }],
        workouts: [{ trainedAt: at(0), muscleIds: ["m1"] }],
      }),
    );
    const today = period.days[period.days.length - 1].key;
    const { cells } = consistency(days, 2000, new Set([today]));
    expect(cells.at(-1)!.habits).toEqual({
      water: true,
      meals: true,
      trained: true,
      checkedIn: true,
    });
    expect(cells.at(-1)!.score).toBe(4);
    // Under the water goal does not count.
    expect(cells.at(-2)!.score).toBe(0);
  });

  it("lays days out Monday-first by week", () => {
    const days = bucketDays(period.days, input());
    const { cells, weeks } = consistency(days, 2000, new Set());
    // Ten days ending Wed 15 Oct start on Mon 6 Oct.
    expect(cells[0]).toMatchObject({ col: 0, row: 0 });
    expect(cells.at(-1)).toMatchObject({ col: 1, row: 2 });
    expect(weeks).toBe(2);
  });

  it("counts active days, the best run and the current streak", () => {
    const days = bucketDays(
      period.days,
      input({
        meals: [0, 1, 4, 5, 6].map((d) => ({
          at: at(d),
          kcal: 1,
          protein: 0,
          carbs: 0,
          fat: 0,
        })),
      }),
    );
    const result = consistency(days, 2000, new Set());
    expect(result.active).toBe(5);
    expect(result.best).toBe(3);
    expect(result.current).toBe(2);
  });

  it("keeps the streak alive while today is still open", () => {
    const days = bucketDays(
      period.days,
      input({ workouts: [{ trainedAt: at(1), muscleIds: ["m1"] }] }),
    );
    expect(consistency(days, 2000, new Set()).current).toBe(1);
  });
});

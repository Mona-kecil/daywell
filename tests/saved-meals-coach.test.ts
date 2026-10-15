import { describe, expect, it } from "vitest";
import { coachSuggestions, type CoachInput } from "../lib/coach";

const base: CoachInput = {
  now: Date.parse("2026-10-15T19:00Z"),
  localMinutes: 1140,
  waterMl: 2500,
  waterGoal: 2500,
  macros: { kcal: 1800, protein: 39, carbs: 0, fat: 0 },
  targets: { proteinTarget: 100, kcalTarget: 2300 },
  mealCount: 1,
  muscles: [],
};
const bowl = {
  id: "bowl",
  name: "Chicken rice bowl",
  protein: 48.2,
  kcal: 612.1,
  createdAt: 1,
};
const food = (
  savedMeals: NonNullable<CoachInput["savedMeals"]>,
  changes: Partial<CoachInput> = {},
) =>
  coachSuggestions({ ...base, savedMeals, ...changes }).find(
    (s) => s.id === "food:targets",
  );

describe("saved meal coach rule", () => {
  it("picks highest per-serving protein within the calorie ceiling and rounds display values", () => {
    expect(
      food([bowl, { ...bowl, id: "other", protein: 30, kcal: 200 }]),
    ).toMatchObject({
      savedMeal: { id: "bowl", name: bowl.name, protein: 48, kcal: 612 },
      body: "61 g protein left. Your Chicken rice bowl adds 48 g (612 kcal).",
    });
  });
  it("respects the calorie ceiling, including a zero remaining budget", () => {
    const light = { ...bowl, id: "light", protein: 20, kcal: 150 };
    expect(food([{ ...bowl, kcal: 650.01 }, light])?.savedMeal?.id).toBe(
      "light",
    );
    expect(food([{ ...bowl, kcal: 650 }])?.savedMeal?.id).toBe("bowl");
    expect(
      food([bowl, light], { macros: { ...base.macros, kcal: 2500 } })?.savedMeal
        ?.id,
    ).toBe("light");
    expect(
      food([{ ...light, kcal: 150.01 }], {
        macros: { ...base.macros, kcal: 2500 },
      }),
    ).not.toHaveProperty("savedMeal");
    expect(
      food([bowl], { targets: { proteinTarget: 100 } })?.savedMeal?.id,
    ).toBe("bowl");
  });
  it("ignores meals below 15 g before rounding", () => {
    expect(food([{ ...bowl, protein: 14.99 }])).not.toHaveProperty("savedMeal");
    expect(food([{ ...bowl, protein: 15 }])?.savedMeal?.protein).toBe(15);
  });
  it("breaks ties by most recent use then newest creation", () => {
    const older = { ...bowl, lastUsedAt: 10 };
    const newer = { ...older, id: "newer", createdAt: 2 };
    const used = { ...bowl, id: "used", lastUsedAt: 11 };
    expect(food([older, newer, used])?.savedMeal?.id).toBe("used");
    expect(food([newer, older])?.savedMeal?.id).toBe("newer");
    expect(
      food([bowl, { ...bowl, id: "new", createdAt: 2 }])?.savedMeal?.id,
    ).toBe("new");
  });
  it("keeps the old body without eligible meals and never attaches meals on a calorie-only trigger", () => {
    const old = coachSuggestions(base).find((s) => s.id === "food:targets");
    expect(food([])).toEqual(old);
    expect(food([{ ...bowl, protein: 1 }])).toEqual(old);
    expect(
      food([bowl], { macros: { ...base.macros, kcal: 0, protein: 100 } }),
    ).not.toHaveProperty("savedMeal");
    expect(
      food([bowl], {
        targets: { kcalTarget: 2300 },
        macros: { ...base.macros, kcal: 0 },
      }),
    ).not.toHaveProperty("savedMeal");
  });
});

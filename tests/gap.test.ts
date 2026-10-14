import { describe, expect, it } from "vitest";
import fixtures from "../lib/fixtures/fdc-search.json";
import { closeGap, GAP_FOODS, portionLabel, type GapFood } from "../lib/gap";
import {
  extractPer100g,
  fdcFoodSchema,
  scaleNutrients,
  ZERO_MACROS,
} from "../lib/nutrients";

function foodById(fdcId: number): GapFood {
  const food = GAP_FOODS.find((food) => food.fdcId === fdcId);
  if (!food) throw new Error(`Missing test food: ${fdcId}`);
  return food;
}

describe("GAP_FOODS", () => {
  it("loads four foods in order with fixture macros and verbatim descriptions", () => {
    expect(GAP_FOODS.map((food) => food.fdcId)).toEqual([
      170894, 171534, 173424, 175168,
    ]);
    for (const food of GAP_FOODS) {
      const record = fixtures.cases
        .flatMap((entry) => entry.response.foods)
        .find((record) => record.fdcId === food.fdcId);
      const parsed = fdcFoodSchema.parse(record);
      expect(food.per100g).toEqual(extractPer100g(parsed));
      expect(food.description).toBe(parsed.description);
    }
    expect(GAP_FOODS.map(({ step, maxGrams }) => ({ step, maxGrams }))).toEqual(
      [
        { step: 50, maxGrams: 500 },
        { step: 25, maxGrams: 250 },
        { step: 50, maxGrams: 200 },
        { step: 25, maxGrams: 250 },
      ],
    );
  });
});

describe("closeGap", () => {
  it.each([undefined, null, 0, -1, NaN, Infinity, -Infinity])(
    "returns no_target for protein target %s",
    (proteinTarget) => {
      expect(closeGap({ eaten: ZERO_MACROS, proteinTarget })).toEqual({
        status: "no_target",
      });
    },
  );

  it("returns met at or above the protein target", () => {
    expect(
      closeGap({ eaten: { ...ZERO_MACROS, protein: 40 }, proteinTarget: 40 }),
    ).toEqual({
      status: "met",
      proteinLeft: 0,
      kcalLeft: null,
    });
    expect(
      closeGap({
        eaten: { ...ZERO_MACROS, protein: 41.24, kcal: 110 },
        proteinTarget: 40,
        kcalTarget: 100,
      }),
    ).toEqual({
      status: "met",
      proteinLeft: -1.2,
      kcalLeft: -10,
    });
  });

  it("rounds chicken up to 25 g steps and orders closing portions by calories", () => {
    const plan = closeGap({ eaten: ZERO_MACROS, proteinTarget: 40 });
    expect(plan.status).toBe("open");
    if (plan.status !== "open") throw new Error("Expected an open plan");
    expect(plan.kcalLeft).toBeNull();
    expect(plan.suggestions.map((suggestion) => suggestion.food.fdcId)).toEqual(
      [171534, 170894, 175168],
    );
    const chicken = plan.suggestions[0];
    expect(chicken.grams).toBe(150);
    expect(chicken.grams % 25).toBe(0);
    expect(chicken.closes).toBe(true);
    expect(chicken.adds).toEqual(scaleNutrients(foodById(171534).per100g, 150));
    expect(plan.suggestions.every((suggestion) => suggestion.closes)).toBe(
      true,
    );
    expect(plan.suggestions.map((suggestion) => suggestion.adds.kcal)).toEqual(
      plan.suggestions
        .map((suggestion) => suggestion.adds.kcal)
        .sort((a, b) => a - b),
    );
  });

  it("caps yogurt at 500 g when the remaining protein exceeds its portion limit", () => {
    const yogurt = foodById(170894);
    const plan = closeGap({ eaten: ZERO_MACROS, proteinTarget: 60 }, [yogurt]);
    expect(plan).toMatchObject({
      status: "open",
      suggestions: [
        {
          food: yogurt,
          grams: 500,
          closes: false,
          adds: scaleNutrients(yogurt.per100g, 500),
        },
      ],
    });
  });

  it("puts closing portions before cheaper portions that leave a gap", () => {
    const plan = closeGap({ eaten: ZERO_MACROS, proteinTarget: 60 });
    expect(plan.status).toBe("open");
    if (plan.status !== "open") throw new Error("Expected an open plan");
    expect(
      plan.suggestions.map(({ food, closes }) => [food.fdcId, closes]),
    ).toEqual([
      [171534, true],
      [170894, false],
      [173424, false],
    ]);
    expect(plan.suggestions[0].adds.kcal).toBeGreaterThan(
      plan.suggestions[1].adds.kcal,
    );
  });

  it("shrinks portions to calorie steps and leaves the protein gap open", () => {
    const plan = closeGap({
      eaten: { ...ZERO_MACROS, kcal: 900 },
      proteinTarget: 40,
      kcalTarget: 1000,
    });
    expect(plan.status).toBe("open");
    if (plan.status !== "open") throw new Error("Expected an open plan");
    expect(plan.kcalLeft).toBe(100);
    expect(plan.suggestions).toHaveLength(3);
    for (const suggestion of plan.suggestions) {
      expect(suggestion.adds.kcal).toBeLessThanOrEqual(100);
      expect(suggestion.grams % suggestion.food.step).toBe(0);
      expect(suggestion.grams).toBeLessThanOrEqual(suggestion.food.maxGrams);
      expect(suggestion.closes).toBe(false);
    }
    expect(
      plan.suggestions.map(({ food, grams }) => [food.fdcId, grams]),
    ).toEqual([
      [175168, 25],
      [171534, 50],
      [173424, 50],
    ]);
  });

  it("returns no_room when the cap cannot fit any food's first step", () => {
    const minimumKcal = Math.min(
      ...GAP_FOODS.map((food) => scaleNutrients(food.per100g, food.step).kcal),
    );
    const kcalTarget = minimumKcal - 1;
    expect(
      closeGap({ eaten: ZERO_MACROS, proteinTarget: 40, kcalTarget }),
    ).toEqual({
      status: "no_room",
      proteinLeft: 40,
      kcalLeft: Math.round(kcalTarget * 10) / 10,
    });
    expect(
      closeGap({
        eaten: { ...ZERO_MACROS, kcal: 101 },
        proteinTarget: 40,
        kcalTarget: 100,
      }),
    ).toEqual({
      status: "no_room",
      proteinLeft: 40,
      kcalLeft: -1,
    });
  });

  it("keeps a portion that fits exactly one calorie step", () => {
    const chicken = foodById(171534);
    const kcalTarget = scaleNutrients(chicken.per100g, chicken.step).kcal;
    expect(
      closeGap({ eaten: ZERO_MACROS, proteinTarget: 40, kcalTarget }, [
        chicken,
      ]),
    ).toMatchObject({
      status: "open",
      suggestions: [{ grams: 25, adds: { kcal: kcalTarget }, closes: false }],
    });
  });

  it("sorts calorie ties by name and returns at most three suggestions", () => {
    const chicken = foodById(171534);
    const foods = ["Zebra", "Delta", "Charlie", "Alpha"].map((name) => ({
      ...chicken,
      name,
    }));
    const plan = closeGap({ eaten: ZERO_MACROS, proteinTarget: 40 }, foods);
    expect(plan.status).toBe("open");
    if (plan.status !== "open") throw new Error("Expected an open plan");
    expect(plan.suggestions.map(({ food }) => food.name)).toEqual([
      "Alpha",
      "Charlie",
      "Delta",
    ]);
    expect(foods.map((food) => food.name)).toEqual([
      "Zebra",
      "Delta",
      "Charlie",
      "Alpha",
    ]);
  });

  it("rounds displayed remainders without rounding portion calculations", () => {
    const chicken = foodById(171534);
    const stepAdds = scaleNutrients(chicken.per100g, chicken.step);
    const proteinTarget = stepAdds.protein + 0.01;
    expect(
      closeGap({ eaten: ZERO_MACROS, proteinTarget }, [chicken]),
    ).toMatchObject({
      status: "open",
      proteinLeft: Math.round(proteinTarget * 10) / 10,
      suggestions: [{ grams: 50, closes: true }],
    });
    const kcalTarget = stepAdds.kcal - 0.001;
    expect(
      closeGap({ eaten: ZERO_MACROS, proteinTarget: 40, kcalTarget }, [
        chicken,
      ]),
    ).toEqual({
      status: "no_room",
      proteinLeft: 40,
      kcalLeft: Math.round(kcalTarget * 10) / 10,
    });
  });

  it("uses a 1e-9 tolerance when a capped portion closes the gap", () => {
    const chicken = foodById(171534);
    const protein = scaleNutrients(chicken.per100g, chicken.maxGrams).protein;
    expect(
      closeGap({ eaten: ZERO_MACROS, proteinTarget: protein + 5e-10 }, [
        chicken,
      ]),
    ).toMatchObject({
      status: "open",
      suggestions: [{ grams: chicken.maxGrams, closes: true }],
    });
    expect(
      closeGap({ eaten: ZERO_MACROS, proteinTarget: protein + 2e-9 }, [
        chicken,
      ]),
    ).toMatchObject({
      status: "open",
      suggestions: [{ closes: false }],
    });
  });

  it.each([undefined, null, 0, -1, NaN, Infinity, -Infinity])(
    "uses no calorie cap for kcal target %s",
    (kcalTarget) => {
      expect(
        closeGap({ eaten: ZERO_MACROS, proteinTarget: 40, kcalTarget }),
      ).toEqual(closeGap({ eaten: ZERO_MACROS, proteinTarget: 40 }));
    },
  );

  it("clamps negative eaten macros to zero without mutating the input", () => {
    const eaten = { kcal: -10, protein: -5, carbs: -20, fat: -1 };
    expect(closeGap({ eaten, proteinTarget: 40, kcalTarget: 100 })).toEqual(
      closeGap({ eaten: ZERO_MACROS, proteinTarget: 40, kcalTarget: 100 }),
    );
    expect(eaten).toEqual({ kcal: -10, protein: -5, carbs: -20, fat: -1 });
  });

  it.each(["kcal", "protein", "carbs", "fat"])(
    "returns no_target for non-finite eaten %s",
    (key) => {
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(
          closeGap({
            eaten: { ...ZERO_MACROS, [key]: value },
            proteinTarget: 40,
          }),
        ).toEqual({ status: "no_target" });
      }
    },
  );

  it("skips foods without protein and handles an empty food list", () => {
    const food = foodById(170894);
    for (const protein of [0, -1]) {
      expect(
        closeGap({ eaten: ZERO_MACROS, proteinTarget: 40 }, [
          { ...food, per100g: { ...food.per100g, protein } },
        ]),
      ).toEqual({
        status: "open",
        proteinLeft: 40,
        kcalLeft: null,
        suggestions: [],
      });
    }
    expect(closeGap({ eaten: ZERO_MACROS, proteinTarget: 40 }, [])).toEqual({
      status: "open",
      proteinLeft: 40,
      kcalLeft: null,
      suggestions: [],
    });
    expect(
      closeGap({ eaten: ZERO_MACROS, proteinTarget: 40, kcalTarget: 100 }, []),
    ).toEqual({
      status: "no_room",
      proteinLeft: 40,
      kcalLeft: 100,
    });
  });
});

describe("portionLabel", () => {
  it("labels eggs with singular or plural units and grams", () => {
    const eggs = foodById(173424);
    expect(portionLabel(eggs, 100)).toBe("2 eggs · 100 g");
    expect(portionLabel(eggs, 50)).toBe("1 egg · 50 g");
  });

  it("labels foods without units in grams", () => {
    expect(portionLabel(foodById(171534), 150)).toBe("150 g");
  });
});

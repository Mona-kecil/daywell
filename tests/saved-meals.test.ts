import { expect, it } from "vitest";
import {
  savedMealSchema,
  scaleItems,
  servingTotals,
  validEaten,
} from "../lib/saved-meals";

const item = {
  name: "Rice",
  grams: 200,
  fdcId: 123,
  per100g: { kcal: 130, protein: 2, carbs: 28, fat: 0.3 },
};
const recipe = { name: "Rice bowl", items: [item], servings: 2 };

it("trims recipe and food names and computes whole and per-serving totals", () => {
  expect(savedMealSchema.parse({ ...recipe, name: " Rice bowl " }).name).toBe(
    "Rice bowl",
  );
  expect(servingTotals(recipe.items, 2)).toEqual({
    totals: { kcal: 260, protein: 4, carbs: 56, fat: 0.6 },
    perServing: item.per100g,
  });
});

it("scales a half serving from a two-serving recipe without mutating its foods", () => {
  expect(scaleItems([item], 0.5, 2)).toEqual([{ ...item, grams: 50 }]);
  expect(item.grams).toBe(200);
});

it("rounds scaled grams to tenths and retains at least a tenth of a gram", () => {
  expect(scaleItems([{ ...item, grams: 123.45 }], 0.5, 2)[0].grams).toBe(30.9);
  expect(scaleItems([{ ...item, grams: 0.001 }], 0.25, 20)[0].grams).toBe(0.1);
});

it.each([0, 0.3, 10.25, NaN, Infinity, -0.25])(
  "rejects eaten servings %s",
  (eaten) => expect(validEaten(eaten)).toBe(false),
);

it("accepts every quarter-serving choice from 0.25 to 10", () => {
  for (let i = 1; i <= 40; i++) expect(validEaten(i / 4)).toBe(true);
});

it("enforces recipe limits and the manual food limits", () => {
  const invalid = [
    { ...recipe, name: " " },
    { ...recipe, name: "x".repeat(81) },
    { ...recipe, items: [] },
    { ...recipe, items: Array.from({ length: 31 }, () => item) },
    ...[0, 21, 1.5, NaN].map((servings) => ({ ...recipe, servings })),
    ...[
      { name: " " },
      { name: "x".repeat(201) },
      { grams: 0 },
      { grams: 10001 },
      { grams: Infinity },
      { fdcId: 0 },
      { fdcId: 1.5 },
    ].map((fields) => ({ ...recipe, items: [{ ...item, ...fields }] })),
    ...["kcal", "protein", "carbs", "fat"].flatMap((key) =>
      [-1, NaN, Infinity, key === "kcal" ? 1001 : 101].map((value) => ({
        ...recipe,
        items: [{ ...item, per100g: { ...item.per100g, [key]: value } }],
      })),
    ),
  ];
  for (const input of invalid)
    expect(savedMealSchema.safeParse(input).success).toBe(false);
  expect(
    savedMealSchema.safeParse({
      name: "x".repeat(80),
      servings: 20,
      items: Array.from({ length: 30 }, () => ({
        name: "x".repeat(200),
        grams: 10000,
        per100g: { kcal: 1000, protein: 100, carbs: 100, fat: 100 },
      })),
    }).success,
  ).toBe(true);
});

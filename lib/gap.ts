import fixtures from "./fixtures/fdc-search.json";
import {
  extractPer100g,
  fdcFoodSchema,
  scaleNutrients,
  type Macros,
} from "./nutrients";

export type GapFood = {
  fdcId: number;
  name: string;
  description: string;
  per100g: Macros;
  step: number;
  maxGrams: number;
  unit?: { singular: string; plural: string; grams: number };
};

const foodDefinitions: Omit<GapFood, "description" | "per100g">[] = [
  { fdcId: 170894, name: "Greek yogurt, nonfat", step: 50, maxGrams: 500 },
  { fdcId: 171534, name: "Chicken breast", step: 25, maxGrams: 250 },
  {
    fdcId: 173424,
    name: "Eggs, hard-boiled",
    step: 50,
    maxGrams: 200,
    unit: { singular: "egg", plural: "eggs", grams: 50 },
  },
  { fdcId: 175168, name: "Salmon", step: 25, maxGrams: 250 },
];

export const GAP_FOODS: GapFood[] = foodDefinitions.map((definition) => {
  const record = fixtures.cases
    .flatMap((entry) => entry.response.foods)
    .find((food) => food.fdcId === definition.fdcId);
  if (!record) throw new Error(`Missing gap food fixture: ${definition.fdcId}`);
  const food = fdcFoodSchema.parse(record);
  const per100g = extractPer100g(food);
  if (!per100g)
    throw new Error(`Missing gap food nutrients: ${definition.fdcId}`);
  return { ...definition, description: food.description, per100g };
});

export type GapSuggestion = {
  food: GapFood;
  grams: number;
  adds: Macros;
  closes: boolean;
  label: string;
};

export type GapPlan =
  | { status: "no_target" }
  | { status: "met"; proteinLeft: number; kcalLeft: number | null }
  | { status: "no_room"; proteinLeft: number; kcalLeft: number }
  | {
      status: "open";
      proteinLeft: number;
      kcalLeft: number | null;
      suggestions: GapSuggestion[];
    };

export function portionLabel(food: GapFood, grams: number): string {
  if (!food.unit) return `${grams} g`;
  const count = grams / food.unit.grams;
  const unit = count === 1 ? food.unit.singular : food.unit.plural;
  return `${count} ${unit} · ${grams} g`;
}

export function closeGap(
  input: {
    eaten: Macros;
    proteinTarget?: number | null;
    kcalTarget?: number | null;
  },
  foods: GapFood[] = GAP_FOODS,
): GapPlan {
  const { eaten, proteinTarget, kcalTarget } = input;
  if (
    proteinTarget == null ||
    !Number.isFinite(proteinTarget) ||
    proteinTarget <= 0 ||
    !Object.values(eaten).every(Number.isFinite)
  ) {
    return { status: "no_target" };
  }

  const proteinLeft = proteinTarget - Math.max(0, eaten.protein);
  const kcalLeft =
    kcalTarget != null && Number.isFinite(kcalTarget) && kcalTarget > 0
      ? kcalTarget - Math.max(0, eaten.kcal)
      : null;
  const remaining = {
    proteinLeft: Math.round(proteinLeft * 10) / 10,
    kcalLeft: kcalLeft === null ? null : Math.round(kcalLeft * 10) / 10,
  };
  if (proteinLeft <= 0) return { status: "met", ...remaining };

  const suggestions: GapSuggestion[] = [];
  for (const food of foods) {
    if (food.per100g.protein <= 0) continue;
    let grams = Math.min(
      Math.ceil(proteinLeft / (food.per100g.protein / 100) / food.step) *
        food.step,
      food.maxGrams,
    );
    if (
      kcalLeft !== null &&
      scaleNutrients(food.per100g, grams).kcal > kcalLeft
    ) {
      grams =
        Math.floor(kcalLeft / (food.per100g.kcal / 100) / food.step) *
        food.step;
    }
    if (grams < food.step) continue;
    const adds = scaleNutrients(food.per100g, grams);
    suggestions.push({
      food,
      grams,
      adds,
      closes: adds.protein + 1e-9 >= proteinLeft,
      label: portionLabel(food, grams),
    });
  }

  suggestions.sort(
    (a, b) =>
      Number(b.closes) - Number(a.closes) ||
      a.adds.kcal - b.adds.kcal ||
      a.food.name.localeCompare(b.food.name),
  );
  if (suggestions.length === 0 && kcalLeft !== null) {
    return {
      status: "no_room",
      proteinLeft: remaining.proteinLeft,
      kcalLeft: Math.round(kcalLeft * 10) / 10,
    };
  }
  return { status: "open", ...remaining, suggestions: suggestions.slice(0, 3) };
}

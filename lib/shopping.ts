import type { SavedMealItem } from "./saved-meals";

type Recipe = {
  id: string;
  name: string;
  servings: number;
  items: SavedMealItem[];
};
export type Plan = Record<string, number>;
export type ShoppingItem = {
  key: string;
  name: string;
  grams: number;
  meals: string[];
};

// The same food in two recipes is one line: by FDC ID when it has one,
// otherwise by its name.
export const foodKey = (item: Pick<SavedMealItem, "fdcId" | "name">) =>
  item.fdcId === undefined
    ? `name:${item.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`
    : `fdc:${item.fdcId}`;

export function shoppingList(recipes: Recipe[], plan: Plan): ShoppingItem[] {
  const lines = new Map<string, ShoppingItem>();
  for (const recipe of recipes) {
    const planned = plan[recipe.id] ?? 0;
    if (!(planned > 0)) continue;
    for (const item of recipe.items) {
      const key = foodKey(item);
      const grams = (item.grams * planned) / recipe.servings;
      const line = lines.get(key);
      if (!line)
        lines.set(key, { key, name: item.name, grams, meals: [recipe.name] });
      else {
        line.grams += grams;
        if (!line.meals.includes(recipe.name)) line.meals.push(recipe.name);
      }
    }
  }
  return [...lines.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
}

// Rounded up, so the list never asks for less than the recipes use.
export function amount(grams: number) {
  if (grams >= 1000)
    return `${(Math.ceil(grams / 100) / 10).toLocaleString("en-US")} kg`;
  if (grams >= 50) return `${Math.ceil(grams / 5) * 5} g`;
  return `${Math.max(1, Math.ceil(grams - 1e-9))} g`;
}

export function shoppingText(list: ShoppingItem[], checked: string[] = []) {
  return list
    .filter((line) => !checked.includes(line.key))
    .map((line) => `- ${line.name}, ${amount(line.grams)}`)
    .join("\n");
}

// Keeps only plans and ticks that still match a saved meal or a list line.
export function prunePlan(plan: Plan, ids: string[]): Plan {
  return Object.fromEntries(
    Object.entries(plan).filter(
      ([id, n]) => ids.includes(id) && Number.isInteger(n) && n > 0 && n <= 50,
    ),
  );
}

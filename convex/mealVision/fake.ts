import type { MealVisionProvider } from "./types";
const foods = [
  { words: /chicken/i, name: "Chicken", estimatedGrams: 120, searchQuery: "chicken breast cooked roasted" },
  { words: /rice/i, name: "Rice", estimatedGrams: 150, searchQuery: "rice white cooked" },
  { words: /broccoli/i, name: "Broccoli", estimatedGrams: 80, searchQuery: "broccoli cooked" },
  { words: /egg/i, name: "Egg", estimatedGrams: 50, searchQuery: "egg cooked" },
  { words: /tofu/i, name: "Tofu", estimatedGrams: 120, searchQuery: "tofu firm" },
  { words: /salmon/i, name: "Salmon", estimatedGrams: 120, searchQuery: "salmon cooked" },
  { words: /potato/i, name: "Potato", estimatedGrams: 150, searchQuery: "potato boiled" },
];
export const fake: MealVisionProvider = {
  async analyze({ description }) {
    const text = description === undefined ? "Chicken rice bowl with broccoli" : description;
    const known = foods.filter(food => food.words.test(text)).map(({ name, estimatedGrams, searchQuery }) => ({ name, estimatedGrams, searchQuery }));
    return { description: text, items: known.length ? known : [{ name: text, estimatedGrams: 100, searchQuery: text.slice(0, 200) }] };
  },
};

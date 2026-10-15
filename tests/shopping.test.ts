import { describe, expect, it } from "vitest";
import {
  amount,
  foodKey,
  prunePlan,
  shoppingList,
  shoppingText,
} from "../lib/shopping";

const macros = { kcal: 100, protein: 10, carbs: 10, fat: 1 };
const oats = {
  id: "a",
  name: "Overnight oats",
  servings: 2,
  items: [
    { name: "Rolled oats", grams: 160, fdcId: 1, per100g: macros },
    { name: "Greek yogurt", grams: 300, per100g: macros },
  ],
};
const bowl = {
  id: "b",
  name: "Yogurt bowl",
  servings: 1,
  items: [
    { name: " greek  YOGURT", grams: 170, per100g: macros },
    { name: "Oats, rolled", grams: 30, fdcId: 1, per100g: macros },
  ],
};

describe("shopping list", () => {
  it("merges foods by FDC ID or normalized name across meals", () => {
    expect(foodKey({ name: "x", fdcId: 7 })).toBe("fdc:7");
    expect(foodKey({ name: " Greek  YOGURT" })).toBe("name:greek yogurt");
    const list = shoppingList([oats, bowl], { a: 3, b: 2 });
    expect(list).toEqual([
      {
        key: "name:greek yogurt",
        name: "Greek yogurt",
        grams: 450 + 340,
        meals: ["Overnight oats", "Yogurt bowl"],
      },
      {
        key: "fdc:1",
        name: "Rolled oats",
        grams: 240 + 60,
        meals: ["Overnight oats", "Yogurt bowl"],
      },
    ]);
  });

  it("skips meals with no servings planned", () => {
    expect(shoppingList([oats, bowl], { a: 0 })).toEqual([]);
    expect(shoppingList([oats], {}).length).toBe(0);
    expect(shoppingList([oats], { b: 2 })).toEqual([]);
  });

  it("rounds amounts up so the list never falls short", () => {
    expect(amount(0.2)).toBe("1 g");
    expect(amount(12)).toBe("12 g");
    expect(amount(12.01)).toBe("13 g");
    expect(amount(51)).toBe("55 g");
    expect(amount(995)).toBe("995 g");
    expect(amount(1000)).toBe("1 kg");
    expect(amount(1201)).toBe("1.3 kg");
  });

  it("writes the unticked lines as text", () => {
    const list = shoppingList([oats], { a: 1 });
    expect(shoppingText(list)).toBe(
      "- Greek yogurt, 150 g\n- Rolled oats, 80 g",
    );
    expect(shoppingText(list, ["fdc:1"])).toBe("- Greek yogurt, 150 g");
  });

  it("drops plans for deleted meals and impossible counts", () => {
    expect(
      prunePlan({ a: 2, gone: 3, b: 1.5, c: -1 }, ["a", "b", "c"]),
    ).toEqual({ a: 2 });
    expect(prunePlan({ a: 51 }, ["a"])).toEqual({});
  });
});

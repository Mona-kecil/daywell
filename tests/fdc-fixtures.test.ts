import { afterEach, expect, it, vi } from "vitest";
import { groundFood } from "../lib/fdc";
import fixtures from "../lib/fixtures/fdc-search.json";
import { fdcFoodSchema } from "../lib/nutrients";

afterEach(() => vi.unstubAllGlobals());
it("grounds all twelve hand-built SR Legacy search fixtures without HTTP", async () => {
  const fetch = vi.fn(() => {
    throw new Error("Fixture mode must not call USDA");
  });
  vi.stubGlobal("fetch", fetch);
  for (const entry of fixtures.cases) {
    expect(fdcFoodSchema.safeParse(entry.response.foods[0]).success).toBe(true);
    const food = await groundFood(
      { id: "test", name: entry.query, grams: 100, searchQuery: entry.query },
      undefined,
      "fixture",
    );
    expect(food.status).toBe("matched");
    if (food.status !== "matched") throw new Error("Missing match");
    expect(food.fdcId).toBe(entry.response.foods[0].fdcId);
    expect(food.per100g.kcal).toBeGreaterThan(0);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("matches reordered query words and leaves unknown foods unmatched", async () => {
  const food = await groundFood(
    { id: "test", name: "Rice", grams: 150, searchQuery: "rice white cooked" },
    undefined,
    "fixture",
  );
  expect(food).toMatchObject({ status: "matched", per100g: { kcal: 130 } });
  expect(
    await groundFood(
      {
        id: "unknown",
        name: "Dragonfruit",
        grams: 100,
        searchQuery: "dragonfruit",
      },
      undefined,
      "fixture",
    ),
  ).toMatchObject({ status: "unmatched" });
});

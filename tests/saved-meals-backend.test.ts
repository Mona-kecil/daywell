import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const item = {
  name: "Rice",
  grams: 200,
  fdcId: 123,
  per100g: { kcal: 130, protein: 2, carbs: 28, fat: 0.3 },
};
const recipe = { name: "Rice bowl", items: [item], servings: 2 };
const matched = {
  ...item,
  id: "original",
  status: "matched",
  searchQuery: "cooked rice",
  foodDescription: "Cooked rice",
} satisfies Doc<"meals">["items"][number];
const unmatched = {
  id: "unknown",
  name: "Unknown",
  grams: 10,
  searchQuery: "unknown",
  status: "unmatched",
} satisfies Doc<"meals">["items"][number];

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
afterEach(() => vi.restoreAllMocks());

it("creates and lists recipes used first, then newest, with per-serving totals", async () => {
  const { alice, bob } = setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(100);
  const used = await alice.mutation(api.savedMeals.create, recipe);
  clock.mockReturnValue(200);
  await alice.mutation(api.savedMeals.log, { id: used, at: 1, servings: 1 });
  clock.mockReturnValue(300);
  const older = await alice.mutation(api.savedMeals.create, recipe);
  clock.mockReturnValue(400);
  const newer = await alice.mutation(api.savedMeals.create, {
    ...recipe,
    name: " Rice bowl ",
  });
  const rows = await alice.query(api.savedMeals.list, {});
  expect(rows.map((row) => row.id)).toEqual([used, newer, older]);
  expect(rows[0]).toEqual({
    id: used,
    name: recipe.name,
    items: recipe.items,
    servings: 2,
    useCount: 1,
    lastUsedAt: 200,
    totals: { kcal: 260, protein: 4, carbs: 56, fat: 0.6 },
    perServing: item.per100g,
  });
  expect(rows[1].lastUsedAt).toBeNull();
  expect(await bob.query(api.savedMeals.list, {})).toEqual([]);
});

it("breaks equal last-used times by newest creation", async () => {
  const { alice } = setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(100);
  const first = await alice.mutation(api.savedMeals.create, recipe);
  clock.mockReturnValue(200);
  const second = await alice.mutation(api.savedMeals.create, recipe);
  clock.mockReturnValue(300);
  await alice.mutation(api.savedMeals.log, { id: first, at: 1, servings: 1 });
  await alice.mutation(api.savedMeals.log, { id: second, at: 1, servings: 1 });
  expect(
    (await alice.query(api.savedMeals.list, {})).map((row) => row.id),
  ).toEqual([second, first]);
});

it("saves only matched foods with defaults and independent copied data", async () => {
  const { t, alice, bob } = setup();
  const mealId = await t.run((ctx) =>
    ctx.db.insert("meals", {
      userId: "alice",
      at: 1,
      description: ` ${"Rice ".repeat(30)} `,
      revision: 0,
      analysis: { status: "ready" },
      items: [matched, unmatched],
    }),
  );
  await expect(
    bob.mutation(api.savedMeals.saveFromMeal, { mealId }),
  ).rejects.toThrow("Meal not found.");
  const id = await alice.mutation(api.savedMeals.saveFromMeal, { mealId });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    name: "Rice ".repeat(30).trim().slice(0, 80).trim(),
    items: [item],
    servings: 1,
    useCount: 0,
  });
  const override = await alice.mutation(api.savedMeals.saveFromMeal, {
    mealId,
    name: " Meal prep ",
    servings: 3,
  });
  expect(await t.run((ctx) => ctx.db.get(override))).toMatchObject({
    name: "Meal prep",
    servings: 3,
  });
  await alice.mutation(api.meals.deleteMeal, { id: mealId });
  expect((await alice.query(api.savedMeals.list, {}))[0].items).toEqual([item]);
});

it.each(["analyzing", "error", "empty"])(
  "rejects saving a meal that is %s",
  async (state) => {
    const { t, alice } = setup();
    const analysis: Doc<"meals">["analysis"] =
      state === "analyzing"
        ? { status: "analyzing", startedAt: 1 }
        : state === "error"
          ? { status: "error", message: "Failed" }
          : { status: "ready" };
    const mealId = await t.run((ctx) =>
      ctx.db.insert("meals", {
        userId: "alice",
        at: 1,
        description: "Rice",
        revision: 0,
        analysis,
        items: state === "empty" ? [unmatched] : [matched],
      }),
    );
    await expect(
      alice.mutation(api.savedMeals.saveFromMeal, { mealId }),
    ).rejects.toThrow(
      state === "empty"
        ? "No matched foods to save."
        : "Only ready meals can be saved.",
    );
    expect(await alice.query(api.savedMeals.list, {})).toEqual([]);
  },
);

it("logs scaled ready meals in today and recent and records insertion time and uses", async () => {
  const { t, alice } = setup();
  const id = await alice.mutation(api.savedMeals.create, recipe);
  vi.spyOn(Date, "now").mockReturnValue(5000);
  const mealId = await alice.mutation(api.savedMeals.log, {
    id,
    at: 100,
    servings: 0.5,
  });
  const rows = await alice.query(api.meals.today, { startMs: 0, endMs: 1000 });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    _id: mealId,
    at: 100,
    description: recipe.name,
    revision: 0,
    analysis: { status: "ready" },
    photoUrl: null,
    items: [
      {
        ...item,
        grams: 50,
        id: "saved:0",
        status: "matched",
        searchQuery: item.name,
        foodDescription: item.name,
      },
    ],
  });
  expect(rows[0].storageId).toBeUndefined();
  expect(await alice.query(api.meals.recent, {})).toMatchObject([
    { id: mealId, kcal: 65, hasPhoto: false },
  ]);
  await alice.mutation(api.savedMeals.log, { id, at: 101, servings: 0.25 });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    items: recipe.items,
    lastUsedAt: 5000,
    useCount: 2,
  });
});

it("rounds logged grams and preserves tiny foods", async () => {
  const { t, alice } = setup();
  const id = await alice.mutation(api.savedMeals.create, {
    ...recipe,
    items: [
      { ...item, grams: 123.45 },
      { ...item, grams: 0.001 },
    ],
  });
  const mealId = await alice.mutation(api.savedMeals.log, {
    id,
    at: 0,
    servings: 0.5,
  });
  expect(
    (await t.run((ctx) => ctx.db.get(mealId)))?.items.map((food) => food.grams),
  ).toEqual([30.9, 0.1]);
});

it("rejects invalid eaten servings and timestamps without adding meals or uses", async () => {
  const { alice } = setup();
  const id = await alice.mutation(api.savedMeals.create, recipe);
  for (const servings of [0, 0.3, 10.25, NaN, Infinity])
    await expect(
      alice.mutation(api.savedMeals.log, { id, at: 1, servings }),
    ).rejects.toThrow("Choose servings from 0.25–10 in steps of 0.25.");
  for (const at of [-1, NaN, Infinity, 8_640_000_000_000_001])
    await expect(
      alice.mutation(api.savedMeals.log, { id, at, servings: 1 }),
    ).rejects.toThrow("Invalid timestamp.");
  expect(await alice.query(api.meals.recent, {})).toEqual([]);
  expect((await alice.query(api.savedMeals.list, {}))[0]).toMatchObject({
    useCount: 0,
    lastUsedAt: null,
  });
});

it("validates create and update, accepts the limits, and preserves fields on partial updates", async () => {
  const { t, alice } = setup();
  const id = await alice.mutation(api.savedMeals.create, recipe);
  for (const fields of [
    { name: " " },
    { name: "x".repeat(81) },
    { items: [] },
    { items: Array.from({ length: 31 }, () => item) },
    ...[0, 21, 1.5].map((servings) => ({ servings })),
    { items: [{ ...item, grams: 10001 }] },
    { items: [{ ...item, fdcId: 1.5 }] },
    { items: [{ ...item, per100g: { ...item.per100g, protein: 101 } }] },
  ]) {
    await expect(
      alice.mutation(api.savedMeals.create, { ...recipe, ...fields }),
    ).rejects.toThrow("Use a saved meal name");
    await expect(
      alice.mutation(api.savedMeals.update, { id, ...fields }),
    ).rejects.toThrow("Use a saved meal name");
  }
  await alice.mutation(api.savedMeals.update, { id, name: " New name " });
  await alice.mutation(api.savedMeals.update, { id, servings: 20 });
  await alice.mutation(api.savedMeals.update, {
    id,
    items: [{ ...item, grams: 10000 }],
  });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    name: "New name",
    servings: 20,
    items: [{ ...item, grams: 10000 }],
    useCount: 0,
  });
  await alice.mutation(api.savedMeals.create, {
    name: "x".repeat(80),
    items: Array.from({ length: 30 }, () => item),
    servings: 20,
  });
});

it("caps each user at 60 recipes across both creation paths and frees deleted slots", async () => {
  const { alice, bob } = setup();
  const ids = [];
  for (let i = 0; i < 60; i++)
    ids.push(
      await alice.mutation(api.savedMeals.create, {
        ...recipe,
        name: `Recipe ${i}`,
      }),
    );
  const mealId = await alice.mutation(api.meals.addManual, {
    at: 0,
    description: "Rice",
    items: [item],
  });
  await expect(alice.mutation(api.savedMeals.create, recipe)).rejects.toThrow(
    "You can save at most 60 meals.",
  );
  await expect(
    alice.mutation(api.savedMeals.saveFromMeal, { mealId }),
  ).rejects.toThrow("You can save at most 60 meals.");
  await bob.mutation(api.savedMeals.create, recipe);
  await alice.mutation(api.savedMeals.update, { id: ids[0], name: "Renamed" });
  await alice.mutation(api.savedMeals.remove, { id: ids[0] });
  await alice.mutation(api.savedMeals.saveFromMeal, { mealId });
  expect(await alice.query(api.savedMeals.list, {})).toHaveLength(60);
});

it("requires auth for every endpoint and hides foreign and missing saved meals", async () => {
  const { t, alice, bob } = setup();
  const id = await alice.mutation(api.savedMeals.create, recipe);
  const mealId = await alice.mutation(api.meals.addManual, {
    at: 0,
    description: "Rice",
    items: [item],
  });
  const before = await t.run((ctx) => ctx.db.get(id));
  for (const request of [
    t.query(api.savedMeals.list, {}),
    t.mutation(api.savedMeals.create, recipe),
    t.mutation(api.savedMeals.saveFromMeal, { mealId }),
    t.mutation(api.savedMeals.update, { id, name: "Guest" }),
    t.mutation(api.savedMeals.remove, { id }),
    t.mutation(api.savedMeals.log, { id, at: 0, servings: 1 }),
  ])
    await expect(request).rejects.toThrow("Sign in to continue.");
  for (const caller of [bob, alice]) {
    if (caller === alice) await alice.mutation(api.savedMeals.remove, { id });
    await expect(
      caller.mutation(api.savedMeals.update, { id, name: "Other" }),
    ).rejects.toThrow("Saved meal not found.");
    await expect(
      caller.mutation(api.savedMeals.log, { id, at: 0, servings: 1 }),
    ).rejects.toThrow("Saved meal not found.");
    await expect(
      caller.mutation(api.savedMeals.remove, { id }),
    ).rejects.toThrow("Saved meal not found.");
    if (caller === bob)
      expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
  }
});

it("exports only the current user's saved meals with recipe data and totals", async () => {
  const { alice, bob } = setup();
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const id = await alice.mutation(api.savedMeals.create, recipe);
  await bob.mutation(api.savedMeals.create, { ...recipe, name: "Private" });
  expect((await alice.query(api.exportData.all, {})).savedMeals).toEqual([
    {
      id,
      ...recipe,
      createdAt: 1000,
      lastUsedAt: null,
      useCount: 0,
      totals: { kcal: 260, protein: 4, carbs: 56, fat: 0.6 },
      perServing: item.per100g,
    },
  ]);
});

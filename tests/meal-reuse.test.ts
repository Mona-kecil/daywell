import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mealTotals, type MealItem } from "../lib/nutrients";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const per100g = { kcal: 130, protein: 2, carbs: 28, fat: 0.3 };
const manual = {
  at: 100,
  description: " Rice ",
  items: [{ name: " Rice ", grams: 200, per100g }],
};
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
afterEach(() => vi.unstubAllGlobals());

it("adds photo-free meals, scales nutrients, supports edits, and exports manual meals without invented FDC IDs", async () => {
  const { t, alice, bob } = setup();
  await expect(t.mutation(api.meals.addManual, manual)).rejects.toThrow(
    "Sign in",
  );
  const id = await alice.mutation(api.meals.addManual, manual);
  const meal = await alice.query(internal.meals.read, { id });
  expect(meal).toMatchObject({
    description: "Rice",
    photoUrl: null,
    analysis: { status: "ready" },
    items: [{ name: "Rice", grams: 200, status: "matched", per100g }],
  });
  expect(meal.storageId).toBeUndefined();
  expect(meal.items[0]).not.toHaveProperty("fdcId");
  expect(mealTotals(meal.items)).toEqual({
    kcal: 260,
    protein: 4,
    carbs: 56,
    fat: 0.6,
  });
  expect(await bob.query(api.meals.recent, {})).toEqual([]);
  expect(
    (await alice.query(api.meals.today, { startMs: 0, endMs: 1000 }))[0]
      .photoUrl,
  ).toBeNull();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(alice.action(api.mealActions.reanalyze, { id })).rejects.toThrow(
    "This meal has no photo to re-analyse.",
  );
  expect((await alice.query(internal.meals.read, { id })).analysis.status).toBe(
    "ready",
  );
  expect(fetch).not.toHaveBeenCalled();
  await alice.mutation(api.meals.setGrams, {
    id,
    itemId: meal.items[0].id,
    grams: 100,
  });
  expect((await alice.query(api.exportData.all, {})).meals[0].totals).toEqual(
    per100g,
  );
  await alice.mutation(api.meals.deleteMeal, { id });
  expect(await alice.query(api.meals.recent, {})).toEqual([]);
});

it.each(["original-first", "repeat-first"])(
  "copies ready meal data without sharing storage (%s)",
  async (order) => {
    const { t, alice, bob } = setup();
    const items = [
      {
        id: "rice",
        name: "Rice",
        grams: 200,
        searchQuery: "rice",
        status: "matched",
        fdcId: 123,
        foodDescription: "Cooked rice",
        per100g,
      },
      {
        id: "unknown",
        name: "Unknown",
        grams: 10,
        searchQuery: "unknown",
        status: "unmatched",
      },
    ] satisfies MealItem[];
    const { mealId, photo } = await t.run(async (ctx) => {
      const photo = await ctx.storage.store(new Blob(["photo"]));
      const mealId = await ctx.db.insert("meals", {
        userId: "alice",
        storageId: photo,
        at: 1,
        description: "Rice dish",
        items,
        revision: 7,
        analysis: { status: "ready" },
      });
      return { mealId, photo };
    });
    await expect(
      bob.mutation(api.meals.repeat, { mealId, at: 10 }),
    ).rejects.toThrow("Meal not found.");
    await expect(
      t.mutation(api.meals.repeat, { mealId, at: 10 }),
    ).rejects.toThrow("Sign in");
    await expect(
      alice.mutation(api.meals.repeat, { mealId, at: -1 }),
    ).rejects.toThrow("Invalid timestamp.");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const id = await alice.mutation(api.meals.repeat, { mealId, at: 10 });
    const copy = await alice.query(internal.meals.read, { id });
    expect(copy).toMatchObject({
      at: 10,
      description: "Rice dish",
      items,
      revision: 0,
      analysis: { status: "ready" },
      photoUrl: null,
    });
    expect(copy.storageId).toBeUndefined();
    expect(mealTotals(copy.items)).toEqual(mealTotals(items));
    expect(fetch).not.toHaveBeenCalled();
    expect(await alice.query(api.meals.recent, {})).toMatchObject([
      { id, hasPhoto: false, kcal: 260 },
    ]);
    if (order === "repeat-first") {
      await alice.mutation(api.meals.deleteMeal, { id });
      expect(
        await t.run(async (ctx) => (await ctx.storage.get(photo))?.text()),
      ).toBe("photo");
      expect(await alice.query(api.meals.recent, {})).toMatchObject([
        { id: mealId, hasPhoto: true },
      ]);
    } else {
      await alice.mutation(api.meals.deleteMeal, { id: mealId });
      expect(await t.run((ctx) => ctx.storage.get(photo))).toBeNull();
      expect((await alice.query(internal.meals.read, { id })).items).toEqual(
        items,
      );
      await alice.mutation(api.meals.deleteMeal, { id });
    }
  },
);

it.each(["analyzing", "error"] as const)(
  "rejects repeating %s meals",
  async (status) => {
    const { t, alice } = setup();
    const mealId = await t.run((ctx) =>
      ctx.db.insert("meals", {
        userId: "alice",
        at: 1,
        description: "Rice",
        items: [],
        revision: 0,
        analysis:
          status === "analyzing"
            ? { status, startedAt: 1 }
            : { status, message: "Failed" },
      }),
    );
    await expect(
      alice.mutation(api.meals.repeat, { mealId, at: 2 }),
    ).rejects.toThrow("Only analysed meals can be repeated.");
    expect(await alice.query(api.meals.recent, {})).toEqual([]);
  },
);

it("dedupes NFKC/case/whitespace descriptions, keeps the newest, and caps the list and scan", async () => {
  const { t, alice } = setup();
  await expect(t.query(api.meals.recent, {})).rejects.toThrow("Sign in");
  await alice.mutation(api.meals.addManual, {
    ...manual,
    description: "Ｒｉｃｅ   dish",
    at: 1,
  });
  const id = await alice.mutation(api.meals.addManual, {
    ...manual,
    description: " rice DISH ",
    at: 2,
  });
  const other = await alice.mutation(api.meals.addManual, {
    ...manual,
    description: "Other",
    at: 3,
  });
  expect((await alice.query(api.meals.recent, {})).map((m) => m.id)).toEqual([
    other,
    id,
  ]);
  expect(
    (await alice.query(api.meals.recent, { limit: 1 })).map((m) => m.id),
  ).toEqual([other]);
  for (const limit of [0, 21, 1.5, Infinity])
    await expect(alice.query(api.meals.recent, { limit })).rejects.toThrow(
      "Limit must be an integer from 1–20.",
    );
  for (let i = 0; i < 25; i++)
    await alice.mutation(api.meals.addManual, {
      ...manual,
      at: i + 10,
      description: `Dish ${i}`,
    });
  expect(await alice.query(api.meals.recent, {})).toHaveLength(20);
  for (let i = 0; i < 200; i++)
    await alice.mutation(api.meals.addManual, {
      ...manual,
      at: 1000 + i,
      description: "Same dish",
    });
  expect(await alice.query(api.meals.recent, {})).toHaveLength(1);
});

it("validates every manual boundary, accepts maxima and zero nutrients, and rolls back failures", async () => {
  const { alice } = setup();
  for (const args of [
    { ...manual, description: " " },
    { ...manual, description: "x".repeat(4001) },
    { ...manual, items: [] },
    { ...manual, items: Array.from({ length: 31 }, () => manual.items[0]) },
    ...[
      { name: " " },
      { name: "x".repeat(201) },
      { grams: 0 },
      { grams: -1 },
      { grams: 10001 },
      { grams: NaN },
      { fdcId: 0 },
      { fdcId: -1 },
      { fdcId: 1.5 },
      { fdcId: Infinity },
    ].map((fields) => ({
      ...manual,
      items: [{ ...manual.items[0], ...fields }],
    })),
    ...["kcal", "protein", "carbs", "fat"].flatMap((key) =>
      [-1, Infinity, NaN, key === "kcal" ? 1001 : 101].map((value) => ({
        ...manual,
        items: [{ ...manual.items[0], per100g: { ...per100g, [key]: value } }],
      })),
    ),
  ])
    await expect(alice.mutation(api.meals.addManual, args)).rejects.toThrow(
      "Use a description",
    );
  for (const at of [-1, Infinity, NaN, 8_640_000_000_000_001])
    await expect(
      alice.mutation(api.meals.addManual, { ...manual, at }),
    ).rejects.toThrow("Invalid timestamp.");
  expect(await alice.query(api.meals.recent, {})).toEqual([]);
  await alice.mutation(api.meals.addManual, {
    at: 0,
    description: "x".repeat(4000),
    items: Array.from({ length: 30 }, () => ({
      name: "x".repeat(200),
      grams: 10000,
      fdcId: 1,
      per100g: { kcal: 1000, protein: 100, carbs: 100, fat: 100 },
    })),
  });
  const zero = await alice.mutation(api.meals.addManual, {
    ...manual,
    at: 1,
    items: [
      {
        ...manual.items[0],
        per100g: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      },
    ],
  });
  expect((await alice.query(api.meals.recent, {}))[0]).toMatchObject({
    id: zero,
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });
});

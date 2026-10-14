import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { mealTotals, type MealItem } from "../lib/nutrients";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const paginationOpts = { numItems: 24, cursor: null };
const items = [
  {
    id: "rice",
    name: "Rice",
    grams: 175,
    searchQuery: "rice",
    status: "matched",
    foodDescription: "Cooked rice",
    per100g: { kcal: 130, protein: 2, carbs: 28, fat: 0.3 },
  },
  {
    id: "chicken",
    name: "Chicken",
    grams: 80,
    searchQuery: "chicken",
    status: "matched",
    foodDescription: "Cooked chicken",
    per100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  },
  {
    id: "unknown",
    name: "Sauce",
    grams: 20,
    searchQuery: "sauce",
    status: "unmatched",
  },
] satisfies MealItem[];

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

async function seedMeal(
  t: ReturnType<typeof setup>["t"],
  fields: Partial<
    Pick<Doc<"meals">, "userId" | "at" | "description" | "analysis" | "items">
  > & { hasPhoto?: boolean } = {},
) {
  const { hasPhoto = true, ...overrides } = fields;
  return t.run(async (ctx) => {
    const storageId = hasPhoto
      ? await ctx.storage.store(
          new Blob(["photo fixture"], { type: "image/jpeg" }),
        )
      : undefined;
    const id = await ctx.db.insert("meals", {
      userId: "alice",
      storageId,
      at: 100,
      description: "Rice and chicken",
      items,
      revision: 0,
      analysis: { status: "ready" },
      ...overrides,
    });
    return { id, storageId };
  });
}

it("rejects unauthenticated photo queries", async () => {
  const { t } = setup();
  await expect(t.query(api.meals.photos, { paginationOpts })).rejects.toThrow(
    "Sign in to continue.",
  );
});

it("returns only the caller's meals", async () => {
  const { t, alice, bob } = setup();
  const own = await seedMeal(t);
  const other = await seedMeal(t, { userId: "bob", at: 200 });
  expect(
    (await alice.query(api.meals.photos, { paginationOpts })).page.map(
      (meal) => meal.id,
    ),
  ).toEqual([own.id]);
  expect(
    (await bob.query(api.meals.photos, { paginationOpts })).page.map(
      (meal) => meal.id,
    ),
  ).toEqual([other.id]);
});

it("excludes photo-less meals before paginating", async () => {
  const { t, alice } = setup();
  const photo = await seedMeal(t);
  await seedMeal(t, { hasPhoto: false, at: 200 });
  const result = await alice.query(api.meals.photos, {
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(result.page.map((meal) => meal.id)).toEqual([photo.id]);
  expect(result.isDone).toBe(true);
});

it.each<Doc<"meals">["analysis"]>([
  { status: "analyzing", startedAt: 1 },
  { status: "error", message: "Analysis failed" },
])("excludes $status meals with photos", async (analysis) => {
  const { t, alice } = setup();
  const ready = await seedMeal(t);
  await seedMeal(t, { at: 200, analysis });
  const result = await alice.query(api.meals.photos, { paginationOpts });
  expect(result.page.map((meal) => meal.id)).toEqual([ready.id]);
});

it("returns photos newest first by meal time", async () => {
  const { t, alice } = setup();
  const middle = await seedMeal(t, { at: 200 });
  const newest = await seedMeal(t, { at: 300 });
  const oldest = await seedMeal(t, { at: 100 });
  const result = await alice.query(api.meals.photos, { paginationOpts });
  expect(result.page.map((meal) => meal.id)).toEqual([
    newest.id,
    middle.id,
    oldest.id,
  ]);
});

it("paginates two pages without missing or duplicating photos", async () => {
  const { t, alice } = setup();
  const first = await seedMeal(t, { at: 100 });
  const second = await seedMeal(t, { at: 200 });
  const third = await seedMeal(t, { at: 300 });
  for (const at of [50, 150, 250, 350])
    await seedMeal(t, { at, hasPhoto: false });
  const page1 = await alice.query(api.meals.photos, {
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(page1.page.map((meal) => meal.id)).toEqual([third.id, second.id]);
  expect(page1.isDone).toBe(false);
  expect(page1.continueCursor).toEqual(expect.any(String));
  const page2 = await alice.query(api.meals.photos, {
    paginationOpts: { numItems: 2, cursor: page1.continueCursor },
  });
  expect(page2.page.map((meal) => meal.id)).toEqual([first.id]);
  expect(page2.isDone).toBe(true);
  const ids = [...page1.page, ...page2.page].map((meal) => meal.id);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3);
});

it.each([0, 61, 1.5])("rejects numItems bounds: %s", async (numItems) => {
  const { alice } = setup();
  const result = alice.query(api.meals.photos, {
    paginationOpts: { numItems, cursor: null },
  });
  await expect(result).rejects.toBeInstanceOf(ConvexError);
  await expect(result).rejects.toThrow("Limit must be an integer from 1–60.");
});

it.each([1, 60])("accepts numItems boundary %s", async (numItems) => {
  const { t, alice } = setup();
  const photo = await seedMeal(t);
  const result = await alice.query(api.meals.photos, {
    paginationOpts: { numItems, cursor: null },
  });
  expect(result.page.map((meal) => meal.id)).toEqual([photo.id]);
  expect(result.isDone).toBe(true);
});

it("returns the photo URL, meal fields, and mealTotals for all items", async () => {
  const { t, alice } = setup();
  const { id, storageId } = await seedMeal(t);
  if (!storageId) throw new Error("Missing fixture photo");
  const photoUrl = await t.run((ctx) => ctx.storage.getUrl(storageId));
  expect(photoUrl).toEqual(expect.any(String));
  const result = await alice.query(api.meals.photos, { paginationOpts });
  expect(result.page).toEqual([
    {
      id,
      at: 100,
      description: "Rice and chicken",
      photoUrl,
      ...mealTotals(items),
    },
  ]);
});

it("keeps a meal with photoUrl null after its storage blob is deleted", async () => {
  const { t, alice } = setup();
  const { id, storageId } = await seedMeal(t);
  if (!storageId) throw new Error("Missing fixture photo");
  await t.run((ctx) => ctx.storage.delete(storageId));
  const result = await alice.query(api.meals.photos, { paginationOpts });
  expect(result.page).toEqual([
    {
      id,
      at: 100,
      description: "Rice and chicken",
      photoUrl: null,
      ...mealTotals(items),
    },
  ]);
  expect(result.isDone).toBe(true);
});

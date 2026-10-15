import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import fixtures from "../lib/fixtures/fdc-search.json";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const rice = fixtures.cases[0].response.foods[0];
const per100g = { kcal: 130, protein: 2.69, carbs: 28.17, fat: 0.28 };
const invalidQuery = "Search for a food name of 2 to 80 characters.";
const missingMatch =
  "That food is no longer in the USDA results. Search again.";
const unavailable = "Food search is unavailable right now. Please try again.";

beforeEach(() => {
  vi.stubEnv("FDC_MODE", "fixture");
  vi.stubEnv("CONVEX_CLOUD_URL", "http://localhost:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected HTTP request");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function photoMeal() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["photo fixture"], { type: "image/jpeg" })),
  );
  const id = await t.run((ctx) =>
    ctx.db.insert("meals", {
      userId: "alice",
      storageId,
      at: 1,
      description: "Rice and vegetables",
      revision: 4,
      analysis: { status: "ready" },
      items: [
        {
          id: "rice",
          name: "White rice",
          grams: 200,
          searchQuery: "old query",
          status: "unmatched",
        },
        {
          id: "side",
          name: "Vegetables",
          grams: 100,
          searchQuery: "vegetables",
          status: "matched",
          fdcId: 123,
          foodDescription: "Vegetables",
          per100g: { kcal: 50, protein: 2, carbs: 3, fat: 4 },
        },
      ],
    }),
  );
  const args = { id, itemId: "rice", query: "rice", fdcId: rice.fdcId };
  const read = () => t.run((ctx) => ctx.db.get(id));
  return { t, alice, bob, id, args, read };
}

async function expectConvexError(result: Promise<unknown>, message: string) {
  await expect(result).rejects.toBeInstanceOf(ConvexError);
  await expect(result).rejects.toMatchObject({ data: message });
}

it("picks fixture nutrients, preserves the meal and other items, and updates server totals", async () => {
  const { alice, args, read } = await photoMeal();
  const before = await read();
  await alice.action(api.mealActions.pickMatch, {
    ...args,
    query: " \t white   rice\n cooked ",
  });
  const after = await read();
  expect(after).toEqual({
    ...before,
    revision: 5,
    analysis: { status: "ready" },
    items: [
      {
        id: "rice",
        name: "White rice",
        grams: 200,
        searchQuery: "white rice cooked",
        status: "matched",
        fdcId: rice.fdcId,
        foodDescription: rice.description,
        per100g,
      },
      before?.items[1],
    ],
  });
  expect(await alice.query(api.meals.recent, {})).toEqual([
    {
      id: args.id,
      description: "Rice and vegetables",
      at: 1,
      hasPhoto: true,
      kcal: 310,
      protein: 7.38,
      carbs: 59.34,
      fat: expect.closeTo(4.56, 10),
    },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["rice", "no fixture matches this"])(
  "leaves the document byte-for-byte unchanged when the ID is absent for %j",
  async (query) => {
    const { alice, args, read } = await photoMeal();
    const before = JSON.stringify(await read());
    await expectConvexError(
      alice.action(api.mealActions.pickMatch, {
        ...args,
        query,
        fdcId: 999999,
      }),
      missingMatch,
    );
    expect(JSON.stringify(await read())).toBe(before);
  },
);

it("requires auth before ownership, validation, or search", async () => {
  const { t, args, read } = await photoMeal();
  const before = await read();
  await expectConvexError(
    t.action(api.mealActions.pickMatch, { ...args, query: "a" }),
    "Sign in to continue.",
  );
  expect(await read()).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects another user's meal with the research ownership error", async () => {
  const { alice, bob, args, read } = await photoMeal();
  const before = await read();
  await expectConvexError(
    bob.action(api.mealActions.research, {
      id: args.id,
      itemId: args.itemId,
      query: args.query,
    }),
    "Meal not found.",
  );
  await expectConvexError(
    bob.action(api.mealActions.pickMatch, args),
    "Meal not found.",
  );
  expect(await read()).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
  expect(await alice.query(api.meals.recent, {})).toHaveLength(1);
});

it("rejects an unknown item before searching", async () => {
  const { alice, args, read } = await photoMeal();
  const before = await read();
  await expectConvexError(
    alice.action(api.mealActions.pickMatch, { ...args, itemId: "missing" }),
    "Item not found.",
  );
  expect(await read()).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["a", "a".repeat(81), " \t "])(
  "rejects invalid query %j without changing the meal",
  async (query) => {
    const { alice, args, read } = await photoMeal();
    const before = await read();
    await expectConvexError(
      alice.action(api.mealActions.pickMatch, { ...args, query }),
      invalidQuery,
    );
    expect(await read()).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("refuses an analysing meal before searching", async () => {
  const { t, alice, id, args, read } = await photoMeal();
  await t.run((ctx) =>
    ctx.db.patch(id, { analysis: { status: "analyzing", startedAt: 123 } }),
  );
  const before = await read();
  await expectConvexError(
    alice.action(api.mealActions.pickMatch, args),
    "Wait for the analysis to finish.",
  );
  expect(await read()).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
});

it("wraps an upstream 500 and leaves the document byte-for-byte unchanged", async () => {
  const { alice, args, read } = await photoMeal();
  vi.stubEnv("FDC_MODE", "live");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Failure", { status: 500 })),
  );
  const before = JSON.stringify(await read());
  await expectConvexError(
    alice.action(api.mealActions.pickMatch, args),
    unavailable,
  );
  expect(JSON.stringify(await read())).toBe(before);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("picks the requested result instead of the first complete result", async () => {
  const { alice, args, read } = await photoMeal();
  vi.stubEnv("FDC_MODE", "live");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            foods: [rice, { ...rice, fdcId: 42, description: "Chosen rice" }],
          }),
        ),
    ),
  );
  await alice.action(api.mealActions.pickMatch, { ...args, fdcId: 42 });
  expect((await read())?.items[0]).toEqual({
    id: "rice",
    name: "White rice",
    grams: 200,
    searchQuery: "rice",
    status: "matched",
    fdcId: 42,
    foodDescription: "Chosen rice",
    per100g,
  });
});

it("surfaces a revision conflict without overwriting the edit or retrying", async () => {
  const { alice, args, read } = await photoMeal();
  vi.stubEnv("FDC_MODE", "live");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await alice.mutation(api.meals.setGrams, {
        id: args.id,
        itemId: args.itemId,
        grams: 300,
      });
      return new Response(JSON.stringify({ foods: [rice] }));
    }),
  );
  const before = await read();
  await expectConvexError(
    alice.action(api.mealActions.pickMatch, args),
    "Meal changed. Please retry your search.",
  );
  expect(await read()).toEqual({
    ...before,
    revision: 5,
    items: before?.items.map((item) =>
      item.id === "rice" ? { ...item, grams: 300 } : item,
    ),
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

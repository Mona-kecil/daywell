import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { searchFoods } from "../lib/fdc";
import fixtures from "../lib/fixtures/fdc-search.json";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const rice = fixtures.cases[0].response.foods[0];
const riceHit = {
  fdcId: rice.fdcId,
  description: rice.description,
  dataType: "SR Legacy",
  per100g: { kcal: 130, protein: 2.69, carbs: 28.17, fat: 0.28 },
};
const invalidQuery = "Search for a food name of 2 to 80 characters.";
const unavailable = "Food search is unavailable right now. Please try again.";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function mockFoods(foods: unknown[]) {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(JSON.stringify({ foods })),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("returns the rice fixture without HTTP", async () => {
  const fetch = vi.fn(() => {
    throw new Error("Fixture mode must not call USDA");
  });
  vi.stubGlobal("fetch", fetch);
  expect(await searchFoods("rice", undefined, "fixture")).toEqual([riceHit]);
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps relevance order, skips malformed and incomplete foods, and deduplicates usable IDs", async () => {
  mockFoods([
    { ...rice, fdcId: "broken" },
    { ...rice, fdcId: 7, foodNutrients: [] },
    { ...rice, fdcId: 7, description: "First", score: 1 },
    { ...rice, fdcId: 7, description: "Duplicate", score: 99 },
    { ...rice, fdcId: 3, description: "Second", score: 100 },
    {
      fdcId: 9,
      description: "Third",
      foodNutrients: rice.foodNutrients,
    },
  ]);
  expect(await searchFoods("rice")).toEqual([
    { ...riceHit, fdcId: 7, description: "First" },
    { ...riceHit, fdcId: 3, description: "Second" },
    { ...riceHit, fdcId: 9, description: "Third", dataType: "" },
  ]);
});

it("caps complete unique results at eight in relevance order", async () => {
  mockFoods(Array.from({ length: 12 }, (_, i) => ({ ...rice, fdcId: 20 - i })));
  expect((await searchFoods("rice")).map((hit) => hit.fdcId)).toEqual([
    20, 19, 18, 17, 16, 15, 14, 13,
  ]);
});

it("returns no hits when all results are unusable", async () => {
  mockFoods([null, {}, { ...rice, foodNutrients: [] }]);
  expect(await searchFoods("rice")).toEqual([]);
});

it("normalizes the query and encodes query and data type spaces as %20", async () => {
  const fetch = mockFoods([rice]);
  await searchFoods(" \t white   rice\n cooked  ", "test-key");
  const rawUrl = String(fetch.mock.calls[0]?.[0]);
  const url = new URL(rawUrl);
  expect(url.searchParams.get("query")).toBe("white rice cooked");
  expect(url.searchParams.get("dataType")).toBe(
    "Foundation,SR Legacy,Survey (FNDDS)",
  );
  expect(url.searchParams.get("api_key")).toBe("test-key");
  expect(rawUrl).toContain("query=white%20rice%20cooked");
  expect(rawUrl).toContain("SR%20Legacy");
  expect(rawUrl).toContain("Survey%20%28FNDDS%29");
  expect(rawUrl).not.toContain("+");
});

it.each(["", " \t ", "a", "a".repeat(81)])(
  "rejects invalid query %j before HTTP",
  async (query) => {
    const fetch = mockFoods([]);
    await expect(searchFoods(query)).rejects.toThrow(invalidQuery);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each(["ab", "a".repeat(80)])("accepts boundary query %j", async (query) => {
  const fetch = mockFoods([]);
  expect(await searchFoods(`  ${query}  `)).toEqual([]);
  expect(
    new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("query"),
  ).toBe(query);
});

it("does not expose the key or URL on HTTP failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Failure", { status: 500 })),
  );
  await expect(searchFoods("rice", "secret-key")).rejects.toThrow(unavailable);
});

it("does not expose a URL or key from a rejected fetch", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      throw new Error(`Request failed: ${url}`);
    }),
  );
  const error = await searchFoods("rice", "secret-key").catch((error) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe(unavailable);
  expect(error.message).not.toContain("api_key");
  expect(error.message).not.toContain("secret-key");
  expect(error.message).not.toContain("https://");
});

it("requires auth before query validation or search", async () => {
  const t = convexTest(schema, modules);
  const fetch = mockFoods([]);
  for (const query of ["rice", "a"]) {
    await expect(t.action(api.food.search, { query })).rejects.toThrow(
      "Sign in to continue.",
    );
  }
  expect(fetch).not.toHaveBeenCalled();
});

it.each([" \t ", " a ", "a".repeat(81)])(
  "rejects invalid action query %j with a ConvexError",
  async (query) => {
    const alice = convexTest(schema, modules).withIdentity({
      subject: "alice",
    });
    const fetch = mockFoods([]);
    const error = await alice
      .action(api.food.search, { query })
      .catch((error) => error);
    expect(error).toBeInstanceOf(ConvexError);
    expect(error.data).toBe(invalidQuery);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("returns fixture hits through the action without HTTP", async () => {
  const alice = convexTest(schema, modules).withIdentity({ subject: "alice" });
  vi.stubEnv("FDC_MODE", "fixture");
  vi.stubEnv("CONVEX_CLOUD_URL", "http://localhost:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  const fetch = mockFoods([]);
  expect(await alice.action(api.food.search, { query: "  rice  " })).toEqual([
    riceHit,
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("wraps an upstream 500 in a friendly ConvexError without the API key", async () => {
  const alice = convexTest(schema, modules).withIdentity({ subject: "alice" });
  vi.stubEnv("FDC_MODE", "live");
  vi.stubEnv("USDA_FDC_API_KEY", "secret-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Failure", { status: 500 })),
  );
  const error = await alice
    .action(api.food.search, { query: "rice" })
    .catch((error) => error);
  expect(error).toBeInstanceOf(ConvexError);
  expect(error.data).toBe(unavailable);
  expect(error.message).not.toContain("api_key");
  expect(error.message).not.toContain("secret-key");
});

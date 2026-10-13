import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { validBarcode } from "../lib/barcode";
import { lookupBarcode } from "../lib/fdc";
import fixtures from "../lib/fixtures/fdc-barcodes.json";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(["96385074", "012345678905", "4006381333931", "0012345678905"])(
  "validates barcode %s and rejects a changed check digit",
  (code) => {
    expect(validBarcode(code)).toBe(true);
    expect(
      validBarcode(code.slice(0, -1) + ((Number(code.at(-1)) + 1) % 10)),
    ).toBe(false);
  },
);
it.each([
  "",
  "123",
  "01234567890",
  "12345678901234",
  " 012345678905",
  "012345678905 ",
  "01234567890a",
  "９６３８５０７４",
  "01234567-8905",
])("rejects barcode syntax %s", (code) =>
  expect(validBarcode(code)).toBe(false),
);

it("looks up both fixture products and a miss without HTTP, including padded UPC equivalence", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  vi.stubEnv("FDC_MODE", "fixture");
  vi.stubEnv("CONVEX_CLOUD_URL", "http://localhost:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    t.action(api.food.lookupBarcode, { code: "012345678905" }),
  ).rejects.toThrow("Sign in");
  await expect(
    alice.action(api.food.lookupBarcode, { code: "012345678906" }),
  ).rejects.toThrow(
    "Use a valid EAN-8, EAN-13 or UPC-A barcode with its check digit.",
  );
  const cereal = await alice.action(api.food.lookupBarcode, {
    code: "012345678905",
  });
  expect(cereal).toEqual({
    fdcId: 9000001,
    description: "Demo whole grain cereal",
    brand: "Daywell Demo",
    servingGrams: 40,
    per100g: { kcal: 350, protein: 10, carbs: 70, fat: 5 },
  });
  expect(
    await alice.action(api.food.lookupBarcode, { code: "0012345678905" }),
  ).toEqual(cereal);
  expect(
    await alice.action(api.food.lookupBarcode, { code: "4006381333931" }),
  ).toMatchObject({
    fdcId: 9000002,
    brand: "Daywell Demo Dairy",
    servingGrams: 150,
    per100g: { kcal: 80 },
  });
  expect(
    await alice.action(api.food.lookupBarcode, { code: "96385074" }),
  ).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ["https://prod.convex.cloud", "https://prod.convex.site"],
  ["http://localhost:3210", "https://prod.convex.site"],
  ["", "http://localhost:3211"],
])("fails closed for fixture mode on %s / %s", async (cloud, site) => {
  vi.stubEnv("FDC_MODE", "fixture");
  vi.stubEnv("CONVEX_CLOUD_URL", cloud);
  vi.stubEnv("CONVEX_SITE_URL", site);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const alice = convexTest(schema, modules).withIdentity({ subject: "alice" });
  await expect(
    alice.action(api.food.lookupBarcode, { code: "012345678905" }),
  ).rejects.toThrow(
    "FDC_MODE=fixture requires a local Convex deployment. Set FDC_MODE=live for production.",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("restricts live search to Branded and exact gtinUpc; reports grams only for mass servings", async () => {
  const food = fixtures.cases[0].response.foods[0];
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        JSON.stringify({
          foods: [
            { ...food, gtinUpc: "4006381333931", description: "Wrong barcode" },
            { ...food, dataType: "Foundation" },
            { ...food, foodNutrients: [] },
            { ...food, gtinUpc: "00012345678905", servingSizeUnit: "ml" },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const found = await lookupBarcode("012345678905", "test-key");
  expect(found).toMatchObject({ fdcId: food.fdcId, servingGrams: null });
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.searchParams.get("query")).toBe("012345678905");
  expect(url.searchParams.get("dataType")).toBe("Branded");
  expect(url.searchParams.get("pageSize")).toBe("25");
  expect(url.searchParams.get("api_key")).toBe("test-key");
});

it("uses DEMO_KEY fallback, rejects HTTP failures, and returns null for unusable results", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify({ foods: [{ description: "broken" }] })),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await lookupBarcode("012345678905", "")).toBeNull();
  expect(
    new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("api_key"),
  ).toBe("DEMO_KEY");
  fetch.mockImplementation(async () => new Response("Quota", { status: 429 }));
  await expect(lookupBarcode("012345678905")).rejects.toThrow(
    "USDA search failed (429). Please retry later.",
  );
});

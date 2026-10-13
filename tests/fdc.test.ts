import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { groundFood } from "../lib/fdc";
import { photoDigest } from "../lib/photo";
afterEach(() => vi.unstubAllGlobals());
it("returns unmatched when every USDA result is unusable", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        JSON.stringify({
          foods: [{ fdcId: 1, description: "Incomplete", foodNutrients: [] }],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await groundFood({
    id: "1",
    name: "Rice",
    grams: 150,
    searchQuery: "rice white cooked",
  });
  expect(result.status).toBe("unmatched");
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.searchParams.get("dataType")).toBe(
    "Foundation,SR Legacy,Survey (FNDDS)",
  );
  expect(url.searchParams.get("api_key")).toBe("DEMO_KEY");
  expect(url.toString()).not.toContain("+");
});
it("encodes photo hashes as Convex system metadata base64", async () => {
  const result = await photoDigest(new Blob(["photo"]));
  expect(result).toBe(createHash("sha256").update("photo").digest("base64"));
});

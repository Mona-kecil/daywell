import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { fdcMode, isLocalDeployment } from "../lib/local-deployment";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("permits fixtures only when both deployment URLs are loopback", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    expect(
      fdcMode({
        FDC_MODE: "fixture",
        CONVEX_CLOUD_URL: `http://${host}:3210`,
        CONVEX_SITE_URL: `http://${host}:3211`,
      }),
    ).toBe("fixture");
  }
  for (const cloud of [
    undefined,
    "bad",
    "https://prod.convex.cloud",
    "http://localhost.evil.com",
    "http://localhost@evil.com",
    "file://localhost/",
  ]) {
    const env = {
      FDC_MODE: "fixture",
      CONVEX_CLOUD_URL: cloud,
      CONVEX_SITE_URL: "http://localhost:3211",
    };
    expect(isLocalDeployment(env)).toBe(false);
    expect(() => fdcMode(env)).toThrow("requires a local");
    expect(fdcMode({ ...env, FDC_MODE: "live" })).toBe("live");
  }
  expect(() =>
    fdcMode({
      FDC_MODE: "fixture",
      CONVEX_CLOUD_URL: "http://localhost:3210",
      CONVEX_SITE_URL: "https://prod.convex.site",
    }),
  ).toThrow("requires a local");
});

it("meal actions reject production fixtures and use the real fixture parser locally", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const id = await t.run(async (ctx) =>
    ctx.db.insert("meals", {
      userId: "alice",
      storageId: await ctx.storage.store(new Blob(["photo"])),
      at: 1,
      description: "Rice",
      items: [],
      revision: 1,
      analysis: { status: "ready" },
    }),
  );
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("MEAL_VISION_PROVIDER", "fake");
  vi.stubEnv("FDC_MODE", "fixture");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://prod.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://prod.convex.site");
  await alice.action(api.mealActions.reanalyze, { id });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    analysis: {
      status: "error",
      message: expect.stringContaining("requires a local"),
    },
    items: [],
  });
  expect(fetch).not.toHaveBeenCalled();
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  await alice.action(api.mealActions.reanalyze, { id });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    analysis: { status: "ready" },
    items: [{ status: "matched" }],
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("auth config excludes the dev issuer in production and retains WorkOS", async () => {
  vi.stubEnv("DEV_AUTH_JWKS", "configured");
  vi.stubEnv("WORKOS_CLIENT_ID", "test-client");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://prod.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://prod.convex.site");
  const prod = (await import("../convex/auth.config")).default;
  expect(prod.providers).toHaveLength(2);
  expect(
    prod.providers.some((p) => p.issuer === "https://daywell.dev.local"),
  ).toBe(false);
  vi.resetModules();
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  expect(
    (await import("../convex/auth.config")).default.providers,
  ).toHaveLength(3);
});

import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";
import { mealTotals } from "../lib/nutrients";
import { recovery } from "../lib/recovery";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = new Date("2026-10-13T14:00:00Z").getTime();
const start = new Date("2026-10-13T00:00:00Z").getTime();
const input = {
  now,
  days: Array.from({ length: 14 }, (_, i) => start - i * 86_400_000),
  photos: ["cGhvdG8=", "cGhvdG8=", "cGhvdG8=", "cGhvdG8="],
};
afterEach(() => vi.unstubAllEnvs());

it("demo seed replaces thirty-six days, deletes old photos, and preserves other users", async () => {
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  vi.stubEnv("DEV_AUTH_JWKS", "configured");
  const t = convexTest(schema, modules);
  const dev = t.withIdentity({ subject: DEV_USER, issuer: DEV_ISSUER });
  const other = t.withIdentity({ subject: "other" });
  await other.mutation(api.tracker.addWater, { amountMl: 123, at: start });
  await other.mutation(api.checkins.upsert, {
    day: "2026-10-13",
    weightKg: 99,
  });
  const first = await dev.action(api.demoSeed.run, input);
  const meals = await dev.query(api.meals.today, {
    startMs: start,
    endMs: start + 86_400_000,
  });
  expect(meals).toHaveLength(2);
  expect(
    meals.every(
      (m) => m.analysis.status === "ready" && mealTotals(m.items).kcal > 0,
    ),
  ).toBe(true);
  const second = await dev.action(api.demoSeed.run, input);
  expect(second).toEqual(first);
  expect(second).toEqual({
    days: 36,
    meals: 108,
    water: 216,
    workouts: 27,
    muscles: 11,
    checkins: 81,
  });
  const achievements = await dev.query(api.achievements.list, {
    now,
    timeZone: "UTC",
  });
  expect(
    achievements.filter((a) => a.earnedAt !== null).length,
  ).toBeGreaterThan(0);
  expect(
    achievements.find((a) => a.id === "sets-100")?.earnedAt,
  ).not.toBeNull();
  expect(
    await dev.query(api.coach.weeklyReview, { now, timeZone: "UTC" }),
  ).toMatchObject({ workouts: expect.any(Number), daysLogged: 7 });
  expect(
    (await dev.query(api.coach.weeklyReview, { now, timeZone: "UTC" }))
      .totalSets,
  ).toBeGreaterThan(0);
  const oldPhoto = meals[0].storageId;
  if (!oldPhoto) throw new Error("Missing demo photo");
  expect(await t.run((ctx) => ctx.storage.get(oldPhoto))).toBeNull();
  const checkins = await dev.query(api.checkins.range, {
    fromDay: "2026-07-01",
    toDay: "2026-10-13",
  });
  expect(checkins).toHaveLength(81);
  expect(checkins[0].weightKg).toBeGreaterThan(checkins[80].weightKg ?? 0);
  expect(
    checkins.every(
      (c) => (c.sleepHours ?? 0) >= 5.5 && (c.sleepHours ?? 0) <= 8.5,
    ),
  ).toBe(true);
  expect(checkins[80].day).toBe("2026-10-13");
  expect(await dev.query(api.strength.exercises, {})).toHaveLength(25);
  expect(
    await t.run((ctx) => ctx.db.query("strengthSets").collect()),
  ).toHaveLength(114);
  const bench = (await dev.query(api.strength.exercises, {})).find(
    (e) => e.name === "Bench press",
  );
  if (!bench) throw new Error("Missing demo bench");
  const strength = await dev.query(api.strength.exerciseHistory, {
    exerciseId: bench._id,
  });
  expect(strength.sessions).toHaveLength(4);
  expect(strength.sessions[0].topSetKg).toBeGreaterThan(
    strength.sessions[3].topSetKg,
  );
  expect(strength.prAt).toBe(strength.sessions[0].trainedAt);
  expect(
    await other.query(api.checkins.get, { day: "2026-10-13" }),
  ).toMatchObject({ weightKg: 99 });
  const overview = await dev.query(api.tracker.overview, {});
  expect(overview.muscles).toHaveLength(11);
  const states = overview.muscles.map(
    (m) => recovery(now, m.lastTrainedAt, m.cooldownHours).kind,
  );
  expect(states).toContain("ready");
  expect(states).toContain("recovering");
  expect(
    await other.query(api.tracker.waterToday, {
      startMs: start,
      endMs: start + 86_400_000,
    }),
  ).toMatchObject([{ amountMl: 123 }]);
});
it("demo seed rejects absent dev auth, other users, and another issuer", async () => {
  const t = convexTest(schema, modules);
  const dev = t.withIdentity({ subject: DEV_USER, issuer: DEV_ISSUER });
  vi.stubEnv("DEV_AUTH_JWKS", "");
  await expect(dev.action(api.demoSeed.run, input)).rejects.toThrow(
    "configured dev-user",
  );
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  vi.stubEnv("DEV_AUTH_JWKS", "configured");
  await expect(
    t
      .withIdentity({ subject: "other", issuer: DEV_ISSUER })
      .action(api.demoSeed.run, input),
  ).rejects.toThrow("configured dev-user");
  await expect(
    t
      .withIdentity({ subject: DEV_USER, issuer: "https://other.invalid" })
      .action(api.demoSeed.run, input),
  ).rejects.toThrow("configured dev-user");
});

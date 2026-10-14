import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";
import { DAY_MS, shiftDay } from "../lib/history";
import { spearman } from "../lib/drivers";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const NOW = Date.parse("2026-10-14T20:00:00Z");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function setup() {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

function mealItems(kcal: number, protein: number) {
  return [
    {
      id: "food",
      name: "Test food",
      grams: 200,
      searchQuery: "Test food",
      status: "matched",
      foodDescription: "Test food",
      per100g: { kcal, protein, carbs: 0, fat: 0 },
    },
  ] satisfies Parameters<typeof import("../lib/nutrients").mealTotals>[0];
}

describe("drivers backend", () => {
  it("requires authentication", async () => {
    const { t } = setup();
    await expect(t.query(api.drivers.list, { days: 60 })).rejects.toThrow(
      "Sign in to continue.",
    );
  });
  it.each([13, 121, 14.5, NaN, Infinity, -Infinity])(
    "rejects days=%s",
    async (days) => {
      const { alice } = setup();
      await expect(alice.query(api.drivers.list, { days })).rejects.toThrow(
        "whole number of days from 14–120",
      );
    },
  );
  it.each([14, 60, 120])(
    "accepts days=%s and reports missing check-ins",
    async (days) => {
      const { alice } = setup();
      expect(await alice.query(api.drivers.list, { days })).toEqual({
        days,
        checkInDays: 0,
        needed: 10,
        findings: [],
      });
    },
  );
  it("counts days with both outcomes, retaining one-outcome data for analysis", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 14; i++)
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day: shiftDay("2026-10-01", i),
          mood: 1 + Math.floor(i / 3),
          sleepHours: 5 + i / 4,
          ...(i < 3 ? { energy: 3 } : {}),
        });
    });
    const result = await alice.query(api.drivers.list, { days: 14 });
    expect(result).toMatchObject({ checkInDays: 3, needed: 7 });
    expect(
      result.findings.find(
        (f) => f.factor === "sleepHours" && f.outcome === "mood" && f.lag === 0,
      )?.n,
    ).toBe(14);
    expect(result.findings.some((f) => f.outcome === "energy")).toBe(false);
  });
  it("buckets 23:30 Los Angeles water logs into their local check-in days", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        userId: "alice",
        waterGoal: 2500,
        timeZone: "America/Los_Angeles",
      });
      for (let i = 0; i < 12; i++) {
        const day = shiftDay("2026-10-02", i);
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day,
          mood: 1 + Math.floor(i / 3),
          energy: 4,
        });
        await ctx.db.insert("water", {
          userId: "alice",
          at: Date.parse(`${day}T23:30:00-07:00`),
          amountMl: (i + 1) * 100,
        });
      }
    });
    const result = await alice.query(api.drivers.list, { days: 14 });
    expect(
      result.findings.find(
        (f) => f.factor === "waterMl" && f.outcome === "mood" && f.lag === 0,
      ),
    ).toMatchObject({
      n: 12,
      split: 650,
      highMean: 3.5,
      lowMean: 1.5,
      rho: spearman(
        Array.from({ length: 12 }, (_, i) => i),
        Array.from({ length: 12 }, (_, i) => 1 + Math.floor(i / 3)),
      ),
    });
  });
  it("uses Tokyo's current local date, clips window edges, and ignores future logs", async () => {
    const { t, alice } = setup();
    // NOW is already October 15 in Tokyo: the window starts October 2.
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        userId: "alice",
        waterGoal: 2500,
        timeZone: "Asia/Tokyo",
      });
      for (let i = 0; i < 14; i++) {
        const day = shiftDay("2026-10-02", i);
        const value = 1 + Math.floor(i / 3);
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day,
          mood: value,
          energy: value,
        });
        await ctx.db.insert("water", {
          userId: "alice",
          at: Date.parse(`${day}T01:00:00+09:00`),
          amountMl: (i + 1) * 100,
        });
      }
      await ctx.db.insert("bodyCheckins", {
        userId: "alice",
        day: "2026-10-01",
        mood: 5,
        energy: 5,
      });
      await ctx.db.insert("water", {
        userId: "alice",
        at: Date.parse("2026-10-01T23:30:00+09:00"),
        amountMl: 10_000,
      });
      await ctx.db.insert("water", {
        userId: "alice",
        at: NOW + 1,
        amountMl: 10_000,
      });
    });
    const result = await alice.query(api.drivers.list, { days: 14 });
    expect(result).toMatchObject({ checkInDays: 14, needed: 0 });
    expect(
      result.findings.find((f) => f.factor === "waterMl" && f.lag === 0),
    ).toMatchObject({ n: 14, split: 750 });
  });
  it("never includes another user's check-ins, factors, settings, or caffeine history", async () => {
    const { t, alice, bob } = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        userId: "bob",
        waterGoal: 2000,
        timeZone: "Asia/Tokyo",
      });
      for (let i = 0; i < 14; i++) {
        const day = shiftDay("2026-10-01", i),
          at = Date.parse(`${day}T10:00:00Z`);
        for (const userId of ["alice", "bob"]) {
          const value = 1 + Math.floor(i / 3);
          await ctx.db.insert("bodyCheckins", {
            userId,
            day,
            mood: value,
            energy: value,
            ...(userId === "bob" ? { sleepHours: 5 + i / 4 } : {}),
          });
        }
        await ctx.db.insert("water", { userId: "bob", at, amountMl: 100 * i });
        await ctx.db.insert("meals", {
          userId: "bob",
          at,
          description: "Food",
          items: mealItems(i * 100, i * 10),
          revision: 1,
          analysis: { status: "ready" },
        });
        await ctx.db.insert("caffeine", {
          userId: "bob",
          at,
          mg: i % 2 ? 50 : 100,
          label: "Coffee",
        });
        await ctx.db.insert("workouts", {
          userId: "bob",
          trainedAt: at,
          note: "",
          muscleIds: [],
        });
      }
    });
    expect(
      (await alice.query(api.drivers.list, { days: 14 })).findings,
    ).toEqual([]);
    expect(
      (await bob.query(api.drivers.list, { days: 14 })).findings.length,
    ).toBeGreaterThan(0);
  });
  it("keeps missing water/meals unknown and uses ready meal nutrient totals", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 14; i++) {
        const day = shiftDay("2026-10-01", i),
          at = Date.parse(`${day}T10:00:00Z`);
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day,
          mood: 1 + Math.floor(i / 3),
          energy: 4,
        });
        if (i < 8)
          await ctx.db.insert("water", {
            userId: "alice",
            at,
            amountMl: i * 100,
          });
        if (i < 10) {
          for (let j = 0; j < 2; j++)
            await ctx.db.insert("meals", {
              userId: "alice",
              at: at + j,
              description: "Food",
              items: mealItems((i + 1) * 100, (i + 1) * 10),
              revision: 1,
              analysis: { status: "ready" },
            });
        }
        await ctx.db.insert("meals", {
          userId: "alice",
          at,
          description: "Pending",
          items: mealItems(10000, 1000),
          revision: 1,
          analysis: { status: "analyzing", startedAt: at },
        });
      }
    });
    const findings = (await alice.query(api.drivers.list, { days: 14 }))
      .findings;
    expect(findings.some((f) => f.factor === "waterMl")).toBe(false);
    expect(
      findings.find((f) => f.factor === "kcal" && f.lag === 0),
    ).toMatchObject({ n: 10, split: 2200, lowMean: 1.4, highMean: 3 });
    expect(
      findings.find((f) => f.factor === "proteinG" && f.lag === 0),
    ).toMatchObject({ n: 10, split: 220 });
  });
  it("assumes caffeine zero only on/after the first dose day inside the window", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("caffeine", {
        userId: "alice",
        at: Date.parse("2026-09-30T23:00:00Z"),
        mg: 50,
        label: "Outside window",
      });
      for (let i = 0; i < 14; i++) {
        const day = shiftDay("2026-10-01", i);
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day,
          mood: i % 2 === 0 ? 2 : 5,
          energy: i % 2 === 0 ? 2 : 5,
        });
        await ctx.db.insert("water", {
          userId: "alice",
          at: Date.parse(`${day}T10:00:00Z`),
          amountMl: 100,
        });
        if (i >= 4 && i % 2 === 0)
          await ctx.db.insert("caffeine", {
            userId: "alice",
            at: Date.parse(`${day}T14:00:00Z`),
            mg: 100,
            label: "Afternoon coffee",
          });
      }
    });
    const findings = (await alice.query(api.drivers.list, { days: 14 }))
      .findings;
    for (const factor of ["caffeineMg", "lateCaffeineMg"]) {
      expect(
        findings.find(
          (f) => f.factor === factor && f.outcome === "energy" && f.lag === 0,
        ),
      ).toMatchObject({ n: 10, rho: -1, split: 50, highMean: 2, lowMean: 5 });
      expect(findings.some((f) => f.factor === factor && f.lag === 1)).toBe(
        false,
      ); // Only nine consecutive lagged pairs.
    }
  });
  it("uses the inclusive 14:00 local caffeine cutoff and totals multiple doses", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        userId: "alice",
        waterGoal: 2500,
        timeZone: "Asia/Tokyo",
      });
      for (let i = 0; i < 12; i++) {
        const day = shiftDay("2026-10-02", i);
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day,
          mood: i % 2 ? 5 : 2,
          energy: 3,
        });
        for (const [time, mg] of [
          ["13:59", 50],
          ["14:00", i % 2 ? 150 : 50],
        ] satisfies [string, number][])
          await ctx.db.insert("caffeine", {
            userId: "alice",
            at: Date.parse(`${day}T${time}:00+09:00`),
            mg,
            label: "Coffee",
          });
      }
    });
    const findings = (await alice.query(api.drivers.list, { days: 14 }))
      .findings;
    expect(
      findings.find((f) => f.factor === "caffeineMg" && f.lag === 0),
    ).toMatchObject({ n: 12, split: 150, rho: 1 });
    expect(
      findings.find((f) => f.factor === "lateCaffeineMg" && f.lag === 0),
    ).toMatchObject({ n: 12, split: 100, rho: 1 });
  });
  it("finds training versus rest without counting multiple workouts as more training", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 14; i++) {
        const day = shiftDay("2026-10-01", i),
          at = Date.parse(`${day}T10:00:00Z`);
        const trained = i % 2 === 0;
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day,
          mood: 3,
          energy: trained ? 5 : 2,
        });
        if (trained)
          for (let j = 0; j < 2; j++)
            await ctx.db.insert("workouts", {
              userId: "alice",
              trainedAt: at + j,
              note: "",
              muscleIds: [],
            });
      }
    });
    expect(
      (await alice.query(api.drivers.list, { days: 14 })).findings.find(
        (f) => f.factor === "trained" && f.lag === 0,
      ),
    ).toMatchObject({ n: 14, rho: 1, highMean: 5, lowMean: 2, split: 0.5 });
  });
  it("produces positive sleep and negative next-day caffeine findings in the seeded demo", async () => {
    const { t } = setup();
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    vi.stubEnv("DEV_AUTH_JWKS", "configured");
    const dev = t.withIdentity({ subject: DEV_USER, issuer: DEV_ISSUER });
    const input = {
      now: NOW,
      days: Array.from(
        { length: 14 },
        (_, i) => Date.parse("2026-10-14T00:00:00Z") - i * DAY_MS,
      ),
      photos: ["cGhvdG8=", "cGhvdG8=", "cGhvdG8=", "cGhvdG8="],
    };
    await dev.action(api.demoSeed.run, input);
    const first = await dev.query(api.drivers.list, { days: 60 });
    expect(first.findings.length).toBeGreaterThanOrEqual(2);
    const sleep = first.findings.find(
      (f) => f.factor === "sleepHours" && f.outcome === "energy" && f.lag === 0,
    );
    const late = first.findings.find(
      (f) =>
        f.factor === "lateCaffeineMg" && f.outcome === "energy" && f.lag === 1,
    );
    expect(sleep).toMatchObject({ n: 54, rho: 0.9559857784133551 });
    expect(late).toMatchObject({ n: 31, rho: -1 });
    await dev.action(api.demoSeed.run, input);
    expect(await dev.query(api.drivers.list, { days: 60 })).toEqual(first);
  });
});

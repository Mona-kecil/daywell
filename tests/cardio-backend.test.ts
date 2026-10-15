import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionArgs } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { addDays } from "../lib/cardio";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";

const NOW = Date.UTC(2026, 9, 15, 12);
const TODAY = "2026-10-15";
const MONDAY = "2026-10-12";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const fields = {
  kind: "run",
  effort: "moderate",
  day: TODAY,
  minutes: 30,
} as const;
type SessionInput = FunctionArgs<typeof api.cardio.add>;

function setup() {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const invalidInputs = [
  ...[0, 0.99, 600.01, NaN, Infinity, -Infinity].map((minutes) => ({
    input: { minutes },
    error: "Duration must be from 1–600 minutes.",
  })),
  ...[0, -1, 1000.01, NaN, Infinity, -Infinity].map((distanceKm) => ({
    input: { distanceKm },
    error: "Distance must be up to 1000 km.",
  })),
  {
    input: { note: ` ${"x".repeat(201)} ` },
    error: "Note must be 200 characters or fewer.",
  },
  { input: { day: "2026-10-17" }, error: "That day is in the future." },
  ...[
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-1-01",
    "",
    "2026-10-15T00:00:00Z",
  ].map((day) => ({
    input: { day },
    error: "Use a valid YYYY-MM-DD day.",
  })),
] satisfies { input: Partial<SessionInput>; error: string }[];

describe("cardio mutations", () => {
  it("requires authentication for every endpoint", async () => {
    const { t, alice } = setup();
    const id = await alice.mutation(api.cardio.add, fields);
    await expect(t.mutation(api.cardio.add, fields)).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(
      t.mutation(api.cardio.update, { id, ...fields }),
    ).rejects.toThrow("Sign in to continue.");
    await expect(t.mutation(api.cardio.remove, { id })).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(t.query(api.cardio.week, { today: TODAY })).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(t.query(api.cardio.bests, {})).rejects.toThrow(
      "Sign in to continue.",
    );
  });

  it.each(invalidInputs)(
    "rejects $input with $error on add and update",
    async ({ input, error }) => {
      const { t, alice } = setup();
      const id = await alice.mutation(api.cardio.add, fields);
      await expect(
        alice.mutation(api.cardio.add, { ...fields, ...input }),
      ).rejects.toThrow(error);
      await expect(
        alice.mutation(api.cardio.update, { id, ...fields, ...input }),
      ).rejects.toThrow(error);
      expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject(fields);
    },
  );

  it.each([1, 600])(
    "accepts duration boundary %s and 1000 km",
    async (minutes) => {
      const { t, alice } = setup();
      const id = await alice.mutation(api.cardio.add, {
        ...fields,
        minutes,
        distanceKm: 1000,
      });
      expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
        minutes,
        distanceKm: 1000,
      });
    },
  );

  it("accepts 0.005 km as 0.01 km and rejects 0.001 km on add", async () => {
    const { t, alice } = setup();
    const id = await alice.mutation(api.cardio.add, {
      ...fields,
      distanceKm: 0.005,
    });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      distanceKm: 0.01,
    });
    await expect(
      alice.mutation(api.cardio.add, { ...fields, distanceKm: 0.001 }),
    ).rejects.toThrow("Distance must be up to 1000 km.");
  });

  it("rejects 0.004 km on update and preserves the stored distance", async () => {
    const { t, alice } = setup();
    const id = await alice.mutation(api.cardio.add, {
      ...fields,
      distanceKm: 5,
    });
    await expect(
      alice.mutation(api.cardio.update, { id, ...fields, distanceKm: 0.004 }),
    ).rejects.toThrow("Distance must be up to 1000 km.");
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      distanceKm: 5,
    });
  });

  it("rounds fractions, trims notes, allows tomorrow and a leap day, and stores other distance", async () => {
    const { t, alice } = setup();
    const id = await alice.mutation(api.cardio.add, {
      ...fields,
      kind: "other",
      day: "2026-10-16",
      minutes: 30.26,
      distanceKm: 5.867,
      note: ` ${"n".repeat(200)} `,
    });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      userId: "alice",
      kind: "other",
      day: "2026-10-16",
      minutes: 30.3,
      distanceKm: 5.87,
      note: "n".repeat(200),
      createdAt: NOW,
    });
    await expect(
      alice.mutation(api.cardio.add, { ...fields, day: "2024-02-29" }),
    ).resolves.toEqual(expect.any(String));
  });

  it.each([null, undefined])(
    "omits distance %s and blank notes",
    async (distanceKm) => {
      const { t, alice } = setup();
      const id = await alice.mutation(api.cardio.add, {
        ...fields,
        distanceKm,
        note: " \n ",
      });
      const row = await t.run((ctx) => ctx.db.get(id));
      expect(row).not.toHaveProperty("distanceKm");
      expect(row).not.toHaveProperty("note");
    },
  );

  it("updates every field, preserves creation time, clears optional fields, and removes owned rows", async () => {
    const { t, alice, bob } = setup();
    const id = await alice.mutation(api.cardio.add, {
      ...fields,
      distanceKm: 5,
      note: "Park run",
    });
    await expect(
      bob.mutation(api.cardio.update, { id, ...fields }),
    ).rejects.toThrow("Entry not found.");
    await expect(bob.mutation(api.cardio.remove, { id })).rejects.toThrow(
      "Entry not found.",
    );
    vi.mocked(Date.now).mockReturnValue(NOW + 1000);
    await alice.mutation(api.cardio.update, {
      id,
      kind: "ride",
      effort: "hard",
      day: "2026-10-14",
      minutes: 60.26,
      distanceKm: 24.126,
      note: " Road ride ",
    });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      kind: "ride",
      effort: "hard",
      day: "2026-10-14",
      minutes: 60.3,
      distanceKm: 24.13,
      note: "Road ride",
      createdAt: NOW,
    });
    await alice.mutation(api.cardio.update, {
      id,
      ...fields,
      distanceKm: null,
      note: " ",
    });
    let row = await t.run((ctx) => ctx.db.get(id));
    expect(row).not.toHaveProperty("distanceKm");
    expect(row).not.toHaveProperty("note");
    await alice.mutation(api.cardio.update, {
      id,
      ...fields,
      distanceKm: 5,
      note: "Again",
    });
    await alice.mutation(api.cardio.update, { id, ...fields });
    row = await t.run((ctx) => ctx.db.get(id));
    expect(row).not.toHaveProperty("distanceKm");
    expect(row).not.toHaveProperty("note");
    await alice.mutation(api.cardio.remove, { id });
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
    await expect(alice.mutation(api.cardio.remove, { id })).rejects.toThrow(
      "Entry not found.",
    );
    await expect(
      alice.mutation(api.cardio.update, { id, ...fields }),
    ).rejects.toThrow("Entry not found.");
  });

  it("enforces the per-user daily cap on adds and moves while allowing updates within a full day", async () => {
    const { t, alice, bob } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 49; i++)
        await ctx.db.insert("cardioSessions", {
          userId: "alice",
          ...fields,
          createdAt: NOW + i,
        });
    });
    const id = await alice.mutation(api.cardio.add, fields);
    await expect(alice.mutation(api.cardio.add, fields)).rejects.toThrow(
      "That's a lot of sessions for one day.",
    );
    await alice.mutation(api.cardio.update, { id, ...fields, minutes: 40 });
    await bob.mutation(api.cardio.add, fields);
    const yesterday = await alice.mutation(api.cardio.add, {
      ...fields,
      day: "2026-10-14",
    });
    await expect(
      alice.mutation(api.cardio.update, { id: yesterday, ...fields }),
    ).rejects.toThrow("That's a lot of sessions for one day.");
    await alice.mutation(api.cardio.remove, { id });
    await alice.mutation(api.cardio.update, { id: yesterday, ...fields });
    expect(
      (await alice.query(api.cardio.week, { today: TODAY })).sessions,
    ).toHaveLength(50);
  });

  it.each(["kind", "effort"] as const)(
    "rejects an unknown %s at the boundary",
    async (field) => {
      const { alice } = setup();
      const add = makeFunctionReference<"mutation">("cardio:add");
      await expect(
        alice.mutation(add, { ...fields, [field]: "unknown" }),
      ).rejects.toThrow();
    },
  );
});

describe("cardio week", () => {
  it("returns an empty Monday-to-Sunday week with every contract field", async () => {
    const { alice } = setup();
    expect(await alice.query(api.cardio.week, { today: TODAY })).toEqual({
      weekStart: MONDAY,
      days: Array.from({ length: 7 }, (_, i) => ({
        day: addDays(MONDAY, i),
        minutes: 0,
        activeMinutes: 0,
      })),
      sessions: [],
      minutes: 0,
      activeMinutes: 0,
      goal: 150,
      lastWeekActiveMinutes: 0,
      streakWeeks: 0,
      totals: [],
    });
    expect(
      (await alice.query(api.cardio.week, { today: "2026-10-18" })).weekStart,
    ).toBe(MONDAY);
  });

  it.each(["2026-02-29", "2026-10-1", "bad"])(
    "validates today %s",
    async (today) => {
      const { alice } = setup();
      await expect(alice.query(api.cardio.week, { today })).rejects.toThrow(
        "Use a valid YYYY-MM-DD day.",
      );
    },
  );

  it("sums the week and kind totals, orders sessions, and uses owned weights on or before each day", async () => {
    const { t, alice, bob } = setup();
    const monday = await alice.mutation(api.cardio.add, {
      ...fields,
      day: MONDAY,
      distanceKm: 5.86,
      note: " Park ",
    });
    const run = await alice.mutation(api.cardio.add, {
      ...fields,
      effort: "hard",
      day: "2026-10-14",
      minutes: 20.1,
      distanceKm: 3.337,
    });
    vi.mocked(Date.now).mockReturnValue(NOW + 1);
    const ride = await alice.mutation(api.cardio.add, {
      ...fields,
      kind: "ride",
      day: "2026-10-14",
      minutes: 40.2,
      distanceKm: 16.28,
    });
    const walk = await alice.mutation(api.cardio.add, {
      ...fields,
      kind: "walk",
      effort: "easy",
      minutes: 10.1,
    });
    await alice.mutation(api.cardio.add, {
      ...fields,
      day: "2026-10-05",
      minutes: 80,
      effort: "hard",
    });
    await bob.mutation(api.cardio.add, {
      ...fields,
      minutes: 600,
      distanceKm: 100,
    });
    await alice.mutation(api.checkins.upsert, {
      day: "2026-10-13",
      weightKg: 60,
    });
    await alice.mutation(api.checkins.upsert, { day: "2026-10-14", mood: 3 });
    await alice.mutation(api.checkins.upsert, { day: TODAY, weightKg: 70 });
    await alice.mutation(api.checkins.upsert, {
      day: "2026-10-16",
      weightKg: 90,
    });
    await bob.mutation(api.checkins.upsert, { day: MONDAY, weightKg: 100 });
    const result = await alice.query(api.cardio.week, { today: TODAY });
    expect(result.sessions.map((session) => session.id)).toEqual([
      walk,
      ride,
      run,
      monday,
    ]);
    expect(result.sessions).toEqual([
      {
        id: walk,
        createdAt: NOW + 1,
        kind: "walk",
        effort: "easy",
        day: TODAY,
        minutes: 10.1,
        distanceKm: null,
        note: null,
        pace: null,
        activeMinutes: 10.1,
        kcal: 33,
      },
      {
        id: ride,
        createdAt: NOW + 1,
        kind: "ride",
        effort: "moderate",
        day: "2026-10-14",
        minutes: 40.2,
        distanceKm: 16.28,
        note: null,
        pace: "24.3 km/h",
        activeMinutes: 40.2,
        kcal: 302,
      },
      {
        id: run,
        createdAt: NOW,
        kind: "run",
        effort: "hard",
        day: "2026-10-14",
        minutes: 20.1,
        distanceKm: 3.34,
        note: null,
        pace: "6:01 /km",
        activeMinutes: 40.2,
        kcal: 231,
      },
      {
        id: monday,
        createdAt: NOW,
        kind: "run",
        effort: "moderate",
        day: MONDAY,
        minutes: 30,
        distanceKm: 5.86,
        note: "Park",
        pace: "5:07 /km",
        activeMinutes: 30,
        kcal: null,
      },
    ]);
    expect(result.days).toEqual([
      { day: MONDAY, minutes: 30, activeMinutes: 30 },
      { day: "2026-10-13", minutes: 0, activeMinutes: 0 },
      { day: "2026-10-14", minutes: 60.3, activeMinutes: 80.4 },
      { day: TODAY, minutes: 10.1, activeMinutes: 10.1 },
      ...["2026-10-16", "2026-10-17", "2026-10-18"].map((day) => ({
        day,
        minutes: 0,
        activeMinutes: 0,
      })),
    ]);
    expect(result).toMatchObject({
      minutes: 100.4,
      activeMinutes: 120.5,
      lastWeekActiveMinutes: 160,
      streakWeeks: 1,
      goal: 150,
    });
    expect(result.totals).toEqual([
      { kind: "run", minutes: 50.1, distanceKm: 9.2 },
      { kind: "ride", minutes: 40.2, distanceKm: 16.28 },
      { kind: "walk", minutes: 10.1, distanceKm: 0 },
    ]);
    expect(
      (await bob.query(api.cardio.week, { today: TODAY })).sessions,
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(run))).toMatchObject({
      minutes: 20.1,
      distanceKm: 3.34,
    });
  });

  it("uses an old weigh-in across more than 100 check-ins without weight; no weigh-in means null", async () => {
    const { t, alice, bob } = setup();
    await alice.mutation(api.cardio.add, fields);
    await bob.mutation(api.cardio.add, fields);
    await t.run(async (ctx) => {
      await ctx.db.insert("bodyCheckins", {
        userId: "alice",
        day: addDays(TODAY, -200),
        weightKg: 80,
      });
      for (let i = 0; i < 101; i++)
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day: addDays(TODAY, -i),
          energy: 4,
        });
    });
    expect(
      (await alice.query(api.cardio.week, { today: TODAY })).sessions[0].kcal,
    ).toBe(392);
    expect(
      (await bob.query(api.cardio.week, { today: TODAY })).sessions[0].kcal,
    ).toBeNull();
  });

  it("returns null kcal for each session day when a weight is beyond 400 newer check-ins", async () => {
    const { t, alice } = setup();
    await alice.mutation(api.cardio.add, { ...fields, day: MONDAY });
    await alice.mutation(api.cardio.add, fields);
    await t.run(async (ctx) => {
      await ctx.db.insert("bodyCheckins", {
        userId: "alice",
        day: addDays(TODAY, -500),
        weightKg: 80,
      });
      for (let i = 0; i < 401; i++)
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day: addDays(TODAY, -i),
          energy: 4,
        });
    });
    const result = await alice.query(api.cardio.week, { today: TODAY });
    expect(result.sessions.map((session) => session.kcal)).toEqual([
      null,
      null,
    ]);
  });

  it("includes Sunday and excludes either side of the selected week", async () => {
    const { alice } = setup();
    vi.mocked(Date.now).mockReturnValue(Date.UTC(2026, 9, 19, 12));
    for (const day of ["2026-10-11", MONDAY, "2026-10-18", "2026-10-19"])
      await alice.mutation(api.cardio.add, { ...fields, day });
    expect(
      (await alice.query(api.cardio.week, { today: TODAY })).sessions.map(
        (row) => row.day,
      ),
    ).toEqual(["2026-10-18", MONDAY]);
  });

  it("counts complete goal weeks ending last week, adds this week's goal, and breaks at a gap", async () => {
    const { alice } = setup();
    await alice.mutation(api.cardio.add, {
      ...fields,
      day: addDays(MONDAY, -14),
      minutes: 150,
    });
    const last = await alice.mutation(api.cardio.add, {
      ...fields,
      day: addDays(MONDAY, -7),
      minutes: 75,
      effort: "hard",
    });
    const current = await alice.mutation(api.cardio.add, {
      ...fields,
      minutes: 30,
    });
    expect(
      (await alice.query(api.cardio.week, { today: TODAY })).streakWeeks,
    ).toBe(2);
    await alice.mutation(api.cardio.update, {
      id: current,
      ...fields,
      minutes: 150,
    });
    expect(
      (await alice.query(api.cardio.week, { today: TODAY })).streakWeeks,
    ).toBe(3);
    await alice.mutation(api.cardio.update, {
      id: last,
      ...fields,
      day: addDays(MONDAY, -7),
      minutes: 149.9,
    });
    expect(
      (await alice.query(api.cardio.week, { today: TODAY })).streakWeeks,
    ).toBe(1);
    await alice.mutation(api.cardio.remove, { id: current });
    expect(
      (await alice.query(api.cardio.week, { today: TODAY })).streakWeeks,
    ).toBe(0);
  });

  it("looks back at most 52 complete weeks and adds the current goal week", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i <= 53; i++)
        await ctx.db.insert("cardioSessions", {
          ...fields,
          userId: "alice",
          day: addDays(MONDAY, -i * 7),
          minutes: 150,
          createdAt: NOW,
        });
    });
    expect(
      (await alice.query(api.cardio.week, { today: TODAY })).streakWeeks,
    ).toBe(53);
  });
});

describe("cardio bests and lifecycle", () => {
  it("returns null bests for empty histories and computes owned all-time records with earliest-day ties", async () => {
    const { alice, bob } = setup();
    expect(await alice.query(api.cardio.bests, {})).toEqual({
      longestRunKm: null,
      fastestRun: null,
      longestRideKm: null,
    });
    for (const input of [
      { day: "2020-01-01", distanceKm: 21.1, minutes: 130 },
      { day: TODAY, distanceKm: 5, minutes: 20 },
      { day: "2026-10-10", distanceKm: 10, minutes: 40 },
      { distanceKm: 0.5, minutes: 1 },
      { distanceKm: null, minutes: 1 },
      { kind: "ride", distanceKm: 100, minutes: 240 },
      { kind: "walk", distanceKm: 200, minutes: 600 },
    ] satisfies Partial<SessionInput>[])
      await alice.mutation(api.cardio.add, { ...fields, ...input });
    await bob.mutation(api.cardio.add, {
      ...fields,
      distanceKm: 1000,
      minutes: 1,
    });
    expect(await alice.query(api.cardio.bests, {})).toEqual({
      longestRunKm: 21.1,
      fastestRun: { day: "2026-10-10", distanceKm: 10, pace: "4:00 /km" },
      longestRideKm: 100,
    });
    expect((await bob.query(api.cardio.bests, {})).longestRunKm).toBe(1000);
  });

  it("keeps fastestRun null for only sub-kilometre runs", async () => {
    const { alice } = setup();
    await alice.mutation(api.cardio.add, {
      ...fields,
      distanceKm: 0.99,
      minutes: 1,
    });
    expect(await alice.query(api.cardio.bests, {})).toEqual({
      longestRunKm: 0.99,
      fastestRun: null,
      longestRideKm: null,
    });
  });

  it("reads records and exports beyond a batch boundary without dropping a partial day", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 450; i++)
        await ctx.db.insert("cardioSessions", {
          ...fields,
          userId: "alice",
          day: addDays("2020-01-01", Math.floor(i / 45)),
          minutes: i === 449 ? 10 : 60,
          distanceKm: i === 399 ? 30 : i === 449 ? 10 : 5,
          createdAt: NOW + i,
        });
    });
    expect(await alice.query(api.cardio.bests, {})).toEqual({
      longestRunKm: 30,
      longestRideKm: null,
      fastestRun: { day: "2020-01-10", distanceKm: 10, pace: "1:00 /km" },
    });
    const rows = (await alice.query(api.exportData.all, {})).cardioSessions;
    expect(rows).toHaveLength(450);
    expect(new Set(rows.map((row) => row.id)).size).toBe(450);
  });

  it("exports only owned session fields with null optional values", async () => {
    const { alice, bob } = setup();
    const id = await alice.mutation(api.cardio.add, {
      ...fields,
      distanceKm: 5,
      note: " Park ",
    });
    const missing = await alice.mutation(api.cardio.add, fields);
    await bob.mutation(api.cardio.add, fields);
    expect((await alice.query(api.exportData.all, {})).cardioSessions).toEqual([
      { id, ...fields, distanceKm: 5, note: "Park", createdAt: NOW },
      { id: missing, ...fields, distanceKm: null, note: null, createdAt: NOW },
    ]);
  });

  it("demo replacement deletes old owned sessions, seeds five sessions in ten days, and preserves other users", async () => {
    const { t, bob } = setup();
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    vi.stubEnv("DEV_AUTH_JWKS", "configured");
    const dev = t.withIdentity({ subject: DEV_USER, issuer: DEV_ISSUER });
    const old = await dev.mutation(api.cardio.add, {
      ...fields,
      day: "2020-01-01",
    });
    const other = await bob.mutation(api.cardio.add, fields);
    const input = {
      now: NOW,
      days: Array.from({ length: 14 }, (_, i) => NOW - i * 86_400_000),
      meals: [],
    };
    await dev.mutation(internal.demo.replace, input);
    expect(await t.run((ctx) => ctx.db.get(old))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(other))).not.toBeNull();
    let seeded = (await dev.query(api.exportData.all, {})).cardioSessions;
    expect(seeded).toHaveLength(5);
    expect(
      seeded.filter((row) => row.kind === "run" && row.distanceKm !== null),
    ).toHaveLength(3);
    expect(seeded.map((row) => row.kind)).toEqual([
      "run",
      "walk",
      "ride",
      "run",
      "run",
    ]);
    expect(
      seeded.every((row) => row.day >= "2026-10-06" && row.day <= TODAY),
    ).toBe(true);
    const firstIds = seeded.map((row) => row.id);
    await dev.mutation(internal.demo.replace, input);
    seeded = (await dev.query(api.exportData.all, {})).cardioSessions;
    expect(seeded).toHaveLength(5);
    expect(seeded.every((row) => !firstIds.includes(row.id))).toBe(true);
  });
});

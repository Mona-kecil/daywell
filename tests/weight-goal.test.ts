import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { shiftDay } from "../lib/history";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

it("returns a null goal without settings and uses the writable settings path", async () => {
  const { t, alice } = setup();
  expect(await alice.query(api.coach.settings, {})).toMatchObject({
    goalWeightKg: null,
  });
  await expect(
    t.mutation(api.coach.setGoalWeight, { goalWeightKg: 70 }),
  ).rejects.toThrow("Sign in");
  await expect(
    alice.mutation(api.coach.setGoalWeight, { goalWeightKg: 70 }),
  ).rejects.toThrow("Settings are not ready");
});

it.each([29.9, 300.1, NaN, Infinity, -Infinity])(
  "rejects goal weight %s without changing settings",
  async (goalWeightKg) => {
    const { alice } = setup();
    await alice.mutation(api.tracker.initialize, {});
    await expect(
      alice.mutation(api.coach.setGoalWeight, { goalWeightKg }),
    ).rejects.toThrow("Goal weight must be from 30–300 kg.");
    expect(await alice.query(api.coach.settings, {})).toMatchObject({
      goalWeightKg: null,
    });
  },
);

it("sets both inclusive goal bounds, isolates users, and clears the stored field", async () => {
  const { t, alice, bob } = setup();
  await alice.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setTargets, {
    kcalTarget: 2100,
    proteinTarget: 130,
  });
  for (const goalWeightKg of [30, 300, 72.5]) {
    await alice.mutation(api.coach.setGoalWeight, { goalWeightKg });
    expect(await alice.query(api.coach.settings, {})).toMatchObject({
      goalWeightKg,
      kcalTarget: 2100,
      proteinTarget: 130,
    });
    expect(await bob.query(api.coach.settings, {})).toMatchObject({
      goalWeightKg: null,
    });
  }
  await alice.mutation(api.coach.setGoalWeight, { goalWeightKg: null });
  expect(await alice.query(api.coach.settings, {})).toMatchObject({
    goalWeightKg: null,
  });
  const settings = await t.run((ctx) =>
    ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", "alice"))
      .unique(),
  );
  expect(settings).not.toHaveProperty("goalWeightKg");
});

it.each([39.9, 200.1, NaN, Infinity])(
  "rejects waist %s without losing prior fields",
  async (waistCm) => {
    const { alice } = setup();
    const day = "2026-10-15";
    await alice.mutation(api.checkins.upsert, {
      day,
      weightKg: 75,
      note: "Kept",
    });
    await expect(
      alice.mutation(api.checkins.upsert, { day, waistCm }),
    ).rejects.toThrow("Waist must be from 40–200.");
    expect(await alice.query(api.checkins.get, { day })).toMatchObject({
      weightKg: 75,
      note: "Kept",
    });
  },
);

it("sets inclusive waist bounds and decimals, preserves omissions, clears null, and passes through range", async () => {
  const { alice } = setup();
  const day = "2026-10-15";
  const fields = {
    weightKg: 75,
    sleepHours: 7.5,
    mood: 4,
    energy: 3,
    note: "Kept",
  };
  await alice.mutation(api.checkins.upsert, { day, ...fields });
  for (const waistCm of [40, 200, 82.25]) {
    await alice.mutation(api.checkins.upsert, { day, waistCm });
    expect(await alice.query(api.checkins.get, { day })).toMatchObject({
      waistCm,
      ...fields,
    });
  }
  await alice.mutation(api.checkins.upsert, { day, waistCm: undefined });
  expect(
    await alice.query(api.checkins.range, { fromDay: day, toDay: day }),
  ).toMatchObject([{ waistCm: 82.25, ...fields }]);
  await alice.mutation(api.checkins.upsert, { day, waistCm: null });
  const row = await alice.query(api.checkins.get, { day });
  expect(row).not.toHaveProperty("waistCm");
  expect(row).toMatchObject(fields);
});

it("requires auth and validates the weight trend local day", async () => {
  const { t, alice } = setup();
  await expect(
    t.query(api.checkins.weightTrend, { today: "2026-10-15" }),
  ).rejects.toThrow("Sign in");
  for (const today of ["2026-02-29", "2026-1-01", "junk"])
    await expect(
      alice.query(api.checkins.weightTrend, { today }),
    ).rejects.toThrow("YYYY-MM-DD");
});

it("returns the empty trend shape, including goals and waist-only check-ins", async () => {
  const { alice } = setup();
  const today = "2026-10-15";
  expect(await alice.query(api.checkins.weightTrend, { today })).toEqual({
    points: [],
    latestKg: null,
    trendKg: null,
    ratePerWeek: null,
    goalKg: null,
    eta: { kind: "none" },
    waist: [],
  });
  await alice.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setGoalWeight, { goalWeightKg: 70 });
  await alice.mutation(api.checkins.upsert, { day: today, waistCm: 82 });
  expect(await alice.query(api.checkins.weightTrend, { today })).toEqual({
    points: [],
    latestKg: null,
    trendKg: null,
    ratePerWeek: null,
    goalKg: 70,
    eta: { kind: "flat" },
    waist: [{ day: today, waistCm: 82 }],
  });
});

it("reads only owned check-ins inside the inclusive 120-day window in day order", async () => {
  const { alice, bob } = setup();
  const today = "2026-10-15";
  for (const [offset, weightKg, waistCm] of [
    [1, 99, 99],
    [0, 72, 82],
    [-120, 99, 99],
    [-119, 80, 90],
  ])
    await alice.mutation(api.checkins.upsert, {
      day: shiftDay(today, offset),
      weightKg,
      waistCm,
    });
  await alice.mutation(api.checkins.upsert, {
    day: shiftDay(today, -60),
    waistCm: 85,
  });
  await bob.mutation(api.tracker.initialize, {});
  await bob.mutation(api.coach.setGoalWeight, { goalWeightKg: 100 });
  await bob.mutation(api.checkins.upsert, {
    day: today,
    weightKg: 100,
    waistCm: 100,
  });
  const result = await alice.query(api.checkins.weightTrend, { today });
  expect(result.points).toHaveLength(120);
  expect(result.points[0]).toEqual({
    day: shiftDay(today, -119),
    weightKg: 80,
    trendKg: 80,
  });
  expect(result.points.at(-1)).toEqual({
    day: today,
    weightKg: 72,
    trendKg: 79.2,
  });
  expect(result.points.filter((point) => point.weightKg !== null)).toHaveLength(
    2,
  );
  expect(result).toMatchObject({
    latestKg: 72,
    trendKg: 79.2,
    ratePerWeek: null,
    goalKg: null,
    eta: { kind: "none" },
    waist: [
      { day: shiftDay(today, -119), waistCm: 90 },
      { day: shiftDay(today, -60), waistCm: 85 },
      { day: today, waistCm: 82 },
    ],
  });
});

it("wires EMA, regression, goal and ETA using the requested today after the last weigh-in", async () => {
  const { alice } = setup();
  const today = "2026-10-15";
  await alice.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setGoalWeight, { goalWeightKg: 76 });
  // These raw weights produce a trend of 80, 79.9, ... 78.7.
  for (let index = 13; index >= 0; index--)
    await alice.mutation(api.checkins.upsert, {
      day: shiftDay(today, index - 15),
      weightKg: index === 0 ? 80 : 79.1 - index * 0.1,
    });
  const result = await alice.query(api.checkins.weightTrend, { today });
  expect(result.points).toHaveLength(14);
  expect(result.latestKg).toBeCloseTo(77.8, 9);
  expect(result.trendKg).toBeCloseTo(78.7, 9);
  expect(result.ratePerWeek).toBeCloseTo(-0.7, 9);
  expect(result.goalKg).toBe(76);
  expect(result.eta).toEqual({ kind: "eta", day: "2026-11-12", weeks: 3.9 });
});

it("exports goal weight and waist without losing other fields", async () => {
  const { alice } = setup();
  await alice.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setGoalWeight, { goalWeightKg: 72.5 });
  await alice.mutation(api.checkins.upsert, {
    day: "2026-10-15",
    weightKg: 75,
    waistCm: 82.25,
  });
  const result = await alice.query(api.exportData.all, {});
  expect(result.settings).toMatchObject({
    goalWeightKg: 72.5,
    waterGoal: 2500,
  });
  expect(result.checkins).toMatchObject([
    { day: "2026-10-15", weightKg: 75, waistCm: 82.25 },
  ]);
});

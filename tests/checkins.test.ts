import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

it("updates one local day, keeps omitted values, clears null fields, and preserves zero", async () => {
  const { t, alice } = setup();
  const day = "2026-10-14";
  const id = await alice.mutation(api.checkins.upsert, {
    day,
    weightKg: 75.5,
    sleepHours: 7.25,
    mood: 4,
    energy: 3,
    note: "Good sleep",
  });
  expect(await alice.mutation(api.checkins.upsert, { day, mood: 2 })).toBe(id);
  expect(await alice.query(api.checkins.get, { day })).toMatchObject({
    _id: id,
    weightKg: 75.5,
    sleepHours: 7.25,
    mood: 2,
    energy: 3,
    note: "Good sleep",
  });
  await alice.mutation(api.checkins.upsert, {
    day,
    weightKg: null,
    sleepHours: 0,
    energy: null,
    note: null,
  });
  const checkin = await alice.query(api.checkins.get, { day });
  expect(checkin).toMatchObject({ sleepHours: 0, mood: 2 });
  expect(checkin).not.toHaveProperty("weightKg");
  expect(checkin).not.toHaveProperty("energy");
  expect(checkin).not.toHaveProperty("note");
  expect(
    await t.run((ctx) => ctx.db.query("bodyCheckins").collect()),
  ).toHaveLength(1);
  await alice.mutation(api.checkins.upsert, {
    day,
    mood: null,
    sleepHours: null,
  });
  expect(await alice.query(api.checkins.get, { day })).toEqual(
    expect.objectContaining({ day }),
  );
  expect(await alice.mutation(api.checkins.upsert, { day })).toBe(id);
});

it("isolates days for each user and rejects unauthenticated functions", async () => {
  const { t, alice, bob } = setup();
  const day = "2026-10-14";
  await expect(t.query(api.checkins.get, { day })).rejects.toThrow("Sign in");
  await expect(
    t.query(api.checkins.range, { fromDay: day, toDay: day }),
  ).rejects.toThrow("Sign in");
  await expect(
    t.mutation(api.checkins.upsert, { day, mood: 4 }),
  ).rejects.toThrow("Sign in");
  await alice.mutation(api.checkins.upsert, {
    day,
    weightKg: 70,
    note: "Alice",
  });
  expect(await bob.query(api.checkins.get, { day })).toBeNull();
  expect(
    await bob.query(api.checkins.range, { fromDay: day, toDay: day }),
  ).toEqual([]);
  await bob.mutation(api.checkins.upsert, { day, weightKg: 90, note: "Bob" });
  expect(await alice.query(api.checkins.get, { day })).toMatchObject({
    weightKg: 70,
    note: "Alice",
  });
  expect(await bob.query(api.checkins.get, { day })).toMatchObject({
    weightKg: 90,
    note: "Bob",
  });
});

it("sorts an inclusive range, validates calendar dates, and caps at 400 days", async () => {
  const { alice } = setup();
  for (const day of ["2026-10-15", "2026-10-13", "2026-10-14", "2026-10-16"])
    await alice.mutation(api.checkins.upsert, { day, energy: 3 });
  expect(
    (
      await alice.query(api.checkins.range, {
        fromDay: "2026-10-13",
        toDay: "2026-10-15",
      })
    ).map((row) => row.day),
  ).toEqual(["2026-10-13", "2026-10-14", "2026-10-15"]);
  expect(
    await alice.query(api.checkins.range, {
      fromDay: "2026-10-14",
      toDay: "2026-10-14",
    }),
  ).toHaveLength(1);
  expect(
    await alice.query(api.checkins.range, {
      fromDay: "2025-01-01",
      toDay: "2026-02-04",
    }),
  ).toHaveLength(0);
  await expect(
    alice.query(api.checkins.range, {
      fromDay: "2025-01-01",
      toDay: "2026-02-05",
    }),
  ).rejects.toThrow("400 days");
  await expect(
    alice.query(api.checkins.range, {
      fromDay: "2026-10-15",
      toDay: "2026-10-13",
    }),
  ).rejects.toThrow("ascending");
  for (const day of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-1-01",
    " 2026-10-14",
    "2026-10-14T00:00:00Z",
    "junk",
  ]) {
    await expect(alice.mutation(api.checkins.upsert, { day })).rejects.toThrow(
      "YYYY-MM-DD",
    );
    await expect(alice.query(api.checkins.get, { day })).rejects.toThrow(
      "YYYY-MM-DD",
    );
    await expect(
      alice.query(api.checkins.range, { fromDay: day, toDay: "2026-10-14" }),
    ).rejects.toThrow("YYYY-MM-DD");
  }
  await alice.mutation(api.checkins.upsert, { day: "2024-02-29" });
  expect(
    await alice.query(api.checkins.get, { day: "2024-02-29" }),
  ).not.toBeNull();
});

it("validates measurements at their bounds without losing prior fields", async () => {
  const { alice } = setup();
  const day = "2026-10-14";
  await alice.mutation(api.checkins.upsert, {
    day,
    weightKg: 20,
    sleepHours: 0,
    mood: 1,
    energy: 1,
  });
  await alice.mutation(api.checkins.upsert, {
    day,
    weightKg: 400,
    sleepHours: 24,
    mood: 5,
    energy: 5,
    note: "a".repeat(280),
  });
  for (const fields of [
    { weightKg: 19.9 },
    { weightKg: 400.1 },
    { weightKg: NaN },
    { sleepHours: -0.25 },
    { sleepHours: 24.25 },
    { energy: 0 },
    { energy: 6 },
    { mood: 1.5 },
    { mood: Infinity },
    { note: "a".repeat(281) },
  ])
    await expect(
      alice.mutation(api.checkins.upsert, { day, ...fields }),
    ).rejects.toThrow();
  expect(await alice.query(api.checkins.get, { day })).toMatchObject({
    weightKg: 400,
    sleepHours: 24,
    mood: 5,
    energy: 5,
    note: "a".repeat(280),
  });
});

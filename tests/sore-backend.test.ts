import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { todayDataFor, suggestionsFor } from "../convex/coachData";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const hour = 3_600_000;
const now = Date.parse("2026-10-12T12:00:00Z");

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  await alice.mutation(api.tracker.initialize, {});
  const muscles = (await alice.query(api.tracker.overview, {})).muscles;
  const chest = muscles.find((muscle) => muscle.name === "chest");
  if (!chest) throw new Error("Missing chest");
  return { t, alice, bob, chest, muscles };
}

afterEach(() => vi.restoreAllMocks());

describe("soreness mutations", () => {
  it("extends the cooldown, then extends the current soreness", async () => {
    const { alice, chest } = await setup();
    await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [chest._id],
      trainedAt: now - 48 * hour,
      note: "",
    });
    const args = { muscleId: chest._id, now };
    expect(await alice.mutation(api.tracker.reportSore, args)).toBe(
      now + 36 * hour,
    );
    expect(await alice.mutation(api.tracker.reportSore, args)).toBe(
      now + 48 * hour,
    );
    expect(
      (await alice.query(api.tracker.overview, {})).muscles.find(
        (m) => m._id === chest._id,
      )?.soreUntil,
    ).toBe(now + 48 * hour);
  });

  it("starts never-trained and expired cooldown muscles from now", async () => {
    const { alice, chest } = await setup();
    expect(chest.soreUntil).toBeNull();
    const args = { muscleId: chest._id, now };
    expect(await alice.mutation(api.tracker.reportSore, args)).toBe(
      now + 12 * hour,
    );
    expect(
      await alice.mutation(api.tracker.reportSore, {
        ...args,
        now: now + 24 * hour,
      }),
    ).toBe(now + 36 * hour);
    await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [chest._id],
      trainedAt: now - 100 * hour,
      note: "",
    });
    expect(await alice.mutation(api.tracker.reportSore, args)).toBe(
      now + 12 * hour,
    );
  });

  it("caps repeated extensions at 72 hours from the supplied now", async () => {
    const { alice, chest } = await setup();
    for (let tap = 1; tap <= 8; tap++) {
      expect(
        await alice.mutation(api.tracker.reportSore, {
          muscleId: chest._id,
          now,
        }),
      ).toBe(now + Math.min(tap * 12, 72) * hour);
    }
  });

  it("caps soreness without shortening a longer cooldown", async () => {
    const { alice, chest } = await setup();
    await alice.mutation(api.tracker.setCooldown, {
      id: chest._id,
      hours: 100,
    });
    await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [chest._id],
      trainedAt: now,
      note: "",
    });
    expect(
      await alice.mutation(api.tracker.reportSore, {
        muscleId: chest._id,
        now,
      }),
    ).toBe(now + 72 * hour);
    expect(
      (await alice.query(api.tracker.overview, {})).muscles.find(
        (m) => m._id === chest._id,
      )?.cooldownHours,
    ).toBe(100);
  });

  it("requires authentication and ownership for both mutations", async () => {
    const { t, bob, chest } = await setup();
    await expect(
      t.mutation(api.tracker.reportSore, { muscleId: chest._id, now }),
    ).rejects.toThrow("Sign in to continue.");
    await expect(
      t.mutation(api.tracker.clearSore, { muscleId: chest._id }),
    ).rejects.toThrow("Sign in to continue.");
    await expect(
      bob.mutation(api.tracker.reportSore, { muscleId: chest._id, now }),
    ).rejects.toThrow("Muscle not found.");
    await expect(
      bob.mutation(api.tracker.clearSore, { muscleId: chest._id }),
    ).rejects.toThrow("Muscle not found.");
  });

  it.each([-1, NaN, Infinity, -Infinity, 8_640_000_000_000_001])(
    "rejects invalid now %s",
    async (at) => {
      const { alice, chest } = await setup();
      await expect(
        alice.mutation(api.tracker.reportSore, {
          muscleId: chest._id,
          now: at,
        }),
      ).rejects.toThrow("Invalid timestamp.");
      expect(
        (await alice.query(api.tracker.overview, {})).muscles.find(
          (m) => m._id === chest._id,
        )?.soreUntil,
      ).toBeNull();
    },
  );

  it("removes soreness and returns null on repeated clears", async () => {
    const { t, alice, chest } = await setup();
    await alice.mutation(api.tracker.reportSore, { muscleId: chest._id, now });
    for (let clear = 0; clear < 2; clear++)
      expect(
        await alice.mutation(api.tracker.clearSore, { muscleId: chest._id }),
      ).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(chest._id))).not.toHaveProperty(
      "soreUntil",
    );
    expect(
      (await alice.query(api.tracker.overview, {})).muscles.find(
        (m) => m._id === chest._id,
      )?.soreUntil,
    ).toBeNull();
  });

  it.each(["plain", "strength"])(
    "clears only trained muscles when saving a %s workout",
    async (kind) => {
      const { alice, muscles } = await setup();
      for (const muscle of muscles)
        await alice.mutation(api.tracker.reportSore, {
          muscleId: muscle._id,
          now,
        });
      if (kind === "plain") {
        await alice.mutation(api.tracker.addWorkout, {
          muscleIds: [muscles[0]._id],
          trainedAt: now - hour,
          note: "",
        });
      } else {
        const exerciseId = await alice.mutation(api.strength.addExercise, {
          name: "Chest press",
          muscleIds: [muscles[0]._id],
        });
        await alice.mutation(api.strength.logSession, {
          entries: [{ exerciseId, sets: [{ reps: 5, weightKg: 100 }] }],
          trainedAt: now,
          note: "",
        });
      }
      const result = (await alice.query(api.tracker.overview, {})).muscles;
      expect(result[0].soreUntil).toBeNull();
      expect(result.slice(1).map((m) => m.soreUntil)).toEqual(
        muscles.slice(1).map(() => now + 12 * hour),
      );
    },
  );

  it("exports soreness as a timestamp or null", async () => {
    const { alice, chest } = await setup();
    const soreUntil = await alice.mutation(api.tracker.reportSore, {
      muscleId: chest._id,
      now,
    });
    const data = await alice.query(api.exportData.all, {});
    expect(data.muscles.find((m) => m.id === chest._id)?.soreUntil).toBe(
      soreUntil,
    );
    expect(
      data.muscles
        .filter((m) => m.id !== chest._id)
        .every((m) => m.soreUntil === null),
    ).toBe(true);
  });
});

it("passes soreness through the week planner and coach data to suggestions", async () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const { t, alice, muscles } = await setup();
  for (const muscle of muscles)
    for (let tap = 0; tap < 6; tap++)
      await alice.mutation(api.tracker.reportSore, {
        muscleId: muscle._id,
        now,
      });
  const plan = await alice.query(api.plan.week, { timeZone: "UTC" });
  expect(plan.days.slice(0, 3).map((day) => day.split)).toEqual([
    null,
    null,
    null,
  ]);
  expect(plan.days[3].split).toBe("legs");
  const today = await t.run((ctx) => todayDataFor(ctx, "alice", now, "UTC"));
  expect(today.muscles.every((m) => m.soreUntil === now + 72 * hour)).toBe(
    true,
  );
  const suggestions = await t.run((ctx) =>
    suggestionsFor(ctx, { userId: "alice", waterGoal: 0 }, now, "UTC"),
  );
  expect(suggestions).toMatchObject([{ kind: "rest" }]);
});

it("excludes sore muscles from Shortcuts today readiness until soreness expires", async () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const { t, alice, chest } = await setup();
  const token = await alice.mutation(api.shortcuts.createToken, {});
  const soreUntil = await alice.mutation(api.tracker.reportSore, {
    muscleId: chest._id,
    now,
  });
  const read = async () => {
    const response = await t.fetch("/shortcuts/today?timeZone=UTC", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  expect((await read()).readyMuscles).not.toContain("chest");
  vi.spyOn(Date, "now").mockReturnValue(soreUntil);
  expect((await read()).readyMuscles).toContain("chest");
});

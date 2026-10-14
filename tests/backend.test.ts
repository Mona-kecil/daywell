import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mealTotals } from "../lib/nutrients";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
const range = { startMs: 0, endMs: 86_400_000 };
afterEach(() => vi.unstubAllGlobals());
describe("authentication and ownership", () => {
  it("rejects unauthenticated reads and writes", async () => {
    const { t } = setup();
    await expect(t.query(api.tracker.overview, {})).rejects.toThrow("Sign in");
    await expect(t.query(api.tracker.waterToday, range)).rejects.toThrow(
      "Sign in",
    );
    await expect(t.query(api.meals.today, range)).rejects.toThrow("Sign in");
    await expect(t.mutation(api.tracker.initialize, {})).rejects.toThrow(
      "Sign in",
    );
    await expect(
      t.mutation(api.tracker.addWater, { amountMl: 250, at: 1 }),
    ).rejects.toThrow("Sign in");
    await expect(
      t.mutation(api.meals.uploadUrl, { sha256: "0".repeat(64) }),
    ).rejects.toThrow("Sign in");
  });
  it("seeds defaults once per user and isolates records", async () => {
    const { alice, bob } = setup();
    await alice.mutation(api.tracker.initialize, {});
    await alice.mutation(api.tracker.initialize, {});
    await bob.mutation(api.tracker.initialize, {});
    const overview = await alice.query(api.tracker.overview, {});
    expect(overview.muscles).toHaveLength(11);
    expect(overview.waterGoal).toBe(2500);
    const chest = overview.muscles.find((m) => m.name === "chest");
    if (!chest) throw new Error("Missing seeded chest");
    await expect(
      bob.mutation(api.tracker.setCooldown, { id: chest._id, hours: 24 }),
    ).rejects.toThrow("Muscle not found");
    const entry = await alice.mutation(api.tracker.addWater, {
      amountMl: 500,
      at: 1,
    });
    expect(await bob.query(api.tracker.waterToday, range)).toEqual([]);
    await expect(
      bob.mutation(api.tracker.deleteWater, { id: entry }),
    ).rejects.toThrow("Entry not found");
  });
  it("queries the half-open day and deletes water", async () => {
    const { alice } = setup();
    const id = await alice.mutation(api.tracker.addWater, {
      amountMl: 250,
      at: 0,
    });
    await alice.mutation(api.tracker.addWater, {
      amountMl: 500,
      at: range.endMs,
    });
    expect(
      (await alice.query(api.tracker.waterToday, range)).map((e) => e.amountMl),
    ).toEqual([250]);
    await alice.mutation(api.tracker.deleteWater, { id });
    expect(await alice.query(api.tracker.waterToday, range)).toEqual([]);
  });
  it("updates cooldown and rejects invalid quantities", async () => {
    const { alice } = setup();
    await alice.mutation(api.tracker.initialize, {});
    const overview = await alice.query(api.tracker.overview, {});
    const muscle = overview.muscles[0];
    await alice.mutation(api.tracker.setCooldown, {
      id: muscle._id,
      hours: 36,
    });
    expect(
      (await alice.query(api.tracker.overview, {})).muscles[0].cooldownHours,
    ).toBe(36);
    await alice.mutation(api.tracker.setWaterGoal, { goal: 3000 });
    expect((await alice.query(api.tracker.overview, {})).waterGoal).toBe(3000);
    await expect(
      alice.mutation(api.tracker.addWater, { amountMl: -1, at: 0 }),
    ).rejects.toThrow("greater than 0");
    await expect(
      alice.mutation(api.tracker.setCooldown, { id: muscle._id, hours: 0 }),
    ).rejects.toThrow("greater than 0");
  });
  it("restores the previous training time when a workout is deleted", async () => {
    const { alice, bob } = setup();
    await alice.mutation(api.tracker.initialize, {});
    const muscle = (await alice.query(api.tracker.overview, {})).muscles[0];
    await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [muscle._id],
      trainedAt: 100,
      note: "First",
    });
    const id = await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [muscle._id, muscle._id],
      trainedAt: 200,
      note: "Second",
    });
    expect(
      (await alice.query(api.tracker.overview, {})).muscles[0].lastTrainedAt,
    ).toBe(200);
    await expect(
      bob.mutation(api.tracker.deleteWorkout, { id }),
    ).rejects.toThrow("Workout not found");
    await alice.mutation(api.tracker.deleteWorkout, { id });
    expect(
      (await alice.query(api.tracker.overview, {})).muscles[0].lastTrainedAt,
    ).toBe(100);
    const history = await alice.query(api.tracker.workoutHistory, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(history.page.map((w) => w.note)).toEqual(["First"]);
  });
});
async function photoMeal() {
  const context = setup();
  const blob = new Blob(["photo fixture"], { type: "image/jpeg" });
  const storageId = await context.t.run((ctx) => ctx.storage.store(blob));
  // convex-test stores base64 digests and omits contentType, unlike Convex.
  // Seed the meal here; scripts/local-smoke.ts tests real upload registration.
  const id = await context.t.run((ctx) =>
    ctx.db.insert("meals", {
      userId: "alice",
      storageId,
      at: 1,
      description: "",
      items: [],
      revision: 0,
      analysis: { status: "analyzing", startedAt: Date.now() },
    }),
  );
  return { ...context, id, storageId };
}
const foodResponse = {
  foods: [
    {
      fdcId: 123,
      description: "Cooked rice",
      foodNutrients: [
        { nutrientId: 1008, value: 130, unitName: "KCAL" },
        { nutrientId: 1003, value: 2.5, unitName: "G" },
        { nutrientId: 1004, value: 0.3, unitName: "G" },
        { nutrientId: 1005, value: 28, unitName: "G" },
      ],
    },
  ],
};
describe("meal lifecycle", () => {
  it("rejects other users and internal unauthenticated calls", async () => {
    const { t, alice, bob, id } = await photoMeal();
    expect((await alice.query(api.meals.today, range))[0].analysis.status).toBe(
      "analyzing",
    );
    expect(await bob.query(api.meals.today, range)).toEqual([]);
    await expect(bob.action(api.mealActions.reanalyze, { id })).rejects.toThrow(
      "Meal not found",
    );
    await expect(t.query(internal.meals.read, { id })).rejects.toThrow(
      "Sign in",
    );
    await expect(bob.mutation(api.meals.deleteMeal, { id })).rejects.toThrow(
      "Meal not found",
    );
  });
  it("analyzes, honors edited text, changes grams without fetch, re-searches and deletes", async () => {
    const { alice, t, id, storageId } = await photoMeal();
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(foodResponse)));
    // Each call needs a fresh body, as a Response body can only be consumed once.
    fetch.mockImplementation(
      async () => new Response(JSON.stringify(foodResponse)),
    );
    vi.stubGlobal("fetch", fetch);
    await alice.action(api.mealActions.reanalyze, { id });
    let meal = await alice.query(internal.meals.read, { id });
    expect(meal.analysis.status).toBe("ready");
    expect(meal.items).toHaveLength(3);
    await alice.mutation(api.meals.setDescription, { id, description: "Rice" });
    await alice.action(api.mealActions.reanalyze, { id });
    meal = await alice.query(internal.meals.read, { id });
    expect(meal.description).toBe("Rice");
    expect(meal.items).toHaveLength(1);
    const item = meal.items[0];
    const requests = fetch.mock.calls.length;
    await alice.mutation(api.meals.setGrams, {
      id,
      itemId: item.id,
      grams: 200,
    });
    meal = await alice.query(internal.meals.read, { id });
    expect(mealTotals(meal.items).kcal).toBe(260);
    expect(fetch.mock.calls).toHaveLength(requests);
    await alice.action(api.mealActions.research, {
      id,
      itemId: item.id,
      query: "rice brown cooked",
    });
    expect(
      (await alice.query(internal.meals.read, { id })).items[0].searchQuery,
    ).toBe("rice brown cooked");
    await alice.mutation(api.meals.removeItem, { id, itemId: item.id });
    expect((await alice.query(internal.meals.read, { id })).items).toEqual([]);
    await alice.mutation(api.meals.deleteMeal, { id });
    expect(await alice.query(api.meals.today, range)).toEqual([]);
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  });
  it("records errors, retries, and refuses to invent unmatched nutrients", async () => {
    const { alice, id } = await photoMeal();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Too many requests", { status: 429 })),
    );
    await alice.action(api.mealActions.reanalyze, { id });
    expect(
      (await alice.query(internal.meals.read, { id })).analysis,
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("429"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ foods: [] }))),
    );
    await alice.action(api.mealActions.reanalyze, { id });
    const meal = await alice.query(internal.meals.read, { id });
    expect(meal.analysis.status).toBe("ready");
    expect(meal.items.every((item) => item.status === "unmatched")).toBe(true);
    expect(mealTotals(meal.items).kcal).toBe(0);
  });
  it("ignores stale analysis completions and blocks edits while analyzing", async () => {
    const { alice, id } = await photoMeal();
    const oldRevision = await alice.mutation(internal.meals.begin, { id });
    await alice.mutation(internal.meals.begin, { id });
    await alice.mutation(internal.meals.complete, {
      id,
      revision: oldRevision,
      result: { status: "ready", description: "Old", items: [] },
    });
    expect(
      (await alice.query(internal.meals.read, { id })).analysis.status,
    ).toBe("analyzing");
    await expect(
      alice.mutation(api.meals.setDescription, { id, description: "New" }),
    ).rejects.toThrow("Wait for");
  });
});
describe("insights range", () => {
  it("requires auth, caps the range, and scopes rows to the user", async () => {
    const { t, alice, bob } = setup();
    const span = { startMs: 0, endMs: 7 * 86_400_000 };
    await expect(t.query(api.insights.range, span)).rejects.toThrow("Sign in");
    await expect(
      alice.query(api.insights.range, { startMs: 0, endMs: 94 * 86_400_000 }),
    ).rejects.toThrow("Invalid range");
    await alice.mutation(api.tracker.initialize, {});
    await bob.mutation(api.tracker.initialize, {});
    await alice.mutation(api.tracker.addWater, { amountMl: 400, at: 1000 });
    await alice.mutation(api.tracker.addWater, {
      amountMl: 300,
      at: span.endMs,
    });
    const { muscles } = await alice.query(api.tracker.overview, {});
    await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [muscles[0]._id],
      trainedAt: 2000,
      note: "",
    });
    const mine = await alice.query(api.insights.range, span);
    expect(mine.water).toEqual([{ at: 1000, amountMl: 400 }]);
    expect(mine.workouts).toEqual([
      { trainedAt: 2000, muscleIds: [muscles[0]._id] },
    ]);
    expect(mine.muscles).toHaveLength(11);
    expect(mine.trainedBefore).toEqual([]);
    // Only muscles with a session before the range count as trained then.
    await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [muscles[1]._id],
      trainedAt: 3000,
      note: "",
    });
    expect(
      (await alice.query(api.insights.range, { ...span, startMs: 2001 }))
        .trainedBefore,
    ).toEqual([muscles[0]._id]);
    const theirs = await bob.query(api.insights.range, span);
    expect(theirs.water).toEqual([]);
    expect(theirs.workouts).toEqual([]);
    expect(theirs.trainedBefore).toEqual([]);
  });
});

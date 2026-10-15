import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import * as savedMealsBackend from "../convex/savedMeals";
import { quickLogProposalSchema } from "../lib/quick-log";
import { providerResultSchema } from "../convex/quickLogProviders/types";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-15T19:00Z");
const timeZone = "UTC";
const item = {
  name: "Chicken",
  grams: 200,
  fdcId: 123,
  per100g: { kcal: 306.2, protein: 24.1, carbs: 10.1, fat: 4.2 },
};
const recipe = { name: "Chicken rice bowl", items: [item], servings: 1 };
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("QUICK_LOG_PROVIDER", "fake");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("returns only the owner's saved meal in coach suggestions", async () => {
  const { t, alice, bob } = setup();
  const id = await alice.mutation(api.savedMeals.create, recipe);
  await bob.mutation(api.savedMeals.create, {
    ...recipe,
    name: "Bob private",
    items: [{ ...item, per100g: { ...item.per100g, protein: 99 } }],
  });
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      userId: "alice",
      waterGoal: 0,
      proteinTarget: 100,
    }),
  );
  expect(
    await alice.query(api.coach.suggestions, { now, timeZone }),
  ).toMatchObject([
    {
      id: "food:targets",
      savedMeal: { id, name: recipe.name, protein: 48, kcal: 612 },
    },
  ]);
  expect(
    JSON.stringify(await bob.query(api.coach.suggestions, { now, timeZone })),
  ).not.toContain(id);
});

it.each([
  ["10:00", 100, undefined, false],
  ["19:00", undefined, 2000, false],
  ["19:00", 100, undefined, true],
] as const)(
  "cron loads saved meals only for protein-behind food targets (%s, %s, %s)",
  async (slot, proteinTarget, kcalTarget, loads) => {
    const { t } = setup();
    const at = Date.parse(`2026-10-15T${slot}Z`);
    vi.setSystemTime(at);
    await t.run((ctx) =>
      ctx.db.insert("settings", {
        userId: "alice",
        waterGoal: 0,
        proteinTarget,
        kcalTarget,
        timeZone,
        remindersEnabled: true,
        checkIns: [slot],
      }),
    );
    const load = vi
      .spyOn(savedMealsBackend, "loadSavedMeals")
      .mockRejectedValue(new Error("savedMeals read forbidden"));
    const run = t.mutation(internal.coachCron.runUser, {
      userId: "alice",
      since: at - 60_000,
      until: at,
    });
    if (loads) {
      await expect(run).rejects.toThrow("savedMeals read forbidden");
      expect(load).toHaveBeenCalledTimes(1);
    } else {
      await run;
      expect(load).not.toHaveBeenCalled();
    }
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  },
);

it("loads saved meals once for the slot sent after an outage", async () => {
  const { t, alice } = setup();
  await alice.mutation(api.savedMeals.create, recipe);
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      userId: "alice",
      waterGoal: 0,
      proteinTarget: 100,
      timeZone,
      remindersEnabled: true,
      checkIns: ["13:00", "16:00", "19:00"],
    }),
  );
  const load = vi.spyOn(savedMealsBackend, "loadSavedMeals");
  await t.mutation(internal.coachCron.runUser, {
    userId: "alice",
    since: Date.parse("2026-10-15T12:00Z"),
    until: now,
  });
  expect(load).toHaveBeenCalledTimes(1);
  // Only the latest missed slot is sent; older ones aren't backfilled.
  expect(
    (await t.run((ctx) => ctx.db.query("coachSent").collect())).map(
      (row) => row.slot,
    ),
  ).toEqual(["19:00"]);
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
});

it("does not load recipes for the Shortcuts today response", async () => {
  const { t } = setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("shortcutTokens", {
      userId: "alice",
      hash: "shortcut-test",
      prefix: "test",
      createdAt: now,
    });
    await ctx.db.insert("settings", {
      userId: "alice",
      waterGoal: 0,
      proteinTarget: 100,
    });
  });
  const load = vi
    .spyOn(savedMealsBackend, "loadSavedMeals")
    .mockRejectedValue(new Error("savedMeals read forbidden"));
  expect(
    await t.mutation(internal.shortcuts.request, {
      hash: "shortcut-test",
      kind: "today",
      body: "{}",
      timeZone,
    }),
  ).toMatchObject({ status: 200 });
  expect(load).not.toHaveBeenCalled();
});

it("keeps push payloads text-only while naming the saved meal", async () => {
  const { t, alice } = setup();
  await alice.mutation(api.savedMeals.create, recipe);
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      userId: "alice",
      waterGoal: 0,
      proteinTarget: 100,
      timeZone,
      remindersEnabled: true,
      checkIns: ["19:00"],
    }),
  );
  await t.mutation(internal.coachCron.runUser, {
    userId: "alice",
    since: now - 60_000,
    until: now,
  });
  const sent = await t.run((ctx) => ctx.db.query("coachSent").unique());
  expect(sent?.delivery).toMatchObject({
    payload: {
      body: "100 g protein left. Your Chicken rice bowl adds 48 g (612 kcal).",
    },
  });
  if (sent?.delivery.status !== "pending")
    throw new Error("Missing pending delivery");
  expect(Object.keys(sent.delivery.payload).sort()).toEqual([
    "body",
    "kind",
    "slot",
    "title",
  ]);
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
});

describe("saved meal quick log", () => {
  it.each([
    ["had my overnight oats", "Overnight oats", 1],
    ["half a chicken rice bowl", recipe.name, 0.5],
    ["quarter of chicken rice bowl", recipe.name, 0.25],
    ["2 servings of overnight oats", "Overnight oats", 2],
    ["had quarter of my overnight oats", "Overnight oats", 0.25],
    ["had a third of my overnight oats", "Overnight oats", 0.25],
    ["had 1.5 servings of overnight oats at 7am", "Overnight oats", 1.5],
    ["had my OVERNIGHT   OATS", "Overnight oats", 1],
    ["had 1.33 servings of overnight oats", "Overnight oats", 1.25],
    ["0.1 servings of overnight oats", "Overnight oats", 0.25],
    ["2 overnight oats", "Overnight oats", 2],
  ])("parses %s through the fake provider", async (text, name, servings) => {
    const { alice } = setup();
    const savedMealId = await alice.mutation(api.savedMeals.create, {
      ...recipe,
      name,
    });
    expect(await alice.action(api.quickLog.parse, { text, timeZone })).toEqual({
      proposals: [
        {
          kind: "savedMeal",
          savedMealId,
          name,
          servings,
          at: text.includes("7am") ? Date.parse("2026-10-15T07:00Z") : now,
        },
      ],
      leftover: [],
    });
  });
  it("puts unknown/foreign explicit saved meals in leftover and keeps ordinary text meals", async () => {
    const { alice, bob } = setup();
    const foreign = await bob.mutation(api.savedMeals.create, {
      ...recipe,
      name: "Private oats",
    });
    for (const text of [
      "had my private oats",
      "half a private oats",
      "had my missing oats",
    ]) {
      const result = await alice.action(api.quickLog.parse, { text, timeZone });
      expect(result.proposals).toEqual([]);
      expect(result.leftover.length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toContain(foreign);
    }
    expect(
      (await alice.action(api.quickLog.parse, { text: "had eggs", timeZone }))
        .proposals[0].kind,
    ).toBe("meal");
  });
  it.each(["0", "-1", "10.25", "11"])(
    "rejects out-of-range parsed servings %s",
    async (amount) => {
      const { alice } = setup();
      await alice.mutation(api.savedMeals.create, recipe);
      expect(
        await alice.action(api.quickLog.parse, {
          text: `${amount} servings of chicken rice bowl`,
          timeZone,
        }),
      ).toMatchObject({ proposals: [], leftover: [expect.any(String)] });
    },
  );
  it("validates quarter steps at the proposal and apply boundaries", async () => {
    const { t, alice } = setup();
    const savedMealId = await alice.mutation(api.savedMeals.create, recipe);
    for (const servings of [0, 0.3, 10.25, NaN, Infinity]) {
      expect(
        quickLogProposalSchema.safeParse({
          kind: "savedMeal",
          savedMealId,
          name: recipe.name,
          servings,
          at: now,
        }).success,
      ).toBe(false);
      await expect(
        alice.mutation(api.quickLog.applySavedMeal, {
          savedMealId,
          servings,
          at: now,
        }),
      ).rejects.toThrow("Choose servings from 0.25–10 in steps of 0.25.");
    }
    expect(await t.run((ctx) => ctx.db.query("meals").collect())).toEqual([]);
    expect((await alice.query(api.savedMeals.list, {}))[0].useCount).toBe(0);
  });
  it("applies with the savedMeals.log scaling path and ownership checks", async () => {
    const { t, alice, bob } = setup();
    const savedMealId = await alice.mutation(api.savedMeals.create, {
      ...recipe,
      servings: 2,
    });
    const result = await alice.action(api.quickLog.parse, {
      text: "half a chicken rice bowl",
      timeZone,
    });
    const p = result.proposals[0];
    if (p?.kind !== "savedMeal") throw new Error("Missing saved meal proposal");
    await expect(
      t.mutation(api.quickLog.applySavedMeal, {
        savedMealId,
        at: p.at,
        servings: p.servings,
      }),
    ).rejects.toThrow("Sign in to continue.");
    await expect(
      bob.mutation(api.quickLog.applySavedMeal, {
        savedMealId,
        at: p.at,
        servings: p.servings,
      }),
    ).rejects.toThrow("Saved meal not found.");
    const direct = await alice.mutation(api.savedMeals.log, {
      id: savedMealId,
      at: p.at,
      servings: p.servings,
    });
    const applied = await alice.mutation(api.quickLog.applySavedMeal, {
      savedMealId,
      at: p.at,
      servings: p.servings,
    });
    const [a, b] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(direct), ctx.db.get(applied)]),
    );
    expect(b).toMatchObject({
      userId: "alice",
      description: a?.description,
      items: a?.items,
      analysis: a?.analysis,
      revision: a?.revision,
      at: a?.at,
    });
    expect(b?.items[0].grams).toBe(50);
    expect(await t.run((ctx) => ctx.db.get(savedMealId))).toMatchObject({
      useCount: 2,
      lastUsedAt: now,
    });
    await expect(
      alice.mutation(api.quickLog.applySavedMeal, {
        savedMealId,
        at: -1,
        servings: 1,
      }),
    ).rejects.toThrow("Invalid timestamp.");
  });
  it("uses a name-only structured output variant for providers", () => {
    expect(
      providerResultSchema.safeParse({
        proposals: [
          { kind: "savedMeal", name: recipe.name, servings: 0.5, at: now },
        ],
        leftover: [],
      }).success,
    ).toBe(true);
  });
  it("resolves provider names to owned IDs, discards supplied IDs and rejects unknown names", async () => {
    const { alice, bob } = setup();
    const own = await alice.mutation(api.savedMeals.create, recipe);
    const foreign = await bob.mutation(api.savedMeals.create, {
      ...recipe,
      name: "Private oats",
    });
    vi.stubEnv("QUICK_LOG_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    vi.stubEnv("OPENAI_CHAT_MODEL", "test-model");
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      proposals: [
                        {
                          kind: "savedMeal",
                          name: " CHICKEN   RICE BOWL ",
                          savedMealId: foreign,
                          servings: 1,
                          at: now + 100,
                        },
                        {
                          kind: "savedMeal",
                          name: "Private oats",
                          savedMealId: foreign,
                          servings: 1,
                          at: now,
                        },
                        {
                          kind: "savedMeal",
                          name: recipe.name,
                          servings: 0.3,
                          at: now,
                        },
                      ],
                      leftover: [],
                    }),
                  },
                ],
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await alice.action(api.quickLog.parse, {
      text: "had my chicken rice bowl",
      timeZone,
    });
    expect(result.proposals).toEqual([
      {
        kind: "savedMeal",
        savedMealId: own,
        name: recipe.name,
        servings: 1,
        at: now,
      },
    ]);
    expect(result.leftover).toContain("Unknown saved meal: Private oats");
    expect(JSON.stringify(result)).not.toContain(foreign);
    const body = fetch.mock.calls[0][1]?.body;
    if (typeof body !== "string") throw new Error("Missing provider body");
    expect(body).toContain("savedMeals");
    expect(body).not.toContain(foreign);
    expect(body).not.toContain("Private oats");
  });
});

it("grounds chat with up to ten owned meals ordered by use, with rounded per-serving macros", async () => {
  const { t, alice, bob } = setup();
  await bob.mutation(api.savedMeals.create, {
    ...recipe,
    name: "Private meal",
  });
  const used = await alice.mutation(api.savedMeals.create, {
    ...recipe,
    name: "Used meal",
    servings: 2,
  });
  await alice.mutation(api.savedMeals.log, { id: used, at: now, servings: 1 });
  for (let i = 0; i < 12; i++) {
    vi.setSystemTime(now + i + 1);
    await alice.mutation(api.savedMeals.create, {
      ...recipe,
      name: `Meal ${i}`,
      servings: 2,
    });
  }
  const id = await t.run((ctx) =>
    ctx.db.insert("coachMessages", {
      userId: "alice",
      role: "assistant",
      text: "",
      status: "pending",
      at: Date.now(),
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      userId: "alice",
      waterGoal: 0,
      proteinTarget: 100,
    }),
  );
  const load = vi.spyOn(savedMealsBackend, "loadSavedMeals");
  const source = await t.query(internal.coachChat.readReply, { id, timeZone });
  expect(load).toHaveBeenCalledTimes(1);
  if (source?.kind !== "ready") throw new Error("Missing reply source");
  expect(source.input.snapshot.savedMeals).toHaveLength(10);
  expect(source.input.snapshot.savedMeals[0]).toEqual({
    name: "Used meal",
    kcal: 306,
    protein: 24,
    carbs: 10,
    fat: 4,
  });
  expect(source.input.snapshot.savedMeals[1].name).toBe("Meal 11");
  expect(JSON.stringify(source.input.snapshot)).not.toContain("Private meal");
});

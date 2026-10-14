import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.UTC(2026, 9, 14, 12);
const args = {
  text: "drank 500 ml, trained back and biceps, slept 7.5 hours",
  timeZone: "Asia/Jakarta",
};
const mealArgs = {
  description: "Rice and chicken",
  at: now,
  items: [
    { name: "Rice", grams: 200, searchQuery: "rice white cooked" },
    { name: "Chicken", grams: 150, searchQuery: "chicken breast roasted" },
  ],
};
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
function providerOutput(proposals: unknown[], leftover: string[] = []) {
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
                  text: JSON.stringify({ proposals, leftover }),
                },
              ],
            },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("QUICK_LOG_PROVIDER", "fake");
  vi.stubEnv("FDC_MODE", "fixture");
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("quick log backend", () => {
  it("requires auth for parsing, meals, and internal entry points", async () => {
    const { t } = setup();
    await expect(t.action(api.quickLog.parse, args)).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(
      t.action(api.mealActions.createFromText, mealArgs),
    ).rejects.toThrow("Sign in to continue.");
    await expect(
      t.mutation(internal.quickLog.reserveParse, {}),
    ).rejects.toThrow("Sign in to continue.");
    await expect(t.query(internal.quickLog.readMuscles, {})).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(
      t.mutation(internal.meals.registerText, mealArgs),
    ).rejects.toThrow("Sign in to continue.");
  });
  it.each([
    [{ text: "  ", timeZone: args.timeZone }, "Enter a sentence to log."],
    [
      { text: "a".repeat(501), timeZone: args.timeZone },
      "Keep your quick log to 500 characters.",
    ],
    [
      { text: "500 ml", timeZone: "Mars/Olympus" },
      "Choose a valid IANA time zone.",
    ],
    [{ text: "500 ml", timeZone: "+07:00" }, "Choose a valid IANA time zone."],
  ])(
    "rejects invalid input before reserving rate capacity",
    async (input, message) => {
      const { t, alice } = setup();
      await expect(alice.action(api.quickLog.parse, input)).rejects.toThrow(
        message,
      );
      expect(
        await t.run((ctx) => ctx.db.query("quickLogLimits").collect()),
      ).toEqual([]);
    },
  );
  it("trims text, accepts 500 characters, and only writes rate bookkeeping", async () => {
    const { t, alice } = setup();
    await alice.mutation(api.tracker.initialize, {});
    const before = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.query("settings").collect(),
        ctx.db.query("muscles").collect(),
        ctx.db.query("exercises").collect(),
        ctx.db.query("water").collect(),
        ctx.db.query("workouts").collect(),
        ctx.db.query("workoutMuscles").collect(),
        ctx.db.query("meals").collect(),
        ctx.db.query("bodyCheckins").collect(),
        ctx.db.query("uploads").collect(),
        ctx.db.query("strengthSets").collect(),
        ctx.db.query("coachMessages").collect(),
      ]),
    );
    const result = await alice.action(api.quickLog.parse, {
      ...args,
      text: `  ${args.text}  `,
    });
    expect(result.proposals.map((p) => p.kind)).toEqual([
      "water",
      "workout",
      "checkin",
    ]);
    expect(result.leftover).toEqual([]);
    expect(
      await t.run(async (ctx) =>
        Promise.all([
          ctx.db.query("settings").collect(),
          ctx.db.query("muscles").collect(),
          ctx.db.query("exercises").collect(),
          ctx.db.query("water").collect(),
          ctx.db.query("workouts").collect(),
          ctx.db.query("workoutMuscles").collect(),
          ctx.db.query("meals").collect(),
          ctx.db.query("bodyCheckins").collect(),
          ctx.db.query("uploads").collect(),
          ctx.db.query("strengthSets").collect(),
          ctx.db.query("coachMessages").collect(),
        ]),
      ),
    ).toEqual(before);
    expect(
      await alice.action(api.quickLog.parse, {
        ...args,
        text: "x".repeat(500),
      }),
    ).toEqual({ proposals: [], leftover: ["x".repeat(500)] });
    const limits = await t.run((ctx) =>
      ctx.db.query("quickLogLimits").collect(),
    );
    expect(limits).toHaveLength(1);
    expect(limits[0]).toMatchObject({ userId: "alice", sentAt: [now, now] });
  });
  it("blocks the 61st parse, isolates users, and frees slots after an hour", async () => {
    const { t, alice, bob } = setup();
    for (let i = 0; i < 60; i++)
      await alice.action(api.quickLog.parse, { ...args, text: "500 ml" });
    await expect(alice.action(api.quickLog.parse, args)).rejects.toThrow(
      "You can parse 60 quick logs per hour. Please try again later.",
    );
    await expect(bob.action(api.quickLog.parse, args)).resolves.toMatchObject({
      proposals: [{ kind: "water" }, { kind: "checkin" }],
    });
    vi.setSystemTime(now + 3_600_000);
    await alice.action(api.quickLog.parse, args);
    const limit = await t.run((ctx) =>
      ctx.db
        .query("quickLogLimits")
        .withIndex("by_user", (q) => q.eq("userId", "alice"))
        .unique(),
    );
    expect(limit?.sentAt).toEqual([now + 3_600_000]);
  });
  it("maps owned muscle names, drops unknown names and provider IDs, and repairs times", async () => {
    const { t, alice, bob } = setup();
    await alice.mutation(api.tracker.initialize, {});
    await bob.mutation(api.tracker.initialize, {});
    const bobOnly = await t.run((ctx) =>
      ctx.db.insert("muscles", {
        userId: "bob",
        name: "private bob muscle",
        cooldownHours: 24,
      }),
    );
    const fetch = providerOutput([
      {
        kind: "workout",
        muscles: ["BACK", "unknown", "private bob muscle", "back"],
        muscleIds: [bobOnly],
        note: "test",
        at: now + 5000,
      },
      { kind: "water", amountMl: 250, at: now - 86_400_000 },
      {
        kind: "checkin",
        day: "1900-01-01",
        weightKg: null,
        sleepHours: 8,
        mood: null,
        energy: null,
      },
      { kind: "workout", muscles: ["unknown"], note: "test", at: now },
    ]);
    const result = await alice.action(api.quickLog.parse, args);
    const aliceBack = (
      await alice.query(api.tracker.overview, {})
    ).muscles.find((m) => m.name === "back");
    expect(result).toEqual({
      proposals: [
        {
          kind: "workout",
          muscles: ["back"],
          muscleIds: [aliceBack?._id],
          note: "test",
          at: now,
        },
        { kind: "water", amountMl: 250, at: now },
        { kind: "checkin", day: "2026-10-14", sleepHours: 8 },
      ],
      leftover: [
        "Unknown muscle: unknown",
        "Unknown muscle: private bob muscle",
      ],
    });
    const body = fetch.mock.calls[0][1]?.body;
    if (typeof body !== "string") throw new Error("Expected JSON body");
    expect(body).not.toContain(bobOnly);
    expect(body).not.toContain("private bob muscle");
    const workout = result.proposals[0];
    if (workout.kind !== "workout" || !aliceBack)
      throw new Error("Missing workout");
    // Shared IDs are strings; this proves the action returns IDs accepted by the existing mutation.
    await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [aliceBack._id],
      trainedAt: workout.at,
      note: workout.note,
    });
    expect(
      (await t.run((ctx) => ctx.db.query("workouts").collect()))[0].userId,
    ).toBe("alice");
  });
  it("keeps valid proposals when the model returns invalid entries", async () => {
    const { alice } = setup();
    providerOutput(
      [
        { kind: "water", amountMl: 10001, at: now },
        { kind: "water", amountMl: 250, at: now },
        { kind: "checkin", day: "2026-10-14", mood: 2.5 },
        { kind: "checkin", day: "2026-10-14" },
        {
          kind: "meal",
          description: "Eggs",
          at: now,
          items: [{ name: "eggs", grams: -1, searchQuery: "egg" }],
        },
        { kind: "water", amountMl: 500, at: -1 },
        null,
        { kind: "unsupported" },
      ],
      ["unknown clause"],
    );
    expect(await alice.action(api.quickLog.parse, args)).toEqual({
      proposals: [{ kind: "water", amountMl: 250, at: now }],
      leftover: ["unknown clause", args.text],
    });
  });
  it("sanitizes malformed provider output and configuration errors", async () => {
    const { alice } = setup();
    vi.stubEnv("QUICK_LOG_PROVIDER", "unsupported");
    await expect(alice.action(api.quickLog.parse, args)).rejects.toThrow(
      "Choose fake or openai for QUICK_LOG_PROVIDER on Convex.",
    );
    const fetch = providerOutput([]);
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: '{"proposals":"secret detail","leftover":[]}',
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(alice.action(api.quickLog.parse, args)).rejects.toThrow(
      "Could not parse your quick log. Please try again.",
    );
  });
  it("grounds text meals from fixtures without HTTP, keeps them photo-less, and supports undo", async () => {
    const { t, alice, bob } = setup();
    const fetch = vi.fn(() => {
      throw new Error("Fixture mode must not call HTTP");
    });
    vi.stubGlobal("fetch", fetch);
    const id = await alice.action(api.mealActions.createFromText, {
      ...mealArgs,
      description: "  Rice and chicken  ",
    });
    const meal = await t.run((ctx) => ctx.db.get(id));
    expect(meal).toMatchObject({
      userId: "alice",
      description: "Rice and chicken",
      at: now,
      revision: 1,
      analysis: { status: "ready" },
      items: [
        {
          id: "1:0",
          name: "Rice",
          grams: 200,
          status: "matched",
          per100g: { kcal: 130 },
        },
        {
          id: "1:1",
          name: "Chicken",
          grams: 150,
          status: "matched",
          per100g: { kcal: 151 },
        },
      ],
    });
    expect(meal).not.toHaveProperty("storageId");
    expect(fetch).not.toHaveBeenCalled();
    expect(await bob.query(api.meals.recent, {})).toEqual([]);
    await expect(bob.mutation(api.meals.deleteMeal, { id })).rejects.toThrow(
      "Meal not found.",
    );
    await expect(bob.query(internal.meals.read, { id })).rejects.toThrow(
      "Meal not found.",
    );
    await alice.mutation(api.meals.deleteMeal, { id });
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });
  it.each([
    { ...mealArgs, items: [] },
    { ...mealArgs, items: Array.from({ length: 31 }, () => mealArgs.items[0]) },
    { ...mealArgs, description: " " },
    { ...mealArgs, description: "x".repeat(4001) },
    { ...mealArgs, items: [{ ...mealArgs.items[0], grams: 0 }] },
    { ...mealArgs, items: [{ ...mealArgs.items[0], grams: 10001 }] },
    { ...mealArgs, items: [{ ...mealArgs.items[0], name: " " }] },
    {
      ...mealArgs,
      items: [{ ...mealArgs.items[0], searchQuery: "x".repeat(201) }],
    },
  ])("validates text meals before insertion", async (input) => {
    const { t, alice } = setup();
    await expect(
      alice.action(api.mealActions.createFromText, input),
    ).rejects.toThrow(
      "Use a description of 1–4,000 characters and 1–30 items;",
    );
    expect(await t.run((ctx) => ctx.db.query("meals").collect())).toEqual([]);
  });
  it("rejects invalid timestamps before insertion", async () => {
    const { t, alice } = setup();
    for (const at of [-1, 8_640_000_000_000_001])
      await expect(
        alice.action(api.mealActions.createFromText, { ...mealArgs, at }),
      ).rejects.toThrow("Invalid timestamp.");
    expect(await t.run((ctx) => ctx.db.query("meals").collect())).toEqual([]);
  });
  it("marks grounding failures error without persisting fetch secrets and remains deletable", async () => {
    const { t, alice } = setup();
    vi.stubEnv("FDC_MODE", "live");
    vi.stubEnv("USDA_FDC_API_KEY", "test-secret-value");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new Error("url?api_key=test-secret-value");
      }),
    );
    const id = await alice.action(api.mealActions.createFromText, mealArgs);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      analysis: {
        status: "error",
        message: "Food search failed. Please retry later.",
      },
    });
    await alice.mutation(api.meals.deleteMeal, { id });
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });
  it("retains unmatched foods as ready items and keeps fixture mode local", async () => {
    const { t, alice } = setup();
    const id = await alice.action(api.mealActions.createFromText, {
      ...mealArgs,
      items: [{ name: "Dragonfruit", grams: 150, searchQuery: "dragonfruit" }],
    });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      analysis: { status: "ready" },
      items: [{ status: "unmatched", grams: 150 }],
    });
    vi.stubEnv("CONVEX_CLOUD_URL", "https://example.convex.cloud");
    const other = await alice.action(api.mealActions.createFromText, mealArgs);
    expect(await t.run((ctx) => ctx.db.get(other))).toMatchObject({
      analysis: { status: "error" },
    });
  });
});

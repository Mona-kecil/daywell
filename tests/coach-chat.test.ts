import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { buildCoachSnapshot, type CoachSnapshotInput } from "../lib/coach-chat";
import { MUSCLE_DEFAULTS } from "../lib/recovery";
import { coachSuggestions } from "../lib/coach";
import { fake } from "../convex/coachChatProviders/fake";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.UTC(2026, 9, 14, 12);
const hour = 3_600_000;
const args = { text: "What should I eat tonight?", timeZone: "Asia/Jakarta" };
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
  vi.stubEnv("COACH_CHAT_PROVIDER", "fake");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("coach chat", () => {
  it("trims a question, lists pending then done turns, and answers from the caller's data", async () => {
    const { t, alice, bob } = setup();
    await alice.mutation(api.tracker.initialize, {});
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", "alice"))
        .unique();
      if (!settings) throw new Error("Missing settings");
      await ctx.db.patch(settings._id, { proteinTarget: 100 });
      await ctx.db.insert("water", { userId: "alice", at: now, amountMl: 500 });
      await ctx.db.insert("water", { userId: "bob", at: now, amountMl: 9000 });
    });
    const id = await alice.mutation(api.coachChat.send, {
      ...args,
      text: `  ${args.text}  `,
    });
    const pending = await alice.query(api.coachChat.list, {});
    expect(pending).toEqual([
      {
        _id: expect.any(String),
        role: "user",
        text: args.text,
        at: now,
        status: "done",
      },
      { _id: id, role: "assistant", text: "", at: now, status: "pending" },
    ]);
    expect(await bob.query(api.coachChat.list, {})).toEqual([]);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const done = await alice.query(api.coachChat.list, {});
    expect(done[1]).toMatchObject({
      _id: id,
      role: "assistant",
      status: "done",
    });
    expect(done[1].text).toContain("2000 ml water left");
    expect(done[1].text).toContain("100 g protein left");
    expect(done[1].text.length).toBeLessThanOrEqual(600);
    expect(done[1]).not.toHaveProperty("userId");
    expect(done[1]).not.toHaveProperty("_creationTime");
  });

  it("returns only the latest 50 messages in chronological order", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++)
        await ctx.db.insert("coachMessages", {
          userId: "alice",
          role: "user",
          text: String(i),
          at: now - 60 + i,
          status: "done",
        });
    });
    const messages = await alice.query(api.coachChat.list, {});
    expect(messages).toHaveLength(50);
    expect(messages.map((m) => m.text)).toEqual(
      Array.from({ length: 50 }, (_, i) => String(i + 10)),
    );
  });

  it("requires sign-in for each public function", async () => {
    const { t } = setup();
    await expect(t.query(api.coachChat.list, {})).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(t.mutation(api.coachChat.send, args)).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(t.mutation(api.coachChat.clear, {})).rejects.toThrow(
      "Sign in to continue.",
    );
  });

  it.each([
    [" \n ", "Enter a question for your coach."],
    ["a".repeat(1001), "Keep your question under 1,000 characters."],
  ])("rejects invalid question text", async (text, error) => {
    const { alice } = setup();
    await expect(
      alice.mutation(api.coachChat.send, { ...args, text }),
    ).rejects.toThrow(error);
    expect(await alice.query(api.coachChat.list, {})).toEqual([]);
  });

  it("accepts 1,000 characters after trimming and rejects an invalid time zone", async () => {
    const { t, alice } = setup();
    await expect(
      alice.mutation(api.coachChat.send, { ...args, timeZone: "invalid/zone" }),
    ).rejects.toThrow("Choose a valid IANA time zone.");
    await alice.mutation(api.coachChat.send, {
      ...args,
      text: ` ${"a".repeat(1000)} `,
    });
    expect((await alice.query(api.coachChat.list, {}))[0].text).toHaveLength(
      1000,
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });

  it("rejects a second send while the coach is answering without adding messages", async () => {
    const { t, alice } = setup();
    await alice.mutation(api.coachChat.send, args);
    await expect(alice.mutation(api.coachChat.send, args)).rejects.toThrow(
      "The coach is still answering.",
    );
    expect(await alice.query(api.coachChat.list, {})).toHaveLength(2);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });

  it("expires a stale pending reply and lets the next question through", async () => {
    const { t, alice } = setup();
    const oldId = await t.run((ctx) =>
      ctx.db.insert("coachMessages", {
        userId: "alice",
        role: "assistant",
        text: "",
        at: now - 120_001,
        status: "pending",
      }),
    );
    await alice.mutation(api.coachChat.send, args);
    expect((await alice.query(api.coachChat.list, {}))[0]).toMatchObject({
      _id: oldId,
      status: "error",
      error:
        "The coach took too long to answer. Please send your question again.",
    });
    await t.action(internal.coachChat.reply, {
      id: oldId,
      timeZone: args.timeZone,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      (await alice.query(api.coachChat.list, {})).map((m) => m.status),
    ).toEqual(["error", "done", "done"]);
  });

  it("marks a delayed action stale at the two-minute boundary", async () => {
    const { t, alice } = setup();
    await alice.mutation(api.coachChat.send, args);
    vi.setSystemTime(now + 120_000);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await alice.query(api.coachChat.list, {}))[1]).toMatchObject({
      status: "error",
      error: expect.stringContaining("took too long"),
    });
  });

  it("limits the 31st user question per rolling hour and permits one after the window", async () => {
    const { t, alice, bob } = setup();
    for (let i = 0; i < 30; i++) {
      await alice.mutation(api.coachChat.send, args);
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    }
    await expect(alice.mutation(api.coachChat.send, args)).rejects.toThrow(
      "You can send 30 questions per hour. Please try again later.",
    );
    await alice.mutation(api.coachChat.clear, {});
    expect(await alice.query(api.coachChat.list, {})).toEqual([]);
    await expect(alice.mutation(api.coachChat.send, args)).rejects.toThrow(
      "You can send 30 questions per hour. Please try again later.",
    );
    await bob.mutation(api.coachChat.send, args);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    vi.setSystemTime(now + hour);
    await alice.mutation(api.coachChat.send, args);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await alice.query(api.coachChat.list, {})).at(-1)?.status).toBe(
      "done",
    );
  });

  it("clears over two batches, preserves another user's messages and new questions", async () => {
    const { t, alice, bob } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 1100; i++)
        await ctx.db.insert("coachMessages", {
          userId: "alice",
          role: "user",
          text: "old",
          at: now - 2 * hour,
          status: "done",
        });
      await ctx.db.insert("coachMessages", {
        userId: "bob",
        role: "user",
        text: "Bob's question",
        at: now,
        status: "done",
      });
    });
    expect(await alice.mutation(api.coachChat.clear, {})).toBeNull();
    await alice.mutation(api.coachChat.send, args);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      (await alice.query(api.coachChat.list, {})).map((m) => m.role),
    ).toEqual(["user", "assistant"]);
    expect(
      (await bob.query(api.coachChat.list, {})).map((m) => m.text),
    ).toEqual(["Bob's question"]);
    const remaining = await t.run((ctx) =>
      ctx.db.query("coachMessages").collect(),
    );
    expect(remaining).toHaveLength(3);
  });

  it("does not recreate messages cleared before a scheduled reply", async () => {
    const { t, alice } = setup();
    await alice.mutation(api.coachChat.send, args);
    await alice.mutation(api.coachChat.clear, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await alice.query(api.coachChat.list, {})).toEqual([]);
  });

  it("does not recreate a reply cleared during the provider call", async () => {
    const { t, alice } = setup();
    vi.stubEnv("COACH_CHAT_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    vi.stubEnv("OPENAI_CHAT_MODEL", "test-model");
    let resolveFetch: (response: Response) => void = () => {
      throw new Error("Fetch did not start");
    };
    const started = Promise.withResolvers<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => {
        started.resolve();
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }),
    );
    const id = await alice.mutation(api.coachChat.send, args);
    const action = t.action(internal.coachChat.reply, {
      id,
      timeZone: args.timeZone,
    });
    await started.promise;
    await alice.mutation(api.coachChat.clear, {});
    resolveFetch(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Have tofu and rice." }],
            },
          ],
        }),
      ),
    );
    await action;
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await alice.query(api.coachChat.list, {})).toEqual([]);
  });

  it("records a friendly provider error and allows another question", async () => {
    const { t, alice } = setup();
    vi.stubEnv("COACH_CHAT_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    vi.stubEnv("OPENAI_CHAT_MODEL", "test-model");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () => new Response("sensitive upstream body", { status: 429 }),
      ),
    );
    await alice.mutation(api.coachChat.send, args);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const message = (await alice.query(api.coachChat.list, {}))[1];
    expect(message.status).toBe("error");
    expect(message.error).toContain("rate limit or quota");
    expect(message.error).not.toContain("sensitive");
    vi.stubEnv("COACH_CHAT_PROVIDER", "fake");
    await alice.mutation(api.coachChat.send, args);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await alice.query(api.coachChat.list, {})).at(-1)?.status).toBe(
      "done",
    );
  });

  it.each([
    ["2026-10-05", false],
    ["2026-10-13", true],
    ["2026-10-09", true],
    ["2026-10-08", false],
    ["2026-10-16", false],
  ])(
    "limits snapshot check-in %s to seven local days",
    async (day, included) => {
      const { t, alice } = setup();
      // Jakarta is already on October 15 while UTC is still on October 14.
      vi.setSystemTime(Date.UTC(2026, 9, 14, 18));
      await alice.mutation(api.checkins.upsert, { day, weightKg: 70 });
      const id = await alice.mutation(api.coachChat.send, args);
      const source = await t.query(internal.coachChat.readReply, {
        id,
        timeZone: args.timeZone,
      });
      if (source?.kind !== "ready") throw new Error("Missing reply source");
      expect(source.input.snapshot.local.day).toBe("2026-10-15");
      expect(source.input.snapshot.last7Days.fromDay).toBe("2026-10-09");
      expect(source.input.snapshot.latestCheckin).toEqual(
        included
          ? {
              day,
              weightKg: 70,
              waistCm: null,
              sleepHours: null,
              mood: null,
              energy: null,
            }
          : null,
      );
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    },
  );

  it("loads at most twelve completed turns and only the owner's snapshot", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++)
        await ctx.db.insert("coachMessages", {
          userId: "alice",
          role: i % 2 ? "assistant" : "user",
          text: `turn ${i}`,
          at: now - 30 + i,
          status: "done",
        });
      await ctx.db.insert("coachMessages", {
        userId: "bob",
        role: "user",
        text: "private bob turn",
        at: now - 1,
        status: "done",
      });
      await ctx.db.insert("bodyCheckins", {
        userId: "alice",
        day: "2026-10-14",
        weightKg: 70,
        waistCm: 82.25,
        sleepHours: 7,
        mood: 3,
        energy: 4,
        note: "private note",
      });
      await ctx.db.insert("bodyCheckins", {
        userId: "bob",
        day: "2026-10-14",
        weightKg: 99,
      });
    });
    const id = await alice.mutation(api.coachChat.send, args);
    const source = await t.query(internal.coachChat.readReply, {
      id,
      timeZone: args.timeZone,
    });
    if (source?.kind !== "ready") throw new Error("Missing reply source");
    expect(source.input.messages.length).toBeLessThanOrEqual(12);
    expect(source.input.messages.at(-1)).toEqual({
      role: "user",
      text: args.text,
    });
    expect(source.input.snapshot.latestCheckin).toEqual({
      day: "2026-10-14",
      weightKg: 70,
      waistCm: 82.25,
      sleepHours: 7,
      mood: 3,
      energy: 4,
    });
    expect(JSON.stringify(source)).not.toMatch(
      /private bob|private note|userId|_id|storageId/,
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
});

const base: CoachSnapshotInput = {
  now,
  timeZone: "Asia/Jakarta",
  waterGoal: 2500,
  targets: { kcalTarget: 2000, proteinTarget: 100 },
  water: [],
  meals: [],
  workouts: [],
  muscles: [],
  checkin: null,
  suggestions: [],
};
const item = {
  id: "private-item-id",
  name: "Rice",
  grams: 100,
  searchQuery: "rice",
  status: "matched" as const,
  foodDescription: "Rice",
  fdcId: 123,
  per100g: { kcal: 200, protein: 10, fat: 3, carbs: 30 },
};

describe("coach snapshot", () => {
  it("counts only analysed meals, projects safe fields, and computes local-day recovery and week totals", () => {
    const meal = {
      at: now,
      description: "Rice bowl",
      items: [item],
      userId: "private-user",
      _id: "private-meal-id",
      storageId: "private-storage-id",
      photoUrl: "https://private-storage-url",
    };
    const input = {
      ...base,
      water: [
        { at: now, amountMl: 500 },
        { at: now - 7 * hour, amountMl: 200 },
        { at: now - 24 * hour, amountMl: 1400 },
        { at: now - 8 * 24 * hour, amountMl: 10000 },
        { at: now + 1, amountMl: 10000 },
      ],
      meals: [
        { ...meal, analysis: { status: "ready" as const } },
        { ...meal, analysis: { status: "analyzing" as const } },
        { ...meal, analysis: { status: "error" as const } },
        {
          ...meal,
          at: now - 24 * hour,
          analysis: { status: "ready" as const },
        },
        { ...meal, at: now + 1, analysis: { status: "ready" as const } },
      ],
      workouts: [
        { trainedAt: now },
        { trainedAt: now - hour },
        { trainedAt: now - 24 * hour },
        { trainedAt: now - 8 * 24 * hour },
        { trainedAt: now + 1 },
      ],
      muscles: [
        { name: "quads", cooldownHours: 72, lastTrainedAt: now - 48 * hour },
        { name: "back", cooldownHours: 72, lastTrainedAt: null },
        { name: "chest", cooldownHours: 24, lastTrainedAt: now - 24 * hour },
      ],
      checkin: {
        day: "2026-10-14",
        weightKg: 70,
        sleepHours: 8,
        mood: 3,
        energy: 4,
        _id: "private-checkin-id",
        note: "private-note",
      },
      suggestions: [
        {
          id: "private-suggestion-id",
          kind: "food" as const,
          title: "Eat protein",
          body: "Add tofu.",
        },
      ],
    };
    const snapshot = buildCoachSnapshot(input);
    expect(snapshot.local).toEqual({
      day: "2026-10-14",
      time: "19:00",
      weekday: "Wednesday",
      timeZone: "Asia/Jakarta",
    });
    expect(snapshot.today).toMatchObject({
      waterMl: 700,
      waterGoalMl: 2500,
      nutrients: item.per100g,
      targets: { kcal: 2000, protein: 100 },
      analysedMeals: 1,
      unanalysedMeals: 2,
    });
    expect(snapshot.today.meals.map((m) => m.kcal)).toEqual([200, null, null]);
    expect(snapshot.muscles).toEqual([
      { name: "quads", status: "recovering", hoursUntilReady: 24 },
      { name: "back", status: "ready", hoursUntilReady: 0 },
      { name: "chest", status: "ready", hoursUntilReady: 0 },
    ]);
    expect(snapshot.last7Days).toEqual({
      fromDay: "2026-10-08",
      toDay: "2026-10-14",
      trainingDays: 2,
      avgWaterMl: 300,
      avgKcal: 57.1,
      waterDaysLogged: 2,
      mealDaysLogged: 2,
    });
    expect(snapshot.suggestions).toEqual([
      { kind: "food", text: "Eat protein. Add tofu." },
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /private|userId|storageId|photoUrl|fdcId|"id"|"_id"|note/,
    );
  });

  it("uses local dates across UTC boundaries and daylight saving changes", () => {
    const snapshot = buildCoachSnapshot({
      ...base,
      now: Date.parse("2026-11-02T04:30:00Z"),
      timeZone: "America/New_York",
      water: [
        { at: Date.parse("2026-11-01T04:30:00Z"), amountMl: 500 },
        { at: Date.parse("2026-10-26T04:30:00Z"), amountMl: 10000 },
      ],
    });
    expect(snapshot.local).toMatchObject({
      day: "2026-11-01",
      time: "23:30",
      weekday: "Sunday",
    });
    expect(snapshot.today.waterMl).toBe(500);
    expect(snapshot.last7Days).toMatchObject({
      fromDay: "2026-10-26",
      avgWaterMl: 1500,
    });
  });

  it("caps meal text and suggestions to keep a populated snapshot below 3 KB", () => {
    const muscles = MUSCLE_DEFAULTS.map((m) => ({ ...m, lastTrainedAt: null }));
    const suggestions = coachSuggestions({
      now,
      localMinutes: 19 * 60,
      timeZone: base.timeZone,
      waterMl: 0,
      waterGoal: 2500,
      macros: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      targets: base.targets,
      mealCount: 10,
      muscles,
    });
    const snapshot = buildCoachSnapshot({
      ...base,
      muscles,
      suggestions,
      savedMealRecipes: Array.from({ length: 10 }, (_, i) => ({
        name: "A saved meal with chicken and vegetables ".repeat(2),
        createdAt: i,
        servings: 1,
        items: [
          {
            name: "Chicken",
            grams: 100,
            per100g: { kcal: 300, protein: 30, carbs: 10, fat: 10 },
          },
        ],
      })),
      meals: Array.from({ length: 10 }, (_, i) => ({
        at: now - i * 60_000,
        description: "Meal with chicken, rice and vegetables. ".repeat(100),
        analysis: { status: "ready" },
        items: [item],
      })),
    });
    expect(snapshot.savedMeals.length).toBeGreaterThan(0);
    expect(snapshot.savedMeals.length).toBeLessThanOrEqual(10);
    expect(snapshot.today.meals).toHaveLength(6);
    expect(snapshot.today.omittedMeals).toBe(4);
    expect(snapshot.today.nutrients.kcal).toBe(2000);
    expect(
      new TextEncoder().encode(JSON.stringify(snapshot)).length,
    ).toBeLessThan(3072);
  });

  it("marks missing targets and check-ins and produces a deterministic useful fake answer", async () => {
    const snapshot = buildCoachSnapshot({
      ...base,
      targets: {},
      checkin: { day: "2026-10-15", weightKg: 70 },
    });
    expect(snapshot.today.targets).toEqual({ kcal: null, protein: null });
    expect(snapshot.latestCheckin).toBeNull();
    const input = {
      snapshot,
      messages: [{ role: "user" as const, text: "What should I eat?" }],
    };
    const answer = await fake.answer(input);
    expect(answer).toBe(await fake.answer(input));
    expect(answer).toContain("tofu");
    expect(answer).toContain("2500 ml water left");
    expect(answer).toContain("Set a protein target");
    expect(
      await fake.answer({
        snapshot,
        messages: [{ role: "user", text: "Can I train legs tomorrow?" }],
      }),
    ).toContain("No muscle recovery data");
    expect(answer.length).toBeLessThanOrEqual(600);
  });

  it("answers a split question from the named muscles' recovery", async () => {
    const hour = 3_600_000;
    const snapshot = buildCoachSnapshot({
      ...base,
      muscles: [
        { name: "quads", cooldownHours: 72, lastTrainedAt: now - 55 * hour },
        { name: "glutes", cooldownHours: 72, lastTrainedAt: now - 60 * hour },
        { name: "calves", cooldownHours: 24, lastTrainedAt: null },
        { name: "chest", cooldownHours: 72, lastTrainedAt: now - hour },
      ],
    });
    const ask = (text: string) =>
      fake.answer({ snapshot, messages: [{ role: "user", text }] });
    const legs = await ask("Can I train legs tomorrow?");
    expect(legs).toContain("Glutes and quads need about 17 h more");
    expect(legs).toContain("So tomorrow works.");
    expect(legs).toContain("Calves is ready now");
    expect(legs).not.toContain("chest");
    expect(await ask("Is my chest ready tomorrow?")).toContain(
      "Tomorrow is too soon",
    );
  });
});

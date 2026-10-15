import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { readinessForCoach, todayDataFor } from "../convex/coachData";
import * as readinessBackend from "../convex/readiness";
import { buildCoachSnapshot, type CoachSnapshotInput } from "../lib/coach-chat";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-14T23:30Z");
const timeZone = "Asia/Jakarta";
const day = "2026-10-15";
const args = { now, timeZone };
function setup() {
  const t = convexTest(schema, modules);
  return { t, alice: t.withIdentity({ subject: "alice" }) };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now - 60_000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function seed(t: ReturnType<typeof setup>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("bodyCheckins", {
      userId: "alice",
      day,
      sleepHours: 4,
      energy: 1,
    });
    await ctx.db.insert("bodyCheckins", {
      userId: "bob",
      day,
      sleepHours: 8,
      energy: 5,
    });
  });
}
async function snapshot(t: ReturnType<typeof setup>["t"]) {
  vi.setSystemTime(now);
  const id = await t.run((ctx) =>
    ctx.db.insert("coachMessages", {
      userId: "alice",
      role: "assistant",
      status: "pending",
      at: now,
      text: "",
    }),
  );
  const source = await t.query(internal.coachChat.readReply, { id, timeZone });
  if (source?.kind !== "ready") throw new Error("Missing reply source");
  return source.input.snapshot;
}

describe("readiness coach backend", () => {
  it("loads the query's readiness into coach data and the in-app nudge", async () => {
    const { t, alice } = setup();
    await seed(t);
    const estimate = await alice.query(api.readiness.today, args);
    expect(estimate).toMatchObject({ day, score: 0, band: "easy" });
    const readiness = await t.run((ctx) =>
      readinessForCoach(ctx, "alice", now, timeZone),
    );
    expect(readiness).toEqual({
      score: 0,
      band: "easy",
      weakest: "sleep",
    });
    expect(await alice.query(api.coach.suggestions, args)).toEqual([
      {
        id: "today:readiness",
        kind: "readiness",
        priority: 2,
        title: "Readiness 0: take it easy",
        body: "Last night was short. A walk, mobility or a stretch fits today better than a hard session.",
      },
    ]);
  });

  it.each([
    [5.49, "sleep"],
    [5.5, undefined],
  ] as const)(
    "sets weakest only below 50 (sleep %s)",
    async (sleepHours, weakest) => {
      const { t } = setup();
      await t.run((ctx) =>
        ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day,
          sleepHours,
          energy: 5,
        }),
      );
      const readiness = await t.run((ctx) =>
        readinessForCoach(ctx, "alice", now, timeZone),
      );
      expect(readiness?.weakest).toBe(weakest);
    },
  );

  it("keeps coach data, suggestions and chat working after a readiness limit overflow", async () => {
    const { t, alice } = setup();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 29; i++)
        await ctx.db.insert("bodyCheckins", {
          userId: "alice",
          day,
          sleepHours: 4,
          energy: 1,
        });
      await ctx.db.insert("muscles", {
        userId: "alice",
        name: "back",
        cooldownHours: 24,
      });
    });
    await expect(alice.query(api.readiness.today, args)).rejects.toThrow(
      "History exceeds readiness limits.",
    );
    // t.run encodes undefined as null, so compare inside the transaction.
    expect(
      await t.run(
        async (ctx) =>
          (await readinessForCoach(ctx, "alice", now, timeZone)) === undefined,
      ),
    ).toBe(true);
    expect(
      (await alice.query(api.coach.suggestions, args)).map((s) => s.kind),
    ).toEqual(["train"]);
    const chat = await snapshot(t);
    expect(chat.today).not.toHaveProperty("readiness");
    expect(chat.suggestions[0].kind).toBe("train");
  });

  it.each([
    new Error("History exceeds readiness limits."),
    new ConvexError("Database unavailable."),
  ])("propagates a non-limit readiness error (%s)", async (error) => {
    const { t, alice } = setup();
    vi.spyOn(readinessBackend, "loadReadiness").mockRejectedValue(error);
    await expect(
      t.run((ctx) => readinessForCoach(ctx, "alice", now, timeZone)),
    ).rejects.toThrow(error.message);
    await expect(alice.query(api.coach.suggestions, args)).rejects.toThrow(
      error.message,
    );
    await expect(snapshot(t)).rejects.toThrow(error.message);
  });

  it("grounds chat with today's readiness in the caller's local day", async () => {
    const { t } = setup();
    await seed(t);
    const chat = await snapshot(t);
    expect(chat.local.day).toBe(day);
    expect(chat.today.readiness).toEqual({
      score: 0,
      band: "easy",
      weakest: "sleep",
    });
    expect(chat.suggestions[0]).toMatchObject({ kind: "readiness" });
  });

  it("omits null readiness from the chat snapshot", async () => {
    const { t } = setup();
    expect((await snapshot(t)).today).not.toHaveProperty("readiness");
  });

  it("loads readiness only where the coach can use it", async () => {
    const { t, alice } = setup();
    await seed(t);
    const load = vi.spyOn(readinessBackend, "loadReadiness");
    await t.run((ctx) => todayDataFor(ctx, "alice", now, timeZone));
    expect(load).not.toHaveBeenCalled();
    await alice.query(api.coach.suggestions, args);
    expect(load).toHaveBeenCalledTimes(1);
    load.mockClear();
    await snapshot(t);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["05:59", Date.parse("2026-10-14T22:59Z")],
    ["14:00", Date.parse("2026-10-15T07:00Z")],
  ])("skips the readiness history outside 06:00-14:00 (%s)", async (_, at) => {
    const { t, alice } = setup();
    await seed(t);
    vi.setSystemTime(at - 60_000);
    const load = vi.spyOn(readinessBackend, "loadReadiness");
    const kinds = (
      await alice.query(api.coach.suggestions, { now: at, timeZone })
    ).map((s) => s.kind);
    expect(kinds).not.toContain("readiness");
    expect(load).not.toHaveBeenCalled();
  });

  it("persists a readiness push payload through the cron", async () => {
    const { t } = setup();
    await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("settings", {
        userId: "alice",
        waterGoal: 2500,
        timeZone,
        remindersEnabled: true,
        checkIns: ["06:30"],
      }),
    );
    vi.setSystemTime(now);
    await t.mutation(internal.coachCron.run, {});
    const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
    expect(sent).toHaveLength(1);
    expect(sent[0].delivery).toMatchObject({
      status: "pending",
      payload: { kind: "readiness", title: "Readiness 0: take it easy" },
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
});

const snapshotBase: CoachSnapshotInput = {
  now,
  timeZone,
  waterGoal: 2500,
  targets: {},
  water: [],
  meals: [],
  workouts: [],
  muscles: [],
  checkin: null,
  suggestions: [],
};
it("includes a scored readiness snapshot and omits absent or null estimates", () => {
  expect(
    buildCoachSnapshot({
      ...snapshotBase,
      readiness: { score: 65, band: "steady" },
    }).today.readiness,
  ).toEqual({ score: 65, band: "steady" });
  expect(buildCoachSnapshot(snapshotBase).today).not.toHaveProperty(
    "readiness",
  );
  expect(
    buildCoachSnapshot({
      ...snapshotBase,
      readiness: { score: null, band: null },
    }).today,
  ).not.toHaveProperty("readiness");
});

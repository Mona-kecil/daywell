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
  vi.unstubAllEnvs();
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

  it("fans out two reminder users without loading history in the parent cron", async () => {
    const { t } = setup();
    const at = Date.parse("2026-10-15T03:01Z");
    vi.setSystemTime(at);
    await t.run(async (ctx) => {
      for (const userId of ["alice", "bob"])
        await ctx.db.insert("settings", {
          userId,
          waterGoal: 2500,
          timeZone,
          remindersEnabled: true,
          checkIns: ["10:00"],
        });
    });
    const load = vi.spyOn(readinessBackend, "loadReadiness");
    await t.mutation(internal.coachCron.run, {});
    const parentLoads = load.mock.calls.length;
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const before = await t.run((ctx) => ctx.db.query("coachSent").collect());
    const cursor = await t.run((ctx) => ctx.db.query("coachRuns").unique());
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(parentLoads).toBe(0);
    expect(before).toEqual([]);
    expect(jobs).toHaveLength(2);
    expect(jobs).toEqual(
      expect.arrayContaining(
        ["alice", "bob"].map((userId) =>
          expect.objectContaining({
            name: "coachCron:runUser",
            args: [{ userId, since: at - 15 * 60_000, until: at }],
            state: { kind: "pending" },
          }),
        ),
      ),
    );
    expect(cursor).toMatchObject({ key: "check-ins", lastRunAt: at });
    expect(load).toHaveBeenCalledTimes(2);
    const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
    expect(sent).toHaveLength(2);
    expect(sent).toEqual(
      expect.arrayContaining(
        ["alice", "bob"].map((userId) =>
          expect.objectContaining({ userId, localDay: day, slot: "10:00" }),
        ),
      ),
    );
  });

  it.each([false, true])(
    "loads readiness once for three outage slots, including limit degradation (%s)",
    async (overflow) => {
      const { t } = setup();
      await seed(t);
      const since = Date.parse("2026-10-14T22:00Z");
      const at = Date.parse("2026-10-15T07:01Z");
      await t.run(async (ctx) => {
        await ctx.db.insert("settings", {
          userId: "alice",
          waterGoal: 0,
          timeZone,
          remindersEnabled: true,
          checkIns: ["06:30", "09:00", "13:59"],
        });
        await ctx.db.insert("coachRuns", {
          key: "check-ins",
          lastRunAt: since,
        });
        await ctx.db.insert("muscles", {
          userId: "alice",
          name: "back",
          cooldownHours: 24,
        });
        await ctx.db.insert("pushSubscriptions", {
          userId: "alice",
          endpoint: "https://fcm.googleapis.com/fcm/send/alice",
          keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
          createdAt: Date.now(),
        });
        if (overflow)
          for (let i = 0; i < 29; i++)
            await ctx.db.insert("bodyCheckins", {
              userId: "alice",
              day,
              sleepHours: 4,
              energy: 1,
            });
      });
      vi.setSystemTime(at);
      vi.stubEnv("PUSH_PROVIDER", "fake");
      const load = vi.spyOn(readinessBackend, "loadReadiness");
      await t.mutation(internal.coachCron.run, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      expect(load).toHaveBeenCalledTimes(1);
      expect(load.mock.calls[0].slice(1)).toEqual(["alice", now, timeZone]);
      const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
      expect(sent).toHaveLength(3);
      expect(sent.map((row) => [row.userId, row.localDay, row.slot])).toEqual([
        ["alice", day, "06:30"],
        ["alice", day, "09:00"],
        ["alice", day, "13:59"],
      ]);
      expect(sent.every((row) => row.createdAt === at)).toBe(true);
      const deliveries = await t.run((ctx) =>
        ctx.db.query("pushDeliveries").collect(),
      );
      expect(deliveries).toHaveLength(3);
      expect(
        deliveries.every(
          (row) => row.payload.kind === (overflow ? "train" : "readiness"),
        ),
      ).toBe(true);

      await t.mutation(internal.coachCron.runUser, {
        userId: "alice",
        since,
        until: at,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(load).toHaveBeenCalledTimes(1);
      expect(
        await t.run((ctx) => ctx.db.query("coachSent").collect()),
      ).toHaveLength(3);
      expect(
        await t.run((ctx) => ctx.db.query("pushDeliveries").collect()),
      ).toHaveLength(3);
    },
  );

  it.each(["deleted", "disabled", "no-zone", "rescheduled"])(
    "rechecks settings before processing a queued user (%s)",
    async (change) => {
      const { t } = setup();
      const id = await t.run((ctx) =>
        ctx.db.insert("settings", {
          userId: "alice",
          waterGoal: 2500,
          timeZone,
          remindersEnabled: true,
          checkIns: ["06:30"],
        }),
      );
      vi.setSystemTime(now);
      const load = vi.spyOn(readinessBackend, "loadReadiness");
      await t.mutation(internal.coachCron.run, {});
      await t.run(async (ctx) => {
        if (change === "deleted") await ctx.db.delete(id);
        else if (change === "disabled")
          await ctx.db.patch(id, { remindersEnabled: false });
        else if (change === "no-zone")
          await ctx.db.patch(id, { timeZone: undefined });
        else await ctx.db.patch(id, { checkIns: ["10:00"] });
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(load).not.toHaveBeenCalled();
      expect(await t.run((ctx) => ctx.db.query("coachSent").collect())).toEqual(
        [],
      );
    },
  );

  it.each([
    ["05:59", Date.parse("2026-10-14T22:59Z")],
    ["14:00", Date.parse("2026-10-15T07:00Z")],
  ])("keeps cron readiness lazy outside the window (%s)", async (slot, at) => {
    const { t } = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        userId: "alice",
        waterGoal: 0,
        timeZone,
        remindersEnabled: true,
        checkIns: [slot],
      });
      await ctx.db.insert("muscles", {
        userId: "alice",
        name: "back",
        cooldownHours: 24,
      });
    });
    vi.setSystemTime(at);
    const load = vi.spyOn(readinessBackend, "loadReadiness");
    await t.mutation(internal.coachCron.run, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(load).not.toHaveBeenCalled();
    expect(
      await t.run((ctx) => ctx.db.query("coachSent").collect()),
    ).toMatchObject([{ userId: "alice", slot }]);
  });

  it("isolates a failed user job while advancing the cursor and processing another user", async () => {
    const { t } = setup();
    const at = Date.parse("2026-10-15T03:01Z");
    vi.setSystemTime(at);
    await t.run(async (ctx) => {
      for (const userId of ["alice", "bob"])
        await ctx.db.insert("settings", {
          userId,
          waterGoal: 2500,
          timeZone,
          remindersEnabled: true,
          checkIns: ["10:00"],
        });
    });
    const originalLoad = readinessBackend.loadReadiness;
    vi.spyOn(readinessBackend, "loadReadiness").mockImplementation(
      (ctx, userId, at, zone) => {
        if (userId === "alice") throw new Error("Database unavailable.");
        return originalLoad(ctx, userId, at, zone);
      },
    );
    await t.mutation(internal.coachCron.run, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(jobs.filter((job) => job.state.kind === "failed")).toMatchObject([
      { name: "coachCron:runUser", args: [{ userId: "alice" }] },
    ]);
    expect(
      await t.run((ctx) => ctx.db.query("coachRuns").unique()),
    ).toMatchObject({
      lastRunAt: at,
    });
    const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      userId: "bob",
      localDay: day,
      slot: "10:00",
    });
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
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();
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

import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import {
  COACH_WATER_LIMIT,
  readinessForCoach,
  todayDataFor,
} from "../convex/coachData";
import { COACH_FANOUT_PAGE, COACH_FRESHNESS_MS } from "../convex/coachCron";
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

  it("T1 pages fan-out, advances the cursor on the last page and sends once", async () => {
    const { t } = setup();
    const at = Date.parse("2026-10-15T03:01Z");
    const since = at - 15 * 60_000;
    expect(COACH_FANOUT_PAGE).toBe(200);
    vi.setSystemTime(at);
    await t.run(async (ctx) => {
      for (let i = 0; i < 405; i++)
        await ctx.db.insert("settings", {
          userId: `user-${i}`,
          waterGoal: 2500,
          timeZone,
          remindersEnabled: true,
          checkIns: ["10:00"],
        });
      await ctx.db.insert("coachRuns", { key: "check-ins", lastRunAt: since });
    });
    for (let page = 0; page < 2; page++) {
      const before = await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      await t.mutation(internal.coachCron.run, {});
      const jobs = await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      const added = jobs.filter(
        (job) => !before.some((old) => old._id === job._id),
      );
      expect(added.length).toBeLessThanOrEqual(201);
      expect(
        added.filter((job) => job.name === "coachCron:runUser"),
      ).toHaveLength(200);
      expect(added.filter((job) => job.name === "coachCron:run")).toHaveLength(
        1,
      );
      expect(
        await t.run((ctx) => ctx.db.query("coachRuns").unique()),
      ).toMatchObject({
        lastRunAt: since,
        windowUntil: at,
        pageCursor: expect.any(String),
      });
    }
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const cursor = await t.run((ctx) => ctx.db.query("coachRuns").unique());
    expect(cursor).toMatchObject({ lastRunAt: at });
    expect(cursor).not.toHaveProperty("windowUntil");
    expect(cursor).not.toHaveProperty("pageCursor");
    const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
    expect(sent).toHaveLength(405);
    expect(new Set(sent.map((row) => row.userId)).size).toBe(405);
    expect(
      sent.every((row) => row.localDay === day && row.slot === "10:00"),
    ).toBe(true);
    await t.mutation(internal.coachCron.run, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.run((ctx) => ctx.db.query("coachSent").collect()),
    ).toHaveLength(405);
    expect(
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      ),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: { kind: "failed" } }),
      ]),
    );
  });

  it.each([false, true])(
    "T2 sends only the latest fresh outage slot (already sent: %s)",
    async (alreadySent) => {
      const { t } = setup();
      const at = Date.parse("2026-10-15T23:30Z");
      vi.setSystemTime(at);
      await t.run(async (ctx) => {
        await ctx.db.insert("settings", {
          userId: "alice",
          waterGoal: 2500,
          timeZone: "UTC",
          remindersEnabled: true,
          checkIns: Array.from(
            { length: 24 },
            (_, hour) => `${String(hour).padStart(2, "0")}:00`,
          ),
        });
        await ctx.db.insert("muscles", {
          userId: "alice",
          name: "back",
          cooldownHours: 24,
        });
        if (alreadySent)
          await ctx.db.insert("coachSent", {
            userId: "alice",
            localDay: day,
            slot: "23:00",
            createdAt: at,
            delivery: { status: "attempted", at },
          });
      });
      await t.mutation(internal.coachCron.runUser, {
        userId: "alice",
        since: at - 24 * 3_600_000,
        until: at,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
      expect(sent).toMatchObject([
        { userId: "alice", localDay: day, slot: "23:00" },
      ]);
    },
  );

  it.each([0, 1])(
    "T2 keeps the two-hour freshness boundary (%s ms past)",
    async (past) => {
      const { t } = setup();
      const slotAt = Date.parse("2026-10-15T10:00Z");
      vi.setSystemTime(slotAt + COACH_FRESHNESS_MS + past);
      await t.run((ctx) =>
        ctx.db.insert("settings", {
          userId: "alice",
          waterGoal: 2500,
          timeZone: "UTC",
          remindersEnabled: true,
          checkIns: ["10:00"],
        }),
      );
      await t.mutation(internal.coachCron.runUser, {
        userId: "alice",
        since: slotAt - 60_000,
        until: slotAt,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(
        await t.run((ctx) => ctx.db.query("coachSent").collect()),
      ).toHaveLength(past === 0 ? 1 : 0);
    },
  );

  it("keeps a pending page's window fixed when the next cron fires", async () => {
    const { t } = setup();
    const at = Date.parse("2026-10-15T03:01Z");
    const later = at + 15 * 60_000;
    vi.setSystemTime(at);
    await t.run(async (ctx) => {
      for (let i = 0; i < 205; i++)
        await ctx.db.insert("settings", {
          userId: `user-${i}`,
          waterGoal: 2500,
          timeZone,
          remindersEnabled: true,
          checkIns: ["10:00", "10:15"],
        });
    });
    await t.mutation(internal.coachCron.run, {});
    vi.setSystemTime(later);
    // Interleave a cron before the queued continuation. It must finish the old window.
    await t.mutation(internal.coachCron.run, {});
    expect(
      await t.run((ctx) => ctx.db.query("coachRuns").unique()),
    ).toMatchObject({ lastRunAt: at });
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const users = jobs.filter((job) => job.name === "coachCron:runUser");
    expect(users).toHaveLength(205);
    expect(users.every((job) => job.args[0].until === at)).toBe(true);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
    for (const slot of ["10:00", "10:15"])
      expect(sent.filter((row) => row.slot === slot)).toHaveLength(205);
    expect(new Set(sent.map((row) => `${row.userId}/${row.slot}`)).size).toBe(
      410,
    );
    expect(
      await t.run((ctx) => ctx.db.query("coachRuns").unique()),
    ).toMatchObject({ lastRunAt: later });
  });

  it("T3 caps a 1,500-row water day and runs the user's outage batch", async () => {
    const { t } = setup();
    const at = Date.parse("2026-10-15T20:30Z");
    vi.setSystemTime(at - 60_000);
    await t.run((ctx) =>
      ctx.db.insert("settings", {
        userId: "alice",
        waterGoal: 5000,
        timeZone: "UTC",
        remindersEnabled: true,
        checkIns: Array.from(
          { length: 24 },
          (_, hour) => `${String(hour).padStart(2, "0")}:00`,
        ),
      }),
    );
    for (let batch = 0; batch < 3; batch++)
      await t.run(async (ctx) => {
        for (let i = 0; i < 500; i++)
          await ctx.db.insert("water", {
            userId: "alice",
            amountMl: 1,
            at: at - 3_600_000 + batch * 500 + i,
          });
      });
    vi.setSystemTime(at);
    expect(
      (await t.run((ctx) => todayDataFor(ctx, "alice", at, "UTC"))).waterMl,
    ).toBe(COACH_WATER_LIMIT);
    await expect(
      t.mutation(internal.coachCron.runUser, {
        userId: "alice",
        since: at - 24 * 3_600_000,
        until: at,
      }),
    ).resolves.not.toThrow();
    const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      slot: "20:00",
      delivery: {
        payload: {
          kind: "water",
          body: `You have logged ${COACH_WATER_LIMIT} of 5000 ml today.`,
        },
      },
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
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
    "loads readiness for the latest fresh outage slot, including limit degradation (%s)",
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
      expect(load.mock.calls[0].slice(1)).toEqual([
        "alice",
        Date.parse("2026-10-15T06:59Z"),
        timeZone,
      ]);
      const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
      expect(sent).toHaveLength(1);
      expect(sent.map((row) => [row.userId, row.localDay, row.slot])).toEqual([
        ["alice", day, "13:59"],
      ]);
      expect(sent.every((row) => row.createdAt === at)).toBe(true);
      const deliveries = await t.run((ctx) =>
        ctx.db.query("pushDeliveries").collect(),
      );
      expect(deliveries).toHaveLength(1);
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
      ).toHaveLength(1);
      expect(
        await t.run((ctx) => ctx.db.query("pushDeliveries").collect()),
      ).toHaveLength(1);
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

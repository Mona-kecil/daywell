import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import type { Doc } from "../convex/_generated/dataModel";
import { addDays } from "../lib/cardio";
import { localClock } from "../lib/coach-time";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const NOW = Date.parse("2026-10-15T00:30Z");
const DAY = "2026-10-15";
const zone = "Asia/Jakarta";
const args = { now: NOW, timeZone: zone };
const fields = { day: DAY, count: 6150, timeZone: zone };
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
async function insert(
  ctx: MutationCtx,
  day: string,
  count: number,
  extra: Partial<Pick<Doc<"steps">, "userId" | "source" | "updatedAt">> = {},
) {
  return ctx.db.insert("steps", {
    userId: "alice",
    day,
    count,
    source: "manual",
    updatedAt: NOW - 60000,
    ...extra,
  });
}
async function shortcut(
  t: ReturnType<typeof setup>["t"],
  hash: string,
  body: string,
) {
  return t.mutation(internal.shortcuts.request, { hash, kind: "steps", body });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW - 60000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("step mutations", () => {
  it("requires auth for all public steps functions", async () => {
    const { t } = setup();
    await expect(t.mutation(api.steps.set, fields)).rejects.toThrow("Sign in");
    await expect(t.mutation(api.steps.remove, { day: DAY })).rejects.toThrow(
      "Sign in",
    );
    await expect(t.mutation(api.steps.setGoal, { goal: 8000 })).rejects.toThrow(
      "Sign in",
    );
    await expect(t.query(api.steps.week, args)).rejects.toThrow("Sign in");
  });
  it.each([
    [-1, null],
    [0, 0],
    [99999.6, 100000],
    [100000, 100000],
    [100000.4, 100000],
    [100000.6, null],
    [NaN, null],
    [Infinity, null],
  ])("validates and rounds count %s", async (count, expected) => {
    const { alice } = setup();
    const writing = alice.mutation(api.steps.set, { ...fields, count });
    if (expected === null) await expect(writing).rejects.toThrow("0–100,000");
    else {
      expect(await writing).toEqual({ day: DAY, steps: expected });
      expect((await alice.query(api.steps.week, args)).today.count).toBe(
        expected,
      );
    }
  });
  it.each(["2026-02-29", "2026-04-31", "2026-1-01", "", "2026-10-15T00:00Z"])(
    "rejects calendar day %s on set and remove",
    async (day) => {
      const { alice } = setup();
      await expect(
        alice.mutation(api.steps.set, { ...fields, day }),
      ).rejects.toThrow("valid YYYY-MM-DD");
      await expect(alice.mutation(api.steps.remove, { day })).rejects.toThrow(
        "valid YYYY-MM-DD",
      );
    },
  );
  it.each(["Asia/Jakarta", "America/Los_Angeles"])(
    "uses inclusive local-day bounds in %s on manual and shortcut writes",
    async (timeZone) => {
      const { t, alice } = setup();
      const today = localClock(Date.now(), timeZone).localDay;
      const token = await alice.mutation(api.shortcuts.createToken, {});
      const hash = createHash("sha256").update(token).digest("hex");
      for (const [offset, allowed] of [
        [1, true],
        [2, false],
        [-400, true],
        [-401, false],
      ] as const) {
        const day = addDays(today, offset);
        const writing = alice.mutation(api.steps.set, {
          day,
          count: 10,
          timeZone,
        });
        if (allowed) await expect(writing).resolves.toEqual({ day, steps: 10 });
        else
          await expect(writing).rejects.toThrow(
            "past 400 local days or tomorrow",
          );
        expect(
          (
            await shortcut(
              t,
              hash,
              JSON.stringify({ day, steps: 12, timeZone }),
            )
          ).status,
        ).toBe(allowed ? 200 : 400);
      }
    },
  );
  it("upserts one owned row, replaces cumulative counts and records the latest source", async () => {
    const { t, alice, bob } = setup();
    await alice.mutation(api.steps.set, fields);
    const initial = (await t.run((ctx) => ctx.db.query("steps").collect()))[0];
    expect(initial).toMatchObject({
      day: DAY,
      count: 6150,
      source: "manual",
      updatedAt: NOW - 60000,
    });
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const hash = createHash("sha256").update(token).digest("hex");
    vi.setSystemTime(NOW - 30000);
    await shortcut(t, hash, JSON.stringify({ steps: 7000.4, timeZone: zone }));
    const rows = await t.run((ctx) => ctx.db.query("steps").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: initial._id,
      count: 7000,
      source: "shortcut",
      updatedAt: NOW - 30000,
    });
    expect((await alice.query(api.steps.week, args)).lastSync).toBe(
      NOW - 30000,
    );
    await bob.mutation(api.steps.set, { ...fields, count: 99 });
    await bob.mutation(api.steps.remove, { day: DAY });
    expect((await alice.query(api.steps.week, args)).today.count).toBe(7000);
    await alice.mutation(api.steps.set, { ...fields, count: 20 });
    expect((await alice.query(api.steps.week, args)).lastSync).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(initial._id)))?.source).toBe(
      "manual",
    );
    await alice.mutation(api.steps.remove, { day: DAY });
    await alice.mutation(api.steps.remove, { day: DAY });
    expect((await alice.query(api.steps.week, args)).today.count).toBeNull();
  });
  it("sets and clears goals without initialization or overwriting other settings", async () => {
    const { t, alice, bob } = setup();
    await alice.mutation(api.steps.setGoal, { goal: null });
    expect((await alice.query(api.steps.week, args)).goal).toBe(8000);
    for (const goal of [1000, 9000, 50000]) {
      await alice.mutation(api.steps.setGoal, { goal });
      expect((await alice.query(api.steps.week, args)).goal).toBe(goal);
    }
    expect((await bob.query(api.steps.week, args)).goal).toBe(8000);
    const settings = (
      await t.run((ctx) => ctx.db.query("settings").collect())
    )[0];
    await t.run((ctx) =>
      ctx.db.patch(settings._id, { waterGoal: 3200, timeZone: zone }),
    );
    await alice.mutation(api.steps.setGoal, { goal: null });
    expect(await t.run((ctx) => ctx.db.get(settings._id))).toMatchObject({
      waterGoal: 3200,
      timeZone: zone,
    });
    expect(await t.run((ctx) => ctx.db.get(settings._id))).not.toHaveProperty(
      "stepGoal",
    );
    expect((await alice.query(api.steps.week, args)).goal).toBe(8000);
  });
  it.each([999, 50001, 8000.1, NaN, Infinity])(
    "rejects goal %s",
    async (goal) => {
      const { alice } = setup();
      await expect(alice.mutation(api.steps.setGoal, { goal })).rejects.toThrow(
        "integer from 1,000–50,000",
      );
    },
  );
  it("rejects invalid zones on writes and clocks on queries", async () => {
    const { alice } = setup();
    await expect(
      alice.mutation(api.steps.set, { ...fields, timeZone: "bad" }),
    ).rejects.toThrow("valid IANA");
    await expect(
      alice.query(api.steps.week, { ...args, timeZone: "bad" }),
    ).rejects.toThrow("valid IANA");
    for (const now of [-1, NaN, Infinity, 8640000000000001])
      await expect(
        alice.query(api.steps.week, { ...args, now }),
      ).rejects.toThrow("Invalid timestamp");
  });
});

describe("steps shortcut", () => {
  it("authenticates a real hash and returns JSON, validation and success responses", async () => {
    const { t, alice } = setup();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const hash = createHash("sha256").update(token).digest("hex");
    expect(await shortcut(t, "bad", "{}")).toEqual({
      status: 401,
      body: { error: "Invalid or missing token." },
    });
    expect(await shortcut(t, hash, "{")).toEqual({
      status: 400,
      body: { error: "Invalid JSON body." },
    });
    for (const body of [
      { steps: -1, timeZone: zone },
      { steps: 100000.6, timeZone: zone },
      { steps: 10 },
      { steps: 10, day: "2026-02-29" },
      { steps: 10, timeZone: "bad" },
      { steps: "10", day: DAY },
      { steps: 10, day: DAY, userId: "bob" },
    ]) {
      const response = await shortcut(t, hash, JSON.stringify(body));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: expect.any(String) });
    }
    for (const steps of [0, 99999.6, 100000, 100000.4])
      expect(
        await shortcut(t, hash, JSON.stringify({ steps, timeZone: zone })),
      ).toEqual({
        status: 200,
        body: { ok: true, day: DAY, steps: Math.round(steps) },
      });
    expect(
      await shortcut(t, hash, JSON.stringify({ steps: 1234.6, day: DAY })),
    ).toEqual({ status: 200, body: { ok: true, day: DAY, steps: 1235 } });
    expect(
      await shortcut(
        t,
        hash,
        JSON.stringify({ steps: 5000, timeZone: "America/Los_Angeles" }),
      ),
    ).toEqual({
      status: 200,
      body: { ok: true, day: "2026-10-14", steps: 5000 },
    });
  });
  it("serves the HTTP router with auth, status codes, method and size limits", async () => {
    const { t, alice } = setup();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    expect(
      (await t.fetch("/shortcuts/steps", { method: "POST", body: "{}" }))
        .status,
    ).toBe(401);
    expect(
      (
        await t.fetch("/shortcuts/steps", {
          method: "POST",
          headers: { Authorization: `Bearer dw_${"a".repeat(43)}` },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    for (const body of ["{", JSON.stringify({ steps: -1, day: DAY })])
      expect(
        (await t.fetch("/shortcuts/steps", { method: "POST", headers, body }))
          .status,
      ).toBe(400);
    const response = await t.fetch("/shortcuts/steps", {
      method: "POST",
      headers,
      body: JSON.stringify({ steps: 6150.6, timeZone: zone }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, day: DAY, steps: 6151 });
    expect(
      (await t.fetch("/shortcuts/steps", { method: "GET", headers })).status,
    ).toBe(405);
    expect(
      (
        await t.fetch("/shortcuts/steps", {
          method: "POST",
          headers,
          body: "x".repeat(4097),
        })
      ).status,
    ).toBe(413);
    await alice.mutation(api.shortcuts.revokeToken, {});
    expect(
      (
        await t.fetch("/shortcuts/steps", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(401);
  });
  it("shares the existing 60-per-hour rate limit with other kinds", async () => {
    const { t, alice } = setup();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const hash = createHash("sha256").update(token).digest("hex");
    const body = JSON.stringify({ steps: 100, timeZone: zone });
    for (let i = 0; i < 59; i++)
      expect((await shortcut(t, hash, body)).status).toBe(200);
    expect(
      (
        await t.mutation(internal.shortcuts.request, {
          hash,
          kind: "water",
          body: '{"amountMl":100}',
        })
      ).status,
    ).toBe(200);
    expect((await shortcut(t, hash, body)).status).toBe(429);
    vi.setSystemTime(NOW + 3600000);
    expect((await shortcut(t, hash, body)).status).toBe(200);
  });
});

describe("steps week", () => {
  it("returns the complete empty contract", async () => {
    const { alice } = setup();
    expect(await alice.query(api.steps.week, args)).toEqual({
      goal: 8000,
      today: { day: DAY, count: null },
      days: Array.from({ length: 7 }, (_, i) => ({
        day: addDays("2026-10-12", i),
        count: null,
      })),
      weekTotal: 0,
      daysAtGoal: 0,
      streak: 0,
      average28: null,
      best: null,
      lastSync: null,
    });
  });
  it.each([
    ["Asia/Jakarta", "2026-10-11T16:59:59Z", "2026-10-05"],
    ["Asia/Jakarta", "2026-10-11T17:00Z", "2026-10-12"],
    ["America/Los_Angeles", "2026-10-12T06:59:59Z", "2026-10-05"],
    ["America/Los_Angeles", "2026-10-12T07:00Z", "2026-10-12"],
    ["America/Los_Angeles", "2026-03-08T09:59Z", "2026-03-02"],
    ["America/Los_Angeles", "2026-03-08T10:00Z", "2026-03-02"],
    ["America/Los_Angeles", "2026-03-09T06:59:59Z", "2026-03-02"],
    ["America/Los_Angeles", "2026-03-09T07:00Z", "2026-03-09"],
    ["America/Los_Angeles", "2026-11-01T08:30Z", "2026-10-26"],
    ["America/Los_Angeles", "2026-11-01T09:30Z", "2026-10-26"],
    ["Asia/Jakarta", "2026-03-08T17:00Z", "2026-03-09"],
  ])("uses Monday in %s at %s", async (timeZone, at, monday) => {
    const now = Date.parse(at);
    vi.setSystemTime(now - 60000);
    const { t, alice } = setup();
    const today = localClock(now, timeZone).localDay;
    await t.run(async (ctx) => {
      for (let i = -1; i < 7; i++)
        await insert(ctx, addDays(monday, i), 1000, { updatedAt: now - 60000 });
    });
    const result = await alice.query(api.steps.week, { now, timeZone });
    expect(result.today).toEqual({ day: today, count: 1000 });
    expect(result.days.map((d) => d.day)).toEqual(
      Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
    );
    expect(result.weekTotal).toBe(7000);
  });
  it("computes totals, goal days, yesterday/today streaks and broken streaks", async () => {
    const { alice } = setup();
    for (const [offset, count] of [
      [0, 7000],
      [-1, 9000],
      [-2, 8000],
      [-3, 8100],
    ] as const)
      await alice.mutation(api.steps.set, {
        ...fields,
        day: addDays(DAY, offset),
        count,
      });
    expect(await alice.query(api.steps.week, args)).toMatchObject({
      weekTotal: 32100,
      daysAtGoal: 3,
      streak: 3,
      average28: 8367,
      best: { day: "2026-10-14", count: 9000 },
    });
    await alice.mutation(api.steps.set, { ...fields, count: 8000 });
    expect((await alice.query(api.steps.week, args)).streak).toBe(4);
    await alice.mutation(api.steps.remove, { day: "2026-10-14" });
    expect((await alice.query(api.steps.week, args)).streak).toBe(1);
    await alice.mutation(api.steps.set, { ...fields, count: 7000 });
    expect((await alice.query(api.steps.week, args)).streak).toBe(0);
  });
  it("requires three logged days for average28, including zero and the 28th prior date", async () => {
    const { alice } = setup();
    for (const [offset, count] of [
      [0, 50000],
      [-1, 0],
      [-2, 1000],
      [-29, 50000],
    ] as const)
      await alice.mutation(api.steps.set, {
        ...fields,
        day: addDays(DAY, offset),
        count,
      });
    expect((await alice.query(api.steps.week, args)).average28).toBeNull();
    await alice.mutation(api.steps.set, {
      ...fields,
      day: addDays(DAY, -28),
      count: 2001,
    });
    expect((await alice.query(api.steps.week, args)).average28).toBe(1000);
  });
  it("restricts best to the 365 days ending today and breaks ties by earliest day", async () => {
    const { alice } = setup();
    for (const [offset, count] of [
      [-365, 99999],
      [-364, 12000],
      [-10, 12000],
      [1, 100000],
    ] as const)
      await alice.mutation(api.steps.set, {
        ...fields,
        day: addDays(DAY, offset),
        count,
      });
    expect((await alice.query(api.steps.week, args)).best).toEqual({
      day: addDays(DAY, -364),
      count: 12000,
    });
  });
  it("finds the latest shortcut across old days, ignores manual and future rows, and isolates users", async () => {
    const { t, alice, bob } = setup();
    await t.run(async (ctx) => {
      await insert(ctx, addDays(DAY, -400), 9000, {
        source: "shortcut",
        updatedAt: NOW - 20000,
      });
      await insert(ctx, DAY, 7000, { updatedAt: NOW - 10000 });
      await insert(ctx, "2026-10-14", 9000, {
        userId: "bob",
        source: "shortcut",
        updatedAt: NOW - 1000,
      });
      await insert(ctx, "2026-10-13", 10000, {
        source: "shortcut",
        updatedAt: NOW + 1,
      });
    });
    vi.setSystemTime(NOW + 1);
    await t.run((ctx) =>
      insert(ctx, "2026-10-12", 10000, {
        source: "shortcut",
        updatedAt: NOW - 1,
      }),
    );
    const result = await alice.query(api.steps.week, args);
    expect(result.lastSync).toBe(NOW - 20000);
    expect(result.weekTotal).toBe(7000);
    expect(result.best).toEqual({ day: DAY, count: 7000 });
    expect((await bob.query(api.steps.week, args)).lastSync).toBe(NOW - 1000);
    expect((await bob.query(api.steps.week, args)).today.count).toBeNull();
  });
  it("throws on bounded-history overflow and ignores out-of-range and other-user rows", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 374; i++) {
        await insert(ctx, DAY, 1, { userId: "bob" });
        await insert(ctx, addDays(DAY, -500), 1);
      }
    });
    expect((await alice.query(api.steps.week, args)).weekTotal).toBe(0);
    await t.run(async (ctx) => {
      for (let i = 0; i < 374; i++) await insert(ctx, DAY, 1);
    });
    await expect(alice.query(api.steps.week, args)).rejects.toThrow(
      "History exceeds steps limits.",
    );
    await expect(alice.mutation(api.steps.set, fields)).rejects.toThrow(
      "History exceeds steps limits.",
    );
  });
});

describe("steps integrations", () => {
  it("loads recent local days into the coach, counts zero as data and excludes future creations", async () => {
    const { t, alice } = setup();
    const now = Date.parse("2026-10-15T10:00Z");
    await alice.mutation(api.steps.setGoal, { goal: 9000 });
    for (const [offset, count] of [
      [0, 7150],
      [-1, 0],
      [-6, 8000],
      [-7, 9000],
    ] as const)
      await alice.mutation(api.steps.set, {
        ...fields,
        day: addDays(DAY, offset),
        count,
      });
    const query = { now, timeZone: zone };
    expect(
      (await alice.query(api.coach.suggestions, query)).find(
        (s) => s.kind === "steps",
      )?.title,
    ).toBe("1,850 steps to your goal");
    await alice.mutation(api.steps.remove, { day: addDays(DAY, -6) });
    expect(
      (await alice.query(api.coach.suggestions, query)).some(
        (s) => s.kind === "steps",
      ),
    ).toBe(false);
    vi.setSystemTime(now + 1);
    await t.run((ctx) =>
      insert(ctx, addDays(DAY, -6), 8000, { updatedAt: now - 1 }),
    );
    expect(
      (await alice.query(api.coach.suggestions, query)).some(
        (s) => s.kind === "steps",
      ),
    ).toBe(false);
  });
  it("fails with a clear coach read-limit error on an eighth recent row", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 8; i++) await insert(ctx, DAY, 6150);
    });
    await expect(
      alice.query(api.coach.suggestions, { now: NOW, timeZone: zone }),
    ).rejects.toThrow("History exceeds steps limits.");
  });
  it("rejects duplicate settings instead of truncating them", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 2; i++)
        await ctx.db.insert("settings", { userId: "alice", waterGoal: 2500 });
    });
    await expect(alice.query(api.steps.week, args)).rejects.toThrow(
      "History exceeds steps limits.",
    );
    await expect(
      alice.mutation(api.steps.setGoal, { goal: 9000 }),
    ).rejects.toThrow("History exceeds steps limits.");
  });
  it("rejects export overflow without truncating owned history", async () => {
    const { t, alice } = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 10001; i++) await insert(ctx, DAY, 1);
    });
    await expect(alice.query(api.exportData.all, {})).rejects.toThrow(
      "History exceeds steps limits.",
    );
  });
  it("includes today's count and goal in readReply only when a count exists", async () => {
    const { t, alice } = setup();
    const id = await t.run((ctx) =>
      ctx.db.insert("coachMessages", {
        userId: "alice",
        role: "assistant",
        text: "",
        at: NOW - 10000,
        status: "pending",
      }),
    );
    const snapshot = async () => {
      vi.setSystemTime(Date.now() + 1000);
      const result = await t.query(internal.coachChat.readReply, {
        id,
        timeZone: zone,
      });
      if (result?.kind !== "ready") throw new Error("Missing chat snapshot");
      return result.input.snapshot;
    };
    expect((await snapshot()).today).not.toHaveProperty("steps");
    await alice.mutation(api.steps.set, { ...fields, count: 0 });
    expect((await snapshot()).today.steps).toEqual({ today: 0, goal: 8000 });
    await alice.mutation(api.steps.setGoal, { goal: 9000 });
    await alice.mutation(api.steps.set, fields);
    expect((await snapshot()).today.steps).toEqual({ today: 6150, goal: 9000 });
    await alice.mutation(api.steps.remove, { day: DAY });
    await alice.mutation(api.steps.set, { ...fields, day: addDays(DAY, -1) });
    expect((await snapshot()).today).not.toHaveProperty("steps");
  });
  it("exports owned steps and the saved goal without internal fields", async () => {
    const { alice, bob } = setup();
    await alice.mutation(api.steps.set, fields);
    await alice.mutation(api.steps.setGoal, { goal: 9000 });
    await bob.mutation(api.steps.set, { ...fields, count: 99 });
    const data = await alice.query(api.exportData.all, {});
    expect(data.settings?.stepGoal).toBe(9000);
    expect(data.steps).toEqual([
      {
        id: expect.any(String),
        day: DAY,
        count: 6150,
        source: "manual",
        updatedAt: NOW - 60000,
      },
    ]);
    expect(data.steps[0]).not.toHaveProperty("userId");
    expect(data.steps[0]).not.toHaveProperty("_creationTime");
    expect((await bob.query(api.exportData.all, {})).steps[0].count).toBe(99);
  });
  it("seeds 60 local dates with gaps, replaces steps on reset and preserves other users", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    vi.stubEnv("DEV_AUTH_JWKS", "configured");
    const { t, bob } = setup();
    const dev = t.withIdentity({ subject: DEV_USER, issuer: DEV_ISSUER });
    await dev.mutation(api.tracker.initialize, {});
    await dev.mutation(api.coach.setTimeZone, { timeZone: zone });
    await bob.mutation(api.steps.set, fields);
    const seed = {
      now: NOW,
      days: Array.from({ length: 14 }, (_, i) => NOW - i * 86400000),
      checkinDays: Array.from({ length: 90 }, (_, i) => addDays(DAY, -i)),
      meals: [],
    };
    await dev.mutation(internal.demo.replace, seed);
    const first = (await dev.query(api.exportData.all, {})).steps;
    expect(first.length).toBeGreaterThan(50);
    expect(first.length).toBeLessThan(60);
    expect(first[0].day).toBe(addDays(DAY, -59));
    expect(first.at(-1)?.day).toBe(DAY);
    expect(first.every((row) => row.count >= 4000 && row.count <= 12000)).toBe(
      true,
    );
    expect(first.some((row) => row.count >= 8000)).toBe(true);
    expect(new Set(first.map((row) => row.source))).toEqual(
      new Set(["manual", "shortcut"]),
    );
    await dev.mutation(api.steps.set, { ...fields, day: addDays(DAY, -100) });
    await dev.mutation(internal.demo.replace, seed);
    const second = (await dev.query(api.exportData.all, {})).steps;
    expect(
      second.map(({ day, count, source, updatedAt }) => ({
        day,
        count,
        source,
        updatedAt,
      })),
    ).toEqual(
      first.map(({ day, count, source, updatedAt }) => ({
        day,
        count,
        source,
        updatedAt,
      })),
    );
    expect((await bob.query(api.exportData.all, {})).steps).toHaveLength(1);
  });
  it.each([
    ["Asia/Jakarta", "2026-10-15T18:00Z", "2026-10-16"],
    ["America/Los_Angeles", "2026-10-15T00:30Z", "2026-10-14"],
  ])(
    "derives seed days in %s without explicit civil dates",
    async (timeZone, at, today) => {
      vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
      vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
      vi.stubEnv("DEV_AUTH_JWKS", "configured");
      const now = Date.parse(at);
      vi.setSystemTime(now - 60000);
      const { t } = setup();
      const dev = t.withIdentity({ subject: DEV_USER, issuer: DEV_ISSUER });
      await dev.mutation(api.tracker.initialize, {});
      await dev.mutation(api.coach.setTimeZone, { timeZone });
      await dev.mutation(internal.demo.replace, {
        now,
        days: Array.from({ length: 14 }, (_, i) => now - i * 86400000),
        meals: [],
      });
      const rows = (await dev.query(api.exportData.all, {})).steps;
      expect(rows[0].day).toBe(addDays(today, -59));
      expect(rows.at(-1)?.day).toBe(today);
      expect(rows.every((row) => row.updatedAt === now)).toBe(true);
    },
  );
});

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { convexSiteUrl } from "../lib/shortcuts";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.UTC(2026, 9, 14, 18);
const hour = 3_600_000;
const invalidToken = `dw_${"a".repeat(43)}`;
const unauthorized = { error: "Invalid or missing token." };
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function post(token: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe("shortcut tokens", () => {
  it("requires authentication for management and status", async () => {
    const { t } = setup();
    await expect(t.mutation(api.shortcuts.createToken, {})).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(t.mutation(api.shortcuts.revokeToken, {})).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(t.query(api.shortcuts.tokenStatus, {})).rejects.toThrow(
      "Sign in to continue.",
    );
  });

  it("stores only the hash and prefix, returns status, replaces and revokes", async () => {
    const { t, alice, bob } = setup();
    expect(await alice.query(api.shortcuts.tokenStatus, {})).toBeNull();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    expect(token).toMatch(/^dw_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token.slice(3), "base64url")).toHaveLength(32);
    const rows = await t.run((ctx) => ctx.db.query("shortcutTokens").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      _id: expect.any(String),
      _creationTime: expect.any(Number),
      userId: "alice",
      hash: createHash("sha256").update(token).digest("hex"),
      prefix: token.slice(3, 10),
      createdAt: now,
    });
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(await alice.query(api.shortcuts.tokenStatus, {})).toEqual({
      prefix: token.slice(3, 10),
      createdAt: now,
    });
    expect(await bob.query(api.shortcuts.tokenStatus, {})).toBeNull();
    const bobToken = await bob.mutation(api.shortcuts.createToken, {});
    const replacement = await alice.mutation(api.shortcuts.createToken, {});
    expect(replacement).not.toBe(token);
    const oldResponse = await t.fetch(
      "/shortcuts/water",
      post(token, { amountMl: 250 }),
    );
    expect(oldResponse.status).toBe(401);
    expect(await oldResponse.json()).toEqual(unauthorized);
    await alice.mutation(api.shortcuts.revokeToken, {});
    await alice.mutation(api.shortcuts.revokeToken, {});
    expect(await alice.query(api.shortcuts.tokenStatus, {})).toBeNull();
    expect((await bob.query(api.shortcuts.tokenStatus, {}))?.prefix).toBe(
      bobToken.slice(3, 10),
    );
    expect(
      await t.run((ctx) => ctx.db.query("shortcutTokens").collect()),
    ).toHaveLength(1);
  });

  it("updates lastUsedAt at most once per minute", async () => {
    const { t, alice } = setup();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const read = () =>
      t.fetch("/shortcuts/today?timeZone=UTC", { headers: auth(token) });
    expect((await read()).status).toBe(200);
    expect((await alice.query(api.shortcuts.tokenStatus, {}))?.lastUsedAt).toBe(
      now,
    );
    vi.setSystemTime(now + 59_999);
    await read();
    expect((await alice.query(api.shortcuts.tokenStatus, {}))?.lastUsedAt).toBe(
      now,
    );
    vi.setSystemTime(now + 60_000);
    await read();
    expect((await alice.query(api.shortcuts.tokenStatus, {}))?.lastUsedAt).toBe(
      now + 60_000,
    );
  });
});

describe("shortcut HTTP actions", () => {
  it("logs water with default and explicit timestamps and isolates users", async () => {
    const { t, alice, bob } = setup();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const response = await t.fetch(
      "/shortcuts/water",
      post(token, { amountMl: 300 }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const result = await response.json();
    expect(result).toEqual({ ok: true, id: expect.any(String) });
    expect(
      (
        await t.fetch(
          "/shortcuts/water",
          post(token, { amountMl: 500, at: now - hour }),
        )
      ).status,
    ).toBe(200);
    const range = { startMs: now - hour, endMs: now + hour };
    expect(
      (await alice.query(api.tracker.waterToday, range)).map((w) => ({
        at: w.at,
        amountMl: w.amountMl,
      })),
    ).toEqual([
      { at: now, amountMl: 300 },
      { at: now - hour, amountMl: 500 },
    ]);
    expect(await bob.query(api.tracker.waterToday, range)).toEqual([]);
    expect(
      (
        await t.fetch(
          "/shortcuts/water",
          post(token, { amountMl: 10, userId: "bob" }),
        )
      ).status,
    ).toBe(400);
  });

  it("creates and merges check-ins, supports null clearing, and derives the local day", async () => {
    const { t, alice, bob } = setup();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const first = await t.fetch(
      "/shortcuts/checkin",
      post(token, {
        timeZone: "Asia/Jakarta",
        weightKg: 70,
        sleepHours: 8,
        mood: 3,
        energy: 4,
        note: "Walked",
      }),
    );
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result).toEqual({ ok: true, id: expect.any(String) });
    const update = await t.fetch(
      "/shortcuts/checkin",
      post(token, {
        day: "2026-10-15",
        mood: 5,
        note: null,
      }),
    );
    expect(await update.json()).toEqual(result);
    expect(
      await alice.query(api.checkins.get, { day: "2026-10-15" }),
    ).toMatchObject({
      weightKg: 70,
      sleepHours: 8,
      mood: 5,
      energy: 4,
    });
    expect(
      await alice.query(api.checkins.get, { day: "2026-10-15" }),
    ).not.toHaveProperty("note");
    expect(await bob.query(api.checkins.get, { day: "2026-10-15" })).toBeNull();
    const explicit = await t.fetch(
      "/shortcuts/checkin",
      post(token, { day: "2026-10-01", note: "Earlier" }),
    );
    expect(explicit.status).toBe(200);
    expect(
      await alice.query(api.checkins.get, { day: "2026-10-01" }),
    ).toMatchObject({ note: "Earlier" });
  });

  it.each([
    ["/shortcuts/water", "POST"],
    ["/shortcuts/checkin", "POST"],
    ["/shortcuts/today?timeZone=UTC", "GET"],
  ])(
    "rejects missing, wrong, and revoked tokens on %s",
    async (path, method) => {
      const { t, alice } = setup();
      const token = await alice.mutation(api.shortcuts.createToken, {});
      await alice.mutation(api.shortcuts.revokeToken, {});
      for (const headers of [
        {},
        auth("invalid"),
        auth(invalidToken),
        auth(token),
      ]) {
        const response = await t.fetch(path, { method, headers });
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual(unauthorized);
      }
    },
  );

  it.each([
    ["/shortcuts/water", { amountMl: 0 }, "Water amount"],
    ["/shortcuts/water", { amountMl: 10001 }, "Water amount"],
    ["/shortcuts/water", { amountMl: 10, at: -1 }, "Invalid timestamp"],
    [
      "/shortcuts/water",
      { amountMl: 10, at: 8640000000000001 },
      "Invalid timestamp",
    ],
    ["/shortcuts/water", { amountMl: "10" }, "number"],
    ["/shortcuts/checkin", { day: "2026-10-14", mood: 6 }, "Mood must"],
    ["/shortcuts/checkin", { day: "2026-10-14", mood: 2.5 }, "Mood must"],
    ["/shortcuts/checkin", { day: "2026-10-14", energy: 0 }, "Energy must"],
    ["/shortcuts/checkin", { day: "2026-10-14", weightKg: 19 }, "Weight must"],
    ["/shortcuts/checkin", { day: "2026-10-14", sleepHours: 25 }, "Sleep must"],
    [
      "/shortcuts/checkin",
      { day: "2026-10-14", note: "x".repeat(281) },
      "280 characters",
    ],
    ["/shortcuts/checkin", { day: "2026-02-30" }, "YYYY-MM-DD"],
    ["/shortcuts/checkin", { timeZone: "invalid/zone" }, "IANA time zone"],
    [
      "/shortcuts/checkin",
      { day: "2026-10-14", timeZone: "invalid/zone" },
      "IANA time zone",
    ],
    ["/shortcuts/checkin", { mood: 3 }, "day or an IANA timeZone"],
  ])("returns 400 for invalid input to %s: %j", async (path, body, error) => {
    const { t, alice } = setup();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const response = await t.fetch(path, post(token, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.stringContaining(error),
    });
    expect(await t.run((ctx) => ctx.db.query("water").collect())).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("bodyCheckins").collect()),
    ).toEqual([]);
  });

  it.each(["{", "null", "[]"])(
    "rejects malformed or non-object JSON: %s",
    async (body) => {
      const { t, alice } = setup();
      const token = await alice.mutation(api.shortcuts.createToken, {});
      for (const path of ["/shortcuts/water", "/shortcuts/checkin"]) {
        const response = await t.fetch(path, {
          method: "POST",
          headers: auth(token),
          body,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: expect.any(String) });
      }
    },
  );

  it.each(["", "?timeZone=invalid/zone", "?timeZone="])(
    "validates today's time zone: %s",
    async (query) => {
      const { t, alice } = setup();
      const token = await alice.mutation(api.shortcuts.createToken, {});
      const response = await t.fetch(`/shortcuts/today${query}`, {
        headers: auth(token),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    },
  );

  it.each([
    ["/shortcuts/water", "GET", "POST"],
    ["/shortcuts/water", "PUT", "POST"],
    ["/shortcuts/checkin", "DELETE", "POST"],
    ["/shortcuts/checkin", "OPTIONS", "POST"],
    ["/shortcuts/today", "POST", "GET"],
    ["/shortcuts/today", "PATCH", "GET"],
  ])("returns JSON 405 for %s %s", async (path, method, allow) => {
    const { t } = setup();
    const response = await t.fetch(path, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(allow);
    expect(await response.json()).toEqual({ error: "Method not allowed." });
  });

  it("shares a rolling 60-request user limit across routes and token rotation", async () => {
    const { t, alice, bob } = setup();
    let token = await alice.mutation(api.shortcuts.createToken, {});
    const bobToken = await bob.mutation(api.shortcuts.createToken, {});
    for (let i = 0; i < 60; i++) {
      const response =
        i % 3 === 0
          ? await t.fetch("/shortcuts/water", post(token, { amountMl: 1 }))
          : i % 3 === 1
            ? await t.fetch(
                "/shortcuts/checkin",
                post(token, { day: "2026-10-14", mood: 3 }),
              )
            : await t.fetch("/shortcuts/today?timeZone=UTC", {
                headers: auth(token),
              });
      expect(response.status).toBe(200);
    }
    const blocked = await t.fetch(
      "/shortcuts/water",
      post(token, { amountMl: 1 }),
    );
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({
      error: expect.stringContaining("60 requests per hour"),
    });
    await alice.mutation(api.shortcuts.revokeToken, {});
    token = await alice.mutation(api.shortcuts.createToken, {});
    expect(
      (await t.fetch("/shortcuts/today?timeZone=UTC", { headers: auth(token) }))
        .status,
    ).toBe(429);
    expect(
      (await t.fetch("/shortcuts/water", post(bobToken, { amountMl: 1 })))
        .status,
    ).toBe(200);
    vi.setSystemTime(now + hour);
    expect(
      (await t.fetch("/shortcuts/water", post(token, { amountMl: 1 }))).status,
    ).toBe(200);
    const limit = await t.run((ctx) =>
      ctx.db
        .query("shortcutLimits")
        .withIndex("by_user", (q) => q.eq("userId", "alice"))
        .unique(),
    );
    expect(limit?.requestedAt).toEqual([now + hour]);
    expect(await t.run((ctx) => ctx.db.query("water").collect())).toHaveLength(
      22,
    );
  });

  it("counts authenticated invalid requests toward the quota", async () => {
    const { t, alice } = setup();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    for (let i = 0; i < 60; i++)
      expect(
        (await t.fetch("/shortcuts/water", post(token, { amountMl: 0 })))
          .status,
      ).toBe(400);
    expect(
      (await t.fetch("/shortcuts/water", post(token, { amountMl: 1 }))).status,
    ).toBe(429);
  });

  it("returns today's water, ready-meal nutrients, meal count and recovery for the token owner", async () => {
    const { t, alice, bob } = setup();
    await alice.mutation(api.tracker.initialize, {});
    await bob.mutation(api.tracker.initialize, {});
    await alice.mutation(api.tracker.setWaterGoal, { goal: 3000 });
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const overview = await alice.query(api.tracker.overview, {});
    const chest = overview.muscles.find((m) => m.name === "chest");
    const back = overview.muscles.find((m) => m.name === "back");
    if (!chest || !back) throw new Error("Missing muscles");
    await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [chest._id],
      trainedAt: now - hour,
      note: "",
    });
    await alice.mutation(api.tracker.addWorkout, {
      muscleIds: [back._id],
      trainedAt: now - 72 * hour,
      note: "",
    });
    await t.run(async (ctx) => {
      for (const [userId, amountMl, at] of [
        ["alice", 200, now],
        ["alice", 300, now - 2 * hour],
        ["alice", 900, now - 18 * hour],
        ["alice", 800, now + 1],
        ["bob", 9999, now],
      ] satisfies [string, number, number][])
        await ctx.db.insert("water", { userId, amountMl, at });
      const meal = {
        userId: "alice",
        at: now,
        description: "Rice",
        revision: 0,
        items: [
          {
            id: "rice",
            name: "Rice",
            grams: 150,
            searchQuery: "rice",
            status: "matched" as const,
            foodDescription: "Rice",
            per100g: { kcal: 200.3, protein: 10.3, fat: 2, carbs: 30 },
          },
        ],
      };
      await ctx.db.insert("meals", { ...meal, analysis: { status: "ready" } });
      await ctx.db.insert("meals", {
        ...meal,
        analysis: { status: "analyzing", startedAt: now },
      });
      await ctx.db.insert("meals", {
        ...meal,
        at: now - 18 * hour,
        analysis: { status: "ready" },
      });
      await ctx.db.insert("meals", {
        ...meal,
        at: now + 1,
        analysis: { status: "ready" },
      });
      await ctx.db.insert("meals", {
        ...meal,
        userId: "bob",
        analysis: { status: "ready" },
      });
    });
    const response = await t.fetch("/shortcuts/today?timeZone=Asia%2FJakarta", {
      headers: auth(token),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      day: "2026-10-15",
      waterMl: 200,
      waterGoalMl: 3000,
      kcal: 300,
      proteinG: 15,
      mealsLogged: 2,
      readyMuscles: overview.muscles
        .filter((m) => m.name !== "chest")
        .map((m) => m.name),
    });
  });

  it("returns defaults before initialization and includes a whole DST fold day", async () => {
    const { t, alice } = setup();
    const token = await alice.mutation(api.shortcuts.createToken, {});
    const read = () =>
      t.fetch("/shortcuts/today?timeZone=America%2FNew_York", {
        headers: auth(token),
      });
    expect(await (await read()).json()).toEqual({
      day: "2026-10-14",
      waterMl: 0,
      waterGoalMl: 2500,
      kcal: 0,
      proteinG: 0,
      mealsLogged: 0,
      readyMuscles: [],
    });
    vi.setSystemTime(Date.parse("2026-11-02T04:30:00Z"));
    await alice.mutation(api.tracker.addWater, {
      amountMl: 500,
      at: Date.parse("2026-11-01T04:30:00Z"),
    });
    expect(await (await read()).json()).toMatchObject({
      day: "2026-11-01",
      waterMl: 500,
    });
  });
});

describe("convexSiteUrl", () => {
  it.each([
    ["https://example.convex.cloud", "https://example.convex.site"],
    ["https://example.convex.cloud/", "https://example.convex.site"],
    ["http://127.0.0.1:3210", "http://127.0.0.1:3211"],
    ["http://localhost:3210", "http://localhost:3211"],
    ["http://127.0.0.1:4000", "http://127.0.0.1:4001"],
    ["http://127.0.0.1:65535", "http://127.0.0.1:65535"],
    ["https://example.convex.site", "https://example.convex.site"],
    ["https://other.example/", "https://other.example/"],
    [
      "https://example.convex.cloud.evil.example",
      "https://example.convex.cloud.evil.example",
    ],
    ["http://example.convex.cloud", "http://example.convex.cloud"],
  ])("maps %s to %s", (input, expected) => {
    expect(convexSiteUrl(input)).toBe(expected);
  });
  it("throws for an invalid URL", () => {
    expect(() => convexSiteUrl("not a url")).toThrow(TypeError);
  });
});

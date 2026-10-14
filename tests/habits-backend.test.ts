import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const NOW = Date.UTC(2026, 9, 14, 23, 59);
const today = "2026-10-14";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function setup() {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

async function create(alice: ReturnType<typeof setup>["alice"], name = "Read") {
  return alice.mutation(api.habits.create, { name, icon: "book" });
}

describe("habits backend", () => {
  it("requires auth for the query and every mutation", async () => {
    const { t, alice } = setup();
    const id = await create(alice);
    const calls = [
      () => t.query(api.habits.list, { today }),
      () => t.mutation(api.habits.create, { name: "Read", icon: "book" }),
      () => t.mutation(api.habits.update, { id, name: "Book" }),
      () => t.mutation(api.habits.archive, { id }),
      () => t.mutation(api.habits.move, { id, direction: "up" }),
      () => t.mutation(api.habits.toggle, { id, day: today }),
    ];
    for (const call of calls)
      await expect(call()).rejects.toThrow("Sign in to continue.");
  });

  it("isolates creation, queries, and every id-based mutation between owners", async () => {
    const { t, alice, bob } = setup();
    const aliceId = await create(alice);
    const bobId = await create(bob);
    await alice.mutation(api.habits.toggle, { id: aliceId, day: today });
    for (const [caller, foreignId, ownId] of [
      [alice, bobId, aliceId],
      [bob, aliceId, bobId],
    ] satisfies [typeof alice, Id<"habits">, Id<"habits">][]) {
      expect(
        (await caller.query(api.habits.list, { today })).map((h) => h.id),
      ).toEqual([ownId]);
      const calls = [
        () =>
          caller.mutation(api.habits.update, {
            id: foreignId,
            name: "Changed",
          }),
        () => caller.mutation(api.habits.archive, { id: foreignId }),
        () =>
          caller.mutation(api.habits.move, {
            id: foreignId,
            direction: "down",
          }),
        () => caller.mutation(api.habits.toggle, { id: foreignId, day: today }),
      ];
      for (const call of calls)
        await expect(call()).rejects.toThrow("Habit not found.");
    }
    expect((await bob.query(api.habits.list, { today }))[0].doneToday).toBe(
      false,
    );
    expect(await t.run((ctx) => ctx.db.get(aliceId))).toMatchObject({
      userId: "alice",
      name: "Read",
    });
    await t.run((ctx) => ctx.db.delete(bobId));
    for (const call of [
      () => bob.mutation(api.habits.update, { id: bobId }),
      () => bob.mutation(api.habits.archive, { id: bobId }),
      () => bob.mutation(api.habits.move, { id: bobId, direction: "up" }),
      () => bob.mutation(api.habits.toggle, { id: bobId, day: today }),
    ])
      await expect(call()).rejects.toThrow("Habit not found.");
  });

  it("cleans names on create and update and accepts boundary lengths", async () => {
    const { t, alice } = setup();
    const id = await create(alice, " \t Read \n 10 min ");
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      name: "Read 10 min",
      icon: "book",
      createdAt: NOW,
    });
    await alice.mutation(api.habits.update, {
      id,
      name: ` ${"a".repeat(40)} `,
      icon: "leaf",
    });
    await alice.mutation(api.habits.update, { id });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      name: "a".repeat(40),
      icon: "leaf",
    });
    await create(alice, "a");
  });

  it.each(["", " \t\n ", "a".repeat(41)])(
    "rejects invalid name %j on create and update",
    async (name) => {
      const { alice } = setup();
      const id = await create(alice);
      await expect(create(alice, name)).rejects.toBeInstanceOf(ConvexError);
      await expect(
        alice.mutation(api.habits.update, { id, name }),
      ).rejects.toBeInstanceOf(ConvexError);
    },
  );

  it.each(["", "coffee", "Book"])(
    "rejects invalid icon %j on create and update",
    async (icon) => {
      const { alice } = setup();
      const id = await create(alice);
      const createRef = makeFunctionReference<
        "mutation",
        { name: string; icon: string }
      >("habits:create");
      const updateRef = makeFunctionReference<
        "mutation",
        { id: Id<"habits">; icon: string }
      >("habits:update");
      await expect(
        alice.mutation(createRef, { name: "Walk", icon }),
      ).rejects.toThrow();
      await expect(alice.mutation(updateRef, { id, icon })).rejects.toThrow();
    },
  );

  it("accepts every supported icon", async () => {
    const { alice } = setup();
    const icons = [
      "pill",
      "stretch",
      "book",
      "sun",
      "leaf",
      "heart",
      "moon",
      "check",
    ] as const;
    for (const icon of icons)
      await alice.mutation(api.habits.create, { name: icon, icon });
    expect(
      (await alice.query(api.habits.list, { today })).map((h) => h.icon),
    ).toEqual(icons);
  });

  it("rejects active duplicates after cleaning and case folding, but permits self-renames", async () => {
    const { alice } = setup();
    const first = await create(alice, "Read a book");
    const second = await create(alice, "Stretch");
    await expect(create(alice, "  READ \t a book ")).rejects.toThrow(
      "already exists",
    );
    await expect(
      alice.mutation(api.habits.update, { id: second, name: "read A book" }),
    ).rejects.toThrow("already exists");
    await alice.mutation(api.habits.update, {
      id: first,
      name: " READ A BOOK ",
    });
    await alice.mutation(api.habits.archive, { id: first });
    await alice.mutation(api.habits.update, {
      id: second,
      name: "read a book",
    });
    await alice.mutation(api.habits.archive, { id: second });
    await create(alice, "Read a book");
  });

  it("caps each owner at twelve active habits and archiving frees a slot without deleting logs", async () => {
    const { t, alice, bob } = setup();
    const ids: Id<"habits">[] = [];
    for (let i = 0; i < 12; i++) ids.push(await create(alice, `Habit ${i}`));
    await expect(create(alice, "Thirteenth")).rejects.toThrow("12");
    await create(bob);
    await alice.mutation(api.habits.toggle, { id: ids[0], day: today });
    await alice.mutation(api.habits.archive, { id: ids[0] });
    await alice.mutation(api.habits.archive, { id: ids[0] });
    expect(await t.run((ctx) => ctx.db.get(ids[0]))).toMatchObject({
      archivedAt: NOW,
    });
    expect(
      await t.run((ctx) => ctx.db.query("habitLogs").collect()),
    ).toHaveLength(1);
    const last = await create(alice, "Habit 0");
    expect(
      (await alice.query(api.habits.list, { today })).map((h) => h.id),
    ).toEqual([...ids.slice(1), last]);
  });

  it("swaps active neighbours and leaves both ends unchanged", async () => {
    const { alice } = setup();
    const a = await create(alice, "A"),
      b = await create(alice, "B"),
      c = await create(alice, "C");
    const order = async () =>
      (await alice.query(api.habits.list, { today })).map((h) => h.id);
    await alice.mutation(api.habits.move, { id: a, direction: "up" });
    await alice.mutation(api.habits.move, { id: c, direction: "down" });
    expect(await order()).toEqual([a, b, c]);
    await alice.mutation(api.habits.move, { id: b, direction: "up" });
    expect(await order()).toEqual([b, a, c]);
    await alice.mutation(api.habits.move, { id: b, direction: "down" });
    await alice.mutation(api.habits.archive, { id: b });
    await alice.mutation(api.habits.move, { id: c, direction: "up" });
    expect(await order()).toEqual([c, a]);
  });

  it("toggles on and off without duplicate logs and preserves other habits and days", async () => {
    const { t, alice } = setup();
    const id = await create(alice),
      other = await create(alice, "Walk");
    await alice.mutation(api.habits.toggle, { id: other, day: today });
    await alice.mutation(api.habits.toggle, { id, day: "2026-10-13" });
    for (const done of [true, false, true, false, true]) {
      expect(await alice.mutation(api.habits.toggle, { id, day: today })).toBe(
        done,
      );
      expect((await alice.query(api.habits.list, { today }))[0].doneToday).toBe(
        done,
      );
      const logs = await t.run((ctx) => ctx.db.query("habitLogs").collect());
      expect(
        logs.filter((log) => log.habitId === id && log.day === today),
      ).toHaveLength(done ? 1 : 0);
      expect(logs).toHaveLength(done ? 3 : 2);
    }
  });

  it.each(["2025-09-09", "2026-10-15"])(
    "accepts inclusive UTC date window boundary %s",
    async (day) => {
      const { alice } = setup();
      const id = await create(alice);
      expect(await alice.mutation(api.habits.toggle, { id, day })).toBe(true);
    },
  );

  it.each([
    "2025-09-08",
    "2026-10-16",
    "2026-02-29",
    "2026-04-31",
    "2026-1-01",
    "2026-10-14T00:00:00Z",
    "",
  ])("rejects out-of-window or invalid toggle day %j", async (day) => {
    const { alice } = setup();
    const id = await create(alice);
    await expect(
      alice.mutation(api.habits.toggle, { id, day }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  it("bases the window on the UTC date at both ends of the server day", async () => {
    const { alice } = setup();
    vi.mocked(Date.now).mockReturnValue(Date.UTC(2026, 9, 14, 0, 1));
    const id = await create(alice);
    expect(
      await alice.mutation(api.habits.toggle, { id, day: "2025-09-09" }),
    ).toBe(true);
    expect(
      await alice.mutation(api.habits.toggle, { id, day: "2026-10-15" }),
    ).toBe(true);
    await expect(
      alice.mutation(api.habits.toggle, { id, day: "2026-10-16" }),
    ).rejects.toThrow();
  });

  it("rejects toggling archived habits", async () => {
    const { alice } = setup();
    const id = await create(alice);
    await alice.mutation(api.habits.archive, { id });
    await expect(
      alice.mutation(api.habits.toggle, { id, day: today }),
    ).rejects.toThrow("archived");
  });

  it.each(["2026-02-29", "2026-04-31", "2026-1-01", ""])(
    "rejects invalid list day %j with ConvexError",
    async (today) => {
      const { alice } = setup();
      await expect(
        alice.query(api.habits.list, { today }),
      ).rejects.toBeInstanceOf(ConvexError);
    },
  );

  it("returns last7, an alive-yesterday streak, and best clipped to the last 400 days", async () => {
    const { t, alice, bob } = setup();
    const id = await create(alice),
      empty = await create(alice, "Empty");
    await create(bob);
    await t.run(async (ctx) => {
      for (const day of [
        "2025-08-20",
        "2025-08-21",
        "2025-08-22",
        "2025-08-23",
        "2025-08-24",
        "2025-09-08",
        "2025-09-09",
        "2025-09-10",
        "2025-09-11",
        "2026-10-08",
        "2026-10-10",
        "2026-10-12",
        "2026-10-13",
        "2026-10-15",
      ])
        await ctx.db.insert("habitLogs", { userId: "alice", habitId: id, day });
      await ctx.db.insert("habitLogs", {
        userId: "bob",
        habitId: id,
        day: today,
      });
    });
    expect(await alice.query(api.habits.list, { today })).toEqual([
      {
        id,
        name: "Read",
        icon: "book",
        doneToday: false,
        streak: 2,
        last7: [true, false, true, false, true, true, false],
        best: 2,
      },
      {
        id: empty,
        name: "Empty",
        icon: "book",
        doneToday: false,
        streak: 0,
        last7: [false, false, false, false, false, false, false],
        best: 0,
      },
    ]);
    await alice.mutation(api.habits.toggle, { id, day: today });
    expect((await alice.query(api.habits.list, { today }))[0]).toMatchObject({
      doneToday: true,
      streak: 3,
      best: 3,
    });
    await t.run(async (ctx) => {
      for (const day of [
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
        "2026-09-04",
      ])
        await ctx.db.insert("habitLogs", { userId: "alice", habitId: id, day });
    });
    expect((await alice.query(api.habits.list, { today }))[0].best).toBe(4);
  });

  it("keeps a current streak longer than the 400-day best window", async () => {
    const { t, alice } = setup();
    const id = await create(alice);
    await t.run(async (ctx) => {
      for (let offset = 0; offset < 405; offset++) {
        const day = new Date(Date.UTC(2026, 9, 14 - offset))
          .toISOString()
          .slice(0, 10);
        await ctx.db.insert("habitLogs", { userId: "alice", habitId: id, day });
      }
    });
    expect((await alice.query(api.habits.list, { today }))[0]).toMatchObject({
      streak: 405,
      best: 400,
    });
  });

  it("exports only owned habits and logs, including archives, without account metadata", async () => {
    const { t, alice, bob } = setup();
    const id = await create(alice);
    await alice.mutation(api.habits.toggle, { id, day: today });
    await alice.mutation(api.habits.archive, { id });
    const other = await create(bob);
    await bob.mutation(api.habits.toggle, { id: other, day: today });
    const logs = await t.run((ctx) => ctx.db.query("habitLogs").collect());
    const log = logs.find((row) => row.habitId === id);
    expect(log).toBeDefined();
    const exported = await alice.query(api.exportData.all, {});
    expect(exported.habits).toEqual([
      {
        id,
        name: "Read",
        icon: "book",
        order: 0,
        createdAt: NOW,
        archivedAt: NOW,
      },
    ]);
    expect(exported.habitLogs).toEqual([
      { id: log?._id, habitId: id, day: today },
    ]);
    expect((await bob.query(api.exportData.all, {})).habits).toEqual([
      {
        id: other,
        name: "Read",
        icon: "book",
        order: 0,
        createdAt: NOW,
        archivedAt: null,
      },
    ]);
  });

  it("replaces demo habits and logs with three seeded habits, preserving other owners", async () => {
    const { t, alice } = setup();
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    vi.stubEnv("DEV_AUTH_JWKS", "test-jwks");
    const demo = t.withIdentity({ subject: DEV_USER, issuer: DEV_ISSUER });
    const old = await create(demo, "Old demo");
    await demo.mutation(api.habits.toggle, { id: old, day: today });
    const own = await create(alice);
    await alice.mutation(api.habits.toggle, { id: own, day: today });
    const args = {
      now: NOW,
      days: Array.from({ length: 14 }, (_, i) => Date.UTC(2026, 9, 14 - i)),
      meals: [],
    };
    for (let i = 0; i < 2; i++) {
      await demo.mutation(internal.demo.replace, args);
      expect(await t.run((ctx) => ctx.db.get(old))).toBeNull();
      const exported = await demo.query(api.exportData.all, {});
      expect(exported.habits.map((h) => h.name)).toEqual([
        "Vitamins",
        "Stretch 10 min",
        "Read",
      ]);
      expect(exported.habitLogs.length).toBeGreaterThan(40);
      expect(
        new Set(exported.habitLogs.map((log) => `${log.habitId}:${log.day}`))
          .size,
      ).toBe(exported.habitLogs.length);
      expect(
        exported.habitLogs.every((log) =>
          exported.habits.some((h) => h.id === log.habitId),
        ),
      ).toBe(true);
      expect(
        (await alice.query(api.exportData.all, {})).habitLogs,
      ).toHaveLength(1);
    }
  });
});

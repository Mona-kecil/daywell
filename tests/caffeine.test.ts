import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import {
  ABSORB_MIN,
  CAFFEINE_PRESETS,
  DAILY_LIMIT_MG,
  HALF_LIFE_H,
  SLEEP_READY_MG,
  caffeineAt,
  caffeineCurve,
  dayTotal,
  peakAfter,
  sleepReadyAt,
} from "../lib/caffeine";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 9, 14, 12);
const modules = import.meta.glob("../convex/**/*.{ts,js}");
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

describe("caffeine model", () => {
  it("defines the constants and typical serving presets", () => {
    expect([HALF_LIFE_H, SLEEP_READY_MG, DAILY_LIMIT_MG, ABSORB_MIN]).toEqual([
      5, 50, 400, 45,
    ]);
    expect(CAFFEINE_PRESETS).toEqual([
      { id: "espresso", name: "Espresso", mg: 63, serving: "1 shot · 30 ml" },
      {
        id: "coffee",
        name: "Brewed coffee",
        mg: 95,
        serving: "1 cup · 240 ml",
      },
      {
        id: "cold-brew",
        name: "Cold brew",
        mg: 155,
        serving: "1 cup · 240 ml",
      },
      { id: "black-tea", name: "Black tea", mg: 47, serving: "1 cup · 240 ml" },
      { id: "green-tea", name: "Green tea", mg: 28, serving: "1 cup · 240 ml" },
      { id: "cola", name: "Cola", mg: 34, serving: "1 can · 355 ml" },
      { id: "energy", name: "Energy drink", mg: 80, serving: "1 can · 250 ml" },
    ]);
  });

  it("halves an absorbed dose over five hours and accepts a custom half-life", () => {
    const doses = [{ at: 0, mg: 100 }];
    const absorbed = 45 * MINUTE;
    expect(caffeineAt(doses, absorbed + 5 * HOUR)).toBeCloseTo(
      caffeineAt(doses, absorbed) / 2,
      12,
    );
    expect(caffeineAt(doses, 10 * HOUR, 10)).toBe(50);
    expect(caffeineAt([], NOW)).toBe(0);
  });

  it("ramps absorption before applying decay and ignores future doses", () => {
    const doses = [
      { at: 0, mg: 100 },
      { at: HOUR, mg: 200 },
    ];
    expect(caffeineAt(doses, 0)).toBe(0);
    expect(caffeineAt(doses, 22.5 * MINUTE)).toBeCloseTo(
      50 * 0.5 ** (22.5 / 300),
      12,
    );
    expect(caffeineAt(doses, 45 * MINUTE)).toBeCloseTo(
      100 * 0.5 ** (45 / 300),
      12,
    );
    expect(caffeineAt(doses, -1)).toBe(0);
  });

  it("includes curve endpoints with a short final step and a zero-length range", () => {
    const doses = [{ at: 0, mg: 100 }];
    const curve = caffeineCurve(doses, MINUTE, 6 * MINUTE, 2);
    expect(curve.map(({ t }) => t)).toEqual([
      MINUTE,
      3 * MINUTE,
      5 * MINUTE,
      6 * MINUTE,
    ]);
    expect(curve.map(({ t, mg }) => mg === caffeineAt(doses, t))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(caffeineCurve(doses, MINUTE, MINUTE, 1)).toEqual([
      { t: MINUTE, mg: caffeineAt(doses, MINUTE) },
    ]);
    expect(caffeineCurve([], 0, 4 * MINUTE, 2).map(({ t }) => t)).toEqual([
      0,
      2 * MINUTE,
      4 * MINUTE,
    ]);
  });

  it.each([0, -1, NaN, Infinity])("rejects curve step %s", (step) => {
    expect(() => caffeineCurve([], 0, HOUR, step)).toThrow("positive step");
  });

  it("rejects reversed or non-finite ranges and caps curves at 1,000 points", () => {
    expect(() => caffeineCurve([], HOUR, 0, 1)).toThrow("valid time range");
    expect(() => caffeineCurve([], 0, Infinity, 1)).toThrow("valid time range");
    expect(caffeineCurve([], 0, 999 * MINUTE, 1)).toHaveLength(1000);
    expect(() => caffeineCurve([], 0, 999 * MINUTE + 1, 1)).toThrow(
      "1,000 points",
    );
    expect(() => caffeineCurve([], 0, 1000 * MINUTE, 1)).toThrow(
      "1,000 points",
    );
  });

  it("returns now with no doses or when every later peak stays below the threshold", () => {
    expect(sleepReadyAt([], NOW)).toBe(NOW);
    expect(sleepReadyAt([{ at: NOW, mg: 40 }], NOW)).toBe(NOW);
    expect(sleepReadyAt([{ at: 0, mg: 100 }], 6 * HOUR)).toBe(6 * HOUR);
    expect(sleepReadyAt([{ at: NOW + HOUR, mg: 40 }], NOW)).toBe(NOW);
  });

  it("finds the final crossing of a single dose with exact minute rounding", () => {
    expect(sleepReadyAt([{ at: 0, mg: 100 }], HOUR)).toBe(5 * HOUR);
    const doses = [{ at: NOW + 1, mg: 100 }];
    const ready = sleepReadyAt(doses, NOW);
    expect(ready).toBe(NOW + 5 * HOUR + MINUTE);
    if (ready === null) throw new Error("Expected a ready time");
    expect(caffeineAt(doses, ready)).toBeLessThanOrEqual(50);
    expect(caffeineAt(doses, ready - MINUTE)).toBeGreaterThan(50);
    expect(sleepReadyAt([{ at: 0, mg: 100 }], HOUR, 25)).toBe(10 * HOUR);
  });

  it("sums stacked doses before finding their final crossing", () => {
    const doses = [
      { at: 0, mg: 100 },
      { at: HOUR, mg: 100 },
    ];
    const crossing = 5 * HOUR * Math.log2((100 + 100 * 2 ** (1 / 5)) / 50);
    expect(sleepReadyAt(doses, 2 * HOUR)).toBe(
      Math.ceil(crossing / MINUTE) * MINUTE,
    );
  });

  it("waits for an absorbing dose to peak even when its current level is low", () => {
    const doses = [{ at: NOW, mg: 100 }];
    expect(caffeineAt(doses, NOW + MINUTE)).toBeLessThan(50);
    expect(sleepReadyAt(doses, NOW + MINUTE)).toBe(NOW + 5 * HOUR);
    expect(sleepReadyAt([{ at: NOW + HOUR, mg: 100 }], NOW)).toBe(
      NOW + 6 * HOUR,
    );
  });

  it("uses the last crossing when future doses create another peak", () => {
    const doses = [
      { at: 0, mg: 100 },
      { at: 12 * HOUR, mg: 100 },
    ];
    const ready = sleepReadyAt(doses, HOUR);
    expect(ready).toBeGreaterThan(17 * HOUR);
    if (ready === null) throw new Error("Expected a ready time");
    expect(caffeineAt(doses, ready)).toBeLessThanOrEqual(50);
    expect(caffeineAt(doses, ready - MINUTE)).toBeGreaterThan(50);
  });

  it("returns null when the final crossing exceeds 48 hours", () => {
    const doses = Array.from({ length: 100 }, () => ({ at: NOW, mg: 1e6 }));
    expect(sleepReadyAt(doses, NOW)).toBeNull();
    expect(sleepReadyAt([{ at: NOW + 49 * HOUR, mg: 100 }], NOW)).toBeNull();
    expect(sleepReadyAt([{ at: NOW, mg: 100 }], NOW, 0)).toBeNull();
  });

  it("accepts a crossing at the 48-hour deadline", () => {
    const doses = [{ at: 0, mg: 100 }];
    expect(sleepReadyAt(doses, 0, caffeineAt(doses, 48 * HOUR))).toBe(
      48 * HOUR,
    );
  });

  it("rounds a crossing within 48 hours even when the deadline is between minutes", () => {
    const doses = [{ at: NOW + 1, mg: 100 }];
    const now = NOW + 1;
    const threshold = caffeineAt(doses, now + 48 * HOUR);
    expect(sleepReadyAt(doses, now, threshold)).toBe(NOW + 48 * HOUR + MINUTE);
  });

  it("finds absorption peaks and keeps now when every dose is falling", () => {
    const doses = [{ at: NOW, mg: 100 }];
    expect(peakAfter(doses, NOW)).toEqual({
      t: NOW + 45 * MINUTE,
      mg: caffeineAt(doses, NOW + 45 * MINUTE),
    });
    expect(peakAfter(doses, NOW + HOUR)).toEqual({
      t: NOW + HOUR,
      mg: caffeineAt(doses, NOW + HOUR),
    });
    expect(peakAfter([], NOW)).toEqual({ t: NOW, mg: 0 });
    expect(peakAfter([{ at: NOW + HOUR, mg: 100 }], NOW).t).toBe(
      NOW + HOUR + 45 * MINUTE,
    );
  });

  it("finds an interior peak when absorption competes with an older dose", () => {
    const doses = [
      { at: -5 * HOUR, mg: 100 },
      { at: 0, mg: 5.5 },
    ];
    const t = (5 * HOUR) / Math.LN2 - 50 / (5.5 / (45 * MINUTE));
    const peak = peakAfter(doses, 0);
    expect(peak.t).toBeCloseTo(t, 6);
    expect(peak.mg).toBe(caffeineAt(doses, peak.t));
    expect(peak.mg).toBeGreaterThan(caffeineAt(doses, 45 * MINUTE));
    const threshold = (50 + peak.mg) / 2;
    const ready = sleepReadyAt(doses, 0, threshold);
    expect(ready).toBeGreaterThan(peak.t);
    if (ready === null) throw new Error("Expected a ready time");
    expect(caffeineAt(doses, ready)).toBeLessThanOrEqual(threshold);
    expect(caffeineAt(doses, ready - MINUTE)).toBeGreaterThan(threshold);
  });

  it("totals doses with an inclusive start and exclusive end without mutating them", () => {
    const doses = [
      { at: 20, mg: 3.5 },
      { at: 10, mg: 1.25 },
      { at: 9, mg: 100 },
      { at: 19, mg: 2.25 },
    ];
    expect(dayTotal(doses, 10, 20)).toBe(3.5);
    expect(dayTotal([], 10, 20)).toBe(0);
    expect(doses.map(({ at }) => at)).toEqual([20, 10, 9, 19]);
  });
});

describe("caffeine backend", () => {
  it("adds trimmed entries, lists in time order with exclusive end, and removes entries", async () => {
    const { t, alice } = setup();
    const later = await alice.mutation(api.caffeine.add, {
      mg: 95,
      label: " Coffee ",
      at: NOW,
    });
    const earlier = await alice.mutation(api.caffeine.add, {
      mg: 47,
      label: "Tea",
      at: NOW - HOUR,
    });
    const end = await alice.mutation(api.caffeine.add, {
      mg: 63,
      label: "Espresso",
      at: NOW + 1,
    });
    const rows = await alice.query(api.caffeine.list, {
      startMs: NOW - HOUR,
      endMs: NOW + 1,
    });
    expect(rows.map(({ _id }) => _id)).toEqual([earlier, later]);
    expect(rows[1]).toMatchObject({
      userId: "alice",
      mg: 95,
      label: "Coffee",
      at: NOW,
    });
    expect(await t.run((ctx) => ctx.db.get(later))).toMatchObject({
      label: "Coffee",
    });
    await alice.mutation(api.caffeine.remove, { id: earlier });
    expect(await t.run((ctx) => ctx.db.get(earlier))).toBeNull();
    expect(
      (
        await alice.query(api.caffeine.list, {
          startMs: NOW - HOUR,
          endMs: NOW + 1,
        })
      ).map(({ _id }) => _id),
    ).toEqual([later]);
    expect(await t.run((ctx) => ctx.db.get(end))).not.toBeNull();
    await expect(
      alice.mutation(api.caffeine.remove, { id: earlier }),
    ).rejects.toThrow("Entry not found.");
  });

  it("isolates two owners and rejects foreign removals", async () => {
    const { alice, bob } = setup();
    const aliceId = await alice.mutation(api.caffeine.add, {
      mg: 95,
      label: "Alice coffee",
      at: NOW,
    });
    const bobId = await bob.mutation(api.caffeine.add, {
      mg: 80,
      label: "Bob drink",
      at: NOW,
    });
    const range = { startMs: NOW - HOUR, endMs: NOW + HOUR };
    expect(
      (await alice.query(api.caffeine.list, range)).map(({ _id }) => _id),
    ).toEqual([aliceId]);
    expect(
      (await bob.query(api.caffeine.list, range)).map(({ _id }) => _id),
    ).toEqual([bobId]);
    await expect(
      bob.mutation(api.caffeine.remove, { id: aliceId }),
    ).rejects.toThrow("Entry not found.");
    await expect(
      alice.mutation(api.caffeine.remove, { id: bobId }),
    ).rejects.toThrow("Entry not found.");
  });

  it.each([0, 0.5, 1001, NaN, Infinity, -Infinity])(
    "rejects caffeine amount %s",
    async (mg) => {
      const { alice } = setup();
      await expect(
        alice.mutation(api.caffeine.add, { mg, label: "Coffee", at: NOW }),
      ).rejects.toThrow("Caffeine amount must be between 1 and 1,000 mg.");
    },
  );

  it.each([1, 1.5, 1000])("accepts caffeine amount %s", async (mg) => {
    const { t, alice } = setup();
    const id = await alice.mutation(api.caffeine.add, {
      mg,
      label: "Coffee",
      at: NOW,
    });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ mg });
  });

  it.each(["", "   ", "A".repeat(41)])(
    "rejects invalid label %j",
    async (label) => {
      const { alice } = setup();
      await expect(
        alice.mutation(api.caffeine.add, { mg: 95, label, at: NOW }),
      ).rejects.toThrow("Enter a label of 1–40 characters.");
    },
  );

  it.each(["A", "A".repeat(40)])("stores trimmed label %j", async (label) => {
    const { t, alice } = setup();
    const id = await alice.mutation(api.caffeine.add, {
      mg: 95,
      label: ` ${label} `,
      at: NOW,
    });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ label });
  });

  it.each([-7 * 24 * HOUR, 5 * MINUTE])(
    "accepts timestamp boundary offset %s",
    async (offset) => {
      const { t, alice } = setup();
      const at = NOW + offset;
      const id = await alice.mutation(api.caffeine.add, {
        mg: 95,
        label: "Coffee",
        at,
      });
      expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ at });
    },
  );

  it.each([
    NOW - 7 * 24 * HOUR - 1,
    NOW + 5 * MINUTE + 1,
    NaN,
    Infinity,
    -Infinity,
  ])("rejects timestamp %s", async (at) => {
    const { alice } = setup();
    await expect(
      alice.mutation(api.caffeine.add, { mg: 95, label: "Coffee", at }),
    ).rejects.toThrow("Use a time within the past 7 days or next 5 minutes.");
  });

  it.each([
    { startMs: NOW, endMs: NOW },
    { startMs: NOW, endMs: NOW - 1 },
    { startMs: NOW, endMs: NOW + 48 * HOUR + 1 },
    { startMs: NaN, endMs: NOW },
    { startMs: NOW, endMs: Infinity },
    { startMs: -Infinity, endMs: NOW },
  ])("rejects invalid list range %j", async (range) => {
    const { alice } = setup();
    await expect(alice.query(api.caffeine.list, range)).rejects.toThrow(
      "Use a time range of at most 48 hours.",
    );
  });

  it("accepts a 48-hour list range", async () => {
    const { alice } = setup();
    expect(
      await alice.query(api.caffeine.list, {
        startMs: NOW - 24 * HOUR,
        endMs: NOW + 24 * HOUR,
      }),
    ).toEqual([]);
  });

  it("requires authentication for each endpoint", async () => {
    const { t, alice } = setup();
    const id = await alice.mutation(api.caffeine.add, {
      mg: 95,
      label: "Coffee",
      at: NOW,
    });
    await expect(
      t.mutation(api.caffeine.add, { mg: 95, label: "Coffee", at: NOW }),
    ).rejects.toThrow("Sign in to continue.");
    await expect(
      t.query(api.caffeine.list, { startMs: NOW, endMs: NOW + HOUR }),
    ).rejects.toThrow("Sign in to continue.");
    await expect(t.mutation(api.caffeine.remove, { id })).rejects.toThrow(
      "Sign in to continue.",
    );
  });

  it("exports owned caffeine entries without account metadata", async () => {
    const { alice, bob } = setup();
    const id = await alice.mutation(api.caffeine.add, {
      mg: 95,
      label: "Coffee",
      at: NOW,
    });
    await bob.mutation(api.caffeine.add, { mg: 47, label: "Tea", at: NOW });
    expect((await alice.query(api.exportData.all, {})).caffeine).toEqual([
      { id, mg: 95, label: "Coffee", at: NOW },
    ]);
    expect((await bob.query(api.exportData.all, {})).caffeine).toMatchObject([
      { mg: 47, label: "Tea" },
    ]);
  });

  it("clears demo caffeine entries during replacement and preserves other users", async () => {
    const { t } = setup();
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    vi.stubEnv("DEV_AUTH_JWKS", "test-jwks");
    const demo = t.withIdentity({ subject: DEV_USER, issuer: DEV_ISSUER });
    const ids = await t.run(async (ctx) => ({
      demo: await ctx.db.insert("caffeine", {
        userId: DEV_USER,
        mg: 95,
        label: "Coffee",
        at: NOW,
      }),
      other: await ctx.db.insert("caffeine", {
        userId: "alice",
        mg: 95,
        label: "Coffee",
        at: NOW,
      }),
    }));
    await demo.mutation(internal.demo.replace, {
      now: NOW,
      days: Array.from({ length: 14 }, (_, i) => NOW - i * 24 * HOUR),
      meals: [],
    });
    expect(await t.run((ctx) => ctx.db.get(ids.demo))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ids.other))).not.toBeNull();
  });
});

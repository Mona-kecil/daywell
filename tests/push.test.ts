import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { dueSlots, localClock } from "../lib/coach-time";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
const endpoint = "https://fcm.googleapis.com/fcm/send/alice";
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("push subscriptions", () => {
  it("requires auth, dedupes, updates keys, and preserves another user's record", async () => {
    const { t, alice, bob } = setup();
    await expect(
      t.mutation(api.push.subscribe, { endpoint, keys }),
    ).rejects.toThrow("Sign in");
    const id = await alice.mutation(api.push.subscribe, { endpoint, keys });
    expect(
      await alice.mutation(api.push.subscribe, {
        endpoint,
        keys: { ...keys, auth: "b".repeat(22) },
      }),
    ).toBe(id);
    await expect(
      bob.mutation(api.push.subscribe, { endpoint, keys }),
    ).rejects.toThrow("another user");
    await bob.mutation(api.push.unsubscribe, { endpoint });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      userId: "alice",
      keys: { auth: "b".repeat(22) },
    });
    await alice.mutation(api.push.unsubscribe, { endpoint });
    await alice.mutation(api.push.unsubscribe, { endpoint });
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });
  it("rejects bad keys and endpoints outside browser push services", async () => {
    const { alice } = setup();
    for (const bad of [
      "http://fcm.googleapis.com/x",
      "https://127.0.0.1/x",
      "https://example.com/x",
      "https://fcm.googleapis.com.evil.test/x",
      "https://user@fcm.googleapis.com/x",
    ])
      await expect(
        alice.mutation(api.push.subscribe, { endpoint: bad, keys }),
      ).rejects.toThrow("HTTPS");
    await expect(
      alice.mutation(api.push.subscribe, {
        endpoint,
        keys: { p256dh: "bad", auth: "bad" },
      }),
    ).rejects.toThrow("keys");
  });
});
describe("due slots", () => {
  it("uses (since, now], accounts for the local date, and ignores seconds", () => {
    const since = Date.parse("2026-10-13T02:59:59Z"),
      now = Date.parse("2026-10-13T03:15:00Z");
    expect(
      dueSlots({ since, now, timeZone: "Asia/Jakarta", checkIns: ["10:00"] }),
    ).toEqual([
      {
        localDay: "2026-10-13",
        slot: "10:00",
        localMinutes: 600,
        at: Date.parse("2026-10-13T03:00:00Z"),
      },
    ]);
    expect(
      dueSlots({
        since: Date.parse("2026-10-13T03:00:00Z"),
        now,
        timeZone: "Asia/Jakarta",
        checkIns: ["10:00"],
      }),
    ).toEqual([]);
    expect(
      localClock(Date.parse("2026-10-13T17:00Z"), "Asia/Jakarta"),
    ).toMatchObject({ localDay: "2026-10-14", slot: "00:00" });
    expect(
      dueSlots({ since, now, timeZone: "UTC", checkIns: ["10:00"] }),
    ).toEqual([]);
  });
  it("skips a nonexistent spring time and dedupes the fall repeated time", () => {
    expect(
      dueSlots({
        since: Date.parse("2026-03-08T06:00Z"),
        now: Date.parse("2026-03-08T08:00Z"),
        timeZone: "America/New_York",
        checkIns: ["02:30", "03:00"],
      }).map((s) => s.slot),
    ).toEqual(["03:00"]);
    const fall = dueSlots({
      since: Date.parse("2026-11-01T04:00Z"),
      now: Date.parse("2026-11-01T07:00Z"),
      timeZone: "America/New_York",
      checkIns: ["01:30"],
    });
    expect(fall).toHaveLength(1);
    expect(fall[0].at).toBe(Date.parse("2026-11-01T05:30Z"));
  });
});
async function enable(
  alice: ReturnType<typeof setup>["alice"],
  timeZone = "Asia/Jakarta",
  checkIns = ["10:00"],
) {
  await alice.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setTimeZone, { timeZone });
  await alice.mutation(api.coach.setCheckIns, { checkIns });
  await alice.mutation(api.coach.setRemindersEnabled, { enabled: true });
  return alice.mutation(api.push.subscribe, { endpoint, keys });
}
async function drain(t: ReturnType<typeof setup>["t"]) {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}
describe("coach cron", () => {
  it("sends a user-scoped suggestion once across duplicate cron and delivery runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T03:01Z"));
    vi.stubEnv("PUSH_PROVIDER", "fake");
    const { t, alice, bob } = setup();
    await enable(alice);
    await bob.mutation(api.tracker.initialize, {});
    await bob.mutation(api.tracker.addWater, {
      at: Date.now(),
      amountMl: 2500,
    });
    await t.mutation(internal.coachCron.run, {});
    await t.mutation(internal.coachCron.run, {});
    await drain(t);
    const sent = await t.run((ctx) => ctx.db.query("coachSent").collect());
    expect(sent).toHaveLength(1);
    await t.action(internal.pushActions.deliver, { sentId: sent[0]._id });
    const calls = await t.run((ctx) =>
      ctx.db.query("pushDeliveries").collect(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      endpoint,
      payload: {
        title: "Drink 500 ml of water",
        kind: "water",
        slot: "2026-10-13/10:00",
      },
      statusCode: 201,
    });
  });
  it.each([404, 410])(
    "removes expired subscriptions after fake HTTP %s",
    async (status) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-13T03:01Z"));
      vi.stubEnv("PUSH_PROVIDER", "fake");
      vi.stubEnv("PUSH_FAKE_STATUS", String(status));
      const { t, alice } = setup();
      const id = await enable(alice);
      await t.mutation(internal.coachCron.run, {});
      await drain(t);
      expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
      expect(
        await t.run((ctx) => ctx.db.query("pushDeliveries").collect()),
      ).toMatchObject([{ statusCode: status }]);
    },
  );
  it("catches up since the last run and sends the repeated DST slot only once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T05:31Z"));
    vi.stubEnv("PUSH_PROVIDER", "fake");
    const { t, alice } = setup();
    await enable(alice, "America/New_York", ["01:30"]);
    await t.mutation(internal.coachCron.run, {});
    await drain(t);
    vi.setSystemTime(new Date("2026-11-01T06:31Z"));
    await t.mutation(internal.coachCron.run, {});
    await drain(t);
    expect(
      await t.run((ctx) => ctx.db.query("pushDeliveries").collect()),
    ).toHaveLength(1);
    expect(
      (await t.run((ctx) => ctx.db.query("coachSent").collect()))[0],
    ).toMatchObject({ localDay: "2026-11-01", slot: "01:30" });
  });
  it("does not send after reminders are disabled before scheduled delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T03:01Z"));
    vi.stubEnv("PUSH_PROVIDER", "fake");
    const { t, alice } = setup();
    await enable(alice);
    await t.mutation(internal.coachCron.run, {});
    await alice.mutation(api.coach.setRemindersEnabled, { enabled: false });
    await drain(t);
    expect(
      await t.run((ctx) => ctx.db.query("pushDeliveries").collect()),
    ).toHaveLength(0);
  });
  it("uses the device zone for suggestions after traveling", async () => {
    const { alice } = setup();
    await alice.mutation(api.tracker.initialize, {});
    await alice.mutation(api.coach.setTimeZone, { timeZone: "Asia/Tokyo" });
    await alice.mutation(api.tracker.addWater, {
      at: Date.parse("2026-10-12T06:00:00Z"),
      amountMl: 500,
    });
    const now = Date.parse("2026-10-12T10:00:00Z");
    const savedZone = await alice.query(api.coach.suggestions, { now });
    expect(
      savedZone.filter((suggestion) => suggestion.kind === "water"),
    ).toHaveLength(1);
    const deviceZone = await alice.query(api.coach.suggestions, {
      now,
      timeZone: "America/Los_Angeles",
    });
    expect(
      deviceZone.filter((suggestion) => suggestion.kind === "water"),
    ).toEqual([]);
  });
  it("rejects an invalid device zone for suggestions despite a saved zone", async () => {
    const { alice } = setup();
    await alice.mutation(api.tracker.initialize, {});
    await alice.mutation(api.coach.setTimeZone, { timeZone: "Asia/Tokyo" });
    await expect(
      alice.query(api.coach.suggestions, {
        now: Date.parse("2026-10-12T10:00:00Z"),
        timeZone: "Invalid/Zone",
      }),
    ).rejects.toThrow("Unknown time zone.");
  });
  it("uses the user's local day and ready meal totals for client suggestions", async () => {
    const { t, alice, bob } = setup();
    await alice.mutation(api.tracker.initialize, {});
    await alice.mutation(api.coach.setTargets, {
      kcalTarget: 2000,
      proteinTarget: 100,
    });
    await alice.mutation(api.coach.setTimeZone, { timeZone: "Asia/Jakarta" });
    const now = Date.parse("2026-10-14T07:00Z");
    await alice.mutation(api.tracker.addWater, {
      at: now - 15 * 3_600_000,
      amountMl: 2500,
    }); // yesterday locally
    await bob.mutation(api.tracker.addWater, {
      at: now - 60_000,
      amountMl: 2500,
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["photo"])),
    );
    await t.run((ctx) =>
      ctx.db.insert("meals", {
        userId: "alice",
        storageId,
        at: now - 60_000,
        description: "chicken",
        revision: 1,
        analysis: { status: "ready" },
        items: [
          {
            id: "1",
            name: "chicken",
            grams: 100,
            searchQuery: "chicken",
            status: "matched",
            fdcId: 1,
            foodDescription: "chicken",
            per100g: { kcal: 1500, protein: 100, carbs: 0, fat: 0 },
          },
        ],
      }),
    );
    const suggestions = await alice.query(api.coach.suggestions, { now });
    expect(suggestions.map((s) => s.kind)).toEqual(["water", "train"]);
    await expect(t.query(api.coach.suggestions, { now })).rejects.toThrow(
      "Sign in",
    );
    await expect(
      alice.query(api.coach.suggestions, { now: -1 }),
    ).rejects.toThrow("timestamp");
  });
});

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
describe("coach settings", () => {
  it("keeps existing rows valid, supplies defaults, and scopes settings", async () => {
    const t = convexTest(schema, modules),
      alice = t.withIdentity({ subject: "alice" }),
      bob = t.withIdentity({ subject: "bob" });
    await t.run((ctx) =>
      ctx.db.insert("settings", { userId: "alice", waterGoal: 3000 }),
    );
    await expect(t.query(api.coach.settings, {})).rejects.toThrow("Sign in");
    expect(await alice.query(api.coach.settings, {})).toEqual({
      waterGoal: 3000,
      kcalTarget: null,
      proteinTarget: null,
      timeZone: null,
      checkIns: ["10:00", "13:00", "16:00", "19:30"],
      remindersEnabled: false,
    });
    await alice.mutation(api.coach.setTargets, {
      kcalTarget: 2200,
      proteinTarget: 140,
    });
    expect((await bob.query(api.coach.settings, {})).proteinTarget).toBeNull();
    await alice.mutation(api.coach.setTargets, {});
    expect((await alice.query(api.coach.settings, {})).kcalTarget).toBeNull();
  });
  it("validates targets, time zones, slots, and reminder prerequisites", async () => {
    const t = convexTest(schema, modules),
      alice = t.withIdentity({ subject: "alice" });
    await alice.mutation(api.tracker.initialize, {});
    for (const kcalTarget of [0, -1, Infinity, 20001])
      await expect(
        alice.mutation(api.coach.setTargets, { kcalTarget }),
      ).rejects.toThrow();
    for (const proteinTarget of [0, -1, 1001])
      await expect(
        alice.mutation(api.coach.setTargets, { proteinTarget }),
      ).rejects.toThrow();
    for (const checkIns of [["24:00"], ["9:00"], ["12:60"], ["10:00", "10:00"]])
      await expect(
        alice.mutation(api.coach.setCheckIns, { checkIns }),
      ).rejects.toThrow("HH:MM");
    await expect(
      alice.mutation(api.coach.setTimeZone, { timeZone: "Mars/Olympus" }),
    ).rejects.toThrow("IANA");
    await expect(
      alice.mutation(api.coach.setTimeZone, { timeZone: "+01:00" }),
    ).rejects.toThrow("IANA");
    await expect(
      alice.mutation(api.coach.setRemindersEnabled, { enabled: true }),
    ).rejects.toThrow("time zone");
    await alice.mutation(api.coach.setTimeZone, { timeZone: "Asia/Jakarta" });
    await alice.mutation(api.coach.setCheckIns, {
      checkIns: ["19:30", "10:00"],
    });
    await alice.mutation(api.coach.setRemindersEnabled, { enabled: true });
    expect(await alice.query(api.coach.settings, {})).toMatchObject({
      timeZone: "Asia/Jakarta",
      checkIns: ["10:00", "19:30"],
      remindersEnabled: true,
    });
  });
});

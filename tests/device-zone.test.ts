import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
// Monday 14:00 in Tokyo is still Sunday 22:00 in Los Angeles.
const NOW = Date.parse("2026-10-12T05:00:00Z");
afterEach(() => vi.restoreAllMocks());
async function setup() {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  await alice.mutation(api.tracker.initialize, {});
  await alice.mutation(api.coach.setTimeZone, { timeZone: "Asia/Tokyo" });
  return alice;
}

it("weekly volume uses the device zone over a stale saved zone", async () => {
  const alice = await setup();
  const saved = await alice.query(api.volume.weekly, { weeks: 2 });
  expect(saved.weeks.at(-1)!.start).toBe("2026-10-12");
  const device = await alice.query(api.volume.weekly, {
    weeks: 2,
    timeZone: "America/Los_Angeles",
  });
  expect(device.weeks.at(-1)!.start).toBe("2026-10-05");
});

it("the week plan uses the device zone over a stale saved zone", async () => {
  const alice = await setup();
  const saved = await alice.query(api.plan.week, {});
  expect(saved.days.map((d) => d.day)).toEqual([
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
  ]);
  // Sunday 22:00 in Los Angeles: this week's last 6 PM slot has passed.
  const device = await alice.query(api.plan.week, {
    timeZone: "America/Los_Angeles",
  });
  expect(device.days).toEqual([]);
});

it("rejects an unknown device zone", async () => {
  const alice = await setup();
  await expect(
    alice.query(api.plan.week, { timeZone: "Mars/Olympus" }),
  ).rejects.toThrow("Unknown time zone.");
});

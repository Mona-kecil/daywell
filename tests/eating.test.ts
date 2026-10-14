import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayWindow } from "../lib/insights";
import {
  clockMinutes,
  duration,
  eatingDays,
  eatingSummary,
} from "../lib/eating";

const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

// Local wall-clock time in New York.
const at = (day: string, time: string) =>
  new Date(`${day}T${time}:00`).getTime();

describe("eating window", () => {
  it("buckets meals into local days, in time order", () => {
    const { days } = dayWindow(new Date(at("2026-10-14", "12:00")), 3);
    const result = eatingDays(days, [
      at("2026-10-13", "19:30"),
      at("2026-10-13", "08:00"),
      at("2026-10-14", "00:10"),
      at("2026-10-11", "23:59"),
    ]);
    expect(result.map((d) => [d.key, d.meals.length])).toEqual([
      ["2026-10-12", 0],
      ["2026-10-13", 2],
      ["2026-10-14", 1],
    ]);
    expect(result[1].meals).toEqual([
      at("2026-10-13", "08:00"),
      at("2026-10-13", "19:30"),
    ]);
  });

  it("reads wall-clock minutes on a 25-hour fall-back day", () => {
    // 7 PM on Nov 1 is 20 elapsed hours after midnight, but sits at 7 PM.
    expect(clockMinutes(at("2026-11-01", "19:00"))).toBe(19 * 60);
  });

  it("takes medians and leaves today's unfinished window out", () => {
    const { days } = dayWindow(new Date(at("2026-10-14", "12:00")), 5);
    const meals = [
      // Oct 10: nothing logged.
      at("2026-10-11", "08:00"),
      at("2026-10-11", "18:00"), // 10 h
      at("2026-10-12", "09:00"),
      at("2026-10-12", "13:00"),
      at("2026-10-12", "21:00"), // 12 h
      at("2026-10-13", "07:00"), // single meal: no window
      at("2026-10-14", "10:00"),
      at("2026-10-14", "11:00"), // today: 1 h so far
    ];
    const summary = eatingSummary(eatingDays(days, meals), "2026-10-14");
    expect(summary.loggedDays).toBe(4);
    expect(summary.windowMs).toBe(11 * 3_600_000);
    // First meals 8:00, 9:00, 7:00, 10:00 → median 8:30.
    expect(summary.firstMeal).toBe(8 * 60 + 30);
    // Last meals 18:00, 21:00, 7:00 (today's 11:00 is not final) → 18:00.
    expect(summary.lastMeal).toBe(18 * 60);
    // Gaps: Oct 11→12 15 h, 12→13 10 h, 13→14 27 h → 15 h. Oct 10 has no meals.
    expect(summary.fastMs).toBe(15 * 3_600_000);
  });

  it("has nothing to summarise without meals", () => {
    const { days } = dayWindow(new Date(at("2026-10-14", "12:00")), 3);
    expect(eatingSummary(eatingDays(days, []), "2026-10-14")).toEqual({
      loggedDays: 0,
      windowMs: null,
      firstMeal: null,
      lastMeal: null,
      fastMs: null,
    });
  });

  it("formats durations", () => {
    expect(duration(45 * 60_000)).toBe("45 min");
    expect(duration(2 * 3_600_000)).toBe("2 h");
    expect(duration(10 * 3_600_000 + 5 * 60_000)).toBe("10 h 5 min");
    expect(duration(59.6 * 60_000)).toBe("1 h");
  });
});

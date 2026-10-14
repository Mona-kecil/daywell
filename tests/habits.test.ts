import { describe, expect, it } from "vitest";
import {
  HABIT_ICONS,
  MAX_HABITS,
  NAME_MAX,
  cleanHabitName,
  habitStreak,
  isDay,
  lastDays,
} from "../lib/habits";

describe("habit helpers", () => {
  it("defines the supported icons and limits", () => {
    expect(HABIT_ICONS).toEqual([
      "pill",
      "stretch",
      "book",
      "sun",
      "leaf",
      "heart",
      "moon",
      "check",
    ]);
    expect(MAX_HABITS).toBe(12);
    expect(NAME_MAX).toBe(40);
  });

  it("trims and collapses whitespace before checking name length", () => {
    expect(cleanHabitName(" \t Stretch \n 10 min  ")).toBe("Stretch 10 min");
    expect(cleanHabitName(`  ${"a".repeat(40)}  `)).toBe("a".repeat(40));
    expect(cleanHabitName("a")).toBe("a");
    for (const name of ["", " \n\t ", "a".repeat(41)])
      expect(cleanHabitName(name)).toBeNull();
  });

  it.each(["2024-02-29", "2026-12-31", "2000-02-29", "0099-01-01"])(
    "accepts calendar date %s",
    (day) => expect(isDay(day)).toBe(true),
  );

  it.each([
    "",
    "2026-2-01",
    "2026-02-1",
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "2026-01-32",
    "2026-01-01T00:00:00Z",
    " 2026-01-01",
    "2026-01-01\n",
  ])("rejects invalid calendar date %j", (day) =>
    expect(isDay(day)).toBe(false),
  );

  it.each([
    { today: "2026-03-02", days: ["2026-02-28", "2026-03-01", "2026-03-02"] },
    { today: "2026-01-02", days: ["2025-12-31", "2026-01-01", "2026-01-02"] },
    { today: "2026-03-09", days: ["2026-03-07", "2026-03-08", "2026-03-09"] },
    { today: "2026-11-02", days: ["2026-10-31", "2026-11-01", "2026-11-02"] },
    { today: "2024-03-01", days: ["2024-02-28", "2024-02-29", "2024-03-01"] },
  ])("walks calendar days through $today", ({ today, days }) => {
    expect(lastDays(today, 3)).toEqual(days);
    expect(habitStreak(days, today)).toBe(3);
    expect(habitStreak(new Set(days), today)).toBe(3);
  });

  it("keeps yesterday's streak alive, stops at gaps, and ignores future days", () => {
    const days = ["2026-02-26", "2026-02-28", "2026-03-01", "2026-03-03"];
    expect(habitStreak(days, "2026-03-02")).toBe(2);
    expect(habitStreak([...days, "2026-03-01"], "2026-03-02")).toBe(2);
    expect(habitStreak(days, "2026-03-04")).toBe(1);
    expect(habitStreak(days, "2026-03-05")).toBe(0);
    expect(habitStreak([], "2026-03-02")).toBe(0);
  });

  it("returns the requested number of days oldest first", () => {
    expect(lastDays("2026-01-01", 0)).toEqual([]);
    expect(lastDays("2026-01-01", 1)).toEqual(["2026-01-01"]);
    expect(lastDays("2026-01-02", 7)).toEqual([
      "2025-12-27",
      "2025-12-28",
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });
});

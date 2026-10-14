import { describe, expect, it } from "vitest";
import {
  ACTIVE_MINUTES_GOAL,
  CARDIO_EFFORTS,
  CARDIO_KINDS,
  activeMinutes,
  addDays,
  cardioKcal,
  formatPace,
  mondayOf,
  pace,
  type CardioKind,
} from "../lib/cardio";

describe("cardio pace", () => {
  it("defines the kinds, efforts, and weekly goal", () => {
    expect(CARDIO_KINDS).toEqual([
      "run",
      "walk",
      "ride",
      "swim",
      "row",
      "other",
    ]);
    expect(CARDIO_EFFORTS).toEqual(["easy", "moderate", "hard"]);
    expect(ACTIVE_MINUTES_GOAL).toBe(150);
  });

  it.each([
    ["run", 5.86, 30, { unit: "/km", seconds: 307 }, "5:07 /km"],
    ["walk", 3, 30, { unit: "/km", seconds: 600 }, "10:00 /km"],
    ["swim", 1.2, 25, { unit: "/100 m", seconds: 125 }, "2:05 /100 m"],
    ["row", 5, 19.6667, { unit: "/500 m", seconds: 118 }, "1:58 /500 m"],
    ["ride", 12.16, 30, { unit: "km/h", speed: 24.3 }, "24.3 km/h"],
  ] satisfies [
    CardioKind,
    number,
    number,
    NonNullable<ReturnType<typeof pace>>,
    string,
  ][])(
    "computes and formats %s pace",
    (kind, distance, minutes, expected, formatted) => {
      const result = pace(kind, distance, minutes);
      expect(result).toEqual(expected);
      if (result === null) throw new Error("Expected a pace");
      expect(formatPace(result)).toBe(formatted);
    },
  );

  it.each(CARDIO_KINDS)(
    "returns null for missing and zero %s distance",
    (kind) => {
      expect(pace(kind, null, 30)).toBeNull();
      expect(pace(kind, 0, 30)).toBeNull();
    },
  );

  it("returns null for other even with a distance", () => {
    expect(pace("other", 5, 30)).toBeNull();
  });

  it("rounds whole seconds before formatting, including minute and hour carries", () => {
    expect(formatPace({ unit: "/km", seconds: 306.6 })).toBe("5:07 /km");
    expect(formatPace({ unit: "/100 m", seconds: 119.5 })).toBe("2:00 /100 m");
    expect(formatPace({ unit: "/500 m", seconds: 3599.5 })).toBe(
      "1:00:00 /500 m",
    );
    expect(formatPace({ unit: "/km", seconds: 3725 })).toBe("1:02:05 /km");
    const slow = pace("walk", 0.1, 60);
    if (slow === null) throw new Error("Expected a slow pace");
    expect(formatPace(slow)).toBe("10:00:00 /km");
    expect(formatPace({ unit: "km/h", speed: 24 })).toBe("24.0 km/h");
    expect(formatPace({ unit: "km/h", speed: 24.26 })).toBe("24.3 km/h");
  });
});

describe("cardio effort and calories", () => {
  it("counts easy and moderate once and hard twice, including fractions", () => {
    expect(activeMinutes(30.5, "easy")).toBe(30.5);
    expect(activeMinutes(30.5, "moderate")).toBe(30.5);
    expect(activeMinutes(30.5, "hard")).toBe(61);
    expect(activeMinutes(0, "hard")).toBe(0);
  });

  it.each([
    ["run", [7, 9.8, 11.5]],
    ["walk", [2.8, 3.5, 5]],
    ["ride", [5.8, 7.5, 10]],
    ["swim", [5.8, 7, 9.8]],
    ["row", [4.8, 7, 8.5]],
    ["other", [3.5, 5, 8]],
  ] satisfies [CardioKind, number[]][])(
    "uses every %s MET value",
    (kind, mets) => {
      for (const [i, effort] of CARDIO_EFFORTS.entries()) {
        expect(cardioKcal(kind, effort, 60, 60)).toBe(Math.round(mets[i] * 60));
        expect(cardioKcal(kind, effort, 30.5, 73.2)).toBe(
          Math.round((mets[i] * 73.2 * 30.5) / 60),
        );
        expect(cardioKcal(kind, effort, 30, null)).toBeNull();
      }
      expect(cardioKcal(kind, "easy", 0, 75)).toBe(0);
    },
  );
});

describe("UTC calendar math", () => {
  it.each([
    ["2026-10-12", "2026-10-12"],
    ["2026-10-18", "2026-10-12"],
    ["2026-11-01", "2026-10-26"],
    ["2027-01-01", "2026-12-28"],
    ["2024-03-01", "2024-02-26"],
    ["0099-01-01", "0098-12-29"],
  ])("finds Monday for %s", (day, monday) => {
    expect(mondayOf(day)).toBe(monday);
  });

  it.each([
    ["2026-03-08", 1, "2026-03-09"],
    ["2026-11-01", -1, "2026-10-31"],
    ["2024-02-28", 1, "2024-02-29"],
    ["2024-02-29", 1, "2024-03-01"],
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2026-10-15", 0, "2026-10-15"],
    ["0000-02-29", 1, "0000-03-01"],
  ])("adds %s + %i calendar days", (day, n, result) => {
    expect(addDays(day, n)).toBe(result);
  });
});

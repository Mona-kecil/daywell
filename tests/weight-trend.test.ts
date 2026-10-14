import { describe, expect, it } from "vitest";
import { shiftDay } from "../lib/history";
import {
  goalEta,
  trendSeries,
  weeklyRate,
  type GoalEta,
  type TrendPoint,
} from "../lib/weight-trend";

function linearSeries(days: number, measured = days): TrendPoint[] {
  return Array.from({ length: days }, (_, index) => ({
    day: shiftDay("2026-10-01", index),
    weightKg: index < measured ? 80 + index * 0.2 : null,
    trendKg: 80 + index * 0.2,
  }));
}

describe("trendSeries", () => {
  it("returns an empty series without weigh-ins", () => {
    expect(trendSeries([])).toEqual([]);
  });

  it("seeds the trend with a single weigh-in", () => {
    expect(trendSeries([{ day: "2026-10-01", weightKg: 80 }])).toEqual([
      { day: "2026-10-01", weightKg: 80, trendKg: 80 },
    ]);
  });

  it("carries gaps and applies alpha 0.1 only on measured days", () => {
    const points = trendSeries([
      { day: "2026-10-01", weightKg: 80 },
      { day: "2026-10-03", weightKg: 82 },
      { day: "2026-10-04", weightKg: 79 },
    ]);
    expect(points.map((point) => point.day)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(points.map((point) => point.weightKg)).toEqual([80, null, 82, 79]);
    for (const [index, expected] of [80, 80, 80.2, 80.08].entries())
      expect(points[index].trendKg).toBeCloseTo(expected, 9);
  });

  it("sorts days, keeps the last supplied duplicate, and leaves input intact", () => {
    const input = [
      { day: "2026-10-03", weightKg: 99 },
      { day: "2026-10-01", weightKg: 80 },
      { day: "2026-10-03", weightKg: 82 },
      { day: "2026-10-01", weightKg: 70 },
    ];
    const original = structuredClone(input);
    expect(trendSeries(input)).toEqual([
      { day: "2026-10-01", weightKg: 70, trendKg: 70 },
      { day: "2026-10-02", weightKg: null, trendKg: 70 },
      { day: "2026-10-03", weightKg: 82, trendKg: 71.2 },
    ]);
    expect(input).toEqual(original);
  });

  it.each([
    ["2026-03-07", "2026-03-10", 4],
    ["2026-10-31", "2026-11-02", 3],
  ])("counts calendar days across DST from %s to %s", (first, last, count) => {
    const points = trendSeries([
      { day: first, weightKg: 80 },
      { day: last, weightKg: 81 },
    ]);
    expect(points).toHaveLength(count);
    expect(points.map((point) => point.day)).toEqual(
      Array.from({ length: count }, (_, index) => shiftDay(first, index)),
    );
  });
});

describe("weeklyRate", () => {
  it("requires fourteen calendar days and five measured days", () => {
    expect(weeklyRate([])).toBeNull();
    expect(weeklyRate(linearSeries(1))).toBeNull();
    expect(weeklyRate(linearSeries(13))).toBeNull();
    expect(weeklyRate(linearSeries(14, 4))).toBeNull();
    expect(weeklyRate(linearSeries(14, 5))).toBeCloseTo(1.4, 12);
  });

  it("fits all daily trend values, including carried days", () => {
    expect(weeklyRate(linearSeries(28, 5))).toBeCloseTo(1.4, 12);
    const descending = linearSeries(28).map((point, index) => ({
      ...point,
      trendKg: 80 - index * 0.3,
    }));
    expect(weeklyRate(descending)).toBeCloseTo(-2.1, 12);
  });

  it("uses only the last 28 calendar days for the fit and sample count", () => {
    const points = linearSeries(40).map((point, index) => ({
      ...point,
      trendKg: index < 12 ? 999 : point.trendKg,
    }));
    expect(weeklyRate(points)).toBeCloseTo(1.4, 12);
    expect(weeklyRate(linearSeries(40, 16))).toBeNull();
  });
});

describe("goalEta", () => {
  const cases: {
    name: string;
    trendKg: number | null;
    ratePerWeek: number | null;
    goalKg: number | null;
    expected: GoalEta;
  }[] = [
    {
      name: "no goal takes precedence",
      trendKg: null,
      ratePerWeek: null,
      goalKg: null,
      expected: { kind: "none" },
    },
    {
      name: "no trend",
      trendKg: null,
      ratePerWeek: -1,
      goalKg: 70,
      expected: { kind: "flat" },
    },
    {
      name: "reached before rate checks",
      trendKg: 70,
      ratePerWeek: null,
      goalKg: 70,
      expected: { kind: "reached" },
    },
    {
      name: "inclusive 0.3 kg boundary",
      trendKg: 0.3,
      ratePerWeek: 1,
      goalKg: 0,
      expected: { kind: "reached" },
    },
    {
      name: "null rate",
      trendKg: 80,
      ratePerWeek: null,
      goalKg: 70,
      expected: { kind: "flat" },
    },
    {
      name: "rate below 0.05",
      trendKg: 80,
      ratePerWeek: -0.049,
      goalKg: 70,
      expected: { kind: "flat" },
    },
    {
      name: "zero rate",
      trendKg: 80,
      ratePerWeek: 0,
      goalKg: 70,
      expected: { kind: "flat" },
    },
    {
      name: "gain away from lower goal",
      trendKg: 80,
      ratePerWeek: 1,
      goalKg: 70,
      expected: { kind: "away" },
    },
    {
      name: "loss away from higher goal",
      trendKg: 70,
      ratePerWeek: -1,
      goalKg: 80,
      expected: { kind: "away" },
    },
    {
      name: "more than 104 weeks",
      trendKg: 80.1,
      ratePerWeek: -0.5,
      goalKg: 28,
      expected: { kind: "far" },
    },
    {
      name: "inclusive 104 week boundary",
      trendKg: 80,
      ratePerWeek: -0.5,
      goalKg: 28,
      expected: { kind: "eta", day: shiftDay("2026-10-30", 728), weeks: 104 },
    },
    {
      name: "inclusive 0.05 rate boundary",
      trendKg: 80,
      ratePerWeek: -0.05,
      goalKg: 79,
      expected: { kind: "eta", day: "2027-03-19", weeks: 20 },
    },
    {
      name: "loss ETA crosses a month using unrounded weeks",
      trendKg: 80,
      ratePerWeek: -3,
      goalKg: 79,
      expected: { kind: "eta", day: "2026-11-02", weeks: 0.3 },
    },
    {
      name: "gain toward higher goal",
      trendKg: 70,
      ratePerWeek: 2,
      goalKg: 71,
      expected: { kind: "eta", day: "2026-11-03", weeks: 0.5 },
    },
  ];
  it.each(cases)("$name", ({ expected, trendKg, ratePerWeek, goalKg }) => {
    expect(
      goalEta({ trendKg, ratePerWeek, goalKg, today: "2026-10-30" }),
    ).toEqual(expected);
  });
});

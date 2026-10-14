import { describe, expect, it } from "vitest";
import { pixelStart, pixelStep, yearPixels } from "../lib/pixels";

describe("year in pixels", () => {
  it("starts eleven months back, across a year boundary", () => {
    expect(pixelStart("2026-10-14")).toBe("2025-11-01");
    expect(pixelStart("2026-01-31")).toBe("2025-02-01");
  });

  it("lays out twelve calendar months with future days marked", () => {
    const { months } = yearPixels("2026-02-10", [], "mood");
    expect(months.map((m) => m.key)).toEqual([
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    const feb = months.at(-1)!;
    expect(feb.days).toHaveLength(28);
    expect(feb.days[9]).toMatchObject({ key: "2026-02-10", future: false });
    expect(feb.days[10]).toMatchObject({ key: "2026-02-11", future: true });
    expect(months[1].days).toHaveLength(30);
  });

  it("shades mood and energy by value and sleep by hour bands", () => {
    expect(pixelStep(null, "mood")).toBe(0);
    expect(pixelStep(1, "mood")).toBe(1);
    expect(pixelStep(5, "energy")).toBe(5);
    expect(pixelStep(4.9, "sleep")).toBe(1);
    expect(pixelStep(5, "sleep")).toBe(2);
    expect(pixelStep(7.5, "sleep")).toBe(4);
    expect(pixelStep(8, "sleep")).toBe(5);
    expect(pixelStep(11, "sleep")).toBe(5);
  });

  it("averages logged days and needs three days for the best month", () => {
    const checkins = [
      { day: "2026-09-01", mood: 3, sleepHours: 7 },
      { day: "2026-09-02", mood: 4 },
      { day: "2026-09-03", mood: 5, energy: 2 },
      { day: "2026-10-01", mood: 5 },
      { day: "2026-10-02", mood: 5 },
      // Logged ahead of today: not part of the year yet.
      { day: "2026-10-20", mood: 1 },
    ];
    const mood = yearPixels("2026-10-14", checkins, "mood");
    expect(mood.logged).toBe(5);
    expect(mood.average).toBeCloseTo(22 / 5);
    // October averages 5 but has only two days.
    expect(mood.best?.key).toBe("2026-09");
    expect(mood.months.at(-1)!.days[19]).toMatchObject({
      value: null,
      step: 0,
      future: true,
    });

    const sleep = yearPixels("2026-10-14", checkins, "sleep");
    expect(sleep.logged).toBe(1);
    expect(sleep.average).toBe(7);
    expect(sleep.best).toBeNull();
  });
});

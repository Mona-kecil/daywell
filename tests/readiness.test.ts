import { describe, expect, it } from "vitest";
import {
  readiness,
  type Readiness,
  type ReadinessInput,
} from "../lib/readiness";
import { shiftDay } from "../lib/history";

const day = "2026-10-15";
const input: ReadinessInput = {
  day,
  checkins: [],
  soreMuscles: 0,
  totalMuscles: 0,
  dailyLoad: [],
};
function component(
  result: Readiness,
  key: Readiness["components"][number]["key"],
) {
  return result.components.find((row) => row.key === key);
}
const loadAtRatio = (acwr: number): ReadinessInput["dailyLoad"] => [
  { day: shiftDay(day, -14), load: 40 - acwr * 10 },
  { day, load: acwr * 10 },
];

describe("sleep", () => {
  it.each([
    [0, 0],
    [4, 0],
    [5.5, 50],
    [7, 100],
    [9, 100],
    [10, 85],
    [11, 70],
    [12, 70],
  ])("scores %s hours as %s", (sleepHours, score) => {
    expect(
      component(
        readiness({ ...input, checkins: [{ day, sleepHours }] }),
        "sleep",
      ),
    ).toMatchObject({ score, detail: { sleepHours } });
  });

  it("uses today's sleep before yesterday, including a logged zero", () => {
    const checkins = [
      { day: shiftDay(day, -1), sleepHours: 8 },
      { day, sleepHours: 0 },
    ];
    expect(component(readiness({ ...input, checkins }), "sleep")?.score).toBe(
      0,
    );
  });

  it("falls back to yesterday while asking for today's sleep", () => {
    const result = readiness({
      ...input,
      checkins: [
        { day: shiftDay(day, -1), sleepHours: 7 },
        { day, mood: 5 },
      ],
    });
    expect(component(result, "sleep")?.detail).toEqual({ sleepHours: 7 });
    expect(result.missing).toEqual(["sleep"]);
    expect(result.score).toBe(100);
  });

  it("does not fall back beyond yesterday or use future check-ins", () => {
    const result = readiness({
      ...input,
      checkins: [
        { day: shiftDay(day, -2), sleepHours: 8, mood: 5 },
        { day: shiftDay(day, 1), sleepHours: 8, energy: 5 },
      ],
    });
    expect(result.components).toEqual([]);
    expect(result.missing).toEqual(["sleep", "feel"]);
  });
});

describe("sleep trend", () => {
  const baseline = [-28, -20, -15, -12, -8, -5, -4].map((offset) => ({
    day: shiftDay(day, offset),
    sleepHours: 8,
  }));
  const recent = [0, -1, -2].map((offset) => ({
    day: shiftDay(day, offset),
    sleepHours: 7,
  }));

  it("uses the latest three in days 0…−3 and all baseline values in −28…−4", () => {
    const result = readiness({
      ...input,
      checkins: [
        { day: shiftDay(day, -29), sleepHours: 0 },
        ...baseline,
        ...recent,
        { day: shiftDay(day, -3), sleepHours: 0 },
        { day: shiftDay(day, 1), sleepHours: 24 },
      ].reverse(),
    });
    expect(component(result, "sleepTrend")).toMatchObject({
      score: 80,
      detail: { recentSleep: 7, baselineSleep: 8 },
    });
  });

  it("uses a logged value three days ago when a newer day is absent", () => {
    const result = readiness({
      ...input,
      checkins: [
        ...baseline,
        ...recent.slice(0, 2),
        { day: shiftDay(day, -3), sleepHours: 7 },
      ],
    });
    expect(component(result, "sleepTrend")?.score).toBe(80);
  });

  it.each([8, 9, 2])("caps or floors a recent mean of %s", (hours) => {
    const result = readiness({
      ...input,
      checkins: [
        ...baseline,
        ...recent.map((row) => ({ ...row, sleepHours: hours })),
      ],
    });
    expect(component(result, "sleepTrend")?.score).toBe(hours < 8 ? 0 : 100);
  });

  it("requires three recent values and seven baseline values", () => {
    for (const checkins of [
      [...baseline, ...recent.slice(0, 2)],
      [...baseline.slice(0, 6), ...recent],
    ])
      expect(
        component(readiness({ ...input, checkins }), "sleepTrend"),
      ).toBeUndefined();
  });
});

describe("feel and soreness", () => {
  it.each([1, 2, 3, 4, 5])(
    "maps mood and energy %s from the 1–5 scale",
    (value) => {
      for (const fields of [
        { energy: value },
        { mood: value },
        { energy: value, mood: value },
      ]) {
        const result = readiness({ ...input, checkins: [{ day, ...fields }] });
        expect(component(result, "feel")).toMatchObject({
          score: (value - 1) * 25,
          detail: fields,
        });
        expect(result.missing).toEqual(["sleep"]);
      }
    },
  );

  it("averages the mood and energy present today", () => {
    const result = readiness({
      ...input,
      checkins: [{ day, mood: 1, energy: 5 }],
    });
    expect(component(result, "feel")?.score).toBe(50);
  });

  it.each([
    [0, 100],
    [1, 75],
    [4, 0],
  ])("scores %s sore of four as %s", (soreMuscles, score) => {
    const result = readiness({ ...input, soreMuscles, totalMuscles: 4 });
    expect(component(result, "soreness")).toMatchObject({
      score,
      detail: { sore: soreMuscles, total: 4 },
    });
  });

  it("omits soreness when no muscles exist", () => {
    expect(component(readiness(input), "soreness")).toBeUndefined();
  });
});

describe("training load", () => {
  it.each([
    [0, 60],
    [0.4, 60],
    [0.5, 60],
    [0.65, 80],
    [0.8, 100],
    [1.3, 100],
    [1.65, 50],
    [2, 0],
    [2.5, 0],
  ])("scores ACWR %s as %s", (acwr, score) => {
    const result = readiness({ ...input, dailyLoad: loadAtRatio(acwr) });
    expect(component(result, "load")).toMatchObject({
      score,
      detail: {
        acute: acwr * 10,
        chronic: 10,
        acwr: Math.round(acwr * 10) / 10,
      },
    });
  });

  it("requires positive chronic load and 14 elapsed local days", () => {
    for (const dailyLoad of [
      [],
      [{ day: shiftDay(day, -27), load: 0 }],
      [{ day: shiftDay(day, -13), load: 10 }],
    ]) {
      expect(
        component(readiness({ ...input, dailyLoad }), "load"),
      ).toBeUndefined();
    }
    expect(
      component(
        readiness({
          ...input,
          dailyLoad: [{ day: shiftDay(day, -14), load: 10 }],
        }),
        "load",
      ),
    ).toMatchObject({ score: 60 });
  });

  it("uses only days −27…0 for chronic and −6…0 for acute", () => {
    const result = readiness({
      ...input,
      dailyLoad: [
        { day: shiftDay(day, -28), load: 1000 },
        { day: shiftDay(day, -27), load: 10 },
        { day: shiftDay(day, -7), load: 20 },
        { day: shiftDay(day, -6), load: 6 },
        { day, load: 4 },
        { day: shiftDay(day, 1), load: 1000 },
      ],
    });
    expect(component(result, "load")?.detail).toEqual({
      acute: 10,
      chronic: 10,
      acwr: 1,
    });
  });
});

describe("combined estimate", () => {
  it("renormalizes included weights, sorts the drags first and rounds the mean", () => {
    expect(
      readiness({ ...input, checkins: [{ day, sleepHours: 7, energy: 3 }] }),
    ).toEqual({
      day,
      score: 77,
      band: "push",
      missing: [],
      components: [
        { key: "feel", score: 50, weight: 0.45, detail: { energy: 3 } },
        { key: "sleep", score: 100, weight: 0.55, detail: { sleepHours: 7 } },
      ],
    });
  });

  it("retains all five weights when all components exist", () => {
    const result = readiness({
      ...input,
      totalMuscles: 4,
      soreMuscles: 1,
      dailyLoad: loadAtRatio(0.5),
      checkins: Array.from({ length: 29 }, (_, offset) => ({
        day: shiftDay(day, -offset),
        sleepHours: 8,
        energy: 1,
      })),
    });
    expect(
      result.components.map(({ key, score, weight }) => ({
        key,
        score,
        weight,
      })),
    ).toEqual([
      { key: "feel", score: 0, weight: 0.25 },
      { key: "load", score: 60, weight: 0.15 },
      { key: "soreness", score: 75, weight: 0.15 },
      { key: "sleep", score: 100, weight: 0.3 },
      { key: "sleepTrend", score: 100, weight: 0.15 },
    ]);
    expect(result.score).toBe(65);
  });

  it("rounds displayed scores and details to one decimal", () => {
    const result = readiness({
      ...input,
      totalMuscles: 3,
      soreMuscles: 1,
      checkins: [{ day, sleepHours: 5.555 }],
    });
    expect(component(result, "sleep")).toMatchObject({
      score: 51.8,
      detail: { sleepHours: 5.6 },
    });
    expect(component(result, "soreness")?.score).toBe(66.7);
    expect(result.score).toBe(57);
  });

  it("returns null score and band for zero or one component", () => {
    for (const partial of [
      {},
      { totalMuscles: 1 },
      { checkins: [{ day, sleepHours: 8 }] },
    ]) {
      expect(readiness({ ...input, ...partial })).toMatchObject({
        score: null,
        band: null,
      });
    }
    expect(readiness({ ...input, totalMuscles: 1 }).components[0]?.weight).toBe(
      1,
    );
  });

  it.each([
    [0, "easy"],
    [49, "easy"],
    [50, "steady"],
    [74, "steady"],
    [75, "push"],
    [100, "push"],
  ])("bands the rounded score %s as %s", (score, band) => {
    // Equal sleep/soreness scores keep the combined score at the chosen boundary.
    const result = readiness({
      ...input,
      checkins: [{ day, sleepHours: 4 + (Number(score) * 3) / 100 }],
      totalMuscles: 100,
      soreMuscles: 100 - Number(score),
    });
    expect(result).toMatchObject({ score, band });
  });

  it("never says push while one factor is below 50", () => {
    // Sleep 9 h, nothing sore, energy and mood 5/5: everything else maxed.
    const base = {
      ...input,
      checkins: [{ day, sleepHours: 9, energy: 5, mood: 5 }],
      totalMuscles: 11,
    };
    const spike = readiness({ ...base, dailyLoad: loadAtRatio(1.7) });
    expect(component(spike, "load")?.score).toBeLessThan(50);
    expect(spike.score).toBeGreaterThanOrEqual(75);
    expect(spike.band).toBe("steady");
    const edge = readiness({ ...base, dailyLoad: loadAtRatio(1.65) });
    expect(component(edge, "load")?.score).toBe(50);
    expect(edge.band).toBe("push");
    const shortNight = readiness({
      ...base,
      checkins: [{ day, sleepHours: 5.4, energy: 5, mood: 5 }],
    });
    expect(shortNight.score).toBeGreaterThanOrEqual(75);
    expect(shortNight.band).toBe("steady");
  });

  it("lists only today's missing loggable inputs", () => {
    expect(readiness(input).missing).toEqual(["sleep", "feel"]);
    expect(
      readiness({ ...input, checkins: [{ day, sleepHours: 8 }] }).missing,
    ).toEqual(["feel"]);
    expect(
      readiness({ ...input, checkins: [{ day, mood: 4 }] }).missing,
    ).toEqual(["sleep"]);
    expect(
      readiness({ ...input, checkins: [{ day, sleepHours: 8, mood: 4 }] })
        .missing,
    ).toEqual([]);
  });
});

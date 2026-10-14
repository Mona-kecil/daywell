import { describe, expect, it } from "vitest";
import {
  FACTORS,
  drivers,
  spearman,
  isClear,
  summarize,
  type DayRow,
  type Finding,
} from "../lib/drivers";
import { shiftDay } from "../lib/history";

function rows(n: number): DayRow[] {
  return Array.from({ length: n }, (_, i) => ({
    day: shiftDay("2026-01-25", i),
    factors: { sleepHours: i },
    outcomes: { energy: i },
  }));
}
function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    factor: "waterMl",
    outcome: "mood",
    lag: 0,
    n: 30,
    rho: 0.6,
    highMean: 4.1,
    lowMean: 3.5,
    split: 2100,
    strength: "strong",
    confidence: "steady",
    ...overrides,
  };
}

describe("Spearman correlation", () => {
  it("computes perfect positive and negative monotone correlations", () => {
    expect(spearman([2, 4, 8, 16], [1, 3, 9, 27])).toBe(1);
    expect(spearman([2, 4, 8, 16], [27, 9, 3, 1])).toBe(-1);
  });
  it("uses average ranks on ties on both sides", () => {
    // Ranks [1, 2.5, 2.5, 4] and [1.5, 1.5, 3, 4]:
    // covariance 3.75, each rank sum of squares 4.5 => 5/6.
    expect(spearman([1, 2, 2, 3], [1, 1, 2, 3])).toBeCloseTo(5 / 6, 12);
  });
  it("returns null for too few pairs, constant ranks, or invalid vectors", () => {
    expect(spearman([], [])).toBeNull();
    expect(spearman([1], [2])).toBeNull();
    expect(spearman([1, 1], [1, 2])).toBeNull();
    expect(spearman([1, 2], [2, 2])).toBeNull();
    expect(spearman([1, 2], [1])).toBeNull();
    expect(spearman([1, NaN], [1, 2])).toBeNull();
    expect(spearman([1, 2], [1, Infinity])).toBeNull();
  });
  it("does not mutate its inputs", () => {
    const xs = [3, 1, 2],
      ys = [6, 2, 4];
    spearman(xs, ys);
    expect(xs).toEqual([3, 1, 2]);
    expect(ys).toEqual([6, 2, 4]);
  });
});

describe("daily drivers", () => {
  it("pairs calendar predecessors across month boundaries and skips gaps", () => {
    const input = rows(12).map((row, i) => ({
      ...row,
      day: shiftDay("2026-01-25", i + Math.floor(i / 2)),
    }));
    const findings = drivers(input.reverse(), { minDays: 6 });
    expect(findings.find((f) => f.lag === 0)).toMatchObject({ n: 12, rho: 1 });
    expect(findings.find((f) => f.lag === 1)).toMatchObject({
      n: 6,
      rho: 1,
      split: 5,
      highMean: 9,
      lowMean: 3,
    });
  });
  it("pairs only observed factors and outcomes, independently for each outcome", () => {
    const input = rows(12);
    input[0].factors = {};
    input[1].outcomes = {};
    input[2].outcomes.mood = 4;
    expect(drivers(input).find((f) => f.lag === 0)).toMatchObject({ n: 10 });
    expect(drivers(input).some((f) => f.outcome === "mood")).toBe(false);
  });
  it("enforces the default and custom minimum days", () => {
    expect(drivers(rows(9))).toEqual([]);
    expect(drivers(rows(9), { minDays: 9 }).find((f) => f.lag === 0)?.n).toBe(
      9,
    );
    expect(drivers(rows(10), { minDays: 11 })).toEqual([]);
    expect(() => drivers(rows(10), { minDays: 0 })).toThrow("positive integer");
  });
  it("excludes constant factors/outcomes and groups with fewer than three days", () => {
    expect(
      drivers(rows(12).map((r) => ({ ...r, factors: { sleepHours: 7 } }))),
    ).toEqual([]);
    expect(
      drivers(rows(12).map((r) => ({ ...r, outcomes: { energy: 3 } }))),
    ).toEqual([]);
    const skewed = rows(12).map((r, i) => ({
      ...r,
      factors: { waterMl: i < 10 ? 1000 : 3000 },
    }));
    expect(drivers(skewed)).toEqual([]);
    expect(drivers(rows(5), { minDays: 2 })).toEqual([]);
  });
  it("splits at the median of paired observations and reports outcome means", () => {
    const input = rows(10).map((r, i) => ({
      ...r,
      factors: { waterMl: (i + 1) * 100 },
      outcomes: { mood: i < 5 ? 2 : 4 },
    }));
    expect(drivers(input).find((f) => f.lag === 0)).toMatchObject({
      factor: "waterMl",
      outcome: "mood",
      n: 10,
      split: 550,
      highMean: 4,
      lowMean: 2,
    });
    expect(drivers(rows(11)).find((f) => f.lag === 0)).toMatchObject({
      split: 5,
      highMean: 8,
      lowMean: 2.5,
    });
  });
  it("compares trained 1 versus 0 even when the median is 1", () => {
    const input = rows(10).map((r, i) => ({
      ...r,
      factors: { trained: i < 3 ? 0 : 1 },
      outcomes: { energy: i < 3 ? 2 : 5 },
    }));
    expect(drivers(input).find((f) => f.lag === 0)).toMatchObject({
      split: 1,
      rho: 1,
      highMean: 5,
      lowMean: 2,
      n: 10,
    });
  });
  it("sorts by absolute rho, then by sample size", () => {
    const input = rows(20).map((r, i) => ({
      ...r,
      factors: {
        sleepHours: i,
        ...(i < 12 ? { waterMl: -i } : {}),
        proteinG: i % 7,
      },
    }));
    const findings = drivers(input);
    expect(findings[0]).toMatchObject({
      factor: "sleepHours",
      lag: 0,
      n: 20,
      rho: 1,
    });
    expect(findings.find((f) => f.factor === "waterMl")?.rho).toBe(-1);
    for (let i = 1; i < findings.length; i++) {
      const a = findings[i - 1],
        b = findings[i];
      expect(Math.abs(a.rho)).toBeGreaterThanOrEqual(Math.abs(b.rho));
      if (Math.abs(a.rho) === Math.abs(b.rho))
        expect(a.n).toBeGreaterThanOrEqual(b.n);
    }
    expect(Math.abs(findings[findings.length - 1].rho)).toBeLessThan(1);
  });
  it.each([
    [40, 12, 0.2, "weak"],
    [40, 13, 0.3, "moderate"],
    [8, 3, 0.5, "strong"],
    [8, 1, -0.5, "strong"],
  ])(
    "labels n=%s, concordant per half=%s, rho=%s as %s",
    (n, concordant, rho, strength) => {
      const input = rows(n).map((r, i) => {
        const high = i >= n / 2;
        const agrees = i % (n / 2) < concordant;
        return {
          ...r,
          factors: { trained: high ? 1 : 0 },
          outcomes: { energy: high === agrees ? 5 : 1 },
        };
      });
      expect(
        drivers(input, { minDays: 6 }).find((f) => f.lag === 0),
      ).toMatchObject({ rho, strength });
    },
  );
  it.each([
    [20, "early"],
    [21, "steady"],
  ])("labels %s pairs as %s", (n, confidence) => {
    expect(drivers(rows(n)).find((f) => f.lag === 0)?.confidence).toBe(
      confidence,
    );
  });
  it("exports labels and units for all schema-backed factors", () => {
    expect(Object.keys(FACTORS)).toEqual([
      "sleepHours",
      "waterMl",
      "proteinG",
      "kcal",
      "caffeineMg",
      "lateCaffeineMg",
      "trained",
    ]);
    expect(Object.values(FACTORS).every((f) => f.label && f.unit)).toBe(true);
  });
});

describe("driver sentences", () => {
  it("states same-day and previous-day comparisons", () => {
    expect(summarize(finding())).toBe(
      "On days with more than 2.1 L of water, your mood averages 4.1 vs 3.5 on other days.",
    );
    expect(
      summarize(
        finding({
          factor: "trained",
          outcome: "energy",
          lag: 1,
          highMean: 3.9,
          lowMean: 3.2,
        }),
      ),
    ).toBe(
      "The day after you train, your energy averages 3.9 vs 3.2 on other days.",
    );
    expect(summarize(finding({ factor: "trained" }))).toContain(
      "On days you train,",
    );
    expect(
      summarize(finding({ factor: "lateCaffeineMg", lag: 1, split: 95 })),
    ).toContain("The day after more than 95 mg of caffeine from 2 PM,");
  });
  it.each([
    ["sleepHours", 7.25, "7.3 h of sleep"],
    ["proteinG", 103.4, "103 g of protein"],
    ["kcal", 2010.3, "2,010 kcal of food"],
    ["caffeineMg", 95.2, "95 mg of caffeine"],
    ["lateCaffeineMg", 50.1, "50 mg of caffeine from 2 PM"],
    ["caffeineMg", 0, "On days with any caffeine,"],
    ["lateCaffeineMg", 0, "On days with any caffeine from 2 PM,"],
  ] satisfies [Finding["factor"], number, string][])(
    "formats %s",
    (factor, split, text) => {
      expect(summarize(finding({ factor, split }))).toContain(text);
    },
  );
  it("uses no causal words for any factor or lag", () => {
    const input = rows(30).map((r, i) => ({
      ...r,
      outcomes: { mood: i, energy: i },
      factors: {
        sleepHours: i,
        waterMl: i,
        proteinG: i,
        kcal: i,
        caffeineMg: i,
        lateCaffeineMg: i,
        trained: i < 15 ? 0 : 1,
      },
    }));
    const findings = drivers(input);
    expect(findings).toHaveLength(28);
    for (const f of findings)
      expect(summarize(f)).not.toMatch(
        /\b(causes?|because|makes?|leads?|improves?|reduces?)\b/i,
      );
  });
});

describe("isClear", () => {
  const f = (rho: number, n: number) =>
    ({
      rho,
      n,
      strength:
        Math.abs(rho) < 0.3
          ? "weak"
          : Math.abs(rho) < 0.5
            ? "moderate"
            : "strong",
    }) as Finding;
  it("needs a larger correlation on fewer days", () => {
    // 2 / sqrt(11) ≈ 0.603 on 12 days; 2 / sqrt(39) ≈ 0.320 on 40 days.
    expect(isClear(f(0.6, 12))).toBe(false);
    expect(isClear(f(-0.61, 12))).toBe(true);
    expect(isClear(f(0.33, 40))).toBe(true);
    expect(isClear(f(-0.31, 40))).toBe(false);
    // Weak never counts, however many days.
    expect(isClear(f(0.29, 400))).toBe(false);
  });
});

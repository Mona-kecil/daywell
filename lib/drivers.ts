import { shiftDay } from "./history";

export const FACTORS = {
  sleepHours: { label: "Sleep", unit: "h" },
  waterMl: { label: "Water", unit: "ml" },
  proteinG: { label: "Protein", unit: "g" },
  kcal: { label: "Calories", unit: "kcal" },
  caffeineMg: { label: "Caffeine", unit: "mg" },
  lateCaffeineMg: { label: "Caffeine from 2 PM", unit: "mg" },
  trained: { label: "Training", unit: "0/1" },
} satisfies Record<string, { label: string; unit: string }>;

export type FactorId = keyof typeof FACTORS;
export type DayRow = {
  day: string; // YYYY-MM-DD local calendar day.
  factors: Partial<Record<FactorId, number>>;
  outcomes: Partial<Record<"mood" | "energy", number>>;
};
export type Finding = {
  factor: FactorId;
  outcome: "mood" | "energy";
  lag: 0 | 1;
  n: number;
  rho: number;
  highMean: number;
  lowMean: number;
  split: number;
  strength: "weak" | "moderate" | "strong";
  // Sample-size labels, not statistical significance or causal confidence.
  confidence: "early" | "steady";
};

function ranks(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const result = Array<number>(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value)
      end++;
    const rank = (start + 1 + end) / 2;
    for (let i = start; i < end; i++) result[sorted[i].index] = rank;
    start = end;
  }
  return result;
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (
    xs.length !== ys.length ||
    xs.length < 2 ||
    !xs.every(Number.isFinite) ||
    !ys.every(Number.isFinite)
  )
    return null;
  const xRanks = ranks(xs),
    yRanks = ranks(ys),
    mean = (xs.length + 1) / 2;
  let covariance = 0,
    xVariance = 0,
    yVariance = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xRanks[i] - mean,
      y = yRanks[i] - mean;
    covariance += x * y;
    xVariance += x * x;
    yVariance += y * y;
  }
  if (xVariance === 0 || yVariance === 0) return null;
  return Math.max(
    -1,
    Math.min(1, covariance / Math.sqrt(xVariance * yVariance)),
  );
}

export function drivers(
  rows: DayRow[],
  { minDays = 10 }: { minDays?: number } = {},
): Finding[] {
  if (!Number.isInteger(minDays) || minDays < 1)
    throw new RangeError("minDays must be a positive integer.");
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const findings: Finding[] = [];
  const factors: FactorId[] = [
    "sleepHours",
    "waterMl",
    "proteinG",
    "kcal",
    "caffeineMg",
    "lateCaffeineMg",
    "trained",
  ];
  for (const factor of factors) {
    for (const outcome of ["mood", "energy"] satisfies Finding["outcome"][]) {
      for (const lag of [0, 1] satisfies Finding["lag"][]) {
        const pairs: { x: number; y: number }[] = [];
        for (const row of rows) {
          const source = lag === 0 ? row : byDay.get(shiftDay(row.day, -1));
          const x = source?.factors[factor],
            y = row.outcomes[outcome];
          if (
            x !== undefined &&
            y !== undefined &&
            Number.isFinite(x) &&
            Number.isFinite(y)
          )
            pairs.push({ x, y });
        }
        if (pairs.length < minDays) continue;
        const rho = spearman(
          pairs.map((p) => p.x),
          pairs.map((p) => p.y),
        );
        if (rho === null) continue;
        const sorted = pairs.map((p) => p.x).sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        const split =
          sorted.length % 2 === 0
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle];
        const high = pairs.filter((p) =>
          factor === "trained" ? p.x === 1 : p.x > split,
        );
        const low = pairs.filter((p) =>
          factor === "trained" ? p.x === 0 : p.x <= split,
        );
        if (high.length < 3 || low.length < 3) continue;
        const magnitude = Math.abs(rho);
        findings.push({
          factor,
          outcome,
          lag,
          n: pairs.length,
          rho,
          highMean: high.reduce((sum, p) => sum + p.y, 0) / high.length,
          lowMean: low.reduce((sum, p) => sum + p.y, 0) / low.length,
          split,
          strength:
            magnitude < 0.3 ? "weak" : magnitude < 0.5 ? "moderate" : "strong",
          confidence: pairs.length < 21 ? "early" : "steady",
        });
      }
    }
  }
  return findings.sort(
    (a, b) => Math.abs(b.rho) - Math.abs(a.rho) || b.n - a.n,
  );
}

// Worth showing by default: at least moderate, and past the rough 95% bar for
// a rank correlation of n days, so 28 comparisons on a dozen days don't
// surface noise as a pattern.
export function isClear(finding: Finding): boolean {
  return (
    finding.strength !== "weak" &&
    Math.abs(finding.rho) >= 2 / Math.sqrt(finding.n - 1)
  );
}

export function summarize(finding: Finding): string {
  const { factor, outcome, lag, split, highMean, lowMean } = finding;
  const means = `your ${outcome} averages ${highMean.toFixed(1)} vs ${lowMean.toFixed(1)} on other days.`;
  if (factor === "trained")
    return `${lag === 1 ? "The day after" : "On days"} you train, ${means}`;
  // Most days have no caffeine, so the median split is often zero.
  const amounts = {
    sleepHours: `more than ${split.toFixed(1)} h of sleep`,
    waterMl: `more than ${(split / 1000).toFixed(1)} L of water`,
    proteinG: `more than ${Math.round(split)} g of protein`,
    kcal: `more than ${Math.round(split).toLocaleString()} kcal of food`,
    caffeineMg: split
      ? `more than ${Math.round(split)} mg of caffeine`
      : "any caffeine",
    lateCaffeineMg: split
      ? `more than ${Math.round(split)} mg of caffeine from 2 PM`
      : "any caffeine from 2 PM",
  } satisfies Record<Exclude<FactorId, "trained">, string>;
  return `${lag === 1 ? "The day after" : "On days with"} ${amounts[factor]}, ${means}`;
}

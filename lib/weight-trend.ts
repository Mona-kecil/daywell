import { dayNumber, shiftDay } from "./history";

export type WeighIn = { day: string; weightKg: number };
export type TrendPoint = {
  day: string;
  weightKg: number | null;
  trendKg: number;
};

export function trendSeries(weighIns: WeighIn[]): TrendPoint[] {
  const byDay = new Map(weighIns.map((row) => [row.day, row.weightKg]));
  const days = [...byDay.keys()].sort();
  const first = days.at(0);
  const last = days.at(-1);
  if (first === undefined || last === undefined) return [];
  let trendKg = byDay.get(first);
  if (trendKg === undefined) return [];
  const points: TrendPoint[] = [];
  const span = dayNumber(last) - dayNumber(first);
  for (let offset = 0; offset <= span; offset++) {
    const day = shiftDay(first, offset);
    const weightKg = byDay.get(day) ?? null;
    if (weightKg !== null) trendKg += 0.1 * (weightKg - trendKg);
    points.push({ day, weightKg, trendKg });
  }
  return points;
}

export function weeklyRate(series: TrendPoint[]): number | null {
  const last = series.at(-1);
  if (last === undefined) return null;
  const end = dayNumber(last.day);
  const window = series.filter((point) => {
    const day = dayNumber(point.day);
    return day >= end - 27 && day <= end;
  });
  const first = window.at(0);
  if (
    first === undefined ||
    end - dayNumber(first.day) < 13 ||
    window.filter((point) => point.weightKg !== null).length < 5
  )
    return null;
  const meanDay =
    window.reduce((sum, point) => sum + dayNumber(point.day) - end, 0) /
    window.length;
  const meanKg =
    window.reduce((sum, point) => sum + point.trendKg, 0) / window.length;
  let covariance = 0;
  let variance = 0;
  for (const point of window) {
    const day = dayNumber(point.day) - end - meanDay;
    covariance += day * (point.trendKg - meanKg);
    variance += day * day;
  }
  return (covariance / variance) * 7;
}

export type GoalEta =
  | { kind: "none" }
  | { kind: "reached" }
  | { kind: "flat" }
  | { kind: "away" }
  | { kind: "far" }
  | { kind: "eta"; day: string; weeks: number };

export function goalEta(input: {
  trendKg: number | null;
  ratePerWeek: number | null;
  goalKg: number | null;
  today: string;
}): GoalEta {
  const { trendKg, ratePerWeek, goalKg, today } = input;
  if (goalKg === null) return { kind: "none" };
  if (trendKg === null) return { kind: "flat" };
  const diff = goalKg - trendKg;
  if (Math.abs(diff) <= 0.3) return { kind: "reached" };
  if (ratePerWeek === null || Math.abs(ratePerWeek) < 0.05)
    return { kind: "flat" };
  if (Math.sign(ratePerWeek) !== Math.sign(diff)) return { kind: "away" };
  const weeks = Math.abs(diff) / Math.abs(ratePerWeek);
  if (weeks > 104) return { kind: "far" };
  return {
    kind: "eta",
    day: shiftDay(today, Math.ceil(weeks * 7)),
    weeks: Math.round(weeks * 10) / 10,
  };
}

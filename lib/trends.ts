import { e1rm, type StrengthSet } from "./strength";

export const TREND_WEEKS = 8;
export const STALL_SESSIONS = 4;
export const LAPSED_DAYS = 21;
export const FLAT_PCT = 0.5;

export type LiftSession = { trainedAt: number; sets: StrengthSet[] };
export type LiftTrend = {
  status: "lapsed" | "early" | "climbing" | "slipping" | "stalled" | "steady";
  unit: "reps" | "kg";
  points: { at: number; value: number }[];
  best: number;
  bestAt: number | null;
  sessionsSinceBest: number;
  changePct: number | null;
  lastAt: number | null;
};

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const round = (value: number) => Number(value.toFixed(1));

function weeklyChange(points: LiftTrend["points"], now: number): number | null {
  if (points.length < 3) return null;
  const mean =
    points.reduce((sum, point) => sum + point.value, 0) / points.length;
  if (mean === 0) return null;
  const meanWeek =
    points.reduce((sum, point) => sum + (point.at - now) / WEEK_MS, 0) /
    points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const week = (point.at - now) / WEEK_MS - meanWeek;
    covariance += week * (point.value - mean);
    variance += week * week;
  }
  return variance === 0 ? null : round((covariance / variance / mean) * 100);
}

export function liftTrend(sessions: LiftSession[], now: number): LiftTrend {
  const history = sessions
    .filter((session) => session.sets.length > 0 && session.trainedAt <= now)
    .sort((a, b) => a.trainedAt - b.trainedAt);
  const start = now - TREND_WEEKS * WEEK_MS;
  const window = history.filter((session) => session.trainedAt >= start);
  // With no window sessions, keep the last known unit for lapsed lifts.
  const unit = (window.length ? window : history).every((session) =>
    session.sets.every((set) => set.weightKg === 0),
  )
    ? "reps"
    : "kg";
  const values = history.map((session) => ({
    at: session.trainedAt,
    value: Math.max(
      ...session.sets.map((set) => (unit === "reps" ? set.reps : e1rm(set))),
    ),
  }));
  let best = 0;
  let bestIndex = -1;
  for (const [index, point] of values.entries()) {
    if (bestIndex === -1 || point.value > best) {
      best = point.value;
      bestIndex = index;
    }
  }
  const points = values.filter((point) => point.at >= start);
  const last = values.at(-1);
  const lastAt = last?.at ?? null;
  const bestAt = values[bestIndex]?.at ?? null;
  const sessionsSinceBest =
    bestIndex === -1 ? 0 : values.length - bestIndex - 1;
  const changePct = weeklyChange(points, now);
  let status: LiftTrend["status"];
  if (lastAt !== null && now - lastAt > LAPSED_DAYS * DAY_MS) status = "lapsed";
  else if (points.length < 3) status = "early";
  else if (
    sessionsSinceBest < 2 ||
    (changePct !== null && changePct > FLAT_PCT)
  )
    status = "climbing";
  else if (
    changePct !== null &&
    changePct < -2 * FLAT_PCT &&
    last &&
    last.value < 0.95 * best
  )
    status = "slipping";
  else if (sessionsSinceBest >= STALL_SESSIONS) status = "stalled";
  else status = "steady";
  return {
    status,
    unit,
    points: points.map((point) => ({ ...point, value: round(point.value) })),
    best,
    bestAt,
    sessionsSinceBest,
    changePct,
    lastAt,
  };
}

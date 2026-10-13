import { localClock } from "./coach-time";
import {
  DAY_MS,
  dayNumber,
  historyThroughNow,
  strengthPRs,
  type HistoryInput,
} from "./history";

export type Achievement = {
  id: string;
  title: string;
  detail: string;
  earnedAt: number | null;
  progress: { value: number; target: number };
};

function streakAchievement(
  days: { day: string; at: number }[],
  target: number,
) {
  let run = 0,
    best = 0,
    previous = -Infinity;
  let earnedAt: number | null = null;
  for (const row of days) {
    const day = dayNumber(row.day);
    if (day === previous) continue;
    run = day === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    if (run >= target && earnedAt === null) earnedAt = row.at;
    previous = day;
  }
  return { earnedAt, progress: { value: Math.min(best, target), target } };
}

export function computeAchievements(input: HistoryInput): Achievement[] {
  const data = historyThroughNow(input);
  const result: Achievement[] = [];
  const count = (
    id: string,
    title: string,
    detail: string,
    times: number[],
    target: number,
  ) => {
    result.push({
      id,
      title,
      detail,
      earnedAt: times[target - 1] ?? null,
      progress: { value: Math.min(times.length, target), target },
    });
  };
  const workouts = data.workouts.map((w) => w.trainedAt);
  count("first-workout", "First workout", "Log a workout.", workouts, 1);
  for (const target of [10, 50])
    count(
      `workouts-${target}`,
      `${target} workouts`,
      `Log ${target} workouts.`,
      workouts,
      target,
    );
  for (const target of [100, 1000])
    count(
      `sets-${target}`,
      `${target} strength sets`,
      `Log ${target} strength sets.`,
      data.sets.map((s) => s.trainedAt),
      target,
    );
  count(
    "first-pr",
    "First PR",
    "Beat an exercise's previous session e1RM.",
    strengthPRs(data.sets).map((p) => p.at),
    1,
  );

  const waterDays = new Map<string, { total: number; at: number | null }>();
  for (const water of data.water) {
    const day = localClock(water.at, data.timeZone).localDay;
    const row = waterDays.get(day) ?? { total: 0, at: null };
    row.total += water.amountMl;
    if (row.at === null && row.total >= data.waterGoal) row.at = water.at;
    waterDays.set(day, row);
  }
  const goalDays = [...waterDays].flatMap(([day, row]) =>
    row.at === null ? [] : [{ day, at: row.at }],
  );
  for (const target of [3, 7, 30])
    result.push({
      id: `water-streak-${target}`,
      title: `${target}-day water streak`,
      detail: `Meet your current water goal on ${target} consecutive local days.`,
      ...streakAchievement(goalDays, target),
    });
  result.push({
    id: "checkin-streak-7",
    title: "7-day check-in streak",
    detail: "Log a body check-in on 7 consecutive days.",
    ...streakAchievement(
      data.checkins.map((c) => ({ day: c.day, at: dayNumber(c.day) * DAY_MS })),
      7,
    ),
  });

  const muscles = new Set(data.muscleIds);
  const lastDay = new Map<string, number>();
  let best = 0;
  let earnedAt: number | null = null;
  for (const workout of data.workouts) {
    const day = dayNumber(
      localClock(workout.trainedAt, data.timeZone).localDay,
    );
    for (const id of workout.muscleIds)
      if (muscles.has(id)) lastDay.set(id, day);
    const trained = [...lastDay.values()].filter(
      (last) => day - last < 7,
    ).length;
    best = Math.max(best, trained);
    if (muscles.size > 0 && trained === muscles.size && earnedAt === null)
      earnedAt = workout.trainedAt;
  }
  result.push({
    id: "all-muscles-7",
    title: "Every muscle in a week",
    detail: "Train every current muscle within 7 local calendar days.",
    earnedAt,
    progress: { value: best, target: muscles.size },
  });
  count(
    "meals-10",
    "10 meals analysed",
    "Log 10 analysed meals, including manual and repeated meals.",
    data.meals.map((m) => m.at),
    10,
  );
  return result;
}

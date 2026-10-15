import { activeMinutes, type CardioEffort, type CardioKind } from "./cardio";
import { localClock } from "./coach-time";
import {
  dayNumber,
  hasCheckinData,
  strengthPRs,
  type HistoryInput,
} from "./history";
import { trendSeries } from "./weight-trend";

export function monthRange(month: string, today: string) {
  if (
    month.length !== 7 ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    month > today.slice(0, 7)
  )
    throw new RangeError("Choose a month up to this one.");
  const fromDay = `${month}-01`;
  const end = new Date(`${fromDay}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const toDay =
    month === today.slice(0, 7) ? today : end.toISOString().slice(0, 10);
  return { fromDay, toDay, days: dayNumber(toDay) - dayNumber(fromDay) + 1 };
}

type RecapInput = Omit<HistoryInput, "muscleIds"> & {
  month: string;
  muscles: { _id: string; name: string }[];
  cardio: {
    day: string;
    kind: CardioKind;
    effort: CardioEffort;
    minutes: number;
    distanceKm?: number;
    createdAt: number;
  }[];
};
type DayRange = Pick<ReturnType<typeof monthRange>, "fromDay" | "toDay">;
const inRange = (day: string, range: DayRange) =>
  day >= range.fromDay && day <= range.toDay;
const round1 = (value: number) => Math.round(value * 10) / 10;

export function monthlyRecap(input: RecapInput) {
  const localDay = (at: number) => localClock(at, input.timeZone).localDay;
  const today = localDay(input.now);
  const range = monthRange(input.month, today);
  const previousEnd = new Date(`${range.fromDay}T00:00:00Z`);
  previousEnd.setUTCDate(0);
  // Preserve the extended ISO year when January 0000 rolls into year -1.
  const previousToDay = previousEnd.toISOString().split("T")[0];
  const previousRange = {
    fromDay: `${previousToDay.slice(0, -2)}01`,
    toDay: previousToDay,
  };
  const throughEnd = (at: number) =>
    at <= input.now && localDay(at) <= range.toDay;
  const workouts = input.workouts
    .filter((w) => throughEnd(w.trainedAt))
    .map((w) => ({ ...w, day: localDay(w.trainedAt) }));
  const allSets = input.sets.filter((s) => throughEnd(s.trainedAt));
  const sets = allSets.filter((s) => inRange(localDay(s.trainedAt), range));
  const water = input.water
    .filter((w) => throughEnd(w.at))
    .map((w) => ({ ...w, day: localDay(w.at) }));
  const meals = input.meals
    .filter((m) => throughEnd(m.at) && m.analysis.status === "ready")
    .map((m) => ({ day: localDay(m.at) }));
  const checkins = input.checkins.filter(
    (c) => c.day <= range.toDay && hasCheckinData(c),
  );
  const habitLogs = (input.habitLogs ?? []).filter(
    (l) => l.day <= range.toDay && l._creationTime <= input.now,
  );
  const cardio = input.cardio.filter(
    (c) => c.day <= range.toDay && c.createdAt <= input.now,
  );
  const loggedDays = (window: DayRange) =>
    new Set(
      [...workouts, ...water, ...meals, ...checkins, ...habitLogs, ...cardio]
        .filter((row) => inRange(row.day, window))
        .map((row) => row.day),
    ).size;
  const monthWorkouts = workouts.filter((w) => inRange(w.day, range));
  const monthCardio = cardio.filter((c) => inRange(c.day, range));
  const muscleCounts = new Map<string, number>();
  for (const workout of monthWorkouts)
    for (const id of new Set(workout.muscleIds))
      muscleCounts.set(id, (muscleCounts.get(id) ?? 0) + 1);
  const topMuscles = input.muscles
    .flatMap((muscle) => {
      const count = muscleCounts.get(muscle._id);
      return count === undefined
        ? []
        : [{ name: muscle.name, workouts: count }];
    })
    .sort((a, b) => b.workouts - a.workouts || a.name.localeCompare(b.name))
    .slice(0, 3);
  const kindMinutes = new Map<CardioKind, number>();
  for (const session of monthCardio)
    kindMinutes.set(
      session.kind,
      (kindMinutes.get(session.kind) ?? 0) + session.minutes,
    );
  const topKind =
    [...kindMinutes].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0] ?? null;
  const weighIns = checkins.flatMap((c) =>
    c.weightKg === undefined ? [] : [{ day: c.day, weightKg: c.weightKg }],
  );
  const series = trendSeries(weighIns).filter((point) =>
    inRange(point.day, range),
  );
  const first = series.at(0),
    last = series.at(-1);
  let weight: { startKg: number; endKg: number; changeKg: number } | null =
    null;
  if (
    weighIns.filter((w) => inRange(w.day, range)).length >= 2 &&
    first &&
    last
  ) {
    const startKg = round1(first.trendKg),
      endKg = round1(last.trendKg);
    weight = { startKg, endKg, changeKg: round1(endKg - startKg) };
  }
  const activeHabits = (input.habits ?? []).filter(
    (h) => h.archivedAt === undefined && h.createdAt <= input.now,
  );
  const activeIds = new Set(activeHabits.map((h) => h._id));
  const habits =
    (input.habits ?? []).length === 0
      ? null
      : {
          done: habitLogs.filter(
            (l) => activeIds.has(l.habitId) && inRange(l.day, range),
          ).length,
          possible: activeHabits.reduce((sum, habit) => {
            const firstDay = habitLogs
              .filter((l) => l.habitId === habit._id)
              .reduce(
                (day, log) => (log.day < day ? log.day : day),
                localDay(habit.createdAt),
              );
            const startDay =
              firstDay > range.fromDay ? firstDay : range.fromDay;
            return (
              sum +
              Math.max(0, dayNumber(range.toDay) - dayNumber(startDay) + 1)
            );
          }, 0),
        };
  const waterByDay = new Map<string, number>();
  for (const row of water.filter((w) => inRange(w.day, range)))
    waterByDay.set(row.day, (waterByDay.get(row.day) ?? 0) + row.amountMl);
  const sleep = checkins
    .filter((c) => inRange(c.day, range))
    .flatMap((c) => (c.sleepHours === undefined ? [] : [c.sleepHours]));
  const workoutDays = new Set(monthWorkouts.map((w) => w.day));
  const cardioDays = new Set(monthCardio.map((c) => c.day));
  const bothDay = [...workoutDays]
    .filter((day) => cardioDays.has(day))
    .sort()
    .at(-1);
  const setsByDay = new Map<string, number>();
  for (const set of sets) {
    const day = localDay(set.trainedAt);
    setsByDay.set(day, (setsByDay.get(day) ?? 0) + 1);
  }
  // Prefer the latest day with both activities; otherwise most sets (latest tie),
  // including zero-set workouts; otherwise the latest cardio day.
  const workoutDay = [...workoutDays].sort(
    (a, b) =>
      (setsByDay.get(b) ?? 0) - (setsByDay.get(a) ?? 0) || b.localeCompare(a),
  )[0];
  const cardioDay = [...cardioDays].sort().at(-1);
  let best: {
    day: string;
    reason: "workout+cardio" | "workout" | "cardio";
  } | null = null;
  if (bothDay) best = { day: bothDay, reason: "workout+cardio" };
  else if (workoutDay) best = { day: workoutDay, reason: "workout" };
  else if (cardioDay) best = { day: cardioDay, reason: "cardio" };
  return {
    month: input.month,
    ...range,
    daysLogged: loggedDays(range),
    workouts: monthWorkouts.length,
    totalSets: sets.length,
    volumeKg: Math.round(sets.reduce((sum, s) => sum + s.reps * s.weightKg, 0)),
    newPRs: strengthPRs(allSets).filter((pr) => inRange(localDay(pr.at), range))
      .length,
    topMuscles,
    cardio: {
      sessions: monthCardio.length,
      minutes: round1(monthCardio.reduce((sum, c) => sum + c.minutes, 0)),
      activeMinutes: round1(
        monthCardio.reduce(
          (sum, c) => sum + activeMinutes(c.minutes, c.effort),
          0,
        ),
      ),
      distanceKm: round1(
        monthCardio.reduce((sum, c) => sum + (c.distanceKm ?? 0), 0),
      ),
      topKind,
    },
    weight,
    habits,
    water: {
      avgMl: Math.round(
        [...waterByDay.values()].reduce((sum, ml) => sum + ml, 0) / range.days,
      ),
      goalMl: input.waterGoal,
      daysAtGoal: [...waterByDay.values()].filter((ml) => ml >= input.waterGoal)
        .length,
    },
    sleep: {
      avgHours: sleep.length
        ? round1(sleep.reduce((sum, h) => sum + h, 0) / sleep.length)
        : null,
      days: sleep.length,
    },
    best,
    previous: {
      workouts: workouts.filter((w) => inRange(w.day, previousRange)).length,
      cardioActiveMinutes: round1(
        cardio
          .filter((c) => inRange(c.day, previousRange))
          .reduce((sum, c) => sum + activeMinutes(c.minutes, c.effort), 0),
      ),
      daysLogged: loggedDays(previousRange),
    },
  };
}
export type MonthlyRecap = ReturnType<typeof monthlyRecap>;

import { activeMinutes, ACTIVE_MINUTES_GOAL } from "./cardio";
import { localClock } from "./coach-time";
import {
  DAY_MS,
  dayNumber,
  historyThroughNow,
  shiftDay,
  strengthPRs,
  type HistoryInput,
} from "./history";

export function isoWeek(day: string) {
  const date = new Date(dayNumber(day) * DAY_MS);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const year = date.getUTCFullYear();
  const week = Math.ceil(
    ((date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7,
  );
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function weeklySummary(input: HistoryInput) {
  const data = historyThroughNow(input);
  const toDay = localClock(data.now, data.timeZone).localDay;
  const fromDay = shiftDay(toDay, -6);
  const inWeek = (at: number) =>
    localClock(at, data.timeZone).localDay >= fromDay;
  const workouts = data.workouts.filter((w) => inWeek(w.trainedAt));
  const sets = data.sets.filter((s) => inWeek(s.trainedAt));
  const water = data.water.filter((w) => inWeek(w.at));
  const meals = data.meals.filter((m) => inWeek(m.at));
  const checkins = data.checkins.filter((c) => c.day >= fromDay);
  const cardio = data.cardio?.filter(
    (row) => row.day >= fromDay && row.day <= toDay,
  );
  const sleep = checkins.flatMap((c) =>
    c.sleepHours === undefined ? [] : [c.sleepHours],
  );
  const logged = new Set([
    ...workouts.map((w) => localClock(w.trainedAt, data.timeZone).localDay),
    ...water.map((w) => localClock(w.at, data.timeZone).localDay),
    ...meals.map((m) => localClock(m.at, data.timeZone).localDay),
    ...checkins.map((c) => c.day),
    ...(cardio ?? []).map((row) => row.day),
  ]);
  const avgWaterMl = water.reduce((sum, w) => sum + w.amountMl, 0) / 7;
  const activeHabits = (data.habits ?? []).filter(
    (habit) => habit.archivedAt === undefined && habit.createdAt <= data.now,
  );
  const activeIds = new Set(activeHabits.map((habit) => habit._id));
  const doneLogs = (data.habitLogs ?? []).filter(
    (log) => activeIds.has(log.habitId) && log.day >= fromDay,
  );
  const habitsDone = doneLogs.length;
  const habitsPossible = activeHabits.reduce((sum, habit) => {
    // A day ticked off before the habit was made still had a chance.
    const firstDay = [
      localClock(habit.createdAt, data.timeZone).localDay,
      ...doneLogs.filter((l) => l.habitId === habit._id).map((l) => l.day),
    ].reduce((a, b) => (b < a ? b : a));
    const startDay = firstDay > fromDay ? firstDay : fromDay;
    return sum + dayNumber(toDay) - dayNumber(startDay) + 1;
  }, 0);
  return {
    ...(cardio === undefined
      ? {}
      : {
          cardioSessions: cardio.length,
          cardioMinutes:
            Math.round(cardio.reduce((sum, row) => sum + row.minutes, 0) * 10) /
            10,
          cardioActiveMinutes:
            Math.round(
              cardio.reduce(
                (sum, row) => sum + activeMinutes(row.minutes, row.effort),
                0,
              ) * 10,
            ) / 10,
          cardioGoal: ACTIVE_MINUTES_GOAL,
        }),
    ...(data.habits === undefined ? {} : { habitsDone, habitsPossible }),
    fromDay,
    toDay,
    isoWeek: isoWeek(toDay),
    workouts: workouts.length,
    totalSets: sets.length,
    newPRs: strengthPRs(data.sets).filter((p) => inWeek(p.at)).length,
    avgSleepHours: sleep.length
      ? sleep.reduce((sum, hours) => sum + hours, 0) / sleep.length
      : null,
    sleepDays: sleep.length,
    avgWaterMl,
    waterGoalMl: data.waterGoal,
    waterGoalPercent: (avgWaterMl / data.waterGoal) * 100,
    daysLogged: logged.size,
  };
}
export type WeeklySummary = ReturnType<typeof weeklySummary>;

export function weeklyReviewText(summary: WeeklySummary) {
  const count = (value: number, noun: string) =>
    `${value} ${noun}${value === 1 ? "" : "s"}`;
  const sleep =
    summary.avgSleepHours === null
      ? "Sleep not logged"
      : `Sleep ${summary.avgSleepHours.toFixed(1)} h avg`;
  const cardio =
    summary.cardioSessions !== undefined && summary.cardioSessions > 0
      ? ` Cardio ${count(summary.cardioSessions, "session")}, ${Math.round(summary.cardioActiveMinutes ?? 0)} of ${summary.cardioGoal} active min.`
      : "";
  const habits =
    summary.habitsPossible !== undefined && summary.habitsPossible > 0
      ? ` Habits ${summary.habitsDone}/${summary.habitsPossible} done.`
      : "";
  return {
    title: "Your weekly review",
    body: `${count(summary.workouts, "workout")} · ${count(summary.totalSets, "set")} · ${count(summary.newPRs, "new PR")}. ${sleep}. Water ${Math.round(summary.avgWaterMl)} / ${summary.waterGoalMl} ml avg (${Math.round(summary.waterGoalPercent)}%).${cardio} Logged ${summary.daysLogged}/7 days.${habits}`,
  };
}

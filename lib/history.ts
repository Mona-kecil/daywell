import { localClock } from "./coach-time";
import { e1rm, type StrengthSet } from "./strength";

export const DAY_MS = 86_400_000;
export const dayNumber = (day: string) =>
  Date.parse(`${day}T00:00:00Z`) / DAY_MS;
export const shiftDay = (day: string, offset: number) =>
  new Date((dayNumber(day) + offset) * DAY_MS).toISOString().slice(0, 10);

export type HistorySet = StrengthSet & {
  exerciseId: string;
  workoutId: string;
  trainedAt: number;
};

// Compare session maxima, so a stronger second set in the first session is not a PR.
export function strengthPRs(sets: HistorySet[]) {
  const sessions = new Map<
    string,
    { exerciseId: string; workoutId: string; at: number; best: number }
  >();
  for (const set of sets) {
    const key = `${set.exerciseId}/${set.workoutId}`;
    const session = sessions.get(key) ?? {
      exerciseId: set.exerciseId,
      workoutId: set.workoutId,
      at: set.trainedAt,
      best: 0,
    };
    session.best = Math.max(session.best, e1rm(set));
    sessions.set(key, session);
  }
  const best = new Map<string, number>();
  const prs: { exerciseId: string; at: number }[] = [];
  for (const session of [...sessions.values()].sort(
    (a, b) => a.at - b.at || a.workoutId.localeCompare(b.workoutId),
  )) {
    const previous = best.get(session.exerciseId);
    if (previous !== undefined && session.best > previous)
      prs.push({ exerciseId: session.exerciseId, at: session.at });
    best.set(session.exerciseId, Math.max(previous ?? 0, session.best));
  }
  return prs;
}

export type HistoryInput = {
  now: number;
  timeZone: string;
  waterGoal: number;
  muscleIds: string[];
  workouts: { trainedAt: number; muscleIds: string[] }[];
  sets: HistorySet[];
  water: { at: number; amountMl: number }[];
  meals: { at: number; analysis: { status: string } }[];
  checkins: {
    day: string;
    weightKg?: number;
    sleepHours?: number;
    mood?: number;
    energy?: number;
    note?: string;
  }[];
  habits?: { _id: string; createdAt: number; archivedAt?: number }[];
  habitLogs?: { habitId: string; day: string; _creationTime: number }[];
};

export function hasCheckinData(row: HistoryInput["checkins"][number]) {
  return (
    row.weightKg !== undefined ||
    row.sleepHours !== undefined ||
    row.mood !== undefined ||
    row.energy !== undefined ||
    Boolean(row.note?.trim())
  );
}

export function historyThroughNow(input: HistoryInput): HistoryInput {
  const today = localClock(input.now, input.timeZone).localDay;
  return {
    ...input,
    habitLogs: input.habitLogs?.filter(
      (log) => log.day <= today && log._creationTime <= input.now,
    ),
    workouts: input.workouts
      .filter((w) => w.trainedAt <= input.now)
      .sort((a, b) => a.trainedAt - b.trainedAt),
    sets: input.sets
      .filter((s) => s.trainedAt <= input.now)
      .sort((a, b) => a.trainedAt - b.trainedAt),
    water: input.water
      .filter((w) => w.at <= input.now)
      .sort((a, b) => a.at - b.at),
    meals: input.meals
      .filter((m) => m.at <= input.now && m.analysis.status === "ready")
      .sort((a, b) => a.at - b.at),
    checkins: input.checkins
      .filter((c) => c.day <= today && hasCheckinData(c))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}

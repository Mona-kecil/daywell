import { localClock } from "./coach-time";
import { DAY_MS, dayNumber, shiftDay, type HistorySet } from "./history";
import { workingSets } from "./strength";

export const VOLUME_LOW = 10;
export const VOLUME_HIGH = 20;

export type VolumeSet = HistorySet & { muscleIds: string[] };
export type VolumeMuscle = { id: string; name: string };
export type WeeklyVolume = {
  weeks: { start: string; perMuscle: Record<string, number> }[];
  muscles: (VolumeMuscle & {
    current: number;
    average: number;
    status: "none" | "low" | "on-track" | "high";
  })[];
};

export function weekStart(ms: number, timeZone: string): string {
  const day = localClock(ms, timeZone).localDay;
  // 1970-01-01 was Thursday; Monday is day zero of the week.
  const weekday = (((dayNumber(day) + 3) % 7) + 7) % 7;
  return shiftDay(day, -weekday);
}

function localDayStart(day: string, timeZone: string): number {
  const utc = dayNumber(day) * DAY_MS;
  let before = utc - DAY_MS;
  let after = utc + DAY_MS;
  // Find the local date boundary through the shared clock helper. This also
  // handles DST without assuming a fixed offset or a 24-hour local day.
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (localClock(middle, timeZone).localDay < day) before = middle;
    else after = middle;
  }
  return after;
}

export function weeklyVolume(
  sets: VolumeSet[],
  muscles: VolumeMuscle[],
  { timeZone, weeks, now }: { timeZone: string; weeks: number; now: number },
): WeeklyVolume {
  if (!Number.isInteger(weeks) || weeks < 2 || weeks > 12)
    throw new RangeError("Weeks must be an integer from 2–12.");
  const currentStart = weekStart(now, timeZone);
  const buckets = Array.from({ length: weeks }, (_, index) => ({
    start: shiftDay(currentStart, (index - weeks + 1) * 7),
    perMuscle: Object.fromEntries(muscles.map((muscle) => [muscle.id, 0])),
  }));
  const byWeek = new Map(buckets.map((bucket) => [bucket.start, bucket]));
  const sessions = new Map<string, VolumeSet[]>();
  for (const set of sets) {
    if (set.trainedAt > now || !byWeek.has(weekStart(set.trainedAt, timeZone)))
      continue;
    const key = `${set.workoutId}/${set.exerciseId}`;
    const session = sessions.get(key) ?? [];
    session.push(set);
    sessions.set(key, session);
  }
  for (const session of sessions.values()) {
    for (const set of workingSets(session)) {
      const bucket = byWeek.get(weekStart(set.trainedAt, timeZone));
      if (!bucket) continue;
      // One working set counts as one set for each muscle in its muscleIds.
      for (const id of new Set(set.muscleIds))
        if (Object.hasOwn(bucket.perMuscle, id)) bucket.perMuscle[id] += 1;
    }
  }
  const startMs = localDayStart(currentStart, timeZone);
  const endMs = localDayStart(shiftDay(currentStart, 7), timeZone);
  const fraction = (now - startMs) / (endMs - startMs);
  return {
    weeks: buckets,
    muscles: muscles.map((muscle) => {
      const current = byWeek.get(currentStart)?.perMuscle[muscle.id] ?? 0;
      const average =
        buckets
          .slice(0, -1)
          .reduce((sum, week) => sum + week.perMuscle[muscle.id], 0) /
        (weeks - 1);
      const status =
        current === 0
          ? "none"
          : current < fraction * VOLUME_LOW
            ? "low"
            : current > VOLUME_HIGH
              ? "high"
              : "on-track";
      return { ...muscle, current, average, status };
    }),
  };
}

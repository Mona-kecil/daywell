import { localClock } from "./coach-time";
import { readyAt, SPLITS } from "./forecast";
import { shiftDay } from "./history";
import { localDayStart, VOLUME_LOW, weekStart } from "./volume";

export const PLAN_HOUR = 18;
export const SETS_PER_SESSION = 4;

export type PlanMuscle = {
  id: string;
  name: string;
  cooldownHours: number;
  lastTrainedAt: number | null;
  soreUntil?: number | null;
  current: number;
};
export type PlanDay = {
  day: string;
  at: number;
  split: "push" | "pull" | "legs" | null;
  muscles: { id: string; name: string }[];
} & (
  | { rest: null | "recovering" | "on-target"; waiting?: never }
  | { rest: "extras"; waiting: string[] }
);
export type WeekPlan = {
  days: PlanDay[];
  projected: Record<string, number>;
  onTarget: number;
  total: number;
};

function sessionAt(day: string, timeZone: string): number {
  let before = localDayStart(day, timeZone);
  let after = localDayStart(shiftDay(day, 1), timeZone);
  // Search the local clock instead of adding 18 hours to a DST midnight.
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (localClock(middle, timeZone).localMinutes < PLAN_HOUR * 60)
      before = middle;
    else after = middle;
  }
  return after;
}

export function planWeek(
  muscles: PlanMuscle[],
  { now, timeZone }: { now: number; timeZone: string },
): WeekPlan {
  const simulated = muscles.map((muscle) => ({ ...muscle }));
  const splits = SPLITS.map((split) => ({
    id: split.id,
    members: simulated.filter((muscle) =>
      split.muscles.some((name) => name === muscle.name),
    ),
  }));
  const splitNames = new Set<string>(SPLITS.flatMap((split) => split.muscles));
  const extras = simulated.filter((muscle) => !splitNames.has(muscle.name));
  const days: PlanDay[] = [];
  const end = shiftDay(weekStart(now, timeZone), 7);
  for (
    let day = localClock(now, timeZone).localDay;
    day < end;
    day = shiftDay(day, 1)
  ) {
    const at = sessionAt(day, timeZone);
    if (at <= now) continue;
    const ready = (muscle: PlanMuscle) => (readyAt(muscle, at) ?? at) <= at;
    const next = splits
      .flatMap((split) => {
        if (!split.members.length || !split.members.every(ready)) return [];
        const deficit = split.members.reduce(
          (sum, muscle) => sum + Math.max(0, VOLUME_LOW - muscle.current),
          0,
        );
        if (!deficit) return [];
        return [
          {
            ...split,
            deficit,
            lastTrainedAt: Math.max(
              ...split.members.map(
                (muscle) => muscle.lastTrainedAt ?? -Infinity,
              ),
            ),
          },
        ];
      })
      .sort(
        (a, b) =>
          b.deficit - a.deficit ||
          (a.lastTrainedAt === b.lastTrainedAt
            ? 0
            : a.lastTrainedAt - b.lastTrainedAt),
      )[0];
    if (!next) {
      const belowTarget = simulated.filter(
        (muscle) => muscle.current < VOLUME_LOW,
      );
      const restDay = { day, at, split: null, muscles: [] };
      if (belowTarget.some((muscle) => splitNames.has(muscle.name))) {
        days.push({ ...restDay, rest: "recovering" });
      } else if (belowTarget.length) {
        days.push({
          ...restDay,
          rest: "extras",
          waiting: belowTarget.map((muscle) => muscle.name),
        });
      } else {
        days.push({ ...restDay, rest: "on-target" });
      }
      continue;
    }
    const trained = [
      ...next.members,
      ...extras.filter(
        (muscle) => ready(muscle) && muscle.current < VOLUME_LOW,
      ),
    ];
    for (const muscle of trained) {
      muscle.lastTrainedAt = at;
      muscle.soreUntil = null;
      muscle.current += SETS_PER_SESSION;
    }
    days.push({
      day,
      at,
      split: next.id,
      muscles: trained.map(({ id, name }) => ({ id, name })),
      rest: null,
    });
  }
  return {
    days,
    projected: Object.fromEntries(
      simulated.map((muscle) => [muscle.id, muscle.current]),
    ),
    onTarget: simulated.filter((muscle) => muscle.current >= VOLUME_LOW).length,
    total: muscles.length,
  };
}

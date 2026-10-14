import { recovery, type Recovery } from "./recovery";

export const REPLAY_HOURS = 14 * 24;
const HOUR = 3_600_000;

type ReplayMuscle = {
  _id: string;
  lastTrainedAt: number | null;
  cooldownHours: number;
};
export type ReplayWorkout = { trainedAt: number; muscleIds: string[] };

// The last two weeks up to the next whole hour, read back one cooldown
// further so the first frame knows each muscle's previous session.
export function replayWindow(now: number, muscles: ReplayMuscle[]) {
  const endMs = Math.ceil(now / HOUR) * HOUR;
  const startMs = endMs - REPLAY_HOURS * HOUR;
  const lookback = Math.max(0, ...muscles.map((m) => m.cooldownHours));
  return { startMs, endMs, readFromMs: startMs - lookback * HOUR };
}

// Each muscle's recovery as it stood at `at`. Workouts must cover the read
// window. A muscle with no session in it was rested by then if it was trained
// before the window (`trainedBefore` holds those ids), and untrained if not.
export function statesAt<M extends ReplayMuscle>(
  muscles: M[],
  workouts: ReplayWorkout[],
  at: number,
  trainedBefore: ReadonlySet<string>,
): Map<M["_id"], Recovery> {
  const last = new Map<string, number>();
  for (const w of workouts) {
    if (w.trainedAt > at) continue;
    for (const id of w.muscleIds)
      last.set(id, Math.max(last.get(id) ?? -Infinity, w.trainedAt));
  }
  return new Map(
    muscles.map((m) => {
      const trained = last.get(m._id);
      if (trained !== undefined)
        return [m._id, recovery(at, trained, m.cooldownHours)];
      return [
        m._id,
        m.lastTrainedAt === null || !trainedBefore.has(m._id)
          ? recovery(at, null, m.cooldownHours)
          : { kind: "ready", fraction: 1, label: "Ready", sore: false },
      ];
    }),
  );
}

// The latest session at or before `at`, if it falls inside the window.
export function sessionBefore<W extends ReplayWorkout>(
  workouts: W[],
  at: number,
  startMs: number,
): W | null {
  let found: W | null = null;
  for (const w of workouts)
    if (
      w.trainedAt >= startMs &&
      w.trainedAt <= at &&
      (!found || w.trainedAt > found.trainedAt)
    )
      found = w;
  return found;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

export const FASTING_GOALS = [12, 14, 16, 18, 20] as const;
export const FASTING_KEY = "daywell.fasting";

// The latest meal that has happened, from today's meals and the most
// recent earlier one. Meals logged ahead of time don't end a fast yet.
export function lastMealAt(meals: { at: number }[], now: number) {
  let last: number | null = null;
  for (const { at } of meals)
    if (at <= now && (last === null || at > last)) last = at;
  return last;
}

export function fastState(lastAt: number, now: number, goalHours: number) {
  const elapsed = Math.max(0, now - lastAt);
  const goalAt = lastAt + goalHours * HOUR;
  return {
    elapsed,
    goalAt,
    left: Math.max(0, goalAt - now),
    progress: Math.min(1, elapsed / (goalHours * HOUR)),
    reached: now >= goalAt,
  };
}

// "45 m", "3 h", "14 h 20 m"; minutes are floored so it never runs ahead.
export function duration(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  if (!h) return `${m} m`;
  return m ? `${h} h ${m} m` : `${h} h`;
}

export function readGoal(raw: string | null): number | null {
  const goal = Number(raw);
  return (FASTING_GOALS as readonly number[]).includes(goal) ? goal : null;
}

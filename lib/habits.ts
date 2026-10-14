export const HABIT_ICONS = [
  "pill",
  "stretch",
  "book",
  "sun",
  "leaf",
  "heart",
  "moon",
  "check",
] as const;
export const MAX_HABITS = 12;
export const NAME_MAX = 40;

export function cleanHabitName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= NAME_MAX ? name : null;
}

export function isDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
  );
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function lastDays(today: string, n: number): string[] {
  if (!isDay(today) || !Number.isInteger(n) || n < 0)
    throw new RangeError("Use a valid day and a non-negative integer count.");
  const days: string[] = [];
  let day = today;
  for (let i = 0; i < n; i++) {
    days.push(day);
    day = previousDay(day);
  }
  return days.reverse();
}

export function habitStreak(
  doneDays: Set<string> | string[],
  today: string,
): number {
  if (!isDay(today)) throw new RangeError("Use a valid YYYY-MM-DD day.");
  const done = doneDays instanceof Set ? doneDays : new Set(doneDays);
  let day = done.has(today) ? today : previousDay(today);
  let streak = 0;
  while (done.has(day)) {
    streak++;
    day = previousDay(day);
  }
  return streak;
}

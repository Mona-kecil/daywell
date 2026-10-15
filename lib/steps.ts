import { ConvexError } from "convex/values";
import { addDays, mondayOf } from "./cardio";

export const DEFAULT_STEP_GOAL = 8000;

export function stepCount(value: number): number {
  const count = Math.round(value);
  if (!Number.isFinite(value) || count < 0 || count > 100000)
    throw new ConvexError("Steps must round to a count from 0–100,000.");
  return count === 0 ? 0 : count;
}

export function stepGoal(value: number): number {
  if (!Number.isInteger(value) || value < 1000 || value > 50000)
    throw new ConvexError("Step goal must be an integer from 1,000–50,000.");
  return value;
}

export function stepWeek(
  today: string,
  goal: number,
  rows: { day: string; count: number }[],
) {
  const counts = new Map(rows.map((row) => [row.day, row.count]));
  const monday = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i);
    return { day, count: counts.get(day) ?? null };
  });
  let streak = 0;
  const end = (counts.get(today) ?? -1) >= goal ? today : addDays(today, -1);
  for (let i = 0; i < 366; i++) {
    if ((counts.get(addDays(end, -i)) ?? -1) < goal) break;
    streak++;
  }
  const previous28 = rows.filter(
    (row) => row.day >= addDays(today, -28) && row.day < today,
  );
  const best = rows
    .filter((row) => row.day >= addDays(today, -364) && row.day <= today)
    .sort((a, b) => b.count - a.count || a.day.localeCompare(b.day))[0];
  return {
    goal,
    today: { day: today, count: counts.get(today) ?? null },
    days,
    weekTotal: days.reduce((sum, day) => sum + (day.count ?? 0), 0),
    daysAtGoal: days.filter((day) => day.count !== null && day.count >= goal)
      .length,
    streak,
    average28:
      previous28.length < 3
        ? null
        : Math.round(
            previous28.reduce((sum, row) => sum + row.count, 0) /
              previous28.length,
          ),
    best: best ? { day: best.day, count: best.count } : null,
  };
}

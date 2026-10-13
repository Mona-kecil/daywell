import { ZERO_MACROS, type Macros } from "./nutrients";

export type InsightsInput = {
  waterGoal: number;
  muscles: { _id: string; name: string }[];
  water: { at: number; amountMl: number }[];
  meals: ({ at: number } & Macros)[];
  workouts: { trainedAt: number; muscleIds: string[] }[];
};

export type DaySpan = { key: string; startMs: number; endMs: number };
export type Day = DaySpan &
  Macros & { waterMl: number; meals: number; trained: string[] };

// One bar or heatmap column: a single day, or a week of days.
export type Bin = {
  key: string;
  startMs: number;
  endMs: number;
  days: Day[];
  // Averages over days with at least one entry; null when nothing was logged.
  waterMl: number | null;
  macros: Macros | null;
  trained: Map<string, number>;
};

export const RANGES = {
  "7d": { label: "7D", days: 7, binDays: 1 },
  "30d": { label: "30D", days: 30, binDays: 1 },
  "3m": { label: "3M", days: 91, binDays: 7 },
} as const;
export type RangeId = keyof typeof RANGES;
export const HISTORY_DAYS = RANGES["3m"].days;

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Local calendar days ending today; setDate keeps DST days at 23h/25h.
export function dayWindow(now: Date, count: number) {
  const first = new Date(now);
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - (count - 1));
  const days: DaySpan[] = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(first);
    start.setDate(first.getDate() + i);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    days.push({
      key: dayKey(start),
      startMs: start.getTime(),
      endMs: end.getTime(),
    });
  }
  return { startMs: days[0].startMs, endMs: days[days.length - 1].endMs, days };
}

export function bucketDays(spans: DaySpan[], input: InsightsInput): Day[] {
  const byKey = new Map<string, Day>(
    spans.map((s) => [
      s.key,
      { ...s, ...ZERO_MACROS, waterMl: 0, meals: 0, trained: [] },
    ]),
  );
  const dayOf = (ms: number) => byKey.get(dayKey(new Date(ms)));
  for (const w of input.water) {
    const day = dayOf(w.at);
    if (day) day.waterMl += w.amountMl;
  }
  for (const m of input.meals) {
    const day = dayOf(m.at);
    if (!day) continue;
    day.meals += 1;
    day.kcal += m.kcal;
    day.protein += m.protein;
    day.carbs += m.carbs;
    day.fat += m.fat;
  }
  for (const w of input.workouts) {
    const day = dayOf(w.trainedAt);
    if (!day) continue;
    for (const id of w.muscleIds)
      if (!day.trained.includes(id)) day.trained.push(id);
  }
  return [...byKey.values()];
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

// Groups from the end so the last bin always finishes today.
export function binDays(days: Day[], size: number): Bin[] {
  const bins: Bin[] = [];
  for (let end = days.length; end > 0; end -= size) {
    const group = days.slice(Math.max(0, end - size), end);
    const watered = group.filter((d) => d.waterMl > 0);
    const fed = group.filter((d) => d.meals > 0);
    const trained = new Map<string, number>();
    for (const d of group)
      for (const id of d.trained) trained.set(id, (trained.get(id) ?? 0) + 1);
    bins.unshift({
      key: group[0].key,
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
      days: group,
      waterMl: mean(watered.map((d) => d.waterMl)),
      macros: fed.length
        ? {
            kcal: mean(fed.map((d) => d.kcal))!,
            protein: mean(fed.map((d) => d.protein))!,
            carbs: mean(fed.map((d) => d.carbs))!,
            fat: mean(fed.map((d) => d.fat))!,
          }
        : null,
      trained,
    });
  }
  return bins;
}

// Consecutive days meeting `hit`, ending today; an unmet today is still in progress.
export function streak(days: Day[], hit: (d: Day) => boolean) {
  let i = days.length - 1;
  if (i >= 0 && !hit(days[i])) i--;
  let n = 0;
  while (i >= 0 && hit(days[i])) {
    n++;
    i--;
  }
  return n;
}

export function summarize(days: Day[], history: Day[], input: InsightsInput) {
  const watered = days.filter((d) => d.waterMl > 0);
  const fed = days.filter((d) => d.meals > 0);
  const trainedIds = new Set(days.flatMap((d) => d.trained));
  return {
    avgWaterMl: mean(watered.map((d) => d.waterMl)),
    waterDays: watered.length,
    goalDays: days.filter((d) => d.waterMl >= input.waterGoal).length,
    waterStreak: streak(history, (d) => d.waterMl >= input.waterGoal),
    avgKcal: mean(fed.map((d) => d.kcal)),
    avgProtein: mean(fed.map((d) => d.protein)),
    mealDays: fed.length,
    trainingDays: days.filter((d) => d.trained.length > 0).length,
    trainingStreakWeeks: weeklyStreak(history),
    untrained: input.muscles.filter((m) => !trainedIds.has(m._id)),
  };
}

// Consecutive 7-day blocks (ending today) with at least one training day.
function weeklyStreak(history: Day[]) {
  const weeks = binDays(history, 7).reverse();
  let i = 0;
  // The current week only breaks the streak once it is over.
  if (weeks.length && weeks[0].trained.size === 0) i = 1;
  let n = 0;
  while (i < weeks.length && weeks[i].trained.size > 0) {
    n++;
    i++;
  }
  return n;
}

export type BodyCheckin = {
  day: string;
  weightKg?: number;
  sleepHours?: number;
  mood?: number;
  energy?: number;
};
type BodyField = "weightKg" | "sleepHours" | "mood" | "energy";

// Mean of one check-in field over a bin's days; null when none were logged.
export function binBody(
  bin: Bin,
  byDay: Map<string, BodyCheckin>,
  field: BodyField,
) {
  return mean(
    bin.days.flatMap((d) => {
      const v = byDay.get(d.key)?.[field];
      return v === undefined ? [] : [v];
    }),
  );
}

// Two groups are compared only with at least three days on each side.
function compare(a: number[], b: number[]) {
  return a.length >= 3 && b.length >= 3 ? [mean(a)!, mean(b)!] : null;
}

export function bodySummary(days: Day[], checkins: BodyCheckin[]) {
  const trained = new Map(days.map((d) => [d.key, d.trained.length > 0]));
  const inRange = checkins.filter((c) => trained.has(c.day));
  const weights = inRange.flatMap((c) =>
    c.weightKg === undefined ? [] : [c.weightKg],
  );
  const sleeps = inRange.flatMap((c) =>
    c.sleepHours === undefined ? [] : [c.sleepHours],
  );
  const moods = inRange.filter(
    (c) => c.mood !== undefined && c.sleepHours !== undefined,
  );
  const energies = inRange.filter((c) => c.energy !== undefined);
  const mood = compare(
    moods.filter((c) => c.sleepHours! >= 7).map((c) => c.mood!),
    moods.filter((c) => c.sleepHours! < 7).map((c) => c.mood!),
  );
  const energy = compare(
    energies.filter((c) => trained.get(c.day)).map((c) => c.energy!),
    energies.filter((c) => !trained.get(c.day)).map((c) => c.energy!),
  );
  return {
    avgSleep: mean(sleeps),
    latestWeight: weights.length ? weights[weights.length - 1] : null,
    weightChange:
      weights.length >= 2 ? weights[weights.length - 1] - weights[0] : null,
    restedMood: mood && { rested: mood[0], short: mood[1] },
    trainedEnergy: energy && { trained: energy[0], rest: energy[1] },
  };
}

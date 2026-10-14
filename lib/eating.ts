import type { DaySpan } from "./insights";

export const WINDOW_DAYS = 14;

export type EatingDay = DaySpan & {
  // Meal times in this local day, ascending.
  meals: number[];
};

// Wall-clock minutes since local midnight, so a 7 PM meal sits at 7 PM on
// a 23 h or 25 h DST day too.
export const clockMinutes = (at: number) => {
  const d = new Date(at);
  return d.getHours() * 60 + d.getMinutes();
};

export function eatingDays(spans: DaySpan[], times: number[]): EatingDay[] {
  const sorted = [...times].sort((a, b) => a - b);
  return spans.map((span) => ({
    ...span,
    meals: sorted.filter((t) => t >= span.startMs && t < span.endMs),
  }));
}

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Medians, so one late snack or a skipped log doesn't drag the usual day.
// The window needs two meals in a day; the overnight fast needs meals on
// two consecutive days. Today isn't over, so its last meal and window are
// left out until tomorrow.
export function eatingSummary(days: EatingDay[], today: string) {
  const logged = days.filter((d) => d.meals.length);
  const done = logged.filter((d) => d.key !== today);
  const windows = done
    .filter((d) => d.meals.length > 1)
    .map((d) => d.meals.at(-1)! - d.meals[0]);
  const fasts = days.slice(1).flatMap((d, i) => {
    const prev = days[i];
    return d.meals.length && prev.meals.length
      ? [d.meals[0] - prev.meals.at(-1)!]
      : [];
  });
  return {
    loggedDays: logged.length,
    windowMs: median(windows),
    firstMeal: median(logged.map((d) => clockMinutes(d.meals[0]))),
    lastMeal: median(done.map((d) => clockMinutes(d.meals.at(-1)!))),
    fastMs: median(fasts),
  };
}

export function duration(ms: number) {
  const total = Math.round(ms / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

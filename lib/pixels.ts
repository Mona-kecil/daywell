// "Year in pixels": twelve calendar months of check-ins, one cell per day.
export type PixelMetric = "mood" | "energy" | "sleep";
export type PixelCheckin = {
  day: string;
  mood?: number;
  energy?: number;
  sleepHours?: number;
};
export type PixelDay = {
  key: string;
  date: number;
  // 1–5 shade, or 0 when nothing was logged for this metric.
  step: number;
  value: number | null;
  future: boolean;
};
export type PixelMonth = {
  key: string;
  year: number;
  month: number;
  days: PixelDay[];
  average: number | null;
  logged: number;
};

export const PIXEL_MONTHS = 12;
// A month needs this many logged days before it can be the best month.
const BEST_MIN = 3;
// Sleep shades: under 5 h, 5–6, 6–7, 7–8, 8 h or more.
export const SLEEP_STEPS = [5, 6, 7, 8];

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

export function pixelValue(c: PixelCheckin | undefined, metric: PixelMetric) {
  const v = metric === "sleep" ? c?.sleepHours : c?.[metric];
  return v === undefined ? null : v;
}

export function pixelStep(value: number | null, metric: PixelMetric) {
  if (value === null) return 0;
  if (metric === "sleep")
    return 1 + SLEEP_STEPS.filter((limit) => value >= limit).length;
  return Math.min(5, Math.max(1, Math.round(value)));
}

// The first day of the oldest month shown, for the check-in query.
export function pixelStart(today: string) {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 - (PIXEL_MONTHS - 1), 1));
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-01`;
}

export function yearPixels(
  today: string,
  checkins: PixelCheckin[],
  metric: PixelMetric,
) {
  const byDay = new Map(checkins.map((c) => [c.day, c]));
  const [ty, tm] = today.split("-").map(Number);
  const months: PixelMonth[] = [];
  for (let back = PIXEL_MONTHS - 1; back >= 0; back--) {
    const start = new Date(Date.UTC(ty, tm - 1 - back, 1));
    const year = start.getUTCFullYear(),
      month = start.getUTCMonth();
    const days: PixelDay[] = [];
    for (let date = 1; date <= daysIn(year, month); date++) {
      const key = `${year}-${pad(month + 1)}-${pad(date)}`;
      const future = key > today;
      const value = future ? null : pixelValue(byDay.get(key), metric);
      days.push({
        key,
        date,
        step: pixelStep(value, metric),
        value,
        future,
      });
    }
    const values = days.flatMap((d) => (d.value === null ? [] : [d.value]));
    months.push({
      key: `${year}-${pad(month + 1)}`,
      year,
      month,
      days,
      average: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
      logged: values.length,
    });
  }
  const logged = months.reduce((n, m) => n + m.logged, 0);
  const total = months.reduce((n, m) => n + (m.average ?? 0) * m.logged, 0);
  const best = months
    .filter((m) => m.logged >= BEST_MIN)
    .reduce<PixelMonth | null>(
      (b, m) => (b === null || m.average! > b.average! ? m : b),
      null,
    );
  return {
    months,
    logged,
    average: logged ? total / logged : null,
    best,
  };
}

export const CARDIO_KINDS = [
  "run",
  "walk",
  "ride",
  "swim",
  "row",
  "other",
] as const;
export type CardioKind = (typeof CARDIO_KINDS)[number];
export const CARDIO_EFFORTS = ["easy", "moderate", "hard"] as const;
export type CardioEffort = (typeof CARDIO_EFFORTS)[number];
export const ACTIVE_MINUTES_GOAL = 150;

export function pace(
  kind: CardioKind,
  distanceKm: number | null,
  minutes: number,
):
  | { unit: "/km"; seconds: number }
  | { unit: "/100 m"; seconds: number }
  | { unit: "/500 m"; seconds: number }
  | { unit: "km/h"; speed: number }
  | null {
  if (distanceKm === null || distanceKm === 0 || kind === "other") return null;
  const secondsPerKm = (minutes * 60) / distanceKm;
  switch (kind) {
    case "run":
    case "walk":
      return { unit: "/km", seconds: Math.round(secondsPerKm) };
    case "swim":
      return { unit: "/100 m", seconds: Math.round(secondsPerKm / 10) };
    case "row":
      return { unit: "/500 m", seconds: Math.round(secondsPerKm / 2) };
    case "ride":
      return {
        unit: "km/h",
        speed: Math.round((distanceKm / minutes) * 600) / 10,
      };
  }
}

export function formatPace(p: NonNullable<ReturnType<typeof pace>>): string {
  if (p.unit === "km/h") return `${p.speed.toFixed(1)} km/h`;
  const seconds = Math.round(p.seconds);
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  const time =
    minutes < 60
      ? `${minutes}:${remainder}`
      : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${remainder}`;
  return `${time} ${p.unit}`;
}

export function activeMinutes(minutes: number, effort: CardioEffort): number {
  return minutes * (effort === "hard" ? 2 : 1);
}

const METS = {
  run: { easy: 7, moderate: 9.8, hard: 11.5 },
  walk: { easy: 2.8, moderate: 3.5, hard: 5 },
  ride: { easy: 5.8, moderate: 7.5, hard: 10 },
  swim: { easy: 5.8, moderate: 7, hard: 9.8 },
  row: { easy: 4.8, moderate: 7, hard: 8.5 },
  other: { easy: 3.5, moderate: 5, hard: 8 },
} satisfies Record<CardioKind, Record<CardioEffort, number>>;

export function cardioKcal(
  kind: CardioKind,
  effort: CardioEffort,
  minutes: number,
  weightKg: number | null,
): number | null {
  return weightKg === null
    ? null
    : Math.round((METS[kind][effort] * weightKg * minutes) / 60);
}

function calendarDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const result = new Date(Date.UTC(2000, month - 1, date));
  // Start in a leap year; Date.UTC treats years 0–99 as 1900–1999.
  result.setUTCFullYear(year);
  return result;
}

export function mondayOf(day: string): string {
  const date = calendarDate(day);
  return addDays(day, -((date.getUTCDay() + 6) % 7));
}

export function addDays(day: string, n: number): string {
  const date = calendarDate(day);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

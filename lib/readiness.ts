import { dayNumber, shiftDay } from "./history";

export type ReadinessInput = {
  day: string;
  checkins: {
    day: string;
    sleepHours?: number;
    energy?: number;
    mood?: number;
  }[];
  soreMuscles: number;
  totalMuscles: number;
  dailyLoad: { day: string; load: number }[];
};

export type Readiness = {
  day: string;
  score: number | null;
  band: "push" | "steady" | "easy" | null;
  components: {
    key: "sleep" | "sleepTrend" | "feel" | "soreness" | "load";
    score: number;
    weight: number;
    detail: {
      sleepHours?: number;
      recentSleep?: number;
      baselineSleep?: number;
      energy?: number;
      mood?: number;
      sore?: number;
      total?: number;
      acute?: number;
      chronic?: number;
      acwr?: number;
    };
  }[];
  missing: ("sleep" | "feel")[];
};

const oneDp = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

export function readiness(input: ReadinessInput): Readiness {
  const { day, soreMuscles, totalMuscles } = input;
  const checkins = input.checkins.filter(
    (row) => row.day >= shiftDay(day, -28) && row.day <= day,
  );
  const today = checkins.find((row) => row.day === day);
  const sleepHours =
    today?.sleepHours ??
    checkins.find((row) => row.day === shiftDay(day, -1))?.sleepHours;
  const components: Readiness["components"] = [];
  if (sleepHours !== undefined) {
    const score =
      sleepHours < 7
        ? Math.max(0, ((sleepHours - 4) / 3) * 100)
        : sleepHours <= 9
          ? 100
          : Math.max(70, 100 - (sleepHours - 9) * 15);
    components.push({
      key: "sleep",
      score,
      weight: 30,
      detail: { sleepHours },
    });
  }

  const sleep = checkins
    .flatMap((row) =>
      row.sleepHours === undefined
        ? []
        : [{ day: row.day, hours: row.sleepHours }],
    )
    .sort((a, b) => b.day.localeCompare(a.day));
  // The four recent days (0…−3) do not overlap the baseline (−28…−4).
  const recent = sleep.filter((row) => row.day > shiftDay(day, -4)).slice(0, 3);
  const baseline = sleep.filter((row) => row.day <= shiftDay(day, -4));
  if (recent.length >= 3 && baseline.length >= 7) {
    const recentSleep = mean(recent.map((row) => row.hours));
    const baselineSleep = mean(baseline.map((row) => row.hours));
    components.push({
      key: "sleepTrend",
      score: Math.max(0, 100 - Math.max(0, baselineSleep - recentSleep) * 20),
      weight: 15,
      detail: { recentSleep, baselineSleep },
    });
  }

  const feel = [today?.energy, today?.mood].filter(
    (value) => value !== undefined,
  );
  if (feel.length > 0) {
    components.push({
      key: "feel",
      score: ((mean(feel) - 1) / 4) * 100,
      weight: 25,
      detail: {
        ...(today?.energy === undefined ? {} : { energy: today.energy }),
        ...(today?.mood === undefined ? {} : { mood: today.mood }),
      },
    });
  }
  if (totalMuscles > 0) {
    components.push({
      key: "soreness",
      score: 100 * (1 - soreMuscles / totalMuscles),
      weight: 15,
      detail: { sore: soreMuscles, total: totalMuscles },
    });
  }

  const loads = input.dailyLoad.filter(
    (row) => row.day >= shiftDay(day, -27) && row.day <= day && row.load > 0,
  );
  const firstDay = loads.map((row) => row.day).sort()[0];
  const chronic = loads.reduce((sum, row) => sum + row.load, 0) / 4;
  if (chronic > 0 && firstDay && dayNumber(day) - dayNumber(firstDay) >= 14) {
    const acute = loads
      .filter((row) => row.day >= shiftDay(day, -6))
      .reduce((sum, row) => sum + row.load, 0);
    const acwr = acute / chronic;
    const score =
      acwr < 0.8
        ? 60 + (Math.max(0.5, acwr) - 0.5) * (40 / 0.3)
        : acwr <= 1.3
          ? 100
          : Math.max(0, ((2 - acwr) / 0.7) * 100);
    components.push({
      key: "load",
      score,
      weight: 15,
      detail: { acute, chronic, acwr },
    });
  }

  const totalWeight = components.reduce((sum, row) => sum + row.weight, 0);
  const score =
    components.length < 2
      ? null
      : Math.round(
          components.reduce((sum, row) => sum + row.score * row.weight, 0) /
            totalWeight,
        );
  // One weak factor (a short night, a load spike) rules out "push" even when
  // the others carry the average.
  const flagged = components.some((row) => oneDp(row.score) < 50);
  const missing: Readiness["missing"] = [];
  if (today?.sleepHours === undefined) missing.push("sleep");
  if (feel.length === 0) missing.push("feel");
  return {
    day,
    score,
    band:
      score === null
        ? null
        : score >= 75 && !flagged
          ? "push"
          : score >= 50
            ? "steady"
            : "easy",
    components: components
      .sort((a, b) => a.score - b.score)
      .map((row) => ({
        ...row,
        score: oneDp(row.score),
        weight: Math.round((row.weight / totalWeight) * 100) / 100,
        detail: Object.fromEntries(
          Object.entries(row.detail).map(([key, value]) => [key, oneDp(value)]),
        ),
      })),
    missing,
  };
}

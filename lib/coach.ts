import { ACTIVE_MINUTES_GOAL } from "./cardio";
import { readyAt } from "./forecast";
import { localClock } from "./coach-time";
import { recovery } from "./recovery";
import type { Readiness } from "./readiness";
import type { Macros } from "./nutrients";

export const DEFAULT_CHECK_INS = ["10:00", "13:00", "16:00", "19:30"];
export const PROTEIN_FOODS = [
  "Greek yogurt 200 g ≈ 20 g",
  "chicken 100 g ≈ 31 g",
  "tofu 150 g ≈ 18 g",
];
export type Suggestion = {
  id: string;
  kind:
    | "water"
    | "food"
    | "train"
    | "rest"
    | "habit"
    | "cardio"
    | "readiness"
    | "steps";
  priority: 1 | 2 | 3;
  title: string;
  body: string;
};
export type CoachInput = {
  now: number;
  localMinutes: number;
  timeZone?: string;
  waterMl: number;
  waterGoal: number;
  macros: Macros;
  targets: { kcalTarget?: number; proteinTarget?: number };
  mealCount: number;
  cardio?: { weekActiveMinutes: number; todayMinutes: number; weekday: number };
  steps?: { today: number | null; goal: number; recentDays: number };
  readiness?: Pick<Readiness, "score" | "band"> & {
    weakest?: Readiness["components"][number]["key"];
  };
  habits?: {
    id: string;
    name: string;
    order: number;
    archivedAt?: number;
  }[];
  habitLogs?: { habitId: string; day: string }[];
  muscles: {
    name: string;
    cooldownHours: number;
    lastTrainedAt: number | null;
    soreUntil?: number | null;
  }[];
};

// Water is paced evenly from 07:00 to 22:00 local time.
export const WATER_DAY = { start: 7 * 60, end: 22 * 60 };
// A low-readiness morning swaps the training nudge for an easy one.
export const inReadinessWindow = (localMinutes: number) =>
  localMinutes >= 6 * 60 && localMinutes < 14 * 60;

export const waterPace = (localMinutes: number) =>
  Math.max(
    0,
    Math.min(
      1,
      (localMinutes - WATER_DAY.start) / (WATER_DAY.end - WATER_DAY.start),
    ),
  );

export function coachSuggestions(input: CoachInput): Suggestion[] {
  const { now, localMinutes, waterMl, waterGoal, macros, targets } = input;
  const suggestions: Suggestion[] = [];
  const waterGap = waterGoal * waterPace(localMinutes) - waterMl;
  if (waterGoal > 0 && waterMl < waterGoal && waterGap > waterGoal * 0.15) {
    const amount = Math.max(50, Math.round(waterGap / 50) * 50);
    suggestions.push({
      id: "water:pace",
      kind: "water",
      priority: 1,
      title: `Drink ${amount} ml of water`,
      body: `You have logged ${Math.round(waterMl)} of ${Math.round(waterGoal)} ml today.`,
    });
  }
  // At lunch expect 45% of targets; at dinner expect 80%. A 20% deficit triggers a nudge.
  const mealFraction =
    localMinutes >= 19 * 60 ? 0.8 : localMinutes >= 13 * 60 ? 0.45 : 0;
  const proteinBehind =
    targets.proteinTarget !== undefined &&
    macros.protein < targets.proteinTarget * (mealFraction - 0.2);
  const kcalBehind =
    targets.kcalTarget !== undefined &&
    macros.kcal < targets.kcalTarget * (mealFraction - 0.2);
  if (mealFraction && (proteinBehind || kcalBehind)) {
    const remaining =
      targets.proteinTarget === undefined
        ? null
        : Math.max(0, Math.ceil(targets.proteinTarget - macros.protein));
    suggestions.push({
      id: "food:targets",
      kind: "food",
      priority: 1,
      title: proteinBehind
        ? "Add protein to your next meal"
        : "Make time for your next meal",
      body: `${remaining === null ? "Try " : `${remaining} g protein left. `}${PROTEIN_FOODS.join("; ")}.`,
    });
  }
  if (localMinutes >= 14 * 60 && input.mealCount === 0) {
    suggestions.push({
      id: "food:log-lunch",
      kind: "food",
      priority: 2,
      title: "Log lunch when you have a moment",
      body: "No meals logged today. Add lunch so your totals can guide your next meal.",
    });
  }
  const takeItEasy =
    input.readiness?.band === "easy" &&
    inReadinessWindow(localMinutes) &&
    !input.muscles.some(
      (m) =>
        m.lastTrainedAt !== null &&
        localClock(m.lastTrainedAt, input.timeZone ?? "UTC").localDay ===
          localClock(now, input.timeZone ?? "UTC").localDay,
    );
  if (takeItEasy) {
    const reasons = {
      sleep: "Last night was short.",
      sleepTrend: "You've slept less than usual lately.",
      feel: "You're running low today.",
      soreness: "Several muscle groups are still sore.",
      load: "Your training load is well above your usual week.",
    } satisfies Record<Readiness["components"][number]["key"], string>;
    const reason = input.readiness?.weakest
      ? reasons[input.readiness.weakest]
      : "Several signals are low.";
    suggestions.push({
      id: "today:readiness",
      kind: "readiness",
      priority: 2,
      title: `Readiness ${input.readiness?.score}: take it easy`,
      body: `${reason} A walk, mobility or a stretch fits today better than a hard session.`,
    });
  }
  const groups = input.muscles
    .map((m) => ({
      ...m,
      state: recovery(now, m.lastTrainedAt, m.cooldownHours, m.soreUntil),
      readyAt: readyAt(m, now) ?? -Infinity,
    }))
    .sort(
      (a, b) => a.readyAt - b.readyAt || a.name.localeCompare(b.name, "en"),
    );
  const ready = groups.find((m) => m.state.kind !== "recovering");
  if (ready) {
    const since =
      ready.lastTrainedAt === null
        ? "You have not logged training for this group."
        : `Ready since ${new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: input.timeZone ?? "UTC" }).format(ready.readyAt)} after ${ready.cooldownHours} hours of recovery.`;
    suggestions.push({
      id: `train:${ready.name}`,
      kind: "train",
      priority: 3,
      title: `Train ${ready.name} today`.slice(0, 60),
      body: since,
    });
  } else if (groups.length) {
    const next = groups[0];
    const time = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: input.timeZone ?? "UTC",
    }).format(next.readyAt);
    suggestions.push({
      id: `rest:${next.name}`,
      kind: "rest",
      priority: 3,
      title: "Take a recovery day",
      body: `Your trained groups are recovering. ${next.name} is ready ${time}.`.slice(
        0,
        140,
      ),
    });
  }
  if (localMinutes >= 18 * 60 && input.habits?.length) {
    const { localDay } = localClock(now, input.timeZone ?? "UTC");
    const done = new Set(
      (input.habitLogs ?? [])
        .filter((log) => log.day === localDay)
        .map((log) => log.habitId),
    );
    const remaining = input.habits
      .filter((habit) => habit.archivedAt === undefined && !done.has(habit.id))
      .sort((a, b) => a.order - b.order);
    if (remaining.length) {
      const names = remaining.slice(0, 3).map((habit) => habit.name);
      if (remaining.length > 3) names.push(`+${remaining.length - 3} more`);
      suggestions.push({
        // The existing ID tie-break puts recovery before habits, then routine training.
        id: "today:habits",
        kind: "habit",
        priority: 3,
        title: `${remaining.length} ${remaining.length === 1 ? "habit" : "habits"} left today`,
        body: `${names.join(", ")}.`,
      });
    }
  }
  if (
    localMinutes >= 17 * 60 &&
    input.cardio &&
    input.cardio.todayMinutes === 0
  ) {
    const { weekActiveMinutes, weekday } = input.cardio;
    const paceTarget = Math.round((ACTIVE_MINUTES_GOAL * weekday) / 7);
    if (weekActiveMinutes < paceTarget) {
      const minutes = Math.min(
        45,
        Math.max(10, Math.ceil((paceTarget - weekActiveMinutes) / 5) * 5),
      );
      suggestions.push({
        id: "today:cardio",
        kind: "cardio",
        priority: 3,
        title: `${Math.round(weekActiveMinutes)} of ${ACTIVE_MINUTES_GOAL} active minutes`,
        body: `A ${minutes}-minute brisk walk tonight gets you back on pace for the week.`,
      });
    }
  }
  if (
    localMinutes >= 17 * 60 &&
    localMinutes < 22 * 60 &&
    input.steps &&
    input.steps.today !== null &&
    input.steps.today < input.steps.goal &&
    input.steps.goal - input.steps.today <= 4000 &&
    input.steps.recentDays >= 3
  ) {
    const remaining = input.steps.goal - input.steps.today;
    suggestions.push({
      id: "today:steps",
      kind: "steps",
      priority: 3,
      title: `${remaining.toLocaleString("en-US")} steps to your goal`,
      body:
        remaining > 1000
          ? "A 20-minute walk is about 2,000 steps."
          : "A short walk after dinner gets you there.",
    });
  }
  // One nudge per kind, so two food reminders never crowd out the rest.
  const kinds = new Set<Suggestion["kind"]>();
  return suggestions
    .filter((s) => !takeItEasy || s.kind !== "train")
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id, "en"))
    .filter((s) => !kinds.has(s.kind) && kinds.add(s.kind))
    .slice(0, 3);
}

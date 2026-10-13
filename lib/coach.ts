import { recovery } from "./recovery";
import type { Macros } from "./nutrients";

export const DEFAULT_CHECK_INS = ["10:00", "13:00", "16:00", "19:30"];
export const PROTEIN_FOODS = [
  "Greek yogurt 200 g ≈ 20 g",
  "chicken 100 g ≈ 31 g",
  "tofu 150 g ≈ 18 g",
];
export type Suggestion = {
  id: string;
  kind: "water" | "food" | "train" | "rest";
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
  muscles: {
    name: string;
    cooldownHours: number;
    lastTrainedAt: number | null;
  }[];
};

// Water is paced evenly from 07:00 to 22:00 local time.
export const WATER_DAY = { start: 7 * 60, end: 22 * 60 };
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
  const groups = input.muscles
    .map((m) => ({
      ...m,
      state: recovery(now, m.lastTrainedAt, m.cooldownHours),
      readyAt:
        m.lastTrainedAt === null
          ? -Infinity
          : m.lastTrainedAt + m.cooldownHours * 3_600_000,
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
  return suggestions
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id, "en"))
    .slice(0, 3);
}

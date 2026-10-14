import { localClock } from "./coach-time";
import { DAY_MS, shiftDay } from "./history";
import { mealTotals, sumNutrients, type MealItem } from "./nutrients";
import { readyAt } from "./forecast";
import { recovery } from "./recovery";
import type { CoachInput, Suggestion } from "./coach";

export type CoachSnapshotInput = {
  now: number;
  timeZone: string;
  waterGoal: number;
  targets: CoachInput["targets"];
  water: { at: number; amountMl: number }[];
  meals: {
    at: number;
    description: string;
    analysis: { status: "ready" | "analyzing" | "error" };
    items: MealItem[];
  }[];
  workouts: { trainedAt: number }[];
  muscles: CoachInput["muscles"];
  checkin: {
    day: string;
    weightKg?: number;
    waistCm?: number;
    sleepHours?: number;
    mood?: number;
    energy?: number;
  } | null;
  suggestions: Pick<Suggestion, "kind" | "title" | "body">[];
};

const round = (n: number) => Math.round(n * 10) / 10;

/** Seven local dates including today; averages include days with no logs. */
export function buildCoachSnapshot(input: CoachSnapshotInput) {
  const { now, timeZone } = input;
  const clock = localClock(now, timeZone);
  const fromDay = shiftDay(clock.localDay, -6);
  const inWeek = (at: number) =>
    at <= now && localClock(at, timeZone).localDay >= fromDay;
  const isToday = (at: number) =>
    localClock(at, timeZone).localDay === clock.localDay;
  const water = input.water.filter((w) => inWeek(w.at));
  const meals = input.meals.filter((m) => inWeek(m.at));
  const analysed = meals.filter((m) => m.analysis.status === "ready");
  const todayMeals = meals.filter((m) => isToday(m.at));
  const totals = sumNutrients(
    analysed.filter((m) => isToday(m.at)).map((m) => mealTotals(m.items)),
  );
  const checkin = input.checkin;
  return {
    local: {
      day: clock.localDay,
      time: clock.slot,
      weekday: new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
      }).format(now),
      timeZone,
    },
    today: {
      waterMl: round(
        water
          .filter((w) => isToday(w.at))
          .reduce((sum, w) => sum + w.amountMl, 0),
      ),
      waterGoalMl: input.waterGoal,
      nutrients: {
        kcal: round(totals.kcal),
        protein: round(totals.protein),
        fat: round(totals.fat),
        carbs: round(totals.carbs),
      },
      targets: {
        kcal: input.targets.kcalTarget ?? null,
        protein: input.targets.proteinTarget ?? null,
      },
      analysedMeals: todayMeals.filter((m) => m.analysis.status === "ready")
        .length,
      unanalysedMeals: todayMeals.filter((m) => m.analysis.status !== "ready")
        .length,
      meals: todayMeals
        .sort((a, b) => a.at - b.at)
        .slice(-6)
        .map((m) => ({
          description: m.description.slice(0, 80),
          time: localClock(m.at, timeZone).slot,
          kcal:
            m.analysis.status === "ready"
              ? round(mealTotals(m.items).kcal)
              : null,
        })),
      omittedMeals: Math.max(0, todayMeals.length - 6),
    },
    muscles: input.muscles.map((m) => {
      const state = recovery(
        now,
        m.lastTrainedAt,
        m.cooldownHours,
        m.soreUntil,
      );
      return {
        name: m.name.slice(0, 40),
        status:
          state.kind === "recovering"
            ? ("recovering" as const)
            : ("ready" as const),
        hoursUntilReady:
          state.kind === "recovering"
            ? Math.ceil(Math.max(0, (readyAt(m, now) ?? now) - now) / 360_000) /
              10
            : 0,
      };
    }),
    last7Days: {
      fromDay,
      toDay: clock.localDay,
      trainingDays: new Set(
        input.workouts
          .filter((w) => inWeek(w.trainedAt))
          .map((w) => localClock(w.trainedAt, timeZone).localDay),
      ).size,
      avgWaterMl: round(water.reduce((sum, w) => sum + w.amountMl, 0) / 7),
      avgKcal: round(
        sumNutrients(analysed.map((m) => mealTotals(m.items))).kcal / 7,
      ),
      waterDaysLogged: new Set(
        water.map((w) => localClock(w.at, timeZone).localDay),
      ).size,
      mealDaysLogged: new Set(
        analysed.map((m) => localClock(m.at, timeZone).localDay),
      ).size,
    },
    latestCheckin:
      checkin && checkin.day <= clock.localDay
        ? {
            day: checkin.day,
            weightKg: checkin.weightKg ?? null,
            waistCm: checkin.waistCm ?? null,
            sleepHours: checkin.sleepHours ?? null,
            mood: checkin.mood ?? null,
            energy: checkin.energy ?? null,
          }
        : null,
    suggestions: input.suggestions.slice(0, 3).map((s) => ({
      kind: s.kind,
      text: `${s.title.slice(0, 60)}. ${s.body.slice(0, 140)}`,
    })),
  };
}

export type CoachSnapshot = ReturnType<typeof buildCoachSnapshot>;
export const COACH_HISTORY_WINDOW_MS = 8 * DAY_MS;
// A reply still pending after this long has stalled; the user may ask again.
export const COACH_PENDING_MS = 2 * 60_000;
export const COACH_STALE_ERROR =
  "The coach took too long to answer. Please send your question again.";

import { expect, it } from "vitest";
import { dayTimeline } from "../lib/timeline";

it("sorts cardio among water, meals, and workouts newest first without losing fields", () => {
  const cardio = [
    {
      id: "walk",
      at: 300,
      activity: "walk",
      effort: "moderate",
      minutes: 20,
      distanceKm: 1.5,
    },
  ] as const;
  const input = {
    water: [{ at: 100, amountMl: 250 }],
    meals: [{ id: "meal", at: 400, title: "Lunch", kcal: 500 }],
    workouts: [{ id: "workout", at: 200, muscles: ["Back"], note: "" }],
    cardio: [...cardio],
  };
  expect(dayTimeline(input)).toEqual([
    { kind: "meal", ...input.meals[0] },
    { kind: "cardio", ...cardio[0] },
    { kind: "workout", ...input.workouts[0] },
    { kind: "water", at: 100, ml: 250, drinks: 1 },
  ]);
  expect(input.cardio).toEqual(cardio);
});

it("accepts missing cardio and preserves a null distance", () => {
  const input = { water: [], meals: [], workouts: [] };
  expect(dayTimeline(input)).toEqual([]);
  const cardio = [
    {
      id: "row",
      at: 500,
      activity: "row",
      effort: "hard",
      minutes: 15,
      distanceKm: null,
    },
  ] as const;
  expect(dayTimeline({ ...input, cardio: [...cardio] })).toEqual([
    { kind: "cardio", ...cardio[0] },
  ]);
});

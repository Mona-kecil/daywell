export type StrengthSet = { reps: number; weightKg: number };

export function e1rm({ reps, weightKg }: StrengthSet): number {
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

export function summarizeSets(sets: StrengthSet[]) {
  return sets.reduce(
    (result, set) => ({
      topSetKg: Math.max(result.topSetKg, set.weightKg),
      volumeKg: result.volumeKg + set.reps * set.weightKg,
      bestE1rm: Math.max(result.bestE1rm, e1rm(set)),
    }),
    { topSetKg: 0, volumeKg: 0, bestE1rm: 0 },
  );
}

export const EXERCISE_DEFAULTS = [
  { name: "Bench press", muscles: ["chest", "triceps", "shoulders"] },
  {
    name: "Incline dumbbell press",
    muscles: ["chest", "shoulders", "triceps"],
  },
  { name: "Push-up", muscles: ["chest", "triceps"] },
  { name: "Pull-up", muscles: ["back", "biceps"] },
  { name: "Barbell row", muscles: ["back", "biceps"] },
  { name: "Lat pulldown", muscles: ["back", "biceps"] },
  { name: "Deadlift", muscles: ["back", "hamstrings", "glutes"] },
  { name: "Overhead press", muscles: ["shoulders", "triceps"] },
  { name: "Lateral raise", muscles: ["shoulders"] },
  { name: "Curl", muscles: ["biceps"] },
  { name: "Hammer curl", muscles: ["biceps", "forearms"] },
  { name: "Triceps pushdown", muscles: ["triceps"] },
  { name: "Dip", muscles: ["chest", "triceps"] },
  { name: "Plank", muscles: ["abs"] },
  { name: "Crunch", muscles: ["abs"] },
  { name: "Back squat", muscles: ["quads", "glutes"] },
  { name: "Front squat", muscles: ["quads", "glutes"] },
  { name: "Leg press", muscles: ["quads", "glutes"] },
  { name: "Romanian deadlift", muscles: ["hamstrings", "glutes"] },
  { name: "Leg curl", muscles: ["hamstrings"] },
  { name: "Hip thrust", muscles: ["glutes"] },
  { name: "Lunge", muscles: ["quads", "glutes"] },
  { name: "Standing calf raise", muscles: ["calves"] },
  { name: "Farmer carry", muscles: ["forearms"] },
  { name: "Wrist curl", muscles: ["forearms"] },
];

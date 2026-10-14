export type StrengthSet = { reps: number; weightKg: number };

export type StrengthTarget = {
  kind: "start" | "add_reps" | "add_weight" | "deload" | "return";
  sets: StrengthSet[];
  range: { min: number; max: number };
  reason: string;
  basedOn: number;
};

export function repRange(name: string): StrengthTarget["range"] {
  return [
    "Deadlift",
    "Back squat",
    "Front squat",
    "Barbell row",
    "Bench press",
    "Overhead press",
  ].includes(name)
    ? { min: 5, max: 8 }
    : { min: 8, max: 12 };
}

// Sets within 10% of the top weight; lighter ones are warm-ups. Working
// sets are normalised to the top weight.
export function workingSets<T extends StrengthSet>(sets: T[]): T[] {
  const topWeight = Math.max(...sets.map((set) => set.weightKg));
  return sets
    .filter((set) => set.weightKg >= topWeight * 0.9)
    .map((set) => ({ ...set, weightKg: topWeight }));
}

export function nextTarget(
  sessions: { trainedAt: number; sets: StrengthSet[] }[],
  now: number,
  range: StrengthTarget["range"] = { min: 8, max: 12 },
): StrengthTarget | null {
  const recent = sessions.filter((session) => session.sets.length).slice(-2);
  const last = recent.at(-1);
  if (!last) return null;
  const sets = workingSets(last.sets);
  const topWeight = sets[0].weightKg;
  if (topWeight === 0) range = { min: 8, max: 20 };
  const increment = topWeight >= 20 ? 2.5 : 1;
  const reducedWeight = Math.max(
    0,
    Math.floor((topWeight * 0.9) / increment) * increment,
  );
  const base = { range, basedOn: last.trainedAt };
  const atWeight = (weightKg: number) =>
    sets.map(() => ({ weightKg, reps: range.min }));
  const elapsed = now - last.trainedAt;
  if (elapsed > 21 * 86_400_000) {
    const weeks = Math.floor(elapsed / (7 * 86_400_000));
    return {
      ...base,
      kind: "return",
      sets: atWeight(reducedWeight),
      reason: `It’s been ${weeks} weeks; ease back in at 90%.`,
    };
  }
  if (topWeight > 0 && sets.every((set) => set.reps >= range.max)) {
    const weightKg =
      Math.round((topWeight + increment) / increment) * increment;
    return {
      ...base,
      kind: "add_weight",
      sets: atWeight(weightKg),
      reason: `You hit ${range.max} reps on every set; add ${Number((weightKg - topWeight).toFixed(10))} kg.`,
    };
  }
  const previous = recent.at(-2);
  const previousFirst = previous && workingSets(previous.sets)[0];
  if (
    topWeight > 0 &&
    previousFirst?.weightKg === topWeight &&
    previousFirst.reps < range.min &&
    sets[0].reps < range.min
  )
    return {
      ...base,
      kind: "deload",
      sets: atWeight(reducedWeight),
      reason: `Your first set fell below ${range.min} reps twice; drop to ${reducedWeight} kg.`,
    };
  return {
    ...base,
    kind: "add_reps",
    sets: sets.map((set) => ({
      weightKg: topWeight,
      reps: Math.min(set.reps + 1, range.max),
    })),
    reason:
      topWeight === 0 && sets.every((set) => set.reps >= range.max)
        ? `You hit ${range.max} reps on every set; add weight or try a harder variation.`
        : "Keep the same weight and add a rep to each set.",
  };
}

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

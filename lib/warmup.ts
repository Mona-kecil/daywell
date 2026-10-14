import { BAR_KG, PLATES_KG } from "./plates";

export function warmupSets(
  workKg: number,
  workReps: number,
  opts?: { barKg?: number },
): { reps: number; weightKg: number; label: string }[] {
  const barKg = opts?.barKg ?? BAR_KG;
  if (
    !Number.isFinite(workKg) ||
    !Number.isInteger(workReps) ||
    workReps < 1 ||
    workReps > 100 ||
    !Number.isFinite(barKg) ||
    barKg <= 0 ||
    workKg <= 0 ||
    workKg < barKg + 10
  )
    return [];

  const sets = [{ reps: 10, weightKg: barKg, label: "Bar × 10" }];
  const steps =
    workReps >= 12
      ? [{ fraction: 0.5, reps: 5 }]
      : [
          { fraction: 0.4, reps: 5 },
          { fraction: 0.6, reps: 3 },
          { fraction: 0.8, reps: 2 },
          ...(workKg >= 140 ? [{ fraction: 0.9, reps: 1 }] : []),
        ];
  const incrementKg = Math.min(...PLATES_KG) * 2;
  let previousKg = barKg;
  for (const { fraction, reps } of steps) {
    const weightKg =
      barKg +
      Math.floor((workKg * fraction - barKg) / incrementKg) * incrementKg;
    if (weightKg <= previousKg || weightKg >= workKg) continue;
    sets.push({
      reps,
      weightKg,
      label: `${Number(weightKg.toFixed(2))} kg × ${reps}`,
    });
    previousKg = weightKg;
  }
  return sets;
}

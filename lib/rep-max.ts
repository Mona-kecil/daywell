import { PLATES_KG } from "./plates";

// Heavy singles down to light volume work.
export const REP_ROWS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15] as const;
export const LOAD_STEP_KG = Math.min(...PLATES_KG) * 2;

// What a one-rep max predicts for `reps`: Epley run backwards, so it agrees
// with e1rm() in lib/strength.ts.
export const repWeight = (oneRepKg: number, reps: number) =>
  reps === 1 ? oneRepKg : oneRepKg / (1 + reps / 30);

// Rounded down to a weight standard plates load, so a target is never
// heavier than the estimate.
export const loadable = (kg: number, step = LOAD_STEP_KG) =>
  Math.floor(kg / step + 1e-9) * step;

export function repTable(oneRepKg: number) {
  if (!Number.isFinite(oneRepKg) || oneRepKg <= 0) return [];
  return REP_ROWS.map((reps) => {
    const exact = repWeight(oneRepKg, reps);
    return {
      reps,
      weightKg: loadable(exact),
      percent: Math.round((exact / oneRepKg) * 100),
    };
  });
}

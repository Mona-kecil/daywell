// Paced breathing as a fixed schedule of steps, like the interval timer, so
// the current step comes from elapsed time.
export type BreathStep = { kind: "in" | "hold" | "out" | "rest"; s: number };
export type BreathPattern = {
  id: string;
  label: string;
  use: string;
  steps: BreathStep[];
};

export const PATTERNS: BreathPattern[] = [
  {
    id: "box",
    label: "Box",
    use: "Steady focus",
    steps: [
      { kind: "in", s: 4 },
      { kind: "hold", s: 4 },
      { kind: "out", s: 4 },
      { kind: "rest", s: 4 },
    ],
  },
  {
    id: "478",
    label: "4-7-8",
    use: "Wind down for sleep",
    steps: [
      { kind: "in", s: 4 },
      { kind: "hold", s: 7 },
      { kind: "out", s: 8 },
    ],
  },
  {
    id: "slow",
    label: "Slow 5-5",
    use: "Six calm breaths a minute",
    steps: [
      { kind: "in", s: 5 },
      { kind: "out", s: 5 },
    ],
  },
];
export const MINUTES = [1, 2, 3, 5] as const;

export const cycleMs = (steps: BreathStep[]) =>
  steps.reduce((sum, step) => sum + step.s * 1000, 0);

// Whole breaths closest to the chosen minutes, at least one.
export const cyclesFor = (steps: BreathStep[], minutes: number) =>
  Math.max(1, Math.round((minutes * 60_000) / cycleMs(steps)));

export const patternLabel = (steps: BreathStep[]) =>
  steps.map((step) => step.s).join("-");

// The step running at `elapsedMs`, or null once every breath is done.
// `index` counts steps from the start so each one is cued once.
export function breathAt(
  steps: BreathStep[],
  cycles: number,
  elapsedMs: number,
) {
  const cycle = cycleMs(steps);
  if (!cycle || elapsedMs < 0 || elapsedMs >= cycle * cycles) return null;
  const n = Math.floor(elapsedMs / cycle);
  let t = elapsedMs - n * cycle;
  for (let i = 0; i < steps.length; i++) {
    const ms = steps[i].s * 1000;
    if (t < ms)
      return {
        breath: n + 1,
        index: n * steps.length + i,
        step: steps[i],
        leftMs: ms - t,
        progress: t / ms,
      };
    t -= ms;
  }
  return null;
}

// How full the lungs are, 0 to 1, partway through a step. Breaths start and
// end slowly; the orb's CSS curve, cubic-bezier(0.37, 0, 0.63, 1), matches
// this sine ease, so a pause doesn't make it jump.
export function fullness(kind: BreathStep["kind"], progress: number) {
  const eased = (1 - Math.cos(Math.PI * progress)) / 2;
  if (kind === "in") return eased;
  if (kind === "out") return 1 - eased;
  return kind === "hold" ? 1 : 0;
}

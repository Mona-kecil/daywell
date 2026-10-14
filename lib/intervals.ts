// Work/rest interval rounds (Tabata, EMOM, circuits) as a fixed schedule, so
// the current phase comes from elapsed time rather than from counting ticks.
export type IntervalPlan = { workS: number; restS: number; rounds: number };
export type Phase = {
  kind: "prep" | "work" | "rest";
  round: number;
  startMs: number;
  ms: number;
};

export const PREP_S = 5;
export const LIMITS = {
  workS: [5, 600],
  restS: [0, 600],
  rounds: [1, 50],
} as const;
export const PRESETS: { id: string; label: string; plan: IntervalPlan }[] = [
  { id: "tabata", label: "Tabata", plan: { workS: 20, restS: 10, rounds: 8 } },
  { id: "emom", label: "EMOM 10", plan: { workS: 60, restS: 0, rounds: 10 } },
  { id: "thirty", label: "30/30", plan: { workS: 30, restS: 30, rounds: 10 } },
  {
    id: "circuit",
    label: "Circuit",
    plan: { workS: 45, restS: 15, rounds: 12 },
  },
];

export function validPlan(p: Partial<IntervalPlan> | null | undefined) {
  if (!p) return null;
  const ok = (Object.keys(LIMITS) as (keyof IntervalPlan)[]).every((k) => {
    const v = p[k];
    return (
      typeof v === "number" &&
      Number.isInteger(v) &&
      v >= LIMITS[k][0] &&
      v <= LIMITS[k][1]
    );
  });
  return ok ? (p as IntervalPlan) : null;
}

export function phases(plan: IntervalPlan, prepS = PREP_S): Phase[] {
  const out: Phase[] = [];
  let at = 0;
  const push = (kind: Phase["kind"], round: number, s: number) => {
    if (s <= 0) return;
    out.push({ kind, round, startMs: at, ms: s * 1000 });
    at += s * 1000;
  };
  push("prep", 1, prepS);
  for (let round = 1; round <= plan.rounds; round++) {
    push("work", round, plan.workS);
    // No rest after the last round: the workout is over.
    if (round < plan.rounds) push("rest", round, plan.restS);
  }
  return out;
}

export const totalMs = (list: Phase[]) =>
  list.length ? list.at(-1)!.startMs + list.at(-1)!.ms : 0;

// The phase running at `elapsedMs`, or null once every phase has ended.
export function phaseAt(list: Phase[], elapsedMs: number) {
  const index = list.findIndex((p) => elapsedMs < p.startMs + p.ms);
  if (index < 0) return null;
  const phase = list[index];
  return { index, phase, leftMs: phase.startMs + phase.ms - elapsedMs };
}

// Workout length without the get-ready countdown.
export const planSeconds = (p: IntervalPlan) =>
  p.rounds * p.workS + (p.rounds - 1) * p.restS;

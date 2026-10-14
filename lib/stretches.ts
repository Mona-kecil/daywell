// A guided cool-down: one static stretch per trained muscle group, held for a
// fixed time per side, with a short gap to get into each position.
import type { MuscleKey } from "@/components/body3d/anatomy";

export type Stretch = {
  id: string;
  name: string;
  cue: string;
  muscle: MuscleKey;
  sided: boolean;
};
export type Side = "left" | "right";
export type StretchStep = {
  kind: "move" | "hold";
  stretch: Stretch;
  side: Side | null;
  startMs: number;
  ms: number;
};

export const MOVE_S = 5;
export const HOLDS = [20, 30, 45] as const;
export type Hold = (typeof HOLDS)[number];

// Head to toe, so the session flows from standing upper-body stretches down
// to the floor and back up for the legs.
export const STRETCHES: Stretch[] = [
  {
    id: "cross-body",
    name: "Cross-body shoulder",
    cue: "Pull one arm across your chest with the other, just above the elbow.",
    muscle: "shoulders",
    sided: true,
  },
  {
    id: "doorway",
    name: "Doorway chest",
    cue: "Forearm on a door frame at shoulder height. Step through until your chest opens.",
    muscle: "chest",
    sided: true,
  },
  {
    id: "overhead-triceps",
    name: "Overhead triceps",
    cue: "Reach one hand down your back and ease the elbow back with the other hand.",
    muscle: "triceps",
    sided: true,
  },
  {
    id: "wall-biceps",
    name: "Wall biceps",
    cue: "Palm flat on a wall behind you, arm straight. Turn your chest away.",
    muscle: "biceps",
    sided: true,
  },
  {
    id: "wrist-flexor",
    name: "Wrist flexor",
    cue: "Arm straight, palm up. Gently pull the fingers back with your other hand.",
    muscle: "forearms",
    sided: true,
  },
  {
    id: "childs-pose",
    name: "Child's pose",
    cue: "Kneel, sit back on your heels and reach your arms long in front.",
    muscle: "back",
    sided: false,
  },
  {
    id: "cobra",
    name: "Cobra",
    cue: "Lie face down, hands under your shoulders. Press up and keep your hips down.",
    muscle: "abs",
    sided: false,
  },
  {
    id: "figure-four",
    name: "Figure four",
    cue: "On your back, cross one ankle over the other knee and pull the thigh in.",
    muscle: "glutes",
    sided: true,
  },
  {
    id: "hamstring-step",
    name: "Standing hamstring",
    cue: "Heel on a low step, leg straight. Hinge forward from the hips.",
    muscle: "hamstrings",
    sided: true,
  },
  {
    id: "standing-quad",
    name: "Standing quad",
    cue: "Hold one ankle behind you, knees together, hips pushed forward.",
    muscle: "quads",
    sided: true,
  },
  {
    id: "wall-calf",
    name: "Wall calf",
    cue: "Hands on a wall, one leg back with the heel down and the knee straight.",
    muscle: "calves",
    sided: true,
  },
];

export const stretchFor = (muscle: MuscleKey) =>
  STRETCHES.find((s) => s.muscle === muscle)!;

export function stretchSteps(muscles: Iterable<MuscleKey>, holdS: number) {
  const chosen = new Set(muscles);
  const out: StretchStep[] = [];
  let at = 0;
  const push = (kind: StretchStep["kind"], s: Stretch, side: Side | null) => {
    const ms = (kind === "move" ? MOVE_S : holdS) * 1000;
    out.push({ kind, stretch: s, side, startMs: at, ms });
    at += ms;
  };
  for (const s of STRETCHES) {
    if (!chosen.has(s.muscle)) continue;
    for (const side of s.sided ? (["left", "right"] as const) : [null]) {
      push("move", s, side);
      push("hold", s, side);
    }
  }
  return out;
}

export const stepsMs = (steps: StretchStep[]) =>
  steps.length ? steps.at(-1)!.startMs + steps.at(-1)!.ms : 0;

// The step running at `elapsedMs`, or null once the session is over.
export function stepAt(steps: StretchStep[], elapsedMs: number) {
  const index = steps.findIndex((p) => elapsedMs < p.startMs + p.ms);
  if (index < 0) return null;
  const step = steps[index];
  return { index, step, leftMs: step.startMs + step.ms - elapsedMs };
}

// Muscles worked in the last day and a half count as "just trained".
export const RECENT_MS = 36 * 3600_000;

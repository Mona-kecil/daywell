import type { MuscleState } from "./BodyScene";

export const PALETTE = {
  light: {
    skin: "#d6dcd2",
    never: "#aeb8b0",
    sore: "#d4573b",
    mid: "#e2a03a",
    ready: "#3f9a6b",
  },
  dark: {
    skin: "#5f6f66",
    never: "#62706a",
    sore: "#ef7b5f",
    mid: "#efbd5f",
    ready: "#7fca9b",
  },
};

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function mix(a: string, b: string, t: number) {
  const [x, y] = [channels(a), channels(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Sore → mid → ready as recovery progresses; shared by the 3D body and the bars.
export function recoveryHex(state: MuscleState | undefined, dark: boolean) {
  const p = dark ? PALETTE.dark : PALETTE.light;
  if (!state || state.kind === "never") return p.never;
  if (state.kind === "ready") return p.ready;
  const f = state.fraction;
  return f < 0.5
    ? mix(p.sore, p.mid, f / 0.5)
    : mix(p.mid, p.ready, (f - 0.5) / 0.5);
}

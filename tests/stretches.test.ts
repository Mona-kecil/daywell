import { describe, expect, it } from "vitest";
import { MUSCLE_KEYS } from "../components/body3d/anatomy";
import {
  STRETCHES,
  stepAt,
  stepsMs,
  stretchFor,
  stretchSteps,
} from "../lib/stretches";

describe("cool-down stretches", () => {
  it("has one stretch for every muscle group", () => {
    expect(STRETCHES.map((s) => s.muscle).sort()).toEqual(
      [...MUSCLE_KEYS].sort(),
    );
    expect(new Set(STRETCHES.map((s) => s.id)).size).toBe(STRETCHES.length);
    for (const key of MUSCLE_KEYS) expect(stretchFor(key).muscle).toBe(key);
  });

  it("runs head to toe with a move before each hold and both sides", () => {
    // Asked legs-first, still played back before calves.
    const steps = stretchSteps(["calves", "back"], 30);
    expect(
      steps.map((s) => `${s.kind} ${s.stretch.id} ${s.side ?? "-"}`),
    ).toEqual([
      "move childs-pose -",
      "hold childs-pose -",
      "move wall-calf left",
      "hold wall-calf left",
      "move wall-calf right",
      "hold wall-calf right",
    ]);
    expect(steps.map((s) => [s.startMs, s.ms])).toEqual([
      [0, 5000],
      [5000, 30_000],
      [35_000, 5000],
      [40_000, 30_000],
      [70_000, 5000],
      [75_000, 30_000],
    ]);
    expect(stepsMs(steps)).toBe(105_000);
    expect(stretchSteps([], 30)).toEqual([]);
    expect(stepsMs([])).toBe(0);
  });

  it("finds the running step and what is left of it", () => {
    const steps = stretchSteps(["abs"], 20);
    expect(stepAt(steps, 0)).toMatchObject({ index: 0, leftMs: 5000 });
    expect(stepAt(steps, 4999)).toMatchObject({ index: 0, leftMs: 1 });
    expect(stepAt(steps, 5000)).toMatchObject({ index: 1, leftMs: 20_000 });
    expect(stepAt(steps, 24_999)?.index).toBe(1);
    expect(stepAt(steps, 25_000)).toBeNull();
  });
});

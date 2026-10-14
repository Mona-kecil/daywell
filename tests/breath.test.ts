import { describe, expect, it } from "vitest";
import {
  PATTERNS,
  breathAt,
  cycleMs,
  cyclesFor,
  fullness,
  patternLabel,
} from "../lib/breath";

const [box, sleep, slow] = PATTERNS;

describe("breathing schedule", () => {
  it("fits whole breaths to the minutes chosen", () => {
    expect(cycleMs(box.steps)).toBe(16_000);
    expect(cyclesFor(box.steps, 2)).toBe(8);
    // 60 / 19 s rounds to 3 breaths of 4-7-8.
    expect(cyclesFor(sleep.steps, 1)).toBe(3);
    expect(cyclesFor(slow.steps, 1)).toBe(6);
    expect(cyclesFor(sleep.steps, 0.1)).toBe(1);
    expect(patternLabel(sleep.steps)).toBe("4-7-8");
  });

  it("finds the step from elapsed time", () => {
    expect(breathAt(sleep.steps, 2, 0)).toMatchObject({
      breath: 1,
      index: 0,
      step: { kind: "in" },
      leftMs: 4000,
      progress: 0,
    });
    expect(breathAt(sleep.steps, 2, 5000)).toMatchObject({
      step: { kind: "hold" },
      leftMs: 6000,
    });
    // Second breath starts at 19 s; its first step is index 3.
    expect(breathAt(sleep.steps, 2, 19_000)).toMatchObject({
      breath: 2,
      index: 3,
      step: { kind: "in" },
    });
    expect(breathAt(sleep.steps, 2, 37_999)?.step.kind).toBe("out");
    expect(breathAt(sleep.steps, 2, 38_000)).toBeNull();
    expect(breathAt(sleep.steps, 2, -1)).toBeNull();
  });

  it("fills on the way in and empties on the way out", () => {
    expect(fullness("in", 0)).toBe(0);
    expect(fullness("in", 0.5)).toBeCloseTo(0.5);
    // Eased: slow at the start of a breath.
    expect(fullness("in", 0.25)).toBeCloseTo(0.146, 3);
    expect(fullness("in", 1)).toBe(1);
    expect(fullness("hold", 0.5)).toBe(1);
    expect(fullness("out", 0.25)).toBeCloseTo(0.854, 3);
    expect(fullness("rest", 0.5)).toBe(0);
  });
});

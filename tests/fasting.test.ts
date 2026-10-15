import { describe, expect, it } from "vitest";
import { duration, fastState, lastMealAt, readGoal } from "../lib/fasting";

const H = 3_600_000;

describe("fasting", () => {
  it("starts from the latest meal that has already happened", () => {
    expect(lastMealAt([], 10)).toBeNull();
    expect(lastMealAt([{ at: 5 }, { at: 9 }, { at: 7 }], 10)).toBe(9);
    expect(lastMealAt([{ at: 5 }, { at: 11 }], 10)).toBe(5);
    expect(lastMealAt([{ at: 10 }], 10)).toBe(10);
  });

  it("measures progress toward the goal", () => {
    expect(fastState(0, 8 * H, 16)).toEqual({
      elapsed: 8 * H,
      goalAt: 16 * H,
      left: 8 * H,
      progress: 0.5,
      reached: false,
    });
    const done = fastState(0, 16 * H, 16);
    expect([done.reached, done.left, done.progress]).toEqual([true, 0, 1]);
    expect(fastState(0, 30 * H, 16).progress).toBe(1);
    expect(fastState(H, 0, 12).elapsed).toBe(0);
  });

  it("formats hours and floored minutes", () => {
    expect(duration(0)).toBe("0 m");
    expect(duration(59_999)).toBe("0 m");
    expect(duration(45 * 60_000)).toBe("45 m");
    expect(duration(3 * H)).toBe("3 h");
    expect(duration(14 * H + 20 * 60_000 + 59_000)).toBe("14 h 20 m");
    expect(duration(-5)).toBe("0 m");
  });

  it("only accepts the offered goals", () => {
    expect(readGoal("16")).toBe(16);
    expect(readGoal(null)).toBeNull();
    expect(readGoal("15")).toBeNull();
    expect(readGoal("abc")).toBeNull();
  });
});

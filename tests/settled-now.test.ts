import { describe, expect, it } from "vitest";
import { settledNow } from "../components/review";

// Local-time constructors keep these true in any time zone the suite runs in.
const at = (...parts: [number, number, number, number, number]) =>
  new Date(...parts).getTime();

describe("settledNow", () => {
  it("rounds up to the next five minutes", () => {
    expect(settledNow(at(2026, 9, 15, 10, 2))).toBe(at(2026, 9, 15, 10, 5));
    expect(settledNow(at(2026, 9, 15, 10, 5))).toBe(at(2026, 9, 15, 10, 5));
  });

  it("never rounds past the end of the local day", () => {
    const endOfDay = at(2026, 9, 16, 0, 0) - 1;
    expect(settledNow(at(2026, 9, 15, 23, 56))).toBe(endOfDay);
    expect(settledNow(at(2026, 9, 15, 23, 59) + 59_999)).toBe(endOfDay);
    expect(new Date(settledNow(at(2026, 9, 31, 23, 58))).getMonth()).toBe(9);
  });
});

import { describe, expect, it } from "vitest";
import { loadBar } from "../lib/plates";

describe("loadBar", () => {
  it("loads the heaviest plates first on each side", () => {
    expect(loadBar(100)).toEqual({
      perSide: [25, 15],
      remainderKg: 0,
      belowBar: false,
    });
    expect(loadBar(62.5).perSide).toEqual([20, 1.25]);
    expect(loadBar(142.5).perSide).toEqual([25, 25, 10, 1.25]);
  });

  it("keeps an exact remainder when a side needs half a 1.25 kg plate", () => {
    expect(loadBar(141.25)).toEqual({
      perSide: [25, 25, 10],
      remainderKg: 1.25,
      belowBar: false,
    });
  });

  it("handles the empty bar, too-light weights and unloadable remainders", () => {
    expect(loadBar(20)).toEqual({
      perSide: [],
      remainderKg: 0,
      belowBar: false,
    });
    expect(loadBar(15).belowBar).toBe(true);
    expect(loadBar(21)).toEqual({
      perSide: [],
      remainderKg: 1,
      belowBar: false,
    });
    expect(loadBar(23.5)).toEqual({
      perSide: [1.25],
      remainderKg: 1,
      belowBar: false,
    });
  });
});

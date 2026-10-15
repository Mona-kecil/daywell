import { describe, expect, it } from "vitest";
import { dayLine } from "../components/share-day";

describe("share card day line", () => {
  it("names trained muscles and today's cardio", () => {
    expect(dayLine(["Back", "Biceps"], 0)).toEqual({
      trained: "Trained Back, Biceps",
      cardio: "",
    });
    expect(dayLine(["Back"], 30)).toEqual({
      trained: "Trained Back",
      cardio: " · 30 min cardio",
    });
    expect(dayLine([], 75)).toEqual({
      trained: "",
      cardio: "1 h 15 min cardio",
    });
    expect(dayLine([], 0)).toEqual({ trained: "Rest day", cardio: "" });
  });
});

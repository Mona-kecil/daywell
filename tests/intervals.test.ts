import { describe, expect, it } from "vitest";
import {
  phaseAt,
  phases,
  planSeconds,
  totalMs,
  validPlan,
} from "../lib/intervals";

describe("interval schedule", () => {
  it("runs prep, then work and rest, with no rest after the last round", () => {
    const list = phases({ workS: 20, restS: 10, rounds: 3 });
    expect(list.map((p) => `${p.kind}${p.round}:${p.ms / 1000}`)).toEqual([
      "prep1:5",
      "work1:20",
      "rest1:10",
      "work2:20",
      "rest2:10",
      "work3:20",
    ]);
    expect(totalMs(list)).toBe(85_000);
    expect(planSeconds({ workS: 20, restS: 10, rounds: 3 })).toBe(80);
  });

  it("drops zero-second rests, as in EMOM", () => {
    const list = phases({ workS: 60, restS: 0, rounds: 2 }, 0);
    expect(list.map((p) => p.kind)).toEqual(["work", "work"]);
    expect(list[1].startMs).toBe(60_000);
  });

  it("finds the phase from elapsed time", () => {
    const list = phases({ workS: 20, restS: 10, rounds: 2 });
    expect(phaseAt(list, 0)).toMatchObject({ index: 0, leftMs: 5000 });
    expect(phaseAt(list, 4999)?.phase.kind).toBe("prep");
    // Each boundary belongs to the phase that starts there.
    expect(phaseAt(list, 5000)).toMatchObject({
      phase: { kind: "work", round: 1 },
      leftMs: 20_000,
    });
    expect(phaseAt(list, 25_000)?.phase.kind).toBe("rest");
    expect(phaseAt(list, 54_999)).toMatchObject({
      phase: { kind: "work", round: 2 },
      leftMs: 1,
    });
    expect(phaseAt(list, 55_000)).toBeNull();
  });

  it("accepts only whole numbers within the limits", () => {
    expect(validPlan({ workS: 20, restS: 0, rounds: 8 })).toEqual({
      workS: 20,
      restS: 0,
      rounds: 8,
    });
    expect(validPlan({ workS: 4, restS: 0, rounds: 8 })).toBeNull();
    expect(validPlan({ workS: 20, restS: 10, rounds: 51 })).toBeNull();
    expect(validPlan({ workS: 20.5, restS: 10, rounds: 8 })).toBeNull();
    expect(validPlan({ workS: 20, rounds: 8 })).toBeNull();
    expect(validPlan(null)).toBeNull();
  });
});

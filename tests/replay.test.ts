import { describe, expect, it } from "vitest";
import { replayWindow, sessionBefore, statesAt } from "../lib/replay";

const HOUR = 3_600_000;
const now = Date.UTC(2026, 9, 14, 9, 20);
const back = { _id: "back", lastTrainedAt: now - 2 * HOUR, cooldownHours: 72 };
const abs = {
  _id: "abs",
  lastTrainedAt: now - 40 * 24 * HOUR,
  cooldownHours: 24,
};
const calves = { _id: "calves", lastTrainedAt: null, cooldownHours: 48 };

describe("recovery replay", () => {
  it("covers two weeks to the next hour and reads one cooldown further", () => {
    const w = replayWindow(now, [back, abs, calves]);
    expect(w.endMs).toBe(Date.UTC(2026, 9, 14, 10));
    expect(w.endMs - w.startMs).toBe(14 * 24 * HOUR);
    expect(w.startMs - w.readFromMs).toBe(72 * HOUR);
  });

  it("shows each muscle as it was at the scrubbed time", () => {
    const workouts = [
      { trainedAt: now - 100 * HOUR, muscleIds: ["back"] },
      { trainedAt: now - 2 * HOUR, muscleIds: ["back"] },
    ];
    const muscles = [back, abs, calves];
    const before = statesAt(muscles, workouts, now - 64 * HOUR);
    expect(before.get("back")).toMatchObject({
      kind: "recovering",
      fraction: 0.5,
    });
    expect(before.get("abs")).toMatchObject({ kind: "ready" });
    expect(before.get("calves")).toMatchObject({ kind: "never" });
    const later = statesAt(muscles, workouts, now - 20 * HOUR);
    expect(later.get("back")).toMatchObject({ kind: "ready" });
    expect(statesAt(muscles, workouts, now).get("back")).toMatchObject({
      kind: "recovering",
    });
  });

  it("finds the latest session inside the window", () => {
    const start = now - 14 * 24 * HOUR;
    const workouts = [
      { trainedAt: start - HOUR, muscleIds: ["back"] },
      { trainedAt: now - 30 * HOUR, muscleIds: ["abs"] },
      { trainedAt: now - 3 * HOUR, muscleIds: ["back"] },
    ];
    expect(sessionBefore(workouts, start, start)).toBeNull();
    expect(sessionBefore(workouts, now - 10 * HOUR, start)).toBe(workouts[1]);
    expect(sessionBefore(workouts, now, start)).toBe(workouts[2]);
  });
});

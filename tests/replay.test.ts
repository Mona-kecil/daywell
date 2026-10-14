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
// Back and abs had sessions before the read window; calves never did.
const trained = new Set(["back", "abs"]);

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
    const before = statesAt(muscles, workouts, now - 64 * HOUR, trained);
    expect(before.get("back")).toMatchObject({
      kind: "recovering",
      fraction: 0.5,
    });
    expect(before.get("abs")).toMatchObject({ kind: "ready" });
    expect(before.get("calves")).toMatchObject({ kind: "never" });
    const later = statesAt(muscles, workouts, now - 20 * HOUR, trained);
    expect(later.get("back")).toMatchObject({ kind: "ready" });
    expect(statesAt(muscles, workouts, now, trained).get("back")).toMatchObject(
      {
        kind: "recovering",
      },
    );
  });

  it("shows a muscle as never trained before its first session", () => {
    const legs = {
      _id: "legs",
      lastTrainedAt: now - 5 * HOUR,
      cooldownHours: 48,
    };
    const workouts = [{ trainedAt: now - 5 * HOUR, muscleIds: ["legs"] }];
    // Every workout is loaded, so nothing came before this one.
    expect(
      statesAt([legs], workouts, now - 10 * HOUR, new Set()).get("legs"),
    ).toMatchObject({ kind: "never" });
    // Older workouts went unread, so a muscle trained then was rested.
    expect(
      statesAt([legs], workouts, now - 10 * HOUR, new Set(["legs"])).get(
        "legs",
      ),
    ).toMatchObject({ kind: "ready" });
  });

  it("keeps a muscle untrained before its own first session", () => {
    // Chest was trained long before; legs only two days ago, for the first time.
    const chest = {
      _id: "chest",
      lastTrainedAt: now - 30 * 24 * HOUR,
      cooldownHours: 48,
    };
    const legs = {
      _id: "legs",
      lastTrainedAt: now - 48 * HOUR,
      cooldownHours: 48,
    };
    const workouts = [{ trainedAt: now - 48 * HOUR, muscleIds: ["legs"] }];
    const then = statesAt(
      [chest, legs],
      workouts,
      now - 72 * HOUR,
      new Set(["chest"]),
    );
    expect(then.get("chest")).toMatchObject({ kind: "ready" });
    expect(then.get("legs")).toMatchObject({ kind: "never" });
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

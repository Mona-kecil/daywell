import { describe, expect, it } from "vitest";
import {
  FLAT_PCT,
  LAPSED_DAYS,
  STALL_SESSIONS,
  TREND_WEEKS,
  liftTrend,
  type LiftSession,
} from "../lib/trends";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const NOW = Date.parse("2026-10-14T19:00:00Z");
const session = (trainedAt: number, value: number): LiftSession => ({
  trainedAt,
  sets: [{ reps: 1, weightKg: value }],
});
const weekly = (values: number[]) =>
  values.map((value, index) =>
    session(NOW - (values.length - index - 1) * WEEK, value),
  );
const oldBest = session(NOW - 9 * WEEK, 200);

describe("lift trend statuses", () => {
  it("exports the specified thresholds", () => {
    expect([TREND_WEEKS, STALL_SESSIONS, LAPSED_DAYS, FLAT_PCT]).toEqual([
      8, 4, 21, 0.5,
    ]);
  });

  it("returns an empty early trend without a best session", () => {
    expect(liftTrend([], NOW)).toEqual({
      status: "early",
      unit: "reps",
      points: [],
      best: 0,
      bestAt: null,
      sessionsSinceBest: 0,
      changePct: null,
      lastAt: null,
    });
  });

  it("is lapsed only after 21 days, before checking early or climbing", () => {
    const lastAt = NOW - 21 * DAY;
    expect(liftTrend([session(lastAt, 100)], NOW).status).toBe("early");
    expect(liftTrend([session(lastAt - 1, 100)], NOW).status).toBe("lapsed");
    const history = weekly([80, 90, 100]);
    expect(liftTrend(history, NOW + 21 * DAY).status).toBe("climbing");
    expect(liftTrend(history, NOW + 21 * DAY + 1).status).toBe("lapsed");
  });

  it.each([1, 2])(
    "is early with %i window sessions despite a recent best",
    (count) => {
      expect(liftTrend(weekly([90, 100].slice(-count)), NOW).status).toBe(
        "early",
      );
    },
  );

  it("counts only window sessions for early, before checking a stall", () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      session(NOW - (13 - i) * WEEK, 100),
    );
    const result = liftTrend([...history, ...weekly([100, 100])], NOW);
    expect(result).toMatchObject({ status: "early", sessionsSinceBest: 6 });
    expect(result.points).toHaveLength(2);
  });

  it.each([
    [80, 90, 100],
    [90, 100, 80],
  ])("climbs when a best is in the last two sessions: %j", (...values) => {
    expect(liftTrend(weekly(values), NOW).status).toBe("climbing");
  });

  it("does not treat a best three sessions back as recent", () => {
    expect(liftTrend(weekly([100, 100, 100]), NOW)).toMatchObject({
      status: "steady",
      sessionsSinceBest: 2,
    });
  });

  it.each([
    { values: [99.5, 100, 100.5], changePct: 0.5, status: "steady" },
    { values: [99.4, 100, 100.6], changePct: 0.6, status: "climbing" },
  ])(
    "uses a strict climbing threshold at $changePct percent",
    ({ values, changePct, status }) => {
      expect(liftTrend([oldBest, ...weekly(values)], NOW)).toMatchObject({
        changePct,
        status,
        sessionsSinceBest: 3,
      });
    },
  );

  it("stalls after four sessions without a new best even when the recent slope rises", () => {
    expect(
      liftTrend([oldBest, ...weekly([80, 85, 90, 95])], NOW),
    ).toMatchObject({
      status: "stalled",
      sessionsSinceBest: 4,
    });
  });

  it.each([
    { values: [101, 100, 99], changePct: -1, status: "steady" },
    { values: [101.1, 100, 98.9], changePct: -1.1, status: "slipping" },
  ])(
    "uses a strict slipping slope threshold at $changePct percent",
    ({ values, changePct, status }) => {
      expect(liftTrend([oldBest, ...weekly(values)], NOW)).toMatchObject({
        changePct,
        status,
      });
    },
  );

  it.each([
    { latest: 95, status: "steady" },
    { latest: 94.9, status: "slipping" },
  ])(
    "requires the latest value below 95% of the best: $latest",
    ({ latest, status }) => {
      expect(
        liftTrend(
          [session(oldBest.trainedAt, 100), ...weekly([99, 97, latest])],
          NOW,
        ).status,
      ).toBe(status);
    },
  );

  it("stalls after four sessions without a new best even when the recent slope falls", () => {
    expect(
      liftTrend([oldBest, ...weekly([100, 90, 80, 70])], NOW),
    ).toMatchObject({
      status: "stalled",
      sessionsSinceBest: 4,
    });
  });

  it.each([
    { count: 4, status: "steady", since: 3 },
    { count: 5, status: "stalled", since: 4 },
  ])(
    "stalls at four sessions after the first best: $since",
    ({ count, status, since }) => {
      expect(
        liftTrend(weekly(Array.from({ length: count }, () => 100)), NOW),
      ).toMatchObject({
        status,
        sessionsSinceBest: since,
        bestAt: NOW - (count - 1) * WEEK,
      });
    },
  );
});

describe("lift trend values", () => {
  it("uses all sets for the session best, including lighter sets with more reps", () => {
    expect(
      liftTrend(
        [
          {
            trainedAt: NOW,
            sets: [
              { reps: 1, weightKg: 100 },
              { reps: 60, weightKg: 40 },
            ],
          },
        ],
        NOW,
      ),
    ).toMatchObject({
      unit: "kg",
      best: 120,
      points: [{ at: NOW, value: 120 }],
    });
  });

  it("rounds points to one decimal and retains the all-time best value", () => {
    const result = liftTrend(
      [{ trainedAt: NOW, sets: [{ reps: 8, weightKg: 62.5 }] }],
      NOW,
    );
    expect(result.best).toBe(62.5 * (1 + 8 / 30));
    expect(result.points).toEqual([{ at: NOW, value: 79.2 }]);
  });

  it("uses best reps for bodyweight sessions and keeps the earliest tied best", () => {
    const history = [8, 12, 12, 10].map((reps, index) => ({
      trainedAt: NOW - (3 - index) * WEEK,
      sets: [
        { reps: reps - 1, weightKg: 0 },
        { reps, weightKg: 0 },
      ],
    }));
    expect(liftTrend(history, NOW)).toMatchObject({
      unit: "reps",
      best: 12,
      bestAt: NOW - 2 * WEEK,
      sessionsSinceBest: 2,
    });
    expect(liftTrend(history, NOW).points.map((point) => point.value)).toEqual([
      8, 12, 12, 10,
    ]);
  });

  it("chooses bodyweight units from the window even with older weighted sets", () => {
    expect(
      liftTrend(
        [
          { trainedAt: NOW - 9 * WEEK, sets: [{ reps: 15, weightKg: 20 }] },
          { trainedAt: NOW, sets: [{ reps: 12, weightKg: 0 }] },
        ],
        NOW,
      ),
    ).toMatchObject({ unit: "reps", best: 15, sessionsSinceBest: 1 });
  });

  it("omits bodyweight-only sessions from a kg series and its best count", () => {
    expect(
      liftTrend(
        [
          {
            trainedAt: NOW - WEEK,
            sets: [
              { reps: 20, weightKg: 0 },
              { reps: 1, weightKg: 10 },
            ],
          },
          { trainedAt: NOW, sets: [{ reps: 30, weightKg: 0 }] },
        ],
        NOW,
      ),
    ).toMatchObject({
      unit: "kg",
      best: 10,
      points: [{ at: NOW - WEEK, value: 10 }],
      bestAt: NOW - WEEK,
      sessionsSinceBest: 0,
      lastAt: NOW - WEEK,
      status: "early",
      changePct: null,
    });
  });

  it("uses only weighted sessions for kg status and weekly change", () => {
    const weighted = weekly([100, 95, 90]);
    const bodyweight = [
      { trainedAt: NOW - 9 * WEEK, sets: [{ reps: 1000, weightKg: 0 }] },
      ...[3, 2, 1, 0].map((days) => ({
        trainedAt: NOW - days * DAY,
        sets: [{ reps: 20, weightKg: 0 }],
      })),
    ];
    expect(liftTrend([...weighted, ...bodyweight], NOW)).toEqual(
      liftTrend(weighted, NOW),
    );
  });

  it("keeps the historical unit and best when the window has no sessions", () => {
    expect(liftTrend([oldBest], NOW)).toMatchObject({
      unit: "kg",
      status: "lapsed",
      best: 200,
      bestAt: oldBest.trainedAt,
      points: [],
      lastAt: oldBest.trainedAt,
    });
  });

  it("sorts without mutating input and resets the count only for a higher best", () => {
    const history = weekly([100, 100, 110]).reverse();
    const before = structuredClone(history);
    expect(liftTrend(history, NOW)).toMatchObject({
      best: 110,
      bestAt: NOW,
      sessionsSinceBest: 0,
    });
    expect(history).toEqual(before);
    expect(liftTrend(history, NOW).points.map((point) => point.at)).toEqual([
      NOW - 2 * WEEK,
      NOW - WEEK,
      NOW,
    ]);
  });

  it("does not merge distinct bests that round to the same displayed value", () => {
    expect(liftTrend(weekly([100.01, 100.02]), NOW)).toMatchObject({
      best: 100.02,
      bestAt: NOW,
      sessionsSinceBest: 0,
    });
  });

  it("ignores empty sessions in the window, last timestamp, and best count", () => {
    const history = weekly([100, 100, 100]);
    expect(
      liftTrend(
        [
          { trainedAt: NOW + DAY, sets: [] },
          ...history,
          { trainedAt: NOW - DAY, sets: [] },
        ],
        NOW,
      ),
    ).toEqual(liftTrend(history, NOW));
    expect(liftTrend([{ trainedAt: NOW, sets: [] }], NOW)).toEqual(
      liftTrend([], NOW),
    );
  });

  it("includes both window endpoints but excludes older and future points", () => {
    const start = NOW - 8 * WEEK;
    expect(
      liftTrend(
        [
          session(start - 1, 200),
          session(start, 90),
          session(NOW, 100),
          session(NOW + 1, 300),
        ],
        NOW,
      ),
    ).toMatchObject({
      points: [
        { at: start, value: 90 },
        { at: NOW, value: 100 },
      ],
      best: 200,
      bestAt: start - 1,
      sessionsSinceBest: 2,
      lastAt: NOW,
    });
  });

  it.each([
    { values: [90, 100, 110], expected: 10 },
    { values: [110, 100, 90], expected: -10 },
    { values: [100, 100, 100], expected: 0 },
    { values: [99.44, 100, 100.56], expected: 0.6 },
    { values: [100.56, 100, 99.44], expected: -0.6 },
  ])(
    "reports signed, rounded weekly change: $expected",
    ({ values, expected }) => {
      expect(liftTrend(weekly(values), NOW).changePct).toBe(expected);
    },
  );

  it("regresses against elapsed weeks, including unevenly spaced sessions", () => {
    expect(
      liftTrend(
        [
          session(NOW - 3 * WEEK, 70),
          session(NOW - 2 * WEEK, 80),
          session(NOW, 100),
        ],
        NOW,
      ).changePct,
    ).toBe(12);
  });

  it("returns null change for fewer than three points, zero mean, or zero time variance", () => {
    expect(liftTrend(weekly([100, 110]), NOW).changePct).toBeNull();
    expect(
      liftTrend(
        [1, 2, 3].map((i) => ({
          trainedAt: NOW - i * WEEK,
          sets: [{ reps: 0, weightKg: 0 }],
        })),
        NOW,
      ).changePct,
    ).toBeNull();
    expect(
      liftTrend(
        [80, 90, 100].map((value) => session(NOW, value)),
        NOW,
      ).changePct,
    ).toBeNull();
  });
});

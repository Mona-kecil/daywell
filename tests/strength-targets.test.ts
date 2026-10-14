import { expect, it } from "vitest";
import { nextTarget, repRange, type StrengthSet } from "../lib/strength";

const day = 86_400_000;
const now = 40 * day;
function session(reps: number[], weightKg = 60, trainedAt = now) {
  return { trainedAt, sets: reps.map((reps) => ({ reps, weightKg })) };
}

it("returns null without a session containing sets", () => {
  expect(nextTarget([], now)).toBeNull();
  expect(nextTarget([session([])], now)).toBeNull();
});

it("adds one rep per working set, caps at max, and climbs below min one rep at a time", () => {
  expect(nextTarget([session([9, 12, 5])], now)).toEqual({
    kind: "add_reps",
    sets: [
      { reps: 10, weightKg: 60 },
      { reps: 12, weightKg: 60 },
      { reps: 6, weightKg: 60 },
    ],
    range: { min: 8, max: 12 },
    reason: "Keep the same weight and add a rep to each set.",
    basedOn: now,
  });
});

it.each([
  { weightKg: 60, nextWeight: 62.5, increment: 2.5 },
  { weightKg: 20, nextWeight: 22.5, increment: 2.5 },
  { weightKg: 19, nextWeight: 20, increment: 1 },
])(
  "adds $increment kg at $weightKg kg when every set reaches max",
  ({ weightKg, nextWeight, increment }) => {
    expect(nextTarget([session([12, 14], weightKg)], now)).toEqual({
      kind: "add_weight",
      sets: [
        { reps: 8, weightKg: nextWeight },
        { reps: 8, weightKg: nextWeight },
      ],
      range: { min: 8, max: 12 },
      reason: `You hit 12 reps on every set; add ${increment} kg.`,
      basedOn: now,
    });
  },
);

it("ignores warm-ups and preserves the number and order of working sets", () => {
  const sets: StrengthSet[] = [
    { reps: 5, weightKg: 20 },
    { reps: 3, weightKg: 40 },
    { reps: 10, weightKg: 60 },
    { reps: 6, weightKg: 40 },
    { reps: 9, weightKg: 60 },
  ];
  expect(nextTarget([{ trainedAt: now, sets }], now)?.sets).toEqual([
    { reps: 11, weightKg: 60 },
    { reps: 10, weightKg: 60 },
  ]);
  expect(
    nextTarget(
      [
        {
          trainedAt: now,
          sets: [...sets.slice(0, 2), ...session([12, 12]).sets],
        },
      ],
      now,
    )?.kind,
  ).toBe("add_weight");
  expect(sets[2]).toEqual({ reps: 10, weightKg: 60 });
});

it("rounds a new load to the increment and reports the actual increase", () => {
  expect(nextTarget([session([12], 61.25)], now)).toMatchObject({
    kind: "add_weight",
    sets: [{ reps: 8, weightKg: 65 }],
    reason: "You hit 12 reps on every set; add 3.75 kg.",
  });
});

it("deloads after two first working sets below min at the same weight", () => {
  const previous = session([6, 12], 62.5, now - day);
  previous.sets.unshift({ reps: 12, weightKg: 20 });
  expect(nextTarget([previous, session([7, 9], 62.5)], now)).toEqual({
    kind: "deload",
    sets: [
      { reps: 8, weightKg: 55 },
      { reps: 8, weightKg: 55 },
    ],
    range: { min: 8, max: 12 },
    reason: "Your first set fell below 8 reps twice; drop to 55 kg.",
    basedOn: now,
  });
});

it.each([
  { name: "one failed session", sessions: [session([6])] },
  {
    name: "a successful previous first set",
    sessions: [session([8, 6]), session([6])],
  },
  {
    name: "a successful latest first set",
    sessions: [session([6]), session([8, 6])],
  },
  {
    name: "different top weights",
    sessions: [session([6], 55), session([6], 60)],
  },
])("does not deload with $name", ({ sessions }) => {
  expect(nextTarget(sessions, now)?.kind).toBe("add_reps");
});

it("uses only the two most recent nonempty sessions", () => {
  expect(
    nextTarget(
      [
        session([6], 60, now - 2 * day),
        session([8], 60, now - day),
        session([6]),
        session([]),
      ],
      now,
    ),
  ).toMatchObject({
    kind: "add_reps",
    basedOn: now,
    sets: [{ reps: 7, weightKg: 60 }],
  });
});

it("returns after more than 21 days before applying weight progression or deload", () => {
  for (const reps of [
    [12, 12],
    [6, 6],
  ]) {
    const last = session(reps, 62.5, now - 28 * day);
    expect(nextTarget([session([6], 62.5, now - 29 * day), last], now)).toEqual(
      {
        kind: "return",
        sets: [
          { reps: 8, weightKg: 55 },
          { reps: 8, weightKg: 55 },
        ],
        range: { min: 8, max: 12 },
        reason: "It’s been 4 weeks; ease back in at 90%.",
        basedOn: last.trainedAt,
      },
    );
  }
  expect(nextTarget([session([9], 60, now - 21 * day)], now)?.kind).toBe(
    "add_reps",
  );
  expect(nextTarget([session([9], 60, now - 21 * day - 1)], now)?.kind).toBe(
    "return",
  );
});

it.each([
  { weightKg: 62.5, reduced: 55 },
  { weightKg: 25, reduced: 22.5 },
  { weightKg: 19, reduced: 17 },
  { weightKg: 0.5, reduced: 0 },
])(
  "rounds 90% of $weightKg kg down to $reduced kg without negative weights or float noise",
  ({ weightKg, reduced }) => {
    expect(
      nextTarget(
        [session([6], weightKg, now - day), session([7], weightKg)],
        now,
      )?.sets,
    ).toEqual([{ reps: 8, weightKg: reduced }]);
  },
);

it("uses 8–20 for bodyweight even when a compound range is supplied", () => {
  expect(
    nextTarget([session([12, 19, 5], 0)], now, { min: 5, max: 8 }),
  ).toMatchObject({
    kind: "add_reps",
    range: { min: 8, max: 20 },
    sets: [
      { reps: 13, weightKg: 0 },
      { reps: 20, weightKg: 0 },
      { reps: 6, weightKg: 0 },
    ],
  });
});

it("keeps bodyweight sets at max and suggests weight or a harder variation", () => {
  expect(nextTarget([session([20, 20], 0)], now)).toMatchObject({
    kind: "add_reps",
    sets: [
      { reps: 20, weightKg: 0 },
      { reps: 20, weightKg: 0 },
    ],
    reason:
      "You hit 20 reps on every set; add weight or try a harder variation.",
  });
});

it("chooses 5–8 for the six named compounds and 8–12 for other names", () => {
  for (const name of [
    "Deadlift",
    "Back squat",
    "Front squat",
    "Barbell row",
    "Bench press",
    "Overhead press",
  ])
    expect(repRange(name)).toEqual({ min: 5, max: 8 });
  for (const name of ["Curl", "Romanian deadlift", "My exercise"])
    expect(repRange(name)).toEqual({ min: 8, max: 12 });
  expect(
    nextTarget([session([8, 9])], now, repRange("Bench press")),
  ).toMatchObject({
    kind: "add_weight",
    range: { min: 5, max: 8 },
    sets: [
      { reps: 5, weightKg: 62.5 },
      { reps: 5, weightKg: 62.5 },
    ],
  });
});

it("never deloads a bodyweight exercise; it keeps adding reps", () => {
  const target = nextTarget(
    [session([5, 4], 0, now - 3 * day), session([5, 4], 0)],
    now,
  );
  expect(target).toMatchObject({
    kind: "add_reps",
    sets: [
      { reps: 6, weightKg: 0 },
      { reps: 5, weightKg: 0 },
    ],
  });
});

it("counts a slightly lighter back-off set as a working set", () => {
  const target = nextTarget(
    [session([10, 8, 8, 8], 65)].map((s) => ({
      ...s,
      sets: s.sets.map((set, i) =>
        i === 1 ? { ...set, weightKg: 67.5 } : set,
      ),
    })),
    now,
    { min: 5, max: 8 },
  );
  expect(target).toMatchObject({ kind: "add_weight" });
  expect(target?.sets).toEqual(
    Array.from({ length: 4 }, () => ({ reps: 5, weightKg: 70 })),
  );
});

import { describe, expect, it } from "vitest";
import { coachSuggestions, type CoachInput } from "../lib/coach";

const base: CoachInput = {
  now: Date.parse("2026-10-15T05:00Z"),
  localMinutes: 12 * 60,
  timeZone: "Asia/Jakarta",
  waterMl: 2500,
  waterGoal: 2500,
  macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  targets: {},
  mealCount: 1,
  muscles: [{ name: "back", cooldownHours: 24, lastTrainedAt: null }],
  readiness: { score: 35, band: "easy", weakest: "sleep" },
};
const suggest = (changes: Partial<CoachInput> = {}) =>
  coachSuggestions({ ...base, ...changes });
const nudge = (changes: Partial<CoachInput> = {}) =>
  suggest(changes).find((s) => s.kind === "readiness");

const reasons = [
  ["sleep", "Last night was short."],
  ["sleepTrend", "You've slept less than usual lately."],
  ["feel", "You're running low today."],
  ["soreness", "Several muscle groups are still sore."],
  ["load", "Your training load is well above your usual week."],
  [undefined, "Several signals are low."],
] satisfies [NonNullable<CoachInput["readiness"]>["weakest"], string][];

describe("readiness coach", () => {
  it.each(["push", "steady", "easy", null] as const)(
    "nudges only the easy band (%s)",
    (band) => {
      expect(Boolean(nudge({ readiness: { score: 35, band } }))).toBe(
        band === "easy",
      );
    },
  );

  it.each([
    [5 * 60 + 59, false],
    [6 * 60, true],
    [13 * 60 + 59, true],
    [14 * 60, false],
  ])("checks the local window at minute %i", (localMinutes, expected) => {
    expect(Boolean(nudge({ localMinutes }))).toBe(expected);
  });

  it.each(reasons)("uses the %s reason", (weakest, reason) => {
    expect(nudge({ readiness: { score: 35, band: "easy", weakest } })).toEqual({
      id: "today:readiness",
      kind: "readiness",
      priority: 2,
      title: "Readiness 35: take it easy",
      body: `${reason} A walk, mobility or a stretch fits today better than a hard session.`,
    });
  });

  it.each([
    ["2026-10-14T16:59:59.999Z", true],
    ["2026-10-14T17:00:00.000Z", false],
    ["2026-10-15T04:00:00.000Z", false],
  ])("checks every muscle against today's local date (%s)", (at, expected) => {
    expect(
      Boolean(
        nudge({
          muscles: [
            ...base.muscles,
            { name: "legs", cooldownHours: 24, lastTrainedAt: Date.parse(at) },
          ],
        }),
      ),
    ).toBe(expected);
  });

  it("uses UTC when no time zone is supplied", () => {
    expect(
      nudge({
        timeZone: undefined,
        muscles: [
          {
            name: "back",
            cooldownHours: 24,
            lastTrainedAt: Date.parse("2026-10-14T23:30Z"),
          },
        ],
      }),
    ).toBeDefined();
  });

  it("suppresses training while the readiness nudge is present", () => {
    const before = suggest({ readiness: undefined });
    expect(before.map((s) => s.kind)).toEqual(["train"]);
    expect(suggest().map((s) => s.kind)).toEqual(["readiness"]);
    expect(suggest({ localMinutes: 14 * 60 }).map((s) => s.kind)).toEqual([
      "train",
    ]);
  });

  it("keeps water and food ahead of readiness and caps the list at three", () => {
    expect(
      suggest({
        localMinutes: 13 * 60,
        waterMl: 0,
        targets: { proteinTarget: 100 },
      }).map((s) => s.kind),
    ).toEqual(["food", "water", "readiness"]);
  });

  it.each([
    {
      changes: {},
      expected:
        '[{"id":"train:back","kind":"train","priority":3,"title":"Train back today","body":"You have not logged training for this group."}]',
    },
    {
      changes: { waterMl: 0 },
      expected:
        '[{"id":"water:pace","kind":"water","priority":1,"title":"Drink 850 ml of water","body":"You have logged 0 of 2500 ml today."},{"id":"train:back","kind":"train","priority":3,"title":"Train back today","body":"You have not logged training for this group."}]',
    },
    {
      changes: {
        localMinutes: 19 * 60,
        waterMl: 0,
        mealCount: 0,
        targets: { kcalTarget: 2000, proteinTarget: 150 },
        habits: [{ id: "h1", name: "Vitamins", order: 0 }],
        cardio: { weekActiveMinutes: 0, todayMinutes: 0, weekday: 4 },
      },
      expected:
        '[{"id":"food:targets","kind":"food","priority":1,"title":"Add protein to your next meal","body":"150 g protein left. Greek yogurt 200 g ≈ 20 g; chicken 100 g ≈ 31 g; tofu 150 g ≈ 18 g."},{"id":"water:pace","kind":"water","priority":1,"title":"Drink 2000 ml of water","body":"You have logged 0 of 2500 ml today."},{"id":"today:cardio","kind":"cardio","priority":3,"title":"0 of 150 active minutes","body":"A 45-minute brisk walk tonight gets you back on pace for the week."}]',
    },
    {
      changes: {
        muscles: [{ name: "back", cooldownHours: 24, lastTrainedAt: base.now }],
      },
      expected:
        '[{"id":"rest:back","kind":"rest","priority":3,"title":"Take a recovery day","body":"Your trained groups are recovering. back is ready Fri 12:00."}]',
    },
  ])(
    "preserves legacy output bytes without readiness (%#)",
    ({ changes, expected }) => {
      expect(
        JSON.stringify(suggest({ ...changes, readiness: undefined })),
      ).toBe(expected);
    },
  );
});
